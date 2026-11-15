import express, { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { num, numOuNull } from '../../lib/numeros';

// Rastreadores GPS (tags): cadastro, posição atual, histórico e recepção pelo protocolo OsmAnd
// (app Traccar Client ou servidor Traccar com encaminhamento). Só a própria tabela de posições
// guarda o histórico; a última posição fica no rastreador.

const router = Router();
export const publico = Router();
export default router;

const SEM_SINAL_E_ONLINE_MS = 5 * 60 * 1000;
const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;
const LIMITE_POR_MINUTO = 120;
const POSICAO_PADRAO_SP = { lat: -23.5505, lng: -46.6333 };

const TIPOS = ['VEICULO', 'MOTORISTA', 'CARRINHO', 'PALETE', 'EQUIPAMENTO', 'OUTRO'] as const;

// ---------- Validação ----------

const rastreadorSchema = z.object({
  identificador: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{3,64}$/, 'Identificador: de 3 a 64 letras, números, ponto, traço, dois-pontos ou _'),
  nome: z.string().trim().min(1, 'Informe o nome').max(80, 'Nome muito longo'),
  tipo: z.enum(TIPOS),
  veiculoId: z.number().int().positive().nullable().optional(),
  usuarioId: z.number().int().positive().nullable().optional(),
  ativo: z.boolean().optional(),
  observacoes: z.string().trim().max(500, 'Observações muito longas').nullable().optional(),
});

const atualizacaoSchema = rastreadorSchema.partial();

type DadosRastreador = z.infer<typeof rastreadorSchema>;
type AtualizacaoRastreador = z.infer<typeof atualizacaoSchema>;

// Igual ao validar() comum, mas devolve a primeira mensagem de erro (ex.: formato do identificador).
function validarComMensagem<T>(schema: z.ZodType<T>, dados: unknown): T {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) {
    const primeira = resultado.error.issues[0];
    throw new HttpError(400, primeira?.message ?? 'Dados inválidos', resultado.error.issues);
  }
  return resultado.data;
}

// ---------- Formato de resposta ----------

const inclusao = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  usuario: { select: { id: true, nome: true } },
} as const;

type RastreadorComVinculos = Prisma.RastreadorGpsGetPayload<{ include: typeof inclusao }>;

function estaOnline(ultimoSinalEm: Date | null, agora: number): boolean {
  return ultimoSinalEm !== null && agora - ultimoSinalEm.getTime() < SEM_SINAL_E_ONLINE_MS;
}

function rastreadorDTO(r: RastreadorComVinculos, agora = Date.now()) {
  return {
    id: r.id,
    identificador: r.identificador,
    nome: r.nome,
    tipo: r.tipo,
    veiculoId: r.veiculoId,
    veiculo: r.veiculo,
    usuarioId: r.usuarioId,
    usuario: r.usuario,
    ativo: r.ativo,
    observacoes: r.observacoes,
    ultimaLat: numOuNull(r.ultimaLat),
    ultimaLng: numOuNull(r.ultimaLng),
    ultimaVelocidade: numOuNull(r.ultimaVelocidade),
    ultimaBateria: r.ultimaBateria,
    ultimoSinalEm: r.ultimoSinalEm ? r.ultimoSinalEm.toISOString() : null,
    online: estaOnline(r.ultimoSinalEm, agora),
  };
}

// ---------- Gravação ----------

// Grava a posição no histórico. A última posição só muda se esta for a mais recente do rastreador.
async function gravarPosicao(
  rastreador: { id: number; ultimoSinalEm: Date | null },
  p: { lat: number; lng: number; velocidade: number | null; bateria: number | null; quando: Date },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.posicaoGps.create({
      data: {
        rastreadorId: rastreador.id,
        lat: p.lat,
        lng: p.lng,
        velocidade: p.velocidade,
        bateria: p.bateria,
        registradoEm: p.quando,
      },
    });
    if (rastreador.ultimoSinalEm && p.quando.getTime() < rastreador.ultimoSinalEm.getTime()) return;
    await tx.rastreadorGps.update({
      where: { id: rastreador.id },
      data: {
        ultimaLat: p.lat,
        ultimaLng: p.lng,
        ultimaVelocidade: p.velocidade,
        ultimaBateria: p.bateria ?? undefined,
        ultimoSinalEm: p.quando,
      },
    });
  });
}

function camposDoRastreador(d: AtualizacaoRastreador): Prisma.RastreadorGpsUncheckedUpdateInput {
  const saida: Prisma.RastreadorGpsUncheckedUpdateInput = {};
  if (d.identificador !== undefined) saida.identificador = d.identificador;
  if (d.nome !== undefined) saida.nome = d.nome;
  if (d.tipo !== undefined) saida.tipo = d.tipo;
  if (d.veiculoId !== undefined) saida.veiculoId = d.veiculoId;
  if (d.usuarioId !== undefined) saida.usuarioId = d.usuarioId;
  if (d.ativo !== undefined) saida.ativo = d.ativo;
  if (d.observacoes !== undefined) saida.observacoes = d.observacoes;
  return saida;
}

async function conferirVinculos(veiculoId?: number | null, usuarioId?: number | null): Promise<void> {
  if (veiculoId) {
    const veiculo = await prisma.veiculo.findUnique({ where: { id: veiculoId }, select: { id: true } });
    if (!veiculo) throw new HttpError(400, 'Veículo não encontrado');
  }
  if (usuarioId) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true } });
    if (!usuario) throw new HttpError(400, 'Motorista não encontrado');
  }
}

async function conferirIdentificador(identificador: string, idAtual?: number): Promise<void> {
  const outra = await prisma.rastreadorGps.findFirst({
    where: { identificador, ...(idAtual !== undefined ? { NOT: { id: idAtual } } : {}) },
    select: { id: true },
  });
  if (outra) throw new HttpError(409, 'Já existe uma tag com este identificador');
}

// ---------- Protocolo OsmAnd / Traccar (público) ----------

interface Leitura {
  identificador: string | undefined;
  lat: number | undefined;
  lng: number | undefined;
  velocidadeKmh: number | null;
  bateria: number | null;
  timestamp: unknown;
}

function texto(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

// undefined = não veio; NaN = veio mas não é número.
function numeroDe(v: unknown): number | undefined {
  const t = texto(v);
  if (t === undefined || t === '') return undefined;
  return Number(t);
}

function lerLeitura(req: Request): Leitura {
  const corpo: Record<string, unknown> = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  // Formato JSON novo do Traccar Client.
  if (corpo.location && typeof corpo.location === 'object') {
    const loc = corpo.location as {
      timestamp?: unknown;
      coords?: { latitude?: unknown; longitude?: unknown; speed?: unknown };
      battery?: { level?: unknown };
    };
    const coords = loc.coords ?? {};
    const velocidadeMs = numeroDe(coords.speed);
    const nivel = numeroDe(loc.battery?.level);
    return {
      identificador: texto(corpo.device_id),
      lat: numeroDe(coords.latitude),
      lng: numeroDe(coords.longitude),
      velocidadeKmh: velocidadeMs !== undefined && Number.isFinite(velocidadeMs) ? velocidadeMs * 3.6 : null,
      bateria: nivel !== undefined && Number.isFinite(nivel) ? nivel * 100 : null,
      timestamp: loc.timestamp,
    };
  }

  // OsmAnd: parâmetros na query (GET) ou no corpo form-urlencoded/JSON (POST).
  const p: Record<string, unknown> = { ...req.query, ...corpo };
  const nos = numeroDe(p.speed);
  const batt = numeroDe(p.batt);
  return {
    identificador: texto(p.id),
    lat: numeroDe(p.lat),
    lng: numeroDe(p.lon),
    velocidadeKmh: nos !== undefined && Number.isFinite(nos) ? nos * 1.852 : null, // OsmAnd manda nós
    bateria: batt !== undefined && Number.isFinite(batt) ? batt : null,
    timestamp: p.timestamp,
  };
}

// Segundos Unix (ou milissegundos, se grandes) ou texto ISO. Sem valor = agora.
function quandoDe(v: unknown): Date | null {
  const agora = new Date();
  if (v === undefined || v === null || v === '') return agora;
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) ? Number(v) : NaN;
  let data: Date;
  if (Number.isFinite(n)) {
    data = new Date(n > 1e12 ? n : n * 1000);
  } else {
    data = new Date(String(v));
    if (Number.isNaN(data.getTime())) return null;
  }
  // Relógio do aparelho adiantado: a posição não fica no futuro (senão travaria as próximas).
  return data.getTime() > agora.getTime() + 60 * 1000 ? agora : data;
}

// Limite simples por IP, em memória: 120 requisições por minuto.
const contagemPorIp = new Map<string, { inicio: number; n: number }>();

function limitarPorIp(req: Request, _res: Response, next: NextFunction): void {
  const agora = Date.now();
  const ip = req.ip ?? 'desconhecido';
  let registro = contagemPorIp.get(ip);
  if (!registro || agora - registro.inicio >= 60 * 1000) {
    registro = { inicio: agora, n: 0 };
    contagemPorIp.set(ip, registro);
  }
  registro.n += 1;
  if (contagemPorIp.size > 5000) {
    for (const [chave, r] of contagemPorIp) {
      if (agora - r.inicio >= 60 * 1000) contagemPorIp.delete(chave);
    }
  }
  if (registro.n > LIMITE_POR_MINUTO) {
    throw new HttpError(429, 'Muitas requisições. Tente de novo em instantes.');
  }
  next();
}

async function receberOsmand(req: Request, res: Response): Promise<void> {
  const leitura = lerLeitura(req);
  if (!leitura.identificador) throw new HttpError(404, 'Não encontrado');

  const rastreador = await prisma.rastreadorGps.findUnique({
    where: { identificador: leitura.identificador },
    select: { id: true, ativo: true, ultimoSinalEm: true },
  });
  if (!rastreador || !rastreador.ativo) throw new HttpError(404, 'Não encontrado');

  if (leitura.lat === undefined || !Number.isFinite(leitura.lat) || leitura.lat < -90 || leitura.lat > 90) {
    throw new HttpError(400, 'Latitude inválida');
  }
  if (leitura.lng === undefined || !Number.isFinite(leitura.lng) || leitura.lng < -180 || leitura.lng > 180) {
    throw new HttpError(400, 'Longitude inválida');
  }
  const quando = quandoDe(leitura.timestamp);
  if (!quando) throw new HttpError(400, 'Horário inválido');

  const bateria = leitura.bateria === null ? null : Math.min(100, Math.max(0, Math.round(leitura.bateria)));
  await gravarPosicao(rastreador, {
    lat: leitura.lat,
    lng: leitura.lng,
    velocidade: leitura.velocidadeKmh === null ? null : Math.round(leitura.velocidadeKmh * 10) / 10,
    bateria,
    quando,
  });
  res.type('text/plain').send('OK');
}

publico.get('/publico/gps/osmand', limitarPorIp, asyncHandler(receberOsmand));
publico.post(
  '/publico/gps/osmand',
  limitarPorIp,
  express.urlencoded({ extended: false }),
  asyncHandler(receberOsmand),
);

// ---------- Cadastro e leitura (autenticadas) ----------

router.get(
  '/gps/rastreadores',
  permitir('GESTOR', 'ESTOQUISTA', 'MOTORISTA'),
  asyncHandler(async (_req, res) => {
    const lista = await prisma.rastreadorGps.findMany({ orderBy: { nome: 'asc' }, include: inclusao });
    const agora = Date.now();
    res.json(lista.map((r) => rastreadorDTO(r, agora)));
  }),
);

router.post(
  '/gps/rastreadores',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validarComMensagem(rastreadorSchema, req.body);
    await conferirIdentificador(dados.identificador);
    await conferirVinculos(dados.veiculoId, dados.usuarioId);
    const criado = await prisma.rastreadorGps.create({
      data: {
        identificador: dados.identificador,
        nome: dados.nome,
        tipo: dados.tipo,
        veiculoId: dados.veiculoId ?? null,
        usuarioId: dados.usuarioId ?? null,
        ativo: dados.ativo ?? true,
        observacoes: dados.observacoes ?? null,
      },
      include: inclusao,
    });
    res.status(201).json(rastreadorDTO(criado));
  }),
);

router.put(
  '/gps/rastreadores/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validarComMensagem(atualizacaoSchema, req.body);
    const existe = await prisma.rastreadorGps.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Rastreador não encontrado');
    if (dados.identificador !== undefined) await conferirIdentificador(dados.identificador, id);
    await conferirVinculos(dados.veiculoId, dados.usuarioId);
    const atualizado = await prisma.rastreadorGps.update({
      where: { id },
      data: camposDoRastreador(dados),
      include: inclusao,
    });
    res.json(rastreadorDTO(atualizado));
  }),
);

router.delete(
  '/gps/rastreadores/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existe = await prisma.rastreadorGps.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Rastreador não encontrado');
    await prisma.rastreadorGps.delete({ where: { id } });
    res.status(204).end();
  }),
);

// Últimas posições do período (até 1000), das mais antigas para as mais novas.
router.get(
  '/gps/rastreadores/:id/historico',
  permitir('GESTOR', 'ESTOQUISTA', 'MOTORISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { horas } = validarComMensagem(
      z.object({ horas: z.coerce.number().int().min(1).max(720).default(24) }),
      req.query,
    );
    const existe = await prisma.rastreadorGps.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Rastreador não encontrado');
    const posicoes = await prisma.posicaoGps.findMany({
      where: { rastreadorId: id, registradoEm: { gte: new Date(Date.now() - horas * 60 * 60 * 1000) } },
      orderBy: { registradoEm: 'desc' },
      take: 1000,
    });
    res.json(
      posicoes.reverse().map((p) => ({
        id: p.id,
        lat: num(p.lat),
        lng: num(p.lng),
        velocidade: numOuNull(p.velocidade),
        bateria: p.bateria,
        registradoEm: p.registradoEm.toISOString(),
      })),
    );
  }),
);

// Ponto de partida da simulação: a última posição; senão a primeira loja com coordenadas; senão o centro de São Paulo.
async function pontoDePartida(
  ultimaLat: Prisma.Decimal | null,
  ultimaLng: Prisma.Decimal | null,
): Promise<{ lat: number; lng: number }> {
  if (ultimaLat !== null && ultimaLng !== null) {
    return { lat: num(ultimaLat), lng: num(ultimaLng) };
  }
  const loja = await prisma.loja.findFirst({
    where: { latitude: { not: null }, longitude: { not: null } },
    orderBy: { id: 'asc' },
    select: { latitude: true, longitude: true },
  });
  if (loja && loja.latitude !== null && loja.longitude !== null) {
    return { lat: num(loja.latitude), lng: num(loja.longitude) };
  }
  return POSICAO_PADRAO_SP;
}

// Gera uma posição nova perto da última (até ~300 m), com velocidade de 0 a 60 km/h e bateria -1%.
router.post(
  '/gps/rastreadores/:id/simular',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.rastreadorGps.findUnique({
      where: { id },
      select: { id: true, ultimaLat: true, ultimaLng: true, ultimaBateria: true, ultimoSinalEm: true },
    });
    if (!atual) throw new HttpError(404, 'Rastreador não encontrado');

    const base = await pontoDePartida(atual.ultimaLat, atual.ultimaLng);
    const distancia = Math.random() * 300; // metros
    const direcao = Math.random() * 2 * Math.PI;
    const metrosPorGrau = 111320;
    const lat = Math.min(90, Math.max(-90, base.lat + (distancia * Math.cos(direcao)) / metrosPorGrau));
    const cosLat = Math.max(0.01, Math.cos((base.lat * Math.PI) / 180));
    const lng = Math.min(180, Math.max(-180, base.lng + (distancia * Math.sin(direcao)) / (metrosPorGrau * cosLat)));

    await gravarPosicao(atual, {
      lat: Math.round(lat * 1e7) / 1e7,
      lng: Math.round(lng * 1e7) / 1e7,
      velocidade: Math.round(Math.random() * 600) / 10,
      bateria: Math.max(0, (atual.ultimaBateria ?? 100) - 1),
      quando: new Date(),
    });

    const atualizado = await prisma.rastreadorGps.findUnique({ where: { id }, include: inclusao });
    if (!atualizado) throw new HttpError(404, 'Rastreador não encontrado');
    res.json(rastreadorDTO(atualizado));
  }),
);

// ---------- Limpeza do histórico ----------

async function limparPosicoesAntigas(): Promise<void> {
  try {
    await prisma.posicaoGps.deleteMany({
      where: { registradoEm: { lt: new Date(Date.now() - TRINTA_DIAS_MS) } },
    });
  } catch (erro) {
    console.error('Falha ao limpar posições GPS antigas:', erro instanceof Error ? erro.message : erro);
  }
}

const temporizadorLimpeza = setInterval(() => {
  void limparPosicoesAntigas();
}, SEIS_HORAS_MS);
temporizadorLimpeza.unref();
