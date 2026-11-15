import { useEffect, useState } from 'react';
import { api, CHAVE_LOJA } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icone } from '../ui/icones';

interface LojaResumo {
  id: number;
  nome: string;
  tipo: 'LOJA' | 'CENTRO_DISTRIBUICAO';
  ativa: boolean;
}

const PERFIS_QUE_ESCOLHEM = ['GESTOR', 'COMPRADOR', 'CONTADOR'];

// Seletor de loja (filial) no topo. Só aparece com mais de uma loja ativa e para quem pode trocar.
// A escolha vai no cabeçalho x-loja-id de toda requisição (lib/api.ts); trocar recarrega a tela.
export function SeletorLoja() {
  const { usuario } = useAuth();
  const [lojas, setLojas] = useState<LojaResumo[]>([]);
  const [atual, setAtual] = useState<string>(() => localStorage.getItem(CHAVE_LOJA) ?? '');
  const pode = usuario !== null && PERFIS_QUE_ESCOLHEM.includes(usuario.perfil);

  useEffect(() => {
    if (!pode) return;
    api
      .get<LojaResumo[]>('/lojas')
      .then((lista) => {
        const ativas = lista.filter((l) => l.ativa);
        setLojas(ativas);
        if (ativas.length > 0 && !ativas.some((l) => String(l.id) === atual)) {
          const primeira = String(ativas[0].id);
          localStorage.setItem(CHAVE_LOJA, primeira);
          setAtual(primeira);
        }
      })
      .catch(() => setLojas([]));
  }, [pode, atual]);

  if (!pode || lojas.length < 2) return null;

  return (
    <label className="casca-seletor-loja" title="Loja em que você está trabalhando">
      <Icone nome="loja" tamanho={18} />
      <select
        value={atual}
        aria-label="Loja"
        onChange={(e) => {
          localStorage.setItem(CHAVE_LOJA, e.target.value);
          setAtual(e.target.value);
          window.location.reload();
        }}
      >
        {lojas.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
            {l.tipo === 'CENTRO_DISTRIBUICAO' ? ' (CD)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
