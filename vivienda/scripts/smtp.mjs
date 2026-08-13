// Cliente SMTP mínimo, sin dependencias. Habla el protocolo a pelo: EHLO,
// STARTTLS si hace falta, AUTH, MAIL FROM, RCPT TO, DATA. Es todo lo que
// necesita el proyecto para mandar un aviso, y cabe en una pantalla y media.
//
// No guarda direcciones en ningún sitio: las recibe del entorno, las usa y las
// olvida. Ver docs/avisos.md.

import net from 'node:net';
import tls from 'node:tls';

/** Cabecera con acentos → codificada según RFC 2047, para que no llegue rota. */
export function cabecera(valor) {
  const s = String(valor ?? '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/** Mensaje RFC 5322 en texto plano UTF-8, con el cuerpo en base64. */
export function construyeMensaje({ de, para, asunto, texto, fecha, id }) {
  const cuerpo = Buffer.from(String(texto).replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64').replace(/(.{76})/g, '$1\r\n');
  const cabeceras = [
    `From: ${de}`,
    `To: ${para}`,
    `Subject: ${cabecera(asunto)}`,
    `Date: ${(fecha ?? new Date()).toUTCString()}`,
    `Message-ID: <${id ?? `${Date.now()}.${Math.random().toString(36).slice(2)}`}@vivienda.aldeapucela.org>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
  ];
  return `${cabeceras.join('\r\n')}\r\n\r\n${cuerpo}\r\n`;
}

/**
 * Envía un mensaje. `seguro: true` = TLS desde el principio (puerto 465);
 * si no, se usa STARTTLS cuando el servidor lo ofrece.
 */
export async function envia({ host, puerto = 587, usuario, clave, seguro = false, de, para, asunto, texto, starttls = true }) {
  const conversacion = new Conversacion(seguro
    ? tls.connect({ host, port: puerto, servername: host })
    : net.connect({ host, port: puerto }));

  try {
    await conversacion.espera(220);
    let capacidades = await conversacion.manda(`EHLO vivienda.aldeapucela.org`, 250);

    if (!seguro && starttls && /STARTTLS/i.test(capacidades)) {
      await conversacion.manda('STARTTLS', 220);
      conversacion.asegura(host);
      capacidades = await conversacion.manda('EHLO vivienda.aldeapucela.org', 250);
    }

    if (usuario && clave) {
      if (/AUTH[^\n]*PLAIN/i.test(capacidades)) {
        const credencial = Buffer.from(`\0${usuario}\0${clave}`, 'utf8').toString('base64');
        await conversacion.manda(`AUTH PLAIN ${credencial}`, 235);
      } else {
        await conversacion.manda('AUTH LOGIN', 334);
        await conversacion.manda(Buffer.from(usuario, 'utf8').toString('base64'), 334);
        await conversacion.manda(Buffer.from(clave, 'utf8').toString('base64'), 235);
      }
    }

    await conversacion.manda(`MAIL FROM:<${soloDireccion(de)}>`, 250);
    await conversacion.manda(`RCPT TO:<${soloDireccion(para)}>`, 250);
    await conversacion.manda('DATA', 354);
    await conversacion.manda(`${puntoSeguro(construyeMensaje({ de, para, asunto, texto }))}\r\n.`, 250);
    await conversacion.manda('QUIT', 221).catch(() => {});
  } finally {
    conversacion.cierra();
  }
}

/** "Avisos <a@b.c>" → "a@b.c" */
export function soloDireccion(s) {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim();
}

/** Una línea que empiece por punto se escapa, o cortaría el mensaje. */
export function puntoSeguro(mensaje) {
  return mensaje.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..');
}

class Conversacion {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pendiente = null;
    this.enlaza();
  }

  enlaza() {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (trozo) => { this.buffer += trozo; this.reparte(); });
    this.socket.on('error', (e) => { this.falla(e); });
  }

  reparte() {
    if (!this.pendiente) return;
    const lineas = this.buffer.split('\r\n');
    const completas = [];
    for (const linea of lineas) {
      completas.push(linea);
      if (/^\d{3} /.test(linea)) {
        this.buffer = lineas.slice(completas.length).join('\r\n');
        const respuesta = completas.join('\n');
        const codigo = Number(linea.slice(0, 3));
        const { resolver, rechazar, esperado } = this.pendiente;
        this.pendiente = null;
        if (esperado && codigo !== esperado) rechazar(new Error(`el servidor respondió «${linea}» (se esperaba ${esperado})`));
        else resolver(respuesta);
        return;
      }
    }
  }

  espera(codigo) {
    return new Promise((resolver, rechazar) => {
      this.pendiente = { resolver, rechazar, esperado: codigo };
      this.reparte();
      this.socket.setTimeout(30000, () => this.falla(new Error('el servidor no contesta')));
    });
  }

  manda(linea, codigo) {
    const promesa = this.espera(codigo);
    this.socket.write(`${linea}\r\n`);
    return promesa;
  }

  asegura(host) {
    const anterior = this.socket;
    anterior.removeAllListeners('data');
    this.socket = tls.connect({ socket: anterior, servername: host });
    this.buffer = '';
    this.enlaza();
  }

  falla(error) {
    if (this.pendiente) { const { rechazar } = this.pendiente; this.pendiente = null; rechazar(error); }
  }

  cierra() {
    try { this.socket.destroy(); } catch { /* da igual */ }
  }
}

// -------------------------------------------------------------- self test ----

/** Levanta un servidor SMTP de mentira y comprueba toda la conversación. */
export async function selfTest() {
  const fallos = [];
  const ok = (c, m) => { if (!c) fallos.push(m); };

  ok(cabecera('Aviso simple') === 'Aviso simple', 'cabecera ASCII sin tocar');
  ok(cabecera('Últimos días').startsWith('=?UTF-8?B?'), 'cabecera con acentos codificada');
  ok(soloDireccion('Avisos <a@b.c>') === 'a@b.c', 'extrae la dirección');
  ok(puntoSeguro('a\r\n.b') === 'a\r\n..b', 'escapa el punto inicial de línea');

  const mensaje = construyeMensaje({ de: 'a@b.c', para: 'd@e.f', asunto: 'Hola', texto: 'Línea 1\nLínea 2' });
  ok(mensaje.includes('Content-Transfer-Encoding: base64'), 'mensaje en base64');
  ok(mensaje.split('\r\n\r\n').length >= 2, 'cabeceras separadas del cuerpo');
  const cuerpo = Buffer.from(mensaje.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  ok(cuerpo === 'Línea 1\r\nLínea 2', 'el cuerpo se recupera intacto');

  const recibido = [];
  const servidor = net.createServer((s) => {
    s.setEncoding('utf8');
    let enDatos = false;
    s.write('220 fingido listo\r\n');
    s.on('data', (trozo) => {
      for (const linea of trozo.split('\r\n').filter(Boolean)) {
        if (enDatos) {
          if (linea === '.') { enDatos = false; s.write('250 aceptado\r\n'); }
          else recibido.push(`CUERPO ${linea}`);
          continue;
        }
        recibido.push(linea);
        if (/^EHLO/i.test(linea)) s.write('250-fingido\r\n250 AUTH LOGIN PLAIN\r\n');
        else if (/^AUTH PLAIN/i.test(linea)) s.write('235 autenticado\r\n');
        else if (/^(MAIL|RCPT)/i.test(linea)) s.write('250 vale\r\n');
        else if (/^DATA/i.test(linea)) { enDatos = true; s.write('354 adelante\r\n'); }
        else if (/^QUIT/i.test(linea)) s.write('221 adiós\r\n');
        else s.write('250 vale\r\n');
      }
    });
  });

  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address();
  try {
    await envia({
      host: '127.0.0.1', puerto: port, usuario: 'u', clave: 'c', starttls: false,
      de: 'Avisos <avisos@vivienda.aldeapucela.org>', para: 'lista@ejemplo.org',
      asunto: 'Últimos días', texto: 'Quedan 3 días.',
    });
    ok(recibido.some((l) => l.startsWith('EHLO')), 'saluda con EHLO');
    ok(recibido.some((l) => l.startsWith('AUTH PLAIN')), 'se autentica');
    ok(recibido.includes('MAIL FROM:<avisos@vivienda.aldeapucela.org>'), 'MAIL FROM con la dirección limpia');
    ok(recibido.includes('RCPT TO:<lista@ejemplo.org>'), 'RCPT TO');
    ok(recibido.some((l) => l.includes('Subject: =?UTF-8?B?')), 'asunto codificado en el envío');
  } catch (e) {
    fallos.push(`envío contra servidor de pruebas: ${e.message}`);
  } finally {
    servidor.close();
  }

  return fallos;
}
