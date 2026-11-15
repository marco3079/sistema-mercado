// Tipos das respostas da API de promoções (server/src/modules/promocoes/routes.ts).

export type TipoPromocao = 'PRECO_FIXO' | 'PERCENTUAL' | 'LEVE_PAGUE' | 'ATACADO';

export const ROTULO_TIPO_PROMOCAO: Record<TipoPromocao, string> = {
  PRECO_FIXO: 'Preço fixo',
  PERCENTUAL: 'Percentual',
  LEVE_PAGUE: 'Leve X pague Y',
  ATACADO: 'Atacado',
};

export type AbaPromocao = 'ativas' | 'agendadas' | 'encerradas';

export interface PromocaoDTO {
  id: number;
  nome: string;
  tipo: TipoPromocao;
  produtoId: number | null;
  produto: string | null;
  categoriaId: number | null;
  categoria: string | null;
  valor: number;
  levar: number | null;
  pagar: number | null;
  qtdMinima: number | null;
  inicio: string;
  fim: string;
  ativa: boolean;
  industria: string | null;
  bonificacaoUnidade: number | null;
  descricao: string;
  precoNormal: number | null;
  // Preço por unidade já com o desconto (PRECO_FIXO: o valor; PERCENTUAL: preço normal menos o %). Outros: null.
  precoPromocional: number | null;
  // Foto do produto (promoção de produto) e até 4 fotos de produtos da categoria (promoção de categoria).
  foto: string | null;
  fotos: string[];
  // Nome da categoria do produto (ou da própria categoria da promoção).
  setor: string | null;
  unidadesVendidas: number;
}

// Sugestão de "promoção inteligente": só vira promoção quando o usuário cria.
export interface SugestaoDTO {
  produtoId: number;
  produto: string;
  motivo: string;
  tipo: TipoPromocao;
  valor: number;
  inicio: string;
  fim: string;
}

export interface BonificacaoItemDTO {
  promocaoId: number;
  nome: string;
  industria: string;
  unidadesVendidas: number;
  bonificacaoUnidade: number;
  valorAReceber: number;
}

export interface BonificacoesDTO {
  inicio: string;
  fim: string;
  itens: BonificacaoItemDTO[];
  total: number;
  simulado: boolean;
}

export interface LancamentoBonificacaoDTO {
  lancamentoId: number;
  industria: string;
  valor: number;
  descricao: string;
  simulado: boolean;
}
