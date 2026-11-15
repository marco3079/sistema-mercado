import { useState } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao, Tabela, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import type { BalancaProdutoDTO } from './tipos';
import './produtos.css';

interface EtiquetaSimulada {
  codigo: string;
  total: number;
  pesoKg: number;
}

// Balança: exporta o arquivo ITENSMGV.TXT com os pesáveis e simula a etiqueta de peso para testar no PDV.
export function TelaBalanca() {
  const { dados, carregando, erro } = useDados<BalancaProdutoDTO[]>('/balanca/produtos');
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [produtoId, setProdutoId] = useState('');
  const [pesoTexto, setPesoTexto] = useState('');
  const [simulando, setSimulando] = useState(false);
  const [simulada, setSimulada] = useState<EtiquetaSimulada | null>(null);

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

  const colunas: ColunaTabela<BalancaProdutoDTO>[] = [
    { titulo: 'PLU', alinhar: 'direita', celula: (p) => p.plu ?? '-' },
    { titulo: 'Produto', celula: (p) => <strong>{p.nome}</strong> },
    {
      titulo: 'Preço',
      alinhar: 'direita',
      celula: (p) => `${formatarMoeda(p.precoVenda)} /${p.unidade === 'KG' ? 'kg' : p.unidade.toLowerCase()}`,
    },
    { titulo: 'Validade', alinhar: 'direita', celula: (p) => (p.validadeDias !== null ? `${p.validadeDias} dias` : '-') },
  ];

  return (
    <Pagina titulo="Balança">
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Cartao titulo="Integração com a balança">
        <p className="produtos-legenda">
          Os produtos vendidos no peso têm um PLU. A balança lê o arquivo ITENSMGV.TXT com o PLU, o preço, a
          validade e a descrição. Quando o operador pesa, a balança imprime uma etiqueta com código de barras que o PDV
          lê e converte em preço ou peso.
        </p>
        <div className="produtos-acoes-filtro">
          <Botao aoClicar={exportar} desabilitado={exportando}>
            Exportar arquivo da balança
          </Botao>
        </div>
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

      <Cartao titulo="Simular etiqueta da balança">
        <div className="filtros produtos-filtros">
          <Selecao
            rotulo="Produto"
            valor={produtoId}
            aoMudar={setProdutoId}
            opcoes={(dados ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
            vazio="Escolha o produto"
          />
          <Campo rotulo="Peso (kg)" valor={pesoTexto} aoMudar={setPesoTexto} />
          <div className="produtos-acoes-filtro">
            <Botao variante="secundario" desabilitado={simulando} aoClicar={simular}>
              Simular
            </Botao>
          </div>
        </div>
        {simulada && (
          <div className="produtos-simulacao">
            <span>Código gerado</span>
            <strong className="produtos-codigo-balanca">{simulada.codigo}</strong>
            <span>
              Peso {simulada.pesoKg.toLocaleString('pt-BR')} kg · total {formatarMoeda(simulada.total)}
            </span>
          </div>
        )}
      </Cartao>
    </Pagina>
  );
}
