import { Router } from 'express';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja } from '../../lib/lojas';
import { arred2, arred3, fimDoDia, inicioDoDia, num, periodoDaQuery, somarDias } from '../../lib/numeros';
import { margemSobreVenda } from '../../lib/precos';

// Relatórios do gestor e do contador: vendas, curva ABC, produtos parados e margem.
// Cada relatório é calculado uma vez e serve tanto para a tela (JSON) quanto para o CSV.
// Só lê vendas, itens, pagamentos, lançamentos e estoque. Dinheiro é somado em centavos.

const router = Router();
const LEITURA = permitir('GESTOR', 'CONTADOR');

const AGRUPAMENTOS = ['dia', 'hora', 'semana', 'mes'] as const;
type Agrupamento = (typeof AGRUPAMENTOS)[number];
const CRITERIOS = ['faturamento', 'quantidade', 'lucro'] as const;
type Criterio = (typeof CRITERIOS)[number];
const RELATORIOS_CSV = ['vendas', 'curva-abc', 'produtos-parados', 'margem'] as const;

const centavos = (valor: number): number => Math.round(valor * 100);
const reais = (c: number): number => c / 100;
const dois = (n: number): string => String(n).padStart(2, '0');

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : undefined;
}

// "AAAA-MM-DD" de um instante, pelo fuso do servidor.
function dataTexto(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function periodoDoRequest(req: Request): { inicio: Date; fim: Date } {
  return periodoDaQuery(req.query as Record<string, unknown>, 30);
}

function porLoja(loja: number | null): { lojaId?: number } {
  return loja === null ? {} : { lojaId: loja };
}

// ---------- Vendas ----------

interface Acumulado {
  vendas: number;
  total: number; // centavos
}

function somar(mapa: Map<string, Acumulado>, chave: string, valorC: number): void {
  const a = mapa.get(chave) ?? { vendas: 0, total: 0 };
  a.vendas += 1;
  a.total += valorC;
  mapa.set(chave, a);
}

// Rótulo do bucket: hora "HH:00", dia "AAAA-MM-DD", semana = segunda-feira da semana, mês "AAAA-MM".
function rotuloDoBucket(d: Date, agrupar: Agrupamento): string {
  if (agrupar === 'hora') return `${dois(d.getHours())}:00`;
  if (agrupar === 'mes') return `${d.getFullYear()}-${dois(d.getMonth() + 1)}`;
  if (agrupar === 'semana') {
    const desdeSegunda = (d.getDay() + 6) % 7;
    return dataTexto(new Date(d.getFullYear(), d.getMonth(), d.getDate() - desdeSegunda));
  }
  return dataTexto(d);
}

async function calcVendas(req: Request) {
  const agrupar = (texto(req.query.agrupar) ?? 'dia') as Agrupamento;
  if (!(AGRUPAMENTOS as readonly string[]).includes(agrupar)) throw new HttpError(400, 'Agrupamento inválido');
  const { inicio, fim } = periodoDoRequest(req);
  const loja = await filtroLoja(req);

  const vendas = await prisma.venda.findMany({
    where: { status: 'CONCLUIDA', concluidaEm: { gte: inicio, lte: fim }, ...porLoja(loja) },
    select: {
      total: true,
      origem: true,
      concluidaEm: true,
      usuario: { select: { nome: true } },
      pagamentos: { select: { forma: true, valor: true } },
    },
  });

  let totalC = 0;
  const serie = new Map<string, Acumulado>();
  const porOrigem = new Map<string, Acumulado>();
  const porOperador = new Map<string, Acumulado>();
  const porForma = new Map<string, number>();
  for (const v of vendas) {
    const t = centavos(num(v.total));
    totalC += t;
    if (v.concluidaEm) somar(serie, rotuloDoBucket(v.concluidaEm, agrupar), t);
    somar(porOrigem, v.origem, t);
    somar(porOperador, v.usuario.nome, t);
    for (const p of v.pagamentos) {
      porForma.set(p.forma, (porForma.get(p.forma) ?? 0) + centavos(num(p.valor)));
    }
  }

  return {
    de: dataTexto(inicio),
    ate: dataTexto(fim),
    agrupar,
    vendas: vendas.length,
    total: reais(totalC),
    ticketMedio: vendas.length === 0 ? 0 : reais(Math.round(totalC / vendas.length)),
    serie: [...serie.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([rotulo, a]) => ({
        rotulo,
        vendas: a.vendas,
        total: reais(a.total),
        ticketMedio: reais(Math.round(a.total / a.vendas)),
      })),
    porOrigem: [...porOrigem.entries()]
      .map(([origem, a]) => ({ origem, vendas: a.vendas, total: reais(a.total) }))
      .sort((a, b) => b.total - a.total),
    porForma: [...porForma.entries()]
      .map(([forma, c]) => ({ forma, total: reais(c) }))
      .sort((a, b) => b.total - a.total),
    porOperador: [...porOperador.entries()]
      .map(([operador, a]) => ({ operador, vendas: a.vendas, total: reais(a.total) }))
      .sort((a, b) => b.total - a.total),
  };
}

// ---------- Produtos vendidos no período (base da curva ABC e dos parados) ----------

interface VendidoProduto {
  codigo: string;
  nome: string;
  foto: string | null;
  categoria: string;
  quantidade: number;
  fat: number; // centavos
  custo: number; // centavos
}

async function vendidosPorProduto(inicio: Date, fim: Date, loja: number | null): Promise<Map<number, VendidoProduto>> {
  const itens = await prisma.vendaItem.findMany({
    where: {
      cancelado: false,
      venda: { status: 'CONCLUIDA', concluidaEm: { gte: inicio, lte: fim }, ...porLoja(loja) },
    },
    select: {
      produtoId: true,
      quantidade: true,
      total: true,
      custoUnitario: true,
      produto: { select: { codigo: true, nome: true, foto: true, categoria: { select: { nome: true } } } },
    },
  });
  const mapa = new Map<number, VendidoProduto>();
  for (const it of itens) {
    const a = mapa.get(it.produtoId) ?? {
      codigo: it.produto.codigo,
      nome: it.produto.nome,
      foto: it.produto.foto ?? null,
      categoria: it.produto.categoria?.nome ?? 'Sem categoria',
      quantidade: 0,
      fat: 0,
      custo: 0,
    };
    a.quantidade += num(it.quantidade);
    a.fat += centavos(num(it.total));
    a.custo += Math.round(num(it.custoUnitario) * num(it.quantidade) * 100);
    mapa.set(it.produtoId, a);
  }
  return mapa;
}

// ---------- Curva ABC ----------

async function calcCurvaAbc(req: Request) {
  const criterio = (texto(req.query.criterio) ?? 'faturamento') as Criterio;
  if (!(CRITERIOS as readonly string[]).includes(criterio)) throw new HttpError(400, 'Critério inválido');
  const { inicio, fim } = periodoDoRequest(req);
  const loja = await filtroLoja(req);
  const mapa = await vendidosPorProduto(inicio, fim, loja);

  const linhas = [...mapa.entries()].map(([produtoId, a]) => {
    const faturamento = reais(a.fat);
    const lucro = reais(a.fat - a.custo);
    const valor = criterio === 'quantidade' ? a.quantidade : criterio === 'lucro' ? lucro : faturamento;
    return { produtoId, codigo: a.codigo, nome: a.nome, foto: a.foto, categoria: a.categoria, quantidade: arred3(a.quantidade), faturamento, lucro, valor };
  });
  linhas.sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));

  const total = linhas.reduce((s, l) => s + l.valor, 0);
  let acumulado = 0;
  return linhas.map(({ valor, ...l }) => {
    const percentualItem = total > 0 ? (valor / total) * 100 : 0;
    acumulado += percentualItem;
    // Classe pelo percentual acumulado: até 80% é A, até 95% é B, o resto é C.
    const classe = acumulado <= 80 ? 'A' : acumulado <= 95 ? 'B' : 'C';
    return { ...l, percentual: percentualItem, percentualAcumulado: acumulado, classe };
  });
}

// ---------- Produtos parados ----------

async function calcProdutosParados(req: Request) {
  const bruto = texto(req.query.dias);
  if (bruto !== undefined && !/^\d+$/.test(bruto)) throw new HttpError(400, 'Dias inválidos');
  const dias = bruto === undefined ? 30 : Number(bruto);
  if (dias < 1 || dias > 366) throw new HttpError(400, 'Dias entre 1 e 366');

  const agora = new Date();
  const fim = fimDoDia(agora);
  const inicio = inicioDoDia(somarDias(agora, -(dias - 1)));
  const loja = await filtroLoja(req);
  const lojaP = porLoja(loja);

  // Estoque com saldo positivo (soma das lojas quando é "todas").
  const estoques = await prisma.estoqueLoja.findMany({
    where: { quantidade: { gt: 0 }, ...lojaP },
    select: {
      produtoId: true,
      quantidade: true,
      produto: { select: { nome: true, precoCusto: true, foto: true, categoria: { select: { nome: true } } } },
    },
  });
  const estoquePorProduto = new Map<
    number,
    { nome: string; foto: string | null; categoria: string | null; custo: number; quantidade: number }
  >();
  for (const e of estoques) {
    const a = estoquePorProduto.get(e.produtoId) ?? {
      nome: e.produto.nome,
      foto: e.produto.foto ?? null,
      categoria: e.produto.categoria?.nome ?? null,
      custo: num(e.produto.precoCusto),
      quantidade: 0,
    };
    a.quantidade += num(e.quantidade);
    estoquePorProduto.set(e.produtoId, a);
  }
  const ids = [...estoquePorProduto.keys()];
  if (ids.length === 0) return [];

  const vendidosNoPeriodo = await prisma.vendaItem.findMany({
    where: {
      cancelado: false,
      produtoId: { in: ids },
      venda: { status: 'CONCLUIDA', concluidaEm: { gte: inicio, lte: fim }, ...lojaP },
    },
    select: { produtoId: true },
  });
  const comVenda = new Set(vendidosNoPeriodo.map((v) => v.produtoId));
  const parados = ids.filter((id) => !comVenda.has(id));
  if (parados.length === 0) return [];

  // Data da última venda (em qualquer período) de cada produto parado.
  const ultimas = await prisma.vendaItem.findMany({
    where: {
      cancelado: false,
      produtoId: { in: parados },
      venda: { status: 'CONCLUIDA', ...lojaP },
    },
    select: { produtoId: true, venda: { select: { concluidaEm: true } } },
  });
  const ultimaPor = new Map<number, number>();
  for (const u of ultimas) {
    if (!u.venda.concluidaEm) continue;
    const t = u.venda.concluidaEm.getTime();
    if (t > (ultimaPor.get(u.produtoId) ?? -Infinity)) ultimaPor.set(u.produtoId, t);
  }

  return parados
    .map((id) => {
      const a = estoquePorProduto.get(id)!;
      const ultima = ultimaPor.get(id);
      return {
        produtoId: id,
        nome: a.nome,
        foto: a.foto,
        categoria: a.categoria,
        estoque: arred3(a.quantidade),
        valorEstoque: reais(centavos(a.quantidade * a.custo)),
        ultimaVenda: ultima === undefined ? null : new Date(ultima).toISOString(),
      };
    })
    .sort((a, b) => b.valorEstoque - a.valorEstoque);
}

// ---------- Margem ----------

async function calcMargem() {
  const produtos = await prisma.produto.findMany({
    where: { ativo: true, precoCusto: { gt: 0 } },
    select: {
      id: true,
      codigo: true,
      nome: true,
      foto: true,
      precoCusto: true,
      precoVenda: true,
      categoria: { select: { nome: true } },
    },
  });
  return produtos
    .map((p) => {
      const custo = num(p.precoCusto);
      const venda = num(p.precoVenda);
      return {
        produtoId: p.id,
        codigo: p.codigo,
        nome: p.nome,
        foto: p.foto ?? null,
        categoria: p.categoria?.nome ?? null,
        custo,
        venda,
        margem: margemSobreVenda(custo, venda),
        prejuizo: venda < custo,
      };
    })
    .sort((a, b) => a.margem - b.margem || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------- CSV ----------

// Separador ";", cabeçalho em português, números com vírgula decimal (padrão do Excel no Brasil), UTF-8 com BOM.
function csv(cabecalho: string[], linhas: (string | number | null)[][]): string {
  const celula = (v: string | number | null): string => {
    if (v === null) return '';
    const t = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
}

async function montarCsv(relatorio: string, req: Request): Promise<{ nome: string; texto: string }> {
  const hoje = dataTexto(new Date());
  if (relatorio === 'vendas') {
    const r = await calcVendas(req);
    return {
      nome: `vendas-${hoje}.csv`,
      texto: csv(
        ['Período', 'Vendas', 'Total (R$)', 'Ticket médio (R$)'],
        r.serie.map((s) => [s.rotulo, s.vendas, s.total, s.ticketMedio])
      ),
    };
  }
  if (relatorio === 'curva-abc') {
    const linhas = await calcCurvaAbc(req);
    return {
      nome: `curva-abc-${hoje}.csv`,
      texto: csv(
        ['Código', 'Produto', 'Categoria', 'Quantidade', 'Faturamento (R$)', 'Lucro (R$)', 'Percentual', 'Percentual acumulado', 'Classe'],
        linhas.map((l) => [
          l.codigo,
          l.nome,
          l.categoria,
          l.quantidade,
          arred2(l.faturamento),
          arred2(l.lucro),
          arred2(l.percentual),
          arred2(l.percentualAcumulado),
          l.classe,
        ])
      ),
    };
  }
  if (relatorio === 'produtos-parados') {
    const linhas = await calcProdutosParados(req);
    return {
      nome: `produtos-parados-${hoje}.csv`,
      texto: csv(
        ['Produto', 'Estoque', 'Valor do estoque (R$)', 'Última venda'],
        linhas.map((l) => [l.nome, l.estoque, l.valorEstoque, l.ultimaVenda ? dataTexto(new Date(l.ultimaVenda)) : null])
      ),
    };
  }
  const linhas = await calcMargem();
  return {
    nome: `margem-${hoje}.csv`,
    texto: csv(
      ['Código', 'Produto', 'Custo (R$)', 'Venda (R$)', 'Margem (%)', 'Prejuízo'],
      linhas.map((l) => [l.codigo, l.nome, arred2(l.custo), arred2(l.venda), l.margem, l.prejuizo ? 'Sim' : 'Não'])
    ),
  };
}

// ---------- Rotas ----------

router.get(
  '/relatorios/vendas',
  LEITURA,
  asyncHandler(async (req, res) => {
    res.json(await calcVendas(req));
  })
);

router.get(
  '/relatorios/curva-abc',
  LEITURA,
  asyncHandler(async (req, res) => {
    res.json(await calcCurvaAbc(req));
  })
);

router.get(
  '/relatorios/produtos-parados',
  LEITURA,
  asyncHandler(async (req, res) => {
    res.json(await calcProdutosParados(req));
  })
);

router.get(
  '/relatorios/margem',
  LEITURA,
  asyncHandler(async (_req, res) => {
    res.json(await calcMargem());
  })
);

// /relatorios/exportar/vendas.csv, curva-abc.csv, produtos-parados.csv ou margem.csv (mesmos filtros da tela).
router.get(
  '/relatorios/exportar/:relatorio',
  LEITURA,
  asyncHandler(async (req, res) => {
    const relatorio = String(req.params.relatorio).replace(/\.csv$/i, '');
    if (!(RELATORIOS_CSV as readonly string[]).includes(relatorio)) throw new HttpError(404, 'Relatório não encontrado');
    const arquivo = await montarCsv(relatorio, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
    res.send(arquivo.texto);
  })
);

export default router;
