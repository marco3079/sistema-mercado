import { useId } from 'react';
import type { EntregaDTO, LojaRotaDTO } from './tipos';
import { Icone } from '../../ui/icones';

// Mapa simples em SVG: projeta as coordenadas num retângulo com grade suave e liga as paradas na ordem.
// A loja aparece como quadrado destacado com nome; cada parada é um círculo com o número da sequência.
// Sem mapa externo (não há chave de mapa no sistema).

const LARGURA = 640;
const ALTURA = 420;
const MARGEM = 48;

interface Ponto {
  lat: number;
  lng: number;
}

export function MapaRota({ loja, paradas }: { loja: LojaRotaDTO | null; paradas: EntregaDTO[] }) {
  // id sem dois-pontos (o useId devolve ":r0:") para a referência url(#...) funcionar em todos os navegadores.
  const idGrade = 'logistica-grade-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const lojaPonto: Ponto | null =
    loja && loja.latitude !== null && loja.longitude !== null
      ? { lat: loja.latitude, lng: loja.longitude }
      : null;

  const comCoordenadas = paradas
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p, indice) => ({
      numero: p.ordem ?? indice + 1,
      codigo: p.codigo,
      destinatario: p.destinatario,
      ponto: { lat: p.latitude as number, lng: p.longitude as number },
    }));

  if (!lojaPonto && comCoordenadas.length === 0) {
    return (
      <div className="logistica-mapa-vazio">
        <Icone nome="mapa" tamanho={28} />
        <p className="logistica-vazio">
          Sem coordenadas para desenhar o mapa. Informe a latitude e a longitude das entregas e da loja.
        </p>
      </div>
    );
  }

  const todos: Ponto[] = [...(lojaPonto ? [lojaPonto] : []), ...comCoordenadas.map((c) => c.ponto)];
  const minLat = Math.min(...todos.map((p) => p.lat));
  const maxLat = Math.max(...todos.map((p) => p.lat));
  const minLng = Math.min(...todos.map((p) => p.lng));
  const maxLng = Math.max(...todos.map((p) => p.lng));
  // Vão mínimo para um ponto só não dividir por zero.
  const vaoLat = Math.max(maxLat - minLat, 0.0005);
  const vaoLng = Math.max(maxLng - minLng, 0.0005);

  const x = (p: Ponto) => MARGEM + ((p.lng - minLng) / vaoLng) * (LARGURA - 2 * MARGEM);
  const y = (p: Ponto) => ALTURA - MARGEM - ((p.lat - minLat) / vaoLat) * (ALTURA - 2 * MARGEM);

  // Trajeto: loja -> paradas na ordem -> loja.
  const trajeto: Ponto[] = [
    ...(lojaPonto ? [lojaPonto] : []),
    ...comCoordenadas.map((c) => c.ponto),
    ...(lojaPonto ? [lojaPonto] : []),
  ];
  const pontosDaLinha = trajeto.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');

  const nomeLoja = loja?.nome ?? 'Loja';
  const larguraRotulo = nomeLoja.length * 7.5 + 16;

  return (
    <svg
      className="logistica-mapa"
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      role="img"
      aria-label="Trajeto da rota no mapa"
    >
      <defs>
        <pattern id={idGrade} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" className="logistica-mapa-grade" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={LARGURA} height={ALTURA} rx="12" className="logistica-mapa-fundo" />
      <rect x="0" y="0" width={LARGURA} height={ALTURA} rx="12" fill={`url(#${idGrade})`} />

      {trajeto.length > 1 && <polyline points={pontosDaLinha} className="logistica-mapa-linha" />}

      {lojaPonto && (
        <g>
          <rect
            x={x(lojaPonto) - 12}
            y={y(lojaPonto) - 12}
            width="24"
            height="24"
            rx="6"
            className="logistica-mapa-loja"
          >
            <title>{nomeLoja}</title>
          </rect>
          <rect
            x={x(lojaPonto) + 18}
            y={y(lojaPonto) - 12}
            width={larguraRotulo}
            height="22"
            rx="11"
            className="logistica-mapa-rotulo-fundo"
          />
          <text x={x(lojaPonto) + 26} y={y(lojaPonto) + 4} className="logistica-mapa-texto">
            {nomeLoja}
          </text>
        </g>
      )}

      {comCoordenadas.map((c) => (
        <g key={c.codigo}>
          <title>{`${c.numero}. ${c.destinatario} (${c.codigo})`}</title>
          <circle cx={x(c.ponto)} cy={y(c.ponto)} r="14" className="logistica-mapa-parada" />
          <text x={x(c.ponto)} y={y(c.ponto) + 4.5} className="logistica-mapa-numero" textAnchor="middle">
            {c.numero}
          </text>
        </g>
      ))}
    </svg>
  );
}
