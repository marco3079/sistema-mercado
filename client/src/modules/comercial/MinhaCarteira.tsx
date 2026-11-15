import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Grade, Pagina, formatarMoeda } from '../../ui';
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

  return (
    <Pagina titulo="Minha carteira">
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !r ? (
        <Carregando />
      ) : (
        r && (
          <Grade>
            <Cartao>
              <div className="com-indicador">
                <span className="com-suave">Vendido no mês</span>
                <strong className="com-indicador-valor">{formatarMoeda(r.vendidoMes)}</strong>
                <span className="com-suave">{r.pedidosAbertos} pedido(s) em aberto</span>
              </div>
            </Cartao>
            <Cartao>
              <div className="com-indicador">
                <span className="com-suave">Comissão do mês</span>
                <strong className="com-indicador-valor">{formatarMoeda(r.comissaoMes)}</strong>
                <span className="com-suave">{r.comissaoPercentual}% sobre o faturado</span>
              </div>
            </Cartao>
            <Cartao>
              <div className="com-indicador">
                <span className="com-suave">Saldo de flex</span>
                <strong className={`com-indicador-valor ${r.saldoFlex < 0 ? 'com-flex-negativo' : 'com-flex-positivo'}`}>
                  {formatarMoeda(r.saldoFlex)}
                </strong>
                <span className="com-suave">Descontos acima da tabela consomem o saldo</span>
              </div>
            </Cartao>
          </Grade>
        )
      )}

      <Cartao titulo={`Clientes da carteira (${minhaCarteira.length})`}>
        <label className="campo">
          <span className="campo-rotulo">Buscar na carteira</span>
          <input
            className="com-input"
            type="search"
            placeholder="Nome ou cidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        {clientes.erro && <Aviso tipo="erro">{clientes.erro}</Aviso>}
        {clientes.carregando && !clientes.dados ? (
          <Carregando />
        ) : filtrados.length === 0 ? (
          <p className="com-suave">{minhaCarteira.length === 0 ? 'Nenhum cliente na sua carteira.' : 'Nenhum cliente encontrado.'}</p>
        ) : (
          <div className="com-carteira">
            {filtrados.map((c) => {
              const whats = linkWhatsapp(c.whatsapp ?? c.telefone);
              return (
                <div key={c.id} className="com-carteira-item">
                  <div>
                    <strong>{c.nome}</strong>
                    <div className="com-suave">
                      {[c.cidade, c.saldoDevedor > 0 ? `devendo ${formatarMoeda(c.saldoDevedor)}` : null]
                        .filter(Boolean)
                        .join(' · ') || 'Sem pendências'}
                    </div>
                  </div>
                  <div className="com-carteira-acoes">
                    <Botao aoClicar={() => navigate(`${raiz}/novo-pedido?cliente=${c.id}`)}>Novo pedido</Botao>
                    {whats ? (
                      <a className="botao botao-secundario" href={whats} target="_blank" rel="noopener noreferrer">
                        WhatsApp
                      </a>
                    ) : (
                      <span className="com-suave">Sem WhatsApp</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Cartao>
    </Pagina>
  );
}
