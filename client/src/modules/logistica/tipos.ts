// Tipos das respostas da API de logística (valores em number, datas em ISO).

export type StatusEntrega = 'PENDENTE' | 'SEPARANDO' | 'EM_ROTA' | 'ENTREGUE' | 'FALHOU' | 'CANCELADA';
export type StatusRota = 'MONTANDO' | 'CARREGADA' | 'EM_ROTA' | 'CONCLUIDA' | 'CANCELADA';
export type StatusTransferencia = 'SOLICITADA' | 'ENVIADA' | 'RECEBIDA' | 'CANCELADA';
export type TipoVeiculo = 'Moto' | 'Carro' | 'Van' | 'Caminhão';

export type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

export const TIPOS_VEICULO: TipoVeiculo[] = ['Moto', 'Carro', 'Van', 'Caminhão'];

export interface VeiculoDTO {
  id: number;
  placa: string;
  modelo: string;
  tipo: string;
  capacidadeKg: number;
  capacidadeVolumes: number | null;
  ativo: boolean;
}

export interface AvisoWhatsappDTO {
  status: string;
  em: string;
  mensagem: string;
  simulado: boolean;
}

export interface EntregaDTO {
  id: number;
  codigo: string;
  status: StatusEntrega;
  destinatario: string;
  telefone: string | null;
  endereco: string;
  bairro: string | null;
  cidade: string | null;
  latitude: number | null;
  longitude: number | null;
  taxa: number;
  valorCobrar: number;
  pesoKg: number;
  previsao: string | null;
  observacao: string | null;
  recebidoPor: string | null;
  motivoFalha: string | null;
  rotaId: number | null;
  rotaCodigo: string | null;
  ordem: number | null;
  motorista: string | null;
  vendaNumero: number | null;
  pedidoVendaNumero: number | null;
  criadoEm: string;
  saiuEm: string | null;
  entregueEm: string | null;
  avisos: AvisoWhatsappDTO[];
}

export interface LojaRotaDTO {
  id: number;
  nome: string;
  latitude: number | null;
  longitude: number | null;
}

export interface PessoaDTO {
  id: number;
  nome: string;
}

export interface TransferenciaDaRotaDTO {
  id: number;
  origem: string;
  destino: string;
  status: StatusTransferencia;
  itens: number;
}

export interface RotaResumoDTO {
  id: number;
  codigo: string;
  data: string;
  status: StatusRota;
  veiculo: VeiculoDTO | null;
  motorista: PessoaDTO | null;
  pesoTotalKg: number;
  capacidadeKg: number | null;
  ocupacao: number | null;
  distanciaKm: number | null;
  entregas: number;
  entregues: number;
  transferencias: number;
}

export interface RotaDTO {
  id: number;
  codigo: string;
  data: string;
  status: StatusRota;
  lojaId: number;
  loja: LojaRotaDTO;
  veiculoId: number | null;
  veiculo: VeiculoDTO | null;
  motoristaId: number | null;
  motorista: PessoaDTO | null;
  capacidadeKg: number | null;
  pesoTotalKg: number;
  ocupacao: number | null;
  distanciaKm: number | null;
  kmInicial: number | null;
  kmFinal: number | null;
  saidaEm: string | null;
  retornoEm: string | null;
  observacoes: string | null;
  entregas: EntregaDTO[];
  transferencias: TransferenciaDaRotaDTO[];
}

export interface ItemRomaneioDTO {
  descricao: string;
  quantidade: number;
  unidade: string;
}

export interface EntregaRomaneioDTO {
  ordem: number | null;
  codigo: string;
  destinatario: string;
  telefone: string | null;
  endereco: string;
  bairro: string | null;
  cidade: string | null;
  valorCobrar: number;
  pesoKg: number;
  observacao: string | null;
  itens: ItemRomaneioDTO[];
}

export interface RomaneioDTO {
  codigo: string;
  data: string;
  loja: string;
  veiculo: VeiculoDTO | null;
  motorista: string | null;
  observacoes: string | null;
  pesoTotalKg: number;
  totalCobrar: number;
  entregas: EntregaRomaneioDTO[];
}

export interface TransferenciaResumoDTO {
  id: number;
  origemLojaId: number;
  origem: string;
  destinoLojaId: number;
  destino: string;
  status: StatusTransferencia;
  criadoEm: string;
  enviadaEm: string | null;
  recebidaEm: string | null;
  itens: number;
  rotaCodigo: string | null;
}

export interface ItemTransferenciaDTO {
  id: number;
  produtoId: number;
  codigo: string;
  produto: string;
  unidade: string;
  quantidade: number;
  quantidadeRecebida: number | null;
}

export interface TransferenciaDTO {
  id: number;
  status: StatusTransferencia;
  origemLojaId: number;
  origem: string;
  destinoLojaId: number;
  destino: string;
  observacoes: string | null;
  rotaId: number | null;
  rotaCodigo: string | null;
  criadoEm: string;
  enviadaEm: string | null;
  recebidaEm: string | null;
  itens: ItemTransferenciaDTO[];
}

export interface RastreioDTO {
  codigo: string;
  status: StatusEntrega;
  destinatario: string;
  bairro: string | null;
  previsao: string | null;
  saiuEm: string | null;
  entregueEm: string | null;
  posicaoNaRota: number | null;
  empresa: string;
  historico: { status: string | null; em: string | null; mensagem: string | null }[];
}

export const ROTULO_ENTREGA: Record<StatusEntrega, string> = {
  PENDENTE: 'Pendente',
  SEPARANDO: 'Separando',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregue',
  FALHOU: 'Não entregue',
  CANCELADA: 'Cancelada',
};

export const COR_ENTREGA: Record<StatusEntrega, CorSelo> = {
  PENDENTE: 'amarelo',
  SEPARANDO: 'azul',
  EM_ROTA: 'azul',
  ENTREGUE: 'verde',
  FALHOU: 'vermelho',
  CANCELADA: 'cinza',
};

export const ROTULO_ROTA: Record<StatusRota, string> = {
  MONTANDO: 'Montando',
  CARREGADA: 'Carregada',
  EM_ROTA: 'Em rota',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

export const COR_ROTA: Record<StatusRota, CorSelo> = {
  MONTANDO: 'amarelo',
  CARREGADA: 'azul',
  EM_ROTA: 'azul',
  CONCLUIDA: 'verde',
  CANCELADA: 'cinza',
};

export const ROTULO_TRANSFERENCIA: Record<StatusTransferencia, string> = {
  SOLICITADA: 'Solicitada',
  ENVIADA: 'Enviada',
  RECEBIDA: 'Recebida',
  CANCELADA: 'Cancelada',
};

export const COR_TRANSFERENCIA: Record<StatusTransferencia, CorSelo> = {
  SOLICITADA: 'amarelo',
  ENVIADA: 'azul',
  RECEBIDA: 'verde',
  CANCELADA: 'cinza',
};

// Link do mapa a partir de coordenadas, ou do endereço quando não há coordenadas.
export function linkDoMapa(e: Pick<EntregaDTO, 'latitude' | 'longitude' | 'endereco' | 'bairro'>): string {
  const alvo =
    e.latitude !== null && e.longitude !== null
      ? `${e.latitude},${e.longitude}`
      : [e.endereco, e.bairro].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(alvo)}`;
}

// Só os dígitos do telefone (para o link tel:).
export function telefoneParaLink(telefone: string): string {
  return telefone.replace(/\D/g, '');
}
