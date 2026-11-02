import { useEffect, useRef, useState } from 'react';

// A capa que ainda não existe é gerada numa fila do servidor (fila-capas.ts): a
// rota responde 404 na hora e a capa fica pronta segundos depois. Sem tentar de
// novo, a aula ficava sem capa até a pessoa recarregar a página.
const ESPERAS = [5_000, 15_000, 45_000];

export function CapaAula({
  src,
  className,
  alt = '',
  loading,
  ocultar = 'visibility',
}: {
  src: string;
  className?: string;
  alt?: string;
  loading?: 'lazy' | 'eager';
  /** Como esconder enquanto não há capa: `display` deixa aparecer o que está atrás (o ícone do curso). */
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
  const estilo = falhou ? (ocultar === 'display' ? { display: 'none' } : { visibility: 'hidden' as const }) : undefined;

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading={loading}
      style={estilo}
      onLoad={() => setFalhou(false)}
      onError={() => {
        setFalhou(true);
        if (tentativa >= ESPERAS.length || timer.current) return;
        timer.current = setTimeout(() => {
          timer.current = null;
          setTentativa((n) => n + 1);
        }, ESPERAS[tentativa]);
      }}
    />
  );
}
