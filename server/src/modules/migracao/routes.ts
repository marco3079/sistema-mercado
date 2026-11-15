import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { lojaDaRequisicao } from '../../lib/lojas';
import { registrarLog } from '../../lib/log';
import { lerConfiguracao } from '../../lib/email';
import { lerPlanilha, TIPO_XLSX } from '../../lib/planilha';
import { chaveCabecalho } from './normalizar';
import { CAMPOS, PERFIS_PRONTOS, sugerirMapeamento, converterPlanilha, modeloXlsx, contarContasPagas, type PerfilPronto } from './campos';
import { conferirLote } from './conferir';
import { ehSped, ehSintegra, lerSped, lerSintegra } from './sped';
import { lerNfes } from './nfe';
import { lerArquivosEnviados } from './arquivos';
import { aplicar } from './aplicar';
import {
  ehEntidade,
  MAX_ITENS_POR_APLICACAO,
  ORDEM_ENTIDADES,
  ROTULOS_ENTIDADE,
  type Entidade,
  type ItemAplicar,
  type LeituraLote,
  type Mapeamento,
  type Registro,
} from './tipos';

// Importação de dados de outros sistemas (planilha, SPED, Sintegra, NF-e). Só gestor.

const router = Router();

const LIMITE_CAMPOS_PERFIL = 200;
const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'DZ'];

// ---------- Campos aceitos em cada registro (espelha server/src/modules/migracao/tipos.ts) ----------
// texto = string (máx. 500); numero = number finito; booleano = boolean; lista = uma das opções.

const T = 'texto';
const N = 'numero';
const B = 'booleano';
type Tipo = typeof T | typeof N | typeof B | readonly string[];

const CHAVES_REGISTRO: Record<Entidade, Record<string, Tipo>> = {
  fornecedores: {
    codigoAntigo: T, nome: T, razaoSocial: T, cnpj: T, inscricaoEstadual: T, telefone: T, whatsapp: T, email: T,
    contato: T, endereco: T, cidade: T, uf: T, prazoEntregaDias: N, condicaoPagamento: T, observacoes: T, ativo: B,
  },
  clientes: {
    codigoAntigo: T, nome: T, tipo: ['VAREJO', 'ATACADO'], cpfCnpj: T, razaoSocial: T, inscricaoEstadual: T,
    telefone: T, whatsapp: T, email: T, cep: T, endereco: T, numero: T, bairro: T, cidade: T, uf: T,
    limiteCredito: N, observacoes: T, ativo: B,
  },
  produtos: {
    codigo: T, ean: T, nome: T, descricao: T, categoria: T, marca: T, unidade: UNIDADES, pesavel: B,
    codigoBalanca: N, precoCusto: N, precoVenda: N, precoAtacado: N, qtdAtacado: N, estoqueMinimo: N,
    estoqueMaximo: N, validadeDias: N, pesoBrutoKg: N, ncm: T, cest: T, cfop: T, csosn: T, insumo: B,
    produzido: B, ativo: B, fornecedorCnpj: T, codigoFornecedor: T,
  },
  estoque: { produto: T, nomeProduto: T, quantidade: N, custoUnitario: N },
  fiado: { cliente: T, nomeCliente: T, saldo: N, descricao: T },
  contas: {
    tipo: ['PAGAR', 'RECEBER'], descricao: T, valor: N, vencimento: T, documento: T, parcela: N,
    totalParcelas: N, pessoa: T, nomePessoa: T, categoria: T, observacao: T,
  },
};

function sanearRegistro(entidade: Entidade, bruto: Record<string, unknown>): Registro {
  const chaves = CHAVES_REGISTRO[entidade];
  const limpo: Record<string, string | number | boolean> = {};
  for (const [chave, tipo] of Object.entries(chaves)) {
    const valor = bruto[chave];
    if (valor === undefined || valor === null) continue;
    if (tipo === T) {
      if (typeof valor === 'string' && valor.length <= 500) limpo[chave] = valor;
    } else if (tipo === N) {
      if (typeof valor === 'number' && Number.isFinite(valor)) limpo[chave] = valor;
    } else if (tipo === B) {
      if (typeof valor === 'boolean') limpo[chave] = valor;
    } else if (typeof valor === 'string' && tipo.includes(valor)) {
      limpo[chave] = valor;
    }
  }
  return limpo as unknown as Registro;
}

// ---------- Auxiliares ----------

function consulta(req: Request, nome: string): string | undefined {
  const valor = req.query[nome];
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function entidadeDaConsulta(req: Request): Entidade {
  const entidade = consulta(req, 'entidade');
  if (!ehEntidade(entidade)) throw new HttpError(400, 'Entidade inválida');
  return entidade;
}

function nomeDoArquivo(req: Request): string | undefined {
  const bruto = req.get('x-nome-arquivo');
  if (!bruto) return undefined;
  try {
    return decodeURIComponent(bruto);
  } catch {
    return bruto;
  }
}

function corpoArquivo(req: Request): Buffer {
  const corpo: unknown = req.body;
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw new HttpError(400, 'Envie o arquivo');
  return corpo;
}

function lerPlanilhaSegura(arquivo: Buffer, nome: string | undefined): string[][] {
  try {
    return lerPlanilha(arquivo, nome);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Não foi possível ler a planilha. Use .xlsx ou .csv (o .xls antigo não é aceito).');
  }
}

async function nomeDoUsuario(id: number): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
  return usuario?.nome ?? null;
}

async function cnpjsDaEmpresa(): Promise<string[]> {
  const [lojas, configuracao] = await Promise.all([
    prisma.loja.findMany({ select: { cnpj: true } }),
    lerConfiguracao(),
  ]);
  const cnpjs = new Set<string>();
  for (const bruto of [...lojas.map((l) => l.cnpj), configuracao.fiscalCnpj]) {
    if (!bruto) continue;
    const limpo = bruto.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (limpo.length === 14) cnpjs.add(limpo);
  }
  return [...cnpjs];
}

// Perfil da leitura: "<id pronto>" ou "salvo:<id>" (perfil salvo da mesma entidade). Inexistente = ignorado.
async function perfilDaConsulta(
  valor: string | undefined,
  entidade: Entidade,
): Promise<{ pronto?: PerfilPronto; salvo?: Record<string, string> } | undefined> {
  if (!valor) return undefined;
  const salvo = /^salvo:(\d+)$/.exec(valor);
  if (salvo) {
    const id = Number(salvo[1]);
    if (!Number.isSafeInteger(id)) return undefined;
    const perfil = await prisma.perfilMigracao.findFirst({ where: { id, entidade } });
    return perfil ? { salvo: perfil.mapeamento as Record<string, string> } : undefined;
  }
  const pronto = PERFIS_PRONTOS.find((p) => p.id === valor);
  return pronto ? { pronto } : undefined;
}

function lerMapeamento(req: Request, entidade: Entidade, tamanhoCabecalho: number): Mapeamento {
  const invalido = new HttpError(400, 'Mapeamento inválido');
  const bruto = req.get('x-mapeamento');
  let valor: unknown;
  try {
    valor = JSON.parse(decodeURIComponent(bruto ?? ''));
  } catch {
    throw invalido;
  }
  const campos = new Set(CAMPOS[entidade].map((c) => c.id));
  const valido =
    Array.isArray(valor) &&
    valor.length <= tamanhoCabecalho &&
    valor.every((v) => v === null || (typeof v === 'string' && campos.has(v)));
  if (!valido) throw invalido;
  return valor as Mapeamento;
}

// ---------- Campos e perfis ----------

router.get('/migracao/campos', permitir('GESTOR'), asyncHandler(async (_req, res) => {
  res.json({
    ordem: ORDEM_ENTIDADES,
    entidades: ORDEM_ENTIDADES.map((id) => ({ id, rotulo: ROTULOS_ENTIDADE[id], campos: CAMPOS[id] })),
    perfis: PERFIS_PRONTOS.map(({ id, nome, descricao }) => ({ id, nome, descricao })),
  });
}));

router.get('/migracao/perfis', permitir('GESTOR'), asyncHandler(async (_req, res) => {
  const perfis = await prisma.perfilMigracao.findMany({ orderBy: { nome: 'asc' } });
  res.json(
    perfis.map((p) => ({
      id: p.id,
      nome: p.nome,
      entidade: p.entidade,
      mapeamento: p.mapeamento,
      criadoEm: p.criadoEm.toISOString(),
    })),
  );
}));

const CorpoPerfil = z.object({
  nome: z.string().trim().min(1).max(60),
  entidade: z.enum(ORDEM_ENTIDADES as [Entidade, ...Entidade[]]),
  mapeamento: z
    .record(z.string(), z.string())
    .refine((m) => Object.keys(m).length <= LIMITE_CAMPOS_PERFIL, 'Mapeamento grande demais'),
});

router.post('/migracao/perfis', permitir('GESTOR'), asyncHandler(async (req, res) => {
  const corpo = validar(CorpoPerfil, req.body);
  const campos = new Set(CAMPOS[corpo.entidade].map((c) => c.id));
  for (const campo of Object.values(corpo.mapeamento)) {
    if (!campos.has(campo)) throw new HttpError(400, `Campo desconhecido: ${campo}`);
  }

  const perfil = await prisma.perfilMigracao.upsert({
    where: { nome_entidade: { nome: corpo.nome, entidade: corpo.entidade } },
    create: { nome: corpo.nome, entidade: corpo.entidade, mapeamento: corpo.mapeamento },
    update: { mapeamento: corpo.mapeamento },
  });

  registrarLog({
    tipo: 'ALTERACAO',
    modulo: 'migracao',
    descricao: `Perfil de migração "${corpo.nome}" salvo`,
    usuarioId: req.usuario.id,
    usuarioNome: await nomeDoUsuario(req.usuario.id),
    perfil: req.usuario.perfil,
  });

  res.json({
    id: perfil.id,
    nome: perfil.nome,
    entidade: perfil.entidade,
    mapeamento: perfil.mapeamento,
    criadoEm: perfil.criadoEm.toISOString(),
  });
}));

router.delete('/migracao/perfis/:id', permitir('GESTOR'), asyncHandler(async (req, res) => {
  const id = idParam(req);
  const existe = await prisma.perfilMigracao.findUnique({ where: { id }, select: { id: true } });
  if (!existe) throw new HttpError(404, 'Perfil não encontrado');
  await prisma.perfilMigracao.delete({ where: { id } });
  res.status(204).end();
}));

// ---------- Modelo de planilha ----------

router.get('/migracao/modelo/:entidade', permitir('GESTOR'), asyncHandler(async (req, res) => {
  const entidade = req.params.entidade;
  if (!ehEntidade(entidade)) throw new HttpError(404, 'Modelo não encontrado');
  res.setHeader('Content-Type', TIPO_XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="modelo-${entidade}.xlsx"`);
  res.send(modeloXlsx(entidade));
}));

// ---------- Planilha ----------

router.post(
  '/migracao/planilha/ler',
  permitir('GESTOR'),
  express.raw({ type: () => true, limit: '20mb' }),
  asyncHandler(async (req, res) => {
    const entidade = entidadeDaConsulta(req);
    const arquivo = corpoArquivo(req);
    const linhas = lerPlanilhaSegura(arquivo, nomeDoArquivo(req));
    if (linhas.length === 0) throw new HttpError(400, 'A planilha está vazia');

    const cabecalhos = linhas[0];
    const dados = linhas.slice(1);
    const perfil = await perfilDaConsulta(consulta(req, 'perfil'), entidade);

    res.json({
      cabecalhos,
      chaves: cabecalhos.map((c) => chaveCabecalho(c)),
      amostra: dados.slice(0, 5),
      totalLinhas: dados.filter((l) => l.some((c) => String(c ?? '').trim() !== '')).length,
      mapeamento: sugerirMapeamento(entidade, cabecalhos, perfil),
    });
  }),
);

router.post(
  '/migracao/planilha/conferir',
  permitir('GESTOR'),
  express.raw({ type: () => true, limit: '20mb' }),
  asyncHandler(async (req, res) => {
    const entidade = entidadeDaConsulta(req);

    const tipoConta = consulta(req, 'tipoConta');
    let tipoContaPadrao: 'PAGAR' | 'RECEBER' | undefined;
    if (tipoConta === 'PAGAR' || tipoConta === 'RECEBER') tipoContaPadrao = tipoConta;
    else if (tipoConta !== undefined) throw new HttpError(400, 'Tipo de conta inválido');

    const arquivo = corpoArquivo(req);
    const nome = nomeDoArquivo(req);
    const linhas = lerPlanilhaSegura(arquivo, nome);
    if (linhas.length === 0) throw new HttpError(400, 'A planilha está vazia');

    const mapeamento = lerMapeamento(req, entidade, linhas[0].length);
    for (const campo of CAMPOS[entidade]) {
      if (campo.obrigatorio && !mapeamento.includes(campo.id)) {
        throw new HttpError(400, `Mapeie a coluna "${campo.rotulo}"`);
      }
    }

    const dados = linhas.slice(1);
    const registros = converterPlanilha(entidade, dados, mapeamento, { tipoContaPadrao, primeiraLinha: 2 });

    const avisos: string[] = [];
    if (entidade === 'contas') {
      const pagas = contarContasPagas(dados, mapeamento);
      if (pagas > 0) avisos.push(`${pagas} contas já pagas foram deixadas de fora`);
    }

    const leitura: LeituraLote = {
      fonte: 'planilha',
      descricao: `Planilha ${nome ?? 'sem nome'} (${ROTULOS_ENTIDADE[entidade]})`,
      avisos,
      registros,
    };
    const lojaId = await lojaDaRequisicao(req);
    res.json(await conferirLote(leitura, { lojaId }));
  }),
);

// ---------- SPED e Sintegra ----------

router.post(
  '/migracao/sped/conferir',
  permitir('GESTOR'),
  express.raw({ type: () => true, limit: '150mb' }),
  asyncHandler(async (req, res) => {
    const arquivo = corpoArquivo(req);
    let leitura: LeituraLote;
    if (ehSped(arquivo)) leitura = lerSped(arquivo);
    else if (ehSintegra(arquivo)) leitura = lerSintegra(arquivo);
    else throw new HttpError(400, 'O arquivo não é um SPED Fiscal nem um Sintegra (.txt)');

    const lojaId = await lojaDaRequisicao(req);
    res.json(await conferirLote(leitura, { lojaId }));
  }),
);

// ---------- NF-e ----------

router.post(
  '/migracao/nfe/conferir',
  permitir('GESTOR'),
  express.raw({ type: () => true, limit: '150mb' }),
  asyncHandler(async (req, res) => {
    const arquivo = corpoArquivo(req);
    const arquivos = lerArquivosEnviados(arquivo, nomeDoArquivo(req));
    const cnpjsProprios = await cnpjsDaEmpresa();
    const leitura = lerNfes(arquivos, cnpjsProprios);

    const lojaId = await lojaDaRequisicao(req);
    res.json(await conferirLote(leitura, { lojaId }));
  }),
);

// ---------- Aplicação ----------

const CorpoAplicar = z.object({
  entidade: z.enum(ORDEM_ENTIDADES as [Entidade, ...Entidade[]]),
  itens: z
    .array(
      z.object({
        origem: z.string().max(200),
        registro: z.record(z.string(), z.unknown()),
        decisao: z.enum(['atualizar', 'ignorar']),
      }),
    )
    .min(1)
    .max(MAX_ITENS_POR_APLICACAO),
});

router.post('/migracao/aplicar', permitir('GESTOR'), asyncHandler(async (req, res) => {
  const corpo = validar(CorpoAplicar, req.body);
  const itens: ItemAplicar[] = corpo.itens.map((i) => ({
    origem: i.origem,
    registro: sanearRegistro(corpo.entidade, i.registro),
    decisao: i.decisao,
  }));

  const lojaId = await lojaDaRequisicao(req);
  const r = await aplicar(corpo.entidade, itens, { lojaId, usuarioId: req.usuario.id });

  registrarLog({
    tipo: r.criados > 0 && r.atualizados === 0 ? 'CRIACAO' : 'ALTERACAO',
    modulo: 'migracao',
    descricao: `Migração de ${ROTULOS_ENTIDADE[corpo.entidade]}: ${r.criados} criados, ${r.atualizados} atualizados, ${r.ignorados} ignorados, ${r.erros.length} com erro`,
    usuarioId: req.usuario.id,
    usuarioNome: await nomeDoUsuario(req.usuario.id),
    perfil: req.usuario.perfil,
  });

  res.json(r);
}));

export default router;
