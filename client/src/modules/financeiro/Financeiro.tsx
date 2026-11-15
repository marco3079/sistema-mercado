import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { hojeIso, lerNumero, mensagemErro, ROTULOS_FORMA_PAGAMENTO } from '../../lib/mercado';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarData,
  formatarMoeda,
} from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { Lancamento, SeletorCliente } from './Lancamento';
import type {
  BoletoCriado,
  ClienteEscolhido,
  LancamentoDTO,
  ListaLancamentos,
  ResumoFinanceiro,
  TipoLancamento,
} from './tipos';

type Aba = 'receber' | 'pagar' | 'pagos';

const ROTULO_ORIGEM: Record<string, string> = {
  VENDA: 'Venda',
  COMPRA: 'Compra',
  FIADO: 'Fiado',
  BONIFICACAO: 'Bonificação',
};

function situacaoDe(l: LancamentoDTO): { cor: 'verde' | 'amarelo' | 'vermelho'; rotulo: string } {
  if (l.pagoEm) return { cor: 'verde', rotulo: 'Pago' };
  if (l.vencido) return { cor: 'vermelho', rotulo: 'Vencido' };
  return { cor: 'amarelo', rotulo: 'Em aberto' };
}

// Tela de contas a pagar e receber (GESTOR edita; CONTADOR só consulta).
export function Financeiro() {
  const { usuario } = useAuth();
  const podeEditar = usuario?.perfil === 'GESTOR';

  const [aba, setAba] = useState<Aba>('receber');
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [edicao, setEdicao] = useState<{ tipo: TipoLancamento; lancamento: LancamentoDTO | null } | null>(null);
  const [pagando, setPagando] = useState<LancamentoDTO | null>(null);
  const [boletoAberto, setBoletoAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const resumo = useDados<ResumoFinanceiro>('/financeiro/resumo');

  // Em aberto: sem período (mostra também os vencidos antigos), a não ser que o usuário escolha datas.
  // Pagos: sem datas, o servidor usa os últimos 30 dias.
  const params = new URLSearchParams();
  if (aba === 'pagos') {
    params.set('situacao', 'pago');
  } else {
    params.set('situacao', 'aberto');
    params.set('tipo', aba === 'receber' ? 'RECEITA' : 'DESPESA');
  }
  if (de) params.set('inicio', de);
  if (ate) params.set('fim', ate);
  if (busca.trim()) params.set('busca', busca.trim());
  const lista = useDados<ListaLancamentos>(`/financeiro/lancamentos?${params.toString()}`);

  function atualizar() {
    resumo.recarregar();
    lista.recarregar();
  }

  async function estornar(l: LancamentoDTO) {
    setErro(null);
    try {
      await api.post(`/financeiro/lancamentos/${l.id}/estornar`);
      atualizar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function excluir(l: LancamentoDTO) {
    if (!window.confirm(`Excluir o lançamento "${l.descricao}"? Isto não pode ser desfeito.`)) return;
    setErro(null);
    try {
      await api.del(`/financeiro/lancamentos/${l.id}`);
      atualizar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function acoesDe(l: LancamentoDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [];
    if (l.pagoEm) {
      acoes.push({ rotulo: 'Estornar', icone: 'transferir', aoClicar: () => void estornar(l) });
    } else {
      acoes.push({
        rotulo: l.tipo === 'RECEITA' ? 'Registrar recebimento' : 'Registrar pagamento',
        icone: 'dinheiro',
        aoClicar: () => setPagando(l),
      });
    }
    acoes.push({ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEdicao({ tipo: l.tipo, lancamento: l }) });
    if (!l.pagoEm && l.origem === 'MANUAL') {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => void excluir(l) });
    }
    return acoes;
  }

  const colunas: ColunaTabela<LancamentoDTO>[] = [
    {
      titulo: 'Vencimento',
      celula: (l) => <span className={l.vencido ? 'financeiro-vencido' : undefined}>{formatarData(l.vencimento)}</span>,
    },
    {
      titulo: 'Descrição',
      celula: (l) => {
        const detalhes = [
          l.parcela ? `Parcela ${l.parcela}/${l.totalParcelas}` : null,
          l.documento ? `Doc. ${l.documento}` : null,
          l.origem !== 'MANUAL' ? ROTULO_ORIGEM[l.origem] : null,
          aba === 'pagos' ? (l.tipo === 'RECEITA' ? 'Receita' : 'Despesa') : null,
        ].filter(Boolean);
        return (
          <div className="financeiro-texto">
            <span className="financeiro-nome">{l.descricao}</span>
            {detalhes.length > 0 && <span className="financeiro-detalhe">{detalhes.join(' · ')}</span>}
          </div>
        );
      },
    },
    { titulo: 'Categoria', celula: (l) => l.categoria ?? '—' },
    { titulo: 'Cliente / fornecedor', celula: (l) => l.cliente ?? l.fornecedor ?? '—' },
    { titulo: 'Valor', alinhar: 'direita', celula: (l) => formatarMoeda(l.valor) },
    {
      titulo: 'Situação',
      celula: (l) => {
        const s = situacaoDe(l);
        return (
          <div className="financeiro-situacao">
            <Selo cor={s.cor}>{s.rotulo}</Selo>
            {l.pagoEm && (
              <span className="financeiro-detalhe">
                {new Date(l.pagoEm).toLocaleDateString('pt-BR')}
                {l.formaPagamento ? ` · ${ROTULOS_FORMA_PAGAMENTO[l.formaPagamento] ?? l.formaPagamento}` : ''}
              </span>
            )}
          </div>
        );
      },
    },
  ];
  if (podeEditar) {
    colunas.push({
      titulo: 'Ações',
      acoes: true,
      celula: (l) => <MenuAcoes rotulo={`Ações de ${l.descricao}`} acoes={acoesDe(l)} />,
    });
  }

  const resumoDados = resumo.dados;
  const totais = lista.dados?.totais;

  return (
    <Pagina
      titulo="Contas a pagar e receber"
      acoes={
        podeEditar ? (
          <>
            <Botao variante="secundario" aoClicar={() => setBoletoAberto(true)}>
              Emitir boleto
            </Botao>
            <Botao variante="secundario" aoClicar={() => setEdicao({ tipo: 'DESPESA', lancamento: null })}>
              Nova despesa
            </Botao>
            <Botao aoClicar={() => setEdicao({ tipo: 'RECEITA', lancamento: null })}>Nova receita</Botao>
          </>
        ) : undefined
      }
    >
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !resumoDados && <Carregando />}
      {resumoDados && (
        <div className="financeiro-cartoes">
          <div className="cartao">
            <h2 className="cartao-titulo">Vendas de hoje</h2>
            <strong>{formatarMoeda(resumoDados.vendasHoje)}</strong>
            <p className="financeiro-detalhe">No mês: {formatarMoeda(resumoDados.vendasMes)}</p>
          </div>
          <div className="cartao">
            <h2 className="cartao-titulo">A receber</h2>
            <strong>{formatarMoeda(resumoDados.aReceber)}</strong>
            <p className="financeiro-detalhe">Vencido: {formatarMoeda(resumoDados.vencidosReceber)}</p>
          </div>
          <div className="cartao">
            <h2 className="cartao-titulo">A pagar</h2>
            <strong>{formatarMoeda(resumoDados.aPagar)}</strong>
            <p className="financeiro-detalhe">Vencido: {formatarMoeda(resumoDados.vencidosPagar)}</p>
          </div>
          <div className="cartao">
            <h2 className="cartao-titulo">Saldo do mês</h2>
            <strong>{formatarMoeda(resumoDados.saldoMes)}</strong>
            <p className="financeiro-detalhe">Entradas menos saídas pagas no mês</p>
          </div>
        </div>
      )}

      <Abas
        abas={[
          { id: 'receber', rotulo: 'A receber' },
          { id: 'pagar', rotulo: 'A pagar' },
          { id: 'pagos', rotulo: 'Pagos' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as Aba)}
      />

      <div className="financeiro-filtros">
        <Campo rotulo="Vencimento de" tipo="date" valor={de} aoMudar={setDe} />
        <Campo rotulo="até" tipo="date" valor={ate} aoMudar={setAte} />
        <Campo rotulo="Buscar" valor={busca} aoMudar={setBusca} />
      </div>
      <p className="financeiro-nota">
        {aba === 'pagos'
          ? 'Sem datas, mostra os últimos 30 dias pelo vencimento.'
          : 'Sem datas, mostra tudo que está em aberto, inclusive vencido.'}
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados && (
        <>
          <Tabela
            colunas={colunas}
            dados={lista.dados.itens}
            chave={(l) => l.id}
            vazio="Nenhum lançamento neste filtro."
          />
          {totais && (
            <div className="financeiro-totais">
              <span>
                Em aberto: <strong>{formatarMoeda(totais.aberto)}</strong>
              </span>
              <span>
                Vencido: <strong>{formatarMoeda(totais.vencido)}</strong>
              </span>
              <span>
                Pago: <strong>{formatarMoeda(totais.pago)}</strong>
              </span>
            </div>
          )}
        </>
      )}

      {edicao && (
        <Lancamento
          tipoInicial={edicao.tipo}
          lancamento={edicao.lancamento}
          aoFechar={() => setEdicao(null)}
          aoSalvo={() => {
            setEdicao(null);
            atualizar();
          }}
        />
      )}
      {pagando && (
        <ModalPagamento
          lancamento={pagando}
          aoFechar={() => setPagando(null)}
          aoSalvo={() => {
            setPagando(null);
            atualizar();
          }}
        />
      )}
      {boletoAberto && <ModalBoleto aoFechar={() => setBoletoAberto(false)} aoSalvo={atualizar} />}
    </Pagina>
  );
}

// Registrar o pagamento (ou recebimento): forma, data e valor. Valor vazio usa o valor do lançamento.
function ModalPagamento({
  lancamento,
  aoFechar,
  aoSalvo,
}: {
  lancamento: LancamentoDTO;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const [forma, setForma] = useState('PIX');
  const [data, setData] = useState(hojeIso());
  const [valor, setValor] = useState(String(lancamento.valor).replace('.', ','));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorNumero = lerNumero(valor);
    if (valorNumero === null || valorNumero <= 0) return setErro('Informe um valor maior que zero.');
    if (!forma) return setErro('Escolha a forma de pagamento.');
    setEnviando(true);
    try {
      await api.post(`/financeiro/lancamentos/${lancamento.id}/pagar`, {
        formaPagamento: forma,
        pagoEm: data,
        valorPago: Number(valorNumero.toFixed(2)),
      });
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const opcoesForma = Object.entries(ROTULOS_FORMA_PAGAMENTO).map(([valorForma, rotulo]) => ({
    valor: valorForma,
    rotulo,
  }));

  return (
    <Modal
      aberto
      titulo={lancamento.tipo === 'RECEITA' ? 'Registrar recebimento' : 'Registrar pagamento'}
      aoFechar={aoFechar}
    >
      <form className="financeiro-form" onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <p>
          <strong>{lancamento.descricao}</strong> · vence em {formatarData(lancamento.vencimento)}
        </p>
        <Selecao rotulo="Forma" valor={forma} aoMudar={setForma} opcoes={opcoesForma} obrigatorio />
        <div className="financeiro-linha">
          <Campo rotulo="Data" tipo="date" valor={data} aoMudar={setData} obrigatorio />
          <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
        </div>
        <div className="financeiro-acoes-modal">
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Confirmar'}
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Boleto híbrido simulado: linha digitável e Pix copia e cola (se a empresa tem chave Pix).
function ModalBoleto({ aoFechar, aoSalvo }: { aoFechar: () => void; aoSalvo: () => void }) {
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(null);
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(hojeIso(30));
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<BoletoCriado | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function emitir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorNumero = lerNumero(valor);
    if (!cliente) return setErro('Escolha o cliente.');
    if (valorNumero === null || valorNumero <= 0) return setErro('Informe um valor maior que zero.');
    if (!vencimento) return setErro('Informe o vencimento.');
    if (!descricao.trim()) return setErro('Informe a descrição.');
    setEnviando(true);
    try {
      const criado = await api.post<BoletoCriado>('/financeiro/boletos', {
        clienteId: cliente.id,
        valor: Number(valorNumero.toFixed(2)),
        vencimento,
        descricao: descricao.trim(),
      });
      setResultado(criado);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  async function copiar(texto: string) {
    setAviso(null);
    try {
      await navigator.clipboard.writeText(texto);
      setAviso('Copiado.');
    } catch {
      setAviso('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }

  return (
    <Modal aberto titulo="Emitir boleto" aoFechar={aoFechar}>
      {resultado ? (
        <div className="financeiro-form">
          <Aviso tipo="sucesso">Boleto emitido para {resultado.cliente ?? 'o cliente'}.</Aviso>
          <p className="financeiro-detalhe">Boleto simulado: a linha digitável não tem registro em banco.</p>
          <div className="financeiro-bloco">
            <span className="campo-rotulo">Linha digitável</span>
            <code className="financeiro-linha-digitavel">{resultado.linhaDigitavel}</code>
          </div>
          {resultado.pixCopiaECola ? (
            <div className="financeiro-bloco">
              <span className="campo-rotulo">Pix copia e cola</span>
              <textarea className="campo-controle" rows={3} readOnly value={resultado.pixCopiaECola} />
              <Botao variante="secundario" aoClicar={() => void copiar(resultado.pixCopiaECola ?? '')}>
                Copiar código Pix
              </Botao>
            </div>
          ) : (
            <p className="financeiro-detalhe">Sem chave Pix cadastrada: configure em Configurações &gt; Mercado.</p>
          )}
          {aviso && <Aviso tipo="info">{aviso}</Aviso>}
          <div className="financeiro-acoes-modal">
            <Botao aoClicar={aoFechar}>Fechar</Botao>
          </div>
        </div>
      ) : (
        <form className="financeiro-form" onSubmit={emitir}>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <SeletorCliente selecionado={cliente} aoMudar={setCliente} />
          <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />
          <div className="financeiro-linha">
            <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
            <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} obrigatorio />
          </div>
          <div className="financeiro-acoes-modal">
            <Botao variante="secundario" aoClicar={aoFechar}>
              Cancelar
            </Botao>
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Emitindo...' : 'Emitir boleto'}
            </Botao>
          </div>
        </form>
      )}
    </Modal>
  );
}
