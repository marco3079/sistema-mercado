import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Clientes } from './Clientes';
import { Fiado } from './Fiado';

// Clientes (cadastro, carteira e ficha) e fiado (recebimentos e extrato).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'OPERADOR', 'VENDEDOR', 'CONTADOR'], {
    sufixo: 'clientes',
    rotulo: 'Clientes',
    icone: 'usuarios',
    elemento: <Clientes />,
    ordem: 6,
    grupo: 'Vendas',
  }),
  ...paraPerfis(['GESTOR', 'OPERADOR'], {
    sufixo: 'fiado',
    rotulo: 'Fiado',
    icone: 'dinheiro',
    elemento: <Fiado />,
    ordem: 7,
    grupo: 'Vendas',
  }),
];
