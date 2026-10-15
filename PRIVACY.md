# Política de privacidade do Astroflix

**Última atualização:** 13 de outubro de 2026

O Astroflix roda no seu computador e usa uma **conta** (entrar com o Google) para guardar os seus
metadados na nuvem e levá-los para qualquer computador em que você entrar.

## O que vai para a nuvem da conta

Ao entrar com o Google, o app recebe só o seu e-mail e um identificador da conta (escopos `openid
email profile`). Ficam no banco do Astroflix no Supabase, visíveis só para a sua conta (regra de
acesso por usuário no próprio banco):

- a lista de cursos (título, origem, o link do Drive ou do Telegram e o caminho da pasta de cada
  curso local em cada computador seu), as aulas (título, ordem, duração) e as bibliotecas;
- o seu progresso em cada aula;
- os seus flashcards.

**Nunca** vão para a nuvem: os vídeos e materiais, as cópias baixadas e convertidas, as capas, as
sessões do Google Drive e do Telegram e as configurações do player.

## O que o app acessa no Google Drive

Quando você cola o link de uma pasta do Google Drive e autoriza o acesso, o app pede a permissão
`drive.readonly`, só de leitura, e o seu endereço de e-mail. Com elas, ele:

- lista os arquivos da pasta que você indicou, para montar o curso (nomes, tamanhos, duração e
  miniaturas);
- baixa para o seu computador a aula que você abre e as duas seguintes (e converte o que o player
  não toca), para você assistir sem depender da conexão;
- mostra o e-mail da conta conectada nas Configurações.

O app **nunca** cria, altera, move, compartilha ou apaga nada no seu Drive.

## O que o app acessa no Telegram

Quando você cola o link de um grupo ou canal do Telegram, o app pede para você conectar a **sua
conta** do Telegram (por QR code). A sessão aparece como "Astroflix" em Telegram → Configurações →
Dispositivos. Com ela, o app:

- lê as mensagens com vídeo ou arquivo do grupo que você indicou, para montar o curso (legenda,
  nome, tamanho, duração e miniatura);
- transmite os vídeos e arquivos desse grupo para o player e baixa para o seu computador a aula que
  você abre e as duas seguintes;
- entra num grupo por link de convite **só quando você confirma**;
- mostra o seu nome de usuário nas Configurações.

O app **nunca** envia, apaga ou altera mensagens, não lê suas conversas particulares e não mexe nos
seus contatos.

## O que o app faz com o Anki

Se você usa flashcards, o app fala com o **Anki aberto no seu computador**, pelo complemento
AnkiConnect, sem passar pela internet. Ele cria o tipo de nota "Astroflix" e os baralhos
`Astroflix::Cursos…`, adiciona, edita e apaga **só os cards que você criou no Astroflix**, lê esses
mesmos cards para mostrar as edições feitas no Anki e pede ao Anki para sincronizar com a sua conta
do AnkiWeb. Uma cópia dos cards fica no banco do app (`app.db`).

## Onde os dados ficam

Tudo fica só no seu computador, na pasta de dados do app (`~/.learnflix`, ou
`%LOCALAPPDATA%\Astroflix` no Windows):

- a lista de aulas e o seu progresso;
- as miniaturas baixadas;
- o token de acesso do Google e o seu e-mail;
- a sessão do Telegram e o seu nome de usuário;
- as cópias dos cursos do Google Drive (`downloads/`) e os vídeos convertidos (`converted/`).

Nada disso é enviado ao projeto Astroflix nem a terceiros. O app só se comunica com:

- os servidores do Google e do Telegram, para ler o que você pediu;
- o GitHub, para conferir se há uma versão nova do app (sem enviar nenhum dado seu).

## Como revogar

Em **Configurações → Google Drive → Desconectar**, o app revoga o acesso e apaga o token salvo. Você
também pode revogar a qualquer momento em
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Em **Configurações → Telegram → Desconectar**, o app encerra a sessão no Telegram e apaga a cópia
local. Você também pode encerrá-la pelo próprio Telegram, em Configurações → Dispositivos.

## Uso dos dados do Google

O uso das informações recebidas das APIs do Google segue a
[Política de dados do usuário dos serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy),
incluindo os requisitos de uso limitado.

## Contato

Dúvidas: abra uma issue em
[github.com/rafatcastro/astroflix/issues](https://github.com/rafatcastro/astroflix/issues).
