import { useEffect, useState } from 'react';

type Estado = { tipo: 'nada' } | { tipo: 'disponivel'; versao: string } | { tipo: 'instalando' } | { tipo: 'falhou' };

// O atualizador é o único caminho para uma correção chegar a quem já instalou.
// Confere uma vez ao abrir, em silêncio — sem rede ou sem versão nova, nada aparece.
export default function AvisoAtualizacao() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' });
  const [update, setUpdate] = useState<{ download: () => Promise<void>; install: () => Promise<void> } | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const u = await check();
        if (vivo && u) {
          setUpdate(u);
          setEstado({ tipo: 'disponivel', versao: u.version });
        }
      } catch {
        // Sem rede, endpoint fora do ar ou assinatura inválida: segue a versão atual.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.tipo === 'nada' || !update) return null;

  const atualizar = async () => {
    setEstado({ tipo: 'instalando' });
    try {
      await update.download();
      // No Windows o instalador encerra o app sem passar pelo evento de saída: o
      // servidor tem de parar antes, ou seguraria o próprio executável aberto.
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('parar_servidor_para_atualizar');
      await update.install();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      setEstado({ tipo: 'falhou' });
    }
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200"
    >
      {estado.tipo === 'disponivel' && (
        <>
          <span>Nova versão disponível ({estado.versao})</span>
          <span aria-hidden="true" className="text-neutral-600">·</span>
          <button
            type="button"
            onClick={() => void atualizar()}
            className="rounded px-2 py-1 font-medium text-blue-400 outline-none hover:text-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => setEstado({ tipo: 'nada' })}
            aria-label="Agora não"
            className="rounded px-2 py-1 text-neutral-400 outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Agora não
          </button>
        </>
      )}
      {estado.tipo === 'instalando' && <span>Baixando a atualização… o Learnflix reabre sozinho.</span>}
      {estado.tipo === 'falhou' && <span>Não foi possível atualizar agora. Tente de novo mais tarde.</span>}
    </div>
  );
}
