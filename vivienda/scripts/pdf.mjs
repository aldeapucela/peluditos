// Extractor de texto de PDF, sin dependencias. Solo lee: descomprime los flujos
// de contenido e interpreta los operadores de texto (Tj, TJ y saltos de línea).
// No renderiza, no escribe nada y no guarda el PDF en ningún sitio.
//
// Los boletines oficiales colocan cada letra por separado con su interletraje,
// así que un salto grande dentro de un TJ se traduce por un espacio: sin eso
// sale «P A RT I C UL A R E S» en vez de «PARTICULARES».

import zlib from 'node:zlib';

const SALTO_ES_ESPACIO = -140;

export function textoDePdf(buf) {
  const paginas = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf('stream', i);
    if (s === -1) break;
    let ini = s + 6;
    if (buf[ini] === 13) ini++;
    if (buf[ini] === 10) ini++;
    const fin = buf.indexOf('endstream', ini);
    if (fin === -1) break;
    i = fin + 9;
    const crudo = buf.subarray(ini, fin);
    let contenido;
    try { contenido = zlib.inflateSync(crudo).toString('latin1'); } catch { contenido = crudo.toString('latin1'); }
    if (contenido.includes('TJ') || contenido.includes('Tj')) paginas.push(interpreta(contenido));
  }
  return paginas.join('\n');
}

function interpreta(contenido) {
  let salida = '';
  const re = /\[((?:[^[\]\\]|\\.)*)\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj|T\*|TD|Td|ET/g;
  let m;
  while ((m = re.exec(contenido))) {
    const bruto = m[0];
    if (bruto === 'T*' || bruto === 'TD' || bruto === 'Td' || bruto === 'ET') { salida += '\n'; continue; }
    if (m[1] != null) {
      for (const parte of m[1].match(/\((?:[^()\\]|\\.)*\)|-?[\d.]+/g) ?? []) {
        if (parte.startsWith('(')) salida += cadena(parte);
        else if (Number(parte) <= SALTO_ES_ESPACIO) salida += ' ';
      }
    } else {
      salida += cadena(bruto.slice(0, bruto.lastIndexOf(')') + 1));
    }
  }
  return salida;
}

function cadena(s) {
  return s.slice(1, -1)
    .replace(/\\([0-7]{1,3})/g, (_, o) => Buffer.from([parseInt(o, 8)]).toString('latin1'))
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\[nrt]/g, ' ');
}

/** Limpia la morralla que repiten los boletines en cada página. */
export function limpiaBoletin(texto) {
  return texto
    .replace(/CV: [A-Z0-9-]+/g, ' ')
    .replace(/es-ES/g, ' ')
    .replace(/þÿ/g, '')
    .replace(/N[úu]m\.?\s*\d+\s*P[áa]g\.?\s*\d+/gi, ' ')
    .replace(/N[úu]mero\s+\d{4}\/\d+\s*BOLET[ÍI]N OFICIAL DE LA PROVINCIA DE [A-ZÁÉÍÓÚÑ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// -------------------------------------------------------------- self test ----

export function selfTest() {
  const fallos = [];
  const ok = (c, m) => { if (!c) fallos.push(m); };

  // PDF mínimo sin comprimir, con las dos formas de escribir texto.
  const contenido = 'BT /F1 12 Tf (Hola mundo) Tj T* [(P) -20 (A) -300 (RT) -10 (E)] TJ ET';
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Length ${contenido.length}>>stream\n${contenido}\nendstream endobj\n%%EOF`, 'latin1');
  const t = textoDePdf(pdf);
  ok(t.includes('Hola mundo'), 'lee un Tj normal');
  ok(t.includes('PA RTE') || t.includes('PA RTE'.replace(' ', ' ')), 'el interletraje grande se vuelve espacio');
  ok(!t.includes('P A R T E'), 'no mete espacios entre todas las letras');

  ok(limpiaBoletin('Núm. 51 Pág. 229 Lunes, 16 de marzo de 2026') === 'Lunes, 16 de marzo de 2026', 'limpia cabecera BOCYL');
  ok(limpiaBoletin('Número 2026/55 BOLETÍN OFICIAL DE LA PROVINCIA DE VALLADOLID Viernes') === 'Viernes', 'limpia cabecera BOP');
  ok(limpiaBoletin('CV: BOCYL-D-1 texto') === 'texto', 'limpia el código de verificación');

  return fallos;
}
