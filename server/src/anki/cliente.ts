import type { Fetch } from '../drive/tipos';

// Conversa com o Anki desktop pelo add-on AnkiConnect (https://foosoft.net/projects/anki-connect).
// O AnkiWeb não tem API pública: o jeito suportado de pôr cards na conta da pessoa
// é pelo Anki aberto na máquina, que depois sincroniza com o AnkiWeb.
//
// Quem chama é o servidor, nunca a interface: a página não alcança outra porta
// local, e requisição sem `Origin` (a do Node) passa pelo CORS do AnkiConnect.

export const URL_ANKI = 'http://127.0.0.1:8765';
export const MODELO = 'Learnflix';
export const CAMPOS = ['Frente', 'Verso', 'Origem'] as const;

export type TipoFalhaAnki = 'fechado' | 'erro';

export class FalhaAnki extends Error {
  constructor(
    readonly tipo: TipoFalhaAnki,
    mensagem?: string,
  ) {
    super(mensagem ?? tipo);
  }
}

export interface NotaAnki {
  id: number;
  campos: Record<string, string>;
}

export interface ClienteAnki {
  versao(): Promise<number>;
  /** Cria o tipo de nota "Learnflix" se ainda não existe. */
  garantirModelo(): Promise<void>;
  garantirBaralho(nome: string): Promise<void>;
  adicionar(baralho: string, campos: Record<string, string>): Promise<number>;
  atualizar(id: number, campos: Record<string, string>): Promise<void>;
  apagar(ids: number[]): Promise<void>;
  /** Notas que ainda existem; as apagadas no Anki ficam de fora. */
  ler(ids: number[]): Promise<NotaAnki[]>;
  /** Pede ao Anki para sincronizar com o AnkiWeb. */
  sincronizar(): Promise<void>;
  /** Move os cards destas notas para o baralho (criado se não existe). O histórico de revisão vai junto. */
  mover(notas: number[], baralho: string): Promise<void>;
  baralhos(): Promise<string[]>;
  /** Quantos cards há no baralho, subbaralhos inclusive. */
  contarCards(baralho: string): Promise<number>;
  /** Só para baralhos já vazios: o AnkiConnect exige cardsToo e apagaria o que houvesse dentro. */
  apagarBaralhosVazios(nomes: string[]): Promise<void>;
}

// Na busca do Anki, `_` e `*` são curingas e `"` fecha o termo.
const termoDeBaralho = (nome: string) => `"deck:${nome.replace(/[\\"*_]/g, (c) => `\\${c}`)}"`;

// Local e rápido: se não respondeu nisso, o Anki está travado num diálogo.
const TIMEOUT_MS = 5000;

const CSS = `.card { font-family: system-ui, sans-serif; font-size: 20px; text-align: center; color: #111; background: #fff; }
.origem { margin-top: 1.5em; font-size: 12px; color: #888; }
.nightMode .card { color: #eee; background: #1e1e1e; }`;

export function criarClienteAnki(fetchFn: Fetch = fetch, url = URL_ANKI): ClienteAnki {
  async function chamar<T>(action: string, params?: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: 6, params: params ?? {} }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Conexão recusada = Anki fechado ou sem o add-on (os dois são iguais daqui).
      throw new FalhaAnki('fechado');
    }
    if (!res.ok) throw new FalhaAnki('erro', `HTTP ${res.status}`);
    let corpo: { result?: T; error?: string | null };
    try {
      corpo = (await res.json()) as typeof corpo;
    } catch {
      throw new FalhaAnki('erro', 'resposta inválida');
    }
    if (corpo.error) throw new FalhaAnki('erro', corpo.error);
    return corpo.result as T;
  }

  return {
    versao: () => chamar<number>('version'),
    async garantirModelo() {
      const modelos = await chamar<string[]>('modelNames');
      if (modelos.includes(MODELO)) return;
      // Tipo de nota próprio: o "Básico" muda de nome com o idioma do Anki
      // ("Basic", "Básico"), e os campos dele também.
      await chamar('createModel', {
        modelName: MODELO,
        inOrderFields: [...CAMPOS],
        css: CSS,
        cardTemplates: [
          {
            Name: 'Card 1',
            Front: '{{Frente}}',
            Back: '{{FrontSide}}<hr id="answer">{{Verso}}<div class="origem">{{Origem}}</div>',
          },
        ],
      });
    },
    async garantirBaralho(nome) {
      await chamar('createDeck', { deck: nome });
    },
    adicionar: (baralho, campos) =>
      chamar<number>('addNote', {
        note: {
          deckName: baralho,
          modelName: MODELO,
          fields: campos,
          tags: ['learnflix'],
          // Sem isso, um card com a frente repetida seria recusado e ficaria
          // pendente para sempre.
          options: { allowDuplicate: true },
        },
      }),
    async atualizar(id, campos) {
      await chamar('updateNoteFields', { note: { id, fields: campos } });
    },
    async apagar(ids) {
      if (ids.length) await chamar('deleteNotes', { notes: ids });
    },
    async ler(ids) {
      if (!ids.length) return [];
      const notas = await chamar<Array<{ noteId?: number; fields?: Record<string, { value: string }> }>>('notesInfo', { notes: ids });
      // Nota que não existe mais volta como objeto vazio.
      return notas
        .filter((n) => typeof n?.noteId === 'number' && n.fields)
        .map((n) => ({
          id: n.noteId!,
          campos: Object.fromEntries(Object.entries(n.fields!).map(([k, v]) => [k, v.value])),
        }));
    },
    async sincronizar() {
      // Sincronizar com o AnkiWeb pode levar uns segundos.
      await chamar('sync', undefined, 60_000);
    },
    async mover(notas, baralho) {
      if (!notas.length) return;
      const info = await chamar<Array<{ cards?: number[] }>>('notesInfo', { notes: notas });
      const cards = info.flatMap((n) => n?.cards ?? []);
      if (cards.length) await chamar('changeDeck', { cards, deck: baralho });
    },
    baralhos: () => chamar<string[]>('deckNames'),
    async contarCards(baralho) {
      return (await chamar<number[]>('findCards', { query: termoDeBaralho(baralho) })).length;
    },
    async apagarBaralhosVazios(nomes) {
      const vazios: string[] = [];
      for (const n of nomes) if ((await this.contarCards(n)) === 0) vazios.push(n);
      if (vazios.length) await chamar('deleteDecks', { decks: vazios, cardsToo: true });
    },
  };
}
