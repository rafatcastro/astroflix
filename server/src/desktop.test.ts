import { describe, it, expect } from 'vitest';
import { linhaDaUrl, pathComExtras } from './desktop';

describe('linhaDaUrl', () => {
  it('é uma linha de máquina com a URL real', () => {
    expect(linhaDaUrl('http://localhost:7778')).toBe('LEARNFLIX_URL=http://localhost:7778');
  });
});

describe('pathComExtras', () => {
  const todos = () => true;

  it('macOS: acrescenta Homebrew e /usr/local/bin que existem, sem duplicar', () => {
    const existe = (d: string) => d !== '/usr/local/bin';
    expect(pathComExtras('/usr/bin:/bin', 'darwin', existe, {})).toBe('/usr/bin:/bin:/opt/homebrew/bin');
    expect(pathComExtras('/opt/homebrew/bin:/usr/bin', 'darwin', todos, {})).toBe(
      '/opt/homebrew/bin:/usr/bin:/usr/local/bin',
    );
  });

  it('Linux: /usr/local/bin e /usr/bin', () => {
    expect(pathComExtras('/bin', 'linux', todos, {})).toBe('/bin:/usr/local/bin:/usr/bin');
  });

  it('Windows: ffmpeg do Program Files e os links do WinGet, com ;', () => {
    const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
    expect(pathComExtras('C:\\Windows', 'win32', todos, env)).toBe(
      'C:\\Windows;C:\\Program Files\\ffmpeg\\bin;C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links',
    );
  });

  it('PATH vazio não começa com separador', () => {
    expect(pathComExtras('', 'linux', (d) => d === '/usr/bin', {})).toBe('/usr/bin');
  });
});
