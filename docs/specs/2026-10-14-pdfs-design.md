# PDFs (livros, questões, apostilas)

## Objetivo

Uma segunda estante no menu principal, ao lado dos cursos: PDFs que a pessoa lê dentro do app, que
lembra a página onde ela parou em qualquer computador da conta.

## Decisões (aprovadas na conversa)

- **Ler dentro do app**, com o pdf.js (`pdfjs-dist`, build legacy, carregado só quando precisa).
  O visualizador do sistema num `<iframe>` não diz em que página a pessoa está, e lembrar a página
  é o motivo de o leitor existir.
- **Origem: arquivos (um ou vários) ou uma pasta** (todos os PDFs dela, subpastas inclusive), com
  uma **categoria** escolhida na hora (Livros, Questões, Apostilas…), que vira filtro da estante.
  A categoria é texto livre no próprio PDF: as que existem são as que algum PDF usa.
- O arquivo **nunca** é copiado, alterado ou enviado. Remover tira só da estante.

## Interface

- Menu principal: abas **Cursos | PDFs** (`AbasPrincipais`).
- Estante (`/pdfs`): grade de capas (primeira página), título, "p. X de Y" ou "N páginas", barra de
  progresso, ✓ Lido, "Arquivo não encontrado"; filtros Todas · categorias · Sem categoria;
  **Adicionar ▾** (Arquivos PDF… / Pasta…) seguido da pergunta da categoria; menu ⋯ com Renomear,
  Categoria, Marcar como (não) lido, Re-apontar arquivo e Remover da estante.
- Leitor (`/pdf/:id`): rolagem contínua; abre na página onde parou; barra com voltar, título,
  anterior/próxima, campo da página, zoom (−, 100%, +) e **Marcar como lido**. Teclas ←/→, +/−, 0 e
  Esc. Chegar à última página marca como lido.

## Dados

- SQLite v6: `documentos (id, titulo, categoria, caminho, tamanho, paginas, pagina, lido, lido_em,
  leitura_em, criado_em, atualizado_em)`, com os gatilhos da `nuvem_fila`.
- Nuvem: `documentos` (sem o caminho) e `documentos_por_maquina (documento_id, maquina_id,
  caminho)`. Conflito: a leitura vale a mais recente (`leitura_em`, gatilho `mesclar_leitura`).
- Capa e número de páginas: desenhados pela interface e enviados ao servidor
  (`DATA_DIR/thumbs/documento-<id>.png`).

## Fora do escopo

Anotações e marcações, PDF do Drive/Telegram, busca no texto, miniaturas laterais.
