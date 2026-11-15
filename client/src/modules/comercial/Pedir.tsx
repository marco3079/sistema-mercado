import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { usePlataforma } from '../../lib/plataforma';
import { Aviso, Botao, Campo, Carregando, Modal, Selecao, formatarMoeda } from '../../ui';
import type { CatalogoDelivery, ProdutoDelivery } from './tipos';
import { FORMAS_DELIVERY } from './tipos';
import './comercial.css';

// Pedido para entrega (página pública, sem login, mobile-first): cliente escolhe os produtos
// e informa o endereço. Ao confirmar, mostra o código de rastreio.

interface PedidoCriado {
  codigo: string;
  total: number;
}

function precoDoProduto(p: ProdutoDelivery): number {
  return p.precoPromocional ?? p.preco;
}

export function Pedir() {
  const [params] = useSearchParams();
  const loja = params.get('loja');
  const sufixoLoja = loja ? `?loja=${encodeURIComponent(loja)}` : '';
  const { plataforma } = usePlataforma();

  const [catalogo, setCatalogo] = useState<CatalogoDelivery | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | 'todas'>('todas');
  const [carrinho, setCarrinho] = useState<Record<number, number>>({});
  const [finalizando, setFinalizando] = useState(false);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [complemento, setComplemento] = useState('');
  const [forma, setForma] = useState<'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'>('PIX');
  const [trocoPara, setTrocoPara] = useState('');
  const [observacao, setObservacao] = useState('');
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

  const produtosPorId = useMemo(() => {
    const mapa = new Map<number, ProdutoDelivery>();
    for (const p of catalogo?.produtos ?? []) mapa.set(p.produtoId, p);
    return mapa;
  }, [catalogo]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (catalogo?.produtos ?? []).filter(
      (p) =>
        (categoriaId === 'todas' || p.categoriaId === categoriaId) &&
        (termo === '' || p.nome.toLowerCase().includes(termo)),
    );
  }, [catalogo, busca, categoriaId]);

  const itensCarrinho = Object.entries(carrinho)
    .map(([id, qtd]) => ({ produto: produtosPorId.get(Number(id)), quantidade: qtd }))
    .filter((i): i is { produto: ProdutoDelivery; quantidade: number } => !!i.produto && i.quantidade > 0);
  const quantidadeTotal = itensCarrinho.length;
  const subtotal = itensCarrinho.reduce((s, i) => s + precoDoProduto(i.produto) * i.quantidade, 0);
  const taxa = catalogo?.taxa ?? 0;
  const minimo = catalogo?.pedidoMinimo ?? 0;
  const abaixoDoMinimo = subtotal < minimo;
  const aberto = catalogo?.ativo ?? false;

  function ajustar(produto: ProdutoDelivery, delta: number) {
    setCarrinho((atual) => {
      const passo = produto.pesavel ? 0.5 : 1;
      const atualQtd = atual[produto.produtoId] ?? 0;
      const nova = Math.max(0, Math.round((atualQtd + delta * passo) * 1000) / 1000);
      const copia = { ...atual };
      if (nova === 0) delete copia[produto.produtoId];
      else copia[produto.produtoId] = nova;
      return copia;
    });
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErroEnvio(null);
    if (itensCarrinho.length === 0) return setErroEnvio('Escolha ao menos um produto.');
    if (abaixoDoMinimo) return setErroEnvio(`O pedido mínimo é ${formatarMoeda(minimo)}.`);
    const troco = forma === 'DINHEIRO' ? lerNumero(trocoPara) : null;
    setEnviando(true);
    try {
      const resposta = await api.post<PedidoCriado>(`/publico/delivery/pedidos${sufixoLoja}`, {
        nome: nome.trim(),
        telefone: telefone.trim(),
        endereco: endereco.trim(),
        numero: numero.trim(),
        bairro: bairro.trim(),
        cidade: cidade.trim() || null,
        complemento: complemento.trim() || null,
        formaPagamento: forma,
        trocoPara: troco && troco > 0 ? troco : null,
        itens: itensCarrinho.map((i) => ({ produtoId: i.produto.produtoId, quantidade: i.quantidade })),
        observacao: observacao.trim() || null,
      });
      setPedidoCriado(resposta);
      setCarrinho({});
      setCheckoutAberto(false);
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const [checkoutAberto, setCheckoutAberto] = useState(false);

  if (pedidoCriado) {
    return (
      <div className="com-pub">
        <div className="com-pub-confirmacao">
          <h1>Pedido recebido!</h1>
          <p>Guarde o código para acompanhar a entrega:</p>
          <p className="com-codigo">{pedidoCriado.codigo}</p>
          <p className="com-suave">Total: {formatarMoeda(pedidoCriado.total)}</p>
          <Link className="botao botao-primario" to={`/rastreio/${pedidoCriado.codigo}`}>
            Acompanhar entrega
          </Link>
          <div>
            <Botao variante="texto" aoClicar={() => setPedidoCriado(null)}>
              Fazer outro pedido
            </Botao>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="com-pub">
      <header className="com-pub-cabecalho">
        <div>
          <h1>{catalogo?.empresa ?? plataforma.nome}</h1>
          <span className={aberto ? 'com-status com-status-aberto' : 'com-status com-status-fechado'}>
            {catalogo ? (aberto ? 'Aceitando pedidos' : 'Delivery indisponível') : 'Carregando'}
          </span>
        </div>
        {catalogo && (
          <span className="com-suave">
            Entrega {formatarMoeda(taxa)} · pedido mínimo {formatarMoeda(minimo)}
          </span>
        )}
      </header>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !catalogo && <Carregando />}

      {catalogo && (
        <>
          {!aberto && <Aviso tipo="info">O delivery não está disponível agora. Tente mais tarde.</Aviso>}

          <div className="com-pub-filtros">
            <input
              className="com-input"
              type="search"
              placeholder="Buscar produto"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="com-chips">
              <button
                type="button"
                className={categoriaId === 'todas' ? 'com-chip com-chip-ativo' : 'com-chip'}
                onClick={() => setCategoriaId('todas')}
              >
                Todos
              </button>
              {catalogo.categorias.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={categoriaId === c.id ? 'com-chip com-chip-ativo' : 'com-chip'}
                  onClick={() => setCategoriaId(c.id)}
                >
                  {c.nome}
                </button>
              ))}
            </div>
          </div>

          <div className="com-pub-produtos">
            {visiveis.map((p) => {
              const qtd = carrinho[p.produtoId] ?? 0;
              const promocional = p.precoPromocional !== undefined;
              return (
                <article key={p.produtoId} className="com-pub-produto">
                  <div className="com-pub-produto-texto">
                    <strong>{p.nome}</strong>
                    {p.descricaoPromocao && <span className="com-promo">{p.descricaoPromocao}</span>}
                    <span>
                      {promocional && <s className="com-suave">{formatarMoeda(p.preco)} </s>}
                      <strong>{formatarMoeda(precoDoProduto(p))}</strong>
                      <span className="com-suave"> / {p.unidade}</span>
                    </span>
                  </div>
                  {qtd === 0 ? (
                    <Botao desabilitado={!aberto} aoClicar={() => ajustar(p, 1)}>
                      Adicionar
                    </Botao>
                  ) : (
                    <div className="com-stepper" role="group" aria-label={`Quantidade de ${p.nome}`}>
                      <button type="button" onClick={() => ajustar(p, -1)} aria-label="Diminuir">
                        −
                      </button>
                      <span>{formatarQuantidade(qtd, p.unidade)}</span>
                      <button type="button" onClick={() => ajustar(p, 1)} aria-label="Aumentar">
                        +
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {visiveis.length === 0 && <p className="com-suave">Nenhum produto encontrado.</p>}
          </div>

          {quantidadeTotal > 0 && (
            <div className="com-pub-carrinho">
              <div>
                <span className="com-suave">
                  {quantidadeTotal} item(ns) · {formatarMoeda(subtotal)}
                </span>
                {abaixoDoMinimo && <span className="com-suave">Faltam {formatarMoeda(minimo - subtotal)} para o mínimo</span>}
              </div>
              <Botao desabilitado={!aberto} aoClicar={() => setCheckoutAberto(true)}>
                Ver carrinho
              </Botao>
            </div>
          )}

          <Modal aberto={checkoutAberto} titulo="Finalizar pedido" aoFechar={() => setCheckoutAberto(false)}>
            <form className="com-checkout" onSubmit={enviar}>
              <ul className="com-checkout-itens">
                {itensCarrinho.map((i) => (
                  <li key={i.produto.produtoId}>
                    <span>
                      {formatarQuantidade(i.quantidade, i.produto.unidade)} × {i.produto.nome}
                    </span>
                    <strong>{formatarMoeda(precoDoProduto(i.produto) * i.quantidade)}</strong>
                  </li>
                ))}
              </ul>
              <div className="com-checkout-totais">
                <span>Subtotal</span>
                <strong>{formatarMoeda(subtotal)}</strong>
                <span>Entrega</span>
                <strong>{formatarMoeda(taxa)}</strong>
                <span>Total</span>
                <strong>{formatarMoeda(subtotal + taxa)}</strong>
              </div>
              {abaixoDoMinimo && <Aviso tipo="info">Pedido mínimo de {formatarMoeda(minimo)}.</Aviso>}

              <Campo rotulo="Seu nome" valor={nome} aoMudar={setNome} obrigatorio />
              <Campo rotulo="Telefone (WhatsApp)" valor={telefone} aoMudar={setTelefone} obrigatorio />
              <Campo rotulo="Endereço" valor={endereco} aoMudar={setEndereco} obrigatorio />
              <div className="com-checkout-duplo">
                <Campo rotulo="Número" valor={numero} aoMudar={setNumero} obrigatorio />
                <Campo rotulo="Bairro" valor={bairro} aoMudar={setBairro} obrigatorio />
              </div>
              <Campo rotulo="Cidade" valor={cidade} aoMudar={setCidade} />
              <Campo rotulo="Complemento" valor={complemento} aoMudar={setComplemento} />
              <Selecao
                rotulo="Forma de pagamento (na entrega)"
                valor={forma}
                aoMudar={(v) => setForma(v as typeof forma)}
                opcoes={FORMAS_DELIVERY}
              />
              {forma === 'DINHEIRO' && <Campo rotulo="Troco para quanto?" valor={trocoPara} aoMudar={setTrocoPara} />}
              <Campo rotulo="Observação" valor={observacao} aoMudar={setObservacao} />

              {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
              <Botao tipo="submit" desabilitado={enviando || !aberto || abaixoDoMinimo}>
                {enviando ? 'Enviando...' : `Confirmar pedido · ${formatarMoeda(subtotal + taxa)}`}
              </Botao>
            </form>
          </Modal>
        </>
      )}
    </div>
  );
}
