# Laboratorio ADMS para MB10-VL

Banco de pruebas que habla el protocolo **ADMS / PUSH SDK** de ZKTeco para
capturar la trama cruda que envía el biométrico **MB10-VL, SN CNYG213260182**
de EcoSolar Colombia.

**Objetivo:** recibir los datos del dispositivo en un dominio, ver exactamente
cómo los envía, validar el formato, y solo entonces escribir el endpoint
oficial del módulo de registro de asistencia con la certeza del formato real.

No es código de producción. Es un espejo instrumentado que responde
correctamente para que el equipo entregue datos, y los muestra de forma legible.

## Estructura

```
app/page.js                     ->  /            panel en vivo (lo que ve el navegador)
app/iclock/[[...path]]/route.js ->  /iclock/*    handler del protocolo ADMS
app/api/frames/route.js         ->  /api/frames  alimenta el panel (JSON)
app/health/route.js             ->  /health      verificación en texto plano, para curl
lib/store.js                                     almacén de tramas (Redis o memoria)
zk-adms-stub.js                                  servidor equivalente en Node puro, para LAN
```

## Despliegue

```bash
npm install
npx vercel            # primer deploy, crea el proyecto
npx vercel --prod     # despliegue de producción
```

Usa **siempre la URL de producción**. Las de preview están protegidas por
Vercel Authentication por defecto y el equipo recibiría un 401 sin ninguna
pista del motivo.

### Dominio propio (recomendado)

El objetivo es recibir en un dominio, así que conviene apuntar uno real desde
el principio en vez de usar `<proyecto>.vercel.app`: en Vercel, *Settings →
Domains*, agrega por ejemplo `biometrico.ecosolarcolombia.com` y crea el CNAME
que te indique. Ventajas concretas:

- Es el mismo tipo de host que usará producción, así que lo que se valide aquí
  sigue siendo válido después.
- Si más adelante hay que abandonar Vercel por un servidor propio (ver *SNI*
  abajo), solo cambia el DNS: **no hay que volver a tocar el dispositivo**.

## Configuración del dispositivo

*Menú → Comunicación → Conf. Srvr. de Nube*

| Campo | Valor |
|---|---|
| Modo de Servidor | ADMS |
| Habilitar Nombre de Dominio | ON |
| Dirección del Servidor | `biometrico.ecosolarcolombia.com` (sin esquema, sin ruta, sin barra final) |
| Habilitar Servidor Proxy | OFF |
| HTTPS | ON |

No hay campo de puerto cuando el modo dominio está activo: el firmware usa 443
con HTTPS encendido y 80 apagado.

**El firmware no admite prefijo de ruta.** Construye `/iclock/cdata` colgado de
la raíz del host. Un endpoint documentado como `midominio.com/Registros` no
funciona: o `/iclock/*` vive en la raíz, o hace falta un rewrite que mapee
`/iclock/*` hacia dentro de la aplicación.

## Verificación antes de tocar el dispositivo

Reemplaza `TU-DOMINIO` por el host desplegado.

**1. Handshake.** Debe devolver el bloque `GET OPTION FROM:` y, en las
cabeceras, `content-length` (y **no** `transfer-encoding: chunked`).

```bash
curl -i "https://TU-DOMINIO/iclock/cdata?SN=CNYG213260182&options=all&pushver=2.4.1"
```

**2. Ficha del equipo.** Debe devolver `OK` pelado, sin contador.

```bash
printf 'DeviceName=MB10-VL\tFirmwareVersion=Ver 6.60\n' | curl -i -X POST --data-binary @- "https://TU-DOMINIO/iclock/cdata?SN=CNYG213260182&table=options"
```

**3. Marcaciones.** Debe devolver `OK: 2`.

```bash
printf '105\t2026-04-25 07:30:00\t0\t1\t0\t0\n210\t2026-04-25 07:35:12\t0\t15\t0\t0\n' | curl -i -X POST --data-binary @- "https://TU-DOMINIO/iclock/cdata?SN=CNYG213260182&table=ATTLOG&Stamp=9999"
```

**4. Polling de comandos.** Debe devolver `OK`.

```bash
curl -i "https://TU-DOMINIO/iclock/getrequest?SN=CNYG213260182"
```

Las tres primeras aparecen en el panel en cuanto se ejecutan.

## El panel en vivo

Abre `https://TU-DOMINIO/` en el navegador. Se refresca solo cada 3 segundos
(ajustable, con botón de pausa; se detiene cuando la pestaña no está visible
para no gastar invocaciones de balde).

Muestra, en orden de importancia:

1. **Marcaciones parseadas con los campos etiquetados.** Es la herramienta de
   validación: las cabeceras son la hipótesis documentada en Notion, así que si
   el firmware manda los campos en otro orden se ve de inmediato. También avisa
   si el número de campos por registro no es 6.
2. **La trama cruda escapada**, con los `\t` y `\r\n` visibles. Es el dato
   forense sobre el que se escribe el parser definitivo.
3. El query string, las cabeceras y el User-Agent que manda el equipo, y qué se
   le respondió exactamente.

### Padrón de empleados

El equipo **solo envía el PIN** en el campo 1. El nombre no viaja nunca en la
trama: vive en el software de gestión. El panel lo resuelve contra
`lib/empleados.js`, una tabla fija de 55 empleados, y muestra el resultado en dos
sitios: como etiqueta junto al PIN en la tabla de marcaciones, y en el apartado
**Quién marcó**, agregado por persona y ordenado por marcación más reciente.

Los PIN que no están en el padrón aparecen como *sin registrar*. **No es un
fallo del parser:** el dispositivo conserva marcaciones desde enero de 2025 con
personal que ya no figura. Conviene tenerlo presente al diseñar la tabla de
asistencia: habrá registros que no casan con ningún empleado actual, y el
endpoint definitivo tiene que decidir qué hacer con ellos en vez de descartarlos
en silencio.

Para actualizar el padrón, edita `lib/empleados.js`. En producción esto no será
un archivo: saldrá de la tabla de empleados de la base de datos.

### Pedir datos al dispositivo (comandos)

El servidor ADMS **nunca consulta al equipo**. Lo que hacen las opciones "Cargar
datos desde el dispositivo" de BioTime es encolar un comando que el equipo
recoge en su siguiente `GET /iclock/getrequest` — cada 10 segundos con
`Delay=10` — y después el equipo empuja la respuesta como una trama normal.

El panel implementa lo mismo. Cada comando sale al equipo así:

```
C:<id>:<comando>
```

y el equipo reporta el resultado con `POST /iclock/devicecmd`, enviando
`ID=<id>&Return=<codigo>&CMD=<tipo>`. `Return=0` es éxito; los negativos son
errores del propio equipo (`-1001` capacidad llena, `-1002` no soportado).

Botones disponibles:

| Botón | Comando |
|---|---|
| Pedir marcaciones (últimas 24 h) | `DATA QUERY ATTLOG StartTime=…` + TAB + `EndTime=…` |
| Pedir usuarios | `DATA QUERY USERINFO PIN=` |
| Info del equipo | `INFO` |

Más un campo libre, porque **el dialecto exacto varía entre firmwares**: lanza,
mira qué contesta el equipo en las tramas y ajusta. Ése es justamente el trabajo
del laboratorio.

Dos límites deliberados:

- **Solo funciona con el equipo conectado.** Si no está enviando tramas, los
  comandos se quedan encolados esperando. No es una vía para alcanzar un equipo
  que no reporta.
- **Los comandos destructivos están bloqueados** (`CLEAR LOG`, `CLEAR DATA`,
  `DELETE USER`, `FACTORY`…). El equipo tiene 44.718 transacciones acumuladas y
  un borrado mal lanzado no tiene vuelta atrás. Si algún día hacen falta, que sea
  contra la base de datos definitiva y de forma deliberada, no desde un banco de
  pruebas.

Cuidado con el rango de fechas: pedir el histórico completo son cientos de POST
consecutivos. Empieza por 24 horas.

### El cuerpo crudo en la consola

Cada POST del dispositivo se vuelca a la consola tal cual llegó, antes de que el
handler tome ninguna decisión de protocolo:

```
==============================================================================
[ZK RAW] POST /iclock/cdata · SN=CNYG213260182 · table=ATTLOG · 181 bytes · 4 lineas · saltos LF
------------------------------------------------------------------------------
VERBATIM (copiable tal cual):
46	2025-01-29 06:58:48	0	15	0	0	0	0	0	0	10881
41	2025-01-29 06:59:10	0	1	0	0	0	0	0	0	10882
------------------------------------------------------------------------------
ESCAPADO (separadores visibles):
"46	2025-01-29 06:58:48	0	15	0	0	0	0	0	0	10881
41	..."
==============================================================================
```

Se imprime dos veces a propósito. El **verbatim** se copia y se pega
directamente, con sus tabulaciones reales, para probar un parser contra la trama
auténtica. El **escapado** es lo único que permite distinguir una tabulación de
una fila de espacios.

En Vercel se lee con `npx vercel logs --follow`. Los `GET` no generan volcado
porque no traen cuerpo. Se apaga con `ZK_LOG_RAW=0`.

### Almacén persistente

Por defecto las tramas viven en memoria del proceso. En Vercel cada instancia
serverless tiene su propia copia, así que **el panel puede no ver una trama que
atendió otra instancia**. El panel avisa cuando está en ese modo.

Para capturar en serio, conecta Redis (gratis, dos minutos):

*Vercel → Storage → Marketplace → Upstash → Redis → Connect Project*

La integración inyecta sola `UPSTASH_REDIS_REST_URL` y
`UPSTASH_REDIS_REST_TOKEN`; `lib/store.js` las detecta y el aviso desaparece.
No hace falta instalar ninguna dependencia: usa la API REST por HTTP plano.

## Diagnóstico en LAN

`zk-adms-stub.js` es el mismo servidor en Node puro, sin dependencias, para
correr en la red local:

```bash
npm run stub            # escucha en 0.0.0.0:8080
```

En el equipo: *Habilitar Nombre de Dominio* **OFF**, dirección = IP del PC,
puerto 8080, HTTPS **OFF**.

Es el **experimento de control**. Vercel mete TLS, SNI y HTTP/2 entre el equipo
y el código; el stub habla HTTP plano y responde siempre con `Content-Length`.
Si el dispositivo habla con el stub pero no con el dominio, el fallo está en la
capa de transporte y no en el protocolo. Guarda todo en `zk-frames.jsonl` y
tiene su propio panel en `http://<ip-del-pc>:8080/`.

## Variables de entorno

Todas opcionales. `.env.example` tiene la plantilla.

| Variable | Por defecto | Uso |
|---|---|---|
| `ZK_ALLOWED_SN` | vacío (acepta todos) | Lista blanca de seriales, separados por coma |
| `ZK_ATTLOG_STAMP` | `9999999999` | Sello de marcaciones. `0` pide todo el histórico |
| `ZK_OPERLOG_STAMP` | `9999999999` | Sello de registros de operación |
| `ZK_TRANS_FLAG` | `TransData AttLog` | Qué tipos de datos se solicitan |
| `ZK_TIMEZONE` | `-5` | Zona horaria devuelta en el handshake |
| `MIRROR_URL` | vacío | Copia de cada trama a un visor externo (webhook.site) |
| `ZK_LOG_RAW` | `1` | Volcado del cuerpo crudo a la consola. `0` lo apaga |
| `ZK_MAX_RAW_LOG` | `20000` | Corte del volcado crudo en consola |
| `ZK_STORE_CAP` | `200` | Tramas conservadas en el almacén |
| `ZK_MAX_LOG_BODY` | `12000` | Corte del cuerpo guardado para el panel |
| `ZK_MAX_MIRROR_BODY` | `2000` | Corte del cuerpo enviado al visor |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | vacío | Almacén persistente (los inyecta la integración) |

## Sobre el número de serie

El SN **no es un secreto**: está impreso en el equipo y aparece en cualquier
exportación del panel. Es un identificador, no una credencial.

Lo que sí hace el protocolo es condicionar la respuesta al SN. Devolver
únicamente `OK` al handshake es la respuesta de "dispositivo no registrado", y
el equipo no arranca el ciclo de envío. Por eso `ZK_ALLOWED_SN` usa exactamente
esa respuesta para rechazar seriales desconocidos.

La primera línea del bloque de opciones debe repetir el SN **exacto**.

La clave compartida real, si el equipo la tiene configurada, viaja aparte como
`pushcommkey` en el query string. El panel la muestra en cada trama. Si sale
`null`, la Clave de Comunicación del equipo está en cero.

## Correcciones respecto a lo documentado en Notion

La página *INTEGRACION DE DISPOSITIVO MB10-VL* tiene dos errores que impedirían
que el endpoint definitivo funcionara. Están corregidos aquí:

1. **El handshake no se responde con `OK`.** Notion dice que basta `OK` para
   "habilitar el canal". Es al revés: un `OK` pelado deja al equipo sin
   `ATTLOGStamp`, sin `TransFlag` y sin `Realtime`, así que no tiene con qué
   arrancar. Hay que devolver el bloque de opciones completo. El `OK` a secas es
   precisamente la respuesta de "dispositivo no registrado".
2. **No existe el prefijo `/Registros`.** El firmware cuelga `/iclock/*` de la
   raíz del host. Ver la nota en *Configuración del dispositivo*.
3. **El SN no es autenticación**, aunque sí condiciona la respuesta. Ver arriba.

Lo que sí coincide y sigue pendiente de confirmar con datos reales es el orden
de campos del `ATTLOG`. Ese es el motivo de existir de este laboratorio.

## Procedimiento de conexión a un dominio

Este laboratorio sirve para dos cosas: capturar el formato de las tramas **y**
validar el paso a paso de conectar el equipo a un dominio. Esta es la segunda.

El orden importa: cada ronda aísla una variable, así que un fallo dice
exactamente dónde está el problema.

### Ronda A — host corto en `.vercel.app`

Objetivo: responder la pregunta grande, **¿el firmware hace HTTPS con SNI?**,
sin que interfieran el DNS propio ni la longitud del campo.

1. Vercel → *Settings → Domains → Add Domain* → `zkadms.vercel.app`. Es
   gratis, instantáneo y no requiere DNS. Si el nombre está tomado, prueba
   `zk-ecosolar`, `ecosolar-zk`, `zkadms-eco`.
2. Valida desde el PC: `.\probar.ps1 -Base https://zkadms.vercel.app`. Las 9
   pruebas en verde antes de tocar el equipo.
3. Configura el dispositivo (ver *Guardado en el dispositivo* abajo).
4. Observa el panel.

Son 17 caracteres frente a los 38 de un nombre de proyecto largo, así que
descarta el truncamiento del campo.

### Ronda B — subdominio propio

Objetivo: el ensayo real. Es el mismo tipo de host que usará producción.

1. Vercel → *Settings → Domains → Add Domain* → `zk.ecosolarcolombia.com`
   (23 caracteres; `biometrico.ecosolarcolombia.com` son 31 y deja menos
   margen).
2. Crea el CNAME que indique Vercel y espera a que emita el certificado.
3. `.\probar.ps1 -Base https://zk.ecosolarcolombia.com`
4. Repite la configuración del equipo con ese host.

### Guardado en el dispositivo

*Menú → Comunicación → Conf. Srvr. de Nube*. El orden importa: la dirección en
modo dominio y la dirección en modo IP se guardan por separado, así que mover
el interruptor **después** de escribir la dirección la borra.

1. Modo de Servidor → ADMS
2. Habilitar Nombre de Dominio → ON
3. HTTPS → ON
4. Habilitar Servidor Proxy → OFF
5. **Al final**, Dirección del Servidor → el host a secas, sin `https://`, sin
   barra final → confirmar con **OK/M**, nunca saliendo con retroceso
6. Salir del menú paso a paso, respondiendo **Sí** a guardar
7. **Volver a entrar al menú sin reiniciar** y verificar que quedó. Mueve el
   cursor al inicio del campo: si no se ve el principio del host, el campo
   truncó y hay que acortar el nombre
8. Solo entonces, reiniciar

Si tras reiniciar el campo aparece vacío, no se guardó en el paso 6.

### Cómo interpretar el resultado

| Síntoma | Diagnóstico |
|---|---|
| `probar.ps1` falla | El endpoint. Arreglar antes de seguir |
| `probar.ps1` pasa, el equipo no genera **ninguna** trama | SNI o red del equipo. Ver *Advertencias* |
| Llega `handshake` y luego `polling` cada 10 s | El canal está vivo. Falta marcar |
| Llegan tramas pero el panel las pierde | Almacén en memoria. Conectar Upstash |
| Trama con decisión `sn_rechazado` | El SN real no coincide con `ZK_ALLOWED_SN` |

Antes de culpar al endpoint, verifica que el equipo tenga IP, gateway y DNS: un
export del panel con la IP vacía significa que no tiene red, no que el servidor
falle.

## Qué validar antes de escribir el endpoint oficial

Con el panel abierto y el equipo conectado:

1. **Orden de campos.** Haz una marcación **facial** y comprueba en la tabla que
   el `15` cae bajo *Método* y no bajo *Estado*. Si cae invertido, el firmware
   manda `verify` antes que `status` y el parser debe reflejarlo.
2. **Número de campos.** El panel avisa si no son 6. Hay firmwares que agregan
   columnas al final.
3. **Separador de línea.** Cada trama indica si llegó `LF` o `CRLF`. El parser
   definitivo debe cortar por `/\r?\n/`, no por `\n`.
4. **Formato de la fecha.** Confirmar que llega `YYYY-MM-DD HH:MM:SS` y en qué
   zona horaria respecto a `TimeZone=-5`.
5. **Lote acumulado.** Desconecta la red del equipo, haz dos o tres marcaciones,
   reconecta y observa si llegan en un solo POST o en varios.
6. **`pushcommkey`.** Ver si el equipo la envía. Si la envía, el endpoint
   oficial debe validarla.

## Advertencias

- **El histórico.** `ZK_ATTLOG_STAMP=0` ordena al equipo reenviar todas sus
  transacciones acumuladas. Con 44.718 registros son cientos de POST
  consecutivos, suficientes para agotar invocaciones de Vercel. El valor alto
  por defecto deja al equipo "al día" y solo llegan marcaciones nuevas, que es
  lo que se necesita para conocer el formato. **Descarga el histórico solo
  contra el endpoint definitivo, con la base de datos lista.**
- **`TransFlag`.** Por defecto solo pide marcaciones. Ampliarlo trae plantillas
  de huella, rostro y fotos como blobs base64 grandes.
- **Un equipo ADMS apunta a un solo servidor a la vez.** Al configurarlo aquí
  deja de intentar con el que tuviera antes (BioTime, si estaba en uso).
- En producción el sello debe persistirse **por número de serie**. Esta función
  es sin estado y devuelve siempre el mismo valor.
- La respuesta `OK` es el ACK que autoriza al equipo a purgar el registro de su
  buffer. En producción solo debe emitirse **tras confirmar la escritura en base
  de datos**. Aquí el orden ya es ese: se guarda la trama y después se responde.
- El cuerpo se lee con `request.text()`. Nunca `request.json()`: el dispositivo
  envía texto plano separado por tabulaciones.
- **`Content-Length`.** Devolviendo un string, Next responde con
  `Transfer-Encoding: chunked` y sin `Content-Length` (verificado con curl). El
  cliente HTTP de estos equipos es primitivo y hay firmwares que no saben leer
  una respuesta troceada. El handler fija la cabecera explícitamente.
- **SNI.** Vercel lo exige. Comprobado contra el despliegue conectando por IP
  literal, que es la única forma de suprimir el SNI en curl:

  ```
  curl -k -H "Host: <proyecto>.vercel.app" https://216.198.79.131/health
  -> 403 Forbidden
  ```

  El handshake TLS **sí** se completa y ALPN negocia `http/1.1`, pero el edge de
  Vercel responde **403** sin llegar nunca a la función, aunque la cabecera
  `Host` sea correcta. Consecuencias prácticas:

  - Si el firmware del MB10-VL no envía SNI, recibe un 403 y no entrega ni un
    registro.
  - Ese 403 **no aparece en el panel**, porque la petición muere en el edge. El
    panel no puede diagnosticar este fallo; solo se detecta por descarte.
  - **Firma del problema:** los `curl` de `probar.ps1` pasan las 9 pruebas, pero
    el dispositivo conectado no genera ni una trama. Eso es SNI (o red del
    equipo), no protocolo.
  - Confirmación: apunta el equipo al stub en LAN (HTTP plano, sin TLS). Si ahí
    sí habla, el protocolo está bien y el problema es la capa TLS.
  - Salida definitiva: servidor propio con nginx e IP dedicada, donde se puede
    servir sin exigir SNI.

  Lo que **sí** está confirmado del transporte en Vercel: se negocia HTTP/1.1
  (no HTTP/2), la cadena de certificados es válida y la respuesta lleva
  `Content-Length` sin trocear.
