import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { arred2, fimDoDia, inicioDoDia, num, numOuNull, periodoDaQuery, somarDias } from '../../lib/numeros';
import { linhaDigitavelSimulada } from '../../lib/vendas';
import { gerarPixCopiaECola } from '../../lib/pix';
import { lerConfiguracao } from '../../lib/email';

// Financeiro: contas a pagar e receber, boletos, fluxo de caixa e Meu Lucro.
// Vendas à vista (dinheiro, Pix, cartão, vale) não viram Lancamento: o fluxo soma PagamentoVenda das vendas CONCLUIDAS.
// Fiado e boleto viram Lancamento RECEITA a receber (criados por lib/vendas); compras recebidas viram DESPESA com origem COMPRA.
// Dinheiro é somado em centavos, para não haver erro de ponto flutuante.

const router = Router();
const LEITURA = permitir('GESTOR', 'CONTADOR');
const GESTOR = permitir('GESTOR');

const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const FORMAS = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'FIADO', 'VALE_ALIMENTACAO', 'BOLETO'] as const;
const SITUACOES = ['aberto', 'pago', 'vencido'] as const;
const MAXIMO_PARCELAS = 60;
const MESES_RECORRENCIA = 12;
const DIAS_PREVISTO = 30;

// ---------- Datas, números e filtros ----------

interface Dia {
  ano: number;
  mes: number; // 1 a 12
  dia: number;
}

// "AAAA-MM-DD" para dia de calendário válido; null se não for.
function lerDia(texto: string): Dia | null {
  if (!REGEX_DIA.test(texto)) return null;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia, 12);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return { ano, mes, dia };
}

function diaOuErro(texto: string): Dia {
  const dia = lerDia(texto);
  if (!dia) throw new HttpError(400, 'Data inválida');
  return dia;
}

// Dia de calendário sem hora: meio-dia, para não cair no dia anterior por causa do fuso.
function meioDia(d: Dia): Date {
  return new Date(d.ano, d.mes - 1, d.dia, 12, 0, 0, 0);
}

// Dia (AAAA-MM-DD) de um instante, pelo fuso do servidor.
function textoDia(data: Date): string {
  return `${String(data.getFullYear()).padStart(4, '0')}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(
    data.getDate()
  ).padStart(2, '0')}`;
}

// Soma meses ao dia; se o mês de destino for mais curto, usa o último dia dele (31/jan + 1 mês = 28/29 de fev).
function somarMeses(d: Dia, meses: number): Dia {
  const total = d.mes - 1 + meses;
  const ano = d.ano + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  return { ano, mes: mes + 1, dia: Math.min(d.dia, ultimo) };
}

// Todos os dias (AAAA-MM-DD) do período, inclusive os sem movimento.
function listaDias(inicio: Date, fim: Date): string[] {
  const lista: string[] = [];
  const cursor = inicioDoDia(inicio);
  const ultimo = inicioDoDia(fim).getTime();
  while (cursor.getTime() <= ultimo) {
    lista.push(textoDia(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return lista;
}

const centavos = (valor: number): number => Math.round(valor * 100);
const reais = (c: number): number => c / 100;

// Margem em %, sempre com 2 casas; 0 quando não há base.
const percentual = (parte: number, base: number): number => (base > 0 ? arred2((parte / base) * 100) : 0);

function textoQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

// Filtro de loja para o Prisma: null = todas as lojas.
function porLoja(loja: number | null): { lojaId?: number } {
  return loja === null ? {} : { lojaId: loja };
}

// ---------- Categorias ----------

router.get(
  '/financeiro/categorias',
  LEITURA,
  asyncHandler(async (_req, res) => {
    const categorias = await prisma.categoriaFinanceira.findMany({
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, tipo: true },
    });
    res.json(categorias);
  })
);

const categoriaSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(60, 'Nome muito longo'),
  tipo: z.enum(['RECEITA', 'DESPESA'], 'Tipo inválido'),
});

router.post(
  '/financeiro/categorias',
  GESTOR,
  asyncHandler(async (req, res) => {
    const dados = validar(categoriaSchema, req.body);
    const existe = await prisma.categoriaFinanceira.findFirst({ where: { nome: dados.nome, tipo: dados.tipo } });
    if (existe) throw new HttpError(409, 'Já existe uma categoria com este nome');
    const criada = await prisma.categoriaFinanceira.create({
      data: { nome: dados.nome, tipo: dados.tipo },
      select: { id: true, nome: true, tipo: true },
    });
    res.status(201).json(criada);
  })
);

// Só o nome muda: trocar o tipo deixaria os lançamentos já feitos com categoria de tipo errado.
router.put(
  '/financeiro/categorias/:id',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(z.object({ nome: z.string().trim().min(1, 'Informe o nome').max(60, 'Nome muito longo') }), req.body);
    const atual = await prisma.categoriaFinanceira.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Categoria não encontrada');
    const outra = await prisma.categoriaFinanceira.findFirst({
      where: { nome: dados.nome, tipo: atual.tipo, NOT: { id } },
    });
    if (outra) throw new HttpError(409, 'Já existe uma categoria com este nome');
    const alterada = await prisma.categoriaFinanceira.update({
      where: { id },
      data: { nome: dados.nome },
      select: { id: true, nome: true, tipo: true },
    });
    res.json(alterada);
  })
);

router.delete(
  '/financeiro/categorias/:id',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.categoriaFinanceira.findUnique({
      where: { id },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!atual) throw new HttpError(404, 'Categoria não encontrada');
    if (atual._count.lancamentos > 0) {
      throw new HttpError(409, 'Esta categoria tem lançamentos e não pode ser excluída');
    }
    await prisma.categoriaFinanceira.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Lançamentos ----------

const INCLUIR = {
  categoria: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nome: true } },
  cliente: { select: { id: true, nome: true } },
} as const;

type LancamentoLido = Prisma.LancamentoGetPayload<{ include: typeof INCLUIR }>;

function paraDTO(l: LancamentoLido) {
  const vencido = l.pagoEm === null && l.vencimento.getTime() < inicioDoDia().getTime();
  return {
    id: l.id,
    tipo: l.tipo,
    origem: l.origem,
    descricao: l.descricao,
    valor: num(l.valor),
    vencimento: textoDia(l.vencimento),
    pagoEm: l.pagoEm ? l.pagoEm.toISOString() : null,
    valorPago: numOuNull(l.valorPago),
    formaPagamento: l.formaPagamento,
    categoria: l.categoria?.nome ?? null,
    categoriaId: l.categoriaId,
    fornecedor: l.fornecedor?.nome ?? null,
    fornecedorId: l.fornecedorId,
    cliente: l.cliente?.nome ?? null,
    clienteId: l.clienteId,
    documento: l.documento,
    linhaDigitavel: l.linhaDigitavel,
    parcela: l.parcela,
    totalParcelas: l.totalParcelas,
    observacao: l.observacao,
    vencido,
  };
}

const dataTexto = z.string().regex(REGEX_DIA, 'Data inválida');
const idOpcional = z.number().int().positive().nullable().optional();
const valorSchema = z
  .number('Informe o valor')
  .positive('Valor deve ser maior que zero')
  .max(9999999.99, 'Valor muito alto')
  .refine((v) => Number(v.toFixed(2)) === v, 'Use no máximo 2 casas decimais');
const textoOpcional = (maximo: number) => z.string().trim().max(maximo, 'Texto muito longo').nullable().optional();

const lancamentoSchema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA'], 'Tipo inválido'),
  descricao: z.string().trim().min(1, 'Informe a descrição').max(120, 'Descrição muito longa'),
  valor: valorSchema,
  vencimento: dataTexto,
  categoriaId: idOpcional,
  fornecedorId: idOpcional,
  clienteId: idOpcional,
  documento: textoOpcional(60),
  linhaDigitavel: textoOpcional(120),
  observacao: textoOpcional(500),
  parcelas: z.number().int().min(1, 'Parcelas entre 1 e 60').max(MAXIMO_PARCELAS, 'Parcelas entre 1 e 60').optional(),
  recorrente: z.enum(['MENSAL'], 'Recorrência inválida').nullable().optional(),
});

const edicaoSchema = z.object({
  descricao: z.string().trim().min(1, 'Informe a descrição').max(120, 'Descrição muito longa').optional(),
  valor: valorSchema.optional(),
  vencimento: dataTexto.optional(),
  categoriaId: idOpcional,
  fornecedorId: idOpcional,
  clienteId: idOpcional,
  documento: textoOpcional(60),
  linhaDigitavel: textoOpcional(120),
  observacao: textoOpcional(500),
});

async function conferirCategoria(categoriaId: number | null | undefined, tipo: 'RECEITA' | 'DESPESA'): Promise<void> {
  if (categoriaId === null || categoriaId === undefined) return;
  const categoria = await prisma.categoriaFinanceira.findUnique({ where: { id: categoriaId } });
  if (!categoria) throw new HttpError(400, 'Categoria inválida');
  if (categoria.tipo !== tipo) throw new HttpError(400, 'Esta categoria não serve para este tipo de lançamento');
}

async function conferirPessoas(fornecedorId: number | null | undefined, clienteId: number | null | undefined): Promise<void> {
  if (fornecedorId) {
    const fornecedor = await prisma.fornecedor.findUnique({ where: { id: fornecedorId }, select: { id: true } });
    if (!fornecedor) throw new HttpError(400, 'Fornecedor inválido');
  }
  if (clienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!cliente) throw new HttpError(400, 'Cliente inválido');
  }
}

// Situação: aberto = não pago (inclui os vencidos); vencido = não pago com vencimento antes de hoje; pago = quitado.
router.get(
  '/financeiro/lancamentos',
  LEITURA,
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const tipo = textoQuery(q.tipo);
    if (tipo !== undefined && tipo !== 'RECEITA' && tipo !== 'DESPESA') throw new HttpError(400, 'Tipo inválido');
    const situacao = textoQuery(q.situacao);
    if (situacao !== undefined && !(SITUACOES as readonly string[]).includes(situacao)) {
      throw new HttpError(400, 'Situação inválida');
    }
    const busca = textoQuery(q.busca);
    const loja = await filtroLoja(req);
    const hoje = inicioDoDia();

    const condicoes: Prisma.LancamentoWhereInput[] = [];
    if (situacao === 'pago') condicoes.push({ pagoEm: { not: null } });
    if (situacao === 'aberto' || situacao === 'vencido') condicoes.push({ pagoEm: null });
    if (situacao === 'vencido') condicoes.push({ vencimento: { lt: hoje } });
    // Em aberto e vencidos, sem datas informadas: tudo que está em aberto. Os demais usam o período (padrão: 30 dias).
    const semDatas = !textoQuery(q.inicio) && !textoQuery(q.fim);
    if (!((situacao === 'aberto' || situacao === 'vencido') && semDatas)) {
      const { inicio, fim } = periodoDaQuery(q, 30);
      condicoes.push({ vencimento: { gte: inicio, lte: fim } });
    }

    const where: Prisma.LancamentoWhereInput = { AND: condicoes, ...porLoja(loja) };
    if (tipo === 'RECEITA' || tipo === 'DESPESA') where.tipo = tipo;
    if (busca) {
      where.OR = [
        { descricao: { contains: busca, mode: 'insensitive' } },
        { documento: { contains: busca, mode: 'insensitive' } },
        { fornecedor: { nome: { contains: busca, mode: 'insensitive' } } },
        { cliente: { nome: { contains: busca, mode: 'insensitive' } } },
      ];
    }

    const lista = await prisma.lancamento.findMany({
      where,
      include: INCLUIR,
      orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    const itens = lista.map(paraDTO);

    // Totais da lista mostrada: aberto = não pago (inclui vencido); vencido = subconjunto vencido; pago = quitado.
    let abertoC = 0;
    let pagoC = 0;
    let vencidoC = 0;
    for (const item of itens) {
      if (item.pagoEm) {
        pagoC += centavos(item.valorPago ?? item.valor);
      } else {
        abertoC += centavos(item.valor);
        if (item.vencido) vencidoC += centavos(item.valor);
      }
    }
    res.json({ itens, totais: { aberto: reais(abertoC), pago: reais(pagoC), vencido: reais(vencidoC) } });
  })
);

// Um lançamento, ou várias parcelas, ou uma recorrência de 12 meses. Devolve a lista criada.
interface PlanoParcela {
  valor: number;
  vencimento: Dia;
  parcela: number | null;
  totalParcelas: number | null;
}

function planejarParcelas(valor: number, base: Dia, parcelas: number, recorrente: boolean): PlanoParcela[] {
  if (recorrente) {
    // Recorrência: cada mês cobra o valor cheio.
    return Array.from({ length: MESES_RECORRENCIA }, (_, i) => ({
      valor,
      vencimento: somarMeses(base, i),
      parcela: i + 1,
      totalParcelas: MESES_RECORRENCIA,
    }));
  }
  if (parcelas <= 1) return [{ valor, vencimento: base, parcela: null, totalParcelas: null }];
  // Parcelas: divide em centavos; a última leva a diferença de arredondamento.
  const total = centavos(valor);
  const parte = Math.floor(total / parcelas);
  return Array.from({ length: parcelas }, (_, i) => ({
    valor: reais(i === parcelas - 1 ? total - parte * (parcelas - 1) : parte),
    vencimento: somarMeses(base, i),
    parcela: i + 1,
    totalParcelas: parcelas,
  }));
}

router.post(
  '/financeiro/lancamentos',
  GESTOR,
  asyncHandler(async (req, res) => {
    const dados = validar(lancamentoSchema, req.body);
    if (dados.recorrente && (dados.parcelas ?? 1) > 1) {
      throw new HttpError(400, 'Use parcelas ou recorrência, não os dois');
    }
    await conferirCategoria(dados.categoriaId, dados.tipo);
    await conferirPessoas(dados.fornecedorId, dados.clienteId);
    const lojaId = await lojaDaRequisicao(req);
    const planos = planejarParcelas(dados.valor, diaOuErro(dados.vencimento), dados.parcelas ?? 1, dados.recorrente === 'MENSAL');

    const criados = await prisma.$transaction(async (tx) => {
      const lista: LancamentoLido[] = [];
      for (const p of planos) {
        lista.push(
          await tx.lancamento.create({
            data: {
              tipo: dados.tipo,
              origem: 'MANUAL',
              descricao: dados.descricao,
              valor: p.valor.toFixed(2),
              vencimento: meioDia(p.vencimento),
              categoriaId: dados.categoriaId ?? null,
              fornecedorId: dados.fornecedorId || null,
              clienteId: dados.clienteId || null,
              documento: dados.documento || null,
              linhaDigitavel: dados.linhaDigitavel || null,
              observacao: dados.observacao || null,
              parcela: p.parcela,
              totalParcelas: p.totalParcelas,
              lojaId,
            },
            include: INCLUIR,
          })
        );
      }
      return lista;
    });
    res.status(201).json(criados.map(paraDTO));
  })
);

router.put(
  '/financeiro/lancamentos/:id',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(edicaoSchema, req.body);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    await conferirCategoria(dados.categoriaId, atual.tipo);
    await conferirPessoas(dados.fornecedorId, dados.clienteId);

    const alterado = await prisma.lancamento.update({
      where: { id },
      data: {
        descricao: dados.descricao,
        valor: dados.valor === undefined ? undefined : dados.valor.toFixed(2),
        vencimento: dados.vencimento === undefined ? undefined : meioDia(diaOuErro(dados.vencimento)),
        categoriaId: dados.categoriaId,
        fornecedorId: dados.fornecedorId,
        clienteId: dados.clienteId,
        documento: dados.documento === undefined ? undefined : dados.documento || null,
        linhaDigitavel: dados.linhaDigitavel === undefined ? undefined : dados.linhaDigitavel || null,
        observacao: dados.observacao === undefined ? undefined : dados.observacao || null,
      },
      include: INCLUIR,
    });
    res.json(paraDTO(alterado));
  })
);

router.delete(
  '/financeiro/lancamentos/:id',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    if (atual.pagoEm) throw new HttpError(400, 'Lançamento pago não pode ser excluído. Estorne antes.');
    if (atual.origem !== 'MANUAL') {
      throw new HttpError(400, 'Só lançamentos lançados à mão podem ser excluídos. Os outros vêm de vendas ou compras.');
    }
    await prisma.lancamento.delete({ where: { id } });
    res.status(204).end();
  })
);

const pagarSchema = z.object({
  pagoEm: dataTexto.optional(),
  valorPago: valorSchema.optional(),
  formaPagamento: z.enum(FORMAS, 'Forma de pagamento inválida'),
});

router.post(
  '/financeiro/lancamentos/:id/pagar',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(pagarSchema, req.body);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    if (atual.pagoEm) throw new HttpError(409, 'Este lançamento já está pago');
    const pago = await prisma.lancamento.update({
      where: { id },
      data: {
        pagoEm: dados.pagoEm ? meioDia(diaOuErro(dados.pagoEm)) : new Date(),
        valorPago: (dados.valorPago ?? num(atual.valor)).toFixed(2),
        formaPagamento: dados.formaPagamento,
      },
      include: INCLUIR,
    });
    res.json(paraDTO(pago));
  })
);

router.post(
  '/financeiro/lancamentos/:id/estornar',
  GESTOR,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.lancamento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Lançamento não encontrado');
    if (!atual.pagoEm) throw new HttpError(409, 'Este lançamento não está pago');
    const estornado = await prisma.lancamento.update({
      where: { id },
      data: { pagoEm: null, valorPago: null, formaPagamento: null },
      include: INCLUIR,
    });
    res.json(paraDTO(estornado));
  })
);

// ---------- Boletos ----------

const boletoSchema = z.object({
  clienteId: z.number('Informe o cliente').int('Informe o cliente').positive('Informe o cliente'),
  valor: valorSchema,
  vencimento: dataTexto,
  descricao: z.string().trim().min(1, 'Informe a descrição').max(120, 'Descrição muito longa'),
});

// Boleto híbrido simulado: linha digitável de mentira (sem registro bancário) e Pix copia e cola da empresa, se houver chave.
router.post(
  '/financeiro/boletos',
  GESTOR,
  asyncHandler(async (req, res) => {
    const dados = validar(boletoSchema, req.body);
    const cliente = await prisma.cliente.findUnique({ where: { id: dados.clienteId }, select: { id: true } });
    if (!cliente) throw new HttpError(400, 'Cliente inválido');
    const lojaId = await lojaDaRequisicao(req);
    const vencimento = diaOuErro(dados.vencimento);
    const config = await lerConfiguracao();

    const criado = await prisma.$transaction(async (tx) => {
      const novo = await tx.lancamento.create({
        data: {
          tipo: 'RECEITA',
          origem: 'MANUAL',
          descricao: dados.descricao,
          valor: dados.valor.toFixed(2),
          vencimento: meioDia(vencimento),
          clienteId: cliente.id,
          formaPagamento: 'BOLETO',
          lojaId,
        },
        select: { id: true },
      });
      return tx.lancamento.update({
        where: { id: novo.id },
        data: { linhaDigitavel: linhaDigitavelSimulada(novo.id, 1, dados.valor) },
        include: INCLUIR,
      });
    });

    const pixCopiaECola = config.pixChave
      ? gerarPixCopiaECola({
          chave: config.pixChave,
          nome: config.pixNome || config.nome,
          cidade: config.pixCidade || 'BRASIL',
          valor: dados.valor,
          identificador: `BOL${criado.id}`,
        })
      : null;
    res.status(201).json({ ...paraDTO(criado), pixCopiaECola });
  })
);

// ---------- Fluxo de caixa ----------

router.get(
  '/financeiro/fluxo',
  LEITURA,
  asyncHandler(async (req, res) => {
    const { inicio, fim } = periodoDaQuery(req.query as Record<string, unknown>, 30);
    const loja = await filtroLoja(req);
    const lojaP = porLoja(loja);
    const periodo = { gte: inicio, lte: fim };
    const agora = new Date();
    const hoje = inicioDoDia(agora);
    const atePrevisto = fimDoDia(somarDias(agora, DIAS_PREVISTO));

    const [pagVendas, receitas, despesas, emAberto] = await Promise.all([
      prisma.pagamentoVenda.findMany({
        where: {
          forma: { notIn: ['FIADO', 'BOLETO'] },
          venda: { status: 'CONCLUIDA', concluidaEm: periodo, ...lojaP },
        },
        select: { valor: true, venda: { select: { concluidaEm: true } } },
      }),
      prisma.lancamento.findMany({
        where: { tipo: 'RECEITA', pagoEm: periodo, ...lojaP },
        select: { pagoEm: true, valor: true, valorPago: true },
      }),
      prisma.lancamento.findMany({
        where: { tipo: 'DESPESA', pagoEm: periodo, ...lojaP },
        select: { pagoEm: true, valor: true, valorPago: true },
      }),
      prisma.lancamento.findMany({
        where: { pagoEm: null, vencimento: { gte: hoje, lte: atePrevisto }, ...lojaP },
        select: { tipo: true, valor: true },
      }),
    ]);

    const vendasDia = new Map<string, number>();
    const receitasDia = new Map<string, number>();
    const saidasDia = new Map<string, number>();
    const soma = (mapa: Map<string, number>, chave: string, valor: number) =>
      mapa.set(chave, (mapa.get(chave) ?? 0) + valor);

    for (const p of pagVendas) {
      if (p.venda.concluidaEm) soma(vendasDia, textoDia(p.venda.concluidaEm), centavos(num(p.valor)));
    }
    for (const l of receitas) {
      if (l.pagoEm) soma(receitasDia, textoDia(l.pagoEm), centavos(num(l.valorPago ?? l.valor)));
    }
    for (const d of despesas) {
      if (d.pagoEm) soma(saidasDia, textoDia(d.pagoEm), centavos(num(d.valorPago ?? d.valor)));
    }

    // Saldo acumulado começa em zero no primeiro dia do período.
    let acumuladoC = 0;
    let entradasC = 0;
    let saidasC = 0;
    const dias = listaDias(inicio, fim).map((data) => {
      const ev = vendasDia.get(data) ?? 0;
      const el = receitasDia.get(data) ?? 0;
      const s = saidasDia.get(data) ?? 0;
      const saldoDia = ev + el - s;
      acumuladoC += saldoDia;
      entradasC += ev + el;
      saidasC += s;
      return {
        data,
        entradasVendas: reais(ev),
        entradasLancamentos: reais(el),
        saidas: reais(s),
        saldoDia: reais(saldoDia),
        saldoAcumulado: reais(acumuladoC),
      };
    });

    let receberC = 0;
    let pagarC = 0;
    for (const a of emAberto) {
      if (a.tipo === 'RECEITA') receberC += centavos(num(a.valor));
      else pagarC += centavos(num(a.valor));
    }

    res.json({
      inicio: textoDia(inicio),
      fim: textoDia(fim),
      dias,
      totais: { entradas: reais(entradasC), saidas: reais(saidasC), saldo: reais(entradasC - saidasC) },
      previsto: { receber: reais(receberC), pagar: reais(pagarC), saldo: reais(receberC - pagarC) },
    });
  })
);

// ---------- Resumo (cartões do topo) ----------

router.get(
  '/financeiro/resumo',
  LEITURA,
  asyncHandler(async (req, res) => {
    const loja = await filtroLoja(req);
    const lojaP = porLoja(loja);
    const agora = new Date();
    const hoje = inicioDoDia(agora);
    const fimHoje = fimDoDia(agora);
    const mesIni = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
    const mesFim = fimDoDia(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));

    const vendasEntre = async (de: Date, ate: Date): Promise<number> => {
      const agregado = await prisma.venda.aggregate({
        where: { status: 'CONCLUIDA', concluidaEm: { gte: de, lte: ate }, ...lojaP },
        _sum: { total: true },
      });
      return num(agregado._sum.total);
    };
    const avistaEntre = async (de: Date, ate: Date): Promise<number> => {
      const agregado = await prisma.pagamentoVenda.aggregate({
        where: {
          forma: { notIn: ['FIADO', 'BOLETO'] },
          venda: { status: 'CONCLUIDA', concluidaEm: { gte: de, lte: ate }, ...lojaP },
        },
        _sum: { valor: true },
      });
      return num(agregado._sum.valor);
    };
    const lancamentosSoma = async (
      tipo: 'RECEITA' | 'DESPESA',
      filtro: Prisma.LancamentoWhereInput
    ): Promise<number> => {
      const agregado = await prisma.lancamento.aggregate({
        where: { tipo, ...lojaP, ...filtro },
        _sum: { valor: true },
      });
      return num(agregado._sum.valor);
    };
    const pagosNoMes = async (tipo: 'RECEITA' | 'DESPESA'): Promise<number> => {
      const agregado = await prisma.lancamento.aggregate({
        where: { tipo, ...lojaP, pagoEm: { gte: mesIni, lte: mesFim } },
        _sum: { valorPago: true },
      });
      return num(agregado._sum.valorPago);
    };

    const [vendasHoje, vendasMes, avistaMes, recebidoMes, pagoMes, aReceber, aPagar, vencidosReceber, vencidosPagar] =
      await Promise.all([
        vendasEntre(hoje, fimHoje),
        vendasEntre(mesIni, mesFim),
        avistaEntre(mesIni, mesFim),
        pagosNoMes('RECEITA'),
        pagosNoMes('DESPESA'),
        lancamentosSoma('RECEITA', { pagoEm: null }),
        lancamentosSoma('DESPESA', { pagoEm: null }),
        lancamentosSoma('RECEITA', { pagoEm: null, vencimento: { lt: hoje } }),
        lancamentosSoma('DESPESA', { pagoEm: null, vencimento: { lt: hoje } }),
      ]);

    res.json({
      vendasHoje: arred2(vendasHoje),
      vendasMes: arred2(vendasMes),
      aReceber: arred2(aReceber),
      aPagar: arred2(aPagar),
      vencidosReceber: arred2(vencidosReceber),
      vencidosPagar: arred2(vencidosPagar),
      saldoMes: arred2(avistaMes + recebidoMes - pagoMes),
    });
  })
);

// ---------- Meu Lucro ----------

// Lucro do período. Faturamento e custo vêm das vendas concluídas; perdas vêm dos movimentos PERDA;
// despesas não contam compras (origem COMPRA) para a mercadoria não entrar duas vezes.
router.get(
  '/lucro',
  LEITURA,
  asyncHandler(async (req, res) => {
    const { inicio, fim } = periodoDaQuery(req.query as Record<string, unknown>, 30);
    const loja = await filtroLoja(req);
    const lojaP = porLoja(loja);
    const periodo = { gte: inicio, lte: fim };

    const [vendas, itens, despesas, perdas, bonificacoes] = await Promise.all([
      prisma.venda.findMany({
        where: { status: 'CONCLUIDA', concluidaEm: periodo, ...lojaP },
        select: { total: true, custoTotal: true, concluidaEm: true },
      }),
      prisma.vendaItem.findMany({
        where: { cancelado: false, venda: { status: 'CONCLUIDA', concluidaEm: periodo, ...lojaP } },
        select: {
          produtoId: true,
          quantidade: true,
          total: true,
          custoUnitario: true,
          produto: { select: { nome: true, categoria: { select: { nome: true } } } },
        },
      }),
      prisma.lancamento.findMany({
        where: { tipo: 'DESPESA', pagoEm: periodo, origem: { not: 'COMPRA' }, ...lojaP },
        select: { valor: true, valorPago: true },
      }),
      prisma.movimentoEstoque.findMany({
        where: { tipo: 'PERDA', criadoEm: periodo, ...lojaP },
        select: { quantidade: true, custoUnitario: true },
      }),
      prisma.lancamento.findMany({
        where: { tipo: 'RECEITA', origem: 'BONIFICACAO', pagoEm: periodo, ...lojaP },
        select: { valor: true, valorPago: true },
      }),
    ]);

    // Por venda: faturamento, custo e por dia.
    let fatC = 0;
    let custoC = 0;
    const diaLucro = new Map<string, { fat: number; lucro: number }>();
    for (const v of vendas) {
      const f = centavos(num(v.total));
      const c = centavos(num(v.custoTotal));
      fatC += f;
      custoC += c;
      if (v.concluidaEm) {
        const chave = textoDia(v.concluidaEm);
        const a = diaLucro.get(chave) ?? { fat: 0, lucro: 0 };
        a.fat += f;
        a.lucro += f - c;
        diaLucro.set(chave, a);
      }
    }
    const lucroBrutoC = fatC - custoC;

    let despesasC = 0;
    for (const d of despesas) despesasC += centavos(num(d.valorPago ?? d.valor));

    let perdasC = 0;
    for (const p of perdas) perdasC += Math.round(Math.abs(num(p.quantidade)) * num(p.custoUnitario) * 100);

    let bonifC = 0;
    for (const b of bonificacoes) bonifC += centavos(num(b.valorPago ?? b.valor));

    const lucroLiquidoC = lucroBrutoC - despesasC - perdasC + bonifC;

    // Por produto e por categoria: a partir dos itens (sem o acréscimo e o desconto do cabeçalho da venda).
    interface Acumulado {
      produtoId: number;
      nome: string;
      categoria: string;
      quantidade: number;
      fat: number;
      custo: number;
    }
    const porProduto = new Map<number, Acumulado>();
    for (const it of itens) {
      const f = centavos(num(it.total));
      const c = Math.round(num(it.custoUnitario) * num(it.quantidade) * 100);
      const a = porProduto.get(it.produtoId) ?? {
        produtoId: it.produtoId,
        nome: it.produto.nome,
        categoria: it.produto.categoria?.nome ?? 'Sem categoria',
        quantidade: 0,
        fat: 0,
        custo: 0,
      };
      a.quantidade += num(it.quantidade);
      a.fat += f;
      a.custo += c;
      porProduto.set(it.produtoId, a);
    }

    const porCategoriaMapa = new Map<string, { fat: number; custo: number }>();
    for (const a of porProduto.values()) {
      const cat = porCategoriaMapa.get(a.categoria) ?? { fat: 0, custo: 0 };
      cat.fat += a.fat;
      cat.custo += a.custo;
      porCategoriaMapa.set(a.categoria, cat);
    }

    const porCategoria = Array.from(porCategoriaMapa, ([categoria, c]) => ({
      categoria,
      faturamento: reais(c.fat),
      custo: reais(c.custo),
      lucro: reais(c.fat - c.custo),
      margem: percentual(c.fat - c.custo, c.fat),
    })).sort((a, b) => b.faturamento - a.faturamento);

    const produtos = Array.from(porProduto.values()).map((a) => ({
      produtoId: a.produtoId,
      produto: a.nome,
      quantidade: arred2(a.quantidade),
      faturamento: reais(a.fat),
      lucro: reais(a.fat - a.custo),
      margem: percentual(a.fat - a.custo, a.fat),
    }));

    const topProdutos = [...produtos].sort((a, b) => b.lucro - a.lucro).slice(0, 20);
    const piores = produtos
      .filter((p) => p.faturamento > 0)
      .sort((a, b) => a.margem - b.margem)
      .slice(0, 10);

    const porDia = listaDias(inicio, fim).map((data) => {
      const a = diaLucro.get(data) ?? { fat: 0, lucro: 0 };
      return { data, faturamento: reais(a.fat), lucroBruto: reais(a.lucro) };
    });

    res.json({
      de: textoDia(inicio),
      ate: textoDia(fim),
      faturamento: reais(fatC),
      custoMercadorias: reais(custoC),
      lucroBruto: reais(lucroBrutoC),
      margemBruta: percentual(lucroBrutoC, fatC),
      despesas: reais(despesasC),
      perdas: reais(perdasC),
      bonificacoes: reais(bonifC),
      lucroLiquido: reais(lucroLiquidoC),
      margemLiquida: percentual(lucroLiquidoC, fatC),
      porDia,
      porCategoria,
      topProdutos,
      piores,
    });
  })
);

export default router;
