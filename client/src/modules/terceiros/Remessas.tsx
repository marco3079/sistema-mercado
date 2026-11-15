import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, AreaTexto, Botao, Campo, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { BarraNivel, CelulaProduto } from '../../ui/FotoProduto';
import {
  COR_STATUS,
  COR_TIPO,
  ROTULOS_STATUS,
  ROTULOS_TIPO,
  TIPOS_TERCEIRO,
  diasAte,
  podeEscrever,
  textoPreco,
} from './tipos';
import type { ProdutoBusca, RemessaDetalhe, RemessaLinha, StatusRemessa, TerceiroLinha, TipoTerceiro } from './tipos';
import './terceiros.css';

const STATUS_OPCOES = [
  { valor: 'ABERTA', rotulo: 'Aberta' },
  { valor: 'PARCIAL', rotulo: 'Parcial' },
  { valor: 'ATRASADA', rotulo: 'Atrasada' },
  { valor: 'ENCERRADA', rotulo: 'Encerrada' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
];

const TIPO_OPCOES = TIPOS_TERCEIRO.map((t) => ({ valor: t, rotulo: ROTULOS_TIPO[t] }));

// Remessa com saldo com o terceiro (ainda pode receber retorno ou baixa).
function estaAberta(status: StatusRemessa): boolean {
  return status === 'ABERTA' || status === 'PARCIAL';
}

function PrevisaoCelula({ r }: { r: RemessaLinha }) {
  if (!r.previsaoRetorno) return <span className="terceiros-detalhe">Sem previsão</span>;
  const dias = diasAte(r.previsaoRetorno);
  const aberta = estaAberta(r.status);
  return (
    <span className="terceiros-identidade">
      <span>{formatarData(r.previsaoRetorno)}</span>
      {aberta &&
        (r.atrasada ? (
          <span className="terceiros-atraso">
            Atrasada há {-dias} {-dias === 1 ? 'dia' : 'dias'}
          </span>
        ) : (
          <span className="terceiros-detalhe">
            {dias === 0 ? 'vence hoje' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
          </span>
        ))}
    </span>
  );
}

// Progresso por unidade: com uma só unidade mostra a barra; com várias, só o texto de cada unidade.
function ProgressoCelula({ r }: { r: RemessaLinha }) {
  const unica = r.unidades.length === 1 ? r.unidades[0] : null;
  return (
    <span className="terceiros-identidade">
      {unica && <BarraNivel valor={unica.retornado + unica.baixado} maximo={unica.enviado} cor="verde" />}
      <span className="terceiros-detalhe">
        {r.unidades
          .map((u) => `${formatarQuantidade(u.retornado + u.baixado, u.unidade)} de ${formatarQuantidade(u.enviado, u.unidade)}`)
          .join(' · ')}
      </span>
    </span>
  );
}

// Lista de remessas, com filtros na URL (assim o link "Ver remessas" do cadastro já vem filtrado).
export function Remessas() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [filtros, setFiltros] = useSearchParams();
  const [novaAberta, setNovaAberta] = useState(false);
  const escreve = podeEscrever(usuario?.perfil);
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';

  const status = filtros.get('status') ?? '';
  const tipo = filtros.get('tipo') ?? '';
  const terceiroId = filtros.get('terceiroId') ?? '';

  const terceiros = useDados<TerceiroLinha[]>('/terceiros');

  const partes = new URLSearchParams();
  if (status) partes.set('status', status);
  if (tipo) partes.set('tipo', tipo);
  if (terceiroId) partes.set('terceiroId', terceiroId);
  const consulta = partes.toString();
  const lista = useDados<RemessaLinha[]>(`/remessas-terceiro${consulta ? `?${consulta}` : ''}`);

  function mudarFiltro(chave: string, valor: string) {
    const proximo = new URLSearchParams(filtros);
    if (valor) proximo.set(chave, valor);
    else proximo.delete(chave);
    setFiltros(proximo, { replace: true });
  }

  const caminhoDe = (id: number) => `${raiz}/remessas-terceiro/${id}`;

  function menuDaRemessa(r: RemessaLinha): AcaoMenu[] {
    const acoes: AcaoMenu[] = [{ rotulo: 'Ver detalhes', aoClicar: () => navigate(caminhoDe(r.id)) }];
    if (escreve && estaAberta(r.status)) {
      acoes.push({ rotulo: 'Registrar retorno', aoClicar: () => navigate(`${caminhoDe(r.id)}?acao=retorno`) });
      acoes.push({ rotulo: 'Registrar baixa', aoClicar: () => navigate(`${caminhoDe(r.id)}?acao=baixa`) });
    }
    if (escreve && r.status === 'ABERTA') {
      acoes.push({ rotulo: 'Cancelar remessa', perigo: true, aoClicar: () => navigate(`${caminhoDe(r.id)}?acao=cancelar`) });
    }
    return acoes;
  }

  const colunas: ColunaTabela<RemessaLinha>[] = [
    {
      titulo: 'Remessa',
      celula: (r) => (
        <span className="terceiros-identidade">
          <strong>Remessa nº {r.numero}</strong>
          <span className="terceiros-detalhe">
            {r.terceiro} · {r.loja}
          </span>
        </span>
      ),
    },
    { titulo: 'Tipo', celula: (r) => <Selo cor={COR_TIPO[r.tipo]}>{ROTULOS_TIPO[r.tipo]}</Selo> },
    { titulo: 'Previsão de retorno', celula: (r) => <PrevisaoCelula r={r} /> },
    { titulo: 'Progresso', celula: (r) => <ProgressoCelula r={r} /> },
    {
      titulo: 'Valor pendente',
      alinhar: 'direita',
      celula: (r) => <span className="numero">{formatarMoeda(r.totais.valorPendente)}</span>,
    },
    { titulo: 'Status', celula: (r) => <Selo cor={COR_STATUS[r.status]}>{ROTULOS_STATUS[r.status]}</Selo> },
    {
      titulo: '',
      acoes: true,
      celula: (r) => (
        <span className="acoes-linha">
          <Botao variante="secundario" aoClicar={() => navigate(caminhoDe(r.id))}>
            Abrir
          </Botao>
          <MenuAcoes rotulo={`Mais ações da remessa ${r.numero}`} acoes={menuDaRemessa(r)} />
        </span>
      ),
    },
  ];

  const opcoesTerceiro = (terceiros.dados ?? []).map((t) => ({ valor: String(t.id), rotulo: t.nome }));

  return (
    <Pagina
      titulo="Remessas a terceiros"
      acoes={escreve ? <Botao aoClicar={() => setNovaAberta(true)}>Nova remessa</Botao> : undefined}
    >
      <Cartao>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Selecao rotulo="Status" valor={status} aoMudar={(v) => mudarFiltro('status', v)} opcoes={STATUS_OPCOES} vazio="Todos" />
            <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => mudarFiltro('tipo', v)} opcoes={TIPO_OPCOES} vazio="Todos" />
            <Selecao rotulo="Terceiro" valor={terceiroId} aoMudar={(v) => mudarFiltro('terceiroId', v)} opcoes={opcoesTerceiro} vazio="Todos" />
          </div>
        </div>
      </Cartao>

      {lista.carregando && !lista.dados && <Carregando />}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.dados && (
        <Tabela
          colunas={colunas}
          dados={lista.dados}
          chave={(r) => r.id}
          vazio="Nenhuma remessa com esses filtros."
          aoClicarLinha={(r) => navigate(caminhoDe(r.id))}
          idVisao="terceiros-remessas"
        />
      )}

      <ModalNovaRemessa aberto={novaAberta} aoFechar={() => setNovaAberta(false)} terceiroInicial={Number(terceiroId) || undefined} />
    </Pagina>
  );
}

interface ItemRascunho {
  produto: ProdutoBusca;
  quantidade: string;
  precoCobranca: string;
}

// Modal de nova remessa. Usado na lista de remessas e no cartão de cada terceiro.
export function ModalNovaRemessa({
  aberto,
  aoFechar,
  terceiroInicial,
}: {
  aberto: boolean;
  aoFechar: () => void;
  terceiroInicial?: number;
}) {
  return (
    <Modal aberto={aberto} titulo="Nova remessa" aoFechar={aoFechar}>
      <FormularioRemessa terceiroInicial={terceiroInicial} aoFechar={aoFechar} />
    </Modal>
  );
}

function FormularioRemessa({ terceiroInicial, aoFechar }: { terceiroInicial?: number; aoFechar: () => void }) {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';
  const terceiros = useDados<TerceiroLinha[]>('/terceiros');

  const [terceiroId, setTerceiroId] = useState(terceiroInicial ? String(terceiroInicial) : '');
  const [tipo, setTipo] = useState<TipoTerceiro>('CONSIGNACAO');
  const [documento, setDocumento] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [itens, setItens] = useState<ItemRascunho[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Busca de produtos com espera de 300 ms depois da última tecla.
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    const espera = window.setTimeout(() => {
      setBuscando(true);
      api
        .get<{ itens: ProdutoBusca[] }>(`/produtos?busca=${encodeURIComponent(termo)}&porPagina=8`)
        .then((r) => {
          if (!cancelado) setResultados(r.itens);
        })
        .catch((e: unknown) => {
          if (!cancelado) setErro(mensagemErro(e));
        })
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [busca]);

  function adicionar(p: ProdutoBusca) {
    setItens((atuais) =>
      atuais.some((i) => i.produto.id === p.id)
        ? atuais
        : [...atuais, { produto: p, quantidade: '1', precoCobranca: textoPreco(p.precoVenda) }],
    );
  }

  function atualizar(produtoId: number, campo: 'quantidade' | 'precoCobranca', valor: string) {
    setItens((atuais) => atuais.map((i) => (i.produto.id === produtoId ? { ...i, [campo]: valor } : i)));
  }

  function remover(produtoId: number) {
    setItens((atuais) => atuais.filter((i) => i.produto.id !== produtoId));
  }

  async function salvar() {
    setErro(null);
    if (!terceiroId) return setErro('Escolha o terceiro.');
    if (itens.length === 0) return setErro('Adicione ao menos um produto.');

    const linhas: { produtoId: number; quantidade: number; precoCobranca: number | null }[] = [];
    for (const i of itens) {
      const quantidade = lerNumero(i.quantidade);
      if (quantidade === null || quantidade <= 0) return setErro(`Informe a quantidade de ${i.produto.nome}.`);
      const precoTexto = i.precoCobranca.trim();
      const preco = precoTexto ? lerNumero(precoTexto) : null;
      if (precoTexto && (preco === null || preco < 0)) return setErro(`Preço de cobrança inválido em ${i.produto.nome}.`);
      linhas.push({ produtoId: i.produto.id, quantidade, precoCobranca: preco });
    }

    setOcupado(true);
    try {
      const criada = await api.post<RemessaDetalhe>('/remessas-terceiro', {
        terceiroId: Number(terceiroId),
        tipo,
        documento: documento.trim() || null,
        previsaoRetorno: previsao || null,
        observacoes: observacoes.trim() || null,
        itens: linhas,
      });
      aoFechar();
      navigate(`${raiz}/remessas-terceiro/${criada.id}`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const opcoesTerceiro = (terceiros.dados ?? [])
    .filter((t) => t.ativo)
    .map((t) => ({ valor: String(t.id), rotulo: t.nome }));

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <h3 className="terceiros-secao">Dados da remessa</h3>
      <div className="terceiros-form-grade">
        <Selecao rotulo="Terceiro" valor={terceiroId} aoMudar={setTerceiroId} opcoes={opcoesTerceiro} vazio="Escolha o terceiro" obrigatorio />
        <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoTerceiro)} opcoes={TIPO_OPCOES} obrigatorio />
        <Campo rotulo="Nº da nota ou contrato" valor={documento} aoMudar={setDocumento} />
        <Campo rotulo="Previsão de retorno" tipo="date" valor={previsao} aoMudar={setPrevisao} />
        <div className="terceiros-larga">
          <AreaTexto rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} linhas={2} />
        </div>
      </div>

      <h3 className="terceiros-secao">Produtos</h3>
      <Campo rotulo="Buscar produto" tipo="search" valor={busca} aoMudar={setBusca} placeholder="Buscar por nome, código ou EAN" />
      {buscando && <p className="terceiros-texto-suave">Buscando...</p>}
      {resultados.length > 0 && (
        <ul className="terceiros-busca-resultado">
          {resultados.map((p) => {
            const jaEscolhido = itens.some((i) => i.produto.id === p.id);
            return (
              <li key={p.id}>
                <CelulaProduto
                  foto={p.foto}
                  nome={p.nome}
                  setor={p.categoria}
                  detalhe={`${p.codigo} · saldo ${formatarQuantidade(p.estoqueLoja, p.unidade)}`}
                />
                <Botao variante="secundario" desabilitado={jaEscolhido} aoClicar={() => adicionar(p)}>
                  {jaEscolhido ? 'Adicionado' : 'Adicionar'}
                </Botao>
              </li>
            );
          })}
        </ul>
      )}

      {itens.length === 0 ? (
        <p className="terceiros-texto-suave">Nenhum produto escolhido. Busque acima e clique em Adicionar.</p>
      ) : (
        <div className="terceiros-lista-itens">
          {itens.map((i) => (
            <div className="terceiros-item-linha" key={i.produto.id}>
              <CelulaProduto foto={i.produto.foto} nome={i.produto.nome} setor={i.produto.categoria} detalhe={i.produto.codigo} />
              <Campo
                rotulo={`Quantidade (${i.produto.unidade.toLowerCase()})`}
                valor={i.quantidade}
                aoMudar={(v) => atualizar(i.produto.id, 'quantidade', v)}
                obrigatorio
              />
              <Campo rotulo="Preço de cobrança" valor={i.precoCobranca} aoMudar={(v) => atualizar(i.produto.id, 'precoCobranca', v)} />
              <span className="terceiros-item-remover">
                <Botao variante="texto" aoClicar={() => remover(i.produto.id)}>
                  Remover
                </Botao>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao aoClicar={salvar} desabilitado={ocupado}>
          {ocupado ? 'Salvando...' : 'Criar remessa'}
        </Botao>
      </div>
    </>
  );
}
