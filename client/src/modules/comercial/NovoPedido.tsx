import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { AreaTexto, Aviso, Botao, Campo, Carregando, Pagina, Selecao, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import type { ClienteResumo, PedidoDetalhe, ProdutoPrecoVenda, ResumoVendedor } from './tipos';
import { FORMAS_PEDIDO } from './tipos';
import './comercial.css';

// Novo pedido (pensado para o celular do vendedor): 1) escolher o cliente, 2) montar o pedido.
// Cada item tem preço negociado: a diferença para a tabela vira flex (positivo ganha, negativo consome o saldo).
// Os valores da tela são uma prévia; o servidor recalcula ao salvar.

interface LinhaPedido {
  produtoId: number;
  nome: string;
  codigo: string;
  unidade: string;
  precoTabela: number;
  foto: string | null;
  categoria: string | null;
  quantidadeTexto: string;
  precoTexto: string;
}

interface ClienteEscolhido {
  id: number;
  nome: string;
}

function valorOuZero(texto: string): number {
  return lerNumero(texto) ?? 0;
}

function precoNegociadoDaLinha(l: LinhaPedido): number {
  return lerNumero(l.precoTexto) ?? l.precoTabela;
}

function classeFlex(valor: number): string {
  if (valor > 0) return 'com-flex com-flex-positivo';
  if (valor < 0) return 'com-flex com-flex-negativo';
  return 'com-flex';
}

export function NovoPedido() {
  const { id } = useParams();
  const editando = !!id;
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';
  const vendedor = usuario?.perfil === 'VENDEDOR';

  const [passo, setPasso] = useState<1 | 2>(1);
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [erroCliente, setErroCliente] = useState<string | null>(null);

  const [buscaProduto, setBuscaProduto] = useState('');
  const [catalogo, setCatalogo] = useState<ProdutoPrecoVenda[]>([]);
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(false);
  const [erroCatalogo, setErroCatalogo] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaPedido[]>([]);

  const [condicao, setCondicao] = useState('');
  const [forma, setForma] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [preenchido, setPreenchido] = useState(false);

  const resumo = useDados<ResumoVendedor>(vendedor ? '/vendedor/resumo' : null);
  const pedidoEditado = useDados<PedidoDetalhe>(editando ? `/pedidos-venda/${id}` : null);

  // Edição: carrega o pedido existente uma vez.
  useEffect(() => {
    const d = pedidoEditado.dados;
    if (!editando || !d || preenchido) return;
    setCliente({ id: d.clienteId, nome: d.cliente });
    setLinhas(
      d.itens.map((i) => ({
        produtoId: i.produtoId,
        nome: i.produto,
        foto: i.foto ?? null,
        categoria: i.categoria ?? null,
        codigo: '',
        unidade: i.unidade,
        precoTabela: i.precoTabela,
        quantidadeTexto: String(i.quantidade),
        precoTexto: String(i.precoNegociado),
      })),
    );
    setCondicao(d.condicaoPagamento ?? '');
    setForma(d.formaPagamento ?? '');
    setPrevisao(d.previsaoEntrega ? d.previsaoEntrega.slice(0, 10) : '');
    setObservacoes(d.observacoes ?? '');
    setPreenchido(true);
    setPasso(2);
  }, [editando, pedidoEditado.dados, preenchido]);

  // Vindo da carteira: ?cliente=ID já escolhe o cliente.
  useEffect(() => {
    const idCliente = Number(params.get('cliente'));
    if (editando || !Number.isInteger(idCliente) || idCliente <= 0) return;
    let cancelado = false;
    api
      .get<ClienteResumo>(`/clientes/${idCliente}`)
      .then((c) => {
        if (cancelado) return;
        setCliente({ id: c.id, nome: c.nome });
        setPasso(2);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [params, editando]);

  // Busca de cliente (a partir de 2 letras).
  useEffect(() => {
    if (buscaCliente.trim().length < 2) {
      setClientes([]);
      return;
    }
    let cancelado = false;
    const t = window.setTimeout(() => {
      setBuscandoCliente(true);
      setErroCliente(null);
      api
        .get<ClienteResumo[]>(`/clientes?busca=${encodeURIComponent(buscaCliente.trim())}`)
        .then((lista) => {
          if (!cancelado) setClientes(lista.filter((c) => !c.bloqueado).slice(0, 30));
        })
        .catch((e: unknown) => {
          if (!cancelado) setErroCliente(mensagemErro(e));
        })
        .finally(() => {
          if (!cancelado) setBuscandoCliente(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [buscaCliente]);

  // Catálogo com preço de tabela para o cliente escolhido (passo 2).
  useEffect(() => {
    if (passo !== 2 || !cliente) return;
    let cancelado = false;
    const t = window.setTimeout(() => {
      setCarregandoCatalogo(true);
      setErroCatalogo(null);
      const q = new URLSearchParams({ clienteId: String(cliente.id) });
      if (buscaProduto.trim()) q.set('busca', buscaProduto.trim());
      api
        .get<ProdutoPrecoVenda[]>(`/pedidos-venda/precos?${q.toString()}`)
        .then((lista) => {
          if (!cancelado) setCatalogo(lista);
        })
        .catch((e: unknown) => {
          if (!cancelado) setErroCatalogo(mensagemErro(e));
        })
        .finally(() => {
          if (!cancelado) setCarregandoCatalogo(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [passo, cliente, buscaProduto]);

  function adicionar(p: ProdutoPrecoVenda) {
    setLinhas((atuais) => {
      if (atuais.some((l) => l.produtoId === p.produtoId)) {
        return atuais.map((l) =>
          l.produtoId === p.produtoId ? { ...l, quantidadeTexto: String(valorOuZero(l.quantidadeTexto) + 1) } : l,
        );
      }
      return [
        ...atuais,
        {
          produtoId: p.produtoId,
          nome: p.nome,
          foto: p.foto,
          categoria: p.categoria,
          codigo: p.codigo,
          unidade: p.unidade,
          precoTabela: p.precoTabela,
          quantidadeTexto: '1',
          precoTexto: '',
        },
      ];
    });
  }

  function atualizar(produtoId: number, campo: 'quantidadeTexto' | 'precoTexto', valor: string) {
    setLinhas((atuais) => atuais.map((l) => (l.produtoId === produtoId ? { ...l, [campo]: valor } : l)));
  }

  function remover(produtoId: number) {
    setLinhas((atuais) => atuais.filter((l) => l.produtoId !== produtoId));
  }

  // Prévia dos totais.
  const totalTabela = linhas.reduce((s, l) => s + valorOuZero(l.quantidadeTexto) * l.precoTabela, 0);
  const total = linhas.reduce((s, l) => s + valorOuZero(l.quantidadeTexto) * precoNegociadoDaLinha(l), 0);
  const flex = linhas.reduce(
    (s, l) => s + (precoNegociadoDaLinha(l) - l.precoTabela) * valorOuZero(l.quantidadeTexto),
    0,
  );
  const saldo = resumo.dados?.saldoFlex ?? 0;
  const flexInsuficiente = vendedor && flex < 0 && saldo + flex < 0;
  const quantidadesInvalidas = linhas.some((l) => !(valorOuZero(l.quantidadeTexto) > 0));

  async function salvar(orcamento: boolean) {
    setErroSalvar(null);
    if (!cliente) return setErroSalvar('Escolha o cliente.');
    if (linhas.length === 0) return setErroSalvar('Adicione ao menos um produto.');
    if (quantidadesInvalidas) return setErroSalvar('Informe a quantidade de todos os itens.');
    if (flexInsuficiente) return setErroSalvar('Saldo de flex insuficiente para este preço.');

    const corpo = {
      clienteId: cliente.id,
      itens: linhas.map((l) => ({
        produtoId: l.produtoId,
        quantidade: valorOuZero(l.quantidadeTexto),
        precoNegociado: precoNegociadoDaLinha(l),
      })),
      condicaoPagamento: condicao.trim() || null,
      formaPagamento: forma || null,
      previsaoEntrega: previsao || null,
      observacoes: observacoes.trim() || null,
      orcamento,
    };
    setSalvando(true);
    try {
      if (editando) await api.put(`/pedidos-venda/${id}`, corpo);
      else await api.post('/pedidos-venda', corpo);
      navigate(`${raiz}/pedidos-venda`);
    } catch (e) {
      setErroSalvar(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (editando && pedidoEditado.carregando && !preenchido) {
    return (
      <Pagina titulo="Editar pedido">
        <Carregando />
      </Pagina>
    );
  }

  return (
    <Pagina titulo={editando ? `Editar pedido${pedidoEditado.dados ? ` nº ${pedidoEditado.dados.numero}` : ''}` : 'Novo pedido'}>
      {pedidoEditado.erro && <Aviso tipo="erro">{pedidoEditado.erro}</Aviso>}

      {passo === 1 && (
        <section className="com-passo">
          <h2 className="com-passo-titulo">1. Escolha o cliente</h2>
          {cliente ? (
            <div className="com-cliente-escolhido">
              <strong>{cliente.nome}</strong>
              <Botao variante="texto" aoClicar={() => setCliente(null)}>
                Trocar
              </Botao>
            </div>
          ) : (
            <>
              <label className="campo">
                <span className="campo-rotulo">Buscar cliente</span>
                <input
                  className="com-input"
                  type="search"
                  placeholder="Nome, telefone ou CPF/CNPJ"
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                />
              </label>
              {erroCliente && <Aviso tipo="erro">{erroCliente}</Aviso>}
              {buscandoCliente && <Carregando />}
              <div className="com-lista-clientes">
                {clientes.map((c) => (
                  <button key={c.id} type="button" className="com-cliente-item" onClick={() => setCliente({ id: c.id, nome: c.nome })}>
                    <strong>{c.nome}</strong>
                    <span className="com-suave">{c.cidade ?? ''}</span>
                  </button>
                ))}
                {!buscandoCliente && buscaCliente.trim().length >= 2 && clientes.length === 0 && (
                  <p className="com-suave">Nenhum cliente encontrado.</p>
                )}
              </div>
            </>
          )}
          <div className="com-acoes-passo">
            <Botao desabilitado={!cliente} aoClicar={() => setPasso(2)}>
              Continuar
            </Botao>
          </div>
        </section>
      )}

      {passo === 2 && cliente && (
        <div className="com-novo-pedido">
          <section className="com-passo">
            <div className="com-cliente-escolhido">
              <span>
                Cliente: <strong>{cliente.nome}</strong>
              </span>
              {!editando && (
                <Botao variante="texto" aoClicar={() => setPasso(1)}>
                  Trocar
                </Botao>
              )}
            </div>

            <h2 className="com-passo-titulo">2. Produtos</h2>
            <label className="campo">
              <span className="campo-rotulo">Buscar produto</span>
              <input
                className="com-input"
                type="search"
                placeholder="Nome, código ou EAN"
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
              />
            </label>
            {erroCatalogo && <Aviso tipo="erro">{erroCatalogo}</Aviso>}
            {carregandoCatalogo && <Carregando />}
            <div className="com-catalogo">
              {catalogo.map((p) => (
                <button key={p.produtoId} type="button" className="com-produto-card" onClick={() => adicionar(p)}>
                  <span className="com-produto-card-topo">
                    <FotoProduto foto={p.foto} nome={p.nome} setor={p.categoria} tamanho={56} />
                    <span className="com-produto-card-texto">
                      <strong>{p.nome}</strong>
                      <span className="com-suave">
                        {p.codigo} · {p.unidade} · estoque {p.estoque}
                      </span>
                    </span>
                  </span>
                  <span className="com-precos">
                    <span>
                      Tabela <strong>{formatarMoeda(p.precoTabela)}</strong>
                    </span>
                    {(() => {
                      const noPedido = linhas.find((l) => l.produtoId === p.produtoId);
                      return noPedido ? (
                        <span>
                          Negociado <strong>{formatarMoeda(precoNegociadoDaLinha(noPedido))}</strong>
                        </span>
                      ) : null;
                    })()}
                  </span>
                  {p.precoAtacado !== null && <span className="com-suave">Atacado {formatarMoeda(p.precoAtacado)}</span>}
                  {p.promocao && <span className="com-promo">{p.promocao}</span>}
                  {linhas.some((l) => l.produtoId === p.produtoId) && <span className="com-no-pedido">Já no pedido: toque para somar 1</span>}
                </button>
              ))}
              {!carregandoCatalogo && !erroCatalogo && catalogo.length === 0 && (
                <p className="com-suave">Nenhum produto encontrado.</p>
              )}
            </div>

            <h2 className="com-passo-titulo">Itens do pedido</h2>
            {linhas.length === 0 && <p className="com-suave">Toque em um produto para adicionar.</p>}
            <div className="com-itens">
              {linhas.map((l) => {
                const qtd = valorOuZero(l.quantidadeTexto);
                const pNeg = precoNegociadoDaLinha(l);
                const flexLinha = (pNeg - l.precoTabela) * qtd;
                return (
                  <div key={l.produtoId} className="com-item">
                    <div className="com-item-topo">
                      <span className="com-item-produto"><FotoProduto foto={l.foto} nome={l.nome} setor={l.categoria} tamanho={44} /><strong>{l.nome}</strong></span>
                      <button type="button" className="com-remover" onClick={() => remover(l.produtoId)} aria-label="Remover item">
                        ×
                      </button>
                    </div>
                    <div className="com-item-campos">
                      <label className="campo">
                        <span className="campo-rotulo">Qtd ({l.unidade})</span>
                        <input
                          className="com-input"
                          inputMode="decimal"
                          value={l.quantidadeTexto}
                          onChange={(e) => atualizar(l.produtoId, 'quantidadeTexto', e.target.value)}
                        />
                      </label>
                      <label className="campo">
                        <span className="campo-rotulo">Preço negociado</span>
                        <input
                          className="com-input"
                          inputMode="decimal"
                          placeholder={formatarMoeda(l.precoTabela)}
                          value={l.precoTexto}
                          onChange={(e) => atualizar(l.produtoId, 'precoTexto', e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="com-item-rodape">
                      <span className="com-suave">Tabela {formatarMoeda(l.precoTabela)}</span>
                      <span className={classeFlex(flexLinha)}>
                        {flexLinha === 0 ? 'Sem diferença' : `${flexLinha > 0 ? '+' : ''}${formatarMoeda(flexLinha)} de flex`}
                      </span>
                      <strong>{formatarMoeda(qtd * pNeg)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>

            <h2 className="com-passo-titulo">Pagamento e entrega</h2>
            <div className="com-campos-pedido">
              <Campo rotulo="Condição de pagamento" valor={condicao} aoMudar={setCondicao} />
              <Selecao
                rotulo="Forma de pagamento"
                valor={forma}
                aoMudar={setForma}
                opcoes={FORMAS_PEDIDO}
                vazio="A definir"
              />
              <Campo rotulo="Previsão de entrega" valor={previsao} aoMudar={setPrevisao} tipo="date" />
              <AreaTexto rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} linhas={3} />
            </div>

            {erroSalvar && <Aviso tipo="erro">{erroSalvar}</Aviso>}
            <div className="com-espaco-rodape" />
          </section>

          <footer className="com-rodape-fixo">
            <div className="com-rodape-totais">
              <div>
                <span className="com-suave">Total</span>
                <strong>{formatarMoeda(total)}</strong>
                <span className="com-suave">Tabela {formatarMoeda(totalTabela)}</span>
              </div>
              <div>
                <span className="com-suave">Flex do pedido</span>
                <strong className={classeFlex(flex)}>
                  {flex === 0 ? 'Sem flex' : `${flex > 0 ? '+' : ''}${formatarMoeda(flex)}`}
                </strong>
                {vendedor && (
                  <span className={flexInsuficiente ? 'com-saldo com-saldo-insuficiente' : 'com-saldo'}>
                    Saldo {formatarMoeda(saldo)}
                  </span>
                )}
              </div>
            </div>
            <div className="com-rodape-acoes">
              <Botao variante="secundario" desabilitado={salvando} aoClicar={() => salvar(true)}>
                Salvar orçamento
              </Botao>
              <Botao desabilitado={salvando || flexInsuficiente || linhas.length === 0} aoClicar={() => salvar(false)}>
                {salvando ? 'Enviando...' : 'Enviar pedido'}
              </Botao>
            </div>
          </footer>
        </div>
      )}
    </Pagina>
  );
}
