// Peluditos — utilidades compartidas por fetch.mjs (Instagram) e ingest-telegram.mjs.
// Sin efectos secundarios: solo funciones puras y la llamada a la IA. Node 20+, sin dependencias.

import { readFile } from 'node:fs/promises';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Recorta el texto a `n` caracteres (colapsando espacios) para el teaser de la tarjeta.
export function excerpt(caption, n = 180) {
  const c = (caption || '').trim().replace(/\s+/g, ' ');
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
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
export async function classifyWithAI(caption, imageFile, apiKey, model = 'gemini-2.5-flash-lite') {
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
