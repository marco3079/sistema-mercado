import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro, ROTULOS_FORMA_PAGAMENTO } from '../../lib/mercado';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  MenuAcoes,
  Modal,
  Pagina,
  Selo,
  Selecao,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import { soDigitos } from './FichaCliente';
import type { DevedorDTO, ExtratoFiadoDTO, FormaRecebimento, ResumoFiadoDTO } from './tipos';
import './clientes.css';

const FORMAS: { valor: FormaRecebimento; rotulo: string }[] = [
  { valor: 'DINHEIRO', rotulo: ROTULOS_FORMA_PAGAMENTO.DINHEIRO },
  { valor: 'PIX', rotulo: ROTULOS_FORMA_PAGAMENTO.PIX },
  { valor: 'DEBITO', rotulo: ROTULOS_FORMA_PAGAMENTO.DEBITO },
  { valor: 'CREDITO', rotulo: ROTULOS_FORMA_PAGAMENTO.CREDITO },
];

// Link do WhatsApp com mensagem de cobrança gentil. Null se o cliente não tem telefone com DDD.
function linkWhatsApp(devedor: DevedorDTO): string | null {
  const numero = soDigitos(devedor.whatsapp ?? devedor.telefone);
  if (numero.length !== 10 && numero.length !== 11) return null;
  const mensagem =
    `Olá, ${devedor.nome}! Passando para lembrar do saldo de ${formatarMoeda(devedor.saldoDevedor)} no fiado. ` +
    'Quando puder, combinamos o pagamento. Obrigado!';
  return `https://wa.me/55${numero}?text=${encodeURIComponent(mensagem)}`;
}

// Recebimento (total ou parcial) de um devedor.
function ReceberFiado({
  devedor,
  aoFechar,
  aoRecebido,
}: {
  devedor: DevedorDTO;
  aoFechar(): void;
  aoRecebido(mensagem: string): void;
}) {
  const [valor, setValor] = useState(devedor.saldoDevedor.toFixed(2).replace('.', ','));
  const [forma, setForma] = useState<FormaRecebimento>('DINHEIRO');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const numero = lerNumero(valor);
    if (numero === null || numero <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    if (numero > devedor.saldoDevedor + 0.001) {
      setErro(`O valor é maior que o saldo devedor (${formatarMoeda(devedor.saldoDevedor)}).`);
      return;
    }
    setEnviando(true);
    try {
      await api.post(`/clientes/${devedor.id}/receber`, {
        valor: numero,
        formaPagamento: forma,
        descricao: descricao.trim() || null,
      });
      aoRecebido(`Recebido ${formatarMoeda(numero)} de ${devedor.nome}.`);
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={`Receber · ${devedor.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <p>Saldo devedor: {formatarMoeda(devedor.saldoDevedor)}</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Valor recebido (R$)" valor={valor} aoMudar={setValor} obrigatorio />
        <Selecao
          rotulo="Forma de pagamento"
          valor={forma}
          aoMudar={(v) => setForma(v as FormaRecebimento)}
          opcoes={FORMAS}
          obrigatorio
        />
        <Campo rotulo="Observação" valor={descricao} aoMudar={setDescricao} />
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Recebendo...' : 'Receber'}
        </Botao>{' '}
        <Botao variante="secundario" aoClicar={aoFechar}>
          Cancelar
        </Botao>
      </form>
    </Modal>
  );
}

// Extrato do fiado: compras e pagamentos, do mais recente para o mais antigo.
function ExtratoFiado({ devedor, aoFechar }: { devedor: DevedorDTO; aoFechar(): void }) {
  const extrato = useDados<ExtratoFiadoDTO>(`/clientes/${devedor.id}/fiado`);
  const dados = extrato.dados;

  return (
    <Modal aberto titulo={`Extrato · ${devedor.nome}`} aoFechar={aoFechar}>
      {extrato.erro && <Aviso tipo="erro">{extrato.erro}</Aviso>}
      {extrato.carregando && !dados && <Carregando />}
      {dados && (
        <>
          <p>
            Saldo devedor: <strong className="clientes-devendo">{formatarMoeda(dados.saldoDevedor)}</strong>
          </p>
          <p>
            Limite: {formatarMoeda(dados.limiteCredito)} · Disponível: {formatarMoeda(dados.disponivel)}
          </p>
          {dados.movimentos.length === 0 ? (
            <p>Nenhum movimento ainda.</p>
          ) : (
            <ul className="fiado-extrato">
              {dados.movimentos.map((m) => (
                <li key={m.id}>
                  <span className="fiado-extrato-texto">
                    {formatarDataHora(m.criadoEm)} ·{' '}
                    {m.tipo === 'COMPRA'
                      ? m.vendaNumero !== null
                        ? `Compra · venda nº ${m.vendaNumero}`
                        : 'Compra no fiado'
                      : 'Pagamento'}
                    {m.formaPagamento && ` · ${ROTULOS_FORMA_PAGAMENTO[m.formaPagamento] ?? m.formaPagamento}`}
                    {m.tipo === 'PAGAMENTO' && m.descricao && <small> {m.descricao}</small>}
                  </span>
                  <strong className={m.tipo === 'COMPRA' ? 'clientes-uso' : 'clientes-ganho'}>
                    {m.tipo === 'COMPRA' ? '+' : '−'}
                    {formatarMoeda(m.valor)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// Tela do fiado (GESTOR e OPERADOR): total em aberto, dias em atraso e recebimentos.
export function Fiado() {
  const resumo = useDados<ResumoFiadoDTO>('/clientes/fiado/resumo');

  const [recebendo, setRecebendo] = useState<DevedorDTO | null>(null);
  const [extrato, setExtrato] = useState<DevedorDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const devedores: DevedorDTO[] = resumo.dados?.clientes ?? [];
  const total = resumo.dados?.totalEmAberto ?? 0;
  const origem = resumo;

  function depoisDeReceber(mensagem: string) {
    setAviso(mensagem);
    resumo.recarregar();
  }

  return (
    <Pagina titulo="Fiado">
      <div className="fiado-total">
        <Cartao>
          <span className="fiado-total-rotulo">Total em aberto</span>
          <strong className="fiado-total-valor">{formatarMoeda(total)}</strong>
          <span>
            {devedores.length === 1 ? '1 cliente devendo' : `${devedores.length} clientes devendo`}
          </span>
        </Cartao>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {origem.erro && <Aviso tipo="erro">{origem.erro}</Aviso>}
      {origem.carregando && !origem.dados && <Carregando />}

      {origem.dados && (
        <Tabela
          dados={devedores}
          chave={(d) => d.id}
          vazio="Ninguém devendo no fiado."
          colunas={[
            { titulo: 'Cliente', celula: (d) => <strong>{d.nome}</strong> },
            {
              titulo: 'Saldo devedor',
              alinhar: 'direita',
              celula: (d) => <span className="clientes-devendo">{formatarMoeda(d.saldoDevedor)}</span>,
            },
            { titulo: 'Limite', alinhar: 'direita', celula: (d) => formatarMoeda(d.limiteCredito) },
            {
              titulo: 'Dias em atraso',
              alinhar: 'direita',
              celula: (d) =>
                d.diasEmAtraso === null ? (
                  '—'
                ) : (
                  <Selo cor={d.diasEmAtraso > 60 ? 'vermelho' : d.diasEmAtraso > 30 ? 'amarelo' : 'verde'}>
                    {d.diasEmAtraso} {d.diasEmAtraso === 1 ? 'dia' : 'dias'}
                  </Selo>
                ),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (d) => (
                <div className="fiado-acoes">
                  <Botao variante="secundario" aoClicar={() => setRecebendo(d)}>
                    Receber
                  </Botao>
                  <MenuAcoes
                    rotulo={`Mais ações para ${d.nome}`}
                    acoes={[
                      { rotulo: 'Ver extrato', icone: 'lista', aoClicar: () => setExtrato(d) },
                      ...(linkWhatsApp(d) !== null
                        ? [
                            {
                              rotulo: 'Cobrar pelo WhatsApp',
                              icone: 'chat' as const,
                              aoClicar: () => {
                                const link = linkWhatsApp(d);
                                if (link) window.open(link, '_blank', 'noopener');
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      )}

      {recebendo && (
        <ReceberFiado
          devedor={recebendo}
          aoFechar={() => setRecebendo(null)}
          aoRecebido={(mensagem) => {
            setRecebendo(null);
            depoisDeReceber(mensagem);
          }}
        />
      )}
      {extrato && <ExtratoFiado devedor={extrato} aoFechar={() => setExtrato(null)} />}
    </Pagina>
  );
}
