import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import type { CategoriaDTO, ConfiguracaoPublicaDTO, FormacaoLinhaDTO } from './tipos';
import { corDaMargem, numeroParaCampo } from './tipos';
import './produtos.css';

// Formação de preço: escolhe a margem desejada, vê o preço sugerido e grava só os preços que mudaram.
export function TelaFormacaoPreco() {
  const config = useDados<ConfiguracaoPublicaDTO>('/configuracoes/mercado/publico');
  const categorias = useDados<CategoriaDTO[]>('/categorias');

  const [categoriaId, setCategoriaId] = useState('');
  const [margemTexto, setMargemTexto] = useState('');
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
        <>
          <strong>{l.nome}</strong>
          <span className="produtos-marca"> · {l.codigo}</span>
        </>
      ),
    },
    { titulo: 'Categoria', celula: (l) => l.categoria ?? '-' },
    { titulo: 'Custo', alinhar: 'direita', celula: (l) => formatarMoeda(l.precoCusto) },
    { titulo: 'Preço atual', alinhar: 'direita', celula: (l) => formatarMoeda(l.precoVenda) },
    {
      titulo: 'Margem atual',
      alinhar: 'direita',
      celula: (l) => <Selo cor={corDaMargem(l.margemAtual)}>{formatarPercentual(l.margemAtual)}</Selo>,
    },
    { titulo: 'Preço sugerido', alinhar: 'direita', celula: (l) => formatarMoeda(l.precoSugerido) },
    {
      titulo: 'Novo preço',
      celula: (l) => (
        <input
          className="campo-controle produtos-input-preco"
          inputMode="decimal"
          aria-label={`Novo preço de ${l.nome}`}
          value={novos[l.id] ?? ''}
          placeholder={numeroParaCampo(l.precoVenda, 2)}
          onChange={(e) => setNovos((atual) => ({ ...atual, [l.id]: e.target.value }))}
        />
      ),
    },
  ];

  return (
    <Pagina titulo="Formação de preço">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Cartao>
        <div className="filtros produtos-filtros">
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
          <div className="produtos-acoes-filtro">
            <Botao variante="secundario" desabilitado={!dados || dados.length === 0} aoClicar={aplicarSugestoes}>
              Aplicar sugestão em todos
            </Botao>
            <Botao variante="texto" desabilitado={Object.keys(novos).length === 0} aoClicar={() => setNovos({})}>
              Limpar digitação
            </Botao>
          </div>
        </div>

        {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <>
            {margem !== null && (
              <p className="produtos-legenda">Sugestão com margem de {formatarPercentual(margem)} sobre o custo.</p>
            )}
            <Tabela
              colunas={colunas}
              dados={dados}
              chave={(l) => l.id}
              vazio="Nenhum produto ativo encontrado para esta categoria."
            />
            <div className="produtos-acoes-modal">
              <Botao aoClicar={salvar} desabilitado={enviando || alterados.length === 0}>
                Salvar preços alterados ({alterados.length})
              </Botao>
            </div>
          </>
        )}
      </Cartao>
    </Pagina>
  );
}
