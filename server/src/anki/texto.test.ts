import { describe, it, expect } from 'vitest';
import { baralhoDoCurso, deHtml, formatarMinuto, paraHtml } from './texto';

describe('texto dos cards', () => {
  it('vai para HTML escapado com <br> e volta igual', () => {
    const t = 'a < b && "c"\nsegunda linha';
    expect(paraHtml(t)).toBe('a &lt; b &amp;&amp; &quot;c&quot;<br>segunda linha');
    expect(deHtml(paraHtml(t))).toBe(t);
  });

  // O que a pessoa digitou no editor do Anki chega com divs e formatação.
  it('lê o HTML do editor do Anki como texto', () => {
    expect(deHtml('<b>Big</b> O<div>de n&nbsp;log n</div>')).toBe('Big O\nde n log n');
    expect(deHtml('caf&#233; &#x2192; ok')).toBe('café → ok');
  });

  it('baralho do curso fica sob Learnflix::Cursos e :: no título não cria subbaralho', () => {
    expect(baralhoDoCurso(null)).toBe('Learnflix::Cursos');
    expect(baralhoDoCurso('  Pós::IA   Aplicada ')).toBe('Learnflix::Cursos::Pós:IA Aplicada');
  });

  it('minuto em m:ss ou h:mm:ss', () => {
    expect(formatarMinuto(75.9)).toBe('1:15');
    expect(formatarMinuto(3725)).toBe('1:02:05');
  });
});
