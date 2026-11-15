import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo, RotaPublica } from '../../lib/rotas';
import { PedidosVenda } from './PedidosVenda';
import { NovoPedido } from './NovoPedido';
import { MinhaCarteira } from './MinhaCarteira';
import { Faturamento } from './Faturamento';
import { Delivery } from './Delivery';
import { Pedir } from './Pedir';
import { LojaB2B } from './LojaB2B';

export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'VENDEDOR'], {
    sufixo: 'pedidos-venda',
    rotulo: 'Pedidos de venda',
    icone: 'pedidos',
    elemento: <PedidosVenda />,
    ordem: 12,
    grupo: 'Força de vendas',
  }),
  ...paraPerfis(['VENDEDOR', 'GESTOR'], {
    sufixo: 'novo-pedido',
    rotulo: 'Novo pedido',
    icone: 'celular',
    elemento: <NovoPedido />,
    ordem: 11,
    grupo: 'Força de vendas',
  }),
  ...paraPerfis(['VENDEDOR', 'GESTOR'], {
    sufixo: 'pedidos-venda/:id/editar',
    rotulo: 'Editar pedido',
    icone: 'lapis',
    elemento: <NovoPedido />,
    menu: false,
    ordem: 11,
    grupo: 'Força de vendas',
  }),
  {
    caminho: '/vendedor/carteira',
    rotulo: 'Minha carteira',
    icone: 'usuarios',
    perfis: ['VENDEDOR'],
    elemento: <MinhaCarteira />,
    ordem: 13,
    grupo: 'Força de vendas',
  },
  {
    caminho: '/gestor/faturamento',
    rotulo: 'Faturamento em lote',
    icone: 'documento',
    perfis: ['GESTOR'],
    elemento: <Faturamento />,
    ordem: 14,
    grupo: 'Força de vendas',
  },
  ...paraPerfis(['GESTOR', 'OPERADOR'], {
    sufixo: 'delivery',
    rotulo: 'Delivery',
    icone: 'caminhao',
    elemento: <Delivery />,
    ordem: 5,
    grupo: 'Vendas',
  }),
];

export const rotasPublicas: RotaPublica[] = [
  { caminho: '/pedir', elemento: <Pedir /> },
  { caminho: '/b2b/:codigo', elemento: <LojaB2B /> },
];
