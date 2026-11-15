import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { hojeIso, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import {
  AreaTexto,
  Aviso,
  Botao,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import '../../ui/foto-produto.css';
import {
  ROTULOS_MODELO,
  STATUS_NOTA,
  type ConfigPublicaFiscalDTO,
  type ListaNotasDTO,
  type NotaFiscalDTO,
} from './tipos';

const MOTIVO_MINIMO = 15;

// Cartão de número do topo (classes .resumo da casca).
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
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

// Chave de acesso encurtada: início e fim, para caber na linha.
function chaveCurta(chave: string): string {
  return `${chave.slice(0, 6)} … ${chave.slice(-6)}`;
}

export function Notas() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const config = useDados<ConfigPublicaFiscalDTO>('/configuracoes/mercado/publico');

  const [inicio, setInicio] = useState(hojeIso(-6));
  const [fim, setFim] = useState(hojeIso());
  const [modelo, setModelo] = useState('');
  const [status, setStatus] = useState('');

  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<NotaFiscalDTO | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const filtros = new URLSearchParams({ inicio, fim });
  if (modelo) filtros.set('modelo', modelo);
  if (status) filtros.set('status', status);
  const lista = useDados<ListaNotasDTO>(`/fiscal/notas?${filtros.toString()}`);

  const eGestor = usuario?.perfil === 'GESTOR';
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';

  async function baixarXml(nota: NotaFiscalDTO) {
    setErro(null);
    setAviso(null);
    try {
      await baixarArquivo(`/fiscal/notas/${nota.id}/xml`, `${nota.chave ?? `nota-${nota.id}`}.xml`);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function confirmarCancelamento() {
    if (!cancelando) return;
    const texto = motivo.trim();
    if (texto.length < MOTIVO_MINIMO) {
      setErro(`O motivo precisa ter pelo menos ${MOTIVO_MINIMO} caracteres.`);
      return;
    }
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      await api.post(`/fiscal/notas/${cancelando.id}/cancelar`, { motivo: texto });
      setAviso(`Nota nº ${cancelando.numero} cancelada.`);
      setCancelando(null);
      setMotivo('');
      lista.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  // Ações além do XML (que fica num botão à vista): ver a venda e, para o gestor, cancelar.
  function acoesDe(nota: NotaFiscalDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [];
    if (nota.vendaId) {
      const vendaId = nota.vendaId;
      acoes.push({ rotulo: 'Ver venda', icone: 'busca', aoClicar: () => navigate(`${raiz}/vendas/${vendaId}`) });
    }
    if (eGestor && nota.status === 'AUTORIZADA') {
      acoes.push({
        rotulo: 'Cancelar nota',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          setErro(null);
          setAviso(null);
          setMotivo('');
          setCancelando(nota);
        },
      });
    }
    return acoes;
  }

  const itens = lista.dados?.itens ?? [];
  const totais = lista.dados?.totais;
  const simulado = config.dados?.fiscalProvedor === 'SIMULADO';

  return (
    <Pagina titulo="Notas fiscais">
      {simulado && <Aviso tipo="info">Notas de teste sem valor fiscal (emissor simulado).</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}

      {totais && (
        <div className="resumo">
          <Indicador icone="documento" cor="azul" valor={String(totais.quantidade)} rotulo="Notas" />
          <Indicador icone="dinheiro" cor="verde" valor={formatarMoeda(totais.valor)} rotulo="Valor autorizado" />
          <Indicador icone="visto" cor="verde" valor={String(totais.autorizadas)} rotulo="Autorizadas" />
          <Indicador icone="fechar" cor="vermelho" valor={String(totais.canceladas)} rotulo="Canceladas" />
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
          <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
          <Selecao
            rotulo="Modelo"
            valor={modelo}
            aoMudar={setModelo}
            vazio="Todos"
            opcoes={[
              { valor: 'NFCE', rotulo: 'NFC-e' },
              { valor: 'NFE', rotulo: 'NF-e' },
            ]}
          />
          <Selecao
            rotulo="Situação"
            valor={status}
            aoMudar={setStatus}
            vazio="Todas"
            opcoes={Object.entries(STATUS_NOTA).map(([valor, s]) => ({ valor, rotulo: s.rotulo }))}
          />
        </div>
      </div>

      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela
          dados={itens}
          chave={(n) => n.id}
          vazio="Nenhuma nota neste período."
          colunas={[
            {
              titulo: 'Nota',
              celula: (n) => (
                <span className="fiscal-nota">
                  <span className="fiscal-nota-titulo sem-quebra">
                    {ROTULOS_MODELO[n.modelo]} nº {n.numero}
                  </span>
                  {n.chave && <span className="fiscal-nota-chave">{chaveCurta(n.chave)}</span>}
                </span>
              ),
            },
            {
              titulo: 'Data',
              celula: (n) => (
                <span className="fiscal-nota">
                  <span className="sem-quebra">{formatarDataHora(n.criadoEm)}</span>
                  <span className="fiscal-nota-chave">{n.vendaNumero !== null ? `Venda nº ${n.vendaNumero}` : 'Sem venda'}</span>
                </span>
              ),
            },
            { titulo: 'Cliente', celula: (n) => n.cliente ?? 'Consumidor' },
            {
              titulo: 'Valor',
              alinhar: 'direita',
              celula: (n) => <span className="numero">{formatarMoeda(n.valor)}</span>,
            },
            {
              titulo: 'Status',
              celula: (n) => <Selo cor={STATUS_NOTA[n.status].cor}>{STATUS_NOTA[n.status].rotulo}</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (n) => (
                <div className="acoes-linha">
                  <Botao variante="secundario" aoClicar={() => void baixarXml(n)}>
                    XML
                  </Botao>
                  <MenuAcoes rotulo={`Ações da nota ${n.numero}`} acoes={acoesDe(n)} />
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal
        aberto={cancelando !== null}
        titulo={cancelando ? `Cancelar nota nº ${cancelando.numero}` : 'Cancelar nota'}
        aoFechar={() => setCancelando(null)}
      >
        {cancelando && (
          <div className="fiscal-cancelamento">
            {cancelando.modelo === 'NFCE' && (
              <Aviso tipo="info">A NFC-e só pode ser cancelada em até 30 minutos após a autorização.</Aviso>
            )}
            <AreaTexto
              rotulo={`Motivo do cancelamento (mínimo ${MOTIVO_MINIMO} caracteres)`}
              valor={motivo}
              aoMudar={setMotivo}
            />
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setCancelando(null)}>
                Voltar
              </Botao>
              <Botao variante="perigo" desabilitado={enviando} aoClicar={() => void confirmarCancelamento()}>
                {enviando ? 'Cancelando...' : 'Cancelar nota'}
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
