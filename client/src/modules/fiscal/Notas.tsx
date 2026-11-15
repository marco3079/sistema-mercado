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
  Cartao,
  Grade,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import {
  ROTULOS_MODELO,
  STATUS_NOTA,
  type ConfigPublicaFiscalDTO,
  type ListaNotasDTO,
  type NotaFiscalDTO,
} from './tipos';

const MOTIVO_MINIMO = 15;

function Total({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Cartao titulo={rotulo}>
      <strong className="fiscal-total-valor">{valor}</strong>
    </Cartao>
  );
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

  function acoesDe(nota: NotaFiscalDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Baixar XML', icone: 'documento', aoClicar: () => void baixarXml(nota) },
    ];
    if (nota.vendaId) {
      const vendaId = nota.vendaId;
      acoes.push({ rotulo: 'Ver venda', icone: 'busca', aoClicar: () => navigate(`${raiz}/vendas/${vendaId}`) });
    }
    if (eGestor && nota.status === 'AUTORIZADA') {
      acoes.push({
        rotulo: 'Cancelar nota',
        icone: 'lixeira',
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
        <Grade>
          <Total rotulo="Notas" valor={String(totais.quantidade)} />
          <Total rotulo="Valor autorizado" valor={formatarMoeda(totais.valor)} />
          <Total rotulo="Autorizadas" valor={String(totais.autorizadas)} />
          <Total rotulo="Canceladas" valor={String(totais.canceladas)} />
        </Grade>
      )}

      <div className="barra-ferramentas fiscal-filtros">
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

      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela
          dados={itens}
          chave={(n) => n.id}
          vazio="Nenhuma nota neste período."
          colunas={[
            { titulo: 'Nº', celula: (n) => <span className="sem-quebra">{n.numero}</span> },
            { titulo: 'Série', celula: (n) => n.serie },
            { titulo: 'Modelo', celula: (n) => <Selo cor="azul">{ROTULOS_MODELO[n.modelo]}</Selo> },
            { titulo: 'Data', celula: (n) => <span className="sem-quebra">{formatarDataHora(n.criadoEm)}</span> },
            {
              titulo: 'Cliente',
              celula: (n) => (
                <span className="produto-texto">
                  <span>{n.cliente ?? 'Consumidor'}</span>
                  {n.vendaNumero !== null && <span className="produto-descricao">Venda nº {n.vendaNumero}</span>}
                </span>
              ),
            },
            {
              titulo: 'Valor',
              alinhar: 'direita',
              celula: (n) => <strong className="sem-quebra">{formatarMoeda(n.valor)}</strong>,
            },
            {
              titulo: 'Status',
              celula: (n) => <Selo cor={STATUS_NOTA[n.status].cor}>{STATUS_NOTA[n.status].rotulo}</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (n) => <MenuAcoes rotulo={`Ações da nota ${n.numero}`} acoes={acoesDe(n)} />,
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
