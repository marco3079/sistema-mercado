import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/erros';
import { arred2, arred3, num } from '../../lib/numeros';
import { movimentarEstoque, saldoDe, type Tx } from '../../lib/estoque';
import { alterarPreco } from '../produtos/precos';
import { chaveConta, conferir } from './conferir';
import { chaveTexto } from './normalizar';
import type {
  Entidade,
  ItemAplicar,
  Registro,
  RegCliente,
  RegConta,
  RegEstoque,
  RegFiado,
  RegFornecedor,
  RegProduto,
  ResultadoAplicar,
  Situacao,
} from './tipos';

// Aplica os itens já decididos pelo gestor no banco.
// Confere de novo (sem lote) e grava cada criação/atualização na sua própria transação.
// Só grava campos presentes no registro; na atualização, campos ausentes ficam como estão.

export interface ContextoAplicar {
  lojaId: number;
  usuarioId: number;
}

type Desfecho = 'criado' | 'atualizado' | 'ignorado';

// Dados lidos uma vez por chamada (categorias, nomes de fornecedores e clientes).
interface Apoio {
  categorias: Map<string, number>; // chaveTexto(nome) -> id
  fornecedoresPorNome: Map<string, number | null>; // null = nome repetido
  clientesPorNome: Map<string, number | null>; // null = nome repetido
}

export async function aplicar<E extends Entidade>(
  entidade: E,
  itens: ItemAplicar<E>[],
  ctx: ContextoAplicar,
): Promise<ResultadoAplicar> {
  const lidos = itens.map((i) => ({
    origem: i.origem,
    registro: i.registro,
    erros: [] as string[],
    avisos: [] as string[],
  }));
  const conferidos = await conferir(entidade, lidos, { lojaId: ctx.lojaId });
  const apoio = await carregarApoio(entidade);
  const resultado: ResultadoAplicar = { criados: 0, atualizados: 0, ignorados: 0, erros: [] };

  for (let k = 0; k < itens.length; k++) {
    const item = itens[k];
    const conf = conferidos[k];
    if (conf.situacao === 'erro') {
      resultado.erros.push({ origem: item.origem, mensagem: conf.erros.join('; ') });
      continue;
    }
    if (conf.situacao === 'igual') {
      resultado.ignorados++;
      continue;
    }
    if (conf.situacao === 'existe' && item.decisao !== 'atualizar') {
      resultado.ignorados++;
      continue;
    }
    try {
      const desfecho = await gravar(entidade, item.registro, conf.situacao, conf.existenteId, ctx, apoio);
      if (desfecho === 'criado') resultado.criados++;
      else if (desfecho === 'atualizado') resultado.atualizados++;
      else resultado.ignorados++;
    } catch (e) {
      resultado.erros.push({ origem: item.origem, mensagem: mensagemDeErro(e) });
    }
  }
  return resultado;
}

async function carregarApoio(entidade: Entidade): Promise<Apoio> {
  const apoio: Apoio = { categorias: new Map(), fornecedoresPorNome: new Map(), clientesPorNome: new Map() };
  if (entidade === 'produtos') {
    const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true } });
    for (const c of categorias) {
      const chave = chaveTexto(c.nome);
      if (!apoio.categorias.has(chave)) apoio.categorias.set(chave, c.id);
    }
  }
  if (entidade === 'contas') {
    const fornecedores = await prisma.fornecedor.findMany({ select: { id: true, nome: true } });
    const clientes = await prisma.cliente.findMany({ select: { id: true, nome: true } });
    apoio.fornecedoresPorNome = porNome(fornecedores);
    apoio.clientesPorNome = porNome(clientes);
  }
  return apoio;
}

function porNome(lista: { id: number; nome: string }[]): Map<string, number | null> {
  const mapa = new Map<string, number | null>();
  for (const x of lista) {
    const chave = chaveTexto(x.nome);
    mapa.set(chave, mapa.has(chave) ? null : x.id);
  }
  return mapa;
}

async function gravar(
  entidade: Entidade,
  registro: Registro,
  situacao: Situacao,
  existenteId: number | null,
  ctx: ContextoAplicar,
  apoio: Apoio,
): Promise<Desfecho> {
  const criar = situacao === 'novo';
  switch (entidade) {
    case 'fornecedores':
      return gravarFornecedor(registro as RegFornecedor, criar, existenteId);
    case 'clientes':
      return gravarCliente(registro as RegCliente, criar, existenteId);
    case 'produtos':
      return gravarProduto(registro as RegProduto, criar, existenteId, ctx, apoio);
    case 'estoque':
      return gravarEstoque(registro as RegEstoque, situacao, existenteId, ctx);
    case 'fiado':
      return gravarFiado(registro as RegFiado, situacao, existenteId, ctx);
    case 'contas':
      return gravarConta(registro as RegConta, ctx, apoio);
  }
}

// ---------- Fornecedores e clientes ----------

async function gravarFornecedor(reg: RegFornecedor, criar: boolean, id: number | null): Promise<Desfecho> {
  return prisma.$transaction<Desfecho>(async (tx) => {
    if (criar) {
      await tx.fornecedor.create({ data: { ...reg, ativo: reg.ativo ?? true } });
      return 'criado';
    }
    if (id === null) throw new HttpError(404, 'Fornecedor não encontrado');
    await tx.fornecedor.update({ where: { id }, data: { ...reg } });
    return 'atualizado';
  });
}

async function gravarCliente(reg: RegCliente, criar: boolean, id: number | null): Promise<Desfecho> {
  return prisma.$transaction<Desfecho>(async (tx) => {
    if (criar) {
      await tx.cliente.create({ data: { ...reg, tipo: reg.tipo ?? 'VAREJO', ativo: reg.ativo ?? true } });
      return 'criado';
    }
    if (id === null) throw new HttpError(404, 'Cliente não encontrado');
    await tx.cliente.update({ where: { id }, data: { ...reg } });
    return 'atualizado';
  });
}

// ---------- Produtos ----------

async function gravarProduto(
  reg: RegProduto,
  criar: boolean,
  id: number | null,
  ctx: ContextoAplicar,
  apoio: Apoio,
): Promise<Desfecho> {
  // Categoria fica fora da transação do produto: se houver corrida (P2002), a transação não é abortada.
  const categoriaId = reg.categoria !== undefined ? await categoriaDe(reg.categoria, apoio) : undefined;

  return prisma.$transaction<Desfecho>(
    async (tx) => {
      const fornecedor = reg.fornecedorCnpj
        ? await tx.fornecedor.findUnique({ where: { cnpj: reg.fornecedorCnpj }, select: { id: true } })
        : null;

      if (criar) {
        const pesavel = reg.pesavel ?? false;
        const produto = await tx.produto.create({
          data: {
            codigo: reg.codigo ?? (await proximoCodigo(tx)),
            ean: reg.ean ?? null,
            nome: reg.nome,
            descricao: reg.descricao ?? null,
            marca: reg.marca ?? null,
            categoriaId: categoriaId ?? null,
            unidade: reg.unidade ?? 'UN',
            pesavel,
            codigoBalanca: reg.codigoBalanca ?? (pesavel ? await proximoPlu(tx) : null),
            precoCusto: reg.precoCusto ?? 0,
            precoVenda: reg.precoVenda ?? 0,
            precoAtacado: reg.precoAtacado ?? null,
            qtdAtacado: reg.qtdAtacado ?? null,
            estoqueMinimo: reg.estoqueMinimo ?? 0,
            estoqueMaximo: reg.estoqueMaximo ?? null,
            validadeDias: reg.validadeDias ?? null,
            pesoBrutoKg: reg.pesoBrutoKg ?? null,
            ncm: reg.ncm ?? null,
            cest: reg.cest ?? null,
            cfop: reg.cfop ?? null,
            csosn: reg.csosn ?? null,
            insumo: reg.insumo ?? false,
            produzido: reg.produzido ?? false,
            ativo: reg.ativo ?? true,
          },
        });
        if (fornecedor) {
          await vincularFornecedor(tx, produto.id, fornecedor.id, reg);
        }
        return 'criado';
      }

      if (id === null) throw new HttpError(404, 'Produto não encontrado');
      const atual = await tx.produto.findUnique({
        where: { id },
        select: { id: true, precoVenda: true },
      });
      if (!atual) throw new HttpError(404, 'Produto não encontrado');

      // Preço de venda só muda por alterarPreco (histórico e etiqueta pendente).
      let precoPorAlterarPreco = false;
      if (reg.precoVenda !== undefined && arred2(reg.precoVenda) !== num(atual.precoVenda)) {
        await alterarPreco(tx, {
          produtoId: id,
          precoVenda: reg.precoVenda,
          precoCusto: reg.precoCusto ?? null,
          usuarioId: ctx.usuarioId,
          motivo: 'Migração de dados',
        });
        precoPorAlterarPreco = true;
      }

      // Código nunca muda; preço de venda já foi tratado acima.
      const data: Prisma.ProdutoUncheckedUpdateInput = semUndefined({
        ean: reg.ean,
        nome: reg.nome,
        descricao: reg.descricao,
        marca: reg.marca,
        categoriaId,
        unidade: reg.unidade,
        pesavel: reg.pesavel,
        codigoBalanca: reg.codigoBalanca,
        precoCusto: precoPorAlterarPreco ? undefined : reg.precoCusto,
        precoAtacado: reg.precoAtacado,
        qtdAtacado: reg.qtdAtacado,
        estoqueMinimo: reg.estoqueMinimo,
        estoqueMaximo: reg.estoqueMaximo,
        validadeDias: reg.validadeDias,
        pesoBrutoKg: reg.pesoBrutoKg,
        ncm: reg.ncm,
        cest: reg.cest,
        cfop: reg.cfop,
        csosn: reg.csosn,
        insumo: reg.insumo,
        produzido: reg.produzido,
        ativo: reg.ativo,
      });
      if (Object.keys(data).length > 0) {
        await tx.produto.update({ where: { id }, data });
      }
      if (fornecedor) {
        await vincularFornecedor(tx, id, fornecedor.id, reg);
      }
      return 'atualizado';
    },
    { timeout: 30000 },
  );
}

// Vínculo produto x fornecedor (ProdutoFornecedor) e fornecedor padrão, se o produto não tiver.
async function vincularFornecedor(tx: Tx, produtoId: number, fornecedorId: number, reg: RegProduto): Promise<void> {
  const atualizacao: Prisma.ProdutoFornecedorUncheckedUpdateInput = semUndefined({
    codigoFornecedor: reg.codigoFornecedor,
    ultimoPreco: reg.precoCusto,
  });
  await tx.produtoFornecedor.upsert({
    where: { produtoId_fornecedorId: { produtoId, fornecedorId } },
    create: {
      produtoId,
      fornecedorId,
      codigoFornecedor: reg.codigoFornecedor ?? null,
      ultimoPreco: reg.precoCusto ?? null,
    },
    update: atualizacao,
  });
  await tx.produto.updateMany({
    where: { id: produtoId, fornecedorPadraoId: null },
    data: { fornecedorPadraoId: fornecedorId },
  });
}

// Próximo código de 6 dígitos: maior código só-dígitos + 1, pulando os já usados.
async function proximoCodigo(tx: Tx): Promise<string> {
  const [linha] = await tx.$queryRaw<{ maior: bigint | null }[]>`SELECT MAX(CAST(codigo AS BIGINT)) AS maior FROM "Produto" WHERE codigo ~ '^[0-9]{1,15}$'`;
  let n = Number(linha?.maior ?? 0) + 1;
  while (await tx.produto.findUnique({ where: { codigo: pad6(n) }, select: { id: true } })) n++;
  return pad6(n);
}

// Próximo PLU livre (1 a 99999).
async function proximoPlu(tx: Tx): Promise<number> {
  const usados = await tx.produto.findMany({ where: { codigoBalanca: { not: null } }, select: { codigoBalanca: true } });
  const ocupados = new Set(usados.map((p) => p.codigoBalanca));
  for (let plu = 1; plu <= 99999; plu++) {
    if (!ocupados.has(plu)) return plu;
  }
  throw new HttpError(409, 'Não há PLU livre para a balança');
}

// Acha a categoria pelo nome (sem diferenciar maiúsculas e acentos) ou cria.
async function categoriaDe(nome: string, apoio: Apoio): Promise<number> {
  const limpo = nome.trim();
  const chave = chaveTexto(limpo);
  const achada = apoio.categorias.get(chave);
  if (achada !== undefined) return achada;
  try {
    const criada = await prisma.categoria.create({ data: { nome: limpo }, select: { id: true } });
    apoio.categorias.set(chave, criada.id);
    return criada.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existente = await prisma.categoria.findUnique({ where: { nome: limpo }, select: { id: true } });
      if (existente) {
        apoio.categorias.set(chave, existente.id);
        return existente.id;
      }
    }
    throw e;
  }
}

// ---------- Estoque inicial ----------

async function gravarEstoque(
  reg: RegEstoque,
  situacao: Situacao,
  produtoId: number | null,
  ctx: ContextoAplicar,
): Promise<Desfecho> {
  if (produtoId === null) throw new HttpError(400, 'Produto não encontrado');
  return prisma.$transaction<Desfecho>(async (tx) => {
    const saldo = await saldoDe(produtoId, ctx.lojaId, tx);
    const dif = arred3(reg.quantidade - saldo);
    if (dif !== 0) {
      await movimentarEstoque(tx, {
        produtoId,
        lojaId: ctx.lojaId,
        tipo: 'AJUSTE',
        quantidade: dif,
        custoUnitario: reg.custoUnitario ?? null,
        motivo: 'Migração de dados (saldo inicial)',
        referencia: 'migracao',
        usuarioId: ctx.usuarioId,
      });
    }
    if ((reg.custoUnitario ?? 0) > 0) {
      const produto = await tx.produto.findUnique({ where: { id: produtoId }, select: { precoCusto: true } });
      if (produto && num(produto.precoCusto) === 0) {
        await tx.produto.update({ where: { id: produtoId }, data: { precoCusto: reg.custoUnitario } });
      }
    }
    return situacao === 'novo' ? 'criado' : 'atualizado';
  });
}

// ---------- Saldo de fiado ----------

async function gravarFiado(
  reg: RegFiado,
  situacao: Situacao,
  clienteId: number | null,
  ctx: ContextoAplicar,
): Promise<Desfecho> {
  if (clienteId === null) throw new HttpError(400, 'Cliente não encontrado');
  return prisma.$transaction<Desfecho>(async (tx) => {
    const cliente = await tx.cliente.findUnique({
      where: { id: clienteId },
      select: { id: true, nome: true, saldoDevedor: true },
    });
    if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
    const dif = arred2(reg.saldo - num(cliente.saldoDevedor));
    if (dif <= 0) return 'ignorado';

    await tx.cliente.update({ where: { id: clienteId }, data: { saldoDevedor: { increment: dif } } });
    await tx.movimentoFiado.create({
      data: {
        clienteId,
        tipo: 'COMPRA',
        valor: dif,
        descricao: reg.descricao ?? 'Saldo migrado do sistema anterior',
        usuarioId: ctx.usuarioId,
      },
    });
    await tx.lancamento.create({
      data: {
        tipo: 'RECEITA',
        origem: 'FIADO',
        descricao: `Fiado migrado - ${cliente.nome}`,
        valor: dif,
        vencimento: hojeAoMeioDia(),
        clienteId,
        lojaId: ctx.lojaId,
        referencia: 'migracao:fiado',
      },
    });
    return situacao === 'novo' ? 'criado' : 'atualizado';
  });
}

// ---------- Contas a pagar e a receber ----------

async function gravarConta(reg: RegConta, ctx: ContextoAplicar, apoio: Apoio): Promise<Desfecho> {
  const pessoaId = await acharPessoa(reg, apoio);
  const tipo = reg.tipo === 'PAGAR' ? 'DESPESA' : 'RECEITA';
  return prisma.$transaction<Desfecho>(async (tx) => {
    const categoriaId =
      reg.categoria !== undefined
        ? (
            await tx.categoriaFinanceira.upsert({
              where: { nome_tipo: { nome: reg.categoria, tipo } },
              create: { nome: reg.categoria, tipo },
              update: {},
              select: { id: true },
            })
          ).id
        : null;

    await tx.lancamento.create({
      data: {
        tipo,
        origem: 'MANUAL',
        descricao: reg.descricao,
        valor: reg.valor,
        vencimento: diaAoMeioDia(reg.vencimento),
        documento: reg.documento ?? null,
        parcela: reg.parcela ?? null,
        totalParcelas: reg.totalParcelas ?? null,
        fornecedorId: reg.tipo === 'PAGAR' ? pessoaId : null,
        clienteId: reg.tipo === 'RECEBER' ? pessoaId : null,
        categoriaId,
        lojaId: ctx.lojaId,
        observacao: reg.observacao ?? null,
        referencia: chaveConta(reg),
      },
    });
    return 'criado';
  });
}

// PAGAR: fornecedor; RECEBER: cliente. Procura pelo documento/código antigo e depois pelo nome (único).
async function acharPessoa(reg: RegConta, apoio: Apoio): Promise<number | null> {
  if (reg.tipo === 'PAGAR') {
    if (reg.pessoa) {
      const achado = await prisma.fornecedor.findFirst({
        where: { OR: [{ cnpj: reg.pessoa }, { codigoAntigo: reg.pessoa }] },
        select: { id: true },
      });
      return achado ? achado.id : null; // documento informado: o nome não é usado (mesma regra da conferência)
    }
    const porNomeId = reg.nomePessoa ? apoio.fornecedoresPorNome.get(chaveTexto(reg.nomePessoa)) : undefined;
    return typeof porNomeId === 'number' ? porNomeId : null;
  }
  if (reg.pessoa) {
    const achado = await prisma.cliente.findFirst({
      where: { OR: [{ cpfCnpj: reg.pessoa }, { codigoAntigo: reg.pessoa }] },
      select: { id: true },
    });
    return achado ? achado.id : null; // documento informado: o nome não é usado (mesma regra da conferência)
  }
  const porNomeId = reg.nomePessoa ? apoio.clientesPorNome.get(chaveTexto(reg.nomePessoa)) : undefined;
  return typeof porNomeId === 'number' ? porNomeId : null;
}

// ---------- Auxiliares ----------

function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

function semUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

// Dia AAAA-MM-DD ao meio-dia (evita cair no dia anterior por causa do fuso).
function diaAoMeioDia(dia: string): Date {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(ano, mes - 1, d, 12, 0, 0, 0);
}

function hojeAoMeioDia(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 12, 0, 0, 0);
}

// Mensagem curta para o usuário; P2002 diz qual campo repetiu.
function mensagemDeErro(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const alvo = e.meta?.target;
    let campo = 'dado informado';
    if (Array.isArray(alvo) && alvo.length > 0) campo = String(alvo[0]);
    else if (typeof alvo === 'string') campo = alvo.split('_')[1] ?? alvo;
    return `Já existe um cadastro com o mesmo ${campo}`;
  }
  const texto = e instanceof Error ? e.message : String(e);
  return `Erro ao gravar: ${texto.split('\n')[0].slice(0, 200)}`;
}
