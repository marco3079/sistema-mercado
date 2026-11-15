import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Carregando, Modal, Pagina, Selecao, Selo, formatarMoeda } from '../../ui';
import { MapaOSM } from '../../ui/MapaOSM';
import { OPCOES_TIPO_LOJA, rotuloTipoLoja } from './tipos';
import type { LojaDTO, ResumoLojaDTO, TipoLoja } from './tipos';
import './lojas.css';

// ---------- Utilitários ----------

// Texto vazio vira null; senão devolve o texto sem espaços das pontas.
function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Endereço em duas linhas: "Rua X, 123 — Bairro" / "Cidade/UF · CEP 00000-000".
function enderecoDe(loja: LojaDTO): { linha1: string; linha2: string } {
  const logradouro = [loja.endereco, loja.numero].filter(Boolean).join(', ');
  const linha1 = [[logradouro, loja.complemento].filter(Boolean).join(' '), loja.bairro]
    .filter(Boolean)
    .join(' — ');
  const linha2 = [[loja.cidade, loja.uf].filter(Boolean).join('/'), loja.cep ? `CEP ${loja.cep}` : '']
    .filter(Boolean)
    .join(' · ');
  return { linha1: linha1 || 'Endereço não cadastrado', linha2 };
}

// Coordenadas digitadas no formulário, se as duas forem números válidos.
function coordenadasDoForm(form: FormLoja): { lat: number; lng: number } | null {
  const lat = lerNumero(form.latitude);
  const lng = lerNumero(form.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
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

function CartaoLoja({
  loja,
  aoEditar,
  aoVerNoMapa,
}: {
  loja: LojaDTO;
  aoEditar: () => void;
  aoVerNoMapa: () => void;
}) {
  const resumo = useDados<ResumoLojaDTO>(`/lojas/${loja.id}/resumo`);
  const r = resumo.dados;
  const endereco = enderecoDe(loja);
  const temCoordenadas = loja.latitude != null && loja.longitude != null;

  return (
    <article className="lojas-cartao">
      <div className="lojas-cabecalho">
        <h2 className="lojas-nome">{loja.nome}</h2>
        <div className="lojas-selos">
          <span className={`selo ${loja.tipo === 'CENTRO_DISTRIBUICAO' ? 'mapas-lojas-selo-roxo' : 'selo-azul'}`}>
            {loja.tipo === 'CENTRO_DISTRIBUICAO' ? 'CD' : 'Loja'}
          </span>
          <Selo cor={loja.ativa ? 'verde' : 'vermelho'}>{loja.ativa ? 'Ativa' : 'Inativa'}</Selo>
        </div>
      </div>

      <div className="lojas-dados">
        <div>{rotuloTipoLoja(loja.tipo)}</div>
        <div>{endereco.linha1}</div>
        {endereco.linha2 && <div>{endereco.linha2}</div>}
        {loja.horario && <div>Horário: {loja.horario}</div>}
        {loja.telefone && <div>Telefone: {loja.telefone}</div>}
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
        <Botao variante="texto" aoClicar={aoVerNoMapa}>
          Ver no mapa
        </Botao>
        {temCoordenadas && (
          <a
            className="lojas-link"
            href={`https://www.google.com/maps/dir/?api=1&destination=${loja.latitude},${loja.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Como chegar
          </a>
        )}
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
  horario: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
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
    horario: loja?.horario ?? '',
    cep: loja?.cep ?? '',
    endereco: loja?.endereco ?? '',
    numero: loja?.numero ?? '',
    complemento: loja?.complemento ?? '',
    bairro: loja?.bairro ?? '',
    cidade: loja?.cidade ?? '',
    uf: loja?.uf ?? '',
    latitude: loja?.latitude != null ? String(loja.latitude).replace('.', ',') : '',
    longitude: loja?.longitude != null ? String(loja.longitude).replace('.', ',') : '',
    ativa: loja?.ativa ?? true,
  };
}

// Texto de busca: logradouro + número, bairro, cidade, UF, CEP e Brasil. Sem logradouro nem cidade, não busca.
function enderecoParaBusca(form: FormLoja): string | null {
  const logradouro = [form.endereco.trim(), form.numero.trim()].filter(Boolean).join(', ');
  if (!logradouro && !form.cidade.trim()) return null;
  return [logradouro, form.bairro.trim(), form.cidade.trim(), form.uf.trim(), form.cep.trim(), 'Brasil']
    .filter(Boolean)
    .join(', ');
}

interface AvisoBusca {
  tipo: 'erro' | 'sucesso' | 'info';
  texto: string;
}

function FormLojaEdicao({ loja, aoSalvo }: { loja: LojaDTO | null; aoSalvo: () => void }) {
  const [form, setForm] = useState<FormLoja>(() => formularioDe(loja));
  const [ocupado, setOcupado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoBusca, setAvisoBusca] = useState<AvisoBusca | null>(null);
  const coordenadas = coordenadasDoForm(form);

  function mudar(parcial: Partial<FormLoja>) {
    setForm((atual) => ({ ...atual, ...parcial }));
  }

  // Busca o endereço no OpenStreetMap (Nominatim), direto do navegador, e preenche latitude e longitude.
  async function buscarCoordenadas() {
    setAvisoBusca(null);
    const endereco = enderecoParaBusca(form);
    if (!endereco) {
      setAvisoBusca({ tipo: 'erro', texto: 'Informe o logradouro ou a cidade para buscar.' });
      return;
    }
    setBuscando(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`;
      const resposta = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resposta.ok) {
        throw new Error('busca indisponível');
      }
      const achados = (await resposta.json()) as { lat: string; lon: string }[];
      if (achados.length === 0) {
        setAvisoBusca({
          tipo: 'info',
          texto: 'Não achamos esse endereço no mapa. Confira os dados ou digite as coordenadas.',
        });
        return;
      }
      mudar({
        latitude: String(Number(achados[0].lat)).replace('.', ','),
        longitude: String(Number(achados[0].lon)).replace('.', ','),
      });
      setAvisoBusca({ tipo: 'sucesso', texto: 'Coordenadas preenchidas. Confira a posição no mapa abaixo.' });
    } catch {
      setAvisoBusca({
        tipo: 'erro',
        texto: 'Não foi possível buscar as coordenadas agora. Tente de novo ou digite manualmente.',
      });
    } finally {
      setBuscando(false);
    }
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
      horario: textoOuNulo(form.horario),
      cep: textoOuNulo(form.cep),
      endereco: textoOuNulo(form.endereco),
      numero: textoOuNulo(form.numero),
      complemento: textoOuNulo(form.complemento),
      bairro: textoOuNulo(form.bairro),
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
    <form onSubmit={salvar} className="lojas-form">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <section className="lojas-secao">
        <h3 className="lojas-secao-titulo">Identificação</h3>
        <div className="lojas-campos">
          <Campo rotulo="Nome" valor={form.nome} aoMudar={(v) => mudar({ nome: v })} obrigatorio />
          <Selecao
            rotulo="Tipo"
            valor={form.tipo}
            aoMudar={(v) => mudar({ tipo: v as TipoLoja })}
            opcoes={OPCOES_TIPO_LOJA}
          />
          <Campo rotulo="CNPJ" valor={form.cnpj} aoMudar={(v) => mudar({ cnpj: v })} />
          <Campo rotulo="Telefone" valor={form.telefone} aoMudar={(v) => mudar({ telefone: v })} />
          <div className="lojas-campo-larga">
            <Campo
              rotulo="Horário de funcionamento"
              placeholder="Ex.: Seg a sáb 7h–21h, dom 7h–13h"
              valor={form.horario}
              aoMudar={(v) => mudar({ horario: v })}
            />
          </div>
        </div>
        {loja && <Caixa rotulo="Loja ativa" marcado={form.ativa} aoMudar={(v) => mudar({ ativa: v })} />}
      </section>

      <section className="lojas-secao">
        <h3 className="lojas-secao-titulo">Endereço</h3>
        <div className="lojas-campos">
          <div className="lojas-campo-larga">
            <Campo rotulo="Logradouro" valor={form.endereco} aoMudar={(v) => mudar({ endereco: v })} />
          </div>
          <Campo rotulo="Número" valor={form.numero} aoMudar={(v) => mudar({ numero: v })} />
          <Campo rotulo="Complemento" valor={form.complemento} aoMudar={(v) => mudar({ complemento: v })} />
          <Campo rotulo="Bairro" valor={form.bairro} aoMudar={(v) => mudar({ bairro: v })} />
          <Campo rotulo="Cidade" valor={form.cidade} aoMudar={(v) => mudar({ cidade: v })} />
          <Campo rotulo="UF" valor={form.uf} aoMudar={(v) => mudar({ uf: v })} />
          <Campo rotulo="CEP" valor={form.cep} aoMudar={(v) => mudar({ cep: v })} />
        </div>
      </section>

      <section className="lojas-secao">
        <h3 className="lojas-secao-titulo">Localização</h3>
        <div className="lojas-campos">
          <Campo
            rotulo="Latitude"
            placeholder="-23,5505"
            valor={form.latitude}
            aoMudar={(v) => mudar({ latitude: v })}
          />
          <Campo
            rotulo="Longitude"
            placeholder="-46,6333"
            valor={form.longitude}
            aoMudar={(v) => mudar({ longitude: v })}
          />
        </div>
        <div className="lojas-acoes">
          <Botao variante="secundario" desabilitado={buscando} aoClicar={buscarCoordenadas}>
            {buscando ? 'Buscando...' : 'Buscar coordenadas pelo endereço'}
          </Botao>
        </div>
        {avisoBusca && <Aviso tipo={avisoBusca.tipo}>{avisoBusca.texto}</Aviso>}
        {coordenadas && (
          <div className="lojas-previa">
            <MapaOSM
              key={`${coordenadas.lat},${coordenadas.lng}`}
              altura={220}
              pontos={[
                {
                  id: 'previa',
                  lat: coordenadas.lat,
                  lng: coordenadas.lng,
                  titulo: form.nome.trim() || 'Loja',
                  subtitulo: form.endereco.trim() || undefined,
                  cor: 'azul',
                  icone: 'loja',
                },
              ]}
            />
          </div>
        )}
      </section>

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
  const navegar = useNavigate();
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
            <CartaoLoja
              key={loja.id}
              loja={loja}
              aoEditar={() => setEditando(loja)}
              aoVerNoMapa={() => navegar(`${RAIZ_DO_PERFIL.GESTOR}/mapa?loja=${loja.id}`)}
            />
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
