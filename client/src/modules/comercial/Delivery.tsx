import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { imprimirHtml, dataHora, escapar, moeda } from '../../lib/imprimir';
import { mensagemErro, tempoDesde } from '../../lib/mercado';
import { assinar, rajada } from '../../lib/tempoReal';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Pagina, Selo, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import type { EntregaVenda } from './tipos';
import { COR_STATUS_ENTREGA, ROTULO_STATUS_ENTREGA, quantidadeCurta } from './tipos';
import './comercial.css';

// Delivery (gestor e operador): pedidos do dia do cardápio online e do iFood Mercado (simulado).

const ROTULO_ORIGEM: Record<string, string> = {
  DELIVERY: 'Delivery',
  MARKETPLACE: 'iFood',
};

const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  FIADO: 'Fiado',
  VALE_ALIMENTACAO: 'Vale-alimentação',
  BOLETO: 'Boleto',
};

function imprimirPedido(p: EntregaVenda) {
  const itens = p.itens
    .map((i) => `<tr><td>${escapar(quantidadeCurta(i.quantidade))}</td><td>${escapar(i.descricao)}</td><td>${moeda(i.total)}</td></tr>`)
    .join('');
  const corpo = `
    <h1>${p.origem === 'MARKETPLACE' ? 'Pedido iFood' : 'Pedido delivery'} nº ${p.numero}</h1>
    <p>${escapar(dataHora(p.criadoEm))}</p>
    ${p.marketplaceId ? `<p>Código: ${escapar(p.marketplaceId)} (simulado)</p>` : ''}
    <p><strong>${escapar(p.cliente ?? '')}</strong></p>
    ${p.telefone ? `<p>Tel.: ${escapar(p.telefone)}</p>` : ''}
    ${p.endereco ? `<p>${escapar(p.endereco)}</p>` : ''}
    <table>${itens}</table>
    <p><strong>Total: ${moeda(p.total)}</strong></p>
    <p>Pagamento: ${escapar(p.formas.map((f) => ROTULO_FORMA[f] ?? f).join(', ') || '-')}</p>
    ${p.entrega ? `<p>Rastreio: ${escapar(p.entrega.codigo)}</p>` : ''}
  `;
  imprimirHtml(`Pedido ${p.numero}`, corpo);
}

export function Delivery() {
  const { usuario } = useAuth();
  const gestor = usuario?.perfil === 'GESTOR';
  const [copiado, setCopiado] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const { dados, carregando, erro, recarregar } = useDados<EntregaVenda[]>('/delivery/pedidos');

  // Atualiza sozinho quando chega um pedido (em rajada, para não recarregar a cada evento).
  useEffect(() => {
    const r = rajada(() => recarregar(), 500);
    const parar = assinar(() => r.disparar());
    return () => {
      parar();
      r.cancelar();
    };
    // recarregar é estável entre renderizações.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkLoja = `${window.location.origin}/pedir`;

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(linkLoja);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErroAcao('Não foi possível copiar. Copie o link manualmente.');
    }
  }

  async function simularIfood() {
    setSimulando(true);
    setErroAcao(null);
    try {
      await api.post('/delivery/marketplace/simular');
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  const pedidos = dados ?? [];
  const indicadores: { rotulo: string; valor: string; icone: NomeIcone; cor: string }[] = [
    { rotulo: 'Pedidos hoje', valor: String(pedidos.length), icone: 'pedidos', cor: 'azul' },
    {
      rotulo: 'Vendido hoje',
      valor: formatarMoeda(pedidos.reduce((s, p) => s + p.total, 0)),
      icone: 'dinheiro',
      cor: 'verde',
    },
    {
      rotulo: 'Em rota',
      valor: String(pedidos.filter((p) => p.entrega?.status === 'EM_ROTA').length),
      icone: 'caminhao',
      cor: 'laranja',
    },
    {
      rotulo: 'Entregues',
      valor: String(pedidos.filter((p) => p.entrega?.status === 'ENTREGUE').length),
      icone: 'visto',
      cor: 'roxo',
    },
  ];

  return (
    <Pagina
      titulo="Delivery"
      acoes={
        gestor ? (
          <Botao variante="secundario" desabilitado={simulando} aoClicar={simularIfood}>
            {simulando ? 'Simulando...' : 'Simular pedido do iFood Mercado'}
          </Botao>
        ) : undefined
      }
    >
      <Cartao titulo="Link da loja online">
        <div className="com-link-loja">
          <input className="com-input" readOnly value={linkLoja} onFocus={(e) => e.currentTarget.select()} />
          <Botao variante="secundario" aoClicar={copiarLink}>
            {copiado ? 'Copiado' : 'Copiar link'}
          </Botao>
        </div>
        <p className="com-suave">Envie este link aos clientes. Eles pedem sem precisar de login.</p>
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      <h2 className="com-subtitulo">Pedidos de hoje</h2>
      {carregando && !dados ? (
        <Carregando />
      ) : pedidos.length === 0 ? (
        <p className="com-suave">Nenhum pedido de delivery hoje.</p>
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

          <div className="com-pedidos-dia">
            {pedidos.map((p) => (
              <article key={p.vendaId} className="com-pedido-dia">
                <div className="com-pedido-dia-topo">
                  <strong>Pedido nº {p.numero}</strong>
                  <Selo cor={p.origem === 'MARKETPLACE' ? 'amarelo' : 'verde'}>{ROTULO_ORIGEM[p.origem] ?? p.origem}</Selo>
                  {p.origem === 'MARKETPLACE' && <Selo cor="cinza">simulado</Selo>}
                  {p.entrega ? (
                    <Selo cor={COR_STATUS_ENTREGA[p.entrega.status] ?? 'cinza'}>
                      {ROTULO_STATUS_ENTREGA[p.entrega.status] ?? p.entrega.status}
                    </Selo>
                  ) : (
                    <Selo cor="cinza">Sem entrega</Selo>
                  )}
                  <span className="com-suave">{tempoDesde(p.criadoEm)}</span>
                </div>

                <div className="com-identidade">
                  <strong>{p.cliente ?? 'Cliente'}</strong>
                  {p.telefone && <span className="com-suave">{p.telefone}</span>}
                  {p.endereco && <span className="com-suave">{p.endereco}</span>}
                  {p.marketplaceId && <span className="com-suave">Pedido {p.marketplaceId}</span>}
                </div>

                <ul className="com-pedido-dia-itens">
                  {p.itens.map((i, idx) => (
                    <li key={idx} className="com-pedido-dia-item">
                      <FotoProduto foto={i.foto} nome={i.descricao} tamanho={36} />
                      <span>
                        {quantidadeCurta(i.quantidade)} × {i.descricao}
                      </span>
                      <span className="numero com-suave">{formatarMoeda(i.total)}</span>
                    </li>
                  ))}
                </ul>

                <div className="com-pedido-dia-rodape">
                  <span>
                    Total <strong className="numero">{formatarMoeda(p.total)}</strong>
                  </span>
                  <span className="com-suave">{p.formas.map((f) => ROTULO_FORMA[f] ?? f).join(', ') || '-'}</span>
                  {p.entrega && <span className="com-suave">Rastreio {p.entrega.codigo}</span>}
                  <Botao variante="secundario" aoClicar={() => imprimirPedido(p)}>
                    Imprimir
                  </Botao>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </Pagina>
  );
}
