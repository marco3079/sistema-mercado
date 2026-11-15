import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Producao } from './Producao';
import { PainelForno } from './PainelForno';
import { Receitas } from './Receitas';
import './padaria.css';

// Padaria: produção do dia e painel do forno (padeiro e gestor), receitas (padeiro, gestor e estoquista).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['PADEIRO', 'GESTOR'], {
    sufixo: 'producao',
    rotulo: 'Produção do dia',
    icone: 'pao',
    elemento: <Producao />,
    ordem: 30,
    grupo: 'Padaria',
  }),
  ...paraPerfis(['PADEIRO', 'GESTOR'], {
    sufixo: 'forno',
    rotulo: 'Painel do forno',
    icone: 'relogio',
    elemento: <PainelForno />,
    ordem: 31,
    grupo: 'Padaria',
  }),
  ...paraPerfis(['PADEIRO', 'GESTOR', 'ESTOQUISTA'], {
    sufixo: 'receitas',
    rotulo: 'Receitas',
    icone: 'documento',
    elemento: <Receitas />,
    ordem: 32,
    grupo: 'Padaria',
  }),
];
