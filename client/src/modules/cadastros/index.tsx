import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { TODOS_PERFIS } from '../../lib/tipos';
import { Usuarios } from './usuarios';
import { MeuPerfil } from './perfil';

export const rotas: RotaModulo[] = [
  {
    caminho: '/gestor/usuarios',
    rotulo: 'Equipe',
    icone: 'usuarios',
    perfis: ['GESTOR'],
    elemento: <Usuarios />,
    ordem: 81,
    grupo: 'Gestão',
  },
  ...paraPerfis(TODOS_PERFIS, {
    sufixo: 'perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    elemento: <MeuPerfil />,
    ordem: 99,
    grupo: 'Conta',
  }),
];
