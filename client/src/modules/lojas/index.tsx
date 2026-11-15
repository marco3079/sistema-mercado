import type { RotaModulo } from '../../lib/rotas';
import { paraPerfis } from '../../lib/rotas';
import { Lojas } from './Lojas';
import { MapaLojas } from './MapaLojas';

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
  ...paraPerfis(['GESTOR', 'ESTOQUISTA', 'COMPRADOR'], {
    sufixo: 'mapa',
    rotulo: 'Lojas e mapa',
    icone: 'mapa',
    elemento: <MapaLojas />,
    ordem: 49,
    grupo: 'Logística',
  }),
];
