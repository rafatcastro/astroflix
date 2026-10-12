import { describe, it, expect } from 'vitest';
import { openDb } from '../db/index';
import { credenciaisGoogle, salvarCredenciais } from './credenciais';

const PADRAO = { clientId: 'P', clientSecret: 'P', apiKey: 'P' };
const VAZIO = { clientId: null, clientSecret: null, apiKey: null };

describe('credenciaisGoogle', () => {
  it('settings vence env, env vence padrão, campo a campo', () => {
    const db = openDb(':memory:');
    salvarCredenciais(db, { clientId: 'S' });
    const r = credenciaisGoogle(db, { GOOGLE_API_KEY: 'E', GOOGLE_CLIENT_ID: 'E' }, PADRAO);
    expect(r).toEqual({ clientId: 'S', clientSecret: 'P', apiKey: 'E' });
  });

  it('salvarCredenciais com string vazia remove o campo', () => {
    const db = openDb(':memory:');
    salvarCredenciais(db, { clientId: 'S', apiKey: 'K' });
    salvarCredenciais(db, { clientId: '' });
    expect(credenciaisGoogle(db, {}, VAZIO)).toEqual({ clientId: null, clientSecret: null, apiKey: 'K' });
  });

  it('sem nada configurado → tudo null', () => {
    const db = openDb(':memory:');
    expect(credenciaisGoogle(db, {}, VAZIO)).toEqual(VAZIO);
  });
});
