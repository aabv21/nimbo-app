<!-- Draft, not legal advice until a lawyer reviews it. `pnpm policy:check` lists the placeholders the owner fills before publishing. -->

# Política de privacidad de Nimbo

[English]({{POLICY_URL}}) · Español · [Português]({{POLICY_URL}}pt/)

Versión 2026-12-01 · Última actualización 2026-12-01

<a id="summary"></a>
## En resumen

Nimbo es un diario de migraña con un acompañante de IA opcional. Registra tus crisis, tus medicamentos y tus check-ins diarios, te los muestra y describe patrones en ellos. Nimbo no es un dispositivo médico: no diagnostica, no trata ni previene ninguna enfermedad, y no reemplaza a un profesional de la salud.

Esta página es el aviso de privacidad de Nimbo: explica qué datos recoge, para qué, dónde se guardan, quién los procesa, cuánto tiempo se conservan y cómo ejerces tus derechos. En resumen:

- Tus registros de migraña son datos de salud. Nimbo los guarda solo con tu consentimiento específico.
- El acompañante de IA es una segunda elección, aparte. Sin ella, nada va a un servicio de IA.
- Tus datos nunca se venden, nunca se usan para publicidad y nunca se analizan para otros. Nimbo no tiene anuncios, ni analítica, ni rastreo.
- Puedes exportar tus datos o eliminar tu cuenta desde la app en cualquier momento, o por correo.

Las preguntas van a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com).

<a id="controller"></a>
## Quién es responsable

El responsable de tus datos es {{CONTROLLER_NAME}}, {{CONTROLLER_COUNTRY}}, quien desarrolla y opera Nimbo. Contacto: [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com), que es también el medio para recibir notificaciones y solicitudes sobre tus datos.

El encargado de protección de datos (en Brasil, el “encarregado”) es {{DPO_NAME}}, en la misma dirección.

Nimbo se ofrece en {{LAUNCH_COUNTRIES}}. No se ofrece en el Espacio Económico Europeo, el Reino Unido ni Suiza.

Nimbo es para personas adultas. Antes de crear una cuenta confirmas que tienes 18 años o más. Nimbo no recoge a sabiendas datos de menores de 18 años; si una cuenta resulta ser de un menor, se elimina.

<a id="health-data-consent"></a>
## Tus datos de salud y tu consentimiento

> **Tus registros de migraña son datos de salud, una categoría sensible de datos personales.** Eso incluye tus crisis, tus medicamentos y dosis, tus check-ins (sueño, estrés, agua, cafeína, alcohol, comidas, pantallas y período), tus desencadenantes y notas, las respuestas de la configuración inicial sobre tus desencadenantes y prioridades, las notas de Nimbo sobre ti y las señales calculadas a partir de tus registros.
>
> **Nimbo los guarda solo con tu consentimiento específico y expreso**, que das en la pantalla “Antes de empezar” al marcar “Acepto que Nimbo guarde mis registros de migraña, medicamentos y check-ins, que son datos de salud, para mostrármelos y encontrar patrones.” Nimbo los usa solo para llevar tu diario, mostrártelo, calcular tus patrones y señales, avisarte del uso excesivo de medicamentos y recordarte tu medicamento preventivo.
>
> **El acompañante de IA es un segundo consentimiento, aparte**, en la pantalla “La IA de Nimbo y tus datos de salud”. Sin él, ninguno de tus datos va a un servicio de IA.
>
> **Qué significa decir que no.** Nimbo no puede llevar un diario sin guardarlo, así que sin el primer consentimiento no hay cuenta. Sin el segundo, Nimbo sigue siendo un registro completo, sin la pestaña Nimbo ni el dictado.
>
> **Cómo retirarlo.** Apaga “Usar la IA de Nimbo” en Perfil para detener al instante todo procesamiento con IA. Eliminar tu cuenta retira el primer consentimiento y borra tus datos.

Tus datos de salud nunca se venden, nunca se usan para publicidad ni minería de datos y nunca se comparten para obtener una ventaja económica.

<a id="what-we-collect"></a>
## Qué datos recoge Nimbo y para qué

Nimbo recoge solo lo que cada función necesita. Estas son las finalidades necesarias para darte el servicio; Nimbo no usa tus datos para ninguna finalidad secundaria, como publicidad o mercadotecnia. Para cada tipo de dato, qué es, cómo se recoge, para qué y si es obligatorio:

- **Tu cuenta.** Tu correo electrónico y una contraseña, que Supabase Auth guarda solo como hash. Si entras con Google, o con Apple en un iPhone, Nimbo recibe el token de identidad que ese servicio emite para ti, con tu correo. Sirve para iniciar sesión. Obligatorio.
- **Tus ajustes.** Tu idioma, tu zona horaria, la apariencia, el movimiento reducido, el horario y la cantidad diaria de avisos, si la pantalla bloqueada muestra detalles, y tus respuestas de la configuración inicial (tu prioridad, los desencadenantes que ya conoces y si registras tu período). Sirven para que la app funcione en tu idioma y tu hora, y para elegir el momento de las señales. Tú eliges cada uno.
- **Tu zona aproximada, solo si lo permites.** Durante la configuración, Nimbo puede leer tu ubicación una vez, con el permiso “mientras usas la app”, y la guarda redondeada a un decimal (una celda de unos 11 km de lado). Nunca guarda tu posición exacta, y en Android la app no puede pedir la ubicación precisa. Sirve solo para la señal de presión atmosférica. Opcional.
- **Tus crisis.** Cuándo empezó y terminó cada una, la intensidad de 0 a 10, dónde dolió, tus síntomas y desencadenantes, lo que probaste, lo que ayudó y lo que no, tus notas (hasta 2000 caracteres), si la registraste tocando, por voz o en el chat, y cuándo respondiste la revisión del día siguiente. Las escribes o tocas tú. Sirven para tu diario, el Historial, los patrones y el aviso de uso excesivo.
- **Tus medicamentos y dosis.** El nombre de cada medicamento, si es agudo o preventivo, su forma y su clase, el texto de dosis que escribes, el tiempo mínimo entre dosis, su horario y si lo archivaste; y de cada dosis, la hora, la crisis a la que pertenece y si ayudó. Sirven para tu botiquín, el aviso de uso excesivo, tus patrones y los recordatorios del preventivo.
- **Tus check-ins diarios.** La franja y la calidad de tu sueño, tu nivel de estrés, y si tomaste poca agua, tomaste cafeína de más, bebiste alcohol, te saltaste una comida, tuviste un día de muchas pantallas o empezó tu período. Los tocas tú. Sirven para tu diario y las señales.
- **Señales.** Razones breves que calcula el código de Nimbo a partir de tus propios registros y, si diste tu zona, del pronóstico de presión: por ejemplo una crisis larga, muchos días con medicamento en un mes o una noche corta. Son razones tomadas de tus registros, nunca predicciones, riesgos ni porcentajes.
- **El acompañante de IA, solo con tu consentimiento de IA.** Lo que recibe se describe en la sección siguiente, [La IA de Nimbo](#ai). El servidor guarda solo las notas breves de Nimbo sobre ti.
- **Tu voz, solo con la IA encendida y solo mientras mantienes presionado el micrófono.** Ver [La IA de Nimbo](#ai). Nimbo nunca graba ni guarda audio.
- **Avisos, solo si los permites.** El token de notificaciones de tu teléfono (la dirección a la que entregan los servicios de notificaciones), el tipo de teléfono (iPhone o Android), cuándo se registró por última vez y una huella de un código aleatorio creado en tu teléfono, para que solo ese teléfono pueda registrar o quitar su token. Si otra cuenta ya tiene el token de tu teléfono, Nimbo comprueba que tu teléfono lo recibe con un código de un solo uso enviado como notificación silenciosa; para esa comprobación el servidor guarda el token, tu cuenta y huellas del código hasta 1 hora. Para confirmar la entrega, el servidor guarda el número de recibo y el token de cada aviso durante 2 días.
- **Conteos de uso.** Cuántos mensajes al acompañante, revisiones de seguridad y mensajes dictados usaste cada día, para aplicar los límites diarios.
- **Registros de consentimiento.** Qué versión de esta política y del texto de la IA aceptaste o rechazaste, cuándo y en qué idioma, para probar tu consentimiento como exige la ley.
- **Estado premium.** Si tienes acceso premium, por una compra o por una concesión del responsable, y hasta cuándo.

El propio teléfono programa los recordatorios de tu medicamento preventivo. Un recordatorio muestra “Tienes una nota de Nimbo” salvo que actives los detalles en la pantalla bloqueada, y nada de él llega a un servidor.

Lo que Nimbo no recoge: tu ubicación exacta, tus contactos, tus fotos, identificadores de publicidad ni ningún dato mediante herramientas de analítica o rastreo. Nimbo no tiene anuncios, ni analítica, ni rastreo, y nunca vende tus datos.

### Bases legales

Nimbo se apoya en estas bases legales:

- **Tu consentimiento específico** (LGPD art. 11 I): tus datos de salud y, aparte, el acompañante de IA y su transferencia al exterior.
- **Tu consentimiento** (art. 7 I): tu zona aproximada y los avisos.
- **Prestar el servicio que pides** (art. 7 V): tu cuenta, el inicio de sesión y sus correos, tus ajustes y tu estado premium.
- **El interés legítimo en un servicio seguro** (art. 7 IX): las comprobaciones de propiedad del token, los recibos de avisos, los conteos de uso y los registros de seguridad del inicio de sesión.
- **Una obligación legal** (art. 7 II y art. 8 §2): los registros de consentimiento, que prueban tu consentimiento.

<a id="ai"></a>
## La IA de Nimbo

El acompañante de IA funciona solo si dices que sí en la pantalla “La IA de Nimbo y tus datos de salud”, y puedes apagarlo en Perfil cuando quieras. Apagado, nada va a un servicio de IA. Si este texto cambia, la IA queda apagada en tu teléfono hasta que leas la nueva versión y respondas de nuevo.

Cuando envías un mensaje, tu teléfono envía al servidor de Nimbo los turnos recientes de la conversación (hasta 12 mensajes cortos), el idioma de la app, tu fecha local y tu zona horaria, y si escribiste o dictaste. Para responder, el servidor puede leer datos de tus registros (fechas, intensidad, síntomas, desencadenantes, medicamentos, tus patrones y señales) y las notas de Nimbo sobre ti. Los envía a dos servicios, desde el servidor, nunca directamente desde tu teléfono:

- **Anthropic.** Claude escribe las respuestas. Cuando TypeSafe no está disponible, Claude también hace la revisión de seguridad.
- **TypeSafe.** Jev revisa tu mensaje y el borrador de respuesta en busca de señales de alarma y consejos inseguros.

Estos servicios nunca reciben tu nombre, tu correo, el id de tu cuenta, tu ubicación ni los ids de tus registros.

La conversación se guarda solo en tu teléfono, que conserva los últimos 200 mensajes. El servidor guarda solo las notas breves de Nimbo, las que ves en Perfil → “Lo que sé de ti”, donde puedes borrar cualquiera. Esas notas se quedan si apagas la IA, y puedes borrarlas ahí.

Las palabras de señal de alarma también se revisan en tu teléfono, en todos los idiomas y con la IA apagada. Si una coincide, Nimbo te muestra cómo pedir ayuda urgente y no envía nada.

El dictado usa el reconocedor de voz de tu propio teléfono. En un iPhone funciona por completo en el teléfono. En Android funciona en el teléfono cuando el paquete sin conexión del idioma está instalado; si no, el reconocedor predeterminado del teléfono, por lo general el de Google, puede recibir el audio para transcribirlo bajo sus propios términos. Solo las palabras resultantes llegan a Nimbo. Las respuestas habladas usan las voces de tu propio teléfono.

Anthropic y TypeSafe procesan estos datos en Estados Unidos. Ver [Transferencias internacionales](#transfers).

<a id="where-it-is-kept"></a>
## Dónde se guardan tus datos

Tu cuenta y tus registros se guardan en un proyecto de Supabase en {{DB_REGION}}. Cada fila pertenece a tu cuenta, y las reglas de seguridad de la base de datos permiten que solo tu cuenta, con la sesión iniciada, la lea. La app se comunica con el servidor por conexiones cifradas, y el proveedor de alojamiento cifra los datos guardados.

Tu teléfono guarda una copia de tu diario para que Nimbo funcione sin conexión, los cambios aún no enviados, la conversación con el acompañante y pequeñas cachés. Las copias de seguridad de Android de los datos de Nimbo están desactivadas.

{{BACKUPS}}.

<a id="processors"></a>
## Quién procesa tus datos

Estos servicios procesan datos por encargo de Nimbo, cada uno solo para la finalidad indicada y bajo términos que les exigen protegerlos. Nimbo llama a los servicios de IA y al servicio del clima desde su servidor, nunca desde tu teléfono.

| Destinatario | Qué recibe | Para qué | Dónde | Cuánto tiempo lo conserva |
|---|---|---|---|---|
| Supabase | Todo lo que se guarda en el servidor | Alojamiento: la base de datos, el inicio de sesión y las funciones del servidor | {{DB_REGION}} | Hasta que lo borres o elimines tu cuenta |
| Anthropic (Claude) | Con la IA encendida: los turnos de la conversación, datos de tus registros, las notas de Nimbo, el idioma, tu fecha local y tu zona horaria (como diferencia con UTC); el texto de la revisión de seguridad cuando TypeSafe no está disponible | Escribir las respuestas del acompañante; la revisión de seguridad de respaldo | Estados Unidos | Anthropic {{ANTHROPIC_RETENTION}}. No entrena sus modelos con estos datos |
| TypeSafe (Jev) | Con la IA encendida: tu mensaje, el borrador de respuesta y el contexto de señales de alarma | Revisar la seguridad de mensajes y respuestas | Estados Unidos | TypeSafe {{TYPESAFE_RETENTION}}. No entrena sus modelos con estos datos |
| Open-Meteo | Solo la celda de un decimal de tu zona, desde el servidor de Nimbo, nunca algo que te identifique | El pronóstico de presión atmosférica | Suiza | Sus registros del servidor web durante 90 días |
| Expo (notificaciones) | Con los avisos activados: el token de tu teléfono y el título de cada aviso, más la pantalla que abre; el título es “Tienes una nota de Nimbo” salvo que actives los detalles en la pantalla bloqueada, que añaden el texto de la señal; y, para comprobar que un teléfono recibe su token, un código de un solo uso en una notificación silenciosa | Entregar los avisos y la comprobación del token | Estados Unidos | Mientras sea razonablemente necesario; los recibos de entrega durante 1 día |
| Google (Firebase Cloud Messaging) y Apple (servicio de notificaciones) | El mismo aviso, desde Expo | Entregarlo a un teléfono Android o a un iPhone | Estados Unidos | Según sus propios términos |
| Google (reconocedor de voz, Android) | El audio mientras mantienes presionado el micrófono, cuando falta el paquete sin conexión del idioma | Convertir tu voz en texto | Servidores de Google | Según los términos de Google |
| Google y Apple (inicio de sesión) | Tu identidad de inicio de sesión, si los usas | Iniciar tu sesión | Estados Unidos | Según sus propios términos |
| {{EMAIL_PROVIDER}} | Tu correo y el código de confirmación o de restablecimiento | Enviar los correos de tu cuenta | Donde indiquen sus términos | Sus registros de envío durante {{EMAIL_LOG_RETENTION}} |

Cuando corriges o borras datos, Nimbo pide a los destinatarios que guardan una copia que hagan lo mismo, salvo que sea imposible. Sin venta, sin anuncios, sin analítica: nadie más recibe tus datos.

<a id="transfers"></a>
## Transferencias internacionales

Tu cuenta y tus registros se guardan en {{DB_REGION}}. Algunos servicios procesan datos en otros países:

- **Estados Unidos:** Anthropic y TypeSafe (con la IA encendida), Expo y los servicios de notificaciones de Google y Apple (con los avisos activados), y el reconocedor de voz de Google (dictado en Android sin el paquete sin conexión).
- **Suiza:** Open-Meteo, que recibe solo una celda de unos 11 km de lado y nada que te identifique.
- El proveedor de correo procesa tu correo donde indiquen sus términos.

Consientes estas transferencias de forma específica, sabiendo que son internacionales: en la pantalla de la IA (“Anthropic y TypeSafe procesan estos datos en Estados Unidos”) y en el paso de los avisos. Cuando un proveedor ofrece garantías contractuales, también se aplican; pide por correo una copia cuando exista.

<a id="retention"></a>
## Cuánto tiempo se conservan tus datos

Nimbo conserva cada tipo de dato solo el tiempo que su finalidad necesita:

- **Tus registros, notas, ajustes y estado premium:** hasta que los borres, donde la app lo permite (crisis, dosis y notas de Nimbo), o elimines tu cuenta. {{INACTIVE_ACCOUNTS}}.
- **El token de notificaciones de tu teléfono:** hasta que cierres sesión en ese teléfono, el token cambie, Expo informe que el teléfono ya no lo acepta o elimines tu cuenta.
- **Registros de consentimiento:** mientras exista tu cuenta, para probar tu consentimiento.
- **Señales:** 30 días. Solo el último aviso de racha tranquila enviado se conserva más, para no enviarlo dos veces.
- **Pronósticos de presión:** 2 días. Se guardan por celda de zona y no están vinculados a ti.
- **Recibos de avisos:** 2 días.
- **Comprobaciones de propiedad del token:** hasta 1 hora.
- **Conteos de uso:** 30 días.
- **Las copias de tu teléfono:** hasta que cierres sesión, elimines tu cuenta o desinstales la app. Los cambios aún no enviados al cerrar sesión se quedan en el teléfono hasta que vuelvas a entrar y se envíen. La conversación se limita a los últimos 200 mensajes.
- **Registros de seguridad del inicio de sesión** (el registro de inicios de sesión del proveedor, con la dirección IP): {{AUTH_LOG_RETENTION}}.

Cada destinatario conserva lo que recibe como indica la tabla de [Quién procesa tus datos](#processors). Copias de seguridad: ver [Dónde se guardan tus datos](#where-it-is-kept).

<a id="your-rights"></a>
## Tus derechos y cómo ejercerlos

Tienes derecho a:

- **Confirmación y acceso:** saber si Nimbo trata tus datos y obtener una copia.
- **Rectificación:** corregir datos incompletos, inexactos o desactualizados.
- **Anonimización, bloqueo o eliminación** de datos innecesarios, excesivos o tratados de forma ilícita.
- **Portabilidad:** obtener tus datos en un archivo estructurado que puedas llevar a otro lugar.
- **Eliminación** de los datos tratados con tu consentimiento.
- **Información** sobre quién recibe tus datos.
- **Información** sobre qué pasa si no das un consentimiento.
- **Revocación** de tu consentimiento en cualquier momento.

En México, esto incluye tus derechos ARCO (acceso, rectificación, cancelación y oposición) y la revocación del consentimiento.

En la app:

- Edita cualquier crisis, medicamento o check-in; borra una crisis o una dosis (para corregir una dosis, bórrala y regístrala de nuevo); archiva un medicamento. Para borrar por completo tus medicamentos y check-ins, elimina tu cuenta o escribe a Nimbo.
- Mira y borra las notas de Nimbo en Perfil → “Lo que sé de ti”.
- Enciende o apaga la IA en Perfil.
- **Exportar mis datos** (Perfil → “Tus datos”) te da un archivo JSON con los registros que guarda el servidor: el correo de tu cuenta, cuándo se creó, tu último inicio de sesión y tus métodos de inicio de sesión, tus ajustes, crisis, medicamentos, dosis, check-ins, las notas de Nimbo, señales, registros de consentimiento, estado premium, conteos de uso y tus teléfonos registrados (tipo de teléfono y último registro; nunca el token de notificaciones). La conversación no se incluye: vive solo en tu teléfono.
- **Eliminar mi cuenta** (Perfil → “Tus datos”): ver [Eliminar tu cuenta](#delete-your-account).

Por correo, escribe a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) desde la dirección de tu cuenta, para que Nimbo compruebe que eres tú. Indica qué derecho quieres ejercer y sobre qué datos. Las solicitudes son gratuitas y se responden en un plazo de 15 días. Por ejemplo, escribe para quitar tu zona aproximada, que la app no muestra después de la configuración.

**Tratamiento automatizado.** Las respuestas del acompañante y las reglas de las señales describen tus propios registros. Nunca toman una decisión sobre ti. Puedes pedir por correo una explicación de cómo surgió una respuesta o una señal, o una revisión humana.

**Reclamos.** Si crees que tus datos se tratan mal, puedes reclamar ante la autoridad de protección de datos de tu país: por ejemplo, la Superintendencia de Industria y Comercio (SIC) en Colombia, la Agencia de Acceso a la Información Pública (AAIP) en Argentina, la autoridad de protección de datos de México, la Agencia de Protección de Datos Personales de Chile cuando esté en funciones, o la Autoridade Nacional de Proteção de Dados (ANPD) en Brasil. También puedes escribir antes a Nimbo, que intentará resolver el problema.

<a id="delete-your-account"></a>
## Eliminar tu cuenta

**En la app:** Perfil → “Tus datos” → “Eliminar mi cuenta”, y luego confirma. Nimbo elimina al instante tu cuenta y cada fila que le pertenece en el servidor. Después borra la copia de tu teléfono (el diario, la cola de cambios, la conversación, las cachés, los recordatorios y cualquier archivo exportado) y cierra tu sesión. Si usaste Iniciar sesión con Apple, también puedes quitar Nimbo en los ajustes de tu Apple ID.

**Sin la app:** escribe a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com) desde la dirección de tu cuenta y pide la eliminación. Tu cuenta y tus datos se eliminan en un plazo de 15 días, y recibes una respuesta cuando esté hecho.

Lo que queda después: lo que recibió cada destinatario, hasta que termine su propia conservación ([Quién procesa tus datos](#processors)); las copias de seguridad, como indica [Dónde se guardan tus datos](#where-it-is-kept); y los registros de seguridad del inicio de sesión, como indica [Cuánto tiempo se conservan tus datos](#retention).

<a id="security"></a>
## Seguridad

Nimbo protege tus datos con estas medidas:

- Conexiones cifradas entre la app y el servidor.
- Reglas de la base de datos que permiten que solo tu cuenta, con la sesión iniciada, lea tus filas, y funciones del servidor que comprueban quién llama.
- Cifrado de los datos guardados por parte del proveedor de alojamiento.
- Ningún texto de salud en los registros del servidor, y solo el neutro “Tienes una nota de Nimbo” en la pantalla bloqueada salvo que elijas los detalles.
- Las claves de la IA se quedan en el servidor; el teléfono nunca las tiene.

Si un incidente de seguridad pudiera perjudicarte, Nimbo avisa a la ANPD y a las personas afectadas.

<a id="not-medical-advice"></a>
## No es consejo médico

Nimbo no es un dispositivo médico. Registra y describe lo que anotas; nunca te dice qué tomar ni cuánto, y no diagnostica. Si escribes o dices una señal de alarma, te muestra cómo pedir ayuda urgente y el número de emergencia de tu país. Consulta siempre a un profesional de la salud antes de una decisión médica.

<a id="changes"></a>
## Cambios en esta política

Cada nueva versión tiene una nueva fecha al inicio de esta página. Si un cambio afecta qué recoge Nimbo, para qué, quién lo recibe, adónde va o quién es responsable, la app te muestra que los términos cambiaron y te pide tu consentimiento de nuevo antes de seguir. Un cambio en el texto de la IA la apaga en tu teléfono hasta que respondas de nuevo.

Las versiones anteriores, cuando las haya, quedan publicadas en {{POLICY_URL}}history/.

<a id="contact"></a>
## Contacto

Para preguntas y solicitudes, escribe a [hello.aabv21@gmail.com](mailto:hello.aabv21@gmail.com). El responsable y el encargado de protección de datos se indican en [Quién es responsable](#controller).
