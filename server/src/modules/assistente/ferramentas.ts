import { prisma } from '../../lib/prisma';
import { arred2, arred3, fimDoDia, inicioDoDia, num, somarDias } from '../../lib/numeros';

// Consultas do Assistente IA. Cada função devolve números prontos (number) e datas ISO.
// As regras (routes.ts) e o contexto enviado à IA usam estas mesmas funções.

export const STATUS_COMPRA_ABERTA = ['RASCUNHO', 'ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL'] as const;

export const ROTULOS_STATUS_COMPRA: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADO: 'Enviado',
  CONFIRMADO: 'Confirmado',
  EM_TRANSITO: 'Em trânsito',
  RECEBIDO_PARCIAL: 'Recebido parcial',
};

export interface Periodo {
  inicio: Date;
  fim: Date;
}

// ---------- Formatação ----------

export function reais(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function quantidadeTexto(n: number, unidade?: string): string {
  const texto = n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unidade ? `${texto} ${unidade.toLowerCase()}` : texto;
}

export function percentual(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function dataCurta(data: Date): string {
  return data.toLocaleDateString('pt-BR');
}

// ---------- Períodos ----------

export type ChavePeriodo = 'hoje' | 'ontem' | 'semana' | 'mes' | 'mes_passado';

export const ROTULO_PERIODO: Record<ChavePeriodo, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  semana: 'Últimos 7 dias',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
};

export function periodoDe(chave: ChavePeriodo, agora: Date = new Date()): Periodo {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  switch (chave) {
    case 'ontem': {
      const ontem = somarDias(agora, -1);
      return { inicio: inicioDoDia(ontem), fim: fimDoDia(ontem) };
    }
    case 'semana':
      return { inicio: inicioDoDia(somarDias(agora, -6)), fim: fimDoDia(agora) };
    case 'mes':
      return { inicio: new Date(ano, mes, 1), fim: fimDoDia(agora) };
    case 'mes_passado':
      return { inicio: new Date(ano, mes - 1, 1), fim: new Date(ano, mes, 0, 23, 59, 59, 999) };
    case 'hoje':
    default:
      return { inicio: inicioDoDia(agora), fim: fimDoDia(agora) };
  }
}

// Período de comparação: o anterior imediato do mesmo tipo.
export function periodoAnteriorDe(chave: ChavePeriodo, agora: Date = new Date()): Periodo {
  switch (chave) {
    case 'hoje':
      return periodoDe('ontem', agora);
    case 'ontem':
      return periodoDe('ontem', somarDias(agora, -1));
    case 'semana': {
      const fim = somarDias(agora, -7);
      return { inicio: inicioDoDia(somarDias(agora, -13)), fim: fimDoDia(fim) };
    }
    case 'mes':
      return periodoDe('mes_passado', agora);
    case 'mes_passado': {
      const ano = agora.getFullYear();
      const mes = agora.getMonth();
      return { inicio: new Date(ano, mes - 2, 1), fim: new Date(ano, mes - 1, 0, 23, 59, 59, 999) };
    }
  }
}

// ---------- Vendas ----------

export interface ResumoVendas {
  quantidade: number;
  total: number;
  custo: number;
  lucro: number;
  margem: number;
  ticketMedio: number;
}

export async function resumoVendas(lojaId: number, periodo: Periodo): Promise<ResumoVendas> {
  const agregado = await prisma.venda.aggregate({
    where: { lojaId, status: 'CONCLUIDA', concluidaEm: { gte: periodo.inicio, lte: periodo.fim } },
    _sum: { total: true, custoTotal: true },
    _count: { _all: true },
  });
  const quantidade = agregado._count._all;
  const total = num(agregado._sum.total);
  const custo = num(agregado._sum.custoTotal);
  const lucro = total - custo;
  return {
    quantidade,
    total: arred2(total),
    custo: arred2(custo),
    lucro: arred2(lucro),
    margem: total > 0 ? arred2((lucro / total) * 100) : 0,
    ticketMedio: quantidade > 0 ? arred2(total / quantidade) : 0,
  };
}

export interface LinhaProduto {
  produtoId: number;
  nome: string;
  unidade: string;
  quantidade: number;
  total: number;
}

// Top produtos do período: ordenados por quantidade e por faturamento (itens cancelados não contam).
export async function topProdutos(
  lojaId: number,
  periodo: Periodo,
  limite = 5
): Promise<{ porQuantidade: LinhaProduto[]; porFaturamento: LinhaProduto[] }> {
  const itens = await prisma.vendaItem.findMany({
    where: {
      cancelado: false,
      venda: { lojaId, status: 'CONCLUIDA', concluidaEm: { gte: periodo.inicio, lte: periodo.fim } },
    },
    select: {
      produtoId: true,
      quantidade: true,
      total: true,
      produto: { select: { nome: true, unidade: true } },
    },
  });

  const mapa = new Map<number, LinhaProduto>();
  for (const item of itens) {
    const atual =
      mapa.get(item.produtoId) ??
      { produtoId: item.produtoId, nome: item.produto.nome, unidade: item.produto.unidade, quantidade: 0, total: 0 };
    atual.quantidade += num(item.quantidade);
    atual.total += num(item.total);
    mapa.set(item.produtoId, atual);
  }

  const lista = [...mapa.values()].map((linha) => ({
    ...linha,
    quantidade: arred3(linha.quantidade),
    total: arred2(linha.total),
  }));

  return {
    porQuantidade: [...lista].sort((a, b) => b.quantidade - a.quantidade).slice(0, limite),
    porFaturamento: [...lista].sort((a, b) => b.total - a.total).slice(0, limite),
  };
}

// ---------- Estoque ----------

export interface ItemAbaixoMinimo {
  produtoId: number;
  nome: string;
  unidade: string;
  quantidade: number;
  estoqueMinimo: number;
}

// Produtos com estoque mínimo definido e saldo abaixo dele na loja (sem linha de estoque = saldo zero).
export async function abaixoDoMinimo(lojaId: number, limite = 10): Promise<{ total: number; itens: ItemAbaixoMinimo[] }> {
  const produtos = await prisma.produto.findMany({
    where: { ativo: true, estoqueMinimo: { gt: 0 } },
    select: {
      id: true,
      nome: true,
      unidade: true,
      estoqueMinimo: true,
      estoques: { where: { lojaId }, select: { quantidade: true } },
    },
  });

  const itens: ItemAbaixoMinimo[] = produtos
    .map((p) => ({
      produtoId: p.id,
      nome: p.nome,
      unidade: p.unidade,
      quantidade: arred3(num(p.estoques[0]?.quantidade)),
      estoqueMinimo: arred3(num(p.estoqueMinimo)),
    }))
    .filter((i) => i.quantidade < i.estoqueMinimo)
    .sort((a, b) => a.quantidade - a.estoqueMinimo - (b.quantidade - b.estoqueMinimo));

  return { total: itens.length, itens: itens.slice(0, limite) };
}

// ---------- Validade ----------

export interface LoteVencendo {
  produto: string;
  codigo: string;
  validade: string;
  quantidade: number;
  unidade: string;
}

export async function lotesVencendo(
  lojaId: number,
  dias = 7,
  limite = 10
): Promise<{ total: number; lotes: LoteVencendo[] }> {
  const agora = new Date();
  const onde = {
    lojaId,
    quantidade: { gt: 0 },
    validade: { gte: inicioDoDia(agora), lte: fimDoDia(somarDias(agora, dias)) },
  };
  const [total, lotes] = await Promise.all([
    prisma.lote.count({ where: onde }),
    prisma.lote.findMany({
      where: onde,
      orderBy: { validade: 'asc' },
      take: limite,
      select: {
        codigo: true,
        validade: true,
        quantidade: true,
        produto: { select: { nome: true, unidade: true } },
      },
    }),
  ]);
  return {
    total,
    lotes: lotes.map((l) => ({
      produto: l.produto.nome,
      codigo: l.codigo,
      validade: l.validade.toISOString(),
      quantidade: arred3(num(l.quantidade)),
      unidade: l.produto.unidade,
    })),
  };
}

// ---------- Fiado ----------

export async function fiadoEmAberto(limite = 5): Promise<{
  total: number;
  devedores: number;
  top: { id: number; nome: string; saldo: number }[];
}> {
  const onde = { saldoDevedor: { gt: 0 } };
  const [agregado, top] = await Promise.all([
    prisma.cliente.aggregate({ where: onde, _sum: { saldoDevedor: true }, _count: { _all: true } }),
    prisma.cliente.findMany({
      where: onde,
      orderBy: { saldoDevedor: 'desc' },
      take: limite,
      select: { id: true, nome: true, saldoDevedor: true },
    }),
  ]);
  return {
    total: arred2(num(agregado._sum.saldoDevedor)),
    devedores: agregado._count._all,
    top: top.map((c) => ({ id: c.id, nome: c.nome, saldo: arred2(num(c.saldoDevedor)) })),
  };
}

// ---------- Compras ----------

export async function comprasEmAberto(lojaId: number): Promise<{
  quantidade: number;
  total: number;
  porStatus: { status: string; rotulo: string; quantidade: number; total: number }[];
}> {
  const grupos = await prisma.pedidoCompra.groupBy({
    by: ['status'],
    where: { lojaId, status: { in: [...STATUS_COMPRA_ABERTA] } },
    _count: { _all: true },
    _sum: { total: true },
  });
  const porStatus = STATUS_COMPRA_ABERTA.map((status) => {
    const grupo = grupos.find((g) => g.status === status);
    return {
      status,
      rotulo: ROTULOS_STATUS_COMPRA[status],
      quantidade: grupo?._count._all ?? 0,
      total: arred2(num(grupo?._sum.total)),
    };
  }).filter((s) => s.quantidade > 0);

  return {
    quantidade: porStatus.reduce((s, p) => s + p.quantidade, 0),
    total: arred2(porStatus.reduce((s, p) => s + p.total, 0)),
    porStatus,
  };
}

// ---------- Produção e perdas ----------

export async function producaoEPerdas(lojaId: number, periodo: Periodo): Promise<{
  fornadas: number;
  produzido: number;
  quantidadePerdida: number;
  custoPerdido: number;
}> {
  const [ordens, perdas] = await Promise.all([
    prisma.ordemProducao.aggregate({
      where: { lojaId, status: 'CONCLUIDA', concluidoEm: { gte: periodo.inicio, lte: periodo.fim } },
      _count: { _all: true },
      _sum: { quantidadeProduzida: true },
    }),
    prisma.movimentoEstoque.findMany({
      where: { lojaId, tipo: 'PERDA', criadoEm: { gte: periodo.inicio, lte: periodo.fim } },
      select: { quantidade: true, custoUnitario: true },
    }),
  ]);

  const quantidadePerdida = perdas.reduce((s, m) => s + Math.abs(num(m.quantidade)), 0);
  const custoPerdido = perdas.reduce((s, m) => s + Math.abs(num(m.quantidade)) * num(m.custoUnitario), 0);

  return {
    fornadas: ordens._count._all,
    produzido: arred3(num(ordens._sum.quantidadeProduzida)),
    quantidadePerdida: arred3(quantidadePerdida),
    custoPerdido: arred2(custoPerdido),
  };
}

// ---------- Entregas ----------

// Entregas ligadas à loja pela rota, pela venda ou pelo pedido de venda.
export async function entregasDaLoja(lojaId: number): Promise<{
  pendentes: number;
  emRota: number;
  entreguesHoje: number;
}> {
  const daLoja = { OR: [{ rota: { lojaId } }, { venda: { lojaId } }, { pedidoVenda: { lojaId } }] };
  const ini = inicioDoDia();
  const fim = fimDoDia();
  const [pendentes, emRota, entreguesHoje] = await Promise.all([
    prisma.entrega.count({ where: { ...daLoja, status: { in: ['PENDENTE', 'SEPARANDO'] } } }),
    prisma.entrega.count({ where: { ...daLoja, status: 'EM_ROTA' } }),
    prisma.entrega.count({ where: { ...daLoja, status: 'ENTREGUE', entregueEm: { gte: ini, lte: fim } } }),
  ]);
  return { pendentes, emRota, entreguesHoje };
}

// ---------- Contexto para a IA ----------

// Resumo de vendas sem custo, lucro e margem (para perfis que não são gestor).
function semLucro(r: ResumoVendas): Omit<ResumoVendas, 'custo' | 'lucro' | 'margem'> {
  return { quantidade: r.quantidade, total: r.total, ticketMedio: r.ticketMedio };
}

// Mesmos dados das regras, em um único objeto JSON enviado à API da Anthropic.
// Sem nomes de clientes: o fiado vai só com total e quantidade de devedores.
// Para quem não é gestor, não entram lucro, margem nem fiado.
export async function contextoDoMercado(lojaId: number, agora: Date = new Date(), gestor = false) {
  const [hoje, ontem, sete, mes] = await Promise.all([
    resumoVendas(lojaId, periodoDe('hoje', agora)),
    resumoVendas(lojaId, periodoDe('ontem', agora)),
    resumoVendas(lojaId, periodoDe('semana', agora)),
    resumoVendas(lojaId, periodoDe('mes', agora)),
  ]);
  const [top, abaixo, vencendo, fiado, compras, producao, entregas] = await Promise.all([
    topProdutos(lojaId, periodoDe('mes', agora), 5),
    abaixoDoMinimo(lojaId, 10),
    lotesVencendo(lojaId, 7, 10),
    gestor ? fiadoEmAberto(5) : Promise.resolve(null),
    comprasEmAberto(lojaId),
    producaoEPerdas(lojaId, periodoDe('mes', agora)),
    entregasDaLoja(lojaId),
  ]);

  const vendas = gestor
    ? { hoje, ontem, ultimos7Dias: sete, mesAtual: mes }
    : {
        hoje: semLucro(hoje),
        ontem: semLucro(ontem),
        ultimos7Dias: semLucro(sete),
        mesAtual: semLucro(mes),
      };

  return {
    dataReferencia: agora.toISOString(),
    vendas,
    topProdutosMes: { maisVendidosPorQuantidade: top.porQuantidade, maioresFaturamentos: top.porFaturamento },
    abaixoDoMinimo: abaixo,
    vencendoEm7Dias: vencendo,
    ...(fiado ? { fiado: { totalEmAberto: fiado.total, quantidadeDevedores: fiado.devedores } } : {}),
    comprasEmAberto: compras,
    producaoEPerdasMes: producao,
    entregas,
  };
}
