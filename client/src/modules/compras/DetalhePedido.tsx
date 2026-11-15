import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Pagina, Selo, Tabela, formatarData, formatarDataHora, formatarMoeda, paraInputData } from '../../ui';
import { BuscaProduto } from './PedidosCompra';
import { ROTULO_STATUS_PEDIDO, ROTULO_STATUS_RECEBIMENTO } from './tipos';
import type { PedidoComTexto, PedidoDetalhe, ProdutoBuscaDTO, StatusPedido } from './tipos';

type NovoStatus = 'ENVIADO' | 'CONFIRMADO' | 'EM_TRANSITO' | 'CANCELADO';

// Ações de cada etapa. A ordem segue o funil; o recebimento tem botão próprio.
const ACOES: Partial<Record<StatusPedido, { status: NovoStatus; rotulo: string; perigo?: boolean }[]>> = {
  RASCUNHO: [
    { status: 'ENVIADO', rotulo: 'Marcar como enviado' },
    { status: 'CANCELADO', rotulo: 'Cancelar pedido', perigo: true },
  ],
  ENVIADO: [
    { status: 'CONFIRMADO', rotulo: 'Fornecedor confirmou' },
    { status: 'EM_TRANSITO', rotulo: 'Saiu para entrega' },
    { status: 'CANCELADO', rotulo: 'Cancelar pedido', perigo: true },
  ],
  CONFIRMADO: [
    { status: 'EM_TRANSITO', rotulo: 'Saiu para entrega' },
    { status: 'CANCELADO', rotulo: 'Cancelar pedido', perigo: true },
  ],
};

// Etapas em que a mercadoria ainda pode ser recebida.
const RECEBIVEIS: StatusPedido[] = ['ENVIADO', 'CONFIRMADO', 'EM_TRANSITO', 'RECEBIDO_PARCIAL'];

interface LinhaEdicao {
  produtoId: number;
  nome: string;
  unidade: string;
  quantidade: string;
  preco: string;
}

function numeroParaTexto(n: number): string {
  return String(n).replace('.', ',');
}

function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Número de WhatsApp só com dígitos, com 55 quando faltar o código do país.
function linkWhatsapp(numero: string | null, mensagem: string): string | null {
  if (!numero) return null;
  let digitos = numero.replace(/\D/g, '');
  if (digitos.length === 0) return null;
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// Detalhe do pedido. Em rascunho, o comprador edita os itens. Depois, avança o status e recebe.
export function DetalhePedido() {
  const { id: idTexto } = useParams();
  const id = Number(idTexto);
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();
  const podeEditar = usuario?.perfil === 'COMPRADOR' || usuario?.perfil === 'GESTOR';

  const { dados, carregando, erro, recarregar } = useDados<PedidoDetalhe>(`/pedidos-compra/${id}`);
  const { dados: textoPedido, recarregar: recarregarTexto } = useDados<{ textoPedido: string }>(
    `/pedidos-compra/${id}/texto`,
  );

  const [linhas, setLinhas] = useState<LinhaEdicao[]>([]);
  const [condicao, setCondicao] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [rastreio, setRastreio] = useState('');
  const [previsaoTransporte, setPrevisaoTransporte] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!dados) return;
    setLinhas(
      dados.itens.map((i) => ({
        produtoId: i.produtoId,
        nome: i.nome,
        unidade: i.unidade,
        quantidade: numeroParaTexto(i.quantidade),
        preco: numeroParaTexto(i.precoUnitario),
      })),
    );
    setCondicao(dados.condicaoPagamento ?? '');
    setPrevisao(dados.previsaoEntrega ? paraInputData(dados.previsaoEntrega) : '');
    setObservacoes(dados.observacoes ?? '');
    setRastreio(dados.rastreio ?? '');
  }, [dados]);

  function atualizarLinha(produtoId: number, campo: 'quantidade' | 'preco', valor: string) {
    setLinhas((atual) => atual.map((l) => (l.produtoId === produtoId ? { ...l, [campo]: valor } : l)));
  }

  function adicionarProduto(p: ProdutoBuscaDTO) {
    if (linhas.some((l) => l.produtoId === p.id)) return;
    setLinhas((atual) => [
      ...atual,
      { produtoId: p.id, nome: p.nome, unidade: p.unidade, quantidade: '1', preco: numeroParaTexto(p.precoCusto) },
    ]);
  }

  function atualizarDados() {
    recarregar();
    recarregarTexto();
  }

  async function salvarRascunho() {
    if (!dados) return;
    setMensagem(null);
    if (linhas.length === 0) {
      setMensagem({ tipo: 'erro', texto: 'Inclua ao menos um item.' });
      return;
    }
    const itens: { produtoId: number; quantidade: number; precoUnitario: number }[] = [];
    for (const l of linhas) {
      const q = lerNumero(l.quantidade);
      const p = lerNumero(l.preco);
      if (q === null || q <= 0 || p === null || p < 0) {
        setMensagem({ tipo: 'erro', texto: `Confira quantidade e preço de ${l.nome}.` });
        return;
      }
      itens.push({ produtoId: l.produtoId, quantidade: q, precoUnitario: p });
    }
    setOcupado(true);
    try {
      await api.put<PedidoDetalhe>(`/pedidos-compra/${id}`, {
        fornecedorId: dados.fornecedor.id,
        itens,
        previsaoEntrega: previsao || null,
        condicaoPagamento: textoOuNulo(condicao),
        observacoes: textoOuNulo(observacoes),
      });
      setMensagem({ tipo: 'sucesso', texto: 'Pedido salvo.' });
      atualizarDados();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    } finally {
      setOcupado(false);
    }
  }

  async function mudarStatus(status: NovoStatus) {
    if (!dados) return;
    if (status === 'CANCELADO' && !window.confirm('Cancelar este pedido? Ele não volta depois.')) return;
    setMensagem(null);
    const corpo: { status: NovoStatus; rastreio?: string; previsaoEntrega?: string } = { status };
    if (rastreio.trim()) corpo.rastreio = rastreio.trim();
    if (previsaoTransporte) corpo.previsaoEntrega = previsaoTransporte;
    setOcupado(true);
    try {
      await api.post<PedidoComTexto>(`/pedidos-compra/${id}/status`, corpo);
      setMensagem({ tipo: 'sucesso', texto: `Pedido atualizado: ${ROTULO_STATUS_PEDIDO[status].rotulo}.` });
      atualizarDados();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    } finally {
      setOcupado(false);
    }
  }

  async function receberMercadoria() {
    setMensagem(null);
    setOcupado(true);
    try {
      const recebimento = await api.post<{ id: number }>('/recebimentos', { pedidoCompraId: id });
      navegar(`${raiz}/recebimento/${recebimento.id}`);
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
      setOcupado(false);
    }
  }

  async function copiarTexto() {
    if (!textoPedido) return;
    try {
      await navigator.clipboard.writeText(textoPedido.textoPedido);
      setMensagem({ tipo: 'sucesso', texto: 'Texto copiado.' });
    } catch {
      setMensagem({ tipo: 'erro', texto: 'Não foi possível copiar. Selecione o texto e copie.' });
    }
  }

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Pagina titulo="Pedido de compra"><Aviso tipo="erro">{erro}</Aviso></Pagina>;
  if (!dados) return null;

  const editavel = podeEditar && dados.status === 'RASCUNHO';
  const acoes = podeEditar ? ACOES[dados.status] ?? [] : [];
  const podeReceber = RECEBIVEIS.includes(dados.status);
  const whatsapp = linkWhatsapp(
    dados.fornecedor.whatsapp ?? dados.fornecedor.telefone,
    textoPedido?.textoPedido ?? '',
  );
  const estado = ROTULO_STATUS_PEDIDO[dados.status];

  return (
    <Pagina
      titulo={`Pedido #${dados.numero}`}
      acoes={
        <>
          <Selo cor={estado.cor}>{estado.rotulo}</Selo>
          <Botao variante="secundario" aoClicar={() => navegar(`${raiz}/pedidos-compra`)}>
            Voltar
          </Botao>
        </>
      }
    >
      {mensagem && <Aviso tipo={mensagem.tipo === 'erro' ? 'erro' : 'sucesso'}>{mensagem.texto}</Aviso>}

      <div className="compras-acumulado">
        <span>
          Fornecedor: <strong>{dados.fornecedor.nome}</strong>
        </span>
        <span>
          Total: <strong>{formatarMoeda(dados.total)}</strong>
        </span>
        <span>Criado em {formatarDataHora(dados.criadoEm)}</span>
        {dados.enviadoEm && <span>Enviado em {formatarDataHora(dados.enviadoEm)}</span>}
        {dados.recebidoEm && <span>Recebido em {formatarDataHora(dados.recebidoEm)}</span>}
      </div>

      <section className="compras-secao">
        <h2 className="compras-secao-titulo">Itens</h2>
        {editavel ? (
          <>
            <div className="compras-rolagem">
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
                  {linhas.map((l) => (
                    <tr key={l.produtoId}>
                      <td>{l.nome} <span className="compras-sub">{l.unidade.toLowerCase()}</span></td>
                      <td className="tabela-alinhar-direita">
                        <input
                          className="compras-input compras-input-curto"
                          inputMode="decimal"
                          value={l.quantidade}
                          onChange={(e) => atualizarLinha(l.produtoId, 'quantidade', e.target.value)}
                          aria-label={`Quantidade de ${l.nome}`}
                        />
                      </td>
                      <td className="tabela-alinhar-direita">
                        <input
                          className="compras-input compras-input-curto"
                          inputMode="decimal"
                          value={l.preco}
                          onChange={(e) => atualizarLinha(l.produtoId, 'preco', e.target.value)}
                          aria-label={`Preço de ${l.nome}`}
                        />
                      </td>
                      <td className="tabela-alinhar-direita">
                        {formatarMoeda((lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0))}
                      </td>
                      <td>
                        <Botao
                          variante="texto"
                          aoClicar={() => setLinhas((atual) => atual.filter((x) => x.produtoId !== l.produtoId))}
                        >
                          Remover
                        </Botao>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="compras-secao">
              <BuscaProduto aoEscolher={adicionarProduto} rotulo="Adicionar produto (nome, código ou EAN)" />
            </div>
            <div className="compras-grade-campos compras-secao">
              <Campo rotulo="Previsão de entrega" tipo="date" valor={previsao} aoMudar={setPrevisao} />
              <Campo rotulo="Condição de pagamento" valor={condicao} aoMudar={setCondicao} />
              <Campo rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} />
            </div>
            <div className="compras-linha-acoes compras-secao">
              <Botao aoClicar={() => void salvarRascunho()} desabilitado={ocupado}>
                Salvar pedido
              </Botao>
            </div>
          </>
        ) : (
          <div className="compras-rolagem">
            <Tabela
              colunas={[
                { titulo: 'Produto', celula: (i) => <>{i.nome}<span className="compras-sub">{i.codigo}</span></> },
                { titulo: 'Quantidade', alinhar: 'direita', celula: (i) => `${i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.unidade.toLowerCase()}` },
                { titulo: 'Preço', alinhar: 'direita', celula: (i) => formatarMoeda(i.precoUnitario) },
                { titulo: 'Subtotal', alinhar: 'direita', celula: (i) => formatarMoeda(i.subtotal) },
                { titulo: 'Recebido', alinhar: 'direita', celula: (i) => i.quantidadeRecebida.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) },
              ]}
              dados={dados.itens}
              chave={(i) => i.id}
              vazio="Este pedido não tem itens."
            />
          </div>
        )}
      </section>

      {podeEditar && acoes.length > 0 && (
        <section className="compras-secao">
          <h2 className="compras-secao-titulo">Andamento</h2>
          <div className="compras-grade-campos">
            <Campo rotulo="Código de rastreio" valor={rastreio} aoMudar={setRastreio} />
            <Campo rotulo="Previsão de entrega" tipo="date" valor={previsaoTransporte} aoMudar={setPrevisaoTransporte} />
          </div>
          <p className="compras-ajuda">Preencha o rastreio e a previsão se o fornecedor informar.</p>
          <div className="compras-linha-acoes">
            {acoes.map((a) => (
              <Botao
                key={a.status}
                variante={a.perigo ? 'perigo' : 'primario'}
                desabilitado={ocupado}
                aoClicar={() => void mudarStatus(a.status)}
              >
                {a.rotulo}
              </Botao>
            ))}
          </div>
        </section>
      )}

      <section className="compras-secao">
        <h2 className="compras-secao-titulo">Enviar ao fornecedor</h2>
        <p className="compras-ajuda">Texto simples do pedido, para copiar ou mandar pelo WhatsApp.</p>
        <textarea className="campo-controle" rows={6} readOnly value={textoPedido?.textoPedido ?? ''} aria-label="Texto do pedido" />
        <div className="compras-linha-acoes compras-secao">
          <Botao variante="secundario" aoClicar={() => void copiarTexto()} desabilitado={!textoPedido}>
            Copiar texto
          </Botao>
          {whatsapp ? (
            <a className="botao botao-secundario" href={whatsapp} target="_blank" rel="noreferrer">
              Enviar por WhatsApp
            </a>
          ) : (
            <span className="compras-sub">Cadastre o WhatsApp do fornecedor para enviar por aqui.</span>
          )}
        </div>
      </section>

      {podeReceber && (
        <section className="compras-secao">
          <h2 className="compras-secao-titulo">Recebimento</h2>
          <p className="compras-ajuda">Ao receber, a mercadoria é conferida item a item antes de entrar no estoque.</p>
          <Botao aoClicar={() => void receberMercadoria()} desabilitado={ocupado}>
            Receber mercadoria
          </Botao>
        </section>
      )}

      {dados.recebimentos.length > 0 && (
        <section className="compras-secao">
          <h2 className="compras-secao-titulo">Recebimentos deste pedido</h2>
          <div className="compras-rolagem">
            <Tabela
              colunas={[
                { titulo: 'Recebimento', celula: (r) => `#${r.id}` },
                {
                  titulo: 'Status',
                  celula: (r) => (
                    <Selo cor={ROTULO_STATUS_RECEBIMENTO[r.status].cor}>{ROTULO_STATUS_RECEBIMENTO[r.status].rotulo}</Selo>
                  ),
                },
                { titulo: 'Aberto em', celula: (r) => formatarData(r.criadoEm) },
              ]}
              dados={dados.recebimentos}
              chave={(r) => r.id}
              aoClicarLinha={(r) => navegar(`${raiz}/recebimento/${r.id}`)}
            />
          </div>
        </section>
      )}
    </Pagina>
  );
}
