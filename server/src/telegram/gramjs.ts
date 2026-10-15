import bigInt from 'big-integer';
import type { Api as TiposApi, TelegramClient } from 'telegram';
import type { Db } from '../db/index';
import { APP_VERSION } from '../bundled';
import { BLOCO } from './blocos';
import type { ClienteTelegram, Convite, GrupoTelegram } from './cliente';
import { credenciaisTelegram } from './credenciais';
import type { EstadoLogin, ServicosTelegram } from './servicos';
import { falhaDoErro } from './status';
import { FalhaTelegram, type CredenciaisTelegram, type MensagemTelegram, type MidiaTelegram, type PeerTelegram } from './tipos';

// A implementação real, sobre o GramJS (MTProto, a conta da própria pessoa).
// Tudo o que é do GramJS fica neste arquivo: o resto do app só conhece
// ClienteTelegram e ServicosTelegram, e os testes injetam versões falsas.

// Import sob demanda: quem nunca usa Telegram não carrega a biblioteca nem
// abre socket nenhum (ela tem ~1,5 MB e loga ao ser instanciada).
type Modulos = {
  tg: typeof import('telegram');
  sessoes: typeof import('telegram/sessions');
  log: typeof import('telegram/extensions/Logger');
};
let modulos: Promise<Modulos> | null = null;
const carregar = (): Promise<Modulos> =>
  (modulos ??= Promise.all([import('telegram'), import('telegram/sessions'), import('telegram/extensions/Logger')]).then(
    ([tg, sessoes, log]) => ({ tg, sessoes, log }),
  ));

const K_SESSAO = 'telegram.sessao';
const K_USUARIO = 'telegram.usuario';
// O file_reference de um documento expira; guardar a mensagem por pouco tempo
// poupa uma ida ao Telegram a cada seek sem arriscar uma referência vencida.
const VALIDADE_DOCUMENTO_MS = 10 * 60_000;
const ESPERA_PRIMEIRO_QR_MS = 20_000;

async function novoCliente(sessao: string, c: CredenciaisTelegram): Promise<TelegramClient> {
  const { tg, sessoes, log } = await carregar();
  const client = new tg.TelegramClient(new sessoes.StringSession(sessao), c.apiId!, c.apiHash!, {
    connectionRetries: 3,
    baseLogger: new log.Logger(log.LogLevel.NONE),
    // É o que aparece em Telegram → Dispositivos: a pessoa precisa reconhecer
    // a sessão como o Astroflix para saber o que está encerrando.
    deviceModel: 'Astroflix',
    appVersion: APP_VERSION,
    systemVersion: process.platform,
    langCode: 'pt',
  });
  try {
    await client.connect();
  } catch (e) {
    throw falhaDoErro(e);
  }
  return client;
}

function encerrar(client: TelegramClient | null | undefined): void {
  // destroy, e não só disconnect: o laço de updates do GramJS seguiria vivo.
  if (client) void client.destroy().catch(() => {});
}

function peerDe(Api: typeof TiposApi, e: unknown): GrupoTelegram {
  if (e instanceof Api.Channel) {
    return { peer: { tipo: 'canal', id: e.id.toString(), accessHash: e.accessHash?.toString() ?? null }, titulo: e.title };
  }
  if (e instanceof Api.Chat) return { peer: { tipo: 'chat', id: e.id.toString(), accessHash: null }, titulo: e.title };
  // Um usuário ou bot não é grupo de curso.
  throw new FalhaTelegram('link-invalido');
}

function inputPeer(Api: typeof TiposApi, p: PeerTelegram): TiposApi.TypeInputPeer {
  if (p.tipo === 'chat') return new Api.InputPeerChat({ chatId: bigInt(p.id) });
  return new Api.InputPeerChannel({ channelId: bigInt(p.id), accessHash: bigInt(p.accessHash ?? '0') });
}

function midiaDe(Api: typeof TiposApi, m: TiposApi.Message): MidiaTelegram | null {
  const media = m.media;
  if (!media) return null;
  if (!(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)) {
    return { tipo: 'outro', nome: null, tamanho: 0, mime: '', duracaoSec: null, temMiniatura: false };
  }
  const d = media.document;
  let nome: string | null = null;
  let duracao: number | null = null;
  let video = false;
  let outro = false;
  for (const a of d.attributes) {
    if (a instanceof Api.DocumentAttributeFilename) nome = a.fileName;
    else if (a instanceof Api.DocumentAttributeVideo) {
      duracao = a.duration;
      // Vídeo redondo é recado, não aula.
      if (a.roundMessage) outro = true;
      else video = true;
    } else if (a instanceof Api.DocumentAttributeSticker || a instanceof Api.DocumentAttributeAnimated) outro = true;
    else if (a instanceof Api.DocumentAttributeAudio && a.voice) outro = true;
  }
  return {
    tipo: outro ? 'outro' : video ? 'video' : 'documento',
    nome,
    tamanho: Number(d.size.toString()),
    mime: d.mimeType ?? '',
    duracaoSec: duracao,
    temMiniatura: (d.thumbs?.length ?? 0) > 0,
  };
}

function envolver(client: TelegramClient, m: Modulos, aoPerderSessao: () => void): ClienteTelegram {
  const { Api } = m.tg;
  const documentos = new Map<string, { msg: TiposApi.Message; doc: TiposApi.Document; ate: number }>();

  // Toda saída para o Telegram passa por aqui: o erro vira FalhaTelegram, e a
  // sessão revogada em outro aparelho é esquecida, para o status não mentir.
  async function chamar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const f = falhaDoErro(e);
      if (f.tipo === 'nao-autorizado') aoPerderSessao();
      throw f;
    }
  }

  async function documento(peer: PeerTelegram, msgId: number, renovar = false) {
    const chave = `${peer.id}:${msgId}`;
    const guardado = documentos.get(chave);
    if (!renovar && guardado && guardado.ate > Date.now()) return guardado;
    const [msg] = await chamar(() => client.getMessages(inputPeer(Api, peer), { ids: [msgId] }));
    const media = msg?.media;
    if (!msg || !(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)) {
      documentos.delete(chave);
      throw new FalhaTelegram('removido');
    }
    const novo = { msg, doc: media.document, ate: Date.now() + VALIDADE_DOCUMENTO_MS };
    documentos.set(chave, novo);
    return novo;
  }

  async function entidade(alvo: string | TiposApi.TypePeer): Promise<unknown> {
    try {
      return await client.getEntity(alvo);
    } catch (e) {
      // Canal privado (t.me/c/…) só é achado pelo id se estiver no cache de
      // entidades, que a sessão não guarda: carregar os diálogos o preenche.
      if (typeof alvo === 'string') throw e;
      await client.getDialogs({ limit: 500 });
      return await client.getEntity(alvo);
    }
  }

  return {
    resolver: (link) =>
      chamar(async () => {
        const e =
          link.tipo === 'publico'
            ? await entidade(link.usuario)
            : await entidade(new Api.PeerChannel({ channelId: bigInt(link.canalId) })).catch((err) => {
                // Não achar o canal é "não está no grupo"; sessão caída, rede e flood
                // seguem com o próprio nome, para a interface oferecer a saída certa.
                const f = falhaDoErro(err);
                throw f.tipo === 'telegram' || f.tipo === 'sem-acesso' ? new FalhaTelegram('sem-acesso') : f;
              });
        return peerDe(Api, e);
      }),

    verConvite: (hash) =>
      chamar(async (): Promise<Convite> => {
        const r = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (r instanceof Api.ChatInviteAlready) return { tipo: 'ja-membro', grupo: peerDe(Api, r.chat) };
        if (r instanceof Api.ChatInvitePeek) return { tipo: 'convite', titulo: (r.chat as { title?: string }).title ?? '' };
        return { tipo: 'convite', titulo: r.title };
      }),

    entrarPorConvite: (hash) =>
      chamar(async () => {
        const u = (await client.invoke(new Api.messages.ImportChatInvite({ hash }))) as { chats?: unknown[] };
        const chat = u.chats?.find((c) => c instanceof Api.Channel || c instanceof Api.Chat);
        if (!chat) throw new FalhaTelegram('telegram');
        return peerDe(Api, chat);
      }),

    mensagens: (peer) =>
      chamar(async () => {
        // Duas buscas filtradas (vídeos; arquivos) em vez do histórico inteiro:
        // num grupo com milhares de mensagens de conversa, ler tudo levaria minutos.
        const porId = new Map<number, MensagemTelegram>();
        for (const filter of [new Api.InputMessagesFilterVideo(), new Api.InputMessagesFilterDocument()]) {
          for await (const m of client.iterMessages(inputPeer(Api, peer), { limit: undefined, filter })) {
            if (!(m instanceof Api.Message) || porId.has(m.id)) continue;
            porId.set(m.id, { id: m.id, data: m.date, legenda: m.message ?? '', midia: midiaDe(Api, m) });
          }
        }
        return [...porId.values()];
      }),

    async *baixar(peer, msgId, offset, signal) {
      let renovar = false;
      // Bytes já entregues: a nova tentativa continua daqui, e não do offset
      // original — senão o player receberia blocos repetidos no meio do vídeo.
      // Como cada bloco tem BLOCO bytes (menos o último), a soma segue alinhada.
      let entregue = 0;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const { doc } = await documento(peer, msgId, renovar);
        const local = new Api.InputDocumentFileLocation({
          id: doc.id,
          accessHash: doc.accessHash,
          fileReference: doc.fileReference,
          thumbSize: '',
        });
        try {
          for await (const bloco of client.iterDownload({
            file: local,
            offset: bigInt(offset + entregue),
            requestSize: BLOCO,
            dcId: doc.dcId,
            fileSize: doc.size,
          })) {
            if (signal.aborted) return;
            entregue += bloco.length;
            yield bloco;
          }
          return;
        } catch (e) {
          if (signal.aborted) return;
          const f = falhaDoErro(e);
          // Referência vencida no meio da aula: busca a mensagem de novo, uma vez.
          if (f.tipo === 'removido' && tentativa === 0) {
            renovar = true;
            continue;
          }
          if (f.tipo === 'nao-autorizado') aoPerderSessao();
          throw f;
        }
      }
    },

    miniatura: (peer, msgId) =>
      chamar(async () => {
        const { msg, doc } = await documento(peer, msgId);
        // A maior miniatura de verdade, escolhida aqui: por índice, o GramJS descarta
        // os PhotoPathSize antes de indexar, e um índice fora da lista o faz baixar
        // o VÍDEO inteiro para a memória no lugar da capa.
        const tamanho = (s: TiposApi.TypePhotoSize): number =>
          s instanceof Api.PhotoSize ? s.size : s instanceof Api.PhotoSizeProgressive ? (s.sizes.at(-1) ?? 0) : -1;
        const melhor = (doc.thumbs ?? []).filter((s) => tamanho(s) > 0).sort((a, b) => tamanho(b) - tamanho(a))[0];
        if (!melhor) return null;
        const r = await client.downloadMedia(msg, { thumb: melhor });
        return Buffer.isBuffer(r) && r.length ? r : null;
      }),
  };
}

export function criarServicosTelegram(db: Db): ServicosTelegram {
  const ler = (k: string): string | null =>
    ((db.prepare('SELECT value FROM settings WHERE key=?').get(k) as { value: string } | undefined)?.value ?? null);
  const gravar = (k: string, v: string) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
  const apagar = (k: string) => db.prepare('DELETE FROM settings WHERE key=?').run(k);

  let atual: Promise<{ client: TelegramClient; cliente: ClienteTelegram }> | null = null;

  function esquecerSessao(): void {
    apagar(K_SESSAO);
    apagar(K_USUARIO);
    const a = atual;
    atual = null;
    void a?.then(({ client }) => encerrar(client)).catch(() => {});
  }

  function credenciais(): CredenciaisTelegram {
    const c = credenciaisTelegram(db);
    if (!c.apiId || !c.apiHash) throw new FalhaTelegram('sem-credenciais');
    return c;
  }

  // ---- login por QR ----
  let login: {
    client: TelegramClient | null;
    cancelado: boolean;
    responderSenha: ((s: string) => void) | null;
    erroSenha: 'senha-incorreta' | null;
    falha: string | null;
  } | null = null;
  let estado: EstadoLogin = { fase: 'parado' };
  let ouvintes: Array<() => void> = [];
  const mudar = (e: EstadoLogin) => {
    estado = e;
    const o = ouvintes;
    ouvintes = [];
    for (const f of o) f();
  };
  const proximaMudanca = (ms: number) =>
    new Promise<void>((res) => {
      const t = setTimeout(res, ms);
      ouvintes.push(() => {
        clearTimeout(t);
        res();
      });
    });

  function cancelarLogin(): void {
    if (!login) return;
    login.cancelado = true;
    encerrar(login.client);
    login = null;
    if (estado.fase !== 'conectado') mudar({ fase: 'parado' });
  }

  const servicos: ServicosTelegram = {
    status() {
      const c = credenciaisTelegram(db);
      return {
        conectado: ler(K_SESSAO) !== null,
        usuario: ler(K_USUARIO),
        credenciais: { apiId: Boolean(c.apiId), apiHash: Boolean(c.apiHash) },
      };
    },

    cliente() {
      const sessao = ler(K_SESSAO);
      if (!sessao) return Promise.reject(new FalhaTelegram('nao-autorizado'));
      let c: CredenciaisTelegram;
      try {
        c = credenciais();
      } catch (e) {
        return Promise.reject(e);
      }
      atual ??= (async () => {
        const m = await carregar();
        const client = await novoCliente(sessao, c);
        // Não usa checkAuthorization: ele devolve false para QUALQUER erro, e uma
        // rede piscando no primeiro uso apagaria a sessão (e o QR de novo). Só
        // "não autorizado" de verdade esquece a conta.
        try {
          await client.invoke(new m.tg.Api.updates.GetState());
        } catch (e) {
          encerrar(client);
          const f = falhaDoErro(e);
          if (f.tipo === 'nao-autorizado') {
            apagar(K_SESSAO);
            apagar(K_USUARIO);
          }
          throw f;
        }
        return { client, cliente: envolver(client, m, esquecerSessao) };
      })();
      const p = atual;
      // Falhou (rede, sessão): a próxima chamada tenta de novo do zero.
      p.catch(() => {
        if (atual === p) atual = null;
      });
      return p.then((a) => a.cliente);
    },

    login: {
      async iniciar() {
        cancelarLogin();
        // Reservado ANTES do primeiro await: um cancelar (ou um segundo iniciar)
        // que chegue enquanto a conexão abre precisa achar este login para matá-lo.
        // Sem isso, dois logins corriam em paralelo e o QR alternava entre eles.
        const este = {
          client: null as TelegramClient | null,
          cancelado: false,
          responderSenha: null as ((s: string) => void) | null,
          erroSenha: null as 'senha-incorreta' | null,
          falha: null as string | null,
        };
        login = este;
        mudar({ fase: 'parado' });
        let c: CredenciaisTelegram;
        let m: Modulos;
        let client: TelegramClient;
        try {
          c = credenciais();
          m = await carregar();
          client = await novoCliente('', c);
        } catch (e) {
          if (login === este) login = null;
          throw e;
        }
        if (este.cancelado) {
          encerrar(client);
          return estado;
        }
        este.client = client;

        client
          .signInUserWithQrCode(
            { apiId: c.apiId!, apiHash: c.apiHash! },
            {
              // Chamado de novo a cada token renovado (o QR do Telegram vence em ~30 s).
              qrCode: async ({ token, expires }) => {
                if (este.cancelado) return;
                mudar({ fase: 'qr', url: `tg://login?token=${token.toString('base64url')}`, expiraEm: expires * 1000 });
              },
              password: (dica) =>
                new Promise<string>((res) => {
                  este.responderSenha = res;
                  mudar({ fase: 'senha', dica: dica ?? null, erro: este.erroSenha });
                }),
              onError: async (err) => {
                if (este.cancelado) return true;
                // Senha errada: o GramJS pergunta de novo (password acima) se devolvermos false.
                if ((err as { errorMessage?: string }).errorMessage === 'PASSWORD_HASH_INVALID') {
                  este.erroSenha = 'senha-incorreta';
                  return false;
                }
                // Guardada: ao parar, o GramJS lança um AUTH_USER_CANCEL genérico, e o
                // motivo de verdade (um flood, por exemplo) se perderia no .catch.
                este.falha = falhaDoErro(err).tipo;
                mudar({ fase: 'erro', erro: este.falha });
                return true;
              },
            },
          )
          .then((user) => {
            if (este.cancelado) return;
            const u = user as { username?: string; firstName?: string; lastName?: string };
            const nome = u.username ? `@${u.username}` : [u.firstName, u.lastName].filter(Boolean).join(' ') || null;
            gravar(K_SESSAO, String(client.session.save()));
            if (nome) gravar(K_USUARIO, nome);
            else apagar(K_USUARIO);
            // O cliente do login já está autorizado: vira o cliente do app.
            const anterior = atual;
            atual = Promise.resolve({ client, cliente: envolver(client, m, esquecerSessao) });
            void anterior?.then((a) => encerrar(a.client)).catch(() => {});
            login = null;
            mudar({ fase: 'conectado', usuario: nome });
          })
          .catch((e) => {
            if (este.cancelado) return;
            encerrar(client);
            if (login === este) login = null;
            mudar({ fase: 'erro', erro: este.falha ?? falhaDoErro(e).tipo });
          });

        // Devolve já com o QR (ou o erro), para o modal não abrir vazio.
        const limite = Date.now() + ESPERA_PRIMEIRO_QR_MS;
        while (!este.cancelado && estado.fase === 'parado' && Date.now() < limite) await proximaMudanca(limite - Date.now());
        return estado;
      },

      estado: () => estado,

      async senha(senha) {
        const l = login;
        if (!l?.responderSenha) return estado;
        const responder = l.responderSenha;
        l.responderSenha = null;
        l.erroSenha = null;
        mudar({ fase: 'senha', dica: estado.fase === 'senha' ? estado.dica : null, erro: null });
        responder(senha);
        // Espera o veredito: conectado, erro ou a senha pedida de novo (errada).
        const limite = Date.now() + 30_000;
        while (Date.now() < limite && estado.fase === 'senha' && !l.responderSenha) await proximaMudanca(limite - Date.now());
        return estado;
      },

      cancelar: cancelarLogin,
    },

    async desconectar() {
      cancelarLogin();
      try {
        if (ler(K_SESSAO)) {
          // Abre a conexão se ainda não houver: sem o LogOut, a sessão seguiria
          // ativa no Telegram (em Dispositivos) depois de "Desconectar".
          await servicos.cliente();
          const { client } = await atual!;
          const { tg } = await carregar();
          await client.invoke(new tg.Api.auth.LogOut());
        }
      } catch {
        // Sem rede ou sessão já morta: apagar a local é o que importa.
      }
      esquecerSessao();
      mudar({ fase: 'parado' });
    },

    async aoTrocarCredenciais() {
      await servicos.desconectar();
    },
  };
  return servicos;
}
