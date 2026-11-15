import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Abas, AreaTexto, Aviso, Botao, Carregando, Selo, formatarData, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import type { CatalogoB2B, PedidoB2B, ProdutoB2B, StatusPedido } from './tipos';
import { COR_STATUS_PEDIDO, ROTULO_STATUS_PEDIDO, quantidadeCurta } from './tipos';
import './comercial.css';

// Loja B2B (página pública pelo código do cliente): vitrine com foto, carrinho e acompanhamento dos pedidos.
// No computador, o carrinho fica à direita. No celular, a lista tem uma barra de carrinho fixa embaixo.

const UNIDADES_FRACIONADAS = ['KG', 'G', 'L', 'ML'];

interface PedidoEnviado {
  id: number;
  numero: number;
  status: StatusPedido;
  total: number;
}

export function LojaB2B() {
  const { codigo = '' } = useParams();
  const [aba, setAba] = useState<'catalogo' | 'pedidos'>('catalogo');
  const [busca, setBusca] = useState('');
  const [carrinho, setCarrinho] = useState<Record<number, number>>({});
  const [observacoes, setObservacoes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<PedidoEnviado | null>(null);

  const catalogo = useDados<CatalogoB2B>(codigo ? `/publico/b2b/${encodeURIComponent(codigo)}` : null);
  const pedidos = useDados<PedidoB2B[]>(codigo && aba === 'pedidos' ? `/publico/b2b/${encodeURIComponent(codigo)}/pedidos` : null);

  const produtos = catalogo.dados?.produtos ?? [];
  const produtosPorId = useMemo(() => new Map(produtos.map((p) => [p.produtoId, p])), [produtos]);
  const termo = busca.trim().toLowerCase();
  const visiveis = produtos.filter((p) => termo === '' || p.nome.toLowerCase().includes(termo));

  const itens = Object.entries(carrinho)
    .map(([id, qtd]) => ({ produto: produtosPorId.get(Number(id)), quantidade: qtd }))
    .filter((i): i is { produto: ProdutoB2B; quantidade: number } => !!i.produto && i.quantidade > 0);
  const totalEstimado = itens.reduce((s, i) => s + i.produto.preco * i.quantidade, 0);

  function passoDe(unidade: string): number {
    return UNIDADES_FRACIONADAS.includes(unidade) ? 0.5 : 1;
  }

  function ajustar(produto: ProdutoB2B, delta: number) {
    setCarrinho((atual) => {
      const nova = Math.max(0, Math.round(((atual[produto.produtoId] ?? 0) + delta * passoDe(produto.unidade)) * 1000) / 1000);
      const copia = { ...atual };
      if (nova === 0) delete copia[produto.produtoId];
      else copia[produto.produtoId] = nova;
      return copia;
    });
  }

  async function enviarPedido() {
    setErroEnvio(null);
    if (itens.length === 0) return setErroEnvio('Adicione ao menos um produto.');
    setEnviando(true);
    try {
      const resposta = await api.post<PedidoEnviado>(`/publico/b2b/${encodeURIComponent(codigo)}/pedidos`, {
        itens: itens.map((i) => ({ produtoId: i.produto.produtoId, quantidade: i.quantidade })),
        observacoes: observacoes.trim() || null,
      });
      setEnviado(resposta);
      setCarrinho({});
      setObservacoes('');
      pedidos.recarregar();
    } catch (e) {
      setErroEnvio(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (catalogo.carregando && !catalogo.dados) {
    return (
      <div className="com-pub">
        <Carregando />
      </div>
    );
  }

  if (catalogo.erro || !catalogo.dados) {
    return (
      <div className="com-pub">
        <Aviso tipo="erro">Link inválido ou cliente sem acesso à loja. Fale com seu representante.</Aviso>
      </div>
    );
  }

  const dados = catalogo.dados;

  return (
    <div className="com-pub com-pub-b2b">
      <header className="com-pub-cabecalho">
        <div>
          <h1>{dados.empresa}</h1>
          <span className="com-suave">Olá, {dados.cliente.nome}</span>
        </div>
      </header>

      <Abas
        abas={[
          { id: 'catalogo', rotulo: 'Catálogo' },
          { id: 'pedidos', rotulo: 'Meus pedidos' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as 'catalogo' | 'pedidos')}
      />

      {aba === 'catalogo' && (
        <>
          {enviado && (
            <Aviso tipo="sucesso">
              Pedido nº {enviado.numero} enviado. Total estimado {formatarMoeda(enviado.total)}.
            </Aviso>
          )}

          <div className="com-b2b-layout">
            <section className="com-b2b-vitrine">
              <div className="com-pub-filtros">
                <input
                  className="com-input"
                  type="search"
                  placeholder="Buscar produto"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>

              <div className="com-b2b-produtos">
                {visiveis.map((p) => {
                  const qtd = carrinho[p.produtoId] ?? 0;
                  return (
                    <article key={p.produtoId} className="com-b2b-card">
                      <div className="com-b2b-foto">
                        <FotoProduto foto={p.foto} nome={p.nome} setor={p.categoria} preencher />
                      </div>
                      <div className="com-b2b-info">
                        <strong>{p.nome}</strong>
                        {p.categoria && <span className="com-suave">{p.categoria}</span>}
                        <span>
                          <strong>{formatarMoeda(p.preco)}</strong>
                          <span className="com-suave"> / {p.unidade}</span>
                        </span>
                        {p.qtdAtacado !== null && (
                          <span className="com-promo">Atacado a partir de {quantidadeCurta(p.qtdAtacado, p.unidade)}</span>
                        )}
                      </div>
                      <div className="com-b2b-acao">
                        {qtd === 0 ? (
                          <Botao aoClicar={() => ajustar(p, 1)}>Adicionar</Botao>
                        ) : (
                          <div className="com-stepper" role="group" aria-label={`Quantidade de ${p.nome}`}>
                            <button type="button" onClick={() => ajustar(p, -1)} aria-label="Diminuir">
                              −
                            </button>
                            <span>{quantidadeCurta(qtd, p.unidade)}</span>
                            <button type="button" onClick={() => ajustar(p, 1)} aria-label="Aumentar">
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
                {visiveis.length === 0 && <p className="com-suave">Nenhum produto encontrado.</p>}
              </div>
            </section>

            <section id="b2b-carrinho" className="com-b2b-carrinho">
              <h2 className="com-subtitulo">Seu pedido</h2>
              {itens.length === 0 ? (
                <p className="com-suave">Nenhum item no pedido.</p>
              ) : (
                <ul className="com-checkout-itens">
                  {itens.map((i) => (
                    <li key={i.produto.produtoId}>
                      <span>
                        {quantidadeCurta(i.quantidade, i.produto.unidade)} × {i.produto.nome}
                      </span>
                      <strong>{formatarMoeda(i.produto.preco * i.quantidade)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {itens.length > 0 && (
                <div className="com-checkout-totais">
                  <span>Total estimado</span>
                  <strong>{formatarMoeda(totalEstimado)}</strong>
                </div>
              )}
              <AreaTexto rotulo="Observações para o pedido" valor={observacoes} aoMudar={setObservacoes} linhas={3} />
              {erroEnvio && <Aviso tipo="erro">{erroEnvio}</Aviso>}
              <Botao desabilitado={enviando || itens.length === 0} aoClicar={enviarPedido}>
                {enviando ? 'Enviando...' : 'Enviar pedido'}
              </Botao>
            </section>
          </div>

          {itens.length > 0 && (
            <div className="com-b2b-barra">
              <div>
                <span className="com-suave">{itens.length} produto(s) no pedido</span>
                <strong>{formatarMoeda(totalEstimado)}</strong>
              </div>
              <Botao
                variante="secundario"
                aoClicar={() => document.getElementById('b2b-carrinho')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Ver pedido
              </Botao>
            </div>
          )}
        </>
      )}

      {aba === 'pedidos' && (
        <section className="com-b2b-pedidos">
          {pedidos.erro && <Aviso tipo="erro">{pedidos.erro}</Aviso>}
          {pedidos.carregando && !pedidos.dados ? (
            <Carregando />
          ) : (pedidos.dados ?? []).length === 0 ? (
            <p className="com-suave">Você ainda não fez pedidos por aqui.</p>
          ) : (
            (pedidos.dados ?? []).map((p) => (
              <div key={p.id} className="com-b2b-pedido">
                <div>
                  <strong>Pedido nº {p.numero}</strong>
                  <div className="com-suave">{formatarData(p.criadoEm)}</div>
                </div>
                <Selo cor={COR_STATUS_PEDIDO[p.status]}>{ROTULO_STATUS_PEDIDO[p.status]}</Selo>
                <strong>{formatarMoeda(p.total)}</strong>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
