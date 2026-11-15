import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Pagina, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import type { PedidoLista, ResultadoFaturamento } from './tipos';
import { COR_STATUS_PEDIDO, ROTULO_STATUS_PEDIDO } from './tipos';
import './comercial.css';

// Faturamento em lote (gestor): pedidos aprovados ou em separação. Cada pedido vira venda com NF-e
// (simulada), o flex entra no saldo do vendedor e é criada a entrega com código de rastreio.

function classeFlex(valor: number): string {
  if (valor > 0) return 'com-flex com-flex-positivo';
  if (valor < 0) return 'com-flex com-flex-negativo';
  return 'com-flex';
}

function textoFlex(valor: number): string {
  if (valor === 0) return 'Sem flex';
  return `${valor > 0 ? '+' : ''}${formatarMoeda(valor)}`;
}

export function Faturamento() {
  const aprovados = useDados<PedidoLista[]>('/pedidos-venda?status=APROVADO');
  const separando = useDados<PedidoLista[]>('/pedidos-venda?status=SEPARANDO');
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [faturando, setFaturando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFaturamento | null>(null);

  const pedidos = useMemo(
    () => [...(aprovados.dados ?? []), ...(separando.dados ?? [])].sort((a, b) => a.numero - b.numero),
    [aprovados.dados, separando.dados],
  );
  const totalSelecionado = pedidos.filter((p) => selecionados.has(p.id)).reduce((s, p) => s + p.total, 0);
  const totalAFaturar = pedidos.reduce((s, p) => s + p.total, 0);
  const carregando = (aprovados.carregando && !aprovados.dados) || (separando.carregando && !separando.dados);
  const erro = aprovados.erro ?? separando.erro;

  function alternar(id: number, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  function marcarTodos() {
    setSelecionados(selecionados.size === pedidos.length ? new Set() : new Set(pedidos.map((p) => p.id)));
  }

  async function faturar() {
    if (selecionados.size === 0) return;
    if (!window.confirm(`Faturar ${selecionados.size} pedido(s), somando ${formatarMoeda(totalSelecionado)}?`)) return;
    setFaturando(true);
    setErroAcao(null);
    setResultado(null);
    try {
      const r = await api.post<ResultadoFaturamento>('/pedidos-venda/faturar', { pedidoIds: Array.from(selecionados) });
      setResultado(r);
      setSelecionados(new Set());
      aprovados.recarregar();
      separando.recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setFaturando(false);
    }
  }

  const colunas: ColunaTabela<PedidoLista>[] = [
    {
      titulo: 'Pedido',
      celula: (p) => (
        <span className="com-identidade-linha">
          <input
            type="checkbox"
            className="com-check"
            checked={selecionados.has(p.id)}
            onChange={(e) => alternar(p.id, e.target.checked)}
            aria-label={`Selecionar pedido ${p.numero}`}
          />
          <span className="com-identidade">
            <strong>Pedido nº {p.numero}</strong>
            <span className="com-suave">{p.cliente}</span>
          </span>
        </span>
      ),
    },
    { titulo: 'Vendedor', celula: (p) => p.vendedor ?? 'Sem vendedor' },
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
  ];

  const indicadores: { rotulo: string; valor: string; icone: NomeIcone; cor: string }[] = [
    { rotulo: 'Pedidos para faturar', valor: String(pedidos.length), icone: 'pedidos', cor: 'azul' },
    { rotulo: 'Valor a faturar', valor: formatarMoeda(totalAFaturar), icone: 'dinheiro', cor: 'verde' },
    { rotulo: `Selecionados (${formatarMoeda(totalSelecionado)})`, valor: String(selecionados.size), icone: 'visto', cor: 'laranja' },
  ];

  return (
    <Pagina
      titulo="Faturamento em lote"
      acoes={
        <Link className="botao botao-secundario" to="/gestor/entregas">
          Montar carga
        </Link>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {resultado && (
        <Cartao titulo="Resultado do faturamento">
          {resultado.faturados.length > 0 && (
            <div className="com-resultado">
              <Aviso tipo="sucesso">{resultado.faturados.length} pedido(s) faturado(s).</Aviso>
              {resultado.faturados.map((f) => (
                <div key={f.pedidoId} className="com-resultado-linha">
                  <span>Pedido {f.pedidoId}</span>
                  <span>Venda nº {f.vendaNumero}</span>
                  <span>NF-e {f.notaNumero ?? '—'} (simulada)</span>
                  <strong>Entrega {f.entregaCodigo}</strong>
                </div>
              ))}
            </div>
          )}
          {resultado.erros.map((e) => (
            <Aviso key={e.pedidoId} tipo="erro">
              Pedido {e.pedidoId}: {e.erro}
            </Aviso>
          ))}
        </Cartao>
      )}

      {carregando ? (
        <Carregando />
      ) : (
        <>
          <div className="resumo">
            {indicadores.map((i) => (
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

          <div className="com-barra-faturar">
            <Botao variante="secundario" aoClicar={marcarTodos} desabilitado={pedidos.length === 0}>
              {selecionados.size === pedidos.length && pedidos.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
            </Botao>
            <div className="com-barra-total">
              <Botao desabilitado={selecionados.size === 0 || faturando} aoClicar={faturar}>
                {faturando ? 'Faturando...' : `Faturar ${selecionados.size} selecionado(s)`}
              </Botao>
            </div>
          </div>
          <Tabela colunas={colunas} dados={pedidos} chave={(p) => p.id} vazio="Nenhum pedido aprovado para faturar." />
        </>
      )}
    </Pagina>
  );
}
