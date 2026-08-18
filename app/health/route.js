/**
 * Verificacion en texto plano, comoda para curl.
 * El panel grafico vive en / (app/page.js).
 */

import { STORE_MODE } from '../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const body = [
    'Laboratorio ADMS activo.',
    '',
    'Configuracion en el dispositivo (Conf. Srvr. de Nube):',
    '  Modo de Servidor            : ADMS',
    '  Habilitar Nombre de Dominio : ON',
    '  Direccion del Servidor      : <este-host>   (sin https://, sin ruta)',
    '  Habilitar Servidor Proxy    : OFF',
    '  HTTPS                       : ON',
    '',
    'Rutas atendidas: /iclock/cdata, /iclock/getrequest, /iclock/devicecmd',
    'Panel en vivo  : /',
    `Almacen        : ${STORE_MODE}`,
    '',
    `Hora del servidor: ${new Date().toISOString()}`,
  ].join('\n');

  const buf = Buffer.from(body, 'utf8');
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(buf.length),
    },
  });
}
