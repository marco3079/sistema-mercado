import type { EntregaDTO, LojaRotaDTO } from './tipos';

// Mapa simples em SVG: projeta as coordenadas num retângulo e liga as paradas na ordem.
// A loja aparece como quadrado; cada parada é um círculo com o número da sequência. Sem mapa externo.

const LARGURA = 600;
const ALTURA = 360;
const MARGEM = 36;

interface Ponto {
  lat: number;
  lng: number;
}

export function MapaRota({ loja, paradas }: { loja: LojaRotaDTO | null; paradas: EntregaDTO[] }) {
  const lojaPonto: Ponto | null =
    loja && loja.latitude !== null && loja.longitude !== null
      ? { lat: loja.latitude, lng: loja.longitude }
      : null;

  const comCoordenadas = paradas
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p, indice) => ({
      numero: p.ordem ?? indice + 1,
      codigo: p.codigo,
      ponto: { lat: p.latitude as number, lng: p.longitude as number },
    }));

  if (!lojaPonto && comCoordenadas.length === 0) {
    return (
      <p className="logistica-vazio">
        Sem coordenadas para desenhar o mapa. Informe a latitude e a longitude das entregas e da loja.
      </p>
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

  return (
    <svg
      className="logistica-mapa"
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      role="img"
      aria-label="Trajeto da rota no mapa"
    >
      <rect x="0" y="0" width={LARGURA} height={ALTURA} className="logistica-mapa-fundo" />
      {trajeto.length > 1 && <polyline points={pontosDaLinha} className="logistica-mapa-linha" />}
      {lojaPonto && (
        <g>
          <rect
            x={x(lojaPonto) - 9}
            y={y(lojaPonto) - 9}
            width="18"
            height="18"
            className="logistica-mapa-loja"
          />
          <text x={x(lojaPonto) + 14} y={y(lojaPonto) + 4} className="logistica-mapa-texto">
            {loja?.nome ?? 'Loja'}
          </text>
        </g>
      )}
      {comCoordenadas.map((c) => (
        <g key={c.codigo}>
          <circle cx={x(c.ponto)} cy={y(c.ponto)} r="12" className="logistica-mapa-parada" />
          <text x={x(c.ponto)} y={y(c.ponto) + 4} className="logistica-mapa-numero" textAnchor="middle">
            {c.numero}
          </text>
        </g>
      ))}
    </svg>
  );
}
