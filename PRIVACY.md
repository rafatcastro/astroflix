# Política de privacidade do Learnflix

**Última atualização:** 13 de outubro de 2026

O Learnflix é um aplicativo que roda inteiramente no seu computador. Não existe servidor do Learnflix
na internet, conta do Learnflix ou coleta de dados pelo projeto.

## O que o app acessa no Google Drive

Quando você cola o link de uma pasta do Google Drive e autoriza o acesso, o app pede a permissão
`drive.readonly`, só de leitura, e o seu endereço de e-mail. Com elas, ele:

- lista os arquivos da pasta que você indicou, para montar o curso (nomes, tamanhos, duração e
  miniaturas);
- baixa os vídeos e materiais dessa pasta para o seu computador (e converte o que o player não
  toca), para você assistir sem depender da conexão;
- mostra o e-mail da conta conectada nas Configurações.

O app **nunca** cria, altera, move, compartilha ou apaga nada no seu Drive.

## O que o app acessa no Telegram

Quando você cola o link de um grupo ou canal do Telegram, o app pede para você conectar a **sua
conta** do Telegram (por QR code). A sessão aparece como "Learnflix" em Telegram → Configurações →
Dispositivos. Com ela, o app:

- lê as mensagens com vídeo ou arquivo do grupo que você indicou, para montar o curso (legenda,
  nome, tamanho, duração e miniatura);
- transmite os vídeos e arquivos desse grupo para o player, no momento em que você abre cada um;
- entra num grupo por link de convite **só quando você confirma**;
- mostra o seu nome de usuário nas Configurações.

O app **nunca** envia, apaga ou altera mensagens, não lê suas conversas particulares e não mexe nos
seus contatos.

## O que o app faz com o Anki

Se você usa flashcards, o app fala com o **Anki aberto no seu computador**, pelo complemento
AnkiConnect, sem passar pela internet. Ele cria o tipo de nota "Learnflix" e os baralhos
`Learnflix::Cursos…`, adiciona, edita e apaga **só os cards que você criou no Learnflix**, lê esses
mesmos cards para mostrar as edições feitas no Anki e pede ao Anki para sincronizar com a sua conta
do AnkiWeb. Uma cópia dos cards fica no banco do app (`app.db`).

## Onde os dados ficam

Tudo fica só no seu computador, na pasta de dados do app (`~/.learnflix`, ou
`%LOCALAPPDATA%\Learnflix` no Windows):

- a lista de aulas e o seu progresso;
- as miniaturas baixadas;
- o token de acesso do Google e o seu e-mail;
- a sessão do Telegram e o seu nome de usuário;
- as cópias dos cursos do Google Drive (`downloads/`) e os vídeos convertidos (`converted/`).

Nada disso é enviado ao projeto Learnflix nem a terceiros. O app só se comunica com:

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
[github.com/rafatcastro/learnflix-v2/issues](https://github.com/rafatcastro/learnflix-v2/issues).
