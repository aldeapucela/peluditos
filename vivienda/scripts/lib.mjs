// Utilidades puras del proyecto: parseo de las fichas oficiales, lectura de
// robots.txt y heurísticas de privacidad. Sin dependencias y sin red: todo lo
// que hay aquí se puede probar con `node scripts/sync.mjs --self-test`.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------- texto ----

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª',
  euro: '€', deg: '°', sup2: '²', middot: '·',
};

export function decodificaEntidades(s = '') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : m));
}

/** Quita etiquetas y normaliza espacios. */
export function texto(html = '') {
  return norm(decodificaEntidades(String(html).replace(/<[^>]*>/g, ' ')));
}

export function norm(s = '') {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** "63,67" → 63.67 · "1.234" → 1234 · "" → null */
export function numero(s) {
  if (s == null) return null;
  const limpio = String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  if (!limpio || Number.isNaN(Number(limpio))) return null;
  return Number(limpio);
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Convierte un título oficial en un identificador estable y legible. */
export function slug(s = '') {
  return norm(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// --------------------------------------------------------------- robots ----

/**
 * Parser mínimo de robots.txt: devuelve las reglas del grupo que aplica al
 * agente indicado (con respaldo en el grupo `*`).
 */
export function parseRobots(txt = '', agente = '*') {
  const grupos = [];
  let actual = null;
  for (const linea of String(txt).split(/\r?\n/)) {
    const l = linea.replace(/#.*$/, '').trim();
    if (!l) continue;
    const [claveBruta, ...resto] = l.split(':');
    const clave = claveBruta.trim().toLowerCase();
    const valor = resto.join(':').trim();
    if (clave === 'user-agent') {
      if (!actual || actual.reglas.length) { actual = { agentes: [], reglas: [] }; grupos.push(actual); }
      actual.agentes.push(valor.toLowerCase());
    } else if ((clave === 'disallow' || clave === 'allow') && actual) {
      actual.reglas.push({ tipo: clave, ruta: valor });
    }
  }
  const ua = agente.toLowerCase();
  const propio = grupos.find((g) => g.agentes.some((a) => a !== '*' && ua.includes(a)));
  const comodin = grupos.find((g) => g.agentes.includes('*'));
  return (propio || comodin || { reglas: [] }).reglas;
}

/**
 * ¿Permite robots.txt pedir esta ruta? Gana la regla más específica (la de
 * patrón más largo) y, en caso de empate, `Allow`, como hacen los buscadores.
 */
export function robotsPermite(reglas, ruta) {
  let mejor = null;
  for (const r of reglas) {
    if (!r.ruta) continue; // "Disallow:" vacío = permite todo
    if (!coincideRuta(r.ruta, ruta)) continue;
    if (!mejor || r.ruta.length > mejor.ruta.length ||
        (r.ruta.length === mejor.ruta.length && r.tipo === 'allow')) mejor = r;
  }
  return !mejor || mejor.tipo === 'allow';
}

function coincideRuta(patron, ruta) {
  const finalExacto = patron.endsWith('$');
  const p = finalExacto ? patron.slice(0, -1) : patron;
  const partes = p.split('*');
  let i = 0;
  for (let n = 0; n < partes.length; n++) {
    const trozo = partes[n];
    if (!trozo) continue;
    const encontrado = n === 0 ? (ruta.startsWith(trozo) ? 0 : -1) : ruta.indexOf(trozo, i);
    if (encontrado === -1) return false;
    i = encontrado + trozo.length;
  }
  return finalExacto ? i === ruta.length : true;
}

// ------------------------------------------------------------ documentos ----

/**
 * Clasifica un documento oficial por su título y URL.
 * `listado_nominal` es la categoría crítica: son los PDF con nombres de
 * solicitantes o adjudicatarios. Se enlazan, NUNCA se descargan ni se parsean
 * (invariante 1 de CLAUDE.md).
 */
export function clasificaDocumento(titulo = '', url = '') {
  const t = `${titulo} ${url}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(adjudicatario|listado|lista (definitiva|provisional)|admitidos|excluidos|sorteo|reserva)/.test(t)) return 'listado_nominal';
  if (/bocyl/.test(t)) return 'bocyl';
  if (/(bopva|bop|boletin oficial de la provincia)/.test(t)) return 'bop';
  if (/(correccion|errores)/.test(t)) return 'correccion';
  if (/(faq|preguntas frecuentes|procedimiento)/.test(t)) return 'procedimiento';
  if (/(memoria|calidades|ficha|coliving|plano|revsup)/.test(t)) return 'tecnico';
  return 'otro';
}

/** Documentos que el proyecto no puede descargar bajo ningún supuesto. */
export function esDescargable(tipo) {
  return tipo !== 'listado_nominal';
}

// --------------------------------------------------------- ficha oficial ----

const ESTADOS_VIVIENDA = ['libre', 'proximamente', 'ocupada'];

/**
 * Extrae los datos de hecho de una ficha de promoción de tuyavivienda.es.
 * Solo cifras, estados y referencias documentales: la fuente no publica datos
 * personales en esta página y el parser tampoco los buscaría.
 */
export function parseFicha(html, url) {
  const infos = mapaInformacion(html);
  const bloques = toggles(html);

  const viviendas = [];
  const documentos = [];
  for (const b of bloques) {
    if (b.html.includes('vivienda-fila-datos')) {
      for (const v of parseViviendas(b.html)) viviendas.push({ portal: b.titulo, ...v });
    } else {
      const pdf = primerPdf(b.html);
      if (pdf) documentos.push(documento(b.titulo, pdf));
    }
  }
  // Enlaces destacados fuera de los desplegables (FAQ, listado de adjudicatarios…)
  for (const [titulo, href] of ctas(html)) {
    if (!href.toLowerCase().endsWith('.pdf')) continue;
    if (documentos.some((d) => d.url === href)) continue;
    documentos.push(documento(titulo, href));
  }
  // Viviendas sueltas (promociones sin desplegables por portal)
  if (!viviendas.length) {
    for (const v of parseViviendas(html)) viviendas.push({ portal: null, ...v });
  }

  const seccion = entre(html, '"articleSection":"', '"');
  const titulo = texto((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const { localidad, provincia } = partirLocalidad(infos.get('localidad'));

  return {
    id: slug(rutaDeUrl(url).replace(/^\/|\/$/g, '')),
    nombre: titulo || null,
    url_oficial: url,
    categoria: infos.get('categoria') || null,
    estado_procedimiento: estadoProcedimiento(seccion),
    estado_obra: infos.get('estado de la obra') || null,
    n_viviendas: numero(infos.get('numero de viviendas')),
    localidad,
    provincia,
    direccion: infos.get('direccion') || null,
    publicado_fuente: entre(html, '"datePublished":"', '"') || null,
    actualizado_fuente: entre(html, '"dateModified":"', '"') || null,
    documentos,
    viviendas,
    disponibilidad: resumeDisponibilidad(viviendas),
  };
}

/** Las nueve capitales: si la localidad es una de ellas, la provincia es la misma. */
export const CAPITALES = ['Ávila', 'Burgos', 'León', 'Palencia', 'Salamanca', 'Segovia', 'Soria', 'Valladolid', 'Zamora'];

/**
 * "Medina del Campo (Valladolid)" → { localidad: 'Medina del Campo', provincia: 'Valladolid' }
 * "Ponferrada" → { localidad: 'Ponferrada', provincia: null }  (va a config/localidades.json)
 */
export function partirLocalidad(bruto) {
  if (!bruto) return { localidad: null, provincia: null };
  const m = norm(bruto).match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { localidad: norm(m[1]), provincia: norm(m[2]) };
  const localidad = norm(bruto);
  return { localidad, provincia: CAPITALES.includes(localidad) ? localidad : null };
}

function documento(titulo, url) {
  const tipo = clasificaDocumento(titulo, url);
  return { titulo: titulo || null, url, tipo, descargable: esDescargable(tipo) };
}

/** "Alquiler, Procedimiento cerrado" → "cerrado" */
function estadoProcedimiento(seccion) {
  const s = (seccion || '').toLowerCase();
  if (/procedimiento cerrado/.test(s)) return 'cerrado';
  if (/procedimiento abierto|plazo abierto/.test(s)) return 'abierto';
  if (/proximamente|próximamente/.test(s)) return 'proximamente';
  return null;
}

/** Los pares "Etiqueta: valor" del bloque «Información». */
function mapaInformacion(html) {
  const mapa = new Map();
  const re = /vivienda-info-punto[\s\S]*?<p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const linea = texto(m[1]);
    const i = linea.indexOf(':');
    if (i === -1) continue;
    const clave = linea.slice(0, i).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    mapa.set(clave, norm(linea.slice(i + 1)));
  }
  return mapa;
}

/** Desplegables de la ficha: portales de viviendas y documentos oficiales. */
function toggles(html) {
  const salida = [];
  const partes = html.split(/<div class="toggle /);
  for (const parte of partes.slice(1)) {
    const titulo = texto((parte.match(/class="toggle-heading"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '');
    salida.push({ titulo: titulo || null, html: parte });
  }
  return salida;
}

function ctas(html) {
  const salida = [];
  const re = /<a[^>]+class="link_text"[^>]*href="([^"]*)"[^>]*>[\s\S]*?<span class="text">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    const titulo = texto(m[2]);
    if (href && titulo && titulo.toLowerCase() !== 'ver documento') salida.push([titulo, href]);
  }
  return salida;
}

function primerPdf(html) {
  const m = html.match(/href="([^"]+\.pdf)"/i);
  return m ? m[1] : null;
}

/**
 * Tabla de viviendas: una fila por vivienda con su estado de ocupación.
 * Se ignora la leyenda (LIBRE/PRÓXIMAMENTE/OCUPADA), que repite las clases
 * fuera de las filas de datos.
 */
export function parseViviendas(html) {
  const filas = html.split(/vivienda-fila-datos/).slice(1);
  const salida = [];
  for (const filaBruta of filas) {
    // La leyenda (LIBRE/PRÓXIMAMENTE/OCUPADA) va detrás de la última fila de
    // cada portal y repite las mismas clases: si no se corta aquí, contamina
    // el estado de esa última vivienda.
    const corte = filaBruta.indexOf('vivienda-leyenda-estado');
    const fila = corte === -1 ? filaBruta : filaBruta.slice(0, corte);
    const estado = ESTADOS_VIVIENDA.find((e) => fila.includes(`vivienda-fila-estado ${e}`)) || null;
    const piso = celda(fila, 'piso');
    if (!estado && !piso) continue;
    salida.push({
      piso,
      estado,
      habitaciones: numero(celda(fila, 'hab')),
      m2: numero(celda(fila, 'metros')),
      precio_eur_mes: numero(celda(fila, 'precio')),
    });
  }
  return salida;
}

function celda(fila, clase) {
  const re = new RegExp(`vivienda-fila-${clase}[^"]*"[^>]*>\\s*<div class="wpb_wrapper">([\\s\\S]*?)<\\/div>`);
  const m = fila.match(re);
  const t = m ? texto(m[1]) : '';
  return t || null;
}

/** Conteo de viviendas por estado. `null` si la fuente no publica la tabla. */
export function resumeDisponibilidad(viviendas) {
  if (!viviendas.length) return { publicada: false, total: null, libres: null, proximamente: null, ocupadas: null };
  const cuenta = (e) => viviendas.filter((v) => v.estado === e).length;
  return {
    publicada: true,
    total: viviendas.length,
    libres: cuenta('libre'),
    proximamente: cuenta('proximamente'),
    ocupadas: cuenta('ocupada'),
  };
}

function entre(s, ini, fin) {
  const i = s.indexOf(ini);
  if (i === -1) return null;
  const j = s.indexOf(fin, i + ini.length);
  return j === -1 ? null : s.slice(i + ini.length, j);
}

export function rutaDeUrl(url) {
  try { return new URL(url).pathname; } catch { return url; }
}

/**
 * Los títulos oficiales vienen en MAYÚSCULAS y gritan. Los pasamos a minúscula
 * y devolvemos sus mayúsculas a los nombres propios que se le indiquen
 * (config/estilo.json, la localidad, la provincia…).
 */
export function minusculiza(s, propios = []) {
  if (!s) return '';
  let t = s;
  if (s === s.toUpperCase()) {
    const minus = s.toLowerCase().replace(/\s+/g, ' ').trim();
    t = minus.charAt(0).toUpperCase() + minus.slice(1);
  }
  for (const propio of propios.filter(Boolean)) {
    t = t.replace(new RegExp(`\\b${propio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), propio);
  }
  return t;
}

// ------------------------------------------------------------ privacidad ----

// Patrones que jamás deben aparecer en data/. Si el día de mañana alguien
// añade un parser de listados nominales, el test de CI lo para aquí.
const PATRONES_PERSONALES = [
  { nombre: 'DNI/NIE', re: /\b[XYZ]?\d{7,8}[-\s]?[A-HJ-NP-TV-Z]\b/ },
  { nombre: 'DNI parcial (***1234**)', re: /\*{2,}\d{3,}\*{2,}/ },
  { nombre: 'email', re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i },
  { nombre: 'teléfono', re: /\b(?:\+34[\s-]?)?[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/ },
  // "Apellido Apellido, Nombre" tal y como aparece en un listado: el patrón
  // tiene que agotar la cadena entera. Sin anclar, cualquier dirección con
  // comas ("calles Campo Charro, Valdeón, …") daría un falso positivo.
  { nombre: 'apellidos', re: /^\p{Lu}[\p{L}'’]*(?:\s+[\p{L}'’]+){1,4},\s*\p{Lu}[\p{L}'’]*(?:\s+[\p{L}'’]+){0,3}\.?$/u },
];

/** Devuelve la lista de indicios de datos personales encontrados en un texto. */
export function indiciosPersonales(valor) {
  const s = String(valor ?? '');
  return PATRONES_PERSONALES.filter((p) => p.re.test(s)).map((p) => p.nombre);
}

// -------------------------------------------------------------- self test ----

export function selfTest() {
  const fallos = [];
  const ok = (cond, msg) => { if (!cond) fallos.push(msg); };

  ok(numero('63,67') === 63.67, 'numero decimal español');
  ok(numero('1.234') === 1234, 'numero con separador de miles');
  ok(numero('') === null && numero(null) === null, 'numero vacío → null');
  ok(texto('<p>Hola&nbsp;&amp;  adi&oacute;s</p>') === 'Hola & adiós', 'texto/entidades');
  ok(slug('59 VIVIENDAS EN LOS VIVEROS — VALLADOLID') === '59-viviendas-en-los-viveros-valladolid', 'slug');

  const reglas = parseRobots('User-agent: *\nDisallow: /boletines/\nAllow: /boletines/publico/\n');
  ok(robotsPermite(reglas, '/rss.do'), 'robots: ruta no listada permitida');
  ok(!robotsPermite(reglas, '/boletines/2026/08/x.pdf'), 'robots: disallow');
  ok(robotsPermite(reglas, '/boletines/publico/x.pdf'), 'robots: allow más específico gana');
  ok(robotsPermite(parseRobots('User-agent: *\nDisallow:\n'), '/lo-que-sea'), 'robots: disallow vacío');

  ok(clasificaDocumento('Listado de adjudicatarios', 'x.pdf') === 'listado_nominal', 'doc: listado nominal');
  ok(clasificaDocumento('PUBLICACION LISTA DEFINITIVA Y FIRMA CONTRATOS', 'x.pdf') === 'listado_nominal', 'doc: lista definitiva');
  ok(clasificaDocumento('BOCYL-D-16032026-51-24', 'x.pdf') === 'bocyl', 'doc: bocyl');
  ok(clasificaDocumento('BOPVA-A-2026-01944', 'x.pdf') === 'bop', 'doc: bop');
  ok(!esDescargable('listado_nominal') && esDescargable('bocyl'), 'descargable');

  const filaHtml = `
    <div class="vivienda-fila-datos">
      <div class="wpb_text_column vivienda-fila-piso"><div class="wpb_wrapper"><p>BAJO A</p></div></div>
      <div class="wpb_text_column vivienda-fila-estado ocupada"><div class="wpb_wrapper"></div></div>
      <div class="wpb_text_column vivienda-fila-hab"><div class="wpb_wrapper"><p>2</p></div></div>
      <div class="wpb_text_column vivienda-fila-metros"><div class="wpb_wrapper"><p>63,75</p></div></div>
      <div class="wpb_text_column vivienda-fila-precio"><div class="wpb_wrapper"><p>434</p></div></div>
    </div>
    <div class="vivienda-leyenda-estado">
      <span class="vivienda-fila-estado libre">LIBRE</span>
      <span class="vivienda-fila-estado ocupada">OCUPADA</span>
    </div>`;
  const viv = parseViviendas(filaHtml);
  ok(viv.length === 1, 'viviendas: la leyenda no cuenta como fila');
  ok(viv[0].estado === 'ocupada' && viv[0].m2 === 63.75 && viv[0].precio_eur_mes === 434, 'viviendas: campos');

  const resumen = resumeDisponibilidad([{ estado: 'libre' }, { estado: 'ocupada' }, { estado: 'libre' }]);
  ok(resumen.total === 3 && resumen.libres === 2 && resumen.ocupadas === 1, 'disponibilidad');
  ok(resumeDisponibilidad([]).publicada === false, 'disponibilidad no publicada');

  const loc1 = partirLocalidad('Medina del Campo (Valladolid)');
  ok(loc1.localidad === 'Medina del Campo' && loc1.provincia === 'Valladolid', 'localidad con provincia');
  ok(partirLocalidad('Valladolid').provincia === 'Valladolid', 'localidad capital');
  ok(partirLocalidad('Ponferrada').provincia === null, 'localidad sin provincia deducible');

  ok(minusculiza('59 VIVIENDAS EN LOS VIVEROS', ['Los Viveros']) === '59 viviendas en Los Viveros', 'minusculiza respeta nombres propios');
  ok(minusculiza('Texto ya normal', []) === 'Texto ya normal', 'minusculiza no toca lo que no grita');

  ok(indiciosPersonales('12345678Z').includes('DNI/NIE'), 'PII: DNI');
  ok(indiciosPersonales('vecina@example.org').includes('email'), 'PII: email');
  ok(indiciosPersonales('Pérez García, Lucía').includes('apellidos'), 'PII: apellidos');
  ok(indiciosPersonales('DE LA FUENTE MARTÍN, ANA MARÍA').includes('apellidos'), 'PII: apellidos en mayúsculas');
  ok(indiciosPersonales('BAJO A · 63,75 m² · 434 €').length === 0, 'PII: falso positivo en datos de vivienda');
  ok(indiciosPersonales('C/ Jardines de Sabatini, 14').length === 0, 'PII: falso positivo en dirección');
  ok(indiciosPersonales('Intersección de las calles Campo Charro, Valdeón, Campo de Villalar').length === 0,
    'PII: falso positivo en dirección con varias comas');

  return fallos;
}
