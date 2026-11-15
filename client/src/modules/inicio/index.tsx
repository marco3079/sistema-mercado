import { Painel } from '../../layout/Painel';
import type { RotaModulo } from '../../lib/rotas';
import { RAIZ_DO_PERFIL, TODOS_PERFIS } from '../../lib/tipos';

// Início de cada perfil: o mesmo painel, que se adapta ao perfil logado.
export const rotas: RotaModulo[] = TODOS_PERFIS.map((perfil) => ({
  caminho: RAIZ_DO_PERFIL[perfil],
  rotulo: 'Início',
  icone: 'inicio',
  perfis: [perfil],
  elemento: <Painel />,
  ordem: 0,
  grupo: '',
}));
