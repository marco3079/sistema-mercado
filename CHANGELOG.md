# Changelog

Todas as mudanças notáveis deste projeto ficam registradas aqui.

O formato segue o Keep a Changelog (em português) e o versionamento segue o SemVer.

## [Não lançado]

### Adicionado

- Importar de outro sistema (menu Sistema, só gestor): traz fornecedores, clientes, produtos, estoque inicial, saldo de fiado e contas em aberto. Fontes: planilha (.xlsx ou .csv, com perfis de Softcom, Bling, Tiny, GDOOR, Hiper e MarketUP), SPED Fiscal, Sintegra e XMLs de NF-e. Antes de gravar, mostra a conferência item a item.

### Alterado

- Node.js 26 nas imagens da API e do build do site (o Node 20 saiu de suporte) e na CI.
- nginx 1.29 no site e Docker CLI 28 no atualizador.
- CI com `actions/checkout` e `actions/setup-node` v7.

## [1.0.0] - 2026-11-15

Primeira versão pública do sistema de mercado, padaria e logística de fornecimento.

### Adicionado

- **Vendas**
  - PDV com balança, Pix e fiado.
  - Caixa, vendas, clientes e promoções com bonificação da indústria (simulada).
  - Delivery próprio e marketplace simulado (pedidos do iFood Mercado).
  - Etiquetas de balança e de produto, com impressão em Zebra.
- **Produtos e estoque**
  - Cadastro de produtos com formação de preço, categorias, fotos e etiquetas.
  - Importar e exportar produtos por planilha (.xlsx e .csv), com modelo e conferência antes de aplicar.
  - Estoque com validade, inventário e contagem pelo celular.
  - Estoque em posse de terceiros: remessas, retornos e baixas.
  - Portal de remessas do terceiro pelo link, com pedidos para aprovar ou recusar.
- **Padaria**
  - Receitas com custo por unidade.
  - Fornadas e painel do forno, com próximas fornadas e tempo restante.
  - Sugestão de produção.
- **Compras**
  - Sugestão de compra, cotações com link para o fornecedor e pedidos de compra.
  - Recebimento com conferência e leitura do XML da NF-e.
  - Custo médio dos produtos.
  - Página pública de cotação para o fornecedor.
- **Logística**
  - Entregas com rastreio e cargas com roteirização.
  - Romaneio e tela do motorista.
  - Transferências entre lojas e frota.
  - Página pública de rastreio.
  - Mapa com abas (Lojas, Entregas, Clientes e Frota), painel de detalhes e percurso pelas ruas do veículo.
  - Rastreadores GPS: cadastro de tags, recepção OsmAnd e Traccar, simulador e histórico.
- **Força de vendas**
  - Força de vendas com Flex, faturamento em lote e aprovação de pedidos.
  - Loja B2B pelo código do cliente e página `/pedir` para clientes.
- **Financeiro e fiscal**
  - Contas, fluxo de caixa e Meu Lucro.
  - Relatórios.
  - Notas fiscais: NFC-e e NF-e em modo simulado (homologação, sem validade fiscal).
  - Área do contador.
  - Higienização fiscal dos cadastros (simulada).
- **Gestão**
  - Assistente IA, que responde por regras e usa a API da Anthropic quando há chave configurada.
  - Equipe, perfis de acesso e várias lojas e CD.
  - Configurações do mercado, com menu de seções.
  - Logs e atividades.
  - Caixa de Avisos.
  - Backup diário.
- **Instalação e atualização**
  - Instalador para Windows (`instalar.ps1`) com Docker.
  - Atualização pelo botão do próprio sistema.
  - Dados de demonstração com `-Demo` (cadastro, sem vendas e sem movimento).

### Corrigido

- O banco de dados volta sozinho depois de reiniciar o PC (`restart: unless-stopped` no `docker-compose.yml`). Antes, a API não subia até que o banco fosse iniciado à mão.
- O instalador mostra o IP da rede local para o celular e ignora VPNs como Radmin e Tailscale.
- A Caixa de Avisos e o seletor de loja abrem por cima do mapa.
- A barra lateral tem 300 px, e todos os itens do menu aparecem inteiros.
- Os selos não quebram em duas linhas.
- As próximas fornadas do painel do forno não quebram o texto.

[Não lançado]: https://github.com/marco3079/sistema-mercado/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/marco3079/sistema-mercado/releases/tag/v1.0.0
