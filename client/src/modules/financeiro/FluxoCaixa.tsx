import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import { hojeIso } from '../../lib/mercado';
import { Aviso, Campo, Carregando, Cartao, Pagina, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { DiaFluxo, FluxoCaixaDTO } from './tipos';

// "AAAA-MM-DD" -> "DD/MM", para o eixo do gráfico.
function diaCurto(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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

const colunas: ColunaTabela<DiaFluxo>[] = [
  { titulo: 'Data', celula: (d) => formatarData(d.data) },
  { titulo: 'Vendas à vista', alinhar: 'direita', celula: (d) => <span className="numero">{formatarMoeda(d.entradasVendas)}</span> },
  { titulo: 'Recebimentos', alinhar: 'direita', celula: (d) => <span className="numero">{formatarMoeda(d.entradasLancamentos)}</span> },
  { titulo: 'Saídas', alinhar: 'direita', celula: (d) => <span className="numero">{formatarMoeda(d.saidas)}</span> },
  { titulo: 'Saldo do dia', alinhar: 'direita', celula: (d) => <span className="numero">{formatarMoeda(d.saldoDia)}</span> },
  { titulo: 'Saldo acumulado', alinhar: 'direita', celula: (d) => <span className="numero">{formatarMoeda(d.saldoAcumulado)}</span> },
];

// Fluxo de caixa do período: vendas à vista (exceto fiado e boleto), recebimentos e pagamentos efetivos.
export function FluxoCaixa() {
  const [de, setDe] = useState(hojeIso().slice(0, 8) + '01');
  const [ate, setAte] = useState(hojeIso());
  const caminho = de && ate ? `/financeiro/fluxo?inicio=${de}&fim=${ate}` : null;
  const fluxo = useDados<FluxoCaixaDTO>(caminho);
  const dados = fluxo.dados;

  return (
    <Pagina titulo="Fluxo de caixa">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="De" tipo="date" valor={de} aoMudar={setDe} obrigatorio />
          <Campo rotulo="Até" tipo="date" valor={ate} aoMudar={setAte} obrigatorio />
        </div>
      </div>

      {fluxo.erro && <Aviso tipo="erro">{fluxo.erro}</Aviso>}
      {fluxo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="resumo">
            <Indicador icone="dinheiro" cor="verde" valor={formatarMoeda(dados.totais.entradas)} rotulo="Entradas no período" />
            <Indicador icone="transferir" cor="laranja" valor={formatarMoeda(dados.totais.saidas)} rotulo="Saídas no período" />
            <Indicador icone="grafico" cor="azul" valor={formatarMoeda(dados.totais.saldo)} rotulo="Saldo do período" />
            <Indicador icone="relogio" cor="roxo" valor={formatarMoeda(dados.previsto.saldo)} rotulo="Previsto para 30 dias" />
          </div>
          <p className="financeiro-nota">
            Nos próximos 30 dias: a receber {formatarMoeda(dados.previsto.receber)}, a pagar{' '}
            {formatarMoeda(dados.previsto.pagar)}.
          </p>

          <Cartao titulo="Saldo acumulado">
            <GraficoLinha pontos={dados.dias.map((d) => ({ rotulo: diaCurto(d.data), valor: d.saldoAcumulado }))} />
          </Cartao>

          <Cartao titulo="Dia a dia">
            <Tabela colunas={colunas} dados={dados.dias} chave={(d) => d.data} vazio="Nenhum dia no período." />
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
