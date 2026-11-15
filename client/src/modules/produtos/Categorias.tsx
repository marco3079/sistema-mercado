import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Caixa, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import type { CategoriaDTO } from './tipos';
import { SETORES } from './tipos';
import './produtos.css';

// Cadastro de categorias (GESTOR e COMPRADOR). Categoria com produtos não pode ser excluída.
export function TelaCategorias() {
  const { dados, carregando, erro, recarregar } = useDados<CategoriaDTO[]>('/categorias');
  const [editando, setEditando] = useState<CategoriaDTO | 'nova' | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  async function excluir(categoria: CategoriaDTO) {
    if (!window.confirm(`Excluir a categoria ${categoria.nome}?`)) return;
    setAviso(null);
    try {
      await api.del(`/categorias/${categoria.id}`);
      setAviso({ tipo: 'sucesso', texto: `Categoria ${categoria.nome} excluída.` });
      recarregar();
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    }
  }

  const colunas: ColunaTabela<CategoriaDTO>[] = [
    { titulo: 'Nome', celula: (c) => <strong>{c.nome}</strong> },
    { titulo: 'Setor', celula: (c) => c.setor ?? '-' },
    { titulo: 'Ordem', alinhar: 'direita', celula: (c) => c.ordem },
    { titulo: 'Produtos', alinhar: 'direita', celula: (c) => c.totalProdutos },
    { titulo: 'Situação', celula: (c) => (c.ativa ? <Selo cor="verde">Ativa</Selo> : <Selo cor="cinza">Inativa</Selo>) },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (c) => (
        <>
          <Botao variante="texto" aoClicar={() => setEditando(c)}>
            Editar
          </Botao>
          <Botao variante="texto" aoClicar={() => excluir(c)}>
            Excluir
          </Botao>
        </>
      ),
    },
  ];

  return (
    <Pagina
      titulo="Categorias"
      acoes={<Botao aoClicar={() => setEditando('nova')}>Nova categoria</Botao>}
    >
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
      <Cartao>
        {carregando && <Carregando />}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!carregando && !erro && dados && (
          <Tabela colunas={colunas} dados={dados} chave={(c) => c.id} vazio="Nenhuma categoria cadastrada." />
        )}
      </Cartao>

      {editando && (
        <FormularioCategoria
          categoria={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setAviso({ tipo: 'sucesso', texto: mensagem });
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

function FormularioCategoria({
  categoria,
  aoFechar,
  aoSalvo,
}: {
  categoria: CategoriaDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [setor, setSetor] = useState(categoria?.setor ?? '');
  const [ordem, setOrdem] = useState(categoria ? String(categoria.ordem) : '0');
  const [ativa, setAtiva] = useState(categoria?.ativa ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      setErro('Informe o nome da categoria.');
      return;
    }
    const ordemNumero = ordem.trim() === '' ? 0 : lerNumero(ordem);
    if (ordemNumero === null || ordemNumero < 0) {
      setErro('Ordem inválida.');
      return;
    }
    const corpo = { nome: nomeLimpo, setor: setor || null, ordem: Math.round(ordemNumero), ativa };
    setEnviando(true);
    try {
      if (categoria) {
        await api.put<CategoriaDTO>(`/categorias/${categoria.id}`, corpo);
        aoSalvo(`Categoria ${nomeLimpo} atualizada.`);
      } else {
        await api.post<CategoriaDTO>('/categorias', corpo);
        aoSalvo(`Categoria ${nomeLimpo} criada.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={categoria ? 'Editar categoria' : 'Nova categoria'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Selecao
          rotulo="Setor"
          valor={setor}
          aoMudar={setSetor}
          opcoes={SETORES.map((s) => ({ valor: s, rotulo: s }))}
          vazio="Sem setor"
        />
        <Campo rotulo="Ordem na lista" valor={ordem} aoMudar={setOrdem} />
        <Caixa rotulo="Categoria ativa" marcado={ativa} aoMudar={setAtiva} />
        <div className="produtos-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
