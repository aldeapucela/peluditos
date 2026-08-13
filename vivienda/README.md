# 🏠 Vivienda

Seguimiento vecinal de las **promociones públicas de alquiler** (SOMACYL / Junta de Castilla y
León) en **Valladolid y provincia**: en qué punto está cada promoción, **cuántas viviendas quedan
libres** y qué documento oficial lo dice. Una web de la comunidad de
[Aldea Pucela](https://aldeapucela.org).

**En vivo:** <https://vivienda.aldeapucela.org> *(pendiente de desplegar)*

Sitio **estático** (HTML generado, sin framework y **sin ninguna dependencia**) que se construye a
partir de unos JSON generados a diario por un script Node, ejecutado por **GitHub Actions** y
servido por **GitHub Pages**.

## El problema que resuelve

Pides una vivienda pública, entras en el sorteo, te dan un número… y desapareces en la niebla. No
hay ninguna página que te diga si la lista va por el 3 o por el 300. La información existe, pero
está repartida entre fichas web, PDF sueltos y anuncios de boletín.

Esta web no puede consultar tu expediente —ni quiere—, pero sí puede hacer dos cosas útiles:

1. **Ordenar lo que ya es público** por promoción: estado, plazos, documentos oficiales y la tabla
   de viviendas con su estado (libre / próximamente / ocupada).
2. **Registrar cómo cambia esa tabla día a día.** Cuando una vivienda pasa de libre a ocupada, la
   lista se ha movido. Es una señal indirecta, pero es real, comprobable y no necesita el nombre
   de nadie.

## Cómo funciona

```
tuyavivienda.es (ficha pública de cada promoción)
        │
        ├─ scripts/sync.mjs   (cron diario, GitHub Actions)
        │     1. robots.txt   → comprueba que se puede pedir; si no, aborta
        │     2. sitemap      → las 27 fichas de promoción de Castilla y León
        │     3. parseo       → solo hechos: cifras, estados, m², renta, enlaces
        │     4. reparte      → data/promociones.json      (índice)
        │                       data/promociones/<id>.json (detalle, vivienda a vivienda)
        │                       data/historico.json        (serie: libres/ocupadas por día)
        │                       data/fuentes.json          (URL + sha256 + fecha de captura)
        │
        ├─ scripts/check-privacidad.mjs  → falla si algo parece un dato personal
        ├─ scripts/build.mjs             → dist/ (HTML estático, funciona sin JS)
        └─ commit + deploy → GitHub Pages
```

**Lo que nunca hace:** descargar un PDF. Los listados de admitidos y adjudicatarios llevan nombres
de personas: se enlazan a la web oficial y no se tocan. Ver [`docs/privacidad.md`](docs/privacidad.md)
y los [invariantes](CLAUDE.md).

## Las páginas

| Ruta | Qué es |
|---|---|
| `/` | Todas las promociones con su estado y cuántas viviendas quedan libres. Filtros por provincia y situación. |
| `/promocion/<id>/` | Ficha: disponibilidad vivienda a vivienda, histórico de ocupación, «¿en qué punto está mi solicitud?» y documentos oficiales. |
| `/como-funciona/` | Los pasos del proceso en lenguaje claro, de la convocatoria a la lista de reserva. |
| `/datos/` | Datos abiertos: los JSON, su licencia y cómo se generan. |
| `/fuentes/` · `/privacidad/` | De dónde sale cada dato y por qué no publicamos datos personales. |

## Estructura

| Ruta | Qué es |
|---|---|
| `scripts/sync.mjs` | Ingesta: robots + sitemap + fichas → `data/`. |
| `scripts/lib.mjs` | Parser puro y utilidades (robots, privacidad). Se prueba sin red. |
| `scripts/build.mjs` | Generador del sitio estático → `dist/`. |
| `scripts/check-privacidad.mjs` | Test que impide publicar cualquier cosa que parezca un dato personal. |
| `src/styles.css` · `src/app.js` | Hoja única y el único JS (filtra tarjetas; la web funciona sin él). |
| `data/` | Datos generados. Única fuente de verdad del sitio. |
| `config/` | Lo poco que se mantiene a mano: provincia de localidades que no son capital y nombres propios para los títulos. |
| `docs/` | Fuentes verificadas, política de privacidad y el proceso explicado. Se publican como páginas. |
| `fixtures/` | Dos fichas reales guardadas para probar el parser sin red. |

## Puesta en marcha

```bash
npm test                 # self-test del parser + test de privacidad (sin red)
npm run sync             # lee las fichas oficiales y regenera data/ (~1 min, 27 páginas)
npm run build            # genera dist/
npm run dev              # build + servidor en http://localhost:8000
node scripts/sync.mjs --fixtures   # reprocesa fixtures/, sin red
node scripts/sync.mjs --limite 3   # ingesta parcial, para probar
```

No hay `npm install`: el proyecto **no tiene dependencias**. Requiere Node 20+.

Para desplegar: *Settings → Pages → Source = GitHub Actions*, y el dominio propio con el fichero
[`CNAME`](CNAME). La analítica de Matomo está preparada en `scripts/build.mjs` pero desactivada
hasta que la comunidad asigne un `siteId`.

## Operación y mantenimiento

- **El cron** (`.github/workflows/update.yml`) corre una vez al día. Si `data/` cambia, commitea y
  despliega en la misma ejecución. GitHub retrasa o salta crons: para forzarlo, *Actions → Actualizar
  datos → Run workflow*.
- **Si la fuente cambia su HTML**, el sync avisará (promociones sin tabla o campos a `null`). Se
  arregla `scripts/lib.mjs` y se añade el caso al self-test; nunca se edita `data/` a mano.
- **Localidad nueva sin provincia:** el sync lo dice al final de la ejecución. Se añade a
  `config/localidades.json` a mano.
- **Añadir una provincia al alcance:** no hay que tocar nada. El sync ya captura toda Castilla y
  León; la portada filtra Valladolid por defecto y `?provincia=Burgos` muestra otra.

## Licencia y aviso

- **Código:** [AGPL-3.0-only](LICENSE).
- **Datos y contenidos del sitio:** [CC BY-SA 4.0](LICENSE-DATA) por Aldea Pucela. Son datos de
  hecho extraídos de fuentes oficiales, siempre enlazadas.
- Esta web **no es oficial** ni está asociada a SOMACYL ni a la Junta de Castilla y León. «TUYA» es
  una marca de la Junta y aquí solo se cita para decir de dónde sale la información.
