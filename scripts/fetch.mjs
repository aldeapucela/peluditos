#!/usr/bin/env node
// Peluditos — sincroniza las publicaciones recientes de las cuentas de Instagram
// de las protectoras hacia data/posts.json. Node 20+, sin dependencias.
//
// Uso:  IG_API_TOKEN=xxxx GEMINI_API_KEY=yyyy node scripts/fetch.mjs
//       node scripts/fetch.mjs --self-test

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELTERS = path.join(ROOT, 'shelters.json');
const DATA = path.join(ROOT, 'data', 'posts.json');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'archive');
const IMG_DIR = path.join(ROOT, 'img');

const CURRENT_DAYS = 122;       // portada: ~4 meses; lo más antiguo va al archivo por años
// Normalmente 2 días / 6 posts (solo lo recién publicado). Para el backfill puntual de
// una cuenta nueva se suben por env (p.ej. INGEST_MAX_DAYS=122 POSTS_PER_ACCOUNT=200).
const INGEST_MAX_DAYS = Number(process.env.INGEST_MAX_DAYS) || 2;
const POSTS_PER_ACCOUNT = Number(process.env.POSTS_PER_ACCOUNT) || 6;
// ONLY_USERS acota el fetch a esas cuentas (coma-separadas); vacío = todas. Así el
// backfill de una cuenta nueva no arrastra 4 meses de historia de las ya existentes.
const ONLY_USERS = (process.env.ONLY_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const GEMINI_MODEL = 'gemini-2.5-flash-lite';  // multimodal, barato/rápido, cuota diaria propia
const FAST = !!process.env.CLASSIFY_FAST;       // clave de pago sin límites → sin frenos (para backfill)
const CLASSIFY_DELAY_MS = FAST ? 400 : 7000;    // pausa entre clasificaciones (gratuita: < 10 req/min)
const MAX_CLASSIFY_PER_RUN = FAST ? 1000 : 60;  // techo por ejecución; el resto espera al siguiente run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers puros (cubiertos por --self-test) ----------

export function excerpt(caption, n = 180) {
  const c = (caption || '').trim().replace(/\s+/g, ' ');
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
}

// Separa en portada (últimos `days` días) y archivo (el resto).
export function partitionByAge(posts, now, days = CURRENT_DAYS) {
  const cutoff = now - days * 864e5;
  const current = [], older = [];
  for (const p of posts) (Date.parse(p.date) >= cutoff ? current : older).push(p);
  return { current, older };
}

// Agrupa por año (clave 'YYYY') a partir de la fecha ISO.
export function groupByYear(posts) {
  const by = {};
  for (const p of posts) {
    const y = (p.date || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) (by[y] ||= []).push(p);
  }
  return by;
}

// Carga todos los posts ya archivados (data/archive/YYYY.json).
async function loadArchivePosts() {
  if (!existsSync(ARCHIVE_DIR)) return [];
  const files = (await readdir(ARCHIVE_DIR)).filter((f) => /^\d{4}\.json$/.test(f));
  const arrs = await Promise.all(files.map((f) => readFile(path.join(ARCHIVE_DIR, f), 'utf8').then(JSON.parse)));
  return arrs.flat();
}

// ---------- proveedor de datos ----------
// AISLADO A PROPÓSITO: cambiar de servicio = editar SOLO esta función.
// Apify · actor "apify/instagram-scraper" · endpoint run-sync-get-dataset-items.
// Cada item trae: shortCode, caption, url, displayUrl, timestamp, ownerUsername.
// Nota: si tu plan trata resultsLimit como tope global (no por cuenta), súbelo.
async function fetchFromProvider(usernames, token) {
  const input = {
    directUrls: usernames.map((u) => `https://www.instagram.com/${u}/`),
    resultsType: 'posts',
    resultsLimit: POSTS_PER_ACCOUNT,
    addParentData: false,
  };
  const url = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=300`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items = await res.json();
  return items
    .map((it) => ({
      shortCode: it.shortCode,
      caption: it.caption || '',
      permalink: it.url || (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : null),
      imageUrl: it.displayUrl || (Array.isArray(it.images) && it.images[0]) || null,
      date: it.timestamp,
      username: (it.ownerUsername || '').toLowerCase(),
    }))
    .filter((p) => p.shortCode && p.date);
}

async function downloadImage(imageUrl, id) {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    await writeFile(path.join(IMG_DIR, `${id}.jpg`), Buffer.from(await res.arrayBuffer()));
    return `img/${id}.jpg`;
  } catch {
    return null; // una imagen que falla no tumba el resto
  }
}

// ---------- clasificación por IA (animal + tipo de publicación) ----------
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ANIMALS = ['perro', 'gato', 'otro'];
const TIPOS = ['adopcion', 'acogida', 'perdido', 'donacion', 'evento', 'otro'];

// Extrae { animal, tipo } de la respuesta del modelo (tolerante a markdown/texto alrededor).
export function parseClassification(text) {
  let animal = 'otro', tipo = 'otro';
  const m = (text || '').match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      animal = norm(j.animal);
      tipo = norm(j.tipo);
    } catch { /* deja los valores por defecto */ }
  }
  if (!ANIMALS.includes(animal)) animal = 'otro';
  if (!TIPOS.includes(tipo)) tipo = 'otro';
  return { animal, tipo };
}

// AISLADO A PROPÓSITO: cambiar de proveedor de IA = editar SOLO esta función.
// Gemini multimodal: mira la imagen Y el texto (incluido el de los carteles).
// Devuelve { animal, tipo } en una sola llamada (no duplica consumo de cuota).
async function classifyWithAI(caption, imageFile, apiKey) {
  const prompt =
    'Eres un clasificador para una web que agrega publicaciones de protectoras de animales de Valladolid. ' +
    'Mira la imagen Y el texto y responde SOLO con un JSON compacto, sin markdown, con dos campos: ' +
    '{"animal":"perro|gato|otro","tipo":"adopcion|acogida|perdido|donacion|evento|otro"}. ' +
    'animal = el animal protagonista ("otro" si es otro animal o no hay animal claro). ' +
    'tipo = el propósito de la publicación: ' +
    'adopcion (se busca familia definitiva); ' +
    'acogida (se busca hogar temporal o casa de acogida hasta que se adopte); ' +
    'perdido (animal perdido, desaparecido, extraviado o encontrado; se pide ayuda para localizarlo); ' +
    'donacion (se piden donaciones, ayudas, dinero, comida o recursos); ' +
    'evento (mercadillo solidario, feria, exposición, mesa informativa u otro evento); ' +
    'otro (no encaja en las anteriores). ' +
    'Texto de la publicación: ' + (caption || '(sin texto)');

  const parts = [{ text: prompt }];
  if (imageFile) {
    try {
      const b64 = (await readFile(imageFile)).toString('base64');
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
    } catch { /* sin imagen legible: se clasifica solo por texto */ }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    contents: [{ parts }],
    // thinkingBudget:0 es CLAVE: 2.5-flash "piensa" por defecto y ese pensamiento
    // consume maxOutputTokens, devolviendo texto vacío (finishReason MAX_TOKENS).
    generationConfig: { temperature: 0, maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } },
  });

  // 429 = cuota real → aborta el run. 5xx = sobrecarga transitoria del modelo
  // ("high demand"): reintenta con backoff y, si insiste, salta este post (sigue el resto).
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.status === 429) {
      const bodyText = await res.text();
      const m = bodyText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
      const delaySec = m ? Math.ceil(parseFloat(m[1])) : null;
      // retryDelay corto = límite por minuto → espera y reintenta; largo/ausente = límite diario → aborta.
      if (delaySec !== null && delaySec <= 90) { await sleep((delaySec + 2) * 1000); continue; }
      const e = new Error('429 ' + bodyText.replace(/\s+/g, ' ').slice(0, 300));
      e.quotaExceeded = true;
      throw e;
    }
    if (res.status >= 500) { lastErr = String(res.status); await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || []).map((x) => x.text || '').join(' ');
    if (!text.trim()) console.warn(`Gemini: respuesta vacía (finishReason=${cand?.finishReason})`);
    return parseClassification(text);
  }
  throw new Error(`Gemini ${lastErr} sobrecarga; se salta y se reintenta en el próximo run`);
}

// Clasifica los posts a los que falta `type` o `tipo` (nuevos + backfill de los existentes).
async function classifyMissing(posts, apiKey) {
  const pending = posts.filter((p) => p.type === undefined || p.tipo === undefined);
  if (!pending.length) return 0;
  if (!apiKey) {
    console.warn(`Sin GEMINI_API_KEY: ${pending.length} posts quedan sin clasificar (se reintentará)`);
    return 0;
  }
  let done = 0;
  for (const p of pending.slice(0, MAX_CLASSIFY_PER_RUN)) {
    const imageFile = p.image ? path.join(ROOT, p.image) : null;
    try {
      const r = await classifyWithAI(p.caption, imageFile, apiKey);
      p.type = r.animal;
      p.tipo = r.tipo;
      done++;
    } catch (e) {
      if (e.quotaExceeded) {
        console.warn(`Cuota de Gemini agotada (${e.message}); quedan ${pending.length - done} para la próxima ejecución`);
        break; // solo abortamos por cuota real (429)
      }
      console.error(`Clasificación falló para ${p.id} (se salta): ${e.message}`); // 503/otros → siguiente post
    }
    await sleep(CLASSIFY_DELAY_MS);
  }
  return done;
}

async function main() {
  const token = process.env.IG_API_TOKEN;
  if (!token) throw new Error('Falta la variable IG_API_TOKEN');

  const shelters = JSON.parse(await readFile(SHELTERS, 'utf8'));
  const byUser = new Map(shelters.map((s) => [s.username.toLowerCase(), s]));

  await mkdir(IMG_DIR, { recursive: true });
  await mkdir(path.dirname(DATA), { recursive: true });

  const current = existsSync(DATA) ? JSON.parse(await readFile(DATA, 'utf8')) : [];
  const existing = [...current, ...(await loadArchivePosts())];
  const seen = new Set(existing.map((p) => p.id));

  const targetUsers = ONLY_USERS.length ? ONLY_USERS.filter((u) => byUser.has(u)) : [...byUser.keys()];

  let raw = [];
  if (ONLY_USERS.length) {
    // Backfill: una llamada por cuenta. El endpoint run-sync de Apify corta a los 300s;
    // pedir muchos posts de varias cuentas a la vez lo supera (run-timeout-exceeded).
    // ponytail: por-cuenta solo en backfill; el cron normal (pocos posts) sigue en una llamada.
    for (const u of targetUsers) {
      try {
        raw.push(...(await fetchFromProvider([u], token)));
      } catch (e) {
        console.error(`Fetch falló para ${u} (se salta): ${e.message}`);
      }
    }
  } else {
    try {
      raw = await fetchFromProvider(targetUsers, token);
    } catch (e) {
      console.error('Fetch falló, conservo los datos previos:', e.message);
    }
  }

  const fresh = [];
  const ingestCutoff = Date.now() - INGEST_MAX_DAYS * 864e5;
  for (const p of raw) {
    if (seen.has(p.shortCode)) continue;
    if (Date.parse(p.date) < ingestCutoff) continue; // solo lo recién publicado; no arrastramos días anteriores
    const shelter = byUser.get(p.username);
    if (!shelter) continue; // item de una cuenta que no está en shelters.json
    seen.add(p.shortCode);
    fresh.push({
      id: p.shortCode,
      shelter: shelter.name,
      shelterUrl: shelter.instagramUrl,
      zone: shelter.zone || '',
      date: p.date,
      caption: p.caption,
      excerpt: excerpt(p.caption),
      image: await downloadImage(p.imageUrl, p.shortCode),
      permalink: p.permalink,
    });
  }

  const all = [...fresh, ...existing];
  const classified = await classifyMissing(all, process.env.GEMINI_API_KEY);

  const byDateDesc = (a, b) => Date.parse(b.date) - Date.parse(a.date);
  const { current: portada, older } = partitionByAge(all, Date.now());
  portada.sort(byDateDesc);
  await writeFile(DATA, JSON.stringify(portada, null, 2) + '\n');

  // Archivo por años: un fichero por año + índice de años disponibles.
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const byYear = groupByYear(older);
  const years = Object.keys(byYear).sort().reverse();
  for (const y of years) {
    byYear[y].sort(byDateDesc);
    await writeFile(path.join(ARCHIVE_DIR, `${y}.json`), JSON.stringify(byYear[y], null, 2) + '\n');
  }
  await writeFile(
    path.join(ARCHIVE_DIR, 'index.json'),
    JSON.stringify(years.map((y) => ({ year: Number(y), count: byYear[y].length })), null, 2) + '\n'
  );
  // borra ficheros de años que hayan quedado sin posts
  const yearSet = new Set(years.map((y) => `${y}.json`));
  for (const f of (await readdir(ARCHIVE_DIR)).filter((f) => /^\d{4}\.json$/.test(f))) {
    if (!yearSet.has(f)) await unlink(path.join(ARCHIVE_DIR, f)).catch(() => {});
  }

  // ponytail: conservamos imágenes de portada Y archivo (crecen ~100MB/año; poner tope si molesta).
  // Solo podamos imágenes de posts (.jpg) ya caducadas. Todo lo demás (logo.svg,
  // placeholder.svg, la carpeta shelters/, hero.jpg, og.jpg) queda intacto.
  const keep = new Set(all.map((p) => p.image && path.basename(p.image)).filter(Boolean));
  for (const f of await readdir(IMG_DIR)) {
    if (!f.endsWith('.jpg')) continue;
    if (f === 'hero.jpg' || f === 'og.jpg' || keep.has(f)) continue;
    await unlink(path.join(IMG_DIR, f)).catch(() => {});
  }

  console.log(`${fresh.length} nuevos · ${classified} clasificados · portada ${portada.length} · archivo ${older.length}`);
}

// ---------- self-test ----------
function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error('self-test FALLÓ: ' + m); };
  assert(excerpt('a'.repeat(200)).length === 180, 'excerpt corta a 180');
  assert(excerpt('hola') === 'hola', 'excerpt corto intacto');
  const part = partitionByAge([{ date: new Date().toISOString() }, { date: '2000-01-01' }], Date.now());
  assert(part.current.length === 1 && part.older.length === 1, 'partitionByAge separa por edad');
  assert(groupByYear([{ date: '2026-03-01T00:00:00Z' }, { date: '2025-12-01T00:00:00Z' }])['2026'].length === 1, 'groupByYear clave YYYY');
  assert(parseClassification('{"animal":"perro","tipo":"adopcion"}').tipo === 'adopcion', 'parse ok');
  assert(parseClassification('{"animal":"Gato","tipo":"Adopción"}').tipo === 'adopcion', 'parse normaliza acentos/mayus');
  assert(parseClassification('```json {"animal":"otro","tipo":"evento"} ```').tipo === 'evento', 'parse tolera markdown');
  assert(parseClassification('sin json aquí').animal === 'otro', 'parse fallback');
  assert(parseClassification('{"animal":"x","tipo":"y"}').tipo === 'otro', 'valores invalidos → otro');
  console.log('self-test OK');
}

if (process.argv.includes('--self-test')) selfTest();
else main().catch((e) => { console.error(e); process.exit(1); });
