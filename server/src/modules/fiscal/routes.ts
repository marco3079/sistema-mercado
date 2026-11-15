import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { arred2, fimDoDia, inicioDoDia, num, periodoDaQuery } from '../../lib/numeros';
import { emitirNotaVenda } from '../../lib/fiscal';
import { criarZip } from '../../lib/zip';
import type { ArquivoZip } from '../../lib/zip';
import { emailHabilitado, enderecoDoSite, enfileirarEmail, lerConfiguracao } from '../../lib/email';

// Notas fiscais (NFC-e / NF-e) e área do contador.
// Gestor: emite, lista, cancela e manda o aviso ao contador. Operador: só emite a nota da venda.
// Contador: lista, baixa XML e baixa o ZIP do mês.

const router = Router();

const PRAZO_CANCELAMENTO_NFCE_MS = 30 * 60 * 1000; // 30 min (regra da NFC-e)
const INTERVALO_ENVIO_AUTOMATICO_MS = 6 * 60 * 60 * 1000;

const include = {
  venda: { select: { numero: true, cliente: { select: { nome: true } } } },
} as const;

type NotaComVenda = Prisma.NotaFiscalGetPayload<{ include: typeof include }>;

function notaDTO(n: NotaComVenda) {
  return {
    id: n.id,
    modelo: n.modelo,
    numero: n.numero,
    serie: n.serie,
    chave: n.chave,
    status: n.status,
    valor: num(n.valor),
    criadoEm: n.criadoEm.toISOString(),
    autorizadaEm: n.autorizadaEm ? n.autorizadaEm.toISOString() : null,
    vendaId: n.vendaId,
    vendaNumero: n.venda?.numero ?? null,
    cliente: n.venda?.cliente?.nome ?? null,
    motivo: n.motivo,
    enviadaContadorEm: n.enviadaContadorEm ? n.enviadaContadorEm.toISOString() : null,
  };
}

// null = todas as lojas; senão só a loja escolhida.
function escopoLoja(lojaId: number | null): { lojaId?: number } {
  return lojaId === null ? {} : { lojaId };
}

const pad = (n: number) => String(n).padStart(2, '0');

function diaIso(data: Date): string {
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

function diaBr(data: Date): string {
  return `${pad(data.getDate())}/${pad(data.getMonth() + 1)}/${data.getFullYear()}`;
}

function mesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}`;
}

// Valida AAAA-MM. Sem valor: mês atual.
function mesValido(valor: unknown): string {
  if (valor === undefined || valor === null || valor === '') return mesAtual();
  if (typeof valor !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) {
    throw new HttpError(400, 'Mês inválido (use AAAA-MM)');
  }
  return valor;
}

function limitesDoMes(mes: string): { inicio: Date; fim: Date } {
  const [ano, mesNumero] = mes.split('-').map(Number);
  return {
    inicio: inicioDoDia(new Date(ano, mesNumero - 1, 1)),
    fim: fimDoDia(new Date(ano, mesNumero, 0)),
  };
}

function nomeDoXml(n: { id: number; chave: string | null }): string {
  return n.chave ?? `nota-${n.id}`;
}

// Totais: quantidade = todas as notas do filtro; valor e autorizadas/canceladas pela situação.
function totaisDe(notas: { status: string; valor: Prisma.Decimal }[]) {
  const autorizadas = notas.filter((n) => n.status === 'AUTORIZADA');
  return {
    quantidade: notas.length,
    valor: arred2(autorizadas.reduce((s, n) => s + num(n.valor), 0)),
    autorizadas: autorizadas.length,
    canceladas: notas.filter((n) => n.status === 'CANCELADA').length,
  };
}

// ---------- Notas ----------

const MODELOS = ['NFCE', 'NFE'] as const;
const STATUS_NOTA = ['PENDENTE', 'AUTORIZADA', 'REJEITADA', 'CANCELADA'] as const;

function escolhido<T extends string>(valor: unknown, opcoes: readonly T[]): T | undefined {
  return typeof valor === 'string' && (opcoes as readonly string[]).includes(valor) ? (valor as T) : undefined;
}

router.get(
  '/fiscal/notas',
  permitir('GESTOR', 'CONTADOR'),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const modelo = escolhido(req.query.modelo, MODELOS);
    const status = escolhido(req.query.status, STATUS_NOTA);
    const linhas = await prisma.notaFiscal.findMany({
      where: {
        ...escopoLoja(lojaId),
        criadoEm: { gte: inicio, lte: fim },
        ...(modelo ? { modelo } : {}),
        ...(status ? { status } : {}),
      },
      include,
      orderBy: { criadoEm: 'desc' },
    });
    res.json({ itens: linhas.map(notaDTO), totais: totaisDe(linhas) });
  })
);

router.get(
  '/fiscal/notas/:id/xml',
  permitir('GESTOR', 'CONTADOR'),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const nota = await prisma.notaFiscal.findFirst({
      where: { id: idParam(req), ...escopoLoja(lojaId) },
      select: { id: true, chave: true, xml: true },
    });
    if (!nota || !nota.xml) throw new HttpError(404, 'XML não encontrado para esta nota');
    res.attachment(`${nomeDoXml(nota)}.xml`);
    res.type('application/xml');
    res.send(nota.xml);
  })
);

// Emite a nota de uma venda concluída, sem nota autorizada. Operador também pode.
const emitirSchema = z.object({ modelo: z.enum(MODELOS).optional() });

router.post(
  '/fiscal/vendas/:vendaId/emitir',
  permitir('GESTOR', 'OPERADOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(emitirSchema, req.body ?? {});
    const lojaId = await lojaDaRequisicao(req);
    const vendaId = idParam(req, 'vendaId');
    const config = await lerConfiguracao();
    if (config.fiscalProvedor === 'NENHUM') {
      throw new HttpError(400, 'Nenhum serviço emissor configurado para emitir a nota');
    }
    const notaId = await prisma.$transaction(async (tx) => {
      const venda = await tx.venda.findFirst({ where: { id: vendaId, lojaId }, select: { id: true, status: true } });
      if (!venda) throw new HttpError(404, 'Venda não encontrada');
      if (venda.status !== 'CONCLUIDA') throw new HttpError(400, 'Só é possível emitir nota de venda concluída');
      const autorizada = await tx.notaFiscal.findFirst({
        where: { vendaId, status: 'AUTORIZADA' },
        select: { id: true },
      });
      if (autorizada) throw new HttpError(409, 'Esta venda já tem nota autorizada');
      const id = await emitirNotaVenda(tx, vendaId, dados.modelo ?? 'NFCE');
      if (id === null) throw new HttpError(400, 'Nenhum serviço emissor configurado para emitir a nota');
      return id;
    });
    const nota = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: notaId }, include });
    res.status(201).json(notaDTO(nota));
  })
);

const cancelarSchema = z.object({
  motivo: z.string().trim().min(15, 'O motivo precisa ter pelo menos 15 caracteres'),
});

router.post(
  '/fiscal/notas/:id/cancelar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(cancelarSchema, req.body ?? {});
    const lojaId = await filtroLoja(req);
    const nota = await prisma.notaFiscal.findFirst({
      where: { id: idParam(req), ...escopoLoja(lojaId) },
      include,
    });
    if (!nota) throw new HttpError(404, 'Nota não encontrada');
    if (nota.status !== 'AUTORIZADA') throw new HttpError(400, 'Só é possível cancelar nota autorizada');
    const referencia = nota.autorizadaEm ?? nota.criadoEm;
    if (nota.modelo === 'NFCE' && Date.now() - referencia.getTime() > PRAZO_CANCELAMENTO_NFCE_MS) {
      throw new HttpError(400, 'Prazo de cancelamento encerrado (30 min)');
    }
    const atualizada = await prisma.notaFiscal.update({
      where: { id: nota.id },
      data: { status: 'CANCELADA', motivo: dados.motivo },
      include,
    });
    res.json(notaDTO(atualizada));
  })
);

router.get(
  '/fiscal/resumo',
  permitir('GESTOR', 'CONTADOR'),
  asyncHandler(async (req, res) => {
    const lojaId = await filtroLoja(req);
    const { inicio, fim } = periodoDaQuery(req.query, 30);
    const notas = await prisma.notaFiscal.findMany({
      where: { ...escopoLoja(lojaId), criadoEm: { gte: inicio, lte: fim } },
      select: { modelo: true, criadoEm: true, status: true, valor: true },
    });

    const porDia = new Map<string, { dia: string; modelo: string; notas: typeof notas }>();
    const porModelo = new Map<string, typeof notas>();
    for (const n of notas) {
      const chaveDia = `${diaIso(n.criadoEm)}|${n.modelo}`;
      const grupoDia = porDia.get(chaveDia) ?? { dia: diaIso(n.criadoEm), modelo: n.modelo, notas: [] };
      grupoDia.notas.push(n);
      porDia.set(chaveDia, grupoDia);
      porModelo.set(n.modelo, [...(porModelo.get(n.modelo) ?? []), n]);
    }

    res.json({
      porDia: [...porDia.values()]
        .map((g) => ({ dia: g.dia, modelo: g.modelo, ...totaisDe(g.notas) }))
        .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.modelo.localeCompare(b.modelo))),
      porModelo: [...porModelo.entries()].map(([modelo, lista]) => ({ modelo, ...totaisDe(lista) })),
    });
  })
);

// ---------- Área do contador ----------

async function notasDoMes(mes: string, lojaId: number | null) {
  const { inicio, fim } = limitesDoMes(mes);
  return prisma.notaFiscal.findMany({
    where: { ...escopoLoja(lojaId), criadoEm: { gte: inicio, lte: fim } },
    orderBy: { criadoEm: 'asc' },
  });
}

function resumoDoMes(mes: string, notas: Awaited<ReturnType<typeof notasDoMes>>) {
  const totais = totaisDe(notas);
  const ultimoEnvio = notas.reduce<Date | null>((maior, n) => {
    if (!n.enviadaContadorEm) return maior;
    return maior === null || n.enviadaContadorEm > maior ? n.enviadaContadorEm : maior;
  }, null);
  return {
    mes,
    notas: notas.length,
    valor: totais.valor,
    canceladas: totais.canceladas,
    enviadoEm: ultimoEnvio ? ultimoEnvio.toISOString() : null,
  };
}

function csvDoMes(notas: Awaited<ReturnType<typeof notasDoMes>>): string {
  const celula = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
  const linhas = [
    ['número', 'série', 'modelo', 'chave', 'data', 'valor', 'status'],
    ...notas.map((n) => [
      n.numero,
      n.serie,
      n.modelo,
      n.chave ?? '',
      diaBr(n.criadoEm),
      num(n.valor).toFixed(2).replace('.', ','),
      n.status,
    ]),
  ];
  // BOM no início para o Excel abrir os acentos certo; ponto e vírgula é o separador do Excel em português.
  return '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
}

router.get(
  '/contador/arquivos',
  permitir('GESTOR', 'CONTADOR'),
  asyncHandler(async (req, res) => {
    const mes = mesValido(req.query.mes);
    const lojaId = await filtroLoja(req);
    res.json(resumoDoMes(mes, await notasDoMes(mes, lojaId)));
  })
);

router.get(
  '/contador/arquivos/:mes.zip',
  permitir('GESTOR', 'CONTADOR'),
  asyncHandler(async (req, res) => {
    const mes = mesValido(req.params.mes);
    const lojaId = await filtroLoja(req);
    const notas = await notasDoMes(mes, lojaId);
    const arquivos: ArquivoZip[] = [];
    for (const n of notas) {
      if (!n.xml) continue;
      arquivos.push({ nome: `${n.modelo === 'NFE' ? 'NFe' : 'NFCe'}/${nomeDoXml(n)}.xml`, conteudo: n.xml });
    }
    arquivos.push({ nome: 'resumo.csv', conteudo: csvDoMes(notas) });
    res.attachment(`notas-${mes}.zip`);
    res.type('application/zip');
    res.send(criarZip(arquivos));
  })
);

type ResultadoEnvio = { enviado: boolean; simulado: boolean; mensagem: string };

// Põe na fila o aviso ao contador e marca as notas do mês como enviadas.
// Sem e-mail do contador ou com e-mail desligado, nada sai (desligado = simulado).
async function enviarAvisoContador(mes: string, lojaId: number | null): Promise<ResultadoEnvio> {
  const config = await lerConfiguracao();
  if (!config.contadorEmail) {
    return { enviado: false, simulado: false, mensagem: 'Informe o e-mail do contador em Configurações > Mercado.' };
  }
  const notas = await notasDoMes(mes, lojaId);
  if (notas.length === 0) {
    return { enviado: false, simulado: false, mensagem: 'Não há notas neste mês.' };
  }
  if (!(await emailHabilitado('CONTADOR'))) {
    return {
      enviado: false,
      simulado: true,
      mensagem: 'E-mail desligado: o aviso ao contador foi simulado e nada foi enviado.',
    };
  }

  const [ano, mesNumero] = mes.split('-');
  const site = (await enderecoDoSite())?.replace(/\/+$/, '') ?? null;
  const endereco = site ? `${site}/contador/contador` : null;
  enfileirarEmail({
    para: config.contadorEmail,
    assunto: `Notas fiscais de ${mesNumero}/${ano}`,
    titulo: 'Arquivos fiscais do mês disponíveis',
    paragrafos: [
      `Os XML das notas de ${mesNumero}/${ano} e o resumo do mês já estão disponíveis na área do contador.`,
      'Entre no sistema com o seu usuário para baixar o arquivo .zip com os XML e o resumo.csv.',
    ],
    botao: endereco ? { rotulo: 'Abrir a área do contador', endereco } : undefined,
    tipo: 'CONTADOR',
  });
  await prisma.notaFiscal.updateMany({
    where: { id: { in: notas.map((n) => n.id) } },
    data: { enviadaContadorEm: new Date() },
  });
  return { enviado: true, simulado: false, mensagem: `Aviso colocado na fila de envio para ${config.contadorEmail}.` };
}

const enviarSchema = z.object({ mes: z.string().optional() });

router.post(
  '/contador/enviar',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(enviarSchema, req.body ?? {});
    const mes = mesValido(dados.mes);
    const lojaId = await filtroLoja(req);
    res.json(await enviarAvisoContador(mes, lojaId));
  })
);

// Envio automático: no dia configurado, manda o aviso do mês anterior (se ainda não foi enviado).
async function envioAutomatico(): Promise<void> {
  try {
    const config = await lerConfiguracao();
    if (!config.contadorEnvioAutomatico) return;
    const hoje = new Date();
    if (hoje.getDate() < config.contadorDiaEnvio) return;
    const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const mes = `${anterior.getFullYear()}-${pad(anterior.getMonth() + 1)}`;
    const notas = await notasDoMes(mes, null);
    if (notas.length === 0 || notas.some((n) => n.enviadaContadorEm)) return;
    await enviarAvisoContador(mes, null);
  } catch (erro) {
    console.error('Envio automático ao contador falhou:', erro instanceof Error ? erro.message : erro);
  }
}

const temporizadorAutomatico = setInterval(() => {
  void envioAutomatico();
}, INTERVALO_ENVIO_AUTOMATICO_MS);
temporizadorAutomatico.unref();

export default router;
