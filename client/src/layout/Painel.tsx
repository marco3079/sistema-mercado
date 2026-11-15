import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { AtualizacaoDTO } from '../lib/atualizacao';
import { tempoDesde } from '../lib/mercado';
import { assinar, rajada } from '../lib/tempoReal';
import { RAIZ_DO_PERFIL } from '../lib/tipos';
import type { Perfil } from '../lib/tipos';
import { useDados } from '../lib/useDados';
import { Aviso, Carregando, formatarData } from '../ui';
import { Icone } from '../ui/icones';
import type { NomeIcone } from '../ui/icones';
import { GraficoLinha } from './GraficoLinha';
import './painel.css';

// ---------- Contrato de GET /api/painel ----------

type CorCartao = 'azul' | 'roxo' | 'verde' | 'laranja';

interface Cartao {
  rotulo: string;
  valor: string;
  variacao: number | null;
  icone: NomeIcone;
  cor: CorCartao;
}

interface MesVendido {
  mes: string;
  total: number;
}

interface Recente {
  titulo: string;
  subtitulo: string;
  quando: string;
  cor: CorCartao;
  caminho: string;
}

interface Destaque {
  rotulo: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  sufixo: string;
}

interface RespostaPainel {
  perfil: Perfil;
  cartoes: Cartao[];
  vendasPorMes: MesVendido[];
  recentes: Recente[];
  destaque: Destaque | null;
  atalhos: Atalho[];
}

// ---------- Textos por perfil ----------

const SUBTITULOS: Partial<Record<Perfil, string>> = {
  GESTOR: 'Aqui está um resumo do mercado.',
  OPERADOR: 'Aqui está o resumo do seu caixa.',
  ESTOQUISTA: 'Aqui está o resumo do estoque.',
  PADEIRO: 'Aqui está o resumo da produção.',
  COMPRADOR: 'Aqui está o resumo das compras.',
  MOTORISTA: 'Aqui está o resumo das suas entregas.',
  VENDEDOR: 'Aqui está o resumo das suas vendas.',
  CONTADOR: 'Aqui está o resumo fiscal do mês.',
};

const TITULOS_RECENTES: Partial<Record<Perfil, string>> = {
  GESTOR: 'Vendas recentes',
  OPERADOR: 'Vendas do caixa',
  ESTOQUISTA: 'Movimentos recentes',
  PADEIRO: 'Fornadas de hoje',
  COMPRADOR: 'Pedidos de compra',
  MOTORISTA: 'Minhas entregas',
  VENDEDOR: 'Meus pedidos',
  CONTADOR: 'Notas recentes',
};

// Para onde leva o "Ver todos" de cada perfil.
const VER_TODOS: Partial<Record<Perfil, string>> = {
  GESTOR: 'vendas',
  OPERADOR: 'vendas',
  ESTOQUISTA: 'estoque',
  PADEIRO: 'producao',
  COMPRADOR: 'pedidos-compra',
  MOTORISTA: 'entregas',
  VENDEDOR: 'pedidos-venda',
  CONTADOR: 'contador',
};

// Módulos da API que mudam os números do painel; ao mudar, o painel busca os dados de novo.
const MODULOS_DO_PAINEL = ['pdv', 'vendas', 'estoque', 'producao', 'entregas'];

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const PERIODOS: { valor: number; rotulo: string }[] = [
  { valor: 6, rotulo: 'Últimos 6 meses' },
  { valor: 12, rotulo: 'Últimos 12 meses' },
];

function dataPorExtenso(d: Date): string {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function horaCurta(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatarVariacao(variacao: number): string {
  const sinal = variacao >= 0 ? '+' : '-';
  const numero = Math.abs(variacao).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sinal}${numero}%`;
}

function primeiroNomeDe(nome: string | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? '';
}

// ---------- Tela inicial ----------

export function Painel() {
  const { usuario } = useAuth();
  const resumo = useDados<RespostaPainel>('/painel');
  const [agora, setAgora] = useState<Date>(() => new Date());
  const [periodo, setPeriodo] = useState<number>(6);

  // A cada 30 s: acerta o relógio e busca os números de novo (só com a aba visível).
  const { recarregar } = resumo;
  useEffect(() => {
    const id = window.setInterval(() => {
      setAgora(new Date());
      if (document.visibilityState === 'visible') recarregar();
    }, 30000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  // Mudança de venda, estoque, produção ou entrega: busca os números de novo, em rajada.
  useEffect(() => {
    const disparo = rajada(() => recarregar(), 600);
    const parar = assinar((modulo) => {
      if (MODULOS_DO_PAINEL.includes(modulo)) disparo.disparar();
    });
    return () => {
      parar();
      disparo.cancelar();
    };
  }, [recarregar]);

  const dados = resumo.dados;
  const perfil = usuario?.perfil;
  const primeiroNome = primeiroNomeDe(usuario?.nome);
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';
  const raiz = perfil ? RAIZ_DO_PERFIL[perfil] : '/gestor';
  // O gráfico de vendas e o aviso de atualização são só do gestor.
  const gestor = perfil === 'GESTOR';
  const atualizacao = useDados<AtualizacaoDTO>(gestor ? '/atualizacao' : null);

  const pontos = dados
    ? dados.vendasPorMes.slice(-periodo).map((p) => ({ rotulo: p.mes, valor: p.total }))
    : [];
  const temVenda = pontos.some((p) => p.valor > 0);

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <div className="painel-boas-vindas">
          <h1 className="painel-saudacao">{saudacao}</h1>
          <p className="painel-subtitulo">
            {(perfil && SUBTITULOS[perfil]) || 'Aqui está um resumo do seu dia.'}
          </p>
          <span className="painel-traco" aria-hidden="true" />
        </div>
        <div className="painel-relogio">
          <p className="painel-data">
            <Icone nome="calendario" tamanho={18} />
            <span>{dataPorExtenso(agora)}</span>
          </p>
          <p className="painel-hora">{horaCurta(agora)}</p>
        </div>
      </div>

      {resumo.carregando && !dados && <Carregando />}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {atualizacao.dados?.ativo === true &&
        atualizacao.dados.pendentes.length > 0 &&
        atualizacao.dados.tarefa.estado !== 'RODANDO' && (
          <Aviso tipo="info">
            Há uma atualização do sistema (
            {atualizacao.dados.pendentes.length === 1
              ? '1 novidade'
              : `${atualizacao.dados.pendentes.length} novidades`}
            ).{' '}
            <Link to="/gestor/configuracoes?aba=atualizacao">Ver e atualizar</Link>
          </Aviso>
        )}

      {dados && (
        <div className="painel-indicadores">
          {dados.cartoes.map((c) => (
            <article
              key={c.rotulo}
              className={c.variacao !== null ? 'painel-indicador painel-indicador-com-variacao' : 'painel-indicador'}
            >
              <div className={`painel-indicador-icone painel-cor-${c.cor}`}>
                <Icone nome={c.icone} tamanho={26} />
              </div>
              <div className="painel-indicador-texto">
                <span
                  className="painel-indicador-valor"
                  style={{ '--caracteres': String(c.valor).length } as CSSProperties}
                >
                  {c.valor}
                </span>
                <span className="painel-indicador-rotulo">{c.rotulo}</span>
              </div>
              {c.variacao !== null && (
                <span
                  className={`painel-variacao ${
                    c.variacao >= 0 ? 'painel-variacao-alta' : 'painel-variacao-baixa'
                  }`}
                >
                  <Icone nome={c.variacao >= 0 ? 'seta-cima' : 'seta-baixo'} tamanho={14} />
                  {formatarVariacao(c.variacao)}
                </span>
              )}
            </article>
          ))}
        </div>
      )}

      <div className={gestor ? 'painel-linha' : 'painel-linha painel-linha-dupla'}>
        {gestor && (
          <section className="painel-cartao painel-desempenho">
            <header className="painel-cartao-cabecalho">
              <Icone nome="grafico" tamanho={20} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Vendas por Mês</h2>
              <select
                className="painel-seletor"
                aria-label="Período do gráfico"
                value={periodo}
                disabled={!dados}
                onChange={(e) => setPeriodo(Number(e.target.value))}
              >
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </header>
            {resumo.carregando && !dados && <Carregando />}
            {dados &&
              (temVenda ? (
                <div className="painel-grafico-corpo">
                  <GraficoLinha pontos={pontos} />
                </div>
              ) : (
                <p className="painel-vazio">Ainda não há vendas neste período.</p>
              ))}
          </section>
        )}

        <section className="painel-cartao painel-avisos">
          <header className="painel-cartao-cabecalho">
            <Icone nome="pedidos" tamanho={20} className="painel-cartao-icone" />
            <h2 className="painel-cartao-titulo">{(perfil && TITULOS_RECENTES[perfil]) || 'Recentes'}</h2>
            {perfil && VER_TODOS[perfil] && (
              <Link className="painel-ver-todos" to={`${raiz}/${VER_TODOS[perfil]}`}>
                Ver todos
                <Icone nome="seta-direita" tamanho={14} />
              </Link>
            )}
          </header>
          {resumo.carregando && !dados && <Carregando />}
          {dados && dados.recentes.length === 0 && (
            <p className="painel-vazio">Nada por enquanto.</p>
          )}
          {dados && dados.recentes.length > 0 && (
            <ul className="painel-avisos-lista">
              {dados.recentes.map((r) => (
                <li key={`${r.quando}-${r.titulo}`} className="painel-aviso">
                  <span className={`painel-aviso-marca painel-cor-${r.cor}`}>
                    <span className="painel-aviso-bolinha" />
                  </span>
                  <div className="painel-aviso-texto">
                    <span className="painel-aviso-titulo">{r.titulo}</span>
                    <span className="painel-aviso-corpo">{r.subtitulo}</span>
                  </div>
                  <span className="painel-aviso-tempo">{tempoDesde(r.quando, agora)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="painel-coluna">
          {dados?.destaque && (
            <section className="painel-cartao painel-destaque">
              <div className="painel-destaque-texto">
                <span className="painel-destaque-etiqueta">
                  <Icone nome="estrela" tamanho={18} />
                  {dados.destaque.rotulo}
                </span>
                <h2 className="painel-destaque-titulo">{dados.destaque.titulo}</h2>
                <p className="painel-destaque-subtitulo">{dados.destaque.subtitulo}</p>
                <Link className="painel-pilula" to={`${raiz}/${dados.destaque.caminho}`}>
                  Ver detalhes
                  <Icone nome="seta-direita" tamanho={14} />
                </Link>
              </div>
            </section>
          )}

          {dados && (
            <section className="painel-cartao painel-atalhos">
              <header className="painel-cartao-cabecalho">
                <Icone nome="raio" tamanho={18} className="painel-cartao-icone" />
                <h2 className="painel-cartao-titulo">Atalhos Rápidos</h2>
              </header>
              <div className="painel-atalhos-grade">
                {dados.atalhos.map((a) => (
                  <Link key={a.sufixo} to={`${raiz}/${a.sufixo}`} className="painel-atalho">
                    <Icone nome={a.icone} tamanho={22} />
                    <span>{a.rotulo}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
