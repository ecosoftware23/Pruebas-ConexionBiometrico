/**
 * Handler ADMS / PUSH SDK para dispositivos ZKTeco.
 * Captura cualquier ruta bajo /iclock/* y responde lo que el protocolo espera.
 *
 * Rutas reales que golpea el equipo:
 *   GET  /iclock/cdata?SN=...&options=all&pushver=...&pushcommkey=...
 *   POST /iclock/cdata?SN=...&table=ATTLOG&Stamp=...
 *   GET  /iclock/getrequest?SN=...
 *   POST /iclock/devicecmd?SN=...
 *
 * El catch-all es OPCIONAL ([[...path]]) para atender tambien /iclock a secas:
 * con el obligatorio ([...path]) esa ruta daria un 308 de Next que el cliente
 * HTTP del equipo probablemente no sigue.
 */

import { after } from 'next/server';
import {
  pushFrame,
  takePendingCommands,
  recordCommandResult,
} from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  Pragma: 'no-cache',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/**
 * Respuesta con Content-Length explicito.
 *
 * Devolviendo un string, Next responde con Transfer-Encoding: chunked y sin
 * Content-Length (verificado con curl). El cliente HTTP de estos equipos es
 * primitivo y hay firmwares que no saben leer una respuesta troceada: se
 * quedan esperando y el ciclo nunca arranca, sin ningun error visible.
 * Pasando un Buffer y fijando la cabecera se responde en un solo bloque.
 */
function textoPlano(cuerpo) {
  const buf = Buffer.from(cuerpo, 'utf8');
  return new Response(buf, {
    status: 200,
    headers: { ...TEXT_HEADERS, 'Content-Length': String(buf.length) },
  });
}

// --- Configuracion -------------------------------------------------------

// Lista blanca de numeros de serie, separados por coma.
// Si esta vacia, se acepta cualquier equipo (modo laboratorio abierto).
// El SN NO es un secreto: es un identificador. Sirve para no atender equipos
// ajenos, no como mecanismo de autenticacion.
const ALLOWED_SN = (process.env.ZK_ALLOWED_SN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Sello del ultimo registro que el servidor dice tener.
//   Valor alto  -> el equipo se considera al dia y solo empuja marcaciones nuevas.
//   '0'         -> el equipo reenvia TODO su historico. Con 44.718 transacciones
//                  acumuladas esto son cientos de POST consecutivos.
const ATTLOG_STAMP = process.env.ZK_ATTLOG_STAMP || '9999999999';
const OPERLOG_STAMP = process.env.ZK_OPERLOG_STAMP || '9999999999';

// Que tipos de datos pedimos. Por defecto solo marcaciones.
// Ampliar a 'TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic'
// solo cuando se quiera capturar plantillas biometricas y fotos.
const TRANS_FLAG = process.env.ZK_TRANS_FLAG || 'TransData AttLog';

const TIME_ZONE = process.env.ZK_TIMEZONE || '-5';

// Visor externo opcional (webhook.site u otro). No responde el protocolo:
// solo recibe una copia de cada trama para inspeccion comoda.
const MIRROR_URL = process.env.MIRROR_URL || '';

// Cortes de seguridad para no desbordar logs ni el visor.
const MAX_LOG_BODY = parseInt(process.env.ZK_MAX_LOG_BODY || '4000', 10);
const MAX_MIRROR_BODY = parseInt(process.env.ZK_MAX_MIRROR_BODY || '2000', 10);

// --- Protocolo -----------------------------------------------------------

/**
 * Bloque de opciones del handshake.
 * Responder solo "OK" aqui equivale a "dispositivo no registrado": el equipo
 * se queda sin ATTLOGStamp, sin TransFlag y sin Realtime, asi que no tiene con
 * que arrancar el ciclo de envio. Por eso el rechazo por SN usa exactamente
 * esa respuesta.
 *
 * El SN debe devolverse EXACTO en la primera linea.
 */
function optionsBlock(sn) {
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${ATTLOG_STAMP}`,
    `OPERLOGStamp=${OPERLOG_STAMP}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    `TransFlag=${TRANS_FLAG}`,
    `TimeZone=${TIME_ZONE}`,
    'Realtime=1',
    'Encrypt=0',
    'ServerVer=3.0.1',
    'PushProtVer=2.4.1',
    '',
  ].join('\n');
}

/**
 * Descompone el cuerpo crudo.
 * Corta por \r\n o \n: hay firmwares que usan CRLF y, partiendo solo por \n,
 * cada ultimo campo arrastraria un \r invisible que ensucia la tabla parseada.
 * body_escaped conserva el crudo tal cual llego, que es el dato forense y lo
 * que hay que validar antes de escribir el parser definitivo.
 */
function describeBody(raw) {
  if (!raw) {
    return { escaped: null, lines: [], records: 0, truncated: false, eol: null };
  }
  const eol = raw.includes('\r\n') ? 'CRLF' : raw.includes('\n') ? 'LF' : 'sin salto';
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const clipped = raw.length > MAX_LOG_BODY;
  return {
    escaped: JSON.stringify(clipped ? raw.slice(0, MAX_LOG_BODY) : raw),
    lines: lines.slice(0, 50).map((l) => l.split('\t')),
    records: lines.length,
    truncated: clipped || lines.length > 50,
    eol,
  };
}

async function mirror(payload) {
  if (!MIRROR_URL) return;
  // No espejar lotes grandes: el bin gratuito de webhook.site tope en 50
  // peticiones y los blobs biometricos lo saturan de inmediato.
  if (payload.body_escaped && payload.body_escaped.length > MAX_MIRROR_BODY) {
    payload = { ...payload, body_escaped: '<omitido por tamano>', body_parsed: [] };
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    await fetch(MIRROR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    clearTimeout(t);
  } catch (e) {
    console.error('[mirror] fallo:', e?.message);
  }
}

async function handle(request, ctx) {
  const params = await ctx.params; // Next 15+: params es async
  const segments = Array.isArray(params?.path) ? params.path : [];
  const endpoint = segments.join('/');

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const sn = query.SN || 'SIN_SN';
  const headers = Object.fromEntries(request.headers.entries());
  const table = query.table || null;

  // Clave de comunicacion, si el equipo la tiene configurada.
  const pushCommKey = query.pushcommkey || query.PushCommKey || null;

  // CLAVE: leer el cuerpo como texto crudo. El equipo envia texto plano
  // separado por tabulaciones, no JSON. Nunca usar request.json() aqui.
  let raw = '';
  if (request.method === 'POST' || request.method === 'PUT') {
    raw = await request.text();
  }

  const body = describeBody(raw);
  const snAllowed = ALLOWED_SN.length === 0 || ALLOWED_SN.includes(sn);

  let response = 'OK';
  let decision = 'ack';
  let comandosEntregados = []; // ids enviados en este getrequest
  const resultados = []; // resultados reportados en este devicecmd

  if (!snAllowed) {
    // Respuesta protocolar de "dispositivo no registrado".
    response = 'OK';
    decision = 'sn_rechazado';
  } else if (endpoint === 'cdata' && request.method === 'GET') {
    response = optionsBlock(sn);
    decision = 'handshake';
  } else if (
    endpoint === 'cdata' &&
    (request.method === 'POST' || request.method === 'PUT')
  ) {
    // El contador solo aplica a ATTLOG. Tras el handshake muchos firmwares
    // hacen POST table=options con la ficha del equipo: ahi "OK: 12" seria una
    // respuesta invalida y el equipo puede cortar el ciclo. Va OK pelado.
    if (table === 'ATTLOG') {
      // En produccion: responder OK SOLO tras persistir en base de datos.
      // El OK autoriza al equipo a purgar el registro de su buffer.
      response = `OK: ${body.records}`;
      decision = 'marcaciones';
    } else {
      response = 'OK';
      decision = `datos:${table || 'sin_table'}`;
    }
  } else if (endpoint === 'getrequest') {
    // Aqui es donde el servidor ADMS "jala" datos: no consulta al equipo,
    // le entrega los comandos que tenga encolados y el equipo responde
    // empujando el resultado. Cada linea va como C:<id>:<comando>.
    const pendientes = await takePendingCommands();
    if (pendientes.length) {
      response = pendientes.map((c) => `C:${c.id}:${c.cmd}`).join('\n') + '\n';
      decision = `comandos:${pendientes.length}`;
      comandosEntregados = pendientes.map((c) => c.id);
    } else {
      response = 'OK'; // sin comandos pendientes
      decision = 'polling';
    }
  } else if (endpoint === 'devicecmd') {
    // El equipo reporta el resultado: ID=<id>&Return=<codigo>&CMD=<tipo>.
    // Return=0 es exito; los negativos son errores del propio equipo
    // (-1001 capacidad llena, -1002 funcion no soportada).
    for (const linea of raw.split(/\r?\n/)) {
      if (!linea.trim()) continue;
      const p = new URLSearchParams(linea.trim());
      const id = Number(p.get('ID'));
      if (!Number.isFinite(id)) continue;
      const anotado = await recordCommandResult(id, p.get('Return'), p.get('CMD'));
      if (anotado) resultados.push({ id, retorno: p.get('Return'), tipo: p.get('CMD') });
    }
    response = 'OK'; // acuse del resultado de un comando
    decision = resultados.length ? `resultado:${resultados.length}` : 'resultado_comando';
  }

  const ts = Date.now();
  const record = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    ts,
    at: new Date(ts).toISOString(),
    method: request.method,
    endpoint: `/iclock/${endpoint}`,
    sn,
    sn_allowed: snAllowed,
    table,
    push_comm_key: pushCommKey,
    decision,
    query,
    user_agent: headers['user-agent'] || null,
    headers,
    body_escaped: body.escaped,
    body_parsed: body.lines,
    records: body.records,
    eol: body.eol,
    truncated: body.truncated,
    responded: response.split('\n')[0],
    comandos_entregados: comandosEntregados,
    resultados_comando: resultados,
  };

  console.log('[ZK]', JSON.stringify(record));

  // Persistir ANTES de contestar: es el mismo orden que debe seguir el endpoint
  // definitivo, donde el OK es el permiso para que el equipo purgue su buffer.
  await pushFrame(record);

  // El espejo externo va despues de responder: no debe retrasar el ACK.
  if (MIRROR_URL) after(mirror(record));

  return textoPlano(response);
}

export async function GET(request, ctx) {
  return handle(request, ctx);
}
export async function POST(request, ctx) {
  return handle(request, ctx);
}
export async function PUT(request, ctx) {
  return handle(request, ctx);
}
