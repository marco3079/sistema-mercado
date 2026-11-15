import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Caixa, Campo, Cartao, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { FotoProduto } from '../../ui/FotoProduto';
import type { CategoriaDTO } from './tipos';
import { SETORES, useProdutosCompletos } from './tipos';
import './produtos.css';

// Cadastro de categorias (GESTOR e COMPRADOR) em cartões. Categoria com produtos não pode ser excluída.
export function TelaCategorias() {
  const { dados, carregando, erro, recarregar } = useDados<CategoriaDTO[]>('/categorias');
  const todos = useProdutosCompletos();
  const [editando, setEditando] = useState<CategoriaDTO | 'nova' | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [movendo, setMovendo] = useState(false);

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

  // Sobe ou desce a categoria trocando de lugar com a vizinha; grava a ordem nova (0, 1, 2...) só onde mudou.
  async function mover(categoria: CategoriaDTO, direcao: -1 | 1) {
    const lista = dados ?? [];
    const i = lista.findIndex((c) => c.id === categoria.id);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setAviso(null);
    setMovendo(true);
    try {
      for (let k = 0; k < nova.length; k++) {
        if (nova[k].ordem !== k) await api.put<CategoriaDTO>(`/categorias/${nova[k].id}`, { ordem: k });
      }
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setMovendo(false);
      recarregar();
    }
  }

  const produtos = todos.dados ?? [];
  const lista = dados ?? [];

  return (
    <Pagina titulo="Categorias" acoes={<Botao aoClicar={() => setEditando('nova')}>Nova categoria</Botao>}>
      {aviso && <Aviso tipo={aviso.tipo === 'erro' ? 'erro' : 'sucesso'}>{aviso.texto}</Aviso>}
      {movendo && <Aviso tipo="info">Salvando a nova ordem...</Aviso>}
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {!carregando && !erro && dados && lista.length === 0 && (
        <Cartao>
          <p className="produtos-legenda">Nenhuma categoria cadastrada.</p>
        </Cartao>
      )}

      {dados && lista.length > 0 && (
        <div className="produtos-cat-grade">
          {lista.map((c, i) => {
            // Até 4 fotos de produtos desta categoria (com foto cadastrada).
            const miniaturas = produtos.filter((p) => p.categoriaId === c.id && p.foto).slice(0, 4);
            const acoes: AcaoMenu[] = [];
            if (i > 0) acoes.push({ rotulo: 'Subir', icone: 'seta-cima', aoClicar: () => mover(c, -1) });
            if (i < lista.length - 1) acoes.push({ rotulo: 'Descer', icone: 'seta-baixo', aoClicar: () => mover(c, 1) });
            acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(c) });

            return (
              <article key={c.id} className="produtos-cat-cartao">
                <div className="produtos-cat-topo">
                  <FotoProduto nome={c.nome} setor={c.setor ?? c.nome} tamanho={64} />
                  {c.ativa ? <Selo cor="verde">Ativa</Selo> : <Selo cor="cinza">Inativa</Selo>}
                </div>
                <div className="produtos-cat-texto">
                  <h3>{c.nome}</h3>
                  <span>
                    {c.setor ?? 'Sem setor'} · {c.totalProdutos} produto(s)
                  </span>
                </div>
                {miniaturas.length > 0 && (
                  <div className="produtos-cat-miniaturas">
                    {miniaturas.map((p) => (
                      <FotoProduto key={p.id} foto={p.foto} nome={p.nome} setor={c.setor ?? c.nome} tamanho={40} />
                    ))}
                  </div>
                )}
                <div className="produtos-cat-rodape">
                  <Botao variante="secundario" desabilitado={movendo} aoClicar={() => setEditando(c)}>
                    Editar
                  </Botao>
                  <MenuAcoes rotulo={`Mais ações de ${c.nome}`} acoes={acoes} />
                </div>
              </article>
            );
          })}
        </div>
      )}

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
