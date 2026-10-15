import { useEffect, useState, type ReactNode } from 'react';

// Ao abrir, antes de tudo: procura versão nova e, se houver, baixa e instala
// sozinho, com uma barra, e reabre. Antes era um aviso com "Atualizar" que muita
// gente ignorava, e correção nenhuma chegava a quem já tinha instalado. Qualquer
// falha (sem rede, servidor fora, assinatura que não bate) segue para o app em
// silêncio: tenta de novo na próxima abertura.

type Estado = { tipo: 'procurando' } | { tipo: 'baixando'; versao: string; pct: number | null } | { tipo: 'pronto' };

// Rede lenta não pode prender a pessoa na tela de abertura.
const CONFERIR_MS = 8000;
// Download parado tanto tempo sem chegar nada: desiste desta vez.
const PARADO_MS = 30_000;

export default function AtualizacaoInicial({ children }: { children: ReactNode }) {
  // No `pnpm dev` a versão é a do package.json (sempre atrás da release): instalar
  // trocaria o binário de dev pela release.
  // Build da develop (só para testar no Mac): a release estável é "mais nova" pelo
  // número e substituiria o teste logo na abertura.
  const semAtualizar = import.meta.env.DEV || import.meta.env.VITE_CANAL === 'develop';
  const [estado, setEstado] = useState<Estado>(semAtualizar ? { tipo: 'pronto' } : { tipo: 'procurando' });

  useEffect(() => {
    if (semAtualizar) return;
    let desistiu = false;
    let vigia: number | undefined;
    const seguir = () => {
      desistiu = true;
      window.clearTimeout(vigia);
      setEstado({ tipo: 'pronto' });
    };
    void (async () => {
      let servidorParado = false;
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const u = await check({ timeout: CONFERIR_MS });
        if (!u || desistiu) return seguir();
        let total: number | null = null;
        let baixado = 0;
        const rearmar = () => {
          window.clearTimeout(vigia);
          vigia = window.setTimeout(seguir, PARADO_MS);
        };
        setEstado({ tipo: 'baixando', versao: u.version, pct: null });
        rearmar();
        await u.download((ev) => {
          if (desistiu) return;
          rearmar();
          if (ev.event === 'Started') total = ev.data.contentLength ?? null;
          else if (ev.event === 'Progress') baixado += ev.data.chunkLength;
          setEstado({ tipo: 'baixando', versao: u.version, pct: total ? Math.min(100, Math.round((baixado / total) * 100)) : null });
        });
        window.clearTimeout(vigia);
        // A vigia já soltou o app: instalar agora derrubaria a pessoa no meio do uso.
        if (desistiu) return;
        // No Windows o instalador encerra o app sem passar pelo evento de saída: o
        // servidor tem de parar antes, ou seguraria o próprio executável aberto.
        if (navigator.userAgent.includes('Windows')) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('parar_servidor_para_atualizar');
          servidorParado = true;
        }
        await u.install();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch (e) {
        console.error('atualização falhou; tenta de novo na próxima abertura', e);
        if (servidorParado) {
          // O servidor já parou: sobe de novo (a janela recarrega sozinha).
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('reiniciar').catch(() => {});
          return;
        }
        seguir();
      }
    })();
    return () => {
      desistiu = true;
      window.clearTimeout(vigia);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (estado.tipo === 'pronto') return <>{children}</>;

  return (
    <div className="grid h-dvh place-items-center bg-neutral-950 px-6">
      <div className="w-full max-w-xs text-center" role="status" aria-live="polite">
        <div className="text-2xl font-semibold tracking-tight text-neutral-50">Astroflix</div>
        {estado.tipo === 'procurando' ? (
          <>
            <div className="mx-auto mt-6 h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300 motion-reduce:animate-none" />
            <p className="mt-3 text-sm text-neutral-400">Procurando atualizações…</p>
          </>
        ) : (
          <>
            <p className="mt-6 text-sm text-neutral-300">Atualizando para a versão {estado.versao}…</p>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={estado.pct ?? undefined}
            >
              <div
                className={`h-full rounded-full bg-blue-500 transition-[width] duration-300 motion-reduce:transition-none${estado.pct === null ? ' w-1/3 animate-pulse' : ''}`}
                style={estado.pct === null ? undefined : { width: `${estado.pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-neutral-500">
              {estado.pct === null ? 'Baixando…' : `${estado.pct}%`} · o Astroflix reabre sozinho
            </p>
          </>
        )}
      </div>
    </div>
  );
}
