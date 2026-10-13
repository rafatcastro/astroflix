import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { api, tocaHevc } from './api/client';

// O download do Drive converte em segundo plano, sem um <video> para perguntar o
// que toca: a interface conta ao servidor assim que abre.
void api.salvarCapacidades({ hevc: tocaHevc }).catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000 } },
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
