import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Avatar, Aviso, Botao, Campo, Carregando, Cartao, MenuAcoes, Pagina, Selo, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import type { ClienteResumo, ResumoVendedor } from './tipos';
import { soDigitos } from './tipos';
import './comercial.css';

// Minha carteira (vendedor): resumo do mês, saldo de flex e os clientes sob seus cuidados.

function linkWhatsapp(texto: string | null): string | null {
  const digitos = soDigitos(texto ?? '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}`;
}

export function MinhaCarteira() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const raiz = usuario ? RAIZ_DO_PERFIL[usuario.perfil] : '/vendedor';
  const [busca, setBusca] = useState('');
  const resumo = useDados<ResumoVendedor>('/vendedor/resumo');
  const clientes = useDados<ClienteResumo[]>('/clientes');

  const minhaCarteira = (clientes.dados ?? []).filter((c) => c.vendedorId === usuario?.id);
  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? minhaCarteira.filter((c) => c.nome.toLowerCase().includes(termo) || (c.cidade ?? '').toLowerCase().includes(termo))
    : minhaCarteira;

  const r = resumo.dados;
  const indicadores: { rotulo: string; valor: string; detalhe: string; icone: NomeIcone; cor: string }[] = r
    ? [
        {
          rotulo: 'Vendido no mês',
          valor: formatarMoeda(r.vendidoMes),
          detalhe: `${r.pedidosAbertos} pedido(s) em aberto`,
          icone: 'dinheiro',
          cor: 'verde',
        },
        {
          rotulo: 'Comissão do mês',
          valor: formatarMoeda(r.comissaoMes),
          detalhe: `${r.comissaoPercentual}% sobre o faturado`,
          icone: 'porcentagem',
          cor: 'azul',
        },
        {
          rotulo: 'Saldo de flex',
          valor: formatarMoeda(r.saldoFlex),
          detalhe: 'Descontos acima da tabela consomem o saldo',
          icone: 'raio',
          cor: r.saldoFlex < 0 ? 'vermelho' : 'roxo',
        },
      ]
    : [];

  return (
    <Pagina titulo="Minha carteira">
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !r ? (
        <Carregando />
      ) : (
        r && (
          <div className="resumo">
            {indicadores.map((i) => (
              <div className="resumo-item" key={i.rotulo}>
                <span className={`resumo-icone resumo-icone-${i.cor}`}>
                  <Icone nome={i.icone} tamanho={24} />
                </span>
                <div>
                  <span className="resumo-valor">{i.valor}</span>
                  <span className="resumo-rotulo">{i.rotulo}</span>
                  <span className="com-suave">{i.detalhe}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Cartao titulo={`Clientes da carteira (${minhaCarteira.length})`}>
        <div className="barra-ferramentas">
          <div className="filtros">
            <Campo rotulo="Buscar por nome ou cidade" valor={busca} aoMudar={setBusca} />
          </div>
        </div>

        {clientes.erro && <Aviso tipo="erro">{clientes.erro}</Aviso>}
        {clientes.carregando && !clientes.dados ? (
          <Carregando />
        ) : filtrados.length === 0 ? (
          <p className="com-suave">{minhaCarteira.length === 0 ? 'Nenhum cliente na sua carteira.' : 'Nenhum cliente encontrado.'}</p>
        ) : (
          <div className="com-grade-clientes">
            {filtrados.map((c) => {
              const whats = linkWhatsapp(c.whatsapp ?? c.telefone);
              return (
                <article key={c.id} className="com-cliente-card">
                  <div className="com-cliente-card-topo">
                    <Avatar nome={c.nome} tamanho={44} />
                    <div className="com-identidade">
                      <strong>{c.nome}</strong>
                      <span className="com-suave">{c.cidade ?? 'Sem cidade'}</span>
                    </div>
                  </div>
                  <div>
                    {c.saldoDevedor > 0 ? (
                      <Selo cor="vermelho">Devendo {formatarMoeda(c.saldoDevedor)}</Selo>
                    ) : (
                      <Selo cor="verde">Sem pendências</Selo>
                    )}
                  </div>
                  <div className="com-cliente-card-rodape">
                    <Botao aoClicar={() => navigate(`${raiz}/novo-pedido?cliente=${c.id}`)}>Novo pedido</Botao>
                    {whats ? (
                      <MenuAcoes
                        rotulo={`Mais ações de ${c.nome}`}
                        acoes={[{ rotulo: 'Abrir WhatsApp', icone: 'chat', aoClicar: () => window.open(whats, '_blank', 'noopener,noreferrer') }]}
                      />
                    ) : (
                      <span className="com-suave">Sem WhatsApp</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Cartao>
    </Pagina>
  );
}
