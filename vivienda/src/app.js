// Único JS del sitio. Hace dos cosas y ninguna necesita servidor:
//   1. filtrar las tarjetas de la portada;
//   2. recordar en ESTE navegador qué promociones te interesan.
//
// Todo el contenido viene ya renderizado en el HTML, así que sin JavaScript la
// web sigue completa: se ven todas las promociones, sin filtrar y sin «lo tuyo».

(function () {
  var CLAVE = 'vivienda:seguidas';

  function seguidas() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || []; } catch (e) { return []; }
  }

  function guarda(lista) {
    try { localStorage.setItem(CLAVE, JSON.stringify(lista)); } catch (e) { /* modo privado */ }
  }

  function alterna(id) {
    var lista = seguidas();
    var i = lista.indexOf(id);
    if (i === -1) lista.push(id); else lista.splice(i, 1);
    guarda(lista);
    return lista;
  }

  // ---------- botones «me interesa» ----------
  var botones = [].slice.call(document.querySelectorAll('[data-seguir]'));
  function pintaBotones() {
    var lista = seguidas();
    botones.forEach(function (b) {
      var activo = lista.indexOf(b.dataset.seguir) !== -1;
      b.hidden = false;                       // sin JS no se enseña: no haría nada
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
      b.textContent = activo ? '★ La sigues' : 'Me interesa';
    });
  }
  botones.forEach(function (b) {
    b.addEventListener('click', function () { alterna(b.dataset.seguir); pintaBotones(); pintaTuyo(); });
  });
  pintaBotones();

  // ---------- bloque «lo que sigues» (solo en la portada) ----------
  var bloqueTuyo = document.getElementById('lo-tuyo');
  var listaTuyo = document.getElementById('tuyo-listado');
  var listado = document.getElementById('listado');

  function pintaTuyo() {
    if (!bloqueTuyo || !listaTuyo || !listado) return;
    var lista = seguidas();
    listaTuyo.innerHTML = '';
    var encontradas = 0;
    lista.forEach(function (id) {
      var tarjeta = listado.querySelector('.tarjeta [data-seguir="' + id.replace(/"/g, '') + '"]');
      if (!tarjeta) return;
      var copia = tarjeta.closest('.tarjeta').cloneNode(true);
      copia.hidden = false;
      var boton = copia.querySelector('[data-seguir]');
      if (boton) boton.remove();              // el original manda; en la copia estorba
      listaTuyo.appendChild(copia);
      encontradas++;
    });
    bloqueTuyo.hidden = encontradas === 0;
  }
  pintaTuyo();

  // ---------- filtros de la portada ----------
  if (!listado) return;
  var tarjetas = [].slice.call(listado.querySelectorAll('.tarjeta'));
  var vacio = document.getElementById('vacio');
  var filtros = { provincia: 'Valladolid', estado: 'todas' };

  var params = new URLSearchParams(location.search);
  if (params.get('provincia')) filtros.provincia = params.get('provincia');

  function aplica() {
    var visibles = 0;
    tarjetas.forEach(function (t) {
      var okProvincia = filtros.provincia === 'todas' || t.dataset.provincia === filtros.provincia;
      var okEstado =
        filtros.estado === 'todas' ||
        (filtros.estado === 'libres' && t.dataset.libres === 'si') ||
        (filtros.estado === 'sin-tabla' && t.dataset.libres === 'sin-tabla') ||
        (filtros.estado === 'seguidas' && seguidas().indexOf(t.querySelector('[data-seguir]') ? t.querySelector('[data-seguir]').dataset.seguir : '') !== -1);
      var visible = okProvincia && okEstado;
      t.hidden = !visible;
      if (visible) visibles++;
    });
    if (vacio) vacio.hidden = visibles > 0;
  }

  [].slice.call(document.querySelectorAll('.filtros button')).forEach(function (boton) {
    boton.addEventListener('click', function () {
      var clave = 'provincia' in boton.dataset ? 'provincia' : 'estado';
      filtros[clave] = boton.dataset[clave];
      [].slice.call(boton.parentElement.querySelectorAll('button')).forEach(function (hermano) {
        hermano.classList.toggle('activo', hermano === boton);
      });
      aplica();
    });
  });

  [].slice.call(document.querySelectorAll('.filtros [data-provincia]')).forEach(function (boton) {
    boton.classList.toggle('activo', boton.dataset.provincia === filtros.provincia);
  });

  aplica();
})();
