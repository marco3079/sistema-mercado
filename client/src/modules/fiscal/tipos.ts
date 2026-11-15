// Tipos das respostas da API fiscal (/fiscal e /contador).

export type ModeloNota = 'NFCE' | 'NFE';
export type StatusNota = 'PENDENTE' | 'AUTORIZADA' | 'REJEITADA' | 'CANCELADA';
export type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

export interface NotaFiscalDTO {
  id: number;
  modelo: ModeloNota;
  numero: number;
  serie: number;
  chave: string | null;
  status: StatusNota;
  valor: number;
  criadoEm: string;
  autorizadaEm: string | null;
  vendaId: number | null;
  vendaNumero: number | null;
  cliente: string | null;
  motivo: string | null;
  enviadaContadorEm: string | null;
}

export interface TotaisNotas {
  quantidade: number;
  valor: number;
  autorizadas: number;
  canceladas: number;
}

export interface ListaNotasDTO {
  itens: NotaFiscalDTO[];
  totais: TotaisNotas;
}

export interface ResumoMesDTO {
  mes: string;
  notas: number;
  valor: number;
  canceladas: number;
  enviadoEm: string | null;
}

export interface ResultadoEnvioDTO {
  enviado: boolean;
  simulado: boolean;
  mensagem: string;
}

// Só a parte pública da configuração (GET /configuracoes/mercado/publico).
export interface ConfigPublicaFiscalDTO {
  fiscalProvedor: string;
}

export const ROTULOS_MODELO: Record<ModeloNota, string> = {
  NFCE: 'NFC-e',
  NFE: 'NF-e',
};

export const STATUS_NOTA: Record<StatusNota, { rotulo: string; cor: CorSelo }> = {
  PENDENTE: { rotulo: 'Pendente', cor: 'amarelo' },
  AUTORIZADA: { rotulo: 'Autorizada', cor: 'verde' },
  REJEITADA: { rotulo: 'Rejeitada', cor: 'vermelho' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
};
