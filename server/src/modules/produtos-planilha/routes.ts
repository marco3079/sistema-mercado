import express, { Router } from 'express';
import { Prisma, type Unidade } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { lojaDaRequisicao } from '../../lib/lojas';
import { arred2, arred3, arred4, num, numOuNull } from '../../lib/numeros';
import { eanValido } from '../../lib/precos';
import { registrarLog } from '../../lib/log';
import { criarXlsx, lerPlanilha, TIPO_XLSX, type AbaPlanilha, type ValorCelula } from '../../lib/planilha';
import { alterarPreco } from '../produtos/precos';

// Exportar, baixar modelo e importar produtos por planilha (.xlsx ou .csv).
// A importação segue as mesmas regras do cadastro: preço de venda só muda por alterarPreco.

const router = Router();

const LEITORES = ['GESTOR', 'COMPRADOR', 'ESTOQUISTA', 'CONTADOR'] as const;
const IMPORTADORES = ['GESTOR', 'COMPRADOR', 'ESTOQUISTA'] as const;
const UNIDADES: readonly Unidade[] = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'DZ'];
const SIM = new Set(['sim', 's', 'x', '1', 'true', 'verdadeiro']);
const NAO = new Set(['nao', 'n', '0', 'false', 'falso']);
const MAX_LINHAS = 5000;
const MAX_RESPOSTA_LINHAS = 1000;
const COLUNA_ESTOQUE_LOJA = 'Estoque na loja';

type CampoImportacao =
  | 'codigo'
  | 'ean'
  | 'nome'
  | 'categoria'
  | 'marca'
  | 'unidade'
  | 'pesavel'
  | 'codigoBalanca'
  | 'precoCusto'
  | 'precoVenda'
  | 'precoAtacado'
  | 'qtdAtacado'
  | 'estoqueMinimo'
  | 'estoqueMaximo'
  | 'validadeDias'
  | 'ncm'
  | 'cest'
  | 'cfop'
  | 'csosn'
  | 'produzido'
  | 'insumo'
  | 'controlaLote'
  | 'ativo'
  | 'descricao';

interface Coluna {
  cabecalho: string;
  campo: CampoImportacao;
  largura: number;
  obrigatoria: boolean;
  ajuda: string;
}

// Ordem e cabeçalhos da planilha (colunas 1 a 24). "Estoque na loja" é só da exportação.
const COLUNAS: Coluna[] = [
  { cabecalho: 'Código', campo: 'codigo', largura: 12, obrigatoria: false, ajuda: 'Até 30 caracteres. Código existente atualiza o produto; vazio gera o próximo código (6 dígitos).' },
  { cabecalho: 'EAN', campo: 'ean', largura: 16, obrigatoria: false, ajuda: 'Só números, EAN válido (8, 12, 13 ou 14 dígitos). Vazio = sem EAN.' },
  { cabecalho: 'Nome', campo: 'nome', largura: 40, obrigatoria: true, ajuda: 'Nome do produto, de 1 a 120 caracteres.' },
  { cabecalho: 'Categoria', campo: 'categoria', largura: 20, obrigatoria: false, ajuda: 'Nome da categoria, sem diferenciar maiúsculas e acentos. Se não existir, é criada.' },
  { cabecalho: 'Marca', campo: 'marca', largura: 16, obrigatoria: false, ajuda: 'Até 60 caracteres.' },
  { cabecalho: 'Unidade', campo: 'unidade', largura: 12, obrigatoria: false, ajuda: 'UN, KG, G, L, ML, CX, PCT ou DZ. Vazio = UN.' },
  { cabecalho: 'Pesável', campo: 'pesavel', largura: 12, obrigatoria: false, ajuda: 'Sim ou Não. Produto vendido no peso (balança).' },
  { cabecalho: 'PLU balança', campo: 'codigoBalanca', largura: 14, obrigatoria: false, ajuda: 'Inteiro de 1 a 99999. Vazio em produto pesável = o sistema escolhe o próximo PLU livre.' },
  { cabecalho: 'Preço de custo', campo: 'precoCusto', largura: 14, obrigatoria: false, ajuda: 'Número igual ou maior que zero.' },
  { cabecalho: 'Preço de venda', campo: 'precoVenda', largura: 14, obrigatoria: false, ajuda: 'Número igual ou maior que zero. Mudança gera histórico de preço e etiqueta pendente.' },
  { cabecalho: 'Preço atacado', campo: 'precoAtacado', largura: 15, obrigatoria: false, ajuda: 'Número igual ou maior que zero.' },
  { cabecalho: 'Qtd. atacado', campo: 'qtdAtacado', largura: 14, obrigatoria: false, ajuda: 'Quantidade a partir da qual vale o preço de atacado.' },
  { cabecalho: 'Estoque mínimo', campo: 'estoqueMinimo', largura: 15, obrigatoria: false, ajuda: 'Número igual ou maior que zero.' },
  { cabecalho: 'Estoque máximo', campo: 'estoqueMaximo', largura: 15, obrigatoria: false, ajuda: 'Número igual ou maior que zero.' },
  { cabecalho: 'Validade (dias)', campo: 'validadeDias', largura: 15, obrigatoria: false, ajuda: 'Inteiro de 0 a 999.' },
  { cabecalho: 'NCM', campo: 'ncm', largura: 12, obrigatoria: false, ajuda: '8 dígitos.' },
  { cabecalho: 'CEST', campo: 'cest', largura: 12, obrigatoria: false, ajuda: '7 dígitos.' },
  { cabecalho: 'CFOP', campo: 'cfop', largura: 12, obrigatoria: false, ajuda: '4 dígitos.' },
  { cabecalho: 'CSOSN', campo: 'csosn', largura: 12, obrigatoria: false, ajuda: '3 ou 4 dígitos.' },
  { cabecalho: 'Produção própria', campo: 'produzido', largura: 16, obrigatoria: false, ajuda: 'Sim ou Não. Item fabricado na padaria (tem receita).' },
  { cabecalho: 'Insumo', campo: 'insumo', largura: 12, obrigatoria: false, ajuda: 'Sim ou Não. Insumo (matéria-prima) não aparece no PDV.' },
  { cabecalho: 'Controla lote', campo: 'controlaLote', largura: 14, obrigatoria: false, ajuda: 'Sim ou Não.' },
  { cabecalho: 'Ativo', campo: 'ativo', largura: 12, obrigatoria: false, ajuda: 'Sim ou Não. Vazio = Sim na criação.' },
  { cabecalho: 'Descrição', campo: 'descricao', largura: 40, obrigatoria: false, ajuda: 'Até 500 caracteres.' },
];

// Campos do banco que a importação lê e compara.
interface CamposBanco {
  codigo: string;
  ean: string | null;
  nome: string;
  marca: string | null;
  unidade: Unidade;
  pesavel: boolean;
  codigoBalanca: number | null;
  precoCusto: number;
  precoVenda: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  estoqueMinimo: number;
  estoqueMaximo: number | null;
  validadeDias: number | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  csosn: string | null;
  produzido: boolean;
  insumo: boolean;
  controlaLote: boolean;
  ativo: boolean;
  descricao: string | null;
}

// Linha lida da planilha: só traz o que veio preenchido (célula vazia fica fora).
type Lido = { [K in keyof CamposBanco]?: NonNullable<CamposBanco[K]> } & { categoria?: string };

const SELECAO_IMPORTAR = {
  id: true,
  codigo: true,
  ean: true,
  nome: true,
  marca: true,
  categoriaId: true,
  unidade: true,
  pesavel: true,
  codigoBalanca: true,
  precoCusto: true,
  precoVenda: true,
  precoAtacado: true,
  qtdAtacado: true,
  estoqueMinimo: true,
  estoqueMaximo: true,
  validadeDias: true,
  ncm: true,
  cest: true,
  cfop: true,
  csosn: true,
  produzido: true,
  insumo: true,
  controlaLote: true,
  ativo: true,
  descricao: true,
} as const;
type Atual = Prisma.ProdutoGetPayload<{ select: typeof SELECAO_IMPORTAR }>;

const SELECAO_EXPORTAR = {
  id: true,
  codigo: true,
  ean: true,
  nome: true,
  descricao: true,
  marca: true,
  unidade: true,
  pesavel: true,
  codigoBalanca: true,
  precoCusto: true,
  precoVenda: true,
  precoAtacado: true,
  qtdAtacado: true,
  estoqueMinimo: true,
  estoqueMaximo: true,
  validadeDias: true,
  ncm: true,
  cest: true,
  cfop: true,
  csosn: true,
  produzido: true,
  insumo: true,
  controlaLote: true,
  ativo: true,
  categoria: { select: { nome: true } },
} as const;

// ---------- Auxiliares ----------

class ErroLinha extends Error {}

type Conversor = (valor: string, rotulo: string) => unknown;

// Texto sem convenção especial: ASCII ou acentuado, minúsculo, sem acento e sem espaços extras.
function chaveTexto(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Cabeçalho sem o asterisco de obrigatório.
function chaveCabecalho(valor: string): string {
  return chaveTexto(valor.replace(/\*/g, ''));
}

// Número no formato brasileiro ou americano: tira R$, % e espaços; vírgula vira ponto (e pontos somem).
function numeroDe(texto: string): number | null {
  let s = texto.replace(/R\$/gi, '').replace(/%/g, '').replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

function decodificarNome(valor: string): string {
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

function simNao(valor: boolean): string {
  return valor ? 'Sim' : 'Não';
}

function dataHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function texto(max: number): Conversor {
  return (valor, rotulo) => {
    if (valor.length > max) throw new ErroLinha(`${rotulo}: até ${max} caracteres`);
    return valor;
  };
}

function livre(valor: string): string {
  return valor;
}

function numero(arredondar: (n: number) => number): Conversor {
  return (valor, rotulo) => {
    const n = numeroDe(valor);
    if (n === null) throw new ErroLinha(`${rotulo}: número inválido`);
    return arredondar(n);
  };
}

function inteiro(min: number, max: number): Conversor {
  return (valor, rotulo) => {
    const n = numeroDe(valor);
    if (n === null || !Number.isInteger(n) || n < min || n > max) {
      throw new ErroLinha(`${rotulo}: use um número inteiro de ${min} a ${max}`);
    }
    return n;
  };
}

function digitos(padrao: RegExp, descricao: string): Conversor {
  return (valor, rotulo) => {
    if (!padrao.test(valor)) throw new ErroLinha(`${rotulo}: ${descricao}`);
    return valor;
  };
}

const simNaoConversor: Conversor = (valor, rotulo) => {
  const chave = chaveTexto(valor);
  if (SIM.has(chave)) return true;
  if (NAO.has(chave)) return false;
  throw new ErroLinha(`${rotulo}: use Sim ou Não`);
};

const eanConversor: Conversor = (valor, rotulo) => {
  if (!/^\d+$/.test(valor)) throw new ErroLinha(`${rotulo}: use só números`);
  if (!eanValido(valor)) throw new ErroLinha(`${rotulo}: EAN inválido`);
  return valor;
};

const unidadeConversor: Conversor = (valor, rotulo) => {
  const unidade = valor.toUpperCase();
  if (!UNIDADES.includes(unidade as Unidade)) {
    throw new ErroLinha(`${rotulo}: use UN, KG, G, L, ML, CX, PCT ou DZ`);
  }
  return unidade;
};

const CONVERSORES: Record<CampoImportacao, Conversor> = {
  codigo: texto(30),
  ean: eanConversor,
  nome: texto(120),
  categoria: livre,
  marca: texto(60),
  unidade: unidadeConversor,
  pesavel: simNaoConversor,
  codigoBalanca: inteiro(1, 99999),
  precoCusto: numero(arred4),
  precoVenda: numero(arred2),
  precoAtacado: numero(arred2),
  qtdAtacado: numero(arred3),
  estoqueMinimo: numero(arred3),
  estoqueMaximo: numero(arred3),
  validadeDias: inteiro(0, 999),
  ncm: digitos(/^\d{8}$/, 'use 8 dígitos'),
  cest: digitos(/^\d{7}$/, 'use 7 dígitos'),
  cfop: digitos(/^\d{4}$/, 'use 4 dígitos'),
  csosn: digitos(/^\d{3,4}$/, 'use 3 ou 4 dígitos'),
  produzido: simNaoConversor,
  insumo: simNaoConversor,
  controlaLote: simNaoConversor,
  ativo: simNaoConversor,
  descricao: texto(500),
};

// Converte uma linha. Lança ErroLinha com a mensagem do problema.
function lerLinha(valores: string[], mapa: Map<CampoImportacao, number>): Lido {
  const lido: Record<string, unknown> = {};
  for (const coluna of COLUNAS) {
    const indice = mapa.get(coluna.campo);
    if (indice === undefined) continue;
    const valor = String(valores[indice] ?? '').trim();
    if (valor === '') continue;
    lido[coluna.campo] = CONVERSORES[coluna.campo](valor, coluna.cabecalho);
  }
  return lido as Lido;
}

function tentarLer(valores: string[], mapa: Map<CampoImportacao, number>): { lido?: Lido; erro?: string } {
  try {
    return { lido: lerLinha(valores, mapa) };
  } catch (e) {
    if (e instanceof ErroLinha) return { erro: e.message };
    throw e;
  }
}

function camposDe(p: Atual): CamposBanco {
  return {
    codigo: p.codigo,
    ean: p.ean,
    nome: p.nome,
    marca: p.marca,
    unidade: p.unidade,
    pesavel: p.pesavel,
    codigoBalanca: p.codigoBalanca,
    precoCusto: num(p.precoCusto),
    precoVenda: num(p.precoVenda),
    precoAtacado: numOuNull(p.precoAtacado),
    qtdAtacado: numOuNull(p.qtdAtacado),
    estoqueMinimo: num(p.estoqueMinimo),
    estoqueMaximo: numOuNull(p.estoqueMaximo),
    validadeDias: p.validadeDias,
    ncm: p.ncm,
    cest: p.cest,
    cfop: p.cfop,
    csosn: p.csosn,
    produzido: p.produzido,
    insumo: p.insumo,
    controlaLote: p.controlaLote,
    ativo: p.ativo,
    descricao: p.descricao,
  };
}

// ---------- Exportar ----------

router.get('/produtos-planilha/exportar', permitir(...LEITORES), asyncHandler(async (req, res) => {
  const ativos = req.query.ativos === '1';
  const lojaId = await lojaDaRequisicao(req);
  const produtos = await prisma.produto.findMany({
    where: ativos ? { ativo: true } : {},
    select: SELECAO_EXPORTAR,
    orderBy: { nome: 'asc' },
  });
  const estoques = await prisma.estoqueLoja.findMany({ where: { lojaId }, select: { produtoId: true, quantidade: true } });
  const saldos = new Map(estoques.map((e) => [e.produtoId, num(e.quantidade)] as const));

  const linhas: ValorCelula[][] = produtos.map((p) => {
    const valores: Record<CampoImportacao, ValorCelula> = {
      codigo: p.codigo,
      ean: p.ean,
      nome: p.nome,
      categoria: p.categoria?.nome ?? null,
      marca: p.marca,
      unidade: p.unidade,
      pesavel: simNao(p.pesavel),
      codigoBalanca: p.codigoBalanca,
      precoCusto: num(p.precoCusto),
      precoVenda: num(p.precoVenda),
      precoAtacado: numOuNull(p.precoAtacado),
      qtdAtacado: numOuNull(p.qtdAtacado),
      estoqueMinimo: num(p.estoqueMinimo),
      estoqueMaximo: numOuNull(p.estoqueMaximo),
      validadeDias: p.validadeDias,
      ncm: p.ncm,
      cest: p.cest,
      cfop: p.cfop,
      csosn: p.csosn,
      produzido: simNao(p.produzido),
      insumo: simNao(p.insumo),
      controlaLote: simNao(p.controlaLote),
      ativo: simNao(p.ativo),
      descricao: p.descricao,
    };
    return [...COLUNAS.map((c) => valores[c.campo]), saldos.get(p.id) ?? 0];
  });

  const arquivo = criarXlsx([
    {
      nome: 'Produtos',
      linhas: [[...COLUNAS.map((c) => c.cabecalho), COLUNA_ESTOQUE_LOJA], ...linhas],
      larguras: [...COLUNAS.map((c) => c.largura), 16],
      cabecalho: true,
    },
  ]);
  res.setHeader('Content-Type', TIPO_XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="produtos-${dataHoje()}.xlsx"`);
  res.send(arquivo);
}));

// ---------- Modelo ----------

// Três linhas de exemplo: revenda com EAN, pesável com PLU e insumo de padaria.
const EXEMPLOS: Partial<Record<CampoImportacao, ValorCelula>>[] = [
  {
    ean: '7891000100103',
    nome: 'Refrigerante exemplo 2 L',
    categoria: 'Bebidas',
    marca: 'Marca exemplo',
    unidade: 'UN',
    pesavel: 'Não',
    precoCusto: 5.5,
    precoVenda: 8.9,
    estoqueMinimo: 6,
    estoqueMaximo: 48,
    produzido: 'Não',
    insumo: 'Não',
    controlaLote: 'Não',
    ativo: 'Sim',
    descricao: 'Exemplo de item de revenda.',
  },
  {
    nome: 'Banana prata (exemplo)',
    categoria: 'Hortifruti',
    unidade: 'KG',
    pesavel: 'Sim',
    precoCusto: 3.2,
    precoVenda: 6.49,
    estoqueMinimo: 5,
    produzido: 'Não',
    insumo: 'Não',
    controlaLote: 'Não',
    ativo: 'Sim',
    descricao: 'Exemplo de item pesável na balança.',
  },
  {
    nome: 'Farinha de trigo (exemplo)',
    categoria: 'Insumos',
    unidade: 'KG',
    pesavel: 'Não',
    precoCusto: 4.8,
    precoVenda: 0,
    estoqueMinimo: 20,
    produzido: 'Não',
    insumo: 'Sim',
    controlaLote: 'Sim',
    ativo: 'Sim',
    descricao: 'Exemplo de insumo de padaria.',
  },
];

const AJUDA_GERAL = [
  'Unidades aceitas: UN, KG, G, L, ML, CX, PCT, DZ (minúsculas também valem).',
  'Sim/Não: aceita Sim, S, X, 1, true, verdadeiro e Não, Nao, N, 0, false, falso.',
  'Números: podem ter vírgula ou ponto decimal (12,99 ou 12.99). R$ e % são ignorados.',
  'Código existente atualiza o produto; vazio cria um novo.',
  'Células vazias não apagam o valor atual.',
];

router.get('/produtos-planilha/modelo', permitir(...LEITORES), asyncHandler(async (_req, res) => {
  const categorias = await prisma.categoria.findMany({ select: { nome: true }, orderBy: { nome: 'asc' } });
  const cabecalho: ValorCelula[] = COLUNAS.map((c) => (c.obrigatoria ? `${c.cabecalho}*` : c.cabecalho));
  const exemplos: ValorCelula[][] = EXEMPLOS.map((exemplo) => COLUNAS.map((c) => exemplo[c.campo] ?? null));
  const instrucoes: ValorCelula[][] = [
    ['Coluna', 'Obrigatória', 'O que preencher'],
    ...COLUNAS.map((c): ValorCelula[] => [c.cabecalho, c.obrigatoria ? 'Sim' : 'Não', c.ajuda]),
    ...AJUDA_GERAL.map((linha): ValorCelula[] => [linha]),
    ...categorias.map((c): ValorCelula[] => [`Categoria existente: ${c.nome}`]),
  ];

  const arquivo = criarXlsx([
    { nome: 'Produtos', linhas: [cabecalho, ...exemplos], larguras: COLUNAS.map((c) => c.largura), cabecalho: true },
    { nome: 'Instruções', linhas: instrucoes, larguras: [18, 12, 90], cabecalho: true },
  ]);
  res.setHeader('Content-Type', TIPO_XLSX);
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-produtos.xlsx"');
  res.send(arquivo);
}));

// ---------- Importar ----------

interface Leitura {
  linha: number;
  lido?: Lido;
  erro?: string;
  brutoCodigo: string; // como veio na planilha (para mostrar em linhas com erro)
  brutoNome: string;
}

interface Resultado {
  linha: number;
  acao: 'criar' | 'atualizar' | 'igual' | 'erro';
  codigo: string | null;
  nome: string;
  mudancas: string[];
  mensagem: string | null;
}

// Operação que será gravada (só para linhas válidas com criar ou atualizar).
interface Operacao {
  linha: number;
  produtoId?: number;
  criacao?: CamposBanco;
  alteracao?: Partial<CamposBanco>;
  categoriaChave?: string;
  mudaPreco: boolean;
  vendaFinal: number;
}

router.post(
  '/produtos-planilha/importar',
  permitir(...IMPORTADORES),
  express.raw({ type: () => true, limit: '10mb' }),
  asyncHandler(async (req, res) => {
    const simular = req.query.simular === '1';
    const arquivo = Buffer.isBuffer(req.body) ? req.body : null;
    if (!arquivo || arquivo.length === 0) throw new HttpError(400, 'Envie a planilha');

    const nomeHeader = req.get('x-nome-arquivo');
    let planilha: string[][];
    try {
      planilha = lerPlanilha(arquivo, nomeHeader ? decodificarNome(nomeHeader) : undefined);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'Não foi possível ler a planilha. Use um arquivo .xlsx ou .csv.');
    }

    // Mapa coluna do sistema -> índice na planilha (cabeçalho tolerante, em qualquer ordem).
    const mapa = new Map<CampoImportacao, number>();
    (planilha[0] ?? []).forEach((titulo, indice) => {
      const coluna = COLUNAS.find((c) => chaveCabecalho(c.cabecalho) === chaveCabecalho(String(titulo ?? '')));
      if (coluna && !mapa.has(coluna.campo)) mapa.set(coluna.campo, indice);
    });
    if (!mapa.has('nome')) throw new HttpError(400, 'A planilha precisa da coluna "Nome". Baixe o modelo.');

    // Linha 1 é o cabeçalho. Linhas totalmente vazias são ignoradas; o número da linha é o do Excel.
    const dados = planilha
      .slice(1)
      .map((valores, indice) => ({ linha: indice + 2, valores }))
      .filter(({ valores }) => valores.some((v) => String(v ?? '').trim() !== ''));
    if (dados.length > MAX_LINHAS) throw new HttpError(400, `A planilha tem mais de ${MAX_LINHAS} linhas de dados`);

    const atuais: Atual[] = await prisma.produto.findMany({ select: SELECAO_IMPORTAR });
    const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
    const categoriasPorChave = new Map<string, number>(categorias.map((c) => [chaveTexto(c.nome), c.id] as const));
    const porCodigo = new Map(atuais.map((p) => [p.codigo, p] as const));
    const porEan = new Map(atuais.filter((p) => p.ean).map((p) => [p.ean as string, p] as const));
    const porPlu = new Map(
      atuais.filter((p) => p.codigoBalanca !== null).map((p) => [p.codigoBalanca as number, p] as const),
    );

    // Pré-leitura: converte todas as linhas e junta os códigos e PLUs que a planilha já usa,
    // para que o próximo código/PLU gerado nunca repita um que vem no arquivo.
    const leituras: Leitura[] = dados.map(({ linha, valores }) => {
      const celula = (campo: CampoImportacao): string => {
        const indice = mapa.get(campo);
        return indice === undefined ? '' : String(valores[indice] ?? '').trim();
      };
      return { linha, brutoCodigo: celula('codigo'), brutoNome: celula('nome'), ...tentarLer(valores, mapa) };
    });

    const codigosUsados = new Set<string>(atuais.map((p) => p.codigo));
    const plusUsados = new Set<number>(
      atuais.map((p) => p.codigoBalanca).filter((v): v is number => v !== null),
    );
    for (const { lido } of leituras) {
      if (!lido) continue;
      if (lido.codigo !== undefined) codigosUsados.add(lido.codigo);
      if (lido.codigoBalanca !== undefined) plusUsados.add(lido.codigoBalanca);
    }
    let maiorCodigo = 0;
    for (const codigo of codigosUsados) {
      if (/^\d+$/.test(codigo)) maiorCodigo = Math.max(maiorCodigo, Number(codigo));
    }
    const proximoCodigo = (): string => {
      do {
        maiorCodigo++;
      } while (codigosUsados.has(pad6(maiorCodigo)));
      const novo = pad6(maiorCodigo);
      codigosUsados.add(novo);
      return novo;
    };
    const proximoPlu = (): number => {
      for (let plu = 1; plu <= 99999; plu++) {
        if (!plusUsados.has(plu)) {
          plusUsados.add(plu);
          return plu;
        }
      }
      throw new HttpError(409, 'Não há PLU livre para a balança');
    };

    const resultados: Resultado[] = [];
    const operacoes: Operacao[] = [];
    const codigosNaPlanilha = new Set<string>();
    const eansNaPlanilha = new Map<string, string>();
    const plusNaPlanilha = new Map<number, string>();
    const alvosNaPlanilha = new Set<number>();
    const categoriasNovas = new Map<string, string>(); // chave -> nome como veio na planilha
    let criar = 0;
    let atualizar = 0;
    let iguais = 0;
    let erros = 0;

    for (const { linha, lido, erro, brutoCodigo, brutoNome } of leituras) {
      const falhar = (
        mensagem: string,
        codigo: string | null = lido?.codigo ?? (brutoCodigo || null),
        nome = lido?.nome ?? brutoNome,
      ) => {
        resultados.push({ linha, acao: 'erro', codigo, nome, mudancas: [], mensagem });
        erros++;
      };
      if (!lido) {
        falhar(erro ?? 'Linha inválida');
        continue;
      }

      // Código repetido na própria planilha: vale o erro na 2ª ocorrência.
      if (lido.codigo !== undefined) {
        if (codigosNaPlanilha.has(lido.codigo)) {
          falhar('Código repetido na planilha');
          continue;
        }
        codigosNaPlanilha.add(lido.codigo);
      }

      // Achar o produto: primeiro pelo Código; se não achar, pelo EAN.
      let alvo: Atual | undefined = lido.codigo !== undefined ? porCodigo.get(lido.codigo) : undefined;
      if (!alvo && lido.ean !== undefined) alvo = porEan.get(lido.ean);
      if (!alvo && lido.nome === undefined) {
        falhar('Informe o nome do produto');
        continue;
      }
      if (alvo && alvosNaPlanilha.has(alvo.id)) {
        falhar('Este produto já aparece em outra linha da planilha');
        continue;
      }
      const chaveLinha = alvo ? `p${alvo.id}` : `n${linha}`;

      if (lido.ean !== undefined) {
        const dono = porEan.get(lido.ean);
        if (dono && dono.id !== alvo?.id) {
          falhar('EAN já usado por outro produto', lido.codigo ?? null, lido.nome ?? '');
          continue;
        }
        const outra = eansNaPlanilha.get(lido.ean);
        if (outra !== undefined && outra !== chaveLinha) {
          falhar('EAN repetido na planilha', lido.codigo ?? null, lido.nome ?? '');
          continue;
        }
      }
      if (lido.codigoBalanca !== undefined) {
        const dono = porPlu.get(lido.codigoBalanca);
        if (dono && dono.id !== alvo?.id) {
          falhar('PLU já usado por outro produto', lido.codigo ?? null, lido.nome ?? '');
          continue;
        }
        const outra = plusNaPlanilha.get(lido.codigoBalanca);
        if (outra !== undefined && outra !== chaveLinha) {
          falhar('PLU repetido na planilha', lido.codigo ?? null, lido.nome ?? '');
          continue;
        }
      }

      // A linha é aceita: registra o que ela usa.
      if (lido.ean !== undefined) eansNaPlanilha.set(lido.ean, chaveLinha);
      if (lido.codigoBalanca !== undefined) plusNaPlanilha.set(lido.codigoBalanca, chaveLinha);
      if (alvo) alvosNaPlanilha.add(alvo.id);

      const chaveCategoria = lido.categoria !== undefined ? chaveTexto(lido.categoria) : undefined;

      if (!alvo) {
        // Criação: célula vazia recebe o padrão do cadastro (ativo = Sim, unidade = UN...).
        const pesavel = lido.pesavel ?? false;
        const criacao: CamposBanco = {
          codigo: lido.codigo ?? proximoCodigo(),
          ean: lido.ean ?? null,
          nome: lido.nome ?? '',
          marca: lido.marca ?? null,
          unidade: lido.unidade ?? 'UN',
          pesavel,
          codigoBalanca: lido.codigoBalanca ?? (pesavel ? proximoPlu() : null),
          precoCusto: lido.precoCusto ?? 0,
          precoVenda: lido.precoVenda ?? 0,
          precoAtacado: lido.precoAtacado ?? null,
          qtdAtacado: lido.qtdAtacado ?? null,
          estoqueMinimo: lido.estoqueMinimo ?? 0,
          estoqueMaximo: lido.estoqueMaximo ?? null,
          validadeDias: lido.validadeDias ?? null,
          ncm: lido.ncm ?? null,
          cest: lido.cest ?? null,
          cfop: lido.cfop ?? null,
          csosn: lido.csosn ?? null,
          produzido: lido.produzido ?? false,
          insumo: lido.insumo ?? false,
          controlaLote: lido.controlaLote ?? false,
          ativo: lido.ativo ?? true,
          descricao: lido.descricao ?? null,
        };
        if (chaveCategoria !== undefined && !categoriasPorChave.has(chaveCategoria)) {
          categoriasNovas.set(chaveCategoria, (lido.categoria ?? '').trim());
        }
        operacoes.push({
          linha,
          criacao,
          categoriaChave: chaveCategoria,
          mudaPreco: false,
          vendaFinal: criacao.precoVenda,
        });
        resultados.push({ linha, acao: 'criar', codigo: criacao.codigo, nome: criacao.nome, mudancas: [], mensagem: null });
        criar++;
        continue;
      }

      // Atualização: só entra o que veio preenchido e mudou de fato.
      const atual = camposDe(alvo);
      const alteracao: Partial<CamposBanco> = {};
      const mudancas: string[] = [];
      const antes = atual as unknown as Record<string, unknown>;
      const novos = lido as unknown as Record<string, unknown>;
      const alt = alteracao as unknown as Record<string, unknown>;
      for (const campo of Object.keys(lido)) {
        if (campo === 'codigo' || campo === 'categoria') continue;
        if (novos[campo] === undefined) continue;
        if (novos[campo] !== antes[campo]) {
          alt[campo] = novos[campo];
          mudancas.push(campo);
        }
      }

      let categoriaChave: string | undefined;
      if (chaveCategoria !== undefined) {
        const idExistente = categoriasPorChave.get(chaveCategoria);
        if (idExistente === undefined || idExistente !== alvo.categoriaId) {
          categoriaChave = chaveCategoria;
          mudancas.push('categoria');
          if (idExistente === undefined) categoriasNovas.set(chaveCategoria, (lido.categoria ?? '').trim());
        }
      }

      // Pesável sem PLU recebe o próximo livre.
      const pesavelFinal = alteracao.pesavel ?? atual.pesavel;
      const pluFinal = alteracao.codigoBalanca !== undefined ? alteracao.codigoBalanca : atual.codigoBalanca;
      if (pesavelFinal && pluFinal === null) {
        alteracao.codigoBalanca = proximoPlu();
        mudancas.push('codigoBalanca');
      }

      if (mudancas.length === 0) {
        iguais++;
        resultados.push({ linha, acao: 'igual', codigo: alvo.codigo, nome: alvo.nome, mudancas: [], mensagem: null });
        continue;
      }

      const mudaPreco = alteracao.precoVenda !== undefined || alteracao.precoCusto !== undefined;
      operacoes.push({
        linha,
        produtoId: alvo.id,
        alteracao,
        categoriaChave,
        mudaPreco,
        vendaFinal: alteracao.precoVenda ?? atual.precoVenda,
      });
      resultados.push({
        linha,
        acao: 'atualizar',
        codigo: alvo.codigo,
        nome: alteracao.nome ?? alvo.nome,
        mudancas,
        mensagem: null,
      });
      atualizar++;
    }

    // Erros primeiro; depois as demais linhas na ordem da planilha.
    const ordenadas = [...resultados.filter((r) => r.acao === 'erro'), ...resultados.filter((r) => r.acao !== 'erro')];
    const categoriasNovasLista = Array.from(categoriasNovas.values());

    if (!simular) {
      // Mudança de preço exige a ação ALTERAR_PRECO (uma vez, antes de gravar qualquer coisa).
      if (operacoes.some((o) => o.mudaPreco)) await exigirAcao(req, 'ALTERAR_PRECO');

      await prisma.$transaction(
        async (tx) => {
          const mapaCategorias = new Map(categoriasPorChave);
          for (const [chave, nome] of Array.from(categoriasNovas.entries())) {
            const criada = await tx.categoria.create({ data: { nome } });
            mapaCategorias.set(chave, criada.id);
          }

          for (const op of operacoes) {
            const categoriaId =
              op.categoriaChave !== undefined ? (mapaCategorias.get(op.categoriaChave) ?? null) : undefined;

            if (op.criacao) {
              await tx.produto.create({ data: { ...op.criacao, categoriaId } });
              continue;
            }
            if (op.produtoId === undefined || !op.alteracao) continue;

            const { precoVenda, precoCusto, ...demais } = op.alteracao;
            const data: Prisma.ProdutoUncheckedUpdateInput = { ...demais };
            if (categoriaId !== undefined) data.categoriaId = categoriaId;
            if (Object.keys(data).length > 0) {
              await tx.produto.update({ where: { id: op.produtoId }, data });
            }
            if (op.mudaPreco) {
              await alterarPreco(tx, {
                produtoId: op.produtoId,
                precoVenda: op.vendaFinal,
                precoCusto: precoCusto ?? null,
                usuarioId: req.usuario.id,
                motivo: 'Importação de planilha',
              });
            }
          }
        },
        { timeout: 120000 },
      );

      const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
      registrarLog({
        tipo: criar > 0 && atualizar === 0 ? 'CRIACAO' : 'ALTERACAO',
        modulo: 'produtos',
        descricao: `Importação de planilha: ${criar} criados, ${atualizar} atualizados, ${erros} com erro`,
        usuarioId: req.usuario.id,
        usuarioNome: usuario?.nome ?? null,
        perfil: req.usuario.perfil,
      });
    }

    res.json({
      simulado: simular,
      total: dados.length,
      criar,
      atualizar,
      iguais,
      erros,
      categoriasNovas: categoriasNovasLista,
      linhas: ordenadas.slice(0, MAX_RESPOSTA_LINHAS),
    });
  }),
);

export default router;
