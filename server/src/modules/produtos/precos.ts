import type { Tx } from '../../lib/estoque';
import { HttpError } from '../../lib/erros';
import { arred2, arred4, num } from '../../lib/numeros';

// Única regra para mudar o preço de venda (e, junto, o custo): grava o histórico e cria a etiqueta
// de gôndola pendente quando o preço de venda muda. Usada pelo módulo de produtos e pelo recebimento.
export async function alterarPreco(
  tx: Tx,
  dados: { produtoId: number; precoVenda: number; precoCusto?: number | null; usuarioId: number; motivo?: string | null },
): Promise<{ mudouVenda: boolean }> {
  if (!(dados.precoVenda >= 0)) throw new HttpError(400, 'Preço de venda inválido');
  const produto = await tx.produto.findUnique({ where: { id: dados.produtoId } });
  if (!produto) throw new HttpError(404, 'Produto não encontrado');

  const vendaAnterior = num(produto.precoVenda);
  const custoAnterior = num(produto.precoCusto);
  const vendaNova = arred2(dados.precoVenda);
  const custoNovo = dados.precoCusto === undefined || dados.precoCusto === null ? custoAnterior : arred4(dados.precoCusto);
  const mudouVenda = vendaNova !== vendaAnterior;
  const mudouCusto = custoNovo !== custoAnterior;
  if (!mudouVenda && !mudouCusto) return { mudouVenda: false };

  await tx.produto.update({ where: { id: produto.id }, data: { precoVenda: vendaNova, precoCusto: custoNovo } });
  await tx.historicoPreco.create({
    data: {
      produtoId: produto.id,
      precoAnterior: vendaAnterior,
      precoNovo: vendaNova,
      custoAnterior: mudouCusto ? custoAnterior : null,
      custoNovo: mudouCusto ? custoNovo : null,
      usuarioId: dados.usuarioId,
    },
  });
  if (mudouVenda) {
    await tx.etiquetaPendente.create({ data: { produtoId: produto.id, motivo: dados.motivo ?? 'Preço alterado' } });
  }
  return { mudouVenda };
}
