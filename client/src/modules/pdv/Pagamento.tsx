import { useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { usePlataforma } from '../../lib/plataforma';
import { ROTULOS_FORMA_PAGAMENTO, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Selecao, formatarMoeda } from '../../ui';
import { imprimirCupom } from './cupom';
import type {
  ConfigMercadoPublico,
  DetalheVendaDTO,
  FormaPagamentoPdv,
  ItemCarrinho,
  PagamentoMontado,
  ResultadoVendaDTO,
} from './tipos';

// Pagamento da venda (dentro do modal do PDV): formas, Pix, troco e confirmação.
// O servidor é quem grava a venda e confere o pagamento; aqui só se monta a lista.

interface PagamentoProps {
  total: number;
  itens: ItemCarrinho[];
  clienteId: number | null;
  clienteBloqueado: boolean;
  cpfNota: string;
  desconto: number;
  itensCancelados: number;
  // Chamado quando a venda foi gravada: a tela do PDV zera o carrinho.
  aoConcluir: () => void;
  // Botão "Nova venda" depois do cupom.
  aoNovaVenda: () => void;
}

const FORMAS: { id: FormaPagamentoPdv; rotulo: string }[] = [
  { id: 'DINHEIRO', rotulo: 'Dinheiro' },
  { id: 'PIX', rotulo: 'Pix' },
  { id: 'DEBITO', rotulo: 'Débito' },
  { id: 'CREDITO', rotulo: 'Crédito' },
  { id: 'VALE_ALIMENTACAO', rotulo: 'Vale-alimentação' },
  { id: 'FIADO', rotulo: 'Fiado' },
];

const PARCELAS = Array.from({ length: 12 }, (_, i) => ({ valor: String(i + 1), rotulo: `${i + 1}x` }));

function arred2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Número para o campo de valor: "12,50".
function paraCampo(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

export function Pagamento({
  total,
  itens,
  clienteId,
  clienteBloqueado,
  cpfNota,
  desconto,
  itensCancelados,
  aoConcluir,
  aoNovaVenda,
}: PagamentoProps) {
  const config = useDados<ConfigMercadoPublico>('/configuracoes/mercado/publico');
  const { plataforma } = usePlataforma();

  const [pagamentos, setPagamentos] = useState<PagamentoMontado[]>([]);
  const [forma, setForma] = useState<FormaPagamentoPdv>('DINHEIRO');
  const [valor, setValor] = useState(paraCampo(total));
  const [parcelas, setParcelas] = useState('1');
  const [autorizacao, setAutorizacao] = useState('');
  const [pix, setPix] = useState<{ codigo: string; valor: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [venda, setVenda] = useState<ResultadoVendaDTO | null>(null);

  const pago = arred2(pagamentos.reduce((s, p) => s + p.valor, 0));
  const restante = arred2(total - pago);
  const faltaPagar = restante > 0.009;
  const fiadoDisponivel = config.dados?.fiadoAtivo === true && clienteId !== null && !clienteBloqueado;

  // Troco só existe no dinheiro: o que foi entregue além do restante.
  const valorDigitado = lerNumero(valor);
  const troco = forma === 'DINHEIRO' && valorDigitado !== null && faltaPagar && valorDigitado > restante
    ? arred2(valorDigitado - restante)
    : 0;

  function restanteAposPagar(valorPago: number): string {
    const r = arred2(total - (pago + valorPago));
    return r > 0.009 ? paraCampo(r) : '';
  }

  function escolherForma(f: FormaPagamentoPdv) {
    setForma(f);
    setErro(null);
    setPix(null);
    setCopiado(false);
    setValor(faltaPagar ? paraCampo(restante) : '');
  }

  function adicionarPagamento() {
    const v = lerNumero(valor);
    if (v === null || v <= 0) {
      setErro('Informe um valor maior que zero');
      return;
    }
    if (forma === 'FIADO' && !fiadoDisponivel) {
      setErro('Fiado só com cliente sem bloqueio e com o fiado ativo');
      return;
    }
    const p: PagamentoMontado = { forma, valor: arred2(v) };
    if (forma === 'CREDITO') p.parcelas = Number(parcelas);
    if (forma === 'DEBITO' || forma === 'CREDITO') p.autorizacao = autorizacao.trim() || null;
    setPagamentos((prev) => [...prev, p]);
    setValor(restanteAposPagar(arred2(v)));
    setAutorizacao('');
    setErro(null);
  }

  function removerPagamento(indice: number) {
    setPagamentos((prev) => prev.filter((_, i) => i !== indice));
    setErro(null);
  }

  async function gerarPix() {
    const v = lerNumero(valor);
    if (v === null || v <= 0) {
      setErro('Informe o valor do Pix');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{ copiaECola: string; chave: string }>('/pdv/pix', { valor: arred2(v) });
      setPix({ codigo: r.copiaECola, valor: arred2(v) });
      setCopiado(false);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function copiarPix() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.codigo);
      setCopiado(true);
    } catch {
      setErro('Não foi possível copiar. Selecione o texto e copie.');
    }
  }

  // Só depois que o cliente confirmou o Pix na tela, o pagamento entra na lista.
  function pixRecebido() {
    if (!pix) return;
    setPagamentos((prev) => [...prev, { forma: 'PIX', valor: pix.valor }]);
    setValor(restanteAposPagar(pix.valor));
    setPix(null);
    setCopiado(false);
    setErro(null);
  }

  async function confirmar() {
    if (faltaPagar) {
      setErro(`Faltam ${formatarMoeda(restante)} para fechar a venda`);
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<ResultadoVendaDTO>('/pdv/vendas', {
        itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
        pagamentos,
        clienteId,
        desconto: desconto > 0 ? desconto : 0,
        cpfNota: cpfNota || null,
        itensCancelados,
      });
      setVenda(r);
      aoConcluir();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function imprimir() {
    if (!venda) return;
    try {
      const detalhe = await api.get<DetalheVendaDTO>(`/vendas/${venda.vendaId}/cupom`);
      imprimirCupom(detalhe, plataforma.nome);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  // ---------- Venda gravada ----------

  if (venda) {
    return (
      <div className="pdv-sucesso">
        <p className="pdv-sucesso-titulo">Venda nº {venda.numero} concluída</p>
        <p className="pdv-troco-rotulo">Troco</p>
        <p className="pdv-troco">{formatarMoeda(venda.troco)}</p>
        {venda.nota && <p className="pdv-texto">Nota fiscal nº {venda.nota.numero} emitida.</p>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={() => void imprimir()}>
            Imprimir cupom
          </Botao>
          <Botao aoClicar={aoNovaVenda}>Nova venda</Botao>
        </div>
      </div>
    );
  }

  // ---------- Montagem dos pagamentos ----------

  return (
    <div className="pdv-pagamento">
      <div className="pdv-pagamento-totais">
        <div>
          <span>Total</span>
          <strong>{formatarMoeda(total)}</strong>
        </div>
        <div>
          <span>{restante < -0.009 ? 'Troco' : 'Restante'}</span>
          <strong>{formatarMoeda(Math.abs(restante))}</strong>
        </div>
      </div>

      {pagamentos.length > 0 && (
        <ul className="pdv-pagamentos">
          {pagamentos.map((p, i) => (
            <li key={i}>
              <span>
                {ROTULOS_FORMA_PAGAMENTO[p.forma] ?? p.forma}
                {p.parcelas && p.parcelas > 1 ? ` ${p.parcelas}x` : ''}
              </span>
              <span>{formatarMoeda(p.valor)}</span>
              <button type="button" className="pdv-remover" aria-label="Remover pagamento" onClick={() => removerPagamento(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pdv-formas" role="group" aria-label="Forma de pagamento">
        {FORMAS.map((f) => {
          const bloqueada = f.id === 'FIADO' && !fiadoDisponivel;
          return (
            <button
              key={f.id}
              type="button"
              className={forma === f.id ? 'pdv-forma pdv-forma-ativa' : 'pdv-forma'}
              disabled={bloqueada}
              onClick={() => escolherForma(f.id)}
            >
              {f.rotulo}
            </button>
          );
        })}
      </div>
      {!fiadoDisponivel && <p className="pdv-texto">Fiado: escolha um cliente sem bloqueio e com o fiado ativo.</p>}

      <div className="pdv-pagamento-campos">
        <Campo
          rotulo={forma === 'DINHEIRO' ? 'Valor recebido' : 'Valor'}
          valor={valor}
          aoMudar={setValor}
        />
        {troco > 0 && <p className="pdv-troco-previa">Troco: {formatarMoeda(troco)}</p>}
        {forma === 'CREDITO' && <Selecao rotulo="Parcelas" valor={parcelas} aoMudar={setParcelas} opcoes={PARCELAS} />}
        {(forma === 'DEBITO' || forma === 'CREDITO') && (
          <Campo rotulo="NSU / autorização (opcional)" valor={autorizacao} aoMudar={setAutorizacao} />
        )}
      </div>

      {forma === 'PIX' ? (
        <div className="pdv-pix">
          {!pix ? (
            <Botao aoClicar={() => void gerarPix()} desabilitado={enviando || !faltaPagar}>
              Gerar Pix
            </Botao>
          ) : (
            <>
              <label className="campo">
                <span className="campo-rotulo">Pix copia e cola ({formatarMoeda(pix.valor)})</span>
                <textarea className="campo-controle pdv-pix-texto" readOnly rows={4} value={pix.codigo} />
              </label>
              <div className="pdv-acoes-modal">
                <Botao variante="secundario" aoClicar={() => void copiarPix()}>
                  {copiado ? 'Código copiado' : 'Copiar código'}
                </Botao>
                <Botao aoClicar={pixRecebido}>Pix recebido</Botao>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={adicionarPagamento} desabilitado={!faltaPagar}>
            Adicionar pagamento
          </Botao>
        </div>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="pdv-acoes-modal">
        <Botao aoClicar={() => void confirmar()} desabilitado={faltaPagar || enviando || pagamentos.length === 0}>
          Confirmar venda
        </Botao>
      </div>
    </div>
  );
}
