# 🐾 Peluditos

Agrega en una sola página las publicaciones recientes de Instagram de las protectoras de
animales de Valladolid, para que quien busca adoptar no tenga que entrar en 10-15 cuentas
distintas. Un servicio de [Aldea Pucela](https://aldeapucela.org).

Sitio estático (HTML/CSS/JS vanilla) que lee un `data/posts.json` generado a diario por un
script Node sin dependencias, ejecutado por GitHub Actions. Se aloja en GitHub Pages.

## Cómo funciona

```
shelters.json → scripts/fetch.mjs (cron diario) → data/posts.json + img/ → GitHub Pages → navegador
```

El script pide a un servicio de datos de Instagram los últimos posts de cada cuenta,
guarda solo los nuevos, descarga sus imágenes a `img/`, clasifica cada post en
perro/gato/otro con Gemini (mirando la imagen **y** el texto) y poda lo que tenga más de 45 días.

## Puesta en marcha

1. **Cuentas.** Edita [`shelters.json`](shelters.json) con los `@usuario` **reales** de
   las protectoras (los de ejemplo hay que sustituirlos):
   ```json
   { "username": "usuario_ig", "name": "Nombre visible", "zone": "Valladolid",
     "instagramUrl": "https://www.instagram.com/usuario_ig/" }
   ```
2. **Servicio de datos.** Crea una cuenta en [Apify](https://apify.com) (capa gratuita,
   ~3.300 posts/mes) y copia tu API token. El código usa el actor `apify/instagram-scraper`;
   cambiar de proveedor = editar solo la función `fetchFromProvider` de `scripts/fetch.mjs`.
3. **Clasificación IA.** Crea una clave gratis en [Google AI Studio](https://aistudio.google.com/apikey)
   (Gemini, sin tarjeta). Se usa para clasificar perro/gato/otro; cambiar de IA = editar solo
   la función `classifyWithAI`. Si no pones clave, la web funciona igual pero sin categorías.
4. **Secrets.** En el repo de GitHub (*Settings → Secrets and variables → Actions*) crea dos
   secrets: `IG_API_TOKEN` (Apify) y `GEMINI_API_KEY` (Gemini).
5. **Pages.** *Settings → Pages* → *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
6. **Contacto.** Cada protectora gestiona sus adopciones con sus normas: el sitio enlaza a la
   publicación original de Instagram y no incluye un contacto genérico. Edita el pie de
   [`index.html`](index.html) si quieres cambiar ese texto.

El workflow [`update.yml`](.github/workflows/update.yml) corre solo cada día; puedes
lanzarlo a mano desde la pestaña *Actions* (*Run workflow*).

## Desarrollo local

```bash
node scripts/fetch.mjs --self-test          # comprueba la lógica pura
IG_API_TOKEN=xxx GEMINI_API_KEY=yyy node scripts/fetch.mjs   # sincroniza y clasifica
python3 -m http.server                      # sirve el sitio en localhost:8000
```

## Notas

- **Términos de Instagram:** leer cuentas ajenas sin permiso está en zona gris de sus
  términos. El uso aquí es vecinal y sin ánimo de lucro; enlazamos siempre al post original
  y el contacto para adopciones es directo con cada protectora. El proveedor asume la parte técnica.
- **Ajustar volumen:** `POSTS_PER_ACCOUNT` y `RETENTION_DAYS` en `scripts/fetch.mjs`.
- **Clasificación:** solo se clasifican los posts nuevos (una vez, y se guarda el resultado);
  el volumen cabe de sobra en el tier gratuito de Gemini. Modelo en `GEMINI_MODEL`.
- **Fuera de alcance (v1):** buscador de texto, filtro por zona, pre-render para SEO.
