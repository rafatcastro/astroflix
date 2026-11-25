import { useEffect, useRef, useState } from 'react';
import { Play } from './icons';

// A capa que ainda não existe é gerada numa fila do servidor (fila-capas.ts): a
// rota responde 404 na hora e a capa fica pronta segundos depois. Sem tentar de
// novo, a aula ficava sem capa até a pessoa recarregar a página. As primeiras
// tentativas são curtas (a capa local sai em 1 s, e esperar 5 s parecia travado);
// depois, a cada minuto enquanto a aula está na tela: a do Telegram, uma por vez,
// pode levar mais de um minuto, e desistir deixava o ícone para sempre.
const ESPERAS = [2_000, 5_000, 15_000, 45_000];
const ESPERA_DEPOIS = 60_000;

export function CapaAula({
  src,
  className = '',
  alt = '',
  loading,
  ocultar = 'visibility',
}: {
  src: string;
  /** O tamanho da caixa (no modo `display`, o da própria imagem). */
  className?: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
  /**
   * `visibility` (padrão): caixa de tamanho fixo com o ▶ de espera, a imagem por cima.
   * `display`: só a imagem, que some sem capa e deixa aparecer o que está atrás (o
   * fundo desfocado do curso, o placeholder do cartão).
   */
  ocultar?: 'visibility' | 'display';
}) {
  const [tentativa, setTentativa] = useState(0);
  const [falhou, setFalhou] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outra aula: começa do zero.
  useEffect(() => {
    setTentativa(0);
    setFalhou(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [src]);

  const url = tentativa ? `${src}${src.includes('?') ? '&' : '?'}t=${tentativa}` : src;

  const aoFalhar = () => {
    setFalhou(true);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setTentativa((n) => n + 1);
    }, ESPERAS[tentativa] ?? ESPERA_DEPOIS);
  };

  if (ocultar === 'display') {
    return (
      <img
        src={url}
        alt={alt}
        className={className}
        loading={loading}
        style={falhou ? { display: 'none' } : undefined}
        onLoad={() => setFalhou(false)}
        onError={aoFalhar}
      />
    );
  }

  // A caixa é quem tem o tamanho: com a <img> dando o tamanho, a imagem quebrada
  // (404 enquanto a fila gera) perdia o 16:9 no WebKit e a lista pulava quando a capa chegava.
  return (
    <span className={`relative block overflow-hidden bg-neutral-800 ${className}`}>
      <Play
        className="absolute left-1/2 top-1/2 h-1/3 w-1/3 -translate-x-1/2 -translate-y-1/2 text-neutral-600"
        aria-hidden
      />
      <img
        src={url}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        loading={loading}
        style={falhou ? { visibility: 'hidden' } : undefined}
        onLoad={() => setFalhou(false)}
        onError={aoFalhar}
      />
    </span>
  );
}
