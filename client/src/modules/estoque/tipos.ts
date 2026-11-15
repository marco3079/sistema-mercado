// Tipos das respostas da API de estoque (/api/estoque, /api/validade, /api/lotes, /api/inventarios).

export type SituacaoEstoque = 'negativo' | 'zerado' | 'abaixo_minimo' | 'ok';

export interface ItemEstoque {
  produtoId: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  categoriaId: number | null;
  categoria: string | null;
  quantidade: number;
  estoqueMinimo: number;
  estoqueMaximo: number | null;
  precoCusto: number;
  valorEstoque: number;
  situacao: SituacaoEstoque;
}

export interface RespostaEstoque {
  itens: ItemEstoque[];
  total: number;
  valorTotal: number;
  resumo: {
    valorTotal: number;
    abaixoMinimo: number;
    zerados: number;
    negativos: number;
  };
}

export type TipoMovimento =
  | 'ENTRADA'
  | 'VENDA'
  | 'CANCELAMENTO_VENDA'
  | 'AJUSTE'
  | 'PERDA'
  | 'PRODUCAO'
  | 'CONSUMO_PRODUCAO'
  | 'TRANSFERENCIA_SAIDA'
  | 'TRANSFERENCIA_ENTRADA'
  | 'INVENTARIO';

export const ROTULOS_TIPO_MOVIMENTO: Record<TipoMovimento, string> = {
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

export interface Movimento {
  id: number;
  criadoEm: string;
  produtoId: number;
  produto: string;
  unidade: string;
  tipo: TipoMovimento;
  quantidade: number;
  saldoApos: number;
  custoUnitario: number | null;
  motivo: string | null;
  referencia: string | null;
  usuario: string | null;
}

export type MotivoPerda = 'VENCIDO' | 'AVARIA' | 'QUEBRA' | 'FURTO' | 'CONSUMO_INTERNO' | 'OUTRO';

export const ROTULOS_MOTIVO_PERDA: Record<MotivoPerda, string> = {
  VENCIDO: 'Vencido',
  AVARIA: 'Avaria',
  QUEBRA: 'Quebra',
  FURTO: 'Furto',
  CONSUMO_INTERNO: 'Consumo interno',
  OUTRO: 'Outro',
};

export const MOTIVOS_PERDA = Object.keys(ROTULOS_MOTIVO_PERDA) as MotivoPerda[];

export interface ItemPerda {
  data: string;
  produto: string;
  quantidade: number;
  unidade: string;
  motivo: string;
  valor: number;
}

export interface RespostaPerdas {
  itens: ItemPerda[];
  totalValor: number;
  porMotivo: { motivo: string; valor: number }[];
}

export interface Lote {
  id: number;
  produtoId: number;
  produto: string;
  codigo: string;
  validade: string;
  quantidade: number;
  unidade: string;
  diasRestantes: number;
  valorCusto: number;
}

export interface RespostaValidade {
  vencidos: Lote[];
  vencendo: Lote[];
}

export type StatusInventario = 'ABERTO' | 'FINALIZADO' | 'CANCELADO';

export const ROTULOS_STATUS_INVENTARIO: Record<StatusInventario, string> = {
  ABERTO: 'Aberto',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
};

export interface InventarioResumo {
  id: number;
  descricao: string;
  status: StatusInventario;
  categoria: string | null;
  criadoEm: string;
  finalizadoEm: string | null;
  totalItens: number;
  contados: number;
  divergencias: number;
}

export interface ItemInventario {
  id: number;
  produtoId: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  quantidadeSistema: number;
  quantidadeContada: number | null;
  diferenca: number | null;
  valorDiferenca: number;
  contadoEm: string | null;
}

export interface InventarioDetalhe {
  id: number;
  descricao: string;
  status: StatusInventario;
  categoria: string | null;
  criadoEm: string;
  finalizadoEm: string | null;
  itens: ItemInventario[];
}

export interface ResultadoFinalizacao {
  ajustes: number;
  valorDiferenca: number;
}

// Categoria vinda de /api/categorias (módulo produtos).
export interface CategoriaOpcao {
  id: number;
  nome: string;
}

// Monta a query string ignorando valores vazios: queryString({ busca: '', tipo: 'PERDA' }) -> '?tipo=PERDA'.
export function queryString(params: Record<string, string>): string {
  const partes = Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}
