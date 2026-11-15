import { useState } from 'react';
import type { ReactNode } from 'react';
import { baixarArquivo } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  formatarPercentual,
  hojeIso,
  mensagemErro,
  ROTULOS_FORMA_PAGAMENTO,
  ROTULOS_ORIGEM_VENDA,
} from '../../lib/mercado';
import { Abas, Aviso, Botao, Caixa, Campo, Carregando, Cartao, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { BarraNivel, CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { CurvaLinha, MargemLinha, ProdutoParado, RelatorioVendas, SerieVenda } from './tipos';

type Aba = 'vendas' | 'curva' | 'parados' | 'margem';
type Agrupar = 'dia' | 'hora' | 'semana' | 'mes';
type Criterio = 'faturamento' | 'quantidade' | 'lucro';

const COR_CLASSE: Record<string, 'verde' | 'amarelo' | 'cinza'> = { A: 'verde', B: 'amarelo', C: 'cinza' };
const COR_BARRA: Record<string, 'verde' | 'amarelo' | 'azul'> = { A: 'verde', B: 'amarelo', C: 'azul' };

// "2026-11-03" -> "03/11"; "2026-11" -> "11/2026"; hora fica como está.
function rotuloCurto(r: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return `${r.slice(8, 10)}/${r.slice(5, 7)}`;
  if (/^\d{4}-\d{2}$/.test(r)) return `${r.slice(5, 7)}/${r.slice(0, 4)}`;
  return r;
}

// Query da URL com o filtro de todas as lojas quando marcado.
function montarQuery(parametros: Record<string, string>, todas: boolean): string {
  const p = new URLSearchParams(parametros);
  if (todas) p.set('loja', 'todas');
  const texto = p.toString();
  return texto ? `?${texto}` : '';
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

const colunasOrigem: ColunaTabela<{ origem: string; vendas: number; total: number }>[] = [
  { titulo: 'Origem', celula: (o) => ROTULOS_ORIGEM_VENDA[o.origem] ?? o.origem },
  { titulo: 'Vendas', alinhar: 'direita', celula: (o) => <span className="numero">{o.vendas}</span> },
  { titulo: 'Total', alinhar: 'direita', celula: (o) => <span className="numero">{formatarMoeda(o.total)}</span> },
];

const colunasForma: ColunaTabela<{ forma: string; total: number }>[] = [
  { titulo: 'Forma', celula: (f) => ROTULOS_FORMA_PAGAMENTO[f.forma] ?? f.forma },
  { titulo: 'Total', alinhar: 'direita', celula: (f) => <span className="numero">{formatarMoeda(f.total)}</span> },
];

const colunasOperador: ColunaTabela<{ operador: string; vendas: number; total: number }>[] = [
  { titulo: 'Operador', celula: (o) => o.operador },
  { titulo: 'Vendas', alinhar: 'direita', celula: (o) => <span className="numero">{o.vendas}</span> },
  { titulo: 'Total', alinhar: 'direita', celula: (o) => <span className="numero">{formatarMoeda(o.total)}</span> },
];

const colunasCurva: ColunaTabela<CurvaLinha>[] = [
  {
    titulo: 'Produto',
    celula: (c) => (
      <CelulaProduto
        foto={c.foto}
        nome={c.nome}
        setor={c.categoria}
        detalhe={`${c.codigo} · ${c.categoria}`}
        extra={<Selo cor={COR_CLASSE[c.classe] ?? 'cinza'}>{c.classe}</Selo>}
      />
    ),
  },
  {
    titulo: 'Qtd.',
    alinhar: 'direita',
    celula: (c) => <span className="numero">{c.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</span>,
  },
  { titulo: 'Faturamento', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.faturamento)}</span> },
  { titulo: 'Lucro', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.lucro)}</span> },
  { titulo: '%', alinhar: 'direita', celula: (c) => <span className="numero">{formatarPercentual(c.percentual)}</span> },
  {
    titulo: '% acumulado',
    alinhar: 'direita',
    celula: (c) => (
      <span className="relatorios-acumulado">
        <span className="numero">{formatarPercentual(c.percentualAcumulado)}</span>
        <BarraNivel valor={c.percentualAcumulado} maximo={100} cor={COR_BARRA[c.classe] ?? 'azul'} />
      </span>
    ),
  },
];

const colunasParados: ColunaTabela<ProdutoParado>[] = [
  {
    titulo: 'Produto',
    celula: (p) => <CelulaProduto foto={p.foto} nome={p.nome} setor={p.categoria} detalhe={p.categoria} />,
  },
  {
    titulo: 'Estoque',
    alinhar: 'direita',
    celula: (p) => <span className="numero">{p.estoque.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</span>,
  },
  { titulo: 'Valor do estoque', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.valorEstoque)}</span> },
  {
    titulo: 'Última venda',
    alinhar: 'direita',
    celula: (p) => (
      <span className="numero">{p.ultimaVenda ? new Date(p.ultimaVenda).toLocaleDateString('pt-BR') : 'Nunca vendido'}</span>
    ),
  },
];

const colunasMargem: ColunaTabela<MargemLinha>[] = [
  {
    titulo: 'Produto',
    celula: (m) => <CelulaProduto foto={m.foto} nome={m.nome} setor={m.categoria} detalhe={m.codigo} />,
  },
  { titulo: 'Custo', alinhar: 'direita', celula: (m) => <span className="numero">{formatarMoeda(m.custo)}</span> },
  { titulo: 'Venda', alinhar: 'direita', celula: (m) => <span className="numero">{formatarMoeda(m.venda)}</span> },
  { titulo: 'Margem', alinhar: 'direita', celula: (m) => <span className="numero">{formatarPercentual(m.margem)}</span> },
  {
    titulo: 'Situação',
    celula: (m) => (m.prejuizo ? <Selo cor="vermelho">Vendendo abaixo do custo</Selo> : <Selo cor="verde">OK</Selo>),
  },
];

// Relatórios do gestor e do contador. Cada aba tem seus filtros e o botão Exportar CSV.
export function Relatorios() {
  const [aba, setAba] = useState<Aba>('vendas');
  const [todas, setTodas] = useState(false);
  const [de, setDe] = useState(hojeIso().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeIso());
  const [agrupar, setAgrupar] = useState<Agrupar>('dia');
  const [criterio, setCriterio] = useState<Criterio>('faturamento');
  const [dias, setDias] = useState('30');
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState<string | null>(null);

  const qsVendas = montarQuery({ inicio: de, fim: ate, agrupar }, todas);
  const qsCurva = montarQuery({ inicio: de, fim: ate, criterio }, todas);
  const qsParados = montarQuery({ dias }, todas);
  const qsMargem = montarQuery({}, todas);

  const vendas = useDados<RelatorioVendas>(aba === 'vendas' ? `/relatorios/vendas${qsVendas}` : null);
  const curva = useDados<CurvaLinha[]>(aba === 'curva' ? `/relatorios/curva-abc${qsCurva}` : null);
  const parados = useDados<ProdutoParado[]>(aba === 'parados' ? `/relatorios/produtos-parados${qsParados}` : null);
  const margem = useDados<MargemLinha[]>(aba === 'margem' ? `/relatorios/margem${qsMargem}` : null);

  async function exportar(relatorio: 'vendas' | 'curva-abc' | 'produtos-parados' | 'margem', arquivo: string, query: string) {
    setErroExport(null);
    setExportando(true);
    try {
      await baixarArquivo(`/relatorios/exportar/${relatorio}.csv${query}`, arquivo);
    } catch (e) {
      setErroExport(mensagemErro(e));
    } finally {
      setExportando(false);
    }
  }

  // Barra de cada aba: filtros à esquerda, Exportar CSV à direita (alinhado pela base dos campos).
  const barra = (campos: ReactNode, relatorio: 'vendas' | 'curva-abc' | 'produtos-parados' | 'margem', arquivo: string, query: string) => (
    <div className="barra-ferramentas">
      {campos && <div className="filtros">{campos}</div>}
      <Botao variante="secundario" desabilitado={exportando} aoClicar={() => void exportar(relatorio, arquivo, query)}>
        {exportando ? 'Exportando...' : 'Exportar CSV'}
      </Botao>
    </div>
  );

  const camposPeriodo = (
    <>
      <Campo rotulo="De" tipo="date" valor={de} aoMudar={setDe} obrigatorio />
      <Campo rotulo="Até" tipo="date" valor={ate} aoMudar={setAte} obrigatorio />
    </>
  );

  // Contagem de itens por classe da curva ABC.
  const contagemClasses = (curva.dados ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.classe] = (acc[c.classe] ?? 0) + 1;
    return acc;
  }, {});

  const totalParados = (parados.dados ?? []).reduce((soma, p) => soma + p.valorEstoque, 0);
  const abaixoDoCusto = (margem.dados ?? []).filter((m) => m.prejuizo).length;

  return (
    <Pagina titulo="Relatórios">
      <div className="relatorios-topo">
        <Caixa rotulo="Todas as lojas" marcado={todas} aoMudar={setTodas} />
      </div>

      <Abas
        abas={[
          { id: 'vendas', rotulo: 'Vendas' },
          { id: 'curva', rotulo: 'Curva ABC' },
          { id: 'parados', rotulo: 'Produtos parados' },
          { id: 'margem', rotulo: 'Margem' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as Aba)}
      />

      {erroExport && <Aviso tipo="erro">{erroExport}</Aviso>}

      {aba === 'vendas' && (
        <>
          {barra(
            <>
              {camposPeriodo}
              <Selecao
                rotulo="Agrupar por"
                valor={agrupar}
                aoMudar={(v) => setAgrupar((['dia', 'hora', 'semana', 'mes'] as const).find((x) => x === v) ?? 'dia')}
                opcoes={[
                  { valor: 'dia', rotulo: 'Dia' },
                  { valor: 'hora', rotulo: 'Hora' },
                  { valor: 'semana', rotulo: 'Semana' },
                  { valor: 'mes', rotulo: 'Mês' },
                ]}
              />
            </>,
            'vendas',
            'vendas.csv',
            qsVendas,
          )}
          {vendas.erro && <Aviso tipo="erro">{vendas.erro}</Aviso>}
          {vendas.carregando && !vendas.dados && <Carregando />}
          {vendas.dados && (
            <>
              <div className="resumo">
                <Indicador icone="documento" cor="azul" valor={String(vendas.dados.vendas)} rotulo="Vendas" />
                <Indicador icone="dinheiro" cor="verde" valor={formatarMoeda(vendas.dados.total)} rotulo="Total" />
                <Indicador icone="estrela" cor="roxo" valor={formatarMoeda(vendas.dados.ticketMedio)} rotulo="Ticket médio" />
              </div>
              <Cartao titulo="Total por período">
                <GraficoLinha
                  pontos={vendas.dados.serie.map((s: SerieVenda) => ({ rotulo: rotuloCurto(s.rotulo), valor: s.total }))}
                />
              </Cartao>
              <div className="relatorios-duas">
                <Cartao titulo="Por origem">
                  <Tabela colunas={colunasOrigem} dados={vendas.dados.porOrigem} chave={(o) => o.origem} vazio="Sem vendas." />
                </Cartao>
                <Cartao titulo="Por forma de pagamento">
                  <Tabela colunas={colunasForma} dados={vendas.dados.porForma} chave={(f) => f.forma} vazio="Sem pagamentos." />
                </Cartao>
              </div>
              <Cartao titulo="Por operador">
                <Tabela colunas={colunasOperador} dados={vendas.dados.porOperador} chave={(o) => o.operador} vazio="Sem vendas." />
              </Cartao>
            </>
          )}
        </>
      )}

      {aba === 'curva' && (
        <>
          {barra(
            <>
              {camposPeriodo}
              <Selecao
                rotulo="Critério"
                valor={criterio}
                aoMudar={(v) => setCriterio((['faturamento', 'quantidade', 'lucro'] as const).find((x) => x === v) ?? 'faturamento')}
                opcoes={[
                  { valor: 'faturamento', rotulo: 'Faturamento' },
                  { valor: 'quantidade', rotulo: 'Quantidade' },
                  { valor: 'lucro', rotulo: 'Lucro' },
                ]}
              />
            </>,
            'curva-abc',
            'curva-abc.csv',
            qsCurva,
          )}
          {curva.erro && <Aviso tipo="erro">{curva.erro}</Aviso>}
          {curva.carregando && !curva.dados && <Carregando />}
          {curva.dados && (
            <>
              <div className="relatorios-resumo-abc">
                <Selo cor="verde">A: {contagemClasses.A ?? 0} itens (até 80%)</Selo>
                <Selo cor="amarelo">B: {contagemClasses.B ?? 0} itens (até 95%)</Selo>
                <Selo cor="cinza">C: {contagemClasses.C ?? 0} itens</Selo>
              </div>
              <Tabela colunas={colunasCurva} dados={curva.dados} chave={(c) => c.produtoId} vazio="Nenhuma venda no período." />
            </>
          )}
        </>
      )}

      {aba === 'parados' && (
        <>
          {barra(
            <Campo rotulo="Dias sem venda" tipo="number" valor={dias} aoMudar={setDias} obrigatorio />,
            'produtos-parados',
            'produtos-parados.csv',
            qsParados,
          )}
          {parados.erro && <Aviso tipo="erro">{parados.erro}</Aviso>}
          {parados.carregando && !parados.dados && <Carregando />}
          {parados.dados && (
            <>
              <div className="resumo">
                <Indicador icone="pacote" cor="laranja" valor={String(parados.dados.length)} rotulo={`Produtos sem venda em ${dias} dias`} />
                <Indicador icone="dinheiro" cor="vermelho" valor={formatarMoeda(totalParados)} rotulo="Valor parado (custo)" />
              </div>
              <Tabela colunas={colunasParados} dados={parados.dados} chave={(p) => p.produtoId} vazio="Nenhum produto parado." />
            </>
          )}
        </>
      )}

      {aba === 'margem' && (
        <>
          {barra(null, 'margem', 'margem.csv', qsMargem)}
          {margem.erro && <Aviso tipo="erro">{margem.erro}</Aviso>}
          {margem.carregando && !margem.dados && <Carregando />}
          {margem.dados && (
            <>
              <div className="resumo">
                <Indicador icone="etiqueta" cor="azul" valor={String(margem.dados.length)} rotulo="Produtos com custo" />
                <Indicador icone="relogio" cor="vermelho" valor={String(abaixoDoCusto)} rotulo="Vendendo abaixo do custo" />
              </div>
              <Tabela colunas={colunasMargem} dados={margem.dados} chave={(m) => m.produtoId} vazio="Nenhum produto com custo cadastrado." />
            </>
          )}
        </>
      )}
    </Pagina>
  );
}
