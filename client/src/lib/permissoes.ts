// Ações sensíveis de quem não é gestor e o que cada modo quer dizer (espelha server/src/lib/autorizacao.ts).

export type AcaoSensivel =
  | 'CANCELAR_ITEM'
  | 'CANCELAR_VENDA'
  | 'DESCONTO_MANUAL'
  | 'SANGRIA'
  | 'FIADO_ACIMA_LIMITE'
  | 'AJUSTE_ESTOQUE'
  | 'ALTERAR_PRECO';

export type Modo = 'LIVRE' | 'COM_SENHA' | 'SO_GESTOR';

export const ACOES: AcaoSensivel[] = [
  'CANCELAR_ITEM',
  'CANCELAR_VENDA',
  'DESCONTO_MANUAL',
  'SANGRIA',
  'FIADO_ACIMA_LIMITE',
  'AJUSTE_ESTOQUE',
  'ALTERAR_PRECO',
];

export const ROTULOS_ACOES: Record<AcaoSensivel, string> = {
  CANCELAR_ITEM: 'Cancelar item no PDV',
  CANCELAR_VENDA: 'Cancelar venda',
  DESCONTO_MANUAL: 'Dar desconto na venda',
  SANGRIA: 'Fazer sangria do caixa',
  FIADO_ACIMA_LIMITE: 'Vender fiado acima do limite',
  AJUSTE_ESTOQUE: 'Ajustar estoque e lançar perdas',
  ALTERAR_PRECO: 'Alterar preço de venda',
};

export const ROTULOS_MODOS: Record<Modo, string> = {
  LIVRE: 'Livre',
  COM_SENHA: 'Com a senha do gestor',
  SO_GESTOR: 'Só o gestor',
};

// GET /permissoes e GET /permissoes/minhas (regras; a senha só aparece no GET /permissoes).
export interface RegrasDTO {
  regras: Record<AcaoSensivel, Modo>;
}

export interface PermissoesDTO extends RegrasDTO {
  senhaDefinida: boolean;
}

// Rótulo de uma ação; código desconhecido vira um texto genérico.
export function rotuloAcao(acao: string): string {
  return (ROTULOS_ACOES as Record<string, string>)[acao] ?? 'Ação do sistema';
}
