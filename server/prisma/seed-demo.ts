// Dados de demonstração (fictícios). Só rodam com SEED_DEMO=true, em banco novo, depois do seed padrão.
// Três lojas, equipe de cada perfil, catálogo com balança e padaria, estoque e lotes, 180 dias de vendas
// (pelo registrarVenda), caixas, promoções, compras, logística e força de vendas. Nenhum dado real.

import type { Caixa, FormaPagamento, Loja, Perfil, PrismaClient, Produto, Promocao, StatusPedidoVenda, TipoCliente, Unidade, Usuario, Veiculo } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { atualizarCustoMedio, movimentarEstoque, type Tx } from '../src/lib/estoque';
import { calcularPreco, digitoVerificadorEan, promocoesVigentes, sugerirPrecoVenda } from '../src/lib/precos';
import { registrarVenda, type ItemEntrada, type PagamentoEntrada } from '../src/lib/vendas';
import { arred2, arred3, codigoAleatorio, inicioDoDia, num, somarDias } from '../src/lib/numeros';
import { criarEntrega } from '../src/modules/logistica/entregas';

const SENHA = 'demo1234';
const DIAS_HISTORICO = 180;
const TAXA_ENTREGA = 5;
const TERMINAL = 'PDV 01';
const TX_OPCOES = { timeout: 900000, maxWait: 60000 };

// ---------- Sorteio com semente fixa: a demonstração sai igual em todo banco novo ----------

function gerador(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sortear = gerador(20261114);
const aleatorio = (min: number, max: number): number => min + sortear() * (max - min);
const inteiro = (min: number, max: number): number => Math.floor(aleatorio(min, max + 1));
const chance = (p: number): boolean => sortear() < p;
function escolher<T>(lista: readonly T[]): T {
  return lista[Math.floor(sortear() * lista.length)];
}

// ---------- Datas (horário local do servidor) ----------

const agora = new Date();
const hoje = inicioDoDia(agora);

function diaRelativo(k: number): Date {
  const d = new Date(hoje);
  d.setDate(d.getDate() - k);
  return d;
}

function horaNoDia(base: Date, h: number, m: number): Date {
  const d = new Date(base);
  d.setHours(h, m, inteiro(0, 59), 0);
  return d;
}

// Hora de hoje, sem passar do momento atual (a demonstração não tem vendas no futuro).
function hojeAs(h: number, m: number): Date {
  const d = horaNoDia(hoje, h, m);
  return d.getTime() > agora.getTime() ? new Date(agora.getTime() - 5 * 60000) : d;
}

function dataDoMes(deslocamentoMeses: number, dia: number): Date {
  return new Date(hoje.getFullYear(), hoje.getMonth() + deslocamentoMeses, dia, 12, 0, 0);
}

function dataCurta(): string {
  return `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}`;
}

// ---------- Catálogo (nomes fictícios) ----------

interface Def {
  nome: string;
  cat: string;
  un: Unidade;
  custo: number;
  pesavel?: boolean;
  insumo?: boolean;
  produzido?: boolean;
  lote?: boolean;
  validade?: number;
  plu?: number;
  atacado?: [number, number];
  forn?: string;
  margem?: number;
}

const CATEGORIAS: [string, string][] = [
  ['Padaria', 'Padaria'],
  ['Confeitaria', 'Padaria'],
  ['Insumos de padaria', 'Padaria'],
  ['Mercearia', 'Mercearia'],
  ['Hortifrúti', 'Hortifrúti'],
  ['Açougue', 'Açougue'],
  ['Frios e Laticínios', 'Frios e laticínios'],
  ['Bebidas', 'Bebidas'],
  ['Limpeza', 'Limpeza'],
  ['Higiene', 'Higiene'],
];

const FORNECEDORES: { nome: string; cnpj: string; prazo: number; condicao: string; avaliacao: number; dias: string; pedidoMinimo: number }[] = [
  { nome: 'Moinho Trigo Bom', cnpj: '10101010000110', prazo: 2, condicao: '28 dias', avaliacao: 4.6, dias: 'SEG,QUI', pedidoMinimo: 300 },
  { nome: 'Laticínios Serra Azul', cnpj: '20202020000120', prazo: 2, condicao: '14 dias', avaliacao: 4.4, dias: 'TER,SEX', pedidoMinimo: 250 },
  { nome: 'Distribuidora Bebidas Sul', cnpj: '30303030000130', prazo: 4, condicao: '28 dias', avaliacao: 4.1, dias: 'QUA', pedidoMinimo: 500 },
  { nome: 'Hortifruti Vale Verde', cnpj: '40404040000140', prazo: 1, condicao: 'À vista', avaliacao: 3.9, dias: 'TER,QUI,SAB', pedidoMinimo: 150 },
  { nome: 'Frigorífico Boi Bom', cnpj: '50505050000150', prazo: 2, condicao: '7/14/21', avaliacao: 4.7, dias: 'SEG,QUA,SEX', pedidoMinimo: 400 },
  { nome: 'Higiene & Limpeza Brasil', cnpj: '60606060000160', prazo: 5, condicao: '28 dias', avaliacao: 4.0, dias: 'QUI', pedidoMinimo: 200 },
];

const PRODUTOS: Def[] = [
  // Padaria e confeitaria (produção própria, com receita)
  { nome: 'Pão francês', cat: 'Padaria', un: 'KG', custo: 9, pesavel: true, plu: 1, produzido: true, validade: 1 },
  { nome: 'Pão de queijo', cat: 'Padaria', un: 'UN', custo: 0.9, produzido: true, validade: 2 },
  { nome: 'Baguete', cat: 'Padaria', un: 'UN', custo: 4.5, produzido: true, validade: 1 },
  { nome: 'Bolo de chocolate', cat: 'Confeitaria', un: 'UN', custo: 14, produzido: true, validade: 3 },
  { nome: 'Sonho', cat: 'Confeitaria', un: 'UN', custo: 1.8, produzido: true, validade: 2 },
  // Insumos (não aparecem no PDV)
  { nome: 'Farinha de trigo 25 kg', cat: 'Insumos de padaria', un: 'KG', custo: 4.2, insumo: true, forn: 'Moinho Trigo Bom', margem: 20 },
  { nome: 'Açúcar cristal', cat: 'Insumos de padaria', un: 'KG', custo: 4.8, insumo: true, forn: 'Moinho Trigo Bom', margem: 20 },
  { nome: 'Fermento biológico', cat: 'Insumos de padaria', un: 'KG', custo: 38, insumo: true, forn: 'Moinho Trigo Bom', margem: 20 },
  { nome: 'Sal refinado', cat: 'Insumos de padaria', un: 'KG', custo: 3, insumo: true, margem: 20 },
  { nome: 'Ovos', cat: 'Insumos de padaria', un: 'DZ', custo: 14, insumo: true, margem: 20 },
  { nome: 'Leite integral', cat: 'Insumos de padaria', un: 'L', custo: 4.2, insumo: true, forn: 'Laticínios Serra Azul', lote: true, validade: 10, margem: 20 },
  { nome: 'Manteiga', cat: 'Insumos de padaria', un: 'KG', custo: 42, insumo: true, forn: 'Laticínios Serra Azul', lote: true, validade: 60, margem: 20 },
  { nome: 'Chocolate em barra', cat: 'Insumos de padaria', un: 'KG', custo: 38, insumo: true, margem: 20 },
  // Mercearia
  { nome: 'Arroz tipo 1 5 kg', cat: 'Mercearia', un: 'PCT', custo: 24 },
  { nome: 'Feijão carioca 1 kg', cat: 'Mercearia', un: 'PCT', custo: 7.5 },
  { nome: 'Macarrão espaguete 500 g', cat: 'Mercearia', un: 'PCT', custo: 4.2 },
  { nome: 'Óleo de soja 900 ml', cat: 'Mercearia', un: 'UN', custo: 6.8 },
  { nome: 'Café torrado e moído 500 g', cat: 'Mercearia', un: 'PCT', custo: 15 },
  { nome: 'Biscoito cream cracker 400 g', cat: 'Mercearia', un: 'PCT', custo: 4.6 },
  { nome: 'Biscoito recheado chocolate 130 g', cat: 'Mercearia', un: 'UN', custo: 2.1 },
  { nome: 'Achocolatado em pó 400 g', cat: 'Mercearia', un: 'UN', custo: 9 },
  { nome: 'Leite condensado 395 g', cat: 'Mercearia', un: 'UN', custo: 4.8 },
  { nome: 'Molho de tomate 340 g', cat: 'Mercearia', un: 'UN', custo: 2.6 },
  { nome: 'Milho verde em conserva 200 g', cat: 'Mercearia', un: 'UN', custo: 2.3 },
  { nome: 'Sardinha em lata 125 g', cat: 'Mercearia', un: 'UN', custo: 4.9 },
  // Hortifrúti (pesáveis, com PLU da balança)
  { nome: 'Banana prata', cat: 'Hortifrúti', un: 'KG', custo: 4.5, pesavel: true, plu: 20, forn: 'Hortifruti Vale Verde' },
  { nome: 'Tomate', cat: 'Hortifrúti', un: 'KG', custo: 5.5, pesavel: true, plu: 21, forn: 'Hortifruti Vale Verde' },
  { nome: 'Cebola', cat: 'Hortifrúti', un: 'KG', custo: 3.8, pesavel: true, plu: 22, forn: 'Hortifruti Vale Verde' },
  { nome: 'Batata', cat: 'Hortifrúti', un: 'KG', custo: 4.2, pesavel: true, plu: 23, forn: 'Hortifruti Vale Verde' },
  { nome: 'Cenoura', cat: 'Hortifrúti', un: 'KG', custo: 3.6, pesavel: true, plu: 24, forn: 'Hortifruti Vale Verde' },
  { nome: 'Alface crespa', cat: 'Hortifrúti', un: 'UN', custo: 1.9, forn: 'Hortifruti Vale Verde' },
  // Açougue
  { nome: 'Carne moída de patinho', cat: 'Açougue', un: 'KG', custo: 34, pesavel: true, plu: 40, forn: 'Frigorífico Boi Bom' },
  { nome: 'Frango inteiro resfriado', cat: 'Açougue', un: 'KG', custo: 11, pesavel: true, plu: 41, forn: 'Frigorífico Boi Bom' },
  { nome: 'Linguiça toscana', cat: 'Açougue', un: 'KG', custo: 19, pesavel: true, plu: 42, forn: 'Frigorífico Boi Bom' },
  { nome: 'Picanha bovina', cat: 'Açougue', un: 'KG', custo: 62, pesavel: true, plu: 43, forn: 'Frigorífico Boi Bom' },
  // Frios e laticínios (com lote e validade)
  { nome: 'Queijo muçarela', cat: 'Frios e Laticínios', un: 'KG', custo: 30, pesavel: true, plu: 50, lote: true, validade: 30, forn: 'Laticínios Serra Azul' },
  { nome: 'Presunto cozido', cat: 'Frios e Laticínios', un: 'KG', custo: 26, pesavel: true, plu: 51, lote: true, validade: 25, forn: 'Frigorífico Boi Bom' },
  { nome: 'Mortadela', cat: 'Frios e Laticínios', un: 'KG', custo: 17, pesavel: true, plu: 52, lote: true, validade: 45, forn: 'Frigorífico Boi Bom' },
  { nome: 'Requeijão cremoso 200 g', cat: 'Frios e Laticínios', un: 'UN', custo: 6.5, lote: true, validade: 30, forn: 'Laticínios Serra Azul' },
  { nome: 'Iogurte natural 170 g', cat: 'Frios e Laticínios', un: 'UN', custo: 2.4, lote: true, validade: 20, forn: 'Laticínios Serra Azul' },
  { nome: 'Queijo prato fatiado 150 g', cat: 'Frios e Laticínios', un: 'UN', custo: 8.9, lote: true, validade: 30, forn: 'Laticínios Serra Azul' },
  // Bebidas
  { nome: 'Refrigerante cola 2 L', cat: 'Bebidas', un: 'UN', custo: 5, atacado: [6.9, 6], forn: 'Distribuidora Bebidas Sul' },
  { nome: 'Refrigerante guaraná 2 L', cat: 'Bebidas', un: 'UN', custo: 4.8, forn: 'Distribuidora Bebidas Sul' },
  { nome: 'Água mineral 500 ml', cat: 'Bebidas', un: 'UN', custo: 1.2, forn: 'Distribuidora Bebidas Sul' },
  { nome: 'Suco de laranja integral 1 L', cat: 'Bebidas', un: 'UN', custo: 6.5, forn: 'Distribuidora Bebidas Sul' },
  { nome: 'Cerveja lata 350 ml', cat: 'Bebidas', un: 'UN', custo: 3.4, forn: 'Distribuidora Bebidas Sul' },
  // Limpeza
  { nome: 'Detergente neutro 500 ml', cat: 'Limpeza', un: 'UN', custo: 2.2, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Água sanitária 1 L', cat: 'Limpeza', un: 'UN', custo: 3.1, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Sabão em pó 1 kg', cat: 'Limpeza', un: 'UN', custo: 9.5, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Desinfetante 2 L', cat: 'Limpeza', un: 'UN', custo: 8.2, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Esponja de aço', cat: 'Limpeza', un: 'UN', custo: 1.4, forn: 'Higiene & Limpeza Brasil' },
  // Higiene
  { nome: 'Papel higiênico 4 rolos', cat: 'Higiene', un: 'PCT', custo: 9.8, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Sabonete 90 g', cat: 'Higiene', un: 'UN', custo: 1.9, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Shampoo 350 ml', cat: 'Higiene', un: 'UN', custo: 11, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Creme dental 90 g', cat: 'Higiene', un: 'UN', custo: 4.1, forn: 'Higiene & Limpeza Brasil' },
  { nome: 'Desodorante aerosol 150 ml', cat: 'Higiene', un: 'UN', custo: 12.5, forn: 'Higiene & Limpeza Brasil' },
];

const RECEITAS: { produto: string; rendimento: number; preparo: number; forno: number; temp: number; itens: [string, number][] }[] = [
  {
    produto: 'Pão francês', rendimento: 10, preparo: 25, forno: 18, temp: 230,
    itens: [['Farinha de trigo 25 kg', 6], ['Sal refinado', 0.2], ['Fermento biológico', 0.1], ['Açúcar cristal', 0.1]],
  },
  {
    produto: 'Pão de queijo', rendimento: 60, preparo: 30, forno: 20, temp: 200,
    itens: [['Farinha de trigo 25 kg', 1.2], ['Ovos', 0.25], ['Leite integral', 0.3], ['Manteiga', 0.2], ['Sal refinado', 0.01]],
  },
  {
    produto: 'Bolo de chocolate', rendimento: 2, preparo: 40, forno: 45, temp: 180,
    itens: [['Farinha de trigo 25 kg', 0.5], ['Açúcar cristal', 0.4], ['Ovos', 0.5], ['Leite integral', 0.5], ['Manteiga', 0.2], ['Chocolate em barra', 0.2]],
  },
  {
    produto: 'Sonho', rendimento: 30, preparo: 60, forno: 15, temp: 190,
    itens: [['Farinha de trigo 25 kg', 1.2], ['Açúcar cristal', 0.3], ['Ovos', 0.1], ['Leite integral', 0.3], ['Manteiga', 0.1], ['Fermento biológico', 0.02]],
  },
  {
    produto: 'Baguete', rendimento: 10, preparo: 30, forno: 22, temp: 240,
    itens: [['Farinha de trigo 25 kg', 2.5], ['Fermento biológico', 0.05], ['Sal refinado', 0.05]],
  },
];

const RUAS = [
  'Rua das Acácias', 'Avenida Central', 'Rua dos Pinheiros', 'Rua Bela Vista', 'Alameda Jardim', 'Rua Santa Clara',
  'Rua Monte Alegre', 'Rua dos Lírios', 'Avenida Brasil', 'Rua Três Rios', 'Rua Cerejeiras', 'Rua Dona Ana',
  'Rua Sete de Abril', 'Rua do Comércio', 'Rua Primavera',
];

const VAREJO_NOMES = [
  'Maria Aparecida Lima', 'José Carlos Pereira', 'Fernanda Oliveira', 'Paulo Henrique Rocha', 'Juliana Martins',
  'Antônio Souza', 'Patrícia Gomes', 'Roberto Alves', 'Luciana Ferreira', 'Marcos Vinícius Dias', 'Cláudia Nunes',
];
const ATACADO_NOMES = ['Mercearia Bom Preço Ltda', 'Restaurante Sabor da Terra', 'Lanchonete Estação Central', 'Pousada Recanto Verde'];
const LIMITES_FIADO = [300, 500, 800, 1000];

// ---------- Tipos de apoio ----------

interface ClienteDemo {
  id: number;
  nome: string;
  tipo: TipoCliente;
  telefone: string;
  endereco: string;
  bairro: string;
  lat: number;
  lng: number;
  limite: number;
  vendedorId: number | null;
}

interface Contexto {
  matriz: Loja;
  bairro: Loja;
  cd: Loja;
  operador: Usuario;
  padeiro: Usuario;
  estoquista: Usuario;
  compras: Usuario;
  motorista: Usuario;
  vendedor: Usuario;
  fiorino: Veiculo;
  produtos: Produto[];
  porNome: Map<string, Produto>;
  vendaveis: Produto[];
  promos: Promocao[];
  varejo: ClienteDemo[];
  atacado: ClienteDemo[];
  fiados: ClienteDemo[];
  saldoFiado: Map<number, number>;
  fornecedores: Map<string, number>;
  contagem: { vendas: number; entregas: number };
}

// ---------- Vendas ----------

function escolherForma(): FormaPagamento {
  const r = sortear();
  if (r < 0.35) return 'DINHEIRO';
  if (r < 0.65) return 'PIX';
  if (r < 0.8) return 'DEBITO';
  return 'CREDITO';
}

// Sorteia n produtos distintos e calcula o total com a mesma regra do registrarVenda (promoções vigentes).
function itensAleatorios(ctx: Contexto, n: number, tipo: TipoCliente): { itens: ItemEntrada[]; total: number } {
  const usados = new Set<number>();
  const itens: ItemEntrada[] = [];
  let total = 0;
  while (itens.length < n) {
    const p = escolher(ctx.vendaveis);
    if (usados.has(p.id)) continue;
    usados.add(p.id);
    let quantidade: number;
    if (p.pesavel) quantidade = arred3(aleatorio(0.15, 1.6));
    else if (p.nome.startsWith('Refrigerante cola') && chance(0.25)) quantidade = inteiro(6, 8);
    else quantidade = inteiro(1, 3);
    total += calcularPreco(p, quantidade, ctx.promos, tipo).total;
    itens.push({ produtoId: p.id, quantidade });
  }
  return { itens, total: arred2(total) };
}

function pagamentoDa(forma: FormaPagamento, total: number): PagamentoEntrada[] {
  if (forma === 'DINHEIRO') return [{ forma, valor: Math.ceil(total / 5) * 5 }];
  if (forma === 'CREDITO') return [{ forma, valor: total, parcelas: chance(0.3) ? 2 : 1 }];
  return [{ forma, valor: total }];
}

// Coloca a data simulada nos registros que o registrarVenda gravou com a hora atual.
async function datarVenda(tx: Tx, vendaId: number, notaId: number | null, quando: Date, fiado: boolean): Promise<void> {
  await tx.venda.update({ where: { id: vendaId }, data: { criadoEm: quando, concluidaEm: quando } });
  await tx.movimentoEstoque.updateMany({ where: { referencia: `venda:${vendaId}` }, data: { criadoEm: quando } });
  if (notaId !== null) {
    await tx.notaFiscal.update({ where: { id: notaId }, data: { criadoEm: quando, autorizadaEm: quando } });
  }
  if (fiado) {
    await tx.movimentoFiado.updateMany({ where: { vendaId }, data: { criadoEm: quando } });
    await tx.lancamento.updateMany({ where: { referencia: `venda:${vendaId}` }, data: { criadoEm: quando, vencimento: somarDias(quando, 30) } });
  }
}

async function venderUma(tx: Tx, ctx: Contexto, loja: Loja, caixaId: number, quando: Date, emitir: boolean): Promise<{ total: number; dinheiro: number }> {
  const sorte = sortear();
  let cliente: ClienteDemo | null = sorte < 0.2 ? escolher(ctx.varejo) : sorte < 0.27 ? escolher(ctx.atacado) : null;
  let forma: FormaPagamento = escolherForma();
  const n = inteiro(1, 8);
  let venda = itensAleatorios(ctx, n, cliente?.tipo ?? 'VAREJO');

  // Fiado: poucas vendas, só para clientes com limite disponível.
  if (chance(0.04)) {
    const f = escolher(ctx.fiados);
    const alternativa = itensAleatorios(ctx, n, 'VAREJO');
    if ((ctx.saldoFiado.get(f.id) ?? 0) + alternativa.total <= f.limite) {
      cliente = f;
      venda = alternativa;
      forma = 'FIADO';
    }
  }

  const r = await registrarVenda(tx, {
    lojaId: loja.id,
    usuarioId: ctx.operador.id,
    vendedorId: cliente?.vendedorId ?? null,
    clienteId: cliente?.id ?? null,
    caixaId,
    origem: 'PDV',
    itens: venda.itens,
    pagamentos: pagamentoDa(forma, venda.total),
    emitirNota: emitir,
  });
  if (forma === 'FIADO' && cliente) {
    ctx.saldoFiado.set(cliente.id, (ctx.saldoFiado.get(cliente.id) ?? 0) + r.total);
  }
  await datarVenda(tx, r.vendaId, r.notaId, quando, forma === 'FIADO');
  ctx.contagem.vendas += 1;
  return { total: r.total, dinheiro: forma === 'DINHEIRO' ? r.total : 0 };
}

// Um dia de uma loja: caixa aberto no início, vendas nos horários sorteados e caixa fechado no fim
// (exceto o caixa de hoje da Matriz, que fica ABERTO).
async function diaDaLoja(tx: Tx, ctx: Contexto, loja: Loja, horarios: Date[], emitir: boolean, hojeAberto: boolean): Promise<void> {
  const primeiro = horarios[0];
  const abertura = new Date(primeiro);
  abertura.setHours(7, 0, 0, 0);
  if (abertura.getTime() > primeiro.getTime()) abertura.setTime(primeiro.getTime() - 60000);

  const caixa: Caixa = await tx.caixa.create({
    data: { lojaId: loja.id, terminal: TERMINAL, usuarioId: ctx.operador.id, status: 'ABERTO', valorAbertura: 200, abertoEm: abertura },
  });

  let dinheiro = 0;
  for (const quando of horarios) {
    const r = await venderUma(tx, ctx, loja, caixa.id, quando, emitir);
    dinheiro += r.dinheiro;
  }

  if (hojeAberto) {
    await entregasDeHoje(tx, ctx, caixa.id);
    return;
  }

  const fechamento = new Date(horarios[horarios.length - 1].getTime() + 30 * 60000);
  const diferenca = chance(0.2) ? arred2(aleatorio(-4, 4)) : 0;
  await tx.caixa.update({
    where: { id: caixa.id },
    data: { status: 'FECHADO', fechadoEm: fechamento, valorInformado: arred2(200 + dinheiro + diferenca), diferenca },
  });
}

function horariosDoDia(dia: Date, quantidade: number): Date[] {
  return Array.from({ length: quantidade }, () => horaNoDia(dia, inteiro(7, 21), inteiro(0, 59))).sort((a, b) => a.getTime() - b.getTime());
}

// Hoje: das 7h até agora (ou as últimas 3 horas, se ainda não deu 7h).
function horariosDeHoje(quantidade: number): Date[] {
  const fim = agora.getTime() - 60000;
  let inicio = horaNoDia(hoje, 7, 0).getTime();
  if (inicio > fim - 3600000) inicio = fim - 3 * 3600000;
  inicio = Math.max(inicio, hoje.getTime());
  return Array.from({ length: quantidade }, () => new Date(inicio + sortear() * (fim - inicio))).sort((a, b) => a.getTime() - b.getTime());
}

// Cinco pedidos de delivery de hoje; três deles saem numa rota (motorista e Fiorino).
async function entregasDeHoje(tx: Tx, ctx: Contexto, caixaId: number): Promise<void> {
  const clientes = ctx.varejo.slice(4, 9);
  const criadas: { entregaId: number; peso: number }[] = [];
  for (const [i, cli] of clientes.entries()) {
    const { itens } = itensAleatorios(ctx, inteiro(2, 4), 'VAREJO');
    const r = await registrarVenda(tx, {
      lojaId: ctx.matriz.id,
      usuarioId: ctx.operador.id,
      clienteId: cli.id,
      caixaId,
      origem: 'DELIVERY',
      itens,
      pagamentos: [],
      permitirSemPagamento: true,
      acrescimo: TAXA_ENTREGA,
      emitirNota: true,
      observacao: 'Pedido de delivery (demonstração)',
    });
    await datarVenda(tx, r.vendaId, r.notaId, hojeAs(10 + i, 20), false);
    const peso = arred3(aleatorio(1, 8));
    const entrega = await criarEntrega(tx, {
      vendaId: r.vendaId,
      clienteId: cli.id,
      destinatario: cli.nome,
      telefone: cli.telefone,
      endereco: cli.endereco,
      bairro: cli.bairro,
      cidade: 'São Paulo',
      latitude: cli.lat,
      longitude: cli.lng,
      taxa: TAXA_ENTREGA,
      valorCobrar: r.total,
      pesoKg: peso,
      previsao: horaNoDia(hoje, 13 + i, 0),
    });
    criadas.push({ entregaId: entrega.id, peso });
    ctx.contagem.vendas += 1;
    ctx.contagem.entregas += 1;
  }

  const emRota = criadas.slice(0, 3);
  const pesoTotal = arred2(emRota.reduce((s, c) => s + c.peso, 0));
  const rota = await tx.rota.create({
    data: {
      codigo: `ROTA-${dataCurta()}-01`,
      lojaId: ctx.matriz.id,
      data: hoje,
      veiculoId: ctx.fiorino.id,
      motoristaId: ctx.motorista.id,
      status: 'EM_ROTA',
      pesoTotalKg: pesoTotal,
      distanciaKm: 14.2,
      kmInicial: 48230,
      saidaEm: hojeAs(8, 30),
    },
  });
  for (const [ordem, c] of emRota.entries()) {
    await tx.entrega.update({
      where: { id: c.entregaId },
      data: { status: 'EM_ROTA', rotaId: rota.id, ordem: ordem + 1, motoristaId: ctx.motorista.id, saiuEm: hojeAs(8, 30) },
    });
  }
}

// ---------- Compras, recebimento, produção, logística e força de vendas ----------

type LinhaCompra = [string, number, number]; // produto, quantidade, preço unitário

export async function carregarDemonstracao(prisma: PrismaClient): Promise<void> {
  const inicio = Date.now();
  const senhaHash = bcrypt.hashSync(SENHA, 10);

  // Lojas: a Matriz vem do seed padrão; as outras duas são criadas aqui.
  const matrizBase = await prisma.loja.findFirstOrThrow({ where: { nome: 'Loja Matriz' } });
  const matriz = await prisma.loja.update({
    where: { id: matrizBase.id },
    data: { cnpj: '10000000000101', telefone: '(11) 3000-0001', endereco: 'Rua das Flores, 100', cidade: 'São Paulo', uf: 'SP', latitude: -23.5505, longitude: -46.6333 },
  });
  const bairro = await prisma.loja.create({
    data: { nome: 'Loja Bairro Jardim', tipo: 'LOJA', cnpj: '10000000000202', telefone: '(11) 3000-0002', endereco: 'Rua Bela Vista, 350', cidade: 'São Paulo', uf: 'SP', latitude: -23.5614, longitude: -46.6559 },
  });
  const cd = await prisma.loja.create({
    data: { nome: 'Centro de Distribuição', tipo: 'CENTRO_DISTRIBUICAO', cnpj: '10000000000303', telefone: '(11) 3000-0003', endereco: 'Avenida dos Armazéns, 1200', cidade: 'São Paulo', uf: 'SP', latitude: -23.533, longitude: -46.605 },
  });

  // Equipe: uma conta de cada perfil (senha demo1234).
  const criarUsuario = (nome: string, email: string, perfil: Perfil, lojaId: number | null, extra: { cnh?: string; comissaoPercentual?: number; saldoFlex?: number } = {}) =>
    prisma.usuario.create({ data: { nome, email, perfil, lojaId, senhaHash, ativo: true, ...extra } });
  const operador = await criarUsuario('Bruna Teixeira', 'operador@mercado.local', 'OPERADOR', matriz.id);
  const estoquista = await criarUsuario('Eduardo Ramos', 'estoque@mercado.local', 'ESTOQUISTA', cd.id);
  const padeiro = await criarUsuario('Osvaldo Nunes', 'padeiro@mercado.local', 'PADEIRO', matriz.id);
  const compras = await criarUsuario('Renata Barbosa', 'compras@mercado.local', 'COMPRADOR', cd.id);
  const motorista = await criarUsuario('Jorge Almeida', 'motorista@mercado.local', 'MOTORISTA', cd.id, { cnh: '01234567890' });
  const vendedor = await criarUsuario('Tiago Moreira', 'vendedor@mercado.local', 'VENDEDOR', matriz.id, { comissaoPercentual: 3, saldoFlex: 200 });
  await criarUsuario('Helena Prado', 'contador@mercado.local', 'CONTADOR', null);

  // Categorias
  const categorias = new Map<string, number>();
  for (const [ordem, [nome, setor]] of CATEGORIAS.entries()) {
    const c = await prisma.categoria.create({ data: { nome, setor, ordem } });
    categorias.set(nome, c.id);
  }

  // Fornecedores
  const fornecedores = new Map<string, number>();
  for (const [i, f] of FORNECEDORES.entries()) {
    const criado = await prisma.fornecedor.create({
      data: {
        nome: f.nome,
        cnpj: f.cnpj,
        telefone: `(11) 3000-1${String(i).padStart(3, '0')}`,
        email: `contato${i + 1}@fornecedor.demo`,
        cidade: 'São Paulo',
        uf: 'SP',
        prazoEntregaDias: f.prazo,
        condicaoPagamento: f.condicao,
        avaliacao: f.avaliacao,
        pedidoMinimo: f.pedidoMinimo,
        diasVisita: f.dias,
      },
    });
    fornecedores.set(f.nome, criado.id);
  }

  // Produtos (EAN de 13 dígitos começando com 789, com dígito verificador)
  const porNome = new Map<string, Produto>();
  const produtos: Produto[] = [];
  for (const [i, d] of PRODUTOS.entries()) {
    const base = `789${String(i + 1).padStart(9, '0')}`;
    const margem = d.margem ?? aleatorio(25, 45);
    const precoVenda = sugerirPrecoVenda(d.custo, margem, true);
    const fornecedorId = d.forn ? fornecedores.get(d.forn) ?? null : null;
    const p = await prisma.produto.create({
      data: {
        codigo: `PR${String(i + 1).padStart(4, '0')}`,
        ean: base + digitoVerificadorEan(base),
        nome: d.nome,
        categoriaId: categorias.get(d.cat)!,
        unidade: d.un,
        pesavel: d.pesavel ?? false,
        codigoBalanca: d.plu ?? null,
        precoCusto: d.custo,
        precoVenda,
        precoAtacado: d.atacado ? d.atacado[0] : null,
        qtdAtacado: d.atacado ? d.atacado[1] : null,
        estoqueMinimo: d.insumo ? 20 : 10,
        pesoBrutoKg: d.pesavel ? 1 : arred3(aleatorio(0.1, 2.5)),
        produzido: d.produzido ?? false,
        insumo: d.insumo ?? false,
        validadeDias: d.validade ?? null,
        controlaLote: (d.lote ?? false) || (d.produzido ?? false),
        ativo: true,
        fornecedorPadraoId: fornecedorId,
        // Foto do catálogo de demonstração (client/public/produtos/PR0001.jpg ...).
        foto: `/produtos/PR${String(i + 1).padStart(4, '0')}.jpg`,
      },
    });
    if (fornecedorId !== null) {
      await prisma.produtoFornecedor.create({ data: { produtoId: p.id, fornecedorId, codigoFornecedor: `F-${i + 1}`, ultimoPreco: d.custo, fatorConversao: 1 } });
    }
    porNome.set(d.nome, p);
    produtos.push(p);
  }
  const produto = (nome: string): Produto => {
    const p = porNome.get(nome);
    if (!p) throw new Error(`Produto de demonstração não encontrado: ${nome}`);
    return p;
  };

  // Receitas da padaria
  for (const r of RECEITAS) {
    await prisma.receita.create({
      data: {
        produtoId: produto(r.produto).id,
        rendimento: r.rendimento,
        tempoPreparoMin: r.preparo,
        tempoFornoMin: r.forno,
        temperaturaForno: r.temp,
        modoPreparo: 'Misturar, sovar, descansar, modelar e assar.',
        itens: { create: r.itens.map(([insumo, quantidade]) => ({ insumoId: produto(insumo).id, quantidade })) },
      },
    });
  }

  // Clientes: varejo (4 com fiado) e atacado (carteira do vendedor, com código B2B)
  const coord = (base: number): number => Math.round((base + aleatorio(-0.02, 0.02)) * 1e7) / 1e7;
  const varejo: ClienteDemo[] = [];
  const atacado: ClienteDemo[] = [];
  const fiados: ClienteDemo[] = [];
  for (const [i, nome] of VAREJO_NOMES.entries()) {
    const lat = coord(-23.5505);
    const lng = coord(-46.6333);
    const limite = i < LIMITES_FIADO.length ? LIMITES_FIADO[i] : 0;
    const c = await prisma.cliente.create({
      data: {
        nome,
        tipo: 'VAREJO',
        cpfCnpj: `10000000${String(i + 1).padStart(3, '0')}`,
        telefone: `(11) 98000-${String(1000 + i).padStart(4, '0')}`,
        whatsapp: `(11) 98000-${String(1000 + i).padStart(4, '0')}`,
        endereco: RUAS[i],
        numero: String(100 + i * 17),
        bairro: 'Jardim Primavera',
        cidade: 'São Paulo',
        uf: 'SP',
        latitude: lat,
        longitude: lng,
        limiteCredito: limite,
      },
    });
    const info: ClienteDemo = { id: c.id, nome, tipo: 'VAREJO', telefone: `(11) 98000-${String(1000 + i).padStart(4, '0')}`, endereco: `${RUAS[i]}, ${100 + i * 17}`, bairro: 'Jardim Primavera', lat, lng, limite, vendedorId: null };
    varejo.push(info);
    if (limite > 0) fiados.push(info);
  }
  for (const [i, nome] of ATACADO_NOMES.entries()) {
    const lat = coord(-23.5505);
    const lng = coord(-46.6333);
    const c = await prisma.cliente.create({
      data: {
        nome,
        tipo: 'ATACADO',
        cpfCnpj: `2${'0'.repeat(12)}${i + 1}`,
        telefone: `(11) 97000-${String(2000 + i).padStart(4, '0')}`,
        endereco: RUAS[11 + i],
        numero: String(900 + i),
        bairro: 'Centro',
        cidade: 'São Paulo',
        uf: 'SP',
        latitude: lat,
        longitude: lng,
        vendedorId: vendedor.id,
        codigoB2B: codigoAleatorio(8),
      },
    });
    atacado.push({ id: c.id, nome, tipo: 'ATACADO', telefone: `(11) 97000-${String(2000 + i).padStart(4, '0')}`, endereco: `${RUAS[11 + i]}, ${900 + i}`, bairro: 'Centro', lat, lng, limite: 0, vendedorId: vendedor.id });
  }

  // Veículos
  const fiorino = await prisma.veiculo.create({ data: { placa: 'DEM0F01', modelo: 'Fiat Fiorino', tipo: 'Utilitário', capacidadeKg: 650, capacidadeVolumes: 30 } });
  await prisma.veiculo.create({ data: { placa: 'DEM0M02', modelo: 'Honda CG 160', tipo: 'Moto', capacidadeKg: 30 } });

  // Estoque inicial nas três lojas (antes do histórico de vendas)
  const estoqueInicial = (p: Produto, loja: 'matriz' | 'bairro' | 'cd'): number => {
    if (p.insumo) return loja === 'matriz' ? 200 : loja === 'cd' ? 1000 : 0;
    if (p.produzido) {
      if (loja === 'cd') return 0;
      if (p.pesavel) return loja === 'matriz' ? 600 : 200;
      return loja === 'matriz' ? 1500 : 500;
    }
    if (loja === 'cd') return p.pesavel ? 800 : 4000;
    if (loja === 'matriz') return p.pesavel ? 600 : 1500;
    return p.pesavel ? 200 : 500;
  };
  const ctxBase = { matriz, bairro, cd, operador, padeiro, estoquista, compras, motorista, vendedor, fiorino };
  await prisma.$transaction(async (tx) => {
    for (const p of produtos) {
      for (const [chave, loja] of [['matriz', matriz], ['bairro', bairro], ['cd', cd]] as const) {
        const quantidade = estoqueInicial(p, chave);
        if (quantidade > 0) {
          await movimentarEstoque(tx, { produtoId: p.id, lojaId: loja.id, tipo: 'ENTRADA', quantidade, custoUnitario: num(p.precoCusto), motivo: 'Estoque inicial da demonstração', usuarioId: compras.id });
        }
      }
    }
  }, TX_OPCOES);

  // Promoções vigentes (a regra do PDV usa as promoções vigentes no momento da venda)
  const cola = produto('Refrigerante cola 2 L');
  await prisma.promocao.create({
    data: { nome: 'Refrigerante 2 L em oferta', tipo: 'PRECO_FIXO', produtoId: cola.id, valor: 5.99, industria: 'Bebidas Sol do Sul', bonificacaoUnidade: 0.8, inicio: diaRelativo(7), fim: somarDias(hoje, 14) },
  });
  await prisma.promocao.create({
    data: { nome: 'Leve 3, pague 2 em higiene', tipo: 'LEVE_PAGUE', categoriaId: categorias.get('Higiene')!, valor: 0, levar: 3, pagar: 2, inicio: diaRelativo(7), fim: somarDias(hoje, 14) },
  });
  await prisma.promocao.create({
    data: { nome: 'Semana do hortifrúti: 10% off', tipo: 'PERCENTUAL', categoriaId: categorias.get('Hortifrúti')!, valor: 10, inicio: diaRelativo(7), fim: somarDias(hoje, 14) },
  });
  const promos = await promocoesVigentes(produtos);

  // ---------- Histórico de 180 dias (Matriz todo dia; Bairro Jardim dos dias anteriores a hoje) ----------
  const vendaveis = produtos.filter((p) => !p.insumo && p.ativo);
  const ctx: Contexto = {
    ...ctxBase,
    produtos,
    porNome,
    vendaveis,
    promos,
    varejo,
    atacado,
    fiados,
    saldoFiado: new Map<number, number>(),
    fornecedores,
    contagem: { vendas: 0, entregas: 0 },
  };

  for (let k = DIAS_HISTORICO - 1; k >= 0; k--) {
    const dia = diaRelativo(k);
    const emitir = k <= 30;
    await prisma.$transaction(async (tx) => {
      if (k === 0) {
        await diaDaLoja(tx, ctx, matriz, horariosDeHoje(inteiro(15, 45)), emitir, true);
      } else {
        await diaDaLoja(tx, ctx, matriz, horariosDoDia(dia, inteiro(15, 45)), emitir, false);
        await diaDaLoja(tx, ctx, bairro, horariosDoDia(dia, inteiro(5, 15)), emitir, false);
      }
    }, TX_OPCOES);
    if (k % 30 === 0) console.log(`  histórico: faltam ${k} dias (${ctx.contagem.vendas} vendas até agora)`);
  }

  // ---------- Compras: recebimento concluído, pedidos em vários status, cotação e contas a pagar ----------
  const LATICINIOS: { produto: string; qtd: number; custo: number; lote: string; validade: Date }[] = [
    { produto: 'Queijo muçarela', qtd: 40, custo: 30, lote: 'LS-MUC-01', validade: somarDias(hoje, 4) },
    { produto: 'Requeijão cremoso 200 g', qtd: 60, custo: 5.2, lote: 'LS-REQ-01', validade: somarDias(hoje, 25) },
    { produto: 'Iogurte natural 170 g', qtd: 60, custo: 1.9, lote: 'LS-IOG-01', validade: somarDias(hoje, -2) },
    { produto: 'Queijo prato fatiado 150 g', qtd: 30, custo: 7.1, lote: 'LS-PRA-01', validade: somarDias(hoje, 3) },
    { produto: 'Leite integral', qtd: 200, custo: 3.6, lote: 'LS-LEI-01', validade: somarDias(hoje, 6) },
    { produto: 'Manteiga', qtd: 20, custo: 39, lote: 'LS-MAN-01', validade: somarDias(hoje, 60) },
  ];
  const linhas = (lista: LinhaCompra[]) => lista.map(([nome, quantidade, precoUnitario]) => ({ produtoId: produto(nome).id, quantidade, precoUnitario, quantidadeRecebida: 0 }));
  const totalDe = (lista: LinhaCompra[]): number => arred2(lista.reduce((s, [, q, p]) => s + q * p, 0));
  const categoriasFin = await prisma.categoriaFinanceira.findMany();
  const catDespesa = (nome: string): number => categoriasFin.find((c) => c.nome === nome && c.tipo === 'DESPESA')!.id;
  const fid = (nome: string): number => fornecedores.get(nome)!;

  await prisma.$transaction(async (tx) => {
    // Pedido recebido e recebimento concluído (lotes de laticínios no CD).
    const totalRecebido = arred2(LATICINIOS.reduce((s, i) => s + i.qtd * i.custo, 0));
    const pedidoRecebido = await tx.pedidoCompra.create({
      data: {
        fornecedorId: fid('Laticínios Serra Azul'),
        lojaId: cd.id,
        status: 'RECEBIDO',
        total: totalRecebido,
        condicaoPagamento: '14 dias',
        enviadoEm: diaRelativo(7),
        confirmadoEm: diaRelativo(6),
        recebidoEm: diaRelativo(3),
        usuarioId: compras.id,
        itens: { create: LATICINIOS.map((i) => ({ produtoId: produto(i.produto).id, quantidade: i.qtd, precoUnitario: i.custo, quantidadeRecebida: i.qtd })) },
      },
    });
    const recebimento = await tx.recebimento.create({
      data: {
        pedidoCompraId: pedidoRecebido.id,
        fornecedorId: fid('Laticínios Serra Azul'),
        lojaId: cd.id,
        numeroNota: '045821',
        serieNota: '1',
        valorNota: totalRecebido,
        status: 'CONCLUIDO',
        usuarioId: estoquista.id,
        concluidoEm: diaRelativo(3),
        itens: { create: LATICINIOS.map((i) => ({ produtoId: produto(i.produto).id, quantidadeNota: i.qtd, quantidadeRecebida: i.qtd, precoUnitario: i.custo, lote: i.lote, validade: i.validade })) },
      },
    });
    for (const i of LATICINIOS) {
      const p = produto(i.produto);
      await atualizarCustoMedio(tx, p.id, i.qtd, i.custo);
      await movimentarEstoque(tx, {
        produtoId: p.id,
        lojaId: cd.id,
        tipo: 'ENTRADA',
        quantidade: i.qtd,
        custoUnitario: i.custo,
        referencia: `recebimento:${recebimento.id}`,
        usuarioId: estoquista.id,
        lote: { codigo: i.lote, validade: i.validade, recebimentoId: recebimento.id },
      });
    }
    await tx.lancamento.create({
      data: {
        tipo: 'DESPESA',
        origem: 'COMPRA',
        descricao: `Pedido de compra nº ${pedidoRecebido.numero} - Laticínios Serra Azul`,
        valor: totalRecebido,
        vencimento: somarDias(hoje, 10),
        categoriaId: catDespesa('Fornecedores'),
        fornecedorId: fid('Laticínios Serra Azul'),
        lojaId: cd.id,
        referencia: `pedidoCompra:${pedidoRecebido.id}`,
        documento: '045821',
      },
    });

    // Rascunho de hortifrúti (em montagem)
    const hortifruti: LinhaCompra[] = [['Banana prata', 80, 4.2], ['Tomate', 120, 5.1], ['Cebola', 90, 3.5]];
    await tx.pedidoCompra.create({
      data: { fornecedorId: fid('Hortifruti Vale Verde'), lojaId: cd.id, status: 'RASCUNHO', total: totalDe(hortifruti), condicaoPagamento: 'À vista', usuarioId: compras.id, observacoes: 'Reposição de hortifrúti (em montagem)', itens: { create: linhas(hortifruti) } },
    });

    // Enviado para a higiene e limpeza
    const higiene: LinhaCompra[] = [['Papel higiênico 4 rolos', 200, 9.1], ['Sabão em pó 1 kg', 120, 8.9]];
    await tx.pedidoCompra.create({
      data: { fornecedorId: fid('Higiene & Limpeza Brasil'), lojaId: cd.id, status: 'ENVIADO', total: totalDe(higiene), condicaoPagamento: '28 dias', enviadoEm: diaRelativo(2), previsaoEntrega: somarDias(hoje, 5), usuarioId: compras.id, itens: { create: linhas(higiene) } },
    });

    // Em trânsito com previsão de entrega hoje
    const bebidas: LinhaCompra[] = [['Refrigerante cola 2 L', 240, 4.6], ['Água mineral 500 ml', 300, 1.05]];
    const pedidoTransito = await tx.pedidoCompra.create({
      data: { fornecedorId: fid('Distribuidora Bebidas Sul'), lojaId: cd.id, status: 'EM_TRANSITO', total: totalDe(bebidas), condicaoPagamento: '28 dias', enviadoEm: diaRelativo(3), confirmadoEm: diaRelativo(2), previsaoEntrega: horaNoDia(hoje, 18, 0), rastreio: 'TRANSP-DEMO-7781', usuarioId: compras.id, itens: { create: linhas(bebidas) } },
    });
    await tx.lancamento.create({
      data: {
        tipo: 'DESPESA',
        origem: 'COMPRA',
        descricao: `Pedido de compra nº ${pedidoTransito.numero} - Distribuidora Bebidas Sul`,
        valor: totalDe(bebidas),
        vencimento: somarDias(hoje, 25),
        categoriaId: catDespesa('Fornecedores'),
        fornecedorId: fid('Distribuidora Bebidas Sul'),
        lojaId: cd.id,
        referencia: `pedidoCompra:${pedidoTransito.id}`,
      },
    });

    // Compra anterior já paga
    await tx.lancamento.create({
      data: {
        tipo: 'DESPESA',
        origem: 'COMPRA',
        descricao: 'Compra de farinha e fermento - Moinho Trigo Bom',
        valor: 2150,
        vencimento: dataDoMes(0, 1),
        pagoEm: dataDoMes(0, 1),
        valorPago: 2150,
        formaPagamento: 'BOLETO',
        categoriaId: catDespesa('Fornecedores'),
        fornecedorId: fid('Moinho Trigo Bom'),
        lojaId: cd.id,
        documento: '018330',
      },
    });

    // Cotação aberta com respostas de dois fornecedores
    const itensCotacao: [string, number][] = [['Arroz tipo 1 5 kg', 300], ['Feijão carioca 1 kg', 200], ['Macarrão espaguete 500 g', 150], ['Óleo de soja 900 ml', 120]];
    const cotacao = await tx.cotacao.create({
      data: {
        titulo: 'Cotação de mercearia da semana',
        status: 'ABERTA',
        prazo: horaNoDia(hoje, 18, 0),
        usuarioId: compras.id,
        itens: { create: itensCotacao.map(([nome, quantidade]) => ({ produtoId: produto(nome).id, quantidade })) },
        fornecedores: {
          create: [
            { fornecedorId: fid('Moinho Trigo Bom'), token: codigoAleatorio(24), respondidoEm: diaRelativo(1) },
            { fornecedorId: fid('Higiene & Limpeza Brasil'), token: codigoAleatorio(24), respondidoEm: diaRelativo(1) },
          ],
        },
      },
    });
    const precos: [string, number, number, number][] = [
      ['Moinho Trigo Bom', 22.9, 7.2, 3.9],
      ['Higiene & Limpeza Brasil', 23.4, 7.5, 4.1],
    ];
    const respostas: { cotacaoId: number; fornecedorId: number; produtoId: number; preco: number; prazoDias: number }[] = [];
    for (const [fornecedor, arroz, feijao, macarrao] of precos) {
      const fornecedorId = fid(fornecedor);
      const valores = [arroz, feijao, macarrao, 6.5];
      for (const [i, [nome]] of itensCotacao.entries()) {
        respostas.push({ cotacaoId: cotacao.id, fornecedorId, produtoId: produto(nome).id, preco: valores[i], prazoDias: fornecedor.startsWith('Moinho') ? 2 : 3 });
      }
    }
    await tx.cotacaoResposta.createMany({ data: respostas });

    // Despesas fixas dos últimos três meses: pagas nos meses anteriores e em aberto no mês atual
    for (const m of [-2, -1, 0]) {
      const pago = m < 0;
      const nomeMes = dataDoMes(m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const fixas: [string, string, number, number, FormaPagamento][] = [
        ['Aluguel', 'Aluguel do ponto', 6500, 5, 'PIX'],
        ['Energia e água', 'Conta de energia e água', arred2(aleatorio(1500, 2100)), 12, 'BOLETO'],
        ['Folha de pagamento', 'Folha de pagamento da equipe', 18400, 5, 'PIX'],
      ];
      for (const [categoria, descricao, valor, dia, forma] of fixas) {
        await tx.lancamento.create({
          data: {
            tipo: 'DESPESA',
            origem: 'MANUAL',
            descricao: `${descricao} - ${nomeMes}`,
            valor,
            vencimento: dataDoMes(m, dia),
            pagoEm: pago ? dataDoMes(m, dia) : null,
            valorPago: pago ? valor : null,
            formaPagamento: pago ? forma : null,
            categoriaId: catDespesa(categoria),
            lojaId: matriz.id,
          },
        });
      }
    }

    // Transferência enviada do CD para a Loja Bairro Jardim
    const transferencia = await tx.transferencia.create({
      data: { origemLojaId: cd.id, destinoLojaId: bairro.id, status: 'ENVIADA', observacoes: 'Reposição semanal da Loja Bairro Jardim', usuarioId: estoquista.id, enviadaEm: hojeAs(9, 0) },
    });
    const itensTransferencia: [string, number][] = [['Arroz tipo 1 5 kg', 60], ['Sabão em pó 1 kg', 40], ['Refrigerante cola 2 L', 48]];
    for (const [nome, quantidade] of itensTransferencia) {
      await tx.transferenciaItem.create({ data: { transferenciaId: transferencia.id, produtoId: produto(nome).id, quantidade } });
      await movimentarEstoque(tx, { produtoId: produto(nome).id, lojaId: cd.id, tipo: 'TRANSFERENCIA_SAIDA', quantidade: -quantidade, referencia: `transferencia:${transferencia.id}`, usuarioId: estoquista.id });
    }

    // Lotes de frios e laticínios nas duas lojas (uma validade já vencida na Matriz)
    const lotesLojas: { loja: Loja; produto: string; qtd: number; codigo: string; validade: Date }[] = [
      { loja: matriz, produto: 'Presunto cozido', qtd: 12, codigo: 'FR-PRE-M1', validade: somarDias(hoje, 3) },
      { loja: matriz, produto: 'Mortadela', qtd: 10, codigo: 'FR-MOR-M1', validade: somarDias(hoje, 40) },
      { loja: matriz, produto: 'Queijo muçarela', qtd: 6, codigo: 'LS-MUC-V1', validade: somarDias(hoje, -1) },
      { loja: matriz, produto: 'Requeijão cremoso 200 g', qtd: 15, codigo: 'LS-REQ-M1', validade: somarDias(hoje, 5) },
      { loja: bairro, produto: 'Presunto cozido', qtd: 8, codigo: 'FR-PRE-B1', validade: somarDias(hoje, 2) },
      { loja: bairro, produto: 'Queijo prato fatiado 150 g', qtd: 10, codigo: 'LS-PRA-B1', validade: somarDias(hoje, 5) },
    ];
    for (const l of lotesLojas) {
      const p = produto(l.produto);
      await movimentarEstoque(tx, {
        produtoId: p.id,
        lojaId: l.loja.id,
        tipo: 'ENTRADA',
        quantidade: l.qtd,
        custoUnitario: num(p.precoCusto),
        usuarioId: estoquista.id,
        lote: { codigo: l.codigo, validade: l.validade },
      });
    }
  }, TX_OPCOES);

  // ---------- Produção de hoje (padaria da Matriz) ----------
  const ORDENS: { produto: string; planejada: number; inicio: [number, number]; estado: 'CONCLUIDA' | 'EM_PRODUCAO' | 'PLANEJADA'; produzida?: number }[] = [
    { produto: 'Pão francês', planejada: 10, inicio: [5, 30], estado: 'CONCLUIDA', produzida: 9.8 },
    { produto: 'Pão de queijo', planejada: 60, inicio: [6, 0], estado: 'CONCLUIDA', produzida: 58 },
    { produto: 'Sonho', planejada: 30, inicio: [9, 0], estado: 'EM_PRODUCAO' },
    { produto: 'Bolo de chocolate', planejada: 2, inicio: [14, 0], estado: 'PLANEJADA' },
    { produto: 'Baguete', planejada: 10, inicio: [17, 0], estado: 'PLANEJADA' },
  ];
  await prisma.$transaction(async (tx) => {
    for (const o of ORDENS) {
      const p = produto(o.produto);
      const receita = await tx.receita.findUniqueOrThrow({ where: { produtoId: p.id }, include: { itens: { include: { insumo: true } } } });
      const agendado = o.estado === 'PLANEJADA' ? horaNoDia(hoje, o.inicio[0], o.inicio[1]) : hojeAs(o.inicio[0], o.inicio[1]);
      const ordem = await tx.ordemProducao.create({
        data: { lojaId: matriz.id, receitaId: receita.id, produtoId: p.id, quantidadePlanejada: o.planejada, agendadoPara: agendado, status: 'PLANEJADA', usuarioId: padeiro.id },
      });
      if (o.estado === 'PLANEJADA') continue;
      if (o.estado === 'EM_PRODUCAO') {
        await tx.ordemProducao.update({ where: { id: ordem.id }, data: { status: 'EM_PRODUCAO', iniciadoEm: agendado } });
        continue;
      }
      const fator = o.planejada / num(receita.rendimento);
      let custo = 0;
      for (const item of receita.itens) {
        const quantidade = arred3(num(item.quantidade) * fator);
        const custoUnitario = num(item.insumo.precoCusto);
        custo += quantidade * custoUnitario;
        await movimentarEstoque(tx, {
          produtoId: item.insumoId,
          lojaId: matriz.id,
          tipo: 'CONSUMO_PRODUCAO',
          quantidade: -quantidade,
          custoUnitario,
          referencia: `producao:${ordem.id}`,
          usuarioId: padeiro.id,
        });
      }
      const produzida = o.produzida ?? o.planejada;
      const concluido = hojeAs(o.inicio[0] + 1, 0);
      await movimentarEstoque(tx, {
        produtoId: p.id,
        lojaId: matriz.id,
        tipo: 'PRODUCAO',
        quantidade: produzida,
        custoUnitario: Math.round((custo / produzida) * 10000) / 10000,
        referencia: `producao:${ordem.id}`,
        usuarioId: padeiro.id,
        lote: { codigo: `OP-${ordem.id}`, validade: somarDias(concluido, p.validadeDias ?? 1), fabricacao: concluido, ordemProducaoId: ordem.id },
      });
      await tx.ordemProducao.update({
        where: { id: ordem.id },
        data: { status: 'CONCLUIDA', iniciadoEm: agendado, concluidoEm: concluido, quantidadeProduzida: produzida, perda: arred3(o.planejada - produzida), custoTotal: arred2(custo) },
      });
    }
  }, TX_OPCOES);

  // ---------- Força de vendas: quatro pedidos de clientes atacado da carteira do vendedor ----------
  const STATUS_FV: StatusPedidoVenda[] = ['PENDENTE', 'APROVADO', 'APROVADO', 'FATURADO'];
  const itensFv: [string, number][] = [['Refrigerante cola 2 L', 24], ['Arroz tipo 1 5 kg', 10], ['Papel higiênico 4 rolos', 15]];
  await prisma.$transaction(async (tx) => {
    for (const [i, status] of STATUS_FV.entries()) {
      const cliente = atacado[i];
      const itens = itensFv.map(([nome, quantidade]) => {
        const p = produto(nome);
        const qtd = quantidade + i * 2;
        const precoTabela = num(p.precoVenda);
        const precoNegociado = p.precoAtacado !== null ? num(p.precoAtacado) : arred2(precoTabela * 0.92);
        return { produtoId: p.id, quantidade: qtd, precoTabela, precoNegociado, total: arred2(precoNegociado * qtd) };
      });
      const subtotalTabela = arred2(itens.reduce((s, it) => s + it.precoTabela * it.quantidade, 0));
      const total = arred2(itens.reduce((s, it) => s + it.total, 0));
      const flex = arred2(total - subtotalTabela);
      const pedido = await tx.pedidoVenda.create({
        data: {
          clienteId: cliente.id,
          vendedorId: vendedor.id,
          lojaId: matriz.id,
          origem: 'FORCA_VENDAS',
          status,
          subtotalTabela,
          total,
          flex,
          condicaoPagamento: '28 dias',
          formaPagamento: 'BOLETO',
          previsaoEntrega: somarDias(hoje, 2),
          observacoes: 'Pedido da força de vendas (demonstração)',
          itens: { create: itens.map((it) => ({ produtoId: it.produtoId, quantidade: it.quantidade, precoTabela: it.precoTabela, precoNegociado: it.precoNegociado, total: it.total })) },
        },
      });
      if (status === 'FATURADO') {
        const r = await registrarVenda(tx, {
          lojaId: matriz.id,
          usuarioId: operador.id,
          vendedorId: vendedor.id,
          clienteId: cliente.id,
          origem: 'FORCA_VENDAS',
          itens: itens.map((it) => ({ produtoId: it.produtoId, quantidade: it.quantidade, precoUnitario: it.precoNegociado })),
          pagamentos: [{ forma: 'BOLETO', valor: total, parcelas: 2 }],
          emitirNota: true,
          modeloNota: 'NFE',
        });
        await tx.pedidoVenda.update({ where: { id: pedido.id }, data: { vendaId: r.vendaId, faturadoEm: agora } });
        await tx.usuario.update({ where: { id: vendedor.id }, data: { saldoFlex: { increment: flex } } });
        ctx.contagem.vendas += 1;
      }
    }
  }, TX_OPCOES);

  // ---------- Ajustes finais: sem saldo negativo e alguns produtos abaixo do mínimo na Matriz ----------
  await prisma.$transaction(async (tx) => {
    const negativos = await tx.estoqueLoja.findMany({ where: { quantidade: { lt: 0 } } });
    for (const e of negativos) {
      await movimentarEstoque(tx, { produtoId: e.produtoId, lojaId: e.lojaId, tipo: 'AJUSTE', quantidade: arred3(-num(e.quantidade) + 30), motivo: 'Ajuste de demonstração', usuarioId: estoquista.id });
    }
    for (const nome of ['Queijo muçarela', 'Requeijão cremoso 200 g', 'Refrigerante cola 2 L', 'Sabão em pó 1 kg', 'Papel higiênico 4 rolos', 'Ovos']) {
      const p = produto(nome);
      const saldo = await tx.estoqueLoja.findUnique({ where: { produtoId_lojaId: { produtoId: p.id, lojaId: matriz.id } } });
      await tx.produto.update({ where: { id: p.id }, data: { estoqueMinimo: arred3(num(saldo?.quantidade) + 30) } });
    }
  }, TX_OPCOES);

  // ---------- Resumo ----------
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(
    `Demonstração: ${produtos.length} produtos, ${ctx.contagem.vendas} vendas (${DIAS_HISTORICO} dias), ${varejo.length + atacado.length} clientes, ` +
      `${ctx.contagem.entregas} entregas de hoje, 1 rota, 4 pedidos da força de vendas, 4 pedidos de compra, 1 cotação e 1 transferência. Tempo: ${segundos}s.`,
  );
  console.log('==== CONTAS DE DEMONSTRAÇÃO (senha demo1234) ====');
  for (const [perfil, email] of [
    ['OPERADOR', 'operador@mercado.local'],
    ['ESTOQUISTA', 'estoque@mercado.local'],
    ['PADEIRO', 'padeiro@mercado.local'],
    ['COMPRADOR', 'compras@mercado.local'],
    ['MOTORISTA', 'motorista@mercado.local'],
    ['VENDEDOR', 'vendedor@mercado.local'],
    ['CONTADOR', 'contador@mercado.local'],
  ]) {
    console.log(`${perfil}: ${email}`);
  }
  console.log('=================================================');
}
