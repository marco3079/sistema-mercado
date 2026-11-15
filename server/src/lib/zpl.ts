import { eanValido } from './precos';

// Gera ZPL (linguagem das impressoras Zebra e compatíveis) de uma etiqueta de gôndola.
// Medidas do layout em mm; na impressora viram pontos: dots = mm * dpi / 25,4.

export interface DadosEtiquetaZpl {
  nome: string;
  preco: number; // preço a exibir (já com promoção, se houver)
  unidade: string; // UN, KG, ...
  codigo: string; // código interno
  ean: string | null;
  data: string; // ex.: "14/11/2026"
  precoAntigo?: number | null; // com promoção: preço de tabela
  oferta?: string | null; // descrição da promoção
  atacado?: { quantidade: number; preco: number } | null;
}

export interface OpcoesZpl {
  larguraMm: number;
  alturaMm: number;
  dpi: number; // 203 ou 300
}

export function mmParaPontos(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

// Em ZPL, ^ e ~ são comandos: saem do texto. Quebras de linha também.
function limpar(texto: string): string {
  return texto
    .replace(/[\^~\\\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

// Uma etiqueta completa (^XA ... ^XZ). Para várias cópias, o chamador repete o bloco.
export function etiquetaZpl(dados: DadosEtiquetaZpl, opcoes: OpcoesZpl): string {
  const { larguraMm: L, alturaMm: A, dpi } = opcoes;
  const pt = (mm: number) => mmParaPontos(mm, dpi);
  const W = pt(L);
  const H = pt(A);
  const util = L - 4; // largura útil em mm (2 mm de cada lado)
  const xMm = 2;

  // Campo de texto: fonte escalável 0, altura e largura iguais, em mm.
  const campo = (xm: number, ym: number, fonteMm: number, texto: string) =>
    `^FO${pt(xm)},${pt(ym)}^A0N,${pt(fonteMm)},${pt(fonteMm)}^FD${texto}^FS`;

  const linhas: string[] = ['^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0'];

  // Nome do produto: até 2 linhas.
  const nome = limpar(dados.nome);
  const fNome = Math.max(2.2, Math.min(3.2, A * 0.085));
  const porLinha = Math.max(8, Math.floor(util / (fNome * 0.55)));
  const linhasNome = nome.length > porLinha ? 2 : 1;
  linhas.push(`^FO${pt(xMm)},${pt(1.5)}^A0N,${pt(fNome)},${pt(fNome)}^FB${pt(util)},2,0,L,0^FD${nome}^FS`);
  let y = 1.5 + linhasNome * fNome * 1.25 + 0.6;

  // Preço grande: "R$" pequeno, inteiro grande, centavos pequenos no alto (sobrescritos), unidade ao lado.
  const inteiro = Math.trunc(dados.preco);
  const centavos = String(Math.round((dados.preco - inteiro) * 100)).padStart(2, '0');
  const unidade = dados.unidade === 'UN' ? 'un' : dados.unidade.toLowerCase();
  const fPreco = Math.min(A * 0.34, util / (0.6 * String(inteiro).length + 1.41));
  const fRS = fPreco * 0.4;
  const fUn = fPreco * 0.25;
  const yPreco = y;
  const xInteiro = xMm + 0.5 * fPreco;
  const xCentavos = xInteiro + 0.6 * String(inteiro).length * fPreco + 0.05 * fPreco;
  const xUnidade = xCentavos + 1.8 * fRS + 0.5;
  linhas.push(campo(xMm, yPreco, fRS, 'R$'));
  linhas.push(campo(xInteiro, yPreco, fPreco, String(inteiro)));
  linhas.push(campo(xCentavos, yPreco, fRS, `,${centavos}`));
  linhas.push(campo(xUnidade, yPreco + fPreco - fUn, fUn, `/${unidade}`));
  y = yPreco + fPreco + 0.6;

  // Faixa de oferta (texto em negativo sobre bloco preto, porque a impressora é monocromática).
  if (dados.oferta) {
    const hFaixa = 3.4;
    const textoOferta =
      dados.precoAntigo !== null && dados.precoAntigo !== undefined
        ? `OFERTA - de ${reais(dados.precoAntigo)}`
        : 'OFERTA';
    linhas.push(`^FO${pt(xMm)},${pt(y)}^GB${pt(util)},${pt(hFaixa)},${pt(hFaixa)}^FS`);
    linhas.push(
      `^FO${pt(xMm + 0.8)},${pt(y + 0.5)}^A0N,${pt(hFaixa * 0.7)},${pt(hFaixa * 0.7)}^FR^FD ${limpar(textoOferta)} ^FS`,
    );
    y += hFaixa + 0.5;
  }

  // Atacado: "a partir de N un R$ X".
  if (dados.atacado) {
    const fAtacado = 2.0;
    const texto = `Atacado: a partir de ${dados.atacado.quantidade} un ${reais(dados.atacado.preco)}`;
    linhas.push(campo(xMm, y, fAtacado, limpar(texto)));
    y += fAtacado * 1.3 + 0.4;
  }

  // Código de barras: EAN-13 quando o código é válido; senão Code 128 do código interno.
  const usaEan = dados.ean !== null && /^\d{13}$/.test(dados.ean) && eanValido(dados.ean);
  const dadoBarra = usaEan ? (dados.ean as string) : limpar(dados.codigo);
  const yRodape = A - 3.0;
  const reservaInterpretacao = usaEan ? 2.8 : 0.5;
  const hBarras = Math.max(4, yRodape - reservaInterpretacao - y - 0.3);
  // Largura do módulo (mm): cabe na etiqueta, nunca acima de 0,33 mm (padrão EAN).
  const modulos = usaEan ? 113 : 11 * (dadoBarra.length + 3) + 30;
  const modMm = Math.max(0.19, Math.min(0.33, util / modulos));
  const modDots = Math.max(1, Math.min(10, pt(modMm)));
  linhas.push(`^BY${modDots}`);
  linhas.push(
    usaEan
      ? `^FO${pt(xMm)},${pt(y)}^BEN,${pt(hBarras)},Y,N^FD${dadoBarra}^FS`
      : `^FO${pt(xMm)},${pt(y)}^BCN,${pt(hBarras)},Y,N,N^FD${dadoBarra}^FS`,
  );

  // Rodapé: código interno à esquerda, data à direita.
  linhas.push(campo(xMm, yRodape, 2.2, limpar(dados.codigo)));
  linhas.push(
    `^FO${pt(xMm)},${pt(yRodape)}^A0N,${pt(2.2)},${pt(2.2)}^FB${pt(util)},1,0,R,0^FD${limpar(dados.data)}^FS`,
  );

  linhas.push('^XZ');
  return linhas.join('\n');
}
