import { describe, it, expect } from 'vitest';
import { baralhoDe, deHtml, formatarMinuto, paraHtml } from './texto';

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

  it('baralho: Astroflix::<categoria>[::Cursos|PDFs::<título>], e :: num nome não cria subbaralho', () => {
    expect(baralhoDe({ categoria: 'Pós', curso: '  Pós::IA   Aplicada ' })).toBe('Astroflix::Pós::Cursos::Pós:IA Aplicada');
    expect(baralhoDe({ categoria: 'Pós', pdf: 'Cálculo I' })).toBe('Astroflix::Pós::PDFs::Cálculo I');
    expect(baralhoDe({ categoria: 'Pós' })).toBe('Astroflix::Pós');
    expect(baralhoDe({ categoria: null, curso: 'Redes' })).toBe('Astroflix::Sem categoria::Cursos::Redes');
    expect(baralhoDe({ categoria: null, geral: true })).toBe('Astroflix');
  });

  it('minuto em m:ss ou h:mm:ss', () => {
    expect(formatarMinuto(75.9)).toBe('1:15');
    expect(formatarMinuto(3725)).toBe('1:02:05');
  });
});
