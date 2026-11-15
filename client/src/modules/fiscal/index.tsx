import type { RotaModulo } from '../../lib/rotas';
import { paraPerfis } from '../../lib/rotas';
import { Notas } from './Notas';
import { Contador } from './Contador';
import './fiscal.css';

// Notas fiscais (NFC-e / NF-e) e área do contador. Ordem 64-65 (menu Financeiro).
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'CONTADOR'], {
    sufixo: 'notas-fiscais',
    rotulo: 'Notas fiscais',
    icone: 'documento',
    elemento: <Notas />,
    ordem: 64,
    grupo: 'Financeiro',
  }),
  ...paraPerfis(['GESTOR', 'CONTADOR'], {
    sufixo: 'contador',
    rotulo: 'Área do contador',
    icone: 'documento',
    elemento: <Contador />,
    ordem: 65,
    grupo: 'Financeiro',
  }),
];
