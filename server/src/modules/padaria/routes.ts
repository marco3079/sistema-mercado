import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { arred2, arred3, arred4, fimDoDia, inicioDoDia, num, periodoDaQuery, somarDias } from '../../lib/numeros';
import { lojaDaRequisicao } from '../../lib/lojas';
import { movimentarEstoque } from '../../lib/estoque';
import type { Tx } from '../../lib/estoque';

// Padaria: receitas (fichas técnicas), produção (fornadas) e sugestão a partir das vendas.
// Perfis: PADEIRO e GESTOR escrevem; ESTOQUISTA só lê.

const router = Router();

const LEITURA = ['PADEIRO', 'GESTOR', 'ESTOQUISTA'] as const;
const ESCRITA = ['PADEIRO', 'GESTOR'] as const;
const LIMITE_QUANTIDADE = 999999999;

// ---------- Esquemas ----------

const itemSchema = z.object({
  insumoId: z.number().int('Insumo inválido').positive('Insumo inválido'),
  quantidade: z.number().positive('Quantidade inválida').max(LIMITE_QUANTIDADE, 'Quantidade inválida'),
});

const camposReceitaSchema = {
  rendimento: z.number().positive('Informe o rendimento').max(LIMITE_QUANTIDADE, 'Rendimento inválido'),
  tempoPreparoMin: z.number().int().min(0).max(100000).nullable().optional(),
  tempoFornoMin: z.number().int().min(0).max(100000).nullable().optional(),
  temperaturaForno: z.number().int().min(0).max(400).nullable().optional(),
  modoPreparo: z.string().trim().max(4000).nullable().optional(),
  itens: z.array(itemSchema),
};

const novaReceitaSchema = z.object({
  produtoId: z.number().int('Produto inválido').positive('Produto inválido'),
  ...camposReceitaSchema,
});

const atualizarReceitaSchema = z.object(camposReceitaSchema);

const horarioSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Horário inválido');

const novaOrdemSchema = z.object({
  receitaId: z.number().int('Receita inválida').positive('Receita inválida'),
  quantidadePlanejada: z.number().positive('Informe a quantidade').max(LIMITE_QUANTIDADE, 'Quantidade inválida'),
  agendadoPara: horarioSchema,
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
});

const atualizarOrdemSchema = z.object({
  quantidadePlanejada: z.number().positive('Quantidade inválida').max(LIMITE_QUANTIDADE, 'Quantidade inválida').optional(),
  agendadoPara: horarioSchema.optional(),
  observacao: z.string().trim().max(200, 'Observação muito longa').nullable().optional(),
});

const concluirSchema = z.object({
  quantidadeProduzida: z.number().min(0, 'Quantidade inválida').max(LIMITE_QUANTIDADE, 'Quantidade inválida'),
  perda: z.number().min(0, 'Perda inválida').max(LIMITE_QUANTIDADE, 'Perda inválida').optional(),
});

// ---------- Consultas com o formato usado nas respostas ----------

const INCLUIR_RECEITA = {
  produto: { select: { nome: true, unidade: true, precoVenda: true } },
  itens: {
    orderBy: { id: 'asc' },
    include: { insumo: { select: { id: true, nome: true, unidade: true, precoCusto: true } } },
  },
} as const;

type ReceitaComDados = Prisma.ReceitaGetPayload<{ include: typeof INCLUIR_RECEITA }>;

const INCLUIR_ORDEM = {
  produto: { select: { nome: true, unidade: true, controlaLote: true, validadeDias: true } },
  receita: {
    select: {
      rendimento: true,
      itens: {
        orderBy: { id: 'asc' },
        select: {
          insumoId: true,
          quantidade: true,
          insumo: { select: { nome: true, unidade: true, precoCusto: true } },
        },
      },
    },
  },
} as const;

type OrdemComDados = Prisma.OrdemProducaoGetPayload<{ include: typeof INCLUIR_ORDEM }>;

// Quantidade de cada insumo na loja (0 quando nunca movimentou).
async function estoquesDaLoja(lojaId: number, produtoIds: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  const ids = [...new Set(produtoIds)];
  if (ids.length === 0) return mapa;
  const linhas = await prisma.estoqueLoja.findMany({
    where: { lojaId, produtoId: { in: ids } },
    select: { produtoId: true, quantidade: true },
  });
  for (const l of linhas) mapa.set(l.produtoId, num(l.quantidade));
  return mapa;
}

// Custo = Σ(quantidade × precoCusto do insumo). Custo unitário = custo / rendimento. Margem = % sobre o preço de venda.
function paraReceita(r: ReceitaComDados, estoques: Map<number, number>) {
  const rendimento = num(r.rendimento);
  let somaBruta = 0;
  const itens = r.itens.map((i) => {
    const quantidade = num(i.quantidade);
    const custoUnitario = num(i.insumo.precoCusto);
    const custo = quantidade * custoUnitario;
    somaBruta += custo;
    return {
      id: i.id,
      insumoId: i.insumoId,
      insumo: i.insumo.nome,
      unidade: i.insumo.unidade,
      quantidade,
      custoUnitario,
      custo: arred2(custo),
      estoque: estoques.get(i.insumoId) ?? 0,
    };
  });
  const custoUnitario = rendimento > 0 ? arred4(somaBruta / rendimento) : 0;
  const precoVenda = num(r.produto.precoVenda);
  return {
    id: r.id,
    produtoId: r.produtoId,
    produto: r.produto.nome,
    unidade: r.produto.unidade,
    rendimento,
    tempoPreparoMin: r.tempoPreparoMin ?? null,
    tempoFornoMin: r.tempoFornoMin ?? null,
    temperaturaForno: r.temperaturaForno ?? null,
    modoPreparo: r.modoPreparo ?? null,
    custoTotal: arred2(somaBruta),
    custoUnitario,
    precoVenda,
    margem: precoVenda > 0 ? arred2(((precoVenda - custoUnitario) / precoVenda) * 100) : null,
    itens,
  };
}

async function dtoDasReceitas(receitas: ReceitaComDados[], lojaId: number) {
  const estoques = await estoquesDaLoja(
    lojaId,
    receitas.flatMap((r) => r.itens.map((i) => i.insumoId))
  );
  return receitas.map((r) => paraReceita(r, estoques));
}

async function buscarReceita(id: number, cliente: Tx | typeof prisma = prisma): Promise<ReceitaComDados> {
  const receita = await cliente.receita.findUnique({ where: { id }, include: INCLUIR_RECEITA });
  if (!receita) throw new HttpError(404, 'Receita não encontrada');
  return receita;
}

async function receitaRespondida(id: number, lojaId: number): Promise<ReturnType<typeof paraReceita>> {
  const receita = await buscarReceita(id);
  return (await dtoDasReceitas([receita], lojaId))[0];
}

// Fornada: a quantidade de insumo que falta é calculada só para as PLANEJADAS.
function paraOrdem(o: OrdemComDados, estoques: Map<number, number>) {
  const rendimento = num(o.receita.rendimento);
  const fator = rendimento > 0 ? num(o.quantidadePlanejada) / rendimento : 0;
  const faltaInsumo =
    o.status === 'PLANEJADA'
      ? o.receita.itens.flatMap((item) => {
          const necessario = arred3(num(item.quantidade) * fator);
          const estoque = estoques.get(item.insumoId) ?? 0;
          return estoque < necessario ? [{ insumo: item.insumo.nome, necessario, estoque }] : [];
        })
      : [];
  return {
    id: o.id,
    produtoId: o.produtoId,
    produto: o.produto.nome,
    unidade: o.produto.unidade,
    receitaId: o.receitaId,
    quantidadePlanejada: num(o.quantidadePlanejada),
    quantidadeProduzida: o.quantidadeProduzida === null ? null : num(o.quantidadeProduzida),
    perda: o.perda === null ? null : num(o.perda),
    status: o.status,
    agendadoPara: o.agendadoPara.toISOString(),
    iniciadoEm: o.iniciadoEm ? o.iniciadoEm.toISOString() : null,
    concluidoEm: o.concluidoEm ? o.concluidoEm.toISOString() : null,
    custoTotal: o.custoTotal === null ? null : num(o.custoTotal),
    observacao: o.observacao ?? null,
    faltaInsumo,
  };
}

async function dtoDasOrdens(ordens: OrdemComDados[], lojaId: number) {
  const estoques = await estoquesDaLoja(
    lojaId,
    ordens.flatMap((o) => o.receita.itens.map((i) => i.insumoId))
  );
  return ordens.map((o) => paraOrdem(o, estoques));
}

// Só entrega a fornada da loja da requisição; outra loja vê 404.
async function buscarOrdem(id: number, lojaId: number, cliente: Tx | typeof prisma = prisma): Promise<OrdemComDados> {
  const ordem = await cliente.ordemProducao.findUnique({ where: { id }, include: INCLUIR_ORDEM });
  if (!ordem || ordem.lojaId !== lojaId) throw new HttpError(404, 'Fornada não encontrada');
  return ordem;
}

async function ordemRespondida(id: number, lojaId: number, cliente: Tx | typeof prisma = prisma) {
  const ordem = await buscarOrdem(id, lojaId, cliente);
  return (await dtoDasOrdens([ordem], lojaId))[0];
}

// Itens da receita: sem repetição, sem o próprio produto, e todos precisam existir e estar ativos.
async function validarItens(
  itens: { insumoId: number; quantidade: number }[],
  produtoId: number
): Promise<{ insumoId: number; quantidade: number }[]> {
  const ids = itens.map((i) => i.insumoId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Insumo repetido na receita');
  if (ids.includes(produtoId)) throw new HttpError(400, 'O produto não pode ser insumo de si mesmo');
  if (ids.length > 0) {
    const achados = await prisma.produto.count({ where: { id: { in: ids }, ativo: true } });
    if (achados !== ids.length) throw new HttpError(400, 'Insumo inexistente ou inativo');
  }
  return itens.map((i) => ({ insumoId: i.insumoId, quantidade: arred4(i.quantidade) }));
}

// Dados de uma receita que o formulário edita (o produto não muda depois de criado).
function camposReceita(dados: {
  rendimento: number;
  tempoPreparoMin?: number | null;
  tempoFornoMin?: number | null;
  temperaturaForno?: number | null;
  modoPreparo?: string | null;
}) {
  return {
    rendimento: arred3(dados.rendimento).toFixed(3),
    tempoPreparoMin: dados.tempoPreparoMin ?? null,
    tempoFornoMin: dados.tempoFornoMin ?? null,
    temperaturaForno: dados.temperaturaForno ?? null,
    modoPreparo: dados.modoPreparo ?? null,
  };
}

// Dia da query (AAAA-MM-DD). Sem valor, vale hoje.
function diaDaQuery(valor: unknown): Date {
  if (valor === undefined || valor === '') return inicioDoDia();
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new HttpError(400, 'Data inválida');
  const [a, m, d] = valor.split('-').map(Number);
  return inicioDoDia(new Date(a, m - 1, d));
}

// AAAA-MM-DD no horário local do servidor.
function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Receitas ----------

router.get(
  '/receitas',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const receitas = await prisma.receita.findMany({
      include: INCLUIR_RECEITA,
      orderBy: { produto: { nome: 'asc' } },
    });
    res.json(await dtoDasReceitas(receitas, lojaId));
  })
);

router.get(
  '/receitas/:id',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);
    res.json(await receitaRespondida(id, lojaId));
  })
);

router.post(
  '/receitas',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const dados = validar(novaReceitaSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const produto = await prisma.produto.findUnique({ where: { id: dados.produtoId }, select: { id: true } });
    if (!produto) throw new HttpError(404, 'Produto não encontrado');
    const existente = await prisma.receita.findUnique({ where: { produtoId: dados.produtoId }, select: { id: true } });
    if (existente) throw new HttpError(409, 'Este produto já tem receita');
    const linhas = await validarItens(dados.itens, dados.produtoId);

    const criada = await prisma.$transaction(async (tx) => {
      const receita = await tx.receita.create({
        data: {
          produtoId: dados.produtoId,
          ...camposReceita(dados),
          itens: {
            create: linhas.map((l) => ({ insumoId: l.insumoId, quantidade: l.quantidade.toFixed(4) })),
          },
        },
      });
      await tx.produto.update({ where: { id: dados.produtoId }, data: { produzido: true } });
      return receita;
    });

    res.status(201).json(await receitaRespondida(criada.id, lojaId));
  })
);

router.put(
  '/receitas/:id',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarReceitaSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const atual = await prisma.receita.findUnique({ where: { id }, select: { id: true, produtoId: true } });
    if (!atual) throw new HttpError(404, 'Receita não encontrada');
    const linhas = await validarItens(dados.itens, atual.produtoId);

    await prisma.$transaction(async (tx) => {
      await tx.receita.update({ where: { id }, data: camposReceita(dados) });
      await tx.receitaItem.deleteMany({ where: { receitaId: id } });
      if (linhas.length > 0) {
        await tx.receitaItem.createMany({
          data: linhas.map((l) => ({ receitaId: id, insumoId: l.insumoId, quantidade: l.quantidade.toFixed(4) })),
        });
      }
    });

    res.json(await receitaRespondida(id, lojaId));
  })
);

router.delete(
  '/receitas/:id',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const receita = await prisma.receita.findUnique({
      where: { id },
      select: { id: true, produtoId: true, _count: { select: { ordens: true } } },
    });
    if (!receita) throw new HttpError(404, 'Receita não encontrada');
    if (receita._count.ordens > 0) {
      throw new HttpError(409, 'Esta receita já tem fornadas. Ela não pode ser excluída.');
    }
    await prisma.$transaction(async (tx) => {
      // Os itens saem junto (cascade).
      await tx.receita.delete({ where: { id } });
      await tx.produto.update({ where: { id: receita.produtoId }, data: { produzido: false } });
    });
    res.status(204).end();
  })
);

// ---------- Produção (fornadas) ----------

// Sugestão: média das vendas do mesmo dia da semana nas últimas 4 semanas, menos o estoque atual,
// arredondada para cima no múltiplo do rendimento.
router.get(
  '/producao/sugestao',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const dia = diaDaQuery(req.query.data);
    const diasHistorico = [7, 14, 21, 28].map((k) => chaveDia(somarDias(dia, -k)));
    const inicio = inicioDoDia(somarDias(dia, -28));
    const fim = fimDoDia(somarDias(dia, -7));

    const receitas = await prisma.receita.findMany({
      include: { produto: { select: { nome: true } } },
      orderBy: { produto: { nome: 'asc' } },
    });
    const vendas = await prisma.vendaItem.findMany({
      where: {
        cancelado: false,
        criadoEm: { gte: inicio, lte: fim },
        venda: { status: 'CONCLUIDA', lojaId },
      },
      select: { produtoId: true, quantidade: true, criadoEm: true },
    });
    const vendido = new Map<number, number>();
    for (const v of vendas) {
      if (!diasHistorico.includes(chaveDia(v.criadoEm))) continue;
      vendido.set(v.produtoId, (vendido.get(v.produtoId) ?? 0) + num(v.quantidade));
    }
    const estoques = await estoquesDaLoja(lojaId, receitas.map((r) => r.produtoId));

    res.json(
      receitas.map((r) => {
        const mediaVendida = (vendido.get(r.produtoId) ?? 0) / diasHistorico.length;
        const estoque = estoques.get(r.produtoId) ?? 0;
        const rendimento = num(r.rendimento);
        const falta = Math.max(0, mediaVendida - estoque);
        const fornadas = rendimento > 0 ? Math.ceil(arred3(falta / rendimento)) : 0;
        return {
          receitaId: r.id,
          produto: r.produto.nome,
          mediaVendida: arred2(mediaVendida),
          estoque: arred3(estoque),
          sugerido: arred3(fornadas * rendimento),
          fornadas,
        };
      })
    );
  })
);

// Resumo de produção no período: produzido, perda e custo por produto (só fornadas concluídas).
router.get(
  '/producao/resumo',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const { inicio, fim } = periodoDaQuery(req.query as Record<string, unknown>, 7);
    const ordens = await prisma.ordemProducao.findMany({
      where: { lojaId, status: 'CONCLUIDA', concluidoEm: { gte: inicio, lte: fim } },
      select: {
        produtoId: true,
        quantidadeProduzida: true,
        perda: true,
        custoTotal: true,
        produto: { select: { nome: true, unidade: true } },
      },
    });
    const grupos = new Map<
      number,
      { produto: string; unidade: string; produzido: number; perda: number; custoTotal: number }
    >();
    for (const o of ordens) {
      const g = grupos.get(o.produtoId) ?? {
        produto: o.produto.nome,
        unidade: o.produto.unidade,
        produzido: 0,
        perda: 0,
        custoTotal: 0,
      };
      g.produzido += num(o.quantidadeProduzida);
      g.perda += num(o.perda);
      g.custoTotal += num(o.custoTotal);
      grupos.set(o.produtoId, g);
    }
    res.json(
      [...grupos.entries()].map(([produtoId, g]) => {
        const total = g.produzido + g.perda;
        return {
          produtoId,
          produto: g.produto,
          unidade: g.unidade,
          produzido: arred3(g.produzido),
          perda: arred3(g.perda),
          percentualPerda: total > 0 ? arred2((g.perda / total) * 100) : null,
          custoTotal: arred2(g.custoTotal),
        };
      })
    );
  })
);

router.get(
  '/producao',
  permitir(...LEITURA),
  asyncHandler(async (req, res) => {
    const lojaId = await lojaDaRequisicao(req);
    const dia = diaDaQuery(req.query.data);
    const ordens = await prisma.ordemProducao.findMany({
      where: { lojaId, agendadoPara: { gte: dia, lte: fimDoDia(dia) } },
      include: INCLUIR_ORDEM,
      orderBy: [{ agendadoPara: 'asc' }, { id: 'asc' }],
    });
    res.json(await dtoDasOrdens(ordens, lojaId));
  })
);

router.post(
  '/producao',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const dados = validar(novaOrdemSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const receita = await prisma.receita.findUnique({ where: { id: dados.receitaId }, select: { id: true, produtoId: true } });
    if (!receita) throw new HttpError(404, 'Receita não encontrada');
    const criada = await prisma.ordemProducao.create({
      data: {
        lojaId,
        receitaId: receita.id,
        produtoId: receita.produtoId,
        quantidadePlanejada: arred3(dados.quantidadePlanejada).toFixed(3),
        agendadoPara: new Date(dados.agendadoPara),
        observacao: dados.observacao ?? null,
        usuarioId: req.usuario.id,
      },
      select: { id: true },
    });
    res.status(201).json(await ordemRespondida(criada.id, lojaId));
  })
);

router.put(
  '/producao/:id',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarOrdemSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const atual = await buscarOrdem(id, lojaId);
    if (atual.status !== 'PLANEJADA') throw new HttpError(409, 'Só é possível alterar uma fornada planejada');
    await prisma.ordemProducao.update({
      where: { id },
      data: {
        ...(dados.quantidadePlanejada !== undefined
          ? { quantidadePlanejada: arred3(dados.quantidadePlanejada).toFixed(3) }
          : {}),
        ...(dados.agendadoPara !== undefined ? { agendadoPara: new Date(dados.agendadoPara) } : {}),
        ...(dados.observacao !== undefined ? { observacao: dados.observacao ?? null } : {}),
      },
    });
    res.json(await ordemRespondida(id, lojaId));
  })
);

router.post(
  '/producao/:id/iniciar',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);
    const atual = await buscarOrdem(id, lojaId);
    if (atual.status !== 'PLANEJADA') throw new HttpError(409, 'Só é possível iniciar uma fornada planejada');
    await prisma.ordemProducao.update({
      where: { id },
      data: { status: 'EM_PRODUCAO', iniciadoEm: new Date() },
    });
    res.json(await ordemRespondida(id, lojaId));
  })
);

// Conclusão (uma transação): consome os insumos proporcionalmente, dá entrada no produto acabado,
// cria o lote quando o produto controla lote ou tem validade, e atualiza o custo do produto.
router.post(
  '/producao/:id/concluir',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(concluirSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const produzida = arred3(dados.quantidadeProduzida);
    const perda = arred3(dados.perda ?? 0);
    const total = arred3(produzida + perda);
    if (total <= 0) throw new HttpError(400, 'Informe a quantidade produzida');

    await prisma.$transaction(async (tx) => {
      const ordem = await buscarOrdem(id, lojaId, tx);
      if (ordem.status !== 'PLANEJADA' && ordem.status !== 'EM_PRODUCAO') {
        throw new HttpError(409, 'Esta fornada já foi encerrada');
      }
      const rendimento = num(ordem.receita.rendimento);
      if (rendimento <= 0) throw new HttpError(400, 'A receita está sem rendimento');
      const fator = total / rendimento;
      const agora = new Date();
      const referencia = `producao:${id}`;

      let custoReceita = 0;
      for (const item of ordem.receita.itens) {
        const quantidade = num(item.quantidade);
        custoReceita += quantidade * num(item.insumo.precoCusto);
        const consumo = arred3(quantidade * fator);
        if (consumo > 0) {
          await movimentarEstoque(tx, {
            produtoId: item.insumoId,
            lojaId,
            tipo: 'CONSUMO_PRODUCAO',
            quantidade: -consumo,
            motivo: `Fornada de ${ordem.produto.nome}`,
            referencia,
            usuarioId: req.usuario.id,
          });
        }
      }
      const custoTotal = arred2(custoReceita * fator);
      const custoUnitario = arred4(custoReceita / rendimento);

      if (produzida > 0) {
        // Lote quando o produto controla lote ou tem validade (validade padrão: 1 dia).
        const lote =
          ordem.produto.controlaLote || ordem.produto.validadeDias !== null
            ? {
                codigo: `F${id}`,
                validade: somarDias(agora, ordem.produto.validadeDias ?? 1),
                fabricacao: agora,
                ordemProducaoId: id,
              }
            : null;
        await movimentarEstoque(tx, {
          produtoId: ordem.produtoId,
          lojaId,
          tipo: 'PRODUCAO',
          quantidade: produzida,
          custoUnitario,
          motivo: 'Fornada concluída',
          referencia,
          usuarioId: req.usuario.id,
          lote,
        });
        await tx.produto.update({ where: { id: ordem.produtoId }, data: { precoCusto: custoUnitario.toFixed(4) } });
      }

      await tx.ordemProducao.update({
        where: { id },
        data: {
          status: 'CONCLUIDA',
          quantidadeProduzida: produzida.toFixed(3),
          perda: perda.toFixed(3),
          iniciadoEm: ordem.iniciadoEm ?? agora,
          concluidoEm: agora,
          custoTotal: custoTotal.toFixed(2),
          usuarioId: req.usuario.id,
        },
      });
    });

    res.json(await ordemRespondida(id, lojaId));
  })
);

router.post(
  '/producao/:id/cancelar',
  permitir(...ESCRITA),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const lojaId = await lojaDaRequisicao(req);
    const atual = await buscarOrdem(id, lojaId);
    if (atual.status !== 'PLANEJADA' && atual.status !== 'EM_PRODUCAO') {
      throw new HttpError(409, 'Esta fornada já foi encerrada');
    }
    await prisma.ordemProducao.update({ where: { id }, data: { status: 'CANCELADA' } });
    res.json(await ordemRespondida(id, lojaId));
  })
);

export default router;
