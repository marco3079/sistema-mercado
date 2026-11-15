import { Router } from 'express';
import { z } from 'zod';
import type { Loja } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { arred2, fimDoDia, inicioDoDia, num, numOuNull } from '../../lib/numeros';

// Lojas (filiais e centros de distribuição) e equipe por loja.
const router = Router();

// ---------- Utilitários ----------

function dtoLoja(loja: Loja) {
  return {
    id: loja.id,
    nome: loja.nome,
    tipo: loja.tipo,
    cnpj: loja.cnpj ?? null,
    telefone: loja.telefone ?? null,
    endereco: loja.endereco ?? null,
    cidade: loja.cidade ?? null,
    uf: loja.uf ?? null,
    latitude: numOuNull(loja.latitude),
    longitude: numOuNull(loja.longitude),
    ativa: loja.ativa,
  };
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
  endereco: textoOpcional,
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
        endereco: dados.endereco ?? null,
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
        endereco: dados.endereco,
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
