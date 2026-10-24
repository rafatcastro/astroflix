import bigInt from 'big-integer';
import type { Api as TiposApi, TelegramClient } from 'telegram';
import type { Db } from '../db/index';
import { APP_VERSION } from '../bundled';
import { BLOCO } from './blocos';

/** Blocos de 512 KB em andamento ao mesmo tempo num download do Telegram. */
const PEDIDOS_SIMULTANEOS = 8;
import type { ClienteTelegram, Convite, DialogoTelegram, GrupoTelegram } from './cliente';
import { credenciaisTelegram } from './credenciais';
import type { EstadoLogin, ServicosTelegram } from './servicos';
import { falhaDoErro } from './status';
import { FalhaTelegram, type CredenciaisTelegram, type MensagemTelegram, type MidiaTelegram, type PeerTelegram, type TopicoTelegram } from './tipos';

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
// Quem está em milhares de conversas não precisa de todas na lista: a busca e o link cobrem o resto.
const LIMITE_DIALOGOS = 500;
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
  // Bot que entrega o curso em arquivos na conversa: a conversa com ele vira o curso.
  if (e instanceof Api.User) {
    const nome = [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || e.id.toString();
    return { peer: { tipo: 'usuario', id: e.id.toString(), accessHash: e.accessHash?.toString() ?? null }, titulo: nome };
  }
  throw new FalhaTelegram('link-invalido');
}

function inputPeer(Api: typeof TiposApi, p: PeerTelegram): TiposApi.TypeInputPeer {
  if (p.tipo === 'chat') return new Api.InputPeerChat({ chatId: bigInt(p.id) });
  if (p.tipo === 'usuario') return new Api.InputPeerUser({ userId: bigInt(p.id), accessHash: bigInt(p.accessHash ?? '0') });
  return new Api.InputPeerChannel({ channelId: bigInt(p.id), accessHash: bigInt(p.accessHash ?? '0') });
}

// A foto chega em vários tamanhos; o maior é o original que a pessoa postou.
function tamanhoDaFoto(Api: typeof TiposApi, s: TiposApi.TypePhotoSize): number {
  return s instanceof Api.PhotoSize ? s.size : s instanceof Api.PhotoSizeProgressive ? (s.sizes.at(-1) ?? 0) : -1;
}

function maiorFoto(Api: typeof TiposApi, foto: TiposApi.Photo): { tipo: string; tamanho: number } | null {
  const s = foto.sizes.filter((x) => tamanhoDaFoto(Api, x) > 0).sort((a, b) => tamanhoDaFoto(Api, b) - tamanhoDaFoto(Api, a))[0];
  return s ? { tipo: (s as { type: string }).type, tamanho: tamanhoDaFoto(Api, s) } : null;
}

function midiaDe(Api: typeof TiposApi, m: TiposApi.Message): MidiaTelegram | null {
  const media = m.media;
  if (!media) return null;
  if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
    const maior = maiorFoto(Api, media.photo);
    if (maior) return { tipo: 'foto', nome: null, tamanho: maior.tamanho, mime: 'image/jpeg', duracaoSec: null, temMiniatura: true };
  }
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
  type Arquivo = { local: TiposApi.TypeInputFileLocation; tamanho: number; dcId: number };
  const documentos = new Map<string, { msg: TiposApi.Message; doc: TiposApi.Document | null; arquivo: Arquivo; ate: number }>();

  // Primeiro plano é o que a pessoa está esperando (importar, prévia, tocar a
  // aula). As capas vêm aos milhares e são enfeite: cada pedido delas espera não
  // haver nenhum desses em andamento. Sem isso, a importação seguinte ficava atrás
  // das capas da anterior (e do flood que elas provocam) e só andava reabrindo o app.
  let emPrimeiroPlano = 0;
  let aoLiberar: Array<() => void> = [];
  async function vezDoFundo(): Promise<void> {
    while (emPrimeiroPlano > 0) await new Promise<void>((r) => aoLiberar.push(r));
  }

  // Toda saída para o Telegram passa por aqui: o erro vira FalhaTelegram, e a
  // sessão revogada em outro aparelho é esquecida, para o status não mentir.
  async function chamar<T>(fn: () => Promise<T>, fundo = false): Promise<T> {
    if (fundo) await vezDoFundo();
    else emPrimeiroPlano++;
    try {
      return await fn();
    } catch (e) {
      const f = falhaDoErro(e);
      if (f.tipo === 'nao-autorizado') aoPerderSessao();
      throw f;
    } finally {
      if (!fundo && --emPrimeiroPlano === 0) {
        const esperando = aoLiberar;
        aoLiberar = [];
        for (const r of esperando) r();
      }
    }
  }

  async function documento(peer: PeerTelegram, msgId: number, renovar = false, fundo = false) {
    const chave = `${peer.id}:${msgId}`;
    const guardado = documentos.get(chave);
    if (!renovar && guardado && guardado.ate > Date.now()) return guardado;
    const [msg] = await chamar(() => client.getMessages(inputPeer(Api, peer), { ids: [msgId] }), fundo);
    const novo = guardar(peer, msgId, msg);
    if (!novo) throw new FalhaTelegram('removido');
    return novo;
  }

  function guardar(peer: PeerTelegram, msgId: number, msg: TiposApi.Message | undefined) {
    const chave = `${peer.id}:${msgId}`;
    const media = msg?.media;
    let doc: TiposApi.Document | null = null;
    let arquivo: Arquivo | null = null;
    if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      doc = media.document;
      arquivo = {
        local: new Api.InputDocumentFileLocation({ id: doc.id, accessHash: doc.accessHash, fileReference: doc.fileReference, thumbSize: '' }),
        tamanho: Number(doc.size),
        dcId: doc.dcId,
      };
    } else if (media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo) {
      const f = media.photo;
      const maior = maiorFoto(Api, f);
      if (maior) {
        arquivo = {
          local: new Api.InputPhotoFileLocation({ id: f.id, accessHash: f.accessHash, fileReference: f.fileReference, thumbSize: maior.tipo }),
          tamanho: maior.tamanho,
          dcId: f.dcId,
        };
      }
    }
    if (!msg || !arquivo) {
      documentos.delete(chave);
      return null;
    }
    const novo = { msg, doc, arquivo, ate: Date.now() + VALIDADE_DOCUMENTO_MS };
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

  // Os tópicos com este id (o Telegram devolve só os que existem).
  async function topicoPorId(canal: TiposApi.Channel, id: number): Promise<{ id: number; titulo: string } | null> {
    const r = await client.invoke(new Api.channels.GetForumTopicsByID({ channel: canal, topics: [id] })).catch(() => null);
    const t = r?.topics.find((t): t is TiposApi.ForumTopic => t instanceof Api.ForumTopic && t.id === id);
    return t ? { id: t.id, titulo: t.title } : null;
  }

  // O número do link num grupo com tópicos: o próprio tópico (t.me/c/123/14078)
  // ou uma mensagem dentro de um (o tópico vem do cabeçalho dela). Mensagem sem
  // tópico mora no "General", que é o tópico 1.
  async function topicoDoLink(canal: TiposApi.Channel, link: { mensagem?: number; topico?: number }) {
    if (link.topico) return topicoPorId(canal, link.topico);
    if (!link.mensagem) return null;
    const direto = await topicoPorId(canal, link.mensagem);
    if (direto) return direto;
    const [m] = await client.getMessages(canal, { ids: [link.mensagem] });
    const rt = m instanceof Api.Message ? m.replyTo : undefined;
    const id = rt instanceof Api.MessageReplyHeader && rt.forumTopic ? (rt.replyToTopId ?? rt.replyToMsgId) : 1;
    return id ? topicoPorId(canal, id) : null;
  }

  // A busca do Telegram com filtro e tópico juntos: o iterMessages do GramJS só
  // faz um ou outro (com tópico ele lê o tópico inteiro, conversa inclusive).
  async function* buscar(peer: PeerTelegram, filter: TiposApi.TypeMessagesFilter): AsyncGenerator<TiposApi.Message> {
    let offsetId = 0;
    for (;;) {
      const r = await client.invoke(
        new Api.messages.Search({
          peer: inputPeer(Api, peer),
          q: '',
          filter,
          topMsgId: peer.topico,
          minDate: 0,
          maxDate: 0,
          offsetId,
          addOffset: 0,
          limit: 100,
          maxId: 0,
          minId: 0,
          hash: bigInt.zero,
        }),
      );
      if (r instanceof Api.messages.MessagesNotModified || !r.messages.length) return;
      for (const m of r.messages) if (m instanceof Api.Message) yield m;
      offsetId = r.messages[r.messages.length - 1].id;
    }
  }

  const contarNoTopico = async (peer: PeerTelegram, filter: TiposApi.TypeMessagesFilter) => {
    const r = await client.invoke(
      new Api.messages.Search({ peer: inputPeer(Api, peer), q: '', filter, topMsgId: peer.topico, minDate: 0, maxDate: 0, offsetId: 0, addOffset: 0, limit: 1, maxId: 0, minId: 0, hash: bigInt.zero }),
    );
    if (r instanceof Api.messages.MessagesNotModified) return 0;
    return 'count' in r ? r.count : r.messages.length;
  };

  return {
    resolver: (link) =>
      chamar(async () => {
        const alvo =
          link.tipo === 'id'
            ? link.peer === 'chat'
              ? new Api.PeerChat({ chatId: bigInt(link.id) })
              : link.peer === 'usuario'
                ? new Api.PeerUser({ userId: bigInt(link.id) })
                : new Api.PeerChannel({ channelId: bigInt(link.id) })
            : link.tipo === 'privado'
              ? new Api.PeerChannel({ channelId: bigInt(link.canalId) })
              : null;
        const e =
          link.tipo === 'publico'
            ? await entidade(link.usuario)
            : await entidade(alvo!).catch((err) => {
                // Não achar o canal é "não está no grupo"; sessão caída, rede e flood
                // seguem com o próprio nome, para a interface oferecer a saída certa.
                const f = falhaDoErro(err);
                throw f.tipo === 'telegram' || f.tipo === 'sem-acesso' ? new FalhaTelegram('sem-acesso') : f;
              });
        const grupo = peerDe(Api, e);
        if (link.tipo === 'id') return grupo;
        // Link com número num grupo sem tópicos: é só uma mensagem, e o curso é o grupo todo.
        if ((link.mensagem || link.topico) && e instanceof Api.Channel && e.forum) {
          const t = await topicoDoLink(e, link);
          if (t) return { peer: { ...grupo.peer, topico: t.id }, titulo: t.titulo || grupo.titulo };
        }
        return grupo;
      }),

    verConvite: (hash) =>
      chamar(async (): Promise<Convite> => {
        const r = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (r instanceof Api.ChatInviteAlready) return { tipo: 'ja-membro', grupo: peerDe(Api, r.chat) };
        if (r instanceof Api.ChatInvitePeek) {
          const chat = r.chat as { title?: string; broadcast?: boolean; participantsCount?: number };
          return { tipo: 'convite', titulo: chat.title ?? '', canal: !!chat.broadcast, membros: chat.participantsCount ?? null, foto: null };
        }
        // A foto é enfeite: se não baixar, a prévia mostra a inicial do nome.
        const foto =
          r.photo instanceof Api.Photo
            ? await client.downloadMedia(new Api.MessageMediaPhoto({ photo: r.photo }), {}).catch(() => null)
            : null;
        return {
          tipo: 'convite',
          titulo: r.title,
          canal: !!r.broadcast,
          membros: r.participantsCount ?? null,
          foto: Buffer.isBuffer(foto) && foto.length ? foto : null,
        };
      }),

    previa: (peer) =>
      chamar(async () => {
        const alvo = inputPeer(Api, peer);
        // limit 1 com filtro: o Telegram devolve o total da busca sem mandar o
        // histórico, então a prévia sai rápida mesmo num grupo com milhares de vídeos.
        const contar = async (filter: TiposApi.TypeMessagesFilter) =>
          peer.topico ? contarNoTopico(peer, filter) : ((await client.getMessages(alvo, { limit: 1, filter })).total ?? 0);
        const videos = await contar(new Api.InputMessagesFilterVideo());
        const arquivos = await contar(new Api.InputMessagesFilterDocument());
        const fotos = await contar(new Api.InputMessagesFilterPhotos());

        const e = await client.getEntity(alvo).catch(() => null);
        let membros = (e as { participantsCount?: number } | null)?.participantsCount ?? null;
        // Canal costuma vir sem a contagem na entidade; ela só está no "full".
        if (membros === null && peer.tipo === 'canal') {
          const full = await client
            .invoke(new Api.channels.GetFullChannel({ channel: new Api.InputChannel({ channelId: bigInt(peer.id), accessHash: bigInt(peer.accessHash ?? '0') }) }))
            .catch(() => null);
          membros = (full?.fullChat as { participantsCount?: number } | undefined)?.participantsCount ?? null;
        }
        const foto = e ? await client.downloadProfilePhoto(e, { isBig: false }).catch(() => null) : null;
        return {
          canal: e instanceof Api.Channel && !!e.broadcast,
          bot: e instanceof Api.User && !!e.bot,
          membros,
          foto: Buffer.isBuffer(foto) && foto.length ? foto : null,
          videos,
          arquivos,
          fotos,
        };
      }),

    entrarPorConvite: (hash) =>
      chamar(async () => {
        const u = (await client.invoke(new Api.messages.ImportChatInvite({ hash }))) as { chats?: unknown[] };
        const chat = u.chats?.find((c) => c instanceof Api.Channel || c instanceof Api.Chat);
        if (!chat) throw new FalhaTelegram('telegram');
        return peerDe(Api, chat);
      }),

    dialogos: () =>
      chamar(async () => {
        const lista: DialogoTelegram[] = [];
        for (const d of await client.getDialogs({ limit: LIMITE_DIALOGOS })) {
          const e = d.entity;
          let tipo: DialogoTelegram['tipo'];
          if (e instanceof Api.Channel) tipo = e.broadcast ? 'canal' : 'grupo';
          // Grupo antigo que virou supergrupo continua na lista, desativado: o novo aparece à parte.
          else if (e instanceof Api.Chat && !e.deactivated && !e.left) tipo = 'grupo';
          // Pessoa não: só bot, que é quem entrega curso em arquivos.
          else if (e instanceof Api.User && e.bot) tipo = 'bot';
          else continue;
          let g: GrupoTelegram;
          try {
            g = peerDe(Api, e);
          } catch {
            continue;
          }
          lista.push({
            chave: `tg:${g.peer.tipo}/${g.peer.id}`,
            peer: g.peer,
            titulo: g.titulo,
            tipo,
            membros: (e as { participantsCount?: number }).participantsCount ?? null,
          });
        }
        return lista;
      }),

    topicos: (peer) =>
      chamar(async () => {
        if (peer.tipo !== 'canal' || peer.topico) return [];
        // Só grupo com tópicos: num canal ou grupo comum, pedir os tópicos dá erro
        // (CHANNEL_INVALID, que viraria "sem acesso" e derrubaria a criação do curso).
        const e = await client.getEntity(inputPeer(Api, peer)).catch(() => null);
        if (!(e instanceof Api.Channel) || !e.forum) return [];
        const canal = new Api.InputChannel({ channelId: bigInt(peer.id), accessHash: bigInt(peer.accessHash ?? '0') });
        const lista: TopicoTelegram[] = [];
        let offsetDate = 0;
        let offsetId = 0;
        let offsetTopic = 0;
        for (;;) {
          const r = await client
            .invoke(new Api.channels.GetForumTopics({ channel: canal, q: '', offsetDate, offsetId, offsetTopic, limit: 100 }))
            .catch((e) => {
              // Os tópicos só organizam em módulos: se não vierem, o curso fica sem
              // módulos, como sempre foi. Sessão caída e flood seguem, para a interface explicar.
              const f = falhaDoErro(e);
              if (f.tipo === 'nao-autorizado' || f.tipo === 'flood' || f.tipo === 'sem-conexao') throw e;
              return null;
            });
          if (!r) return [];
          const topicos = r.topics.filter((t): t is TiposApi.ForumTopic => t instanceof Api.ForumTopic);
          for (const t of topicos) if (!lista.some((x) => x.id === t.id)) lista.push({ id: t.id, titulo: t.title });
          if (!topicos.length || lista.length >= r.count) break;
          // A próxima página continua do último tópico, pela data da última mensagem dele.
          const ultimo = topicos[topicos.length - 1];
          const msg = r.messages.find((m) => 'id' in m && m.id === ultimo.topMessage) as { date?: number } | undefined;
          offsetTopic = ultimo.id;
          offsetId = ultimo.topMessage;
          offsetDate = msg?.date ?? 0;
        }
        return lista;
      }),

    mensagens: (peer) =>
      chamar(async () => {
        // Buscas filtradas (vídeos; arquivos; fotos) em vez do histórico inteiro:
        // num grupo com milhares de mensagens de conversa, ler tudo levaria minutos.
        const porId = new Map<number, MensagemTelegram>();
        for (const filter of [new Api.InputMessagesFilterVideo(), new Api.InputMessagesFilterDocument(), new Api.InputMessagesFilterPhotos()]) {
          const lista = peer.topico ? buscar(peer, filter) : client.iterMessages(inputPeer(Api, peer), { limit: undefined, filter });
          for await (const m of lista) {
            if (!(m instanceof Api.Message) || porId.has(m.id)) continue;
            // Num grupo com tópicos, mensagem sem cabeçalho de tópico mora no "General" (1).
            const rt = m.replyTo;
            const topico = rt instanceof Api.MessageReplyHeader && rt.forumTopic ? (rt.replyToTopId ?? rt.replyToMsgId) : 1;
            porId.set(m.id, { id: m.id, data: m.date, legenda: m.message ?? '', midia: midiaDe(Api, m), topico });
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
        const { arquivo } = await documento(peer, msgId, renovar);
        const local = arquivo.local;
        // Vários blocos pedidos de uma vez, entregues na ordem. O iterDownload do
        // GramJS pede um, espera e só então pede o próximo: a velocidade ficava
        // presa ao tempo de ida e volta de cada pedido, e um curso inteiro
        // levava horas. O Telegram atende pedidos simultâneos na mesma conexão.
        const tamanho = arquivo.tamanho;
        let sender = await client.getSender(arquivo.dcId);
        const pedir = async (pos: number): Promise<Buffer> => {
          const req = new Api.upload.GetFile({ location: local, offset: bigInt(pos), limit: BLOCO, precise: false, cdnSupported: false });
          for (let t = 0; ; t++) {
            try {
              const r = await client.invokeWithSender(req, sender);
              if (!(r instanceof Api.upload.File)) throw new Error('CDN');
              return Buffer.from(r.bytes);
            } catch (e) {
              const dc = (e as { newDc?: number }).newDc;
              const timeout = (e as { errorMessage?: string }).errorMessage === 'TIMEOUT';
              if (t < 2 && (dc || timeout)) {
                if (dc) sender = await client.getSender(dc);
                continue;
              }
              throw e;
            }
          }
        };
        const fila: Promise<Buffer>[] = [];
        let proximo = offset + entregue;
        const encher = () => {
          while (fila.length < PEDIDOS_SIMULTANEOS && proximo < tamanho) {
            const p = pedir(proximo);
            p.catch(() => undefined); // quem não for esperado (cancelou, falhou antes) não vira rejeição solta
            fila.push(p);
            proximo += BLOCO;
          }
        };
        try {
          encher();
          while (fila.length) {
            const bloco = await fila.shift()!;
            if (signal.aborted) return;
            entregue += bloco.length;
            if (bloco.length) yield bloco;
            if (bloco.length < BLOCO) return;
            encher();
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

    prepararMiniaturas: async (peer, msgIds) => {
      const msgs = await chamar(() => client.getMessages(inputPeer(Api, peer), { ids: msgIds }), true);
      msgIds.forEach((id, i) => guardar(peer, id, msgs[i]));
    },

    miniatura: (peer, msgId) =>
      chamar(async () => {
        const { msg, doc } = await documento(peer, msgId, false, true);
        // Foto: a miniatura é um tamanho menor da própria foto (~800 px).
        if (!doc) {
          const media = msg.media as TiposApi.MessageMediaPhoto;
          const foto = media.photo as TiposApi.Photo;
          const media800 = foto.sizes.filter((s) => tamanhoDaFoto(Api, s) > 0).find((s) => (s as { type: string }).type === 'x');
          const r = await client.downloadMedia(msg, media800 ? { thumb: media800 } : {});
          return Buffer.isBuffer(r) && r.length ? r : null;
        }
        // A maior miniatura de verdade, escolhida aqui: por índice, o GramJS descarta
        // os PhotoPathSize antes de indexar, e um índice fora da lista o faz baixar
        // o VÍDEO inteiro para a memória no lugar da capa.
        const tamanho = (s: TiposApi.TypePhotoSize): number =>
          s instanceof Api.PhotoSize ? s.size : s instanceof Api.PhotoSizeProgressive ? (s.sizes.at(-1) ?? 0) : -1;
        const melhor = (doc.thumbs ?? []).filter((s) => tamanho(s) > 0).sort((a, b) => tamanho(b) - tamanho(a))[0];
        if (!melhor) return null;
        const r = await client.downloadMedia(msg, { thumb: melhor });
        return Buffer.isBuffer(r) && r.length ? r : null;
      }, true),
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
