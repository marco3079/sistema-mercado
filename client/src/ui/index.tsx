import { useEffect, useState } from 'react';
import { Icone } from './icones';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import './estilo.css';
import './foto-produto.css'; // classes gerais: .numero, .acoes-linha, .grade-produtos, .barra-nivel

// ---------- Formatação ----------

function partesDaData(iso: string): { ano: number; mes: number; dia: number } | null {
  if (!iso) return null;

  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const meiaNoiteUtc = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(\.000)?Z$/.exec(iso);
  const casamento = soData ?? meiaNoiteUtc;
  if (casamento) {
    return {
      ano: Number(casamento[1]),
      mes: Number(casamento[2]),
      dia: Number(casamento[3]),
    };
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { ano: d.getFullYear(), mes: d.getMonth() + 1, dia: d.getDate() };
}

export function paraInputData(iso: string): string {
  const p = partesDaData(iso);
  if (!p) return '';
  const ano = String(p.ano).padStart(4, '0');
  const mes = String(p.mes).padStart(2, '0');
  const dia = String(p.dia).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function formatarData(iso: string): string {
  const p = partesDaData(iso);
  if (!p) return '';
  const ano = String(p.ano).padStart(4, '0');
  const mes = String(p.mes).padStart(2, '0');
  const dia = String(p.dia).padStart(2, '0');
  return `${dia}/${mes}/${ano}`;
}

export function formatarDataHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatarMoeda(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

// ---------- Estrutura de página ----------

export function Pagina({
  titulo,
  acoes,
  children,
}: {
  titulo: string;
  acoes?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="pagina">
      <header className="pagina-cabecalho">
        <h1>{titulo}</h1>
        {acoes && <div className="pagina-acoes">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}

export function Cartao({ titulo, children }: { titulo?: string; children?: ReactNode }) {
  return (
    <section className="cartao">
      {titulo && <h2 className="cartao-titulo">{titulo}</h2>}
      {children}
    </section>
  );
}

export function Grade({ children }: { children?: ReactNode }) {
  return <div className="grade">{children}</div>;
}

// ---------- Botões e avisos ----------

export function Botao({
  variante = 'primario',
  tipo = 'button',
  desabilitado,
  aoClicar,
  children,
}: {
  variante?: 'primario' | 'secundario' | 'perigo' | 'texto';
  tipo?: 'button' | 'submit';
  desabilitado?: boolean;
  aoClicar?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type={tipo}
      className={`botao botao-${variante}`}
      disabled={desabilitado}
      onClick={aoClicar}
    >
      {children}
    </button>
  );
}

export function Selo({
  cor = 'cinza',
  children,
}: {
  cor?: 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';
  children?: ReactNode;
}) {
  return <span className={`selo selo-${cor}`}>{children}</span>;
}

export function Aviso({
  tipo = 'info',
  children,
}: {
  tipo?: 'erro' | 'sucesso' | 'info';
  children?: ReactNode;
}) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Carregando() {
  return (
    <div className="carregando" role="status" aria-live="polite">
      Carregando...
    </div>
  );
}

// ---------- Tabela (cartões no celular) ----------

export interface ColunaTabela<T> {
  titulo: string;
  celula: (item: T) => ReactNode;
  // Alinhamento do cabeçalho e das células. Sem valor, a coluna segue o padrão (esquerda).
  alinhar?: 'esquerda' | 'direita' | 'centro';
  // Coluna de ações (menu de três pontos): alinhada à direita, largura mínima, sem título visível.
  // O clique dentro dela não dispara aoClicarLinha. No cartão do celular fica no fim, sem rótulo.
  acoes?: boolean;
}

// Impede que o clique numa célula de ações chegue à linha (aoClicarLinha).
function naoPropagar(e: ReactMouseEvent) {
  e.stopPropagation();
}

function classeDaCelula<T>(c: ColunaTabela<T>): string | undefined {
  if (c.acoes) return 'tabela-coluna-acoes';
  if (c.alinhar) return `tabela-alinhar-${c.alinhar}`;
  return undefined;
}

type VisaoTabela = 'tabela' | 'cartoes';

const CHAVE_VISAO = 'mercado.visao.';

function lerVisao(id: string, padrao: VisaoTabela): VisaoTabela {
  try {
    const v = localStorage.getItem(CHAVE_VISAO + id);
    return v === 'tabela' || v === 'cartoes' ? v : padrao;
  } catch {
    return padrao;
  }
}

// Números de página a mostrar: primeira, última, a atual e vizinhas; null = reticências.
function paginasVisiveis(atual: number, total: number): (number | null)[] {
  const conjunto = new Set<number>([1, total, atual - 1, atual, atual + 1]);
  const lista = [...conjunto].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const saida: (number | null)[] = [];
  lista.forEach((n, i) => {
    if (i > 0 && n - lista[i - 1] > 1) saida.push(null);
    saida.push(n);
  });
  return saida;
}

// Tabela padrão do sistema: no computador, o usuário escolhe ver em tabela ou em cartões
// (a escolha fica guardada por tela); no celular são sempre cartões. Paginação de `porPagina`
// itens (padrão 10; 0 desliga). A primeira coluna vira o título do cartão.
export function Tabela<T>({
  colunas,
  dados,
  chave,
  vazio,
  aoClicarLinha,
  porPagina = 10,
  visaoPadrao = 'tabela',
  idVisao,
}: {
  colunas: ColunaTabela<T>[];
  dados: T[];
  chave: (item: T) => string | number;
  vazio?: string;
  aoClicarLinha?: (item: T) => void;
  porPagina?: number;
  visaoPadrao?: VisaoTabela;
  idVisao?: string; // chave para lembrar a visão; padrão: endereço da tela
}) {
  const id = idVisao ?? (typeof window !== 'undefined' ? window.location.pathname : 'tabela');
  const [visao, setVisao] = useState<VisaoTabela>(() => lerVisao(id, visaoPadrao));
  const [pagina, setPagina] = useState(1);

  const totalPaginas = porPagina > 0 ? Math.max(1, Math.ceil(dados.length / porPagina)) : 1;
  // Se a lista encolher (filtro, busca), volta para uma página que exista.
  useEffect(() => {
    if (pagina > totalPaginas) setPagina(totalPaginas);
  }, [pagina, totalPaginas]);

  if (dados.length === 0) {
    return <p className="tabela-vazia">{vazio ?? 'Nenhum registro encontrado.'}</p>;
  }

  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = porPagina > 0 ? (paginaAtual - 1) * porPagina : 0;
  const visiveis = porPagina > 0 ? dados.slice(inicio, inicio + porPagina) : dados;

  function trocarVisao(v: VisaoTabela) {
    setVisao(v);
    try {
      localStorage.setItem(CHAVE_VISAO + id, v);
    } catch {
      // sem armazenamento: vale só nesta tela
    }
  }

  // No cartão: a primeira coluna é o título; a coluna de ações vai para o fim, sem rótulo.
  const semAcoes = colunas.filter((c) => !c.acoes);
  const colunaTitulo = semAcoes[0];
  const demais = semAcoes.slice(1);
  const colunasAcoes = colunas.filter((c) => c.acoes);

  return (
    <div className="tabela-bloco">
      <div className="tabela-topo">
        <span className="tabela-contagem">
          {dados.length} {dados.length === 1 ? 'registro' : 'registros'}
        </span>
        <div className="tabela-visao" role="group" aria-label="Forma de exibir">
          <button
            type="button"
            className={visao === 'tabela' ? 'tabela-visao-botao ativo' : 'tabela-visao-botao'}
            aria-pressed={visao === 'tabela'}
            title="Ver em tabela"
            onClick={() => trocarVisao('tabela')}
          >
            <Icone nome="lista" tamanho={16} />
            <span>Tabela</span>
          </button>
          <button
            type="button"
            className={visao === 'cartoes' ? 'tabela-visao-botao ativo' : 'tabela-visao-botao'}
            aria-pressed={visao === 'cartoes'}
            title="Ver em cartões"
            onClick={() => trocarVisao('cartoes')}
          >
            <Icone nome="grade" tamanho={16} />
            <span>Cartões</span>
          </button>
        </div>
      </div>

      {visao === 'tabela' && (
        <div className="tabela-desktop">
          <table className="tabela">
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th key={c.titulo} scope="col" className={classeDaCelula(c)}>
                    {c.acoes ? <span className="tabela-oculto-visual">{c.titulo}</span> : c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((item) => (
                <tr
                  key={chave(item)}
                  className={aoClicarLinha ? 'clicavel' : undefined}
                  onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
                >
                  {colunas.map((c) => (
                    <td key={c.titulo} className={classeDaCelula(c)} onClick={c.acoes ? naoPropagar : undefined}>
                      {c.celula(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className={visao === 'cartoes' ? 'tabela-cartoes tabela-cartoes-grade' : 'tabela-cartoes'}>
        {visiveis.map((item) => (
          <li
            key={chave(item)}
            className={aoClicarLinha ? 'tabela-cartao clicavel' : 'tabela-cartao'}
            onClick={aoClicarLinha ? () => aoClicarLinha(item) : undefined}
          >
            {colunaTitulo && <div className="tabela-cartao-titulo">{colunaTitulo.celula(item)}</div>}
            <div className="tabela-cartao-pares">
              {demais.map((c) => (
                <div className="tabela-par" key={c.titulo}>
                  <span className="tabela-par-titulo">{c.titulo}</span>
                  <span className="tabela-par-valor">{c.celula(item)}</span>
                </div>
              ))}
            </div>
            {colunasAcoes.map((c) => (
              <div className="tabela-par-acoes" key={c.titulo} onClick={naoPropagar}>
                {c.celula(item)}
              </div>
            ))}
          </li>
        ))}
      </ul>

      {porPagina > 0 && totalPaginas > 1 && (
        <nav className="paginacao" aria-label="Paginação">
          <span className="paginacao-info">
            {inicio + 1}–{Math.min(inicio + porPagina, dados.length)} de {dados.length}
          </span>
          <div className="paginacao-botoes">
            <button
              type="button"
              className="paginacao-botao"
              disabled={paginaAtual === 1}
              aria-label="Página anterior"
              onClick={() => setPagina(paginaAtual - 1)}
            >
              <Icone nome="seta-esquerda" tamanho={16} />
            </button>
            {paginasVisiveis(paginaAtual, totalPaginas).map((n, i) =>
              n === null ? (
                <span key={'r' + i} className="paginacao-reticencias">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  className={n === paginaAtual ? 'paginacao-botao ativo' : 'paginacao-botao'}
                  aria-current={n === paginaAtual ? 'page' : undefined}
                  onClick={() => setPagina(n)}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              className="paginacao-botao"
              disabled={paginaAtual === totalPaginas}
              aria-label="Próxima página"
              onClick={() => setPagina(paginaAtual + 1)}
            >
              <Icone nome="seta-direita" tamanho={16} />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

// ---------- Avatar ----------

// Iniciais: primeira letra do primeiro e do último nome.
function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

// Círculo com a foto do usuário ou, sem foto (ou se a imagem falhar), as iniciais do nome.
// Decorativo (aria-hidden): o nome deve aparecer em texto ao lado quando for preciso.
export function Avatar({
  nome,
  foto,
  tamanho = 40,
  className,
}: {
  nome: string;
  foto?: string | null;
  tamanho?: number;
  className?: string;
}) {
  // Guarda a foto que falhou: uma foto nova volta a tentar sem precisar de efeito.
  const [fotoFalhou, setFotoFalhou] = useState<string | null>(null);
  const mostrarFoto = Boolean(foto) && fotoFalhou !== foto;

  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      style={{ width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.36) }}
      aria-hidden="true"
    >
      {mostrarFoto ? (
        <img
          src={foto ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFotoFalhou(foto ?? null)}
        />
      ) : (
        iniciaisDoNome(nome)
      )}
    </span>
  );
}

// ---------- Campos de formulário ----------

export function Campo({
  rotulo,
  valor,
  aoMudar,
  tipo = 'text',
  obrigatorio,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  tipo?: 'text' | 'email' | 'password' | 'number' | 'date' | 'time' | 'datetime-local' | 'search';
  obrigatorio?: boolean;
  placeholder?: string; // texto de exemplo dentro do campo (ex.: "Buscar por nome, código ou EAN")
}) {
  return (
    <label className="campo">
      <span className="campo-rotulo">
        {rotulo}
        {obrigatorio && ' *'}
      </span>
      <input
        className="campo-controle"
        type={tipo}
        value={valor}
        required={obrigatorio}
        placeholder={placeholder}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </label>
  );
}

export function AreaTexto({
  rotulo,
  valor,
  aoMudar,
  linhas = 4,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  linhas?: number;
}) {
  return (
    <label className="campo">
      <span className="campo-rotulo">{rotulo}</span>
      <textarea
        className="campo-controle"
        rows={linhas}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </label>
  );
}

export function Selecao({
  rotulo,
  valor,
  aoMudar,
  opcoes,
  vazio,
  obrigatorio,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  opcoes: { valor: string; rotulo: string }[];
  vazio?: string;
  obrigatorio?: boolean;
}) {
  return (
    <label className="campo">
      <span className="campo-rotulo">
        {rotulo}
        {obrigatorio && ' *'}
      </span>
      <select
        className="campo-controle"
        value={valor}
        required={obrigatorio}
        onChange={(e) => aoMudar(e.target.value)}
      >
        <option value="">{vazio ?? 'Selecione'}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Caixa({
  rotulo,
  marcado,
  aoMudar,
}: {
  rotulo: string;
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
}) {
  return (
    <label className="caixa">
      <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      <span>{rotulo}</span>
    </label>
  );
}

// ---------- Modal e abas ----------

export function Modal({
  aberto,
  titulo,
  aoFechar,
  children,
}: {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children?: ReactNode;
}) {
  if (!aberto) return null;
  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-cabecalho">
          <h2>{titulo}</h2>
          <button type="button" className="modal-fechar" aria-label="Fechar" onClick={aoFechar}>
            ×
          </button>
        </header>
        <div className="modal-corpo">{children}</div>
      </div>
    </div>
  );
}

export function Abas({
  abas,
  ativa,
  aoMudar,
}: {
  abas: { id: string; rotulo: string }[];
  ativa: string;
  aoMudar: (id: string) => void;
}) {
  return (
    <nav className="abas" role="tablist">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={a.id === ativa}
          className={a.id === ativa ? 'aba aba-ativa' : 'aba'}
          onClick={() => aoMudar(a.id)}
        >
          {a.rotulo}
        </button>
      ))}
    </nav>
  );
}

// ---------- Menu de ações (reexportado para os outros módulos) ----------
// Não há importação circular: MenuAcoes importa só ui/icones, não este arquivo.

export { MenuAcoes } from '../modules/cadastros/MenuAcoes';
export type { AcaoMenu } from '../modules/cadastros/MenuAcoes';
