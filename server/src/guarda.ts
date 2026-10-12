import net from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';

// O servidor escuta só na máquina, mas o NAVEGADOR da pessoa visita a internet
// inteira — e qualquer página aberta nele consegue mandar requisições para
// http://localhost:7777. Duas portas ficam abertas sem esta guarda:
//
// - DNS rebinding: um domínio do atacante passa a resolver para 127.0.0.1. Para o
//   navegador, a página e a API viram a MESMA origem, e o atacante lê as respostas
//   (lista o disco, libera "/" como raiz, baixa arquivos). A defesa é o Host: o
//   navegador manda o nome que está na barra, e o do atacante nunca é "localhost"
//   nem um IP — rebinding precisa de um NOME para trocar o endereço por trás dele.
//
// - CSRF: um POST sem corpo ou com text/plain não dispara preflight de CORS, então
//   `fetch(..., { mode: 'no-cors' })` apagava a biblioteca sem a pessoa ver nada.
//   Todo navegador manda Origin em POST/PATCH/DELETE entre origens; basta recusar
//   as que não são desta máquina.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** "localhost:7777" → "localhost"; "[::1]:7777" → "::1". */
function nomeDoHost(host: string): string {
  const semPorta = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '');
  return semPorta.toLowerCase();
}

/**
 * Host aceitável: localhost ou um IP literal. IP literal cobre quem roda com
 * BIND=0.0.0.0 e acessa pelo IP da rede local, sem abrir brecha — rebinding
 * depende de um nome de domínio.
 */
export function hostConfiavel(host: string | undefined): boolean {
  if (!host) return false;
  const nome = nomeDoHost(host);
  return LOOPBACK.has(nome) || nome.endsWith('.localhost') || net.isIP(nome) !== 0;
}

/**
 * Origin aceitável numa requisição que muda estado: ausente (curl, testes, o
 * próprio servidor), a mesma origem da página, ou outra porta desta máquina (o
 * Vite em :5173 no desenvolvimento). "null" vem de iframe em sandbox e de
 * file:// — nunca da interface.
 */
export function origemConfiavel(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (host && url.host.toLowerCase() === host.toLowerCase()) return true;
  const nome = nomeDoHost(url.host);
  return LOOPBACK.has(nome) || nome.endsWith('.localhost') || nome.startsWith('127.');
}

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registrarGuarda(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    if (!hostConfiavel(req.headers.host)) return reply.code(403).send({ error: 'forbidden_host' });
    if (!SEGUROS.has(req.method) && !origemConfiavel(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
  });
}
