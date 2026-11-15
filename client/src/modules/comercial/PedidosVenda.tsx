import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mensagemErro, ROTULOS_ORIGEM_VENDA } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { assinar, rajada } from '../../lib/tempoReal';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Carregando, MenuAcoes, Modal, Pagina, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import type { PedidoDetalhe, PedidoLista } from './tipos';
import { COR_STATUS_PEDIDO, ROTULO_STATUS_PEDIDO, quantidadeCurta } from './tipos';
import './comercial.css';

// Pedidos de venda da força de vendas: o gestor aprova, separa e cancela; o vendedor envia e edita os seus.
// A lista tem uma coluna de ações (menu ⋯) e o detalhe abre ao clicar na linha.

const ABAS: { id: string; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'ORCAMENTO', rotulo: 'Orçamento' },
  { id: 'PENDENTE', rotulo: 'Pendentes' },
  { id: 'APROVADO', rotulo: 'Aprovados' },
  { id: 'SEPARANDO', rotulo: 'Separando' },
  { id: 'FATURADO', rotulo: 'Faturados' },
  { id: 'CANCELADO', rotulo: 'Cancelados' },
];

function classeFlex(valor: number): string {
  if (valor > 0) return 'com-flex com-flex-positivo';
  if (valor < 0) return 'com-flex com-flex-negativo';
  return 'com-flex';
}

function textoFlex(valor: number): string {
  if (valor === 0) return 'Sem flex';
  return `${valor > 0 ? '+' : ''}${formatarMoeda(valor)}`;
}

export function PedidosVenda() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';
  const gestor = usuario?.perfil === 'GESTOR';
  const [aba, setAba] = useState('todos');
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const filtro = aba === 'todos' ? '' : `?status=${aba}`;
  const { dados, carregando, erro, recarregar } = useDados<PedidoLista[]>(`/pedidos-venda${filtro}`);
  const detalhe = useDados<PedidoDetalhe>(selecionadoId ? `/pedidos-venda/${selecionadoId}` : null);

  // Atualiza sozinho quando algo muda na força de vendas (em rajada, para não recarregar a cada evento).
  useEffect(() => {
    const r = rajada(() => {
      recarregar();
      detalhe.recarregar();
    }, 500);
    const parar = assinar(() => r.disparar());
    return () => {
      parar();
      r.cancelar();
    };
    // recarregar e detalhe.recarregar são estáveis entre renderizações.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mudar(pedido: { id: number; numero: number }, status: 'PENDENTE' | 'APROVADO' | 'SEPARANDO' | 'CANCELADO') {
    let motivo: string | undefined;
    if (status === 'CANCELADO') {
      if (!window.confirm(`Cancelar o pedido nº ${pedido.numero}?`)) return;
      motivo = 'Cancelado pela força de vendas';
    }
    setOcupado(true);
    setErroAcao(null);
    try {
      await api.post(`/pedidos-venda/${pedido.id}/status`, { status, motivo });
      recarregar();
      detalhe.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  // Ações de cada linha: as que fazem sentido para a situação do pedido.
  function acoesDo(p: PedidoLista): AcaoMenu[] {
    const acoes: AcaoMenu[] = [{ rotulo: 'Ver detalhes', icone: 'lista', aoClicar: () => setSelecionadoId(p.id) }];
    if (p.status === 'ORCAMENTO' || p.status === 'PENDENTE') {
      acoes.push({ rotulo: 'Editar', icone: 'lapis', aoClicar: () => navigate(`${raiz}/pedidos-venda/${p.id}/editar`) });
    }
    if (p.status === 'ORCAMENTO') {
      acoes.push({ rotulo: 'Enviar pedido', icone: 'enviar', aoClicar: () => mudar(p, 'PENDENTE') });
    }
    if (gestor && p.status === 'PENDENTE') {
      acoes.push({ rotulo: 'Aprovar', icone: 'visto', aoClicar: () => mudar(p, 'APROVADO') });
    }
    if (gestor && p.status === 'APROVADO') {
      acoes.push({ rotulo: 'Mandar para separação', icone: 'pacote', aoClicar: () => mudar(p, 'SEPARANDO') });
    }
    if (p.status !== 'CANCELADO' && (p.status !== 'FATURADO' || gestor)) {
      acoes.push({
        rotulo: p.status === 'FATURADO' ? 'Cancelar venda' : 'Cancelar pedido',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => mudar(p, 'CANCELADO'),
      });
    }
    return acoes;
  }

  const colunas: ColunaTabela<PedidoLista>[] = [
    {
      titulo: 'Pedido',
      celula: (p) => (
        <span className="com-identidade">
          <strong>Pedido nº {p.numero}</strong>
          <span className="com-suave">{p.cliente}</span>
        </span>
      ),
    },
    ...(gestor ? [{ titulo: 'Vendedor', celula: (p: PedidoLista) => p.vendedor ?? '—' }] : []),
    {
      titulo: 'Origem',
      celula: (p) => <Selo cor="cinza">{ROTULOS_ORIGEM_VENDA[p.origem] ?? p.origem}</Selo>,
    },
    {
      titulo: 'Situação',
      celula: (p) => <Selo cor={COR_STATUS_PEDIDO[p.status]}>{ROTULO_STATUS_PEDIDO[p.status]}</Selo>,
    },
    { titulo: 'Total', alinhar: 'direita', celula: (p) => <span className="numero">{formatarMoeda(p.total)}</span> },
    {
      titulo: 'Flex',
      alinhar: 'direita',
      celula: (p) => <span className={`numero ${classeFlex(p.flex)}`}>{textoFlex(p.flex)}</span>,
    },
    { titulo: 'Criado em', celula: (p) => <span className="numero">{formatarData(p.criadoEm)}</span> },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (p) => (
        <div className="acoes-linha">
          <MenuAcoes rotulo={`Ações do pedido ${p.numero}`} acoes={acoesDo(p)} />
        </div>
      ),
    },
  ];

  const pedido = detalhe.dados;
  const podeEditar =
    !!pedido && !!usuario && (gestor || pedido.vendedorId === usuario.id) && (pedido.status === 'ORCAMENTO' || pedido.status === 'PENDENTE');
  const podeCancelar =
    !!pedido &&
    !!usuario &&
    (pedido.status === 'FATURADO' ? gestor : gestor || pedido.vendedorId === usuario.id) &&
    pedido.status !== 'CANCELADO';

  return (
    <Pagina
      titulo="Pedidos de venda"
      acoes={
        <Link className="botao botao-primario" to={`${raiz}/novo-pedido`}>
          Novo pedido
        </Link>
      }
    >
      <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && selecionadoId === null && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && !dados ? (
        <Carregando />
      ) : (
        <Tabela
          colunas={colunas}
          dados={dados ?? []}
          chave={(p) => p.id}
          vazio="Nenhum pedido nesta situação."
          aoClicarLinha={(p) => setSelecionadoId(p.id)}
        />
      )}

      <Modal
        aberto={selecionadoId !== null}
        titulo={pedido ? `Pedido nº ${pedido.numero}` : 'Pedido'}
        aoFechar={() => {
          setSelecionadoId(null);
          setErroAcao(null);
        }}
      >
        {detalhe.carregando && !pedido && <Carregando />}
        {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
        {pedido && (
          <div className="com-detalhe">
            <div className="com-detalhe-topo">
              <Selo cor={COR_STATUS_PEDIDO[pedido.status]}>{ROTULO_STATUS_PEDIDO[pedido.status]}</Selo>
              <span className="com-suave">{pedido.cliente}</span>
              {pedido.vendedor && <span className="com-suave">Vendedor: {pedido.vendedor}</span>}
            </div>

            <div className="com-tabela-itens">
              {pedido.itens.map((i) => (
                <div key={i.id} className="com-item-linha">
                  <span className="com-item-produto">
                    <FotoProduto foto={i.foto} nome={i.produto} setor={i.categoria} tamanho={44} />
                    <span className="com-identidade">
                      <strong>{i.produto}</strong>
                      <span className="com-suave">
                        {quantidadeCurta(i.quantidade, i.unidade)} × {formatarMoeda(i.precoNegociado)} (tabela {formatarMoeda(i.precoTabela)})
                      </span>
                    </span>
                  </span>
                  <strong className="numero">{formatarMoeda(i.total)}</strong>
                </div>
              ))}
            </div>

            <div className="com-resumo-pedido">
              <div>
                <span className="com-suave">Tabela</span>
                <strong>{formatarMoeda(pedido.subtotalTabela)}</strong>
              </div>
              <div>
                <span className="com-suave">Flex</span>
                <strong className={classeFlex(pedido.flex)}>{textoFlex(pedido.flex)}</strong>
              </div>
              <div>
                <span className="com-suave">Total</span>
                <strong>{formatarMoeda(pedido.total)}</strong>
              </div>
            </div>

            {(pedido.formaPagamento || pedido.condicaoPagamento || pedido.previsaoEntrega || pedido.observacoes) && (
              <div className="com-suave">
                {pedido.condicaoPagamento && <div>Condição: {pedido.condicaoPagamento}</div>}
                {pedido.formaPagamento && <div>Forma: {pedido.formaPagamento}</div>}
                {pedido.previsaoEntrega && <div>Previsão de entrega: {formatarData(pedido.previsaoEntrega)}</div>}
                {pedido.observacoes && <div>Obs.: {pedido.observacoes}</div>}
              </div>
            )}

            {pedido.vendaNumero !== null && <div className="com-suave">Venda nº {pedido.vendaNumero}</div>}
            {pedido.entregaCodigo && (
              <div className="com-suave">
                Entrega: <strong>{pedido.entregaCodigo}</strong>
              </div>
            )}

            {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

            <div className="com-acoes-pedido">
              {pedido.status === 'ORCAMENTO' && podeEditar && (
                <Botao desabilitado={ocupado} aoClicar={() => mudar(pedido, 'PENDENTE')}>
                  Enviar pedido
                </Botao>
              )}
              {podeEditar && (
                <Botao variante="secundario" aoClicar={() => navigate(`${raiz}/pedidos-venda/${pedido.id}/editar`)}>
                  Editar
                </Botao>
              )}
              {gestor && pedido.status === 'PENDENTE' && (
                <Botao desabilitado={ocupado} aoClicar={() => mudar(pedido, 'APROVADO')}>
                  Aprovar
                </Botao>
              )}
              {gestor && pedido.status === 'APROVADO' && (
                <Botao desabilitado={ocupado} aoClicar={() => mudar(pedido, 'SEPARANDO')}>
                  Mandar para separação
                </Botao>
              )}
              {gestor && (pedido.status === 'APROVADO' || pedido.status === 'SEPARANDO') && (
                <Botao variante="secundario" aoClicar={() => navigate('/gestor/faturamento')}>
                  Ir para faturamento
                </Botao>
              )}
              {podeCancelar && (
                <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => mudar(pedido, 'CANCELADO')}>
                  {pedido.status === 'FATURADO' ? 'Cancelar venda' : 'Cancelar pedido'}
                </Botao>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
