import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { escapar, imprimirHtml, moeda } from '../../lib/imprimir';
import { mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import { CelulaProduto } from '../../ui/FotoProduto';
import { ean13Valido, svgEan13 } from './codigoBarras';
import type { EtiquetaDTO, ListaProdutosDTO, ProdutoDTO } from './tipos';
import estiloEtiquetas from './etiquetas.css?inline';
import './etiquetas.css';
import './produtos.css';

// Formato de impressão: folha A4 (pimaco 6180), impressora térmica de rolo ou Zebra (ZPL pela rede).
type Modo = 'A4' | 'TERMICA' | 'ZEBRA';

// Padrão de impressão vindo de Configurações > Mercado (GET /configuracoes/mercado/publico).
interface ConfigImpressao {
  etiquetaModo: Modo;
  etiquetaLarguraMm: number;
  etiquetaAlturaMm: number;
  etiquetaColunas: number;
  zebraConfigurada: boolean;
}

// A lista de pendentes traz foto, categoria e o preço da oferta (precoOferta, null sem promoção de preço).
type EtiquetaComFoto = EtiquetaDTO & { foto?: string | null; categoria?: string | null; precoOferta?: number | null };

const OPCOES_MODO = [
  { valor: 'A4', rotulo: 'Folha A4 (3 por linha)' },
  { valor: 'TERMICA', rotulo: 'Impressora térmica de etiquetas (rolo)' },
  { valor: 'ZEBRA', rotulo: 'Zebra ZPL pela rede' },
];

const MEDIDAS_A4 = { largura: 63.5, altura: 33.9, colunas: 3 };
const ETIQUETAS_POR_FOLHA_A4 = 24;

function unidadeTexto(unidade: string): string {
  return unidade === 'UN' ? 'un' : unidade.toLowerCase();
}

// Medidas (mm) e colunas do formato escolhido. A4 é fixo; térmica e Zebra seguem a configuração.
function medidasDo(modo: Modo, cfg: ConfigImpressao | null) {
  if (modo === 'A4') return MEDIDAS_A4;
  return {
    largura: cfg?.etiquetaLarguraMm ?? 60,
    altura: cfg?.etiquetaAlturaMm ?? 40,
    colunas: modo === 'TERMICA' ? (cfg?.etiquetaColunas ?? 1) : 1,
  };
}

// HTML de uma etiqueta: nome, preço grande, unidade, faixa de oferta, atacado, código de barras e rodapé.
// Usado na prévia da tela e na impressão, para ficarem iguais.
function htmlUmaEtiqueta(e: EtiquetaComFoto, medidas: { largura: number; altura: number }): string {
  // Com promoção de preço, o grande é o preço da oferta e o de tabela aparece riscado na faixa.
  const precoOferta = e.precoOferta ?? null;
  const emOferta = precoOferta !== null;
  const preco: number = precoOferta ?? e.precoVenda;
  const inteiro = Math.trunc(preco);
  const centavos = String(Math.round((preco - inteiro) * 100)).padStart(2, '0');
  const codigoBarra = e.ean && ean13Valido(e.ean) ? e.ean : e.codigo;
  const barras = svgEan13(codigoBarra, medidas.largura - 4, medidas.altura * 0.5);
  const textoOferta = emOferta ? `OFERTA · de ${moeda(e.precoVenda)}` : e.promocao;
  const oferta = textoOferta ? `<div class="etiq-oferta">${escapar(textoOferta)}</div>` : '';
  const atacado =
    e.precoAtacado !== null && e.qtdAtacado !== null
      ? `<div class="etiq-atacado">Atacado: a partir de ${e.qtdAtacado} un ${escapar(moeda(e.precoAtacado))}</div>`
      : '';
  const hoje = new Date().toLocaleDateString('pt-BR');
  return `<div class="etiq">
    <div class="etiq-nome">${escapar(e.nome)}</div>
    <div class="etiq-preco"><span class="etiq-rs">R$</span><span class="etiq-inteiro">${inteiro}</span><span class="etiq-centavos">,${centavos}</span><span class="etiq-unidade">/${escapar(unidadeTexto(e.unidade))}</span></div>
    ${oferta}${atacado}
    <div class="etiq-barras">${barras}</div>
    <div class="etiq-rodape"><span>${escapar(e.codigo)}</span><span>${escapar(hoje)}</span></div>
  </div>`;
}

// Páginas para a impressão: 24 por folha A4; uma linha de N etiquetas por página na térmica.
function paginasDeImpressao(lista: EtiquetaComFoto[], modo: Modo, medidas: { largura: number; altura: number; colunas: number }): string {
  const porPagina = modo === 'A4' ? ETIQUETAS_POR_FOLHA_A4 : medidas.colunas;
  const classe = modo === 'A4' ? 'etiq-folha' : 'etiq-pagina';
  const paginas: string[] = [];
  for (let i = 0; i < lista.length; i += porPagina) {
    const bloco = lista
      .slice(i, i + porPagina)
      .map((e) => htmlUmaEtiqueta(e, medidas))
      .join('');
    paginas.push(`<div class="${classe}">${bloco}</div>`);
  }
  return paginas.join('');
}

// CSS da impressão: tamanho do papel (A4 ou rolo da etiqueta) mais as regras de etiqueta do etiquetas.css.
function estiloImpressao(modo: Modo, medidas: { largura: number; altura: number; colunas: number }): string {
  const { largura: w, altura: h, colunas } = medidas;
  const pagina =
    modo === 'A4'
      ? `@page { size: A4; margin: 8mm; } .etiq-folha { display: grid; grid-template-columns: repeat(3, ${w}mm); grid-auto-rows: ${h}mm; break-after: page; }`
      : `@page { size: ${w * colunas}mm ${h}mm; margin: 0; } .etiq-pagina { display: grid; grid-template-columns: repeat(${colunas}, ${w}mm); grid-auto-rows: ${h}mm; break-after: page; }`;
  return `:root { --etiq-w: ${w}mm; --etiq-h: ${h}mm; --etiq-p: ${h * 0.34}mm; --etiq-colunas: ${colunas}; }
    * { box-sizing: border-box; } body { margin: 0; }
    ${pagina}
    .etiq-folha:last-child, .etiq-pagina:last-child { break-after: auto; }
    ${estiloEtiquetas}`;
}

// Tela de etiquetas: pendentes (preço mudou ou inclusão manual), prévia e impressão no formato escolhido.
export function TelaEtiquetas() {
  const { dados, carregando, erro, recarregar } = useDados<EtiquetaComFoto[]>('/etiquetas?pendentes=1');
  const [cfg, setCfg] = useState<ConfigImpressao | null>(null);
  const [modoEscolhido, setModoEscolhido] = useState<Modo | null>(null);
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    api
      .get<ConfigImpressao>('/configuracoes/mercado/publico')
      .then((c) => {
        if (ativo) setCfg(c);
      })
      .catch(() => {
        // Sem configuração: a tela segue com o padrão (folha A4).
      });
    return () => {
      ativo = false;
    };
  }, []);

  const modo: Modo = modoEscolhido ?? cfg?.etiquetaModo ?? 'A4';
  const medidas = medidasDo(modo, cfg);
  const lista = dados ?? [];
  const escolhidas = lista.filter((e) => marcadas.includes(e.id));
  const semIpZebra = modo === 'ZEBRA' && cfg !== null && !cfg.zebraConfigurada;

  function alternar(id: number) {
    setMarcadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  // Imprime pelo navegador (A4 ou térmica) e marca como impressas.
  async function imprimirNoNavegador() {
    if (escolhidas.length === 0) return;
    setAviso(null);
    setOcupado(true);
    try {
      imprimirHtml('Etiquetas de gôndola', paginasDeImpressao(escolhidas, modo, medidas), estiloImpressao(modo, medidas));
      await api.post<{ impressas: number }>('/etiquetas/imprimir', { ids: escolhidas.map((e) => e.id) });
      setMarcadas([]);
      setAviso({ tipo: 'sucesso', texto: `${escolhidas.length} etiqueta(s) enviada(s) para impressão.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  // Envia direto à Zebra pela rede; o servidor marca as etiquetas como impressas.
  async function enviarZebra() {
    if (escolhidas.length === 0) return;
    setAviso(null);
    setOcupado(true);
    try {
      const r = await api.post<{ enviadas: number }>('/impressao/zebra', { etiquetaIds: escolhidas.map((e) => e.id) });
      setMarcadas([]);
      setAviso({ tipo: 'sucesso', texto: `${r.enviadas} etiqueta(s) enviada(s) para a Zebra.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  // Arquivo .zpl para enviar à mão à impressora.
  async function baixarZpl() {
    if (escolhidas.length === 0) return;
    setAviso(null);
    try {
      await baixarArquivo(`/impressao/zebra.zpl?ids=${escolhidas.map((e) => e.id).join(',')}`, 'etiquetas.zpl');
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  const colunas: ColunaTabela<EtiquetaComFoto>[] = [
    {
      titulo: 'Produto',
      celula: (e) => (
        <CelulaProduto
          foto={e.foto}
          nome={e.nome}
          setor={e.categoria}
          detalhe={`${e.codigo} · ${e.ean ?? 'sem EAN'}`}
        />
      ),
    },
    {
      titulo: 'Imprimir',
      alinhar: 'centro',
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
      titulo: 'Preço',
      alinhar: 'direita',
      celula: (e) => <span className="numero">{`${formatarMoeda(e.precoVenda)} /${unidadeTexto(e.unidade)}`}</span>,
    },
    {
      titulo: 'Atacado',
      alinhar: 'direita',
      celula: (e) =>
        e.precoAtacado !== null && e.qtdAtacado !== null ? (
          <span className="numero">{`${e.qtdAtacado} un: ${formatarMoeda(e.precoAtacado)}`}</span>
        ) : (
          '-'
        ),
    },
    {
      titulo: 'Promoção',
      celula: (e) => (e.promocao ? <Selo cor="amarelo">{e.promocao}</Selo> : '-'),
    },
    { titulo: 'Motivo', celula: (e) => <Selo cor="cinza">{e.motivo}</Selo> },
    { titulo: 'Criada em', alinhar: 'direita', celula: (e) => <span className="numero">{formatarDataHora(e.criadoEm)}</span> },
  ];

  const acoes = (
    <>
      <Botao variante="secundario" aoClicar={() => setAdicionando(true)}>
        Adicionar produtos
      </Botao>
      {modo === 'ZEBRA' && (
        <Botao variante="secundario" desabilitado={escolhidas.length === 0 || ocupado} aoClicar={baixarZpl}>
          Baixar .zpl
        </Botao>
      )}
      <Botao
        desabilitado={escolhidas.length === 0 || ocupado || semIpZebra}
        aoClicar={modo === 'ZEBRA' ? enviarZebra : imprimirNoNavegador}
      >
        {modo === 'ZEBRA' ? `Enviar ${escolhidas.length} para a Zebra` : `Imprimir selecionadas (${escolhidas.length})`}
      </Botao>
    </>
  );

  // Prévia das etiquetas escolhidas, com as medidas do formato atual.
  const estiloPrevia = {
    '--etiq-w': `${medidas.largura}mm`,
    '--etiq-h': `${medidas.altura}mm`,
    '--etiq-p': `${medidas.altura * 0.34}mm`,
    '--etiq-colunas': String(modo === 'A4' ? 3 : medidas.colunas),
  } as unknown as CSSProperties;
  const htmlPrevia = escolhidas.map((e) => htmlUmaEtiqueta(e, medidas)).join('');

  return (
    <Pagina titulo="Etiquetas" acoes={acoes}>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {modo === 'TERMICA' && (
        <Aviso tipo="info">
          Na janela de impressão escolha a impressora de etiquetas, papel do tamanho da etiqueta e margens Nenhuma.
        </Aviso>
      )}
      {semIpZebra && <Aviso tipo="info">Configure o IP da Zebra em Configurações &gt; Mercado para enviar direto.</Aviso>}

      <div className="resumo">
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-azul">
            <Icone nome="etiqueta" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{lista.length}</span>
            <span className="resumo-rotulo">Pendentes</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-verde">
            <Icone nome="visto" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{escolhidas.length}</span>
            <span className="resumo-rotulo">Selecionadas</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-laranja">
            <Icone nome="porcentagem" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{lista.filter((e) => e.promocao).length}</span>
            <span className="resumo-rotulo">Em promoção</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-roxo">
            <Icone nome="pacote" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{lista.filter((e) => e.precoAtacado !== null).length}</span>
            <span className="resumo-rotulo">Com atacado</span>
          </div>
        </div>
      </div>

      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Selecao
              rotulo="Formato de impressão"
              valor={modo}
              aoMudar={(v) => setModoEscolhido(v as Modo)}
              opcoes={OPCOES_MODO}
            />
          </div>
          <div className="acoes-linha">
            <Botao variante="texto" desabilitado={lista.length === 0} aoClicar={() => setMarcadas(lista.map((e) => e.id))}>
              Selecionar todas ({lista.length})
            </Botao>
            <Botao variante="texto" desabilitado={marcadas.length === 0} aoClicar={() => setMarcadas([])}>
              Limpar seleção
            </Botao>
          </div>
        </div>
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

      <Cartao titulo={`Prévia (${escolhidas.length})`}>
        {escolhidas.length === 0 ? (
          <p className="etiq-previa-vazia">Marque etiquetas na lista para ver a prévia.</p>
        ) : (
          <div className="etiq-previa" style={estiloPrevia} dangerouslySetInnerHTML={{ __html: htmlPrevia }} />
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
      <div className="barra-ferramentas produtos-filtros">
        <div className="filtros">
          <Campo
            rotulo="Buscar"
            placeholder="Buscar por nome, código ou EAN"
            valor={busca}
            aoMudar={setBusca}
          />
        </div>
        <div className="acoes-linha">
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
                <CelulaProduto foto={p.foto} nome={p.nome} setor={p.categoria} detalhe={p.codigo} tamanho={32} />
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
