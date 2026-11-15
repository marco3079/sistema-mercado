// Tipos das respostas da API da padaria (/receitas, /producao).

export type StatusProducao = 'PLANEJADA' | 'EM_PRODUCAO' | 'CONCLUIDA' | 'CANCELADA';

export interface ItemReceitaDTO {
  id: number;
  insumoId: number;
  insumo: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
  custo: number;
  estoque: number;
  insumoFoto: string | null;
  insumoCategoria: string | null;
}

export interface ReceitaDTO {
  id: number;
  produtoId: number;
  produto: string;
  foto: string | null;
  categoria: string | null;
  unidade: string;
  rendimento: number;
  tempoPreparoMin: number | null;
  tempoFornoMin: number | null;
  temperaturaForno: number | null;
  modoPreparo: string | null;
  custoTotal: number;
  custoUnitario: number;
  precoVenda: number;
  margem: number | null; // % sobre o preço de venda
  itens: ItemReceitaDTO[];
}

export interface FaltaInsumoDTO {
  insumo: string;
  necessario: number;
  estoque: number;
}

export interface OrdemDTO {
  id: number;
  produtoId: number;
  produto: string;
  foto: string | null;
  categoria: string | null;
  unidade: string;
  receitaId: number;
  quantidadePlanejada: number;
  quantidadeProduzida: number | null;
  perda: number | null;
  status: StatusProducao;
  agendadoPara: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  custoTotal: number | null;
  observacao: string | null;
  faltaInsumo: FaltaInsumoDTO[];
}

export interface SugestaoDTO {
  receitaId: number;
  produto: string;
  foto: string | null;
  categoria: string | null;
  mediaVendida: number;
  estoque: number;
  sugerido: number;
  fornadas: number;
}

export interface ResumoProducaoDTO {
  produtoId: number;
  produto: string;
  foto: string | null;
  categoria: string | null;
  unidade: string;
  produzido: number;
  perda: number;
  percentualPerda: number | null;
  custoTotal: number;
}

// Produto da busca em /produtos (só os campos usados aqui).
export interface ProdutoBusca {
  id: number;
  codigo: string;
  nome: string;
  unidade: string;
  precoCusto: number;
  precoVenda: number;
  foto?: string | null;
  categoria?: string | null;
  produzido: boolean;
  insumo: boolean;
}

export interface ListaProdutos {
  itens: ProdutoBusca[];
  total: number;
}
