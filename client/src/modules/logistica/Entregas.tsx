import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hojeIso, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Carregando, Modal, Pagina, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { COR_ENTREGA, ROTULO_ENTREGA } from './tipos';
import type { EntregaDTO, StatusEntrega } from './tipos';

type Aba = 'PENDENTE' | 'SEPARANDO' | 'EM_ROTA' | 'ENTREGUE' | 'PROBLEMAS';

const SITUACOES_DA_ABA: Record<Aba, StatusEntrega[]> = {
  PENDENTE: ['PENDENTE'],
  SEPARANDO: ['SEPARANDO'],
  EM_ROTA: ['EM_ROTA'],
  ENTREGUE: ['ENTREGUE'],
  PROBLEMAS: ['FALHOU', 'CANCELADA'],
};

const ROTULO_ABA: Record<Aba, string> = {
  PENDENTE: 'Pendentes',
  SEPARANDO: 'Separando',
  EM_ROTA: 'Em rota',
  ENTREGUE: 'Entregues',
  PROBLEMAS: 'Problemas',
};

type StatusAcao = 'EM_ROTA' | 'ENTREGUE' | 'FALHOU';

// ---------- Modais ----------

// Muda o status da entrega: Entregue pede quem recebeu; Não entregue pede o motivo.
function ModalStatus({
  entrega,
  status,
  aoFechar,
  aoSalvo,
}: {
  entrega: EntregaDTO;
  status: StatusAcao;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [recebidoPor, setRecebidoPor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const titulo =
    status === 'EM_ROTA' ? 'Saiu para entrega' : status === 'ENTREGUE' ? 'Marcar como entregue' : 'Marcar como não entregue';

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (status === 'FALHOU' && !motivo.trim()) {
      setErro('Informe o motivo.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/entregas/${entrega.id}/status`, {
        status,
        recebidoPor: status === 'ENTREGUE' && recebidoPor.trim() ? recebidoPor.trim() : null,
        motivoFalha: status === 'FALHOU' ? motivo.trim() : null,
      });
      aoSalvo(`Entrega ${entrega.codigo} atualizada.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`${titulo} · ${entrega.codigo}`} aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>
          {entrega.destinatario}
          {entrega.bairro ? ` · ${entrega.bairro}` : ''}
        </p>
        {status === 'ENTREGUE' && (
          <Campo rotulo="Recebido por (opcional)" valor={recebidoPor} aoMudar={setRecebidoPor} />
        )}
        {status === 'FALHOU' && (
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

// Entrega avulsa (sem venda): destinatário, endereço e valores.
function ModalNovaEntrega({ aoFechar, aoSalvo }: { aoFechar: () => void; aoSalvo: (mensagem: string) => void }) {
  const [destinatario, setDestinatario] = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [valorCobrar, setValorCobrar] = useState('');
  const [taxa, setTaxa] = useState('');
  const [pesoKg, setPesoKg] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const criada = await api.post<{ codigo: string }>('/entregas', {
        destinatario: destinatario.trim(),
        telefone: telefone.trim() || null,
        endereco: endereco.trim(),
        bairro: bairro.trim() || null,
        cidade: cidade.trim() || null,
        valorCobrar: lerNumero(valorCobrar) ?? 0,
        taxa: lerNumero(taxa) ?? 0,
        pesoKg: lerNumero(pesoKg) ?? 0,
        previsao: previsao ? new Date(previsao).toISOString() : null,
        observacao: observacao.trim() || null,
      });
      aoSalvo(`Entrega ${criada.codigo} criada.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Nova entrega avulsa" aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Destinatário" valor={destinatario} aoMudar={setDestinatario} obrigatorio />
        <Campo rotulo="Telefone" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="Endereço" valor={endereco} aoMudar={setEndereco} obrigatorio />
        <div className="logistica-linha-campos">
          <Campo rotulo="Bairro" valor={bairro} aoMudar={setBairro} />
          <Campo rotulo="Cidade" valor={cidade} aoMudar={setCidade} />
        </div>
        <div className="logistica-linha-campos">
          <Campo rotulo="A cobrar (R$)" valor={valorCobrar} aoMudar={setValorCobrar} />
          <Campo rotulo="Taxa (R$)" valor={taxa} aoMudar={setTaxa} />
          <Campo rotulo="Peso (kg)" valor={pesoKg} aoMudar={setPesoKg} />
        </div>
        <Campo rotulo="Previsão" valor={previsao} aoMudar={setPrevisao} tipo="datetime-local" />
        <Campo rotulo="Observação" valor={observacao} aoMudar={setObservacao} />
        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Criar entrega
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Histórico de avisos de WhatsApp (simulado enquanto não há token configurado).
function ModalAvisos({ entrega, aoFechar }: { entrega: EntregaDTO; aoFechar: () => void }) {
  return (
    <Modal aberto titulo={`Avisos WhatsApp · ${entrega.codigo}`} aoFechar={aoFechar}>
      {entrega.avisos.length === 0 ? (
        <p className="logistica-vazio">Nenhum aviso registrado para esta entrega.</p>
      ) : (
        <ul className="logistica-avisos">
          {entrega.avisos.map((a, i) => (
            <li key={`${a.em}-${i}`} className="logistica-aviso">
              <div className="logistica-aviso-topo">
                <strong>{formatarDataHora(a.em)}</strong>
                {a.simulado && <Selo cor="amarelo">simulado</Selo>}
              </div>
              <p>{a.mensagem}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- Tela ----------

export function Entregas() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const perfil = usuario?.perfil;
  const podeGerir = perfil === 'GESTOR';
  const podeCarregar = perfil === 'GESTOR' || perfil === 'ESTOQUISTA';
  const raiz = perfil ? RAIZ_DO_PERFIL[perfil] : '';

  const lista = useDados<EntregaDTO[]>('/entregas');
  useAtualizacao(lista.recarregar, 15000);

  const [aba, setAba] = useState<Aba>('PENDENTE');
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [modal, setModal] = useState<
    | { tipo: 'avulsa' }
    | { tipo: 'status'; entrega: EntregaDTO; status: StatusAcao }
    | { tipo: 'avisos'; entrega: EntregaDTO }
    | null
  >(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const todas = lista.dados ?? [];
  const daAba = todas.filter((e) => SITUACOES_DA_ABA[aba].includes(e.status));
  const mostrarCarga = aba === 'PENDENTE' && podeCarregar;

  function mudarAba(id: string) {
    setAba(id as Aba);
    setSelecionadas([]);
  }

  function alternar(id: number) {
    setSelecionadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function montarCarga() {
    if (selecionadas.length === 0) return;
    setOcupado(true);
    setAviso(null);
    try {
      const rota = await api.post<{ id: number }>('/rotas', { data: hojeIso(), entregaIds: selecionadas });
      navigate(`${raiz}/rotas/${rota.id}`);
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
      setOcupado(false);
    }
  }

  async function copiarLink(codigo: string) {
    const link = `${window.location.origin}/rastreio/${codigo}`;
    try {
      await navigator.clipboard.writeText(link);
      setAviso({ tipo: 'sucesso', texto: 'Link de rastreio copiado.' });
    } catch {
      setAviso({ tipo: 'erro', texto: `Não foi possível copiar. Link: ${link}` });
    }
  }

  function aposSalvar(mensagem: string) {
    setAviso({ tipo: 'sucesso', texto: mensagem });
    setSelecionadas([]);
    lista.recarregar();
  }

  const colunas: ColunaTabela<EntregaDTO>[] = [];
  if (mostrarCarga) {
    colunas.push({
      titulo: 'Carga',
      celula: (e) => (
        <input
          type="checkbox"
          className="logistica-marcar"
          checked={selecionadas.includes(e.id)}
          onChange={() => alternar(e.id)}
          aria-label={`Incluir ${e.codigo} na carga`}
        />
      ),
    });
  }
  colunas.push(
    { titulo: 'Código', celula: (e) => <span className="logistica-codigo">{e.codigo}</span> },
    {
      titulo: 'Destinatário',
      celula: (e) => (
        <div className="logistica-destino">
          <strong>{e.destinatario}</strong>
          <span className="logistica-suave">{[e.bairro, e.cidade].filter(Boolean).join(' · ') || e.endereco}</span>
        </div>
      ),
    },
    {
      titulo: 'A cobrar',
      alinhar: 'direita',
      celula: (e) => <strong className="logistica-numero">{formatarMoeda(e.valorCobrar)}</strong>,
    },
    { titulo: 'Rota', celula: (e) => e.rotaCodigo ?? '—' },
    { titulo: 'Previsão', celula: (e) => (e.previsao ? formatarDataHora(e.previsao) : '—') },
    {
      titulo: 'Situação',
      celula: (e) => <Selo cor={COR_ENTREGA[e.status]}>{ROTULO_ENTREGA[e.status]}</Selo>,
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (e) => {
        const aberta = e.status === 'PENDENTE' || e.status === 'SEPARANDO' || e.status === 'EM_ROTA';
        return (
          <div className="logistica-acoes-linha">
            {podeGerir && aberta && e.status !== 'EM_ROTA' && (
              <Botao variante="texto" aoClicar={() => setModal({ tipo: 'status', entrega: e, status: 'EM_ROTA' })}>
                Saiu
              </Botao>
            )}
            {podeGerir && aberta && (
              <Botao variante="texto" aoClicar={() => setModal({ tipo: 'status', entrega: e, status: 'ENTREGUE' })}>
                Entregue
              </Botao>
            )}
            {podeGerir && aberta && (
              <Botao variante="texto" aoClicar={() => setModal({ tipo: 'status', entrega: e, status: 'FALHOU' })}>
                Não entregue
              </Botao>
            )}
            <Botao variante="texto" aoClicar={() => void copiarLink(e.codigo)}>
              Copiar link
            </Botao>
            <Botao variante="texto" aoClicar={() => setModal({ tipo: 'avisos', entrega: e })}>
              Avisos
            </Botao>
          </div>
        );
      },
    },
  );

  const acoesDaPagina = (
    <>
      {podeCarregar && aba === 'PENDENTE' && selecionadas.length > 0 && (
        <Botao desabilitado={ocupado} aoClicar={() => void montarCarga()}>
          Montar carga com selecionadas ({selecionadas.length})
        </Botao>
      )}
      {podeGerir && (
        <Botao variante="secundario" aoClicar={() => setModal({ tipo: 'avulsa' })}>
          Nova entrega avulsa
        </Botao>
      )}
    </>
  );

  return (
    <Pagina titulo="Entregas" acoes={acoesDaPagina}>
      <Abas
        abas={(Object.keys(ROTULO_ABA) as Aba[]).map((id) => ({
          id,
          rotulo: `${ROTULO_ABA[id]} (${todas.filter((e) => SITUACOES_DA_ABA[id].includes(e.status)).length})`,
        }))}
        ativa={aba}
        aoMudar={mudarAba}
      />

      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela<EntregaDTO>
          colunas={colunas}
          dados={daAba}
          chave={(e) => e.id}
          vazio="Nenhuma entrega nesta situação."
        />
      )}

      {modal?.tipo === 'avulsa' && (
        <ModalNovaEntrega aoFechar={() => setModal(null)} aoSalvo={aposSalvar} />
      )}
      {modal?.tipo === 'status' && (
        <ModalStatus
          entrega={modal.entrega}
          status={modal.status}
          aoFechar={() => setModal(null)}
          aoSalvo={aposSalvar}
        />
      )}
      {modal?.tipo === 'avisos' && <ModalAvisos entrega={modal.entrega} aoFechar={() => setModal(null)} />}
    </Pagina>
  );
}
