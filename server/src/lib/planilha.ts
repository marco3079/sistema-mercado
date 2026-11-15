// Planilhas sem dependências: gera .xlsx (OOXML) e lê .xlsx / .csv.
// Usa só zlib (inflateRawSync) e o criarZip de ./zip.

import zlib from 'zlib';
import { HttpError } from './erros';
import { ArquivoZip, criarZip } from './zip';

export type ValorCelula = string | number | boolean | null | undefined;

export interface AbaPlanilha {
  nome: string; // nome da aba (máx. 31 caracteres, sem []:*?/\ — limpe)
  linhas: ValorCelula[][]; // linha 0 = cabeçalho
  larguras?: number[]; // largura de cada coluna em "caracteres" (opcional; padrão 14)
  cabecalho?: boolean; // padrão true: linha 0 em negrito, fundo cinza-claro, congelada (painel fixo)
}

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const LIMITE_LINHAS = 20000;
const LIMITE_DESCOMPACTADO = 50 * 1024 * 1024;
const LARGURA_PADRAO = 14;
const NS_PLANILHA = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_RELACOES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_ABA = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_ESTILOS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const REL_DOCUMENTO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MSG_XLS_ANTIGO =
  'Formato .xls antigo não é aceito. No Excel, use "Salvar como" → Pasta de Trabalho do Excel (.xlsx) ou CSV.';

// ---------- escrita ----------

function limparTexto(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function letraColuna(indice: number): string {
  let i = indice + 1;
  let s = '';
  while (i > 0) {
    const resto = (i - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function nomesDeAbas(brutos: string[]): string[] {
  const usados = new Set<string>();
  return brutos.map((bruto) => {
    let base = limparTexto(bruto)
      .replace(/[[\]:*?\/\\]/g, '')
      .trim()
      .replace(/^'+|'+$/g, '')
      .slice(0, 31)
      .trim();
    if (!base) base = 'Planilha';
    let nome = base;
    let k = 2;
    while (usados.has(nome.toLowerCase())) {
      const sufixo = ` (${k++})`;
      nome = base.slice(0, 31 - sufixo.length) + sufixo;
    }
    usados.add(nome.toLowerCase());
    return nome;
  });
}

function celulaXml(valor: ValorCelula, ref: string, estilo: number): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const s = estilo ? ` s="${estilo}"` : '';
  if (typeof valor === 'boolean') return `<c r="${ref}"${s} t="b"><v>${valor ? 1 : 0}</v></c>`;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    return `<c r="${ref}"${s}><v>${String(valor)}</v></c>`;
  }
  const texto = limparTexto(String(valor));
  if (texto === '') return '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(texto)}</t></is></c>`;
}

interface AbaMontada {
  xml: string;
  filtro: string | null; // referência absoluta para _xlnm._FilterDatabase
}

function montarAba(aba: AbaPlanilha, nome: string, selecionada: boolean): AbaMontada {
  const cabecalho = aba.cabecalho !== false;
  const linhas = aba.linhas ?? [];
  const ncols = linhas.reduce((max, l) => Math.max(max, l.length), 1);

  const colunas = Array.from({ length: ncols }, (_, i) => {
    const w = aba.larguras?.[i];
    const largura = typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : LARGURA_PADRAO;
    return `<col min="${i + 1}" max="${i + 1}" width="${largura}" customWidth="1"/>`;
  }).join('');

  const marcada = selecionada ? ' tabSelected="1"' : '';
  const visao = cabecalho
    ? `<sheetViews><sheetView${marcada} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView${marcada} workbookViewId="0"/></sheetViews>`;

  const corpo = linhas
    .map((linha, r) => {
      const celulas = linha
        .map((valor, c) => celulaXml(valor, `${letraColuna(c)}${r + 1}`, cabecalho && r === 0 ? 1 : 0))
        .join('');
      return `<row r="${r + 1}">${celulas}</row>`;
    })
    .join('');

  const temFiltro = cabecalho && linhas.length > 0;
  const ultimaColuna = letraColuna(ncols - 1);
  const ultimaLinha = linhas.length;
  const filtroXml = temFiltro ? `<autoFilter ref="A1:${ultimaColuna}${ultimaLinha}"/>` : '';
  const filtro = temFiltro ? `'${nome.replace(/'/g, "''")}'!$A$1:$${ultimaColuna}$${ultimaLinha}` : null;

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="${NS_PLANILHA}" xmlns:r="${NS_RELACOES}">` +
    visao +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colunas}</cols>` +
    `<sheetData>${corpo}</sheetData>` +
    filtroXml +
    `</worksheet>`;
  return { xml, filtro };
}

const ESTILOS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="${NS_PLANILHA}">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function criarXlsx(abas: AbaPlanilha[]): Buffer {
  const lista: AbaPlanilha[] = abas.length ? abas : [{ nome: 'Planilha', linhas: [] }];
  const nomes = nomesDeAbas(lista.map((a) => a.nome));
  const montadas = lista.map((aba, i) => montarAba(aba, nomes[i], i === 0));
  const n = lista.length;
  const agora = new Date().toISOString();

  const abasXml = nomes.map((nome, i) => `<sheet name="${xmlEscape(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
  const definidos = montadas
    .map((m, i) => (m.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(m.filtro)}</definedName>` : ''))
    .join('');

  const arquivos: ArquivoZip[] = [
    {
      nome: '[Content_Types].xml',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        montadas
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
        `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
        `</Types>`,
    },
    {
      nome: '_rels/.rels',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL_DOCUMENTO}" Target="xl/workbook.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
        `</Relationships>`,
    },
    {
      nome: 'docProps/app.xml',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sistema de mercado</Application></Properties>`,
    },
    {
      nome: 'docProps/core.xml',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:creator>Sistema de mercado</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created>` +
        `<dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified>` +
        `</cp:coreProperties>`,
    },
    {
      nome: 'xl/workbook.xml',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="${NS_PLANILHA}" xmlns:r="${NS_RELACOES}">` +
        `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16000" windowHeight="9000"/></bookViews>` +
        `<sheets>${abasXml.join('')}</sheets>` +
        (definidos ? `<definedNames>${definidos}</definedNames>` : '') +
        `</workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_ABA}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${n + 1}" Type="${REL_ESTILOS}" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { nome: 'xl/styles.xml', conteudo: ESTILOS_XML },
    ...montadas.map((m, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: m.xml })),
  ];
  return criarZip(arquivos);
}

// ---------- leitura ----------

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTIDADES[e] ?? '';
  });
}

function indiceColuna(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Concatena o texto de todos os <t> (ignora fonética <rPh>).
function textoDeT(xml: string): string {
  const semFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let texto = '';
  for (const m of semFonetica.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) texto += decodificar(m[1]);
  return texto;
}

function extrairSharedStrings(xml: string): string[] {
  const lista: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    lista.push(m[1] !== undefined ? textoDeT(m[1]) : '');
  }
  return lista;
}

function valorCelula(attrs: string, inner: string, strings: string[]): string {
  const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
  if (tipo === 'inlineStr') return textoDeT(inner);
  const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
  const v = vMatch ? decodificar(vMatch[1]) : '';
  if (tipo === 's') return strings[parseInt(v, 10)] ?? '';
  if (tipo === 'b') return v === '1' ? 'VERDADEIRO' : 'FALSO';
  return v; // número, str, e
}

function corrompida(): HttpError {
  return new HttpError(400, 'Planilha corrompida ou não é um .xlsx válido.');
}

function grande(): HttpError {
  return new HttpError(400, 'Planilha grande demais');
}

interface EntradaZip {
  metodo: number;
  comp: number;
  local: number;
}

function indiceZip(buf: Buffer): Map<string, EntradaZip> {
  const inicioBusca = Math.max(0, buf.length - 22 - 65535);
  let fim = -1;
  for (let p = buf.length - 22; p >= inicioBusca; p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) {
      fim = p;
      break;
    }
  }
  if (fim < 0) throw corrompida();

  const quantidade = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const indice = new Map<string, EntradaZip>();
  let total = 0;
  for (let i = 0; i < quantidade; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw corrompida();
    const metodo = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const descomp = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nLen);
    total += descomp;
    if (total > LIMITE_DESCOMPACTADO) throw grande();
    indice.set(nome, { metodo, comp, local });
    p += 46 + nLen + eLen + cLen;
  }
  return indice;
}

function lerEntrada(buf: Buffer, entrada: EntradaZip): Buffer {
  const lo = entrada.local;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw corrompida();
  const nLen = buf.readUInt16LE(lo + 26);
  const eLen = buf.readUInt16LE(lo + 28);
  const ini = lo + 30 + nLen + eLen;
  const dados = buf.subarray(ini, ini + entrada.comp);
  if (dados.length !== entrada.comp) throw corrompida();
  if (entrada.metodo === 0) return dados;
  if (entrada.metodo === 8) {
    try {
      return zlib.inflateRawSync(dados, { maxOutputLength: LIMITE_DESCOMPACTADO });
    } catch (e) {
      if (e instanceof RangeError) throw grande();
      throw corrompida();
    }
  }
  throw new HttpError(400, 'Planilha em formato não suportado');
}

function lerXlsx(buf: Buffer): string[][] {
  const indice = indiceZip(buf);
  const texto = (nome: string): string | undefined => {
    const entrada = indice.get(nome);
    return entrada ? lerEntrada(buf, entrada).toString('utf8') : undefined;
  };

  // Caminho da primeira aba via workbook.xml + rels.
  let caminho = 'xl/worksheets/sheet1.xml';
  const wb = texto('xl/workbook.xml');
  const rels = texto('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = /<(?:\w+:)?sheet\b[^>]*?\br:id="([^"]+)"/.exec(wb)?.[1];
    const tags = rels.match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? [];
    for (const tag of tags) {
      if (rid && /\bId="([^"]+)"/.exec(tag)?.[1] === rid) {
        const alvo = /\bTarget="([^"]+)"/.exec(tag)?.[1];
        if (alvo) caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
      }
    }
  }
  const xmlAba = texto(caminho) ?? texto('xl/worksheets/sheet1.xml');
  if (xmlAba === undefined) throw corrompida();

  const sst = texto('xl/sharedStrings.xml');
  const strings = sst ? extrairSharedStrings(sst) : [];

  const preenchidas = new Map<number, string[]>();
  const matriz: string[][] = [];
  let proxima = 0;
  let maxCols = 0;
  for (const mLinha of xmlAba.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\br="(\d+)"/.exec(mLinha[1]);
    const idx = rAttr ? parseInt(rAttr[1], 10) - 1 : proxima;
    if (idx < 0) throw corrompida();
    const linha: string[] = [];
    let colSeq = 0;
    for (const mCel of (mLinha[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mCel[1];
      const ref = /\br="([A-Za-z]+)\d*"/.exec(attrs);
      const col = ref ? indiceColuna(ref[1]) : colSeq;
      colSeq = col + 1;
      while (linha.length < col) linha.push('');
      linha[col] = valorCelula(attrs, mCel[2] ?? '', strings);
    }
    proxima = idx + 1;
    // Linha só com formatação (sem valor) não conta para o limite nem ocupa espaço.
    if (!linha.some((c) => c.trim() !== '')) continue;
    if (idx >= LIMITE_LINHAS) throw new HttpError(400, 'Máximo de 20.000 linhas por planilha');
    preenchidas.set(idx, linha);
    maxCols = Math.max(maxCols, linha.length);
  }
  let ultimo = -1;
  for (const k of preenchidas.keys()) ultimo = Math.max(ultimo, k);
  for (let i = 0; i <= ultimo; i++) matriz.push(preenchidas.get(i) ?? []);

  // Retangular, com '' onde a célula não existe; trim; remove linhas vazias do fim.
  const saida = matriz.map((l) => {
    const r: string[] = [];
    for (let c = 0; c < maxCols; c++) r.push((l[c] ?? '').trim());
    return r;
  });
  return aparar(saida);
}

function contar(texto: string, ch: string): number {
  return texto.split(ch).length - 1;
}

function parseCsv(texto: string, sep: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  let i = 0;
  while (i < texto.length) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        aspas = false;
        i++;
        continue;
      }
      campo += ch;
      i++;
      continue;
    }
    if (ch === '"' && campo === '') {
      aspas = true;
      i++;
      continue;
    }
    if (ch === sep) {
      linha.push(campo);
      campo = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
      i += ch === '\r' && texto[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    campo += ch;
    i++;
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

function lerCsv(buf: Buffer): string[][] {
  let texto = buf.toString('utf8');
  if (texto.includes('�')) texto = buf.toString('latin1'); // planilhas do Excel em português
  texto = texto.replace(/^(﻿|ï»¿)/, '');

  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const pv = contar(primeira, ';');
  const vg = contar(primeira, ',');
  const tab = contar(primeira, '\t');
  const sep = tab > 0 && pv === 0 && vg === 0 ? '\t' : pv > vg ? ';' : ',';

  return aparar(parseCsv(texto, sep).map((l) => l.map((c) => c.trim())));
}

// Remove linhas totalmente vazias do fim e aplica o limite de linhas.
function aparar(linhas: string[][]): string[][] {
  while (linhas.length && linhas[linhas.length - 1].every((c) => c === '')) linhas.pop();
  if (linhas.length > LIMITE_LINHAS) throw new HttpError(400, 'Máximo de 20.000 linhas por planilha');
  return linhas;
}

export function lerPlanilha(arquivo: Buffer, nomeArquivo?: string): string[][] {
  const ehZip = arquivo.length >= 4 && arquivo[0] === 0x50 && arquivo[1] === 0x4b && arquivo[2] === 0x03 && arquivo[3] === 0x04;
  if (ehZip) return lerXlsx(arquivo);
  if (arquivo.length >= 4 && arquivo.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new HttpError(400, MSG_XLS_ANTIGO);
  }
  if (nomeArquivo && /\.xlsx$/i.test(nomeArquivo)) throw corrompida();
  return lerCsv(arquivo);
}
