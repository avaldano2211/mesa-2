#!/usr/bin/env node
/* Smoke de la v55: dibuja la sección POSICIONES del Copiloto IGUAL al Gestor de la mesa vieja, a 390 px
   (iPhone: tarjetas) y a 1200 px (Mac: la tabla de 10 columnas), más el gráfico «SPY · 5 min» con los
   strikes, con la vista REAL (vistaCopiloto) sobre un libro inventado (cuatro brókeres) y el CSS real de
   index.html. El módulo ENTERO (app/main.js) se evalúa en un DOM de juguete con un Supabase falso que
   honra los filtros eq/in: ninguna llamada de red, ni a Supabase, ni a ningún bróker, ni una orden.
   Escribe tests/smoke/posiciones_v55.html (los dos bloques) y posiciones_v55_390.html / _1200.html.
   Uso: node tests/smoke/render_posiciones.js app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RUTA = process.argv[2] || path.join(__dirname, '..', '..', 'app', 'main.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
const INDEX = fs.readFileSync(path.join(path.dirname(RUTA), '..', 'index.html'), 'utf8');
const SALIDA = path.join(__dirname, 'posiciones_v55.html');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ahora = new Date().toISOString();
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

// ---- datos inventados con la forma exacta de la base (sql 0018 aplicada: columnas del gestor) ----
const POSICIONES = [
  // SPY 770 CALL ×2 en E*TRADE: trailing 20 % armado con 🛡️, máximo 5.00 → salta en 4.00 (el nivel del worker); mark 4.20 → margen 5 % (ámbar)
  { id: 1, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', contratos: 2, prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20,
    mark: 4.18, mark_at: hace(1), mfe: 5.00, mae: 3.10, abierta_at: hace(60 * 26), abierta_fecha_ny: '2026-09-25',
    modo_salida: 'trailing', trail_pct: 20, arm_pct: 0, protege_costo: true, target_pct: null, stop_fijo_pct: null, activo: true, nivel_trailing: 4.0 },
  // NVDA 185 CALL ×3 en Schwab: trailing con activación +25 %: máximo 2.30 sobre 2.10 = +9.5 % → DORMIDO
  { id: 4, estado: 'abierta', broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 185, expiracion: '2026-10-16', contratos: 3, prima_fill: 2.10, gtc_limite: 2.86, plan_pct: 35, stop_pct: null,
    mark: 2.25, mark_at: hace(1), mfe: 2.30, mae: 1.95, abierta_at: hace(60 * 5), abierta_fecha_ny: '2026-09-28',
    modo_salida: 'trailing', trail_pct: 25, arm_pct: 25, protege_costo: false, target_pct: null, stop_fijo_pct: null, activo: true, nivel_trailing: 1.725 },
  // META 700 PUT ×1 en moomoo (foto del worker): Objetivo+Stop +60 % / −45 % sobre 5.00 → 8.00 / 2.75
  { id: 7, estado: 'abierta', broker: 'moomoo', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, prima_fill: 5.00, gtc_limite: 5.52, plan_pct: 10, stop_pct: 20,
    mark: 4.90, mark_at: hace(1), mfe: 5.40, mae: 4.60, abierta_at: hace(60 * 30), abierta_fecha_ny: '2026-09-25',
    modo_salida: 'fijo', trail_pct: 20, arm_pct: 0, protege_costo: false, target_pct: 60, stop_fijo_pct: 45, activo: true, nivel_trailing: null },
  // TSLA 400 CALL ×1 en E*TRADE con «Activo» apagado: la alarma de dinero SIN VIGILAR
  { id: 9, estado: 'abierta', broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.00, gtc_limite: 2.22, plan_pct: 10, stop_pct: 20,
    mark: 1.62, mark_at: hace(1), mfe: 2.40, mae: 1.60, abierta_at: hace(60 * 3), abierta_fecha_ny: '2026-09-28',
    modo_salida: 'trailing', trail_pct: 20, arm_pct: 0, protege_costo: false, target_pct: null, stop_fijo_pct: null, activo: false, nivel_trailing: 1.92 },
];
// la cartera de E*TRADE leída en ESTE equipo (v50): SPY (casa con la ficha 1, P&L NETO del bróker con comisiones),
// TSLA (casa con la 9) y AAPL 235 CALL ×2 SIN registrar
const ITEM = (o) => Object.assign({ comisiones: null, abierta_at: null, abierta_estimada: true, origen_valor: 'broker', origen_pnl: 'broker', origen_invertido: 'broker', origen_mark: 'broker' }, o);
const CART_ET = { estado: 'ok', detalle: '', ts: Date.now() - 20000, fallos: 0, truncada: false, otros: { acciones: 1, efectivo: 0, vendidas: 0, ilegibles: 0, otros: 0 }, items: [
  ITEM({ broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', contratos: 2, prima_fill: 3.30, mark: 4.20, valor_actual: 840, invertido: 660, pnl_usd: 178.70, pnl_pct: 27.08, comisiones: 1.30, abierta_at: hace(60 * 26), abierta_estimada: false, clave: 'etrade|SPY|CALL|770|2026-10-02' }),
  ITEM({ broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.00, mark: 1.62, valor_actual: 162, invertido: 200, pnl_usd: -38.65, pnl_pct: -19.3, comisiones: 0.65, clave: 'etrade|TSLA|CALL|400|2026-10-09' }),
  ITEM({ broker: 'etrade', symbol: 'AAPL', direccion: 'CALL', strike: 235, expiracion: '2026-10-09', contratos: 2, prima_fill: 1.32, mark: 1.55, valor_actual: 310, invertido: 264, pnl_usd: 44.70, pnl_pct: 16.9, comisiones: 1.30, clave: 'etrade|AAPL|CALL|235|2026-10-09' }),
] };
// la foto del worker (posiciones_broker): moomoo META (casa con la 7) + QQQ sin registrar; tasty sin filas
const FOTO = [
  { user_id: 'u', broker: 'moomoo', clave: 'META  261016P00700000', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, costo_promedio: 5.00, mark: 4.90, mark_fuente: 'vivo', valor_usd: 490, pl_usd: -10, pl_pct: -2, origen: 'worker', actualizado_at: hace(1) },
  { user_id: 'u', broker: 'moomoo', clave: 'QQQ   261009C00600000', symbol: 'QQQ', direccion: 'CALL', strike: 600, expiracion: '2026-10-09', contratos: 1, costo_promedio: 2.40, mark: 2.62, mark_fuente: 'vivo', valor_usd: 262, pl_usd: 22, pl_pct: 9.2, origen: 'worker', actualizado_at: hace(1) },
];
// velas de SPY: 5 min (400 velas de sesión, sin niveles) y 15 min (con los niveles Sardiñas)
const T0 = Math.floor(Date.parse('2026-09-28T13:30:00Z') / 1000);   // lunes 28-sep-2026, 9:30 ET
function velas(n, paso, base, amp) {
  const out = []; let px = base;
  for (let i = 0; i < n; i++) {
    const o = px, c = o + Math.sin(i / 7) * amp * 0.5 + Math.cos(i / 3) * amp * 0.25;
    out.push([T0 - (n - i) * paso, Number(o.toFixed(2)), Number((Math.max(o, c) + amp * 0.3).toFixed(2)), Number((Math.min(o, c) - amp * 0.3).toFixed(2)), Number(c.toFixed(2)), 800 + (i % 17) * 40]);
    px = c;
  }
  return out;
}
const NIVELES = { spot: 771.4, cierre_ayer: 766.2, apertura_hoy: 768.1, max_ayer: 769.8, min_ayer: 761.0, ath: 780.5, atl: 742.0, ath_dias: 120, ath_fecha: '2026-09-12', atl_fecha: '2026-08-02',
  techos_hora: [{ p: 774.6, respetos: 2, edad: 9 }, { p: 778.1, respetos: 1, edad: 21 }], pisos_hora: [{ p: 767.3, respetos: 3, edad: 5 }, { p: 763.9, respetos: 1, edad: 16 }], techos_dia: [], pisos_dia: [], salto: null };
const TICKER_VELAS = [
  { symbol: 'SPY', tf: 'm5', payload: { schema_version: 1, ticker: 'SPY', tf: 'm5', velas: velas(400, 300, 766, 1.4), vela_viva: [T0, 771.2, 771.9, 770.8, 771.4, 300], niveles: {} }, actualizado_at: ahora },
  { symbol: 'SPY', tf: 'm15', payload: { schema_version: 1, ticker: 'SPY', tf: 'm15', velas: velas(130, 900, 760, 2.2), vela_viva: null, niveles: NIVELES }, actualizado_at: ahora },
];
const TICKERS_CAT = [
  { symbol: 'AAPL', nombre: 'Apple', rol: 'operable', activo: true, orden: 1 }, { symbol: 'TSLA', nombre: 'Tesla', rol: 'operable', activo: true, orden: 2 },
  { symbol: 'NVDA', nombre: 'NVIDIA', rol: 'operable', activo: true, orden: 3 }, { symbol: 'SPY', nombre: 'SPDR S&P 500', rol: 'operable', activo: true, orden: 4 },
  { symbol: 'META', nombre: 'Meta Platforms', rol: 'operable', activo: true, orden: 5 },
];
// el latido del worker 0.1.7 lleva detalle.gestor: con 0018 a la vista la cabecera dice que el worker vigila
const HB = { componente: 'worker', latido_at: ahora, sesion: 'regular', estado_proceso: 'vivo', detalle: { gestor: { import_ok: true, migracion_0018: true, ultima_pasada_ok_at: ahora } } };
const DATOS = { posiciones: POSICIONES, senales: [], broker_trades: [], ordenes: [], plan_usuario: [], senales_ocultas: [], posiciones_broker: FOTO, ticker_velas: TICKER_VELAS, ticker_targets: [], tickers: TICKERS_CAT, worker_heartbeat: [HB], fills: [], notas: [] };

// ---- DOM de juguete: los nodos por selector persisten (para leer #vista.innerHTML y los del gráfico) ----
const nodos = {};
const nodo = () => ({ innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '', clientWidth: 0,
  classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
  addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, scrollIntoView() {}, contains() { return false; } });
const almacen = {};
const canal = { on() { return canal; }, subscribe() { return canal; } };
// consulta con filtros: eq / in se aplican de verdad (el resto se ignora)
const consulta = (tabla) => {
  const filtros = []; const q = {};
  ['select', 'order', 'limit', 'range', 'lt', 'gte', 'lte', 'neq', 'is', 'not', 'like', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single'].forEach(k => { q[k] = () => q; });
  q.eq = (c, v) => { filtros.push([c, [v]]); return q; }; q.in = (c, vs) => { filtros.push([c, vs]); return q; };
  q.then = (f) => { const rows = (DATOS[tabla] || []).filter(r => filtros.every(([c, vs]) => vs.map(String).includes(String(r[c])))); return Promise.resolve({ data: tabla === 'worker_heartbeat' ? rows[0] || null : rows, error: null }).then(f); };
  return q;
};
const win = { MESA2: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', PROXY_URL: 'https://proxy' },
  supabase: { createClient: () => ({ from: consulta, channel: () => canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) },
  localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
  addEventListener() {}, location: { hash: '#/copiloto', reload() {} }, Intl, Date, Math, JSON, Promise, innerWidth: 390,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => Promise.reject(new Error('sin red')),
  navigator: { serviceWorker: { register: () => Promise.resolve(), addEventListener() {} }, userAgent: 'prueba' },
  document: { querySelector: (s) => (nodos[s] = nodos[s] || nodo()), querySelectorAll: () => [], createElement: () => nodo(), addEventListener() {}, body: nodo(), visibilityState: 'visible', currentScript: { src: './app/main.js?v=55' } } };
win.window = win;
vm.createContext(win);
vm.runInContext(FUENTE, win, { filename: 'main.js' });
const ev = (t) => vm.runInContext(t, win);
ev("sesionActiva = { user: { id: 'u', email: 'andres@ejemplo.com' } }");
ev("TICKERS = tickersOperables(" + JSON.stringify(TICKERS_CAT) + ", TICKERS_RESPALDO)");
// la cartera de E*TRADE ya leída en este equipo (hace 20 s: no se vuelve a preguntar) y Schwab sin sesión
ev("_cart.etrade = " + JSON.stringify(CART_ET) + "; _cart.schwab = { estado: 'sin', items: [], otros: null, ts: Date.now() }");

(async () => {
  const vista = () => nodos['#vista'].innerHTML;
  const armar = async (ancho) => {
    win.innerWidth = ancho;
    nodos['#gchSvg'] = nodo(); nodos['#gchSvg'].clientWidth = ancho >= 900 ? ancho - 80 : ancho - 64;
    nodos['#gchLeg'] = nodo(); nodos['#gchFresco'] = nodo(); nodos['#gchZoomTxt'] = nodo(); nodos['#gchTitulo'] = nodo();
    await ev('vistaCopiloto(' + JSON.stringify(HB) + ')');
    // la foto del worker (moomoo) se lee DESPUÉS del primer dibujado (cargarCartera → redibujo si cambió): se espera y se pinta otra vez
    await new Promise(r => setTimeout(r, 60));
    await ev('vistaCopiloto(' + JSON.stringify(HB) + ')');
    await ev('cargarChartGestor(true)');
    let h = vista();
    // el gráfico se pinta en sus nodos (#gchSvg, #gchLeg…) después del dibujado: se empalma aquí
    h = h.replace(/<div class="gchart" id="gchSvg">[\s\S]*?<\/div><\/div>/, '<div class="gchart" id="gchSvg">' + nodos['#gchSvg'].innerHTML + '</div>');
    h = h.replace('<div class="gleg" id="gchLeg"></div>', '<div class="gleg" id="gchLeg">' + nodos['#gchLeg'].innerHTML + '</div>');
    h = h.replace('<span id="gchFresco"></span>', '<span id="gchFresco">' + esc(nodos['#gchFresco'].textContent) + '</span>');
    h = h.replace('<span id="gchZoomTxt"></span>', '<span id="gchZoomTxt">' + esc(nodos['#gchZoomTxt'].textContent) + '</span>');
    return h;
  };
  const iphone = await armar(390);
  const mac = await armar(1200);
  // solo la parte del gestor (desde POSICIONES ABIERTAS hasta antes de ÓRDENES ACTIVAS)
  const recorte = (h) => { const i = h.indexOf('<div class="sec">POSICIONES ABIERTAS'); const j = h.indexOf('<div class="sec fila" style="margin-top:8px">ÓRDENES ACTIVAS'); return h.slice(i, j > i ? j : undefined); };

  const BLOQUES = [
    ['iPhone · 390 px', 'Copiloto → Posiciones abiertas', 'La vista REAL (vistaCopiloto) apilada como en el teléfono: banner de bróker, alarma 🔕 SIN VIGILANCIA, la barra INVERTIDO · VALOR AHORA · GANANCIA/PÉRDIDA, y una tarjeta por posición con el gestor entero (modo, parámetros, SALTA EN, Activo, Vender). Debajo, el gráfico «SPY · 5 min» con los strikes y las líneas Sardiñas.', recorte(iphone), 390, ''],
    ['Mac · 1200 px', 'Copiloto → Posiciones abiertas', 'La misma vista con el envoltorio ancho: la TABLA de 10 columnas del Gestor de la mesa vieja (Contrato · Cant · Costo · Mark · P&L · Modo de salida · Parámetros · Salta en · Activo · Vender), lo sin registrar en la misma tabla con Adoptar, y el gráfico a 372 px con zoom y arrastre.', recorte(mac), 1200, 'ancho'],
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
<h1 style="font-family:'Newsreader',Georgia,serif;font-weight:600;font-size:26px;margin:0 0 6px">Mesa de Mercado 2.0 · v55 · POSICIONES igual al Gestor de la mesa vieja</h1>
<p class="nota">Dibujado evaluando <b>app/main.js entero</b> en un DOM de juguete con un Supabase falso (libro inventado: E*TRADE leído en el equipo, Schwab sin sesión, moomoo y tasty por la foto del worker; velas de SPY de 5 y 15 min) y el CSS real de <code>index.html</code>. Tema oscuro; sin fuentes externas ni ninguna llamada de red. Ninguna orden se arma ni se envía en este camino.</p>
<div class="tablero">
${bloques.map(([anchoTxt, t, d, h, w, cls]) => `  <section class="caso" style="width:${w}px"><h2>${esc(anchoTxt)} · ${esc(t)}</h2><p>${esc(d)}</p>
    <div class="marco ${cls}" style="width:${w}px"><div class="cab">Copiloto</div>${h}</div></section>`).join('\n')}
</div></body></html>`;
  fs.writeFileSync(SALIDA, pagina('Mesa 2.0 · v55 · POSICIONES · 390 y 1200 px', BLOQUES));
  fs.writeFileSync(path.join(__dirname, 'posiciones_v55_390.html'), pagina('Mesa 2.0 · v55 · POSICIONES · 390 px', [BLOQUES[0]]));
  fs.writeFileSync(path.join(__dirname, 'posiciones_v55_1200.html'), pagina('Mesa 2.0 · v55 · POSICIONES · 1200 px', [BLOQUES[1]]));
  console.log('escrito ' + SALIDA + ' (' + BLOQUES.length + ' bloques) + posiciones_v55_390.html + posiciones_v55_1200.html');
  // Lo que la pantalla DICE (para el resumen de la entrega, sin inventar nada)
  const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const t = txt(recorte(mac)), ti = txt(recorte(iphone));
  const trozo = (s, marca, n) => { const i = s.indexOf(marca); return i < 0 ? '(no está: ' + marca + ')' : s.slice(i, i + n); };
  console.log('· ' + trozo(t, 'SIN VIGILANCIA', 200));
  console.log('· ' + trozo(t, 'CARTERA ABIERTA', 330));
  console.log('· tabla (Mac): ' + ((mac.match(/<tr class="grow/g) || []).length) + ' filas · ' + trozo(t, 'SPY 770 CALL', 260));
  console.log('· NVDA dormido: ' + trozo(t, '💤', 90));
  console.log('· META fijo: ' + trozo(t, 'META 700 PUT', 300));
  console.log('· cabecera: ' + trozo(t, 'POSICIONES ABIERTAS', 170));
  console.log('· sin registrar: ' + trozo(t, 'AAPL 235 CALL', 120) + ' | ' + trozo(t, 'QQQ 600 CALL', 120));
  console.log('· iPhone: tarjetas=' + ((iphone.match(/class="gest/g) || []).length) + ' · ' + trozo(ti, 'SALTA EN', 120));
  console.log('· gráfico: ' + trozo(txt(nodos['#gchTitulo'].textContent + ' ' + nodos['#gchLeg'].innerHTML + ' ' + nodos['#gchFresco'].textContent), 'SPY', 300));
  console.log('· svg: ' + (/<svg/.test(nodos['#gchSvg'].innerHTML) ? 'sí' : 'NO') + ' · strikes en el svg: ' + ((nodos['#gchSvg'].innerHTML.match(/data-nivel="strike"/g) || []).length));
})().catch(e => { console.error('FALLA render: ' + (e && e.stack || e)); process.exit(1); });
