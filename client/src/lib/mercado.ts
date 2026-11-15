// Utilitários comuns das telas do mercado. Formatação de moeda e data ficam em ui/index.tsx
// (formatarMoeda, formatarData, formatarDataHora).

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// "há 5 min", "há 2 h".
export function tempoDesde(iso: string, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutos)) return '';
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Quantidade com até 3 casas (kg) e a unidade: "1,250 kg", "3 un".
export function formatarQuantidade(qtd: number, unidade?: string): string {
  const inteiro = Number.isInteger(qtd);
  const texto = qtd.toLocaleString('pt-BR', { minimumFractionDigits: inteiro ? 0 : 3, maximumFractionDigits: 3 });
  return unidade ? `${texto} ${unidade.toLowerCase()}` : texto;
}

export function formatarPercentual(n: number): string {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Texto digitado ("12,50", "1.234,5", "3") para número. null se inválido.
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, '');
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

// Data de hoje no formato AAAA-MM-DD (para <input type="date"> e filtros de período).
export function hojeIso(deslocamentoDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'DZ'] as const;
export type Unidade = (typeof UNIDADES)[number];

export const ROTULOS_FORMA_PAGAMENTO: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  FIADO: 'Fiado',
  VALE_ALIMENTACAO: 'Vale-alimentação',
  BOLETO: 'Boleto',
};

export const ROTULOS_ORIGEM_VENDA: Record<string, string> = {
  PDV: 'PDV',
  DELIVERY: 'Delivery',
  MARKETPLACE: 'Marketplace',
  FORCA_VENDAS: 'Força de vendas',
  B2B: 'Loja B2B',
};
