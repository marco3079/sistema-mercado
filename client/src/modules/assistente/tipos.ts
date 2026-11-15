// Tipos da API do Assistente IA (rotas em server/src/modules/assistente/routes.ts).

export interface LinhaCartao {
  rotulo: string;
  valor: string;
}

export interface CartaoResposta {
  titulo: string;
  linhas: LinhaCartao[];
}

export type FonteResposta = 'regras' | 'ia';

// POST /assistente/perguntar
export interface RespostaAssistente {
  resposta: string;
  cartoes: CartaoResposta[];
  fonte: FonteResposta;
  sugestoes: string[];
}

// GET /assistente/historico (da mais nova para a mais antiga)
export interface ItemHistorico {
  id: number;
  pergunta: string;
  resposta: string;
  criadoEm: string;
}

// Mensagem exibida no chat.
export interface Mensagem {
  id: string;
  papel: 'usuario' | 'assistente';
  texto: string;
  cartoes?: CartaoResposta[];
  fonte?: FonteResposta;
}
