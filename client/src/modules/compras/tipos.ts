// Tipos das respostas da API de compras (espelham server/src/modules/compras/routes.ts).

export type StatusPedido =
  | 'RASCUNHO'
  | 'ENVIADO'
  | 'CONFIRMADO'
  | 'EM_TRANSITO'
  | 'RECEBIDO_PARCIAL'
  | 'RECEBIDO'
  | 'CANCELADO';

export type StatusCotacao = 'ABERTA' | 'FECHADA' | 'CANCELADA';
export type StatusRecebimento = 'CONFERINDO' | 'CONCLUIDO' | 'COM_DIVERGENCIA';

export const ROTULO_STATUS_PEDIDO: Record<StatusPedido, { rotulo: string; cor: 'cinza' | 'azul' | 'amarelo' | 'verde' | 'vermelho' }> = {
  RASCUNHO: { rotulo: 'Rascunho', cor: 'cinza' },
  ENVIADO: { rotulo: 'Enviado', cor: 'azul' },
  CONFIRMADO: { rotulo: 'Confirmado', cor: 'azul' },
  EM_TRANSITO: { rotulo: 'Em trânsito', cor: 'amarelo' },
  RECEBIDO_PARCIAL: { rotulo: 'Recebido parcial', cor: 'amarelo' },
  RECEBIDO: { rotulo: 'Recebido', cor: 'verde' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'vermelho' },
};

export const ROTULO_STATUS_COTACAO: Record<StatusCotacao, { rotulo: string; cor: 'cinza' | 'azul' | 'vermelho' }> = {
  ABERTA: { rotulo: 'Aberta', cor: 'azul' },
  FECHADA: { rotulo: 'Fechada', cor: 'cinza' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'vermelho' },
};

export const ROTULO_STATUS_RECEBIMENTO: Record<StatusRecebimento, { rotulo: string; cor: 'amarelo' | 'verde' | 'vermelho' }> = {
  CONFERINDO: { rotulo: 'Conferindo', cor: 'amarelo' },
  CONCLUIDO: { rotulo: 'Concluído', cor: 'verde' },
  COM_DIVERGENCIA: { rotulo: 'Com divergência', cor: 'vermelho' },
};

// Fornecedores
export interface FornecedorDTO {
  id: number;
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  inscricaoEstadual: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  contato: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  prazoEntregaDias: number;
  condicaoPagamento: string | null;
  pedidoMinimo: number;
  diasVisita: string | null;
  avaliacao: number;
  observacoes: string | null;
  ativo: boolean;
}

export interface FornecedorLinha extends FornecedorDTO {
  totalComprado12m: number;
  pedidosAbertos: number;
}

export interface VinculoProdutoDTO {
  produtoId: number;
  nome: string;
  codigo: string;
  unidade: string;
  codigoFornecedor: string | null;
  ultimoPreco: number | null;
  fatorConversao: number;
}

export interface PedidoDoFornecedor {
  id: number;
  numero: number;
  status: StatusPedido;
  total: number;
  criadoEm: string;
}

export interface AvaliacaoDTO {
  id: number;
  pontualidade: number;
  qualidade: number;
  atendimento: number;
  media: number;
  comentario: string | null;
  criadoEm: string;
}

export interface FornecedorDetalhe extends FornecedorLinha {
  produtos: VinculoProdutoDTO[];
  pedidos: PedidoDoFornecedor[];
  avaliacoes: AvaliacaoDTO[];
}

// Produtos (busca usada nas telas de compra; vem de GET /produtos)
export interface ProdutoBuscaDTO {
  id: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  precoCusto: number;
  precoVenda: number;
}

// Sugestão de compra
export interface SugestaoDTO {
  produtoId: number;
  codigo: string;
  nome: string;
  unidade: string;
  fornecedorId: number | null;
  fornecedor: string | null;
  estoque: number;
  estoqueMinimo: number;
  giroDiario: number;
  emPedido: number;
  sugerido: number;
  ultimoPreco: number;
  valorEstimado: number;
}

export interface RetornoRascunho {
  pedidoId: number;
  numero: number;
  fornecedor: string;
}

// Cotações
export interface CotacaoLinha {
  id: number;
  titulo: string;
  status: StatusCotacao;
  prazo: string | null;
  criadoEm: string;
  fechadaEm: string | null;
  itens: number;
  fornecedores: number;
  respondidos: number;
}

export interface CotacaoItemDTO {
  produtoId: number;
  nome: string;
  unidade: string;
  quantidade: number;
}

export interface CotacaoFornecedorDTO {
  fornecedorId: number;
  nome: string;
  whatsapp: string | null;
  telefone: string | null;
  token: string;
  respondidoEm: string | null;
}

export interface RespostaCotacaoDTO {
  produtoId: number;
  fornecedorId: number;
  preco: number;
  prazoDias: number | null;
  vencedora: boolean;
}

export interface MelhorPrecoDTO {
  produtoId: number;
  fornecedorId: number;
  preco: number;
}

export interface CotacaoDetalhe {
  id: number;
  titulo: string;
  status: StatusCotacao;
  prazo: string | null;
  criadoEm: string;
  fechadaEm: string | null;
  itens: CotacaoItemDTO[];
  fornecedores: CotacaoFornecedorDTO[];
  respostas: RespostaCotacaoDTO[];
  melhorPreco: MelhorPrecoDTO[];
}

// Cotação pública (página do fornecedor, sem login)
export interface ItemCotacaoPublica {
  produtoId: number;
  nome: string;
  unidade: string;
  quantidade: number;
  precoRespondido: number | null;
  prazoDias: number | null;
}

export interface CotacaoPublica {
  titulo: string;
  prazo: string | null;
  fornecedor: string;
  empresa: string;
  fechada: boolean;
  itens: ItemCotacaoPublica[];
}

// Pedidos de compra
export interface PedidoLinha {
  id: number;
  numero: number;
  fornecedorId: number;
  fornecedor: string;
  status: StatusPedido;
  total: number;
  criadoEm: string;
  previsaoEntrega: string | null;
  itens: number;
  rastreio: string | null;
}

export interface ItemPedidoDTO {
  id: number;
  produtoId: number;
  nome: string;
  codigo: string;
  unidade: string;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
  quantidadeRecebida: number;
}

export interface PedidoDetalhe {
  id: number;
  numero: number;
  status: StatusPedido;
  fornecedor: { id: number; nome: string; whatsapp: string | null; telefone: string | null; email: string | null };
  total: number;
  condicaoPagamento: string | null;
  previsaoEntrega: string | null;
  rastreio: string | null;
  observacoes: string | null;
  criadoEm: string;
  enviadoEm: string | null;
  confirmadoEm: string | null;
  recebidoEm: string | null;
  cotacaoId: number | null;
  itens: ItemPedidoDTO[];
  recebimentos: { id: number; status: StatusRecebimento; criadoEm: string }[];
}

// Resposta de mudança de status: o pedido mais o texto para copiar.
export interface PedidoComTexto extends PedidoDetalhe {
  textoPedido: string;
}

// Recebimentos
export interface RecebimentoLinha {
  id: number;
  numeroNota: string | null;
  fornecedorId: number;
  fornecedor: string;
  status: StatusRecebimento;
  valorNota: number | null;
  pedidoCompraId: number | null;
  itens: number;
  criadoEm: string;
  concluidoEm: string | null;
}

export interface ItemRecebimentoDTO {
  id: number;
  produtoId: number;
  nome: string;
  codigo: string;
  unidade: string;
  quantidadeNota: number;
  quantidadeRecebida: number | null;
  precoUnitario: number;
  fatorConversao: number;
  lote: string | null;
  validade: string | null;
  divergencia: string | null;
  custoAtual: number;
  precoVendaAtual: number;
  precoSugerido: number;
}

export interface ItemNaoAssociado {
  cProd: string;
  cEAN: string | null;
  xProd: string;
  qCom: number;
  vUnCom: number;
}

export interface RecebimentoDetalhe {
  id: number;
  status: StatusRecebimento;
  numeroNota: string | null;
  serieNota: string | null;
  chaveNfe: string | null;
  valorNota: number | null;
  fornecedor: { id: number; nome: string; prazoEntregaDias: number; condicaoPagamento: string | null };
  pedidoCompraId: number | null;
  observacoes: string | null;
  criadoEm: string;
  concluidoEm: string | null;
  itens: ItemRecebimentoDTO[];
  naoAssociados: ItemNaoAssociado[];
}
