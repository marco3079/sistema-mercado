import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarQuantidade, hojeIso, mensagemErro } from '../../lib/mercado';
import { usePlataforma } from '../../lib/plataforma';
import { useTema } from '../../lib/tema';
import { AreaTexto, Aviso, Campo, Carregando, Selecao, Selo, formatarData, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { COR_TIPO, ROTULOS_TIPO } from './tipos';
import type { CorSelo, TipoTerceiro } from './tipos';
import './portal-remessa.css';

// Portal do terceiro (sem login): /remessa/:codigo.
// Abas: Pedir remessa | Em posse | Meus pedidos. PC: catálogo à esquerda e "Seu pedido" fixo à direita.
// Celular: catálogo com barra inferior "N itens · Revisar pedido" que abre o pedido em folha de baixo.

type StatusPedidoPortal = 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'CANCELADO';
type Aba = 'pedir' | 'posse' | 'pedidos';

interface LojaPortal {
  id: number;
  nome: string;
  endereco: string | null;
}

interface ItemEmPosse {
  produtoId: number;
  nome: string;
  unidade: string;
  foto: string | null;
  quantidade: number;
}

interface RemessaAberta {
  numero: number;
  tipo: TipoTerceiro;
  criadoEm: string;
  previsaoRetorno: string | null;
  atrasada: boolean;
  itens: number | unknown[]; // quantidade de itens (o servidor pode mandar a lista; conta-se o tamanho)
}

interface ItemPedidoPortal {
  nome: string;
  unidade: string;
  quantidade: number;
  quantidadeEnviada?: number | null; // opcional: só vem em pedidos aprovados (enviado pela loja)
}

interface PedidoPortal {
  id: number;
  numero: number;
  status: StatusPedidoPortal;
  criadoEm: string;
  dataDesejada: string | null;
  motivoRecusa: string | null;
  remessaNumero: number | null;
  itens: ItemPedidoPortal[];
}

interface ProdutoPortal {
  id: number;
  codigo: string;
  nome: string;
  unidade: string;
  foto: string | null;
  categoria: string | null;
  preco: number; // preço de referência
}

interface PortalRemessaDados {
  empresa: string;
  terceiro: { nome: string; contato?: string | null };
  lojas: LojaPortal[];
  emPosse: ItemEmPosse[];
  remessasAbertas: RemessaAberta[];
  pedidos: PedidoPortal[];
  produtos: ProdutoPortal[];
}

interface ItemPedido {
  produto: ProdutoPortal;
  quantidade: number;
}

const TIPOS_PEDIDO: TipoTerceiro[] = ['CONSIGNACAO', 'COMODATO', 'DEMONSTRACAO', 'EVENTO', 'OUTRO'];

const STATUS_PEDIDO: Record<StatusPedidoPortal, { rotulo: string; cor: CorSelo }> = {
  PENDENTE: { rotulo: 'Pendente', cor: 'amarelo' },
  APROVADO: { rotulo: 'Aprovado', cor: 'verde' },
  RECUSADO: { rotulo: 'Recusado', cor: 'vermelho' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'cinza' },
};

// Unidades vendidas por peso/volume aceitam decimal (passo 0,5).
const PESAVEIS = ['KG', 'L'];

class LinkInvalido extends Error {}

async function buscarPortal(codigo: string): Promise<PortalRemessaDados> {
  // GET direto (sem o api.get) para distinguir o 404 de link inválido dos demais erros.
  const resposta = await fetch(`/api/publico/remessa/${encodeURIComponent(codigo)}`);
  if (resposta.status === 404) throw new LinkInvalido('Link inválido');
  if (!resposta.ok) {
    let mensagem = 'Não foi possível carregar o portal.';
    try {
      mensagem = ((await resposta.json()) as { erro?: string }).erro ?? mensagem;
    } catch {
      // resposta sem JSON: mantém a mensagem padrão
    }
    throw new Error(mensagem);
  }
  return (await resposta.json()) as PortalRemessaDados;
}

function arred3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function textoNumero(n: number): string {
  return String(n).replace('.', ',');
}

function passoDe(unidade: string): number {
  return PESAVEIS.includes(unidade.toUpperCase()) ? 0.5 : 1;
}

function contarItens(itens: number | unknown[]): number {
  return Array.isArray(itens) ? itens.length : itens;
}

// Seletor − quantidade +. Unidades pesáveis deixam digitar o valor decimal.
function Seletor({
  quantidade,
  unidade,
  nome,
  aoMudar,
}: {
  quantidade: number;
  unidade: string;
  nome: string;
  aoMudar: (nova: number) => void;
}) {
  const passo = passoDe(unidade);
  const digitavel = passo < 1;
  const [texto, setTexto] = useState(textoNumero(quantidade));

  useEffect(() => {
    setTexto(textoNumero(quantidade));
  }, [quantidade]);

  function confirmarTexto() {
    const n = Number(texto.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) aoMudar(arred3(n));
    else setTexto(textoNumero(quantidade));
  }

  return (
    <div className="portal-rem-seletor" role="group" aria-label={`Quantidade de ${nome}`}>
      <button type="button" aria-label="Diminuir" onClick={() => aoMudar(arred3(Math.max(0, quantidade - passo)))}>
        −
      </button>
      {digitavel ? (
        <input
          className="portal-rem-qtd"
          type="text"
          inputMode="decimal"
          value={texto}
          aria-label={`Quantidade de ${nome}`}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmarTexto}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmarTexto();
          }}
        />
      ) : (
        <span className="portal-rem-qtd-valor">{formatarQuantidade(quantidade, unidade)}</span>
      )}
      <button type="button" aria-label="Aumentar" onClick={() => aoMudar(arred3(quantidade + passo))}>
        +
      </button>
    </div>
  );
}

export function PortalRemessa() {
  const { codigo = '' } = useParams();
  const { plataforma, logoSrc } = usePlataforma();
  const { temaEfetivo, alternar } = useTema();

  const [dados, setDados] = useState<PortalRemessaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [linkInvalido, setLinkInvalido] = useState(false);
  const [versao, setVersao] = useState(0);

  const [aba, setAba] = useState<Aba>('pedir');
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Pedir remessa
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [carrinho, setCarrinho] = useState<Record<number, number>>({});
  const [lojaEscolhida, setLojaEscolhida] = useState('');
  const [tipo, setTipo] = useState<string>('CONSIGNACAO');
  const [dataDesejada, setDataDesejada] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [revisando, setRevisando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  // Meus pedidos
  const [confirmandoId, setConfirmandoId] = useState<number | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [erroPedidos, setErroPedidos] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    buscarPortal(codigo)
      .then((d) => {
        if (cancelado) return;
        setDados(d);
        setLinkInvalido(false);
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        if (e instanceof LinkInvalido) setLinkInvalido(true);
        else setErro(mensagemErro(e));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [codigo, versao]);

  const recarregar = () => setVersao((v) => v + 1);

  const lojas = useMemo(() => dados?.lojas ?? [], [dados]);
  // Se só há uma loja, ela já vem escolhida.
  const lojaSelecionada = lojaEscolhida !== '' ? lojaEscolhida : lojas.length === 1 ? String(lojas[0].id) : '';
  const lojaAtual = lojas.find((l) => String(l.id) === lojaSelecionada) ?? null;

  const produtos = useMemo(() => dados?.produtos ?? [], [dados]);

  const produtosPorId = useMemo(() => {
    const mapa = new Map<number, ProdutoPortal>();
    for (const p of produtos) mapa.set(p.id, p);
    return mapa;
  }, [produtos]);

  const categorias = useMemo(() => {
    const nomes = new Set<string>();
    for (const p of produtos) if (p.categoria) nomes.add(p.categoria);
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [produtos]);

  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(
    () =>
      produtos.filter(
        (p) =>
          (categoria === '' || p.categoria === categoria) &&
          (termo === '' || p.nome.toLowerCase().includes(termo) || p.codigo.toLowerCase().includes(termo)),
      ),
    [produtos, categoria, termo],
  );

  const itens: ItemPedido[] = Object.entries(carrinho)
    .map(([id, quantidade]) => ({ produto: produtosPorId.get(Number(id)), quantidade }))
    .filter((i): i is ItemPedido => !!i.produto && i.quantidade > 0);

  const total = itens.reduce((soma, i) => soma + i.produto.preco * i.quantidade, 0);
  const pendentes = (dados?.pedidos ?? []).filter((p) => p.status === 'PENDENTE').length;

  function quantidadeNoPedido(produtoId: number): number {
    return carrinho[produtoId] ?? 0;
  }

  function definirQuantidade(produtoId: number, quantidade: number) {
    setCarrinho((atual) => {
      const copia = { ...atual };
      const nova = arred3(quantidade);
      if (nova > 0) copia[produtoId] = nova;
      else delete copia[produtoId];
      return copia;
    });
  }

  async function enviarPedido() {
    setErroPedido(null);
    setSucesso(null);
    if (lojaSelecionada === '') {
      setErroPedido('Escolha a loja que vai enviar.');
      return;
    }
    if (itens.length === 0) {
      setErroPedido('Escolha ao menos um produto.');
      return;
    }
    if (dataDesejada !== '' && dataDesejada < hojeIso()) {
      setErroPedido('A data de recebimento não pode ser anterior a hoje.');
      return;
    }
    setEnviando(true);
    try {
      const criado = await api.post<{ id: number; numero: number }>(`/publico/remessa/${codigo}/pedidos`, {
        lojaId: Number(lojaSelecionada),
        tipo: tipo || undefined,
        dataDesejada: dataDesejada || undefined,
        observacoes: observacoes.trim() || undefined,
        itens: itens.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade })),
      });
      setCarrinho({});
      setDataDesejada('');
      setObservacoes('');
      setRevisando(false);
      setSucesso(`Pedido nº ${criado.numero} enviado. A loja vai conferir e avisar.`);
      setAba('pedidos');
      recarregar();
    } catch (e) {
      setErroPedido(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function cancelarPedido(id: number) {
    setCancelando(true);
    setErroPedidos(null);
    setSucesso(null);
    try {
      await api.post(`/publico/remessa/${codigo}/pedidos/${id}/cancelar`);
      setConfirmandoId(null);
      setSucesso('Pedido cancelado.');
      recarregar();
    } catch (e) {
      setErroPedidos(mensagemErro(e));
    } finally {
      setCancelando(false);
    }
  }

  if (linkInvalido) {
    return (
      <div className="portal-rem portal-rem-link-invalido">
        <img className="portal-rem-logo-grande" src={logoSrc} alt="" />
        <h1>Link inválido ou desativado.</h1>
        <p className="portal-rem-suave">Peça um novo link à loja.</p>
      </div>
    );
  }

  const iconeTema = temaEfetivo === 'escuro' ? 'sol' : 'lua';

  function renderCartao(p: ProdutoPortal) {
    const qtd = quantidadeNoPedido(p.id);
    const unidade = p.unidade.toLowerCase();
    return (
      <article key={p.id} className="portal-rem-card">
        <div className="portal-rem-card-foto">
          <FotoProduto foto={p.foto} nome={p.nome} setor={p.categoria} preencher />
        </div>
        <div className="portal-rem-card-corpo">
          <h3 className="portal-rem-card-nome">{p.nome}</h3>
          <span className="portal-rem-suave">Unidade: {unidade}</span>
          <span className="portal-rem-preco">Preço de referência {formatarMoeda(p.preco)}</span>
        </div>
        <div className="portal-rem-card-rodape">
          {qtd === 0 ? (
            <button type="button" className="portal-rem-add" disabled={!dados} onClick={() => definirQuantidade(p.id, passoDe(p.unidade))}>
              Adicionar
            </button>
          ) : (
            <Seletor quantidade={qtd} unidade={p.unidade} nome={p.nome} aoMudar={(n) => definirQuantidade(p.id, n)} />
          )}
        </div>
      </article>
    );
  }

  return (
    <div className={dados && aba === 'pedir' && itens.length > 0 ? 'portal-rem portal-rem-com-barra' : 'portal-rem'}>
      <header className="portal-rem-topo">
        <div className="portal-rem-marca">
          <img className="portal-rem-logo" src={logoSrc} alt="" />
          <div className="portal-rem-marca-texto">
            <h1>{dados?.empresa ?? plataforma.nome}</h1>
            <p>Portal de remessas</p>
          </div>
        </div>
        <div className="portal-rem-topo-direita">
          {dados && (
            <span className="portal-rem-ola" title={`Olá, ${dados.terceiro.nome}`}>
              Olá, {dados.terceiro.nome}
            </span>
          )}
          <button type="button" className="portal-rem-redondo" onClick={alternar} aria-label="Trocar tema">
            <Icone nome={iconeTema} tamanho={20} />
          </button>
        </div>
      </header>

      <main className="portal-rem-corpo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && !dados && <Carregando />}

        {dados && (
          <>
            <div className="portal-rem-abas" role="tablist">
              {[
                { id: 'pedir' as Aba, rotulo: 'Pedir remessa', contador: null },
                { id: 'posse' as Aba, rotulo: 'Em posse', contador: dados.emPosse.length },
                { id: 'pedidos' as Aba, rotulo: 'Meus pedidos', contador: null },
              ].map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  aria-selected={aba === a.id}
                  className={aba === a.id ? 'portal-rem-aba portal-rem-aba-ativa' : 'portal-rem-aba'}
                  onClick={() => setAba(a.id)}
                >
                  {a.rotulo}
                  {a.contador !== null && <span className="portal-rem-contador">{a.contador}</span>}
                </button>
              ))}
            </div>

            {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

            {aba === 'pedir' && (
              <div className="portal-rem-pedir">
                <section className="portal-rem-catalogo">
                  <div className="portal-rem-filtros">
                    <label className="portal-rem-busca">
                      <Icone nome="busca" tamanho={18} />
                      <input
                        type="search"
                        placeholder="Buscar produto"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                      />
                    </label>
                    <div className="portal-rem-chips">
                      <button
                        type="button"
                        className={categoria === '' ? 'portal-rem-chip portal-rem-chip-ativo' : 'portal-rem-chip'}
                        aria-pressed={categoria === ''}
                        onClick={() => setCategoria('')}
                      >
                        Todas
                      </button>
                      {categorias.map((nome) => (
                        <button
                          key={nome}
                          type="button"
                          className={categoria === nome ? 'portal-rem-chip portal-rem-chip-ativo' : 'portal-rem-chip'}
                          aria-pressed={categoria === nome}
                          onClick={() => setCategoria(nome)}
                        >
                          {nome}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filtrados.length === 0 ? (
                    <p className="portal-rem-vazio">Nenhum produto encontrado.</p>
                  ) : (
                    <div className="portal-rem-grade">{filtrados.map(renderCartao)}</div>
                  )}
                </section>

                <aside className={revisando ? 'portal-rem-pedido portal-rem-pedido-aberto' : 'portal-rem-pedido'}>
                  <div className="portal-rem-pedido-topo">
                    <h2 className="portal-rem-titulo">
                      Seu pedido {itens.length > 0 && <span className="portal-rem-suave">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>}
                    </h2>
                    <button
                      type="button"
                      className="portal-rem-redondo portal-rem-redondo-claro portal-rem-so-celular"
                      aria-label="Fechar pedido"
                      onClick={() => setRevisando(false)}
                    >
                      <Icone nome="fechar" tamanho={18} />
                    </button>
                  </div>

                  {itens.length === 0 ? (
                    <p className="portal-rem-suave">Escolha produtos ao lado para montar o pedido.</p>
                  ) : (
                    <ul className="portal-rem-itens">
                      {itens.map(({ produto, quantidade }) => (
                        <li key={produto.id} className="portal-rem-item">
                          <div className="portal-rem-item-foto">
                            <FotoProduto foto={produto.foto} nome={produto.nome} setor={produto.categoria} tamanho={48} />
                          </div>
                          <div className="portal-rem-item-texto">
                            <strong>{produto.nome}</strong>
                            <span className="portal-rem-suave">
                              {formatarMoeda(produto.preco)} por {produto.unidade.toLowerCase()}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="portal-rem-remover"
                            aria-label={`Remover ${produto.nome}`}
                            onClick={() => definirQuantidade(produto.id, 0)}
                          >
                            <Icone nome="lixeira" tamanho={16} />
                          </button>
                          <div className="portal-rem-item-seletor">
                            <Seletor
                              quantidade={quantidade}
                              unidade={produto.unidade}
                              nome={produto.nome}
                              aoMudar={(n) => definirQuantidade(produto.id, n)}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    className="portal-rem-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void enviarPedido();
                    }}
                  >
                    <Selecao
                      rotulo="Loja que envia"
                      valor={lojaSelecionada}
                      aoMudar={setLojaEscolhida}
                      opcoes={lojas.map((l) => ({ valor: String(l.id), rotulo: l.nome }))}
                      vazio="Escolha a loja"
                      obrigatorio
                    />
                    {lojaAtual?.endereco && <p className="portal-rem-suave">{lojaAtual.endereco}</p>}

                    <Selecao
                      rotulo="Tipo"
                      valor={tipo}
                      aoMudar={setTipo}
                      opcoes={TIPOS_PEDIDO.map((t) => ({ valor: t, rotulo: ROTULOS_TIPO[t] }))}
                    />

                    <Campo
                      tipo="date"
                      rotulo="Quero receber em"
                      valor={dataDesejada}
                      aoMudar={setDataDesejada}
                    />

                    <AreaTexto rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} linhas={2} />

                    <div className="portal-rem-total">
                      <span>Valor de referência</span>
                      <strong>{formatarMoeda(total)}</strong>
                    </div>

                    {erroPedido && <Aviso tipo="erro">{erroPedido}</Aviso>}

                    <button type="submit" className="portal-rem-botao" disabled={enviando || itens.length === 0}>
                      {enviando ? 'Enviando...' : 'Enviar pedido'}
                    </button>
                  </form>
                </aside>
              </div>
            )}

            {aba === 'posse' && (
              <div className="portal-rem-secoes">
                <section className="portal-rem-cartao">
                  <h2 className="portal-rem-titulo">Produtos em sua posse</h2>
                  {dados.emPosse.length === 0 ? (
                    <p className="portal-rem-vazio">Nada em sua posse agora.</p>
                  ) : (
                    <ul className="portal-rem-lista">
                      {dados.emPosse.map((i) => (
                        <li key={i.produtoId} className="portal-rem-linha">
                          <FotoProduto foto={i.foto} nome={i.nome} tamanho={44} />
                          <span className="portal-rem-linha-texto">
                            <strong>{i.nome}</strong>
                          </span>
                          <span className="portal-rem-numero">{formatarQuantidade(i.quantidade, i.unidade)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {dados.remessasAbertas.length > 0 && (
                  <section>
                    <h2 className="portal-rem-titulo">Remessas abertas</h2>
                    <div className="portal-rem-grade-cartoes">
                      {dados.remessasAbertas.map((r) => {
                        const n = contarItens(r.itens);
                        return (
                          <article key={r.numero} className="portal-rem-card-remessa">
                            <div className="portal-rem-card-topo">
                              <strong>Remessa nº {r.numero}</strong>
                              <Selo cor={COR_TIPO[r.tipo]}>{ROTULOS_TIPO[r.tipo]}</Selo>
                            </div>
                            <span className="portal-rem-suave">Enviada em {formatarData(r.criadoEm)}</span>
                            <span className="portal-rem-suave">
                              Previsão de retorno: {r.previsaoRetorno ? formatarData(r.previsaoRetorno) : 'não informada'}
                            </span>
                            <span className="portal-rem-suave">
                              {n} {n === 1 ? 'item' : 'itens'}
                            </span>
                            {r.atrasada && <Selo cor="vermelho">Atrasada</Selo>}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}

            {aba === 'pedidos' && (
              <div className="portal-rem-secoes">
                {pendentes > 0 && (
                  <div>
                    <Selo cor="amarelo">
                      {pendentes} {pendentes === 1 ? 'pendente' : 'pendentes'}
                    </Selo>
                  </div>
                )}
                {erroPedidos && <Aviso tipo="erro">{erroPedidos}</Aviso>}
                {dados.pedidos.length === 0 ? (
                  <p className="portal-rem-vazio">Você ainda não fez pedidos.</p>
                ) : (
                  <div className="portal-rem-grade-cartoes">
                    {dados.pedidos.map((p) => {
                      const info = STATUS_PEDIDO[p.status];
                      const rotuloStatus =
                        p.status === 'APROVADO' && p.remessaNumero != null
                          ? `Aprovado · remessa nº ${p.remessaNumero}`
                          : info.rotulo;
                      // Pedido aprovado com quantidade enviada informada: mostra "pedido · enviado"; zero, "não enviado".
                      const linhaItem = (i: ItemPedidoPortal): ReactNode => {
                        const pedido = formatarQuantidade(i.quantidade, i.unidade);
                        const enviada = i.quantidadeEnviada;
                        if (p.status === 'APROVADO' && typeof enviada === 'number') {
                          if (enviada === 0) return <span className="portal-rem-cinza">não enviado</span>;
                          if (enviada !== i.quantidade) {
                            return `${pedido} pedidos · ${formatarQuantidade(enviada, i.unidade)} enviados`;
                          }
                        }
                        return pedido;
                      };
                      const resumo = p.itens.length > 0;
                      return (
                        <article key={p.id} className="portal-rem-card-pedido">
                          <div className="portal-rem-card-topo">
                            <strong>Pedido nº {p.numero}</strong>
                            <Selo cor={info.cor}>{rotuloStatus}</Selo>
                          </div>
                          <span className="portal-rem-suave">
                            Feito em {formatarData(p.criadoEm)}
                            {p.dataDesejada ? ` · receber em ${formatarData(p.dataDesejada)}` : ''}
                          </span>
                          {p.status === 'RECUSADO' && p.motivoRecusa && (
                            <p className="portal-rem-motivo">Motivo: {p.motivoRecusa}</p>
                          )}
                          {resumo && (
                            <ul className="portal-rem-resumo">
                              {p.itens.map((i, idx) => (
                                <li key={`${i.nome}-${idx}`}>
                                  {i.nome}: {linhaItem(i)}
                                </li>
                              ))}
                            </ul>
                          )}

                          {p.status === 'PENDENTE' &&
                            (confirmandoId === p.id ? (
                              <div className="portal-rem-acoes">
                                <button
                                  type="button"
                                  className="portal-rem-botao-perigo"
                                  disabled={cancelando}
                                  onClick={() => void cancelarPedido(p.id)}
                                >
                                  {cancelando ? 'Cancelando...' : 'Confirmar cancelamento'}
                                </button>
                                <button
                                  type="button"
                                  className="portal-rem-botao-secundario"
                                  disabled={cancelando}
                                  onClick={() => setConfirmandoId(null)}
                                >
                                  Voltar
                                </button>
                              </div>
                            ) : (
                              <div className="portal-rem-acoes">
                                <button
                                  type="button"
                                  className="portal-rem-botao-secundario"
                                  onClick={() => setConfirmandoId(p.id)}
                                >
                                  Cancelar pedido
                                </button>
                              </div>
                            ))}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {dados && aba === 'pedir' && itens.length > 0 && !revisando && (
        <div className="portal-rem-barra">
          <button type="button" className="portal-rem-barra-botao" onClick={() => setRevisando(true)}>
            <span>
              {itens.length} {itens.length === 1 ? 'item' : 'itens'} · Revisar pedido
            </span>
            <strong>{formatarMoeda(total)}</strong>
          </button>
        </div>
      )}

      {revisando && <div className="portal-rem-fundo" onClick={() => setRevisando(false)} aria-hidden="true" />}
    </div>
  );
}
