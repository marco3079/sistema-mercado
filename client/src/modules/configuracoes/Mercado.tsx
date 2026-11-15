import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { Aviso, Botao, Campo, Caixa, Cartao, Carregando, Grade, Selecao } from '../../ui';
import '../produtos/etiquetas.css';

// Ajustes do mercado: GET/PUT /configuracoes/mercado. Os tokens nunca voltam; o servidor só diz se estão definidos.

interface MercadoDTO {
  pixChave: string | null;
  pixNome: string | null;
  pixCidade: string | null;
  margemPadrao: number;
  arredondarPreco: boolean;
  balancaPrefixo: string;
  balancaModo: string;
  balancaDigitosPlu: number;
  fiadoAtivo: boolean;
  fiscalProvedor: string;
  fiscalAmbiente: string;
  fiscalCnpj: string | null;
  fiscalEmissaoAutomatica: boolean;
  fiscalNcmPadrao: string;
  fiscalCfopPadrao: string;
  fiscalCsosnPadrao: string;
  contadorNome: string | null;
  contadorEmail: string | null;
  contadorEnvioAutomatico: boolean;
  contadorDiaEnvio: number;
  deliveryAtivo: boolean;
  deliveryTaxa: number;
  deliveryPedidoMinimo: number;
  whatsappAtivo: boolean;
  whatsappNumero: string | null;
  whatsappTokenDefinido: boolean;
  marketplaceAtivo: boolean;
  scantechAtivo: boolean;
  mixFiscalAtivo: boolean;
  iaAtiva: boolean;
  iaChaveDefinida: boolean;
  etiquetaModo: string;
  etiquetaLarguraMm: number;
  etiquetaAlturaMm: number;
  etiquetaColunas: number;
  zebraIp: string | null;
  zebraPorta: number;
  zebraDpi: number;
}

// Formulário: números e textos como texto digitado (vírgula decimal); segredos começam vazios.
interface Formulario {
  pixChave: string;
  pixNome: string;
  pixCidade: string;
  margemPadrao: string;
  arredondarPreco: boolean;
  balancaPrefixo: string;
  balancaModo: string;
  balancaDigitosPlu: string;
  fiadoAtivo: boolean;
  fiscalProvedor: string;
  fiscalAmbiente: string;
  fiscalCnpj: string;
  fiscalEmissaoAutomatica: boolean;
  fiscalNcmPadrao: string;
  fiscalCfopPadrao: string;
  fiscalCsosnPadrao: string;
  contadorNome: string;
  contadorEmail: string;
  contadorEnvioAutomatico: boolean;
  contadorDiaEnvio: string;
  deliveryAtivo: boolean;
  deliveryTaxa: string;
  deliveryPedidoMinimo: string;
  whatsappAtivo: boolean;
  whatsappNumero: string;
  whatsappToken: string;
  marketplaceAtivo: boolean;
  scantechAtivo: boolean;
  mixFiscalAtivo: boolean;
  iaAtiva: boolean;
  iaChave: string;
  etiquetaModo: string;
  etiquetaLarguraMm: string;
  etiquetaAlturaMm: string;
  etiquetaColunas: string;
  zebraIp: string;
  zebraPorta: string;
  zebraDpi: string;
}

const OPCOES_PROVEDOR = [
  { valor: 'NENHUM', rotulo: 'Nenhum (não emite nota)' },
  { valor: 'SIMULADO', rotulo: 'Simulado (teste)' },
  { valor: 'FOCUS_NFE', rotulo: 'Focus NFe' },
  { valor: 'WEBMANIA', rotulo: 'Webmania' },
  { valor: 'NUVEM_FISCAL', rotulo: 'Nuvem Fiscal' },
];

const OPCOES_AMBIENTE = [
  { valor: 'HOMOLOGACAO', rotulo: 'Homologação (teste)' },
  { valor: 'PRODUCAO', rotulo: 'Produção' },
];

const OPCOES_MODO_BALANCA = [
  { valor: 'PRECO', rotulo: 'Preço (a etiqueta traz o valor)' },
  { valor: 'PESO', rotulo: 'Peso (a etiqueta traz o peso)' },
];

const OPCOES_FORMATO_ETIQUETA = [
  { valor: 'A4', rotulo: 'Folha A4 (pimaco, 3 por linha)' },
  { valor: 'TERMICA', rotulo: 'Impressora térmica de etiquetas (rolo)' },
  { valor: 'ZEBRA', rotulo: 'Zebra ZPL pela rede' },
];

const OPCOES_DPI = [
  { valor: '203', rotulo: '203 dpi (padrão)' },
  { valor: '300', rotulo: '300 dpi' },
];

// Tamanhos comuns de etiqueta (largura × altura em mm).
const ATALHOS_ETIQUETA = [
  { largura: 60, altura: 40 },
  { largura: 50, altura: 30 },
  { largura: 40, altura: 25 },
  { largura: 100, altura: 50 },
];

// Texto do banco (ou null) para o campo do formulário.
function texto(valor: string | null | undefined): string {
  return valor ?? '';
}

// Número do banco para o campo, com vírgula decimal.
function numeroParaCampo(valor: number): string {
  return String(valor).replace('.', ',');
}

function formularioDe(d: MercadoDTO): Formulario {
  return {
    pixChave: texto(d.pixChave),
    pixNome: texto(d.pixNome),
    pixCidade: texto(d.pixCidade),
    margemPadrao: numeroParaCampo(d.margemPadrao),
    arredondarPreco: d.arredondarPreco,
    balancaPrefixo: d.balancaPrefixo,
    balancaModo: d.balancaModo,
    balancaDigitosPlu: String(d.balancaDigitosPlu),
    fiadoAtivo: d.fiadoAtivo,
    fiscalProvedor: d.fiscalProvedor,
    fiscalAmbiente: d.fiscalAmbiente,
    fiscalCnpj: texto(d.fiscalCnpj),
    fiscalEmissaoAutomatica: d.fiscalEmissaoAutomatica,
    fiscalNcmPadrao: d.fiscalNcmPadrao,
    fiscalCfopPadrao: d.fiscalCfopPadrao,
    fiscalCsosnPadrao: d.fiscalCsosnPadrao,
    contadorNome: texto(d.contadorNome),
    contadorEmail: texto(d.contadorEmail),
    contadorEnvioAutomatico: d.contadorEnvioAutomatico,
    contadorDiaEnvio: String(d.contadorDiaEnvio),
    deliveryAtivo: d.deliveryAtivo,
    deliveryTaxa: numeroParaCampo(d.deliveryTaxa),
    deliveryPedidoMinimo: numeroParaCampo(d.deliveryPedidoMinimo),
    whatsappAtivo: d.whatsappAtivo,
    whatsappNumero: texto(d.whatsappNumero),
    whatsappToken: '',
    marketplaceAtivo: d.marketplaceAtivo,
    scantechAtivo: d.scantechAtivo,
    mixFiscalAtivo: d.mixFiscalAtivo,
    iaAtiva: d.iaAtiva,
    iaChave: '',
    etiquetaModo: d.etiquetaModo,
    etiquetaLarguraMm: String(d.etiquetaLarguraMm),
    etiquetaAlturaMm: String(d.etiquetaAlturaMm),
    etiquetaColunas: String(d.etiquetaColunas),
    zebraIp: texto(d.zebraIp),
    zebraPorta: String(d.zebraPorta),
    zebraDpi: String(d.zebraDpi),
  };
}

// Campo numérico obrigatório: texto digitado com vírgula ou ponto.
function numeroDe(textoDigitado: string, rotulo: string): number {
  const n = lerNumero(textoDigitado);
  if (n === null) throw new Error(`${rotulo} precisa ser um número.`);
  return n;
}

// Texto vazio vira null (campo opcional).
function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Corpo do PUT. Token e chave vazios não são enviados: mantêm o que já está gravado.
function corpoDe(f: Formulario) {
  return {
    pixChave: textoOuNulo(f.pixChave),
    pixNome: textoOuNulo(f.pixNome),
    pixCidade: textoOuNulo(f.pixCidade),
    margemPadrao: numeroDe(f.margemPadrao, 'Margem padrão'),
    arredondarPreco: f.arredondarPreco,
    balancaPrefixo: f.balancaPrefixo.trim(),
    balancaModo: f.balancaModo,
    balancaDigitosPlu: numeroDe(f.balancaDigitosPlu, 'Dígitos do PLU'),
    fiadoAtivo: f.fiadoAtivo,
    fiscalProvedor: f.fiscalProvedor,
    fiscalAmbiente: f.fiscalAmbiente,
    fiscalCnpj: textoOuNulo(f.fiscalCnpj),
    fiscalEmissaoAutomatica: f.fiscalEmissaoAutomatica,
    fiscalNcmPadrao: f.fiscalNcmPadrao.trim(),
    fiscalCfopPadrao: f.fiscalCfopPadrao.trim(),
    fiscalCsosnPadrao: f.fiscalCsosnPadrao.trim(),
    contadorNome: textoOuNulo(f.contadorNome),
    contadorEmail: textoOuNulo(f.contadorEmail),
    contadorEnvioAutomatico: f.contadorEnvioAutomatico,
    contadorDiaEnvio: numeroDe(f.contadorDiaEnvio, 'Dia do envio'),
    deliveryAtivo: f.deliveryAtivo,
    deliveryTaxa: numeroDe(f.deliveryTaxa, 'Taxa de entrega'),
    deliveryPedidoMinimo: numeroDe(f.deliveryPedidoMinimo, 'Pedido mínimo'),
    whatsappAtivo: f.whatsappAtivo,
    whatsappNumero: textoOuNulo(f.whatsappNumero),
    marketplaceAtivo: f.marketplaceAtivo,
    scantechAtivo: f.scantechAtivo,
    mixFiscalAtivo: f.mixFiscalAtivo,
    iaAtiva: f.iaAtiva,
    ...(f.whatsappToken.trim() !== '' ? { whatsappToken: f.whatsappToken.trim() } : {}),
    ...(f.iaChave.trim() !== '' ? { iaChave: f.iaChave.trim() } : {}),
    etiquetaModo: f.etiquetaModo,
    etiquetaLarguraMm: numeroDe(f.etiquetaLarguraMm, 'Largura da etiqueta'),
    etiquetaAlturaMm: numeroDe(f.etiquetaAlturaMm, 'Altura da etiqueta'),
    etiquetaColunas: numeroDe(f.etiquetaColunas, 'Colunas de etiqueta'),
    zebraIp: textoOuNulo(f.zebraIp),
    zebraPorta: numeroDe(f.zebraPorta, 'Porta da Zebra'),
    zebraDpi: numeroDe(f.zebraDpi, 'DPI da Zebra'),
  };
}

export function Mercado() {
  const [dto, setDto] = useState<MercadoDTO | null>(null);
  const [form, setForm] = useState<Formulario | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    let ativo = true;
    api
      .get<MercadoDTO>('/configuracoes/mercado')
      .then((dados) => {
        if (!ativo) return;
        setDto(dados);
        setForm(formularioDe(dados));
      })
      .catch((e) => {
        if (ativo) setErroCarga(mensagemErro(e));
      });
    return () => {
      ativo = false;
    };
  }, []);

  function mudar(parcial: Partial<Formulario>) {
    setForm((atual) => (atual ? { ...atual, ...parcial } : atual));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setAviso(null);
    setOcupado(true);
    try {
      const novo = await api.put<MercadoDTO>('/configuracoes/mercado', corpoDe(form));
      setDto(novo);
      setForm(formularioDe(novo));
      setAviso({ tipo: 'sucesso', texto: 'Ajustes salvos.' });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setOcupado(false);
    }
  }

  // Etiqueta de teste: usa o IP já gravado (por isso o aviso pede para salvar antes).
  async function imprimirTesteZebra() {
    setAviso(null);
    setTestando(true);
    try {
      await api.post('/impressao/teste');
      setAviso({ tipo: 'sucesso', texto: 'Etiqueta de teste enviada para a Zebra.' });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setTestando(false);
    }
  }

  if (erroCarga) return <Aviso tipo="erro">{erroCarga}</Aviso>;
  if (!dto || !form) return <Carregando />;

  return (
    <form onSubmit={salvar}>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Grade>
        <Cartao titulo="Pix">
          <Campo rotulo="Chave Pix" valor={form.pixChave} aoMudar={(v) => mudar({ pixChave: v })} />
          <Campo rotulo="Nome do recebedor" valor={form.pixNome} aoMudar={(v) => mudar({ pixNome: v })} />
          <Campo rotulo="Cidade" valor={form.pixCidade} aoMudar={(v) => mudar({ pixCidade: v })} />
        </Cartao>

        <Cartao titulo="Preços">
          <Campo
            rotulo="Margem padrão (%)"
            valor={form.margemPadrao}
            aoMudar={(v) => mudar({ margemPadrao: v })}
          />
          <Caixa
            rotulo="Arredondar preço (terminar em ,49 ou ,99)"
            marcado={form.arredondarPreco}
            aoMudar={(v) => mudar({ arredondarPreco: v })}
          />
        </Cartao>

        <Cartao titulo="Balança">
          <Campo
            rotulo="Prefixo da etiqueta (1 dígito)"
            valor={form.balancaPrefixo}
            aoMudar={(v) => mudar({ balancaPrefixo: v })}
          />
          <Selecao
            rotulo="Modo"
            valor={form.balancaModo}
            aoMudar={(v) => mudar({ balancaModo: v })}
            opcoes={OPCOES_MODO_BALANCA}
          />
          <Campo
            rotulo="Dígitos do PLU (4 a 6)"
            valor={form.balancaDigitosPlu}
            aoMudar={(v) => mudar({ balancaDigitosPlu: v })}
          />
          <p>
            A etiqueta EAN-13 segue o formato 2 PPPPPP VVVVV D: prefixo, PLU do produto, valor (preço ou peso) e
            dígito verificador.
          </p>
        </Cartao>

        <Cartao titulo="Impressora de etiquetas">
          <Selecao
            rotulo="Formato"
            valor={form.etiquetaModo}
            aoMudar={(v) => mudar({ etiquetaModo: v })}
            opcoes={OPCOES_FORMATO_ETIQUETA}
          />
          <div className="etiq-atalhos">
            {ATALHOS_ETIQUETA.map((a) => (
              <Botao
                key={`${a.largura}x${a.altura}`}
                variante="secundario"
                aoClicar={() => mudar({ etiquetaLarguraMm: String(a.largura), etiquetaAlturaMm: String(a.altura) })}
              >
                {`${a.largura} × ${a.altura} mm`}
              </Botao>
            ))}
          </div>
          <Campo
            rotulo="Largura da etiqueta (mm)"
            valor={form.etiquetaLarguraMm}
            aoMudar={(v) => mudar({ etiquetaLarguraMm: v })}
          />
          <Campo
            rotulo="Altura da etiqueta (mm)"
            valor={form.etiquetaAlturaMm}
            aoMudar={(v) => mudar({ etiquetaAlturaMm: v })}
          />
          <Campo
            rotulo="Etiquetas lado a lado no rolo (1 a 4)"
            valor={form.etiquetaColunas}
            aoMudar={(v) => mudar({ etiquetaColunas: v })}
          />
          {form.etiquetaModo === 'ZEBRA' && (
            <>
              <Campo rotulo="IP da Zebra na rede" valor={form.zebraIp} aoMudar={(v) => mudar({ zebraIp: v })} />
              <Campo rotulo="Porta" valor={form.zebraPorta} aoMudar={(v) => mudar({ zebraPorta: v })} />
              <Selecao
                rotulo="Resolução"
                valor={form.zebraDpi}
                aoMudar={(v) => mudar({ zebraDpi: v })}
                opcoes={OPCOES_DPI}
              />
              <div className="etiq-atalhos">
                <Botao
                  variante="secundario"
                  desabilitado={testando || !dto.zebraIp}
                  aoClicar={imprimirTesteZebra}
                >
                  Imprimir teste
                </Botao>
              </div>
              <p>Salve antes de imprimir o teste: ele usa o IP gravado.</p>
            </>
          )}
          <p>
            Folha A4 e impressora térmica usam a janela de impressão do navegador. O formato escolhido aqui é o padrão
            da tela de Etiquetas.
          </p>
        </Cartao>

        <Cartao titulo="Fiado">
          <Caixa
            rotulo="Vender fiado (a prazo) para clientes cadastrados"
            marcado={form.fiadoAtivo}
            aoMudar={(v) => mudar({ fiadoAtivo: v })}
          />
        </Cartao>

        <Cartao titulo="Nota fiscal">
          <Selecao
            rotulo="Provedor"
            valor={form.fiscalProvedor}
            aoMudar={(v) => mudar({ fiscalProvedor: v })}
            opcoes={OPCOES_PROVEDOR}
          />
          {form.fiscalProvedor === 'SIMULADO' && (
            <Aviso tipo="info">SIMULADO gera notas de teste sem valor fiscal.</Aviso>
          )}
          <Selecao
            rotulo="Ambiente"
            valor={form.fiscalAmbiente}
            aoMudar={(v) => mudar({ fiscalAmbiente: v })}
            opcoes={OPCOES_AMBIENTE}
          />
          <Campo rotulo="CNPJ do emitente" valor={form.fiscalCnpj} aoMudar={(v) => mudar({ fiscalCnpj: v })} />
          <Caixa
            rotulo="Emitir nota automaticamente na venda"
            marcado={form.fiscalEmissaoAutomatica}
            aoMudar={(v) => mudar({ fiscalEmissaoAutomatica: v })}
          />
          <Campo rotulo="NCM padrão" valor={form.fiscalNcmPadrao} aoMudar={(v) => mudar({ fiscalNcmPadrao: v })} />
          <Campo rotulo="CFOP padrão" valor={form.fiscalCfopPadrao} aoMudar={(v) => mudar({ fiscalCfopPadrao: v })} />
          <Campo
            rotulo="CSOSN padrão"
            valor={form.fiscalCsosnPadrao}
            aoMudar={(v) => mudar({ fiscalCsosnPadrao: v })}
          />
        </Cartao>

        <Cartao titulo="Contador">
          <Campo rotulo="Nome do contador" valor={form.contadorNome} aoMudar={(v) => mudar({ contadorNome: v })} />
          <Campo
            rotulo="E-mail do contador"
            tipo="email"
            valor={form.contadorEmail}
            aoMudar={(v) => mudar({ contadorEmail: v })}
          />
          <Caixa
            rotulo="Enviar os XML automaticamente"
            marcado={form.contadorEnvioAutomatico}
            aoMudar={(v) => mudar({ contadorEnvioAutomatico: v })}
          />
          <Campo
            rotulo="Dia do envio (1 a 28)"
            valor={form.contadorDiaEnvio}
            aoMudar={(v) => mudar({ contadorDiaEnvio: v })}
          />
        </Cartao>

        <Cartao titulo="Delivery e WhatsApp">
          <Caixa
            rotulo="Delivery ativo"
            marcado={form.deliveryAtivo}
            aoMudar={(v) => mudar({ deliveryAtivo: v })}
          />
          <Campo
            rotulo="Taxa de entrega (R$)"
            valor={form.deliveryTaxa}
            aoMudar={(v) => mudar({ deliveryTaxa: v })}
          />
          <Campo
            rotulo="Pedido mínimo (R$)"
            valor={form.deliveryPedidoMinimo}
            aoMudar={(v) => mudar({ deliveryPedidoMinimo: v })}
          />
          <Caixa
            rotulo="WhatsApp ativo"
            marcado={form.whatsappAtivo}
            aoMudar={(v) => mudar({ whatsappAtivo: v })}
          />
          <Campo
            rotulo="Número do WhatsApp"
            valor={form.whatsappNumero}
            aoMudar={(v) => mudar({ whatsappNumero: v })}
          />
          <Campo
            rotulo="Token do WhatsApp (deixe em branco para manter)"
            tipo="password"
            valor={form.whatsappToken}
            aoMudar={(v) => mudar({ whatsappToken: v })}
          />
          <p>
            {dto.whatsappTokenDefinido ? 'Já há um token gravado.' : 'Nenhum token gravado.'}
          </p>
        </Cartao>

        <Cartao titulo="Integrações">
          <Caixa
            rotulo="iFood Mercado: marketplace (simulado, sem contrato)"
            marcado={form.marketplaceAtivo}
            aoMudar={(v) => mudar({ marketplaceAtivo: v })}
          />
          <Caixa
            rotulo="Scantech: bonificação da indústria (simulado, sem contrato)"
            marcado={form.scantechAtivo}
            aoMudar={(v) => mudar({ scantechAtivo: v })}
          />
          <Caixa
            rotulo="Mix Fiscal: higienização fiscal dos cadastros (simulado, sem contrato)"
            marcado={form.mixFiscalAtivo}
            aoMudar={(v) => mudar({ mixFiscalAtivo: v })}
          />
        </Cartao>

        <Cartao titulo="Assistente IA">
          <Caixa
            rotulo="Assistente ativo"
            marcado={form.iaAtiva}
            aoMudar={(v) => mudar({ iaAtiva: v })}
          />
          <Campo
            rotulo="Chave da API Anthropic (deixe em branco para manter)"
            tipo="password"
            valor={form.iaChave}
            aoMudar={(v) => mudar({ iaChave: v })}
          />
          <p>
            {dto.iaChaveDefinida
              ? 'Já há uma chave gravada.'
              : 'Sem chave: o assistente responde por regras.'}
          </p>
        </Cartao>
      </Grade>

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}
