#!/usr/bin/env node
// Ingesta de las fichas oficiales de promociones públicas (SOMACYL) hacia
// data/. Sin dependencias. Lo que hace y lo que NO hace:
//
//   ✔ lee robots.txt ANTES de pedir nada y se detiene si una ruta no está permitida
//   ✔ pide las fichas públicas de promoción, despacio y con user-agent identificable
//   ✔ guarda solo hechos: cifras, estados de ocupación, fechas y enlaces
//   ✘ NO descarga ningún PDF; los listados de admitidos/adjudicatarios llevan
//     nombres de personas y este proyecto solo los enlaza (ver CLAUDE.md)
//
// Uso:
//   node scripts/sync.mjs              ingesta real (red)
//   node scripts/sync.mjs --self-test  pruebas puras del parser (sin red)
//   node scripts/sync.mjs --fixtures   reprocesa fixtures/*.html (sin red)
//   node scripts/sync.mjs --limite 3   ingesta parcial, para probar

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFicha, parseRobots, robotsPermite, rutaDeUrl, sha256, selfTest, norm,
} from './lib.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = 'https://tuyavivienda.es';
const SITEMAP = `${ORIGEN}/post-sitemap.xml`;
const UA = 'AldeaPucelaVivienda/1.0 (+https://vivienda.aldeapucela.org; proyecto vecinal sin ánimo de lucro)';
const PAUSA_MS = 2000;   // una petición cada 2 s: la fuente no se entera
const HOY = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? true);
};

main().catch((e) => { console.error('✖', e.message); process.exit(1); });

async function main() {
  if (args.includes('--self-test')) return correrSelfTest();

  const fichas = args.includes('--fixtures') ? desdeFixtures() : await desdeOrigen();
  if (!fichas.length) throw new Error('no se ha podido leer ninguna ficha');

  // La ficha oficial suele traer la provincia entre paréntesis; para el resto
  // (localidades que no son capital) hay una tabla revisada a mano.
  const localidades = leeJson('config/localidades.json', { provincia_por_localidad: {} });
  const desconocidas = new Set();

  const promociones = fichas.map((f) => {
    const provincia = f.provincia ?? localidades.provincia_por_localidad?.[f.localidad] ?? null;
    if (f.localidad && !provincia) desconocidas.add(f.localidad);
    return { ...f, provincia };
  }).sort((a, b) => a.id.localeCompare(b.id, 'es'));

  escribeDetalle(promociones);
  escribeIndice(promociones);
  escribeFuentes(promociones);
  const cambios = actualizaHistorico(promociones);

  console.log(`\n✔ ${promociones.length} promociones · ${cambios} cambios de disponibilidad registrados hoy`);
  const conTabla = promociones.filter((p) => p.disponibilidad.publicada);
  console.log(`  ${conTabla.length} publican tabla de viviendas:`);
  for (const p of conTabla) {
    const d = p.disponibilidad;
    console.log(`  · ${p.id}: ${d.libres} libres / ${d.ocupadas} ocupadas / ${d.proximamente} próximamente (${d.total})`);
  }
  if (desconocidas.size) {
    console.log(`\n⚠ localidades sin provincia en config/localidades.json: ${[...desconocidas].join(', ')}`);
    console.log('  añádelas a mano (dato geográfico, no se inventa desde el script).');
  }
}

function correrSelfTest() {
  const fallos = selfTest();
  for (const f of fallos) console.error('✖', f);
  console.log(fallos.length ? `\n${fallos.length} fallos` : '✔ self-test en verde');
  process.exit(fallos.length ? 1 : 0);
}

// ------------------------------------------------------------------ red ----

async function desdeOrigen() {
  const robots = await pide(`${ORIGEN}/robots.txt`);
  const reglas = parseRobots(robots.texto, UA);
  const permitido = (url) => {
    if (!robotsPermite(reglas, rutaDeUrl(url))) {
      throw new Error(`robots.txt no permite ${url} — la ingesta se detiene (invariante 3)`);
    }
    return url;
  };

  const sitemap = await pide(permitido(SITEMAP));
  const urls = [...sitemap.texto.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => norm(m[1]));
  const limite = Number(opcion('--limite')) || urls.length;
  console.log(`sitemap: ${urls.length} fichas · se procesan ${Math.min(limite, urls.length)}`);

  const fichas = [];
  for (const url of urls.slice(0, limite)) {
    await espera(PAUSA_MS);
    const pagina = await pide(permitido(url));
    const ficha = parseFicha(pagina.texto, url);
    fichas.push({ ...ficha, capturado: HOY, sha256_pagina: pagina.sha256 });
    const d = ficha.disponibilidad;
    console.log(`  · ${ficha.id} — ${ficha.localidad ?? '¿?'} — ${d.publicada ? `${d.libres}/${d.total} libres` : 'sin tabla de viviendas'}`);
  }
  return fichas;
}

async function pide(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { texto: buf.toString('utf8'), sha256: sha256(buf) };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- ficheros ----

function desdeFixtures() {
  const dir = path.join(RAIZ, 'fixtures');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => {
    const buf = fs.readFileSync(path.join(dir, f));
    const url = `${ORIGEN}/${path.basename(f, '.html')}/`;
    return { ...parseFicha(buf.toString('utf8'), url), capturado: HOY, sha256_pagina: sha256(buf) };
  });
}

function escribeDetalle(promociones) {
  const dir = path.join(RAIZ, 'data/promociones');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !promociones.some((p) => `${p.id}.json` === f)) fs.rmSync(path.join(dir, f));
  }
  for (const p of promociones) guardaJson(`data/promociones/${p.id}.json`, p);
}

function escribeIndice(promociones) {
  guardaJson('data/promociones.json', {
    actualizado: HOY,
    fuente: ORIGEN,
    licencia_datos: 'CC BY-SA 4.0 (Aldea Pucela) · datos de hecho extraídos de fuentes oficiales',
    promociones: promociones.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      localidad: p.localidad,
      provincia: p.provincia,
      categoria: p.categoria,
      estado_obra: p.estado_obra,
      estado_procedimiento: p.estado_procedimiento,
      n_viviendas: p.n_viviendas,
      direccion: p.direccion,
      url_oficial: p.url_oficial,
      actualizado_fuente: p.actualizado_fuente,
      capturado: p.capturado,
      disponibilidad: p.disponibilidad,
      n_documentos: p.documentos.length,
    })),
  });
}

/** Registro de trazabilidad: qué documento se leyó, cuándo y con qué hash. */
function escribeFuentes(promociones) {
  const fuentes = [];
  for (const p of promociones) {
    fuentes.push({
      id: `pagina:${p.id}`, tipo: 'web', titulo: p.nombre, url: p.url_oficial,
      sha256: p.sha256_pagina, fecha_captura: p.capturado, descargado: true,
    });
    for (const d of p.documentos) {
      fuentes.push({
        id: `doc:${p.id}:${d.url.split('/').pop()}`, tipo: d.tipo, titulo: d.titulo, url: d.url,
        sha256: null, fecha_captura: p.capturado,
        // Los listados nominales no se descargan nunca: solo se enlazan.
        descargado: false,
      });
    }
  }
  guardaJson('data/fuentes.json', { actualizado: HOY, fuentes });
}

/**
 * Serie temporal de la ocupación. Es la respuesta honesta a «¿cómo va la
 * lista?»: cuántas viviendas quedaban libres cada día, según la propia fuente
 * oficial y sin tocar un solo dato personal.
 */
function actualizaHistorico(promociones) {
  const historico = leeJson('data/historico.json', { registros: [] });
  const registros = historico.registros ?? [];
  let cambios = 0;
  for (const p of promociones) {
    if (!p.disponibilidad.publicada) continue;
    const previos = registros.filter((r) => r.promocion_id === p.id);
    const ultimo = previos[previos.length - 1];
    const igual = ultimo && ultimo.libres === p.disponibilidad.libres &&
      ultimo.ocupadas === p.disponibilidad.ocupadas &&
      ultimo.proximamente === p.disponibilidad.proximamente;
    if (igual) continue;
    registros.push({
      fecha: HOY,
      promocion_id: p.id,
      total: p.disponibilidad.total,
      libres: p.disponibilidad.libres,
      proximamente: p.disponibilidad.proximamente,
      ocupadas: p.disponibilidad.ocupadas,
    });
    cambios++;
  }
  registros.sort((a, b) => (a.fecha + a.promocion_id).localeCompare(b.fecha + b.promocion_id, 'es'));
  guardaJson('data/historico.json', { actualizado: HOY, registros });
  return cambios;
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
