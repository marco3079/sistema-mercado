import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  Modal,
  Pagina,
  Selecao,
  Tabela,
  formatarData,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CelulaProduto, FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { MOTIVOS_PERDA, ROTULOS_MOTIVO_PERDA, queryString } from './tipos';
import type { Lote, MotivoPerda, RespostaEstoque, RespostaPerdas, RespostaValidade, ItemPerda } from './tipos';
import './estoque.css';

const ABAS = [
  { id: 'vencendo', rotulo: 'Vencendo' },
  { id: 'vencidos', rotulo: 'Vencidos' },
  { id: 'perdas', rotulo: 'Perdas' },
];

const PRAZOS = [3, 7, 15, 30];

// Vermelho até 2 dias (ou já vencido), amarelo até 7, verde depois.
function corDosDias(dias: number): 'vermelho' | 'amarelo' | 'verde' {
  if (dias <= 2) return 'vermelho';
  if (dias <= 7) return 'amarelo';
  return 'verde';
}

function rotuloVencimento(dias: number): string {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
  if (dias === 0) return 'Vence hoje';
  return `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

const OPCOES_MOTIVO = MOTIVOS_PERDA.map((m) => ({ valor: m, rotulo: ROTULOS_MOTIVO_PERDA[m] }));

// Janela para cadastrar lote de um produto que já está em estoque (não movimenta o saldo).
// Vem da tela de estoque com o produto já escolhido (?cadastrar=ID).
function JanelaCadastrarLote({
  produtoIdInicial,
  aoFechar,
  aoSalvo,
}: {
  produtoIdInicial: string;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const produtos = useDados<RespostaEstoque>('/estoque');
  const [produtoId, setProdutoId] = useState(produtoIdInicial);
  const [codigo, setCodigo] = useState('');
  const [validade, setValidade] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const qtd = lerNumero(quantidade);
    if (!produtoId) return setErro('Escolha o produto.');
    if (!codigo.trim()) return setErro('Informe o código do lote.');
    if (!validade) return setErro('Informe a data de validade.');
    if (qtd === null || qtd <= 0) return setErro('Informe a quantidade do lote.');
    setOcupado(true);
    try {
      await api.post('/lotes', {
        produtoId: Number(produtoId),
        codigo: codigo.trim(),
        validade,
        quantidade: qtd,
      });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {produtos.erro && <Aviso tipo="erro">{produtos.erro}</Aviso>}
      <Selecao
        rotulo="Produto"
        valor={produtoId}
        aoMudar={setProdutoId}
        opcoes={(produtos.dados?.itens ?? []).map((p) => ({ valor: String(p.produtoId), rotulo: p.nome }))}
        obrigatorio
      />
      <Campo rotulo="Código do lote" valor={codigo} aoMudar={setCodigo} obrigatorio />
      <Campo rotulo="Validade" tipo="date" valor={validade} aoMudar={setValidade} obrigatorio />
      <Campo rotulo="Quantidade do lote" valor={quantidade} aoMudar={setQuantidade} obrigatorio />
      <p className="estoque-texto-suave">
        Use para registrar a validade de mercadoria que já está no estoque. O saldo não muda.
      </p>
      <div className="estoque-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao aoClicar={salvar} desabilitado={ocupado}>
          {ocupado ? 'Salvando...' : 'Cadastrar lote'}
        </Botao>
      </div>
    </>
  );
}

// Confirmação da baixa: o lote inteiro sai do estoque como perda.
function JanelaBaixar({ lote, aoFechar, aoSalvo }: { lote: Lote; aoFechar: () => void; aoSalvo: () => void }) {
  const [motivo, setMotivo] = useState<MotivoPerda>('VENCIDO');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setErro(null);
    setOcupado(true);
    try {
      await api.post(`/lotes/${lote.id}/baixar`, { motivo });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p>
        Dar baixa de <strong>{formatarQuantidade(lote.quantidade, lote.unidade)}</strong> de {lote.produto} (lote{' '}
        {lote.codigo}) como perda. Isso tira o saldo do estoque e não pode ser desfeito por aqui.
      </p>
      <Selecao rotulo="Motivo" valor={motivo} aoMudar={(v) => setMotivo(v as MotivoPerda)} opcoes={OPCOES_MOTIVO} obrigatorio />
      <div className="estoque-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao variante="perigo" aoClicar={confirmar} desabilitado={ocupado}>
          {ocupado ? 'Dando baixa...' : 'Baixar como perda'}
        </Botao>
      </div>
    </>
  );
}

// Lotes em grade de cartões: foto, nome, lote, selo de vencimento, quantidade e valor.
function GradeLotes({ lotes, vazio, aoBaixar }: { lotes: Lote[]; vazio: string; aoBaixar: (lote: Lote) => void }) {
  if (lotes.length === 0) return <p className="tabela-vazia">{vazio}</p>;
  return (
    <div className="grade-produtos">
      {lotes.map((l) => (
        <article className="cartao-produto estoque-lote" key={l.id}>
          <div className="estoque-cartao-topo">
            <FotoProduto foto={l.foto} nome={l.produto} setor={l.categoria} tamanho={64} />
            <div>
              <h3 className="estoque-cartao-titulo">{l.produto}</h3>
              <span className="estoque-texto-suave">Lote {l.codigo}</span>
            </div>
          </div>
          <span className={`estoque-vencimento estoque-vencimento-${corDosDias(l.diasRestantes)}`}>
            {rotuloVencimento(l.diasRestantes)}
          </span>
          <div className="estoque-cartao-linha">
            <span className="estoque-texto-suave">Validade</span>
            <strong className="numero">{formatarData(l.validade)}</strong>
          </div>
          <div className="estoque-cartao-linha">
            <span className="estoque-texto-suave">Quantidade</span>
            <strong className="numero">{formatarQuantidade(l.quantidade, l.unidade)}</strong>
          </div>
          <div className="estoque-cartao-linha">
            <span className="estoque-texto-suave">Valor de custo</span>
            <strong className="numero">{formatarMoeda(l.valorCusto)}</strong>
          </div>
          <div className="cartao-produto-rodape">
            <Botao variante="secundario" aoClicar={() => aoBaixar(l)}>
              Baixar como perda
            </Botao>
          </div>
        </article>
      ))}
    </div>
  );
}

// Aba Perdas: filtro por período, resumo por motivo e tabela com foto.
function RelatorioPerdas() {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const { dados, carregando, erro } = useDados<RespostaPerdas>(
    `/estoque/perdas${queryString({ inicio, fim })}`,
  );

  const colunas: ColunaTabela<ItemPerda>[] = [
    {
      titulo: 'Produto',
      celula: (i) => (
        <CelulaProduto foto={i.foto} nome={i.produto} setor={i.categoria} detalhe={`${i.codigo} · ${i.ean ?? 'sem EAN'}`} />
      ),
    },
    { titulo: 'Data', celula: (i) => formatarData(i.data) },
    { titulo: 'Quantidade', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.quantidade, i.unidade)}</span> },
    { titulo: 'Motivo', celula: (i) => i.motivo || '—' },
    { titulo: 'Valor', alinhar: 'direita', celula: (i) => <span className="numero">{formatarMoeda(i.valor)}</span> },
  ];

  return (
    <>
      <div className="barra-ferramentas">
        <div className="filtros">
          <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
          <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
        </div>
      </div>
      <p className="estoque-texto-suave">Sem período, mostra os últimos 30 dias.</p>

      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados && (
        <>
          <div className="resumo">
            <div className="resumo-item">
              <span className="resumo-icone resumo-icone-vermelho">
                <Icone nome="lixeira" tamanho={24} />
              </span>
              <div>
                <span className="resumo-valor">{formatarMoeda(dados.totalValor)}</span>
                <span className="resumo-rotulo">Total perdido · {dados.itens.length} lançamento(s)</span>
              </div>
            </div>
            {dados.porMotivo.map((m) => (
              <div className="resumo-item" key={m.motivo}>
                <span className="resumo-icone resumo-icone-roxo">
                  <Icone nome="grafico" tamanho={24} />
                </span>
                <div>
                  <span className="resumo-valor">{formatarMoeda(m.valor)}</span>
                  <span className="resumo-rotulo">{m.motivo}</span>
                </div>
              </div>
            ))}
          </div>
          <Tabela colunas={colunas} dados={dados.itens} chave={(i) => `${i.data}-${i.produto}-${i.motivo}`} vazio="Nenhuma perda no período." />
        </>
      )}
    </>
  );
}

export function Validade() {
  const [parametros, setParametros] = useSearchParams();
  // Vindo de "Cadastrar lote" na tela de estoque, já chega com o produto escolhido.
  const produtoDoCadastro = parametros.get('cadastrar') ?? '';
  const [aba, setAba] = useState('vencendo');
  const [dias, setDias] = useState(7);
  const [cadastrando, setCadastrando] = useState(produtoDoCadastro !== '');
  const [baixando, setBaixando] = useState<Lote | null>(null);

  const { dados, carregando, erro, recarregar } = useDados<RespostaValidade>(`/validade?dias=${dias}`);

  function fecharCadastro() {
    setCadastrando(false);
    if (produtoDoCadastro) setParametros({}, { replace: true });
  }

  return (
    <Pagina
      titulo="Validade e perdas"
      acoes={<Botao aoClicar={() => setCadastrando(true)}>Cadastrar lote/validade</Botao>}
    >
      <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />

      {aba === 'vencendo' && (
        <div className="barra-ferramentas">
          <div className="segmentado" role="group" aria-label="Prazo">
            {PRAZOS.map((p) => (
              <button
                key={p}
                type="button"
                className="segmentado-item"
                aria-pressed={dias === p}
                onClick={() => setDias(p)}
              >
                {p} dias
              </button>
            ))}
          </div>
        </div>
      )}

      {aba !== 'perdas' && carregando && !dados && <Carregando />}
      {aba !== 'perdas' && erro && <Aviso tipo="erro">{erro}</Aviso>}

      {aba === 'vencendo' && dados && (
        <GradeLotes
          lotes={dados.vencendo}
          vazio={`Nenhum lote vence nos próximos ${dias} dias.`}
          aoBaixar={setBaixando}
        />
      )}
      {aba === 'vencidos' && dados && (
        <GradeLotes lotes={dados.vencidos} vazio="Nenhum lote vencido com saldo." aoBaixar={setBaixando} />
      )}
      {aba === 'perdas' && <RelatorioPerdas />}

      <Modal aberto={cadastrando} titulo="Cadastrar lote/validade" aoFechar={fecharCadastro}>
        {cadastrando && (
          <JanelaCadastrarLote
            produtoIdInicial={produtoDoCadastro}
            aoFechar={fecharCadastro}
            aoSalvo={() => {
              fecharCadastro();
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={baixando !== null} titulo="Baixar lote como perda" aoFechar={() => setBaixando(null)}>
        {baixando && (
          <JanelaBaixar
            lote={baixando}
            aoFechar={() => setBaixando(null)}
            aoSalvo={() => {
              setBaixando(null);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
