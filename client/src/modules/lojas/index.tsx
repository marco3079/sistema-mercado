import type { RotaModulo } from '../../lib/rotas';
import { Lojas } from './Lojas';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/lojas',
    rotulo: 'Lojas e CD',
    icone: 'loja',
    perfis: ['GESTOR'],
    elemento: <Lojas />,
    ordem: 80,
    grupo: 'Gestão',
  },
];
