import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Exportacao } from '../api/client';
import { useDownloads } from '../api/hooks';
import { mensagemErroDrive } from '../api/driveAuth';
import { mensagemErroTelegram } from '../api/telegramTextos';
import { formatBytes, formatRestante, percent } from '../lib/format';
import { getPref, setPref } from '../lib/prefs';
import { Download, X } from './icons';

// Os "Baixar para Downloads" em andamento, em qualquer tela: o download de um
// curso leva horas, e a pessoa continua usando o app enquanto isso. Fica no canto
// esquerdo (o direito é do pomodoro), recolhido numa pílula ou aberto com cada
// curso. Some quando não há nada na lista.

const fracao = (e: Exportacao) => (e.bytesTotal > 0 ? e.bytesFeitos / e.bytesTotal : e.total > 0 ? e.feitos / e.total : 0);

function Barra({ valor, tom = 'azul' }: { valor: number; tom?: 'azul' | 'verde' | 'ambar' }) {
  const cor = tom === 'verde' ? 'bg-emerald-500' : tom === 'ambar' ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(valor * 100)}>
      <div className={`h-full rounded-full ${cor} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${Math.min(100, valor * 100)}%` }} />
    </div>
  );
}

function Item({ e }: { e: Exportacao }) {
  const qc = useQueryClient();
  const atualizar = () => qc.invalidateQueries({ queryKey: ['downloads'] });
  const pronto = !e.ativo && !e.erro && !e.cancelado && e.feitos === e.total;
  const parado = !e.ativo && !pronto;
  const restante = e.velocidade && e.velocidade > 0 ? (e.bytesTotal - e.bytesFeitos) / e.velocidade : null;

  let linha: string;
  if (e.naFila) linha = 'Na fila';
  else if (e.ativo)
    linha = e.velocidade == null ? 'Começando…' : `${formatBytes(e.velocidade)}/s${restante != null ? ` · ${formatRestante(restante)}` : ''}`;
  else if (pronto) linha = 'Concluído';
  else if (e.erro && e.tentarEm)
    linha = `${e.origem === 'telegram' ? mensagemErroTelegram(e.erro) : mensagemErroDrive(e.erro)} Tentando de novo em ${Math.max(1, Math.round((e.tentarEm - Date.now()) / 1000))} s.`;
  else if (e.erro) linha = `Parou: ${e.origem === 'telegram' && e.erro !== 'sem-espaco' ? mensagemErroTelegram(e.erro) : mensagemErroDrive(e.erro)}`;
  else linha = 'Cancelado';

  const botao = 'rounded px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-neutral-100" title={e.titulo}>
            {e.titulo}
          </div>
          {e.ativo && e.arquivo && (
            <div className="truncate text-xs text-neutral-500" title={e.arquivo}>
              {e.arquivo}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {e.ativo ? (
            <button type="button" className={botao} onClick={() => void api.cancelarExportacao(e.courseId).then(atualizar, () => undefined)}>
              Cancelar
            </button>
          ) : (
            <>
              {parado && (
                <button type="button" className={botao} onClick={() => void api.exportarCurso(e.courseId).then(atualizar, () => undefined)}>
                  Continuar
                </button>
              )}
              <button
                type="button"
                aria-label={`Tirar "${e.titulo}" da lista`}
                className="grid h-6 w-6 place-items-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                onClick={() => void api.dispensarDownload(e.courseId).then(atualizar, () => undefined)}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      <Barra valor={fracao(e)} tom={pronto ? 'verde' : parado ? 'ambar' : 'azul'} />
      <div className="flex justify-between gap-2 text-xs tabular-nums text-neutral-400">
        <span className={`truncate ${e.erro && !e.ativo ? 'text-amber-300' : ''}`}>{linha}</span>
        <span className="shrink-0">
          {e.feitos}/{e.total} · {formatBytes(e.bytesFeitos)} de {formatBytes(e.bytesTotal)}
        </span>
      </div>
      {pronto && (
        <div className="truncate text-xs text-neutral-500" title={e.pasta}>
          {e.pasta}
        </div>
      )}
    </li>
  );
}

export default function PainelDownloads() {
  const { data } = useDownloads();
  const [aberto, setAberto] = useState(() => getPref<boolean>('downloads.aberto', true));
  const itens = data?.itens ?? [];
  if (!itens.length) return null;

  const alternar = () => {
    setAberto(!aberto);
    setPref('downloads.aberto', !aberto);
  };
  const ativos = itens.filter((e) => e.ativo);
  const somaFeitos = itens.reduce((s, e) => s + e.bytesFeitos, 0);
  const somaTotal = itens.reduce((s, e) => s + e.bytesTotal, 0);
  const velocidade = ativos.reduce((s, e) => s + (e.velocidade ?? 0), 0);
  const resumo = ativos.length
    ? `Baixando ${ativos.length} curso${ativos.length === 1 ? '' : 's'}${velocidade > 0 ? ` · ${formatBytes(velocidade)}/s` : ''}`
    : 'Downloads';

  return (
    <div className="fixed bottom-4 left-4 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-neutral-800 bg-neutral-900/95 shadow-lg shadow-black/50">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Download size={16} className="shrink-0 text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{resumo}</span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-400">{percent(somaFeitos, somaTotal)}%</span>
        <span className="shrink-0 text-xs text-neutral-500" aria-hidden>
          {aberto ? '▾' : '▴'}
        </span>
      </button>
      {aberto ? (
        <ul className="max-h-[50vh] divide-y divide-neutral-800 overflow-y-auto border-t border-neutral-800 px-3 py-3">
          {itens.map((e) => (
            <Item key={e.courseId} e={e} />
          ))}
          {/* A casca do desktop esconde a janela em vez de fechar (desktop/src-tauri/src/lib.rs). */}
          {ativos.length > 0 && (
            <li className="pt-3 text-xs text-neutral-500">Pode fechar a janela: o download continua e o app sai sozinho quando terminar.</li>
          )}
        </ul>
      ) : (
        ativos.length > 0 && (
          <div className="px-3 pb-2.5">
            <Barra valor={somaTotal > 0 ? somaFeitos / somaTotal : 0} />
          </div>
        )
      )}
    </div>
  );
}
