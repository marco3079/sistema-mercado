import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Modal, Pagina, Selecao, Selo, formatarMoeda } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { ROTULO_STATUS_COTACAO } from './tipos';
import type { CotacaoDetalhe, RetornoRascunho } from './tipos';

// Link público de um fornecedor (a página /cotacao/:token não pede login).
function linkDaCotacao(token: string): string {
  return `${window.location.origin}/cotacao/${token}`;
}

// Número de WhatsApp só com dígitos, com 55 quando faltar o código do país.
function linkWhatsapp(numero: string | null, mensagem: string): string | null {
  if (!numero) return null;
  let digitos = numero.replace(/\D/g, '');
  if (digitos.length === 0) return null;
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// Cotação: comparativo produto × fornecedor (menor preço em verde), links e fechamento.
export function DetalheCotacao() {
  const { id: idTexto } = useParams();
  const id = Number(idTexto);
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();
  const { dados, carregando, erro, recarregar } = useDados<CotacaoDetalhe>(`/cotacoes/${id}`);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const [pedidos, setPedidos] = useState<RetornoRascunho[] | null>(null);

  async function copiarLink(token: string) {
    try {
      await navigator.clipboard.writeText(linkDaCotacao(token));
      setMensagem({ tipo: 'sucesso', texto: 'Link copiado.' });
    } catch {
      setMensagem({ tipo: 'erro', texto: 'Não foi possível copiar. Copie o endereço manualmente.' });
    }
  }

  async function fecharCotacao() {
    if (!window.confirm('Fechar a cotação? Os menores preços viram pedidos em rascunho, um por fornecedor.')) return;
    setMensagem(null);
    setOcupado(true);
    try {
      const criados = await api.post<RetornoRascunho[]>(`/cotacoes/${id}/fechar`, {});
      setPedidos(criados);
      setMensagem({ tipo: 'sucesso', texto: 'Cotação fechada.' });
      recarregar();
    } catch (falha) {
      setMensagem({ tipo: 'erro', texto: mensagemErro(falha) });
    } finally {
      setOcupado(false);
    }
  }

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Pagina titulo="Cotação"><Aviso tipo="erro">{erro}</Aviso></Pagina>;
  if (!dados) return null;

  const aberta = dados.status === 'ABERTA';
  const estado = ROTULO_STATUS_COTACAO[dados.status];
  const melhorDe = (produtoId: number) => dados.melhorPreco.find((m) => m.produtoId === produtoId);

  return (
    <Pagina
      titulo={dados.titulo}
      acoes={
        <>
          <Selo cor={estado.cor}>{estado.rotulo}</Selo>
          {aberta && (
            <Botao variante="secundario" aoClicar={() => setDigitando(true)}>
              Digitar resposta
            </Botao>
          )}
          {aberta && (
            <Botao aoClicar={() => void fecharCotacao()} desabilitado={ocupado}>
              Fechar e gerar pedidos
            </Botao>
          )}
          <Botao variante="secundario" aoClicar={() => navegar(`${raiz}/cotacoes`)}>
            Voltar
          </Botao>
        </>
      }
    >
      {mensagem && <Aviso tipo={mensagem.tipo === 'erro' ? 'erro' : 'sucesso'}>{mensagem.texto}</Aviso>}

      <div className="resumo">
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-azul">
            <Icone nome="calendario" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{dados.prazo ? new Date(dados.prazo).toLocaleDateString('pt-BR') : '—'}</span>
            <span className="resumo-rotulo">Responder até</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-roxo">
            <Icone nome="pacote" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{dados.itens.length}</span>
            <span className="resumo-rotulo">Produtos</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-verde">
            <Icone nome="visto" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">
              {dados.fornecedores.filter((f) => f.respondidoEm).length} de {dados.fornecedores.length}
            </span>
            <span className="resumo-rotulo">Fornecedores responderam</span>
          </div>
        </div>
      </div>

      {pedidos && pedidos.length > 0 && (
        <Aviso tipo="sucesso">
          Pedidos criados em rascunho:{' '}
          {pedidos.map((p, i) => (
            <span key={p.pedidoId}>
              {i > 0 && ', '}
              <button type="button" className="botao-texto" onClick={() => navegar(`${raiz}/pedidos-compra/${p.pedidoId}`)}>
                #{p.numero} ({p.fornecedor})
              </button>
            </span>
          ))}
        </Aviso>
      )}
      {pedidos && pedidos.length === 0 && (
        <Aviso tipo="info">Nenhum pedido criado: nenhum fornecedor respondeu esta cotação.</Aviso>
      )}

      <section className="compras-secao">
        <h2 className="compras-secao-titulo">Fornecedores convidados</h2>
        <p className="compras-ajuda">Envie o link para cada fornecedor responder os preços sem precisar de login.</p>
        <div className="compras-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th scope="col">Resposta</th>
                <th scope="col"><span className="tabela-oculto-visual">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {dados.fornecedores.map((f) => {
                const mensagemWhats = `Olá! Segue o link para enviar seus preços da cotação "${dados.titulo}": ${linkDaCotacao(f.token)}`;
                const whats = linkWhatsapp(f.whatsapp ?? f.telefone, mensagemWhats);
                return (
                  <tr key={f.fornecedorId}>
                    <td>{f.nome}</td>
                    <td>
                      {f.respondidoEm ? (
                        <Selo cor="verde">Respondeu</Selo>
                      ) : (
                        <Selo cor="amarelo">Aguardando</Selo>
                      )}
                    </td>
                    <td>
                      <div className="compras-linha-acoes">
                        <Botao variante="secundario" aoClicar={() => void copiarLink(f.token)}>
                          Copiar link
                        </Botao>
                        {whats ? (
                          <a className="botao botao-secundario" href={whats} target="_blank" rel="noreferrer">
                            Enviar por WhatsApp
                          </a>
                        ) : (
                          <span className="compras-sub">Sem WhatsApp cadastrado</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="compras-secao">
        <h2 className="compras-secao-titulo">Comparativo de preços</h2>
        <p className="compras-ajuda">Em verde, o menor preço de cada produto. O preço é por unidade do produto.</p>
        {dados.itens.length === 0 ? (
          <p className="compras-vazio">Esta cotação não tem produtos.</p>
        ) : (
          <div className="compras-rolagem">
            <table className="compras-matriz">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col" className="compras-numero">Quantidade</th>
                  {dados.fornecedores.map((f) => (
                    <th key={f.fornecedorId} scope="col" className="compras-numero">{f.nome}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((item) => (
                  <tr key={item.produtoId}>
                    <td>
                      <CelulaProduto foto={item.foto} nome={item.nome} setor={item.categoria} tamanho={36} />
                    </td>
                    <td className="compras-numero">
                      {item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unidade.toLowerCase()}
                    </td>
                    {dados.fornecedores.map((f) => {
                      const resposta = dados.respostas.find(
                        (r) => r.produtoId === item.produtoId && r.fornecedorId === f.fornecedorId,
                      );
                      if (!resposta) {
                        return <td key={f.fornecedorId} className="compras-numero">—</td>;
                      }
                      const menor = melhorDe(item.produtoId);
                      const ehMelhor = menor !== undefined && menor.fornecedorId === f.fornecedorId && menor.preco === resposta.preco;
                      return (
                        <td key={f.fornecedorId} className={`compras-numero${ehMelhor ? ' compras-melhor' : ''}`}>
                          {formatarMoeda(resposta.preco)}
                          {resposta.prazoDias !== null && <span className="compras-sub">{resposta.prazoDias} dia(s)</span>}
                          {resposta.vencedora && <span className="compras-vencedora">Vencedor</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {digitando && (
        <Modal aberto={digitando} titulo="Digitar resposta do fornecedor" aoFechar={() => setDigitando(false)}>
          <RespostaManual
            cotacao={dados}
            aoSalvar={() => {
              setDigitando(false);
              setMensagem({ tipo: 'sucesso', texto: 'Resposta registrada.' });
              recarregar();
            }}
          />
        </Modal>
      )}
    </Pagina>
  );
}

// Comprador digita os preços que o fornecedor passou por telefone ou e-mail.
function RespostaManual({ cotacao, aoSalvar }: { cotacao: CotacaoDetalhe; aoSalvar: () => void }) {
  const [fornecedorId, setFornecedorId] = useState('');
  const [precos, setPrecos] = useState<Record<number, { preco: string; prazo: string }>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function definir(produtoId: number, campo: 'preco' | 'prazo', valor: string) {
    setPrecos((atual) => ({ ...atual, [produtoId]: { preco: atual[produtoId]?.preco ?? '', prazo: atual[produtoId]?.prazo ?? '', [campo]: valor } }));
  }

  async function salvar() {
    setMensagem(null);
    if (!fornecedorId) {
      setMensagem('Escolha o fornecedor.');
      return;
    }
    const lista: { produtoId: number; preco: number; prazoDias?: number }[] = [];
    for (const item of cotacao.itens) {
      const linha = precos[item.produtoId];
      if (!linha || linha.preco.trim() === '') continue;
      const preco = lerNumero(linha.preco);
      if (preco === null || preco < 0) {
        setMensagem(`Preço inválido para ${item.nome}.`);
        return;
      }
      const prazo = linha.prazo.trim() === '' ? undefined : lerNumero(linha.prazo);
      if (prazo !== undefined && (prazo === null || !Number.isInteger(prazo) || prazo < 0)) {
        setMensagem(`Prazo inválido para ${item.nome}.`);
        return;
      }
      lista.push({ produtoId: item.produtoId, preco, prazoDias: prazo });
    }
    if (lista.length === 0) {
      setMensagem('Informe ao menos um preço.');
      return;
    }
    setEnviando(true);
    try {
      await api.post(`/cotacoes/${cotacao.id}/respostas`, { fornecedorId: Number(fornecedorId), precos: lista });
      aoSalvar();
    } catch (falha) {
      setMensagem(mensagemErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <Selecao
        rotulo="Fornecedor"
        valor={fornecedorId}
        aoMudar={setFornecedorId}
        opcoes={cotacao.fornecedores.map((f) => ({ valor: String(f.fornecedorId), rotulo: f.nome }))}
        vazio="Escolha o fornecedor"
        obrigatorio
      />
      <div className="compras-rolagem compras-secao">
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col" className="tabela-alinhar-direita">Preço (R$)</th>
              <th scope="col" className="tabela-alinhar-direita">Prazo (dias)</th>
            </tr>
          </thead>
          <tbody>
            {cotacao.itens.map((item) => (
              <tr key={item.produtoId}>
                <td>
                  <CelulaProduto foto={item.foto} nome={item.nome} setor={item.categoria} tamanho={36} />
                </td>
                <td className="tabela-alinhar-direita">
                  <input
                    className="compras-input compras-input-curto"
                    inputMode="decimal"
                    value={precos[item.produtoId]?.preco ?? ''}
                    onChange={(e) => definir(item.produtoId, 'preco', e.target.value)}
                    aria-label={`Preço de ${item.nome}`}
                  />
                </td>
                <td className="tabela-alinhar-direita">
                  <input
                    className="compras-input compras-input-curto"
                    inputMode="numeric"
                    value={precos[item.produtoId]?.prazo ?? ''}
                    onChange={(e) => definir(item.produtoId, 'prazo', e.target.value)}
                    aria-label={`Prazo de ${item.nome}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
      <div className="compras-linha-acoes compras-secao">
        <Botao aoClicar={() => void salvar()} desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar resposta'}
        </Botao>
      </div>
    </div>
  );
}
