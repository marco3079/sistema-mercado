import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { usePlataforma } from '../../lib/plataforma';
import { ROTULOS_FORMA_PAGAMENTO, ROTULOS_ORIGEM_VENDA, formatarQuantidade, mensagemErro } from '../../lib/mercado';
import { Aviso, AreaTexto, Botao, Cartao, Carregando, Modal, Pagina, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import { imprimirCupom } from './cupom';
import type { DetalheVendaDTO } from './tipos';

// Uma venda por inteiro: itens, pagamentos, notas (XML), entrega e as ações (reimprimir e cancelar).

interface ItemDetalhe {
  descricao: string;
  quantidade: number;
  unidade: string;
  precoUnitario: number;
  desconto: number;
  total: number;
  promocao: string | null;
}

export function DetalheVenda() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const { plataforma } = usePlataforma();
  const venda = useDados<DetalheVendaDTO>(id ? `/vendas/${id}` : null);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Quem pode cancelar: gestor e operador (o operador só nas próprias vendas; a senha do gestor é pedida pelo servidor).
  const podeCancelar = usuario?.perfil === 'GESTOR' || usuario?.perfil === 'OPERADOR';

  async function reimprimir() {
    if (!venda.dados) return;
    try {
      const cupom = await api.get<DetalheVendaDTO>(`/vendas/${venda.dados.id}/cupom`);
      imprimirCupom(cupom, plataforma.nome);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function cancelar() {
    if (!venda.dados) return;
    const texto = motivo.trim();
    if (texto.length < 3) {
      setErro('Informe o motivo do cancelamento (mínimo 3 letras)');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api.post(`/vendas/${venda.dados.id}/cancelar`, { motivo: texto });
      setCancelando(false);
      setMotivo('');
      venda.recarregar();
    } catch (e) {
      const msg = mensagemErro(e);
      if (msg !== 'Ação cancelada') setErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  if (venda.carregando && venda.dados === null) {
    return (
      <Pagina titulo="Venda">
        <Carregando />
      </Pagina>
    );
  }
  if (venda.erro || !venda.dados) {
    return (
      <Pagina titulo="Venda">
        <Aviso tipo="erro">{venda.erro ?? 'Venda não encontrada'}</Aviso>
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={() => navigate(-1)}>
            Voltar
          </Botao>
        </div>
      </Pagina>
    );
  }

  const d = venda.dados;
  const cancelada = d.status === 'CANCELADA';

  return (
    <Pagina
      titulo={`Venda nº ${d.numero}`}
      acoes={
        <div className="pdv-detalhe-acoes">
          <Botao variante="secundario" aoClicar={() => navigate(-1)}>
            Voltar
          </Botao>
          <Botao variante="secundario" aoClicar={() => void reimprimir()}>
            Reimprimir cupom
          </Botao>
          {podeCancelar && !cancelada && (
            <Botao variante="perigo" aoClicar={() => setCancelando(true)}>
              Cancelar venda
            </Botao>
          )}
        </div>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="pdv-cartoes-detalhe">
        <Cartao titulo="Dados">
          <div className="pdv-caixa-linha">
            <span>Data</span>
            <strong>{formatarDataHora(d.criadoEm)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Origem</span>
            <Selo cor="azul">{ROTULOS_ORIGEM_VENDA[d.origem] ?? d.origem}</Selo>
          </div>
          <div className="pdv-caixa-linha">
            <span>Situação</span>
            {cancelada ? <Selo cor="vermelho">Cancelada</Selo> : <Selo cor="verde">Concluída</Selo>}
          </div>
          <div className="pdv-caixa-linha">
            <span>Loja</span>
            <strong>{d.loja}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Operador</span>
            <strong>{d.operador}</strong>
          </div>
          {d.vendedor && (
            <div className="pdv-caixa-linha">
              <span>Vendedor</span>
              <strong>{d.vendedor}</strong>
            </div>
          )}
          <div className="pdv-caixa-linha">
            <span>Cliente</span>
            <strong>{d.cliente ? `${d.cliente.nome}${d.cliente.cpfCnpj ? ` · ${d.cliente.cpfCnpj}` : ''}` : 'Consumidor'}</strong>
          </div>
          {d.cpfNota && (
            <div className="pdv-caixa-linha">
              <span>CPF na nota</span>
              <strong>{d.cpfNota}</strong>
            </div>
          )}
          {d.observacao && <p className="pdv-caixa-texto">{d.observacao}</p>}
          {cancelada && d.motivoCancelamento && (
            <Aviso tipo="info">Cancelada: {d.motivoCancelamento}</Aviso>
          )}
        </Cartao>

        <Cartao titulo="Totais">
          <div className="pdv-caixa-linha">
            <span>Subtotal</span>
            <strong>{formatarMoeda(d.subtotal)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Desconto</span>
            <strong>{formatarMoeda(d.desconto)}</strong>
          </div>
          {d.acrescimo > 0 && (
            <div className="pdv-caixa-linha">
              <span>Acréscimo</span>
              <strong>{formatarMoeda(d.acrescimo)}</strong>
            </div>
          )}
          <div className="pdv-caixa-linha">
            <span>Total</span>
            <strong>{formatarMoeda(d.total)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Troco</span>
            <strong>{formatarMoeda(d.troco)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Custo</span>
            <strong>{formatarMoeda(d.custoTotal)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Lucro</span>
            <strong>{formatarMoeda(d.lucro)}</strong>
          </div>
        </Cartao>

        <Cartao titulo="Pagamentos">
          {d.pagamentos.map((p, i) => (
            <div key={i} className="pdv-caixa-linha">
              <span>
                {ROTULOS_FORMA_PAGAMENTO[p.forma] ?? p.forma}
                {p.parcelas > 1 ? ` · ${p.parcelas}x` : ''}
              </span>
              <strong>{formatarMoeda(p.valor)}</strong>
            </div>
          ))}
        </Cartao>

        <Cartao titulo="Notas fiscais">
          {d.notas.length === 0 ? (
            <p className="pdv-caixa-texto">Nenhuma nota emitida para esta venda.</p>
          ) : (
            d.notas.map((n) => (
              <div key={n.id} className="pdv-caixa-linha">
                <span>
                  {n.modelo === 'NFE' ? 'NF-e' : 'NFC-e'} nº {n.numero} · {n.status}
                  {n.simulada ? ' (simulada)' : ''}
                </span>
                <Botao
                  variante="texto"
                  aoClicar={() => {
                    baixarArquivo(`/fiscal/notas/${n.id}/xml`, `nfce-${n.numero}.xml`).catch((e: unknown) =>
                      setErro(mensagemErro(e)),
                    );
                  }}
                >
                  Baixar XML
                </Botao>
              </div>
            ))
          )}
        </Cartao>

        {d.entrega && (
          <Cartao titulo="Entrega">
            <div className="pdv-caixa-linha">
              <span>Código de rastreio</span>
              <strong>{d.entrega.codigo}</strong>
            </div>
            <div className="pdv-caixa-linha">
              <span>Situação</span>
              <strong>{d.entrega.status}</strong>
            </div>
          </Cartao>
        )}
      </div>

      <Cartao titulo="Itens">
        <Tabela
          colunas={[
            { titulo: 'Descrição', celula: (i: ItemDetalhe) => i.descricao },
            {
              titulo: 'Quantidade',
              alinhar: 'direita',
              celula: (i: ItemDetalhe) => formatarQuantidade(i.quantidade, i.unidade),
            },
            { titulo: 'Preço', alinhar: 'direita', celula: (i: ItemDetalhe) => formatarMoeda(i.precoUnitario) },
            { titulo: 'Desconto', alinhar: 'direita', celula: (i: ItemDetalhe) => formatarMoeda(i.desconto) },
            {
              titulo: 'Promoção',
              celula: (i: ItemDetalhe) => (i.promocao ? <Selo cor="verde">{i.promocao}</Selo> : '—'),
            },
            { titulo: 'Total', alinhar: 'direita', celula: (i: ItemDetalhe) => formatarMoeda(i.total) },
          ]}
          dados={d.itens}
          chave={(i) => `${i.descricao}-${i.total}-${i.quantidade}`}
          vazio="Venda sem itens."
        />
      </Cartao>

      <Modal aberto={cancelando} titulo="Cancelar venda" aoFechar={() => setCancelando(false)}>
        <p className="pdv-caixa-texto">
          A venda será cancelada, o estoque volta e o fiado (se houver) é desfeito. Esta ação não se desfaz.
        </p>
        <AreaTexto rotulo="Motivo do cancelamento" valor={motivo} aoMudar={setMotivo} linhas={3} />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={() => setCancelando(false)}>
            Voltar
          </Botao>
          <Botao variante="perigo" aoClicar={() => void cancelar()} desabilitado={enviando || motivo.trim().length < 3}>
            Cancelar venda
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
