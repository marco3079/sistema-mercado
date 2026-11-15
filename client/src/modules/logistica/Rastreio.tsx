import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/mercado';
import { assinarEntrega } from '../../lib/tempoReal';
import { Aviso, Carregando, formatarDataHora } from '../../ui';
import type { RastreioDTO, StatusEntrega } from './tipos';

// Página pública de rastreio (sem login). Atualiza sozinha: pelo fluxo de eventos e a cada 30 s.

const ETAPAS: { chave: StatusEntrega; rotulo: string }[] = [
  { chave: 'PENDENTE', rotulo: 'Pedido recebido' },
  { chave: 'SEPARANDO', rotulo: 'Separando' },
  { chave: 'EM_ROTA', rotulo: 'Saiu para entrega' },
  { chave: 'ENTREGUE', rotulo: 'Entregue' },
];

const INTERVALO_MS = 30000;

function fraseDoStatus(status: StatusEntrega): string {
  switch (status) {
    case 'PENDENTE':
      return 'Recebemos o seu pedido. Estamos preparando a entrega.';
    case 'SEPARANDO':
      return 'Seu pedido está sendo separado.';
    case 'EM_ROTA':
      return 'Seu pedido saiu para entrega.';
    case 'ENTREGUE':
      return 'Pedido entregue. Obrigado pela preferência!';
    case 'FALHOU':
      return 'Não conseguimos entregar agora. Vamos entrar em contato.';
    case 'CANCELADA':
      return 'Esta entrega foi cancelada.';
  }
}

function textoDaPosicao(posicao: number): string {
  if (posicao === 0) return 'Você é a próxima parada!';
  return `Faltam ${posicao} ${posicao === 1 ? 'entrega' : 'entregas'} antes da sua.`;
}

export function Rastreio() {
  const { codigo = '' } = useParams();
  const [dados, setDados] = useState<RastreioDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const resposta = await api.get<RastreioDTO>(`/publico/entregas/${encodeURIComponent(codigo)}`);
      setDados(resposta);
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  }, [codigo]);

  useEffect(() => {
    void carregar();
    const intervalo = window.setInterval(() => void carregar(), INTERVALO_MS);
    const pararDeOuvir = assinarEntrega(codigo, () => void carregar());
    return () => {
      window.clearInterval(intervalo);
      pararDeOuvir();
    };
  }, [carregar, codigo]);

  const etapaAtual = dados ? ETAPAS.findIndex((e) => e.chave === dados.status) : -1;
  const encerrada = dados?.status === 'FALHOU' || dados?.status === 'CANCELADA';

  return (
    <div className="logistica-rastreio">
      <header className="logistica-rastreio-topo">
        <strong>{dados?.empresa ?? 'Acompanhe sua entrega'}</strong>
        <span>Código {codigo}</span>
      </header>

      <main className="logistica-rastreio-corpo">
        {carregando && !dados && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {dados && (
          <>
            <section className="logistica-rastreio-cartao">
              {dados.destinatario && <p className="logistica-rastreio-saudacao">Olá, {dados.destinatario}</p>}
              <h1 className="logistica-rastreio-frase">{fraseDoStatus(dados.status)}</h1>
              {dados.status === 'EM_ROTA' && dados.posicaoNaRota !== null && (
                <p className="logistica-rastreio-destaque">{textoDaPosicao(dados.posicaoNaRota)}</p>
              )}
              {dados.previsao && !encerrada && dados.status !== 'ENTREGUE' && (
                <p className="logistica-rastreio-info">Previsão: {formatarDataHora(dados.previsao)}</p>
              )}
              {dados.entregueEm && (
                <p className="logistica-rastreio-info">Entregue em {formatarDataHora(dados.entregueEm)}</p>
              )}
              {dados.bairro && <p className="logistica-rastreio-info">Bairro: {dados.bairro}</p>}
            </section>

            {!encerrada && (
              <section className="logistica-rastreio-cartao">
                <h2 className="logistica-rastreio-titulo">Acompanhamento</h2>
                <ol className="logistica-rastreio-etapas">
                  {ETAPAS.map((etapa, indice) => {
                    const feita = indice < etapaAtual;
                    const atual = indice === etapaAtual;
                    const classe = feita
                      ? 'logistica-rastreio-etapa logistica-rastreio-etapa-feita'
                      : atual
                        ? 'logistica-rastreio-etapa logistica-rastreio-etapa-atual'
                        : 'logistica-rastreio-etapa';
                    return (
                      <li key={etapa.chave} className={classe} aria-current={atual ? 'step' : undefined}>
                        <span className="logistica-rastreio-marca" aria-hidden="true">
                          {feita ? '✓' : ''}
                        </span>
                        <span>{etapa.rotulo}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <p className="logistica-rastreio-nota">Esta página se atualiza sozinha.</p>
          </>
        )}
      </main>
    </div>
  );
}
