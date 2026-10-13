import { describe, expect, it } from 'vitest';
import { parseLinkTelegram } from './link';

describe('parseLinkTelegram', () => {
  it.each([
    ['link público', 'https://t.me/cursodeingles', 'cursodeingles'],
    ['link público de uma mensagem', 'https://t.me/cursodeingles/123', 'cursodeingles'],
    ['sem https', 't.me/cursodeingles', 'cursodeingles'],
    ['telegram.me', 'https://telegram.me/cursodeingles', 'cursodeingles'],
    ['@nome com espaços em volta', '  @cursodeingles ', 'cursodeingles'],
    ['link com parâmetros', 'https://t.me/cursodeingles?single', 'cursodeingles'],
  ])('reconhece %s', (_, texto, usuario) => {
    expect(parseLinkTelegram(texto)).toEqual({ tipo: 'publico', usuario });
  });

  it('link de grupo privado (t.me/c/<id>/<msg>) vira o id do canal', () => {
    expect(parseLinkTelegram('https://t.me/c/1234567890/45')).toEqual({ tipo: 'privado', canalId: '1234567890' });
  });

  it.each([
    ['t.me/+hash', 'https://t.me/+AbCdEf_123-x', 'AbCdEf_123-x'],
    ['t.me/joinchat/hash', 'https://t.me/joinchat/AbCdEf123', 'AbCdEf123'],
  ])('reconhece convite %s', (_, texto, hash) => {
    expect(parseLinkTelegram(texto)).toEqual({ tipo: 'convite', hash });
  });

  it.each([
    ['texto vazio', ''],
    ['outro host', 'https://exemplo.com/cursodeingles'],
    ['nome curto demais (o Telegram exige 4+)', 't.me/abc'],
    ['caminho reservado do Telegram', 'https://t.me/addstickers/pack'],
    ['link do Drive', 'https://drive.google.com/drive/folders/abc'],
  ])('recusa %s', (_, texto) => {
    expect(parseLinkTelegram(texto)).toBeNull();
  });
});
