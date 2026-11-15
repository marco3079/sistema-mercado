import crypto from 'crypto';
import type { Prisma } from '@prisma/client';

// Conversões e arredondamentos usados em todo o servidor.
// O banco guarda Decimal; as contas são feitas em number e arredondadas antes de gravar.

export type Decimalish = Prisma.Decimal | number | string | null | undefined;

// Decimal/strings/null para number (null e inválido viram 0).
export function num(valor: Decimalish): number {
  if (valor === null || valor === undefined) return 0;
  const n = typeof valor === 'number' ? valor : Number(valor.toString());
  return Number.isFinite(n) ? n : 0;
}

// Igual a num(), mas preserva null (para campos opcionais na resposta).
export function numOuNull(valor: Decimalish): number | null {
  if (valor === null || valor === undefined) return null;
  return num(valor);
}

export function arred2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function arred3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function arred4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Código aleatório legível (sem 0/O/1/I), para rastreio de entrega, acesso B2B e cotação.
export function codigoAleatorio(tamanho = 10): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(tamanho);
  let saida = '';
  for (let i = 0; i < tamanho; i++) saida += alfabeto[bytes[i] % alfabeto.length];
  return saida;
}

// Início e fim do dia (horário do servidor; o Docker usa TZ=America/Sao_Paulo).
export function inicioDoDia(data = new Date()): Date {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function fimDoDia(data = new Date()): Date {
  const d = new Date(data);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function somarDias(data: Date, dias: number): Date {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

// Lê ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD da query; padrão: últimos `diasPadrao` dias até hoje.
export function periodoDaQuery(query: Record<string, unknown>, diasPadrao = 30): { inicio: Date; fim: Date } {
  const ler = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [a, m, d] = v.split('-').map(Number);
    const data = new Date(a, m - 1, d);
    return Number.isNaN(data.getTime()) ? null : data;
  };
  const fim = fimDoDia(ler(query.fim) ?? new Date());
  const inicio = inicioDoDia(ler(query.inicio) ?? somarDias(fim, -(diasPadrao - 1)));
  return { inicio, fim };
}
