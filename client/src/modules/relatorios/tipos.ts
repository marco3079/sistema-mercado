// Tipos das respostas da API de relatórios (/relatorios/*).

export interface SerieVenda {
  rotulo: string; // dia "AAAA-MM-DD", hora "HH:00", semana (segunda-feira) "AAAA-MM-DD" ou mês "AAAA-MM"
  vendas: number;
  total: number;
  ticketMedio: number;
}

export interface RelatorioVendas {
  de: string;
  ate: string;
  agrupar: 'dia' | 'hora' | 'semana' | 'mes';
  vendas: number;
  total: number;
  ticketMedio: number;
  serie: SerieVenda[];
  porOrigem: { origem: string; vendas: number; total: number }[];
  porForma: { forma: string; total: number }[];
  porOperador: { operador: string; vendas: number; total: number }[];
}

export type ClasseABC = 'A' | 'B' | 'C';

export interface CurvaLinha {
  produtoId: number;
  codigo: string;
  nome: string;
  foto: string | null;
  categoria: string;
  quantidade: number;
  faturamento: number;
  lucro: number;
  percentual: number;
  percentualAcumulado: number;
  classe: ClasseABC;
}

export interface ProdutoParado {
  produtoId: number;
  nome: string;
  foto: string | null;
  categoria: string | null;
  estoque: number;
  valorEstoque: number;
  ultimaVenda: string | null; // ISO ou null (nunca vendido)
}

export interface MargemLinha {
  produtoId: number;
  codigo: string;
  nome: string;
  foto: string | null;
  categoria: string | null;
  custo: number;
  venda: number;
  margem: number;
  prejuizo: boolean;
}
