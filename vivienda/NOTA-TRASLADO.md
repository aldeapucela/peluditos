# Nota: este proyecto va en su propio repositorio

Esta carpeta es un proyecto **independiente** de Peluditos. Está aquí solo porque la sesión en la
que se preparó tenía acceso únicamente al repositorio `aldeapucela/peluditos`.

Para llevarlo a su sitio (`aldeapucela/vivienda`):

```bash
# desde un clon de peluditos, en la rama claude/aldea-pucela-public-site-5z6e7l
cp -r vivienda /ruta/donde/quieras/vivienda
cd /ruta/donde/quieras/vivienda
rm NOTA-TRASLADO.md
git init && git add . && git commit -m "Primera versión"
git remote add origin git@github.com:aldeapucela/vivienda.git
git push -u origin main
```

Después, en el repositorio nuevo: *Settings → Pages → Source = **GitHub Actions*** y apuntar el
DNS de `vivienda.aldeapucela.org` a GitHub Pages (el fichero `CNAME` ya está).

Y en `peluditos`: borrar esta carpeta de la rama, que ahí no pinta nada.

Comprueba que todo sigue en verde antes de publicar:

```bash
npm test          # parser + privacidad, sin red
npm run sync      # relee las fichas oficiales (~1 min)
npm run dev       # build + http://localhost:8000
```
