import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { usePlataforma } from '../../lib/plataforma';
import { ROTULOS_FORMA_PAGAMENTO, hojeIso, lerNumero, mensagemErro } from '../../lib/mercado';
import { dataHora, escapar, imprimirHtml, moeda, ESTILO_BOBINA } from '../../lib/imprimir';
import { Abas, Aviso, Botao, Campo, Carregando, Cartao, Modal, Pagina, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { CaixaAtualDTO, CaixaHistoricoDTO, FechamentoCaixaDTO } from './tipos';

// Caixa da gaveta: abrir com o troco, sangria, suprimento e fechamento conferindo o dinheiro.
// O gestor vê também o histórico de caixas.

function centavos(valor: number): number {
  return Math.round(valor * 100);
}

// Texto da diferença: "Confere", "Sobra de R$ X" ou "Falta de R$ X".
function textoDiferenca(diferenca: number): string {
  const c = centavos(diferenca);
  if (c === 0) return 'Confere';
  if (c > 0) return `Sobra de ${formatarMoeda(c / 100)}`;
  return `Falta de ${formatarMoeda(-c / 100)}`;
}

function classeDiferenca(diferenca: number): string {
  const c = centavos(diferenca);
  if (c === 0) return 'pdv-caixa-dif-ok';
  return c > 0 ? 'pdv-caixa-dif-sobra' : 'pdv-caixa-dif-falta';
}

function SeloDiferenca({ diferenca }: { diferenca: number | null }) {
  if (diferenca === null) return <Selo cor="cinza">Sem fechamento</Selo>;
  const c = centavos(diferenca);
  if (c === 0) return <Selo cor="verde">Confere</Selo>;
  if (c > 0) return <Selo cor="amarelo">{`Sobra ${formatarMoeda(c / 100)}`}</Selo>;
  return <Selo cor="vermelho">{`Falta ${formatarMoeda(-c / 100)}`}</Selo>;
}

// Bobina com o resumo do fechamento (conferência do operador e do gestor).
function imprimirResumoCaixa(nomeEmpresa: string, f: FechamentoCaixaDTO) {
  const formas = Object.entries(f.porForma)
    .map(([forma, valor]) => `<p class="par"><span>${escapar(ROTULOS_FORMA_PAGAMENTO[forma] ?? forma)}</span><span>${moeda(valor)}</span></p>`)
    .join('');
  const movimentos = f.movimentos
    .map(
      (m) =>
        `<p class="par"><span>${m.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}${m.motivo ? ` - ${escapar(m.motivo)}` : ''}</span><span>${moeda(m.valor)}</span></p>`,
    )
    .join('');
  const corpo = `
    <h1>${escapar(nomeEmpresa)}</h1>
    <p class="centro">Resumo do caixa · ${escapar(f.terminal)}</p>
    <p class="centro">Abertura ${escapar(dataHora(f.abertoEm))}</p>
    <p class="centro">Fechamento ${escapar(dataHora(f.fechadoEm))}</p>
    <div class="linha"></div>
    <p class="par"><span>Troco inicial</span><span>${moeda(f.valorAbertura)}</span></p>
    <p class="par"><span>Vendas (${f.qtdVendas})</span><span>${moeda(f.totalVendas)}</span></p>
    <div class="linha"></div>
    ${formas}
    <div class="linha"></div>
    ${movimentos}
    <p class="par"><span>Sangrias</span><span>${moeda(f.sangrias)}</span></p>
    <p class="par"><span>Suprimentos</span><span>${moeda(f.suprimentos)}</span></p>
    <div class="linha"></div>
    <p class="par destaque"><span>Dinheiro esperado</span><span>${moeda(f.dinheiroEsperado)}</span></p>
    <p class="par"><span>Dinheiro contado</span><span>${moeda(f.valorInformado)}</span></p>
    <p class="par destaque"><span>Diferença</span><span>${escapar(textoDiferenca(f.diferenca))}</span></p>`;
  imprimirHtml('Resumo do caixa', corpo, ESTILO_BOBINA);
}

// Tela de caixa para o operador (e o histórico, para o gestor).
export function CaixaTela() {
  const { usuario } = useAuth();
  const ehGestor = usuario?.perfil === 'GESTOR';
  const [aba, setAba] = useState<'atual' | 'historico'>('atual');

  return (
    <Pagina titulo="Caixa">
      {ehGestor && (
        <Abas
          abas={[
            { id: 'atual', rotulo: 'Caixa' },
            { id: 'historico', rotulo: 'Histórico de caixas' },
          ]}
          ativa={aba}
          aoMudar={(id) => setAba(id as 'atual' | 'historico')}
        />
      )}
      {aba === 'atual' ? <CaixaAtual /> : <HistoricoCaixas />}
    </Pagina>
  );
}

function CaixaAtual() {
  const caixa = useDados<CaixaAtualDTO | null>('/caixas/atual');
  const { plataforma } = usePlataforma();
  const [abrindo, setAbrindo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [movimento, setMovimento] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null);
  const [valorMov, setValorMov] = useState('');
  const [motivoMov, setMotivoMov] = useState('');
  const [fechando, setFechando] = useState(false);
  const [contado, setContado] = useState('');
  const [fechamento, setFechamento] = useState<FechamentoCaixaDTO | null>(null);

  if (caixa.carregando && caixa.dados === null) return <Carregando />;
  if (caixa.erro) return <Aviso tipo="erro">{caixa.erro}</Aviso>;

  const atual = caixa.dados;

  // Sem caixa aberto: pede o troco inicial.
  async function abrir(e: FormEvent) {
    e.preventDefault();
    const n = lerNumero(abrindo);
    if (n === null || n < 0) {
      setErro('Informe o valor de abertura');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/caixas/abrir', { valorAbertura: n });
      setAbrindo('');
      caixa.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarMovimento() {
    if (!atual || !movimento) return;
    const n = lerNumero(valorMov);
    if (n === null || n <= 0) {
      setErro('Informe um valor maior que zero');
      return;
    }
    if (!motivoMov.trim()) {
      setErro('Informe o motivo');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const rota = movimento === 'SANGRIA' ? 'sangria' : 'suprimento';
      await api.post(`/caixas/${atual.id}/${rota}`, { valor: n, motivo: motivoMov.trim() });
      setMovimento(null);
      setValorMov('');
      setMotivoMov('');
      caixa.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarFechamento() {
    if (!atual) return;
    const n = lerNumero(contado);
    if (n === null || n < 0) {
      setErro('Informe o dinheiro contado');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<FechamentoCaixaDTO>(`/caixas/${atual.id}/fechar`, { valorInformado: n });
      setFechamento(r);
      setFechando(false);
      setContado('');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  function fecharResumo() {
    setFechamento(null);
    caixa.recarregar();
  }

  if (fechamento) {
    const dif = fechamento.diferenca;
    return (
      <Cartao titulo="Caixa fechado">
        <p className={`pdv-caixa-diferenca ${classeDiferenca(dif)}`}>{textoDiferenca(dif)}</p>
        <div className="pdv-caixa-linha">
          <span>Dinheiro esperado</span>
          <strong>{formatarMoeda(fechamento.dinheiroEsperado)}</strong>
        </div>
        <div className="pdv-caixa-linha">
          <span>Dinheiro contado</span>
          <strong>{formatarMoeda(fechamento.valorInformado)}</strong>
        </div>
        <div className="pdv-caixa-linha">
          <span>Vendas</span>
          <strong>{formatarMoeda(fechamento.totalVendas)}</strong>
        </div>
        <div className="pdv-caixa-acoes">
          <Botao variante="secundario" aoClicar={() => imprimirResumoCaixa(plataforma.nome, fechamento)}>
            Imprimir resumo
          </Botao>
          <Botao aoClicar={fecharResumo}>Concluir</Botao>
        </div>
      </Cartao>
    );
  }

  if (atual === null) {
    return (
      <Cartao titulo="Caixa fechado">
        <p className="pdv-caixa-texto">Abra o caixa informando o troco que está na gaveta.</p>
        <form onSubmit={abrir}>
          <Campo rotulo="Valor de abertura" valor={abrindo} aoMudar={setAbrindo} obrigatorio />
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="pdv-caixa-acoes">
            <Botao tipo="submit" desabilitado={enviando}>
              Abrir caixa
            </Botao>
          </div>
        </form>
      </Cartao>
    );
  }

  const dinheiroContado = lerNumero(contado);
  const difAoVivo = dinheiroContado === null ? null : arredDiferenca(dinheiroContado, atual.dinheiroEsperado);

  return (
    <>
      <Cartao titulo={`Caixa aberto · ${atual.terminal}`}>
        <div className="pdv-cartoes-caixa">
          <div className="pdv-caixa-linha">
            <span>Abertura</span>
            <strong>{formatarMoeda(atual.valorAbertura)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Vendas ({atual.qtdVendas})</span>
            <strong>{formatarMoeda(atual.totalVendas)}</strong>
          </div>
          <div className="pdv-caixa-linha">
            <span>Dinheiro esperado</span>
            <strong>{formatarMoeda(atual.dinheiroEsperado)}</strong>
          </div>
        </div>
        <div className="pdv-caixa-acoes">
          <Botao variante="secundario" aoClicar={() => { setErro(null); setMovimento('SANGRIA'); }}>
            Sangria
          </Botao>
          <Botao variante="secundario" aoClicar={() => { setErro(null); setMovimento('SUPRIMENTO'); }}>
            Suprimento
          </Botao>
          <Botao
            variante="perigo"
            aoClicar={() => {
              setErro(null);
              setFechando(true);
            }}
          >
            Fechar caixa
          </Botao>
        </div>
      </Cartao>

      <Cartao titulo="Por forma de pagamento">
        {Object.keys(atual.porForma).length === 0 ? (
          <p className="pdv-caixa-texto">Nenhuma venda neste caixa ainda.</p>
        ) : (
          Object.entries(atual.porForma).map(([forma, valor]) => (
            <div key={forma} className="pdv-caixa-linha">
              <span>{ROTULOS_FORMA_PAGAMENTO[forma] ?? forma}</span>
              <strong>{formatarMoeda(valor)}</strong>
            </div>
          ))
        )}
      </Cartao>

      <Cartao titulo="Sangrias e suprimentos">
        <div className="pdv-caixa-linha">
          <span>Sangrias</span>
          <strong>{formatarMoeda(atual.sangrias)}</strong>
        </div>
        <div className="pdv-caixa-linha">
          <span>Suprimentos</span>
          <strong>{formatarMoeda(atual.suprimentos)}</strong>
        </div>
        {atual.movimentos.length === 0 ? (
          <p className="pdv-caixa-texto">Nenhum movimento.</p>
        ) : (
          atual.movimentos.map((m) => (
            <div key={m.id} className="pdv-caixa-linha">
              <span>
                {m.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} · {formatarDataHora(m.criadoEm)}
                {m.motivo ? ` · ${m.motivo}` : ''}
              </span>
              <strong>{formatarMoeda(m.valor)}</strong>
            </div>
          ))
        )}
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Modal
        aberto={movimento !== null}
        titulo={movimento === 'SANGRIA' ? 'Sangria (retirada)' : 'Suprimento (entrada)'}
        aoFechar={() => setMovimento(null)}
      >
        <Campo rotulo="Valor" valor={valorMov} aoMudar={setValorMov} obrigatorio />
        <Campo rotulo="Motivo" valor={motivoMov} aoMudar={setMotivoMov} obrigatorio />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pdv-caixa-acoes">
          <Botao aoClicar={() => void confirmarMovimento()} desabilitado={enviando}>
            Confirmar
          </Botao>
        </div>
      </Modal>

      <Modal aberto={fechando} titulo="Fechar caixa" aoFechar={() => setFechando(false)}>
        <p className="pdv-caixa-texto">Conte o dinheiro da gaveta e informe o total.</p>
        <p className="pdv-caixa-texto">
          Dinheiro esperado: <strong>{formatarMoeda(atual.dinheiroEsperado)}</strong>
        </p>
        <Campo rotulo="Dinheiro contado" valor={contado} aoMudar={setContado} obrigatorio />
        <p className={`pdv-caixa-diferenca ${difAoVivo === null ? '' : classeDiferenca(difAoVivo)}`}>
          {difAoVivo === null ? 'Informe o valor contado' : textoDiferenca(difAoVivo)}
        </p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="pdv-caixa-acoes">
          <Botao variante="perigo" aoClicar={() => void confirmarFechamento()} desabilitado={enviando}>
            Fechar caixa
          </Botao>
        </div>
      </Modal>
    </>
  );
}

// Diferença em reais, já arredondada em centavos.
function arredDiferenca(contado: number, esperado: number): number {
  return Math.round((contado - esperado) * 100) / 100;
}

function HistoricoCaixas() {
  const [inicio, setInicio] = useState(hojeIso(-29));
  const [fim, setFim] = useState(hojeIso(0));
  const caminho = `/caixas?inicio=${inicio}&fim=${fim}`;
  const historico = useDados<CaixaHistoricoDTO[]>(caminho);

  return (
    <>
      <div className="pdv-filtros">
        <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
        <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
      </div>
      {historico.carregando && historico.dados === null && <Carregando />}
      {historico.erro && <Aviso tipo="erro">{historico.erro}</Aviso>}
      {historico.dados && (
        <Tabela
          colunas={[
            { titulo: 'Abertura', celula: (c: CaixaHistoricoDTO) => formatarDataHora(c.abertoEm) },
            { titulo: 'Operador', celula: (c: CaixaHistoricoDTO) => c.operador },
            { titulo: 'Terminal', celula: (c: CaixaHistoricoDTO) => c.terminal },
            {
              titulo: 'Situação',
              celula: (c: CaixaHistoricoDTO) =>
                c.status === 'ABERTO' ? <Selo cor="azul">Aberto</Selo> : <Selo cor="cinza">Fechado</Selo>,
            },
            {
              titulo: 'Vendas',
              alinhar: 'direita',
              celula: (c: CaixaHistoricoDTO) => formatarMoeda(c.totalVendas),
            },
            {
              titulo: 'Contado',
              alinhar: 'direita',
              celula: (c: CaixaHistoricoDTO) => (c.valorInformado === null ? '—' : formatarMoeda(c.valorInformado)),
            },
            { titulo: 'Diferença', celula: (c: CaixaHistoricoDTO) => <SeloDiferenca diferenca={c.diferenca} /> },
          ]}
          dados={historico.dados}
          chave={(c) => c.id}
          vazio="Nenhum caixa neste período."
        />
      )}
    </>
  );
}
