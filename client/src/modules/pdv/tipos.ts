// Tipos das respostas da API do PDV, caixa e vendas (módulo pdv).

export type FormaPagamentoPdv = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'FIADO' | 'VALE_ALIMENTACAO' | 'BOLETO';

export interface MovimentoCaixaDTO {
  id: number;
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  valor: number;
  motivo: string | null;
  criadoEm: string;
}

// Caixa aberto do usuário (GET /caixas/atual) e também o resumo devolvido ao abrir, sangrar, suprir.
export interface CaixaAtualDTO {
  id: number;
  status: 'ABERTO' | 'FECHADO';
  terminal: string;
  abertoEm: string;
  valorAbertura: number;
  totalVendas: number;
  qtdVendas: number;
  porForma: Record<string, number>;
  sangrias: number;
  suprimentos: number;
  dinheiroEsperado: number;
  movimentos: MovimentoCaixaDTO[];
}

// Resposta de POST /caixas/:id/fechar: o resumo final mais o contado e a diferença.
export interface FechamentoCaixaDTO extends CaixaAtualDTO {
  fechadoEm: string;
  valorInformado: number;
  diferenca: number;
}

// Linha do histórico de caixas (GET /caixas, gestor).
export interface CaixaHistoricoDTO {
  id: number;
  terminal: string;
  operador: string;
  abertoEm: string;
  fechadoEm: string | null;
  status: 'ABERTO' | 'FECHADO';
  valorAbertura: number;
  totalVendas: number;
  valorInformado: number | null;
  diferenca: number | null;
}

// Produto para o PDV (GET /pdv/produtos e POST /pdv/ler).
export interface ProdutoPdv {
  id: number;
  codigo: string;
  ean: string | null;
  nome: string;
  unidade: string;
  pesavel: boolean;
  precoVenda: number;
  precoAtacado: number | null;
  qtdAtacado: number | null;
  foto: string | null;
  categoria: string | null;
  estoque: number;
}

export interface LeituraPdv {
  produto: ProdutoPdv;
  quantidade: number;
}

// Item do carrinho (só o que o cliente precisa guardar; preço vem do cálculo do servidor).
export interface ItemCarrinho {
  produtoId: number;
  codigo: string;
  nome: string;
  unidade: string;
  pesavel: boolean;
  quantidade: number;
  // Opcionais: rascunhos gravados antes desta versão não têm foto.
  foto?: string | null;
  categoria?: string | null;
}

export interface ItemCalculado {
  produtoId: number;
  quantidade: number;
  precoUnitario: number;
  precoTabela: number;
  total: number;
  desconto: number;
  descricaoPromocao: string | null;
}

// POST /pdv/calcular
export interface CalculoDTO {
  itens: ItemCalculado[];
  subtotal: number;
  descontoPromocoes: number;
  total: number;
}

// Cliente como vem da busca (GET /clientes).
export interface ClienteBusca {
  id: number;
  nome: string;
  tipo: 'VAREJO' | 'ATACADO';
  cpfCnpj: string | null;
  bloqueado: boolean;
  limiteCredito: number;
  saldoDevedor: number;
}

// Linha de GET /vendas.
export interface VendaListaDTO {
  id: number;
  numero: number;
  criadoEm: string;
  origem: 'PDV' | 'DELIVERY' | 'MARKETPLACE' | 'FORCA_VENDAS' | 'B2B';
  status: 'ABERTA' | 'CONCLUIDA' | 'CANCELADA';
  cliente: { id: number; nome: string } | null;
  operador: string;
  total: number;
  formas: string[];
}

// GET /vendas/:id e GET /vendas/:id/cupom (o mesmo formato).
export interface DetalheVendaDTO {
  id: number;
  numero: number;
  criadoEm: string;
  origem: string;
  status: 'ABERTA' | 'CONCLUIDA' | 'CANCELADA';
  loja: string;
  lojaCnpj: string | null;
  operador: string;
  vendedor: string | null;
  cliente: { id: number; nome: string; cpfCnpj: string | null } | null;
  subtotal: number;
  desconto: number;
  acrescimo: number;
  total: number;
  troco: number;
  custoTotal: number;
  lucro: number;
  cpfNota: string | null;
  observacao: string | null;
  motivoCancelamento: string | null;
  itens: {
    descricao: string;
    quantidade: number;
    unidade: string;
    foto: string | null;
    categoria: string | null;
    precoUnitario: number;
    desconto: number;
    total: number;
    promocao: string | null;
  }[];
  pagamentos: { forma: string; valor: number; parcelas: number }[];
  notas: {
    id: number;
    modelo: string;
    numero: number;
    serie: number;
    chave: string | null;
    status: string;
    simulada: boolean;
  }[];
  entrega: { codigo: string; status: string } | null;
}

// POST /pdv/vendas
export interface ResultadoVendaDTO {
  vendaId: number;
  numero: number;
  total: number;
  troco: number;
  notaId: number | null;
  nota: { numero: number; chave: string | null } | null;
}

// Pagamento montado na tela antes de confirmar.
export interface PagamentoMontado {
  forma: FormaPagamentoPdv;
  valor: number;
  parcelas?: number;
  autorizacao?: string | null;
}

// GET /configuracoes/mercado/publico (só o que o PDV usa).
export interface ConfigMercadoPublico {
  pixAtivo: boolean;
  balancaPrefixo: string;
  balancaModo: 'PRECO' | 'PESO';
  fiadoAtivo: boolean;
}
