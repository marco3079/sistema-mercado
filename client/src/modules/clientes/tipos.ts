// Tipos das respostas da API de clientes e fiado (server/src/modules/clientes/routes.ts).

export type TipoCliente = 'VAREJO' | 'ATACADO';

export interface ClienteDTO {
  id: number;
  nome: string;
  tipo: TipoCliente;
  cpfCnpj: string | null;
  razaoSocial: string | null;
  inscricaoEstadual: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  latitude: number | null;
  longitude: number | null;
  limiteCredito: number;
  saldoDevedor: number;
  bloqueado: boolean;
  observacoes: string | null;
  vendedorId: number | null;
  codigoB2B: string | null;
  ativo: boolean;
}

export interface CompraDTO {
  id: number;
  numero: number;
  criadoEm: string;
  total: number;
  origem: string;
}

export interface ClienteDetalheDTO extends ClienteDTO {
  ultimasCompras: CompraDTO[];
  totalComprado: number;
  ticketMedio: number;
}

export type TipoMovimentoFiado = 'COMPRA' | 'PAGAMENTO';

export type FormaRecebimento = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';

export interface MovimentoFiadoDTO {
  id: number;
  criadoEm: string;
  tipo: TipoMovimentoFiado;
  valor: number;
  descricao: string | null;
  formaPagamento: string | null;
  vendaNumero: number | null;
}

export interface ExtratoFiadoDTO {
  saldoDevedor: number;
  limiteCredito: number;
  disponivel: number;
  movimentos: MovimentoFiadoDTO[];
}

export interface DevedorDTO {
  id: number;
  nome: string;
  saldoDevedor: number;
  limiteCredito: number;
  // Só vem do resumo do gestor (dias desde a compra mais antiga não quitada).
  diasEmAtraso: number | null;
  telefone: string | null;
  whatsapp: string | null;
}

export interface ResumoFiadoDTO {
  totalEmAberto: number;
  clientes: DevedorDTO[];
}
