import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAtualizacao } from '../../lib/useAtualizacao';
import { useDados } from '../../lib/useDados';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { COR_TRANSFERENCIA, ROTULO_TRANSFERENCIA } from './tipos';
import type { TransferenciaDTO, TransferenciaResumoDTO } from './tipos';

// Transferências entre lojas (ex.: centro de distribuição -> loja). Enviar baixa a origem; receber lança no destino.

interface LojaOpcao {
  id: number;
  nome: string;
}

interface ProdutoBusca {
  id: number;
  codigo: string;
  nome: string;
  unidade: string;
  estoqueLoja: number;
}

interface ItemNovo {
  produtoId: number;
  nome: string;
  unidade: string;
  saldo: number;
  quantidade: string;
}

// ---------- Nova transferência ----------

function ModalNovaTransferencia({ aoFechar, aoSalvo }: { aoFechar: () => void; aoSalvo: (mensagem: string) => void }) {
  const lojas = useDados<LojaOpcao[]>('/lojas');
  const [destinoLojaId, setDestinoLojaId] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<ItemNovo[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const termo = busca.trim();
  const produtos = useDados<{ itens: ProdutoBusca[]; total: number }>(
    termo.length >= 2 ? `/produtos?busca=${encodeURIComponent(termo)}&porPagina=8` : null,
  );

  function adicionar(p: ProdutoBusca) {
    setItens((atual) =>
      atual.some((i) => i.produtoId === p.id)
        ? atual
        : [...atual, { produtoId: p.id, nome: p.nome, unidade: p.unidade, saldo: p.estoqueLoja, quantidade: '1' }],
    );
  }

  function alterarQuantidade(produtoId: number, valor: string) {
    setItens((atual) => atual.map((i) => (i.produtoId === produtoId ? { ...i, quantidade: valor } : i)));
  }

  function remover(produtoId: number) {
    setItens((atual) => atual.filter((i) => i.produtoId !== produtoId));
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const quantidades = itens.map((i) => ({ produtoId: i.produtoId, quantidade: lerNumero(i.quantidade) ?? 0 }));
    if (!destinoLojaId) {
      setErro('Escolha a loja de destino.');
      return;
    }
    if (quantidades.length === 0 || quantidades.some((q) => q.quantidade <= 0)) {
      setErro('Adicione ao menos um item, com quantidade maior que zero.');
      return;
    }
    setEnviando(true);
    try {
      const criada = await api.post<TransferenciaDTO>('/transferencias', {
        destinoLojaId: Number(destinoLojaId),
        itens: quantidades,
        observacoes: observacoes.trim() || null,
      });
      aoSalvo(`Transferência #${criada.id} solicitada.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Nova transferência" aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {lojas.erro && <Aviso tipo="erro">{lojas.erro}</Aviso>}
        <Selecao
          rotulo="Loja de destino"
          valor={destinoLojaId}
          aoMudar={setDestinoLojaId}
          obrigatorio
          opcoes={(lojas.dados ?? []).map((l) => ({ valor: String(l.id), rotulo: l.nome }))}
        />
        <Campo rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} />

        <Campo rotulo="Buscar produto (nome, código ou EAN)" valor={busca} aoMudar={setBusca} />
        {termo.length >= 2 && produtos.carregando && <Carregando />}
        {produtos.erro && <Aviso tipo="erro">{produtos.erro}</Aviso>}
        {produtos.dados && produtos.dados.itens.length === 0 && (
          <p className="logistica-vazio">Nenhum produto encontrado.</p>
        )}
        {produtos.dados && produtos.dados.itens.length > 0 && (
          <ul className="logistica-lista">
            {produtos.dados.itens.map((p) => (
              <li key={p.id} className="logistica-item">
                <div className="logistica-item-texto">
                  <strong>{p.nome}</strong>
                  <span className="logistica-suave">
                    {p.codigo} · saldo na origem {formatarQuantidade(p.estoqueLoja, p.unidade)}
                  </span>
                </div>
                <Botao variante="secundario" aoClicar={() => adicionar(p)}>
                  Adicionar
                </Botao>
              </li>
            ))}
          </ul>
        )}

        <h3 className="logistica-subtitulo">Itens ({itens.length})</h3>
        {itens.length === 0 && <p className="logistica-vazio">Nenhum item adicionado.</p>}
        <ul className="logistica-lista">
          {itens.map((i) => (
            <li key={i.produtoId} className="logistica-item">
              <div className="logistica-item-texto">
                <strong>{i.nome}</strong>
                <span className="logistica-suave">saldo na origem {formatarQuantidade(i.saldo, i.unidade)}</span>
              </div>
              <div className="logistica-qtd">
                <Campo
                  rotulo={`Quantidade (${i.unidade.toLowerCase()})`}
                  valor={i.quantidade}
                  aoMudar={(v) => alterarQuantidade(i.produtoId, v)}
                />
              </div>
              <Botao variante="texto" aoClicar={() => remover(i.produtoId)}>
                Remover
              </Botao>
            </li>
          ))}
        </ul>

        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando || lojas.carregando}>
            Solicitar transferência
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Receber: quantidades realmente recebidas ----------

function ModalReceber({
  id,
  aoFechar,
  aoSalvo,
}: {
  id: number;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const transferencia = useDados<TransferenciaDTO>(`/transferencias/${id}`);
  const [quantidades, setQuantidades] = useState<Record<number, string> | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const t = transferencia.dados;
  // Preenche com o que foi enviado, uma vez que a transferência carregar.
  const valores: Record<number, string> =
    quantidades ?? Object.fromEntries((t?.itens ?? []).map((i) => [i.produtoId, String(i.quantidade)]));

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!t) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post(`/transferencias/${id}/receber`, {
        itens: t.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidadeRecebida: lerNumero(valores[i.produtoId] ?? '') ?? 0,
        })),
      });
      aoSalvo(`Transferência #${id} recebida.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Receber transferência #${id}`} aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {transferencia.carregando && !t && <Carregando />}
        {transferencia.erro && <Aviso tipo="erro">{transferencia.erro}</Aviso>}
        {t && (
          <>
            <p className="logistica-suave">
              {t.origem} → {t.destino}. Ajuste a quantidade se algo não chegou.
            </p>
            {t.itens.map((i) => (
              <Campo
                key={i.produtoId}
                rotulo={`${i.produto} · enviado ${formatarQuantidade(i.quantidade, i.unidade)}`}
                valor={valores[i.produtoId] ?? ''}
                aoMudar={(v) =>
                  setQuantidades({ ...valores, [i.produtoId]: v })
                }
                tipo="number"
              />
            ))}
            <div className="logistica-acoes-modal">
              <Botao tipo="submit" desabilitado={enviando}>
                Confirmar recebimento
              </Botao>
              <Botao variante="secundario" aoClicar={aoFechar}>
                Cancelar
              </Botao>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------- Tela ----------

export function Transferencias() {
  const lista = useDados<TransferenciaResumoDTO[]>('/transferencias');
  useAtualizacao(lista.recarregar, 20000);
  const [nova, setNova] = useState(false);
  const [receber, setReceber] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    setOcupado(true);
    setAviso(null);
    try {
      await acao();
      setAviso({ tipo: 'sucesso', texto: sucesso });
      lista.recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setOcupado(false);
    }
  }

  function cancelar(t: TransferenciaResumoDTO) {
    if (!window.confirm(`Cancelar a transferência #${t.id}?`)) return;
    void executar(() => api.post(`/transferencias/${t.id}/cancelar`), `Transferência #${t.id} cancelada.`);
  }

  const colunas: ColunaTabela<TransferenciaResumoDTO>[] = [
    { titulo: 'Nº', celula: (t) => <span className="logistica-codigo">#{t.id}</span> },
    { titulo: 'Origem → destino', celula: (t) => `${t.origem} → ${t.destino}` },
    { titulo: 'Itens', alinhar: 'direita', celula: (t) => <span className="logistica-numero">{t.itens}</span> },
    { titulo: 'Criada', celula: (t) => formatarDataHora(t.criadoEm) },
    { titulo: 'Rota', celula: (t) => t.rotaCodigo ?? '—' },
    {
      titulo: 'Situação',
      celula: (t) => <Selo cor={COR_TRANSFERENCIA[t.status]}>{ROTULO_TRANSFERENCIA[t.status]}</Selo>,
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (t) => (
        <div className="logistica-acoes-linha">
          {t.status === 'SOLICITADA' && (
            <Botao variante="texto" desabilitado={ocupado} aoClicar={() => void executar(() => api.post(`/transferencias/${t.id}/enviar`), `Transferência #${t.id} enviada.`)}>
              Enviar
            </Botao>
          )}
          {t.status === 'SOLICITADA' && (
            <Botao variante="texto" desabilitado={ocupado} aoClicar={() => cancelar(t)}>
              Cancelar
            </Botao>
          )}
          {t.status === 'ENVIADA' && (
            <Botao variante="texto" desabilitado={ocupado} aoClicar={() => setReceber(t.id)}>
              Receber
            </Botao>
          )}
        </div>
      ),
    },
  ];

  return (
    <Pagina titulo="Transferências" acoes={<Botao aoClicar={() => setNova(true)}>Nova transferência</Botao>}>
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados && (
        <Tabela<TransferenciaResumoDTO>
          colunas={colunas}
          dados={lista.dados}
          chave={(t) => t.id}
          vazio="Nenhuma transferência registrada."
        />
      )}

      {nova && (
        <ModalNovaTransferencia
          aoFechar={() => setNova(false)}
          aoSalvo={(mensagem) => {
            setAviso({ tipo: 'sucesso', texto: mensagem });
            lista.recarregar();
          }}
        />
      )}
      {receber !== null && (
        <ModalReceber
          id={receber}
          aoFechar={() => setReceber(null)}
          aoSalvo={(mensagem) => {
            setAviso({ tipo: 'sucesso', texto: mensagem });
            lista.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
