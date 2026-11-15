import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, hojeIso } from '../../lib/mercado';
import { Abas, Aviso, Campo, Carregando, Cartao, Pagina, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { LucroCategoria, LucroDTO, LucroProduto } from './tipos';

type Atalho = 'hoje' | '7dias' | 'mes' | 'mespassado' | 'personalizado';

function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Datas do atalho escolhido (AAAA-MM-DD). "personalizado" usa as datas digitadas.
function intervaloDo(atalho: Atalho, de: string, ate: string): { de: string; ate: string } {
  const agora = new Date();
  if (atalho === 'hoje') return { de: isoDe(agora), ate: isoDe(agora) };
  if (atalho === '7dias') return { de: hojeIso(-6), ate: hojeIso() };
  if (atalho === 'mes') return { de: isoDe(new Date(agora.getFullYear(), agora.getMonth(), 1)), ate: isoDe(agora) };
  if (atalho === 'mespassado') {
    return {
      de: isoDe(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)),
      ate: isoDe(new Date(agora.getFullYear(), agora.getMonth(), 0)),
    };
  }
  return { de, ate };
}

const colunasCategoria: ColunaTabela<LucroCategoria>[] = [
  { titulo: 'Categoria', celula: (c) => c.categoria },
  { titulo: 'Faturamento', alinhar: 'direita', celula: (c) => formatarMoeda(c.faturamento) },
  { titulo: 'Custo', alinhar: 'direita', celula: (c) => formatarMoeda(c.custo) },
  { titulo: 'Lucro', alinhar: 'direita', celula: (c) => formatarMoeda(c.lucro) },
  { titulo: 'Margem', alinhar: 'direita', celula: (c) => formatarPercentual(c.margem) },
];

const colunasProduto: ColunaTabela<LucroProduto>[] = [
  { titulo: 'Produto', celula: (p) => p.produto },
  { titulo: 'Qtd.', alinhar: 'direita', celula: (p) => p.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) },
  { titulo: 'Faturamento', alinhar: 'direita', celula: (p) => formatarMoeda(p.faturamento) },
  { titulo: 'Lucro', alinhar: 'direita', celula: (p) => formatarMoeda(p.lucro) },
  { titulo: 'Margem', alinhar: 'direita', celula: (p) => formatarPercentual(p.margem) },
];

// Meu Lucro (só GESTOR): faturamento, custo, lucro bruto e líquido do período.
export function MeuLucro() {
  const [atalho, setAtalho] = useState<Atalho>('mes');
  const [deManual, setDeManual] = useState(hojeIso());
  const [ateManual, setAteManual] = useState(hojeIso());
  const periodo = intervaloDo(atalho, deManual, ateManual);
  const lucro = useDados<LucroDTO>(`/lucro?inicio=${periodo.de}&fim=${periodo.ate}`);
  const dados = lucro.dados;

  return (
    <Pagina titulo="Meu Lucro">
      <Abas
        abas={[
          { id: 'hoje', rotulo: 'Hoje' },
          { id: '7dias', rotulo: '7 dias' },
          { id: 'mes', rotulo: 'Mês atual' },
          { id: 'mespassado', rotulo: 'Mês passado' },
          { id: 'personalizado', rotulo: 'Personalizado' },
        ]}
        ativa={atalho}
        aoMudar={(id) => setAtalho(id as Atalho)}
      />
      {atalho === 'personalizado' && (
        <div className="financeiro-datas financeiro-periodo">
          <Campo rotulo="De" tipo="date" valor={deManual} aoMudar={setDeManual} obrigatorio />
          <Campo rotulo="Até" tipo="date" valor={ateManual} aoMudar={setAteManual} obrigatorio />
        </div>
      )}

      {lucro.erro && <Aviso tipo="erro">{lucro.erro}</Aviso>}
      {lucro.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="lucro-destaques">
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Faturamento</span>
              <strong className="lucro-valor">{formatarMoeda(dados.faturamento)}</strong>
              <span className="financeiro-detalhe">Vendas concluídas do período</span>
            </div>
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Custo das mercadorias</span>
              <strong className="lucro-valor">{formatarMoeda(dados.custoMercadorias)}</strong>
              <span className="financeiro-detalhe">CMV das vendas</span>
            </div>
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Lucro bruto</span>
              <strong className="lucro-valor">{formatarMoeda(dados.lucroBruto)}</strong>
              <span className="financeiro-detalhe">Margem {formatarPercentual(dados.margemBruta)}</span>
            </div>
          </div>

          <div className="lucro-destaques">
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Despesas pagas</span>
              <strong className="lucro-valor">{formatarMoeda(dados.despesas)}</strong>
              <span className="financeiro-detalhe">Sem compras (já estão no custo)</span>
            </div>
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Perdas</span>
              <strong className="lucro-valor">{formatarMoeda(dados.perdas)}</strong>
              <span className="financeiro-detalhe">Vencido, quebra e avaria</span>
            </div>
            <div className="lucro-cartao">
              <span className="lucro-rotulo">Bonificações</span>
              <strong className="lucro-valor">{formatarMoeda(dados.bonificacoes)}</strong>
              <span className="financeiro-detalhe">Da indústria, já recebidas</span>
            </div>
            <div className="lucro-cartao lucro-cartao-destaque">
              <span className="lucro-rotulo">Lucro líquido</span>
              <strong className="lucro-valor">{formatarMoeda(dados.lucroLiquido)}</strong>
              <span className="financeiro-detalhe">Margem {formatarPercentual(dados.margemLiquida)}</span>
            </div>
          </div>

          <Cartao titulo="Lucro bruto por dia">
            <GraficoLinha pontos={dados.porDia.map((d) => ({ rotulo: `${d.data.slice(8, 10)}/${d.data.slice(5, 7)}`, valor: d.lucroBruto }))} />
          </Cartao>

          <Cartao titulo="Por categoria">
            <Tabela colunas={colunasCategoria} dados={dados.porCategoria} chave={(c) => c.categoria} vazio="Nenhuma venda no período." />
          </Cartao>

          <Cartao titulo="Produtos que mais deram lucro">
            <Tabela colunas={colunasProduto} dados={dados.topProdutos} chave={(p) => p.produtoId} vazio="Nenhuma venda no período." />
          </Cartao>

          <Cartao titulo="Produtos com a menor margem">
            <Tabela colunas={colunasProduto} dados={dados.piores} chave={(p) => p.produtoId} vazio="Nenhuma venda no período." />
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
