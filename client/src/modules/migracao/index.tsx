import type { RotaModulo } from '../../lib/rotas';
import { Migracao } from './Migracao';
import './migracao.css';
import './conferencia.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/migracao',
    rotulo: 'Importar de outro sistema',
    icone: 'transferir',
    perfis: ['GESTOR'],
    elemento: <Migracao />,
    ordem: 96,
    grupo: 'Sistema',
  },
];
