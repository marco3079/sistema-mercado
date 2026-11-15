import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Promocoes } from './Promocoes';
import { Bonificacoes } from './Bonificacoes';

// Promoções (compradores e gestor) e bonificação da indústria (só o gestor).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'COMPRADOR'], {
    sufixo: 'promocoes',
    rotulo: 'Promoções',
    icone: 'porcentagem',
    elemento: <Promocoes />,
    ordem: 8,
    grupo: 'Vendas',
  }),
  ...paraPerfis(['GESTOR'], {
    sufixo: 'bonificacoes',
    rotulo: 'Bonificação da indústria',
    icone: 'fabrica',
    elemento: <Bonificacoes />,
    ordem: 9,
    grupo: 'Vendas',
  }),
];
