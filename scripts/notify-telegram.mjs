#!/usr/bin/env node
// Peluditos — publica en Telegram un resumen de las fichas nuevas del último run.
// Lee new-posts.json (lo deja scripts/fetch.mjs) y envía al tema de mascotas del grupo
// Aldea Pucela un álbum con las fotos de las fichas y el resumen como pie. Las fotos se
// suben desde img/ (en el workflow el aviso sale antes de que Pages despliegue, así que
// las URLs de la web aún darían 404). Sin fichas nuevas o sin token no envía nada (exit 0).
//
// Uso:  TELEGRAM_BOT_TOKEN=xxx node scripts/notify-telegram.mjs
//       node scripts/notify-telegram.mjs --dry-run     (imprime el mensaje, no envía)
//       node scripts/notify-telegram.mjs --self-test
// Para probar en otro chat: TELEGRAM_CHAT_ID=<id> TELEGRAM_THREAD_ID='' (vacío = sin tema).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_POSTS = path.join(ROOT, 'new-posts.json');

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '@AldeaPucela';
// Tema del grupo (t.me/AldeaPucela/91148). Si Telegram devuelve "message thread not found",
// ese id es de mensaje y no de tema: ajustar TELEGRAM_THREAD_ID con el id real del tema.
const THREAD_ID = process.env.TELEGRAM_THREAD_ID ?? '91148';
const WEB = 'https://peluditos.aldeapucela.org';
const MAX_LINES = 12; // tope de fichas listadas; el resto se resume en "y N más"

const TIPO = {
  adopcion: '🏠 <b>Adopción</b>',
  acogida: '🤝 <b>Acogida</b>',
  perdido: '🚨 <b>Perdido</b>',
  donacion: '💝 <b>Donación</b>',
  evento: '📅 <b>Evento</b>',
  otro: '🐾',
};

const esc = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const brief = (s, n = 80) => {
  const c = (s || '').trim().replace(/\s+/g, ' ');
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
};

export function formatMessage(posts) {
  const n = posts.length;
  const header = `🐾 <b>${n === 1 ? 'Nueva ficha' : `${n} nuevas fichas`} de peluditos hoy</b>`;
  const lines = posts.slice(0, MAX_LINES).map((p) => {
    const tag = TIPO[p.tipo] || TIPO.otro;
    const text = brief(p.excerpt || p.caption) || p.shelter;
    return `${tag} — <a href="${esc(p.permalink)}">${esc(text)}</a> (${esc(p.shelter)})`;
  });
  if (n > MAX_LINES) lines.push(`… y ${n - MAX_LINES} más`);
  return `${header}\n\n${lines.join('\n\n')}\n\nTodas las fichas: ${WEB}`;
}

const CAPTION_MAX = 1024; // límite de Telegram para pies de foto (los mensajes admiten 4096)
const ALBUM_MAX = 10;     // máximo de fotos por álbum (sendMediaGroup)

const API_BASE = process.env.TELEGRAM_API || 'https://api.telegram.org'; // override para pruebas

async function tg(token, method, form) {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Telegram ${method} ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function baseForm() {
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  if (THREAD_ID) form.append('message_thread_id', THREAD_ID);
  return form;
}

// Primera miniatura de cada ficha (hasta ALBUM_MAX); una que falte no tumba el resto.
async function loadPhotos(posts) {
  const bufs = [];
  for (const p of posts.slice(0, ALBUM_MAX)) {
    if (!p.image) continue;
    try { bufs.push(await readFile(path.join(ROOT, p.image))); } catch { /* miniatura ausente */ }
  }
  return bufs;
}

// Álbum con las fotos y el resumen como pie. Si el resumen no cabe en un pie (1024) o no
// hay fotos, el resumen va como mensaje de texto normal (tras el álbum, si lo hay).
async function send(posts, text, token) {
  const photos = await loadPhotos(posts);
  const caption = text.length <= CAPTION_MAX ? text : null;

  if (photos.length >= 2) {
    const form = baseForm();
    const media = photos.map((buf, i) => {
      form.append(`p${i}`, new Blob([buf], { type: 'image/jpeg' }), `p${i}.jpg`);
      return { type: 'photo', media: `attach://p${i}` };
    });
    if (caption) Object.assign(media[0], { caption, parse_mode: 'HTML' });
    form.append('media', JSON.stringify(media));
    await tg(token, 'sendMediaGroup', form);
  } else if (photos.length === 1) {
    const form = baseForm();
    form.append('photo', new Blob([photos[0]], { type: 'image/jpeg' }), 'p0.jpg');
    if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML'); }
    await tg(token, 'sendPhoto', form);
  }

  if (!photos.length || !caption) {
    const form = baseForm();
    form.append('text', text);
    form.append('parse_mode', 'HTML');
    form.append('link_preview_options', JSON.stringify({ is_disabled: true }));
    await tg(token, 'sendMessage', form);
  }
  return photos.length;
}

async function main() {
  if (!existsSync(NEW_POSTS)) return console.log('Sin new-posts.json; nada que avisar');
  const posts = JSON.parse(await readFile(NEW_POSTS, 'utf8'));
  if (!posts.length) return console.log('0 fichas nuevas; nada que avisar');

  const text = formatMessage(posts);
  if (process.argv.includes('--dry-run')) {
    const fotos = posts.slice(0, ALBUM_MAX).map((p) => p.image).filter(Boolean);
    return console.log(`${text}\n\n[dry-run] fotos del álbum (${fotos.length}): ${fotos.join(', ') || 'ninguna'}`);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Sin secret configurado no rompemos el workflow: se avisa y ya.
  if (!token) return console.warn(`Sin TELEGRAM_BOT_TOKEN: no se envía el aviso (${posts.length} fichas nuevas)`);

  const nPhotos = await send(posts, text, token);
  console.log(`Aviso enviado a ${CHAT_ID}${THREAD_ID ? ` (tema ${THREAD_ID})` : ''}: ${posts.length} fichas, ${nPhotos} fotos`);
}

// ---------- self-test ----------
function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error('self-test FALLÓ: ' + m); };
  const post = (extra = {}) => ({ tipo: 'adopcion', caption: 'Bobby busca casa', shelter: 'Protectora X', permalink: 'https://instagram.com/p/x/', ...extra });

  const one = formatMessage([post()]);
  assert(one.includes('Nueva ficha'), 'singular en cabecera');
  assert(one.includes('🏠') && one.includes('Bobby busca casa') && one.includes('Protectora X'), 'línea con tipo, texto y protectora');
  assert(one.includes(WEB), 'incluye enlace a la web');

  const many = formatMessage(Array.from({ length: 15 }, () => post()));
  assert(many.includes('15 nuevas fichas'), 'plural en cabecera');
  assert(many.includes(')\n\n🏠'), 'línea en blanco entre ficha y ficha');
  assert(many.includes(`… y ${15 - MAX_LINES} más`), 'tope de líneas con resumen del resto');

  assert(formatMessage([post({ tipo: 'inventado' })]).includes('🐾 —'), 'tipo desconocido → fallback');
  assert(formatMessage([post({ caption: 'a <b> & c' })]).includes('a &lt;b&gt; &amp; c'), 'escapa HTML del caption');
  assert(formatMessage([post({ caption: 'x'.repeat(200) })]).includes('x'.repeat(79) + '…'), 'recorta el texto a 80');
  console.log('self-test OK');
}

if (process.argv.includes('--self-test')) selfTest();
else main().catch((e) => { console.error(e); process.exit(1); });
