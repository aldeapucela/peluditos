// Único JS del sitio: filtra las tarjetas de la portada. Todo el contenido ya
// viene renderizado en el HTML, así que sin JavaScript la web sigue completa
// (se ven todas las promociones, sin filtrar).

(function () {
  const listado = document.getElementById('listado');
  if (!listado) return;

  const tarjetas = [...listado.querySelectorAll('.tarjeta')];
  const vacio = document.getElementById('vacio');
  const filtros = { provincia: 'Valladolid', estado: 'todas' };

  const params = new URLSearchParams(location.search);
  if (params.get('provincia')) filtros.provincia = params.get('provincia');

  function aplica() {
    let visibles = 0;
    for (const t of tarjetas) {
      const okProvincia = filtros.provincia === 'todas' || t.dataset.provincia === filtros.provincia;
      const okEstado =
        filtros.estado === 'todas' ||
        (filtros.estado === 'libres' && t.dataset.libres === 'si') ||
        (filtros.estado === 'sin-tabla' && t.dataset.libres === 'sin-tabla');
      const visible = okProvincia && okEstado;
      t.hidden = !visible;
      if (visible) visibles++;
    }
    if (vacio) vacio.hidden = visibles > 0;
  }

  for (const boton of document.querySelectorAll('.filtros button')) {
    boton.addEventListener('click', () => {
      const clave = 'provincia' in boton.dataset ? 'provincia' : 'estado';
      filtros[clave] = boton.dataset[clave];
      for (const hermano of boton.parentElement.querySelectorAll('button')) {
        hermano.classList.toggle('activo', hermano === boton);
      }
      aplica();
    });
  }

  // Marca el botón que corresponda si se llegó con ?provincia= en la URL.
  for (const boton of document.querySelectorAll('.filtros [data-provincia]')) {
    boton.classList.toggle('activo', boton.dataset.provincia === filtros.provincia);
  }

  aplica();
})();
