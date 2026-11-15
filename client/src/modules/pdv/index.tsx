import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Pdv } from './Pdv';
import { CaixaTela } from './Caixa';
import { Vendas } from './Vendas';
import { DetalheVenda } from './DetalheVenda';

// PDV (frente de caixa), caixa da gaveta e vendas. Ordem do menu: 1 a 3.
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'OPERADOR'], {
    sufixo: 'pdv',
    rotulo: 'PDV',
    icone: 'carrinho',
    elemento: <Pdv />,
    ordem: 1,
    grupo: 'Vendas',
  }),
  ...paraPerfis(['GESTOR', 'OPERADOR'], {
    sufixo: 'caixa',
    rotulo: 'Caixa',
    icone: 'dinheiro',
    elemento: <CaixaTela />,
    ordem: 2,
    grupo: 'Vendas',
  }),
  ...paraPerfis(['GESTOR', 'OPERADOR', 'CONTADOR'], {
    sufixo: 'vendas',
    rotulo: 'Vendas',
    icone: 'lista',
    elemento: <Vendas />,
    ordem: 3,
    grupo: 'Vendas',
  }),
  ...paraPerfis(['GESTOR', 'OPERADOR', 'CONTADOR'], {
    sufixo: 'vendas/:id',
    rotulo: 'Detalhe da venda',
    icone: 'lista',
    elemento: <DetalheVenda />,
    menu: false,
    ordem: 3,
    grupo: 'Vendas',
  }),
];
