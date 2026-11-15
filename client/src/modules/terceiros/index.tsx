import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import type { Perfil } from '../../lib/tipos';
import { Terceiros } from './Terceiros';
import { Remessas } from './Remessas';
import { DetalheRemessa } from './DetalheRemessa';

// Estoque em terceiros (consignação, comodato, conserto, demonstração, armazém, evento).
const PERFIS: Perfil[] = ['GESTOR', 'ESTOQUISTA', 'COMPRADOR', 'CONTADOR'];
const GRUPO = 'Logística';

export const rotas: RotaModulo[] = [
  ...paraPerfis(PERFIS, {
    sufixo: 'terceiros',
    rotulo: 'Estoque em terceiros',
    icone: 'transferir',
    elemento: <Terceiros />,
    ordem: 54,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS, {
    sufixo: 'remessas-terceiro',
    rotulo: 'Remessas a terceiros',
    icone: 'caminhao',
    elemento: <Remessas />,
    ordem: 55,
    grupo: GRUPO,
  }),
  ...paraPerfis(PERFIS, {
    sufixo: 'remessas-terceiro/:id',
    rotulo: 'Remessa',
    icone: 'caminhao',
    elemento: <DetalheRemessa />,
    menu: false,
    ordem: 56,
    grupo: GRUPO,
  }),
];
