import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { Cliente, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { arred2, codigoAleatorio, num, numOuNull } from '../../lib/numeros';

// Clientes (varejo e atacado), carteira dos vendedores, fiado/crediário e recebimentos.
// O saldo devedor só muda aqui (recebimento) e no registro/cancelamento de venda (lib/vendas).

const router = Router();

const equipe = permitir('GESTOR', 'OPERADOR', 'VENDEDOR', 'CONTADOR');
const edicao = permitir('GESTOR', 'OPERADOR', 'VENDEDOR');
const operacao = permitir('GESTOR', 'OPERADOR');
const gestor = permitir('GESTOR');

type Db = Prisma.TransactionClient | typeof prisma;

function soDigitos(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\D/g, '');
}

function textoOuNull(texto: string | null | undefined): string | null {
  const limpo = (texto ?? '').trim();
  return limpo === '' ? null : limpo;
}

function paraClienteDTO(c: Cliente) {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    cpfCnpj: c.cpfCnpj,
    razaoSocial: c.razaoSocial,
    inscricaoEstadual: c.inscricaoEstadual,
    telefone: c.telefone,
    whatsapp: c.whatsapp,
    email: c.email,
    cep: c.cep,
    endereco: c.endereco,
    numero: c.numero,
    bairro: c.bairro,
    cidade: c.cidade,
    uf: c.uf,
    latitude: numOuNull(c.latitude),
    longitude: numOuNull(c.longitude),
    limiteCredito: num(c.limiteCredito),
    saldoDevedor: num(c.saldoDevedor),
    bloqueado: c.bloqueado,
    observacoes: c.observacoes,
    vendedorId: c.vendedorId,
    codigoB2B: c.codigoB2B,
    ativo: c.ativo,
  };
}

// Cliente da requisição. VENDEDOR só enxerga a própria carteira.
async function clienteDaRequisicao(req: Request, id: number): Promise<Cliente> {
  const cliente = await prisma.cliente.findUnique({ where: { id } });
  if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
  if (req.usuario.perfil === 'VENDEDOR' && cliente.vendedorId !== req.usuario.id) {
    throw new HttpError(403, 'Este cliente não está na sua carteira');
  }
  return cliente;
}

async function conferirCpfCnpj(cpfCnpj: string | null, ignorarId?: number): Promise<void> {
  if (cpfCnpj === null) return;
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    throw new HttpError(400, 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos');
  }
  const outro = await prisma.cliente.findFirst({
    where: { cpfCnpj, ...(ignorarId !== undefined ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (outro) throw new HttpError(409, 'Já existe um cliente com este CPF/CNPJ');
}

// ---------- Listagem e ficha ----------

router.get(
  '/clientes',
  equipe,
  asyncHandler(async (req, res) => {
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 80) : '';
    const digitos = busca.replace(/\D/g, '');
    const tipoBruto = req.query.tipo;
    const tipo = tipoBruto === 'VAREJO' || tipoBruto === 'ATACADO' ? tipoBruto : null;

    const condicoes: Prisma.ClienteWhereInput[] = [];
    if (busca !== '') {
      condicoes.push({
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          ...(digitos !== '' ? [{ cpfCnpj: { contains: digitos } }, { telefone: { contains: digitos } }] : []),
        ],
      });
    }
    if (tipo) condicoes.push({ tipo });
    if (req.query.comFiado === '1') condicoes.push({ saldoDevedor: { gt: 0 } });
    if (req.usuario.perfil === 'VENDEDOR') condicoes.push({ vendedorId: req.usuario.id });

    const clientes = await prisma.cliente.findMany({
      where: condicoes.length > 0 ? { AND: condicoes } : {},
      orderBy: { nome: 'asc' },
      take: 200,
    });
    res.json(clientes.map((c) => paraClienteDTO(c)));
  })
);

// Registrada antes de GET /clientes/:id (a rota de um segmento não casa com este caminho de dois).
router.get(
  '/clientes/fiado/resumo',
  operacao,
  asyncHandler(async (_req, res) => {
    const devedores = await prisma.cliente.findMany({
      where: { saldoDevedor: { gt: 0 } },
      orderBy: { saldoDevedor: 'desc' },
    });
    const abertos = await prisma.lancamento.findMany({
      where: { origem: 'FIADO', pagoEm: null, clienteId: { in: devedores.map((c) => c.id) } },
      select: { clienteId: true, criadoEm: true },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    });
    // Lançamento em aberto mais antigo de cada cliente = a compra mais antiga não quitada.
    const maisAntigo = new Map<number, Date>();
    for (const l of abertos) {
      if (l.clienteId !== null && !maisAntigo.has(l.clienteId)) maisAntigo.set(l.clienteId, l.criadoEm);
    }
    const agora = Date.now();
    res.json({
      totalEmAberto: arred2(devedores.reduce((soma, c) => soma + num(c.saldoDevedor), 0)),
      clientes: devedores.map((c) => {
        const desde = maisAntigo.get(c.id);
        return {
          id: c.id,
          nome: c.nome,
          saldoDevedor: num(c.saldoDevedor),
          limiteCredito: num(c.limiteCredito),
          diasEmAtraso: desde ? Math.max(0, Math.floor((agora - desde.getTime()) / 86400000)) : 0,
          telefone: c.telefone,
          whatsapp: c.whatsapp,
        };
      }),
    });
  })
);

router.get(
  '/clientes/:id',
  equipe,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const cliente = await clienteDaRequisicao(req, id);
    const doze = new Date();
    doze.setMonth(doze.getMonth() - 12);

    const [ultimas, doUltimoAno] = await Promise.all([
      prisma.venda.findMany({
        where: { clienteId: id, status: 'CONCLUIDA' },
        orderBy: { criadoEm: 'desc' },
        take: 10,
        select: { id: true, numero: true, criadoEm: true, total: true, origem: true },
      }),
      prisma.venda.findMany({
        where: { clienteId: id, status: 'CONCLUIDA', criadoEm: { gte: doze } },
        select: { total: true },
      }),
    ]);

    const totalComprado = arred2(doUltimoAno.reduce((soma, v) => soma + num(v.total), 0));
    const ticketMedio = doUltimoAno.length > 0 ? arred2(totalComprado / doUltimoAno.length) : 0;

    res.json({
      ...paraClienteDTO(cliente),
      ultimasCompras: ultimas.map((v) => ({
        id: v.id,
        numero: v.numero,
        criadoEm: v.criadoEm.toISOString(),
        total: num(v.total),
        origem: v.origem,
      })),
      totalComprado,
      ticketMedio,
    });
  })
);

// ---------- Cadastro ----------

const clienteSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(120, 'Nome muito longo'),
  tipo: z.enum(['VAREJO', 'ATACADO']).default('VAREJO'),
  cpfCnpj: z.string().nullable().optional(),
  razaoSocial: z.string().max(120, 'Razão social muito longa').nullable().optional(),
  inscricaoEstadual: z.string().max(30, 'Inscrição estadual muito longa').nullable().optional(),
  telefone: z.string().max(40, 'Telefone muito longo').nullable().optional(),
  whatsapp: z.string().max(40, 'WhatsApp muito longo').nullable().optional(),
  email: z.string().max(120, 'E-mail muito longo').nullable().optional(),
  cep: z.string().max(12, 'CEP muito longo').nullable().optional(),
  endereco: z.string().max(160, 'Endereço muito longo').nullable().optional(),
  numero: z.string().max(20, 'Número muito longo').nullable().optional(),
  bairro: z.string().max(80, 'Bairro muito longo').nullable().optional(),
  cidade: z.string().max(80, 'Cidade muito longa').nullable().optional(),
  uf: z.string().max(2, 'Use a sigla do estado').nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  limiteCredito: z.number().min(0, 'O limite não pode ser negativo').max(99999999.99, 'Limite muito alto').nullable().optional(),
  bloqueado: z.boolean().optional(),
  observacoes: z.string().max(500, 'Observação muito longa').nullable().optional(),
  vendedorId: z.number().int().positive().nullable().optional(),
  ativo: z.boolean().optional(),
  gerarNovoCodigoB2B: z.boolean().optional(),
});

type ClienteEntrada = z.infer<typeof clienteSchema>;

// Normaliza o cadastro: CPF/CNPJ só dígitos, e-mail válido se houver, limite em duas casas.
function dadosDoCliente(e: ClienteEntrada) {
  const email = textoOuNull(e.email);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'E-mail inválido');
  }
  const cpfCnpj = soDigitos(e.cpfCnpj);
  const uf = textoOuNull(e.uf);
  return {
    nome: e.nome,
    tipo: e.tipo,
    cpfCnpj: cpfCnpj === '' ? null : cpfCnpj,
    razaoSocial: textoOuNull(e.razaoSocial),
    inscricaoEstadual: textoOuNull(e.inscricaoEstadual),
    telefone: textoOuNull(e.telefone),
    whatsapp: textoOuNull(e.whatsapp),
    email,
    cep: textoOuNull(e.cep),
    endereco: textoOuNull(e.endereco),
    numero: textoOuNull(e.numero),
    bairro: textoOuNull(e.bairro),
    cidade: textoOuNull(e.cidade),
    uf: uf === null ? null : uf.toUpperCase(),
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
    limiteCredito: arred2(e.limiteCredito ?? 0),
    observacoes: textoOuNull(e.observacoes),
    vendedorId: e.vendedorId ?? null,
  };
}

router.post(
  '/clientes',
  edicao,
  asyncHandler(async (req, res) => {
    const entrada = validar(clienteSchema, req.body);
    const dados = dadosDoCliente(entrada);
    await conferirCpfCnpj(dados.cpfCnpj);
    const cliente = await prisma.cliente.create({
      data: {
        ...dados,
        // Vendedor cadastra sempre na própria carteira.
        vendedorId: req.usuario.perfil === 'VENDEDOR' ? req.usuario.id : dados.vendedorId,
        bloqueado: req.usuario.perfil === 'GESTOR' ? (entrada.bloqueado ?? false) : false,
        ativo: entrada.ativo ?? true,
        codigoB2B: dados.tipo === 'ATACADO' ? codigoAleatorio(10) : null,
      },
    });
    res.status(201).json(paraClienteDTO(cliente));
  })
);

router.put(
  '/clientes/:id',
  edicao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const entrada = validar(clienteSchema, req.body);
    const atual = await clienteDaRequisicao(req, id);
    const dados = dadosDoCliente(entrada);
    await conferirCpfCnpj(dados.cpfCnpj, id);
    // Código B2B: gera ao virar atacado (se ainda não tem) ou quando pedido; senão mantém.
    const gerarCodigo = entrada.gerarNovoCodigoB2B === true || (dados.tipo === 'ATACADO' && !atual.codigoB2B);
    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        ...dados,
        vendedorId: req.usuario.perfil === 'VENDEDOR' ? req.usuario.id : dados.vendedorId,
        // Só o gestor mexe em bloqueio por aqui (o bloqueio tem rota própria).
        bloqueado: req.usuario.perfil === 'GESTOR' && entrada.bloqueado !== undefined ? entrada.bloqueado : atual.bloqueado,
        ativo: entrada.ativo ?? atual.ativo,
        codigoB2B: gerarCodigo ? codigoAleatorio(10) : atual.codigoB2B,
      },
    });
    res.json(paraClienteDTO(cliente));
  })
);

// ---------- Fiado / crediário ----------

// Extrato do fiado: saldo, limite, disponível e os movimentos (mais recentes primeiro).
async function extratoFiado(db: Db, clienteId: number) {
  const cliente = await db.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
  const movimentos = await db.movimentoFiado.findMany({
    where: { clienteId },
    orderBy: { criadoEm: 'desc' },
    take: 200,
    include: { venda: { select: { numero: true } } },
  });
  const saldoDevedor = num(cliente.saldoDevedor);
  const limiteCredito = num(cliente.limiteCredito);
  return {
    saldoDevedor,
    limiteCredito,
    disponivel: arred2(Math.max(0, limiteCredito - saldoDevedor)),
    movimentos: movimentos.map((m) => ({
      id: m.id,
      criadoEm: m.criadoEm.toISOString(),
      tipo: m.tipo,
      valor: num(m.valor),
      descricao: m.descricao,
      formaPagamento: m.formaPagamento,
      vendaNumero: m.venda?.numero ?? null,
    })),
  };
}

router.get(
  '/clientes/:id/fiado',
  operacao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    res.json(await extratoFiado(prisma, id));
  })
);

const receberSchema = z.object({
  valor: z.number().positive('Informe um valor maior que zero'),
  formaPagamento: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO']),
  descricao: z.string().max(120, 'Descrição muito longa').nullable().optional(),
});

// Recebimento de fiado: abate o saldo e quita os lançamentos em aberto do mais antigo para o mais novo.
router.post(
  '/clientes/:id/receber',
  operacao,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(receberSchema, req.body);
    const valor = arred2(dados.valor);
    if (valor <= 0) throw new HttpError(400, 'Informe um valor maior que zero');
    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findUnique({ where: { id }, select: { id: true, saldoDevedor: true } });
      if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
      // O saldo não pode ficar negativo: a condição é conferida na própria atualização.
      const baixa = await tx.cliente.updateMany({
        where: { id, saldoDevedor: { gte: valor } },
        data: { saldoDevedor: { decrement: valor } },
      });
      if (baixa.count === 0) throw new HttpError(400, 'O valor é maior que o saldo devedor');

      await tx.movimentoFiado.create({
        data: {
          clienteId: id,
          tipo: 'PAGAMENTO',
          valor,
          formaPagamento: dados.formaPagamento,
          descricao: textoOuNull(dados.descricao) ?? 'Pagamento de fiado',
          usuarioId: req.usuario.id,
        },
      });

      let restante = valor;
      const abertos = await tx.lancamento.findMany({
        where: { clienteId: id, origem: 'FIADO', pagoEm: null },
        orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      });
      for (const l of abertos) {
        if (restante <= 0) break;
        const emAberto = num(l.valor);
        if (restante + 0.001 >= emAberto) {
          // Cobre o lançamento inteiro.
          await tx.lancamento.update({
            where: { id: l.id },
            data: { pagoEm: agora, valorPago: emAberto, formaPagamento: dados.formaPagamento },
          });
          restante = arred2(restante - emAberto);
        } else {
          // Cobre só uma parte: o original fica com o resto e a parte paga vira outro lançamento já quitado.
          await tx.lancamento.update({ where: { id: l.id }, data: { valor: arred2(emAberto - restante) } });
          await tx.lancamento.create({
            data: {
              tipo: 'RECEITA',
              origem: 'FIADO',
              descricao: `${l.descricao} (pagamento parcial)`,
              valor: restante,
              vencimento: l.vencimento,
              pagoEm: agora,
              valorPago: restante,
              formaPagamento: dados.formaPagamento,
              clienteId: l.clienteId,
              lojaId: l.lojaId,
              referencia: l.referencia,
            },
          });
          restante = 0;
        }
      }
    });

    res.json(await extratoFiado(prisma, id));
  })
);

router.post(
  '/clientes/:id/bloquear',
  gestor,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(z.object({ bloqueado: z.boolean() }), req.body);
    const atual = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new HttpError(404, 'Cliente não encontrado');
    const cliente = await prisma.cliente.update({ where: { id }, data: { bloqueado: dados.bloqueado } });
    res.json(paraClienteDTO(cliente));
  })
);

export default router;
