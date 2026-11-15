import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dataHora, escapar, imprimirHtml, moeda } from '../../lib/imprimir';
import { usePlataforma } from '../../lib/plataforma';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Caixa, Campo, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela, formatarData, formatarDataHora, formatarMoeda } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { CelulaProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import {
  COR_STATUS,
  COR_TIPO,
  ROTULOS_MOTIVO_BAIXA,
  ROTULOS_STATUS,
  ROTULOS_TIPO,
  podeEscrever,
  textoNumero,
  textoPorUnidade,
} from './tipos';
import type { ItemRemessa, MotivoBaixa, RemessaDetalhe } from './tipos';
import './terceiros.css';

type Janela = 'retorno' | 'baixa' | 'cancelar' | null;

const OPCOES_MOTIVO = (Object.keys(ROTULOS_MOTIVO_BAIXA) as MotivoBaixa[]).map((m) => ({ valor: m, rotulo: ROTULOS_MOTIVO_BAIXA[m] }));

// CSS do termo de remessa em folha A4 (o padrão de impressão do sistema é a bobina de 80 mm).
const ESTILO_TERMO = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 16px 0 6px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 2px; }
  p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #000; padding: 5px 6px; text-align: left; }
  th { background: #eee; }
  .direita { text-align: right; }
  .cabecalho { display: flex; justify-content: space-between; gap: 16px; }
  .assinaturas { display: flex; gap: 40px; margin-top: 64px; }
  .assinatura { flex: 1; border-top: 1px solid #000; padding-top: 4px; text-align: center; }
`;

// Termo de remessa: dados da empresa, do terceiro, itens e assinaturas.
function termoHtml(d: RemessaDetalhe, empresa: string): string {
  const valorTotal = d.itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0);
  const linhas = d.itens
    .map(
      (i) =>
        `<tr><td>${escapar(i.produto)}</td><td>${escapar(i.codigo)}</td>` +
        `<td class="direita">${escapar(formatarQuantidade(i.quantidade, i.unidade))}</td>` +
        `<td class="direita">${escapar(moeda(i.custoUnitario))}</td></tr>`,
    )
    .join('');
  return (
    `<div class="cabecalho"><div><h1>${escapar(empresa)}</h1><p>Loja de origem: ${escapar(d.loja)}</p></div>` +
    `<div class="direita"><p><strong>Termo de remessa nº ${d.numero}</strong></p>` +
    `<p>Emitido em ${escapar(dataHora(new Date()))}</p></div></div>` +
    `<h2>Terceiro</h2>` +
    `<p><strong>${escapar(d.terceiro)}</strong>${d.terceiroDocumento ? ` · ${escapar(d.terceiroDocumento)}` : ''}</p>` +
    `<p>Tipo: ${escapar(ROTULOS_TIPO[d.tipo])} · Documento: ${escapar(d.documento || '—')} · ` +
    `Previsão de retorno: ${escapar(d.previsaoRetorno ? formatarData(d.previsaoRetorno) : 'sem previsão')}</p>` +
    `<h2>Itens</h2>` +
    `<table><thead><tr><th>Produto</th><th>Código</th><th class="direita">Quantidade</th>` +
    `<th class="direita">Valor unitário (custo)</th></tr></thead><tbody>${linhas}</tbody></table>` +
    `<p class="direita"><strong>Valor total (custo): ${escapar(moeda(valorTotal))}</strong></p>` +
    `<div class="assinaturas"><div class="assinatura">${escapar(empresa)}</div>` +
    `<div class="assinatura">${escapar(d.terceiro)}</div></div>`
  );
}

// Detalhe de uma remessa: cabeçalho, totais, itens e ações (retorno, baixa, cancelamento, termo).
export function DetalheRemessa() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const { plataforma } = usePlataforma();
  const [params, setParams] = useSearchParams();
  const escreve = podeEscrever(usuario?.perfil);
  const remessa = useDados<RemessaDetalhe>(id ? `/remessas-terceiro/${id}` : null);
  const [janela, setJanela] = useState<Janela>(null);
  const d = remessa.dados;

  // Atalho vindo da lista (?acao=retorno, baixa ou cancelar): abre a janela certa uma vez.
  useEffect(() => {
    const acao = params.get('acao');
    if (!d || !acao) return;
    if ((acao === 'retorno' || acao === 'baixa') && escreve && (d.status === 'ABERTA' || d.status === 'PARCIAL')) {
      setJanela(acao);
    }
    if (acao === 'cancelar' && escreve && d.status === 'ABERTA') setJanela('cancelar');
    setParams({}, { replace: true });
  }, [d, params, escreve, setParams]);

  const aberta = d ? d.status === 'ABERTA' || d.status === 'PARCIAL' : false;
  const acoesCancelar: AcaoMenu[] = [{ rotulo: 'Cancelar remessa', perigo: true, aoClicar: () => setJanela('cancelar') }];

  function imprimir() {
    if (!d) return;
    imprimirHtml(`Termo de remessa nº ${d.numero}`, termoHtml(d, plataforma.nome), ESTILO_TERMO);
  }

  const colunas: ColunaTabela<ItemRemessa>[] = [
    {
      titulo: 'Produto',
      celula: (i) => <CelulaProduto foto={i.foto} nome={i.produto} setor={i.categoria} detalhe={i.codigo} />,
    },
    { titulo: 'Enviado', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.quantidade, i.unidade)}</span> },
    { titulo: 'Retornado', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.retornada, i.unidade)}</span> },
    { titulo: 'Baixado', alinhar: 'direita', celula: (i) => <span className="numero">{formatarQuantidade(i.baixada, i.unidade)}</span> },
    {
      titulo: 'Pendente',
      alinhar: 'direita',
      celula: (i) => <span className="numero terceiros-pendente">{formatarQuantidade(i.pendente, i.unidade)}</span>,
    },
  ];

  return (
    <Pagina
      titulo={d ? `Remessa nº ${d.numero}` : 'Remessa'}
      acoes={
        d && (
          <span className="terceiros-acoes-topo">
            <Botao variante="secundario" aoClicar={imprimir}>
              Imprimir termo
            </Botao>
            {escreve && aberta && (
              <Botao variante="secundario" aoClicar={() => setJanela('baixa')}>
                Registrar baixa
              </Botao>
            )}
            {escreve && aberta && <Botao aoClicar={() => setJanela('retorno')}>Registrar retorno</Botao>}
            {escreve && d.status === 'ABERTA' && (
              // Menu com a única ação destrutiva: cancelar (pede confirmação numa janela própria).
              <MenuAcoes rotulo="Mais ações da remessa" acoes={acoesCancelar} />
            )}
          </span>
        )
      }
    >
      {remessa.carregando && !d && <Carregando />}
      {remessa.erro && <Aviso tipo="erro">{remessa.erro}</Aviso>}

      {d && (
        <>
          <Cartao>
            <div className="terceiros-info">
              <div>
                <span>Terceiro</span>
                <strong>{d.terceiro}</strong>
                {d.terceiroDocumento && <span className="terceiros-detalhe">{d.terceiroDocumento}</span>}
              </div>
              <div>
                <span>Tipo</span>
                <span>
                  <Selo cor={COR_TIPO[d.tipo]}>{ROTULOS_TIPO[d.tipo]}</Selo>
                </span>
              </div>
              <div>
                <span>Status</span>
                <span className="terceiros-acoes-topo">
                  <Selo cor={COR_STATUS[d.status]}>{ROTULOS_STATUS[d.status]}</Selo>
                  {d.atrasada && <Selo cor="vermelho">Atrasada</Selo>}
                </span>
              </div>
              <div>
                <span>Documento</span>
                <strong>{d.documento || '—'}</strong>
              </div>
              <div>
                <span>Previsão de retorno</span>
                <strong>{d.previsaoRetorno ? formatarData(d.previsaoRetorno) : 'Sem previsão'}</strong>
              </div>
              <div>
                <span>Loja de origem</span>
                <strong>{d.loja}</strong>
              </div>
              <div>
                <span>Criada em</span>
                <strong>{formatarDataHora(d.criadoEm)}</strong>
              </div>
              {d.observacoes && (
                <div className="terceiros-info-larga">
                  <span>Observações</span>
                  <p>{d.observacoes}</p>
                </div>
              )}
            </div>
          </Cartao>

          <div className="resumo">
            {[
              { rotulo: 'Enviado', valor: textoPorUnidade(d.itens, 'quantidade'), icone: 'pacote', cor: 'azul' },
              { rotulo: 'Retornado', valor: textoPorUnidade(d.itens, 'retornada'), icone: 'caminhao', cor: 'verde' },
              { rotulo: 'Baixado', valor: textoPorUnidade(d.itens, 'baixada'), icone: 'visto', cor: 'roxo' },
              {
                rotulo: `Pendente · ${formatarMoeda(d.totais.valorPendente)}`,
                valor: textoPorUnidade(d.itens, 'pendente'),
                icone: 'validade',
                cor: 'laranja',
              },
            ].map((item) => (
              <div className="resumo-item" key={item.rotulo}>
                <span className={`resumo-icone resumo-icone-${item.cor}`}>
                  <Icone nome={item.icone as NomeIcone} tamanho={24} />
                </span>
                <div>
                  <span className="resumo-valor">{item.valor}</span>
                  <span className="resumo-rotulo">{item.rotulo}</span>
                </div>
              </div>
            ))}
          </div>

          <Tabela colunas={colunas} dados={d.itens} chave={(i) => i.id} vazio="Nenhum item nesta remessa." idVisao="terceiros-remessa-itens" />
        </>
      )}

      {janela === 'retorno' && d && (
        <ModalRetorno remessa={d} aoFechar={() => setJanela(null)} aoSalvo={() => { setJanela(null); remessa.recarregar(); }} />
      )}
      {janela === 'baixa' && d && (
        <ModalBaixa remessa={d} aoFechar={() => setJanela(null)} aoSalvo={() => { setJanela(null); remessa.recarregar(); }} />
      )}
      {janela === 'cancelar' && d && (
        <ModalCancelar remessa={d} aoFechar={() => setJanela(null)} aoSalvo={() => { setJanela(null); remessa.recarregar(); }} />
      )}
    </Pagina>
  );
}

// Retorno: quanto voltou de cada item. Vem preenchido com o que falta devolver.
function ModalRetorno({ remessa, aoFechar, aoSalvo }: { remessa: RemessaDetalhe; aoFechar: () => void; aoSalvo: () => void }) {
  const pendentes = remessa.itens.filter((i) => i.pendente > 0);
  const [quantidades, setQuantidades] = useState<Record<number, string>>(() => {
    const inicial: Record<number, string> = {};
    for (const i of pendentes) inicial[i.id] = textoNumero(i.pendente);
    return inicial;
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const itens: { itemId: number; quantidade: number }[] = [];
    for (const i of pendentes) {
      const texto = (quantidades[i.id] ?? '').trim();
      const qtd = texto ? lerNumero(texto) : 0;
      if (qtd === null || qtd < 0) return setErro(`Quantidade inválida em ${i.produto}.`);
      if (qtd > i.pendente) return setErro(`${i.produto}: o máximo é ${formatarQuantidade(i.pendente, i.unidade)}.`);
      if (qtd > 0) itens.push({ itemId: i.id, quantidade: qtd });
    }
    if (itens.length === 0) return setErro('Informe a quantidade que voltou de ao menos um item.');

    setOcupado(true);
    try {
      await api.post(`/remessas-terceiro/${remessa.id}/retorno`, { itens });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo="Registrar retorno" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {pendentes.length === 0 ? (
        <p className="terceiros-texto-suave">Nada pendente nesta remessa.</p>
      ) : (
        <>
          <p className="terceiros-texto-suave">Quanto voltou para {remessa.loja}. Vem preenchido com o que falta devolver.</p>
          <div className="terceiros-lista-itens">
            {pendentes.map((i) => (
              <div className="terceiros-item-linha" key={i.id}>
                <CelulaProduto foto={i.foto} nome={i.produto} setor={i.categoria} detalhe={`Pendente: ${formatarQuantidade(i.pendente, i.unidade)}`} />
                <Campo
                  rotulo={`Voltou (${i.unidade.toLowerCase()})`}
                  valor={quantidades[i.id] ?? ''}
                  aoMudar={(v) => setQuantidades((q) => ({ ...q, [i.id]: v }))}
                />
              </div>
            ))}
          </div>
        </>
      )}
      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        {pendentes.length > 0 && (
          <Botao aoClicar={salvar} desabilitado={ocupado}>
            {ocupado ? 'Salvando...' : 'Registrar retorno'}
          </Botao>
        )}
      </div>
    </Modal>
  );
}

// Baixa: vendido, consumido ou perdido no terceiro. Pode gerar a cobrança (receita) dos itens baixados.
function ModalBaixa({ remessa, aoFechar, aoSalvo }: { remessa: RemessaDetalhe; aoFechar: () => void; aoSalvo: () => void }) {
  const pendentes = remessa.itens.filter((i) => i.pendente > 0);
  const [quantidades, setQuantidades] = useState<Record<number, string>>(() => {
    const inicial: Record<number, string> = {};
    for (const i of pendentes) inicial[i.id] = textoNumero(i.pendente);
    return inicial;
  });
  const [motivo, setMotivo] = useState<MotivoBaixa>('VENDIDO');
  const [gerarCobranca, setGerarCobranca] = useState(remessa.tipo === 'CONSIGNACAO');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estimativa da cobrança com o que está digitado (a conta final é do servidor).
  const estimativa = pendentes.reduce((soma, i) => {
    const qtd = lerNumero(quantidades[i.id] ?? '') ?? 0;
    return soma + (i.precoCobranca !== null && qtd > 0 ? qtd * i.precoCobranca : 0);
  }, 0);

  async function salvar() {
    setErro(null);
    const itens: { itemId: number; quantidade: number }[] = [];
    for (const i of pendentes) {
      const texto = (quantidades[i.id] ?? '').trim();
      const qtd = texto ? lerNumero(texto) : 0;
      if (qtd === null || qtd < 0) return setErro(`Quantidade inválida em ${i.produto}.`);
      if (qtd > i.pendente) return setErro(`${i.produto}: o máximo é ${formatarQuantidade(i.pendente, i.unidade)}.`);
      if (qtd > 0) itens.push({ itemId: i.id, quantidade: qtd });
    }
    if (itens.length === 0) return setErro('Informe a quantidade baixada de ao menos um item.');

    setOcupado(true);
    try {
      await api.post(`/remessas-terceiro/${remessa.id}/baixa`, { itens, motivo, gerarCobranca });
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo="Registrar baixa" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {pendentes.length === 0 ? (
        <p className="terceiros-texto-suave">Nada pendente nesta remessa.</p>
      ) : (
        <>
          <p className="terceiros-texto-suave">
            Quanto foi vendido, consumido ou perdido no terceiro. Vem preenchido com o que falta. A baixa não mexe no estoque próprio.
          </p>
          <Selecao rotulo="Motivo" valor={motivo} aoMudar={(v) => setMotivo(v as MotivoBaixa)} opcoes={OPCOES_MOTIVO} obrigatorio />
          <div className="terceiros-lista-itens">
            {pendentes.map((i) => (
              <div className="terceiros-item-linha" key={i.id}>
                <CelulaProduto
                  foto={i.foto}
                  nome={i.produto}
                  setor={i.categoria}
                  detalhe={i.precoCobranca !== null ? `Cobrança ${moeda(i.precoCobranca)} por ${i.unidade.toLowerCase()}` : 'Sem preço de cobrança'}
                />
                <Campo
                  rotulo={`Baixado (${i.unidade.toLowerCase()})`}
                  valor={quantidades[i.id] ?? ''}
                  aoMudar={(v) => setQuantidades((q) => ({ ...q, [i.id]: v }))}
                />
              </div>
            ))}
          </div>
          <div className="terceiros-acoes-topo">
            <Caixa rotulo="Gerar cobrança dos itens baixados" marcado={gerarCobranca} aoMudar={setGerarCobranca} />
          </div>
          {gerarCobranca && (
            <p className="terceiros-texto-suave">
              Cobrança estimada: {moeda(estimativa)}. Vira uma receita com vencimento em 7 dias.
            </p>
          )}
        </>
      )}
      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Cancelar
        </Botao>
        {pendentes.length > 0 && (
          <Botao aoClicar={salvar} desabilitado={ocupado}>
            {ocupado ? 'Salvando...' : 'Registrar baixa'}
          </Botao>
        )}
      </div>
    </Modal>
  );
}

// Cancelamento: só remessa sem retorno nem baixa. O que está com o terceiro volta ao estoque próprio.
function ModalCancelar({ remessa, aoFechar, aoSalvo }: { remessa: RemessaDetalhe; aoFechar: () => void; aoSalvo: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    setErro(null);
    setOcupado(true);
    try {
      await api.post(`/remessas-terceiro/${remessa.id}/cancelar`, {});
      aoSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo="Cancelar remessa" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p>
        Cancelar a remessa nº {remessa.numero} devolve {textoPorUnidade(remessa.itens, 'pendente')} ao estoque próprio
        de {remessa.loja}. Depois de cancelada, a remessa não pode ser reaberta.
      </p>
      <div className="terceiros-modal-botoes">
        <Botao variante="secundario" aoClicar={aoFechar} desabilitado={ocupado}>
          Voltar
        </Botao>
        <Botao variante="perigo" aoClicar={cancelar} desabilitado={ocupado}>
          {ocupado ? 'Cancelando...' : 'Cancelar remessa'}
        </Botao>
      </div>
    </Modal>
  );
}
