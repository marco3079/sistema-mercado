import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma, StatusPedidoVenda, TipoCliente } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { arred2, arred3, codigoAleatorio, fimDoDia, inicioDoDia, num, numOuNull } from '../../lib/numeros';
import { calcularPreco, promocoesVigentes } from '../../lib/precos';
import { cancelarVenda, registrarVenda } from '../../lib/vendas';
import type { Tx } from '../../lib/estoque';
import { lerConfiguracao } from '../../lib/email';
import { criarEntrega } from '../logistica/entregas';

// Comercial: força de vendas (pedidos com preço negociado e flex), faturamento em lote,
// loja B2B por código do cliente, delivery próprio (página pública) e marketplace simulado.

export const publico = Router();
const router = Router();

const STATUS_PEDIDO = ['ORCAMENTO', 'PENDENTE', 'APROVADO', 'SEPARANDO', 'FATURADO', 'CANCELADO'] as const;
const ORIGENS_PEDIDO = ['FORCA_VENDAS', 'B2B'] as const;
const STATUS_ENTREGA = ['PENDENTE', 'SEPARANDO', 'EM_ROTA', 'ENTREGUE', 'FALHOU', 'CANCELADA'] as const;
const FORMAS_PEDIDO = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'FIADO', 'VALE_ALIMENTACAO', 'BOLETO'] as const;
const ABERTOS: StatusPedidoVenda[] = ['ORCAMENTO', 'PENDENTE', 'APROVADO', 'SEPARANDO'];

// ---------- Auxiliares ----------

function textoQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function numeroQuery(valor: unknown): number | undefined {
  const n = Number(textoQuery(valor));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function enumQuery<T extends string>(valor: unknown, lista: readonly T[]): T | undefined {
  const texto = textoQuery(valor);
  if (texto === undefined) return undefined;
  if (!lista.includes(texto as T)) throw new HttpError(400, 'Filtro inválido');
  return texto as T;
}

function dataOuNull(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

// Vendedor só mexe nos próprios pedidos.
function soDono(req: Request, vendedorId: number | null): void {
  if (req.usuario.perfil === 'VENDEDOR' && vendedorId !== req.usuario.id) {
    throw new HttpError(403, 'Pedido de outro vendedor');
  }
}

async function lojaPadrao(): Promise<number> {
  const loja = await prisma.loja.findFirst({ where: { ativa: true }, orderBy: { id: 'asc' }, select: { id: true } });
  if (!loja) throw new HttpError(400, 'Cadastre uma loja antes de continuar');
  return loja.id;
}

// Loja do cardápio público: ?loja=ID ou a primeira loja ativa.
async function lojaDoParametro(req: Request): Promise<number> {
  const pedida = numeroQuery(req.query.loja);
  if (pedida === undefined) return lojaPadrao();
  const loja = await prisma.loja.findFirst({ where: { id: pedida, ativa: true }, select: { id: true } });
  if (!loja) throw new HttpError(404, 'Loja não encontrada');
  return loja.id;
}

async function clientePorCodigoB2B(codigo: string) {
  const cliente = await prisma.cliente.findUnique({ where: { codigoB2B: codigo } });
  if (!cliente || !cliente.ativo || cliente.bloqueado) throw new HttpError(404, 'Loja não encontrada');
  return cliente;
}

const incluirPedido = {
  cliente: {
    select: { id: true, nome: true, tipo: true, endereco: true, numero: true, bairro: true, cidade: true, telefone: true, whatsapp: true },
  },
  vendedor: { select: { id: true, nome: true } },
  venda: { select: { numero: true } },
  entrega: { select: { codigo: true, status: true } },
  itens: {
    orderBy: { id: 'asc' },
    include: { produto: { select: { nome: true, unidade: true, foto: true, categoria: { select: { nome: true } } } } },
  },
} satisfies Prisma.PedidoVendaInclude;

type PedidoCompleto = Prisma.PedidoVendaGetPayload<{ include: typeof incluirPedido }>;

async function buscarPedido(id: number): Promise<PedidoCompleto> {
  const pedido = await prisma.pedidoVenda.findUnique({ where: { id }, include: incluirPedido });
  if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
  return pedido;
}

function paraLista(p: PedidoCompleto) {
  return {
    id: p.id,
    numero: p.numero,
    cliente: p.cliente.nome,
    vendedor: p.vendedor?.nome ?? null,
    origem: p.origem,
    status: p.status,
    total: num(p.total),
    subtotalTabela: num(p.subtotalTabela),
    flex: num(p.flex),
    criadoEm: p.criadoEm.toISOString(),
    faturadoEm: p.faturadoEm?.toISOString() ?? null,
    vendaNumero: p.venda?.numero ?? null,
    entregaCodigo: p.entrega?.codigo ?? null,
  };
}

function paraDetalhe(p: PedidoCompleto) {
  return {
    ...paraLista(p),
    clienteId: p.clienteId,
    vendedorId: p.vendedorId,
    condicaoPagamento: p.condicaoPagamento,
    formaPagamento: p.formaPagamento,
    previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
    observacoes: p.observacoes,
    itens: p.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      produto: i.produto.nome,
      unidade: i.produto.unidade,
      foto: i.produto.foto ?? null,
      categoria: i.produto.categoria?.nome ?? null,
      quantidade: num(i.quantidade),
      precoTabela: num(i.precoTabela),
      precoNegociado: num(i.precoNegociado),
      total: num(i.total),
    })),
  };
}

// Preço de tabela (com promoção/atacado) de cada item, já na quantidade pedida.
async function precificar(tx: Tx, itens: { produtoId: number; quantidade: number }[], tipo: TipoCliente) {
  const ids = Array.from(new Set(itens.map((i) => i.produtoId)));
  const produtos = await tx.produto.findMany({ where: { id: { in: ids } } });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = porId.get(id);
    if (!p || !p.ativo) throw new HttpError(400, `Produto ${id} não encontrado ou inativo`);
  }
  const promocoes = await promocoesVigentes(produtos, tx);
  return itens.map((item) => {
    const quantidade = arred3(item.quantidade);
    if (!(quantidade > 0)) throw new HttpError(400, 'Quantidade inválida');
    const produto = porId.get(item.produtoId)!;
    return { produto, quantidade, calc: calcularPreco(produto, quantidade, promocoes, tipo) };
  });
}

interface ItemPedido {
  produtoId: number;
  quantidade: number;
  precoNegociado?: number;
}

// Monta as linhas do pedido: flex = Σ(precoNegociado - precoTabela) × qtd.
async function montarPedido(tx: Tx, itens: ItemPedido[], tipo: TipoCliente) {
  const precos = await precificar(tx, itens, tipo);
  let subtotalTabela = 0;
  let total = 0;
  let flex = 0;
  const linhas = precos.map((l, i) => {
    const precoTabela = arred2(l.calc.precoUnitario);
    const precoNegociado = arred2(itens[i].precoNegociado ?? precoTabela);
    const totalItem = arred2(precoNegociado * l.quantidade);
    subtotalTabela += l.calc.total;
    total += totalItem;
    flex += (precoNegociado - precoTabela) * l.quantidade;
    return { produtoId: l.produto.id, quantidade: l.quantidade, precoTabela, precoNegociado, total: totalItem };
  });
  return { linhas, subtotalTabela: arred2(subtotalTabela), total: arred2(total), flex: arred2(flex) };
}

// Flex negativo consome o saldo do vendedor; não pode deixar o saldo abaixo de zero.
async function validarFlex(tx: Tx, vendedorId: number | null, flex: number): Promise<void> {
  if (vendedorId === null || flex >= 0) return;
  const vendedor = await tx.usuario.findUnique({ where: { id: vendedorId }, select: { saldoFlex: true } });
  if (num(vendedor?.saldoFlex) + flex < 0) throw new HttpError(400, 'Saldo de flex insuficiente');
}

function paraEntregaVenda(v: {
  id: number;
  numero: number;
  origem: string;
  marketplaceId: string | null;
  total: unknown;
  criadoEm: Date;
  cliente: { nome: string; telefone: string | null; whatsapp: string | null } | null;
  pagamentos: { forma: string }[];
  itens: { descricao: string; quantidade: unknown; precoUnitario: unknown; total: unknown; produto?: { foto: string | null } | null }[];
  entrega: {
    id: number;
    codigo: string;
    status: string;
    destinatario: string;
    telefone: string | null;
    endereco: string;
    bairro: string | null;
  } | null;
}) {
  return {
    vendaId: v.id,
    numero: v.numero,
    origem: v.origem,
    marketplaceId: v.marketplaceId,
    cliente: v.entrega?.destinatario ?? v.cliente?.nome ?? null,
    telefone: v.entrega?.telefone ?? v.cliente?.whatsapp ?? v.cliente?.telefone ?? null,
    endereco: v.entrega ? [v.entrega.endereco, v.entrega.bairro].filter(Boolean).join(', ') : null,
    total: num(v.total as number),
    formas: v.pagamentos.map((p) => p.forma),
    entrega: v.entrega ? { id: v.entrega.id, codigo: v.entrega.codigo, status: v.entrega.status } : null,
    criadoEm: v.criadoEm.toISOString(),
    itens: v.itens.map((i) => ({
      descricao: i.descricao,
      foto: i.produto?.foto ?? null,
      quantidade: num(i.quantidade as number),
      precoUnitario: num(i.precoUnitario as number),
      total: num(i.total as number),
    })),
  };
}

const incluirVendaEntrega = {
  cliente: { select: { nome: true, telefone: true, whatsapp: true } },
  itens: { orderBy: { id: 'asc' }, include: { produto: { select: { foto: true } } } },
  pagamentos: { orderBy: { id: 'asc' } },
  entrega: { select: { id: true, codigo: true, status: true, destinatario: true, telefone: true, endereco: true, bairro: true } },
} satisfies Prisma.VendaInclude;

// ---------- Força de vendas ----------

const itemPedidoSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().positive().max(100000),
  precoNegociado: z.number().nonnegative().max(1000000).optional(),
});

const pedidoSchema = z.object({
  clienteId: z.number().int().positive(),
  itens: z.array(itemPedidoSchema).min(1, 'Inclua ao menos um produto').max(200),
  condicaoPagamento: z.string().trim().max(120).nullish(),
  formaPagamento: z.enum(FORMAS_PEDIDO).nullish(),
  previsaoEntrega: z.string().nullish(),
  observacoes: z.string().trim().max(1000).nullish(),
  orcamento: z.boolean().optional(),
});

// Catálogo para o vendedor: preço de tabela para o cliente, estoque na loja e promoção.
router.get(
  '/pedidos-venda/precos',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const clienteId = numeroQuery(req.query.clienteId);
    const busca = textoQuery(req.query.busca);
    const cliente = clienteId ? await prisma.cliente.findUnique({ where: { id: clienteId }, select: { tipo: true } }) : null;
    const tipo: TipoCliente = cliente?.tipo ?? 'VAREJO';

    const where: Prisma.ProdutoWhereInput = { ativo: true, insumo: false };
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { codigo: { equals: busca } },
        { ean: { equals: busca } },
      ];
    }
    const produtos = await prisma.produto.findMany({
      where,
      include: { categoria: { select: { nome: true } } },
      orderBy: { nome: 'asc' },
      take: 50,
    });
    const estoques = await prisma.estoqueLoja.findMany({ where: { lojaId, produtoId: { in: produtos.map((p) => p.id) } } });
    const estoquePorProduto = new Map(estoques.map((e) => [e.produtoId, num(e.quantidade)]));
    const promocoes = await promocoesVigentes(produtos);

    res.json(
      produtos.map((p) => {
        const calc = calcularPreco(p, 1, promocoes, tipo);
        return {
          produtoId: p.id,
          codigo: p.codigo,
          nome: p.nome,
          unidade: p.unidade,
          precoTabela: arred2(calc.precoUnitario),
          precoAtacado: numOuNull(p.precoAtacado),
          estoque: estoquePorProduto.get(p.id) ?? 0,
          promocao: calc.descricaoPromocao,
          foto: p.foto ?? null,
          categoria: p.categoria?.nome ?? null,
        };
      }),
    );
  }),
);

router.get(
  '/pedidos-venda',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const status = enumQuery(req.query.status, STATUS_PEDIDO);
    const origem = enumQuery(req.query.origem, ORIGENS_PEDIDO);
    const vendedorId = numeroQuery(req.query.vendedorId);
    const lojaId = await filtroLoja(req);

    const where: Prisma.PedidoVendaWhereInput = {};
    if (status) where.status = status;
    if (origem) where.origem = origem;
    if (lojaId !== null) where.lojaId = lojaId;
    if (req.usuario.perfil === 'VENDEDOR') where.vendedorId = req.usuario.id;
    else if (vendedorId !== undefined) where.vendedorId = vendedorId;

    const pedidos = await prisma.pedidoVenda.findMany({
      where,
      include: incluirPedido,
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
    res.json(pedidos.map(paraLista));
  }),
);

router.get(
  '/pedidos-venda/:id',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const pedido = await buscarPedido(idParam(req));
    soDono(req, pedido.vendedorId);
    res.json(paraDetalhe(pedido));
  }),
);

router.post(
  '/pedidos-venda',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(pedidoSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const cliente = await prisma.cliente.findUnique({ where: { id: dados.clienteId } });
    if (!cliente || !cliente.ativo) throw new HttpError(400, 'Cliente não encontrado ou inativo');
    const vendedorId = req.usuario.perfil === 'VENDEDOR' ? req.usuario.id : null;

    const criado = await prisma.$transaction(async (tx) => {
      const monta = await montarPedido(tx, dados.itens, cliente.tipo);
      await validarFlex(tx, vendedorId, monta.flex);
      return tx.pedidoVenda.create({
        data: {
          clienteId: cliente.id,
          vendedorId,
          lojaId,
          origem: 'FORCA_VENDAS',
          status: dados.orcamento ? 'ORCAMENTO' : 'PENDENTE',
          subtotalTabela: monta.subtotalTabela,
          total: monta.total,
          flex: monta.flex,
          condicaoPagamento: dados.condicaoPagamento ?? null,
          formaPagamento: dados.formaPagamento ?? null,
          previsaoEntrega: dataOuNull(dados.previsaoEntrega),
          observacoes: dados.observacoes ?? null,
          itens: { create: monta.linhas },
        },
        include: incluirPedido,
      });
    });
    res.status(201).json(paraLista(criado));
  }),
);

router.put(
  '/pedidos-venda/:id',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(pedidoSchema, req.body);
    const atual = await prisma.pedidoVenda.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Pedido não encontrado');
    soDono(req, atual.vendedorId);
    if (atual.status !== 'ORCAMENTO' && atual.status !== 'PENDENTE') {
      throw new HttpError(400, 'Só é possível editar orçamento ou pedido pendente');
    }
    const cliente = await prisma.cliente.findUnique({ where: { id: dados.clienteId } });
    if (!cliente || !cliente.ativo) throw new HttpError(400, 'Cliente não encontrado ou inativo');

    const atualizado = await prisma.$transaction(async (tx) => {
      const monta = await montarPedido(tx, dados.itens, cliente.tipo);
      await validarFlex(tx, atual.vendedorId, monta.flex);
      await tx.pedidoVendaItem.deleteMany({ where: { pedidoId: id } });
      return tx.pedidoVenda.update({
        where: { id },
        data: {
          clienteId: cliente.id,
          status: dados.orcamento ? 'ORCAMENTO' : 'PENDENTE',
          subtotalTabela: monta.subtotalTabela,
          total: monta.total,
          flex: monta.flex,
          condicaoPagamento: dados.condicaoPagamento ?? null,
          formaPagamento: dados.formaPagamento ?? null,
          previsaoEntrega: dataOuNull(dados.previsaoEntrega),
          observacoes: dados.observacoes ?? null,
          itens: { create: monta.linhas },
        },
        include: incluirPedido,
      });
    });
    res.json(paraDetalhe(atualizado));
  }),
);

// Mudança de situação. Faturado só é cancelado pelo gestor (estorna a venda e devolve o flex).
const statusSchema = z.object({
  status: z.enum(['PENDENTE', 'APROVADO', 'SEPARANDO', 'CANCELADO']),
  motivo: z.string().trim().max(200).nullish(),
});

router.post(
  '/pedidos-venda/:id/status',
  permitir('GESTOR', 'VENDEDOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(statusSchema, req.body);
    const pedido = await prisma.pedidoVenda.findUnique({ where: { id } });
    if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
    soDono(req, pedido.vendedorId);
    const gestor = req.usuario.perfil === 'GESTOR';
    const de = pedido.status;
    const para = dados.status;

    if (para === 'PENDENTE') {
      if (de !== 'ORCAMENTO') throw new HttpError(400, 'Só um orçamento pode ser enviado como pedido');
    } else if (para === 'APROVADO') {
      if (!gestor) throw new HttpError(403, 'Só o gestor aprova pedidos');
      if (de !== 'PENDENTE') throw new HttpError(400, 'Só um pedido pendente pode ser aprovado');
    } else if (para === 'SEPARANDO') {
      if (!gestor) throw new HttpError(403, 'Só o gestor manda pedidos para separação');
      if (de !== 'APROVADO') throw new HttpError(400, 'Só um pedido aprovado pode ir para separação');
    } else {
      // CANCELADO
      if (de === 'CANCELADO') throw new HttpError(400, 'Pedido já cancelado');
      if (de === 'FATURADO') {
        if (!gestor) throw new HttpError(403, 'Só o gestor cancela pedido faturado');
      } else if (!gestor && de !== 'ORCAMENTO' && de !== 'PENDENTE') {
        throw new HttpError(403, 'Pedido aprovado só pode ser cancelado pelo gestor');
      }
    }

    if (para === 'CANCELADO' && de === 'FATURADO') {
      const motivo = dados.motivo ?? 'Pedido de venda cancelado';
      await prisma.$transaction(async (tx) => {
        if (pedido.vendaId) await cancelarVenda(tx, pedido.vendaId, motivo, req.usuario.id);
        // Devolve o flex que o faturamento somou ao saldo do vendedor.
        if (pedido.vendedorId) {
          await tx.usuario.update({ where: { id: pedido.vendedorId }, data: { saldoFlex: { decrement: num(pedido.flex) } } });
        }
        await tx.pedidoVenda.update({ where: { id }, data: { status: 'CANCELADO' } });
      });
    } else {
      await prisma.pedidoVenda.update({ where: { id }, data: { status: para } });
    }
    res.json(paraLista(await buscarPedido(id)));
  }),
);

// Faturamento de um pedido aprovado: venda (com NF-e simulada), flex no saldo e entrega com rastreio.
async function faturarUm(tx: Tx, pedidoId: number, usuarioId: number) {
  const pedido = await tx.pedidoVenda.findUnique({
    where: { id: pedidoId },
    include: { itens: { include: { produto: true } }, cliente: true },
  });
  if (!pedido) throw new HttpError(404, 'Pedido não encontrado');
  if (pedido.status !== 'APROVADO' && pedido.status !== 'SEPARANDO') {
    throw new HttpError(400, 'Só pedido aprovado ou em separação pode ser faturado');
  }
  const cliente = pedido.cliente;
  const total = num(pedido.total);
  const forma = pedido.formaPagamento ?? 'BOLETO';

  const venda = await registrarVenda(tx, {
    lojaId: pedido.lojaId,
    usuarioId,
    vendedorId: pedido.vendedorId,
    clienteId: cliente.id,
    origem: pedido.origem,
    itens: pedido.itens.map((i) => ({ produtoId: i.produtoId, quantidade: num(i.quantidade), precoUnitario: num(i.precoNegociado) })),
    pagamentos: [{ forma, valor: total, parcelas: 1 }],
    permitirSemPagamento: true,
    modeloNota: 'NFE',
    emitirNota: true,
  });

  if (pedido.vendedorId) {
    await tx.usuario.update({ where: { id: pedido.vendedorId }, data: { saldoFlex: { increment: num(pedido.flex) } } });
  }

  const nota = venda.notaId ? await tx.notaFiscal.findUnique({ where: { id: venda.notaId }, select: { numero: true } }) : null;
  const pesoKg = pedido.itens.reduce((s, i) => s + num(i.produto.pesoBrutoKg) * num(i.quantidade), 0);
  const endereco = [cliente.endereco, cliente.numero].filter(Boolean).join(', ') || 'Endereço não informado';

  const entrega = await criarEntrega(tx, {
    vendaId: venda.vendaId,
    pedidoVendaId: pedido.id,
    clienteId: cliente.id,
    destinatario: cliente.nome,
    telefone: cliente.whatsapp ?? cliente.telefone ?? null,
    endereco,
    bairro: cliente.bairro,
    cidade: cliente.cidade,
    latitude: numOuNull(cliente.latitude),
    longitude: numOuNull(cliente.longitude),
    valorCobrar: forma === 'DINHEIRO' ? total : 0,
    pesoKg: arred3(pesoKg),
  });

  await tx.pedidoVenda.update({
    where: { id: pedido.id },
    data: { status: 'FATURADO', vendaId: venda.vendaId, faturadoEm: new Date() },
  });

  return { pedidoId: pedido.id, vendaNumero: venda.numero, notaNumero: nota?.numero ?? null, entregaCodigo: entrega.codigo };
}

// Faturamento em lote: cada pedido numa transação própria, para um erro não derrubar os outros.
router.post(
  '/pedidos-venda/faturar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { pedidoIds } = validar(
      z.object({ pedidoIds: z.array(z.number().int().positive()).min(1, 'Selecione ao menos um pedido').max(200) }),
      req.body,
    );
    const faturados: Awaited<ReturnType<typeof faturarUm>>[] = [];
    const erros: { pedidoId: number; erro: string }[] = [];
    for (const pedidoId of Array.from(new Set(pedidoIds))) {
      try {
        faturados.push(await prisma.$transaction((tx) => faturarUm(tx, pedidoId, req.usuario.id)));
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(`Erro ao faturar pedido ${pedidoId}:`, e);
        erros.push({ pedidoId, erro: e instanceof HttpError ? e.message : 'Falha ao faturar o pedido' });
      }
    }
    res.json({ faturados, erros });
  }),
);

router.get(
  '/vendedor/resumo',
  permitir('VENDEDOR'),
  asyncHandler(async (req, res) => {
    const id = req.usuario.id;
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id }, select: { saldoFlex: true, comissaoPercentual: true } });
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const faturado = await prisma.pedidoVenda.aggregate({
      where: { vendedorId: id, status: 'FATURADO', faturadoEm: { gte: inicioMes } },
      _sum: { total: true },
    });
    const vendidoMes = arred2(num(faturado._sum.total));
    const comissaoPercentual = num(usuario.comissaoPercentual);
    const pedidosAbertos = await prisma.pedidoVenda.count({ where: { vendedorId: id, status: { in: ABERTOS } } });
    const clientes = await prisma.cliente.count({ where: { vendedorId: id, ativo: true } });
    res.json({
      saldoFlex: num(usuario.saldoFlex),
      comissaoPercentual,
      vendidoMes,
      comissaoMes: arred2((vendidoMes * comissaoPercentual) / 100),
      pedidosAbertos,
      clientes,
    });
  }),
);

// ---------- B2B (público, por código do cliente) ----------

publico.get(
  '/publico/b2b/:codigo',
  asyncHandler(async (req, res) => {
    const cliente = await clientePorCodigoB2B(String(req.params.codigo));
    const config = await lerConfiguracao();
    const lojaId = await lojaPadrao();
    const produtos = await prisma.produto.findMany({
      where: { ativo: true, insumo: false, estoques: { some: { lojaId, quantidade: { gt: 0 } } } },
      include: { categoria: { select: { nome: true } } },
      orderBy: { nome: 'asc' },
      take: 300,
    });
    const promocoes = await promocoesVigentes(produtos);
    res.json({
      empresa: config.nome,
      cliente: { nome: cliente.nome },
      produtos: produtos.map((p) => ({
        produtoId: p.id,
        nome: p.nome,
        unidade: p.unidade,
        preco: arred2(calcularPreco(p, 1, promocoes, 'ATACADO').precoUnitario),
        precoAtacado: numOuNull(p.precoAtacado),
        qtdAtacado: numOuNull(p.qtdAtacado),
        categoria: p.categoria?.nome ?? null,
        foto: p.foto ?? null,
      })),
    });
  }),
);

publico.get(
  '/publico/b2b/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const cliente = await clientePorCodigoB2B(String(req.params.codigo));
    const pedidos = await prisma.pedidoVenda.findMany({
      where: { clienteId: cliente.id },
      orderBy: { criadoEm: 'desc' },
      take: 20,
      select: { id: true, numero: true, criadoEm: true, status: true, total: true },
    });
    res.json(pedidos.map((p) => ({ id: p.id, numero: p.numero, criadoEm: p.criadoEm.toISOString(), status: p.status, total: num(p.total) })));
  }),
);

publico.post(
  '/publico/b2b/:codigo/pedidos',
  asyncHandler(async (req, res) => {
    const dados = validar(
      z.object({
        itens: z
          .array(z.object({ produtoId: z.number().int().positive(), quantidade: z.number().positive().max(100000) }))
          .min(1, 'Inclua ao menos um produto')
          .max(100),
        observacoes: z.string().trim().max(500).nullish(),
      }),
      req.body,
    );
    const cliente = await clientePorCodigoB2B(String(req.params.codigo));
    const lojaId = await lojaPadrao();

    // Sem vendedor no pedido B2B: o preço é o de tabela (precoNegociado = precoTabela, flex zero).
    const criado = await prisma.$transaction(async (tx) => {
      const monta = await montarPedido(tx, dados.itens, cliente.tipo);
      return tx.pedidoVenda.create({
        data: {
          clienteId: cliente.id,
          vendedorId: cliente.vendedorId ?? null,
          lojaId,
          origem: 'B2B',
          status: 'PENDENTE',
          subtotalTabela: monta.subtotalTabela,
          total: monta.total,
          flex: monta.flex,
          observacoes: dados.observacoes ?? null,
          itens: { create: monta.linhas },
        },
        select: { id: true, numero: true, status: true, total: true },
      });
    });
    res.status(201).json({ id: criado.id, numero: criado.numero, status: criado.status, total: num(criado.total) });
  }),
);

// ---------- Delivery próprio (público) ----------

publico.get(
  '/publico/delivery/catalogo',
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDoParametro(req);
    const config = await lerConfiguracao();
    const produtos = await prisma.produto.findMany({
      where: { ativo: true, insumo: false, estoques: { some: { lojaId, quantidade: { gt: 0 } } } },
      include: { categoria: { select: { id: true, nome: true } } },
      orderBy: [{ categoria: { nome: 'asc' } }, { nome: 'asc' }],
      take: 300,
    });
    const promocoes = await promocoesVigentes(produtos);
    const categorias = new Map<number, { id: number; nome: string }>();

    const lista = produtos.map((p) => {
      const calc = calcularPreco(p, 1, promocoes, 'VAREJO');
      if (p.categoria) categorias.set(p.categoria.id, { id: p.categoria.id, nome: p.categoria.nome });
      const promocional = calc.origem === 'PROMOCAO';
      return {
        produtoId: p.id,
        nome: p.nome,
        unidade: p.unidade,
        pesavel: p.pesavel,
        preco: num(p.precoVenda),
        precoPromocional: promocional ? arred2(calc.precoUnitario) : undefined,
        descricaoPromocao: promocional ? calc.descricaoPromocao : undefined,
        categoriaId: p.categoriaId,
        foto: p.foto ?? null,
      };
    });

    res.json({
      empresa: config.nome,
      ativo: config.deliveryAtivo,
      taxa: num(config.deliveryTaxa),
      pedidoMinimo: num(config.deliveryPedidoMinimo),
      categorias: Array.from(categorias.values()),
      produtos: lista,
    });
  }),
);

const pedidoDeliverySchema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome').max(120),
  telefone: z.string().trim().min(8, 'Informe um telefone').max(30),
  endereco: z.string().trim().min(3, 'Informe o endereço').max(200),
  numero: z.string().trim().min(1, 'Informe o número').max(20),
  bairro: z.string().trim().min(2, 'Informe o bairro').max(80),
  cidade: z.string().trim().max(80).nullish(),
  complemento: z.string().trim().max(120).nullish(),
  formaPagamento: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO']),
  trocoPara: z.number().nonnegative().max(100000).nullish(),
  itens: z
    .array(z.object({ produtoId: z.number().int().positive(), quantidade: z.number().positive().max(100) }))
    .min(1, 'Inclua ao menos um produto')
    .max(50, 'Pedido com no máximo 50 itens'),
  observacao: z.string().trim().max(300).nullish(),
});

publico.post(
  '/publico/delivery/pedidos',
  asyncHandler(async (req, res) => {
    const dados = validar(pedidoDeliverySchema, req.body);
    const lojaId = await lojaDoParametro(req);
    const config = await lerConfiguracao();
    if (!config.deliveryAtivo) throw new HttpError(400, 'Delivery indisponível no momento');

    const telefone = dados.telefone.replace(/\D/g, '');
    if (telefone.length < 8) throw new HttpError(400, 'Telefone inválido');
    const taxa = num(config.deliveryTaxa);
    const minimo = num(config.deliveryPedidoMinimo);

    const gestor = await prisma.usuario.findFirst({ where: { perfil: 'GESTOR', ativo: true }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!gestor) throw new HttpError(400, 'Cadastre um gestor ativo para receber pedidos');

    const resultado = await prisma.$transaction(async (tx) => {
      const precos = await precificar(tx, dados.itens, 'VAREJO');
      const subtotal = arred2(precos.reduce((s, l) => s + l.calc.total, 0));
      if (subtotal < minimo) {
        throw new HttpError(400, `Pedido mínimo de R$ ${minimo.toFixed(2).replace('.', ',')}`);
      }
      const total = arred2(subtotal + taxa);
      const pesoKg = precos.reduce((s, l) => s + num(l.produto.pesoBrutoKg) * l.quantidade, 0);

      // Cliente é buscado pelo telefone (só dígitos) ou criado como varejo.
      let cliente = await tx.cliente.findFirst({ where: { OR: [{ telefone }, { whatsapp: telefone }] } });
      if (!cliente) {
        cliente = await tx.cliente.create({
          data: {
            nome: dados.nome,
            tipo: 'VAREJO',
            telefone,
            whatsapp: telefone,
            endereco: dados.endereco,
            numero: dados.numero,
            bairro: dados.bairro,
            cidade: dados.cidade ?? null,
          },
        });
      }

      const observacao = [
        dados.trocoPara ? `Troco para R$ ${dados.trocoPara.toFixed(2).replace('.', ',')}` : null,
        dados.observacao ?? null,
      ]
        .filter(Boolean)
        .join(' | ') || null;

      const venda = await registrarVenda(tx, {
        lojaId,
        usuarioId: gestor.id,
        clienteId: cliente.id,
        origem: 'DELIVERY',
        itens: dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
        pagamentos: [{ forma: dados.formaPagamento, valor: total }],
        acrescimo: taxa,
        permitirSemPagamento: true,
        observacao,
      });

      const complemento = dados.complemento ? ` - ${dados.complemento}` : '';
      const entrega = await criarEntrega(tx, {
        vendaId: venda.vendaId,
        clienteId: cliente.id,
        destinatario: dados.nome,
        telefone,
        endereco: `${dados.endereco}, ${dados.numero}${complemento}`,
        bairro: dados.bairro,
        cidade: dados.cidade ?? null,
        taxa,
        valorCobrar: total,
        pesoKg,
        observacao,
      });
      return { codigo: entrega.codigo, total };
    });
    res.status(201).json(resultado);
  }),
);

router.get(
  '/delivery/pedidos',
  permitir('GESTOR', 'OPERADOR'),
  asyncHandler(async (req, res) => {
    const status = enumQuery(req.query.status, STATUS_ENTREGA);
    const lojaId = await filtroLoja(req);
    const where: Prisma.VendaWhereInput = {
      origem: { in: ['DELIVERY', 'MARKETPLACE'] },
      criadoEm: { gte: inicioDoDia(), lte: fimDoDia() },
    };
    if (lojaId !== null) where.lojaId = lojaId;
    if (status) where.entrega = { is: { status } };

    const vendas = await prisma.venda.findMany({
      where,
      include: incluirVendaEntrega,
      orderBy: { criadoEm: 'desc' },
      take: 300,
    });
    res.json(vendas.map(paraEntregaVenda));
  }),
);

// Simulação do iFood Mercado: pedido fictício com 2 a 4 produtos com estoque, pago por PIX no app.
router.post(
  '/delivery/marketplace/simular',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    if (!(await lerConfiguracao()).marketplaceAtivo) {
      throw new HttpError(400, 'Ative o iFood Mercado em Configurações > Mercado para simular pedidos');
    }
    const lojaId = await lojaDaRequisicao(req);
    const candidatos = await prisma.produto.findMany({
      where: { ativo: true, insumo: false, estoques: { some: { lojaId, quantidade: { gt: 0 } } } },
      orderBy: { id: 'asc' },
      take: 200,
    });
    if (candidatos.length === 0) throw new HttpError(400, 'Não há produtos com estoque para simular o pedido');

    const embaralhados = [...candidatos];
    for (let i = embaralhados.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [embaralhados[i], embaralhados[j]] = [embaralhados[j], embaralhados[i]];
    }
    const quantidadeItens = Math.min(embaralhados.length, 2 + Math.floor(Math.random() * 3));
    const itens = embaralhados.slice(0, quantidadeItens).map((p) => ({
      produtoId: p.id,
      quantidade: p.pesavel ? arred3(0.5 + Math.random() * 1.5) : 1 + Math.floor(Math.random() * 3),
    }));
    const marketplaceId = `IFD-${codigoAleatorio(6)}`;

    const vendaId = await prisma.$transaction(async (tx) => {
      const precos = await precificar(tx, itens, 'VAREJO');
      const total = arred2(precos.reduce((s, l) => s + l.calc.total, 0));
      const pesoKg = precos.reduce((s, l) => s + num(l.produto.pesoBrutoKg) * l.quantidade, 0);
      const venda = await registrarVenda(tx, {
        lojaId,
        usuarioId: req.usuario.id,
        origem: 'MARKETPLACE',
        marketplaceId,
        itens,
        pagamentos: [{ forma: 'PIX', valor: total }],
        permitirSemPagamento: true,
        observacao: 'Pedido simulado do iFood Mercado',
      });
      await criarEntrega(tx, {
        vendaId: venda.vendaId,
        destinatario: 'Cliente iFood',
        endereco: 'Entrega iFood Mercado (simulado)',
        valorCobrar: 0,
        pesoKg,
        observacao: `Pedido ${marketplaceId} (simulado)`,
      });
      return venda.vendaId;
    });

    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId }, include: incluirVendaEntrega });
    res.status(201).json(paraEntregaVenda(venda));
  }),
);

export default router;
