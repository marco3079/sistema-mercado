import type { Promocao, TipoCliente } from '@prisma/client';
import { prisma } from './prisma';
import type { Tx } from './estoque';
import { arred2, num } from './numeros';

// Preço de venda de um produto para uma quantidade: tabela, atacado (por quantidade ou cliente ATACADO)
// e promoções ativas (do produto ou da categoria). Vale o MENOR total.

export interface ProdutoPreco {
  id: number;
  categoriaId: number | null;
  precoVenda: unknown;
  precoAtacado: unknown;
  qtdAtacado: unknown;
}

export interface PrecoCalculado {
  precoUnitario: number; // preço efetivo por unidade/kg (total / quantidade)
  precoTabela: number;
  total: number;
  desconto: number; // precoTabela * quantidade - total
  promocaoId: number | null;
  origem: 'TABELA' | 'ATACADO' | 'PROMOCAO';
  descricaoPromocao: string | null;
}

// Promoções vigentes agora para um conjunto de produtos (uma consulta só).
export async function promocoesVigentes(
  produtos: { id: number; categoriaId: number | null }[],
  cliente: Tx | typeof prisma = prisma,
  agora = new Date(),
): Promise<Promocao[]> {
  if (produtos.length === 0) return [];
  const categorias = Array.from(new Set(produtos.map((p) => p.categoriaId).filter((c): c is number => c !== null)));
  return cliente.promocao.findMany({
    where: {
      ativa: true,
      inicio: { lte: agora },
      fim: { gte: agora },
      OR: [{ produtoId: { in: produtos.map((p) => p.id) } }, ...(categorias.length ? [{ categoriaId: { in: categorias } }] : [])],
    },
  });
}

function totalComPromocao(p: Promocao, precoTabela: number, quantidade: number): number | null {
  const valor = num(p.valor);
  switch (p.tipo) {
    case 'PRECO_FIXO':
      return valor * quantidade;
    case 'PERCENTUAL':
      return precoTabela * (1 - Math.min(100, Math.max(0, valor)) / 100) * quantidade;
    case 'LEVE_PAGUE': {
      const levar = p.levar ?? 0;
      const pagar = p.pagar ?? 0;
      if (levar <= 0 || pagar <= 0 || pagar >= levar) return null;
      const inteiro = Math.floor(quantidade);
      const grupos = Math.floor(inteiro / levar);
      return (grupos * pagar + (quantidade - grupos * levar)) * precoTabela;
    }
    case 'ATACADO':
      return quantidade >= num(p.qtdMinima) ? valor * quantidade : null;
    default:
      return null;
  }
}

export function descreverPromocao(p: Promocao): string {
  const valor = num(p.valor);
  switch (p.tipo) {
    case 'PRECO_FIXO':
      return `${p.nome}: por ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
    case 'PERCENTUAL':
      return `${p.nome}: ${valor}% de desconto`;
    case 'LEVE_PAGUE':
      return `${p.nome}: leve ${p.levar} pague ${p.pagar}`;
    case 'ATACADO':
      return `${p.nome}: a partir de ${num(p.qtdMinima)} por ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
    default:
      return p.nome;
  }
}

// Calcula o preço. `promocoes` deve vir de promocoesVigentes (pode ser de vários produtos: filtramos aqui).
export function calcularPreco(
  produto: ProdutoPreco,
  quantidade: number,
  promocoes: Promocao[],
  tipoCliente: TipoCliente = 'VAREJO',
): PrecoCalculado {
  const precoTabela = num(produto.precoVenda as number);
  const base = precoTabela * quantidade;
  let melhor: PrecoCalculado = {
    precoUnitario: precoTabela,
    precoTabela,
    total: arred2(base),
    desconto: 0,
    promocaoId: null,
    origem: 'TABELA',
    descricaoPromocao: null,
  };

  const precoAtacado = produto.precoAtacado === null || produto.precoAtacado === undefined ? null : num(produto.precoAtacado as number);
  const qtdAtacado = produto.qtdAtacado === null || produto.qtdAtacado === undefined ? null : num(produto.qtdAtacado as number);
  if (precoAtacado !== null && precoAtacado > 0 && (tipoCliente === 'ATACADO' || (qtdAtacado !== null && quantidade >= qtdAtacado))) {
    const total = arred2(precoAtacado * quantidade);
    if (total < melhor.total) {
      melhor = { ...melhor, total, precoUnitario: precoAtacado, origem: 'ATACADO', descricaoPromocao: 'Preço de atacado' };
    }
  }

  for (const p of promocoes) {
    if (p.produtoId !== null && p.produtoId !== produto.id) continue;
    if (p.produtoId === null && (p.categoriaId === null || p.categoriaId !== produto.categoriaId)) continue;
    const t = totalComPromocao(p, precoTabela, quantidade);
    if (t === null) continue;
    const total = arred2(Math.max(0, t));
    if (total < melhor.total) {
      melhor = {
        ...melhor,
        total,
        precoUnitario: quantidade > 0 ? arred2(total / quantidade) : precoTabela,
        promocaoId: p.id,
        origem: 'PROMOCAO',
        descricaoPromocao: descreverPromocao(p),
      };
    }
  }
  melhor.desconto = arred2(base - melhor.total);
  return melhor;
}

// Formação de preço: custo + margem (markup sobre o custo). Com arredondamento, termina em ,49 ou ,99.
export function sugerirPrecoVenda(custo: number, margemPercentual: number, arredondar = true): number {
  const bruto = custo * (1 + margemPercentual / 100);
  if (!arredondar || bruto <= 0) return arred2(bruto);
  const reais = Math.floor(bruto);
  const centavos = bruto - reais;
  if (centavos <= 0.49) return arred2(reais + 0.49);
  return arred2(reais + 0.99);
}

// Margem real sobre o preço de venda (%), para mostrar ao lado do markup.
export function margemSobreVenda(custo: number, venda: number): number {
  if (venda <= 0) return 0;
  return arred2(((venda - custo) / venda) * 100);
}

// ---------- Balança (etiqueta EAN-13 de peso/preço) ----------
// Formato adotado (padrão Toledo/Filizola configurado com código de 6 dígitos):
//   [prefixo 1 dígito][PLU 6 dígitos][valor 5 dígitos][dígito verificador]
//   valor = centavos (modo PRECO) ou gramas (modo PESO).
// Ex.: 2 000123 01590 X -> PLU 123, R$ 15,90.

export function digitoVerificadorEan(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

export function eanValido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return /^\d{8}$|^\d{12}$|^\d{14}$/.test(codigo);
  return digitoVerificadorEan(codigo.slice(0, 12)) === Number(codigo[12]);
}

export interface LeituraBalanca {
  plu: number;
  modo: 'PRECO' | 'PESO';
  valor: number; // reais (PRECO) ou kg (PESO)
}

export function lerEtiquetaBalanca(codigo: string, prefixo: string, modo: string): LeituraBalanca | null {
  if (!/^\d{13}$/.test(codigo) || !codigo.startsWith(prefixo)) return null;
  const plu = Number(codigo.slice(1, 7));
  const bruto = Number(codigo.slice(7, 12));
  if (!plu) return null;
  return modo === 'PESO' ? { plu, modo: 'PESO', valor: bruto / 1000 } : { plu, modo: 'PRECO', valor: bruto / 100 };
}

export function gerarEtiquetaBalanca(prefixo: string, plu: number, valorReaisOuKg: number, modo: string): string {
  const bruto = modo === 'PESO' ? Math.round(valorReaisOuKg * 1000) : Math.round(valorReaisOuKg * 100);
  const doze = `${prefixo.slice(0, 1)}${String(plu).padStart(6, '0').slice(-6)}${String(Math.min(99999, bruto)).padStart(5, '0')}`;
  return doze + String(digitoVerificadorEan(doze));
}
