/**
 * Almacen de tramas capturadas.
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
const KEY = 'zk:frames';

// La integracion de Vercel Marketplace inyecta UPSTASH_*; el KV clasico, KV_*.
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

export const STORE_MODE = REDIS_URL && REDIS_TOKEN ? 'redis' : 'memoria';

// El buffer en memoria vive en globalThis para sobrevivir al hot reload de dev.
const mem = (globalThis.__zkFrames ||= []);

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
    await redis(['LPUSH', KEY, JSON.stringify(frame)]);
    await redis(['LTRIM', KEY, '0', String(CAP - 1)]);
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
    const raw = await redis(['LRANGE', KEY, '0', String(CAP - 1)]);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error('[store] fallo al leer:', e?.message);
    return mem.slice();
  }
}

export async function clearFrames() {
  mem.length = 0;
  if (STORE_MODE === 'redis') {
    try {
      await redis(['DEL', KEY]);
    } catch (e) {
      console.error('[store] fallo al limpiar:', e?.message);
    }
  }
}
