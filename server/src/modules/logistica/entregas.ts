import type { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/estoque';
import { lerConfiguracao } from '../../lib/email';
import { arred2, arred3, codigoAleatorio } from '../../lib/numeros';

// Criação de entrega (delivery, marketplace, faturamento da força de vendas, B2B).
// Gera o código público de rastreio e registra o aviso de WhatsApp (simulado sem token configurado).

export interface NovaEntrega {
  vendaId?: number | null;
  pedidoVendaId?: number | null;
  clienteId?: number | null;
  destinatario: string;
  telefone?: string | null;
  endereco: string;
  bairro?: string | null;
  cidade?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  taxa?: number;
  valorCobrar?: number;
  pesoKg?: number;
  previsao?: Date | null;
  observacao?: string | null;
}

export interface AvisoWhatsapp {
  status: string;
  em: string;
  mensagem: string;
  simulado: boolean;
}

export const MENSAGENS_WHATSAPP: Record<string, (codigo: string) => string> = {
  PENDENTE: (c) => `Recebemos seu pedido! Acompanhe a entrega pelo código ${c}.`,
  SEPARANDO: (c) => `Seu pedido ${c} está sendo separado.`,
  EM_ROTA: (c) => `Seu pedido ${c} saiu para entrega.`,
  ENTREGUE: (c) => `Pedido ${c} entregue. Obrigado pela preferência!`,
  FALHOU: (c) => `Não conseguimos entregar o pedido ${c}. Vamos entrar em contato.`,
  CANCELADA: (c) => `O pedido ${c} foi cancelado.`,
};

// Monta o aviso de WhatsApp de uma mudança de situação (simulado quando não há token).
export async function avisoWhatsapp(status: string, codigo: string): Promise<AvisoWhatsapp | null> {
  const config = await lerConfiguracao();
  const montar = MENSAGENS_WHATSAPP[status];
  if (!montar) return null;
  return {
    status,
    em: new Date().toISOString(),
    mensagem: montar(codigo),
    simulado: !(config.whatsappAtivo && config.whatsappTokenCifrado),
  };
}

export async function criarEntrega(tx: Tx, e: NovaEntrega): Promise<{ id: number; codigo: string }> {
  let codigo = codigoAleatorio(8);
  while (await tx.entrega.findUnique({ where: { codigo }, select: { id: true } })) codigo = codigoAleatorio(8);
  const aviso = e.telefone ? await avisoWhatsapp('PENDENTE', codigo) : null;
  const entrega = await tx.entrega.create({
    data: {
      codigo,
      vendaId: e.vendaId ?? null,
      pedidoVendaId: e.pedidoVendaId ?? null,
      clienteId: e.clienteId ?? null,
      destinatario: e.destinatario,
      telefone: e.telefone ?? null,
      endereco: e.endereco,
      bairro: e.bairro ?? null,
      cidade: e.cidade ?? null,
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      taxa: arred2(e.taxa ?? 0),
      valorCobrar: arred2(e.valorCobrar ?? 0),
      pesoKg: arred3(e.pesoKg ?? 0),
      previsao: e.previsao ?? null,
      observacao: e.observacao ?? null,
      avisosWhatsapp: (aviso ? [aviso] : []) as unknown as Prisma.InputJsonValue,
    },
  });
  return { id: entrega.id, codigo };
}
