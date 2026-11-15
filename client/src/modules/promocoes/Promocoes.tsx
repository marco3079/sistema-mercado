import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  Grade,
  Modal,
  Pagina,
  Selecao,
  Selo,
  formatarData,
  formatarMoeda,
  paraInputData,
} from '../../ui';
import { ROTULO_TIPO_PROMOCAO } from './tipos';
import type { AbaPromocao, PromocaoDTO, SugestaoDTO, TipoPromocao } from './tipos';
import './promocoes.css';

const ROTULO_ABA: Record<AbaPromocao, string> = {
  ativas: 'ativas',
  agendadas: 'agendadas',
  encerradas: 'encerradas',
};

// Número com vírgula para o campo de texto ("12,5"); vazio se não houver.
function numeroTexto(valor: number | null): string {
  return valor === null ? '' : String(valor).replace('.', ',');
}

// Cartão de uma promoção, com período, unidades vendidas e ações.
function CartaoPromocao({
  promocao: p,
  aba,
  aoEditar,
  aoEncerrar,
  aoExcluir,
}: {
  promocao: PromocaoDTO;
  aba: AbaPromocao;
  aoEditar(): void;
  aoEncerrar(): void;
  aoExcluir(): void;
}) {
  return (
    <article className="promocoes-cartao">
      <header className="promocoes-cartao-cabecalho">
        <h3>{p.nome}</h3>
        <div className="promocoes-selos">
          <Selo cor={aba === 'ativas' ? 'verde' : aba === 'agendadas' ? 'azul' : 'cinza'}>
            {ROTULO_TIPO_PROMOCAO[p.tipo]}
          </Selo>
          {p.industria && <Selo cor="amarelo">{p.industria}</Selo>}
        </div>
      </header>
      <p className="promocoes-descricao">{p.descricao}</p>
      <p className="promocoes-texto">
        {p.produto ? `Produto: ${p.produto}` : `Categoria: ${p.categoria ?? '—'}`}
        {p.precoNormal !== null && ` · preço normal ${formatarMoeda(p.precoNormal)}`}
      </p>
      <p className="promocoes-texto">
        Período: {formatarData(p.inicio)} a {formatarData(p.fim)}
      </p>
      <p className="promocoes-texto">
        Unidades vendidas: <strong>{formatarQuantidade(p.unidadesVendidas)}</strong>
      </p>
      {p.industria && (
        <p className="promocoes-texto">
          Bonificação: {formatarMoeda(p.bonificacaoUnidade ?? 0)} por unidade vendida
        </p>
      )}
      <div className="promocoes-acoes">
        {aba === 'ativas' && (
          <Botao variante="secundario" aoClicar={aoEncerrar}>
            Encerrar
          </Botao>
        )}
        <Botao variante="secundario" aoClicar={aoEditar}>
          Editar
        </Botao>
        {p.unidadesVendidas === 0 && (
          <Botao variante="perigo" aoClicar={aoExcluir}>
            Excluir
          </Botao>
        )}
      </div>
    </article>
  );
}

interface ProdutoBusca {
  id: number;
  nome: string;
}

interface Campos {
  nome: string;
  tipo: TipoPromocao;
  alvo: 'PRODUTO' | 'CATEGORIA';
  produtoId: string;
  produtoNome: string;
  categoriaId: string;
  valor: string;
  levar: string;
  pagar: string;
  qtdMinima: string;
  inicio: string;
  fim: string;
  industria: string;
  bonificacao: string;
}

function camposDe(p: PromocaoDTO | null): Campos {
  const hoje = paraInputData(new Date().toISOString());
  // Promoção nova: começa hoje e vale 7 dias (fim = hoje + 7).
  const emSeteDias = paraInputData(new Date(Date.now() + 7 * 86400000).toISOString());
  return {
    nome: p?.nome ?? '',
    tipo: p?.tipo ?? 'PERCENTUAL',
    alvo: p?.categoriaId ? 'CATEGORIA' : 'PRODUTO',
    produtoId: p?.produtoId ? String(p.produtoId) : '',
    produtoNome: p?.produto ?? '',
    categoriaId: p?.categoriaId ? String(p.categoriaId) : '',
    valor: p && p.tipo !== 'LEVE_PAGUE' ? numeroTexto(p.valor) : '',
    levar: p?.levar !== null && p?.levar !== undefined ? String(p.levar) : '',
    pagar: p?.pagar !== null && p?.pagar !== undefined ? String(p.pagar) : '',
    qtdMinima: numeroTexto(p?.qtdMinima ?? null),
    inicio: p ? paraInputData(p.inicio) : hoje,
    fim: p ? paraInputData(p.fim) : emSeteDias,
    industria: p?.industria ?? '',
    bonificacao: numeroTexto(p?.bonificacaoUnidade ?? null),
  };
}

// Cadastro e edição de uma promoção. Os campos mudam com o tipo escolhido.
function FormularioPromocao({
  promocao,
  aoFechar,
  aoSalvo,
}: {
  promocao: PromocaoDTO | null;
  aoFechar(): void;
  aoSalvo(mensagem: string): void;
}) {
  const [c, setC] = useState<Campos>(() => camposDe(promocao));
  const [buscaProduto, setBuscaProduto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const produtos = useDados<{ itens: ProdutoBusca[]; total: number }>(
    c.alvo === 'PRODUTO' && buscaProduto.trim().length >= 2
      ? `/produtos?busca=${encodeURIComponent(buscaProduto.trim())}&porPagina=20`
      : null,
  );
  const categorias = useDados<{ id: number; nome: string }[]>(c.alvo === 'CATEGORIA' ? '/categorias' : null);

  const opcoesProduto = (produtos.dados?.itens ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }));
  if (c.produtoId !== '' && !opcoesProduto.some((o) => o.valor === c.produtoId)) {
    opcoesProduto.unshift({ valor: c.produtoId, rotulo: c.produtoNome || `Produto ${c.produtoId}` });
  }

  function mudar<K extends keyof Campos>(chave: K) {
    return (valor: Campos[K]) => setC((atual) => ({ ...atual, [chave]: valor }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (c.nome.trim() === '') return setErro('Informe o nome da promoção.');
    if (c.alvo === 'PRODUTO' && c.produtoId === '') return setErro('Escolha o produto.');
    if (c.alvo === 'CATEGORIA' && c.categoriaId === '') return setErro('Escolha a categoria.');
    if (c.inicio === '' || c.fim === '') return setErro('Informe o período da promoção.');

    const valor = lerNumero(c.valor);
    const corpo = {
      nome: c.nome.trim(),
      tipo: c.tipo,
      produtoId: c.alvo === 'PRODUTO' ? Number(c.produtoId) : null,
      categoriaId: c.alvo === 'CATEGORIA' ? Number(c.categoriaId) : null,
      valor: c.tipo === 'LEVE_PAGUE' ? null : valor,
      levar: c.tipo === 'LEVE_PAGUE' ? Number(c.levar) : null,
      pagar: c.tipo === 'LEVE_PAGUE' ? Number(c.pagar) : null,
      qtdMinima: c.tipo === 'ATACADO' ? lerNumero(c.qtdMinima) : null,
      inicio: c.inicio,
      fim: c.fim,
      industria: c.industria.trim() || null,
      bonificacaoUnidade: lerNumero(c.bonificacao),
    };

    setEnviando(true);
    try {
      if (promocao) {
        await api.put(`/promocoes/${promocao.id}`, corpo);
        aoSalvo(`${corpo.nome} atualizada.`);
      } else {
        await api.post('/promocoes', corpo);
        aoSalvo(`${corpo.nome} criada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  const rotuloValor =
    c.tipo === 'PERCENTUAL' ? 'Desconto (%)' : c.tipo === 'PRECO_FIXO' ? 'Preço promocional (R$)' : 'Preço por unidade (R$)';

  return (
    <Modal aberto titulo={promocao ? 'Editar promoção' : 'Nova promoção'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Grade>
          <Selecao
            rotulo="Tipo"
            valor={c.tipo}
            aoMudar={(v) => mudar('tipo')(v as TipoPromocao)}
            opcoes={(Object.keys(ROTULO_TIPO_PROMOCAO) as TipoPromocao[]).map((t) => ({
              valor: t,
              rotulo: ROTULO_TIPO_PROMOCAO[t],
            }))}
            obrigatorio
          />
          <Campo rotulo="Nome" valor={c.nome} aoMudar={mudar('nome')} obrigatorio />
          <Selecao
            rotulo="Vale para"
            valor={c.alvo}
            aoMudar={(v) => mudar('alvo')(v === 'CATEGORIA' ? 'CATEGORIA' : 'PRODUTO')}
            opcoes={[
              { valor: 'PRODUTO', rotulo: 'Um produto' },
              { valor: 'CATEGORIA', rotulo: 'Uma categoria' },
            ]}
          />
        </Grade>

        {c.alvo === 'PRODUTO' ? (
          <Grade>
            <Campo rotulo="Buscar produto (2 letras ou mais)" valor={buscaProduto} aoMudar={setBuscaProduto} />
            <Selecao
              rotulo="Produto"
              valor={c.produtoId}
              aoMudar={(v) =>
                setC((atual) => ({
                  ...atual,
                  produtoId: v,
                  produtoNome: opcoesProduto.find((o) => o.valor === v)?.rotulo ?? '',
                }))
              }
              opcoes={opcoesProduto}
              vazio="Escolha o produto"
              obrigatorio
            />
          </Grade>
        ) : (
          <Selecao
            rotulo="Categoria"
            valor={c.categoriaId}
            aoMudar={mudar('categoriaId')}
            opcoes={(categorias.dados ?? []).map((cat) => ({ valor: String(cat.id), rotulo: cat.nome }))}
            vazio="Escolha a categoria"
            obrigatorio
          />
        )}

        <Grade>
          {c.tipo === 'LEVE_PAGUE' ? (
            <>
              <Campo rotulo="Leve (quantidade)" tipo="number" valor={c.levar} aoMudar={mudar('levar')} obrigatorio />
              <Campo rotulo="Pague (quantidade)" tipo="number" valor={c.pagar} aoMudar={mudar('pagar')} obrigatorio />
            </>
          ) : (
            <Campo rotulo={rotuloValor} valor={c.valor} aoMudar={mudar('valor')} obrigatorio />
          )}
          {c.tipo === 'ATACADO' && (
            <Campo rotulo="A partir de (quantidade)" valor={c.qtdMinima} aoMudar={mudar('qtdMinima')} obrigatorio />
          )}
        </Grade>

        <Grade>
          <Campo rotulo="Início" tipo="date" valor={c.inicio} aoMudar={mudar('inicio')} obrigatorio />
          <Campo rotulo="Fim" tipo="date" valor={c.fim} aoMudar={mudar('fim')} obrigatorio />
        </Grade>

        <Grade>
          <Campo rotulo="Indústria (bonificação, opcional)" valor={c.industria} aoMudar={mudar('industria')} />
          <Campo rotulo="Bonificação por unidade (R$)" valor={c.bonificacao} aoMudar={mudar('bonificacao')} />
        </Grade>

        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Promoções inteligentes: sugestões calculadas pelo servidor. Nada é criado sem o clique em Criar.
function Sugestoes({
  aoFechar,
  aoCriada,
}: {
  aoFechar(): void;
  aoCriada(mensagem: string): void;
}) {
  const [sugestoes, setSugestoes] = useState<SugestaoDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    api
      .post<SugestaoDTO[]>('/promocoes/sugerir')
      .then((resposta) => {
        if (!cancelado) setSugestoes(resposta);
      })
      .catch((err: unknown) => {
        if (!cancelado) setErro(mensagemErro(err));
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function criar(s: SugestaoDTO) {
    setErro(null);
    setCriando(s.produtoId);
    try {
      await api.post('/promocoes', {
        nome: `Sugestão: ${s.produto}`.slice(0, 120),
        tipo: s.tipo,
        produtoId: s.produtoId,
        categoriaId: null,
        valor: s.valor,
        inicio: paraInputData(s.inicio),
        fim: paraInputData(s.fim),
        industria: null,
        bonificacaoUnidade: null,
      });
      setSugestoes((atuais) => (atuais ?? []).filter((x) => x.produtoId !== s.produtoId));
      aoCriada(`Promoção criada para ${s.produto}.`);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setCriando(null);
    }
  }

  return (
    <Modal aberto titulo="Promoções inteligentes" aoFechar={aoFechar}>
      <p>Sugestões com base na validade e nas vendas. Nada é criado até você clicar em Criar.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!sugestoes && !erro && <Carregando />}
      {sugestoes && sugestoes.length === 0 && <p>Nenhuma sugestão agora.</p>}
      {sugestoes && sugestoes.length > 0 && (
        <ul className="promocoes-sugestoes">
          {sugestoes.map((s) => (
            <li key={s.produtoId} className="promocoes-sugestao">
              <div>
                <strong>{s.produto}</strong>
                <span className="promocoes-texto">
                  {s.motivo} · {ROTULO_TIPO_PROMOCAO[s.tipo]} de {s.valor}%
                </span>
                <span className="promocoes-texto">
                  Até {formatarData(s.fim)}
                </span>
              </div>
              <Botao desabilitado={criando !== null} aoClicar={() => criar(s)}>
                {criando === s.produtoId ? 'Criando...' : 'Criar'}
              </Botao>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// Promoções: abas ativas, agendadas e encerradas, com cadastro, edição, encerramento e sugestões.
export function Promocoes() {
  const [aba, setAba] = useState<AbaPromocao>('ativas');
  const [edicao, setEdicao] = useState<PromocaoDTO | 'nova' | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const lista = useDados<PromocaoDTO[]>(`/promocoes?status=${aba}`);
  const promocoes = lista.dados ?? [];

  function aoAtualizar(mensagem: string) {
    setAviso(mensagem);
    setErro(null);
    lista.recarregar();
  }

  async function encerrar(p: PromocaoDTO) {
    if (!window.confirm(`Encerrar a promoção "${p.nome}" agora?`)) return;
    setErro(null);
    try {
      await api.post(`/promocoes/${p.id}/encerrar`);
      aoAtualizar(`${p.nome} encerrada.`);
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  async function excluir(p: PromocaoDTO) {
    if (!window.confirm(`Excluir a promoção "${p.nome}"? Esta ação não tem volta.`)) return;
    setErro(null);
    try {
      await api.del(`/promocoes/${p.id}`);
      aoAtualizar(`${p.nome} excluída.`);
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  return (
    <Pagina
      titulo="Promoções"
      acoes={
        <>
          <Botao variante="secundario" aoClicar={() => setSugerindo(true)}>
            Promoções inteligentes
          </Botao>{' '}
          <Botao aoClicar={() => setEdicao('nova')}>Nova promoção</Botao>
        </>
      }
    >
      <Abas
        abas={[
          { id: 'ativas', rotulo: 'Ativas' },
          { id: 'agendadas', rotulo: 'Agendadas' },
          { id: 'encerradas', rotulo: 'Encerradas' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as AbaPromocao)}
      />

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && promocoes.length === 0 && (
        <p className="tabela-vazia">{`Nenhuma promoção ${ROTULO_ABA[aba]}.`}</p>
      )}

      {promocoes.length > 0 && (
        <div className="promocoes-grade">
          {promocoes.map((p) => (
            <CartaoPromocao
              key={p.id}
              promocao={p}
              aba={aba}
              aoEditar={() => setEdicao(p)}
              aoEncerrar={() => encerrar(p)}
              aoExcluir={() => excluir(p)}
            />
          ))}
        </div>
      )}

      {edicao !== null && (
        <FormularioPromocao
          promocao={edicao === 'nova' ? null : edicao}
          aoFechar={() => setEdicao(null)}
          aoSalvo={aoAtualizar}
        />
      )}
      {sugerindo && <Sugestoes aoFechar={() => setSugerindo(false)} aoCriada={aoAtualizar} />}
    </Pagina>
  );
}
