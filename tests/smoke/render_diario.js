#!/usr/bin/env node
/* Smoke de la v55: dibuja el DIARIO igual a la mesa vieja, a 390 px (iPhone) y a 1200 px (Mac), con
   la vista REAL (vistaDiario) sobre un libro de fills inventado (julio → septiembre 2026, cuatro
   cuentas) y el CSS real de index.html. El módulo ENTERO (app/main.js) se evalúa en un DOM de juguete
   con un Supabase falso: ninguna llamada de red, ni a Supabase, ni a ningún bróker.
   Escribe tests/smoke/diario_v55.html (los dos bloques, uno debajo del otro) y, para las capturas,
   diario_v55_390.html y diario_v55_1200.html (un bloque cada uno).
   Uso: node tests/smoke/render_diario.js app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RUTA = process.argv[2] || path.join(__dirname, '..', '..', 'app', 'main.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
const INDEX = fs.readFileSync(path.join(path.dirname(RUTA), '..', 'index.html'), 'utf8');
const SALIDA = path.join(__dirname, 'diario_v55.html');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- datos inventados con la forma exacta de la base (julio → septiembre 2026) ----
const ymdNY = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
let id = 0;
const F = (broker, symbol, direccion, strike, expiracion, lado, contratos, precio, at, comision) => ({ id: ++id, user_id: 'u', broker, clave_ext: broker[0] + id, symbol, direccion, strike, expiracion, lado, contratos, precio, comision: comision || 0, ejecutado_at: at, fecha_ny: ymdNY(at), origen: (broker === 'tasty' || broker === 'moomoo') ? 'worker' : 'dispositivo' });
const et = (d) => d + 'T04:00:00.000Z';
const FILLS = [
  // julio: E*TRADE arranca el 31-jul
  F('etrade', 'SPY', 'CALL', 630, '2026-08-07', 'compra', 2, 2.10, et('2026-07-31'), 1.30), F('etrade', 'SPY', 'CALL', 630, '2026-08-07', 'venta', 2, 2.55, et('2026-07-31'), 1.30),
  // agosto: moomoo desde el 4-ago (la escribe el worker)
  F('moomoo', 'NVDA', 'CALL', 175, '2026-08-14', 'compra', 2, 1.90, '2026-08-04T14:05:00.000Z'), F('moomoo', 'NVDA', 'CALL', 175, '2026-08-14', 'venta', 2, 2.35, '2026-08-05T15:40:00.000Z'),
  F('etrade', 'TSLA', 'CALL', 340, '2026-08-21', 'compra', 1, 4.20, et('2026-08-11'), 0.65), F('etrade', 'TSLA', 'CALL', 340, '2026-08-21', 'venta', 1, 3.10, et('2026-08-13'), 0.65),
  F('moomoo', 'AAPL', 'PUT', 225, '2026-08-28', 'compra', 3, 1.10, '2026-08-18T13:45:00.000Z'), F('moomoo', 'AAPL', 'PUT', 225, '2026-08-28', 'venta', 3, 0.72, '2026-08-20T17:10:00.000Z'),
  F('etrade', 'META', 'CALL', 760, '2026-09-04', 'compra', 1, 6.10, et('2026-08-26'), 0.65), F('etrade', 'META', 'CALL', 760, '2026-09-04', 'venta', 1, 8.90, et('2026-08-27'), 0.65),
  F('etrade', 'AAPL', 'CALL', 230, '2026-09-04', 'compra', 3, 1.20, et('2026-08-31'), 1.95), F('etrade', 'AAPL', 'CALL', 230, '2026-09-04', 'venta', 3, 1.85, et('2026-09-01'), 1.95),
  // septiembre: Schwab (thinkorswim) desde el 8-sep, tasty desde el 15-sep
  F('etrade', 'TSLA', 'PUT', 400, '2026-09-11', 'compra', 2, 3.10, et('2026-09-02'), 1.30), F('etrade', 'TSLA', 'PUT', 400, '2026-09-11', 'venta', 1, 4.40, et('2026-09-03'), 0.65), F('etrade', 'TSLA', 'PUT', 400, '2026-09-11', 'venta', 1, 2.10, et('2026-09-04'), 0.65),
  F('schwab', 'NVDA', 'CALL', 180, '2026-09-11', 'compra', 2, 2.10, '2026-09-08T14:02:00.000Z'), F('schwab', 'NVDA', 'CALL', 180, '2026-09-11', 'venta', 2, 2.95, '2026-09-09T15:31:00.000Z'),
  F('schwab', 'SPY', 'CALL', 660, '2026-09-11', 'compra', 1, 2.40, '2026-09-10T14:05:00.000Z'),                      // vence sin venderse (Schwab no reporta): deducido
  F('moomoo', 'SPY', 'CALL', 655, '2026-09-18', 'compra', 2, 3.05, '2026-09-11T14:20:00.000Z'), F('moomoo', 'SPY', 'CALL', 655, '2026-09-18', 'venta', 2, 3.60, '2026-09-11T18:55:00.000Z'),
  F('etrade', 'META', 'PUT', 700, '2026-09-18', 'compra', 1, 5.00, et('2026-09-14'), 0.65), F('etrade', 'META', 'PUT', 700, '2026-09-18', 'vencimiento', 1, 0, et('2026-09-18'), 0),   // reportado por E*TRADE
  F('tasty', 'AAPL', 'CALL', 235, '2026-09-18', 'compra', 2, 1.32, '2026-09-15T14:40:00.000Z'), F('tasty', 'AAPL', 'CALL', 235, '2026-09-18', 'venta', 2, 1.80, '2026-09-16T17:10:00.000Z'),
  F('etrade', 'SPY', 'CALL', 769, '2026-09-25', 'compra', 2, 3.30, et('2026-09-22'), 1.30), F('etrade', 'SPY', 'CALL', 769, '2026-09-25', 'venta', 1, 4.00, et('2026-09-23'), 0.65),
  F('schwab', 'NVDA', 'CALL', 185, '2026-10-02', 'compra', 3, 2.10, '2026-09-22T14:10:00.000Z'),
  F('tasty', 'META', 'PUT', 700, '2026-10-16', 'compra', 1, 5.00, '2026-09-24T15:00:00.000Z'),
  F('schwab', 'QQQ', 'CALL', 600, '2026-09-25', 'venta', 1, 1.10, '2026-09-24T19:30:00.000Z'),                      // huérfana: la compra es anterior a la ventana
];
const POSICIONES = [
  { id: 1, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-25', contratos: 1, prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20, mark: 3.40, mark_at: new Date().toISOString(), abierta_at: et('2026-09-22'), abierta_fecha_ny: '2026-09-22' },
  { id: 4, estado: 'abierta', broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 185, expiracion: '2026-10-02', contratos: 3, prima_fill: 2.10, gtc_limite: 2.86, plan_pct: 35, stop_pct: null, mark: 2.50, mark_at: new Date().toISOString(), abierta_at: '2026-09-22T14:10:00.000Z', abierta_fecha_ny: '2026-09-22' },
  { id: 7, estado: 'abierta', broker: 'tasty', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, prima_fill: 5.00, gtc_limite: 5.52, plan_pct: 10, stop_pct: 20, mark: 4.90, mark_at: new Date().toISOString(), abierta_at: '2026-09-24T15:00:00.000Z', abierta_fecha_ny: '2026-09-24' },
];
const NOTAS = [
  { id: 31, fecha_ny: ymdNY(new Date().toISOString()), texto: 'SPY: entré en la parte alta del rango un jueves. Lección: si el bid se mueve 10 % en el minuto de la señal, espero la siguiente.', symbol: 'SPY', posicion_id: 1, creado_at: new Date(Date.now() - 3600000).toISOString(), actualizado_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 30, fecha_ny: '2026-09-18', texto: 'META PUT venció sin venderse: −$500. No puse la GTC porque «iba a rebotar». Regla rota.', symbol: 'META', posicion_id: null, creado_at: '2026-09-18T21:00:00.000Z', actualizado_at: '2026-09-18T21:00:00.000Z' },
];
const TICKERS_CAT = [
  { symbol: 'AAPL', nombre: 'Apple', rol: 'operable', activo: true, orden: 1 }, { symbol: 'TSLA', nombre: 'Tesla', rol: 'operable', activo: true, orden: 2 },
  { symbol: 'NVDA', nombre: 'NVIDIA', rol: 'operable', activo: true, orden: 3 }, { symbol: 'SPY', nombre: 'SPDR S&P 500', rol: 'operable', activo: true, orden: 4 },
  { symbol: 'META', nombre: 'Meta Platforms', rol: 'operable', activo: true, orden: 5 },
];
const DATOS = { fills: FILLS, posiciones: POSICIONES, broker_trades: [], cuenta_snapshots: [], notas: NOTAS, tickers: TICKERS_CAT, posiciones_broker: [], ordenes: [], senales: [], ticker_estado: [], worker_heartbeat: [] };

// ---- DOM de juguete: los nodos por selector persisten (para leer #vista.innerHTML) ----
const nodos = {};
const nodo = () => ({ innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '',
  classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
  addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, scrollIntoView() {}, forEach() {} });
const almacen = {};
const canal = { on() { return canal; }, subscribe() { return canal; } };
const consulta = (tabla) => { const q = {}; ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'range', 'lt', 'gte', 'lte', 'neq', 'is', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single'].forEach(k => { q[k] = () => q; });
  q.then = (f) => Promise.resolve({ data: DATOS[tabla] || [], error: null }).then(f); return q; };
const win = { MESA2: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', PROXY_URL: 'https://proxy' },
  supabase: { createClient: () => ({ from: consulta, channel: () => canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) },
  localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
  addEventListener() {}, location: { hash: '#/cuentas', reload() {} }, Intl, Date, Math, JSON, Promise,
  setTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => Promise.reject(new Error('sin red')),
  navigator: { serviceWorker: { register: () => Promise.resolve(), addEventListener() {} } },
  document: { querySelector: (s) => (nodos[s] = nodos[s] || nodo()), querySelectorAll: () => [], createElement: () => nodo(), addEventListener() {}, body: nodo(), visibilityState: 'visible', currentScript: { src: './app/main.js?v=55' } } };
win.window = win;
vm.createContext(win);
vm.runInContext(FUENTE, win, { filename: 'main.js' });
const ev = (t) => vm.runInContext(t, win);
ev("sesionActiva = { user: { id: 'u', email: 'andres@ejemplo.com' } }");

(async () => {
  const vista = () => nodos['#vista'].innerHTML;
  ev("_cuentasVista = 'diario'; TICKERS = tickersOperables(" + JSON.stringify(TICKERS_CAT) + ", TICKERS_RESPALDO)");
  // E*TRADE con sesión en este equipo (la pantalla lo dice), Schwab sin ella: como suele estar el iPhone de Andrés
  ev("localStorage.setItem('mz_et_tok', 'x'); localStorage.setItem('mz_et_sec', 'y'); localStorage.setItem('mz_et_dia', hoyNY())");
  await ev('vistaDiario()');
  const todo = vista();
  ev("localStorage.setItem('mz_diario_periodo', JSON.stringify({ modo: 'meses', vals: [hoyNY().slice(0, 7)] }))");
  await ev('vistaDiario()');
  const esteMes = vista();
  ev("localStorage.removeItem('mz_diario_periodo')");

  const BLOQUES = [
    ['iPhone · 390 px', 'Cuentas → Diario · todo el historial', 'La vista REAL (vistaDiario) sobre el libro de fills, apilada como en el teléfono: selector de período, «Historial de cada cuenta» apilado, las tarjetas a dos columnas, RESUMEN MENSUAL y SEMANAL como tablas que se desplazan de lado dentro de su tarjeta, y debajo lo de siempre.', todo, 390, ''],
    ['Mac · 1200 px', 'Cuentas → Diario · todo el historial', 'La misma vista con el envoltorio ancho (#app.ancho): «Historial de cada cuenta» en una sola línea, la fila de tarjetas de la mesa vieja (TOTAL DEL PERÍODO · % GANADO POR $ OPERADO · ACIERTOS · una por cuenta · PROMEDIO POR DÍA · PROYECCIÓN MENSUAL · PROYECCIÓN ANUAL) y las tablas con las seis columnas a la vista.', todo, 1200, 'ancho'],
    ['iPhone · 390 px', 'Diario · «Este mes» elegido', 'El pie de TOTAL DEL PERÍODO sigue al período («Septiembre 2026 · 2026-09-01 → 2026-09-30»); las semanas de ese mes quedan a la vista para sumar otra.', esteMes.split('<div class="sec">DÍA A DÍA')[0], 390, ''],
  ];

  const css = (/<style>([\s\S]*?)<\/style>/.exec(INDEX) || [, ''])[1];
  const pagina = (titulo, bloques) => `<!doctype html>
<html lang="es" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>${css}</style>
<style>
  body{padding:22px 18px 60px}
  .tablero{display:flex;flex-direction:column;gap:30px;align-items:flex-start;max-width:none}
  .caso{flex:none}
  .caso > h2{font-family:'Newsreader',Georgia,serif;font-size:17px;font-weight:600;margin:0 0 3px;color:var(--tx)}
  .caso > p{margin:0 0 9px;color:var(--tx2);font-size:11.5px;line-height:1.5;max-width:900px}
  .marco{background:var(--bg);border:1px solid var(--line);border-radius:18px;padding:10px 16px 18px;display:flex;flex-direction:column;gap:11px}
  .marco.ancho{padding:10px 24px 18px}
  .cab{font-family:'Newsreader',Georgia,serif;font-size:21px;color:var(--tx);margin:2px 0 0}
  .nota{max-width:1240px;margin:0 0 20px;color:var(--tx2);font-size:12.5px;line-height:1.55}
  .nota b{color:var(--tx)}
</style></head><body>
<h1 style="font-family:'Newsreader',Georgia,serif;font-weight:600;font-size:26px;margin:0 0 6px">Mesa de Mercado 2.0 · v55 · EL DIARIO igual a la mesa vieja</h1>
<p class="nota">Dibujado evaluando <b>app/main.js entero</b> en un DOM de juguete con un Supabase falso (libro de fills inventado, julio → septiembre 2026, cuatro cuentas) y el CSS real de <code>index.html</code>. Tema oscuro (data-theme=dark, el de Andrés y el de la mesa vieja); sin fuentes externas ni ninguna llamada de red. Ninguna orden se arma ni se envía en este camino.</p>
<div class="tablero">
${bloques.map(([anchoTxt, t, d, h, w, cls]) => `  <section class="caso" style="width:${w}px"><h2>${esc(anchoTxt)} · ${esc(t)}</h2><p>${esc(d)}</p>
    <div class="marco ${cls}" style="width:${w}px"><div class="cab">Cuentas y diario</div>${h}</div></section>`).join('\n')}
</div></body></html>`;
  fs.writeFileSync(SALIDA, pagina('Mesa 2.0 · v55 · DIARIO · 390 y 1200 px', BLOQUES));
  fs.writeFileSync(path.join(__dirname, 'diario_v55_390.html'), pagina('Mesa 2.0 · v55 · DIARIO · 390 px', [BLOQUES[0]]));
  fs.writeFileSync(path.join(__dirname, 'diario_v55_1200.html'), pagina('Mesa 2.0 · v55 · DIARIO · 1200 px', [BLOQUES[1]]));
  console.log('escrito ' + SALIDA + ' (' + BLOQUES.length + ' bloques) + diario_v55_390.html + diario_v55_1200.html');
  // Lo que la pantalla DICE (para el resumen de la entrega, sin inventar nada)
  const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const t = txt(todo);
  const trozo = (marca, n) => { const i = t.indexOf(marca); return i < 0 ? '(no está: ' + marca + ')' : t.slice(i, i + n); };
  console.log('· ' + trozo('Historial de cada cuenta:', 330));
  console.log('· ' + trozo('TOTAL DEL PERÍODO', 520));
  console.log('· ' + trozo('RESUMEN MENSUAL', 400));
  console.log('· ' + trozo('RESUMEN SEMANAL', 220));
})().catch(e => { console.error('FALLA render: ' + (e && e.stack || e)); process.exit(1); });
