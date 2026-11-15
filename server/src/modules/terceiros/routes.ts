import { Router } from 'express';
import { z } from 'zod';
import type { Perfil, Prisma, StatusPedidoRemessa, StatusRemessaTerceiro, TipoTerceiro } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { movimentarEstoque, saldoDe } from '../../lib/estoque';
import type { Tx } from '../../lib/estoque';
import { arred2, arred3, codigoAleatorio, inicioDoDia, num, numOuNull, somarDias } from '../../lib/numeros';
import { lerConfiguracao } from '../../lib/email';
import { notificarPerfis } from '../../lib/push';

// Estoque em posse de terceiros: cadastro de terceiros, remessas (envio), retorno, baixa
// (vendido/consumido/perdido no terceiro) e cancelamento. Estoque próprio só muda por movimentarEstoque.

const router = Router();
export default router;

// Rotas públicas (portal do terceiro, sem login). Montadas em /api antes das autenticadas.
export const publico = Router();

// Limite simples em memória: 60 requisições por minuto por IP nas rotas do portal.
const JANELA_LIMITE_MS = 60_000;
const LIMITE_POR_JANELA = 60;
const contagemPorIp = new Map<string, { inicio: number; total: number }>();

publico.use('/publico/remessa', (req, _res, next) => {
  const agora = Date.now();
  const ip = req.ip ?? 'desconhecido';
  if (contagemPorIp.size > 5000) {
    for (const [chave, valor] of contagemPorIp) {
      if (agora - valor.inicio > JANELA_LIMITE_MS) contagemPorIp.delete(chave);
    }
  }
  const atual = contagemPorIp.get(ip);
  if (!atual || agora - atual.inicio > JANELA_LIMITE_MS) {
    contagemPorIp.set(ip, { inicio: agora, total: 1 });
    return next();
  }
  atual.total++;
  if (atual.total > LIMITE_POR_JANELA) return next(new HttpError(429, 'Muitas tentativas, aguarde um minuto'));
  next();
});

const ESCRITA: Perfil[] = ['GESTOR', 'ESTOQUISTA'];
const LEITURA: Perfil[] = ['GESTOR', 'ESTOQUISTA', 'COMPRADOR', 'CONTADOR'];
const ATIVAS: StatusRemessaTerceiro[] = ['ABERTA', 'PARCIAL'];
const TIPOS = ['CONSIGNACAO', 'COMODATO', 'CONSERTO', 'DEMONSTRACAO', 'ARMAZEM', 'EVENTO', 'OUTRO'] as const;
const STATUS_FILTRO = ['ABERTA', 'PARCIAL', 'ENCERRADA', 'CANCELADA', 'ATRASADA'] as const;
const MOTIVOS_BAIXA: Record<string, string> = {
  VENDIDO: 'Vendido',
  CONSUMIDO: 'Consumido',
  PERDIDO: 'Perdido',
  OUTRO: 'Outro',
};

const SEL_PRODUTO = {
  select: { id: true, codigo: true, nome: true, foto: true, unidade: true, categoria: { select: { nome: true } } },
} as const;

// ---------- Schemas ----------

const textoOpc = z.string().trim().max(200).nullish();

const terceiroSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(200),
  documento: textoOpc,
  telefone: textoOpc,
  email: textoOpc,
  contato: textoOpc,
  endereco: textoOpc,
  cidade: textoOpc,
  uf: z.string().trim().max(2).nullish(),
  observacoes: z.string().trim().max(2000).nullish(),
  ativo: z.boolean().optional(),
  clienteId: z.number().int().positive().nullish(),
});
type DadosTerceiro = z.infer<typeof terceiroSchema>;

const remessaSchema = z.object({
  terceiroId: z.number().int().positive('Escolha o terceiro'),
  tipo: z.enum(TIPOS, { message: 'Tipo inválido' }),
  documento: textoOpc,
  previsaoRetorno: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullish(),
  observacoes: z.string().trim().max(2000).nullish(),
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        quantidade: z.number().positive('Quantidade deve ser maior que zero'),
        precoCobranca: z.number().nonnegative().nullish(),
      })
    )
    .min(1, 'Inclua ao menos um item')
    .refine((itens) => new Set(itens.map((i) => i.produtoId)).size === itens.length, 'Produto repetido na remessa'),
});

const itensRetornoSchema = z.object({
  itens: z
    .array(z.object({ itemId: z.number().int().positive(), quantidade: z.number().positive('Quantidade deve ser maior que zero') }))
    .min(1, 'Informe ao menos um item'),
});

// Item repetido no mesmo pedido: checado antes da validação e do pendente.
function conferirItemRepetido(corpo: unknown): void {
  const itens = (corpo as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens)) return;
  const ids = itens.map((i) => (i as { itemId?: unknown } | null)?.itemId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Item repetido no pedido');
}

const baixaSchema = itensRetornoSchema.extend({
  motivo: z.enum(['VENDIDO', 'CONSUMIDO', 'PERDIDO', 'OUTRO'], { message: 'Motivo inválido' }),
  gerarCobranca: z.boolean().optional(),
});

// ---------- Helpers ----------

// Data AAAA-MM-DD como meia-noite local (mesmo critério do restante do sistema).
function dataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const limpa = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : v && v.trim() ? v.trim() : null);

interface ParteItem {
  quantidade: Prisma.Decimal;
  quantidadeRetornada: Prisma.Decimal;
  quantidadeBaixada: Prisma.Decimal;
}

// Quantidade ainda com o terceiro (enviada - retornada - baixada).
function pendenteDe(i: ParteItem): number {
  return arred3(num(i.quantidade) - num(i.quantidadeRetornada) - num(i.quantidadeBaixada));
}

function valorPendenteDe(i: ParteItem & { custoUnitario: Prisma.Decimal }): number {
  return pendenteDe(i) * num(i.custoUnitario);
}

interface ItemLinha extends ParteItem {
  id: number;
  produtoId: number;
  custoUnitario: Prisma.Decimal;
  precoCobranca: Prisma.Decimal | null;
  produto: { id: number; codigo: string; nome: string; foto: string | null; unidade: string; categoria: { nome: string } | null };
}

interface RemessaLinha {
  id: number;
  numero: number;
  lojaId: number;
  tipo: TipoTerceiro;
  status: StatusRemessaTerceiro;
  documento: string | null;
  observacoes: string | null;
  previsaoRetorno: Date | null;
  criadoEm: Date;
  encerradaEm: Date | null;
  terceiro: { id: number; nome: string; documento: string | null };
  loja: { id: number; nome: string };
  itens: ItemLinha[];
}

const INCLUI_REMESSA = {
  terceiro: { select: { id: true, nome: true, documento: true } },
  loja: { select: { id: true, nome: true } },
  itens: { orderBy: { id: 'asc' as const }, include: { produto: SEL_PRODUTO } },
} as const;

function dtoItem(i: ItemLinha) {
  return {
    id: i.id,
    produtoId: i.produtoId,
    produto: i.produto.nome,
    codigo: i.produto.codigo,
    foto: i.produto.foto,
    categoria: i.produto.categoria?.nome ?? null,
    unidade: i.produto.unidade,
    quantidade: arred3(num(i.quantidade)),
    retornada: arred3(num(i.quantidadeRetornada)),
    baixada: arred3(num(i.quantidadeBaixada)),
    pendente: pendenteDe(i),
    custoUnitario: num(i.custoUnitario),
    precoCobranca: numOuNull(i.precoCobranca),
  };
}

function totaisDa(itens: ItemLinha[]) {
  let enviado = 0;
  let retornado = 0;
  let baixado = 0;
  let pendente = 0;
  let valorPendente = 0;
  for (const i of itens) {
    enviado += num(i.quantidade);
    retornado += num(i.quantidadeRetornada);
    baixado += num(i.quantidadeBaixada);
    pendente += pendenteDe(i);
    valorPendente += valorPendenteDe(i);
  }
  return {
    enviado: arred3(enviado),
    retornado: arred3(retornado),
    baixado: arred3(baixado),
    pendente: arred3(pendente),
    valorPendente: arred2(valorPendente),
  };
}

// Totais separados por unidade (não se somam kg com un).
function totaisPorUnidade(itens: ItemLinha[]) {
  const mapa = new Map<string, { unidade: string; enviado: number; retornado: number; baixado: number; pendente: number }>();
  for (const i of itens) {
    const unidade = i.produto.unidade;
    const t = mapa.get(unidade) ?? { unidade, enviado: 0, retornado: 0, baixado: 0, pendente: 0 };
    t.enviado += num(i.quantidade);
    t.retornado += num(i.quantidadeRetornada);
    t.baixado += num(i.quantidadeBaixada);
    t.pendente += pendenteDe(i);
    mapa.set(unidade, t);
  }
  return [...mapa.values()].map((t) => ({
    unidade: t.unidade,
    enviado: arred3(t.enviado),
    retornado: arred3(t.retornado),
    baixado: arred3(t.baixado),
    pendente: arred3(t.pendente),
  }));
}

function dtoRemessa(r: RemessaLinha) {
  const fotos: { produtoId: number; nome: string; foto: string | null; categoria: string | null }[] = [];
  for (const i of r.itens) {
    if (fotos.length >= 4) break;
    if (fotos.some((f) => f.produtoId === i.produtoId)) continue;
    fotos.push({ produtoId: i.produtoId, nome: i.produto.nome, foto: i.produto.foto, categoria: i.produto.categoria?.nome ?? null });
  }
  const ativa = ATIVAS.includes(r.status);
  return {
    id: r.id,
    numero: r.numero,
    tipo: r.tipo,
    status: r.status,
    documento: r.documento,
    observacoes: r.observacoes,
    terceiroId: r.terceiro.id,
    terceiro: r.terceiro.nome,
    terceiroDocumento: r.terceiro.documento,
    lojaId: r.loja.id,
    loja: r.loja.nome,
    previsaoRetorno: r.previsaoRetorno ? r.previsaoRetorno.toISOString() : null,
    atrasada: ativa && r.previsaoRetorno !== null && r.previsaoRetorno < inicioDoDia(),
    criadoEm: r.criadoEm.toISOString(),
    encerradaEm: r.encerradaEm ? r.encerradaEm.toISOString() : null,
    totais: totaisDa(r.itens),
    produtos: r.itens.length,
    unidades: totaisPorUnidade(r.itens),
    fotos,
  };
}

// Lista de remessas (os filtros já vêm prontos de quem chama).
async function listarRemessas(where: Prisma.RemessaTerceiroWhereInput): Promise<RemessaLinha[]> {
  const lista = await prisma.remessaTerceiro.findMany({
    where,
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    include: INCLUI_REMESSA,
  });
  return lista as unknown as RemessaLinha[];
}

async function buscarRemessa(cliente: Tx, id: number): Promise<RemessaLinha> {
  const r = await cliente.remessaTerceiro.findUnique({ where: { id }, include: INCLUI_REMESSA });
  if (!r) throw new HttpError(404, 'Remessa não encontrada');
  return r as unknown as RemessaLinha;
}

// Itens de remessas ainda abertas (ABERTA/PARCIAL), com o terceiro e a loja da remessa.
async function itensAtivos(lojaId: number | null) {
  return prisma.remessaTerceiroItem.findMany({
    where: { remessa: { status: { in: ATIVAS }, ...(lojaId ? { lojaId } : {}) } },
    include: {
      remessa: { select: { id: true, terceiroId: true, lojaId: true, tipo: true, previsaoRetorno: true, status: true } },
      produto: SEL_PRODUTO,
    },
  });
}

// Recalcula o status da remessa depois de um retorno ou baixa.
async function atualizarStatus(tx: Tx, remessaId: number): Promise<void> {
  const itens = await tx.remessaTerceiroItem.findMany({ where: { remessaId } });
  const pendenteTotal = arred3(itens.reduce((s, i) => s + pendenteDe(i), 0));
  const teveSaida = itens.some((i) => num(i.quantidadeRetornada) + num(i.quantidadeBaixada) > 0);
  const status: StatusRemessaTerceiro = pendenteTotal <= 0 ? 'ENCERRADA' : teveSaida ? 'PARCIAL' : 'ABERTA';
  await tx.remessaTerceiro.update({
    where: { id: remessaId },
    data: { status, encerradaEm: status === 'ENCERRADA' ? new Date() : null },
  });
}

function itemDaRemessa(remessa: RemessaLinha, itemId: number): ItemLinha {
  const item = remessa.itens.find((i) => i.id === itemId);
  if (!item) throw new HttpError(400, 'Item não pertence a esta remessa');
  return item;
}

// Só remessa ABERTA ou PARCIAL recebe retorno ou baixa.
function exigirAtiva(status: StatusRemessaTerceiro): void {
  if (!ATIVAS.includes(status)) throw new HttpError(400, 'Esta remessa já está encerrada ou cancelada');
}

function conferirQuantidade(item: ItemLinha, quantidade: number): void {
  const pendente = pendenteDe(item);
  if (quantidade > pendente) {
    throw new HttpError(400, `Quantidade acima do pendente (${arred3(pendente)} un) de ${item.produto.nome}`);
  }
}

// Miolo da criação de remessa: cria a remessa, tira do estoque próprio e soma no saldo do terceiro.
// Usada pela rota de envio e pela aprovação de pedido do portal. Devolve o id da remessa.
async function criarRemessa(
  tx: Tx,
  d: {
    terceiro: { id: number; nome: string };
    lojaId: number;
    tipo: TipoTerceiro;
    documento: string | null;
    previsaoRetorno: Date | null;
    observacoes: string | null;
    usuarioId: number;
    itens: { produtoId: number; quantidade: number; precoCobranca?: number | null }[];
  }
): Promise<number> {
  const remessa = await tx.remessaTerceiro.create({
    data: {
      terceiroId: d.terceiro.id,
      lojaId: d.lojaId,
      tipo: d.tipo,
      documento: d.documento,
      previsaoRetorno: d.previsaoRetorno,
      observacoes: d.observacoes,
      usuarioId: d.usuarioId,
    },
  });

  for (const it of d.itens) {
    const produto = await tx.produto.findUnique({
      where: { id: it.produtoId },
      select: { id: true, nome: true, precoCusto: true, precoVenda: true },
    });
    if (!produto) throw new HttpError(400, 'Produto não encontrado');
    const quantidade = arred3(it.quantidade);
    const saldo = await saldoDe(produto.id, d.lojaId, tx);
    if (saldo < quantidade) {
      throw new HttpError(400, `Saldo insuficiente de ${produto.nome}: há ${arred3(saldo)} un no estoque próprio`);
    }
    const custo = num(produto.precoCusto);

    await movimentarEstoque(tx, {
      produtoId: produto.id,
      lojaId: d.lojaId,
      tipo: 'REMESSA_TERCEIRO',
      quantidade: -quantidade,
      custoUnitario: custo,
      motivo: `Remessa nº ${remessa.numero} para ${d.terceiro.nome}`,
      referencia: `terceiro:${remessa.id}`,
      usuarioId: d.usuarioId,
    });
    await tx.remessaTerceiroItem.create({
      data: {
        remessaId: remessa.id,
        produtoId: produto.id,
        quantidade,
        custoUnitario: custo,
        precoCobranca: it.precoCobranca ?? num(produto.precoVenda),
      },
    });
    await tx.estoqueTerceiro.upsert({
      where: { terceiroId_produtoId_lojaId: { terceiroId: d.terceiro.id, produtoId: produto.id, lojaId: d.lojaId } },
      create: { terceiroId: d.terceiro.id, produtoId: produto.id, lojaId: d.lojaId, quantidade },
      update: { quantidade: { increment: quantidade } },
    });
  }
  return remessa.id;
}

// ---------- Terceiros ----------

router.get(
  '/terceiros',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const hoje = inicioDoDia();
    const [terceiros, ativos, remessasAtivas, estoques] = await Promise.all([
      prisma.terceiro.findMany({ orderBy: { nome: 'asc' } }),
      itensAtivos(lojaId),
      prisma.remessaTerceiro.findMany({
        where: { status: { in: ATIVAS }, ...(lojaId ? { lojaId } : {}) },
        select: { id: true, terceiroId: true, previsaoRetorno: true },
      }),
      prisma.estoqueTerceiro.findMany({
        where: { quantidade: { gt: 0 }, ...(lojaId ? { lojaId } : {}) },
        select: { terceiroId: true, produtoId: true, quantidade: true },
      }),
    ]);

    const pendentes = await pedidosPendentesPorTerceiro(lojaId);
    res.json(
      terceiros.map((t) => {
        const remessas = remessasAtivas.filter((r) => r.terceiroId === t.id);
        const itens = ativos.filter((i) => i.remessa.terceiroId === t.id);
        const doTerceiro = estoques.filter((e) => e.terceiroId === t.id);
        const itensEmPosse = doTerceiro.reduce((s, e) => s + num(e.quantidade), 0);
        const produtosEmPosse = new Set(doTerceiro.map((e) => e.produtoId)).size;
        return {
          id: t.id,
          nome: t.nome,
          documento: t.documento,
          telefone: t.telefone,
          email: t.email,
          contato: t.contato,
          cidade: t.cidade,
          uf: t.uf,
          ativo: t.ativo,
          codigoAcesso: t.codigoAcesso,
          pedidosPendentes: pendentes.get(t.id) ?? 0,
          remessasAbertas: remessas.length,
          itensEmPosse: arred3(itensEmPosse),
          produtosEmPosse,
          valorEmPosse: arred2(itens.reduce((s, i) => s + valorPendenteDe(i), 0)),
          atrasadas: remessas.filter((r) => r.previsaoRetorno !== null && r.previsaoRetorno < hoje).length,
        };
      })
    );
  })
);

function camposTerceiro(d: Partial<DadosTerceiro>) {
  return {
    nome: d.nome,
    documento: limpa(d.documento),
    telefone: limpa(d.telefone),
    email: limpa(d.email),
    contato: limpa(d.contato),
    endereco: limpa(d.endereco),
    cidade: limpa(d.cidade),
    uf: limpa(d.uf),
    observacoes: limpa(d.observacoes),
    ativo: d.ativo,
    clienteId: d.clienteId,
  };
}

router.post(
  '/terceiros',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const dados = validar(terceiroSchema, req.body);
    const criado = await prisma.terceiro.create({ data: { ...camposTerceiro(dados), nome: dados.nome } });
    res.status(201).json(criado);
  })
);

router.put(
  '/terceiros/:id',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(terceiroSchema.partial(), req.body);
    const existente = await prisma.terceiro.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Terceiro não encontrado');
    const atualizado = await prisma.terceiro.update({ where: { id }, data: camposTerceiro(dados) });
    res.json(atualizado);
  })
);

// Resumo do topo: valor e itens em posse, remessas abertas e atrasadas.
router.get(
  '/terceiros/resumo',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const hoje = inicioDoDia();
    const [ativos, remessas, estoques] = await Promise.all([
      itensAtivos(lojaId),
      prisma.remessaTerceiro.findMany({
        where: { status: { in: ATIVAS }, ...(lojaId ? { lojaId } : {}) },
        select: { id: true, previsaoRetorno: true },
      }),
      prisma.estoqueTerceiro.findMany({
        where: { quantidade: { gt: 0 }, ...(lojaId ? { lojaId } : {}) },
        select: { terceiroId: true, produtoId: true, quantidade: true },
      }),
    ]);

    const porTipoMapa = new Map<TipoTerceiro, number>();
    for (const i of ativos) {
      porTipoMapa.set(i.remessa.tipo, (porTipoMapa.get(i.remessa.tipo) ?? 0) + valorPendenteDe(i));
    }

    const pendentesPorTerceiro = await pedidosPendentesPorTerceiro(lojaId);
    res.json({
      pedidosPendentes: [...pendentesPorTerceiro.values()].reduce((s, n) => s + n, 0),
      valorEmPosse: arred2(ativos.reduce((s, i) => s + valorPendenteDe(i), 0)),
      itensEmPosse: arred3(estoques.reduce((s, e) => s + num(e.quantidade), 0)),
      produtosEmPosse: new Set(estoques.map((e) => e.produtoId)).size,
      terceirosComSaldo: new Set(estoques.map((e) => e.terceiroId)).size,
      remessasAbertas: remessas.length,
      atrasadas: remessas.filter((r) => r.previsaoRetorno !== null && r.previsaoRetorno < hoje).length,
      porTipo: [...porTipoMapa.entries()]
        .filter(([, valor]) => valor > 0)
        .map(([tipo, valor]) => ({ tipo, valor: arred2(valor) })),
    });
  })
);

// Saldo por terceiro, produto e loja (só saldos > 0), com o valor em posse.
router.get(
  '/terceiros/estoque',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const terceiroId = Number(req.query.terceiroId);
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';

    const saldos = await prisma.estoqueTerceiro.findMany({
      where: {
        quantidade: { gt: 0 },
        ...(lojaId ? { lojaId } : {}),
        ...(Number.isInteger(terceiroId) && terceiroId > 0 ? { terceiroId } : {}),
        ...(busca
          ? {
              produto: {
                OR: [
                  { nome: { contains: busca, mode: 'insensitive' } },
                  { codigo: { contains: busca, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        terceiro: { select: { id: true, nome: true } },
        loja: { select: { id: true, nome: true } },
        produto: SEL_PRODUTO,
      },
      orderBy: [{ terceiro: { nome: 'asc' } }, { produto: { nome: 'asc' } }],
    });

    // Valor = soma do pendente x custo dos itens abertos desse terceiro, produto e loja.
    const ativos = await itensAtivos(lojaId);
    const valores = new Map<string, number>();
    for (const i of ativos) {
      const chave = `${i.remessa.terceiroId}-${i.produtoId}-${i.remessa.lojaId}`;
      valores.set(chave, (valores.get(chave) ?? 0) + valorPendenteDe(i));
    }

    const itens = saldos.map((s) => ({
      id: s.id,
      terceiroId: s.terceiroId,
      terceiro: s.terceiro.nome,
      lojaId: s.lojaId,
      loja: s.loja.nome,
      produtoId: s.produtoId,
      codigo: s.produto.codigo,
      nome: s.produto.nome,
      foto: s.produto.foto,
      categoria: s.produto.categoria?.nome ?? null,
      unidade: s.produto.unidade,
      quantidade: arred3(num(s.quantidade)),
      valor: arred2(valores.get(`${s.terceiroId}-${s.produtoId}-${s.lojaId}`) ?? 0),
    }));

    res.json({
      itens,
      total: itens.length,
      valorTotal: arred2(itens.reduce((s, i) => s + i.valor, 0)),
    });
  })
);

// ---------- Remessas ----------

router.get(
  '/remessas-terceiro',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo : '';
    const terceiroId = Number(req.query.terceiroId);

    const where: Prisma.RemessaTerceiroWhereInput = {};
    if (lojaId) where.lojaId = lojaId;
    if (status === 'ATRASADA') {
      where.status = { in: ATIVAS };
      where.previsaoRetorno = { lt: inicioDoDia() };
    } else if ((STATUS_FILTRO as readonly string[]).includes(status)) {
      where.status = status as StatusRemessaTerceiro;
    }
    if ((TIPOS as readonly string[]).includes(tipo)) where.tipo = tipo as TipoTerceiro;
    if (Number.isInteger(terceiroId) && terceiroId > 0) where.terceiroId = terceiroId;

    const remessas = await listarRemessas(where);
    res.json(remessas.map(dtoRemessa));
  })
);

router.get(
  '/remessas-terceiro/:id',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const r = await buscarRemessa(prisma, id);
    res.json({ ...dtoRemessa(r), itens: r.itens.map(dtoItem) });
  })
);

// Envio: sai do estoque próprio (REMESSA_TERCEIRO) e passa a constar com o terceiro.
router.post(
  '/remessas-terceiro',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const dados = validar(remessaSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const terceiro = await prisma.terceiro.findUnique({ where: { id: dados.terceiroId }, select: { id: true, nome: true, ativo: true } });
    if (!terceiro) throw new HttpError(404, 'Terceiro não encontrado');
    if (!terceiro.ativo) throw new HttpError(400, 'Terceiro inativo');

    const id = await prisma.$transaction((tx) =>
      criarRemessa(tx, {
        terceiro,
        lojaId,
        tipo: dados.tipo,
        documento: limpa(dados.documento) ?? null,
        previsaoRetorno: dataLocal(dados.previsaoRetorno),
        observacoes: limpa(dados.observacoes) ?? null,
        usuarioId: req.usuario.id,
        itens: dados.itens,
      })
    );

    const r = await buscarRemessa(prisma, id);
    res.status(201).json({ ...dtoRemessa(r), itens: r.itens.map(dtoItem) });
  })
);

// Retorno: volta ao estoque próprio da loja da remessa, até o pendente de cada item.
router.post(
  '/remessas-terceiro/:id/retorno',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    conferirItemRepetido(req.body);
    const dados = validar(itensRetornoSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const remessa = await buscarRemessa(tx, id);
      exigirAtiva(remessa.status);

      for (const pedido of dados.itens) {
        const item = itemDaRemessa(remessa, pedido.itemId);
        const quantidade = arred3(pedido.quantidade);
        conferirQuantidade(item, quantidade);

        await movimentarEstoque(tx, {
          produtoId: item.produtoId,
          lojaId: remessa.lojaId,
          tipo: 'RETORNO_TERCEIRO',
          quantidade,
          custoUnitario: num(item.custoUnitario),
          motivo: `Retorno da remessa nº ${remessa.numero} (${remessa.terceiro.nome})`,
          referencia: `terceiro:${remessa.id}`,
          usuarioId: req.usuario.id,
        });
        await tx.remessaTerceiroItem.update({ where: { id: item.id }, data: { quantidadeRetornada: { increment: quantidade } } });
        await tx.estoqueTerceiro.update({
          where: { terceiroId_produtoId_lojaId: { terceiroId: remessa.terceiro.id, produtoId: item.produtoId, lojaId: remessa.lojaId } },
          data: { quantidade: { decrement: quantidade } },
        });
      }
      await atualizarStatus(tx, remessa.id);
    });

    const r = await buscarRemessa(prisma, id);
    res.json({ ...dtoRemessa(r), itens: r.itens.map(dtoItem) });
  })
);

// Baixa: vendido, consumido ou perdido no terceiro. Não mexe no saldo próprio:
// registra um movimento de quantidade 0 e, se pedido, lança a cobrança (Receita).
router.post(
  '/remessas-terceiro/:id/baixa',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    conferirItemRepetido(req.body);
    const dados = validar(baixaSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const remessa = await buscarRemessa(tx, id);
      exigirAtiva(remessa.status);
      const rotuloMotivo = MOTIVOS_BAIXA[dados.motivo] ?? 'Outro';
      let cobranca = 0;

      for (const pedido of dados.itens) {
        const item = itemDaRemessa(remessa, pedido.itemId);
        const quantidade = arred3(pedido.quantidade);
        conferirQuantidade(item, quantidade);

        await tx.remessaTerceiroItem.update({ where: { id: item.id }, data: { quantidadeBaixada: { increment: quantidade } } });
        await tx.estoqueTerceiro.update({
          where: { terceiroId_produtoId_lojaId: { terceiroId: remessa.terceiro.id, produtoId: item.produtoId, lojaId: remessa.lojaId } },
          data: { quantidade: { decrement: quantidade } },
        });
        const saldo = await saldoDe(item.produtoId, remessa.lojaId, tx);
        await tx.movimentoEstoque.create({
          data: {
            produtoId: item.produtoId,
            lojaId: remessa.lojaId,
            tipo: 'BAIXA_TERCEIRO',
            quantidade: 0,
            saldoApos: arred3(saldo),
            custoUnitario: num(item.custoUnitario),
            motivo: `Baixa no terceiro: ${rotuloMotivo} (${quantidade} un)`,
            referencia: `terceiro:${remessa.id}`,
            usuarioId: req.usuario.id,
          },
        });
        if (dados.gerarCobranca && item.precoCobranca) {
          cobranca += quantidade * num(item.precoCobranca);
        }
      }

      if (dados.gerarCobranca && arred2(cobranca) > 0) {
        const terceiro = await tx.terceiro.findUniqueOrThrow({
          where: { id: remessa.terceiro.id },
          select: { nome: true, clienteId: true },
        });
        await tx.lancamento.create({
          data: {
            tipo: 'RECEITA',
            origem: 'MANUAL',
            descricao: `Consignação nº ${remessa.numero} - ${terceiro.nome}`,
            valor: arred2(cobranca),
            vencimento: somarDias(inicioDoDia(), 7),
            lojaId: remessa.lojaId,
            clienteId: terceiro.clienteId ?? null,
            referencia: `terceiro:${remessa.id}`,
          },
        });
      }
      await atualizarStatus(tx, remessa.id);
    });

    const r = await buscarRemessa(prisma, id);
    res.json({ ...dtoRemessa(r), itens: r.itens.map(dtoItem) });
  })
);

// Cancelamento: só remessa ABERTA sem retorno nem baixa. Devolve tudo ao estoque próprio.
router.post(
  '/remessas-terceiro/:id/cancelar',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);

    await prisma.$transaction(async (tx) => {
      const remessa = await buscarRemessa(tx, id);
      const teveMovimento = remessa.itens.some((i) => num(i.quantidadeRetornada) + num(i.quantidadeBaixada) > 0);
      if (remessa.status !== 'ABERTA' || teveMovimento) {
        throw new HttpError(400, 'Só é possível cancelar remessa aberta, sem retorno nem baixa');
      }

      for (const item of remessa.itens) {
        const pendente = pendenteDe(item);
        if (pendente <= 0) continue;
        await movimentarEstoque(tx, {
          produtoId: item.produtoId,
          lojaId: remessa.lojaId,
          tipo: 'RETORNO_TERCEIRO',
          quantidade: pendente,
          custoUnitario: num(item.custoUnitario),
          motivo: `Cancelamento da remessa nº ${remessa.numero} (${remessa.terceiro.nome})`,
          referencia: `terceiro:${remessa.id}`,
          usuarioId: req.usuario.id,
        });
        await tx.remessaTerceiroItem.update({ where: { id: item.id }, data: { quantidadeRetornada: { increment: pendente } } });
        await tx.estoqueTerceiro.update({
          where: { terceiroId_produtoId_lojaId: { terceiroId: remessa.terceiro.id, produtoId: item.produtoId, lojaId: remessa.lojaId } },
          data: { quantidade: { decrement: pendente } },
        });
      }
      await tx.remessaTerceiro.update({ where: { id: remessa.id }, data: { status: 'CANCELADA', encerradaEm: new Date() } });
    });

    const r = await buscarRemessa(prisma, id);
    res.json({ ...dtoRemessa(r), itens: r.itens.map(dtoItem) });
  })
);

// ---------- Portal do terceiro: link de acesso (autenticado) ----------

async function novoCodigoPortal(anterior: string | null): Promise<string> {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const codigo = codigoAleatorio(12);
    if (codigo === anterior) continue;
    const existe = await prisma.terceiro.findUnique({ where: { codigoAcesso: codigo }, select: { id: true } });
    if (!existe) return codigo;
  }
  throw new HttpError(500, 'Não foi possível gerar o link. Tente de novo.');
}

async function terceiroParaPortal(id: number) {
  const t = await prisma.terceiro.findUnique({ where: { id }, select: { id: true, ativo: true, codigoAcesso: true } });
  if (!t) throw new HttpError(404, 'Terceiro não encontrado');
  if (!t.ativo) throw new HttpError(400, 'Terceiro inativo');
  return t;
}

function respostaPortal(codigoAcesso: string) {
  return { codigoAcesso, caminho: '/remessa/' + codigoAcesso };
}

// Gera o link do portal (se ainda não houver) e devolve o código.
router.post(
  '/terceiros/:id/portal',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const t = await terceiroParaPortal(id);
    if (t.codigoAcesso) return res.json(respostaPortal(t.codigoAcesso));
    const codigo = await novoCodigoPortal(null);
    await prisma.terceiro.update({ where: { id }, data: { codigoAcesso: codigo } });
    res.json(respostaPortal(codigo));
  })
);

// Gera um código novo: o link antigo deixa de funcionar.
router.post(
  '/terceiros/:id/portal/novo',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const t = await terceiroParaPortal(id);
    const codigo = await novoCodigoPortal(t.codigoAcesso);
    await prisma.terceiro.update({ where: { id }, data: { codigoAcesso: codigo } });
    res.json(respostaPortal(codigo));
  })
);

// Desliga o portal.
router.delete(
  '/terceiros/:id/portal',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.terceiro.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Terceiro não encontrado');
    await prisma.terceiro.update({ where: { id }, data: { codigoAcesso: null } });
    res.status(204).end();
  })
);

// ---------- Pedidos de remessa (feitos pelo terceiro no portal) ----------

const STATUS_PEDIDO = ['PENDENTE', 'APROVADO', 'RECUSADO', 'CANCELADO'] as const;

const INCLUI_PEDIDO = {
  terceiro: { select: { id: true, nome: true, telefone: true, ativo: true } },
  loja: { select: { id: true, nome: true } },
  itens: {
    orderBy: { id: 'asc' as const },
    include: {
      produto: { select: { id: true, codigo: true, nome: true, foto: true, unidade: true, precoCusto: true } },
    },
  },
  remessa: { select: { numero: true } },
} as const;

interface PedidoItemLinha {
  produtoId: number;
  quantidade: Prisma.Decimal;
  produto: { id: number; codigo: string; nome: string; foto: string | null; unidade: string; precoCusto: Prisma.Decimal };
}

interface PedidoLinha {
  id: number;
  numero: number;
  status: StatusPedidoRemessa;
  tipo: TipoTerceiro;
  lojaId: number;
  dataDesejada: Date | null;
  observacoes: string | null;
  motivoRecusa: string | null;
  remessaId: number | null;
  criadoEm: Date;
  respondidoEm: Date | null;
  terceiro: { id: number; nome: string; telefone: string | null; ativo: boolean };
  loja: { id: number; nome: string };
  itens: PedidoItemLinha[];
  remessa: { numero: number } | null;
}

// Data AAAA-MM-DD no horário local (a mesma que foi gravada por dataLocal).
function dataDoDia(d: Date | null): string | null {
  if (!d) return null;
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

async function buscarPedido(cliente: Tx, id: number): Promise<PedidoLinha> {
  const p = await cliente.pedidoRemessaTerceiro.findUnique({ where: { id }, include: INCLUI_PEDIDO });
  if (!p) throw new HttpError(404, 'Pedido não encontrado');
  return p as unknown as PedidoLinha;
}

async function buscarPedidos(where: Prisma.PedidoRemessaTerceiroWhereInput): Promise<PedidoLinha[]> {
  const lista = await prisma.pedidoRemessaTerceiro.findMany({
    where,
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
    include: INCLUI_PEDIDO,
  });
  return lista as unknown as PedidoLinha[];
}

// Monta o formato da lista. O saldo da loja e o custo atual vêm em lote (mesma regra do saldoDe).
// Quantidade efetivamente enviada por remessa e produto (soma de RemessaTerceiroItem.quantidade).
// Chave: `${remessaId}-${produtoId}`. Item tirado na aprovação não tem linha, então vale 0 quando consultado.
async function quantidadesEnviadas(remessaIds: number[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (remessaIds.length === 0) return mapa;
  const itens = await prisma.remessaTerceiroItem.findMany({
    where: { remessaId: { in: remessaIds } },
    select: { remessaId: true, produtoId: true, quantidade: true },
  });
  for (const i of itens) {
    const chave = `${i.remessaId}-${i.produtoId}`;
    mapa.set(chave, arred3((mapa.get(chave) ?? 0) + num(i.quantidade)));
  }
  return mapa;
}

async function dtosPedidos(lista: PedidoLinha[]) {
  const lojas = [...new Set(lista.map((p) => p.lojaId))];
  const produtos = [...new Set(lista.flatMap((p) => p.itens.map((i) => i.produtoId)))];
  const saldos = new Map<string, number>();
  if (lojas.length > 0 && produtos.length > 0) {
    const linhas = await prisma.estoqueLoja.findMany({
      where: { lojaId: { in: lojas }, produtoId: { in: produtos } },
      select: { produtoId: true, lojaId: true, quantidade: true },
    });
    for (const l of linhas) saldos.set(`${l.produtoId}-${l.lojaId}`, arred3(num(l.quantidade)));
  }
  const enviadas = await quantidadesEnviadas(
    lista.map((p) => p.remessaId).filter((x): x is number => x !== null)
  );

  return lista.map((p) => {
    let valorEstimado = 0;
    const itens = p.itens.map((i) => {
      const quantidade = arred3(num(i.quantidade));
      valorEstimado += quantidade * num(i.produto.precoCusto);
      return {
        produtoId: i.produtoId,
        codigo: i.produto.codigo,
        nome: i.produto.nome,
        foto: i.produto.foto,
        unidade: i.produto.unidade,
        quantidade,
        quantidadeEnviada: p.remessaId !== null ? (enviadas.get(`${p.remessaId}-${i.produtoId}`) ?? 0) : null,
        saldoLoja: saldos.get(`${i.produtoId}-${p.lojaId}`) ?? 0,
      };
    });
    return {
      id: p.id,
      numero: p.numero,
      status: p.status,
      tipo: p.tipo,
      terceiro: { id: p.terceiro.id, nome: p.terceiro.nome, telefone: p.terceiro.telefone },
      loja: { id: p.loja.id, nome: p.loja.nome },
      dataDesejada: dataDoDia(p.dataDesejada),
      observacoes: p.observacoes,
      motivoRecusa: p.motivoRecusa,
      remessaId: p.remessaId,
      remessaNumero: p.remessa?.numero ?? null,
      criadoEm: p.criadoEm.toISOString(),
      respondidoEm: p.respondidoEm ? p.respondidoEm.toISOString() : null,
      totalItens: itens.length,
      valorEstimado: arred2(valorEstimado),
      itens,
    };
  });
}

// Pedidos pendentes por terceiro (filtrados pela loja, quando houver).
async function pedidosPendentesPorTerceiro(lojaId: number | null): Promise<Map<number, number>> {
  const pedidos = await prisma.pedidoRemessaTerceiro.findMany({
    where: { status: 'PENDENTE', ...(lojaId ? { lojaId } : {}) },
    select: { terceiroId: true },
  });
  const mapa = new Map<number, number>();
  for (const p of pedidos) mapa.set(p.terceiroId, (mapa.get(p.terceiroId) ?? 0) + 1);
  return mapa;
}

router.get(
  '/pedidos-remessa',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const where: Prisma.PedidoRemessaTerceiroWhereInput = {};
    if (lojaId) where.lojaId = lojaId;
    if ((STATUS_PEDIDO as readonly string[]).includes(status)) where.status = status as StatusPedidoRemessa;
    res.json(await dtosPedidos(await buscarPedidos(where)));
  })
);

const ajusteAprovacaoSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        quantidade: z.number().nonnegative('Quantidade inválida').max(100000, 'Quantidade muito alta'),
      })
    )
    .optional(),
  documento: textoOpc,
  previsaoRetorno: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullish(),
  observacoes: z.string().trim().max(2000).nullish(),
});

const recusaSchema = z.object({
  motivo: z.string().trim().min(3, 'Informe o motivo da recusa').max(300, 'Motivo muito longo'),
});

// Aprovar: cria a remessa (sai do estoque próprio) com os itens ajustados e marca o pedido como APROVADO.
router.post(
  '/pedidos-remessa/:id/aprovar',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(ajusteAprovacaoSchema, req.body ?? {});
    const ajustes = new Map<number, number>();
    for (const i of dados.itens ?? []) {
      if (ajustes.has(i.produtoId)) throw new HttpError(400, 'Produto repetido nos ajustes');
      ajustes.set(i.produtoId, i.quantidade);
    }

    await prisma.$transaction(async (tx) => {
      const pedido = await buscarPedido(tx, id);
      if (pedido.status !== 'PENDENTE') throw new HttpError(400, 'Este pedido já foi respondido');
      if (!pedido.terceiro.ativo) throw new HttpError(400, 'Terceiro inativo');
      for (const produtoId of ajustes.keys()) {
        if (!pedido.itens.some((i) => i.produtoId === produtoId)) {
          throw new HttpError(400, 'Item não pertence a este pedido');
        }
      }

      const itens = pedido.itens
        .map((i) => ({
          produtoId: i.produtoId,
          quantidade: ajustes.get(i.produtoId) ?? arred3(num(i.quantidade)),
        }))
        .filter((i) => i.quantidade > 0);
      if (itens.length === 0) throw new HttpError(400, 'Nenhum item para enviar. Ajuste as quantidades ou recuse o pedido.');

      const remessaId = await criarRemessa(tx, {
        terceiro: { id: pedido.terceiro.id, nome: pedido.terceiro.nome },
        lojaId: pedido.lojaId,
        tipo: pedido.tipo,
        documento: limpa(dados.documento) ?? null,
        previsaoRetorno: dataLocal(dados.previsaoRetorno),
        observacoes: limpa(dados.observacoes) ?? pedido.observacoes ?? null,
        usuarioId: req.usuario.id,
        itens,
      });

      const gravou = await tx.pedidoRemessaTerceiro.updateMany({
        where: { id, status: 'PENDENTE' },
        data: { status: 'APROVADO', remessaId, usuarioId: req.usuario.id, respondidoEm: new Date() },
      });
      if (gravou.count !== 1) throw new HttpError(400, 'Este pedido já foi respondido');
    });

    const atual = await dtosPedidos([await buscarPedido(prisma, id)]);
    res.json(atual[0]);
  })
);

// Recusar: marca o pedido como RECUSADO com o motivo. Não mexe no estoque.
router.post(
  '/pedidos-remessa/:id/recusar',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(recusaSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const gravou = await tx.pedidoRemessaTerceiro.updateMany({
        where: { id, status: 'PENDENTE' },
        data: { status: 'RECUSADO', motivoRecusa: dados.motivo, usuarioId: req.usuario.id, respondidoEm: new Date() },
      });
      if (gravou.count !== 1) {
        await buscarPedido(tx, id);
        throw new HttpError(400, 'Este pedido já foi respondido');
      }
    });

    const atual = await dtosPedidos([await buscarPedido(prisma, id)]);
    res.json(atual[0]);
  })
);

// ---------- Portal público do terceiro (sem login, pelo código do link) ----------

// Código inexistente, terceiro inativo ou portal desligado: mesma resposta, sem detalhes.
async function terceiroDoCodigo(codigo: string) {
  const t = await prisma.terceiro.findUnique({
    where: { codigoAcesso: codigo },
    select: { id: true, nome: true, contato: true, ativo: true },
  });
  if (!t || !t.ativo) throw new HttpError(404, 'Link inválido ou desativado');
  return t;
}

function montaEndereco(l: { endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null }): string | null {
  const partes = [l.endereco, l.numero, l.bairro, l.cidade].map((v) => (v ?? '').trim()).filter((v) => v.length > 0);
  return partes.length > 0 ? partes.join(', ') : null;
}

publico.get(
  '/publico/remessa/:codigo',
  asyncHandler(async (req, res) => {
    const terceiro = await terceiroDoCodigo(String(req.params.codigo));
    const hoje = inicioDoDia();
    const [config, lojas, saldos, remessas, pedidos, produtos] = await Promise.all([
      lerConfiguracao(),
      prisma.loja.findMany({
        where: { ativa: true },
        orderBy: { id: 'asc' },
        select: { id: true, nome: true, endereco: true, numero: true, bairro: true, cidade: true },
      }),
      prisma.estoqueTerceiro.findMany({
        where: { terceiroId: terceiro.id, quantidade: { gt: 0 } },
        select: {
          quantidade: true,
          produto: { select: { id: true, nome: true, unidade: true, foto: true } },
        },
      }),
      prisma.remessaTerceiro.findMany({
        where: { terceiroId: terceiro.id, status: { in: ATIVAS } },
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        select: {
          numero: true,
          tipo: true,
          criadoEm: true,
          previsaoRetorno: true,
          _count: { select: { itens: true } },
        },
      }),
      prisma.pedidoRemessaTerceiro.findMany({
        where: { terceiroId: terceiro.id },
        orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
        take: 20,
        select: {
          id: true,
          numero: true,
          status: true,
          criadoEm: true,
          dataDesejada: true,
          motivoRecusa: true,
          remessaId: true,
          remessa: { select: { numero: true } },
          itens: {
            orderBy: { id: 'asc' },
            select: { produtoId: true, quantidade: true, produto: { select: { nome: true, unidade: true } } },
          },
        },
      }),
      prisma.produto.findMany({
        where: { ativo: true, insumo: false },
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          codigo: true,
          nome: true,
          unidade: true,
          foto: true,
          precoVenda: true,
          categoria: { select: { nome: true } },
        },
      }),
    ]);

    // Soma o que está com o terceiro por produto, de todas as lojas.
    const emPosse = new Map<number, { produtoId: number; nome: string; unidade: string; foto: string | null; quantidade: number }>();
    for (const s of saldos) {
      const atual = emPosse.get(s.produto.id) ?? {
        produtoId: s.produto.id,
        nome: s.produto.nome,
        unidade: s.produto.unidade,
        foto: s.produto.foto,
        quantidade: 0,
      };
      atual.quantidade = arred3(atual.quantidade + num(s.quantidade));
      emPosse.set(s.produto.id, atual);
    }

    const enviadasPublico = await quantidadesEnviadas(
      pedidos.map((p) => p.remessaId).filter((x): x is number => x !== null)
    );

    res.json({
      empresa: config.nome,
      terceiro: { nome: terceiro.nome, contato: terceiro.contato },
      lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, endereco: montaEndereco(l) })),
      emPosse: [...emPosse.values()],
      remessasAbertas: remessas.map((r) => ({
        numero: r.numero,
        tipo: r.tipo,
        criadoEm: r.criadoEm.toISOString(),
        previsaoRetorno: r.previsaoRetorno ? r.previsaoRetorno.toISOString() : null,
        atrasada: r.previsaoRetorno !== null && r.previsaoRetorno < hoje,
        itens: r._count.itens,
      })),
      pedidos: pedidos.map((p) => ({
        id: p.id,
        numero: p.numero,
        status: p.status,
        criadoEm: p.criadoEm.toISOString(),
        dataDesejada: dataDoDia(p.dataDesejada),
        motivoRecusa: p.motivoRecusa,
        remessaNumero: p.remessa?.numero ?? null,
        itens: p.itens.map((i) => ({
          nome: i.produto.nome,
          unidade: i.produto.unidade,
          quantidade: arred3(num(i.quantidade)),
          quantidadeEnviada:
            p.remessaId !== null ? (enviadasPublico.get(`${p.remessaId}-${i.produtoId}`) ?? 0) : null,
        })),
      })),
      produtos: produtos.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        unidade: p.unidade,
        foto: p.foto,
        categoria: p.categoria?.nome ?? null,
        preco: num(p.precoVenda),
      })),
    });
  })
);

const pedidoPublicoSchema = z.object({
  lojaId: z.number().int().positive('Escolha a loja'),
  tipo: z.enum(TIPOS, { message: 'Tipo inválido' }).optional(),
  dataDesejada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullish(),
  observacoes: z.string().trim().max(500, 'Observação muito longa').nullish(),
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        quantidade: z.number().positive('Quantidade inválida').max(100000, 'Quantidade muito alta'),
      })
    )
    .min(1, 'Inclua ao menos um item')
    .max(100, 'Itens demais no pedido')
    .refine((itens) => new Set(itens.map((i) => i.produtoId)).size === itens.length, 'Produto repetido no pedido'),
});

// O terceiro pede remessa. Não mexe no estoque: vira remessa só quando a loja aprovar.
publico.post(
  '/publico/remessa/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const terceiro = await terceiroDoCodigo(String(req.params.codigo));
    const dados = validar(pedidoPublicoSchema, req.body);

    const dataDesejada = dataLocal(dados.dataDesejada);
    if (dataDesejada && dataDesejada < inicioDoDia()) {
      throw new HttpError(400, 'A data desejada não pode ser antes de hoje');
    }

    const loja = await prisma.loja.findFirst({ where: { id: dados.lojaId, ativa: true }, select: { id: true } });
    if (!loja) throw new HttpError(400, 'Loja inválida');

    const ids = dados.itens.map((i) => i.produtoId);
    const validos = await prisma.produto.findMany({
      where: { id: { in: ids }, ativo: true, insumo: false },
      select: { id: true },
    });
    if (validos.length !== ids.length) throw new HttpError(400, 'Algum produto não está disponível para pedido');

    const aguardando = await prisma.pedidoRemessaTerceiro.count({
      where: { terceiroId: terceiro.id, status: 'PENDENTE' },
    });
    if (aguardando >= 5) throw new HttpError(400, 'Você já tem 5 pedidos aguardando. Aguarde a resposta da loja.');

    const pedido = await prisma.pedidoRemessaTerceiro.create({
      data: {
        terceiroId: terceiro.id,
        lojaId: loja.id,
        tipo: dados.tipo ?? 'CONSIGNACAO',
        status: 'PENDENTE',
        dataDesejada,
        observacoes: limpa(dados.observacoes) ?? null,
        itens: {
          create: dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: arred3(i.quantidade) })),
        },
      },
      select: { id: true, numero: true },
    });

    void notificarPerfis(['GESTOR', 'ESTOQUISTA'], {
      titulo: 'Pedido de remessa',
      corpo: `${terceiro.nome} pediu ${dados.itens.length} itens`,
      url: '/gestor/remessas-terceiro?aba=pedidos',
      marca: 'pedido-remessa',
    }).catch(() => {});

    res.status(201).json({ id: pedido.id, numero: pedido.numero });
  })
);

// O terceiro cancela o próprio pedido, enquanto estiver pendente.
publico.post(
  '/publico/remessa/:codigo/pedidos/:id/cancelar',
  asyncHandler(async (req, res) => {
    const terceiro = await terceiroDoCodigo(String(req.params.codigo));
    const id = idParam(req);
    const pedido = await prisma.pedidoRemessaTerceiro.findFirst({
      where: { id, terceiroId: terceiro.id },
      select: { id: true, status: true },
    });
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
    if (pedido.status !== 'PENDENTE') throw new HttpError(400, 'Só é possível cancelar um pedido pendente');
    const gravou = await prisma.pedidoRemessaTerceiro.updateMany({
      where: { id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
    if (gravou.count !== 1) throw new HttpError(400, 'Só é possível cancelar um pedido pendente');
    res.json({ ok: true });
  })
);
