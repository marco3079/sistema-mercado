# Importar de outro sistema

**Para que serve.** Esta tela traz os dados do sistema que você usava antes (Softcom, Bling, Tiny, GDOOR, Hiper, MarketUP ou outro): fornecedores, clientes, produtos, estoque inicial, saldo de fiado e contas em aberto. Você lê o arquivo, confere cada item e só então grava. Nada é gravado antes da conferência.

**Quem usa.** Só o gestor. A tela fica no menu **Sistema**, com o nome **Importar de outro sistema**.

## Antes de começar

1. Antes de importar, faça uma cópia do banco em **Configurações > Backup**. A importação cria e altera cadastros.
2. Escolha a loja no seletor do topo da tela. O estoque e as contas vão para essa loja.
3. Importe nesta ordem: **fornecedores e clientes**, depois **produtos**, **estoque**, **fiado** e **contas**. Assim, cada item já encontra o cadastro a que se refere.
4. Tenha o arquivo do sistema antigo pronto. Aceitamos planilha (.xlsx ou .csv), arquivo SPED Fiscal ou Sintegra (.txt) e XML de NF-e (.xml ou .zip).

## Planilha de outro sistema

Use esta opção para produtos, clientes, fornecedores, estoque, fiado ou contas. Ela aceita arquivos .xlsx e .csv. O .xls antigo não é aceito: salve o arquivo como .xlsx antes.

1. Abra **Importar de outro sistema** e clique em **Planilha de outro sistema**.
2. Em **O que tem nesta planilha?**, escolha o tipo de dado.
3. Em **Perfil de colunas**, escolha:
   - **Automático (qualquer sistema)**: o sistema reconhece as colunas pelo nome.
   - Um perfil pronto: **Softcom (SoftcomShop)**, **Bling**, **Tiny / Olist ERP**, **GDOOR**, **Hiper** ou **MarketUP**.
   - Um perfil salvo por você, marcado com ★.
4. Clique em **Escolher planilha** e selecione o arquivo. A tela mostra as colunas da planilha e o campo para o qual cada uma vai.
5. Confira a tabela de colunas. Para mudar uma coluna, escolha outro campo na lista **Vai para**. Se uma coluna não deve entrar, escolha **— Ignorar —**.
6. Se faltar um campo obrigatório, a tela mostra **Falta mapear**, e o botão **Conferir** fica desabilitado. Mapeie o campo para continuar.
7. Clique em **Conferir**. A tela mostra a conferência (veja [A conferência](#a-conferência)).
8. Para usar o mesmo mapeamento depois, clique em **Salvar como perfil**, dê um nome e confirme. O perfil fica na lista de perfis salvos.

Se você trocar a entidade ou o perfil com o arquivo já escolhido, a tela lê a planilha de novo.

### Modelo de planilha

Em **Baixar modelo**, você baixa uma planilha em branco com as colunas certas e uma linha de exemplo. Duas abas explicam o que colocar em cada coluna. Use o modelo quando o sistema antigo não exporta bem, e preencha os dados nele.

### Colunas reconhecidas

O sistema reconhece as colunas pelo nome, sem se importar com acento, maiúscula ou pontuação. Esta tabela traz os principais nomes aceitos.

| Dado | Nomes de coluna que o sistema reconhece |
|---|---|
| Produtos: código | Código, Cód, Código do produto, Referência, SKU, Código reduzido |
| Produtos: código de barras | EAN, GTIN, Código de barras, Cód. barras, Barras |
| Produtos: nome | Nome, Descrição, Produto, Descrição PDV |
| Produtos: unidade | Unidade, Un, Unid, Unidade de medida |
| Produtos: preço de venda | Preço de venda, Preço, Venda, Valor de venda, Preço varejo |
| Produtos: preço de custo | Preço de custo, Custo, Valor de custo, Último custo |
| Produtos: estoque | Estoque, Estoque atual, Saldo, Quantidade, Qtd |
| Produtos: categoria | Categoria, Grupo, Departamento, Seção, Família |
| Clientes: nome | Nome, Cliente, Nome completo, Razão social |
| Clientes: CPF/CNPJ | CPF/CNPJ, CPF, CNPJ, Documento |
| Clientes: limite de crédito | Limite de crédito, Limite, Limite fiado |
| Clientes: saldo devedor | Saldo devedor, Débito, Saldo fiado, Em aberto, Conta corrente |
| Fornecedores: nome | Nome, Nome fantasia, Fantasia, Fornecedor |
| Fornecedores: razão social | Razão social, Razão, Nome empresarial |
| Fornecedores: CNPJ | CNPJ, CPF/CNPJ, CNPJ/CPF, Documento |
| Contas: valor | Valor, Valor original, Valor da parcela, Valor a pagar, Valor a receber |
| Contas: vencimento | Vencimento, Data de vencimento, Vencto |
| Contas: tipo | Tipo, Pagar/Receber, Natureza, Operação |
| Contas: parcela | Parcela, Nº parcela. Escreva como `1/3` ou `2` |

Em qualquer tipo, o telefone, o e-mail, o endereço, a cidade, a UF e o CEP também são reconhecidos. Se uma coluna não aparecer na tabela de colunas, escolha o campo na lista **Vai para**.

### Como o sistema lê cada coluna

- Valores com **R$** e vírgula decimal são aceitos (`R$ 1.234,56`).
- Datas em `dd/mm/aaaa` são aceitas.
- Quantidades e preços podem vir com unidade no fim (`1,5 kg`).
- **Pagar ou Receber**: se a coluna Tipo não existir, escolha **Estas contas são: A pagar** ou **A receber** antes de enviar o arquivo.
- Contas já pagas (com data de pagamento preenchida) não entram. A tela avisa quantas foram deixadas de fora.

## SPED Fiscal e Sintegra

Na tela inicial, clique em **SPED Fiscal ou Sintegra** e escolha o arquivo .txt. Peça ao contador o arquivo do último mês. O sistema reconhece sozinho se é um SPED (EFD ICMS/IPI ou EFD Contribuições) ou um Sintegra.

**O que traz:**

- **Fornecedores e clientes**: os participantes que aparecem nas notas do arquivo. Quem aparece como fornecedor nas notas de entrada vira fornecedor; quem aparece como cliente nas notas de saída vira cliente.
- **Produtos**: os itens de revenda, matéria-prima e produção própria. Itens de uso e consumo, de imobilizado e de serviço ficam de fora, e a tela avisa quantos são.
- **Inventário**: o último inventário do arquivo (bloco H). Só entra o estoque do próprio mercado. O que está em poder de terceiros fica de fora, com aviso.

**O que não traz:**

- **Preço de venda**: o SPED não tem esse dado. Os produtos novos entram com preço 0. Complete os preços pela planilha de produtos, na mesma tela.
- **Código de barras e estoque no Sintegra**: o Sintegra traz só o cadastro básico dos produtos (código, nome, NCM e unidade).

No SPED, um código de barras inválido não entra no produto, e a tela avisa.

## XMLs de NF-e

Na tela inicial, clique em **XMLs de NF-e** e escolha um ou vários arquivos .xml, ou um .zip com os XMLs. Para o cadastro, o sistema lê as notas de compra e de venda.

- **Nota de compra** (a loja recebeu a mercadoria): o emitente vira fornecedor, os itens viram produtos ligados a esse fornecedor, e as duplicatas viram contas a pagar.
- **Nota de venda** (a loja emitiu a nota): o destinatário vira cliente, os itens viram produtos com o código da loja, e as duplicatas viram contas a receber.

O sistema separa as notas pelo CNPJ da loja. Cadastre o CNPJ da loja em **Lojas e CD** antes. Sem CNPJ cadastrado, todas as notas são lidas como compra, e a tela avisa.

- Notas de outra empresa (CNPJ diferente) ficam de fora, com aviso.
- Eventos, como cancelamentos, não são lidos como nota. A tela avisa quantos foram ignorados.
- Duplicatas com vencimento antes de hoje ficam de fora, porque provavelmente já foram pagas. A tela avisa quantas são.
- A mesma nota enviada duas vezes é contada uma vez.

## A conferência

Depois de ler o arquivo, a tela mostra cada item com uma situação:

| Situação | O que significa | O que você faz |
|---|---|---|
| **Novo** | O item não existe no sistema | Nada. Ele entra na importação |
| **Já existe** | O item existe, mas com dados diferentes. A tela mostra o que muda, como "Preço de venda: 10,00 → 12,50" | Escolha **Atualizar** ou **Ignorar** |
| **Igual** | O item existe com os mesmos dados | Nada. Ele é ignorado |
| **Erro** | Algum dado está errado ou falta. Por exemplo, CPF inválido ou produto não encontrado | Corrija o arquivo e leia de novo. O item não entra |

**Como usar a conferência:**

1. Use as abas para escolher a entidade (fornecedores, clientes, produtos, e assim por diante).
2. Clique nos contadores **Novos**, **Com diferenças**, **Iguais** ou **Com erro** para filtrar a tabela. Clique de novo para tirar o filtro.
3. Para os itens que já existem, escolha **Atualizar todos** ou **Ignorar todos**. O padrão é **Ignorar**. Você também pode decidir item por item, na coluna **Ação**.
4. Desmarque **Importar** numa aba se não quiser aquela entidade.
5. Use a busca para achar um item pelo nome ou pela origem.
6. Confira o rodapé: "Serão criados X e atualizados Y. Z itens com erro ficam de fora."
7. Clique em **Importar**, confirme, e espere a barra de progresso terminar. Não feche a página durante a importação.

## O que acontece ao importar

- **Código mantido**: o código do produto no sistema antigo vira o código interno no sistema novo. Você não precisa trocar nada nos cadastros. O código antigo de clientes e fornecedores também fica guardado no cadastro.
- **Estoque**: cada linha de estoque vira um ajuste com o motivo **Migração de dados (saldo inicial)**. O ajuste leva o saldo da loja escolhida para a quantidade do arquivo. Se o arquivo traz custo e o produto está com custo 0, o custo é atualizado.
- **Fiado**: o saldo devedor do cliente sobe pelo valor do arquivo. O sistema cria um movimento de fiado e um lançamento de receita, com origem **Fiado**, na loja escolhida. Se o saldo do arquivo for menor que o atual, a tela não grava e mostra o erro: para baixar o fiado, use **Receber fiado** na ficha do cliente.
- **Contas**: cada conta vira um lançamento a pagar ou a receber, com categoria, documento e parcela. Uma conta que já foi importada antes aparece como **Igual** e não é duplicada.
- **Preço de venda**: se o preço muda num produto que já existe, a mudança entra no histórico de preços do produto.
- **Nada é apagado.** A importação só cria ou atualiza. Os cadastros que não estão no arquivo continuam como estão.

Ao terminar, a tela **Importação concluída** mostra quantos itens foram criados, atualizados, ignorados e com erro, em cada entidade. Se houver erros, clique em **Baixar erros (.csv)** para ver a lista. Confira os cadastros em **Produtos**, **Clientes**, **Fornecedores**, **Estoque** e **Financeiro**.

## Como exportar do meu sistema

- **Softcom**: em Cadastros ou Relatórios, abra a lista de produtos (ou clientes) e use Exportar / Salvar como Excel. Se não achar, peça ao suporte da Softcom a exportação ou use o SPED Fiscal.
- **Bling**: Cadastros > Produtos > ⋯ > Exportar (planilha). Contatos: Cadastros > Contatos > Exportar.
- **Tiny / Olist**: Cadastros > Produtos > Mais ações > Exportar planilha.
- **Outros sistemas**: quase todo sistema exporta relatórios para Excel ou CSV. Se não exportar, o arquivo do SPED Fiscal (EFD ICMS/IPI) que o contador recebe todo mês traz os produtos, clientes, fornecedores e o inventário.

## Problemas comuns

- **O arquivo é .xls (Excel antigo).** Abra no Excel e salve como .xlsx, ou exporte como .csv.
- **EAN inválido.** Na planilha, o produto aparece com erro e não entra. Corrija o EAN e leia de novo. No SPED e nas NF-e, o EAN inválido é deixado de fora e a tela mostra um aviso; o produto entra sem código de barras.
- **CPF ou CNPJ inválido.** O cadastro aparece com erro e não entra. Corrija o documento no arquivo e leia de novo.
- **Colunas não reconhecidas.** A tela mostra a coluna com o campo **— Ignorar —**. Escolha o campo certo na lista **Vai para**. Se um campo obrigatório ficar sem coluna, o botão **Conferir** fica desabilitado até você mapear.
- **Unidade não reconhecida.** O item entra com a unidade **UN**, e a tela avisa. Corrija a unidade no cadastro depois, se for o caso.
- **Preço de venda zerado.** Vale para produtos vindos do SPED ou do Sintegra. Complete os preços pela planilha de produtos.

[← Voltar ao manual](README.md)
