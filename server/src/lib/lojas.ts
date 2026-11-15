import type { Request } from 'express';
import { prisma } from './prisma';
import { HttpError } from './erros';

// Loja (filial) em que a requisição trabalha.
// O cliente manda a loja escolhida no cabeçalho `x-loja-id` (seletor do topo).
// - GESTOR, COMPRADOR e CONTADOR podem escolher qualquer loja ativa.
// - Os outros perfis ficam presos à loja do cadastro (Usuario.lojaId), se houver.
// - Sem nada definido, vale a primeira loja ativa (a matriz).
const PERFIS_QUE_ESCOLHEM = new Set(['GESTOR', 'COMPRADOR', 'CONTADOR']);

export async function lojaDaRequisicao(req: Request): Promise<number> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuario.id },
    select: { lojaId: true },
  });
  const cabecalho = req.get('x-loja-id');
  const pedida = cabecalho && /^\d+$/.test(cabecalho) ? Number(cabecalho) : null;

  let lojaId: number | null = null;
  if (usuario?.lojaId && !PERFIS_QUE_ESCOLHEM.has(req.usuario.perfil)) {
    lojaId = usuario.lojaId;
  } else if (pedida) {
    lojaId = pedida;
  } else if (usuario?.lojaId) {
    lojaId = usuario.lojaId;
  }

  if (lojaId !== null) {
    const loja = await prisma.loja.findFirst({ where: { id: lojaId, ativa: true }, select: { id: true } });
    if (loja) return loja.id;
  }
  const primeira = await prisma.loja.findFirst({ where: { ativa: true }, orderBy: { id: 'asc' }, select: { id: true } });
  if (!primeira) throw new HttpError(400, 'Cadastre uma loja antes de continuar');
  return primeira.id;
}

// `?loja=todas` nos relatórios do gestor: null = todas as lojas; senão a loja da requisição.
export async function filtroLoja(req: Request): Promise<number | null> {
  if (req.query.loja === 'todas' && PERFIS_QUE_ESCOLHEM.has(req.usuario.perfil)) return null;
  return lojaDaRequisicao(req);
}
