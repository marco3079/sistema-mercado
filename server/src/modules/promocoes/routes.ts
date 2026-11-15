import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lojaDaRequisicao } from '../../lib/lojas';
import { lerConfiguracao } from '../../lib/email';
import { descreverPromocao } from '../../lib/precos';
import { arred2, arred3, num, numOuNull, periodoDaQuery, somarDias } from '../../lib/numeros';

// Promoções (preço promocional de produto ou categoria), bonificação da indústria (Scantech simulado)
// e sugestões automáticas de promoção para produtos com validade curta ou parados.

const router = Router();

const todos = permitir('GESTOR', 'OPERADOR', 'ESTOQUISTA', 'PADEIRO', 'COMPRADOR', 'MOTORISTA', 'VENDEDOR', 'CONTADOR');
const escrita = permitir('GESTOR', 'COMPRADOR');
const gestor = permitir('GESTOR');

const TIPOS = ['PRECO_FIXO', 'PERCENTUAL', 'LEVE_PAGUE', 'ATACADO'] as const;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

const promocaoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da promoção').max(120, 'Nome muito longo'),
  tipo: z.enum(TIPOS),
  produtoId: z.number().int().positive().nullable().optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  valor: z.number().min(0, 'O valor não pode ser negativo').max(99999999.99, 'Valor muito alto').nullable().optional(),
  levar: z.number().int().positive('Informe quantos levar').nullable().optional(),
  pagar: z.number().int().positive('Informe quantos pagar').nullable().optional(),
  qtdMinima: z.number().positive('A quantidade mínima precisa ser maior que zero').nullable().optional(),
  inicio: z.string().regex(DATA_RE, 'Use a data de início no formato AAAA-MM-DD'),
  fim: z.string().regex(DATA_RE, 'Use a data de fim no formato AAAA-MM-DD'),
  industria: z.string().trim().max(80, 'Nome da indústria muito longo').nullable().optional(),
  bonificacaoUnidade: z.number().min(0, 'A bonificação não pode ser negativa').max(99999999.99, 'Valor muito alto').nullable().optional(),
});

type PromocaoEntrada = z.infer<typeof promocaoSchema>;

const INCLUIR = {
  produto: { select: { nome: true, precoVenda: true, foto: true, categoria: { select: { nome: true } } } },
  categoria: { select: { nome: true } },
} as const;

type PromocaoLida = Prisma.PromocaoGetPayload<{ include: typeof INCLUIR }>;

function textoOuNull(texto: string | null | undefined): string | null {
  const limpo = (texto ?? '').trim();
  return limpo === '' ? null : limpo;
}

// Início do dia (AAAA-MM-DD) no horário do servidor.
function diaInicio(texto: string): Date {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d, 0, 0, 0, 0);
}

// Fim do dia (AAAA-MM-DD) no horário do servidor.
function diaFim(texto: string): Date {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d, 23, 59, 59, 999);
}

function dataBr(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Quantidades vendidas de cada promoção (só vendas concluídas, sem itens cancelados).
async function unidadesVendidas(ids: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (ids.length === 0) return mapa;
  const itens = await prisma.vendaItem.findMany({
    where: { promocaoId: { in: ids }, cancelado: false, venda: { status: 'CONCLUIDA' } },
    select: { promocaoId: true, quantidade: true },
  });
  for (const item of itens) {
    if (item.promocaoId === null) continue;
    mapa.set(item.promocaoId, arred3((mapa.get(item.promocaoId) ?? 0) + num(item.quantidade)));
  }
  return mapa;
}

// Até 4 fotos de produtos ativos de cada categoria (mosaico do cartão de promoção por categoria).
async function fotosDasCategorias(ids: number[]): Promise<Map<number, string[]>> {
  const mapa = new Map<number, string[]>();
  if (ids.length === 0) return mapa;
  const produtos = await prisma.produto.findMany({
    where: { categoriaId: { in: ids }, ativo: true, foto: { not: null } },
    select: { categoriaId: true, foto: true },
    orderBy: { nome: 'asc' },
  });
  for (const produto of produtos) {
    if (produto.categoriaId === null || !produto.foto) continue;
    const lista = mapa.get(produto.categoriaId) ?? [];
    if (lista.length < 4) {
      lista.push(produto.foto);
      mapa.set(produto.categoriaId, lista);
    }
  }
  return mapa;
}

// Preço promocional por unidade: preço fixo, ou preço normal com o desconto em %. Outros tipos: null.
function precoPromocionalDe(tipo: TipoPromocao, valor: number, precoNormal: number | null): number | null {
  if (tipo === 'PRECO_FIXO') return arred2(valor);
  if (tipo === 'PERCENTUAL' && precoNormal !== null) return arred2(precoNormal * (1 - valor / 100));
  return null;
}

// Converte as promoções para a resposta, já com fotos e setor (nome da categoria) de cada uma.
async function paraPromocoesDTO(lista: PromocaoLida[], unidades: Map<number, number>) {
  const categoriaIds = [...new Set(lista.map((p) => p.categoriaId).filter((id): id is number => id !== null))];
  const fotosPorCategoria = await fotosDasCategorias(categoriaIds);
  return lista.map((p) =>
    paraPromocaoDTO(p, unidades.get(p.id) ?? 0, p.categoriaId !== null ? (fotosPorCategoria.get(p.categoriaId) ?? []) : []),
  );
}

type TipoPromocao = (typeof TIPOS)[number];

function paraPromocaoDTO(p: PromocaoLida, unidades: number, fotos: string[]) {
  const precoNormal = p.produto ? num(p.produto.precoVenda) : null;
  return {
    id: p.id,
    nome: p.nome,
    tipo: p.tipo,
    produtoId: p.produtoId,
    produto: p.produto?.nome ?? null,
    categoriaId: p.categoriaId,
    categoria: p.categoria?.nome ?? null,
    valor: num(p.valor),
    levar: p.levar,
    pagar: p.pagar,
    qtdMinima: numOuNull(p.qtdMinima),
    inicio: p.inicio.toISOString(),
    fim: p.fim.toISOString(),
    ativa: p.ativa,
    industria: p.industria,
    bonificacaoUnidade: numOuNull(p.bonificacaoUnidade),
    descricao: descreverPromocao(p),
    precoNormal,
    precoPromocional: precoPromocionalDe(p.tipo, num(p.valor), precoNormal),
    foto: p.produto?.foto ?? null,
    fotos,
    setor: p.produto?.categoria?.nome ?? p.categoria?.nome ?? null,
    unidadesVendidas: unidades,
  };
}

// Regras da promoção, valendo para criar e para editar.
async function conferirPromocao(d: PromocaoEntrada): Promise<void> {
  const temProduto = d.produtoId !== null && d.produtoId !== undefined;
  const temCategoria = d.categoriaId !== null && d.categoriaId !== undefined;
  if (temProduto === temCategoria) {
    throw new HttpError(400, 'Escolha um produto ou uma categoria, só um dos dois');
  }
  // Datas AAAA-MM-DD: início 00:00 e fim 23:59:59 do dia (ver diaInicio/diaFim). Mesmo dia = promoção de um dia.
  if (d.inicio > d.fim) throw new HttpError(400, 'A data de início não pode ser depois da data de fim');

  const valor = d.valor ?? 0;
  if (d.tipo === 'PERCENTUAL') {
    if (!(valor > 0 && valor < 100)) throw new HttpError(400, 'O percentual vai de 0 a 100, sem incluir os limites');
  } else if (d.tipo === 'PRECO_FIXO') {
    if (valor <= 0) throw new HttpError(400, 'Informe o preço promocional');
  } else if (d.tipo === 'ATACADO') {
    if (valor <= 0) throw new HttpError(400, 'Informe o preço do atacado');
    if (!d.qtdMinima) throw new HttpError(400, 'Informe a quantidade mínima do atacado');
  } else {
    const levar = d.levar ?? 0;
    const pagar = d.pagar ?? 0;
    if (!(levar > pagar && pagar > 0)) {
      throw new HttpError(400, 'Leve X pague Y: X precisa ser maior que Y, e Y maior que zero');
    }
  }

  if (d.produtoId) {
    const produto = await prisma.produto.findUnique({ where: { id: d.produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(400, 'Produto não encontrado');
  }
  if (d.categoriaId) {
    const categoria = await prisma.categoria.findUnique({ where: { id: d.categoriaId }, select: { id: true } });
    if (!categoria) throw new HttpError(400, 'Categoria não encontrada');
  }
}

// Campos gravados: os que não se aplicam ao tipo ficam nulos (LEVE_PAGUE sem preço, ATACADO sem levar/pagar).
function dadosDaPromocao(d: PromocaoEntrada) {
  const leve = d.tipo === 'LEVE_PAGUE';
  const atacado = d.tipo === 'ATACADO';
  return {
    nome: d.nome,
    tipo: d.tipo,
    produtoId: d.produtoId ?? null,
    categoriaId: d.categoriaId ?? null,
    valor: leve ? 0 : arred2(d.valor ?? 0),
    levar: leve ? (d.levar ?? null) : null,
    pagar: leve ? (d.pagar ?? null) : null,
    qtdMinima: atacado ? (d.qtdMinima ?? null) : null,
    inicio: diaInicio(d.inicio),
    fim: diaFim(d.fim),
    industria: textoOuNull(d.industria),
    bonificacaoUnidade: d.bonificacaoUnidade !== null && d.bonificacaoUnidade !== undefined ? arred2(d.bonificacaoUnidade) : null,
  };
}

// ---------- Listagem e cadastro ----------

router.get(
  '/promocoes',
  todos,
  asyncHandler(async (req, res) => {
    const agora = new Date();
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const vigentes = req.query.vigentes === '1';

    let filtro: Prisma.PromocaoWhereInput = {};
    if (status === 'agendadas') {
      filtro = { ativa: true, inicio: { gt: agora } };
    } else if (status === 'encerradas') {
      filtro = { OR: [{ ativa: false }, { fim: { lt: agora } }] };
    } else if (status === 'ativas' || vigentes) {
      filtro = { ativa: true, inicio: { lte: agora }, fim: { gte: agora } };
    }

    const lista = await prisma.promocao.findMany({
      where: filtro,
      include: INCLUIR,
      orderBy: [{ inicio: 'desc' }, { id: 'desc' }],
    });
    const unidades = await unidadesVendidas(lista.map((p) => p.id));
    res.json(await paraPromocoesDTO(lista, unidades));
  })
);

router.post(
  '/promocoes',
  escrita,
  asyncHandler(async (req, res) => {
    const dados = validar(promocaoSchema, req.body);
    await conferirPromocao(dados);
    const criada = await prisma.promocao.create({ data: { ...dadosDaPromocao(dados), ativa: true }, include: INCLUIR });
    const [dto] = await paraPromocoesDTO([criada], new Map());
    res.status(201).json(dto);
  })
);

router.put(
  '/promocoes/:id',
  escrita,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(promocaoSchema, req.body);
    const atual = await prisma.promocao.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Promoção não encontrada');
    await conferirPromocao(dados);
    const alterada = await prisma.promocao.update({ where: { id }, data: dadosDaPromocao(dados), include: INCLUIR });
    const unidades = await unidadesVendidas([id]);
    const [dto] = await paraPromocoesDTO([alterada], unidades);
    res.json(dto);
  })
);

router.delete(
  '/promocoes/:id',
  escrita,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.promocao.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Promoção não encontrada');
    const vendida = await prisma.vendaItem.count({ where: { promocaoId: id } });
    if (vendida > 0) throw new HttpError(409, 'Encerre a promoção em vez de excluir');
    await prisma.promocao.delete({ where: { id } });
    res.status(204).end();
  })
);

// Encerra agora: a data de fim vira o momento atual (nunca estende uma promoção já vencida).
router.post(
  '/promocoes/:id/encerrar',
  escrita,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.promocao.findUnique({ where: { id }, select: { id: true, inicio: true, fim: true } });
    if (!atual) throw new HttpError(404, 'Promoção não encontrada');
    const agora = new Date();
    if (atual.inicio > agora) throw new HttpError(409, 'A promoção ainda não começou: exclua em vez de encerrar');
    const fim = atual.fim < agora ? atual.fim : agora;
    const encerrada = await prisma.promocao.update({ where: { id }, data: { fim }, include: INCLUIR });
    const unidades = await unidadesVendidas([id]);
    const [dto] = await paraPromocoesDTO([encerrada], unidades);
    res.json(dto);
  })
);

// ---------- Bonificação da indústria (Scantech simulado) ----------

// Promoções com indústria que se sobrepõem ao período, com as unidades vendidas dentro dele.
async function bonificacoesDoPeriodo(inicio: Date, fim: Date, industria?: string) {
  const promocoes = await prisma.promocao.findMany({
    where: {
      industria: industria ? { equals: industria } : { not: null },
      inicio: { lte: fim },
      fim: { gte: inicio },
    },
    include: INCLUIR,
    orderBy: [{ industria: 'asc' }, { nome: 'asc' }],
  });
  const itensVendidos = await prisma.vendaItem.findMany({
    where: {
      promocaoId: { in: promocoes.map((p) => p.id) },
      cancelado: false,
      venda: { status: 'CONCLUIDA', criadoEm: { gte: inicio, lte: fim } },
    },
    select: { promocaoId: true, quantidade: true },
  });
  const unidades = new Map<number, number>();
  for (const item of itensVendidos) {
    if (item.promocaoId === null) continue;
    unidades.set(item.promocaoId, arred3((unidades.get(item.promocaoId) ?? 0) + num(item.quantidade)));
  }
  const itens = promocoes.map((p) => {
    const unidadesVendidas = unidades.get(p.id) ?? 0;
    const bonificacaoUnidade = num(p.bonificacaoUnidade);
    return {
      promocaoId: p.id,
      nome: p.nome,
      industria: p.industria ?? '',
      unidadesVendidas,
      bonificacaoUnidade,
      valorAReceber: arred2(unidadesVendidas * bonificacaoUnidade),
    };
  });
  return { itens, total: arred2(itens.reduce((soma, i) => soma + i.valorAReceber, 0)) };
}

router.get(
  '/promocoes/bonificacoes',
  gestor,
  asyncHandler(async (req, res) => {
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const { itens, total } = await bonificacoesDoPeriodo(inicio, fim);
    const config = await lerConfiguracao();
    res.json({
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      itens,
      total,
      simulado: !config.scantechAtivo,
    });
  })
);

const lancarSchema = z.object({
  inicio: z.string().regex(DATA_RE, 'Use a data de início no formato AAAA-MM-DD'),
  fim: z.string().regex(DATA_RE, 'Use a data de fim no formato AAAA-MM-DD'),
  industria: z.string().trim().min(1, 'Informe a indústria').max(80, 'Nome da indústria muito longo'),
});

// Lança a bonificação a receber como RECEITA no financeiro, com vencimento em 30 dias.
router.post(
  '/promocoes/bonificacoes/lancar',
  gestor,
  asyncHandler(async (req, res) => {
    const dados = validar(lancarSchema, req.body);
    const inicio = diaInicio(dados.inicio);
    const fim = diaFim(dados.fim);
    if (inicio > fim) throw new HttpError(400, 'A data de início precisa ser antes da data de fim');

    const { itens, total } = await bonificacoesDoPeriodo(inicio, fim, dados.industria);
    if (total <= 0) throw new HttpError(400, 'Não há bonificação a receber neste período');

    const descricao = `Bonificação ${dados.industria} ${dataBr(inicio)} a ${dataBr(fim)}`;
    const jaLancado = await prisma.lancamento.findFirst({
      where: { origem: 'BONIFICACAO', descricao },
      select: { id: true },
    });
    if (jaLancado) throw new HttpError(409, 'Bonificação deste período já lançada');

    const config = await lerConfiguracao();
    const categoria = await prisma.categoriaFinanceira.findFirst({
      where: { nome: 'Bonificação da indústria' },
      select: { id: true },
    });
    const lancamento = await prisma.lancamento.create({
      data: {
        tipo: 'RECEITA',
        origem: 'BONIFICACAO',
        descricao,
        valor: total,
        vencimento: somarDias(new Date(), 30),
        categoriaId: categoria?.id ?? null,
        referencia: `bonificacao:${dados.industria}:${dados.inicio}:${dados.fim}`,
        observacao: `${itens.length} promoção(ões) da indústria ${dados.industria}`,
      },
    });
    res.status(201).json({
      lancamentoId: lancamento.id,
      industria: dados.industria,
      valor: total,
      descricao: lancamento.descricao,
      simulado: !config.scantechAtivo,
    });
  })
);

// ---------- Promoções inteligentes ----------

// Sugestões (não grava): lote que vence em até 5 dias com saldo na loja (30% até a validade)
// e produto parado (sem venda há 30 dias, com saldo; 15% por 7 dias). Quem cria é o POST /promocoes.
router.post(
  '/promocoes/sugerir',
  gestor,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const agora = new Date();
    const emCincoDias = somarDias(agora, 5);

    const lotes = await prisma.lote.findMany({
      where: {
        lojaId,
        quantidade: { gt: 0 },
        validade: { gt: agora, lte: emCincoDias },
        produto: { ativo: true },
      },
      include: { produto: { select: { id: true, nome: true } } },
      orderBy: { validade: 'asc' },
    });
    const saldos = await prisma.estoqueLoja.findMany({
      where: { lojaId, produtoId: { in: lotes.map((l) => l.produtoId) }, quantidade: { gt: 0 } },
      select: { produtoId: true },
    });
    const comSaldo = new Set(saldos.map((e) => e.produtoId));

    const sugestoes: {
      produtoId: number;
      produto: string;
      motivo: string;
      tipo: 'PERCENTUAL' | 'PRECO_FIXO' | 'LEVE_PAGUE' | 'ATACADO';
      valor: number;
      inicio: string;
      fim: string;
    }[] = [];
    const jaSugeridos = new Set<number>();
    for (const lote of lotes) {
      if (!comSaldo.has(lote.produtoId) || jaSugeridos.has(lote.produtoId)) continue;
      jaSugeridos.add(lote.produtoId);
      const dias = Math.max(1, Math.ceil((lote.validade.getTime() - agora.getTime()) / 86400000));
      sugestoes.push({
        produtoId: lote.produtoId,
        produto: lote.produto.nome,
        motivo: `Lote vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
        tipo: 'PERCENTUAL',
        valor: 30,
        inicio: agora.toISOString(),
        fim: lote.validade.toISOString(),
      });
    }

    const trintaDiasAtras = somarDias(agora, -30);
    const comEstoque = await prisma.estoqueLoja.findMany({
      where: { lojaId, quantidade: { gt: 0 }, produto: { ativo: true } },
      select: { produtoId: true, produto: { select: { nome: true } } },
    });
    const candidatos = comEstoque.filter((e) => !jaSugeridos.has(e.produtoId));
    const vendidos = new Set(
      (
        await prisma.vendaItem.findMany({
          where: {
            produtoId: { in: candidatos.map((e) => e.produtoId) },
            cancelado: false,
            venda: { lojaId, status: 'CONCLUIDA', criadoEm: { gte: trintaDiasAtras } },
          },
          select: { produtoId: true },
          distinct: ['produtoId'],
        })
      ).map((i) => i.produtoId),
    );
    for (const e of candidatos) {
      if (vendidos.has(e.produtoId)) continue;
      jaSugeridos.add(e.produtoId);
      sugestoes.push({
        produtoId: e.produtoId,
        produto: e.produto.nome,
        motivo: 'Sem venda há 30 dias',
        tipo: 'PERCENTUAL',
        valor: 15,
        inicio: agora.toISOString(),
        fim: somarDias(agora, 7).toISOString(),
      });
    }

    res.json(sugestoes);
  })
);

export default router;
