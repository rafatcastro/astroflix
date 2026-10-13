/**
 * Selo de recurso ainda em teste (hoje, o Telegram): avisa antes de a pessoa
 * confiar o progresso a algo que ainda não foi validado com contas reais.
 */
export default function EmDesenvolvimento() {
  return (
    <span className="ml-2 inline-block rounded bg-neutral-800 px-1.5 py-0.5 align-middle text-[11px] font-medium leading-none text-amber-200">
      Em desenvolvimento
    </span>
  );
}
