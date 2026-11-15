import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Relatorios } from './Relatorios';
import './relatorios.css';
// Estilo do gráfico de linha (GraficoLinha) usado na aba de vendas.
import '../../layout/painel.css';

// Relatórios de vendas, curva ABC, produtos parados e margem (grupo Financeiro).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'CONTADOR'], {
    sufixo: 'relatorios',
    rotulo: 'Relatórios',
    icone: 'grafico',
    elemento: <Relatorios />,
    ordem: 63,
    grupo: 'Financeiro',
  }),
];
