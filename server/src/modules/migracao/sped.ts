// Leitor de SPED Fiscal (EFD ICMS/IPI e EFD Contribuições) e de Sintegra.
// Transforma o arquivo em registros normalizados para a migração (fornecedores, clientes, produtos, estoque).
import type { Unidade } from '@prisma/client';
import { HttpError } from '../../lib/erros';
import { ErroConversao, cest, cpfCnpj, ean, formatarDocumento, ncm, numero, texto, ufDoIbge, unidade } from './normalizar';
import type { LeituraLote, RegCliente, RegEstoque, RegFornecedor, RegProduto, RegistroLido } from './tipos';

const LIMITE_LINHAS = 300000;
const AVISO_PRECO_SPED =
  'O SPED não traz preço de venda: os produtos novos entram com preço 0. Complete os preços pela planilha de produtos.';
const AVISO_SINTEGRA = 'O Sintegra só traz o cadastro básico dos produtos (sem preço, EAN e estoque).';
const TIPOS_FORA_DO_SISTEMA = ['07', '08', '09', '99'];
const TIPOS_INSUMO = ['01', '02', '03', '10'];
const TIPOS_PRODUZIDO = ['04', '05'];

interface LinhaArquivo {
  n: number; // número da linha no arquivo, começando em 1
  texto: string;
}

interface Linha {
  n: number;
  reg: string; // REG (c[1])
  c: string[]; // campos separados por "|" (c[0] vazio, c[1] = REG)
}

interface BlocoInventario {
  dtInv: string; // DT_INV do H005 (ddmmaaaa)
  itens: Linha[]; // H010 do bloco
}

// Decodifica: UTF-8; se tiver caractere inválido, ISO-8859-1. Remove BOM.
function decodificar(arquivo: Buffer): string {
  let conteudo = arquivo.toString('utf8');
  if (conteudo.includes('�')) conteudo = arquivo.toString('latin1');
  if (conteudo.charCodeAt(0) === 0xfeff) conteudo = conteudo.slice(1);
  if (conteudo.startsWith('ï»¿')) conteudo = conteudo.slice(3);
  return conteudo;
}

// Linhas não vazias, com o número original da linha. Limite de 300.000 linhas.
function linhasDo(arquivo: Buffer): LinhaArquivo[] {
  const partes = decodificar(arquivo).split(/\r?\n/);
  if (partes.length > LIMITE_LINHAS) throw new HttpError(400, 'Arquivo grande demais');
  const linhas: LinhaArquivo[] = [];
  partes.forEach((t, i) => {
    if (t.trim() !== '') linhas.push({ n: i + 1, texto: t });
  });
  return linhas;
}

function primeiraLinhaNaoVazia(arquivo: Buffer): string | undefined {
  return decodificar(arquivo)
    .split(/\r?\n/)
    .find((l) => l.trim() !== '');
}

// Campo do SPED já aparado ('' se não existir).
function v(c: string[], i: number): string {
  return (c[i] ?? '').trim();
}

// Executa a conversão; erro de conversão vai para a lista de erros do item.
function tentar<T>(erros: string[], fn: () => T): T | undefined {
  try {
    return fn();
  } catch (erro) {
    if (erro instanceof ErroConversao) {
      erros.push(erro.message);
      return undefined;
    }
    throw erro;
  }
}

// 'ddmmaaaa' -> 'dd/mm/aaaa'
function dataDDMMAAAA(bruta: string): string | undefined {
  if (!/^\d{8}$/.test(bruta)) return undefined;
  return `${bruta.slice(0, 2)}/${bruta.slice(2, 4)}/${bruta.slice(4, 8)}`;
}

// 'aaaammdd' -> 'dd/mm/aaaa'
function dataAAAAMMDD(bruta: string): string | undefined {
  if (!/^\d{8}$/.test(bruta)) return undefined;
  return `${bruta.slice(6, 8)}/${bruta.slice(4, 6)}/${bruta.slice(0, 4)}`;
}

// Chave de ordenação 'aaaammdd' a partir de 'ddmmaaaa' ('' se inválida).
function chaveDataSped(bruta: string): string {
  if (!/^\d{8}$/.test(bruta)) return '';
  return bruta.slice(4, 8) + bruta.slice(2, 4) + bruta.slice(0, 2);
}

// Unidade: tenta a descrição (0190) e depois o código; se nenhuma for reconhecida, UN com aviso.
function resolverUnidade(codigo: string, descricao: string | undefined, avisos: string[]): Unidade {
  for (const candidato of [descricao, codigo]) {
    if (!candidato) continue;
    const resultado = unidade(candidato);
    if (resultado?.reconhecida) return resultado.valor;
  }
  if (codigo) avisos.push(`Unidade "${codigo}" não reconhecida; usada UN`);
  return 'UN';
}

export function ehSped(arquivo: Buffer): boolean {
  return primeiraLinhaNaoVazia(arquivo)?.trimStart().startsWith('|0000|') ?? false;
}

export function ehSintegra(arquivo: Buffer): boolean {
  const primeira = primeiraLinhaNaoVazia(arquivo);
  return primeira !== undefined && primeira.startsWith('10') && primeira.length === 126;
}

export function lerSped(arquivo: Buffer): LeituraLote {
  const linhas: Linha[] = linhasDo(arquivo).map((l) => {
    const c = l.texto.split('|');
    return { n: l.n, reg: v(c, 1), c };
  });

  // ---------- Cabeçalho (0000) ----------
  const reg0000 = linhas.find((l) => l.reg === '0000');
  if (!reg0000) throw new HttpError(400, 'Este arquivo não parece ser um SPED Fiscal (falta o registro 0000)');
  const c0 = reg0000.c;
  // EFD Contribuições: c[7] tem 8 dígitos (DT_FIN) e c[9] tem 14 (CNPJ). Senão, EFD ICMS/IPI.
  const contribuicoes = /^\d{8}$/.test(v(c0, 7)) && /^\d{14}$/.test(v(c0, 9));
  const dtIni = contribuicoes ? v(c0, 6) : v(c0, 4);
  const dtFin = contribuicoes ? v(c0, 7) : v(c0, 5);
  const nomeEmpresa = contribuicoes ? v(c0, 8) : v(c0, 6);
  const cnpjEmpresa = contribuicoes ? v(c0, 9) : v(c0, 7);

  let descricao = 'SPED Fiscal';
  const nomeTexto = texto(nomeEmpresa, 120);
  if (nomeTexto) descricao += ` de ${nomeTexto}`;
  if (cnpjEmpresa) descricao += ` (CNPJ ${formatarDocumento(cnpjEmpresa)})`;
  const di = dataDDMMAAAA(dtIni);
  const df = dataDDMMAAAA(dtFin);
  if (di && df) descricao += `, ${di} a ${df}`;

  // ---------- Coleta ----------
  const participantes = new Map<string, Linha>(); // 0150: COD_PART -> último
  const indicadores = new Map<string, { forn: boolean; cli: boolean }>(); // C100
  const unidades = new Map<string, string>(); // 0190: UNID -> DESCR
  const itensBrutos = new Map<string, Linha>(); // 0200: COD_ITEM -> último
  const blocos: BlocoInventario[] = [];
  let blocoAtual: BlocoInventario | null = null;

  for (const l of linhas) {
    switch (l.reg) {
      case '0150': {
        const cod = v(l.c, 2);
        if (cod) participantes.set(cod, l);
        break;
      }
      case '0190': {
        const unid = v(l.c, 2);
        if (unid) unidades.set(unid, v(l.c, 3));
        break;
      }
      case '0200': {
        const cod = v(l.c, 2);
        if (cod) itensBrutos.set(cod, l);
        break;
      }
      case 'C100': {
        const cod = v(l.c, 4);
        const ind = v(l.c, 2);
        if (!cod) break;
        const atual = indicadores.get(cod) ?? { forn: false, cli: false };
        if (ind === '0') atual.forn = true;
        if (ind === '1') atual.cli = true;
        indicadores.set(cod, atual);
        break;
      }
      case 'H005': {
        blocoAtual = { dtInv: v(l.c, 2), itens: [] };
        blocos.push(blocoAtual);
        break;
      }
      case 'H010': {
        if (blocoAtual) blocoAtual.itens.push(l);
        break;
      }
      case 'H990': {
        blocoAtual = null;
        break;
      }
    }
  }

  // Inventário escolhido: o de maior DT_INV (em empate, o último do arquivo).
  let inventario: BlocoInventario | undefined;
  for (const bloco of blocos) {
    if (!inventario || chaveDataSped(bloco.dtInv) >= chaveDataSped(inventario.dtInv)) inventario = bloco;
  }

  // Próprio em poder da empresa (IND_PROP = 0): base do estoque e do preço de custo (por COD_ITEM).
  const inventarioProprio = new Map<string, Linha>();
  let deTerceiros = 0;
  for (const l of inventario?.itens ?? []) {
    if (v(l.c, 7) === '0') {
      const cod = v(l.c, 2);
      if (cod) inventarioProprio.set(cod, l);
    } else {
      deTerceiros++;
    }
  }

  // ---------- Participantes (fornecedores e clientes) ----------
  const fornecedores: RegistroLido<'fornecedores'>[] = [];
  const clientes: RegistroLido<'clientes'>[] = [];
  let estrangeiros = 0;

  for (const [cod, l] of participantes) {
    const c = l.c;
    const codPais = v(c, 4);
    if (codPais && codPais !== '1058') {
      estrangeiros++;
      continue;
    }
    const cnpj = v(c, 5);
    const cpf = v(c, 6);
    const ind = indicadores.get(cod);
    let comoForn: boolean;
    let comoCli: boolean;
    if (ind && (ind.forn || ind.cli)) {
      comoForn = ind.forn;
      comoCli = ind.cli;
    } else {
      // Sem nota: com CNPJ vira fornecedor; só CPF vira cliente.
      comoForn = cnpj !== '';
      comoCli = !comoForn && cpf !== '';
    }

    if (comoForn) fornecedores.push(montarFornecedor(l, cod));
    if (comoCli) clientes.push(montarCliente(l, cod));
  }

  // ---------- Produtos (0200) ----------
  const produtos: RegistroLido<'produtos'>[] = [];
  let deixadosDeFora = 0;

  for (const [cod, l] of itensBrutos) {
    const c = l.c;
    const tipo = v(c, 7);
    if (TIPOS_FORA_DO_SISTEMA.includes(tipo)) {
      deixadosDeFora++;
      continue;
    }
    const erros: string[] = [];
    const avisos: string[] = [];

    const nome = texto(v(c, 3), 120);
    if (!nome) erros.push('Produto sem descrição');

    // EAN inválido não é erro: o item entra sem EAN, com aviso.
    const codBarra = v(c, 4);
    let eanLido: string | undefined;
    if (codBarra) {
      try {
        eanLido = ean(codBarra);
      } catch (erro) {
        if (!(erro instanceof ErroConversao)) throw erro;
        avisos.push(`EAN "${codBarra}" inválido foi ignorado`);
      }
    }

    const unidadeLida = resolverUnidade(v(c, 6), unidades.get(v(c, 6)), avisos);
    const ncmLido = tentar(erros, () => ncm(v(c, 8)));
    const cestLido = tentar(erros, () => cest(v(c, 13)));

    const linhaCusto = inventarioProprio.get(cod);
    const precoCusto = linhaCusto ? tentar(erros, () => numero(v(linhaCusto.c, 5))) : undefined;

    const registro: RegProduto = {
      codigo: texto(cod, 60),
      ean: eanLido,
      nome: nome ?? '',
      unidade: unidadeLida,
      ncm: ncmLido,
      cest: cestLido,
      insumo: TIPOS_INSUMO.includes(tipo),
      produzido: TIPOS_PRODUZIDO.includes(tipo),
      precoCusto,
    };
    produtos.push({ origem: `0200 linha ${l.n}`, registro, erros, avisos });
  }

  // ---------- Estoque (H010) ----------
  const estoque: RegistroLido<'estoque'>[] = [];
  for (const l of inventarioProprio.values()) {
    const erros: string[] = [];
    const produto = texto(v(l.c, 2), 60);
    if (!produto) erros.push('Item do inventário sem código');
    const quantidadeLida = tentar(erros, () => numero(v(l.c, 4)));
    if (quantidadeLida === undefined && erros.length === 0) erros.push('Quantidade vazia');
    const custoUnitario = tentar(erros, () => numero(v(l.c, 5)));
    const registro: RegEstoque = {
      produto,
      quantidade: quantidadeLida ?? 0,
      custoUnitario,
    };
    estoque.push({ origem: `H010 linha ${l.n}`, registro, erros, avisos: [] });
  }

  // ---------- Avisos gerais ----------
  const avisos: string[] = [AVISO_PRECO_SPED];
  if (deixadosDeFora > 0) {
    avisos.push(`${deixadosDeFora} itens de uso e consumo, imobilizado, serviço ou outros foram deixados de fora`);
  }
  if (estrangeiros > 0) {
    avisos.push(`${estrangeiros} participantes de outros países foram deixados de fora`);
  }
  if (!inventario) {
    avisos.push('O arquivo não tem inventário (bloco H); o estoque não será importado');
  } else {
    const dtInv = dataDDMMAAAA(inventario.dtInv);
    avisos.push(dtInv ? `Inventário de ${dtInv} (registro H005)` : 'Inventário (registro H005)');
    if (deTerceiros > 0) {
      avisos.push(
        `${deTerceiros} itens do inventário em poder de terceiros ou de terceiros em poder da empresa foram deixados de fora`
      );
    }
  }

  return {
    fonte: 'sped',
    descricao,
    avisos,
    registros: { fornecedores, clientes, produtos, estoque },
  };
}

// Participante (0150) como fornecedor.
function montarFornecedor(l: Linha, cod: string): RegistroLido<'fornecedores'> {
  const c = l.c;
  const erros: string[] = [];
  const cnpj = v(c, 5);
  const cpf = v(c, 6);
  const documento = cnpj || cpf ? tentar(erros, () => cpfCnpj(cnpj || cpf)) : undefined;
  const nome = texto(v(c, 3), 120);
  if (!nome) erros.push('Participante sem nome');

  const registro: RegFornecedor = {
    codigoAntigo: texto(cod, 60),
    nome: nome ?? '',
    razaoSocial: documento && documento.length === 14 ? nome : undefined,
    cnpj: documento,
    inscricaoEstadual: texto(v(c, 7), 20),
    uf: ufDoIbge(v(c, 8)),
    endereco: texto([v(c, 10), v(c, 11), v(c, 12), v(c, 13)].filter(Boolean).join(', '), 255),
  };
  return { origem: `0150 linha ${l.n}`, registro, erros, avisos: [] };
}

// Participante (0150) como cliente.
function montarCliente(l: Linha, cod: string): RegistroLido<'clientes'> {
  const c = l.c;
  const erros: string[] = [];
  const cnpj = v(c, 5);
  const cpf = v(c, 6);
  const documento = cnpj || cpf ? tentar(erros, () => cpfCnpj(cnpj || cpf)) : undefined;
  const nome = texto(v(c, 3), 120);
  if (!nome) erros.push('Participante sem nome');

  const registro: RegCliente = {
    codigoAntigo: texto(cod, 60),
    nome: nome ?? '',
    razaoSocial: documento && documento.length === 14 ? nome : undefined,
    cpfCnpj: documento,
    inscricaoEstadual: texto(v(c, 7), 20),
    uf: ufDoIbge(v(c, 8)),
    endereco: texto([v(c, 10), v(c, 12)].filter(Boolean).join(' - '), 255),
    numero: texto(v(c, 11), 20),
    bairro: texto(v(c, 13), 60),
  };
  return { origem: `0150 linha ${l.n}`, registro, erros, avisos: [] };
}

export function lerSintegra(arquivo: Buffer): LeituraLote {
  const linhas = linhasDo(arquivo);

  // ---------- Registro 10 (cabeçalho) ----------
  const r10 = linhas.find((l) => l.texto.startsWith('10'));
  if (!r10) throw new HttpError(400, 'Este arquivo não parece ser um Sintegra (falta o registro 10)');
  const cab = r10.texto;
  const cnpj = texto(cab.slice(2, 16), 20);
  const razao = texto(cab.slice(30, 65), 120);
  const di = dataAAAAMMDD(cab.slice(107, 115).trim());
  const df = dataAAAAMMDD(cab.slice(115, 123).trim());

  let descricao = 'Sintegra';
  if (razao) descricao += ` de ${razao}`;
  if (cnpj) descricao += ` (CNPJ ${formatarDocumento(cnpj)})`;
  if (di && df) descricao += `, ${di} a ${df}`;

  // ---------- Registro 75 (produtos) ----------
  const produtosPorCodigo = new Map<string, RegistroLido<'produtos'>>();
  for (const l of linhas) {
    if (!l.texto.startsWith('75')) continue;
    const t = l.texto;
    const erros: string[] = [];
    const avisos: string[] = [];

    // Código sem espaços; sem zeros à esquerda só se for só dígitos e tiver mais de 6 caracteres.
    let codigo: string | undefined = t.slice(18, 32).replace(/\s/g, '') || undefined;
    if (codigo && /^\d+$/.test(codigo) && codigo.length > 6) {
      codigo = codigo.replace(/^0+(?=\d)/, '');
    }

    const nome = texto(t.slice(40, 93), 120);
    if (!nome) erros.push('Produto sem descrição');
    const ncmLido = tentar(erros, () => ncm(t.slice(32, 40)));
    const unidadeLida = resolverUnidade(t.slice(93, 99).trim(), undefined, avisos);

    const registro: RegProduto = {
      codigo,
      nome: nome ?? '',
      ncm: ncmLido,
      unidade: unidadeLida,
    };
    // Dedup por código: mantém o último.
    produtosPorCodigo.set(codigo ?? `linha ${l.n}`, { origem: `75 linha ${l.n}`, registro, erros, avisos });
  }

  return {
    fonte: 'sintegra',
    descricao,
    avisos: [AVISO_SINTEGRA],
    registros: { produtos: Array.from(produtosPorCodigo.values()) },
  };
}
