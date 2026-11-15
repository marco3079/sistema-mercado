import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hojeIso, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { Avatar, Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, formatarData } from '../../ui';
import { BarraNivel } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { COR_ROTA, ROTULO_ROTA } from './tipos';
import type { PessoaDTO, RotaResumoDTO, StatusRota, VeiculoDTO } from './tipos';

const SITUACOES: StatusRota[] = ['MONTANDO', 'CARREGADA', 'EM_ROTA', 'CONCLUIDA', 'CANCELADA'];

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
        <div className="logistica-linha-campos">
          <Campo rotulo="Data da rota" valor={data} aoMudar={setData} tipo="date" obrigatorio />
        </div>
        <div className="logistica-linha-campos">
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
        </div>
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

// Cartão de uma rota: veículo, motorista, ocupação, entregas feitas e km.
function CartaoRota({ rota, aoAbrir }: { rota: RotaResumoDTO; aoAbrir: () => void }) {
  const ocupacao = rota.ocupacao;
  const estourada = ocupacao !== null && ocupacao > 100;
  return (
    <article className="logistica-cartao-lista">
      <div className="logistica-cartao-lista-topo">
        <div className="logistica-destino">
          <span className="logistica-codigo">{rota.codigo}</span>
          <span className="logistica-suave">{formatarData(rota.data)}</span>
        </div>
        <Selo cor={COR_ROTA[rota.status]}>{ROTULO_ROTA[rota.status]}</Selo>
      </div>

      <div className="logistica-veiculo-linha">
        <span className="logistica-icone-veiculo" aria-hidden="true">
          <Icone nome="caminhao" tamanho={20} />
        </span>
        {rota.veiculo ? (
          <>
            <span className="logistica-placa">{rota.veiculo.placa}</span>
            <span className="logistica-suave">{rota.veiculo.modelo}</span>
          </>
        ) : (
          <span className="logistica-suave">Sem veículo</span>
        )}
      </div>

      <div className="logistica-motorista-linha">
        {rota.motorista ? (
          <>
            <Avatar nome={rota.motorista.nome} tamanho={32} />
            <span>{rota.motorista.nome}</span>
          </>
        ) : (
          <span className="logistica-suave">Sem motorista</span>
        )}
      </div>

      <div className="logistica-ocupacao-bloco">
        <div className="logistica-ocupacao-topo">
          <span className="logistica-suave">Ocupação</span>
          <span className={estourada ? 'logistica-numero logistica-alerta' : 'logistica-numero'}>
            {ocupacao === null ? 'sem capacidade' : `${Math.round(ocupacao)}%`}
          </span>
        </div>
        <BarraNivel valor={Math.min(ocupacao ?? 0, 100)} maximo={100} cor={estourada ? 'vermelho' : 'azul'} />
      </div>

      <div className="logistica-cartao-lista-rodape">
        <span>
          <span className="logistica-numero">
            {rota.entregues}/{rota.entregas}
          </span>{' '}
          <span className="logistica-suave">entregas feitas</span>
        </span>
        <span className="logistica-numero">
          {rota.distanciaKm !== null ? `${rota.distanciaKm.toLocaleString('pt-BR')} km` : '— km'}
        </span>
      </div>

      <div className="logistica-cartao-lista-acao">
        <Botao variante="secundario" aoClicar={aoAbrir}>
          Abrir carga
        </Botao>
      </div>
    </article>
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

  return (
    <Pagina
      titulo="Rotas e cargas"
      acoes={
        <Botao aoClicar={() => setNova(true)}>Nova rota</Botao>
      }
    >
      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Campo rotulo="Data" valor={data} aoMudar={setData} tipo="date" />
            <Selecao
              rotulo="Situação"
              valor={situacao}
              aoMudar={setSituacao}
              vazio="Todas"
              opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: ROTULO_ROTA[s] }))}
            />
          </div>
        </div>

        {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados && lista.dados.length === 0 && <p className="logistica-vazio">Nenhuma rota nesta data.</p>}
        {lista.dados && lista.dados.length > 0 && (
          <div className="logistica-grade-rotas">
            {lista.dados.map((r) => (
              <CartaoRota key={r.id} rota={r} aoAbrir={() => navigate(`${raiz}/rotas/${r.id}`)} />
            ))}
          </div>
        )}
      </Cartao>

      {nova && <ModalNovaRota raiz={raiz} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}
