import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, formatarQuantidade, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Cartao, Carregando, MenuAcoes, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { BarraNivel, CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { FichaProduto } from './FichaProduto';
import type { CategoriaDTO, ProdutoDTO } from './tipos';
import { PODE_EDITAR_PRODUTO, corDaMargem, useProdutosCompletos } from './tipos';
import './produtos.css';

// Opções de tipo; vazio = todos os tipos.
const TIPOS = [
  { valor: 'revenda', rotulo: 'Revenda' },
  { valor: 'insumo', rotulo: 'Insumo' },
  { valor: 'producao', rotulo: 'Produção própria' },
  { valor: 'pesavel', rotulo: 'Pesável (balança)' },
];

// Situação: '1' ativos, '0' inativos, '' todos.
const SITUACOES = [
  { valor: '1', rotulo: 'Ativos' },
  { valor: '0', rotulo: 'Inativos' },
];

// Filtra a lista já carregada (busca, categoria, tipo e situação).
function filtrarProdutos(lista: ProdutoDTO[], busca: string, categoriaId: string, tipo: string, situacao: string) {
  const termo = busca.trim().toLowerCase();
  return lista.filter((p) => {
    if (situacao === '1' && !p.ativo) return false;
    if (situacao === '0' && p.ativo) return false;
    if (categoriaId && p.categoriaId !== Number(categoriaId)) return false;
    if (tipo === 'revenda' && (p.insumo || p.produzido)) return false;
    if (tipo === 'insumo' && !p.insumo) return false;
    if (tipo === 'producao' && !p.produzido) return false;
    if (tipo === 'pesavel' && !p.pesavel) return false;
    if (termo && !`${p.nome} ${p.codigo} ${p.ean ?? ''}`.toLowerCase().includes(termo)) return false;
    return true;
  });
}

// Cartão de número do topo (mesmo padrão do Estoque).
function Indicador({ rotulo, valor, cor, icone }: { rotulo: string; valor: string; cor: string; icone: NomeIcone }) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`}>
        <Icone nome={icone} tamanho={22} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

export function TelaProdutos() {
  const { usuario } = useAuth();
  const podeEditar = usuario ? PODE_EDITAR_PRODUTO.includes(usuario.perfil) : false;
  const ehGestor = usuario?.perfil === 'GESTOR';

  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [tipo, setTipo] = useState('');
  const [situacao, setSituacao] = useState('1');
  const [ficha, setFicha] = useState<{ id: number | null; aba?: string } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [higienizando, setHigienizando] = useState(false);

  const todos = useProdutosCompletos();
  const categorias = useDados<CategoriaDTO[]>('/categorias');

  const ativos = (todos.dados ?? []).filter((p) => p.ativo);
  const abaixoDoMinimo = ativos.filter((p) => p.estoqueLoja < p.estoqueMinimo).length;
  const semFoto = ativos.filter((p) => !p.foto).length;
  const margemMedia = ativos.length > 0 ? ativos.reduce((soma, p) => soma + p.margem, 0) / ativos.length : 0;
  const lista = filtrarProdutos(todos.dados ?? [], busca, categoriaId, tipo, situacao);

  async function higienizar() {
    const ok = window.confirm(
      'Preencher NCM, CFOP e CSOSN vazios dos produtos ativos com os padrões da configuração? (simulado)',
    );
    if (!ok) return;
    setHigienizando(true);
    setAviso(null);
    try {
      const r = await api.post<{ atualizados: number; simulado: boolean }>('/produtos/higienizar-fiscal');
      setAviso({ tipo: 'sucesso', texto: `${r.atualizados} produto(s) higienizado(s). Simulado: nada foi enviado ao Mix Fiscal.` });
      todos.recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setHigienizando(false);
    }
  }

  async function alternarAtivo(p: ProdutoDTO) {
    const pergunta = p.ativo ? `Desativar o produto ${p.nome}?` : `Ativar o produto ${p.nome}?`;
    if (!window.confirm(pergunta)) return;
    setAviso(null);
    try {
      await api.put<ProdutoDTO>(`/produtos/${p.id}`, { ativo: !p.ativo });
      setAviso({ tipo: 'sucesso', texto: `Produto ${p.nome} ${p.ativo ? 'desativado' : 'ativado'}.` });
      todos.recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  const colunas: ColunaTabela<ProdutoDTO>[] = [
    {
      titulo: 'Produto',
      celula: (p) => (
        <CelulaProduto
          foto={p.foto}
          nome={p.nome}
          setor={p.categoria}
          detalhe={`${p.codigo} · ${p.ean ?? 'sem EAN'}`}
          extra={p.pesavel && p.codigoBalanca !== null ? <Selo cor="azul">PLU {p.codigoBalanca}</Selo> : undefined}
        />
      ),
    },
    { titulo: 'Categoria', celula: (p) => p.categoria ?? '-' },
    { titulo: 'Unidade', celula: (p) => p.unidade.toLowerCase() },
    { titulo: 'Custo', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.precoCusto)}</span> },
    { titulo: 'Venda', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.precoVenda)}</span> },
    {
      titulo: 'Margem',
      alinhar: 'direita',
      celula: (p) => <Selo cor={corDaMargem(p.margem)}>{formatarPercentual(p.margem)}</Selo>,
    },
    {
      titulo: 'Estoque na loja',
      alinhar: 'direita',
      celula: (p) => {
        const abaixo = p.estoqueLoja < p.estoqueMinimo;
        const meta = p.estoqueMinimo * 3;
        return (
          <div className="produtos-estoque">
            <span className={abaixo ? 'numero produtos-estoque-baixo' : 'numero'}>
              {formatarQuantidade(p.estoqueLoja, p.unidade)}
            </span>
            <BarraNivel valor={p.estoqueLoja} maximo={meta} cor={abaixo ? 'vermelho' : 'verde'} />
          </div>
        );
      },
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (p) => {
        const itens: { rotulo: string; icone: NomeIcone; perigo?: boolean; aoClicar: () => void }[] = [
          { rotulo: 'Ver histórico', icone: 'lista', aoClicar: () => setFicha({ id: p.id, aba: 'historico' }) },
        ];
        if (podeEditar) {
          itens.push({
            rotulo: p.ativo ? 'Desativar' : 'Ativar',
            icone: p.ativo ? 'menos' : 'mais-circulo',
            perigo: p.ativo,
            aoClicar: () => alternarAtivo(p),
          });
        }
        return (
          <div className="acoes-linha">
            <Botao variante="secundario" aoClicar={() => setFicha({ id: p.id })}>
              {podeEditar ? 'Editar' : 'Ver'}
            </Botao>
            <MenuAcoes rotulo={`Mais ações de ${p.nome}`} acoes={itens} />
          </div>
        );
      },
    },
  ];

  let conteudo: ReactNode = null;
  if (todos.carregando && !todos.dados) {
    conteudo = <Carregando />;
  } else if (todos.erro && !todos.dados) {
    conteudo = <Aviso tipo="erro">{todos.erro}</Aviso>;
  } else if (todos.dados) {
    conteudo = (
      <Tabela
        colunas={colunas}
        dados={lista}
        chave={(p) => p.id}
        vazio="Nenhum produto encontrado com esses filtros."
        aoClicarLinha={(p) => setFicha({ id: p.id })}
      />
    );
  }

  return (
    <Pagina
      titulo="Produtos"
      acoes={
        <>
          {ehGestor && (
            <MenuAcoes
              rotulo="Mais ações de produtos"
              acoes={[
                {
                  rotulo: higienizando ? 'Higienizando...' : 'Higienizar dados fiscais',
                  icone: 'engrenagem',
                  aoClicar: higienizar,
                },
              ]}
            />
          )}
          {podeEditar && <Botao aoClicar={() => setFicha({ id: null })}>Novo produto</Botao>}
        </>
      }
    >
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}

      {todos.dados && (
        <div className="resumo">
          <Indicador rotulo="Produtos ativos" valor={String(ativos.length)} cor="azul" icone="lista" />
          <Indicador rotulo="Abaixo do mínimo" valor={String(abaixoDoMinimo)} cor="vermelho" icone="pacote" />
          <Indicador rotulo="Sem foto" valor={String(semFoto)} cor="laranja" icone="imagem" />
          <Indicador rotulo="Margem média" valor={formatarPercentual(margemMedia)} cor="verde" icone="porcentagem" />
        </div>
      )}

      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros produtos-filtros">
            <label className="campo produtos-busca">
              <span className="campo-rotulo">Buscar</span>
              <input
                className="campo-controle"
                type="search"
                placeholder="Buscar por nome, código ou EAN"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
            <Selecao
              rotulo="Categoria"
              valor={categoriaId}
              aoMudar={setCategoriaId}
              opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              vazio="Todas"
            />
            <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS} vazio="Todos os tipos" />
            <Selecao rotulo="Situação" valor={situacao} aoMudar={setSituacao} opcoes={SITUACOES} vazio="Todas" />
          </div>
        </div>

        {conteudo}
      </Cartao>

      {ficha && (
        <FichaProduto
          produtoId={ficha.id}
          abaInicial={ficha.aba}
          somenteLeitura={!podeEditar}
          aoFechar={() => setFicha(null)}
          aoSalvo={(mensagem) => {
            setAviso({ tipo: 'sucesso', texto: mensagem });
            todos.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
