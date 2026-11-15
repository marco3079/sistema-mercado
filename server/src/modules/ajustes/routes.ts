import { Router } from 'express';
import { z } from 'zod';
import type { ConfiguracaoPlataforma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { num } from '../../lib/numeros';
import { cifrar } from '../../lib/cripto';
import { lerConfiguracao, limparCacheConfiguracao } from '../../lib/email';

// Ajustes do mercado (Configurações > Mercado): Pix, preços, balança, fiado, nota fiscal,
// contador, delivery, WhatsApp, integrações e assistente de IA. Grava em ConfiguracaoPlataforma (id 1).
const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Segredos (token do WhatsApp e chave da IA) nunca voltam ao cliente: só se estão definidos.
function dtoMercado(c: ConfiguracaoPlataforma) {
  return {
    pixChave: c.pixChave ?? null,
    pixNome: c.pixNome ?? null,
    pixCidade: c.pixCidade ?? null,
    margemPadrao: num(c.margemPadrao),
    arredondarPreco: c.arredondarPreco,
    balancaPrefixo: c.balancaPrefixo,
    balancaModo: c.balancaModo,
    balancaDigitosPlu: c.balancaDigitosPlu,
    fiadoAtivo: c.fiadoAtivo,
    fiscalProvedor: c.fiscalProvedor,
    fiscalAmbiente: c.fiscalAmbiente,
    fiscalCnpj: c.fiscalCnpj ?? null,
    fiscalEmissaoAutomatica: c.fiscalEmissaoAutomatica,
    fiscalNcmPadrao: c.fiscalNcmPadrao,
    fiscalCfopPadrao: c.fiscalCfopPadrao,
    fiscalCsosnPadrao: c.fiscalCsosnPadrao,
    contadorNome: c.contadorNome ?? null,
    contadorEmail: c.contadorEmail ?? null,
    contadorEnvioAutomatico: c.contadorEnvioAutomatico,
    contadorDiaEnvio: c.contadorDiaEnvio,
    deliveryAtivo: c.deliveryAtivo,
    deliveryTaxa: num(c.deliveryTaxa),
    deliveryPedidoMinimo: num(c.deliveryPedidoMinimo),
    whatsappAtivo: c.whatsappAtivo,
    whatsappNumero: c.whatsappNumero ?? null,
    whatsappTokenDefinido: Boolean(c.whatsappTokenCifrado),
    marketplaceAtivo: c.marketplaceAtivo,
    scantechAtivo: c.scantechAtivo,
    mixFiscalAtivo: c.mixFiscalAtivo,
    iaAtiva: c.iaAtiva,
    iaChaveDefinida: Boolean(c.iaChaveCifrada),
    etiquetaModo: c.etiquetaModo,
    etiquetaLarguraMm: c.etiquetaLarguraMm,
    etiquetaAlturaMm: c.etiquetaAlturaMm,
    etiquetaColunas: c.etiquetaColunas,
    zebraIp: c.zebraIp ?? null,
    zebraPorta: c.zebraPorta,
    zebraDpi: c.zebraDpi,
  };
}

// ---------- Schema (zod) ----------

// Texto opcional: vazio vira null; ausente continua ausente (não mexe no campo).
const textoOpcional = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const emailOpcional = textoOpcional.refine(
  (v) => v === undefined || v === null || EMAIL.test(v),
  'E-mail do contador inválido'
);

const ajusteSchema = z.object({
  pixChave: textoOpcional,
  pixNome: textoOpcional,
  pixCidade: textoOpcional,
  margemPadrao: z.number().min(0).max(1000).optional(),
  arredondarPreco: z.boolean().optional(),
  balancaPrefixo: z.string().regex(/^\d$/, 'Prefixo da balança deve ser um dígito').optional(),
  balancaModo: z.enum(['PRECO', 'PESO']).optional(),
  balancaDigitosPlu: z.number().int().min(4).max(6).optional(),
  fiadoAtivo: z.boolean().optional(),
  fiscalProvedor: z.enum(['NENHUM', 'SIMULADO', 'FOCUS_NFE', 'WEBMANIA', 'NUVEM_FISCAL']).optional(),
  fiscalAmbiente: z.enum(['HOMOLOGACAO', 'PRODUCAO']).optional(),
  fiscalCnpj: textoOpcional,
  fiscalEmissaoAutomatica: z.boolean().optional(),
  fiscalNcmPadrao: z.string().trim().regex(/^\d{1,8}$/, 'NCM padrão inválido').optional(),
  fiscalCfopPadrao: z.string().trim().regex(/^\d{1,4}$/, 'CFOP padrão inválido').optional(),
  fiscalCsosnPadrao: z.string().trim().regex(/^\d{1,3}$/, 'CSOSN padrão inválido').optional(),
  contadorNome: textoOpcional,
  contadorEmail: emailOpcional,
  contadorEnvioAutomatico: z.boolean().optional(),
  contadorDiaEnvio: z.number().int().min(1).max(28).optional(),
  deliveryAtivo: z.boolean().optional(),
  deliveryTaxa: z.number().min(0).optional(),
  deliveryPedidoMinimo: z.number().min(0).optional(),
  whatsappAtivo: z.boolean().optional(),
  whatsappNumero: textoOpcional,
  // Segredos: string não vazia grava (cifrada); null apaga; vazio ou ausente mantém o que está gravado.
  whatsappToken: z.string().nullable().optional(),
  marketplaceAtivo: z.boolean().optional(),
  scantechAtivo: z.boolean().optional(),
  mixFiscalAtivo: z.boolean().optional(),
  iaAtiva: z.boolean().optional(),
  iaChave: z.string().nullable().optional(),
  // Impressão de etiquetas: formato padrão, tamanho em mm, colunas, Zebra (IP, porta, DPI).
  etiquetaModo: z.enum(['A4', 'TERMICA', 'ZEBRA']).optional(),
  etiquetaLarguraMm: z.number().int().min(15).max(120).optional(),
  etiquetaAlturaMm: z.number().int().min(15).max(120).optional(),
  etiquetaColunas: z.number().int().min(1).max(4).optional(),
  zebraIp: textoOpcional,
  zebraPorta: z.number().int().min(1).max(65535).optional(),
  zebraDpi: z.union([z.literal(203), z.literal(300)]).optional(),
});

// ---------- Rotas (GESTOR) ----------

router.get(
  '/configuracoes/mercado',
  permitir('GESTOR'),
  asyncHandler(async (_req, res) => {
    const configuracao = await prisma.configuracaoPlataforma.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    res.json(dtoMercado(configuracao));
  })
);

router.put(
  '/configuracoes/mercado',
  permitir('GESTOR'),
  asyncHandler(async (req, res) => {
    const { whatsappToken, iaChave, ...campos } = validar(ajusteSchema, req.body);

    const segredos: { whatsappTokenCifrado?: string | null; iaChaveCifrada?: string | null } = {};
    if (whatsappToken === null) segredos.whatsappTokenCifrado = null;
    else if (whatsappToken !== undefined && whatsappToken.trim() !== '') {
      segredos.whatsappTokenCifrado = cifrar(whatsappToken);
    }
    if (iaChave === null) segredos.iaChaveCifrada = null;
    else if (iaChave !== undefined && iaChave.trim() !== '') {
      segredos.iaChaveCifrada = cifrar(iaChave);
    }

    const configuracao = await prisma.configuracaoPlataforma.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: { ...campos, ...segredos },
    });
    limparCacheConfiguracao();
    res.json(dtoMercado(configuracao));
  })
);

// ---------- Público (qualquer usuário logado; sem segredos) ----------

router.get(
  '/configuracoes/mercado/publico',
  asyncHandler(async (_req, res) => {
    const c = await lerConfiguracao();
    res.json({
      pixAtivo: Boolean(c.pixChave),
      balancaPrefixo: c.balancaPrefixo,
      balancaModo: c.balancaModo,
      balancaDigitosPlu: c.balancaDigitosPlu,
      fiadoAtivo: c.fiadoAtivo,
      deliveryAtivo: c.deliveryAtivo,
      deliveryTaxa: num(c.deliveryTaxa),
      deliveryPedidoMinimo: num(c.deliveryPedidoMinimo),
      margemPadrao: num(c.margemPadrao),
      arredondarPreco: c.arredondarPreco,
      whatsappAtivo: c.whatsappAtivo,
      marketplaceAtivo: c.marketplaceAtivo,
      scantechAtivo: c.scantechAtivo,
      mixFiscalAtivo: c.mixFiscalAtivo,
      fiscalProvedor: c.fiscalProvedor,
      iaAtiva: c.iaAtiva,
      etiquetaModo: c.etiquetaModo,
      etiquetaLarguraMm: c.etiquetaLarguraMm,
      etiquetaAlturaMm: c.etiquetaAlturaMm,
      etiquetaColunas: c.etiquetaColunas,
      zebraConfigurada: Boolean(c.zebraIp),
    });
  })
);

export default router;
