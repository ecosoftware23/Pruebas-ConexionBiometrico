# Formato real de las tramas del MB10-VL

Capturado el **19 de agosto de 2026** del equipo **SN CNYG213260182** de
EcoSolar Colombia, conectado por ADMS sobre HTTPS a un dominio.

Éste es el documento para el que existía el laboratorio. Todo lo de abajo es
observado, no supuesto.

## La petición

```
POST /iclock/cdata?SN=CNYG213260182&table=ATTLOG&Stamp=9999
User-Agent: iClock Proxy/1.09
Content-Type: text/plain
```

- **128 registros por POST**, en lotes consecutivos cada 8–9 segundos.
- Saltos de línea **LF** (`\n`), no CRLF.
- Campos separados por **tabulación** (`\t`).
- Sin cabecera `Content-Length` fiable: hay que leer el cuerpo como texto crudo
  con `request.text()`, nunca `request.json()`.

## El cuerpo

```
46	2025-01-29 06:58:48	0	15	0	0	0	0	0	0	10881
41	2025-01-29 06:59:10	0	1	0	0	0	0	0	0	10882
11	2025-01-29 06:59:32	0	1	0	0	0	0	0	0	10883
```

Escapado, tal como lo ve el código:

```
"46\t2025-01-29 06:58:48\t0\t15\t0\t0\t0\t0\t0\t0\t10881\n41\t2025-01-29 06:59:10\t0\t1\t..."
```

## Los campos: son ONCE, no seis

| # | Contenido | Valores observados | Interpretación |
|---|---|---|---|
| 1 | PIN | 31 distintos: `46`, `41`, `11`, `1`… | ID del empleado en el equipo |
| 2 | Fecha y hora | `2025-01-29 06:58:48` | `YYYY-MM-DD HH:MM:SS`, hora local del equipo |
| 3 | Estado | solo `0` y `1` | `0` = entrada, `1` = salida |
| 4 | Método | solo `1` y `15` | `1` = huella, `15` = rostro |
| 5 | WorkCode | siempre `0` | |
| 6 | Reservado | siempre `0` | |
| 7 | — | siempre `0` | sin determinar |
| 8 | — | siempre `0` | sin determinar |
| 9 | — | siempre `0` | sin determinar |
| 10 | — | siempre `0` | sin determinar |
| 11 | **Secuencial** | `10881`, `10882`, `10883`… | contador incremental por registro |

Los campos 7 a 10 llegaron en cero en toda la muestra (250 registros), así que
su significado no se puede deducir de los datos. Reservarlos y no interpretarlos.

## Ejemplos reales

Todos capturados del equipo. La petición es **siempre la misma**, cambia solo el
cuerpo:

```
POST /iclock/cdata?SN=CNYG213260182&table=ATTLOG&Stamp=9999
User-Agent: iClock Proxy/1.09
Content-Type: text/plain
```

**Entrada por rostro** — campo 3 = `0`, campo 4 = `15`:

```
46	2025-01-29 06:58:48	0	15	0	0	0	0	0	0	10881
```

**Entrada por huella** — campo 3 = `0`, campo 4 = `1`:

```
41	2025-01-29 06:59:10	0	1	0	0	0	0	0	0	10882
```

**Salida por huella** — campo 3 = `1`:

```
8	2025-01-29 12:10:17	1	1	0	0	0	0	0	0	10902
```

**Salida por rostro** — campo 3 = `1`, campo 4 = `15`:

```
36	2025-01-29 12:11:56	1	15	0	0	0	0	0	0	10904
```

La **única** diferencia entre una entrada y una salida es el campo 3. Misma
ruta, mismo método HTTP, mismo `table=ATTLOG`. No hay endpoints distintos.

### Varios registros de golpe

Cuando el equipo acumula — tras una caída de red, o al ver un servidor nuevo —
manda **hasta 128 registros por POST**, un lote cada 8–9 segundos. Lote real:

```
46	2025-01-29 06:58:48	0	15	0	0	0	0	0	0	10881
41	2025-01-29 06:59:10	0	1	0	0	0	0	0	0	10882
11	2025-01-29 06:59:32	0	1	0	0	0	0	0	0	10883
47	2025-01-29 06:59:59	0	1	0	0	0	0	0	0	10884
15	2025-01-29 07:00:07	0	1	0	0	0	0	0	0	10885
12	2025-01-29 07:00:30	0	15	0	0	0	0	0	0	10886
```

Respuesta esperada: `OK: 6`.

Con `Realtime=1` una marcación suelta llega como un POST idéntico con **una sola
línea**. El lote y la marcación individual **no se distinguen**: es el mismo
endpoint recibiendo entre 1 y 128 líneas. El backend debe iterar siempre.

### Así lo ve el código

Con `await request.text()`, el string real que procesa Node:

```
"46\t2025-01-29 06:58:48\t0\t15\t0\t0\t0\t0\t0\t0\t10881\n41\t2025-01-29 06:59:10\t0\t1\t0\t0\t0\t0\t0\t0\t10882\n"
```

El cuerpo **termina en salto de línea**, así que al cortar queda una última
entrada vacía que hay que descartar.

### Parser listo para el endpoint

```js
const CAMPOS_ATTLOG = 11;

function parseAttlog(raw, sn) {
  const validos = [];
  const descartadas = [];

  for (const linea of raw.split(/\r?\n/)) {  // \r?\n: hay firmwares con CRLF
    if (!linea) continue;                    // la linea vacia final
    const c = linea.split('\t');

    // Una linea corta significa cuerpo truncado: conexion cortada a mitad del
    // POST. NO se puede parsear "lo que se entienda": el campo 11 faltaria y
    // el secuencial saldria NaN, que es justo la clave de idempotencia.
    if (c.length < CAMPOS_ATTLOG) {
      descartadas.push(linea);
      continue;
    }

    const r = {
      numero_serie: sn,          // viene del query string, no del cuerpo
      pin: c[0],                 // ID del empleado en el equipo
      marcada_en: c[1],          // 'YYYY-MM-DD HH:MM:SS', hora local del equipo
      estado: Number(c[2]),      // 0 entrada, 1 salida
      metodo: Number(c[3]),      // 1 huella, 15 rostro
      work_code: Number(c[4]),
      secuencial: Number(c[10]), // campo 11: clave de idempotencia
      crudo: linea,              // guardar el original ayuda a depurar
    };

    if (!r.pin || !r.marcada_en || !Number.isFinite(r.secuencial)) {
      descartadas.push(linea);
      continue;
    }
    validos.push(r);
  }

  return { validos, descartadas };
}
```

**Por qué el filtro por número de campos.** Al probar este parser contra la
trama real, la última línea traía 9 campos en vez de 11 y producía
`secuencial: NaN` — pasando los filtros ingenuos de `pin` y `marcada_en`. Un
`NaN` en la clave de idempotencia rompe el `ON CONFLICT` en silencio y deja
entrar duplicados.

En ese caso concreto la truncó el propio laboratorio a 4.000 caracteres, pero en
producción pasa lo mismo si la conexión se corta a mitad del POST. Descartar y
registrar es más seguro que adivinar.

Y el handler:

```js
const url = new URL(request.url);
const sn = url.searchParams.get('SN');
const raw = await request.text();          // NUNCA request.json()

if (url.searchParams.get('table') !== 'ATTLOG') {
  return textoPlano('OK');                 // ficha del equipo y otras tablas
}

const { validos, descartadas } = parseAttlog(raw, sn);

if (descartadas.length) {
  // Casi siempre significa cuerpo truncado. Conviene alertar, no ignorarlo.
  console.error('[ATTLOG] lineas descartadas', { sn, n: descartadas.length });
}

await guardar(validos);                    // INSERT ... ON CONFLICT DO NOTHING

// El OK solo DESPUES de escribir en base de datos, y con el numero
// realmente persistido, no el de lineas recibidas.
return textoPlano(`OK: ${validos.length}`);
```

### Cuatro trampas al armar el endpoint

1. **El SN no está en el cuerpo**, viaja en el query string.
2. **Un POST puede traer 1 o 128 líneas.** Iterar siempre.
3. **El mismo registro puede llegar muchas veces.** `secuencial` + SN es la clave única.
4. **Responder `OK: <n>` solo en `table=ATTLOG`.** En `table=options` va `OK` pelado.

## Correcciones respecto a lo documentado en Notion

**Lo que Notion acierta:** el orden de los primeros cuatro campos. El `15` de una
marcación facial cae en la posición 4, bajo *Método*, no bajo *Estado*. Era la
duda principal y queda resuelta: el firmware manda `status` **antes** que
`verify`, tal como estaba documentado.

**Lo que Notion no recoge:**

1. **Son 11 campos, no 6.** Un parser que corte en 6 descarta el campo más útil.
2. **El campo 11 es un contador secuencial** por registro, correlativo dentro de
   cada lote. Es la clave natural de idempotencia (ver abajo).
3. El separador de línea es `\n`. Aun así el parser debe cortar por `/\r?\n/`:
   otros firmwares usan CRLF y el coste de tolerarlo es cero.

## Lo más importante para el endpoint oficial: hay que ser idempotente

El servidor respondió `ATTLOGStamp=9999999999` en el handshake, que en teoría le
dice al equipo que está al día. **No sirvió de nada:** el dispositivo empezó a
reenviar su histórico completo desde enero de 2025, en lotes de 128.

La conclusión es firme: **no se puede confiar en `ATTLOGStamp` para evitar un
reenvío masivo.** Cuando el equipo ve un servidor nuevo, replica todo lo que
tiene.

Por tanto el endpoint definitivo **debe** tolerar recibir el mismo registro
muchas veces. La clave natural:

```sql
UNIQUE (numero_serie, secuencial)      -- campos: SN de la query, campo 11
```

Con un `INSERT … ON CONFLICT DO NOTHING` el reenvío completo se vuelve inofensivo:
llega, se ignora lo ya conocido, y se responde `OK`.

Como respaldo, o si el campo 11 resultara reiniciarse en algún escenario, la
clave alternativa es `(numero_serie, pin, fecha_hora)`.

## Otro hallazgo: el ACK no borra nada en el equipo

El dispositivo reenvió a nuestro laboratorio marcaciones de enero de 2025 que
BioTime ya tenía desde hacía meses. Es decir: **el equipo no purga los registros
al recibir el `OK`**, los conserva y lleva un puntero por servidor.

Eso relaja bastante el riesgo que asumíamos. Reapuntar el equipo a otro servidor
no destruye el histórico. Aun así, el `OK` debe seguir emitiéndose solo después
de confirmar la escritura en base de datos: es lo que evita perder registros si
la base falla a mitad de un lote.

## Volumen a considerar

El equipo acumula unas **44.718 transacciones**. A 128 por POST son unos **350
POST consecutivos**, a razón de uno cada 8–9 segundos: alrededor de **45–50
minutos** de descarga continua.

El endpoint de producción debe aguantar eso sin caerse ni disparar el coste. En
Vercel son 350 invocaciones; en un servidor propio, nada.

## Lo que quedó confirmado del transporte

- El firmware **sí envía SNI**: alcanzó un dominio servido por Vercel, que
  devuelve 403 a las conexiones TLS sin SNI. Era el mayor riesgo del proyecto y
  está descartado.
- Se negocia **HTTP/1.1**.
- El equipo resuelve DNS y hace TLS correctamente **siempre que tenga puerta de
  enlace y DNS configurados**. Sin ellos descarta la configuración de dominio y
  cae a modo IP con `0.0.0.0`, que fue lo que nos bloqueó durante días.
