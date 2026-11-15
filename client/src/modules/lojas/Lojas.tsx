import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Carregando, Modal, Pagina, Selecao, Selo, formatarMoeda } from '../../ui';
import { OPCOES_TIPO_LOJA, rotuloTipoLoja } from './tipos';
import type { LojaDTO, ResumoLojaDTO, TipoLoja } from './tipos';
import './lojas.css';

// ---------- Utilitários ----------

// Texto vazio vira null; senão devolve o texto sem espaços das pontas.
function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Número do resumo: valor em destaque e rótulo pequeno.
function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="lojas-numero">
      <span className="lojas-numero-valor">{valor}</span>
      <span className="lojas-numero-rotulo">{rotulo}</span>
    </div>
  );
}

// ---------- Cartão de uma loja ----------

function CartaoLoja({ loja, aoEditar }: { loja: LojaDTO; aoEditar: () => void }) {
  const resumo = useDados<ResumoLojaDTO>(`/lojas/${loja.id}/resumo`);
  const r = resumo.dados;
  const localidade = [loja.cidade, loja.uf].filter(Boolean).join('/') || '—';

  return (
    <article className="lojas-cartao">
      <div className="lojas-cabecalho">
        <h2 className="lojas-nome">{loja.nome}</h2>
        <div className="lojas-selos">
          <Selo cor={loja.tipo === 'CENTRO_DISTRIBUICAO' ? 'amarelo' : 'azul'}>
            {rotuloTipoLoja(loja.tipo)}
          </Selo>
          <Selo cor={loja.ativa ? 'verde' : 'vermelho'}>{loja.ativa ? 'Ativa' : 'Inativa'}</Selo>
        </div>
      </div>

      <div className="lojas-dados">
        <div>{localidade}</div>
        <div>CNPJ: {loja.cnpj ?? '—'}</div>
      </div>

      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !r && <Carregando />}
      {r && (
        <div className="lojas-numeros">
          <Numero valor={formatarMoeda(r.vendasHoje)} rotulo="Vendas hoje" />
          <Numero valor={formatarMoeda(r.vendasMes)} rotulo="Vendas no mês" />
          <Numero valor={formatarMoeda(r.valorEstoque)} rotulo="Valor em estoque" />
          <Numero valor={String(r.usuarios)} rotulo={r.usuarios === 1 ? 'Pessoa na equipe' : 'Pessoas na equipe'} />
        </div>
      )}

      <div className="lojas-acoes">
        <Botao variante="secundario" aoClicar={aoEditar}>
          Editar
        </Botao>
      </div>
    </article>
  );
}

// ---------- Formulário (criar e editar) ----------

interface FormLoja {
  nome: string;
  tipo: TipoLoja;
  cnpj: string;
  telefone: string;
  endereco: string;
  cidade: string;
  uf: string;
  latitude: string;
  longitude: string;
  ativa: boolean;
}

function formularioDe(loja: LojaDTO | null): FormLoja {
  return {
    nome: loja?.nome ?? '',
    tipo: loja?.tipo ?? 'LOJA',
    cnpj: loja?.cnpj ?? '',
    telefone: loja?.telefone ?? '',
    endereco: loja?.endereco ?? '',
    cidade: loja?.cidade ?? '',
    uf: loja?.uf ?? '',
    latitude: loja?.latitude != null ? String(loja.latitude).replace('.', ',') : '',
    longitude: loja?.longitude != null ? String(loja.longitude).replace('.', ',') : '',
    ativa: loja?.ativa ?? true,
  };
}

function FormLojaEdicao({ loja, aoSalvo }: { loja: LojaDTO | null; aoSalvo: () => void }) {
  const [form, setForm] = useState<FormLoja>(() => formularioDe(loja));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function mudar(parcial: Partial<FormLoja>) {
    setForm((atual) => ({ ...atual, ...parcial }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    // Coordenadas: vazio é "sem coordenada"; digitado precisa ser número.
    const latitude = form.latitude.trim() === '' ? null : lerNumero(form.latitude);
    const longitude = form.longitude.trim() === '' ? null : lerNumero(form.longitude);
    if ((form.latitude.trim() !== '' && latitude === null) || (form.longitude.trim() !== '' && longitude === null)) {
      setErro('Latitude e longitude precisam ser números (ex.: -23,5505).');
      return;
    }

    const corpo = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      cnpj: textoOuNulo(form.cnpj),
      telefone: textoOuNulo(form.telefone),
      endereco: textoOuNulo(form.endereco),
      cidade: textoOuNulo(form.cidade),
      uf: textoOuNulo(form.uf),
      latitude,
      longitude,
      // "Ativa" só existe na edição; a loja nova nasce ativa.
      ...(loja ? { ativa: form.ativa } : {}),
    };

    setOcupado(true);
    try {
      if (loja) {
        await api.put(`/lojas/${loja.id}`, corpo);
      } else {
        await api.post('/lojas', corpo);
      }
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={form.nome} aoMudar={(v) => mudar({ nome: v })} obrigatorio />
      <Selecao
        rotulo="Tipo"
        valor={form.tipo}
        aoMudar={(v) => mudar({ tipo: v as TipoLoja })}
        opcoes={OPCOES_TIPO_LOJA}
      />
      <Campo rotulo="CNPJ" valor={form.cnpj} aoMudar={(v) => mudar({ cnpj: v })} />
      <Campo rotulo="Telefone" valor={form.telefone} aoMudar={(v) => mudar({ telefone: v })} />
      <Campo rotulo="Endereço" valor={form.endereco} aoMudar={(v) => mudar({ endereco: v })} />
      <div className="lojas-formulario-linha">
        <Campo rotulo="Cidade" valor={form.cidade} aoMudar={(v) => mudar({ cidade: v })} />
        <Campo rotulo="UF" valor={form.uf} aoMudar={(v) => mudar({ uf: v })} />
      </div>
      <div className="lojas-formulario-linha">
        <Campo rotulo="Latitude" valor={form.latitude} aoMudar={(v) => mudar({ latitude: v })} />
        <Campo rotulo="Longitude" valor={form.longitude} aoMudar={(v) => mudar({ longitude: v })} />
      </div>
      {loja && (
        <Caixa rotulo="Loja ativa" marcado={form.ativa} aoMudar={(v) => mudar({ ativa: v })} />
      )}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Lojas() {
  const { dados, carregando, erro, recarregar } = useDados<LojaDTO[]>('/lojas');
  // null: fechado; 'nova': formulário de loja nova; objeto: editar esta loja.
  const [editando, setEditando] = useState<LojaDTO | 'nova' | null>(null);
  const lojas = dados ?? [];

  const tituloModal =
    editando === null ? '' : editando === 'nova' ? 'Nova loja' : `Editar ${editando.nome}`;

  return (
    <Pagina
      titulo="Lojas e centros de distribuição"
      acoes={<Botao aoClicar={() => setEditando('nova')}>Nova loja</Botao>}
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && lojas.length === 0 && <p className="lojas-vazio">Nenhuma loja cadastrada.</p>}
      {lojas.length > 0 && (
        <div className="lojas-grade">
          {lojas.map((loja) => (
            <CartaoLoja key={loja.id} loja={loja} aoEditar={() => setEditando(loja)} />
          ))}
        </div>
      )}

      <Modal aberto={editando !== null} titulo={tituloModal} aoFechar={() => setEditando(null)}>
        {editando !== null && (
          <FormLojaEdicao
            key={editando === 'nova' ? 'nova' : editando.id}
            loja={editando === 'nova' ? null : editando}
            aoSalvo={() => {
              setEditando(null);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
