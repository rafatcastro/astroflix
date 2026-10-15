import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { api, tocaHevc } from './api/client';

// O download do Drive converte em segundo plano, sem um <video> para perguntar o
// que toca: a interface conta ao servidor assim que abre.
void api.salvarCapacidades({ hevc: tocaHevc }).catch(() => {});

// É um app, não uma página: o menu do botão direito da webview ("Open Link in New
// Window", "Download Linked File") não faz sentido aqui. Quem tem menu próprio
// (cartão de categoria) trata o evento antes; em campo de texto e com texto
// selecionado, o do sistema fica, para copiar e colar.
document.addEventListener('contextmenu', (e) => {
  const alvo = e.target as HTMLElement | null;
  if (alvo?.closest('input, textarea, [contenteditable="true"]')) return;
  if (window.getSelection()?.toString()) return;
  e.preventDefault();
});

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000 } },
  // A sessão caiu (expirou ou saiu noutro lugar): o servidor responde 401
  // precisa-entrar em tudo. Reler a conta faz o portão mostrar a tela de entrada.
  queryCache: new QueryCache({
    onError: (e) => {
      if (e.message === 'precisa-entrar') void queryClient.invalidateQueries({ queryKey: ['conta'] });
    },
  }),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
