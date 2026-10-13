import { useEffect, useState } from 'react';
import { emDesktop } from '../lib/desktop';

type Estado = { tipo: 'nada' } | { tipo: 'disponivel'; versao: string } | { tipo: 'instalando' } | { tipo: 'falhou' };

// Só existe no app desktop: sem o `npx`, o atualizador é o único caminho para uma
// correção chegar a quem já instalou. Confere uma vez ao abrir, em silêncio —
// sem rede ou sem versão nova, nada aparece.
export default function AvisoAtualizacao() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' });
  const [update, setUpdate] = useState<{ downloadAndInstall: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!emDesktop()) return;
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
      await update.downloadAndInstall();
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
