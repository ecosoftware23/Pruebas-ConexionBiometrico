'use client';

/**
 * Panel en vivo del laboratorio ADMS.
 *
 * Sondea /api/frames cada pocos segundos y muestra, en este orden de importancia:
 *   1. Las marcaciones parseadas con los campos ETIQUETADOS, para poder validar
 *      de un vistazo si el orden documentado en Notion coincide con el real.
 *   2. La trama cruda escapada, que es el dato forense sobre el que se escribira
 *      el parser del endpoint definitivo.
 *
 * No usa ninguna dependencia externa.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const TOPE = 200;

// Etiquetas de la hipotesis documentada en Notion:
//   ID \t FECHA_HORA \t ESTADO \t METODO \t WORKCODE \t RESERVADO
const COLUMNAS = [
  { t: 'ID', s: 'empleado' },
  { t: 'Fecha y hora', s: 'marcacion' },
  { t: 'Estado', s: 'campo 3' },
  { t: 'Metodo', s: 'campo 4' },
  { t: 'WorkCode', s: 'campo 5' },
  { t: 'Reservado', s: 'campo 6' },
];

const ESTADOS = {
  0: 'Entrada',
  1: 'Salida',
  2: 'Salida descanso',
  3: 'Entrada descanso',
  4: 'Extra entrada',
  5: 'Extra salida',
};

const METODOS = {
  0: 'Contrasena',
  1: 'Huella',
  4: 'Tarjeta',
  15: 'Rostro',
  25: 'Palma',
};

function rotula(mapa, valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return mapa[n] || null;
}

function haceCuanto(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `hace ${h}h ${Math.floor((s % 3600) / 60)}m`;
  return `hace ${Math.floor(h / 24)}d`;
}

function hora(ts) {
  return new Date(ts).toLocaleTimeString('es-CO', { hour12: false });
}

/** Formato de fecha que espera ADMS en los comandos: YYYY-MM-DD HH:MM:SS */
function fechaZk(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function claseDecision(d) {
  if (!d) return '';
  if (d.startsWith('datos:')) return 'datos';
  return d;
}

export default function Panel() {
  const [frames, setFrames] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [modo, setModo] = useState(null);
  const [error, setError] = useState(null);
  const [pausado, setPausado] = useState(false);
  const [intervalo, setIntervalo] = useState(3000);
  const [comandos, setComandos] = useState([]);
  const [cmdLibre, setCmdLibre] = useState('');
  const [avisoCmd, setAvisoCmd] = useState(null);
  const [, setTic] = useState(0); // solo fuerza el refresco de los "hace Xs"

  const cursor = useRef(0);
  const desfase = useRef(0); // reloj del servidor menos el del navegador

  const cargarComandos = useCallback(async () => {
    try {
      const r = await fetch('/api/commands', { cache: 'no-store' });
      if (r.ok) setComandos((await r.json()).comandos || []);
    } catch {
      /* el error de tramas ya se muestra arriba */
    }
  }, []);

  const enviarComando = useCallback(
    async (cmd) => {
      setAvisoCmd(null);
      try {
        const r = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd }),
        });
        const d = await r.json();
        if (!r.ok) {
          setAvisoCmd(d.error || `HTTP ${r.status}`);
        } else {
          setAvisoCmd(`Encolado C:${d.comando.id} — se entrega en el proximo getrequest`);
          setCmdLibre('');
        }
      } catch (e) {
        setAvisoCmd(e.message);
      }
      cargarComandos();
    },
    [cargarComandos],
  );

  const cargar = useCallback(async () => {
    cargarComandos();
    try {
      const r = await fetch(`/api/frames?after=${cursor.current}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();

      desfase.current = d.ahora - Date.now();
      setModo(d.modo);
      setResumen(d.resumen);
      setError(null);

      if (d.frames.length) {
        setFrames((prev) => {
          const vistos = new Set(prev.map((f) => f.id));
          const nuevas = d.frames.filter((f) => !vistos.has(f.id));
          if (!nuevas.length) return prev;
          return [...nuevas, ...prev].sort((a, b) => b.ts - a.ts).slice(0, TOPE);
        });
        cursor.current = Math.max(cursor.current, ...d.frames.map((f) => f.ts));
      }
    } catch (e) {
      setError(e.message);
    }
  }, [cargarComandos]);

  // Sondeo. Se detiene al pausar y cuando la pestana no esta visible,
  // para no gastar invocaciones de Vercel de balde.
  useEffect(() => {
    if (pausado) return;
    cargar();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') cargar();
    }, intervalo);
    return () => clearInterval(id);
  }, [cargar, pausado, intervalo]);

  // Reloj propio para que los "hace Xs" avancen entre sondeos.
  useEffect(() => {
    const id = setInterval(() => setTic((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const limpiar = useCallback(async () => {
    if (!confirm('Vaciar todas las tramas capturadas?')) return;
    await fetch('/api/frames', { method: 'DELETE' });
    cursor.current = 0;
    setFrames([]);
    cargar();
  }, [cargar]);

  const ahora = Date.now() + desfase.current;
  const ultimaTs = resumen?.ultima_ts ?? null;
  const edad = ultimaTs ? ahora - ultimaTs : null;

  let estado = 'off';
  let leyenda = 'sin tramas todavia';
  if (edad != null) {
    estado = edad < 120000 ? 'on' : edad < 900000 ? 'stale' : 'off';
    leyenda = haceCuanto(edad);
  }
  if (error) {
    estado = 'off';
    leyenda = `error: ${error}`;
  }

  // Marcaciones aplanadas, de la mas reciente a la mas antigua.
  const marcaciones = [];
  for (const f of frames) {
    if (f.decision !== 'marcaciones' || !f.body_parsed) continue;
    f.body_parsed.forEach((campos, i) => {
      marcaciones.push({ clave: `${f.id}-${i}`, campos, ts: f.ts, sn: f.sn });
    });
  }

  // Aridad observada: si aparece un numero distinto de 6, el formato real no
  // coincide con lo documentado y el parser tiene que ajustarse.
  const aridades = [...new Set(marcaciones.map((m) => m.campos.length))].sort();
  const maxCampos = aridades.length ? Math.max(...aridades) : 6;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Laboratorio ADMS · MB10-VL</h1>
          <div className="sub">
            SN CNYG213260182 · EcoSolar Colombia
            {modo && ` · almacen: ${modo}`}
          </div>
        </div>
        <div className="controls">
          <span className="live">
            <span className={`dot ${estado}`} />
            {leyenda}
          </span>
          <select
            value={intervalo}
            onChange={(e) => setIntervalo(Number(e.target.value))}
            style={{
              background: 'var(--panel-2)',
              color: 'var(--txt)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: '7px 10px',
              fontSize: 13,
            }}
          >
            <option value={2000}>cada 2s</option>
            <option value={3000}>cada 3s</option>
            <option value={5000}>cada 5s</option>
            <option value={15000}>cada 15s</option>
          </select>
          <button onClick={() => setPausado((p) => !p)}>
            {pausado ? 'Reanudar' : 'Pausar'}
          </button>
          <button className="danger" onClick={limpiar}>
            Limpiar
          </button>
        </div>
      </header>

      <div className="cards">
        <div className="card">
          <div className="k">Tramas</div>
          <div className="v">{resumen?.tramas ?? '—'}</div>
        </div>
        <div className="card">
          <div className="k">Marcaciones</div>
          <div className="v">{resumen?.marcaciones ?? '—'}</div>
        </div>
        <div className="card">
          <div className="k">Handshakes</div>
          <div className="v">{resumen?.handshakes ?? '—'}</div>
        </div>
        <div className="card">
          <div className="k">Polling</div>
          <div className="v">{resumen?.polling ?? '—'}</div>
        </div>
        <div className="card">
          <div className="k">Serial visto</div>
          <div className="v sm">{resumen?.sns?.length ? resumen.sns.join(', ') : '—'}</div>
        </div>
      </div>

      {modo === 'memoria' && (
        <div className="note warn">
          <strong>Almacen en memoria.</strong> Cada instancia serverless tiene su propia
          copia, asi que el panel puede no ver una trama que atendio otra instancia. Para
          capturar en serio, conecta Upstash Redis desde el marketplace de Vercel: las
          variables <code>UPSTASH_REDIS_REST_URL</code> y{' '}
          <code>UPSTASH_REDIS_REST_TOKEN</code> se detectan solas y este aviso desaparece.
        </div>
      )}

      {resumen?.rechazos > 0 && (
        <div className="note warn">
          <strong>{resumen.rechazos} trama(s) rechazadas por SN.</strong> El serial que
          llega no esta en <code>ZK_ALLOWED_SN</code>. Revisa el valor exacto en la lista de
          tramas: se respondio <code>OK</code> pelado, que el equipo interpreta como
          &quot;dispositivo no registrado&quot;.
        </div>
      )}

      <section>
        <h2>Marcaciones recibidas (ATTLOG)</h2>
        <p className="hint">
          Las cabeceras son la hipotesis documentada en Notion. Para validarla: haz una
          marcacion <b>facial</b> y comprueba que el <b>15</b> cae bajo &quot;Metodo&quot; y
          no bajo &quot;Estado&quot;. Si cae invertido, el firmware manda{' '}
          <code>verify</code> antes que <code>status</code> y el parser debe reflejarlo.
          {aridades.length > 0 && (
            <>
              {' '}Campos por registro observados: <b>{aridades.join(', ')}</b>
              {aridades.some((n) => n !== 6) && ' — no coincide con los 6 documentados.'}
            </>
          )}
        </p>

        {marcaciones.length === 0 ? (
          <div className="scroll">
            <div className="empty">
              Sin marcaciones todavia. Configura el equipo y pon una huella o rostro.
            </div>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    Hora recibida<small>servidor</small>
                  </th>
                  {Array.from({ length: maxCampos }, (_, i) => (
                    <th key={i}>
                      {COLUMNAS[i]?.t || `Campo ${i + 1}`}
                      <small>{COLUMNAS[i]?.s || 'no documentado'}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {marcaciones.map((m) => (
                  <tr key={m.clave}>
                    <td style={{ color: 'var(--faint)' }}>{hora(m.ts)}</td>
                    {Array.from({ length: maxCampos }, (_, i) => {
                      const v = m.campos[i];
                      const et =
                        i === 2 ? rotula(ESTADOS, v) : i === 3 ? rotula(METODOS, v) : null;
                      return (
                        <td key={i}>
                          {v === undefined ? (
                            <span style={{ color: 'var(--faint)' }}>—</span>
                          ) : (
                            <>
                              {v || <span style={{ color: 'var(--faint)' }}>vacio</span>}
                              {et && <span className="tag">{et}</span>}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Pedir datos al dispositivo</h2>
        <p className="hint">
          El servidor ADMS nunca consulta al equipo: encola un comando y el equipo lo
          recoge en su siguiente <code>getrequest</code>, cada 10 segundos. Después empuja
          la respuesta como una trama normal. Es exactamente lo que hacen las opciones
          &quot;Cargar datos desde el dispositivo&quot; de BioTime.
          <br />
          <b>Solo funciona con el equipo conectado.</b> Si no está enviando tramas, los
          comandos se quedan encolados esperando.
        </p>

        <div className="acciones">
          <button
            onClick={() => {
              const fin = new Date();
              const ini = new Date(fin.getTime() - 24 * 3600 * 1000);
              enviarComando(
                `DATA QUERY ATTLOG StartTime=${fechaZk(ini)}\tEndTime=${fechaZk(fin)}`,
              );
            }}
          >
            Pedir marcaciones (últimas 24 h)
          </button>
          <button onClick={() => enviarComando('DATA QUERY USERINFO PIN=')}>
            Pedir usuarios
          </button>
          <button onClick={() => enviarComando('INFO')}>Info del equipo</button>
        </div>

        <div className="acciones">
          <input
            className="cmd"
            value={cmdLibre}
            placeholder="Comando libre, p. ej.  DATA QUERY ATTLOG StartTime=..."
            onChange={(e) => setCmdLibre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && cmdLibre.trim()) enviarComando(cmdLibre);
            }}
          />
          <button onClick={() => cmdLibre.trim() && enviarComando(cmdLibre)}>Encolar</button>
        </div>

        <p className="hint">
          El prefijo <code>C:&lt;id&gt;:</code> lo pone el servidor; escribe solo el comando.
          Los separadores entre parámetros son tabulaciones reales. El dialecto exacto varía
          entre firmwares — por eso está el campo libre: lanza, mira qué contesta el equipo
          en las tramas y ajusta. Los comandos destructivos (<code>CLEAR LOG</code> y
          similares) están bloqueados a propósito.
        </p>

        {avisoCmd && <div className="note">{avisoCmd}</div>}

        {comandos.length === 0 ? (
          <div className="scroll">
            <div className="empty">Ningún comando encolado todavía.</div>
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Comando</th>
                  <th>Estado</th>
                  <th>Retorno</th>
                  <th>Encolado</th>
                </tr>
              </thead>
              <tbody>
                {comandos.map((c) => {
                  const ok = c.retorno === '0' || c.retorno === 0;
                  return (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {c.cmd.replace(/\t/g, ' ⇥ ')}
                      </td>
                      <td>
                        <span className={`pill ${c.estado === 'respondido' ? (ok ? 'marcaciones' : 'sn_rechazado') : c.estado === 'entregado' ? 'handshake' : 'datos'}`}>
                          {c.estado}
                        </span>
                      </td>
                      <td>
                        {c.retorno == null ? (
                          <span style={{ color: 'var(--faint)' }}>—</span>
                        ) : (
                          <>
                            {c.retorno}
                            {ok ? (
                              <span className="tag">éxito</span>
                            ) : (
                              <span className="tag">
                                {String(c.retorno) === '-1001'
                                  ? 'capacidad llena'
                                  : String(c.retorno) === '-1002'
                                    ? 'no soportado'
                                    : 'error del equipo'}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ color: 'var(--faint)' }}>{hora(c.creado_ts)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Tramas crudas</h2>
        <p className="hint">
          Todo lo que toca <code>/iclock/*</code>, lo mas reciente arriba. Despliega una para
          ver el cuerpo escapado, el query string y las cabeceras que manda el equipo.
        </p>

        {frames.length === 0 ? (
          <div className="scroll">
            <div className="empty">
              Todavia no ha llegado nada. Verifica primero con{' '}
              <code>curl -i https://TU-DOMINIO/iclock/cdata?SN=CNYG213260182</code>
            </div>
          </div>
        ) : (
          frames.map((f) => (
            <details className="frame" key={f.id}>
              <summary>
                <span className="when">{hora(f.ts)}</span>
                <span className="meth">{f.method}</span>
                <span className="path">
                  {f.endpoint}
                  {f.table ? `?table=${f.table}` : ''}
                </span>
                {f.records > 0 && <span className="when">{f.records} reg.</span>}
                <span className={`pill ${claseDecision(f.decision)}`}>{f.decision}</span>
              </summary>
              <div className="body">
                <div className="lbl">Respuesta enviada</div>
                <div className="kv">
                  <b>{f.responded}</b>
                  {f.decision === 'handshake' && ' (+ bloque de opciones completo)'}
                </div>

                <div className="lbl">Query string</div>
                <div className="kv">
                  {Object.entries(f.query).length === 0
                    ? '(vacio)'
                    : Object.entries(f.query).map(([k, v]) => (
                        <span key={k}>
                          <b>{k}</b>={v}{' '}
                        </span>
                      ))}
                </div>

                {f.body_escaped && (
                  <>
                    <div className="lbl">
                      Cuerpo crudo escapado{f.eol ? ` · saltos: ${f.eol}` : ''}
                      {f.truncated ? ' · TRUNCADO' : ''}
                    </div>
                    <pre>{f.body_escaped}</pre>
                  </>
                )}

                <div className="lbl">Cliente</div>
                <div className="kv">
                  <b>User-Agent:</b> {f.user_agent || '(ninguno)'}
                  <br />
                  <b>pushcommkey:</b>{' '}
                  {f.push_comm_key ?? 'null — la Clave de Comunicacion del equipo esta en cero'}
                  <br />
                  <b>Content-Type:</b> {f.headers?.['content-type'] || '(ninguno)'}
                </div>
              </div>
            </details>
          ))
        )}
      </section>

      <p className="hint" style={{ marginTop: 32 }}>
        Verificacion en texto plano: <code>/health</code> · datos en bruto:{' '}
        <code>/api/frames</code>
      </p>
    </div>
  );
}
