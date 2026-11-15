// Dados iniciais de demonstração (fictícios). Só rodam com SEED_DEMO=true, em banco novo, depois do seed padrão.
// Cria apenas o cadastro básico: 3 lojas (com endereço), a equipe de cada perfil, categorias, o catálogo de
// produtos (com fotos em client/public/produtos) e as receitas da padaria. Sem movimento: estoque zerado,
// sem vendas, clientes, fornecedores, compras, entregas ou financeiro. Nenhum dado real.

import type { Perfil, PrismaClient, Unidade } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { digitoVerificadorEan, sugerirPrecoVenda } from '../src/lib/precos';
import { arred3 } from '../src/lib/numeros';

const SENHA = 'demo1234';

// ---------- Sorteio com semente fixa: os preços saem iguais em todo banco novo ----------

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

// ---------- Carga ----------

export async function carregarDemonstracao(prisma: PrismaClient): Promise<void> {
  const senhaHash = bcrypt.hashSync(SENHA, 10);

  // Lojas: a Matriz vem do seed padrão; as outras duas são criadas aqui.
  const matrizBase = await prisma.loja.findFirstOrThrow({ where: { nome: 'Loja Matriz' } });
  const matriz = await prisma.loja.update({
    where: { id: matrizBase.id },
    data: {
      cnpj: '10000000000101', telefone: '(11) 3000-0001', cep: '01001-000', endereco: 'Rua das Flores', numero: '100', bairro: 'Sé',
      cidade: 'São Paulo', uf: 'SP', horario: 'Seg a sáb 7h–21h · dom 7h–13h', latitude: -23.5505, longitude: -46.6333,
    },
  });
  await prisma.loja.create({
    data: {
      nome: 'Loja Bairro Jardim', tipo: 'LOJA', cnpj: '10000000000202', telefone: '(11) 3000-0002', cep: '01415-000', endereco: 'Rua Bela Vista',
      numero: '350', bairro: 'Jardim Paulista', cidade: 'São Paulo', uf: 'SP', horario: 'Seg a sáb 7h–22h', latitude: -23.5614, longitude: -46.6559,
    },
  });
  const cd = await prisma.loja.create({
    data: {
      nome: 'Centro de Distribuição', tipo: 'CENTRO_DISTRIBUICAO', cnpj: '10000000000303', telefone: '(11) 3000-0003', cep: '03063-000',
      endereco: 'Avenida dos Armazéns', numero: '1200', bairro: 'Belém', cidade: 'São Paulo', uf: 'SP', horario: 'Seg a sex 5h–18h',
      latitude: -23.533, longitude: -46.605,
    },
  });

  // Equipe: uma conta de cada perfil (senha demo1234).
  const equipe: [string, string, Perfil, number | null, { cnh?: string; comissaoPercentual?: number; saldoFlex?: number }][] = [
    ['Bruna Teixeira', 'operador@mercado.local', 'OPERADOR', matriz.id, {}],
    ['Eduardo Ramos', 'estoque@mercado.local', 'ESTOQUISTA', cd.id, {}],
    ['Osvaldo Nunes', 'padeiro@mercado.local', 'PADEIRO', matriz.id, {}],
    ['Renata Barbosa', 'compras@mercado.local', 'COMPRADOR', cd.id, {}],
    ['Jorge Almeida', 'motorista@mercado.local', 'MOTORISTA', cd.id, { cnh: '01234567890' }],
    ['Tiago Moreira', 'vendedor@mercado.local', 'VENDEDOR', matriz.id, { comissaoPercentual: 3, saldoFlex: 200 }],
    ['Helena Prado', 'contador@mercado.local', 'CONTADOR', null, {}],
  ];
  for (const [nome, email, perfil, lojaId, extra] of equipe) {
    await prisma.usuario.create({ data: { nome, email, perfil, lojaId, senhaHash, ativo: true, ...extra } });
  }

  // Categorias
  const categorias = new Map<string, number>();
  for (const [ordem, [nome, setor]] of CATEGORIAS.entries()) {
    const c = await prisma.categoria.create({ data: { nome, setor, ordem } });
    categorias.set(nome, c.id);
  }

  // Produtos (EAN de 13 dígitos começando com 789, com dígito verificador). Estoque começa zerado.
  const porNome = new Map<string, number>();
  for (const [i, d] of PRODUTOS.entries()) {
    const base = `789${String(i + 1).padStart(9, '0')}`;
    const margem = d.margem ?? aleatorio(25, 45);
    const codigo = `PR${String(i + 1).padStart(4, '0')}`;
    const p = await prisma.produto.create({
      data: {
        codigo,
        ean: base + digitoVerificadorEan(base),
        nome: d.nome,
        categoriaId: categorias.get(d.cat)!,
        unidade: d.un,
        pesavel: d.pesavel ?? false,
        codigoBalanca: d.plu ?? null,
        precoCusto: d.custo,
        precoVenda: sugerirPrecoVenda(d.custo, margem, true),
        precoAtacado: d.atacado ? d.atacado[0] : null,
        qtdAtacado: d.atacado ? d.atacado[1] : null,
        estoqueMinimo: d.insumo ? 20 : 10,
        pesoBrutoKg: d.pesavel ? 1 : arred3(aleatorio(0.1, 2.5)),
        produzido: d.produzido ?? false,
        insumo: d.insumo ?? false,
        validadeDias: d.validade ?? null,
        controlaLote: (d.lote ?? false) || (d.produzido ?? false),
        ativo: true,
        // Foto do catálogo de demonstração (client/public/produtos/PR0001.jpg ...).
        foto: `/produtos/${codigo}.jpg`,
      },
    });
    porNome.set(d.nome, p.id);
  }
  const produto = (nome: string): number => {
    const id = porNome.get(nome);
    if (id === undefined) throw new Error(`Produto de demonstração não encontrado: ${nome}`);
    return id;
  };

  // Receitas da padaria (ficha técnica: insumos de cada produto produzido)
  for (const r of RECEITAS) {
    await prisma.receita.create({
      data: {
        produtoId: produto(r.produto),
        rendimento: r.rendimento,
        tempoPreparoMin: r.preparo,
        tempoFornoMin: r.forno,
        temperaturaForno: r.temp,
        modoPreparo: 'Misturar, sovar, descansar, modelar e assar.',
        itens: { create: r.itens.map(([insumo, quantidade]) => ({ insumoId: produto(insumo), quantidade })) },
      },
    });
  }

  console.log(`Demonstração: 3 lojas, ${equipe.length} contas, ${CATEGORIAS.length} categorias, ${PRODUTOS.length} produtos e ${RECEITAS.length} receitas (estoque zerado).`);
  console.log('==== CONTAS DE DEMONSTRAÇÃO (senha demo1234) ====');
  for (const [, email, perfil] of equipe) console.log(`${perfil}: ${email}`);
  console.log('=================================================');
}
