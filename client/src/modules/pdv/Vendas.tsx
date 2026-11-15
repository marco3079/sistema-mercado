import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { usePlataforma } from '../../lib/plataforma';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { ROTULOS_FORMA_PAGAMENTO, ROTULOS_ORIGEM_VENDA, hojeIso, mensagemErro } from '../../lib/mercado';
import { AreaTexto, Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { imprimirCupom } from './cupom';
import type { DetalheVendaDTO, VendaListaDTO } from './tipos';

// Vendas do período. OPERADOR vê só as próprias (o servidor filtra). Por venda: "Abrir" e o menu
// com Reimprimir e Cancelar (o cancelamento pede o motivo e a senha do gestor, se a regra pedir).

const ORIGENS = Object.entries(ROTULOS_ORIGEM_VENDA).map(([valor, rotulo]) => ({ valor, rotulo }));
const SITUACOES = [
  { valor: 'CONCLUIDA', rotulo: 'Concluída' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
];

function arred2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Cartão de número do topo (ícone colorido + valor grande + rótulo).
function Indicador({
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
      <div className="pdv-resumo-texto">
        <span className="resumo-valor numero">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

export function Vendas() {
  const { usuario } = useAuth();
  const { plataforma } = usePlataforma();
  const navigate = useNavigate();
  const [inicio, setInicio] = useState(hojeIso(-29));
  const [fim, setFim] = useState(hojeIso(0));
  const [origem, setOrigem] = useState('');
  const [status, setStatus] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<VendaListaDTO | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const params = new URLSearchParams({ inicio, fim });
  if (origem) params.set('origem', origem);
  if (status) params.set('status', status);
  const vendas = useDados<VendaListaDTO[]>(`/vendas?${params.toString()}`);

  // Quem pode cancelar: gestor e operador (o servidor confere se é venda do operador).
  const podeCancelar = usuario?.perfil === 'GESTOR' || usuario?.perfil === 'OPERADOR';
  const caminhoVenda = (id: number) => `${RAIZ_DO_PERFIL[usuario?.perfil ?? 'OPERADOR']}/vendas/${id}`;

  // Números do período, calculados a partir da lista carregada.
  const lista = vendas.dados ?? [];
  const concluidas = lista.filter((v) => v.status === 'CONCLUIDA');
  const canceladas = lista.filter((v) => v.status === 'CANCELADA').length;
  const faturamento = arred2(concluidas.reduce((s, v) => s + v.total, 0));
  const ticket = concluidas.length > 0 ? arred2(faturamento / concluidas.length) : 0;

  async function reimprimir(v: VendaListaDTO) {
    setErro(null);
    try {
      const detalhe = await api.get<DetalheVendaDTO>(`/vendas/${v.id}/cupom`);
      imprimirCupom(detalhe, plataforma.nome);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function cancelar() {
    if (!cancelando) return;
    const texto = motivo.trim();
    if (texto.length < 3) {
      setErroCancelamento('Informe o motivo do cancelamento (mínimo 3 letras)');
      return;
    }
    setEnviando(true);
    setErroCancelamento(null);
    try {
      await api.post(`/vendas/${cancelando.id}/cancelar`, { motivo: texto });
      setCancelando(null);
      setMotivo('');
      vendas.recarregar();
    } catch (e) {
      const msg = mensagemErro(e);
      if (msg !== 'Ação cancelada') setErroCancelamento(msg);
    } finally {
      setEnviando(false);
    }
  }

  function acoesDaVenda(v: VendaListaDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Reimprimir cupom', icone: 'documento', aoClicar: () => void reimprimir(v) },
    ];
    if (podeCancelar && v.status !== 'CANCELADA') {
      acoes.push({
        rotulo: 'Cancelar venda',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          setMotivo('');
          setErroCancelamento(null);
          setCancelando(v);
        },
      });
    }
    return acoes;
  }

  return (
    <Pagina titulo="Vendas">
      <div className="resumo">
        <Indicador icone="carrinho" cor="verde" valor={String(concluidas.length)} rotulo="Vendas" />
        <Indicador icone="dinheiro" cor="azul" valor={formatarMoeda(faturamento)} rotulo="Faturamento" />
        <Indicador icone="etiqueta" cor="laranja" valor={formatarMoeda(ticket)} rotulo="Ticket médio" />
        <Indicador icone="lixeira" cor="vermelho" valor={String(canceladas)} rotulo="Canceladas" />
      </div>

      <div className="barra-ferramentas pdv-barra">
        <div className="filtros">
          <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
          <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
          <Selecao rotulo="Origem" valor={origem} aoMudar={setOrigem} opcoes={ORIGENS} vazio="Todas" />
          <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} opcoes={SITUACOES} vazio="Todas" />
        </div>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {vendas.carregando && vendas.dados === null && <Carregando />}
      {vendas.erro && <Aviso tipo="erro">{vendas.erro}</Aviso>}
      {vendas.dados && (
        <Tabela
          colunas={[
            {
              titulo: 'Venda',
              celula: (v: VendaListaDTO) => (
                <span className="pdv-venda-id">
                  <strong>Venda nº {v.numero}</strong>
                  <span className="pdv-venda-detalhe">
                    {formatarDataHora(v.criadoEm)} · {v.cliente?.nome ?? 'Consumidor'}
                  </span>
                </span>
              ),
            },
            {
              titulo: 'Origem',
              celula: (v: VendaListaDTO) => <Selo cor="azul">{ROTULOS_ORIGEM_VENDA[v.origem] ?? v.origem}</Selo>,
            },
            { titulo: 'Operador', celula: (v: VendaListaDTO) => v.operador },
            {
              titulo: 'Formas',
              celula: (v: VendaListaDTO) =>
                v.formas.length === 0 ? (
                  '—'
                ) : (
                  <span className="pdv-selos">
                    {v.formas.map((f) => (
                      <Selo key={f} cor="cinza">
                        {ROTULOS_FORMA_PAGAMENTO[f] ?? f}
                      </Selo>
                    ))}
                  </span>
                ),
            },
            {
              titulo: 'Total',
              alinhar: 'direita',
              celula: (v: VendaListaDTO) => <span className="numero">{formatarMoeda(v.total)}</span>,
            },
            {
              titulo: 'Situação',
              celula: (v: VendaListaDTO) =>
                v.status === 'CANCELADA' ? <Selo cor="vermelho">Cancelada</Selo> : <Selo cor="verde">Concluída</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (v: VendaListaDTO) => (
                <span className="acoes-linha">
                  <Botao variante="secundario" aoClicar={() => navigate(caminhoVenda(v.id))}>
                    Abrir
                  </Botao>
                  <MenuAcoes rotulo={`Mais ações da venda nº ${v.numero}`} acoes={acoesDaVenda(v)} />
                </span>
              ),
            },
          ]}
          dados={vendas.dados}
          chave={(v) => v.id}
          vazio="Nenhuma venda neste período."
          aoClicarLinha={(v) => navigate(caminhoVenda(v.id))}
        />
      )}

      <Modal
        aberto={cancelando !== null}
        titulo={`Cancelar venda nº ${cancelando?.numero ?? ''}`}
        aoFechar={() => setCancelando(null)}
      >
        <p className="pdv-texto">
          A venda será cancelada, o estoque volta e o fiado (se houver) é desfeito. Esta ação não se desfaz.
        </p>
        <AreaTexto rotulo="Motivo do cancelamento" valor={motivo} aoMudar={setMotivo} linhas={3} />
        {erroCancelamento && <Aviso tipo="erro">{erroCancelamento}</Aviso>}
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={() => setCancelando(null)}>
            Voltar
          </Botao>
          <Botao
            variante="perigo"
            aoClicar={() => void cancelar()}
            desabilitado={enviando || motivo.trim().length < 3}
          >
            Cancelar venda
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
