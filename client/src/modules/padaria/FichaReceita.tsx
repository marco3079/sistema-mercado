import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, lerNumero, mensagemErro } from '../../lib/mercado';
import { AreaTexto, Aviso, Botao, Campo, Modal, Selecao, formatarMoeda } from '../../ui';
import type { ListaProdutos, ProdutoBusca, ReceitaDTO } from './tipos';
import { CelulaProduto } from '../../ui/FotoProduto';

// Ficha da receita: produto acabado, rendimento, tempos, modo de preparo e insumos com quantidade.
// Custo, custo unitário e margem são recalculados ao vivo a cada mudança.

interface ProdutoEscolhido {
  id: number;
  nome: string;
  unidade: string;
  precoVenda: number;
}

interface LinhaInsumo {
  insumoId: number;
  nome: string;
  unidade: string;
  precoCusto: number;
  quantidade: string;
  foto: string | null;
  categoria: string | null;
}

// Número digitado para o campo (com vírgula). Vazio quando não há valor.
function paraCampo(n: number | null): string {
  return n === null ? '' : String(n).replace('.', ',');
}

// Campo opcional: vazio vira null; inválido ou negativo vira undefined.
function lerOpcional(texto: string): number | null | undefined {
  if (texto.trim() === '') return null;
  const n = lerNumero(texto);
  if (n === null || n < 0) return undefined;
  return Math.round(n);
}

// Busca de produtos (qualquer ativo, ou só insumos), com espera de 300 ms entre as teclas.
function useBuscaProdutos(termo: string, apenasInsumos: boolean): ProdutoBusca[] | null {
  const [resultados, setResultados] = useState<ProdutoBusca[] | null>(null);
  useEffect(() => {
    const texto = termo.trim();
    if (texto.length < 2) {
      setResultados(null);
      return;
    }
    let cancelado = false;
    const espera = window.setTimeout(() => {
      const extra = apenasInsumos ? '&insumo=1' : '';
      api
        .get<ListaProdutos>(`/produtos?busca=${encodeURIComponent(texto)}&porPagina=10${extra}`)
        .then((r) => {
          if (!cancelado) setResultados(r.itens);
        })
        .catch(() => {
          if (!cancelado) setResultados([]);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [termo, apenasInsumos]);
  return resultados;
}

export function FichaReceita({
  receita,
  aoFechar,
  aoSalvo,
}: {
  receita: ReceitaDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  // Produto acabado só se escolhe ao criar; ao editar, ele fica fixo.
  const acabados = useDados<ListaProdutos>(receita ? null : '/produtos?produzido=1&porPagina=200');

  const [produto, setProduto] = useState<ProdutoEscolhido | null>(
    receita
      ? { id: receita.produtoId, nome: receita.produto, unidade: receita.unidade, precoVenda: receita.precoVenda }
      : null
  );
  const [buscaProduto, setBuscaProduto] = useState('');
  const resultadosProduto = useBuscaProdutos(buscaProduto, false);

  const [rendimento, setRendimento] = useState(receita ? paraCampo(receita.rendimento) : '');
  const [tempoPreparo, setTempoPreparo] = useState(receita ? paraCampo(receita.tempoPreparoMin) : '');
  const [tempoForno, setTempoForno] = useState(receita ? paraCampo(receita.tempoFornoMin) : '');
  const [temperatura, setTemperatura] = useState(receita ? paraCampo(receita.temperaturaForno) : '');
  const [modo, setModo] = useState(receita?.modoPreparo ?? '');

  const [linhas, setLinhas] = useState<LinhaInsumo[]>(
    receita
      ? receita.itens.map((i) => ({
          insumoId: i.insumoId,
          nome: i.insumo,
          unidade: i.unidade,
          precoCusto: i.custoUnitario,
          quantidade: paraCampo(i.quantidade),
          foto: i.insumoFoto,
          categoria: i.insumoCategoria,
        }))
      : []
  );
  const [buscaInsumo, setBuscaInsumo] = useState('');
  const resultadosInsumo = useBuscaProdutos(buscaInsumo, true);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Custo ao vivo: Σ(quantidade × custo do insumo); unitário = total / rendimento; margem sobre o preço de venda.
  const rendimentoNum = lerNumero(rendimento) ?? 0;
  const custoTotal = linhas.reduce((soma, l) => soma + (lerNumero(l.quantidade) ?? 0) * l.precoCusto, 0);
  const custoUnitario = rendimentoNum > 0 ? custoTotal / rendimentoNum : null;
  const precoVenda = produto?.precoVenda ?? 0;
  const margem = custoUnitario !== null && precoVenda > 0 ? ((precoVenda - custoUnitario) / precoVenda) * 100 : null;

  function escolherProduto(p: { id: number; nome: string; unidade: string; precoVenda: number }) {
    setProduto({ id: p.id, nome: p.nome, unidade: p.unidade, precoVenda: p.precoVenda });
    setBuscaProduto('');
    setErro(null);
  }

  function escolherPorId(valor: string) {
    const achado = acabados.dados?.itens.find((p) => String(p.id) === valor);
    if (achado) escolherProduto(achado);
  }

  function adicionarInsumo(p: ProdutoBusca) {
    setErro(null);
    if (produto && p.id === produto.id) {
      setErro('O produto não pode ser insumo de si mesmo.');
      return;
    }
    if (linhas.some((l) => l.insumoId === p.id)) {
      setErro(`${p.nome} já está na receita.`);
      return;
    }
    setLinhas((atuais) => [
      ...atuais,
      {
        insumoId: p.id,
        nome: p.nome,
        unidade: p.unidade,
        precoCusto: p.precoCusto,
        quantidade: '',
        foto: p.foto ?? null,
        categoria: p.categoria ?? null,
      },
    ]);
    setBuscaInsumo('');
  }

  function atualizarQuantidade(insumoId: number, quantidade: string) {
    setLinhas((atuais) => atuais.map((l) => (l.insumoId === insumoId ? { ...l, quantidade } : l)));
  }

  function remover(insumoId: number) {
    setLinhas((atuais) => atuais.filter((l) => l.insumoId !== insumoId));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!produto) {
      setErro('Escolha o produto acabado.');
      return;
    }
    const rend = lerNumero(rendimento);
    if (rend === null || rend <= 0) {
      setErro('Informe o rendimento: quantas unidades (ou kg) esta receita faz.');
      return;
    }
    const preparo = lerOpcional(tempoPreparo);
    const forno = lerOpcional(tempoForno);
    const temp = lerOpcional(temperatura);
    if (preparo === undefined || forno === undefined || temp === undefined) {
      setErro('Tempos e temperatura devem ser números positivos.');
      return;
    }
    const itens: { insumoId: number; quantidade: number }[] = [];
    for (const l of linhas) {
      const q = lerNumero(l.quantidade);
      if (q === null || q <= 0) {
        setErro(`Informe a quantidade de ${l.nome}.`);
        return;
      }
      itens.push({ insumoId: l.insumoId, quantidade: q });
    }

    const corpo = {
      rendimento: rend,
      tempoPreparoMin: preparo,
      tempoFornoMin: forno,
      temperaturaForno: temp,
      modoPreparo: modo.trim() || null,
      itens,
    };
    setEnviando(true);
    try {
      if (receita) {
        await api.put<ReceitaDTO>(`/receitas/${receita.id}`, corpo);
      } else {
        await api.post<ReceitaDTO>('/receitas', { produtoId: produto.id, ...corpo });
      }
      aoSalvo(`Receita de ${produto.nome} salva.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  async function excluir() {
    if (!receita) return;
    if (!window.confirm(`Excluir a receita de ${receita.produto}? Não tem volta.`)) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.del(`/receitas/${receita.id}`);
      aoSalvo(`Receita de ${receita.produto} excluída.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const unidadeProduto = produto?.unidade.toLowerCase() ?? '';

  return (
    <Modal aberto titulo={receita ? `Receita · ${receita.produto}` : 'Nova receita'} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="padaria-ficha">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {receita ? (
          <p className="padaria-ajuda">
            Produto: <strong>{receita.produto}</strong>
          </p>
        ) : (
          <>
            {acabados.erro && <Aviso tipo="erro">{acabados.erro}</Aviso>}
            <Selecao
              rotulo="Produto acabado"
              valor={produto ? String(produto.id) : ''}
              aoMudar={escolherPorId}
              opcoes={(acabados.dados?.itens ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
              vazio={acabados.carregando ? 'Carregando produtos...' : 'Escolha o produto'}
            />
            <Campo rotulo="Ou busque outro produto ativo" valor={buscaProduto} aoMudar={setBuscaProduto} />
            {resultadosProduto && (
              <ul className="padaria-resultados">
                {resultadosProduto.length === 0 && <li className="padaria-ajuda">Nenhum produto encontrado.</li>}
                {resultadosProduto.map((p) => (
                  <li key={p.id}>
                    <Botao variante="texto" aoClicar={() => escolherProduto(p)}>
                      <CelulaProduto foto={p.foto} nome={`${p.nome} (${p.unidade.toLowerCase()})`} setor={p.categoria} tamanho={32} />
                    </Botao>
                  </li>
                ))}
              </ul>
            )}
            {produto && <p className="padaria-ajuda">Escolhido: {produto.nome}</p>}
          </>
        )}

        <div className="padaria-grade-campos">
          <Campo
            rotulo={`Rendimento${unidadeProduto ? ` (${unidadeProduto} por receita)` : ''}`}
            valor={rendimento}
            aoMudar={setRendimento}
            obrigatorio
          />
          <Campo rotulo="Tempo de preparo (min)" valor={tempoPreparo} aoMudar={setTempoPreparo} />
          <Campo rotulo="Tempo de forno (min)" valor={tempoForno} aoMudar={setTempoForno} />
          <Campo rotulo="Temperatura do forno (°C)" valor={temperatura} aoMudar={setTemperatura} />
        </div>

        <AreaTexto rotulo="Modo de preparo" valor={modo} aoMudar={setModo} linhas={5} />

        <h3 className="padaria-subtitulo">Insumos</h3>
        <Campo rotulo="Buscar insumo para adicionar" valor={buscaInsumo} aoMudar={setBuscaInsumo} />
        {resultadosInsumo && (
          <ul className="padaria-resultados">
            {resultadosInsumo.length === 0 && <li className="padaria-ajuda">Nenhum insumo encontrado.</li>}
            {resultadosInsumo.map((p) => (
              <li key={p.id}>
                <Botao variante="texto" aoClicar={() => adicionarInsumo(p)}>
                  <CelulaProduto foto={p.foto} nome={`Adicionar ${p.nome} (${p.unidade.toLowerCase()})`} setor={p.categoria} tamanho={32} />
                </Botao>
              </li>
            ))}
          </ul>
        )}

        {linhas.length === 0 ? (
          <p className="padaria-ajuda">Nenhum insumo nesta receita ainda.</p>
        ) : (
          <ul className="padaria-insumos">
            {linhas.map((l) => {
              const q = lerNumero(l.quantidade);
              const custoLinha = q !== null ? q * l.precoCusto : null;
              return (
                <li key={l.insumoId} className="padaria-insumo">
                  <span className="padaria-insumo-nome">
                    <CelulaProduto foto={l.foto} nome={l.nome} setor={l.categoria} tamanho={40} />
                  </span>
                  <span className="padaria-insumo-quantidade">
                    <Campo
                      rotulo={`Quantidade (${l.unidade.toLowerCase()})`}
                      valor={l.quantidade}
                      aoMudar={(v) => atualizarQuantidade(l.insumoId, v)}
                    />
                  </span>
                  <span className="padaria-insumo-custo">
                    {custoLinha !== null ? formatarMoeda(custoLinha) : '—'}
                  </span>
                  <Botao variante="texto" aoClicar={() => remover(l.insumoId)}>
                    Remover
                  </Botao>
                </li>
              );
            })}
          </ul>
        )}

        <div className="padaria-totais">
          <span>Custo total: {linhas.length > 0 ? formatarMoeda(custoTotal) : '—'}</span>
          <span>Custo unitário: {custoUnitario !== null ? formatarMoeda(custoUnitario) : '—'}</span>
          <span>
            Margem: {margem !== null ? formatarPercentual(margem) : 'sem preço de venda'}
          </span>
        </div>

        <div className="padaria-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando || (!receita && !produto)}>
            Salvar receita
          </Botao>
          {receita && (
            <Botao variante="perigo" desabilitado={enviando} aoClicar={excluir}>
              Excluir
            </Botao>
          )}
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
