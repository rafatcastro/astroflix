import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, type EstadoLoginTelegram } from '../api/client';
import { mensagemErroTelegram } from '../api/telegramTextos';
import TextField from './TextField';

const INTERVALO_MS = 1500;

// Login por QR code: o Telegram do celular escaneia e autoriza esta sessão. É a
// conta da própria pessoa — por isso o passo a passo fica escrito, e a senha de
// duas etapas (quando ela tem) é pedida aqui mesmo.
export default function TelegramLogin({ onConectado }: { onConectado: (usuario: string | null) => void }) {
  const [estado, setEstado] = useState<EstadoLoginTelegram | null>(null);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const concluido = useRef(false);
  const aoConectar = useRef(onConectado);
  aoConectar.current = onConectado;

  useEffect(() => {
    let vivo = true;
    let timer = 0;
    setEstado(null);
    setErroInicio(null);
    const aplicar = (e: EstadoLoginTelegram) => {
      if (!vivo) return;
      setEstado(e);
      if (e.fase === 'conectado' && !concluido.current) {
        concluido.current = true;
        aoConectar.current(e.usuario);
      }
    };
    const consultar = async () => {
      try {
        aplicar(await api.telegramEstadoLogin());
      } catch {
        // rede local piscou: a próxima consulta resolve
      }
      if (vivo && !concluido.current) timer = window.setTimeout(() => void consultar(), INTERVALO_MS);
    };
    void (async () => {
      try {
        aplicar(await api.telegramIniciarLogin());
        if (vivo && !concluido.current) timer = window.setTimeout(() => void consultar(), INTERVALO_MS);
      } catch (e) {
        if (vivo) setErroInicio(e instanceof Error ? e.message : 'telegram');
      }
    })();
    return () => {
      vivo = false;
      window.clearTimeout(timer);
      // Fechou sem concluir: o servidor larga a conexão de login.
      if (!concluido.current) void api.telegramCancelarLogin().catch(() => {});
    };
  }, [tentativa]);

  const url = estado?.fase === 'qr' ? estado.url : null;
  useEffect(() => {
    if (!url) return setQr(null);
    let vivo = true;
    // Fundo branco e margem: leitor de QR em celular falha com QR claro sobre escuro.
    void QRCode.toDataURL(url, { margin: 2, width: 232, color: { dark: '#000000', light: '#ffffff' } }).then((d) => {
      if (vivo) setQr(d);
    });
    return () => {
      vivo = false;
    };
  }, [url]);

  const enviarSenha = async () => {
    if (!senha || enviando) return;
    setEnviando(true);
    try {
      const e = await api.telegramSenha(senha);
      setEstado(e);
      if (e.fase === 'conectado' && !concluido.current) {
        concluido.current = true;
        onConectado(e.usuario);
      }
      if (e.fase === 'senha' && e.erro) setSenha('');
    } catch {
      // a consulta periódica mostra o estado real
    }
    setEnviando(false);
  };

  const erro = erroInicio ?? (estado?.fase === 'erro' ? estado.erro : null);
  if (erro) {
    return (
      <div>
        <p role="alert" className="text-sm text-amber-200">{mensagemErroTelegram(erro)}</p>
        <button
          type="button"
          onClick={() => setTentativa((n) => n + 1)}
          className="mt-3 min-h-[44px] rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (estado?.fase === 'senha') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviarSenha();
        }}
      >
        <label htmlFor="tg-senha" className="mb-1 block text-sm text-neutral-300">
          Sua conta tem verificação em duas etapas. Digite a senha do Telegram
          {estado.dica ? ` (dica: ${estado.dica})` : ''}.
        </label>
        <TextField
          id="tg-senha"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={enviando}
          aria-invalid={estado.erro ? true : undefined}
          aria-describedby={estado.erro ? 'tg-senha-erro' : undefined}
        />
        {estado.erro && (
          <p id="tg-senha-erro" role="alert" className="mt-2 text-sm text-amber-200">Senha incorreta. Tente de novo.</p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={enviando || !senha}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40"
          >
            {enviando ? 'Conferindo…' : 'Entrar'}
          </button>
        </div>
      </form>
    );
  }

  if (estado?.fase === 'conectado') {
    return <p role="status" className="text-sm text-neutral-300">Conectado{estado.usuario ? ` como ${estado.usuario}` : ''}.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="grid h-[232px] w-[232px] shrink-0 place-items-center rounded-lg bg-white">
        {qr ? (
          <img src={qr} width={232} height={232} alt="QR code para entrar no Telegram" />
        ) : (
          <span className="text-sm text-neutral-500">Gerando o código…</span>
        )}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-300">
        <li>Abra o Telegram no celular.</li>
        <li>
          Vá em <strong className="text-neutral-100">Configurações → Dispositivos</strong>.
        </li>
        <li>
          Toque em <strong className="text-neutral-100">Conectar dispositivo</strong> e aponte para o código.
        </li>
      </ol>
    </div>
  );
}
