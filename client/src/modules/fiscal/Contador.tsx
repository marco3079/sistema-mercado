import { useState } from 'react';
import { api, baixarArquivo } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Cartao, Pagina, formatarDataHora, formatarMoeda } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import '../../ui/foto-produto.css';
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

// Cartão de número do topo (classes .resumo da casca).
function Indicador({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'verde' | 'laranja' | 'roxo' | 'vermelho';
  valor: string;
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

function enviadoEmTexto(resumo: ResumoMesDTO | null): string {
  if (!resumo) return '—';
  return resumo.enviadoEm ? formatarDataHora(resumo.enviadoEm) : 'Ainda não enviado';
}

// Cartão de um mês (cada um busca o próprio resumo).
function CartaoMes({ mes }: { mes: string }) {
  const resumo = useDados<ResumoMesDTO>(`/contador/arquivos?mes=${mes}`);
  const dados = resumo.dados;
  return (
    <li className="fiscal-mes">
      <span className="fiscal-mes-nome">{rotuloMes(mes)}</span>
      {resumo.carregando && !dados && <span className="fiscal-mes-aviso">Carregando...</span>}
      {resumo.erro && <span className="fiscal-mes-aviso">{resumo.erro}</span>}
      {dados && (
        <dl className="fiscal-mes-dados">
          <div>
            <dt>Notas</dt>
            <dd className="numero">{dados.notas}</dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd className="numero">{formatarMoeda(dados.valor)}</dd>
          </div>
          <div>
            <dt>Canceladas</dt>
            <dd className="numero">{dados.canceladas}</dd>
          </div>
          <div className="fiscal-mes-envio">
            <dt>Envio ao contador</dt>
            <dd>{enviadoEmTexto(dados)}</dd>
          </div>
        </dl>
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
      <div className="barra-ferramentas">
        <div className="filtros">
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
      </div>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {resumo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="resumo">
            <Indicador icone="documento" cor="azul" valor={String(dados.notas)} rotulo="Notas do mês" />
            <Indicador icone="dinheiro" cor="verde" valor={formatarMoeda(dados.valor)} rotulo="Valor autorizado" />
            <Indicador icone="fechar" cor="vermelho" valor={String(dados.canceladas)} rotulo="Canceladas" />
            <Indicador icone="enviar" cor="roxo" valor={enviadoEmTexto(dados)} rotulo="Último envio ao contador" />
          </div>

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
            <CartaoMes key={m} mes={m} />
          ))}
        </ul>
      </Cartao>
    </Pagina>
  );
}
