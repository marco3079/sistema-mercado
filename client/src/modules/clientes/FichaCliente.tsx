import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { lerNumero, mensagemErro, ROTULOS_ORIGEM_VENDA } from '../../lib/mercado';
import {
  Abas,
  AreaTexto,
  Aviso,
  Botao,
  Campo,
  Cartao,
  Carregando,
  Grade,
  Modal,
  Selecao,
  Selo,
  Tabela,
  formatarDataHora,
  formatarMoeda,
} from '../../ui';
import type { ClienteDetalheDTO, ClienteDTO, TipoCliente } from './tipos';
import './clientes.css';

// Só dígitos de um texto (CPF/CNPJ, telefone).
export function soDigitos(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\D/g, '');
}

// (11) 99999-0000 ou (11) 9999-0000. O que não for telefone aparece como foi gravado.
export function formatarTelefone(telefone: string | null): string {
  if (!telefone) return '—';
  const d = soDigitos(telefone);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
}

// 000.000.000-00 ou 00.000.000/0000-00.
export function formatarCpfCnpj(documento: string | null): string {
  if (!documento) return '—';
  const d = soDigitos(documento);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return documento;
}

export const ROTULO_TIPO: Record<TipoCliente, string> = { VAREJO: 'Varejo', ATACADO: 'Atacado' };

// Campos do formulário, todos como texto (o número é convertido na hora de enviar).
export interface Formulario {
  nome: string;
  tipo: TipoCliente;
  cpfCnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  telefone: string;
  whatsapp: string;
  email: string;
  cep: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  latitude: string;
  longitude: string;
  limiteCredito: string;
  observacoes: string;
  vendedorId: string;
}

function numeroTexto(valor: number | null): string {
  return valor === null ? '' : String(valor).replace('.', ',');
}

function formularioDe(c: ClienteDTO | null): Formulario {
  return {
    nome: c?.nome ?? '',
    tipo: c?.tipo ?? 'VAREJO',
    cpfCnpj: c?.cpfCnpj ?? '',
    razaoSocial: c?.razaoSocial ?? '',
    inscricaoEstadual: c?.inscricaoEstadual ?? '',
    telefone: c?.telefone ?? '',
    whatsapp: c?.whatsapp ?? '',
    email: c?.email ?? '',
    cep: c?.cep ?? '',
    endereco: c?.endereco ?? '',
    numero: c?.numero ?? '',
    bairro: c?.bairro ?? '',
    cidade: c?.cidade ?? '',
    uf: c?.uf ?? '',
    latitude: numeroTexto(c?.latitude ?? null),
    longitude: numeroTexto(c?.longitude ?? null),
    limiteCredito: numeroTexto(c?.limiteCredito ?? 0),
    observacoes: c?.observacoes ?? '',
    vendedorId: c?.vendedorId ? String(c.vendedorId) : '',
  };
}

// Corpo enviado à API (POST e PUT de /clientes).
function corpoDo(f: Formulario) {
  const texto = (valor: string) => valor.trim() || null;
  return {
    nome: f.nome.trim(),
    tipo: f.tipo,
    cpfCnpj: soDigitos(f.cpfCnpj) || null,
    razaoSocial: texto(f.razaoSocial),
    inscricaoEstadual: texto(f.inscricaoEstadual),
    telefone: texto(f.telefone),
    whatsapp: texto(f.whatsapp),
    email: texto(f.email),
    cep: texto(f.cep),
    endereco: texto(f.endereco),
    numero: texto(f.numero),
    bairro: texto(f.bairro),
    cidade: texto(f.cidade),
    uf: texto(f.uf)?.toUpperCase() ?? null,
    latitude: lerNumero(f.latitude),
    longitude: lerNumero(f.longitude),
    limiteCredito: lerNumero(f.limiteCredito) ?? 0,
    observacoes: texto(f.observacoes),
    vendedorId: f.vendedorId ? Number(f.vendedorId) : null,
  };
}

// Primeiro problema do formulário, para mostrar antes de enviar. Null se estiver certo.
function problemaDo(f: Formulario): string | null {
  if (f.nome.trim() === '') return 'Informe o nome.';
  const documento = soDigitos(f.cpfCnpj);
  if (documento !== '' && documento.length !== 11 && documento.length !== 14) {
    return 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos.';
  }
  if (f.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
    return 'Informe um e-mail válido.';
  }
  const limite = lerNumero(f.limiteCredito.trim() === '' ? '0' : f.limiteCredito);
  if (limite === null || limite < 0) return 'Informe um limite de crédito válido (zero ou mais).';
  if (f.latitude.trim() !== '' && lerNumero(f.latitude) === null) return 'Latitude inválida.';
  if (f.longitude.trim() !== '' && lerNumero(f.longitude) === null) return 'Longitude inválida.';
  return null;
}

interface PropsConteudo {
  cliente: ClienteDetalheDTO | null; // null = cadastro novo
  podeEditar: boolean;
  gestor: boolean;
  vendedorLogado: boolean; // o vendedor não escolhe outro vendedor: o servidor usa ele mesmo
  aoFechar(): void;
  aoSalvo(mensagem: string): void;
  aoAtualizar(): void;
}

// Corpo da ficha. Fica montado com o cliente já carregado (a chave muda com o cliente).
function ConteudoFicha({ cliente, podeEditar, gestor, vendedorLogado, aoFechar, aoSalvo, aoAtualizar }: PropsConteudo) {
  const novo = cliente === null;
  const [aba, setAba] = useState('dados');
  const [form, setForm] = useState<Formulario>(() => formularioDe(cliente));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const vendedores = useDados<{ id: number; nome: string }[]>(
    podeEditar && !vendedorLogado ? '/lojas/equipe?perfil=VENDEDOR' : null,
  );

  function atualizar<K extends keyof Formulario>(chave: K) {
    return (valor: string) => setForm((f) => ({ ...f, [chave]: valor }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const problema = problemaDo(form);
    if (problema) {
      setErro(problema);
      return;
    }
    setEnviando(true);
    try {
      const corpo = corpoDo(form);
      if (cliente) {
        await api.put(`/clientes/${cliente.id}`, corpo);
        aoSalvo(`${corpo.nome} atualizado.`);
      } else {
        await api.post('/clientes', corpo);
        aoSalvo(`${corpo.nome} cadastrado.`);
      }
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  async function alternarBloqueio() {
    if (!cliente) return;
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/clientes/${cliente.id}/bloquear`, { bloqueado: !cliente.bloqueado });
      setAviso(cliente.bloqueado ? 'Fiado liberado.' : 'Fiado bloqueado.');
      aoAtualizar();
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  // Gera um código novo a partir do cliente salvo (não do que está digitado).
  async function gerarCodigoB2B() {
    if (!cliente) return;
    setErro(null);
    setAviso(null);
    try {
      await api.put(`/clientes/${cliente.id}`, { ...corpoDo(formularioDe(cliente)), gerarNovoCodigoB2B: true });
      setAviso('Novo código B2B gerado.');
      aoAtualizar();
    } catch (err) {
      setErro(mensagemErro(err));
    }
  }

  async function copiarLink(link: string) {
    setErro(null);
    setAviso(null);
    try {
      await navigator.clipboard.writeText(link);
      setAviso('Link copiado.');
    } catch {
      setErro('Não foi possível copiar. Copie o link manualmente.');
    }
  }

  const abas = novo
    ? [{ id: 'dados', rotulo: 'Dados' }]
    : [
        { id: 'dados', rotulo: 'Dados' },
        { id: 'credito', rotulo: 'Crédito' },
        { id: 'b2b', rotulo: 'B2B' },
        { id: 'compras', rotulo: 'Compras' },
      ];

  const escrevendo = podeEditar && (novo || aba === 'dados' || aba === 'credito');
  const campo = (rotulo: string, chave: keyof Formulario) => (
    <Campo rotulo={rotulo} valor={form[chave]} aoMudar={atualizar(chave)} />
  );

  return (
    <form onSubmit={salvar} className="clientes-ficha">
      {abas.length > 1 && <Abas abas={abas} ativa={aba} aoMudar={setAba} />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      {aba === 'dados' && (
        <>
          {podeEditar ? (
            <Grade>
              <Selecao
                rotulo="Tipo"
                valor={form.tipo}
                aoMudar={(v) => setForm((f) => ({ ...f, tipo: v === 'ATACADO' ? 'ATACADO' : 'VAREJO' }))}
                opcoes={[
                  { valor: 'VAREJO', rotulo: 'Varejo' },
                  { valor: 'ATACADO', rotulo: 'Atacado (B2B)' },
                ]}
              />
              {campo('Nome', 'nome')}
              {campo('CPF/CNPJ', 'cpfCnpj')}
              {campo('Razão social', 'razaoSocial')}
              {campo('Inscrição estadual', 'inscricaoEstadual')}
              {campo('Telefone', 'telefone')}
              {campo('WhatsApp', 'whatsapp')}
              {campo('E-mail', 'email')}
              {campo('CEP', 'cep')}
              {campo('Endereço', 'endereco')}
              {campo('Número', 'numero')}
              {campo('Bairro', 'bairro')}
              {campo('Cidade', 'cidade')}
              {campo('UF', 'uf')}
              {campo('Latitude', 'latitude')}
              {campo('Longitude', 'longitude')}
              {!vendedorLogado && (
                <Selecao
                  rotulo="Vendedor da carteira"
                  valor={form.vendedorId}
                  aoMudar={atualizar('vendedorId')}
                  vazio="Sem vendedor"
                  opcoes={(vendedores.dados ?? []).map((v) => ({ valor: String(v.id), rotulo: v.nome }))}
                />
              )}
            </Grade>
          ) : (
            cliente && (
              <dl className="clientes-leitura">
                {(
                  [
                    ['Tipo', ROTULO_TIPO[cliente.tipo]],
                    ['CPF/CNPJ', formatarCpfCnpj(cliente.cpfCnpj)],
                    ['Telefone', formatarTelefone(cliente.telefone)],
                    ['WhatsApp', formatarTelefone(cliente.whatsapp)],
                    ['E-mail', cliente.email ?? '—'],
                    [
                      'Endereço',
                      [cliente.endereco, cliente.numero, cliente.bairro, cliente.cidade, cliente.uf].filter(Boolean).join(', ') || '—',
                    ],
                  ] as [string, string][]
                ).map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <dt>{rotulo}</dt>
                    <dd>{valor}</dd>
                  </div>
                ))}
              </dl>
            )
          )}
          {podeEditar && <AreaTexto rotulo="Observações" valor={form.observacoes} aoMudar={atualizar('observacoes')} />}
        </>
      )}

      {aba === 'credito' && cliente && (
        <>
          <Grade>
            {podeEditar ? (
              campo('Limite de crédito (R$)', 'limiteCredito')
            ) : (
              <p>Limite de crédito: {formatarMoeda(cliente.limiteCredito)}</p>
            )}
          </Grade>
          <p>
            Saldo devedor:{' '}
            <strong className={cliente.saldoDevedor > 0 ? 'clientes-devendo' : undefined}>
              {formatarMoeda(cliente.saldoDevedor)}
            </strong>
          </p>
          <p>Disponível para fiado: {formatarMoeda(Math.max(0, cliente.limiteCredito - cliente.saldoDevedor))}</p>
          <p>
            Situação: <Selo cor={cliente.bloqueado ? 'vermelho' : 'verde'}>{cliente.bloqueado ? 'Bloqueado' : 'Liberado'}</Selo>
          </p>
          {gestor && (
            <div className="pagina-acoes">
              <Botao variante={cliente.bloqueado ? 'secundario' : 'perigo'} aoClicar={alternarBloqueio}>
                {cliente.bloqueado ? 'Liberar fiado' : 'Bloquear fiado'}
              </Botao>
            </div>
          )}
        </>
      )}

      {aba === 'b2b' && cliente && (
        <>
          <p>
            Código de acesso à loja B2B: <strong>{cliente.codigoB2B ?? 'ainda não gerado'}</strong>
          </p>
          {cliente.codigoB2B && (
            <>
              <p className="clientes-link">{`${window.location.origin}/b2b/${cliente.codigoB2B}`}</p>
              <div className="pagina-acoes">
                <Botao
                  variante="secundario"
                  aoClicar={() => copiarLink(`${window.location.origin}/b2b/${cliente.codigoB2B}`)}
                >
                  Copiar link
                </Botao>
                {podeEditar && (
                  <Botao variante="perigo" aoClicar={gerarCodigoB2B}>
                    Gerar novo código
                  </Botao>
                )}
              </div>
            </>
          )}
          {!cliente.codigoB2B && podeEditar && (
            <Botao variante="secundario" aoClicar={gerarCodigoB2B}>
              Gerar código
            </Botao>
          )}
        </>
      )}

      {aba === 'compras' && cliente && (
        <>
          <div className="clientes-indicadores">
            <Cartao titulo="Total comprado (12 meses)">
              <strong>{formatarMoeda(cliente.totalComprado)}</strong>
            </Cartao>
            <Cartao titulo="Ticket médio">
              <strong>{formatarMoeda(cliente.ticketMedio)}</strong>
            </Cartao>
          </div>
          <Tabela
            dados={cliente.ultimasCompras}
            chave={(c) => c.id}
            vazio="Nenhuma compra ainda."
            colunas={[
              { titulo: 'Venda', celula: (c) => `Nº ${c.numero}` },
              { titulo: 'Data', celula: (c) => formatarDataHora(c.criadoEm) },
              { titulo: 'Origem', celula: (c) => ROTULOS_ORIGEM_VENDA[c.origem] ?? c.origem },
              { titulo: 'Total', alinhar: 'direita', celula: (c) => formatarMoeda(c.total) },
            ]}
          />
        </>
      )}

      {escrevendo && (
        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={enviando}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Fechar
          </Botao>
        </div>
      )}
    </form>
  );
}

// Ficha do cliente em janela: dados, crédito, código B2B e compras. Cadastro novo quando clienteId é null.
export function FichaCliente({
  clienteId,
  podeEditar,
  gestor,
  vendedorLogado,
  aoFechar,
  aoSalvo,
}: {
  clienteId: number | null;
  podeEditar: boolean;
  gestor: boolean;
  vendedorLogado: boolean;
  aoFechar(): void;
  aoSalvo(mensagem: string): void;
}) {
  const ficha = useDados<ClienteDetalheDTO>(clienteId === null ? null : `/clientes/${clienteId}`);
  const cliente = ficha.dados;
  const titulo = clienteId === null ? 'Novo cliente' : (cliente?.nome ?? 'Cliente');

  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar}>
      {ficha.erro && <Aviso tipo="erro">{ficha.erro}</Aviso>}
      {clienteId !== null && ficha.carregando && !cliente && <Carregando />}
      {(clienteId === null || cliente) && (
        <ConteudoFicha
          key={cliente?.id ?? 'novo'}
          cliente={cliente}
          podeEditar={podeEditar}
          gestor={gestor}
          vendedorLogado={vendedorLogado}
          aoFechar={aoFechar}
          aoSalvo={aoSalvo}
          aoAtualizar={ficha.recarregar}
        />
      )}
    </Modal>
  );
}
