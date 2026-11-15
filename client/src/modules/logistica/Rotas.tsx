import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hojeIso, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { COR_ROTA, ROTULO_ROTA } from './tipos';
import type { PessoaDTO, RotaResumoDTO, StatusRota, VeiculoDTO } from './tipos';

const SITUACOES: StatusRota[] = ['MONTANDO', 'CARREGADA', 'EM_ROTA', 'CONCLUIDA', 'CANCELADA'];

// Barra de ocupação do veículo; passa de 100% fica vermelha.
function BarraOcupacao({ ocupacao }: { ocupacao: number | null }) {
  if (ocupacao === null) return <span className="logistica-suave">—</span>;
  const estourada = ocupacao > 100;
  return (
    <div className="logistica-ocupacao">
      <div className="logistica-barra" role="presentation">
        <span
          className={estourada ? 'logistica-barra-preenchida logistica-barra-estourada' : 'logistica-barra-preenchida'}
          style={{ width: `${Math.min(ocupacao, 100)}%` }}
        />
      </div>
      <span className="logistica-numero">{Math.round(ocupacao)}%</span>
    </div>
  );
}

// Nova rota: data, veículo e motorista. A carga é montada na tela seguinte.
function ModalNovaRota({
  raiz,
  aoFechar,
}: {
  raiz: string;
  aoFechar: () => void;
}) {
  const navigate = useNavigate();
  const veiculos = useDados<VeiculoDTO[]>('/veiculos');
  const motoristas = useDados<PessoaDTO[]>('/lojas/equipe?perfil=MOTORISTA');
  const [data, setData] = useState(hojeIso());
  const [veiculoId, setVeiculoId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const rota = await api.post<{ id: number }>('/rotas', {
        data,
        veiculoId: veiculoId ? Number(veiculoId) : null,
        motoristaId: motoristaId ? Number(motoristaId) : null,
        observacoes: observacoes.trim() || null,
      });
      navigate(`${raiz}/rotas/${rota.id}`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const erroCarga = veiculos.erro ?? motoristas.erro;

  return (
    <Modal aberto titulo="Nova rota" aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
        <Campo rotulo="Data da rota" valor={data} aoMudar={setData} tipo="date" obrigatorio />
        <Selecao
          rotulo="Veículo"
          valor={veiculoId}
          aoMudar={setVeiculoId}
          vazio="Sem veículo definido"
          opcoes={(veiculos.dados ?? [])
            .filter((v) => v.ativo)
            .map((v) => ({ valor: String(v.id), rotulo: `${v.placa} · ${v.modelo}` }))}
        />
        <Selecao
          rotulo="Motorista"
          valor={motoristaId}
          aoMudar={setMotoristaId}
          vazio="Sem motorista definido"
          opcoes={(motoristas.dados ?? []).map((m) => ({ valor: String(m.id), rotulo: m.nome }))}
        />
        <Campo rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} />
        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando || !data}>
            Criar rota
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

export function Rotas() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';

  const [data, setData] = useState(hojeIso());
  const [situacao, setSituacao] = useState('');
  const caminho = `/rotas?data=${encodeURIComponent(data)}${situacao ? `&status=${situacao}` : ''}`;
  const lista = useDados<RotaResumoDTO[]>(caminho);
  useAtualizacao(lista.recarregar, 20000);
  const [nova, setNova] = useState(false);

  const colunas: ColunaTabela<RotaResumoDTO>[] = [
    {
      titulo: 'Rota',
      celula: (r) => (
        <div className="logistica-destino">
          <span className="logistica-codigo">{r.codigo}</span>
          <span className="logistica-suave">{new Date(r.data).toLocaleDateString('pt-BR')}</span>
        </div>
      ),
    },
    {
      titulo: 'Veículo',
      celula: (r) => (r.veiculo ? `${r.veiculo.placa} · ${r.veiculo.modelo}` : '—'),
    },
    { titulo: 'Motorista', celula: (r) => r.motorista?.nome ?? '—' },
    { titulo: 'Ocupação', celula: (r) => <BarraOcupacao ocupacao={r.ocupacao} /> },
    {
      titulo: 'Entregas',
      alinhar: 'direita',
      celula: (r) => (
        <span className="logistica-numero">
          {r.entregues}/{r.entregas}
        </span>
      ),
    },
    {
      titulo: 'Km',
      alinhar: 'direita',
      celula: (r) => (r.distanciaKm !== null ? `${r.distanciaKm.toLocaleString('pt-BR')} km` : '—'),
    },
    {
      titulo: 'Situação',
      celula: (r) => <Selo cor={COR_ROTA[r.status]}>{ROTULO_ROTA[r.status]}</Selo>,
    },
  ];

  return (
    <Pagina
      titulo="Rotas e cargas"
      acoes={
        <Botao aoClicar={() => setNova(true)}>Nova rota</Botao>
      }
    >
      <div className="logistica-filtros">
        <Campo rotulo="Data" valor={data} aoMudar={setData} tipo="date" />
        <Selecao
          rotulo="Situação"
          valor={situacao}
          aoMudar={setSituacao}
          vazio="Todas"
          opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: ROTULO_ROTA[s] }))}
        />
      </div>

      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados && (
        <Tabela<RotaResumoDTO>
          colunas={colunas}
          dados={lista.dados}
          chave={(r) => r.id}
          vazio="Nenhuma rota nesta data."
          aoClicarLinha={(r) => navigate(`${raiz}/rotas/${r.id}`)}
        />
      )}

      {nova && <ModalNovaRota raiz={raiz} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}
