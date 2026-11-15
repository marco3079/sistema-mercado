import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, TipoMovimentoEstoque } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { lojaDaRequisicao } from '../../lib/lojas';
import { movimentarEstoque, saldoDe } from '../../lib/estoque';
import { arred2, arred3, num, numOuNull, periodoDaQuery, inicioDoDia } from '../../lib/numeros';

// Estoque da loja: saldos, movimentos, perdas, validade/lotes e inventário.
// Toda mudança de estoque passa por movimentarEstoque (lib/estoque), dentro de transação.

const router = Router();

const LIMITE = 999999999;
const DIA_MS = 24 * 60 * 60 * 1000;

const MOTIVOS_PERDA = {
  VENCIDO: 'Vencido',
  AVARIA: 'Avaria',
  QUEBRA: 'Quebra',
  FURTO: 'Furto',
  CONSUMO_INTERNO: 'Consumo interno',
  OUTRO: 'Outro',
} as const;

const motivoPerdaSchema = z.enum(['VENCIDO', 'AVARIA', 'QUEBRA', 'FURTO', 'CONSUMO_INTERNO', 'OUTRO'], {
  message: 'Motivo inválido',
});

const TIPOS_MOVIMENTO: TipoMovimentoEstoque[] = [
  'ENTRADA',
  'VENDA',
  'CANCELAMENTO_VENDA',
  'AJUSTE',
  'PERDA',
  'PRODUCAO',
  'CONSUMO_PRODUCAO',
  'TRANSFERENCIA_SAIDA',
  'TRANSFERENCIA_ENTRADA',
  'INVENTARIO',
];

// Data AAAA-MM-DD como meia-noite local. null se inválida.
function dataDoIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const data = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (data.getFullYear() !== Number(m[1]) || data.getMonth() !== Number(m[2]) - 1) return null;
  return data;
}

// Dias entre hoje e a data (negativo = já passou).
function diasRestantesDe(data: Date): number {
  return Math.round((inicioDoDia(data).getTime() - inicioDoDia(new Date()).getTime()) / DIA_MS);
}

type SituacaoEstoque = 'negativo' | 'zerado' | 'abaixo_minimo' | 'ok';

function situacaoDe(quantidade: number, minimo: number): SituacaoEstoque {
  if (quantidade < 0) return 'negativo';
  if (quantidade === 0) return 'zerado';
  if (minimo > 0 && quantidade < minimo) return 'abaixo_minimo';
  return 'ok';
}

// ---------- Saldos ----------

router.get(
  '/estoque',
  permitir('GESTOR', 'ESTOQUISTA', 'COMPRADOR', 'PADEIRO'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().toLowerCase() : '';
    const categoriaId = Number(req.query.categoriaId);
    const situacao = typeof req.query.situacao === 'string' ? req.query.situacao : '';

    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: {
        id: true,
        codigo: true,
        ean: true,
        nome: true,
        unidade: true,
        categoriaId: true,
        precoCusto: true,
        estoqueMinimo: true,
        estoqueMaximo: true,
        categoria: { select: { nome: true } },
        estoques: { where: { lojaId }, select: { quantidade: true } },
      },
    });

    const todas = produtos.map((p) => {
      const quantidade = arred3(num(p.estoques[0]?.quantidade));
      const minimo = num(p.estoqueMinimo);
      const custo = num(p.precoCusto);
      return {
        produtoId: p.id,
        codigo: p.codigo,
        ean: p.ean,
        nome: p.nome,
        unidade: p.unidade,
        categoriaId: p.categoriaId,
        categoria: p.categoria?.nome ?? null,
        quantidade,
        estoqueMinimo: minimo,
        estoqueMaximo: numOuNull(p.estoqueMaximo),
        precoCusto: custo,
        valorEstoque: arred2(Math.max(0, quantidade) * custo),
        situacao: situacaoDe(quantidade, minimo),
      };
    });

    const filtradas = todas.filter((item) => {
      if (busca && !`${item.nome} ${item.codigo} ${item.ean ?? ''}`.toLowerCase().includes(busca)) return false;
      if (Number.isInteger(categoriaId) && categoriaId > 0 && item.categoriaId !== categoriaId) return false;
      if (situacao === 'abaixo_minimo') return item.quantidade < item.estoqueMinimo && item.estoqueMinimo > 0;
      if (situacao === 'zerado') return item.quantidade === 0;
      if (situacao === 'negativo') return item.quantidade < 0;
      return true;
    });

    const somaValor = (lista: typeof todas) => arred2(lista.reduce((soma, item) => soma + item.valorEstoque, 0));
    res.json({
      itens: filtradas,
      total: filtradas.length,
      valorTotal: somaValor(filtradas),
      resumo: {
        valorTotal: somaValor(todas),
        abaixoMinimo: todas.filter((i) => i.quantidade < i.estoqueMinimo && i.estoqueMinimo > 0).length,
        zerados: todas.filter((i) => i.quantidade === 0).length,
        negativos: todas.filter((i) => i.quantidade < 0).length,
      },
    });
  })
);

// ---------- Movimentos ----------

router.get(
  '/estoque/movimentos',
  permitir('GESTOR', 'ESTOQUISTA', 'COMPRADOR'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const where: Prisma.MovimentoEstoqueWhereInput = { lojaId, criadoEm: { gte: inicio, lte: fim } };

    const produtoId = Number(req.query.produtoId);
    if (Number.isInteger(produtoId) && produtoId > 0) where.produtoId = produtoId;
    const tipo = req.query.tipo;
    if (typeof tipo === 'string' && (TIPOS_MOVIMENTO as string[]).includes(tipo)) {
      where.tipo = tipo as TipoMovimentoEstoque;
    }

    const movimentos = await prisma.movimentoEstoque.findMany({
      where,
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 500,
      include: {
        produto: { select: { nome: true, unidade: true } },
        usuario: { select: { nome: true } },
      },
    });

    res.json(
      movimentos.map((m) => ({
        id: m.id,
        criadoEm: m.criadoEm.toISOString(),
        produtoId: m.produtoId,
        produto: m.produto.nome,
        unidade: m.produto.unidade,
        tipo: m.tipo,
        quantidade: num(m.quantidade),
        saldoApos: num(m.saldoApos),
        custoUnitario: numOuNull(m.custoUnitario),
        motivo: m.motivo,
        referencia: m.referencia,
        usuario: m.usuario?.nome ?? null,
      }))
    );
  })
);

// Ajuste: informa o saldo contado (quantidadeNova) ou a diferença (quantidade).
const ajusteSchema = z
  .object({
    produtoId: z.number().int('Produto inválido').positive('Produto inválido'),
    quantidadeNova: z.number().min(0, 'Saldo inválido').max(LIMITE, 'Saldo inválido').optional(),
    quantidade: z.number().min(-LIMITE, 'Quantidade inválida').max(LIMITE, 'Quantidade inválida').optional(),
    motivo: z.string().trim().min(1, 'Informe o motivo').max(120, 'Motivo muito longo'),
  })
  .refine((d) => (d.quantidadeNova !== undefined) !== (d.quantidade !== undefined), {
    message: 'Informe o saldo contado ou a diferença',
  });

router.post(
  '/estoque/ajuste',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(ajusteSchema, req.body);
    await exigirAcao(req, 'AJUSTE_ESTOQUE');
    const lojaId = await lojaDaRequisicao(req);

    const saldo = await prisma.$transaction(async (tx) => {
      const produto = await tx.produto.findUnique({ where: { id: dados.produtoId }, select: { id: true } });
      if (!produto) throw new HttpError(404, 'Produto não encontrado');
      const atual = await saldoDe(dados.produtoId, lojaId, tx);
      const delta = arred3(dados.quantidadeNova !== undefined ? dados.quantidadeNova - atual : (dados.quantidade ?? 0));
      if (delta === 0) throw new HttpError(400, 'O saldo já está igual ao informado');
      const resultado = await movimentarEstoque(tx, {
        produtoId: dados.produtoId,
        lojaId,
        tipo: 'AJUSTE',
        quantidade: delta,
        motivo: dados.motivo,
        usuarioId: req.usuario.id,
      });
      return resultado.saldoApos;
    });

    res.json({ saldo });
  })
);

const perdaSchema = z.object({
  produtoId: z.number().int('Produto inválido').positive('Produto inválido'),
  quantidade: z.number().positive('Informe a quantidade').max(LIMITE, 'Quantidade inválida'),
  motivo: motivoPerdaSchema,
  observacao: z.string().trim().max(200, 'Observação muito longa').optional(),
});

router.post(
  '/estoque/perda',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(perdaSchema, req.body);
    await exigirAcao(req, 'AJUSTE_ESTOQUE');
    const lojaId = await lojaDaRequisicao(req);
    const quantidade = arred3(dados.quantidade);
    const texto = MOTIVOS_PERDA[dados.motivo] + (dados.observacao ? `: ${dados.observacao}` : '');

    const saldo = await prisma.$transaction(async (tx) => {
      const produto = await tx.produto.findUnique({ where: { id: dados.produtoId }, select: { precoCusto: true } });
      if (!produto) throw new HttpError(404, 'Produto não encontrado');
      const resultado = await movimentarEstoque(tx, {
        produtoId: dados.produtoId,
        lojaId,
        tipo: 'PERDA',
        quantidade: -quantidade,
        custoUnitario: num(produto.precoCusto),
        motivo: texto,
        usuarioId: req.usuario.id,
      });
      return resultado.saldoApos;
    });

    res.status(201).json({ saldo });
  })
);

// Relatório de perdas no período (padrão: 30 dias).
router.get(
  '/estoque/perdas',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const perdas = await prisma.movimentoEstoque.findMany({
      where: { lojaId, tipo: 'PERDA', criadoEm: { gte: inicio, lte: fim } },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      include: { produto: { select: { nome: true, unidade: true } } },
    });

    const itens = perdas.map((p) => {
      const quantidade = arred3(Math.abs(num(p.quantidade)));
      return {
        data: p.criadoEm.toISOString(),
        produto: p.produto.nome,
        quantidade,
        unidade: p.produto.unidade,
        motivo: p.motivo ?? '',
        valor: arred2(quantidade * num(p.custoUnitario)),
      };
    });

    // Motivo agrupado pelo texto antes dos dois-pontos ("Vencido: caixa molhada" -> "Vencido").
    const porMotivoMapa = new Map<string, number>();
    for (const item of itens) {
      const chave = item.motivo.split(':')[0].trim() || 'Outro';
      porMotivoMapa.set(chave, (porMotivoMapa.get(chave) ?? 0) + item.valor);
    }

    res.json({
      itens,
      totalValor: arred2(itens.reduce((soma, item) => soma + item.valor, 0)),
      porMotivo: [...porMotivoMapa]
        .map(([motivo, valor]) => ({ motivo, valor: arred2(valor) }))
        .sort((a, b) => b.valor - a.valor),
    });
  })
);

// ---------- Validade e lotes ----------

router.get(
  '/validade',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const bruto = Number(req.query.dias ?? 7);
    const dias = Number.isFinite(bruto) ? Math.min(365, Math.max(0, Math.trunc(bruto))) : 7;

    const lotes = await prisma.lote.findMany({
      where: { lojaId, quantidade: { gt: 0 } },
      orderBy: [{ validade: 'asc' }, { id: 'asc' }],
      include: { produto: { select: { nome: true, unidade: true, precoCusto: true } } },
    });

    const linhas = lotes.map((l) => {
      const quantidade = arred3(num(l.quantidade));
      return {
        id: l.id,
        produtoId: l.produtoId,
        produto: l.produto.nome,
        codigo: l.codigo,
        validade: l.validade.toISOString(),
        quantidade,
        unidade: l.produto.unidade,
        diasRestantes: diasRestantesDe(l.validade),
        valorCusto: arred2(quantidade * num(l.produto.precoCusto)),
      };
    });

    res.json({
      vencidos: linhas.filter((l) => l.diasRestantes < 0),
      vencendo: linhas.filter((l) => l.diasRestantes >= 0 && l.diasRestantes <= dias),
    });
  })
);

// Cadastra lote de mercadoria que já está em estoque, sem movimentar o saldo.
const loteSchema = z.object({
  produtoId: z.number().int('Produto inválido').positive('Produto inválido'),
  codigo: z.string().trim().min(1, 'Informe o código do lote').max(40, 'Código muito longo'),
  validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD'),
  quantidade: z.number().positive('Informe a quantidade').max(LIMITE, 'Quantidade inválida'),
});

router.post(
  '/lotes',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(loteSchema, req.body);
    const validade = dataDoIso(dados.validade);
    if (!validade) throw new HttpError(400, 'Data de validade inválida');
    const lojaId = await lojaDaRequisicao(req);

    const produto = await prisma.produto.findUnique({ where: { id: dados.produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(404, 'Produto não encontrado');

    const lote = await prisma.lote.create({
      data: {
        produtoId: dados.produtoId,
        lojaId,
        codigo: dados.codigo,
        validade,
        quantidade: arred3(dados.quantidade),
      },
    });
    res.status(201).json({ id: lote.id });
  })
);

// Dá baixa no saldo do lote como perda. Para o FEFO pegar ESTE lote primeiro, a validade dele
// vai para a data mínima só durante a baixa; depois volta à original. Tudo na mesma transação.
const baixaLoteSchema = z.object({
  motivo: motivoPerdaSchema.optional(),
});

router.post(
  '/lotes/:id/baixar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(baixaLoteSchema, req.body ?? {});
    await exigirAcao(req, 'AJUSTE_ESTOQUE');
    const lojaId = await lojaDaRequisicao(req);
    const motivo = dados.motivo ?? 'VENCIDO';

    await prisma.$transaction(
      async (tx) => {
        const lote = await tx.lote.findFirst({ where: { id, lojaId } });
        if (!lote) throw new HttpError(404, 'Lote não encontrado');
        const saldoLote = arred3(num(lote.quantidade));
        if (saldoLote <= 0) throw new HttpError(409, 'Este lote já não tem saldo');

        // Validade provisória mínima: o FEFO consome primeiro este lote e a soma dos lotes bate com o saldo.
        const validadeOriginal = lote.validade;
        await tx.lote.update({ where: { id: lote.id }, data: { validade: new Date(0) } });

        const produto = await tx.produto.findUniqueOrThrow({
          where: { id: lote.produtoId },
          select: { precoCusto: true },
        });
        await movimentarEstoque(tx, {
          produtoId: lote.produtoId,
          lojaId,
          tipo: 'PERDA',
          quantidade: -saldoLote,
          custoUnitario: num(produto.precoCusto),
          motivo: `${MOTIVOS_PERDA[motivo]}: lote ${lote.codigo}`,
          usuarioId: req.usuario.id,
        });

        await tx.lote.update({ where: { id: lote.id }, data: { validade: validadeOriginal } });
        const depois = await tx.lote.findUniqueOrThrow({ where: { id: lote.id } });
        if (arred3(num(depois.quantidade)) !== 0) {
          throw new HttpError(409, 'Não foi possível zerar o lote. Nada foi alterado.');
        }
      },
      { timeout: 30000 }
    );

    res.json({ ok: true });
  })
);

// ---------- Inventário ----------

const LIMITE_ITENS = 10000;

async function nomesDeCategorias(ids: (number | null)[]): Promise<Map<number, string>> {
  const validos = [...new Set(ids.filter((v): v is number => v !== null))];
  if (validos.length === 0) return new Map();
  const categorias = await prisma.categoria.findMany({ where: { id: { in: validos } }, select: { id: true, nome: true } });
  return new Map(categorias.map((c) => [c.id, c.nome]));
}

interface ItemComProduto {
  id: number;
  produtoId: number;
  quantidadeSistema: Prisma.Decimal;
  quantidadeContada: Prisma.Decimal | null;
  contadoEm: Date | null;
  produto: { codigo: string; ean: string | null; nome: string; unidade: string; precoCusto: Prisma.Decimal };
}

function itemDoInventario(item: ItemComProduto) {
  const sistema = arred3(num(item.quantidadeSistema));
  const contada = item.quantidadeContada === null ? null : arred3(num(item.quantidadeContada));
  const diferenca = contada === null ? null : arred3(contada - sistema);
  return {
    id: item.id,
    produtoId: item.produtoId,
    codigo: item.produto.codigo,
    ean: item.produto.ean,
    nome: item.produto.nome,
    unidade: item.produto.unidade,
    quantidadeSistema: sistema,
    quantidadeContada: contada,
    diferenca,
    valorDiferenca: diferenca === null ? 0 : arred2(diferenca * num(item.produto.precoCusto)),
    contadoEm: item.contadoEm ? item.contadoEm.toISOString() : null,
  };
}

router.get(
  '/inventarios',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const inventarios = await prisma.inventario.findMany({
      where: { lojaId },
      orderBy: { criadoEm: 'desc' },
      include: { itens: { select: { quantidadeSistema: true, quantidadeContada: true } } },
    });
    const categorias = await nomesDeCategorias(inventarios.map((i) => i.categoriaId));

    res.json(
      inventarios.map((inv) => {
        const contados = inv.itens.filter((i) => i.quantidadeContada !== null);
        return {
          id: inv.id,
          descricao: inv.descricao,
          status: inv.status,
          categoria: inv.categoriaId ? categorias.get(inv.categoriaId) ?? null : null,
          criadoEm: inv.criadoEm.toISOString(),
          finalizadoEm: inv.finalizadoEm ? inv.finalizadoEm.toISOString() : null,
          totalItens: inv.itens.length,
          contados: contados.length,
          divergencias: contados.filter((i) => arred3(num(i.quantidadeContada) - num(i.quantidadeSistema)) !== 0).length,
        };
      })
    );
  })
);

const inventarioSchema = z.object({
  descricao: z.string().trim().min(1, 'Informe a descrição').max(80, 'Descrição muito longa'),
  categoriaId: z.number().int().positive().nullable().optional(),
});

// Cria o inventário com um item por produto ativo (da categoria, se informada) e o saldo atual como "sistema".
router.post(
  '/inventarios',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(inventarioSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const categoriaId = dados.categoriaId ?? null;

    if (categoriaId !== null) {
      const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId }, select: { id: true } });
      if (!categoria) throw new HttpError(404, 'Categoria não encontrada');
    }

    const produtos = await prisma.produto.findMany({
      where: { ativo: true, ...(categoriaId !== null ? { categoriaId } : {}) },
      orderBy: { nome: 'asc' },
      take: LIMITE_ITENS,
      select: { id: true, estoques: { where: { lojaId }, select: { quantidade: true } } },
    });
    if (produtos.length === 0) throw new HttpError(400, 'Nenhum produto ativo para contar');

    const inventario = await prisma.inventario.create({
      data: {
        lojaId,
        descricao: dados.descricao,
        categoriaId,
        usuarioId: req.usuario.id,
        itens: {
          create: produtos.map((p) => ({
            produtoId: p.id,
            quantidadeSistema: arred3(num(p.estoques[0]?.quantidade)),
          })),
        },
      },
    });
    res.status(201).json({ id: inventario.id });
  })
);

router.get(
  '/inventarios/:id',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);
    const inv = await prisma.inventario.findFirst({
      where: { id, lojaId },
      include: {
        itens: {
          include: { produto: { select: { codigo: true, ean: true, nome: true, unidade: true, precoCusto: true } } },
        },
      },
    });
    if (!inv) throw new HttpError(404, 'Inventário não encontrado');
    const categorias = await nomesDeCategorias([inv.categoriaId]);

    const itens = inv.itens.map(itemDoInventario).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json({
      id: inv.id,
      descricao: inv.descricao,
      status: inv.status,
      categoria: inv.categoriaId ? categorias.get(inv.categoriaId) ?? null : null,
      criadoEm: inv.criadoEm.toISOString(),
      finalizadoEm: inv.finalizadoEm ? inv.finalizadoEm.toISOString() : null,
      itens,
    });
  })
);

const contagemSchema = z
  .object({
    produtoId: z.number().int().positive().optional(),
    codigo: z.string().trim().min(1, 'Informe o código').max(60, 'Código muito longo').optional(),
    quantidade: z.number().min(0, 'Quantidade inválida').max(LIMITE, 'Quantidade inválida'),
    somar: z.boolean().optional(),
  })
  .refine((d) => d.produtoId !== undefined || d.codigo !== undefined, {
    message: 'Informe o produto ou o código',
  });

// Registra a contagem. Com somar=true, soma ao que já foi contado (uma bipagem por vez).
router.put(
  '/inventarios/:id/contagem',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(contagemSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);

    const item = await prisma.$transaction(async (tx) => {
      const inv = await tx.inventario.findFirst({ where: { id, lojaId }, select: { status: true } });
      if (!inv) throw new HttpError(404, 'Inventário não encontrado');
      if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi encerrado');

      let produtoId = dados.produtoId;
      if (produtoId === undefined) {
        const codigo = dados.codigo ?? '';
        const produto = await tx.produto.findFirst({
          where: { OR: [{ ean: codigo }, { codigo }] },
          select: { id: true },
        });
        if (!produto) throw new HttpError(404, 'Produto não encontrado pelo código');
        produtoId = produto.id;
      }

      const atual = await tx.inventarioItem.findUnique({
        where: { inventarioId_produtoId: { inventarioId: id, produtoId } },
      });
      if (!atual) throw new HttpError(404, 'Produto não está neste inventário');

      const contada = dados.somar
        ? arred3(num(atual.quantidadeContada) + dados.quantidade)
        : arred3(dados.quantidade);

      const atualizado = await tx.inventarioItem.update({
        where: { id: atual.id },
        data: { quantidadeContada: contada, contadoEm: new Date(), contadoPorId: req.usuario.id },
        include: {
          produto: { select: { codigo: true, ean: true, nome: true, unidade: true, precoCusto: true } },
        },
      });
      return itemDoInventario(atualizado);
    });

    res.json(item);
  })
);

// Finaliza: lança INVENTARIO pela diferença de cada item contado; depois o sistema passa a ser o contado.
router.post(
  '/inventarios/:id/finalizar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);

    const resultado = await prisma.$transaction(
      async (tx) => {
        const inv = await tx.inventario.findFirst({
          where: { id, lojaId },
          include: { itens: { include: { produto: { select: { precoCusto: true } } } } },
        });
        if (!inv) throw new HttpError(404, 'Inventário não encontrado');
        if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi encerrado');

        let ajustes = 0;
        let valorDiferenca = 0;
        for (const item of inv.itens) {
          if (item.quantidadeContada === null) continue;
          const contada = arred3(num(item.quantidadeContada));
          const diferenca = arred3(contada - num(item.quantidadeSistema));
          if (diferenca === 0) continue;

          const custo = num(item.produto.precoCusto);
          await movimentarEstoque(tx, {
            produtoId: item.produtoId,
            lojaId,
            tipo: 'INVENTARIO',
            quantidade: diferenca,
            custoUnitario: custo,
            motivo: `Inventário: ${inv.descricao}`,
            referencia: `inventario:${inv.id}`,
            usuarioId: req.usuario.id,
          });
          await tx.inventarioItem.update({ where: { id: item.id }, data: { quantidadeSistema: contada } });
          ajustes += 1;
          valorDiferenca += diferenca * custo;
        }

        await tx.inventario.update({
          where: { id: inv.id },
          data: { status: 'FINALIZADO', finalizadoEm: new Date() },
        });
        return { ajustes, valorDiferenca: arred2(valorDiferenca) };
      },
      { timeout: 60000 }
    );

    res.json(resultado);
  })
);

router.post(
  '/inventarios/:id/cancelar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);
    const inv = await prisma.inventario.findFirst({ where: { id, lojaId }, select: { id: true, status: true } });
    if (!inv) throw new HttpError(404, 'Inventário não encontrado');
    if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi encerrado');
    await prisma.inventario.update({ where: { id: inv.id }, data: { status: 'CANCELADO' } });
    res.json({ ok: true });
  })
);

export default router;
