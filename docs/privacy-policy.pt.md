<!-- Draft, not legal advice until a lawyer reviews it. `pnpm policy:check` lists the placeholders the owner fills before publishing. -->

# Política de privacidade do Nimbo

[English]({{POLICY_URL}}) · [Español]({{POLICY_URL}}es/) · Português

Versão 2026-12-01 · Última atualização 2026-12-01

<a id="summary"></a>
## Em resumo

O Nimbo é um diário de enxaqueca com um acompanhante de IA opcional. Ele registra suas crises, seus remédios e seus check-ins diários, mostra tudo de volta para você e descreve padrões nesses registros. O Nimbo não é um dispositivo médico: não diagnostica, não trata nem previne nenhuma doença, e não substitui um profissional de saúde.

Esta página explica quais dados o Nimbo coleta, para quê, onde ficam guardados, quem os trata, por quanto tempo são mantidos e como você, titular dos dados, exerce seus direitos. Em resumo:

- Seus registros de enxaqueca são dados pessoais sensíveis de saúde. O Nimbo só os armazena com o seu consentimento específico e destacado.
- O acompanhante de IA é uma segunda escolha, separada. Sem ela, nada vai para um serviço de IA.
- Seus dados nunca são vendidos, nunca são usados para publicidade e nunca são analisados para terceiros. O Nimbo não tem anúncios, nem análise de uso, nem rastreamento.
- Você pode exportar seus dados ou excluir sua conta pelo app a qualquer momento, ou por e-mail.

Dúvidas vão para [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

<a id="controller"></a>
## Quem é o responsável

O controlador dos seus dados é {{CONTROLLER_NAME}}, {{CONTROLLER_COUNTRY}}, que desenvolve e opera o Nimbo. Contato: [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

O encarregado pelo tratamento de dados pessoais é {{DPO_NAME}}, no mesmo endereço.

O Nimbo é oferecido em {{LAUNCH_COUNTRIES}}. Ele não é oferecido no Espaço Econômico Europeu, no Reino Unido nem na Suíça.

O Nimbo é para adultos. Antes de criar uma conta, você confirma que tem 18 anos ou mais. O Nimbo não coleta conscientemente dados de menores de 18 anos; se uma conta for de um menor, ela é excluída.

<a id="health-data-consent"></a>
## Seus dados de saúde e o seu consentimento

> **Seus registros de enxaqueca são dados de saúde, ou seja, dados pessoais sensíveis.** Isso inclui suas crises, seus remédios e doses, seus check-ins (sono, estresse, água, cafeína, álcool, refeições, telas e menstruação), seus gatilhos e anotações, as respostas da configuração inicial sobre seus gatilhos e prioridades, as notas do Nimbo sobre você e os sinais calculados a partir dos seus registros.
>
> **O Nimbo só os armazena com o seu consentimento específico e destacado**, que você dá na tela “Antes de começar” ao marcar “Concordo que o Nimbo armazene meus registros de enxaqueca, medicamentos e check-ins, que são dados de saúde, para me mostrar esses dados e encontrar padrões.” O Nimbo usa esses dados só para manter seu diário, mostrar o diário para você, calcular seus padrões e sinais, avisar sobre o uso excessivo de remédios e lembrar você do seu remédio preventivo.
>
> **O acompanhante de IA é um segundo consentimento, separado**, na tela “A IA do Nimbo e seus dados de saúde”. Sem ele, nenhum dado seu vai para um serviço de IA.
>
> **O que significa dizer não.** O Nimbo não consegue manter um diário sem armazená-lo, então sem o primeiro consentimento não há conta. Sem o segundo, o Nimbo continua sendo um registro completo, sem a aba Nimbo e sem o ditado.
>
> **Como revogar.** Desligue “Usar a IA do Nimbo” no Perfil para parar na hora todo tratamento por IA. Excluir sua conta revoga o primeiro consentimento e apaga seus dados.

Seus dados de saúde nunca são vendidos, nunca são usados para publicidade ou mineração de dados e nunca são compartilhados para obter vantagem econômica.

<a id="what-we-collect"></a>
## Quais dados o Nimbo coleta e para quê

O Nimbo coleta só o que cada função precisa. Para cada tipo de dado, o que é, como é coletado, para quê e se é obrigatório:

- **Sua conta.** Seu e-mail e uma senha, que o Supabase Auth guarda só como hash. Se você entrar com o Google, ou com a Apple em um iPhone, o Nimbo recebe o token de identidade que esse serviço emite para você, com o seu e-mail. Serve para você entrar. Obrigatório.
- **Suas configurações.** Seu idioma, fuso horário, aparência, movimento reduzido, o horário e a quantidade diária de avisos, se a tela bloqueada mostra detalhes, e suas respostas da configuração inicial (sua prioridade, os gatilhos que você já conhece e se registra a menstruação). Servem para o app funcionar no seu idioma e no seu horário, e para escolher o momento dos sinais. Você escolhe cada uma.
- **Sua região aproximada, só se você permitir.** Durante a configuração, o Nimbo pode ler sua localização uma vez, com a permissão “durante o uso do app”, e a guarda arredondada para uma casa decimal (uma célula de uns 11 km de lado). Ele nunca guarda sua posição exata, e no Android o app não consegue pedir a localização precisa. Serve só para o sinal de pressão atmosférica. Opcional.
- **Suas crises.** Quando cada uma começou e terminou, a intensidade de 0 a 10, onde doeu, seus sintomas e gatilhos, o que você tentou, o que ajudou e o que não ajudou, suas anotações (até 2.000 caracteres), se você registrou tocando, por voz ou no chat, e quando respondeu a revisão do dia seguinte. Digitadas ou tocadas por você. Servem para seu diário, o Histórico, os padrões e o aviso de uso excessivo.
- **Seus remédios e doses.** O nome de cada remédio, se é agudo ou preventivo, sua forma e sua classe, o texto de dose que você escreve, o tempo mínimo entre doses, o horário e se você o arquivou; e de cada dose, a hora, a crise a que pertence e se ajudou. Servem para a tela Remédios, o aviso de uso excessivo, seus padrões e os lembretes do preventivo.
- **Seus check-ins diários.** A faixa e a qualidade do seu sono, seu nível de estresse, e se você bebeu pouca água, tomou cafeína a mais, bebeu álcool, pulou uma refeição, teve um dia de muitas telas ou começou a menstruar. Tocados por você. Servem para seu diário e os sinais.
- **Sinais.** Motivos curtos calculados pelo código do Nimbo a partir dos seus próprios registros e, se você informou sua região, da previsão de pressão: por exemplo uma crise longa, muitos dias com remédio em um mês ou uma noite curta. São motivos tirados dos seus registros, nunca previsões, riscos ou porcentagens.
- **O acompanhante de IA, só com o seu consentimento de IA.** O que ele recebe está descrito na próxima seção, [A IA do Nimbo](#ai). O servidor guarda só as notas curtas do Nimbo sobre você.
- **Sua voz, só com a IA ligada e só enquanto você segura o microfone.** Veja [A IA do Nimbo](#ai). O Nimbo nunca grava nem guarda áudio.
- **Avisos, só se você permitir.** O token de notificações do seu celular (o endereço para onde os serviços de notificação entregam), o tipo de celular (iPhone ou Android), quando foi registrado pela última vez e uma impressão digital de um código aleatório criado no seu celular, para que só esse celular possa registrar ou remover o token. Se outra conta já tiver o token do seu celular, o Nimbo confirma que seu celular o recebe com um código de uso único enviado como notificação silenciosa; para essa verificação, o servidor guarda o token, sua conta e impressões digitais do código por até 2 horas. Para confirmar a entrega, o servidor guarda o número do recibo e o token de cada aviso por 2 dias.
- **Contagens de uso.** Quantas mensagens ao acompanhante, verificações de segurança e mensagens ditadas você usou por dia, para aplicar os limites diários.
- **Registros de consentimento.** Qual versão desta política e do texto da IA você aceitou ou recusou, quando e em qual idioma, para comprovar o seu consentimento, como a lei exige.
- **Status premium.** Se você tem acesso premium, por uma compra ou uma concessão do controlador, e até quando.

O próprio celular agenda os lembretes do seu remédio preventivo. Um lembrete mostra “Você tem uma nota do Nimbo”, a menos que você ative os detalhes na tela bloqueada, e nada dele chega a um servidor.

O que o Nimbo não coleta: sua localização exata, seus contatos, suas fotos, identificadores de publicidade nem nenhum dado por ferramentas de análise ou rastreamento. O Nimbo não tem anúncios, nem análise de uso, nem rastreamento, e nunca vende seus dados.

### Hipóteses legais

O Nimbo trata seus dados com base nestas hipóteses legais da LGPD:

- **Seu consentimento específico e destacado** (art. 11, I): seus dados de saúde e, separadamente, o acompanhante de IA e a transferência internacional.
- **Seu consentimento** (art. 7º, I): sua região aproximada e os avisos.
- **Execução de contrato, ou seja, prestar o serviço que você pede** (art. 7º, V): sua conta, o login e os e-mails da conta, suas configurações e seu status premium.
- **Legítimo interesse em um serviço seguro** (art. 7º, IX): as verificações de posse do token, os recibos de avisos, as contagens de uso e os registros de segurança do login.
- **Cumprimento de obrigação legal** (art. 7º, II, e art. 8º, §2º): os registros de consentimento, que comprovam o seu consentimento.

<a id="ai"></a>
## A IA do Nimbo

O acompanhante de IA só funciona se você disser sim na tela “A IA do Nimbo e seus dados de saúde”, e você pode desligá-lo no Perfil quando quiser. Desligado, nada vai para um serviço de IA. Se este texto mudar, a IA fica desligada no seu celular até você ler a nova versão e responder de novo.

Quando você envia uma mensagem, seu celular envia ao servidor do Nimbo os turnos recentes da conversa (até 12 mensagens curtas), o idioma do app, sua data local e seu fuso horário, e se você digitou ou ditou. Para responder, o servidor pode ler dados dos seus registros (datas, intensidade, sintomas, gatilhos, remédios, seus padrões e sinais) e as notas do Nimbo sobre você. Ele envia esses dados a dois serviços, a partir do servidor, nunca direto do seu celular:

- **Anthropic.** O Claude escreve as respostas. Quando a TypeSafe não está disponível, o Claude também faz a verificação de segurança.
- **TypeSafe.** O Jev verifica sua mensagem e o rascunho da resposta em busca de sinais de alerta e conselhos inseguros.

Esses serviços nunca recebem seu nome, seu e-mail, o id da sua conta, sua localização nem os ids dos seus registros.

A conversa fica salva só no seu celular, que guarda as últimas 200 mensagens. O servidor guarda só as notas curtas do Nimbo, as que você vê em Perfil → “O que sei sobre você”, onde pode apagar qualquer uma. Essas notas ficam se você desligar a IA, e você pode apagá-las lá.

As palavras de sinal de alerta também são verificadas no seu celular, em todos os idiomas e com a IA desligada. Se uma coincidir, o Nimbo mostra como pedir ajuda urgente e não envia nada.

O ditado usa o reconhecedor de voz do seu próprio celular. Em um iPhone, ele funciona inteiramente no celular. No Android, ele funciona no celular quando o pacote off-line do idioma está instalado; se não, o reconhecedor padrão do celular, em geral o do Google, pode receber o áudio para transcrevê-lo sob os próprios termos. Só as palavras resultantes chegam ao Nimbo. As respostas faladas usam as vozes do seu próprio celular.

A Anthropic e a TypeSafe tratam esses dados nos Estados Unidos. Veja [Transferências internacionais](#transfers).

<a id="where-it-is-kept"></a>
## Onde seus dados ficam guardados

Sua conta e seus registros ficam em um projeto do Supabase em {{DB_REGION}}. Cada linha pertence à sua conta, e as regras de segurança do banco de dados deixam só a sua conta, com a sessão iniciada, ler essa linha. O app se comunica com o servidor por conexões criptografadas, e o provedor de hospedagem criptografa os dados guardados.

Seu celular guarda uma cópia do seu diário para o Nimbo funcionar off-line, as mudanças ainda não enviadas, a conversa com o acompanhante e pequenos caches. Os backups do Android dos dados do Nimbo estão desativados.

{{BACKUPS}}.

<a id="processors"></a>
## Quem trata seus dados

Estes serviços tratam dados em nome do Nimbo, cada um só para a finalidade indicada e sob termos que exigem que eles os protejam. O Nimbo chama os serviços de IA e o serviço de clima a partir do servidor, nunca do seu celular.

| Destinatário | O que recebe | Para quê | Onde | Por quanto tempo guarda |
|---|---|---|---|---|
| Supabase | Tudo o que fica guardado no servidor | Hospedagem: o banco de dados, o login e as funções do servidor | {{DB_REGION}} | Até você apagar os dados ou excluir sua conta |
| Anthropic (Claude) | Com a IA ligada: os turnos da conversa, dados dos seus registros, as notas do Nimbo, o idioma, sua data local e seu fuso horário (como diferença em relação ao UTC); o texto da verificação de segurança quando a TypeSafe não está disponível | Escrever as respostas do acompanhante; a verificação de segurança de reserva | Estados Unidos | A Anthropic {{ANTHROPIC_RETENTION}}. Ela não treina seus modelos com esses dados |
| TypeSafe (Jev) | Com a IA ligada: sua mensagem, o rascunho da resposta e o contexto de sinais de alerta | Verificar a segurança de mensagens e respostas | Estados Unidos | A TypeSafe {{TYPESAFE_RETENTION}}. Ela não treina seus modelos com esses dados |
| Open-Meteo | Só a célula de uma casa decimal da sua região, a partir do servidor do Nimbo, nunca algo que identifique você | A previsão de pressão atmosférica | Suíça | Os registros do servidor web por 90 dias |
| Expo (notificações) | Com os avisos ligados: o token do seu celular e o título de cada aviso, mais a tela que ele abre; o título é “Você tem uma nota do Nimbo”, a menos que você ative os detalhes na tela bloqueada, que acrescentam o texto do sinal; e, para confirmar que um celular recebe o token, um código de uso único em uma notificação silenciosa | Entregar os avisos e a verificação do token | Estados Unidos | Pelo tempo razoavelmente necessário; os recibos de entrega por 1 dia |
| Google (Firebase Cloud Messaging) e Apple (serviço de notificações) | O mesmo aviso, a partir da Expo | Entregar o aviso a um celular Android ou a um iPhone | Estados Unidos | Conforme os próprios termos |
| Google (reconhecedor de voz, Android) | O áudio enquanto você segura o microfone, quando falta o pacote off-line do idioma | Transformar sua voz em texto | Servidores do Google | Conforme os termos do Google |
| Google e Apple (login) | Sua identidade de login, se você os usar | Fazer seu login | Estados Unidos | Conforme os próprios termos |
| {{EMAIL_PROVIDER}} | Seu e-mail e o código de confirmação ou de redefinição | Enviar os e-mails da sua conta | Onde os termos dele indicarem | Os registros de envio por {{EMAIL_LOG_RETENTION}} |

Quando você corrige ou apaga dados, o Nimbo pede aos destinatários que guardam uma cópia que façam o mesmo, a menos que isso seja impossível. Sem venda, sem anúncios, sem análise de uso: ninguém mais recebe seus dados.

<a id="transfers"></a>
## Transferências internacionais

Sua conta e seus registros ficam em {{DB_REGION}}. Alguns serviços tratam dados em outros países:

- **Estados Unidos:** Anthropic e TypeSafe (com a IA ligada), Expo e os serviços de notificação do Google e da Apple (com os avisos ligados), e o reconhecedor de voz do Google (ditado no Android sem o pacote off-line).
- **Suíça:** Open-Meteo, que recebe só uma célula de uns 11 km de lado e nada que identifique você.
- O provedor de e-mail trata seu e-mail onde os termos dele indicarem.

Você consente com essas transferências de forma específica e destacada, sabendo que são internacionais: na tela da IA (“A Anthropic e a TypeSafe processam esses dados nos Estados Unidos”) e na etapa dos avisos. Quando um provedor oferece garantias contratuais, elas também se aplicam; peça uma cópia por e-mail quando existir.

<a id="retention"></a>
## Por quanto tempo seus dados são mantidos

O Nimbo mantém cada tipo de dado só pelo tempo que a finalidade exige:

- **Seus registros, notas, configurações e status premium:** até você apagá-los, onde o app permite (crises, doses e notas do Nimbo), ou excluir sua conta. {{INACTIVE_ACCOUNTS}}.
- **O token de notificações do seu celular:** até você sair da conta nesse celular, o token mudar, a Expo informar que o celular não o aceita mais ou você excluir sua conta.
- **Registros de consentimento:** enquanto sua conta existir, para comprovar o seu consentimento.
- **Sinais:** 30 dias. Só o último aviso de período tranquilo enviado é mantido por mais tempo, para não ser enviado duas vezes.
- **Previsões de pressão:** 2 dias. Elas ficam guardadas por célula de região e não estão ligadas a você.
- **Recibos de avisos:** 2 dias.
- **Verificações de posse do token:** até 2 horas.
- **Contagens de uso:** 30 dias.
- **As cópias no seu celular:** até você sair da conta, excluir a conta ou desinstalar o app. As mudanças ainda não enviadas quando você sai ficam no celular até você entrar de novo e elas serem enviadas. A conversa fica limitada às últimas 200 mensagens.
- **Registros de segurança do login** (o registro de logins do provedor, com o endereço IP): {{AUTH_LOG_RETENTION}}.

Cada destinatário guarda o que recebe conforme a tabela de [Quem trata seus dados](#processors). Backups: veja [Onde seus dados ficam guardados](#where-it-is-kept).

<a id="your-rights"></a>
## Seus direitos de titular e como exercê-los

Como titular dos dados, você tem direito a:

- **Confirmação e acesso:** saber se o Nimbo trata seus dados e receber uma cópia.
- **Correção:** corrigir dados incompletos, inexatos ou desatualizados.
- **Anonimização, bloqueio ou eliminação** de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD.
- **Portabilidade:** receber seus dados em um arquivo estruturado que você pode levar para outro lugar.
- **Eliminação** dos dados tratados com o seu consentimento.
- **Informação** sobre quem recebe seus dados.
- **Informação** sobre o que acontece se você não der um consentimento.
- **Revogação** do seu consentimento a qualquer momento.

No app:

- Edite qualquer crise, remédio ou check-in; apague uma crise ou uma dose (para corrigir uma dose, apague e registre de novo); arquive um remédio. Para apagar por completo seus remédios e check-ins, exclua sua conta ou escreva para o Nimbo.
- Veja e apague as notas do Nimbo em Perfil → “O que sei sobre você”.
- Ligue ou desligue a IA no Perfil.
- **Exportar meus dados** (Perfil → “Seus dados”) gera um arquivo JSON com os registros que o servidor guarda: o e-mail da sua conta, quando ela foi criada, seu último login e seus métodos de login, suas configurações (incluindo sua região aproximada), crises, remédios, doses, check-ins, as notas do Nimbo, sinais, registros de consentimento, status premium, contagens de uso e seus celulares registrados (tipo de celular e último registro; nunca o token de notificações). A conversa não entra: ela fica só no seu celular.
- **Excluir minha conta** (Perfil → “Seus dados”): veja [Excluir sua conta](#delete-your-account).

Por e-mail, escreva para [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) a partir do endereço da sua conta, para o Nimbo confirmar que é você. Os pedidos são gratuitos e respondidos em até 15 dias. Por exemplo, escreva para remover sua região aproximada, que o app não mostra depois da configuração.

**Tratamento automatizado.** As respostas do acompanhante e as regras dos sinais descrevem seus próprios registros. Elas nunca tomam uma decisão sobre você. Você pode pedir por e-mail uma explicação de como surgiu uma resposta ou um sinal, ou uma revisão humana.

**Reclamações.** Se você achar que seus dados estão sendo mal tratados, pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD) ou à autoridade de proteção de dados do seu país. Você também pode escrever antes para o Nimbo, que vai tentar resolver o problema.

<a id="delete-your-account"></a>
## Excluir sua conta

**No app:** Perfil → “Seus dados” → “Excluir minha conta”, e depois confirme. O Nimbo exclui na hora sua conta e cada linha que pertence a ela no servidor. Depois, apaga a cópia do seu celular (o diário, a fila de mudanças, a conversa, os caches, os lembretes e qualquer arquivo exportado) e encerra sua sessão. Se você usou Iniciar sessão com a Apple, também pode remover o Nimbo nos ajustes do seu ID Apple.

**Sem o app:** escreva para [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) a partir do endereço da sua conta e peça a exclusão. Sua conta e seus dados são excluídos em até 15 dias, e você recebe uma resposta quando estiver feito.

O que fica depois: o que cada destinatário recebeu, até terminar a própria retenção ([Quem trata seus dados](#processors)); os backups, conforme [Onde seus dados ficam guardados](#where-it-is-kept); e os registros de segurança do login, conforme [Por quanto tempo seus dados são mantidos](#retention).

<a id="security"></a>
## Segurança

O Nimbo protege seus dados com estas medidas:

- Conexões criptografadas entre o app e o servidor.
- Regras do banco de dados que deixam só a sua conta, com a sessão iniciada, ler suas linhas, e funções do servidor que verificam quem está chamando.
- Criptografia dos dados guardados pelo provedor de hospedagem.
- Nenhum texto de saúde nos registros do servidor, e só o neutro “Você tem uma nota do Nimbo” na tela bloqueada, a menos que você escolha os detalhes.
- As chaves da IA ficam no servidor; o celular nunca as tem.

Se um incidente de segurança puder causar risco ou dano relevante a você, o Nimbo comunica a ANPD e as pessoas afetadas.

<a id="not-medical-advice"></a>
## Não é orientação médica

O Nimbo não é um dispositivo médico. Ele registra e descreve o que você anota; nunca diz o que tomar nem quanto, e não diagnostica. Se você escrever ou falar um sinal de alerta, ele mostra como pedir ajuda urgente e o número de emergência do seu país. Sempre fale com um profissional de saúde antes de uma decisão médica.

<a id="changes"></a>
## Mudanças nesta política

Cada nova versão tem uma nova data no topo desta página. Se uma mudança afetar o que o Nimbo coleta, para quê, quem recebe, para onde vai ou quem é o controlador, o app mostra que os termos mudaram e pede o seu consentimento de novo antes de você continuar. Uma mudança no texto da IA desliga a IA no seu celular até você responder de novo.

As versões anteriores, quando houver, ficam publicadas em {{POLICY_URL}}history/.

<a id="contact"></a>
## Contato

Para dúvidas e pedidos, escreva para [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com). O controlador e o encarregado estão indicados em [Quem é o responsável](#controller).
