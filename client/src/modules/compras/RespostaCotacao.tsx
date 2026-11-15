import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, formatarData } from '../../ui';
import type { CotacaoPublica } from './tipos';

// Página pública da cotação (sem login e sem a casca do sistema). O fornecedor digita os preços pelo link.
interface LinhaPreco {
  preco: string;
  prazo: string;
}

function numeroParaTexto(n: number): string {
  return String(n).replace('.', ',');
}

export function RespostaCotacao() {
  const { token = '' } = useParams();
  const { dados, carregando, erro } = useDados<CotacaoPublica>(`/publico/cotacoes/${token}`);
  const [precos, setPrecos] = useState<Record<number, LinhaPreco>>({});
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    if (!dados) return;
    const inicial: Record<number, LinhaPreco> = {};
    for (const item of dados.itens) {
      inicial[item.produtoId] = {
        preco: item.precoRespondido !== null ? numeroParaTexto(item.precoRespondido) : '',
        prazo: item.prazoDias !== null ? String(item.prazoDias) : '',
      };
    }
    setPrecos(inicial);
  }, [dados]);

  function definir(produtoId: number, campo: keyof LinhaPreco, valor: string) {
    setPrecos((atual) => ({
      ...atual,
      [produtoId]: { preco: atual[produtoId]?.preco ?? '', prazo: atual[produtoId]?.prazo ?? '', [campo]: valor },
    }));
  }

  async function enviar() {
    setMensagem(null);
    const lista: { produtoId: number; preco: number; prazoDias?: number }[] = [];
    for (const item of dados?.itens ?? []) {
      const linha = precos[item.produtoId];
      if (!linha || linha.preco.trim() === '') continue;
      const preco = lerNumero(linha.preco);
      if (preco === null || preco < 0) {
        setMensagem(`Confira o preço de ${item.nome}.`);
        return;
      }
      const prazo = linha.prazo.trim() === '' ? undefined : lerNumero(linha.prazo);
      if (prazo !== undefined && (prazo === null || !Number.isInteger(prazo) || prazo < 0)) {
        setMensagem(`Confira o prazo de ${item.nome}. Use número inteiro de dias.`);
        return;
      }
      lista.push({ produtoId: item.produtoId, preco, prazoDias: prazo });
    }
    if (lista.length === 0) {
      setMensagem('Informe ao menos um preço.');
      return;
    }
    setEnviando(true);
    try {
      await api.post(`/publico/cotacoes/${token}`, { precos: lista });
      setEnviado(true);
    } catch (falha) {
      setMensagem(mensagemErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  const bloqueada = dados?.fechada === true;

  return (
    <main className="compras-publica">
      <div className="compras-publica-cartao">
        {carregando && !dados && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {dados && !enviado && (
          <>
            <header className="compras-publica-cabecalho">
              <h1>{dados.empresa}</h1>
              <p>Cotação: {dados.titulo}</p>
              <p>Fornecedor: {dados.fornecedor}</p>
              {dados.prazo && <p>Responder até {formatarData(dados.prazo)}</p>}
            </header>

            {bloqueada && <Aviso tipo="info">Esta cotação já foi fechada. Não é possível responder mais.</Aviso>}

            <div className="compras-rolagem compras-secao">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Produto</th>
                    <th scope="col" className="tabela-alinhar-direita">Quantidade</th>
                    <th scope="col" className="tabela-alinhar-direita">Seu preço (R$)</th>
                    <th scope="col" className="tabela-alinhar-direita">Prazo (dias)</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((item) => (
                    <tr key={item.produtoId}>
                      <td>{item.nome}</td>
                      <td className="tabela-alinhar-direita">
                        {item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unidade.toLowerCase()}
                      </td>
                      <td className="tabela-alinhar-direita">
                        <input
                          className="compras-input compras-input-curto"
                          inputMode="decimal"
                          disabled={bloqueada}
                          value={precos[item.produtoId]?.preco ?? ''}
                          onChange={(e) => definir(item.produtoId, 'preco', e.target.value)}
                          aria-label={`Seu preço de ${item.nome}`}
                        />
                      </td>
                      <td className="tabela-alinhar-direita">
                        <input
                          className="compras-input compras-input-curto"
                          inputMode="numeric"
                          disabled={bloqueada}
                          value={precos[item.produtoId]?.prazo ?? ''}
                          onChange={(e) => definir(item.produtoId, 'prazo', e.target.value)}
                          aria-label={`Prazo de entrega de ${item.nome}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mensagem && <Aviso tipo="erro">{mensagem}</Aviso>}
            <div className="compras-publica-acoes">
              <Botao aoClicar={() => void enviar()} desabilitado={enviando || bloqueada}>
                {enviando ? 'Enviando...' : 'Enviar preços'}
              </Botao>
            </div>
          </>
        )}

        {enviado && (
          <div className="compras-publica-obrigado">
            <h2>Obrigado!</h2>
            <p>Recebemos os seus preços para {dados?.empresa}.</p>
          </div>
        )}
      </div>
    </main>
  );
}
