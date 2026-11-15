import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { rajada } from '../../lib/tempoReal';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selo, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { Pagamento } from './Pagamento';
import type {
  CalculoDTO,
  CaixaAtualDTO,
  ClienteBusca,
  ItemCarrinho,
  LeituraPdv,
  ProdutoPdv,
} from './tipos';
import './pdv.css';

// Frente de caixa: código de barras no campo (sempre com o foco), itens, total e atalhos de teclado.
// Só vende com o caixa aberto. O carrinho fica no sessionStorage para não se perder ao recarregar.

const CHAVE_RASCUNHO = 'pdv.carrinho';

interface Rascunho {
  itens: ItemCarrinho[];
  cliente: ClienteBusca | null;
  cpfNota: string;
  descontoManual: number;
  itensCancelados: number;
}

// Sem armazenamento disponível (aba privada, bloqueio), o PDV segue sem rascunho.
function lerRascunho(): Rascunho | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_RASCUNHO);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho;
    return Array.isArray(r.itens) ? r : null;
  } catch {
    return null;
  }
}

function gravarRascunho(r: Rascunho): void {
  try {
    sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
  } catch {
    // Sem armazenamento: o carrinho continua só na tela.
  }
}

function arred2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function arred3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

type ModalPdv = 'produto' | 'quantidade' | 'cliente' | 'cpf' | 'desconto' | 'cancelarVenda' | 'pagamento';

export function Pdv() {
  const caixa = useDados<CaixaAtualDTO | null>('/caixas/atual');
  const caixaAberto = caixa.dados !== null;

  const [rascunho] = useState<Rascunho | null>(() => lerRascunho());
  const [itens, setItens] = useState<ItemCarrinho[]>(rascunho?.itens ?? []);
  const [cliente, setCliente] = useState<ClienteBusca | null>(rascunho?.cliente ?? null);
  const [cpfNota, setCpfNota] = useState(rascunho?.cpfNota ?? '');
  const [descontoManual, setDescontoManual] = useState(rascunho?.descontoManual ?? 0);
  const [itensCancelados, setItensCancelados] = useState(rascunho?.itensCancelados ?? 0);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [calculo, setCalculo] = useState<CalculoDTO | null>(null);
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'info'; texto: string } | null>(null);

  const [modal, setModal] = useState<ModalPdv | null>(null);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [resultadosProduto, setResultadosProduto] = useState<ProdutoPdv[]>([]);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [resultadosCliente, setResultadosCliente] = useState<ClienteBusca[]>([]);
  const [valorQuantidade, setValorQuantidade] = useState('');
  const [valorDesconto, setValorDesconto] = useState('');
  const [valorCpf, setValorCpf] = useState('');

  const codigoRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  // O cálculo espera 250 ms de silêncio no carrinho. O timer chama a versão mais nova desta função.
  const calcularRef = useRef<() => void>(() => {});
  const agendaRef = useRef<ReturnType<typeof rajada> | null>(null);
  if (agendaRef.current === null) {
    agendaRef.current = rajada(() => calcularRef.current(), 250);
  }

  calcularRef.current = () => {
    const minha = ++seq.current;
    api
      .post<CalculoDTO>('/pdv/calcular', {
        itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
        clienteId: cliente?.id ?? null,
      })
      .then((r) => {
        if (minha === seq.current) setCalculo(r);
      })
      .catch((e: unknown) => {
        if (minha === seq.current) setAviso({ tipo: 'erro', texto: mensagemErro(e) });
      });
  };

  // Cada mudança no carrinho grava o rascunho e pede novo cálculo de preços e promoções.
  useEffect(() => {
    gravarRascunho({ itens, cliente, cpfNota, descontoManual, itensCancelados });
  });

  useEffect(() => {
    if (itens.length === 0) {
      seq.current++;
      setCalculo(null);
      return;
    }
    agendaRef.current?.disparar();
  }, [itens, cliente]);

  // Foco sempre no campo de código, de volta depois de cada modal.
  useEffect(() => {
    if (modal === null) codigoRef.current?.focus();
  }, [modal]);

  const bruto = calculo?.total ?? 0;
  const subtotal = calculo?.subtotal ?? 0;
  const descontoPromocoes = calculo?.descontoPromocoes ?? 0;
  const descontoAplicado = Math.min(descontoManual, bruto);
  const total = arred2(Math.max(0, bruto - descontoAplicado));
  const ultimo = itens.length > 0 ? itens[itens.length - 1] : null;
  const selecionado = itens.find((i) => i.produtoId === selecionadoId) ?? ultimo;
  const calculoEmDia =
    calculo !== null && itens.every((i) => calculo.itens.some((c) => c.produtoId === i.produtoId && c.quantidade === i.quantidade));

  function precoDe(produtoId: number) {
    return calculo?.itens.find((c) => c.produtoId === produtoId) ?? null;
  }

  // Cálculo do último item lido (destaque no topo da lista).
  const precoUltimo = ultimo ? precoDe(ultimo.produtoId) : null;

  function focarCodigo() {
    codigoRef.current?.focus();
  }

  function abrirModal(m: ModalPdv) {
    setErroModal(null);
    setModal(m);
  }

  function fecharModal() {
    setModal(null);
    setErroModal(null);
  }

  // Ação sensível: o servidor pede a senha do gestor quando a regra do mercado pedir.
  async function autorizar(acao: 'CANCELAR_ITEM' | 'DESCONTO_MANUAL'): Promise<boolean> {
    try {
      await api.post('/pdv/autorizar', { acao });
      return true;
    } catch (e) {
      const texto = mensagemErro(e);
      if (texto !== 'Ação cancelada') setAviso({ tipo: 'erro', texto });
      return false;
    }
  }

  function adicionar(produto: ProdutoPdv, quantidade: number) {
    setItens((prev) => {
      const i = prev.findIndex((x) => x.produtoId === produto.id);
      if (i >= 0) {
        return prev.map((x, n) => (n === i ? { ...x, quantidade: arred3(x.quantidade + quantidade) } : x));
      }
      return [
        ...prev,
        {
          produtoId: produto.id,
          codigo: produto.codigo,
          nome: produto.nome,
          unidade: produto.unidade,
          pesavel: produto.pesavel,
          quantidade,
          foto: produto.foto,
          categoria: produto.categoria,
        },
      ];
    });
    setSelecionadoId(null);
    setAviso(null);
  }

  async function lerCodigo(e?: FormEvent) {
    e?.preventDefault();
    const texto = codigo.trim();
    if (!texto || ocupado) return;
    setOcupado(true);
    try {
      const r = await api.post<LeituraPdv>('/pdv/ler', { codigo: texto });
      adicionar(r.produto, r.quantidade);
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setCodigo('');
      setOcupado(false);
      focarCodigo();
    }
  }

  async function cancelarItem(item: ItemCarrinho) {
    if (await autorizar('CANCELAR_ITEM')) {
      setItens((prev) => prev.filter((x) => x.produtoId !== item.produtoId));
      setItensCancelados((n) => n + 1);
      setSelecionadoId(null);
    }
    focarCodigo();
  }

  async function abrirDesconto() {
    if (itens.length === 0) {
      setAviso({ tipo: 'erro', texto: 'Adicione itens antes de dar desconto.' });
      return;
    }
    // A senha do gestor (se a regra pedir) é conferida uma vez só, ao finalizar a venda com desconto.
    setValorDesconto(descontoManual ? String(descontoManual) : '');
    abrirModal('desconto');
  }

  function confirmarDesconto() {
    const n = lerNumero(valorDesconto);
    if (n === null || n < 0) {
      setErroModal('Informe o desconto em reais');
      return;
    }
    if (n > bruto) {
      setErroModal('O desconto não pode passar do total');
      return;
    }
    setDescontoManual(arred2(n));
    fecharModal();
  }

  function confirmarQuantidade() {
    const n = lerNumero(valorQuantidade);
    if (n === null || n <= 0) {
      setErroModal('Informe uma quantidade maior que zero');
      return;
    }
    setItens((prev) => prev.map((x, i) => (i === prev.length - 1 ? { ...x, quantidade: arred3(n) } : x)));
    fecharModal();
  }

  function confirmarCpf() {
    const digitos = valorCpf.replace(/\D/g, '');
    if (digitos && digitos.length !== 11 && digitos.length !== 14) {
      setErroModal('CPF com 11 números ou CNPJ com 14');
      return;
    }
    setCpfNota(digitos);
    fecharModal();
  }

  // Zera a venda na tela (depois de cancelar ou de concluir).
  function limparVenda() {
    setItens([]);
    setCliente(null);
    setCpfNota('');
    setDescontoManual(0);
    setItensCancelados(0);
    setSelecionadoId(null);
    setCalculo(null);
  }

  function cancelarVendaInteira() {
    limparVenda();
    fecharModal();
    setAviso({ tipo: 'info', texto: 'Venda cancelada.' });
  }

  function finalizar() {
    if (itens.length === 0) {
      setAviso({ tipo: 'erro', texto: 'Adicione itens antes de finalizar.' });
      return;
    }
    if (!calculoEmDia) {
      setAviso({ tipo: 'erro', texto: 'Aguarde o cálculo dos preços.' });
      return;
    }
    abrirModal('pagamento');
  }

  // Atalhos. Registrado a cada render: sempre enxerga o estado atual.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!caixaAberto) return;
      if (modal !== null) {
        if (e.key === 'Escape') fecharModal();
        return;
      }
      switch (e.key) {
        case 'F2':
          e.preventDefault();
          setBuscaProduto('');
          abrirModal('produto');
          break;
        case 'F3':
          e.preventDefault();
          if (ultimo) {
            setValorQuantidade(String(ultimo.quantidade));
            abrirModal('quantidade');
          }
          break;
        case 'F4':
          e.preventDefault();
          setBuscaCliente('');
          abrirModal('cliente');
          break;
        case 'F6':
          e.preventDefault();
          void abrirDesconto();
          break;
        case 'F7':
          e.preventDefault();
          setValorCpf(cpfNota);
          abrirModal('cpf');
          break;
        case 'Delete':
          if (codigo === '' && selecionado) {
            e.preventDefault();
            void cancelarItem(selecionado);
          }
          break;
        case 'F9':
          e.preventDefault();
          if (itens.length > 0) abrirModal('cancelarVenda');
          break;
        case 'F10':
        case 'F12':
          e.preventDefault();
          finalizar();
          break;
        case 'Escape':
          setCodigo('');
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Buscas dos modais (com pausa para não pedir a cada tecla).
  useEffect(() => {
    if (modal !== 'produto') return;
    const t = window.setTimeout(() => {
      api
        .get<ProdutoPdv[]>(`/pdv/produtos?busca=${encodeURIComponent(buscaProduto)}`)
        .then(setResultadosProduto)
        .catch((e: unknown) => setErroModal(mensagemErro(e)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [modal, buscaProduto]);

  useEffect(() => {
    if (modal !== 'cliente') return;
    const t = window.setTimeout(() => {
      api
        .get<ClienteBusca[]>(`/clientes?busca=${encodeURIComponent(buscaCliente)}`)
        .then((lista) => setResultadosCliente(lista.slice(0, 20)))
        .catch((e: unknown) => setErroModal(mensagemErro(e)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [modal, buscaCliente]);

  // ---------- Telas de estado ----------

  if (caixa.carregando && caixa.dados === null) {
    return (
      <Pagina titulo="PDV">
        <Carregando />
      </Pagina>
    );
  }
  if (caixa.erro) {
    return (
      <Pagina titulo="PDV">
        <Aviso tipo="erro">{caixa.erro}</Aviso>
      </Pagina>
    );
  }
  if (caixa.dados === null) {
    return (
      <Pagina titulo="PDV">
        <CaixaFechadoPdv aoAbrir={caixa.recarregar} />
      </Pagina>
    );
  }

  const avisoModal = erroModal ? <Aviso tipo="erro">{erroModal}</Aviso> : null;

  return (
    <Pagina
      titulo="PDV"
      acoes={<span className="pdv-caixa-info">Caixa aberto · {caixa.dados.terminal}</span>}
    >
      <div className="pdv">
        <section className="pdv-esquerda" aria-label="Itens da venda">
          <form className="pdv-busca" onSubmit={lerCodigo}>
            <label className="pdv-codigo-rotulo" htmlFor="pdv-codigo">
              Código de barras / código
            </label>
            <input
              id="pdv-codigo"
              ref={codigoRef}
              className="pdv-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </form>

          {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

          {ultimo && (
            <div
              className={selecionado?.produtoId === ultimo.produtoId ? 'pdv-destaque pdv-item-selecionado' : 'pdv-destaque'}
              onClick={() => setSelecionadoId(ultimo.produtoId)}
            >
              <FotoProduto foto={ultimo.foto} nome={ultimo.nome} setor={ultimo.categoria} tamanho={96} />
              <div className="pdv-destaque-corpo">
                <span className="pdv-destaque-rotulo">Último item lido</span>
                <strong className="pdv-destaque-nome">{ultimo.nome}</strong>
                <span className="pdv-item-detalhe">
                  {formatarQuantidade(ultimo.quantidade, ultimo.unidade)} ×{' '}
                  {precoUltimo ? formatarMoeda(precoUltimo.precoUnitario) : '…'}
                </span>
                {precoUltimo?.descricaoPromocao && <Selo cor="verde">{precoUltimo.descricaoPromocao}</Selo>}
              </div>
              <span className="pdv-destaque-total">{precoUltimo ? formatarMoeda(precoUltimo.total) : '…'}</span>
            </div>
          )}

          <ol className="pdv-itens">
            {itens.length === 0 && (
              <li className="pdv-vazio">Nenhum item. Bipe um produto ou aperte F2 para buscar.</li>
            )}
            {itens.slice(0, -1).map((item, n) => {
              const c = precoDe(item.produtoId);
              const eSelecionado = selecionado?.produtoId === item.produtoId;
              return (
                <li
                  key={item.produtoId}
                  className={eSelecionado ? 'pdv-item pdv-item-selecionado' : 'pdv-item'}
                  onClick={() => setSelecionadoId(item.produtoId)}
                >
                  <span className="pdv-item-numero">{n + 1}</span>
                  <FotoProduto foto={item.foto} nome={item.nome} setor={item.categoria} tamanho={40} />
                  <div className="pdv-item-corpo">
                    <strong className="pdv-item-nome">{item.nome}</strong>
                    <span className="pdv-item-detalhe">
                      {formatarQuantidade(item.quantidade, item.unidade)} × {c ? formatarMoeda(c.precoUnitario) : '…'}
                    </span>
                    {c?.descricaoPromocao && <Selo cor="verde">{c.descricaoPromocao}</Selo>}
                  </div>
                  <span className="pdv-item-total">{c ? formatarMoeda(c.total) : '…'}</span>
                </li>
              );
            })}
          </ol>

          {selecionado && (
            <div className="pdv-acoes-item">
              <Botao variante="perigo" aoClicar={() => void cancelarItem(selecionado)}>
                Remover item selecionado (Del)
              </Botao>
            </div>
          )}
        </section>

        <aside className="pdv-direita" aria-label="Total da venda">
          <div className="pdv-cliente">
            <div className="pdv-linha">
              <span>Cliente</span>
              <strong>{cliente ? cliente.nome : 'Sem cliente'}</strong>
            </div>
            <div className="pdv-linha">
              <span>CPF na nota</span>
              <strong>{cpfNota || '—'}</strong>
            </div>
          </div>

          <div className="pdv-resumo">
            <div className="pdv-linha">
              <span>Subtotal</span>
              <strong>{formatarMoeda(subtotal)}</strong>
            </div>
            <div className="pdv-linha">
              <span>Descontos de promoção</span>
              <strong>{formatarMoeda(descontoPromocoes)}</strong>
            </div>
            <div className="pdv-linha">
              <span>Desconto manual</span>
              <strong>{formatarMoeda(descontoAplicado)}</strong>
            </div>
            <div className="pdv-total">
              <span>TOTAL</span>
              <strong>{formatarMoeda(total)}</strong>
            </div>
          </div>

          <div className="pdv-botoes">
            <div className="pdv-finalizar">
              <Botao aoClicar={finalizar} desabilitado={itens.length === 0}>
                Finalizar <kbd>F10</kbd>
              </Botao>
            </div>
            <Botao variante="secundario" aoClicar={() => abrirModal('produto')}>
              <kbd>F2</kbd> Buscar
            </Botao>
            <Botao variante="secundario" aoClicar={() => { if (ultimo) { setValorQuantidade(String(ultimo.quantidade)); abrirModal('quantidade'); } }}>
              <kbd>F3</kbd> Quantidade
            </Botao>
            <Botao variante="secundario" aoClicar={() => { setBuscaCliente(''); abrirModal('cliente'); }}>
              <kbd>F4</kbd> Cliente
            </Botao>
            <Botao variante="secundario" aoClicar={() => void abrirDesconto()}>
              <kbd>F6</kbd> Desconto
            </Botao>
            <Botao variante="secundario" aoClicar={() => { setValorCpf(cpfNota); abrirModal('cpf'); }}>
              <kbd>F7</kbd> CPF na nota
            </Botao>
            <Botao variante="perigo" aoClicar={() => { if (itens.length > 0) abrirModal('cancelarVenda'); }}>
              <kbd>F9</kbd> Cancelar venda
            </Botao>
          </div>
        </aside>
      </div>

      <footer className="pdv-atalhos" aria-label="Atalhos de teclado">
        <span><kbd>F2</kbd> Buscar</span>
        <span><kbd>F3</kbd> Quantidade</span>
        <span><kbd>F4</kbd> Cliente</span>
        <span><kbd>F6</kbd> Desconto</span>
        <span><kbd>F7</kbd> CPF</span>
        <span><kbd>Del</kbd> Cancelar item</span>
        <span><kbd>F9</kbd> Cancelar venda</span>
        <span><kbd>F10</kbd> Finalizar</span>
        <span><kbd>Esc</kbd> Fechar</span>
      </footer>

      <Modal aberto={modal === 'produto'} titulo="Buscar produto" aoFechar={fecharModal}>
        <Campo rotulo="Nome, código ou EAN" valor={buscaProduto} aoMudar={setBuscaProduto} />
        {avisoModal}
        <div className="grade-produtos pdv-grade-busca">
          {resultadosProduto.map((p) => (
            <button
              key={p.id}
              type="button"
              className="cartao-produto pdv-cartao-produto"
              onClick={() => {
                adicionar(p, 1);
                fecharModal();
              }}
            >
              <FotoProduto foto={p.foto} nome={p.nome} setor={p.categoria} preencher />
              <span className="pdv-cartao-nome">{p.nome}</span>
              <span className="cartao-produto-rodape">
                <strong className="numero">{formatarMoeda(p.precoVenda)}</strong>
                <span className="pdv-texto">estoque {formatarQuantidade(p.estoque, p.unidade)}</span>
              </span>
            </button>
          ))}
        </div>
        {resultadosProduto.length === 0 && <p className="pdv-texto">Nenhum produto encontrado.</p>}
      </Modal>

      <Modal aberto={modal === 'quantidade'} titulo="Quantidade do último item" aoFechar={fecharModal}>
        <Campo rotulo="Quantidade" valor={valorQuantidade} aoMudar={setValorQuantidade} />
        {avisoModal}
        <div className="pdv-acoes-modal">
          <Botao aoClicar={confirmarQuantidade}>Confirmar</Botao>
        </div>
      </Modal>

      <Modal aberto={modal === 'cliente'} titulo="Identificar cliente" aoFechar={fecharModal}>
        <Campo rotulo="Nome, CPF ou CNPJ" valor={buscaCliente} aoMudar={setBuscaCliente} />
        {avisoModal}
        <ul className="pdv-resultados">
          {resultadosCliente.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="pdv-resultado"
                onClick={() => {
                  setCliente(c);
                  fecharModal();
                }}
              >
                <span>{c.nome}</span>
                <span>
                  {c.cpfCnpj ?? 'Sem CPF/CNPJ'}
                  {c.bloqueado ? ' · bloqueado para fiado' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pdv-acoes-modal">
          <Botao
            variante="secundario"
            aoClicar={() => {
              setCliente(null);
              fecharModal();
            }}
          >
            Sem cliente
          </Botao>
        </div>
      </Modal>

      <Modal aberto={modal === 'desconto'} titulo="Desconto manual (em reais)" aoFechar={fecharModal}>
        <Campo rotulo="Valor do desconto" valor={valorDesconto} aoMudar={setValorDesconto} />
        {avisoModal}
        <div className="pdv-acoes-modal">
          <Botao aoClicar={confirmarDesconto}>Aplicar desconto</Botao>
        </div>
      </Modal>

      <Modal aberto={modal === 'cpf'} titulo="CPF ou CNPJ na nota" aoFechar={fecharModal}>
        <Campo rotulo="CPF ou CNPJ (opcional)" valor={valorCpf} aoMudar={setValorCpf} />
        {avisoModal}
        <div className="pdv-acoes-modal">
          <Botao aoClicar={confirmarCpf}>Confirmar</Botao>
        </div>
      </Modal>

      <Modal aberto={modal === 'cancelarVenda'} titulo="Cancelar venda" aoFechar={fecharModal}>
        <p className="pdv-texto">
          Todos os itens desta venda serão apagados da tela. Nada foi gravado ainda.
        </p>
        <div className="pdv-acoes-modal">
          <Botao variante="secundario" aoClicar={fecharModal}>
            Voltar
          </Botao>
          <Botao variante="perigo" aoClicar={cancelarVendaInteira}>
            Cancelar venda
          </Botao>
        </div>
      </Modal>

      <Modal aberto={modal === 'pagamento'} titulo="Pagamento" aoFechar={fecharModal}>
        {modal === 'pagamento' && (
          <Pagamento
            total={total}
            itens={itens}
            clienteId={cliente?.id ?? null}
            clienteBloqueado={cliente?.bloqueado ?? false}
            cpfNota={cpfNota}
            desconto={descontoAplicado}
            itensCancelados={itensCancelados}
            aoConcluir={limparVenda}
            aoNovaVenda={fecharModal}
          />
        )}
      </Modal>
    </Pagina>
  );
}

// Cartão mostrado no lugar do PDV quando não há caixa aberto para este operador.
function CaixaFechadoPdv({ aoAbrir }: { aoAbrir: () => void }) {
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    const n = lerNumero(valor);
    if (n === null || n < 0) {
      setErro('Informe o valor de abertura');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/caixas/abrir', { valorAbertura: n });
      aoAbrir();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao pdv-caixa-fechado">
      <span className="pdv-caixa-fechado-icone" aria-hidden="true">
        <Icone nome="dinheiro" tamanho={40} />
      </span>
      <h2 className="pdv-caixa-fechado-titulo">Caixa fechado</h2>
      <p className="pdv-texto">Abra o caixa para começar a vender. Informe o troco que está na gaveta.</p>
      <form className="pdv-caixa-abrir" onSubmit={abrir}>
        <Campo rotulo="Valor de abertura (R$)" valor={valor} aoMudar={setValor} obrigatorio />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Botao tipo="submit" desabilitado={enviando}>
          Abrir caixa
        </Botao>
      </form>
    </section>
  );
}
