import { Aviso } from '../../ui';
import type { CampoDef, LeituraPlanilha, Mapeamento } from './tipos';

// Campos obrigatórios que ainda não têm coluna mapeada.
export function camposFaltando(campos: CampoDef[], mapeamento: Mapeamento): CampoDef[] {
  return campos.filter((c) => c.obrigatorio && !mapeamento.includes(c.id));
}

// Até 3 valores não vazios da amostra, cortados em 30 caracteres.
function exemplosDaColuna(amostra: string[][], indice: number): string {
  return amostra
    .map((linha) => (linha[indice] ?? '').trim())
    .filter((valor) => valor !== '')
    .slice(0, 3)
    .map((valor) => (valor.length > 30 ? valor.slice(0, 30) + '…' : valor))
    .join(' · ');
}

export function MapearColunas({
  leitura,
  campos,
  mapeamento,
  aoMudar,
}: {
  leitura: LeituraPlanilha;
  campos: CampoDef[];
  mapeamento: Mapeamento;
  aoMudar: (m: Mapeamento) => void;
}) {
  const faltando = camposFaltando(campos, mapeamento);

  function mudarColuna(indice: number, campoId: string) {
    const novo: Mapeamento = leitura.cabecalhos.map((_, i) => mapeamento[i] ?? null);
    novo[indice] = campoId || null;
    aoMudar(novo);
  }

  return (
    <div className="migracao-mapear">
      <p className="migracao-mapear-total">
        {leitura.totalLinhas} linhas encontradas. Confira para qual campo vai cada coluna.
      </p>

      <div className="migracao-tabela-rolagem">
        <table className="migracao-tabela">
          <thead>
            <tr>
              <th scope="col">Coluna</th>
              <th scope="col">Exemplos</th>
              <th scope="col">Vai para</th>
            </tr>
          </thead>
          <tbody>
            {leitura.cabecalhos.map((cabecalho, i) => {
              const atual = mapeamento[i] ?? null;
              return (
                <tr key={`${i}-${cabecalho}`}>
                  <td className="migracao-tabela-coluna">{cabecalho || `(coluna ${i + 1})`}</td>
                  <td className="migracao-tabela-exemplos">{exemplosDaColuna(leitura.amostra, i)}</td>
                  <td>
                    <select
                      className="campo-controle migracao-tabela-select"
                      aria-label={`Campo da coluna ${cabecalho || i + 1}`}
                      value={atual ?? ''}
                      onChange={(e) => mudarColuna(i, e.target.value)}
                    >
                      <option value="">— Ignorar —</option>
                      {campos.map((c) => {
                        const usadoEmOutra = mapeamento.some((m, j) => j !== i && m === c.id);
                        return (
                          <option key={c.id} value={c.id} title={c.ajuda} disabled={usadoEmOutra}>
                            {c.obrigatorio ? `${c.rotulo} *` : c.rotulo}
                            {usadoEmOutra ? ' (já usado)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {faltando.length > 0 && (
        <Aviso tipo="erro">Falta mapear: {faltando.map((c) => c.rotulo).join(', ')}</Aviso>
      )}
    </div>
  );
}
