import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import { Estoque } from './Estoque';
import { Movimentos } from './Movimentos';
import { Validade } from './Validade';
import { Inventarios } from './Inventarios';
import { Contagem } from './Contagem';

const PERFIS_CONSULTA: Perfil[] = ['GESTOR', 'ESTOQUISTA', 'COMPRADOR', 'PADEIRO'];
const PERFIS_OPERACAO: Perfil[] = ['GESTOR', 'ESTOQUISTA'];

const GRUPO = 'Produtos e estoque';

export const rotas: RotaModulo[] = [
  ...paraPerfis(PERFIS_CONSULTA, {
    sufixo: 'estoque',
    rotulo: 'Estoque',
    icone: 'pacote',
    elemento: <Estoque />,
    ordem: 25,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS_OPERACAO, {
    sufixo: 'movimentacoes',
    rotulo: 'Movimentações',
    icone: 'transferir',
    elemento: <Movimentos />,
    ordem: 26,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS_OPERACAO, {
    sufixo: 'validade',
    rotulo: 'Validade e perdas',
    icone: 'validade',
    elemento: <Validade />,
    ordem: 27,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS_OPERACAO, {
    sufixo: 'inventarios',
    rotulo: 'Inventário',
    icone: 'lista',
    elemento: <Inventarios />,
    ordem: 28,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS_OPERACAO, {
    sufixo: 'contagem/:id',
    rotulo: 'Contagem',
    icone: 'celular',
    elemento: <Contagem />,
    menu: false,
    ordem: 29,
    grupo: GRUPO,
  }),
];
