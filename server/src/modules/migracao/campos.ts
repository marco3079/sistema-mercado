// Campos da importação por planilha: definições, perfis prontos (Softcom, Bling...), sugestão de colunas,
// conversão das linhas para os registros normalizados e modelo .xlsx para baixar.

import {
  booleano,
  cep,
  cest,
  cfop,
  chaveCabecalho,
  chaveTexto,
  cpfCnpj,
  csosn,
  data,
  ean,
  email,
  ErroConversao,
  inteiro,
  ncm,
  numero,
  telefone,
  texto,
  uf,
  unidade,
} from './normalizar';
import { ROTULOS_ENTIDADE } from './tipos';
import type {
  CampoDef,
  Entidade,
  LeituraLote,
  Mapeamento,
  OpcoesConversao,
  PerfilPronto,
  Registro,
  RegistroLido,
  TipoCampo,
} from './tipos';
import { criarXlsx, type ValorCelula } from '../../lib/planilha';

// Re-exportado para quem importa os perfis daqui (o tipo oficial está em tipos.ts).
export type { PerfilPronto } from './tipos';

// ---------- Helpers de definição ----------

function def(
  id: string,
  rotulo: string,
  tipo: TipoCampo,
  obrigatorio: boolean,
  max: number | undefined,
  ajuda: string,
  sinonimos: string[],
): CampoDef {
  return { id, rotulo, tipo, obrigatorio, max, ajuda, sinonimos };
}

// Listas repetidas em mais de uma entidade.
const TELEFONE_FIXO = ['Telefone', 'Fone', 'Tel', 'Telefone 1', 'Fone 1', 'Telefone fixo', 'Fone comercial', 'Telefone comercial'];
const CELULAR = ['Celular', 'WhatsApp', 'Whats', 'Cel', 'Telefone celular', 'Fone celular', 'Telefone 2', 'Fone 2'];
const EMAIL = ['E-mail', 'Email', 'Correio eletrônico', 'E-mail principal', 'E-mail NF-e'];
const NUMERO_ENDERECO = ['Número', 'Nº', 'N°', 'Num', 'Nro', 'Número do endereço'];

// ---------- Campos por entidade ----------

export const CAMPOS: Record<Entidade, CampoDef[]> = {
  fornecedores: [
    def('codigoAntigo', 'Código no sistema antigo', 'texto', false, 40,
      'Código que o fornecedor tem no sistema antigo. Ajuda a achar o cadastro.',
      ['Código', 'Cód', 'Cod', 'Código do fornecedor', 'Cód. fornecedor', 'Cod fornecedor', 'ID', 'Código interno']),
    def('nome', 'Nome', 'texto', true, 120,
      'Nome do fornecedor usado no sistema. Obrigatório.',
      ['Nome', 'Nome fantasia', 'Fantasia', 'Fornecedor', 'Nome do fornecedor', 'Apelido']),
    def('razaoSocial', 'Razão social', 'texto', false, 120,
      'Nome empresarial, como consta na nota fiscal.',
      ['Razão social', 'Razao', 'Nome/Razão social', 'Nome empresarial']),
    def('cnpj', 'CNPJ/CPF', 'cpfCnpj', false, undefined,
      'CNPJ (14 números) ou CPF (11 números). Pode vir com pontuação.',
      ['CNPJ', 'CPF/CNPJ', 'CNPJ/CPF', 'CNPJ / CPF', 'CPF', 'Documento', 'CGC', 'CGC/CPF', 'CNPJ CPF', 'Doc']),
    def('inscricaoEstadual', 'Inscrição estadual', 'texto', false, 20,
      'Inscrição estadual, se houver.',
      ['Inscrição estadual', 'IE', 'IE/RG', 'Insc. estadual', 'Inscr. estadual', 'Inscrição']),
    def('telefone', 'Telefone', 'telefone', false, undefined,
      'Telefone fixo, com DDD.',
      [...TELEFONE_FIXO]),
    def('whatsapp', 'Celular/WhatsApp', 'telefone', false, undefined,
      'Celular com DDD. Usado para WhatsApp.',
      [...CELULAR]),
    def('email', 'E-mail', 'email', false, undefined,
      'E-mail principal. Se houver mais de um, usa o primeiro.',
      [...EMAIL]),
    def('contato', 'Contato', 'texto', false, 60,
      'Nome da pessoa de contato ou do representante.',
      ['Contato', 'Representante', 'Vendedor', 'Nome do contato', 'Responsável']),
    def('endereco', 'Endereço', 'texto', false, 200,
      'Rua ou logradouro, sem o número.',
      ['Endereço', 'Logradouro', 'Rua', 'Endereço completo', 'End']),
    def('numero', 'Número', 'texto', false, 20,
      'Número do endereço. Vai junto com o endereço.',
      [...NUMERO_ENDERECO]),
    def('complemento', 'Complemento', 'texto', false, 60,
      'Complemento (sala, galpão). Vai junto com o endereço.',
      ['Complemento', 'Compl']),
    def('bairro', 'Bairro', 'texto', false, 60,
      'Bairro. Vai junto com o endereço.',
      ['Bairro']),
    def('cep', 'CEP', 'cep', false, undefined,
      'CEP (8 números). Vai junto com o endereço.',
      ['CEP']),
    def('cidade', 'Cidade', 'texto', false, 60,
      'Nome da cidade.',
      ['Cidade', 'Município', 'Municipio', 'Nome da cidade']),
    def('uf', 'UF', 'uf', false, undefined,
      'Sigla do estado (ex.: PE) ou o nome do estado.',
      ['UF', 'Estado', 'Sigla UF']),
    def('cidadeUf', 'Cidade/UF juntos', 'cidadeUf', false, undefined,
      'Cidade e UF numa coluna só (ex.: Recife/PE). Use no lugar de Cidade e UF.',
      ['Cidade/UF', 'Cidade - UF', 'Município/UF', 'Cidade UF']),
    def('prazoEntregaDias', 'Prazo de entrega (dias)', 'inteiro', false, undefined,
      'Dias para entrega, número inteiro (ex.: 3).',
      ['Prazo de entrega', 'Prazo entrega', 'Dias de entrega', 'Lead time']),
    def('condicaoPagamento', 'Condição de pagamento', 'texto', false, 60,
      'Condição de pagamento combinada (ex.: 30 dias).',
      ['Condição de pagamento', 'Cond. pagamento', 'Condição pagamento', 'Prazo de pagamento', 'Forma de pagamento']),
    def('observacoes', 'Observações', 'texto', false, 500,
      'Observações livres.',
      ['Observações', 'Observação', 'Obs', 'Anotações', 'Notas']),
    def('ativo', 'Ativo', 'booleano', false, undefined,
      'Sim ou Não.',
      ['Ativo', 'Situação', 'Status', 'Ativo/Inativo']),
  ],

  clientes: [
    def('codigoAntigo', 'Código no sistema antigo', 'texto', false, 40,
      'Código do cliente no sistema antigo. Ajuda a achar o cadastro.',
      ['Código', 'Cód', 'Cod', 'Código do cliente', 'Cód. cliente', 'Cod cliente', 'ID', 'Código interno', 'Matrícula']),
    def('nome', 'Nome', 'texto', true, 120,
      'Nome do cliente. Obrigatório.',
      ['Nome', 'Cliente', 'Nome do cliente', 'Nome completo', 'Nome/Razão social', 'Nome fantasia', 'Fantasia', 'Apelido']),
    def('razaoSocial', 'Razão social', 'texto', false, 120,
      'Razão social, se for empresa.',
      ['Razão social', 'Razao', 'Nome empresarial']),
    def('tipo', 'Tipo (Varejo/Atacado)', 'tipoCliente', false, undefined,
      'Varejo ou Atacado.',
      ['Tipo de cliente', 'Tipo cliente', 'Categoria do cliente', 'Classe']),
    def('cpfCnpj', 'CPF/CNPJ', 'cpfCnpj', false, undefined,
      'CPF (11 números) ou CNPJ (14 números). Pode vir com pontuação.',
      ['CPF/CNPJ', 'CNPJ/CPF', 'CNPJ / CPF', 'CPF', 'CNPJ', 'Documento', 'CGC', 'CGC/CPF', 'CPF CNPJ', 'Doc']),
    def('inscricaoEstadual', 'Inscrição estadual', 'texto', false, 20,
      'Inscrição estadual ou RG, se houver.',
      ['Inscrição estadual', 'IE', 'IE/RG', 'RG/IE', 'Insc. estadual', 'Inscr. estadual']),
    def('telefone', 'Telefone', 'telefone', false, undefined,
      'Telefone fixo ou residencial, com DDD.',
      [...TELEFONE_FIXO, 'Telefone residencial', 'Fone residencial']),
    def('whatsapp', 'Celular/WhatsApp', 'telefone', false, undefined,
      'Celular com DDD. Usado para WhatsApp.',
      [...CELULAR]),
    def('email', 'E-mail', 'email', false, undefined,
      'E-mail do cliente. Se houver mais de um, usa o primeiro.',
      [...EMAIL]),
    def('cep', 'CEP', 'cep', false, undefined,
      'CEP (8 números).',
      ['CEP']),
    def('endereco', 'Endereço', 'texto', false, 160,
      'Rua ou logradouro, sem o número.',
      ['Endereço', 'Logradouro', 'Rua', 'Endereço completo', 'End']),
    def('numero', 'Número', 'texto', false, 20,
      'Número do endereço.',
      [...NUMERO_ENDERECO]),
    def('complemento', 'Complemento', 'texto', false, 60,
      'Complemento (apto, bloco). Vai junto com o endereço.',
      ['Complemento', 'Compl']),
    def('bairro', 'Bairro', 'texto', false, 60,
      'Bairro.',
      ['Bairro']),
    def('cidade', 'Cidade', 'texto', false, 60,
      'Nome da cidade.',
      ['Cidade', 'Município', 'Municipio']),
    def('uf', 'UF', 'uf', false, undefined,
      'Sigla do estado (ex.: PE) ou o nome do estado.',
      ['UF', 'Estado', 'Sigla UF']),
    def('cidadeUf', 'Cidade/UF juntos', 'cidadeUf', false, undefined,
      'Cidade e UF numa coluna só (ex.: Recife/PE).',
      ['Cidade/UF', 'Cidade - UF', 'Município/UF', 'Cidade UF']),
    def('limiteCredito', 'Limite de crédito', 'numero', false, undefined,
      'Limite para comprar fiado. Só número.',
      ['Limite de crédito', 'Limite', 'Limite crédito', 'Crédito', 'Limite de compra', 'Limite fiado']),
    def('saldoFiado', 'Saldo devedor (fiado)', 'numero', false, undefined,
      'Quanto o cliente deve hoje. Gera um saldo de fiado na importação.',
      ['Saldo devedor', 'Débito', 'Debito', 'Saldo fiado', 'Fiado', 'Em aberto', 'Valor em aberto', 'Saldo em aberto', 'Total em aberto', 'Conta corrente']),
    def('observacoes', 'Observações', 'texto', false, 500,
      'Observações livres.',
      ['Observações', 'Observação', 'Obs', 'Anotações']),
    def('ativo', 'Ativo', 'booleano', false, undefined,
      'Sim ou Não.',
      ['Ativo', 'Situação', 'Status']),
  ],

  produtos: [
    def('codigo', 'Código', 'texto', false, 60,
      'Código do produto no sistema antigo. É mantido como código interno.',
      ['Código', 'Cód', 'Cod', 'Código do produto', 'Cód. produto', 'Cod produto', 'Código interno', 'Cód. interno', 'Referência', 'Ref', 'SKU', 'Código (SKU)', 'Código SKU', 'Cod item', 'Código item', 'Código reduzido', 'Reduzido']),
    def('ean', 'EAN (código de barras)', 'ean', false, undefined,
      'Código de barras (8, 12, 13 ou 14 números). Deixe vazio se não tiver.',
      ['EAN', 'GTIN', 'GTIN/EAN', 'EAN/GTIN', 'Código de barras', 'Cód. barras', 'Cod barras', 'Cód barra', 'Barras', 'EAN13', 'Código EAN', 'Cod EAN', 'Código GTIN']),
    def('nome', 'Nome (descrição)', 'texto', true, 120,
      'Nome do produto, como aparece no caixa. Obrigatório.',
      ['Nome', 'Descrição', 'Descrição do produto', 'Produto', 'Nome do produto', 'Desc', 'Descr', 'Descrição resumida', 'Descrição PDV']),
    def('descricao', 'Descrição complementar', 'texto', false, 500,
      'Texto mais longo sobre o produto.',
      ['Descrição complementar', 'Descrição curta', 'Descrição detalhada', 'Descrição longa', 'Detalhes', 'Informações adicionais']),
    def('categoria', 'Categoria', 'texto', false, 60,
      'Grupo do produto. Se não existir, é criado.',
      ['Categoria', 'Categoria do produto', 'Grupo', 'Grupo de produtos', 'Grupo do produto', 'Departamento', 'Seção', 'Família', 'Linha']),
    def('marca', 'Marca', 'texto', false, 60,
      'Marca ou fabricante.',
      ['Marca', 'Fabricante']),
    def('unidade', 'Unidade', 'unidade', false, undefined,
      'UN, KG, G, L, ML, CX, PCT ou DZ. Outra unidade vira UN.',
      ['Unidade', 'Un', 'Und', 'Unid', 'Unidade de medida', 'Un. medida', 'Unidade comercial', 'Medida', 'UN venda']),
    def('pesavel', 'Pesável (balança)', 'booleano', false, undefined,
      'Sim se o produto é vendido por peso na balança.',
      ['Pesável', 'Balança', 'Vende por peso', 'Fracionado', 'Pesado', 'Produto pesável']),
    def('codigoBalanca', 'PLU da balança', 'inteiro', false, undefined,
      'Número PLU usado na balança. Só número inteiro.',
      ['PLU', 'Código balança', 'Cód. balança', 'Código da balança', 'Tecla balança']),
    def('precoCusto', 'Preço de custo', 'numero', false, undefined,
      'Custo unitário do produto (ex.: 18,90).',
      ['Preço de custo', 'Custo', 'Custo unitário', 'Vlr custo', 'Valor custo', 'Valor de custo', 'Preço custo', 'Custo médio', 'Preço de compra', 'Valor de compra', 'Pr. custo', 'Custo real', 'Último custo']),
    def('precoVenda', 'Preço de venda', 'numero', false, undefined,
      'Preço de venda à vista (ex.: 24,90).',
      ['Preço de venda', 'Preço', 'Venda', 'Vlr venda', 'Valor venda', 'Valor de venda', 'Preço venda', 'Preço varejo', 'Pr. venda', 'Preço unitário', 'Valor unitário', 'Preço 1', 'Valor']),
    def('precoAtacado', 'Preço de atacado', 'numero', false, undefined,
      'Preço de venda no atacado.',
      ['Preço atacado', 'Preço de atacado', 'Atacado', 'Vlr atacado', 'Preço 2', 'Valor atacado']),
    def('qtdAtacado', 'Qtd. mínima atacado', 'numero', false, undefined,
      'Quantidade mínima para o preço de atacado.',
      ['Qtd atacado', 'Quantidade atacado', 'Qtd. mínima atacado', 'Qtde atacado']),
    def('estoqueMinimo', 'Estoque mínimo', 'numero', false, undefined,
      'Quantidade mínima desejada em estoque.',
      ['Estoque mínimo', 'Est. mínimo', 'Mínimo', 'Estoque min', 'Qtd mínima']),
    def('estoqueMaximo', 'Estoque máximo', 'numero', false, undefined,
      'Quantidade máxima desejada em estoque.',
      ['Estoque máximo', 'Est. máximo', 'Máximo', 'Estoque max']),
    def('estoqueAtual', 'Estoque atual', 'numero', false, undefined,
      'Saldo atual em estoque. Gera o estoque inicial do produto.',
      ['Estoque', 'Estoque atual', 'Saldo', 'Saldo atual', 'Saldo em estoque', 'Quantidade', 'Qtd', 'Qtde', 'Qtd. estoque', 'Quantidade em estoque', 'Estoque físico', 'Estoque disponível', 'Disponível']),
    def('validadeDias', 'Validade (dias)', 'inteiro', false, undefined,
      'Dias de validade, número inteiro.',
      ['Validade (dias)', 'Dias de validade', 'Prazo de validade', 'Validade']),
    def('pesoBrutoKg', 'Peso bruto (kg)', 'numero', false, undefined,
      'Peso bruto em quilos.',
      ['Peso bruto', 'Peso bruto (kg)', 'Peso', 'Peso (kg)']),
    def('ncm', 'NCM', 'ncm', false, undefined,
      'NCM com 8 números, se houver.',
      ['NCM', 'NCM/SH', 'Cód. NCM', 'Código NCM', 'Classificação fiscal']),
    def('cest', 'CEST', 'cest', false, undefined,
      'CEST com 7 números, se houver.',
      ['CEST', 'Cód. CEST', 'Código CEST']),
    def('cfop', 'CFOP', 'cfop', false, undefined,
      'CFOP com 4 números, se houver.',
      ['CFOP', 'CFOP venda', 'CFOP de saída']),
    def('csosn', 'CSOSN', 'csosn', false, undefined,
      'CSOSN com 3 ou 4 números, se houver.',
      ['CSOSN', 'CST/CSOSN', 'CSOSN/CST']),
    def('insumo', 'Insumo (matéria-prima)', 'booleano', false, undefined,
      'Sim se o produto é matéria-prima.',
      ['Insumo', 'Matéria-prima', 'Materia prima']),
    def('produzido', 'Produção própria', 'booleano', false, undefined,
      'Sim se o produto é fabricado na própria loja.',
      ['Produção própria', 'Fabricação própria', 'Produzido']),
    def('ativo', 'Ativo', 'booleano', false, undefined,
      'Sim ou Não.',
      ['Ativo', 'Situação', 'Status', 'Ativo/Inativo']),
    def('fornecedorCnpj', 'CNPJ do fornecedor', 'cpfCnpj', false, undefined,
      'CNPJ do fornecedor deste produto.',
      ['CNPJ do fornecedor', 'CNPJ fornecedor', 'Fornecedor CNPJ']),
    def('codigoFornecedor', 'Código no fornecedor', 'texto', false, 60,
      'Código deste produto no catálogo do fornecedor.',
      ['Código no fornecedor', 'Cód. no fornecedor', 'Código do fornecedor', 'Cód fornecedor', 'Referência do fornecedor', 'Ref. fornecedor']),
  ],

  estoque: [
    def('produto', 'Código ou EAN', 'texto', false, 60,
      'Código interno ou EAN do produto. Use este ou o nome.',
      ['Código', 'Cód', 'Cod', 'Código do produto', 'Cód. produto', 'Referência', 'SKU', 'EAN', 'GTIN', 'Código de barras', 'Cód. barras']),
    def('nomeProduto', 'Nome do produto', 'texto', false, 120,
      'Nome do produto, usado se o código ou o EAN não achar.',
      ['Produto', 'Nome', 'Descrição', 'Nome do produto', 'Descrição do produto']),
    def('quantidade', 'Quantidade', 'numero', true, undefined,
      'Quantidade em estoque hoje. Obrigatório.',
      ['Quantidade', 'Qtd', 'Qtde', 'Estoque', 'Estoque atual', 'Saldo', 'Saldo atual', 'Saldo em estoque', 'Estoque físico', 'Contagem']),
    def('custoUnitario', 'Custo unitário', 'numero', false, undefined,
      'Custo unitário do produto, se houver.',
      ['Custo', 'Custo unitário', 'Preço de custo', 'Custo médio', 'Vlr unitário', 'Valor unitário']),
  ],

  fiado: [
    def('cliente', 'CPF/CNPJ ou código do cliente', 'texto', false, 40,
      'CPF/CNPJ ou código do cliente. Use este ou o nome.',
      ['Código', 'Cód', 'Código do cliente', 'Cód. cliente', 'CPF/CNPJ', 'CNPJ/CPF', 'CPF', 'CNPJ', 'Documento']),
    def('nomeCliente', 'Nome do cliente', 'texto', false, 120,
      'Nome do cliente, usado se o documento ou o código não achar.',
      ['Cliente', 'Nome', 'Nome do cliente', 'Razão social']),
    def('saldo', 'Saldo devedor', 'numero', true, undefined,
      'Quanto o cliente deve. Obrigatório.',
      ['Saldo', 'Saldo devedor', 'Débito', 'Debito', 'Valor', 'Em aberto', 'Valor em aberto', 'Total', 'Total em aberto', 'Fiado']),
    def('descricao', 'Descrição', 'texto', false, 120,
      'Texto livre sobre a dívida.',
      ['Descrição', 'Histórico', 'Obs', 'Observação']),
  ],

  contas: [
    def('tipo', 'Tipo (Pagar/Receber)', 'tipoConta', false, undefined,
      'Pagar ou Receber. Se a planilha não tiver esta coluna, escolha o tipo na tela.',
      ['Tipo', 'Tipo de conta', 'Pagar/Receber', 'Natureza', 'Operação', 'P/R']),
    def('descricao', 'Descrição', 'texto', false, 120,
      'Texto que descreve a conta. Se vazio, o sistema monta um.',
      ['Descrição', 'Histórico', 'Discriminação', 'Referente a']),
    def('valor', 'Valor', 'numero', true, undefined,
      'Valor da conta, maior que zero. Obrigatório.',
      ['Valor', 'Valor original', 'Valor do título', 'Valor da parcela', 'Valor parcela', 'Vlr', 'Valor em aberto', 'Saldo', 'Valor a pagar', 'Valor a receber', 'Valor documento']),
    def('vencimento', 'Vencimento', 'data', true, undefined,
      'Data de vencimento (dd/mm/aaaa). Obrigatório.',
      ['Vencimento', 'Data de vencimento', 'Data vencimento', 'Dt. vencimento', 'Dt vencto', 'Vencto', 'Venc']),
    def('documento', 'Documento', 'texto', false, 40,
      'Número da nota, da duplicata ou do boleto.',
      ['Documento', 'Nº documento', 'Número do documento', 'Num. documento', 'Nota', 'Nota fiscal', 'NF', 'Nº nota', 'Título', 'Nº título', 'Duplicata', 'Boleto']),
    def('parcela', 'Parcela', 'parcela', false, undefined,
      'Parcela no formato 1/3 (parcela 1 de 3) ou só o número da parcela.',
      ['Parcela', 'Nº parcela', 'Parc']),
    def('pessoa', 'CPF/CNPJ ou código', 'texto', false, 40,
      'CPF/CNPJ ou código do fornecedor (a pagar) ou do cliente (a receber).',
      ['CPF/CNPJ', 'CNPJ/CPF', 'CNPJ', 'CPF', 'Documento do fornecedor', 'Documento do cliente', 'Código do fornecedor', 'Código do cliente', 'Cód. fornecedor', 'Cód. cliente']),
    def('nomePessoa', 'Fornecedor ou cliente', 'texto', false, 120,
      'Nome do fornecedor ou do cliente.',
      ['Fornecedor', 'Cliente', 'Nome', 'Razão social', 'Sacado', 'Cedente', 'Favorecido', 'Credor', 'Devedor', 'Pessoa', 'Nome do fornecedor', 'Nome do cliente']),
    def('categoria', 'Categoria', 'texto', false, 60,
      'Categoria financeira. Se não existir, é criada.',
      ['Categoria', 'Plano de contas', 'Conta', 'Classificação', 'Centro de custo']),
    def('observacao', 'Observação', 'texto', false, 300,
      'Observação livre.',
      ['Observação', 'Observações', 'Obs']),
    def('pagoEm', 'Data de pagamento', 'data', false, undefined,
      'Data em que a conta foi paga. Linhas com data não são importadas, pois já estão pagas.',
      ['Data de pagamento', 'Pago em', 'Dt. pagamento', 'Data pagamento', 'Quitação', 'Data da baixa', 'Baixa', 'Pagamento']),
  ],
};

// Campos virtuais: existem na planilha, mas não no registro (são convertidos e compostos).
const VIRTUAIS: Record<Entidade, string[]> = {
  fornecedores: ['numero', 'complemento', 'bairro', 'cep', 'cidadeUf'],
  clientes: ['complemento', 'saldoFiado', 'cidadeUf'],
  produtos: ['estoqueAtual'],
  estoque: [],
  fiado: [],
  contas: ['pagoEm'],
};

// ---------- Perfis prontos ----------

export const PERFIS_PRONTOS: PerfilPronto[] = [
  {
    id: 'automatico',
    nome: 'Automático (qualquer sistema)',
    descricao: 'Reconhece as colunas pelos nomes mais comuns. Confira o mapeamento antes de seguir.',
    sinonimos: {},
  },
  {
    id: 'softcom',
    nome: 'Softcom (SoftcomShop)',
    descricao: 'Usa os nomes de colunas do Softcom. Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['CODIGO', 'COD_PRODUTO', 'CODPRODUTO'],
        ean: ['COD_BARRAS', 'CODBARRAS', 'CODIGO_BARRAS', 'BARRAS'],
        nome: ['DESCRICAO', 'PRODUTO'],
        unidade: ['UNIDADE', 'UND'],
        precoVenda: ['PRECO_VENDA', 'PRECOVENDA', 'VENDA', 'PRECO'],
        precoCusto: ['PRECO_CUSTO', 'PRECOCUSTO', 'CUSTO'],
        estoqueAtual: ['ESTOQUE', 'ESTOQUE_ATUAL', 'SALDO', 'QTD_ESTOQUE'],
        categoria: ['GRUPO', 'SECAO', 'DEPARTAMENTO'],
        marca: ['MARCA', 'FABRICANTE'],
        ncm: ['NCM', 'CLASSIFICACAO_FISCAL'],
        cest: ['CEST'],
        estoqueMinimo: ['ESTOQUE_MINIMO', 'EST_MINIMO'],
      },
      clientes: {
        codigoAntigo: ['CODIGO', 'COD_CLIENTE'],
        nome: ['NOME', 'RAZAO_SOCIAL'],
        cpfCnpj: ['CPF_CNPJ', 'CNPJ_CPF', 'CPF', 'CNPJ'],
        inscricaoEstadual: ['RG_IE', 'IE'],
        telefone: ['FONE', 'TELEFONE'],
        whatsapp: ['CELULAR'],
        limiteCredito: ['LIMITE', 'LIMITE_CREDITO'],
        saldoFiado: ['SALDO', 'DEBITO', 'SALDO_DEVEDOR'],
      },
      fornecedores: {
        codigoAntigo: ['CODIGO', 'COD_FORNECEDOR'],
        nome: ['FANTASIA', 'NOME'],
        razaoSocial: ['RAZAO_SOCIAL', 'RAZAO'],
        cnpj: ['CNPJ', 'CPF_CNPJ'],
      },
    },
  },
  {
    id: 'bling',
    nome: 'Bling',
    descricao: 'Usa os nomes de colunas do Bling. Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['Código'],
        nome: ['Descrição'],
        unidade: ['Unidade'],
        precoVenda: ['Preço'],
        precoCusto: ['Preço de custo'],
        estoqueAtual: ['Estoque'],
        ean: ['GTIN/EAN'],
        codigoFornecedor: ['Cód no fornecedor'],
        marca: ['Marca'],
        categoria: ['Categoria do produto'],
        ativo: ['Situação'],
        estoqueMinimo: ['Estoque minimo'],
        estoqueMaximo: ['Estoque maximo'],
        pesoBrutoKg: ['Peso bruto (Kg)'],
        descricao: ['Descrição complementar'],
      },
      clientes: {
        codigoAntigo: ['Código'],
        nome: ['Nome'],
        cpfCnpj: ['CNPJ / CPF'],
        inscricaoEstadual: ['IE / RG'],
        telefone: ['Fone'],
        whatsapp: ['Celular'],
        email: ['E-mail'],
        ativo: ['Situação'],
        limiteCredito: ['Limite de crédito'],
      },
      fornecedores: {
        codigoAntigo: ['Código'],
        nome: ['Fantasia', 'Nome'],
        cnpj: ['CNPJ / CPF'],
        inscricaoEstadual: ['IE / RG'],
        telefone: ['Fone'],
        whatsapp: ['Celular'],
        email: ['E-mail'],
        ativo: ['Situação'],
      },
    },
  },
  {
    id: 'tiny',
    nome: 'Tiny / Olist ERP',
    descricao: 'Usa os nomes de colunas do Tiny (Olist ERP). Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['Código (SKU)', 'Código'],
        nome: ['Descrição', 'Nome'],
        precoVenda: ['Preço'],
        precoCusto: ['Preço de custo'],
        ean: ['GTIN/EAN', 'GTIN'],
        estoqueAtual: ['Estoque'],
        unidade: ['Unidade'],
        ncm: ['NCM'],
        ativo: ['Situação'],
      },
    },
  },
  {
    id: 'gdoor',
    nome: 'GDOOR',
    descricao: 'Usa os nomes de colunas do GDOOR. Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['Código'],
        ean: ['Código de barras', 'Barras'],
        nome: ['Descrição'],
        precoVenda: ['Preço venda', 'Venda'],
        precoCusto: ['Custo'],
        estoqueAtual: ['Estoque'],
        categoria: ['Grupo'],
      },
    },
  },
  {
    id: 'hiper',
    nome: 'Hiper',
    descricao: 'Usa os nomes de colunas do Hiper. Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['Código'],
        ean: ['Código de barras'],
        nome: ['Nome'],
        precoVenda: ['Preço de venda'],
        precoCusto: ['Preço de custo'],
        estoqueAtual: ['Estoque'],
        categoria: ['Categoria'],
        marca: ['Marca'],
      },
    },
  },
  {
    id: 'marketup',
    nome: 'MarketUP',
    descricao: 'Usa os nomes de colunas do MarketUP. Confira o mapeamento antes de seguir.',
    sinonimos: {
      produtos: {
        codigo: ['Código', 'Código interno'],
        ean: ['Código de barras', 'EAN'],
        nome: ['Nome', 'Produto'],
        precoVenda: ['Preço de venda', 'Preço'],
        precoCusto: ['Preço de custo', 'Custo'],
        estoqueAtual: ['Estoque', 'Quantidade'],
      },
    },
  },
];

// ---------- Sugestão de mapeamento ----------

export function sugerirMapeamento(
  entidade: Entidade,
  cabecalhos: string[],
  perfil?: { pronto?: PerfilPronto; salvo?: Record<string, string> },
): Mapeamento {
  const campos = CAMPOS[entidade];
  const ids = new Set(campos.map((c) => c.id));
  const usados = new Set<string>();
  const salvo = perfil?.salvo ?? {};

  // Pares [chave do cabeçalho, id do campo], na ordem de prioridade de cada passo.
  const paresPronto: [string, string][] = [];
  for (const [campoId, lista] of Object.entries(perfil?.pronto?.sinonimos?.[entidade] ?? {})) {
    for (const s of lista) paresPronto.push([chaveCabecalho(s), campoId]);
  }
  const paresGerais: [string, string][] = [];
  for (const campo of campos) {
    // O rótulo do campo é o primeiro sinônimo geral (faz o cabeçalho do modelo baixado mapear sozinho).
    paresGerais.push([chaveCabecalho(campo.rotulo), campo.id]);
    for (const s of campo.sinonimos) paresGerais.push([chaveCabecalho(s), campo.id]);
  }

  const livre = (id: string | undefined): id is string => id !== undefined && ids.has(id) && !usados.has(id);

  const escolher = (k: string): string | null => {
    // 1. Mapeamento salvo pelo usuário para esta chave.
    const salvoId = salvo[k];
    if (livre(salvoId)) return salvoId;
    // 2. Sinônimos do perfil pronto.
    for (const [ch, id] of paresPronto) if (ch === k && livre(id)) return id;
    // 3. Sinônimos gerais (o primeiro campo da tabela que casar).
    for (const [ch, id] of paresGerais) if (ch === k && livre(id)) return id;
    // 4. Casamento parcial: sinônimo com 5+ caracteres que é prefixo da chave; vence o mais longo.
    let melhor: string | null = null;
    let tamanho = 0;
    for (const [ch, id] of paresGerais) {
      if (livre(id) && ch.length >= 5 && k.startsWith(ch) && ch.length > tamanho) {
        melhor = id;
        tamanho = ch.length;
      }
    }
    return melhor;
  };

  return cabecalhos.map((cabecalho) => {
    const k = chaveCabecalho(cabecalho ?? '');
    if (!k) return null;
    const id = escolher(k);
    if (id) usados.add(id);
    return id;
  });
}

// ---------- Conversão das linhas ----------

function preenchido(valor: string | undefined): valor is string {
  return valor !== undefined && valor.trim() !== '' && valor.trim() !== '-';
}

function mapaColunas(entidade: Entidade, mapeamento: Mapeamento): Map<string, number> {
  const ids = new Set(CAMPOS[entidade].map((c) => c.id));
  const mapa = new Map<string, number>();
  mapeamento.forEach((id, indice) => {
    if (id && ids.has(id) && !mapa.has(id)) mapa.set(id, indice);
  });
  return mapa;
}

function converterTipoCliente(entrada: string | undefined): 'VAREJO' | 'ATACADO' | undefined {
  if (!preenchido(entrada)) return undefined;
  const k = chaveTexto(entrada);
  if (k.startsWith('atac')) return 'ATACADO';
  if (k.startsWith('var') || k.startsWith('cons') || k.startsWith('normal') || k === 'pf' || k === 'pj') return 'VAREJO';
  throw new ErroConversao('use Varejo ou Atacado');
}

const TIPO_PAGAR = ['pagar', 'p', 'despesa', 'debito', 'saida', 'd', 'cp', 'fornecedor'];
const TIPO_RECEBER = ['receber', 'r', 'receita', 'credito', 'entrada', 'c', 'cr', 'cliente'];

function converterTipoConta(entrada: string | undefined): 'PAGAR' | 'RECEBER' | undefined {
  if (!preenchido(entrada)) return undefined;
  const k = chaveTexto(entrada);
  if (TIPO_PAGAR.includes(k)) return 'PAGAR';
  if (TIPO_RECEBER.includes(k)) return 'RECEBER';
  throw new ErroConversao('use Pagar ou Receber');
}

interface Parcela {
  parcela: number;
  totalParcelas?: number;
}

function converterParcela(entrada: string | undefined): Parcela | undefined {
  if (!preenchido(entrada)) return undefined;
  const s = entrada.trim();
  const composto = /^(\d+)\s*(?:\/|de)\s*(\d+)$/i.exec(s);
  if (composto) {
    const parcela = parseInt(composto[1], 10);
    const totalParcelas = parseInt(composto[2], 10);
    if (parcela < 1 || totalParcelas < 1 || parcela > totalParcelas) throw new ErroConversao(`parcela inválida: "${s}"`);
    return { parcela, totalParcelas };
  }
  if (/^\d+$/.test(s)) {
    const parcela = parseInt(s, 10);
    if (parcela < 1) throw new ErroConversao(`parcela inválida: "${s}"`);
    return { parcela };
  }
  throw new ErroConversao(`parcela inválida: "${s}"`);
}

interface CidadeUf {
  cidade?: string;
  uf?: string;
}

// "Recife/PE", "Recife - PE", "Recife-PE", "Recife PE" -> cidade + uf. Só cidade -> só cidade.
function converterCidadeUf(entrada: string | undefined): CidadeUf | undefined {
  if (!preenchido(entrada)) return undefined;
  const s = entrada.trim();
  const m = /^(.+?)\s*(?:\/|-|\s)\s*([A-Za-z]{2})$/.exec(s);
  if (!m) return { cidade: texto(s, 60) };
  return { cidade: texto(m[1], 60), uf: uf(m[2]) };
}

function converterCampo(campo: CampoDef, entrada: string | undefined, entidade: Entidade, avisos: string[]): unknown {
  switch (campo.tipo) {
    case 'texto':
      return texto(entrada, campo.max ?? 500);
    case 'numero': {
      const aceitaNegativo =
        (entidade === 'estoque' && campo.id === 'quantidade') || (entidade === 'produtos' && campo.id === 'estoqueAtual');
      return numero(entrada, aceitaNegativo ? undefined : { min: 0 });
    }
    case 'inteiro':
      return inteiro(entrada, { min: 0 });
    case 'booleano':
      return booleano(entrada);
    case 'data':
      return data(entrada);
    case 'unidade': {
      const r = unidade(entrada);
      if (r && !r.reconhecida) avisos.push(`Unidade "${entrada ?? ''}" não reconhecida; usada UN`);
      return r?.valor;
    }
    case 'cpfCnpj':
      return cpfCnpj(entrada);
    case 'ean':
      return ean(entrada);
    case 'ncm':
      return ncm(entrada);
    case 'cest':
      return cest(entrada);
    case 'cfop':
      return cfop(entrada);
    case 'csosn':
      return csosn(entrada);
    case 'telefone':
      return telefone(entrada);
    case 'uf':
      return uf(entrada);
    case 'cep':
      return cep(entrada);
    case 'email':
      return email(entrada);
    case 'tipoCliente':
      return converterTipoCliente(entrada);
    case 'tipoConta':
      return converterTipoConta(entrada);
    case 'parcela':
      return converterParcela(entrada);
    case 'cidadeUf':
      return converterCidadeUf(entrada);
  }
}

// Preenche cidade/uf a partir de "Cidade/UF juntos", só onde a coluna própria não veio.
function aplicarCidadeUf(reg: Record<string, unknown>, cu: CidadeUf | undefined): void {
  if (!cu) return;
  if (reg.cidade === undefined && cu.cidade !== undefined) reg.cidade = cu.cidade;
  if (reg.uf === undefined && cu.uf !== undefined) reg.uf = cu.uf;
}

export function converterPlanilha(
  entidade: Entidade,
  linhas: string[][],
  mapeamento: Mapeamento,
  opcoes: OpcoesConversao = {},
): LeituraLote['registros'] {
  const campos = CAMPOS[entidade];
  const colunaDe = mapaColunas(entidade, mapeamento);
  const primeiraLinha = opcoes.primeiraLinha ?? 2;
  const saida: Partial<Record<Entidade, RegistroLido[]>> = {};
  const adicionar = (e: Entidade, item: RegistroLido): void => {
    (saida[e] ??= []).push(item);
  };

  linhas.forEach((linha, indice) => {
    if (linha.every((celula) => (celula ?? '').trim() === '')) return;
    const origem = `Linha ${primeiraLinha + indice}`;
    const lerCampo = (id: string): string | undefined => {
      const i = colunaDe.get(id);
      return i === undefined ? undefined : (linha[i] ?? '').trim();
    };

    // Conta já paga: não entra na importação.
    if (entidade === 'contas' && preenchido(lerCampo('pagoEm'))) return;

    const erros: string[] = [];
    const avisos: string[] = [];
    const vals: Record<string, unknown> = {};
    for (const campo of campos) {
      let valor: unknown;
      try {
        valor = converterCampo(campo, lerCampo(campo.id), entidade, avisos);
      } catch (e) {
        if (e instanceof ErroConversao) {
          erros.push(`${campo.rotulo}: ${e.message}`);
          continue;
        }
        throw e;
      }
      if (valor === undefined) {
        if (campo.obrigatorio) erros.push(`${campo.rotulo} é obrigatório`);
        continue;
      }
      vals[campo.id] = valor;
    }

    // Registro: sem os campos virtuais.
    const reg: Record<string, unknown> = {};
    for (const campo of campos) {
      if (VIRTUAIS[entidade].includes(campo.id)) continue;
      const valor = vals[campo.id];
      if (valor === undefined) continue;
      if (campo.tipo === 'parcela') {
        const p = valor as Parcela;
        reg.parcela = p.parcela;
        if (p.totalParcelas !== undefined) reg.totalParcelas = p.totalParcelas;
      } else {
        reg[campo.id] = valor;
      }
    }

    // Registros extras gerados por esta linha (só se a linha não tiver erro).
    const extras: [Entidade, Record<string, unknown>][] = [];
    const cidadeUfVals = vals.cidadeUf as CidadeUf | undefined;

    switch (entidade) {
      case 'fornecedores': {
        const partes: (string | undefined)[] = [
          vals.endereco as string | undefined,
          vals.numero as string | undefined,
          vals.complemento as string | undefined,
          vals.bairro as string | undefined,
          vals.cep !== undefined ? `CEP ${vals.cep}` : undefined,
        ];
        const endereco = texto(partes.filter((p) => p !== undefined).join(', '), 200);
        if (endereco !== undefined) reg.endereco = endereco;
        aplicarCidadeUf(reg, cidadeUfVals);
        break;
      }
      case 'clientes': {
        const endereco = texto(
          [vals.endereco as string | undefined, vals.complemento as string | undefined]
            .filter((p) => p !== undefined)
            .join(' - '),
          160,
        );
        if (endereco !== undefined) reg.endereco = endereco;
        aplicarCidadeUf(reg, cidadeUfVals);
        const saldo = vals.saldoFiado as number | undefined;
        if (saldo !== undefined && saldo > 0) {
          extras.push([
            'fiado',
            {
              cliente: (vals.cpfCnpj as string | undefined) ?? (vals.codigoAntigo as string | undefined),
              nomeCliente: vals.nome,
              saldo,
              descricao: 'Saldo migrado do sistema anterior',
            },
          ]);
        }
        break;
      }
      case 'produtos': {
        const estoqueAtual = vals.estoqueAtual as number | undefined;
        if (estoqueAtual !== undefined) {
          extras.push([
            'estoque',
            {
              produto: (vals.codigo as string | undefined) ?? (vals.ean as string | undefined),
              nomeProduto: vals.nome,
              quantidade: estoqueAtual,
              custoUnitario: vals.precoCusto,
            },
          ]);
        }
        break;
      }
      case 'estoque':
        if (vals.produto === undefined && vals.nomeProduto === undefined) {
          erros.push('Informe o código, o EAN ou o nome do produto');
        }
        break;
      case 'fiado':
        if (vals.cliente === undefined && vals.nomeCliente === undefined) {
          erros.push('Informe o CPF/CNPJ, o código ou o nome do cliente');
        }
        break;
      case 'contas': {
        const tipo = (reg.tipo as 'PAGAR' | 'RECEBER' | undefined) ?? opcoes.tipoContaPadrao;
        if (tipo === undefined) {
          erros.push('Informe se a conta é a pagar ou a receber');
        } else {
          reg.tipo = tipo;
        }
        if (vals.valor !== undefined && (vals.valor as number) <= 0) {
          erros.push('O valor deve ser maior que zero');
        }
        if (vals.descricao === undefined) {
          let descricao = tipo === 'RECEBER' ? 'Conta a receber' : 'Conta a pagar';
          if (vals.documento !== undefined) descricao += ` - doc ${vals.documento}`;
          if (vals.nomePessoa !== undefined) descricao += ` - ${vals.nomePessoa}`;
          reg.descricao = descricao;
        }
        break;
      }
    }

    adicionar(entidade, {
      origem,
      registro: reg as unknown as Registro,
      erros,
      avisos,
    });

    if (erros.length === 0) {
      for (const [e, r] of extras) {
        adicionar(e, { origem, registro: r as unknown as Registro, erros: [], avisos: [] });
      }
    }
  });

  return saida as LeituraLote['registros'];
}

// Quantas linhas da planilha de contas já vêm com data de pagamento (não entram).
export function contarContasPagas(linhas: string[][], mapeamento: Mapeamento): number {
  const indice = mapeamento.indexOf('pagoEm');
  if (indice < 0) return 0;
  return linhas.filter((linha) => preenchido(linha[indice]?.trim())).length;
}

// ---------- Modelo para baixar ----------

// Uma linha de exemplo coerente por entidade (valores como o usuário digitaria na planilha).
const EXEMPLOS: Record<Entidade, Record<string, ValorCelula>> = {
  fornecedores: {
    codigoAntigo: 'F001',
    nome: 'Distribuidora Exemplo',
    razaoSocial: 'Distribuidora Exemplo LTDA',
    cnpj: '11.222.333/0001-81',
    inscricaoEstadual: '123456789',
    telefone: '(81) 3333-4444',
    whatsapp: '(81) 99999-8888',
    email: 'vendas@exemplo.com.br',
    contato: 'Maria',
    endereco: 'Rua das Flores',
    numero: '100',
    complemento: 'Sala 2',
    bairro: 'Centro',
    cep: '50000-000',
    cidade: 'Recife',
    uf: 'PE',
    prazoEntregaDias: '3',
    condicaoPagamento: '30 dias',
    observacoes: '',
    ativo: 'Sim',
  },
  clientes: {
    codigoAntigo: '1001',
    nome: 'Maria Silva',
    razaoSocial: '',
    tipo: 'Varejo',
    cpfCnpj: '529.982.247-25',
    inscricaoEstadual: '',
    telefone: '(81) 3222-1100',
    whatsapp: '(81) 99999-1234',
    email: 'maria@exemplo.com.br',
    cep: '50000-000',
    endereco: 'Rua das Flores',
    numero: '100',
    complemento: 'Apto 2',
    bairro: 'Centro',
    cidade: 'Recife',
    uf: 'PE',
    limiteCredito: '300,00',
    saldoFiado: '0',
    observacoes: '',
    ativo: 'Sim',
  },
  produtos: {
    codigo: '000123',
    ean: '7891000315507',
    nome: 'Arroz tipo 1 5 kg',
    descricao: 'Arroz branco tipo 1, pacote de 5 kg',
    categoria: 'Mercearia',
    marca: 'Tio João',
    unidade: 'PCT',
    pesavel: 'Não',
    codigoBalanca: '',
    precoCusto: '18,90',
    precoVenda: '24,90',
    precoAtacado: '23,90',
    qtdAtacado: '6',
    estoqueMinimo: '10',
    estoqueMaximo: '100',
    estoqueAtual: '40',
    validadeDias: '',
    pesoBrutoKg: '5',
    ncm: '10063021',
    cest: '',
    cfop: '',
    csosn: '',
    insumo: 'Não',
    produzido: 'Não',
    ativo: 'Sim',
    fornecedorCnpj: '11.222.333/0001-81',
    codigoFornecedor: 'AR5',
  },
  estoque: {
    produto: '000123',
    nomeProduto: 'Arroz tipo 1 5 kg',
    quantidade: '40',
    custoUnitario: '18,90',
  },
  fiado: {
    cliente: '529.982.247-25',
    nomeCliente: 'Maria Silva',
    saldo: '150,00',
    descricao: 'Compras de março',
  },
  contas: {
    tipo: 'Pagar',
    descricao: 'Conta de energia',
    valor: '320,00',
    vencimento: '10/12/2026',
    documento: '4521',
    parcela: '1/3',
    pessoa: '11.222.333/0001-81',
    nomePessoa: 'Distribuidora Exemplo',
    categoria: 'Energia',
    observacao: '',
    pagoEm: '',
  },
};

function larguraDoCampo(campo: CampoDef): number {
  return campo.tipo === 'texto' && (campo.max ?? 0) >= 60 ? 30 : 14;
}

export function modeloXlsx(entidade: Entidade): Buffer {
  const campos = CAMPOS[entidade];
  const exemplo = EXEMPLOS[entidade];
  const cabecalho: ValorCelula[] = campos.map((c) => c.rotulo);
  const linhaExemplo: ValorCelula[] = campos.map((c) => exemplo[c.id] ?? null);
  const instrucoes: ValorCelula[][] = [
    ['Coluna', 'Obrigatória', 'Como preencher'],
    ...campos.map((c): ValorCelula[] => [c.rotulo, c.obrigatorio ? 'Sim' : 'Não', c.ajuda]),
  ];
  return criarXlsx([
    { nome: ROTULOS_ENTIDADE[entidade], linhas: [cabecalho, linhaExemplo], larguras: campos.map(larguraDoCampo), cabecalho: true },
    { nome: 'Instruções', linhas: instrucoes, larguras: [30, 14, 90], cabecalho: true },
  ]);
}
