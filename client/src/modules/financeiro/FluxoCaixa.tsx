import { useState } from 'react';
import { useDados } from '../../lib/useDados';
import { hojeIso } from '../../lib/mercado';
import { Aviso, Campo, Carregando, Cartao, Pagina, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { DiaFluxo, FluxoCaixaDTO } from './tipos';

// "AAAA-MM-DD" -> "DD/MM", para o eixo do gráfico.
function diaCurto(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const colunas: ColunaTabela<DiaFluxo>[] = [
  { titulo: 'Data', celula: (d) => formatarData(d.data) },
  { titulo: 'Vendas à vista', alinhar: 'direita', celula: (d) => formatarMoeda(d.entradasVendas) },
  { titulo: 'Recebimentos', alinhar: 'direita', celula: (d) => formatarMoeda(d.entradasLancamentos) },
  { titulo: 'Saídas', alinhar: 'direita', celula: (d) => formatarMoeda(d.saidas) },
  { titulo: 'Saldo do dia', alinhar: 'direita', celula: (d) => formatarMoeda(d.saldoDia) },
  { titulo: 'Saldo acumulado', alinhar: 'direita', celula: (d) => formatarMoeda(d.saldoAcumulado) },
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
      <div className="financeiro-datas financeiro-periodo">
        <Campo rotulo="De" tipo="date" valor={de} aoMudar={setDe} obrigatorio />
        <Campo rotulo="Até" tipo="date" valor={ate} aoMudar={setAte} obrigatorio />
      </div>

      {fluxo.erro && <Aviso tipo="erro">{fluxo.erro}</Aviso>}
      {fluxo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="financeiro-cartoes">
            <div className="cartao">
              <h2 className="cartao-titulo">Entradas no período</h2>
              <strong>{formatarMoeda(dados.totais.entradas)}</strong>
            </div>
            <div className="cartao">
              <h2 className="cartao-titulo">Saídas no período</h2>
              <strong>{formatarMoeda(dados.totais.saidas)}</strong>
            </div>
            <div className="cartao">
              <h2 className="cartao-titulo">Saldo do período</h2>
              <strong>{formatarMoeda(dados.totais.saldo)}</strong>
            </div>
            <div className="cartao">
              <h2 className="cartao-titulo">Previsto nos próximos 30 dias</h2>
              <p className="financeiro-detalhe">A receber: {formatarMoeda(dados.previsto.receber)}</p>
              <p className="financeiro-detalhe">A pagar: {formatarMoeda(dados.previsto.pagar)}</p>
              <strong>{formatarMoeda(dados.previsto.saldo)}</strong>
            </div>
          </div>

          <Cartao titulo="Saldo acumulado">
            <GraficoLinha pontos={dados.dias.map((d) => ({ rotulo: diaCurto(d.data), valor: d.saldoAcumulado }))} />
          </Cartao>

          <Cartao titulo="Dia a dia">
            <Tabela
              colunas={colunas}
              dados={dados.dias}
              chave={(d) => d.data}
              vazio="Nenhum dia no período."
            />
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
