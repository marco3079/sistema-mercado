import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, formatarData, formatarMoeda } from '../../ui';
import { CelulaProduto, FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { ROTULO_STATUS_PEDIDO } from './tipos';
import type { FornecedorLinha, PedidoDetalhe, PedidoLinha, ProdutoBuscaDTO, StatusPedido } from './tipos';

// Busca de produto usada em pedidos, cotações e fichas. Só consulta a partir de 2 letras.
export function BuscaProduto({
  aoEscolher,
  rotulo = 'Buscar produto (nome, código ou EAN)',
}: {
  aoEscolher: (produto: ProdutoBuscaDTO) => void;
  rotulo?: string;
}) {
  const [texto, setTexto] = useState('');
  const [termo, setTermo] = useState('');

  useEffect(() => {
    const espera = window.setTimeout(() => setTermo(texto.trim()), 300);
    return () => window.clearTimeout(espera);
  }, [texto]);

  const caminho = termo.length >= 2 ? `/produtos?busca=${encodeURIComponent(termo)}&porPagina=10` : null;
  const { dados, carregando, erro } = useDados<{ itens: ProdutoBuscaDTO[]; total: number }>(caminho);

  return (
    <div className="compras-busca">
      <Campo rotulo={rotulo} valor={texto} aoMudar={setTexto} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}
      {termo.length >= 2 && !carregando && dados && dados.itens.length === 0 && (
        <p className="compras-vazio">Nenhum produto encontrado.</p>
      )}
      {dados && dados.itens.length > 0 && (
        <ul className="compras-resultados">
          {dados.itens.map((p) => (
            <li key={p.id}>
              <button type="button" className="compras-resultado" onClick={() => aoEscolher(p)}>
                <span>
                  {p.nome}
                  <span className="compras-sub">{p.codigo}</span>
                </span>
                <span className="compras-resultado-texto">
                  {formatarMoeda(p.precoCusto)} · {p.unidade.toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Etapas em que o pedido ainda não foi recebido.
const ETAPAS_ABERTAS: StatusPedido[] = ['RASCUNHO', 'ENVIADO', 'CONFIRMADO', 'EM_TRANSITO'];

// Cartão de pedido: fornecedor, total, previsão e mini fotos dos itens sobrepostas.
function CartaoPedido({ pedido: p, aoAbrir }: { pedido: PedidoLinha; aoAbrir: () => void }) {
  const restantes = p.itens - p.fotos.length;
  return (
    <article className="cartao-produto compras-pedido">
      <div className="compras-pedido-topo">
        <strong className="compras-pedido-numero">Pedido #{p.numero}</strong>
        <Selo cor={ROTULO_STATUS_PEDIDO[p.status].cor}>{ROTULO_STATUS_PEDIDO[p.status].rotulo}</Selo>
      </div>
      <p className="compras-pedido-fornecedor">{p.fornecedor}</p>
      <div className="compras-pedido-fotos">
        {p.fotos.map((f, i) => (
          <FotoProduto key={i} foto={f.foto} nome={f.nome} setor={f.categoria} tamanho={36} />
        ))}
        {restantes > 0 && <span className="compras-pedido-mais">+{restantes}</span>}
      </div>
      <dl className="compras-pedido-dados">
        <div>
          <dt>Total</dt>
          <dd className="numero">{formatarMoeda(p.total)}</dd>
        </div>
        <div>
          <dt>Previsão</dt>
          <dd>{p.previsaoEntrega ? formatarData(p.previsaoEntrega) : '—'}</dd>
        </div>
      </dl>
      <div className="cartao-produto-rodape">
        <span className="compras-ajuda">{p.itens} item(ns)</span>
        <Botao variante="secundario" aoClicar={aoAbrir}>
          Abrir
        </Botao>
      </div>
    </article>
  );
}

// Abas em funil: cada aba junta os status que cabem nela.
const FUNIL: { id: string; rotulo: string; status: string[] }[] = [
  { id: 'RASCUNHO', rotulo: 'Rascunho', status: ['RASCUNHO'] },
  { id: 'ENVIADO', rotulo: 'Enviado', status: ['ENVIADO'] },
  { id: 'CONFIRMADO', rotulo: 'Confirmado', status: ['CONFIRMADO'] },
  { id: 'EM_TRANSITO', rotulo: 'Em trânsito', status: ['EM_TRANSITO'] },
  { id: 'RECEBIDO', rotulo: 'Recebido', status: ['RECEBIDO', 'RECEBIDO_PARCIAL'] },
];

// Tela de pedidos de compra. ESTOQUISTA só lê a lista.
export function PedidosCompra() {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();
  const podeCriar = usuario?.perfil !== 'ESTOQUISTA';
  const { dados, carregando, erro } = useDados<PedidoLinha[]>('/pedidos-compra');
  const [aba, setAba] = useState('RASCUNHO');
  const [novo, setNovo] = useState(false);

  const statusDaAba = FUNIL.find((a) => a.id === aba)?.status ?? [];
  const contagem = (status: string[]) => (dados ? dados.filter((p) => status.includes(p.status)).length : 0);
  const abas = FUNIL.map((a) => ({ id: a.id, rotulo: `${a.rotulo} (${contagem(a.status)})` }));
  const lista = dados ? dados.filter((p) => statusDaAba.includes(p.status)) : [];
  const emAberto = dados ? dados.filter((p) => ETAPAS_ABERTAS.includes(p.status)) : [];
  const valorEmAberto = emAberto.reduce((soma, p) => soma + p.total, 0);
  const recebidos = dados ? dados.filter((p) => p.status === 'RECEBIDO' || p.status === 'RECEBIDO_PARCIAL').length : 0;

  return (
    <Pagina
      titulo="Pedidos de compra"
      acoes={podeCriar ? <Botao aoClicar={() => setNovo(true)}>Novo pedido</Botao> : undefined}
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && (
        <>
          <div className="resumo">
            <div className="resumo-item">
              <span className="resumo-icone resumo-icone-azul">
                <Icone nome="pedidos" tamanho={24} />
              </span>
              <div>
                <span className="resumo-valor">{emAberto.length}</span>
                <span className="resumo-rotulo">Em aberto</span>
              </div>
            </div>
            <div className="resumo-item">
              <span className="resumo-icone resumo-icone-laranja">
                <Icone nome="dinheiro" tamanho={24} />
              </span>
              <div>
                <span className="resumo-valor">{formatarMoeda(valorEmAberto)}</span>
                <span className="resumo-rotulo">Valor em aberto</span>
              </div>
            </div>
            <div className="resumo-item">
              <span className="resumo-icone resumo-icone-verde">
                <Icone nome="visto" tamanho={24} />
              </span>
              <div>
                <span className="resumo-valor">{recebidos}</span>
                <span className="resumo-rotulo">Recebidos</span>
              </div>
            </div>
          </div>
          <Abas abas={abas} ativa={aba} aoMudar={setAba} />
          {lista.length === 0 ? (
            <p className="tabela-vazia">Nenhum pedido nesta etapa.</p>
          ) : (
            <div className="grade-produtos">
              {lista.map((p) => (
                <CartaoPedido key={p.id} pedido={p} aoAbrir={() => navegar(`${raiz}/pedidos-compra/${p.id}`)} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal aberto={novo} titulo="Novo pedido de compra" aoFechar={() => setNovo(false)}>
        {novo && <NovoPedido aoCriar={(id) => navegar(`${raiz}/pedidos-compra/${id}`)} />}
      </Modal>
    </Pagina>
  );
}

interface LinhaNovoPedido {
  produto: ProdutoBuscaDTO;
  quantidade: string;
  preco: string;
}

// Pedido manual: escolhe o fornecedor e os produtos. Cria em rascunho e abre o pedido.
function NovoPedido({ aoCriar }: { aoCriar: (id: number) => void }) {
  const { dados: fornecedores, carregando, erro } = useDados<FornecedorLinha[]>('/fornecedores?ativo=true');
  const [fornecedorId, setFornecedorId] = useState('');
  const [linhas, setLinhas] = useState<LinhaNovoPedido[]>([]);
  const [previsao, setPrevisao] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function adicionar(p: ProdutoBuscaDTO) {
    if (linhas.some((l) => l.produto.id === p.id)) return;
    setLinhas((atual) => [...atual, { produto: p, quantidade: '1', preco: String(p.precoCusto).replace('.', ',') }]);
  }

  function atualizarLinha(produtoId: number, campo: 'quantidade' | 'preco', valor: string) {
    setLinhas((atual) => atual.map((l) => (l.produto.id === produtoId ? { ...l, [campo]: valor } : l)));
  }

  const total = linhas.reduce((soma, l) => {
    const q = lerNumero(l.quantidade) ?? 0;
    const p = lerNumero(l.preco) ?? 0;
    return soma + q * p;
  }, 0);

  async function criar() {
    setMensagem(null);
    if (!fornecedorId) {
      setMensagem('Escolha o fornecedor.');
      return;
    }
    if (linhas.length === 0) {
      setMensagem('Inclua ao menos um produto.');
      return;
    }
    const itens: { produtoId: number; quantidade: number; precoUnitario: number }[] = [];
    for (const l of linhas) {
      const q = lerNumero(l.quantidade);
      const p = lerNumero(l.preco);
      if (q === null || q <= 0 || p === null || p < 0) {
        setMensagem(`Confira quantidade e preço de ${l.produto.nome}.`);
        return;
      }
      itens.push({ produtoId: l.produto.id, quantidade: q, precoUnitario: p });
    }
    setEnviando(true);
    try {
      const criado = await api.post<PedidoDetalhe>('/pedidos-compra', {
        fornecedorId: Number(fornecedorId),
        itens,
        previsaoEntrega: previsao || null,
      });
      aoCriar(criado.id);
    } catch (falha) {
      setMensagem(mensagemErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  if (carregando && !fornecedores) return <Carregando />;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;

  return (
    <div>
      <div className="compras-grade-campos">
        <Selecao
          rotulo="Fornecedor"
          valor={fornecedorId}
          aoMudar={setFornecedorId}
          opcoes={(fornecedores ?? []).map((f) => ({ valor: String(f.id), rotulo: f.nome }))}
          vazio="Escolha o fornecedor"
          obrigatorio
        />
        <Campo rotulo="Previsão de entrega" tipo="date" valor={previsao} aoMudar={setPrevisao} />
      </div>

      <div className="compras-secao">
        <h3 className="compras-secao-titulo">Produtos</h3>
        <BuscaProduto aoEscolher={adicionar} />
      </div>

      {linhas.length > 0 && (
        <div className="compras-secao compras-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col" className="tabela-alinhar-direita">Quantidade</th>
                <th scope="col" className="tabela-alinhar-direita">Preço (R$)</th>
                <th scope="col" className="tabela-alinhar-direita">Subtotal</th>
                <th scope="col"><span className="tabela-oculto-visual">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const subtotal = (lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0);
                return (
                  <tr key={l.produto.id}>
                    <td>
                      <CelulaProduto
                        foto={l.produto.foto}
                        nome={l.produto.nome}
                        setor={l.produto.categoria}
                        detalhe={l.produto.codigo}
                        tamanho={36}
                      />
                    </td>
                    <td className="tabela-alinhar-direita">
                      <input
                        className="compras-input compras-input-curto"
                        inputMode="decimal"
                        value={l.quantidade}
                        onChange={(e) => atualizarLinha(l.produto.id, 'quantidade', e.target.value)}
                        aria-label={`Quantidade de ${l.produto.nome}`}
                      />
                    </td>
                    <td className="tabela-alinhar-direita">
                      <input
                        className="compras-input compras-input-curto"
                        inputMode="decimal"
                        value={l.preco}
                        onChange={(e) => atualizarLinha(l.produto.id, 'preco', e.target.value)}
                        aria-label={`Preço de ${l.produto.nome}`}
                      />
                    </td>
                    <td className="tabela-alinhar-direita">{formatarMoeda(subtotal)}</td>
                    <td>
                      <Botao
                        variante="texto"
                        aoClicar={() => setLinhas((atual) => atual.filter((x) => x.produto.id !== l.produto.id))}
                      >
                        Remover
                      </Botao>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="compras-acumulado">
            Total: <strong>{formatarMoeda(total)}</strong>
          </p>
        </div>
      )}

      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
      <div className="compras-linha-acoes">
        <Botao aoClicar={() => void criar()} desabilitado={enviando}>
          {enviando ? 'Criando...' : 'Criar pedido em rascunho'}
        </Botao>
      </div>
    </div>
  );
}
