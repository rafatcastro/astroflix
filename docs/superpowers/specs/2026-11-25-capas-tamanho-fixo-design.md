# Capas com tamanho fixo e imagem de espera

**Por quê:** na página do curso e na lateral do player a `<img>` da capa é quem dá o tamanho.
Sem capa (404, a fila ainda gerando), o WebKit trata a imagem como quebrada e ela perde o 16:9;
quando a capa chega, a linha cresce e a lista pula, atrapalhando a navegação.

**Objetivo:** a caixa da capa nunca muda de tamanho; enquanto não há capa, aparece uma imagem
estática de espera.

**Abordagens:** só uma faz sentido — o `CapaAula` passa a ser a caixa (tamanho fixo vindo do
`className` de quem usa) com a `<img>` absoluta por cima. Consertar tela a tela deixaria o
próximo uso cair no mesmo defeito.

**Decidido:**
- `CapaAula` desenha a caixa (`relative overflow-hidden`, fundo cinza-escuro) com o ícone ▶
  apagado no centro, sem animação; a imagem cobre o ícone quando carrega.
- Vale em todos os usos. O fundo desfocado do topo do curso (`ocultar="display"`) continua sumindo
  sem capa.
- Novas tentativas: 2, 5, 15, 45 s e depois a cada 60 s enquanto montado (antes: 5, 20, 65 s e
  desistia).

**Não-objetivos:** mudar a fila de capas do servidor; a busca (outra conversa).
