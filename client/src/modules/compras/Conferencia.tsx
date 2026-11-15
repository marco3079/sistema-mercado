import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { formatarQuantidade, hojeIso, lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { AreaTexto, Aviso, Botao, Caixa, Campo, Carregando, Modal, Pagina, Selecao, Selo, formatarData, formatarMoeda, paraInputData } from '../../ui';
import { BuscaProduto } from './PedidosCompra';
import { ROTULO_STATUS_RECEBIMENTO } from './tipos';
import type { ItemNaoAssociado, ItemRecebimentoDTO, ProdutoBuscaDTO, RecebimentoDetalhe } from './tipos';

// Texto de edição de uma linha da nota.
interface EdicaoItem {
  recebido: string;
  lote: string;
  validade: string;
  divergencia: string;
}

interface PrecoVenda {
  marcado: boolean;
  preco: string;
}

function numeroParaTexto(n: number): string {
  return String(n).replace('.', ',');
}

function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

function edicaoDe(item: ItemRecebimentoDTO): EdicaoItem {
  return {
    recebido: item.quantidadeRecebida !== null ? numeroParaTexto(item.quantidadeRecebida) : '',
    lote: item.lote ?? '',
    validade: item.validade ? paraInputData(item.validade) : '',
    divergencia: item.divergencia ?? '',
  };
}

// Conferência de um recebimento: bipagem, quantidades por item, lote e validade, e a conclusão.
export function Conferencia() {
  const { id: idTexto } = useParams();
  const id = Number(idTexto);
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/estoquista';
  const navegar = useNavigate();
  const { dados, carregando, erro, recarregar } = useDados<RecebimentoDetalhe>(`/recebimentos/${id}`);

  const [edicoes, setEdicoes] = useState<Record<number, EdicaoItem>>({});
  const [bipagem, setBipagem] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [associando, setAssociando] = useState<string | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [financeiro, setFinanceiro] = useState(true);
  const [parcelas, setParcelas] = useState('1');
  const [vencimento, setVencimento] = useState(hojeIso(28));
  const [precosVenda, setPrecosVenda] = useState<Record<number, PrecoVenda>>({});
  const [avaliando, setAvaliando] = useState(false);
  const campoBipagem = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dados) return;
    const novo: Record<number, EdicaoItem> = {};
    for (const item of dados.itens) novo[item.id] = edicaoDe(item);
    setEdicoes(novo);
  }, [dados]);

  const emConferencia = dados?.status === 'CONFERINDO';

  function atualizarEdicao(itemId: number, campo: keyof EdicaoItem, valor: string) {
    setEdicoes((atual) => ({ ...atual, [itemId]: { ...(atual[itemId] ?? { recebido: '', lote: '', validade: '', divergencia: '' }), [campo]: valor } }));
  }

  // Salva a linha inteira ao sair de um campo.
  async function salvarItem(itemId: number) {
    const e = edicoes[itemId];
    if (!e || !emConferencia) return;
    const recebido = e.recebido.trim() === '' ? 0 : lerNumero(e.recebido);
    if (recebido === null || recebido < 0) {
      setMensagem({ tipo: 'erro', texto: 'Quantidade recebida inválida.' });
      return;
    }
    if (e.validade && !/^\d{4}-\d{2}-\d{2}$/.test(e.validade)) {
      setMensagem({ tipo: 'erro', texto: 'Validade inválida.' });
      return;
    }
    setMensagem(null);
    try {
      await api.put<RecebimentoDetalhe>(`/recebimentos/${id}/itens/${itemId}`, {
        quantidadeRecebida: recebido,
        lote: textoOuNulo(e.lote),
        validade: e.validade || null,
        divergencia: textoOuNulo(e.divergencia),
      });
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    }
  }

  // Bipagem: cada leitura soma 1 ao item do código lido.
  async function bipar() {
    const codigo = bipagem.trim();
    if (!codigo || ocupado) return;
    setOcupado(true);
    setMensagem(null);
    try {
      await api.put<RecebimentoDetalhe>(`/recebimentos/${id}/bipar`, { codigo });
      setMensagem({ tipo: 'sucesso', texto: `Lido: ${codigo}` });
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    } finally {
      setBipagem('');
      setOcupado(false);
      campoBipagem.current?.focus();
    }
  }

  function aoTeclarBipagem(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void bipar();
    }
  }

  async function associar(cProd: string, produto: ProdutoBuscaDTO) {
    setMensagem(null);
    try {
      await api.put<RecebimentoDetalhe>(`/recebimentos/${id}/associar`, { cProd, produtoId: produto.id });
      setAssociando(null);
      setMensagem({ tipo: 'sucesso', texto: `Item associado a ${produto.nome}.` });
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    }
  }

  function abrirConclusao() {
    if (!dados) return;
    const precos: Record<number, PrecoVenda> = {};
    for (const item of dados.itens) {
      precos[item.produtoId] = { marcado: false, preco: numeroParaTexto(item.precoSugerido) };
    }
    setPrecosVenda(precos);
    setConcluindo(true);
  }

  async function concluir() {
    if (!dados) return;
    setMensagem(null);
    let parcelasNumero: number | null = null;
    if (financeiro) {
      const n = lerNumero(parcelas);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 36) {
        setMensagem({ tipo: 'erro', texto: 'Use de 1 a 36 parcelas.' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
        setMensagem({ tipo: 'erro', texto: 'Informe a data do primeiro vencimento.' });
        return;
      }
      parcelasNumero = n;
    }
    const atualizarPrecos: { produtoId: number; precoVenda: number }[] = [];
    for (const [produtoId, p] of Object.entries(precosVenda)) {
      if (!p.marcado) continue;
      const preco = lerNumero(p.preco);
      if (preco === null || preco < 0) {
        setMensagem({ tipo: 'erro', texto: 'Confira os preços de venda marcados.' });
        return;
      }
      atualizarPrecos.push({ produtoId: Number(produtoId), precoVenda: preco });
    }
    setOcupado(true);
    try {
      await api.post<RecebimentoDetalhe>(`/recebimentos/${id}/concluir`, {
        gerarFinanceiro: financeiro,
        parcelas: parcelasNumero,
        primeiroVencimento: financeiro ? vencimento : null,
        atualizarPrecos: atualizarPrecos.length > 0 ? atualizarPrecos : null,
      });
      setConcluindo(false);
      setMensagem({ tipo: 'sucesso', texto: 'Recebimento concluído. Estoque atualizado.' });
      recarregar();
      setAvaliando(true);
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    } finally {
      setOcupado(false);
    }
  }

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Pagina titulo="Conferência"><Aviso tipo="erro">{erro}</Aviso></Pagina>;
  if (!dados) return null;

  const recebidos = dados.itens.filter((i) => (i.quantidadeRecebida ?? 0) > 0);
  const estado = ROTULO_STATUS_RECEBIMENTO[dados.status];

  return (
    <Pagina
      titulo={dados.numeroNota ? `Conferência · NF ${dados.numeroNota}` : `Conferência #${dados.id}`}
      acoes={
        <>
          <Selo cor={estado.cor}>{estado.rotulo}</Selo>
          {emConferencia && (
            <Botao aoClicar={abrirConclusao} desabilitado={ocupado || dados.itens.length === 0}>
              Concluir recebimento
            </Botao>
          )}
          <Botao variante="secundario" aoClicar={() => navegar(`${raiz}/recebimento`)}>
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
        {dados.numeroNota && (
          <span>
            Nota: <strong>{dados.numeroNota}</strong>
            {dados.serieNota ? ` · série ${dados.serieNota}` : ''}
          </span>
        )}
        {dados.valorNota !== null && (
          <span>
            Valor da nota: <strong>{formatarMoeda(dados.valorNota)}</strong>
          </span>
        )}
        {dados.pedidoCompraId && (
          <span>
            Pedido:{' '}
            <button type="button" className="botao-texto" onClick={() => navegar(`${raiz}/pedidos-compra/${dados.pedidoCompraId}`)}>
              #{dados.pedidoCompraId}
            </button>
          </span>
        )}
        {dados.concluidoEm && <span>Concluído em {formatarData(dados.concluidoEm)}</span>}
      </div>

      {emConferencia && (
        <section className="compras-secao">
          <div className="compras-bipagem">
            <label className="campo-rotulo" htmlFor="compras-bipagem">
              Bipagem: passe o leitor no código de barras
            </label>
            <input
              id="compras-bipagem"
              ref={campoBipagem}
              className="compras-input compras-input-grande"
              autoFocus
              autoComplete="off"
              value={bipagem}
              disabled={ocupado}
              onChange={(e) => setBipagem(e.target.value)}
              onKeyDown={aoTeclarBipagem}
              placeholder="Código ou EAN"
            />
            <p className="compras-bipagem-ajuda">
              Cada leitura soma 1 ao item. Para uma quantidade diferente, ajuste o campo "Recebido" na tabela.
            </p>
          </div>
        </section>
      )}

      {dados.naoAssociados.length > 0 && (
        <section className="compras-secao">
          <h2 className="compras-secao-titulo">Itens da nota sem produto ({dados.naoAssociados.length})</h2>
          <p className="compras-ajuda">
            Estes itens não entram no estoque até serem associados a um produto do sistema.
          </p>
          <div className="compras-nao-associados">
            {dados.naoAssociados.map((n: ItemNaoAssociado) => (
              <div className="compras-nao-associado" key={n.cProd}>
                <p className="compras-nao-associado-titulo">{n.xProd || 'Item sem descrição'}</p>
                <span className="compras-sub">
                  Código do fornecedor {n.cProd}
                  {n.cEAN ? ` · EAN ${n.cEAN}` : ''} · {formatarQuantidade(n.qCom)} a {formatarMoeda(n.vUnCom)}
                </span>
                {emConferencia && (
                  <div className="compras-secao">
                    {associando === n.cProd ? (
                      <>
                        <BuscaProduto
                          rotulo="Escolha o produto do sistema"
                          aoEscolher={(produto) => void associar(n.cProd, produto)}
                        />
                        <div className="compras-linha-acoes">
                          <Botao variante="texto" aoClicar={() => setAssociando(null)}>
                            Cancelar
                          </Botao>
                        </div>
                      </>
                    ) : (
                      <Botao variante="secundario" aoClicar={() => setAssociando(n.cProd)}>
                        Associar a um produto
                      </Botao>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="compras-secao">
        <h2 className="compras-secao-titulo">Itens</h2>
        {dados.itens.length === 0 ? (
          <p className="compras-vazio">Nenhum item associado a esta nota.</p>
        ) : (
          <div className="compras-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col" className="tabela-alinhar-direita">Na nota</th>
                  <th scope="col" className="tabela-alinhar-direita">Recebido</th>
                  <th scope="col" className="tabela-alinhar-direita">Entra no estoque</th>
                  <th scope="col">Lote</th>
                  <th scope="col">Validade</th>
                  <th scope="col">Divergência</th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((item) => {
                  const e = edicoes[item.id] ?? edicaoDe(item);
                  const recebido = e.recebido.trim() === '' ? 0 : (lerNumero(e.recebido) ?? 0);
                  const divergente = recebido !== item.quantidadeNota || e.divergencia.trim() !== '';
                  const entra = recebido * item.fatorConversao;
                  return (
                    <tr key={item.id} className={divergente ? 'compras-divergente' : undefined}>
                      <td>
                        {item.nome}
                        <span className="compras-sub">{item.codigo}</span>
                      </td>
                      <td className="tabela-alinhar-direita">{formatarQuantidade(item.quantidadeNota, item.unidade.toLowerCase())}</td>
                      <td className="tabela-alinhar-direita">
                        <input
                          className="compras-input compras-input-curto"
                          inputMode="decimal"
                          disabled={!emConferencia}
                          value={e.recebido}
                          onChange={(ev) => atualizarEdicao(item.id, 'recebido', ev.target.value)}
                          onBlur={() => void salvarItem(item.id)}
                          aria-label={`Recebido de ${item.nome}`}
                        />
                      </td>
                      <td className="tabela-alinhar-direita">
                        <span className="compras-entra-estoque">
                          {formatarQuantidade(entra, item.unidade.toLowerCase())}
                          {item.fatorConversao !== 1 && <small>nota × {item.fatorConversao}</small>}
                        </span>
                      </td>
                      <td>
                        <input
                          className="compras-input"
                          disabled={!emConferencia}
                          value={e.lote}
                          onChange={(ev) => atualizarEdicao(item.id, 'lote', ev.target.value)}
                          onBlur={() => void salvarItem(item.id)}
                          aria-label={`Lote de ${item.nome}`}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="compras-input"
                          disabled={!emConferencia}
                          value={e.validade}
                          onChange={(ev) => atualizarEdicao(item.id, 'validade', ev.target.value)}
                          onBlur={() => void salvarItem(item.id)}
                          aria-label={`Validade de ${item.nome}`}
                        />
                      </td>
                      <td>
                        <input
                          className="compras-input"
                          disabled={!emConferencia}
                          value={e.divergencia}
                          onChange={(ev) => atualizarEdicao(item.id, 'divergencia', ev.target.value)}
                          onBlur={() => void salvarItem(item.id)}
                          placeholder="Ex.: faltou 2, avaria"
                          aria-label={`Divergência de ${item.nome}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal aberto={concluindo} titulo="Concluir recebimento" aoFechar={() => setConcluindo(false)}>
        <div className="compras-concluir-avisos">
          {dados.naoAssociados.length > 0 && (
            <Aviso tipo="info">
              Há {dados.naoAssociados.length} item(ns) da nota sem produto. Eles não entram no estoque.
            </Aviso>
          )}
          {dados.itens.some((i) => i.quantidadeRecebida === null || i.quantidadeRecebida !== i.quantidadeNota) && (
            <Aviso tipo="info">
              Há diferença entre a nota e o conferido. O recebimento fica como "Com divergência".
            </Aviso>
          )}
        </div>

        <section className="compras-secao">
          <h3 className="compras-secao-titulo">Financeiro</h3>
          <Caixa rotulo="Gerar contas a pagar" marcado={financeiro} aoMudar={setFinanceiro} />
          {financeiro && (
            <div className="compras-grade-campos compras-secao">
              <Campo rotulo="Parcelas" tipo="number" valor={parcelas} aoMudar={setParcelas} />
              <Campo rotulo="Primeiro vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} />
            </div>
          )}
        </section>

        <section className="compras-secao">
          <h3 className="compras-secao-titulo">Preço de venda</h3>
          <p className="compras-ajuda">
            Marque os produtos cujo preço de venda deve mudar. O sugerido vem do custo novo e da margem padrão.
          </p>
          {recebidos.length === 0 ? (
            <p className="compras-vazio">Nenhum item recebido.</p>
          ) : (
            <div className="compras-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Atualizar</th>
                    <th scope="col">Produto</th>
                    <th scope="col" className="tabela-alinhar-direita">Venda atual</th>
                    <th scope="col" className="tabela-alinhar-direita">Sugerido</th>
                    <th scope="col" className="tabela-alinhar-direita">Novo preço (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {recebidos.map((item) => {
                    const p = precosVenda[item.produtoId] ?? { marcado: false, preco: numeroParaTexto(item.precoSugerido) };
                    return (
                      <tr key={item.produtoId}>
                        <td>
                          <input
                            type="checkbox"
                            className="compras-caixa-tabela"
                            checked={p.marcado}
                            onChange={(ev) =>
                              setPrecosVenda((atual) => ({ ...atual, [item.produtoId]: { ...p, marcado: ev.target.checked } }))
                            }
                            aria-label={`Atualizar preço de ${item.nome}`}
                          />
                        </td>
                        <td>{item.nome}</td>
                        <td className="tabela-alinhar-direita">{formatarMoeda(item.precoVendaAtual)}</td>
                        <td className="tabela-alinhar-direita">{formatarMoeda(item.precoSugerido)}</td>
                        <td className="tabela-alinhar-direita">
                          <input
                            className="compras-input compras-input-curto"
                            inputMode="decimal"
                            value={p.preco}
                            onChange={(ev) =>
                              setPrecosVenda((atual) => ({ ...atual, [item.produtoId]: { ...p, preco: ev.target.value } }))
                            }
                            aria-label={`Novo preço de ${item.nome}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="compras-linha-acoes compras-secao">
          <Botao aoClicar={() => void concluir()} desabilitado={ocupado || recebidos.length === 0}>
            {ocupado ? 'Concluindo...' : 'Concluir recebimento'}
          </Botao>
          <Botao variante="texto" aoClicar={() => setConcluindo(false)}>
            Cancelar
          </Botao>
        </div>
      </Modal>

      <Modal aberto={avaliando} titulo="Avaliar o fornecedor" aoFechar={() => setAvaliando(false)}>
        {avaliando && (
          <AvaliarFornecedor
            fornecedorId={dados.fornecedor.id}
            recebimentoId={dados.id}
            aoConcluir={() => setAvaliando(false)}
          />
        )}
      </Modal>
    </Pagina>
  );
}

const NOTAS = ['1', '2', '3', '4', '5'];

// Avaliação opcional do fornecedor, logo após concluir o recebimento.
function AvaliarFornecedor({
  fornecedorId,
  recebimentoId,
  aoConcluir,
}: {
  fornecedorId: number;
  recebimentoId: number;
  aoConcluir: () => void;
}) {
  const [notas, setNotas] = useState({ pontualidade: '5', qualidade: '5', atendimento: '5' });
  const [comentario, setComentario] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setMensagem(null);
    setEnviando(true);
    try {
      await api.post(`/fornecedores/${fornecedorId}/avaliacoes`, {
        pontualidade: Number(notas.pontualidade),
        qualidade: Number(notas.qualidade),
        atendimento: Number(notas.atendimento),
        comentario: textoOuNulo(comentario),
        recebimentoId,
      });
      aoConcluir();
    } catch (falha) {
      setMensagem(mensagemErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  const opcoes = NOTAS.map((n) => ({ valor: n, rotulo: `${n} de 5` }));

  return (
    <div>
      <p className="compras-ajuda">Como foi esta entrega? A média entra na avaliação do fornecedor.</p>
      <div className="compras-grade-campos">
        <Selecao rotulo="Pontualidade" valor={notas.pontualidade} aoMudar={(v) => setNotas((n) => ({ ...n, pontualidade: v }))} opcoes={opcoes} vazio="Escolha" />
        <Selecao rotulo="Qualidade" valor={notas.qualidade} aoMudar={(v) => setNotas((n) => ({ ...n, qualidade: v }))} opcoes={opcoes} vazio="Escolha" />
        <Selecao rotulo="Atendimento" valor={notas.atendimento} aoMudar={(v) => setNotas((n) => ({ ...n, atendimento: v }))} opcoes={opcoes} vazio="Escolha" />
      </div>
      <AreaTexto rotulo="Comentário (opcional)" valor={comentario} aoMudar={setComentario} linhas={2} />
      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
      <div className="compras-linha-acoes compras-secao">
        <Botao aoClicar={() => void enviar()} desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Registrar avaliação'}
        </Botao>
        <Botao variante="texto" aoClicar={aoConcluir}>
          Pular
        </Botao>
      </div>
    </div>
  );
}
