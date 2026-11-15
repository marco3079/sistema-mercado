import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { assinar, rajada } from '../../lib/tempoReal';
import { formatarQuantidade, hojeIso, horaCurta, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import { ModalConcluir } from './Producao';
import type { OrdemDTO, ReceitaDTO } from './tipos';
import { BarraNivel, FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';

// Painel do forno: tela grande para o tablet da padaria. Botões grandes e contagem regressiva
// de quem está no forno (início + tempo de forno da receita).

function formatarRelogio(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// mm:ss; zero ou menos vira "Pronto".
function formatarRestante(ms: number): string {
  const total = Math.ceil(ms / 1000);
  // Acima de uma hora: "14 h 11 min" (o mm:ss ficaria ilegível, ex.: 851:40).
  if (total >= 3600) {
    const horas = Math.floor(total / 3600);
    const resto = Math.floor((total % 3600) / 60);
    return `${horas} h ${String(resto).padStart(2, '0')} min`;
  }
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

export function PainelForno() {
  // Dia de hoje, na abertura da tela.
  const [dia] = useState(() => hojeIso(0));
  const ordens = useDados<OrdemDTO[]>(`/producao?data=${dia}`);
  const receitas = useDados<ReceitaDTO[]>('/receitas');
  const { recarregar } = ordens;

  const [agora, setAgora] = useState(() => new Date());
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [concluindo, setConcluindo] = useState<OrdemDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Relógio e contagem: a cada segundo.
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(new Date()), 1000);
    return () => window.clearInterval(relogio);
  }, []);

  // Atualiza a cada 30 s e, além disso, quando a produção muda em outra tela.
  useEffect(() => {
    const periodico = window.setInterval(() => recarregar(), 30000);
    const junta = rajada(() => recarregar(), 400);
    const parar = assinar((modulo) => {
      if (modulo === 'producao') junta.disparar();
    });
    return () => {
      window.clearInterval(periodico);
      parar();
      junta.cancelar();
    };
  }, [recarregar]);

  // Tempo de forno de cada receita (o DTO da fornada não traz esse campo).
  const tempoForno = new Map<number, number | null>();
  for (const r of receitas.dados ?? []) tempoForno.set(r.id, r.tempoFornoMin);

  async function iniciar(ordem: OrdemDTO) {
    setErro(null);
    setAviso(null);
    setOcupada(ordem.id);
    try {
      await api.post<OrdemDTO>(`/producao/${ordem.id}/iniciar`);
      setAviso(`${ordem.produto} foi para o forno.`);
      recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupada(null);
    }
  }

  const todas = ordens.dados ?? [];
  const noForno = todas.filter((o) => o.status === 'EM_PRODUCAO');
  const proximas = todas.filter((o) => o.status === 'PLANEJADA');
  const concluidas = todas.filter((o) => o.status === 'CONCLUIDA');

  function tempoDe(o: OrdemDTO): number | null {
    return tempoForno.get(o.receitaId) ?? null;
  }

  function restanteDe(o: OrdemDTO): number | null {
    const minutos = tempoDe(o);
    if (!o.iniciadoEm || minutos === null) return null;
    const fim = new Date(o.iniciadoEm).getTime() + minutos * 60000;
    return fim - agora.getTime();
  }

  const prontas = noForno.filter((o) => {
    const r = restanteDe(o);
    return r !== null && r <= 0;
  }).length;

  const relogio = formatarRelogio(agora);

  return (
    <Pagina
      titulo="Painel do forno"
      acoes={
        <div className="padaria-relogio" aria-live="off">
          <span className="padaria-relogio-data">
            {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </span>
          <span className="padaria-relogio-hora">
            {relogio.slice(0, 5)}
            <small>{relogio.slice(5)}</small>
          </span>
        </div>
      }
    >
      <div className="padaria-painel">
        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {ordens.erro && <Aviso tipo="erro">{ordens.erro}</Aviso>}
        {ordens.carregando && !ordens.dados && <Carregando />}

        {ordens.dados && (
          <>
            <div className="resumo">
              <div className="resumo-item">
                <span className="resumo-icone resumo-icone-laranja">
                  <Icone nome="pao" tamanho={22} />
                </span>
                <div>
                  <div className="resumo-valor">{noForno.length}</div>
                  <div className="resumo-rotulo">No forno</div>
                </div>
              </div>
              <div className="resumo-item">
                <span className="resumo-icone resumo-icone-verde">
                  <Icone nome="visto" tamanho={22} />
                </span>
                <div>
                  <div className="resumo-valor">{prontas}</div>
                  <div className="resumo-rotulo">Prontas para tirar</div>
                </div>
              </div>
              <div className="resumo-item">
                <span className="resumo-icone resumo-icone-azul">
                  <Icone nome="relogio" tamanho={22} />
                </span>
                <div>
                  <div className="resumo-valor">{proximas.length}</div>
                  <div className="resumo-rotulo">Próximas fornadas</div>
                </div>
              </div>
              <div className="resumo-item">
                <span className="resumo-icone resumo-icone-roxo">
                  <Icone nome="lista" tamanho={22} />
                </span>
                <div>
                  <div className="resumo-valor">{concluidas.length}</div>
                  <div className="resumo-rotulo">Concluídas hoje</div>
                </div>
              </div>
            </div>

            <section className="padaria-painel-secao">
              <h2 className="padaria-painel-titulo">No forno</h2>
              {noForno.length === 0 && <p className="padaria-painel-vazio">Nenhuma fornada no forno agora.</p>}
              <div className="padaria-painel-grade">
                {noForno.map((o) => {
                  const restante = restanteDe(o);
                  const pronto = restante !== null && restante <= 0;
                  const total = (tempoDe(o) ?? 0) * 60000;
                  const decorrido = restante === null || total === 0 ? 0 : total - Math.max(0, restante);
                  return (
                    <article key={o.id} className={`padaria-forno-cartao${pronto ? ' pronto' : ''}`}>
                      <FotoProduto foto={o.foto} nome={o.produto} setor={o.categoria} tamanho={112} />
                      <div className="padaria-forno-info">
                        <div className="padaria-forno-cabecalho">
                          <div>
                            <div className="padaria-forno-produto">{o.produto}</div>
                            <div className="padaria-forno-quantidade">
                              {formatarQuantidade(o.quantidadePlanejada, o.unidade)}
                              {o.iniciadoEm && ` · entrou às ${horaCurta(o.iniciadoEm)}`}
                            </div>
                          </div>
                          {pronto ? (
                            <span className="padaria-forno-selo pronto">
                              <Icone nome="visto" tamanho={16} /> Pronto para tirar
                            </span>
                          ) : (
                            <span className="padaria-forno-selo">
                              <Icone nome="relogio" tamanho={16} /> Assando
                            </span>
                          )}
                        </div>

                        {restante === null ? (
                          <div className="padaria-forno-tempo sem-tempo">Sem tempo de forno na receita</div>
                        ) : (
                          <>
                            <div className="padaria-forno-tempo">
                              <span className="padaria-forno-tempo-valor">
                                {pronto ? `+${formatarRestante(-restante)}` : formatarRestante(restante)}
                              </span>
                              <span className="padaria-forno-tempo-rotulo">{pronto ? 'passou do tempo' : 'restantes'}</span>
                            </div>
                            <BarraNivel valor={decorrido} maximo={total} cor={pronto ? 'verde' : 'amarelo'} />
                          </>
                        )}

                        <div className="padaria-forno-acoes">
                          <Botao aoClicar={() => setConcluindo(o)} desabilitado={ocupada === o.id}>
                            Concluir fornada
                          </Botao>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="padaria-painel-secao">
              <h2 className="padaria-painel-titulo">Próximas fornadas</h2>
              {proximas.length === 0 && <p className="padaria-painel-vazio">Nenhuma fornada planejada para hoje.</p>}
              <div className="padaria-painel-grade padaria-painel-grade-proximas">
                {proximas.map((o) => (
                  <article
                    key={o.id}
                    className={`padaria-proxima-cartao${o.faltaInsumo.length > 0 ? ' alerta' : ''}`}
                  >
                    <div className="padaria-proxima-hora">{horaCurta(o.agendadoPara)}</div>
                    <FotoProduto foto={o.foto} nome={o.produto} setor={o.categoria} tamanho={64} />
                    <div className="padaria-proxima-info">
                      <div className="padaria-forno-produto">{o.produto}</div>
                      <div className="padaria-forno-quantidade">
                        {formatarQuantidade(o.quantidadePlanejada, o.unidade)}
                        {tempoDe(o) !== null && ` · ${tempoDe(o)} min de forno`}
                      </div>
                      {o.faltaInsumo.length > 0 && (
                        <p className="padaria-falta">Falta: {o.faltaInsumo.map((f) => f.insumo).join(', ')}</p>
                      )}
                    </div>
                    <Botao variante="secundario" aoClicar={() => iniciar(o)} desabilitado={ocupada === o.id}>
                      Iniciar
                    </Botao>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {concluindo && (
        <ModalConcluir
          ordem={concluindo}
          aoFechar={() => setConcluindo(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
