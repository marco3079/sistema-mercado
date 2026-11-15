import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { Assistente } from './Assistente';
import './assistente.css';

// Assistente IA ("pergunte aos seus dados"): gestor, comprador e estoquista.
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'COMPRADOR', 'ESTOQUISTA'], {
    sufixo: 'assistente',
    rotulo: 'Assistente IA',
    icone: 'robo',
    elemento: <Assistente />,
    ordem: 79,
    grupo: 'Gestão',
  }),
];
