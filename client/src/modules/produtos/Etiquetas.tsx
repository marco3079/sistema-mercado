import { useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { escapar, imprimirHtml, moeda } from '../../lib/imprimir';
import { mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Cartao, Carregando, Campo, Modal, Pagina, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import type { EtiquetaDTO, ListaProdutosDTO, ProdutoDTO } from './tipos';
import './produtos.css';

// Folha A4 com 3 colunas de etiquetas de gôndola (usada só na impressão).
const ESTILO_ETIQUETAS_A4 = `
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .etiquetas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
  .etq { border: 1px dashed #888; padding: 3mm; height: 40mm; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
  .etq-nome { font-size: 11pt; font-weight: 700; line-height: 1.1; max-height: 2.4em; overflow: hidden; }
  .etq-preco { font-size: 26pt; font-weight: 800; line-height: 1; }
  .etq-un { font-size: 11pt; font-weight: 600; margin-left: 2px; }
  .etq-atacado { font-size: 9pt; }
  .etq-promo { font-size: 9pt; font-weight: 700; }
  .etq-rodape { display: flex; justify-content: space-between; font-size: 8pt; }
`;

function unidadeTexto(unidade: string): string {
  return unidade === 'UN' ? 'un' : unidade.toLowerCase();
}

// HTML de uma etiqueta: nome, preço grande, unidade, atacado, promoção, EAN e data.
function htmlDasEtiquetas(lista: EtiquetaDTO[]): string {
  const hoje = new Date().toLocaleDateString('pt-BR');
  const itens = lista.map((e) => {
    const atacado =
      e.precoAtacado !== null && e.qtdAtacado !== null
        ? `<div class="etq-atacado">A partir de ${e.qtdAtacado} un: ${moeda(e.precoAtacado)}</div>`
        : '';
    const promo = e.promocao ? `<div class="etq-promo">${escapar(e.promocao)}</div>` : '';
    return `<div class="etq">
      <div class="etq-nome">${escapar(e.nome)}</div>
      <div><span class="etq-preco">${escapar(moeda(e.precoVenda))}</span><span class="etq-un">/${escapar(unidadeTexto(e.unidade))}</span></div>
      <div>${atacado}${promo}</div>
      <div class="etq-rodape"><span>${escapar(e.ean ?? e.codigo)}</span><span>${escapar(hoje)}</span></div>
    </div>`;
  });
  return `<div class="etiquetas">${itens.join('')}</div>`;
}

// Tela de etiquetas: pendentes (preço mudou ou inclusão manual), impressão em folha A4.
export function TelaEtiquetas() {
  const { dados, carregando, erro, recarregar } = useDados<EtiquetaDTO[]>('/etiquetas?pendentes=1');
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  function alternar(id: number) {
    setMarcadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function imprimir() {
    if (!dados) return;
    const escolhidas = dados.filter((e) => marcadas.includes(e.id));
    if (escolhidas.length === 0) return;
    setAviso(null);
    setImprimindo(true);
    try {
      imprimirHtml('Etiquetas de gôndola', htmlDasEtiquetas(escolhidas), ESTILO_ETIQUETAS_A4);
      await api.post<{ impressas: number }>('/etiquetas/imprimir', { ids: escolhidas.map((e) => e.id) });
      setMarcadas([]);
      setAviso({ tipo: 'sucesso', texto: `${escolhidas.length} etiqueta(s) enviada(s) para impressão.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setImprimindo(false);
    }
  }

  const colunas: ColunaTabela<EtiquetaDTO>[] = [
    {
      titulo: 'Imprimir',
      celula: (e) => (
        <input
          type="checkbox"
          aria-label={`Imprimir etiqueta de ${e.nome}`}
          checked={marcadas.includes(e.id)}
          onChange={() => alternar(e.id)}
        />
      ),
    },
    {
      titulo: 'Produto',
      celula: (e) => (
        <>
          <strong>{e.nome}</strong>
          <span className="produtos-marca"> · {e.codigo}</span>
        </>
      ),
    },
    { titulo: 'Preço', alinhar: 'direita', celula: (e) => `${moeda(e.precoVenda)} /${unidadeTexto(e.unidade)}` },
    {
      titulo: 'Atacado',
      celula: (e) => (e.precoAtacado !== null && e.qtdAtacado !== null ? `${e.qtdAtacado} un: ${moeda(e.precoAtacado)}` : '-'),
    },
    { titulo: 'Promoção', celula: (e) => e.promocao ?? '-' },
    { titulo: 'Motivo', celula: (e) => e.motivo },
    { titulo: 'Criada em', celula: (e) => formatarDataHora(e.criadoEm) },
  ];

  return (
    <Pagina
      titulo="Etiquetas"
      acoes={
        <>
          <Botao variante="secundario" aoClicar={() => setAdicionando(true)}>
            Adicionar produtos
          </Botao>
          <Botao desabilitado={marcadas.length === 0 || imprimindo} aoClicar={imprimir}>
            Imprimir selecionadas ({marcadas.length})
          </Botao>
        </>
      }
    >
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      <Cartao>
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <Tabela
            colunas={colunas}
            dados={dados}
            chave={(e) => e.id}
            vazio="Nenhuma etiqueta pendente. Mudanças de preço criam etiquetas aqui."
          />
        )}
      </Cartao>

      {adicionando && (
        <AdicionarProdutos
          aoFechar={() => setAdicionando(false)}
          aoAdicionado={(total) => {
            setAviso({ tipo: 'sucesso', texto: `${total} produto(s) adicionado(s) às etiquetas pendentes.` });
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

// Busca produtos e cria etiquetas pendentes (motivo "Manual") para os escolhidos.
function AdicionarProdutos({
  aoFechar,
  aoAdicionado,
}: {
  aoFechar: () => void;
  aoAdicionado: (total: number) => void;
}) {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ProdutoDTO[] | null>(null);
  const [escolhidos, setEscolhidos] = useState<number[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function pesquisar() {
    setErro(null);
    setBuscando(true);
    try {
      const r = await api.get<ListaProdutosDTO>(`/produtos?porPagina=20&busca=${encodeURIComponent(busca.trim())}`);
      setResultados(r.itens);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setBuscando(false);
    }
  }

  async function adicionar() {
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post<{ criadas: number }>('/etiquetas', { produtoIds: escolhidos });
      aoAdicionado(r.criadas);
      aoFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Adicionar produtos às etiquetas" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="filtros produtos-filtros">
        <Campo rotulo="Buscar por nome, código ou EAN" valor={busca} aoMudar={setBusca} />
        <div className="produtos-acoes-filtro">
          <Botao variante="secundario" desabilitado={buscando} aoClicar={pesquisar}>
            Buscar
          </Botao>
        </div>
      </div>
      {resultados && resultados.length === 0 && <p className="tabela-vazia">Nenhum produto encontrado.</p>}
      {resultados && resultados.length > 0 && (
        <ul className="produtos-lista-escolha">
          {resultados.map((p) => (
            <li key={p.id}>
              <label className="caixa">
                <input
                  type="checkbox"
                  checked={escolhidos.includes(p.id)}
                  onChange={() =>
                    setEscolhidos((atual) => (atual.includes(p.id) ? atual.filter((x) => x !== p.id) : [...atual, p.id]))
                  }
                />
                <span>
                  {p.nome} · {p.codigo}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="produtos-acoes-modal">
        <Botao desabilitado={escolhidos.length === 0 || enviando} aoClicar={adicionar}>
          Adicionar selecionados ({escolhidos.length})
        </Botao>
        <Botao variante="secundario" aoClicar={aoFechar}>
          Fechar
        </Botao>
      </div>
    </Modal>
  );
}
