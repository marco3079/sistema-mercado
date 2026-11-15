# Exemplos da importação de outro sistema

Arquivos prontos para testar a tela **Importar de outro sistema** (menu **Sistema**, só para o gestor).
Todos os dados são fictícios: a empresa "MERCADO EXEMPLO LTDA", os clientes, os fornecedores e os produtos foram criados só para o teste.
Os CPFs e CNPJs têm dígitos verificadores válidos (foram calculados), mas não pertencem a pessoas ou empresas reais.

## Arquivos

| Arquivo | O que é | Use na tela |
|---|---|---|
| `fornecedores.csv` | 3 fornecedores (Código; Fantasia; Razão social; CNPJ; Telefone; Cidade; UF) | Planilha de outro sistema → Fornecedores |
| `clientes.csv` | 5 clientes, 3 com CPF e 2 com CNPJ. Dois têm saldo devedor (fiado): CL001 (R$ 35,50) e CL003 (R$ 12,00) | Planilha de outro sistema → Clientes |
| `produtos-softcom.csv` | 8 produtos no layout do Softcom. Tem preço com vírgula, a banana (1007) vendida por KG e a água (1008) na unidade CX12 | Planilha de outro sistema → Produtos, perfil **Softcom** |
| `contas-a-pagar.csv` | 5 contas a pagar (2 notas em parcelas, vencendo em 2026 e 2027). Os CNPJs são os dos fornecedores | Planilha de outro sistema → Contas, em **Estas contas são: A pagar** |
| `sped-exemplo.txt` | EFD ICMS/IPI mínima, em ISO-8859-1, do período 01/10/2026 a 31/10/2026 | SPED Fiscal ou Sintegra (.txt) |

O SPED tem 2 fornecedores (F01 e F02, os mesmos do `fornecedores.csv`), 1 cliente com CNPJ (CL004, a Padaria Pão Quente, também do `clientes.csv`),
4 produtos (1001, 1002, 1007 e 1950) e um inventário (H005) com 3 itens do próprio mercado e 1 item de terceiros.
O item 1900 (sacola plástica, tipo 07 de uso e consumo) fica de fora e aparece no aviso.

## Como testar na tela

Importe nesta ordem, como a tela recomenda: fornecedores, clientes, produtos, contas. Depois, se quiser, teste o SPED.

1. Entre como gestor e abra **Sistema > Importar de outro sistema**. Escolha a loja no topo da tela.
2. Clique em **Planilha de outro sistema**, escolha **Fornecedores** e envie `fornecedores.csv`. Confira o mapeamento e clique em **Conferir**.
3. Repita com `clientes.csv` (em **O que tem nesta planilha?**, escolha **Clientes**).
4. Repita com `produtos-softcom.csv`, escolhendo **Produtos** e o perfil **Softcom (SoftcomShop)**. A coluna `ESTOQUE` gera o estoque inicial.
5. Envie `contas-a-pagar.csv` com **Contas** e, em **Estas contas são**, escolha **A pagar**. O arquivo não tem coluna de tipo.
6. Para o SPED, clique em **SPED Fiscal ou Sintegra** e envie `sped-exemplo.txt`. O sistema mostra fornecedores, cliente, produtos, o estoque do inventário e o aviso de que o SPED não traz preço de venda.

Nada é gravado antes da conferência. Se quiser só ver a leitura, clique em **Voltar** na conferência.

Para testar **XMLs de NF-e**, esta pasta não traz XML. Use um XML real de compra, com o CNPJ da loja cadastrado em **Lojas e CD**.

## Observações

- O CSV usa `;` como separador e UTF-8. Os valores usam vírgula decimal (`22,90`).
- O arquivo do SPED é ISO-8859-1 (latin-1). Não o salve em outra codificação antes de testar.
- Para testar de novo, a segunda importação mostra os itens como **Iguais**. Para ver a atualização, altere um preço no arquivo e importe de novo com **Atualizar**.
- Antes de importar de verdade, faça uma cópia em **Configurações > Backup**.
