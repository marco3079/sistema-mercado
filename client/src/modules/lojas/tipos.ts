// Formatos devolvidos pela API do módulo lojas (GET /lojas, GET /lojas/:id/resumo, GET /lojas/mapa).

export type TipoLoja = 'LOJA' | 'CENTRO_DISTRIBUICAO';

export interface LojaDTO {
  id: number;
  nome: string;
  tipo: TipoLoja;
  cnpj: string | null;
  telefone: string | null;
  cep: string | null;
  endereco: string | null; // logradouro
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  horario: string | null;
  latitude: number | null;
  longitude: number | null;
  ativa: boolean;
}

export interface ResumoLojaDTO {
  lojaId: number;
  vendasHoje: number;
  vendasMes: number;
  itensEmEstoque: number;
  valorEstoque: number;
  usuarios: number;
}

export type StatusEntregaMapa = 'PENDENTE' | 'SEPARANDO' | 'EM_ROTA' | 'ENTREGUE' | 'FALHOU' | 'CANCELADA';

// GET /lojas/mapa
export interface LojaMapaDTO {
  id: number;
  nome: string;
  tipo: TipoLoja;
  enderecoFormatado: string | null;
  linhaEndereco1: string | null;
  linhaEndereco2: string | null;
  telefone: string | null;
  horario: string | null;
  cnpj: string | null;
  latitude: number | null;
  longitude: number | null;
  ativa: boolean;
}

export interface EntregaMapaDTO {
  id: number;
  codigo: string;
  destinatario: string;
  telefone: string | null;
  endereco: string;
  bairro: string | null;
  cidade: string | null;
  status: StatusEntregaMapa;
  latitude: number;
  longitude: number;
  valorCobrar: number;
  previsao: string | null;
  motorista: string | null;
}

export interface ClienteMapaDTO {
  id: number;
  nome: string;
  tipo: 'ATACADO' | 'VAREJO';
  cpfCnpj: string | null;
  telefone: string | null;
  whatsapp: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  latitude: number;
  longitude: number;
  limiteCredito: number | null; // só para o gestor
  saldoDevedor: number | null; // só para o gestor
}

export interface ParadaRotaDTO {
  entregaId: number;
  codigo: string;
  ordem: number;
  destinatario: string;
  endereco: string;
  bairro: string | null;
  status: StatusEntregaMapa;
  lat: number;
  lng: number;
}

export interface RotaFrotaDTO {
  id: number;
  codigo: string;
  status: 'MONTANDO' | 'CARREGADA' | 'EM_ROTA';
  paradas: ParadaRotaDTO[];
  loja: { nome: string; lat: number | null; lng: number | null };
}

export interface FrotaMapaDTO {
  rastreadorId: number;
  nome: string;
  tipo: 'VEICULO' | 'MOTORISTA' | 'CARRINHO' | 'PALETE' | 'EQUIPAMENTO' | 'OUTRO';
  veiculo: { placa: string; modelo: string } | null;
  motorista: string | null;
  lat: number;
  lng: number;
  velocidade: number | null;
  bateria: number | null;
  ultimoSinalEm: string | null;
  online: boolean;
  rota: RotaFrotaDTO | null;
}

export interface MapaLojasDTO {
  lojas: LojaMapaDTO[];
  entregas: EntregaMapaDTO[];
  clientes: ClienteMapaDTO[];
  frota: FrotaMapaDTO[];
}

export const OPCOES_TIPO_LOJA: { valor: string; rotulo: string }[] = [
  { valor: 'LOJA', rotulo: 'Loja' },
  { valor: 'CENTRO_DISTRIBUICAO', rotulo: 'Centro de distribuição' },
];

export function rotuloTipoLoja(tipo: TipoLoja): string {
  return tipo === 'CENTRO_DISTRIBUICAO' ? 'Centro de distribuição' : 'Loja';
}

export const ROTULO_STATUS_ENTREGA: Record<StatusEntregaMapa, string> = {
  PENDENTE: 'Pendente',
  SEPARANDO: 'Separando',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregue',
  FALHOU: 'Falhou',
  CANCELADA: 'Cancelada',
};
