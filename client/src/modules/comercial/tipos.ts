// Tipos das respostas da API do módulo comercial (força de vendas, faturamento, B2B e delivery).

export type StatusPedido = 'ORCAMENTO' | 'PENDENTE' | 'APROVADO' | 'SEPARANDO' | 'FATURADO' | 'CANCELADO';
export type OrigemPedido = 'FORCA_VENDAS' | 'B2B';
export type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

export interface PedidoLista {
  id: number;
  numero: number;
  cliente: string;
  vendedor: string | null;
  origem: string;
  status: StatusPedido;
  total: number;
  subtotalTabela: number;
  flex: number;
  criadoEm: string;
  faturadoEm: string | null;
  vendaNumero: number | null;
  entregaCodigo: string | null;
}

export interface ItemPedidoDetalhe {
  id: number;
  produtoId: number;
  produto: string;
  unidade: string;
  quantidade: number;
  precoTabela: number;
  precoNegociado: number;
  total: number;
  foto: string | null;
  categoria: string | null;
}

export interface PedidoDetalhe extends PedidoLista {
  clienteId: number;
  vendedorId: number | null;
  condicaoPagamento: string | null;
  formaPagamento: string | null;
  previsaoEntrega: string | null;
  observacoes: string | null;
  itens: ItemPedidoDetalhe[];
}

// Catálogo do vendedor (GET /pedidos-venda/precos).
export interface ProdutoPrecoVenda {
  produtoId: number;
  codigo: string;
  nome: string;
  unidade: string;
  precoTabela: number;
  precoAtacado: number | null;
  estoque: number;
  promocao: string | null;
  foto: string | null;
  categoria: string | null;
}

export interface ResumoVendedor {
  saldoFlex: number;
  comissaoPercentual: number;
  vendidoMes: number;
  comissaoMes: number;
  pedidosAbertos: number;
  clientes: number;
}

// Cliente como vem de GET /clientes (só os campos usados aqui).
export interface ClienteResumo {
  id: number;
  nome: string;
  cidade: string | null;
  telefone: string | null;
  whatsapp: string | null;
  vendedorId: number | null;
  saldoDevedor: number;
  bloqueado: boolean;
}

export interface ResultadoFaturamento {
  faturados: { pedidoId: number; vendaNumero: number; notaNumero: number | null; entregaCodigo: string }[];
  erros: { pedidoId: number; erro: string }[];
}

export interface EntregaVenda {
  vendaId: number;
  numero: number;
  origem: string;
  marketplaceId: string | null;
  cliente: string | null;
  telefone: string | null;
  endereco: string | null;
  total: number;
  formas: string[];
  entrega: { id: number; codigo: string; status: string } | null;
  criadoEm: string;
  itens: { descricao: string; quantidade: number; precoUnitario: number; total: number; foto?: string | null }[];
}

// Página pública de delivery (GET /publico/delivery/catalogo).
export interface ProdutoDelivery {
  produtoId: number;
  nome: string;
  unidade: string;
  pesavel: boolean;
  preco: number;
  precoPromocional?: number;
  descricaoPromocao?: string;
  categoriaId: number | null;
  foto: string | null;
}

export interface CatalogoDelivery {
  empresa: string;
  ativo: boolean;
  taxa: number;
  pedidoMinimo: number;
  categorias: { id: number; nome: string }[];
  produtos: ProdutoDelivery[];
}

// Página pública da loja B2B (GET /publico/b2b/:codigo).
export interface ProdutoB2B {
  produtoId: number;
  nome: string;
  unidade: string;
  preco: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  categoria: string | null;
  foto: string | null;
}

export interface CatalogoB2B {
  empresa: string;
  cliente: { nome: string };
  produtos: ProdutoB2B[];
}

export interface PedidoB2B {
  id: number;
  numero: number;
  criadoEm: string;
  status: StatusPedido;
  total: number;
}

export const ROTULO_STATUS_PEDIDO: Record<StatusPedido, string> = {
  ORCAMENTO: 'Orçamento',
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  SEPARANDO: 'Separando',
  FATURADO: 'Faturado',
  CANCELADO: 'Cancelado',
};

export const COR_STATUS_PEDIDO: Record<StatusPedido, CorSelo> = {
  ORCAMENTO: 'cinza',
  PENDENTE: 'amarelo',
  APROVADO: 'azul',
  SEPARANDO: 'azul',
  FATURADO: 'verde',
  CANCELADO: 'vermelho',
};

export const ROTULO_STATUS_ENTREGA: Record<string, string> = {
  PENDENTE: 'Pendente',
  SEPARANDO: 'Separando',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregue',
  FALHOU: 'Falhou',
  CANCELADA: 'Cancelada',
};

export const COR_STATUS_ENTREGA: Record<string, CorSelo> = {
  PENDENTE: 'amarelo',
  SEPARANDO: 'azul',
  EM_ROTA: 'azul',
  ENTREGUE: 'verde',
  FALHOU: 'vermelho',
  CANCELADA: 'cinza',
};

// Formas aceitas para o pedido de venda (força de vendas).
export const FORMAS_PEDIDO: { valor: string; rotulo: string }[] = [
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'DEBITO', rotulo: 'Débito' },
  { valor: 'CREDITO', rotulo: 'Crédito' },
  { valor: 'FIADO', rotulo: 'Fiado' },
  { valor: 'VALE_ALIMENTACAO', rotulo: 'Vale-alimentação' },
];

// Formas aceitas no delivery (pagas na entrega ou no ato).
export const FORMAS_DELIVERY: { valor: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'; rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: 'Dinheiro na entrega' },
  { valor: 'PIX', rotulo: 'Pix na entrega' },
  { valor: 'DEBITO', rotulo: 'Débito na entrega' },
  { valor: 'CREDITO', rotulo: 'Crédito na entrega' },
];

// Quantidade para exibir sem zeros à direita: "0,5", "2", "1,25". Com unidade: "0,5 kg".
export function quantidadeCurta(qtd: number, unidade?: string): string {
  const texto = qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unidade ? `${texto} ${unidade.toLowerCase()}` : texto;
}

export function soDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}
