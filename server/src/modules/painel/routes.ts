import { Router } from 'express';
import type { Perfil, Prisma, StatusEntrega, StatusPedidoCompra, StatusPedidoVenda } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lojaDaRequisicao } from '../../lib/lojas';
import { arred2, fimDoDia, inicioDoDia, num, somarDias } from '../../lib/numeros';

const router = Router();

// Painel inicial (GET /api/painel), sino de avisos (GET /api/notificacoes) e busca do topo (GET /api/busca).
// Toda rota aceita qualquer perfil logado; cada perfil recebe o seu conteúdo.

const PERFIS: Perfil[] = ['GESTOR', 'OPERADOR', 'ESTOQUISTA', 'PADEIRO', 'COMPRADOR', 'MOTORISTA', 'VENDEDOR', 'CONTADOR'];

const RAIZ: Record<Perfil, string> = {
  GESTOR: '/gestor',
  OPERADOR: '/operador',
  ESTOQUISTA: '/estoquista',
  PADEIRO: '/padeiro',
  COMPRADOR: '/comprador',
  MOTORISTA: '/motorista',
  VENDEDOR: '/vendedor',
  CONTADOR: '/contador',
};

type Cor = 'azul' | 'roxo' | 'verde' | 'laranja';
const CORES_RECENTES: Cor[] = ['azul', 'roxo', 'verde'];

interface Cartao {
  rotulo: string;
  valor: string;
  variacao: number | null;
  icone: string;
  cor: Cor;
}

interface Recente {
  titulo: string;
  subtitulo: string;
  quando: string;
  cor: Cor;
  caminho: string;
}

interface Destaque {
  rotulo: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface Atalho {
  rotulo: string;
  icone: string;
  sufixo: string;
}

interface Aviso {
  chave: string;
  titulo: string;
  meta: string;
  quando: string;
  caminho: string;
}

interface Contexto {
  usuarioId: number;
  lojaId: number;
  comissaoPercentual: number;
  saldoFlex: number;
}

interface Bloco {
  cartoes: Cartao[];
  recentes: Recente[];
  destaque: Destaque | null;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const ENTREGAS_ATIVAS: StatusEntrega[] = ['PENDENTE', 'SEPARANDO', 'EM_ROTA'];
const PEDIDOS_COMPRA_ABERTOS: StatusPedidoCompra[] = ['RASCUNHO', 'ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL'];
const PEDIDOS_VENDA_ABERTOS: StatusPedidoVenda[] = ['ORCAMENTO', 'PENDENTE', 'APROVADO', 'SEPARANDO'];

const ROTULO_ORIGEM: Record<string, string> = {
  PDV: 'PDV',
  DELIVERY: 'Delivery',
  MARKETPLACE: 'Marketplace',
  FORCA_VENDAS: 'Força de vendas',
  B2B: 'B2B',
};

const ROTULO_MOVIMENTO: Record<string, string> = {
  ENTRADA: 'Entrada',
  VENDA: 'Venda',
  CANCELAMENTO_VENDA: 'Cancelamento de venda',
  AJUSTE: 'Ajuste',
  PERDA: 'Perda',
  PRODUCAO: 'Produção',
  CONSUMO_PRODUCAO: 'Consumo na produção',
  TRANSFERENCIA_SAIDA: 'Transferência (saída)',
  TRANSFERENCIA_ENTRADA: 'Transferência (entrada)',
  INVENTARIO: 'Inventário',
};

const ROTULO_PEDIDO_COMPRA: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADO: 'Enviado',
  CONFIRMADO: 'Confirmado',
  EM_TRANSITO: 'Em trânsito',
  RECEBIDO_PARCIAL: 'Recebido parcial',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
};

const ROTULO_PEDIDO_VENDA: Record<string, string> = {
  ORCAMENTO: 'Orçamento',
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  SEPARANDO: 'Separando',
  FATURADO: 'Faturado',
  CANCELADO: 'Cancelado',
};

const ROTULO_PRODUCAO: Record<string, string> = {
  PLANEJADA: 'Planejada',
  EM_PRODUCAO: 'Em produção',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

const ROTULO_NOTA: Record<string, string> = {
  PENDENTE: 'Pendente',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Rejeitada',
  CANCELADA: 'Cancelada',
};

// Atalhos de cada perfil (o sufixo é somado à raiz do perfil no cliente e na busca).
const ATALHOS: Record<Perfil, Atalho[]> = {
  GESTOR: [
    { rotulo: 'PDV', icone: 'carrinho', sufixo: 'pdv' },
    { rotulo: 'Produtos', icone: 'pacote', sufixo: 'produtos' },
    { rotulo: 'Estoque', icone: 'pacote', sufixo: 'estoque' },
    { rotulo: 'Produção', icone: 'pao', sufixo: 'producao' },
    { rotulo: 'Pedidos de compra', icone: 'pedidos', sufixo: 'pedidos-compra' },
    { rotulo: 'Entregas', icone: 'caminhao', sufixo: 'entregas' },
    { rotulo: 'Financeiro', icone: 'financeiro', sufixo: 'financeiro' },
    { rotulo: 'Meu lucro', icone: 'porcentagem', sufixo: 'meu-lucro' },
    { rotulo: 'Relatórios', icone: 'grafico', sufixo: 'relatorios' },
    { rotulo: 'Assistente', icone: 'robo', sufixo: 'assistente' },
    { rotulo: 'Configurações', icone: 'engrenagem', sufixo: 'configuracoes' },
  ],
  OPERADOR: [
    { rotulo: 'PDV', icone: 'carrinho', sufixo: 'pdv' },
    { rotulo: 'Caixa', icone: 'dinheiro', sufixo: 'caixa' },
    { rotulo: 'Vendas', icone: 'lista', sufixo: 'vendas' },
    { rotulo: 'Clientes', icone: 'usuarios', sufixo: 'clientes' },
    { rotulo: 'Fiado', icone: 'dinheiro', sufixo: 'fiado' },
    { rotulo: 'Delivery', icone: 'caminhao', sufixo: 'delivery' },
  ],
  ESTOQUISTA: [
    { rotulo: 'Estoque', icone: 'pacote', sufixo: 'estoque' },
    { rotulo: 'Recebimento', icone: 'pacote', sufixo: 'recebimento' },
    { rotulo: 'Validade', icone: 'validade', sufixo: 'validade' },
    { rotulo: 'Inventários', icone: 'lista', sufixo: 'inventarios' },
    { rotulo: 'Etiquetas', icone: 'etiqueta', sufixo: 'etiquetas' },
    { rotulo: 'Transferências', icone: 'transferir', sufixo: 'transferencias' },
  ],
  PADEIRO: [
    { rotulo: 'Produção', icone: 'pao', sufixo: 'producao' },
    { rotulo: 'Forno', icone: 'relogio', sufixo: 'forno' },
    { rotulo: 'Receitas', icone: 'documento', sufixo: 'receitas' },
    { rotulo: 'Estoque', icone: 'pacote', sufixo: 'estoque' },
  ],
  COMPRADOR: [
    { rotulo: 'Sugestão de compra', icone: 'raio', sufixo: 'sugestao-compra' },
    { rotulo: 'Cotações', icone: 'lista', sufixo: 'cotacoes' },
    { rotulo: 'Pedidos de compra', icone: 'pedidos', sufixo: 'pedidos-compra' },
    { rotulo: 'Fornecedores', icone: 'fabrica', sufixo: 'fornecedores' },
    { rotulo: 'Formação de preço', icone: 'porcentagem', sufixo: 'formacao-preco' },
  ],
  MOTORISTA: [{ rotulo: 'Entregas', icone: 'caminhao', sufixo: 'entregas' }],
  VENDEDOR: [
    { rotulo: 'Novo pedido', icone: 'celular', sufixo: 'novo-pedido' },
    { rotulo: 'Pedidos de venda', icone: 'pedidos', sufixo: 'pedidos-venda' },
    { rotulo: 'Minha carteira', icone: 'usuarios', sufixo: 'carteira' },
  ],
  CONTADOR: [
    { rotulo: 'Contador', icone: 'documento', sufixo: 'contador' },
    { rotulo: 'Vendas', icone: 'lista', sufixo: 'vendas' },
    { rotulo: 'Financeiro', icone: 'financeiro', sufixo: 'financeiro' },
    { rotulo: 'Relatórios', icone: 'grafico', sufixo: 'relatorios' },
  ],
};

// ---------- Formatação e datas ----------

function brl(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function quantidade(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function hora(data: Date): string {
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dataCurta(data: Date): string {
  return data.toLocaleDateString('pt-BR');
}

function variacao(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

function corDaVez(i: number): Cor {
  return CORES_RECENTES[i % CORES_RECENTES.length];
}

function periodos() {
  const agora = new Date();
  return {
    agora,
    hojeIni: inicioDoDia(agora),
    hojeFim: fimDoDia(agora),
    ontemIni: inicioDoDia(somarDias(agora, -1)),
    ontemFim: fimDoDia(somarDias(agora, -1)),
    mesIni: new Date(agora.getFullYear(), agora.getMonth(), 1),
    tresDias: fimDoDia(somarDias(agora, 3)),
    seteDias: fimDoDia(somarDias(agora, 7)),
  };
}

// ---------- Consultas compartilhadas ----------

// Produtos ativos com o saldo da loja (0 quando a loja ainda não tem linha de estoque).
async function produtosComSaldo(lojaId: number) {
  const produtos = await prisma.produto.findMany({
    where: { ativo: true },
    select: {
      id: true,
      nome: true,
      unidade: true,
      estoqueMinimo: true,
      precoCusto: true,
      estoques: { where: { lojaId }, select: { quantidade: true } },
    },
  });
  return produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    unidade: p.unidade,
    minimo: num(p.estoqueMinimo),
    custo: num(p.precoCusto),
    saldo: num(p.estoques[0]?.quantidade),
  }));
}

type ProdutoComSaldo = Awaited<ReturnType<typeof produtosComSaldo>>[number];

function abaixoDoMinimo(itens: ProdutoComSaldo[]): ProdutoComSaldo[] {
  return itens.filter((p) => p.minimo > 0 && p.saldo < p.minimo);
}

// Últimas vendas concluídas que casam com o filtro.
async function ultimasVendas(where: Prisma.VendaWhereInput): Promise<Recente[]> {
  const vendas = await prisma.venda.findMany({
    where: { ...where, status: 'CONCLUIDA' },
    orderBy: { criadoEm: 'desc' },
    take: 5,
    select: {
      numero: true,
      origem: true,
      total: true,
      criadoEm: true,
      cliente: { select: { nome: true } },
    },
  });
  return vendas.map((v, i) => ({
    titulo: `Venda #${v.numero} · ${ROTULO_ORIGEM[v.origem] ?? v.origem}`,
    subtitulo: `${v.cliente?.nome ?? 'Consumidor final'} · ${brl(num(v.total))}`,
    quando: v.criadoEm.toISOString(),
    cor: corDaVez(i),
    caminho: 'vendas',
  }));
}

// Produto mais vendido do dia na loja (pela quantidade, sem itens cancelados).
async function produtoDoDia(lojaId: number): Promise<Destaque | null> {
  const { hojeIni, hojeFim } = periodos();
  const grupos = await prisma.vendaItem.groupBy({
    by: ['produtoId'],
    where: {
      cancelado: false,
      venda: { lojaId, status: 'CONCLUIDA', criadoEm: { gte: hojeIni, lte: hojeFim } },
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: 'desc' } },
    take: 1,
  });
  const topo = grupos[0];
  if (!topo) return null;
  const produto = await prisma.produto.findUnique({
    where: { id: topo.produtoId },
    select: { nome: true, unidade: true },
  });
  if (!produto) return null;
  return {
    rotulo: 'Mais vendido hoje',
    titulo: produto.nome,
    subtitulo: `Vendido: ${quantidade(num(topo._sum.quantidade))} ${produto.unidade}`,
    caminho: 'produtos',
  };
}

// Vendas por mês nos últimos 12 meses (só o gestor vê o gráfico).
async function vendasPorMes(lojaId: number): Promise<{ mes: string; total: number }[]> {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth() - 11, 1);
  const vendas = await prisma.venda.findMany({
    where: { lojaId, status: 'CONCLUIDA', criadoEm: { gte: inicio } },
    select: { total: true, criadoEm: true },
  });
  const somas = new Map<string, number>();
  for (const v of vendas) {
    const chave = `${v.criadoEm.getFullYear()}-${v.criadoEm.getMonth()}`;
    somas.set(chave, (somas.get(chave) ?? 0) + num(v.total));
  }
  const pontos: { mes: string; total: number }[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const chave = `${d.getFullYear()}-${d.getMonth()}`;
    pontos.push({ mes: MESES[d.getMonth()], total: arred2(somas.get(chave) ?? 0) });
  }
  return pontos;
}

// ---------- Blocos por perfil (cartões, recentes e destaque) ----------

async function blocoGestor(c: Contexto): Promise<Bloco> {
  const { hojeIni, hojeFim, ontemIni, ontemFim } = periodos();
  const vendasDe = (de: Date, ate: Date) =>
    prisma.venda.aggregate({
      where: { lojaId: c.lojaId, status: 'CONCLUIDA', criadoEm: { gte: de, lte: ate } },
      _sum: { total: true, custoTotal: true },
      _count: { _all: true },
    });
  const [hoje, ontem, destaque, recentes] = await Promise.all([
    vendasDe(hojeIni, hojeFim),
    vendasDe(ontemIni, ontemFim),
    produtoDoDia(c.lojaId),
    ultimasVendas({ lojaId: c.lojaId }),
  ]);
  const totalHoje = num(hoje._sum.total);
  const pedidosHoje = hoje._count._all;
  const totalOntem = num(ontem._sum.total);
  const pedidosOntem = ontem._count._all;
  const lucro = totalHoje - num(hoje._sum.custoTotal);
  return {
    cartoes: [
      { rotulo: 'Vendas hoje', valor: brl(totalHoje), variacao: variacao(totalHoje, totalOntem), icone: 'financeiro', cor: 'azul' },
      { rotulo: 'Nº de vendas hoje', valor: String(pedidosHoje), variacao: variacao(pedidosHoje, pedidosOntem), icone: 'pedidos', cor: 'roxo' },
      { rotulo: 'Ticket médio', valor: brl(pedidosHoje > 0 ? totalHoje / pedidosHoje : 0), variacao: null, icone: 'grafico', cor: 'verde' },
      { rotulo: 'Lucro bruto hoje', valor: brl(lucro), variacao: null, icone: 'porcentagem', cor: 'laranja' },
    ],
    recentes,
    destaque,
  };
}

async function blocoOperador(c: Contexto): Promise<Bloco> {
  const caixa = await prisma.caixa.findFirst({
    where: { usuarioId: c.usuarioId, status: 'ABERTO' },
    select: { id: true, valorAbertura: true },
  });
  // Sem caixa aberto, o filtro abaixo não casa com nada (id -1).
  const caixaId = caixa?.id ?? -1;
  const [vendas, dinheiro, movimentos, recentes] = await Promise.all([
    prisma.venda.aggregate({
      where: { caixaId, status: 'CONCLUIDA' },
      _sum: { total: true, troco: true },
      _count: { _all: true },
    }),
    prisma.pagamentoVenda.aggregate({
      where: { forma: 'DINHEIRO', venda: { caixaId, status: 'CONCLUIDA' } },
      _sum: { valor: true },
    }),
    prisma.movimentoCaixa.findMany({ where: { caixaId }, select: { tipo: true, valor: true } }),
    ultimasVendas({ caixaId }),
  ]);
  const suprimentos = movimentos.filter((m) => m.tipo === 'SUPRIMENTO').reduce((s, m) => s + num(m.valor), 0);
  const sangrias = movimentos.filter((m) => m.tipo === 'SANGRIA').reduce((s, m) => s + num(m.valor), 0);
  const noCaixa =
    num(caixa?.valorAbertura) + num(dinheiro._sum.valor) - num(vendas._sum.troco) + suprimentos - sangrias;
  const total = num(vendas._sum.total);
  const pedidos = vendas._count._all;
  return {
    cartoes: [
      { rotulo: 'Vendas do meu caixa', valor: brl(total), variacao: null, icone: 'financeiro', cor: 'azul' },
      { rotulo: 'Nº de vendas', valor: String(pedidos), variacao: null, icone: 'pedidos', cor: 'roxo' },
      { rotulo: 'Dinheiro no caixa', valor: brl(noCaixa), variacao: null, icone: 'dinheiro', cor: 'verde' },
      { rotulo: 'Ticket médio', valor: brl(pedidos > 0 ? total / pedidos : 0), variacao: null, icone: 'grafico', cor: 'laranja' },
    ],
    recentes,
    destaque: null,
  };
}

async function blocoEstoquista(c: Contexto): Promise<Bloco> {
  const { seteDias } = periodos();
  const [produtos, lotes, recebimentos, movimentos] = await Promise.all([
    produtosComSaldo(c.lojaId),
    prisma.lote.count({ where: { lojaId: c.lojaId, quantidade: { gt: 0 }, validade: { lte: seteDias } } }),
    prisma.recebimento.count({ where: { lojaId: c.lojaId, status: 'CONFERINDO' } }),
    prisma.movimentoEstoque.findMany({
      where: { lojaId: c.lojaId },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: { tipo: true, quantidade: true, criadoEm: true, produto: { select: { nome: true } } },
    }),
  ]);
  const abaixo = abaixoDoMinimo(produtos);
  const valorEstoque = produtos.reduce((soma, p) => soma + p.saldo * p.custo, 0);
  return {
    cartoes: [
      { rotulo: 'Itens abaixo do mínimo', valor: String(abaixo.length), variacao: null, icone: 'pacote', cor: 'laranja' },
      { rotulo: 'Lotes vencendo em 7 dias', valor: String(lotes), variacao: null, icone: 'validade', cor: 'roxo' },
      { rotulo: 'Recebimentos em conferência', valor: String(recebimentos), variacao: null, icone: 'caminhao', cor: 'azul' },
      { rotulo: 'Valor em estoque', valor: brl(valorEstoque), variacao: null, icone: 'financeiro', cor: 'verde' },
    ],
    recentes: movimentos.map((m, i) => {
      const q = num(m.quantidade);
      return {
        titulo: m.produto.nome,
        subtitulo: `${ROTULO_MOVIMENTO[m.tipo] ?? m.tipo} · ${q > 0 ? '+' : ''}${quantidade(q)}`,
        quando: m.criadoEm.toISOString(),
        cor: corDaVez(i),
        caminho: 'estoque',
      };
    }),
    destaque: null,
  };
}

async function blocoPadeiro(c: Contexto): Promise<Bloco> {
  const { hojeIni, hojeFim } = periodos();
  const [planejadas, noForno, produzido, ordens] = await Promise.all([
    prisma.ordemProducao.count({
      where: { lojaId: c.lojaId, status: 'PLANEJADA', agendadoPara: { gte: hojeIni, lte: hojeFim } },
    }),
    prisma.ordemProducao.count({ where: { lojaId: c.lojaId, status: 'EM_PRODUCAO' } }),
    prisma.ordemProducao.aggregate({
      where: { lojaId: c.lojaId, status: 'CONCLUIDA', concluidoEm: { gte: hojeIni, lte: hojeFim } },
      _sum: { quantidadeProduzida: true, perda: true },
    }),
    prisma.ordemProducao.findMany({
      where: { lojaId: c.lojaId, agendadoPara: { gte: hojeIni, lte: hojeFim } },
      orderBy: { agendadoPara: 'asc' },
      take: 5,
      select: {
        status: true,
        agendadoPara: true,
        quantidadePlanejada: true,
        produto: { select: { nome: true } },
      },
    }),
  ]);
  return {
    cartoes: [
      { rotulo: 'Fornadas planejadas hoje', valor: String(planejadas), variacao: null, icone: 'calendario', cor: 'azul' },
      { rotulo: 'No forno', valor: String(noForno), variacao: null, icone: 'relogio', cor: 'laranja' },
      { rotulo: 'Produzido hoje', valor: quantidade(num(produzido._sum.quantidadeProduzida)), variacao: null, icone: 'pao', cor: 'verde' },
      { rotulo: 'Perda hoje', valor: quantidade(num(produzido._sum.perda)), variacao: null, icone: 'lixeira', cor: 'roxo' },
    ],
    recentes: ordens.map((o, i) => ({
      titulo: o.produto.nome,
      subtitulo: `${hora(o.agendadoPara)} · ${ROTULO_PRODUCAO[o.status] ?? o.status} · ${quantidade(num(o.quantidadePlanejada))} un`,
      quando: o.agendadoPara.toISOString(),
      cor: corDaVez(i),
      caminho: 'producao',
    })),
    destaque: null,
  };
}

async function blocoComprador(c: Contexto): Promise<Bloco> {
  const { mesIni } = periodos();
  const [abertos, cotacoes, mes, pedidos, produtos] = await Promise.all([
    prisma.pedidoCompra.count({ where: { lojaId: c.lojaId, status: { in: PEDIDOS_COMPRA_ABERTOS } } }),
    prisma.cotacao.count({ where: { status: 'ABERTA' } }),
    prisma.pedidoCompra.aggregate({
      where: { lojaId: c.lojaId, status: { not: 'CANCELADO' }, criadoEm: { gte: mesIni } },
      _sum: { total: true },
    }),
    prisma.pedidoCompra.findMany({
      where: { lojaId: c.lojaId },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: {
        numero: true,
        status: true,
        total: true,
        criadoEm: true,
        fornecedor: { select: { nome: true } },
      },
    }),
    produtosComSaldo(c.lojaId),
  ]);
  return {
    cartoes: [
      { rotulo: 'Pedidos em aberto', valor: String(abertos), variacao: null, icone: 'pedidos', cor: 'azul' },
      { rotulo: 'Itens a comprar', valor: String(abaixoDoMinimo(produtos).length), variacao: null, icone: 'pacote', cor: 'laranja' },
      { rotulo: 'Cotações abertas', valor: String(cotacoes), variacao: null, icone: 'lista', cor: 'roxo' },
      { rotulo: 'Compras no mês', valor: brl(num(mes._sum.total)), variacao: null, icone: 'financeiro', cor: 'verde' },
    ],
    recentes: pedidos.map((p, i) => ({
      titulo: `Pedido #${p.numero} · ${p.fornecedor.nome}`,
      subtitulo: `${brl(num(p.total))} · ${ROTULO_PEDIDO_COMPRA[p.status] ?? p.status}`,
      quando: p.criadoEm.toISOString(),
      cor: corDaVez(i),
      caminho: 'pedidos-compra',
    })),
    destaque: null,
  };
}

async function blocoMotorista(c: Contexto): Promise<Bloco> {
  const { hojeIni, hojeFim } = periodos();
  // Entregas da rota: ainda abertas, ou com previsão/rota de hoje, ou entregues hoje.
  const entregas = await prisma.entrega.findMany({
    where: {
      motoristaId: c.usuarioId,
      OR: [
        { status: { in: ENTREGAS_ATIVAS } },
        { entregueEm: { gte: hojeIni, lte: hojeFim } },
        { previsao: { gte: hojeIni, lte: hojeFim } },
        { rota: { is: { data: { gte: hojeIni, lte: hojeFim } } } },
      ],
    },
    orderBy: { criadoEm: 'desc' },
    take: 100,
    select: {
      destinatario: true,
      endereco: true,
      status: true,
      valorCobrar: true,
      criadoEm: true,
      previsao: true,
    },
  });
  const pendentes = entregas.filter((e) => ENTREGAS_ATIVAS.includes(e.status));
  const entregues = entregas.filter((e) => e.status === 'ENTREGUE');
  const aCobrar = pendentes.reduce((soma, e) => soma + num(e.valorCobrar), 0);
  return {
    cartoes: [
      { rotulo: 'Entregas hoje', valor: String(entregas.length), variacao: null, icone: 'caminhao', cor: 'azul' },
      { rotulo: 'Entregues', valor: String(entregues.length), variacao: null, icone: 'visto', cor: 'verde' },
      { rotulo: 'Pendentes', valor: String(pendentes.length), variacao: null, icone: 'relogio', cor: 'laranja' },
      { rotulo: 'Valor a cobrar', valor: brl(aCobrar), variacao: null, icone: 'financeiro', cor: 'roxo' },
    ],
    recentes: entregas.slice(0, 5).map((e, i) => ({
      titulo: e.destinatario,
      subtitulo: num(e.valorCobrar) > 0 ? `${e.endereco} · ${brl(num(e.valorCobrar))}` : e.endereco,
      quando: (e.previsao ?? e.criadoEm).toISOString(),
      cor: corDaVez(i),
      caminho: 'entregas',
    })),
    destaque: null,
  };
}

async function blocoVendedor(c: Contexto): Promise<Bloco> {
  const { mesIni } = periodos();
  const [vendido, abertos, pedidos] = await Promise.all([
    prisma.venda.aggregate({
      where: { vendedorId: c.usuarioId, status: 'CONCLUIDA', criadoEm: { gte: mesIni } },
      _sum: { total: true },
    }),
    prisma.pedidoVenda.count({ where: { vendedorId: c.usuarioId, status: { in: PEDIDOS_VENDA_ABERTOS } } }),
    prisma.pedidoVenda.findMany({
      where: { vendedorId: c.usuarioId },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: {
        numero: true,
        status: true,
        total: true,
        criadoEm: true,
        cliente: { select: { nome: true } },
      },
    }),
  ]);
  const totalMes = num(vendido._sum.total);
  return {
    cartoes: [
      { rotulo: 'Vendido no mês', valor: brl(totalMes), variacao: null, icone: 'financeiro', cor: 'azul' },
      { rotulo: 'Comissão no mês', valor: brl((totalMes * c.comissaoPercentual) / 100), variacao: null, icone: 'porcentagem', cor: 'verde' },
      { rotulo: 'Saldo de flex', valor: brl(c.saldoFlex), variacao: null, icone: 'raio', cor: 'roxo' },
      { rotulo: 'Pedidos em aberto', valor: String(abertos), variacao: null, icone: 'pedidos', cor: 'laranja' },
    ],
    recentes: pedidos.map((p, i) => ({
      titulo: `Pedido #${p.numero} · ${p.cliente.nome}`,
      subtitulo: `${brl(num(p.total))} · ${ROTULO_PEDIDO_VENDA[p.status] ?? p.status}`,
      quando: p.criadoEm.toISOString(),
      cor: corDaVez(i),
      caminho: 'pedidos-venda',
    })),
    destaque: null,
  };
}

async function blocoContador(c: Contexto): Promise<Bloco> {
  const { mesIni } = periodos();
  const [notas, valor, canceladas, ultimoEnvio, recentes] = await Promise.all([
    prisma.notaFiscal.count({ where: { lojaId: c.lojaId, criadoEm: { gte: mesIni } } }),
    prisma.notaFiscal.aggregate({
      where: { lojaId: c.lojaId, criadoEm: { gte: mesIni }, status: { not: 'CANCELADA' } },
      _sum: { valor: true },
    }),
    prisma.notaFiscal.count({ where: { lojaId: c.lojaId, criadoEm: { gte: mesIni }, status: 'CANCELADA' } }),
    prisma.notaFiscal.findFirst({
      where: { lojaId: c.lojaId, enviadaContadorEm: { not: null } },
      orderBy: { enviadaContadorEm: 'desc' },
      select: { enviadaContadorEm: true },
    }),
    prisma.notaFiscal.findMany({
      where: { lojaId: c.lojaId },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: { numero: true, modelo: true, status: true, valor: true, criadoEm: true },
    }),
  ]);
  const envio = ultimoEnvio?.enviadaContadorEm;
  return {
    cartoes: [
      { rotulo: 'Notas no mês', valor: String(notas), variacao: null, icone: 'documento', cor: 'azul' },
      { rotulo: 'Valor das notas', valor: brl(num(valor._sum.valor)), variacao: null, icone: 'financeiro', cor: 'verde' },
      { rotulo: 'Notas canceladas', valor: String(canceladas), variacao: null, icone: 'lixeira', cor: 'laranja' },
      {
        rotulo: 'Último envio ao contador',
        valor: envio ? `${dataCurta(envio)} ${hora(envio)}` : '—',
        variacao: null,
        icone: 'enviar',
        cor: 'roxo',
      },
    ],
    recentes: recentes.map((n, i) => ({
      titulo: `${n.modelo === 'NFE' ? 'NF-e' : 'NFC-e'} nº ${n.numero}`,
      subtitulo: `${brl(num(n.valor))} · ${ROTULO_NOTA[n.status] ?? n.status}`,
      quando: n.criadoEm.toISOString(),
      cor: corDaVez(i),
      caminho: 'contador',
    })),
    destaque: null,
  };
}

const BLOCOS: Record<Perfil, (c: Contexto) => Promise<Bloco>> = {
  GESTOR: blocoGestor,
  OPERADOR: blocoOperador,
  ESTOQUISTA: blocoEstoquista,
  PADEIRO: blocoPadeiro,
  COMPRADOR: blocoComprador,
  MOTORISTA: blocoMotorista,
  VENDEDOR: blocoVendedor,
  CONTADOR: blocoContador,
};

// ---------- Rotas ----------

// GET /api/painel: cartões, vendas por mês (gestor), recentes, destaque e atalhos do perfil.
router.get(
  '/painel',
  permitir(...PERFIS),
  asyncHandler(async (req, res) => {
    const u = req.usuario;
    const lojaId = await lojaDaRequisicao(req);
    const usuario = await prisma.usuario.findUnique({
      where: { id: u.id },
      select: { comissaoPercentual: true, saldoFlex: true },
    });
    if (!usuario) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    const contexto: Contexto = {
      usuarioId: u.id,
      lojaId,
      comissaoPercentual: num(usuario.comissaoPercentual),
      saldoFlex: num(usuario.saldoFlex),
    };
    const bloco = await BLOCOS[u.perfil](contexto);
    // O gráfico de vendas é assunto do gestor; os outros perfis recebem lista vazia.
    const meses = u.perfil === 'GESTOR' ? await vendasPorMes(lojaId) : [];
    res.json({
      perfil: u.perfil,
      cartoes: bloco.cartoes,
      vendasPorMes: meses,
      recentes: bloco.recentes,
      destaque: bloco.destaque,
      atalhos: ATALHOS[u.perfil],
    });
  })
);

// GET /api/notificacoes: o que espera uma ação da equipe agora (até 20 avisos, conforme o perfil).
router.get(
  '/notificacoes',
  permitir(...PERFIS),
  asyncHandler(async (req, res) => {
    const u = req.usuario;
    const perfil = u.perfil;
    const em = (...perfis: Perfil[]) => perfis.includes(perfil);
    const lojaId = await lojaDaRequisicao(req);
    const { agora, hojeIni, hojeFim, tresDias } = periodos();
    const avisos: Aviso[] = [];

    // Estoque abaixo do mínimo.
    if (em('GESTOR', 'ESTOQUISTA', 'COMPRADOR')) {
      const abaixo = abaixoDoMinimo(await produtosComSaldo(lojaId));
      for (const p of abaixo.slice(0, 10)) {
        avisos.push({
          chave: `estoque-${p.id}`,
          titulo: `${p.nome} abaixo do mínimo`,
          meta: `Restam ${quantidade(p.saldo)} ${p.unidade} (mínimo ${quantidade(p.minimo)})`,
          quando: agora.toISOString(),
          caminho: perfil === 'COMPRADOR' ? 'sugestao-compra' : 'estoque',
        });
      }
    }

    // Lotes vencendo em até 3 dias (ou já vencidos).
    if (em('GESTOR', 'ESTOQUISTA')) {
      const lotes = await prisma.lote.findMany({
        where: { lojaId, quantidade: { gt: 0 }, validade: { lte: tresDias } },
        orderBy: { validade: 'asc' },
        take: 10,
        select: { id: true, codigo: true, validade: true, produto: { select: { nome: true } } },
      });
      for (const l of lotes) {
        avisos.push({
          chave: `lote-${l.id}`,
          titulo: l.validade < hojeIni ? `${l.produto.nome} vencido` : `${l.produto.nome} vence em breve`,
          meta: `Lote ${l.codigo} · ${dataCurta(l.validade)}`,
          quando: l.validade.toISOString(),
          caminho: 'validade',
        });
      }
    }

    // Contas a pagar vencendo hoje ou vencidas.
    if (em('GESTOR')) {
      const contas = await prisma.lancamento.findMany({
        where: { tipo: 'DESPESA', pagoEm: null, vencimento: { lte: hojeFim }, OR: [{ lojaId }, { lojaId: null }] },
        orderBy: { vencimento: 'asc' },
        take: 10,
        select: { id: true, descricao: true, valor: true, vencimento: true },
      });
      for (const conta of contas) {
        const vencida = conta.vencimento < hojeIni;
        avisos.push({
          chave: `conta-${conta.id}`,
          titulo: `Conta a pagar: ${conta.descricao}`,
          meta: `${brl(num(conta.valor))} · ${vencida ? 'vencida' : 'vence hoje'}`,
          quando: conta.vencimento.toISOString(),
          caminho: 'financeiro',
        });
      }
    }

    // Delivery e marketplace com a entrega ainda sem sair.
    if (em('GESTOR', 'OPERADOR')) {
      const entregas = await prisma.entrega.findMany({
        where: {
          status: 'PENDENTE',
          venda: { is: { lojaId, origem: { in: ['DELIVERY', 'MARKETPLACE'] } } },
        },
        orderBy: { criadoEm: 'asc' },
        take: 10,
        select: { id: true, codigo: true, destinatario: true, criadoEm: true },
      });
      for (const e of entregas) {
        avisos.push({
          chave: `delivery-${e.id}`,
          titulo: `Delivery ${e.codigo} aguardando saída`,
          meta: e.destinatario,
          quando: e.criadoEm.toISOString(),
          caminho: 'delivery',
        });
      }
    }

    // Pedidos de venda aguardando aprovação.
    if (em('GESTOR')) {
      const pedidos = await prisma.pedidoVenda.findMany({
        where: { lojaId, status: 'PENDENTE' },
        orderBy: { criadoEm: 'asc' },
        take: 10,
        select: { id: true, numero: true, total: true, criadoEm: true, cliente: { select: { nome: true } } },
      });
      for (const p of pedidos) {
        avisos.push({
          chave: `pedido-venda-${p.id}`,
          titulo: `Pedido de venda #${p.numero} aguardando aprovação`,
          meta: `${p.cliente.nome} · ${brl(num(p.total))}`,
          quando: p.criadoEm.toISOString(),
          caminho: 'pedidos-venda',
        });
      }
    }

    // Pedidos de compra em trânsito com previsão de chegada hoje.
    if (em('ESTOQUISTA', 'COMPRADOR')) {
      const compras = await prisma.pedidoCompra.findMany({
        where: { lojaId, status: 'EM_TRANSITO', previsaoEntrega: { gte: hojeIni, lte: hojeFim } },
        orderBy: { previsaoEntrega: 'asc' },
        take: 10,
        select: { id: true, numero: true, previsaoEntrega: true, fornecedor: { select: { nome: true } } },
      });
      for (const p of compras) {
        avisos.push({
          chave: `compra-${p.id}`,
          titulo: `Pedido de compra #${p.numero} chega hoje`,
          meta: p.fornecedor.nome,
          quando: (p.previsaoEntrega ?? agora).toISOString(),
          caminho: perfil === 'ESTOQUISTA' ? 'recebimento' : 'pedidos-compra',
        });
      }
    }

    // Fornadas planejadas que já passaram do horário.
    if (em('PADEIRO')) {
      const ordens = await prisma.ordemProducao.findMany({
        where: { lojaId, status: 'PLANEJADA', agendadoPara: { lt: agora } },
        orderBy: { agendadoPara: 'asc' },
        take: 10,
        select: { id: true, agendadoPara: true, produto: { select: { nome: true } } },
      });
      for (const o of ordens) {
        avisos.push({
          chave: `fornada-${o.id}`,
          titulo: `Fornada de ${o.produto.nome} atrasada`,
          meta: `Estava marcada para ${hora(o.agendadoPara)}`,
          quando: o.agendadoPara.toISOString(),
          caminho: 'producao',
        });
      }
    }

    // Entregas abertas da rota do motorista.
    if (em('MOTORISTA')) {
      const entregas = await prisma.entrega.findMany({
        where: { motoristaId: u.id, status: { in: ENTREGAS_ATIVAS } },
        orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
        take: 10,
        select: { id: true, destinatario: true, endereco: true, criadoEm: true },
      });
      for (const e of entregas) {
        avisos.push({
          chave: `entrega-${e.id}`,
          titulo: `Entrega para ${e.destinatario}`,
          meta: e.endereco,
          quando: e.criadoEm.toISOString(),
          caminho: 'entregas',
        });
      }
    }

    // Etiquetas de gôndola a imprimir (preço alterado).
    if (em('GESTOR', 'ESTOQUISTA')) {
      const [qtd, primeira] = await Promise.all([
        prisma.etiquetaPendente.count({ where: { impressaEm: null } }),
        prisma.etiquetaPendente.findFirst({
          where: { impressaEm: null },
          orderBy: { criadoEm: 'asc' },
          select: { criadoEm: true },
        }),
      ]);
      if (qtd > 0 && primeira) {
        avisos.push({
          chave: 'etiquetas',
          titulo: `${qtd} ${qtd === 1 ? 'etiqueta' : 'etiquetas'} para imprimir`,
          meta: 'Preço alterado na gôndola',
          quando: primeira.criadoEm.toISOString(),
          caminho: 'etiquetas',
        });
      }
    }

    res.json(avisos.slice(0, 20));
  })
);

// Sufixo de cada tipo de resultado da busca, por perfil. Sem sufixo, o perfil não vê aquele tipo.
const SUFIXOS_BUSCA: Record<string, Partial<Record<Perfil, string>>> = {
  produto: {
    GESTOR: 'produtos',
    OPERADOR: 'pdv',
    ESTOQUISTA: 'estoque',
    PADEIRO: 'estoque',
    COMPRADOR: 'formacao-preco',
    VENDEDOR: 'novo-pedido',
  },
  cliente: { GESTOR: 'clientes', OPERADOR: 'clientes', VENDEDOR: 'carteira' },
  fornecedor: { GESTOR: 'fornecedores', COMPRADOR: 'fornecedores' },
  venda: { GESTOR: 'vendas', OPERADOR: 'vendas', CONTADOR: 'vendas' },
};

interface ItemBusca {
  tipo: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

// GET /api/busca?q=: até 12 resultados (produtos, clientes, fornecedores e vendas) com caminho completo.
router.get(
  '/busca',
  permitir(...PERFIS),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const perfil = req.usuario.perfil;
    const caminho = (tipo: string): string | null => {
      const sufixo = SUFIXOS_BUSCA[tipo][perfil];
      return sufixo ? `${RAIZ[perfil]}/${sufixo}` : null;
    };
    const texto = { contains: q, mode: 'insensitive' as const };
    const itens: ItemBusca[] = [];

    const caminhoProduto = caminho('produto');
    if (caminhoProduto) {
      const produtos = await prisma.produto.findMany({
        where: { ativo: true, OR: [{ nome: texto }, { codigo: texto }, { ean: texto }] },
        select: { nome: true, codigo: true, precoVenda: true },
        orderBy: { nome: 'asc' },
        take: 5,
      });
      itens.push(
        ...produtos.map(
          (p): ItemBusca => ({
            tipo: 'produto',
            titulo: p.nome,
            subtitulo: `${p.codigo} · ${brl(num(p.precoVenda))}`,
            caminho: caminhoProduto,
          })
        )
      );
    }

    const caminhoCliente = caminho('cliente');
    if (caminhoCliente) {
      const clientes = await prisma.cliente.findMany({
        where: { ativo: true, OR: [{ nome: texto }, { cpfCnpj: texto }, { telefone: texto }] },
        select: { nome: true, telefone: true, cidade: true },
        orderBy: { nome: 'asc' },
        take: 4,
      });
      itens.push(
        ...clientes.map(
          (c): ItemBusca => ({
            tipo: 'cliente',
            titulo: c.nome,
            subtitulo: c.telefone || c.cidade || 'Cliente',
            caminho: caminhoCliente,
          })
        )
      );
    }

    const caminhoFornecedor = caminho('fornecedor');
    if (caminhoFornecedor) {
      const fornecedores = await prisma.fornecedor.findMany({
        where: { ativo: true, OR: [{ nome: texto }, { cnpj: texto }] },
        select: { nome: true, cnpj: true, contato: true },
        orderBy: { nome: 'asc' },
        take: 3,
      });
      itens.push(
        ...fornecedores.map(
          (f): ItemBusca => ({
            tipo: 'fornecedor',
            titulo: f.nome,
            subtitulo: f.cnpj || f.contato || 'Fornecedor',
            caminho: caminhoFornecedor,
          })
        )
      );
    }

    const caminhoVenda = caminho('venda');
    if (caminhoVenda) {
      const lojaId = await lojaDaRequisicao(req);
      const numero = /^\d{1,9}$/.test(q) ? Number(q) : null;
      const vendas = await prisma.venda.findMany({
        where: {
          lojaId,
          status: 'CONCLUIDA',
          OR: [...(numero !== null ? [{ numero }] : []), { cliente: { is: { nome: texto } } }],
        },
        select: { numero: true, total: true, cliente: { select: { nome: true } } },
        orderBy: { criadoEm: 'desc' },
        take: 3,
      });
      itens.push(
        ...vendas.map(
          (v): ItemBusca => ({
            tipo: 'venda',
            titulo: `Venda #${v.numero}`,
            subtitulo: `${v.cliente?.nome ?? 'Consumidor final'} · ${brl(num(v.total))}`,
            caminho: caminhoVenda,
          })
        )
      );
    }

    res.json(itens.slice(0, 12));
  })
);

export default router;
