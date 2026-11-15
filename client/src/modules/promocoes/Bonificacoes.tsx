import { useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarQuantidade, hojeIso, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Carregando, Cartao, Pagina, Tabela, formatarMoeda } from '../../ui';
import type { BonificacaoItemDTO, BonificacoesDTO, LancamentoBonificacaoDTO } from './tipos';
import './promocoes.css';

// Primeiro dia do mês atual (AAAA-MM-DD), para o período padrão.
function primeiroDiaDoMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Bonificação que a indústria paga por unidade vendida das promoções dela. Só o gestor.
export function Bonificacoes() {
  const [inicio, setInicio] = useState(primeiroDiaDoMes);
  const [fim, setFim] = useState(hojeIso());
  const [lancando, setLancando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const periodoValido = inicio !== '' && fim !== '' && inicio <= fim;
  const bonificacoes = useDados<BonificacoesDTO>(
    periodoValido ? `/promocoes/bonificacoes?inicio=${inicio}&fim=${fim}` : null,
  );
  const dados = bonificacoes.dados;

  // Agrupa as promoções por indústria, para lançar cada uma no financeiro.
  const grupos = new Map<string, BonificacaoItemDTO[]>();
  for (const item of dados?.itens ?? []) {
    const lista = grupos.get(item.industria) ?? [];
    lista.push(item);
    grupos.set(item.industria, lista);
  }

  async function lancar(industria: string, total: number) {
    if (!window.confirm(`Lançar ${formatarMoeda(total)} de bonificação da ${industria} no financeiro? Vence em 30 dias.`)) {
      return;
    }
    setErro(null);
    setAviso(null);
    setLancando(industria);
    try {
      const lancado = await api.post<LancamentoBonificacaoDTO>('/promocoes/bonificacoes/lancar', {
        inicio,
        fim,
        industria,
      });
      setAviso(`Lançado no financeiro: ${lancado.descricao}, ${formatarMoeda(lancado.valor)}.`);
      bonificacoes.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setLancando(null);
    }
  }

  return (
    <Pagina titulo="Bonificação da indústria">
      <div className="bonificacoes-filtros">
        <Campo rotulo="Início" tipo="date" valor={inicio} aoMudar={setInicio} />
        <Campo rotulo="Fim" tipo="date" valor={fim} aoMudar={setFim} />
      </div>

      {!periodoValido && <Aviso tipo="erro">O início precisa ser antes do fim.</Aviso>}
      {dados?.simulado && (
        <Aviso tipo="info">
          Integração Scantech simulada: os valores são uma estimativa e nada é enviado à indústria.
        </Aviso>
      )}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {bonificacoes.erro && <Aviso tipo="erro">{bonificacoes.erro}</Aviso>}
      {bonificacoes.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="bonificacoes-total">
            <Cartao titulo="Total a receber no período">
              <strong className="bonificacoes-total-valor">{formatarMoeda(dados.total)}</strong>
              <span>
                {dados.itens.length === 1 ? '1 promoção com indústria' : `${dados.itens.length} promoções com indústria`}
              </span>
            </Cartao>
          </div>

          {grupos.size === 0 && <p className="tabela-vazia">Nenhuma promoção com bonificação neste período.</p>}

          {Array.from(grupos.entries()).map(([industria, itens]) => {
            const totalGrupo = itens.reduce((soma, i) => soma + i.valorAReceber, 0);
            return (
              <Cartao key={industria} titulo={industria}>
                <Tabela
                  dados={itens}
                  chave={(i) => i.promocaoId}
                  colunas={[
                    { titulo: 'Promoção', celula: (i) => i.nome },
                    { titulo: 'Unidades vendidas', alinhar: 'direita', celula: (i) => formatarQuantidade(i.unidadesVendidas) },
                    {
                      titulo: 'Bonificação por unidade',
                      alinhar: 'direita',
                      celula: (i) => formatarMoeda(i.bonificacaoUnidade),
                    },
                    {
                      titulo: 'A receber',
                      alinhar: 'direita',
                      celula: (i) => <strong>{formatarMoeda(i.valorAReceber)}</strong>,
                    },
                  ]}
                />
                <div className="bonificacoes-rodape">
                  <span>
                    Total da {industria}: <strong>{formatarMoeda(totalGrupo)}</strong>
                  </span>
                  <Botao
                    desabilitado={lancando !== null || totalGrupo <= 0}
                    aoClicar={() => lancar(industria, totalGrupo)}
                  >
                    {lancando === industria ? 'Lançando...' : 'Lançar no financeiro'}
                  </Botao>
                </div>
              </Cartao>
            );
          })}
        </>
      )}
    </Pagina>
  );
}
