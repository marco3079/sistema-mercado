import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { lerNumero, mensagemErro } from '../../lib/mercado';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Carregando, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { TIPOS_VEICULO } from './tipos';
import type { VeiculoDTO } from './tipos';

// Frota: cadastro dos veículos das entregas (placa, modelo, tipo e capacidade).

function ModalVeiculo({
  veiculo,
  aoFechar,
  aoSalvo,
}: {
  veiculo: VeiculoDTO | null;
  aoFechar: () => void;
  aoSalvo: (mensagem: string) => void;
}) {
  const [placa, setPlaca] = useState(veiculo?.placa ?? '');
  const [modelo, setModelo] = useState(veiculo?.modelo ?? '');
  const [tipo, setTipo] = useState(veiculo?.tipo ?? 'Van');
  const [capacidadeKg, setCapacidadeKg] = useState(veiculo ? String(veiculo.capacidadeKg) : '');
  const [capacidadeVolumes, setCapacidadeVolumes] = useState(
    veiculo?.capacidadeVolumes !== null && veiculo?.capacidadeVolumes !== undefined ? String(veiculo.capacidadeVolumes) : '',
  );
  const [ativo, setAtivo] = useState(veiculo?.ativo ?? true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const kg = lerNumero(capacidadeKg);
    if (kg === null || kg < 0) {
      setErro('Informe a capacidade em kg.');
      return;
    }
    const volumes = lerNumero(capacidadeVolumes);
    setEnviando(true);
    try {
      const corpo = {
        placa: placa.trim().toUpperCase(),
        modelo: modelo.trim(),
        tipo,
        capacidadeKg: kg,
        capacidadeVolumes: volumes !== null ? Math.round(volumes) : null,
        ativo,
      };
      if (veiculo) await api.put(`/veiculos/${veiculo.id}`, corpo);
      else await api.post('/veiculos', corpo);
      aoSalvo(veiculo ? `Veículo ${placa.trim().toUpperCase()} atualizado.` : `Veículo ${placa.trim().toUpperCase()} cadastrado.`);
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo={veiculo ? `Veículo ${veiculo.placa}` : 'Novo veículo'} aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="logistica-form">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Placa" valor={placa} aoMudar={setPlaca} obrigatorio />
        <Campo rotulo="Modelo" valor={modelo} aoMudar={setModelo} obrigatorio />
        <Selecao
          rotulo="Tipo"
          valor={tipo}
          aoMudar={setTipo}
          obrigatorio
          opcoes={TIPOS_VEICULO.map((t) => ({ valor: t, rotulo: t }))}
        />
        <div className="logistica-linha-campos">
          <Campo rotulo="Capacidade (kg)" valor={capacidadeKg} aoMudar={setCapacidadeKg} obrigatorio />
          <Campo rotulo="Capacidade (volumes)" valor={capacidadeVolumes} aoMudar={setCapacidadeVolumes} />
        </div>
        <Caixa rotulo="Veículo ativo" marcado={ativo} aoMudar={setAtivo} />
        <div className="logistica-acoes-modal">
          <Botao tipo="submit" desabilitado={enviando}>
            Salvar veículo
          </Botao>
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}

export function Veiculos() {
  const lista = useDados<VeiculoDTO[]>('/veiculos');
  const [editando, setEditando] = useState<VeiculoDTO | 'novo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const colunas: ColunaTabela<VeiculoDTO>[] = [
    { titulo: 'Placa', celula: (v) => <span className="logistica-codigo">{v.placa}</span> },
    { titulo: 'Modelo', celula: (v) => v.modelo },
    { titulo: 'Tipo', celula: (v) => v.tipo },
    {
      titulo: 'Capacidade',
      alinhar: 'direita',
      celula: (v) => <span className="logistica-numero">{v.capacidadeKg.toLocaleString('pt-BR')} kg</span>,
    },
    {
      titulo: 'Volumes',
      alinhar: 'direita',
      celula: (v) => (v.capacidadeVolumes !== null ? String(v.capacidadeVolumes) : '—'),
    },
    {
      titulo: 'Situação',
      celula: (v) => (v.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo cor="cinza">Inativo</Selo>),
    },
  ];

  return (
    <Pagina titulo="Frota" acoes={<Botao aoClicar={() => setEditando('novo')}>Novo veículo</Botao>}>
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && !lista.dados && <Carregando />}
      {lista.dados && (
        <Tabela<VeiculoDTO>
          colunas={colunas}
          dados={lista.dados}
          chave={(v) => v.id}
          vazio="Nenhum veículo cadastrado."
          aoClicarLinha={(v) => setEditando(v)}
        />
      )}

      {editando !== null && (
        <ModalVeiculo
          veiculo={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={(mensagem) => {
            setAviso(mensagem);
            lista.recarregar();
          }}
        />
      )}
    </Pagina>
  );
}
