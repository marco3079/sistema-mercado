import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Financeiro } from './Financeiro';
import { FluxoCaixa } from './FluxoCaixa';
import { MeuLucro } from './MeuLucro';
import './financeiro.css';
// Estilo do gráfico de linha (GraficoLinha) usado no fluxo de caixa e no Meu Lucro.
import '../../layout/painel.css';

// Contas a pagar e receber, fluxo de caixa e Meu Lucro (grupo Financeiro).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'CONTADOR'], {
    sufixo: 'financeiro',
    rotulo: 'Contas a pagar e receber',
    icone: 'financeiro',
    elemento: <Financeiro />,
    ordem: 60,
    grupo: 'Financeiro',
  }),
  ...paraPerfis(['GESTOR', 'CONTADOR'], {
    sufixo: 'fluxo-caixa',
    rotulo: 'Fluxo de caixa',
    icone: 'grafico',
    elemento: <FluxoCaixa />,
    ordem: 61,
    grupo: 'Financeiro',
  }),
  ...paraPerfis(['GESTOR'], {
    sufixo: 'meu-lucro',
    rotulo: 'Meu Lucro',
    icone: 'porcentagem',
    elemento: <MeuLucro />,
    ordem: 62,
    grupo: 'Financeiro',
  }),
];
