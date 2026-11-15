// Cupom de venda em bobina 80 mm (impressão pelo navegador).
import { ROTULOS_FORMA_PAGAMENTO, formatarQuantidade } from '../../lib/mercado';
import { dataHora, escapar, imprimirHtml, moeda } from '../../lib/imprimir';
import type { DetalheVendaDTO } from './tipos';

function linhaPar(rotulo: string, valor: string): string {
  return `<p class="par"><span>${escapar(rotulo)}</span><span>${valor}</span></p>`;
}

export function imprimirCupom(venda: DetalheVendaDTO, nomeEmpresa: string): void {
  const itens = venda.itens
    .map(
      (i, n) => `
        <p class="item">${n + 1} ${escapar(i.descricao)}</p>
        <p class="nota">${escapar(formatarQuantidade(i.quantidade, i.unidade))} x ${moeda(i.precoUnitario)}${i.promocao ? ` (${escapar(i.promocao)})` : ''}</p>
        <p class="par"><span></span><span>${moeda(i.total)}</span></p>`,
    )
    .join('');

  const pagamentos = venda.pagamentos
    .map((p) => linhaPar(ROTULOS_FORMA_PAGAMENTO[p.forma] ?? p.forma, moeda(p.valor)))
    .join('');

  const notas = venda.notas
    .map(
      (n) => `
        <p class="pequeno">NFC-e nº ${n.numero} série ${n.serie}</p>
        ${n.chave ? `<p class="pequeno">Chave: ${escapar(n.chave)}</p>` : ''}`,
    )
    .join('');

  // Sem nota emitida, o cupom não tem valor fiscal. Nota simulada também é avisada.
  const semValorFiscal = venda.notas.length === 0 || venda.notas.some((n) => n.simulada);

  const corpo = `
    <h1>${escapar(nomeEmpresa)}</h1>
    <p class="centro">${escapar(venda.loja)}</p>
    ${venda.lojaCnpj ? `<p class="centro">CNPJ ${escapar(venda.lojaCnpj)}</p>` : ''}
    <p class="centro">Venda nº ${venda.numero} · ${escapar(dataHora(venda.criadoEm))}</p>
    <p class="centro">Operador: ${escapar(venda.operador)}</p>
    ${venda.cliente ? `<p class="centro">Cliente: ${escapar(venda.cliente.nome)}</p>` : ''}
    <div class="linha"></div>
    ${itens}
    <div class="linha"></div>
    ${linhaPar('Subtotal', moeda(venda.subtotal))}
    ${venda.desconto > 0 ? linhaPar('Desconto', `-${moeda(venda.desconto)}`) : ''}
    ${venda.acrescimo > 0 ? linhaPar('Acréscimo', moeda(venda.acrescimo)) : ''}
    <p class="par destaque"><span>TOTAL</span><span>${moeda(venda.total)}</span></p>
    <div class="linha"></div>
    ${pagamentos}
    ${venda.troco > 0 ? linhaPar('Troco', moeda(venda.troco)) : ''}
    ${venda.cpfNota ? `<p class="pequeno">CPF na nota: ${escapar(venda.cpfNota)}</p>` : ''}
    <div class="linha"></div>
    ${notas}
    ${semValorFiscal ? '<p class="centro pequeno">Documento sem valor fiscal (simulado)</p>' : ''}
    <p class="centro pequeno">Obrigado pela preferência!</p>`;

  imprimirHtml(`Cupom nº ${venda.numero}`, corpo);
}
