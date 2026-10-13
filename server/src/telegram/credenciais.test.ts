import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../db/index';
import { credenciaisTelegram, salvarCredenciaisTelegram } from './credenciais';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-tg-'));
const db = openDb(path.join(tmp, 'app.db'));

describe('credenciaisTelegram', () => {
  it('Configurações → env → padrão, campo a campo; apiId sempre número', () => {
    const padrao = { apiId: 1, apiHash: 'padrao' };
    expect(credenciaisTelegram(db, {}, padrao)).toEqual(padrao);
    expect(credenciaisTelegram(db, { TELEGRAM_API_ID: '22' }, padrao)).toEqual({ apiId: 22, apiHash: 'padrao' });
    salvarCredenciaisTelegram(db, { apiHash: 'minha' });
    expect(credenciaisTelegram(db, { TELEGRAM_API_ID: '22' }, padrao)).toEqual({ apiId: 22, apiHash: 'minha' });
    salvarCredenciaisTelegram(db, { apiHash: '' });
    expect(credenciaisTelegram(db, {}, { apiId: null, apiHash: null })).toEqual({ apiId: null, apiHash: null });
  });

  it('apiId que não é número inteiro positivo é ignorado', () => {
    expect(credenciaisTelegram(db, { TELEGRAM_API_ID: 'abc' }, { apiId: null, apiHash: null }).apiId).toBeNull();
  });
});
