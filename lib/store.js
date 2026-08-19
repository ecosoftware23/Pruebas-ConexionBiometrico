/**
 * Almacen del laboratorio: tramas capturadas y cola de comandos.
 *
 * Dos modos, elegidos automaticamente segun las variables de entorno:
 *
 *   1. Redis REST (Upstash o Vercel KV). Persistente y compartido entre todas
 *      las instancias de la funcion. Es el modo correcto en Vercel.
 *   2. Memoria del proceso. Cero configuracion, pero cada instancia serverless
 *      tiene su propia copia: el panel puede no ver una trama que atendio otra
 *      instancia. Sirve para una prueba rapida, no para capturar en serio.
 *
 * No usa ninguna dependencia npm: la API REST de Upstash es HTTP plano.
 */

const CAP = parseInt(process.env.ZK_STORE_CAP || '200', 10);
const CAP_CMD = 100;

const KEY_FRAMES = 'zk:frames';
const KEY_CMDS = 'zk:cmds'; // hash id -> json
const KEY_PENDING = 'zk:cmds:pending'; // lista de ids por entregar
const KEY_SEQ = 'zk:cmds:seq';

// La integracion de Vercel Marketplace inyecta UPSTASH_*; el KV clasico, KV_*.
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

export const STORE_MODE = REDIS_URL && REDIS_TOKEN ? 'redis' : 'memoria';

// Los buffers en memoria viven en globalThis para sobrevivir al hot reload.
const mem = (globalThis.__zkFrames ||= []);
const memCmds = (globalThis.__zkCmds ||= new Map());
const memPending = (globalThis.__zkPending ||= []);
globalThis.__zkSeq ||= 0;

async function redis(command, timeoutMs = 3000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: ac.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    const json = await res.json();
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// --- Tramas ---------------------------------------------------------------

/**
 * Guarda una trama. Nunca lanza: un fallo del almacen no debe impedir que el
 * dispositivo reciba su ACK, pero si queda anotado en el log de la funcion.
 */
export async function pushFrame(frame) {
  if (STORE_MODE === 'memoria') {
    mem.unshift(frame);
    if (mem.length > CAP) mem.length = CAP;
    return;
  }
  try {
    await redis(['LPUSH', KEY_FRAMES, JSON.stringify(frame)]);
    await redis(['LTRIM', KEY_FRAMES, '0', String(CAP - 1)]);
  } catch (e) {
    console.error('[store] fallo al guardar, se cae a memoria:', e?.message);
    mem.unshift(frame);
    if (mem.length > CAP) mem.length = CAP;
  }
}

/** Devuelve las tramas mas recientes primero. */
export async function readFrames() {
  if (STORE_MODE === 'memoria') return mem.slice();
  try {
    const raw = await redis(['LRANGE', KEY_FRAMES, '0', String(CAP - 1)]);
    if (!Array.isArray(raw)) return [];
    return raw.map(parseJson).filter(Boolean);
  } catch (e) {
    console.error('[store] fallo al leer:', e?.message);
    return mem.slice();
  }
}

export async function clearFrames() {
  mem.length = 0;
  if (STORE_MODE === 'redis') {
    try {
      await redis(['DEL', KEY_FRAMES]);
    } catch (e) {
      console.error('[store] fallo al limpiar:', e?.message);
    }
  }
}

// --- Comandos -------------------------------------------------------------
//
// El servidor ADMS no consulta al equipo: encola comandos y el equipo los
// recoge en su siguiente GET /iclock/getrequest. Formato de cada linea:
//
//     C:<id>:<comando>
//
// El equipo ejecuta y reporta el resultado con POST /iclock/devicecmd,
// enviando ID=<id>&Return=<codigo>&CMD=<tipo>. Return=0 es exito; los
// negativos son errores del equipo (-1001 capacidad, -1002 no soportado).

/** Encola un comando y devuelve su registro. */
export async function enqueueCommand(texto) {
  const cmd = String(texto || '').trim();
  if (!cmd) throw new Error('comando vacio');

  let id;
  if (STORE_MODE === 'memoria') {
    id = ++globalThis.__zkSeq;
  } else {
    id = Number(await redis(['INCR', KEY_SEQ]));
  }

  const registro = {
    id,
    cmd,
    estado: 'pendiente',
    creado_ts: Date.now(),
    entregado_ts: null,
    respondido_ts: null,
    retorno: null,
    tipo: null,
  };

  if (STORE_MODE === 'memoria') {
    memCmds.set(id, registro);
    memPending.push(id);
    podarMemoria();
  } else {
    await redis(['HSET', KEY_CMDS, String(id), JSON.stringify(registro)]);
    await redis(['RPUSH', KEY_PENDING, String(id)]);
  }
  return registro;
}

function podarMemoria() {
  if (memCmds.size <= CAP_CMD) return;
  const ids = [...memCmds.keys()].sort((a, b) => a - b);
  for (const id of ids.slice(0, memCmds.size - CAP_CMD)) memCmds.delete(id);
}

/**
 * Extrae los comandos pendientes y los marca como entregados.
 * Se llama desde getrequest: lo que devuelve va tal cual al equipo.
 */
export async function takePendingCommands() {
  let ids = [];
  if (STORE_MODE === 'memoria') {
    ids = memPending.splice(0, memPending.length);
  } else {
    try {
      const raw = await redis(['LRANGE', KEY_PENDING, '0', '-1']);
      ids = Array.isArray(raw) ? raw.map(Number) : [];
      if (ids.length) await redis(['DEL', KEY_PENDING]);
    } catch (e) {
      console.error('[store] fallo al leer pendientes:', e?.message);
      return [];
    }
  }
  if (!ids.length) return [];

  const entregados = [];
  for (const id of ids) {
    const r = await getCommand(id);
    if (!r) continue;
    r.estado = 'entregado';
    r.entregado_ts = Date.now();
    await saveCommand(r);
    entregados.push(r);
  }
  return entregados;
}

async function getCommand(id) {
  if (STORE_MODE === 'memoria') return memCmds.get(Number(id)) || null;
  try {
    const raw = await redis(['HGET', KEY_CMDS, String(id)]);
    return raw ? parseJson(raw) : null;
  } catch {
    return null;
  }
}

async function saveCommand(r) {
  if (STORE_MODE === 'memoria') {
    memCmds.set(r.id, r);
    return;
  }
  try {
    await redis(['HSET', KEY_CMDS, String(r.id), JSON.stringify(r)]);
  } catch (e) {
    console.error('[store] fallo al guardar comando:', e?.message);
  }
}

/** Anota el resultado que reporta el equipo por devicecmd. */
export async function recordCommandResult(id, retorno, tipo) {
  const r = await getCommand(id);
  if (!r) return null;
  r.estado = 'respondido';
  r.respondido_ts = Date.now();
  r.retorno = retorno;
  r.tipo = tipo || r.tipo;
  await saveCommand(r);
  return r;
}

/** Historial completo, del mas reciente al mas antiguo. */
export async function readCommands() {
  let lista = [];
  if (STORE_MODE === 'memoria') {
    lista = [...memCmds.values()];
  } else {
    try {
      const flat = await redis(['HGETALL', KEY_CMDS]);
      if (Array.isArray(flat)) {
        for (let i = 1; i < flat.length; i += 2) {
          const r = parseJson(flat[i]);
          if (r) lista.push(r);
        }
      }
    } catch (e) {
      console.error('[store] fallo al leer comandos:', e?.message);
    }
  }
  return lista.sort((a, b) => b.creado_ts - a.creado_ts).slice(0, CAP_CMD);
}

export async function clearCommands() {
  memCmds.clear();
  memPending.length = 0;
  if (STORE_MODE === 'redis') {
    try {
      await redis(['DEL', KEY_CMDS]);
      await redis(['DEL', KEY_PENDING]);
    } catch (e) {
      console.error('[store] fallo al limpiar comandos:', e?.message);
    }
  }
}
