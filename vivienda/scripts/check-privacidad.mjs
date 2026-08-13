#!/usr/bin/env node
// Test de privacidad: falla el build si en data/ aparece cualquier cosa que
// parezca un dato personal, o si alguien ha descargado un listado nominal.
// Es la red de seguridad del invariante 1 de CLAUDE.md. Se ejecuta en CI en
// cada PR y en cada actualización automática.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indiciosPersonales } from './lib.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problemas = [];

// 1. Ningún valor de data/ puede parecer un dato personal.
for (const fichero of jsons(path.join(RAIZ, 'data'))) {
  const datos = JSON.parse(fs.readFileSync(fichero, 'utf8'));
  recorre(datos, [], (ruta, valor) => {
    for (const indicio of indiciosPersonales(valor)) {
      problemas.push(`${rel(fichero)} → ${ruta.join('.')}: posible ${indicio} («${String(valor).slice(0, 60)}»)`);
    }
  });
}

// 2. Los listados con nombres se enlazan, nunca se descargan.
const fuentes = leeSiExiste(path.join(RAIZ, 'data/fuentes.json'));
for (const f of fuentes?.fuentes ?? []) {
  if (f.tipo === 'listado_nominal' && f.descargado) {
    problemas.push(`data/fuentes.json → ${f.id}: un listado nominal figura como descargado`);
  }
  if (f.tipo === 'listado_nominal' && f.sha256) {
    problemas.push(`data/fuentes.json → ${f.id}: hay hash de un listado nominal (implica que se leyó el fichero)`);
  }
}

// 3. Ningún plazo sin fuente ni con fecha rara (invariante 2: cero contenido
//    inventado). Un plazo mal puesto hace que alguien pierda una convocatoria.
const plazos = [
  ...(leeSiExiste(path.join(RAIZ, 'config/plazos.json'))?.plazos ?? []).map((z, i) => [`config/plazos.json → plazos[${i}]`, z]),
  ...(leeSiExiste(path.join(RAIZ, 'data/plazos.json'))?.plazos ?? []).map((z, i) => [`data/plazos.json → plazos[${i}]`, z]),
];
for (const [donde, z] of plazos) {
  if (!z.fuente_url) problemas.push(`${donde}: plazo sin 'fuente_url' (¿de dónde sale la fecha?)`);
  if (!z.promocion_id) problemas.push(`${donde}: plazo sin 'promocion_id'`);
  for (const campo of ['inicio', 'fin']) {
    const v = z[campo];
    if (v == null) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      problemas.push(`${donde}: '${campo}' no es una fecha AAAA-MM-DD válida («${v}»)`);
    }
  }
  if (z.inicio && z.fin && z.inicio > z.fin) problemas.push(`${donde}: el plazo termina antes de empezar`);
  if (z.cita && indiciosPersonales(z.cita).length) problemas.push(`${donde}: la cita del documento parece llevar datos personales`);
  // Un plazo automático sin la frase que lo respalda no es verificable.
  if (z.origen === 'automatico' && !z.cita) problemas.push(`${donde}: plazo extraído sin la cita literal del documento`);
}

// 4. No puede haber PDF guardados en el repo: no descargamos documentos.
for (const dir of ['data', 'fixtures', 'ingest']) {
  const base = path.join(RAIZ, dir);
  if (!fs.existsSync(base)) continue;
  for (const f of ficheros(base)) {
    if (f.toLowerCase().endsWith('.pdf')) problemas.push(`${rel(f)}: hay un PDF en el repositorio (ver invariante 1)`);
  }
}

if (problemas.length) {
  console.error('✖ El test de privacidad ha encontrado problemas:\n');
  for (const p of problemas) console.error(`  · ${p}`);
  console.error('\nNada de esto puede publicarse. Corrige el parser, no el test.');
  process.exit(1);
}
console.log('✔ privacidad: sin rastro de datos personales en data/');

// ------------------------------------------------------------- utilidades ----

function* ficheros(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* ficheros(p);
    else yield p;
  }
}

function* jsons(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of ficheros(dir)) if (f.endsWith('.json')) yield f;
}

function recorre(valor, ruta, visita) {
  if (valor == null) return;
  if (Array.isArray(valor)) valor.forEach((v, i) => recorre(v, [...ruta, i], visita));
  else if (typeof valor === 'object') for (const [k, v] of Object.entries(valor)) recorre(v, [...ruta, k], visita);
  else if (typeof valor === 'string') visita(ruta, valor);
}

function leeSiExiste(f) {
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function rel(f) {
  return path.relative(RAIZ, f);
}
