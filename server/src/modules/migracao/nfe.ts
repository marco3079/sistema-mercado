// Leitor de XMLs de NF-e para a migração (leitura por expressões regulares, sem bibliotecas).
// Nota emitida pela loja (venda): cliente, produtos com o código da loja e contas a receber.
// Nota de compra (loja é o destinatário): fornecedor, produtos sem código (vínculo com o fornecedor) e contas a pagar.

import { HttpError } from '../../lib/erros';
import type { ArquivoEnviado } from './arquivos';
import {
  ErroConversao,
  cep,
  cest,
  cfop,
  cpfCnpj,
  data,
  ean,
  email,
  ncm,
  numero,
  telefone,
  texto,
  uf,
  unidade,
} from './normalizar';
import type { LeituraLote, RegCliente, RegConta, RegFornecedor, RegProduto, RegistroLido } from './tipos';

type Unidade = NonNullable<RegProduto['unidade']>;

interface NotaXml {
  origem: string; // "<arquivo> (NF <nNF>)"
  chave: string | null; // 44 dígitos (atributo Id de infNFe)
  nNF: string | null;
  dhMs: number; // data de emissão em ms (0 se não tiver), para escolher a nota mais nova
  emit: string; // bloco <emit>
  dest: string; // bloco <dest> ('' se não existir)
  dets: string[]; // blocos <det>
  dups: string[]; // blocos <dup> (dentro de <cobr>)
  docEmit: string; // CNPJ ou CPF do emitente, como veio no XML
  docDest: string; // CNPJ ou CPF do destinatário, como veio no XML
}

interface Acumulador {
  hoje: string; // AAAA-MM-DD, data local
  fornecedores: Map<string, RegistroLido<'fornecedores'>>;
  clientes: Map<string, RegistroLido<'clientes'>>;
  produtos: Map<string, RegistroLido<'produtos'>>;
  contas: Map<string, RegistroLido<'contas'>>;
  vencidas: number;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_, e: string) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      return ENTIDADES[e] ?? '';
    })
    .trim();
}

// Conteúdo da primeira tag com este nome dentro do bloco (com ou sem prefixo de namespace).
function campo(xml: string, nome: string): string | null {
  const achado = new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return achado ? decodificar(achado[1]) : null;
}

// Valor de um campo, ou '' se a tag não existir.
function v(xml: string, nome: string): string {
  return campo(xml, nome) ?? '';
}

// Bloco inteiro de uma tag (ex.: <emit>...</emit>); vazio se não existir.
function bloco(xml: string, nome: string): string {
  const achado = new RegExp(`<(?:\\w+:)?${nome}\\b[\\s\\S]*?</(?:\\w+:)?${nome}>`).exec(xml);
  return achado ? achado[0] : '';
}

// Documento só com letras e dígitos, em maiúsculas (para comparar CNPJ da loja com o do XML).
function chaveDoc(doc: string): string {
  return doc.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// Roda uma conversão: erro de conversão vai para a lista de erros e devolve undefined.
function tentar<T>(erros: string[], fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroConversao) {
      erros.push(e.message);
      return undefined;
    }
    throw e;
  }
}

// Como tentar, mas campo obrigatório vazio também vira erro.
function obrigatorio<T>(erros: string[], rotulo: string, fn: () => T | undefined): T | undefined {
  const antes = erros.length;
  const resultado = tentar(erros, fn);
  if (resultado === undefined && erros.length === antes) erros.push(`${rotulo} não informado`);
  return resultado;
}

// EAN do item: cEAN e, se não valer, cEANTrib. EAN inválido vira aviso (não é erro).
function eanDoItem(prod: string, avisos: string[]): string | undefined {
  let invalido = false;
  for (const bruto of [v(prod, 'cEAN'), v(prod, 'cEANTrib')]) {
    if (!bruto) continue;
    try {
      const valido = ean(bruto);
      if (valido) return valido;
    } catch (e) {
      if (e instanceof ErroConversao) {
        invalido = true;
        continue;
      }
      throw e;
    }
  }
  if (invalido) avisos.push('EAN inválido: importado sem EAN');
  return undefined;
}

// Unidade do item; não reconhecida (ou vazia) vira UN com aviso.
function unidadeDoItem(uCom: string, avisos: string[]): Unidade {
  const lida = uCom ? unidade(uCom) : undefined;
  if (lida?.reconhecida) return lida.valor;
  avisos.push(uCom ? `unidade "${uCom}" não reconhecida: usada UN` : 'unidade não informada: usada UN');
  return 'UN';
}

// Endereço numa linha: "<xLgr>, <nro> - <xCpl> - <xBairro> - CEP <CEP>" (sem trechos vazios).
function enderecoDaNota(endereco: string): string {
  const trechos: string[] = [];
  const rua = [v(endereco, 'xLgr'), v(endereco, 'nro')].filter((p) => p !== '').join(', ');
  if (rua) trechos.push(rua);
  if (v(endereco, 'xCpl')) trechos.push(v(endereco, 'xCpl'));
  if (v(endereco, 'xBairro')) trechos.push(v(endereco, 'xBairro'));
  if (v(endereco, 'CEP')) trechos.push(`CEP ${v(endereco, 'CEP')}`);
  return trechos.join(' - ');
}

// Lê uma NF-e. Devolve null quando o arquivo não tem infNFe (evento, cancelamento...).
function lerNotaXml(conteudo: string, arquivo: string): NotaXml | null {
  const xml = conteudo.replace(/^﻿/, '');
  if (!/<(?:\w+:)?infNFe\b/.test(xml)) return null;

  const chave = /Id="NFe(\d{44})"/.exec(xml)?.[1] ?? null;
  const ide = bloco(xml, 'ide');
  const nNF = campo(ide, 'nNF');
  const dhEmi = campo(ide, 'dhEmi') ?? campo(ide, 'dEmi');
  const dhMs = dhEmi ? Date.parse(dhEmi) : NaN;
  const emit = bloco(xml, 'emit');
  const dest = bloco(xml, 'dest');

  return {
    origem: `${arquivo} (NF ${nNF ?? '?'})`,
    chave,
    nNF,
    dhMs: Number.isNaN(dhMs) ? 0 : dhMs,
    emit,
    dest,
    dets: [...xml.matchAll(/<(?:\w+:)?det\b[\s\S]*?<\/(?:\w+:)?det>/g)].map((m) => m[0]),
    dups: [...bloco(xml, 'cobr').matchAll(/<(?:\w+:)?dup\b[\s\S]*?<\/(?:\w+:)?dup>/g)].map((m) => m[0]),
    docEmit: v(emit, 'CNPJ') || v(emit, 'CPF'),
    docDest: v(dest, 'CNPJ') || v(dest, 'CPF'),
  };
}

function hojeIso(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Duplicatas de uma nota: só as que vencem hoje ou depois (as anteriores são contadas e saem).
function lancarContas(nota: NotaXml, acc: Acumulador, tipo: 'PAGAR' | 'RECEBER', pessoa: string | undefined, nomePessoa: string): void {
  const total = nota.dups.length;
  nota.dups.forEach((dup, i) => {
    const erros: string[] = [];
    const avisos: string[] = [];
    const vencimento = obrigatorio(erros, 'vencimento', () => data(v(dup, 'dVenc')));
    if (vencimento !== undefined && vencimento < acc.hoje) {
      acc.vencidas++;
      return;
    }
    const parcela = i + 1;
    const chave = `${tipo}|${pessoa ?? ''}|${nota.nNF ?? ''}|${parcela}`;
    if (acc.contas.has(chave)) return;

    const valor = obrigatorio(erros, 'valor', () => numero(v(dup, 'vDup'), { min: 0.01 }));
    const registro: RegConta = {
      tipo,
      descricao: texto([`NF ${nota.nNF ?? '?'}`, nomePessoa].filter((p) => p !== '').join(' - '), 120) ?? '',
      valor: valor ?? 0,
      vencimento: vencimento ?? '',
      documento: nota.nNF ?? undefined,
      parcela,
      totalParcelas: total,
      pessoa,
      nomePessoa: nomePessoa || undefined,
      categoria: tipo === 'PAGAR' ? 'Compras de mercadorias' : 'Vendas a prazo',
    };
    acc.contas.set(chave, { origem: nota.origem, registro, erros, avisos });
  });
}

// Nota de compra: emitente vira fornecedor; itens viram produtos sem código; duplicatas, contas a pagar.
function lancarCompra(nota: NotaXml, acc: Acumulador): void {
  const emit = nota.emit;
  const endEmit = bloco(emit, 'enderEmit');
  const chaveFornecedor = chaveDoc(nota.docEmit) || `nome:${v(emit, 'xNome')}`;
  const nomeFornecedor = texto(v(emit, 'xFant') || v(emit, 'xNome'), 120) ?? '';

  const errosF: string[] = [];
  const docFornecedor = tentar(errosF, () => cpfCnpj(nota.docEmit));
  if (!acc.fornecedores.has(chaveFornecedor)) {
    if (!nomeFornecedor) errosF.push('Fornecedor sem nome');
    const registro: RegFornecedor = {
      nome: nomeFornecedor,
      razaoSocial: texto(v(emit, 'xNome'), 120),
      cnpj: docFornecedor,
      inscricaoEstadual: texto(v(emit, 'IE'), 20),
      telefone: tentar(errosF, () => telefone(v(endEmit, 'fone') || v(emit, 'fone'))),
      endereco: texto(enderecoDaNota(endEmit), 200),
      cidade: texto(v(endEmit, 'xMun'), 80),
      uf: tentar(errosF, () => uf(v(endEmit, 'UF'))),
    };
    acc.fornecedores.set(chaveFornecedor, { origem: nota.origem, registro, erros: errosF, avisos: [] });
  }

  for (const det of nota.dets) {
    const prod = bloco(det, 'prod') || det;
    const codigoFornecedor = texto(v(prod, 'cProd'), 60);
    // Mesmo produto do mesmo fornecedor: vale a nota mais nova (a lista já está ordenada). Sem código, não há como repetir.
    const chave = codigoFornecedor
      ? `compra|${chaveDoc(nota.docEmit)}|${codigoFornecedor}`
      : `compra|sem-codigo|${acc.produtos.size}`;
    if (acc.produtos.has(chave)) continue;

    const erros: string[] = [];
    const avisos: string[] = [];
    const nome = texto(v(prod, 'xProd'), 120);
    if (!nome) erros.push('nome do produto não informado');
    const registro: RegProduto = {
      ean: eanDoItem(prod, avisos),
      nome: nome ?? '',
      ncm: tentar(erros, () => ncm(v(prod, 'NCM'))),
      cest: tentar(erros, () => cest(v(prod, 'CEST'))),
      unidade: unidadeDoItem(v(prod, 'uCom'), avisos),
      precoCusto: tentar(erros, () => numero(v(prod, 'vUnCom'))),
      fornecedorCnpj: docFornecedor,
      codigoFornecedor,
    };
    acc.produtos.set(chave, { origem: nota.origem, registro, erros, avisos });
  }

  lancarContas(nota, acc, 'PAGAR', docFornecedor, nomeFornecedor);
}

// Nota emitida pela loja: destinatário vira cliente; itens viram produtos com o código da loja; duplicatas, contas a receber.
function lancarVenda(nota: NotaXml, acc: Acumulador): void {
  const dest = nota.dest;
  const endDest = bloco(dest, 'enderDest');
  const nomeCliente = texto(v(dest, 'xNome'), 120) ?? '';

  let docCliente: string | undefined;
  if (chaveDoc(nota.docDest)) {
    const chaveCliente = chaveDoc(nota.docDest);
    const errosC: string[] = [];
    docCliente = tentar(errosC, () => cpfCnpj(nota.docDest));
    if (!acc.clientes.has(chaveCliente)) {
      if (!nomeCliente) errosC.push('nome do cliente não informado');
      const lgr = v(endDest, 'xLgr');
      const cpl = v(endDest, 'xCpl');
      const registro: RegCliente = {
        nome: nomeCliente,
        razaoSocial: docCliente && docCliente.length === 14 ? nomeCliente || undefined : undefined,
        cpfCnpj: docCliente,
        inscricaoEstadual: texto(v(dest, 'IE'), 20),
        telefone: tentar(errosC, () => telefone(v(endDest, 'fone') || v(dest, 'fone'))),
        email: tentar(errosC, () => email(v(dest, 'email'))),
        cep: tentar(errosC, () => cep(v(endDest, 'CEP'))),
        endereco: texto([lgr, cpl].filter((p) => p !== '').join(' - '), 200),
        numero: texto(v(endDest, 'nro'), 20),
        bairro: texto(v(endDest, 'xBairro'), 80),
        cidade: texto(v(endDest, 'xMun'), 80),
        uf: tentar(errosC, () => uf(v(endDest, 'UF'))),
      };
      acc.clientes.set(chaveCliente, { origem: nota.origem, registro, erros: errosC, avisos: [] });
    }
  }

  for (const det of nota.dets) {
    const prod = bloco(det, 'prod') || det;
    const codigo = texto(v(prod, 'cProd'), 60);
    const chave = codigo ? `venda|${codigo}` : `venda|sem-codigo|${acc.produtos.size}`;
    if (acc.produtos.has(chave)) continue;

    const erros: string[] = [];
    const avisos: string[] = [];
    const nome = texto(v(prod, 'xProd'), 120);
    if (!nome) erros.push('nome do produto não informado');
    const registro: RegProduto = {
      codigo,
      ean: eanDoItem(prod, avisos),
      nome: nome ?? '',
      ncm: tentar(erros, () => ncm(v(prod, 'NCM'))),
      cest: tentar(erros, () => cest(v(prod, 'CEST'))),
      cfop: tentar(erros, () => cfop(v(prod, 'CFOP'))),
      unidade: unidadeDoItem(v(prod, 'uCom'), avisos),
      precoVenda: tentar(erros, () => numero(v(prod, 'vUnCom'))),
    };
    acc.produtos.set(chave, { origem: nota.origem, registro, erros, avisos });
  }

  lancarContas(nota, acc, 'RECEBER', docCliente, nomeCliente);
}

// Lê as NF-e enviadas. cnpjsProprios: CNPJs da loja e do fiscal (decide venda, compra ou outra empresa).
export function lerNfes(arquivos: ArquivoEnviado[], cnpjsProprios: string[]): LeituraLote {
  const avisos: string[] = [];
  let naoXml = 0;
  let naoNfe = 0;
  const notas: NotaXml[] = [];
  for (const arq of arquivos) {
    if (!/\.xml$/i.test(arq.nome)) {
      naoXml++;
      continue;
    }
    const nota = lerNotaXml(arq.conteudo.toString('utf8'), arq.nome);
    if (!nota) {
      naoNfe++;
      continue;
    }
    notas.push(nota);
  }

  const proprios = new Set(cnpjsProprios.map(chaveDoc).filter((d) => d !== ''));
  const semCadastro = proprios.size === 0;

  if (naoXml) avisos.push(`${naoXml} arquivos que não são XML foram ignorados`);
  if (naoNfe) avisos.push(`${naoNfe} XMLs que não são NF-e (eventos, cancelamentos...) foram ignorados`);
  if (semCadastro) {
    avisos.push('Cadastre o CNPJ da loja para o sistema separar notas de compra e de venda; todas foram lidas como compra.');
  }

  // Nota mais nova primeiro: na dedup, a primeira que entra é a que fica.
  notas.sort((a, b) => b.dhMs - a.dhMs);

  const acc: Acumulador = {
    hoje: hojeIso(),
    fornecedores: new Map(),
    clientes: new Map(),
    produtos: new Map(),
    contas: new Map(),
    vencidas: 0,
  };
  const chavesVistas = new Set<string>();
  let compras = 0;
  let vendas = 0;
  let outraEmpresa = 0;

  for (const nota of notas) {
    if (nota.chave) {
      if (chavesVistas.has(nota.chave)) continue;
      chavesVistas.add(nota.chave);
    }
    const emitente = chaveDoc(nota.docEmit);
    const destinatario = chaveDoc(nota.docDest);
    if (emitente && proprios.has(emitente)) {
      vendas++;
      lancarVenda(nota, acc);
    } else if (semCadastro || (destinatario && proprios.has(destinatario))) {
      compras++;
      lancarCompra(nota, acc);
    } else {
      outraEmpresa++;
    }
  }

  const lidas = compras + vendas;
  if (lidas === 0) throw new HttpError(400, 'Nenhuma NF-e encontrada nos arquivos enviados');

  if (acc.vencidas) {
    avisos.push(`${acc.vencidas} duplicatas vencidas antes de hoje foram deixadas de fora (provavelmente já pagas)`);
  }
  if (outraEmpresa) avisos.push(`${outraEmpresa} notas de outra empresa (CNPJ diferente do da loja) foram ignoradas`);

  return {
    fonte: 'nfe',
    descricao: `${lidas} NF-e lidas (${compras} de compra, ${vendas} de venda)`,
    avisos,
    registros: {
      fornecedores: [...acc.fornecedores.values()],
      clientes: [...acc.clientes.values()],
      produtos: [...acc.produtos.values()],
      contas: [...acc.contas.values()],
    },
  };
}
