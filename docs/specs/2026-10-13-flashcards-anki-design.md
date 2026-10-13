# Flashcards com o Anki

## Objetivo

A pessoa escreve frente e verso de um card no Learnflix (de uma aula, de um curso ou geral), o card
vai para o Anki dela e o Learnflix lê de volta o que está lá para mostrar nas aulas. A revisão
espaçada continua sendo do Anki; o Learnflix cria, mostra e liga o card à aula e ao minuto do
vídeo.

Como o Drive, é **opcional**: quem não usa Anki nunca configura nada, e nada no app passa a
depender dele.

## Decisões (aprovadas na conversa)

- **Conexão: AnkiConnect.** O AnkiWeb não tem API pública. O Learnflix fala com o Anki desktop pelo
  add-on AnkiConnect (código 2055492159), em `http://127.0.0.1:8765`. Quem chama é o **servidor**
  (a interface não alcança outra porta local, e requisição sem `Origin` passa pelo CORS do
  AnkiConnect). Depois de enviar, o app pede ao Anki para sincronizar com o AnkiWeb.
- **Fonte da verdade: o Anki, com espelho local.** A tabela `flashcards` guarda frente, verso, aula,
  minuto e o id da nota no Anki. Criar/editar/apagar grava aqui e envia; com o Anki fechado o card
  fica `pendente` e vai depois. Ao listar, o app relê as notas no Anki: edição feita lá atualiza a
  cópia, nota apagada lá some daqui.
- **Baralhos:** card de curso (ou de aula) vai para `Learnflix::Cursos::<curso>`; card geral vai
  para `Learnflix::Cursos`. Revisar `Learnflix::Cursos` pega tudo. `::` no título do curso vira `:`
  (senão criaria subbaralhos). O baralho é decidido ao criar o card; renomear o curso depois não move
  nada.
- **Tipo de nota próprio, "Learnflix"**, com `Frente`, `Verso` e `Origem` ("Curso › Aula · 12:40").
  O "Básico" muda de nome conforme o idioma do Anki; o tipo próprio funciona sempre. Tags:
  `learnflix`. Duplicatas são permitidas (senão um card repetido ficaria pendente para sempre).
- **Na aula: painel lateral** (como a lista de aulas, e um fecha o outro). Mostra os cards da aula,
  com o minuto (clicar leva o vídeo até ali) e o verso escondido até clicar. O formulário de novo
  card guarda o minuto atual; focar nele pausa o vídeo e suspende os atalhos do player.
- **Tela Flashcards (`/flashcards`)**: aberta pela biblioteca (todos), pelo curso
  (`?curso=<id>`) e pelo painel da aula. Lista os gerais e os de cada curso, cria card geral ou de
  curso, edita e apaga.
- **Configurações → Anki**: estado (conectado / Anki fechado / pendentes) e como instalar o add-on.
- **Backup:** os cards entram no export da biblioteca (os de curso presos ao `rel_path` da aula,
  os gerais numa lista à parte), com o id da nota: importar na outra máquina não duplica no Anki.

## Dados (migração v4)

```sql
CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,  -- NULL = geral
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL, -- NULL = do curso todo
  minuto_sec REAL,
  frente TEXT NOT NULL,
  verso TEXT NOT NULL,
  anki_note_id INTEGER,
  pendente TEXT CHECK (pendente IN ('criar','editar','apagar')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
```

Card nunca enviado e apagado sai na hora; card já no Anki e apagado fica `apagar` (fora das listas)
até o Anki confirmar.

## API

- `GET /api/flashcards?lessonId=|courseId=|geral=1` → `{ cards, anki }`, depois de enviar os
  pendentes e reler as notas (falha do Anki não falha a rota: devolve a cópia local).
- `POST /api/flashcards` `{frente, verso, courseId?, lessonId?, minutoSec?}`,
  `PATCH /api/flashcards/:id` `{frente?, verso?}`, `DELETE /api/flashcards/:id`.
- `GET /api/anki/status` → `{ estado: 'conectado'|'fechado'|'erro', pendentes }`.

## Fora do escopo

Revisão espaçada dentro do app, cards gerados automaticamente, mídia (imagem/áudio) nos cards,
escolher outro baralho ou tipo de nota, login direto no AnkiWeb.
