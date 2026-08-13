#!/usr/bin/env node
// Detector de avisos. Compara lo que hay hoy en data/ con el último estado
// conocido (data/estado.json) y anota en data/avisos.json lo que ha cambiado:
// convocatorias, listados publicados, viviendas que se liberan y, sobre todo,
// los plazos que se acercan.
//
// No sabe nada de personas: los avisos hablan de promociones, no de nadie.
//
//   node scripts/avisos.mjs              detecta y anota (usa la fecha de hoy)
//   node scripts/avisos.mjs --fecha X    finge que hoy es X (pruebas)
//   node scripts/avisos.mjs --self-test  pruebas puras

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minusculiza } from './lib.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITIO = 'https://vivienda.aldeapucela.org';

// Con cuánta antelación se avisa de un plazo que se cierra. La lista manda:
// si el plazo se registra tarde, se avisa igual del recordatorio que toque.
export const ANTELACION_DIAS = [21, 14, 7, 3, 1, 0];

// Cuántos avisos se conservan en data/avisos.json (los viejos se caen solos).
const MAX_AVISOS = 500;

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  const fallos = selfTest();
  for (const f of fallos) console.error('✖', f);
  console.log(fallos.length ? `\n${fallos.length} fallos` : '✔ avisos: self-test en verde');
  process.exit(fallos.length ? 1 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) principal();

function principal() {
  const hoy = valorDe('--fecha') ?? new Date().toISOString().slice(0, 10);
  const indice = leeJson('data/promociones.json', { promociones: [] });
  const detalles = indice.promociones.map((p) => leeJson(`data/promociones/${p.id}.json`, null)).filter(Boolean);
  const estadoPrevio = leeJson('data/estado.json', { promociones: {} });
  const plazos = mezclaPlazos(
    leeJson('data/plazos.json', { plazos: [] }).plazos ?? [],
    leeJson('config/plazos.json', { plazos: [] }).plazos ?? []);
  const previos = leeJson('data/avisos.json', { avisos: [] }).avisos ?? [];
  const propios = leeJson('config/estilo.json', { nombres_propios: [] }).nombres_propios ?? [];
  for (const p of detalles) p.nombre = minusculiza(p.nombre, [...propios, p.localidad, p.provincia]);

  const { avisos, estado } = detecta({ detalles, estadoPrevio, plazos, hoy });
  const conocidos = new Set(previos.map((a) => a.id));
  const nuevos = avisos.filter((a) => !conocidos.has(a.id));

  // Primera ejecución: todo es «nuevo». Se anota en el histórico pero no se
  // envía, para no soltar 27 correos de golpe el día del estreno.
  const arranque = !Object.keys(estadoPrevio.promociones ?? {}).length;
  if (arranque) for (const a of nuevos) { a.notificado = true; a.motivo_no_enviado = 'primera carga'; }

  const todos = [...previos, ...nuevos]
    .sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id, 'es'))
    .slice(0, MAX_AVISOS);

  guardaJson('data/avisos.json', { actualizado: hoy, avisos: todos });
  guardaJson('data/estado.json', estado);

  console.log(`✔ avisos: ${nuevos.length} nuevos (${todos.length} en el histórico)`);
  for (const a of nuevos) console.log(`  · [${a.urgencia}] ${a.titulo}`);
  const sinPlazo = nuevos.filter((a) => a.tipo === 'plazo_sin_registrar');
  if (sinPlazo.length) {
    console.log('\n⚠ Hay convocatorias abiertas de las que no se ha podido sacar la fecha de cierre del');
    console.log('  boletín. Revisa scripts/plazos.mjs o anótalas a mano en config/plazos.json.');
  }
}

/**
 * Los plazos salen del propio boletín (`data/plazos.json`). `config/plazos.json`
 * existe para corregir a mano lo que la extracción haga mal: una corrección
 * manual gana siempre sobre el mismo tipo de plazo de la misma promoción.
 */
export function mezclaPlazos(automaticos, manuales) {
  const validos = manuales.filter((z) => z.fuente_url && z.promocion_id);
  const pisados = new Set(validos.map((z) => `${z.promocion_id}:${z.tipo}`));
  return [
    ...validos.map((z) => ({ ...z, origen: 'manual' })),
    ...automaticos.filter((z) => !pisados.has(`${z.promocion_id}:${z.tipo}`)),
  ];
}

// ------------------------------------------------------------- detección ----

/**
 * Función pura: recibe el estado de hoy y el de ayer, devuelve los avisos y el
 * estado nuevo. Todo lo que hace el detector se puede probar sin ficheros.
 */
export function detecta({ detalles, estadoPrevio, plazos, hoy }) {
  const avisos = [];
  const estado = { actualizado: hoy, promociones: {} };

  for (const p of detalles) {
    const previo = estadoPrevio.promociones?.[p.id];
    const docs = (p.documentos ?? []).map((d) => d.url);
    const d = p.disponibilidad ?? {};
    const comun = {
      promocion_id: p.id,
      promocion: p.nombre,
      localidad: p.localidad,
      provincia: p.provincia,
      url: `${SITIO}/promocion/${p.id}/`,
      url_oficial: p.url_oficial,
    };

    estado.promociones[p.id] = {
      estado_procedimiento: p.estado_procedimiento ?? null,
      estado_obra: p.estado_obra ?? null,
      documentos: docs,
      disponibilidad: { publicada: !!d.publicada, libres: d.libres ?? null, total: d.total ?? null },
    };

    if (!previo) {
      // Primera vez que vemos la promoción. En el arranque del proyecto esto
      // sería un aviso por cada una: se anota, pero como informativo.
      avisos.push(aviso({ ...comun, fecha: hoy, tipo: 'promocion_nueva', urgencia: 'media',
        titulo: `Nueva promoción: ${p.nombre}`,
        detalle: `${p.n_viviendas ?? '¿?'} viviendas en ${p.localidad ?? '—'}.` }));
      continue;
    }

    for (const doc of (p.documentos ?? [])) {
      if (previo.documentos?.includes(doc.url)) continue;
      const esListado = doc.tipo === 'listado_nominal';
      const esBoletin = doc.tipo === 'bocyl' || doc.tipo === 'bop';
      avisos.push(aviso({
        ...comun, fecha: hoy,
        tipo: esListado ? 'listado_publicado' : esBoletin ? 'convocatoria_publicada' : 'documento_nuevo',
        urgencia: esListado || esBoletin ? 'alta' : 'baja',
        titulo: esListado
          ? `Listado publicado en ${p.localidad ?? p.nombre}`
          : esBoletin
            ? `Nuevo anuncio oficial de ${p.localidad ?? p.nombre}`
            : `Documento nuevo en ${p.localidad ?? p.nombre}`,
        detalle: `«${doc.titulo ?? 'sin título'}». ${esListado
          ? 'Contiene datos personales: se abre en la web oficial. Mira si estás y en qué situación.'
          : 'Ahí suelen ir los plazos: conviene leerlo cuanto antes.'}`,
        enlace_documento: doc.url,
      }));
    }

    if (previo.estado_procedimiento !== p.estado_procedimiento && p.estado_procedimiento) {
      const abierto = p.estado_procedimiento === 'abierto';
      avisos.push(aviso({ ...comun, fecha: hoy,
        tipo: abierto ? 'procedimiento_abierto' : 'procedimiento_cerrado',
        urgencia: abierto ? 'alta' : 'media',
        titulo: abierto
          ? `Se puede solicitar: ${p.localidad ?? p.nombre}`
          : `Plazo cerrado: ${p.localidad ?? p.nombre}`,
        detalle: abierto
          ? 'La ficha oficial marca el procedimiento como abierto. El plazo exacto está en el anuncio del boletín.'
          : 'La ficha oficial marca el procedimiento como cerrado.' }));
    }

    if (d.publicada && !previo.disponibilidad?.publicada) {
      avisos.push(aviso({ ...comun, fecha: hoy, tipo: 'tabla_publicada', urgencia: 'media',
        titulo: `Ya se ve el estado de las viviendas: ${p.localidad ?? p.nombre}`,
        detalle: `${d.libres} libres de ${d.total}.` }));
    } else if (d.publicada && previo.disponibilidad?.publicada) {
      const antes = previo.disponibilidad.libres ?? 0;
      if (d.libres > antes) {
        avisos.push(aviso({ ...comun, fecha: hoy, tipo: 'viviendas_libres', urgencia: 'alta',
          titulo: `${d.libres - antes} vivienda${d.libres - antes === 1 ? '' : 's'} libre${d.libres - antes === 1 ? '' : 's'} en ${p.localidad ?? p.nombre}`,
          detalle: `Antes había ${antes} libres y ahora ${d.libres} de ${d.total}. Cuando quedan viviendas sin adjudicar se alquilan por orden de solicitud.` }));
      } else if (d.libres < antes) {
        avisos.push(aviso({ ...comun, fecha: hoy, tipo: 'viviendas_adjudicadas', urgencia: 'baja',
          titulo: `La lista se ha movido en ${p.localidad ?? p.nombre}`,
          detalle: `Quedan ${d.libres} viviendas libres de ${d.total} (antes ${antes}).` }));
      }
    }
  }

  for (const a of avisosDePlazos({ plazos, detalles, hoy })) avisos.push(a);
  return { avisos, estado };
}

/** Recordatorios de plazos: lo que impide que se te pase la fecha. */
export function avisosDePlazos({ plazos, detalles, hoy }) {
  const avisos = [];
  const porId = new Map(detalles.map((p) => [p.id, p]));

  for (const plazo of plazos) {
    const p = porId.get(plazo.promocion_id);
    const comun = {
      promocion_id: plazo.promocion_id,
      promocion: p?.nombre ?? plazo.promocion_id,
      localidad: p?.localidad ?? null,
      provincia: p?.provincia ?? null,
      url: `${SITIO}/promocion/${plazo.promocion_id}/`,
      url_oficial: plazo.fuente_url ?? p?.url_oficial ?? null,
    };
    const titulo = plazo.titulo ?? nombrePlazo(plazo.tipo);

    if (plazo.inicio === hoy) {
      avisos.push(aviso({ ...comun, fecha: hoy, tipo: 'plazo_abierto', urgencia: 'alta',
        titulo: `Hoy se abre el plazo: ${titulo} · ${comun.localidad ?? ''}`.trim(),
        detalle: plazo.fin ? `Tienes hasta el ${plazo.fin}${plazo.hora_limite ? ` a las ${plazo.hora_limite}` : ''}.` : 'Sin fecha de cierre publicada.',
        enlace_documento: plazo.fuente_url ?? null }));
    }

    if (!plazo.fin) continue;
    const quedan = diasEntre(hoy, plazo.fin);
    if (quedan < 0 || !ANTELACION_DIAS.includes(quedan)) continue;

    avisos.push(aviso({ ...comun, fecha: hoy,
      tipo: quedan === 0 ? 'plazo_cierra_hoy' : 'plazo_recordatorio',
      urgencia: quedan <= 3 ? 'alta' : 'media',
      titulo: quedan === 0
        ? `HOY se cierra: ${titulo} · ${comun.localidad ?? ''}`.trim()
        : `Quedan ${quedan} día${quedan === 1 ? '' : 's'}: ${titulo} · ${comun.localidad ?? ''}`.trim(),
      detalle: `El plazo termina el ${plazo.fin}${plazo.hora_limite ? ` a las ${plazo.hora_limite}` : ''}.` +
        (plazo.fuente_ref ? ` Según ${plazo.fuente_ref}.` : ''),
      enlace_documento: plazo.fuente_url ?? null,
      clave: `${plazo.tipo}-${plazo.fin}-${quedan}` }));
  }

  // Convocatoria abierta sin plazo anotado: aviso para la propia comunidad.
  for (const p of detalles) {
    if (p.estado_procedimiento !== 'abierto') continue;
    if (plazos.some((z) => z.promocion_id === p.id && z.fin)) continue;
    avisos.push(aviso({
      promocion_id: p.id, promocion: p.nombre, localidad: p.localidad, provincia: p.provincia,
      url: `${SITIO}/promocion/${p.id}/`, url_oficial: p.url_oficial,
      fecha: hoy, tipo: 'plazo_sin_registrar', urgencia: 'media',
      titulo: `Falta anotar el plazo de ${p.localidad ?? p.nombre}`,
      detalle: 'El procedimiento está abierto y no se ha podido extraer la fecha de cierre de ningún boletín. Hay que revisarlo a mano.',
      clave: 'pendiente' }));
  }

  return avisos;
}

function aviso({ clave, ...datos }) {
  const id = `${datos.fecha}:${datos.promocion_id}:${datos.tipo}${clave ? `:${clave}` : ''}${
    datos.enlace_documento ? `:${datos.enlace_documento.split('/').pop()}` : ''}`;
  return { id, notificado: false, enlace_documento: null, ...datos };
}

function nombrePlazo(tipo) {
  return { solicitudes: 'Presentación de solicitudes', alegaciones: 'Alegaciones', sorteo: 'Sorteo', eleccion: 'Elección de vivienda' }[tipo] ?? 'Plazo';
}

/** Días naturales entre dos fechas AAAA-MM-DD (b - a). */
export function diasEntre(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// ------------------------------------------------------------- utilidades ----

function valorDe(nombre) {
  const i = args.indexOf(nombre);
  return i === -1 ? null : args[i + 1];
}

function leeJson(rel, porDefecto) {
  const f = path.join(RAIZ, rel);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : porDefecto;
}

function guardaJson(rel, valor) {
  const f = path.join(RAIZ, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(valor, null, 2)}\n`);
}

// -------------------------------------------------------------- self test ----

export function selfTest() {
  const fallos = [];
  const ok = (c, m) => { if (!c) fallos.push(m); };

  const base = {
    id: 'x', nombre: 'X viviendas', localidad: 'Valladolid', provincia: 'Valladolid',
    url_oficial: 'https://ejemplo/x/', n_viviendas: 10,
    estado_procedimiento: 'cerrado', documentos: [], disponibilidad: { publicada: false },
  };

  ok(diasEntre('2026-08-13', '2026-08-20') === 7, 'diasEntre');
  ok(diasEntre('2026-08-20', '2026-08-13') === -7, 'diasEntre negativo');

  // Promoción nueva
  let r = detecta({ detalles: [base], estadoPrevio: { promociones: {} }, plazos: [], hoy: '2026-08-13' });
  ok(r.avisos.length === 1 && r.avisos[0].tipo === 'promocion_nueva', 'promoción nueva');

  // Sin cambios → sin avisos
  r = detecta({ detalles: [base], estadoPrevio: r.estado, plazos: [], hoy: '2026-08-14' });
  ok(r.avisos.length === 0, 'sin cambios no genera avisos');

  // Documento nuevo de boletín + apertura de procedimiento
  const conDoc = {
    ...base, estado_procedimiento: 'abierto',
    documentos: [{ titulo: 'BOCYL-D-1', url: 'https://ejemplo/bocyl-d-1.pdf', tipo: 'bocyl' }],
  };
  r = detecta({ detalles: [conDoc], estadoPrevio: r.estado, plazos: [], hoy: '2026-08-15' });
  const tipos = r.avisos.map((a) => a.tipo);
  ok(tipos.includes('convocatoria_publicada'), 'detecta anuncio de boletín');
  ok(tipos.includes('procedimiento_abierto'), 'detecta apertura de procedimiento');
  ok(tipos.includes('plazo_sin_registrar'), 'reclama el plazo que falta');

  // Listado nominal: se avisa, pero nunca se toca el contenido
  const conListado = { ...conDoc, documentos: [...conDoc.documentos, { titulo: 'Listado de adjudicatarios', url: 'https://ejemplo/lista.pdf', tipo: 'listado_nominal' }] };
  r = detecta({ detalles: [conListado], estadoPrevio: r.estado, plazos: [], hoy: '2026-08-16' });
  ok(r.avisos.some((a) => a.tipo === 'listado_publicado'), 'detecta listado publicado');

  // Viviendas que se liberan
  const previo = { promociones: { x: { estado_procedimiento: 'cerrado', documentos: [], disponibilidad: { publicada: true, libres: 0, total: 10 } } } };
  const conLibres = { ...base, disponibilidad: { publicada: true, libres: 2, total: 10 } };
  r = detecta({ detalles: [conLibres], estadoPrevio: previo, plazos: [], hoy: '2026-08-17' });
  ok(r.avisos.some((a) => a.tipo === 'viviendas_libres' && a.urgencia === 'alta'), 'detecta viviendas libres');

  // Y cuando la lista avanza (se ocupan)
  const conMenos = { ...base, disponibilidad: { publicada: true, libres: 0, total: 10 } };
  r = detecta({ detalles: [conMenos], estadoPrevio: { promociones: { x: { documentos: [], disponibilidad: { publicada: true, libres: 3, total: 10 } } } }, plazos: [], hoy: '2026-08-18' });
  ok(r.avisos.some((a) => a.tipo === 'viviendas_adjudicadas'), 'detecta que la lista se mueve');

  // Recordatorios de plazo
  const plazos = [{ promocion_id: 'x', tipo: 'solicitudes', inicio: '2026-08-01', fin: '2026-08-20', fuente_url: 'https://ejemplo/bocyl.pdf', fuente_ref: 'BOCYL-1' }];
  const recordatorios = (hoy) => avisosDePlazos({ plazos, detalles: [base], hoy }).map((a) => a.tipo);
  ok(recordatorios('2026-08-13').includes('plazo_recordatorio'), 'recordatorio a 7 días');
  ok(recordatorios('2026-08-19').includes('plazo_recordatorio'), 'recordatorio a 1 día');
  ok(recordatorios('2026-08-20').includes('plazo_cierra_hoy'), 'aviso del último día');
  ok(recordatorios('2026-08-21').length === 0, 'plazo pasado no avisa');
  ok(recordatorios('2026-08-15').length === 0, 'días sin hito no avisan');
  ok(avisosDePlazos({ plazos, detalles: [base], hoy: '2026-08-01' }).some((a) => a.tipo === 'plazo_abierto'), 'aviso de apertura');

  // Los ids son estables (no se repite el aviso al día siguiente del mismo hito)
  const a1 = avisosDePlazos({ plazos, detalles: [base], hoy: '2026-08-13' })[0];
  const a2 = avisosDePlazos({ plazos, detalles: [base], hoy: '2026-08-13' })[0];
  ok(a1.id === a2.id, 'id estable');
  ok(a1.id !== avisosDePlazos({ plazos, detalles: [base], hoy: '2026-08-19' })[0].id, 'id distinto por día');

  const mezcla = mezclaPlazos(
    [{ promocion_id: 'x', tipo: 'solicitudes', fin: '2026-09-01', origen: 'automatico' },
     { promocion_id: 'x', tipo: 'alegaciones', fin: null, origen: 'automatico' }],
    [{ promocion_id: 'x', tipo: 'solicitudes', fin: '2026-09-02', fuente_url: 'https://x/doc.pdf' },
     { promocion_id: 'x', tipo: 'sorteo', fin: '2026-10-01' }]);
  ok(mezcla.length === 2, 'el plazo manual pisa al automático del mismo tipo; el manual sin fuente se descarta');
  ok(mezcla.find((z) => z.tipo === 'solicitudes').fin === '2026-09-02', 'gana la corrección manual');
  ok(mezcla.some((z) => z.tipo === 'alegaciones' && z.origen === 'automatico'), 'lo automático se conserva si nadie lo corrige');

  return fallos;
}
