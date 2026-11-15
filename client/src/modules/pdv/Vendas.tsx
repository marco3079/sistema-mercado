import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { ROTULOS_FORMA_PAGAMENTO, ROTULOS_ORIGEM_VENDA, hojeIso } from '../../lib/mercado';
import { Aviso, Campo, Carregando, Pagina, Selecao, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { VendaListaDTO } from './tipos';

// Vendas do período. OPERADOR vê só as próprias (o servidor filtra). Clique abre o detalhe.

const ORIGENS = Object.entries(ROTULOS_ORIGEM_VENDA).map(([valor, rotulo]) => ({ valor, rotulo }));
const SITUACOES = [
  { valor: 'CONCLUIDA', rotulo: 'Concluída' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
];

export function Vendas() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [inicio, setInicio] = useState(hojeIso(-29));
  const [fim, setFim] = useState(hojeIso(0));
  const [origem, setOrigem] = useState('');
  const [status, setStatus] = useState('');

  const params = new URLSearchParams({ inicio, fim });
  if (origem) params.set('origem', origem);
  if (status) params.set('status', status);
  const vendas = useDados<VendaListaDTO[]>(`/vendas?${params.toString()}`);

  return (
    <Pagina titulo="Vendas">
      <div className="pdv-filtros">
        <Campo rotulo="De" tipo="date" valor={inicio} aoMudar={setInicio} />
        <Campo rotulo="Até" tipo="date" valor={fim} aoMudar={setFim} />
        <Selecao rotulo="Origem" valor={origem} aoMudar={setOrigem} opcoes={ORIGENS} vazio="Todas" />
        <Selecao rotulo="Situação" valor={status} aoMudar={setStatus} opcoes={SITUACOES} vazio="Todas" />
      </div>

      {vendas.carregando && vendas.dados === null && <Carregando />}
      {vendas.erro && <Aviso tipo="erro">{vendas.erro}</Aviso>}
      {vendas.dados && (
        <Tabela
          colunas={[
            { titulo: 'Nº', celula: (v: VendaListaDTO) => v.numero },
            { titulo: 'Data', celula: (v: VendaListaDTO) => formatarDataHora(v.criadoEm) },
            {
              titulo: 'Origem',
              celula: (v: VendaListaDTO) => <Selo cor="azul">{ROTULOS_ORIGEM_VENDA[v.origem] ?? v.origem}</Selo>,
            },
            { titulo: 'Cliente', celula: (v: VendaListaDTO) => v.cliente?.nome ?? 'Consumidor' },
            { titulo: 'Operador', celula: (v: VendaListaDTO) => v.operador },
            {
              titulo: 'Formas',
              celula: (v: VendaListaDTO) => v.formas.map((f) => ROTULOS_FORMA_PAGAMENTO[f] ?? f).join(', ') || '—',
            },
            {
              titulo: 'Total',
              alinhar: 'direita',
              celula: (v: VendaListaDTO) => formatarMoeda(v.total),
            },
            {
              titulo: 'Situação',
              celula: (v: VendaListaDTO) =>
                v.status === 'CANCELADA' ? <Selo cor="vermelho">Cancelada</Selo> : <Selo cor="verde">Concluída</Selo>,
            },
          ]}
          dados={vendas.dados}
          chave={(v) => v.id}
          vazio="Nenhuma venda neste período."
          aoClicarLinha={(v) => navigate(`${RAIZ_DO_PERFIL[usuario?.perfil ?? 'OPERADOR']}/vendas/${v.id}`)}
        />
      )}
    </Pagina>
  );
}
