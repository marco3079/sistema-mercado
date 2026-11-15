import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Caixa, Carregando, Cartao, Pagina, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import type { PedidoLista, ResultadoFaturamento } from './tipos';
import { COR_STATUS_PEDIDO, ROTULO_STATUS_PEDIDO } from './tipos';
import './comercial.css';

// Faturamento em lote (gestor): pedidos aprovados ou em separação. Cada pedido vira venda com NF-e
// (simulada), o flex entra no saldo do vendedor e é criada a entrega com código de rastreio.

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
      titulo: '',
      celula: (p) => (
        <Caixa rotulo={`Selecionar pedido ${p.numero}`} marcado={selecionados.has(p.id)} aoMudar={(m) => alternar(p.id, m)} />
      ),
    },
    { titulo: 'Pedido', celula: (p) => <strong>nº {p.numero}</strong> },
    { titulo: 'Cliente', celula: (p) => p.cliente },
    { titulo: 'Vendedor', celula: (p) => p.vendedor ?? 'Sem vendedor' },
    {
      titulo: 'Situação',
      celula: (p) => <Selo cor={COR_STATUS_PEDIDO[p.status]}>{ROTULO_STATUS_PEDIDO[p.status]}</Selo>,
    },
    { titulo: 'Total', alinhar: 'direita', celula: (p) => formatarMoeda(p.total) },
    { titulo: 'Criado em', celula: (p) => formatarData(p.criadoEm) },
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
          <div className="com-barra-faturar">
            <Botao variante="secundario" aoClicar={marcarTodos} desabilitado={pedidos.length === 0}>
              {selecionados.size === pedidos.length && pedidos.length > 0 ? 'Desmarcar todos' : 'Marcar todos'}
            </Botao>
            <div className="com-barra-total">
              <span className="com-suave">
                {selecionados.size} selecionado(s) · {formatarMoeda(totalSelecionado)}
              </span>
              <Botao desabilitado={selecionados.size === 0 || faturando} aoClicar={faturar}>
                {faturando ? 'Faturando...' : 'Faturar selecionados'}
              </Botao>
            </div>
          </div>
          <Tabela
            colunas={colunas}
            dados={pedidos}
            chave={(p) => p.id}
            vazio="Nenhum pedido aprovado para faturar."
          />
        </>
      )}
    </Pagina>
  );
}
