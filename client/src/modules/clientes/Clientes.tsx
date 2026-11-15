import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { mensagemErro } from '../../lib/mercado';
import { Aviso, Avatar, Botao, Campo, Carregando, MenuAcoes, Pagina, Selecao, Selo, Tabela, formatarMoeda } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { BarraNivel } from '../../ui/FotoProduto';
import { Icone } from '../../ui/icones';
import { FichaCliente, formatarCpfCnpj, formatarTelefone, ROTULO_TIPO, soDigitos } from './FichaCliente';
import type { ClienteDTO } from './tipos';
import './clientes.css';

// Link que abre a conversa no WhatsApp (a mensagem é escrita e enviada pela pessoa). Null sem DDD e número.
function linkWhatsApp(c: ClienteDTO): string | null {
  const numero = soDigitos(c.whatsapp ?? c.telefone);
  if (numero.length !== 10 && numero.length !== 11) return null;
  return `https://wa.me/55${numero}`;
}

// Lista de clientes: resumo, busca por nome, CPF/CNPJ ou telefone, filtro de tipo, bloqueio e ficha do cliente.
// VENDEDOR vê só a própria carteira (o servidor filtra). CONTADOR só consulta.
export function Clientes() {
  const { usuario } = useAuth();
  const perfil = usuario?.perfil;
  const gestor = perfil === 'GESTOR';
  const podeEditar = perfil === 'GESTOR' || perfil === 'OPERADOR' || perfil === 'VENDEDOR';
  const vendedorLogado = perfil === 'VENDEDOR';

  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [aberto, setAberto] = useState<number | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // A busca espera 300 ms depois da última tecla.
  useEffect(() => {
    const atraso = window.setTimeout(() => setBusca(texto.trim()), 300);
    return () => window.clearTimeout(atraso);
  }, [texto]);

  const parametros = new URLSearchParams();
  if (busca !== '') parametros.set('busca', busca);
  if (tipo !== '') parametros.set('tipo', tipo);
  const lista = useDados<ClienteDTO[]>(`/clientes?${parametros.toString()}`);
  const clientes = lista.dados ?? [];
  // Todos os clientes da carteira, só para os números do topo (sem filtro da busca).
  const todos = useDados<ClienteDTO[]>('/clientes');
  const conjunto = todos.dados ?? [];
  const numAtacado = conjunto.filter((c) => c.tipo === 'ATACADO').length;
  const numComFiado = conjunto.filter((c) => c.saldoDevedor > 0).length;
  const totalEmAberto = conjunto.reduce((soma, c) => soma + c.saldoDevedor, 0);

  async function alternarBloqueio(c: ClienteDTO) {
    const bloquear = !c.bloqueado;
    const pergunta = bloquear ? `Bloquear ${c.nome}?` : `Desbloquear ${c.nome}?`;
    if (!window.confirm(pergunta)) return;
    setErro(null);
    try {
      await api.post(`/clientes/${c.id}/bloquear`, { bloqueado: bloquear });
      setAviso(bloquear ? `${c.nome} bloqueado.` : `${c.nome} desbloqueado.`);
      lista.recarregar();
      todos.recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  return (
    <Pagina
      titulo="Clientes"
      acoes={podeEditar && <Botao aoClicar={() => setAberto('novo')}>Novo cliente</Botao>}
    >
      {todos.dados && (
        <div className="resumo">
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-azul">
              <Icone nome="usuarios" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{conjunto.length}</span>
              <span className="resumo-rotulo">Clientes</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-roxo">
              <Icone nome="loja" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{numAtacado}</span>
              <span className="resumo-rotulo">Atacado</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-verde">
              <Icone nome="cadeado" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{numComFiado}</span>
              <span className="resumo-rotulo">Com fiado</span>
            </div>
          </div>
          <div className="resumo-item">
            <span className="resumo-icone resumo-icone-vermelho">
              <Icone nome="dinheiro" tamanho={22} />
            </span>
            <div>
              <span className="resumo-valor">{formatarMoeda(totalEmAberto)}</span>
              <span className="resumo-rotulo">Total em aberto</span>
            </div>
          </div>
        </div>
      )}

      <div className="barra-ferramentas">
        <div className="filtros">
          <div className="clientes-busca">
            <Campo rotulo="Buscar" placeholder="Buscar por nome, CPF/CNPJ ou telefone" valor={texto} aoMudar={setTexto} />
          </div>
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            vazio="Todos"
            opcoes={[
              { valor: 'VAREJO', rotulo: 'Varejo' },
              { valor: 'ATACADO', rotulo: 'Atacado' },
            ]}
          />
        </div>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}

      {lista.dados && (
        <Tabela
          dados={clientes}
          chave={(c) => c.id}
          vazio={busca !== '' || tipo !== '' ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          aoClicarLinha={(c) => setAberto(c.id)}
          colunas={[
            {
              titulo: 'Cliente',
              celula: (c) => {
                const detalhe = [formatarCpfCnpj(c.cpfCnpj), formatarTelefone(c.telefone)]
                  .filter((parte) => parte !== '—')
                  .join(' · ');
                return (
                  <span className="clientes-identidade">
                    <Avatar nome={c.nome} tamanho={40} />
                    <span className="clientes-identidade-texto">
                      <span className="clientes-identidade-nome">
                        {c.nome}
                        {c.bloqueado && (
                          <>
                            {' '}
                            <Selo cor="vermelho">Bloqueado</Selo>
                          </>
                        )}
                      </span>
                      {detalhe && <small className="clientes-sem-quebra">{detalhe}</small>}
                    </span>
                  </span>
                );
              },
            },
            {
              titulo: 'Tipo',
              celula: (c) => <Selo cor={c.tipo === 'ATACADO' ? 'azul' : 'cinza'}>{ROTULO_TIPO[c.tipo]}</Selo>,
            },
            { titulo: 'Cidade', celula: (c) => (c.cidade ? `${c.cidade}${c.uf ? ` / ${c.uf}` : ''}` : '—') },
            { titulo: 'Limite', alinhar: 'direita', celula: (c) => <span className="numero">{formatarMoeda(c.limiteCredito)}</span> },
            {
              titulo: 'Saldo devedor',
              alinhar: 'direita',
              celula: (c) => (
                <span className="clientes-saldo">
                  <span className={`numero${c.saldoDevedor > 0 ? ' clientes-devendo' : ''}`}>
                    {formatarMoeda(c.saldoDevedor)}
                  </span>
                  <BarraNivel
                    valor={c.saldoDevedor}
                    maximo={c.limiteCredito > 0 ? c.limiteCredito : c.saldoDevedor}
                    cor="vermelho"
                  />
                </span>
              ),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => {
                const link = linkWhatsApp(c);
                const acoes: AcaoMenu[] = [];
                if (link) {
                  acoes.push({
                    rotulo: 'Abrir no WhatsApp',
                    icone: 'chat',
                    aoClicar: () => window.open(link, '_blank', 'noopener'),
                  });
                }
                if (gestor) {
                  acoes.push({
                    rotulo: c.bloqueado ? 'Desbloquear' : 'Bloquear',
                    icone: 'cadeado',
                    perigo: !c.bloqueado,
                    aoClicar: () => alternarBloqueio(c),
                  });
                }
                return (
                  <div className="acoes-linha">
                    <Botao variante="secundario" aoClicar={() => setAberto(c.id)}>
                      Abrir
                    </Botao>
                    {acoes.length > 0 && <MenuAcoes rotulo={`Mais ações para ${c.nome}`} acoes={acoes} />}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      {aberto !== null && (
        <FichaCliente
          clienteId={aberto === 'novo' ? null : aberto}
          podeEditar={podeEditar}
          gestor={gestor}
          vendedorLogado={vendedorLogado}
          aoFechar={() => setAberto(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            lista.recarregar();
            todos.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
