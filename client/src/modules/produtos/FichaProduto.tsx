import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { UNIDADES, formatarPercentual, lerNumero, mensagemErro } from '../../lib/mercado';
import {
  Abas,
  AreaTexto,
  Aviso,
  Botao,
  Caixa,
  Campo,
  Carregando,
  Modal,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { ColunaTabela } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import type {
  CategoriaDTO,
  ConfiguracaoPublicaDTO,
  FornecedorProdutoDTO,
  HistoricoPrecoDTO,
  ProdutoDTO,
  ProdutoFichaDTO,
} from './tipos';
import { corDaMargem, markupDe, margemDe, numeroParaCampo, sugerirPreco } from './tipos';
import './produtos.css';

// Foto: lado do quadrado em px e tamanho máximo do texto enviado (o servidor aceita até ~200 KB em data URL).
const LADO_FOTO = 400;
const LIMITE_FOTO = 200_000;

// Reduz a imagem para LADO_FOTO × LADO_FOTO (recorte central, JPG). Baixa a qualidade se ainda ficar grande.
async function reduzirFoto(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = await new Promise<HTMLImageElement>((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error('Não consegui ler esta imagem.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = LADO_FOTO;
    canvas.height = LADO_FOTO;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador não consegue processar a imagem.');
    const menor = Math.min(imagem.naturalWidth, imagem.naturalHeight);
    const sx = (imagem.naturalWidth - menor) / 2;
    const sy = (imagem.naturalHeight - menor) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
    ctx.drawImage(imagem, sx, sy, menor, menor, 0, 0, LADO_FOTO, LADO_FOTO);
    for (const qualidade of [0.85, 0.7, 0.55]) {
      const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
      if (dataUrl.length <= LIMITE_FOTO) return dataUrl;
    }
    throw new Error('Foto grande demais mesmo reduzida. Tente outra imagem.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Campos do formulário: tudo em texto (vírgula decimal) e converte na hora de salvar.
interface Rascunho {
  codigo: string;
  ean: string;
  nome: string;
  descricao: string;
  marca: string;
  categoriaId: string;
  unidade: string;
  pesavel: boolean;
  codigoBalanca: string;
  foto: string;
  ativo: boolean;
  precoCusto: string;
  precoVenda: string;
  precoAtacado: string;
  qtdAtacado: string;
  estoqueMinimo: string;
  estoqueMaximo: string;
  pesoBrutoKg: string;
  controlaLote: boolean;
  validadeDias: string;
  insumo: boolean;
  produzido: boolean;
  ncm: string;
  cest: string;
  cfop: string;
  csosn: string;
}

function rascunhoDe(p: ProdutoDTO | null): Rascunho {
  return {
    codigo: p?.codigo ?? '',
    ean: p?.ean ?? '',
    nome: p?.nome ?? '',
    descricao: p?.descricao ?? '',
    marca: p?.marca ?? '',
    categoriaId: p?.categoriaId ? String(p.categoriaId) : '',
    unidade: p?.unidade ?? 'UN',
    pesavel: p?.pesavel ?? false,
    codigoBalanca: p?.codigoBalanca ? String(p.codigoBalanca) : '',
    foto: p?.foto ?? '',
    ativo: p?.ativo ?? true,
    precoCusto: p ? numeroParaCampo(p.precoCusto, 4) : '',
    precoVenda: p ? numeroParaCampo(p.precoVenda, 2) : '',
    precoAtacado: p ? numeroParaCampo(p.precoAtacado, 2) : '',
    qtdAtacado: p ? numeroParaCampo(p.qtdAtacado, 3) : '',
    estoqueMinimo: p ? numeroParaCampo(p.estoqueMinimo, 3) : '',
    estoqueMaximo: p ? numeroParaCampo(p.estoqueMaximo, 3) : '',
    pesoBrutoKg: p ? numeroParaCampo(p.pesoBrutoKg, 3) : '',
    controlaLote: p?.controlaLote ?? false,
    validadeDias: p?.validadeDias != null ? String(p.validadeDias) : '',
    insumo: p?.insumo ?? false,
    produzido: p?.produzido ?? false,
    ncm: p?.ncm ?? '',
    cest: p?.cest ?? '',
    cfop: p?.cfop ?? '',
    csosn: p?.csosn ?? '',
  };
}

// Campo numérico em branco vira null; texto inválido ou negativo dá erro (a mensagem vai para o aviso).
function numeroDoCampo(texto: string, rotulo: string): number | null {
  if (texto.trim() === '') return null;
  const n = lerNumero(texto);
  if (n === null || n < 0) throw new Error(`${rotulo} inválido.`);
  return n;
}

function montarCorpo(f: Rascunho) {
  if (!f.nome.trim()) throw new Error('Informe o nome do produto.');
  const plu = numeroDoCampo(f.codigoBalanca, 'PLU da balança');
  const validade = numeroDoCampo(f.validadeDias, 'Validade em dias');
  return {
    codigo: f.codigo.trim(),
    ean: f.ean.trim() || null,
    nome: f.nome.trim(),
    descricao: f.descricao.trim() || null,
    marca: f.marca.trim() || null,
    categoriaId: f.categoriaId ? Number(f.categoriaId) : null,
    unidade: f.unidade,
    pesavel: f.pesavel,
    codigoBalanca: plu === null ? null : Math.round(plu),
    precoCusto: numeroDoCampo(f.precoCusto, 'Custo') ?? 0,
    precoVenda: numeroDoCampo(f.precoVenda, 'Preço de venda') ?? 0,
    precoAtacado: numeroDoCampo(f.precoAtacado, 'Preço de atacado'),
    qtdAtacado: numeroDoCampo(f.qtdAtacado, 'Quantidade de atacado'),
    estoqueMinimo: numeroDoCampo(f.estoqueMinimo, 'Estoque mínimo') ?? 0,
    estoqueMaximo: numeroDoCampo(f.estoqueMaximo, 'Estoque máximo'),
    pesoBrutoKg: numeroDoCampo(f.pesoBrutoKg, 'Peso bruto'),
    controlaLote: f.controlaLote,
    validadeDias: validade === null ? null : Math.round(validade),
    insumo: f.insumo,
    produzido: f.produzido,
    ncm: f.ncm.trim() || null,
    cest: f.cest.trim() || null,
    cfop: f.cfop.trim() || null,
    csosn: f.csosn.trim() || null,
    foto: f.foto.trim() || null,
    ativo: f.ativo,
  };
}

const ABAS = [
  { id: 'geral', rotulo: 'Geral' },
  { id: 'precos', rotulo: 'Preços' },
  { id: 'estoque', rotulo: 'Estoque' },
  { id: 'padaria', rotulo: 'Padaria' },
  { id: 'fiscal', rotulo: 'Fiscal' },
];

const COLUNAS_HISTORICO: ColunaTabela<HistoricoPrecoDTO>[] = [
  { titulo: 'Data', celula: (h) => formatarDataHora(h.criadoEm) },
  { titulo: 'Venda anterior', alinhar: 'direita', celula: (h) => formatarMoeda(h.precoAnterior) },
  { titulo: 'Venda nova', alinhar: 'direita', celula: (h) => formatarMoeda(h.precoNovo) },
  {
    titulo: 'Custo',
    alinhar: 'direita',
    celula: (h) =>
      h.custoAnterior === null && h.custoNovo === null
        ? '-'
        : `${formatarMoeda(h.custoAnterior ?? 0)} → ${formatarMoeda(h.custoNovo ?? 0)}`,
  },
];

const COLUNAS_FORNECEDORES: ColunaTabela<FornecedorProdutoDTO>[] = [
  { titulo: 'Fornecedor', celula: (f) => f.nome },
  { titulo: 'Código no fornecedor', celula: (f) => f.codigoFornecedor ?? '-' },
  { titulo: 'Último preço', alinhar: 'direita', celula: (f) => (f.ultimoPreco === null ? '-' : formatarMoeda(f.ultimoPreco)) },
];

// Ficha do produto (novo ou edição). Só carrega o detalhe quando é edição.
export function FichaProduto({
  produtoId,
  abaInicial,
  somenteLeitura,
  aoFechar,
  aoSalvo,
}: {
  produtoId: number | null;
  abaInicial?: string;
  somenteLeitura: boolean;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const editando = produtoId !== null;
  const { dados, carregando, erro } = useDados<ProdutoFichaDTO>(editando ? `/produtos/${produtoId}` : null);

  return (
    <Modal aberto titulo={editando ? 'Ficha do produto' : 'Novo produto'} aoFechar={aoFechar}>
      <div className="produtos-ficha">
        {editando && carregando && <Carregando />}
        {editando && erro && <Aviso tipo="erro">{erro}</Aviso>}
        {(!editando || dados) && (
          <Formulario
            key={dados?.id ?? 'novo'}
            inicial={dados}
            abaInicial={abaInicial}
            somenteLeitura={somenteLeitura}
            aoFechar={aoFechar}
            aoSalvo={aoSalvo}
          />
        )}
      </div>
    </Modal>
  );
}

function Formulario({
  inicial,
  abaInicial,
  somenteLeitura,
  aoFechar,
  aoSalvo,
}: {
  inicial: ProdutoFichaDTO | null;
  abaInicial?: string;
  somenteLeitura: boolean;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [f, setF] = useState<Rascunho>(() => rascunhoDe(inicial));
  const [aba, setAba] = useState(abaInicial ?? 'geral');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const config = useDados<ConfiguracaoPublicaDTO>('/configuracoes/mercado/publico');

  function mudar<K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) {
    setF((atual) => ({ ...atual, [campo]: valor }));
  }

  // Em produto existente a foto grava na hora (PUT só com foto); em produto novo vai junto com o Salvar.
  async function gravarFoto(foto: string | null) {
    if (inicial) {
      await api.put<ProdutoDTO>(`/produtos/${inicial.id}`, { foto });
      aoSalvo(foto ? `Foto de ${inicial.nome} atualizada.` : `Foto de ${inicial.nome} removida.`);
    }
    mudar('foto', foto ?? '');
  }

  async function trocarFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    setErroFoto(null);
    if (!arquivo.type.startsWith('image/')) {
      setErroFoto('Escolha um arquivo de imagem (JPG, PNG ou WebP).');
      return;
    }
    setEnviandoFoto(true);
    try {
      await gravarFoto(await reduzirFoto(arquivo));
    } catch (err) {
      setErroFoto(mensagemErro(err));
    } finally {
      setEnviandoFoto(false);
      if (inputFoto.current) inputFoto.current.value = '';
    }
  }

  async function removerFoto() {
    setErroFoto(null);
    setEnviandoFoto(true);
    try {
      await gravarFoto(null);
    } catch (err) {
      setErroFoto(mensagemErro(err));
    } finally {
      setEnviandoFoto(false);
    }
  }

  const nomeCategoria = (categorias.dados ?? []).find((c) => String(c.id) === f.categoriaId)?.nome ?? null;

  // Margem e markup ao vivo, com a venda e o custo digitados.
  const custo = lerNumero(f.precoCusto) ?? 0;
  const venda = lerNumero(f.precoVenda) ?? 0;
  const margem = margemDe(custo, venda);
  const markup = markupDe(custo, venda);
  const margemPadrao = config.dados?.margemPadrao ?? 30;
  const sugerido = sugerirPreco(custo, margemPadrao, config.dados?.arredondarPreco ?? true);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    let corpo: ReturnType<typeof montarCorpo>;
    try {
      corpo = montarCorpo(f);
    } catch (err) {
      setErro(mensagemErro(err));
      return;
    }
    setEnviando(true);
    try {
      if (inicial) {
        await api.put<ProdutoDTO>(`/produtos/${inicial.id}`, corpo);
        aoSalvo(`Produto ${corpo.nome} atualizado.`);
      } else {
        await api.post<ProdutoDTO>('/produtos', corpo);
        aoSalvo(`Produto ${corpo.nome} cadastrado.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      <div className="produtos-ficha-corpo">
        <aside className="produtos-ficha-foto">
          <FotoProduto foto={f.foto || null} nome={f.nome || 'Produto sem nome'} setor={nomeCategoria} preencher />
          <div className="produtos-foto-acoes">
            <Botao
              variante="secundario"
              desabilitado={somenteLeitura || enviandoFoto}
              aoClicar={() => inputFoto.current?.click()}
            >
              {enviandoFoto ? 'Enviando...' : 'Enviar foto'}
            </Botao>
            {f.foto && (
              <Botao variante="texto" desabilitado={somenteLeitura || enviandoFoto} aoClicar={removerFoto}>
                Remover foto
              </Botao>
            )}
            <input
              ref={inputFoto}
              type="file"
              accept="image/*"
              className="produtos-arquivo-oculto"
              aria-label="Escolher foto do produto"
              onChange={(e) => trocarFoto(e.target.files?.[0])}
            />
          </div>
          {erroFoto && <Aviso tipo="erro">{erroFoto}</Aviso>}
          <p className="produtos-legenda">A foto é reduzida para {LADO_FOTO} × {LADO_FOTO} antes de salvar.</p>
        </aside>

        <div className="produtos-ficha-campos">
      <Abas
        abas={inicial ? [...ABAS, { id: 'historico', rotulo: 'Histórico' }] : ABAS}
        ativa={aba}
        aoMudar={setAba}
      />

      <fieldset className="produtos-fieldset" disabled={somenteLeitura}>
        {aba === 'geral' && (
          <div className="produtos-grade">
            <Campo rotulo="Código interno" valor={f.codigo} aoMudar={(v) => mudar('codigo', v)} />
            <Campo rotulo="Código de barras (EAN)" valor={f.ean} aoMudar={(v) => mudar('ean', v)} />
            <div className="produtos-campo-largo">
              <Campo rotulo="Nome" valor={f.nome} aoMudar={(v) => mudar('nome', v)} obrigatorio />
            </div>
            <Campo rotulo="Marca" valor={f.marca} aoMudar={(v) => mudar('marca', v)} />
            <Selecao
              rotulo="Categoria"
              valor={f.categoriaId}
              aoMudar={(v) => mudar('categoriaId', v)}
              opcoes={(categorias.dados ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              vazio="Sem categoria"
            />
            <Selecao
              rotulo="Unidade"
              valor={f.unidade}
              aoMudar={(v) => mudar('unidade', v)}
              opcoes={UNIDADES.map((u) => ({ valor: u, rotulo: u.toLowerCase() }))}
            />
            <div className="produtos-campo-largo">
              <AreaTexto rotulo="Descrição" valor={f.descricao} aoMudar={(v) => mudar('descricao', v)} linhas={3} />
            </div>
            <Campo rotulo="Endereço da imagem (opcional)" valor={f.foto} aoMudar={(v) => mudar('foto', v)} />
            <div className="produtos-caixas">
              <Caixa rotulo="Vendido no peso (balança)" marcado={f.pesavel} aoMudar={(v) => mudar('pesavel', v)} />
              <Caixa rotulo="Ativo" marcado={f.ativo} aoMudar={(v) => mudar('ativo', v)} />
            </div>
            {f.pesavel && (
              <Campo
                rotulo="PLU da balança (vazio gera o próximo)"
                valor={f.codigoBalanca}
                aoMudar={(v) => mudar('codigoBalanca', v)}
              />
            )}
          </div>
        )}

        {aba === 'precos' && (
          <div className="produtos-grade">
            <Campo rotulo="Custo (R$)" valor={f.precoCusto} aoMudar={(v) => mudar('precoCusto', v)} />
            <Campo rotulo="Preço de venda (R$)" valor={f.precoVenda} aoMudar={(v) => mudar('precoVenda', v)} />
            <div className="produtos-campo-largo produtos-resumo-preco">
              <span>
                Margem: <Selo cor={corDaMargem(margem)}>{formatarPercentual(margem)}</Selo>
              </span>
              <span>Markup: {formatarPercentual(markup)}</span>
              <span>
                Sugerido pela margem padrão ({formatarPercentual(margemPadrao)}): <strong>{formatarMoeda(sugerido)}</strong>
              </span>
              <Botao variante="secundario" aoClicar={() => mudar('precoVenda', numeroParaCampo(sugerido, 2))}>
                Usar sugerido
              </Botao>
            </div>
            <Campo rotulo="Preço de atacado (R$)" valor={f.precoAtacado} aoMudar={(v) => mudar('precoAtacado', v)} />
            <Campo rotulo="A partir de quantas unidades" valor={f.qtdAtacado} aoMudar={(v) => mudar('qtdAtacado', v)} />
          </div>
        )}

        {aba === 'estoque' && (
          <div className="produtos-grade">
            <Campo rotulo="Estoque mínimo" valor={f.estoqueMinimo} aoMudar={(v) => mudar('estoqueMinimo', v)} />
            <Campo rotulo="Estoque máximo" valor={f.estoqueMaximo} aoMudar={(v) => mudar('estoqueMaximo', v)} />
            <Campo rotulo="Peso bruto (kg)" valor={f.pesoBrutoKg} aoMudar={(v) => mudar('pesoBrutoKg', v)} />
            <Campo rotulo="Validade (dias)" valor={f.validadeDias} aoMudar={(v) => mudar('validadeDias', v)} />
            <div className="produtos-caixas">
              <Caixa rotulo="Controla lote e validade" marcado={f.controlaLote} aoMudar={(v) => mudar('controlaLote', v)} />
            </div>
          </div>
        )}

        {aba === 'padaria' && (
          <div className="produtos-grade">
            <div className="produtos-caixas produtos-campo-largo">
              <Caixa
                rotulo="Insumo (matéria-prima, não aparece no PDV)"
                marcado={f.insumo}
                aoMudar={(v) => mudar('insumo', v)}
              />
              <Caixa rotulo="Produção própria (tem receita)" marcado={f.produzido} aoMudar={(v) => mudar('produzido', v)} />
            </div>
          </div>
        )}

        {aba === 'fiscal' && (
          <div className="produtos-grade">
            <Campo rotulo="NCM" valor={f.ncm} aoMudar={(v) => mudar('ncm', v)} />
            <Campo rotulo="CEST" valor={f.cest} aoMudar={(v) => mudar('cest', v)} />
            <Campo rotulo="CFOP" valor={f.cfop} aoMudar={(v) => mudar('cfop', v)} />
            <Campo rotulo="CSOSN" valor={f.csosn} aoMudar={(v) => mudar('csosn', v)} />
          </div>
        )}

        {aba === 'historico' && inicial && (
          <div className="produtos-historico">
            <h3 className="produtos-subtitulo">Alterações de preço</h3>
            <Tabela
              colunas={COLUNAS_HISTORICO}
              dados={inicial.historicoPrecos}
              chave={(h) => h.criadoEm}
              vazio="Nenhuma alteração de preço registrada."
            />
            <h3 className="produtos-subtitulo">Fornecedores</h3>
            <Tabela
              colunas={COLUNAS_FORNECEDORES}
              dados={inicial.fornecedores}
              chave={(f) => f.fornecedorId}
              vazio="Nenhum fornecedor vinculado a este produto."
            />
          </div>
        )}
      </fieldset>

      {!somenteLeitura && (
        <div className="produtos-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      )}
      {somenteLeitura && (
        <div className="produtos-acoes-modal">
          <Botao variante="secundario" aoClicar={aoFechar}>
            Fechar
          </Botao>
        </div>
      )}
        </div>
      </div>
    </form>
  );
}
