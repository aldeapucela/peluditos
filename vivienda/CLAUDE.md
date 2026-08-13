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

4. **SOLO SE DESCARGAN BOLETINES.** Se bajan los anuncios oficiales (`bocyl`, `bop`,
   `correccion`) alojados en `tuyavivienda.es` para leerles los plazos, y nada más. Los
   `listado_nominal` no se descargan jamás, ni «solo para mirar»: llevan nombres. El PDF se lee en
   memoria y no se guarda en el repositorio; de él solo queda la fecha, la regla del plazo, la cita
   literal y el `sha256`. Cualquier cita que dispare el detector de datos personales se descarta.

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

9. **NO HAY SUSCRIPTORES.** El proyecto no pide ni guarda correos, ni tiene cuentas, ni lista de
   distribución. Quien quiere avisos marca lo suyo en su navegador (queda en su equipo), se
   suscribe al calendario o al RSS. No se añade ningún canal que obligue a custodiar datos de
   nadie.

10. **NINGÚN PLAZO SIN CITA.** Toda fecha de plazo sale de la frase literal del boletín, que se
    guarda junto al plazo con el enlace al documento y su `sha256`. Si el plazo depende de un hecho
    sin fecha conocida, se publica la regla y el plazo se queda sin fecha: no se estima. Un plazo
    mal puesto hace que alguien pierda una convocatoria.

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
