import { useEffect, useState } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Pagina, Selecao, Selo, Tabela, formatarDataHora, formatarMoeda } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import type { ResultadoEnvioDTO, ResumoMesDTO } from './tipos';

const MESES_NA_LISTA = 12;
const NOMES_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Mês (AAAA-MM) deslocado `n` meses em relação a hoje.
function mesDeslocado(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "novembro de 2026" (com a primeira letra maiúscula).
function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split('-');
  const nome = NOMES_MESES[Number(numero) - 1] ?? numero;
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

// Cartão de número do topo (classes .resumo da casca).
function Indicador({
  icone,
  cor,
  valor,
  rotulo,
  pequeno,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'verde' | 'laranja' | 'roxo' | 'vermelho';
  valor: string;
  rotulo: string;
  pequeno?: boolean;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className={pequeno ? 'resumo-valor fiscal-resumo-texto' : 'resumo-valor'}>{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

function SeloEnvio({ resumo }: { resumo: ResumoMesDTO }) {
  if (resumo.enviadoEm) return <Selo cor="verde">Enviado em {formatarDataHora(resumo.enviadoEm)}</Selo>;
  if (resumo.notas === 0) return <Selo cor="cinza">Sem notas</Selo>;
  return <Selo cor="amarelo">Não enviado</Selo>;
}

interface LinhaMes extends ResumoMesDTO {
  chave: string; // AAAA-MM
}

export function Contador() {
  const { usuario } = useAuth();
  const eGestor = usuario?.perfil === 'GESTOR';

  const meses = Array.from({ length: MESES_NA_LISTA }, (_, i) => mesDeslocado(-i));
  const [mes, setMes] = useState(meses[0]);
  const resumo = useDados<ResumoMesDTO>(`/contador/arquivos?mes=${mes}`);
  const [linhas, setLinhas] = useState<LinhaMes[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  // Resumo dos últimos 12 meses para a tabela (uma consulta por mês, em paralelo).
  useEffect(() => {
    let ativo = true;
    Promise.all(
      meses.map((m) =>
        api
          .get<ResumoMesDTO>(`/contador/arquivos?mes=${m}`)
          .then((r) => ({ ...r, chave: m }))
          .catch(() => null),
      ),
    ).then((lista) => {
      if (ativo) setLinhas(lista.filter((l): l is LinhaMes => l !== null));
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);

  async function baixarZip(m: string) {
    setErro(null);
    setAviso(null);
    setBaixando(m);
    try {
      await baixarArquivo(`/contador/arquivos/${m}.zip`, `notas-${m}.zip`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setBaixando(null);
    }
  }

  async function enviarAviso() {
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      const resposta = await api.post<ResultadoEnvioDTO>('/contador/enviar', { mes });
      if (resposta.enviado || resposta.simulado) setAviso(resposta.mensagem);
      else setErro(resposta.mensagem);
      resumo.recarregar();
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const dados = resumo.dados;

  const colunas: ColunaTabela<LinhaMes>[] = [
    {
      titulo: 'Mês',
      celula: (l) => (
        <span className="fiscal-mes-celula">
          <strong>{nomeDoMes(l.chave)}</strong>
          {l.chave === mes && <Selo cor="azul">Selecionado</Selo>}
        </span>
      ),
    },
    { titulo: 'Notas', alinhar: 'direita', celula: (l) => <span className="numero">{l.notas}</span> },
    { titulo: 'Valor', alinhar: 'direita', celula: (l) => <span className="numero">{formatarMoeda(l.valor)}</span> },
    {
      titulo: 'Canceladas',
      alinhar: 'direita',
      celula: (l) => <span className={l.canceladas > 0 ? 'numero fiscal-texto-vermelho' : 'numero'}>{l.canceladas}</span>,
    },
    { titulo: 'Envio ao contador', celula: (l) => <SeloEnvio resumo={l} /> },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (l) => (
        <span className="acoes-linha">
          <Botao
            variante="texto"
            desabilitado={l.notas === 0 || baixando === l.chave}
            aoClicar={() => void baixarZip(l.chave)}
          >
            {baixando === l.chave ? 'Baixando...' : 'Baixar .zip'}
          </Botao>
          <Botao variante="texto" desabilitado={l.chave === mes} aoClicar={() => setMes(l.chave)}>
            Ver
          </Botao>
        </span>
      ),
    },
  ];

  return (
    <Pagina
      titulo="Área do contador"
      acoes={
        <div className="fiscal-contador-acoes">
          <div className="fiscal-seletor-mes">
            <Selecao
              rotulo="Mês"
              valor={mes}
              aoMudar={(v) => setMes(v)}
              opcoes={meses.map((m) => ({ valor: m, rotulo: nomeDoMes(m) }))}
            />
          </div>
          <Botao
            variante="secundario"
            desabilitado={baixando !== null || (dados?.notas ?? 0) === 0}
            aoClicar={() => void baixarZip(mes)}
          >
            <Icone nome="documento" tamanho={18} />
            {baixando === mes ? 'Baixando...' : 'Baixar XML (.zip)'}
          </Botao>
          {eGestor && (
            <Botao desabilitado={enviando} aoClicar={() => void enviarAviso()}>
              <Icone nome="enviar" tamanho={18} />
              {enviando ? 'Enviando...' : 'Enviar ao contador'}
            </Botao>
          )}
        </div>
      }
    >
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !dados && <Carregando />}

      {dados && (
        <div className="resumo">
          <Indicador icone="documento" cor="azul" valor={String(dados.notas)} rotulo={`Notas de ${nomeDoMes(mes).toLowerCase()}`} />
          <Indicador icone="dinheiro" cor="verde" valor={formatarMoeda(dados.valor)} rotulo="Valor autorizado" />
          <Indicador icone="fechar" cor="vermelho" valor={String(dados.canceladas)} rotulo="Canceladas" />
          <Indicador
            icone="enviar"
            cor="roxo"
            pequeno
            valor={dados.enviadoEm ? formatarDataHora(dados.enviadoEm) : 'Não enviado'}
            rotulo="Envio ao contador"
          />
        </div>
      )}

      <section className="fiscal-contador-meses">
        <h2 className="fiscal-contador-titulo">Últimos 12 meses</h2>
        {!linhas && <Carregando />}
        {linhas && (
          <Tabela<LinhaMes>
            colunas={colunas}
            dados={linhas}
            chave={(l) => l.chave}
            porPagina={12}
            idVisao="contador-meses"
          />
        )}
      </section>
    </Pagina>
  );
}
