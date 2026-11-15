// Recebe os arquivos enviados pela tela de migração: pacote de vários arquivos, .zip ou um arquivo só.
// Formato do pacote (montado pelo navegador): cabeçalho "MERCADO-ARQUIVOS/1\n" e, para cada arquivo,
// "<nome em encodeURIComponent>\t<tamanho em bytes>\n<bytes do arquivo>", sem separador depois dos bytes.

import { HttpError } from '../../lib/erros';
import { lerArquivosZip } from '../../lib/planilha';

export interface ArquivoEnviado {
  nome: string;
  conteudo: Buffer;
}

export const CABECALHO_PACOTE = 'MERCADO-ARQUIVOS/1\n';

const CABECALHO_PACOTE_BYTES = Buffer.from(CABECALHO_PACOTE, 'utf8');
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const LIMITE_ARQUIVOS = 10000;

// Confere a assinatura "PK\x03\x04" do início do conteúdo.
function ehZip(conteudo: Buffer): boolean {
  return conteudo.length >= 4 && conteudo.subarray(0, 4).equals(ASSINATURA_ZIP);
}

function pacoteCorrompido(): HttpError {
  return new HttpError(400, 'Pacote de arquivos corrompido');
}

// Percorre o pacote: cada cabeçalho diz o nome e o tamanho do arquivo que vem logo depois.
function lerPacote(corpo: Buffer): ArquivoEnviado[] {
  const arquivos: ArquivoEnviado[] = [];
  let p = CABECALHO_PACOTE_BYTES.length;
  while (p < corpo.length) {
    const fimCabecalho = corpo.indexOf(0x0a, p);
    if (fimCabecalho < 0) throw pacoteCorrompido();
    const linha = corpo.toString('utf8', p, fimCabecalho);
    const tab = linha.lastIndexOf('\t');
    if (tab < 0) throw pacoteCorrompido();
    const tamanhoTexto = linha.slice(tab + 1);
    if (!/^\d+$/.test(tamanhoTexto)) throw pacoteCorrompido();
    const tamanho = Number(tamanhoTexto);
    let nome: string;
    try {
      nome = decodeURIComponent(linha.slice(0, tab));
    } catch {
      throw pacoteCorrompido();
    }
    const inicio = fimCabecalho + 1;
    const fim = inicio + tamanho;
    if (fim > corpo.length) throw pacoteCorrompido();
    arquivos.push({ nome, conteudo: corpo.subarray(inicio, fim) });
    p = fim;
  }
  return arquivos;
}

// Lista de arquivos enviados. Pacote do navegador, .zip ou arquivo único; .zip dentro da lista é aberto um nível.
export function lerArquivosEnviados(corpo: Buffer, nomeArquivo?: string): ArquivoEnviado[] {
  let arquivos: ArquivoEnviado[];
  if (corpo.subarray(0, CABECALHO_PACOTE_BYTES.length).equals(CABECALHO_PACOTE_BYTES)) {
    arquivos = lerPacote(corpo);
  } else if (ehZip(corpo)) {
    arquivos = lerArquivosZip(corpo);
  } else {
    arquivos = [{ nome: nomeArquivo ?? 'arquivo', conteudo: corpo }];
  }

  const saida: ArquivoEnviado[] = [];
  for (const arq of arquivos) {
    if (ehZip(arq.conteudo)) saida.push(...lerArquivosZip(arq.conteudo));
    else saida.push(arq);
  }
  if (saida.length > LIMITE_ARQUIVOS) throw new HttpError(400, 'Arquivos demais (máximo 10.000)');
  return saida;
}
