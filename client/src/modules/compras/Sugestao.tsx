import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { FornecedorLinha, RetornoRascunho, SugestaoDTO } from './tipos';

function numeroParaTexto(n: number): string {
  return String(n).replace('.', ',');
}

// Sugestão de compra: o que falta para cobrir os dias escolhidos. Gera um pedido rascunho por fornecedor.
export function Sugestao() {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();

  const { dados: fornecedores } = useDados<FornecedorLinha[]>('/fornecedores?ativo=true');
  const [fornecedorId, setFornecedorId] = useState('');
  const [dias, setDias] = useState('15');

  const diasNumero = lerNumero(dias);
  const diasValidos = diasNumero !== null && Number.isInteger(diasNumero) && diasNumero >= 1 && diasNumero <= 180;
  const caminho = diasValidos
    ? `/compras/sugestao?dias=${diasNumero}${fornecedorId ? `&fornecedorId=${fornecedorId}` : ''}`
    : null;
  const { dados, carregando, erro, recarregar } = useDados<SugestaoDTO[]>(caminho);

  // Quantidade editável e marcação de cada linha (chave: produto).
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [marcados, setMarcados] = useState<Record<number, boolean>>({});
  const [criados, setCriados] = useState<RetornoRascunho[] | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    if (!dados) return;
    const q: Record<number, string> = {};
    const m: Record<number, boolean> = {};
    for (const s of dados) {
      q[s.produtoId] = numeroParaTexto(s.sugerido);
      m[s.produtoId] = s.fornecedorId !== null;
    }
    setQuantidades(q);
    setMarcados(m);
  }, [dados]);

  const linhas = dados ?? [];
  const escolhidas = linhas.filter((s) => marcados[s.produtoId] && s.fornecedorId !== null);
  const valorEscolhido = escolhidas.reduce((soma, s) => {
    const q = lerNumero(quantidades[s.produtoId] ?? '') ?? 0;
    return soma + q * s.ultimoPreco;
  }, 0);
  const fornecedoresEscolhidos = new Set(escolhidas.map((s) => s.fornecedorId)).size;

  async function gerarPedidos() {
    setMensagem(null);
    const itens: { produtoId: number; fornecedorId: number; quantidade: number; precoUnitario: number }[] = [];
    for (const s of escolhidas) {
      const q = lerNumero(quantidades[s.produtoId] ?? '');
      if (q === null || q <= 0) {
        setMensagem(`Confira a quantidade de ${s.nome}.`);
        return;
      }
      itens.push({ produtoId: s.produtoId, fornecedorId: s.fornecedorId as number, quantidade: q, precoUnitario: s.ultimoPreco });
    }
    if (itens.length === 0) {
      setMensagem('Escolha ao menos um item com fornecedor.');
      return;
    }
    setGerando(true);
    try {
      const resposta = await api.post<RetornoRascunho[]>('/compras/sugestao/gerar-pedidos', { itens });
      setCriados(resposta);
      // Recarrega a sugestão: os pedidos recém-criados entram em "Em pedido".
      recarregar();
    } catch (falha) {
      setMensagem(mensagemErro(falha));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Pagina
      titulo="Sugestão de compra"
      acoes={
        <Botao aoClicar={() => void gerarPedidos()} desabilitado={gerando || escolhidas.length === 0}>
          {gerando ? 'Gerando...' : 'Gerar pedidos'}
        </Botao>
      }
    >
      <div className="compras-filtros">
        <Selecao
          rotulo="Fornecedor"
          valor={fornecedorId}
          aoMudar={setFornecedorId}
          opcoes={(fornecedores ?? []).map((f) => ({ valor: String(f.id), rotulo: f.nome }))}
          vazio="Todos os fornecedores"
        />
        <Campo rotulo="Cobrir quantos dias" tipo="number" valor={dias} aoMudar={setDias} />
      </div>

      {!diasValidos && <Aviso tipo="erro">Informe de 1 a 180 dias de cobertura.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}

      {criados && criados.length > 0 && (
        <Aviso tipo="sucesso">
          Pedidos criados em rascunho:{' '}
          {criados.map((p, i) => (
            <span key={p.pedidoId}>
              {i > 0 && ', '}
              <button type="button" className="botao-texto" onClick={() => navegar(`${raiz}/pedidos-compra/${p.pedidoId}`)}>
                #{p.numero} ({p.fornecedor})
              </button>
            </span>
          ))}
        </Aviso>
      )}

      {!dados && carregando && <Carregando />}

      {dados && (
        <>
          <div className="compras-sugestao-resumo">
            <span className="compras-acumulado">
              <span>
                Itens marcados: <strong>{escolhidas.length}</strong> de {linhas.length}
              </span>
              <span>
                Fornecedores: <strong>{fornecedoresEscolhidos}</strong>
              </span>
              <span>
                Valor estimado: <strong>{formatarMoeda(valorEscolhido)}</strong>
              </span>
            </span>
          </div>

          <div className="compras-rolagem">
            <Tabela
              colunas={[
                {
                  titulo: 'Comprar',
                  celula: (s) => (
                    <input
                      type="checkbox"
                      className="compras-caixa-tabela"
                      checked={Boolean(marcados[s.produtoId])}
                      disabled={s.fornecedorId === null}
                      onChange={(e) => setMarcados((atual) => ({ ...atual, [s.produtoId]: e.target.checked }))}
                      aria-label={`Comprar ${s.nome}`}
                    />
                  ),
                },
                {
                  titulo: 'Produto',
                  celula: (s) => (
                    <>
                      {s.nome}
                      <span className="compras-sub">{s.codigo}</span>
                    </>
                  ),
                },
                {
                  titulo: 'Fornecedor',
                  celula: (s) =>
                    s.fornecedor ? s.fornecedor : <Selo cor="amarelo">Sem fornecedor</Selo>,
                },
                { titulo: 'Estoque', alinhar: 'direita', celula: (s) => formatarQuantidade(s.estoque, s.unidade) },
                { titulo: 'Mínimo', alinhar: 'direita', celula: (s) => formatarQuantidade(s.estoqueMinimo, s.unidade) },
                { titulo: 'Venda/dia', alinhar: 'direita', celula: (s) => formatarQuantidade(s.giroDiario, s.unidade) },
                { titulo: 'Em pedido', alinhar: 'direita', celula: (s) => formatarQuantidade(s.emPedido, s.unidade) },
                {
                  titulo: 'Quantidade',
                  alinhar: 'direita',
                  celula: (s) => (
                    <input
                      className="compras-input compras-input-curto"
                      inputMode="decimal"
                      value={quantidades[s.produtoId] ?? ''}
                      onChange={(e) => setQuantidades((atual) => ({ ...atual, [s.produtoId]: e.target.value }))}
                      aria-label={`Quantidade de ${s.nome}`}
                    />
                  ),
                },
                {
                  titulo: 'Valor estimado',
                  alinhar: 'direita',
                  celula: (s) => formatarMoeda((lerNumero(quantidades[s.produtoId] ?? '') ?? 0) * s.ultimoPreco),
                },
              ]}
              dados={linhas}
              chave={(s) => s.produtoId}
              vazio="Nada a comprar agora: o estoque cobre os dias escolhidos."
            />
          </div>
        </>
      )}
    </Pagina>
  );
}
