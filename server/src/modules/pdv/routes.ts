import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma, Produto } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { arred2, arred3, codigoAleatorio, num, periodoDaQuery } from '../../lib/numeros';
import { calcularPreco, lerEtiquetaBalanca, promocoesVigentes } from '../../lib/precos';
import { cancelarVenda, registrarVenda } from '../../lib/vendas';
import { saldoDe } from '../../lib/estoque';
import { lerConfiguracao } from '../../lib/email';
import { gerarPixCopiaECola } from '../../lib/pix';

// PDV (frente de caixa), caixa da gaveta e vendas.
// Caixa: um por operador por vez, na loja da requisição. Dinheiro esperado = abertura + vendas em dinheiro
// + suprimentos − sangrias. Venda só é gravada por registrarVenda (o estoque e o fiado andam juntos lá dentro).

const router = Router();
const operadores = permitir('GESTOR', 'OPERADOR');
const consultas = permitir('GESTOR', 'OPERADOR', 'CONTADOR');
const gestor = permitir('GESTOR');

type Tx = Prisma.TransactionClient;

// ---------- Caixa ----------

interface ResumoCaixa {
  id: number;
  status: 'ABERTO' | 'FECHADO';
  terminal: string;
  abertoEm: string;
  valorAbertura: number;
  totalVendas: number;
  qtdVendas: number;
  porForma: Record<string, number>;
  sangrias: number;
  suprimentos: number;
  dinheiroEsperado: number;
  movimentos: { id: number; tipo: string; valor: number; motivo: string | null; criadoEm: string }[];
}

// Resumo do caixa: vendas concluídas e movimentos. Feito dentro de transação para ver um retrato só.
async function resumoDoCaixa(tx: Tx, caixaId: number): Promise<ResumoCaixa> {
  const caixa = await tx.caixa.findUniqueOrThrow({
    where: { id: caixaId },
    include: { movimentos: { orderBy: { criadoEm: 'asc' } } },
  });
  const pagamentos = await tx.pagamentoVenda.findMany({
    where: { venda: { caixaId, status: 'CONCLUIDA' } },
    select: { forma: true, valor: true },
  });
  const vendas = await tx.venda.aggregate({
    where: { caixaId, status: 'CONCLUIDA' },
    _sum: { total: true },
    _count: true,
  });

  const porForma: Record<string, number> = {};
  for (const p of pagamentos) {
    porForma[p.forma] = arred2((porForma[p.forma] ?? 0) + num(p.valor));
  }

  let sangrias = 0;
  let suprimentos = 0;
  for (const m of caixa.movimentos) {
    if (m.tipo === 'SANGRIA') sangrias += num(m.valor);
    else suprimentos += num(m.valor);
  }
  sangrias = arred2(sangrias);
  suprimentos = arred2(suprimentos);

  const abertura = num(caixa.valorAbertura);
  const dinheiro = porForma.DINHEIRO ?? 0;

  return {
    id: caixa.id,
    status: caixa.status,
    terminal: caixa.terminal,
    abertoEm: caixa.abertoEm.toISOString(),
    valorAbertura: abertura,
    totalVendas: arred2(num(vendas._sum.total)),
    qtdVendas: vendas._count,
    porForma,
    sangrias,
    suprimentos,
    dinheiroEsperado: arred2(abertura + dinheiro + suprimentos - sangrias),
    movimentos: caixa.movimentos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      valor: num(m.valor),
      motivo: m.motivo,
      criadoEm: m.criadoEm.toISOString(),
    })),
  };
}

async function resumoPorId(caixaId: number): Promise<ResumoCaixa> {
  return prisma.$transaction((tx) => resumoDoCaixa(tx, caixaId));
}

// Caixa que o usuário pode mexer: aberto, e dele (o gestor mexe em qualquer um).
async function caixaAberto(req: Request, id: number): Promise<{ id: number; usuarioId: number }> {
  const caixa = await prisma.caixa.findUnique({ where: { id }, select: { id: true, usuarioId: true, status: true } });
  if (!caixa) throw new HttpError(404, 'Caixa não encontrado');
  if (req.usuario.perfil !== 'GESTOR' && caixa.usuarioId !== req.usuario.id) {
    throw new HttpError(403, 'Este caixa é de outro operador');
  }
  if (caixa.status !== 'ABERTO') throw new HttpError(400, 'Este caixa já está fechado');
  return caixa;
}

router.get(
  '/caixas/atual',
  operadores,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const caixa = await prisma.caixa.findFirst({
      where: { usuarioId: req.usuario.id, lojaId, status: 'ABERTO' },
      select: { id: true },
    });
    if (!caixa) {
      res.json(null);
      return;
    }
    res.json(await resumoPorId(caixa.id));
  }),
);

const abrirSchema = z.object({
  valorAbertura: z.number().min(0, 'Informe o valor de abertura'),
  terminal: z.string().trim().max(40).nullable().optional(),
});

router.post(
  '/caixas/abrir',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(abrirSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const id = await prisma.$transaction(async (tx) => {
      const existente = await tx.caixa.findFirst({
        where: { usuarioId: req.usuario.id, lojaId, status: 'ABERTO' },
        select: { id: true },
      });
      if (existente) throw new HttpError(409, 'Você já tem um caixa aberto');
      const caixa = await tx.caixa.create({
        data: {
          lojaId,
          terminal: dados.terminal || 'PDV 01',
          usuarioId: req.usuario.id,
          status: 'ABERTO',
          valorAbertura: arred2(dados.valorAbertura),
        },
        select: { id: true },
      });
      return caixa.id;
    });
    res.status(201).json(await resumoPorId(id));
  }),
);

const movimentoSchema = z.object({
  valor: z.number().positive('Informe o valor'),
  motivo: z.string().trim().min(1, 'Informe o motivo').max(120, 'Motivo muito longo'),
});

router.post(
  '/caixas/:id/sangria',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(movimentoSchema, req.body);
    const caixa = await caixaAberto(req, idParam(req));
    await exigirAcao(req, 'SANGRIA');
    await prisma.movimentoCaixa.create({
      data: { caixaId: caixa.id, tipo: 'SANGRIA', valor: arred2(dados.valor), motivo: dados.motivo, usuarioId: req.usuario.id },
    });
    res.status(201).json(await resumoPorId(caixa.id));
  }),
);

router.post(
  '/caixas/:id/suprimento',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(movimentoSchema, req.body);
    const caixa = await caixaAberto(req, idParam(req));
    await prisma.movimentoCaixa.create({
      data: { caixaId: caixa.id, tipo: 'SUPRIMENTO', valor: arred2(dados.valor), motivo: dados.motivo, usuarioId: req.usuario.id },
    });
    res.status(201).json(await resumoPorId(caixa.id));
  }),
);

const fecharSchema = z.object({
  valorInformado: z.number().min(0, 'Informe o dinheiro contado'),
});

router.post(
  '/caixas/:id/fechar',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(fecharSchema, req.body);
    const caixa = await caixaAberto(req, idParam(req));
    const resposta = await prisma.$transaction(async (tx) => {
      const resumo = await resumoDoCaixa(tx, caixa.id);
      const valorInformado = arred2(dados.valorInformado);
      const diferenca = arred2(valorInformado - resumo.dinheiroEsperado);
      const fechadoEm = new Date();
      await tx.caixa.update({
        where: { id: caixa.id },
        data: { status: 'FECHADO', fechadoEm, valorInformado, diferenca },
      });
      return { ...resumo, status: 'FECHADO' as const, fechadoEm: fechadoEm.toISOString(), valorInformado, diferenca };
    });
    res.json(resposta);
  }),
);

const filtroCaixas = z.object({
  inicio: z.string().optional(),
  fim: z.string().optional(),
});

router.get(
  '/caixas',
  gestor,
  asyncHandler(async (req, res) => {
    validar(filtroCaixas, req.query);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const loja = await filtroLoja(req);
    const where: Prisma.CaixaWhereInput = { abertoEm: { gte: inicio, lte: fim } };
    if (loja !== null) where.lojaId = loja;

    const caixas = await prisma.caixa.findMany({
      where,
      orderBy: { abertoEm: 'desc' },
      take: 200,
      include: { usuario: { select: { nome: true } } },
    });
    const ids = caixas.map((c) => c.id);
    const totais = ids.length
      ? await prisma.venda.groupBy({
          by: ['caixaId'],
          where: { caixaId: { in: ids }, status: 'CONCLUIDA' },
          _sum: { total: true },
        })
      : [];
    const porCaixa = new Map(totais.map((t) => [t.caixaId, num(t._sum.total)]));

    res.json(
      caixas.map((c) => ({
        id: c.id,
        terminal: c.terminal,
        operador: c.usuario.nome,
        abertoEm: c.abertoEm.toISOString(),
        fechadoEm: c.fechadoEm ? c.fechadoEm.toISOString() : null,
        status: c.status,
        valorAbertura: num(c.valorAbertura),
        totalVendas: arred2(porCaixa.get(c.id) ?? 0),
        valorInformado: c.valorInformado === null ? null : num(c.valorInformado),
        diferenca: c.diferenca === null ? null : num(c.diferenca),
      })),
    );
  }),
);

// ---------- PDV: produtos, leitura, cálculo ----------

interface ProdutoPdv {
  id: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  pesavel: boolean;
  precoVenda: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  foto: string | null;
  categoria: string | null;
  estoque: number;
}

// Produto com o nome da categoria (include categoria: { select: { nome: true } }).
type ProdutoComCategoria = Produto & { categoria?: { nome: string } | null };

function dtoProduto(p: ProdutoComCategoria, estoque: number): ProdutoPdv {
  return {
    id: p.id,
    codigo: p.codigo,
    ean: p.ean,
    nome: p.nome,
    unidade: p.unidade,
    pesavel: p.pesavel,
    precoVenda: num(p.precoVenda),
    precoAtacado: p.precoAtacado === null ? null : num(p.precoAtacado),
    qtdAtacado: p.qtdAtacado === null ? null : num(p.qtdAtacado),
    foto: p.foto ?? null,
    categoria: p.categoria?.nome ?? null,
    estoque,
  };
}

router.get(
  '/pdv/produtos',
  operadores,
  asyncHandler(async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    const lojaId = await lojaDaRequisicao(req);
    const where: Prisma.ProdutoWhereInput = { ativo: true, insumo: false };
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { codigo: { contains: busca, mode: 'insensitive' } },
        { ean: { contains: busca } },
      ];
    }
    const produtos = await prisma.produto.findMany({
      where,
      orderBy: { nome: 'asc' },
      take: 30,
      include: { categoria: { select: { nome: true } } },
    });
    const saldos = produtos.length
      ? await prisma.estoqueLoja.findMany({ where: { lojaId, produtoId: { in: produtos.map((p) => p.id) } } })
      : [];
    const porProduto = new Map(saldos.map((s) => [s.produtoId, num(s.quantidade)]));
    res.json(produtos.map((p) => dtoProduto(p, porProduto.get(p.id) ?? 0)));
  }),
);

const lerSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código'),
  quantidade: z.number().positive().optional(),
});

router.post(
  '/pdv/ler',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(lerSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const config = await lerConfiguracao();

    // "5*789..." = 5 unidades do código seguinte.
    let codigo = dados.codigo;
    let quantidade = dados.quantidade ?? 1;
    const prefixado = /^(\d+)\*(.+)$/.exec(codigo);
    if (prefixado) {
      const qtd = Number(prefixado[1]);
      if (!(qtd > 0)) throw new HttpError(400, 'Quantidade inválida');
      quantidade = qtd;
      codigo = prefixado[2].trim();
    }

    let produto: ProdutoComCategoria | null = null;
    const balanca = lerEtiquetaBalanca(codigo, config.balancaPrefixo, config.balancaModo);
    if (balanca) {
      produto = await prisma.produto.findFirst({
        where: { codigoBalanca: balanca.plu, ativo: true, insumo: false },
        include: { categoria: { select: { nome: true } } },
      });
      if (produto) {
        if (balanca.modo === 'PRECO') {
          const preco = num(produto.precoVenda);
          if (preco <= 0) throw new HttpError(400, 'Produto sem preço de venda');
          quantidade = arred3(balanca.valor / preco);
        } else {
          quantidade = arred3(balanca.valor);
        }
      }
    }
    // Sem produto pela etiqueta (ou código que não é de balança): procura por EAN ou código interno.
    if (!produto) {
      produto = await prisma.produto.findFirst({
        where: { ativo: true, insumo: false, OR: [{ ean: codigo }, { codigo }] },
        include: { categoria: { select: { nome: true } } },
      });
    }
    if (!produto) throw new HttpError(404, 'Produto não encontrado');

    const estoque = await saldoDe(produto.id, lojaId);
    res.json({ produto: dtoProduto(produto, estoque), quantidade });
  }),
);

const calcularSchema = z.object({
  itens: z.array(z.object({ produtoId: z.number().int().positive(), quantidade: z.number().positive() })),
  clienteId: z.number().int().positive().nullable().optional(),
});

router.post(
  '/pdv/calcular',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(calcularSchema, req.body);
    const ids = Array.from(new Set(dados.itens.map((i) => i.produtoId)));
    const produtos = ids.length ? await prisma.produto.findMany({ where: { id: { in: ids } } }) : [];
    const porId = new Map(produtos.map((p) => [p.id, p]));
    for (const id of ids) {
      if (!porId.has(id)) throw new HttpError(404, 'Produto não encontrado');
    }

    let tipoCliente: 'VAREJO' | 'ATACADO' = 'VAREJO';
    if (dados.clienteId) {
      const cliente = await prisma.cliente.findUnique({ where: { id: dados.clienteId }, select: { tipo: true } });
      if (!cliente) throw new HttpError(400, 'Cliente não encontrado');
      tipoCliente = cliente.tipo;
    }

    const promocoes = await promocoesVigentes(produtos, prisma);
    const itens = dados.itens.map((i) => {
      const produto = porId.get(i.produtoId)!;
      const quantidade = arred3(i.quantidade);
      const c = calcularPreco(produto, quantidade, promocoes, tipoCliente);
      return {
        produtoId: produto.id,
        quantidade,
        precoUnitario: c.precoUnitario,
        precoTabela: c.precoTabela,
        total: c.total,
        desconto: c.desconto,
        descricaoPromocao: c.descricaoPromocao,
      };
    });

    const subtotal = arred2(itens.reduce((s, i) => s + arred2(i.precoTabela * i.quantidade), 0));
    const total = arred2(itens.reduce((s, i) => s + i.total, 0));
    res.json({ itens, subtotal, descontoPromocoes: arred2(subtotal - total), total });
  }),
);

const autorizarSchema = z.object({
  acao: z.enum(['CANCELAR_ITEM', 'DESCONTO_MANUAL', 'FIADO_ACIMA_LIMITE']),
});

// Confere a senha do gestor quando a regra pedir. O cliente abre a janela da senha sozinho no 403.
router.post(
  '/pdv/autorizar',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(autorizarSchema, req.body);
    await exigirAcao(req, dados.acao);
    res.json({ ok: true });
  }),
);

const pixSchema = z.object({ valor: z.number().positive('Informe o valor do Pix') });

router.post(
  '/pdv/pix',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(pixSchema, req.body);
    const config = await lerConfiguracao();
    if (!config.pixChave) throw new HttpError(400, 'Configure a chave Pix em Configurações > Mercado');
    const copiaECola = gerarPixCopiaECola({
      chave: config.pixChave,
      nome: config.pixNome || 'MERCADO',
      cidade: config.pixCidade || 'BRASIL',
      valor: arred2(dados.valor),
      identificador: codigoAleatorio(12),
    });
    res.json({ copiaECola, chave: config.pixChave });
  }),
);

// ---------- PDV: finalizar venda ----------

const itemVendaSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().positive(),
  desconto: z.number().min(0).optional(),
});

const pagamentoVendaSchema = z.object({
  forma: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'FIADO', 'VALE_ALIMENTACAO', 'BOLETO']),
  valor: z.number().positive(),
  parcelas: z.number().int().min(1).max(12).optional(),
  autorizacao: z.string().trim().max(60).nullable().optional(),
});

const vendaSchema = z.object({
  itens: z.array(itemVendaSchema).min(1, 'Adicione itens à venda'),
  pagamentos: z.array(pagamentoVendaSchema).min(1, 'Informe o pagamento'),
  clienteId: z.number().int().positive().nullable().optional(),
  desconto: z.number().min(0).optional(),
  cpfNota: z.string().trim().max(14).nullable().optional(),
  itensCancelados: z.number().int().min(0).optional(),
});

router.post(
  '/pdv/vendas',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(vendaSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const caixa = await prisma.caixa.findFirst({
      where: { usuarioId: req.usuario.id, lojaId, status: 'ABERTO' },
      select: { id: true },
    });
    if (!caixa) throw new HttpError(400, 'Abra o caixa antes de vender');

    const descontoTotal = dados.desconto ?? 0;
    const descontoItem = dados.itens.some((i) => (i.desconto ?? 0) > 0);
    if (descontoTotal > 0 || descontoItem) await exigirAcao(req, 'DESCONTO_MANUAL');

    const fiado = arred2(dados.pagamentos.filter((p) => p.forma === 'FIADO').reduce((s, p) => s + p.valor, 0));
    if (fiado > 0 && dados.clienteId) {
      const cliente = await prisma.cliente.findUnique({
        where: { id: dados.clienteId },
        select: { saldoDevedor: true, limiteCredito: true },
      });
      if (!cliente) throw new HttpError(400, 'Cliente não encontrado');
      const limite = num(cliente.limiteCredito);
      if (limite > 0 && num(cliente.saldoDevedor) + fiado > limite) {
        await exigirAcao(req, 'FIADO_ACIMA_LIMITE');
      }
    }

    const resultado = await prisma.$transaction((tx) =>
      registrarVenda(tx, {
        lojaId,
        usuarioId: req.usuario.id,
        caixaId: caixa.id,
        clienteId: dados.clienteId ?? null,
        origem: 'PDV',
        itens: dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, desconto: i.desconto })),
        pagamentos: dados.pagamentos.map((p) => ({
          forma: p.forma,
          valor: p.valor,
          parcelas: p.parcelas,
          autorizacao: p.autorizacao ?? null,
        })),
        desconto: descontoTotal,
        cpfNota: dados.cpfNota || null,
        observacao: dados.itensCancelados ? `Itens cancelados no PDV: ${dados.itensCancelados}` : null,
      }),
    );

    const nota = resultado.notaId
      ? await prisma.notaFiscal.findUnique({ where: { id: resultado.notaId }, select: { numero: true, chave: true } })
      : null;
    res.status(201).json({
      vendaId: resultado.vendaId,
      numero: resultado.numero,
      total: resultado.total,
      troco: resultado.troco,
      notaId: resultado.notaId,
      nota: nota ? { numero: nota.numero, chave: nota.chave } : null,
    });
  }),
);

// ---------- Vendas ----------

const filtroVendas = z.object({
  origem: z.enum(['PDV', 'DELIVERY', 'MARKETPLACE', 'FORCA_VENDAS', 'B2B']).optional(),
  status: z.enum(['ABERTA', 'CONCLUIDA', 'CANCELADA']).optional(),
  clienteId: z.string().regex(/^\d+$/).optional(),
});

router.get(
  '/vendas',
  consultas,
  asyncHandler(async (req, res) => {
    const filtros = validar(filtroVendas, req.query);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const loja = await filtroLoja(req);
    const where: Prisma.VendaWhereInput = { criadoEm: { gte: inicio, lte: fim } };
    if (loja !== null) where.lojaId = loja;
    if (req.usuario.perfil === 'OPERADOR') where.usuarioId = req.usuario.id;
    if (filtros.origem) where.origem = filtros.origem;
    if (filtros.status) where.status = filtros.status;
    if (filtros.clienteId) where.clienteId = Number(filtros.clienteId);

    const vendas = await prisma.venda.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: 500,
      include: {
        cliente: { select: { id: true, nome: true } },
        usuario: { select: { nome: true } },
        pagamentos: { select: { forma: true } },
      },
    });
    res.json(
      vendas.map((v) => ({
        id: v.id,
        numero: v.numero,
        criadoEm: v.criadoEm.toISOString(),
        origem: v.origem,
        status: v.status,
        cliente: v.cliente ? { id: v.cliente.id, nome: v.cliente.nome } : null,
        operador: v.usuario.nome,
        total: num(v.total),
        formas: Array.from(new Set(v.pagamentos.map((p) => p.forma))),
      })),
    );
  }),
);

// Venda completa (detalhe e cupom). O XML da nota não sai daqui: só o aviso de simulado.
async function buscarVenda(id: number) {
  return prisma.venda.findUnique({
    where: { id },
    include: {
      loja: { select: { nome: true, cnpj: true } },
      usuario: { select: { nome: true } },
      vendedor: { select: { nome: true } },
      cliente: { select: { id: true, nome: true, cpfCnpj: true } },
      itens: {
        orderBy: { id: 'asc' },
        include: {
          produto: { select: { unidade: true, foto: true, categoria: { select: { nome: true } } } },
          promocao: { select: { nome: true } },
        },
      },
      pagamentos: { orderBy: { id: 'asc' }, select: { forma: true, valor: true, parcelas: true } },
      notas: { orderBy: { id: 'asc' }, select: { id: true, modelo: true, numero: true, serie: true, chave: true, status: true, xml: true } },
      entrega: { select: { codigo: true, status: true } },
    },
  });
}

type VendaCompleta = NonNullable<Awaited<ReturnType<typeof buscarVenda>>>;

function dtoDetalhe(v: VendaCompleta) {
  const total = num(v.total);
  const custoTotal = num(v.custoTotal);
  return {
    id: v.id,
    numero: v.numero,
    criadoEm: v.criadoEm.toISOString(),
    origem: v.origem,
    status: v.status,
    loja: v.loja.nome,
    lojaCnpj: v.loja.cnpj,
    operador: v.usuario.nome,
    vendedor: v.vendedor ? v.vendedor.nome : null,
    cliente: v.cliente ? { id: v.cliente.id, nome: v.cliente.nome, cpfCnpj: v.cliente.cpfCnpj } : null,
    subtotal: num(v.subtotal),
    desconto: num(v.desconto),
    acrescimo: num(v.acrescimo),
    total,
    troco: num(v.troco),
    custoTotal,
    lucro: arred2(total - custoTotal),
    cpfNota: v.cpfNota,
    observacao: v.observacao,
    motivoCancelamento: v.motivoCancelamento,
    itens: v.itens.map((i) => ({
      descricao: i.descricao,
      quantidade: num(i.quantidade),
      unidade: i.produto.unidade,
      foto: i.produto.foto ?? null,
      categoria: i.produto.categoria?.nome ?? null,
      precoUnitario: num(i.precoUnitario),
      desconto: num(i.desconto),
      total: num(i.total),
      promocao: i.promocao ? i.promocao.nome : null,
    })),
    pagamentos: v.pagamentos.map((p) => ({ forma: p.forma, valor: num(p.valor), parcelas: p.parcelas })),
    notas: v.notas.map((n) => ({
      id: n.id,
      modelo: n.modelo,
      numero: n.numero,
      serie: n.serie,
      chave: n.chave,
      status: n.status,
      simulada: (n.xml ?? '').includes('SIMULADO'),
    })),
    entrega: v.entrega ? { codigo: v.entrega.codigo, status: v.entrega.status } : null,
  };
}

// Venda de outro operador não aparece para o operador (responde 404, sem revelar que existe).
async function vendaVisivel(req: Request, id: number): Promise<VendaCompleta> {
  const venda = await buscarVenda(id);
  if (!venda) throw new HttpError(404, 'Venda não encontrada');
  if (req.usuario.perfil === 'OPERADOR' && venda.usuarioId !== req.usuario.id) {
    throw new HttpError(404, 'Venda não encontrada');
  }
  return venda;
}

router.get(
  '/vendas/:id',
  consultas,
  asyncHandler(async (req, res) => {
    const venda = await vendaVisivel(req, idParam(req));
    res.json(dtoDetalhe(venda));
  }),
);

// Dados para reimprimir o cupom: o mesmo detalhe da venda (já traz nome e CNPJ da loja).
router.get(
  '/vendas/:id/cupom',
  consultas,
  asyncHandler(async (req, res) => {
    const venda = await vendaVisivel(req, idParam(req));
    res.json(dtoDetalhe(venda));
  }),
);

const cancelarSchema = z.object({
  motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(200, 'Motivo muito longo'),
});

router.post(
  '/vendas/:id/cancelar',
  operadores,
  asyncHandler(async (req, res) => {
    const dados = validar(cancelarSchema, req.body);
    const id = idParam(req);
    await vendaVisivel(req, id);
    await exigirAcao(req, 'CANCELAR_VENDA');
    await prisma.$transaction((tx) => cancelarVenda(tx, id, dados.motivo, req.usuario.id));
    res.json(dtoDetalhe(await vendaVisivel(req, id)));
  }),
);

export default router;
