import type { FormaPagamento, ModeloNota, OrigemVenda, TipoCliente } from '@prisma/client';
import { HttpError } from './erros';
import { movimentarEstoque, Tx } from './estoque';
import { calcularPreco, promocoesVigentes } from './precos';
import { emitirNotaVenda, cancelarNotasDaVenda } from './fiscal';
import { lerConfiguracao } from './email';
import { arred2, arred3, num, somarDias } from './numeros';

// Registro de vendas: usado pelo PDV, delivery, marketplace, faturamento da força de vendas e B2B.
// Uma venda é gravada inteira de uma vez (o PDV monta o carrinho na tela e manda tudo no fim).
//
// O que acontece ao registrar:
// - preço de cada item: o informado (precoUnitario, ex.: preço negociado) ou calcularPreco (tabela/atacado/promoção);
// - baixa de estoque (VENDA) na loja da venda;
// - pagamentos; o troco é o excesso pago em DINHEIRO;
// - FIADO: exige cliente, soma no saldo devedor, cria MovimentoFiado e um Lancamento RECEITA a receber (30 dias);
// - BOLETO: cria Lancamento RECEITA a receber com linha digitável simulada;
// - os demais pagamentos NÃO viram lançamento: o financeiro soma as vendas direto da tabela Venda;
// - nota fiscal (NFC-e, ou NF-e se `modeloNota` = NFE) quando a emissão automática estiver ligada.

export interface ItemEntrada {
  produtoId: number;
  quantidade: number;
  precoUnitario?: number; // força um preço (negociado); sem isto, calcula
  desconto?: number; // desconto manual do item, em reais
}

export interface PagamentoEntrada {
  forma: FormaPagamento;
  valor: number;
  parcelas?: number;
  autorizacao?: string | null;
}

export interface NovaVenda {
  lojaId: number;
  usuarioId: number;
  vendedorId?: number | null;
  clienteId?: number | null;
  caixaId?: number | null;
  origem: OrigemVenda;
  itens: ItemEntrada[];
  pagamentos: PagamentoEntrada[];
  desconto?: number; // desconto no total, em reais
  acrescimo?: number; // ex.: taxa de entrega
  cpfNota?: string | null;
  observacao?: string | null;
  marketplaceId?: string | null;
  emitirNota?: boolean; // padrão: segue fiscalEmissaoAutomatica
  modeloNota?: ModeloNota;
  permitirSemPagamento?: boolean; // delivery/faturamento: paga na entrega ou a prazo
}

export interface VendaRegistrada {
  vendaId: number;
  numero: number;
  total: number;
  troco: number;
  notaId: number | null;
}

export async function registrarVenda(tx: Tx, v: NovaVenda): Promise<VendaRegistrada> {
  if (v.itens.length === 0) throw new HttpError(400, 'A venda não tem itens');

  const ids = Array.from(new Set(v.itens.map((i) => i.produtoId)));
  const produtos = await tx.produto.findMany({ where: { id: { in: ids } } });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = porId.get(id);
    if (!p || !p.ativo) throw new HttpError(400, `Produto ${id} não encontrado ou inativo`);
  }

  let tipoCliente: TipoCliente = 'VAREJO';
  let cliente: { id: number; limiteCredito: unknown; saldoDevedor: unknown; bloqueado: boolean; nome: string } | null = null;
  if (v.clienteId) {
    cliente = await tx.cliente.findUnique({ where: { id: v.clienteId } });
    if (!cliente) throw new HttpError(400, 'Cliente não encontrado');
    tipoCliente = (await tx.cliente.findUniqueOrThrow({ where: { id: v.clienteId }, select: { tipo: true } })).tipo;
  }

  const promocoes = await promocoesVigentes(produtos, tx);
  const itens = v.itens.map((item) => {
    if (!(item.quantidade > 0)) throw new HttpError(400, 'Quantidade inválida');
    const p = porId.get(item.produtoId)!;
    const quantidade = arred3(item.quantidade);
    const calculado = calcularPreco(p, quantidade, promocoes, tipoCliente);
    const precoUnitario = item.precoUnitario !== undefined ? arred2(item.precoUnitario) : calculado.precoUnitario;
    const bruto = item.precoUnitario !== undefined ? arred2(precoUnitario * quantidade) : calculado.total;
    const desconto = arred2(Math.min(bruto, Math.max(0, item.desconto ?? 0)));
    return {
      produtoId: p.id,
      descricao: p.nome,
      quantidade,
      precoUnitario,
      desconto,
      total: arred2(bruto - desconto),
      custoUnitario: num(p.precoCusto),
      promocaoId: item.precoUnitario !== undefined ? null : calculado.promocaoId,
    };
  });

  const subtotal = arred2(itens.reduce((s, i) => s + i.total, 0));
  const desconto = arred2(Math.min(subtotal, Math.max(0, v.desconto ?? 0)));
  const acrescimo = arred2(Math.max(0, v.acrescimo ?? 0));
  const total = arred2(subtotal - desconto + acrescimo);
  const custoTotal = arred2(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));

  const pago = arred2(v.pagamentos.reduce((s, p) => s + Math.max(0, p.valor), 0));
  if (!v.permitirSemPagamento && pago + 0.001 < total) {
    throw new HttpError(400, `Pagamento insuficiente: faltam ${(total - pago).toFixed(2)}`);
  }
  const dinheiro = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + p.valor, 0);
  const troco = arred2(Math.max(0, Math.min(dinheiro, pago - total)));

  const fiado = arred2(v.pagamentos.filter((p) => p.forma === 'FIADO').reduce((s, p) => s + p.valor, 0));
  if (fiado > 0) {
    if (!cliente) throw new HttpError(400, 'Venda fiado precisa de cliente');
    if (cliente.bloqueado) throw new HttpError(400, `${cliente.nome} está bloqueado para fiado`);
  }

  const agora = new Date();
  const venda = await tx.venda.create({
    data: {
      lojaId: v.lojaId,
      caixaId: v.caixaId ?? null,
      usuarioId: v.usuarioId,
      vendedorId: v.vendedorId ?? null,
      clienteId: v.clienteId ?? null,
      origem: v.origem,
      status: 'CONCLUIDA',
      subtotal,
      desconto,
      acrescimo,
      total,
      troco,
      custoTotal,
      cpfNota: v.cpfNota ?? null,
      observacao: v.observacao ?? null,
      marketplaceId: v.marketplaceId ?? null,
      concluidaEm: agora,
      itens: { create: itens },
      pagamentos: {
        create: v.pagamentos
          .filter((p) => p.valor > 0)
          .map((p) => ({
            forma: p.forma,
            // O dinheiro grava o valor líquido (sem o troco).
            valor: p.forma === 'DINHEIRO' ? arred2(p.valor - troco) : arred2(p.valor),
            parcelas: p.parcelas ?? 1,
            autorizacao: p.autorizacao ?? null,
          })),
      },
    },
  });

  for (const item of itens) {
    await movimentarEstoque(tx, {
      produtoId: item.produtoId,
      lojaId: v.lojaId,
      tipo: 'VENDA',
      quantidade: -item.quantidade,
      custoUnitario: item.custoUnitario,
      referencia: `venda:${venda.id}`,
      usuarioId: v.usuarioId,
    });
  }

  if (fiado > 0 && cliente) {
    await tx.cliente.update({ where: { id: cliente.id }, data: { saldoDevedor: { increment: fiado } } });
    await tx.movimentoFiado.create({
      data: { clienteId: cliente.id, tipo: 'COMPRA', valor: fiado, vendaId: venda.id, descricao: `Venda nº ${venda.numero}`, usuarioId: v.usuarioId },
    });
    await tx.lancamento.create({
      data: {
        tipo: 'RECEITA',
        origem: 'FIADO',
        descricao: `Fiado - venda nº ${venda.numero} - ${cliente.nome}`,
        valor: fiado,
        vencimento: somarDias(agora, 30),
        clienteId: cliente.id,
        lojaId: v.lojaId,
        formaPagamento: 'FIADO',
        referencia: `venda:${venda.id}`,
      },
    });
  }

  const boleto = arred2(v.pagamentos.filter((p) => p.forma === 'BOLETO').reduce((s, p) => s + p.valor, 0));
  if (boleto > 0) {
    const parcelas = Math.max(1, v.pagamentos.find((p) => p.forma === 'BOLETO')?.parcelas ?? 1);
    for (let i = 1; i <= parcelas; i++) {
      await tx.lancamento.create({
        data: {
          tipo: 'RECEITA',
          origem: 'VENDA',
          descricao: `Boleto ${i}/${parcelas} - venda nº ${venda.numero}${cliente ? ` - ${cliente.nome}` : ''}`,
          valor: arred2(boleto / parcelas),
          vencimento: somarDias(agora, 28 * i),
          clienteId: cliente?.id ?? null,
          lojaId: v.lojaId,
          formaPagamento: 'BOLETO',
          linhaDigitavel: linhaDigitavelSimulada(venda.id, i, boleto / parcelas),
          parcela: i,
          totalParcelas: parcelas,
          referencia: `venda:${venda.id}`,
        },
      });
    }
  }

  let notaId: number | null = null;
  const config = await lerConfiguracao();
  const emitir = v.emitirNota ?? config.fiscalEmissaoAutomatica;
  if (emitir) notaId = await emitirNotaVenda(tx, venda.id, v.modeloNota ?? 'NFCE');

  return { vendaId: venda.id, numero: venda.numero, total, troco, notaId };
}

// Linha digitável de boleto (simulada: formato visual de 47 dígitos, sem registro bancário).
export function linhaDigitavelSimulada(vendaId: number, parcela: number, valor: number): string {
  const base = `00190000090${String(vendaId).padStart(8, '0')}${String(parcela).padStart(2, '0')}`.padEnd(37, '7');
  const v = String(Math.round(valor * 100)).padStart(10, '0');
  const d = (base + v).slice(0, 47);
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`;
}

// Cancela uma venda concluída: devolve estoque, desfaz fiado e boletos em aberto, cancela notas e entrega.
export async function cancelarVenda(tx: Tx, vendaId: number, motivo: string, usuarioId: number): Promise<void> {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, include: { itens: true, fiado: true } });
  if (!venda) throw new HttpError(404, 'Venda não encontrada');
  if (venda.status === 'CANCELADA') throw new HttpError(400, 'Venda já cancelada');

  await tx.venda.update({ where: { id: vendaId }, data: { status: 'CANCELADA', canceladaEm: new Date(), motivoCancelamento: motivo } });
  for (const item of venda.itens) {
    if (item.cancelado) continue;
    await movimentarEstoque(tx, {
      produtoId: item.produtoId,
      lojaId: venda.lojaId,
      tipo: 'CANCELAMENTO_VENDA',
      quantidade: num(item.quantidade),
      custoUnitario: num(item.custoUnitario),
      referencia: `venda:${venda.id}`,
      motivo,
      usuarioId,
    });
  }
  const fiado = venda.fiado.filter((f) => f.tipo === 'COMPRA').reduce((s, f) => s + num(f.valor), 0);
  if (fiado > 0 && venda.clienteId) {
    await tx.cliente.update({ where: { id: venda.clienteId }, data: { saldoDevedor: { decrement: arred2(fiado) } } });
    await tx.movimentoFiado.create({
      data: { clienteId: venda.clienteId, tipo: 'PAGAMENTO', valor: arred2(fiado), vendaId, descricao: `Estorno - venda nº ${venda.numero} cancelada`, usuarioId },
    });
  }
  await tx.lancamento.deleteMany({ where: { referencia: `venda:${vendaId}`, pagoEm: null } });
  await cancelarNotasDaVenda(tx, vendaId, motivo);
  await tx.entrega.updateMany({ where: { vendaId, status: { notIn: ['ENTREGUE'] } }, data: { status: 'CANCELADA' } });
}
