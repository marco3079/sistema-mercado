import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Modal, Pagina, Selecao } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { empacotarArquivos, enviarArquivo } from './api';
import { Conferencia } from './Conferencia';
import { MapearColunas, camposFaltando } from './MapearColunas';
import { Resultado } from './Resultado';
import {
  ORDEM_ENTIDADES,
  ROTULOS_ENTIDADE,
} from './tipos';
import type {
  Entidade,
  LeituraPlanilha,
  LoteMigracao,
  Mapeamento,
  PerfilSalvo,
  RespostaCampos,
  ResultadosMigracao,
} from './tipos';

type Etapa = 'fonte' | 'planilha' | 'conferencia' | 'resultado';

const OPCOES_ENTIDADE = ORDEM_ENTIDADES.map((e) => ({ valor: e, rotulo: ROTULOS_ENTIDADE[e] }));

const OPCOES_TIPO_CONTA = [
  { valor: 'PAGAR', rotulo: 'A pagar' },
  { valor: 'RECEBER', rotulo: 'A receber' },
];

function CartaoFonte({
  icone,
  titulo,
  formato,
  texto,
  desabilitado,
  aoClicar,
}: {
  icone: NomeIcone;
  titulo: string;
  formato: string;
  texto: string;
  desabilitado: boolean;
  aoClicar: () => void;
}) {
  return (
    <button type="button" className="migracao-cartao" disabled={desabilitado} onClick={aoClicar}>
      <span className="migracao-cartao-icone">
        <Icone nome={icone} tamanho={26} />
      </span>
      <span className="migracao-cartao-titulo">{titulo}</span>
      <span className="migracao-cartao-formato">{formato}</span>
      <span className="migracao-cartao-texto">{texto}</span>
    </button>
  );
}

export function Migracao() {
  const campos = useDados<RespostaCampos>('/migracao/campos');
  const salvos = useDados<PerfilSalvo[]>('/migracao/perfis');

  const [etapa, setEtapa] = useState<Etapa>('fonte');
  const [lote, setLote] = useState<LoteMigracao | null>(null);
  const [resultados, setResultados] = useState<ResultadosMigracao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estado da etapa planilha.
  const [entidade, setEntidade] = useState<Entidade>('produtos');
  const [perfil, setPerfil] = useState('');
  const [tipoConta, setTipoConta] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<LeituraPlanilha | null>(null);
  const [mapeamento, setMapeamento] = useState<Mapeamento>([]);
  const [modalPerfil, setModalPerfil] = useState(false);
  const [nomePerfil, setNomePerfil] = useState('');

  const refPlanilha = useRef<HTMLInputElement>(null);
  const refSped = useRef<HTMLInputElement>(null);
  const refNfe = useRef<HTMLInputElement>(null);
  // Só a leitura mais recente da planilha vale (troca rápida de entidade ou perfil).
  const versaoLeitura = useRef(0);

  const camposDaEntidade = campos.dados?.entidades.find((x) => x.id === entidade)?.campos ?? [];

  function limparPlanilha() {
    setArquivo(null);
    setLeitura(null);
    setMapeamento([]);
    setPerfil('');
    setTipoConta('');
  }

  function voltarFonte() {
    limparPlanilha();
    setErro(null);
    setEtapa('fonte');
  }

  function novaImportacao() {
    limparPlanilha();
    setEntidade('produtos');
    setLote(null);
    setResultados(null);
    setErro(null);
    setNomePerfil('');
    setModalPerfil(false);
    setEtapa('fonte');
  }

  // Envia um corpo cru para a conferência e vai para a etapa de conferência com o lote.
  async function enviarParaConferencia(caminho: string, corpo: Blob, nome: string, extras?: Record<string, string>) {
    setEnviando(true);
    setErro(null);
    try {
      const novoLote = await enviarArquivo<LoteMigracao>(caminho, corpo, nome, extras);
      setLote(novoLote);
      setEtapa('conferencia');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  // Etapa fonte: SPED / Sintegra (.txt).
  function escolherSped(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) enviarParaConferencia('/migracao/sped/conferir', f, f.name);
  }

  // Etapa fonte: XMLs de NF-e (vários .xml ou um .zip).
  async function escolherNfe(e: ChangeEvent<HTMLInputElement>) {
    const lista = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (lista.length === 0) return;
    if (lista.length === 1 && lista[0].name.toLowerCase().endsWith('.zip')) {
      await enviarParaConferencia('/migracao/nfe/conferir', lista[0], lista[0].name);
      return;
    }
    try {
      const pacote = await empacotarArquivos(lista);
      await enviarParaConferencia('/migracao/nfe/conferir', pacote, 'pacote');
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  // Etapa planilha: lê as colunas (sugestão ou perfil escolhido).
  async function lerPlanilha(f: File, ent: Entidade, perf: string) {
    const versao = ++versaoLeitura.current;
    const query = new URLSearchParams({ entidade: ent });
    if (perf) query.set('perfil', perf);
    setEnviando(true);
    setErro(null);
    try {
      const r = await enviarArquivo<LeituraPlanilha>(`/migracao/planilha/ler?${query.toString()}`, f, f.name);
      if (versao !== versaoLeitura.current) return;
      setLeitura(r);
      setMapeamento(r.mapeamento);
    } catch (e) {
      if (versao !== versaoLeitura.current) return;
      setLeitura(null);
      setErro(mensagemErro(e));
    } finally {
      if (versao === versaoLeitura.current) setEnviando(false);
    }
  }

  function escolherPlanilha(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setArquivo(f);
    lerPlanilha(f, entidade, perfil);
  }

  function mudarEntidade(valor: string) {
    const nova = valor as Entidade;
    setEntidade(nova);
    setPerfil('');
    if (nova !== 'contas') setTipoConta('');
    if (arquivo) lerPlanilha(arquivo, nova, '');
  }

  function mudarPerfil(valor: string) {
    setPerfil(valor);
    if (arquivo) lerPlanilha(arquivo, entidade, valor);
  }

  async function baixarModelo() {
    setErro(null);
    try {
      await baixarArquivo(`/migracao/modelo/${entidade}`, `modelo-${entidade}.xlsx`);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function conferirPlanilha() {
    if (!arquivo || !leitura) return;
    const query = new URLSearchParams({ entidade });
    if (entidade === 'contas' && tipoConta) query.set('tipoConta', tipoConta);
    await enviarParaConferencia(`/migracao/planilha/conferir?${query.toString()}`, arquivo, arquivo.name, {
      'x-mapeamento': encodeURIComponent(JSON.stringify(mapeamento)),
    });
  }

  // Monta { cabeçalho normalizado: id do campo } só com as colunas mapeadas.
  async function salvarPerfil() {
    if (!leitura) return;
    const nome = nomePerfil.trim();
    if (!nome) return;
    const mapa: Record<string, string> = {};
    leitura.chaves.forEach((chave, i) => {
      const id = mapeamento[i];
      if (id) mapa[chave] = id;
    });
    setEnviando(true);
    setErro(null);
    try {
      const salvo = await api.post<PerfilSalvo>('/migracao/perfis', { nome, entidade, mapeamento: mapa });
      setModalPerfil(false);
      setNomePerfil('');
      salvos.recarregar();
      setPerfil(`salvo:${salvo.id}`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const perfisDaEntidade = (salvos.dados ?? []).filter((s) => s.entidade === entidade);

  return (
    <Pagina titulo="Importar de outro sistema">
      {erro && etapa !== 'conferencia' && etapa !== 'resultado' && <Aviso tipo="erro">{erro}</Aviso>}

      {etapa === 'fonte' && (
        <>
          <p className="migracao-intro">
            Traga os cadastros do sistema que você usava (Softcom, Bling, Tiny, GDOOR, Hiper, MarketUP ou outro).
            Nada é gravado antes da conferência.
          </p>
          <Aviso tipo="info">
            Importe nesta ordem: fornecedores e clientes, depois produtos, estoque, fiado e contas. A importação usa a
            loja escolhida no topo para o estoque e as contas.
          </Aviso>

          <div className="migracao-grade">
            <CartaoFonte
              icone="lista"
              titulo="Planilha de outro sistema"
              formato=".xlsx ou .csv"
              texto="Produtos, clientes, fornecedores, estoque, fiado ou contas. As colunas são reconhecidas sozinhas."
              desabilitado={enviando}
              aoClicar={() => {
                limparPlanilha();
                setErro(null);
                setEtapa('planilha');
              }}
            />
            <CartaoFonte
              icone="documento"
              titulo="SPED Fiscal ou Sintegra"
              formato=".txt"
              texto="Produtos, clientes, fornecedores e o inventário. Peça ao contador o arquivo do último mês."
              desabilitado={enviando}
              aoClicar={() => refSped.current?.click()}
            />
            <CartaoFonte
              icone="pacote"
              titulo="XMLs de NF-e"
              formato=".xml ou .zip"
              texto="Fornecedores, produtos e contas das notas de compra; clientes das notas de venda."
              desabilitado={enviando}
              aoClicar={() => refNfe.current?.click()}
            />
          </div>

          <input ref={refSped} type="file" accept=".txt" hidden onChange={escolherSped} />
          <input ref={refNfe} type="file" accept=".xml,.zip" multiple hidden onChange={escolherNfe} />

          {enviando && (
            <div className="carregando" role="status" aria-live="polite">
              Lendo e conferindo o arquivo...
            </div>
          )}

          <details className="migracao-ajuda">
            <summary>Como exportar do meu sistema</summary>
            <ul>
              <li>
                <strong>Softcom:</strong> Em Cadastros ou Relatórios, abra a lista de produtos (ou clientes) e use
                Exportar / Salvar como Excel. Se não achar, peça ao suporte da Softcom a exportação ou use o SPED Fiscal.
              </li>
              <li>
                <strong>Bling:</strong> Cadastros {'>'} Produtos {'>'} ⋯ {'>'} Exportar (planilha). Contatos: Cadastros{' '}
                {'>'} Contatos {'>'} Exportar.
              </li>
              <li>
                <strong>Tiny/Olist:</strong> Cadastros {'>'} Produtos {'>'} Mais ações {'>'} Exportar planilha.
              </li>
              <li>
                <strong>Outros:</strong> Quase todo sistema exporta relatórios para Excel ou CSV. Se não exportar, o
                arquivo do SPED Fiscal (EFD ICMS/IPI) que o contador recebe todo mês traz os produtos, clientes,
                fornecedores e o inventário.
              </li>
            </ul>
          </details>
        </>
      )}

      {etapa === 'planilha' && (
        <>
          <div className="migracao-topo-etapa">
            <Botao variante="texto" desabilitado={enviando} aoClicar={voltarFonte}>
              Voltar
            </Botao>
          </div>

          {campos.carregando && (
            <div className="carregando" role="status" aria-live="polite">
              Carregando...
            </div>
          )}
          {campos.erro && <Aviso tipo="erro">{campos.erro}</Aviso>}

          {campos.dados && (
            <div className="migracao-planilha">
              <Selecao
                rotulo="O que tem nesta planilha?"
                valor={entidade}
                aoMudar={mudarEntidade}
                opcoes={OPCOES_ENTIDADE}
              />

              <Selecao
                rotulo="Perfil de colunas"
                valor={perfil}
                aoMudar={mudarPerfil}
                vazio="Automático (qualquer sistema)"
                opcoes={[
                  ...campos.dados.perfis.map((p) => ({ valor: p.id, rotulo: p.nome })),
                  ...perfisDaEntidade.map((s) => ({ valor: `salvo:${s.id}`, rotulo: `★ ${s.nome}` })),
                ]}
              />

              {entidade === 'contas' && (
                <Selecao
                  rotulo="Estas contas são"
                  valor={tipoConta}
                  aoMudar={setTipoConta}
                  vazio="Conforme a coluna Tipo"
                  opcoes={OPCOES_TIPO_CONTA}
                />
              )}

              <div className="migracao-acoes-planilha">
                <Botao variante="secundario" desabilitado={enviando} aoClicar={baixarModelo}>
                  Baixar modelo
                </Botao>
                <Botao
                  variante="secundario"
                  desabilitado={enviando}
                  aoClicar={() => refPlanilha.current?.click()}
                >
                  Escolher planilha
                </Botao>
                <input
                  ref={refPlanilha}
                  type="file"
                  accept=".xlsx,.csv"
                  hidden
                  onChange={escolherPlanilha}
                />
              </div>

              {arquivo && <p className="migracao-arquivo">{arquivo.name}</p>}

              {enviando && (
                <div className="carregando" role="status" aria-live="polite">
                  Lendo e conferindo o arquivo...
                </div>
              )}

              {leitura && (
                <>
                  <MapearColunas
                    leitura={leitura}
                    campos={camposDaEntidade}
                    mapeamento={mapeamento}
                    aoMudar={setMapeamento}
                  />

                  <div className="migracao-acoes-planilha">
                    <Botao variante="secundario" desabilitado={enviando} aoClicar={() => setModalPerfil(true)}>
                      Salvar como perfil
                    </Botao>
                    <Botao
                      desabilitado={enviando || camposFaltando(camposDaEntidade, mapeamento).length > 0}
                      aoClicar={conferirPlanilha}
                    >
                      Conferir
                    </Botao>
                  </div>
                </>
              )}
            </div>
          )}

          <Modal aberto={modalPerfil} titulo="Salvar como perfil" aoFechar={() => setModalPerfil(false)}>
            <Campo
              rotulo="Nome do perfil"
              valor={nomePerfil}
              aoMudar={setNomePerfil}
              obrigatorio
              placeholder="Ex.: Softcom produtos"
            />
            <div className="migracao-acoes-planilha">
              <Botao variante="secundario" aoClicar={() => setModalPerfil(false)}>
                Cancelar
              </Botao>
              <Botao desabilitado={!nomePerfil.trim() || enviando} aoClicar={salvarPerfil}>
                Salvar perfil
              </Botao>
            </div>
          </Modal>
        </>
      )}

      {etapa === 'conferencia' && lote && (
        <Conferencia
          lote={lote}
          aoVoltar={() => setEtapa('fonte')}
          aoConcluir={(r) => {
            setResultados(r);
            setEtapa('resultado');
          }}
        />
      )}

      {etapa === 'resultado' && resultados && (
        <Resultado resultados={resultados} aoNovaImportacao={novaImportacao} />
      )}
    </Pagina>
  );
}
