import type React from 'react';
import { useState } from 'react';
import { Icone } from './icones';
import type { NomeIcone } from './icones';
import './foto-produto.css';

// Foto do produto (URL /produtos/<codigo>.jpg, http(s) ou data URL). Sem foto, ou se a imagem não carregar,
// mostra um quadro colorido com o ícone do setor/categoria. Use em listas, cartões, PDV, promoções e no delivery.
//
// tamanho: lado em px (quadrado). Com `preencher`, ocupa 100% da largura do pai e fica quadrada.

const POR_SETOR: { teste: RegExp; icone: NomeIcone; cor: string }[] = [
  { teste: /padaria|confeitaria|insumo/i, icone: 'pao', cor: 'laranja' },
  { teste: /hortifr|fruta|verdura|legume/i, icone: 'carrinho', cor: 'verde' },
  { teste: /a[çc]ougue|carne/i, icone: 'pacote', cor: 'vermelho' },
  { teste: /frios|latic/i, icone: 'pacote', cor: 'amarelo' },
  { teste: /bebida/i, icone: 'pacote', cor: 'azul' },
  { teste: /limpeza/i, icone: 'pacote', cor: 'roxo' },
  { teste: /higiene/i, icone: 'pacote', cor: 'roxo' },
];

function estiloDoSetor(setor?: string | null): { icone: NomeIcone; cor: string } {
  const achado = setor ? POR_SETOR.find((s) => s.teste.test(setor)) : undefined;
  return achado ?? { icone: 'carrinho', cor: 'azul' };
}

export function FotoProduto({
  foto,
  nome,
  setor,
  tamanho = 48,
  preencher = false,
  className,
}: {
  foto?: string | null;
  nome: string;
  setor?: string | null; // nome da categoria ou do setor, para escolher a ilustração
  tamanho?: number;
  preencher?: boolean;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const classes = ['foto-produto', preencher ? 'foto-produto-preencher' : '', className ?? ''].join(' ').trim();
  const estilo = preencher ? undefined : { width: tamanho, height: tamanho };
  const { icone, cor } = estiloDoSetor(setor);
  const temFoto = Boolean(foto) && !falhou;

  // A ilustração do setor fica sempre por baixo; a foto aparece por cima só quando termina de carregar.
  // Assim, foto lenta ou inexistente nunca mostra o ícone de imagem quebrada.
  return (
    <span
      className={`${classes} ${temFoto && carregou ? '' : `foto-produto-vazia foto-produto-${cor}`}`.trim()}
      style={estilo}
      role="img"
      aria-label={nome}
    >
      {!(temFoto && carregou) && (
        <Icone nome={icone} tamanho={preencher ? 48 : Math.max(16, Math.round(tamanho * 0.45))} />
      )}
      {temFoto && (
        <img
          key={foto ?? ''}
          src={foto ?? undefined}
          alt=""
          loading="lazy"
          className={carregou ? 'foto-produto-img carregada' : 'foto-produto-img'}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 0) setCarregou(true);
            else setFalhou(true);
          }}
          onError={() => setFalhou(true)}
        />
      )}
    </span>
  );
}

// Célula de produto para tabelas e listas: foto + nome em negrito + linha secundária (código · EAN, marca...).
export function CelulaProduto({
  foto,
  nome,
  setor,
  detalhe,
  extra,
  tamanho = 40,
}: {
  foto?: string | null;
  nome: string;
  setor?: string | null;
  detalhe?: string | null; // ex.: "PR0021 · 7890000000215"
  extra?: React.ReactNode; // selos ao lado do nome (ex.: PLU, promoção)
  tamanho?: number;
}) {
  return (
    <span className="celula-produto">
      <FotoProduto foto={foto} nome={nome} setor={setor} tamanho={tamanho} />
      <span className="celula-produto-texto">
        <span className="celula-produto-nome">
          {nome}
          {extra}
        </span>
        {detalhe && <span className="celula-produto-detalhe">{detalhe}</span>}
      </span>
    </span>
  );
}

// Barra de nível (estoque × mínimo/máximo, ocupação, progresso). valor e maximo na mesma unidade.
export function BarraNivel({ valor, maximo, cor }: { valor: number; maximo: number; cor?: 'verde' | 'amarelo' | 'vermelho' | 'azul' }) {
  const pct = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <span className={`barra-nivel barra-nivel-${cor ?? 'azul'}`} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
