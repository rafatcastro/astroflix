import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// O CRXJS lê o manifest com os caminhos do código-fonte (src/…) e escreve em dist/
// o manifest com os arquivos gerados. O dist/ é o que vai embutido no app
// (EXTENSAO, por scripts/gerar-bundled.mjs) e gravado em DATA_DIR/extensao.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sem minificar: o executeScript manda o texto de cada `func` para a página,
    // e um erro no console da aba fica legível. O tamanho não importa aqui.
    minify: false,
  },
});
