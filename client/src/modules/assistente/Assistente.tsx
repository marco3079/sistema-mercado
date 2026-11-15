import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import { Icone } from '../../ui/icones';
import type { CartaoResposta, FonteResposta, ItemHistorico, Mensagem, RespostaAssistente } from './tipos';

// Assistente IA: tela de conversa. Responde por regras (sem chave) ou pela IA (com chave configurada).

export function Assistente() {
  const historico = useDados<ItemHistorico[]>('/assistente/historico');
  const exemplos = useDados<string[]>('/assistente/exemplos');
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [historicoCarregado, setHistoricoCarregado] = useState(false);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [fonte, setFonte] = useState<FonteResposta>('regras');
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const fimRef = useRef<HTMLDivElement>(null);

  // Histórico: entra uma vez, antes das mensagens novas.
  useEffect(() => {
    if (historico.dados === null || historicoCarregado) return;
    const antigas = [...historico.dados].reverse().flatMap((item): Mensagem[] => [
      { id: `h-${item.id}-p`, papel: 'usuario', texto: item.pergunta },
      { id: `h-${item.id}-r`, papel: 'assistente', texto: item.resposta },
    ]);
    setMensagens((atuais) => [...antigas, ...atuais]);
    setHistoricoCarregado(true);
  }, [historico.dados, historicoCarregado]);

  // Rola até a última mensagem sempre que a conversa muda.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens, pensando]);

  async function enviar(pergunta: string) {
    const limpa = pergunta.trim();
    if (!limpa || pensando) return;
    const base = Date.now().toString(36);
    setErro(null);
    setTexto('');
    setSugestoes([]);
    setMensagens((atuais) => [...atuais, { id: `u-${base}`, papel: 'usuario', texto: limpa }]);
    setPensando(true);
    try {
      const resposta = await api.post<RespostaAssistente>('/assistente/perguntar', { pergunta: limpa });
      setMensagens((atuais) => [
        ...atuais,
        {
          id: `a-${base}`,
          papel: 'assistente',
          texto: resposta.resposta,
          cartoes: resposta.cartoes,
          fonte: resposta.fonte,
        },
      ]);
      setFonte(resposta.fonte);
      setSugestoes(resposta.sugestoes);
    } catch (e) {
      setErro(mensagemErro(e));
      setTexto(limpa);
    } finally {
      setPensando(false);
    }
  }

  function aoEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void enviar(texto);
  }

  const vazio = mensagens.length === 0;

  const perguntasRapidas = exemplos.dados ?? [];

  return (
    <Pagina
      titulo="Assistente IA"
      acoes={
        <span className="assistente-fonte">
          <Icone nome="robo" tamanho={18} />
          {fonte === 'ia' ? 'Respondendo com IA' : 'Respondendo por regras'}
        </span>
      }
    >
      <div className="assistente-layout">
        <section className="assistente-chat">
          {historico.erro && <Aviso tipo="erro">{historico.erro}</Aviso>}

          <div className="assistente-mensagens" role="log" aria-live="polite">
            {historico.carregando && <Carregando />}
            {vazio && !historico.carregando && (
              <div className="assistente-boas-vindas">
                <span className="assistente-boas-vindas-icone">
                  <Icone nome="robo" tamanho={36} />
                </span>
                <h2>Pergunte sobre o seu mercado</h2>
                <p>Vendas, lucro, estoque, validade, fiado, compras, produção e entregas. Escolha uma pergunta ao lado ou escreva a sua.</p>
              </div>
            )}

            {mensagens.map((mensagem) => (
              <Bolha key={mensagem.id} mensagem={mensagem} />
            ))}

            {pensando && (
              <div className="assistente-linha">
                <span className="assistente-avatar"><Icone nome="robo" tamanho={18} /></span>
                <div className="assistente-bolha assistente-bolha-resposta assistente-pensando">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={fimRef} />
          </div>

          {sugestoes.length > 0 && !pensando && (
            <div className="assistente-chips assistente-sugestoes">
              {sugestoes.map((sugestao) => (
                <button key={sugestao} type="button" className="assistente-chip" onClick={() => void enviar(sugestao)}>
                  {sugestao}
                </button>
              ))}
            </div>
          )}

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          <form className="assistente-formulario" onSubmit={aoEnviar}>
            <input
              className="assistente-campo"
              type="text"
              value={texto}
              maxLength={500}
              disabled={pensando}
              placeholder="Pergunte algo, por exemplo: quanto vendi hoje?"
              aria-label="Sua pergunta"
              onChange={(e) => setTexto(e.target.value)}
            />
            <Botao tipo="submit" desabilitado={pensando || texto.trim() === ''}>
              <Icone nome="enviar" tamanho={18} />
              Enviar
            </Botao>
          </form>
        </section>

        <aside className="assistente-lateral">
          <h2>Perguntas rápidas</h2>
          <div className="assistente-rapidas">
            {perguntasRapidas.map((exemplo) => (
              <button
                key={exemplo}
                type="button"
                className="assistente-rapida"
                disabled={pensando}
                onClick={() => void enviar(exemplo)}
              >
                <Icone nome="chat" tamanho={16} />
                <span>{exemplo}</span>
              </button>
            ))}
          </div>
          <p className="assistente-dica">
            {fonte === 'ia'
              ? 'As respostas usam IA sobre os dados do sistema.'
              : 'Sem chave de IA configurada, as respostas seguem regras sobre os dados do sistema. Configure em Configurações > Mercado > Assistente IA.'}
          </p>
        </aside>
      </div>
    </Pagina>
  );
}

// Quando a resposta traz tabelas, o texto mostra só o resumo (a primeira frase);
// as listas numeradas já aparecem nas tabelas, sem repetir.
function resumoDoTexto(texto: string, temCartoes: boolean): string {
  if (!temCartoes) return texto;
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const semListas = linhas.filter((l) => !/^\d+[.)]\s/.test(l) && !/^[-•]\s/.test(l) && !/:$/.test(l));
  return (semListas[0] ?? linhas[0] ?? texto).trim();
}

function Bolha({ mensagem }: { mensagem: Mensagem }) {
  const usuario = mensagem.papel === 'usuario';
  const cartoes = (mensagem.cartoes ?? []).filter((c) => c.linhas.length > 0);
  return (
    <div className={`assistente-linha${usuario ? ' assistente-linha-usuario' : ''}`}>
      {!usuario && (
        <span className="assistente-avatar">
          <Icone nome="robo" tamanho={18} />
        </span>
      )}
      <div className={`assistente-bolha ${usuario ? 'assistente-bolha-usuario' : 'assistente-bolha-resposta'}`}>
        <div className="assistente-texto">{usuario ? mensagem.texto : resumoDoTexto(mensagem.texto, cartoes.length > 0)}</div>
        {cartoes.length > 0 && (
          <div className="assistente-cartoes">
            {cartoes.map((cartao) => (
              <MiniTabela key={cartao.titulo} cartao={cartao} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniTabela({ cartao }: { cartao: CartaoResposta }) {
  if (cartao.linhas.length === 0) return null;
  return (
    <div className="assistente-cartao">
      <h3 className="assistente-cartao-titulo">{cartao.titulo}</h3>
      <table className="assistente-mini">
        <tbody>
          {cartao.linhas.map((linha, i) => (
            <tr key={`${linha.rotulo}-${i}`}>
              <th scope="row">{linha.rotulo}</th>
              <td>{linha.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
