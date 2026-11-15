import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { usePlataforma } from '../../lib/plataforma';
import { useTema } from '../../lib/tema';
import { Aviso, Campo, Carregando, Modal, Selecao, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { CatalogoDelivery, ProdutoDelivery } from './tipos';
import { FORMAS_DELIVERY } from './tipos';
import './pedir.css';

// Pedido para entrega (página pública, sem login).
// Celular (< 900 px): topo em degradê, ofertas, busca e categorias fixas, ficha do produto em folha
// inferior e carrinho em tela cheia com as etapas do pedido.
// PC (>= 900 px): loja online com categorias à esquerda, grade de produtos e carrinho fixo à direita.

type Forma = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
type Etapa = 'itens' | 'dados' | 'endereco' | 'pagamento' | 'confirmar';
type Parte = 'itens' | 'dados' | 'endereco';

interface Dados {
  nome: string;
  telefone: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  complemento: string;
  forma: Forma;
  trocoPara: string;
  observacao: string;
}

type Atualizar = <K extends keyof Dados>(campo: K, valor: Dados[K]) => void;

interface PedidoCriado {
  codigo: string;
  total: number;
}

interface ItemCarrinho {
  produto: ProdutoDelivery;
  quantidade: number;
}

const DADOS_INICIAIS: Dados = {
  nome: '',
  telefone: '',
  endereco: '',
  numero: '',
  bairro: '',
  cidade: '',
  complemento: '',
  forma: 'PIX',
  trocoPara: '',
  observacao: '',
};

const ORDEM_ETAPAS: Etapa[] = ['itens', 'dados', 'endereco', 'pagamento', 'confirmar'];

const TITULO_ETAPA: Record<Etapa, string> = {
  itens: 'Seu pedido',
  dados: 'Seus dados',
  endereco: 'Endereço de entrega',
  pagamento: 'Pagamento',
  confirmar: 'Confirmar pedido',
};

const CHAVE_CARRINHO = 'mercado.pedir.carrinho';
const MEDIA_CELULAR = '(max-width: 899px)';

function arred3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function precoDoProduto(p: ProdutoDelivery): number {
  return p.precoPromocional ?? p.preco;
}

function temPromocao(p: ProdutoDelivery): boolean {
  return p.precoPromocional != null;
}

function passoDe(p: ProdutoDelivery): number {
  return p.pesavel ? 0.5 : 1;
}

function textoNumero(n: number): string {
  return String(n).replace('.', ',');
}

function lerCarrinho(): Record<number, number> {
  try {
    const bruto = window.localStorage.getItem(CHAVE_CARRINHO);
    if (!bruto) return {};
    const lido = JSON.parse(bruto) as Record<string, unknown>;
    const limpo: Record<number, number> = {};
    for (const [id, qtd] of Object.entries(lido)) {
      const n = Number(qtd);
      if (Number.isFinite(n) && n > 0) limpo[Number(id)] = arred3(n);
    }
    return limpo;
  } catch {
    // Sem armazenamento (modo privado ou bloqueado): o carrinho começa vazio.
    return {};
  }
}

function gravarCarrinho(carrinho: Record<number, number>): void {
  try {
    window.localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(carrinho));
  } catch {
    // Sem armazenamento: o carrinho continua valendo só nesta tela.
  }
}

function usarCelular(): boolean {
  const suportado = typeof window.matchMedia === 'function';
  const [celular, setCelular] = useState(() => suportado && window.matchMedia(MEDIA_CELULAR).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia(MEDIA_CELULAR);
    const ouvir = () => setCelular(consulta.matches);
    consulta.addEventListener('change', ouvir);
    return () => consulta.removeEventListener('change', ouvir);
  }, []);
  return celular;
}

// Seletor − quantidade +. Com `editavel`, a quantidade também pode ser digitada.
function Seletor({
  quantidade,
  produto,
  aoMudar,
  grande = false,
  editavel = false,
}: {
  quantidade: number;
  produto: ProdutoDelivery;
  aoMudar: (nova: number) => void;
  grande?: boolean;
  editavel?: boolean;
}) {
  const passo = passoDe(produto);
  const [texto, setTexto] = useState(textoNumero(quantidade));

  useEffect(() => {
    setTexto(textoNumero(quantidade));
  }, [quantidade]);

  function confirmarTexto() {
    const n = Number(texto.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) aoMudar(n);
    else setTexto(textoNumero(quantidade));
  }

  return (
    <div
      className={grande ? 'pedir-seletor pedir-seletor-grande' : 'pedir-seletor'}
      role="group"
      aria-label={`Quantidade de ${produto.nome}`}
    >
      <button type="button" onClick={() => aoMudar(arred3(quantidade - passo))} aria-label="Diminuir">
        −
      </button>
      {editavel ? (
        <input
          className="pedir-qtd-campo"
          type="text"
          inputMode="decimal"
          value={texto}
          aria-label={`Quantidade de ${produto.nome}`}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmarTexto}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') confirmarTexto();
          }}
        />
      ) : (
        <span className="pedir-seletor-valor">{formatarQuantidade(quantidade, produto.unidade)}</span>
      )}
      <button type="button" onClick={() => aoMudar(arred3(quantidade + passo))} aria-label="Aumentar">
        +
      </button>
    </div>
  );
}

// Preço atual; com promoção, mostra o normal riscado antes.
function PrecoBloco({ produto }: { produto: ProdutoDelivery }) {
  const promo = temPromocao(produto);
  return (
    <span className="pedir-preco">
      {promo && <s className="pedir-preco-antigo">{formatarMoeda(produto.preco)}</s>}
      <strong>{formatarMoeda(precoDoProduto(produto))}</strong>
    </span>
  );
}

// Ficha do produto: foto grande, quantidade e botão de adicionar. Usada na folha (celular) e no modal (PC).
function FichaProduto({
  produto,
  setor,
  noPedido,
  aoConfirmar,
}: {
  produto: ProdutoDelivery;
  setor: string | null;
  noPedido: number;
  aoConfirmar: (quantidade: number) => void;
}) {
  const [qtd, setQtd] = useState(noPedido > 0 ? noPedido : passoDe(produto));
  const unidade = produto.unidade.toLowerCase();
  return (
    <div className="pedir-ficha">
      <FotoProduto foto={produto.foto} nome={produto.nome} setor={setor} preencher className="pedir-ficha-foto" />
      <div className="pedir-ficha-corpo">
        <h3 className="pedir-ficha-nome">{produto.nome}</h3>
        {temPromocao(produto) && produto.descricaoPromocao && (
          <span className="pedir-selo-promo">{produto.descricaoPromocao}</span>
        )}
        <p className="pedir-ficha-preco">
          <PrecoBloco produto={produto} /> <span className="pedir-suave">por {unidade}</span>
        </p>
        <p className="pedir-suave">
          {produto.pesavel ? `Vendido por peso, de 0,5 em 0,5 ${unidade}.` : 'Vendido por unidade.'}
        </p>
        <div className="pedir-ficha-linha">
          <span>Quantidade</span>
          <Seletor
            quantidade={qtd}
            produto={produto}
            aoMudar={(n) => setQtd(Math.max(0, arred3(n)))}
            grande
          />
        </div>
      </div>
      <div className="pedir-ficha-rodape">
        <button
          type="button"
          className="pedir-botao-principal"
          disabled={qtd <= 0}
          onClick={() => aoConfirmar(qtd)}
        >
          {noPedido > 0 ? 'Atualizar no pedido' : 'Adicionar ao pedido'} · {formatarMoeda(precoDoProduto(produto) * qtd)}
        </button>
      </div>
    </div>
  );
}

function ItensCarrinho({
  itens,
  editavel,
  setorDe,
  aoMudar,
}: {
  itens: ItemCarrinho[];
  editavel: boolean;
  setorDe: (p: ProdutoDelivery) => string | null;
  aoMudar: (produtoId: number, quantidade: number) => void;
}) {
  return (
    <ul className="pedir-itens">
      {itens.map(({ produto, quantidade }) => (
        <li key={produto.produtoId} className="pedir-item">
          <FotoProduto foto={produto.foto} nome={produto.nome} setor={setorDe(produto)} tamanho={56} />
          <div className="pedir-item-texto">
            <strong>{produto.nome}</strong>
            <span className="pedir-suave">
              {formatarMoeda(precoDoProduto(produto))} por {produto.unidade.toLowerCase()}
            </span>
            <span className="pedir-item-subtotal">{formatarMoeda(precoDoProduto(produto) * quantidade)}</span>
          </div>
          <Seletor
            quantidade={quantidade}
            produto={produto}
            aoMudar={(n) => aoMudar(produto.produtoId, n)}
            editavel={editavel}
          />
        </li>
      ))}
    </ul>
  );
}

function Totais({ subtotal, taxa }: { subtotal: number; taxa: number }) {
  return (
    <div className="pedir-totais">
      <span>Subtotal</span>
      <strong>{formatarMoeda(subtotal)}</strong>
      <span>Entrega</span>
      <strong>{formatarMoeda(taxa)}</strong>
      <span className="pedir-total-final">Total</span>
      <strong className="pedir-total-final">{formatarMoeda(subtotal + taxa)}</strong>
    </div>
  );
}

function CamposDados({ dados, atualizar }: { dados: Dados; atualizar: Atualizar }) {
  return (
    <div className="pedir-campos">
      <Campo rotulo="Seu nome" valor={dados.nome} aoMudar={(v) => atualizar('nome', v)} obrigatorio />
      <Campo
        rotulo="Telefone (WhatsApp)"
        valor={dados.telefone}
        aoMudar={(v) => atualizar('telefone', v)}
        obrigatorio
      />
    </div>
  );
}

function CamposEndereco({ dados, atualizar }: { dados: Dados; atualizar: Atualizar }) {
  return (
    <div className="pedir-campos">
      <Campo rotulo="Endereço" valor={dados.endereco} aoMudar={(v) => atualizar('endereco', v)} obrigatorio />
      <div className="pedir-campos-duplo">
        <Campo rotulo="Número" valor={dados.numero} aoMudar={(v) => atualizar('numero', v)} obrigatorio />
        <Campo rotulo="Bairro" valor={dados.bairro} aoMudar={(v) => atualizar('bairro', v)} obrigatorio />
      </div>
      <Campo rotulo="Cidade" valor={dados.cidade} aoMudar={(v) => atualizar('cidade', v)} />
      <Campo rotulo="Complemento" valor={dados.complemento} aoMudar={(v) => atualizar('complemento', v)} />
    </div>
  );
}

function CamposPagamento({ dados, atualizar }: { dados: Dados; atualizar: Atualizar }) {
  return (
    <div className="pedir-campos">
      <Selecao
        rotulo="Forma de pagamento (na entrega)"
        valor={dados.forma}
        aoMudar={(v) => atualizar('forma', v as Forma)}
        opcoes={FORMAS_DELIVERY}
      />
      {dados.forma === 'DINHEIRO' && (
        <Campo rotulo="Troco para quanto?" valor={dados.trocoPara} aoMudar={(v) => atualizar('trocoPara', v)} />
      )}
      <Campo rotulo="Observação" valor={dados.observacao} aoMudar={(v) => atualizar('observacao', v)} />
    </div>
  );
}

function Confirmacao({ pedido, aoNovo }: { pedido: PedidoCriado; aoNovo: () => void }) {
  return (
    <div className="pedir pedir-confirmacao">
      <div className="pedir-confirmacao-cartao">
        <span className="pedir-confirmacao-icone">
          <Icone nome="visto" tamanho={32} />
        </span>
        <h1>Pedido recebido!</h1>
        <p className="pedir-suave">Guarde o código para acompanhar a entrega:</p>
        <p className="pedir-codigo">{pedido.codigo}</p>
        <p className="pedir-suave">Total: {formatarMoeda(pedido.total)}</p>
        <Link className="pedir-botao-principal pedir-link" to={`/rastreio/${pedido.codigo}`}>
          Acompanhar entrega
        </Link>
        <button type="button" className="pedir-botao-texto" onClick={aoNovo}>
          Fazer outro pedido
        </button>
      </div>
    </div>
  );
}

export function Pedir() {
  const [params] = useSearchParams();
  const loja = params.get('loja');
  const sufixoLoja = loja ? `?loja=${encodeURIComponent(loja)}` : '';
  const { plataforma, logoSrc } = usePlataforma();
  const { temaEfetivo, alternar } = useTema();
  const celular = usarCelular();

  const [catalogo, setCatalogo] = useState<CatalogoDelivery | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  // PC: filtra a grade. Celular: a categoria tocada rola a página até a seção.
  const [categoriaId, setCategoriaId] = useState<number | 'todas'>('todas');
  const [carrinho, setCarrinho] = useState<Record<number, number>>(lerCarrinho);
  const [fichaId, setFichaId] = useState<number | null>(null);
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [dados, setDados] = useState<Dados>(DADOS_INICIAIS);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [pedidoCriado, setPedidoCriado] = useState<PedidoCriado | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    api
      .get<CatalogoDelivery>(`/publico/delivery/catalogo${sufixoLoja}`)
      .then((c) => {
        if (!cancelado) setCatalogo(c);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [sufixoLoja]);

  useEffect(() => {
    gravarCarrinho(carrinho);
  }, [carrinho]);

  const atualizar: Atualizar = (campo, valor) => setDados((d) => ({ ...d, [campo]: valor }));

  const produtos = useMemo(() => catalogo?.produtos ?? [], [catalogo]);

  const produtosPorId = useMemo(() => {
    const mapa = new Map<number, ProdutoDelivery>();
    for (const p of produtos) mapa.set(p.produtoId, p);
    return mapa;
  }, [produtos]);

  const nomesCategoria = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const c of catalogo?.categorias ?? []) mapa.set(c.id, c.nome);
    return mapa;
  }, [catalogo]);

  function setorDe(p: ProdutoDelivery): string | null {
    if (p.categoriaId == null) return null;
    return nomesCategoria.get(p.categoriaId) ?? null;
  }

  const termo = busca.trim().toLowerCase();

  const filtrados = useMemo(
    () => produtos.filter((p) => termo === '' || p.nome.toLowerCase().includes(termo)),
    [produtos, termo],
  );

  const ofertas = useMemo(() => filtrados.filter(temPromocao), [filtrados]);

  // Celular: uma seção por categoria, com os produtos sem categoria conhecida em "Outros".
  const secoes = useMemo(() => {
    const categorias = catalogo?.categorias ?? [];
    const conhecidas = new Set(categorias.map((c) => c.id));
    const grupos = categorias.map((c) => ({
      chave: String(c.id),
      nome: c.nome,
      produtos: filtrados.filter((p) => p.categoriaId === c.id),
    }));
    const outros = filtrados.filter((p) => p.categoriaId == null || !conhecidas.has(p.categoriaId));
    if (outros.length > 0) grupos.push({ chave: 'outros', nome: 'Outros', produtos: outros });
    return grupos.filter((g) => g.produtos.length > 0);
  }, [catalogo, filtrados]);

  // PC: grade filtrada pela categoria escolhida na coluna da esquerda.
  const grade = useMemo(
    () => (categoriaId === 'todas' ? filtrados : filtrados.filter((p) => p.categoriaId === categoriaId)),
    [filtrados, categoriaId],
  );

  const nomeCategoriaAtiva = categoriaId === 'todas' ? 'Todos os produtos' : (nomesCategoria.get(categoriaId) ?? 'Produtos');

  const itensCarrinho: ItemCarrinho[] = Object.entries(carrinho)
    .map(([id, qtd]) => ({ produto: produtosPorId.get(Number(id)), quantidade: qtd }))
    .filter((i): i is ItemCarrinho => !!i.produto && i.quantidade > 0);

  const subtotal = itensCarrinho.reduce((s, i) => s + precoDoProduto(i.produto) * i.quantidade, 0);
  const taxa = catalogo?.taxa ?? 0;
  const minimo = catalogo?.pedidoMinimo ?? 0;
  const abaixoDoMinimo = subtotal < minimo;
  const aberto = catalogo?.ativo ?? false;
  const totalPedido = subtotal + taxa;
  const statusTexto = catalogo ? (aberto ? 'Aceitando pedidos' : 'Delivery indisponível') : 'Carregando';

  function quantidadeNoCarrinho(produtoId: number): number {
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

  function ajustar(produto: ProdutoDelivery, delta: number) {
    definirQuantidade(produto.produtoId, quantidadeNoCarrinho(produto.produtoId) + delta * passoDe(produto));
  }

  function abrirFicha(produto: ProdutoDelivery) {
    setFichaId(produto.produtoId);
  }

  function fecharFicha() {
    setFichaId(null);
  }

  function confirmarFicha(produto: ProdutoDelivery, quantidade: number) {
    definirQuantidade(produto.produtoId, quantidade);
    setFichaId(null);
  }

  function irPara(destino: number | 'todas') {
    setCategoriaId(destino);
    const alvo =
      destino === 'todas' ? document.getElementById('pedir-topo') : document.getElementById(`pedir-sec-${destino}`);
    alvo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function problemaEm(parte: Parte): string | null {
    if (parte === 'itens') {
      if (itensCarrinho.length === 0) return 'Escolha ao menos um produto.';
      if (abaixoDoMinimo) return `O pedido mínimo é ${formatarMoeda(minimo)}.`;
      return null;
    }
    if (parte === 'dados') {
      return dados.nome.trim() && dados.telefone.trim() ? null : 'Informe seu nome e telefone.';
    }
    return dados.endereco.trim() && dados.numero.trim() && dados.bairro.trim()
      ? null
      : 'Informe endereço, número e bairro.';
  }

  function avancar() {
    if (etapa === null) return;
    const parte = etapa === 'itens' || etapa === 'dados' || etapa === 'endereco' ? etapa : null;
    const problema = parte ? problemaEm(parte) : null;
    if (problema) {
      setErroEnvio(problema);
      return;
    }
    setErroEnvio(null);
    const proxima = ORDEM_ETAPAS[ORDEM_ETAPAS.indexOf(etapa) + 1];
    if (proxima) setEtapa(proxima);
  }

  function voltar() {
    if (etapa === null) return;
    setErroEnvio(null);
    const i = ORDEM_ETAPAS.indexOf(etapa);
    setEtapa(i <= 0 ? null : ORDEM_ETAPAS[i - 1]);
  }

  async function enviar() {
    const problema = problemaEm('itens') ?? problemaEm('dados') ?? problemaEm('endereco');
    if (problema) {
      setErroEnvio(problema);
      return;
    }
    const troco = dados.forma === 'DINHEIRO' ? lerNumero(dados.trocoPara) : null;
    setErroEnvio(null);
    setEnviando(true);
    try {
      const resposta = await api.post<PedidoCriado>(`/publico/delivery/pedidos${sufixoLoja}`, {
        nome: dados.nome.trim(),
        telefone: dados.telefone.trim(),
        endereco: dados.endereco.trim(),
        numero: dados.numero.trim(),
        bairro: dados.bairro.trim(),
        cidade: dados.cidade.trim() || null,
        complemento: dados.complemento.trim() || null,
        formaPagamento: dados.forma,
        trocoPara: troco && troco > 0 ? troco : null,
        itens: itensCarrinho.map((i) => ({ produtoId: i.produto.produtoId, quantidade: i.quantidade })),
        observacao: dados.observacao.trim() || null,
      });
      setPedidoCriado(resposta);
      setCarrinho({});
      setEtapa(null);
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  function renderCartaoPc(p: ProdutoDelivery) {
    const qtd = quantidadeNoCarrinho(p.produtoId);
    return (
      <article key={p.produtoId} className="pedir-pc-card">
        <button type="button" className="pedir-pc-card-abrir" onClick={() => abrirFicha(p)}>
          <FotoProduto foto={p.foto} nome={p.nome} setor={setorDe(p)} preencher />
          <span className="pedir-pc-card-nome">{p.nome}</span>
          {temPromocao(p) && p.descricaoPromocao && <span className="pedir-selo-promo">{p.descricaoPromocao}</span>}
        </button>
        <div className="pedir-pc-card-rodape">
          <span className="pedir-pc-card-preco">
            <PrecoBloco produto={p} />
            <span className="pedir-suave">por {p.unidade.toLowerCase()}</span>
          </span>
          {qtd === 0 ? (
            <button type="button" className="pedir-add" disabled={!aberto} onClick={() => ajustar(p, 1)}>
              Adicionar
            </button>
          ) : (
            <Seletor quantidade={qtd} produto={p} aoMudar={(n) => definirQuantidade(p.produtoId, n)} />
          )}
        </div>
      </article>
    );
  }

  if (pedidoCriado) {
    return <Confirmacao pedido={pedidoCriado} aoNovo={() => setPedidoCriado(null)} />;
  }

  const nomeEmpresa = catalogo?.empresa ?? plataforma.nome;
  const fichaProduto = fichaId != null ? (produtosPorId.get(fichaId) ?? null) : null;
  const iconeTema = temaEfetivo === 'escuro' ? 'sol' : 'lua';

  if (celular) {
    return (
      <div className="pedir pedir-cel">
        <header className="pedir-cel-topo" id="pedir-topo">
          <div className="pedir-marca">
            <img className="pedir-logo" src={logoSrc} alt="" />
            <div className="pedir-marca-texto">
              <h1>{nomeEmpresa}</h1>
              <p>Compras com entrega em casa</p>
            </div>
          </div>
          <button type="button" className="pedir-redondo" onClick={alternar} aria-label="Trocar tema">
            <Icone nome={iconeTema} tamanho={20} />
          </button>
        </header>

        {erro && (
          <div className="pedir-cel-bloco">
            <Aviso tipo="erro">{erro}</Aviso>
          </div>
        )}
        {carregando && !catalogo && <Carregando />}

        {catalogo && (
          <>
            <div className="pedir-cel-cartao">
              <div className="pedir-cel-linha">
                <span className="pedir-info">
                  <Icone nome="relogio" tamanho={18} /> Entrega em cerca de 50 min
                </span>
                <span className={aberto ? 'pedir-status pedir-status-aberto' : 'pedir-status pedir-status-fechado'}>
                  {statusTexto}
                </span>
              </div>
              <div className="pedir-cel-linha pedir-suave">
                <span>Entrega {formatarMoeda(taxa)}</span>
                <span>Pedido mínimo {formatarMoeda(minimo)}</span>
              </div>
            </div>

            {!aberto && (
              <div className="pedir-cel-bloco">
                <Aviso tipo="info">O delivery não está disponível agora. Tente mais tarde.</Aviso>
              </div>
            )}

            {ofertas.length > 0 && (
              <section className="pedir-cel-bloco">
                <h2 className="pedir-titulo">
                  <Icone nome="estrela" tamanho={18} /> Ofertas da semana
                </h2>
                <div className="pedir-faixa-caixa">
                  <div className="pedir-faixa">
                    {ofertas.map((p) => (
                      <button key={p.produtoId} type="button" className="pedir-oferta" onClick={() => abrirFicha(p)}>
                        <FotoProduto foto={p.foto} nome={p.nome} setor={setorDe(p)} preencher />
                        <span className="pedir-oferta-nome">{p.nome}</span>
                        <PrecoBloco produto={p} />
                      </button>
                    ))}
                  </div>
                  <span className="pedir-faixa-seta" aria-hidden="true">
                    <Icone nome="seta-direita" tamanho={18} />
                  </span>
                </div>
                <p className="pedir-faixa-dica">Arraste para o lado para ver mais →</p>
              </section>
            )}

            <div className="pedir-cel-filtros">
              <label className="pedir-busca">
                <Icone nome="busca" tamanho={18} />
                <input
                  type="search"
                  placeholder="Buscar produto"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </label>
              <div className="pedir-chips">
                <button
                  type="button"
                  className={categoriaId === 'todas' ? 'pedir-chip pedir-chip-ativo' : 'pedir-chip'}
                  aria-pressed={categoriaId === 'todas'}
                  onClick={() => irPara('todas')}
                >
                  Todos
                </button>
                {catalogo.categorias.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={categoriaId === c.id ? 'pedir-chip pedir-chip-ativo' : 'pedir-chip'}
                    aria-pressed={categoriaId === c.id}
                    onClick={() => irPara(c.id)}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>

            {secoes.length === 0 && <p className="pedir-vazio">Nenhum produto encontrado.</p>}

            {secoes.map((g) => (
              <section key={g.chave} id={`pedir-sec-${g.chave}`} className="pedir-cel-bloco pedir-secao">
                <h2 className="pedir-titulo">{g.nome}</h2>
                <div className="pedir-cel-lista">
                  {g.produtos.map((p) => {
                    const qtd = quantidadeNoCarrinho(p.produtoId);
                    return (
                      <article key={p.produtoId} className="pedir-cel-produto">
                        <div className="pedir-cel-texto">
                          <button type="button" className="pedir-cel-abrir" onClick={() => abrirFicha(p)}>
                            <strong className="pedir-cel-nome">{p.nome}</strong>
                            {temPromocao(p) && p.descricaoPromocao && (
                              <span className="pedir-selo-promo">{p.descricaoPromocao}</span>
                            )}
                            <PrecoBloco produto={p} />
                            <span className="pedir-suave">por {p.unidade.toLowerCase()}</span>
                          </button>
                          <div className="pedir-cel-acao">
                            {qtd === 0 ? (
                              <button
                                type="button"
                                className="pedir-add"
                                disabled={!aberto}
                                onClick={() => ajustar(p, 1)}
                              >
                                + Adicionar
                              </button>
                            ) : (
                              <Seletor quantidade={qtd} produto={p} aoMudar={(n) => definirQuantidade(p.produtoId, n)} />
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="pedir-cel-foto"
                          tabIndex={-1}
                          aria-hidden="true"
                          onClick={() => abrirFicha(p)}
                        >
                          <FotoProduto foto={p.foto} nome={p.nome} setor={setorDe(p)} tamanho={96} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            {itensCarrinho.length > 0 && !etapa && (
              <div className="pedir-barra">
                <button type="button" className="pedir-barra-botao" onClick={() => setEtapa('itens')}>
                  <span>
                    Ver carrinho ({itensCarrinho.length} {itensCarrinho.length === 1 ? 'item' : 'itens'})
                  </span>
                  <strong>{formatarMoeda(totalPedido)}</strong>
                </button>
              </div>
            )}

            {fichaProduto && (
              <div className="pedir-folha-fundo" onClick={fecharFicha}>
                <div
                  className="pedir-folha"
                  role="dialog"
                  aria-modal="true"
                  aria-label={fichaProduto.nome}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="pedir-folha-topo">
                    <span className="pedir-folha-alca" aria-hidden="true" />
                    <button
                      type="button"
                      className="pedir-redondo pedir-redondo-escuro"
                      aria-label="Fechar"
                      onClick={fecharFicha}
                    >
                      <Icone nome="fechar" tamanho={18} />
                    </button>
                  </div>
                  <FichaProduto
                    key={fichaProduto.produtoId}
                    produto={fichaProduto}
                    setor={setorDe(fichaProduto)}
                    noPedido={quantidadeNoCarrinho(fichaProduto.produtoId)}
                    aoConfirmar={(q) => confirmarFicha(fichaProduto, q)}
                  />
                </div>
              </div>
            )}

            {etapa && (
              <form
                className="pedir-tela"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (etapa === 'confirmar') void enviar();
                  else avancar();
                }}
              >
                <header className="pedir-tela-topo">
                  <button
                    type="button"
                    className="pedir-redondo pedir-redondo-escuro"
                    onClick={voltar}
                    aria-label="Voltar"
                  >
                    <Icone nome="seta-esquerda" tamanho={18} />
                  </button>
                  <div>
                    <h2>{TITULO_ETAPA[etapa]}</h2>
                    <span className="pedir-suave">
                      Passo {ORDEM_ETAPAS.indexOf(etapa) + 1} de {ORDEM_ETAPAS.length}
                    </span>
                  </div>
                </header>

                <div className="pedir-tela-corpo">
                  {etapa === 'itens' &&
                    (itensCarrinho.length === 0 ? (
                      <p className="pedir-vazio">Seu carrinho está vazio.</p>
                    ) : (
                      <ItensCarrinho itens={itensCarrinho} editavel={false} setorDe={setorDe} aoMudar={definirQuantidade} />
                    ))}
                  {etapa === 'dados' && <CamposDados dados={dados} atualizar={atualizar} />}
                  {etapa === 'endereco' && <CamposEndereco dados={dados} atualizar={atualizar} />}
                  {etapa === 'pagamento' && <CamposPagamento dados={dados} atualizar={atualizar} />}
                  {etapa === 'confirmar' && (
                    <>
                      <div className="pedir-resumo">
                        <p>
                          <strong>{dados.nome}</strong> · {dados.telefone}
                        </p>
                        <p>
                          {dados.endereco}, {dados.numero} · {dados.bairro}
                          {dados.cidade ? ` · ${dados.cidade}` : ''}
                        </p>
                        <p>
                          {FORMAS_DELIVERY.find((f) => f.valor === dados.forma)?.rotulo ?? dados.forma}
                        </p>
                      </div>
                      <ItensCarrinho itens={itensCarrinho} editavel={false} setorDe={setorDe} aoMudar={definirQuantidade} />
                    </>
                  )}

                  {(etapa === 'itens' || etapa === 'confirmar') && (
                    <>
                      <Totais subtotal={subtotal} taxa={taxa} />
                      {abaixoDoMinimo && itensCarrinho.length > 0 && (
                        <Aviso tipo="info">
                          Faltam {formatarMoeda(minimo - subtotal)} para o pedido mínimo de {formatarMoeda(minimo)}.
                        </Aviso>
                      )}
                    </>
                  )}

                  {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
                </div>

                <footer className="pedir-tela-rodape">
                  {etapa === 'confirmar' ? (
                    <button
                      type="submit"
                      className="pedir-botao-principal"
                      disabled={enviando || !aberto || abaixoDoMinimo || itensCarrinho.length === 0}
                    >
                      {enviando ? 'Enviando...' : `Confirmar pedido · ${formatarMoeda(totalPedido)}`}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="pedir-botao-principal"
                      disabled={etapa === 'itens' && (!aberto || itensCarrinho.length === 0 || abaixoDoMinimo)}
                    >
                      Continuar
                    </button>
                  )}
                </footer>
              </form>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="pedir pedir-pc">
      <header className="pedir-pc-topo">
        <div className="pedir-marca">
          <img className="pedir-logo" src={logoSrc} alt="" />
          <h1>{nomeEmpresa}</h1>
        </div>
        <label className="pedir-pc-busca">
          <Icone nome="busca" tamanho={18} />
          <input
            type="search"
            placeholder="Buscar produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <button type="button" className="pedir-redondo pedir-redondo-escuro" onClick={alternar} aria-label="Trocar tema">
          <Icone nome={iconeTema} tamanho={20} />
        </button>
      </header>

      <div className="pedir-pc-faixa">
        <span>
          Entrega {formatarMoeda(taxa)} · pedido mínimo {formatarMoeda(minimo)} · Entrega em cerca de 50 min
        </span>
        <span className={aberto ? 'pedir-status pedir-status-aberto' : 'pedir-status pedir-status-fechado'}>
          {statusTexto}
        </span>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !catalogo && <Carregando />}

      {catalogo && (
        <div className="pedir-pc-corpo">
          <aside className="pedir-pc-categorias">
            <h2>Categorias</h2>
            <button
              type="button"
              className={categoriaId === 'todas' ? 'pedir-cat pedir-cat-ativa' : 'pedir-cat'}
              onClick={() => setCategoriaId('todas')}
            >
              <span>Todas</span>
              <span className="pedir-cat-contagem">{filtrados.length}</span>
            </button>
            {catalogo.categorias.map((c) => (
              <button
                key={c.id}
                type="button"
                className={categoriaId === c.id ? 'pedir-cat pedir-cat-ativa' : 'pedir-cat'}
                onClick={() => setCategoriaId(c.id)}
              >
                <span>{c.nome}</span>
                <span className="pedir-cat-contagem">{filtrados.filter((p) => p.categoriaId === c.id).length}</span>
              </button>
            ))}
          </aside>

          <main className="pedir-pc-centro">
            {ofertas.length > 0 && (
              <section>
                <h2 className="pedir-titulo">
                  <Icone nome="estrela" tamanho={18} /> Ofertas da semana
                </h2>
                <div className="pedir-pc-ofertas">{ofertas.map(renderCartaoPc)}</div>
              </section>
            )}

            <section>
              <h2 className="pedir-titulo">
                {nomeCategoriaAtiva} <span className="pedir-suave">{grade.length} {grade.length === 1 ? 'item' : 'itens'}</span>
              </h2>
              {grade.length === 0 ? (
                <p className="pedir-vazio">Nenhum produto encontrado.</p>
              ) : (
                <div className="pedir-pc-grade">{grade.map(renderCartaoPc)}</div>
              )}
            </section>
          </main>

          <aside className="pedir-pc-carrinho">
            <h2 className="pedir-titulo">
              Seu carrinho {itensCarrinho.length > 0 && <span className="pedir-suave">{itensCarrinho.length} itens</span>}
            </h2>
            {itensCarrinho.length === 0 ? (
              <p className="pedir-suave">Escolha produtos ao lado para montar seu pedido.</p>
            ) : (
              <ItensCarrinho itens={itensCarrinho} editavel setorDe={setorDe} aoMudar={definirQuantidade} />
            )}

            <form
              className="pedir-pc-form"
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
            >
              <Totais subtotal={subtotal} taxa={taxa} />
              {abaixoDoMinimo && itensCarrinho.length > 0 && (
                <Aviso tipo="info">
                  Faltam {formatarMoeda(minimo - subtotal)} para o pedido mínimo de {formatarMoeda(minimo)}.
                </Aviso>
              )}

              <h3 className="pedir-subtitulo">Seus dados</h3>
              <CamposDados dados={dados} atualizar={atualizar} />

              <h3 className="pedir-subtitulo">Entrega</h3>
              <CamposEndereco dados={dados} atualizar={atualizar} />

              <h3 className="pedir-subtitulo">Pagamento</h3>
              <CamposPagamento dados={dados} atualizar={atualizar} />

              {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
              <button
                type="submit"
                className="pedir-botao-principal"
                disabled={enviando || !aberto || abaixoDoMinimo || itensCarrinho.length === 0}
              >
                {enviando ? 'Enviando...' : `Fazer pedido · ${formatarMoeda(totalPedido)}`}
              </button>
            </form>
          </aside>
        </div>
      )}

      <Modal aberto={fichaProduto !== null} titulo="Produto" aoFechar={fecharFicha}>
        {fichaProduto && (
          <FichaProduto
            key={fichaProduto.produtoId}
            produto={fichaProduto}
            setor={setorDe(fichaProduto)}
            noPedido={quantidadeNoCarrinho(fichaProduto.produtoId)}
            aoConfirmar={(q) => confirmarFicha(fichaProduto, q)}
          />
        )}
      </Modal>
    </div>
  );
}
