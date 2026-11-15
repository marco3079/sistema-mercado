import { Botao, Selo } from '../../ui';
import { ORDEM_ENTIDADES, ROTULOS_ENTIDADE } from './tipos';
import type { Entidade, ResultadoAplicar, ResultadosMigracao } from './tipos';

const MAX_ERROS_VISIVEIS = 500;

interface LinhaErro {
  entidade: Entidade;
  origem: string;
  mensagem: string;
}

// Campo do CSV: aspas em volta e aspas internas dobradas.
function campoCsv(texto: string): string {
  return `"${texto.replace(/"/g, '""')}"`;
}

function baixarErrosCsv(erros: LinhaErro[]) {
  const cabecalho = ['Entidade', 'Origem', 'Erro'].join(';');
  const linhas = erros.map((e) =>
    [campoCsv(ROTULOS_ENTIDADE[e.entidade]), campoCsv(e.origem), campoCsv(e.mensagem)].join(';'),
  );
  // BOM UTF-8 para o Excel abrir com acentos certos.
  const conteudo = '﻿' + [cabecalho, ...linhas].join('\r\n');
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'erros-migracao.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Resultado(props: { resultados: ResultadosMigracao; aoNovaImportacao: () => void }) {
  const { resultados, aoNovaImportacao } = props;

  const linhas: { entidade: Entidade; r: ResultadoAplicar }[] = [];
  for (const e of ORDEM_ENTIDADES) {
    const r = resultados[e];
    if (r) linhas.push({ entidade: e, r });
  }

  const erros: LinhaErro[] = [];
  for (const { entidade, r } of linhas) {
    for (const err of r.erros) {
      erros.push({ entidade, origem: err.origem, mensagem: err.mensagem });
    }
  }
  const visiveis = erros.slice(0, MAX_ERROS_VISIVEIS);

  return (
    <section className="migracao-res">
      <h2 className="migracao-res-titulo">Importação concluída</h2>

      {linhas.length === 0 ? (
        <p className="migracao-res-vazio">Nada foi importado.</p>
      ) : (
        <ul className="migracao-res-lista">
          {linhas.map(({ entidade, r }) => (
            <li key={entidade} className="migracao-res-linha">
              <strong className="migracao-res-entidade">{ROTULOS_ENTIDADE[entidade]}</strong>
              <span className="migracao-res-numeros">
                {r.criados.toLocaleString('pt-BR')} criados · {r.atualizados.toLocaleString('pt-BR')} atualizados ·{' '}
                {r.ignorados.toLocaleString('pt-BR')} ignorados ·{' '}
                {r.erros.length > 0 ? (
                  <Selo cor="vermelho">{r.erros.length.toLocaleString('pt-BR')} com erro</Selo>
                ) : (
                  '0 com erro'
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {erros.length > 0 && (
        <div className="migracao-res-erros">
          <div className="migracao-res-erros-topo">
            <h3 className="migracao-res-subtitulo">Erros</h3>
            <Botao variante="secundario" aoClicar={() => baixarErrosCsv(erros)}>
              Baixar erros (.csv)
            </Botao>
          </div>
          <div className="migracao-res-tabela-bloco">
            <table className="migracao-res-tabela">
              <thead>
                <tr>
                  <th scope="col">Entidade</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Erro</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((e, i) => (
                  <tr key={i}>
                    <td>{ROTULOS_ENTIDADE[e.entidade]}</td>
                    <td className="migracao-res-origem">{e.origem}</td>
                    <td>{e.mensagem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {erros.length > MAX_ERROS_VISIVEIS && (
            <p className="migracao-res-nota">
              Mostrando {MAX_ERROS_VISIVEIS} de {erros.length.toLocaleString('pt-BR')} erros. O arquivo baixado traz todos.
            </p>
          )}
        </div>
      )}

      <p className="migracao-res-dica">
        Confira os cadastros em Produtos, Clientes, Fornecedores, Estoque e Financeiro.
      </p>

      <div className="migracao-res-acoes">
        <Botao aoClicar={aoNovaImportacao}>Importar outro arquivo</Botao>
      </div>
    </section>
  );
}
