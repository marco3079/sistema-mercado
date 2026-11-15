import type { Prisma, TipoMovimentoEstoque } from '@prisma/client';
import { prisma } from './prisma';
import { arred3, arred4, num } from './numeros';

// ÚNICO caminho para mudar estoque. Todo módulo (PDV, recebimento, padaria, transferência,
// inventário, ajuste/perda) chama movimentarEstoque dentro da própria transação.
// O estoque pode ficar negativo (o mercado vende antes de lançar a nota); os relatórios mostram isso.

export type Tx = Prisma.TransactionClient;

export interface Movimento {
  produtoId: number;
  lojaId: number;
  tipo: TipoMovimentoEstoque;
  quantidade: number; // com sinal: + entra, - sai
  custoUnitario?: number | null;
  motivo?: string | null;
  referencia?: string | null; // ex.: "venda:12"
  usuarioId?: number | null;
  // Entrada com lote (recebimento ou produção): cria o lote com a mesma quantidade.
  lote?: { codigo: string; validade: Date; fabricacao?: Date | null; recebimentoId?: number; ordemProducaoId?: number } | null;
}

export interface ResultadoMovimento {
  movimentoId: number;
  saldoApos: number;
}

export async function movimentarEstoque(tx: Tx, m: Movimento): Promise<ResultadoMovimento> {
  const quantidade = arred3(m.quantidade);
  const estoque = await tx.estoqueLoja.upsert({
    where: { produtoId_lojaId: { produtoId: m.produtoId, lojaId: m.lojaId } },
    create: { produtoId: m.produtoId, lojaId: m.lojaId, quantidade },
    update: { quantidade: { increment: quantidade } },
  });
  const saldoApos = arred3(num(estoque.quantidade));

  let loteId: number | null = null;
  if (quantidade > 0 && m.lote) {
    const lote = await tx.lote.create({
      data: {
        produtoId: m.produtoId,
        lojaId: m.lojaId,
        codigo: m.lote.codigo,
        validade: m.lote.validade,
        fabricacao: m.lote.fabricacao ?? null,
        quantidade,
        recebimentoId: m.lote.recebimentoId ?? null,
        ordemProducaoId: m.lote.ordemProducaoId ?? null,
      },
    });
    loteId = lote.id;
  } else if (quantidade < 0) {
    await consumirLotes(tx, m.produtoId, m.lojaId, -quantidade);
  }

  const movimento = await tx.movimentoEstoque.create({
    data: {
      produtoId: m.produtoId,
      lojaId: m.lojaId,
      tipo: m.tipo,
      quantidade,
      saldoApos,
      custoUnitario: m.custoUnitario ?? null,
      motivo: m.motivo ?? null,
      referencia: m.referencia ?? null,
      usuarioId: m.usuarioId ?? null,
      loteId,
    },
  });
  return { movimentoId: movimento.id, saldoApos };
}

// Baixa dos lotes pela validade mais próxima primeiro (FEFO). Se faltar lote, o resto sai "sem lote".
async function consumirLotes(tx: Tx, produtoId: number, lojaId: number, quantidade: number): Promise<void> {
  let restante = quantidade;
  const lotes = await tx.lote.findMany({
    where: { produtoId, lojaId, quantidade: { gt: 0 } },
    orderBy: [{ validade: 'asc' }, { id: 'asc' }],
  });
  for (const lote of lotes) {
    if (restante <= 0) break;
    const saldo = num(lote.quantidade);
    const usar = Math.min(saldo, restante);
    await tx.lote.update({ where: { id: lote.id }, data: { quantidade: arred3(saldo - usar) } });
    restante = arred3(restante - usar);
  }
}

// Custo médio ponderado (todas as lojas) depois de uma entrada com custo.
// Chamar ANTES de movimentarEstoque da entrada (usa o saldo anterior).
export async function atualizarCustoMedio(tx: Tx, produtoId: number, quantidadeEntrada: number, custoEntrada: number): Promise<number> {
  const produto = await tx.produto.findUniqueOrThrow({ where: { id: produtoId }, select: { precoCusto: true } });
  const agregado = await tx.estoqueLoja.aggregate({ where: { produtoId }, _sum: { quantidade: true } });
  const saldoAnterior = Math.max(0, num(agregado._sum.quantidade));
  const custoAtual = num(produto.precoCusto);
  const total = saldoAnterior + quantidadeEntrada;
  const novo = total > 0 && saldoAnterior > 0 ? (saldoAnterior * custoAtual + quantidadeEntrada * custoEntrada) / total : custoEntrada;
  const arredondado = arred4(novo);
  await tx.produto.update({ where: { id: produtoId }, data: { precoCusto: arredondado } });
  return arredondado;
}

// Saldo de um produto numa loja (0 se nunca movimentou).
export async function saldoDe(produtoId: number, lojaId: number, cliente: Tx | typeof prisma = prisma): Promise<number> {
  const e = await cliente.estoqueLoja.findUnique({ where: { produtoId_lojaId: { produtoId, lojaId } } });
  return num(e?.quantidade);
}
