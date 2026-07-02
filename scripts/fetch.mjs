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
const IMG_DIR = path.join(ROOT, 'img');

const RETENTION_DAYS = 45;      // solo "lo nuevo": se poda lo más antiguo
const POSTS_PER_ACCOUNT = 6;    // últimos posts a pedir por cuenta en cada ejecución
const GEMINI_MODEL = 'gemini-2.5-flash';  // modelo multimodal del tier gratuito
const CLASSIFY_DELAY_MS = 6000; // pausa entre clasificaciones (respeta el límite req/min)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers puros (cubiertos por --self-test) ----------

export function excerpt(caption, n = 180) {
  const c = (caption || '').trim().replace(/\s+/g, ' ');
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
}

export function prune(posts, now, days = RETENTION_DAYS) {
  const cutoff = now - days * 864e5;
  return posts.filter((p) => Date.parse(p.date) >= cutoff);
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

// ---------- clasificación por IA (perro / gato / otro) ----------
// AISLADO A PROPÓSITO: cambiar de proveedor de IA = editar SOLO esta función.
// Gemini multimodal: mira la imagen Y el texto (incluido el texto de carteles).
async function classifyWithAI(caption, imageFile, apiKey) {
  const prompt =
    'Clasifica esta publicación de Instagram de una protectora de animales. ' +
    'Fíjate en la imagen y en el texto y responde con UNA sola palabra en minúsculas: ' +
    '"perro" si el animal protagonista es un perro, "gato" si es un gato, ' +
    '"otro" para cualquier otro animal o si no hay un animal claro (carteles, eventos, comida, logos...). ' +
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
    generationConfig: { temperature: 0, maxOutputTokens: 10 },
  });

  // ponytail: 3 reintentos con backoff para 429/5xx; suficiente para el volumen diario.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').toLowerCase();
    if (text.includes('perro')) return 'perro';
    if (text.includes('gato')) return 'gato';
    return 'otro';
  }
  throw new Error('Gemini: agotados los reintentos (429/5xx)');
}

// Clasifica los posts que aún no tienen `type` (nuevos + backfill de los existentes).
async function classifyMissing(posts, apiKey) {
  const pending = posts.filter((p) => p.type === undefined);
  if (!pending.length) return 0;
  if (!apiKey) {
    console.warn(`Sin GEMINI_API_KEY: ${pending.length} posts quedan sin clasificar (se reintentará)`);
    return 0;
  }
  let done = 0;
  for (const p of pending) {
    const imageFile = p.image ? path.join(ROOT, p.image) : null;
    try {
      p.type = await classifyWithAI(p.caption, imageFile, apiKey);
      done++;
    } catch (e) {
      console.error(`Clasificación falló para ${p.id}:`, e.message); // sin type → se reintenta la próxima vez
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

  const existing = existsSync(DATA) ? JSON.parse(await readFile(DATA, 'utf8')) : [];
  const seen = new Set(existing.map((p) => p.id));

  let raw = [];
  try {
    raw = await fetchFromProvider([...byUser.keys()], token);
  } catch (e) {
    console.error('Fetch falló, conservo los datos previos:', e.message);
  }

  const fresh = [];
  for (const p of raw) {
    if (seen.has(p.shortCode)) continue;
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

  const merged = prune([...fresh, ...existing], Date.now()).sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date)
  );

  const classified = await classifyMissing(merged, process.env.GEMINI_API_KEY);

  await writeFile(DATA, JSON.stringify(merged, null, 2) + '\n');

  // poda de imágenes huérfanas (posts ya caducados)
  const keep = new Set(merged.map((p) => p.image && path.basename(p.image)).filter(Boolean));
  for (const f of await readdir(IMG_DIR)) {
    if (f === 'placeholder.svg' || keep.has(f)) continue;
    await unlink(path.join(IMG_DIR, f)).catch(() => {});
  }

  console.log(`${fresh.length} nuevos · ${classified} clasificados · ${merged.length} totales`);
}

// ---------- self-test ----------
function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error('self-test FALLÓ: ' + m); };
  assert(excerpt('a'.repeat(200)).length === 180, 'excerpt corta a 180');
  assert(excerpt('hola') === 'hola', 'excerpt corto intacto');
  assert(prune([{ date: new Date().toISOString() }, { date: '2000-01-01' }], Date.now()).length === 1, 'prune elimina viejos');
  console.log('self-test OK');
}

if (process.argv.includes('--self-test')) selfTest();
else main().catch((e) => { console.error(e); process.exit(1); });
