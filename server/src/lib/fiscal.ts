import crypto from 'crypto';
import type { ModeloNota } from '@prisma/client';
import type { Tx } from './estoque';
import { lerConfiguracao } from './email';
import { num } from './numeros';

// Emissão de NFC-e / NF-e. Sem contrato com um emissor (Focus, WebmaniaBR, Nuvem Fiscal), o provedor
// SIMULADO gera uma nota "autorizada" em homologação, com chave e XML no formato da SEFAZ (sem validade fiscal).
// Com provedor NENHUM, nenhuma nota é gerada.

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

// Dígito verificador da chave de acesso (módulo 11).
function dvChave(chave43: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function gerarChaveAcesso(cnpj: string, modelo: ModeloNota, serie: number, numero: number, data = new Date()): string {
  const uf = '35'; // SP (simulado)
  const aamm = `${String(data.getFullYear()).slice(2)}${String(data.getMonth() + 1).padStart(2, '0')}`;
  const doc = cnpj.replace(/\D/g, '').padStart(14, '0').slice(-14);
  const mod = modelo === 'NFE' ? '55' : '65';
  const codigo = String(crypto.randomInt(0, 99999999)).padStart(8, '0');
  const chave43 = `${uf}${aamm}${doc}${mod}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${codigo}`;
  return chave43 + String(dvChave(chave43));
}

// Emite a nota da venda (se o provedor permitir). Devolve o id da nota ou null.
export async function emitirNotaVenda(tx: Tx, vendaId: number, modelo: ModeloNota = 'NFCE'): Promise<number | null> {
  const config = await lerConfiguracao();
  if (config.fiscalProvedor === 'NENHUM') return null;

  const venda = await tx.venda.findUniqueOrThrow({
    where: { id: vendaId },
    include: {
      itens: { where: { cancelado: false }, include: { produto: true } },
      pagamentos: true,
      cliente: true,
      loja: true,
    },
  });
  const ultima = await tx.notaFiscal.aggregate({ where: { lojaId: venda.lojaId, modelo }, _max: { numero: true } });
  const numero = (ultima._max.numero ?? 0) + 1;
  const serie = 1;
  const cnpj = venda.loja.cnpj ?? config.fiscalCnpj ?? '00000000000000';
  const chave = gerarChaveAcesso(cnpj, modelo, serie, numero);
  const protocolo = `135${Date.now()}`.slice(0, 15);
  const agora = new Date();

  const itensXml = venda.itens
    .map(
      (it, i) => `
    <det nItem="${i + 1}">
      <prod>
        <cProd>${escapar(it.produto.codigo)}</cProd>
        <cEAN>${escapar(it.produto.ean ?? 'SEM GTIN')}</cEAN>
        <xProd>${escapar(it.descricao)}</xProd>
        <NCM>${escapar(it.produto.ncm ?? config.fiscalNcmPadrao)}</NCM>
        <CFOP>${escapar(it.produto.cfop ?? config.fiscalCfopPadrao)}</CFOP>
        <uCom>${it.produto.unidade}</uCom>
        <qCom>${num(it.quantidade).toFixed(4)}</qCom>
        <vUnCom>${num(it.precoUnitario).toFixed(2)}</vUnCom>
        <vProd>${(num(it.total) + num(it.desconto)).toFixed(2)}</vProd>
        <vDesc>${num(it.desconto).toFixed(2)}</vDesc>
      </prod>
      <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${escapar(it.produto.csosn ?? config.fiscalCsosnPadrao)}</CSOSN></ICMSSN102></ICMS></imposto>
    </det>`,
    )
    .join('');
  const pagXml = venda.pagamentos
    .map((p) => {
      const codigo = { DINHEIRO: '01', CREDITO: '03', DEBITO: '04', VALE_ALIMENTACAO: '10', BOLETO: '15', PIX: '17', FIADO: '05' }[p.forma];
      return `<detPag><tPag>${codigo}</tPag><vPag>${num(p.valor).toFixed(2)}</vPag></detPag>`;
    })
    .join('');
  const dest = venda.cliente?.cpfCnpj ?? venda.cpfNota;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><mod>${modelo === 'NFE' ? 55 : 65}</mod><serie>${serie}</serie><nNF>${numero}</nNF><dhEmi>${agora.toISOString()}</dhEmi><tpAmb>2</tpAmb></ide>
      <emit><CNPJ>${escapar(cnpj)}</CNPJ><xNome>${escapar(config.nome)}</xNome><xFant>${escapar(venda.loja.nome)}</xFant></emit>
      ${dest ? `<dest><CPF>${escapar(dest)}</CPF>${venda.cliente ? `<xNome>${escapar(venda.cliente.nome)}</xNome>` : ''}</dest>` : ''}${itensXml}
      <total><ICMSTot><vProd>${num(venda.subtotal).toFixed(2)}</vProd><vDesc>${num(venda.desconto).toFixed(2)}</vDesc><vOutro>${num(venda.acrescimo).toFixed(2)}</vOutro><vNF>${num(venda.total).toFixed(2)}</vNF></ICMSTot></total>
      <pag>${pagXml}<vTroco>${num(venda.troco).toFixed(2)}</vTroco></pag>
      <infAdic><infCpl>DOCUMENTO EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL (SIMULADO)</infCpl></infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><dhRecbto>${agora.toISOString()}</dhRecbto><nProt>${protocolo}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>`;

  const nota = await tx.notaFiscal.create({
    data: {
      lojaId: venda.lojaId,
      vendaId: venda.id,
      modelo,
      numero,
      serie,
      chave,
      protocolo,
      status: 'AUTORIZADA',
      valor: venda.total,
      xml,
      autorizadaEm: agora,
    },
  });
  return nota.id;
}

// Cancela as notas autorizadas de uma venda (simulado: só muda a situação).
export async function cancelarNotasDaVenda(tx: Tx, vendaId: number, motivo: string): Promise<void> {
  await tx.notaFiscal.updateMany({
    where: { vendaId, status: { in: ['AUTORIZADA', 'PENDENTE'] } },
    data: { status: 'CANCELADA', motivo },
  });
}
