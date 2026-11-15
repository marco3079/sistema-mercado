import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hojeIso, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Cartao, Carregando, MenuAcoes, Modal, Pagina, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
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

// Entregas ainda não encerradas: podem mudar de status.
const ABERTAS: StatusEntrega[] = ['PENDENTE', 'SEPARANDO', 'EM_ROTA'];

type StatusAcao = 'EM_ROTA' | 'ENTREGUE' | 'FALHOU';

// ---------- Modais ----------

// Escolha do novo status: três botões grandes, cada um abre a confirmação.
function ModalMudarStatus({
  entrega,
  aoFechar,
  aoEscolher,
}: {
  entrega: EntregaDTO;
  aoFechar: () => void;
  aoEscolher: (status: StatusAcao) => void;
}) {
  const opcoes: { status: StatusAcao; rotulo: string; icone: NomeIcone }[] = [
    { status: 'EM_ROTA', rotulo: 'Saiu para entrega', icone: 'caminhao' },
    { status: 'ENTREGUE', rotulo: 'Marcar como entregue', icone: 'visto' },
    { status: 'FALHOU', rotulo: 'Marcar como não entregue', icone: 'fechar' },
  ];
  return (
    <Modal aberto titulo={`Mudar status · ${entrega.codigo}`} aoFechar={aoFechar}>
      <div className="logistica-opcoes">
        {opcoes
          .filter((o) => !(o.status === 'EM_ROTA' && entrega.status === 'EM_ROTA'))
          .map((o) => (
            <button key={o.status} type="button" className="logistica-opcao" onClick={() => aoEscolher(o.status)}>
              <Icone nome={o.icone} tamanho={20} />
              <span>{o.rotulo}</span>
            </button>
          ))}
      </div>
    </Modal>
  );
}

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

// Indicador do topo: ícone colorido, valor grande e rótulo.
function ItemResumo({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'verde' | 'laranja' | 'roxo' | 'vermelho';
  valor: string;
  rotulo: string;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`}>
        <Icone nome={icone} tamanho={22} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
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
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [modal, setModal] = useState<
    | { tipo: 'avulsa' }
    | { tipo: 'mudar'; entrega: EntregaDTO }
    | { tipo: 'status'; entrega: EntregaDTO; status: StatusAcao }
    | { tipo: 'avisos'; entrega: EntregaDTO }
    | null
  >(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const todas = lista.dados ?? [];
  const termo = busca.trim().toLowerCase();
  const daAba = todas
    .filter((e) => SITUACOES_DA_ABA[aba].includes(e.status))
    .filter(
      (e) =>
        !termo ||
        [e.destinatario, e.codigo, e.bairro, e.cidade, e.endereco].some((t) => (t ?? '').toLowerCase().includes(termo)),
    );
  const mostrarCarga = aba === 'PENDENTE' && podeCarregar;

  // Números do topo: pendentes, em rota, entregues hoje e o total a cobrar das entregas abertas.
  const hoje = new Date().toDateString();
  const abertas = todas.filter((e) => ABERTAS.includes(e.status));
  const pendentes = todas.filter((e) => e.status === 'PENDENTE' || e.status === 'SEPARANDO').length;
  const emRota = todas.filter((e) => e.status === 'EM_ROTA').length;
  const entreguesHoje = todas.filter(
    (e) => e.status === 'ENTREGUE' && e.entregueEm !== null && new Date(e.entregueEm).toDateString() === hoje,
  ).length;
  const aCobrar = abertas.reduce((soma, e) => soma + e.valorCobrar, 0);

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

  const colunas: ColunaTabela<EntregaDTO>[] = [
    {
      titulo: 'Entrega',
      celula: (e) => (
        <div className="logistica-destino">
          <span className="logistica-entrega-nome">
            {mostrarCarga && (
              <input
                type="checkbox"
                className="logistica-marcar"
                checked={selecionadas.includes(e.id)}
                onChange={() => alternar(e.id)}
                aria-label={`Incluir ${e.codigo} na carga`}
              />
            )}
            <strong>{e.destinatario}</strong>
          </span>
          <span className="logistica-suave">
            <span className="logistica-codigo">{e.codigo}</span>
            {' · '}
            {[e.bairro, e.cidade].filter(Boolean).join(' · ') || e.endereco}
          </span>
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
        const aberta = ABERTAS.includes(e.status);
        const acoes: AcaoMenu[] = [
          { rotulo: 'Copiar rastreio', icone: 'documento', aoClicar: () => void copiarLink(e.codigo) },
          { rotulo: 'Avisos do WhatsApp', icone: 'comentario', aoClicar: () => setModal({ tipo: 'avisos', entrega: e }) },
        ];
        return (
          <div className="acoes-linha">
            {podeGerir && aberta && (
              <Botao variante="secundario" aoClicar={() => setModal({ tipo: 'mudar', entrega: e })}>
                Mudar status
              </Botao>
            )}
            <MenuAcoes rotulo={`Mais ações da entrega ${e.codigo}`} acoes={acoes} />
          </div>
        );
      },
    },
  ];

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
      <div className="resumo">
        <ItemResumo icone="relogio" cor="laranja" valor={String(pendentes)} rotulo="Pendentes ou separando" />
        <ItemResumo icone="caminhao" cor="azul" valor={String(emRota)} rotulo="Em rota" />
        <ItemResumo icone="visto" cor="verde" valor={String(entreguesHoje)} rotulo="Entregues hoje" />
        <ItemResumo icone="dinheiro" cor="roxo" valor={formatarMoeda(aCobrar)} rotulo="A cobrar em aberto" />
      </div>

      <Abas
        abas={(Object.keys(ROTULO_ABA) as Aba[]).map((id) => ({
          id,
          rotulo: `${ROTULO_ABA[id]} (${todas.filter((e) => SITUACOES_DA_ABA[id].includes(e.status)).length})`,
        }))}
        ativa={aba}
        aoMudar={mudarAba}
      />

      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Campo rotulo="Buscar por destinatário, código ou bairro" valor={busca} aoMudar={setBusca} />
          </div>
        </div>

        {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
        {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
        {lista.carregando && !lista.dados && <Carregando />}

        {lista.dados && (
          <Tabela<EntregaDTO>
            colunas={colunas}
            dados={daAba}
            chave={(e) => e.id}
            vazio={termo ? 'Nenhuma entrega encontrada para esta busca.' : 'Nenhuma entrega nesta situação.'}
          />
        )}
      </Cartao>

      {modal?.tipo === 'avulsa' && (
        <ModalNovaEntrega aoFechar={() => setModal(null)} aoSalvo={aposSalvar} />
      )}
      {modal?.tipo === 'mudar' && (
        <ModalMudarStatus
          entrega={modal.entrega}
          aoFechar={() => setModal(null)}
          aoEscolher={(status) => setModal({ tipo: 'status', entrega: modal.entrega, status })}
        />
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
