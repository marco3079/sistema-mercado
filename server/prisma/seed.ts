// Seed padrão: cria a loja matriz, as categorias financeiras básicas e a conta do gestor.
// Senha inicial: ADMIN_SENHA do .env (8 caracteres ou mais) ou, se ausente/curta, a senha padrão gestor1234.
// Idempotente: se já houver usuários, não faz nada.
// Os dados de demonstração ficam em seed-demo.ts e só entram com SEED_DEMO=true.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { carregarDemonstracao } from './seed-demo';

const prisma = new PrismaClient();

const SENHA_PADRAO = 'gestor1234';

async function main(): Promise<void> {
  if ((await prisma.usuario.count()) > 0) {
    console.log('Banco já possui dados, seed ignorado.');
    return;
  }

  const nome = process.env.ADMIN_NOME || 'Gestor';
  const email = (process.env.ADMIN_EMAIL || 'gestor@mercado.local').trim().toLowerCase();
  const senhaEnv = process.env.ADMIN_SENHA || '';
  const demo = process.env.SEED_DEMO === 'true';

  let senha = senhaEnv;
  let padrao = false;
  if (senha.length < 8) {
    senha = SENHA_PADRAO;
    padrao = true;
  }

  const matriz = await prisma.loja.create({ data: { nome: 'Loja Matriz', tipo: 'LOJA' } });

  const categoriasFinanceiras: { nome: string; tipo: 'RECEITA' | 'DESPESA' }[] = [
    { nome: 'Vendas', tipo: 'RECEITA' },
    { nome: 'Recebimento de fiado', tipo: 'RECEITA' },
    { nome: 'Bonificação da indústria', tipo: 'RECEITA' },
    { nome: 'Outras receitas', tipo: 'RECEITA' },
    { nome: 'Fornecedores', tipo: 'DESPESA' },
    { nome: 'Folha de pagamento', tipo: 'DESPESA' },
    { nome: 'Aluguel', tipo: 'DESPESA' },
    { nome: 'Energia e água', tipo: 'DESPESA' },
    { nome: 'Impostos', tipo: 'DESPESA' },
    { nome: 'Combustível e frota', tipo: 'DESPESA' },
    { nome: 'Manutenção', tipo: 'DESPESA' },
    { nome: 'Outras despesas', tipo: 'DESPESA' },
  ];
  await prisma.categoriaFinanceira.createMany({ data: categoriasFinanceiras, skipDuplicates: true });

  await prisma.usuario.create({
    data: {
      lojaId: matriz.id,
      nome,
      email,
      perfil: 'GESTOR',
      ativo: true,
      senhaHash: bcrypt.hashSync(senha, 10),
    },
  });

  console.log('==== GESTOR CRIADO ====');
  console.log(`E-mail: ${email}`);
  if (padrao) {
    console.log(`Senha padrão: ${SENHA_PADRAO}`);
  }
  console.log('Troque a senha em "Meu perfil" depois do primeiro acesso.');
  console.log('=======================');

  if (demo) {
    await carregarDemonstracao(prisma);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error('Erro ao executar o seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
