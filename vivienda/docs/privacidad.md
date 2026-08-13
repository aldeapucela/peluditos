# Privacidad

Este proyecto **no guarda, no publica y no procesa datos personales de solicitantes ni de
adjudicatarios**. Ni nombres, ni DNI, ni posiciones de lista de nadie. No es una promesa vaga:
está escrito en el código y hay una prueba automática que impide publicar si aparece algo que lo
parezca.

## Por qué, si esos listados ya son públicos

Porque no es lo mismo. La Administración publica los listados en un sitio concreto, para una
finalidad concreta y durante un tiempo concreto. Si nosotros los copiamos, los ordenamos, los
hacemos buscables y los dejamos indexados para siempre, el efecto sobre esas personas es
completamente distinto del que tenía la publicación original: cualquiera podría buscar a una
persona por su nombre y saber que pidió una vivienda pública y por qué se la denegaron.

Eso, además de ser feo, es justo lo que la doctrina de la Agencia Española de Protección de Datos
sobre tablones y listas viene señalando desde hace años.

Nuestra regla es sencilla: **si un dato solo sirve para señalar a una persona concreta, no entra**.

## Qué recogemos exactamente

Hechos sobre edificios, no sobre personas:

- cuántas viviendas tiene cada promoción y cuántas están libres, ocupadas o próximamente
  disponibles, según la tabla de la web oficial;
- superficie, número de habitaciones y renta de cada vivienda;
- fechas, estados del procedimiento y **enlaces** a los documentos oficiales;
- la huella `sha256` de la página que leímos y el día en que la leímos, para que cualquiera pueda
  comprobar de dónde salió cada cifra.

## Qué no tocamos nunca

- **Los PDF con listados de admitidos, excluidos o adjudicatarios.** El programa los reconoce por
  su título, los marca como `listado_nominal` y se limita a enlazarlos. No los descarga, no los
  guarda y no los lee. De los boletines oficiales (BOCYL, BOP) sí se lee el texto —para sacar los
  plazos—, y aun así toda frase que se guarda pasa antes por el detector de datos personales. Si alguna vez alguien intentara añadir ese código, el test de privacidad
  haría fallar el despliegue.
- **Tu expediente.** No podemos consultarlo. Si quieres saber tu situación, el canal es SOMACYL.
- **Formularios de reporte con datos identificativos.** Si algún día la comunidad aporta
  información sobre cómo avanza una lista, será de forma anónima y agregada, y nunca con nombres,
  correos o números de expediente.

## Los avisos no crean una base de datos

Para que no se te pase un plazo hay que avisarte, y avisar suele significar guardar tu correo. Aquí
no:

- **«Me interesa»** guarda los identificadores de las promociones que sigues en el
  almacenamiento local de **tu navegador**. No viaja a ningún servidor, no hay cuenta y nadie —
  nosotros incluidos— puede saber qué sigues. Si borras los datos del navegador, se va.
- **Calendario y RSS** son ficheros estáticos que descarga tu programa: quien pide el fichero es tu
  móvil o tu lector, y nosotros no llevamos registro de quién lo hace.
- **No hay correo.** Se estudió mandar avisos por email y se descartó: obligaba a guardar
  direcciones o a mantener una lista, y con el calendario y el RSS se consigue lo mismo sin que
  nadie tenga que dejarnos ningún dato.

## Y de quien visita esta web

- No hay cuentas, ni registro, ni formularios, ni cookies de sesión.
- No hay publicidad ni rastreadores de terceros.
- Si en algún momento se activa la analítica de la comunidad
  ([Matomo](https://stats.aldeapucela.org) alojado por Aldea Pucela), será con la configuración
  habitual del resto de webs de la comunidad: sin vender datos a nadie y sin perfilar a nadie.
- La web es estática y está alojada en GitHub Pages, que registra peticiones como cualquier
  servidor.

## Si algo se nos ha colado

Escribe a la comunidad o abre una incidencia en
[el repositorio](https://github.com/aldeapucela/vivienda). Si aparece un dato personal donde no
debe, se quita primero y se discute después.
