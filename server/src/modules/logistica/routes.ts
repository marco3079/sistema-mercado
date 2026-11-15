import { Router } from 'express';
import { z } from 'zod';
import type { Entrega, Prisma, StatusEntrega, StatusRota, Transferencia, Veiculo } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { filtroLoja, lojaDaRequisicao } from '../../lib/lojas';
import { movimentarEstoque } from '../../lib/estoque';
import type { Tx } from '../../lib/estoque';
import { lerConfiguracao } from '../../lib/email';
import { arred2, arred3, fimDoDia, inicioDoDia, num, numOuNull } from '../../lib/numeros';
import { avisoWhatsapp, criarEntrega } from './entregas';
import type { AvisoWhatsapp } from './entregas';

// Logística: frota, rotas/cargas com roteirização, entregas (gestão, motorista e rastreio público)
// e transferências entre lojas. Estoque só muda por movimentarEstoque.

const router = Router();
export default router;

export const publico = Router();

const STATUS_ENTREGA = ['PENDENTE', 'SEPARANDO', 'EM_ROTA', 'ENTREGUE', 'FALHOU', 'CANCELADA'] as const;
const STATUS_ROTA = ['MONTANDO', 'CARREGADA', 'EM_ROTA', 'CONCLUIDA', 'CANCELADA'] as const;
const TIPOS_VEICULO = ['Moto', 'Carro', 'Van', 'Caminhão'] as const;

const ROTULOS_ROTA: Record<StatusRota, string> = {
  MONTANDO: 'montando',
  CARREGADA: 'carregada',
  EM_ROTA: 'em rota',
  CONCLUIDA: 'concluída',
  CANCELADA: 'cancelada',
};

// Passos permitidos da rota. Qualquer outro pedido vira 409.
const PASSOS_ROTA: Record<StatusRota, StatusRota[]> = {
  MONTANDO: ['CARREGADA', 'EM_ROTA', 'CANCELADA'],
  CARREGADA: ['EM_ROTA', 'CONCLUIDA', 'CANCELADA'],
  EM_ROTA: ['CONCLUIDA', 'CANCELADA'],
  CONCLUIDA: [],
  CANCELADA: [],
};

// Fator de estrada sobre a distância em linha reta (haversine).
const FATOR_ESTRADA = 1.3;

// ---------- Utilitários ----------

const pad2 = (n: number): string => String(n).padStart(2, '0');

function textoQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

// Lê AAAA-MM-DD como dia local (meia-noite). Devolve null se não for uma data válida.
function dataDaQuery(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return Number.isNaN(data.getTime()) ? null : data;
}

function dataDoCorpo(valor: unknown): Date {
  const data = dataDaQuery(valor);
  if (!data) throw new HttpError(400, 'Data inválida (use AAAA-MM-DD)');
  return data;
}

function iso(data: Date | null): string | null {
  return data ? data.toISOString() : null;
}

function avisosDe(valor: Prisma.JsonValue | null): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

// Acrescenta um aviso de WhatsApp ao histórico da entrega (JSON). Sem aviso, não mexe no campo.
function acrescentarAviso(atuais: Prisma.JsonValue | null, aviso: AvisoWhatsapp | null): Prisma.InputJsonValue | undefined {
  if (!aviso) return undefined;
  return [...avisosDe(atuais), aviso] as unknown as Prisma.InputJsonValue;
}

// Distância em km entre dois pontos (fórmula de haversine).
interface Ponto {
  lat: number;
  lng: number;
}

function distanciaKm(a: Ponto, b: Ponto): number {
  const raio = 6371;
  const rad = (graus: number) => (graus * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * raio * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Ordem por `ordem` (sem ordem vai para o fim) e depois pelo id.
function porOrdem<T extends { ordem: number | null; id: number }>(a: T, b: T): number {
  return (a.ordem ?? 1e9) - (b.ordem ?? 1e9) || a.id - b.id;
}

function ocupacaoDe(pesoKg: number, capacidadeKg: number): number | null {
  return capacidadeKg > 0 ? arred2((pesoKg / capacidadeKg) * 100) : null;
}

// ---------- Inclusões e formatação ----------

const INCLUI_ENTREGA = {
  venda: { select: { numero: true } },
  pedidoVenda: { select: { numero: true } },
  rota: { select: { codigo: true, motorista: { select: { nome: true } } } },
  motorista: { select: { nome: true } },
} satisfies Prisma.EntregaInclude;
type EntregaCompleta = Prisma.EntregaGetPayload<{ include: typeof INCLUI_ENTREGA }>;

const INCLUI_ROTA = {
  veiculo: true,
  motorista: { select: { id: true, nome: true } },
  loja: { select: { id: true, nome: true, latitude: true, longitude: true } },
  entregas: { include: INCLUI_ENTREGA },
  transferencias: {
    include: {
      origem: { select: { nome: true } },
      destino: { select: { nome: true } },
      itens: { select: { id: true } },
    },
  },
} satisfies Prisma.RotaInclude;
type RotaCompleta = Prisma.RotaGetPayload<{ include: typeof INCLUI_ROTA }>;

function veiculoDTO(v: Veiculo | null) {
  return v
    ? {
        id: v.id,
        placa: v.placa,
        modelo: v.modelo,
        tipo: v.tipo,
        capacidadeKg: num(v.capacidadeKg),
        capacidadeVolumes: v.capacidadeVolumes,
        ativo: v.ativo,
      }
    : null;
}

function entregaDTO(e: EntregaCompleta) {
  return {
    id: e.id,
    codigo: e.codigo,
    status: e.status,
    destinatario: e.destinatario,
    telefone: e.telefone,
    endereco: e.endereco,
    bairro: e.bairro,
    cidade: e.cidade,
    latitude: numOuNull(e.latitude),
    longitude: numOuNull(e.longitude),
    taxa: num(e.taxa),
    valorCobrar: num(e.valorCobrar),
    pesoKg: num(e.pesoKg),
    previsao: iso(e.previsao),
    observacao: e.observacao,
    recebidoPor: e.recebidoPor,
    motivoFalha: e.motivoFalha,
    rotaId: e.rotaId,
    rotaCodigo: e.rota?.codigo ?? null,
    ordem: e.ordem,
    motorista: e.motorista?.nome ?? e.rota?.motorista?.nome ?? null,
    vendaNumero: e.venda?.numero ?? null,
    pedidoVendaNumero: e.pedidoVenda?.numero ?? null,
    criadoEm: e.criadoEm.toISOString(),
    saiuEm: iso(e.saiuEm),
    entregueEm: iso(e.entregueEm),
    avisos: avisosDe(e.avisosWhatsapp),
  };
}

function rotaDTO(r: RotaCompleta) {
  const peso = num(r.pesoTotalKg);
  const capacidade = r.veiculo ? num(r.veiculo.capacidadeKg) : 0;
  return {
    id: r.id,
    codigo: r.codigo,
    data: r.data.toISOString(),
    status: r.status,
    lojaId: r.lojaId,
    loja: {
      id: r.loja.id,
      nome: r.loja.nome,
      latitude: numOuNull(r.loja.latitude),
      longitude: numOuNull(r.loja.longitude),
    },
    veiculoId: r.veiculoId,
    veiculo: veiculoDTO(r.veiculo),
    motoristaId: r.motoristaId,
    motorista: r.motorista,
    capacidadeKg: capacidade > 0 ? capacidade : null,
    pesoTotalKg: peso,
    ocupacao: ocupacaoDe(peso, capacidade),
    distanciaKm: numOuNull(r.distanciaKm),
    kmInicial: r.kmInicial,
    kmFinal: r.kmFinal,
    saidaEm: iso(r.saidaEm),
    retornoEm: iso(r.retornoEm),
    observacoes: r.observacoes,
    entregas: [...r.entregas].sort(porOrdem).map(entregaDTO),
    transferencias: r.transferencias.map((t) => ({
      id: t.id,
      origem: t.origem.nome,
      destino: t.destino.nome,
      status: t.status,
      itens: t.itens.length,
    })),
  };
}

async function detalheRota(id: number) {
  const rota = await prisma.rota.findUnique({ where: { id }, include: INCLUI_ROTA });
  if (!rota) throw new HttpError(404, 'Rota não encontrada');
  return rotaDTO(rota);
}

// ---------- Regras de carga ----------

async function conferirMotorista(tx: Tx, motoristaId: number | null | undefined): Promise<void> {
  if (!motoristaId) return;
  const usuario = await tx.usuario.findUnique({ where: { id: motoristaId }, select: { perfil: true } });
  if (!usuario || usuario.perfil !== 'MOTORISTA') throw new HttpError(400, 'Motorista inválido');
}

// Entregas que podem entrar na rota: existem, estão sem rota (ou nesta rota) e ainda não saíram.
function conferirEntregasParaRota(entregas: Entrega[], ids: number[], rotaId: number | null): void {
  if (entregas.length !== ids.length) throw new HttpError(404, 'Alguma entrega não foi encontrada');
  for (const e of entregas) {
    if (e.rotaId !== null && e.rotaId !== rotaId) {
      throw new HttpError(409, `A entrega ${e.codigo} já está em outra rota`);
    }
    if (e.status !== 'PENDENTE' && e.status !== 'SEPARANDO') {
      throw new HttpError(409, `A entrega ${e.codigo} não pode entrar na carga (${e.status})`);
    }
  }
}

function conferirTransferenciasParaRota(trs: Transferencia[], ids: number[], rotaId: number | null): void {
  if (trs.length !== ids.length) throw new HttpError(404, 'Alguma transferência não foi encontrada');
  for (const t of trs) {
    if (t.rotaId !== null && t.rotaId !== rotaId) {
      throw new HttpError(409, `A transferência #${t.id} já está em outra rota`);
    }
    if (t.status !== 'SOLICITADA' && t.status !== 'ENVIADA') {
      throw new HttpError(409, `A transferência #${t.id} não pode entrar na carga (${t.status})`);
    }
  }
}

// Peso das entregas da rota (sem as canceladas). Transferências não entram no peso.
async function pesoDaRota(tx: Tx, rotaId: number): Promise<number> {
  const agregado = await tx.entrega.aggregate({
    where: { rotaId, status: { not: 'CANCELADA' } },
    _sum: { pesoKg: true },
  });
  return arred3(num(agregado._sum.pesoKg));
}

function conferirCapacidade(peso: number, veiculo: Veiculo | null, forcar: boolean | undefined): void {
  if (!veiculo || forcar) return;
  const capacidade = num(veiculo.capacidadeKg);
  if (capacidade > 0 && peso > capacidade) {
    throw new HttpError(400, `Carga de ${peso} kg passa da capacidade do veículo (${capacidade} kg)`, {
      codigo: 'CAPACIDADE',
    });
  }
}

// Código R + AAAAMMDD + - + sequência do dia (pela data da rota).
async function novoCodigoRota(tx: Tx, data: Date): Promise<string> {
  const prefixo = `R${data.getFullYear()}${pad2(data.getMonth() + 1)}${pad2(data.getDate())}-`;
  let sequencia = (await tx.rota.count({ where: { codigo: { startsWith: prefixo } } })) + 1;
  let codigo = prefixo + pad2(sequencia);
  while (await tx.rota.findUnique({ where: { codigo }, select: { id: true } })) {
    sequencia += 1;
    codigo = prefixo + pad2(sequencia);
  }
  return codigo;
}

// ---------- Transferências: envio ----------

// Baixa do estoque da origem (TRANSFERENCIA_SAIDA) e marca a transferência como ENVIADA.
async function enviarTransferencia(
  tx: Tx,
  t: { id: number; origemLojaId: number; itens: { produtoId: number; quantidade: Prisma.Decimal }[] },
  usuarioId: number,
): Promise<void> {
  for (const item of t.itens) {
    await movimentarEstoque(tx, {
      produtoId: item.produtoId,
      lojaId: t.origemLojaId,
      tipo: 'TRANSFERENCIA_SAIDA',
      quantidade: -num(item.quantidade),
      motivo: `Transferência #${t.id}`,
      referencia: `transferencia:${t.id}`,
      usuarioId,
    });
  }
  await tx.transferencia.update({ where: { id: t.id }, data: { status: 'ENVIADA', enviadaEm: new Date() } });
}

// ---------- Status da rota (saída, conclusão, cancelamento) ----------

async function mudarStatusRota(
  id: number,
  alvo: StatusRota,
  km: { kmInicial?: number; kmFinal?: number },
  usuarioId: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rota = await tx.rota.findUnique({
      where: { id },
      include: { entregas: true, transferencias: { include: { itens: true } } },
    });
    if (!rota) throw new HttpError(404, 'Rota não encontrada');
    if (!PASSOS_ROTA[rota.status].includes(alvo)) {
      throw new HttpError(409, `Não dá para passar a rota de ${ROTULOS_ROTA[rota.status]} para ${ROTULOS_ROTA[alvo]}`);
    }

    const agora = new Date();
    const dados: Prisma.RotaUpdateInput = { status: alvo };

    if (alvo === 'EM_ROTA') {
      dados.saidaEm = agora;
      if (km.kmInicial !== undefined) dados.kmInicial = km.kmInicial;
      for (const e of rota.entregas) {
        if (e.status !== 'PENDENTE' && e.status !== 'SEPARANDO') continue;
        const aviso = e.telefone ? await avisoWhatsapp('EM_ROTA', e.codigo) : null;
        await tx.entrega.update({
          where: { id: e.id },
          data: { status: 'EM_ROTA', saiuEm: agora, avisosWhatsapp: acrescentarAviso(e.avisosWhatsapp, aviso) },
        });
      }
      for (const t of rota.transferencias) {
        if (t.status === 'SOLICITADA') await enviarTransferencia(tx, t, usuarioId);
      }
    }

    if (alvo === 'CONCLUIDA') {
      dados.retornoEm = agora;
      if (km.kmFinal !== undefined) dados.kmFinal = km.kmFinal;
    }

    if (alvo === 'CANCELADA') {
      // Entregas ainda não entregues voltam para a fila de pendentes; as já entregues ficam como estão.
      await tx.entrega.updateMany({
        where: { rotaId: id, status: { in: ['PENDENTE', 'SEPARANDO', 'EM_ROTA'] } },
        data: { rotaId: null, ordem: null, status: 'PENDENTE', saiuEm: null },
      });
      await tx.transferencia.updateMany({ where: { rotaId: id }, data: { rotaId: null } });
    }

    await tx.rota.update({ where: { id }, data: dados });
  });
}

// ---------- Status da entrega ----------

interface DadosStatusEntrega {
  status: StatusEntrega;
  recebidoPor?: string | null;
  motivoFalha?: string | null;
}

// motoristaId informado: só muda entrega da rota desse motorista. Null = gestor (sem essa checagem).
async function aplicarStatusEntrega(id: number, dados: DadosStatusEntrega, motoristaId: number | null): Promise<void> {
  const entrega = await prisma.entrega.findUnique({
    where: { id },
    include: { rota: { select: { id: true, motoristaId: true, status: true } } },
  });
  if (!entrega) throw new HttpError(404, 'Entrega não encontrada');
  if (motoristaId !== null && entrega.rota?.motoristaId !== motoristaId) {
    throw new HttpError(403, 'Esta entrega não é da sua rota');
  }

  const agora = new Date();
  const aviso = entrega.telefone ? await avisoWhatsapp(dados.status, entrega.codigo) : null;

  await prisma.$transaction(async (tx) => {
    const mudanca: Prisma.EntregaUpdateInput = {
      status: dados.status,
      avisosWhatsapp: acrescentarAviso(entrega.avisosWhatsapp, aviso),
    };
    if (dados.status === 'EM_ROTA') mudanca.saiuEm = entrega.saiuEm ?? agora;
    if (dados.status === 'ENTREGUE') {
      mudanca.entregueEm = agora;
      mudanca.recebidoPor = dados.recebidoPor ?? null;
    }
    if (dados.status === 'FALHOU') mudanca.motivoFalha = dados.motivoFalha ?? null;
    await tx.entrega.update({ where: { id }, data: mudanca });

    // Quando a última entrega da rota fecha (entregue ou falhou), a rota está concluída.
    const rota = entrega.rota;
    if (dados.status === 'ENTREGUE' && rota && rota.status !== 'CONCLUIDA' && rota.status !== 'CANCELADA') {
      const abertas = await tx.entrega.count({
        where: { rotaId: rota.id, status: { notIn: ['ENTREGUE', 'FALHOU', 'CANCELADA'] } },
      });
      if (abertas === 0) {
        await tx.rota.update({ where: { id: rota.id }, data: { status: 'CONCLUIDA', retornoEm: agora } });
      }
    }
  });
}

async function garantirRotaDoMotorista(id: number, motoristaId: number): Promise<void> {
  const rota = await prisma.rota.findUnique({ where: { id }, select: { motoristaId: true } });
  if (!rota) throw new HttpError(404, 'Rota não encontrada');
  if (rota.motoristaId !== motoristaId) throw new HttpError(403, 'Esta rota não é sua');
}

// ---------- Schemas ----------

const veiculoSchema = z.object({
  placa: z.string().trim().min(6, 'Placa inválida').max(10, 'Placa inválida'),
  modelo: z.string().trim().min(1, 'Informe o modelo').max(80),
  tipo: z.enum(TIPOS_VEICULO),
  capacidadeKg: z.number().nonnegative(),
  capacidadeVolumes: z.number().int().nonnegative().nullable().optional(),
  ativo: z.boolean().optional(),
});

const novaEntregaSchema = z.object({
  destinatario: z.string().trim().min(2, 'Informe o destinatário').max(120),
  telefone: z.string().trim().max(30).nullable().optional(),
  endereco: z.string().trim().min(3, 'Informe o endereço').max(200),
  bairro: z.string().trim().max(80).nullable().optional(),
  cidade: z.string().trim().max(80).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  taxa: z.number().nonnegative().optional(),
  valorCobrar: z.number().nonnegative().optional(),
  pesoKg: z.number().nonnegative().optional(),
  previsao: z.string().nullable().optional(),
  observacao: z.string().trim().max(300).nullable().optional(),
});

const statusEntregaSchema = z.object({
  status: z.enum(STATUS_ENTREGA),
  recebidoPor: z.string().trim().max(120).nullable().optional(),
  motivoFalha: z.string().trim().max(300).nullable().optional(),
});

const novaRotaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  veiculoId: z.number().int().positive().nullable().optional(),
  motoristaId: z.number().int().positive().nullable().optional(),
  observacoes: z.string().trim().max(500).nullable().optional(),
  entregaIds: z.array(z.number().int().positive()).optional(),
  transferenciaIds: z.array(z.number().int().positive()).optional(),
  forcar: z.boolean().optional(),
});

const atualizarRotaSchema = z.object({
  veiculoId: z.number().int().positive().nullable().optional(),
  motoristaId: z.number().int().positive().nullable().optional(),
  observacoes: z.string().trim().max(500).nullable().optional(),
  adicionar: z.array(z.number().int().positive()).optional(),
  remover: z.array(z.number().int().positive()).optional(),
  // Nova ordem das entregas da rota (ids na sequência de parada).
  ordem: z.array(z.number().int().positive()).optional(),
  forcar: z.boolean().optional(),
});

const statusRotaSchema = z.object({
  status: z.enum(['CARREGADA', 'EM_ROTA', 'CONCLUIDA', 'CANCELADA']),
  kmInicial: z.number().int().nonnegative().nullable().optional(),
  kmFinal: z.number().int().nonnegative().nullable().optional(),
});

const novaTransferenciaSchema = z.object({
  origemLojaId: z.number().int().positive().optional(),
  destinoLojaId: z.number().int().positive(),
  itens: z
    .array(z.object({ produtoId: z.number().int().positive(), quantidade: z.number().positive() }))
    .min(1, 'Informe ao menos um item'),
  observacoes: z.string().trim().max(300).nullable().optional(),
});

const receberSchema = z.object({
  itens: z
    .array(z.object({ produtoId: z.number().int().positive(), quantidadeRecebida: z.number().nonnegative() }))
    .optional(),
});

// ---------- Frota ----------

router.get(
  '/veiculos',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (_req, res) => {
    const veiculos = await prisma.veiculo.findMany({ orderBy: { placa: 'asc' } });
    res.json(veiculos.map((v) => veiculoDTO(v)));
  }),
);

router.post(
  '/veiculos',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(veiculoSchema, req.body);
    const placa = dados.placa.toUpperCase();
    if (await prisma.veiculo.findUnique({ where: { placa }, select: { id: true } })) {
      throw new HttpError(409, 'Já existe um veículo com esta placa');
    }
    const veiculo = await prisma.veiculo.create({
      data: {
        placa,
        modelo: dados.modelo,
        tipo: dados.tipo,
        capacidadeKg: arred2(dados.capacidadeKg),
        capacidadeVolumes: dados.capacidadeVolumes ?? null,
        ativo: dados.ativo ?? true,
      },
    });
    res.status(201).json(veiculoDTO(veiculo));
  }),
);

router.put(
  '/veiculos/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(veiculoSchema, req.body);
    const placa = dados.placa.toUpperCase();
    if (!(await prisma.veiculo.findUnique({ where: { id }, select: { id: true } }))) {
      throw new HttpError(404, 'Veículo não encontrado');
    }
    const outro = await prisma.veiculo.findFirst({ where: { placa, id: { not: id } }, select: { id: true } });
    if (outro) throw new HttpError(409, 'Já existe um veículo com esta placa');
    const veiculo = await prisma.veiculo.update({
      where: { id },
      data: {
        placa,
        modelo: dados.modelo,
        tipo: dados.tipo,
        capacidadeKg: arred2(dados.capacidadeKg),
        capacidadeVolumes: dados.capacidadeVolumes ?? null,
        ativo: dados.ativo ?? true,
      },
    });
    res.json(veiculoDTO(veiculo));
  }),
);

// ---------- Entregas ----------

router.get(
  '/entregas',
  permitir('GESTOR', 'ESTOQUISTA', 'OPERADOR'),
  asyncHandler(async (req, res) => {
    const loja = await filtroLoja(req);
    const status = textoQuery(req.query.status);
    if (status && !(STATUS_ENTREGA as readonly string[]).includes(status)) {
      throw new HttpError(400, 'Situação inválida');
    }
    const data = textoQuery(req.query.data);
    const rotaId = textoQuery(req.query.rotaId);
    if (rotaId && !/^\d+$/.test(rotaId)) throw new HttpError(400, 'Rota inválida');

    const where: Prisma.EntregaWhereInput = {};
    // Entregas da loja: pela venda, pelo pedido ou pela rota. Entrega sem vínculo aparece para todas.
    if (loja !== null) {
      where.OR = [
        { venda: { lojaId: loja } },
        { pedidoVenda: { lojaId: loja } },
        { rota: { lojaId: loja } },
        { vendaId: null, pedidoVendaId: null, rotaId: null },
      ];
    }
    if (status) where.status = status as StatusEntrega;
    if (data) {
      const dia = dataDoCorpo(data);
      where.criadoEm = { gte: inicioDoDia(dia), lte: fimDoDia(dia) };
    }
    if (req.query.semRota === '1') where.rotaId = null;
    else if (rotaId) where.rotaId = Number(rotaId);

    const entregas = await prisma.entrega.findMany({
      where,
      include: INCLUI_ENTREGA,
      orderBy: { criadoEm: 'asc' },
    });
    res.json(entregas.map((e) => entregaDTO(e)));
  }),
);

router.post(
  '/entregas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(novaEntregaSchema, req.body);
    let previsao: Date | null = null;
    if (dados.previsao) {
      previsao = new Date(dados.previsao);
      if (Number.isNaN(previsao.getTime())) throw new HttpError(400, 'Previsão inválida');
    }
    const criada = await prisma.$transaction((tx) =>
      criarEntrega(tx, {
        destinatario: dados.destinatario,
        telefone: dados.telefone ?? null,
        endereco: dados.endereco,
        bairro: dados.bairro ?? null,
        cidade: dados.cidade ?? null,
        latitude: dados.latitude ?? null,
        longitude: dados.longitude ?? null,
        taxa: dados.taxa,
        valorCobrar: dados.valorCobrar,
        pesoKg: dados.pesoKg,
        previsao,
        observacao: dados.observacao ?? null,
      }),
    );
    res.status(201).json(criada);
  }),
);

router.post(
  '/entregas/:id/status',
  permitir('GESTOR', 'MOTORISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(statusEntregaSchema, req.body);
    const motoristaId = req.usuario.perfil === 'MOTORISTA' ? req.usuario.id : null;
    await aplicarStatusEntrega(id, dados, motoristaId);
    const atual = await prisma.entrega.findUnique({ where: { id }, include: INCLUI_ENTREGA });
    if (!atual) throw new HttpError(404, 'Entrega não encontrada');
    res.json(entregaDTO(atual));
  }),
);

// ---------- Rotas e cargas ----------

router.get(
  '/rotas',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const loja = await filtroLoja(req);
    const data = textoQuery(req.query.data);
    const status = textoQuery(req.query.status);
    if (status && !(STATUS_ROTA as readonly string[]).includes(status)) {
      throw new HttpError(400, 'Situação inválida');
    }
    const where: Prisma.RotaWhereInput = {};
    if (loja !== null) where.lojaId = loja;
    if (data) {
      const dia = dataDoCorpo(data);
      where.data = { gte: inicioDoDia(dia), lte: fimDoDia(dia) };
    }
    if (status) where.status = status as StatusRota;

    const rotas = await prisma.rota.findMany({
      where,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true } },
        entregas: { select: { status: true } },
        transferencias: { select: { id: true } },
      },
    });
    res.json(
      rotas.map((r) => {
        const peso = num(r.pesoTotalKg);
        const capacidade = r.veiculo ? num(r.veiculo.capacidadeKg) : 0;
        return {
          id: r.id,
          codigo: r.codigo,
          data: r.data.toISOString(),
          status: r.status,
          veiculo: veiculoDTO(r.veiculo),
          motorista: r.motorista,
          pesoTotalKg: peso,
          capacidadeKg: capacidade > 0 ? capacidade : null,
          ocupacao: ocupacaoDe(peso, capacidade),
          distanciaKm: numOuNull(r.distanciaKm),
          entregas: r.entregas.length,
          entregues: r.entregas.filter((e) => e.status === 'ENTREGUE').length,
          transferencias: r.transferencias.length,
        };
      }),
    );
  }),
);

router.get(
  '/rotas/:id',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    res.json(await detalheRota(idParam(req)));
  }),
);

router.post(
  '/rotas',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(novaRotaSchema, req.body);
    const loja = await lojaDaRequisicao(req);
    const data = dataDoCorpo(dados.data);
    const entregaIds = [...new Set(dados.entregaIds ?? [])];
    const transferenciaIds = [...new Set(dados.transferenciaIds ?? [])];

    const id = await prisma.$transaction(async (tx) => {
      let veiculo: Veiculo | null = null;
      if (dados.veiculoId) {
        veiculo = await tx.veiculo.findUnique({ where: { id: dados.veiculoId } });
        if (!veiculo) throw new HttpError(404, 'Veículo não encontrado');
      }
      await conferirMotorista(tx, dados.motoristaId);

      if (entregaIds.length) {
        const entregas = await tx.entrega.findMany({ where: { id: { in: entregaIds } } });
        conferirEntregasParaRota(entregas, entregaIds, null);
      }
      if (transferenciaIds.length) {
        const trs = await tx.transferencia.findMany({ where: { id: { in: transferenciaIds } } });
        conferirTransferenciasParaRota(trs, transferenciaIds, null);
      }

      const rota = await tx.rota.create({
        data: {
          codigo: await novoCodigoRota(tx, data),
          lojaId: loja,
          data,
          veiculoId: dados.veiculoId ?? null,
          motoristaId: dados.motoristaId ?? null,
          observacoes: dados.observacoes ?? null,
        },
      });

      for (const [indice, entregaId] of entregaIds.entries()) {
        await tx.entrega.update({
          where: { id: entregaId },
          data: { rotaId: rota.id, status: 'SEPARANDO', ordem: indice + 1 },
        });
      }
      if (transferenciaIds.length) {
        await tx.transferencia.updateMany({ where: { id: { in: transferenciaIds } }, data: { rotaId: rota.id } });
      }

      const peso = await pesoDaRota(tx, rota.id);
      conferirCapacidade(peso, veiculo, dados.forcar);
      await tx.rota.update({ where: { id: rota.id }, data: { pesoTotalKg: arred2(peso) } });
      return rota.id;
    });

    res.status(201).json(await detalheRota(id));
  }),
);

router.put(
  '/rotas/:id',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarRotaSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const rota = await tx.rota.findUnique({ where: { id } });
      if (!rota) throw new HttpError(404, 'Rota não encontrada');
      if (rota.status === 'CONCLUIDA' || rota.status === 'CANCELADA') {
        throw new HttpError(409, `Rota ${ROTULOS_ROTA[rota.status]}: não dá para alterar`);
      }

      const mexeNaCarga = (dados.adicionar?.length ?? 0) > 0 || (dados.remover?.length ?? 0) > 0 || dados.ordem !== undefined;
      if (mexeNaCarga && rota.status !== 'MONTANDO' && rota.status !== 'CARREGADA') {
        throw new HttpError(409, 'A carga só pode ser alterada antes da saída');
      }

      const veiculoId = dados.veiculoId !== undefined ? dados.veiculoId : rota.veiculoId;
      const motoristaId = dados.motoristaId !== undefined ? dados.motoristaId : rota.motoristaId;
      let veiculo: Veiculo | null = null;
      if (veiculoId) {
        veiculo = await tx.veiculo.findUnique({ where: { id: veiculoId } });
        if (!veiculo) throw new HttpError(404, 'Veículo não encontrado');
      }
      await conferirMotorista(tx, motoristaId);

      if (dados.adicionar?.length) {
        const ids = [...new Set(dados.adicionar)];
        const entregas = await tx.entrega.findMany({ where: { id: { in: ids } } });
        conferirEntregasParaRota(entregas, ids, id);
        const maior = await tx.entrega.aggregate({ where: { rotaId: id }, _max: { ordem: true } });
        let proxima = maior._max.ordem ?? 0;
        for (const entregaId of ids) {
          proxima += 1;
          await tx.entrega.update({
            where: { id: entregaId },
            data: { rotaId: id, status: 'SEPARANDO', ordem: proxima },
          });
        }
      }

      if (dados.remover?.length) {
        await tx.entrega.updateMany({
          where: { id: { in: dados.remover }, rotaId: id },
          data: { rotaId: null, ordem: null, status: 'PENDENTE' },
        });
      }

      if (dados.ordem) {
        const ids = [...new Set(dados.ordem)];
        const naRota = await tx.entrega.count({ where: { id: { in: ids }, rotaId: id } });
        if (naRota !== ids.length) throw new HttpError(400, 'A nova ordem tem entregas que não estão nesta rota');
        for (const [indice, entregaId] of ids.entries()) {
          await tx.entrega.update({ where: { id: entregaId }, data: { ordem: indice + 1 } });
        }
      }

      const peso = await pesoDaRota(tx, id);
      conferirCapacidade(peso, veiculo, dados.forcar);
      await tx.rota.update({
        where: { id },
        data: {
          veiculoId,
          motoristaId,
          observacoes: dados.observacoes !== undefined ? dados.observacoes : rota.observacoes,
          pesoTotalKg: arred2(peso),
        },
      });
    });

    res.json(await detalheRota(id));
  }),
);

// Roteirização: vizinho mais próximo a partir da loja (ou da primeira entrega com coordenadas).
// Entregas sem coordenadas vão para o fim, por bairro.
router.post(
  '/rotas/:id/roteirizar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await prisma.$transaction(async (tx) => {
      const rota = await tx.rota.findUnique({
        where: { id },
        include: {
          loja: { select: { latitude: true, longitude: true } },
          entregas: { select: { id: true, destinatario: true, bairro: true, latitude: true, longitude: true } },
        },
      });
      if (!rota) throw new HttpError(404, 'Rota não encontrada');
      if (rota.status !== 'MONTANDO' && rota.status !== 'CARREGADA') {
        throw new HttpError(409, 'A rota só pode ser roteirizada antes da saída');
      }

      const comCoordenadas = rota.entregas
        .filter((e) => e.latitude !== null && e.longitude !== null)
        .map((e) => ({ id: e.id, ponto: { lat: num(e.latitude), lng: num(e.longitude) } }));
      const semCoordenadas = rota.entregas
        .filter((e) => e.latitude === null || e.longitude === null)
        .sort(
          (a, b) =>
            (a.bairro ?? '').localeCompare(b.bairro ?? '', 'pt-BR') ||
            a.destinatario.localeCompare(b.destinatario, 'pt-BR'),
        );

      const lojaPonto =
        rota.loja.latitude !== null && rota.loja.longitude !== null
          ? { lat: num(rota.loja.latitude), lng: num(rota.loja.longitude) }
          : null;
      const origem = lojaPonto ?? comCoordenadas[0]?.ponto ?? null;

      const sequencia: number[] = [];
      let distancia = 0;
      if (origem && comCoordenadas.length > 0) {
        let atual = origem;
        const restantes = [...comCoordenadas];
        while (restantes.length > 0) {
          let indiceMelhor = 0;
          let menor = Infinity;
          restantes.forEach((p, i) => {
            const d = distanciaKm(atual, p.ponto);
            if (d < menor) {
              menor = d;
              indiceMelhor = i;
            }
          });
          const [escolhida] = restantes.splice(indiceMelhor, 1);
          distancia += distanciaKm(atual, escolhida.ponto);
          sequencia.push(escolhida.id);
          atual = escolhida.ponto;
        }
        // Volta à origem.
        distancia += distanciaKm(atual, origem);
      }
      for (const e of semCoordenadas) sequencia.push(e.id);

      for (const [indice, entregaId] of sequencia.entries()) {
        await tx.entrega.update({ where: { id: entregaId }, data: { ordem: indice + 1 } });
      }
      const distanciaFinal = origem && comCoordenadas.length > 0 ? arred2(distancia * FATOR_ESTRADA) : null;
      await tx.rota.update({ where: { id }, data: { distanciaKm: distanciaFinal } });
    });

    res.json(await detalheRota(id));
  }),
);

router.post(
  '/rotas/:id/status',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(statusRotaSchema, req.body);
    await mudarStatusRota(
      id,
      dados.status,
      { kmInicial: dados.kmInicial ?? undefined, kmFinal: dados.kmFinal ?? undefined },
      req.usuario.id,
    );
    res.json(await detalheRota(id));
  }),
);

// Romaneio: dados para imprimir a carga, na ordem das paradas, com os itens de cada venda ou pedido.
router.get(
  '/rotas/:id/romaneio',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const rota = await prisma.rota.findUnique({
      where: { id },
      include: {
        loja: { select: { nome: true } },
        motorista: { select: { nome: true } },
        veiculo: true,
        entregas: {
          include: {
            venda: {
              select: {
                numero: true,
                itens: {
                  where: { cancelado: false },
                  select: { descricao: true, quantidade: true, produto: { select: { unidade: true } } },
                },
              },
            },
            pedidoVenda: {
              select: {
                numero: true,
                itens: {
                  select: { quantidade: true, produto: { select: { nome: true, unidade: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!rota) throw new HttpError(404, 'Rota não encontrada');

    const entregas = [...rota.entregas].sort(porOrdem).map((e) => ({
      ordem: e.ordem,
      codigo: e.codigo,
      destinatario: e.destinatario,
      telefone: e.telefone,
      endereco: e.endereco,
      bairro: e.bairro,
      cidade: e.cidade,
      valorCobrar: num(e.valorCobrar),
      pesoKg: num(e.pesoKg),
      observacao: e.observacao,
      itens: [
        ...(e.venda?.itens ?? []).map((i) => ({
          descricao: i.descricao,
          quantidade: num(i.quantidade),
          unidade: i.produto.unidade,
        })),
        ...(e.pedidoVenda?.itens ?? []).map((i) => ({
          descricao: i.produto.nome,
          quantidade: num(i.quantidade),
          unidade: i.produto.unidade,
        })),
      ],
    }));

    res.json({
      codigo: rota.codigo,
      data: rota.data.toISOString(),
      loja: rota.loja.nome,
      veiculo: veiculoDTO(rota.veiculo),
      motorista: rota.motorista?.nome ?? null,
      observacoes: rota.observacoes,
      pesoTotalKg: num(rota.pesoTotalKg),
      totalCobrar: arred2(entregas.reduce((soma, e) => soma + e.valorCobrar, 0)),
      entregas,
    });
  }),
);

// ---------- Motorista ----------

router.get(
  '/motorista/entregas',
  permitir('MOTORISTA'),
  asyncHandler(async (req, res) => {
    const hoje = new Date();
    const rota = await prisma.rota.findFirst({
      where: {
        motoristaId: req.usuario.id,
        data: { gte: inicioDoDia(hoje), lte: fimDoDia(hoje) },
        status: { notIn: ['CONCLUIDA', 'CANCELADA'] },
      },
      orderBy: { id: 'desc' },
      include: INCLUI_ROTA,
    });
    res.json(rota ? rotaDTO(rota) : null);
  }),
);

router.post(
  '/motorista/rotas/:id/iniciar',
  permitir('MOTORISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(z.object({ kmInicial: z.number().int().nonnegative() }), req.body);
    await garantirRotaDoMotorista(id, req.usuario.id);
    await mudarStatusRota(id, 'EM_ROTA', { kmInicial: dados.kmInicial }, req.usuario.id);
    res.json(await detalheRota(id));
  }),
);

router.post(
  '/motorista/entregas/:id/status',
  permitir('MOTORISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(statusEntregaSchema, req.body);
    await aplicarStatusEntrega(id, dados, req.usuario.id);
    const atual = await prisma.entrega.findUnique({ where: { id }, include: INCLUI_ENTREGA });
    if (!atual) throw new HttpError(404, 'Entrega não encontrada');
    res.json(entregaDTO(atual));
  }),
);

// ---------- Transferências entre lojas ----------

async function detalheTransferencia(id: number) {
  const t = await prisma.transferencia.findUnique({
    where: { id },
    include: {
      origem: { select: { id: true, nome: true } },
      destino: { select: { id: true, nome: true } },
      rota: { select: { codigo: true } },
      itens: { include: { produto: { select: { codigo: true, nome: true, unidade: true } } } },
    },
  });
  if (!t) throw new HttpError(404, 'Transferência não encontrada');
  return {
    id: t.id,
    status: t.status,
    origemLojaId: t.origemLojaId,
    origem: t.origem.nome,
    destinoLojaId: t.destinoLojaId,
    destino: t.destino.nome,
    observacoes: t.observacoes,
    rotaId: t.rotaId,
    rotaCodigo: t.rota?.codigo ?? null,
    criadoEm: t.criadoEm.toISOString(),
    enviadaEm: iso(t.enviadaEm),
    recebidaEm: iso(t.recebidaEm),
    itens: t.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      codigo: i.produto.codigo,
      produto: i.produto.nome,
      unidade: i.produto.unidade,
      quantidade: num(i.quantidade),
      quantidadeRecebida: numOuNull(i.quantidadeRecebida),
    })),
  };
}

router.get(
  '/transferencias',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const loja = await filtroLoja(req);
    const where: Prisma.TransferenciaWhereInput =
      loja === null ? {} : { OR: [{ origemLojaId: loja }, { destinoLojaId: loja }] };
    const transferencias = await prisma.transferencia.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      include: {
        origem: { select: { nome: true } },
        destino: { select: { nome: true } },
        rota: { select: { codigo: true } },
        itens: { select: { id: true } },
      },
    });
    res.json(
      transferencias.map((t) => ({
        id: t.id,
        origemLojaId: t.origemLojaId,
        origem: t.origem.nome,
        destinoLojaId: t.destinoLojaId,
        destino: t.destino.nome,
        status: t.status,
        criadoEm: t.criadoEm.toISOString(),
        enviadaEm: iso(t.enviadaEm),
        recebidaEm: iso(t.recebidaEm),
        itens: t.itens.length,
        rotaCodigo: t.rota?.codigo ?? null,
      })),
    );
  }),
);

router.get(
  '/transferencias/:id',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    res.json(await detalheTransferencia(idParam(req)));
  }),
);

router.post(
  '/transferencias',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const dados = validar(novaTransferenciaSchema, req.body);
    const origem = dados.origemLojaId ?? (await lojaDaRequisicao(req));
    if (origem === dados.destinoLojaId) throw new HttpError(400, 'Origem e destino devem ser lojas diferentes');

    const lojas = await prisma.loja.findMany({
      where: { id: { in: [origem, dados.destinoLojaId] } },
      select: { id: true },
    });
    if (lojas.length !== 2) throw new HttpError(404, 'Loja não encontrada');

    const produtoIds = [...new Set(dados.itens.map((i) => i.produtoId))];
    const produtos = await prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true } });
    if (produtos.length !== produtoIds.length) throw new HttpError(404, 'Produto não encontrado');

    const criada = await prisma.transferencia.create({
      data: {
        origemLojaId: origem,
        destinoLojaId: dados.destinoLojaId,
        observacoes: dados.observacoes ?? null,
        usuarioId: req.usuario.id,
        itens: {
          create: dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: arred3(i.quantidade) })),
        },
      },
      select: { id: true },
    });
    res.status(201).json(await detalheTransferencia(criada.id));
  }),
);

router.post(
  '/transferencias/:id/enviar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await prisma.$transaction(async (tx) => {
      const t = await tx.transferencia.findUnique({ where: { id }, include: { itens: true } });
      if (!t) throw new HttpError(404, 'Transferência não encontrada');
      if (t.status !== 'SOLICITADA') throw new HttpError(409, 'Só dá para enviar uma transferência solicitada');
      await enviarTransferencia(tx, t, req.usuario.id);
    });
    res.json(await detalheTransferencia(id));
  }),
);

router.post(
  '/transferencias/:id/receber',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(receberSchema, req.body ?? {});
    await prisma.$transaction(async (tx) => {
      const t = await tx.transferencia.findUnique({ where: { id }, include: { itens: true } });
      if (!t) throw new HttpError(404, 'Transferência não encontrada');
      if (t.status !== 'ENVIADA') throw new HttpError(409, 'Só dá para receber uma transferência enviada');

      const informados = new Map<number, number>();
      for (const i of dados.itens ?? []) informados.set(i.produtoId, i.quantidadeRecebida);
      const dosItens = new Set(t.itens.map((i) => i.produtoId));
      for (const produtoId of informados.keys()) {
        if (!dosItens.has(produtoId)) throw new HttpError(400, 'Algum item não faz parte desta transferência');
      }

      for (const item of t.itens) {
        const enviada = num(item.quantidade);
        const recebida = arred3(informados.get(item.produtoId) ?? enviada);
        if (recebida > enviada) throw new HttpError(400, 'Quantidade recebida maior que a enviada');

        const produto = await tx.produto.findUniqueOrThrow({
          where: { id: item.produtoId },
          select: { precoCusto: true },
        });
        await tx.transferenciaItem.update({ where: { id: item.id }, data: { quantidadeRecebida: recebida } });
        if (recebida > 0) {
          await movimentarEstoque(tx, {
            produtoId: item.produtoId,
            lojaId: t.destinoLojaId,
            tipo: 'TRANSFERENCIA_ENTRADA',
            quantidade: recebida,
            custoUnitario: num(produto.precoCusto),
            motivo: `Transferência #${t.id}`,
            referencia: `transferencia:${t.id}`,
            usuarioId: req.usuario.id,
          });
        }
      }

      await tx.transferencia.update({ where: { id }, data: { status: 'RECEBIDA', recebidaEm: new Date() } });
    });
    res.json(await detalheTransferencia(id));
  }),
);

router.post(
  '/transferencias/:id/cancelar',
  permitir('GESTOR', 'ESTOQUISTA'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.transferencia.findUnique({ where: { id }, select: { status: true } });
    if (!t) throw new HttpError(404, 'Transferência não encontrada');
    if (t.status !== 'SOLICITADA') throw new HttpError(409, 'Só dá para cancelar uma transferência solicitada');
    await prisma.transferencia.update({ where: { id }, data: { status: 'CANCELADA', rotaId: null } });
    res.json(await detalheTransferencia(id));
  }),
);

// ---------- Público: rastreio da entrega (sem login, sem dados pessoais além do primeiro nome) ----------

publico.get(
  '/publico/entregas/:codigo',
  asyncHandler(async (req, res) => {
    const codigo = String(req.params.codigo);
    const entrega = await prisma.entrega.findUnique({ where: { codigo } });
    if (!entrega) throw new HttpError(404, 'Entrega não encontrada');

    // Quantas entregas ainda estão na rua antes desta (só quando ela está em rota).
    let posicaoNaRota: number | null = null;
    if (entrega.status === 'EM_ROTA' && entrega.rotaId !== null && entrega.ordem !== null) {
      posicaoNaRota = await prisma.entrega.count({
        where: { rotaId: entrega.rotaId, status: 'EM_ROTA', ordem: { lt: entrega.ordem } },
      });
    }

    const config = await lerConfiguracao();
    res.json({
      codigo: entrega.codigo,
      status: entrega.status,
      destinatario: entrega.destinatario.trim().split(/\s+/)[0] ?? '',
      bairro: entrega.bairro,
      previsao: iso(entrega.previsao),
      saiuEm: iso(entrega.saiuEm),
      entregueEm: iso(entrega.entregueEm),
      posicaoNaRota,
      empresa: config.nome,
      historico: avisosDe(entrega.avisosWhatsapp).map((a) => {
        const aviso = a as Partial<AvisoWhatsapp>;
        return { status: aviso.status ?? null, em: aviso.em ?? null, mensagem: aviso.mensagem ?? null };
      }),
    });
  }),
);
