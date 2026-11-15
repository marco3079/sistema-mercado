// Tipos das respostas da API do financeiro (contas, fluxo de caixa, resumo e Meu Lucro).

export type TipoLancamento = 'RECEITA' | 'DESPESA';

export type OrigemLancamento = 'MANUAL' | 'VENDA' | 'COMPRA' | 'FIADO' | 'BONIFICACAO';

export interface CategoriaFinanceira {
  id: number;
  nome: string;
  tipo: TipoLancamento;
}

export interface LancamentoDTO {
  id: number;
  tipo: TipoLancamento;
  origem: OrigemLancamento;
  descricao: string;
  valor: number;
  vencimento: string; // AAAA-MM-DD
  pagoEm: string | null;
  valorPago: number | null;
  formaPagamento: string | null;
  categoria: string | null;
  categoriaId: number | null;
  fornecedor: string | null;
  fornecedorId: number | null;
  cliente: string | null;
  clienteId: number | null;
  documento: string | null;
  linhaDigitavel: string | null;
  parcela: number | null;
  totalParcelas: number | null;
  observacao: string | null;
  vencido: boolean;
}

export interface TotaisLancamentos {
  aberto: number;
  pago: number;
  vencido: number;
}

export interface ListaLancamentos {
  itens: LancamentoDTO[];
  totais: TotaisLancamentos;
}

export interface ResumoFinanceiro {
  vendasHoje: number;
  vendasMes: number;
  aReceber: number;
  aPagar: number;
  vencidosReceber: number;
  vencidosPagar: number;
  saldoMes: number;
}

export interface DiaFluxo {
  data: string; // AAAA-MM-DD
  entradasVendas: number;
  entradasLancamentos: number;
  saidas: number;
  saldoDia: number;
  saldoAcumulado: number;
}

export interface FluxoCaixaDTO {
  inicio: string;
  fim: string;
  dias: DiaFluxo[];
  totais: { entradas: number; saidas: number; saldo: number };
  previsto: { receber: number; pagar: number; saldo: number };
}

export interface LucroDia {
  data: string;
  faturamento: number;
  lucroBruto: number;
}

export interface LucroCategoria {
  categoria: string;
  faturamento: number;
  custo: number;
  lucro: number;
  margem: number;
}

export interface LucroProduto {
  produtoId: number;
  produto: string;
  quantidade: number;
  faturamento: number;
  lucro: number;
  margem: number;
}

export interface LucroDTO {
  de: string;
  ate: string;
  faturamento: number;
  custoMercadorias: number;
  lucroBruto: number;
  margemBruta: number;
  despesas: number;
  perdas: number;
  bonificacoes: number;
  lucroLiquido: number;
  margemLiquida: number;
  porDia: LucroDia[];
  porCategoria: LucroCategoria[];
  topProdutos: LucroProduto[];
  piores: LucroProduto[];
}

// Resposta de POST /financeiro/boletos: o lançamento criado, com o Pix copia e cola (se há chave Pix).
export interface BoletoCriado extends LancamentoDTO {
  pixCopiaECola: string | null;
}

export interface ClienteEscolhido {
  id: number;
  nome: string;
}

export interface ClienteBusca {
  id: number;
  nome: string;
  cpfCnpj: string | null;
  telefone: string | null;
}

export interface FornecedorOpcao {
  id: number;
  nome: string;
  ativo?: boolean;
}
