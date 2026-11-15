export type Perfil =
  | 'GESTOR'
  | 'OPERADOR'
  | 'ESTOQUISTA'
  | 'PADEIRO'
  | 'COMPRADOR'
  | 'MOTORISTA'
  | 'VENDEDOR'
  | 'CONTADOR';

export const TODOS_PERFIS: Perfil[] = [
  'GESTOR',
  'OPERADOR',
  'ESTOQUISTA',
  'PADEIRO',
  'COMPRADOR',
  'MOTORISTA',
  'VENDEDOR',
  'CONTADOR',
];

// Perfil vindo da API ou do navegador; qualquer valor estranho vira operador (o servidor é quem decide o acesso).
export function lerPerfil(valor: unknown): Perfil {
  return TODOS_PERFIS.includes(valor as Perfil) ? (valor as Perfil) : 'OPERADOR';
}

// Início de cada perfil. As telas de cada perfil ficam embaixo da raiz (ex.: /gestor/produtos).
export const RAIZ_DO_PERFIL: Record<Perfil, string> = {
  GESTOR: '/gestor',
  OPERADOR: '/operador',
  ESTOQUISTA: '/estoquista',
  PADEIRO: '/padeiro',
  COMPRADOR: '/comprador',
  MOTORISTA: '/motorista',
  VENDEDOR: '/vendedor',
  CONTADOR: '/contador',
};

export const NOME_DO_PERFIL: Record<Perfil, string> = {
  GESTOR: 'Gestor',
  OPERADOR: 'Operador de caixa',
  ESTOQUISTA: 'Estoquista',
  PADEIRO: 'Padeiro',
  COMPRADOR: 'Comprador',
  MOTORISTA: 'Motorista',
  VENDEDOR: 'Vendedor',
  CONTADOR: 'Contador',
};

// Mantido por compatibilidade com as telas herdadas: o perfil verdadeiro é o próprio perfil.
export type PerfilReal = Perfil;

export interface UsuarioLogado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  perfilReal: PerfilReal;
  foto: string | null; // data URL ou endereço http(s); null sem foto
}

export const PERFIS: { valor: Perfil; rotulo: string }[] = TODOS_PERFIS.map((valor) => ({
  valor,
  rotulo: NOME_DO_PERFIL[valor],
}));

export function rotuloPerfil(valor: string): string {
  return PERFIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}
