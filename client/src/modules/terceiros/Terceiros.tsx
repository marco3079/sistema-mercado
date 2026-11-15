import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { podeEscrever } from './tipos';
import type { ResumoTerceiros, RespostaSaldos, SaldoTerceiro, TerceiroLinha } from './tipos';
import { ModalNovaRemessa } from './Remessas';
import './terceiros.css';

type Aba = 'terceiros' | 'produtos';
type Janela = { tipo: 'cadastro'; terceiro: TerceiroLinha | null } | { tipo: 'remessa'; terceiroId: number } | null;

// Visão geral de terceiros: resumo, cartão de cada terceiro (com nova remessa e saldo) e saldo por produto.
export function Terceiros() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const escreve = podeEscrever(usuario?.perfil);
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';

  const [aba, setAba] = useState<Aba>('terceiros');
  const [janela, setJanela] = useState<Janela>(null);
  const [terceiroFiltro, setTerceiroFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');

  // A busca só vai ao servidor depois de 300 ms sem digitar.
  useEffect(() => {
    const espera = window.setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => window.clearTimeout(espera);
  }, [busca]);

  const resumo = useDados<ResumoTerceiros>('/terceiros/resumo');
  const terceiros = useDados<TerceiroLinha[]>('/terceiros');

  const consulta = new URLSearchParams();
  if (terceiroFiltro) consulta.set('terceiroId', terceiroFiltro);
  if (buscaAplicada) consulta.set('busca', buscaAplicada);
  const textoConsulta = consulta.toString();
  const saldos = useDados<RespostaSaldos>(aba === 'produtos' ? `/terceiros/estoque${textoConsulta ? `?${textoConsulta}` : ''}` : null);

  function recarregarTudo() {
    resumo.recarregar();
    terceiros.recarregar();
    saldos.recarregar();
  }

  function verSaldo(id: number) {
    setTerceiroFiltro(String(id));
    setAba('produtos');
  }

  const opcoesTerceiro = (terceiros.dados ?? []).map((t) => ({ valor: String(t.id), rotulo: t.nome }));

  const colunasSaldo: ColunaTabela<SaldoTerceiro>[] = [
    {
      titulo: 'Produto',
      celula: (s) => <CelulaProduto foto={s.foto} nome={s.nome} setor={s.categoria} detalhe={s.codigo} />,
    },
    { titulo: 'Terceiro', celula: (s) => s.terceiro },
    { titulo: 'Loja', celula: (s) => s.loja },
    {
      titulo: 'Quantidade',
      alinhar: 'direita',
      celula: (s) => <span className="numero">{formatarQuantidade(s.quantidade, s.unidade)}</span>,
    },
    {
      titulo: 'Valor',
      alinhar: 'direita',
      celula: (s) => <span className="numero">{formatarMoeda(s.valor)}</span>,
    },
  ];

  return (
    <Pagina
      titulo="Estoque em terceiros"
      acoes={escreve ? <Botao aoClicar={() => setJanela({ tipo: 'cadastro', terceiro: null })}>Novo terceiro</Botao> : undefined}
    >
      {resumo.carregando && !resumo.dados && <Carregando />}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.dados && <ResumoCartoes r={resumo.dados} />}

      <Abas
        abas={[
          { id: 'terceiros', rotulo: 'Por terceiro' },
          { id: 'produtos', rotulo: 'Por produto' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as Aba)}
      />

      {aba === 'terceiros' && (
        <>
          {terceiros.carregando && !terceiros.dados && <Carregando />}
          {terceiros.erro && <Aviso tipo="erro">{terceiros.erro}</Aviso>}
          {terceiros.dados && terceiros.dados.length === 0 && (
            <Cartao>
              <p className="terceiros-texto-suave">
                Nenhum terceiro cadastrado.{escreve ? ' Use "Novo terceiro" para começar.' : ''}
              </p>
            </Cartao>
          )}
          {terceiros.dados && terceiros.dados.length > 0 && (
            <div className="terceiros-cartoes">
              {terceiros.dados.map((t) => (
                <CartaoTerceiro
                  key={t.id}
                  t={t}
                  escreve={escreve}
                  aoNovaRemessa={() => setJanela({ tipo: 'remessa', terceiroId: t.id })}
                  aoVerSaldo={() => verSaldo(t.id)}
                  aoEditar={() => setJanela({ tipo: 'cadastro', terceiro: t })}
                  aoVerRemessas={() => navigate(`${raiz}/remessas-terceiro?terceiroId=${t.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {aba === 'produtos' && (
        <>
          <Cartao>
            <div className="barra-ferramentas">
              <div className="filtros">
                <Campo rotulo="Buscar" tipo="search" valor={busca} aoMudar={setBusca} placeholder="Buscar por nome ou código" />
                <Selecao rotulo="Terceiro" valor={terceiroFiltro} aoMudar={setTerceiroFiltro} opcoes={opcoesTerceiro} vazio="Todos" />
              </div>
            </div>
          </Cartao>

          {saldos.carregando && !saldos.dados && <Carregando />}
          {saldos.erro && <Aviso tipo="erro">{saldos.erro}</Aviso>}
          {saldos.dados && (
            <>
              <p className="terceiros-texto-suave">
                {saldos.dados.total} {saldos.dados.total === 1 ? 'item' : 'itens'} · valor em posse {formatarMoeda(saldos.dados.valorTotal)}
              </p>
              <Tabela
                colunas={colunasSaldo}
                dados={saldos.dados.itens}
                chave={(s) => s.id}
                vazio="Nenhum produto em posse de terceiros com esses filtros."
                idVisao="terceiros-saldos"
              />
            </>
          )}
        </>
      )}

      {janela?.tipo === 'cadastro' && (
        <ModalTerceiro
          terceiro={janela.terceiro}
          aoFechar={() => setJanela(null)}
          aoSalvo={() => {
            setJanela(null);
            recarregarTudo();
          }}
        />
      )}
      {janela?.tipo === 'remessa' && (
        <ModalNovaRemessa aberto aoFechar={() => setJanela(null)} terceiroInicial={janela.terceiroId} />
      )}
    </Pagina>
  );
}

function ResumoCartoes({ r }: { r: ResumoTerceiros }) {
  const itens: { rotulo: string; valor: string; icone: NomeIcone; cor: string; atraso?: boolean }[] = [
    { rotulo: 'Valor em posse de terceiros', valor: formatarMoeda(r.valorEmPosse), icone: 'dinheiro', cor: 'verde' },
    { rotulo: 'Produtos em posse', valor: `${r.produtosEmPosse} ${r.produtosEmPosse === 1 ? 'produto' : 'produtos'}`, icone: 'pacote', cor: 'azul' },
    { rotulo: 'Remessas abertas', valor: String(r.remessasAbertas), icone: 'caminhao', cor: 'roxo' },
    { rotulo: 'Atrasadas', valor: String(r.atrasadas), icone: 'validade', cor: 'vermelho', atraso: r.atrasadas > 0 },
  ];
  return (
    <div className="resumo">
      {itens.map((i) => (
        <div className="resumo-item" key={i.rotulo}>
          <span className={`resumo-icone resumo-icone-${i.cor}`}>
            <Icone nome={i.icone} tamanho={24} />
          </span>
          <div>
            <span className={i.atraso ? 'resumo-valor terceiros-atraso' : 'resumo-valor'}>{i.valor}</span>
            <span className="resumo-rotulo">{i.rotulo}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CartaoTerceiro({
  t,
  escreve,
  aoNovaRemessa,
  aoVerSaldo,
  aoEditar,
  aoVerRemessas,
}: {
  t: TerceiroLinha;
  escreve: boolean;
  aoNovaRemessa: () => void;
  aoVerSaldo: () => void;
  aoEditar: () => void;
  aoVerRemessas: () => void;
}) {
  const acoes: AcaoMenu[] = [];
  if (escreve) acoes.push({ rotulo: 'Editar cadastro', aoClicar: aoEditar });
  acoes.push({ rotulo: 'Ver remessas', aoClicar: aoVerRemessas });

  return (
    <article className="terceiros-cartao">
      <header className="terceiros-cartao-topo">
        <div className="terceiros-cartao-titulo">
          <span className="terceiros-icone">
            <Icone nome="usuarios" tamanho={20} />
          </span>
          <span className="terceiros-identidade">
            <strong>{t.nome}</strong>
            <span className="terceiros-detalhe">{t.documento || 'Sem CPF/CNPJ'}</span>
          </span>
        </div>
        {!t.ativo && <Selo cor="cinza">Inativo</Selo>}
      </header>

      <dl className="terceiros-dados">
        <div>
          <dt>Contato</dt>
          <dd>{t.contato || t.telefone || '—'}</dd>
        </div>
        <div>
          <dt>Remessas abertas</dt>
          <dd>{t.remessasAbertas}</dd>
        </div>
        <div>
          <dt>Em posse</dt>
          <dd className="numero">{formatarMoeda(t.valorEmPosse)}</dd>
        </div>
        <div>
          <dt>Produtos em posse</dt>
          <dd>{`${t.produtosEmPosse} ${t.produtosEmPosse === 1 ? 'produto' : 'produtos'}`}</dd>
        </div>
      </dl>

      <footer className="terceiros-cartao-rodape">
        {t.atrasadas > 0 ? (
          <Selo cor="vermelho">
            {t.atrasadas} {t.atrasadas === 1 ? 'atrasada' : 'atrasadas'}
          </Selo>
        ) : (
          <Selo cor="verde">Em dia</Selo>
        )}
        <span className="terceiros-acoes">
          <Botao variante="secundario" aoClicar={aoVerSaldo}>
            Ver saldo
          </Botao>
          {escreve && (
            <Botao desabilitado={!t.ativo} aoClicar={aoNovaRemessa}>
              Nova remessa
            </Botao>
          )}
          <MenuAcoes rotulo={`Mais ações de ${t.nome}`} acoes={acoes} />
        </span>
      </footer>
    </article>
  );
}

function ModalTerceiro({
  terceiro,
  aoFechar,
  aoSalvo,
}: {
  terceiro: TerceiroLinha | null;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  return (
    <Modal aberto titulo={terceiro ? 'Editar terceiro' : 'Novo terceiro'} aoFechar={aoFechar}>
      <FormularioTerceiro terceiro={terceiro} aoFechar={aoFechar} aoSalvo={aoSalvo} />
    </Modal>
  );
}

function FormularioTerceiro({
  terceiro,
  aoFechar,
  aoSalvo,
}: {
  terceiro: TerceiroLinha | null;
  aoFechar: () => void;
  aoSalvo: () => void;
}) {
  const [nome, setNome] = useState(terceiro?.nome ?? '');
  const [documento, setDocumento] = useState(terceiro?.documento ?? '');
  const [contato, setContato] = useState(terceiro?.contato ?? '');
  const [telefone, setTelefone] = useState(terceiro?.telefone ?? '');
  const [email, setEmail] = useState(terceiro?.email ?? '');
  const [cidade, setCidade] = useState(terceiro?.cidade ?? '');
  const [uf, setUf] = useState(terceiro?.uf ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    if (!nome.trim()) return setErro('Informe o nome do terceiro.');
    const corpo = {
      nome: nome.trim(),
      documento: documento.trim() || null,
      contato: contato.trim() || null,
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      cidade: cidade.trim() || null,
      uf: uf.trim().toUpperCase() || null,
    };
    setOcupado(true);
    try {
      if (terceiro) await api.put(`/terceiros/${terceiro.id}`, corpo);
      else await api.post('/terceiros', corpo);
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
      <div className="terceiros-form-grade">
        <div className="terceiros-larga">
          <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        </div>
        <Campo rotulo="CPF ou CNPJ" valor={documento} aoMudar={setDocumento} />
        <Campo rotulo="Pessoa de contato" valor={contato} aoMudar={setContato} />
        <Campo rotulo="Telefone" tipo="text" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} />
        <Campo rotulo="Cidade" valor={cidade} aoMudar={setCidade} />
        <Campo rotulo="UF" valor={uf} aoMudar={setUf} />
      </div>
      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        <Botao aoClicar={salvar} desabilitado={ocupado}>
          {ocupado ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </>
  );
}
