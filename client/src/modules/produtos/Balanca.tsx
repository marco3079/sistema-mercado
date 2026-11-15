import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import { CelulaProduto } from '../../ui/FotoProduto';
import { svgEan13 } from './codigoBarras';
import type { BalancaProdutoDTO, ListaProdutosDTO } from './tipos';
import './etiquetas.css';
import './produtos.css';

// Produto pesável com foto e categoria quando a rota de balança os envia.
type BalancaComFoto = BalancaProdutoDTO & { foto?: string | null; categoria?: string | null };

interface EtiquetaSimulada {
  codigo: string;
  total: number;
  pesoKg: number;
}

function validadeTexto(dias: number | null): string {
  if (dias === null) return '—';
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

function unidadeTexto(unidade: string): string {
  return unidade === 'KG' ? 'kg' : unidade.toLowerCase();
}

// Balança: exporta o arquivo ITENSMGV.TXT com os pesáveis e simula a etiqueta de peso para testar no PDV.
export function TelaBalanca() {
  const { dados, carregando, erro } = useDados<BalancaComFoto[]>('/balanca/produtos');
  // Pesáveis cadastrados: os sem PLU ainda não entram no arquivo da balança.
  const { dados: pesaveis } = useDados<ListaProdutosDTO>('/produtos?pesavel=1&porPagina=500');
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [simulador, setSimulador] = useState(false);
  const [produtoId, setProdutoId] = useState('');
  const [pesoTexto, setPesoTexto] = useState('');
  const [simulando, setSimulando] = useState(false);
  const [simulada, setSimulada] = useState<EtiquetaSimulada | null>(null);

  const lista = dados ?? [];
  const semPlu = pesaveis ? pesaveis.itens.filter((p) => p.codigoBalanca === null).length : 0;
  const produtoEscolhido = lista.find((p) => String(p.id) === produtoId) ?? null;

  async function exportar() {
    setAviso(null);
    setExportando(true);
    try {
      await baixarArquivo('/balanca/exportar', 'ITENSMGV.TXT');
      setAviso({ tipo: 'sucesso', texto: 'Arquivo ITENSMGV.TXT gerado. Envie-o para a balança.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setExportando(false);
    }
  }

  function abrirSimulador(id?: number) {
    setAviso(null);
    setSimulada(null);
    setProdutoId(id !== undefined ? String(id) : '');
    setPesoTexto('');
    setSimulador(true);
  }

  function fecharSimulador() {
    setSimulador(false);
    setSimulada(null);
    setAviso(null);
  }

  async function simular() {
    setAviso(null);
    setSimulada(null);
    const peso = lerNumero(pesoTexto);
    if (!produtoId) {
      setAviso({ tipo: 'erro', texto: 'Escolha o produto.' });
      return;
    }
    if (peso === null || peso <= 0) {
      setAviso({ tipo: 'erro', texto: 'Informe um peso em kg maior que zero.' });
      return;
    }
    setSimulando(true);
    try {
      const r = await api.post<EtiquetaSimulada>('/balanca/simular-etiqueta', { produtoId: Number(produtoId), pesoKg: peso });
      setSimulada(r);
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setSimulando(false);
    }
  }

  const colunas: ColunaTabela<BalancaComFoto>[] = [
    {
      titulo: 'Produto',
      celula: (p) => <CelulaProduto foto={p.foto} nome={p.nome} setor={p.categoria} detalhe={`PLU ${p.plu ?? '-'}`} />,
    },
    {
      titulo: 'Preço',
      alinhar: 'direita',
      celula: (p) => <span className="numero">{`${formatarMoeda(p.precoVenda)} /${unidadeTexto(p.unidade)}`}</span>,
    },
    {
      titulo: 'Validade',
      alinhar: 'direita',
      celula: (p) => <span className="numero">{validadeTexto(p.validadeDias)}</span>,
    },
    {
      titulo: 'Simular',
      acoes: true,
      celula: (p) => (
        <div className="acoes-linha">
          <Botao variante="secundario" aoClicar={() => abrirSimulador(p.id)}>
            Simular
          </Botao>
        </div>
      ),
    },
  ];

  // Etiqueta da balança desenhada: nome, peso, preço por kg, total e código de barras.
  const estiloEtiqueta = {
    '--etiq-w': '60mm',
    '--etiq-h': '40mm',
    '--etiq-p': '13.6mm',
  } as unknown as CSSProperties;
  const total = simulada ? simulada.total : 0;
  const inteiro = Math.trunc(total);
  const centavos = String(Math.round((total - inteiro) * 100)).padStart(2, '0');

  return (
    <Pagina
      titulo="Balança"
      acoes={
        <>
          <Botao variante="secundario" aoClicar={() => abrirSimulador()}>
            Simular etiqueta
          </Botao>
          <Botao aoClicar={exportar} desabilitado={exportando}>
            Exportar arquivo da balança
          </Botao>
        </>
      }
    >
      {aviso && !simulador && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <div className="resumo">
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-azul">
            <Icone nome="balanca" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{lista.length}</span>
            <span className="resumo-rotulo">Pesáveis com PLU</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-laranja">
            <Icone nome="codigo-barras" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{semPlu}</span>
            <span className="resumo-rotulo">Sem PLU</span>
          </div>
        </div>
        <div className="resumo-item">
          <span className="resumo-icone resumo-icone-verde">
            <Icone nome="validade" tamanho={24} />
          </span>
          <div>
            <span className="resumo-valor">{lista.filter((p) => p.validadeDias !== null).length}</span>
            <span className="resumo-rotulo">Com validade</span>
          </div>
        </div>
      </div>

      <Cartao titulo="Como funciona">
        <ol className="etiq-passos">
          <li className="etiq-passo">
            <span className="etiq-passo-icone">
              <Icone nome="enviar" tamanho={20} />
            </span>
            <div>
              <strong>1. Exportar</strong>
              <span>Gere o arquivo ITENSMGV.TXT e envie para a balança.</span>
            </div>
          </li>
          <li className="etiq-passo">
            <span className="etiq-passo-icone">
              <Icone nome="balanca" tamanho={20} />
            </span>
            <div>
              <strong>2. A balança imprime</strong>
              <span>O operador pesa e a balança imprime a etiqueta com código de barras.</span>
            </div>
          </li>
          <li className="etiq-passo">
            <span className="etiq-passo-icone">
              <Icone nome="codigo-barras" tamanho={20} />
            </span>
            <div>
              <strong>3. O PDV lê</strong>
              <span>O caixa passa a etiqueta e o PDV converte em preço ou peso.</span>
            </div>
          </li>
        </ol>
      </Cartao>

      <Cartao titulo="Produtos pesáveis">
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <Tabela
            colunas={colunas}
            dados={dados}
            chave={(p) => p.id}
            vazio="Nenhum produto pesável com PLU. Marque o produto como pesável na ficha."
          />
        )}
      </Cartao>

      <Modal aberto={simulador} titulo="Simular etiqueta da balança" aoFechar={fecharSimulador}>
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <div className="etiq-simulador-campos">
          <Selecao
            rotulo="Produto"
            valor={produtoId}
            aoMudar={(v) => {
              setProdutoId(v);
              setSimulada(null);
            }}
            opcoes={lista.map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
            vazio="Escolha o produto"
          />
          <Campo rotulo="Peso (kg)" valor={pesoTexto} aoMudar={setPesoTexto} />
        </div>

        {simulada && produtoEscolhido && (
          <div className="etiq-simulada">
            <div className="etiq etiq-balanca" style={estiloEtiqueta}>
              <div className="etiq-nome">{produtoEscolhido.nome}</div>
              <div className="etiq-preco">
                <span className="etiq-rs">R$</span>
                <span className="etiq-inteiro">{inteiro}</span>
                <span className="etiq-centavos">,{centavos}</span>
              </div>
              <div className="etiq-rodape">
                <span>
                  {simulada.pesoKg.toLocaleString('pt-BR')} kg · {formatarMoeda(produtoEscolhido.precoVenda)} /kg
                </span>
                <span>Total {formatarMoeda(simulada.total)}</span>
              </div>
              <div
                className="etiq-barras"
                dangerouslySetInnerHTML={{ __html: svgEan13(simulada.codigo, 52, 14) }}
              />
            </div>
            <p className="produtos-legenda">Código gerado: <strong className="produtos-codigo-balanca">{simulada.codigo}</strong></p>
          </div>
        )}

        <div className="pagina-acoes">
          <Botao variante="secundario" aoClicar={fecharSimulador}>
            Fechar
          </Botao>
          <Botao desabilitado={simulando} aoClicar={simular}>
            Simular
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
