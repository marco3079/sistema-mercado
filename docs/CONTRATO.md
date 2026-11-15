# Contrato do sistema de mercado, padaria e logística

Este documento é a referência única para quem escreve módulos neste repositório (pessoas ou agentes).
Ele define a arquitetura, as convenções, as bibliotecas comuns e a API pública de cada módulo.
**Leia inteiro antes de escrever código.**

## 1. Visão geral

- Base copiada do [sistema-restaurante](https://github.com/marco3079/sistema-restaurante): mesma casca visual,
  login, painel, tema claro/escuro, configurações, logs, backup, atualizador e instalador Docker.
- `server/`: Node 26, TypeScript 7, Express 5, Prisma 5 (PostgreSQL), zod 4.
- `client/`: React 19, TypeScript 7, Vite 8, react-router-dom 7. **Sem bibliotecas novas** (nada de npm install).
- Referência visual e de código: `C:/Users/tenen/AppData/Local/Temp/claude/3ab78ac3efe4cf73/41809d88-ad4f-4cc8-8c5c-94aee1028530/scratchpad/refs/sistema-restaurante`
  (pasta `client/src/modules/*` e `server/src/modules/*`). Copie padrões de tela, CSS e rotas de lá.
  Telas parecidas: `estoque`, `compras`, `insumos`, `caixa`, `financeiro`, `clientes`, `promocoes`, `relatorios`,
  `fiscal`, `delivery`, `escala`. **Nunca edite a pasta de referência.**
- Banco: `server/prisma/schema.prisma` (já pronto; **não altere**: se faltar algo, pergunte ao `@main`).
- Textos de interface, comentários e nomes: português do Brasil, frases curtas.

## 2. Servidor

### 2.1 Módulos
Cada módulo é uma pasta `server/src/modules/<nome>/routes.ts` carregada sozinha por `src/app.ts`:

```ts
import { Router } from 'express';
const router = Router();          // rotas autenticadas (montadas em /api com o middleware autenticar)
export const publico = Router();  // opcional: rotas sem login (montadas em /api antes das autenticadas)
export default router;
```

- Caminhos são **completos** a partir de `/api` (ex.: `router.get('/produtos', ...)` responde `/api/produtos`).
- Rotas públicas sempre começam com `/publico/...` (ex.: `/publico/entregas/:codigo`).
- Padrão de handler (copie do restaurante):
  ```ts
  import { z } from 'zod';
  import { prisma } from '../../lib/prisma';
  import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
  import { permitir } from '../../lib/auth';
  router.get('/x', permitir('GESTOR', 'ESTOQUISTA'), asyncHandler(async (req, res) => { ... res.json(...) }));
  ```
- `req.usuario` = `{ id: number; perfil: Perfil }`.
- Erros: `throw new HttpError(400 | 403 | 404 | 409, 'Mensagem em português')`.
- Validação de corpo/query com zod via `validar(schema, req.body)`. Números chegam como number no JSON.
- **Decimal**: o Prisma devolve `Prisma.Decimal`. Converta SEMPRE com `num()` de `lib/numeros` antes de responder
  (as respostas da API usam `number`, nunca string). Datas: `toISOString()`.
- Transações: `await prisma.$transaction(async (tx) => { ... })` sempre que mexer em mais de uma tabela.

### 2.2 Bibliotecas comuns (já prontas — use, não reescreva, não edite)

| Arquivo | O que exporta |
|---|---|
| `lib/prisma.ts` | `prisma` |
| `lib/erros.ts` | `HttpError`, `asyncHandler`, `idParam(req, nome?)`, `validar(schema, dados)` |
| `lib/auth.ts` | `permitir(...perfis)` |
| `lib/autorizacao.ts` | `exigirAcao(req, acao)` — ações sensíveis: `'CANCELAR_ITEM' \| 'CANCELAR_VENDA' \| 'DESCONTO_MANUAL' \| 'SANGRIA' \| 'FIADO_ACIMA_LIMITE' \| 'AJUSTE_ESTOQUE' \| 'ALTERAR_PRECO'`. Lança 403 com `detalhes.codigo='SENHA_GESTOR'`; o cliente abre a janela da senha do gestor sozinho. |
| `lib/numeros.ts` | `num(decimal)`, `numOuNull`, `arred2`, `arred3`, `arred4`, `codigoAleatorio(n)`, `inicioDoDia`, `fimDoDia`, `somarDias`, `periodoDaQuery(req.query, diasPadrao)` → `{inicio, fim}` (lê `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD`) |
| `lib/lojas.ts` | `lojaDaRequisicao(req): Promise<number>` (loja ativa da requisição, pelo cabeçalho `x-loja-id`), `filtroLoja(req): Promise<number \| null>` (null = todas, com `?loja=todas`) |
| `lib/estoque.ts` | `movimentarEstoque(tx, {produtoId, lojaId, tipo, quantidade (com sinal), custoUnitario?, motivo?, referencia?, usuarioId?, lote?: {codigo, validade, fabricacao?, recebimentoId?, ordemProducaoId?}})` → `{movimentoId, saldoApos}`; `atualizarCustoMedio(tx, produtoId, qtdEntrada, custoEntrada)` (chamar ANTES da entrada); `saldoDe(produtoId, lojaId)`; tipo `Tx`. **Único jeito de mudar estoque.** |
| `lib/precos.ts` | `promocoesVigentes(produtos, cliente?)`, `calcularPreco(produto, quantidade, promocoes, tipoCliente?)` → `{precoUnitario, precoTabela, total, desconto, promocaoId, origem, descricaoPromocao}`, `descreverPromocao(p)`, `sugerirPrecoVenda(custo, margem%, arredondar)`, `margemSobreVenda(custo, venda)`, `lerEtiquetaBalanca(codigo, prefixo, modo)` → `{plu, modo, valor}`, `gerarEtiquetaBalanca(prefixo, plu, valor, modo)`, `digitoVerificadorEan`, `eanValido` |
| `lib/vendas.ts` | `registrarVenda(tx, NovaVenda)` → `{vendaId, numero, total, troco, notaId}` (preço, estoque, pagamentos, fiado, boleto, nota); `cancelarVenda(tx, vendaId, motivo, usuarioId)`; `linhaDigitavelSimulada` |
| `lib/fiscal.ts` | `emitirNotaVenda(tx, vendaId, modelo)`, `cancelarNotasDaVenda`, `gerarChaveAcesso` |
| `lib/zip.ts` | `criarZip([{nome, conteudo}])` → Buffer |
| `lib/pix.ts` | `gerarPixCopiaECola({chave, nome, cidade, valor, identificador})` |
| `lib/email.ts` | `lerConfiguracao()` (linha de ConfiguracaoPlataforma, com cache), `limparCacheConfiguracao()`, `enfileirarEmail(...)` |
| `lib/cripto.ts` | `cifrar(texto)`, `decifrar(texto)` (segredos no banco) |
| `lib/push.ts` | `notificar(usuarioIds, aviso)`, `notificarPerfis(perfis, {titulo, corpo, url})` |

### 2.3 Regras de negócio comuns
- Toda tela trabalha na loja da requisição (`lojaDaRequisicao`). Relatórios do gestor aceitam `?loja=todas`.
- Estoque só muda por `movimentarEstoque`. Venda só é gravada por `registrarVenda`.
- Preço de venda só muda por `PUT /api/produtos/:id/preco` (módulo produtos), que grava `HistoricoPreco`
  e cria `EtiquetaPendente`. Recebimento pode sugerir preço novo, mas chama a mesma regra (via função exportada
  `alterarPreco` de `server/src/modules/produtos/precos.ts`, ver 4.2).
- Integrações externas (WhatsApp, iFood Mercado, Scantech, Mix Fiscal, SEFAZ, IA) são **simuladas** quando não há
  credencial: gravam o que fariam e mostram "simulado" na tela. Nunca chamam serviços externos sem chave configurada.

## 3. Cliente

### 3.1 Módulos e rotas
Cada módulo é `client/src/modules/<nome>/index.tsx` exportando:

```tsx
export const rotas: RotaModulo[] = [...];          // telas com login
export const rotasPublicas: RotaPublica[] = [...]; // opcional: telas sem login (ex.: /rastreio/:codigo)
```

- Use `paraPerfis(perfis, { sufixo, rotulo, icone, elemento, ordem, grupo })` de `lib/rotas` para a mesma tela em vários perfis.
  Raízes: GESTOR `/gestor`, OPERADOR `/operador`, ESTOQUISTA `/estoquista`, PADEIRO `/padeiro`, COMPRADOR `/comprador`,
  MOTORISTA `/motorista`, VENDEDOR `/vendedor`, CONTADOR `/contador` (`RAIZ_DO_PERFIL` em `lib/tipos`).
- Para montar links para outra tela: `` `${RAIZ_DO_PERFIL[usuario.perfil]}/<sufixo>` `` (`useAuth()` de `lib/auth`).
- `grupo` (obrigatório) é um destes títulos: `'Vendas'`, `'Produtos e estoque'`, `'Padaria'`, `'Compras'`, `'Logística'`,
  `'Força de vendas'`, `'Financeiro'`, `'Gestão'`, `'Sistema'`, `'Conta'`.
- `ordem`: use a faixa do seu módulo (tabela 4.1) para o menu ficar estável.
- Ícones disponíveis (`NomeIcone` de `ui/icones`): `inicio usuarios financeiro calendario perfil busca sino relogio raio grafico
  engrenagem documento lapis atividade log grade lista imagem estrela enviar cadeado chat email visto lixeira grupo pedidos
  menos somar mais-circulo carrinho caminhao pao etiqueta codigo-barras balanca pacote fabrica mapa robo loja dinheiro
  transferir validade porcentagem celular` (entre outros já existentes). **Não edite `ui/icones.tsx`.**

### 3.2 Bibliotecas e componentes (prontos)
- `lib/api.ts`: `api.get<T>(c)`, `api.post<T>(c, corpo)`, `api.put<T>(c, corpo)`, `api.del(c)` — caminho SEM `/api`
  (ex.: `api.get('/produtos')`). `baixarArquivo(caminho, nomeArquivo)` para CSV/XML/ZIP/TXT.
- `lib/useDados.ts`: `useDados<T>(caminho | null)` → `{dados, carregando, erro, recarregar}`.
- `lib/tempoReal.ts`: `assinar((modulo) => ...)` (mudanças da API em tempo real; `modulo` = 1º trecho do caminho, ex. `'pdv'`),
  `assinarEntrega(codigo, ouvinte)` (página pública), `rajada(acao, ms)`.
- `lib/mercado.ts`: `mensagemErro`, `tempoDesde`, `horaCurta`, `formatarQuantidade(qtd, unidade)`, `formatarPercentual`,
  `lerNumero('12,50')`, `hojeIso(desloc)`, `UNIDADES`, `ROTULOS_FORMA_PAGAMENTO`, `ROTULOS_ORIGEM_VENDA`.
- `lib/imprimir.ts`: `imprimirHtml(titulo, corpoHtml, estilo?)` (bobina 80 mm por padrão), `escapar`, `moeda`, `dataHora`, `ESTILO_BOBINA`.
- `lib/auth.tsx`: `useAuth()` → `{usuario: {id, nome, email, perfil, foto} | null, sair}`.
- `lib/plataforma.tsx`: `usePlataforma()` → `{plataforma: {nome, slogan, ...}, logoSrc}`.
- `ui/index.tsx`: `Pagina({titulo, acoes, children})`, `Cartao({titulo})`, `Grade`, `Botao({variante: primario|secundario|perigo|texto, tipo, desabilitado, aoClicar})`,
  `Selo({cor: verde|amarelo|vermelho|azul|cinza})`, `Aviso({tipo: erro|sucesso|info})`, `Carregando`, `Tabela({colunas, dados, chave, vazio, aoClicarLinha})`,
  `Campo({rotulo, valor, aoMudar, tipo, obrigatorio})`, `AreaTexto`, `Selecao({rotulo, valor, aoMudar, opcoes, vazio})`, `Caixa({rotulo, marcado, aoMudar})` (checkbox),
  `Modal({aberto, titulo, aoFechar})`, `Abas({abas, ativa, aoMudar})`, `Avatar`, `MenuAcoes`, `formatarMoeda`, `formatarData`, `formatarDataHora`, `paraInputData`.
- CSS: cada módulo tem o próprio `<modulo>.css` importado no index/tela, com classes prefixadas pelo nome do módulo
  (ex.: `.pdv-carrinho`). Use as variáveis de cor da casca (`var(--cor-superficie)`, `var(--cor-borda)`, `var(--cor-texto)`,
  `var(--cor-texto-suave)`, `var(--cor-primaria)` etc. — veja `client/src/ui/estilo.css`). Tem que funcionar no tema escuro e no celular.
- Tipos de resposta da API: declare em `client/src/modules/<nome>/tipos.ts` (cada módulo os seus).

## 4. Módulos, donos e API

### 4.1 Donos (quem pode criar/editar cada arquivo)

| Gerador | Server | Client | Ordem no menu |
|---|---|---|---|
| g01 Lojas, equipe, ajustes | `modules/lojas/`, `modules/ajustes/` | `modules/lojas/`, `modules/cadastros/usuarios.tsx`, `modules/cadastros/FichaUsuario.tsx`, `modules/configuracoes/Mercado.tsx`, `modules/configuracoes/Configuracoes.tsx` | 80–82 |
| g02 Produtos | `modules/produtos/` | `modules/produtos/` | 20–24 |
| g03 Estoque | `modules/estoque/` | `modules/estoque/` | 25–29 |
| g04 PDV e caixa | `modules/pdv/` | `modules/pdv/` | 1–5 |
| g05 Padaria | `modules/padaria/` | `modules/padaria/` | 30–33 |
| g06 Clientes e promoções | `modules/clientes/`, `modules/promocoes/` | `modules/clientes/`, `modules/promocoes/` | 6–9 |
| g07 Financeiro e relatórios | `modules/financeiro/`, `modules/relatorios/` | `modules/financeiro/`, `modules/relatorios/` | 60–66 |
| g08 Compras | `modules/compras/` | `modules/compras/` | 40–46 |
| g09 Logística | `modules/logistica/` | `modules/logistica/` | 50–56 |
| g10 Força de vendas, B2B, delivery | `modules/comercial/` | `modules/comercial/` | 10–15 (Vendas/Força de vendas) |

Segunda rodada (depois): painel/notificações/busca, fiscal/contador, assistente IA, dados de demonstração.

### 4.2 API pública de cada módulo (o que os OUTROS módulos podem chamar)
Respostas com valores em `number` e datas ISO. `?` = opcional.

**lojas (g01)**
- `GET /lojas` → `[{id, nome, tipo: 'LOJA'|'CENTRO_DISTRIBUICAO', cnpj, telefone, endereco, cidade, uf, latitude, longitude, ativa}]` (qualquer perfil logado)
- `POST/PUT /lojas[/:id]` (GESTOR)
- `GET /configuracoes/mercado` (GESTOR) / `PUT` — campos de ConfiguracaoPlataforma do mercado (seção 5)
- `GET /configuracoes/mercado/publico` (qualquer logado) → `{pixAtivo, balancaPrefixo, balancaModo, fiadoAtivo, deliveryAtivo, deliveryTaxa, deliveryPedidoMinimo, margemPadrao, arredondarPreco, whatsappAtivo, marketplaceAtivo, scantechAtivo, mixFiscalAtivo, fiscalProvedor}` (sem segredos)
- `GET /usuarios?perfil=MOTORISTA` já existe (módulo cadastros, GESTOR). Para listas de motoristas/vendedores use
  `GET /lojas/equipe?perfil=MOTORISTA|VENDEDOR` → `[{id, nome}]` (qualquer logado; criado por g01).

**produtos (g02)**
- `GET /categorias` → `[{id, nome, ordem, ativa, setor, totalProdutos}]`
- `GET /produtos?busca=&categoriaId=&ativo=&insumo=&produzido=&pesavel=&pagina=&porPagina=` → `{itens: ProdutoDTO[], total}`
  `ProdutoDTO = {id, codigo, ean, nome, marca, categoriaId, categoria: string|null, unidade, pesavel, codigoBalanca, precoCusto, precoVenda, precoAtacado, qtdAtacado, margem (sobre venda, %), estoqueMinimo, estoqueMaximo, pesoBrutoKg, ncm, cest, cfop, csosn, produzido, insumo, validadeDias, controlaLote, foto, ativo, fornecedorPadraoId, estoqueLoja (saldo na loja da requisição)}`
- `GET /produtos/:id` → `ProdutoDTO`
- `GET /produtos/codigo/:codigo` → `ProdutoDTO` (procura por EAN, código interno ou etiqueta de balança; 404 se não achar)
- `server/src/modules/produtos/precos.ts` exporta `alterarPreco(tx, {produtoId, precoVenda, precoCusto?, usuarioId, motivo?})` (grava histórico + etiqueta).

**estoque (g03)**
- `GET /estoque?busca=&categoriaId=&situacao=abaixo_minimo|zerado|negativo` → `{itens: [{produtoId, codigo, nome, unidade, categoria, quantidade, estoqueMinimo, estoqueMaximo, precoCusto, valorEstoque}], total, valorTotal}`
- `GET /estoque/movimentos?produtoId=&tipo=&inicio=&fim=` → `[{id, criadoEm, produtoId, produto, tipo, quantidade, saldoApos, custoUnitario, motivo, referencia, usuario}]`
- `GET /validade?dias=7` → lotes vencendo / vencidos

**pdv (g04)**
- `GET /vendas?inicio=&fim=&origem=&status=&clienteId=` → `[{id, numero, criadoEm, origem, status, cliente, operador, total, formas: string[]}]`
- `GET /vendas/:id` → venda completa com itens, pagamentos, notas
- `POST /vendas/:id/cancelar {motivo}` (exige `CANCELAR_VENDA`)
- `GET /caixas/atual` → caixa aberto do usuário ou null

**padaria (g05)**: `GET /receitas`, `GET /producao?data=`

**clientes (g06)**
- `GET /clientes?busca=&tipo=&comFiado=` → `[{id, nome, tipo, cpfCnpj, telefone, whatsapp, email, endereco, numero, bairro, cidade, uf, cep, latitude, longitude, limiteCredito, saldoDevedor, bloqueado, vendedorId, codigoB2B, ativo}]`
- `GET /clientes/:id`
**promocoes (g06)**: `GET /promocoes?vigentes=1`

**financeiro (g07)**: `GET /financeiro/lancamentos`, `POST /financeiro/lancamentos`. Relatórios em `/relatorios/*`, Meu Lucro em `/lucro`.

**compras (g08)**: `GET /fornecedores` → `[{id, nome, cnpj, telefone, whatsapp, email, prazoEntregaDias, condicaoPagamento, avaliacao, ativo}]`;
`GET /compras/sugestao`; `/cotacoes`, `/pedidos-compra`, `/recebimentos`; público `/publico/cotacoes/:token`.

**logistica (g09)**
- `GET /veiculos`, `/rotas`, `/entregas`, `/transferencias`; motorista: `GET /motorista/entregas`.
- `server/src/modules/logistica/entregas.ts` exporta
  `criarEntrega(tx, {vendaId?, pedidoVendaId?, clienteId?, destinatario, telefone?, endereco, bairro?, cidade?, latitude?, longitude?, taxa?, valorCobrar?, pesoKg?, previsao?, observacao?})` → `{id, codigo}`
  (gera o código de rastreio e registra o aviso de WhatsApp simulado). Usado por g10.
- Público: `GET /publico/entregas/:codigo` → rastreio; página cliente `/rastreio/:codigo`.

**comercial (g10)**: `/pedidos-venda`, `/pedidos-venda/faturar`, `/delivery/pedidos`, `/delivery/marketplace/simular`;
públicos `/publico/delivery/catalogo`, `/publico/delivery/pedidos`, `/publico/b2b/:codigo/...`; páginas `/pedir`, `/b2b/:codigo`.

**já existentes (plataforma)**: `/auth/*`, `/usuarios` (GESTOR), `/perfil/*`, `/configuracoes/identidade`, `/configuracoes/email`,
`/permissoes`, `/logs`, `/backup`, `/atualizacao`, `/eventos`, `/push/*`.

## 5. Configurações do mercado (ConfiguracaoPlataforma, id = 1)
Campos novos editados em Configurações > Mercado (g01): `pixChave, pixNome, pixCidade, margemPadrao, arredondarPreco,
balancaPrefixo, balancaModo ('PRECO'|'PESO'), balancaDigitosPlu, fiadoAtivo, fiscalProvedor, fiscalAmbiente, fiscalCnpj,
fiscalEmissaoAutomatica, fiscalNcmPadrao, fiscalCfopPadrao, fiscalCsosnPadrao, contadorNome, contadorEmail, contadorEnvioAutomatico,
contadorDiaEnvio, deliveryAtivo, deliveryTaxa, deliveryPedidoMinimo, whatsappAtivo, whatsappNumero, whatsappToken (grava cifrado em whatsappTokenCifrado),
marketplaceAtivo, scantechAtivo, mixFiscalAtivo, iaAtiva, iaChave (grava cifrado em iaChaveCifrada)`.
Ler no servidor com `lerConfiguracao()`; depois de gravar, `limparCacheConfiguracao()`.

## 6. Verificação obrigatória antes de entregar
```
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
cd client && npx vite build
```
Os três têm que passar sem erro **nos seus arquivos**. Erros em arquivos de outros geradores: avise no grupo, não corrija.
