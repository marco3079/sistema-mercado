import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { CHAVE_LOJA, baixarArquivo } from '../../lib/api';
import { hojeIso, mensagemErro } from '../../lib/mercado';
import { pedirSenhaDoGestor } from '../../lib/senhaGestor';
import { Aviso, Botao, Modal, Tabela, Selo } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';

// Importação e exportação de produtos por planilha (Excel .xlsx ou CSV).
// A API é do módulo produtos-planilha (servidor). Contrato: ver resposta ResultadoImportacao abaixo.

const CHAVE_TOKEN = 'mercado.token';
const CHAVE_USUARIO = 'mercado.usuario';
const LIMITE_BYTES = 10 * 1024 * 1024;

interface LinhaImportacao {
  linha: number;
  acao: 'criar' | 'atualizar' | 'igual' | 'erro';
  codigo: string | null;
  nome: string;
  mudancas: string[];
  mensagem: string | null;
}

interface ResultadoImportacao {
  simulado: boolean;
  total: number;
  criar: number;
  atualizar: number;
  iguais: number;
  erros: number;
  categoriasNovas: string[];
  linhas: LinhaImportacao[];
}

type Filtro = 'todos' | 'erro' | 'criar' | 'atualizar';
type Passo = 'escolher' | 'conferido' | 'feito';

// Campo da planilha → rótulo em português, para a coluna Detalhe.
const ROTULO_CAMPO: Record<string, string> = {
  nome: 'nome',
  codigo: 'código',
  ean: 'EAN',
  categoria: 'categoria',
  unidade: 'unidade',
  precoCusto: 'preço de custo',
  precoVenda: 'preço de venda',
  estoqueMinimo: 'estoque mínimo',
  estoqueLoja: 'estoque na loja',
  ncm: 'NCM',
  cfop: 'CFOP',
  csosn: 'CSOSN',
  ativo: 'situação',
};

// Troca o nome técnico do campo (no início do texto) pelo rótulo. Texto sem campo conhecido fica como veio.
function traduzirMudanca(texto: string): string {
  for (const campo of Object.keys(ROTULO_CAMPO)) {
    if (texto === campo || texto.startsWith(campo + ':') || texto.startsWith(campo + ' ')) {
      return ROTULO_CAMPO[campo] + texto.slice(campo.length);
    }
  }
  return texto;
}

// Envia a planilha (corpo = o próprio arquivo). Se o servidor pedir a senha do gestor, pede e repete a mesma requisição.
async function enviarPlanilha(arquivo: File, simular: boolean, senha?: string): Promise<ResultadoImportacao> {
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'x-nome-arquivo': encodeURIComponent(arquivo.name),
  };
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (token) cabecalhos['Authorization'] = `Bearer ${token}`;
  const loja = localStorage.getItem(CHAVE_LOJA);
  if (loja) cabecalhos['x-loja-id'] = loja;
  // A senha vai só neste cabeçalho, na repetição da mesma requisição.
  if (senha) cabecalhos['x-senha-gestor'] = senha;

  const resposta = await fetch('/api/produtos-planilha/importar' + (simular ? '?simular=1' : ''), {
    method: 'POST',
    headers: cabecalhos,
    body: arquivo,
  });

  let dados: { erro?: string; detalhes?: { codigo?: string; acao?: string } | null } | null = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (resposta.ok) return dados as unknown as ResultadoImportacao;

  if (resposta.status === 401) {
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_USUARIO);
    window.location.assign('/login');
    throw new Error('Sessão expirada. Entre de novo.');
  }
  if (resposta.status === 403 && dados?.detalhes?.codigo === 'SENHA_GESTOR') {
    const nova = await pedirSenhaDoGestor(dados.detalhes.acao ?? '', senha ? dados.erro : undefined);
    if (nova === null) throw new Error('Importação cancelada');
    return enviarPlanilha(arquivo, simular, nova);
  }
  throw new Error(dados?.erro ?? 'Erro inesperado');
}

// Baixa a exportação atual (soAtivos: só os produtos ativos da situação filtrada).
export function exportarProdutos(soAtivos: boolean): Promise<void> {
  return baixarArquivo(
    '/produtos-planilha/exportar' + (soAtivos ? '?ativos=1' : ''),
    `produtos-${hojeIso()}.xlsx`,
  );
}

// Baixa a planilha em branco com as colunas certas.
export function baixarModeloProdutos(): Promise<void> {
  return baixarArquivo('/produtos-planilha/modelo', 'modelo-produtos.xlsx');
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Cartão de número do resumo (mesmo padrão das telas de número do topo).
function Contagem({ rotulo, valor, cor, icone }: { rotulo: string; valor: number; cor: string; icone: NomeIcone }) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`}>
        <Icone nome={icone} tamanho={22} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

const ROTULO_ACAO: Record<LinhaImportacao['acao'], { cor: 'verde' | 'azul' | 'cinza' | 'vermelho'; rotulo: string }> = {
  criar: { cor: 'verde', rotulo: 'Novo' },
  atualizar: { cor: 'azul', rotulo: 'Atualizar' },
  igual: { cor: 'cinza', rotulo: 'Sem mudança' },
  erro: { cor: 'vermelho', rotulo: 'Erro' },
};

export function ModalImportarProdutos({
  aberto,
  soAtivos,
  aoFechar,
  aoConcluir,
}: {
  aberto: boolean;
  soAtivos: boolean; // situação filtrada na tela (base da exportação do passo 1)
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void; // chamado ao fechar depois de importar
}) {
  const [passo, setPasso] = useState<Passo>('escolher');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [simulado, setSimulado] = useState<ResultadoImportacao | null>(null);
  const [real, setReal] = useState<ResultadoImportacao | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  // Começa do zero toda vez que a janela abre.
  useEffect(() => {
    if (!aberto) return;
    setPasso('escolher');
    setArquivo(null);
    setSimulado(null);
    setReal(null);
    setFiltro('todos');
    setOcupado(null);
    setErro(null);
    setArrastando(false);
  }, [aberto]);

  // Fechar depois de importar avisa a tela (que recarrega a lista); antes, só fecha.
  function fechar() {
    if (passo === 'feito' && real) {
      aoConcluir(`Planilha importada: ${real.criar} produto(s) novo(s) e ${real.atualizar} atualizado(s).`);
    }
    aoFechar();
  }

  async function escolherArquivo(f: File | undefined | null) {
    if (!f) return;
    const extensao = f.name.toLowerCase().split('.').pop() ?? '';
    if (extensao === 'xls') {
      setErro("Formato .xls antigo não é aceito. No Excel, use 'Salvar como' → Pasta de Trabalho do Excel (.xlsx) ou CSV.");
      return;
    }
    if (extensao !== 'xlsx' && extensao !== 'csv') {
      setErro('Escolha um arquivo .xlsx (Excel) ou .csv.');
      return;
    }
    if (f.size > LIMITE_BYTES) {
      setErro('O arquivo passa de 10 MB. Divida a planilha em partes menores.');
      return;
    }
    setErro(null);
    setArquivo(f);
    setOcupado('Conferindo a planilha...');
    try {
      const r = await enviarPlanilha(f, true);
      setSimulado(r);
      setFiltro('todos');
      setPasso('conferido');
    } catch (e) {
      setArquivo(null);
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function importar() {
    if (!arquivo) return;
    setErro(null);
    setOcupado('Importando...');
    try {
      const r = await enviarPlanilha(arquivo, false);
      setReal(r);
      setPasso('feito');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function baixarModelo() {
    setErro(null);
    try {
      await baixarModeloProdutos();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function exportarAtual() {
    setErro(null);
    try {
      await exportarProdutos(soAtivos);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    if (ocupado) return;
    escolherArquivo(e.dataTransfer.files[0]);
  }

  function trocarArquivo() {
    setPasso('escolher');
    setArquivo(null);
    setSimulado(null);
    setErro(null);
  }

  const linhas = simulado?.linhas ?? [];
  const linhasFiltradas = linhas.filter((l) => {
    if (filtro === 'todos') return true;
    return l.acao === filtro;
  });
  const quantosAFazer = simulado ? simulado.criar + simulado.atualizar : 0;

  const colunas: ColunaTabela<LinhaImportacao>[] = [
    {
      titulo: 'Produto',
      celula: (l) => (
        <CelulaProduto
          foto={null}
          nome={l.nome || '(sem nome)'}
          detalhe={`linha ${l.linha} · ${l.codigo ?? 'sem código'}`}
        />
      ),
    },
    {
      titulo: 'Ação',
      celula: (l) => <Selo cor={ROTULO_ACAO[l.acao].cor}>{ROTULO_ACAO[l.acao].rotulo}</Selo>,
    },
    {
      titulo: 'Detalhe',
      celula: (l) => {
        if (l.acao === 'erro') return <span className="planilha-erro-texto">{l.mensagem ?? 'Linha inválida.'}</span>;
        if (l.acao === 'atualizar' && l.mudancas.length > 0) return l.mudancas.map(traduzirMudanca).join(', ');
        return '—';
      },
    },
  ];

  return (
    <Modal aberto={aberto} titulo="Importar produtos" aoFechar={fechar}>
      <div className="planilha-modal">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {passo === 'escolher' && (
          <>
            <div
              className={arrastando ? 'planilha-soltar arrastando' : 'planilha-soltar'}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={soltar}
            >
              <span className="planilha-soltar-icone">
                <Icone nome="documento" tamanho={28} />
              </span>
              <p className="planilha-soltar-titulo">Solte a planilha aqui</p>
              <p className="planilha-soltar-texto">Planilha do Excel (.xlsx) ou CSV, até 10 MB</p>
              <Botao variante="secundario" desabilitado={Boolean(ocupado)} aoClicar={() => inputArquivo.current?.click()}>
                {ocupado ?? 'Escolher arquivo'}
              </Botao>
              <input
                ref={inputArquivo}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  escolherArquivo(f);
                }}
              />
            </div>

            <p className="planilha-ajuda">
              <span className="planilha-ajuda-item">
                Não tem a planilha?{' '}
                <Botao variante="texto" aoClicar={baixarModelo}>
                  Baixar modelo
                </Botao>
              </span>
              <span className="planilha-separador" aria-hidden="true">
                ·
              </span>
              <span className="planilha-ajuda-item">
                Use a exportação atual como base:{' '}
                <Botao variante="texto" aoClicar={exportarAtual}>
                  Exportar produtos
                </Botao>
              </span>
            </p>

            <ul className="planilha-dicas">
              <li>Código existente atualiza o produto; sem código, cria um novo.</li>
              <li>Células vazias não apagam o valor atual.</li>
              <li>Categorias que não existem são criadas.</li>
            </ul>
          </>
        )}

        {passo === 'conferido' && simulado && (
          <>
            <p className="planilha-arquivo">
              <Icone nome="documento" tamanho={16} /> {arquivo?.name} · {tamanhoLegivel(arquivo?.size ?? 0)}
            </p>

            {ocupado && (
              <div className="carregando" role="status" aria-live="polite">
                {ocupado}
              </div>
            )}

            <div className="resumo">
              <Contagem rotulo="Novos" valor={simulado.criar} cor="verde" icone="mais-circulo" />
              <Contagem rotulo="Atualizados" valor={simulado.atualizar} cor="azul" icone="lapis" />
              <div className="resumo-item">
                <span className="resumo-icone planilha-icone-cinza">
                  <Icone nome="visto" tamanho={22} />
                </span>
                <div>
                  <span className="resumo-valor">{simulado.iguais}</span>
                  <span className="resumo-rotulo">Sem mudança</span>
                </div>
              </div>
              <Contagem rotulo="Com erro" valor={simulado.erros} cor="vermelho" icone="fechar" />
            </div>

            {simulado.categoriasNovas.length > 0 && (
              <Aviso tipo="info">Categorias novas que serão criadas: {simulado.categoriasNovas.join(', ')}</Aviso>
            )}

            <div className="planilha-pilulas" role="group" aria-label="Filtrar linhas">
              {(
                [
                  { id: 'todos', rotulo: 'Todos', n: linhas.length },
                  { id: 'erro', rotulo: 'Com erro', n: simulado.erros },
                  { id: 'criar', rotulo: 'Novos', n: simulado.criar },
                  { id: 'atualizar', rotulo: 'Atualizados', n: simulado.atualizar },
                ] as { id: Filtro; rotulo: string; n: number }[]
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={filtro === p.id ? 'planilha-pilula ativo' : 'planilha-pilula'}
                  aria-pressed={filtro === p.id}
                  onClick={() => setFiltro(p.id)}
                >
                  {p.rotulo}
                  <span className="planilha-pilula-contagem">{p.n}</span>
                </button>
              ))}
            </div>

            <Tabela
              colunas={colunas}
              dados={linhasFiltradas}
              chave={(l) => l.linha}
              porPagina={10}
              idVisao="produtos-importar"
              vazio="Nenhuma linha nesse filtro."
            />

            <div className="planilha-rodape">
              <Botao variante="texto" desabilitado={Boolean(ocupado)} aoClicar={trocarArquivo}>
                Trocar arquivo
              </Botao>
              <div className="planilha-rodape-acoes">
                <Botao variante="secundario" aoClicar={fechar}>
                  Cancelar
                </Botao>
                <Botao desabilitado={quantosAFazer === 0 || Boolean(ocupado)} aoClicar={importar}>
                  {`Importar ${quantosAFazer} ${quantosAFazer === 1 ? 'produto' : 'produtos'}`}
                </Botao>
              </div>
              {simulado.erros > 0 && (
                <p className="planilha-aviso-linhas">
                  {simulado.erros === 1 ? 'A linha com erro será ignorada.' : `As ${simulado.erros} linhas com erro serão ignoradas.`}
                </p>
              )}
            </div>
          </>
        )}

        {passo === 'feito' && real && (
          <div className="planilha-feito">
            <span className="planilha-feito-icone">
              <Icone nome="visto" tamanho={32} />
            </span>
            <p>
              {real.criar} {real.criar === 1 ? 'produto novo' : 'produtos novos'} e {real.atualizar}{' '}
              {real.atualizar === 1 ? 'atualizado' : 'atualizados'}.
            </p>
            <Botao aoClicar={fechar}>Fechar</Botao>
          </div>
        )}
      </div>
    </Modal>
  );
}
