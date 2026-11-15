import { paraPerfis } from '../../lib/rotas';
import type { RotaModulo } from '../../lib/rotas';
import { TelaProdutos } from './Produtos';
import { TelaCategorias } from './Categorias';
import { TelaFormacaoPreco } from './FormacaoPreco';
import { TelaEtiquetas } from './Etiquetas';
import { TelaBalanca } from './Balanca';
import './produtos.css';

// Módulo de produtos (g02): cadastro, categorias, formação de preço, etiquetas, balança.
export const rotas: RotaModulo[] = [
  ...paraPerfis(['GESTOR', 'COMPRADOR', 'ESTOQUISTA', 'OPERADOR'], {
    sufixo: 'produtos',
    rotulo: 'Produtos',
    icone: 'pacote',
    elemento: <TelaProdutos />,
    ordem: 20,
    grupo: 'Produtos e estoque',
  }),
  ...paraPerfis(['GESTOR', 'COMPRADOR'], {
    sufixo: 'categorias',
    rotulo: 'Categorias',
    icone: 'lista',
    elemento: <TelaCategorias />,
    ordem: 21,
    grupo: 'Produtos e estoque',
  }),
  ...paraPerfis(['GESTOR', 'COMPRADOR'], {
    sufixo: 'formacao-preco',
    rotulo: 'Formação de preço',
    icone: 'porcentagem',
    elemento: <TelaFormacaoPreco />,
    ordem: 22,
    grupo: 'Produtos e estoque',
  }),
  ...paraPerfis(['GESTOR', 'ESTOQUISTA', 'COMPRADOR'], {
    sufixo: 'etiquetas',
    rotulo: 'Etiquetas',
    icone: 'etiqueta',
    elemento: <TelaEtiquetas />,
    ordem: 23,
    grupo: 'Produtos e estoque',
  }),
  ...paraPerfis(['GESTOR', 'ESTOQUISTA'], {
    sufixo: 'balanca',
    rotulo: 'Balança',
    icone: 'balanca',
    elemento: <TelaBalanca />,
    ordem: 24,
    grupo: 'Produtos e estoque',
  }),
];
