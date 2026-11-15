import { CHAVE_LOJA } from '../../lib/api';

const CHAVE_TOKEN = 'mercado.token';
const CHAVE_USUARIO = 'mercado.usuario';

// Formato lido pelo servidor em migracao/arquivos.ts (vários arquivos num corpo só).
export const CABECALHO_PACOTE = 'MERCADO-ARQUIVOS/1\n';

// Monta o pacote de vários arquivos: cabeçalho + (nome\ttamanho\n + bytes) por arquivo.
export async function empacotarArquivos(arquivos: File[]): Promise<Blob> {
  const codificador = new TextEncoder();
  const partes: BlobPart[] = [codificador.encode(CABECALHO_PACOTE)];
  for (const arquivo of arquivos) {
    partes.push(codificador.encode(`${encodeURIComponent(arquivo.name)}\t${arquivo.size}\n`));
    partes.push(arquivo);
  }
  return new Blob(partes, { type: 'application/octet-stream' });
}

// POST cru (corpo = o próprio arquivo). Caminho sem /api.
export async function enviarArquivo<T>(
  caminho: string,
  corpo: Blob,
  nomeArquivo: string,
  extras?: Record<string, string>,
): Promise<T> {
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'x-nome-arquivo': encodeURIComponent(nomeArquivo),
    ...extras,
  };
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (token) cabecalhos['Authorization'] = `Bearer ${token}`;
  const loja = localStorage.getItem(CHAVE_LOJA);
  if (loja) cabecalhos['x-loja-id'] = loja;

  const resposta = await fetch('/api' + caminho, {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });

  let dados: { erro?: string } | null = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    if (resposta.status === 401) {
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_USUARIO);
      window.location.assign('/login');
    }
    throw new Error(dados?.erro ?? 'Erro inesperado');
  }

  return dados as T;
}
