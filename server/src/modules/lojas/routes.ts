import { Router } from 'express';
import { z } from 'zod';
import type { Loja, StatusEntrega, StatusRota } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { arred2, fimDoDia, inicioDoDia, num, numOuNull } from '../../lib/numeros';

// Lojas (filiais e centros de distribuição), equipe por loja e mapa da logística.
const router = Router();

// ---------- Utilitários ----------

function dtoLoja(loja: Loja) {
  return {
    id: loja.id,
    nome: loja.nome,
    tipo: loja.tipo,
    cnpj: loja.cnpj ?? null,
    telefone: loja.telefone ?? null,
    cep: loja.cep ?? null,
    endereco: loja.endereco ?? null,
    numero: loja.numero ?? null,
    complemento: loja.complemento ?? null,
    bairro: loja.bairro ?? null,
    cidade: loja.cidade ?? null,
    uf: loja.uf ?? null,
    horario: loja.horario ?? null,
    latitude: numOuNull(loja.latitude),
    longitude: numOuNull(loja.longitude),
    ativa: loja.ativa,
  };
}

// Endereço da loja em duas linhas: "Rua X, 123 — Bairro" e "Cidade/UF · CEP 00000-000".
function enderecoLinhas(loja: Loja): { linha1: string | null; linha2: string | null } {
  const logradouro = [loja.endereco, loja.numero].filter(Boolean).join(', ');
  const linha1 = [[logradouro, loja.complemento].filter(Boolean).join(' '), loja.bairro]
    .filter(Boolean)
    .join(' — ');
  const linha2 = [[loja.cidade, loja.uf].filter(Boolean).join('/'), loja.cep ? `CEP ${loja.cep}` : '']
    .filter(Boolean)
    .join(' · ');
  return { linha1: linha1 || null, linha2: linha2 || null };
}

// ---------- Schemas (zod) ----------

// Texto opcional: vazio vira null; ausente continua ausente (não mexe no campo).
const textoOpcional = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const ufOpcional = textoOpcional.refine(
  (v) => v === undefined || v === null || /^[A-Za-z]{2}$/.test(v),
  'UF deve ter 2 letras'
);

const coordenada = (limite: number) => z.number().min(-limite).max(limite).nullable().optional();

const camposLoja = {
  cnpj: textoOpcional,
  telefone: textoOpcional,
  horario: textoOpcional,
  cep: textoOpcional,
  endereco: textoOpcional,
  numero: textoOpcional,
  complemento: textoOpcional,
  bairro: textoOpcional,
  cidade: textoOpcional,
  uf: ufOpcional,
  latitude: coordenada(90),
  longitude: coordenada(180),
};

const tipoLojaSchema = z.enum(['LOJA', 'CENTRO_DISTRIBUICAO']);

const lojaCriarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório'),
  tipo: tipoLojaSchema,
  ...camposLoja,
});

const lojaAtualizarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').optional(),
  tipo: tipoLojaSchema.optional(),
  ativa: z.boolean().optional(),
  ...camposLoja,
});

const equipeSchema = z.object({
  perfil: z.enum(['GESTOR', 'OPERADOR', 'ESTOQUISTA', 'PADEIRO', 'COMPRADOR', 'MOTORISTA', 'VENDEDOR', 'CONTADOR']),
});

// Status de entrega que ainda não foram concluídos (aparecem no mapa).
const STATUS_ENTREGA_EM_ABERTO: StatusEntrega[] = ['PENDENTE', 'SEPARANDO', 'EM_ROTA'];
// Rotas de hoje que ainda têm trabalho para o veículo ou motorista.
const STATUS_ROTA_ATIVA: StatusRota[] = ['MONTANDO', 'CARREGADA', 'EM_ROTA'];
// Sinal GPS com menos de 5 min conta como online.
const MS_ONLINE = 5 * 60 * 1000;

// Rota de hoje do veículo (Rota.veiculoId) ou do motorista (Rota.motoristaId) do rastreador.
async function rotaDeHoje(veiculoId: number | null, motoristaId: number | null) {
  const condicoes: { veiculoId?: number; motoristaId?: number }[] = [];
  if (veiculoId) condicoes.push({ veiculoId });
  if (motoristaId) condicoes.push({ motoristaId });
  if (condicoes.length === 0) return null;
  const agora = new Date();
  return prisma.rota.findFirst({
    where: {
      OR: condicoes,
      status: { in: STATUS_ROTA_ATIVA },
      data: { gte: inicioDoDia(agora), lte: fimDoDia(agora) },
    },
    orderBy: { data: 'desc' },
    select: {
      id: true,
      codigo: true,
      status: true,
      loja: { select: { nome: true, latitude: true, longitude: true } },
      entregas: {
        where: { latitude: { not: null }, longitude: { not: null } },
        orderBy: { ordem: 'asc' },
        select: {
          id: true,
          codigo: true,
          ordem: true,
          destinatario: true,
          endereco: true,
          bairro: true,
          status: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
}

// ---------- Lojas ----------

router.get(
  '/lojas',
  asyncHandler(async (_req, res) => {
    const lojas = await prisma.loja.findMany({ orderBy: { id: 'asc' } });
    res.json(lojas.map(dtoLoja));
  })
);

router.post(
  '/lojas',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const dados = validar(lojaCriarSchema, req.body);
    const loja = await prisma.loja.create({
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        cnpj: dados.cnpj ?? null,
        telefone: dados.telefone ?? null,
        horario: dados.horario ?? null,
        cep: dados.cep ?? null,
        endereco: dados.endereco ?? null,
        numero: dados.numero ?? null,
        complemento: dados.complemento ?? null,
        bairro: dados.bairro ?? null,
        cidade: dados.cidade ?? null,
        uf: dados.uf ? dados.uf.toUpperCase() : null,
        latitude: dados.latitude ?? null,
        longitude: dados.longitude ?? null,
      },
    });
    res.status(201).json(dtoLoja(loja));
  })
);

router.put(
  '/lojas/:id',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(lojaAtualizarSchema, req.body);
    const existente = await prisma.loja.findUnique({ where: { id }, select: { id: true, ativa: true } });
    if (!existente) {
      throw new HttpError(404, 'Loja não encontrada');
    }
    // A operação nunca fica sem nenhuma loja ativa.
    if (dados.ativa === false && existente.ativa) {
      const outras = await prisma.loja.count({ where: { ativa: true, id: { not: id } } });
      if (outras === 0) {
        throw new HttpError(400, 'É preciso manter pelo menos uma loja ativa');
      }
    }
    const loja = await prisma.loja.update({
      where: { id },
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        ativa: dados.ativa,
        cnpj: dados.cnpj,
        telefone: dados.telefone,
        horario: dados.horario,
        cep: dados.cep,
        endereco: dados.endereco,
        numero: dados.numero,
        complemento: dados.complemento,
        bairro: dados.bairro,
        cidade: dados.cidade,
        uf: dados.uf === undefined ? undefined : dados.uf === null ? null : dados.uf.toUpperCase(),
        latitude: dados.latitude,
        longitude: dados.longitude,
      },
    });
    res.json(dtoLoja(loja));
  })
);

// ---------- Equipe por perfil (qualquer usuário logado) ----------

router.get(
  '/lojas/equipe',
  asyncHandler(async (req, res) => {
    const { perfil } = validar(equipeSchema, req.query);
    const usuarios = await prisma.usuario.findMany({
      where: { perfil, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, lojaId: true },
    });
    res.json(usuarios);
  })
);

// ---------- Mapa da logística: lojas, entregas, clientes atacado e frota (GPS) ----------

router.get(
  '/lojas/mapa',
  permitir('GESTOR', 'ESTOQUISTA', 'COMPRADOR'),
  asyncHandler(async (req, res) => {
    // Saldo e limite de crédito dos clientes só vão para o gestor.
    const verFinanceiro = req.usuario?.perfil === 'GESTOR';

    const [lojas, entregas, clientes, rastreadores] = await Promise.all([
      prisma.loja.findMany({ orderBy: { id: 'asc' } }),
      prisma.entrega.findMany({
        where: { status: { in: STATUS_ENTREGA_EM_ABERTO }, latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true,
          codigo: true,
          destinatario: true,
          telefone: true,
          endereco: true,
          bairro: true,
          cidade: true,
          status: true,
          latitude: true,
          longitude: true,
          valorCobrar: true,
          previsao: true,
          motorista: { select: { nome: true } },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.cliente.findMany({
        where: { tipo: 'ATACADO', ativo: true, latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true,
          nome: true,
          tipo: true,
          cpfCnpj: true,
          telefone: true,
          whatsapp: true,
          endereco: true,
          numero: true,
          bairro: true,
          cidade: true,
          latitude: true,
          longitude: true,
          limiteCredito: true,
          saldoDevedor: true,
        },
        orderBy: { nome: 'asc' },
        take: 200,
      }),
      prisma.rastreadorGps.findMany({
        where: { ativo: true, ultimaLat: { not: null }, ultimaLng: { not: null } },
        select: {
          id: true,
          nome: true,
          tipo: true,
          veiculoId: true,
          usuarioId: true,
          ultimaLat: true,
          ultimaLng: true,
          ultimaVelocidade: true,
          ultimaBateria: true,
          ultimoSinalEm: true,
          veiculo: { select: { placa: true, modelo: true } },
          usuario: { select: { nome: true } },
        },
        orderBy: { nome: 'asc' },
      }),
    ]);

    const agora = Date.now();
    const frota = await Promise.all(
      rastreadores.map(async (r) => {
        const rota = await rotaDeHoje(r.veiculoId, r.usuarioId);
        return {
          rastreadorId: r.id,
          nome: r.nome,
          tipo: r.tipo,
          veiculo: r.veiculo ? { placa: r.veiculo.placa, modelo: r.veiculo.modelo } : null,
          motorista: r.usuario?.nome ?? null,
          lat: num(r.ultimaLat),
          lng: num(r.ultimaLng),
          velocidade: numOuNull(r.ultimaVelocidade),
          bateria: r.ultimaBateria ?? null,
          ultimoSinalEm: r.ultimoSinalEm ? r.ultimoSinalEm.toISOString() : null,
          online: r.ultimoSinalEm != null && agora - r.ultimoSinalEm.getTime() < MS_ONLINE,
          rota: rota
            ? {
                id: rota.id,
                codigo: rota.codigo,
                status: rota.status,
                paradas: rota.entregas.map((e, i) => ({
                  entregaId: e.id,
                  codigo: e.codigo,
                  ordem: e.ordem ?? i + 1,
                  destinatario: e.destinatario,
                  endereco: e.endereco,
                  bairro: e.bairro ?? null,
                  status: e.status,
                  lat: num(e.latitude),
                  lng: num(e.longitude),
                })),
                loja: {
                  nome: rota.loja.nome,
                  lat: numOuNull(rota.loja.latitude),
                  lng: numOuNull(rota.loja.longitude),
                },
              }
            : null,
        };
      })
    );

    res.json({
      lojas: lojas.map((loja) => {
        const linhas = enderecoLinhas(loja);
        const enderecoFormatado = [linhas.linha1, linhas.linha2].filter(Boolean).join(' · ') || null;
        return {
          id: loja.id,
          nome: loja.nome,
          tipo: loja.tipo,
          enderecoFormatado,
          linhaEndereco1: linhas.linha1,
          linhaEndereco2: linhas.linha2,
          telefone: loja.telefone ?? null,
          horario: loja.horario ?? null,
          cnpj: loja.cnpj ?? null,
          latitude: numOuNull(loja.latitude),
          longitude: numOuNull(loja.longitude),
          ativa: loja.ativa,
        };
      }),
      entregas: entregas.map((e) => ({
        id: e.id,
        codigo: e.codigo,
        destinatario: e.destinatario,
        telefone: e.telefone ?? null,
        endereco: e.endereco,
        bairro: e.bairro ?? null,
        cidade: e.cidade ?? null,
        status: e.status,
        latitude: num(e.latitude),
        longitude: num(e.longitude),
        valorCobrar: num(e.valorCobrar),
        previsao: e.previsao ? e.previsao.toISOString() : null,
        motorista: e.motorista?.nome ?? null,
      })),
      clientes: clientes.map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        cpfCnpj: c.cpfCnpj ?? null,
        telefone: c.telefone ?? null,
        whatsapp: c.whatsapp ?? null,
        endereco: [c.endereco, c.numero].filter(Boolean).join(', ') || null,
        bairro: c.bairro ?? null,
        cidade: c.cidade ?? null,
        latitude: num(c.latitude),
        longitude: num(c.longitude),
        limiteCredito: verFinanceiro ? num(c.limiteCredito) : null,
        saldoDevedor: verFinanceiro ? num(c.saldoDevedor) : null,
      })),
      frota,
    });
  })
);

// ---------- Equipe por perfil (qualquer usuário logado) ----------

router.get(
  '/lojas/equipe',
  asyncHandler(async (req, res) => {
    const { perfil } = validar(equipeSchema, req.query);
    const usuarios = await prisma.usuario.findMany({
      where: { perfil, ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, lojaId: true },
    });
    res.json(usuarios);
  })
);

// ---------- Resumo da loja (GESTOR) ----------

router.get(
  '/lojas/:id/resumo',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const lojaId = idParam(req);
    const loja = await prisma.loja.findUnique({ where: { id: lojaId }, select: { id: true } });
    if (!loja) {
      throw new HttpError(404, 'Loja não encontrada');
    }
    const agora = new Date();
    const inicioHoje = inicioDoDia(agora);
    const inicioMes = inicioDoDia(new Date(agora.getFullYear(), agora.getMonth(), 1));
    const vendasConcluidas = { lojaId, status: 'CONCLUIDA' as const };

    const [hoje, mes, itensEmEstoque, estoques, usuarios] = await Promise.all([
      prisma.venda.aggregate({
        where: { ...vendasConcluidas, concluidaEm: { gte: inicioHoje, lte: fimDoDia(agora) } },
        _sum: { total: true },
      }),
      prisma.venda.aggregate({
        where: { ...vendasConcluidas, concluidaEm: { gte: inicioMes, lte: fimDoDia(agora) } },
        _sum: { total: true },
      }),
      prisma.estoqueLoja.count({ where: { lojaId, quantidade: { gt: 0 } } }),
      prisma.estoqueLoja.findMany({
        where: { lojaId },
        select: { quantidade: true, produto: { select: { precoCusto: true } } },
      }),
      prisma.usuario.count({ where: { lojaId, ativo: true } }),
    ]);

    let valorEstoque = 0;
    for (const item of estoques) {
      valorEstoque += num(item.quantidade) * num(item.produto.precoCusto);
    }

    res.json({
      lojaId,
      vendasHoje: arred2(num(hoje._sum.total)),
      vendasMes: arred2(num(mes._sum.total)),
      itensEmEstoque,
      valorEstoque: arred2(valorEstoque),
      usuarios,
    });
  })
);

export default router;
