// Tipos da migração de dados (espelho de server/src/modules/migracao/tipos.ts e das respostas das rotas).
// Não mude sem combinar com o @main.

export type Entidade = 'fornecedores' | 'clientes' | 'produtos' | 'estoque' | 'fiado' | 'contas';

export const ORDEM_ENTIDADES: Entidade[] = ['fornecedores', 'clientes', 'produtos', 'estoque', 'fiado', 'contas'];

export const ROTULOS_ENTIDADE: Record<Entidade, string> = {
  fornecedores: 'Fornecedores',
  clientes: 'Clientes',
  produtos: 'Produtos',
  estoque: 'Estoque inicial',
  fiado: 'Saldo de fiado',
  contas: 'Contas a pagar e a receber',
};

export type Fonte = 'planilha' | 'sped' | 'sintegra' | 'nfe';
export type Situacao = 'novo' | 'existe' | 'igual' | 'erro';
export type Decisao = 'atualizar' | 'ignorar';
export type ValorSimples = string | number | boolean | null;

// O registro é opaco para a tela: ela só o devolve ao servidor em /migracao/aplicar.
export type Registro = Record<string, ValorSimples | undefined>;

export interface Mudanca {
  campo: string;
  rotulo: string;
  de: ValorSimples;
  para: ValorSimples;
}

export interface ItemConferencia {
  indice: number;
  origem: string;
  resumo: string;
  registro: Registro;
  situacao: Situacao;
  existenteId: number | null;
  mudancas: Mudanca[];
  erros: string[];
  avisos: string[];
}

export interface ResumoEntidade {
  total: number;
  novos: number;
  existentes: number;
  iguais: number;
  erros: number;
}

export interface LoteMigracao {
  fonte: Fonte;
  descricao: string;
  avisos: string[];
  entidades: Partial<Record<Entidade, { itens: ItemConferencia[]; resumo: ResumoEntidade }>>;
}

export interface ItemAplicar {
  origem: string;
  registro: Registro;
  decisao: Decisao;
}

export interface ResultadoAplicar {
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: { origem: string; mensagem: string }[];
}

export const MAX_ITENS_POR_APLICACAO = 200;

// Resultado final de uma importação, por entidade aplicada (montado pela tela de conferência).
export type ResultadosMigracao = Partial<Record<Entidade, ResultadoAplicar>>;

// ---------- Planilha ----------

export type TipoCampo =
  | 'texto' | 'numero' | 'inteiro' | 'booleano' | 'data' | 'unidade' | 'cpfCnpj' | 'ean' | 'ncm' | 'cest'
  | 'cfop' | 'csosn' | 'telefone' | 'uf' | 'cep' | 'email' | 'tipoConta' | 'tipoCliente' | 'parcela' | 'cidadeUf';

export interface CampoDef {
  id: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  max?: number;
  ajuda: string;
  sinonimos: string[];
}

// GET /migracao/campos
export interface RespostaCampos {
  ordem: Entidade[];
  entidades: { id: Entidade; rotulo: string; campos: CampoDef[] }[];
  perfis: { id: string; nome: string; descricao: string }[]; // perfis prontos
}

// GET /migracao/perfis e POST /migracao/perfis
export interface PerfilSalvo {
  id: number;
  nome: string;
  entidade: Entidade;
  mapeamento: Record<string, string>; // chave do cabeçalho -> id do campo
  criadoEm: string;
}

// Coluna mapeada: um item por coluna da planilha; null = ignorar a coluna.
export type Mapeamento = (string | null)[];

// POST /migracao/planilha/ler
export interface LeituraPlanilha {
  cabecalhos: string[];
  chaves: string[]; // chave normalizada de cada cabeçalho (para salvar perfil)
  amostra: string[][]; // até 5 linhas de dados
  totalLinhas: number; // linhas de dados (sem o cabeçalho)
  mapeamento: Mapeamento; // sugestão
}
