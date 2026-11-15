import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, formatarQuantidade, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { FichaProduto } from './FichaProduto';
import type { CategoriaDTO, ListaProdutosDTO, ProdutoDTO } from './tipos';
import { PODE_EDITAR_PRODUTO, corDaMargem } from './tipos';
import './produtos.css';

const POR_PAGINA = 50;

// Opções de tipo; vazio = todos os tipos.
const TIPOS = [
  { valor: 'revenda', rotulo: 'Revenda' },
  { valor: 'insumo', rotulo: 'Insumo' },
  { valor: 'producao', rotulo: 'Produção própria' },
  { valor: 'pesavel', rotulo: 'Pesável (balança)' },
];

// Situação: '1' ativos, '0' inativos, 'todos' sem filtro (vazio no select).
const SITUACOES = [
  { valor: '1', rotulo: 'Ativos' },
  { valor: '0', rotulo: 'Inativos' },
];

// Filtro de tipo vira os parâmetros da API (insumo, produzido, pesavel).
function parametrosDoTipo(tipo: string): string[] {
  switch (tipo) {
    case 'revenda':
      return ['insumo=0', 'produzido=0'];
    case 'insumo':
      return ['insumo=1'];
    case 'producao':
      return ['produzido=1'];
    case 'pesavel':
      return ['pesavel=1'];
    default:
      return [];
  }
}

export function TelaProdutos() {
  const { usuario } = useAuth();
  const podeEditar = usuario ? PODE_EDITAR_PRODUTO.includes(usuario.perfil) : false;
  const ehGestor = usuario?.perfil === 'GESTOR';

  const [buscaDigitada, setBuscaDigitada] = useState('');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [tipo, setTipo] = useState('');
  const [situacao, setSituacao] = useState('1');
  const [pagina, setPagina] = useState(1);
  const [ficha, setFicha] = useState<{ id: number | null } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [higienizando, setHigienizando] = useState(false);

  // A busca espera a pessoa parar de digitar; volta para a primeira página.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setBusca(buscaDigitada.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [buscaDigitada]);

  const partes = [`pagina=${pagina}`, `porPagina=${POR_PAGINA}`, `ativo=${situacao || 'todos'}`];
  if (busca) partes.push(`busca=${encodeURIComponent(busca)}`);
  if (categoriaId) partes.push(`categoriaId=${categoriaId}`);
  partes.push(...parametrosDoTipo(tipo));
  const caminho = `/produtos?${partes.join('&')}`;

  const { dados, carregando, erro, recarregar } = useDados<ListaProdutosDTO>(caminho);
  const categorias = useDados<CategoriaDTO[]>('/categorias');

  const total = dados?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

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
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setHigienizando(false);
    }
  }

  const colunas: ColunaTabela<ProdutoDTO>[] = [
    { titulo: 'Código', celula: (p) => p.codigo },
    { titulo: 'EAN', celula: (p) => p.ean ?? '-' },
    {
      titulo: 'Nome',
      celula: (p) => (
        <>
          <strong>{p.nome}</strong>
          {p.marca && <span className="produtos-marca"> · {p.marca}</span>}
          {p.pesavel && p.codigoBalanca !== null && <span className="produtos-plu"> PLU {p.codigoBalanca}</span>}
        </>
      ),
    },
    { titulo: 'Categoria', celula: (p) => p.categoria ?? '-' },
    { titulo: 'Unidade', celula: (p) => p.unidade },
    { titulo: 'Custo', alinhar: 'direita', celula: (p) => formatarMoeda(p.precoCusto) },
    { titulo: 'Venda', alinhar: 'direita', celula: (p) => formatarMoeda(p.precoVenda) },
    {
      titulo: 'Margem',
      alinhar: 'direita',
      celula: (p) => <Selo cor={corDaMargem(p.margem)}>{formatarPercentual(p.margem)}</Selo>,
    },
    {
      titulo: 'Estoque na loja',
      alinhar: 'direita',
      celula: (p) => {
        const texto = formatarQuantidade(p.estoqueLoja, p.unidade);
        return p.estoqueLoja < p.estoqueMinimo ? <Selo cor="vermelho">{texto}</Selo> : texto;
      },
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (p) => (
        <Botao variante="texto" aoClicar={() => setFicha({ id: p.id })}>
          {podeEditar ? 'Editar' : 'Ver'}
        </Botao>
      ),
    },
  ];

  return (
    <Pagina
      titulo="Produtos"
      acoes={
        <>
          {ehGestor && (
            <Botao variante="secundario" desabilitado={higienizando} aoClicar={higienizar}>
              Higienizar dados fiscais
            </Botao>
          )}
          {podeEditar && <Botao aoClicar={() => setFicha({ id: null })}>Novo produto</Botao>}
        </>
      }
    >
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}

      <Cartao>
        <div className="filtros produtos-filtros">
          <Campo rotulo="Buscar" valor={buscaDigitada} aoMudar={setBuscaDigitada} />
          <Selecao
            rotulo="Categoria"
            valor={categoriaId}
            aoMudar={(v) => {
              setCategoriaId(v);
              setPagina(1);
            }}
            opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
            vazio="Todas"
          />
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={(v) => {
              setTipo(v);
              setPagina(1);
            }}
            opcoes={TIPOS}
            vazio="Todos os tipos"
          />
          <Selecao
            rotulo="Situação"
            valor={situacao}
            aoMudar={(v) => {
              setSituacao(v);
              setPagina(1);
            }}
            opcoes={SITUACOES}
            vazio="Todos"
          />
        </div>

        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <>
            <Tabela
              colunas={colunas}
              dados={dados.itens}
              chave={(p) => p.id}
              vazio="Nenhum produto encontrado com esses filtros."
              aoClicarLinha={(p) => setFicha({ id: p.id })}
            />
            <div className="produtos-paginacao">
              <span>
                {total} produto(s) · página {pagina} de {totalPaginas}
              </span>
              <div>
                <Botao variante="secundario" desabilitado={pagina <= 1} aoClicar={() => setPagina((p) => p - 1)}>
                  Anterior
                </Botao>{' '}
                <Botao
                  variante="secundario"
                  desabilitado={pagina >= totalPaginas}
                  aoClicar={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </Botao>
              </div>
            </div>
          </>
        )}
      </Cartao>

      {ficha && (
        <FichaProduto
          produtoId={ficha.id}
          somenteLeitura={!podeEditar}
          aoFechar={() => setFicha(null)}
          aoSalvo={(mensagem) => {
            setAviso({ tipo: 'sucesso', texto: mensagem });
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
