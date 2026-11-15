// Contrato da migração de dados (importar de outros sistemas: Softcom, Bling, Tiny, SPED, NF-e...).
// Este arquivo é a referência única dos formatos trocados entre leitores, conferência, aplicação e rotas.
// Não mude sem combinar com o @main.

import type { Unidade } from '@prisma/client';

// ---------- Entidades ----------

export type Entidade = 'fornecedores' | 'clientes' | 'produtos' | 'estoque' | 'fiado' | 'contas';

// Ordem em que as entidades são aplicadas (quem é referenciado vem antes).
export const ORDEM_ENTIDADES: Entidade[] = ['fornecedores', 'clientes', 'produtos', 'estoque', 'fiado', 'contas'];

export const ROTULOS_ENTIDADE: Record<Entidade, string> = {
  fornecedores: 'Fornecedores',
  clientes: 'Clientes',
  produtos: 'Produtos',
  estoque: 'Estoque inicial',
  fiado: 'Saldo de fiado',
  contas: 'Contas a pagar e a receber',
};

export function ehEntidade(valor: unknown): valor is Entidade {
  return typeof valor === 'string' && (ORDEM_ENTIDADES as string[]).includes(valor);
}

// ---------- Registros normalizados ----------
// Campo ausente (undefined) = o arquivo não traz a informação: na atualização, o valor do banco é mantido.
// Textos já vêm aparados; documentos (CPF/CNPJ, EAN, NCM, CEP, telefone) só com dígitos (CNPJ alfanumérico em maiúsculas).

export interface RegProduto {
  codigo?: string; // código no sistema antigo (é mantido como código interno); vazio = gera o próximo
  ean?: string;
  nome: string;
  descricao?: string;
  categoria?: string; // nome da categoria (criada se não existir)
  marca?: string;
  unidade?: Unidade;
  pesavel?: boolean;
  codigoBalanca?: number;
  precoCusto?: number;
  precoVenda?: number;
  precoAtacado?: number;
  qtdAtacado?: number;
  estoqueMinimo?: number;
  estoqueMaximo?: number;
  validadeDias?: number;
  pesoBrutoKg?: number;
  ncm?: string;
  cest?: string;
  cfop?: string;
  csosn?: string;
  insumo?: boolean;
  produzido?: boolean;
  ativo?: boolean;
  fornecedorCnpj?: string; // vínculo com o fornecedor (NF-e de compra)
  codigoFornecedor?: string; // código do produto no fornecedor (cProd da NF-e)
}

export interface RegCliente {
  codigoAntigo?: string;
  nome: string;
  tipo?: 'VAREJO' | 'ATACADO';
  cpfCnpj?: string;
  razaoSocial?: string;
  inscricaoEstadual?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  cep?: string;
  endereco?: string; // logradouro (+ complemento, quando vier)
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  limiteCredito?: number;
  observacoes?: string;
  ativo?: boolean;
}

export interface RegFornecedor {
  codigoAntigo?: string;
  nome: string;
  razaoSocial?: string;
  cnpj?: string; // CNPJ (14) ou CPF (11) do fornecedor
  inscricaoEstadual?: string;
  telefone?: string;
  whatsapp?: string;
  email?: string;
  contato?: string;
  endereco?: string; // endereço completo numa linha (rua, número, complemento, bairro, CEP)
  cidade?: string;
  uf?: string;
  prazoEntregaDias?: number;
  condicaoPagamento?: string;
  observacoes?: string;
  ativo?: boolean;
}

// Saldo do produto na loja escolhida (a loja da requisição). A importação deixa o saldo IGUAL a `quantidade`.
export interface RegEstoque {
  produto?: string; // código interno ou EAN
  nomeProduto?: string; // usado só se `produto` não achar (nome exato, sem diferenciar maiúsculas/acentos)
  quantidade: number;
  custoUnitario?: number;
}

// Saldo devedor de fiado do cliente. A importação deixa o saldo IGUAL a `saldo` (só para cima).
export interface RegFiado {
  cliente?: string; // CPF/CNPJ ou código antigo
  nomeCliente?: string; // usado só se `cliente` não achar
  saldo: number;
  descricao?: string;
}

// Conta em aberto (título a pagar ou a receber).
export interface RegConta {
  tipo: 'PAGAR' | 'RECEBER';
  descricao: string; // o leitor sempre preenche (monta um texto padrão se o arquivo não trouxer)
  valor: number; // > 0
  vencimento: string; // AAAA-MM-DD
  documento?: string; // nº da nota, duplicata, boleto
  parcela?: number;
  totalParcelas?: number;
  pessoa?: string; // CPF/CNPJ ou código antigo do fornecedor (PAGAR) ou do cliente (RECEBER)
  nomePessoa?: string; // usado só se `pessoa` não achar
  categoria?: string; // categoria financeira (criada se não existir)
  observacao?: string;
}

export interface RegistroPorEntidade {
  fornecedores: RegFornecedor;
  clientes: RegCliente;
  produtos: RegProduto;
  estoque: RegEstoque;
  fiado: RegFiado;
  contas: RegConta;
}
export type Registro = RegistroPorEntidade[Entidade];

// ---------- Leitura (saída dos leitores: planilha, SPED, Sintegra, NF-e) ----------

export interface RegistroLido<E extends Entidade = Entidade> {
  origem: string; // onde está no arquivo, para o usuário achar: "Linha 12", "0200 linha 345", "nota.xml (NF 123)"
  registro: RegistroPorEntidade[E];
  erros: string[]; // problemas de leitura/conversão (o item não será importado)
  avisos: string[]; // observações que não impedem a importação
}

export type Fonte = 'planilha' | 'sped' | 'sintegra' | 'nfe';

export interface LeituraLote {
  fonte: Fonte;
  descricao: string; // ex.: "SPED Fiscal de Mercado X (CNPJ 12.345.678/0001-90), 01/10/2026 a 31/10/2026"
  avisos: string[]; // avisos gerais do arquivo (ex.: "12 itens de uso e consumo foram deixados de fora")
  registros: { [E in Entidade]?: RegistroLido<E>[] };
}

// ---------- Conferência (comparação com o banco) ----------

// novo = será criado; existe = já existe e tem diferenças (o usuário escolhe atualizar ou ignorar);
// igual = já existe sem diferenças (nada a fazer); erro = não pode ser importado.
export type Situacao = 'novo' | 'existe' | 'igual' | 'erro';

export type ValorSimples = string | number | boolean | null;

export interface Mudanca {
  campo: string; // id do campo (ex.: 'precoVenda')
  rotulo: string; // ex.: 'Preço de venda'
  de: ValorSimples;
  para: ValorSimples;
}

export interface ItemConferencia<E extends Entidade = Entidade> {
  indice: number; // posição na lista da entidade (0, 1, 2...)
  origem: string;
  resumo: string; // texto curto para a tabela: "000123 · Arroz 5 kg", "Maria Silva · 123.456.789-09"
  registro: RegistroPorEntidade[E];
  situacao: Situacao;
  existenteId: number | null; // id no banco quando situacao = existe | igual
  mudancas: Mudanca[]; // só em 'existe'
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
  entidades: { [E in Entidade]?: { itens: ItemConferencia<E>[]; resumo: ResumoEntidade } };
}

// ---------- Aplicação ----------

export type Decisao = 'atualizar' | 'ignorar';

export interface ItemAplicar<E extends Entidade = Entidade> {
  origem: string;
  registro: RegistroPorEntidade[E];
  decisao: Decisao; // vale para itens que já existem; itens novos são sempre criados
}

export interface ResultadoAplicar {
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: { origem: string; mensagem: string }[];
}

export const MAX_ITENS_POR_APLICACAO = 200;

// ---------- Planilha: campos, perfis e mapeamento ----------

export type TipoCampo =
  | 'texto'
  | 'numero'
  | 'inteiro'
  | 'booleano'
  | 'data'
  | 'unidade'
  | 'cpfCnpj'
  | 'ean'
  | 'ncm'
  | 'cest'
  | 'cfop'
  | 'csosn'
  | 'telefone'
  | 'uf'
  | 'cep'
  | 'email'
  | 'tipoConta'
  | 'tipoCliente'
  | 'parcela'
  | 'cidadeUf';

export interface CampoDef {
  id: string; // ex.: 'precoVenda' (campo do registro) ou virtual: 'estoqueAtual', 'saldoFiado', 'complemento', 'cidadeUf'...
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio: boolean;
  max?: number; // tamanho máximo (texto)
  ajuda: string;
  sinonimos: string[]; // cabeçalhos reconhecidos (comparados por chaveCabecalho)
}

export interface PerfilPronto {
  id: string; // 'automatico' | 'softcom' | 'bling' | 'tiny' | 'gdoor' | 'hiper' | 'marketup'
  nome: string;
  descricao: string;
  // Cabeçalhos típicos do sistema, por entidade e campo (têm prioridade sobre os sinônimos gerais).
  sinonimos: { [E in Entidade]?: Record<string, string[]> };
}

// Mapeamento de uma planilha: um item por coluna, na ordem das colunas; null = coluna ignorada.
export type Mapeamento = (string | null)[];

export interface OpcoesConversao {
  tipoContaPadrao?: 'PAGAR' | 'RECEBER'; // contas: quando a planilha não tem a coluna Tipo
  primeiraLinha?: number; // número (do Excel) da primeira linha de dados; padrão 2
}
