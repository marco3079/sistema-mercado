import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import { HttpError } from './erros';
import { lerConfiguracao } from './email';

// Ações sensíveis de quem não é gestor (ex.: operador de caixa): cada uma pode ser livre,
// pedir a senha do gestor ou ser só do gestor. O gestor sempre pode, sem senha.

export const ACOES = [
  'CANCELAR_ITEM',
  'CANCELAR_VENDA',
  'DESCONTO_MANUAL',
  'SANGRIA',
  'FIADO_ACIMA_LIMITE',
  'AJUSTE_ESTOQUE',
  'ALTERAR_PRECO',
] as const;

export type AcaoSensivel = (typeof ACOES)[number];

export const MODOS = ['LIVRE', 'COM_SENHA', 'SO_GESTOR'] as const;

export type Modo = (typeof MODOS)[number];

export const REGRAS_PADRAO: Record<AcaoSensivel, Modo> = {
  CANCELAR_ITEM: 'COM_SENHA',
  CANCELAR_VENDA: 'COM_SENHA',
  DESCONTO_MANUAL: 'COM_SENHA',
  SANGRIA: 'LIVRE',
  FIADO_ACIMA_LIMITE: 'COM_SENHA',
  AJUSTE_ESTOQUE: 'LIVRE',
  ALTERAR_PRECO: 'COM_SENHA',
};

// Tentativas erradas de senha do gestor, por usuário (em memória).
const JANELA_TENTATIVAS_MS = 10 * 60 * 1000;
const LIMITE_TENTATIVAS = 5;
const tentativasErradas = new Map<number, number[]>();

function tentativasRecentes(usuarioId: number, agora: number): number[] {
  return (tentativasErradas.get(usuarioId) ?? []).filter((instante) => agora - instante < JANELA_TENTATIVAS_MS);
}

// Tira as contas vencidas para o mapa não crescer para sempre.
function limparTentativasVencidas(): void {
  const agora = Date.now();
  for (const [usuarioId] of tentativasErradas) {
    const recentes = tentativasRecentes(usuarioId, agora);
    if (recentes.length === 0) {
      tentativasErradas.delete(usuarioId);
    } else {
      tentativasErradas.set(usuarioId, recentes);
    }
  }
}

setInterval(limparTentativasVencidas, JANELA_TENTATIVAS_MS).unref();

// Junta o padrão com o que está gravado em regrasAcoes. Chave ou valor desconhecido é descartado.
export async function lerRegras(): Promise<Record<AcaoSensivel, Modo>> {
  const configuracao = await lerConfiguracao();
  const regras: Record<AcaoSensivel, Modo> = { ...REGRAS_PADRAO };
  const bruto: unknown = configuracao.regrasAcoes;
  if (typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto)) {
    for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
      const acaoConhecida = (ACOES as readonly string[]).includes(chave);
      const modoConhecido = typeof valor === 'string' && (MODOS as readonly string[]).includes(valor);
      if (acaoConhecida && modoConhecido) {
        regras[chave as AcaoSensivel] = valor as Modo;
      }
    }
  }
  return regras;
}

// Confere a regra da ação para quem está logado. Lança HttpError se não puder seguir.
export async function exigirAcao(req: Request, acao: AcaoSensivel): Promise<void> {
  if (req.usuario.perfil === 'GESTOR') return;
  // Formar preço é o trabalho do comprador: para ele a mudança de preço é sempre livre.
  if (req.usuario.perfil === 'COMPRADOR' && acao === 'ALTERAR_PRECO') return;
  const regras = await lerRegras();
  const modo = regras[acao];
  if (modo === 'LIVRE') return;
  if (modo === 'SO_GESTOR') {
    throw new HttpError(403, 'Só o gestor pode fazer isto');
  }

  // COM_SENHA: a senha vem no cabeçalho x-senha-gestor. Nunca vai para log nem para a resposta.
  const senhaInformada = req.get('x-senha-gestor');
  if (!senhaInformada) {
    throw new HttpError(403, 'Esta ação pede a senha do gestor', { codigo: 'SENHA_GESTOR', acao });
  }

  const usuarioId = req.usuario.id;
  const agora = Date.now();
  const recentes = tentativasRecentes(usuarioId, agora);
  if (recentes.length >= LIMITE_TENTATIVAS) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  }

  const configuracao = await lerConfiguracao();
  // Sem senha gravada, nenhuma senha confere (a regra COM_SENHA só existe com senha definida).
  const confere = configuracao.pinHash ? await bcrypt.compare(senhaInformada, configuracao.pinHash) : false;
  if (!confere) {
    tentativasErradas.set(usuarioId, [...recentes, agora]);
    throw new HttpError(403, 'Senha do gestor incorreta', { codigo: 'SENHA_GESTOR', acao });
  }
  tentativasErradas.delete(usuarioId);
}
