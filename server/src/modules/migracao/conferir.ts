// Conferência da migração: compara o que foi lido com o banco e com o próprio lote.
// Só consulta o banco; quem grava é o aplicar.ts.

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { arred2, arred4, num, numOuNull } from '../../lib/numeros';
import { eanValido } from '../../lib/precos';
import { chaveTexto, formatarDocumento } from './normalizar';
import {
  ORDEM_ENTIDADES,
  type Entidade,
  type ItemConferencia,
  type LeituraLote,
  type LoteMigracao,
  type Mudanca,
  type RegCliente,
  type RegConta,
  type RegFiado,
  type RegFornecedor,
  type RegEstoque,
  type RegProduto,
  type RegistroLido,
  type ResumoEntidade,
  type Situacao,
  type ValorSimples,
} from './tipos';

export interface ContextoConferencia {
  lojaId: number; // loja da requisição (estoque)
  lote?: LeituraLote; // o lote inteiro, para achar referências a itens que serão criados nele
}

// ---------- Consultas enxutas ao banco ----------

const SEL_FORNECEDOR = {
  id: true,
  nome: true,
  razaoSocial: true,
  cnpj: true,
  inscricaoEstadual: true,
  telefone: true,
  whatsapp: true,
  email: true,
  contato: true,
  endereco: true,
  cidade: true,
  uf: true,
  prazoEntregaDias: true,
  condicaoPagamento: true,
  observacoes: true,
  codigoAntigo: true,
  ativo: true,
} as const;

const SEL_CLIENTE = {
  id: true,
  nome: true,
  tipo: true,
  cpfCnpj: true,
  razaoSocial: true,
  inscricaoEstadual: true,
  telefone: true,
  whatsapp: true,
  email: true,
  cep: true,
  endereco: true,
  numero: true,
  bairro: true,
  cidade: true,
  uf: true,
  limiteCredito: true,
  observacoes: true,
  codigoAntigo: true,
  ativo: true,
} as const;

const SEL_PRODUTO = {
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
  pesoBrutoKg: true,
  validadeDias: true,
  ncm: true,
  cest: true,
  cfop: true,
  csosn: true,
  produzido: true,
  insumo: true,
  ativo: true,
  categoria: { select: { nome: true } },
} as const;

const SEL_PRODUTO_MIN = { id: true, codigo: true, ean: true, nome: true } as const;
const SEL_CLIENTE_MIN = { id: true, nome: true, cpfCnpj: true, codigoAntigo: true, saldoDevedor: true } as const;
const SEL_FORNECEDOR_MIN = { id: true, nome: true, cnpj: true, codigoAntigo: true } as const;

type FornecedorBanco = Prisma.FornecedorGetPayload<{ select: typeof SEL_FORNECEDOR }>;
type ClienteBanco = Prisma.ClienteGetPayload<{ select: typeof SEL_CLIENTE }>;
type ProdutoBanco = Prisma.ProdutoGetPayload<{ select: typeof SEL_PRODUTO }>;
type ProdutoMin = Prisma.ProdutoGetPayload<{ select: typeof SEL_PRODUTO_MIN }>;
type ClienteMin = Prisma.ClienteGetPayload<{ select: typeof SEL_CLIENTE_MIN }>;
type FornecedorMin = Prisma.FornecedorGetPayload<{ select: typeof SEL_FORNECEDOR_MIN }>;

// ---------- Auxiliares ----------

interface Par {
  campo: string;
  rotulo: string;
  de: unknown; // valor no banco
  para: unknown; // valor do arquivo (undefined = arquivo não traz: não compara)
  texto?: boolean; // compara sem diferenciar maiúsculas e acentos
}

interface Pessoa {
  id: number;
  nome: string;
}

interface Busca {
  doc?: string;
  codigo?: string;
  nome?: string;
}

interface Indices<T extends Pessoa> {
  porDoc: Map<string, T>;
  porCodigo: Map<string, T>;
  porNome: Map<string, T[]>;
}

interface ConjuntosLote {
  docs: Set<string>;
  codigos: Set<string>;
  nomes: Set<string>;
}

const NAO_NEGATIVOS: [keyof RegProduto, string][] = [
  ['precoCusto', 'Preço de custo'],
  ['precoVenda', 'Preço de venda'],
  ['precoAtacado', 'Preço de atacado'],
  ['estoqueMinimo', 'Estoque mínimo'],
  ['estoqueMaximo', 'Estoque máximo'],
];

const TAMANHO_LOTE_SQL = 5000;

function novoItem<E extends Entidade>(indice: number, lido: RegistroLido<E>, resumo: string): ItemConferencia<E> {
  return {
    indice,
    origem: lido.origem,
    resumo,
    registro: lido.registro,
    situacao: 'novo',
    existenteId: null,
    mudancas: [],
    erros: [...lido.erros],
    avisos: [...lido.avisos],
  };
}

// Erro sempre zera mudanças e vínculo; sem erro, a situação sai do casamento (ou da regra forçada).
function fechar<E extends Entidade>(item: ItemConferencia<E>, forcada?: Situacao): ItemConferencia<E> {
  if (item.erros.length > 0) {
    item.situacao = 'erro';
    item.existenteId = null;
    item.mudancas = [];
  } else if (forcada) {
    item.situacao = forcada;
  } else if (item.existenteId === null) {
    item.situacao = 'novo';
  } else {
    item.situacao = item.mudancas.length > 0 ? 'existe' : 'igual';
  }
  return item;
}

// Chave já vista no arquivo: o 2º item vira erro.
function registrarRepetido<E extends Entidade>(item: ItemConferencia<E>, chave: string, vistos: Map<string, string>): void {
  const anterior = vistos.get(chave);
  if (anterior !== undefined) item.erros.push(`Repetido no arquivo (igual à ${anterior})`);
  else vistos.set(chave, item.origem);
}

function valorSimples(v: unknown): ValorSimples {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return arred4(v);
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return String(v);
}

function valoresIguais(a: ValorSimples, b: ValorSimples, texto?: boolean): boolean {
  if (texto && typeof a === 'string' && typeof b === 'string') return chaveTexto(a) === chaveTexto(b);
  return a === b;
}

// Só compara campos que o arquivo traz (para = undefined fica de fora).
function mudancasDe(pares: Par[]): Mudanca[] {
  const saida: Mudanca[] = [];
  for (const p of pares) {
    if (p.para === undefined) continue;
    const de = valorSimples(p.de);
    const para = valorSimples(p.para);
    if (!valoresIguais(de, para, p.texto)) saida.push({ campo: p.campo, rotulo: p.rotulo, de, para });
  }
  return saida;
}

function digitos(s?: string): string | undefined {
  if (!s) return undefined;
  const d = s.replace(/\D/g, '');
  return d || undefined;
}

function fmtMoeda(v: number): string {
  return arred2(v).toFixed(2).replace('.', ',');
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function dataIsoValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function adicionar<T>(mapa: Map<string, T[]>, chave: string, valor: T): void {
  const lista = mapa.get(chave);
  if (lista) lista.push(valor);
  else mapa.set(chave, [valor]);
}

function indexar<T extends Pessoa>(
  linhas: T[],
  doc: (t: T) => string | null | undefined,
  codigo: (t: T) => string | null | undefined,
): Indices<T> {
  const idx: Indices<T> = { porDoc: new Map(), porCodigo: new Map(), porNome: new Map() };
  for (const t of linhas) {
    const d = doc(t);
    if (d) idx.porDoc.set(d, t);
    const c = codigo(t);
    if (c) idx.porCodigo.set(c, t);
    adicionar(idx.porNome, chaveTexto(t.nome), t);
  }
  return idx;
}

// Ordem: documento, código antigo, nome (só se um único tiver esse nome).
function buscarPessoa<T extends Pessoa>(
  idx: Indices<T>,
  busca: Busca,
): { achado: T; pelo: 'doc' | 'codigo' | 'nome' } | null {
  if (busca.doc !== undefined) {
    const a = idx.porDoc.get(busca.doc);
    if (a) return { achado: a, pelo: 'doc' };
  }
  if (busca.codigo !== undefined) {
    const a = idx.porCodigo.get(busca.codigo);
    if (a) return { achado: a, pelo: 'codigo' };
  }
  if (busca.nome !== undefined) {
    const homonimos = idx.porNome.get(chaveTexto(busca.nome)) ?? [];
    if (homonimos.length === 1) return { achado: homonimos[0], pelo: 'nome' };
  }
  return null;
}

function conjuntosLote<T extends { nome: string }>(
  registros: T[] | undefined,
  doc: (r: T) => string | undefined,
  codigo: (r: T) => string | undefined,
): ConjuntosLote {
  const c: ConjuntosLote = { docs: new Set(), codigos: new Set(), nomes: new Set() };
  for (const r of registros ?? []) {
    const d = doc(r);
    if (d) c.docs.add(d);
    const k = codigo(r);
    if (k) c.codigos.add(k);
    c.nomes.add(chaveTexto(r.nome));
  }
  return c;
}

function estaNoLote(c: ConjuntosLote, busca: Busca): boolean {
  return (
    (busca.doc !== undefined && c.docs.has(busca.doc)) ||
    (busca.codigo !== undefined && c.codigos.has(busca.codigo)) ||
    (busca.nome !== undefined && c.nomes.has(chaveTexto(busca.nome)))
  );
}

function resumoCadastro(nome: string, doc?: string): string {
  return `${nome}${doc ? ` · ${formatarDocumento(doc)}` : ''}`;
}

function validarNome(item: ItemConferencia, nome: string): void {
  if (nome.length < 1 || nome.length > 120) item.erros.push('Nome deve ter de 1 a 120 caracteres');
}

// ---------- Fornecedores ----------

function chaveFornecedor(r: RegFornecedor): string {
  if (r.cnpj) return `doc:${r.cnpj}`;
  if (r.codigoAntigo) return `cod:${r.codigoAntigo}`;
  return `nome:${chaveTexto(r.nome)}`;
}

function paresFornecedor(f: FornecedorBanco, r: RegFornecedor): Par[] {
  return [
    { campo: 'codigoAntigo', rotulo: 'Código no sistema antigo', de: f.codigoAntigo, para: r.codigoAntigo },
    { campo: 'nome', rotulo: 'Nome', de: f.nome, para: r.nome },
    { campo: 'razaoSocial', rotulo: 'Razão social', de: f.razaoSocial, para: r.razaoSocial },
    { campo: 'cnpj', rotulo: 'CNPJ/CPF', de: f.cnpj, para: r.cnpj },
    { campo: 'inscricaoEstadual', rotulo: 'Inscrição estadual', de: f.inscricaoEstadual, para: r.inscricaoEstadual },
    { campo: 'telefone', rotulo: 'Telefone', de: f.telefone, para: r.telefone },
    { campo: 'whatsapp', rotulo: 'Celular/WhatsApp', de: f.whatsapp, para: r.whatsapp },
    { campo: 'email', rotulo: 'E-mail', de: f.email, para: r.email },
    { campo: 'contato', rotulo: 'Contato', de: f.contato, para: r.contato },
    { campo: 'endereco', rotulo: 'Endereço', de: f.endereco, para: r.endereco },
    { campo: 'cidade', rotulo: 'Cidade', de: f.cidade, para: r.cidade },
    { campo: 'uf', rotulo: 'UF', de: f.uf, para: r.uf },
    { campo: 'prazoEntregaDias', rotulo: 'Prazo de entrega (dias)', de: f.prazoEntregaDias, para: r.prazoEntregaDias },
    { campo: 'condicaoPagamento', rotulo: 'Condição de pagamento', de: f.condicaoPagamento, para: r.condicaoPagamento },
    { campo: 'observacoes', rotulo: 'Observações', de: f.observacoes, para: r.observacoes },
    { campo: 'ativo', rotulo: 'Ativo', de: f.ativo, para: r.ativo },
  ];
}

async function conferirFornecedores(lidos: RegistroLido<'fornecedores'>[]): Promise<ItemConferencia<'fornecedores'>[]> {
  if (lidos.length === 0) return [];
  const bancos = await prisma.fornecedor.findMany({ select: SEL_FORNECEDOR });
  const idx = indexar(bancos, (f) => f.cnpj, (f) => f.codigoAntigo);
  const vistos = new Map<string, string>();

  return lidos.map((lido, i) => {
    const r = lido.registro;
    const item = novoItem(i, lido, resumoCadastro(r.nome, r.cnpj));
    validarNome(item, r.nome);
    if (item.erros.length === 0) registrarRepetido(item, chaveFornecedor(r), vistos);
    if (item.erros.length === 0) {
      const busca = buscarPessoa(idx, { doc: r.cnpj, codigo: r.codigoAntigo, nome: r.nome });
      if (busca) {
        const f = busca.achado;
        if (busca.pelo === 'nome') item.avisos.push('Encontrado pelo nome');
        if (busca.pelo !== 'doc' && r.cnpj !== undefined && f.cnpj && f.cnpj !== r.cnpj) {
          item.erros.push(`O fornecedor "${f.nome}" já tem outro CNPJ (${formatarDocumento(f.cnpj)})`);
        } else {
          item.existenteId = f.id;
          item.mudancas = mudancasDe(paresFornecedor(f, r));
        }
      }
    }
    return fechar(item);
  });
}

// ---------- Clientes ----------

function chaveCliente(r: RegCliente): string {
  if (r.cpfCnpj) return `doc:${r.cpfCnpj}`;
  if (r.codigoAntigo) return `cod:${r.codigoAntigo}`;
  return `nome:${chaveTexto(r.nome)}`;
}

function paresCliente(c: ClienteBanco, r: RegCliente): Par[] {
  return [
    { campo: 'codigoAntigo', rotulo: 'Código no sistema antigo', de: c.codigoAntigo, para: r.codigoAntigo },
    { campo: 'nome', rotulo: 'Nome', de: c.nome, para: r.nome },
    { campo: 'tipo', rotulo: 'Tipo (Varejo/Atacado)', de: c.tipo, para: r.tipo },
    { campo: 'cpfCnpj', rotulo: 'CPF/CNPJ', de: c.cpfCnpj, para: r.cpfCnpj },
    { campo: 'razaoSocial', rotulo: 'Razão social', de: c.razaoSocial, para: r.razaoSocial },
    { campo: 'inscricaoEstadual', rotulo: 'Inscrição estadual', de: c.inscricaoEstadual, para: r.inscricaoEstadual },
    { campo: 'telefone', rotulo: 'Telefone', de: c.telefone, para: r.telefone },
    { campo: 'whatsapp', rotulo: 'Celular/WhatsApp', de: c.whatsapp, para: r.whatsapp },
    { campo: 'email', rotulo: 'E-mail', de: c.email, para: r.email },
    { campo: 'cep', rotulo: 'CEP', de: c.cep, para: r.cep },
    { campo: 'endereco', rotulo: 'Endereço', de: c.endereco, para: r.endereco },
    { campo: 'numero', rotulo: 'Número', de: c.numero, para: r.numero },
    { campo: 'bairro', rotulo: 'Bairro', de: c.bairro, para: r.bairro },
    { campo: 'cidade', rotulo: 'Cidade', de: c.cidade, para: r.cidade },
    { campo: 'uf', rotulo: 'UF', de: c.uf, para: r.uf },
    { campo: 'limiteCredito', rotulo: 'Limite de crédito', de: num(c.limiteCredito), para: r.limiteCredito },
    { campo: 'observacoes', rotulo: 'Observações', de: c.observacoes, para: r.observacoes },
    { campo: 'ativo', rotulo: 'Ativo', de: c.ativo, para: r.ativo },
  ];
}

async function conferirClientes(lidos: RegistroLido<'clientes'>[]): Promise<ItemConferencia<'clientes'>[]> {
  if (lidos.length === 0) return [];
  const bancos = await prisma.cliente.findMany({ select: SEL_CLIENTE });
  const idx = indexar(bancos, (c) => c.cpfCnpj, (c) => c.codigoAntigo);
  const vistos = new Map<string, string>();

  return lidos.map((lido, i) => {
    const r = lido.registro;
    const item = novoItem(i, lido, resumoCadastro(r.nome, r.cpfCnpj));
    validarNome(item, r.nome);
    if (r.limiteCredito !== undefined && r.limiteCredito < 0) item.erros.push('Limite de crédito não pode ser negativo');
    if (item.erros.length === 0) registrarRepetido(item, chaveCliente(r), vistos);
    if (item.erros.length === 0) {
      const busca = buscarPessoa(idx, { doc: r.cpfCnpj, codigo: r.codigoAntigo, nome: r.nome });
      if (busca) {
        const c = busca.achado;
        if (busca.pelo === 'nome') item.avisos.push('Encontrado pelo nome');
        if (busca.pelo !== 'doc' && r.cpfCnpj !== undefined && c.cpfCnpj && c.cpfCnpj !== r.cpfCnpj) {
          item.erros.push(`O cliente "${c.nome}" já tem outro CPF/CNPJ (${formatarDocumento(c.cpfCnpj)})`);
        } else {
          item.existenteId = c.id;
          item.mudancas = mudancasDe(paresCliente(c, r));
        }
      }
    }
    return fechar(item);
  });
}

// ---------- Produtos ----------

function chaveProduto(r: RegProduto): string {
  if (r.codigo) return `cod:${r.codigo}`;
  if (r.ean) return `ean:${r.ean}`;
  if (r.fornecedorCnpj && r.codigoFornecedor) return `forn:${r.fornecedorCnpj}|${r.codigoFornecedor}`;
  return `nome:${chaveTexto(r.nome)}`;
}

function validarProduto(item: ItemConferencia<'produtos'>, r: RegProduto): void {
  const e = item.erros;
  if (r.nome.length < 1 || r.nome.length > 120) e.push('Nome deve ter de 1 a 120 caracteres');
  if (r.codigo !== undefined && r.codigo.length > 30) e.push('Código com mais de 30 caracteres');
  if (r.ean !== undefined && !eanValido(r.ean)) e.push(`EAN inválido: "${r.ean}"`);
  if (r.codigoBalanca !== undefined && (r.codigoBalanca < 1 || r.codigoBalanca > 99999)) {
    e.push('PLU da balança deve estar entre 1 e 99999');
  }
  for (const [campo, rotulo] of NAO_NEGATIVOS) {
    const v = r[campo];
    if (typeof v === 'number' && v < 0) e.push(`${rotulo} não pode ser negativo`);
  }
  if (r.ncm !== undefined && !/^\d{8}$/.test(r.ncm)) e.push('NCM deve ter 8 dígitos');
  if (r.cest !== undefined && !/^\d{7}$/.test(r.cest)) e.push('CEST deve ter 7 dígitos');
  if (r.cfop !== undefined && !/^\d{4}$/.test(r.cfop)) e.push('CFOP deve ter 4 dígitos');
  if (r.csosn !== undefined && !/^\d{3,4}$/.test(r.csosn)) e.push('CSOSN deve ter 3 ou 4 dígitos');
  if (r.categoria !== undefined && r.categoria.length > 60) e.push('Categoria com mais de 60 caracteres');
  if (r.marca !== undefined && r.marca.length > 60) e.push('Marca com mais de 60 caracteres');
  if (r.descricao !== undefined && r.descricao.length > 500) e.push('Descrição com mais de 500 caracteres');
  if (r.validadeDias !== undefined && (r.validadeDias < 0 || r.validadeDias > 999)) {
    e.push('Validade deve estar entre 0 e 999 dias');
  }
}

function paresProduto(b: ProdutoBanco, r: RegProduto): Par[] {
  return [
    { campo: 'ean', rotulo: 'EAN (código de barras)', de: b.ean, para: r.ean },
    { campo: 'nome', rotulo: 'Nome (descrição)', de: b.nome, para: r.nome },
    { campo: 'descricao', rotulo: 'Descrição complementar', de: b.descricao, para: r.descricao },
    { campo: 'categoria', rotulo: 'Categoria', de: b.categoria?.nome ?? null, para: r.categoria, texto: true },
    { campo: 'marca', rotulo: 'Marca', de: b.marca, para: r.marca },
    { campo: 'unidade', rotulo: 'Unidade', de: b.unidade, para: r.unidade },
    { campo: 'pesavel', rotulo: 'Pesável (balança)', de: b.pesavel, para: r.pesavel },
    { campo: 'codigoBalanca', rotulo: 'PLU da balança', de: b.codigoBalanca, para: r.codigoBalanca },
    { campo: 'precoCusto', rotulo: 'Preço de custo', de: num(b.precoCusto), para: r.precoCusto },
    { campo: 'precoVenda', rotulo: 'Preço de venda', de: num(b.precoVenda), para: r.precoVenda },
    { campo: 'precoAtacado', rotulo: 'Preço de atacado', de: numOuNull(b.precoAtacado), para: r.precoAtacado },
    { campo: 'qtdAtacado', rotulo: 'Qtd. mínima atacado', de: numOuNull(b.qtdAtacado), para: r.qtdAtacado },
    { campo: 'estoqueMinimo', rotulo: 'Estoque mínimo', de: num(b.estoqueMinimo), para: r.estoqueMinimo },
    { campo: 'estoqueMaximo', rotulo: 'Estoque máximo', de: numOuNull(b.estoqueMaximo), para: r.estoqueMaximo },
    { campo: 'pesoBrutoKg', rotulo: 'Peso bruto (kg)', de: numOuNull(b.pesoBrutoKg), para: r.pesoBrutoKg },
    { campo: 'validadeDias', rotulo: 'Validade (dias)', de: b.validadeDias, para: r.validadeDias },
    { campo: 'ncm', rotulo: 'NCM', de: b.ncm, para: r.ncm },
    { campo: 'cest', rotulo: 'CEST', de: b.cest, para: r.cest },
    { campo: 'cfop', rotulo: 'CFOP', de: b.cfop, para: r.cfop },
    { campo: 'csosn', rotulo: 'CSOSN', de: b.csosn, para: r.csosn },
    { campo: 'insumo', rotulo: 'Insumo (matéria-prima)', de: b.insumo, para: r.insumo },
    { campo: 'produzido', rotulo: 'Produção própria', de: b.produzido, para: r.produzido },
    { campo: 'ativo', rotulo: 'Ativo', de: b.ativo, para: r.ativo },
  ];
}

interface IndicesProduto {
  porId: Map<number, ProdutoBanco>;
  porCodigo: Map<string, ProdutoBanco>;
  porEan: Map<string, ProdutoBanco>;
  porPlu: Map<number, ProdutoBanco>;
  porNome: Map<string, ProdutoBanco[]>;
  porVinculo: Map<string, number>; // "cnpj|codigoFornecedor" -> produtoId
}

// Ordem: código, EAN, vínculo com fornecedor, nome (só sem código e sem EAN). Depois, conflitos.
function casarProduto(item: ItemConferencia<'produtos'>, r: RegProduto, idx: IndicesProduto): void {
  let achado: ProdutoBanco | undefined;

  if (r.codigo !== undefined) achado = idx.porCodigo.get(r.codigo);

  if (!achado && r.ean !== undefined) {
    achado = idx.porEan.get(r.ean);
    if (achado && r.codigo !== undefined && r.codigo !== achado.codigo) {
      item.avisos.push(`Encontrado pelo EAN; o código atual ${achado.codigo} é mantido`);
    }
  }

  if (!achado && r.fornecedorCnpj !== undefined && r.codigoFornecedor !== undefined) {
    const id = idx.porVinculo.get(`${r.fornecedorCnpj}|${r.codigoFornecedor}`);
    if (id !== undefined) achado = idx.porId.get(id);
  }

  if (!achado && r.codigo === undefined && r.ean === undefined) {
    const homonimos = idx.porNome.get(chaveTexto(r.nome)) ?? [];
    if (homonimos.length === 1) {
      achado = homonimos[0];
      item.avisos.push('Encontrado pelo nome');
    }
  }

  if (r.ean !== undefined) {
    const dono = idx.porEan.get(r.ean);
    if (dono && dono.id !== achado?.id) item.erros.push(`EAN já usado pelo produto ${dono.codigo} · ${dono.nome}`);
  }
  if (r.codigoBalanca !== undefined) {
    const dono = idx.porPlu.get(r.codigoBalanca);
    if (dono && dono.id !== achado?.id) item.erros.push(`PLU já usado pelo produto ${dono.codigo} · ${dono.nome}`);
  }

  if (!achado) {
    if (!r.precoVenda) item.avisos.push('Sem preço de venda: entra com preço 0');
    return;
  }
  item.existenteId = achado.id;
  item.mudancas = mudancasDe(paresProduto(achado, r));
}

async function conferirProdutos(lidos: RegistroLido<'produtos'>[]): Promise<ItemConferencia<'produtos'>[]> {
  if (lidos.length === 0) return [];
  const bancos = await prisma.produto.findMany({ select: SEL_PRODUTO });
  const vinculos = await prisma.produtoFornecedor.findMany({
    where: { codigoFornecedor: { not: null } },
    select: { produtoId: true, codigoFornecedor: true, fornecedor: { select: { cnpj: true } } },
  });

  const idx: IndicesProduto = {
    porId: new Map(),
    porCodigo: new Map(),
    porEan: new Map(),
    porPlu: new Map(),
    porNome: new Map(),
    porVinculo: new Map(),
  };
  for (const p of bancos) {
    idx.porId.set(p.id, p);
    idx.porCodigo.set(p.codigo, p);
    if (p.ean) idx.porEan.set(p.ean, p);
    if (p.codigoBalanca !== null) idx.porPlu.set(p.codigoBalanca, p);
    adicionar(idx.porNome, chaveTexto(p.nome), p);
  }
  for (const v of vinculos) {
    const cnpj = v.fornecedor.cnpj;
    if (!v.codigoFornecedor || !cnpj) continue;
    const chave = `${cnpj}|${v.codigoFornecedor}`;
    if (!idx.porVinculo.has(chave)) idx.porVinculo.set(chave, v.produtoId);
  }

  const vistos = new Map<string, string>();
  const eanVistos = new Map<string, { origem: string; chave: string }>();
  const pluVistos = new Map<number, { origem: string; chave: string }>();
  return lidos.map((lido, i) => {
    const r = lido.registro;
    const item = novoItem(i, lido, `${r.codigo ?? 'novo'} · ${r.nome}`);
    validarProduto(item, r);
    if (item.erros.length === 0) registrarRepetido(item, chaveProduto(r), vistos);
    if (item.erros.length === 0) casarProduto(item, r, idx);
    if (item.erros.length === 0) registrarEanPlu(item, r, eanVistos, pluVistos);
    return fechar(item);
  });
}

// EAN e PLU não podem aparecer em dois produtos diferentes do mesmo arquivo.
function registrarEanPlu(
  item: ItemConferencia<'produtos'>,
  r: RegProduto,
  eanVistos: Map<string, { origem: string; chave: string }>,
  pluVistos: Map<number, { origem: string; chave: string }>,
): void {
  const chave = chaveProduto(r);
  if (r.ean !== undefined) {
    const anterior = eanVistos.get(r.ean);
    if (anterior && anterior.chave !== chave) {
      item.erros.push(`EAN repetido no arquivo (igual à ${anterior.origem})`);
    } else if (!anterior) {
      eanVistos.set(r.ean, { origem: item.origem, chave });
    }
  }
  if (r.codigoBalanca !== undefined) {
    const anterior = pluVistos.get(r.codigoBalanca);
    if (anterior && anterior.chave !== chave) {
      item.erros.push(`PLU repetido no arquivo (igual à ${anterior.origem})`);
    } else if (!anterior) {
      pluVistos.set(r.codigoBalanca, { origem: item.origem, chave });
    }
  }
}

// ---------- Estoque ----------

interface IndiceLoteProdutos {
  codigo: Map<string, RegProduto>;
  ean: Map<string, RegProduto>;
  nome: Map<string, RegProduto>;
}

function indexarLoteProdutos(lote: LeituraLote | undefined): IndiceLoteProdutos {
  const idx: IndiceLoteProdutos = { codigo: new Map(), ean: new Map(), nome: new Map() };
  for (const l of lote?.registros.produtos ?? []) {
    if (l.erros.length > 0) continue;
    const p = l.registro;
    if (p.codigo && !idx.codigo.has(p.codigo)) idx.codigo.set(p.codigo, p);
    if (p.ean && !idx.ean.has(p.ean)) idx.ean.set(p.ean, p);
    const n = chaveTexto(p.nome);
    if (!idx.nome.has(n)) idx.nome.set(n, p);
  }
  return idx;
}

async function conferirEstoque(lidos: RegistroLido<'estoque'>[], ctx: ContextoConferencia): Promise<ItemConferencia<'estoque'>[]> {
  if (lidos.length === 0) return [];
  const produtos = await prisma.produto.findMany({ select: SEL_PRODUTO_MIN });
  const estoques = await prisma.estoqueLoja.findMany({
    where: { lojaId: ctx.lojaId },
    select: { produtoId: true, quantidade: true },
  });

  const saldos = new Map<number, number>();
  for (const e of estoques) saldos.set(e.produtoId, num(e.quantidade));

  const porCodigo = new Map<string, ProdutoMin>();
  const porEan = new Map<string, ProdutoMin>();
  const porNome = new Map<string, ProdutoMin[]>();
  for (const p of produtos) {
    porCodigo.set(p.codigo, p);
    if (p.ean) porEan.set(p.ean, p);
    adicionar(porNome, chaveTexto(p.nome), p);
  }
  const loteProd = indexarLoteProdutos(ctx.lote);

  const vistos = new Map<string, string>();
  return lidos.map((lido, i) => {
    const r: RegEstoque = lido.registro;
    const item = novoItem(i, lido, `${r.produto ?? r.nomeProduto ?? '(sem produto)'} · ${r.quantidade}`);
    if (!Number.isFinite(r.quantidade)) item.erros.push('Quantidade inválida');
    if (r.quantidade < 0) item.avisos.push('Quantidade negativa');
    if (r.custoUnitario !== undefined && r.custoUnitario < 0) item.erros.push('Custo unitário não pode ser negativo');
    if (item.erros.length > 0) return fechar(item);

    // Com `produto` preenchido, só código ou EAN. Nome só quando `produto` estiver vazio.
    let achado: ProdutoMin | undefined;
    if (r.produto !== undefined) {
      achado = porCodigo.get(r.produto) ?? porEan.get(r.produto);
    } else if (r.nomeProduto !== undefined) {
      const homonimos = porNome.get(chaveTexto(r.nomeProduto)) ?? [];
      if (homonimos.length === 1) achado = homonimos[0];
    }

    if (achado) {
      item.existenteId = achado.id;
      registrarRepetido(item, `prod:${achado.id}`, vistos);
      if (item.erros.length > 0) return fechar(item);
      const saldo = saldos.get(achado.id) ?? 0;
      if (valoresIguais(valorSimples(saldo), valorSimples(r.quantidade))) return fechar(item);
      if (saldo === 0) return fechar(item, 'novo');
      item.mudancas = [{ campo: 'quantidade', rotulo: 'Saldo na loja', de: valorSimples(saldo), para: valorSimples(r.quantidade) }];
      return fechar(item);
    }

    // Produto que será criado nesta mesma importação (lote), sem erro de leitura.
    const pelaLote =
      r.produto !== undefined
        ? loteProd.codigo.get(r.produto) ?? loteProd.ean.get(r.produto)
        : r.nomeProduto !== undefined
          ? loteProd.nome.get(chaveTexto(r.nomeProduto))
          : undefined;
    if (pelaLote) {
      item.avisos.push('O produto será criado nesta importação');
      registrarRepetido(item, `lote:${chaveProduto(pelaLote)}`, vistos);
      return fechar(item);
    }

    item.erros.push(`Produto não encontrado (${r.produto ?? r.nomeProduto ?? 'sem código'})`);
    return fechar(item);
  });
}

// ---------- Fiado ----------

interface IndiceLoteClientes {
  doc: Map<string, RegCliente>;
  codigo: Map<string, RegCliente>;
  nome: Map<string, RegCliente>;
}

// Clientes do lote (sem erro de leitura), para achar quem será criado nesta importação.
function indexarLoteClientes(lote: LeituraLote | undefined): IndiceLoteClientes {
  const idx: IndiceLoteClientes = { doc: new Map(), codigo: new Map(), nome: new Map() };
  for (const l of lote?.registros.clientes ?? []) {
    if (l.erros.length > 0) continue;
    const c = l.registro;
    if (c.cpfCnpj && !idx.doc.has(c.cpfCnpj)) idx.doc.set(c.cpfCnpj, c);
    if (c.codigoAntigo && !idx.codigo.has(c.codigoAntigo)) idx.codigo.set(c.codigoAntigo, c);
    const n = chaveTexto(c.nome);
    if (!idx.nome.has(n)) idx.nome.set(n, c);
  }
  return idx;
}

function buscarClienteLote(idx: IndiceLoteClientes, busca: Busca): RegCliente | undefined {
  return (
    (busca.doc !== undefined ? idx.doc.get(busca.doc) : undefined) ??
    (busca.codigo !== undefined ? idx.codigo.get(busca.codigo) : undefined) ??
    (busca.nome !== undefined ? idx.nome.get(chaveTexto(busca.nome)) : undefined)
  );
}

function fmtSaldo(v: number): string {
  return `R$ ${fmtMoeda(v)}`;
}

async function conferirFiado(lidos: RegistroLido<'fiado'>[], ctx: ContextoConferencia): Promise<ItemConferencia<'fiado'>[]> {
  if (lidos.length === 0) return [];
  const clientes = await prisma.cliente.findMany({ select: SEL_CLIENTE_MIN });
  const idx = indexar(clientes, (c) => c.cpfCnpj, (c) => c.codigoAntigo);
  const loteCli = indexarLoteClientes(ctx.lote);
  const vistos = new Map<string, string>();

  return lidos.map((lido, i) => {
    const r: RegFiado = lido.registro;
    const item = novoItem(i, lido, `${r.nomeCliente ?? r.cliente ?? '(sem cliente)'} · ${fmtSaldo(r.saldo)}`);
    if (!Number.isFinite(r.saldo) || r.saldo < 0) item.erros.push('Saldo não pode ser negativo');
    if (item.erros.length > 0) return fechar(item);

    // Com `cliente` preenchido, só documento ou código antigo. Nome só quando `cliente` estiver vazio.
    const busca: Busca =
      r.cliente !== undefined
        ? { doc: digitos(r.cliente), codigo: r.cliente }
        : { nome: r.nomeCliente };
    const achado = buscarPessoa(idx, busca);

    if (achado) {
      const c = achado.achado;
      item.existenteId = c.id;
      // Dois fiados do mesmo cliente: o aplicar somaria as duas diferenças sobre o mesmo saldo antigo.
      registrarRepetido(item, `cli:${c.id}`, vistos);
      if (item.erros.length > 0) return fechar(item);
      const saldoBanco = arred2(num(c.saldoDevedor));
      const saldo = arred2(r.saldo);
      if (saldo === saldoBanco) return fechar(item);
      if (saldoBanco === 0) return fechar(item, 'novo');
      if (saldo > saldoBanco) {
        item.mudancas = [{ campo: 'saldo', rotulo: 'Saldo devedor', de: saldoBanco, para: saldo }];
        return fechar(item);
      }
      item.erros.push(
        `O saldo do arquivo (${fmtSaldo(saldo)}) é menor que o atual (${fmtSaldo(saldoBanco)}). Para baixar, use Receber fiado na ficha do cliente.`,
      );
      return fechar(item);
    }

    const noLote = buscarClienteLote(loteCli, busca);
    if (noLote) {
      registrarRepetido(item, `lote:${chaveCliente(noLote)}`, vistos);
      if (item.erros.length > 0) return fechar(item);
      item.avisos.push('O cliente será criado nesta importação');
      return fechar(item, 'novo');
    }

    item.erros.push(`Cliente não encontrado (${r.cliente ?? r.nomeCliente ?? 'sem cliente'})`);
    return fechar(item);
  });
}

// ---------- Contas a pagar e a receber ----------

export function chaveConta(r: RegConta): string {
  return `migracao:${r.tipo}:${r.pessoa ?? chaveTexto(r.nomePessoa ?? '')}:${r.documento ?? ''}:${r.parcela ?? ''}:${r.vencimento}:${r.valor.toFixed(2)}`;
}

function validarConta(item: ItemConferencia<'contas'>, r: RegConta): void {
  if (!(r.valor > 0)) item.erros.push('Valor deve ser maior que zero');
  if (!dataIsoValida(r.vencimento)) item.erros.push('Vencimento inválido');
  if (r.descricao.length < 1 || r.descricao.length > 120) item.erros.push('Descrição deve ter de 1 a 120 caracteres');
}

async function buscarLancamentosJaImportados(chaves: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const unicas = [...new Set(chaves)];
  for (let i = 0; i < unicas.length; i += TAMANHO_LOTE_SQL) {
    const fatia = unicas.slice(i, i + TAMANHO_LOTE_SQL);
    const achados = await prisma.lancamento.findMany({
      where: { referencia: { in: fatia } },
      select: { id: true, referencia: true },
    });
    for (const l of achados) {
      if (l.referencia && !mapa.has(l.referencia)) mapa.set(l.referencia, l.id);
    }
  }
  return mapa;
}

async function conferirContas(lidos: RegistroLido<'contas'>[], ctx: ContextoConferencia): Promise<ItemConferencia<'contas'>[]> {
  if (lidos.length === 0) return [];
  const fornecedores = indexar(
    await prisma.fornecedor.findMany({ select: SEL_FORNECEDOR_MIN }),
    (f) => f.cnpj,
    (f) => f.codigoAntigo,
  );
  const clientes = indexar(
    await prisma.cliente.findMany({ select: SEL_CLIENTE_MIN }),
    (c) => c.cpfCnpj,
    (c) => c.codigoAntigo,
  );
  const loteForn = conjuntosLote(
    ctx.lote?.registros.fornecedores?.filter((l) => l.erros.length === 0).map((l) => l.registro),
    (f) => f.cnpj,
    (f) => f.codigoAntigo,
  );
  const loteCli = conjuntosLote(
    ctx.lote?.registros.clientes?.filter((l) => l.erros.length === 0).map((l) => l.registro),
    (c) => c.cpfCnpj,
    (c) => c.codigoAntigo,
  );

  const lancados = await buscarLancamentosJaImportados(
    lidos.filter((l) => l.erros.length === 0).map((l) => chaveConta(l.registro)),
  );
  const hoje = hojeIso();
  const vistos = new Map<string, string>();

  return lidos.map((lido, i) => {
    const r = lido.registro;
    const tipoTexto = r.tipo === 'PAGAR' ? 'A pagar' : 'A receber';
    const item = novoItem(i, lido, `${tipoTexto} · ${r.descricao} · vence ${dataBR(r.vencimento)} · R$ ${fmtMoeda(r.valor)}`);
    validarConta(item, r);
    if (item.erros.length === 0) {
      const chave = chaveConta(r);
      registrarRepetido(item, chave, vistos);
      if (item.erros.length === 0) {
        if (r.pessoa !== undefined || r.nomePessoa !== undefined) {
          // Com `pessoa` preenchida, só documento ou código. Nome só quando `pessoa` estiver vazia.
          const busca: Busca =
            r.pessoa !== undefined
              ? { doc: digitos(r.pessoa), codigo: r.pessoa }
              : { nome: r.nomePessoa };
          const ehPagar = r.tipo === 'PAGAR';
          const achou = ehPagar
            ? buscarPessoa(fornecedores, busca) !== null || estaNoLote(loteForn, busca)
            : buscarPessoa(clientes, busca) !== null || estaNoLote(loteCli, busca);
          if (!achou) {
            item.avisos.push(`${ehPagar ? 'Fornecedor' : 'Cliente'} "${r.pessoa ?? r.nomePessoa}" não encontrado; a conta entra sem vínculo`);
          }
        }
        if (r.vencimento < hoje) item.avisos.push(`Vencida em ${dataBR(r.vencimento)}`);
        const jaId = lancados.get(chave);
        if (jaId !== undefined) {
          item.existenteId = jaId;
          item.avisos.push('Já importada antes');
        }
      }
    }
    return fechar(item);
  });
}

// ---------- API pública ----------

async function conferirEntidade(
  entidade: Entidade,
  lidos: RegistroLido<Entidade>[],
  ctx: ContextoConferencia,
): Promise<ItemConferencia<Entidade>[]> {
  switch (entidade) {
    case 'fornecedores':
      return conferirFornecedores(lidos as unknown as RegistroLido<'fornecedores'>[]);
    case 'clientes':
      return conferirClientes(lidos as unknown as RegistroLido<'clientes'>[]);
    case 'produtos':
      return conferirProdutos(lidos as unknown as RegistroLido<'produtos'>[]);
    case 'estoque':
      return conferirEstoque(lidos as unknown as RegistroLido<'estoque'>[], ctx);
    case 'fiado':
      return conferirFiado(lidos as unknown as RegistroLido<'fiado'>[], ctx);
    case 'contas':
      return conferirContas(lidos as unknown as RegistroLido<'contas'>[], ctx);
  }
}

export async function conferir<E extends Entidade>(
  entidade: E,
  lidos: RegistroLido<E>[],
  ctx: ContextoConferencia,
): Promise<ItemConferencia<E>[]> {
  const saida = await conferirEntidade(entidade, lidos as unknown as RegistroLido<Entidade>[], ctx);
  return saida as unknown as ItemConferencia<E>[];
}

export async function conferirLote(leitura: LeituraLote, ctx: { lojaId: number }): Promise<LoteMigracao> {
  const entidades: Record<string, unknown> = {};
  for (const entidade of ORDEM_ENTIDADES) {
    const lidos = leitura.registros[entidade];
    if (!lidos) continue;
    const itens = await conferir(entidade, lidos as unknown as RegistroLido<Entidade>[], {
      lojaId: ctx.lojaId,
      lote: leitura,
    });
    entidades[entidade] = { itens, resumo: montarResumo(itens) };
  }
  return {
    fonte: leitura.fonte,
    descricao: leitura.descricao,
    avisos: leitura.avisos,
    entidades: entidades as LoteMigracao['entidades'],
  };
}

export function montarResumo(itens: ItemConferencia[]): ResumoEntidade {
  const resumo: ResumoEntidade = { total: itens.length, novos: 0, existentes: 0, iguais: 0, erros: 0 };
  for (const it of itens) {
    if (it.situacao === 'novo') resumo.novos++;
    else if (it.situacao === 'existe') resumo.existentes++;
    else if (it.situacao === 'igual') resumo.iguais++;
    else resumo.erros++;
  }
  return resumo;
}
