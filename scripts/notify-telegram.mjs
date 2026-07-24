#!/usr/bin/env node
// Peluditos — publica en Telegram un resumen de las fichas nuevas del último run.
// Lee new-posts.json (lo deja scripts/fetch.mjs) y envía un mensaje al tema de
// mascotas del grupo Aldea Pucela. Sin fichas nuevas o sin token no envía nada (exit 0).
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
  return `${header}\n\n${lines.join('\n')}\n\nTodas las fichas: ${WEB}`;
}

async function send(text, token) {
  const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (THREAD_ID) body.message_thread_id = Number(THREAD_ID);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function main() {
  if (!existsSync(NEW_POSTS)) return console.log('Sin new-posts.json; nada que avisar');
  const posts = JSON.parse(await readFile(NEW_POSTS, 'utf8'));
  if (!posts.length) return console.log('0 fichas nuevas; nada que avisar');

  const text = formatMessage(posts);
  if (process.argv.includes('--dry-run')) return console.log(text);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Sin secret configurado no rompemos el workflow: se avisa y ya.
  if (!token) return console.warn(`Sin TELEGRAM_BOT_TOKEN: no se envía el aviso (${posts.length} fichas nuevas)`);

  await send(text, token);
  console.log(`Aviso enviado a ${CHAT_ID}${THREAD_ID ? ` (tema ${THREAD_ID})` : ''}: ${posts.length} fichas`);
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
  assert(many.includes(`… y ${15 - MAX_LINES} más`), 'tope de líneas con resumen del resto');

  assert(formatMessage([post({ tipo: 'inventado' })]).includes('🐾 —'), 'tipo desconocido → fallback');
  assert(formatMessage([post({ caption: 'a <b> & c' })]).includes('a &lt;b&gt; &amp; c'), 'escapa HTML del caption');
  assert(formatMessage([post({ caption: 'x'.repeat(200) })]).includes('x'.repeat(79) + '…'), 'recorta el texto a 80');
  console.log('self-test OK');
}

if (process.argv.includes('--self-test')) selfTest();
else main().catch((e) => { console.error(e); process.exit(1); });
