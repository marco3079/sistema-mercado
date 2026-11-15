import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { lerNumero } from '../../lib/mercado';
import { PERFIS, rotuloPerfil } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import type { LojaDTO } from '../lojas/tipos';
import {
  Aviso,
  Avatar,
  Botao,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarData,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { mensagemErro, queryString } from './tipos';
import type { UsuarioDTO } from './tipos';
import { FichaUsuario, SeloPerfilUsuario } from './FichaUsuario';

// Usuário com os campos da equipe. O servidor devolve Decimal como texto (saldo e comissão).
type UsuarioEquipe = UsuarioDTO & {
  lojaId: number | null;
  saldoFlex: string | number;
  comissaoPercentual: string | number;
  cnh: string | null;
};

// Campos da equipe no formulário (texto digitado).
interface CamposEquipe {
  lojaId: string;
  comissao: string;
  saldoFlex: string;
  cnh: string;
}

const CAMPOS_VAZIOS: CamposEquipe = { lojaId: '', comissao: '', saldoFlex: '', cnh: '' };

// Número do banco para o campo, com vírgula decimal.
function numeroParaCampo(valor: string | number): string {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n).replace('.', ',') : '';
}

function camposDe(u: UsuarioEquipe): CamposEquipe {
  return {
    lojaId: u.lojaId === null ? '' : String(u.lojaId),
    comissao: numeroParaCampo(u.comissaoPercentual),
    saldoFlex: numeroParaCampo(u.saldoFlex),
    cnh: u.cnh ?? '',
  };
}

// Corpo da equipe para POST e PUT. Campo vazio vira 0 (números) ou null (loja e CNH).
function corpoEquipe(c: CamposEquipe) {
  const comissao = c.comissao.trim() === '' ? 0 : lerNumero(c.comissao);
  const saldoFlex = c.saldoFlex.trim() === '' ? 0 : lerNumero(c.saldoFlex);
  if (comissao === null || comissao < 0 || comissao > 100) {
    throw new Error('A comissão precisa ser um número de 0 a 100.');
  }
  if (saldoFlex === null) {
    throw new Error('O saldo de flex precisa ser um número.');
  }
  const cnh = c.cnh.trim();
  return {
    lojaId: c.lojaId === '' ? null : Number(c.lojaId),
    comissaoPercentual: comissao,
    saldoFlex,
    cnh: cnh === '' ? null : cnh,
  };
}

// Loja, comissão e saldo de flex (vendedor) e CNH (motorista). Só aparece o que vale para o perfil.
function CamposEquipeForm({
  perfil,
  lojas,
  valor,
  aoMudar,
}: {
  perfil: string;
  lojas: LojaDTO[];
  valor: CamposEquipe;
  aoMudar: (parcial: Partial<CamposEquipe>) => void;
}) {
  return (
    <>
      <Selecao
        rotulo="Loja"
        valor={valor.lojaId}
        aoMudar={(v) => aoMudar({ lojaId: v })}
        opcoes={lojas.map((l) => ({ valor: String(l.id), rotulo: l.nome }))}
        vazio="Todas as lojas"
      />
      {perfil === 'VENDEDOR' && (
        <>
          <Campo rotulo="Comissão (%)" valor={valor.comissao} aoMudar={(v) => aoMudar({ comissao: v })} />
          <Campo rotulo="Saldo de flex (R$)" valor={valor.saldoFlex} aoMudar={(v) => aoMudar({ saldoFlex: v })} />
        </>
      )}
      {perfil === 'MOTORISTA' && (
        <Campo rotulo="CNH" valor={valor.cnh} aoMudar={(v) => aoMudar({ cnh: v })} />
      )}
    </>
  );
}

// ---------- Criar usuário ----------

function FormNovoUsuario({ lojas, aoConcluir }: { lojas: LojaDTO[]; aoConcluir: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [perfil, setPerfil] = useState('');
  const [equipe, setEquipe] = useState<CamposEquipe>(CAMPOS_VAZIOS);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api.post('/usuarios', {
        nome: nome.trim(),
        email: email.trim(),
        senha,
        perfil,
        ...corpoEquipe(equipe),
      });
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
      <Campo
        rotulo="Senha inicial (mínimo 6 caracteres)"
        tipo="password"
        valor={senha}
        aoMudar={setSenha}
        obrigatorio
      />
      <Selecao rotulo="Perfil" valor={perfil} aoMudar={setPerfil} opcoes={PERFIS} obrigatorio />
      <CamposEquipeForm
        perfil={perfil}
        lojas={lojas}
        valor={equipe}
        aoMudar={(p) => setEquipe((atual) => ({ ...atual, ...p }))}
      />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Criar usuário
        </Botao>
      </div>
    </form>
  );
}

// ---------- Editar dados da equipe (perfil, loja, comissão, flex, CNH) ----------

function FormEdicao({
  usuario,
  lojas,
  aoAtualizado,
}: {
  usuario: UsuarioEquipe;
  lojas: LojaDTO[];
  aoAtualizado: (u: UsuarioEquipe) => void;
}) {
  const [perfil, setPerfil] = useState(usuario.perfil);
  const [equipe, setEquipe] = useState<CamposEquipe>(() => camposDe(usuario));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      const atualizado = await api.put<UsuarioEquipe>(`/usuarios/${usuario.id}`, {
        perfil,
        ...corpoEquipe(equipe),
      });
      setSucesso('Dados salvos.');
      aoAtualizado(atualizado);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <Selecao rotulo="Perfil" valor={perfil} aoMudar={setPerfil} opcoes={PERFIS} obrigatorio />
      <CamposEquipeForm
        perfil={perfil}
        lojas={lojas}
        valor={equipe}
        aoMudar={(p) => setEquipe((atual) => ({ ...atual, ...p }))}
      />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar dados
        </Botao>
      </div>
    </form>
  );
}

// ---------- Detalhe: dados, ativar/desativar e redefinir senha (Editar e Redefinir senha) ----------

function DetalheUsuario({
  usuario,
  lojas,
  aoAtualizado,
}: {
  usuario: UsuarioEquipe;
  lojas: LojaDTO[];
  aoAtualizado: (u: UsuarioEquipe) => void;
}) {
  const [novaSenha, setNovaSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function alternarAtivo() {
    const proximo = !usuario.ativo;
    if (!proximo && !window.confirm(`Desativar o usuário ${usuario.nome}?`)) return;
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      const atualizado = await api.put<UsuarioEquipe>(`/usuarios/${usuario.id}`, { ativo: proximo });
      aoAtualizado(atualizado);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function redefinir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      await api.post(`/usuarios/${usuario.id}/redefinir-senha`, { novaSenha });
      setNovaSenha('');
      setSucesso('Senha redefinida.');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <FormEdicao usuario={usuario} lojas={lojas} aoAtualizado={aoAtualizado} />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <p>
        <strong>E-mail:</strong> {usuario.email}
      </p>
      <p>
        <strong>Situação:</strong> {usuario.ativo ? 'Ativo' : 'Inativo'}
      </p>
      <div className="pagina-acoes">
        <Botao
          variante={usuario.ativo ? 'perigo' : 'primario'}
          desabilitado={ocupado}
          aoClicar={alternarAtivo}
        >
          {usuario.ativo ? 'Desativar' : 'Ativar'}
        </Botao>
      </div>

      <form onSubmit={redefinir}>
        <h3 className="cartao-titulo">Redefinir senha</h3>
        <Campo
          rotulo="Nova senha (mínimo 6 caracteres)"
          tipo="password"
          valor={novaSenha}
          aoMudar={setNovaSenha}
          obrigatorio
        />
        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={ocupado}>
            Redefinir senha
          </Botao>
        </div>
      </form>
    </div>
  );
}

// ---------- Fileira de resumo ----------

function ResumoItem({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'roxo' | 'verde' | 'vermelho';
  valor: number;
  rotulo: string;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

// ---------- Lista (somente GESTOR) ----------

export function Usuarios() {
  const [perfil, setPerfil] = useState('');
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<UsuarioEquipe | null>(null);
  const [ficha, setFicha] = useState<number | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const { usuario } = useAuth();
  const { dados, carregando, erro, recarregar } = useDados<UsuarioEquipe[]>(
    `/usuarios${queryString({ perfil, busca: busca.trim() })}`
  );
  const { dados: lojasDados } = useDados<LojaDTO[]>('/lojas');
  const lojas = lojasDados ?? [];

  // Nome da loja pelo id; sem loja (null) a pessoa atende todas.
  function nomeDaLoja(lojaId: number | null): string {
    if (lojaId === null) return 'Todas';
    return lojas.find((l) => l.id === lojaId)?.nome ?? '—';
  }

  async function alternarAtivoLista(u: UsuarioDTO, ativo: boolean) {
    if (!ativo && !window.confirm(`Desativar o usuário ${u.nome}?`)) return;
    setErroAcao(null);
    try {
      await api.put(`/usuarios/${u.id}`, { ativo });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos. Não há desativar para o próprio usuário logado.
  function acoesDo(u: UsuarioEquipe): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Ver ficha', icone: 'perfil', aoClicar: () => setFicha(u.id) },
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(u) },
      { rotulo: 'Redefinir senha', icone: 'cadeado', aoClicar: () => setEditando(u) },
    ];
    if (u.id !== usuario?.id) {
      if (u.ativo) {
        acoes.push({
          rotulo: 'Desativar',
          icone: 'fechar',
          perigo: true,
          aoClicar: () => alternarAtivoLista(u, false),
        });
      } else {
        acoes.push({
          rotulo: 'Reativar',
          icone: 'perfil',
          aoClicar: () => alternarAtivoLista(u, true),
        });
      }
    }
    return acoes;
  }

  const lista = dados ?? [];
  const ativos = lista.filter((u) => u.ativo).length;
  const administradores = lista.filter((u) => u.perfil === 'GESTOR').length;

  return (
    <Pagina titulo="Usuários">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao
            rotulo="Perfil"
            valor={perfil}
            aoMudar={setPerfil}
            opcoes={PERFIS}
            vazio="Todos"
          />
          <Campo rotulo="Buscar por nome ou e-mail" valor={busca} aoMudar={setBusca} />
        </div>
        <Botao aoClicar={() => setNovo(true)}>Novo usuário</Botao>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="usuarios" cor="azul" valor={lista.length} rotulo="Usuários" />
          <ResumoItem icone="perfil" cor="verde" valor={ativos} rotulo="Ativos" />
          <ResumoItem icone="relogio" cor="vermelho" valor={lista.length - ativos} rotulo="Inativos" />
          <ResumoItem icone="cadeado" cor="roxo" valor={administradores} rotulo="Gestores" />
        </div>
      )}

      {carregando && <Carregando />}
      {dados && (
        <Tabela<UsuarioEquipe>
          chave={(u) => u.id}
          dados={dados}
          vazio="Nenhum usuário encontrado."
          aoClicarLinha={(u) => setFicha(u.id)}
          colunas={[
            {
              titulo: 'Usuário',
              celula: (u) => (
                <span className="usuario-celula">
                  <Avatar nome={u.nome} tamanho={36} />
                  <span>
                    <span>{u.nome}</span>
                    <span className="usuario-email">{u.email}</span>
                  </span>
                </span>
              ),
            },
            { titulo: 'Perfil', celula: (u) => <SeloPerfilUsuario perfil={u.perfil} /> },
            { titulo: 'Loja', celula: (u) => nomeDaLoja(u.lojaId) },
            { titulo: 'Telefone', celula: (u) => u.telefone ?? '—' },
            { titulo: 'Cadastro', celula: (u) => formatarData(u.criadoEm) },
            {
              titulo: 'Situação',
              celula: (u) =>
                u.ativo ? <Selo cor="verde">ATIVO</Selo> : <Selo cor="vermelho">INATIVO</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (u) => <MenuAcoes rotulo={'Ações de ' + u.nome} acoes={acoesDo(u)} />,
            },
          ]}
        />
      )}

      {ficha !== null && dados?.find((x) => x.id === ficha) && (
        <FichaUsuario
          key={ficha}
          usuario={dados.find((x) => x.id === ficha) as UsuarioEquipe}
          aoFechar={() => setFicha(null)}
          aoEditar={() => {
            const u = dados.find((x) => x.id === ficha) ?? null;
            setFicha(null);
            if (u) setEditando(u);
          }}
        />
      )}

      <Modal aberto={novo} titulo="Novo usuário" aoFechar={() => setNovo(false)}>
        {novo && (
          <FormNovoUsuario
            lojas={lojas}
            aoConcluir={() => {
              setNovo(false);
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal
        aberto={editando !== null}
        titulo={editando ? editando.nome : 'Usuário'}
        aoFechar={() => setEditando(null)}
      >
        {editando && (
          <DetalheUsuario
            key={editando.id}
            usuario={editando}
            lojas={lojas}
            aoAtualizado={(u) => {
              setEditando(u);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
