// Leitura simples de NF-e de entrada (XML) por expressões regulares, sem bibliotecas.
// Só extrai o que a conferência precisa. Aceita tags com ou sem prefixo de namespace.

export interface ItemNfe {
  cProd: string;
  cEAN: string | null; // só EAN válido em formato (8 a 14 dígitos); "SEM GTIN" vira null
  xProd: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  lote: string | null; // rastro (lote de medicamento/alimento), quando a nota traz
  validade: Date | null;
}

export interface NotaNfe {
  chave: string | null; // 44 dígitos
  numero: string | null;
  serie: string | null;
  cnpj: string; // emitente, 14 dígitos
  nomeEmitente: string;
  valor: number | null; // vNF
  itens: ItemNfe[];
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(texto: string): string {
  return texto
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, nome: string) => ENTIDADES[nome] ?? '')
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCharCode(Number(codigo)))
    .trim();
}

// Conteúdo da primeira tag com este nome dentro do bloco (com ou sem prefixo de namespace).
function campo(bloco: string, nome: string): string | null {
  const achado = new RegExp(`<(?:\\w+:)?${nome}>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(bloco);
  return achado ? decodificar(achado[1]) : null;
}

// Bloco inteiro de uma tag (ex.: <emit>...</emit>); vazio se não existir.
function bloco(xml: string, nome: string): string {
  const achado = new RegExp(`<(?:\\w+:)?${nome}\\b[\\s\\S]*?</(?:\\w+:)?${nome}>`).exec(xml);
  return achado ? achado[0] : '';
}

// Validade no formato AAAA-MM-DD, gravada ao meio-dia (evita o dia anterior por causa do fuso).
function dataDe(texto: string | null): Date | null {
  if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

function numeroDe(texto: string | null): number | null {
  if (texto === null) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

// Devolve null quando o XML não tem chave de NF-e, emitente com CNPJ ou nenhum item.
export function lerNfe(xml: string): NotaNfe | null {
  const texto = xml.replace(/^﻿/, '');
  const chave =
    /Id="NFe(\d{44})"/.exec(texto)?.[1] ?? /<(?:\w+:)?chNFe>(\d{44})</.exec(texto)?.[1] ?? null;

  const emit = bloco(texto, 'emit');
  const cnpj = (campo(emit, 'CNPJ') ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) return null;

  const ide = bloco(texto, 'ide');
  const total = bloco(texto, 'ICMSTot');
  const detalhes = [...texto.matchAll(/<(?:\w+:)?det\b[\s\S]*?<\/(?:\w+:)?det>/g)].map((m) => m[0]);
  if (detalhes.length === 0) return null;

  const itens: ItemNfe[] = detalhes.map((det) => {
    const prod = bloco(det, 'prod') || det;
    const rastro = bloco(prod, 'rastro');
    const ean = campo(prod, 'cEAN');
    return {
      cProd: campo(prod, 'cProd') ?? '',
      cEAN: ean && /^\d{8,14}$/.test(ean) ? ean : null,
      xProd: campo(prod, 'xProd') ?? '',
      uCom: campo(prod, 'uCom') ?? '',
      qCom: numeroDe(campo(prod, 'qCom')) ?? 0,
      vUnCom: numeroDe(campo(prod, 'vUnCom')) ?? 0,
      lote: campo(rastro, 'nLote') || null,
      validade: dataDe(campo(rastro, 'dVal')),
    };
  });

  return {
    chave,
    numero: campo(ide, 'nNF'),
    serie: campo(ide, 'serie'),
    cnpj,
    nomeEmitente: campo(emit, 'xNome') ?? '',
    valor: numeroDe(campo(total, 'vNF')),
    itens,
  };
}
