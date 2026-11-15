import { useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/mercado';
import { Abas, Aviso, Botao, Caixa, Campo, Modal, Selo } from '../../ui';
import { MAX_ITENS_POR_APLICACAO, ORDEM_ENTIDADES, ROTULOS_ENTIDADE } from './tipos';
import type {
  Decisao,
  Entidade,
  ItemAplicar,
  ItemConferencia,
  LoteMigracao,
  Mudanca,
  ResultadoAplicar,
  ResultadosMigracao,
  ResumoEntidade,
  Situacao,
  ValorSimples,
} from './tipos';

const POR_PAGINA = 50;
const MAX_MUDANCAS_VISIVEIS = 4;

const ROTULO_SITUACAO: Record<Situacao, string> = {
  novo: 'Novo',
  existe: 'Já existe',
  igual: 'Igual',
  erro: 'Erro',
};

const COR_SITUACAO: Record<Situacao, 'verde' | 'amarelo' | 'cinza' | 'vermelho'> = {
  novo: 'verde',
  existe: 'amarelo',
  igual: 'cinza',
  erro: 'vermelho',
};

const CHIPS: {
  situacao: Situacao;
  rotulo: string;
  cor: 'verde' | 'amarelo' | 'cinza' | 'vermelho';
  contar: (r: ResumoEntidade) => number;
}[] = [
  { situacao: 'novo', rotulo: 'Novos', cor: 'verde', contar: (r) => r.novos },
  { situacao: 'existe', rotulo: 'Com diferenças', cor: 'amarelo', contar: (r) => r.existentes },
  { situacao: 'igual', rotulo: 'Iguais', cor: 'cinza', contar: (r) => r.iguais },
  { situacao: 'erro', rotulo: 'Com erro', cor: 'vermelho', contar: (r) => r.erros },
];

type Decisoes = Partial<Record<Entidade, Record<number, Decisao>>>;
type Marcadas = Partial<Record<Entidade, boolean>>;

function formatarValor(v: ValorSimples): string {
  if (v === null || v === undefined || v === '') return 'vazio';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return v.toLocaleString('pt-BR');
  return String(v);
}

function textoMudanca(m: Mudanca): string {
  return `${m.rotulo}: ${formatarValor(m.de)} → ${formatarValor(m.para)}`;
}

function marcacaoInicial(lote: LoteMigracao): Marcadas {
  const marcadas: Marcadas = {};
  for (const e of ORDEM_ENTIDADES) {
    const dados = lote.entidades[e];
    if (dados) marcadas[e] = dados.resumo.novos + dados.resumo.existentes > 0;
  }
  return marcadas;
}

function decisaoDe(decisoes: Decisoes, e: Entidade, indice: number): Decisao {
  return decisoes[e]?.[indice] ?? 'ignorar';
}

// Quanto vai acontecer, só nas entidades marcadas.
function totaisDaImportacao(
  lote: LoteMigracao,
  entidades: Entidade[],
  marcadas: Marcadas,
  decisoes: Decisoes,
): { criar: number; atualizar: number; erros: number } {
  let criar = 0;
  let atualizar = 0;
  let erros = 0;
  for (const e of entidades) {
    if (!marcadas[e]) continue;
    const dados = lote.entidades[e];
    if (!dados) continue;
    for (const it of dados.itens) {
      if (it.situacao === 'novo') criar++;
      else if (it.situacao === 'existe' && decisaoDe(decisoes, e, it.indice) === 'atualizar') atualizar++;
      else if (it.situacao === 'erro') erros++;
    }
  }
  return { criar, atualizar, erros };
}

export function Conferencia(props: {
  lote: LoteMigracao;
  aoVoltar: () => void;
  aoConcluir: (r: ResultadosMigracao) => void;
}) {
  const { lote, aoVoltar, aoConcluir } = props;
  const presentes = ORDEM_ENTIDADES.filter((e) => lote.entidades[e] !== undefined);

  const [ativa, setAtiva] = useState<Entidade>(presentes[0] ?? 'produtos');
  const [marcadas, setMarcadas] = useState<Marcadas>(() => marcacaoInicial(lote));
  const [decisoes, setDecisoes] = useState<Decisoes>({});
  const [filtro, setFiltro] = useState<Situacao | null>(null);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [confirmando, setConfirmando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState<{ rotulo: string; feitos: number; total: number } | null>(null);

  if (presentes.length === 0) {
    return (
      <section className="migracao-conf">
        <header className="migracao-conf-topo">
          <p className="migracao-conf-descricao">{lote.descricao}</p>
          {lote.avisos.length > 0 && (
            <Aviso tipo="info">
              <ul className="migracao-conf-avisos">
                {lote.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Aviso>
          )}
        </header>
        <Aviso tipo="info">Nenhum cadastro encontrado neste arquivo.</Aviso>
        <div className="migracao-conf-botoes">
          <Botao variante="secundario" aoClicar={aoVoltar}>
            Voltar
          </Botao>
        </div>
      </section>
    );
  }

  const dadosAtivos = lote.entidades[ativa];
  const itens: ItemConferencia[] = dadosAtivos?.itens ?? [];
  const resumoAtivo: ResumoEntidade | undefined = dadosAtivos?.resumo;

  const termo = busca.trim().toLowerCase();
  const filtrados = itens.filter(
    (it) =>
      (filtro === null || it.situacao === filtro) &&
      (termo === '' || it.resumo.toLowerCase().includes(termo) || it.origem.toLowerCase().includes(termo)),
  );
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const totais = totaisDaImportacao(lote, presentes, marcadas, decisoes);
  const temExistentes = (resumoAtivo?.existentes ?? 0) > 0;

  function trocarAba(id: string) {
    setAtiva(id as Entidade);
    setFiltro(null);
    setBusca('');
    setPagina(1);
  }

  function alternarFiltro(situacao: Situacao) {
    setFiltro((atual) => (atual === situacao ? null : situacao));
    setPagina(1);
  }

  function definirDecisao(e: Entidade, indice: number, d: Decisao) {
    setDecisoes((prev) => ({ ...prev, [e]: { ...(prev[e] ?? {}), [indice]: d } }));
  }

  function definirDecisoesEmLote(e: Entidade, d: Decisao) {
    const dados = lote.entidades[e];
    if (!dados) return;
    setDecisoes((prev) => {
      const novas: Record<number, Decisao> = { ...(prev[e] ?? {}) };
      for (const it of dados.itens) {
        if (it.situacao === 'existe') novas[it.indice] = d;
      }
      return { ...prev, [e]: novas };
    });
  }

  async function importar() {
    setConfirmando(false);
    setImportando(true);

    const total = totais.criar + totais.atualizar;
    let feitos = 0;
    const resultados: ResultadosMigracao = {};

    for (const e of presentes) {
      const dados = lote.entidades[e];
      // Entidade desmarcada fica de fora: não entra no resultado (nem ignorados, nem erros).
      if (!dados || !marcadas[e]) continue;
      const acc: ResultadoAplicar = { criados: 0, atualizados: 0, ignorados: 0, erros: [] };
      const enviar: ItemAplicar[] = [];

      for (const it of dados.itens) {
        if (it.situacao === 'erro') {
          acc.erros.push({ origem: it.origem, mensagem: it.erros.join('; ') || 'Erro na conferência' });
          continue;
        }
        if (it.situacao === 'igual') {
          acc.ignorados++;
          continue;
        }
        if (it.situacao === 'existe' && decisaoDe(decisoes, e, it.indice) !== 'atualizar') {
          acc.ignorados++;
          continue;
        }
        // Novo: o servidor cria sempre e ignora a decisão. Existente: só chega aqui se for 'atualizar'.
        enviar.push({ origem: it.origem, registro: it.registro, decisao: 'atualizar' });
      }

      setProgresso({ rotulo: ROTULOS_ENTIDADE[e], feitos, total });
      for (let i = 0; i < enviar.length; i += MAX_ITENS_POR_APLICACAO) {
        const lote200 = enviar.slice(i, i + MAX_ITENS_POR_APLICACAO);
        try {
          const r = await api.post<ResultadoAplicar>('/migracao/aplicar', { entidade: e, itens: lote200 });
          acc.criados += r.criados;
          acc.atualizados += r.atualizados;
          acc.ignorados += r.ignorados;
          acc.erros.push(...r.erros);
        } catch (err) {
          const mensagem = mensagemErro(err);
          for (const item of lote200) acc.erros.push({ origem: item.origem, mensagem });
        }
        feitos += lote200.length;
        setProgresso({ rotulo: ROTULOS_ENTIDADE[e], feitos, total });
      }
      resultados[e] = acc;
    }

    aoConcluir(resultados);
  }

  const textoResumo = `Serão criados ${totais.criar.toLocaleString('pt-BR')} e atualizados ${totais.atualizar.toLocaleString(
    'pt-BR',
  )}. ${totais.erros.toLocaleString('pt-BR')} itens com erro ficam de fora.`;
  const nadaAFazer = totais.criar + totais.atualizar === 0;

  return (
    <section className="migracao-conf">
      <header className="migracao-conf-topo">
        <p className="migracao-conf-descricao">{lote.descricao}</p>
        {lote.avisos.length > 0 && (
          <Aviso tipo="info">
            <ul className="migracao-conf-avisos">
              {lote.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Aviso>
        )}
      </header>

      <Abas
        abas={presentes.map((e) => ({
          id: e,
          rotulo: `${ROTULOS_ENTIDADE[e]} (${(lote.entidades[e]?.resumo.total ?? 0).toLocaleString('pt-BR')})`,
        }))}
        ativa={ativa}
        aoMudar={trocarAba}
      />

      <div className="migracao-conf-corpo">
        <div className="migracao-conf-barra-acoes">
          <div className="migracao-conf-chips" role="group" aria-label="Filtrar por situação">
            {CHIPS.map((c) => {
              const ativoChip = filtro === c.situacao;
              return (
                <button
                  key={c.situacao}
                  type="button"
                  className={ativoChip ? 'migracao-conf-chip ativo' : 'migracao-conf-chip'}
                  aria-pressed={ativoChip}
                  disabled={importando}
                  onClick={() => alternarFiltro(c.situacao)}
                >
                  <Selo cor={c.cor}>
                    {c.rotulo}: {resumoAtivo ? c.contar(resumoAtivo).toLocaleString('pt-BR') : '0'}
                  </Selo>
                </button>
              );
            })}
          </div>
          <Caixa
            rotulo={`Importar ${ROTULOS_ENTIDADE[ativa]}`}
            marcado={Boolean(marcadas[ativa])}
            aoMudar={(v) => setMarcadas((m) => ({ ...m, [ativa]: v }))}
          />
        </div>

        <div className="migracao-conf-barra-acoes">
          {temExistentes && (
            <div className="migracao-conf-lote-decisao">
              <span className="migracao-conf-rotulo-lote">Quem já existe:</span>
              <Botao
                variante="secundario"
                desabilitado={importando}
                aoClicar={() => definirDecisoesEmLote(ativa, 'atualizar')}
              >
                Atualizar todos
              </Botao>
              <Botao
                variante="secundario"
                desabilitado={importando}
                aoClicar={() => definirDecisoesEmLote(ativa, 'ignorar')}
              >
                Ignorar todos
              </Botao>
            </div>
          )}
          <div className="migracao-conf-busca">
            <Campo
              rotulo="Buscar"
              tipo="search"
              valor={busca}
              placeholder="Nome, código ou origem"
              aoMudar={(v) => {
                setBusca(v);
                setPagina(1);
              }}
            />
          </div>
        </div>

        {filtrados.length === 0 ? (
          <p className="migracao-conf-vazio">Nenhum item com este filtro.</p>
        ) : (
          <div className="migracao-conf-tabela-bloco">
            <table className="migracao-conf-tabela">
              <thead>
                <tr>
                  <th scope="col">Origem</th>
                  <th scope="col">Item</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Detalhes</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((it) => {
                  const mudancas: Mudanca[] = it.situacao === 'existe' ? it.mudancas : [];
                  const restoMudancas = mudancas.slice(MAX_MUDANCAS_VISIVEIS);
                  return (
                    <tr key={it.indice}>
                      <td className="migracao-conf-origem">{it.origem}</td>
                      <td>{it.resumo}</td>
                      <td>
                        <Selo cor={COR_SITUACAO[it.situacao]}>{ROTULO_SITUACAO[it.situacao]}</Selo>
                      </td>
                      <td className="migracao-conf-detalhes">
                        {it.erros.map((t, i) => (
                          <div key={'e' + i} className="migracao-conf-erro">
                            {t}
                          </div>
                        ))}
                        {it.avisos.map((t, i) => (
                          <div key={'a' + i} className="migracao-conf-aviso-linha">
                            {t}
                          </div>
                        ))}
                        {mudancas.slice(0, MAX_MUDANCAS_VISIVEIS).map((m, i) => (
                          <div key={'m' + i} className="migracao-conf-mudanca">
                            {textoMudanca(m)}
                          </div>
                        ))}
                        {restoMudancas.length > 0 && (
                          <span
                            className="migracao-conf-mais"
                            title={restoMudancas.map(textoMudanca).join('\n')}
                          >
                            +{restoMudancas.length}
                          </span>
                        )}
                      </td>
                      <td>
                        {it.situacao === 'existe' && (
                          <select
                            className="campo-controle migracao-conf-select"
                            aria-label={`Ação para ${it.resumo}`}
                            value={decisaoDe(decisoes, ativa, it.indice)}
                            disabled={importando}
                            onChange={(e) => definirDecisao(ativa, it.indice, e.target.value as Decisao)}
                          >
                            <option value="atualizar">Atualizar</option>
                            <option value="ignorar">Ignorar</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPaginas > 1 && (
          <nav className="migracao-conf-paginacao" aria-label="Paginação">
            <Botao
              variante="secundario"
              desabilitado={paginaAtual === 1}
              aoClicar={() => setPagina(paginaAtual - 1)}
            >
              Anterior
            </Botao>
            <span>
              Página {paginaAtual} de {totalPaginas}
            </span>
            <Botao
              variante="secundario"
              desabilitado={paginaAtual === totalPaginas}
              aoClicar={() => setPagina(paginaAtual + 1)}
            >
              Próxima
            </Botao>
          </nav>
        )}
      </div>

      <footer className="migracao-conf-rodape">
        {importando && progresso && (
          <div className="migracao-conf-progresso">
            <span>
              Importando {progresso.rotulo}: {progresso.feitos.toLocaleString('pt-BR')} de{' '}
              {progresso.total.toLocaleString('pt-BR')}
            </span>
            <div
              className="migracao-conf-barra"
              role="progressbar"
              aria-label="Progresso da importação"
              aria-valuemin={0}
              aria-valuemax={progresso.total}
              aria-valuenow={progresso.feitos}
            >
              <span
                style={{
                  width: `${progresso.total === 0 ? 100 : Math.round((progresso.feitos / progresso.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        {importando && <Aviso tipo="info">Não feche esta página.</Aviso>}
        <div className="migracao-conf-rodape-linha">
          <p className="migracao-conf-resumo">{textoResumo}</p>
          <div className="migracao-conf-botoes">
            <Botao variante="secundario" desabilitado={importando} aoClicar={aoVoltar}>
              Voltar
            </Botao>
            <Botao desabilitado={importando || nadaAFazer} aoClicar={() => setConfirmando(true)}>
              Importar
            </Botao>
          </div>
        </div>
      </footer>

      <Modal aberto={confirmando} titulo="Confirmar importação" aoFechar={() => setConfirmando(false)}>
        <p>Gravar no sistema? Esta ação cria e altera cadastros.</p>
        <div className="migracao-conf-botoes">
          <Botao variante="secundario" aoClicar={() => setConfirmando(false)}>
            Cancelar
          </Botao>
          <Botao aoClicar={() => void importar()}>Gravar</Botao>
        </div>
      </Modal>
    </section>
  );
}
