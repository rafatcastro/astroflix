import { describe, it, expect } from 'vitest';
import { statusDaFalha } from './status';

describe('statusDaFalha', () => {
  it('mapeia os tipos conhecidos', () => {
    expect(statusDaFalha('sem-acesso')).toBe(403);
    expect(statusDaFalha('cota-esgotada')).toBe(429);
    expect(statusDaFalha('sem-conexao')).toBe(503);
    expect(statusDaFalha('nao-autorizado')).toBe(401);
    expect(statusDaFalha('nao-e-pasta')).toBe(400);
    expect(statusDaFalha('link-invalido')).toBe(400);
    expect(statusDaFalha('google')).toBe(502);
  });
});
