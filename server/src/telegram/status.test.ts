import { describe, expect, it } from 'vitest';
import { falhaDoErro, statusDaFalhaTelegram } from './status';
import { FalhaTelegram } from './tipos';

// O GramJS lança RPCError com errorMessage no formato do Telegram; FloodWaitError traz `seconds`.
const rpc = (errorMessage: string, extra: object = {}) => Object.assign(new Error(errorMessage), { errorMessage, ...extra });

describe('falhaDoErro', () => {
  it.each([
    ['CHANNEL_PRIVATE', 'sem-acesso'],
    ['CHANNEL_INVALID', 'sem-acesso'],
    ['USERNAME_NOT_OCCUPIED', 'nao-encontrado'],
    ['USERNAME_INVALID', 'nao-encontrado'],
    ['INVITE_HASH_EXPIRED', 'convite-invalido'],
    ['INVITE_HASH_INVALID', 'convite-invalido'],
    ['INVITE_REQUEST_SENT', 'aguardando-aprovacao'],
    ['AUTH_KEY_UNREGISTERED', 'nao-autorizado'],
    ['SESSION_REVOKED', 'nao-autorizado'],
    ['USER_DEACTIVATED', 'nao-autorizado'],
    ['MSG_ID_INVALID', 'removido'],
  ])('%s → %s', (codigo, tipo) => {
    expect(falhaDoErro(rpc(codigo)).tipo).toBe(tipo);
  });

  it('FLOOD_WAIT guarda quantos segundos esperar', () => {
    const f = falhaDoErro(rpc('FLOOD_WAIT_X', { seconds: 420 }));
    expect(f.tipo).toBe('flood');
    expect(f.esperaSeg).toBe(420);
  });

  it('erro de rede vira sem-conexao; FalhaTelegram passa direto; o resto é telegram', () => {
    expect(falhaDoErro(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).tipo).toBe('sem-conexao');
    expect(falhaDoErro(new Error('Not connected')).tipo).toBe('sem-conexao');
    const f = new FalhaTelegram('sem-videos');
    expect(falhaDoErro(f)).toBe(f);
    expect(falhaDoErro(new Error('algo estranho')).tipo).toBe('telegram');
  });
});

describe('statusDaFalhaTelegram', () => {
  it('mapeia para HTTP; o não mapeado é 502', () => {
    expect(statusDaFalhaTelegram('nao-autorizado')).toBe(401);
    expect(statusDaFalhaTelegram('sem-acesso')).toBe(403);
    expect(statusDaFalhaTelegram('flood')).toBe(429);
    expect(statusDaFalhaTelegram('removido')).toBe(404);
    expect(statusDaFalhaTelegram('telegram')).toBe(502);
  });
});
