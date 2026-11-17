// Cor de uma variável CSS com o canal alfa do Tailwind (bg-neutral-900/95 continua valendo).
const v = (nome) => `rgb(var(--${nome}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Fonte deliberada do redesign "cinema pessoal" (2026-07-04): uma família só,
      // self-hosted (@fontsource-variable/inter), fallback na stack do sistema.
      // Hierarquia continua por peso/tamanho — a família muda, a regra não.
      fontFamily: {
        sans: [
          '"Inter Variable"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      // Tokens semânticos do docs/design.md. As cores vêm de variáveis CSS
      // (index.css) para o tema claro poder trocá-las sem tocar em cada classe:
      // no claro a escala neutra se inverte (o 950 do palco vira o fundo claro, o
      // 50 do título vira quase preto) e os tons de texto colorido escurecem para
      // manter o contraste no fundo branco.
      colors: {
        'studio-black': v('n-950'), // palco/app
        graphite: v('n-900'), // superfícies elevadas
        charcoal: v('n-800'), // controles/trilha/bordas
        slate: v('n-700'), // estado ativo/selecionado
        'focus-blue': '#2563eb', // blue-600 — ação + ring de foco
        'progress-blue': '#3b82f6', // blue-500 — preenchimento de progresso
        'signal-blue': v('blue-400'), // eyebrow/label
        'done-green': v('green-400'), // conclusão
        neutral: Object.fromEntries(
          ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((n) => [n, v(`n-${n}`)]),
        ),
        blue: { 100: v('blue-100'), 200: v('blue-200'), 300: v('blue-300'), 400: v('blue-400') },
        red: { 300: v('red-300'), 400: v('red-400') },
        green: { 300: v('green-300'), 400: v('green-400') },
        amber: { 100: v('amber-100'), 200: v('amber-200'), 300: v('amber-300'), 700: v('amber-700'), 900: v('amber-900') },
      },
      height: { screen: '100dvh' }, // player usa h-screen; dvh evita a barra de URL do iOS
      minHeight: { screen: '100dvh' },
    },
  },
  plugins: [],
};
