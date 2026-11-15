// Tipos e rótulos das telas de estoque em terceiros (/api/terceiros, /api/remessas-terceiro).
import { formatarQuantidade } from '../../lib/mercado';

export type TipoTerceiro = 'CONSIGNACAO' | 'COMODATO' | 'CONSERTO' | 'DEMONSTRACAO' | 'ARMAZEM' | 'EVENTO' | 'OUTRO';
export type StatusRemessa = 'ABERTA' | 'PARCIAL' | 'ENCERRADA' | 'CANCELADA';
export type MotivoBaixa = 'VENDIDO' | 'CONSUMIDO' | 'PERDIDO' | 'OUTRO';
export type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

export const ROTULOS_TIPO: Record<TipoTerceiro, string> = {
  CONSIGNACAO: 'Consignação',
  COMODATO: 'Comodato',
  CONSERTO: 'Conserto',
  DEMONSTRACAO: 'Demonstração',
  ARMAZEM: 'Armazém',
  EVENTO: 'Evento',
  OUTRO: 'Outro',
};

export const COR_TIPO: Record<TipoTerceiro, CorSelo> = {
  CONSIGNACAO: 'azul',
  COMODATO: 'verde',
  CONSERTO: 'amarelo',
  DEMONSTRACAO: 'cinza',
  ARMAZEM: 'azul',
  EVENTO: 'amarelo',
  OUTRO: 'cinza',
};

export const TIPOS_TERCEIRO = Object.keys(ROTULOS_TIPO) as TipoTerceiro[];

export const ROTULOS_STATUS: Record<StatusRemessa, string> = {
  ABERTA: 'Aberta',
  PARCIAL: 'Parcial',
  ENCERRADA: 'Encerrada',
  CANCELADA: 'Cancelada',
};

export const COR_STATUS: Record<StatusRemessa, CorSelo> = {
  ABERTA: 'azul',
  PARCIAL: 'amarelo',
  ENCERRADA: 'verde',
  CANCELADA: 'cinza',
};

export const ROTULOS_MOTIVO_BAIXA: Record<MotivoBaixa, string> = {
  VENDIDO: 'Vendido',
  CONSUMIDO: 'Consumido',
  PERDIDO: 'Perdido',
  OUTRO: 'Outro',
};

export interface TerceiroLinha {
  id: number;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  contato: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  remessasAbertas: number;
  itensEmPosse: number;
  produtosEmPosse: number;
  valorEmPosse: number;
  atrasadas: number;
  // Link do portal (código de acesso) e pedidos do portal aguardando aprovação.
  codigoAcesso: string | null;
  pedidosPendentes: number;
}

export interface ResumoTerceiros {
  valorEmPosse: number;
  itensEmPosse: number;
  produtosEmPosse: number;
  terceirosComSaldo: number;
  remessasAbertas: number;
  atrasadas: number;
  pedidosPendentes: number;
  porTipo: { tipo: TipoTerceiro; valor: number }[];
}

// Resposta de POST /terceiros/:id/portal (e /portal/novo): código e caminho público (/remessa/<código>).
export interface RespostaPortal {
  codigoAcesso: string;
  caminho: string;
}

export type StatusPedido = 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';

export interface ItemPedido {
  produtoId: number;
  codigo: string;
  nome: string;
  foto: string | null;
  unidade: string;
  quantidade: number;
  saldoLoja: number;
  // Quantidade efetivamente enviada na aprovação (opcional; o servidor pode não trazer).
  quantidadeEnviada?: number | null;
}

// Pedido enviado pelo portal do terceiro (GET /pedidos-remessa).
export interface PedidoRemessa {
  id: number;
  numero: number;
  status: StatusPedido;
  tipo: TipoTerceiro;
  terceiro: { id: number; nome: string; telefone: string | null };
  loja: { id: number; nome: string };
  dataDesejada: string | null;
  observacoes: string | null;
  motivoRecusa: string | null;
  remessaId: number | null;
  remessaNumero: number | null;
  criadoEm: string;
  respondidoEm: string | null;
  totalItens: number;
  valorEstimado: number;
  itens: ItemPedido[];
}

export interface SaldoTerceiro {
  id: number;
  terceiroId: number;
  terceiro: string;
  lojaId: number;
  loja: string;
  produtoId: number;
  codigo: string;
  nome: string;
  foto: string | null;
  categoria: string | null;
  unidade: string;
  quantidade: number;
  valor: number;
}

export interface RespostaSaldos {
  itens: SaldoTerceiro[];
  total: number;
  valorTotal: number;
}

export interface TotaisRemessa {
  enviado: number;
  retornado: number;
  baixado: number;
  pendente: number;
  valorPendente: number;
}

export interface FotoRemessa {
  produtoId: number;
  nome: string;
  foto: string | null;
  categoria: string | null;
}

export interface RemessaLinha {
  id: number;
  numero: number;
  tipo: TipoTerceiro;
  status: StatusRemessa;
  documento: string | null;
  observacoes: string | null;
  terceiroId: number;
  terceiro: string;
  terceiroDocumento: string | null;
  lojaId: number;
  loja: string;
  previsaoRetorno: string | null;
  atrasada: boolean;
  criadoEm: string;
  encerradaEm: string | null;
  totais: TotaisRemessa;
  produtos: number;
  unidades: UnidadeTotais[];
  fotos: FotoRemessa[];
}

export interface ItemRemessa {
  id: number;
  produtoId: number;
  produto: string;
  codigo: string;
  foto: string | null;
  categoria: string | null;
  unidade: string;
  quantidade: number;
  retornada: number;
  baixada: number;
  pendente: number;
  custoUnitario: number;
  precoCobranca: number | null;
}

export interface RemessaDetalhe extends RemessaLinha {
  itens: ItemRemessa[];
}

// Produto retornado pela busca de /api/produtos (com a foto e o saldo da loja).
export interface ProdutoBusca {
  id: number;
  codigo: string;
  ean: string | null;
  nome: string;
  categoria: string | null;
  unidade: string;
  precoVenda: number;
  foto: string | null;
  estoqueLoja: number;
}

// Só GESTOR e ESTOQUISTA lançam; os outros perfis apenas consultam.
export function podeEscrever(perfil: string | undefined): boolean {
  return perfil === 'GESTOR' || perfil === 'ESTOQUISTA';
}

// Dias entre hoje e a data (negativo = já passou).
export function diasAte(iso: string): number {
  const alvo = new Date(iso);
  const hoje = new Date();
  alvo.setHours(0, 0, 0, 0);
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

// Valor digitado com vírgula, para campos de dinheiro e quantidade.
export function textoNumero(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

export function textoPreco(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

// Totais de uma remessa separados por unidade (vindos do servidor).
export interface UnidadeTotais {
  unidade: string;
  enviado: number;
  retornado: number;
  baixado: number;
  pendente: number;
}

// Soma um campo dos itens por unidade e junta com " · " (ex.: "5 un · 2 pct"), sem misturar unidades.
export function textoPorUnidade(itens: ItemRemessa[], campo: 'quantidade' | 'retornada' | 'baixada' | 'pendente'): string {
  const mapa = new Map<string, number>();
  for (const i of itens) {
    const unidade = i.unidade.toLowerCase();
    mapa.set(unidade, (mapa.get(unidade) ?? 0) + i[campo]);
  }
  if (mapa.size === 0) return formatarQuantidade(0, 'un');
  return [...mapa.entries()].map(([unidade, valor]) => formatarQuantidade(valor, unidade)).join(' · ');
}
