import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Abas, AreaTexto, Aviso, Botao, Caixa, Campo, Carregando, Selecao, Selo, Tabela, formatarData, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import { BuscaProduto } from './PedidosCompra';
import { ROTULO_STATUS_PEDIDO } from './tipos';
import type { FornecedorDetalhe, ProdutoBuscaDTO } from './tipos';

// Estrelas de avaliação (0 a 5), arredondando para a estrela cheia mais próxima.
export function Estrelas({ valor }: { valor: number }) {
  const cheias = Math.round(valor);
  return (
    <span className="compras-estrelas" aria-label={`Avaliação ${valor.toFixed(1)} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= cheias ? 'compras-estrela compras-estrela-cheia' : 'compras-estrela'}>
          <Icone nome="estrela" tamanho={16} />
        </span>
      ))}
    </span>
  );
}

type Aba = 'dados' | 'produtos' | 'pedidos' | 'avaliacoes';

interface FormFornecedor {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  telefone: string;
  whatsapp: string;
  email: string;
  contato: string;
  endereco: string;
  cidade: string;
  uf: string;
  prazoEntregaDias: string;
  condicaoPagamento: string;
  pedidoMinimo: string;
  diasVisita: string;
  observacoes: string;
  ativo: boolean;
}

const FORM_VAZIO: FormFornecedor = {
  nome: '',
  razaoSocial: '',
  cnpj: '',
  inscricaoEstadual: '',
  telefone: '',
  whatsapp: '',
  email: '',
  contato: '',
  endereco: '',
  cidade: '',
  uf: '',
  prazoEntregaDias: '3',
  condicaoPagamento: '',
  pedidoMinimo: '0',
  diasVisita: '',
  observacoes: '',
  ativo: true,
};

function numeroParaTexto(n: number): string {
  return String(n).replace('.', ',');
}

function paraForm(f: FornecedorDetalhe): FormFornecedor {
  return {
    nome: f.nome,
    razaoSocial: f.razaoSocial ?? '',
    cnpj: f.cnpj ?? '',
    inscricaoEstadual: f.inscricaoEstadual ?? '',
    telefone: f.telefone ?? '',
    whatsapp: f.whatsapp ?? '',
    email: f.email ?? '',
    contato: f.contato ?? '',
    endereco: f.endereco ?? '',
    cidade: f.cidade ?? '',
    uf: f.uf ?? '',
    prazoEntregaDias: String(f.prazoEntregaDias),
    condicaoPagamento: f.condicaoPagamento ?? '',
    pedidoMinimo: numeroParaTexto(f.pedidoMinimo),
    diasVisita: f.diasVisita ?? '',
    observacoes: f.observacoes ?? '',
    ativo: f.ativo,
  };
}

// Texto vazio vira null (o servidor guarda null).
function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'dados', rotulo: 'Dados' },
  { id: 'produtos', rotulo: 'Produtos' },
  { id: 'pedidos', rotulo: 'Pedidos' },
  { id: 'avaliacoes', rotulo: 'Avaliações' },
];

const NOTAS = ['1', '2', '3', '4', '5'];

// Ficha do fornecedor (dentro de um Modal). id = null cria um fornecedor novo.
export function FichaFornecedor({ id, aoSalvar }: { id: number | null; aoSalvar: (id: number) => void }) {
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/comprador';
  const navegar = useNavigate();
  const [aba, setAba] = useState<Aba>('dados');
  const { dados: detalhe, carregando, erro: erroCarga, recarregar } = useDados<FornecedorDetalhe>(
    id !== null ? `/fornecedores/${id}` : null,
  );
  const [form, setForm] = useState<FormFornecedor>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Produtos vinculados
  const [produtoNovo, setProdutoNovo] = useState<ProdutoBuscaDTO | null>(null);
  const [vinculo, setVinculo] = useState({ codigo: '', preco: '', fator: '1' });

  // Avaliação nova
  const [avaliacao, setAvaliacao] = useState({ pontualidade: '5', qualidade: '5', atendimento: '5', comentario: '' });

  useEffect(() => {
    if (detalhe) setForm(paraForm(detalhe));
  }, [detalhe]);

  function atualizar<K extends keyof FormFornecedor>(campo: K, valor: FormFornecedor[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function salvarDados(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    if (!form.nome.trim()) {
      setErro('Informe o nome do fornecedor.');
      return;
    }
    const prazo = lerNumero(form.prazoEntregaDias);
    if (prazo === null || !Number.isInteger(prazo) || prazo < 0) {
      setErro('O prazo de entrega deve ser um número inteiro de dias.');
      return;
    }
    const minimo = lerNumero(form.pedidoMinimo);
    if (minimo === null || minimo < 0) {
      setErro('O pedido mínimo deve ser um valor em reais.');
      return;
    }
    const corpo = {
      nome: form.nome.trim(),
      razaoSocial: textoOuNulo(form.razaoSocial),
      cnpj: textoOuNulo(form.cnpj),
      inscricaoEstadual: textoOuNulo(form.inscricaoEstadual),
      telefone: textoOuNulo(form.telefone),
      whatsapp: textoOuNulo(form.whatsapp),
      email: textoOuNulo(form.email),
      contato: textoOuNulo(form.contato),
      endereco: textoOuNulo(form.endereco),
      cidade: textoOuNulo(form.cidade),
      uf: textoOuNulo(form.uf),
      prazoEntregaDias: prazo,
      condicaoPagamento: textoOuNulo(form.condicaoPagamento),
      pedidoMinimo: minimo,
      diasVisita: textoOuNulo(form.diasVisita),
      observacoes: textoOuNulo(form.observacoes),
      ativo: form.ativo,
    };
    setSalvando(true);
    try {
      const salvo =
        id === null
          ? await api.post<FornecedorDetalhe>('/fornecedores', corpo)
          : await api.put<FornecedorDetalhe>(`/fornecedores/${id}`, corpo);
      setSucesso('Dados salvos.');
      recarregar();
      aoSalvar(salvo.id);
    } catch (falha) {
      setErro(mensagemErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function vincularProduto() {
    if (id === null || !produtoNovo) return;
    setErro(null);
    setSucesso(null);
    const preco = vinculo.preco.trim() ? lerNumero(vinculo.preco) : null;
    if (vinculo.preco.trim() && (preco === null || preco < 0)) {
      setErro('Preço do fornecedor inválido.');
      return;
    }
    const fator = lerNumero(vinculo.fator) ?? 1;
    if (fator <= 0) {
      setErro('O fator de conversão deve ser maior que zero.');
      return;
    }
    try {
      await api.post(`/fornecedores/${id}/produtos`, {
        produtoId: produtoNovo.id,
        codigoFornecedor: textoOuNulo(vinculo.codigo),
        ultimoPreco: preco,
        fatorConversao: fator,
      });
      setProdutoNovo(null);
      setVinculo({ codigo: '', preco: '', fator: '1' });
      setSucesso('Produto vinculado.');
      recarregar();
    } catch (falha) {
      setErro(mensagemErro(falha));
    }
  }

  async function desvincularProduto(produtoId: number) {
    if (id === null) return;
    if (!window.confirm('Remover este produto da lista do fornecedor?')) return;
    setErro(null);
    try {
      await api.del(`/fornecedores/${id}/produtos/${produtoId}`);
      recarregar();
    } catch (falha) {
      setErro(mensagemErro(falha));
    }
  }

  async function registrarAvaliacao() {
    if (id === null) return;
    setErro(null);
    setSucesso(null);
    try {
      await api.post(`/fornecedores/${id}/avaliacoes`, {
        pontualidade: Number(avaliacao.pontualidade),
        qualidade: Number(avaliacao.qualidade),
        atendimento: Number(avaliacao.atendimento),
        comentario: textoOuNulo(avaliacao.comentario),
      });
      setAvaliacao({ pontualidade: '5', qualidade: '5', atendimento: '5', comentario: '' });
      setSucesso('Avaliação registrada.');
      recarregar();
    } catch (falha) {
      setErro(mensagemErro(falha));
    }
  }

  if (id !== null && carregando && !detalhe) return <Carregando />;
  if (erroCarga) return <Aviso tipo="erro">{erroCarga}</Aviso>;

  const semCadastro = id === null;

  return (
    <div>
      {detalhe && (
        <div className="compras-acumulado">
          <span>
            Avaliação: <Estrelas valor={detalhe.avaliacao} />
          </span>
          <span>
            Comprado (12 meses): <strong>{formatarMoeda(detalhe.totalComprado12m)}</strong>
          </span>
          <span>
            Pedidos abertos: <strong>{detalhe.pedidosAbertos}</strong>
          </span>
        </div>
      )}

      <div className="compras-ficha-abas">
        <Abas abas={ABAS} ativa={aba} aoMudar={(v) => setAba(v as Aba)} />
      </div>

      {aba === 'dados' && (
        <form noValidate onSubmit={salvarDados}>
          <div className="compras-grade-campos">
            <Campo rotulo="Nome (fantasia)" valor={form.nome} aoMudar={(v) => atualizar('nome', v)} obrigatorio />
            <Campo rotulo="Razão social" valor={form.razaoSocial} aoMudar={(v) => atualizar('razaoSocial', v)} />
            <Campo rotulo="CNPJ" valor={form.cnpj} aoMudar={(v) => atualizar('cnpj', v)} />
            <Campo rotulo="Inscrição estadual" valor={form.inscricaoEstadual} aoMudar={(v) => atualizar('inscricaoEstadual', v)} />
            <Campo rotulo="Telefone" valor={form.telefone} aoMudar={(v) => atualizar('telefone', v)} />
            <Campo rotulo="WhatsApp" valor={form.whatsapp} aoMudar={(v) => atualizar('whatsapp', v)} />
            <Campo rotulo="E-mail" tipo="email" valor={form.email} aoMudar={(v) => atualizar('email', v)} />
            <Campo rotulo="Representante" valor={form.contato} aoMudar={(v) => atualizar('contato', v)} />
            <Campo rotulo="Endereço" valor={form.endereco} aoMudar={(v) => atualizar('endereco', v)} />
            <Campo rotulo="Cidade" valor={form.cidade} aoMudar={(v) => atualizar('cidade', v)} />
            <Campo rotulo="UF" valor={form.uf} aoMudar={(v) => atualizar('uf', v)} />
            <Campo rotulo="Prazo de entrega (dias)" tipo="number" valor={form.prazoEntregaDias} aoMudar={(v) => atualizar('prazoEntregaDias', v)} obrigatorio />
            <Campo rotulo="Condição de pagamento" valor={form.condicaoPagamento} aoMudar={(v) => atualizar('condicaoPagamento', v)} />
            <Campo rotulo="Pedido mínimo (R$)" tipo="number" valor={form.pedidoMinimo} aoMudar={(v) => atualizar('pedidoMinimo', v)} />
            <Campo rotulo="Dias de visita" valor={form.diasVisita} aoMudar={(v) => atualizar('diasVisita', v)} />
          </div>
          <div className="compras-secao">
            <AreaTexto rotulo="Observações" valor={form.observacoes} aoMudar={(v) => atualizar('observacoes', v)} linhas={3} />
            <Caixa rotulo="Fornecedor ativo" marcado={form.ativo} aoMudar={(v) => atualizar('ativo', v)} />
          </div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
          <div className="compras-linha-acoes compras-secao">
            <Botao tipo="submit" desabilitado={salvando}>
              {salvando ? 'Salvando...' : 'Salvar dados'}
            </Botao>
          </div>
        </form>
      )}

      {aba !== 'dados' && semCadastro && (
        <p className="compras-vazio">Salve os dados do fornecedor para usar esta aba.</p>
      )}

      {aba === 'produtos' && !semCadastro && (
        <div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
          {!detalhe ? (
            <Carregando />
          ) : (
            <div className="compras-rolagem">
              <Tabela
                colunas={[
                  {
                    titulo: 'Produto',
                    celula: (v) => (
                      <>
                        {v.nome}
                        <span className="compras-sub">{v.codigo}</span>
                      </>
                    ),
                  },
                  { titulo: 'Código no fornecedor', celula: (v) => v.codigoFornecedor ?? '—' },
                  {
                    titulo: 'Último preço',
                    alinhar: 'direita',
                    celula: (v) => (v.ultimoPreco === null ? '—' : formatarMoeda(v.ultimoPreco)),
                  },
                  { titulo: 'Fator', alinhar: 'direita', celula: (v) => `× ${v.fatorConversao}` },
                  {
                    titulo: 'Ações',
                    acoes: true,
                    celula: (v) => (
                      <Botao variante="texto" aoClicar={() => void desvincularProduto(v.produtoId)}>
                        Remover
                      </Botao>
                    ),
                  },
                ]}
                dados={detalhe.produtos}
                chave={(v) => v.produtoId}
                vazio="Nenhum produto vinculado. Vincule os produtos que este fornecedor vende."
              />
            </div>
          )}

          <div className="compras-secao">
            <h3 className="compras-secao-titulo">Vincular produto</h3>
            {!produtoNovo ? (
              <BuscaProduto aoEscolher={(p) => setProdutoNovo(p)} />
            ) : (
              <div className="compras-busca">
                <p className="compras-ajuda">
                  Produto: <strong>{produtoNovo.nome}</strong>{' '}
                  <Botao variante="texto" aoClicar={() => setProdutoNovo(null)}>
                    Trocar
                  </Botao>
                </p>
                <div className="compras-grade-campos">
                  <Campo rotulo="Código no fornecedor" valor={vinculo.codigo} aoMudar={(v) => setVinculo((x) => ({ ...x, codigo: v }))} />
                  <Campo rotulo="Último preço (R$)" tipo="number" valor={vinculo.preco} aoMudar={(v) => setVinculo((x) => ({ ...x, preco: v }))} />
                  <Campo rotulo="Fator de conversão" tipo="number" valor={vinculo.fator} aoMudar={(v) => setVinculo((x) => ({ ...x, fator: v }))} />
                </div>
                <p className="compras-ajuda">
                  Fator: quantas unidades do produto vêm em cada unidade da nota (ex.: caixa com 12 = 12).
                </p>
                <div className="compras-linha-acoes">
                  <Botao aoClicar={() => void vincularProduto()}>Vincular produto</Botao>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {aba === 'pedidos' && !semCadastro && (
        <div>
          {!detalhe ? (
            <Carregando />
          ) : (
            <div className="compras-rolagem">
              <Tabela
                colunas={[
                  { titulo: 'Pedido', celula: (p) => `#${p.numero}` },
                  {
                    titulo: 'Status',
                    celula: (p) => (
                      <Selo cor={ROTULO_STATUS_PEDIDO[p.status].cor}>{ROTULO_STATUS_PEDIDO[p.status].rotulo}</Selo>
                    ),
                  },
                  { titulo: 'Total', alinhar: 'direita', celula: (p) => formatarMoeda(p.total) },
                  { titulo: 'Criado em', celula: (p) => formatarData(p.criadoEm) },
                ]}
                dados={detalhe.pedidos}
                chave={(p) => p.id}
                vazio="Nenhum pedido para este fornecedor."
                aoClicarLinha={(p) => navegar(`${raiz}/pedidos-compra/${p.id}`)}
              />
            </div>
          )}
        </div>
      )}

      {aba === 'avaliacoes' && !semCadastro && (
        <div>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
          {!detalhe ? (
            <Carregando />
          ) : (
            <Tabela
              colunas={[
                { titulo: 'Data', celula: (a) => formatarData(a.criadoEm) },
                { titulo: 'Pontualidade', alinhar: 'centro', celula: (a) => `${a.pontualidade}/5` },
                { titulo: 'Qualidade', alinhar: 'centro', celula: (a) => `${a.qualidade}/5` },
                { titulo: 'Atendimento', alinhar: 'centro', celula: (a) => `${a.atendimento}/5` },
                { titulo: 'Média', alinhar: 'direita', celula: (a) => <Estrelas valor={a.media} /> },
                { titulo: 'Comentário', celula: (a) => a.comentario ?? '—' },
              ]}
              dados={detalhe.avaliacoes}
              chave={(a) => a.id}
              vazio="Este fornecedor ainda não foi avaliado."
            />
          )}

          <div className="compras-secao">
            <h3 className="compras-secao-titulo">Nova avaliação</h3>
            <div className="compras-grade-campos">
              <Selecao rotulo="Pontualidade" valor={avaliacao.pontualidade} aoMudar={(v) => setAvaliacao((x) => ({ ...x, pontualidade: v }))} opcoes={NOTAS.map((n) => ({ valor: n, rotulo: `${n} de 5` }))} vazio="Escolha" />
              <Selecao rotulo="Qualidade" valor={avaliacao.qualidade} aoMudar={(v) => setAvaliacao((x) => ({ ...x, qualidade: v }))} opcoes={NOTAS.map((n) => ({ valor: n, rotulo: `${n} de 5` }))} vazio="Escolha" />
              <Selecao rotulo="Atendimento" valor={avaliacao.atendimento} aoMudar={(v) => setAvaliacao((x) => ({ ...x, atendimento: v }))} opcoes={NOTAS.map((n) => ({ valor: n, rotulo: `${n} de 5` }))} vazio="Escolha" />
            </div>
            <AreaTexto rotulo="Comentário" valor={avaliacao.comentario} aoMudar={(v) => setAvaliacao((x) => ({ ...x, comentario: v }))} linhas={2} />
            <div className="compras-linha-acoes">
              <Botao
                aoClicar={() => void registrarAvaliacao()}
                desabilitado={!avaliacao.pontualidade || !avaliacao.qualidade || !avaliacao.atendimento}
              >
                Registrar avaliação
              </Botao>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
