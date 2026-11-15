import { Router } from 'express';
import { z } from 'zod';
import type { Fornecedor, Prisma, StatusPedidoCompra, StatusRecebimento } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lojaDaRequisicao } from '../../lib/lojas';
import { atualizarCustoMedio, movimentarEstoque, type Tx } from '../../lib/estoque';
import { arred2, arred3, arred4, codigoAleatorio, num, numOuNull } from '../../lib/numeros';
import { sugerirPrecoVenda } from '../../lib/precos';
import { emailHabilitado, enfileirarEmail, lerConfiguracao } from '../../lib/email';
import { alterarPreco } from '../produtos/precos';
import { lerNfe, type ItemNfe } from './xmlNfe';

// Compras: fornecedores, sugestão de compra, cotações, pedidos de compra e recebimento de mercadoria.
// COMPRADOR e GESTOR fazem tudo. ESTOQUISTA recebe a mercadoria e lê os pedidos.

const router = Router();
// Rotas sem login (link da cotação enviado ao fornecedor).
export const publico = Router();

const COMPRAS = permitir('COMPRADOR', 'GESTOR');
const LEITURA_PEDIDOS = permitir('COMPRADOR', 'GESTOR', 'ESTOQUISTA');
const RECEBIMENTO = permitir('COMPRADOR', 'GESTOR', 'ESTOQUISTA');

const STATUS_PEDIDO: StatusPedidoCompra[] = [
  'RASCUNHO',
  'ENVIADO',
  'CONFIRMADO',
  'EM_TRANSITO',
  'RECEBIDO_PARCIAL',
  'RECEBIDO',
  'CANCELADO',
];
// Pedidos já enviados e ainda não recebidos por completo.
const PEDIDO_ABERTO: StatusPedidoCompra[] = ['ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL'];

// Mudanças de status permitidas. RECEBIDO e RECEBIDO_PARCIAL vêm do recebimento, não daqui.
const TRANSICOES: Partial<Record<StatusPedidoCompra, StatusPedidoCompra[]>> = {
  RASCUNHO: ['ENVIADO', 'CANCELADO'],
  ENVIADO: ['CONFIRMADO', 'EM_TRANSITO', 'CANCELADO'],
  CONFIRMADO: ['EM_TRANSITO', 'CANCELADO'],
};

interface RetornoRascunho {
  pedidoId: number;
  numero: number;
  fornecedor: string;
}

// ---------- Utilidades ----------

const DATA_DIA = /^\d{4}-\d{2}-\d{2}$/;

// Dia AAAA-MM-DD gravado ao meio-dia (evita o dia anterior por causa do fuso).
function diaAoMeioDia(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

function hojeAoMeioDia(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12, 0, 0, 0);
}

function iso(data: Date | null | undefined): string | null {
  return data ? data.toISOString() : null;
}

// Texto opcional: vazio vira null; campo ausente continua ausente (não mexe no valor gravado).
function textoOpcional(max: number) {
  return z
    .string()
    .trim()
    .max(max, 'Texto muito longo')
    .nullish()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v && v.trim() !== '' ? v.trim() : null;
    });
}

// Data opcional AAAA-MM-DD; ausente continua ausente.
function dataOpcional() {
  return z
    .string()
    .regex(DATA_DIA, 'Data inválida')
    .nullish()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === null ? null : diaAoMeioDia(v);
    });
}

function inteiroDaQuery(valor: unknown, padrao: number, min: number, max: number, nome: string): number {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${nome} inválido`);
  return n;
}

function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Linhas do pedido (quantidade e preço arredondados) e o total, como o banco guarda.
function linhasDoPedido(itens: { produtoId: number; quantidade: number; precoUnitario: number }[]) {
  const linhas = itens.map((i) => ({
    produtoId: i.produtoId,
    quantidade: arred3(i.quantidade),
    precoUnitario: arred4(i.precoUnitario),
  }));
  const total = arred2(linhas.reduce((soma, l) => soma + arred2(l.quantidade * l.precoUnitario), 0));
  return { linhas, total };
}

async function validarFornecedores(ids: number[]): Promise<void> {
  const unicos = [...new Set(ids)];
  const ativos = await prisma.fornecedor.count({ where: { id: { in: unicos }, ativo: true } });
  if (ativos !== unicos.length) throw new HttpError(400, 'Fornecedor não encontrado ou inativo');
}

async function validarProdutos(ids: number[]): Promise<void> {
  const unicos = [...new Set(ids)];
  const achados = await prisma.produto.count({ where: { id: { in: unicos }, ativo: true } });
  if (achados !== unicos.length) throw new HttpError(400, 'Produto não encontrado ou inativo');
}

// Cria um pedido RASCUNHO para um fornecedor (usado pela sugestão, pela cotação e pelo pedido manual).
async function criarRascunho(
  tx: Tx,
  base: {
    fornecedorId: number;
    lojaId: number;
    usuarioId: number;
    cotacaoId?: number | null;
    itens: { produtoId: number; quantidade: number; precoUnitario: number }[];
    previsaoEntrega?: Date | null;
    condicaoPagamento?: string | null;
    observacoes?: string | null;
  },
): Promise<RetornoRascunho> {
  const fornecedor = await tx.fornecedor.findUnique({
    where: { id: base.fornecedorId },
    select: { id: true, nome: true, condicaoPagamento: true },
  });
  if (!fornecedor) throw new HttpError(400, 'Fornecedor não encontrado');
  const { linhas, total } = linhasDoPedido(base.itens);
  const pedido = await tx.pedidoCompra.create({
    data: {
      fornecedorId: base.fornecedorId,
      lojaId: base.lojaId,
      cotacaoId: base.cotacaoId ?? null,
      usuarioId: base.usuarioId,
      status: 'RASCUNHO',
      total,
      condicaoPagamento: base.condicaoPagamento ?? fornecedor.condicaoPagamento,
      previsaoEntrega: base.previsaoEntrega ?? null,
      observacoes: base.observacoes ?? null,
      itens: { create: linhas },
    },
    select: { id: true, numero: true },
  });
  return { pedidoId: pedido.id, numero: pedido.numero, fornecedor: fornecedor.nome };
}

// ---------- Fornecedores ----------

const fornecedorSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(120, 'Nome muito longo'),
  razaoSocial: textoOpcional(120),
  cnpj: textoOpcional(20),
  inscricaoEstadual: textoOpcional(30),
  telefone: textoOpcional(30),
  whatsapp: textoOpcional(30),
  email: textoOpcional(120),
  contato: textoOpcional(80),
  endereco: textoOpcional(200),
  cidade: textoOpcional(80),
  uf: textoOpcional(2),
  prazoEntregaDias: z.number().int('Prazo deve ser um número inteiro').min(0).max(365).default(3),
  condicaoPagamento: textoOpcional(80),
  pedidoMinimo: z.number().min(0).max(1000000).default(0),
  diasVisita: textoOpcional(40),
  observacoes: textoOpcional(500),
  ativo: z.boolean().optional(),
});

// CNPJ guardado só com dígitos (14). Vazio vira null.
function cnpjDigitos(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined || valor === null) return valor;
  const digitos = valor.replace(/\D/g, '');
  if (digitos === '') return null;
  if (digitos.length !== 14) throw new HttpError(400, 'CNPJ deve ter 14 números');
  return digitos;
}

function dadosDoFornecedor(dados: z.infer<typeof fornecedorSchema>) {
  return { ...dados, cnpj: cnpjDigitos(dados.cnpj) };
}

function dtoFornecedor(f: Fornecedor) {
  return {
    id: f.id,
    nome: f.nome,
    razaoSocial: f.razaoSocial,
    cnpj: f.cnpj,
    inscricaoEstadual: f.inscricaoEstadual,
    telefone: f.telefone,
    whatsapp: f.whatsapp,
    email: f.email,
    contato: f.contato,
    endereco: f.endereco,
    cidade: f.cidade,
    uf: f.uf,
    prazoEntregaDias: f.prazoEntregaDias,
    condicaoPagamento: f.condicaoPagamento,
    pedidoMinimo: num(f.pedidoMinimo),
    diasVisita: f.diasVisita,
    avaliacao: num(f.avaliacao),
    observacoes: f.observacoes,
    ativo: f.ativo,
  };
}

// Total comprado (últimos 12 meses) e pedidos abertos de cada fornecedor.
async function resumoDosFornecedores(ids: number[]) {
  const mapa = new Map<number, { totalComprado12m: number; pedidosAbertos: number }>();
  for (const id of ids) mapa.set(id, { totalComprado12m: 0, pedidosAbertos: 0 });
  if (ids.length === 0) return mapa;
  const umAno = new Date();
  umAno.setFullYear(umAno.getFullYear() - 1);
  const pedidos = await prisma.pedidoCompra.findMany({
    where: { fornecedorId: { in: ids }, status: { notIn: ['RASCUNHO', 'CANCELADO'] } },
    select: { fornecedorId: true, status: true, total: true, criadoEm: true },
  });
  for (const p of pedidos) {
    const r = mapa.get(p.fornecedorId);
    if (!r) continue;
    if (p.criadoEm >= umAno) r.totalComprado12m += num(p.total);
    if (PEDIDO_ABERTO.includes(p.status)) r.pedidosAbertos += 1;
  }
  for (const r of mapa.values()) r.totalComprado12m = arred2(r.totalComprado12m);
  return mapa;
}

async function detalheFornecedor(id: number) {
  const f = await prisma.fornecedor.findUnique({ where: { id } });
  if (!f) throw new HttpError(404, 'Fornecedor não encontrado');
  const [produtos, pedidos, avaliacoes, resumo] = await Promise.all([
    prisma.produtoFornecedor.findMany({
      where: { fornecedorId: id },
      orderBy: { produto: { nome: 'asc' } },
      include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } },
    }),
    prisma.pedidoCompra.findMany({
      where: { fornecedorId: id },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true, numero: true, status: true, total: true, criadoEm: true },
    }),
    prisma.avaliacaoFornecedor.findMany({
      where: { fornecedorId: id },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 30,
    }),
    resumoDosFornecedores([id]),
  ]);
  const r = resumo.get(id) ?? { totalComprado12m: 0, pedidosAbertos: 0 };
  return {
    ...dtoFornecedor(f),
    ...r,
    produtos: produtos.map((v) => ({
      produtoId: v.produtoId,
      nome: v.produto.nome,
      codigo: v.produto.codigo,
      unidade: v.produto.unidade,
      codigoFornecedor: v.codigoFornecedor,
      ultimoPreco: numOuNull(v.ultimoPreco),
      fatorConversao: num(v.fatorConversao),
    })),
    pedidos: pedidos.map((p) => ({
      id: p.id,
      numero: p.numero,
      status: p.status,
      total: num(p.total),
      criadoEm: p.criadoEm.toISOString(),
    })),
    avaliacoes: avaliacoes.map((a) => ({
      id: a.id,
      pontualidade: a.pontualidade,
      qualidade: a.qualidade,
      atendimento: a.atendimento,
      media: arred2((a.pontualidade + a.qualidade + a.atendimento) / 3),
      comentario: a.comentario,
      criadoEm: a.criadoEm.toISOString(),
    })),
  };
}

router.get(
  '/fornecedores',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    const ativo = req.query.ativo;
    const condicoes: Prisma.FornecedorWhereInput[] = [];
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      condicoes.push({
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          ...(digitos ? [{ cnpj: { contains: digitos } }] : []),
        ],
      });
    }
    if (ativo === 'true' || ativo === 'false') condicoes.push({ ativo: ativo === 'true' });
    const lista = await prisma.fornecedor.findMany({
      where: condicoes.length ? { AND: condicoes } : {},
      orderBy: { nome: 'asc' },
      take: 500,
    });
    const resumo = await resumoDosFornecedores(lista.map((f) => f.id));
    res.json(
      lista.map((f) => ({
        ...dtoFornecedor(f),
        ...(resumo.get(f.id) ?? { totalComprado12m: 0, pedidosAbertos: 0 }),
      })),
    );
  }),
);

router.get(
  '/fornecedores/:id',
  COMPRAS,
  asyncHandler(async (req, res) => {
    res.json(await detalheFornecedor(idParam(req)));
  }),
);

router.post(
  '/fornecedores',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const dados = validar(fornecedorSchema, req.body);
    const criado = await prisma.fornecedor.create({ data: dadosDoFornecedor(dados) });
    res.status(201).json(await detalheFornecedor(criado.id));
  }),
);

router.put(
  '/fornecedores/:id',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(fornecedorSchema, req.body);
    const existe = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Fornecedor não encontrado');
    await prisma.fornecedor.update({ where: { id }, data: dadosDoFornecedor(dados) });
    res.json(await detalheFornecedor(id));
  }),
);

const vinculoSchema = z.object({
  produtoId: z.number().int().positive(),
  codigoFornecedor: textoOpcional(60),
  ultimoPreco: z.number().min(0).max(1000000).nullish(),
  fatorConversao: z.number().positive('Fator deve ser maior que zero').max(100000).nullish(),
});

router.post(
  '/fornecedores/:id/produtos',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(vinculoSchema, req.body);
    const fornecedor = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true } });
    if (!fornecedor) throw new HttpError(404, 'Fornecedor não encontrado');
    const produto = await prisma.produto.findUnique({ where: { id: dados.produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(404, 'Produto não encontrado');
    await prisma.produtoFornecedor.upsert({
      where: { produtoId_fornecedorId: { produtoId: dados.produtoId, fornecedorId: id } },
      create: {
        produtoId: dados.produtoId,
        fornecedorId: id,
        codigoFornecedor: dados.codigoFornecedor ?? null,
        ultimoPreco: dados.ultimoPreco ?? null,
        fatorConversao: dados.fatorConversao ?? 1,
      },
      update: {
        codigoFornecedor: dados.codigoFornecedor,
        ultimoPreco: dados.ultimoPreco ?? undefined,
        fatorConversao: dados.fatorConversao ?? undefined,
      },
    });
    res.json(await detalheFornecedor(id));
  }),
);

router.delete(
  '/fornecedores/:id/produtos/:produtoId',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const fornecedorId = idParam(req);
    const produtoId = idParam(req, 'produtoId');
    const removidos = await prisma.produtoFornecedor.deleteMany({ where: { fornecedorId, produtoId } });
    if (removidos.count === 0) throw new HttpError(404, 'Vínculo não encontrado');
    res.status(204).end();
  }),
);

const notaSchema = z.number().int('Nota inteira de 1 a 5').min(1, 'Nota de 1 a 5').max(5, 'Nota de 1 a 5');

const avaliacaoSchema = z.object({
  pontualidade: notaSchema,
  qualidade: notaSchema,
  atendimento: notaSchema,
  comentario: textoOpcional(500),
  recebimentoId: z.number().int().positive().nullish(),
});

// Avaliação do fornecedor. Recalcula a média geral (as 3 notas de todas as avaliações).
router.post(
  '/fornecedores/:id/avaliacoes',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(avaliacaoSchema, req.body);
    const fornecedor = await prisma.fornecedor.findUnique({ where: { id }, select: { id: true } });
    if (!fornecedor) throw new HttpError(404, 'Fornecedor não encontrado');
    if (dados.recebimentoId) {
      const recebimento = await prisma.recebimento.findUnique({
        where: { id: dados.recebimentoId },
        select: { fornecedorId: true },
      });
      if (!recebimento || recebimento.fornecedorId !== id) {
        throw new HttpError(400, 'Recebimento não é deste fornecedor');
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.avaliacaoFornecedor.create({
        data: {
          fornecedorId: id,
          pontualidade: dados.pontualidade,
          qualidade: dados.qualidade,
          atendimento: dados.atendimento,
          comentario: dados.comentario ?? null,
          recebimentoId: dados.recebimentoId ?? null,
          usuarioId: req.usuario.id,
        },
      });
      const todas = await tx.avaliacaoFornecedor.findMany({
        where: { fornecedorId: id },
        select: { pontualidade: true, qualidade: true, atendimento: true },
      });
      const soma = todas.reduce((s, a) => s + a.pontualidade + a.qualidade + a.atendimento, 0);
      const media = arred2(soma / (todas.length * 3));
      await tx.fornecedor.update({ where: { id }, data: { avaliacao: media } });
    });
    res.status(201).json(await detalheFornecedor(id));
  }),
);

// ---------- Sugestão de compra ----------

// Sugere o que comprar: cobre `dias` dias de venda, respeitando mínimo, máximo e o que já está em pedido.
router.get(
  '/compras/sugestao',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const dias = inteiroDaQuery(req.query.dias, 15, 1, 180, 'Dias de cobertura');
    const fornecedorId =
      req.query.fornecedorId !== undefined && req.query.fornecedorId !== ''
        ? inteiroDaQuery(req.query.fornecedorId, 0, 1, 2147483647, 'Fornecedor')
        : null;

    const produtos = await prisma.produto.findMany({
      where: {
        ativo: true,
        ...(fornecedorId !== null
          ? { OR: [{ fornecedorPadraoId: fornecedorId }, { fornecedores: { some: { fornecedorId } } }] }
          : {}),
      },
      select: {
        id: true,
        codigo: true,
        nome: true,
        unidade: true,
        precoCusto: true,
        estoqueMinimo: true,
        estoqueMaximo: true,
        fornecedorPadraoId: true,
        fornecedores: { select: { fornecedorId: true, ultimoPreco: true } },
      },
      orderBy: { nome: 'asc' },
    });
    const ids = produtos.map((p) => p.id);

    const idsFornecedores = new Set<number>();
    for (const p of produtos) {
      const f = fornecedorId ?? p.fornecedorPadraoId;
      if (f !== null) idsFornecedores.add(f);
    }
    const fornecedores = await prisma.fornecedor.findMany({
      where: { id: { in: [...idsFornecedores] } },
      select: { id: true, nome: true, prazoEntregaDias: true },
    });
    const fornecedorPorId = new Map(fornecedores.map((f) => [f.id, f] as const));

    const estoques = await prisma.estoqueLoja.findMany({
      where: { lojaId, produtoId: { in: ids } },
      select: { produtoId: true, quantidade: true },
    });
    const saldo = new Map<number, number>(estoques.map((e) => [e.produtoId, num(e.quantidade)]));

    // Saída por venda e consumo de produção nos últimos 30 dias, na loja.
    const desde = new Date();
    desde.setDate(desde.getDate() - 30);
    const saidas = await prisma.movimentoEstoque.groupBy({
      by: ['produtoId'],
      where: {
        lojaId,
        produtoId: { in: ids },
        tipo: { in: ['VENDA', 'CONSUMO_PRODUCAO'] },
        criadoEm: { gte: desde },
      },
      _sum: { quantidade: true },
    });
    const giroSoma = new Map<number, number>(saidas.map((s) => [s.produtoId, -num(s._sum.quantidade)]));

    const pendentes = await prisma.pedidoCompraItem.findMany({
      where: { produtoId: { in: ids }, pedido: { lojaId, status: { in: PEDIDO_ABERTO } } },
      select: { produtoId: true, quantidade: true, quantidadeRecebida: true },
    });
    const emPedidoMapa = new Map<number, number>();
    for (const i of pendentes) {
      const falta = Math.max(0, num(i.quantidade) - num(i.quantidadeRecebida));
      emPedidoMapa.set(i.produtoId, (emPedidoMapa.get(i.produtoId) ?? 0) + falta);
    }

    const sugestao = [];
    for (const p of produtos) {
      const idFornecedor = fornecedorId ?? p.fornecedorPadraoId;
      const fornecedor = idFornecedor !== null ? fornecedorPorId.get(idFornecedor) : undefined;
      const prazo = fornecedor ? fornecedor.prazoEntregaDias : 3;
      const giro = Math.max(0, giroSoma.get(p.id) ?? 0) / 30;
      const estoque = saldo.get(p.id) ?? 0;
      const emPedido = emPedidoMapa.get(p.id) ?? 0;
      const minimo = num(p.estoqueMinimo);

      const alvo = Math.max(minimo, giro * (dias + prazo));
      let necessidade = alvo - estoque - emPedido;
      if (p.estoqueMaximo !== null) {
        necessidade = Math.min(necessidade, num(p.estoqueMaximo) - estoque - emPedido);
      }
      const sugerido = Math.ceil(arred3(necessidade));
      if (sugerido <= 0) continue;

      const vinculo = idFornecedor !== null ? p.fornecedores.find((v) => v.fornecedorId === idFornecedor) : undefined;
      const ultimoPreco = vinculo && vinculo.ultimoPreco !== null ? num(vinculo.ultimoPreco) : num(p.precoCusto);

      sugestao.push({
        produtoId: p.id,
        codigo: p.codigo,
        nome: p.nome,
        unidade: p.unidade,
        fornecedorId: idFornecedor,
        fornecedor: fornecedor ? fornecedor.nome : null,
        estoque,
        estoqueMinimo: minimo,
        giroDiario: arred3(giro),
        emPedido: arred3(emPedido),
        sugerido,
        ultimoPreco,
        valorEstimado: arred2(sugerido * ultimoPreco),
      });
    }
    res.json(sugestao);
  }),
);

const gerarSchema = z.object({
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        fornecedorId: z.number().int().positive(),
        quantidade: z.number().positive('Quantidade inválida').max(1000000),
        precoUnitario: z.number().min(0, 'Preço inválido').max(1000000),
      }),
    )
    .min(1, 'Escolha ao menos um item')
    .max(500),
});

// Gera um pedido RASCUNHO por fornecedor a partir da sugestão escolhida.
router.post(
  '/compras/sugestao/gerar-pedidos',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const dados = validar(gerarSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    await validarProdutos(dados.itens.map((i) => i.produtoId));
    await validarFornecedores(dados.itens.map((i) => i.fornecedorId));

    const grupos = new Map<number, typeof dados.itens>();
    for (const item of dados.itens) {
      const lista = grupos.get(item.fornecedorId) ?? [];
      lista.push(item);
      grupos.set(item.fornecedorId, lista);
    }

    const criados = await prisma.$transaction(async (tx) => {
      const saida: RetornoRascunho[] = [];
      for (const [fornecedorId, itens] of grupos) {
        saida.push(await criarRascunho(tx, { fornecedorId, lojaId, usuarioId: req.usuario.id, itens }));
      }
      return saida;
    });
    res.status(201).json(criados);
  }),
);

// ---------- Cotações ----------

const precosSchema = z
  .array(
    z.object({
      produtoId: z.number().int().positive(),
      preco: z.number().min(0, 'Preço inválido').max(1000000),
      prazoDias: z.number().int().min(0).max(365).nullish(),
    }),
  )
  .min(1, 'Informe ao menos um preço')
  .max(300);

const cotacaoSchema = z.object({
  titulo: z.string().trim().min(1, 'Informe o título').max(120, 'Título muito longo'),
  prazo: z.string().regex(DATA_DIA, 'Data inválida').nullish(),
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        quantidade: z.number().positive('Quantidade inválida').max(1000000),
      }),
    )
    .min(1, 'Inclua pelo menos um produto')
    .max(300),
  fornecedorIds: z.array(z.number().int().positive()).min(1, 'Escolha pelo menos um fornecedor').max(200),
});

async function detalheCotacao(id: number) {
  const c = await prisma.cotacao.findUnique({
    where: { id },
    include: {
      itens: {
        orderBy: { id: 'asc' },
        include: { produto: { select: { id: true, nome: true, unidade: true } } },
      },
      fornecedores: {
        orderBy: { id: 'asc' },
        include: { fornecedor: { select: { id: true, nome: true, whatsapp: true, telefone: true } } },
      },
    },
  });
  if (!c) throw new HttpError(404, 'Cotação não encontrada');
  const respostas = await prisma.cotacaoResposta.findMany({ where: { cotacaoId: id }, orderBy: { id: 'asc' } });

  // Menor preço de cada produto entre os fornecedores que responderam.
  const melhor = new Map<number, { produtoId: number; fornecedorId: number; preco: number }>();
  for (const r of respostas) {
    const preco = num(r.preco);
    const atual = melhor.get(r.produtoId);
    if (!atual || preco < atual.preco) {
      melhor.set(r.produtoId, { produtoId: r.produtoId, fornecedorId: r.fornecedorId, preco });
    }
  }

  return {
    id: c.id,
    titulo: c.titulo,
    status: c.status,
    prazo: iso(c.prazo),
    criadoEm: c.criadoEm.toISOString(),
    fechadaEm: iso(c.fechadaEm),
    itens: c.itens.map((i) => ({
      produtoId: i.produtoId,
      nome: i.produto.nome,
      unidade: i.produto.unidade,
      quantidade: num(i.quantidade),
    })),
    fornecedores: c.fornecedores.map((f) => ({
      fornecedorId: f.fornecedorId,
      nome: f.fornecedor.nome,
      whatsapp: f.fornecedor.whatsapp,
      telefone: f.fornecedor.telefone,
      token: f.token,
      respondidoEm: iso(f.respondidoEm),
    })),
    respostas: respostas.map((r) => ({
      produtoId: r.produtoId,
      fornecedorId: r.fornecedorId,
      preco: num(r.preco),
      prazoDias: r.prazoDias,
      vencedora: r.vencedora,
    })),
    melhorPreco: [...melhor.values()],
  };
}

router.get(
  '/cotacoes',
  COMPRAS,
  asyncHandler(async (_req, res) => {
    const lista = await prisma.cotacao.findMany({
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { itens: { select: { id: true } }, fornecedores: { select: { respondidoEm: true } } },
    });
    res.json(
      lista.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        status: c.status,
        prazo: iso(c.prazo),
        criadoEm: c.criadoEm.toISOString(),
        fechadaEm: iso(c.fechadaEm),
        itens: c.itens.length,
        fornecedores: c.fornecedores.length,
        respondidos: c.fornecedores.filter((f) => f.respondidoEm !== null).length,
      })),
    );
  }),
);

router.get(
  '/cotacoes/:id',
  COMPRAS,
  asyncHandler(async (req, res) => {
    res.json(await detalheCotacao(idParam(req)));
  }),
);

router.post(
  '/cotacoes',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const dados = validar(cotacaoSchema, req.body);
    const produtoIds = dados.itens.map((i) => i.produtoId);
    if (new Set(produtoIds).size !== produtoIds.length) throw new HttpError(400, 'Produto repetido na cotação');
    await validarProdutos(produtoIds);
    const fornecedorIds = [...new Set(dados.fornecedorIds)];
    await validarFornecedores(fornecedorIds);

    const cotacao = await prisma.cotacao.create({
      data: {
        titulo: dados.titulo,
        prazo: dados.prazo ? diaAoMeioDia(dados.prazo) : null,
        usuarioId: req.usuario.id,
        itens: {
          create: dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: arred3(i.quantidade) })),
        },
        fornecedores: {
          create: fornecedorIds.map((fornecedorId) => ({ fornecedorId, token: codigoAleatorio(16) })),
        },
      },
      select: { id: true },
    });
    res.status(201).json(await detalheCotacao(cotacao.id));
  }),
);

async function itensDaCotacao(cotacaoId: number): Promise<Set<number>> {
  const itens = await prisma.cotacaoItem.findMany({ where: { cotacaoId }, select: { produtoId: true } });
  return new Set(itens.map((i) => i.produtoId));
}

function confereProdutos(permitidos: Set<number>, precos: { produtoId: number }[]): void {
  for (const p of precos) {
    if (!permitidos.has(p.produtoId)) throw new HttpError(400, 'Produto fora da cotação');
  }
}

// Grava os preços de um fornecedor na cotação e marca a data da resposta.
async function gravarRespostas(
  tx: Tx,
  cotacaoId: number,
  fornecedorId: number,
  precos: { produtoId: number; preco: number; prazoDias?: number | null }[],
): Promise<void> {
  for (const p of precos) {
    const valores = { preco: arred4(p.preco), prazoDias: p.prazoDias ?? null };
    await tx.cotacaoResposta.upsert({
      where: { cotacaoId_fornecedorId_produtoId: { cotacaoId, fornecedorId, produtoId: p.produtoId } },
      create: { cotacaoId, fornecedorId, produtoId: p.produtoId, ...valores },
      update: valores,
    });
  }
  await tx.cotacaoFornecedor.update({
    where: { cotacaoId_fornecedorId: { cotacaoId, fornecedorId } },
    data: { respondidoEm: new Date() },
  });
}

// Comprador digita a resposta recebida por telefone ou e-mail.
router.post(
  '/cotacoes/:id/respostas',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(
      z.object({ fornecedorId: z.number().int().positive(), precos: precosSchema }),
      req.body,
    );
    const cotacao = await prisma.cotacao.findUnique({ where: { id }, select: { status: true } });
    if (!cotacao) throw new HttpError(404, 'Cotação não encontrada');
    if (cotacao.status !== 'ABERTA') throw new HttpError(409, 'Cotação já fechada');
    const convite = await prisma.cotacaoFornecedor.findUnique({
      where: { cotacaoId_fornecedorId: { cotacaoId: id, fornecedorId: dados.fornecedorId } },
      select: { id: true },
    });
    if (!convite) throw new HttpError(400, 'Fornecedor não foi convidado para esta cotação');
    confereProdutos(await itensDaCotacao(id), dados.precos);
    await prisma.$transaction((tx) => gravarRespostas(tx, id, dados.fornecedorId, dados.precos));
    res.json(await detalheCotacao(id));
  }),
);

const fecharSchema = z.object({
  vencedores: z
    .array(z.object({ produtoId: z.number().int().positive(), fornecedorId: z.number().int().positive() }))
    .nullish(),
});

// Fecha a cotação: marca os vencedores (ou o menor preço de cada produto) e cria um pedido RASCUNHO por fornecedor.
router.post(
  '/cotacoes/:id/fechar',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(fecharSchema, req.body);
    const cotacao = await prisma.cotacao.findUnique({
      where: { id },
      include: { itens: { select: { produtoId: true, quantidade: true } } },
    });
    if (!cotacao) throw new HttpError(404, 'Cotação não encontrada');
    if (cotacao.status !== 'ABERTA') throw new HttpError(409, 'Cotação já fechada');

    const respostas = await prisma.cotacaoResposta.findMany({
      where: { cotacaoId: id },
      select: { produtoId: true, fornecedorId: true, preco: true },
    });
    const quantidades = new Map<number, number>(cotacao.itens.map((i) => [i.produtoId, num(i.quantidade)] as const));

    const escolhidos: { produtoId: number; fornecedorId: number; preco: number }[] = [];
    if (dados.vencedores && dados.vencedores.length > 0) {
      const produtosVistos = new Set<number>();
      for (const v of dados.vencedores) {
        if (produtosVistos.has(v.produtoId)) throw new HttpError(400, 'Cada produto tem só um vencedor');
        produtosVistos.add(v.produtoId);
        if (!quantidades.has(v.produtoId)) throw new HttpError(400, 'Produto fora da cotação');
        const r = respostas.find((x) => x.produtoId === v.produtoId && x.fornecedorId === v.fornecedorId);
        if (!r) throw new HttpError(400, 'Vencedor sem resposta de preço');
        escolhidos.push({ produtoId: v.produtoId, fornecedorId: v.fornecedorId, preco: num(r.preco) });
      }
    } else {
      for (const item of cotacao.itens) {
        let melhor: (typeof respostas)[number] | undefined;
        for (const r of respostas) {
          if (r.produtoId === item.produtoId && (!melhor || num(r.preco) < num(melhor.preco))) melhor = r;
        }
        if (melhor) escolhidos.push({ produtoId: melhor.produtoId, fornecedorId: melhor.fornecedorId, preco: num(melhor.preco) });
      }
    }
    if (escolhidos.length === 0) throw new HttpError(400, 'Nenhuma resposta de preço para fechar a cotação');

    const lojaId = await lojaDaRequisicao(req);
    const porFornecedor = new Map<number, { produtoId: number; quantidade: number; precoUnitario: number }[]>();
    for (const e of escolhidos) {
      const lista = porFornecedor.get(e.fornecedorId) ?? [];
      lista.push({
        produtoId: e.produtoId,
        quantidade: quantidades.get(e.produtoId) ?? 0,
        precoUnitario: e.preco,
      });
      porFornecedor.set(e.fornecedorId, lista);
    }

    const criados = await prisma.$transaction(async (tx) => {
      const marcada = await tx.cotacao.updateMany({
        where: { id, status: 'ABERTA' },
        data: { status: 'FECHADA', fechadaEm: new Date() },
      });
      if (marcada.count === 0) throw new HttpError(409, 'Cotação já fechada');
      await tx.cotacaoResposta.updateMany({ where: { cotacaoId: id }, data: { vencedora: false } });
      for (const e of escolhidos) {
        await tx.cotacaoResposta.update({
          where: {
            cotacaoId_fornecedorId_produtoId: { cotacaoId: id, fornecedorId: e.fornecedorId, produtoId: e.produtoId },
          },
          data: { vencedora: true },
        });
      }
      const saida: RetornoRascunho[] = [];
      for (const [fornecedorId, itens] of porFornecedor) {
        saida.push(
          await criarRascunho(tx, { fornecedorId, lojaId, usuarioId: req.usuario.id, cotacaoId: id, itens }),
        );
      }
      return saida;
    });
    res.json(criados);
  }),
);

// Página pública da cotação (link enviado ao fornecedor). Mostra só o convite desse fornecedor.
publico.get(
  '/publico/cotacoes/:token',
  asyncHandler(async (req, res) => {
    const convite = await prisma.cotacaoFornecedor.findUnique({
      where: { token: String(req.params.token) },
      include: {
        fornecedor: { select: { nome: true } },
        cotacao: {
          include: {
            itens: {
              orderBy: { id: 'asc' },
              include: { produto: { select: { nome: true, unidade: true } } },
            },
          },
        },
      },
    });
    if (!convite) throw new HttpError(404, 'Cotação não encontrada');
    const [respostas, config] = await Promise.all([
      prisma.cotacaoResposta.findMany({
        where: { cotacaoId: convite.cotacaoId, fornecedorId: convite.fornecedorId },
      }),
      lerConfiguracao(),
    ]);
    const porProduto = new Map(respostas.map((r) => [r.produtoId, r] as const));
    res.json({
      titulo: convite.cotacao.titulo,
      prazo: iso(convite.cotacao.prazo),
      fornecedor: convite.fornecedor.nome,
      empresa: config.nome,
      fechada: convite.cotacao.status !== 'ABERTA',
      itens: convite.cotacao.itens.map((i) => {
        const r = porProduto.get(i.produtoId);
        return {
          produtoId: i.produtoId,
          nome: i.produto.nome,
          unidade: i.produto.unidade,
          quantidade: num(i.quantidade),
          precoRespondido: r ? num(r.preco) : null,
          prazoDias: r ? r.prazoDias : null,
        };
      }),
    });
  }),
);

// Fornecedor envia os preços pelo link. Não aceita depois que a cotação foi fechada.
publico.post(
  '/publico/cotacoes/:token',
  asyncHandler(async (req, res) => {
    const dados = validar(z.object({ precos: precosSchema }), req.body);
    const convite = await prisma.cotacaoFornecedor.findUnique({
      where: { token: String(req.params.token) },
      include: { cotacao: { select: { id: true, status: true } } },
    });
    if (!convite) throw new HttpError(404, 'Cotação não encontrada');
    if (convite.cotacao.status !== 'ABERTA') throw new HttpError(400, 'Esta cotação já foi fechada');
    confereProdutos(await itensDaCotacao(convite.cotacaoId), dados.precos);
    await prisma.$transaction((tx) =>
      gravarRespostas(tx, convite.cotacaoId, convite.fornecedorId, dados.precos),
    );
    res.json({ ok: true });
  }),
);

// ---------- Pedidos de compra ----------

const pedidoSchema = z.object({
  fornecedorId: z.number().int().positive(),
  itens: z
    .array(
      z.object({
        produtoId: z.number().int().positive(),
        quantidade: z.number().positive('Quantidade inválida').max(1000000),
        precoUnitario: z.number().min(0, 'Preço inválido').max(1000000),
      }),
    )
    .min(1, 'Inclua pelo menos um item')
    .max(300),
  previsaoEntrega: dataOpcional(),
  condicaoPagamento: textoOpcional(80),
  observacoes: textoOpcional(500),
});

async function detalhePedido(id: number, lojaId: number) {
  const p = await prisma.pedidoCompra.findFirst({
    where: { id, lojaId },
    include: {
      fornecedor: { select: { id: true, nome: true, whatsapp: true, telefone: true, email: true } },
      itens: {
        orderBy: { id: 'asc' },
        include: { produto: { select: { id: true, nome: true, codigo: true, unidade: true } } },
      },
      recebimentos: { orderBy: { id: 'asc' }, select: { id: true, status: true, criadoEm: true } },
    },
  });
  if (!p) throw new HttpError(404, 'Pedido não encontrado');
  return {
    id: p.id,
    numero: p.numero,
    status: p.status,
    fornecedor: p.fornecedor,
    total: num(p.total),
    condicaoPagamento: p.condicaoPagamento,
    previsaoEntrega: iso(p.previsaoEntrega),
    rastreio: p.rastreio,
    observacoes: p.observacoes,
    criadoEm: p.criadoEm.toISOString(),
    enviadoEm: iso(p.enviadoEm),
    confirmadoEm: iso(p.confirmadoEm),
    recebidoEm: iso(p.recebidoEm),
    cotacaoId: p.cotacaoId,
    itens: p.itens.map((i) => {
      const quantidade = num(i.quantidade);
      const precoUnitario = num(i.precoUnitario);
      return {
        id: i.id,
        produtoId: i.produtoId,
        nome: i.produto.nome,
        codigo: i.produto.codigo,
        unidade: i.produto.unidade,
        quantidade,
        precoUnitario,
        subtotal: arred2(quantidade * precoUnitario),
        quantidadeRecebida: num(i.quantidadeRecebida),
      };
    }),
    recebimentos: p.recebimentos.map((r) => ({ id: r.id, status: r.status, criadoEm: r.criadoEm.toISOString() })),
  };
}

type DetalhePedido = Awaited<ReturnType<typeof detalhePedido>>;

// Texto simples do pedido, para copiar ou mandar pelo WhatsApp.
function montarTextoPedido(p: DetalhePedido): string {
  const linhas = [`Pedido de compra nº ${p.numero}`, `Fornecedor: ${p.fornecedor.nome}`, '', 'Itens:'];
  for (const i of p.itens) {
    const quantidade = i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    linhas.push(`- ${quantidade} ${i.unidade.toLowerCase()} x ${i.nome} (${reais(i.precoUnitario)})`);
  }
  linhas.push('', `Total: ${reais(p.total)}`);
  if (p.condicaoPagamento) linhas.push(`Condição de pagamento: ${p.condicaoPagamento}`);
  if (p.previsaoEntrega) {
    linhas.push(`Previsão de entrega: ${new Date(p.previsaoEntrega).toLocaleDateString('pt-BR')}`);
  }
  return linhas.join('\n');
}

router.get(
  '/pedidos-compra',
  LEITURA_PEDIDOS,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const status = req.query.status;
    const where: Prisma.PedidoCompraWhereInput = { lojaId };
    if (typeof status === 'string' && status !== '') {
      if (!(STATUS_PEDIDO as string[]).includes(status)) throw new HttpError(400, 'Status inválido');
      where.status = status as StatusPedidoCompra;
    }
    const lista = await prisma.pedidoCompra.findMany({
      where,
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 300,
      include: { fornecedor: { select: { nome: true } }, _count: { select: { itens: true } } },
    });
    res.json(
      lista.map((p) => ({
        id: p.id,
        numero: p.numero,
        fornecedorId: p.fornecedorId,
        fornecedor: p.fornecedor.nome,
        status: p.status,
        total: num(p.total),
        criadoEm: p.criadoEm.toISOString(),
        previsaoEntrega: iso(p.previsaoEntrega),
        itens: p._count.itens,
        rastreio: p.rastreio,
      })),
    );
  }),
);

router.get(
  '/pedidos-compra/:id',
  LEITURA_PEDIDOS,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    res.json(await detalhePedido(idParam(req), lojaId));
  }),
);

router.post(
  '/pedidos-compra',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const dados = validar(pedidoSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    await validarFornecedores([dados.fornecedorId]);
    await validarProdutos(dados.itens.map((i) => i.produtoId));
    const criado = await prisma.$transaction((tx) =>
      criarRascunho(tx, {
        fornecedorId: dados.fornecedorId,
        lojaId,
        usuarioId: req.usuario.id,
        itens: dados.itens,
        previsaoEntrega: dados.previsaoEntrega ?? null,
        condicaoPagamento: dados.condicaoPagamento ?? null,
        observacoes: dados.observacoes ?? null,
      }),
    );
    res.status(201).json(await detalhePedido(criado.pedidoId, lojaId));
  }),
);

router.put(
  '/pedidos-compra/:id',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(pedidoSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const atual = await prisma.pedidoCompra.findFirst({ where: { id, lojaId }, select: { status: true } });
    if (!atual) throw new HttpError(404, 'Pedido não encontrado');
    if (atual.status !== 'RASCUNHO') throw new HttpError(409, 'Só é possível alterar pedido em rascunho');
    await validarFornecedores([dados.fornecedorId]);
    await validarProdutos(dados.itens.map((i) => i.produtoId));
    const { linhas, total } = linhasDoPedido(dados.itens);

    await prisma.$transaction(async (tx) => {
      // A condição de status evita alterar um pedido que acabou de ser enviado.
      const marcada = await tx.pedidoCompra.updateMany({
        where: { id, lojaId, status: 'RASCUNHO' },
        data: {
          fornecedorId: dados.fornecedorId,
          total,
          condicaoPagamento: dados.condicaoPagamento,
          previsaoEntrega: dados.previsaoEntrega,
          observacoes: dados.observacoes,
        },
      });
      if (marcada.count === 0) throw new HttpError(409, 'Só é possível alterar pedido em rascunho');
      await tx.pedidoCompraItem.deleteMany({ where: { pedidoId: id } });
      await tx.pedidoCompraItem.createMany({ data: linhas.map((l) => ({ pedidoId: id, ...l })) });
    });
    res.json(await detalhePedido(id, lojaId));
  }),
);

const statusSchema = z.object({
  status: z.enum(['ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'CANCELADO']),
  rastreio: textoOpcional(120),
  previsaoEntrega: dataOpcional(),
});

// Avança o pedido. Responde o pedido com o texto para copiar ou mandar por WhatsApp.
// O envio de e-mail ao fornecedor não é feito aqui: lib/email não tem tipo de e-mail para pedido de compra.
router.post(
  '/pedidos-compra/:id/status',
  COMPRAS,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(statusSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const pedido = await prisma.pedidoCompra.findFirst({
      where: { id, lojaId },
      select: { status: true, itens: { select: { quantidadeRecebida: true } } },
    });
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
    const permitidos = TRANSICOES[pedido.status] ?? [];
    if (!permitidos.includes(dados.status)) {
      throw new HttpError(409, `Não é possível mudar o pedido de ${pedido.status} para ${dados.status}`);
    }
    if (dados.status === 'CANCELADO' && pedido.itens.some((i) => num(i.quantidadeRecebida) > 0)) {
      throw new HttpError(409, 'Pedido com itens já recebidos não pode ser cancelado');
    }
    const agora = new Date();
    const marcada = await prisma.pedidoCompra.updateMany({
      where: { id, lojaId, status: pedido.status },
      data: {
        status: dados.status,
        rastreio: dados.rastreio,
        previsaoEntrega: dados.previsaoEntrega,
        ...(dados.status === 'ENVIADO' ? { enviadoEm: agora } : {}),
        ...(dados.status === 'CONFIRMADO' ? { confirmadoEm: agora } : {}),
      },
    });
    if (marcada.count === 0) throw new HttpError(409, 'O pedido mudou ao mesmo tempo. Atualize a tela.');
    const detalhe = await detalhePedido(id, lojaId);
    const textoPedido = montarTextoPedido(detalhe);
    // Ao enviar, manda o pedido por e-mail ao fornecedor (se ele tiver e-mail e o e-mail da plataforma estiver ligado).
    if (dados.status === 'ENVIADO') {
      const fornecedor = await prisma.fornecedor.findUnique({ where: { id: detalhe.fornecedor.id }, select: { email: true } });
      if (fornecedor?.email && (await emailHabilitado('FORNECEDOR'))) {
        const { nome } = await lerConfiguracao();
        enfileirarEmail({
          para: fornecedor.email,
          assunto: `Pedido de compra nº ${detalhe.numero} - ${nome}`,
          titulo: `Pedido de compra nº ${detalhe.numero}`,
          paragrafos: textoPedido.split(/\r?\n/).filter((linha) => linha.trim() !== ''),
          tipo: 'FORNECEDOR',
        });
      }
    }
    res.json({ ...detalhe, textoPedido });
  }),
);

router.get(
  '/pedidos-compra/:id/texto',
  LEITURA_PEDIDOS,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const detalhe = await detalhePedido(idParam(req), lojaId);
    res.json({ textoPedido: montarTextoPedido(detalhe) });
  }),
);

// ---------- Recebimento de mercadoria ----------

const recebimentoSchema = z.object({
  pedidoCompraId: z.number().int().positive().nullish(),
  xml: z.string().min(20, 'XML vazio').max(3000000, 'XML grande demais').nullish(),
});

// Fornecedor de uma NF-e: pelo CNPJ; cria o cadastro se ainda não existir.
// Produto: pelo EAN, ou pelo código do fornecedor já vinculado.
async function acharProdutoDaNota(fornecedorId: number, cProd: string, cEAN: string | null): Promise<number | null> {
  if (cEAN) {
    const porEan = await prisma.produto.findUnique({ where: { ean: cEAN }, select: { id: true } });
    if (porEan) return porEan.id;
  }
  if (!cProd) return null;
  const vinculo = await prisma.produtoFornecedor.findFirst({
    where: { fornecedorId, codigoFornecedor: cProd },
    select: { produtoId: true },
  });
  return vinculo ? vinculo.produtoId : null;
}

interface ItemNaoAssociado {
  cProd: string;
  cEAN: string | null;
  xProd: string;
  qCom: number;
  vUnCom: number;
}

// Itens do XML que ainda não têm produto no sistema (o usuário associa na conferência).
async function naoAssociadosDaNota(xml: string | null, fornecedorId: number): Promise<ItemNaoAssociado[]> {
  if (!xml) return [];
  const nota = lerNfe(xml);
  if (!nota) return [];
  const pendentes: ItemNaoAssociado[] = [];
  for (const item of nota.itens) {
    const produtoId = await acharProdutoDaNota(fornecedorId, item.cProd, item.cEAN);
    if (produtoId === null) {
      pendentes.push({ cProd: item.cProd, cEAN: item.cEAN, xProd: item.xProd, qCom: item.qCom, vUnCom: item.vUnCom });
    }
  }
  return pendentes;
}

async function importarNfe(xml: string, lojaId: number, usuarioId: number): Promise<number> {
  const nota = lerNfe(xml);
  if (!nota) throw new HttpError(400, 'Este arquivo não parece uma NF-e válida');
  if (nota.chave) {
    const repetida = await prisma.recebimento.findFirst({ where: { chaveNfe: nota.chave }, select: { id: true } });
    if (repetida) throw new HttpError(409, 'Esta NF-e já foi importada');
  }

  let fornecedor = await prisma.fornecedor.findUnique({ where: { cnpj: nota.cnpj }, select: { id: true } });
  if (!fornecedor) {
    fornecedor = await prisma.fornecedor.create({
      data: { nome: nota.nomeEmitente || `Fornecedor ${nota.cnpj}`, cnpj: nota.cnpj },
      select: { id: true },
    });
  }

  // Se houver pedido aberto deste fornecedor, vincula o mais antigo.
  const pedido = await prisma.pedidoCompra.findFirst({
    where: { fornecedorId: fornecedor.id, lojaId, status: { in: ['ENVIADO', 'CONFIRMADO', 'EM_TRANSITO'] } },
    orderBy: { criadoEm: 'asc' },
    select: { id: true },
  });

  const itens: {
    produtoId: number;
    quantidadeNota: number;
    precoUnitario: number;
    lote: string | null;
    validade: Date | null;
  }[] = [];
  for (const item of nota.itens) {
    const produtoId = await acharProdutoDaNota(fornecedor.id, item.cProd, item.cEAN);
    if (produtoId !== null) {
      itens.push({
        produtoId,
        quantidadeNota: arred3(item.qCom),
        precoUnitario: arred4(item.vUnCom),
        lote: item.lote,
        validade: item.validade,
      });
    }
  }

  const recebimento = await prisma.recebimento.create({
    data: {
      pedidoCompraId: pedido ? pedido.id : null,
      fornecedorId: fornecedor.id,
      lojaId,
      numeroNota: nota.numero,
      serieNota: nota.serie,
      chaveNfe: nota.chave,
      valorNota: nota.valor !== null ? arred2(nota.valor) : null,
      xml,
      status: 'CONFERINDO',
      usuarioId,
      itens: { create: itens },
    },
    select: { id: true },
  });
  return recebimento.id;
}

async function abrirRecebimentoDoPedido(pedidoId: number, lojaId: number, usuarioId: number): Promise<number> {
  const pedido = await prisma.pedidoCompra.findFirst({
    where: { id: pedidoId, lojaId },
    include: {
      itens: { select: { produtoId: true, quantidade: true, quantidadeRecebida: true, precoUnitario: true } },
    },
  });
  if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
  if (!PEDIDO_ABERTO.includes(pedido.status)) {
    throw new HttpError(409, 'Este pedido não pode ser recebido agora');
  }
  const emConferencia = await prisma.recebimento.findFirst({
    where: { pedidoCompraId: pedido.id, status: 'CONFERINDO' },
    select: { id: true },
  });
  if (emConferencia) throw new HttpError(409, 'Já existe um recebimento em conferência para este pedido');

  const itens = pedido.itens
    .map((i) => ({
      produtoId: i.produtoId,
      quantidadeNota: arred3(num(i.quantidade) - num(i.quantidadeRecebida)),
      precoUnitario: num(i.precoUnitario),
    }))
    .filter((i) => i.quantidadeNota > 0);
  if (itens.length === 0) throw new HttpError(409, 'Todos os itens deste pedido já foram recebidos');

  const recebimento = await prisma.recebimento.create({
    data: {
      pedidoCompraId: pedido.id,
      fornecedorId: pedido.fornecedorId,
      lojaId,
      status: 'CONFERINDO',
      usuarioId,
      itens: { create: itens },
    },
    select: { id: true },
  });
  return recebimento.id;
}

async function recebimentoEmConferencia(id: number, lojaId: number) {
  const r = await prisma.recebimento.findFirst({ where: { id, lojaId }, select: { id: true, status: true, fornecedorId: true } });
  if (!r) throw new HttpError(404, 'Recebimento não encontrado');
  if (r.status !== 'CONFERINDO') throw new HttpError(409, 'Este recebimento já foi concluído');
  return r;
}

async function detalheRecebimento(id: number, lojaId: number) {
  const r = await prisma.recebimento.findFirst({
    where: { id, lojaId },
    include: {
      fornecedor: { select: { id: true, nome: true, prazoEntregaDias: true, condicaoPagamento: true } },
      itens: {
        orderBy: { id: 'asc' },
        include: {
          produto: { select: { id: true, nome: true, codigo: true, unidade: true, precoCusto: true, precoVenda: true } },
        },
      },
    },
  });
  if (!r) throw new HttpError(404, 'Recebimento não encontrado');
  const [config, vinculos] = await Promise.all([
    lerConfiguracao(),
    prisma.produtoFornecedor.findMany({
      where: { fornecedorId: r.fornecedorId, produtoId: { in: r.itens.map((i) => i.produtoId) } },
      select: { produtoId: true, fatorConversao: true },
    }),
  ]);
  const fatorDe = new Map<number, number>(
    vinculos.map((v) => [v.produtoId, num(v.fatorConversao) > 0 ? num(v.fatorConversao) : 1] as const),
  );

  const itens = r.itens.map((i) => {
    const fator = fatorDe.get(i.produtoId) ?? 1;
    const custoNovo = arred4(num(i.precoUnitario) / fator);
    return {
      id: i.id,
      produtoId: i.produtoId,
      nome: i.produto.nome,
      codigo: i.produto.codigo,
      unidade: i.produto.unidade,
      quantidadeNota: num(i.quantidadeNota),
      quantidadeRecebida: numOuNull(i.quantidadeRecebida),
      precoUnitario: num(i.precoUnitario),
      fatorConversao: fator,
      lote: i.lote,
      validade: iso(i.validade),
      divergencia: i.divergencia,
      custoAtual: num(i.produto.precoCusto),
      precoVendaAtual: num(i.produto.precoVenda),
      precoSugerido: sugerirPrecoVenda(custoNovo, num(config.margemPadrao), config.arredondarPreco),
    };
  });

  return {
    id: r.id,
    status: r.status,
    numeroNota: r.numeroNota,
    serieNota: r.serieNota,
    chaveNfe: r.chaveNfe,
    valorNota: numOuNull(r.valorNota),
    fornecedor: r.fornecedor,
    pedidoCompraId: r.pedidoCompraId,
    observacoes: r.observacoes,
    criadoEm: r.criadoEm.toISOString(),
    concluidoEm: iso(r.concluidoEm),
    itens,
    naoAssociados: await naoAssociadosDaNota(r.xml, r.fornecedorId),
  };
}

router.get(
  '/recebimentos',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const lista = await prisma.recebimento.findMany({
      where: { lojaId },
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { fornecedor: { select: { nome: true } }, _count: { select: { itens: true } } },
    });
    res.json(
      lista.map((r) => ({
        id: r.id,
        numeroNota: r.numeroNota,
        fornecedorId: r.fornecedorId,
        fornecedor: r.fornecedor.nome,
        status: r.status,
        valorNota: numOuNull(r.valorNota),
        pedidoCompraId: r.pedidoCompraId,
        itens: r._count.itens,
        criadoEm: r.criadoEm.toISOString(),
        concluidoEm: iso(r.concluidoEm),
      })),
    );
  }),
);

router.get(
  '/recebimentos/:id',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    res.json(await detalheRecebimento(idParam(req), lojaId));
  }),
);

// Abre um recebimento: pelo pedido de compra, ou pela NF-e (XML enviado como texto).
router.post(
  '/recebimentos',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const dados = validar(recebimentoSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    if (dados.xml) {
      const id = await importarNfe(dados.xml, lojaId, req.usuario.id);
      res.status(201).json(await detalheRecebimento(id, lojaId));
      return;
    }
    if (dados.pedidoCompraId) {
      const id = await abrirRecebimentoDoPedido(dados.pedidoCompraId, lojaId, req.usuario.id);
      res.status(201).json(await detalheRecebimento(id, lojaId));
      return;
    }
    throw new HttpError(400, 'Informe o pedido de compra ou o XML da NF-e');
  }),
);

const itemRecebimentoSchema = z.object({
  quantidadeRecebida: z.number().min(0, 'Quantidade inválida').max(1000000),
  lote: textoOpcional(60),
  validade: dataOpcional(),
  divergencia: textoOpcional(200),
});

router.put(
  '/recebimentos/:id/itens/:itemId',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const itemId = idParam(req, 'itemId');
    const dados = validar(itemRecebimentoSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    await recebimentoEmConferencia(id, lojaId);
    const item = await prisma.recebimentoItem.findFirst({
      where: { id: itemId, recebimentoId: id },
      select: { id: true },
    });
    if (!item) throw new HttpError(404, 'Item não encontrado');
    await prisma.recebimentoItem.update({
      where: { id: itemId },
      data: {
        quantidadeRecebida: arred3(dados.quantidadeRecebida),
        lote: dados.lote,
        validade: dados.validade,
        divergencia: dados.divergencia,
      },
    });
    res.json(await detalheRecebimento(id, lojaId));
  }),
);

const biparSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código').max(60),
  quantidade: z.number().positive().max(100000).nullish(),
});

// Bipagem: soma 1 (ou a quantidade informada) ao item do produto com aquele EAN ou código.
router.put(
  '/recebimentos/:id/bipar',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(biparSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const recebimento = await recebimentoEmConferencia(id, lojaId);

    const candidatos: number[] = [];
    const porCodigo = await prisma.produto.findFirst({
      where: { OR: [{ ean: dados.codigo }, { codigo: dados.codigo }] },
      select: { id: true },
    });
    if (porCodigo) candidatos.push(porCodigo.id);
    const vinculo = await prisma.produtoFornecedor.findFirst({
      where: { fornecedorId: recebimento.fornecedorId, codigoFornecedor: dados.codigo },
      select: { produtoId: true },
    });
    if (vinculo) candidatos.push(vinculo.produtoId);

    const itens = await prisma.recebimentoItem.findMany({
      where: { recebimentoId: id },
      select: { id: true, produtoId: true, quantidadeRecebida: true },
    });
    let alvo: (typeof itens)[number] | undefined;
    for (const c of candidatos) {
      alvo = itens.find((i) => i.produtoId === c);
      if (alvo) break;
    }
    if (!alvo) throw new HttpError(404, 'Código não encontrado nesta nota');

    const somar = dados.quantidade ?? 1;
    await prisma.recebimentoItem.update({
      where: { id: alvo.id },
      data: { quantidadeRecebida: arred3(num(alvo.quantidadeRecebida) + somar) },
    });
    res.json(await detalheRecebimento(id, lojaId));
  }),
);

// Associa um item do XML a um produto: cria o vínculo com o fornecedor e o item da conferência.
router.put(
  '/recebimentos/:id/associar',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(
      z.object({ cProd: z.string().trim().min(1, 'Código do fornecedor'), produtoId: z.number().int().positive() }),
      req.body,
    );
    const lojaId = await lojaDaRequisicao(req);
    const recebimento = await recebimentoEmConferencia(id, lojaId);
    const produto = await prisma.produto.findUnique({ where: { id: dados.produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(404, 'Produto não encontrado');

    const xml = await prisma.recebimento.findUnique({ where: { id }, select: { xml: true } });
    const nota = xml?.xml ? lerNfe(xml.xml) : null;
    const item: ItemNfe | undefined = nota?.itens.find((i) => i.cProd === dados.cProd);
    if (!item) throw new HttpError(400, 'Item não encontrado na NF-e');

    const jaNaNota = await prisma.recebimentoItem.findFirst({
      where: { recebimentoId: id, produtoId: dados.produtoId },
      select: { id: true },
    });
    if (jaNaNota) throw new HttpError(409, 'Este produto já está nesta nota');

    await prisma.$transaction(async (tx) => {
      await tx.produtoFornecedor.upsert({
        where: { produtoId_fornecedorId: { produtoId: dados.produtoId, fornecedorId: recebimento.fornecedorId } },
        create: {
          produtoId: dados.produtoId,
          fornecedorId: recebimento.fornecedorId,
          codigoFornecedor: dados.cProd,
          fatorConversao: 1,
        },
        update: { codigoFornecedor: dados.cProd },
      });
      await tx.recebimentoItem.create({
        data: {
          recebimentoId: id,
          produtoId: dados.produtoId,
          quantidadeNota: arred3(item.qCom),
          precoUnitario: arred4(item.vUnCom),
          lote: item.lote,
          validade: item.validade,
        },
      });
    });
    res.json(await detalheRecebimento(id, lojaId));
  }),
);

const concluirSchema = z.object({
  gerarFinanceiro: z.boolean(),
  parcelas: z.number().int().min(1).max(36).nullish(),
  primeiroVencimento: z.string().regex(DATA_DIA, 'Data inválida').nullish(),
  atualizarPrecos: z
    .array(z.object({ produtoId: z.number().int().positive(), precoVenda: z.number().min(0).max(1000000) }))
    .nullish(),
});

// Divide o total em parcelas iguais; a última leva a diferença de centavos.
function dividirParcelas(total: number, parcelas: number): number[] {
  const base = arred2(total / parcelas);
  const valores: number[] = Array.from({ length: parcelas }, () => base);
  valores[parcelas - 1] = arred2(total - base * (parcelas - 1));
  return valores;
}

// Conclui a conferência: entra no estoque (com lote), atualiza custo e pedido, gera a despesa e preços.
router.post(
  '/recebimentos/:id/concluir',
  RECEBIMENTO,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(concluirSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const usuarioId = req.usuario.id;
    const rec = await prisma.recebimento.findFirst({
      where: { id, lojaId },
      include: { fornecedor: { select: { id: true, nome: true } }, itens: true },
    });
    if (!rec) throw new HttpError(404, 'Recebimento não encontrado');
    if (rec.status !== 'CONFERINDO') throw new HttpError(409, 'Este recebimento já foi concluído');

    const recebidos = rec.itens.filter((i) => num(i.quantidadeRecebida) > 0);
    if (recebidos.length === 0) throw new HttpError(400, 'Confira ao menos um item antes de concluir');

    const idsNaNota = new Set(rec.itens.map((i) => i.produtoId));
    for (const p of dados.atualizarPrecos ?? []) {
      if (!idsNaNota.has(p.produtoId)) throw new HttpError(400, 'Preço de produto que não está nesta nota');
    }

    const divergente = rec.itens.some(
      (i) => num(i.quantidadeRecebida) !== num(i.quantidadeNota) || Boolean(i.divergencia && i.divergencia.trim()),
    );
    const status: StatusRecebimento = divergente ? 'COM_DIVERGENCIA' : 'CONCLUIDO';

    const vinculos = await prisma.produtoFornecedor.findMany({
      where: { fornecedorId: rec.fornecedorId, produtoId: { in: recebidos.map((i) => i.produtoId) } },
      select: { produtoId: true, fatorConversao: true },
    });
    const fatorDe = new Map<number, number>(
      vinculos.map((v) => [v.produtoId, num(v.fatorConversao) > 0 ? num(v.fatorConversao) : 1] as const),
    );

    const valorTotal = arred2(
      recebidos.reduce((soma, i) => soma + num(i.quantidadeRecebida) * num(i.precoUnitario), 0),
    );
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      // Primeiro a troca de status: se outra requisição já concluiu, esta para aqui (409).
      const marcada = await tx.recebimento.updateMany({
        where: { id, status: 'CONFERINDO' },
        data: { status, concluidoEm: agora },
      });
      if (marcada.count === 0) throw new HttpError(409, 'Este recebimento já foi concluído');

      for (const item of recebidos) {
        const fator = fatorDe.get(item.produtoId) ?? 1;
        // A nota vem na unidade do fornecedor (ex.: caixa). Estoque e custo ficam na unidade do produto.
        const quantidadeEstoque = arred3(num(item.quantidadeRecebida) * fator);
        const custo = arred4(num(item.precoUnitario) / fator);
        await atualizarCustoMedio(tx, item.produtoId, quantidadeEstoque, custo);
        await movimentarEstoque(tx, {
          produtoId: item.produtoId,
          lojaId,
          tipo: 'ENTRADA',
          quantidade: quantidadeEstoque,
          custoUnitario: custo,
          motivo: `Recebimento #${id}`,
          referencia: `recebimento:${id}`,
          usuarioId,
          lote:
            item.lote && item.validade
              ? { codigo: item.lote, validade: item.validade, recebimentoId: id }
              : null,
        });
        await tx.produtoFornecedor.upsert({
          where: { produtoId_fornecedorId: { produtoId: item.produtoId, fornecedorId: rec.fornecedorId } },
          create: {
            produtoId: item.produtoId,
            fornecedorId: rec.fornecedorId,
            ultimoPreco: arred4(num(item.precoUnitario)),
            fatorConversao: fator,
          },
          update: { ultimoPreco: arred4(num(item.precoUnitario)) },
        });
      }

      if (rec.pedidoCompraId) {
        for (const item of recebidos) {
          const linhaPedido = await tx.pedidoCompraItem.findFirst({
            where: { pedidoId: rec.pedidoCompraId, produtoId: item.produtoId },
          });
          if (linhaPedido) {
            await tx.pedidoCompraItem.update({
              where: { id: linhaPedido.id },
              data: {
                quantidadeRecebida: arred3(num(linhaPedido.quantidadeRecebida) + num(item.quantidadeRecebida)),
              },
            });
          }
        }
        const itensPedido = await tx.pedidoCompraItem.findMany({ where: { pedidoId: rec.pedidoCompraId } });
        const completo = itensPedido.every((i) => num(i.quantidadeRecebida) >= num(i.quantidade));
        await tx.pedidoCompra.update({
          where: { id: rec.pedidoCompraId },
          data: { status: completo ? 'RECEBIDO' : 'RECEBIDO_PARCIAL', recebidoEm: agora },
        });
      }

      if (dados.gerarFinanceiro && valorTotal > 0) {
        const categoria = await tx.categoriaFinanceira.findUnique({
          where: { nome_tipo: { nome: 'Fornecedores', tipo: 'DESPESA' } },
          select: { id: true },
        });
        const parcelas = dados.parcelas ?? 1;
        const primeiro = dados.primeiroVencimento
          ? diaAoMeioDia(dados.primeiroVencimento)
          : new Date(hojeAoMeioDia().getTime() + 28 * 24 * 60 * 60 * 1000);
        const valores = dividirParcelas(valorTotal, parcelas);
        for (let i = 0; i < parcelas; i++) {
          const vencimento = new Date(primeiro);
          vencimento.setMonth(primeiro.getMonth() + i);
          await tx.lancamento.create({
            data: {
              tipo: 'DESPESA',
              origem: 'COMPRA',
              descricao: `NF ${rec.numeroNota ?? rec.id} - ${rec.fornecedor.nome}`,
              valor: valores[i],
              vencimento,
              categoriaId: categoria ? categoria.id : null,
              lojaId,
              fornecedorId: rec.fornecedorId,
              documento: rec.numeroNota,
              parcela: i + 1,
              totalParcelas: parcelas,
              referencia: `recebimento:${id}`,
            },
          });
        }
      }

      for (const p of dados.atualizarPrecos ?? []) {
        await alterarPreco(tx, { produtoId: p.produtoId, precoVenda: p.precoVenda, usuarioId, motivo: 'Recebimento' });
      }
    });
    res.json(await detalheRecebimento(id, lojaId));
  }),
);

export default router;
