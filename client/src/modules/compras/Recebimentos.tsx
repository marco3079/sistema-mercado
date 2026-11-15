import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Modal, Pagina, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import { ROTULO_STATUS_RECEBIMENTO } from './tipos';
import type { PedidoLinha, RecebimentoDetalhe, RecebimentoLinha } from './tipos';

// Pedidos que ainda podem ser recebidos.
const PEDIDOS_RECEBIVEIS = ['ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL'];
const LIMITE_XML_BYTES = 3 * 1024 * 1024;

// Lê o arquivo como texto (UTF-8).
function lerArquivo(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ''));
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsText(arquivo, 'utf-8');
  });
}

// Lista de recebimentos. Abre um novo pelo pedido ou pela NF-e (XML).
export function Recebimentos() {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/estoquista';
  const navegar = useNavigate();
  const { dados, carregando, erro } = useDados<RecebimentoLinha[]>('/recebimentos');
  const [escolhendoPedido, setEscolhendoPedido] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function importarXml(arquivo: File) {
    setMensagem(null);
    if (arquivo.size > LIMITE_XML_BYTES) {
      setMensagem('Este arquivo é grande demais para uma NF-e.');
      return;
    }
    setOcupado(true);
    try {
      const texto = await lerArquivo(arquivo);
      const recebimento = await api.post<RecebimentoDetalhe>('/recebimentos', { xml: texto });
      navegar(`${raiz}/recebimento/${recebimento.id}`);
    } catch (falha) {
      setMensagem(mensagemErro(falha));
      setOcupado(false);
    }
  }

  return (
    <Pagina
      titulo="Recebimento"
      acoes={
        <>
          <Botao aoClicar={() => setEscolhendoPedido(true)} desabilitado={ocupado}>
            Receber pedido
          </Botao>
          <label className="botao botao-secundario">
            Importar XML da NF-e
            <input
              type="file"
              accept=".xml,text/xml"
              className="compras-oculto"
              disabled={ocupado}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = '';
                if (arquivo) void importarXml(arquivo);
              }}
            />
          </label>
        </>
      }
    >
      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && (
        <div className="compras-rolagem">
          <Tabela
            colunas={[
              { titulo: 'Nota', celula: (r) => (r.numeroNota ? `NF ${r.numeroNota}` : `Recebimento #${r.id}`) },
              { titulo: 'Fornecedor', celula: (r) => r.fornecedor },
              {
                titulo: 'Status',
                celula: (r) => (
                  <Selo cor={ROTULO_STATUS_RECEBIMENTO[r.status].cor}>{ROTULO_STATUS_RECEBIMENTO[r.status].rotulo}</Selo>
                ),
              },
              { titulo: 'Itens', alinhar: 'centro', celula: (r) => r.itens },
              { titulo: 'Valor da nota', alinhar: 'direita', celula: (r) => (r.valorNota === null ? '—' : formatarMoeda(r.valorNota)) },
              { titulo: 'Aberto em', celula: (r) => formatarData(r.criadoEm) },
            ]}
            dados={dados}
            chave={(r) => r.id}
            vazio="Nenhum recebimento ainda. Receba um pedido ou importe a NF-e."
            aoClicarLinha={(r) => navegar(`${raiz}/recebimento/${r.id}`)}
          />
        </div>
      )}

      <Modal aberto={escolhendoPedido} titulo="Receber pedido" aoFechar={() => setEscolhendoPedido(false)}>
        {escolhendoPedido && (
          <EscolherPedido
            aoEscolher={async (pedidoId) => {
              setOcupado(true);
              try {
                const recebimento = await api.post<RecebimentoDetalhe>('/recebimentos', { pedidoCompraId: pedidoId });
                navegar(`${raiz}/recebimento/${recebimento.id}`);
              } catch (falha) {
                setMensagem(mensagemErro(falha));
                setOcupado(false);
                setEscolhendoPedido(false);
              }
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}

// Pedidos em trânsito ou enviados, para escolher o que chegou.
function EscolherPedido({ aoEscolher }: { aoEscolher: (pedidoId: number) => void }) {
  const { dados, carregando, erro } = useDados<PedidoLinha[]>('/pedidos-compra');

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;

  const pendentes = (dados ?? []).filter((p) => PEDIDOS_RECEBIVEIS.includes(p.status));
  if (pendentes.length === 0) {
    return <p className="compras-vazio">Nenhum pedido enviado aguardando recebimento.</p>;
  }

  return (
    <ul className="compras-resultados">
      {pendentes.map((p) => (
        <li key={p.id}>
          <button type="button" className="compras-resultado" onClick={() => aoEscolher(p.id)}>
            <span>
              Pedido #{p.numero} · {p.fornecedor}
              <span className="compras-sub">
                {p.itens} {p.itens === 1 ? 'item' : 'itens'}
                {p.previsaoEntrega ? ` · previsão ${formatarData(p.previsaoEntrega)}` : ''}
              </span>
            </span>
            <span className="compras-resultado-texto">{formatarMoeda(p.total)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
