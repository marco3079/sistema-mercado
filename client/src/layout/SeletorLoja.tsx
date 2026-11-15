import { useEffect, useRef, useState } from 'react';
import { api, CHAVE_LOJA } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icone } from '../ui/icones';

interface LojaResumo {
  id: number;
  nome: string;
  tipo: 'LOJA' | 'CENTRO_DISTRIBUICAO';
  cidade: string | null;
  ativa: boolean;
}

const PERFIS_QUE_ESCOLHEM = ['GESTOR', 'COMPRADOR', 'CONTADOR'];

// Seletor de loja (filial) no topo. Só aparece com mais de uma loja ativa e para quem pode trocar.
// A escolha vai no cabeçalho x-loja-id de toda requisição (lib/api.ts); trocar recarrega a tela.
// Lista própria (não o select nativo), no mesmo visual dos menus do sistema.
export function SeletorLoja() {
  const { usuario } = useAuth();
  const [lojas, setLojas] = useState<LojaResumo[]>([]);
  const [atual, setAtual] = useState<string>(() => localStorage.getItem(CHAVE_LOJA) ?? '');
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);
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

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  if (!pode || lojas.length < 2) return null;

  const escolhida = lojas.find((l) => String(l.id) === atual) ?? lojas[0];

  function escolher(loja: LojaResumo) {
    setAberto(false);
    if (String(loja.id) === atual) return;
    localStorage.setItem(CHAVE_LOJA, String(loja.id));
    setAtual(String(loja.id));
    window.location.reload();
  }

  return (
    <div className="casca-seletor-loja-area" ref={area}>
      <button
        type="button"
        className="casca-seletor-loja"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title="Loja em que você está trabalhando"
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome={escolhida.tipo === 'CENTRO_DISTRIBUICAO' ? 'caminhao' : 'loja'} tamanho={18} />
        <span className="casca-seletor-loja-nome">{escolhida.nome}</span>
        <Icone nome="chevron-baixo" tamanho={16} className="casca-seletor-loja-seta" />
      </button>

      {aberto && (
        <ul className="casca-seletor-loja-lista" role="listbox" aria-label="Escolha a loja">
          {lojas.map((l) => {
            const ativa = String(l.id) === String(escolhida.id);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={ativa}
                  className={ativa ? 'casca-seletor-loja-opcao ativa' : 'casca-seletor-loja-opcao'}
                  onClick={() => escolher(l)}
                >
                  <span className="casca-seletor-loja-opcao-icone">
                    <Icone nome={l.tipo === 'CENTRO_DISTRIBUICAO' ? 'caminhao' : 'loja'} tamanho={18} />
                  </span>
                  <span className="casca-seletor-loja-opcao-texto">
                    <strong>{l.nome}</strong>
                    <small>
                      {l.tipo === 'CENTRO_DISTRIBUICAO' ? 'Centro de distribuição' : 'Loja'}
                      {l.cidade ? ` · ${l.cidade}` : ''}
                    </small>
                  </span>
                  {ativa && <Icone nome="visto" tamanho={18} className="casca-seletor-loja-visto" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
