import type { Fetch } from '../drive/tipos';

// AnkiConnect de mentira para os testes: guarda notas, baralhos e tipos de nota
// em memória e responde no mesmo formato ({result, error}) do add-on.
export function ankiFalso() {
  const estado = {
    aberto: true,
    modelos: new Set<string>(['Basic']),
    baralhos: new Set<string>(['Default']),
    notas: new Map<number, { baralho: string; campos: Record<string, string>; tags: string[] }>(),
    chamadas: [] as string[],
    sincronizou: 0,
    recusar: null as string | null,
  };
  let proximo = 1000;

  const responder = (action: string, p: any): unknown => {
    if (estado.recusar === action) throw new Error('recusado pelo Anki');
    switch (action) {
      case 'version':
        return 6;
      case 'modelNames':
        return [...estado.modelos];
      case 'createModel':
        estado.modelos.add(p.modelName);
        return {};
      case 'createDeck':
        estado.baralhos.add(p.deck);
        return 1;
      case 'addNote': {
        if (!estado.modelos.has(p.note.modelName)) throw new Error('model was not found');
        if (!estado.baralhos.has(p.note.deckName)) throw new Error('deck was not found');
        const id = proximo++;
        estado.notas.set(id, { baralho: p.note.deckName, campos: { ...p.note.fields }, tags: p.note.tags });
        return id;
      }
      case 'updateNoteFields': {
        const n = estado.notas.get(p.note.id);
        if (!n) throw new Error('note was not found');
        Object.assign(n.campos, p.note.fields);
        return null;
      }
      case 'deleteNotes':
        for (const id of p.notes) estado.notas.delete(id);
        return null;
      case 'notesInfo':
        return p.notes.map((id: number) => {
          const n = estado.notas.get(id);
          if (!n) return {};
          // Um card por nota, com id derivado do da nota.
          return {
            noteId: id,
            cards: [id * 10],
            fields: Object.fromEntries(Object.entries(n.campos).map(([k, v], order) => [k, { value: v, order }])),
          };
        });
      case 'changeDeck':
        estado.baralhos.add(p.deck);
        for (const card of p.cards) {
          const n = estado.notas.get(card / 10);
          if (n) n.baralho = p.deck;
        }
        return null;
      case 'deckNames':
        return [...estado.baralhos];
      case 'findCards': {
        const deck = /^"deck:(.*)"$/.exec(p.query)![1].replace(/\\(.)/g, '$1');
        return [...estado.notas.entries()].filter(([, n]) => n.baralho === deck || n.baralho.startsWith(`${deck}::`)).map(([id]) => id * 10);
      }
      case 'deleteDecks':
        if (!p.cardsToo) throw new Error('cardsToo must be true');
        for (const d of p.decks) for (const b of [...estado.baralhos]) if (b === d || b.startsWith(`${d}::`)) estado.baralhos.delete(b);
        return null;
      case 'sync':
        estado.sincronizou++;
        return null;
    }
    throw new Error(`ação desconhecida: ${action}`);
  };

  const fetch: Fetch = (async (_url: string, init: RequestInit) => {
    if (!estado.aberto) throw new TypeError('fetch failed');
    const { action, params } = JSON.parse(String(init.body));
    estado.chamadas.push(action);
    try {
      return Response.json({ result: responder(action, params), error: null });
    } catch (e) {
      return Response.json({ result: null, error: (e as Error).message });
    }
  }) as unknown as Fetch;

  return { estado, fetch };
}
