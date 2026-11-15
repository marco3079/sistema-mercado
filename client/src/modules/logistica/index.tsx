import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo, RotaPublica } from '../../lib/rotas';
import { Entregas } from './Entregas';
import { MinhasEntregas } from './MinhasEntregas';
import { MontarCarga } from './MontarCarga';
import { Rastreio } from './Rastreio';
import { Rotas } from './Rotas';
import { Transferencias } from './Transferencias';
import { Veiculos } from './Veiculos';
import './logistica.css';

// Logística: entregas, rotas e cargas, frota, transferências entre lojas e a tela do motorista.
// O rastreio público (/rastreio/:codigo) não tem login.

export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'ESTOQUISTA', 'OPERADOR'], {
    sufixo: 'entregas',
    rotulo: 'Entregas',
    icone: 'caminhao',
    elemento: <Entregas />,
    ordem: 50,
    grupo: 'Logística',
  }),
  ...paraPerfis(['GESTOR', 'ESTOQUISTA'], {
    sufixo: 'rotas',
    rotulo: 'Rotas e cargas',
    icone: 'mapa',
    elemento: <Rotas />,
    ordem: 51,
    grupo: 'Logística',
  }),
  ...paraPerfis(['GESTOR', 'ESTOQUISTA'], {
    sufixo: 'rotas/:id',
    rotulo: 'Montar carga',
    icone: 'mapa',
    elemento: <MontarCarga />,
    menu: false,
    ordem: 51,
    grupo: 'Logística',
  }),
  ...paraPerfis(['GESTOR', 'ESTOQUISTA'], {
    sufixo: 'transferencias',
    rotulo: 'Transferências',
    icone: 'transferir',
    elemento: <Transferencias />,
    ordem: 52,
    grupo: 'Logística',
  }),
  ...paraPerfis(['GESTOR'], {
    sufixo: 'veiculos',
    rotulo: 'Frota',
    icone: 'caminhao',
    elemento: <Veiculos />,
    ordem: 53,
    grupo: 'Logística',
  }),
  ...paraPerfis(['MOTORISTA'], {
    sufixo: 'entregas',
    rotulo: 'Minhas entregas',
    icone: 'caminhao',
    elemento: <MinhasEntregas />,
    ordem: 1,
    grupo: 'Logística',
  }),
];

export const rotasPublicas: RotaPublica[] = [{ caminho: '/rastreio/:codigo', elemento: <Rastreio /> }];
