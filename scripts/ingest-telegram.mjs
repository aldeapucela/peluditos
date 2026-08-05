#!/usr/bin/env node
// Peluditos — ingiere en la web las fotos del subtema "Peluditos" del grupo de Telegram
// @AldeaPucela. Publica una foto si su pie lleva #webPeluditos, o si un ADMIN responde a la
// foto con #webPeluditos. Escribe en data/posts.json + img/ (misma forma que fetch.mjs).
// Node 20+, sin dependencias.
//
// Al publicar una foto, el bot RESPONDE a ese mensaje en Telegram con el enlace a su
// publicación en la web (#post-tg-<id>).
//
// Uso:  TELEGRAM_INGEST_BOT_TOKEN=xxx GEMINI_API_KEY=yyy node scripts/ingest-telegram.mjs
//       node scripts/ingest-telegram.mjs --dry-run         (muestra qué subiría, no escribe)
//       node scripts/ingest-telegram.mjs --reply-existing  (responde a las que YA están publicadas)
//       node scripts/ingest-telegram.mjs --self-test
//
// Usa un bot DEDICADO (TELEGRAM_INGEST_BOT_TOKEN); si no está, cae al TELEGRAM_BOT_TOKEN.
// Ese bot debe poder leer los mensajes del grupo (privacy mode desactivado o admin) y no
// tener un webhook puesto (getUpdates y webhook son excluyentes).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excerpt, classifyWithAI } from './lib.mjs';

const ROOT = process.env.PELUDITOS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'posts.json');
const IMG_DIR = path.join(ROOT, 'img');

const API_BASE = process.env.TELEGRAM_API || 'https://api.telegram.org'; // override para pruebas
const GROUP = process.env.TELEGRAM_GROUP || 'AldeaPucela';               // @usuario público del grupo
const THREAD_ID = Number(process.env.TELEGRAM_THREAD_ID || 91148);       // subtema "Peluditos"
const HASHTAG = '#webpeluditos';                                         // se compara en minúsculas
const SHELTER = 'Peluditos en Aldea Pucela';                             // etiqueta de fuente
const ZONE = 'Valladolid';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const WEB = 'https://peluditos.aldeapucela.org';

// ---------- helpers puros (cubiertos por --self-test) ----------

export const hasTag = (s) => (s || '').toLowerCase().includes(HASHTAG);
export const stripTag = (s) => (s || '').replace(/#webpeluditos/gi, '').replace(/\s+/g, ' ').trim();

// Enlace a la publicación en la web y texto del aviso que el bot responde en Telegram.
export function publishedReply(messageId) {
  const url = `${WEB}/#post-tg-${messageId}`;
  return { url, text: `🐾 <b>¡Publicado en Peluditos!</b>\n<a href="${url}">Ver la publicación en la web</a>` };
}

// Selecciona qué fotos publicar a partir de los mensajes (ya filtrados por grupo/subtema).
// Devuelve objetos { id, date, caption, photos } donde `photos` es un array de "arrays de
// tamaños" de Telegram (una entrada por imagen; para álbumes, todas las del grupo).
// - Una FOTO con #webPeluditos en su propio pie: la sube quien sea (opt-in del que comparte).
// - Un ADMIN que responde con #webPeluditos a una foto: sube la foto respondida.
export function pickTargets(messages, adminIds) {
  // Índice de álbumes (media_group_id → mensajes con foto, en orden de aparición).
  const albums = new Map();
  for (const m of messages) {
    if (m && m.photo && m.media_group_id) {
      if (!albums.has(m.media_group_id)) albums.set(m.media_group_id, []);
      albums.get(m.media_group_id).push(m);
    }
  }
  const targets = new Map(); // clave: id del post (dedup dentro del lote)
  const add = (photoMsg, caption) => {
    if (!photoMsg || !photoMsg.photo) return;
    const group = photoMsg.media_group_id ? (albums.get(photoMsg.media_group_id) || [photoMsg]) : [photoMsg];
    const base = group[0] || photoMsg; // el 1º del álbum define id y fecha
    if (targets.has(base.message_id)) return;
    targets.set(base.message_id, {
      id: base.message_id,
      date: new Date((base.date || photoMsg.date) * 1000).toISOString(),
      caption: stripTag(caption),
      photos: group.map((g) => g.photo),
    });
  };
  for (const m of messages) {
    if (!m) continue;
    if (m.photo && hasTag(m.caption)) { add(m, m.caption); continue; }          // foto autoetiquetada
    if (hasTag(m.text || m.caption) && m.reply_to_message && m.reply_to_message.photo
        && adminIds.has(m.from && m.from.id)) {                                  // admin aprueba por respuesta
      add(m.reply_to_message, m.reply_to_message.caption);
    }
  }
  return [...targets.values()];
}

// ---------- API de Telegram ----------

async function tg(token, method, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/bot${token}/${method}${qs ? '?' + qs : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.result;
}

// POST con cuerpo JSON (para sendMessage con HTML/enlaces).
async function tgSend(token, method, params) {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.result;
}

// Responde en el subtema, a la foto publicada, con el enlace a su publicación en la web.
async function sendPublishedReply(token, messageId) {
  const { url, text } = publishedReply(messageId);
  await tgSend(token, 'sendMessage', {
    chat_id: `@${GROUP}`,
    message_thread_id: THREAD_ID,
    reply_to_message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  return url;
}

async function adminIdSet(token) {
  try {
    const admins = await tg(token, 'getChatAdministrators', { chat_id: `@${GROUP}` });
    return new Set((admins || []).map((a) => a.user && a.user.id));
  } catch (e) {
    console.warn(`No pude leer administradores (${e.message}); las aprobaciones por respuesta quedan desactivadas`);
    return new Set();
  }
}

// Descarga la foto de mayor tamaño de un "array de tamaños" al fichero indicado.
async function downloadPhoto(token, sizes, filename) {
  const best = Array.isArray(sizes) ? sizes[sizes.length - 1] : null; // el último es el mayor
  if (!best || !best.file_id) return null;
  try {
    const { file_path } = await tg(token, 'getFile', { file_id: best.file_id });
    const res = await fetch(`${API_BASE}/file/bot${token}/${file_path}`);
    if (!res.ok) return null;
    await writeFile(path.join(IMG_DIR, filename), Buffer.from(await res.arrayBuffer()));
    return `img/${filename}`;
  } catch {
    return null; // una imagen que falle no tumba el resto
  }
}

// ---------- construcción del post ----------

export function buildPost(t, images) {
  return {
    id: `tg-${t.id}`,
    shelter: SHELTER,
    shelterUrl: `https://t.me/${GROUP}/${THREAD_ID}`,
    zone: ZONE,
    date: t.date,
    caption: t.caption,
    excerpt: excerpt(t.caption),
    image: images[0] || null,
    images,
    permalink: `https://t.me/${GROUP}/${THREAD_ID}/${t.id}`,
    source: 'telegram',
  };
}

async function main() {
  const token = process.env.TELEGRAM_INGEST_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_INGEST_BOT_TOKEN (o TELEGRAM_BOT_TOKEN)');
  const dryRun = process.argv.includes('--dry-run');
  const replyExisting = process.argv.includes('--reply-existing');

  const adminIds = await adminIdSet(token);
  const inSubtema = (m) => m && m.chat && m.chat.username === GROUP && Number(m.message_thread_id) === THREAD_ID;

  // getUpdates con guarda. offset=null → lo más antiguo no confirmado; offset=N → CONFIRMA (descarta
  // en el servidor) todo lo anterior a N y devuelve desde N. Un fallo (webhook → 409, privacy, red)
  // no debe tumbar el cron.
  async function fetchUpdates(offset) {
    try {
      return await tg(token, 'getUpdates', {
        ...(offset != null ? { offset: String(offset) } : {}),
        allowed_updates: '["message"]', timeout: '0', limit: '100',
      });
    } catch (e) {
      console.warn(`getUpdates falló (¿webhook o privacy?): ${e.message}.`);
      return null;
    }
  }

  if (dryRun) {
    // Diagnóstico: una sola lectura, SIN confirmar (no consume la cola). Solo ve el lote más antiguo.
    const updates = await fetchUpdates();
    if (!updates) return;
    const allMessages = updates.map((u) => u.message).filter(Boolean);
    const messages = allMessages.filter(inSubtema);
    const targets = pickTargets(messages, adminIds);
    console.log(`[dry-run] esperado: chat=@${GROUP} thread=${THREAD_ID} · updates=${updates.length} · mensajes=${allMessages.length} · admins=[${[...adminIds].join(',') || 'ninguno'}]`);
    for (const m of allMessages) {
      const r = m.reply_to_message;
      console.log(`  · chat=@${m.chat && m.chat.username} thread=${m.message_thread_id} topic=${m.is_topic_message} photo=${!!m.photo} reply=${!!r} replyPhoto=${!!(r && r.photo)} from=${m.from && m.from.id} admin=${adminIds.has(m.from && m.from.id)} tag=${hasTag(m.text || m.caption)}`);
    }
    console.log(`[dry-run] en subtema=${messages.length} · con #webPeluditos=${targets.length}`);
    console.log('[dry-run] nota: solo se muestra el lote más antiguo (≤100); el run normal drena toda la cola.');
    return;
  }

  const existing = existsSync(DATA) ? JSON.parse(await readFile(DATA, 'utf8')) : [];
  const seen = new Set(existing.map((p) => p.id));

  if (replyExisting) {
    // Uso puntual: responde el aviso "publicado" a las fotos que YA están en la web (sin confirmar).
    const updates = await fetchUpdates();
    if (!updates) return;
    const done = pickTargets(updates.map((u) => u.message).filter(inSubtema), adminIds).filter((t) => seen.has(`tg-${t.id}`));
    let n = 0;
    for (const t of done) {
      try { console.log(`Respuesta enviada a ${t.id} → ${await sendPublishedReply(token, t.id)}`); n++; }
      catch (e) { console.warn(`No pude responder a ${t.id}: ${e.message}`); }
    }
    console.log(`${n}/${done.length} respuestas enviadas (reply-existing)`);
    return;
  }

  // NORMAL: drena TODA la cola confirmando cada lote (avanza el offset en el servidor). Así el mucho
  // tráfico de OTROS subtemas del grupo no deja fuera las fotos del subtema Peluditos.
  await mkdir(IMG_DIR, { recursive: true });
  await mkdir(path.dirname(DATA), { recursive: true });

  const fresh = [];
  const flush = async () => writeFile(DATA, JSON.stringify([...fresh, ...existing].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), null, 2) + '\n');

  let offset = null;
  for (let guard = 0; guard < 300; guard++) {
    const updates = await fetchUpdates(offset); // offset del lote previo → lo confirma y trae el siguiente
    if (!updates) break;         // 409/error: no se confirma nada, se reintenta al próximo run
    if (!updates.length) break;  // cola drenada

    const before = fresh.length;
    for (const t of pickTargets(updates.map((u) => u.message).filter(inSubtema), adminIds)) {
      if (seen.has(`tg-${t.id}`)) continue;
      seen.add(`tg-${t.id}`);
      const images = [];
      for (const sizes of t.photos) {
        const saved = await downloadPhoto(token, sizes, images.length === 0 ? `tg-${t.id}.jpg` : `tg-${t.id}-${images.length + 1}.jpg`);
        if (saved) images.push(saved);
      }
      if (!images.length) { console.warn(`tg-${t.id}: sin imagen descargable, se salta`); continue; }
      const post = buildPost(t, images);
      if (process.env.GEMINI_API_KEY) {
        try {
          const r = await classifyWithAI(post.caption, path.join(ROOT, images[0]), process.env.GEMINI_API_KEY, GEMINI_MODEL);
          post.type = r.animal;
          post.tipo = r.tipo;
        } catch (e) {
          // Sin clasificar: el fetch.mjs diario la completará (procesa también estos posts).
          console.warn(`Clasificación falló para tg-${t.id} (se completará luego): ${e.message}`);
        }
      }
      fresh.push(post);
    }
    // Persistimos ANTES de confirmar el lote (el siguiente fetch lo confirma): a prueba de cortes.
    if (fresh.length > before) await flush();

    offset = updates[updates.length - 1].update_id + 1;
    if (updates.length < 100) { await fetchUpdates(offset); break; } // confirma el último lote y termina
  }

  if (!fresh.length) { console.log('Sin publicaciones nuevas de Telegram'); return; }
  console.log(`${fresh.length} publicaciones de Telegram añadidas a la portada`);

  // Responde en Telegram a cada foto publicada con el enlace a su publicación en la web.
  for (const p of fresh) {
    const messageId = Number(p.id.slice(3)); // "tg-<id>" → <id>
    try { console.log(`Respuesta 'publicado' enviada a ${messageId} → ${await sendPublishedReply(token, messageId)}`); }
    catch (e) { console.warn(`No pude responder a ${messageId}: ${e.message}`); }
  }
}

// ---------- self-test ----------
function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error('self-test FALLÓ: ' + m); };
  assert(hasTag('Perdida gata #webPeluditos hoy'), 'detecta el hashtag');
  assert(hasTag('mira #WEBPELUDITOS'), 'hashtag insensible a mayúsculas');
  assert(!hasTag('sin etiqueta'), 'sin hashtag → false');
  assert(stripTag('Perdida en Parquesol #webPeluditos') === 'Perdida en Parquesol', 'quita el hashtag');

  const photo = [{ file_id: 'a', width: 90 }, { file_id: 'b', width: 1280 }];
  const admins = new Set([1]);
  const msgs = [
    { message_id: 10, date: 1700000000, photo, caption: 'Gato perdido #webPeluditos' },      // autoetiquetada
    { message_id: 11, date: 1700000100, photo },                                              // foto sin tag → no
    { message_id: 20, date: 1700000200, photo, caption: 'foto de otro' },                     // será aprobada abajo
    { message_id: 21, date: 1700000300, from: { id: 1 }, text: '#webPeluditos', reply_to_message: { message_id: 20, date: 1700000200, photo, caption: 'foto de otro' } },
    { message_id: 31, date: 1700000400, from: { id: 9 }, text: '#webPeluditos', reply_to_message: { message_id: 30, date: 1, photo } }, // no admin → no
    { message_id: 40, date: 1700000500, media_group_id: 'g1', photo, caption: 'álbum #webPeluditos' },
    { message_id: 41, date: 1700000500, media_group_id: 'g1', photo },
  ];
  const t = pickTargets(msgs, admins);
  const ids = t.map((x) => x.id).sort((a, b) => a - b);
  assert(JSON.stringify(ids) === JSON.stringify([10, 20, 40]), 'selecciona autoetiquetada + aprobada por admin + álbum, e ignora sin-tag y no-admin (' + ids + ')');
  const album = t.find((x) => x.id === 40);
  assert(album.photos.length === 2, 'el álbum agrupa sus 2 fotos');
  assert(t.find((x) => x.id === 10).caption === 'Gato perdido', 'el pie se limpia del hashtag');
  const post = buildPost(t.find((x) => x.id === 10), ['img/tg-10.jpg']);
  assert(post.id === 'tg-10' && post.source === 'telegram' && post.shelter === SHELTER, 'buildPost: id/source/shelter');
  assert(post.permalink === `https://t.me/${GROUP}/${THREAD_ID}/10`, 'buildPost: permalink al mensaje');
  const rp = publishedReply(196182);
  assert(rp.url === `${WEB}/#post-tg-196182`, 'publishedReply: enlace a la publicación');
  assert(rp.text.includes(rp.url) && /Peluditos/.test(rp.text), 'publishedReply: texto con hipervínculo');
  console.log('self-test OK');
}

if (process.argv.includes('--self-test')) selfTest();
else main().catch((e) => { console.error(e); process.exit(1); });
