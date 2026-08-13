#!/usr/bin/env node
// Envía por correo los avisos que aún no se han mandado y los marca como
// enviados en data/avisos.json.
//
// Las direcciones NO están en el repositorio: llegan por variables de entorno
// (secrets del repositorio) y lo normal es que sean UNA dirección de lista de
// la comunidad, que es quien gestiona altas y bajas. Aquí no se guarda ni se
// registra ninguna dirección: los logs cuentan cuántos envíos, no a quién.
//
// Variables:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SEGURO=1 (puerto 465)
//   AVISOS_DE          remitente, p. ej. "Vivienda Aldea Pucela <avisos@aldeapucela.org>"
//   AVISOS_PARA        destino(s), separados por comas. Normalmente, la lista.
//   AVISOS_URGENCIA    mínima a enviar: alta | media | baja (por defecto media)
//
// Uso:
//   node scripts/notificar.mjs              envía lo pendiente
//   node scripts/notificar.mjs --prueba     enseña lo que enviaría, sin enviar
//   node scripts/notificar.mjs --self-test  pruebas del cliente SMTP y del texto

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envia } from './smtp.mjs';
import { selfTest as smtpSelfTest } from './smtp.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDEN_URGENCIA = { alta: 3, media: 2, baja: 1 };
const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  const fallos = [...await smtpSelfTest(), ...selfTest()];
  for (const f of fallos) console.error('✖', f);
  console.log(fallos.length ? `\n${fallos.length} fallos` : '✔ notificaciones: self-test en verde');
  process.exit(fallos.length ? 1 : 0);
}

await principal();

async function principal() {
  const prueba = args.includes('--prueba');
  const fichero = path.join(RAIZ, 'data/avisos.json');
  const datos = fs.existsSync(fichero) ? JSON.parse(fs.readFileSync(fichero, 'utf8')) : { avisos: [] };

  const minima = ORDEN_URGENCIA[process.env.AVISOS_URGENCIA ?? 'media'] ?? 2;
  const pendientes = (datos.avisos ?? [])
    .filter((a) => !a.notificado && (ORDEN_URGENCIA[a.urgencia] ?? 1) >= minima)
    // Los avisos internos no se mandan a la gente: son tarea de la comunidad.
    .filter((a) => a.tipo !== 'plazo_sin_registrar');

  if (!pendientes.length) return console.log('· nada que notificar');

  const destinos = (process.env.AVISOS_PARA ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const de = process.env.AVISOS_DE ?? 'Vivienda Aldea Pucela <avisos@aldeapucela.org>';
  const asunto = tituloCorreo(pendientes);
  const texto = cuerpoCorreo(pendientes);

  if (prueba || !destinos.length || !process.env.SMTP_HOST) {
    console.log(`— modo prueba (${pendientes.length} avisos, ${destinos.length} destino(s) configurado(s)) —\n`);
    console.log(`Asunto: ${asunto}\n`);
    console.log(texto);
    if (!prueba) console.log('\n⚠ Falta configuración SMTP o AVISOS_PARA: no se ha enviado nada.');
    return;
  }

  let enviados = 0;
  for (const para of destinos) {
    try {
      await envia({
        host: process.env.SMTP_HOST,
        puerto: Number(process.env.SMTP_PORT ?? 587),
        usuario: process.env.SMTP_USER,
        clave: process.env.SMTP_PASS,
        seguro: process.env.SMTP_SEGURO === '1',
        de, para, asunto, texto,
      });
      enviados++;
    } catch (e) {
      // El mensaje de error no incluye la dirección a propósito.
      console.error(`✖ fallo al enviar a un destino: ${e.message}`);
    }
  }

  if (enviados) {
    for (const a of pendientes) a.notificado = true;
    fs.writeFileSync(fichero, `${JSON.stringify({ ...datos, avisos: datos.avisos }, null, 2)}\n`);
  }
  console.log(`✔ ${enviados}/${destinos.length} envíos con ${pendientes.length} avisos`);
}

// ------------------------------------------------------------- redacción ----

export function tituloCorreo(avisos) {
  const urgentes = avisos.filter((a) => a.urgencia === 'alta');
  const plazo = avisos.find((a) => a.tipo === 'plazo_cierra_hoy') ?? avisos.find((a) => a.tipo === 'plazo_recordatorio');
  if (plazo) {
    const resto = avisos.length - 1;
    return `Vivienda pública: ${plazo.titulo}${resto ? ` (y ${resto} novedad${resto === 1 ? '' : 'es'} más)` : ''}`;
  }
  if (urgentes.length === 1) return `Vivienda pública: ${urgentes[0].titulo}`;
  if (avisos.length === 1) return `Vivienda pública: ${avisos[0].titulo}`;
  return `Vivienda pública: ${avisos.length} novedades${urgentes.length ? ` (${urgentes.length} importante${urgentes.length === 1 ? '' : 's'})` : ''}`;
}

export function cuerpoCorreo(avisos) {
  const orden = [...avisos].sort((a, b) => (ORDEN_URGENCIA[b.urgencia] ?? 1) - (ORDEN_URGENCIA[a.urgencia] ?? 1));
  const bloques = orden.map((a) => {
    const lineas = [
      `${a.urgencia === 'alta' ? '‼ ' : ''}${a.titulo}`,
      a.detalle,
      `   Ficha: ${a.url}`,
    ];
    if (a.enlace_documento) lineas.push(`   Documento oficial: ${a.enlace_documento}`);
    return lineas.filter(Boolean).join('\n');
  });

  return [
    'Novedades en las promociones de vivienda pública de alquiler que sigue',
    'la comunidad de Aldea Pucela.',
    '',
    bloques.join('\n\n'),
    '',
    '—',
    'Esto es un aviso automático de una web vecinal; no es una comunicación',
    'oficial. Para cualquier trámite, la fuente válida es SOMACYL y el boletín',
    'oficial. Los plazos que aparecen aquí están anotados a mano a partir del',
    'documento que se enlaza: si hay discrepancia, manda el documento.',
    '',
    'Todas las promociones: https://vivienda.aldeapucela.org',
    'Cómo funcionan estos avisos: https://vivienda.aldeapucela.org/avisos/',
  ].join('\n');
}

// -------------------------------------------------------------- self test ----

export function selfTest() {
  const fallos = [];
  const ok = (c, m) => { if (!c) fallos.push(m); };

  const plazo = { tipo: 'plazo_recordatorio', urgencia: 'alta', titulo: 'Quedan 3 días: solicitudes · Valladolid', detalle: 'Termina el 2026-09-01.', url: 'https://x/p/', enlace_documento: 'https://x/bocyl.pdf' };
  const suave = { tipo: 'documento_nuevo', urgencia: 'baja', titulo: 'Documento nuevo', detalle: 'Memoria de calidades.', url: 'https://x/p/' };

  ok(tituloCorreo([plazo, suave]).includes('Quedan 3 días'), 'el asunto prioriza el plazo');
  ok(tituloCorreo([suave]).includes('Documento nuevo'), 'asunto con un solo aviso');
  ok(tituloCorreo([plazo, { ...plazo, tipo: 'viviendas_libres' }, suave]).includes('y 2 novedades más'),
    'el asunto avisa de que hay más cosas además del plazo');
  ok(tituloCorreo([suave, { ...suave, titulo: 'Otro' }]).includes('2 novedades'), 'asunto en plural sin plazos');

  const cuerpo = cuerpoCorreo([suave, plazo]);
  ok(cuerpo.indexOf('Quedan 3 días') < cuerpo.indexOf('Documento nuevo'), 'lo urgente va primero');
  ok(cuerpo.includes('https://x/bocyl.pdf'), 'incluye el documento oficial');
  ok(cuerpo.includes('no es una comunicación'), 'deja claro que no es oficial');
  ok(!/@/.test(cuerpo), 'el cuerpo no lleva direcciones de correo');

  return fallos;
}
