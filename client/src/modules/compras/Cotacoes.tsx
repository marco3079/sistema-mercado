import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Caixa, Campo, Carregando, Modal, Pagina, Selo, formatarData } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { BuscaProduto } from './PedidosCompra';
import { ROTULO_STATUS_COTACAO } from './tipos';
import type { CotacaoDetalhe, CotacaoLinha, FornecedorLinha, ProdutoBuscaDTO } from './tipos';

// Lista de cotações. Cada cotação pede preço a fornecedores por um link público.
export function Cotacoes() {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();
  const { dados, carregando, erro } = useDados<CotacaoLinha[]>('/cotacoes');
  const [nova, setNova] = useState(false);

  return (
    <Pagina titulo="Cotações" acoes={<Botao aoClicar={() => setNova(true)}>Nova cotação</Botao>}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && (
        <div className="resumo">
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-azul">
              <Icone nome="documento" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">{dados.filter((c) => c.status === 'ABERTA').length}</span>
              <span className="resumo-rotulo">Abertas</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-laranja">
              <Icone nome="relogio" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">
                {dados.reduce((soma, c) => soma + (c.fornecedores - c.respondidos), 0)}
              </span>
              <span className="resumo-rotulo">Respostas pendentes</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-verde">
              <Icone nome="visto" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">{dados.filter((c) => c.status === 'FECHADA').length}</span>
              <span className="resumo-rotulo">Fechadas</span>
            </div>
          </div>
        </div>
      )}

      {dados && dados.length === 0 && (
        <p className="tabela-vazia">Nenhuma cotação ainda. Crie uma para pedir preços a fornecedores.</p>
      )}

      {dados && dados.length > 0 && (
        <div className="grade-produtos">
          {dados.map((c) => (
            <article key={c.id} className="cartao-produto compras-cotacao">
              <div className="compras-cotacao-topo">
                <strong className="compras-cotacao-titulo">{c.titulo}</strong>
                <Selo cor={ROTULO_STATUS_COTACAO[c.status].cor}>{ROTULO_STATUS_COTACAO[c.status].rotulo}</Selo>
              </div>
              <p className="compras-ajuda">
                {c.itens} produto(s) · criada em {formatarData(c.criadoEm)}
              </p>
              <p className="compras-ajuda">
                Prazo: {c.prazo ? formatarData(c.prazo) : 'sem prazo'} · Respostas: {c.respondidos} de {c.fornecedores}
              </p>
              <div className="cartao-produto-rodape">
                <Botao variante="secundario" aoClicar={() => navegar(`${raiz}/cotacoes/${c.id}`)}>
                  Abrir
                </Botao>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal aberto={nova} titulo="Nova cotação" aoFechar={() => setNova(false)}>
        {nova && <NovaCotacao aoCriar={(id) => navegar(`${raiz}/cotacoes/${id}`)} />}
      </Modal>
    </Pagina>
  );
}

interface LinhaCotacao {
  produto: ProdutoBuscaDTO;
  quantidade: string;
}

// Escolhe os produtos, as quantidades e os fornecedores convidados.
function NovaCotacao({ aoCriar }: { aoCriar: (id: number) => void }) {
  const { dados: fornecedores, carregando, erro } = useDados<FornecedorLinha[]>('/fornecedores?ativo=true');
  const [titulo, setTitulo] = useState('');
  const [prazo, setPrazo] = useState('');
  const [linhas, setLinhas] = useState<LinhaCotacao[]>([]);
  const [convidados, setConvidados] = useState<number[]>([]);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function adicionar(p: ProdutoBuscaDTO) {
    if (linhas.some((l) => l.produto.id === p.id)) return;
    setLinhas((atual) => [...atual, { produto: p, quantidade: '1' }]);
  }

  function alternarFornecedor(id: number, marcado: boolean) {
    setConvidados((atual) => (marcado ? [...atual, id] : atual.filter((x) => x !== id)));
  }

  async function criar() {
    setMensagem(null);
    if (!titulo.trim()) {
      setMensagem('Informe o título da cotação.');
      return;
    }
    if (linhas.length === 0) {
      setMensagem('Inclua ao menos um produto.');
      return;
    }
    if (convidados.length === 0) {
      setMensagem('Escolha ao menos um fornecedor.');
      return;
    }
    const itens: { produtoId: number; quantidade: number }[] = [];
    for (const l of linhas) {
      const q = lerNumero(l.quantidade);
      if (q === null || q <= 0) {
        setMensagem(`Confira a quantidade de ${l.produto.nome}.`);
        return;
      }
      itens.push({ produtoId: l.produto.id, quantidade: q });
    }
    setEnviando(true);
    try {
      const criada = await api.post<CotacaoDetalhe>('/cotacoes', {
        titulo: titulo.trim(),
        prazo: prazo || null,
        itens,
        fornecedorIds: convidados,
      });
      aoCriar(criada.id);
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
        <Campo rotulo="Título" valor={titulo} aoMudar={setTitulo} obrigatorio />
        <Campo rotulo="Responder até" tipo="date" valor={prazo} aoMudar={setPrazo} />
      </div>

      <div className="compras-secao">
        <h3 className="compras-secao-titulo">Produtos e quantidades</h3>
        <BuscaProduto aoEscolher={adicionar} />
      </div>

      {linhas.length > 0 && (
        <div className="compras-secao compras-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col" className="tabela-alinhar-direita">Quantidade</th>
                <th scope="col"><span className="tabela-oculto-visual">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
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
                      onChange={(e) =>
                        setLinhas((atual) =>
                          atual.map((x) => (x.produto.id === l.produto.id ? { ...x, quantidade: e.target.value } : x)),
                        )
                      }
                      aria-label={`Quantidade de ${l.produto.nome}`}
                    />
                  </td>
                  <td>
                    <Botao
                      variante="texto"
                      aoClicar={() => setLinhas((atual) => atual.filter((x) => x.produto.id !== l.produto.id))}
                    >
                      Remover
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="compras-secao">
        <h3 className="compras-secao-titulo">Fornecedores convidados</h3>
        {(fornecedores ?? []).length === 0 && <p className="compras-vazio">Nenhum fornecedor ativo cadastrado.</p>}
        <div className="compras-grade-campos">
          {(fornecedores ?? []).map((f) => (
            <Caixa
              key={f.id}
              rotulo={f.nome}
              marcado={convidados.includes(f.id)}
              aoMudar={(marcado) => alternarFornecedor(f.id, marcado)}
            />
          ))}
        </div>
      </div>

      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
      <div className="compras-linha-acoes">
        <Botao aoClicar={() => void criar()} desabilitado={enviando}>
          {enviando ? 'Criando...' : 'Criar cotação'}
        </Botao>
      </div>
    </div>
  );
}
