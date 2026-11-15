import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lojaDaRequisicao } from '../../lib/lojas';
import { lerConfiguracao } from '../../lib/email';
import { decifrar } from '../../lib/cripto';
import type { ChavePeriodo } from './ferramentas';
import {
  ROTULO_PERIODO,
  abaixoDoMinimo,
  comprasEmAberto,
  contextoDoMercado,
  dataCurta,
  entregasDaLoja,
  fiadoEmAberto,
  lotesVencendo,
  periodoAnteriorDe,
  periodoDe,
  percentual,
  producaoEPerdas,
  quantidadeTexto,
  reais,
  resumoVendas,
  topProdutos,
} from './ferramentas';

// Assistente IA: "pergunte aos seus dados". Sem chave da Anthropic responde por regras
// (palavras-chave + consultas do banco). Com chave e iaAtiva, a API responde com base nos mesmos dados.
// Perfis: GESTOR, COMPRADOR e ESTOQUISTA.

const router = Router();

const MODELO = 'claude-haiku-5-5';
const TIMEOUT_IA_MS = 20000;
const SISTEMA_IA =
  'Você é o Assistente do mercado. Responda só com base nos DADOS fornecidos, em português, de forma curta.';

const ACESSO = permitir('GESTOR', 'COMPRADOR', 'ESTOQUISTA');

const perguntaSchema = z.object({
  pergunta: z.string().trim().min(1, 'Escreva uma pergunta').max(500, 'Pergunta muito longa'),
});

const EXEMPLOS = [
  'Quanto vendi hoje?',
  'Quanto vendi este mês?',
  'Quais os produtos mais vendidos?',
  'Qual o meu lucro este mês?',
  'Quais produtos estão acabando?',
  'Quais lotes vencem em 7 dias?',
  'Quem está devendo?',
  'Como estão as compras em aberto?',
];

const SUGESTOES: Record<Intencao, string[]> = {
  top: ['Quanto vendi hoje?', 'Qual o meu lucro este mês?', 'Quais produtos estão acabando?'],
  lucro: ['Quanto vendi hoje?', 'Quais os produtos mais vendidos?', 'Quem está devendo?'],
  vendas: ['Quais os produtos mais vendidos?', 'Qual o meu lucro este mês?', 'Quem está devendo?'],
  estoque: ['Quais lotes vencem em 7 dias?', 'Como estão as compras em aberto?', 'Quanto vendi hoje?'],
  validade: ['Quais produtos estão acabando?', 'Quanto foi perdido na produção?', 'Como estão as compras em aberto?'],
  fiado: ['Quanto vendi hoje?', 'Quais os produtos mais vendidos?', 'Como estão as entregas?'],
  compras: ['Quais produtos estão acabando?', 'Quem está devendo?', 'Quais lotes vencem em 7 dias?'],
  producao: ['Quais os produtos mais vendidos?', 'Quais lotes vencem em 7 dias?', 'Como estão as entregas?'],
  entregas: ['Quanto vendi hoje?', 'Quem está devendo?', 'Quanto foi perdido na produção?'],
  ajuda: ['Quanto vendi hoje?', 'Quem está devendo?', 'Quais produtos estão acabando?'],
};

type Intencao =
  | 'top'
  | 'lucro'
  | 'vendas'
  | 'estoque'
  | 'validade'
  | 'fiado'
  | 'compras'
  | 'producao'
  | 'entregas'
  | 'ajuda';

interface CartaoResposta {
  titulo: string;
  linhas: { rotulo: string; valor: string }[];
}

interface RespostaRegras {
  resposta: string;
  cartoes: CartaoResposta[];
  sugestoes: string[];
}

// ---------- Interpretação da pergunta ----------

// Minúsculas, sem acento e sem espaços repetidos: "Quanto vendi hoje?" -> "quanto vendi hoje?".
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordem de prioridade: mais específico primeiro (ex.: "produtos mais vendidos" é ranking, não vendas).
function intencaoDe(t: string): Intencao {
  if (/mais vendid|\btop\b|ranking|campeao|mais saiu/.test(t)) return 'top';
  if (/lucro|margem/.test(t)) return 'lucro';
  if (/\bvend|faturament|receita/.test(t)) return 'vendas';
  if (/estoque baixo|acabando|\brepor\b|comprar|\bfalta\b|abaixo do minimo|estoque minimo/.test(t)) return 'estoque';
  if (/venc|validade/.test(t)) return 'validade';
  if (/fiad|devedor|devend|quem deve/.test(t)) return 'fiado';
  if (/\bcompra|fornecedor|pedido/.test(t)) return 'compras';
  if (/produc|padaria|\bperda|produzi|fornada|quebra|avaria/.test(t)) return 'producao';
  if (/entreg|\brota\b|motorista|delivery/.test(t)) return 'entregas';
  return 'ajuda';
}

// Período citado na pergunta; padrão: hoje.
function periodoDaPergunta(t: string): ChavePeriodo {
  if (/\bontem\b/.test(t)) return 'ontem';
  if (/mes passado/.test(t)) return 'mes_passado';
  if (/\bmes\b/.test(t)) return 'mes';
  if (/semana|7 dias/.test(t)) return 'semana';
  return 'hoje';
}

// ---------- Respostas por regras ----------

async function responderVendas(lojaId: number, chave: ChavePeriodo, agora: Date): Promise<RespostaRegras> {
  const rotulo = ROTULO_PERIODO[chave];
  const [atual, anterior] = await Promise.all([
    resumoVendas(lojaId, periodoDe(chave, agora)),
    resumoVendas(lojaId, periodoAnteriorDe(chave, agora)),
  ]);

  if (atual.quantidade === 0) {
    return {
      resposta: `Nenhuma venda concluída (${rotulo.toLowerCase()}).`,
      cartoes: [],
      sugestoes: SUGESTOES.vendas,
    };
  }

  let comparacao = 'Sem vendas no período anterior para comparar.';
  if (anterior.total > 0) {
    const variacao = ((atual.total - anterior.total) / anterior.total) * 100;
    comparacao = `${variacao >= 0 ? 'Subiu' : 'Caiu'} ${percentual(Math.abs(variacao))} em relação ao período anterior (${reais(anterior.total)}).`;
  }

  return {
    resposta: `${rotulo}: ${atual.quantidade} venda(s) somando ${reais(atual.total)}. Ticket médio de ${reais(atual.ticketMedio)}. ${comparacao}`,
    cartoes: [
      {
        titulo: `Vendas: ${rotulo.toLowerCase()}`,
        linhas: [
          { rotulo: 'Total vendido', valor: reais(atual.total) },
          { rotulo: 'Nº de vendas', valor: String(atual.quantidade) },
          { rotulo: 'Ticket médio', valor: reais(atual.ticketMedio) },
          { rotulo: 'Período anterior', valor: reais(anterior.total) },
        ],
      },
    ],
    sugestoes: SUGESTOES.vendas,
  };
}

async function responderTop(lojaId: number, chave: ChavePeriodo, agora: Date): Promise<RespostaRegras> {
  const rotulo = ROTULO_PERIODO[chave];
  const top = await topProdutos(lojaId, periodoDe(chave, agora), 5);

  if (top.porQuantidade.length === 0) {
    return { resposta: `Nenhuma venda concluída (${rotulo.toLowerCase()}).`, cartoes: [], sugestoes: SUGESTOES.top };
  }

  const linhasQtd = top.porQuantidade.map((p) => ({ rotulo: p.nome, valor: quantidadeTexto(p.quantidade, p.unidade) }));
  const linhasValor = top.porFaturamento.map((p) => ({ rotulo: p.nome, valor: reais(p.total) }));
  const listaQtd = top.porQuantidade.map((p, i) => `${i + 1}. ${p.nome}: ${quantidadeTexto(p.quantidade, p.unidade)}`);
  const listaValor = top.porFaturamento.map((p, i) => `${i + 1}. ${p.nome}: ${reais(p.total)}`);

  return {
    resposta: [
      `Mais vendidos (${rotulo.toLowerCase()}) por quantidade:`,
      ...listaQtd,
      'Maiores faturamentos:',
      ...listaValor,
    ].join('\n'),
    cartoes: [
      { titulo: 'Mais vendidos por quantidade', linhas: linhasQtd },
      { titulo: 'Maiores faturamentos', linhas: linhasValor },
    ],
    sugestoes: SUGESTOES.top,
  };
}

async function responderLucro(lojaId: number, chave: ChavePeriodo, agora: Date): Promise<RespostaRegras> {
  const rotulo = ROTULO_PERIODO[chave];
  const r = await resumoVendas(lojaId, periodoDe(chave, agora));

  if (r.quantidade === 0) {
    return { resposta: `Nenhuma venda concluída (${rotulo.toLowerCase()}), então não há lucro para mostrar.`, cartoes: [], sugestoes: SUGESTOES.lucro };
  }

  return {
    resposta: `${rotulo}: faturamento de ${reais(r.total)}, custo das mercadorias de ${reais(r.custo)}, lucro bruto de ${reais(r.lucro)} e margem de ${percentual(r.margem)}.`,
    cartoes: [
      {
        titulo: `Lucro: ${rotulo.toLowerCase()}`,
        linhas: [
          { rotulo: 'Faturamento', valor: reais(r.total) },
          { rotulo: 'Custo das mercadorias', valor: reais(r.custo) },
          { rotulo: 'Lucro bruto', valor: reais(r.lucro) },
          { rotulo: 'Margem', valor: percentual(r.margem) },
        ],
      },
    ],
    sugestoes: SUGESTOES.lucro,
  };
}

async function responderEstoque(lojaId: number): Promise<RespostaRegras> {
  const baixo = await abaixoDoMinimo(lojaId, 10);

  if (baixo.total === 0) {
    return { resposta: 'Nenhum produto abaixo do estoque mínimo nesta loja.', cartoes: [], sugestoes: SUGESTOES.estoque };
  }

  const lista = baixo.itens.map(
    (i) => `- ${i.nome}: ${quantidadeTexto(i.quantidade, i.unidade)} (mínimo ${quantidadeTexto(i.estoqueMinimo)})`
  );

  return {
    resposta: [
      `${baixo.total} produto(s) abaixo do estoque mínimo. Os mais críticos:`,
      ...lista,
      'Abra Sugestão de compra para montar o pedido.',
    ].join('\n'),
    cartoes: [
      {
        titulo: 'Abaixo do mínimo',
        linhas: baixo.itens.map((i) => ({
          rotulo: i.nome,
          valor: `${quantidadeTexto(i.quantidade, i.unidade)} de ${quantidadeTexto(i.estoqueMinimo)}`,
        })),
      },
    ],
    sugestoes: SUGESTOES.estoque,
  };
}

async function responderValidade(lojaId: number): Promise<RespostaRegras> {
  const lotes = await lotesVencendo(lojaId, 7, 10);

  if (lotes.total === 0) {
    return { resposta: 'Nenhum lote vence nos próximos 7 dias.', cartoes: [], sugestoes: SUGESTOES.validade };
  }

  const lista = lotes.lotes.map(
    (l) => `- ${l.produto}: vence em ${dataCurta(new Date(l.validade))} (${quantidadeTexto(l.quantidade, l.unidade)})`
  );

  return {
    resposta: [`${lotes.total} lote(s) vencem nos próximos 7 dias:`, ...lista].join('\n'),
    cartoes: [
      {
        titulo: 'Vencendo em 7 dias',
        linhas: lotes.lotes.map((l) => ({
          rotulo: l.produto,
          valor: `${dataCurta(new Date(l.validade))} · ${quantidadeTexto(l.quantidade, l.unidade)}`,
        })),
      },
    ],
    sugestoes: SUGESTOES.validade,
  };
}

async function responderFiado(): Promise<RespostaRegras> {
  const fiado = await fiadoEmAberto(5);

  if (fiado.devedores === 0) {
    return { resposta: 'Nenhum cliente com fiado em aberto.', cartoes: [], sugestoes: SUGESTOES.fiado };
  }

  const lista = fiado.top.map((c, i) => `${i + 1}. ${c.nome}: ${reais(c.saldo)}`);

  return {
    resposta: [`Total em aberto no fiado: ${reais(fiado.total)} de ${fiado.devedores} cliente(s). Maiores devedores:`, ...lista].join('\n'),
    cartoes: [
      {
        titulo: 'Fiado em aberto',
        linhas: [
          { rotulo: 'Total em aberto', valor: reais(fiado.total) },
          { rotulo: 'Clientes devedores', valor: String(fiado.devedores) },
        ],
      },
      {
        titulo: 'Maiores devedores',
        linhas: fiado.top.map((c) => ({ rotulo: c.nome, valor: reais(c.saldo) })),
      },
    ],
    sugestoes: SUGESTOES.fiado,
  };
}

async function responderCompras(lojaId: number): Promise<RespostaRegras> {
  const compras = await comprasEmAberto(lojaId);

  if (compras.quantidade === 0) {
    return { resposta: 'Nenhum pedido de compra em aberto.', cartoes: [], sugestoes: SUGESTOES.compras };
  }

  const lista = compras.porStatus.map((s) => `- ${s.rotulo}: ${s.quantidade} pedido(s), ${reais(s.total)}`);

  return {
    resposta: [`${compras.quantidade} pedido(s) de compra em aberto, somando ${reais(compras.total)}:`, ...lista].join('\n'),
    cartoes: [
      {
        titulo: 'Pedidos de compra em aberto',
        linhas: compras.porStatus.map((s) => ({ rotulo: s.rotulo, valor: `${s.quantidade} · ${reais(s.total)}` })),
      },
    ],
    sugestoes: SUGESTOES.compras,
  };
}

async function responderProducao(lojaId: number, chave: ChavePeriodo, agora: Date): Promise<RespostaRegras> {
  const rotulo = ROTULO_PERIODO[chave];
  const p = await producaoEPerdas(lojaId, periodoDe(chave, agora));

  return {
    resposta: `${rotulo}: ${p.fornadas} fornada(s) concluída(s), ${quantidadeTexto(p.produzido)} produzidos. Perdas: ${quantidadeTexto(p.quantidadePerdida)}, com custo de ${reais(p.custoPerdido)}.`,
    cartoes: [
      {
        titulo: `Produção: ${rotulo.toLowerCase()}`,
        linhas: [
          { rotulo: 'Fornadas concluídas', valor: String(p.fornadas) },
          { rotulo: 'Produzido', valor: quantidadeTexto(p.produzido) },
          { rotulo: 'Perdas (quantidade)', valor: quantidadeTexto(p.quantidadePerdida) },
          { rotulo: 'Perdas (custo)', valor: reais(p.custoPerdido) },
        ],
      },
    ],
    sugestoes: SUGESTOES.producao,
  };
}

async function responderEntregas(lojaId: number): Promise<RespostaRegras> {
  const e = await entregasDaLoja(lojaId);

  return {
    resposta: `Entregas: ${e.pendentes} pendente(s), ${e.emRota} em rota e ${e.entreguesHoje} entregue(s) hoje.`,
    cartoes: [
      {
        titulo: 'Entregas',
        linhas: [
          { rotulo: 'Pendentes', valor: String(e.pendentes) },
          { rotulo: 'Em rota', valor: String(e.emRota) },
          { rotulo: 'Entregues hoje', valor: String(e.entreguesHoje) },
        ],
      },
    ],
    sugestoes: SUGESTOES.entregas,
  };
}

function responderAjuda(): RespostaRegras {
  return {
    resposta: ['Não entendi a pergunta. Experimente perguntas como:', ...EXEMPLOS.map((e) => `- ${e}`)].join('\n'),
    cartoes: [],
    sugestoes: SUGESTOES.ajuda,
  };
}

const SO_GESTOR: RespostaRegras = {
  resposta: 'Esta informação é só para o gestor.',
  cartoes: [],
  sugestoes: SUGESTOES.ajuda,
};

async function responderPorRegras(lojaId: number, pergunta: string, agora: Date, gestor: boolean): Promise<RespostaRegras> {
  const t = normalizar(pergunta);
  const intencao = intencaoDe(t);
  const chave = periodoDaPergunta(t);

  switch (intencao) {
    case 'top':
      return responderTop(lojaId, chave, agora);
    case 'lucro':
      return gestor ? responderLucro(lojaId, chave, agora) : SO_GESTOR;
    case 'vendas':
      return responderVendas(lojaId, chave, agora);
    case 'estoque':
      return responderEstoque(lojaId);
    case 'validade':
      return responderValidade(lojaId);
    case 'fiado':
      return gestor ? responderFiado() : SO_GESTOR;
    case 'compras':
      return responderCompras(lojaId);
    case 'producao':
      return responderProducao(lojaId, chave, agora);
    case 'entregas':
      return responderEntregas(lojaId);
    case 'ajuda':
    default:
      return responderAjuda();
  }
}

// ---------- Resposta pela API da Anthropic ----------

async function perguntarIA(chave: string, pergunta: string, contexto: unknown): Promise<string> {
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), TIMEOUT_IA_MS);
  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 800,
        system: SISTEMA_IA,
        messages: [
          {
            role: 'user',
            content: `Pergunta: ${pergunta}\n\nDADOS (JSON):\n${JSON.stringify(contexto)}`,
          },
        ],
      }),
      signal: controle.signal,
    });
    if (!resposta.ok) throw new Error(`A API respondeu ${resposta.status}`);

    const dados = (await resposta.json()) as { content?: { type?: string; text?: string }[] };
    const texto = (dados.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    if (!texto) throw new Error('Resposta vazia da API');
    return texto;
  } finally {
    clearTimeout(tempo);
  }
}

// ---------- Rotas ----------

// Pergunta ao assistente. Sem chave (ou se a IA falhar) responde por regras.
router.post(
  '/assistente/perguntar',
  ACESSO,
  asyncHandler(async (req, res) => {
    const { pergunta } = validar(perguntaSchema, req.body);
    const lojaId = await lojaDaRequisicao(req);
    const agora = new Date();

    const gestor = req.usuario.perfil === 'GESTOR';
    const regras = await responderPorRegras(lojaId, pergunta, agora, gestor);
    let resposta = regras.resposta;
    let fonte: 'regras' | 'ia' = 'regras';

    // Lucro e fiado são só do gestor: para os outros perfis a IA nem é chamada.
    const intencaoRestrita = intencaoDe(normalizar(pergunta));
    const restrita = !gestor && (intencaoRestrita === 'lucro' || intencaoRestrita === 'fiado');

    try {
      const config = await lerConfiguracao();
      if (!restrita && config.iaAtiva && config.iaChaveCifrada) {
        const chave = decifrar(config.iaChaveCifrada);
        if (!chave) throw new Error('Chave da IA ilegível');
        const contexto = await contextoDoMercado(lojaId, agora, gestor);
        resposta = await perguntarIA(chave, pergunta, contexto);
        fonte = 'ia';
      }
    } catch {
      // Sem chave, chave inválida, tempo esgotado ou erro da API: fica com a resposta por regras.
      resposta = regras.resposta;
      fonte = 'regras';
    }

    await prisma.perguntaAssistente.create({
      data: { usuarioId: req.usuario.id, pergunta, resposta },
    });

    res.json({
      resposta,
      cartoes: regras.cartoes,
      fonte,
      sugestoes: regras.sugestoes,
    });
  })
);

// Últimas 30 perguntas do usuário, da mais nova para a mais antiga.
router.get(
  '/assistente/historico',
  ACESSO,
  asyncHandler(async (req, res) => {
    const itens = await prisma.perguntaAssistente.findMany({
      where: { usuarioId: req.usuario.id },
      orderBy: { criadoEm: 'desc' },
      take: 30,
      select: { id: true, pergunta: true, resposta: true, criadoEm: true },
    });
    res.json(itens.map((i) => ({ ...i, criadoEm: i.criadoEm.toISOString() })));
  })
);

router.get(
  '/assistente/exemplos',
  ACESSO,
  asyncHandler(async (_req, res) => {
    res.json(EXEMPLOS);
  })
);

export default router;
