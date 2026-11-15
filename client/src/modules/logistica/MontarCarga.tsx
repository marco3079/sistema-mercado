import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { escapar, imprimirHtml, moeda } from '../../lib/imprimir';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Cartao, Carregando, MenuAcoes, Pagina, Selecao, Selo, formatarData } from '../../ui';
import { Icone } from '../../ui/icones';
import { MapaRota } from './MapaRota';
import { COR_ENTREGA, COR_ROTA, COR_TRANSFERENCIA, ROTULO_ENTREGA, ROTULO_ROTA, ROTULO_TRANSFERENCIA } from './tipos';
import type {
  EntregaDTO,
  PessoaDTO,
  RomaneioDTO,
  RotaDTO,
  StatusRota,
  VeiculoDTO,
} from './tipos';

// Montagem da carga de uma rota: veículo e motorista, peso, ordem das paradas, mapa e romaneio.

const ESTILO_ROMANEIO = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #000; padding: 4px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .direita { text-align: right; white-space: nowrap; }
  .assinatura { width: 90px; height: 34px; }
  .itens { margin: 0; padding-left: 14px; }
`;

const ROTA_ABERTA: StatusRota[] = ['MONTANDO', 'CARREGADA'];

// Botões de mudança de status, conforme a situação atual da rota.
function botoesDeStatus(status: StatusRota): { alvo: StatusRota; rotulo: string }[] {
  if (status === 'MONTANDO') {
    return [
      { alvo: 'CARREGADA', rotulo: 'Marcar carregada' },
      { alvo: 'EM_ROTA', rotulo: 'Saiu para entrega' },
    ];
  }
  if (status === 'CARREGADA') {
    return [
      { alvo: 'EM_ROTA', rotulo: 'Saiu para entrega' },
      { alvo: 'CONCLUIDA', rotulo: 'Concluir rota' },
    ];
  }
  if (status === 'EM_ROTA') return [{ alvo: 'CONCLUIDA', rotulo: 'Concluir rota' }];
  return [];
}

export function MontarCarga() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '';

  const rota = useDados<RotaDTO>(`/rotas/${id}`);
  const veiculos = useDados<VeiculoDTO[]>('/veiculos');
  const motoristas = useDados<PessoaDTO[]>('/lojas/equipe?perfil=MOTORISTA');
  const disponiveis = useDados<EntregaDTO[]>('/entregas?semRota=1');

  const r = rota.dados;
  const editavel = r ? ROTA_ABERTA.includes(r.status) : false;
  const encerrada = r ? r.status === 'CONCLUIDA' || r.status === 'CANCELADA' : false;

  const [veiculoId, setVeiculoId] = useState('');
  const [motoristaId, setMotoristaId] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [forcar, setForcar] = useState(false);
  const [kmSaida, setKmSaida] = useState('');
  const [kmRetorno, setKmRetorno] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // Preenche o formulário com a rota carregada (uma vez por rota).
  useEffect(() => {
    if (!r) return;
    setVeiculoId(r.veiculoId ? String(r.veiculoId) : '');
    setMotoristaId(r.motoristaId ? String(r.motoristaId) : '');
    setObservacoes(r.observacoes ?? '');
  }, [r?.id]);

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    setOcupado(true);
    setAviso(null);
    try {
      await acao();
      setAviso({ tipo: 'sucesso', texto: sucesso });
      rota.recarregar();
      disponiveis.recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setOcupado(false);
    }
  }

  function salvarVeiculoEMotorista() {
    void executar(
      () =>
        api.put(`/rotas/${id}`, {
          veiculoId: veiculoId ? Number(veiculoId) : null,
          motoristaId: motoristaId ? Number(motoristaId) : null,
          observacoes: observacoes.trim() || null,
          forcar,
        }),
      'Veículo e motorista salvos.',
    );
  }

  function adicionar(entrega: EntregaDTO) {
    void executar(
      () => api.put(`/rotas/${id}`, { adicionar: [entrega.id], forcar }),
      `${entrega.codigo} entrou na carga.`,
    );
  }

  function remover(entrega: EntregaDTO) {
    void executar(() => api.put(`/rotas/${id}`, { remover: [entrega.id], forcar }), `${entrega.codigo} saiu da carga.`);
  }

  function mover(indice: number, delta: number, ids: number[]) {
    const alvo = indice + delta;
    if (alvo < 0 || alvo >= ids.length) return;
    const nova = [...ids];
    [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
    void executar(() => api.put(`/rotas/${id}`, { ordem: nova }), 'Ordem das paradas atualizada.');
  }

  function roteirizar() {
    void executar(() => api.post(`/rotas/${id}/roteirizar`), 'Rota roteirizada.');
  }

  function mudarStatus(alvo: StatusRota) {
    const km: { kmInicial?: number; kmFinal?: number } = {};
    const saida = lerNumero(kmSaida);
    const retorno = lerNumero(kmRetorno);
    if (alvo === 'EM_ROTA' && saida !== null) km.kmInicial = Math.round(saida);
    if (alvo === 'CONCLUIDA' && retorno !== null) km.kmFinal = Math.round(retorno);
    void executar(
      () => api.post(`/rotas/${id}/status`, { status: alvo, ...km }),
      `Rota ${ROTULO_ROTA[alvo].toLowerCase()}.`,
    );
  }

  function cancelar() {
    if (!window.confirm('Cancelar esta rota? As entregas voltam para a fila de pendentes.')) return;
    mudarStatus('CANCELADA');
  }

  async function imprimirRomaneio() {
    setOcupado(true);
    setAviso(null);
    try {
      const dados = await api.get<RomaneioDTO>(`/rotas/${id}/romaneio`);
      const linhas = dados.entregas
        .map(
          (e) =>
            `<tr><td>${e.ordem ?? ''}</td>` +
            `<td><strong>${escapar(e.destinatario)}</strong><br>${escapar(
              [e.endereco, e.bairro, e.cidade].filter(Boolean).join(' · '),
            )}` +
            (e.telefone ? `<br>Tel.: ${escapar(e.telefone)}` : '') +
            (e.observacao ? `<br>Obs.: ${escapar(e.observacao)}` : '') +
            `</td><td><ul class="itens">${e.itens
              .map((i) => `<li>${escapar(formatarQuantidade(i.quantidade, i.unidade))} ${escapar(i.descricao)}</li>`)
              .join('')}</ul></td>` +
            `<td class="direita">${formatarQuantidade(e.pesoKg, 'kg')}</td>` +
            `<td class="direita">${moeda(e.valorCobrar)}</td>` +
            `<td class="assinatura"></td></tr>`,
        )
        .join('');
      const veiculo = dados.veiculo ? `${dados.veiculo.placa} · ${dados.veiculo.modelo}` : '—';
      const corpo =
        `<h1>Romaneio ${escapar(dados.codigo)}</h1>` +
        `<p>Data: ${escapar(formatarData(dados.data))} · Loja: ${escapar(dados.loja)}</p>` +
        `<p>Veículo: ${escapar(veiculo)} · Motorista: ${escapar(dados.motorista ?? '—')}</p>` +
        `<p>Peso total: ${formatarQuantidade(dados.pesoTotalKg, 'kg')} · Total a cobrar: ${moeda(dados.totalCobrar)}</p>` +
        (dados.observacoes ? `<p>Obs.: ${escapar(dados.observacoes)}</p>` : '') +
        `<table><thead><tr><th>#</th><th>Destino</th><th>Itens</th><th>Peso</th><th>A cobrar</th><th>Assinatura</th></tr></thead>` +
        `<tbody>${linhas}</tbody></table>`;
      imprimirHtml(`Romaneio ${dados.codigo}`, corpo, ESTILO_ROMANEIO);
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setOcupado(false);
    }
  }

  if (rota.carregando && !r) return <Carregando />;
  if (!r) {
    return (
      <Pagina titulo="Carga">
        {rota.erro && <Aviso tipo="erro">{rota.erro}</Aviso>}
      </Pagina>
    );
  }

  const carga = r.entregas.filter((e) => e.status !== 'CANCELADA');
  const idsDaCarga = carga.map((e) => e.id);
  const disponiveisParaCarga = (disponiveis.dados ?? []).filter(
    (e) => (e.status === 'PENDENTE' || e.status === 'SEPARANDO') && e.rotaId === null,
  );
  const peso = r.pesoTotalKg;
  const capacidade = r.capacidadeKg;

  return (
    <Pagina
      titulo={`Carga ${r.codigo}`}
      acoes={
        <>
          <Botao variante="texto" aoClicar={() => navigate(`${raiz}/rotas`)}>
            Voltar às rotas
          </Botao>
          <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => void imprimirRomaneio()}>
            Imprimir romaneio
          </Botao>
        </>
      }
    >
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}

      <Cartao>
        <div className="logistica-topo-rota">
          <Selo cor={COR_ROTA[r.status]}>{ROTULO_ROTA[r.status]}</Selo>
          <span className="logistica-suave">
            {formatarData(r.data)} · {r.loja.nome}
          </span>
          {r.distanciaKm !== null && (
            <span className="logistica-suave">Distância estimada: {r.distanciaKm.toLocaleString('pt-BR')} km</span>
          )}
        </div>

        <div className="logistica-peso">
          <div className="logistica-barra" role="presentation">
            <span
              className={
                capacidade !== null && peso > capacidade
                  ? 'logistica-barra-preenchida logistica-barra-estourada'
                  : 'logistica-barra-preenchida'
              }
              style={{ width: `${Math.min(r.ocupacao ?? 0, 100)}%` }}
            />
          </div>
          <p className={capacidade !== null && peso > capacidade ? 'logistica-alerta' : 'logistica-suave'}>
            Peso {formatarQuantidade(peso, 'kg')} de{' '}
            {capacidade !== null ? formatarQuantidade(capacidade, 'kg') : 'capacidade não informada'}
            {capacidade !== null && peso > capacidade ? ' · acima da capacidade' : ''}
          </p>
        </div>
      </Cartao>

      <Cartao titulo="Veículo e motorista">
        <div className="logistica-form-linha">
          <Selecao
            rotulo="Veículo"
            valor={veiculoId}
            aoMudar={setVeiculoId}
            vazio="Sem veículo"
            opcoes={(veiculos.dados ?? [])
              .filter((v) => v.ativo || String(v.id) === veiculoId)
              .map((v) => ({ valor: String(v.id), rotulo: `${v.placa} · ${v.modelo}` }))}
          />
          <Selecao
            rotulo="Motorista"
            valor={motoristaId}
            aoMudar={setMotoristaId}
            vazio="Sem motorista"
            opcoes={(motoristas.dados ?? []).map((m) => ({ valor: String(m.id), rotulo: m.nome }))}
          />
        </div>
        <Campo rotulo="Observações" valor={observacoes} aoMudar={setObservacoes} />
        <div className="logistica-form-linha">
          <Caixa rotulo="Permitir carga acima da capacidade" marcado={forcar} aoMudar={setForcar} />
          <Botao desabilitado={ocupado || encerrada} aoClicar={salvarVeiculoEMotorista}>
            Salvar veículo e motorista
          </Botao>
        </div>
        {(veiculos.erro || motoristas.erro) && (
          <Aviso tipo="erro">{veiculos.erro ?? motoristas.erro}</Aviso>
        )}
      </Cartao>

      <div className="logistica-colunas">
        <Cartao titulo={`Entregas disponíveis (${disponiveisParaCarga.length})`}>
          {disponiveis.erro && <Aviso tipo="erro">{disponiveis.erro}</Aviso>}
          {disponiveis.carregando && !disponiveis.dados && <Carregando />}
          {disponiveisParaCarga.length === 0 && !disponiveis.carregando && (
            <p className="logistica-vazio">Nenhuma entrega pendente sem rota.</p>
          )}
          <ul className="logistica-lista">
            {disponiveisParaCarga.map((e) => (
              <li key={e.id} className="logistica-item">
                <div className="logistica-item-texto">
                  <strong>{e.destinatario}</strong>
                  <span className="logistica-suave">
                    {e.codigo} · {[e.bairro, e.cidade].filter(Boolean).join(' · ') || e.endereco}
                  </span>
                  <span className="logistica-suave">
                    {formatarQuantidade(e.pesoKg, 'kg')} · {moeda(e.valorCobrar)}
                  </span>
                </div>
                <Botao variante="secundario" desabilitado={ocupado || !editavel} aoClicar={() => adicionar(e)}>
                  Adicionar
                </Botao>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo={`Na carga (${carga.length})`}>
          {carga.length === 0 && <p className="logistica-vazio">A carga está vazia. Adicione entregas à esquerda.</p>}
          <ol className="logistica-lista">
            {carga.map((e, indice) => (
              <li key={e.id} className="logistica-item">
                <span className="logistica-parada">{e.ordem ?? indice + 1}</span>
                <div className="logistica-item-texto">
                  <strong>{e.destinatario}</strong>
                  <span className="logistica-suave">
                    {e.codigo} · {[e.bairro, e.cidade].filter(Boolean).join(' · ') || e.endereco}
                  </span>
                  <span className="logistica-suave">
                    {formatarQuantidade(e.pesoKg, 'kg')} · {moeda(e.valorCobrar)}
                  </span>
                </div>
                <Selo cor={COR_ENTREGA[e.status]}>{ROTULO_ENTREGA[e.status]}</Selo>
                {editavel && (
                  <div className="logistica-acoes-parada">
                    <div className="logistica-setas">
                      <button
                        type="button"
                        className="logistica-seta"
                        aria-label={`Subir ${e.codigo} na ordem`}
                        disabled={ocupado || indice === 0}
                        onClick={() => mover(indice, -1, idsDaCarga)}
                      >
                        <Icone nome="seta-cima" tamanho={16} />
                      </button>
                      <button
                        type="button"
                        className="logistica-seta"
                        aria-label={`Descer ${e.codigo} na ordem`}
                        disabled={ocupado || indice === carga.length - 1}
                        onClick={() => mover(indice, 1, idsDaCarga)}
                      >
                        <Icone nome="seta-baixo" tamanho={16} />
                      </button>
                    </div>
                    <MenuAcoes
                      rotulo={`Mais ações da parada ${e.codigo}`}
                      acoes={[
                        {
                          rotulo: 'Remover da carga',
                          icone: 'lixeira',
                          perigo: true,
                          aoClicar: () => remover(e),
                        },
                      ]}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Cartao>
      </div>

      <Cartao titulo="Trajeto">
        <div className="logistica-acoes-linha">
          <Botao desabilitado={ocupado || !editavel || carga.length === 0} aoClicar={roteirizar}>
            Roteirizar
          </Botao>
        </div>
        <MapaRota loja={r.loja} paradas={carga.filter((e) => e.status !== 'CANCELADA')} />
      </Cartao>

      <Cartao titulo="Situação da rota">
        {botoesDeStatus(r.status).length > 0 && (
          <div className="logistica-km">
            <Campo rotulo="Km na saída" valor={kmSaida} aoMudar={setKmSaida} tipo="number" />
            <Campo rotulo="Km no retorno" valor={kmRetorno} aoMudar={setKmRetorno} tipo="number" />
          </div>
        )}
        <div className="logistica-acoes-linha">
          {botoesDeStatus(r.status).map((b) => (
            <Botao key={b.alvo} desabilitado={ocupado} aoClicar={() => mudarStatus(b.alvo)}>
              {b.rotulo}
            </Botao>
          ))}
          {!encerrada && (
            <Botao variante="perigo" desabilitado={ocupado} aoClicar={cancelar}>
              Cancelar rota
            </Botao>
          )}
        </div>
        {r.saidaEm && <p className="logistica-suave">Saiu em {new Date(r.saidaEm).toLocaleString('pt-BR')}</p>}
        {r.retornoEm && <p className="logistica-suave">Retornou em {new Date(r.retornoEm).toLocaleString('pt-BR')}</p>}
      </Cartao>

      {r.transferencias.length > 0 && (
        <Cartao titulo="Transferências nesta rota">
          <ul className="logistica-lista">
            {r.transferencias.map((t) => (
              <li key={t.id} className="logistica-item">
                <div className="logistica-item-texto">
                  <strong>
                    #{t.id} · {t.origem} → {t.destino}
                  </strong>
                  <span className="logistica-suave">{t.itens} item(ns)</span>
                </div>
                <Selo cor={COR_TRANSFERENCIA[t.status]}>{ROTULO_TRANSFERENCIA[t.status]}</Selo>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </Pagina>
  );
}
