import { Router } from 'express';
import * as net from 'net';
import { z } from 'zod';
import type { ConfiguracaoPlataforma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lerConfiguracao } from '../../lib/email';
import { num } from '../../lib/numeros';
import { calcularPreco, promocoesVigentes } from '../../lib/precos';
import { etiquetaZpl } from '../../lib/zpl';
import type { DadosEtiquetaZpl, OpcoesZpl } from '../../lib/zpl';

// Impressão de etiquetas de gôndola na Zebra (ZPL pela rede, porta RAW 9100) e download do arquivo .zpl.
const router = Router();

const IMPRESSAO = permitir('GESTOR', 'ESTOQUISTA', 'COMPRADOR');
const TIMEOUT_ZEBRA_MS = 5000;
const SEM_IP = 'Configure o IP da Zebra em Configurações > Mercado';

function dataHoje(): string {
  return new Date().toLocaleDateString('pt-BR');
}

// Medidas e DPI da etiqueta, lidos da configuração do mercado.
function zplDe(c: ConfiguracaoPlataforma): OpcoesZpl {
  return { larguraMm: c.etiquetaLarguraMm, alturaMm: c.etiquetaAlturaMm, dpi: c.zebraDpi };
}

// Ids pedidos na query (?ids=1,2,3), só inteiros positivos.
function idsDaQuery(valor: unknown): number[] {
  return String(valor ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 500);
}

// Etiquetas pendentes pedidas, na ordem dos ids, com o preço que vale agora (promoção incluída).
async function carregarEtiquetas(ids: number[]): Promise<{ id: number; dados: DadosEtiquetaZpl }[]> {
  const lista = await prisma.etiquetaPendente.findMany({
    where: { id: { in: ids } },
    include: { produto: true },
    orderBy: { id: 'asc' },
  });
  if (lista.length === 0) throw new HttpError(404, 'Nenhuma etiqueta encontrada');

  const promocoes = await promocoesVigentes(
    lista.map((e) => ({ id: e.produto.id, categoriaId: e.produto.categoriaId })),
  );
  const data = dataHoje();

  return lista.map((e) => {
    const p = e.produto;
    const preco = calcularPreco(p, 1, promocoes);
    const emOferta = preco.origem === 'PROMOCAO';
    const temAtacado = p.precoAtacado !== null && p.qtdAtacado !== null;
    return {
      id: e.id,
      dados: {
        nome: p.nome,
        preco: emOferta ? preco.precoUnitario : preco.precoTabela,
        unidade: p.unidade,
        codigo: p.codigo,
        ean: p.ean,
        data,
        precoAntigo: emOferta ? preco.precoTabela : null,
        oferta: emOferta ? preco.descricaoPromocao : null,
        atacado: temAtacado ? { quantidade: num(p.qtdAtacado), preco: num(p.precoAtacado) } : null,
      },
    };
  });
}

// ZPL de todas as etiquetas, cada uma repetida `copias` vezes.
function gerarZpl(etiquetas: DadosEtiquetaZpl[], opcoes: OpcoesZpl, copias: number): string {
  return etiquetas
    .flatMap((e) => Array.from({ length: copias }, () => etiquetaZpl(e, opcoes)))
    .join('\n');
}

// Envia o ZPL à impressora pela rede. Qualquer falha de conexão vira 502 com mensagem clara.
function enviarZebra(ip: string, porta: number, conteudo: string): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const falha = () =>
      new HttpError(
        502,
        `Não consegui conectar na Zebra em ${ip}:${porta}. Confira o IP, a porta e se ela está ligada na rede.`,
      );
    const socket = net.createConnection({ host: ip, port: porta });
    let concluido = false;
    const encerrar = (erro?: HttpError) => {
      if (concluido) return;
      concluido = true;
      socket.destroy();
      if (erro) rejeitar(erro);
      else resolver();
    };
    socket.setTimeout(TIMEOUT_ZEBRA_MS, () => encerrar(falha()));
    socket.once('error', () => encerrar(falha()));
    socket.once('connect', () => {
      socket.end(conteudo, () => encerrar());
    });
  });
}

// ---------- Rotas ----------

// Envia as etiquetas pendentes para a Zebra e marca como impressas.
router.post(
  '/impressao/zebra',
  IMPRESSAO,
  asyncHandler(async (req, res) => {
    const dados = validar(
      z.object({
        etiquetaIds: z.array(z.number().int().positive()).min(1, 'Escolha ao menos uma etiqueta').max(500),
        copias: z.number().int().min(1).max(50).optional(),
      }),
      req.body,
    );
    const copias = dados.copias ?? 1;
    const c = await lerConfiguracao();
    if (!c.zebraIp) throw new HttpError(400, SEM_IP);

    const lista = await carregarEtiquetas(Array.from(new Set(dados.etiquetaIds)));
    const conteudo = gerarZpl(
      lista.map((l) => l.dados),
      zplDe(c),
      copias,
    );
    await enviarZebra(c.zebraIp, c.zebraPorta, conteudo);

    const marcadas = await prisma.etiquetaPendente.updateMany({
      where: { id: { in: lista.map((l) => l.id) }, impressaEm: null },
      data: { impressaEm: new Date() },
    });
    res.json({ enviadas: lista.length, copias, impressas: marcadas.count });
  }),
);

// Arquivo .zpl das etiquetas, para enviar a mão à impressora. Não marca como impressas.
router.get(
  '/impressao/zebra.zpl',
  IMPRESSAO,
  asyncHandler(async (req, res) => {
    const ids = idsDaQuery(req.query.ids);
    if (ids.length === 0) throw new HttpError(400, 'Informe as etiquetas em ?ids=1,2,3');
    const c = await lerConfiguracao();
    const lista = await carregarEtiquetas(ids);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="etiquetas.zpl"');
    res.send(gerarZpl(lista.map((l) => l.dados), zplDe(c), 1));
  }),
);

// Etiqueta de teste na Zebra (confere IP, porta e tamanho sem mexer em produtos).
router.post(
  '/impressao/teste',
  IMPRESSAO,
  asyncHandler(async (_req, res) => {
    const c = await lerConfiguracao();
    if (!c.zebraIp) throw new HttpError(400, SEM_IP);
    const zpl = etiquetaZpl(
      {
        nome: 'ETIQUETA DE TESTE',
        preco: 9.99,
        unidade: 'UN',
        codigo: 'TESTE01',
        ean: null,
        data: dataHoje(),
      },
      zplDe(c),
    );
    await enviarZebra(c.zebraIp, c.zebraPorta, zpl);
    res.json({ ok: true });
  }),
);

export default router;
