import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { hojeIso, lerNumero, mensagemErro } from '../../lib/mercado';
import { AreaTexto, Aviso, Botao, Caixa, Campo, Modal, Selecao } from '../../ui';
import type {
  CategoriaFinanceira,
  ClienteBusca,
  ClienteEscolhido,
  FornecedorOpcao,
  LancamentoDTO,
  TipoLancamento,
} from './tipos';

// Modal de criar ou editar um lançamento. Ao criar: parcelas (divide o valor) ou repetição mensal (12 meses).
// Ao editar: o tipo não muda (o servidor confere a categoria pelo tipo atual).
export function Lancamento({
  tipoInicial,
  lancamento,
  aoFechar,
  aoSalvo,
}: {
  tipoInicial: TipoLancamento;
  lancamento: LancamentoDTO | null;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const editando = lancamento !== null;
  const [tipo, setTipo] = useState<TipoLancamento>(lancamento?.tipo ?? tipoInicial);
  const [descricao, setDescricao] = useState(lancamento?.descricao ?? '');
  const [valor, setValor] = useState(lancamento ? String(lancamento.valor).replace('.', ',') : '');
  const [vencimento, setVencimento] = useState(lancamento?.vencimento ?? hojeIso());
  const [categoriaId, setCategoriaId] = useState(lancamento?.categoriaId ? String(lancamento.categoriaId) : '');
  const [fornecedorId, setFornecedorId] = useState(lancamento?.fornecedorId ? String(lancamento.fornecedorId) : '');
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(
    lancamento?.clienteId && lancamento.cliente ? { id: lancamento.clienteId, nome: lancamento.cliente } : null
  );
  const [documento, setDocumento] = useState(lancamento?.documento ?? '');
  const [linhaDigitavel, setLinhaDigitavel] = useState(lancamento?.linhaDigitavel ?? '');
  const [observacao, setObservacao] = useState(lancamento?.observacao ?? '');
  const [parcelas, setParcelas] = useState('1');
  const [recorrente, setRecorrente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categorias = useDados<CategoriaFinanceira[]>('/financeiro/categorias');
  const fornecedores = useDados<FornecedorOpcao[]>(tipo === 'DESPESA' ? '/fornecedores' : null);

  const opcoesCategoria = (categorias.dados ?? [])
    .filter((c) => c.tipo === tipo)
    .map((c) => ({ valor: String(c.id), rotulo: c.nome }));
  const opcoesFornecedor = (fornecedores.dados ?? [])
    .filter((f) => f.ativo !== false)
    .map((f) => ({ valor: String(f.id), rotulo: f.nome }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valorNumero = lerNumero(valor);
    const numParcelas = Number(parcelas) || 1;
    if (!descricao.trim()) return setErro('Informe a descrição.');
    if (valorNumero === null || valorNumero <= 0) return setErro('Informe um valor maior que zero.');
    if (!vencimento) return setErro('Informe o vencimento.');
    if (!editando && !recorrente && (!Number.isInteger(numParcelas) || numParcelas < 1 || numParcelas > 60)) {
      return setErro('Parcelas entre 1 e 60.');
    }

    const corpo = {
      descricao: descricao.trim(),
      valor: Number(valorNumero.toFixed(2)),
      vencimento,
      categoriaId: categoriaId ? Number(categoriaId) : null,
      fornecedorId: fornecedorId ? Number(fornecedorId) : null,
      clienteId: cliente ? cliente.id : null,
      documento: documento.trim() || null,
      linhaDigitavel: linhaDigitavel.trim() || null,
      observacao: observacao.trim() || null,
    };

    setEnviando(true);
    try {
      if (editando) {
        await api.put(`/financeiro/lancamentos/${lancamento.id}`, corpo);
      } else {
        await api.post('/financeiro/lancamentos', {
          ...corpo,
          tipo,
          parcelas: !recorrente && numParcelas > 1 ? numParcelas : undefined,
          recorrente: recorrente ? 'MENSAL' : undefined,
        });
      }
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const titulo = editando ? 'Editar lançamento' : tipo === 'RECEITA' ? 'Nova receita' : 'Nova despesa';

  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      <form className="financeiro-form" onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {!editando && (
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={(v) => {
              setTipo(v === 'DESPESA' ? 'DESPESA' : 'RECEITA');
              setCategoriaId('');
              setFornecedorId('');
              setCliente(null);
            }}
            opcoes={[
              { valor: 'RECEITA', rotulo: 'Receita (a receber)' },
              { valor: 'DESPESA', rotulo: 'Despesa (a pagar)' },
            ]}
          />
        )}

        <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />

        <div className="financeiro-linha">
          <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
          <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} obrigatorio />
        </div>

        <Selecao
          rotulo="Categoria"
          valor={categoriaId}
          aoMudar={setCategoriaId}
          opcoes={opcoesCategoria}
          vazio="Sem categoria"
        />

        {tipo === 'DESPESA' ? (
          <Selecao
            rotulo="Fornecedor"
            valor={fornecedorId}
            aoMudar={setFornecedorId}
            opcoes={opcoesFornecedor}
            vazio="Sem fornecedor"
          />
        ) : (
          <SeletorCliente selecionado={cliente} aoMudar={setCliente} />
        )}

        <div className="financeiro-linha">
          <Campo rotulo="Nº do documento" valor={documento} aoMudar={setDocumento} />
          <Campo rotulo="Linha digitável" valor={linhaDigitavel} aoMudar={setLinhaDigitavel} />
        </div>

        <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />

        {!editando && (
          <div className="financeiro-linha">
            {!recorrente && (
              <Campo rotulo="Parcelas (divide o valor)" tipo="number" valor={parcelas} aoMudar={setParcelas} />
            )}
            <div className="financeiro-recorrencia">
              <Caixa
                rotulo="Repetir todo mês por 12 meses (cada mês com o valor cheio)"
                marcado={recorrente}
                aoMudar={setRecorrente}
              />
            </div>
          </div>
        )}

        <div className="financeiro-acoes-modal">
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// Escolha de cliente pela busca (nome, CPF/CNPJ ou telefone). Usado também no boleto.
export function SeletorCliente({
  selecionado,
  aoMudar,
  rotulo = 'Cliente',
}: {
  selecionado: ClienteEscolhido | null;
  aoMudar: (cliente: ClienteEscolhido | null) => void;
  rotulo?: string;
}) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);

  useEffect(() => {
    const busca = termo.trim();
    if (busca.length < 2) {
      setResultados([]);
      return;
    }
    let cancelado = false;
    const espera = window.setTimeout(() => {
      api
        .get<ClienteBusca[]>(`/clientes?busca=${encodeURIComponent(busca)}`)
        .then((lista) => {
          if (!cancelado) setResultados(lista.slice(0, 8));
        })
        .catch(() => {
          if (!cancelado) setResultados([]);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [termo]);

  if (selecionado) {
    return (
      <div className="financeiro-cliente">
        <span className="campo-rotulo">{rotulo}</span>
        <div className="financeiro-cliente-escolhido">
          <strong>{selecionado.nome}</strong>
          <Botao variante="texto" aoClicar={() => aoMudar(null)}>
            Trocar
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="financeiro-cliente">
      <Campo rotulo={`${rotulo} (digite o nome ou CPF/CNPJ)`} valor={termo} aoMudar={setTermo} />
      {resultados.length > 0 && (
        <ul className="financeiro-sugestoes">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="financeiro-sugestao"
                onClick={() => {
                  aoMudar({ id: c.id, nome: c.nome });
                  setTermo('');
                  setResultados([]);
                }}
              >
                {c.nome}
                {c.cpfCnpj && <span className="financeiro-detalhe"> {c.cpfCnpj}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
