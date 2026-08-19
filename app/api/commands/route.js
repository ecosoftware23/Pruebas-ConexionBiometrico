/**
 * Cola de comandos hacia el dispositivo. No forma parte del protocolo ADMS:
 * el equipo nunca toca esta ruta. Solo alimenta los botones del panel.
 *
 *   GET    /api/commands          historial de comandos y su estado
 *   POST   /api/commands {cmd}    encola un comando
 *   DELETE /api/commands          vacia el historial
 *
 * El comando se entrega en el siguiente GET /iclock/getrequest del equipo,
 * que ocurre cada 10 segundos con Delay=10.
 */

import {
  enqueueCommand,
  readCommands,
  clearCommands,
  STORE_MODE,
} from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

// Comandos que borran datos del equipo. No se encolan desde el laboratorio:
// el equipo tiene 44.718 transacciones acumuladas y un CLEAR LOG mal lanzado
// no tiene vuelta atras. Si algun dia hacen falta, que sea con la base de
// datos definitiva lista y de forma deliberada, no desde un banco de pruebas.
const PROHIBIDOS = /\b(CLEAR\s+(LOG|DATA|PHOTO)|DELETE\s+USER|FACTORY|FORMAT)\b/i;

function respuesta(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: JSON_HEADERS });
}

export async function GET() {
  return respuesta({ modo: STORE_MODE, ahora: Date.now(), comandos: await readCommands() });
}

export async function POST(request) {
  let cmd;
  try {
    ({ cmd } = await request.json());
  } catch {
    return respuesta({ error: 'cuerpo JSON invalido' }, 400);
  }

  cmd = String(cmd || '').trim();
  if (!cmd) return respuesta({ error: 'comando vacio' }, 400);
  if (cmd.length > 500) return respuesta({ error: 'comando demasiado largo' }, 400);
  if (PROHIBIDOS.test(cmd)) {
    return respuesta(
      { error: 'comando destructivo bloqueado en el laboratorio' },
      403,
    );
  }

  try {
    const registro = await enqueueCommand(cmd);
    return respuesta({ ok: true, comando: registro });
  } catch (e) {
    return respuesta({ error: e.message }, 500);
  }
}

export async function DELETE() {
  await clearCommands();
  return respuesta({ ok: true });
}
