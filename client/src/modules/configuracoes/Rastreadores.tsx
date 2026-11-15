import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mensagemErro, tempoDesde } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { AreaTexto, Aviso, Botao, Campo, Caixa, Carregando, Cartao, Modal, Selecao, Selo, Tabela, MenuAcoes, formatarDataHora } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { BarraNivel } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { MapaOSM } from '../../ui/MapaOSM';
import type { PontoMapa } from '../../ui/MapaOSM';
import './configuracoes.css';

// Configurações > Rastreadores GPS: cadastro das tags, situação ao vivo e simulador de posição.
// As tags mandam a posição pelo protocolo OsmAnd (app Traccar Client ou servidor Traccar).

type TipoRastreador = 'VEICULO' | 'MOTORISTA' | 'CARRINHO' | 'PALETE' | 'EQUIPAMENTO' | 'OUTRO';

interface Rastreador {
  id: number;
  identificador: string;
  nome: string;
  tipo: TipoRastreador;
  veiculoId: number | null;
  veiculo: { id: number; placa: string; modelo: string } | null;
  usuarioId: number | null;
  usuario: { id: number; nome: string } | null;
  ativo: boolean;
  observacoes: string | null;
  ultimaLat: number | null;
  ultimaLng: number | null;
  ultimaVelocidade: number | null;
  ultimaBateria: number | null;
  ultimoSinalEm: string | null;
  online: boolean;
}

interface PosicaoHistorico {
  id: number;
  lat: number;
  lng: number;
  velocidade: number | null;
  bateria: number | null;
  registradoEm: string;
}

interface VeiculoOpcao {
  id: number;
  placa: string;
  modelo: string;
}

interface MotoristaOpcao {
  id: number;
  nome: string;
}

const ROTULO_TIPO: Record<TipoRastreador, string> = {
  VEICULO: 'Veículo',
  MOTORISTA: 'Motorista',
  CARRINHO: 'Carrinho',
  PALETE: 'Palete',
  EQUIPAMENTO: 'Equipamento',
  OUTRO: 'Outro',
};

const OPCOES_TIPO = (Object.keys(ROTULO_TIPO) as TipoRastreador[]).map((t) => ({ valor: t, rotulo: ROTULO_TIPO[t] }));

const OPCOES_PERIODO = [
  { valor: '6', rotulo: 'Últimas 6 horas' },
  { valor: '24', rotulo: 'Últimas 24 horas' },
  { valor: '168', rotulo: 'Últimos 7 dias' },
];

const MINUTO_MS = 60 * 1000;
const UMA_HORA_MS = 60 * MINUTO_MS;
const ENDERECO_TRACCAR = '/api/publico/gps/osmand';

// Situação da tag: Online (verde), há N min (amarelo) ou Sem sinal (cinza, a partir de 1 hora).
function situacaoDe(r: Rastreador, agora: number): { rotulo: string; cor: 'verde' | 'amarelo' | 'cinza'; semSinalHa1h: boolean } {
  if (r.online) return { rotulo: 'Online', cor: 'verde', semSinalHa1h: false };
  if (!r.ultimoSinalEm) return { rotulo: 'Sem sinal', cor: 'cinza', semSinalHa1h: true };
  const decorrido = agora - new Date(r.ultimoSinalEm).getTime();
  if (decorrido < UMA_HORA_MS) {
    return { rotulo: tempoDesde(r.ultimoSinalEm, new Date(agora)), cor: 'amarelo', semSinalHa1h: false };
  }
  return { rotulo: 'Sem sinal', cor: 'cinza', semSinalHa1h: true };
}

function corDaBateria(nivel: number): 'verde' | 'amarelo' | 'vermelho' {
  if (nivel < 20) return 'vermelho';
  if (nivel < 50) return 'amarelo';
  return 'verde';
}

// Código aleatório para o identificador (sem letras e números que se confundem, como O/0 e I/1).
function gerarIdentificador(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'MERC-' + Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}

export function Rastreadores() {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const lista = useDados<Rastreador[]>('/gps/rastreadores');
  const veiculos = useDados<VeiculoOpcao[]>('/veiculos');
  const motoristas = useDados<MotoristaOpcao[]>('/lojas/equipe?perfil=MOTORISTA');
  const [edicao, setEdicao] = useState<Rastreador | 'novo' | null>(null);
  const [historico, setHistorico] = useState<Rastreador | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const { recarregar } = lista;

  // Atualiza a situação das tags a cada 15 s enquanto a tela estiver aberta.
  useEffect(() => {
    const intervalo = window.setInterval(recarregar, 15000);
    return () => window.clearInterval(intervalo);
  }, [recarregar]);

  const endereco = `${window.location.origin}${ENDERECO_TRACCAR}`;
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';
  const dados = lista.dados;
  const agora = Date.now();

  const total = dados?.length ?? 0;
  const online = (dados ?? []).filter((r) => r.online).length;
  const semSinal = (dados ?? []).filter((r) => situacaoDe(r, agora).semSinalHa1h).length;
  const bateriaBaixa = (dados ?? []).filter((r) => r.ultimaBateria !== null && r.ultimaBateria < 20).length;

  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível copiar. Selecione o endereço e copie manualmente.' });
    }
  }

  async function simular(r: Rastreador) {
    setAviso(null);
    try {
      await api.post(`/gps/rastreadores/${r.id}/simular`, {});
      setAviso({ tipo: 'sucesso', texto: `Posição simulada para ${r.nome}.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  async function alternarAtivo(r: Rastreador) {
    setAviso(null);
    try {
      await api.put(`/gps/rastreadores/${r.id}`, { ativo: !r.ativo });
      setAviso({ tipo: 'sucesso', texto: r.ativo ? `Tag ${r.nome} desativada.` : `Tag ${r.nome} ativada.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  async function excluir(r: Rastreador) {
    if (!window.confirm(`Excluir a tag "${r.nome}"? O histórico de posições dela também será apagado.`)) return;
    setAviso(null);
    try {
      await api.del(`/gps/rastreadores/${r.id}`);
      setAviso({ tipo: 'sucesso', texto: `Tag ${r.nome} excluída.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  function acoesDe(r: Rastreador): AcaoMenu[] {
    return [
      { rotulo: 'Simular posição', icone: 'pos', aoClicar: () => simular(r) },
      { rotulo: 'Ver no mapa', icone: 'mapa', aoClicar: () => navegar(`${raiz}/mapa?rastreador=${r.id}`) },
      { rotulo: 'Histórico', icone: 'historico', aoClicar: () => setHistorico(r) },
      { rotulo: r.ativo ? 'Desativar' : 'Ativar', icone: 'pausar', aoClicar: () => alternarAtivo(r) },
      { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(r) },
    ];
  }

  const colunas: ColunaTabela<Rastreador>[] = [
    {
      titulo: 'Tag',
      celula: (r) => (
        <div className="gps-tag">
          <strong>{r.nome}</strong>
          <code className="gps-identificador">{r.identificador}</code>
        </div>
      ),
    },
    { titulo: 'Tipo', celula: (r) => <Selo cor="azul">{ROTULO_TIPO[r.tipo]}</Selo> },
    {
      titulo: 'Vínculo',
      celula: (r) => (r.veiculo ? `${r.veiculo.placa} · ${r.veiculo.modelo}` : r.usuario ? r.usuario.nome : '—'),
    },
    {
      titulo: 'Situação',
      celula: (r) => {
        const s = situacaoDe(r, Date.now());
        return <Selo cor={s.cor}>{s.rotulo}</Selo>;
      },
    },
    {
      titulo: 'Velocidade',
      alinhar: 'direita',
      celula: (r) => <span className="numero">{r.ultimaVelocidade === null ? '—' : `${Math.round(r.ultimaVelocidade)} km/h`}</span>,
    },
    {
      titulo: 'Bateria',
      celula: (r) =>
        r.ultimaBateria === null ? (
          '—'
        ) : (
          <span className="gps-bateria">
            <BarraNivel valor={r.ultimaBateria} maximo={100} cor={corDaBateria(r.ultimaBateria)} />
            <span className="numero">{r.ultimaBateria}%</span>
          </span>
        ),
    },
    { titulo: 'Último sinal', celula: (r) => (r.ultimoSinalEm ? tempoDesde(r.ultimoSinalEm) : 'Nunca') },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (r) => (
        <div className="acoes-linha">
          <Botao variante="secundario" aoClicar={() => setEdicao(r)}>
            Editar
          </Botao>
          <MenuAcoes rotulo={`Mais ações de ${r.nome}`} acoes={acoesDe(r)} />
        </div>
      ),
    },
  ];

  return (
    <div className="gps">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {!dados && lista.carregando && <Carregando />}

      {dados && (
        <div className="resumo">
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-azul">
              <Icone nome="celular" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{total}</span>
              <span className="resumo-rotulo">Tags cadastradas</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-verde">
              <Icone nome="raio" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{online}</span>
              <span className="resumo-rotulo">Online agora</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-vermelho">
              <Icone nome="relogio" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{semSinal}</span>
              <span className="resumo-rotulo">Sem sinal há mais de 1 hora</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-laranja">
              <Icone nome="atividade" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{bateriaBaixa}</span>
              <span className="resumo-rotulo">Bateria baixa (menos de 20%)</span>
            </div>
          </div>
        </div>
      )}

      <Cartao titulo="Como ligar um rastreador">
        <ol className="gps-passos">
          <li>
            <strong>Celular:</strong> instale o app gratuito <strong>Traccar Client</strong>. Em "Device identifier" coloque o
            identificador da tag, em "Server URL" cole o endereço abaixo e ligue o serviço.
          </li>
          <li>
            <strong>Rastreador veicular:</strong> cadastre o aparelho num servidor Traccar e configure o encaminhamento (forward)
            de posições para esse endereço.
          </li>
          <li>
            <strong>Teste:</strong> use "Simular posição" na lista abaixo para ver a tag ficar Online sem precisar do aparelho.
          </li>
        </ol>
        <div className="gps-endereco-linha">
          <code className="gps-endereco">{endereco}</code>
          <Botao variante="secundario" aoClicar={copiarEndereco}>
            {copiado ? 'Copiado' : 'Copiar endereço'}
          </Botao>
        </div>
      </Cartao>

      <Cartao titulo="Tags cadastradas">
        <div className="gps-barra">
          <Botao aoClicar={() => setEdicao('novo')}>Nova tag</Botao>
        </div>
        {dados && (
          <Tabela
            colunas={colunas}
            dados={dados}
            chave={(r) => r.id}
            vazio="Nenhuma tag cadastrada. Use Nova tag para cadastrar o primeiro rastreador."
            idVisao="configuracoes-gps"
          />
        )}
      </Cartao>

      <Modal
        aberto={edicao !== null}
        titulo={edicao === 'novo' ? 'Nova tag' : 'Editar tag'}
        aoFechar={() => setEdicao(null)}
      >
        {edicao !== null && (
          <FormularioRastreador
            key={edicao === 'novo' ? 'novo' : edicao.id}
            inicial={edicao === 'novo' ? null : edicao}
            veiculos={veiculos.dados ?? []}
            motoristas={motoristas.dados ?? []}
            aoCancelar={() => setEdicao(null)}
            aoSalvo={(texto) => {
              setEdicao(null);
              setAviso({ tipo: 'sucesso', texto });
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal
        aberto={historico !== null}
        titulo={historico ? `Histórico: ${historico.nome}` : 'Histórico'}
        aoFechar={() => setHistorico(null)}
      >
        {historico && <HistoricoRastreador rastreador={historico} />}
      </Modal>
    </div>
  );
}

function FormularioRastreador({
  inicial,
  veiculos,
  motoristas,
  aoSalvo,
  aoCancelar,
}: {
  inicial: Rastreador | null;
  veiculos: VeiculoOpcao[];
  motoristas: MotoristaOpcao[];
  aoSalvo: (texto: string) => void;
  aoCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [identificador, setIdentificador] = useState(inicial?.identificador ?? '');
  const [tipo, setTipo] = useState<TipoRastreador>(inicial?.tipo ?? 'VEICULO');
  const [veiculoId, setVeiculoId] = useState(inicial?.veiculoId ? String(inicial.veiculoId) : '');
  const [usuarioId, setUsuarioId] = useState(inicial?.usuarioId ? String(inicial.usuarioId) : '');
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? '');
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const corpo = {
      nome: nome.trim(),
      identificador: identificador.trim(),
      tipo,
      // Só grava o vínculo que aparece para o tipo escolhido.
      veiculoId: tipo !== 'MOTORISTA' && veiculoId ? Number(veiculoId) : null,
      usuarioId: tipo !== 'VEICULO' && usuarioId ? Number(usuarioId) : null,
      observacoes: observacoes.trim() || null,
      ativo,
    };
    try {
      if (inicial) {
        await api.put(`/gps/rastreadores/${inicial.id}`, corpo);
        aoSalvo(`Tag ${corpo.nome} atualizada.`);
      } else {
        await api.post('/gps/rastreadores', corpo);
        aoSalvo(`Tag ${corpo.nome} cadastrada.`);
      }
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  // Veículo para tags de veículo; motorista para tags de motorista; os dois lado a lado nos outros tipos.
  const mostraVeiculo = tipo !== 'MOTORISTA';
  const mostraMotorista = tipo !== 'VEICULO';

  return (
    <form className="gps-form" onSubmit={enviar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="gps-form-grade">
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio placeholder="Ex.: Fiorino das entregas" />
        <div className="gps-grupo">
          <span className="campo-rotulo">Identificador *</span>
          <div className="gps-entrada-linha">
            <input
              className="campo-controle"
              value={identificador}
              required
              placeholder="Ex.: MERC-7K3P9Q"
              onChange={(e) => setIdentificador(e.target.value)}
            />
            <Botao variante="secundario" aoClicar={() => setIdentificador(gerarIdentificador())}>
              Gerar
            </Botao>
          </div>
          <p className="gps-dica">De 3 a 64 caracteres: letras, números, ponto, traço, dois-pontos ou _.</p>
        </div>
        <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoRastreador)} opcoes={OPCOES_TIPO} obrigatorio />
        <div className={mostraVeiculo && mostraMotorista ? 'gps-vinculo gps-vinculo-duplo' : 'gps-vinculo'}>
          {mostraVeiculo && (
            <Selecao
              rotulo="Veículo"
              valor={veiculoId}
              aoMudar={setVeiculoId}
              opcoes={veiculos.map((v) => ({ valor: String(v.id), rotulo: `${v.placa} · ${v.modelo}` }))}
              vazio="Nenhum"
            />
          )}
          {mostraMotorista && (
            <Selecao
              rotulo="Motorista"
              valor={usuarioId}
              aoMudar={setUsuarioId}
              opcoes={motoristas.map((m) => ({ valor: String(m.id), rotulo: m.nome }))}
              vazio="Nenhum"
            />
          )}
        </div>
        <div className="gps-largura-total">
          <AreaTexto rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} linhas={3} />
        </div>
      </div>
      <div className="gps-rodape">
        <Caixa rotulo="Tag ativa (recebe posições)" marcado={ativo} aoMudar={setAtivo} />
        <div className="gps-form-acoes">
          <Botao variante="secundario" aoClicar={aoCancelar}>
            Cancelar
          </Botao>
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
        </div>
      </div>
    </form>
  );
}

// Pontos do mapa: até ~200 marcadores (o último em verde), para não pesar a tela com 1000 posições.
function pontosDoHistorico(posicoes: PosicaoHistorico[]): PontoMapa[] {
  const passo = Math.max(1, Math.ceil(posicoes.length / 200));
  const ultimo = posicoes.length - 1;
  return posicoes
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % passo === 0 || i === ultimo)
    .map(({ p, i }) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      titulo: formatarDataHora(p.registradoEm),
      subtitulo: p.velocidade === null ? 'Velocidade não informada' : `${Math.round(p.velocidade)} km/h`,
      cor: i === ultimo ? 'verde' : 'azul',
    }));
}

function HistoricoRastreador({ rastreador }: { rastreador: Rastreador }) {
  const [horas, setHoras] = useState('24');
  const [posicoes, setPosicoes] = useState<PosicaoHistorico[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setPosicoes(null);
    setErro(null);
    api
      .get<PosicaoHistorico[]>(`/gps/rastreadores/${rastreador.id}/historico?horas=${horas}`)
      .then((dados) => {
        if (ativo) setPosicoes(dados);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(mensagemErro(e));
      });
    return () => {
      ativo = false;
    };
  }, [rastreador.id, horas]);

  const recentes = posicoes ? [...posicoes].reverse().slice(0, 20) : [];

  return (
    <div className="gps-historico">
      <Selecao rotulo="Período" valor={horas} aoMudar={setHoras} opcoes={OPCOES_PERIODO} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {posicoes === null && !erro && <Carregando />}
      {posicoes && posicoes.length === 0 && <p className="gps-vazio">Nenhuma posição neste período.</p>}
      {posicoes && posicoes.length > 0 && (
        <>
          <MapaOSM pontos={pontosDoHistorico(posicoes)} altura={300} avisoVazio="Sem posições para mostrar" />
          <p className="gps-dica">{recentes.length === 1 ? 'Última posição recebida.' : `Últimas ${recentes.length} posições (mais recentes primeiro).`} Verde = a mais nova.</p>
          <ul className="gps-historico-lista">
            {recentes.map((p) => (
              <li key={p.id}>
                <span>{formatarDataHora(p.registradoEm)}</span>
                <span className="numero">{p.velocidade === null ? '—' : `${Math.round(p.velocidade)} km/h`}</span>
                <span className="numero">{p.bateria === null ? '—' : `${p.bateria}%`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
