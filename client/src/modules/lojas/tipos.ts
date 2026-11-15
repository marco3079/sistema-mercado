// Formatos devolvidos pela API do módulo lojas (GET /lojas, GET /lojas/:id/resumo).

export type TipoLoja = 'LOJA' | 'CENTRO_DISTRIBUICAO';

export interface LojaDTO {
  id: number;
  nome: string;
  tipo: TipoLoja;
  cnpj: string | null;
  telefone: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
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

export const OPCOES_TIPO_LOJA: { valor: string; rotulo: string }[] = [
  { valor: 'LOJA', rotulo: 'Loja' },
  { valor: 'CENTRO_DISTRIBUICAO', rotulo: 'Centro de distribuição' },
];

export function rotuloTipoLoja(tipo: TipoLoja): string {
  return tipo === 'CENTRO_DISTRIBUICAO' ? 'Centro de distribuição' : 'Loja';
}
