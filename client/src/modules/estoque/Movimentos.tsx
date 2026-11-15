import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatarQuantidade } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Campo, Carregando, Pagina, Selecao, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ROTULOS_TIPO_MOVIMENTO, queryString } from './tipos';
import type { Movimento, RespostaEstoque, TipoMovimento } from './tipos';
import './estoque.css';

const OPCOES_TIPO = (Object.keys(ROTULOS_TIPO_MOVIMENTO) as TipoMovimento[]).map((t) => ({
  valor: t,
  rotulo: ROTULOS_TIPO_MOVIMENTO[t],
}));

// Entradas em verde, saídas em vermelho, sem alteração em cinza.
function corDoMovimento(quantidade: number): 'verde' | 'vermelho' | 'cinza' {
  if (quantidade > 0) return 'verde';
  if (quantidade < 0) return 'vermelho';
  return 'cinza';
}

function quantidadeComSinal(quantidade: number, unidade: string): string {
  const texto = formatarQuantidade(Math.abs(quantidade), unidade);
  if (quantidade > 0) return `+${texto}`;
  if (quantidade < 0) return `-${texto}`;
  return texto;
}

export function Movimentos() {
  const [parametros] = useSearchParams();
  // Vindo do botão "Ver movimentos" da tela de estoque, já chega filtrado pelo produto.
  const [produtoId, setProdutoId] = useState(parametros.get('produtoId') ?? '');
  const [tipo, setTipo] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');

  const produtos = useDados<RespostaEstoque>('/estoque');
  const caminho = `/estoque/movimentos${queryString({ produtoId, tipo, inicio, fim })}`;
  const { dados, carregando, erro } = useDados<Movimento[]>(caminho);

  const colunas: ColunaTabela<Movimento>[] = [
    { titulo: 'Data e hora', celula: (m) => formatarDataHora(m.criadoEm) },
    { titulo: 'Produto', celula: (m) => m.produto },
    {
      titulo: 'Tipo',
      celula: (m) => <Selo cor={corDoMovimento(m.quantidade)}>{ROTULOS_TIPO_MOVIMENTO[m.tipo] ?? m.tipo}</Selo>,
    },
    {
      titulo: 'Quantidade',
      alinhar: 'direita',
      celula: (m) => (
        <span className={m.quantidade < 0 ? 'estoque-numero-negativo' : m.quantidade > 0 ? 'estoque-numero-positivo' : undefined}>
          {quantidadeComSinal(m.quantidade, m.unidade)}
        </span>
      ),
    },
    {
      titulo: 'Saldo após',
      alinhar: 'direita',
      celula: (m) => formatarQuantidade(m.saldoApos, m.unidade),
    },
    {
      titulo: 'Custo',
      alinhar: 'direita',
      celula: (m) => (m.custoUnitario === null ? '—' : formatarMoeda(m.custoUnitario)),
    },
    {
      titulo: 'Motivo',
      celula: (m) => (
        <>
          {m.motivo ?? '—'}
          {m.referencia && <span className="estoque-texto-suave"> ({m.referencia})</span>}
        </>
      ),
    },
    { titulo: 'Usuário', celula: (m) => m.usuario ?? '—' },
  ];

  return (
    <Pagina titulo="Movimentações">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
          <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            opcoes={OPCOES_TIPO}
            vazio="Todos"
          />
          <Selecao
            rotulo="Produto"
            valor={produtoId}
            aoMudar={setProdutoId}
            opcoes={(produtos.dados?.itens ?? []).map((p) => ({ valor: String(p.produtoId), rotulo: p.nome }))}
            vazio="Todos"
          />
        </div>
      </div>
      <p className="estoque-texto-suave">Sem período, mostra os últimos 30 dias. Até 500 movimentos.</p>

      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados && (
        <Tabela
          colunas={colunas}
          dados={dados}
          chave={(m) => m.id}
          vazio="Nenhuma movimentação no período."
        />
      )}
    </Pagina>
  );
}
