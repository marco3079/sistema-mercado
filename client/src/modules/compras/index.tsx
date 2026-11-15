import type { Perfil } from '../../lib/tipos';
import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo, RotaPublica } from '../../lib/rotas';
import { Fornecedores } from './Fornecedores';
import { Sugestao } from './Sugestao';
import { Cotacoes } from './Cotacoes';
import { DetalheCotacao } from './DetalheCotacao';
import { RespostaCotacao } from './RespostaCotacao';
import { PedidosCompra } from './PedidosCompra';
import { DetalhePedido } from './DetalhePedido';
import { Recebimentos } from './Recebimentos';
import { Conferencia } from './Conferencia';
import './compras.css';

const COMPRAS: Perfil[] = ['COMPRADOR', 'GESTOR'];
const COMPRAS_E_ESTOQUE: Perfil[] = ['COMPRADOR', 'GESTOR', 'ESTOQUISTA'];

export const rotas: RotaModulo[] = [
  ...paraPerfis(COMPRAS, {
    sufixo: 'fornecedores',
    rotulo: 'Fornecedores',
    icone: 'fabrica',
    elemento: <Fornecedores />,
    ordem: 40,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS, {
    sufixo: 'sugestao-compra',
    rotulo: 'Sugestão de compra',
    icone: 'raio',
    elemento: <Sugestao />,
    ordem: 41,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS, {
    sufixo: 'cotacoes',
    rotulo: 'Cotações',
    icone: 'lista',
    elemento: <Cotacoes />,
    ordem: 42,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS, {
    sufixo: 'cotacoes/:id',
    rotulo: 'Cotação',
    icone: 'lista',
    elemento: <DetalheCotacao />,
    menu: false,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS_E_ESTOQUE, {
    sufixo: 'pedidos-compra',
    rotulo: 'Pedidos de compra',
    icone: 'pedidos',
    elemento: <PedidosCompra />,
    ordem: 43,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS_E_ESTOQUE, {
    sufixo: 'pedidos-compra/:id',
    rotulo: 'Pedido de compra',
    icone: 'pedidos',
    elemento: <DetalhePedido />,
    menu: false,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS_E_ESTOQUE, {
    sufixo: 'recebimento',
    rotulo: 'Recebimento',
    icone: 'pacote',
    elemento: <Recebimentos />,
    ordem: 44,
    grupo: 'Compras',
  }),
  ...paraPerfis(COMPRAS_E_ESTOQUE, {
    sufixo: 'recebimento/:id',
    rotulo: 'Conferência',
    icone: 'pacote',
    elemento: <Conferencia />,
    menu: false,
    grupo: 'Compras',
  }),
];

// Página pública: o fornecedor responde a cotação pelo link, sem login.
export const rotasPublicas: RotaPublica[] = [{ caminho: '/cotacao/:token', elemento: <RespostaCotacao /> }];
