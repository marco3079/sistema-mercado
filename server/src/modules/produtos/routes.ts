import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { exigirAcao } from '../../lib/autorizacao';
import { lojaDaRequisicao } from '../../lib/lojas';
import { lerConfiguracao } from '../../lib/email';
import { arred2, arred3, arred4, num, numOuNull } from '../../lib/numeros';
import type { Tx } from '../../lib/estoque';
import {
  descreverPromocao,
  eanValido,
  gerarEtiquetaBalanca,
  lerEtiquetaBalanca,
  margemSobreVenda,
  promocoesVigentes,
  sugerirPrecoVenda,
} from '../../lib/precos';
import { alterarPreco } from './precos';

// Produtos, categorias, formação de preço, etiquetas de gôndola, balança (ITENSMGV.TXT) e higienização fiscal.
// O preço de venda só muda por alterarPreco (grava histórico e etiqueta pendente).

const router = Router();

const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'DZ'] as const;
const EDITORES = ['GESTOR', 'COMPRADOR', 'ESTOQUISTA'] as const;

const incluirCategoria = { categoria: { select: { nome: true } } } as const;
type ProdutoComCategoria = Prisma.ProdutoGetPayload<{ include: typeof incluirCategoria }>;

const CAMPOS = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do produto').max(120),
  codigo: z.string().trim().max(30).optional(),
  ean: z.string().trim().max(14).nullable().optional(),
  descricao: z.string().trim().max(500).nullable().optional(),
  marca: z.string().trim().max(60).nullable().optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  unidade: z.enum(UNIDADES).optional(),
  pesavel: z.boolean().optional(),
  codigoBalanca: z.number().int().min(1).max(99999).nullable().optional(),
  precoCusto: z.number().min(0).optional(),
  precoVenda: z.number().min(0).optional(),
  precoAtacado: z.number().min(0).nullable().optional(),
  qtdAtacado: z.number().min(0).nullable().optional(),
  estoqueMinimo: z.number().min(0).optional(),
  estoqueMaximo: z.number().min(0).nullable().optional(),
  pesoBrutoKg: z.number().min(0).nullable().optional(),
  ncm: z.string().trim().max(8).nullable().optional(),
  cest: z.string().trim().max(7).nullable().optional(),
  cfop: z.string().trim().max(4).nullable().optional(),
  csosn: z.string().trim().max(4).nullable().optional(),
  produzido: z.boolean().optional(),
  insumo: z.boolean().optional(),
  validadeDias: z.number().int().min(0).max(999).nullable().optional(),
  controlaLote: z.boolean().optional(),
  foto: z.string().trim().max(500).nullable().optional(),
  ativo: z.boolean().optional(),
});
// PUT: todos os campos são opcionais; o que não vier no corpo fica como está no banco.
const ATUALIZAR = CAMPOS.partial();

// ---------- Auxiliares ----------

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

function inteiro(valor: unknown): number | undefined {
  const t = texto(valor);
  return t !== undefined && /^\d+$/.test(t) ? Number(t) : undefined;
}

// Valor opcional arredondado: undefined e null passam como estão.
function opcional(valor: number | null | undefined, arredondar: (n: number) => number): number | null | undefined {
  return valor === null || valor === undefined ? valor : arredondar(valor);
}

// EAN vazio vira null; EAN preenchido precisa ser válido (EAN-8, 12, 13 ou 14).
function eanDe(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  if (!eanValido(valor)) throw new HttpError(400, 'EAN inválido');
  return valor;
}

// Próximo código interno: o maior código numérico + 1, com 6 dígitos.
async function proximoCodigo(tx: Tx): Promise<string> {
  const codigos = await tx.produto.findMany({ select: { codigo: true } });
  let maior = 0;
  for (const { codigo } of codigos) {
    if (/^\d+$/.test(codigo)) maior = Math.max(maior, Number(codigo));
  }
  return String(maior + 1).padStart(6, '0');
}

// Próximo PLU livre da balança (1 a 99999).
async function proximoPlu(tx: Tx): Promise<number> {
  const registros = await tx.produto.findMany({ where: { codigoBalanca: { not: null } }, select: { codigoBalanca: true } });
  const usados = new Set(registros.map((r) => r.codigoBalanca));
  for (let plu = 1; plu <= 99999; plu++) {
    if (!usados.has(plu)) return plu;
  }
  throw new HttpError(409, 'Não há PLU livre para a balança');
}

// Produto no formato da API, com o saldo da loja da requisição.
function paraDTO(p: ProdutoComCategoria, estoqueLoja: number) {
  const custo = num(p.precoCusto);
  const venda = num(p.precoVenda);
  return {
    id: p.id,
    codigo: p.codigo,
    ean: p.ean,
    nome: p.nome,
    descricao: p.descricao,
    marca: p.marca,
    categoriaId: p.categoriaId,
    categoria: p.categoria?.nome ?? null,
    unidade: p.unidade,
    pesavel: p.pesavel,
    codigoBalanca: p.codigoBalanca,
    precoCusto: custo,
    precoVenda: venda,
    precoAtacado: numOuNull(p.precoAtacado),
    qtdAtacado: numOuNull(p.qtdAtacado),
    margem: margemSobreVenda(custo, venda),
    estoqueMinimo: num(p.estoqueMinimo),
    estoqueMaximo: numOuNull(p.estoqueMaximo),
    pesoBrutoKg: numOuNull(p.pesoBrutoKg),
    ncm: p.ncm,
    cest: p.cest,
    cfop: p.cfop,
    csosn: p.csosn,
    produzido: p.produzido,
    insumo: p.insumo,
    validadeDias: p.validadeDias,
    controlaLote: p.controlaLote,
    foto: p.foto,
    ativo: p.ativo,
    fornecedorPadraoId: p.fornecedorPadraoId,
    estoqueLoja,
  };
}

// Monta a lista de produtos com o saldo da loja em uma consulta só.
async function paraDTOs(lista: ProdutoComCategoria[], lojaId: number) {
  if (lista.length === 0) return [];
  const estoques = await prisma.estoqueLoja.findMany({
    where: { lojaId, produtoId: { in: lista.map((p) => p.id) } },
    select: { produtoId: true, quantidade: true },
  });
  const saldo = new Map(estoques.map((e) => [e.produtoId, num(e.quantidade)]));
  return lista.map((p) => paraDTO(p, saldo.get(p.id) ?? 0));
}

async function dtoPorId(id: number, lojaId: number) {
  const produto = await prisma.produto.findUnique({ where: { id }, include: incluirCategoria });
  if (!produto) throw new HttpError(404, 'Produto não encontrado');
  const [dto] = await paraDTOs([produto], lojaId);
  return dto;
}

// Uma linha do arquivo ITENSMGV.TXT: PLU(6) TIPO(1) PRECO em centavos(6) VALIDADE(3) DESCRICAO(25) + CRLF.
function linhaBalanca(p: {
  codigoBalanca: number | null;
  unidade: string;
  precoVenda: Prisma.Decimal;
  validadeDias: number | null;
  nome: string;
}): string {
  const plu = String(p.codigoBalanca ?? 0).padStart(6, '0').slice(-6);
  const tipo = p.unidade === 'KG' || p.unidade === 'G' ? '0' : '1';
  const preco = String(Math.min(999999, Math.round(num(p.precoVenda) * 100))).padStart(6, '0');
  const validade = String(Math.min(999, p.validadeDias ?? 0)).padStart(3, '0');
  const descricao = p.nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .slice(0, 25)
    .padEnd(25, ' ');
  return `${plu}${tipo}${preco}${validade}${descricao}\r\n`;
}

// ---------- Categorias ----------

const CATEGORIA = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da categoria').max(60),
  ordem: z.number().int().min(0).max(9999).optional(),
  ativa: z.boolean().optional(),
  setor: z.string().trim().max(40).nullable().optional(),
});

async function categoriaComTotal(id: number) {
  const c = await prisma.categoria.findUnique({ where: { id }, include: { _count: { select: { produtos: true } } } });
  if (!c) throw new HttpError(404, 'Categoria não encontrada');
  return { id: c.id, nome: c.nome, ordem: c.ordem, ativa: c.ativa, setor: c.setor, totalProdutos: c._count.produtos };
}

router.get('/categorias', asyncHandler(async (_req, res) => {
  const lista = await prisma.categoria.findMany({
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    include: { _count: { select: { produtos: true } } },
  });
  res.json(
    lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      ordem: c.ordem,
      ativa: c.ativa,
      setor: c.setor,
      totalProdutos: c._count.produtos,
    })),
  );
}));

router.post('/categorias', permitir('GESTOR', 'COMPRADOR'), asyncHandler(async (req, res) => {
  const dados = validar(CATEGORIA, req.body);
  const criada = await prisma.categoria.create({
    data: {
      nome: dados.nome,
      ordem: dados.ordem ?? 0,
      ativa: dados.ativa ?? true,
      setor: dados.setor || null,
    },
  });
  res.status(201).json(await categoriaComTotal(criada.id));
}));

router.put('/categorias/:id', permitir('GESTOR', 'COMPRADOR'), asyncHandler(async (req, res) => {
  const id = idParam(req);
  const dados = validar(CATEGORIA.partial(), req.body);
  await prisma.categoria.update({
    where: { id },
    data: {
      nome: dados.nome,
      ordem: dados.ordem,
      ativa: dados.ativa,
      setor: dados.setor === undefined ? undefined : dados.setor || null,
    },
  });
  res.json(await categoriaComTotal(id));
}));

router.delete('/categorias/:id', permitir('GESTOR', 'COMPRADOR'), asyncHandler(async (req, res) => {
  const id = idParam(req);
  const total = await prisma.produto.count({ where: { categoriaId: id } });
  if (total > 0) {
    throw new HttpError(409, `A categoria tem ${total} produto(s). Mude os produtos de categoria antes de excluir.`);
  }
  await prisma.categoria.delete({ where: { id } });
  res.status(204).end();
}));

// ---------- Produtos: leitura ----------
// Rotas fixas (formacao-preco, higienizar-fiscal, codigo/:codigo) vêm antes de /produtos/:id.

router.get('/produtos', asyncHandler(async (req, res) => {
  const lojaId = await lojaDaRequisicao(req);
  const where: Prisma.ProdutoWhereInput = {};

  const busca = texto(req.query.busca);
  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      { codigo: { contains: busca, mode: 'insensitive' } },
      { ean: { contains: busca } },
      { marca: { contains: busca, mode: 'insensitive' } },
    ];
  }
  const categoriaId = inteiro(req.query.categoriaId);
  if (categoriaId !== undefined) where.categoriaId = categoriaId;

  // ativo: padrão só os ativos; '0' = inativos; 'todos' = sem filtro.
  const ativo = texto(req.query.ativo) ?? '1';
  if (ativo !== 'todos') where.ativo = ativo !== '0';

  for (const flag of ['insumo', 'produzido', 'pesavel'] as const) {
    const valor = texto(req.query[flag]);
    if (valor === '1' || valor === '0') where[flag] = valor === '1';
  }

  const pagina = Math.max(1, inteiro(req.query.pagina) ?? 1);
  const porPagina = Math.min(500, Math.max(1, inteiro(req.query.porPagina) ?? 50));

  const [total, lista] = await prisma.$transaction([
    prisma.produto.count({ where }),
    prisma.produto.findMany({
      where,
      include: incluirCategoria,
      orderBy: [{ nome: 'asc' }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);
  res.json({ itens: await paraDTOs(lista, lojaId), total });
}));

// Formação de preço: custo + margem. Sugestão arredondada (,49 / ,99) quando a configuração pede.
router.get('/produtos/formacao-preco', permitir('GESTOR', 'COMPRADOR'), asyncHandler(async (req, res) => {
  const cfg = await lerConfiguracao();
  const margemTexto = texto(req.query.margem);
  const margem = margemTexto === undefined ? num(cfg.margemPadrao) : Number(margemTexto.replace(',', '.'));
  if (!Number.isFinite(margem) || margem < 0 || margem > 1000) throw new HttpError(400, 'Margem inválida');
  const categoriaId = inteiro(req.query.categoriaId);

  const lista = await prisma.produto.findMany({
    where: { ativo: true, insumo: false, ...(categoriaId !== undefined ? { categoriaId } : {}) },
    orderBy: [{ nome: 'asc' }],
    select: { id: true, codigo: true, nome: true, precoCusto: true, precoVenda: true, categoria: { select: { nome: true } } },
  });
  res.json(
    lista.map((p) => {
      const custo = num(p.precoCusto);
      const venda = num(p.precoVenda);
      return {
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        categoria: p.categoria?.nome ?? null,
        precoCusto: custo,
        precoVenda: venda,
        margemAtual: margemSobreVenda(custo, venda),
        markupAtual: custo > 0 ? arred2(((venda - custo) / custo) * 100) : 0,
        precoSugerido: sugerirPrecoVenda(custo, margem, cfg.arredondarPreco),
      };
    }),
  );
}));

// Aplica novos preços em lote (cada um pelo alterarPreco). A ação ALTERAR_PRECO vale para o lote todo.
router.post('/produtos/formacao-preco', permitir('GESTOR', 'COMPRADOR'), asyncHandler(async (req, res) => {
  const dados = validar(
    z.object({
      itens: z
        .array(z.object({ produtoId: z.number().int().positive(), precoVenda: z.number().min(0) }))
        .min(1, 'Nenhum preço para alterar')
        .max(2000),
    }),
    req.body,
  );
  await exigirAcao(req, 'ALTERAR_PRECO');
  const alterados = await prisma.$transaction(async (tx) => {
    let total = 0;
    for (const item of dados.itens) {
      const resultado = await alterarPreco(tx, {
        produtoId: item.produtoId,
        precoVenda: item.precoVenda,
        usuarioId: req.usuario.id,
        motivo: 'Formação de preço',
      });
      if (resultado.mudouVenda) total++;
    }
    return total;
  });
  res.json({ alterados });
}));

// Higienização fiscal (Mix Fiscal simulado): preenche NCM, CFOP e CSOSN vazios com os padrões da configuração.
router.post('/produtos/higienizar-fiscal', permitir('GESTOR'), asyncHandler(async (_req, res) => {
  const cfg = await lerConfiguracao();
  const vazio = (v: string | null) => v === null || v.trim() === '';
  const produtos = await prisma.produto.findMany({
    where: {
      ativo: true,
      OR: [{ ncm: null }, { ncm: '' }, { cfop: null }, { cfop: '' }, { csosn: null }, { csosn: '' }],
    },
    select: { id: true, ncm: true, cfop: true, csosn: true },
  });
  await prisma.$transaction(
    produtos.map((p) =>
      prisma.produto.update({
        where: { id: p.id },
        data: {
          ncm: vazio(p.ncm) ? cfg.fiscalNcmPadrao : p.ncm,
          cfop: vazio(p.cfop) ? cfg.fiscalCfopPadrao : p.cfop,
          csosn: vazio(p.csosn) ? cfg.fiscalCsosnPadrao : p.csosn,
        },
      }),
    ),
  );
  res.json({ atualizados: produtos.length, simulado: true });
}));

// Busca por código de barras, código interno ou etiqueta de balança (PLU).
router.get('/produtos/codigo/:codigo', asyncHandler(async (req, res) => {
  const codigo = String(req.params.codigo ?? '').trim();
  const lojaId = await lojaDaRequisicao(req);

  let produto: ProdutoComCategoria | null = await prisma.produto.findFirst({ where: { ean: codigo }, include: incluirCategoria });
  if (!produto) {
    produto = await prisma.produto.findFirst({ where: { codigo }, include: incluirCategoria });
  }
  let balanca: { modo: string; valor: number } | null = null;
  if (!produto) {
    const cfg = await lerConfiguracao();
    const leitura = lerEtiquetaBalanca(codigo, cfg.balancaPrefixo, cfg.balancaModo);
    if (leitura) {
      produto = await prisma.produto.findFirst({ where: { codigoBalanca: leitura.plu }, include: incluirCategoria });
      balanca = { modo: leitura.modo, valor: leitura.valor };
    }
  }
  if (!produto) throw new HttpError(404, 'Produto não encontrado');

  const [dto] = await paraDTOs([produto], lojaId);
  res.json({ ...dto, balanca });
}));

router.get('/produtos/:id', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const lojaId = await lojaDaRequisicao(req);
  const produto = await prisma.produto.findUnique({
    where: { id },
    include: {
      categoria: { select: { nome: true } },
      historicoPrecos: { orderBy: { criadoEm: 'desc' }, take: 20 },
      fornecedores: { include: { fornecedor: { select: { nome: true } } } },
    },
  });
  if (!produto) throw new HttpError(404, 'Produto não encontrado');
  const [dto] = await paraDTOs([produto], lojaId);
  res.json({
    ...dto,
    historicoPrecos: produto.historicoPrecos.map((h) => ({
      criadoEm: h.criadoEm.toISOString(),
      precoAnterior: num(h.precoAnterior),
      precoNovo: num(h.precoNovo),
      custoAnterior: numOuNull(h.custoAnterior),
      custoNovo: numOuNull(h.custoNovo),
    })),
    fornecedores: produto.fornecedores.map((f) => ({
      fornecedorId: f.fornecedorId,
      nome: f.fornecedor.nome,
      codigoFornecedor: f.codigoFornecedor,
      ultimoPreco: numOuNull(f.ultimoPreco),
    })),
  });
}));

// ---------- Produtos: escrita ----------

router.post('/produtos', permitir(...EDITORES), asyncHandler(async (req, res) => {
  const dados = validar(CAMPOS, req.body);
  const ean = eanDe(dados.ean);
  const lojaId = await lojaDaRequisicao(req);

  const id = await prisma.$transaction(async (tx) => {
    const codigo = dados.codigo || (await proximoCodigo(tx));
    const pesavel = dados.pesavel ?? false;
    const codigoBalanca = dados.codigoBalanca ?? (pesavel ? await proximoPlu(tx) : null);
    const criado = await tx.produto.create({
      data: {
        codigo,
        ean: ean ?? null,
        nome: dados.nome,
        descricao: dados.descricao ?? null,
        marca: dados.marca ?? null,
        categoriaId: dados.categoriaId ?? null,
        unidade: dados.unidade ?? 'UN',
        pesavel,
        codigoBalanca,
        // No cadastro novo o preço inicial grava direto (sem histórico de alteração).
        precoCusto: arred4(dados.precoCusto ?? 0),
        precoVenda: arred2(dados.precoVenda ?? 0),
        precoAtacado: opcional(dados.precoAtacado, arred2) ?? null,
        qtdAtacado: opcional(dados.qtdAtacado, arred3) ?? null,
        estoqueMinimo: dados.estoqueMinimo ?? 0,
        estoqueMaximo: dados.estoqueMaximo ?? null,
        pesoBrutoKg: dados.pesoBrutoKg ?? null,
        ncm: dados.ncm ?? null,
        cest: dados.cest ?? null,
        cfop: dados.cfop ?? null,
        csosn: dados.csosn ?? null,
        produzido: dados.produzido ?? false,
        insumo: dados.insumo ?? false,
        validadeDias: dados.validadeDias ?? null,
        controlaLote: dados.controlaLote ?? false,
        foto: dados.foto ?? null,
        ativo: dados.ativo ?? true,
      },
    });
    return criado.id;
  });
  res.status(201).json(await dtoPorId(id, lojaId));
}));

router.put('/produtos/:id', permitir(...EDITORES), asyncHandler(async (req, res) => {
  const id = idParam(req);
  const dados = validar(ATUALIZAR, req.body);
  if (dados.codigo === '') throw new HttpError(400, 'Informe o código do produto');
  const ean = eanDe(dados.ean);
  const lojaId = await lojaDaRequisicao(req);

  const atual = await prisma.produto.findUnique({
    where: { id },
    select: { precoCusto: true, precoVenda: true, pesavel: true, codigoBalanca: true },
  });
  if (!atual) throw new HttpError(404, 'Produto não encontrado');

  // Preço só muda pelo alterarPreco, e só com a ação ALTERAR_PRECO liberada para quem está logado.
  const mudaVenda = dados.precoVenda !== undefined && arred2(dados.precoVenda) !== num(atual.precoVenda);
  const mudaCusto = dados.precoCusto !== undefined && arred4(dados.precoCusto) !== num(atual.precoCusto);
  if (mudaVenda || mudaCusto) await exigirAcao(req, 'ALTERAR_PRECO');

  await prisma.$transaction(async (tx) => {
    const pesavel = dados.pesavel ?? atual.pesavel;
    let codigoBalanca = dados.codigoBalanca !== undefined ? dados.codigoBalanca : atual.codigoBalanca;
    if (pesavel && codigoBalanca === null) codigoBalanca = await proximoPlu(tx);

    await tx.produto.update({
      where: { id },
      data: {
        codigo: dados.codigo,
        ean,
        nome: dados.nome,
        descricao: dados.descricao,
        marca: dados.marca,
        categoriaId: dados.categoriaId,
        unidade: dados.unidade,
        pesavel,
        codigoBalanca,
        precoAtacado: opcional(dados.precoAtacado, arred2),
        qtdAtacado: opcional(dados.qtdAtacado, arred3),
        estoqueMinimo: dados.estoqueMinimo,
        estoqueMaximo: dados.estoqueMaximo,
        pesoBrutoKg: dados.pesoBrutoKg,
        ncm: dados.ncm,
        cest: dados.cest,
        cfop: dados.cfop,
        csosn: dados.csosn,
        produzido: dados.produzido,
        insumo: dados.insumo,
        validadeDias: dados.validadeDias,
        controlaLote: dados.controlaLote,
        foto: dados.foto,
        ativo: dados.ativo,
      },
    });

    if (mudaVenda || mudaCusto) {
      await alterarPreco(tx, {
        produtoId: id,
        precoVenda: dados.precoVenda ?? num(atual.precoVenda),
        precoCusto: dados.precoCusto ?? null,
        usuarioId: req.usuario.id,
        motivo: 'Alteração no cadastro',
      });
    }
  });
  res.json(await dtoPorId(id, lojaId));
}));

// Troca só o preço (com motivo opcional). Quem não é gestor passa pela regra ALTERAR_PRECO.
router.put('/produtos/:id/preco', permitir('GESTOR', 'COMPRADOR', 'ESTOQUISTA', 'OPERADOR'), asyncHandler(async (req, res) => {
  const id = idParam(req);
  const dados = validar(
    z.object({
      precoVenda: z.number().min(0),
      precoCusto: z.number().min(0).nullable().optional(),
      motivo: z.string().trim().max(120).nullable().optional(),
    }),
    req.body,
  );
  const lojaId = await lojaDaRequisicao(req);
  await exigirAcao(req, 'ALTERAR_PRECO');
  const resultado = await prisma.$transaction((tx) =>
    alterarPreco(tx, {
      produtoId: id,
      precoVenda: dados.precoVenda,
      precoCusto: dados.precoCusto ?? null,
      usuarioId: req.usuario.id,
      motivo: dados.motivo ?? null,
    }),
  );
  res.json({ mudouVenda: resultado.mudouVenda, produto: await dtoPorId(id, lojaId) });
}));

// ---------- Etiquetas de gôndola ----------

router.get('/etiquetas', permitir(...EDITORES), asyncHandler(async (req, res) => {
  const pendentes = texto(req.query.pendentes) === '1';
  const lista = await prisma.etiquetaPendente.findMany({
    where: pendentes ? { impressaEm: null } : {},
    include: { produto: true },
    orderBy: { criadoEm: 'asc' },
  });
  const promocoes = await promocoesVigentes(lista.map((e) => ({ id: e.produto.id, categoriaId: e.produto.categoriaId })));
  res.json(
    lista.map((e) => {
      const p = e.produto;
      const promo = promocoes.find(
        (pr) => pr.produtoId === p.id || (pr.produtoId === null && pr.categoriaId !== null && pr.categoriaId === p.categoriaId),
      );
      return {
        id: e.id,
        produtoId: p.id,
        codigo: p.codigo,
        ean: p.ean,
        nome: p.nome,
        unidade: p.unidade,
        precoVenda: num(p.precoVenda),
        precoAtacado: numOuNull(p.precoAtacado),
        qtdAtacado: numOuNull(p.qtdAtacado),
        promocao: promo ? descreverPromocao(promo) : null,
        motivo: e.motivo,
        criadoEm: e.criadoEm.toISOString(),
      };
    }),
  );
}));

router.post('/etiquetas', permitir(...EDITORES), asyncHandler(async (req, res) => {
  const dados = validar(
    z.object({ produtoIds: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um produto').max(500) }),
    req.body,
  );
  const ids = Array.from(new Set(dados.produtoIds));
  const existentes = await prisma.produto.count({ where: { id: { in: ids } } });
  if (existentes !== ids.length) throw new HttpError(400, 'Algum produto não existe');
  const criadas = await prisma.etiquetaPendente.createMany({
    data: ids.map((produtoId) => ({ produtoId, motivo: 'Manual' })),
  });
  res.status(201).json({ criadas: criadas.count });
}));

router.post('/etiquetas/imprimir', permitir(...EDITORES), asyncHandler(async (req, res) => {
  const dados = validar(
    z.object({ ids: z.array(z.number().int().positive()).min(1, 'Escolha ao menos uma etiqueta').max(1000) }),
    req.body,
  );
  const resultado = await prisma.etiquetaPendente.updateMany({
    where: { id: { in: dados.ids }, impressaEm: null },
    data: { impressaEm: new Date() },
  });
  res.json({ impressas: resultado.count });
}));

// ---------- Balança ----------

router.get('/balanca/exportar', permitir('GESTOR', 'ESTOQUISTA'), asyncHandler(async (_req, res) => {
  const produtos = await prisma.produto.findMany({
    where: { pesavel: true, ativo: true, codigoBalanca: { not: null } },
    orderBy: { codigoBalanca: 'asc' },
    select: { codigoBalanca: true, unidade: true, precoVenda: true, validadeDias: true, nome: true },
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ITENSMGV.TXT"');
  res.send(produtos.map(linhaBalanca).join(''));
}));

router.get('/balanca/produtos', permitir('GESTOR', 'ESTOQUISTA'), asyncHandler(async (_req, res) => {
  const produtos = await prisma.produto.findMany({
    where: { pesavel: true, ativo: true, codigoBalanca: { not: null } },
    orderBy: { codigoBalanca: 'asc' },
    select: { id: true, nome: true, unidade: true, codigoBalanca: true, precoVenda: true, validadeDias: true },
  });
  res.json(
    produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      unidade: p.unidade,
      plu: p.codigoBalanca,
      precoVenda: num(p.precoVenda),
      validadeDias: p.validadeDias,
    })),
  );
}));

// Simula a etiqueta que a balança gera para um peso (para testar no PDV).
router.post('/balanca/simular-etiqueta', permitir('GESTOR', 'ESTOQUISTA'), asyncHandler(async (req, res) => {
  const dados = validar(
    z.object({ produtoId: z.number().int().positive(), pesoKg: z.number().positive().max(999) }),
    req.body,
  );
  const produto = await prisma.produto.findUnique({
    where: { id: dados.produtoId },
    select: { pesavel: true, codigoBalanca: true, precoVenda: true },
  });
  if (!produto) throw new HttpError(404, 'Produto não encontrado');
  if (!produto.pesavel || produto.codigoBalanca === null) {
    throw new HttpError(400, 'Produto não é pesável ou não tem PLU de balança');
  }
  const cfg = await lerConfiguracao();
  const total = arred2(num(produto.precoVenda) * dados.pesoKg);
  const valor = cfg.balancaModo === 'PESO' ? dados.pesoKg : total;
  const codigo = gerarEtiquetaBalanca(cfg.balancaPrefixo, produto.codigoBalanca, valor, cfg.balancaModo);
  res.json({ codigo, total, pesoKg: dados.pesoKg });
}));

export default router;
