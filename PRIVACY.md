# Política de privacidade do Learnflix

**Última atualização:** 12 de outubro de 2026

O Learnflix é um aplicativo que roda inteiramente no seu computador. Não existe servidor do Learnflix
na internet, conta do Learnflix ou coleta de dados pelo projeto.

## O que o app acessa no Google Drive

Quando você cola o link de uma pasta do Google Drive e autoriza o acesso, o app pede a permissão
`drive.readonly`, só de leitura, e o seu endereço de e-mail. Com elas, ele:

- lista os arquivos da pasta que você indicou, para montar o curso (nomes, tamanhos, duração e
  miniaturas);
- transmite os vídeos e materiais dessa pasta para o player, no momento em que você abre cada um;
- mostra o e-mail da conta conectada nas Configurações.

O app **nunca** cria, altera, move, compartilha ou apaga nada no seu Drive.

## Onde os dados ficam

Tudo fica só no seu computador, na pasta de dados do app (`~/.learnflix`, ou
`%LOCALAPPDATA%\Learnflix` no Windows):

- a lista de aulas e o seu progresso;
- as miniaturas baixadas;
- o token de acesso do Google e o seu e-mail.

Nada disso é enviado ao projeto Learnflix nem a terceiros. Os únicos servidores com que o app se
comunica são os do próprio Google, para ler os arquivos que você pediu.

## Como revogar

Em **Configurações → Google Drive → Desconectar**, o app revoga o acesso e apaga o token salvo. Você
também pode revogar a qualquer momento em
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Uso dos dados do Google

O uso das informações recebidas das APIs do Google segue a
[Política de dados do usuário dos serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy),
incluindo os requisitos de uso limitado.

## Contato

Dúvidas: abra uma issue em
[github.com/rafatcastro/learnflix-v2/issues](https://github.com/rafatcastro/learnflix-v2/issues).
