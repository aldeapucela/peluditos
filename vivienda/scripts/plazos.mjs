#!/usr/bin/env node
// Saca los plazos del propio documento oficial. Para cada promoción descarga
// los anuncios de boletín que enlaza su ficha, les extrae el texto y busca las
// reglas: «quince días naturales contados desde el día siguiente a la
// publicación de este Acuerdo en el Boletín Oficial de la Provincia».
//
// Con la fecha de publicación del propio boletín (va en la cabecera de todas
// sus páginas) esa regla se convierte en una fecha concreta. Cuando el plazo
// cuelga de un hecho cuya fecha no consta —«desde que se publique la lista
// provisional»— se publica la regla, no una fecha inventada.
//
// LÍMITE INNEGOCIABLE: nunca se descarga un documento clasificado como
// `listado_nominal`. Esos PDF llevan nombres de personas y solo se enlazan.
//
//   node scripts/plazos.mjs              descarga lo nuevo y regenera data/plazos.json
//   node scripts/plazos.mjs --releer     vuelve a bajar todos los documentos
//   node scripts/plazos.mjs --self-test  pruebas puras (sin red)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRobots, robotsPermite, rutaDeUrl, sha256, esDescargable,
  extraeReglasDePlazo, fechaDePublicacion, calculaFin, indiciosPersonales, norm,
} from './lib.mjs';
import { textoDePdf, limpiaBoletin, selfTest as pdfSelfTest } from './pdf.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = 'https://tuyavivienda.es';
const UA = 'AldeaPucelaVivienda/1.0 (+https://vivienda.aldeapucela.org; proyecto vecinal sin ánimo de lucro)';
const PAUSA_MS = 2000;
const HOY = new Date().toISOString().slice(0, 10);

// Solo estos documentos se descargan. El resto se enlaza y punto.
const DESCARGABLES = ['bocyl', 'bop', 'correccion'];

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  const fallos = [...pdfSelfTest(), ...selfTest()];
  for (const f of fallos) console.error('✖', f);
  console.log(fallos.length ? `\n${fallos.length} fallos` : '✔ plazos: self-test en verde');
  process.exit(fallos.length ? 1 : 0);
}

await principal();

async function principal() {
  const indice = leeJson('data/promociones.json', { promociones: [] });
  const detalles = indice.promociones.map((p) => leeJson(`data/promociones/${p.id}.json`, null)).filter(Boolean);
  const cache = args.includes('--releer') ? {} : leeJson('data/documentos.json', { documentos: {} }).documentos;

  const robots = await pide(`${ORIGEN}/robots.txt`);
  const reglasRobots = parseRobots(robots.texto, UA);

  const documentos = { ...cache };
  let descargados = 0;

  for (const p of detalles) {
    for (const doc of p.documentos ?? []) {
      if (!DESCARGABLES.includes(doc.tipo)) continue;
      if (!esDescargable(doc.tipo)) continue;          // cinturón y tirantes
      if (documentos[doc.url]) continue;                // ya leído otro día
      if (!doc.url.startsWith(ORIGEN)) continue;        // solo desde la fuente permitida
      if (!robotsPermite(reglasRobots, rutaDeUrl(doc.url))) {
        console.log(`  · robots.txt no permite ${doc.url}: se salta`);
        continue;
      }

      await espera(PAUSA_MS);
      try {
        const pdf = await pide(doc.url, 'binario');
        documentos[doc.url] = analiza(pdf.buffer, { titulo: doc.titulo, tipo: doc.tipo });
        descargados++;
        const d = documentos[doc.url];
        console.log(`  · ${doc.titulo ?? doc.url.split('/').pop()} — publicado ${d.fecha_publicacion ?? '¿?'} — ${d.reglas.length} regla(s)`);
      } catch (e) {
        console.error(`  ✖ ${doc.url}: ${e.message}`);
      }
    }
  }

  const plazos = construyePlazos(detalles, documentos);
  guardaJson('data/documentos.json', { actualizado: HOY, documentos });
  guardaJson('data/plazos.json', { actualizado: HOY, plazos });

  console.log(`\n✔ plazos: ${plazos.length} extraídos de ${Object.keys(documentos).length} documentos (${descargados} nuevos)`);
  for (const z of plazos) {
    console.log(`  · ${z.promocion_id} · ${z.titulo}: ${z.fin ?? `sin fecha (${z.regla.cantidad} días ${z.regla.unidad} desde ${z.regla.ancla_texto ?? 'un hecho sin fecha conocida'})`}`);
  }
}

/** Lee un documento y se queda solo con lo que hace falta. El PDF no se guarda. */
export function analiza(buffer, { titulo, tipo }) {
  const texto = limpiaBoletin(textoDePdf(buffer));
  const reglas = extraeReglasDePlazo(texto)
    // Una cita jamás puede llevar datos personales (los boletines van firmados).
    .filter((r) => indiciosPersonales(r.cita).length === 0);
  return {
    titulo: titulo ?? null,
    tipo,
    sha256: sha256(buffer),
    fecha_publicacion: fechaDePublicacion(texto),
    leido: HOY,
    caracteres: texto.length,
    reglas,
  };
}

/**
 * Convierte las reglas en plazos con fecha. Un plazo anclado en «la publicación
 * en el BOP» se cuenta desde la fecha del propio BOP; si el ancla es un hecho
 * sin fecha conocida, el plazo se queda sin `fin` y la web enseña la regla.
 */
export function construyePlazos(detalles, documentos) {
  const plazos = [];

  for (const p of detalles) {
    const suyos = (p.documentos ?? []).map((d) => [d, documentos[d.url]]).filter(([, x]) => x);

    // Primero los documentos que son su propio ancla (fecha exacta): si el
    // mismo plazo aparece en dos boletines, gana el que da la fecha buena.
    const ordenados = suyos.slice().sort((a, b) =>
      (b[1].reglas.some((r) => r.ancla === b[0].tipo) ? 1 : 0) - (a[1].reglas.some((r) => r.ancla === a[0].tipo) ? 1 : 0));

    for (const [doc, info] of ordenados) {
      for (const regla of info.reglas) {
        const desde = fechaDelAncla(regla, doc, info, suyos);
        const fin = calculaFin(desde, regla.cantidad, regla.unidad);
        const id = `${p.id}:${regla.tipo}:${regla.cantidad}${regla.unidad[0]}`;
        if (plazos.some((z) => z.id === id)) continue;   // el mismo plazo sale en BOCYL y en BOP

        plazos.push({
          id,
          promocion_id: p.id,
          tipo: regla.tipo,
          titulo: regla.titulo,
          inicio: desde ? siguienteDia(desde) : null,
          fin,
          hora_limite: null,
          regla: {
            cantidad: regla.cantidad,
            unidad: regla.unidad,
            ancla: regla.ancla,
            ancla_texto: regla.ancla_texto,
            desde,
          },
          cita: regla.cita,
          confianza: fin ? (regla.unidad === 'naturales' ? 'alta' : 'media') : 'sin_fecha',
          fuente_url: doc.url,
          fuente_ref: doc.titulo ?? null,
          fuente_sha256: info.sha256,
          fuente_publicado: info.fecha_publicacion,
          extraido: info.leido,
          origen: 'automatico',
        });
      }
    }
  }

  return plazos.sort((a, b) => (a.fin ?? '9999').localeCompare(b.fin ?? '9999') || a.id.localeCompare(b.id, 'es'));
}

/**
 * ¿Desde qué día se cuenta este plazo?
 *
 * Si la regla se cuenta «desde la publicación en el BOP» y la hemos leído en el
 * propio BOP, la fecha es la de ese documento: exacta. Si la hemos leído en el
 * BOCYL, hay que buscar el BOP del mismo acuerdo, que es el que se publica
 * pocos días después; se coge el más cercano dentro de dos meses. Si no
 * aparece, no hay fecha: el plazo se queda con su regla y sin inventar nada.
 */
export function fechaDelAncla(regla, doc, info, documentosDeLaPromocion) {
  if (!regla.ancla) return null;
  if (regla.ancla === doc.tipo) return info.fecha_publicacion ?? null;

  const candidatos = documentosDeLaPromocion
    .filter(([d, x]) => d.tipo === regla.ancla && x?.fecha_publicacion)
    .map(([, x]) => x.fecha_publicacion);
  if (!candidatos.length || !info.fecha_publicacion) return null;

  const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const cercanos = candidatos
    .map((f) => ({ f, distancia: dias(info.fecha_publicacion, f) }))
    .filter((c) => c.distancia >= 0 && c.distancia <= 60)   // el boletín gemelo sale a los pocos días
    .sort((a, b) => a.distancia - b.distancia);
  return cercanos[0]?.f ?? null;
}

function siguienteDia(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ red ----

async function pide(url, modo = 'texto') {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return modo === 'binario' ? { buffer } : { texto: buffer.toString('utf8') };
}

function espera(ms) { return new Promise((r) => setTimeout(r, ms)); }

// -------------------------------------------------------------- ficheros ----

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

  const detalles = [{
    id: 'promo',
    documentos: [
      { url: 'https://tuyavivienda.es/bop.pdf', titulo: 'BOPVA-A-2026-00824', tipo: 'bop' },
      { url: 'https://tuyavivienda.es/lista.pdf', titulo: 'Listado de adjudicatarios', tipo: 'listado_nominal' },
    ],
  }];
  const documentos = {
    'https://tuyavivienda.es/bop.pdf': {
      titulo: 'BOPVA-A-2026-00824', tipo: 'bop', sha256: 'abc', fecha_publicacion: '2026-03-20', leido: '2026-08-13',
      reglas: [
        { tipo: 'solicitudes', titulo: 'Presentación de solicitudes', cantidad: 15, unidad: 'naturales', ancla: 'bop', ancla_texto: 'la publicación en el Boletín Oficial de la Provincia', cita: 'quince días naturales…' },
        { tipo: 'alegaciones', titulo: 'Alegaciones al listado', cantidad: 10, unidad: 'naturales', ancla: 'web', ancla_texto: 'la publicación en la web oficial', cita: 'diez días naturales…' },
      ],
    },
  };

  const plazos = construyePlazos(detalles, documentos);
  ok(plazos.length === 2, 'un plazo por regla');
  const solicitudes = plazos.find((z) => z.tipo === 'solicitudes');
  ok(solicitudes.fin === '2026-04-04', 'calcula el fin desde la fecha del boletín');
  ok(solicitudes.inicio === '2026-03-21', 'el plazo empieza al día siguiente de publicarse');
  ok(solicitudes.confianza === 'alta', 'días naturales con fecha conocida → confianza alta');
  const alegaciones = plazos.find((z) => z.tipo === 'alegaciones');
  ok(alegaciones.fin === null && alegaciones.confianza === 'sin_fecha',
    'sin fecha del hecho que lo dispara, no se inventa una fecha');
  ok(plazos.every((z) => z.fuente_url && z.cita), 'todo plazo lleva fuente y cita');
  ok(!plazos.some((z) => z.fuente_url.includes('lista.pdf')), 'ningún plazo sale de un listado nominal');

  // Una cita con nombres nunca se guarda
  const conNombre = analiza(Buffer.from('%PDF-1.4\n1 0 obj<</Length 10>>stream\nBT (En el plazo de diez días naturales para presentar solicitudes lo firma Pérez García, Lucía.) Tj ET\nendstream endobj'), { titulo: 'x', tipo: 'bop' });
  ok(conNombre.reglas.length === 0, 'una cita con algo que parece un nombre se descarta');

  const docBop = { tipo: 'bop' };
  const infoBop = { fecha_publicacion: '2026-03-20' };
  const docBocyl = { tipo: 'bocyl' };
  const infoBocyl = { fecha_publicacion: '2026-03-16' };
  const todos = [[docBop, infoBop], [docBocyl, infoBocyl], [{ tipo: 'bop' }, { fecha_publicacion: '2026-07-01' }]];
  const reglaBop = { ancla: 'bop' };
  ok(fechaDelAncla(reglaBop, docBop, infoBop, todos) === '2026-03-20', 'la regla leída en el propio BOP usa su fecha');
  ok(fechaDelAncla(reglaBop, docBocyl, infoBocyl, todos) === '2026-03-20',
    'la regla leída en el BOCYL busca el BOP gemelo, no el BOP de meses después');
  ok(fechaDelAncla({ ancla: 'web' }, docBocyl, infoBocyl, todos) === null, 'un ancla sin documento no da fecha');
  ok(fechaDelAncla({ ancla: 'bop' }, docBocyl, { fecha_publicacion: '2025-01-01' }, todos) === null,
    'un boletín demasiado lejano no sirve de ancla');

  ok(DESCARGABLES.every((t) => esDescargable(t)), 'la lista de descargables respeta el veto de los listados');
  ok(!DESCARGABLES.includes('listado_nominal'), 'listado_nominal nunca es descargable');
  ok(norm(' a  b ') === 'a b', 'norm');

  return fallos;
}
