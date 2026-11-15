import { useEffect, useRef, useState } from 'react';
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
import type { ResumoTerceiros, RespostaPortal, RespostaSaldos, SaldoTerceiro, TerceiroLinha } from './tipos';
import { ModalNovaRemessa } from './Remessas';
import './terceiros.css';

type Aba = 'terceiros' | 'produtos';
type Janela =
  | { tipo: 'cadastro'; terceiro: TerceiroLinha | null }
  | { tipo: 'remessa'; terceiroId: number }
  | { tipo: 'portal'; terceiro: TerceiroLinha }
  | null;

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
                  aoVerPedidos={() => navigate(`${raiz}/remessas-terceiro?aba=pedidos`)}
                  aoLinkPortal={() => setJanela({ tipo: 'portal', terceiro: t })}
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
      {janela?.tipo === 'portal' && (
        <ModalLinkPortal
          terceiro={janela.terceiro}
          aoFechar={() => setJanela(null)}
          aoAlterado={() => terceiros.recarregar()}
        />
      )}
    </Pagina>
  );
}

function ResumoCartoes({ r }: { r: ResumoTerceiros }) {
  const itens: { rotulo: string; valor: string; icone: NomeIcone; cor: string; classe?: string; atraso?: boolean }[] = [
    { rotulo: 'Valor em posse de terceiros', valor: formatarMoeda(r.valorEmPosse), icone: 'dinheiro', cor: 'verde' },
    { rotulo: 'Produtos em posse', valor: `${r.produtosEmPosse} ${r.produtosEmPosse === 1 ? 'produto' : 'produtos'}`, icone: 'pacote', cor: 'azul' },
    { rotulo: 'Remessas abertas', valor: String(r.remessasAbertas), icone: 'caminhao', cor: 'roxo' },
    { rotulo: 'Atrasadas', valor: String(r.atrasadas), icone: 'validade', cor: 'vermelho', atraso: r.atrasadas > 0 },
  ];
  // Pedidos do portal aguardando aprovação: só aparece quando há algum.
  if (r.pedidosPendentes > 0) {
    itens.push({
      rotulo: 'Pedidos aguardando',
      valor: String(r.pedidosPendentes),
      icone: 'sino',
      cor: 'amarelo',
      classe: 'portal-link-icone-amarelo',
    });
  }
  return (
    <div className="resumo">
      {itens.map((i) => (
        <div className="resumo-item" key={i.rotulo}>
          <span className={i.classe ? `resumo-icone ${i.classe}` : `resumo-icone resumo-icone-${i.cor}`}>
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
  aoVerPedidos,
  aoLinkPortal,
}: {
  t: TerceiroLinha;
  escreve: boolean;
  aoNovaRemessa: () => void;
  aoVerSaldo: () => void;
  aoEditar: () => void;
  aoVerRemessas: () => void;
  aoVerPedidos: () => void;
  aoLinkPortal: () => void;
}) {
  const acoes: AcaoMenu[] = [];
  if (escreve) acoes.push({ rotulo: 'Editar cadastro', aoClicar: aoEditar });
  if (escreve) acoes.push({ rotulo: 'Link do portal', icone: 'enviar', aoClicar: aoLinkPortal });
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
        <span className="portal-link-selos">
          {t.atrasadas > 0 ? (
            <Selo cor="vermelho">
              {t.atrasadas} {t.atrasadas === 1 ? 'atrasada' : 'atrasadas'}
            </Selo>
          ) : (
            <Selo cor="verde">Em dia</Selo>
          )}
          {t.pedidosPendentes > 0 && (
            <button type="button" className="portal-link-pedidos" onClick={aoVerPedidos}>
              <Selo cor="amarelo">
                {t.pedidosPendentes} {t.pedidosPendentes === 1 ? 'pedido aguardando' : 'pedidos aguardando'}
              </Selo>
            </button>
          )}
        </span>
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

// Link do portal do terceiro: quem tem o link vê o saldo em posse e pede remessas (pedidos chegam para aprovação).
function ModalLinkPortal({
  terceiro,
  aoFechar,
  aoAlterado,
}: {
  terceiro: TerceiroLinha;
  aoFechar: () => void;
  aoAlterado: () => void;
}) {
  const [codigo, setCodigo] = useState<string | null>(terceiro.codigoAcesso);
  const [confirmar, setConfirmar] = useState<'novo' | 'desligar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const campoLink = useRef<HTMLInputElement>(null);

  const link = codigo ? `${window.location.origin}/remessa/${codigo}` : '';
  const digitos = (terceiro.telefone ?? '').replace(/\D/g, '');
  // Telefone sem DDI recebe 55 (Brasil); com DDI já completo, usa como está.
  const numeroWhatsapp = digitos.startsWith('55') && digitos.length >= 12 ? digitos : `55${digitos}`;
  const textoWhatsapp = `Olá, ${terceiro.nome}! Pelo link abaixo você vê o que está com você e pede novas remessas: ${link}`;
  const urlWhatsapp = `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoWhatsapp)}`;

  async function executar(acao: () => Promise<void>) {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
      aoAlterado();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function criar() {
    return executar(async () => {
      const r = await api.post<RespostaPortal>(`/terceiros/${terceiro.id}/portal`);
      setCodigo(r.codigoAcesso);
    });
  }

  async function gerarNovo() {
    setConfirmar(null);
    await executar(async () => {
      const r = await api.post<RespostaPortal>(`/terceiros/${terceiro.id}/portal/novo`);
      setCodigo(r.codigoAcesso);
    });
  }

  async function desligar() {
    setConfirmar(null);
    await executar(async () => {
      await api.del(`/terceiros/${terceiro.id}/portal`);
      setCodigo(null);
    });
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem acesso à área de transferência (ex.: http sem segurança): seleciona o link para copiar à mão.
      campoLink.current?.select();
      setErro('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  }

  return (
    <Modal aberto titulo={`Link do portal · ${terceiro.nome}`} aoFechar={aoFechar}>
      <p className="portal-link-texto">Quem tem o link vê o saldo em posse e pede remessas. Os pedidos chegam para aprovação.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {codigo === null ? (
        <div className="portal-link-botoes">
          <Botao aoClicar={criar} desabilitado={ocupado}>
            {ocupado ? 'Criando...' : 'Criar link do portal'}
          </Botao>
        </div>
      ) : (
        <>
          <div className="campo">
            <span className="campo-rotulo">Link</span>
            <span className="portal-link-linha">
              <input
                ref={campoLink}
                className="campo-controle"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Botao variante="secundario" aoClicar={copiar}>
                {copiado ? 'Copiado' : 'Copiar'}
              </Botao>
            </span>
          </div>

          <div className="portal-link-botoes">
            <Botao variante="secundario" aoClicar={() => window.open(link, '_blank', 'noopener')}>
              Abrir
            </Botao>
            <Botao
              variante="secundario"
              desabilitado={!digitos}
              aoClicar={() => window.open(urlWhatsapp, '_blank', 'noopener')}
            >
              Enviar por WhatsApp
            </Botao>
          </div>
          {!digitos && <p className="terceiros-texto-suave">Cadastre o telefone do terceiro para enviar pelo WhatsApp.</p>}

          {confirmar === null && (
            <div className="portal-link-botoes portal-link-rodape">
              <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => setConfirmar('novo')}>
                Gerar novo link
              </Botao>
              <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => setConfirmar('desligar')}>
                Desligar portal
              </Botao>
            </div>
          )}
          {confirmar === 'novo' && (
            <div className="portal-link-confirmacao">
              <Aviso tipo="info">O link antigo vai parar de funcionar. Gerar um novo link?</Aviso>
              <div className="portal-link-botoes">
                <Botao variante="secundario" aoClicar={() => setConfirmar(null)}>
                  Voltar
                </Botao>
                <Botao aoClicar={gerarNovo} desabilitado={ocupado}>
                  Gerar novo link
                </Botao>
              </div>
            </div>
          )}
          {confirmar === 'desligar' && (
            <div className="portal-link-confirmacao">
              <Aviso tipo="info">O link atual deixa de funcionar. Para usar o portal de novo, crie um novo link.</Aviso>
              <div className="portal-link-botoes">
                <Botao variante="secundario" aoClicar={() => setConfirmar(null)}>
                  Voltar
                </Botao>
                <Botao variante="perigo" aoClicar={desligar} desabilitado={ocupado}>
                  Desligar portal
                </Botao>
              </div>
            </div>
          )}
        </>
      )}

      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar}>
          Fechar
        </Botao>
      </div>
    </Modal>
  );
}
