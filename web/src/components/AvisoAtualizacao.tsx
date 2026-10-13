import { useEffect, useState } from 'react';
import { cliqueFora } from '../lib/desktop';
import { X } from './icons';

const PAGINA_DA_VERSAO = 'https://github.com/rafatcastro/learnflix-v2/releases/latest';

type Estado = { tipo: 'nada' } | { tipo: 'disponivel'; versao: string } | { tipo: 'instalando' } | { tipo: 'falhou'; motivo: string };

// O atualizador é o único caminho para uma correção chegar a quem já instalou.
// Confere uma vez ao abrir, em silêncio — sem rede ou sem versão nova, nada aparece.
export default function AvisoAtualizacao() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' });
  const [update, setUpdate] = useState<{ download: () => Promise<void>; install: () => Promise<void> } | null>(null);

  useEffect(() => {
    // No `pnpm dev` a versão é a do package.json (sempre atrás da release): o aviso
    // apareceria sempre, e instalar trocaria o binário de dev pela release.
    if (import.meta.env.DEV) return;
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
    const { invoke } = await import('@tauri-apps/api/core');
    let servidorParado = false;
    try {
      await update.download();
      // No Windows o instalador encerra o app sem passar pelo evento de saída: o
      // servidor tem de parar antes, ou seguraria o próprio executável aberto.
      // Só lá: no macOS e no Linux parar antes não serve para nada, e se a
      // instalação falhasse a janela ficava sem servidor.
      if (navigator.userAgent.includes('Windows')) {
        await invoke('parar_servidor_para_atualizar');
        servidorParado = true;
      }
      await update.install();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      // O motivo aparece na faixa: "não foi possível" sozinho não deixa ninguém
      // descobrir por que a atualização nunca passa.
      console.error('atualização falhou', e);
      if (servidorParado) {
        await invoke('reiniciar').catch(() => {});
        return;
      }
      setEstado({ tipo: 'falhou', motivo: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-neutral-800 bg-neutral-950 py-2 pl-4 pr-12 text-sm text-neutral-200"
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
      {estado.tipo === 'falhou' && (
        <>
          <span className="min-w-0 truncate" title={estado.motivo}>
            Não foi possível atualizar agora{estado.motivo ? ` (${estado.motivo})` : ''}.
          </span>
          <a
            href={PAGINA_DA_VERSAO}
            onClick={(e) => cliqueFora(e, PAGINA_DA_VERSAO)}
            className="rounded px-2 py-1 font-medium text-blue-400 outline-none hover:text-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Baixar no site
          </a>
        </>
      )}
      {/* Sempre dá para fechar: sem isso, a faixa de falha cobria o topo da janela até reabrir o app. */}
      {estado.tipo !== 'instalando' && (
        <button
          type="button"
          onClick={() => setEstado({ tipo: 'nada' })}
          aria-label="Fechar aviso"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-neutral-400 outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
