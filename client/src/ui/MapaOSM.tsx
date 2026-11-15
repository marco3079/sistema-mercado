import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { Icone } from './icones';
import type { NomeIcone } from './icones';
import './mapa-osm.css';

// Mapa com os blocos (tiles) do OpenStreetMap, sem bibliotecas. Arrastar move, +/- e roda do mouse dão zoom.
// pontos: marcadores com cor, ícone (ou rótulo, ex.: número da ordem). Clicar num marcador abre um balão.
// linhas: polilinhas por cima dos blocos (rastro, percurso). enquadrar: ajusta a visão para caber esses pontos.

export interface PontoMapa {
  id: string | number;
  lat: number;
  lng: number;
  titulo: string;
  subtitulo?: string;
  cor?: 'azul' | 'verde' | 'laranja' | 'vermelho' | 'roxo' | 'cinza' | 'magenta';
  icone?: NomeIcone;
  rotulo?: string;
}

export interface LinhaMapa {
  pontos: { lat: number; lng: number }[];
  cor?: string; // padrão azul
  espessura?: number; // px, padrão 4
  tracejada?: boolean;
  borda?: boolean; // contorno branco por baixo da linha
}

// Visão: zoom e centro em pixels do mundo (Web Mercator, blocos de 256 px) no zoom atual.
interface Visao {
  z: number;
  cx: number;
  cy: number;
}

interface Tamanho {
  largura: number;
  altura: number;
}

const LADO = 256;
const ZOOM_MIN = 3;
const ZOOM_MAX = 18;
const BRASIL = { lat: -15, lng: -50, z: 4 };
const MARGEM = 48;

function mundoX(lng: number, z: number): number {
  return ((lng + 180) / 360) * LADO * 2 ** z;
}

function mundoY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * LADO * 2 ** z;
}

function zoomarVisao(v: Visao, dz: number): Visao {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z + dz));
  if (z === v.z) return v;
  const fator = 2 ** (z - v.z);
  return { z, cx: v.cx * fator, cy: v.cy * fator };
}

// Visão que mostra todos os pontos (maior zoom possível, com margem); sem pontos, mostra o Brasil.
function visaoParaPontos(pontos: { lat: number; lng: number }[], largura: number, altura: number): Visao {
  if (pontos.length === 0) {
    return { z: BRASIL.z, cx: mundoX(BRASIL.lng, BRASIL.z), cy: mundoY(BRASIL.lat, BRASIL.z) };
  }
  if (pontos.length === 1) {
    const p = pontos[0];
    return { z: 15, cx: mundoX(p.lng, 15), cy: mundoY(p.lat, 15) };
  }
  const lats = pontos.map((p) => p.lat);
  const lngs = pontos.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  let z = ZOOM_MIN;
  for (let t = 17; t >= ZOOM_MIN; t--) {
    const dx = Math.abs(mundoX(maxLng, t) - mundoX(minLng, t));
    const dy = Math.abs(mundoY(minLat, t) - mundoY(maxLat, t));
    if (dx + MARGEM * 2 <= largura && dy + MARGEM * 2 <= altura) {
      z = t;
      break;
    }
  }
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  return { z, cx: mundoX(cLng, z), cy: mundoY(cLat, z) };
}

// Endereços dos blocos visíveis numa visão (usado para pré-carregar antes de trocar de zoom).
function blocosDaVisao(v: Visao, tam: Tamanho): { tx: number; ty: number; wx: number; n: number; src: string }[] {
  const x0 = v.cx - tam.largura / 2;
  const y0 = v.cy - tam.altura / 2;
  const n = 2 ** v.z;
  const saida: { tx: number; ty: number; wx: number; n: number; src: string }[] = [];
  for (let tx = Math.floor(x0 / LADO); tx <= Math.floor((x0 + tam.largura) / LADO); tx++) {
    for (let ty = Math.floor(y0 / LADO); ty <= Math.floor((y0 + tam.altura) / LADO); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      saida.push({ tx, ty, wx, n, src: `https://tile.openstreetmap.org/${v.z}/${wx}/${ty}.png` });
    }
  }
  return saida;
}

export function MapaOSM({
  pontos,
  altura = 420,
  aoClicarPonto,
  focar,
  enquadrar,
  linhas,
  atribuicaoExtra,
  avisoVazio = 'Cadastre as coordenadas para ver no mapa',
}: {
  pontos: PontoMapa[];
  altura?: number | string;
  aoClicarPonto?: (id: string | number) => void;
  // Centraliza e aproxima no ponto com este id. Mude o objeto (ex.: { id, t: Date.now() }) para focar de novo.
  focar?: { id: string | number; t: number };
  // Quando a referência muda, enquadra estes pontos (ex.: o percurso inteiro).
  enquadrar?: { lat: number; lng: number }[];
  linhas?: LinhaMapa[];
  atribuicaoExtra?: string; // ex.: "Rotas © OSRM"
  avisoVazio?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tamRef = useRef<Tamanho>({ largura: 600, altura: 420 });
  const [tam, setTam] = useState<Tamanho>({ largura: 600, altura: 420 });
  const [visao, setVisao] = useState<Visao>(() => visaoParaPontos([], 600, 420));
  // Visão dos blocos na tela: troca só depois que os blocos do novo zoom carregarem.
  const [blocosVisao, setBlocosVisao] = useState<Visao>(() => visaoParaPontos([], 600, 420));
  const blocosRef = useRef<Visao>(blocosVisao);
  const [selecionadoId, setSelecionadoId] = useState<string | number | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const arrasteRef = useRef<{ x: number; y: number; cx: number; cy: number; moveu: boolean } | null>(null);
  // Fica true depois de um arraste, para o clique que vem em seguida não abrir balão.
  const moveuRef = useRef(false);
  const idsChave = pontos.map((p) => String(p.id)).join('|');

  // Mede o tamanho do mapa e acompanha redimensionamento.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const novo = { largura: r.width, altura: r.height };
        tamRef.current = novo;
        setTam(novo);
      }
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // Enquadra os pontos sempre que a lista de pontos muda (ex.: ligar ou desligar uma camada).
  useEffect(() => {
    setVisao(visaoParaPontos(pontos, tamRef.current.largura, tamRef.current.altura));
    // Só reage à lista de ids; os pontos já são os do render atual. A seleção fica como está.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsChave]);

  // Enquadra uma lista de pontos pedida de fora (ex.: percurso de um veículo).
  useEffect(() => {
    if (!enquadrar || enquadrar.length === 0) return;
    setVisao(visaoParaPontos(enquadrar, tamRef.current.largura, tamRef.current.altura));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquadrar]);

  // Foco pedido de fora: centraliza no ponto, aproxima e abre o balão.
  useEffect(() => {
    if (!focar) return;
    const alvo = pontos.find((p) => p.id === focar.id);
    if (!alvo) return;
    setVisao({ z: 15, cx: mundoX(alvo.lng, 15), cy: mundoY(alvo.lat, 15) });
    setSelecionadoId(alvo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focar]);

  // Troca os blocos: mesmo zoom, na hora (blocos pendentes ficam cinza); zoom novo, só depois de carregar.
  useEffect(() => {
    const alvo = visao;
    if (alvo.z === blocosRef.current.z) {
      blocosRef.current = alvo;
      setBlocosVisao(alvo);
      return;
    }
    const blocos = blocosDaVisao(alvo, tamRef.current);
    let cancelado = false;
    let pendentes = blocos.length;
    const concluir = () => {
      if (cancelado) return;
      blocosRef.current = alvo;
      setBlocosVisao(alvo);
    };
    if (pendentes === 0) {
      concluir();
      return;
    }
    const fim = () => {
      pendentes -= 1;
      if (pendentes <= 0) concluir();
    };
    blocos.forEach((b) => {
      const imagem = new Image();
      imagem.onload = fim;
      imagem.onerror = fim;
      imagem.src = b.src;
    });
    return () => {
      cancelado = true;
    };
  }, [visao]);

  // Roda do mouse dá zoom (listener sem passive, para impedir a rolagem da página).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ultimo = 0;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      const agora = Date.now();
      if (agora - ultimo < 150) return;
      ultimo = agora;
      const dz = e.deltaY < 0 ? 1 : -1;
      setVisao((v) => zoomarVisao(v, dz));
    };
    el.addEventListener('wheel', aoRolar, { passive: false });
    return () => el.removeEventListener('wheel', aoRolar);
  }, []);

  function aoApontar(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    moveuRef.current = false;
    arrasteRef.current = { x: e.clientX, y: e.clientY, cx: visao.cx, cy: visao.cy, moveu: false };
  }

  function aoMover(e: ReactPointerEvent<HTMLDivElement>) {
    const a = arrasteRef.current;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (!a.moveu) {
      if (Math.hypot(dx, dy) < 4) return;
      a.moveu = true;
      moveuRef.current = true;
      setArrastando(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setVisao((v) => ({ ...v, cx: a.cx - dx, cy: a.cy - dy }));
  }

  function aoSoltar() {
    arrasteRef.current = null;
    setArrastando(false);
  }

  const { z, cx, cy } = visao;
  const x0 = cx - tam.largura / 2;
  const y0 = cy - tam.altura / 2;

  // Blocos da visão exibida (podem ser do zoom anterior até os novos carregarem).
  const bx0 = blocosVisao.cx - tam.largura / 2;
  const by0 = blocosVisao.cy - tam.altura / 2;
  const blocos: ReactElement[] = blocosDaVisao(blocosVisao, tam).map((b) => (
    <img
      key={`${blocosVisao.z}-${b.tx}-${b.ty}`}
      className="mapa-osm-tile"
      src={b.src}
      alt=""
      loading="eager"
      draggable={false}
      style={{ left: Math.round(b.tx * LADO - bx0), top: Math.round(b.ty * LADO - by0) }}
    />
  ));

  const selecionado = pontos.find((p) => p.id === selecionadoId) ?? null;

  return (
    <div
      ref={ref}
      className={`mapa-osm${arrastando ? ' mapa-osm-arrastando' : ''}`}
      style={{ height: altura }}
      onPointerDown={aoApontar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
      role="region"
      aria-label="Mapa"
    >
      <div className="mapa-osm-camada">{blocos}</div>

      {linhas && linhas.length > 0 && (
        <svg className="mapa-osm-linhas" width={tam.largura} height={tam.altura} aria-hidden="true">
          {linhas.map((linha, i) => {
            if (linha.pontos.length < 2) return null;
            const pts = linha.pontos
              .map((p) => `${Math.round((mundoX(p.lng, z) - x0) * 10) / 10},${Math.round((mundoY(p.lat, z) - y0) * 10) / 10}`)
              .join(' ');
            const espessura = linha.espessura ?? 4;
            return (
              <g key={i}>
                {linha.borda && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={espessura + 3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                <polyline
                  points={pts}
                  fill="none"
                  stroke={linha.cor ?? '#2563eb'}
                  strokeWidth={espessura}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={linha.tracejada ? '8 6' : undefined}
                />
              </g>
            );
          })}
        </svg>
      )}

      {pontos.map((p) => {
        const sx = mundoX(p.lng, z) - x0;
        const sy = mundoY(p.lat, z) - y0;
        return (
          <button
            key={p.id}
            type="button"
            className={`mapa-osm-pino mapa-osm-cor-${p.cor ?? 'azul'}`}
            style={{ left: sx, top: sy }}
            aria-label={p.titulo}
            onClick={() => {
              if (moveuRef.current) return;
              setSelecionadoId(p.id);
              aoClicarPonto?.(p.id);
            }}
          >
            <span className="mapa-osm-pino-conteudo">
              {p.rotulo ? (
                <b>{p.rotulo}</b>
              ) : p.icone ? (
                <Icone nome={p.icone} tamanho={16} />
              ) : null}
            </span>
          </button>
        );
      })}

      {selecionado && (
        <div
          className="mapa-osm-balao"
          style={{
            left: mundoX(selecionado.lng, z) - x0,
            top: mundoY(selecionado.lat, z) - y0,
          }}
          role="dialog"
          aria-label={selecionado.titulo}
        >
          <div className="mapa-osm-balao-texto">
            <strong>{selecionado.titulo}</strong>
            {selecionado.subtitulo && <span>{selecionado.subtitulo}</span>}
          </div>
          <button
            type="button"
            className="mapa-osm-balao-fechar"
            aria-label="Fechar"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setSelecionadoId(null)}
          >
            ×
          </button>
        </div>
      )}

      {pontos.length === 0 && <div className="mapa-osm-aviso">{avisoVazio}</div>}

      <div className="mapa-osm-controles" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="mapa-osm-botao" aria-label="Aproximar" onClick={() => setVisao((v) => zoomarVisao(v, 1))}>
          +
        </button>
        <button type="button" className="mapa-osm-botao" aria-label="Afastar" onClick={() => setVisao((v) => zoomarVisao(v, -1))}>
          −
        </button>
      </div>

      <div className="mapa-osm-atribuicao">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        {atribuicaoExtra ? ` · ${atribuicaoExtra}` : ''}
      </div>
    </div>
  );
}
