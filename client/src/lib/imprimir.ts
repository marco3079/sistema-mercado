// Impressão pelo navegador, no formato de bobina (80 mm). Funciona com qualquer impressora instalada no
// computador, inclusive as térmicas de caixa: basta escolhê-la na janela de impressão.
// Para imprimir sem a janela aparecer, abra o navegador em modo quiosque de impressão
// (no Chrome e no Edge: opção --kiosk-printing) com a impressora térmica como padrão.

export const ESTILO_BOBINA = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; color: #000; }
  h1 { margin: 0 0 2px; font-size: 16px; text-align: center; }
  h2 { margin: 6px 0 2px; font-size: 22px; text-align: center; }
  p { margin: 2px 0; }
  .centro { text-align: center; }
  .linha { border-top: 1px dashed #000; margin: 6px 0; }
  .par { display: flex; justify-content: space-between; gap: 8px; }
  .par span:last-child { white-space: nowrap; }
  .item { font-size: 15px; font-weight: 700; margin: 4px 0 0; }
  .nota { margin: 0 0 2px 22px; font-size: 13px; }
  .destaque { font-size: 15px; font-weight: 700; }
  .obs { border: 1px solid #000; padding: 4px; margin: 6px 0; font-size: 13px; font-weight: 700; }
  .pequeno { font-size: 11px; }
  .opcoes { margin: 0 0 2px 22px; font-size: 13px; font-weight: 700; }
  .opcoes-leve { margin: -1px 0 3px 12px; font-size: 11px; }
`;

export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dataHora(iso: string | Date): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Imprime um trecho de HTML num quadro escondido (não abre janela nova, então não é bloqueado como pop-up).
// `estilo` troca o CSS da bobina (ex.: etiquetas de gôndola em folha A4).
export function imprimirHtml(titulo: string, corpo: string, estilo?: string): void {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(quadro);
  const janela = quadro.contentWindow;
  const documento = quadro.contentDocument;
  if (!janela || !documento) {
    quadro.remove();
    return;
  }
  documento.open();
  documento.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title><style>${estilo ?? ESTILO_BOBINA}</style></head><body>${corpo}</body></html>`,
  );
  documento.close();
  const remover = () => window.setTimeout(() => quadro.remove(), 1000);
  janela.onafterprint = remover;
  // Dá tempo de o navegador montar o quadro antes de chamar a impressão.
  window.setTimeout(() => {
    janela.focus();
    janela.print();
    // Navegadores que não avisam o fim da impressão: remove depois de um tempo.
    window.setTimeout(() => quadro.remove(), 60000);
  }, 150);
}
