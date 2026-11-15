import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatarQuantidade, lerNumero, mensagemErro } from '../../lib/mercado';
import { RAIZ_DO_PERFIL } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import type { InventarioDetalhe, ItemInventario } from './tipos';
import './estoque.css';

// Contagem pensada para o celular: o leitor de código (USB ou Bluetooth) digita o código e dá Enter.
// Opcionalmente, a câmera lê o código de barras com BarcodeDetector quando o navegador tiver a API.

interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type ConstrutorDetector = new (opcoes: { formats: string[] }) => DetectorDeCodigo;

const FORMATOS_CODIGO = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

// Mesmo código lido de novo em menos de 2,5 s é ignorado (a câmera lê a mesma etiqueta várias vezes).
const INTERVALO_REPETIDO_MS = 2500;

function suporteCamera(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

function LeitorCamera({ aoLer, aoFechar }: { aoLer: (codigo: string) => void; aoFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const aoLerRef = useRef(aoLer);
  aoLerRef.current = aoLer;
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: ConstrutorDetector }).BarcodeDetector;
    if (!Detector) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setErro('Este navegador não libera a câmera aqui. Use o leitor ou digite o código.');
      return;
    }

    let cancelado = false;
    let fluxo: MediaStream | null = null;
    let timer: number | undefined;
    let ultimoCodigo = '';
    let ultimoInstante = 0;
    const detector = new Detector({ formats: FORMATOS_CODIGO });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        fluxo = stream;
        if (video.current) {
          video.current.srcObject = stream;
          void video.current.play();
        }
        timer = window.setInterval(async () => {
          const el = video.current;
          if (!el || el.readyState < 2) return;
          try {
            const codigos = await detector.detect(el);
            const lido = codigos[0]?.rawValue?.trim();
            if (!lido) return;
            const agora = Date.now();
            if (lido === ultimoCodigo && agora - ultimoInstante < INTERVALO_REPETIDO_MS) return;
            ultimoCodigo = lido;
            ultimoInstante = agora;
            aoLerRef.current(lido);
          } catch {
            // quadro sem código: segue lendo
          }
        }, 300);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível usar a câmera. Confira a permissão do navegador.');
      });

    // Fecha a câmera ao sair da tela ou ao desligar a leitura.
    return () => {
      cancelado = true;
      if (timer !== undefined) window.clearInterval(timer);
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="estoque-contagem-camera">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <video ref={video} muted playsInline aria-label="Visão da câmera para ler o código de barras" />
      <Botao variante="secundario" aoClicar={aoFechar}>
        Fechar câmera
      </Botao>
    </div>
  );
}

export function Contagem() {
  const { id } = useParams<{ id: string }>();
  const inventarioId = Number(id);
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const raiz = RAIZ_DO_PERFIL[usuario?.perfil ?? 'GESTOR'];

  const { dados, carregando, erro: erroInventario } = useDados<InventarioDetalhe>(
    Number.isInteger(inventarioId) && inventarioId > 0 ? `/inventarios/${inventarioId}` : null,
  );

  const [codigo, setCodigo] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [modo, setModo] = useState<'somar' | 'substituir'>('somar');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<ItemInventario | null>(null);
  const [lidos, setLidos] = useState<ItemInventario[]>([]);
  const [cameraAberta, setCameraAberta] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const encerrado = dados !== null && dados.status !== 'ABERTO';

  function focarCampo() {
    window.setTimeout(() => campo.current?.focus(), 0);
  }

  // Registra uma leitura (teclado ou câmera). Usado também pela câmera, por isso lê os valores atuais.
  async function registrar(codigoLido: string) {
    const lido = codigoLido.trim();
    if (!lido || ocupado || encerrado) return;
    const qtd = lerNumero(quantidade);
    if (qtd === null || qtd < 0) {
      setErro('Quantidade inválida.');
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const item = await api.put<ItemInventario>(`/inventarios/${inventarioId}/contagem`, {
        codigo: lido,
        quantidade: qtd,
        somar: modo === 'somar',
      });
      setUltimo(item);
      setLidos((anteriores) => [item, ...anteriores.filter((i) => i.produtoId !== item.produtoId)].slice(0, 10));
      setCodigo('');
      setQuantidade('1');
    } catch (e) {
      setErro(mensagemErro(e));
      setCodigo(lido);
    } finally {
      setOcupado(false);
      focarCampo();
    }
  }

  // A câmera chama a mesma função; o ref mantém a versão mais nova com os valores atuais.
  const registrarRef = useRef(registrar);
  registrarRef.current = registrar;

  function enviar(e: FormEvent) {
    e.preventDefault();
    void registrar(codigo);
  }

  if (carregando && !dados) return <Carregando />;

  const titulo = dados ? `Contagem: ${dados.descricao}` : 'Contagem';

  return (
    <Pagina titulo={titulo}>
      <div className="estoque-botoes" style={{ justifyContent: 'flex-start' }}>
        <Botao variante="texto" aoClicar={() => navegar(`${raiz}/inventarios?abrir=${inventarioId}`)}>
          ← Voltar ao inventário
        </Botao>
      </div>

      {erroInventario && <Aviso tipo="erro">{erroInventario}</Aviso>}
      {encerrado && <Aviso tipo="info">Este inventário já foi encerrado. Não dá mais para contar.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="estoque-contagem">
        <form onSubmit={enviar} className="estoque-contagem-campo">
          <label className="campo">
            <span className="campo-rotulo">Código de barras ou código</span>
            <input
              ref={campo}
              className="campo-controle"
              type="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="done"
              value={codigo}
              disabled={encerrado}
              onChange={(e) => setCodigo(e.target.value)}
              aria-describedby="contagem-ajuda"
            />
          </label>
          <p id="contagem-ajuda" className="estoque-texto-suave">
            Bipe o produto ou digite o código e pressione Enter.
          </p>
        </form>

        <div className="estoque-contagem-quantidade">
          <label className="campo">
            <span className="campo-rotulo">Quantidade</span>
            <input
              className="campo-controle"
              type="text"
              inputMode="decimal"
              value={quantidade}
              disabled={encerrado}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </label>
          <div className="estoque-contagem-modo segmentado" role="group" aria-label="Modo da contagem">
            <button
              type="button"
              className="segmentado-item"
              aria-pressed={modo === 'somar'}
              onClick={() => setModo('somar')}
            >
              Somar à contagem
            </button>
            <button
              type="button"
              className="segmentado-item"
              aria-pressed={modo === 'substituir'}
              onClick={() => setModo('substituir')}
            >
              Substituir
            </button>
          </div>
        </div>

        {ultimo && (
          <div className="estoque-contagem-ultimo" aria-live="polite">
            <span className="estoque-texto-suave">Último lido</span>
            <span className="estoque-contagem-ultimo-nome">{ultimo.nome}</span>
            <span className="estoque-contagem-ultimo-quantidade">
              {ultimo.quantidadeContada === null
                ? '—'
                : `${formatarQuantidade(ultimo.quantidadeContada, ultimo.unidade)} contado`}
            </span>
          </div>
        )}

        <Botao
          tipo="button"
          aoClicar={() => void registrar(codigo)}
          desabilitado={ocupado || encerrado || codigo.trim() === ''}
        >
          {ocupado ? 'Registrando...' : 'Registrar código'}
        </Botao>

        {suporteCamera() && !encerrado && (
          cameraAberta ? (
            <LeitorCamera
              aoLer={(lido) => registrarRef.current(lido)}
              aoFechar={() => setCameraAberta(false)}
            />
          ) : (
            <Botao variante="secundario" aoClicar={() => setCameraAberta(true)}>
              Ler com a câmera
            </Botao>
          )
        )}

        <section>
          <h2 className="cartao-titulo">Últimos lidos</h2>
          {lidos.length === 0 ? (
            <p className="estoque-contagem-vazio">Nenhum produto lido ainda.</p>
          ) : (
            <ul className="estoque-contagem-lidos" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {lidos.map((i) => (
                <li key={i.produtoId}>
                  <span>{i.nome}</span>
                  <span>
                    {i.quantidadeContada === null ? '—' : formatarQuantidade(i.quantidadeContada, i.unidade)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Pagina>
  );
}
