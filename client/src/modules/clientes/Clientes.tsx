import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import { formatarMoeda, Aviso, Botao, Campo, Carregando, Pagina, Selecao, Selo, Tabela } from '../../ui';
import { FichaCliente, formatarCpfCnpj, formatarTelefone, ROTULO_TIPO } from './FichaCliente';
import type { ClienteDTO } from './tipos';
import './clientes.css';

// Lista de clientes: busca por nome, CPF/CNPJ ou telefone, filtro de tipo e ficha do cliente.
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

  return (
    <Pagina
      titulo="Clientes"
      acoes={podeEditar && <Botao aoClicar={() => setAberto('novo')}>Novo cliente</Botao>}
    >
      <div className="clientes-filtros">
        <div className="clientes-busca">
          <Campo rotulo="Buscar por nome, CPF/CNPJ ou telefone" valor={texto} aoMudar={setTexto} />
        </div>
        <div className="clientes-filtro-tipo">
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
              titulo: 'Nome',
              celula: (c) => (
                <>
                  <strong>{c.nome}</strong>
                  {c.bloqueado && (
                    <>
                      {' '}
                      <Selo cor="vermelho">Bloqueado</Selo>
                    </>
                  )}
                </>
              ),
            },
            {
              titulo: 'Tipo',
              celula: (c) => <Selo cor={c.tipo === 'ATACADO' ? 'azul' : 'cinza'}>{ROTULO_TIPO[c.tipo]}</Selo>,
            },
            { titulo: 'CPF/CNPJ', celula: (c) => <span className="clientes-sem-quebra">{formatarCpfCnpj(c.cpfCnpj)}</span> },
            { titulo: 'Telefone', celula: (c) => <span className="clientes-sem-quebra">{formatarTelefone(c.telefone)}</span> },
            { titulo: 'Cidade', celula: (c) => (c.cidade ? `${c.cidade}${c.uf ? ` / ${c.uf}` : ''}` : '—') },
            {
              titulo: 'Saldo devedor',
              alinhar: 'direita',
              celula: (c) => (
                <span className={c.saldoDevedor > 0 ? 'clientes-devendo' : undefined}>{formatarMoeda(c.saldoDevedor)}</span>
              ),
            },
            { titulo: 'Limite', alinhar: 'direita', celula: (c) => formatarMoeda(c.limiteCredito) },
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
          }}
        />
      )}
    </Pagina>
  );
}
