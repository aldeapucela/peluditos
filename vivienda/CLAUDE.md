# Invariantes de vivienda.aldeapucela.org

Reglas del proyecto. No son preferencias: si una tarea choca con una de ellas, se para la tarea y
se pregunta, no se busca la manera de saltarla.

1. **CERO DATOS PERSONALES.** Ningún nombre, DNI/NIE, correo, teléfono ni posición de lista de
   ninguna persona entra en `data/`, en el sitio ni en los logs. Los listados de admitidos y
   adjudicatarios se **enlazan** a la web oficial; no se descargan, no se guardan y no se parsean.
   `scripts/check-privacidad.mjs` corta el build si aparece cualquier indicio.

2. **CERO CONTENIDO INVENTADO.** Todo dato publicado sale de una fuente oficial identificada, con
   su URL, su fecha de captura y el `sha256` de lo que se leyó. Si no hay fuente, el campo es
   `null` y la web dice «no lo sabemos». Nunca se rellena un hueco por verosimilitud.

3. **ROBOTS ANTES QUE NADA.** `scripts/sync.mjs` lee `robots.txt` antes de cada tanda y aborta si
   una ruta deja de estar permitida. Estado comprobado el 13/08/2026: `tuyavivienda.es` permite el
   rastreo de sus páginas; `bocyl.jcyl.es` **prohíbe `/boletines/`**, así que de BOCYL solo se
   vigila el RSS y se enlaza. Ver `docs/fuentes.md`.

4. **NO SE DESCARGA NINGÚN PDF.** Ni los que no llevan datos personales. Si algún día hiciera
   falta, se discute antes y se documenta por qué.

5. **PRENSA ≠ FUENTE.** Un dato de prensa no se publica hasta confirmarlo en la ficha oficial, en
   BOCYL o en el boletín provincial.

6. **LOS DATOS SON REVISABLES.** `data/` se genera con un script determinista y sus cambios entran
   por commit legible. El historial de Git es la auditoría del proyecto: por eso el JSON va
   ordenado y con formato estable.

7. **LENGUAJE CLARO.** Se escribe para alguien de 24 años que no ha tramitado nada en su vida.
   Nada de «de conformidad con lo dispuesto en». Si una frase necesita un abogado, se reescribe.

8. **NO SOMOS LA ADMINISTRACIÓN.** La web dice en todas sus páginas que no es oficial y remite a
   SOMACYL y al boletín para cualquier trámite. Nunca se sugiere que aquí se pueda consultar un
   expediente.

9. **NINGUNA DIRECCIÓN DE CORREO EN EL REPOSITORIO.** El proyecto no guarda
   suscriptores. Quien quiere avisos marca lo suyo en su navegador (localStorage),
   se suscribe al calendario o al RSS, o se apunta a la lista de correo de la
   comunidad, que es quien gestiona altas y bajas. El notificador recibe el destino
   por variable de entorno, lo usa y lo olvida: no lo escribe en disco ni en los logs.

10. **NINGÚN PLAZO SIN FUENTE.** Las fechas de convocatorias y alegaciones las
    anota una persona leyendo el documento oficial, y `config/plazos.json` exige
    `fuente_url`. Un plazo mal puesto hace que alguien pierda una convocatoria:
    aquí no se estima, no se deduce y no se copia de la prensa.

11. **0 € DE INFRAESTRUCTURA.** GitHub Actions + GitHub Pages y nada más. Sin base de datos, sin
   servidor, sin servicios que puedan generar factura. Cualquier dependencia nueva se discute
   antes: hoy el proyecto no tiene ninguna.

12. **AMABLE CON LA FUENTE.** Una petición cada 2 segundos, una vez al día, con user-agent
    identificable y contacto. Si SOMACYL pide algo, se atiende primero y se discute después.

## Cómo trabajar aquí

- `npm test` antes de cualquier commit (self-test del parser + test de privacidad).
- El parser vive en `scripts/lib.mjs` y es puro: se prueba sin red, con `fixtures/`.
- Los textos de la web están en `docs/*.md` y en `scripts/build.mjs`; no hay CMS.
- Si la fuente cambia su HTML, se arregla el parser y se añade un caso al self-test. No se
  «apaña» el dato a mano en `data/`.
