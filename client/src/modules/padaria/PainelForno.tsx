import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { assinar, rajada } from '../../lib/tempoReal';
import { formatarQuantidade, hojeIso, horaCurta, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import { ModalConcluir } from './Producao';
import type { OrdemDTO, ReceitaDTO } from './tipos';
import { FotoProduto } from '../../ui/FotoProduto';

// Painel do forno: tela grande para o tablet da padaria. Botões grandes e contagem regressiva
// de quem está no forno (início + tempo de forno da receita).

function formatarRelogio(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// mm:ss; zero ou menos vira "Pronto".
function formatarRestante(ms: number): string {
  const total = Math.ceil(ms / 1000);
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

  function restanteDe(o: OrdemDTO): number | null {
    const minutos = tempoForno.get(o.receitaId) ?? null;
    if (!o.iniciadoEm || minutos === null) return null;
    const fim = new Date(o.iniciadoEm).getTime() + minutos * 60000;
    return fim - agora.getTime();
  }

  return (
    <Pagina titulo="Painel do forno">
      <div className="padaria-painel">
        <div className="padaria-relogio" aria-live="off">
          {formatarRelogio(agora)}
        </div>

        {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {ordens.erro && <Aviso tipo="erro">{ordens.erro}</Aviso>}
        {ordens.carregando && !ordens.dados && <Carregando />}

        {ordens.dados && (
          <>
            <section className="padaria-painel-secao">
              <h2 className="padaria-painel-titulo">No forno ({noForno.length})</h2>
              {noForno.length === 0 && <p className="padaria-painel-vazio">Nenhuma fornada no forno.</p>}
              <div className="padaria-painel-lista">
                {noForno.map((o) => {
                  const restante = restanteDe(o);
                  const pronto = restante !== null && restante <= 0;
                  return (
                    <article
                      key={o.id}
                      className={`padaria-painel-cartao${pronto ? ' padaria-painel-pronto' : ''}`}
                    >
                      <FotoProduto foto={o.foto} nome={o.produto} setor={o.categoria} preencher />
                      <div className="padaria-painel-produto">{o.produto}</div>
                      <div className="padaria-painel-quantidade">
                        {formatarQuantidade(o.quantidadePlanejada, o.unidade)}
                      </div>
                      <div className="padaria-painel-contagem">
                        {restante === null
                          ? 'Sem tempo de forno cadastrado'
                          : pronto
                            ? 'Pronto para tirar!'
                            : formatarRestante(restante)}
                      </div>
                      <Botao aoClicar={() => setConcluindo(o)} desabilitado={ocupada === o.id}>
                        Concluir
                      </Botao>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="padaria-painel-secao">
              <h2 className="padaria-painel-titulo">Próximas fornadas ({proximas.length})</h2>
              {proximas.length === 0 && <p className="padaria-painel-vazio">Nenhuma fornada planejada.</p>}
              <div className="padaria-painel-lista">
                {proximas.map((o) => (
                  <article
                    key={o.id}
                    className={`padaria-painel-cartao${o.faltaInsumo.length > 0 ? ' padaria-painel-alerta' : ''}`}
                  >
                    <div className="padaria-painel-hora">{horaCurta(o.agendadoPara)}</div>
                    <FotoProduto foto={o.foto} nome={o.produto} setor={o.categoria} preencher />
                    <div className="padaria-painel-produto">{o.produto}</div>
                    <div className="padaria-painel-quantidade">
                      {formatarQuantidade(o.quantidadePlanejada, o.unidade)}
                    </div>
                    {o.faltaInsumo.length > 0 && (
                      <p className="padaria-falta">Falta insumo: {o.faltaInsumo.map((f) => f.insumo).join(', ')}</p>
                    )}
                    <Botao aoClicar={() => iniciar(o)} desabilitado={ocupada === o.id}>
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
