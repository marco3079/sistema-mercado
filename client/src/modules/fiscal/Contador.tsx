import { useState } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Grade, Pagina, formatarDataHora, formatarMoeda } from '../../ui';
import type { ResultadoEnvioDTO, ResumoMesDTO } from './tipos';

const MESES_NA_LISTA = 12;

// Mês (AAAA-MM) deslocado `n` meses em relação a hoje.
function mesDeslocado(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rotuloMes(mes: string): string {
  const [ano, numero] = mes.split('-');
  return `${numero}/${ano}`;
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Cartao titulo={rotulo}>
      <strong className="fiscal-total-valor">{valor}</strong>
    </Cartao>
  );
}

function enviadoEmTexto(resumo: ResumoMesDTO | null): string {
  if (!resumo) return '—';
  return resumo.enviadoEm ? formatarDataHora(resumo.enviadoEm) : 'Ainda não enviado';
}

// Uma linha da lista dos últimos meses (cada uma busca o próprio resumo).
function LinhaMes({ mes }: { mes: string }) {
  const resumo = useDados<ResumoMesDTO>(`/contador/arquivos?mes=${mes}`);
  return (
    <li className="fiscal-mes">
      <span className="fiscal-mes-nome">{rotuloMes(mes)}</span>
      {resumo.carregando && !resumo.dados && <span className="fiscal-mes-texto">Carregando...</span>}
      {resumo.erro && <span className="fiscal-mes-texto">{resumo.erro}</span>}
      {resumo.dados && (
        <span className="fiscal-mes-texto">
          {resumo.dados.notas} nota(s) · {formatarMoeda(resumo.dados.valor)} · {resumo.dados.canceladas} cancelada(s) ·
          envio: {enviadoEmTexto(resumo.dados)}
        </span>
      )}
    </li>
  );
}

export function Contador() {
  const { usuario } = useAuth();
  const eGestor = usuario?.perfil === 'GESTOR';

  const [mes, setMes] = useState(mesDeslocado(0));
  const resumo = useDados<ResumoMesDTO>(`/contador/arquivos?mes=${mes}`);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  const meses = Array.from({ length: MESES_NA_LISTA }, (_, i) => mesDeslocado(-i));

  async function baixarZip() {
    setErro(null);
    setAviso(null);
    setBaixando(true);
    try {
      await baixarArquivo(`/contador/arquivos/${mes}.zip`, `notas-${mes}.zip`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setBaixando(false);
    }
  }

  async function enviarAviso() {
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      const resposta = await api.post<ResultadoEnvioDTO>('/contador/enviar', { mes });
      if (resposta.enviado) setAviso(resposta.mensagem);
      else if (resposta.simulado) setAviso(resposta.mensagem);
      else setErro(resposta.mensagem);
      resumo.recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  const dados = resumo.dados;

  return (
    <Pagina titulo="Área do contador">
      <div className="barra-ferramentas fiscal-filtros">
        <label className="campo">
          <span className="campo-rotulo">Mês</span>
          <input
            className="campo-controle"
            type="month"
            value={mes}
            onChange={(e) => {
              if (e.target.value) setMes(e.target.value);
            }}
          />
        </label>
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <Grade>
            <Indicador rotulo="Notas do mês" valor={String(dados.notas)} />
            <Indicador rotulo="Valor autorizado" valor={formatarMoeda(dados.valor)} />
            <Indicador rotulo="Canceladas" valor={String(dados.canceladas)} />
            <Indicador rotulo="Último envio ao contador" valor={enviadoEmTexto(dados)} />
          </Grade>

          <div className="pagina-acoes fiscal-acoes">
            <Botao variante="secundario" desabilitado={baixando} aoClicar={() => void baixarZip()}>
              {baixando ? 'Baixando...' : 'Baixar XML do mês (.zip)'}
            </Botao>
            {eGestor && (
              <Botao desabilitado={enviando} aoClicar={() => void enviarAviso()}>
                {enviando ? 'Enviando...' : 'Enviar aviso ao contador'}
              </Botao>
            )}
          </div>
        </>
      )}

      <Cartao titulo="Últimos meses">
        <ul className="fiscal-meses">
          {meses.map((m) => (
            <LinhaMes key={m} mes={m} />
          ))}
        </ul>
      </Cartao>
    </Pagina>
  );
}
