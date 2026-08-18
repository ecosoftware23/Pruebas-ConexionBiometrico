/**
 * Alimenta el panel en vivo. No forma parte del protocolo ADMS:
 * el dispositivo nunca toca esta ruta.
 *
 *   GET    /api/frames?after=<ts>   tramas nuevas desde ese milisegundo
 *   DELETE /api/frames              vacia el almacen
 */

import { readFrames, clearFrames, STORE_MODE } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function resumen(frames) {
  const marcaciones = frames
    .filter((f) => f.decision === 'marcaciones')
    .reduce((n, f) => n + (f.records || 0), 0);

  const sns = [...new Set(frames.map((f) => f.sn).filter((s) => s && s !== 'SIN_SN'))];
  const ultima = frames[0] || null;

  return {
    tramas: frames.length,
    marcaciones,
    handshakes: frames.filter((f) => f.decision === 'handshake').length,
    polling: frames.filter((f) => f.decision === 'polling').length,
    rechazos: frames.filter((f) => f.decision === 'sn_rechazado').length,
    sns,
    ultima_ts: ultima ? ultima.ts : null,
    ultima_sn: ultima ? ultima.sn : null,
    // Solo hay handshake completo si el equipo pidio opciones Y despues empujo algo.
    ciclo_completo:
      frames.some((f) => f.decision === 'handshake') &&
      frames.some((f) => f.decision === 'marcaciones' || f.decision?.startsWith('datos:')),
  };
}

export async function GET(request) {
  const after = Number(new URL(request.url).searchParams.get('after') || 0);
  const todas = await readFrames(); // mas recientes primero

  const nuevas = after > 0 ? todas.filter((f) => f.ts >= after) : todas;

  return new Response(
    JSON.stringify({
      modo: STORE_MODE,
      ahora: Date.now(),
      resumen: resumen(todas),
      frames: nuevas,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

export async function DELETE() {
  await clearFrames();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}
