# De dónde salen los datos

Comprobado el **13 de agosto de 2026**. Todo lo que hay aquí se verificó pidiendo los ficheros
reales, no de memoria. Si algo cambia en origen, se corrige esta página y se anota la fecha.

## Las tres fuentes

| Fuente | Qué aporta | Se puede automatizar |
|---|---|---|
| `tuyavivienda.es` | Ficha pública de cada promoción: nº de viviendas, dirección, estado de obra, tabla de viviendas con su estado (LIBRE / PRÓXIMAMENTE / OCUPADA), renta y superficie, y enlaces a los documentos oficiales | **Sí**, su `robots.txt` lo permite |
| `bocyl.jcyl.es` | Convocatorias y acuerdos con validez jurídica | **Solo el RSS**: su `robots.txt` prohíbe `/boletines/` |
| `somacyl.es` | Notas y contacto de la sociedad pública que promueve | Sí, pero aporta poco frente a la ficha |

## Corrección importante al plan de partida

El plan original daba por hecho que `tuyavivienda.es` bloqueaba el rastreo automático y que BOCYL
era la fuente automatizable. **Es justo al revés.**

`https://tuyavivienda.es/robots.txt`, literal:

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

Sitemap: https://tuyavivienda.es/sitemap_index.xml
```

Es el `robots.txt` por defecto de WordPress: **permite pedir todas las páginas de contenido**.
`somacyl.es` publica exactamente el mismo.

`https://bocyl.jcyl.es/robots.txt` empieza así (67 KB, 1.346 líneas):

```
User-agent: *

Disallow: /boletines/
Disallow: /html/
Disallow: /mhtml/
```

Es decir: **los PDF del boletín están fuera del alcance de cualquier proceso automático**. El resto
del fichero son miles de líneas que bloquean documentos concretos, uno a uno, con su fecha —
lo que suele corresponder a peticiones de retirada de indexación.

Consecuencia práctica: la ingesta se apoya en la ficha de `tuyavivienda.es`, y de BOCYL solo se
vigila el sumario por RSS y se **enlaza** al documento, sin descargarlo.

## Endpoints verificados

- **Sitemap de promociones:** `https://tuyavivienda.es/post-sitemap.xml` — 27 fichas de promoción
  en toda Castilla y León (agosto de 2026), 7 de ellas en la provincia de Valladolid.
- **RSS de BOCYL:** `https://bocyl.jcyl.es/rss.do` — devuelve `text/xml` con el sumario del día
  («Boletín del día 13/08/2026 edición 156») y el enlace a cada disposición. Sirve para vigilar
  publicaciones nuevas de SOMACYL sin tocar `/boletines/`.
  El endpoint `https://bocyl.jcyl.es/rss` devuelve lo mismo.
- No existen `/sumario.do`, `/rss/ultimos.xml` ni `/rssBocyl.do`: responden HTTP 500.

## Qué publica exactamente la ficha de una promoción

Comprobado en la ficha de *59 viviendas en Los Viveros (Valladolid)*:

- Bloque **Información**: categoría (alquiler / venta), estado de la obra, número de viviendas,
  localidad y dirección.
- **Tabla de viviendas por portal**: identificador de la vivienda, estado (`libre`,
  `proximamente`, `ocupada`), habitaciones, superficie en m² y renta mensual en €.
  La publican 10 de las 27 promociones; el resto todavía no.
- **Documentos oficiales** enlazados: referencias de BOCYL y del Boletín Oficial de la Provincia,
  correcciones de errores, preguntas frecuentes, memorias de calidades, planos y —en las
  promociones ya resueltas— el **listado de adjudicatarios**.
- Metadatos de la propia página con la fecha de última modificación.

**Los listados de admitidos y adjudicatarios contienen nombres de personas.** Este proyecto los
enlaza a la web oficial y nunca los descarga ni los procesa: ver [privacidad](privacidad.md).

## Condiciones de reutilización

El [aviso legal de TUYA Vivienda](https://tuyavivienda.es/wp-content/uploads/2026/05/Aviso-legal-TUYA-Vivienda.pdf)
(SOMACYL, CIF A47600754) dice, literalmente, que el usuario se compromete a:

> No reproducir, copiar, distribuir, comunicar públicamente, transformar o modificar los
> contenidos, a menos que se cuente con la preceptiva autorización del titular de los
> correspondientes derechos **o ello resulte legalmente permitido**.

Cómo se sitúa este proyecto frente a esa cláusula:

- **No copiamos contenidos**: no reproducimos textos, fotos, planos ni PDF. Extraemos **datos de
  hecho** (cuántas viviendas hay, cuáles están libres, cuánto miden, qué renta tienen) y siempre
  enlazamos a la página original.
- SOMACYL es **sector público**, y la información administrativa que publica entra en el ámbito de
  la Ley 37/2007 de reutilización de la información del sector público y de la Ley 19/2013 de
  transparencia. Es el «legalmente permitido» de la propia cláusula.
- Aun así, esto no es un dictamen. Por eso la primera tarea del proyecto (F0) es **pedirlo por
  escrito**: una solicitud de acceso a la información pública a SOMACYL pidiendo (a) los datos
  agregados de demanda por promoción y (b) la publicación de la disponibilidad en formato
  reutilizable. Si sale bien, el proyecto deja de leer HTML y pasa a consumir un fichero.

## Los plazos se leen del boletín

Las fechas de los plazos no están en la ficha web: están dentro del anuncio oficial. Como esos
anuncios (BOCYL, BOP y sus correcciones) están alojados en `tuyavivienda.es`, que permite el
rastreo, el proyecto los descarga, les extrae el texto y busca la regla literal:

> «Los interesados dispondrán de un plazo máximo para presentar sus solicitudes […] que concluirá a
> los quince días naturales, contados desde el día siguiente a la publicación de este Acuerdo en el
> Boletín Oficial de la Provincia de Valladolid.»

La fecha de publicación del boletín va repetida en la cabecera de todas sus páginas («Número 2026/55
BOLETÍN OFICIAL DE LA PROVINCIA DE VALLADOLID · Viernes, 20 de marzo de 2026»), así que la regla se
convierte en una fecha exacta. Cuando el plazo se cuenta desde un hecho que todavía no ha ocurrido,
se publica la regla sin fecha.

Los PDF se leen en memoria y **no se guardan**. De cada uno queda su `sha256`, su fecha y las citas
literales. **Los listados con nombres no se descargan nunca**, tampoco para esto.

## Cómo pedimos las páginas

- Una petición cada **2 segundos**, una vez al día. Son 27 páginas: menos carga que un visitante
  cualquiera navegando.
- User-agent identificable y con contacto:
  `AldeaPucelaVivienda/1.0 (+https://vivienda.aldeapucela.org; proyecto vecinal sin ánimo de lucro)`.
- El script **lee `robots.txt` antes de cada tanda** y se detiene si alguna ruta deja de estar
  permitida. No es una promesa: está en el código (`scripts/sync.mjs`).
- De los PDF solo se descargan los boletines oficiales (una vez cada uno: ya leído, no se vuelve a
  pedir). Los listados con nombres, jamás.

## Preguntas abiertas

1. ¿Actualiza SOMACYL la tabla de viviendas con regularidad, o solo al cerrar cada procedimiento?
   Lo sabremos con unas semanas de histórico.
2. En dos promociones el número de viviendas anunciado no coincide con las filas de su tabla
   (Villalón de Campos: 19 vs 15; Valencia de Don Juan: 28 vs 17). ¿Fases distintas, tipologías no
   listadas, o un error de la ficha? Preguntar.
3. ¿Publica SOMACYL en algún sitio cuántas solicitudes recibió cada promoción? Es el dato que más
   ayudaría a la gente y no aparece en ninguna fuente pública encontrada.
4. ¿Hay forma de saber por dónde va la lista de reserva sin datos personales? Nuestra apuesta es
   deducirlo de cómo cambia la ocupación día a día; conviene contrastarlo con SOMACYL.
5. ¿El BOP de Valladolid (`bopva`) tiene RSS o API? Varias promociones publican ahí sus anuncios.
