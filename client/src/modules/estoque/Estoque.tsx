import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { BarraNivel, CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { MOTIVOS_PERDA, ROTULOS_MOTIVO_PERDA, queryString } from './tipos';
import type { CategoriaOpcao, ItemEstoque, MotivoPerda, RespostaEstoque, SituacaoEstoque } from './tipos';
import './estoque.css';

const ROTULOS_SITUACAO: Record<SituacaoEstoque, string> = {
  negativo: 'Negativo',
  zerado: 'Zerado',
  abaixo_minimo: 'Abaixo do mínimo',
  ok: 'Normal',
};

const COR_SITUACAO: Record<SituacaoEstoque, 'verde' | 'amarelo' | 'vermelho' | 'cinza'> = {
  negativo: 'vermelho',
  zerado: 'vermelho',
  abaixo_minimo: 'amarelo',
  ok: 'verde',
};

// Cor da barra de nível: sem saldo em vermelho, abaixo do mínimo em amarelo, normal em verde.
const COR_BARRA: Record<SituacaoEstoque, 'verde' | 'amarelo' | 'vermelho'> = {
  negativo: 'vermelho',
  zerado: 'vermelho',
  abaixo_minimo: 'amarelo',
  ok: 'verde',
};

const OPCOES_SITUACAO = [
  { valor: 'abaixo_minimo', rotulo: 'Abaixo do mínimo' },
  { valor: 'zerado', rotulo: 'Zerado' },
  { valor: 'negativo', rotulo: 'Negativo' },
];

const OPCOES_MOTIVO = MOTIVOS_PERDA.map((m) => ({ valor: m, rotulo: ROTULOS_MOTIVO_PERDA[m] }));

// Ajuste e perda: só o gestor e o estoquista lançam. Os outros perfis só consultam.
function podeLancar(perfil: string | undefined): boolean {
  return perfil === 'GESTOR' || perfil === 'ESTOQUISTA';
}

// Barra de nível: saldo contra o maior entre o máximo e três vezes o mínimo (1 se ambos forem zero).
function metaDaBarra(item: ItemEstoque): number {
  return Math.max(item.estoqueMaximo ?? 0, item.estoqueMinimo * 3, 1);
}

type Janela = { tipo: 'ajuste'; item: ItemEstoque } | { tipo: 'perda'; item: ItemEstoque } | null;

// Cartões de resumo no topo (estilo de indicadores com ícone).
function Resumo({ valorTotal, abaixoMinimo, zerados, negativos }: {
  valorTotal: number;
  abaixoMinimo: number;
  zerados: number;
  negativos: number;
}) {
  const itens: { rotulo: string; valor: string; icone: NomeIcone; cor: string }[] = [
    { rotulo: 'Valor em estoque', valor: formatarMoeda(valorTotal), icone: 'dinheiro', cor: 'verde' },
    { rotulo: 'Abaixo do mínimo', valor: String(abaixoMinimo), icone: 'grafico', cor: 'laranja' },
    { rotulo: 'Zerados', valor: String(zerados), icone: 'pacote', cor: 'vermelho' },
    { rotulo: 'Negativos', valor: String(negativos), icone: 'raio', cor: 'roxo' },
  ];
  return (
    <div className="resumo">
      {itens.map((i) => (
        <div className="resumo-item" key={i.rotulo}>
          <span className={`resumo-icone resumo-icone-${i.cor}`}>
            <Icone nome={i.icone} tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{i.valor}</span>
            <span className="resumo-rotulo">{i.rotulo}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Janela de ajuste: informa o saldo contado. A diferença é calculada pelo servidor.
function JanelaAjuste({ item, aoFechar, aoSalvo }: { item: ItemEstoque; aoFechar: () => void; aoSalvo: () => void }) {
  const [saldoContado, setSaldoContado] = useState(String(item.quantidade).replace('.', ','));
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contado = lerNumero(saldoContado);
  const diferenca = contado === null ? null : contado - item.quantidade;

  async function salvar() {
    setErro(null);
    if (contado === null || contado < 0) return setErro('Informe o saldo contado (zero ou mais).');
    if (!motivo.trim()) return setErro('Informe o motivo do ajuste.');
    setOcupado(true);
    try {
      await api.post('/estoque/ajuste', { produtoId: item.produtoId, quantidadeNova: contado, motivo: motivo.trim() });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="estoque-texto-suave">
        {item.nome}. Saldo atual no sistema: {formatarQuantidade(item.quantidade, item.unidade)}.
      </p>
      <Campo rotulo={`Saldo contado (${item.unidade.toLowerCase()})`} valor={saldoContado} aoMudar={setSaldoContado} obrigatorio />
      {diferenca !== null && diferenca !== 0 && (
        <p className="estoque-texto-suave">
          Diferença: {diferenca > 0 ? '+' : ''}
          {formatarQuantidade(diferenca, item.unidade)}
        </p>
      )}
      <Campo rotulo="Motivo" valor={motivo} aoMudar={setMotivo} obrigatorio />
      <div className="estoque-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao aoClicar={salvar} desabilitado={ocupado}>
          {ocupado ? 'Salvando...' : 'Salvar ajuste'}
        </Botao>
      </div>
    </>
  );
}

// Janela de perda: quantidade, motivo e observação. Baixa do estoque como PERDA.
function JanelaPerda({ item, aoFechar, aoSalvo }: { item: ItemEstoque; aoFechar: () => void; aoSalvo: () => void }) {
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState<MotivoPerda>('VENCIDO');
  const [observacao, setObservacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const qtd = lerNumero(quantidade);
    if (qtd === null || qtd <= 0) return setErro('Informe a quantidade perdida.');
    setOcupado(true);
    try {
      await api.post('/estoque/perda', {
        produtoId: item.produtoId,
        quantidade: qtd,
        motivo,
        observacao: observacao.trim() || undefined,
      });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="estoque-texto-suave">
        {item.nome}. Saldo atual: {formatarQuantidade(item.quantidade, item.unidade)}.
      </p>
      <Campo rotulo={`Quantidade perdida (${item.unidade.toLowerCase()})`} valor={quantidade} aoMudar={setQuantidade} obrigatorio />
      <Selecao rotulo="Motivo" valor={motivo} aoMudar={(v) => setMotivo(v as MotivoPerda)} opcoes={OPCOES_MOTIVO} obrigatorio />
      <Campo rotulo="Observação" valor={observacao} aoMudar={setObservacao} />
      <div className="estoque-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao variante="perigo" aoClicar={salvar} desabilitado={ocupado}>
          {ocupado ? 'Salvando...' : 'Lançar perda'}
        </Botao>
      </div>
    </>
  );
}

export function Estoque() {
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const lanca = podeLancar(usuario?.perfil);
  const raiz = RAIZ_DO_PERFIL[usuario?.perfil ?? 'GESTOR'];

  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [situacao, setSituacao] = useState('');
  const [janela, setJanela] = useState<Janela>(null);

  const categorias = useDados<CategoriaOpcao[]>('/categorias');
  const caminho = `/estoque${queryString({ busca: busca.trim(), categoriaId, situacao })}`;
  const { dados, carregando, erro, recarregar } = useDados<RespostaEstoque>(caminho);

  function acoesDe(item: ItemEstoque): AcaoMenu[] {
    return [
      { rotulo: 'Lançar perda', icone: 'lixeira', perigo: true, aoClicar: () => setJanela({ tipo: 'perda', item }) },
      { rotulo: 'Ver movimentos', icone: 'transferir', aoClicar: () => navegar(`${raiz}/movimentacoes?produtoId=${item.produtoId}`) },
      { rotulo: 'Cadastrar lote', icone: 'validade', aoClicar: () => navegar(`${raiz}/validade?cadastrar=${item.produtoId}`) },
    ];
  }

  const colunas: ColunaTabela<ItemEstoque>[] = [
    {
      titulo: 'Produto',
      celula: (i) => (
        <CelulaProduto foto={i.foto} nome={i.nome} setor={i.categoria} detalhe={`${i.codigo} · ${i.ean ?? 'sem EAN'}`} />
      ),
    },
    { titulo: 'Categoria', celula: (i) => i.categoria ?? '—' },
    {
      titulo: 'Quantidade',
      alinhar: 'direita',
      celula: (i) => (
        <div className="estoque-quantidade">
          <span className={`numero${i.quantidade < 0 ? ' estoque-numero-negativo' : ''}`}>
            {formatarQuantidade(i.quantidade, i.unidade)}
          </span>
          <BarraNivel valor={Math.max(0, i.quantidade)} maximo={metaDaBarra(i)} cor={COR_BARRA[i.situacao]} />
        </div>
      ),
    },
    { titulo: 'Mínimo', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.estoqueMinimo, i.unidade)}</span> },
    { titulo: 'Valor em estoque', alinhar: 'direita', celula: (i) => <span className="numero">{formatarMoeda(i.valorEstoque)}</span> },
    { titulo: 'Situação', celula: (i) => <Selo cor={COR_SITUACAO[i.situacao]}>{ROTULOS_SITUACAO[i.situacao]}</Selo> },
  ];
  if (lanca) {
    colunas.push({
      titulo: 'Ações',
      acoes: true,
      celula: (i) => (
        <div className="acoes-linha">
          <Botao variante="secundario" aoClicar={() => setJanela({ tipo: 'ajuste', item: i })}>
            Ajustar
          </Botao>
          <MenuAcoes acoes={acoesDe(i)} rotulo={`Mais ações de ${i.nome}`} />
        </div>
      ),
    });
  }

  function aoSalvarJanela() {
    setJanela(null);
    recarregar();
  }

  return (
    <Pagina titulo="Estoque">
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && <Resumo {...dados.resumo} />}

      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <label className="campo estoque-filtro-busca">
              <span className="campo-rotulo">Buscar</span>
              <input
                className="campo-controle"
                type="search"
                placeholder="Buscar por nome, código ou EAN"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
            <Selecao
              rotulo="Categoria"
              valor={categoriaId}
              aoMudar={setCategoriaId}
              opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              vazio="Todas"
            />
            <Selecao rotulo="Situação" valor={situacao} aoMudar={setSituacao} opcoes={OPCOES_SITUACAO} vazio="Todas" />
          </div>
        </div>
      </Cartao>

      {dados && (
        <Tabela
          colunas={colunas}
          dados={dados.itens}
          chave={(i) => i.produtoId}
          vazio="Nenhum produto encontrado com esses filtros."
        />
      )}

      <Modal
        aberto={janela?.tipo === 'ajuste'}
        titulo="Ajustar saldo"
        aoFechar={() => setJanela(null)}
      >
        {janela?.tipo === 'ajuste' && (
          <JanelaAjuste key={janela.item.produtoId} item={janela.item} aoFechar={() => setJanela(null)} aoSalvo={aoSalvarJanela} />
        )}
      </Modal>

      <Modal
        aberto={janela?.tipo === 'perda'}
        titulo="Lançar perda"
        aoFechar={() => setJanela(null)}
      >
        {janela?.tipo === 'perda' && (
          <JanelaPerda key={janela.item.produtoId} item={janela.item} aoFechar={() => setJanela(null)} aoSalvo={aoSalvarJanela} />
        )}
      </Modal>
    </Pagina>
  );
}
