// A aula que a pessoa baixou ("Baixar") e toca sem internet. A que só está no
// cache automático não ganha marca: o app pode apagá-la sozinho.
export function IconeOffline({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      role="img"
      aria-label="Disponível offline"
      className={`shrink-0 text-neutral-400 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>Disponível offline</title>
      <path d="M8 2.5v7M5 7l3 3 3-3M3 13h10" />
    </svg>
  );
}
