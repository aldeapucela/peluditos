# Plan del proyecto · `vivienda.aldeapucela.org`

Adaptación del plan genérico *«tuya.aldeapucela.org»* (13/08/2026) a cómo se hacen realmente las
cosas en Aldea Pucela, y a lo que las fuentes permiten de verdad. Estado: **F0 y F1 hechas**,
código funcionando con datos reales; el resto, propuesto.

---

## 1. Qué cambia respecto al plan de partida, y por qué

El plan original era bueno, pero partía de dos supuestos que no se sostienen al comprobarlos, y de
un stack que no es el de la casa.

### 1.1 Los robots están al revés

El plan decía: *«tuyavivienda.es bloquea el acceso automatizado por robots.txt … un crawler es la
opción incorrecta aquí»* y proponía BOCYL como fuente automatizable.

Comprobado el 13/08/2026 (evidencia literal en [`docs/fuentes.md`](docs/fuentes.md)):

- `tuyavivienda.es/robots.txt` es el de WordPress por defecto: **solo bloquea `/wp-admin/`**.
  Permite pedir todas las páginas de contenido.
- `bocyl.jcyl.es/robots.txt` **prohíbe `/boletines/`, `/html/` y `/mhtml/`**: los PDF del boletín
  son justo lo que no se puede automatizar.

Esto cambia el proyecto entero: **no hace falta el circuito de voluntario que descarga PDF a mano**
(§4.1 del plan original) ni un CLI de ingesta local. La ingesta es automática, diaria, educada y
auditable, y de BOCYL solo se vigila el RSS (`https://bocyl.jcyl.es/rss.do`, verificado) enlazando
al documento sin descargarlo.

### 1.2 La fuente publica el dato que de verdad busca la gente

El plan asumía que el avance de la lista de reserva solo podía estimarse con **reportes
voluntarios** de la comunidad, y montaba para eso un Cloudflare Worker + D1 + Turnstile + cola de
moderación (§F4).

Resulta que la ficha oficial de cada promoción publica **una tabla con cada vivienda y su estado**:
`LIBRE`, `PRÓXIMAMENTE` u `OCUPADA`, con superficie y renta. Hoy lo hacen 10 de las 27 promociones
de Castilla y León.

Con eso, la pregunta «¿cómo va la lista?» tiene una respuesta objetiva y sin datos de nadie:
**guardar cada día cuántas viviendas están libres y ver cómo cambia**. Cuando una pasa de libre a
ocupada, la lista se ha movido. Es indirecto y así se cuenta, pero es un hecho verificable y no
una estimación a partir de lo que dice la gente en un formulario.

Consecuencia: **fuera el Worker, fuera la base de datos, fuera el captcha y fuera la moderación.**
El proyecto se queda en 0 € de verdad, sin servicios de terceros y sin datos personales que
custodiar. Si más adelante la comunidad quiere aportar información, el patrón de la casa ya existe:
Telegram + n8n, como en Peluditos (F5).

### 1.3 El stack es el de Aldea Pucela

El plan proponía Astro 5 + Tailwind + MapLibre + Cloudflare Pages + un CLI en Python con
`pdfplumber` y `pydantic`. La casa hace esto otro, y funciona:

| Capa | Plan original | Aquí | Por qué |
|---|---|---|---|
| Web | Astro 5 + Tailwind | HTML generado con Node, sin dependencias | Es lo que hace Peluditos; nada que actualizar ni que auditar. La web funciona sin JS. |
| Hosting | Cloudflare Pages | GitHub Pages | Es donde está todo lo demás de la comunidad. |
| Ingesta | CLI Python con voluntario | `scripts/sync.mjs`, Node sin dependencias, en Actions | Robots lo permite; el humano sobra en el circuito diario. |
| Reportes | Worker + D1 + Turnstile | No hacen falta (§1.2) | Menos superficie, menos riesgo, menos coste. |
| Datos | JSON en Git + JSON Schema | JSON en Git + parser determinista y tests | Sin dependencias: los `schemas/` los sustituye el propio generador más el test de privacidad. |
| Mapa | MapLibre GL | Aún no | 7 promociones en la provincia no necesitan un mapa. Cuando aporte algo, se añade. |

Lo que **no** cambia, porque era lo mejor del plan: cero datos personales, cero contenido inventado,
trazabilidad con `sha256` y fecha de captura, lenguaje claro y `git log` como auditoría.

### 1.4 El nombre

«TUYA» es marca de la Junta. El proyecto se llama **Vivienda**, como el resto de webs de la
comunidad (*eventos*, *negocios*, *fotos*, *contratos*, *peluditos*), y la referencia al programa
oficial va en el texto, no en la marca.

---

## 2. Qué hay hecho

- **F0 · Verificación de fuentes.** `docs/fuentes.md`: `robots.txt` literal de los tres dominios,
  RSS de BOCYL verificado, qué publica exactamente una ficha, la cláusula del aviso legal de
  SOMACYL y cómo se sitúa el proyecto frente a ella, y cinco preguntas abiertas.
- **F1 · Catálogo con datos reales.** Las **27 promociones** de Castilla y León (7 en la provincia
  de Valladolid) leídas de la fuente, con su tabla de viviendas cuando existe, sus documentos
  oficiales y la trazabilidad de cada dato en `data/fuentes.json`.
- **F2 · Web v1.** Portada con filtros, ficha por promoción con disponibilidad vivienda a vivienda
  e histórico, «cómo funciona» en lenguaje claro, datos abiertos, privacidad y fuentes. HTML
  estático: funciona sin JavaScript.
- **Guardarraíles.** `npm test` = self-test del parser (sin red) + test de privacidad que corta el
  build si aparece algo que parezca un nombre, un DNI, un correo o un teléfono, o si alguien
  descarga un listado nominal. Tres workflows: pruebas en cada PR, actualización diaria y
  despliegue.

Números del primer día (13/08/2026): 428 viviendas anunciadas en la provincia; 86 marcadas como
libres de las 101 que aparecen en tablas publicadas; 2 promociones con desfase entre las viviendas
anunciadas y las filas de su tabla (anotado como pregunta abierta, no «corregido»).

---

## 3. Fases siguientes

### F3 · Cronología por promoción
Hoy la ficha enlaza los documentos oficiales pero no los sitúa en el tiempo. Falta convertir cada
documento en un hito fechado (convocatoria, listado provisional, alegaciones, listado definitivo,
sorteo, adjudicación) para dibujar la línea temporal del plan original.
La fecha tiene que salir del propio documento o del boletín; **no se deduce del nombre del fichero**.
*Aceptación:* cada hito publicado tiene fecha con fuente; los que no la tengan, no se muestran.

### F4 · Vigilancia de BOCYL y del BOP
Perfil `vivienda` en el BOP Radar de la comunidad (términos: `SOMACYL`, `vivienda protegida`,
`viviendas colaborativas`, `arrendamiento` + municipios de la provincia) leyendo el RSS verificado.
Aviso al Telegram de Aldea Pucela y alta automática de la promoción nueva.
*Decisión pendiente:* extender el BOP Radar (recomendado) o replicar el módulo.
*Aceptación:* una convocatoria nueva en BOCYL genera aviso en menos de 24 h.

### F5 · Aportaciones de la comunidad
Solo si hace falta después de ver unos meses de histórico. Patrón de la casa: subtema en el grupo
de Telegram y un workflow de n8n que commitea, como `/webpeluditos` en Peluditos. Anónimo por
diseño: `{promocion, fecha, hecho}`, sin nombres ni posiciones de nadie. Nunca un formulario que
pida datos personales.

### F6 · Transparencia activa
Solicitud formal a SOMACYL al amparo de la Ley 19/2013 y la Ley 3/2015 de Castilla y León pidiendo:
(a) datos agregados de demanda por promoción —solicitudes presentadas, admitidas y excluidas por
causa—, y (b) publicación de la disponibilidad en formato reutilizable.
Coste: un formulario. Si sale bien, el proyecto deja de leer HTML y pasa a consumir un fichero, y
además publica **el dato que hoy no existe en ninguna parte**: cuánta gente pide cada promoción.

---

## 4. Decisiones para David

1. **Dominio y repositorio.** `vivienda.aldeapucela.org` + `aldeapucela/vivienda`. ¿Ok, o prefieres
   otro nombre? (El código no depende del nombre: está en dos constantes.)
2. **Alcance.** El sync ya captura toda Castilla y León porque cuesta lo mismo; la web enseña
   Valladolid por defecto. ¿Se deja así o se recorta a la provincia también en los datos?
3. **Matomo.** Está preparado y desactivado: falta un `siteId` en `stats.aldeapucela.org`.
4. **Aviso a SOMACYL.** Propongo escribirles **antes** de anunciar la web: contarles qué es, que se
   respeta su `robots.txt`, que no se tocan los listados con nombres, y de paso registrar la
   solicitud de transparencia de F6. Es más barato que enterarse por un burofax.
5. **BOP Radar:** ¿extender o replicar? (recomendación: extender).
6. **Cadencia del cron.** Ahora, una vez al día. Si la fuente actualiza sus tablas más a menudo de
   lo que parece, subirlo a dos veces cuesta lo mismo.
