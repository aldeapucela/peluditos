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
guarda solo los nuevos, descarga sus imágenes a `img/`, clasifica perro/gato/otro por el
texto y poda lo que tenga más de 45 días.

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
3. **Secret.** En el repo de GitHub: *Settings → Secrets and variables → Actions* →
   nuevo secret `IG_API_TOKEN` con el token.
4. **Pages.** *Settings → Pages* → *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
5. **Contacto.** Cambia el email de retirada en el pie de [`index.html`](index.html).

El workflow [`update.yml`](.github/workflows/update.yml) corre solo cada día; puedes
lanzarlo a mano desde la pestaña *Actions* (*Run workflow*).

## Desarrollo local

```bash
node scripts/fetch.mjs --self-test          # comprueba la lógica pura
IG_API_TOKEN=xxxx node scripts/fetch.mjs    # sincroniza de verdad
python3 -m http.server                      # sirve el sitio en localhost:8000
```

## Notas

- **Términos de Instagram:** leer cuentas ajenas sin permiso está en zona gris de sus
  términos. El uso aquí es vecinal y sin ánimo de lucro; enlazamos siempre al post original
  y ofrecemos un contacto de retirada. El proveedor asume la parte técnica.
- **Ajustar volumen:** `POSTS_PER_ACCOUNT` y `RETENTION_DAYS` en `scripts/fetch.mjs`.
- **Fuera de alcance (v1):** buscador de texto, filtro por zona, pre-render para SEO.
