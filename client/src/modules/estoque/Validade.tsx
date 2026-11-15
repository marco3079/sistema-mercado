import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import {
  Abas,
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarData,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
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

function rotuloDosDias(dias: number): string {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
  if (dias === 0) return 'Vence hoje';
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

const OPCOES_MOTIVO = MOTIVOS_PERDA.map((m) => ({ valor: m, rotulo: ROTULOS_MOTIVO_PERDA[m] }));

// Janela para cadastrar lote de um produto que já está em estoque (não movimenta o saldo).
function JanelaCadastrarLote({ aoFechar, aoSalvo }: { aoFechar: () => void; aoSalvo: () => void }) {
  const produtos = useDados<RespostaEstoque>('/estoque');
  const [produtoId, setProdutoId] = useState('');
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

// Aba Vencendo / Vencidos: lista de lotes com dias restantes.
function ListaLotes({
  lotes,
  vazio,
  aoBaixar,
}: {
  lotes: Lote[];
  vazio: string;
  aoBaixar: (lote: Lote) => void;
}) {
  const colunas: ColunaTabela<Lote>[] = [
    { titulo: 'Produto', celula: (l) => l.produto },
    { titulo: 'Lote', celula: (l) => l.codigo },
    { titulo: 'Validade', celula: (l) => formatarData(l.validade) },
    {
      titulo: 'Dias restantes',
      celula: (l) => <Selo cor={corDosDias(l.diasRestantes)}>{rotuloDosDias(l.diasRestantes)}</Selo>,
    },
    { titulo: 'Quantidade', alinhar: 'direita', celula: (l) => formatarQuantidade(l.quantidade, l.unidade) },
    { titulo: 'Valor de custo', alinhar: 'direita', celula: (l) => formatarMoeda(l.valorCusto) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (l) => (
        <Botao variante="secundario" aoClicar={() => aoBaixar(l)}>
          Baixar como perda
        </Botao>
      ),
    },
  ];
  return <Tabela colunas={colunas} dados={lotes} chave={(l) => l.id} vazio={vazio} />;
}

// Aba Perdas: relatório por período com total e total por motivo.
function RelatorioPerdas() {
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const { dados, carregando, erro } = useDados<RespostaPerdas>(
    `/estoque/perdas${queryString({ inicio, fim })}`,
  );

  const colunas: ColunaTabela<ItemPerda>[] = [
    { titulo: 'Data', celula: (i) => formatarData(i.data) },
    { titulo: 'Produto', celula: (i) => i.produto },
    { titulo: 'Quantidade', alinhar: 'direita', celula: (i) => formatarQuantidade(i.quantidade, i.unidade) },
    { titulo: 'Motivo', celula: (i) => i.motivo || '—' },
    { titulo: 'Valor', alinhar: 'direita', celula: (i) => formatarMoeda(i.valor) },
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
          <div className="estoque-totais">
            <Cartao titulo="Total perdido">
              <span className="cartao-indicador-valor">{formatarMoeda(dados.totalValor)}</span>
              <span className="cartao-indicador-rotulo">{dados.itens.length} lançamento(s)</span>
            </Cartao>
            <Cartao titulo="Por motivo">
              {dados.porMotivo.length === 0 ? (
                <p className="estoque-texto-suave">Sem perdas no período.</p>
              ) : (
                <ul className="estoque-lista-ordenada">
                  {dados.porMotivo.map((m) => (
                    <li key={m.motivo}>
                      {m.motivo}: <strong>{formatarMoeda(m.valor)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>
          <Tabela colunas={colunas} dados={dados.itens} chave={(i) => `${i.data}-${i.produto}-${i.motivo}`} vazio="Nenhuma perda no período." />
        </>
      )}
    </>
  );
}

export function Validade() {
  const [aba, setAba] = useState('vencendo');
  const [dias, setDias] = useState(7);
  const [cadastrando, setCadastrando] = useState(false);
  const [baixando, setBaixando] = useState<Lote | null>(null);

  const { dados, carregando, erro, recarregar } = useDados<RespostaValidade>(`/validade?dias=${dias}`);

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
        <ListaLotes
          lotes={dados.vencendo}
          vazio={`Nenhum lote vence nos próximos ${dias} dias.`}
          aoBaixar={setBaixando}
        />
      )}
      {aba === 'vencidos' && dados && (
        <ListaLotes lotes={dados.vencidos} vazio="Nenhum lote vencido com saldo." aoBaixar={setBaixando} />
      )}
      {aba === 'perdas' && <RelatorioPerdas />}

      <Modal aberto={cadastrando} titulo="Cadastrar lote/validade" aoFechar={() => setCadastrando(false)}>
        {cadastrando && (
          <JanelaCadastrarLote
            aoFechar={() => setCadastrando(false)}
            aoSalvo={() => {
              setCadastrando(false);
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
