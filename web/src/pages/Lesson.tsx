import { useEffect, useRef, useState, useCallback, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { abrirFora } from '../lib/desktop';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PlaybackVerdict } from '../api/client';
import { autorizarNoGoogle, mensagemErroDrive } from '../api/driveAuth';
import { mensagemErroTelegram } from '../api/telegramTextos';
import TelegramLinkModal from '../components/TelegramLinkModal';
import { getPref, setPref } from '../lib/prefs';
import PlaylistSidebar from '../components/PlaylistSidebar';
import EndOfLessonCountdown from '../components/EndOfLessonCountdown';
import HelpLink from '../components/HelpLink';
import { ATALHOS } from '../help/content';
import { ArrowLeft, Camera, SkipBack, SkipForward, Check, Repeat, HelpCircle, X, Expand, Cards } from '../components/icons';
import FlashcardsPanel from '../components/FlashcardsPanel';
import { BloqueioDaPausa, WidgetPomodoro } from '../components/Pomodoro';
import { usePomodoro } from '../lib/pomodoro';

type SaveState = 'idle' | 'saved' | 'error';
type Notice = { kind: 'success' | 'error'; text: string };

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 place-items-center rounded-lg transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-30 ${
        active ? 'bg-blue-600/30 text-blue-200' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
      }`}
    >
      {children}
    </button>
  );
}

export default function Lesson() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // O painel de ajuda guarda seu estado na URL, então dá para lê-lo daqui e
  // suspender os atalhos do player enquanto ele estiver aberto — sem estado
  // compartilhado nem ordem de listeners para acertar.
  const [searchParams] = useSearchParams();
  const ajudaAberta = searchParams.has('ajuda');
  const videoRef = useRef<HTMLVideoElement>(null);
  const furthestRef = useRef(0);
  const lastSaveRef = useRef(0);
  const mountedRef = useRef(true);
  const noticeTimer = useRef(0);
  const savedTimer = useRef(0);
  const seekFlashTimer = useRef(0);
  const lastTapRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
  // Gesto "segurar = 2×" (estilo YouTube): timer do long-press + taxa anterior.
  const boostTimer = useRef(0);
  const boostRef = useRef(false);
  const prevRateRef = useRef(1);
  const pressingRef = useRef(false);
  // Pausa do pomodoro: o vídeo para e não volta a tocar até ela acabar ou ser pulada.
  const { emPausa } = usePomodoro();
  const emPausaRef = useRef(emPausa);
  emPausaRef.current = emPausa;
  // Tempo de aula do painel de estudo: o tempo de relógio com o vídeo tocando (em 2×,
  // 10 minutos contam 10), mandado aos pedaços.
  const assistidoMs = useRef(0);
  const ultimoTique = useRef(0);
  const [boost, setBoost] = useState(false);
  const [seekFlash, setSeekFlash] = useState<'back' | 'fwd' | null>(null);
  // Zonas de double-tap só existem em ponteiro grosso (touch): no desktop o
  // mouse já tem clique nativo do <video> e o teclado cobre o seek (←/→).
  const [coarsePointer] = useState<boolean>(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches,
  );
  // Coluna ao lado do vídeo: a lista de aulas ou os flashcards da aula.
  const [aba, setAba] = useState<'aulas' | 'flashcards'>('aulas');
  const [autoplay, setAutoplay] = useState<boolean>(() => getPref('player.autoplay', true));
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Veredito real de reprodução (formato de DENTRO do arquivo — a extensão mente
  // em acervos baixados: MPEG-TS renomeado, H.264 10-bit). null = ainda não verificado.
  const [verdict, setVerdict] = useState<PlaybackVerdict | null>(null);
  const [converting, setConverting] = useState(false);
  // 0–1 enquanto a aula é recodificada em segundo plano; null fora disso.
  const [progressoConversao, setProgressoConversao] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [help, setHelp] = useState(false);
  const [confirmCover, setConfirmCover] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  // Falha de vídeo do Drive explicada pelo servidor (autorização, cota, rede) e a chave que
  // força o <video> a recarregar depois de reautorizar.
  const [driveErro, setDriveErro] = useState<{ erro: string; texto: string } | null>(null);
  const [conectandoTelegram, setConectandoTelegram] = useState(false);
  const [videoKey, setVideoKey] = useState(0);
  const [reautorizando, setReautorizando] = useState(false);
  const [urlAuth, setUrlAuth] = useState<string | null>(null);
  const abortAuthRef = useRef<AbortController | null>(null);

  const { data: lesson } = useQuery({ queryKey: ['lesson', id], queryFn: () => api.getLesson(id) });

  // Media Session: título/capa e controles na notificação de mídia e na tela de
  // bloqueio (Android/iOS). No Android isto também habilita continuar o ÁUDIO em
  // segundo plano: ao sair do app com o vídeo tocando, a notificação do Chrome
  // permite retomar a reprodução com a tela apagada.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !lesson) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: lesson.title,
      artist: lesson.courseTitle,
      artwork: [{ src: api.lessonThumbUrl(lesson.id), sizes: '480x270', type: 'image/jpeg' }],
    });
    const seek = (delta: number) => {
      const v = videoRef.current;
      if (v) v.currentTime = Math.max(0, v.currentTime + delta);
    };
    navigator.mediaSession.setActionHandler('play', () => void videoRef.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => videoRef.current?.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => seek(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seek(10));
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward'] as MediaSessionAction[]) {
        navigator.mediaSession.setActionHandler(a, null);
      }
    };
  }, [lesson]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortAuthRef.current?.abort();
      window.clearTimeout(noticeTimer.current);
      window.clearTimeout(savedTimer.current);
      window.clearTimeout(seekFlashTimer.current);
      window.clearTimeout(boostTimer.current);
    };
  }, []);

  const showNotice = useCallback((kind: Notice['kind'], text: string) => {
    setNotice({ kind, text });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      if (mountedRef.current) setNotice(null);
    }, 3500);
  }, []);

  const save = useCallback(
    (opts?: { keepalive?: boolean; silent?: boolean }) => {
      const v = videoRef.current;
      if (!v) return;
      const body = {
        position_sec: v.currentTime,
        furthest_sec: furthestRef.current,
        duration_sec: Number.isFinite(v.duration) ? v.duration : null,
      };
      if (opts?.keepalive) {
        fetch(`/api/lessons/${id}/progress`, {
          method: 'PATCH',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
        return;
      }
      api
        .saveProgress(id, body)
        .then(() => {
          if (!mountedRef.current) return;
          // Autosave silencioso só limpa um erro anterior; não pisca "Salvo".
          if (opts?.silent) {
            setSaveState((s) => (s === 'error' ? 'idle' : s));
            return;
          }
          setSaveState('saved');
          window.clearTimeout(savedTimer.current);
          savedTimer.current = window.setTimeout(() => {
            if (mountedRef.current) setSaveState('idle');
          }, 2000);
        })
        .catch(() => {
          // Nunca engolir a falha: a confiança no progresso é o ponto do produto.
          if (mountedRef.current) setSaveState('error');
        });
    },
    [id],
  );

  const goTo = useCallback(
    (lessonId: string) => {
      save();
      navigate(`/lesson/${lessonId}`);
    },
    [save, navigate],
  );

  // Tela cheia via Fullscreen API padrão, com fallback para o modo nativo do
  // <video> no iOS Safari (que não implementa Fullscreen API no elemento).
  const toggleFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (v.requestFullscreen) {
      void v.requestFullscreen();
    } else if ((v as any).webkitEnterFullscreen) {
      (v as any).webkitEnterFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const onLoaded = () => {
    const v = videoRef.current;
    if (v && lesson && !lesson.completed && lesson.position > 0) v.currentTime = lesson.position;
  };

  const mandarAssistido = useCallback(
    (tudo: boolean) => {
      const s = Math.floor(assistidoMs.current / 1000);
      if (s < (tudo ? 1 : 30)) return;
      assistidoMs.current -= s * 1000;
      void api.registrarTempoAula(id, s);
    },
    [id],
  );

  // Saiu da aula (ou trocou de aula): o que faltava mandar vai junto.
  useEffect(
    () => () => {
      mandarAssistido(true);
      ultimoTique.current = 0;
    },
    [mandarAssistido],
  );

  useEffect(() => {
    if (!emPausa) return;
    const v = videoRef.current;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (v && !v.paused) v.pause();
  }, [emPausa]);

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      const t = Date.now();
      // Um salto grande é o vídeo parado (aba escondida, buffer): não é estudo.
      if (ultimoTique.current && t - ultimoTique.current < 3000) assistidoMs.current += t - ultimoTique.current;
      ultimoTique.current = t;
      mandarAssistido(false);
    }
    furthestRef.current = Math.max(furthestRef.current, v.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current > 5000) {
      lastSaveRef.current = now;
      save({ silent: true });
    }
  };

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') save({ keepalive: true });
    };
    const onUnload = () => save({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      save({ keepalive: true });
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Painel de ajuda aberto: ele é dono do teclado (inclusive do Esc, que
      // fecha o painel e não a aula). O player fica inteiramente suspenso.
      if (ajudaAberta) return;
      // Escrevendo um flashcard: as teclas são texto, não atalhos do player.
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'INPUT' || alvo.isContentEditable)) {
        if (e.key === 'Escape') alvo.blur();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === 'Escape') {
        if (help) return setHelp(false);
        if (confirmCover) return setConfirmCover(false);
        if (lesson) {
          save();
          navigate(`/course/${lesson.courseId}`);
        }
        return;
      }
      // Enquanto um overlay está aberto, os atalhos do player ficam suspensos.
      if (help || confirmCover) return;
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (v.paused) void v.play();
          else v.pause();
          break;
        case 'ArrowRight':
          v.currentTime += 10;
          break;
        case 'ArrowLeft':
          v.currentTime -= 10;
          break;
        case 'ArrowUp':
          v.volume = Math.min(1, v.volume + 0.1);
          break;
        case 'ArrowDown':
          v.volume = Math.max(0, v.volume - 0.1);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          v.muted = !v.muted;
          break;
        case 'n':
          if (lesson?.nextLessonId) goTo(lesson.nextLessonId);
          break;
        case 'p':
          if (lesson?.prevLessonId) goTo(lesson.prevLessonId);
          break;
        case 'c':
          setAba((a) => (a === 'flashcards' ? 'aulas' : 'flashcards'));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lesson, navigate, save, goTo, help, confirmCover, toggleFullscreen, ajudaAberta]);

  // Os gestos de toque moram AQUI, por coordenada, e não em camadas sobre o
  // vídeo: qualquer elemento cobrindo o <video> impedia o Chrome Android de
  // mostrar os controles nativos no retrato (toque nunca chegava ao vídeo).
  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    pressingRef.current = true;
    // Faixa útil dos gestos exclui o transporte nativo do <video> (rodapé):
    // tocar/arrastar controles nunca dispara gesto. Medida no palco, que não
    // ocupa mais a tela inteira (a lista de aulas fica ao lado).
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientY > r.bottom - 72) return;
    // Double-tap nos terços laterais = ±10s. O toque também chega ao <video>
    // (revela os controles nativos) — mesmo comportamento do YouTube.
    const x = e.clientX - r.left;
    const side = x < r.width / 3 ? 'left' : x > (2 * r.width) / 3 ? 'right' : null;
    if (side) {
      const now = Date.now();
      if (now - lastTapRef.current[side] < 300) {
        lastTapRef.current[side] = 0;
        seekBy(side === 'left' ? 'back' : 'fwd');
      } else {
        lastTapRef.current[side] = now;
      }
    }
    // Segurar 500 ms em qualquer ponto da faixa = 2× enquanto o dedo estiver
    // na tela; soltar volta à velocidade anterior.
    window.clearTimeout(boostTimer.current);
    boostTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.paused || !pressingRef.current) return;
      prevRateRef.current = v.playbackRate;
      v.playbackRate = 2;
      boostRef.current = true;
      setBoost(true);
    }, 500);
  };

  const endStagePress = () => {
    pressingRef.current = false;
    window.clearTimeout(boostTimer.current);
    if (!boostRef.current) return;
    const v = videoRef.current;
    if (v) v.playbackRate = prevRateRef.current;
    boostRef.current = false;
    setBoost(false);
  };

  // Reprodução real ≠ extensão do arquivo: acervos baixados trazem MPEG-TS
  // renomeado p/ .mp4 (browser não demuxa) e H.264 10-bit (browser não
  // decodifica). verify-playback proba o formato DE DENTRO e sincroniza o flag;
  // convert remuxa sem perda quando dá (TS→MP4), sem tocar no arquivo original.
  const verifyPlayback = useCallback(async () => {
    try {
      let v = await api.verifyPlayback(id);
      // Aula do Drive/Telegram ainda sem arquivo: o servidor só tem o flag, que
      // dizia "toca". Se o <video> falhou mesmo assim (MPEG-TS com cara de .mp4),
      // é formato: a aula espera o download, que converte sozinho.
      if (v.playable && (v as { semArquivo?: boolean }).semArquivo) {
        v = { playable: false, reason: 'container', remuxable: false, semArquivo: true };
      }
      setVerdict(v);
      // Também quando passa a tocar: o flag guardado pode ter vindo de uma regra
      // antiga (HEVC era sempre "não toca") e só o lesson recarregado libera o player.
      qc.invalidateQueries({ queryKey: ['lesson', id] });
      qc.invalidateQueries({ queryKey: ['course'] });
      return v;
    } catch {
      return null;
    }
  }, [id, qc]);

  // O <video> falhou em algo que o flag dizia tocável — descobre o motivo real
  // e troca a tela preta por um estado acionável.
  const ehDrive = lesson?.courseSource === 'drive';
  const ehTelegram = lesson?.courseSource === 'telegram';
  // Sem arquivo local: nem remux, nem frame como capa, e o erro do vídeo se explica pela origem.
  const ehRemoto = ehDrive || ehTelegram;
  const onVideoError = useCallback(() => {
    if (!ehRemoto) {
      if (!verdict) void verifyPlayback();
      return;
    }
    // No Drive o <video> só vê "falhou"; o motivo real (autorização, cota, rede) vem no JSON do
    // stream. Se não vier JSON, o arquivo chegou e o problema é o formato: segue o fluxo normal.
    void (async () => {
      try {
        const r = await fetch(`/api/lessons/${id}/stream`, { headers: { Range: 'bytes=0-0' } });
        if (!(r.headers.get('content-type') ?? '').includes('application/json')) throw new Error('sem-json');
        const j = (await r.json()) as { error?: string; esperaSeg?: number };
        if (j.error) {
          const texto = ehTelegram ? mensagemErroTelegram(j.error, j.esperaSeg) : mensagemErroDrive(j.error);
          if (mountedRef.current) setDriveErro({ erro: j.error, texto });
          return;
        }
      } catch {
        // cai no veredito de formato abaixo
      }
      if (!verdict) void verifyPlayback();
    })();
  }, [ehRemoto, ehTelegram, id, verdict, verifyPlayback]);

  const reautorizar = async () => {
    setReautorizando(true);
    try {
      const { url } = await api.driveIniciarAuth();
      // O signal para a espera ao sair da aula.
      const ctrl = new AbortController();
      abortAuthRef.current = ctrl;
      setUrlAuth(url);
      const ok = await autorizarNoGoogle(url, { signal: ctrl.signal });
      if (ctrl.signal.aborted || !mountedRef.current) return;
      setUrlAuth(null);
      if (ok) {
        setDriveErro(null);
        setVideoKey((k) => k + 1);
      } else {
        showNotice('error', 'A autorização do Google não foi concluída.');
      }
    } catch (e) {
      showNotice('error', mensagemErroDrive(e instanceof Error ? e.message : ''));
    }
    if (mountedRef.current) setReautorizando(false);
  };

  // Flag já dizia não-tocável (selo do curso): busca o veredito com o motivo
  // e se é remuxável, para oferecer o botão certo.
  useEffect(() => {
    if (lesson && !lesson.playable && !verdict) void verifyPlayback();
  }, [lesson, verdict, verifyPlayback]);

  const conversaoPronta = () => {
    setVerdict(null);
    setProgressoConversao(null);
    qc.invalidateQueries({ queryKey: ['lesson', id] });
    qc.invalidateQueries({ queryKey: ['course'] });
    setVideoKey((k) => k + 1);
    showNotice('success', 'Vídeo convertido — bom estudo!');
  };

  // A recodificação leva minutos e roda no servidor: aqui só acompanha. Também
  // retoma a barra se a pessoa saiu da aula e voltou com a conversão andando.
  const acompanharConversao = useCallback(async () => {
    for (;;) {
      if (!mountedRef.current) return;
      let st;
      try {
        st = await api.convertStatus(id);
      } catch {
        st = null;
      }
      if (!mountedRef.current) return;
      if (st?.status === 'transcoding') {
        setProgressoConversao(st.progresso);
        await new Promise((ok) => setTimeout(ok, 1000));
        continue;
      }
      if (st?.status === 'converted') conversaoPronta();
      else if (st?.status === 'failed') {
        setProgressoConversao(null);
        showNotice('error', 'Falha ao converter o vídeo. Tente de novo.');
      } else setProgressoConversao(null);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (verdict && !verdict.playable) void acompanharConversao();
  }, [verdict, acompanharConversao]);

  // Aula remota que não toca direto: abrir a aula já pediu o download, e ele
  // converte sozinho. Antes a tela ficava parada mesmo depois da aula pronta, e
  // parecia que o vídeo nunca ia tocar; agora ela confere e começa a tocar sozinha.
  const esperandoArquivo = !!verdict && !verdict.playable && !!verdict.semArquivo;
  useEffect(() => {
    if (!esperandoArquivo) return;
    const t = setInterval(() => {
      void (async () => {
        let v;
        try {
          v = await api.verifyPlayback(id);
        } catch {
          return;
        }
        if (!mountedRef.current || (v as { semArquivo?: boolean }).semArquivo) return;
        if (v.playable) {
          setVerdict(null);
          qc.invalidateQueries({ queryKey: ['lesson', id] });
          qc.invalidateQueries({ queryKey: ['course'] });
          setVideoKey((k) => k + 1);
          showNotice('success', 'A aula chegou — bom estudo!');
        } else {
          setVerdict(v);
        }
      })();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperandoArquivo, id]);

  const doConvert = async () => {
    setConverting(true);
    try {
      const r = await api.convertLesson(id);
      if (r.status === 'transcoding') {
        setProgressoConversao(0);
        void acompanharConversao();
      } else conversaoPronta();
    } catch {
      showNotice('error', 'Falha ao converter. Tente novamente.');
    }
    setConverting(false);
  };

  // Clicar na aula é o pedido de conversão: em vez de um botão "Converter" na
  // tela, a aula já começa a ser preparada e a tela mostra só o andamento. Uma vez
  // por aula: se falhar, a tela oferece tentar de novo (sem repetir em loop).
  const conversaoPedida = useRef<string | null>(null);
  useEffect(() => {
    if (!verdict || verdict.playable || verdict.semArquivo) return;
    if (conversaoPedida.current === id) return;
    conversaoPedida.current = id;
    void doConvert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, id]);

  // Espelha ArrowLeft/ArrowRight (~L229-234): mesmo delta de 10s, sem clamp
  // (o próprio <video> satura em 0/duration). O flash visual soma sozinho.
  const seekBy = useCallback((dir: 'back' | 'fwd') => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime += dir === 'back' ? -10 : 10;
    setSeekFlash(dir);
    window.clearTimeout(seekFlashTimer.current);
    seekFlashTimer.current = window.setTimeout(() => {
      if (mountedRef.current) setSeekFlash(null);
    }, 650);
  }, []);

  const toggleAutoplay = () =>
    setAutoplay((a) => {
      const n = !a;
      setPref('player.autoplay', n);
      return n;
    });

  const toggleComplete = async () => {
    if (!lesson) return;
    await api.setComplete(id, !lesson.completed);
    qc.invalidateQueries({ queryKey: ['lesson', id] });
    qc.invalidateQueries({ queryKey: ['course', lesson.courseId] });
  };

  const doCaptureCover = async () => {
    setConfirmCover(false);
    const v = videoRef.current;
    if (!v || !lesson) return;
    try {
      await api.setCover(lesson.courseId, id, v.currentTime);
      qc.invalidateQueries({ queryKey: ['course', lesson.courseId] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      showNotice('success', 'Capa do curso atualizada.');
    } catch {
      showNotice('error', 'Não foi possível definir a capa. Verifique se o ffmpeg está instalado.');
    }
  };

  const onEnded = () => {
    if (autoplay) setEnding(true);
  };

  const finishAndAdvance = async () => {
    setEnding(false);
    if (!lesson) return;
    await api.setComplete(id, true);
    qc.invalidateQueries({ queryKey: ['lesson', id] });
    qc.invalidateQueries({ queryKey: ['course', lesson.courseId] });
    if (lesson.nextLessonId) navigate(`/lesson/${lesson.nextLessonId}`);
  };

  if (!lesson) {
    // Esqueleto: pré-pinta o palco preto + barra de título, para a chegada do
    // player não causar layout-shift. Sem spinner (guia de produto).
    return (
      <div className="relative h-screen bg-black">
        <div className="absolute inset-x-0 top-0 p-4">
          <div className="h-5 w-64 max-w-[60%] animate-pulse rounded bg-neutral-800 motion-reduce:animate-none" />
        </div>
        <div className="grid h-screen place-items-center text-sm text-neutral-500">Carregando a aula…</div>
      </div>
    );
  }

  if (driveErro) {
    return (
      <div className="grid h-screen place-items-center p-6 text-center">
        <div className="max-w-md">
          <div className="mb-2 text-lg font-medium" role="alert">{driveErro.texto}</div>
          {notice && (
            <p className="mb-4 text-sm text-amber-200" role="status">{notice.text}</p>
          )}
          {urlAuth && (
            <p className="mb-2 text-sm text-neutral-300" role="status">
              Conclua a autorização no navegador que abriu.{' '}
              <button type="button" onClick={() => void abrirFora(urlAuth)} className="underline decoration-neutral-600 underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                Abrir de novo
              </button>
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {driveErro.erro === 'nao-autorizado' && ehTelegram && (
              <button
                type="button"
                onClick={() => setConectandoTelegram(true)}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Conectar de novo
              </button>
            )}
            {driveErro.erro === 'nao-autorizado' && !ehTelegram && (
              <button
                type="button"
                onClick={() => void reautorizar()}
                disabled={reautorizando}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
              >
                Autorizar de novo
              </button>
            )}
            {(driveErro.erro === 'sem-conexao' || driveErro.erro === 'cota-esgotada' || driveErro.erro === 'flood') && (
              <button
                type="button"
                onClick={() => {
                  setDriveErro(null);
                  setVideoKey((k) => k + 1);
                }}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Tentar de novo
              </button>
            )}
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-neutral-800 px-4 text-neutral-200 transition-colors motion-reduce:transition-none hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => navigate(`/course/${lesson.courseId}`)}
            >
              <ArrowLeft size={18} /> Voltar ao curso
            </button>
          </div>
        </div>
        {conectandoTelegram && (
          <TelegramLinkModal
            soLogin
            onClose={() => setConectandoTelegram(false)}
            onConectado={() => {
              setDriveErro(null);
              setVideoKey((k) => k + 1);
            }}
          />
        )}
      </div>
    );
  }

  if (!lesson.playable || (verdict && !verdict.playable)) {
    const remuxable = verdict && !verdict.playable ? verdict.remuxable : null;
    // Aula do Drive/Telegram já baixada é um arquivo como outro qualquer: dá para converter.
    const semArquivo = verdict && !verdict.playable ? !!verdict.semArquivo : ehRemoto;
    return (
      <div className="grid h-screen place-items-center p-6 text-center">
        <div className="max-w-md">
          {!semArquivo && remuxable !== null ? (
            // Abrir a aula já pediu a conversão (ver o efeito acima): aqui só o andamento.
            notice?.kind === 'error' ? (
              <>
                <div className="mb-2 text-lg font-medium">Não foi possível preparar este vídeo</div>
                <button
                  type="button"
                  onClick={() => void doConvert()}
                  disabled={converting}
                  className="mb-4 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors motion-reduce:transition-none hover:bg-blue-500 disabled:opacity-40"
                >
                  Tentar de novo
                </button>
              </>
            ) : (
              <div className="mx-auto mb-4 max-w-xs" role="status">
                <div className="mb-1 text-lg font-medium">Preparando o vídeo…</div>
                <p className="mb-4 text-sm text-neutral-400">
                  {remuxable
                    ? 'Ajustando o arquivo para tocar aqui. Leva só alguns segundos.'
                    : 'Convertendo para um formato que toca aqui. Pode levar alguns minutos; o original não é alterado.'}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                  {progressoConversao !== null ? (
                    <div className="h-full bg-blue-600" style={{ width: `${Math.max(2, progressoConversao * 100)}%` }} />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse bg-blue-600 motion-reduce:animate-none" />
                  )}
                </div>
                {progressoConversao !== null && (
                  <div className="mt-1.5 text-xs text-neutral-500">{Math.round(progressoConversao * 100)}%</div>
                )}
              </div>
            )
          ) : (
            <div className="mb-2 text-lg font-medium">Este vídeo está num formato que o navegador não reproduz</div>
          )}
          {remuxable === false && semArquivo && (
            <p className="mb-4 text-sm text-neutral-400">
              O formato deste vídeo não toca direto {ehDrive ? 'do Google Drive' : 'do Telegram'}. O Astroflix já está baixando a
              aula e, quando ela chegar, converte sozinho para um formato que toca. Volte daqui a alguns minutos.
            </p>
          )}
          {remuxable === null && <p className="mb-4 text-sm text-neutral-400">Verificando o formato do arquivo…</p>}
          {/* O aviso PRECISA existir aqui: esta tela retorna antes da árvore do
              player, onde fica o outro <notice>. Sem isto, uma conversão que
              falha não muda nada na tela — o clique vira um silêncio. */}
          {notice && (
            <p className={`mb-4 text-sm ${notice.kind === 'success' ? 'text-green-400' : 'text-amber-200'}`} role="status">
              {notice.text}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-neutral-800 px-4 text-neutral-200 transition-colors motion-reduce:transition-none hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              onClick={() => navigate(`/course/${lesson.courseId}`)}
            >
              <ArrowLeft size={18} /> Voltar ao curso
            </button>
            <HelpLink topico="video-nao-toca" className="text-sm text-neutral-400 hover:text-neutral-200">
              Entenda o que aconteceu
            </HelpLink>
          </div>
        </div>
      </div>
    );
  }

  const ABA = 'flex-1 border-b-2 px-3 py-2.5 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600';

  // Página de assistir no estilo YouTube: o vídeo à esquerda e, ao lado, a lista
  // de aulas e os flashcards em abas. Antes o player ocupava a tela inteira e a
  // lista abria por cima do vídeo, então trocar de aula pedia abrir um painel.
  // Tela cheia continua no F (só o vídeo).
  return (
    <div className="relative flex min-h-screen flex-col bg-studio-black lg:h-screen lg:flex-row">
      <main className="flex min-w-0 flex-1 flex-col lg:overflow-y-auto">
        <div
          className="flex items-center gap-3 px-4 pb-3 text-sm"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <IconButton label="Voltar ao curso (Esc)" onClick={() => navigate(`/course/${lesson.courseId}`)}>
            <ArrowLeft />
          </IconButton>
          <span className="min-w-0 flex-1 truncate text-neutral-400">{lesson.courseTitle}</span>
          {saveState === 'saved' && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
              <Check size={14} /> Salvo
            </span>
          )}
          {saveState === 'error' && (
            <span className="flex shrink-0 items-center gap-2 rounded border border-amber-700/40 bg-amber-900/40 px-2 py-1 text-xs text-amber-200">
              Falha ao salvar progresso
              <button type="button" onClick={() => save()} className="underline hover:no-underline">
                Tentar de novo
              </button>
            </span>
          )}
          {/* Atalhos de teclado — irrelevante no touch, ocultado no celular */}
          <div className="hidden sm:block">
            <IconButton label="Atalhos de teclado (?)" onClick={() => setHelp(true)}>
              <HelpCircle />
            </IconButton>
          </div>
        </div>

        <div
          className="relative bg-black"
          onPointerDown={onStagePointerDown}
          onPointerUp={endStagePress}
          onPointerCancel={endStagePress}
          onContextMenu={(e) => {
            if (pressingRef.current) e.preventDefault();
          }}
        >
          <video
            key={videoKey}
            ref={videoRef}
            src={`/api/lessons/${id}/stream`}
            className="aspect-video max-h-[calc(100vh-12rem)] w-full bg-black object-contain"
            controls
            autoPlay
            playsInline
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => {
              ultimoTique.current = Date.now();
              if (emPausaRef.current) videoRef.current?.pause();
            }}
            onPause={() => {
              ultimoTique.current = 0;
              mandarAssistido(true);
              save();
            }}
            onEnded={onEnded}
            onError={onVideoError}
          />

          <BloqueioDaPausa />

          {coarsePointer && (
            // Só INDICADORES (pointer-events-none): nada pode cobrir o <video>,
            // senão o Chrome Android nunca mostra os controles nativos no retrato.
            <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
              <div className="absolute inset-y-0 left-0 flex w-1/3 items-center justify-center">
                <span
                  className={`rounded-full bg-black/70 px-4 py-2 text-sm text-white transition-opacity duration-300 motion-reduce:transition-none ${seekFlash === 'back' ? 'opacity-100' : 'opacity-0'}`}
                >
                  -10s
                </span>
              </div>
              <div className="absolute inset-y-0 right-0 flex w-1/3 items-center justify-center">
                <span
                  className={`rounded-full bg-black/70 px-4 py-2 text-sm text-white transition-opacity duration-300 motion-reduce:transition-none ${seekFlash === 'fwd' ? 'opacity-100' : 'opacity-0'}`}
                >
                  +10s
                </span>
              </div>
              {boost && (
                <span className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white">
                  2×
                </span>
              )}
            </div>
          )}
        </div>

        <WidgetPomodoro variante="barra" />

        <div className="px-4 py-4">
          {lesson.module && <div className="text-xs text-neutral-500">{lesson.module}</div>}
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-neutral-100 text-balance">{lesson.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Ação principal da aula */}
            <button
              type="button"
              onClick={toggleComplete}
              aria-pressed={lesson.completed}
              title={lesson.completed ? 'Concluída — clique para desmarcar' : 'Marcar como concluída'}
              className={`flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                lesson.completed ? 'bg-green-500/15 text-green-400' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              <Check size={18} />
              {lesson.completed ? 'Concluída' : 'Concluir'}
            </button>
            <IconButton label="Aula anterior (P)" disabled={!lesson.prevLessonId} onClick={() => lesson.prevLessonId && goTo(lesson.prevLessonId)}>
              <SkipBack />
            </IconButton>
            <IconButton label="Próxima aula (N)" disabled={!lesson.nextLessonId} onClick={() => lesson.nextLessonId && goTo(lesson.nextLessonId)}>
              <SkipForward />
            </IconButton>
            <span className="mx-1 h-6 w-px bg-neutral-800" aria-hidden="true" />
            <IconButton
              label={autoplay ? 'Auto-avançar ao fim: ligado' : 'Auto-avançar ao fim: desligado'}
              onClick={toggleAutoplay}
              active={autoplay}
            >
              <Repeat off={!autoplay} />
            </IconButton>
            <IconButton
              label={isFullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
              onClick={toggleFullscreen}
              active={isFullscreen}
            >
              <Expand />
            </IconButton>
            {/* Definir capa — ação ocasional, ocultada no celular */}
            {!ehRemoto && (
              <div className="hidden sm:block">
                <IconButton label="Usar este frame como capa do curso" onClick={() => setConfirmCover(true)}>
                  <Camera />
                </IconButton>
              </div>
            )}
          </div>
        </div>
      </main>

      <aside className="flex min-h-[50vh] flex-col border-t border-neutral-800 bg-neutral-950 lg:h-screen lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[26rem]">
        <div role="tablist" aria-label="Ao lado do vídeo" className="flex shrink-0 border-b border-neutral-800">
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'aulas'}
            onClick={() => setAba('aulas')}
            className={`${ABA} ${aba === 'aulas' ? 'border-blue-500 text-neutral-100' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}
          >
            Aulas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={aba === 'flashcards'}
            onClick={() => setAba('flashcards')}
            title="Flashcards da aula (C)"
            className={`${ABA} ${aba === 'flashcards' ? 'border-blue-500 text-neutral-100' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}
          >
            <Cards size={14} className="mr-1.5 inline -translate-y-px" />
            Flashcards
          </button>
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
          {aba === 'aulas' ? (
            <PlaylistSidebar courseId={lesson.courseId} currentLessonId={id} onJump={(lid) => goTo(lid)} />
          ) : (
            <FlashcardsPanel
              lessonId={id}
              courseId={lesson.courseId}
              tempoAtual={() => videoRef.current?.currentTime ?? 0}
              onIrPara={(seg) => {
                const v = videoRef.current;
                if (v) v.currentTime = seg;
              }}
              onPausar={() => videoRef.current?.pause()}
            />
          )}
        </div>
      </aside>

      {notice && (
        <div
          className="absolute left-1/2 z-30 -translate-x-1/2 rounded-lg border border-neutral-800 bg-neutral-900/95 px-4 py-2 text-sm"
          style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          <span className={notice.kind === 'success' ? 'text-green-400' : 'text-amber-200'}>{notice.text}</span>
        </div>
      )}

      {confirmCover && (
        <div className="absolute inset-0 grid place-items-center z-30">
          <div className="bg-neutral-900/95 rounded-xl p-5 text-center">
            <div className="text-neutral-200 mb-1">Usar este frame como capa do curso?</div>
            <div className="text-sm text-neutral-400 mb-4">Substitui a capa atual.</div>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={() => setConfirmCover(false)} className="px-3 py-2 bg-neutral-800 rounded-lg hover:bg-neutral-700">
                Cancelar
              </button>
              <button type="button" onClick={doCaptureCover} className="px-3 py-2 bg-blue-600 rounded-lg hover:bg-blue-500">
                Usar este frame
              </button>
            </div>
          </div>
        </div>
      )}

      {help && (
        <div className="absolute inset-0 grid place-items-center z-40 bg-black/60 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm bg-neutral-900 rounded-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium">Atalhos de teclado</span>
              <IconButton label="Fechar (Esc)" onClick={() => setHelp(false)}>
                <X />
              </IconButton>
            </div>
            <dl className="space-y-2.5">
              {ATALHOS.map((s) => (
                <div key={s.desc} className="flex items-center gap-3">
                  <dt className="flex w-24 shrink-0 gap-1">
                    {s.teclas.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex min-w-[1.75rem] justify-center rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-200"
                      >
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-sm text-neutral-300">{s.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {ending && (
        <EndOfLessonCountdown
          seconds={getPref('player.countdownSeconds', 20)}
          hasNext={!!lesson.nextLessonId}
          onElapsed={finishAndAdvance}
          onCancel={() => setEnding(false)}
          onSkipNow={finishAndAdvance}
        />
      )}
    </div>
  );
}
