// Tipos da API de produtos (g02) e pequenas regras de cálculo usadas nas telas.

export interface CategoriaDTO {
  id: number;
  nome: string;
  ordem: number;
  ativa: boolean;
  setor: string | null;
  totalProdutos: number;
}

export interface ProdutoDTO {
  id: number;
  codigo: string;
  ean: string | null;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoriaId: number | null;
  categoria: string | null;
  unidade: string;
  pesavel: boolean;
  codigoBalanca: number | null;
  precoCusto: number;
  precoVenda: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  margem: number;
  estoqueMinimo: number;
  estoqueMaximo: number | null;
  pesoBrutoKg: number | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  csosn: string | null;
  produzido: boolean;
  insumo: boolean;
  validadeDias: number | null;
  controlaLote: boolean;
  foto: string | null;
  ativo: boolean;
  fornecedorPadraoId: number | null;
  estoqueLoja: number;
}

export interface HistoricoPrecoDTO {
  criadoEm: string;
  precoAnterior: number;
  precoNovo: number;
  custoAnterior: number | null;
  custoNovo: number | null;
}

export interface FornecedorProdutoDTO {
  fornecedorId: number;
  nome: string;
  codigoFornecedor: string | null;
  ultimoPreco: number | null;
}

// GET /produtos/:id: o DTO completo mais histórico e fornecedores.
export interface ProdutoFichaDTO extends ProdutoDTO {
  historicoPrecos: HistoricoPrecoDTO[];
  fornecedores: FornecedorProdutoDTO[];
}

// GET /produtos/codigo/:codigo: quando veio da etiqueta da balança, traz a leitura.
export interface ProdutoPorCodigoDTO extends ProdutoDTO {
  balanca: { modo: string; valor: number } | null;
}

export interface ListaProdutosDTO {
  itens: ProdutoDTO[];
  total: number;
}

export interface FormacaoLinhaDTO {
  id: number;
  codigo: string;
  nome: string;
  categoria: string | null;
  precoCusto: number;
  precoVenda: number;
  margemAtual: number;
  markupAtual: number;
  precoSugerido: number;
}

export interface EtiquetaDTO {
  id: number;
  produtoId: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  precoVenda: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  promocao: string | null;
  motivo: string;
  criadoEm: string;
}

export interface BalancaProdutoDTO {
  id: number;
  nome: string;
  unidade: string;
  plu: number | null;
  precoVenda: number;
  validadeDias: number | null;
}

export interface ConfiguracaoPublicaDTO {
  margemPadrao: number;
  arredondarPreco: boolean;
}

export const SETORES = ['Mercearia', 'Padaria', 'Hortifrúti', 'Açougue', 'Frios', 'Bebidas', 'Limpeza', 'Higiene', 'Outros'];

// Quem pode editar produtos (o OPERADOR só lê; o servidor decide o resto).
export const PODE_EDITAR_PRODUTO = ['GESTOR', 'COMPRADOR', 'ESTOQUISTA'];

// Margem sobre a venda (%), igual ao servidor.
export function margemDe(custo: number, venda: number): number {
  if (venda <= 0) return 0;
  return Math.round(((venda - custo) / venda) * 10000) / 100;
}

// Markup sobre o custo (%).
export function markupDe(custo: number, venda: number): number {
  if (custo <= 0) return 0;
  return Math.round(((venda - custo) / custo) * 10000) / 100;
}

// Preço sugerido pela margem sobre o custo; com arredondamento termina em ,49 ou ,99 (igual ao servidor).
export function sugerirPreco(custo: number, margem: number, arredondar: boolean): number {
  const bruto = custo * (1 + margem / 100);
  if (!arredondar || bruto <= 0) return Math.round(bruto * 100) / 100;
  const reais = Math.floor(bruto);
  const centavos = bruto - reais;
  return centavos <= 0.49 ? reais + 0.49 : reais + 0.99;
}

// Número para o campo de texto: vírgula decimal, sem zeros sobrando.
export function numeroParaCampo(valor: number | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined) return '';
  return String(Number(valor.toFixed(casas))).replace('.', ',');
}

// Selo de cor da margem: verde a partir de 25%, amarelo de 10% a 25%, vermelho abaixo de 10%.
export function corDaMargem(margem: number): 'verde' | 'amarelo' | 'vermelho' {
  if (margem >= 25) return 'verde';
  if (margem >= 10) return 'amarelo';
  return 'vermelho';
}
