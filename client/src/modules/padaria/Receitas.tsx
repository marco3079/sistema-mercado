import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { formatarPercentual } from '../../lib/mercado';
import { Aviso, Botao, Carregando, Pagina, Selo, formatarMoeda } from '../../ui';
import { FichaReceita } from './FichaReceita';
import type { ReceitaDTO } from './tipos';

// Margem (% sobre o preço de venda): verde a partir de 30, amarelo a partir de 15.
function SeloMargem({ margem }: { margem: number | null }) {
  if (margem === null) return <Selo cor="cinza">Sem preço</Selo>;
  const cor = margem >= 30 ? 'verde' : margem >= 15 ? 'amarelo' : 'vermelho';
  return <Selo cor={cor}>Margem {formatarPercentual(margem)}</Selo>;
}

function descreverTempos(r: ReceitaDTO): string {
  const partes: string[] = [];
  if (r.tempoPreparoMin !== null) partes.push(`Preparo ${r.tempoPreparoMin} min`);
  if (r.tempoFornoMin !== null) partes.push(`Forno ${r.tempoFornoMin} min`);
  if (r.temperaturaForno !== null) partes.push(`${r.temperaturaForno} °C`);
  return partes.length > 0 ? partes.join(' · ') : 'Sem tempos cadastrados';
}

export function Receitas() {
  const { usuario } = useAuth();
  // Estoquista só consulta; padeiro e gestor criam e editam.
  const podeEditar = usuario?.perfil === 'PADEIRO' || usuario?.perfil === 'GESTOR';
  const receitas = useDados<ReceitaDTO[]>('/receitas');
  const [editando, setEditando] = useState<ReceitaDTO | 'nova' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = receitas.dados ?? [];

  const cartao = (r: ReceitaDTO) => (
    <>
      <div className="padaria-cartao-topo">
        <span className="padaria-cartao-produto">{r.produto}</span>
        <SeloMargem margem={r.margem} />
      </div>
      <dl className="padaria-cartao-dados">
        <div>
          <dt>Rendimento</dt>
          <dd>
            {r.rendimento.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {r.unidade.toLowerCase()}
          </dd>
        </div>
        <div>
          <dt>Custo unitário</dt>
          <dd>{formatarMoeda(r.custoUnitario)}</dd>
        </div>
        <div>
          <dt>Preço de venda</dt>
          <dd>{r.precoVenda > 0 ? formatarMoeda(r.precoVenda) : '—'}</dd>
        </div>
      </dl>
      <p className="padaria-cartao-tempos">{descreverTempos(r)}</p>
      <p className="padaria-cartao-rodape">{r.itens.length} insumo(s) na receita</p>
    </>
  );

  return (
    <Pagina
      titulo="Receitas"
      acoes={podeEditar ? <Botao aoClicar={() => setEditando('nova')}>Nova receita</Botao> : undefined}
    >
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {receitas.erro && <Aviso tipo="erro">{receitas.erro}</Aviso>}
      {receitas.carregando && !receitas.dados && <Carregando />}

      {receitas.dados && lista.length === 0 && (
        <p className="tabela-vazia">Nenhuma receita cadastrada.</p>
      )}

      {lista.length > 0 && (
        <div className="padaria-cartoes">
          {lista.map((r) =>
            podeEditar ? (
              <button key={r.id} type="button" className="padaria-cartao" onClick={() => setEditando(r)}>
                {cartao(r)}
              </button>
            ) : (
              <article key={r.id} className="padaria-cartao padaria-cartao-leitura">
                {cartao(r)}
              </article>
            )
          )}
        </div>
      )}

      {editando && (
        <FichaReceita
          receita={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            receitas.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
