import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { assinar, rajada } from '../../lib/tempoReal';
import { formatarQuantidade, hojeIso, horaCurta, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Carregando, Caixa, Modal, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { OrdemDTO, ReceitaDTO, SugestaoDTO, StatusProducao } from './tipos';
import { CelulaProduto, FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';

// Produção do dia: fornadas em três colunas (planejada, no forno, concluída).
// Concluir baixa os insumos proporcionalmente e dá entrada no produto acabado (no servidor).

export const ROTULO_STATUS: Record<StatusProducao, string> = {
  PLANEJADA: 'Planejada',
  EM_PRODUCAO: 'No forno',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

function numeroParaCampo(n: number): string {
  return String(n).replace('.', ',');
}

// Dia AAAA-MM-DD somado de `dias` (sem passar por UTC, para não mudar o dia no Brasil).
export function deslocarDia(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const data = new Date(a, m - 1, d + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

// dd/mm/aaaa a partir de AAAA-MM-DD.
export function formatarDiaIso(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Concluir: informa o que saiu bom e a perda. Serve à produção do dia e ao painel do forno.
export function ModalConcluir({
  ordem,
  aoFechar,
  aoSalvo,
}: {
  ordem: OrdemDTO;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [produzida, setProduzida] = useState(numeroParaCampo(ordem.quantidadePlanejada));
  const [perda, setPerda] = useState('0');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const unidade = ordem.unidade;

  async function concluir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const boas = lerNumero(produzida);
    const perdidas = perda.trim() === '' ? 0 : lerNumero(perda);
    if (boas === null || boas < 0) {
      setErro('Informe quantas unidades saíram boas.');
      return;
    }
    if (perdidas === null || perdidas < 0) {
      setErro('A perda precisa ser um número igual ou maior que zero.');
      return;
    }
    if (boas + perdidas <= 0) {
      setErro('Informe a quantidade produzida.');
      return;
    }
    setEnviando(true);
    try {
      await api.post<OrdemDTO>(`/producao/${ordem.id}/concluir`, {
        quantidadeProduzida: boas,
        perda: perdidas,
      });
      aoSalvo(`${ordem.produto} concluída: ${formatarQuantidade(boas, unidade)}.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Concluir · ${ordem.produto}`} aoFechar={aoFechar}>
      <form onSubmit={concluir}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo
          rotulo={`Produzido, em boas condições (${unidade.toLowerCase()})`}
          valor={produzida}
          aoMudar={setProduzida}
          obrigatorio
        />
        <Campo rotulo={`Perda: queimou, quebrou, caiu (${unidade.toLowerCase()})`} valor={perda} aoMudar={setPerda} />
        <p className="padaria-ajuda">
          Os insumos são baixados pelo total (produzido + perda). O produto entra no estoque só com o que saiu bom.
        </p>
        <div className="padaria-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Concluir fornada
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Nova fornada: receita, quantidade planejada e horário.
function NovaFornada({
  dia,
  aoFechar,
  aoSalvo,
}: {
  dia: string;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const receitas = useDados<ReceitaDTO[]>('/receitas');
  const [receitaId, setReceitaId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [horario, setHorario] = useState(`${dia}T06:00`);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const escolhida = receitas.dados?.find((r) => String(r.id) === receitaId);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!escolhida) {
      setErro('Escolha a receita.');
      return;
    }
    const q = lerNumero(quantidade);
    if (q === null || q <= 0) {
      setErro(`Informe a quantidade planejada (${escolhida.unidade.toLowerCase()}).`);
      return;
    }
    const quando = new Date(horario);
    if (Number.isNaN(quando.getTime())) {
      setErro('Horário inválido.');
      return;
    }
    setEnviando(true);
    try {
      await api.post<OrdemDTO>('/producao', {
        receitaId: escolhida.id,
        quantidadePlanejada: q,
        agendadoPara: quando.toISOString(),
        observacao: observacao.trim() || null,
      });
      aoSalvo(`Fornada de ${escolhida.produto} planejada.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Nova fornada" aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {receitas.erro && <Aviso tipo="erro">{receitas.erro}</Aviso>}
        <Selecao
          rotulo="Receita"
          valor={receitaId}
          aoMudar={setReceitaId}
          opcoes={(receitas.dados ?? []).map((r) => ({ valor: String(r.id), rotulo: r.produto }))}
          vazio="Escolha a receita"
          obrigatorio
        />
        <Campo
          rotulo={`Quantidade planejada${escolhida ? ` (${escolhida.unidade.toLowerCase()})` : ''}`}
          valor={quantidade}
          aoMudar={setQuantidade}
          obrigatorio
        />
        <Campo rotulo="Horário da fornada" tipo="datetime-local" valor={horario} aoMudar={setHorario} obrigatorio />
        <Campo rotulo="Observação (opcional)" valor={observacao} aoMudar={setObservacao} />
        <div className="padaria-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Planejar fornada
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Sugestão: linhas marcadas viram uma ordem cada, às 06:00 do dia.
function SugestaoDia({
  dia,
  aoFechar,
  aoSalvo,
}: {
  dia: string;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const sugestao = useDados<SugestaoDTO[]>(`/producao/sugestao?data=${dia}`);
  // Só guarda o que o usuário mexeu; o padrão é marcar quem tem quantidade sugerida.
  const [alterados, setAlterados] = useState<Record<number, boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const marcado = (s: SugestaoDTO) => alterados[s.receitaId] ?? s.sugerido > 0;

  async function criarOrdens() {
    setErro(null);
    const escolhidas = (sugestao.dados ?? []).filter((s) => marcado(s) && s.sugerido > 0);
    if (escolhidas.length === 0) {
      setErro('Marque pelo menos uma linha com quantidade sugerida.');
      return;
    }
    setEnviando(true);
    const agendado = new Date(`${dia}T06:00`).toISOString();
    let criadas = 0;
    const falhas: string[] = [];
    for (const s of escolhidas) {
      try {
        await api.post<OrdemDTO>('/producao', {
          receitaId: s.receitaId,
          quantidadePlanejada: s.sugerido,
          agendadoPara: agendado,
        });
        criadas += 1;
      } catch (err) {
        falhas.push(`${s.produto}: ${mensagemErro(err)}`);
      }
    }
    setEnviando(false);
    if (criadas > 0) aoSalvo(`${criadas} fornada(s) criada(s) para as 06:00.`);
    if (falhas.length > 0) setErro(falhas.join(' · '));
    else aoFechar();
  }

  return (
    <Modal aberto titulo={`Sugestão de produção · ${formatarDiaIso(dia)}`} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sugestao.erro && <Aviso tipo="erro">{sugestao.erro}</Aviso>}
      {sugestao.carregando && !sugestao.dados && <Carregando />}
      {sugestao.dados && (
        <>
          <p className="padaria-ajuda">
            Média das vendas do mesmo dia da semana nas últimas 4 semanas, menos o estoque atual, arredondada para
            cima no múltiplo do rendimento.
          </p>
          <Tabela
            dados={sugestao.dados}
            chave={(s) => s.receitaId}
            vazio="Sem receitas cadastradas."
            colunas={[
              {
                titulo: 'Produto',
                celula: (s) => <CelulaProduto foto={s.foto} nome={s.produto} setor={s.categoria} />,
              },
              { titulo: 'Média vendida', alinhar: 'direita', celula: (s) => formatarQuantidade(s.mediaVendida) },
              { titulo: 'Estoque', alinhar: 'direita', celula: (s) => formatarQuantidade(s.estoque) },
              {
                titulo: 'Sugerido',
                alinhar: 'direita',
                celula: (s) => <strong>{formatarQuantidade(s.sugerido)}</strong>,
              },
              { titulo: 'Fornadas', alinhar: 'direita', celula: (s) => s.fornadas },
              {
                titulo: 'Incluir',
                celula: (s) => (
                  <Caixa
                    rotulo="Incluir"
                    marcado={marcado(s)}
                    aoMudar={(v) => setAlterados((atuais) => ({ ...atuais, [s.receitaId]: v }))}
                  />
                ),
              },
            ]}
          />
          <div className="padaria-acoes-modal">
            <Botao desabilitado={enviando} aoClicar={criarOrdens}>
              Criar ordens
            </Botao>
            <Botao variante="secundario" aoClicar={aoFechar}>
              Fechar
            </Botao>
          </div>
        </>
      )}
    </Modal>
  );
}

// Cartão de uma fornada, com os botões de ação.
function CartaoFornada({
  ordem,
  ocupado,
  aoIniciar,
  aoConcluir,
  aoCancelar,
}: {
  ordem: OrdemDTO;
  ocupado: boolean;
  aoIniciar: () => void;
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const aberta = ordem.status === 'PLANEJADA' || ordem.status === 'EM_PRODUCAO';
  const faltando = ordem.status === 'PLANEJADA' && ordem.faltaInsumo.length > 0;
  return (
    <article className={`padaria-fornada${faltando ? ' padaria-fornada-alerta' : ''}`}>
      <div className="padaria-fornada-topo">
        <FotoProduto foto={ordem.foto} nome={ordem.produto} setor={ordem.categoria} tamanho={48} />
        <div className="padaria-fornada-cabeca">
          <strong className="padaria-fornada-hora">{horaCurta(ordem.agendadoPara)}</strong>
          <span className="padaria-fornada-produto">{ordem.produto}</span>
        </div>
      </div>
      <p className="padaria-fornada-quantidade">
        {ordem.status === 'CONCLUIDA' && ordem.quantidadeProduzida !== null
          ? `Produzido ${formatarQuantidade(ordem.quantidadeProduzida, ordem.unidade)}`
          : `Planejado ${formatarQuantidade(ordem.quantidadePlanejada, ordem.unidade)}`}
        {ordem.status === 'CONCLUIDA' && ordem.perda !== null && ordem.perda > 0 && (
          <> · perda {formatarQuantidade(ordem.perda, ordem.unidade)}</>
        )}
      </p>
      {ordem.status === 'CONCLUIDA' && ordem.custoTotal !== null && (
        <p className="padaria-ajuda">Custo da fornada: {formatarMoeda(ordem.custoTotal)}</p>
      )}
      {faltando && (
        <p className="padaria-falta">
          Falta insumo: {ordem.faltaInsumo.map((f) => `${f.insumo} (precisa ${formatarQuantidade(f.necessario)}, tem ${formatarQuantidade(f.estoque)})`).join('; ')}
        </p>
      )}
      {ordem.observacao && <p className="padaria-ajuda">{ordem.observacao}</p>}
      {aberta && (
        <div className="padaria-fornada-acoes">
          {ordem.status === 'PLANEJADA' && (
            <Botao desabilitado={ocupado} aoClicar={aoIniciar}>
              Iniciar
            </Botao>
          )}
          <Botao variante="secundario" desabilitado={ocupado} aoClicar={aoConcluir}>
            Concluir
          </Botao>
          <Botao variante="texto" desabilitado={ocupado} aoClicar={aoCancelar}>
            Cancelar
          </Botao>
        </div>
      )}
    </article>
  );
}

export function Producao() {
  const [dia, setDia] = useState(hojeIso(0));
  const ordens = useDados<OrdemDTO[]>(`/producao?data=${dia}`);
  const { recarregar } = ordens;
  const [nova, setNova] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [concluindo, setConcluindo] = useState<OrdemDTO | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Mudanças de outro usuário: recarrega (juntando rajadas).
  useEffect(() => {
    const junta = rajada(() => recarregar(), 400);
    const parar = assinar((modulo) => {
      if (modulo === 'producao' || modulo === 'receitas') junta.disparar();
    });
    return () => {
      parar();
      junta.cancelar();
    };
  }, [recarregar]);

  async function agir(ordem: OrdemDTO, acao: 'iniciar' | 'cancelar') {
    if (acao === 'cancelar' && !window.confirm(`Cancelar a fornada de ${ordem.produto}?`)) return;
    setErro(null);
    setAviso(null);
    setOcupada(ordem.id);
    try {
      await api.post<OrdemDTO>(`/producao/${ordem.id}/${acao}`);
      setAviso(acao === 'iniciar' ? `${ordem.produto} foi para o forno.` : `Fornada de ${ordem.produto} cancelada.`);
      recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupada(null);
    }
  }

  const todas = ordens.dados ?? [];
  const colunas: { status: StatusProducao; titulo: string }[] = [
    { status: 'PLANEJADA', titulo: 'Planejada' },
    { status: 'EM_PRODUCAO', titulo: 'No forno' },
    { status: 'CONCLUIDA', titulo: 'Concluída' },
  ];
  const planejadas = todas.filter((o) => o.status === 'PLANEJADA').length;
  const noForno = todas.filter((o) => o.status === 'EM_PRODUCAO').length;
  const concluidas = todas.filter((o) => o.status === 'CONCLUIDA').length;
  const canceladas = todas.filter((o) => o.status === 'CANCELADA').length;
  const diaSemana = (() => {
    const [a, m, d] = dia.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
  })();

  return (
    <Pagina
      titulo="Produção do dia"
      acoes={
        <>
          <Botao variante="secundario" aoClicar={() => setSugerindo(true)}>
            Sugestão do dia
          </Botao>
          <Botao aoClicar={() => setNova(true)}>Nova fornada</Botao>
        </>
      }
    >
      <div className="resumo">
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-azul">
            <Icone nome="calendario" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{planejadas}</span>
            <span className="resumo-rotulo">Planejadas</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-laranja">
            <Icone nome="relogio" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{noForno}</span>
            <span className="resumo-rotulo">No forno</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-verde">
            <Icone nome="visto" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{concluidas}</span>
            <span className="resumo-rotulo">Concluídas</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-vermelho">
            <Icone nome="lixeira" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{canceladas}</span>
            <span className="resumo-rotulo">Canceladas</span>
          </div>
        </div>
      </div>

      <div className="barra-ferramentas padaria-dia">
        <Botao variante="secundario" aoClicar={() => setDia(deslocarDia(dia, -1))}>
          ‹ Dia anterior
        </Botao>
        <strong className="padaria-dia-titulo">
          {diaSemana}, {formatarDiaIso(dia)}
        </strong>
        <Botao variante="secundario" aoClicar={() => setDia(deslocarDia(dia, 1))}>
          Dia seguinte ›
        </Botao>
        <Botao variante="texto" aoClicar={() => setDia(hojeIso(0))}>
          Hoje
        </Botao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ordens.erro && <Aviso tipo="erro">{ordens.erro}</Aviso>}
      {ordens.carregando && !ordens.dados && <Carregando />}

      {ordens.dados && todas.length === 0 && (
        <p className="tabela-vazia">Nenhuma fornada neste dia. Use “Sugestão do dia” ou “Nova fornada”.</p>
      )}

      {ordens.dados && todas.length > 0 && (
        <div className="padaria-kanban">
          {colunas.map((coluna) => {
            const itens = todas.filter((o) => o.status === coluna.status);
            return (
              <section key={coluna.status} className="padaria-coluna">
                <h3 className="padaria-coluna-titulo">
                  {coluna.titulo} <Selo cor="cinza">{itens.length}</Selo>
                </h3>
                {itens.length === 0 && <p className="padaria-ajuda">Nada aqui.</p>}
                {itens.map((o) => (
                  <CartaoFornada
                    key={o.id}
                    ordem={o}
                    ocupado={ocupada === o.id}
                    aoIniciar={() => agir(o, 'iniciar')}
                    aoConcluir={() => setConcluindo(o)}
                    aoCancelar={() => agir(o, 'cancelar')}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {nova && (
        <NovaFornada
          dia={dia}
          aoFechar={() => setNova(false)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            recarregar();
          }}
        />
      )}
      {sugerindo && (
        <SugestaoDia
          dia={dia}
          aoFechar={() => setSugerindo(false)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            recarregar();
          }}
        />
      )}
      {concluindo && (
        <ModalConcluir
          ordem={concluindo}
          aoFechar={() => setConcluindo(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
