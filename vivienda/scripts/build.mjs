#!/usr/bin/env node
// Genera el sitio estático en dist/ a partir de data/. Sin dependencias y sin
// red: todo el contenido informativo se sirve como HTML ya renderizado, así
// que la web funciona sin JavaScript (el JS solo filtra tarjetas).
//
//   node scripts/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minusculiza } from './lib.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');
// Dónde se publica. Por defecto, el dominio propio; con BASE_PATH y SITIO_URL
// el mismo build vale para GitHub Pages en una subcarpeta
// (aldeapucela.github.io/vivienda) mientras el DNS no esté listo.
const SITIO = (process.env.SITIO_URL ?? 'https://vivienda.aldeapucela.org').replace(/\/+$/, '');
const BASE = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
const MATOMO_SITE_ID = null; // se rellena cuando Aldea Pucela dé el id en stats.aldeapucela.org
const PROVINCIA_POR_DEFECTO = 'Valladolid';

const indice = json('data/promociones.json');
const NOMBRES_PROPIOS = json('config/estilo.json', { nombres_propios: [] }).nombres_propios ?? [];
const historico = json('data/historico.json', { registros: [] });
const avisos = json('data/avisos.json', { avisos: [] }).avisos ?? [];
// Los plazos salen de los boletines (data/plazos.json) y config/plazos.json
// solo sirve para corregir a mano lo que la extracción haga mal.
const PLAZOS = mezcla(
  json('data/plazos.json', { plazos: [] }).plazos ?? [],
  (json('config/plazos.json', { plazos: [] }).plazos ?? []).filter((z) => z.fuente_url));

function mezcla(automaticos, manuales) {
  const pisados = new Set(manuales.map((z) => `${z.promocion_id}:${z.tipo}`));
  return [
    ...manuales.map((z) => ({ ...z, origen: 'manual' })),
    ...automaticos.filter((z) => !pisados.has(`${z.promocion_id}:${z.tipo}`)),
  ];
}
const promociones = indice.promociones ?? [];
const HOY = new Date().toISOString().slice(0, 10);

// En modo `--single` se genera además un único HTML autocontenido con todas las
// páginas dentro (vista previa compartible mientras no hay dominio).
const SOLO_UNA = process.argv.includes('--single');
const paginas = [];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

escribe('index.html', paginaPortada());
for (const p of promociones) {
  escribe(`promocion/${p.id}/index.html`, paginaPromocion(json(`data/promociones/${p.id}.json`)));
}
escribe('como-funciona/index.html', paginaDoc('docs/proceso.md', 'Cómo funciona el proceso', '/como-funciona/'));
escribe('privacidad/index.html', paginaDoc('docs/privacidad.md', 'Privacidad', '/privacidad/'));
escribe('fuentes/index.html', paginaDoc('docs/fuentes.md', 'De dónde salen los datos', '/fuentes/'));
escribe('datos/index.html', paginaDatos());
escribe('avisos/index.html', paginaAvisos());
escribe('avisos.xml', feedRss(avisos.slice(0, 50), 'Avisos de vivienda pública en Valladolid', '/avisos.xml'));
escribe('plazos.ics', calendario(PLAZOS));
for (const p of promociones) {
  const suyos = avisos.filter((a) => a.promocion_id === p.id).slice(0, 30);
  escribe(`promocion/${p.id}/avisos.xml`, feedRss(suyos, `Avisos · ${p.nombre}`, `/promocion/${p.id}/avisos.xml`));
  const plazos = PLAZOS.filter((z) => z.promocion_id === p.id);
  if (plazos.length) escribe(`promocion/${p.id}/plazos.ics`, calendario(plazos));
}
escribe('404.html', pagina404());
escribe('sitemap.xml', sitemap());
escribe('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITIO}/sitemap.xml\n`);

copia('src/styles.css', 'styles.css');
copia('src/app.js', 'app.js');
copiaDir('data', 'data');
copia('.nojekyll', '.nojekyll');
// El CNAME solo se publica cuando el dominio propio ya apunta aquí: si se sube
// antes, GitHub Pages deja de servir en la URL de github.io y la web «desaparece».
if (process.env.DOMINIO_PROPIO === '1' && existe('CNAME')) copia('CNAME', 'CNAME');

console.log(`✔ dist/ generado: ${promociones.length} fichas · ${PLAZOS.length} plazos · ${avisos.length} avisos`);

if (SOLO_UNA) {
  escribe('vista-previa.html', unaSolaPagina());
  console.log('✔ dist/vista-previa.html: todo el sitio en un único fichero');
}

// ------------------------------------------------------------- plantillas ----

function layout({ titulo, descripcion, ruta, cuerpo, activo = '' }) {
  if (SOLO_UNA) paginas.push({ titulo, ruta, cuerpo });
  const t = `${titulo} · Vivienda pública en Valladolid`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${SITIO}${ruta}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Vivienda · Aldea Pucela">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${SITIO}${ruta}">
<link rel="stylesheet" href="/styles.css">
${matomo()}</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="topbar">
  <div class="container topbar__inner">
    <a class="marca" href="/">
      <span class="marca__kicker">Aldea Pucela</span>
      <span class="marca__titulo">Vivienda</span>
    </a>
    <nav class="menu" aria-label="Menú principal">
      <a href="/"${activo === 'inicio' ? ' aria-current="page"' : ''}>Promociones</a>
      <a href="/como-funciona/"${activo === 'como' ? ' aria-current="page"' : ''}>Cómo funciona</a>
      <a href="/avisos/"${activo === 'avisos' ? ' aria-current="page"' : ''}>Avisos</a>
      <a href="/datos/"${activo === 'datos' ? ' aria-current="page"' : ''}>Datos</a>
      <a href="https://aldeapucela.org" rel="noopener">Comunidad</a>
    </nav>
  </div>
</header>
<main id="contenido" class="container">
${cuerpo}
</main>
<footer class="pie">
  <div class="container">
    <p><strong>Esta web no es oficial.</strong> Es un proyecto vecinal de la comunidad de
      <a href="https://aldeapucela.org" rel="noopener">Aldea Pucela</a> que ordena información ya publicada por
      <a href="https://tuyavivienda.es" rel="noopener">tuyavivienda.es</a> (SOMACYL, Junta de Castilla y León).
      Para cualquier trámite, la fuente válida es la oficial y el BOCYL.</p>
    <p class="fino">No publicamos datos personales de solicitantes ni adjudicatarios:
      <a href="/privacidad/">por qué y cómo</a>. ·
      <a href="/fuentes/">De dónde salen los datos</a> ·
      <a href="/datos/">Datos abiertos</a></p>
    <p class="fino">Código <a href="https://github.com/aldeapucela/vivienda" rel="noopener">AGPL-3.0</a> ·
      Datos <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.es" rel="noopener">CC BY-SA 4.0</a> ·
      Hecho por vecinas y vecinos voluntarios</p>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

/** Plazos que aún no han terminado, del más urgente al más lejano. */
function plazosVivos(idPromocion = null) {
  return PLAZOS
    .filter((z) => (!idPromocion || z.promocion_id === idPromocion))
    .filter((z) => z.fin && dias(HOY, z.fin) >= 0)
    .sort((a, b) => a.fin.localeCompare(b.fin));
}

/** Plazos que dependen de un hecho cuya fecha no consta: se enseña la regla. */
function plazosSinFecha(idPromocion) {
  return PLAZOS.filter((z) => z.promocion_id === idPromocion && !z.fin);
}

function plazosPasados(idPromocion) {
  return PLAZOS.filter((z) => z.promocion_id === idPromocion && z.fin && dias(HOY, z.fin) < 0)
    .sort((a, b) => b.fin.localeCompare(a.fin));
}

function dias(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function cuentaAtras(z) {
  if (!z.fin) return 'Depende de una fecha que aún no consta';
  const quedan = dias(HOY, z.fin);
  if (quedan < 0) return `Cerrado el ${z.fin}`;
  if (quedan === 0) return 'Termina HOY';
  if (quedan === 1) return 'Queda 1 día';
  return `Quedan ${quedan} días`;
}

function bloquePlazos(lista, { titulo = 'Plazos abiertos', conPromocion = true, cerrados = false } = {}) {
  if (!lista.length) return '';
  return `<section class="bloque bloque--plazos">
    <h2>${esc(titulo)}</h2>
    <ul class="plazos">
${lista.map((z) => plazoHtml(z, conPromocion, cerrados)).join('\n')}
    </ul>
    <p class="fino">${cerrados ? 'Plazos ya cerrados, para poder reconstruir la cronología.'
      : 'Fechas sacadas del propio boletín oficial: se cuenta el plazo que fija el documento desde el día en que se publicó. Si hay discrepancia, manda el documento.'}
       <a href="/avisos/">Cómo te avisamos con tiempo →</a></p>
  </section>`;
}

function plazoHtml(z, conPromocion, cerrado) {
  const quedan = z.fin ? dias(HOY, z.fin) : null;
  const clase = cerrado ? 'pasado' : quedan != null && quedan <= 3 ? 'urge' : 'normal';
  return `      <li class="plazo plazo--${clase}">
        <p class="plazo__cuenta">${esc(cuentaAtras(z))}</p>
        <p class="plazo__que">${esc(z.titulo ?? 'Plazo')}${conPromocion ? ` · ${esc(nombrePromocion(z.promocion_id))}` : ''}</p>
        ${z.regla ? `<p class="fino">${esc(`${z.regla.cantidad} días ${z.regla.unidad}${
          z.regla.ancla_texto ? ` desde el día siguiente a ${z.regla.ancla_texto}` : ''}${
          z.regla.desde ? `, que fue el ${z.regla.desde}` : ''}.`)}${
          z.regla.unidad === 'habiles' ? ' <strong>Ojo:</strong> al contar días hábiles no sabemos los festivos locales; comprueba el documento.' : ''}</p>` : ''}
        ${z.cita ? `<details class="cita"><summary>Lo que dice el documento</summary><blockquote>${esc(z.cita)}</blockquote></details>` : ''}
        <p class="fino"><a href="${esc(z.fuente_url)}" rel="noopener nofollow">${esc(z.fuente_ref ?? 'Documento oficial')}</a>
          · ${z.origen === 'manual' ? 'corregido a mano por la comunidad' : `leído automáticamente del documento el ${esc(z.extraido ?? '')}`}</p>
      </li>`;
}

function nombrePromocion(id) {
  const p = promociones.find((x) => x.id === id);
  return p ? minusculiza(p.nombre, [...NOMBRES_PROPIOS, p.localidad, p.provincia]) : id;
}

function paginaPortada() {
  const deValladolid = promociones.filter((p) => p.provincia === PROVINCIA_POR_DEFECTO);
  const conTabla = deValladolid.filter((p) => p.disponibilidad?.publicada);
  const libres = suma(conTabla.map((p) => p.disponibilidad.libres));
  const totalTabla = suma(conTabla.map((p) => p.disponibilidad.total));
  const viviendas = suma(deValladolid.map((p) => p.n_viviendas ?? 0));

  const cuerpo = `
<section class="hero">
  <h1>Vivienda pública de alquiler en Valladolid</h1>
  <p class="hero__sub">En qué punto está cada promoción, cuántas viviendas quedan libres y qué documento oficial
     lo dice. Sin buscar entre PDF.</p>
  <dl class="cifras">
    <div><dt>Promociones en la provincia</dt><dd>${deValladolid.length}</dd></div>
    <div><dt>Viviendas anunciadas</dt><dd>${viviendas || '—'}</dd></div>
    <div><dt>Libres ahora mismo</dt><dd>${conTabla.length ? `${libres} <span class="de">de ${totalTabla}</span>` : '—'}</dd></div>
  </dl>
  <p class="fino">Datos leídos de la ficha oficial de cada promoción el ${esc(indice.actualizado)}.
     «Libres» son las viviendas que la web oficial marca como <em>LIBRE</em> en su tabla; solo algunas promociones
     la publican todavía.</p>
</section>

${bloquePlazos(plazosVivos())}

<section class="bloque bloque--tuyo" id="lo-tuyo" hidden>
  <h2>Lo que sigues</h2>
  <p class="fino">Marcado en este navegador. No sale de aquí: ni cuentas, ni correo, ni servidor.</p>
  <ul class="tarjetas" id="tuyo-listado"></ul>
</section>

<section class="filtros" aria-label="Filtros">
  <div class="filtros__grupo" role="group" aria-label="Provincia">
    <button type="button" data-provincia="Valladolid" class="activo">Valladolid</button>
    <button type="button" data-provincia="todas">Toda Castilla y León</button>
  </div>
  <div class="filtros__grupo" role="group" aria-label="Situación">
    <button type="button" data-estado="todas" class="activo">Todas</button>
    <button type="button" data-estado="libres">Con viviendas libres</button>
    <button type="button" data-estado="sin-tabla">Aún sin tabla</button>
  </div>
</section>

<ul class="tarjetas" id="listado">
${ordenadas(promociones).map(tarjeta).join('\n')}
</ul>
<p class="vacio" id="vacio" hidden>No hay promociones con ese filtro.</p>

${ultimosAvisos()}
`;
  return layout({
    titulo: 'Promociones',
    descripcion: 'Seguimiento vecinal de las promociones públicas de alquiler joven (SOMACYL) en Valladolid: estado, viviendas libres y documentos oficiales.',
    ruta: '/', cuerpo, activo: 'inicio',
  });
}

/** Primero lo que le sirve a quien busca casa: promociones con viviendas libres. */
function ordenadas(lista) {
  const prioridad = (p) => {
    const d = p.disponibilidad ?? {};
    if (d.publicada && d.libres > 0) return 0;
    if (!d.publicada) return 1;
    return 2;
  };
  return lista.slice().sort((a, b) =>
    prioridad(a) - prioridad(b) ||
    (a.localidad ?? '').localeCompare(b.localidad ?? '', 'es') ||
    (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'));
}

function tarjeta(p) {
  const d = p.disponibilidad ?? {};
  const clase = d.publicada ? (d.libres > 0 ? 'libre' : 'completa') : 'pendiente';
  const etiqueta = d.publicada
    ? (d.libres > 0 ? `${d.libres} libres de ${d.total}` : `Sin viviendas libres (${d.total})`)
    : 'Aún sin tabla de viviendas';
  return `  <li class="tarjeta" data-provincia="${esc(p.provincia ?? '')}" data-libres="${d.publicada ? (d.libres > 0 ? 'si' : 'no') : 'sin-tabla'}">
    <article>
      <p class="tarjeta__lugar">${esc(p.localidad ?? '')}${p.provincia && p.provincia !== p.localidad ? ` <span class="fino">(${esc(p.provincia)})</span>` : ''}</p>
      <h2><a href="/promocion/${esc(p.id)}/">${esc(minusculiza(p.nombre, [...NOMBRES_PROPIOS, p.localidad, p.provincia]))}</a></h2>
      <p class="estado estado--${clase}">${esc(etiqueta)}</p>
      ${botonSeguir(p.id)}
      <ul class="tarjeta__datos">
        ${p.n_viviendas ? `<li>${p.n_viviendas} viviendas</li>` : ''}
        ${p.categoria ? `<li>${esc(p.categoria)}</li>` : ''}
        ${p.estado_obra ? `<li>Obra: ${esc(p.estado_obra.toLowerCase())}</li>` : ''}
        ${p.estado_procedimiento ? `<li>Procedimiento ${esc(p.estado_procedimiento)}</li>` : ''}
      </ul>
    </article>
  </li>`;
}

function paginaPromocion(p) {
  const d = p.disponibilidad ?? {};
  const serie = (historico.registros ?? []).filter((r) => r.promocion_id === p.id);
  const desfase = p.n_viviendas && d.total && p.n_viviendas !== d.total;

  const cuerpo = `
<nav class="miga"><a href="/">Promociones</a> › <span>${esc(p.localidad ?? '')}</span></nav>
<article class="ficha">
  <header>
    <p class="tarjeta__lugar">${esc([...new Set([p.localidad, p.provincia].filter(Boolean))].join(' · '))}</p>
    <h1>${esc(minusculiza(p.nombre, [...NOMBRES_PROPIOS, p.localidad, p.provincia]))}</h1>
    ${p.direccion ? `<p class="direccion">${esc(p.direccion)}</p>` : ''}
  </header>

  <section class="bloque">
    <h2>Viviendas libres</h2>
    ${d.publicada ? `
    <dl class="cifras cifras--ficha">
      <div class="es-libre"><dt>Libres</dt><dd>${d.libres}</dd></div>
      <div><dt>Próximamente</dt><dd>${d.proximamente}</dd></div>
      <div><dt>Ocupadas</dt><dd>${d.ocupadas}</dd></div>
      <div><dt>En la tabla</dt><dd>${d.total}</dd></div>
    </dl>
    ${desfase ? `<p class="aviso">La ficha oficial anuncia ${p.n_viviendas} viviendas pero su tabla detalla ${d.total}.
       No sabemos por qué: lo dejamos tal cual lo publica la fuente.</p>` : ''}
    ${tablaViviendas(p.viviendas)}
    ${serie.length > 1 ? historicoHtml(serie) : `<p class="fino">Empezamos a registrar los cambios de ocupación el ${esc(serie[0]?.fecha ?? p.capturado)}. Cada día que cambie algo, quedará anotado aquí.</p>`}
    ` : `<p class="aviso">La web oficial todavía no publica la tabla de viviendas de esta promoción, así que no
       podemos decir cuántas quedan libres. En cuanto la publique, aparecerá aquí sola.</p>`}
  </section>

  ${bloquePlazos(plazosVivos(p.id), { titulo: 'Plazos abiertos', conPromocion: false })}
  ${bloquePlazos(plazosSinFecha(p.id), { titulo: 'Plazos que dependen de lo que pase antes', conPromocion: false })}
  ${bloquePlazos(plazosPasados(p.id), { titulo: 'Plazos ya cerrados', conPromocion: false, cerrados: true })}

  <section class="bloque bloque--seguir">
    <h2>Que no se te pase</h2>
    ${botonSeguir(p.id, 'grande')}
    <ul class="docs">
      <li><a href="/promocion/${esc(p.id)}/avisos.xml">Avisos de esta promoción por RSS</a>
        <p class="fino">Para leerlo con tu lector de siempre o enchufarlo a Telegram.</p></li>
      ${plazosVivos(p.id).length ? `<li><a href="/promocion/${esc(p.id)}/plazos.ics">Plazos en tu calendario (.ics)</a>
        <p class="fino">Tu móvil te avisa 14, 7, 3 y 1 días antes del cierre.</p></li>` : ''}
      <li><a href="/avisos/">Cómo funcionan los avisos</a></li>
    </ul>
  </section>

  ${avisosDe(p.id)}

  <section class="bloque">
    <h2>¿En qué punto está mi solicitud?</h2>
    ${situacion(p, d)}
    <p><a href="/como-funciona/">Ver el proceso completo, paso a paso →</a></p>
  </section>

  <section class="bloque">
    <h2>Documentos oficiales</h2>
    ${p.documentos.length ? `<ul class="docs">
      ${p.documentos.map(documentoHtml).join('\n      ')}
    </ul>` : '<p class="fino">La ficha oficial no enlaza documentos todavía.</p>'}
  </section>

  <section class="bloque bloque--fuente">
    <h2>De dónde sale esto</h2>
    <ul class="fino">
      <li>Fuente: <a href="${esc(p.url_oficial)}" rel="noopener nofollow">ficha oficial en tuyavivienda.es</a></li>
      <li>Leída el ${esc(p.capturado)}${p.actualizado_fuente ? ` · la fuente dice haberla actualizado el ${esc(p.actualizado_fuente.slice(0, 10))}` : ''}</li>
      <li>Huella sha256 de la página leída: <code>${esc((p.sha256_pagina ?? '').slice(0, 16))}…</code></li>
    </ul>
  </section>
</article>
`;
  return layout({
    titulo: minusculiza(p.nombre, [...NOMBRES_PROPIOS, p.localidad, p.provincia]) || 'Promoción',
    descripcion: `${p.n_viviendas ?? ''} viviendas públicas en ${p.localidad ?? ''}: estado, viviendas libres y documentos oficiales.`,
    ruta: `/promocion/${p.id}/`, cuerpo,
  });
}

function tablaViviendas(viviendas = []) {
  if (!viviendas.length) return '';
  const filas = viviendas.map((v) => `      <tr class="v-${esc(v.estado ?? 'sin-dato')}">
        <td>${esc([v.portal, v.piso].filter(Boolean).join(' · '))}</td>
        <td>${etiquetaEstado(v.estado)}</td>
        <td class="num">${v.habitaciones ?? '—'}</td>
        <td class="num">${v.m2 != null ? `${v.m2.toString().replace('.', ',')} m²` : '—'}</td>
        <td class="num">${v.precio_eur_mes != null ? `${v.precio_eur_mes} €` : '—'}</td>
      </tr>`).join('\n');
  return `<div class="tabla-scroll">
    <table class="tabla">
      <caption class="fino">Cada vivienda, tal y como la publica la web oficial.</caption>
      <thead><tr><th scope="col">Vivienda</th><th scope="col">Estado</th><th scope="col">Hab.</th><th scope="col">Superficie</th><th scope="col">Renta</th></tr></thead>
      <tbody>
${filas}
      </tbody>
    </table>
  </div>`;
}

function etiquetaEstado(estado) {
  const mapa = { libre: 'Libre', ocupada: 'Ocupada', proximamente: 'Próximamente' };
  return `<span class="pastilla pastilla--${esc(estado ?? 'sin-dato')}">${esc(mapa[estado] ?? 'Sin dato')}</span>`;
}

function historicoHtml(serie) {
  const filas = serie.slice().reverse().map((r) => `      <tr><td>${esc(r.fecha)}</td><td class="num">${r.libres}</td><td class="num">${r.ocupadas}</td><td class="num">${r.proximamente}</td></tr>`).join('\n');
  return `<details class="historico">
    <summary>Cómo ha ido cambiando (${serie.length} registros)</summary>
    <div class="tabla-scroll">
      <table class="tabla">
        <thead><tr><th scope="col">Día</th><th scope="col">Libres</th><th scope="col">Ocupadas</th><th scope="col">Próximamente</th></tr></thead>
        <tbody>
${filas}
        </tbody>
      </table>
    </div>
    <p class="fino">Solo se anota el día en que algo cambia. Es la única forma honesta que tenemos de enseñar
       cómo avanza la lista: mirando lo que la propia fuente oficial publica, sin datos de nadie.</p>
  </details>`;
}

/** Explicación en lenguaje claro del punto del proceso, sin inventar plazos. */
function situacion(p, d) {
  const partes = [];
  if (p.estado_procedimiento === 'abierto') {
    partes.push('La ficha oficial marca el <strong>procedimiento como abierto</strong>: se pueden presentar solicitudes. Los plazos exactos están en el anuncio del BOCYL o del Boletín de la Provincia que enlazamos abajo — son los que valen.');
  } else if (p.estado_procedimiento === 'cerrado') {
    partes.push('La ficha oficial marca el <strong>procedimiento como cerrado</strong>: el plazo para solicitar esta promoción ya pasó. Si presentaste solicitud, tu situación depende del listado y del sorteo; los documentos publicados están abajo.');
  } else {
    partes.push('La ficha oficial no indica en qué fase está el procedimiento. Los documentos publicados abajo son la referencia.');
  }
  if (p.estado_obra) {
    partes.push(`Estado de la obra según la fuente: <strong>${esc(p.estado_obra.toLowerCase())}</strong>.`);
  }
  if (d.publicada && d.libres > 0) {
    partes.push(`Hay <strong>${d.libres} viviendas marcadas como libres</strong>. Cuando quedan viviendas sin adjudicar, SOMACYL las arrienda por orden de solicitud; para saber cómo optar a ellas hay que preguntar directamente a <a href="mailto:tuyavivienda@somacyl.es">tuyavivienda@somacyl.es</a> o al 983 450 544.`);
  } else if (d.publicada) {
    partes.push('Ahora mismo <strong>no hay ninguna vivienda marcada como libre</strong> en la tabla oficial. Si estás en lista de reserva, tu turno depende de que alguien renuncie: aquí verás el cambio el día que la fuente lo publique.');
  }
  partes.push('<strong>No tenemos ni podemos tener tu expediente.</strong> Esta web no sabe quién eres ni maneja datos de solicitantes: para consultar tu situación personal, el canal es SOMACYL.');
  return partes.map((t) => `<p>${t}</p>`).join('\n    ');
}

function documentoHtml(doc) {
  const nominal = doc.tipo === 'listado_nominal';
  return `<li>
        <a href="${esc(doc.url)}" rel="noopener nofollow">${esc(doc.titulo ?? 'Documento')}</a>
        <span class="pastilla pastilla--doc">${esc(nombreTipo(doc.tipo))}</span>
        ${nominal ? '<p class="fino">Contiene nombres de personas: lo enlazamos a la web oficial y no lo copiamos ni lo procesamos.</p>' : ''}
      </li>`;
}

function nombreTipo(tipo) {
  return {
    bocyl: 'BOCYL', bop: 'Boletín provincial', correccion: 'Corrección de errores',
    procedimiento: 'Procedimiento', tecnico: 'Documentación técnica',
    listado_nominal: 'Listado con datos personales', otro: 'Documento',
  }[tipo] ?? 'Documento';
}

/** Botón de «me interesa». Sin JS no estorba: se oculta con CSS hasta que el JS lo activa. */
function botonSeguir(id, tamano = '') {
  return `<button type="button" class="seguir${tamano ? ` seguir--${tamano}` : ''}" data-seguir="${esc(id)}" hidden
        aria-pressed="false">Me interesa</button>`;
}

function ultimosAvisos() {
  const ultimos = avisos.filter((a) => a.tipo !== 'plazo_sin_registrar').slice(0, 6);
  if (!ultimos.length) return '';
  return `<section class="bloque" id="novedades">
  <h2>Últimos movimientos</h2>
  <p class="novedades__resumen" data-resumen hidden></p>
  <ul class="docs">
    ${ultimos.map((a) => `<li data-fecha="${esc(a.fecha)}">
      <a href="${esc(rutaDe(a))}">${esc(a.titulo)}</a> <span class="pastilla pastilla--doc">${esc(a.fecha)}</span>
      <p class="fino">${esc(a.detalle ?? '')}</p>
    </li>`).join('\n    ')}
  </ul>
  <p class="fino"><a href="/avisos/">Todos los avisos y cómo enterarte a tiempo →</a></p>
</section>`;
}

function avisosDe(id) {
  const suyos = avisos.filter((a) => a.promocion_id === id && a.tipo !== 'plazo_sin_registrar').slice(0, 8);
  if (!suyos.length) return '';
  return `<section class="bloque">
    <h2>Qué ha pasado aquí</h2>
    <ul class="docs">
      ${suyos.map((a) => `<li><strong>${esc(a.fecha)}</strong> · ${esc(a.titulo)}
        <p class="fino">${esc(a.detalle ?? '')}</p></li>`).join('\n      ')}
    </ul>
  </section>`;
}

function rutaDe(a) {
  return a.url?.startsWith(SITIO) ? a.url.slice(SITIO.length) : (a.url ?? '/');
}

function paginaAvisos() {
  const vivos = plazosVivos();
  const sinFecha = PLAZOS.filter((z) => !z.fin);
  const cuerpo = `
<article class="prosa">
<h1>Que no se te pase el plazo</h1>
<p>El problema de esto no es entenderlo: es enterarte a tiempo. Las convocatorias salen en un boletín, los
   listados aparecen un martes cualquiera en una web y el plazo para alegar dura unos días. Por eso el proyecto
   mira las fichas oficiales <strong>todos los días</strong> y avisa cuando algo se mueve.</p>

<h2>Tres maneras de enterarte, ninguna te pide nada</h2>
<p>No hay registro, ni correo, ni cuenta. Aquí no sabemos quién eres y no queremos saberlo.</p>

<h3>1. Marcar lo que te interesa</h3>
<p>Dale a <em>Me interesa</em> en las promociones que sigues. La portada te abre con «Lo que sigues» y te marca
   las <strong>novedades desde la última vez que entraste</strong>. Se guarda en el almacenamiento de tu
   navegador, como una cookie: no viaja a ningún servidor y nadie —nosotros tampoco— puede saber qué sigues.
   Si cambias de móvil o borras los datos del navegador, se queda atrás. Es el precio de no pedirte datos, y nos
   parece que sale a cuenta.</p>

<h3>2. Calendario (lo más eficaz para los plazos)</h3>
<p>Suscribe tu calendario a <a href="/plazos.ics">plazos.ics</a> y cada plazo entra con avisos automáticos
   <strong>21, 14, 7, 3 y 1 días antes</strong>, más el propio día del cierre. Te avisa tu móvil, sin depender de
   que nosotros te mandemos nada. Cada promoción tiene el suyo en su ficha.</p>

<h3>3. RSS</h3>
<p><a href="/avisos.xml">Todos los avisos</a>, o el de una promoción concreta desde su ficha. Va bien para
   engancharlo a Telegram, a un lector o a lo que use la comunidad.</p>

<h2>De qué se avisa</h2>
<ul>
  <li><strong>Plazos que se acercan</strong>: recordatorios a 21, 14, 7, 3 y 1 días, y el día del cierre.</li>
  <li><strong>Convocatoria nueva</strong>: aparece un anuncio de BOCYL o del boletín provincial en la ficha.</li>
  <li><strong>Listado publicado</strong>: sale la lista de admitidos, la definitiva o la de adjudicatarios. Te
      decimos que existe y te llevamos a la web oficial; el listado no lo copiamos.</li>
  <li><strong>Se abre o se cierra el procedimiento</strong>.</li>
  <li><strong>Viviendas libres</strong>: cuando aparecen viviendas sin adjudicar (se alquilan por orden de
      solicitud) o cuando la lista se mueve porque se ocupan.</li>
</ul>

<h2>Los plazos salen del propio boletín</h2>
<p>Nadie los teclea. El sistema descarga los anuncios oficiales que enlaza cada promoción, les lee el texto y
   busca la regla tal cual está escrita —«un plazo máximo que concluirá a los quince días naturales contados
   desde el día siguiente a la publicación de este Acuerdo en el Boletín Oficial de la Provincia»— y la combina
   con la fecha en que se publicó ese boletín, que va en la cabecera de todas sus páginas. De ahí sale la fecha
   exacta.</p>
<p>En cada plazo puedes desplegar <em>«Lo que dice el documento»</em> y leer la frase literal de la que sale, con
   enlace al PDF oficial. Si el plazo cuelga de algo que aún no ha pasado —«diez días desde que se publique la
   lista provisional»— <strong>no nos inventamos una fecha</strong>: enseñamos la regla y ya está.</p>
<p>De los listados con nombres no se descarga nada, ni para esto: se enlazan y punto.</p>

${vivos.length ? `<h2>Plazos abiertos ahora</h2>${bloquePlazos(vivos)}` :
  '<h2>Ahora mismo no hay ningún plazo abierto</h2><p>Los que hay extraídos ya se han cerrado. Cuando salga una convocatoria nueva aparecerá aquí, en la portada y en los tres canales.</p>'}

${sinFecha.length ? `<h2>Plazos que dependen de lo que pase antes</h2>
<p>Están escritos en el boletín pero se cuentan desde un hecho que todavía no ha ocurrido, así que no tienen
   fecha. En cuanto ese hecho ocurra y quede publicado, el plazo aparecerá con su día.</p>
${bloquePlazos(sinFecha)}` : ''}

<h2>Cada cuánto</h2>
<p>La comprobación es diaria. Un cambio puede tardar hasta 24 horas en detectarse, así que para un plazo que
   cierra hoy no te fíes solo de esto: los recordatorios empiezan tres semanas antes precisamente por eso.</p>
</article>`;
  return layout({
    titulo: 'Avisos',
    descripcion: 'Avisos de convocatorias, listados y plazos de la vivienda pública en Valladolid: calendario, RSS y seguimiento en tu propio navegador.',
    ruta: '/avisos/', cuerpo, activo: 'avisos',
  });
}

// ------------------------------------------------------------- sindicación ----

function feedRss(lista, titulo, ruta) {
  const items = lista.map((a) => `  <item>
    <title>${esc(a.titulo)}</title>
    <link>${esc(a.url ?? SITIO)}</link>
    <guid isPermaLink="false">${esc(a.id)}</guid>
    <pubDate>${new Date(`${a.fecha}T09:00:00Z`).toUTCString()}</pubDate>
    <description>${esc(`${a.detalle ?? ''}${a.enlace_documento ? ` Documento: ${a.enlace_documento}` : ''}`)}</description>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(titulo)}</title>
  <link>${SITIO}${ruta.replace(/avisos\.xml$/, '')}</link>
  <description>Avisos automáticos de una web vecinal. No es una comunicación oficial.</description>
  <language>es-ES</language>
  <lastBuildDate>${new Date(`${HOY}T09:00:00Z`).toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

/**
 * Calendario iCalendar con un evento por plazo y alarmas a 21, 14, 7, 3 y 1
 * días. Es el canal más útil: avisa el móvil de cada cual, sin que tengamos que
 * saber quién es.
 */
function calendario(plazos) {
  const alarmas = [21, 14, 7, 3, 1].map((d) => `BEGIN:VALARM
TRIGGER:-P${d}D
ACTION:DISPLAY
DESCRIPTION:Faltan ${d} días para el cierre del plazo
END:VALARM`).join('\n');

  const eventos = plazos.filter((z) => z.fin).map((z) => {
    const fin = z.fin.replace(/-/g, '');
    const finExclusivo = new Date(Date.parse(`${z.fin}T00:00:00Z`) + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    return `BEGIN:VEVENT
UID:${z.promocion_id}-${z.tipo}-${fin}@vivienda.aldeapucela.org
DTSTAMP:${HOY.replace(/-/g, '')}T090000Z
DTSTART;VALUE=DATE:${(z.inicio ?? z.fin).replace(/-/g, '')}
DTEND;VALUE=DATE:${finExclusivo}
SUMMARY:${ics(`${z.titulo ?? 'Plazo'} · ${nombrePromocion(z.promocion_id)}`)}
DESCRIPTION:${ics(`Termina el ${z.fin}${z.hora_limite ? ` a las ${z.hora_limite}` : ''}. Fuente: ${z.fuente_ref ?? z.fuente_url}. Ficha: ${SITIO}/promocion/${z.promocion_id}/`)}
URL:${SITIO}/promocion/${z.promocion_id}/
${alarmas}
END:VEVENT`;
  }).join('\n');

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Aldea Pucela//Vivienda//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Plazos de vivienda pública (Valladolid)
X-WR-CALDESC:Plazos anotados por la comunidad a partir de los documentos oficiales
${eventos}${eventos ? '\n' : ''}END:VCALENDAR
`.replace(/\n/g, '\r\n');
}

/** Escapa según iCalendar (RFC 5545). */
function ics(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function paginaDatos() {
  const cuerpo = `
<article class="prosa">
<h1>Datos abiertos</h1>
<p>Todo lo que ves en esta web sale de estos ficheros, que puedes usar libremente citando la fuente
   (<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.es" rel="noopener">CC BY-SA 4.0</a>).
   Se regeneran solos cada día y su historial completo está en Git: cada cambio de un dato queda fechado.</p>
<ul class="docs">
  <li><a href="/data/promociones.json">promociones.json</a> <span class="pastilla pastilla--doc">Índice</span>
      <p class="fino">Una entrada por promoción con su estado y el resumen de viviendas libres.</p></li>
  <li><a href="/data/historico.json">historico.json</a> <span class="pastilla pastilla--doc">Serie temporal</span>
      <p class="fino">Cuántas viviendas había libres cada día que hubo algún cambio.</p></li>
  <li><a href="/data/fuentes.json">fuentes.json</a> <span class="pastilla pastilla--doc">Trazabilidad</span>
      <p class="fino">Qué página o documento respalda cada dato, cuándo se leyó y con qué huella sha256.</p></li>
  <li><a href="/data/promociones/">data/promociones/&lt;id&gt;.json</a> <span class="pastilla pastilla--doc">Detalle</span>
      <p class="fino">Ficha completa de cada promoción, vivienda a vivienda.</p></li>
</ul>
<h2>Lo que no vas a encontrar aquí</h2>
<p>Ningún dato personal: ni nombres, ni DNI, ni posiciones de lista asociadas a personas. No es un descuido,
   es la regla del proyecto y hay un test automático que impide publicar nada que lo parezca.
   <a href="/privacidad/">Explicación completa</a>.</p>
<h2>Cómo se generan</h2>
<p>Un script sin dependencias lee las fichas públicas de <code>tuyavivienda.es</code> una vez al día, respetando
   su <code>robots.txt</code>, y extrae solo hechos: cifras, estados y enlaces. El código está
   <a href="https://github.com/aldeapucela/vivienda" rel="noopener">en GitHub</a> y cualquiera puede revisarlo o
   levantar su propia copia. <a href="/fuentes/">Detalle de las fuentes</a>.</p>
</article>`;
  return layout({ titulo: 'Datos abiertos', descripcion: 'Ficheros JSON con las promociones de vivienda pública, su disponibilidad y la trazabilidad de cada dato.', ruta: '/datos/', cuerpo, activo: 'datos' });
}

function paginaDoc(rel, titulo, ruta) {
  const md = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  return layout({
    titulo, descripcion: `${titulo} · proyecto vecinal de seguimiento de la vivienda pública en Valladolid.`,
    ruta, cuerpo: `<article class="prosa">\n${markdown(md)}\n</article>`,
    activo: ruta === '/como-funciona/' ? 'como' : '',
  });
}

function pagina404() {
  return layout({
    titulo: 'Página no encontrada', descripcion: 'Esa página no existe.', ruta: '/404.html',
    cuerpo: '<article class="prosa"><h1>Aquí no hay nada</h1><p>Puede que la promoción haya cambiado de dirección. <a href="/">Vuelve al listado</a>.</p></article>',
  });
}

function sitemap() {
  const urls = ['/', '/como-funciona/', '/datos/', '/privacidad/', '/fuentes/',
    ...promociones.map((p) => `/promocion/${p.id}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITIO}${u}</loc><lastmod>${indice.actualizado}</lastmod></url>`).join('\n')}
</urlset>
`;
}

function matomo() {
  if (!MATOMO_SITE_ID) return '';
  return `<script>
  var _paq = window._paq = window._paq || [];
  _paq.push(['trackPageView']); _paq.push(['enableLinkTracking']);
  (function() { var u="//stats.aldeapucela.org/";
    _paq.push(['setTrackerUrl', u+'matomo.php']); _paq.push(['setSiteId', '${MATOMO_SITE_ID}']);
    var d=document, g=d.createElement('script'), s=d.getElementsByTagName('script')[0];
    g.async=true; g.src=u+'matomo.js'; s.parentNode.insertBefore(g,s); })();
</script>
`;
}

// ------------------------------------------------- vista previa de 1 fichero ----

/**
 * Reúne todas las páginas en un único HTML autocontenido: los enlaces internos
 * pasan a `#/ruta/` y un router mínimo enseña la sección que toque. Sirve para
 * enseñar el sitio antes de tener dominio; el sitio de verdad son las páginas
 * separadas de dist/.
 */
function unaSolaPagina() {
  const css = fs.readFileSync(path.join(RAIZ, 'src/styles.css'), 'utf8');
  const filtros = fs.readFileSync(path.join(RAIZ, 'src/app.js'), 'utf8');
  const utiles = paginas.filter((p) => p.ruta !== '/404.html');

  const secciones = utiles.map((p) => `<section class="pagina" data-ruta="${esc(p.ruta)}" hidden>
${enlacesInternos(p.cuerpo)}
</section>`).join('\n');

  return `<title>Vivienda Pucela</title>
<style>
${css}
.pagina[hidden] { display: none; }
.previo {
  background: var(--brand-100); color: var(--brand-700);
  padding: .6rem 0; font-size: .85rem; border-bottom: 1px solid var(--linea);
}
.previo p { margin: 0; }
</style>
<div class="previo"><div class="container"><p><strong>Vista previa.</strong> Todo el sitio en un solo fichero,
  con los datos leídos el ${esc(indice.actualizado)}. La web definitiva se publicará en
  <code>vivienda.aldeapucela.org</code>.</p></div></div>
<header class="topbar">
  <div class="container topbar__inner">
    <a class="marca" href="#/">
      <span class="marca__kicker">Aldea Pucela</span>
      <span class="marca__titulo">Vivienda</span>
    </a>
    <nav class="menu" aria-label="Menú principal">
      <a href="#/">Promociones</a>
      <a href="#/como-funciona/">Cómo funciona</a>
      <a href="#/datos/">Datos</a>
      <a href="#/fuentes/">Fuentes</a>
      <a href="#/privacidad/">Privacidad</a>
    </nav>
  </div>
</header>
<main id="contenido" class="container">
${secciones}
</main>
<footer class="pie">
  <div class="container">
    <p><strong>Esta web no es oficial.</strong> Es un proyecto vecinal de la comunidad de
      <a href="https://aldeapucela.org" rel="noopener">Aldea Pucela</a> que ordena información ya publicada por
      tuyavivienda.es (SOMACYL, Junta de Castilla y León). Para cualquier trámite, la fuente válida es la
      oficial y el BOCYL.</p>
    <p class="fino">No publicamos datos personales de solicitantes ni adjudicatarios.
      Código AGPL-3.0 · Datos CC BY-SA 4.0 · Hecho por vecinas y vecinos voluntarios</p>
  </div>
</footer>
<script>
(function () {
  var secciones = [].slice.call(document.querySelectorAll('.pagina'));
  function pinta() {
    var ruta = location.hash.replace(/^#/, '') || '/';
    var elegida = secciones.filter(function (s) { return s.dataset.ruta === ruta; })[0] || secciones[0];
    secciones.forEach(function (s) { s.hidden = s !== elegida; });
    document.title = 'Vivienda Pucela';
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', pinta);
  pinta();
})();
${filtros}
</script>
`;
}

/**
 * `href="/x/"` → `href="#/x/"` (los externos se quedan igual). Los enlaces a
 * los JSON se quedan sin destino: en un fichero suelto no hay `data/`, así que
 * se muestran como nombres de fichero en vez de como enlaces rotos.
 */
function enlacesInternos(html) {
  return html
    .replace(/<a href="\/[^"]*\.(?:json|xml|ics)"[^>]*>([\s\S]*?)<\/a>/g, '<code>$1</code>')
    .replace(/<a href="\/data\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<code>$1</code>')
    .replace(/href="\/(?!\/)([^"]*)"/g, (_, resto) => `href="#/${resto}"`);
}

// -------------------------------------------------------------- markdown ----

/** Renderizador mínimo: encabezados, párrafos, listas, tablas, énfasis y enlaces. */
function markdown(md) {
  const lineas = md.split(/\r?\n/);
  const salida = [];
  let lista = null; let tabla = false; let parrafo = [];

  const cierraParrafo = () => { if (parrafo.length) { salida.push(`<p>${enLinea(parrafo.join(' '))}</p>`); parrafo = []; } };
  const cierraLista = () => { if (lista) { salida.push(`</${lista}>`); lista = null; } };
  const cierraTabla = () => { if (tabla) { salida.push('</tbody></table></div>'); tabla = false; } };
  const cierraTodo = () => { cierraParrafo(); cierraLista(); cierraTabla(); };

  for (const linea of lineas) {
    const l = linea.trimEnd();
    if (!l.trim()) { cierraTodo(); continue; }

    const enc = l.match(/^(#{1,4})\s+(.*)$/);
    if (enc) { cierraTodo(); const n = enc[1].length; salida.push(`<h${n}>${enLinea(enc[2])}</h${n}>`); continue; }

    if (/^[-*]\s+/.test(l)) {
      cierraParrafo(); cierraTabla();
      if (lista !== 'ul') { cierraLista(); salida.push('<ul>'); lista = 'ul'; }
      salida.push(`<li>${enLinea(l.replace(/^[-*]\s+/, ''))}</li>`); continue;
    }
    if (/^\d+[.)]\s+/.test(l)) {
      cierraParrafo(); cierraTabla();
      if (lista !== 'ol') { cierraLista(); salida.push('<ol>'); lista = 'ol'; }
      salida.push(`<li>${enLinea(l.replace(/^\d+[.)]\s+/, ''))}</li>`); continue;
    }
    if (/^\|/.test(l)) {
      cierraParrafo(); cierraLista();
      const celdas = l.split('|').slice(1, -1).map((c) => c.trim());
      if (/^[-:\s|]+$/.test(l)) continue; // separador de cabecera
      if (!tabla) {
        salida.push('<div class="tabla-scroll"><table class="tabla"><thead><tr>');
        salida.push(celdas.map((c) => `<th scope="col">${enLinea(c)}</th>`).join(''));
        salida.push('</tr></thead><tbody>');
        tabla = true; continue;
      }
      salida.push(`<tr>${celdas.map((c) => `<td>${enLinea(c)}</td>`).join('')}</tr>`);
      continue;
    }
    if (/^>\s?/.test(l)) { cierraTodo(); salida.push(`<blockquote>${enLinea(l.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^---+$/.test(l)) { cierraTodo(); salida.push('<hr>'); continue; }

    cierraLista(); cierraTabla();
    parrafo.push(l.trim());
  }
  cierraTodo();
  return salida.join('\n');
}

function enLinea(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${/^https?:/.test(u) ? ' rel="noopener"' : ''}>${t}</a>`);
}

// ------------------------------------------------------------- utilidades ----

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


function suma(xs) { return xs.reduce((a, b) => a + (b ?? 0), 0); }

function json(rel, porDefecto) {
  const f = path.join(RAIZ, rel);
  if (!fs.existsSync(f)) {
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`falta ${rel}: ejecuta antes "npm run sync"`);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function existe(rel) { return fs.existsSync(path.join(RAIZ, rel)); }

function escribe(rel, contenido) {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, BASE ? conBase(contenido) : contenido);
}

/** Antepone el prefijo de despliegue a los enlaces internos (los externos no llevan «/» inicial). */
function conBase(contenido) {
  return contenido
    .replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}/`)
    .replace(/(href|src)="\/"/g, `$1="${BASE}/"`);
}

function copia(origen, destino) {
  const d = path.join(DIST, destino);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, origen), d);
}

function copiaDir(origen, destino) {
  fs.cpSync(path.join(RAIZ, origen), path.join(DIST, destino), { recursive: true });
}
