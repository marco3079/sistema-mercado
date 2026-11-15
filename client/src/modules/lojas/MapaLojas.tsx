import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { Aviso, Botao, Carregando, Pagina, Selo, formatarDataHora, formatarMoeda } from '../../ui';
import { BarraNivel } from '../../ui/FotoProduto';
import { MapaOSM } from '../../ui/MapaOSM';
import type { LinhaMapa, PontoMapa } from '../../ui/MapaOSM';
import { ROTULO_STATUS_ENTREGA } from './tipos';
import type {
  ClienteMapaDTO,
  EntregaMapaDTO,
  FrotaMapaDTO,
  LojaMapaDTO,
  MapaLojasDTO,
  ParadaRotaDTO,
  ResumoLojaDTO,
} from './tipos';
import './lojas.css';

// Tela "Lojas e mapa" (Logística): abas Lojas, Entregas, Clientes e Frota no mapa.
// Clicar num item (lista ou marcador) abre o painel de detalhes; a frota mostra o percurso do dia.

type Aba = 'lojas' | 'entregas' | 'clientes' | 'frota';
type Camada = 'lojas' | 'cd' | 'entregas' | 'clientes' | 'frota';

const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: 'lojas', rotulo: 'Lojas' },
  { chave: 'entregas', rotulo: 'Entregas' },
  { chave: 'clientes', rotulo: 'Clientes' },
  { chave: 'frota', rotulo: 'Frota' },
];

const CAMADAS_DA_ABA: Record<Aba, Camada[]> = {
  lojas: ['lojas', 'cd'],
  entregas: ['entregas'],
  clientes: ['clientes'],
  frota: ['frota'],
};

const CAMADAS: { chave: Camada; rotulo: string; cor: 'azul' | 'roxo' | 'laranja' | 'verde' | 'magenta' }[] = [
  { chave: 'lojas', rotulo: 'Lojas', cor: 'azul' },
  { chave: 'cd', rotulo: 'Centros de distribuição', cor: 'roxo' },
  { chave: 'entregas', rotulo: 'Entregas em aberto', cor: 'laranja' },
  { chave: 'clientes', rotulo: 'Clientes atacado', cor: 'verde' },
  { chave: 'frota', rotulo: 'Frota', cor: 'magenta' },
];

const TODAS_LIGADAS: Record<Camada, boolean> = { lojas: true, cd: true, entregas: true, clientes: true, frota: true };

const STATUS_FINAIS = new Set(['ENTREGUE', 'FALHOU', 'CANCELADA']);
const SEGUNDOS_POR_PARADA = 5 * 60;
const INTERVALO_ATUALIZACAO_MS = 15000;

type Detalhe =
  | { tipo: 'loja'; id: string; loja: LojaMapaDTO }
  | { tipo: 'entrega'; id: string; entrega: EntregaMapaDTO }
  | { tipo: 'cliente'; id: string; cliente: ClienteMapaDTO }
  | { tipo: 'frota'; id: string; frota: FrotaMapaDTO };

interface Percurso {
  geometria: { lat: number; lng: number }[];
  legs: { distancia: number; duracao: number }[];
  aproximado: boolean;
}

// ---------- Utilitários ----------

function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const d1 = (lat1 * Math.PI) / 180;
  const d2 = (lat2 * Math.PI) / 180;
  const dLat = d2 - d1;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function formatarKm(metros: number): string {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

function formatarMinutos(segundos: number): string {
  return `${Math.max(1, Math.round(segundos / 60))} min`;
}

function minutosDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function situacaoFrota(f: FrotaMapaDTO): { cor: 'verde' | 'amarelo' | 'cinza'; rotulo: string } {
  if (f.online) return { cor: 'verde', rotulo: 'Online' };
  const min = minutosDesde(f.ultimoSinalEm);
  if (min !== null && min < 60) return { cor: 'amarelo', rotulo: `há ${min} min` };
  return { cor: 'cinza', rotulo: 'Sem sinal' };
}

function iconeFrota(tipo: FrotaMapaDTO['tipo']): 'caminhao' | 'usuarios' | 'pacote' {
  if (tipo === 'VEICULO') return 'caminhao';
  if (tipo === 'MOTORISTA') return 'usuarios';
  return 'pacote';
}

function somenteDigitos(texto: string | null): string {
  return (texto ?? '').replace(/\D/g, '');
}

function linkWhatsApp(texto: string | null): string | null {
  const digitos = somenteDigitos(texto);
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}`;
}

function linkMapsAte(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// Rota de hoje: distâncias e durações "em linha reta" quando o OSRM não responde.
function percursoReto(pontos: { lat: number; lng: number }[]): Percurso {
  const legs: Percurso['legs'] = [];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1];
    const b = pontos[i];
    const d = distanciaM(a.lat, a.lng, b.lat, b.lng);
    legs.push({ distancia: d, duracao: d / (30 / 3.6) });
  }
  return { geometria: pontos, legs, aproximado: true };
}

// Percurso pelo OSRM público (8 s no máximo); se falhar, linhas retas.
async function consultarOsrm(pontos: { lat: number; lng: number }[]): Promise<Percurso> {
  const coords = pontos.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 8000);
  try {
    const resposta = await fetch(url, { signal: controle.signal });
    if (!resposta.ok) throw new Error('OSRM indisponível');
    const corpo = (await resposta.json()) as {
      code?: string;
      routes?: { geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[];
    };
    const rota = corpo.routes?.[0];
    if (corpo.code !== 'Ok' || !rota) throw new Error('Sem rota');
    return {
      geometria: rota.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      legs: rota.legs.map((l) => ({ distancia: l.distance, duracao: l.duration })),
      aproximado: false,
    };
  } catch {
    return percursoReto(pontos);
  } finally {
    clearTimeout(tempo);
  }
}

// Cache de 60 s por veículo: só refaz o cálculo se a lista de paradas mudar ou se o veículo andar mais de 100 m.
const CACHE_PERCURSO = new Map<
  number,
  { em: number; chaveParadas: string; lat: number; lng: number; resultado: Percurso }
>();

function usePercurso(f: FrotaMapaDTO | null) {
  const pendentes = f?.rota ? f.rota.paradas.filter((p) => !STATUS_FINAIS.has(p.status)) : [];
  const loja = f?.rota?.loja ?? null;
  const temLoja = loja != null && loja.lat != null && loja.lng != null;
  const waypoints: { lat: number; lng: number }[] = f?.rota
    ? [
        { lat: f.lat, lng: f.lng },
        ...pendentes.map((p) => ({ lat: p.lat, lng: p.lng })),
        ...(temLoja ? [{ lat: loja!.lat as number, lng: loja!.lng as number }] : []),
      ]
    : [];
  const chaveParadas = f?.rota ? `${pendentes.map((p) => p.entregaId).join(',')}|${temLoja ? `${loja!.lat},${loja!.lng}` : ''}` : '';
  const fId = f?.rastreadorId ?? null;
  const fLat = f?.lat ?? null;
  const fLng = f?.lng ?? null;

  const [estado, setEstado] = useState<{ id: number | null; resultado: Percurso | null; carregando: boolean }>({
    id: null,
    resultado: null,
    carregando: false,
  });

  useEffect(() => {
    if (fId == null || fLat == null || fLng == null || !chaveParadas || waypoints.length < 2) {
      setEstado({ id: fId, resultado: null, carregando: false });
      return;
    }
    const cache = CACHE_PERCURSO.get(fId);
    if (
      cache &&
      Date.now() - cache.em < 60000 &&
      cache.chaveParadas === chaveParadas &&
      distanciaM(cache.lat, cache.lng, fLat, fLng) <= 100
    ) {
      setEstado({ id: fId, resultado: cache.resultado, carregando: false });
      return;
    }
    let cancelado = false;
    setEstado({ id: fId, resultado: null, carregando: true });
    consultarOsrm(waypoints).then((resultado) => {
      if (cancelado) return;
      CACHE_PERCURSO.set(fId, { em: Date.now(), chaveParadas, lat: fLat, lng: fLng, resultado });
      setEstado({ id: fId, resultado, carregando: false });
    });
    return () => {
      cancelado = true;
    };
    // Os waypoints são derivados de fLat/fLng e da chave de paradas, que estão nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fId, fLat, fLng, chaveParadas]);

  const atual = fId != null && estado.id === fId;
  return {
    pendentes,
    resultado: atual ? estado.resultado : null,
    carregando: atual ? estado.carregando : false,
  };
}

// Pontos do rastro (histórico GPS) em formatos simples; o endpoint pode devolver a lista direto ou dentro de um objeto.
function extrairPontos(corpo: unknown): { lat: number; lng: number }[] {
  const lista = Array.isArray(corpo)
    ? corpo
    : corpo && typeof corpo === 'object'
      ? ((corpo as Record<string, unknown>).pontos ??
        (corpo as Record<string, unknown>).itens ??
        (corpo as Record<string, unknown>).posicoes)
      : null;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((p) => ({ lat: Number((p as { lat: unknown }).lat), lng: Number((p as { lng: unknown }).lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

// ---------- Painel de detalhes ----------

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="mapas-painel-linha">
      <span className="mapas-painel-rotulo">{rotulo}</span>
      <span className="mapas-painel-valor">{children}</span>
    </div>
  );
}

function PainelLoja({ loja, perfil }: { loja: LojaMapaDTO; perfil: string }) {
  const navegar = useNavigate();
  const resumo = useDados<ResumoLojaDTO>(perfil === 'GESTOR' ? `/lojas/${loja.id}/resumo` : null);
  const r = resumo.dados;
  const cd = loja.tipo === 'CENTRO_DISTRIBUICAO';
  return (
    <>
      <div className="mapas-painel-topo">
        <span className={`mapas-painel-icone ${cd ? 'mapas-painel-icone-roxo' : 'mapas-painel-icone-azul'}`}>
          {cd ? 'CD' : 'LJ'}
        </span>
        <div>
          <h2 className="mapas-painel-titulo">{loja.nome}</h2>
          <div className="lojas-selos">
            <span className={`selo ${cd ? 'mapas-lojas-selo-roxo' : 'selo-azul'}`}>{cd ? 'CD' : 'Loja'}</span>
            <Selo cor={loja.ativa ? 'verde' : 'vermelho'}>{loja.ativa ? 'Ativa' : 'Inativa'}</Selo>
          </div>
        </div>
      </div>
      <div className="mapas-painel-bloco">
        <div>{loja.linhaEndereco1 ?? 'Endereço não cadastrado'}</div>
        {loja.linhaEndereco2 && <div>{loja.linhaEndereco2}</div>}
        {loja.horario && <Linha rotulo="Horário">{loja.horario}</Linha>}
        {loja.telefone && (
          <Linha rotulo="Telefone">
            <a href={`tel:${somenteDigitos(loja.telefone)}`}>{loja.telefone}</a>
          </Linha>
        )}
        {loja.cnpj && <Linha rotulo="CNPJ">{loja.cnpj}</Linha>}
        {loja.latitude != null && loja.longitude != null && (
          <Linha rotulo="Coordenadas">
            {loja.latitude.toFixed(5)}, {loja.longitude.toFixed(5)}
          </Linha>
        )}
      </div>
      {perfil === 'GESTOR' && (
        <div className="mapas-painel-numeros">
          {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
          {resumo.carregando && !r && <Carregando />}
          {r && (
            <>
              <div className="lojas-numero"><span className="lojas-numero-valor">{formatarMoeda(r.vendasHoje)}</span><span className="lojas-numero-rotulo">Vendas hoje</span></div>
              <div className="lojas-numero"><span className="lojas-numero-valor">{formatarMoeda(r.vendasMes)}</span><span className="lojas-numero-rotulo">Vendas no mês</span></div>
              <div className="lojas-numero"><span className="lojas-numero-valor">{formatarMoeda(r.valorEstoque)}</span><span className="lojas-numero-rotulo">Valor em estoque</span></div>
              <div className="lojas-numero"><span className="lojas-numero-valor">{r.usuarios}</span><span className="lojas-numero-rotulo">Pessoas na equipe</span></div>
            </>
          )}
        </div>
      )}
      <div className="mapas-painel-acoes">
        {loja.latitude != null && loja.longitude != null && (
          <a className="lojas-link" href={linkMapsAte(loja.latitude, loja.longitude)} target="_blank" rel="noreferrer">
            Como chegar
          </a>
        )}
        {perfil === 'GESTOR' && (
          <Botao variante="secundario" aoClicar={() => navegar(`${RAIZ_DO_PERFIL.GESTOR}/lojas`)}>
            Editar loja
          </Botao>
        )}
      </div>
    </>
  );
}

function PainelEntrega({ entrega, perfil }: { entrega: EntregaMapaDTO; perfil: string }) {
  const navegar = useNavigate();
  const cor =
    entrega.status === 'EM_ROTA' ? 'azul' : entrega.status === 'SEPARANDO' ? 'amarelo' : 'cinza';
  return (
    <>
      <div className="mapas-painel-topo">
        <span className="mapas-painel-icone mapas-painel-icone-laranja">EN</span>
        <div>
          <h2 className="mapas-painel-titulo">{entrega.codigo}</h2>
          <Selo cor={cor}>{ROTULO_STATUS_ENTREGA[entrega.status]}</Selo>
        </div>
      </div>
      <div className="mapas-painel-bloco">
        <Linha rotulo="Destinatário">{entrega.destinatario}</Linha>
        {entrega.telefone && (
          <Linha rotulo="Telefone">
            <a href={`tel:${somenteDigitos(entrega.telefone)}`}>{entrega.telefone}</a>
          </Linha>
        )}
        <Linha rotulo="Endereço">
          {entrega.endereco}
          {entrega.bairro ? ` — ${entrega.bairro}` : ''}
          {entrega.cidade ? ` · ${entrega.cidade}` : ''}
        </Linha>
        <Linha rotulo="A cobrar">{formatarMoeda(entrega.valorCobrar)}</Linha>
        {entrega.previsao && <Linha rotulo="Previsão">{formatarDataHora(entrega.previsao)}</Linha>}
        {entrega.motorista && <Linha rotulo="Motorista">{entrega.motorista}</Linha>}
      </div>
      <div className="mapas-painel-acoes">
        <a className="lojas-link" href={`/rastreio/${entrega.codigo}`} target="_blank" rel="noreferrer">
          Rastreio
        </a>
        <Botao variante="secundario" aoClicar={() => navegar(`${RAIZ_DO_PERFIL[perfil as keyof typeof RAIZ_DO_PERFIL] ?? RAIZ_DO_PERFIL.GESTOR}/entregas`)}>
          Abrir entregas
        </Botao>
      </div>
    </>
  );
}

function PainelCliente({ cliente, perfil }: { cliente: ClienteMapaDTO; perfil: string }) {
  const navegar = useNavigate();
  const zap = linkWhatsApp(cliente.whatsapp ?? cliente.telefone);
  return (
    <>
      <div className="mapas-painel-topo">
        <span className="mapas-painel-icone mapas-painel-icone-verde">CL</span>
        <div>
          <h2 className="mapas-painel-titulo">{cliente.nome}</h2>
          <Selo cor="verde">Atacado</Selo>
        </div>
      </div>
      <div className="mapas-painel-bloco">
        {cliente.cpfCnpj && <Linha rotulo="CPF/CNPJ">{cliente.cpfCnpj}</Linha>}
        {cliente.telefone && (
          <Linha rotulo="Telefone">
            <a href={`tel:${somenteDigitos(cliente.telefone)}`}>{cliente.telefone}</a>
          </Linha>
        )}
        {cliente.endereco && (
          <Linha rotulo="Endereço">
            {cliente.endereco}
            {cliente.bairro ? ` — ${cliente.bairro}` : ''}
          </Linha>
        )}
        {cliente.cidade && <Linha rotulo="Cidade">{cliente.cidade}</Linha>}
        {cliente.limiteCredito != null && <Linha rotulo="Limite">{formatarMoeda(cliente.limiteCredito)}</Linha>}
        {cliente.saldoDevedor != null && <Linha rotulo="Saldo devedor">{formatarMoeda(cliente.saldoDevedor)}</Linha>}
      </div>
      <div className="mapas-painel-acoes">
        {zap && (
          <a className="lojas-link" href={zap} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        <Botao variante="secundario" aoClicar={() => navegar(`${RAIZ_DO_PERFIL[perfil as keyof typeof RAIZ_DO_PERFIL] ?? RAIZ_DO_PERFIL.GESTOR}/clientes`)}>
          Abrir cliente
        </Botao>
      </div>
    </>
  );
}

function PainelFrota({
  frota,
  perfil,
  rastro,
  percurso,
}: {
  frota: FrotaMapaDTO;
  perfil: string;
  rastro: { estado: 'carregando' | 'ok' | 'indisponivel'; pontos: { lat: number; lng: number }[] };
  percurso: { pendentes: ParadaRotaDTO[]; resultado: Percurso | null; carregando: boolean; temLoja: boolean };
}) {
  const navegar = useNavigate();
  const situacao = situacaoFrota(frota);
  const bateria = frota.bateria;
  const corBateria = bateria == null ? 'azul' : bateria < 20 ? 'vermelho' : bateria < 40 ? 'amarelo' : 'verde';
  const { pendentes, resultado } = percurso;
  const legs = resultado?.legs ?? [];

  // Chegada estimada de cada parada pendente: agora + durações acumuladas + 5 min por parada anterior.
  const agora = Date.now();
  let acumulado = 0;
  const previsoes = pendentes.map((p, i) => {
    acumulado += legs[i]?.duracao ?? 0;
    const chegada = agora + (acumulado + i * SEGUNDOS_POR_PARADA) * 1000;
    return { parada: p, distancia: legs[i]?.distancia ?? null, duracao: legs[i]?.duracao ?? null, chegada };
  });
  const totalDistancia = legs.reduce((s, l) => s + l.distancia, 0);
  const totalDuracao = legs.reduce((s, l) => s + l.duracao, 0) + pendentes.length * SEGUNDOS_POR_PARADA;
  const proxima = previsoes[0];

  return (
    <>
      <div className="mapas-painel-topo">
        <span className="mapas-painel-icone mapas-painel-icone-magenta">{frota.veiculo ? frota.veiculo.placa.slice(0, 2) : 'GP'}</span>
        <div>
          <h2 className="mapas-painel-titulo">{frota.nome}</h2>
          <Selo cor={situacao.cor === 'verde' ? 'verde' : situacao.cor === 'amarelo' ? 'amarelo' : 'cinza'}>
            {situacao.rotulo}
          </Selo>
        </div>
      </div>

      <div className="mapas-painel-bloco">
        {frota.veiculo && (
          <Linha rotulo="Veículo">
            <span className="mapas-placa">{frota.veiculo.placa}</span> {frota.veiculo.modelo}
          </Linha>
        )}
        {frota.motorista && <Linha rotulo="Motorista">{frota.motorista}</Linha>}
        <Linha rotulo="Velocidade">{frota.velocidade != null ? `${Math.round(frota.velocidade)} km/h` : '—'}</Linha>
        <Linha rotulo="Bateria">
          {bateria != null ? (
            <span className="mapas-bateria">
              <BarraNivel valor={bateria} maximo={100} cor={corBateria} /> {bateria}%
            </span>
          ) : (
            '—'
          )}
        </Linha>
        <Linha rotulo="Último sinal">
          {minutosDesde(frota.ultimoSinalEm) != null ? `há ${minutosDesde(frota.ultimoSinalEm)} min` : '—'}
        </Linha>
        <Linha rotulo="Posição">
          {frota.lat.toFixed(5)}, {frota.lng.toFixed(5)}
        </Linha>
      </div>

      <div className="mapas-painel-bloco">
        <h3 className="mapas-painel-subtitulo">Percurso de hoje</h3>
        {!frota.rota && <p className="mapas-painel-vazio">Sem rota em andamento para hoje.</p>}
        {frota.rota && percurso.carregando && <p className="mapas-painel-vazio">Calculando percurso...</p>}
        {frota.rota && pendentes.length === 0 && (
          <p className="mapas-painel-vazio">Todas as paradas da rota {frota.rota.codigo} foram concluídas.</p>
        )}
        {frota.rota && proxima && (
          <div className="mapas-proxima">
            <span className="mapas-proxima-rotulo">Próxima parada</span>
            <strong>{proxima.parada.destinatario}</strong>
            <span>{proxima.parada.endereco}{proxima.parada.bairro ? ` — ${proxima.parada.bairro}` : ''}</span>
            <span className="mapas-proxima-tempo">
              {proxima.distancia != null && proxima.duracao != null
                ? `${formatarKm(proxima.distancia)} · ${formatarMinutos(proxima.duracao)}`
                : 'Calculando...'}
            </span>
          </div>
        )}
        {previsoes.length > 1 && (
          <ol className="mapas-paradas">
            {previsoes.slice(1).map((pr) => (
              <li key={pr.parada.entregaId}>
                <span>{pr.parada.ordem}. {pr.parada.destinatario}</span>
                <span className="mapas-paradas-hora">
                  {new Date(pr.chegada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ol>
        )}
        {frota.rota && pendentes.length > 0 && resultado && (
          <p className="mapas-painel-total">
            Total: {formatarKm(totalDistancia)} · {formatarMinutos(totalDuracao)}
            {percurso.temLoja ? ' (inclui volta à loja)' : ''}
          </p>
        )}
        {frota.rota && resultado?.aproximado && (
          <p className="mapas-painel-aviso">Traçado aproximado (sem serviço de rotas)</p>
        )}
      </div>

      <div className="mapas-painel-bloco">
        <h3 className="mapas-painel-subtitulo">Histórico (últimas 2 horas)</h3>
        {rastro.estado === 'carregando' && <p className="mapas-painel-vazio">Carregando rastro...</p>}
        {rastro.estado === 'indisponivel' && <p className="mapas-painel-vazio">Histórico indisponível</p>}
        {rastro.estado === 'ok' && <p className="mapas-painel-vazio">{rastro.pontos.length} posições no mapa.</p>}
      </div>

      <div className="mapas-painel-acoes">
        <a className="lojas-link" href={linkMapsAte(frota.lat, frota.lng)} target="_blank" rel="noreferrer">
          Como chegar
        </a>
        <Botao
          variante="secundario"
          aoClicar={() => navegar(`${RAIZ_DO_PERFIL[perfil as keyof typeof RAIZ_DO_PERFIL] ?? RAIZ_DO_PERFIL.GESTOR}/configuracoes?aba=gps`)}
        >
          Configurar tag
        </Botao>
      </div>
    </>
  );
}

function PainelDetalhes({
  detalhe,
  perfil,
  onFechar,
  rastro,
  percurso,
}: {
  detalhe: Detalhe;
  perfil: string;
  onFechar: () => void;
  rastro: { estado: 'carregando' | 'ok' | 'indisponivel'; pontos: { lat: number; lng: number }[] };
  percurso: { pendentes: ParadaRotaDTO[]; resultado: Percurso | null; carregando: boolean; temLoja: boolean };
}) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <aside className="mapas-painel" aria-label="Detalhes">
      <button type="button" className="mapas-painel-fechar" aria-label="Fechar detalhes" onClick={onFechar}>
        ×
      </button>
      <div className="mapas-painel-conteudo">
        {detalhe.tipo === 'loja' && <PainelLoja loja={detalhe.loja} perfil={perfil} />}
        {detalhe.tipo === 'entrega' && <PainelEntrega entrega={detalhe.entrega} perfil={perfil} />}
        {detalhe.tipo === 'cliente' && <PainelCliente cliente={detalhe.cliente} perfil={perfil} />}
        {detalhe.tipo === 'frota' && (
          <PainelFrota frota={detalhe.frota} perfil={perfil} rastro={rastro} percurso={percurso} />
        )}
      </div>
    </aside>
  );
}

// ---------- Tela ----------

export function MapaLojas() {
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const perfil = usuario?.perfil ?? 'GESTOR';
  const { dados, carregando, erro, recarregar } = useDados<MapaLojasDTO>('/lojas/mapa');
  const [params] = useSearchParams();
  const rastreadorInicial = params.get('rastreador');
  const lojaInicial = params.get('loja');

  const [aba, setAba] = useState<Aba>(rastreadorInicial ? 'frota' : lojaInicial ? 'lojas' : 'lojas');
  const [busca, setBusca] = useState('');
  const [ligadas, setLigadas] = useState<Record<Camada, boolean>>(TODAS_LIGADAS);
  const [foco, setFoco] = useState<{ id: string; t: number } | undefined>(undefined);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [rastro, setRastro] = useState<{ id: number; estado: 'carregando' | 'ok' | 'indisponivel'; pontos: { lat: number; lng: number }[] } | null>(null);
  const focoInicialFeito = useRef(false);

  // Atualiza a tela a cada 15 s (frota e posições). A função fica numa referência para o intervalo não reiniciar.
  const recarregarRef = useRef(recarregar);
  recarregarRef.current = recarregar;
  useEffect(() => {
    const t = setInterval(() => recarregarRef.current(), INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, []);

  // Detalhes indexados pelo id do ponto (loja-1, entrega-2, cliente-3, frota-4).
  const detalhes = useMemo(() => {
    const mapa = new Map<string, Detalhe>();
    if (!dados) return mapa;
    for (const loja of dados.lojas) mapa.set(`loja-${loja.id}`, { tipo: 'loja', id: `loja-${loja.id}`, loja });
    for (const entrega of dados.entregas) mapa.set(`entrega-${entrega.id}`, { tipo: 'entrega', id: `entrega-${entrega.id}`, entrega });
    for (const cliente of dados.clientes) mapa.set(`cliente-${cliente.id}`, { tipo: 'cliente', id: `cliente-${cliente.id}`, cliente });
    for (const frota of dados.frota) mapa.set(`frota-${frota.rastreadorId}`, { tipo: 'frota', id: `frota-${frota.rastreadorId}`, frota });
    return mapa;
  }, [dados]);

  const detalheSelecionado = selecionadoId ? detalhes.get(selecionadoId) ?? null : null;
  const frotaSelecionada = detalheSelecionado?.tipo === 'frota' ? detalheSelecionado.frota : null;
  const frotaSelId = frotaSelecionada?.rastreadorId ?? null;

  const percurso = usePercurso(frotaSelecionada);
  const enquadrarPontos = useMemo(() => percurso.resultado?.geometria, [percurso.resultado]);

  // Foco inicial vindo de fora: ?rastreador=ID (aba Frota) ou ?loja=ID (aba Lojas).
  useEffect(() => {
    if (!dados || focoInicialFeito.current) return;
    if (rastreadorInicial) {
      focoInicialFeito.current = true;
      setAba('frota');
      setSelecionadoId(`frota-${rastreadorInicial}`);
      setFoco({ id: `frota-${rastreadorInicial}`, t: Date.now() });
    } else if (lojaInicial) {
      focoInicialFeito.current = true;
      setSelecionadoId(`loja-${lojaInicial}`);
      setFoco({ id: `loja-${lojaInicial}`, t: Date.now() });
    }
  }, [dados, rastreadorInicial, lojaInicial]);

  // Rastro das últimas 2 horas do veículo selecionado (endpoint pode não existir ainda).
  useEffect(() => {
    if (frotaSelId == null) {
      setRastro(null);
      return;
    }
    let cancelado = false;
    setRastro({ id: frotaSelId, estado: 'carregando', pontos: [] });
    api
      .get<unknown>(`/gps/rastreadores/${frotaSelId}/historico?horas=2`)
      .then((corpo) => {
        if (!cancelado) setRastro({ id: frotaSelId, estado: 'ok', pontos: extrairPontos(corpo) });
      })
      .catch(() => {
        if (!cancelado) setRastro({ id: frotaSelId, estado: 'indisponivel', pontos: [] });
      });
    return () => {
      cancelado = true;
    };
  }, [frotaSelId]);

  // Marcadores e rotas do mapa.
  const pontos = useMemo<PontoMapa[]>(() => {
    if (!dados) return [];
    const lista: PontoMapa[] = [];
    for (const loja of dados.lojas) {
      if (loja.latitude == null || loja.longitude == null) continue;
      const cd = loja.tipo === 'CENTRO_DISTRIBUICAO';
      if (!ligadas[cd ? 'cd' : 'lojas']) continue;
      lista.push({
        id: `loja-${loja.id}`,
        lat: loja.latitude,
        lng: loja.longitude,
        titulo: loja.nome,
        subtitulo: loja.enderecoFormatado ?? undefined,
        cor: cd ? 'roxo' : 'azul',
        icone: cd ? 'caminhao' : 'loja',
      });
    }
    if (ligadas.entregas) {
      for (const entrega of dados.entregas) {
        lista.push({
          id: `entrega-${entrega.id}`,
          lat: entrega.latitude,
          lng: entrega.longitude,
          titulo: entrega.codigo,
          subtitulo: [entrega.destinatario, entrega.bairro, ROTULO_STATUS_ENTREGA[entrega.status]].filter(Boolean).join(' · '),
          cor: 'laranja',
          icone: 'pacote',
        });
      }
    }
    if (ligadas.clientes) {
      for (const cliente of dados.clientes) {
        lista.push({
          id: `cliente-${cliente.id}`,
          lat: cliente.latitude,
          lng: cliente.longitude,
          titulo: cliente.nome,
          subtitulo: 'Cliente atacado',
          cor: 'verde',
          icone: 'usuarios',
        });
      }
    }
    if (ligadas.frota) {
      for (const f of dados.frota) {
        lista.push({
          id: `frota-${f.rastreadorId}`,
          lat: f.lat,
          lng: f.lng,
          titulo: f.nome,
          subtitulo: f.veiculo ? `${f.veiculo.placa} · ${f.veiculo.modelo}` : f.motorista ?? undefined,
          cor: f.online ? 'magenta' : 'cinza',
          icone: iconeFrota(f.tipo),
        });
      }
    }
    // Paradas do percurso do veículo selecionado: pendentes numeradas em laranja, concluídas com ✓ em verde.
    if (frotaSelecionada?.rota) {
      for (const p of frotaSelecionada.rota.paradas) {
        const feita = STATUS_FINAIS.has(p.status);
        const ordemPendente = percurso.pendentes.findIndex((q) => q.entregaId === p.entregaId);
        lista.push({
          id: `parada-${p.entregaId}`,
          lat: p.lat,
          lng: p.lng,
          titulo: `${p.codigo} · ${p.destinatario}`,
          subtitulo: p.endereco,
          cor: feita ? 'verde' : 'laranja',
          rotulo: feita ? '✓' : String(ordemPendente + 1),
        });
      }
    }
    return lista;
  }, [dados, ligadas, frotaSelecionada, percurso.pendentes]);

  // Linhas: rastro (cinza tracejado) e percurso (azul com contorno branco).
  const linhas = useMemo<LinhaMapa[] | undefined>(() => {
    const saida: LinhaMapa[] = [];
    if (rastro && rastro.id === frotaSelId && rastro.pontos.length > 1) {
      saida.push({ pontos: rastro.pontos, cor: '#64748b', espessura: 3, tracejada: true });
    }
    if (percurso.resultado) {
      saida.push({ pontos: percurso.resultado.geometria, cor: '#2563eb', espessura: 5, borda: true });
    }
    return saida.length > 0 ? saida : undefined;
  }, [rastro, frotaSelId, percurso.resultado]);

  function abrirDetalhe(id: string, camada: Camada) {
    setLigadas((atual) => ({ ...atual, [camada]: true }));
    setSelecionadoId(id);
    setFoco({ id, t: Date.now() });
  }

  function trocarAba(nova: Aba) {
    setAba(nova);
    setBusca('');
    setLigadas((atual) => {
      const proximo = { ...atual };
      for (const c of CAMADAS_DA_ABA[nova]) proximo[c] = true;
      return proximo;
    });
  }

  function alternarCamada(chave: Camada) {
    setLigadas((atual) => ({ ...atual, [chave]: !atual[chave] }));
  }

  const termo = busca.trim().toLowerCase();
  const passa = (...textos: (string | null | undefined)[]) =>
    termo === '' || textos.some((t) => (t ?? '').toLowerCase().includes(termo));

  const lojasFiltradas = (dados?.lojas ?? []).filter((l) => passa(l.nome, l.enderecoFormatado));
  const entregasFiltradas = (dados?.entregas ?? []).filter((e) => passa(e.codigo, e.destinatario, e.bairro));
  const clientesFiltrados = (dados?.clientes ?? []).filter((c) => passa(c.nome, c.cidade, c.telefone));
  const frotaFiltrada = (dados?.frota ?? []).filter((f) => passa(f.nome, f.veiculo?.placa, f.veiculo?.modelo, f.motorista));

  const contagem: Record<Aba, number> = {
    lojas: lojasFiltradas.length,
    entregas: entregasFiltradas.length,
    clientes: clientesFiltrados.length,
    frota: frotaFiltrada.length,
  };

  const algumaLigada = Object.values(ligadas).some(Boolean);

  return (
    <Pagina titulo="Lojas e mapa">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <>
          <div className="mapas-lojas-camadas" role="group" aria-label="Camadas do mapa">
            {CAMADAS.map((camada) => (
              <button
                key={camada.chave}
                type="button"
                aria-pressed={ligadas[camada.chave]}
                className={`mapas-lojas-pilula mapas-lojas-pilula-${camada.cor}${ligadas[camada.chave] ? ' mapas-lojas-pilula-ligada' : ''}`}
                onClick={() => alternarCamada(camada.chave)}
              >
                <span className="mapas-lojas-ponto" aria-hidden="true" />
                {camada.rotulo}
              </button>
            ))}
          </div>

          <div className="mapas-lojas">
            <aside className="mapas-lojas-lista" aria-label="Lista">
              <div className="mapas-lojas-abas" role="tablist">
                {ABAS.map((a) => (
                  <button
                    key={a.chave}
                    type="button"
                    role="tab"
                    aria-selected={aba === a.chave}
                    className={`mapas-lojas-aba${aba === a.chave ? ' mapas-lojas-aba-ativa' : ''}`}
                    onClick={() => trocarAba(a.chave)}
                  >
                    {a.rotulo} <span className="mapas-lojas-contagem">{contagem[a.chave]}</span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="mapas-lojas-busca"
                placeholder="Buscar nesta lista"
                aria-label="Buscar nesta lista"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />

              {aba === 'lojas' && (
                <>
                  {lojasFiltradas.length === 0 && <p className="lojas-vazio">Nenhuma loja encontrada.</p>}
                  {lojasFiltradas.map((loja) => {
                    const cd = loja.tipo === 'CENTRO_DISTRIBUICAO';
                    const temCoord = loja.latitude != null && loja.longitude != null;
                    return (
                      <article key={loja.id} className={`mapas-lojas-cartao${selecionadoId === `loja-${loja.id}` ? ' mapas-lojas-cartao-ativo' : ''}`}>
                        <div className="lojas-cabecalho">
                          <h2 className="lojas-nome">{loja.nome}</h2>
                          <span className={`selo ${cd ? 'mapas-lojas-selo-roxo' : 'selo-azul'}`}>{cd ? 'CD' : 'Loja'}</span>
                        </div>
                        <div className="lojas-dados">
                          <div>{loja.linhaEndereco1 ?? 'Endereço não cadastrado'}</div>
                          {loja.linhaEndereco2 && <div>{loja.linhaEndereco2}</div>}
                          {loja.telefone && <div>{loja.telefone}</div>}
                          {!temCoord && <div className="mapas-lojas-sem-coord">Sem coordenadas: não aparece no mapa.</div>}
                        </div>
                        <div className="lojas-acoes">
                          <Botao variante="texto" desabilitado={!temCoord} aoClicar={() => abrirDetalhe(`loja-${loja.id}`, cd ? 'cd' : 'lojas')}>
                            Ver no mapa
                          </Botao>
                          {temCoord && (
                            <a className="lojas-link" href={linkMapsAte(loja.latitude as number, loja.longitude as number)} target="_blank" rel="noreferrer">
                              Como chegar
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </>
              )}

              {aba === 'entregas' && (
                <>
                  {entregasFiltradas.length === 0 && <p className="lojas-vazio">Nenhuma entrega em aberto.</p>}
                  {entregasFiltradas.map((e) => {
                    const cor = e.status === 'EM_ROTA' ? 'azul' : e.status === 'SEPARANDO' ? 'amarelo' : 'cinza';
                    return (
                      <article key={e.id} className={`mapas-lojas-cartao${selecionadoId === `entrega-${e.id}` ? ' mapas-lojas-cartao-ativo' : ''}`}>
                        <button type="button" className="mapas-lojas-item" onClick={() => abrirDetalhe(`entrega-${e.id}`, 'entregas')}>
                          <span className="mapas-lojas-item-titulo">{e.codigo}</span>
                          <span className="mapas-lojas-item-sub">{e.destinatario}{e.bairro ? ` · ${e.bairro}` : ''}</span>
                        </button>
                        <div className="lojas-acoes">
                          <Selo cor={cor}>{ROTULO_STATUS_ENTREGA[e.status]}</Selo>
                          <span className="numero">{formatarMoeda(e.valorCobrar)}</span>
                          <Botao variante="texto" aoClicar={() => navegar(`${RAIZ_DO_PERFIL[perfil as keyof typeof RAIZ_DO_PERFIL] ?? RAIZ_DO_PERFIL.GESTOR}/entregas`)}>
                            Abrir
                          </Botao>
                        </div>
                      </article>
                    );
                  })}
                </>
              )}

              {aba === 'clientes' && (
                <>
                  {clientesFiltrados.length === 0 && <p className="lojas-vazio">Nenhum cliente atacado com endereço no mapa.</p>}
                  {clientesFiltrados.map((c) => {
                    const zap = linkWhatsApp(c.whatsapp ?? c.telefone);
                    return (
                      <article key={c.id} className={`mapas-lojas-cartao${selecionadoId === `cliente-${c.id}` ? ' mapas-lojas-cartao-ativo' : ''}`}>
                        <button type="button" className="mapas-lojas-item" onClick={() => abrirDetalhe(`cliente-${c.id}`, 'clientes')}>
                          <span className="mapas-lojas-item-titulo">{c.nome}</span>
                          <span className="mapas-lojas-item-sub">{[c.cidade, c.telefone].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</span>
                        </button>
                        <div className="lojas-acoes">
                          <Selo cor="verde">Atacado</Selo>
                          {zap && (
                            <a className="lojas-link" href={zap} target="_blank" rel="noreferrer">
                              WhatsApp
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </>
              )}

              {aba === 'frota' && (
                <>
                  {frotaFiltrada.length === 0 && <p className="lojas-vazio">Nenhum rastreador com posição.</p>}
                  {frotaFiltrada.map((f) => {
                    const situacao = situacaoFrota(f);
                    return (
                      <article key={f.rastreadorId} className={`mapas-lojas-cartao${selecionadoId === `frota-${f.rastreadorId}` ? ' mapas-lojas-cartao-ativo' : ''}`}>
                        <button type="button" className="mapas-lojas-item" onClick={() => abrirDetalhe(`frota-${f.rastreadorId}`, 'frota')}>
                          <span className="mapas-lojas-item-titulo">{f.nome}</span>
                          <span className="mapas-lojas-item-sub">
                            {f.veiculo ? `${f.veiculo.placa} · ${f.veiculo.modelo}` : f.motorista ?? 'Sem veículo ou motorista'}
                          </span>
                        </button>
                        <div className="lojas-acoes">
                          <Selo cor={situacao.cor === 'verde' ? 'verde' : situacao.cor === 'amarelo' ? 'amarelo' : 'cinza'}>{situacao.rotulo}</Selo>
                          <span className="numero">{f.velocidade != null ? `${Math.round(f.velocidade)} km/h` : '—'}</span>
                          <span className="numero">{f.bateria != null ? `${f.bateria}%` : '—'}</span>
                        </div>
                      </article>
                    );
                  })}
                </>
              )}
            </aside>

            <div className="mapas-lojas-mapa">
              <MapaOSM
                pontos={pontos}
                altura="100%"
                focar={foco}
                enquadrar={enquadrarPontos}
                linhas={linhas}
                atribuicaoExtra={percurso.resultado && !percurso.resultado.aproximado ? 'Rotas © OSRM' : undefined}
                avisoVazio={algumaLigada ? 'Cadastre as coordenadas para ver no mapa' : 'Ligue uma camada para ver os pontos'}
                aoClicarPonto={(id) => {
                  const s = String(id);
                  if (detalhes.has(s)) setSelecionadoId(s);
                }}
              />
              {detalheSelecionado && (
                <PainelDetalhes
                  detalhe={detalheSelecionado}
                  perfil={perfil}
                  onFechar={() => setSelecionadoId(null)}
                  rastro={rastro && rastro.id === frotaSelId ? rastro : { estado: 'carregando', pontos: [] }}
                  percurso={{
                    pendentes: percurso.pendentes,
                    resultado: percurso.resultado,
                    carregando: percurso.carregando,
                    temLoja: frotaSelecionada?.rota?.loja.lat != null && frotaSelecionada?.rota?.loja.lng != null,
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </Pagina>
  );
}
