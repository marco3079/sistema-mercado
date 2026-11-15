// Conversores puros da migração: transformam o texto bruto de uma célula/campo no formato normalizado.
// Não acessam banco. Entrada vazia -> undefined. Entrada inválida -> ErroConversao.

import type { Unidade } from '@prisma/client';
import { eanValido } from '../../lib/precos';

// Erro de conversão: a mensagem vai para o usuário (curta, em português).
export class ErroConversao extends Error {}

// Entrada vazia: undefined, null, só espaços ou "-".
function vazio(valor: unknown): boolean {
  if (valor === undefined || valor === null) return true;
  const s = String(valor).trim();
  return s === '' || s === '-';
}

// Chave para comparar cabeçalhos: minúsculas, sem acentos e só [a-z0-9].
export function chaveCabecalho(valor: string): string {
  return String(valor)
    .replace(/[º°]/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Chave para comparar nomes: minúsculas, sem acentos, espaços colapsados.
export function chaveTexto(valor: string): string {
  return String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Texto aparado, com espaços internos colapsados, sem controle, cortado em `max` caracteres.
export function texto(valor: unknown, max: number): string | undefined {
  if (vazio(valor)) return undefined;
  const s = String(valor)
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  if (!s) return undefined;
  return Array.from(s).slice(0, max).join('').trimEnd();
}

// Número a partir de número ou texto em formato BR ou US.
export function numero(valor: unknown, opcoes?: { min?: number; max?: number }): number | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  let n: number;

  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new ErroConversao(`número inválido: "${original}"`);
    n = valor;
  } else {
    let s = original.replace(/R\$/gi, '').replace(/%/g, '').replace(/\s+/g, '');
    let negativo = false;
    if (/^\(.*\)$/.test(s)) {
      negativo = true;
      s = s.slice(1, -1);
    }
    if (s.startsWith('-')) {
      negativo = !negativo;
      s = s.slice(1);
    }
    // Letras de unidade no fim ("1,5kg" -> "1,5").
    s = s.replace(/[a-zA-Z]+$/, '');

    const lastVirgula = s.lastIndexOf(',');
    const lastPonto = s.lastIndexOf('.');
    let formatado: string;
    if (lastVirgula >= 0 && lastPonto >= 0) {
      // Os dois separadores: o que aparece por último é o decimal.
      formatado = lastVirgula > lastPonto
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (lastVirgula >= 0) {
      // Só vírgula: decimal.
      formatado = s.replace(',', '.');
    } else if (/^\d+(\.\d{3})+$/.test(s)) {
      // Só ponto com grupos de 3 dígitos: milhar ("1.234.567", "1.234").
      formatado = s.replace(/\./g, '');
    } else {
      // Só ponto como decimal ("10.5", "10.50").
      formatado = s;
    }

    if (!/^\d*\.?\d+$/.test(formatado)) throw new ErroConversao(`número inválido: "${original}"`);
    n = Number(formatado);
    if (negativo) n = -n;
  }

  if (!Number.isFinite(n)) throw new ErroConversao(`número inválido: "${original}"`);
  if (opcoes?.min !== undefined && n < opcoes.min) throw new ErroConversao(`deve ser no mínimo ${opcoes.min}`);
  if (opcoes?.max !== undefined && n > opcoes.max) throw new ErroConversao(`deve ser no máximo ${opcoes.max}`);
  return n;
}

// Número inteiro (aceita "12,0").
export function inteiro(valor: unknown, opcoes?: { min?: number; max?: number }): number | undefined {
  const n = numero(valor, opcoes);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n)) throw new ErroConversao('deve ser um número inteiro');
  return n;
}

const VERDADEIROS = new Set(
  ['sim', 's', 'x', '1', 'true', 'verdadeiro', 'ativo', 'ativa', 'a', 'yes', 'y', 'v'].map(chaveTexto),
);
const FALSOS = new Set(
  ['nao', 'não', 'n', '0', 'false', 'falso', 'inativo', 'inativa', 'i', 'no', 'f'].map(chaveTexto),
);

// Sim/Não e variações.
export function booleano(valor: unknown): boolean | undefined {
  if (vazio(valor)) return undefined;
  const k = chaveTexto(String(valor));
  if (VERDADEIROS.has(k)) return true;
  if (FALSOS.has(k)) return false;
  throw new ErroConversao('use Sim ou Não');
}

// Data em AAAA-MM-DD a partir de vários formatos (inclui número de série do Excel e ddmmaaaa do SPED).
export function data(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  const erro = () => new ErroConversao(`data inválida: "${original}"`);

  const montar = (ano: number, mes: number, dia: number): string => {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) throw erro();
    return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  };

  // ddmmaaaa (SPED)
  if (/^\d{8}$/.test(original)) {
    return montar(Number(original.slice(4, 8)), Number(original.slice(2, 4)), Number(original.slice(0, 2)));
  }

  // Número de série do Excel (dias desde 1899-12-30).
  if (/^\d+(\.\d+)?$/.test(original)) {
    const serie = Number(original);
    if (serie >= 20000 && serie <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serie) * 86400000);
      return montar(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    throw erro();
  }

  // dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, dd.mm.aaaa
  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(original);
  if (br) {
    let ano = Number(br[3]);
    if (br[3].length === 2) ano = ano < 70 ? 2000 + ano : 1900 + ano;
    return montar(ano, Number(br[2]), Number(br[1]));
  }

  // aaaa-mm-dd, com ou sem hora depois
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(original);
  if (iso) return montar(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  throw erro();
}

// Tabela de unidades: chave (chaveCabecalho, sem número de embalagem) -> unidade do sistema.
const TABELA_UNIDADES: [Unidade, string[]][] = [
  ['UN', ['un', 'und', 'unid', 'unidade', 'unidades', 'u', 'pc', 'pca', 'peca', 'pecas', 'pcs', 'par', 'jg', 'jogo', 'kit', 'rl', 'rolo', 'ct', 'cartela', 'bd', 'bandeja', 'bj', 'lata']],
  ['KG', ['kg', 'kgs', 'quilo', 'quilos', 'kilo', 'kilos', 'quilograma', 'quilogramas']],
  ['G', ['g', 'gr', 'grs', 'grama', 'gramas']],
  ['L', ['l', 'lt', 'lts', 'litro', 'litros']],
  ['ML', ['ml', 'mililitro', 'mililitros']],
  ['CX', ['cx', 'caixa', 'caixas', 'fd', 'fardo', 'fardos', 'eb', 'emb', 'embalagem']],
  ['PCT', ['pct', 'pt', 'pac', 'pacote', 'pacotes', 'sc', 'saco', 'sache']],
  ['DZ', ['dz', 'duzia']],
];
const MAPA_UNIDADES = new Map<string, Unidade>();
for (const [unidadeSistema, chaves] of TABELA_UNIDADES) {
  for (const chave of chaves) MAPA_UNIDADES.set(chave, unidadeSistema);
}

// Unidade de medida. Número de embalagem ("CX12", "PCT 6") é ignorado. Desconhecida -> UN, reconhecida = false.
export function unidade(valor: unknown): { valor: Unidade; reconhecida: boolean } | undefined {
  if (vazio(valor)) return undefined;
  const chave = chaveCabecalho(String(valor)).replace(/^\d+/, '').replace(/\d+$/, '');
  const achada = MAPA_UNIDADES.get(chave);
  if (achada) return { valor: achada, reconhecida: true };
  return { valor: 'UN', reconhecida: false };
}

function digitosCpf(s: string): boolean {
  const d = s.split('').map(Number);
  if (d.every((x) => x === d[0])) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += d[i] * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== d[9]) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += d[i] * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === d[10];
}

function digitosCnpj(s: string): boolean {
  // Valor de cada caractere: charCodeAt(0) - 48 (dígitos 0-9; letras A-Z = 17-42).
  const v = s.split('').map((c) => c.charCodeAt(0) - 48);
  const dv = (base: number[], pesos: number[]): number => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += base[i] * pesos[i];
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  const dv1 = dv(v, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== v[12]) return false;
  const dv2 = dv(v, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv2 === v[13];
}

// CPF (11 dígitos) ou CNPJ (14 caracteres, numérico ou alfanumérico), sem pontuação, com DV validado.
export function cpfCnpj(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  const erro = () => new ErroConversao(`CPF/CNPJ inválido: "${original}"`);

  let s = original.toUpperCase().replace(/[.\-/\s]/g, '');
  if (/^0+$/.test(s)) return undefined;

  // Número do Excel que perdeu zeros à esquerda.
  if (/^\d+$/.test(s)) {
    if (s.length === 9 || s.length === 10) s = s.padStart(11, '0');
    else if (s.length === 12 || s.length === 13) s = s.padStart(14, '0');
  }

  if (/^\d{11}$/.test(s)) {
    if (!digitosCpf(s)) throw erro();
    return s;
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(s)) {
    if (!digitosCnpj(s)) throw erro();
    return s;
  }
  throw erro();
}

// EAN/GTIN só com dígitos. "SEM GTIN" ou zeros -> undefined.
export function ean(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  if (/SEM\s*GTIN/i.test(original)) return undefined;
  const digitos = original.replace(/\D/g, '');
  if (!digitos) throw new ErroConversao(`EAN inválido: "${original}"`);
  if (/^0+$/.test(digitos)) return undefined;
  if (!eanValido(digitos)) throw new ErroConversao(`EAN inválido: "${original}"`);
  return digitos;
}

// Só dígitos com tamanho fixo (ou zeros -> undefined, quando indicado).
function digitosFixos(valor: unknown, tamanho: number, mensagem: string, zerosViram?: boolean): string | undefined {
  if (vazio(valor)) return undefined;
  const d = String(valor).replace(/\D/g, '');
  if (zerosViram && /^0+$/.test(d)) return undefined;
  if (d.length !== tamanho) throw new ErroConversao(mensagem);
  return d;
}

// NCM: 8 dígitos. "0" ou zeros -> undefined.
export function ncm(valor: unknown): string | undefined {
  return digitosFixos(valor, 8, 'NCM deve ter 8 dígitos', true);
}

// CEST: 7 dígitos. Zeros -> undefined.
export function cest(valor: unknown): string | undefined {
  return digitosFixos(valor, 7, 'CEST deve ter 7 dígitos', true);
}

// CFOP: 4 dígitos.
export function cfop(valor: unknown): string | undefined {
  return digitosFixos(valor, 4, 'CFOP deve ter 4 dígitos');
}

// CSOSN: 3 ou 4 dígitos. 2 dígitos é CST, não CSOSN -> undefined.
export function csosn(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const d = String(valor).replace(/\D/g, '');
  if (d.length === 2) return undefined;
  if (d.length !== 3 && d.length !== 4) throw new ErroConversao('CSOSN deve ter 3 ou 4 dígitos');
  return d;
}

// Telefone brasileiro só com dígitos (tira o 55 do país e o 0 de operadora).
export function telefone(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  let d = original.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  if (d.length < 8 || d.length > 11) throw new ErroConversao(`telefone inválido: "${original}"`);
  return d;
}

// Tabela das 27 UFs: sigla -> nome.
const UFS: [string, string][] = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'],
  ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'],
  ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];
const SIGLAS_UF = new Set(UFS.map(([sigla]) => sigla));
const UF_POR_NOME = new Map(UFS.map(([sigla, nome]): [string, string] => [chaveTexto(nome), sigla]));

// UF pela sigla (qualquer caixa) ou pelo nome do estado.
export function uf(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  const sigla = original.toUpperCase();
  if (/^[A-Za-z]{2}$/.test(original) && SIGLAS_UF.has(sigla)) return sigla;
  const porNome = UF_POR_NOME.get(chaveTexto(original));
  if (porNome) return porNome;
  throw new ErroConversao(`UF inválida: "${original}"`);
}

// Código IBGE do município (7 dígitos) -> UF pelos 2 primeiros dígitos. Inválido -> undefined.
const UF_POR_CODIGO_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};
export function ufDoIbge(codigoMunicipio: unknown): string | undefined {
  if (vazio(codigoMunicipio)) return undefined;
  const d = String(codigoMunicipio).replace(/\D/g, '');
  if (d.length < 2) return undefined;
  return UF_POR_CODIGO_UF[d.slice(0, 2)];
}

// CEP com 8 dígitos (7 dígitos ganham um zero à esquerda).
export function cep(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  let d = String(valor).replace(/\D/g, '');
  if (d.length === 7) d = `0${d}`;
  if (d.length !== 8) throw new ErroConversao('CEP inválido');
  return d;
}

// E-mail em minúsculas. Se vierem vários, usa o primeiro.
export function email(valor: unknown): string | undefined {
  if (vazio(valor)) return undefined;
  const original = String(valor).trim();
  const primeiro = original.toLowerCase().split(/[;,\s]+/).filter(Boolean)[0] ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primeiro) || primeiro.length > 120) {
    throw new ErroConversao(`e-mail inválido: "${original}"`);
  }
  return primeiro;
}

// Documento para exibição: CPF 000.000.000-00, CNPJ 00.000.000/0000-00 (inclui alfanumérico). Outro -> como veio.
export function formatarDocumento(doc: string): string {
  const original = String(doc);
  const c = original.replace(/[.\-/\s]/g, '').toUpperCase();
  if (/^\d{11}$/.test(c)) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  if (/^[A-Z0-9]{14}$/.test(c)) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return original;
}
