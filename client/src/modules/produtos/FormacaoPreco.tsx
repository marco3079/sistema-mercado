import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import type { CategoriaDTO, ConfiguracaoPublicaDTO, FormacaoLinhaDTO } from './tipos';
import { corDaMargem, margemDe, numeroParaCampo, useProdutosCompletos } from './tipos';
import './produtos.css';

// Formação de preço: escolhe a margem desejada, vê o preço sugerido e grava só os preços que mudaram.
export function TelaFormacaoPreco() {
  const config = useDados<ConfiguracaoPublicaDTO>('/configuracoes/mercado/publico');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const todos = useProdutosCompletos();

  const [categoriaId, setCategoriaId] = useState('');
  const [margemTexto, setMargemTexto] = useState('');
  // Preços digitados, por produtoId. Fica aqui (e não na Tabela), então não se perde ao trocar de página.
  const [novos, setNovos] = useState<Record<number, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro' | 'info'; texto: string } | null>(null);

  // A margem começa com a padrão da configuração do mercado.
  useEffect(() => {
    if (config.dados && margemTexto === '') {
      setMargemTexto(numeroParaCampo(config.dados.margemPadrao, 2));
    }
  }, [config.dados, margemTexto]);

  const margem = lerNumero(margemTexto);
  const partes: string[] = [];
  if (categoriaId) partes.push(`categoriaId=${categoriaId}`);
  if (margem !== null) partes.push(`margem=${margem}`);
  const caminho = `/produtos/formacao-preco${partes.length ? `?${partes.join('&')}` : ''}`;

  const { dados, carregando, erro, recarregar } = useDados<FormacaoLinhaDTO[]>(caminho);

  // A formação de preço não traz a foto: busca na lista completa de produtos pelo id.
  const produtoPorId = new Map((todos.dados ?? []).map((p) => [p.id, p]));

  // Linhas com preço digitado diferente do atual.
  const alterados = (dados ?? []).flatMap((linha) => {
    const texto = novos[linha.id];
    if (texto === undefined || texto.trim() === '') return [];
    const valor = lerNumero(texto);
    if (valor === null || valor < 0) return [{ linha, valor: NaN }];
    return Math.round(valor * 100) !== Math.round(linha.precoVenda * 100) ? [{ linha, valor }] : [];
  });
  const invalido = alterados.find((a) => Number.isNaN(a.valor));

  function aplicarSugestoes() {
    const proximos: Record<number, string> = {};
    for (const linha of dados ?? []) proximos[linha.id] = numeroParaCampo(linha.precoSugerido, 2);
    setNovos(proximos);
  }

  async function salvar() {
    setAviso(null);
    if (invalido) {
      setAviso({ tipo: 'erro', texto: `Preço inválido em ${invalido.linha.nome}.` });
      return;
    }
    if (alterados.length === 0) {
      setAviso({ tipo: 'info', texto: 'Nenhum preço foi alterado.' });
      return;
    }
    setEnviando(true);
    try {
      const r = await api.post<{ alterados: number }>('/produtos/formacao-preco', {
        itens: alterados.map((a) => ({ produtoId: a.linha.id, precoVenda: a.valor })),
      });
      setAviso({
        tipo: 'sucesso',
        texto: `${r.alterados} preços alterados — etiquetas pendentes criadas.`,
      });
      setNovos({});
      recarregar();
      todos.recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setEnviando(false);
    }
  }

  const colunas: ColunaTabela<FormacaoLinhaDTO>[] = [
    {
      titulo: 'Produto',
      celula: (l) => (
        <CelulaProduto
          foto={produtoPorId.get(l.id)?.foto ?? null}
          nome={l.nome}
          setor={l.categoria}
          detalhe={l.codigo}
        />
      ),
    },
    { titulo: 'Custo', alinhar: 'direita', celula: (l) => <span className="numero">{formatarMoeda(l.precoCusto)}</span> },
    { titulo: 'Preço atual', alinhar: 'direita', celula: (l) => <span className="numero">{formatarMoeda(l.precoVenda)}</span> },
    {
      titulo: 'Margem atual',
      alinhar: 'direita',
      celula: (l) => <Selo cor={corDaMargem(l.margemAtual)}>{formatarPercentual(l.margemAtual)}</Selo>,
    },
    { titulo: 'Sugerido', alinhar: 'direita', celula: (l) => <span className="numero">{formatarMoeda(l.precoSugerido)}</span> },
    {
      titulo: 'Novo preço',
      alinhar: 'direita',
      celula: (l) => {
        const texto = novos[l.id] ?? '';
        const valor = lerNumero(texto);
        const invalidoAqui = texto.trim() !== '' && (valor === null || valor < 0);
        const mudou = !invalidoAqui && valor !== null && Math.round(valor * 100) !== Math.round(l.precoVenda * 100);
        return (
          <div className={mudou ? 'produtos-novo-preco produtos-novo-diferente' : 'produtos-novo-preco'}>
            <input
              className="campo-controle produtos-input-preco"
              inputMode="decimal"
              aria-label={`Novo preço de ${l.nome}`}
              value={texto}
              placeholder={numeroParaCampo(l.precoVenda, 2)}
              onChange={(e) => setNovos((atual) => ({ ...atual, [l.id]: e.target.value }))}
            />
            {invalidoAqui && <span className="produtos-novo-margem produtos-erro-texto">Valor inválido</span>}
            {!invalidoAqui && valor !== null && texto.trim() !== '' && (
              <span className="produtos-novo-margem">Margem {formatarPercentual(margemDe(l.precoCusto, valor))}</span>
            )}
          </div>
        );
      },
    },
  ];

  const contagem = alterados.length === 1 ? '1 preço alterado' : `${alterados.length} preços alterados`;

  return (
    <Pagina titulo="Formação de preço">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Aviso tipo="info">
        A sugestão é o custo mais a margem desejada, arredondada conforme a configuração do mercado. Nada é gravado
        até você clicar em Salvar preços.
      </Aviso>

      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Selecao
              rotulo="Categoria"
              valor={categoriaId}
              aoMudar={(v) => {
                setCategoriaId(v);
                setNovos({});
              }}
              opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              vazio="Todas"
            />
            <Campo rotulo="Margem desejada (%)" valor={margemTexto} aoMudar={setMargemTexto} />
          </div>
          <Botao variante="secundario" desabilitado={!dados || dados.length === 0} aoClicar={aplicarSugestoes}>
            Aplicar sugestão em todos
          </Botao>
          <Botao variante="texto" desabilitado={Object.keys(novos).length === 0} aoClicar={() => setNovos({})}>
            Limpar digitação
          </Botao>
        </div>

        {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <>
            <Tabela
              colunas={colunas}
              dados={dados}
              chave={(l) => l.id}
              vazio="Nenhum produto ativo encontrado para esta categoria."
            />
            <div className="produtos-rodape-sticky">
              <span>{contagem}</span>
              <Botao aoClicar={salvar} desabilitado={enviando || alterados.length === 0}>
                Salvar preços
              </Botao>
            </div>
          </>
        )}
      </Cartao>
    </Pagina>
  );
}
