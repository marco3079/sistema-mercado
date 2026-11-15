import type { ReactNode } from 'react';
import type { Perfil } from './tipos';
import { RAIZ_DO_PERFIL } from './tipos';
import type { NomeIcone } from '../ui/icones';

export interface RotaModulo {
  caminho: string; // ex.: '/admin/alunos' ou '/professor/diario/:turmaId'
  rotulo: string; // texto do menu
  icone: NomeIcone; // nome de um ícone de ui/icones
  perfis: Perfil[];
  elemento: ReactNode;
  menu?: boolean; // padrão true; false para telas de detalhe
  ordem?: number; // posição no menu (menor primeiro); padrão 100
  grupo?: string; // título do grupo do menu; sem isto, o grupo vem do ícone
}

// Mesma tela para vários perfis: gera uma rota por perfil, com caminho `${raiz do perfil}/${sufixo}`.
// Ex.: paraPerfis(['GESTOR', 'ESTOQUISTA'], { sufixo: 'estoque', ... }) -> /gestor/estoque e /estoquista/estoque.
export function paraPerfis(
  perfis: Perfil[],
  base: Omit<RotaModulo, 'caminho' | 'perfis'> & { sufixo: string },
): RotaModulo[] {
  const { sufixo, ...resto } = base;
  return perfis.map((perfil) => ({
    ...resto,
    caminho: `${RAIZ_DO_PERFIL[perfil]}/${sufixo}`,
    perfis: [perfil],
  }));
}

// Página pública (sem login), declarada por um módulo em `rotasPublicas`.
export interface RotaPublica {
  caminho: string; // ex.: '/rastreio/:codigo'
  elemento: ReactNode;
}
