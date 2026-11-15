import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarData,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { BarraNivel, CelulaProduto } from '../../ui/FotoProduto';
import { ROTULOS_STATUS_INVENTARIO } from './tipos';
import type {
  CategoriaOpcao,
  InventarioDetalhe,
  InventarioResumo,
  ItemInventario,
  ResultadoFinalizacao,
} from './tipos';
import './estoque.css';

const COR_STATUS: Record<string, 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza'> = {
  ABERTO: 'azul',
  FINALIZADO: 'verde',
  CANCELADO: 'cinza',
};

// Diferença: sobra em verde, falta em vermelho.
function classeDaDiferenca(diferenca: number | null): string | undefined {
  if (diferenca === null || diferenca === 0) return undefined;
  return diferenca > 0 ? 'estoque-numero-positivo' : 'estoque-numero-negativo';
}

function textoDaDiferenca(diferenca: number | null, unidade: string): string {
  if (diferenca === null) return 'Não contado';
  if (diferenca === 0) return '0';
  const texto = formatarQuantidade(Math.abs(diferenca), unidade);
  return diferenca > 0 ? `+${texto}` : `-${texto}`;
}

// Janela de novo inventário: descrição e categoria opcional (vazia = loja inteira).
function JanelaNovo({ aoFechar, aoCriado }: { aoFechar: () => void; aoCriado: (id: number) => void }) {
  const categorias = useDados<CategoriaOpcao[]>('/categorias');
  const [descricao, setDescricao] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setErro(null);
    if (!descricao.trim()) return setErro('Informe a descrição do inventário.');
    setOcupado(true);
    try {
      const resposta = await api.post<{ id: number }>('/inventarios', {
        descricao: descricao.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : null,
      });
      aoCriado(resposta.id);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />
      <Selecao
        rotulo="Categoria"
        valor={categoriaId}
        aoMudar={setCategoriaId}
        opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
        vazio="Loja inteira"
      />
      <p className="estoque-texto-suave">Cada produto entra com o saldo atual do sistema como quantidade esperada.</p>
      <div className="estoque-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao aoClicar={criar} desabilitado={ocupado}>
          {ocupado ? 'Criando...' : 'Criar inventário'}
        </Botao>
      </div>
    </>
  );
}

// Detalhe de um inventário: progresso, tabela sistema x contado (com foto) e ações.
function DetalheInventario({ id, aoVoltar }: { id: number; aoVoltar: () => void }) {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const { dados, carregando, erro, recarregar } = useDados<InventarioDetalhe>(`/inventarios/${id}`);
  const [confirmando, setConfirmando] = useState<'finalizar' | 'cancelar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFinalizacao | null>(null);

  if (carregando && !dados) return <Carregando />;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return null;

  const aberto = dados.status === 'ABERTO';
  const contados = dados.itens.filter((i) => i.quantidadeContada !== null).length;
  const percentual = dados.itens.length === 0 ? 0 : Math.round((contados / dados.itens.length) * 100);
  const comDiferenca = dados.itens.filter((i) => i.diferenca !== null && i.diferenca !== 0);
  const valorDiferenca = comDiferenca.reduce((soma, i) => soma + i.valorDiferenca, 0);

  async function executar(acao: 'finalizar' | 'cancelar') {
    setErroAcao(null);
    setOcupado(true);
    try {
      if (acao === 'finalizar') {
        const r = await api.post<ResultadoFinalizacao>(`/inventarios/${id}/finalizar`);
        setResultado(r);
      } else {
        await api.post(`/inventarios/${id}/cancelar`);
      }
      setConfirmando(null);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const colunas: ColunaTabela<ItemInventario>[] = [
    {
      titulo: 'Produto',
      celula: (i) => (
        <CelulaProduto foto={i.foto} nome={i.nome} setor={i.categoria} detalhe={`${i.codigo} · ${i.ean ?? 'sem EAN'}`} />
      ),
    },
    { titulo: 'Sistema', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.quantidadeSistema, i.unidade)}</span> },
    {
      titulo: 'Contado',
      alinhar: 'direita',
      celula: (i) => (
        <span className="numero">{i.quantidadeContada === null ? '—' : formatarQuantidade(i.quantidadeContada, i.unidade)}</span>
      ),
    },
    {
      titulo: 'Diferença',
      alinhar: 'direita',
      celula: (i) => <span className={`numero ${classeDaDiferenca(i.diferenca) ?? ''}`}>{textoDaDiferenca(i.diferenca, i.unidade)}</span>,
    },
    { titulo: 'Valor da diferença', alinhar: 'direita', celula: (i) => <span className="numero">{formatarMoeda(i.valorDiferenca)}</span> },
  ];

  return (
    <>
      <div className="estoque-detalhe-cabecalho">
        <div>
          <Botao variante="texto" aoClicar={aoVoltar}>
            ← Voltar
          </Botao>
          <h2>{dados.descricao}</h2>
          <p className="estoque-texto-suave">
            {dados.categoria ?? 'Loja inteira'} · criado em {formatarDataHora(dados.criadoEm)}
            {dados.finalizadoEm && ` · finalizado em ${formatarData(dados.finalizadoEm)}`}
          </p>
        </div>
        <Selo cor={COR_STATUS[dados.status] ?? 'cinza'}>{ROTULOS_STATUS_INVENTARIO[dados.status]}</Selo>
      </div>

      {resultado && (
        <Aviso tipo="sucesso">
          Inventário finalizado: {resultado.ajustes} ajuste(s) de estoque, diferença de {formatarMoeda(resultado.valorDiferenca)}.
        </Aviso>
      )}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      <p className="estoque-texto-suave">
        {contados} de {dados.itens.length} produto(s) contado(s) ({percentual}%)
      </p>
      <div className="estoque-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual}>
        <div className="estoque-progresso-barra" style={{ width: `${percentual}%` }} />
      </div>

      {aberto && (
        <div className="estoque-botoes" style={{ margin: '1rem 0' }}>
          <Botao
            aoClicar={() =>
              navegar(`${RAIZ_DO_PERFIL[usuario?.perfil ?? 'GESTOR']}/contagem/${dados.id}`)
            }
          >
            Contar pelo celular
          </Botao>
          <Botao variante="perigo" aoClicar={() => setConfirmando('finalizar')}>
            Finalizar
          </Botao>
          <Botao variante="secundario" aoClicar={() => setConfirmando('cancelar')}>
            Cancelar inventário
          </Botao>
        </div>
      )}

      <Tabela colunas={colunas} dados={dados.itens} chave={(i) => i.id} vazio="Nenhum produto neste inventário." />

      <Modal
        aberto={confirmando === 'finalizar'}
        titulo="Finalizar inventário"
        aoFechar={() => setConfirmando(null)}
      >
        <p>
          {comDiferenca.length} produto(s) com diferença, ajuste total de {formatarMoeda(valorDiferenca)}.
          Cada diferença vira um movimento de inventário no estoque. Produtos sem contagem não mudam.
        </p>
        <p className="estoque-texto-suave">Depois de finalizado, o inventário não pode ser alterado.</p>
        <div className="estoque-modal-botoes">
          <Botao variante="secundario" aoClicar={() => setConfirmando(null)} desabilitado={ocupado}>
            Voltar
          </Botao>
          <Botao variante="perigo" aoClicar={() => executar('finalizar')} desabilitado={ocupado}>
            {ocupado ? 'Finalizando...' : 'Finalizar inventário'}
          </Botao>
        </div>
      </Modal>

      <Modal
        aberto={confirmando === 'cancelar'}
        titulo="Cancelar inventário"
        aoFechar={() => setConfirmando(null)}
      >
        <p>O inventário será cancelado e nenhum ajuste de estoque será feito.</p>
        <div className="estoque-modal-botoes">
          <Botao variante="secundario" aoClicar={() => setConfirmando(null)} desabilitado={ocupado}>
            Voltar
          </Botao>
          <Botao variante="perigo" aoClicar={() => executar('cancelar')} desabilitado={ocupado}>
            {ocupado ? 'Cancelando...' : 'Cancelar inventário'}
          </Botao>
        </div>
      </Modal>
    </>
  );
}

// Lista de inventários em cartões: progresso de contagem e divergências.
function CartoesInventario({ inventarios, aoAbrir }: { inventarios: InventarioResumo[]; aoAbrir: (id: number) => void }) {
  return (
    <div className="grade-produtos">
      {inventarios.map((inv) => {
        const percentual = inv.totalItens === 0 ? 0 : Math.round((inv.contados / inv.totalItens) * 100);
        return (
          <article className="cartao-produto estoque-inventario" key={inv.id}>
            <div>
              <h3 className="estoque-cartao-titulo">{inv.descricao}</h3>
              <span className="estoque-texto-suave">
                {inv.categoria ?? 'Loja inteira'} · criado em {formatarData(inv.criadoEm)}
              </span>
            </div>
            <Selo cor={COR_STATUS[inv.status] ?? 'cinza'}>{ROTULOS_STATUS_INVENTARIO[inv.status]}</Selo>
            <div>
              <div className="estoque-cartao-linha">
                <span className="estoque-texto-suave">
                  {inv.contados} de {inv.totalItens} contados
                </span>
                <strong className="numero">{percentual}%</strong>
              </div>
              <BarraNivel
                valor={inv.contados}
                maximo={inv.totalItens}
                cor={inv.status === 'FINALIZADO' ? 'verde' : 'azul'}
              />
            </div>
            <div className="estoque-cartao-linha">
              <span className="estoque-texto-suave">Divergências</span>
              <strong className={`numero${inv.divergencias > 0 ? ' estoque-numero-negativo' : ''}`}>{inv.divergencias}</strong>
            </div>
            <div className="cartao-produto-rodape">
              <Botao variante="secundario" aoClicar={() => aoAbrir(inv.id)}>
                Abrir
              </Botao>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function Inventarios() {
  const [parametros] = useSearchParams();
  const { dados, carregando, erro, recarregar } = useDados<InventarioResumo[]>('/inventarios');
  // ?abrir=ID vem da tela de contagem, para voltar direto ao inventário.
  const [abertoId, setAbertoId] = useState<number | null>(() => {
    const id = Number(parametros.get('abrir'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [novo, setNovo] = useState(false);

  if (abertoId !== null) {
    return (
      <Pagina titulo="Inventário">
        <DetalheInventario
          key={abertoId}
          id={abertoId}
          aoVoltar={() => {
            setAbertoId(null);
            recarregar();
          }}
        />
      </Pagina>
    );
  }

  return (
    <Pagina titulo="Inventário" acoes={<Botao aoClicar={() => setNovo(true)}>Novo inventário</Botao>}>
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados && dados.length === 0 && <p className="tabela-vazia">Nenhum inventário ainda. Crie o primeiro.</p>}
      {dados && dados.length > 0 && <CartoesInventario inventarios={dados} aoAbrir={setAbertoId} />}

      <Modal aberto={novo} titulo="Novo inventário" aoFechar={() => setNovo(false)}>
        {novo && (
          <JanelaNovo
            aoFechar={() => setNovo(false)}
            aoCriado={(id) => {
              setNovo(false);
              setAbertoId(id);
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
