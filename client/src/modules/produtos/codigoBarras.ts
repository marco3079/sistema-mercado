// Código de barras em SVG, sem bibliotecas.
// EAN-13 (produtos de gôndola) e Code 128 B (código interno). Usado na prévia da tela e na impressão.

// Tabelas do EAN-13: L e G (lado esquerdo, paridade pelo 1º dígito) e R (lado direito).
const TABELA_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const TABELA_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const TABELA_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// Padrão de paridade do lado esquerdo, pelo primeiro dígito.
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Padrões do Code 128 (valores 0 a 106, cada um com 11 módulos; 106 é o stop, com 13 módulos).
// Barra = 1, espaço = 0.
const CODE128: string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100', '10011001000', '10011000100',
  '10001100100', '11001001000', '11001000100', '11000100100', '10110011100', '10011011100', '10011001110', '10111001100',
  '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110',
  '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010', '11011011000', '11011000110',
  '11000110110', '10100011000', '10001011000', '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110',
  '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', '11101000110',
  '11100010110', '11101101000', '11101100010', '11100011010', '11101111010', '11001000010', '11110001010', '10100110000',
  '10100001100', '10010110000', '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000',
  '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100', '10011110010', '11110100100', '11110010100',
  '11110010010', '11011011110', '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000',
  '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110', '11110101110', '11010000100',
  '11010010000', '11010011100', '1100011101011',
];
const START_B = 104;
const STOP = 106;

function escaparXml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// EAN-13 válido: 13 dígitos e dígito verificador correto.
export function ean13Valido(codigo: string): boolean {
  if (!/^\d{13}$/.test(codigo)) return false;
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(codigo[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10 === Number(codigo[12]);
}

interface Modulo {
  barra: boolean;
  guarda: boolean; // guardas do EAN ficam mais compridas (descem sob os números)
}

// Monta o SVG a partir da sequência de módulos. O viewBox usa módulos como unidade.
function desenharSvg(modulos: Modulo[], texto: string, larguraMm: number, alturaMm: number, digitos?: { x: number; t: string }[]): string {
  const quieta = 10;
  const total = modulos.length + quieta * 2;
  const alturaBarras = 60;
  const extraGuarda = 5;
  const alturaTexto = 14;
  const altura = alturaBarras + extraGuarda + alturaTexto;

  // Agrupa módulos iguais em barras contínuas (menos retângulos no SVG).
  const retangulos: string[] = [];
  let i = 0;
  while (i < modulos.length) {
    const m = modulos[i];
    let j = i;
    while (j < modulos.length && modulos[j].barra === m.barra && modulos[j].guarda === m.guarda) j++;
    if (m.barra) {
      const h = m.guarda ? alturaBarras + extraGuarda : alturaBarras;
      retangulos.push(`<rect x="${quieta + i}" y="0" width="${j - i}" height="${h}" fill="#000"/>`);
    }
    i = j;
  }

  const textos = digitos
    ? digitos.map((d) => `<text x="${d.x + quieta}" y="${alturaBarras + extraGuarda + alturaTexto - 2}" font-size="11" text-anchor="middle" font-family="Arial, sans-serif" fill="#000">${escaparXml(d.t)}</text>`).join('')
    : `<text x="${total / 2}" y="${alturaBarras + extraGuarda + alturaTexto - 2}" font-size="11" text-anchor="middle" font-family="Arial, sans-serif" fill="#000">${escaparXml(texto)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${altura}" width="${larguraMm}mm" height="${alturaMm}mm" preserveAspectRatio="none" role="img" aria-label="Código de barras ${escaparXml(texto)}">${retangulos.join('')}${textos}</svg>`;
}

// Code 128 B: aceita qualquer texto ASCII imprimível (os outros caracteres viram "-").
export function svgCode128(codigo: string, larguraMm: number, alturaMm: number): string {
  const texto = codigo.replace(/[^\x20-\x7e]/g, '-') || '-';
  const valores = Array.from(texto, (c) => c.charCodeAt(0) - 32);
  const soma = valores.reduce((acc, v, i) => acc + v * (i + 1), START_B);
  const verificador = soma % 103;
  const sequencia = [START_B, ...valores, verificador, STOP];

  const bits = sequencia.map((v) => CODE128[v]).join('');
  const modulos: Modulo[] = Array.from(bits, (b) => ({ barra: b === '1', guarda: false }));
  return desenharSvg(modulos, texto, larguraMm, alturaMm);
}

// EAN-13 quando o código é um EAN-13 válido; senão, Code 128 B do mesmo texto.
export function svgEan13(codigo: string, larguraMm: number, alturaMm: number): string {
  if (!ean13Valido(codigo)) return svgCode128(codigo, larguraMm, alturaMm);

  const padrao = PARIDADE[Number(codigo[0])];
  const bits: Modulo[] = [];
  const guardas = (padraoBits: string) => Array.from(padraoBits, (b) => ({ barra: b === '1', guarda: true }));
  const normais = (padraoBits: string) => Array.from(padraoBits, (b) => ({ barra: b === '1', guarda: false }));

  // Guarda inicial 101.
  bits.push(...guardas('101'));
  // Seis dígitos da esquerda (L ou G, pela paridade do 1º dígito).
  for (let k = 1; k <= 6; k++) {
    const tabela = padrao[k - 1] === 'L' ? TABELA_L : TABELA_G;
    bits.push(...normais(tabela[Number(codigo[k])]));
  }
  // Guarda central 01010.
  bits.push(...guardas('01010'));
  // Seis dígitos da direita (tabela R).
  for (let k = 7; k <= 12; k++) {
    bits.push(...normais(TABELA_R[Number(codigo[k])]));
  }
  // Guarda final 101.
  bits.push(...guardas('101'));

  // Números embaixo: o 1º dígito fica à esquerda da guarda; os outros dois blocos ficam centralizados
  // sob cada metade (módulos 3 a 44 e 50 a 91; centro em 24 e 71).
  const digitos = [
    { x: -5, t: codigo[0] },
    { x: 24, t: codigo.slice(1, 7) },
    { x: 71, t: codigo.slice(7, 13) },
  ];
  return desenharSvg(bits, codigo, larguraMm, alturaMm, digitos);
}
