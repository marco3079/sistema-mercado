import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selo, formatarMoeda } from '../../ui';
import { BarraNivel } from '../../ui/FotoProduto';
import { COR_ENTREGA, COR_ROTA, ROTULO_ENTREGA, ROTULO_ROTA, linkDoMapa, telefoneParaLink } from './tipos';
import type { EntregaDTO, RotaDTO } from './tipos';

// Tela do motorista (celular): a rota de hoje, em ordem, com botões grandes.

// Modal de entrega: "Entregue" pede quem recebeu; "Não entregue" pede o motivo.
function ModalEntrega({
  entrega,
  tipo,
  aoFechar,
  aoSalvo,
}: {
  entrega: EntregaDTO;
  tipo: 'ENTREGUE' | 'FALHOU';
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [recebidoPor, setRecebidoPor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (tipo === 'FALHOU' && !motivo.trim()) {
      setErro('Informe o motivo.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/motorista/entregas/${entrega.id}/status`, {
        status: tipo,
        recebidoPor: tipo === 'ENTREGUE' && recebidoPor.trim() ? recebidoPor.trim() : null,
        motivoFalha: tipo === 'FALHOU' ? motivo.trim() : null,
      });
      aoSalvo(tipo === 'ENTREGUE' ? `${entrega.codigo} entregue.` : `${entrega.codigo} marcada como não entregue.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto
      titulo={tipo === 'ENTREGUE' ? `Entregue · ${entrega.destinatario}` : `Não entregue · ${entrega.destinatario}`}
      aoFechar={aoFechar}
    >
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {tipo === 'ENTREGUE' ? (
          <Campo rotulo="Recebido por" valor={recebidoPor} aoMudar={setRecebidoPor} />
        ) : (
          <Campo rotulo="Motivo" valor={motivo} aoMudar={setMotivo} obrigatorio />
        )}
        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Confirmar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Modal para iniciar a rota: km do veículo na saída.
function ModalIniciar({
  rotaId,
  aoFechar,
  aoSalvo,
}: {
  rotaId: number;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [km, setKm] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    const valor = lerNumero(km);
    if (valor === null || valor < 0) {
      setErro('Informe o km do veículo na saída.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/motorista/rotas/${rotaId}/iniciar`, { kmInicial: Math.round(valor) });
      aoSalvo('Rota iniciada. Boa entrega!');
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Iniciar rota" aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Km inicial do veículo" valor={km} aoMudar={setKm} tipo="number" obrigatorio />
        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Iniciar rota
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

export function MinhasEntregas() {
  const rota = useDados<RotaDTO | null>('/motorista/entregas');
  useAtualizacao(rota.recarregar, 20000);
  const [modal, setModal] = useState<
    { tipo: 'iniciar' } | { tipo: 'ENTREGUE' | 'FALHOU'; entrega: EntregaDTO } | null
  >(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const r = rota.dados;
  const paradas = (r?.entregas ?? []).filter((e) => e.status !== 'CANCELADA');
  const podeIniciar = r?.status === 'MONTANDO' || r?.status === 'CARREGADA';
  const emRota = r?.status === 'EM_ROTA';

  function aposSalvar(mensagem: string) {
    setAviso({ tipo: 'sucesso', texto: mensagem });
    rota.recarregar();
  }

  return (
    <Pagina titulo="Minhas entregas">
      <div className="logistica-motorista">
        {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
        {rota.erro && <Aviso tipo="erro">{rota.erro}</Aviso>}
        {rota.carregando && r === null && <Carregando />}

        {!rota.carregando && r === null && !rota.erro && (
          <p className="logistica-vazio">Você não tem rota para hoje.</p>
        )}

        {r && (
          <>
            <section className="logistica-cartao-rota">
              <div className="logistica-topo-rota">
                <strong className="logistica-codigo">{r.codigo}</strong>
                <Selo cor={COR_ROTA[r.status]}>{ROTULO_ROTA[r.status]}</Selo>
              </div>
              <p className="logistica-suave">
                {r.veiculo ? `${r.veiculo.placa} · ${r.veiculo.modelo}` : 'Veículo não definido'}
                {r.kmInicial !== null ? ` · km inicial ${r.kmInicial}` : ''}
              </p>
              {podeIniciar && (
                <Botao aoClicar={() => setModal({ tipo: 'iniciar' })}>Iniciar rota</Botao>
              )}
              {paradas.length > 0 && (
                <div className="logistica-progresso">
                  <span className="logistica-suave">
                    <span className="logistica-numero">{paradas.filter((e) => e.status === 'ENTREGUE').length}</span> de{' '}
                    {paradas.length} entregas feitas
                  </span>
                  <BarraNivel
                    valor={paradas.filter((e) => e.status === 'ENTREGUE').length}
                    maximo={paradas.length}
                    cor="verde"
                  />
                </div>
              )}
              {r.status === 'CONCLUIDA' && <p className="logistica-aviso-ok">Rota concluída. Bom trabalho!</p>}
            </section>

            {paradas.length === 0 && <p className="logistica-vazio">Esta rota ainda não tem entregas.</p>}

            {paradas.map((e, indice) => {
              const aberta = emRota && e.status === 'EM_ROTA';
              return (
                <article key={e.id} className="logistica-cartao-entrega">
                  <div className="logistica-topo-entrega">
                    <span className="logistica-parada">{e.ordem ?? indice + 1}</span>
                    <Selo cor={COR_ENTREGA[e.status]}>{ROTULO_ENTREGA[e.status]}</Selo>
                  </div>
                  <h3 className="logistica-destinatario">{e.destinatario}</h3>
                  <p>
                    {e.endereco}
                    {e.bairro ? ` · ${e.bairro}` : ''}
                  </p>
                  <div className="logistica-links">
                    <a
                      className="botao botao-secundario"
                      href={linkDoMapa(e)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir no mapa
                    </a>
                    {e.telefone && (
                      <a className="botao botao-secundario" href={`tel:${telefoneParaLink(e.telefone)}`}>
                        Ligar {e.telefone}
                      </a>
                    )}
                  </div>
                  <p className="logistica-valor-cobrar">
                    A cobrar <strong>{formatarMoeda(e.valorCobrar)}</strong>
                  </p>
                  {e.observacao && <p className="logistica-suave">Obs.: {e.observacao}</p>}
                  {aberta && (
                    <div className="logistica-acoes-entrega">
                      <Botao aoClicar={() => setModal({ tipo: 'ENTREGUE', entrega: e })}>Entregue</Botao>
                      <Botao variante="perigo" aoClicar={() => setModal({ tipo: 'FALHOU', entrega: e })}>
                        Não entregue
                      </Botao>
                    </div>
                  )}
                </article>
              );
            })}
          </>
        )}
      </div>

      {modal?.tipo === 'iniciar' && r && (
        <ModalIniciar rotaId={r.id} aoFechar={() => setModal(null)} aoSalvo={aposSalvar} />
      )}
      {modal && modal.tipo !== 'iniciar' && (
        <ModalEntrega
          entrega={modal.entrega}
          tipo={modal.tipo}
          aoFechar={() => setModal(null)}
          aoSalvo={aposSalvar}
        />
      )}
    </Pagina>
  );
}
