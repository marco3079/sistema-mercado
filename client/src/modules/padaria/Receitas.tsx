import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { formatarPercentual } from '../../lib/mercado';
import { Aviso, Botao, Carregando, Pagina, Selo, formatarMoeda } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
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

function CartaoReceita({
  receita: r,
  podeEditar,
  aoEditar,
}: {
  receita: ReceitaDTO;
  podeEditar: boolean;
  aoEditar: () => void;
}) {
  return (
    <article className="cartao-produto padaria-receita">
      <FotoProduto foto={r.foto} nome={r.produto} setor={r.categoria} preencher />
      <div className="padaria-receita-topo">
        <strong className="padaria-receita-nome">{r.produto}</strong>
        <SeloMargem margem={r.margem} />
      </div>
      <dl className="padaria-cartao-dados">
        <div>
          <dt>Rendimento</dt>
          <dd className="numero">
            {r.rendimento.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {r.unidade.toLowerCase()}
          </dd>
        </div>
        <div>
          <dt>Custo unitário</dt>
          <dd className="numero">{formatarMoeda(r.custoUnitario)}</dd>
        </div>
        <div>
          <dt>Preço de venda</dt>
          <dd className="numero">{r.precoVenda > 0 ? formatarMoeda(r.precoVenda) : '—'}</dd>
        </div>
      </dl>
      <p className="padaria-cartao-tempos">
        <Icone nome="relogio" tamanho={14} />
        {descreverTempos(r)}
      </p>
      <div className="cartao-produto-rodape">
        <span className="padaria-ajuda">{r.itens.length} insumo(s)</span>
        {podeEditar && (
          <Botao variante="secundario" aoClicar={aoEditar}>
            Editar
          </Botao>
        )}
      </div>
    </article>
  );
}

export function Receitas() {
  const { usuario } = useAuth();
  // Estoquista só consulta; padeiro e gestor criam e editam.
  const podeEditar = usuario?.perfil === 'PADEIRO' || usuario?.perfil === 'GESTOR';
  const receitas = useDados<ReceitaDTO[]>('/receitas');
  const [editando, setEditando] = useState<ReceitaDTO | 'nova' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = receitas.dados ?? [];

  return (
    <Pagina
      titulo="Receitas"
      acoes={podeEditar ? <Botao aoClicar={() => setEditando('nova')}>Nova receita</Botao> : undefined}
    >
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {receitas.erro && <Aviso tipo="erro">{receitas.erro}</Aviso>}
      {receitas.carregando && !receitas.dados && <Carregando />}

      {receitas.dados && lista.length === 0 && <p className="tabela-vazia">Nenhuma receita cadastrada.</p>}

      {lista.length > 0 && (
        <div className="grade-produtos">
          {lista.map((r) => (
            <CartaoReceita key={r.id} receita={r} podeEditar={podeEditar} aoEditar={() => setEditando(r)} />
          ))}
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
