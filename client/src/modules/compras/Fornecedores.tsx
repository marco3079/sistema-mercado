import { useEffect, useState } from 'react';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Modal, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import { Estrelas, FichaFornecedor } from './FichaFornecedor';
import type { FornecedorLinha } from './tipos';

// Lista de fornecedores. Clicar numa linha abre a ficha (dados, produtos, pedidos e avaliações).
export function Fornecedores() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [ativo, setAtivo] = useState('');
  const [aberta, setAberta] = useState<number | 'novo' | null>(null);

  // Espera o usuário parar de digitar antes de consultar.
  useEffect(() => {
    const espera = window.setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => window.clearTimeout(espera);
  }, [busca]);

  const parametros = new URLSearchParams();
  if (buscaAplicada) parametros.set('busca', buscaAplicada);
  if (ativo) parametros.set('ativo', ativo);
  const consulta = parametros.toString();
  const { dados, carregando, erro, recarregar } = useDados<FornecedorLinha[]>(
    `/fornecedores${consulta ? `?${consulta}` : ''}`,
  );

  return (
    <Pagina titulo="Fornecedores" acoes={<Botao aoClicar={() => setAberta('novo')}>Novo fornecedor</Botao>}>
      <div className="compras-filtros">
        <Campo rotulo="Buscar por nome ou CNPJ" valor={busca} aoMudar={setBusca} />
        <Selecao
          rotulo="Situação"
          valor={ativo}
          aoMudar={setAtivo}
          opcoes={[
            { valor: 'true', rotulo: 'Ativos' },
            { valor: 'false', rotulo: 'Inativos' },
          ]}
          vazio="Todos"
        />
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}

      {dados && (
        <div className="compras-rolagem">
          <Tabela
            colunas={[
              {
                titulo: 'Fornecedor',
                celula: (f) => (
                  <>
                    {f.nome}
                    {f.cidade && <span className="compras-sub">{f.cidade}{f.uf ? ` / ${f.uf}` : ''}</span>}
                  </>
                ),
              },
              { titulo: 'CNPJ', celula: (f) => f.cnpj ?? '—' },
              { titulo: 'Contato', celula: (f) => f.contato ?? f.telefone ?? f.whatsapp ?? '—' },
              { titulo: 'Prazo', alinhar: 'centro', celula: (f) => `${f.prazoEntregaDias} dia(s)` },
              { titulo: 'Pagamento', celula: (f) => f.condicaoPagamento ?? '—' },
              { titulo: 'Avaliação', celula: (f) => <Estrelas valor={f.avaliacao} /> },
              {
                titulo: 'Situação',
                celula: (f) => (f.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Inativo</Selo>),
              },
              { titulo: 'Comprado (12 meses)', alinhar: 'direita', celula: (f) => formatarMoeda(f.totalComprado12m) },
            ]}
            dados={dados}
            chave={(f) => f.id}
            vazio="Nenhum fornecedor encontrado. Cadastre o primeiro fornecedor."
            aoClicarLinha={(f) => setAberta(f.id)}
          />
        </div>
      )}

      <Modal
        aberto={aberta !== null}
        titulo={aberta === 'novo' || aberta === null ? 'Novo fornecedor' : 'Ficha do fornecedor'}
        aoFechar={() => setAberta(null)}
      >
        {aberta !== null && (
          <FichaFornecedor
            id={aberta === 'novo' ? null : aberta}
            aoSalvar={(novoId) => {
              recarregar();
              setAberta(novoId);
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
