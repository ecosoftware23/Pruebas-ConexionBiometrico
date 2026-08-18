#!/usr/bin/env node
/**
 * Servidor ADMS equivalente al de Vercel, en Node puro y sin dependencias.
 *
 * Para que sirve: es el experimento de control. Vercel mete TLS, SNI, HTTP/2 y
 * posible Transfer-Encoding: chunked entre el equipo y el codigo. Este stub
 * corre en HTTP plano dentro de la LAN, responde SIEMPRE con Content-Length
 * explicito y sin chunked. Si el dispositivo habla con este y no con Vercel,
 * el problema esta en la capa de transporte, no en el protocolo.
 *
 *   node zk-adms-stub.js            escucha en 0.0.0.0:8080
 *   PORT=3000 node zk-adms-stub.js
 *
 * En el equipo: Habilitar Nombre de Dominio OFF, direccion = IP del PC,
 * puerto = 8080, HTTPS OFF.
 *
 * Panel:  http://<ip-del-pc>:8080/
 * Captura duradera: zk-frames.jsonl (una trama JSON por linea)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ARCHIVO = path.join(__dirname, 'zk-frames.jsonl');
const CAP = 200;

const ALLOWED_SN = (process.env.ZK_ALLOWED_SN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ATTLOG_STAMP = process.env.ZK_ATTLOG_STAMP || '9999999999';
const OPERLOG_STAMP = process.env.ZK_OPERLOG_STAMP || '9999999999';
const TRANS_FLAG = process.env.ZK_TRANS_FLAG || 'TransData AttLog';
const TIME_ZONE = process.env.ZK_TIMEZONE || '-5';

const frames = [];

function optionsBlock(sn) {
  return [
    'GET OPTION FROM: ' + sn,
    'ATTLOGStamp=' + ATTLOG_STAMP,
    'OPERLOGStamp=' + OPERLOG_STAMP,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=' + TRANS_FLAG,
    'TimeZone=' + TIME_ZONE,
    'Realtime=1',
    'Encrypt=0',
    'ServerVer=3.0.1',
    'PushProtVer=2.4.1',
    '',
  ].join('\n');
}

/** Content-Length explicito y sin chunked: es el punto del experimento. */
function responder(res, cuerpo, tipo) {
  const buf = Buffer.from(cuerpo, 'utf8');
  res.writeHead(200, {
    'Content-Type': tipo || 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    Connection: 'close',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function panel() {
  const filas = frames
    .map(function (f) {
      const cuerpo = f.body_escaped
        ? '<pre>' + f.body_escaped.replace(/</g, '&lt;') + '</pre>'
        : '<i>sin cuerpo</i>';
      return (
        '<tr><td>' + f.at.slice(11, 19) + '</td><td>' + f.method + '</td><td>' +
        f.endpoint + '</td><td>' + f.decision + '</td><td>' + f.records +
        '</td><td>' + cuerpo + '</td></tr>'
      );
    })
    .join('');

  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="3">' +
    '<title>Stub ADMS local</title><style>' +
    'body{background:#0b0f14;color:#dbe4ee;font:13px ui-monospace,Consolas,monospace;padding:20px}' +
    'h1{font-size:15px}table{border-collapse:collapse;width:100%}' +
    'th,td{border-bottom:1px solid #223040;padding:6px 10px;text-align:left;vertical-align:top}' +
    'th{color:#8899ab}pre{margin:0;color:#a8e6c4;white-space:pre-wrap;word-break:break-all}' +
    '</style></head><body><h1>Stub ADMS local · ' + frames.length +
    ' tramas · refresco 3s</h1><table><tr><th>Hora</th><th>Metodo</th>' +
    '<th>Ruta</th><th>Decision</th><th>Reg.</th><th>Cuerpo crudo escapado</th></tr>' +
    filas + '</table></body></html>'
  );
}

const server = http.createServer(function (req, res) {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', function (c) { raw += c; });

  req.on('end', function () {
    const u = new URL(req.url, 'http://localhost');

    if (u.pathname === '/' || u.pathname === '/index.html') {
      return responder(res, panel(), 'text/html; charset=utf-8');
    }
    if (u.pathname === '/api/frames') {
      return responder(res, JSON.stringify(frames), 'application/json; charset=utf-8');
    }
    if (!u.pathname.startsWith('/iclock')) {
      return responder(res, 'Stub ADMS. Rutas: /iclock/*, /api/frames, /');
    }

    const endpoint = u.pathname.replace(/^\/iclock\/?/, '');
    const query = Object.fromEntries(u.searchParams.entries());
    const sn = query.SN || 'SIN_SN';
    const table = query.table || null;
    const snAllowed = ALLOWED_SN.length === 0 || ALLOWED_SN.indexOf(sn) !== -1;

    const lineas = raw ? raw.split(/\r?\n/).filter(function (l) { return l.length > 0; }) : [];

    let cuerpo = 'OK';
    let decision = 'ack';

    if (!snAllowed) {
      decision = 'sn_rechazado';
    } else if (endpoint === 'cdata' && req.method === 'GET') {
      cuerpo = optionsBlock(sn);
      decision = 'handshake';
    } else if (endpoint === 'cdata' && (req.method === 'POST' || req.method === 'PUT')) {
      if (table === 'ATTLOG') {
        cuerpo = 'OK: ' + lineas.length;
        decision = 'marcaciones';
      } else {
        decision = 'datos:' + (table || 'sin_table');
      }
    } else if (endpoint === 'getrequest') {
      decision = 'polling';
    } else if (endpoint === 'devicecmd') {
      decision = 'resultado_comando';
    }

    const registro = {
      at: new Date().toISOString(),
      method: req.method,
      endpoint: '/iclock/' + endpoint,
      sn: sn,
      table: table,
      decision: decision,
      query: query,
      headers: req.headers,
      body_escaped: raw ? JSON.stringify(raw) : null,
      body_parsed: lineas.map(function (l) { return l.split('\t'); }),
      records: lineas.length,
      eol: raw.indexOf('\r\n') !== -1 ? 'CRLF' : raw.indexOf('\n') !== -1 ? 'LF' : null,
      responded: cuerpo.split('\n')[0],
    };

    frames.unshift(registro);
    if (frames.length > CAP) frames.length = CAP;

    console.log('[ZK]', JSON.stringify(registro));
    fs.appendFile(ARCHIVO, JSON.stringify(registro) + '\n', function (e) {
      if (e) console.error('[archivo] fallo:', e.message);
    });

    responder(res, cuerpo);
  });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('Stub ADMS escuchando en http://0.0.0.0:' + PORT);
  console.log('Panel  : http://<ip-de-este-pc>:' + PORT + '/');
  console.log('Captura: ' + ARCHIVO);
  console.log('En el equipo: Nombre de Dominio OFF, IP de este PC, puerto ' + PORT + ', HTTPS OFF.');
});
