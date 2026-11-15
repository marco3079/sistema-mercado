import { useEffect, useState } from 'react';
import { useDados } from '../../lib/useDados';
import { Aviso, AcaoMenu, Botao, Campo, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { Estrelas, FichaFornecedor } from './FichaFornecedor';
import type { FornecedorLinha } from './tipos';

// Só dígitos, com 55 na frente, para o link do WhatsApp.
function linkWhatsApp(numero: string): string {
  const digitos = numero.replace(/\D/g, '');
  return `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}`;
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Sem permissão de área de transferência: o usuário copia à mão.
  }
}

// Lista de fornecedores. Clicar numa linha (ou em Abrir) abre a ficha: dados, produtos, pedidos e avaliações.
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

  const lista = dados ?? [];
  const ativos = lista.filter((f) => f.ativo).length;
  const pedidosAbertos = lista.reduce((soma, f) => soma + f.pedidosAbertos, 0);
  const comprado = lista.reduce((soma, f) => soma + f.totalComprado12m, 0);

  // Ações extras no menu: só aparecem quando o fornecedor tem o dado.
  function acoesExtras(f: FornecedorLinha): AcaoMenu[] {
    const acoes: AcaoMenu[] = [];
    if (f.cnpj) {
      acoes.push({ rotulo: 'Copiar CNPJ', icone: 'documento' as NomeIcone, aoClicar: () => void copiar(f.cnpj ?? '') });
    }
    const contatoZap = f.whatsapp ?? null;
    if (contatoZap) {
      acoes.push({
        rotulo: 'Abrir WhatsApp',
        icone: 'chat' as NomeIcone,
        aoClicar: () => window.open(linkWhatsApp(contatoZap), '_blank', 'noopener'),
      });
    }
    return acoes;
  }

  return (
    <Pagina titulo="Fornecedores" acoes={<Botao aoClicar={() => setAberta('novo')}>Novo fornecedor</Botao>}>
      {dados && (
        <div className="resumo">
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-azul">
              <Icone nome="pacote" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">{ativos}</span>
              <span className="resumo-rotulo">Fornecedores ativos</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-laranja">
              <Icone nome="pedidos" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">{pedidosAbertos}</span>
              <span className="resumo-rotulo">Pedidos abertos</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-verde">
              <Icone nome="dinheiro" tamanho={24} />
            </span>
            <div>
              <span className="resumo-valor">{formatarMoeda(comprado)}</span>
              <span className="resumo-rotulo">Comprado em 12 meses</span>
            </div>
          </div>
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
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
                  <span className="celula-produto-texto">
                    <span className="celula-produto-nome">{f.nome}</span>
                    <span className="celula-produto-detalhe">
                      {[f.cnpj, f.contato ?? f.telefone ?? f.whatsapp].filter(Boolean).join(' · ') || 'Sem CNPJ nem contato'}
                    </span>
                  </span>
                ),
              },
              { titulo: 'Avaliação', celula: (f) => <Estrelas valor={f.avaliacao} /> },
              { titulo: 'Prazo', alinhar: 'centro', celula: (f) => `${f.prazoEntregaDias} dia(s)` },
              {
                titulo: 'Pedidos abertos',
                alinhar: 'direita',
                celula: (f) => <span className="numero">{f.pedidosAbertos}</span>,
              },
              {
                titulo: 'Situação',
                celula: (f) => (f.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Inativo</Selo>),
              },
              {
                titulo: 'Comprado (12 meses)',
                alinhar: 'direita',
                celula: (f) => <span className="numero">{formatarMoeda(f.totalComprado12m)}</span>,
              },
              {
                titulo: 'Ações',
                acoes: true,
                celula: (f) => {
                  const extras = acoesExtras(f);
                  return (
                    <span className="acoes-linha">
                      <Botao variante="secundario" aoClicar={() => setAberta(f.id)}>
                        Abrir
                      </Botao>
                      {extras.length > 0 && <MenuAcoes rotulo={`Mais ações de ${f.nome}`} acoes={extras} />}
                    </span>
                  );
                },
              },
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
