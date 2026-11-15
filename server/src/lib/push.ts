import webpush from 'web-push';
import type { Perfil } from '@prisma/client';
import { prisma } from './prisma';
import { cifrar, decifrar } from './cripto';
import { lerConfiguracao, limparCacheConfiguracao } from './email';
import { aoMudar, Mudanca } from './eventos';

// Notificações no celular (Web Push): chaves VAPID, envio para as inscrições dos usuários
// e os gatilhos que avisam a equipe (pedido de delivery, B2B ou força de vendas novo).

export interface AvisoPush {
  titulo: string;
  corpo: string;
  url: string;
  marca?: string; // mesma marca substitui a notificação anterior no aparelho
}

export interface ChavesVapid {
  publica: string;
  privada: string;
}

const CONTATO_PADRAO = 'mailto:contato@localhost';
const TTL_SEGUNDOS = 60;

// ---------- Chaves VAPID ----------

let geracaoEmAndamento: Promise<ChavesVapid> | null = null;

async function lerOuGerarChaves(): Promise<ChavesVapid> {
  const configuracao = await lerConfiguracao();
  let recriada = false;
  if (configuracao.vapidPublica && configuracao.vapidPrivadaCifrada) {
    const privada = decifrar(configuracao.vapidPrivadaCifrada);
    if (privada !== null) {
      return { publica: configuracao.vapidPublica, privada };
    }
    recriada = true;
  }
  // Não existe par ainda, ou a privada não abre mais (o segredo do servidor mudou): gera um par novo.
  const par = webpush.generateVAPIDKeys();
  await prisma.configuracaoPlataforma.update({
    where: { id: 1 },
    data: { vapidPublica: par.publicKey, vapidPrivadaCifrada: cifrar(par.privateKey) },
  });
  limparCacheConfiguracao();
  if (recriada) {
    // As inscrições antigas foram feitas com a chave anterior e não funcionam mais.
    console.warn('As chaves de notificação foram geradas de novo; os aparelhos precisam ligar as notificações outra vez.');
    await prisma.inscricaoPush.deleteMany({});
  }
  return { publica: par.publicKey, privada: par.privateKey };
}

// Uma geração por vez: chamadas simultâneas esperam a mesma Promise.
export function chavesVapid(): Promise<ChavesVapid> {
  if (geracaoEmAndamento === null) {
    geracaoEmAndamento = lerOuGerarChaves().finally(() => {
      geracaoEmAndamento = null;
    });
  }
  return geracaoEmAndamento;
}

// ---------- Envio ----------

// Manda o aviso para todas as inscrições dos usuários. Nunca lança. Devolve quantas foram enviadas.
export async function notificar(usuarioIds: number[], aviso: AvisoPush): Promise<number> {
  if (usuarioIds.length === 0) {
    return 0;
  }
  try {
    const inscricoes = await prisma.inscricaoPush.findMany({
      where: { usuarioId: { in: usuarioIds } },
    });
    if (inscricoes.length === 0) {
      return 0;
    }
    const [chaves, configuracao] = await Promise.all([chavesVapid(), lerConfiguracao()]);
    const contato = configuracao.emailRemetente ? `mailto:${configuracao.emailRemetente}` : CONTATO_PADRAO;
    const payload = JSON.stringify({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      url: aviso.url,
      marca: aviso.marca,
    });
    const opcoes = {
      TTL: TTL_SEGUNDOS,
      vapidDetails: { subject: contato, publicKey: chaves.publica, privateKey: chaves.privada },
    };
    const resultados = await Promise.allSettled(
      inscricoes.map(async (inscricao) => {
        try {
          await webpush.sendNotification(
            { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
            payload,
            opcoes
          );
          return true;
        } catch (erro) {
          const status = (erro as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Inscrição expirou ou foi cancelada no aparelho: some daqui.
            await prisma.inscricaoPush.deleteMany({ where: { id: inscricao.id } });
          } else {
            console.error('Falha ao enviar notificação:', status ?? '', erro instanceof Error ? erro.message : erro);
          }
          return false;
        }
      })
    );
    return resultados.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  } catch (erro) {
    console.error('Falha ao notificar:', erro instanceof Error ? erro.message : erro);
    return 0;
  }
}

// ---------- Quem recebe ----------

// Usuários ativos dos perfis informados.
export async function usuariosDosPerfis(perfis: Perfil[]): Promise<number[]> {
  const usuarios = await prisma.usuario.findMany({
    where: { perfil: { in: perfis }, ativo: true },
    select: { id: true },
  });
  return usuarios.map((u) => u.id);
}

// Atalho: avisa todos os usuários ativos dos perfis informados.
export async function notificarPerfis(perfis: Perfil[], aviso: AvisoPush): Promise<number> {
  return notificar(await usuariosDosPerfis(perfis), aviso);
}

// ---------- Gatilhos ----------

const GATILHOS: { metodo: string; caminho: RegExp; perfis: Perfil[]; aviso: AvisoPush }[] = [
  {
    metodo: 'POST',
    caminho: /^\/api\/publico\/delivery\/pedidos$/,
    perfis: ['GESTOR', 'OPERADOR'],
    aviso: { titulo: 'Novo pedido de delivery', corpo: 'Chegou um pedido para entrega.', url: '/gestor/delivery' },
  },
  {
    metodo: 'POST',
    caminho: /^\/api\/publico\/b2b\/[^/]+\/pedidos$/,
    perfis: ['GESTOR'],
    aviso: { titulo: 'Novo pedido B2B', corpo: 'Um cliente atacado fez um pedido pela loja B2B.', url: '/gestor/pedidos-venda' },
  },
  {
    metodo: 'POST',
    caminho: /^\/api\/pedidos-venda$/,
    perfis: ['GESTOR'],
    aviso: { titulo: 'Novo pedido de vendedor', corpo: 'Um vendedor enviou um pedido.', url: '/gestor/pedidos-venda' },
  },
];

// Recebe cada mudança já gravada. Tudo em try/catch: um erro aqui nunca afeta a requisição.
function ouvirMudanca(m: Mudanca): void {
  try {
    const gatilho = GATILHOS.find((g) => g.metodo === m.metodo && g.caminho.test(m.caminho));
    if (gatilho) {
      void notificarPerfis(gatilho.perfis, gatilho.aviso).catch(registrarFalha);
    }
  } catch (erro) {
    registrarFalha(erro);
  }
}

function registrarFalha(erro: unknown): void {
  console.error('Falha ao enviar aviso no celular:', erro instanceof Error ? erro.message : erro);
}

// Registrado uma vez, quando o módulo é carregado.
aoMudar(ouvirMudanca);
