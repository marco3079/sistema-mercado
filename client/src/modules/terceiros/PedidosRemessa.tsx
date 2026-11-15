import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Modal, Selo, Tabela, formatarData, formatarDataHora, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { ROTULOS_TIPO, podeEscrever, textoNumero } from './tipos';
import type { CorSelo, PedidoRemessa, StatusPedido } from './tipos';
import './terceiros.css';

// Pedidos que o terceiro fez pelo portal (link do portal). O gestor confere, ajusta a quantidade e aprova (vira remessa) ou recusa.

const FILTROS: { valor: StatusPedido | ''; rotulo: string }[] = [
  { valor: 'PENDENTE', rotulo: 'Pendentes' },
  { valor: 'APROVADO', rotulo: 'Aprovados' },
  { valor: 'RECUSADO', rotulo: 'Recusados' },
  { valor: 'CANCELADO', rotulo: 'Cancelados' },
  { valor: '', rotulo: 'Todos' },
];

const ROTULO_STATUS_PEDIDO: Record<StatusPedido, string> = {
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

const COR_STATUS_PEDIDO: Record<StatusPedido, CorSelo> = {
  PENDENTE: 'amarelo',
  APROVADO: 'verde',
  RECUSADO: 'vermelho',
  CANCELADO: 'cinza',
};

// Linha da tabela de conferência: item do pedido + quantidade a enviar digitada.
interface LinhaConferencia {
  item: PedidoRemessa['itens'][number];
  enviar: number | null; // null = texto inválido
  falta: boolean; // quantidade a enviar maior que o saldo na loja
}

function SituacaoPedido({ p, raiz }: { p: PedidoRemessa; raiz: string }) {
  if (p.status === 'APROVADO') {
    if (!p.remessaId) return <Selo cor="verde">Aprovado</Selo>;
    return (
      <Link className="pedrem-link" to={`${raiz}/remessas-terceiro/${p.remessaId}`}>
        <Selo cor="verde">Remessa nº {p.remessaNumero}</Selo>
      </Link>
    );
  }
  return (
    <span className="terceiros-identidade">
      <Selo cor={COR_STATUS_PEDIDO[p.status]}>{ROTULO_STATUS_PEDIDO[p.status]}</Selo>
      {p.status === 'RECUSADO' && p.motivoRecusa && <span className="terceiros-detalhe">{p.motivoRecusa}</span>}
    </span>
  );
}

// aoMudar: avisa a página quando a fila muda (aprovação, recusa ou atualização de 30 s), para o contador da aba recarregar.
export function PedidosRemessa({ aoMudar }: { aoMudar?: () => void }) {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';
  const escreve = podeEscrever(usuario?.perfil);

  const [status, setStatus] = useState<StatusPedido | ''>('PENDENTE');
  const [abertoId, setAbertoId] = useState<number | null>(null);
  const [verId, setVerId] = useState<number | null>(null);
  const [avisoSucesso, setAvisoSucesso] = useState<ReactNode>(null);

  const lista = useDados<PedidoRemessa[]>(status ? `/pedidos-remessa?status=${status}` : '/pedidos-remessa');

  // Atualiza sozinho a cada 30 s enquanto a aba está aberta.
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      lista.recarregar();
      aoMudar?.();
    }, 30000);
    return () => window.clearInterval(intervalo);
  }, [lista.recarregar, aoMudar]);

  function mudarStatus(valor: StatusPedido | '') {
    setStatus(valor);
    setAvisoSucesso(null);
  }

  const pedidoAberto = lista.dados?.find((p) => p.id === abertoId) ?? null;
  const pedidoVisto = lista.dados?.find((p) => p.id === verId) ?? null;

  const colunas: ColunaTabela<PedidoRemessa>[] = [
    {
      titulo: 'Pedido',
      celula: (p) => (
        <span className="terceiros-identidade">
          <strong>Pedido nº {p.numero}</strong>
          <span className="terceiros-detalhe">{formatarDataHora(p.criadoEm)}</span>
        </span>
      ),
    },
    {
      titulo: 'Terceiro',
      celula: (p) => (
        <span className="terceiros-identidade">
          <span>{p.terceiro.nome}</span>
          <span className="terceiros-detalhe">{p.terceiro.telefone || 'Sem telefone'}</span>
        </span>
      ),
    },
    { titulo: 'Loja', celula: (p) => p.loja.nome },
    {
      titulo: 'Itens',
      alinhar: 'direita',
      celula: (p) => (
        <span className="terceiros-identidade pedrem-alinha-direita">
          <span className="numero">{p.totalItens}</span>
          {p.itens.some((i) => i.quantidadeEnviada != null && i.quantidadeEnviada !== i.quantidade) && (
            <span className="terceiros-detalhe">com ajuste na quantidade</span>
          )}
        </span>
      ),
    },
    {
      titulo: 'Valor estimado',
      alinhar: 'direita',
      celula: (p) => <span className="numero">{formatarMoeda(p.valorEstimado)}</span>,
    },
    { titulo: 'Quero receber em', celula: (p) => (p.dataDesejada ? formatarData(p.dataDesejada) : '—') },
    { titulo: 'Situação', celula: (p) => <SituacaoPedido p={p} raiz={raiz} /> },
    {
      titulo: '',
      acoes: true,
      celula: (p) =>
        p.status === 'PENDENTE' && escreve ? (
          <span className="acoes-linha">
            <Botao aoClicar={() => setAbertoId(p.id)}>Conferir</Botao>
          </span>
        ) : (
          <span className="acoes-linha">
            <Botao variante="secundario" aoClicar={() => setVerId(p.id)}>
              Ver
            </Botao>
          </span>
        ),
    },
  ];

  return (
    <>
      <div className="pedrem-pilulas" role="group" aria-label="Filtrar pedidos por situação">
        {FILTROS.map((f) => (
          <button
            key={f.rotulo}
            type="button"
            className={status === f.valor ? 'pedrem-pilula pedrem-pilula-ativa' : 'pedrem-pilula'}
            aria-pressed={status === f.valor}
            onClick={() => mudarStatus(f.valor)}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {avisoSucesso && <Aviso tipo="sucesso">{avisoSucesso}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.dados && (
        <Tabela
          colunas={colunas}
          dados={lista.dados}
          chave={(p) => p.id}
          vazio={status === 'PENDENTE' ? 'Nenhum pedido aguardando aprovação.' : 'Nenhum pedido com esse filtro.'}
          idVisao="pedrem-pedidos"
        />
      )}

      {pedidoAberto && pedidoAberto.status === 'PENDENTE' && escreve && (
        <ModalConferencia
          key={pedidoAberto.id}
          pedido={pedidoAberto}
          raiz={raiz}
          aoFechar={() => setAbertoId(null)}
          aoConcluido={(aviso) => {
            setAbertoId(null);
            setAvisoSucesso(aviso);
            lista.recarregar();
            aoMudar?.();
          }}
        />
      )}

      {pedidoVisto && (
        <ModalDetalhePedido pedido={pedidoVisto} raiz={raiz} aoFechar={() => setVerId(null)} />
      )}
    </>
  );
}

// Pedido já respondido (só leitura): mostra a quantidade pedida e, quando diferente, a enviada.
function ModalDetalhePedido({ pedido, raiz, aoFechar }: { pedido: PedidoRemessa; raiz: string; aoFechar: () => void }) {
  const colunas: ColunaTabela<PedidoRemessa['itens'][number]>[] = [
    { titulo: 'Produto', celula: (i) => <CelulaProduto foto={i.foto} nome={i.nome} detalhe={i.codigo} /> },
    {
      titulo: 'Pedido',
      alinhar: 'direita',
      celula: (i) => <span className="numero">{formatarQuantidade(i.quantidade, i.unidade)}</span>,
    },
    {
      titulo: 'Enviado',
      alinhar: 'direita',
      celula: (i) =>
        i.quantidadeEnviada == null ? (
          <span className="terceiros-detalhe">—</span>
        ) : (
          <span className={i.quantidadeEnviada !== i.quantidade ? 'numero pedrem-ajustado' : 'numero'}>
            {formatarQuantidade(i.quantidadeEnviada, i.unidade)}
          </span>
        ),
    },
  ];
  return (
    <Modal aberto titulo={`Pedido nº ${pedido.numero} — ${pedido.terceiro.nome}`} aoFechar={aoFechar}>
      <div className="terceiros-info">
        <div>
          <span>Situação</span>
          <strong>{ROTULO_STATUS_PEDIDO[pedido.status]}</strong>
        </div>
        <div>
          <span>Loja</span>
          <strong>{pedido.loja.nome}</strong>
        </div>
        <div>
          <span>Respondido em</span>
          <strong>{pedido.respondidoEm ? formatarDataHora(pedido.respondidoEm) : '—'}</strong>
        </div>
        {pedido.remessaId && (
          <div>
            <span>Remessa</span>
            <Link className="pedrem-link" to={`${raiz}/remessas-terceiro/${pedido.remessaId}`}>
              Remessa nº {pedido.remessaNumero}
            </Link>
          </div>
        )}
        {pedido.motivoRecusa && (
          <div className="terceiros-info-larga">
            <span>Motivo da recusa</span>
            <p>{pedido.motivoRecusa}</p>
          </div>
        )}
      </div>
      <h3 className="terceiros-secao">Itens</h3>
      <Tabela colunas={colunas} dados={pedido.itens} chave={(i) => i.produtoId} vazio="Nenhum item neste pedido." porPagina={0} idVisao="pedrem-itens-ver" />
      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar}>
          Fechar
        </Botao>
      </div>
    </Modal>
  );
}

function ModalConferencia({
  pedido,
  raiz,
  aoFechar,
  aoConcluido,
}: {
  pedido: PedidoRemessa;
  raiz: string;
  aoFechar: () => void;
  aoConcluido: (aviso: ReactNode) => void;
}) {
  const [modo, setModo] = useState<'conferir' | 'recusar'>('conferir');
  // Quantidade a enviar de cada item (começa igual à pedida), como texto digitado.
  const [quantidades, setQuantidades] = useState<Record<number, string>>(() =>
    Object.fromEntries(pedido.itens.map((i) => [i.produtoId, textoNumero(i.quantidade)])),
  );
  const [documento, setDocumento] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const linhas: LinhaConferencia[] = pedido.itens.map((item) => {
    const enviar = lerNumero(quantidades[item.produtoId] ?? '');
    return { item, enviar, falta: enviar !== null && enviar > item.saldoLoja };
  });
  const algumaQuantidade = linhas.some((l) => l.enviar !== null && l.enviar > 0);
  const algumInvalida = linhas.some((l) => l.enviar === null || l.enviar < 0);
  const faltaSaldo = linhas.some((l) => l.falta);
  const podeAprovar = !ocupado && algumaQuantidade && !algumInvalida && !faltaSaldo;

  const colunasItens: ColunaTabela<LinhaConferencia>[] = [
    {
      titulo: 'Produto',
      celula: (l) => <CelulaProduto foto={l.item.foto} nome={l.item.nome} detalhe={l.item.codigo} />,
    },
    {
      titulo: 'Pedido',
      alinhar: 'direita',
      celula: (l) => <span className="numero">{formatarQuantidade(l.item.quantidade, l.item.unidade)}</span>,
    },
    {
      titulo: 'A enviar',
      celula: (l) => (
        <input
          className="campo-controle pedrem-qtd"
          inputMode="decimal"
          aria-label={`Quantidade a enviar de ${l.item.nome}`}
          value={quantidades[l.item.produtoId] ?? ''}
          onChange={(e) => setQuantidades((q) => ({ ...q, [l.item.produtoId]: e.target.value }))}
        />
      ),
    },
    {
      titulo: 'Saldo na loja',
      alinhar: 'direita',
      celula: (l) => (
        <span className={l.falta ? 'pedrem-falta' : undefined}>
          <span className="numero">{formatarQuantidade(l.item.saldoLoja, l.item.unidade)}</span>
          {l.falta && <span className="pedrem-falta-texto">Saldo insuficiente</span>}
        </span>
      ),
    },
  ];

  async function aprovar() {
    setErro(null);
    // Envia todos os itens, inclusive os com 0: o servidor mantém a quantidade pedida para item que não vai na lista.
    const itens = linhas
      .filter((l): l is LinhaConferencia & { enviar: number } => l.enviar !== null)
      .map((l) => ({ produtoId: l.item.produtoId, quantidade: l.enviar }));
    setOcupado(true);
    try {
      const r = await api.post<PedidoRemessa>(`/pedidos-remessa/${pedido.id}/aprovar`, {
        itens,
        documento: documento.trim() || null,
        previsaoRetorno: previsao || null,
      });
      aoConcluido(
        <>
          Remessa nº {r.remessaNumero} criada a partir do pedido nº {pedido.numero}.{' '}
          <Link className="pedrem-link" to={`${raiz}/remessas-terceiro/${r.remessaId}`}>
            Abrir a remessa
          </Link>
        </>,
      );
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  async function recusar() {
    setErro(null);
    if (!motivo.trim()) return setErro('Informe o motivo da recusa.');
    setOcupado(true);
    try {
      await api.post(`/pedidos-remessa/${pedido.id}/recusar`, { motivo: motivo.trim() });
      aoConcluido(`Pedido nº ${pedido.numero} recusado. Nenhuma remessa foi criada.`);
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo={`Pedido nº ${pedido.numero} — ${pedido.terceiro.nome}`} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="terceiros-info">
        <div>
          <span>Loja</span>
          <strong>{pedido.loja.nome}</strong>
        </div>
        <div>
          <span>Tipo</span>
          <strong>{ROTULOS_TIPO[pedido.tipo] ?? pedido.tipo}</strong>
        </div>
        <div>
          <span>Quero receber em</span>
          <strong>{pedido.dataDesejada ? formatarData(pedido.dataDesejada) : '—'}</strong>
        </div>
        <div>
          <span>Enviado pelo portal</span>
          <strong>{formatarDataHora(pedido.criadoEm)}</strong>
        </div>
        {pedido.observacoes && (
          <div className="terceiros-info-larga">
            <span>Observações do terceiro</span>
            <p>{pedido.observacoes}</p>
          </div>
        )}
      </div>

      {modo === 'conferir' ? (
        <>
          <h3 className="terceiros-secao">Itens</h3>
          <Tabela
            colunas={colunasItens}
            dados={linhas}
            chave={(l) => l.item.produtoId}
            vazio="Nenhum item neste pedido."
            porPagina={0}
            idVisao="pedrem-itens"
          />

          <h3 className="terceiros-secao">Remessa</h3>
          <div className="terceiros-form-grade">
            <Campo rotulo="Documento (nº da nota ou contrato)" valor={documento} aoMudar={setDocumento} />
            <Campo rotulo="Previsão de retorno" tipo="date" valor={previsao} aoMudar={setPrevisao} />
          </div>

          {faltaSaldo && <Aviso tipo="erro">Há itens sem saldo suficiente na loja. Ajuste a quantidade a enviar.</Aviso>}

          <div className="terceiros-modal-botoes pedrem-rodape">
            <span className="pedrem-recusar">
              <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => setModo('recusar')}>
                Recusar
              </Botao>
            </span>
            <Botao variante="secundario" desabilitado={ocupado} aoClicar={aoFechar}>
              Cancelar
            </Botao>
            <Botao aoClicar={aprovar} desabilitado={!podeAprovar}>
              {ocupado ? 'Enviando...' : 'Aprovar e enviar'}
            </Botao>
          </div>
        </>
      ) : (
        <>
          <h3 className="terceiros-secao">Recusar pedido</h3>
          <p className="terceiros-texto-suave">O pedido fica como recusado. Nenhuma remessa é criada.</p>
          <AreaTexto rotulo="Motivo da recusa" valor={motivo} aoMudar={setMotivo} linhas={3} />

          <div className="terceiros-modal-botoes">
            <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => setModo('conferir')}>
              Voltar
            </Botao>
            <Botao variante="perigo" desabilitado={ocupado || !motivo.trim()} aoClicar={recusar}>
              {ocupado ? 'Recusando...' : 'Confirmar recusa'}
            </Botao>
          </div>
        </>
      )}
    </Modal>
  );
}
