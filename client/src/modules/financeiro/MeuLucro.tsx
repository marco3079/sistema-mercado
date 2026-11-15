import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import { formatarPercentual, hojeIso } from '../../lib/mercado';
import { Abas, Aviso, Campo, Carregando, Cartao, Pagina, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
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

// Cartão de número do topo (classes .resumo da casca).
function Indicador({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'verde' | 'laranja' | 'roxo' | 'vermelho';
  valor: string;
  rotulo: string;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

const colunasCategoria: ColunaTabela<LucroCategoria>[] = [
  { titulo: 'Categoria', celula: (c) => c.categoria },
  { titulo: 'Faturamento', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.faturamento)}</span> },
  { titulo: 'Custo', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.custo)}</span> },
  { titulo: 'Lucro', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.lucro)}</span> },
  { titulo: 'Margem', alinhar: 'direita', celula: (c) => <span className="numero">{formatarPercentual(c.margem)}</span> },
];

const colunasProduto: ColunaTabela<LucroProduto>[] = [
  {
    titulo: 'Produto',
    celula: (p) => <CelulaProduto foto={p.foto} nome={p.produto} setor={p.categoria} detalhe={p.categoria} />,
  },
  {
    titulo: 'Qtd.',
    alinhar: 'direita',
    celula: (p) => <span className="numero">{p.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</span>,
  },
  { titulo: 'Faturamento', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.faturamento)}</span> },
  { titulo: 'Lucro', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.lucro)}</span> },
  { titulo: 'Margem', alinhar: 'direita', celula: (p) => <span className="numero">{formatarPercentual(p.margem)}</span> },
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
        <div className="barra-ferramentas">
          <div className="filtros">
            <Campo rotulo="De" tipo="date" valor={deManual} aoMudar={setDeManual} obrigatorio />
            <Campo rotulo="Até" tipo="date" valor={ateManual} aoMudar={setAteManual} obrigatorio />
          </div>
        </div>
      )}

      {lucro.erro && <Aviso tipo="erro">{lucro.erro}</Aviso>}
      {lucro.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="resumo">
            <Indicador icone="dinheiro" cor="azul" valor={formatarMoeda(dados.faturamento)} rotulo="Faturamento" />
            <Indicador icone="transferir" cor="laranja" valor={formatarMoeda(dados.custoMercadorias)} rotulo="Custo das mercadorias" />
            <Indicador
              icone="grafico"
              cor="verde"
              valor={formatarMoeda(dados.lucroBruto)}
              rotulo={`Lucro bruto · margem ${formatarPercentual(dados.margemBruta)}`}
            />
            <Indicador
              icone="estrela"
              cor="roxo"
              valor={formatarMoeda(dados.lucroLiquido)}
              rotulo={`Lucro líquido · margem ${formatarPercentual(dados.margemLiquida)}`}
            />
          </div>
          <div className="resumo">
            <Indicador icone="dinheiro" cor="vermelho" valor={formatarMoeda(dados.despesas)} rotulo="Despesas pagas" />
            <Indicador icone="relogio" cor="laranja" valor={formatarMoeda(dados.perdas)} rotulo="Perdas" />
            <Indicador icone="visto" cor="verde" valor={formatarMoeda(dados.bonificacoes)} rotulo="Bonificações" />
          </div>
          <p className="financeiro-nota">
            Despesas sem compras (já estão no custo). Perdas: vencido, quebra e avaria. Bonificações: da indústria, já recebidas.
          </p>

          <Cartao titulo="Lucro bruto por dia">
            <GraficoLinha
              pontos={dados.porDia.map((d) => ({ rotulo: `${d.data.slice(8, 10)}/${d.data.slice(5, 7)}`, valor: d.lucroBruto }))}
            />
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
