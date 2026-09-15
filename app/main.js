/* Mesa de Mercado 2.0 — app (PWA). Lee en vivo de Supabase; la muralla es RLS + whitelist.
   Doctrina heredada: JAMÁS presentar un dato viejo como fresco — cada dato
   lleva su antigüedad, y el badge distingue «mercado cerrado» de «worker caído». */
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.MESA2;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
const PROXY_URL = (window.MESA2 && window.MESA2.PROXY_URL) || '';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

const TICKERS = ['AAPL', 'TSLA', 'NVDA', 'SPY'];   // 2026-09-14: Andrés vuelve a sus 4 y elige cada día cuál operar (QQQ, SPX y META salen)
// Versión que está corriendo: el ?v= con que index.html cargó este archivo. Sirve
// para detectar que se publicó otra y recargar sola (ver buscarVersionNueva).
const VERSION_APP = (() => {
  try { const m = /[?&]v=(\d+)/.exec((document.currentScript && document.currentScript.src) || ''); return m ? Number(m[1]) : 0; }
  catch (_) { return 0; }
})();
const TABS = [
  { id: 'informe',    lbl: 'Informe',    icon: 'M4 5h13v14H6a2 2 0 0 1-2-2z M17 8h3v9a2 2 0 0 1-2 2h-1 M7.5 9h6M7.5 12.5h6M7.5 16h6' },
  { id: 'tickers',    lbl: 'Tickers',    icon: 'M6 5.5v13 M12 3.5v15 M18 7.5v11' },
  { id: 'copiloto',   lbl: 'Copiloto',   icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.5 8.5l-2.2 5-4.8 2 2.2-5z' },
  { id: 'cuentas',    lbl: 'Cuentas',    icon: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1.2 M4 7.5V17a2 2 0 0 0 2 2h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 19 10H6a2 2 0 0 1-2-2z' },
  { id: 'disciplina', lbl: 'Disciplina', icon: 'M12 3l7 2.6v5.6c0 4.3-2.9 7.4-7 9.3-4.1-1.9-7-5-7-9.3V5.6z M9 11.8l2.1 2.1 4.2-4.2' },
];

// ---------- auth ----------
// Login por REST directo, sin la maquinaria de sesión/locks de supabase-js (que
// falla en iOS): token grant → escribir la sesión donde supabase-js la lee →
// recargar (la recuperación de sesión al arrancar sí funciona en iOS).
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginErr'); err.textContent = 'Entrando…';
  const email = $('#email').value.trim().toLowerCase(), password = $('#pass').value;
  let r, ses = {};
  try {
    r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }) });
    ses = await r.json().catch(() => ({}));
  } catch (_) { err.textContent = 'Sin conexión. Inténtalo de nuevo.'; return; }
  if (!r.ok || !ses.access_token) {
    const m = String(ses.error_description || ses.msg || ses.error || '');
    err.textContent = /invalid|credentials/i.test(m) ? 'Correo o contraseña incorrectos.'
      : /confirm/i.test(m) ? 'Correo sin confirmar.' : ('No pude entrar: ' + (m || r.status));
    return;
  }
  try {
    if (!ses.expires_at && ses.expires_in) ses.expires_at = Math.floor(Date.now() / 1000) + Number(ses.expires_in);
    localStorage.setItem(claveSesion(), JSON.stringify(ses));
  } catch (_) { err.textContent = 'Este navegador no deja guardar la sesión (¿modo privado?).'; return; }
  location.reload();
});

sb.auth.onAuthStateChange((_e, session) => arrancar(session));
sb.auth.getSession().then(({ data }) => arrancar(data.session));

let sesionActiva = null, timer = null, canal = null;
function arrancar(session) {
  sesionActiva = session;
  const entrado = !!session;
  $('#login').classList.toggle('oculto', entrado);
  $('#app').classList.toggle('oculto', !entrado);
  if (entrado) {
    dibujarNav();
    if (!location.hash) location.hash = '#/informe';
    ruta();
    suscribir();
    if (timer) clearInterval(timer);
    timer = setInterval(ruta, 60000); // respaldo por si Realtime cae
    // versión nueva: al arrancar y cada 10 min (en window para no depender del orden de carga)
    if (!window._mzTimerVersion) window._mzTimerVersion = setInterval(buscarVersionNueva, 10 * 60000);
    setTimeout(buscarVersionNueva, 5000);
    setTimeout(reanudarLoginEtrade, 400);   // login de E*TRADE a medias (PWA recargada durante el 2FA)
  } else if (timer) { clearInterval(timer); }
}
window.addEventListener('hashchange', ruta);
// Al volver del fondo (iOS congela la PWA y corta los fetch en vuelo): si estuvo
// oculta más de 30 s se redibuja la vista y, si hay un formulario de orden
// abierto, se recarga la cadena.
// ---- actualización sola ----
// En el iPhone la PWA NO se recarga al volver a abrirla: sigue corriendo el
// código que tenía en memoria aunque haya una versión nueva publicada. El
// 2026-09-14 los charts de v45/v46 no le salían a Andrés por eso (la base no
// registró ni una lectura de ticker_velas desde la app). Se compara la versión
// que corre con la que publica index.html y, si hay una más nueva, se recarga
// en cuanto no haya ningún cuadro abierto: jamás a mitad de una orden.
function versionPublicada(html) {
  const m = /app\/main\.js\?v=(\d+)/.exec(String(html || ''));
  return m ? Number(m[1]) : 0;
}
let _buscandoVersion = false, _versionPendiente = 0;
async function buscarVersionNueva() {
  if (_buscandoVersion || !VERSION_APP) return;
  _buscandoVersion = true;
  try {
    const r = await fetch('./index.html?nv=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = versionPublicada(await r.text());
    if (v > VERSION_APP) { _versionPendiente = v; recargarSiSePuede(); }
  } catch (_) {
    // sin red: se vuelve a mirar en la próxima ocasión
  } finally { _buscandoVersion = false; }
}
function recargarSiSePuede() {
  if (!_versionPendiente) return;
  if (document.querySelector('.modal') || (typeof _corte !== 'undefined' && _corte.enCurso)) { setTimeout(recargarSiSePuede, 15000); return; }   // cuadro abierto o corte en curso: esperar
  toast('Actualizando la Mesa a la versión ' + _versionPendiente + '…');
  setTimeout(() => location.reload(), 700);
}

let _ocultaDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { _ocultaDesde = Date.now(); return; }
  buscarVersionNueva();                                   // al volver a la app: ¿hay versión nueva?
  if (!sesionActiva || !_ocultaDesde || Date.now() - _ocultaDesde < 30000) return;
  _ocultaDesde = 0;
  ruta();
  if (typeof _ord !== 'undefined' && _ord && $('#modalOrden')) cargarCadena(true);
  if (typeof _ch !== 'undefined' && _ch && $('#modalChart')) cargarChart(true);   // hoja del chart abierta: velas frescas
});

// Realtime: la campanada (senales), el estado y el pulso llegan al instante.
function suscribir() {
  if (canal) return;
  canal = sb.channel('mesa2')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'senales' }, ruta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticker_estado' }, ruta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_heartbeat' }, ruta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posiciones' }, ruta) // marks del worker
    .subscribe();
  // Señales quitadas en otro equipo (senales_ocultas, 0013) → redibujar. En su PROPIO
  // canal: Realtime da de alta todas las tablas de un canal en una sola transacción y,
  // si una no está en la publicación (0013 sin aplicar), no entra ninguna; la campanada
  // de senales no puede caerse por esto.
  sb.channel('mesa2-ocultas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'senales_ocultas' }, ruta)
    .subscribe();
}

// ---------- helpers de tiempo/estado ----------
function haceCuanto(iso) {
  if (!iso) return { txt: 'sin dato', min: Infinity };
  const min = (Date.now() - new Date(iso).getTime()) / 60000;
  if (min < 1) return { txt: 'hace segundos', min };
  if (min < 60) return { txt: `hace ${Math.round(min)} min`, min };
  const h = Math.floor(min / 60);
  return { txt: `hace ${h} h`, min };
}
function fechaNY() {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric',
    month: 'short', timeZone: 'America/New_York' }).format(new Date()).toUpperCase();
}
// Fecha YYYY-MM-DD en Nueva York de un instante (ISO) — o de ahora.
function ymdNY(iso) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iso ? new Date(iso) : new Date()); }
  catch (_) { return ''; }
}
const hoyNY = () => ymdNY();

async function estadoWorker() {
  const { data } = await sb.from('worker_heartbeat').select('*')
    .eq('componente', 'worker').maybeSingle();
  const el = $('#estadoWorker');
  if (!data) { el.className = 'badge b-caido'; el.innerHTML = dot('var(--rojo)') + 'sin latido'; return null; }
  const { min } = haceCuanto(data.latido_at);
  const ses = data.sesion;
  if (min > 5) { el.className = 'badge b-caido'; el.innerHTML = dot('var(--rojo)') + 'worker caído'; }
  else if (ses === 'regular' || ses === 'pre' || ses === 'post') {
    el.className = 'badge b-vivo'; el.innerHTML = dot('var(--verde)') + 'en vivo';
  } else { el.className = 'badge b-cerrado'; el.innerHTML = dot('var(--tx2)') + 'mercado cerrado'; }
  return data;
}
const dot = (c) => `<span class="dot" style="background:${c}"></span>`;

// ---------- navegación ----------
function dibujarNav() {
  $('#nav').innerHTML = TABS.map(t =>
    `<a href="#/${t.id}" data-tab="${t.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${
        t.icon.split('M').filter(Boolean).map(p => `<path d="M${p.trim()}"/>`).join('')
      }</svg><span>${t.lbl}</span></a>`).join('');
}

async function ruta() {
  if (!sesionActiva) return;
  const tab = (location.hash.replace('#/', '') || 'informe');
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('on', a.dataset.tab === tab));
  $('#fecha').textContent = fechaNY() + ' · NY';
  const hb = await estadoWorker();
  const titulos = { informe: 'El informe de la mañana', tickers: 'Tus tickers',
    copiloto: 'Copiloto', cuentas: 'Cuentas y diario', disciplina: 'Disciplina' };
  $('#titulo').textContent = titulos[tab] || 'Mesa de Mercado 2.0';
  if (tab === 'informe') return vistaInforme(hb);
  if (tab === 'tickers') return vistaTickers();
  if (tab === 'copiloto') return vistaCopiloto();
  if (tab === 'cuentas') return vistaCuentas();
  if (tab === 'disciplina') return vistaDisciplina();
  return vistaProx(tab);
}

// ---------- vistas ----------
async function vistaInforme(hb) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  // solo las de HOY (NY): un dato viejo jamás se presenta como fresco. UNA vez (el
  // builder de Supabase lanza la consulta en cada then): las quitadas van detrás, con sus ids.
  // Sin limit, como el Copiloto: con un tope las quitadas ocupaban cupo y el Informe
  // contradecía al Copiloto (el UNIQUE del worker deja pocas por día: ticker × estrategia)
  const senP = Promise.resolve(sb.from('senales').select('*').eq('fecha_ny', hoy).order('creado_at', { ascending: false }));
  const [estados, senales] = await Promise.all([
    sb.from('ticker_estado').select('*'),
    senP,
    cargarPlanUsuario(),
    cargarOcultas(senP),
  ]);
  const est = estados.data || [];
  const merc = est.find(e => e.symbol === 'MERCADO');
  const sen = senales.data || [];
  const plan = planActivo();
  let h = '';

  // resumen del worker
  const fr = hb ? haceCuanto(hb.latido_at) : { txt: 'sin dato' };
  h += `<div class="card"><div class="fila"><h3>Estado del sistema</h3>
    <span class="fresco">latido ${esc(fr.txt)}</span></div>
    <div class="mut">${hb ? `El analista está <b style="color:var(--tx)">${esc(hb.estado_proceso)}</b> · sesión <b style="color:var(--tx)">${esc(hb.sesion)}</b>. `
      : 'Sin latido del worker todavía. '}${
      merc && merc.payload && merc.payload.regla_1030 ? 'Antes de las 10:30 ET.' : ''}</div></div>`;

  // señales del día (la misma sección que el Copiloto: las quitadas no salen)
  h += seccionSenales('SEÑALES DE HOY (E5)', sen, _ocultas.ids, _ocultas.ver, (s) => `<div class="card">
      ${cabeceraSenal(s)}
      ${motivoSenal(s)}
      ${lineasGtcSenal(s.instruccion_gtc, plan)}
    </div>`);

  // tickers resumidos
  h += `<div class="sec">TUS TICKERS</div>`;
  h += TICKERS.map(t => tarjetaTicker(est.find(e => e.symbol === t), t, true)).join('') ||
    `<div class="card vacio">Aún no hay estado publicado.</div>`;
  $('#vista').innerHTML = h;
}

// chartHtml: chart inline del ticker (solo en la pestaña Tickers; en el Informe no va).
function tarjetaTicker(e, sym, compacto, chartHtml) {
  if (!e) return `<div class="card"><div class="fila"><h3>${esc(sym)}</h3>
    <span class="chip c-esp">SIN DATO</span></div>${chartHtml || ''}</div>`;
  const p = e.payload || {};
  const te = p.tendencias || {};
  const fr = haceCuanto(e.actualizado_at);
  const av = (p.avisos || []).slice(0, compacto ? 1 : 4);
  return `<div class="card">
    <div class="fila"><h3>${esc(sym)}</h3>
      <span class="fresco">${esc(fr.txt)}</span></div>
    <div class="tend" style="margin-top:6px">
      ${tg('15m', te.m15)} ${tg('hora', te.hora)} ${tg('día', te.dia)}
      ${volTxt(p.volatilidad)}</div>
    ${textoRangoTarjeta(p, sym)}
    ${chartHtml || ''}
    ${av.length ? `<div class="mut" style="margin-top:7px">${av.map(esc).join(' · ')}</div>` : ''}
  </div>`;
}
// Línea «Rango óptimo del día» de la tarjeta: manda el método de la academia, luego
// la tabla, luego el rango por delta (componerRango). Un rango con lo > hi (el
// worker lo calculó con cotizaciones fuera de sesión) se muestra como «—», nunca
// invertido (2026-09-14: TSLA salía «$108–$56» y NVDA «$7–$10»).
function textoRangoTarjeta(p, sym) {
  p = p || {};
  const r = componerRango(p.rango_vivo || null, p.rango_academia || null, RANGOS_TABLA[sym] || null);
  if (!r || r.lo == null || r.hi == null) return '';
  const lo = Number(r.lo), hi = Number(r.hi);
  const fuente = { academia: 'método academia', tabla: 'tabla academia', delta: 'por delta' }[r.fuente] || String(r.fuente || '');
  const d = r.delta || null;
  const extra = [];
  if (d && d.exp) extra.push('exp ' + esc(String(d.exp).slice(5)));
  if (d && d.spot != null) extra.push('spot $' + esc(d.spot));
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || lo > hi) {
    return `<div class="rango"><span>Rango óptimo del día</span><b class="mono">—</b>
      <span class="fresco">rango inválido (cotizaciones fuera de sesión)</span></div>`;
  }
  return `<div class="rango"><span>Rango óptimo del día</span>
    <b class="mono">$${esc(Math.round(lo))}–$${esc(Math.round(hi))}</b>
    <span class="fresco">${esc(fuente)}${extra.length ? ' · ' + extra.join(' · ') : ''}</span></div>`;
}
function volTxt(v) {
  if (!v) return '';
  const fase = typeof v === 'object' ? v.fase : v;
  if (!fase || fase === 'sin_datos') return '';
  const rumbo = typeof v === 'object' && v.rumbo && v.rumbo !== 'quieta' ? ' ' + v.rumbo : '';
  return `<span class="tg">vol <b>${esc(fase)}${esc(rumbo)}</b></span>`;
}
function tg(lbl, v) {
  const col = v === 'alcista' ? 'var(--verde)' : v === 'bajista' ? 'var(--rojo)' : 'var(--tx2)';
  return `<span class="tg">${lbl} <b style="color:${col}">${esc(v || '—')}</b></span>`;
}

// Pestaña Tickers: estado + velas (ticker_velas, con caché de 50 s) + targets
// personales (ticker_targets) en un solo Promise.all. ruta() vuelve a llamar
// cada 60 s y por cada evento Realtime: si el HTML no cambió, no se toca el DOM
// (el chart no parpadea) y las velas no se vuelven a pedir mientras la caché
// esté fresca.
let _vistaTickersHtml = '';
async function vistaTickers() {
  const { vista, tf } = chartPrefs();
  const [est, velas, targets] = await Promise.all([
    sb.from('ticker_estado').select('*'),
    cargarVelas(TICKERS, tf),
    cargarTargets(),
  ]);
  const estados = est.data || [];
  let h = chartSelectores(vista, tf);
  // Un payload raro de UN ticker no puede tumbar la pestaña entera: si el chart
  // de ese ticker lanza, esa tarjeta sale sin chart y las demás siguen.
  h += TICKERS.map(t => {
    let c = '';
    try { c = chartInline(t, velas[t] || null, vista, tf, targets[t] || null); }
    catch (_) { c = `<div class="chart"><div class="vacio">Chart no disponible (datos inválidos)</div></div>`; }
    return tarjetaTicker(estados.find(e => e.symbol === t), t, false, c);
  }).join('');
  if ((location.hash.replace('#/', '') || 'informe') !== 'tickers') return;   // cambió de pestaña mientras cargaba
  const v = $('#vista');
  if (h === _vistaTickersHtml && v.querySelector('#chartSel')) return;         // sin cambios: no redibujar
  _vistaTickersHtml = h;
  v.innerHTML = h;
}

// ---------- Charts: velas + Bollinger + H-lines (como las dos ventanas de TC2000 del curso) ----------
// Doctrina (Investep / Joel Sardiñas): dos ventanas — izquierda «Medias + H-lines»
// (SMA 20 amarilla fina, 40 roja fina, 100 verde gruesa, 200 morada más gruesa;
// H-lines: ATH/ATL en azul, techo y piso de HORA más próximos al precio en
// blanco, target de analistas de Finviz en rojo claro) y derecha «Bollinger»
// (20, 2σ, con punto medio). Líneas nativas en ambas: cierre de ayer (amarillo
// punteado) y apertura de hoy (punteado tenue). Temporalidades 15m / hora / día.
// Los datos los publica el worker en ticker_velas (contrato fijo, schema_version 1);
// aquí SOLO se dibuja. Sin crosshair ni zoom en v1.
const CHART_VISTA_K = 'mz_chart_vista', CHART_TF_K = 'mz_chart_tf';
const CHART_VISTAS = [['bb', 'Bollinger'], ['hl', 'Medias + H-lines']];
const CHART_TFS = [['m15', '15 min'], ['hora', 'Hora'], ['dia', 'Día']];
const CHART_CACHE_MS = 50000;                   // ruta() corre cada 60 s: una petición por minuto como mucho
const CHART_INDICES = ['SPY', 'QQQ', 'SPX'];     // índice/ETF: el target de analistas no aplica
const nombreTf = (tf) => (CHART_TFS.find(x => x[0] === tf) || CHART_TFS[0])[1];
const nombreVista = (v) => (CHART_VISTAS.find(x => x[0] === v) || CHART_VISTAS[0])[1];
const decDe = (sym) => (sym === 'SPX' ? 0 : 2);

function chartPrefs() {
  let vista = 'bb', tf = 'm15';
  try {
    const v = localStorage.getItem(CHART_VISTA_K), t = localStorage.getItem(CHART_TF_K);
    if (CHART_VISTAS.some(x => x[0] === v)) vista = v;
    if (CHART_TFS.some(x => x[0] === t)) tf = t;
  } catch (_) {}
  return { vista, tf };
}
function chartSelectores(vista, tf, id) {
  return `<div id="${id || 'chartSel'}"><div class="periodos">${CHART_VISTAS.map(([k, l]) =>
      `<button class="perbtn ${vista === k ? 'on' : ''}" onclick="MZ.chartVista('${k}')">${l}</button>`).join('')}</div>
    <div class="periodos">${CHART_TFS.map(([k, l]) =>
      `<button class="perbtn ${tf === k ? 'on' : ''}" onclick="MZ.chartTf('${k}')">${l}</button>`).join('')}</div></div>`;
}

// Respaldo si el payload no trae bb: Bollinger (SMA n ± k·σ) con desviación
// POBLACIONAL (pstdev), como el worker. Alineado 1:1 con los cierres; null
// donde aún no hay n datos.
function bollingerApp(cierres, n, k) {
  n = Number(n) || 20; k = k == null ? 2 : Number(k);
  const N = (cierres || []).length;
  const medio = new Array(N).fill(null), sup = medio.slice(), inf = medio.slice();
  for (let i = n - 1; i < N; i++) {
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += Number(cierres[j]);
    const ma = s / n;
    let q = 0; for (let j = i - n + 1; j <= i; j++) { const d = Number(cierres[j]) - ma; q += d * d; }
    const sd = Math.sqrt(q / n);
    medio[i] = ma; sup[i] = ma + k * sd; inf[i] = ma - k * sd;
  }
  return { n, k, desv: 'pstdev', medio, sup, inf };
}
// Respaldo si el payload no trae sma: media SIMPLE de n cierres, alineada 1:1.
function smaApp(cierres, n) {
  n = Number(n) || 20;
  const N = (cierres || []).length, out = new Array(N).fill(null);
  let s = 0;
  for (let i = 0; i < N; i++) {
    s += Number(cierres[i]);
    if (i >= n) s -= Number(cierres[i - n]);
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
// Nuevo máximo / nuevo mínimo de la doctrina: el techo de HORA más próximo POR
// ENCIMA del precio y el piso de HORA más próximo POR DEBAJO. Se recorren solos
// al romperse (el siguiente pasa a ser el próximo), no se acumulan.
function techoPisoProximos(nv, spot) {
  spot = Number(spot);
  if (!nv || !(spot > 0)) return { techo: null, piso: null };
  const lista = (a) => Array.isArray(a) ? a : [];
  const techo = lista(nv.techos_hora).filter(x => x && Number(x.p) > spot).sort((a, b) => Number(a.p) - Number(b.p))[0] || null;
  const piso = lista(nv.pisos_hora).filter(x => x && Number(x.p) < spot).sort((a, b) => Number(b.p) - Number(a.p))[0] || null;
  return { techo, piso };
}
// Hora de Nueva York de un epoch en SEGUNDOS: {ymd, hm, mod (minuto del día), dia («14 sept»)}.
// Una vela diaria trae t = medianoche NY → su fecha NY sale bien en verano e invierno.
function chartTiempo(t) {
  const M = chartTiempo._m || (chartTiempo._m = new Map());
  let r = M.get(t); if (r) return r;
  const F = chartTiempo._f || (chartTiempo._f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const D = chartTiempo._d || (chartTiempo._d = new Intl.DateTimeFormat('es', { timeZone: 'America/New_York', day: 'numeric', month: 'short' }));
  const d = new Date(Number(t) * 1000);
  const p = {}; F.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const h = Number(p.hour) % 24, mi = Number(p.minute);
  r = { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    mod: h * 60 + mi, dia: D.format(d).replace('.', '') };
  if (M.size > 5000) M.clear();
  M.set(t, r);
  return r;
}
const fmtVol = (v) => { v = Number(v); if (!Number.isFinite(v) || v <= 0) return '—'; return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v)); };

// chartSvg(pk, op): pk = payload de ticker_velas; op = { vista:'bb'|'hl', h, tf,
// targets:{target,target_alto,target_bajo,fecha}|null, dec, fondo }. Devuelve un
// <svg viewBox="0 0 400 H"> (string). Portado de drawCandles() de la mesa privada,
// adaptado a móvil y a variables CSS del tema (nada de colores fijos).
function chartSvg(pk, op) {
  op = Object.assign({ vista: 'bb', h: 200, tf: null, targets: null, dec: 2, fondo: 'var(--card)' }, op || {});
  const vacio = `<div class="vacio">Sin velas todavía para este marco (el worker las publica cada minuto en sesión)</div>`;
  if (!pk || !Array.isArray(pk.velas) || pk.velas.length < 2) return vacio;
  // Una fila mal formada rompería el mapeo Y la alineación con bb/sma: mejor
  // decirlo que dibujar algo falso (o lanzar dentro del redibujo de la vista).
  if (!pk.velas.every(v => Array.isArray(v) && v.length >= 5)) return vacio;
  const tf = op.tf || pk.tf || 'm15';
  const MAXV = { m15: 78, hora: 90, dia: 120 };          // 15m = 3 sesiones; se recorta por la derecha
  const TFMIN = { m15: 15, hora: 60, dia: 1440 };
  const tfMin = TFMIN[tf] || 15;
  const total = pk.velas.length, start = Math.max(0, total - (MAXV[tf] || 90));
  const aVela = (v) => ({ t: Number(v[0]), o: Number(v[1]), h: Number(v[2]), l: Number(v[3]), c: Number(v[4]), v: Number(v[5]) || 0 });
  const cerradas = pk.velas.slice(start).map(aVela).filter(c => Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  if (cerradas.length < 2) return vacio;
  const viva = (Array.isArray(pk.vela_viva) && pk.vela_viva.length >= 5) ? Object.assign(aVela(pk.vela_viva), { viva: true }) : null;
  const cs = (viva && Number.isFinite(viva.c)) ? cerradas.concat([viva]) : cerradas;
  const n = cs.length, nCerr = cerradas.length;
  const hl = op.vista === 'hl';
  const dec = Number.isFinite(Number(op.dec)) ? Number(op.dec) : 2;
  const fP = (v) => Number(v).toFixed(dec);
  const nv = pk.niveles || {};

  // series alineadas con las velas cerradas visibles (bb/sma vienen 1:1 con pk.velas)
  const cierresAll = pk.velas.map(v => Number(v[4]));
  const alin = (a) => (Array.isArray(a) && a.length === total) ? a.slice(start) : null;
  // solo se aceptan las bandas del worker si son las del curso (20, 2); cualquier
  // otra cosa se recalcula aquí en vez de pintarla sin decirlo.
  const bb20 = pk.bb && Number(pk.bb.n) === 20 && Number(pk.bb.k) === 2;
  const bbSrc = (bb20 && alin(pk.bb.medio) && alin(pk.bb.sup) && alin(pk.bb.inf)) ? pk.bb : bollingerApp(cierresAll, 20, 2);
  const bb = { medio: alin(bbSrc.medio), sup: alin(bbSrc.sup), inf: alin(bbSrc.inf) };
  const SMAS = [['20', 'var(--oro)', 1], ['40', 'var(--rojo)', 1], ['100', 'var(--verde)', 1.8], ['200', 'var(--morado)', 2.4]];
  const smaSrc = pk.sma || {};
  const smas = {};
  SMAS.forEach(([k]) => { smas[k] = alin(smaSrc[k]) || smaApp(cierresAll, Number(k)).slice(start); });

  // --- geometría -----------------------------------------------------------
  const W = 400, H = Math.max(120, Number(op.h) || 200);
  const pad = { l: 6, r: dec === 0 ? 40 : 48, t: 8, b: 18 };
  const yAxis = H - pad.b, iw = W - pad.l - pad.r, ih = yAxis - pad.t;
  const bw = iw / n;
  const X = (i) => pad.l + i * bw + bw / 2;
  const XL = (i) => pad.l + i * bw;
  const f1 = (x) => Number(x).toFixed(1);

  // --- niveles (H-lines): precios del subyacente --------------------------
  const niv = [];
  const add = (v, o) => { v = Number(v); if (Number.isFinite(v) && v > 0) niv.push(Object.assign({ v }, o)); };
  add(nv.cierre_ayer, { c: 'var(--oro)', lb: 'cierre ayer', dash: '4 3', op: .85, w: 1, k: 'cierre_ayer' });
  add(nv.apertura_hoy, { c: 'var(--tx3)', lb: 'apertura', dash: '2 3', op: .7, w: 1, k: 'apertura_hoy' });
  if (hl) {
    const dias = nv.ath_dias != null ? `${Math.round(Number(nv.ath_dias))} d` : 'del periodo';   // jamás «hist»: no es el all-time del curso
    add(nv.ath, { c: 'var(--azul)', lb: `máx ${dias}`, op: .9, w: 1.2, k: 'ath' });
    add(nv.atl, { c: 'var(--azul)', lb: `mín ${dias}`, op: .9, w: 1.2, k: 'atl' });
    const spotRef = nv.spot != null ? nv.spot : cs[n - 1].c;
    const { techo, piso } = techoPisoProximos(nv, spotRef);
    if (techo) add(techo.p, { c: 'var(--tx)', lb: 'techo', op: .9, w: 1.2, k: 'techo' });
    if (piso) add(piso.p, { c: 'var(--tx)', lb: 'piso', op: .9, w: 1.2, k: 'piso' });
    const tg = op.targets || null;
    if (tg && tg.target != null) {
      add(tg.target, { c: 'var(--rojo)', lb: `target $${fP(tg.target)}`, dash: '6 3', op: .85, w: 1.4, k: 'target' });
      add(tg.target_alto, { c: 'var(--rojo)', lb: '', dash: '2 3', op: .45, w: .7, k: 'target_alto' });
      add(tg.target_bajo, { c: 'var(--rojo)', lb: '', dash: '2 3', op: .45, w: .7, k: 'target_bajo' });
    }
  }

  // --- escala vertical -----------------------------------------------------
  let lo = Infinity, hi = -Infinity;
  cs.forEach(c => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  // ambas bandas o ninguna: Number(null) es 0 y un solo hueco en inf hundía el eje a 0
  if (!hl) for (let i = 0; i < nCerr; i++) { if (bb.sup[i] != null && bb.inf[i] != null) { hi = Math.max(hi, Number(bb.sup[i])); lo = Math.min(lo, Number(bb.inf[i])); } }
  const span0 = (hi - lo) || (hi * 0.01) || 1;
  // un nivel lejano aplastaría las velas a una franja: solo entra lo que está cerca (±35 %)
  const cerca = (v) => v > lo - span0 * 0.35 && v < hi + span0 * 0.35;
  if (hl) SMAS.forEach(([k]) => smas[k].forEach(v => { if (v != null && cerca(Number(v))) { lo = Math.min(lo, Number(v)); hi = Math.max(hi, Number(v)); } }));
  niv.forEach(o => { if (cerca(o.v)) { lo = Math.min(lo, o.v); hi = Math.max(hi, o.v); } });
  const m = ((hi - lo) * 0.06) || (hi * 0.002) || 0.25; lo -= m; hi += m;
  const Y = (v) => pad.t + ih - (v - lo) / (hi - lo) * ih;
  const cp = 'cp-' + String(pk.ticker || 'x').replace(/[^A-Za-z0-9]/g, '') + '-' + tf + '-' + (hl ? 'hl' : 'bb') + '-' + H;

  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc((pk.ticker || '') + ' ' + nombreTf(tf) + ' ' + (hl ? 'medias y H-lines' : 'Bollinger'))}" style="display:block;font-family:var(--mono);font-size:9px">`;
  out += `<defs><clipPath id="${cp}"><rect x="${pad.l}" y="${pad.t}" width="${f1(iw)}" height="${f1(ih)}"/></clipPath></defs>`;

  // 1) rejilla horizontal + eje de precios en múltiplos redondos --------------
  const PXSTEP = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const nT = Math.max(3, Math.min(7, Math.floor(ih / 36)));
  const pstep = PXSTEP.find(x => (hi - lo) / x <= nT) || 1000;
  for (let v = Math.ceil(lo / pstep) * pstep; v <= hi; v += pstep) {
    const y = Y(v); if (y < pad.t || y > yAxis) continue;
    out += `<line x1="${pad.l}" y1="${f1(y)}" x2="${f1(W - pad.r)}" y2="${f1(y)}" stroke="var(--line)" stroke-width="1"/>`;
    out += `<text class="ejey" x="${f1(W - pad.r + 4)}" y="${f1(y + 3)}" fill="var(--tx3)">${esc(fP(v))}</text>`;
  }
  out += `<line x1="${pad.l}" y1="${f1(yAxis + .5)}" x2="${f1(W - pad.r)}" y2="${f1(yAxis + .5)}" stroke="var(--line)" stroke-width="1"/>`;

  // 2) eje de tiempo en hora NY: ranuras de reloj (15m/hora) o fechas (día) ---
  const tt = cs.map(c => chartTiempo(c.t));
  const etiqueta = (x, txt, fuerte) =>
    `<text class="ejex" x="${f1(x)}" y="${f1(H - 5)}" text-anchor="middle" fill="${fuerte ? 'var(--tx2)' : 'var(--tx3)'}"${fuerte ? ' font-weight="700"' : ''}>${esc(txt)}</text>`;
  const separador = (i) => `<line x1="${f1(XL(i))}" y1="${pad.t}" x2="${f1(XL(i))}" y2="${f1(yAxis)}" stroke="var(--tx3)" stroke-width="1" opacity=".45"/>`;
  let ultX = -Infinity;
  const cabe = (x) => x > pad.l + 14 && x < W - pad.r - 14 && x - ultX >= 40;
  if (tf === 'dia') {
    const paso = Math.max(1, Math.ceil(50 / bw));
    cs.forEach((c, i) => {
      const mesNuevo = i > 0 && tt[i].ymd.slice(0, 7) !== tt[i - 1].ymd.slice(0, 7);
      if (mesNuevo) out += separador(i);
      if (((n - 1 - i) % paso === 0 || mesNuevo) && cabe(X(i))) { out += etiqueta(X(i), tt[i].dia, mesNuevo); ultX = X(i); }
    });
  } else {
    const PASOS = [15, 30, 60, 120, 240];
    const paso = PASOS.find(x => x >= tfMin && (x / tfMin) * bw >= 44) || 240;
    let prevSlot = null, prevYmd = null;
    cs.forEach((c, i) => {
      const e = tt[i], slot = e.ymd + '#' + Math.floor(e.mod / paso);
      const diaNuevo = prevYmd !== null && e.ymd !== prevYmd;
      if (diaNuevo) out += separador(i);
      if ((i === 0 || slot !== prevSlot || diaNuevo) && cabe(X(i))) { out += etiqueta(X(i), diaNuevo || i === 0 ? e.dia : e.hm, diaNuevo || i === 0); ultX = X(i); }
      prevSlot = slot; prevYmd = e.ymd;
    });
  }

  out += `<g clip-path="url(#${cp})">`;
  // 3) Bollinger (ventana derecha): banda + sup/inf punteadas + punto medio ----
  if (!hl) {
    const idx = []; for (let i = 0; i < nCerr; i++) if (bb.sup[i] != null && bb.inf[i] != null) idx.push(i);
    if (idx.length >= 2) {
      const sup = idx.map(i => `${f1(X(i))},${f1(Y(Number(bb.sup[i])))}`);
      const inf = idx.map(i => `${f1(X(i))},${f1(Y(Number(bb.inf[i])))}`).reverse();
      out += `<polygon data-bb="banda" points="${sup.concat(inf).join(' ')}" fill="var(--azul)" fill-opacity=".08" stroke="none"/>`;
      const linea = (k, dash) => `<polyline data-bb="${k}" points="${idx.map(i => `${f1(X(i))},${f1(Y(Number(bb[k][i])))}`).join(' ')}" fill="none" stroke="var(--azul)" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity=".85"/>`;
      out += linea('sup', '3 3') + linea('inf', '3 3') + linea('medio', '');
    }
  }
  // 4) medias simples (ventana izquierda) -----------------------------------
  if (hl) {
    SMAS.forEach(([k, col, w]) => {
      const pts = []; for (let i = 0; i < nCerr; i++) if (smas[k][i] != null) pts.push(`${f1(X(i))},${f1(Y(Number(smas[k][i])))}`);
      if (pts.length >= 2) out += `<polyline data-sma="${k}" points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" opacity=".9"/>`;
    });
  }
  // 5) velas: verde/roja por apertura-cierre, rellenas, mecha del color de la vela;
  //    la vela viva punteada y translúcida ----------------------------------
  const body = Math.max(1.2, bw * 0.66);
  cs.forEach((c, i) => {
    const up = c.c >= c.o, col = up ? 'var(--verde)' : 'var(--rojo)';
    const x = X(i), yo = Y(c.o), yc = Y(c.c), yh = Y(c.h), yl = Y(c.l);
    const top = Math.min(yo, yc), hgt = Math.max(1, Math.abs(yc - yo));
    if (bw >= 2) out += `<line x1="${f1(x)}" y1="${f1(yh)}" x2="${f1(x)}" y2="${f1(yl)}" stroke="${col}" stroke-width="${bw >= 12 ? 1.4 : 1}" opacity="${c.viva ? .55 : .9}"/>`;
    out += `<rect class="vela${c.viva ? ' viva' : ''}" x="${f1(x - body / 2)}" y="${f1(top)}" width="${f1(body)}" height="${f1(hgt)}" fill="${col}"`
      + (c.viva ? ` fill-opacity=".45" stroke="${col}" stroke-width="1" stroke-dasharray="2 2"` : '') + `/>`;
  });
  out += `</g>`;

  // 6) líneas de nivel con etiqueta con halo (nunca fuera de la escala) -------
  let ultY = -Infinity;
  niv.slice().sort((a, b) => a.v - b.v).forEach(o => {
    if (o.v < lo || o.v > hi) return;
    const y = Y(o.v);
    out += `<line data-nivel="${o.k}" x1="${pad.l}" y1="${f1(y)}" x2="${f1(W - pad.r)}" y2="${f1(y)}" stroke="${o.c}" stroke-width="${o.w}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''} opacity="${o.op}"/>`;
    if (!o.lb || Math.abs(y - ultY) < 9) return;            // línea sí, texto no: solapado parece un fallo
    ultY = y;
    // etiqueta a la IZQUIERDA: la derecha es del eje de precios y de la cajita
    // del spot, y ahí se pisaban «apertura», «cierre ayer» y el precio actual.
    out += `<text x="${f1(pad.l + 3)}" y="${f1(y - 3)}" text-anchor="start" fill="${o.c}" font-weight="700" stroke="${op.fondo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(o.lb)}</text>`;
  });

  // 7) precio actual (spot del worker; si no, cierre de la última vela) --------
  const px = Number(nv.spot != null ? nv.spot : cs[n - 1].c);
  if (px > lo && px < hi) {
    const u = cs[n - 1], colp = u.c >= u.o ? 'var(--verde)' : 'var(--rojo)';
    const yp = Y(px), x0 = W - pad.r + 1, w = pad.r - 2, hh = 14;
    out += `<line x1="${pad.l}" y1="${f1(yp)}" x2="${f1(W - pad.r)}" y2="${f1(yp)}" stroke="${colp}" stroke-width="1" stroke-dasharray="2 4" opacity=".4"/>`;
    out += `<path data-spot="1" d="M${x0} ${f1(yp)} l4 -${hh / 2} h${w - 7} a2.5 2.5 0 0 1 2.5 2.5 v${hh - 5} a2.5 2.5 0 0 1 -2.5 2.5 h-${w - 7} Z" fill="${colp}"/>`;
    out += `<text x="${f1(x0 + 6)}" y="${f1(yp + 3.2)}" fill="var(--bg)" font-weight="700">${esc(fP(px))}</text>`;
  }
  out += `</svg>`;
  return out;
}

// Antigüedad honesta de la última vela: «última vela hace 3 min · en curso». Con
// mercado cerrado no puede parecer en vivo (la vela viva solo cuenta si el
// worker la publicó hace ≤ 10 min).
function chartFrescoTxt(fila, tf) {
  const pk = fila && fila.payload;
  if (!pk || !Array.isArray(pk.velas) || !pk.velas.length) return 'sin velas';
  const u = pk.velas[pk.velas.length - 1];
  const dur = { m15: 900, hora: 3600, dia: 16 * 3600 }[tf] || 900;   // día: cierre 16:00 NY
  let s = 'última vela ' + haceCuanto((Number(u[0]) + dur) * 1000).txt;
  if (Array.isArray(pk.vela_viva) && pk.vela_viva.length >= 5) {
    const pub = haceCuanto(fila.actualizado_at);
    s += pub.min <= 10 ? ' · en curso' : ' · sin cerrar (publicada ' + pub.txt + ')';
  }
  return s;
}
function chartInline(sym, fila, vista, tf, tg) {
  const pk = fila && fila.payload;
  const svg = chartSvg(pk, { vista, tf, h: 200, targets: tg, dec: decDe(sym), fondo: 'var(--bg2)' });
  return `<div class="chart" role="button" onclick="MZ.chartAbrir('${esc(sym)}')">
    <div class="fila"><span class="fresco">${esc(nombreTf(tf))} · ${esc(nombreVista(vista))}</span>
      <span class="fresco">${esc(chartFrescoTxt(fila, tf))}</span></div>${svg}</div>`;
}

// ---- datos: velas (caché por symbol|tf, 50 s) y targets personales ----
const _velas = new Map();          // 'SYM|tf' → { fila, ts }
const _velasVuelo = new Map();     // peticiones en vuelo (ruta() puede disparar varias seguidas)
async function cargarVelas(syms, tf, forzar) {
  const ahora = Date.now();
  const faltan = (syms || []).filter(s => { const c = _velas.get(s + '|' + tf); return forzar || !c || ahora - c.ts > CHART_CACHE_MS; });
  if (faltan.length) {
    const clave = tf + '|' + faltan.join(',');
    let p = _velasVuelo.get(clave);
    if (!p) {
      p = (async () => {
        const { data, error } = await sb.from('ticker_velas').select('symbol,tf,payload,actualizado_at').in('symbol', faltan).eq('tf', tf);
        if (error) return;                                   // se conserva lo cacheado y se reintenta en la próxima vuelta
        faltan.forEach(s => _velas.set(s + '|' + tf, { fila: (data || []).find(r => r.symbol === s) || null, ts: Date.now() }));
      })();
      _velasVuelo.set(clave, p);
      p.finally(() => _velasVuelo.delete(clave)).catch(() => {});   // la promesa de finally también rechaza
    }
    try { await p; } catch (_) {}
  }
  const out = {};
  (syms || []).forEach(s => { const c = _velas.get(s + '|' + tf); out[s] = c ? c.fila : null; });
  return out;
}
const _targets = { ts: 0, por: {} };
async function cargarTargets(forzar) {
  if (!forzar && Date.now() - _targets.ts < CHART_CACHE_MS) return _targets.por;
  const { data, error } = await sb.from('ticker_targets').select('*');
  if (error) return _targets.por;
  const por = {}; (data || []).forEach(r => { por[r.symbol] = r; });
  _targets.por = por; _targets.ts = Date.now();
  return por;
}

// ---- lectura y lista de H-lines (hoja modal) ----
function lecturaChart(pk, tf, dec) {
  if (!pk || !Array.isArray(pk.velas) || !pk.velas.length) return '';
  const viva = (Array.isArray(pk.vela_viva) && pk.vela_viva.length >= 5) ? pk.vela_viva : null;
  const u = viva || pk.velas[pk.velas.length - 1];
  const f = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(dec);
  const tt = chartTiempo(u[0]);
  const cuando = tf === 'dia' ? tt.dia : `${tt.hm} · ${tt.dia}`;
  const ult = (a) => { if (!Array.isArray(a)) return null; for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
  const c = (et, val) => `<div><span>${et}</span><b class="mono">${esc(val)}</b></div>`;
  const bb = pk.bb || {}, sma = pk.sma || {};
  // Las bandas y las medias son de la última vela CERRADA, aunque arriba se
  // muestre la vela en curso: decirlo evita leer como vivo un dato que no lo es.
  const medias = ['20', '40', '100', '200'].map(k => ({ k, v: ult(sma[k]) })).filter(x => x.v != null);
  const faltan = 4 - medias.length;
  return `<div class="hist">${c(viva ? 'vela en curso' : 'última vela', cuando)}${c('apertura', f(u[1]))}${c('cierre', f(u[4]))}</div>
    <div class="hist">${c('máximo', f(u[2]))}${c('mínimo', f(u[3]))}${c('volumen', fmtVol(u[5]))}</div>
    <div class="mut" style="font-size:11px;margin-top:6px">Bollinger y medias · última vela cerrada</div>
    <div class="hist">${c('BB superior', f(ult(bb.sup)))}${c('BB medio', f(ult(bb.medio)))}${c('BB inferior', f(ult(bb.inf)))}</div>
    ${medias.length ? `<div class="hist" style="grid-template-columns:repeat(${medias.length},1fr)">${medias.map(x => c('SMA ' + x.k, f(x.v))).join('')}</div>` : ''}
    ${faltan ? `<div class="mut" style="font-size:11px">en este marco no hay historia para ${faltan === 1 ? 'una media' : faltan + ' medias'} (el curso decide las medias en hora y día)</div>` : ''}`;
}
function hlinesLista(pk, tg, dec) {
  const nv = (pk && pk.niveles) || {};
  const f = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(dec);
  const fecha = (ymd) => (ymd && /^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) ? fmtFechaNY(String(ymd) + 'T12:00:00Z') : '';
  const it = (col, txt, sub) => `<div class="hl"><span><i style="color:${col}"></i>${txt}</span><span class="fresco">${sub || ''}</span></div>`;
  const { techo, piso } = techoPisoProximos(nv, nv.spot);
  let h = '';
  if (tg && tg.target != null) {
    const ab = (tg.target_bajo != null || tg.target_alto != null) ? ` · ${f(tg.target_bajo)}–${f(tg.target_alto)}` : '';
    h += it('var(--rojo)', `target $${esc(f(tg.target))}`, esc((tg.fuente || 'finviz') + (tg.fecha ? ' · ' + fecha(tg.fecha) : '') + ab));
  }
  // El curso marca POCAS líneas y las recorre al romperse («el gráfico no puede
  // parecer un plato de espagueti»): arriba solo el techo y el piso próximos; el
  // resto de swings queda en un desplegable.
  const sub = (x) => `${esc(x.respetos != null ? x.respetos : '?')} respetos · edad ${esc(x.edad != null ? x.edad : '?')} velas`;
  if (techo) h += it('var(--tx)', `techo hora $${esc(f(techo.p))} <b style="color:var(--oro)">· próximo</b>`, sub(techo));
  if (piso) h += it('var(--tx)', `piso hora $${esc(f(piso.p))} <b style="color:var(--oro)">· próximo</b>`, sub(piso));
  const otros = []
    .concat((Array.isArray(nv.techos_hora) ? nv.techos_hora : []).filter(x => !techo || Number(x.p) !== Number(techo.p)).map(x => ['techo', x]))
    .concat((Array.isArray(nv.pisos_hora) ? nv.pisos_hora : []).filter(x => !piso || Number(x.p) !== Number(piso.p)).map(x => ['piso', x]))
    .sort((a, b) => Number(b[1].p) - Number(a[1].p));
  if (otros.length) h += `<details style="margin-top:2px"><summary class="mut" style="font-size:12px;cursor:pointer">ver los demás swings de hora (${otros.length})</summary>`
    + otros.map(([q, x]) => it('var(--tx2)', `${q} hora $${esc(f(x.p))}`, sub(x))).join('') + '</details>';
  const dias = nv.ath_dias != null ? `${Math.round(Number(nv.ath_dias))} d` : 'del periodo';   // jamás «hist»: no es el all-time del curso
  if (nv.ath != null) h += it('var(--azul)', `máx ${esc(dias)} $${esc(f(nv.ath))}`, esc(fecha(nv.ath_fecha)));
  if (nv.atl != null) h += it('var(--azul)', `mín ${esc(dias)} $${esc(f(nv.atl))}`, esc(fecha(nv.atl_fecha)));
  const td = (nv.techos_dia || []).map(x => '$' + f(x.p)).join(' · '), pd = (nv.pisos_dia || []).map(x => '$' + f(x.p)).join(' · ');
  // los swings de DÍA no son H-lines en el curso (las edge lines se marcan en hora)
  if (td) h += it('var(--tx2)', 'referencias de día (no son H-lines)', esc(td));
  if (pd) h += it('var(--tx2)', 'referencias de día (no son H-lines)', esc(pd));
  if (nv.cierre_ayer != null) h += it('var(--oro)', `cierre de ayer $${esc(f(nv.cierre_ayer))}`, (nv.max_ayer != null || nv.min_ayer != null) ? `ayer ${esc(f(nv.min_ayer))}–${esc(f(nv.max_ayer))}` : '');
  if (nv.apertura_hoy != null) h += it('var(--tx3)', `apertura de hoy $${esc(f(nv.apertura_hoy))}`, '');
  const s = nv.salto;
  if (s && s.desde != null && s.hasta != null) h += it('var(--oro)', `salto ${esc(s.lado || '')} $${esc(f(s.desde))} → $${esc(f(s.hasta))}`,
    `${esc(Number(s.gap_pct) > 0 ? '+' : '')}${esc(s.gap_pct != null ? Number(s.gap_pct).toFixed(1) : '?')}% · hace ${esc(s.hace_velas != null ? s.hace_velas : '?')} velas`);
  return h || `<div class="mut">Sin niveles publicados todavía.</div>`;
}

// ---- hoja modal del chart (grande, con lectura, H-lines y editor de target) ----
let _ch = null;    // { sym, gen, timer }
function abrirChart(sym) {
  if (!TICKERS.includes(sym)) return;
  cerrarChart();
  const { vista, tf } = chartPrefs();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalChart';
  const tg = _targets.por[sym] || null;
  const indice = CHART_INDICES.includes(sym);
  m.innerHTML = `<div class="hoja">
    <div class="fila"><h3 style="margin:0">${esc(sym)}</h3><span class="fresco" id="chFresco">cargando…</span></div>
    <div id="chSel">${chartSelectores(vista, tf, 'chartSelHoja')}</div>
    <div class="chart" id="chSvg" style="cursor:default"></div>
    <div id="chLectura"></div>
    <div class="sec" style="margin-top:12px">H-LINES</div>
    <div id="chHlines"></div>
    <div class="sec" style="margin-top:12px">TARGET PRICE · ANALISTAS</div>
    ${indice ? `<div class="mut">índice/ETF: el target de analistas no aplica.</div>`
      : `<div class="mut">Consenso de analistas de Finviz; se anota a mano cada lunes (no hay fuente automática). No es el +${planActivo().gtcPct} % de la prima: ese va en la orden GTC.</div>
      <div class="dos">
        <div><label>Target</label><input id="tgT" type="number" inputmode="decimal" step="0.01" placeholder="ej. 260" value="${tg && tg.target != null ? esc(tg.target) : ''}"></div>
        <div><label>Fecha</label><input id="tgF" type="date" value="${esc(tg && tg.fecha ? tg.fecha : hoyNY())}"></div></div>
      <div class="dos">
        <div><label>Alto</label><input id="tgA" type="number" inputmode="decimal" step="0.01" value="${tg && tg.target_alto != null ? esc(tg.target_alto) : ''}"></div>
        <div><label>Bajo</label><input id="tgB" type="number" inputmode="decimal" step="0.01" value="${tg && tg.target_bajo != null ? esc(tg.target_bajo) : ''}"></div></div>
      <label>Fuente</label><input id="tgS" value="${esc(tg && tg.fuente ? tg.fuente : 'finviz')}">
      <div class="err" id="tgErr"></div>`}
    <div class="dos" style="margin-top:8px">
      <button class="btnsec" onclick="MZ.chartCerrar()">Cerrar</button>
      ${indice ? '' : `<button class="pri" onclick="MZ.chartGuardarTarget()">Guardar</button>`}</div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m) cerrarChart(); });
  _ch = { sym, gen: 0, timer: null };
  _ch.timer = setInterval(() => {
    if (!_ch || !$('#modalChart') || document.visibilityState === 'hidden') return;
    cargarChart(true);
  }, 60000);
  cargarChart(false);
}
function cerrarChart() {
  if (_ch && _ch.timer) clearInterval(_ch.timer);
  _ch = null;
  const m = $('#modalChart'); if (m) m.remove();
}
async function cargarChart(forzar) {
  if (!_ch) return;
  const o = _ch, gen = ++o.gen, { tf } = chartPrefs();
  const [velas, targets] = await Promise.all([cargarVelas([o.sym], tf, forzar), cargarTargets(forzar)]);
  if (_ch !== o || o.gen !== gen || !$('#modalChart')) return;
  pintarChart(velas[o.sym] || null, targets[o.sym] || null);
}
function pintarChart(fila, tg) {
  if (!_ch || !$('#modalChart')) return;
  const { vista, tf } = chartPrefs();
  if (fila === undefined) { const c = _velas.get(_ch.sym + '|' + tf); fila = c ? c.fila : null; tg = _targets.por[_ch.sym] || null; }
  const pk = fila && fila.payload, dec = decDe(_ch.sym);
  $('#chSel').innerHTML = chartSelectores(vista, tf, 'chartSelHoja');
  $('#chFresco').textContent = chartFrescoTxt(fila, tf);
  $('#chSvg').innerHTML = chartSvg(pk, { vista, tf, h: 300, targets: tg, dec, fondo: 'var(--bg2)' });
  $('#chLectura').innerHTML = lecturaChart(pk, tf, dec);
  $('#chHlines').innerHTML = hlinesLista(pk, tg, dec);
  // el editor de target se rellena también si los targets llegaron DESPUÉS de
  // abrir la hoja (sin pisar lo que se esté escribiendo)
  [['tgT', tg && tg.target], ['tgA', tg && tg.target_alto], ['tgB', tg && tg.target_bajo],
   ['tgF', tg && tg.fecha], ['tgS', tg && tg.fuente]].forEach(([id, v]) => {
    const el = $('#' + id);
    if (el && document.activeElement !== el && v != null) el.value = v;
  });
}
// El botón tiene que responder AL TOQUE, no cuando conteste la red: se repintan
// los selectores antes de pedir datos (en el iPhone con datos móviles, esperar a
// Supabase se lee como un toque perdido y se vuelve a tocar).
function pintarSelectores() {
  const { vista, tf } = chartPrefs();
  ['chartSel', 'chartSelHoja'].forEach(id => {
    const el = $('#' + id); if (el) el.outerHTML = chartSelectores(vista, tf, id);
  });
}
function chartVista(v) {
  if (!CHART_VISTAS.some(x => x[0] === v)) return;
  try { localStorage.setItem(CHART_VISTA_K, v); } catch (_) {}
  pintarSelectores();
  _vistaTickersHtml = '';
  if (_ch && $('#modalChart')) pintarChart();
  if ((location.hash.replace('#/', '') || '') === 'tickers') vistaTickers();
}
function chartTf(tf) {
  if (!CHART_TFS.some(x => x[0] === tf)) return;
  try { localStorage.setItem(CHART_TF_K, tf); } catch (_) {}
  pintarSelectores();
  _vistaTickersHtml = '';
  if (_ch && $('#modalChart')) cargarChart(false);
  if ((location.hash.replace('#/', '') || '') === 'tickers') vistaTickers();
}
// Target de analistas (Finviz), PERSONAL: upsert en ticker_targets con user_id =
// sesionActiva.user.id (muralla RLS user_id = auth.uid()).
async function guardarTarget() {
  if (!_ch || !$('#modalChart')) return;
  const sym = _ch.sym, err = $('#tgErr'); if (!err) return;
  const g = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
  const num = (s) => (s === '' ? null : Number(s.replace(',', '.')));
  const target = num(g('tgT')), alto = num(g('tgA')), bajo = num(g('tgB'));
  if (target == null) { err.textContent = 'Pon al menos el target (consenso de Finviz).'; return; }
  for (const v of [target, alto, bajo]) if (v != null && !(v > 0)) { err.textContent = 'Los precios deben ser números mayores que 0.'; return; }
  if (alto != null && bajo != null && alto < bajo) { err.textContent = 'El alto no puede ser menor que el bajo.'; return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { err.textContent = 'Sin sesión. Sal y vuelve a entrar.'; return; }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(g('tgF')) ? g('tgF') : hoyNY();
  const fila = { user_id: uid, symbol: sym, target, target_alto: alto, target_bajo: bajo,
    fuente: g('tgS') || 'finviz', fecha, actualizado_at: new Date().toISOString() };
  err.textContent = 'Guardando…';
  const { error } = await sb.from('ticker_targets').upsert(fila, { onConflict: 'user_id,symbol' });
  if (error) { err.textContent = 'No se guardó: ' + error.message; return; }
  err.textContent = '';
  _targets.por[sym] = fila; _targets.ts = Date.now();
  _vistaTickersHtml = '';
  toast(`Target ${sym} $${target}${alto != null || bajo != null ? ` (${bajo != null ? bajo : '—'}–${alto != null ? alto : '—'})` : ''} guardado`);
  pintarChart();
}

// ---------- Copiloto ----------
const PLAN_PCT = 35;      // doctrina (literal) = Plan 35%; el plan PERSONAL vive en plan_usuario (PLANES)
const OPS_SEMANA = 3;     // 3 ops/semana
// Heredado (una prueba lo extrae con regex): los flujos nuevos usan gtcLimite(fill, pct).
const gtcDe = (fill) => Math.round((fill * (1 + PLAN_PCT / 100) + 0.02) * 100) / 100;

// ---- PLANES de trading (contrato del Plan 10%, 2026-09-14) ----
// PERSONAL (muralla): el plan elegido vive en plan_usuario (RLS solo dueño), jamás
// en config_kv, senales, ticker_estado ni ticker_velas. Las señales siguen diciendo
// el 35% doctrinal (SPEC C2); la app añade una línea con el plan propio.
// El plan de cada operación se CONGELA en la orden (preview._mz.plan_pct/stop_pct) y
// en la posición (plan_pct/stop_pct): cambiar de plan no toca posiciones abiertas.
//   PLAN_35 (doctrina de Joel, el comportamiento de siempre): GTC +35%, sin corte,
//     3 operaciones por semana, máximo 10% de la cuenta, espera a las 10:30 ET.
//   PLAN_10 (diapositivas del curso): GTC +10%, corte -20% (aviso + salida de un
//     toque, nunca stop automático), 1 operación al día, 30-50% de la cuenta del
//     bróker (aviso solo por encima del 50%), presupuesto 35% (lo eligió Andrés;
//     admite hasta 100 y por encima del 50% solo avisa),
//     movimiento identificado entre 9:30 y 9:45 ET, una compañía al día elegida
//     entre los 4 tickers, vencimiento de hoy pasadas las 10:30 → la siguiente
//     fecha, sin refuerzo.
const PLANES = {
  PLAN_35: { id: 'PLAN_35', nombre: 'Plan 35%', gtcPct: 35, stopPct: null, opsMax: 3, periodo: 'semana',
    tamanoMinPct: null, tamanoMaxPct: 10, presupDefPct: 35, presupMaxPct: 100, ventana: 'no_antes_1030', ventanaMin: null,
    companiaDia: false, avisoExpHoy: false, refuerzo: true },
  PLAN_10: { id: 'PLAN_10', nombre: 'Plan 10%', gtcPct: 10, stopPct: 20, opsMax: 1, periodo: 'dia',
    tamanoMinPct: 30, tamanoMaxPct: 50, presupDefPct: 35, presupMaxPct: 100, ventana: 'apertura_15', ventanaMin: [570, 585],
    companiaDia: true, avisoExpHoy: true, refuerzo: false },
};
// Límite GTC exacto al centavo, igual que la columna generada posiciones.gtc_limite
// (round(prima_fill × (1 + plan_pct/100) + 0.02, 2), half-up de numeric): aritmética
// ENTERA para no heredar el error de coma flotante (3.30 al 35% = 4.48, no 4.47).
function gtcLimite(fill, pct) {
  const f = Number(fill);
  if (!(f > 0)) return null;
  const p = (pct != null && Number.isFinite(Number(pct)) && Number(pct) > 0) ? Number(pct) : 35;
  const F = Math.round(f * 10000), P = Math.round(p * 100);          // diezmilésimas de $ · centésimas de %
  const T = F * (10000 + P) + 2000000;                                   // unidades de 1e-8 $ (+ $0.02)
  return Math.floor((T + 500000) / 1000000) / 100;
}
// Precio de corte: round(prima_fill × (1 - stop_pct/100), 4). null sin corte.
function corteDe(fill, stopPct) {
  const f = Number(fill), s = Number(stopPct);
  if (!(f > 0) || stopPct == null || !(s > 0 && s < 100)) return null;
  const F = Math.round(f * 10000), S = Math.round(s * 100);
  return Math.floor((F * (10000 - S) + 5000) / 10000) / 10000;
}
// Plan congelado en la orden al previsualizar (preview._mz): sin anotación = Plan 35.
function planCongelado(mz) {
  mz = mz || {};
  const pp = Number(mz.plan_pct), sp = Number(mz.stop_pct);
  return { plan_pct: (mz.plan_pct != null && pp > 0) ? pp : 35, stop_pct: (mz.stop_pct != null && sp > 0 && sp < 100) ? sp : null };
}
// Plan de una operación a partir de su plan_pct; sin él (o desconocido), el de por defecto.
function planDePct(pct, porDefecto) {
  const n = Number(pct);
  if (pct != null && n > 0) { const p = Object.values(PLANES).find(x => x.gtcPct === n); if (p) return p; }
  return porDefecto || PLANES.PLAN_35;
}
// Límite GTC de una posición: el de la base (C25) y, si falta, el de SU plan congelado.
function gtcDePosicion(p) {
  const g = Number(p && p.gtc_limite);
  if (g > 0) return Math.round(g * 100) / 100;
  return gtcLimite(p && p.prima_fill, (p && Number(p.plan_pct) > 0) ? Number(p.plan_pct) : 35);
}
// Compañía del día (Plan 10%): symbol_foco solo vale si foco_fecha es HOY (NY).
function focoDeHoy(fila, hoy) {
  if (!fila || !fila.symbol_foco || !fila.foco_fecha || !hoy) return null;
  return String(fila.foco_fecha).slice(0, 10) === String(hoy) ? String(fila.symbol_foco).toUpperCase() : null;
}
// ¿Fuera de la ventana del plan (minutos NY [desde, hasta], ambos incluidos)? Fin de
// semana = fuera (sin calendario de festivos, igual que antesDe1030NY).
function fueraVentanaNY(ventanaMin, fecha) {
  if (!Array.isArray(ventanaMin) || ventanaMin.length < 2) return false;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(fecha || new Date());
  const v = (t) => (f.find(x => x.type === t) || {}).value;
  if (v('weekday') === 'Sat' || v('weekday') === 'Sun') return true;
  const m = Number(v('hour')) * 60 + Number(v('minute')) + Number(v('second')) / 60;
  return m < ventanaMin[0] || m > ventanaMin[1];
}
// Resumen en español de las reglas de un plan (Tu cuenta).
function textoReglasPlan(plan) {
  if (!plan || plan.id !== 'PLAN_10') {
    return 'Objetivo: venta GTC +35% sobre tu fill · sin corte · 3 operaciones por semana · máximo 10% de la cuenta por operación · espera a las 10:30 ET · tus tickers de siempre. Es el comportamiento de hoy.';
  }
  return 'Objetivo: venta GTC +10% sobre tu fill · corte -20%: la Mesa te avisa y vendes de un toque (nunca un stop automático) · 1 operación al día · 30–50% de la cuenta del bróker (presupuesto 35%) · el movimiento se identifica entre 9:30 y 9:45 ET · una sola compañía al día, la eliges en el Copiloto · si vence hoy y ya pasaron las 10:30 ET, compra la siguiente fecha · sin refuerzo (soporte lo desaconseja con 30–50% de la cuenta).';
}
// ---- plan_usuario: fila PERSONAL cacheada en memoria y en el equipo (offline) ----
const PLAN_K = 'mz_plan_usuario', PLAN_CACHE_MS = 20000;
const _plan = { fila: undefined, ts: 0, err: null };
function planUid() { return (typeof sesionActiva !== 'undefined' && sesionActiva && sesionActiva.user && sesionActiva.user.id) || null; }
function planFilaCache() {
  const uid = planUid();
  if (_plan.fila !== undefined) return (_plan.fila && (!uid || _plan.fila.user_id === uid)) ? _plan.fila : null;
  try { const f = JSON.parse(localStorage.getItem(PLAN_K) || 'null'); if (f && (!uid || f.user_id === uid)) return f; } catch (_) {}
  return null;
}
function planGuardarCache(fila) {
  _plan.fila = fila || null; _plan.ts = Date.now();
  try { if (fila) localStorage.setItem(PLAN_K, JSON.stringify(fila)); else localStorage.removeItem(PLAN_K); } catch (_) {}
}
// Plan activo del usuario; respaldo Plan 35 si no hay fila, la tabla no existe o falla.
function planActivo() {
  const f = planFilaCache();
  return (f && PLANES[f.plan]) || PLANES.PLAN_35;
}
// Lee plan_usuario (máx. cada 20 s salvo forzar). Si falla (sin red o sin la
// migración 0012) se queda con lo último conocido, y sin nada, Plan 35.
async function cargarPlanUsuario(forzar) {
  if (!forzar && _plan.ts && Date.now() - _plan.ts < PLAN_CACHE_MS) return planFilaCache();
  const uid = planUid();
  if (!uid) return planFilaCache();
  _plan.ts = Date.now();
  try {
    const { data, error } = await sb.from('plan_usuario').select('*').eq('user_id', uid).maybeSingle();
    if (error) { _plan.err = error.message || String(error); return planFilaCache(); }
    _plan.err = null;
    planGuardarCache(data || null);
  } catch (e) { _plan.err = String((e && e.message) || e); }
  return planFilaCache();
}
// Upsert PERSONAL en plan_usuario (onConflict user_id); devuelve la fila guardada.
async function guardarPlanUsuario(cambios) {
  const uid = planUid();
  if (!uid) throw new Error('Sin sesión. Sal y vuelve a entrar.');
  const fila = Object.assign({}, cambios || {}, { user_id: uid, actualizado_at: new Date().toISOString() });
  const { data, error } = await sb.from('plan_usuario').upsert(fila, { onConflict: 'user_id' }).select('*').single();
  if (error) {
    const m = String(error.message || error);
    throw new Error(/plan_usuario/.test(m) && /not find|does not exist|schema cache/i.test(m) ? 'la tabla plan_usuario aún no existe (falta aplicar la migración 0012)' : m);
  }
  planGuardarCache(data || fila);
  return data || fila;
}
function lunesNY() {
  // fecha (YYYY-MM-DD en NY) del lunes de esta semana
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date());
  const wd = f.find(p => p.type === 'weekday').value;
  const ymd = `${f.find(p=>p.type==='year').value}-${f.find(p=>p.type==='month').value}-${f.find(p=>p.type==='day').value}`;
  const idx = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 }[wd];
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - idx);
  return d.toISOString().slice(0, 10);
}

async function vistaCopiloto() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  // posiciones UNA vez (el builder de Supabase lanza la consulta en cada then): las
  // ventas GTC/corte se piden solo para las abiertas
  const posP = Promise.resolve(sb.from('posiciones').select('*').order('abierta_at', { ascending: false }));
  // señales de hoy UNA vez, por lo mismo: las quitadas (senales_ocultas) van detrás, con sus ids
  const senP = Promise.resolve(sb.from('senales').select('*').eq('fecha_ny', hoy).order('creado_at', { ascending: false }));
  const [sen, pos, bt, ord, gt] = await Promise.all([
    senP,
    posP,
    sb.from('broker_trades').select('*'),
    sb.from('ordenes').select('*').in('estado', ['enviada', 'error']).order('creado_at', { ascending: false }).limit(20),   // solo ACTIVAS (y las que no se pudo confirmar)
    // TODAS las ventas GTC y de CORTE de las posiciones abiertas, en cualquier estado
    // (canceladas incluidas): deciden la GTC pendiente y el veto de la GTC automática
    posP.then(r => {
      const ids = ((r && r.data) || []).filter(p => p.estado === 'abierta').map(p => p.id);
      return ids.length ? sb.from('ordenes').select('posicion_id,estado,proposito,creado_at').in('posicion_id', ids).in('proposito', ['salida_gtc', 'salida_corte']) : { data: [] };
    }),
    cargarPlanUsuario(),
    cargarOcultas(senP),
  ]);
  const senales = sen.data || [];
  const posic = pos.data || [];
  const abiertas = posic.filter(p => p.estado === 'abierta');
  // GTC pendiente: posición abierta sin su venta límite (+% de SU plan) en el bróker
  const filasGtc = (gt && gt.data) || [];
  const pendGtc = gtcPendientes(abiertas, filasGtc);
  const pendIds = new Set(pendGtc.map(p => p.id));
  const vetoGtc = gtcAutoVetadas(filasGtc);
  abiertas.forEach(p => { p._gtcPendiente = pendIds.has(p.id); p._gtcAutoVeto = vetoGtc.has(String(p.id)); });
  // Mismo cupo que Disciplina: manual + bróker, deduplicado.
  const plan = planActivo();
  const unidas = unirOperaciones(posic, bt.data || []).ops;
  let h = '';

  if (plan.periodo === 'dia') {
    // Plan 10%: cupo del DÍA, objetivo y corte, y la compañía de hoy
    h += tarjetaPlanDia(plan, unidas, hoy, planFilaCache());
  } else {
    // Plan 35%: cupo semanal (idéntico a siempre)
    const semana = unidas.filter(p => (p.abierta_fecha_ny || '') >= lunesNY());
    const usadas = semana.length;
    const colorCupo = usadas > OPS_SEMANA ? 'var(--rojo)' : usadas === OPS_SEMANA ? 'var(--oro)' : 'var(--verde)';
    h += `<div class="card"><div class="fila"><h3>Plan de la semana</h3>
    <span style="font-weight:700;color:${colorCupo}">${usadas} / ${OPS_SEMANA}</span></div>
    <div class="mut">Operaciones esta semana. La doctrina: 3 por semana, ni una más.</div></div>`;
  }

  // plataforma para operar (encima de todos los botones de orden)
  const pl = plataformaOrden(brokersOperables(), brokerOrdenGuardado());
  h += filaPlataforma(pl);

  // señales de hoy → ticket (la misma sección que el Informe: las quitadas no salen)
  h += seccionSenales('SEÑALES DE HOY', senales, _ocultas.ids, _ocultas.ver, (s) => tarjetaSenal(s, posic, pl));

  // registrar a mano (útil siempre) · nueva orden en la plataforma elegida (vista previa primero)
  h += `<div class="dos">
    <button class="btnsec" style="padding:12px" onclick="MZ.abrirFill()">+ Registrar una operación</button>
    ${botonOrden(pl, { proposito: 'entrada' }, '+ Nueva orden')}</div>`;

  // posiciones abiertas
  h += `<div class="sec">POSICIONES ABIERTAS</div>`;
  if (abiertas.length) {
    h += abiertas.map(p => tarjetaPosicion(p)).join('');
  } else {
    h += `<div class="card vacio">Sin posiciones abiertas.</div>`;
  }

  // órdenes ACTIVAS en E*TRADE (las canceladas/ejecutadas/expiradas ya no salen aquí)
  h += seccionOrdenes(ord.data || []);
  $('#vista').innerHTML = h;
  // sincronización silenciosa con E*TRADE (cada 60 s mientras haya activas; ruta() corre cada 60 s)
  if ((ord.data || []).some(x => x.estado === 'enviada' && x.orden_id_ext)) ordenesActualizar({ silencioso: true });
  // GTC AUTOMÁTICO (doctrina: «al llenarte pon YA tu venta límite GTC»): si hay una
  // posición recién llenada sin GTC, se abre la orden de salida ya llena y
  // previsualizada; solo falta tu toque en «Enviar orden» (y el PIN si no está armado).
  abrirGtcAutomatico(pendGtc);
}
// Tarjeta «Plan del día» del Plan 10%: N / 1, objetivo y corte, compañía de hoy
// (4 botones, la elegida resaltada) y el plan cumplido si la de hoy (del Plan 10%,
// con corte congelado) cerró con la venta en el objetivo: prima_salida ≥ límite +10%.
function tarjetaPlanDia(plan, ops, hoy, fila) {
  const deHoy = (ops || []).filter(p => (p.abierta_fecha_ny || '') === hoy);
  const usadas = deHoy.length;
  const ganada = deHoy.find(p => {
    const objetivo = gtcLimite(p.prima_fill, 10);
    return p.stop_pct != null && p.estado === 'cerrada' && objetivo != null
      && p.prima_salida != null && p.prima_salida !== '' && Number(p.prima_salida) + 1e-9 >= objetivo;
  }) || null;
  const foco = focoDeHoy(fila, hoy);
  const color = usadas > plan.opsMax ? 'var(--rojo)' : ganada ? 'var(--verde)' : usadas === plan.opsMax ? 'var(--oro)' : 'var(--verde)';
  return `<div class="card"><div class="fila"><h3>Plan del día</h3>
    <span style="font-weight:700;color:${color}">${usadas} / ${plan.opsMax}</span></div>
    <div class="mut">${esc(plan.nombre)}: ${plan.opsMax} operación al día · objetivo GTC +${plan.gtcPct}% · corte -${plan.stopPct}% · ${plan.tamanoMinPct}–${plan.tamanoMaxPct}% de la cuenta.</div>
    <div class="sec" style="margin-top:10px">COMPAÑÍA DE HOY</div>
    <div class="periodos">${TICKERS.map(t => `<button class="perbtn${t === foco ? ' on' : ''}" onclick="MZ.elegirFoco('${esc(t)}')">${esc(t)}</button>`).join('')}</div>
    ${foco ? `<div class="mut" style="margin-top:4px">Hoy operas <b style="color:var(--tx)">${esc(foco)}</b>: una sola compañía.</div>`
      : `<div class="mut" style="margin-top:4px;color:var(--oro)">Elige la compañía de hoy antes de operar: el Plan 10% va con una sola.</div>`}
    ${ganada ? `<div class="mut" style="margin-top:6px;color:var(--verde);font-weight:700">✓ Plan del día cumplido (${esc(ganada.symbol)} ${usd(Number(ganada.resultado_usd))}): cierra la computadora; la siguiente entrada es mañana.</div>` : ''}
  </div>`;
}
// Posiciones abiertas (con strike, expiración y fill) sin una venta GTC o de corte
// viva o ejecutada (enviada/ejecutada) → hay que poner la GTC. Una venta de CORTE en
// vista previa RECIENTE (menos de PREVIEW_SEG) también cuenta: la posición se está
// cerrando. Una vista previa vieja es huérfana (la PWA murió con el formulario
// abierto) y ya no cuenta; tampoco las canceladas, expiradas, rechazadas o en error.
function gtcPendientes(abiertas, ordenesGtc) {
  const ahora = Date.now();
  const cuenta = (o) => {
    if (o.estado === 'enviada' || o.estado === 'ejecutada') return true;
    if (o.estado !== 'preview' || o.proposito !== 'salida_corte') return false;
    const t = Date.parse(o.creado_at);
    return Number.isFinite(t) && ahora - t < PREVIEW_SEG * 1000 && ahora - t >= -30000;   // fecha «del futuro» (reloj atrasado) no es reciente
  };
  const con = new Set((ordenesGtc || []).filter(o => o && o.posicion_id != null && cuenta(o)).map(o => String(o.posicion_id)));
  return (abiertas || []).filter(p => p && p.estado === 'abierta' && Number(p.prima_fill) > 0 && p.strike != null && p.expiracion
    && ['etrade', 'schwab'].includes(p.broker || 'etrade') && !con.has(String(p.id)));
}
// Veto de la GTC automática EN LA BASE (el mismo en todos los equipos): una posición
// que ya tuvo alguna venta GTC o de corte anotada, en CUALQUIER estado (cancelada
// incluida), jamás recibe una GTC automática; el resaltado «⚠ PON TU GTC» sigue.
// Excepción: la vista previa RECIENTE de una GTC (otro equipo la abrió y espera su PIN)
// no veta, porque no hubo cancelación; si los dos equipos llegan a enviar, el bróker
// rechaza la segunda porque los contratos ya están reservados (igual que en v47).
function gtcAutoVetadas(ordenesGtc) {
  const ahora = Date.now();
  const gtcEnEspera = (o) => {
    if (o.proposito !== 'salida_gtc' || o.estado !== 'preview') return false;
    const t = Date.parse(o.creado_at);
    return Number.isFinite(t) && ahora - t < PREVIEW_SEG * 1000 && ahora - t >= -30000;   // fecha «del futuro» (reloj atrasado) no es reciente
  };
  return new Set((ordenesGtc || []).filter(o => o && o.posicion_id != null && (o.proposito === 'salida_gtc' || o.proposito === 'salida_corte') && !gtcEnEspera(o))
    .map(o => String(o.posicion_id)));
}
// GTC AUTOMÁTICO (pedido de Andrés 2026-09-13, «el cierre apenas la abro»): al
// enviar una compra, la casilla «Al llenarse, enviar sola la venta GTC» queda
// anotada en la orden (preview._mz.gtc_auto). Cuando la Mesa detecta el fill,
// abre la venta GTC (+35% o +10%, el plan CONGELADO de esa posición), la previsualiza y la ENVÍA: el PIN (armado 15 min) es
// la única puerta — si está desarmado, lo pide; si lo cancelas, la orden queda
// abierta para que la envíes tú. Una orden sin la anotación cuenta como SÍ.
const GTC_AUTO_DEF_K = 'mz_gtc_auto_def', GTC_AUTO_ENV_K = 'mz_gtc_auto_env';
function gtcAutoDefecto() { try { return localStorage.getItem(GTC_AUTO_DEF_K) !== '0'; } catch (_) { return true; } }
function gtcAutoGuardarDefecto(v) { try { localStorage.setItem(GTC_AUTO_DEF_K, v ? '1' : '0'); } catch (_) {} }
function gtcAutoAnotar(posId, quiere) { try { const m = JSON.parse(localStorage.getItem(GTC_AUTO_ENV_K) || '{}'); m[String(posId)] = !!quiere; localStorage.setItem(GTC_AUTO_ENV_K, JSON.stringify(m)); } catch (_) {} }
function gtcAutoQuiere(posId) { try { const m = JSON.parse(localStorage.getItem(GTC_AUTO_ENV_K) || '{}'); return m[String(posId)] !== false; } catch (_) { return true; } }
const GTC_AUTO_K = 'mz_gtc_auto';
function gtcAutoYaAbierto(id) { try { const m = JSON.parse(localStorage.getItem(GTC_AUTO_K) || '{}'); return !!m[String(id)]; } catch (_) { return false; } }
function gtcAutoMarcar(id) { try { const m = JSON.parse(localStorage.getItem(GTC_AUTO_K) || '{}'); m[String(id)] = Date.now(); localStorage.setItem(GTC_AUTO_K, JSON.stringify(m)); } catch (_) {} }
function abrirGtcAutomatico(pendientes) {
  // jamás durante un corte: su formulario no puede cruzarse con la venta del corte
  const hayCorte = () => typeof _corte !== 'undefined' && _corte.enCurso;
  if (hayCorte()) return;
  if (!pendientes || !pendientes.length) return;
  if (document.querySelector('.modal')) return;                 // no pisar otro cuadro abierto
  const ops = brokersOperables();
  // nunca por otro bróker, ni en una posición que ya tuvo GTC o corte (veto en la base: _gtcAutoVeto)
  const p = pendientes.find(x => !x._gtcAutoVeto && !gtcAutoYaAbierto(x.id) && ops.includes(x.broker || 'etrade'));
  if (!p) return;
  gtcAutoMarcar(p.id);                                          // una vez por posición y equipo
  const pre = preSalida(p, 'salida_gtc');
  abrirOrden(pre);
  toast(`Fill ${p.symbol} ${p.direccion} ${p.strike} ×${Number(p.contratos) || 1} a $${Number(p.prima_fill).toFixed(2)}: GTC +${Number(p.plan_pct) > 0 ? Number(p.plan_pct) : 35}% a $${(pre.limitPrice || 0).toFixed(2)} — revisa y envía`);
  setTimeout(async () => {
    // solo SU formulario (_ord.pre === pre): si ya es otro, p. ej. la venta del corte, no se toca nada
    if (hayCorte() || !(_ord && _ord.pre === pre && $('#modalOrden') && !_ord.orden)) return;
    await ordenPreview();                                       // vista previa automática (sin PIN)
    if (hayCorte() || !(_ord && _ord.pre === pre && $('#modalOrden') && _ord.previewIds)) return;
    if (gtcAutoQuiere(p.id)) {
      toast('Enviando la venta GTC automática…');
      await ordenPlace();                                        // pide PIN si el equipo está desarmado
    }
  }, 900);
}

// Ticket armado por el worker en la señal (payload.ticket: strike/exp/ask del
// rango vivo): el botón «Operar en <plataforma elegida>» abre la orden ya llena;
// la cadena en vivo permite ajustar con un toque.
function preOrdenDeSenal(s) {
  const pre = { senal_id: s.id, symbol: s.symbol, direccion: s.direccion, proposito: 'entrada' };
  const tk = (s.payload && s.payload.ticket) || null;
  if (tk) {
    if (tk.strike != null && Number.isFinite(Number(tk.strike))) pre.strike = Number(tk.strike);
    if (tk.exp && /^\d{4}-\d{2}-\d{2}$/.test(String(tk.exp))) pre.expiracion = tk.exp;
    if (tk.ask != null && Number(tk.ask) > 0) pre.limitPrice = Number(tk.ask).toFixed(2);
  }
  return pre;
}
function textoTicket(s) {
  const tk = (s.payload && s.payload.ticket) || null;
  if (!tk || tk.strike == null) return '';
  const rango = (tk.rango && tk.rango[0] != null) ? ` · rango $${Math.round(tk.rango[0])}–$${Math.round(tk.rango[1])}` : '';
  return `<div class="mut mono" style="margin-top:6px">Ticket armado: ${esc(s.symbol)} ${esc(s.direccion || '')} ${esc(tk.strike)} · vence ${esc(tk.exp || '—')}${tk.ask != null ? ' · ask $' + Number(tk.ask).toFixed(2) : ''}${rango}</div>`;
}
function tarjetaSenal(s, posic, pl) {
  const yaReg = posic.some(p => p.senal_id === s.id);
  const plan = planActivo();   // la señal dice el 35% doctrinal (C2); la línea del plan propio va aparte
  pl = pl || plataformaOrden(brokersOperables(), brokerOrdenGuardado());
  return `<div class="card" style="border-color:rgba(231,181,77,.45)">
    ${cabeceraSenal(s)}
    ${motivoSenal(s)}
    ${textoTicket(s)}
    ${lineasGtcSenal(s.instruccion_gtc, plan)}
    ${yaReg ? `<div class="mut" style="margin-top:8px;color:var(--verde)">✓ ya registraste tu fill</div>`
      : `<div class="dos" style="margin-top:9px">
        <button class="btnsec" onclick='MZ.abrirFill(${JSON.stringify({
          senal_id: s.id, symbol: s.symbol, direccion: s.direccion }).replace(/'/g, "&#39;")})'>Registrar mi fill</button>
        ${botonOrden(pl, preOrdenDeSenal(s), 'Operar en')}</div>`}
  </div>`;
}
// Instrucción GTC de la señal (Informe y Copiloto). La señal dice el 35% doctrinal
// (SPEC C2) y no se toca; con el Plan 10% se presenta como doctrina y debajo va la
// línea del plan propio, que es la que manda. Con el Plan 35% sale como siempre.
function lineasGtcSenal(instruccion, plan) {
  const diez = !!(plan && plan.id === 'PLAN_10');
  let h = '';
  if (instruccion) h += `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${diez ? 'Doctrina Plan 35%: ' : ''}${esc(instruccion)}</div>`;
  if (diez) h += `<div class="mut mono" style="margin-top:4px;color:var(--azul)">Tu plan (manda): GTC +${plan.gtcPct}% · corte -${plan.stopPct}%</div>`;
  return h;
}

// ---- Señales quitadas (v49 · pedido de Andrés 2026-09-14: «las señales de hoy no se
// han borrado, tenemos que tener un botón para eliminarlas») ----
// Una señal JAMÁS se borra: senales es de MERCADO (append-only, auditoría mesa-cierre,
// candado de dedupe del worker y FKs) y el cliente no escribe tablas de mercado.
// «Quitar» = ocultarla para TI, en todos tus equipos y reversible: una fila PERSONAL en
// senales_ocultas (migración 0013, RLS user_id = auth.uid()). El push no cambia.
// Optimista: el Set en memoria cambia al instante (+ ruta()) y la escritura va detrás,
// en cola (una a la vez, en el orden de los toques, cada una con tope); si falla, se
// revierte y sale un toast con el motivo. Al tocar, respuesta en el sitio (marcarToque).
// Sin la tabla o con la lectura en error: nada oculto, como en v48.
//   ids       senal_id (texto) quitados: lo último leído de la base + lo optimista
//   ver       «Ver quitadas» abierto (en memoria, en este equipo)
//   hoy       ids de las señales de hoy de la última lectura
//   gen       sube al empezar y al terminar cada escritura: una lectura que se cruzó con
//             una escritura no pisa la memoria (traería la foto de antes)
//   pend      senal_id → escrituras en cola; mientras haya, manda la memoria para ese id
//   lect      número de la última lectura lanzada; aplicada: el de la última aplicada
//             (una lectura más vieja que vuelve tarde no pisa a una más nueva)
const _ocultas = { ids: new Set(), ver: false, hoy: new Set(), gen: 0, pend: new Map(), cola: Promise.resolve(), err: null, lect: 0, aplicada: 0 };
// Tope de cada escritura en senales_ocultas (el mismo que el upsert de push_suscripciones):
// si supabase-js no responde, la cola no se traba para siempre y sin aviso.
const TOPE_OCULTAS_MS = 10000;
const SENALES_VACIO = 'Sin señales todavía hoy.<br>CT15A / CT15B (cambio de tendencia en 15 min) y E5 vigilan la apertura de las 9:30 ET; el aviso llega al teléfono.';
// id de una señal como texto de dígitos (bigint de la base); cualquier otra cosa → null
function idSenal(v) {
  const t = String(v == null ? '' : v).trim();
  return /^\d+$/.test(t) ? t : null;
}
// Parte las señales en visibles y quitadas (Set de ids quitados), conservando el orden.
function partirSenales(senales, ocultas) {
  const visibles = [], quitadas = [];
  (senales || []).forEach(s => {
    if (!s) return;
    const id = idSenal(s.id);
    (id && ocultas && ocultas.has(id) ? quitadas : visibles).push(s);
  });
  return { visibles, quitadas };
}
// Sección «SEÑALES DE HOY» del Informe y del Copiloto (la misma en los dos; tarjeta(s)
// dibuja cada visible a la manera de cada vista). Encabezado: «Ver quitadas (N)» u
// «Ocultar quitadas», y «Quitar todas» con los ids VISIBLES de hoy. Abiertas, las
// quitadas salen atenuadas con «Restaurar». Todas quitadas: «Quitaste las N señales de
// hoy.» con «Ver quitadas». Sin señales en el día: el texto vacío de siempre.
function seccionSenales(titulo, senales, ocultas, ver, tarjeta) {
  senales = senales || [];
  const { visibles, quitadas } = partirSenales(senales, ocultas);
  const n = quitadas.length, abiertas = !!ver && n > 0;
  const enlace = (js, txt) => `<a href="#" onclick="${js};return false">${esc(txt)}</a>`;
  const acc = [];
  if (abiertas) acc.push(enlace('MZ.verQuitadas(false, this)', 'Ocultar quitadas'));
  else if (n && visibles.length) acc.push(enlace('MZ.verQuitadas(true, this)', `Ver quitadas (${n})`));
  const ids = visibles.map(s => idSenal(s.id)).filter(Boolean);
  if (ids.length) acc.push(enlace(`MZ.quitarSenales([${ids.map(id => `'${id}'`).join(',')}], this)`, 'Quitar todas'));
  let h = acc.length ? `<div class="sec fila">${esc(titulo)}<span class="acc">${acc.join('')}</span></div>`
    : `<div class="sec">${esc(titulo)}</div>`;
  if (!senales.length) return h + `<div class="card vacio">${SENALES_VACIO}</div>`;
  h += visibles.map(s => tarjeta(s)).join('');
  if (!visibles.length && !abiertas) {
    h += `<div class="card vacio">${n === 1 ? 'Quitaste la señal de hoy.' : `Quitaste las ${n} señales de hoy.`}<br>
      <button class="btnquitar" style="margin-top:9px" onclick="MZ.verQuitadas(true, this)">Ver quitadas</button></div>`;
  }
  if (abiertas) {
    h += quitadas.map(senalQuitadaHtml).join('')
      + `<div class="fresco" style="margin:0 4px 4px">Quitar solo esconde la señal en tus equipos: no se borra y puedes restaurarla cuando quieras.</div>`;
  }
  return h;
}
// Título de la tarjeta de una señal (Informe y Copiloto) con «Quitar» arriba a la derecha,
// lejos de «Registrar mi fill» y de «Operar en». «hace X h» va delante del motivo
// (motivoSenal): junto a «Quitar», a 375-390 px, el símbolo saltaba de línea.
function cabeceraSenal(s) {
  return `<div class="fila"><span style="font-weight:700;font-size:13.5px">${esc(s.titulo)}</span>${botonQuitarSenal(s)}</div>`;
}
// Línea del motivo con «hace X h» delante (sin motivo: solo «hace X h»). tenue: la quitada.
function motivoSenal(s, tenue) {
  const t = esc(haceCuanto(s && s.creado_at).txt), m = esc((s && s.motivo) || '');
  return `<div class="mut${tenue ? ' tenue' : ''}" style="margin-top:5px"><span class="fresco">${t}${m ? ' · ' : ''}</span>${m}</div>`;
}
// onclick con this: el botón tocado, para la respuesta en el sitio (marcarToque).
function botonQuitarSenal(s) {
  const id = idSenal(s && s.id);
  return id ? `<button class="btnquitar" onclick="MZ.quitarSenal('${id}', this)" aria-label="Quitar esta señal de tu lista de hoy">Quitar</button>` : '';
}
// Quitada: atenuada y con «Restaurar» (sin fill ni orden: primero se restaura).
function senalQuitadaHtml(s) {
  const id = idSenal(s && s.id);
  return `<div class="card quitada"><div class="fila">
      <span class="tenue" style="font-weight:700;font-size:13.5px">${esc(s.titulo)}</span>${
        id ? `<button class="btnquitar" onclick="MZ.restaurarSenal('${id}', this)">Restaurar</button>` : ''}</div>
    ${motivoSenal(s, true)}
  </div>`;
}
// Respuesta en el sitio al tocar Quitar / Restaurar / Ver quitadas: el redibujo (ruta)
// espera varios viajes a Supabase y en el iPhone :active no se pinta. El botón se
// deshabilita SIN cambiar su texto (no cambia de ancho ni parte el título); un enlace, que no tiene
// disabled, se atenúa y deja de recibir toques; con tarjeta, la tarjeta se atenúa. NO se
// esconde al instante: la siguiente subiría bajo el dedo y un segundo toque la quitaría.
// El redibujo reconcilia con la memoria; si la escritura falla, soltarToque lo deshace.
function marcarToque(el, texto, tarjeta) {
  try {
    if (!el || !el.style) return;
    if (el.dataset && el.dataset.txt === undefined) el.dataset.txt = el.textContent;
    if (el.tagName === 'BUTTON') el.disabled = true;
    else { el.style.opacity = '.6'; el.style.pointerEvents = 'none'; }
    if (texto) el.textContent = texto;
    const card = tarjeta && el.closest ? el.closest('.card') : null;
    if (card) card.style.opacity = '.45';
  } catch (_) { /* nodo ya fuera de la pantalla: nada que marcar */ }
}
function soltarToque(el) {
  try {
    if (!el || !el.style) return;
    if (el.tagName === 'BUTTON') el.disabled = false;
    else { el.style.opacity = ''; el.style.pointerEvents = ''; }
    if (el.dataset && el.dataset.txt !== undefined) { el.textContent = el.dataset.txt; delete el.dataset.txt; }
    const card = el.closest ? el.closest('.card') : null;
    if (card) card.style.opacity = '';
  } catch (_) { /* nodo ya fuera de la pantalla: nada que soltar */ }
}
// Quitadas de HOY: encadenada tras la consulta de señales (senP, lanzada una sola vez) y
// filtrada por sus ids. Sin sesión, sin señales, sin la tabla o con error: se queda con
// lo último conocido (al arrancar, nada oculto) y la vista se dibuja igual. Siempre, al
// final: «Ver quitadas» se cierra si la sección se quedó sin quitadas.
async function cargarOcultas(senP) {
  const gen0 = _ocultas.gen, lect = ++_ocultas.lect;
  try {
    const r = await senP;
    const ids = ((r && r.data) || []).map(s => idSenal(s && s.id)).filter(Boolean);
    _ocultas.hoy = new Set(ids);
    const uid = planUid();
    if (!ids.length || !uid) return _ocultas.ids;
    const { data, error } = await sb.from('senales_ocultas').select('senal_id').eq('user_id', uid).in('senal_id', ids);
    if (error) { _ocultas.err = String(error.message || error); return _ocultas.ids; }
    _ocultas.err = null;
    aplicarOcultasLeidas(ids, data || [], gen0, lect);
  } catch (e) { _ocultas.err = String((e && e.message) || e); } finally { cerrarVerSinQuitadas(); }
  return _ocultas.ids;
}
// «Ver quitadas» se cierra cuando la sección ya no tiene quitadas de hoy (restauradas aquí
// o en otro equipo, o empezó otro día con la app abierta). Abierto, el próximo «Quitar»
// dejaría la tarjeta atenuada a la vista en vez de hacerla desaparecer.
function cerrarVerSinQuitadas() {
  if (![..._ocultas.hoy].some(x => _ocultas.ids.has(x))) _ocultas.ver = false;
}
// Aplica una lectura de la base a los ids de hoy. Si hubo escrituras mientras se leía
// (gen cambió) la foto puede ser de antes: manda la memoria. Una lectura más vieja que la
// última aplicada tampoco pisa (dos relecturas cruzadas por Realtime: otro equipo quitó y
// restauró). Un id con escrituras en cola no se toca.
function aplicarOcultasLeidas(ids, filas, gen0, lect) {
  if (gen0 !== _ocultas.gen) return false;
  if (lect !== undefined) { if (lect <= _ocultas.aplicada) return false; _ocultas.aplicada = lect; }
  const enBase = new Set((filas || []).map(f => idSenal(f && f.senal_id)).filter(Boolean));
  (ids || []).forEach(id => {
    if (_ocultas.pend.get(id)) return;
    if (enBase.has(id)) _ocultas.ids.add(id); else _ocultas.ids.delete(id);
  });
  return true;
}
// Motivo del toast: corto y en español (dura 2,2 s en una píldora estrecha en el iPhone);
// el texto crudo del error va a la consola.
function motivoOcultas(e) {
  const m = String((e && (e.message || e.error_description)) || e || 'error desconocido');
  try { console.warn('senales_ocultas: ' + m); } catch (_) {}
  if (/senales_ocultas/.test(m) && /not find|does not exist|schema cache/i.test(m)) return 'la Mesa aún no está lista para esto';
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(m)) return 'sin conexión';
  if (/no respondió|tiempo agotado|timeout/i.test(m)) return 'sin respuesta, inténtalo de nuevo';
  if (/jwt|token|401/i.test(m)) return 'tu sesión venció, vuelve a entrar';
  return 'inténtalo de nuevo';
}
// Escritura en cola (una a la vez, en el orden de los toques). quitar = upsert que ignora
// duplicados (doble toque o dos equipos a la vez) con el user_id de la sesión; restaurar
// = delete por senal_id (RLS: solo las tuyas). Cada una con tope (TOPE_OCULTAS_MS): si
// supabase-js no responde, cuenta como fallo y la cola sigue. Si falla, revierte los ids
// que no tengan otra escritura detrás (esa es el último toque y manda) y, si revirtió,
// avisa y redibuja (la relectura trae lo que haya en la base).
// Residuo del tope: el fetch no se aborta y, pasado el tope, la escritura queda en estado
// indeterminado (el mismo motivo por el que etProxy no pone tope a las órdenes). Si la dada
// por fallida llega al servidor DESPUÉS, y después de un toque contrario, la base se queda
// con ella: todos los equipos lo muestran igual (Realtime) y se corrige con otro toque.
function escribirOcultas(op, ids, uid) {
  ids.forEach(id => _ocultas.pend.set(id, (_ocultas.pend.get(id) || 0) + 1));
  _ocultas.gen++;
  const p = _ocultas.cola.then(async () => {
    try {
      const r = op === 'quitar'
        ? await conTope(sb.from('senales_ocultas').upsert(ids.map(id => ({ user_id: uid, senal_id: Number(id) })), { onConflict: 'user_id,senal_id', ignoreDuplicates: true }), TOPE_OCULTAS_MS, 'supabase-js no respondió')
        : await conTope(sb.from('senales_ocultas').delete().eq('senal_id', Number(ids[0])), TOPE_OCULTAS_MS, 'supabase-js no respondió');
      return (r && r.error) || null;
    } catch (e) { return e || new Error('error desconocido'); }
  });
  _ocultas.cola = p;
  return p.then(error => {
    _ocultas.gen++;
    ids.forEach(id => { const k = (_ocultas.pend.get(id) || 0) - 1; if (k > 0) _ocultas.pend.set(id, k); else _ocultas.pend.delete(id); });
    if (!error) return true;
    const revertidos = ids.filter(id => !_ocultas.pend.get(id));
    revertidos.forEach(id => { if (op === 'quitar') _ocultas.ids.delete(id); else _ocultas.ids.add(id); });
    if (revertidos.length) {
      toast((op === 'quitar' ? 'No se pudo quitar: ' : 'No se pudo restaurar: ') + motivoOcultas(error));
      ruta();
    }
    return false;
  });
}
// «Quitar» de una tarjeta y «Quitar todas» (los ids visibles que dibujó la sección); el =
// el botón o enlace tocado (respuesta en el sitio; sin él, nada visual). Un id ya quitado
// no se vuelve a escribir: el doble toque no hace nada. Si ya estaban todos quitados (otro
// equipo, aún sin redibujar) y vino de un toque, se redibuja para mostrar lo que hay.
function quitarSenales(lista, el) {
  const uid = planUid();
  if (!uid) { toast('Sin sesión. Sal y vuelve a entrar.'); return Promise.resolve(false); }
  const ids = [...new Set((Array.isArray(lista) ? lista : [lista]).map(v => idSenal(v)).filter(Boolean))]
    .filter(id => !_ocultas.ids.has(id));
  if (!ids.length) { if (el) ruta(); return Promise.resolve(true); }
  marcarToque(el, null, true);
  ids.forEach(id => _ocultas.ids.add(id));
  const p = escribirOcultas('quitar', ids, uid);
  ruta();
  return p.then(r => { if (!r) soltarToque(el); return r; });
}
function quitarSenal(id, el) { return quitarSenales([id], el); }
// «Restaurar» de una quitada (ya visible: nada que escribir; si vino de un toque, se
// redibuja). Al restaurar la última de hoy, «Ver quitadas» se cierra.
function restaurarSenal(v, el) {
  const id = idSenal(v);
  if (!id || !_ocultas.ids.has(id)) { if (el) ruta(); return Promise.resolve(true); }
  const uid = planUid();
  if (!uid) { toast('Sin sesión. Sal y vuelve a entrar.'); return Promise.resolve(false); }
  marcarToque(el, null, true);
  _ocultas.ids.delete(id);
  cerrarVerSinQuitadas();
  const p = escribirOcultas('restaurar', [id], uid);
  ruta();
  return p.then(r => { if (!r) soltarToque(el); return r; });
}
function verQuitadas(v, el) { marcarToque(el); _ocultas.ver = !!v; ruta(); }

// ---- Plataforma para operar (pedido de Andrés 2026-09-14) ----
// Las órdenes salen por E*TRADE o Charles Schwab; tastytrade y moomoo solo dan saldo
// e historial. La elección vive en ESTE equipo, en mz_broker_orden (la misma clave que
// usan abrirOrden y el selector del formulario), y solo vale con sesión viva: si la
// elegida no la tiene manda la otra con sesión; si ninguna, «Conecta E*TRADE o Schwab».
const PLATAFORMAS_ORDEN = ['etrade', 'schwab'];
function brokerOrdenGuardado() { try { return localStorage.getItem('mz_broker_orden') || ''; } catch (_) { return ''; } }
// {elegida: 'etrade'|'schwab'|null, ops: plataformas con sesión viva en este equipo}
function plataformaOrden(operables, guardada) {
  const ops = PLATAFORMAS_ORDEN.filter(b => (operables || []).includes(b));
  return { elegida: ops.includes(guardada) ? guardada : (ops[0] || null), ops };
}
function filaPlataforma(pl) {
  pl = pl || { elegida: null, ops: [] };
  const sub = (t) => `<small style="display:block;margin-top:2px;font-size:10px;font-weight:500;line-height:1.25">${esc(t)}</small>`;
  const btn = (k) => {
    const nombre = esc(BROKER_NOMBRE[k] || k);
    if (!PLATAFORMAS_ORDEN.includes(k)) {
      return `<button class="perbtn" disabled style="opacity:.45;cursor:not-allowed">${nombre}${sub('solo saldo e historial: órdenes no conectadas')}</button>`;
    }
    const viva = pl.ops.includes(k), on = viva && pl.elegida === k;
    return `<button class="perbtn${on ? ' on' : ''}" onclick="MZ.elegirPlataforma('${k}')">${nombre}${sub(on ? 'elegida' : viva ? 'con sesión' : 'sin sesión · toca para conectar')}</button>`;
  };
  return `<div class="card"><div class="fila"><h3>Plataforma para operar</h3><span class="fresco">en este equipo</span></div>
    <div class="periodos" style="display:grid;grid-template-columns:1fr 1fr;margin-top:8px">${['etrade', 'schwab', 'tasty', 'moomoo'].map(btn).join('')}</div>
    ${pl.elegida ? '' : `<div class="mut" style="margin-top:6px;color:var(--oro)">Ni E*TRADE ni Schwab tienen sesión en este equipo: conecta una para operar.</div>`}</div>`;
}
// Botón de orden con la plataforma elegida («Operar en …», «+ Nueva orden …»); sin
// ninguna con sesión, lleva a Cuentas.
function botonOrden(pl, pre, prefijo) {
  if (!pl || !pl.elegida) return `<button class="pri" onclick="location.hash='#/cuentas'">Conecta E*TRADE o Schwab</button>`;
  const p = Object.assign({}, pre || {}, { broker: pl.elegida });
  return `<button class="pri" onclick='MZ.abrirOrden(${JSON.stringify(p).replace(/'/g, "&#39;")})'>${esc(prefijo)} ${esc(BROKER_NOMBRE[pl.elegida] || pl.elegida)}</button>`;
}
function elegirPlataforma(k) {
  const nombre = BROKER_NOMBRE[k] || k;
  if (!PLATAFORMAS_ORDEN.includes(k)) { toast(nombre + ': solo saldo e historial: órdenes no conectadas'); return; }
  try { localStorage.setItem('mz_broker_orden', k); } catch (_) {}
  // sin sesión viva aquí: a conectarla (sin await antes: iOS solo abre la pestaña dentro del toque)
  if (!brokersOperables().includes(k)) { window.MZ.conectar(k); return; }
  toast('Operarás en ' + nombre);
  ruta();
}

// P&L vivo de una posición abierta: el worker escribe posiciones.mark (prima
// actual por contrato), mark_at, y mfe/mae = MEJOR y PEOR MARK (prima por
// contrato) vistos desde la apertura; aquí se convierten a USD con el fill y
// los contratos. Sin mark todavía → se dice honesto, nunca se inventa.
function pnlVivo(p) {
  if (p.mark == null || !Number.isFinite(Number(p.mark))) {
    // sin strike/expiración el worker no puede cotizar el contrato: decirlo claro
    if (p.strike == null || !p.expiracion) {
      return `<div class="mut" style="margin-top:6px;font-size:11.5px">P&amp;L vivo: necesita strike y expiración (regístralos en el fill)</div>`;
    }
    return `<div class="mut" style="margin-top:6px;font-size:11.5px">P&amp;L vivo: aún sin mark (el worker lo calcula cada 5 min en sesión)</div>`;
  }
  const c = Number(p.contratos) || 1, fill = Number(p.prima_fill) || 0, mark = Number(p.mark);
  const pnl = Math.round((mark - fill) * c * 100 * 100) / 100;
  const pct = fill > 0 ? (mark - fill) / fill * 100 : null;
  const col = pnl > 0 ? 'var(--verde)' : pnl < 0 ? 'var(--rojo)' : 'var(--tx2)';
  const conSigno = (n) => (n > 0 ? '+' : '') + usd(n);
  const aUsd = (m) => (m == null || !Number.isFinite(Number(m))) ? null : Math.round((Number(m) - fill) * c * 100 * 100) / 100;
  const exc = (m) => { const u = aUsd(m); return u == null ? '—' : conSigno(u); };
  return `<div class="mut mono" style="margin-top:6px;font-size:11.5px">mark <b style="color:var(--tx)">$${esc(mark.toFixed(2))}</b>
    · P&amp;L <b style="color:${col}">${conSigno(pnl)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)` : ''}</b>
    · MFE <span style="color:var(--verde)">${exc(p.mfe)}</span> / MAE <span style="color:var(--rojo)">${exc(p.mae)}</span>
    · ${esc(haceCuanto(p.mark_at).txt)}</div>`;
}

// Prima con 2 decimales, o hasta 4 si hacen falta (un corte de 0.096 no se redondea a 0.10).
function fmtPrima(v) {
  let s = Number(v).toFixed(4);
  while (s.endsWith('0') && s.split('.')[1].length > 2) s = s.slice(0, -1);
  return s;
}
// ¿La posición tocó su corte? El worker lo marca (aviso_corte_at) o el mark ya está en el corte.
function corteTocado(p) {
  const corte = corteDe(p && p.prima_fill, p && p.stop_pct);
  if (corte == null) return false;
  if (p.aviso_corte_at) return true;
  return p.mark != null && p.mark !== '' && Number.isFinite(Number(p.mark)) && Number(p.mark) <= corte;
}
function tarjetaPosicion(p) {
  const pct = Number(p.plan_pct) > 0 ? Number(p.plan_pct) : 35;            // plan CONGELADO de esta posición
  const corte = corteDe(p.prima_fill, p.stop_pct);
  const tocado = corteTocado(p);
  const operable = ['etrade', 'schwab'].includes(p.broker || 'etrade');
  return `<div class="card"${tocado ? ' style="border-color:rgba(242,109,95,.6)"' : ''}>
    <div class="fila"><h3>${esc(p.symbol)} ${esc(p.direccion)}${p.strike ? ' ' + esc(p.strike) : ''}</h3>
      <span class="fresco">×${esc(p.contratos)} · ${esc(p.broker || '—')}</span></div>
    <div class="fila" style="margin-top:6px">
      <span class="mut">fill <b class="mono" style="color:var(--tx)">$${esc(p.prima_fill)}</b></span>
      <span class="mut">límite GTC <b class="mono" style="color:var(--oro)">$${esc(p.gtc_limite)}</b></span></div>
    ${corte != null ? `<div class="fila" style="margin-top:3px">
      <span class="mut">plan +${esc(pct)}%</span>
      <span class="mut">corte -${esc(Number(p.stop_pct))}% <b class="mono" style="color:var(--rojo)">$${esc(fmtPrima(corte))}</b></span></div>` : ''}
    ${tocado ? `<div class="aviso" style="background:rgba(242,109,95,.12);border-color:rgba(242,109,95,.45);color:var(--rojo)">
      ${p.aviso_corte_at
        ? `<b>⚠ La Mesa te avisó del corte -${esc(Number(p.stop_pct))}% ($${esc(fmtPrima(corte))})${p.aviso_corte_mark != null ? ` · prima $${esc(fmtPrima(p.aviso_corte_mark))}` : ''}.</b>`
        : `<b>⚠ El último mark está en tu corte -${esc(Number(p.stop_pct))}% ($${esc(fmtPrima(corte))}) · mark $${esc(fmtPrima(p.mark))}.</b> Aún sin aviso de la Mesa (el mark puede venir de una sola punta): mira el bid.`}
      Si la entrada fue mala, corta ya: no la dejes ir a cero.${operable ? '' : ' Vende en tu bróker.'}</div>` : ''}
    ${pnlVivo(p)}
    <div class="fila" style="margin-top:9px;gap:8px">
      <button class="btnsec" onclick="MZ.copiar('${esc(p.gtc_limite)}')">Copiar GTC</button>
      <button class="btnsec" onclick="MZ.cerrar(${p.id}, ${p.prima_fill})">Registrar salida</button></div>
    ${operable ? `<div class="fila" style="margin-top:8px;gap:8px">
      <button class="btnsec" style="color:var(--oro);border-color:rgba(231,181,77,.45)${p._gtcPendiente ? ';background:rgba(231,181,77,.14);font-weight:700' : ''}" onclick='MZ.abrirOrden(${JSON.stringify(preSalida(p, 'salida_gtc')).replace(/'/g, "&#39;")})'>${p._gtcPendiente ? '⚠ PON TU GTC' : 'GTC'} +${pct}% ($${esc((gtcDePosicion(p) || 0).toFixed(2))})</button>
      ${p.stop_pct == null ? `<button class="btnsec" onclick='MZ.abrirOrden(${JSON.stringify(preSalida(p, 'salida_stop')).replace(/'/g, "&#39;")})'>Trailing stop</button>` : ''}</div>` : ''}
    ${corte != null && operable ? `<div class="fila" style="margin-top:8px">
      <button class="btnsec" style="${tocado ? 'background:var(--rojo);color:#fff;border-color:var(--rojo);font-weight:700' : 'color:var(--rojo);border-color:rgba(242,109,95,.45)'}" onclick="MZ.cortarPosicion(${Number(p.id)})">Cortar</button></div>` : ''}
  </div>`;
}
// Prefill de una orden de SALIDA (SELL_CLOSE) desde una posición abierta.
// salida_gtc: LIMIT GTC al límite de SU plan · salida_stop: trailing stop GTC ·
// salida_corte: LIMIT DAY al bid (el corte del Plan 10%; el bid lo pasa cortarPosicion).
function preSalida(p, proposito, bid) {
  const gtc = proposito === 'salida_gtc', corte = proposito === 'salida_corte';
  return { proposito, posicion_id: p.id, broker: p.broker || 'etrade', symbol: p.symbol, direccion: p.direccion,
    strike: p.strike == null ? undefined : Number(p.strike), expiracion: p.expiracion || undefined,
    cantidad: Number(p.contratos) || 1, accion: 'venta', orderTerm: corte ? 'DAY' : 'GOOD_UNTIL_CANCEL',
    priceType: (gtc || corte) ? 'LIMIT' : 'TRAILING_STOP_PRCT',
    limitPrice: gtc ? gtcDePosicion(p) : (corte && Number(bid) > 0) ? Math.round(Number(bid) * 100) / 100 : undefined };
}

// ---- modal de registro de fill ----
function abrirFill(pre) {
  pre = pre || {};
  const m = document.createElement('div');
  m.className = 'modal'; m.id = 'modalFill';
  m.innerHTML = `<div class="hoja">
    <h3 style="margin:0 0 2px">Registrar fill</h3>
    <div class="mut" style="margin-bottom:10px">La orden la pones en tu bróker. Aquí registras lo que se llenó.</div>
    <label>Ticker</label>
    <select id="fSym">${TICKERS.map(t =>
      `<option ${pre.symbol===t?'selected':''}>${t}</option>`).join('')}</select>
    <label>Dirección</label>
    <select id="fDir"><option ${pre.direccion==='CALL'?'selected':''}>CALL</option>
      <option ${pre.direccion==='PUT'?'selected':''}>PUT</option></select>
    <div class="dos">
      <div><label>Strike</label><input id="fStrike" type="number" inputmode="decimal" step="0.5" placeholder="ej. 230" required></div>
      <div><label>Expira</label><input id="fExp" type="date" required></div></div>
    <div class="dos">
      <div><label>Contratos</label><input id="fQty" type="number" inputmode="numeric" value="1" min="1"></div>
      <div><label>Bróker</label><select id="fBr"><option value="etrade">E*TRADE</option>
        <option value="schwab">Schwab</option><option value="tasty">tastytrade</option></select></div></div>
    <label>Prima de tu fill (por contrato)</label>
    <input id="fPrima" type="number" inputmode="decimal" step="0.01" placeholder="ej. 0.98" autofocus>
    <div id="fRango" class="rangohint">Rango óptimo: —</div>
    <div id="fGtc" class="gtcprev">Límite GTC: —</div>
    <div class="err" id="fErr"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.cerrarModal()">Cancelar</button>
      <button class="pri" onclick="MZ.guardarFill(${pre.senal_id || 'null'})">Guardar</button></div>
  </div>`;
  document.body.appendChild(m);
  const prima = m.querySelector('#fPrima');
  const sym = m.querySelector('#fSym');
  let rango = null;                 // rango_vivo del ticker seleccionado
  const planF = planActivo();       // el registro manual congela el plan activo
  const evaluar = () => {
    const v = parseFloat(prima.value);
    const corteF = corteDe(v, planF.stopPct);
    m.querySelector('#fGtc').textContent = v > 0
      ? `Límite GTC a colocar: $${gtcLimite(v, planF.gtcPct).toFixed(2)}  (fill ×${(1 + planF.gtcPct / 100).toFixed(2)} + $0.02)${corteF != null ? ` · corte -${planF.stopPct}%: $${fmtPrima(corteF)}` : ''}` : 'Límite GTC: —';
    const rh = m.querySelector('#fRango');
    if (!rango || rango.lo == null) { rh.textContent = 'Rango óptimo: sin dato'; rh.dataset.n = ''; return; }
    // Rango invertido (cotizaciones fuera de sesión): NO juzgar. Con lo>hi el
    // borde sale negativo y una prima que está dentro se marcaba «FUERA del
    // rango», y ese veredicto se guardaba en posiciones y contaba en Disciplina.
    if (!(Number(rango.lo) <= Number(rango.hi))) {
      rh.textContent = 'Rango óptimo: — (rango inválido, cotizaciones fuera de sesión)'; rh.dataset.n = ''; return;
    }
    const lo = Math.round(rango.lo), hi = Math.round(rango.hi);
    if (!(v > 0)) { rh.innerHTML = `Rango óptimo: <b>$${lo}–$${hi}</b>`; rh.dataset.n = 'ok'; return; }
    const cent = v * 100;
    const borde = (hi - lo) * 0.15;
    let n = 'ok', txt = 'dentro del rango';
    if (cent < lo - borde || cent > hi + borde) { n = 'alto'; txt = 'FUERA del rango — así se perdió en agosto'; }
    else if (cent < lo || cent > hi) { n = 'aviso'; txt = 'en el borde del rango'; }
    rh.innerHTML = `Rango óptimo <b>$${lo}–$${hi}</b> · tu prima $${cent.toFixed(0)}: <b>${txt}</b>`;
    rh.dataset.n = n;
  };
  const cargarRango = async () => {
    rango = null;
    const { data } = await sb.from('ticker_estado').select('payload').eq('symbol', sym.value).maybeSingle();
    // mismo criterio que la tarjeta y que el formulario de orden: manda el método
    // de la academia, luego la tabla, y el rango por delta solo como último recurso
    rango = data && data.payload
      ? componerRango(data.payload.rango_vivo || null, data.payload.rango_academia || null, RANGOS_TABLA[sym.value] || null)
      : null;
    evaluar();
  };
  prima.addEventListener('input', evaluar);
  sym.addEventListener('change', cargarRango);
  cargarRango();
  setTimeout(() => prima.focus(), 50);
}
function cerrarModal() { const m = $('#modalFill'); if (m) m.remove(); }

async function guardarFill(senalId) {
  const g = (id) => $('#' + id).value;
  const prima = parseFloat(g('fPrima'));
  const qty = parseFloat(g('fQty'));
  if (!(prima > 0) || !(qty > 0)) { $('#fErr').textContent = 'Falta la prima o los contratos.'; return; }
  const strike = parseFloat(g('fStrike'));
  if (!(strike > 0) || !g('fExp')) { $('#fErr').textContent = 'Pon el strike y la expiración (sin ellos no hay P&L vivo).'; return; }
  // Patrón iOS: la sesión en memoria, nunca sb.auth.* en respuesta a un tap.
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { $('#fErr').textContent = 'Sin sesión. Sal y vuelve a entrar.'; return; }
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const sem = ($('#fRango') || {}).dataset ? $('#fRango').dataset.n : '';  // veredicto del rango
  const plan = planActivo();       // plan CONGELADO en la posición
  const fila = {
    user_id: uid, symbol: g('fSym'), direccion: g('fDir'),
    strike, expiracion: g('fExp'), contratos: qty, prima_fill: prima,
    plan_pct: plan.gtcPct, broker: g('fBr'), senal_id: senalId || null,
    abierta_fecha_ny: hoy,
    entrada_semaforo: (sem === 'ok' || sem === 'aviso' || sem === 'alto') ? sem : null,
    fuera_de_rango: sem === 'alto',
  };
  if (plan.stopPct != null) fila.stop_pct = plan.stopPct;   // sin corte no se envía (compatible sin la migración 0012)
  const { error } = await sb.from('posiciones').insert(fila);
  if (error) { $('#fErr').textContent = 'No se guardó: ' + error.message; return; }
  cerrarModal(); ruta();
}
async function cerrar(id, primaFill) {
  const val = prompt('Prima de salida (por contrato). Deja vacío si expiró sin valor.');
  if (val === null) return;
  const salida = val.trim() === '' ? 0 : parseFloat(val);
  if (isNaN(salida)) return;
  const { data: p } = await sb.from('posiciones').select('contratos').eq('id', id).single();
  const res = p ? Math.round((salida - primaFill) * (p.contratos || 1) * 100 * 100) / 100 : null;
  await sb.from('posiciones').update({
    estado: salida === 0 ? 'expirada' : 'cerrada', prima_salida: salida,
    resultado_usd: res, cerrada_at: new Date().toISOString(),
  }).eq('id', id);
  ruta();
}
async function copiar(v) {
  try { await navigator.clipboard.writeText(String(v)); toast('GTC $' + v + ' copiado'); }
  catch { toast('Copia manual: $' + v); }
}
function toast(t) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
}
window.MZ = { abrirFill, cerrarModal, guardarFill, cerrar, copiar };
// Señales quitadas (v49): DESPUÉS de la asignación plana de arriba, que pisaría lo de antes.
window.MZ = Object.assign(window.MZ, { quitarSenal, quitarSenales, restaurarSenal, verQuitadas });

// ---------- Tu cuenta: cambiar contraseña / salir ----------
function abrirCuenta() {
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalCuenta';
  const email = (sesionActiva && sesionActiva.user && sesionActiva.user.email) || '';
  m.innerHTML = `<div class="hoja">
    <h3 style="margin:0 0 2px">Tu cuenta</h3>
    <div class="mut" style="margin-bottom:10px">${esc(email)} <span id="cpDiag" style="font-size:10px;color:var(--tx3)"></span></div>
    <label>Contraseña actual</label>
    <input id="cpActual" type="password" autocomplete="current-password">
    <label>Nueva contraseña</label>
    <input id="cpNueva" type="password" autocomplete="new-password" placeholder="mínimo 8 caracteres">
    <label>Repite la nueva contraseña</label>
    <input id="cpRep" type="password" autocomplete="new-password">
    <div class="err" id="cpErr"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.cerrarCuenta()">Cancelar</button>
      <button class="pri" onclick="MZ.cambiarPass()">Cambiar contraseña</button></div>
    <div class="sec" style="margin-top:14px">AVISOS EN ESTE DISPOSITIVO</div>
    <div class="fila" style="align-items:flex-start">
      <div class="mut" id="avEstado" style="flex:1">consultando…</div>
      <button class="btnsec oculto" id="avBtn" style="flex:none;padding:8px 14px" onclick="MZ.avisos()">Activar</button></div>
    <div class="sec" style="margin-top:14px">PLAN DE TRADING</div>
    <select id="cpPlan" onchange="this.dataset.tocado='1';MZ.planResumen()">
      ${Object.values(PLANES).map(pl => `<option value="${pl.id}" ${pl.id === planActivo().id ? 'selected' : ''}>${esc(pl.nombre)}${pl.id === 'PLAN_35' ? ' · doctrina de Joel' : ' · diapositivas del curso'}</option>`).join('')}</select>
    <div class="mut" id="cpPlanRes" style="margin-top:4px">${esc(textoReglasPlan(planActivo()))}</div>
    <div class="fresco" style="margin-top:3px">Personal: solo tú lo ves. Cambiarlo no toca tus posiciones abiertas (cada una conserva su plan).</div>
    <div class="err" id="cpPlanErr" style="text-align:left"></div>
    <button class="btnsec" style="width:100%" onclick="MZ.guardarPlan()">Guardar plan</button>
    <div class="sec" style="margin-top:14px">ÓRDENES</div>
    <div class="fila" style="align-items:flex-start">
      <div class="mut" id="ordPinEstado" style="flex:1">…</div>
      <button class="btnsec" id="ordPinBtn" style="flex:none;padding:8px 14px" onclick="MZ.pinOrdenes()">Crear PIN</button></div>
    <div class="fila" style="align-items:flex-start;margin-top:6px">
      <div class="mut" id="ordArmEstado" style="flex:1">desarmado</div>
      <button class="btnsec oculto" id="ordArmBtn" style="flex:none;padding:8px 14px" onclick="MZ.armar()">Armar</button></div>
    <button class="btnsec" style="width:100%;margin-top:12px" onclick="MZ.salir()">Salir de la Mesa</button>
  </div>`;
  document.body.appendChild(m);
  diagSesion().then(t => { const d = $('#cpDiag'); if (d) d.textContent = t; });
  pintarAvisos();
  pintarOrdenesCuenta();
  // el plan guardado en la nube manda (otro equipo pudo cambiarlo)
  cargarPlanUsuario(true).then(() => {
    const s = $('#cpPlan'); if (!s || s.dataset.tocado) return;
    s.value = planActivo().id; pintarResumenPlan();
    const e = $('#cpPlanErr'); if (e && _plan.err) e.textContent = 'Plan en respaldo (Plan 35%): ' + _plan.err;
  });
  setTimeout(() => { const i = $('#cpActual'); if (i) i.focus(); }, 60);
}
function pintarResumenPlan() {
  const s = $('#cpPlan'), r = $('#cpPlanRes'); if (!s || !r) return;
  r.textContent = textoReglasPlan(PLANES[s.value] || PLANES.PLAN_35);
}
async function guardarPlan() {
  const s = $('#cpPlan'), err = $('#cpPlanErr'); if (!s || !err) return;
  const id = PLANES[s.value] ? s.value : 'PLAN_35';
  err.style.color = ''; err.textContent = 'Guardando…';
  try {
    await guardarPlanUsuario({ plan: id });
    err.textContent = '';
    delete s.dataset.tocado;
    toast(`Plan guardado: ${PLANES[id].nombre}. Tus posiciones abiertas conservan su plan.`);
    ruta();
  } catch (e) { err.style.color = 'var(--rojo)'; err.textContent = 'No se guardó: ' + ((e && e.message) || e); }
}
// Compañía de hoy (Plan 10%): se guarda en plan_usuario con la fecha NY de hoy.
async function elegirFoco(sym) {
  sym = String(sym || '').trim().toUpperCase();
  if (!TICKERS.includes(sym)) return;
  try {
    await guardarPlanUsuario({ symbol_foco: sym, foco_fecha: hoyNY() });
    toast(`Compañía de hoy: ${sym}`);
    ruta();
  } catch (e) { toast('No se guardó la compañía: ' + ((e && e.message) || e)); }
}

// ---------- Avisos push (Web Push con VAPID; el worker del VPS los manda) ----------
// La suscripción del navegador se guarda en push_suscripciones (RLS: solo tú).
// iOS solo permite push a apps añadidas a la pantalla de inicio (16.4+).
const VAPID_PUBLIC_KEY = (window.MESA2 && window.MESA2.VAPID_PUBLIC_KEY) || '';
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const esIOS = () => /iPhone|iPad/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad «de escritorio»
const esStandalone = () => !!(navigator.standalone
  || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
const avisosSoportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const conTope = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'tiempo agotado')), ms))]);
const MSG_IOS_INICIO = 'En iPhone: añade la Mesa a la pantalla de inicio (Compartir → Añadir a inicio) y actívalos desde ahí.';

// Estado de los avisos en ESTE dispositivo: {txt, activo, puede}
async function avisosEstado() {
  if (esIOS() && !esStandalone()) return { txt: MSG_IOS_INICIO, puede: false };
  if (!avisosSoportado()) return { txt: 'Este navegador no soporta avisos push.', puede: false };
  if (Notification.permission === 'denied') return { txt: 'Permiso denegado en este navegador. Actívalo en los ajustes del sitio y vuelve a intentarlo.', puede: false };
  try {
    const reg = await conTope(navigator.serviceWorker.ready, 5000, 'el service worker no está listo');
    const sub = await reg.pushManager.getSubscription();
    if (sub) avisosAutocurar(sub);   // si el worker borró la fila o rotó el endpoint, reaparece
    return sub ? { txt: 'activos en este dispositivo', activo: true, puede: true }
      : { txt: 'desactivados', activo: false, puede: true };
  } catch (e) { return { txt: 'No pude consultar el estado: ' + ((e && e.message) || e), puede: false }; }
}
// Autocuración: vuelve a guardar en la nube la suscripción local (idempotente).
async function avisosAutocurar(sub) {
  try {
    const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
    if (!uid) return;
    if (!sub) { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); }
    if (!sub) return;
    const j = sub.toJSON();
    if (!j || !j.endpoint || !j.keys || !j.keys.p256dh || !j.keys.auth) return;
    await sb.from('push_suscripciones').upsert({
      user_id: uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      ua: navigator.userAgent.slice(0, 120), fallos: 0,
    }, { onConflict: 'user_id,endpoint' });
  } catch (_) {}
}
async function pintarAvisos() {
  const est = $('#avEstado'), btn = $('#avBtn');
  if (!est || !btn) return;
  const s = await avisosEstado();
  if (!$('#avEstado')) return;   // el modal se cerró mientras tanto
  est.textContent = s.txt;
  est.style.color = s.activo ? 'var(--verde)' : '';
  btn.classList.toggle('oculto', !s.puede);
  btn.textContent = s.activo ? 'Desactivar' : 'Activar';
  btn.dataset.activo = s.activo ? '1' : '';
}
// Diagnóstico de la activación al proxy (solo paso/booleanos/mensaje; jamás
// llaves, endpoint ni tokens): para ver desde el servidor dónde falla en iOS.
function avisosDiag(paso, extra) {
  try { etProxy('/diag', Object.assign({ que: 'avisos', paso, ios: esIOS(), standalone: esStandalone(),
    perm: (typeof Notification !== 'undefined' && Notification.permission) || 'n/a' }, extra || {})).catch(() => {}); } catch (_) {}
}
// Guardado por REST directo con el JWT del storage (respaldo al cliente
// supabase-js, que en iOS a veces no «ve» la sesión).
async function pushUpsertRest(fila) {
  const j = JSON.parse(localStorage.getItem(claveSesion()) || 'null');
  const jwt = j && j.access_token;
  if (!jwt) throw new Error('sin sesión en el storage');
  const r = await fetch(SUPABASE_URL + '/rest/v1/push_suscripciones?on_conflict=user_id,endpoint', {
    method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + jwt,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([fila]) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('REST ' + r.status + ' ' + t.slice(0, 120)); }
}
async function avisosActivar() {
  const est = $('#avEstado'), btn = $('#avBtn');
  if (!VAPID_PUBLIC_KEY) { est.textContent = 'Falta la llave VAPID pública en config.js.'; return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { est.textContent = 'Sin sesión. Sal y vuelve a entrar.'; avisosDiag('sin_uid'); return; }
  btn.disabled = true; est.style.color = ''; est.textContent = 'Pidiendo permiso…';
  let perm = 'default';
  try { perm = await Notification.requestPermission(); } catch (_) { perm = Notification.permission; }
  if (perm !== 'granted') {
    est.textContent = perm === 'denied' ? 'Permiso denegado. Actívalo en los ajustes del navegador/sitio.' : 'No concediste el permiso.';
    avisosDiag('permiso', { perm }); btn.disabled = false; return;
  }
  est.textContent = 'Suscribiendo…';
  let sub = null, paso = 'sw';
  try {
    const reg = await conTope(navigator.serviceWorker.ready, 8000, 'el service worker no está listo');
    paso = 'subscribe';
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    if (!j || !j.endpoint || !j.keys || !j.keys.p256dh || !j.keys.auth) throw new Error('suscripción incompleta');
    paso = 'guardar';
    const fila = { user_id: uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      ua: navigator.userAgent.slice(0, 120), fallos: 0 };
    let guardado = 'sb';
    try {
      const { error } = await conTope(sb.from('push_suscripciones').upsert(fila, { onConflict: 'user_id,endpoint' }), 10000, 'supabase-js no respondió');
      if (error) throw new Error(error.message);
    } catch (e1) {
      guardado = 'rest';
      await pushUpsertRest(fila);   // respaldo: REST directo con el JWT del storage
    }
    avisosDiag('ok', { guardado });
    toast('Avisos activados ✓');
  } catch (e) {
    avisosDiag('error', { paso, msg: String((e && e.message) || e).slice(0, 160) });
    // Si la nube no la guardó, la suscripción local no sirve: se deshace para
    // que el estado no mienta («activos» sin que el worker sepa a dónde mandar).
    if (sub) { try { await sub.unsubscribe(); } catch (_) {} }
    const m = (e && e.message) || String(e);
    est.textContent = /permission|denied|permiso/i.test(m) ? 'Permiso denegado por el navegador.'
      : /AbortError|push service|registration failed/i.test(m) ? 'El servicio de push del navegador no respondió. Inténtalo de nuevo.'
      : 'No pude activar los avisos: ' + m;
    est.style.color = 'var(--rojo)';
  }
  btn.disabled = false;
  if (!est.style.color) pintarAvisos();
}
async function avisosDesactivar() {
  const est = $('#avEstado'), btn = $('#avBtn');
  btn.disabled = true; est.style.color = ''; est.textContent = 'Desactivando…';
  try {
    const reg = await conTope(navigator.serviceWorker.ready, 8000, 'el service worker no está listo');
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
      let q = sb.from('push_suscripciones').delete().eq('endpoint', endpoint);
      if (uid) q = q.eq('user_id', uid);
      const { error } = await q;
      if (error) throw new Error('no se borró en la nube: ' + error.message);
    }
    toast('Avisos desactivados');
  } catch (e) { est.textContent = 'No pude desactivar: ' + ((e && e.message) || e); est.style.color = 'var(--rojo)'; }
  btn.disabled = false;
  if (!est.style.color) pintarAvisos();
}
function avisosToggle() {
  const btn = $('#avBtn');
  if (!btn) return;
  return btn.dataset.activo ? avisosDesactivar() : avisosActivar();
}
const claveSesion = () => 'sb-' + new URL(SUPABASE_URL).hostname.split('.')[0] + '-auth-token';
// Diagnóstico corto (sin tokens) del estado de la sesión en ESTE dispositivo.
async function diagSesion() {
  const o = [];
  try { const { data, error } = await sb.auth.getSession(); o.push('gs:' + (data && data.session ? 'ok' : (error ? 'err' : 'null'))); }
  catch (_) { o.push('gs:exc'); }
  try { const j = JSON.parse(localStorage.getItem(claveSesion()) || 'null');
    o.push('ls:' + (!j ? 'no' : (j.expires_at && j.expires_at <= Date.now() / 1000 ? 'exp' : 'ok'))); }
  catch (_) { o.push('ls:exc'); }
  o.push('locks:' + (typeof navigator.locks === 'object' ? 'y' : 'n'));
  return '· ' + o.join(' ');
}
function cerrarCuenta() { const m = $('#modalCuenta'); if (m) m.remove(); }
// Cambio de contraseña SIN depender de la sesión guardada (en iOS supabase-js
// a veces no la «ve»): se re-autentica con la contraseña actual por REST
// (sesión fresca), cambia la clave con ese token, adopta esa sesión y recarga.
async function cambiarPass() {
  const email = (sesionActiva && sesionActiva.user && sesionActiva.user.email) || '';
  const actual = $('#cpActual').value, a = $('#cpNueva').value, b = $('#cpRep').value, err = $('#cpErr');
  if (!email) { err.textContent = 'No encuentro tu correo. Sal y vuelve a entrar.'; return; }
  if (!actual) { err.textContent = 'Pon tu contraseña actual.'; return; }
  if (a.length < 8) { err.textContent = 'Mínimo 8 caracteres.'; return; }
  if (a !== b) { err.textContent = 'Las dos no coinciden.'; return; }
  if (a === actual) { err.textContent = 'La nueva tiene que ser distinta.'; return; }
  const H = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  err.textContent = 'Verificando…';
  let ses;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: H, body: JSON.stringify({ email, password: actual }) });
    ses = await r.json().catch(() => ({}));
    if (!r.ok || !ses.access_token) { err.textContent = 'La contraseña actual no es correcta.'; return; }
  } catch (_) { err.textContent = 'Sin conexión. Inténtalo de nuevo.'; return; }
  err.textContent = 'Guardando…';
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT', headers: Object.assign({ Authorization: 'Bearer ' + ses.access_token }, H),
      body: JSON.stringify({ password: a }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = 'No pude cambiarla: ' + (d.msg || d.message || d.error_description || d.error || r.status); return; }
  } catch (_) { err.textContent = 'Sin conexión. Inténtalo de nuevo.'; return; }
  // La sesión fresca es la que sobrevive al cambio: la adoptamos y recargamos.
  try {
    if (!ses.expires_at && ses.expires_in) ses.expires_at = Math.floor(Date.now() / 1000) + Number(ses.expires_in);
    localStorage.setItem(claveSesion(), JSON.stringify(ses));
  } catch (_) {}
  cerrarCuenta();
  toast('Contraseña cambiada ✓');
  setTimeout(() => location.reload(), 900);
}
async function salir() {
  cerrarCuenta();
  // signOut con tope de tiempo + borrado directo: en iOS no puede quedarse colgado.
  try { await Promise.race([sb.auth.signOut(), new Promise(r => setTimeout(r, 2500))]); } catch (_) {}
  try { localStorage.removeItem(claveSesion()); } catch (_) {}
  location.hash = '';
  location.reload();
}
window.MZ = Object.assign(window.MZ, { abrirCuenta, cerrarCuenta, cambiarPass, salir, avisos: avisosToggle,
  planResumen: pintarResumenPlan, guardarPlan, elegirFoco });
// Charts de Tickers (registrados AQUÍ, después de la asignación plana de window.MZ).
window.MZ = Object.assign(window.MZ, { chartAbrir: abrirChart, chartCerrar: cerrarChart, chartVista, chartTf, chartGuardarTarget: guardarTarget });

// ---------- Cuentas y diario (historial + resúmenes) ----------
let _periodoSel = 'semana';   // semana | mes | ytd

function inicioPeriodo(clave) {
  // fecha YYYY-MM-DD (NY) de inicio del período
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  if (clave === 'semana') return lunesNY();
  if (clave === 'mes') return hoy.slice(0, 8) + '01';
  return hoy.slice(0, 4) + '-01-01';   // ytd
}
function fmtFechaNY(iso, conHora) {
  if (!iso) return '—';
  const o = { timeZone: 'America/New_York', day: '2-digit', month: 'short' };
  if (conHora) { o.hour = '2-digit'; o.minute = '2-digit'; o.hour12 = false; }
  return new Intl.DateTimeFormat('es', o).format(new Date(iso));
}
function durTxt(a, b) {
  if (!a || !b) return '—';
  const min = (new Date(b) - new Date(a)) / 60000;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} d`;
}
const usd = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const colUtil = (n) => n == null ? 'var(--tx2)' : n > 0 ? 'var(--verde)' : n < 0 ? 'var(--rojo)' : 'var(--tx2)';

const BROKER_NOMBRE = { etrade: 'E*TRADE', schwab: 'Charles Schwab', tasty: 'tastytrade', moomoo: 'moomoo' };
const BROKERS = [
  { k: 'etrade', n: 'E*TRADE' }, { k: 'tasty', n: 'tastytrade' },
  { k: 'schwab', n: 'Charles Schwab' },
  { k: 'moomoo', n: 'moomoo' },   // vuelve 2026-09-13 «por si acaso»: OpenD headless en el VPS; el worker publica saldo y trades cada 30 min
];

// ---------- Conexión E*TRADE (OAuth 1.0a; el token vive en ESTE dispositivo) ----------
// Opción B: el proxy del VPS solo FIRMA con el secreto de app; el token con
// poder (oauth_token + secret) se guarda aquí en localStorage y jamás se sube a
// la nube. E*TRADE lo caduca cada medianoche ET → login casi diario, con PIN.
const ET_K = { tok: 'mz_et_tok', sec: 'mz_et_sec', cache: 'mz_et_cache', sync: 'mz_et_sync2', dia: 'mz_et_dia', acct: 'mz_et_acct', login: 'mz_et_login' };
const num2 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// El token de E*TRADE muere a medianoche ET: si el login fue otro día NY, está
// expirado seguro y no vale la pena molestar al proxy (mz_et_dia = día del login).
function etDiaVencido() {
  try { const d = localStorage.getItem(ET_K.dia); return !!d && d !== hoyNY(); } catch (_) { return false; }
}
function etCreds() {
  try {
    const t = localStorage.getItem(ET_K.tok), s = localStorage.getItem(ET_K.sec);
    return (t && s) ? { token: t, token_secret: s } : null;
  } catch (_) { return null; }
}
function etGuardar(t, s) {
  try { localStorage.setItem(ET_K.tok, t); localStorage.setItem(ET_K.sec, s); } catch (_) {}
}
function etOlvidar() {
  try { Object.values(ET_K).forEach(k => localStorage.removeItem(k)); } catch (_) {}
}
// topeMs: solo para LECTURAS/login/renew (un fetch colgado dejaría la cadena o
// Cuentas mudas hasta 60 s). Las órdenes NO llevan tope: abortar un place en
// el cliente dejaría la orden en estado indeterminado.
async function etProxy(path, body, topeMs) {
  if (!PROXY_URL) throw new Error('proxy sin configurar');
  const ctl = (topeMs && typeof AbortController !== 'undefined') ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), topeMs) : null;
  try {
    const r = await fetch(PROXY_URL + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), signal: ctl ? ctl.signal : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('el proxy no respondió a tiempo');
    throw e;
  } finally { if (t) clearTimeout(t); }
}
const ET_TOPE_MS = 25000;

// Lectura E*TRADE con auto-renovación: si el token quedó INACTIVO (>2 h sin
// uso) E*TRADE responde 401; renew_access_token lo reactiva sin login. Muere
// de verdad a medianoche ET (ahí sí toca reconectar). Si E*TRADE RECHAZA la
// renovación y la lectura sigue en 401, el token está muerto: se marca
// (mz_et_dia = 'muerto') para que toda la app deje de insistir hasta reconectar
// (un token de antes de v21 no tenía fecha guardada y nunca se daba por vencido).
let _etRenovando = null;                 // una sola renovación aunque haya lecturas en paralelo
// true: reactivado · false: E*TRADE RECHAZÓ el token (4xx explícito) · null: no se
// pudo saber (proxy caído/5xx, E*TRADE 5xx/429, sin red, tiempo agotado). Solo el
// `false` autoriza dar el token por muerto: un 5xx del renew con token vivo no
// debe dejar la app pidiendo reconectar.
function etRenovar(cr) {
  if (!_etRenovando) {
    _etRenovando = etProxy('/etrade/renew', { token: cr.token, token_secret: cr.token_secret }, ET_TOPE_MS)
      .then(r => {
        const d = r && r.status === 200 && r.data;
        if (!d || typeof d.ok !== 'boolean') return null;
        if (d.ok) return true;
        return [400, 401, 403].includes(Number(d.status)) ? false : null;
      }, () => null)
      .finally(() => { _etRenovando = null; });
  }
  return _etRenovando;
}
// Solo marca si el token que falló sigue siendo el guardado (un login nuevo
// mientras había trabajo en vuelo no debe quedar marcado como muerto).
function etMarcarMuerto(cr) {
  try {
    if (cr && cr.token && localStorage.getItem(ET_K.tok) !== cr.token) return;
    localStorage.setItem(ET_K.dia, 'muerto');
  } catch (_) {}
}
async function etRead(cr, path, query) {
  const leer = () => etProxy('/etrade/read', { ...cr, path, query: query || {} }, ET_TOPE_MS);
  let r = await leer();
  if (r.status === 401) {
    const renovado = await etRenovar(cr);
    r = await leer();
    if (r.status === 401 && renovado === false) etMarcarMuerto(cr);
  }
  return r;
}
// Mensaje de error de E*TRADE ({Error:{message}}) o del proxy ({error}), o null.
function etError(r) {
  const d = r && r.data;
  if (!d || typeof d !== 'object') return null;
  if (d.Error && d.Error.message) return String(d.Error.message);
  if (d.error) return String(d.error);
  return null;
}

// Trae el saldo de E*TRADE en vivo por el proxy y lo adapta al shape de snapshot.
// Devuelve: snapshot | {_expirado:true} (token muerto) | null (sin token / proxy
// inalcanzable). Cache 5 min (el saldo no cambia con el mercado cerrado).
async function etradeSaldo(forzar) {
  const cr = etCreds();
  if (!cr) return null;
  if (etDiaVencido()) return { _expirado: true };   // murió a medianoche ET: sin llamar al proxy
  if (!forzar) {
    try {
      const c = JSON.parse(localStorage.getItem(ET_K.cache) || 'null');
      if (c && Date.now() - c._ts < 300000) return c.snap;
    } catch (_) {}
  }
  try {
    const lst = await etRead(cr, '/v1/accounts/list.json');
    if (lst.status === 401) return { _expirado: true };
    if (etError(lst)) return null;
    const acc = (((lst.data || {}).AccountListResponse || {}).Accounts || {}).Account || [];
    const arr = Array.isArray(acc) ? acc : [acc];
    const a = arr.find(x => String(x.accountStatus || '').toUpperCase() !== 'CLOSED') || arr[0];
    if (!a || !a.accountIdKey) return null;
    const bal = await etRead(cr, `/v1/accounts/${encodeURIComponent(a.accountIdKey)}/balance.json`,
      { instType: a.institutionType || 'BROKERAGE', realTimeNAV: 'true' });
    if (bal.status === 401) return { _expirado: true };
    if (etError(bal)) return null;
    const b = (bal.data || {}).BalanceResponse || {};
    const comp = b.Computed || {};
    const rtv = comp.RealTimeValues || {};
    const num = String(a.accountId || '');
    const snap = {
      broker: 'etrade',
      numero_mascara: num ? num.slice(0, 3) + '***' + num.slice(-3) : '',
      saldo_neto: num2(rtv.totalAccountValue) ?? num2(comp.netAccountValue),
      efectivo: num2(comp.cashBalance) ?? num2(comp.settledCashForInvestment),
      poder_compra: num2(comp.cashBuyingPower) ?? num2(comp.marginBuyingPower),
      origen: 'dispositivo', capturado_at: new Date().toISOString(), _vivo: true,
    };
    try { localStorage.setItem(ET_K.cache, JSON.stringify({ _ts: Date.now(), snap })); } catch (_) {}
    etradeGuardarSnapshot(snap);
    return snap;
  } catch (_) {
    return { _sinRed: true };  // proxy inalcanzable / fetch cortado por iOS: NO es «sin token» → Cuentas ofrece reintentar, no Conectar
  }
}

async function conectarEtrade() {
  if (!PROXY_URL) { toast('Falta configurar el proxy'); return; }
  // iOS Safari solo deja abrir pestañas DENTRO del toque (no después de un
  // await): se abre vacía ya mismo y se le pone la URL cuando responda el proxy.
  // Si igual no se abre, el modal del PIN trae un enlace para abrirla a mano.
  let w = null;
  try {
    w = window.open('', '_blank');
    if (w) {
      w.opener = null;
      // que la hoja en blanco diga algo mientras responde el proxy (1-4 s)
      try { w.document.write('<p style="font-family:-apple-system,system-ui;padding:28px;color:#555">Conectando con E*TRADE…</p>'); } catch (_) {}
    }
  } catch (_) { w = null; }
  const cerrarVacia = () => { if (w) { try { w.close(); } catch (_) {} } };
  toast('Preparando login de E*TRADE…');
  let r;
  try { r = await etProxy('/etrade/login/start', {}, ET_TOPE_MS); }
  catch (_) { cerrarVacia(); toast('No pude contactar el proxy (¿Funnel activo?)'); return; }
  const d = r.data || {};
  if (!d.authorize_url) { cerrarVacia(); toast('E*TRADE no respondió: ' + (d.error || 'error')); return; }
  let abierta = false;
  if (w && !w.closed) { try { w.location.href = d.authorize_url; abierta = true; } catch (_) {} }
  // el login queda anotado 9 min: si iOS recarga la PWA mientras estás en E*TRADE,
  // al volver se vuelve a ofrecer el cuadro del código (el request token vive 10 min en el proxy)
  try { localStorage.setItem(ET_K.login, JSON.stringify({ rt: d.rt, url: d.authorize_url, ts: Date.now() })); } catch (_) {}
  modalPin(d.rt, d.authorize_url, abierta);
}
const ET_LOGIN_TTL = 9 * 60 * 1000;
function etLoginOlvidar() { try { localStorage.removeItem(ET_K.login); } catch (_) {} }
// Al arrancar: si había un login de E*TRADE a medias (PWA recargada en medio del
// 2FA), se vuelve a mostrar el cuadro del código en vez de obligar a empezar de cero.
function reanudarLoginEtrade() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(ET_K.login) || 'null'); } catch (_) {}
  if (!p || !p.rt) return;
  if (!(Date.now() - (p.ts || 0) < ET_LOGIN_TTL)) { etLoginOlvidar(); return; }
  if ($('#modalPin')) return;
  if (etCreds() && !etDiaVencido()) { etLoginOlvidar(); return; }   // ya hay sesión válida
  modalPin(p.rt, p.url, false);
  toast('Tenías un login de E*TRADE a medias: pega el código o cancela');
}
function modalPin(rt, url, abierta) {
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalPin';
  m.innerHTML = `<div class="hoja">
    <h3 style="margin:0 0 6px">Conectar E*TRADE</h3>
    <div class="mut" style="font-size:12.5px;line-height:1.45">${abierta ? 'Se abrió E*TRADE en otra pestaña.' : 'Abre E*TRADE con el botón de abajo.'} Inicia sesión, <b>autoriza el acceso</b> y copia el <b>código de verificación</b> que te muestra. Pégalo aquí:</div>
    ${url ? `<div style="margin:8px 0 2px"><a class="btnsec" href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;padding:7px 12px">Abrir E*TRADE ↗</a> <span class="mut" style="font-size:11.5px">${abierta ? '(si no se abrió sola)' : ''}</span></div>` : ''}
    <label>Código de verificación</label>
    <input id="etPin" inputmode="numeric" autocomplete="off" placeholder="pega el código" style="text-align:center;letter-spacing:.12em;font-size:16px">
    <div class="err" id="etErr"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.pinCancelar()">Cancelar</button>
      <button class="pri" onclick="MZ.pinEnviar('${esc(rt)}')">Conectar</button></div>
  </div>`;
  document.body.appendChild(m);
  setTimeout(() => { const i = $('#etPin'); if (i) i.focus(); }, 60);
}
async function etradePinEnviar(rt) {
  const pin = ($('#etPin').value || '').trim();
  const err = $('#etErr');
  if (!pin) { err.textContent = 'Pega el código de verificación.'; return; }
  err.textContent = 'Conectando…';
  let r;
  try { r = await etProxy('/etrade/login/finish', { rt, pin }); }
  catch (_) { err.textContent = 'No pude contactar el proxy.'; return; }
  const d = r.data || {};
  if (!d.token) { err.textContent = d.error || 'No pude conectar. Revisa el código.'; return; }
  etGuardar(d.token, d.token_secret);
  etLoginOlvidar();
  const m = $('#modalPin'); if (m) m.remove();
  try {
    localStorage.setItem(ET_K.dia, hoyNY());   // el token vale solo hasta medianoche ET
    localStorage.removeItem(ET_K.sync);        // fuerza sincronizar historial
    localStorage.removeItem(ET_K.cache);
  } catch (_) {}
  toast('E*TRADE conectada ✓');
  if (_ord && $('#modalOrden')) { cargarCadena(true); return; }   // reconectó desde el formulario de orden: la cadena sigue ahí
  ruta();
}

// ---------- Historial E*TRADE: transacciones → round-trips → Supabase ----------
// Las transacciones se traen desde ESTE dispositivo (el token vive aquí) y los
// round-trips ya emparejados se guardan en broker_trades (RLS: solo tú). Así el
// historial persiste aunque la sesión diaria de E*TRADE muera y se ve en todos
// tus equipos. Mismo emparejado FIFO por contrato que tasty (tasty_cuenta.py).
const ET_SYNC_TTL = 10 * 60 * 1000;
const ET_DIAS_HIST = 180;

function emparejarEtrade(txs) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  // transactionDate de E*TRADE es FECHA (medianoche): dentro del mismo día las
  // compras van antes que las ventas (una venta nunca precede a su compra), y el
  // desempate respeta el orden real del listado (E*TRADE lo devuelve DESC).
  const lado = (t) => {
    const tipo = String(t.transactionType || '').toLowerCase();
    const dv = /sold|sell|expir|assign|exercis/.test(tipo), dc = /bought|buy/.test(tipo);
    return (dc || (!dv && num(t.brokerage.quantity) > 0)) ? 0 : 1;
  };
  const ops = (txs || []).map((t, i) => ({ t, i })).filter(x => x.t && x.t.brokerage && x.t.brokerage.product
    && String(x.t.brokerage.product.securityType || '').toUpperCase() === 'OPTN');
  ops.sort((a, b) => num(a.t.transactionDate) - num(b.t.transactionDate)
    || lado(a.t) - lado(b.t) || (b.i - a.i) || num(a.t.transactionId) - num(b.t.transactionId));
  const abiertos = {}, salidas = [];
  for (const { t } of ops) {
    const p = t.brokerage.product, b = t.brokerage;
    const right = String(p.callPut || '').toUpperCase() === 'PUT' ? 'PUT' : 'CALL';
    const strike = num(p.strikePrice);
    // E*TRADE manda expiryYear con 2 dígitos (26 = 2026): normalizar a 4.
    const y0 = num(p.expiryYear), anio = y0 > 0 && y0 < 100 ? 2000 + y0 : y0;
    const exp = (anio && p.expiryMonth && p.expiryDay)
      ? `${anio}-${String(p.expiryMonth).padStart(2, '0')}-${String(p.expiryDay).padStart(2, '0')}` : null;
    const contrato = `${p.symbol}|${exp}|${right}|${strike}`;
    const qty = Math.abs(num(b.quantity));
    if (!qty) continue;
    const tipo = String(t.transactionType || '').toLowerCase();
    const fee = Math.abs(num(b.fee));
    const ts = new Date(num(t.transactionDate)).toISOString();
    // La dirección la manda el TIPO ('Bought To Open', 'Sold To Close', 'Option
    // Expired'); el signo de quantity solo desempata si el tipo no lo dice
    // (E*TRADE puede reportar la cantidad siempre positiva).
    const diceVenta = /sold|sell|expir|assign|exercis/.test(tipo);
    const diceCompra = /bought|buy/.test(tipo);
    const esCompra = diceCompra || (!diceVenta && num(b.quantity) > 0);
    const esExpira = /expir/.test(tipo);
    const esVenta = !esCompra && (diceVenta || num(b.quantity) < 0);
    const precio = esExpira ? 0 : Math.abs(num(b.price));
    if (esCompra) { (abiertos[contrato] = abiertos[contrato] || []).push({ qty, precio, ts, fee, id: t.transactionId }); continue; }
    if (!esVenta) continue;
    let rest = qty; const cola = abiertos[contrato] || [];
    while (rest > 0 && cola.length) {
      const ap = cola[0], usa = Math.min(rest, ap.qty);
      const feeAp = ap.fee * (ap.qty ? usa / ap.qty : 1), feeCi = fee * (usa / qty);
      salidas.push({
        broker: 'etrade', symbol: p.symbol, osi: contrato, direccion: right, strike, expiracion: exp,
        contratos: usa, prima_fill: ap.precio, prima_salida: precio,
        abierta_at: ap.ts, cerrada_at: ts,
        resultado_usd: Math.round(((precio - ap.precio) * usa * 100 - feeAp - feeCi) * 100) / 100,
        fees: Math.round((feeAp + feeCi) * 100) / 100,
        // Clave por IDs de transacción (las fechas de E*TRADE no traen hora:
        // dos round-trips iguales el mismo día colisionaban y se perdía uno).
        clave_ext: `${contrato}#${ap.id}>${t.transactionId}#${usa}`,
        raw: { abre: ap.id, cierra: t.transactionId, tipo: t.transactionType },
      });
      ap.qty -= usa; ap.fee -= feeAp; rest -= usa;   // la comisión restante viaja con el resto del lote
      if (ap.qty <= 1e-9) cola.shift();
    }
  }
  return salidas;
}

async function etradeTransacciones(cr, accountIdKey, dias) {
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${d.getFullYear()}`;
  const hoy = new Date(), desde = new Date(Date.now() - dias * 86400000);
  let marker = null, todas = [], vueltas = 0;
  do {
    const query = { startDate: fmt(desde), endDate: fmt(hoy), count: '50', sortOrder: 'DESC' };
    if (marker) query.marker = marker;
    const r = await etRead(cr, `/v1/accounts/${encodeURIComponent(accountIdKey)}/transactions.json`, query);
    if (r.status === 401) return { expirado: true, txs: todas };
    if (r.status === 204) break;                       // sin transacciones en el rango
    const em = etError(r);
    if (em || r.status >= 400) return { error: em || ('HTTP ' + r.status), txs: todas };
    const L = (r.data || {}).TransactionListResponse || {};
    const arr = Array.isArray(L.Transaction) ? L.Transaction : (L.Transaction ? [L.Transaction] : []);
    todas = todas.concat(arr);
    marker = null;
    // E*TRADE puede decir moreTransactions=false aunque totalCount > lo
    // recibido; se pagina mientras falten y haya con qué (next/marker/último id).
    const total = Number(L.totalCount) || 0;
    const faltan = L.moreTransactions === true || (total > todas.length);
    if (faltan && arr.length) {
      try { marker = L.next ? new URL(L.next, 'https://api.etrade.com').searchParams.get('marker') : null; } catch (_) { marker = null; }
      if (!marker && L.marker && String(L.marker) !== String(query.marker || '')) marker = String(L.marker);
      if (!marker) marker = String(arr[arr.length - 1].transactionId || '');
      if (marker === String(query.marker || '')) marker = null;   // sin avance → parar
    }
    vueltas++;
  } while (marker && vueltas < 40);
  return { expirado: false, txs: todas, dias };
}

// Sincroniza (con tope de 10 min por dispositivo). Devuelve el resumen para la
// vista y `cambio` = true si escribió algo nuevo (para re-dibujar).
// Guarda de concurrencia: si ya hay una sincronización en vuelo (la vista se
// re-dibuja por Realtime, el timer o «sincronizar»), todos esperan la misma.
let _etSyncEnVuelo = null;
function etradeSincronizar(forzar) {
  if (_etSyncEnVuelo) return _etSyncEnVuelo;
  _etSyncEnVuelo = etradeSincronizarImpl(forzar).finally(() => { _etSyncEnVuelo = null; });
  return _etSyncEnVuelo;
}
async function etradeSincronizarImpl(forzar) {
  const cr = etCreds();
  if (!cr) return { estado: 'sin' };
  if (etDiaVencido()) return { estado: 'expirado', cambio: false };   // sin llamar al proxy
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(ET_K.sync) || 'null'); } catch (_) {}
  if (!forzar && prev && Date.now() - prev.ts < ET_SYNC_TTL) return { ...prev.resumen, estado: prev.resumen.estado, cambio: false };
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  // Todo resultado (también expirado/error) se cachea con su hora: el tope de
  // 10 min evita martillar el proxy; reconectar E*TRADE borra el caché.
  const fin = (resumen) => {
    resumen.ts = Date.now();
    try { localStorage.setItem(ET_K.sync, JSON.stringify({ ts: resumen.ts, resumen })); } catch (_) {}
    // Diagnóstico a la bitácora del proxy: SOLO contadores/estado (jamás tokens ni trades).
    try { etProxy('/diag', { que: 'etrade_sync', uid: !!uid, ...resumen }).catch(() => {}); } catch (_) {}
    return resumen;
  };
  try {
    const lst = await etRead(cr, '/v1/accounts/list.json');
    if (lst.status === 401) return fin({ estado: 'expirado' });
    if (etError(lst)) return fin({ estado: 'error', detalle: etError(lst).slice(0, 80) });
    const acc = (((lst.data || {}).AccountListResponse || {}).Accounts || {}).Account || [];
    const arr = Array.isArray(acc) ? acc : [acc];
    const a = arr.find(x => String(x.accountStatus || '').toUpperCase() !== 'CLOSED') || arr[0];
    if (!a || !a.accountIdKey) return fin({ estado: 'error', detalle: 'sin cuenta' });
    let res = await etradeTransacciones(cr, a.accountIdKey, ET_DIAS_HIST);
    if (res.error && !res.expirado) res = await etradeTransacciones(cr, a.accountIdKey, 60);  // E*TRADE limita el rango
    if (res.expirado) return fin({ estado: 'expirado' });
    if (res.error) return fin({ estado: 'error', detalle: String(res.error).slice(0, 80) });
    const txs = res.txs, dias = res.dias;
    const ops = txs.filter(t => t && t.brokerage && t.brokerage.product
      && String(t.brokerage.product.securityType || '').toUpperCase() === 'OPTN').length;
    const rts = emparejarEtrade(txs);
    let nuevos = 0;
    if (rts.length && uid) {
      // Autolimpieza: filas con la clave vieja (formato con '|', sin IDs) se
      // reemplazan por el conjunto completo con clave por IDs.
      try { await sb.from('broker_trades').delete().eq('broker', 'etrade').not('clave_ext', 'like', '%#%'); } catch (_) {}
      const filas = rts.map(r => ({ ...r, user_id: uid }));
      const { error, data } = await sb.from('broker_trades')
        .upsert(filas, { onConflict: 'user_id,broker,clave_ext', ignoreDuplicates: true }).select('id');
      if (error) return fin({ estado: 'error', detalle: error.message });
      nuevos = (data || []).length;
    }
    const resumen = fin({ estado: 'ok', txs: txs.length, ops, rts: rts.length, nuevos, dias });
    return { ...resumen, cambio: nuevos > 0 };
  } catch (e) {
    return fin({ estado: 'error', detalle: (e && e.message) || 'fallo' });
  }
}

// Guarda la foto del saldo E*TRADE en la nube (origen 'dispositivo'): así se ve
// también desde otros equipos, con su fecha. Silencioso si falla.
async function etradeGuardarSnapshot(snap) {
  try {
    const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
    if (!uid || !snap) return;
    const { _vivo, ...fila } = snap;
    await sb.from('cuenta_snapshots').upsert({ ...fila, user_id: uid }, { onConflict: 'user_id,broker' });
  } catch (_) {}
}


// ═══════════════ Charles Schwab (OAuth 2.0 · token en ESTE dispositivo) ═══════════════
// Login SEMANAL: el refresh token vive 7 días; el access token 30 min y se
// renueva solo vía proxy (que solo aporta el app secret). Tras autorizar en la
// web de Schwab, la página oauth-schwab.html canjea el código y muestra un
// código de 6 dígitos que se pega aquí (la PWA del iPhone no comparte
// almacenamiento con Safari). Schwab NO tiene vista previa: la orden entra al enviar.
const SW_K = { tok: 'mz_sw_tok', ref: 'mz_sw_ref', exp: 'mz_sw_exp', refts: 'mz_sw_ref_ts', acct: 'mz_sw_acct', num: 'mz_sw_num', cache: 'mz_sw_cache', muerto: 'mz_sw_muerto', login: 'mz_sw_login' };
const SW_REFRESH_DIAS = 7;
function swCreds() {
  try {
    const t = localStorage.getItem(SW_K.tok), r = localStorage.getItem(SW_K.ref);
    return (t && r) ? { token: t, refresh: r, exp: Number(localStorage.getItem(SW_K.exp)) || 0, refts: Number(localStorage.getItem(SW_K.refts)) || 0 } : null;
  } catch (_) { return null; }
}
function swGuardar(d) {
  try {
    localStorage.setItem(SW_K.tok, d.token);
    if (d.refresh_token) localStorage.setItem(SW_K.ref, d.refresh_token);
    localStorage.setItem(SW_K.exp, String(Date.now() + (Number(d.expires_in) || 1800) * 1000 - 60000));
    if (d.nuevo_login) localStorage.setItem(SW_K.refts, String(Date.now()));
    localStorage.removeItem(SW_K.muerto); localStorage.removeItem(SW_K.cache);
  } catch (_) {}
}
function swOlvidar() { try { Object.values(SW_K).forEach(k => localStorage.removeItem(k)); localStorage.removeItem('mz_sw_sync'); } catch (_) {} }
// vencido: refresh token de más de 7 días, o Schwab rechazó la renovación
function swVencido() {
  try {
    if (localStorage.getItem(SW_K.muerto)) return true;
    const c = swCreds(); return !!c && c.refts > 0 && Date.now() - c.refts > SW_REFRESH_DIAS * 86400000;
  } catch (_) { return false; }
}
function swMarcarMuerto() { try { localStorage.setItem(SW_K.muerto, '1'); } catch (_) {} }
let _swRenovando = null;
// true: renovado · false: Schwab rechazó el refresh (login semanal caducado) · null: no se sabe
function swRenovar(cr) {
  if (!_swRenovando) {
    _swRenovando = etProxy('/schwab/refresh', { refresh_token: cr.refresh }, ET_TOPE_MS)
      .then(r => {
        const d = r && r.status === 200 && r.data;
        if (!d || typeof d.ok !== 'boolean') return null;
        if (d.ok && d.token) { swGuardar(d); return true; }
        return [400, 401, 403].includes(Number(d.status)) ? false : null;
      }, () => null)
      .finally(() => { _swRenovando = null; });
  }
  return _swRenovando;
}
async function swAccess() {
  const c = swCreds(); if (!c) return null;
  if (Date.now() < c.exp) return c.token;
  const ok = await swRenovar(c);
  if (ok === false) { swMarcarMuerto(); return null; }
  const c2 = swCreds(); return c2 ? c2.token : null;
}
async function swLlamar(path, body, topeMs) {
  const tok = await swAccess();
  if (!tok) return { status: 401, data: { error: swVencido() ? 'login semanal de Schwab caducado' : 'Schwab sin sesión' } };
  const llamar = (t) => etProxy(path, Object.assign({ token: t }, body || {}), topeMs);
  let r = await llamar(tok);
  if (r.status === 401) {
    const c = swCreds(); const renovado = c ? await swRenovar(c) : false;
    if (renovado === false) swMarcarMuerto();
    const c2 = swCreds(); if (c2 && renovado) r = await llamar(c2.token);
  }
  return r;
}
function swRead(path, query) { return swLlamar('/schwab/read', { path, query: query || {} }, ET_TOPE_MS); }
async function swPost(path, body) {                    // órdenes: sin tope (abortar un place = indeterminado)
  try { return await swLlamar(path, body); }
  catch (_) { throw new Error('No pude contactar el proxy (¿Funnel activo?).'); }
}
function swMensajeError(r) {
  const d = r && r.data; if (!d || typeof d !== 'object') return null;
  if (d.error) return String(d.error);
  if (d.message) return String(d.message);
  if (Array.isArray(d.errors) && d.errors.length) return d.errors.map(e => (e && (e.message || e.title || e.detail)) || JSON.stringify(e)).join(' · ');
  return null;
}
// hash de la cuenta (las órdenes y saldos de Schwab usan el hash, no el número)
async function swCuenta() {
  try { const k = localStorage.getItem(SW_K.acct); if (k) return k; } catch (_) {}
  const r = await swRead('/trader/v1/accounts/accountNumbers');
  if (r.status === 401) throw new Error('La sesión de Schwab caducó. Reconecta en Cuentas → Schwab.');
  const em = swMensajeError(r); if (em) throw new Error('Schwab: ' + em);
  const arr = Array.isArray(r.data) ? r.data : [];
  if (!arr.length || !arr[0].hashValue) throw new Error('Schwab no devolvió ninguna cuenta.');
  const elegida = arr.length > 1 ? await elegirCuentaSchwab(arr) : arr[0];   // varias cuentas: el usuario elige (no la primera a ciegas)
  if (!elegida) throw new Error('No elegiste cuenta de Schwab.');
  try { localStorage.setItem(SW_K.acct, elegida.hashValue); localStorage.setItem(SW_K.num, String(elegida.accountNumber || '')); localStorage.removeItem(SW_K.cache); } catch (_) {}
  return elegida.hashValue;
}
const mascaraCuenta = (num) => { num = String(num || ''); return num ? num.slice(0, 2) + '***' + num.slice(-3) : ''; };
function elegirCuentaSchwab(cuentas) {
  return new Promise((resolve) => {
    const prev = $('#modalSwCta'); if (prev) prev.remove();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalSwCta'; m.style.zIndex = 60;
    m.innerHTML = `<div class="hoja">
      <h3 style="margin:0 0 4px">¿Qué cuenta de Schwab usa la Mesa?</h3>
      <div class="mut" style="margin-bottom:8px">Saldos, presupuesto y órdenes irán a la cuenta que elijas (puedes cambiarla en Cuentas).</div>
      ${cuentas.map((c, i) => `<button class="btnsec" style="margin-top:6px;padding:12px" data-i="${i}">Cuenta ${esc(mascaraCuenta(c.accountNumber))}</button>`).join('')}
      <button class="btnsec" style="margin-top:10px" data-i="-1">Cancelar</button>
    </div>`;
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]'); if (!b) return;
      const i = Number(b.getAttribute('data-i')); m.remove(); resolve(i >= 0 ? cuentas[i] : null);
    });
    document.body.appendChild(m);
  });
}
async function swCambiarCuenta() {
  try { localStorage.removeItem(SW_K.acct); localStorage.removeItem(SW_K.num); localStorage.removeItem(SW_K.cache); } catch (_) {}
  try { await swCuenta(); toast('Cuenta de Schwab elegida'); } catch (e) { toast(String((e && e.message) || e)); }
  ruta();
}
// Saldo en vivo de Schwab (caché 5 min). snapshot | {_expirado} | {_sinRed} | null
async function schwabSaldo(forzar) {
  const cr = swCreds(); if (!cr) return null;
  if (swVencido()) return { _expirado: true };
  if (!forzar) { try { const c = JSON.parse(localStorage.getItem(SW_K.cache) || 'null'); if (c && Date.now() - c._ts < 300000) return c.snap; } catch (_) {} }
  try {
    const hash = await swCuenta();
    const r = await swRead(`/trader/v1/accounts/${encodeURIComponent(hash)}`);
    if (r.status === 401) return { _expirado: true };
    if (swMensajeError(r)) return null;
    const sa = (r.data || {}).securitiesAccount || {}; const bal = sa.currentBalances || {}; const ini = sa.initialBalances || {};
    let num = ''; try { num = localStorage.getItem(SW_K.num) || ''; } catch (_) {}
    const snap = {
      broker: 'schwab', numero_mascara: num ? num.slice(0, 2) + '***' + num.slice(-3) : '',
      saldo_neto: num2(bal.liquidationValue) ?? num2(ini.liquidationValue),
      efectivo: num2(bal.cashBalance) ?? num2(bal.availableFunds),
      poder_compra: num2(bal.buyingPower) ?? num2(bal.availableFunds) ?? num2(bal.cashAvailableForTrading),
      origen: 'dispositivo', capturado_at: new Date().toISOString(), _vivo: true,
    };
    try { localStorage.setItem(SW_K.cache, JSON.stringify({ _ts: Date.now(), snap })); } catch (_) {}
    etradeGuardarSnapshot(snap);   // upsert por (user_id, broker): vale para cualquier bróker
    return snap;
  } catch (e) {
    if (/caducó|sin sesión/i.test(String(e && e.message))) return { _expirado: true };
    return { _sinRed: true };
  }
}
async function conectarSchwab() {
  if (!PROXY_URL) { toast('Falta configurar el proxy'); return; }
  let w = null;
  try {
    w = window.open('', '_blank');
    if (w) { w.opener = null; try { w.document.write('<p style="font-family:-apple-system,system-ui;padding:28px;color:#555">Conectando con Charles Schwab…</p>'); } catch (_) {} }
  } catch (_) { w = null; }
  const cerrarVacia = () => { if (w) { try { w.close(); } catch (_) {} } };
  toast('Preparando login de Schwab…');
  let r;
  try { r = await etProxy('/schwab/login/start', {}, ET_TOPE_MS); }
  catch (_) { cerrarVacia(); toast('No pude contactar el proxy (¿Funnel activo?)'); return; }
  const d = r.data || {};
  if (!d.authorize_url) { cerrarVacia(); toast('Schwab no disponible: ' + (d.error || 'error')); return; }
  // el secreto de reclamo vive SOLO en este equipo: el código de 6 dígitos no sirve sin él
  try { localStorage.setItem(SW_K.login, JSON.stringify({ state: d.state, claim_secret: d.claim_secret, ts: Date.now() })); } catch (_) {}
  let abierta = false;
  if (w && !w.closed) { try { w.location.href = d.authorize_url; abierta = true; } catch (_) {} }
  modalCodigoSchwab(d.authorize_url, abierta);
}
function modalCodigoSchwab(url, abierta) {
  const prev = $('#modalSw'); if (prev) prev.remove();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalSw';
  m.innerHTML = `<div class="hoja">
    <h3 style="margin:0 0 6px">Conectar Charles Schwab</h3>
    <div class="mut" style="font-size:12.5px;line-height:1.45">${abierta ? 'Se abrió Schwab en otra pestaña.' : 'Abre Schwab con el botón de abajo.'} Entra con tu cuenta de <b>brokerage</b> (no la de developer), autoriza tus cuentas y al final verás un <b>código de 6 dígitos</b>. Pégalo aquí:</div>
    ${url ? `<div style="margin:8px 0 2px"><a class="btnsec" href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;padding:7px 12px">Abrir Schwab ↗</a> <span class="mut" style="font-size:11.5px">${abierta ? '(si no se abrió sola)' : ''}</span></div>` : ''}
    <label>Código de conexión</label>
    <input id="swCod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 dígitos" style="text-align:center;letter-spacing:.2em;font-size:18px">
    <div class="err" id="swErr"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.swCancelar()">Cancelar</button>
      <button class="pri" onclick="MZ.swEnviar()">Conectar</button></div>
  </div>`;
  document.body.appendChild(m);
  setTimeout(() => { const i = $('#swCod'); if (i) i.focus(); }, 60);
  // si el login terminó en ESTE navegador (Mac), la página de retorno ya dejó el token: cerrar solo
  const t0 = Date.now();
  const esperar = setInterval(() => {
    if (!$('#modalSw') || Date.now() - t0 > 900000) { clearInterval(esperar); return; }
    const c = swCreds();
    if (c && c.refts > t0 - 5000) { clearInterval(esperar); m.remove(); toast('Schwab conectada ✓'); if (_ord && $('#modalOrden')) cargarCadena(true); else ruta(); }
  }, 1500);
}
async function swCodigoEnviar() {
  const cod = ($('#swCod').value || '').trim(); const err = $('#swErr');
  if (!/^\d{6}$/.test(cod)) { err.textContent = 'Son 6 dígitos.'; return; }
  err.textContent = 'Conectando…';
  let login = null; try { login = JSON.parse(localStorage.getItem(SW_K.login) || 'null'); } catch (_) {}
  if (!login || !login.claim_secret) { err.textContent = 'Este equipo no inició la conexión: pulsa «Conectar» aquí y vuelve a autorizar (el código solo vale en el equipo que abrió Schwab).'; return; }
  let r; try { r = await etProxy('/schwab/login/claim', { handoff: cod, claim_secret: login.claim_secret }, ET_TOPE_MS); }
  catch (_) { err.textContent = 'No pude contactar el proxy.'; return; }
  const d = r.data || {};
  if (!d.token) { err.textContent = d.error || 'Código inválido o caducado (vale 5 min).'; return; }
  swGuardar(Object.assign({ nuevo_login: true }, d));
  try { localStorage.removeItem(SW_K.acct); localStorage.removeItem(SW_K.num); localStorage.removeItem(SW_K_SYNC); localStorage.removeItem(SW_K.login); } catch (_) {}
  const m = $('#modalSw'); if (m) m.remove();
  toast('Schwab conectada ✓');
  if (_ord && $('#modalOrden')) { cargarCadena(true); return; }
  ruta();
}
// símbolo OSI de Schwab: «SPY   260914C00769000» (subyacente a 6, yymmdd, C/P, strike×1000)
function osiDe(sym, exp, strike, lado) {
  const [y, m, d] = String(exp).split('-');
  const k = Math.round(Number(strike) * 1000);
  return String(sym).toUpperCase().padEnd(6, ' ') + y.slice(2) + m + d + (lado === 'PUT' ? 'P' : 'C') + String(k).padStart(8, '0');
}
function desOsi(osi) {
  const m = /^([A-Z.$]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(osi || '').trim().toUpperCase());
  if (!m) return null;
  return { symbol: m[1], expiracion: `20${m[2]}-${m[3]}-${m[4]}`, strike: Number(m[6]) / 1000, direccion: m[5] === 'P' ? 'PUT' : 'CALL' };
}
// Orden en el formato del Trader API de Schwab (una pierna). Precios como texto
// con 2 decimales (así los espera Schwab); el trailing stop en % sobre el MARK.
function construirOrdenSchwab(f) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const esEq = f.tipo === 'EQ', venta = f.accion === 'venta';
  const sym = String(f.symbol || '').trim().toUpperCase();
  const o = { orderType: f.priceType === 'TRAILING_STOP_PRCT' ? 'TRAILING_STOP' : f.priceType, session: 'NORMAL',
    duration: f.orderTerm === 'GTC' ? 'GOOD_TILL_CANCEL' : 'DAY', orderStrategyType: 'SINGLE' };
  if (!esEq) o.complexOrderStrategyType = 'NONE';
  if (f.priceType === 'LIMIT') o.price = n(f.limitPrice).toFixed(2);
  if (f.priceType === 'STOP') o.stopPrice = n(f.stopPrice).toFixed(2);
  if (f.priceType === 'STOP_LIMIT') { o.stopPrice = n(f.stopPrice).toFixed(2); o.price = n(f.limitPrice).toFixed(2); }
  if (f.priceType === 'TRAILING_STOP_PRCT') { o.stopPriceLinkBasis = 'MARK'; o.stopPriceLinkType = 'PERCENT'; o.stopPriceOffset = n(f.offsetValue); }
  o.orderLegCollection = [{ instruction: esEq ? (venta ? 'SELL' : 'BUY') : (venta ? 'SELL_TO_CLOSE' : 'BUY_TO_OPEN'), quantity: Math.floor(Number(f.cantidad)),
    instrument: esEq ? { symbol: sym, assetType: 'EQUITY' } : { symbol: osiDe(sym, f.expiracion, f.strike, f.tipo), assetType: 'OPTION' } }];
  return o;
}
// Fila de `ordenes` para una orden de Schwab, con las MISMAS columnas que E*TRADE
// (accion en el vocabulario de la Mesa: BUY_OPEN/SELL_CLOSE) para que el resto
// de la app (GTC automático, sincronización, tarjetas) no distinga brókeres.
function filaOrdenSchwab(f, orden, extra) {
  const leg = orden.orderLegCollection[0];
  const esEq = leg.instrument.assetType === 'EQUITY';
  const compra = leg.instruction === 'BUY_TO_OPEN' || leg.instruction === 'BUY';
  return Object.assign({
    broker: 'schwab', client_order_id: f.clientOrderId || clientOrderIdNuevo(), symbol: String(f.symbol || '').trim().toUpperCase(),
    security_type: esEq ? 'EQ' : 'OPTN', direccion: esEq ? null : (f.tipo === 'PUT' ? 'PUT' : 'CALL'),
    strike: esEq ? null : Number(f.strike), expiracion: esEq ? null : (f.expiracion || null),
    accion: compra ? (esEq ? 'BUY' : 'BUY_OPEN') : (esEq ? 'SELL' : 'SELL_CLOSE'),
    cantidad: leg.quantity, price_type: f.priceType,
    limit_price: orden.price != null ? Number(orden.price) : null,
    stop_price: orden.stopPrice != null ? Number(orden.stopPrice) : null,
    offset_value: orden.stopPriceOffset != null ? Number(orden.stopPriceOffset) : null,
    order_term: orden.duration === 'GOOD_TILL_CANCEL' ? 'GOOD_UNTIL_CANCEL' : 'GOOD_FOR_DAY',
  }, extra || {});
}
// Datos de mercado de Schwab → misma forma que los de E*TRADE (cadena/cotización/vencimientos)
function parsearCotizacionSchwab(resp, sym) {
  const d = (resp && resp.data) || {};
  const info = d[String(sym || '').toUpperCase()] || Object.values(d).find(v => v && typeof v === 'object' && v.quote) || {};
  const q = info.quote || {};
  return { last: num2(q.lastPrice) ?? num2(q.mark), bid: num2(q.bidPrice), ask: num2(q.askPrice),
    estado: info.quote ? (info.realtime === false ? 'DELAYED' : 'REALTIME') : '' };
}
function parsearVencimientosSchwab(resp) {
  const d = (resp && resp.data) || {};
  return (d.expirationList || []).map(e => ({ ymd: String(e.expirationDate || '').slice(0, 10),
    tipo: String(e.expirationType || '') === 'W' ? 'WEEKLY' : String(e.expirationType || ''), dte: e.daysToExpiration }))
    .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v.ymd));
}
function parsearCadenaSchwab(resp) {
  const d = (resp && resp.data) || {};
  const filas = {}; let exp = null;
  const lado = (mapa, campo) => {
    for (const [k, strikes] of Object.entries(mapa || {})) {
      if (!exp) exp = String(k).split(':')[0];
      for (const [kt, arr] of Object.entries(strikes || {})) {
        const c = Array.isArray(arr) ? arr[0] : arr; if (!c) continue;
        const st = Number(kt); if (!Number.isFinite(st)) continue;
        const f = filas[st] || (filas[st] = { strike: st, call: null, put: null });
        const dl = num2(c.delta);
        f[campo] = { simbolo: c.symbol, strike: st, bid: num2(c.bid), ask: num2(c.ask), last: num2(c.last), vol: num2(c.totalVolume), oi: num2(c.openInterest),
          delta: (dl != null && Math.abs(dl) <= 1) ? dl : null, itm: !!c.inTheMoney };
      }
    }
  };
  lado(d.callExpDateMap, 'call'); lado(d.putExpDateMap, 'put');
  return { filas: Object.values(filas).sort((a, b) => a.strike - b.strike), estado: d.isDelayed === true ? 'DELAYED' : (d.status ? 'REALTIME' : ''), near: num2(d.underlyingPrice), exp };
}
// Brókeres desde los que se puede operar en ESTE equipo (sesión viva)
function brokersOperables() {
  const out = [];
  if (etCreds() && !etDiaVencido()) out.push('etrade');
  if (swCreds() && !swVencido()) out.push('schwab');
  return out;
}
function subtituloBroker(b) {
  return b === 'schwab' ? 'Schwab no da vista previa: la revisas aquí y entra a tu cuenta al tocar «Enviar».'
    : 'Primero la vista previa de E*TRADE; nada se envía sin tu toque.';
}
function textoBotonPreview(b) { return b === 'schwab' ? 'Revisar orden' : 'Vista previa en E*TRADE'; }

function etradeLineaHistorial(s) {
  if (!s || s.estado === 'sin') return '';
  const sync = ` · <a href="#" onclick="MZ.etSync();return false" style="color:var(--oro)">sincronizar</a>`;
  if (s.estado === 'expirado') return 'historial: sesión de E*TRADE expirada — reconecta';
  if (s.estado === 'error') return 'historial: no pude sincronizar' + (s.detalle ? ' (' + esc(s.detalle) + ')' : '') + sync;
  if (s.estado === 'sincronizando') return 'historial: sincronizando…';
  const hace = s.ts ? haceCuanto(new Date(s.ts).toISOString()).txt : '';
  return `historial ${s.dias ? s.dias + ' d' : ''}: ${s.txs} transacciones · ${s.ops} de opciones · ${s.rts} round-trips${s.nuevos ? ' · ' + s.nuevos + ' nuevos' : ''}${hace ? ' · ' + hace : ''}${sync}`;
}
async function etSyncAhora() {
  try { localStorage.removeItem(ET_K.sync); } catch (_) {}
  toast('Sincronizando E*TRADE…');
  await etradeSincronizar(true);
  ruta();
}


// ---------- Historial Schwab: órdenes llenas → ejecuciones → round-trips → Supabase ----------
// Mismo camino que E*TRADE (token en ESTE dispositivo, round-trips en broker_trades
// con RLS) y el mismo método que la mesa local (SchwabBroker.fills): órdenes con
// status FILLED de opciones, precio/hora reales de cada ejecución si vienen
// (orderActivityCollection.executionLegs), si no los campos de la orden.
// Schwab acota el rango por consulta: se pide en tramos de 60 días hacia atrás.
const SW_DIAS_HIST = 180, SW_TRAMO_DIAS = 60;
const SW_K_SYNC = 'mz_sw_sync';

function fillsDeOrdenesSchwab(ordenes) {
  const out = [];
  for (const o of (Array.isArray(ordenes) ? ordenes : [])) {
    if (!o || String(o.status || '').toUpperCase() !== 'FILLED') continue;
    const leg = ((o.orderLegCollection || [])[0]) || {}; const inst = leg.instrument || {};
    if (String(inst.assetType || '').toUpperCase() !== 'OPTION') continue;
    const d = desOsi(inst.symbol); if (!d) continue;
    const side = /BUY/.test(String(leg.instruction || '').toUpperCase()) ? 'BUY' : 'SELL';
    const partes = [];
    for (const act of (o.orderActivityCollection || [])) for (const el of ((act && act.executionLegs) || [])) {
      const q = Number(el.quantity) || 0, px = Number(el.price);
      if (q > 0 && Number.isFinite(px)) partes.push({ qty: q, price: px, ts: el.time || o.closeTime || o.enteredTime });
    }
    if (!partes.length) {
      const q = Number(o.filledQuantity) || 0, px = Number(o.price);
      if (q > 0 && Number.isFinite(px)) partes.push({ qty: q, price: px, ts: o.closeTime || o.enteredTime });
    }
    partes.forEach((pt, i) => {
      const t = new Date(pt.ts || 0); if (Number.isNaN(t.getTime())) return;
      out.push({ osi: String(inst.symbol).trim(), symbol: d.symbol, expiracion: d.expiracion, direccion: d.direccion, strike: d.strike,
        side, qty: pt.qty, price: pt.price, ts: t.toISOString(), fee: 0, id: `${o.orderId}${partes.length > 1 ? '.' + i : ''}` });
    });
  }
  return out;
}
// Ejecuciones {osi, symbol, expiracion, direccion, strike, side, qty, price, ts, fee, id}
// → round-trips FIFO por contrato (el mismo criterio que E*TRADE, tasty y moomoo).
// Schwab no manda comisiones en las órdenes: fees = 0 (igual que moomoo).
function emparejarFillsSchwab(fills) {
  const orden = (fills || []).slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1
    : (a.side === 'BUY' && b.side !== 'BUY') ? -1 : (a.side !== 'BUY' && b.side === 'BUY') ? 1 : String(a.id).localeCompare(String(b.id))));
  const abiertos = {}, salidas = [];
  for (const f of orden) {
    if (f.side === 'BUY') { (abiertos[f.osi] = abiertos[f.osi] || []).push({ qty: f.qty, precio: f.price, ts: f.ts, fee: f.fee || 0, id: f.id }); continue; }
    let rest = f.qty; const cola = abiertos[f.osi] || [];
    while (rest > 0 && cola.length) {
      const ap = cola[0], usa = Math.min(rest, ap.qty);
      const feeAp = ap.fee * (ap.qty ? usa / ap.qty : 1), feeCi = (f.fee || 0) * (f.qty ? usa / f.qty : 1);
      salidas.push({ broker: 'schwab', symbol: f.symbol, osi: f.osi, direccion: f.direccion, strike: f.strike, expiracion: f.expiracion,
        contratos: usa, prima_fill: ap.precio, prima_salida: f.price, abierta_at: ap.ts, cerrada_at: f.ts,
        resultado_usd: Math.round(((f.price - ap.precio) * usa * 100 - feeAp - feeCi) * 100) / 100,
        fees: Math.round((feeAp + feeCi) * 100) / 100,
        clave_ext: `${f.osi}#${ap.id}>${f.id}#${usa}`,
        raw: { abre: ap.id, cierra: f.id } });
      ap.qty -= usa; ap.fee -= feeAp; rest -= usa;
      if (ap.qty <= 1e-9) cola.shift();
    }
  }
  return salidas;
}
// Órdenes de Schwab en tramos de 60 días hacia atrás (hasta `dias`). Si un tramo
// antiguo falla (Schwab limita la antigüedad), se conserva lo ya traído.
async function schwabOrdenesHistoricas(hash, dias) {
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const ordenes = []; let hasta = new Date(), cubiertos = 0;
  while (cubiertos < dias) {
    const desde = new Date(hasta.getTime() - SW_TRAMO_DIAS * 86400000);
    const r = await swLlamar('/schwab/ordenes', { hash, query: { fromEnteredTime: iso(desde), toEnteredTime: iso(hasta), maxResults: 3000 } }, ET_TOPE_MS);
    if (r.status === 401) return { expirado: true, ordenes, dias: cubiertos };
    const em = swMensajeError(r);
    if (em || r.status >= 400 || !Array.isArray(r.data)) {
      if (!cubiertos) return { error: em || ('HTTP ' + r.status), ordenes, dias: 0 };
      break;
    }
    ordenes.push(...r.data);
    hasta = desde; cubiertos += SW_TRAMO_DIAS;
  }
  return { expirado: false, ordenes, dias: Math.min(cubiertos, dias) };
}
let _swSyncEnVuelo = null;
function schwabSincronizar(forzar) {
  if (_swSyncEnVuelo) return _swSyncEnVuelo;
  _swSyncEnVuelo = schwabSincronizarImpl(forzar).finally(() => { _swSyncEnVuelo = null; });
  return _swSyncEnVuelo;
}
async function schwabSincronizarImpl(forzar) {
  if (!swCreds()) return { estado: 'sin' };
  if (swVencido()) return { estado: 'expirado', cambio: false };
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(SW_K_SYNC) || 'null'); } catch (_) {}
  if (!forzar && prev && Date.now() - prev.ts < ET_SYNC_TTL) return { ...prev.resumen, cambio: false };
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  const fin = (resumen) => {
    resumen.ts = Date.now();
    try { localStorage.setItem(SW_K_SYNC, JSON.stringify({ ts: resumen.ts, resumen })); } catch (_) {}
    try { etProxy('/diag', { que: 'schwab_sync', uid: !!uid, ...resumen }).catch(() => {}); } catch (_) {}   // solo contadores, jamás tokens
    return resumen;
  };
  try {
    const hash = await swCuenta();
    const res = await schwabOrdenesHistoricas(hash, SW_DIAS_HIST);
    if (res.expirado) return fin({ estado: 'expirado' });
    if (res.error) return fin({ estado: 'error', detalle: String(res.error).slice(0, 80) });
    const fills = fillsDeOrdenesSchwab(res.ordenes);
    const rts = emparejarFillsSchwab(fills);
    let nuevos = 0;
    if (rts.length && uid) {
      const { error, data } = await sb.from('broker_trades')
        .upsert(rts.map(r => ({ ...r, user_id: uid })), { onConflict: 'user_id,broker,clave_ext', ignoreDuplicates: true }).select('id');
      if (error) return fin({ estado: 'error', detalle: String(error.message || error).slice(0, 80) });
      nuevos = (data || []).length;
    }
    const llenas = res.ordenes.filter(o => o && String(o.status || '').toUpperCase() === 'FILLED').length;
    const resumen = fin({ estado: 'ok', ordenes: llenas, fills: fills.length, rts: rts.length, nuevos, dias: res.dias });
    return { ...resumen, cambio: nuevos > 0 };
  } catch (e) {
    if (/caducó|sin sesión/i.test(String(e && e.message))) return fin({ estado: 'expirado' });
    return fin({ estado: 'error', detalle: String((e && e.message) || 'fallo').slice(0, 80) });
  }
}
function schwabLineaHistorial(s) {
  if (!s || s.estado === 'sin') return '';
  const sync = ` · <a href="#" onclick="MZ.swSync();return false" style="color:var(--oro)">sincronizar</a>`;
  if (s.estado === 'expirado') return 'historial: login semanal de Schwab caducado — reconecta';
  if (s.estado === 'error') return 'historial: no pude sincronizar' + (s.detalle ? ' (' + esc(s.detalle) + ')' : '') + sync;
  if (s.estado === 'sincronizando') return 'historial: sincronizando…';
  const hace = s.ts ? haceCuanto(new Date(s.ts).toISOString()).txt : '';
  return `historial ${s.dias ? s.dias + ' d' : ''}: ${s.ordenes} órdenes llenas · ${s.fills} ejecuciones de opciones · ${s.rts} round-trips${s.nuevos ? ' · ' + s.nuevos + ' nuevos' : ''}${hace ? ' · ' + hace : ''}${sync}`;
}
async function swSyncAhora() {
  try { localStorage.removeItem(SW_K_SYNC); } catch (_) {}
  toast('Sincronizando Schwab…');
  await schwabSincronizar(true);
  ruta();
}

async function vistaCuentas() {
  const [posR, btR, csR] = await Promise.all([
    sb.from('posiciones').select('*'),
    sb.from('broker_trades').select('*'),
    sb.from('cuenta_snapshots').select('*'),
  ]);
  const manual = (posR.data || []).filter(p => p.estado === 'cerrada' || p.estado === 'expirada')
    .map(p => ({ ...p, _fuente: 'manual' }));
  // los round-trips del bróker se normalizan al mismo shape del historial
  const delBroker = (btR.data || []).map(t => ({
    ...t, estado: 'cerrada', _fuente: t.broker,
    abierta_fecha_ny: (t.cerrada_at || '').slice(0, 10),
  }));
  const cerradas = [...manual, ...delBroker].sort((a, b) =>
    (b.cerrada_at || '').localeCompare(a.cerrada_at || ''));
  const saldos = [...(csR.data || [])];
  // E*TRADE vive en el dispositivo (opción B): su saldo se trae en vivo por el
  // proxy; si hay una foto guardada desde otro equipo, la viva la reemplaza.
  const etSnap = await etradeSaldo();
  const etExpirado = !!(etSnap && etSnap._expirado);
  const etSinRed = !!(etSnap && etSnap._sinRed);     // proxy inalcanzable o fetch cortado por iOS: hay token, no hay lectura
  if (etSnap && !etSnap._expirado && !etSnap._sinRed) {
    const i = saldos.findIndex(x => x.broker === 'etrade');
    if (i >= 0) saldos[i] = etSnap; else saldos.push(etSnap);
  }
  // Schwab (token semanal en este dispositivo): mismo tratamiento que E*TRADE
  const swSnap = await schwabSaldo();
  const swExpirado = !!(swSnap && swSnap._expirado), swSinRed = !!(swSnap && swSnap._sinRed);
  if (swSnap && !swSnap._expirado && !swSnap._sinRed) {
    const i = saldos.findIndex(x => x.broker === 'schwab');
    if (i >= 0) saldos[i] = swSnap; else saldos.push(swSnap);
  }
  // Historial E*TRADE: se muestra el resumen cacheado y se sincroniza en segundo
  // plano; se re-dibuja al terminar (el tope de 10 min evita bucles).
  let etHist = null, swHist = null;
  try { const p = JSON.parse(localStorage.getItem(ET_K.sync) || 'null'); etHist = p ? p.resumen : null; } catch (_) {}
  if (etCreds() && !etExpirado) {
    const enCurso = !etHist || Date.now() - (etHist.ts || 0) >= ET_SYNC_TTL;
    if (enCurso) etHist = { estado: 'sincronizando' };
    // Solo se re-dibuja si el usuario sigue en Cuentas (la sincronización tarda).
    const enCuentas = () => (location.hash.replace('#/', '') || 'informe') === 'cuentas';
    etradeSincronizar().then(s => { if (s && (s.cambio || enCurso) && enCuentas()) vistaCuentas(); });
  }
  // Historial Schwab: mismo esquema (resumen cacheado, sincroniza en segundo plano).
  try { const p = JSON.parse(localStorage.getItem(SW_K_SYNC) || 'null'); swHist = p ? p.resumen : null; } catch (_) {}
  if (swCreds() && !swExpirado) {
    const enCursoSw = !swHist || Date.now() - (swHist.ts || 0) >= ET_SYNC_TTL;
    if (enCursoSw) swHist = { estado: 'sincronizando' };
    const enCuentasSw = () => (location.hash.replace('#/', '') || 'informe') === 'cuentas';
    schwabSincronizar().then(s => { if (s && (s.cambio || enCursoSw) && enCuentasSw()) vistaCuentas(); });
  }
  let h = '';

  // ---- saldos de brókeres ----
  const total = saldos.reduce((s, c) => s + (Number(c.saldo_neto) || 0), 0);
  h += `<div class="card">
    <div class="mut" style="font-size:10.5px;font-weight:700;letter-spacing:.1em">SALDO TOTAL</div>
    <div class="mono" style="font-size:28px;font-weight:700;margin:2px 0">${saldos.length ? usd(total) : '—'}</div>
    ${saldos.length ? `<span class="fresco">${saldos.length} de ${BROKERS.length} brókeres conectados</span>` : ''}</div>`;
  h += BROKERS.map(b => {
    const c = saldos.find(x => x.broker === b.k);
    if (c) {
      const orig = c._vivo ? 'en vivo · este equipo'
        : c.origen === 'vps' ? 'en vivo' : c.origen === 'dispositivo' ? 'desde otro equipo' : 'desde tu Mac';
      const reconn = (b.k === 'etrade' || b.k === 'schwab')
        ? ` · <a href="#" onclick="MZ.conectar('${b.k}');return false" style="color:var(--oro)">reconectar</a>`
          + ` · <a href="#" onclick="MZ.olvidar('${b.k}');return false" style="color:var(--tx3)">olvidar en este equipo</a>`
          + (b.k === 'schwab' ? ` · <a href="#" onclick="MZ.swCambiarCuenta();return false" style="color:var(--tx3)">cambiar cuenta</a>` : '') : '';
      const hist = b.k === 'etrade' ? etradeLineaHistorial(etHist) : b.k === 'schwab' ? schwabLineaHistorial(swHist) : '';
      return `<div class="card"><div class="fila">
      <div><b style="font-size:14px">${esc(b.n)}</b> <span class="mut">${esc(c.numero_mascara||'')}</span>
        <div class="fresco">${orig} · ${esc(haceCuanto(c.capturado_at).txt)}${reconn}</div>
        ${hist ? `<div class="fresco">${hist}</div>` : ''}</div>
      <span class="mono" style="font-weight:700;font-size:15px">${usd(c.saldo_neto)}</span></div></div>`;
    }
    const sub = b.k === 'tasty' ? 'conectando…'
      : (b.k === 'etrade' && etSinRed) ? 'sin conexión con el proxy — E*TRADE sigue conectada en este equipo'
      : (b.k === 'etrade' && etExpirado) ? 'sesión expirada — vuelve a entrar'
      : b.k === 'etrade' ? 'inicia sesión (login diario, con PIN)'
      : (b.k === 'schwab' && swSinRed) ? 'sin conexión con el proxy — Schwab sigue conectada en este equipo'
      : (b.k === 'schwab' && swExpirado) ? 'login semanal caducado — vuelve a entrar'
      : b.k === 'schwab' ? 'inicia sesión (login semanal de Schwab)'
      : b.k === 'moomoo' ? 'pendiente del login de OpenD en el servidor (se lee 24/7, sin tu Mac)' : 'requiere tu login';
    const btn = b.k === 'tasty' ? ''
      : ((b.k === 'etrade' && etSinRed) || (b.k === 'schwab' && swSinRed)) ? `<button class="btnsec" style="flex:none;padding:8px 14px" onclick="MZ.etReintentar()">Reintentar</button>`
      : `<button class="btnsec" style="flex:none;padding:8px 14px" onclick="MZ.conectar('${b.k}')">Conectar</button>`;
    return `<div class="card"><div class="fila">
      <div><b style="font-size:14px;color:var(--tx2)">${esc(b.n)}</b>
        <div class="fresco">${sub}</div></div>
      ${btn}</div></div>`;
  }).join('');

  // selector de período
  h += `<div class="periodos">
    ${[['semana','Semana'],['mes','Mes'],['ytd','YTD']].map(([k,l]) =>
      `<button class="perbtn ${_periodoSel===k?'on':''}" onclick="MZ.periodo('${k}')">${l}</button>`).join('')}</div>`;

  // resumen del período
  const desde = inicioPeriodo(_periodoSel);
  const enP = cerradas.filter(p => (p.cerrada_at || '').slice(0, 10) >= desde);
  const util = enP.reduce((s, p) => s + (Number(p.resultado_usd) || 0), 0);
  const ganadoras = enP.filter(p => (Number(p.resultado_usd) || 0) > 0).length;
  const winrate = enP.length ? Math.round(100 * ganadoras / enP.length) : 0;
  const mejor = enP.reduce((m, p) => Math.max(m, Number(p.resultado_usd) || -1e9), -1e9);
  const peor = enP.reduce((m, p) => Math.min(m, Number(p.resultado_usd) || 1e9), 1e9);
  h += `<div class="card">
    <div class="mut" style="font-size:10.5px;font-weight:700;letter-spacing:.1em">UTILIDAD · ${_periodoSel.toUpperCase()}</div>
    <div class="mono" style="font-size:30px;font-weight:700;margin:3px 0;color:${colUtil(util)}">${usd(util)}</div>
    <div class="fila" style="margin-top:4px">
      <span class="mut">${enP.length} ops · ${winrate}% aciertos</span>
      <span class="mut">mejor ${usd(enP.length?mejor:null)} · peor ${usd(enP.length?peor:null)}</span></div></div>`;

  // historial completo
  h += `<div class="sec">HISTORIAL DE OPERACIONES</div>`;
  if (cerradas.length) {
    h += cerradas.map(tarjetaHistorial).join('');
  } else {
    h += `<div class="card vacio">Aún no hay operaciones cerradas.<br>Cuando cierres una posición en el Copiloto, aparece aquí.</div>`;
  }

  // nota de brókeres (llega después)
  h += `<div class="mut" style="text-align:center;font-size:11px;padding:8px 12px">tastytrade en vivo 24/7 · E*TRADE en vivo desde este equipo (login diario) · Charles Schwab se activa en cuanto Schwab apruebe tu app.</div>`;
  $('#vista').innerHTML = h;
}

function tarjetaHistorial(p) {
  const c = Number(p.contratos) || 1;
  const costo = Number(p.prima_fill) * c * 100;
  const venta = p.prima_salida != null ? Number(p.prima_salida) * c * 100 : null;
  const util = p.resultado_usd != null ? Number(p.resultado_usd) : (venta != null ? venta - costo : null);
  const pct = costo ? (util / costo * 100) : null;
  return `<div class="card">
    <div class="fila"><h3>${esc(p.symbol)} ${esc(p.direccion)}${p.strike ? ' ' + esc(p.strike) : ''}</h3>
      <span class="mono" style="font-weight:700;color:${colUtil(util)}">${usd(util)}${pct!=null?` · ${pct>0?'+':''}${pct.toFixed(0)}%`:''}</span></div>
    <div class="hist">
      <div><span>compra</span><b>${fmtFechaNY(p.abierta_at, true)}</b></div>
      <div><span>venta</span><b>${p.estado==='expirada'?'expiró':fmtFechaNY(p.cerrada_at, true)}</b></div>
      <div><span>duración</span><b>${durTxt(p.abierta_at, p.cerrada_at)}</b></div>
    </div>
    <div class="hist">
      <div><span>costo</span><b class="mono">${usd(costo)}</b></div>
      <div><span>venta</span><b class="mono">${usd(venta)}</b></div>
      <div><span>×${esc(c)}</span><b>${esc(p.broker || '—')}</b></div>
    </div>
  </div>`;
}
window.MZ = Object.assign(window.MZ || {}, {
  periodo: (k) => { _periodoSel = k; vistaCuentas(); },
  conectar: (b) => {
    if (b === 'tasty') { toast('tastytrade ya está conectada (en vivo)'); return; }
    if (b === 'etrade') { conectarEtrade(); return; }
    if (b === 'schwab') { conectarSchwab(); return; }
    if (b === 'moomoo') { toast('moomoo: se lee desde el servidor (OpenD); el login se hace una vez desde el Mac con mesa2_moomoo_login.command'); return; }
    toast('Bróker no soportado');
  },
  pinEnviar: (rt) => etradePinEnviar(rt),
  pinCancelar: () => { etLoginOlvidar(); const m = $('#modalPin'); if (m) m.remove(); },
  etReintentar: () => ruta(),
  swEnviar: () => swCodigoEnviar(),
  swCancelar: () => { const m = $('#modalSw'); if (m) m.remove(); },
  olvidar: (b) => { if (b === 'schwab') { swOlvidar(); toast('Schwab olvidada en este equipo'); ruta(); } else if (window.MZ.etOlvidar) window.MZ.etOlvidar(); },
  etSync: () => etSyncAhora(),
  swSync: () => swSyncAhora(),
  swCambiarCuenta: () => swCambiarCuenta(),
  etOlvidar: () => { etOlvidar(); toast('E*TRADE olvidada en este equipo'); ruta(); },
});

// ---------- Órdenes E*TRADE ----------
// La app ARMA la orden y el proxy del VPS solo la FIRMA; E*TRADE la recibe
// únicamente cuando el usuario toca «Enviar» tras ver la vista previa (que vale
// 3 min). Ningún código coloca órdenes solo. Las reglas de doctrina AVISAN (el
// override queda anotado en ordenes.overrides), jamás bloquean; los únicos
// candados duros son de seguridad: PIN por dispositivo + guardarraíles del proxy.
const ORD_K = { pin: 'mz_pin', armado: 'mz_armado_hasta' };
const ARMADO_MIN = 15;          // el PIN arma este dispositivo 15 min
const PREVIEW_SEG = 180;        // la vista previa de E*TRADE caduca a los 3 min
const PRICE_TYPES = ['LIMIT', 'MARKET', 'STOP', 'TRAILING_STOP_PRCT'];
const PROPOSITOS = ['entrada', 'salida_gtc', 'salida_stop', 'salida_corte', 'cancelar', 'otro'];   // salida_corte: Plan 10% (migración 0012)

// clientOrderId de E*TRADE: ≤20 alfanumérico y único ('mz' + tiempo base36 + 4 al azar).
function clientOrderIdNuevo(ahora) {
  const t = (ahora == null ? Date.now() : Number(ahora)).toString(36);
  const r = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return ('mz' + t + r).replace(/[^a-z0-9]/gi, '').slice(0, 20);
}

// Formulario f: {symbol, tipo:'CALL'|'PUT'|'EQ', accion:'compra'|'venta', strike,
// expiracion:'YYYY-MM-DD', cantidad, priceType, limitPrice, stopPrice,
// offsetValue, orderTerm:'DAY'|'GTC'}. Devuelve el texto del error o null.
function validarOrden(f) {
  f = f || {};
  const sym = String(f.symbol || '').trim().toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(sym)) return 'Ticker inválido (1 a 6 letras).';
  if (!['CALL', 'PUT', 'EQ'].includes(f.tipo)) return 'Tipo inválido.';
  if (!['compra', 'venta'].includes(f.accion)) return 'Acción inválida.';
  const qty = Number(f.cantidad);
  if (!(Number.isInteger(qty) && qty > 0)) return 'La cantidad es un entero mayor que 0.';
  if (f.tipo !== 'EQ') {
    if (!(Number(f.strike) > 0)) return 'Falta el strike.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.expiracion || ''))) return 'Falta la expiración.';
  }
  if (!PRICE_TYPES.includes(f.priceType)) return 'Tipo de precio inválido.';
  if (f.priceType === 'LIMIT' && !(Number(f.limitPrice) > 0)) return 'Falta el precio límite.';
  if (f.priceType === 'STOP' && !(Number(f.stopPrice) > 0)) return 'Falta el precio stop.';
  if (f.priceType === 'TRAILING_STOP_PRCT' && !(Number(f.offsetValue) > 0 && Number(f.offsetValue) < 100)) return 'El trailing stop es un % entre 0 y 100.';
  if (!['DAY', 'GTC'].includes(f.orderTerm)) return 'Término inválido.';
  return null;
}

// Construye la 'orden' EXACTA del contrato app↔proxy (forma interna de E*TRADE).
function construirOrden(f) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const esEq = f.tipo === 'EQ';
  const venta = f.accion === 'venta';
  const sym = String(f.symbol || '').trim().toUpperCase();
  const o = {
    allOrNone: false,
    priceType: f.priceType,
    orderTerm: f.orderTerm === 'GTC' ? 'GOOD_UNTIL_CANCEL' : 'GOOD_FOR_DAY',
    marketSession: 'REGULAR',
  };
  if (f.priceType === 'LIMIT') o.limitPrice = n(f.limitPrice);
  if (f.priceType === 'STOP') o.stopPrice = n(f.stopPrice);
  if (f.priceType === 'STOP_LIMIT') { o.stopPrice = n(f.stopPrice); o.stopLimitPrice = n(f.limitPrice); }
  if (f.priceType === 'TRAILING_STOP_PRCT' || f.priceType === 'TRAILING_STOP_CNST') {
    o.offsetType = f.priceType; o.offsetValue = n(f.offsetValue);
  }
  let Product;
  if (esEq) {
    Product = { securityType: 'EQ', symbol: sym };
  } else {
    const [y, m, d] = String(f.expiracion || '').split('-').map(Number);
    Product = { securityType: 'OPTN', symbol: sym, callPut: f.tipo === 'PUT' ? 'PUT' : 'CALL',
      expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: n(f.strike) };
  }
  o.Instrument = [{ Product,
    orderAction: esEq ? (venta ? 'SELL' : 'BUY') : (venta ? 'SELL_CLOSE' : 'BUY_OPEN'),
    quantityType: 'QUANTITY', quantity: Math.floor(Number(f.cantidad)) }];
  return { orderType: esEq ? 'EQ' : 'OPTN', clientOrderId: f.clientOrderId || clientOrderIdNuevo(), Order: [o] };
}

// Veredicto de la prima frente al rango óptimo del ticker (mismo criterio que el
// registro del fill): 'ok' | 'aviso' (en el borde, 15 %) | 'alto' (FUERA) | null.
function semaforoRango(prima, rango) {
  if (!rango || rango.lo == null || rango.hi == null || !(prima > 0)) return null;
  if (!(Number(rango.lo) <= Number(rango.hi))) return null;   // rango invertido: no se juzga
  const lo = Math.round(rango.lo), hi = Math.round(rango.hi), cent = prima * 100, borde = (hi - lo) * 0.15;
  if (cent < lo - borde || cent > hi + borde) return 'alto';
  if (cent < lo || cent > hi) return 'aviso';
  return 'ok';
}

// Avisos de doctrina EN VIVO (amarillos; nunca bloquean). ctx: {rango, opsSemana,
// saldo, antes1030}. La regla del ticker aplica a toda orden; las demás solo a
// ENTRADAS (una salida no abre operación ni gasta cupo).
// ---- tabla oficial de rangos óptimos de la academia (Investep, xls 2026-08-26): prima por
// contrato en DÓLARES [lo, hi, tolerancia_lo, tolerancia_hi, fecha del análisis].
// Regla 1-13: lunes/martes tercio bajo, miércoles medio, jueves/viernes alto.
// El rango VIVO (delta 0.15-0.30 sobre la cadena de hoy) lo publica el worker en
// ticker_estado; aquí se muestran los dos bajo el ticker del formulario de orden.
const RANGOS_TABLA = {
  AAL: [40, 70, 30, 70, '2026-05-19'],
  AAPL: [35, 90, 30, 100, '2026-05-19'],
  AMD: [150, 235, 140, 240, '2026-05-19'],
  AMZN: [140, 230, 130, 240, '2026-05-19'],
  AVGO: [70, 140, 65, 145, '2026-05-19'],
  AXP: [85, 190, 80, 195, '2026-05-19'],
  BA: [60, 170, 50, 180, '2026-05-19'],
  BABA: [40, 60, 40, 70, '2026-05-19'],
  C: [50, 140, 45, 150, '2026-05-19'],
  CCL: [40, 60, 35, 65, '2026-05-19'],
  COIN: [200, 300, 195, 310, '2026-05-19'],
  CVS: [60, 120, 55, 130, '2026-05-19'],
  DAL: [40, 65, 35, 70, '2026-05-19'],
  DASH: [160, 240, 155, 245, '2026-05-19'],
  DIA: [100, 200, 95, 210, '2026-05-19'],
  GLD: [40, 80, 40, 90, '2026-05-19'],
  GOOG: [60, 170, 50, 170, '2026-05-19'],
  HD: [120, 240, 120, 240, '2026-05-19'],
  HOOD: [100, 150, 90, 160, '2026-05-19'],
  IBM: [115, 220, 110, 230, '2026-06-10'],
  INTC: [50, 80, 45, 85, '2026-06-10'],
  IWM: [40, 70, 35, 70, '2026-05-19'],
  LI: [25, 60, 25, 70, '2026-05-19'],
  LOW: [120, 220, 110, 225, '2026-05-19'],
  LYFT: [25, 50, 25, 55, '2026-05-19'],
  MA: [90, 175, 85, 180, '2026-05-19'],
  META: [150, 210, 145, 220, '2026-05-19'],
  MRNA: [50, 130, 50, 130, '2026-05-19'],
  MSFT: [60, 120, 50, 130, '2026-05-19'],
  MU: [400, 600, 400, 650, '2026-05-19'],
  NFLX: [40, 80, 35, 85, '2026-05-19'],
  NIO: [30, 75, 25, 75, '2026-05-19'],
  NOW: [62, 87, 55, 95, '2026-07-13'],
  NVDA: [80, 170, 75, 175, '2026-02-17'],
  ORCL: [80, 130, 70, 140, '2026-05-19'],
  PFE: [30, 70, 25, 75, '2026-05-19'],
  PLTR: [140, 300, 135, 310, '2026-05-19'],
  PYPL: [50, 80, 40, 90, '2026-05-19'],
  QCOM: [80, 160, 70, 170, '2026-05-19'],
  QQQ: [35, 55, 30, 60, '2026-05-19'],
  RCL: [80, 150, 75, 155, '2026-05-19'],
  SLV: [40, 75, 35, 80, '2026-05-19'],
  SOXL: [150, 240, 120, 250, '2026-05-19'],
  SPX: [400, 600, 380, 620, '2026-05-19'],
  SPY: [30, 45, 25, 50, '2026-05-19'],
  TNA: [40, 90, 40, 100, '2026-05-19'],
  TSLA: [100, 250, 90, 250, '2026-05-19'],
  UBER: [35, 60, 30, 65, '2026-05-19'],
  URA: [55, 80, 55, 85, '2026-05-19'],
  USO: [50, 80, 45, 90, '2026-05-19'],
  V: [60, 170, 55, 175, '2026-05-19'],
  WMT: [60, 110, 55, 115, '2026-02-17'],
  XPEV: [50, 70, 45, 75, '2026-05-19'],
};
const RANGOS_TABLA_FECHA = '2026-08-26';        // xls de la academia
const RANGOS_TABLA_ANALISIS = '2026-05-19';     // fecha de análisis del grueso de la tabla: una entrada anterior está vieja (NVDA: 2026-02-17)
const DIAS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function diaSemanaNY(d) {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d || new Date());
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(w);
}
// Parte del rango que toca hoy (doctrina 1-13): [lo, hi] y nombre de la parte.
function bandaDelDia(rango, dia) {
  const lo = Number(rango[0]), hi = Number(rango[1]), t = (hi - lo) / 3;
  if (dia === 0 || dia === 1) return { banda: [lo, lo + t], parte: 'baja' };
  if (dia === 2) return { banda: [lo + t, hi - t], parte: 'media' };
  return { banda: [hi - t, hi], parte: 'alta' };
}
// Rango óptimo del ticker para la app: manda el MÉTODO DE LA ACADEMIA
// (ticker_estado.payload.rango_academia, ver rango_academia.py del worker); el
// rango por delta (rango_vivo) queda de referencia y aporta exp/strikes sugeridos.
function componerRango(rv, ra, tabla) {
  if (ra && ra.lo != null && ra.hi != null) return Object.assign({}, rv || {}, { lo: Number(ra.lo), hi: Number(ra.hi), fuente: 'academia', academia: ra, delta: rv || null });
  // sin ejercicio válido del worker (p. ej. SPY hasta su primer ejercicio canónico): manda la TABLA de la academia
  if (tabla && tabla[0] != null) return Object.assign({}, rv || {}, { lo: Number(tabla[0]), hi: Number(tabla[1]), fuente: 'tabla', academia: null, delta: rv || null });
  if (rv) return Object.assign({}, rv, { fuente: 'delta', academia: null, delta: rv });
  return null;
}
// Spread bid/ask (doctrina 1-12, Joel): «NUNCA comprar un contrato con una
// diferencia entre bid y ask del 10 % o más»; lo normal es $1-5 por contrato
// (hasta $10 en algunas compañías). Se avisa (con override, regla de Andrés).
const SPREAD_MAX_PCT = 10;
function spreadPct(bid, ask) {
  bid = Number(bid); ask = Number(ask);
  if (!(ask > 0) || !(bid >= 0) || bid > ask) return null;
  return (ask - bid) / ask * 100;
}
// bid/ask del contrato que hay en el formulario, leídos de la cadena en vivo
function spreadDeForm(f, cadena) {
  if (!f || !cadena || !Array.isArray(cadena.filas) || f.tipo === 'EQ') return null;
  const k = Number(f.strike); if (!(k > 0)) return null;
  const fila = cadena.filas.find(r => Number(r.strike) === k); if (!fila) return null;
  const o = f.tipo === 'PUT' ? fila.put : fila.call;
  if (!o || o.bid == null || o.ask == null) return null;
  const pct = spreadPct(o.bid, o.ask);
  return pct == null ? null : { bid: Number(o.bid), ask: Number(o.ask), pct };
}
// Texto (HTML) del rango de precio de un ticker para el formulario de orden:
// rango VIVO del worker + tabla de la academia con la parte del día.
function textoRangoOrden(sym, vivo, tabla, dia) {
  sym = String(sym || '').toUpperCase();
  if (!sym) return '';
  const d$ = (v) => '$' + Math.round(Number(v));
  const partes = [];
  const ra = vivo && vivo.academia ? vivo.academia : null;
  const delta = vivo && vivo.delta ? vivo.delta : (vivo && !vivo.academia ? vivo : null);
  if (ra && ra.lo != null) {
    const fecha = ra.fecha ? esc(fmtFechaNY(String(ra.fecha) + 'T12:00:00Z')) : '';
    const el = Array.isArray(ra.elegidos) ? ra.elegidos.map(e => `${esc(e.strike)} (${d$(e.ask)}, +${esc(Math.round(Number(e.pct) || 0))}%)`).join(' y ') : '';
    const tipo = ra.dia_tipo === 'fuerte' ? ` · día fuerte (${esc(Number(ra.mov_pct) > 0 ? '+' : '')}${esc(ra.mov_pct)}%)` : ra.dia_tipo === 'canonico' ? ' · ejercicio de las 11:45' : '';
    partes.push(`<b style="color:var(--oro)">Rango óptimo ${d$(ra.lo)}–${d$(ra.hi)}</b> por contrato · método de la academia · con ${esc(String(ra.lado || '').toUpperCase())}s${fecha ? ' del ' + fecha : ''}${tipo}${ra.exp ? ' · exp ' + esc(String(ra.exp).slice(5)) : ''}${el ? ' · más valorizados: ' + el : ''}`);
  } else if (vivo && vivo.fuente === 'tabla') {
    partes.push(`<b style="color:var(--oro)">Rango óptimo ${d$(vivo.lo)}–${d$(vivo.hi)}</b> por contrato · tabla de la academia (el worker hace el ejercicio del curso a las 11:45 ET)`);
  } else {
    partes.push('Rango óptimo (método academia): el worker aún no lo calculó para ' + esc(sym));
  }
  if (delta && delta.lo != null && delta.hi != null) {
    let extra = delta.exp ? ' · vence ' + esc(String(delta.exp).slice(5)) : '';
    if (delta.strike_put != null && delta.prima_put != null) extra += ` · PUT ${esc(delta.strike_put)} ${d$(delta.prima_put)}`;
    if (delta.strike_call != null && delta.prima_call != null) extra += ` · CALL ${esc(delta.strike_call)} ${d$(delta.prima_call)}`;
    partes.push(`Referencia por delta 0.15–0.30: ${d$(delta.lo)}–${d$(delta.hi)}${extra}`);
  }
  if (tabla) {
    // fin de semana: la parte que aplica es la del LUNES (próxima sesión)
    const finde = dia === 5 || dia === 6, d = finde ? 0 : dia;
    const b = bandaDelDia([tabla[0], tabla[1]], d);
    const vieja = tabla[4] && tabla[4] < RANGOS_TABLA_ANALISIS;
    partes.push(`Tabla Investep ${d$(tabla[0])}–${d$(tabla[1])} (tolerancia ${d$(tabla[2])}–${d$(tabla[3])}) · ${finde ? 'próxima sesión, ' : 'hoy '}${DIAS_ES[d] || ''}: parte ${b.parte} ${d$(b.banda[0])}–${d$(b.banda[1])}${vieja ? ' · <span style="color:var(--rojo)">tabla de ' + esc(tabla[4]) + ', pide la fresca</span>' : ''}`);
  } else {
    partes.push(esc(sym) + ' no está en la tabla de rangos de la academia');
  }
  return partes.join('<br>');
}
function pintarRangoOrden() {
  if (!_ord) return; const el = $('#oRango'); if (!el) return;
  const f = leerFormOrden();
  if (!f.symbol || f.tipo === 'EQ') { el.innerHTML = ''; return; }
  const vivo = (_ord.ctx && _ord.ctx.rangos && _ord.ctx.rangos[f.symbol]) || null;
  el.innerHTML = textoRangoOrden(f.symbol, vivo, RANGOS_TABLA[f.symbol] || null, diaSemanaNY());
}
// ---- presupuesto por ticket (regla personal de Andrés, 2026-09-13): un % del
// saldo del BRÓKER de la orden (E*TRADE hoy; Schwab/tasty con su propio saldo
// cuando operen). La cantidad se prearma sola: presupuesto ÷ valor del contrato.
// Es sizing personal, NO doctrina: la regla de tamaño del plan sigue avisando.
//   Plan 35%: 35% por defecto, 1–100, guardado en este equipo (como siempre).
//   Plan 10%: 35% por defecto (lo eligió Andrés), 1–100 (por encima del 50% solo
//   avisa: sin tope duro), guardado en plan_usuario (personal y sincronizado entre
//   iPhone y Mac).
const PRESUPUESTO_PCT_DEFECTO = 35;
const PRESUP_K = 'mz_presup_pct';
function presupuestoPct(plan) {
  plan = plan || planActivo();
  if (plan.id === 'PLAN_10') {
    const f = planFilaCache(), v = Number(f && f.presupuesto_pct);
    return (f && f.presupuesto_pct != null && v > 0 && v <= plan.presupMaxPct) ? v : plan.presupDefPct;
  }
  try { const v = Number(localStorage.getItem(PRESUP_K)); return (v > 0 && v <= 100) ? v : PRESUPUESTO_PCT_DEFECTO; } catch (_) { return PRESUPUESTO_PCT_DEFECTO; }
}
// Presupuesto en $ para este ticket a partir del saldo del bróker (null si no se conoce).
function presupuestoTicket(ctx, pct) {
  const saldo = Number(ctx && ctx.saldoBroker) || 0;
  if (!(saldo > 0)) return null;
  return Math.round(saldo * (pct || presupuestoPct()) / 100);
}
// Contratos (o acciones) que caben en el presupuesto: ⌊presupuesto ÷ valor⌋, mínimo 1.
function cantidadPorPresupuesto(presupuesto, precio, esOpcion) {
  const p = Number(precio), b = Number(presupuesto);
  if (!(p > 0) || !(b > 0)) return null;
  return Math.max(1, Math.floor(b / (p * (esOpcion ? 100 : 1))));
}
// Valor total de la orden (cantidad × precio × 100 en opciones); null si no hay precio.
function totalOrden(f) {
  f = f || {};
  const qty = Number(f.cantidad) || 0;
  const precio = f.priceType === 'LIMIT' ? Number(f.limitPrice) : f.priceType === 'STOP' ? Number(f.stopPrice) : null;
  if (!(qty > 0) || !(precio > 0)) return null;
  return Math.round(qty * precio * (f.tipo === 'EQ' ? 1 : 100) * 100) / 100;
}
// ctx.plan (PLANES.*) decide cupo, tamaño, hora y compañía; SIN plan (o Plan 35%)
// los textos y conteos son los de siempre. Plan 10%: ctx.opsHoy, ctx.fueraVentana
// (fuera de 9:30–9:45 ET), ctx.focoHoy (compañía de hoy o null) y
// ctx.expHoyTras1030 (la fecha NY de hoy si ya pasaron las 10:30 ET; si no, null).
// ctx.posicionId: la orden es la SALIDA de esa posición (no avisa por el ticker).
function avisosOrden(f, ctx) {
  f = f || {}; ctx = ctx || {};
  const av = [];
  const plan = (ctx.plan && ctx.plan.periodo) ? ctx.plan
    : { opsMax: OPS_SEMANA, periodo: 'semana', tamanoMaxPct: TAMANO_PCT, ventana: 'no_antes_1030' };
  const sym = String(f.symbol || '').trim().toUpperCase();
  const esEntrada = f.accion !== 'venta';
  const esOpt = f.tipo !== 'EQ';
  const qty = Number(f.cantidad) || 0;
  const precio = f.priceType === 'LIMIT' ? Number(f.limitPrice) : null;
  // la SALIDA de una posición que ya existe (GTC, stop, corte) no pide override por el
  // ticker: una QQQ/SPX/META abierta antes del cambio de lista se tiene que poder vender
  if (sym && !TICKERS.includes(sym) && !(f.accion === 'venta' && ctx.posicionId)) av.push(`${sym} no está en tus ${TICKERS.length} tickers (${TICKERS.join(', ')})`);
  if (!esEntrada) return av;
  if (esOpt && precio > 0 && ctx.rango && ctx.rango.lo != null && semaforoRango(precio, ctx.rango) === 'alto') {
    av.push(`Prima $${(precio * 100).toFixed(0)} FUERA del rango óptimo $${Math.round(ctx.rango.lo)}–$${Math.round(ctx.rango.hi)} — así se perdió en agosto`);
  }
  if (plan.periodo === 'dia') {
    const hoy = Number(ctx.opsHoy) || 0;
    if (hoy >= plan.opsMax) av.push(`Sería la ${hoy + 1}ª operación del día (plan: ${plan.opsMax} al día)`);
  } else {
    const ops = Number(ctx.opsSemana) || 0;
    if (ops >= plan.opsMax) av.push(`Sería la ${ops + 1}ª operación de la semana (plan: ${plan.opsMax})`);
  }
  if (plan.companiaDia && sym) {
    if (!ctx.focoHoy) av.push('Plan 10%: elige la compañía de hoy en el Copiloto');
    else if (sym !== ctx.focoHoy) av.push(`Plan 10%: hoy operas ${ctx.focoHoy}, no ${sym}`);
  }
  // la regla de tamaño se mide contra la cuenta del BRÓKER de la orden (E*TRADE);
  // si no se conoce, contra el total de cuentas
  const saldo = Number(ctx.saldoBroker != null ? ctx.saldoBroker : ctx.saldo) || 0;
  if (precio > 0 && qty > 0 && saldo > 0) {
    const costo = precio * qty * (esOpt ? 100 : 1), tope = saldo * plan.tamanoMaxPct / 100;
    if (costo > tope) av.push(`Costo ${usd(costo)}: más del ${plan.tamanoMaxPct}% de la cuenta (${usd(tope)})`);
  }
  if (ctx.spread && ctx.spread.pct != null && ctx.spread.pct >= SPREAD_MAX_PCT) {
    av.push(`Spread bid/ask $${(ctx.spread.bid * 100).toFixed(0)}→$${(ctx.spread.ask * 100).toFixed(0)} = ${ctx.spread.pct.toFixed(0)}%: la academia dice NO comprar con ${SPREAD_MAX_PCT}% o más (desde la compra vas en negativo)`);
  }
  if (plan.ventana === 'apertura_15') {
    if (ctx.fueraVentana) av.push('Fuera de 9:30–9:45 ET: el Plan 10% identifica el movimiento en los primeros 15 minutos de la apertura');
  } else if (ctx.antes1030) av.push('Antes de las 10:30 ET: la doctrina espera a que el mercado defina');
  if (plan.avisoExpHoy && esOpt && ctx.expHoyTras1030 && String(f.expiracion || '') === String(ctx.expHoyTras1030)) {
    av.push('Vence hoy y ya pasaron las 10:30 ET: la doctrina compra la siguiente fecha de expiración');
  }
  return av;
}
function requiereOverride(avisos) { return Array.isArray(avisos) && avisos.length > 0; }

// ¿Estamos antes de las 10:30 ET en día de mercado? Manda MERCADO.payload.regla_1030
// si es de HOY (NY); si no, el reloj NY y día hábil (sin calendario de festivos).
function antesDe1030NY(merc) {
  const p = merc && merc.payload;
  if (p && p.regla_1030 != null && (!p.fecha_ny || p.fecha_ny === hoyNY())) return !!p.regla_1030;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const v = (t) => (f.find(x => x.type === t) || {}).value;
  if (v('weekday') === 'Sat' || v('weekday') === 'Sun') return false;
  return Number(v('hour')) * 60 + Number(v('minute')) < 630;
}
function horaNY(ms) {
  return new Intl.DateTimeFormat('es', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
// Recorta un JSON a `max` caracteres para guardarlo en jsonb sin inflar la tabla.
function recortarJson(o, max) {
  max = max || 4096;
  let s; try { s = JSON.stringify(o == null ? {} : o); } catch (_) { s = '{}'; }
  if (s.length <= max) { try { return JSON.parse(s); } catch (_) { return {}; } }
  return { _recortado: true, bytes: s.length, texto: s.slice(0, max - 80) };
}
// Fila de 'ordenes' a partir del formulario y de la 'orden' construida.
function filaOrdenDe(f, orden, extra) {
  const o = orden.Order[0], ins = o.Instrument[0], pr = ins.Product;
  return Object.assign({
    broker: 'etrade', client_order_id: orden.clientOrderId, symbol: pr.symbol,
    security_type: orden.orderType, direccion: pr.callPut || null,
    strike: pr.strikePrice == null ? null : pr.strikePrice,
    expiracion: orden.orderType === 'EQ' ? null : (f.expiracion || null),
    accion: ins.orderAction, cantidad: ins.quantity, price_type: o.priceType,
    limit_price: o.limitPrice == null ? null : o.limitPrice,
    stop_price: o.stopPrice == null ? null : o.stopPrice,
    offset_value: o.offsetValue == null ? null : o.offsetValue,
    order_term: o.orderTerm,
  }, extra || {});
}
function propositoDe(f, pre) {
  if (f.accion !== 'venta') return 'entrada';
  if (pre && pre.proposito === 'salida_corte') return 'salida_corte';   // corte del Plan 10%: venta al bid (DAY)
  if (f.priceType === 'LIMIT') return 'salida_gtc';
  if (f.priceType === 'STOP' || f.priceType === 'TRAILING_STOP_PRCT') return 'salida_stop';
  return 'otro';
}
// Mensaje claro de un fallo del proxy o de E*TRADE (jamás inventar éxito).
function mensajeError(r) {
  if (!r) return 'sin respuesta del proxy';
  const em = etError(r);
  if (em) return em;
  if (r.status === 404) return 'El proxy aún no tiene esta ruta de órdenes (despliegue pendiente en el VPS).';
  if (r.status === 403) return 'Órdenes desactivadas en el proxy.';
  if (r.status >= 400) return 'HTTP ' + r.status;
  return null;
}

// ---- PIN y armado (por dispositivo; hash SHA-256 en localStorage) ----
async function sha256Hex(txt) {
  if (!(window.crypto && crypto.subtle)) throw new Error('este navegador no soporta el PIN (contexto inseguro)');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(txt)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function pinHash() { try { return localStorage.getItem(ORD_K.pin) || ''; } catch (_) { return ''; } }
function armadoHasta() { try { const n = Number(localStorage.getItem(ORD_K.armado)); return n > Date.now() ? n : 0; } catch (_) { return 0; } }
function armar() { try { localStorage.setItem(ORD_K.armado, String(Date.now() + ARMADO_MIN * 60000)); } catch (_) {} }
function desarmar() { try { localStorage.removeItem(ORD_K.armado); } catch (_) {} }
const pinValido = (p) => /^\d{4,6}$/.test(String(p || ''));

// Modal de PIN: 'crear' (dos campos), 'cambiar' (actual + nuevo) o 'pedir' (uno).
// Devuelve Promise<boolean>; al validar (crear/pedir) arma el dispositivo.
function modalPinOrdenes(modo) {
  return new Promise((resolve) => {
    const prev = $('#modalPinOrd'); if (prev) prev.remove();
    const crear = modo === 'crear' || !pinHash();
    const cambiar = !crear && modo === 'cambiar';
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalPinOrd'; m.style.zIndex = 55;
    m.innerHTML = `<div class="hoja">
      <h3 style="margin:0 0 2px">${crear ? 'Crea tu PIN de órdenes' : cambiar ? 'Cambiar PIN de órdenes' : 'PIN de órdenes'}</h3>
      <div class="mut" style="margin-bottom:6px">${crear
        ? `De 4 a 6 dígitos. Se guarda solo en este dispositivo (hash) y arma las órdenes ${ARMADO_MIN} min.`
        : cambiar ? 'Pon el PIN actual y el nuevo.' : `Arma este dispositivo ${ARMADO_MIN} min para operar en E*TRADE.`}</div>
      ${!crear ? `<label>${cambiar ? 'PIN actual' : 'PIN'}</label><input id="poActual" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6">` : ''}
      ${crear || cambiar ? `<label>${cambiar ? 'PIN nuevo' : 'PIN'}</label><input id="poNuevo" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6">
        <label>Repite el PIN</label><input id="poRep" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6">` : ''}
      <div class="err" id="poErr"></div>
      <div class="dos" style="margin-top:6px">
        <button class="btnsec" id="poCancel">Cancelar</button>
        <button class="pri" id="poOk">${crear ? 'Crear y armar' : cambiar ? 'Cambiar' : 'Armar'}</button></div>
    </div>`;
    document.body.appendChild(m);
    const fin = (v) => { m.remove(); resolve(v); };
    m.querySelector('#poCancel').onclick = () => fin(false);
    const ok = async () => {
      const err = m.querySelector('#poErr');
      try {
        if (!crear) {
          const h = await sha256Hex(m.querySelector('#poActual').value.trim());
          if (h !== pinHash()) { err.textContent = 'PIN incorrecto.'; return; }
        }
        if (crear || cambiar) {
          const a = m.querySelector('#poNuevo').value.trim(), b = m.querySelector('#poRep').value.trim();
          if (!pinValido(a)) { err.textContent = 'El PIN es de 4 a 6 dígitos.'; return; }
          if (a !== b) { err.textContent = 'Los dos PIN no coinciden.'; return; }
          localStorage.setItem(ORD_K.pin, await sha256Hex(a));
        }
        if (!cambiar) armar();
        fin(true);
      } catch (e) { err.textContent = 'No pude guardar el PIN: ' + ((e && e.message) || e); }
    };
    m.querySelector('#poOk').onclick = ok;
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => { const i = m.querySelector('input'); if (i) i.focus(); }, 60);
  });
}
// Si el dispositivo no está armado, pide el PIN (sin PIN configurado → lo crea).
async function pedirPin() {
  if (armadoHasta()) return true;
  return modalPinOrdenes(pinHash() ? 'pedir' : 'crear');
}
function pintarOrdenesCuenta() {
  const e = $('#ordPinEstado'), b = $('#ordPinBtn'), ae = $('#ordArmEstado'), ab = $('#ordArmBtn');
  if (!e || !b || !ae || !ab) return;
  const hay = !!pinHash(), h = armadoHasta();
  e.textContent = hay ? 'PIN de órdenes configurado en este dispositivo.' : 'Sin PIN de órdenes. Créalo para poder operar desde aquí.';
  b.textContent = hay ? 'Cambiar PIN' : 'Crear PIN';
  ae.textContent = h ? 'armado hasta ' + horaNY(h) + ' NY' : 'desarmado';
  ae.style.color = h ? 'var(--verde)' : '';
  ab.textContent = h ? 'Desarmar' : 'Armar';
  ab.classList.toggle('oculto', !hay);
}

// ---- accountIdKey (cache por dispositivo) y POST firmado con auto-renew ----
async function etCuentaKey(cr) {
  try { const k = localStorage.getItem(ET_K.acct); if (k) return k; } catch (_) {}
  const lst = await etRead(cr, '/v1/accounts/list.json');
  if (lst.status === 401) throw new Error('La sesión de E*TRADE expiró. Reconecta en Cuentas → E*TRADE.');
  const em = etError(lst); if (em) throw new Error('E*TRADE: ' + em);
  const acc = (((lst.data || {}).AccountListResponse || {}).Accounts || {}).Account || [];
  const arr = Array.isArray(acc) ? acc : [acc];
  const a = arr.find(x => String(x.accountStatus || '').toUpperCase() !== 'CLOSED') || arr[0];
  if (!a || !a.accountIdKey) throw new Error('E*TRADE no devolvió ninguna cuenta.');
  try { localStorage.setItem(ET_K.acct, a.accountIdKey); } catch (_) {}
  return a.accountIdKey;
}
async function etPost(cr, path, body) {
  const llamar = async () => {
    try { return await etProxy(path, { ...cr, ...body }); }
    catch (_) { throw new Error('No pude contactar el proxy (¿Funnel activo?).'); }
  };
  let r = await llamar();
  if (r.status === 401) {
    const renovado = await etRenovar(cr);            // misma renovación compartida que etRead
    r = await llamar();
    if (r.status === 401 && renovado === false) etMarcarMuerto(cr);
  }
  return r;
}
// Texto para un 401 de E*TRADE en órdenes: reconectar si el token murió; si no, el motivo literal.
function texto401Ordenes(msgEtrade) {
  return etDiaVencido() ? 'La sesión de E*TRADE expiró — reconecta en Cuentas → E*TRADE.'
    : 'E*TRADE rechazó la llamada (401): ' + (msgEtrade || 'sin detalle');
}

// ---- modal «Orden E*TRADE» ----
let _ord = null;   // estado del modal: {pre, ctx, f, orden, previewIds, filaId, accountIdKey, caduca, timer, avisos}
function abrirOrden(pre) {
  pre = pre || {};
  cerrarOrden();
  const tipo = pre.security_type === 'EQ' ? 'EQ' : pre.direccion === 'PUT' ? 'PUT' : 'CALL';
  const venta = pre.accion === 'venta' || /^salida/.test(pre.proposito || '');
  const pt = PRICE_TYPES.includes(pre.priceType) ? pre.priceType : 'LIMIT';
  const gtc = pre.orderTerm === 'GOOD_UNTIL_CANCEL' || pre.orderTerm === 'GTC';
  const precio0 = pt === 'LIMIT' ? pre.limitPrice : pt === 'STOP' ? pre.stopPrice : pt === 'TRAILING_STOP_PRCT' ? pre.offsetValue : '';
  // bróker de la orden: el de la posición (salidas), el último usado o el primero con sesión viva
  const ops = brokersOperables();
  let ultimo = ''; try { ultimo = localStorage.getItem('mz_broker_orden') || ''; } catch (_) {}
  // SALIDA de una posición: el bróker es el de la posición y NO se cambia; si no está
  // operable en este equipo, el formulario lo dice y no deja enviar nada (ni el GTC automático)
  const fijo = !!(pre.posicion_id && pre.broker);
  const broker = fijo ? pre.broker : (pre.broker && ops.includes(pre.broker)) ? pre.broker : ops.includes(ultimo) ? ultimo : (ops[0] || pre.broker || 'etrade');
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalOrden';
  m.innerHTML = `<div class="hoja">
    <div class="fila"><h3 style="margin:0" id="oTitulo">Orden ${esc(BROKER_NOMBRE[broker] || broker)}</h3><span class="fresco" id="oArm"></span></div>
    <div class="mut" id="oSub" style="margin-bottom:4px">${esc(subtituloBroker(broker))}</div>
    ${pre.proposito === 'salida_corte' ? `<div class="aviso" style="margin-top:2px;background:rgba(242,109,95,.12);border-color:rgba(242,109,95,.45);color:var(--rojo)"><b>Corte</b>: venta de cierre LIMIT DAY al bid${Number(pre.limitPrice) > 0 ? ' ($' + esc(Number(pre.limitPrice).toFixed(2)) + ')' : ': no leí el bid, tócalo en la cadena'}. Tus ventas vivas de esta posición ya están canceladas. Revisa y envía (pide PIN).</div>` : ''}
    ${!fijo && ops.length > 1 ? `<label>Bróker</label><select id="oBroker">${ops.map(b => `<option value="${b}" ${b === broker ? 'selected' : ''}>${esc(BROKER_NOMBRE[b] || b)}</option>`).join('')}</select>` : ''}
    <label>Ticker</label>
    <input id="oSym" list="oSyms" value="${esc(pre.symbol || '')}" placeholder="AAPL" autocapitalize="characters" autocomplete="off" spellcheck="false" style="text-transform:uppercase">
    <datalist id="oSyms">${TICKERS.map(t => `<option value="${t}">`).join('')}</datalist>
    <div id="oRango" class="fresco" style="margin:-3px 0 8px;line-height:1.45"></div>
    <div class="dos">
      <div><label>Tipo</label><select id="oTipo">
        <option value="CALL" ${tipo === 'CALL' ? 'selected' : ''}>Opción CALL</option>
        <option value="PUT" ${tipo === 'PUT' ? 'selected' : ''}>Opción PUT</option>
        <option value="EQ" ${tipo === 'EQ' ? 'selected' : ''}>Acción</option></select></div>
      <div><label>Acción</label><select id="oAcc">
        <option value="compra" ${!venta ? 'selected' : ''}>Comprar (abrir)</option>
        <option value="venta" ${venta ? 'selected' : ''}>Vender (cerrar)</option></select></div></div>
    <div class="dos" id="oOptn">
      <div><label>Strike</label><input id="oStrike" type="number" inputmode="decimal" step="0.5" value="${pre.strike == null ? '' : esc(pre.strike)}" placeholder="ej. 230"></div>
      <div><label>Expira</label><input id="oExp" type="date" value="${esc(pre.expiracion || '')}"></div></div>
    <div id="oCadena"></div>
    <div class="dos">
      <div><label>Cantidad</label><input id="oQty" type="number" inputmode="numeric" min="1" step="1" value="${esc(pre.cantidad || 1)}"></div>
      <div><label>Término</label><select id="oTerm">
        <option value="DAY" ${!gtc ? 'selected' : ''}>DAY (hoy)</option>
        <option value="GTC" ${gtc ? 'selected' : ''}>GTC</option></select></div></div>
    <div class="fila" style="margin:2px 0 8px;font-size:12px">
      <span class="mut">Presupuesto <a href="#" id="oPresup" onclick="MZ.presupuestoPct();return false">${presupuestoPct()}%</a></span>
      <b class="mono" id="oTotal">Total —</b></div>
    <div class="dos">
      <div><label>Precio</label><select id="oPt">
        <option value="LIMIT" ${pt === 'LIMIT' ? 'selected' : ''}>Límite</option>
        <option value="MARKET" ${pt === 'MARKET' ? 'selected' : ''}>Mercado</option>
        <option value="STOP" ${pt === 'STOP' ? 'selected' : ''}>Stop</option>
        <option value="TRAILING_STOP_PRCT" ${pt === 'TRAILING_STOP_PRCT' ? 'selected' : ''}>Trailing stop %</option></select></div>
      <div id="oPrecioWrap"><label id="oPrecioLbl">Límite</label><input id="oPrecio" type="number" inputmode="decimal" step="0.01" value="${precio0 == null ? '' : esc(precio0)}" placeholder="ej. 0.98"></div></div>
    <label id="oGtcAutoWrap" style="display:flex;align-items:center;gap:8px;margin:8px 2px 0;font-size:12.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--tx)"><input type="checkbox" id="oGtcAuto" ${gtcAutoDefecto() ? 'checked' : ''} style="width:auto;margin:0"> Al llenarse, enviar sola la venta GTC +${planActivo().gtcPct}% (pide PIN si el equipo está desarmado)</label>
    <div id="oAvisos"></div>
    <div id="oPrev"></div>
    <div class="err" id="oErr" style="text-align:left"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.cerrarOrden()">Cancelar</button>
      <button class="pri" id="oBtnPrev" onclick="MZ.ordenPreview()">${esc(textoBotonPreview(broker))}</button></div>
  </div>`;
  document.body.appendChild(m);
  _ord = { pre, broker, brokerFijo: fijo, ctx: null, f: null, orden: null, previewIds: null, filaId: null, accountIdKey: null, caduca: 0, timer: null, avisos: [], avisosTxt: '',
    cadena: null, cadenaSym: null, cadenaExp: null, cadenaClave: '', cadenaTs: 0, cadenaTimer: null, cadenaErr: null, cadenaCargando: false, cadenaGen: 0, cotiz: null, cotizTs: 0, vencs: [],
    qtyManual: pre.cantidad != null };            // cantidad explícita (p. ej. salida de una posición) → no se prearma
  m.addEventListener('input', (e) => {
    const id = e && e.target && e.target.id;
    if (id === 'oQty') _ord.qtyManual = true;                       // el usuario manda: no se vuelve a prearmar
    if (id === 'oGtcAuto') gtcAutoGuardarDefecto(e.target.checked);
    if (id === 'oPrecio') autoCantidad();
    if (id === 'oSym' || id === 'oTipo') pintarRangoOrden();
    ajustarFormOrden(); pintarAvisosOrden(); pintarTotalOrden();
  });
  m.addEventListener('change', (e) => {
    ajustarFormOrden(); pintarAvisosOrden(); pintarTotalOrden(); pintarRangoOrden();
    const id = e && e.target && e.target.id;
    if (id === 'oBroker') { cambiarBrokerOrden(e.target.value); return; }
    if (id === 'oSym') _ord.cadenaSym = null;                      // símbolo nuevo → cotización y vencimientos de nuevo
    if (['oSym', 'oTipo', 'oExp', 'oAcc'].includes(id)) { _ord.cadenaGen++; cargarCadena(true); }   // gen++: una carga en vuelo se descarta y se relanza
  });
  ajustarFormOrden(); pintarArmadoOrden(); pintarTotalOrden(); pintarRangoOrden();
  if (fijo && !ops.includes(broker)) {
    const e0 = $('#oErr'); if (e0) e0.textContent = 'Reconecta ' + (BROKER_NOMBRE[broker] || broker) + ' (Cuentas) para poner la salida de esta posición.';
    const b0 = $('#oBtnPrev'); if (b0) b0.disabled = true;
  }
  cargarCtxOrden().then(() => { autoCantidad(); pintarAvisosOrden(); pintarTotalOrden(); pintarRangoOrden(); pintarCadena(); });
  cargarCadena();
  setTimeout(() => { const i = $('#oSym'); if (i && !i.value) i.focus(); }, 60);
}
// Cambio de bróker dentro del formulario: cadena, presupuesto y textos del bróker nuevo.
function cambiarBrokerOrden(b) {
  if (!_ord || !b || _ord.brokerFijo) return;
  _ord.broker = b;
  try { if (leerFormOrden().accion !== 'venta') localStorage.setItem('mz_broker_orden', b); } catch (_) {}
  const t = $('#oTitulo'), s = $('#oSub'), bt = $('#oBtnPrev');
  if (t) t.textContent = 'Orden ' + (BROKER_NOMBRE[b] || b);
  if (s) s.textContent = subtituloBroker(b);
  if (bt && !_ord.orden) bt.textContent = textoBotonPreview(b);
  if (_ord.ctx) { _ord.ctx.broker = b; _ord.ctx.saldoBroker = (_ord.ctx.saldos && _ord.ctx.saldos[b] > 0) ? _ord.ctx.saldos[b] : null; }
  _ord.cadenaSym = null; _ord.cadena = null; _ord.vencs = []; _ord.cotiz = null; _ord.cadenaGen++;
  _ord.qtyManual = false; autoCantidad();
  pintarAvisosOrden(); pintarTotalOrden(); pintarRangoOrden();
  cargarCadena(true);
}
// Una vista previa que no se envía (caduca, se edita o se cierra) queda 'expirada'
// en la bitácora, para que el Copiloto no se llene de previews muertas.
function expirarPreviewHuerfana() {
  if (_ord && _ord.enviando) return;   // la fila está en vuelo: la anota el envío, no es huérfana
  if (!_ord || !_ord.filaId || _ord.estadoFila !== 'preview') return;
  _ord.estadoFila = 'expirada';
  sb.from('ordenes').update({ estado: 'expirada', actualizado_at: new Date().toISOString() }).eq('id', _ord.filaId).then(() => {}, () => {});
}
function cerrarOrden() {
  expirarPreviewHuerfana();
  if (_ord && _ord.timer) clearInterval(_ord.timer);
  if (_ord && _ord.cadenaTimer) clearInterval(_ord.cadenaTimer);
  _ord = null;
  const m = $('#modalOrden'); if (m) m.remove();
}

// ---- Cadena de opciones EN VIVO (E*TRADE, con tu login diario) ----
// 401 de mercado: si etRead ya dio el token por muerto → 'RECONECTAR' (la vista
// pone el enlace); si no (token vivo pero E*TRADE restringe el endpoint), se
// muestra el motivo literal que dio E*TRADE para poder actuar.
function errorCadena401(msgEtrade) {
  return etDiaVencido() ? 'RECONECTAR' : 'E*TRADE rechazó la lectura de mercado (401): ' + (msgEtrade || 'sin detalle');
}
// Texto para la vista a partir de la excepción: los fallos de red de Safari/Chrome
// ("Load failed", "Failed to fetch") se traducen; iOS corta los fetch en curso
// al mandar la app al fondo, y eso NO es un error de E*TRADE.
function textoErrorCadena(e) {
  const msg = String((e && e.message) || e || 'error');
  if (/load failed|failed to fetch|networkerror|network request failed|the internet connection appears to be offline/i.test(msg)) return 'sin conexión con el proxy — revisa la red y toca ↻';
  return msg;
}
// Para elegir strike y precio sin salir de la Mesa: cotización del subyacente,
// vencimientos y la cadena (bid/ask/delta de CALL y PUT) alrededor del spot,
// con el rango óptimo de Sardiñas marcado. Tocar un precio llena la orden.
// Todo son lecturas (/v1/market, GET) con el token del dispositivo.
const CADENA_STRIKES = 14, CADENA_REFRESCO_MS = 15000;
function parsearCotizacion(resp) {
  const d = (resp && resp.data) || {}; const Q = d.QuoteResponse || d;
  let q = Q.QuoteData || Q.quoteData || []; if (!Array.isArray(q)) q = [q];
  const x = q[0] || {}; const a = x.All || x.Intraday || x.all || x.intraday || {};
  return { last: num2(a.lastTrade), bid: num2(a.bid), ask: num2(a.ask),
    estado: String(x.quoteStatus || Q.quoteStatus || '').toUpperCase(), hora: x.dateTime || null };
}
function parsearVencimientos(resp) {
  const d = (resp && resp.data) || {}; const R = d.OptionExpireDateResponse || d;
  let e = R.ExpirationDate || R.expirationDates || R.expirationDate || []; if (!Array.isArray(e)) e = [e];
  return e.map(x => ({ y: Number(x.year), m: Number(x.month), d: Number(x.day), tipo: String(x.expiryType || '') }))
    .filter(x => x.y && x.m && x.d)
    .map(x => ({ ...x, ymd: `${x.y < 100 ? 2000 + x.y : x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}` }));
}
function parsearCadena(resp) {
  const d = (resp && resp.data) || {}; const R = d.OptionChainResponse || d;
  let pares = R.OptionPair || R.optionPairs || R.optionPair || []; if (!Array.isArray(pares)) pares = [pares];
  const lado = (o) => o ? { simbolo: o.symbol, strike: num2(o.strikePrice), bid: num2(o.bid), ask: num2(o.ask), last: num2(o.lastPrice),
    vol: num2(o.volume), oi: num2(o.openInterest), delta: num2((o.OptionGreeks || o.optionGreeks || {}).delta), itm: !!o.inTheMoney } : null;
  const filas = pares.map(p => {
    const c = lado(p.Call || p.optioncall || p.call), u = lado(p.Put || p.optionPut || p.put);
    return { strike: (c && c.strike != null) ? c.strike : (u ? u.strike : null), call: c, put: u };
  }).filter(f => f.strike != null).sort((a, b) => a.strike - b.strike);
  const sel = R.SelectedED || R.selectedED || {};
  const exp = (sel.year && sel.month && sel.day) ? `${Number(sel.year) < 100 ? 2000 + Number(sel.year) : sel.year}-${String(sel.month).padStart(2, '0')}-${String(sel.day).padStart(2, '0')}` : null;
  return { filas, estado: String(R.quoteType || '').toUpperCase(), near: num2(R.nearPrice), exp };
}
// ¿La prima (mid × 100 por contrato) cae en el rango óptimo del ticker?
function enRangoCadena(o, rango) {
  if (!o || !rango || rango.lo == null || rango.hi == null) return null;
  const mid = (o.bid != null && o.ask != null) ? (o.bid + o.ask) / 2 : o.last;
  if (mid == null) return null;
  const c = mid * 100;
  return (c >= rango.lo && c <= rango.hi) ? 'ok' : (c >= rango.lo * 0.85 && c <= rango.hi * 1.15) ? 'borde' : 'fuera';
}
async function cargarCadena(forzar) {
  if (!_ord) return; const box = $('#oCadena'); if (!box) return;
  const f = leerFormOrden();
  if (f.tipo === 'EQ' || !f.symbol) { box.innerHTML = ''; return; }
  const brk = _ord.broker || 'etrade';
  const cr = brk === 'schwab' ? (swCreds() ? { schwab: true } : null) : etCreds();
  if (!cr) { box.innerHTML = `<div class="mut" style="margin-top:8px;font-size:11.5px">Cadena en vivo: <a href="#" onclick="MZ.conectar('${brk}');return false">conecta ${esc(BROKER_NOMBRE[brk] || brk)}</a> para ver aquí los precios de calls y puts.</div>`; return; }
  if (brk === 'schwab' ? swVencido() : etDiaVencido()) { box.innerHTML = `<div class="mut" style="margin-top:8px;font-size:11.5px">Cadena en vivo: la sesión de ${esc(BROKER_NOMBRE[brk] || brk)} caducó — <a href="#" onclick="MZ.conectar('${brk}');return false">reconectar</a>.</div>`; return; }
  const clave = f.symbol + '|' + (f.expiracion || '');
  if (!forzar && _ord.cadena && _ord.cadenaClave === clave && Date.now() - _ord.cadenaTs < 5000) return;
  if (_ord.cadenaCargando) return;
  // Generación: si durante un await el usuario cambia ticker/vencimiento (gen++)
  // o cierra/reabre el modal (_ord distinto), ESTA carga se descarta y no toca
  // nada; si el modal sigue, se relanza con el formulario actual.
  const o = _ord, gen = o.cadenaGen;
  const vigente = () => _ord === o && o.cadenaGen === gen;
  const descartar = () => { o.cadenaCargando = false; if (_ord === o) cargarCadena(true); };
  o.cadenaCargando = true;
  if (!o.cadena || o.cadenaClave !== clave) box.innerHTML = `<div class="mut" style="margin-top:8px;font-size:11.5px">Cadena en vivo: consultando E*TRADE…</div>`;
  try {
    const sym = f.symbol;
    if (brk === 'schwab') {
      if (o.cadenaSym !== sym) {
        const [rq, rv] = await Promise.all([swRead('/marketdata/v1/quotes', { symbols: sym }), swRead('/marketdata/v1/expirationchain', { symbol: sym })]);
        if (!vigente()) return descartar();
        if (rq.status === 401 || rv.status === 401) throw new Error(swVencido() ? 'RECONECTAR_SW' : 'Schwab rechazó la lectura (401): ' + (swMensajeError(rq) || swMensajeError(rv) || 'sin detalle'));
        const e1 = swMensajeError(rq) || swMensajeError(rv); if (e1) throw new Error(e1);
        o.cotiz = parsearCotizacionSchwab(rq, sym); o.vencs = parsearVencimientosSchwab(rv); o.cadenaSym = sym;
      } else if (forzar) {
        const rq = await swRead('/marketdata/v1/quotes', { symbols: sym });
        if (!vigente()) return descartar();
        if (rq.status < 400 && !swMensajeError(rq)) o.cotiz = parsearCotizacionSchwab(rq, sym);
      }
    } else if (o.cadenaSym !== sym) {                   // E*TRADE · símbolo nuevo: cotización + vencimientos
      const [rq, rv] = await Promise.all([
        etRead(cr, `/v1/market/quote/${encodeURIComponent(sym)}.json`, { detailFlag: 'INTRADAY' }),
        etRead(cr, '/v1/market/optionexpiredate.json', { symbol: sym, expiryType: 'ALL' }),
      ]);
      if (!vigente()) return descartar();
      if (rq.status === 401 || rv.status === 401) throw new Error(errorCadena401(etError(rq) || etError(rv)));
      const e1 = etError(rq) || etError(rv); if (e1) throw new Error(e1);
      o.cotiz = parsearCotizacion(rq); o.vencs = parsearVencimientos(rv); o.cadenaSym = sym;
    } else if (forzar) {
      const rq = await etRead(cr, `/v1/market/quote/${encodeURIComponent(sym)}.json`, { detailFlag: 'INTRADAY' });
      if (!vigente()) return descartar();
      if (rq.status < 400 && !etError(rq)) o.cotiz = parsearCotizacion(rq);
    }
    o.cotizTs = Date.now();
    // vencimiento: el del formulario si existe en la lista; si no, el del rango vivo; si no, el más cercano
    const vs = o.vencs || [], hoy = hoyNY();
    const rango = (o.ctx && o.ctx.rangos[sym]) || null;
    const exp = (f.expiracion && vs.some(v => v.ymd === f.expiracion)) ? f.expiracion
      : (rango && rango.exp && vs.some(v => v.ymd === rango.exp)) ? rango.exp
      : ((vs.find(v => v.ymd >= hoy) || vs[0] || {}).ymd || f.expiracion || null);
    const ex = $('#oExp'); if (exp && ex && ex.value !== exp) ex.value = exp;
    let cadena = null;
    if (exp) {
      const [y, m, d] = exp.split('-').map(Number);
      const q = { symbol: sym, expiryYear: y, expiryMonth: m, expiryDay: d, noOfStrikes: CADENA_STRIKES,
        includeWeekly: 'true', chainType: 'CALLPUT', priceType: 'ALL', skipAdjusted: 'true' };
      const near = o.cotiz && (o.cotiz.last || o.cotiz.bid); if (near) q.strikePriceNear = near;
      if (brk === 'schwab') {
        const rc = await swRead('/marketdata/v1/chains', { symbol: sym, contractType: 'ALL', strikeCount: CADENA_STRIKES, fromDate: exp, toDate: exp, includeUnderlyingQuote: 'true' });
        if (!vigente()) return descartar();
        if (rc.status === 401) throw new Error(swVencido() ? 'RECONECTAR_SW' : 'Schwab rechazó la lectura (401): ' + (swMensajeError(rc) || 'sin detalle'));
        const e2 = swMensajeError(rc); if (e2) throw new Error(e2);
        cadena = parsearCadenaSchwab(rc);
      } else {
        const rc = await etRead(cr, '/v1/market/optionchains.json', q);
        if (!vigente()) return descartar();
        if (rc.status === 401) throw new Error(errorCadena401(etError(rc)));
        const e2 = etError(rc); if (e2) throw new Error(e2);
        cadena = parsearCadena(rc);
      }
    }
    Object.assign(o, { cadena, cadenaExp: exp, cadenaClave: sym + '|' + (exp || ''), cadenaTs: Date.now(), cadenaErr: null });
  } catch (e) { o.cadenaErr = textoErrorCadena(e); }
  o.cadenaCargando = false;
  if (!vigente()) { if (_ord === o) cargarCadena(true); return; }
  pintarCadena(); pintarAvisosOrden();
  // se refresca sola mientras el formulario esté abierto y sin vista previa en curso
  if (!o.cadenaTimer) o.cadenaTimer = setInterval(() => { if (_ord === o && $('#modalOrden') && !o.orden) cargarCadena(true); }, CADENA_REFRESCO_MS);
}
function pintarCadena() {
  if (!_ord) return; const box = $('#oCadena'); if (!box) return;
  const f = leerFormOrden(); if (f.tipo === 'EQ' || !f.symbol) { box.innerHTML = ''; return; }
  // solo se dibuja la cadena que corresponde al ticker del formulario; si no coincide (cambio en curso), «consultando…»
  const deEsteTicker = String(_ord.cadenaClave || '').split('|')[0] === f.symbol;
  const c = deEsteTicker ? _ord.cadena : null, q = (deEsteTicker || _ord.cadenaSym === f.symbol) ? (_ord.cotiz || {}) : {}, err = deEsteTicker ? _ord.cadenaErr : null;
  // quoteStatus/quoteType de E*TRADE: REALTIME · DELAYED · CLOSING (cierre del
  // día) · EH_* (fuera de horario). Solo DELAYED significa que faltan los acuerdos.
  const est = (c && c.estado) || q.estado || '';
  const vivo = /DELAY/i.test(est) ? '<span style="color:var(--oro)">retrasado — activa cotizaciones en tiempo real en E*TRADE</span>'
    : /REALTIME/i.test(est) ? '<span style="color:var(--verde)">en vivo</span>'
    : /CLOS|EH_/i.test(est) ? '<span class="mut">mercado cerrado · último precio</span>' : '';
  const vs = _ord.vencs || [];
  const sel = vs.length ? `<select id="oCadExp" onchange="MZ.cadenaExp(this.value)" style="width:auto;padding:5px 7px;font-size:12px">${
    vs.slice(0, 14).map(v => `<option value="${v.ymd}" ${v.ymd === _ord.cadenaExp ? 'selected' : ''}>${v.ymd.slice(5)}${/WEEK/i.test(v.tipo) ? ' s' : ''}</option>`).join('')}</select>` : '';
  const rango = (_ord.ctx && _ord.ctx.rangos[f.symbol]) || null;
  const rangoTxt = rango && rango.lo != null ? ` · rango óptimo $${Math.round(rango.lo)}–$${Math.round(rango.hi)}${rango.fuente === 'academia' ? ' (método academia)' : rango.fuente === 'tabla' ? ' (tabla academia)' : ' (delta)'}` : '';
  let h = `<div class="cadena"><div class="fila" style="margin-bottom:4px">
    <span class="mut"><b style="color:var(--tx)">${esc(f.symbol)}</b> ${q.last != null ? '$' + q.last.toFixed(2) : ''} ${(q.bid != null && q.ask != null) ? `<span class="fresco">${q.bid.toFixed(2)}/${q.ask.toFixed(2)}</span>` : ''} ${vivo}</span>
    <span style="display:flex;gap:8px;align-items:center">${sel}<a href="#" onclick="MZ.cadenaRefrescar();return false" style="font-size:13px">↻</a></span></div>`;
  if (err === 'RECONECTAR_SW') h += `<div class="mut" style="color:var(--rojo);font-size:11.5px">Cadena: el login semanal de Schwab caducó — <a href="#" onclick="MZ.conectar('schwab');return false">reconectar Schwab</a></div>`;
  else if (err === 'RECONECTAR') h += `<div class="mut" style="color:var(--rojo);font-size:11.5px">Cadena: la sesión de E*TRADE expiró — <a href="#" onclick="MZ.conectar('etrade');return false">reconectar E*TRADE</a></div>`;
  else if (err) h += `<div class="mut" style="color:var(--rojo);font-size:11.5px">Cadena: ${esc(err)}</div>`;
  else if (!c) h += `<div class="mut" style="font-size:11.5px">consultando E*TRADE…</div>`;
  else if (!c.filas.length) h += `<div class="mut" style="font-size:11.5px">E*TRADE no devolvió strikes para ese vencimiento.</div>`;
  else {
    const spot = q.last != null ? q.last : c.near;
    const dist = spot != null ? Math.min(...c.filas.map(x => Math.abs(x.strike - spot))) : null;
    // in the money: CALL con strike por DEBAJO del precio; PUT con strike por ENCIMA.
    // La línea ATM se traza entre los dos strikes que encierran el precio actual.
    const celda = (o, lado, strike) => {
      if (!o) return '<td></td>';
      const r = enRangoCadena(o, rango);
      const itm = spot != null && (lado === 'CALL' ? strike < spot : strike > spot);
      const cls = (itm ? ' itm' : '') + (r === 'ok' ? ' en-rango' : r === 'borde' ? ' borde' : '');
      const precio = (o.bid != null && o.ask != null) ? `${o.bid.toFixed(2)}/${o.ask.toFixed(2)}` : (o.last != null ? o.last.toFixed(2) : '—');
      const dl = o.delta != null ? ` <small>δ${Math.abs(o.delta).toFixed(2)}</small>` : '';
      const sp = spreadPct(o.bid, o.ask);
      const spTxt = (sp != null && sp >= SPREAD_MAX_PCT) ? ` <small class="sp">▲${sp.toFixed(0)}%</small>` : '';
      return `<td class="cel${cls}" onclick="MZ.cadenaElegir('${lado}',${strike},${o.ask != null ? o.ask : 'null'},${o.bid != null ? o.bid : 'null'})">${precio}${dl}${spTxt}</td>`;
    };
    const lineaAtm = spot != null ? `<tr class="atm-linea"><td colspan="3"><span>ATM · $${spot.toFixed(2)}</span></td></tr>` : '';
    const filas = []; let lineaPuesta = spot == null;
    for (const r of c.filas) {
      if (!lineaPuesta && r.strike >= spot) { filas.push(lineaAtm); lineaPuesta = true; }
      // CALLS a la IZQUIERDA y PUTS a la DERECHA: la convención de E*TRADE, TC2000 y la academia
      filas.push(`<tr class="${dist != null && Math.abs(r.strike - spot) === dist ? 'atm' : ''}">${celda(r.call, 'CALL', r.strike)}<td class="k">${r.strike}</td>${celda(r.put, 'PUT', r.strike)}</tr>`);
    }
    if (!lineaPuesta) filas.push(lineaAtm);
    h += `<table><thead><tr><th style="color:var(--verde)">▲ CALL bid/ask</th><th>strike</th><th style="color:var(--rojo)">▼ PUT bid/ask</th></tr></thead><tbody>${filas.join('')}</tbody></table>
      <div class="fresco leyenda" style="margin-top:5px"><span class="sw itm"></span> in the money · <span class="sw otm"></span> out of the money · <span style="color:var(--oro);font-weight:700">━</span> at the money${spot != null ? ' $' + spot.toFixed(2) : ''} · <span class="sw rango"></span> prima en rango${rangoTxt} · <span style="color:var(--rojo);font-weight:700">▲</span> spread ≥${SPREAD_MAX_PCT}% (no comprar)</div>
      <div class="fresco" style="margin-top:3px">toca un precio para llenar la orden · vence ${esc(_ord.cadenaExp || '')} · ${esc(horaNY(_ord.cadenaTs))}</div>`;
  }
  box.innerHTML = h + '</div>';
}
function cadenaElegir(lado, strike, ask, bid) {
  if (!_ord) return;
  const f = leerFormOrden();
  // cinturón: si la tabla que se ve no es del ticker del formulario (cambio en curso), no llenar nada
  if (!_ord.cadena || String(_ord.cadenaClave || '').split('|')[0] !== f.symbol) { pintarCadena(); return; }
  const tipo = $('#oTipo'), st = $('#oStrike'), ex = $('#oExp'), pt = $('#oPt'), pr = $('#oPrecio');
  if (tipo && (lado === 'CALL' || lado === 'PUT')) tipo.value = lado;
  if (st) st.value = strike;
  if (ex && _ord.cadenaExp) ex.value = _ord.cadenaExp;
  if (pt && !['LIMIT', 'STOP', 'TRAILING_STOP_PRCT'].includes(pt.value)) pt.value = 'LIMIT';
  // compra: al ask (se llena); venta: al bid — editable después
  const p = f.accion === 'venta' ? (bid != null ? bid : ask) : (ask != null ? ask : bid);
  if (pr && pt && pt.value === 'LIMIT' && p != null) pr.value = Number(p).toFixed(2);
  autoCantidad();                                   // prearma la cantidad con el presupuesto del plan (% del saldo)
  ajustarFormOrden(); pintarAvisosOrden(); pintarTotalOrden(); pintarCadena();
  toast(`${lado} ${strike} elegido${p != null ? ' a $' + Number(p).toFixed(2) : ''}`);
}
// Contexto de doctrina (rango por ticker, cupo semanal y del día, saldo, hora, plan): una consulta.
async function cargarCtxOrden() {
  const [te, pos, bt, cs] = await Promise.all([
    sb.from('ticker_estado').select('symbol,payload'),
    sb.from('posiciones').select('*'),
    sb.from('broker_trades').select('*'),
    sb.from('cuenta_snapshots').select('broker,saldo_neto'),
    cargarPlanUsuario(),
  ]);
  const est = te.data || [];
  const merc = est.find(e => e.symbol === 'MERCADO');
  const rangos = {};
  est.forEach(e => { const p = e.payload || {}; rangos[e.symbol] = componerRango(p.rango_vivo || null, p.rango_academia || null, RANGOS_TABLA[e.symbol] || null); });
  const lun = lunesNY(), hoy = hoyNY();
  const unidas = unirOperaciones(pos.data || [], bt.data || []).ops;
  const opsSemana = unidas.filter(p => (p.abierta_fecha_ny || '') >= lun).length;
  const opsHoy = unidas.filter(p => (p.abierta_fecha_ny || '') === hoy).length;
  // saldo por bróker (una fila por bróker en cuenta_snapshots) + total
  const saldos = {};
  (cs.data || []).forEach(c => { if (c.broker) saldos[c.broker] = Number(c.saldo_neto) || 0; });
  // E*TRADE: si hay saldo vivo reciente en este equipo (caché de 5 min), manda ese
  try { const c = JSON.parse(localStorage.getItem(ET_K.cache) || 'null'); if (c && c.snap && Number(c.snap.saldo_neto) > 0) saldos.etrade = Number(c.snap.saldo_neto); } catch (_) {}
  try { const c = JSON.parse(localStorage.getItem(SW_K.cache) || 'null'); if (c && c.snap && Number(c.snap.saldo_neto) > 0) saldos.schwab = Number(c.snap.saldo_neto); } catch (_) {}
  const saldo = Object.values(saldos).reduce((s, v) => s + v, 0);
  const broker = (_ord && _ord.broker) || 'etrade';       // bróker elegido en el formulario
  const saldoBroker = saldos[broker] > 0 ? saldos[broker] : null;
  const plan = planActivo(), antes1030 = antesDe1030NY(merc);
  if (_ord) _ord.ctx = { rangos, opsSemana, opsHoy, saldo, saldos, broker, saldoBroker, antes1030, plan,
    fueraVentana: fueraVentanaNY(plan.ventanaMin), focoHoy: focoDeHoy(planFilaCache(), hoy),
    expHoyTras1030: antes1030 ? null : hoy };        // la fecha NY de hoy si ya pasaron las 10:30 ET; si no, null
}
// Cantidad prearmada: presupuesto (% del plan sobre el saldo del bróker) ÷ valor del contrato.
// Solo en compras, solo si el usuario no tocó la cantidad a mano y hay precio.
function autoCantidad() {
  if (!_ord || _ord.qtyManual) return;
  const f = leerFormOrden(); const q = $('#oQty'); if (!q) return;
  if (f.accion === 'venta' || f.priceType !== 'LIMIT') return;
  const n = cantidadPorPresupuesto(presupuestoTicket(_ord.ctx), f.limitPrice, f.tipo !== 'EQ');
  if (n != null && String(n) !== String(q.value)) { q.value = n; pintarAvisosOrden(); }
}
function pintarTotalOrden() {
  if (!_ord) return; const el = $('#oTotal'), pr = $('#oPresup'); if (!el || !pr) return;
  const f = leerFormOrden();
  const pct = presupuestoPct(), presup = presupuestoTicket(_ord.ctx, pct);
  const brokerTxt = BROKER_NOMBRE[(_ord.ctx && _ord.ctx.broker) || _ord.broker || 'etrade'] || 'la cuenta';
  pr.textContent = presup != null ? `${pct}% de ${brokerTxt} = ${usd(presup)}` : `${pct}% de ${brokerTxt} (sin saldo aún)`;
  const t = totalOrden(f);
  const qty = Number(f.cantidad) || 0, precio = f.priceType === 'LIMIT' ? Number(f.limitPrice) : Number(f.stopPrice);
  el.textContent = t == null ? 'Total —'
    : `Total ${usd(t)}${qty > 0 && precio > 0 ? ` = ${qty} × $${precio.toFixed(2)}${f.tipo === 'EQ' ? '' : ' × 100'}` : ''}`;
  el.style.color = (t != null && presup != null && t > presup * 1.001) ? 'var(--rojo)' : '';
}
function leerFormOrden() {
  const g = (id) => { const el = $('#' + id); return el ? String(el.value || '') : ''; };
  const pt = g('oPt'), precio = g('oPrecio');
  return { symbol: g('oSym').trim().toUpperCase(), tipo: g('oTipo'), accion: g('oAcc'),
    strike: g('oStrike'), expiracion: g('oExp'), cantidad: g('oQty'), orderTerm: g('oTerm'), priceType: pt,
    limitPrice: pt === 'LIMIT' ? precio : '', stopPrice: pt === 'STOP' ? precio : '',
    offsetValue: pt === 'TRAILING_STOP_PRCT' ? precio : '' };
}
function ajustarFormOrden() {
  const tipo = $('#oTipo'), acc = $('#oAcc'), pt = $('#oPt'), wrap = $('#oPrecioWrap'), lbl = $('#oPrecioLbl'), optn = $('#oOptn');
  if (!tipo || !acc || !pt || !wrap || !lbl || !optn) return;
  optn.classList.toggle('oculto', tipo.value === 'EQ');
  // STOP y trailing solo para salidas (ventas)
  const venta = acc.value === 'venta';
  Array.from(pt.options).forEach(op => { if (op.value === 'STOP' || op.value === 'TRAILING_STOP_PRCT') op.disabled = !venta; });
  if (!venta && (pt.value === 'STOP' || pt.value === 'TRAILING_STOP_PRCT')) pt.value = 'LIMIT';
  wrap.classList.toggle('oculto', pt.value === 'MARKET');
  const gw = $('#oGtcAutoWrap'); if (gw) gw.classList.toggle('oculto', venta);
  lbl.textContent = pt.value === 'LIMIT' ? (tipo.value === 'EQ' ? 'Límite (por acción)' : 'Límite (por contrato)')
    : pt.value === 'STOP' ? 'Precio stop' : pt.value === 'TRAILING_STOP_PRCT' ? 'Trailing (%)' : 'Precio';
}
function pintarArmadoOrden() {
  const el = $('#oArm'); if (!el) return;
  const h = armadoHasta();
  el.textContent = h ? 'armado hasta ' + horaNY(h) : 'desarmado · pide PIN';
  el.style.color = h ? 'var(--verde)' : '';
}
function pintarAvisosOrden() {
  if (!_ord) return;
  const box = $('#oAvisos'); if (!box) return;
  const f = leerFormOrden();
  const c = _ord.ctx;
  const cad = (_ord.cadena && String(_ord.cadenaClave || '').split('|')[0] === f.symbol) ? _ord.cadena : null;
  const av = c ? avisosOrden(f, { rango: c.rangos[f.symbol] || null, opsSemana: c.opsSemana, saldo: c.saldo, saldoBroker: c.saldoBroker, antes1030: c.antes1030, spread: spreadDeForm(f, cad),
    plan: c.plan, opsHoy: c.opsHoy, focoHoy: c.focoHoy, expHoyTras1030: c.expHoyTras1030,
    posicionId: (_ord.pre && _ord.pre.posicion_id) || null,
    fueraVentana: (c.plan && c.plan.ventanaMin) ? fueraVentanaNY(c.plan.ventanaMin) : c.fueraVentana }) : [];   // la ventana se mira con el reloj de AHORA
  _ord.avisos = av;
  const txt = av.join('\n');
  if (txt === _ord.avisosTxt) return;   // sin cambios: no tocar el checkbox
  // Un aviso NUEVO exige volver a aceptar: el override es explícito por aviso.
  const nuevos = av.some(a => !(_ord.avisosPrev || []).includes(a));
  _ord.avisosTxt = txt; _ord.avisosPrev = av.slice();
  const marcado = !nuevos && !!($('#oOverride') && $('#oOverride').checked);
  box.innerHTML = av.length ? `<div class="aviso"><div style="font-weight:700;margin-bottom:3px">Avisos de doctrina</div>
    ${av.map(a => `<div>· ${esc(a)}</div>`).join('')}
    <label class="check"><input type="checkbox" id="oOverride" ${marcado ? 'checked' : ''}> Entiendo, rompo la regla</label></div>` : '';
}
function bloquearFormOrden(si) {
  const m = $('#modalOrden'); if (!m) return;
  m.querySelectorAll('input, select').forEach(el => { el.disabled = !!si; });
  const b = $('#oBtnPrev'); if (b) b.classList.toggle('oculto', !!si);
}

async function ordenPreview() {
  if (!_ord) return;
  const o0 = _ord;   // el formulario que pidió la vista previa (si al volver ya es otro, no se toca)
  const err = $('#oErr'), btn = $('#oBtnPrev');
  if (!err || !btn) return;
  err.textContent = '';
  // una orden de este formulario aún en vuelo o sin respuesta clara puede estar viva: no se
  // previsualiza otra encima (verifica en el bróker y abre un formulario nuevo)
  if (_ord.enviando) { err.textContent = 'Espera la respuesta del bróker a la orden que enviaste.'; return; }
  if (_ord.indeterminado) { err.textContent = 'Verifica en el bróker si la orden entró antes de reintentar.'; return; }
  const f = leerFormOrden();
  const e1 = validarOrden(f); if (e1) { err.textContent = e1; return; }
  const preB = _ord.pre || {};
  if (preB.posicion_id && preB.broker && preB.broker !== (_ord.broker || 'etrade')) { err.textContent = 'Esta salida es de ' + (BROKER_NOMBRE[preB.broker] || preB.broker) + '; no puede ir por otro bróker.'; return; }
  pintarAvisosOrden();
  const av = _ord.avisos || [];
  if (requiereOverride(av) && !($('#oOverride') && $('#oOverride').checked)) {
    err.textContent = 'Hay avisos de doctrina: marca «Entiendo, rompo la regla» para seguir, o corrige la orden.'; return;
  }
  if ((_ord.broker || 'etrade') === 'schwab') return ordenPreviewSchwab(f, av, err, btn);
  // 1) credenciales de E*TRADE (viven en este dispositivo) — antes del PIN,
  //    para no hacer teclear el PIN si falta el login diario
  const cr = etCreds();
  if (!cr) { err.textContent = 'Conecta E*TRADE primero: Cuentas → E*TRADE → Conectar (login diario).'; return; }
  if (etDiaVencido()) { err.textContent = 'La sesión de E*TRADE expiró a medianoche ET. Reconecta en Cuentas → E*TRADE.'; return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { err.textContent = 'Sin sesión. Sal y vuelve a entrar.'; return; }
  // 2) la vista previa NO pide PIN (no coloca nada en E*TRADE); el PIN arma el ENVÍO
  //    (ordenPlace). Así el GTC automático tras un fill queda previsualizado sin fricción.
  pintarArmadoOrden();
  btn.disabled = true; btn.textContent = 'Consultando E*TRADE…';
  const pre = _ord.pre || {};
  const proposito = propositoDe(f, pre);
  const planO = (_ord.ctx && _ord.ctx.plan) || planActivo();   // plan que se CONGELA en la compra
  const orden = construirOrden({ ...f, clientOrderId: clientOrderIdNuevo() });
  const rango = _ord.ctx && _ord.ctx.rangos[f.symbol] || null;
  const semaforo = (f.tipo !== 'EQ' && f.accion !== 'venta' && f.priceType === 'LIMIT') ? semaforoRango(Number(f.limitPrice), rango) : null;
  const extra = { proposito, senal_id: pre.senal_id || null,
    posicion_id: (f.accion === 'venta' && pre.posicion_id) ? pre.posicion_id : null };
  let r = null;
  try {
    const accountIdKey = await etCuentaKey(cr);
    r = await etPost(cr, '/etrade/orden/preview', { accountIdKey, orden });
    const d = r.data || {}, P = d.PreviewOrderResponse || d;
    const em = mensajeError(r);
    const ids = P.PreviewIds ? (Array.isArray(P.PreviewIds) ? P.PreviewIds : [P.PreviewIds]) : [];
    if (r.status >= 400 || em || !ids.length) {
      // Sesión de E*TRADE muerta (401 aun tras renovar): es un problema de login,
      // no de la orden → no se anota nada.
      if (r.status === 401) throw new Error(texto401Ordenes(em));
      // E*TRADE la rechazó en la vista previa ({Error:{message}}): queda anotada
      // como rechazada con su respuesta. Un fallo del PROXY (404/403) no se anota.
      if (d.Error && d.Error.message) {
        await sb.from('ordenes').insert({ ...filaOrdenDe(f, orden, extra), user_id: uid, estado: 'rechazada',
          overrides: av, respuesta: recortarJson(d, 4096) }).then(() => {}, () => {});
      }
      throw new Error(em || 'E*TRADE no devolvió vista previa (HTTP ' + r.status + ').');
    }
    const previewIds = ids.map(x => Object.assign({ previewId: x.previewId }, x.cashMargin ? { cashMargin: x.cashMargin } : {}));
    const fila = { ...filaOrdenDe(f, orden, extra), user_id: uid, estado: 'preview', overrides: av,
      preview: Object.assign({ _mz: { semaforo, rango: rango ? { lo: rango.lo, hi: rango.hi } : null,
        gtc_auto: f.accion !== 'venta' && !!($('#oGtcAuto') && $('#oGtcAuto').checked),
        plan_pct: f.accion !== 'venta' ? planO.gtcPct : null, stop_pct: f.accion !== 'venta' ? planO.stopPct : null } }, recortarJson(P, 4000)) };
    const ins = await sb.from('ordenes').insert(fila).select('id').single();
    if (ins.error) throw new Error('No pude guardar la vista previa: ' + ins.error.message);
    // volvió tarde y el formulario ya es otro (cerrado, un corte o la GTC automática):
    // jamás se guarda en el ajeno — la fila se anota expirada y no se toca nada más
    if (_ord !== o0) { sb.from('ordenes').update({ estado: 'expirada' }).eq('id', ins.data.id).then(() => {}, () => {}); return; }
    Object.assign(_ord, { f, orden, previewIds, filaId: ins.data.id, estadoFila: 'preview', indeterminado: false, accountIdKey, caduca: Date.now() + PREVIEW_SEG * 1000 });
    pintarPreviewOrden(P);
    bloquearFormOrden(true);
  } catch (e) {
    if (_ord === o0) err.textContent = String((e && e.message) || e);
  }
  if (_ord === o0) { btn.disabled = false; btn.textContent = textoBotonPreview(_ord && _ord.broker); }
}
// Schwab NO tiene vista previa en su API: la «revisión» es local (misma fila
// 'preview' en la bitácora, mismo reloj de 3 min, mismo PIN al enviar).
async function ordenPreviewSchwab(f, av, err, btn) {
  const o0 = _ord;   // ver ordenPreview: la revisión solo se guarda en el formulario que la pidió
  if (!swCreds()) { err.textContent = 'Conecta Schwab primero: Cuentas → Charles Schwab → Conectar (login semanal).'; return; }
  if (swVencido()) { err.textContent = 'El login semanal de Schwab caducó. Reconecta en Cuentas → Charles Schwab.'; return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { err.textContent = 'Sin sesión. Sal y vuelve a entrar.'; return; }
  pintarArmadoOrden();
  btn.disabled = true; btn.textContent = 'Revisando…';
  const pre = _ord.pre || {};
  const proposito = propositoDe(f, pre);
  const planO = (_ord.ctx && _ord.ctx.plan) || planActivo();   // plan que se CONGELA en la compra
  const orden = construirOrdenSchwab(f);
  const rango = _ord.ctx && _ord.ctx.rangos[f.symbol] || null;
  const semaforo = (f.tipo !== 'EQ' && f.accion !== 'venta' && f.priceType === 'LIMIT') ? semaforoRango(Number(f.limitPrice), rango) : null;
  const extra = { proposito, senal_id: pre.senal_id || null, posicion_id: (f.accion === 'venta' && pre.posicion_id) ? pre.posicion_id : null };
  try {
    const hash = await swCuenta();
    let num = ''; try { num = localStorage.getItem(SW_K.num) || ''; } catch (_) {}
    const cuentaTxt = num ? ' ' + mascaraCuenta(num) : '';
    const filaBase = () => ({ ...filaOrdenSchwab({ ...f, clientOrderId: clientOrderIdNuevo() }, orden, extra), user_id: uid, overrides: av });
    // vista previa REAL de Schwab (previewOrder): valida y cotiza sin colocar nada
    const rp = await swPost('/schwab/orden/preview', { hash, orden });
    let P = null, nota = '';
    if (rp.status === 401) throw new Error('La sesión de Schwab caducó — reconecta en Cuentas → Charles Schwab.');
    const emp = swMensajeError(rp);
    if (rp.status === 200 && rp.data && typeof rp.data === 'object' && !emp) P = rp.data;
    else if ([400, 422].includes(rp.status) && rp.data && (rp.data.message || rp.data.errors)) {
      await sb.from('ordenes').insert({ ...filaBase(), estado: 'rechazada', respuesta: recortarJson(rp.data, 4096) }).then(() => {}, () => {});
      throw new Error('Schwab rechazó la orden en la revisión: ' + (emp || 'sin detalle'));
    } else nota = 'Schwab no devolvió vista previa (HTTP ' + rp.status + (emp ? ': ' + emp : '') + '): revisión local.';
    const res = resumenPreviewSchwab(P);
    if (res.rechazos.length) {
      await sb.from('ordenes').insert({ ...filaBase(), estado: 'rechazada', respuesta: recortarJson(P, 4096) }).then(() => {}, () => {});
      throw new Error('Schwab rechazó la orden en la revisión: ' + res.rechazos.join(' · '));
    }
    const fila = { ...filaBase(), estado: 'preview',
      preview: Object.assign({ _mz: { semaforo, rango: rango ? { lo: rango.lo, hi: rango.hi } : null, gtc_auto: f.accion !== 'venta' && !!($('#oGtcAuto') && $('#oGtcAuto').checked), local: !P,
          plan_pct: f.accion !== 'venta' ? planO.gtcPct : null, stop_pct: f.accion !== 'venta' ? planO.stopPct : null },
        orden: recortarJson(orden, 3000), total: totalOrden(f) }, P ? recortarJson(P, 3500) : {}) };
    const ins = await sb.from('ordenes').insert(fila).select('id').single();
    if (ins.error) throw new Error('No pude guardar la revisión: ' + ins.error.message);
    if (_ord !== o0) { sb.from('ordenes').update({ estado: 'expirada' }).eq('id', ins.data.id).then(() => {}, () => {}); return; }
    Object.assign(_ord, { f, orden, previewIds: [{ local: !P, schwab: !!P }], filaId: ins.data.id, estadoFila: 'preview', indeterminado: false, accountIdKey: hash, caduca: Date.now() + PREVIEW_SEG * 1000 });
    const msgs = [`Al tocar «Enviar», la orden entra directo a tu cuenta de Schwab${cuentaTxt} (${orden.orderLegCollection[0].instrument.symbol.trim()}).`].concat(res.avisos, nota ? [nota] : []);
    pintarPreviewOrden({ _local: !P, estimatedTotalAmount: res.valor != null ? res.valor : totalOrden(f), estimatedCommission: res.comision,
      Order: [{ messages: { Message: msgs.map(m => ({ description: m })) } }] });
    bloquearFormOrden(true);
  } catch (e) {
    if (_ord === o0) err.textContent = String((e && e.message) || e);
  }
  if (_ord === o0) { btn.disabled = false; btn.textContent = textoBotonPreview('schwab'); }
}
// Lee lo útil de la respuesta de previewOrder de Schwab (forma tolerante):
// valor de la orden, comisión proyectada, rechazos y avisos.
function resumenPreviewSchwab(P) {
  const out = { valor: null, comision: null, rechazos: [], avisos: [] };
  if (!P || typeof P !== 'object') return out;
  const os = P.orderStrategy || P;
  const bal = os.orderBalance || P.orderBalance || {};
  out.valor = num2(bal.orderValue);
  out.comision = num2(bal.projectedCommission);
  if (out.comision == null) {
    const c = (P.commissionAndFee || {}).commission || {}; let tot = 0, hay = false;
    for (const leg of (c.commissionLegs || [])) for (const v of (leg.commissionValues || [])) { const n = Number(v.value); if (Number.isFinite(n)) { tot += n; hay = true; } }
    if (hay) out.comision = Math.round(tot * 100) / 100;
  }
  const vr = os.orderValidationResult || P.orderValidationResult || {};
  const txt = (x) => (x && (x.message || x.description || x.activityMessage)) || (typeof x === 'string' ? x : (x ? JSON.stringify(x) : ''));
  out.rechazos = (vr.rejects || []).map(txt).filter(Boolean);
  out.avisos = [].concat(vr.warns || [], vr.alerts || [], vr.reviews || []).map(txt).filter(Boolean);
  return out;
}
function pintarPreviewOrden(P) {
  const box = $('#oPrev'); if (!box || !_ord) return;
  const o = (Array.isArray(P.Order) ? P.Order[0] : P.Order) || {};
  const msgs = (((o.messages || {}).Message) || []).map(x => x && x.description).filter(Boolean);
  const n = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) < 0 ? '-$' : '$') + Math.abs(Number(v)).toFixed(2);
  box.innerHTML = `<div class="prevbox">
    <div class="fila"><span class="mut">Costo estimado</span><b class="mono">${n(P.estimatedTotalAmount)}</b></div>
    ${P._local || P.estimatedCommission == null ? '' : `<div class="fila"><span class="mut">Comisión</span><b class="mono">${n(P.estimatedCommission)}</b></div>`}
    ${P.estimatedFees != null && Number(P.estimatedFees) ? `<div class="fila"><span class="mut">Tarifas</span><b class="mono">${n(P.estimatedFees)}</b></div>` : ''}
    ${P.totalOrderValue != null ? `<div class="fila"><span class="mut">Valor de la orden</span><b class="mono">${n(P.totalOrderValue)}</b></div>` : ''}
    ${msgs.length ? `<div class="mut" style="margin-top:6px;font-size:11.5px">${msgs.map(esc).join('<br>')}</div>` : ''}
    <button class="pri" id="oBtnPlace" style="width:100%;margin-top:10px" onclick="MZ.ordenPlace()">Enviar orden (3:00)</button>
    <button class="btnsec" style="width:100%;margin-top:6px" onclick="MZ.ordenEditar()">Editar la orden</button>
  </div>`;
  if (_ord.timer) clearInterval(_ord.timer);
  const tick = () => {
    const b = $('#oBtnPlace'); if (!b || !_ord) return;
    const s = Math.max(0, Math.round((_ord.caduca - Date.now()) / 1000));
    if (s <= 0) { b.disabled = true; b.textContent = 'Vista previa caducada — vuelve a previsualizar'; _ord.previewIds = null; clearInterval(_ord.timer); expirarPreviewHuerfana(); return; }
    b.textContent = `Enviar orden (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  };
  tick(); _ord.timer = setInterval(tick, 1000);
}
function ordenEditar() {
  if (_ord && _ord.enviando) { toast('Espera la respuesta del bróker antes de editar la orden.'); return; }
  if (!_ord) return;
  if (_ord.indeterminado) { toast('Verifica en E*TRADE si la orden entró antes de editar'); return; }
  if (_ord.timer) clearInterval(_ord.timer);
  expirarPreviewHuerfana();
  _ord.orden = null; _ord.previewIds = null; _ord.filaId = null; _ord.caduca = 0;
  const p = $('#oPrev'); if (p) p.innerHTML = '';
  bloquearFormOrden(false);
}
// El único paso que coloca la orden: lo dispara el usuario con «Enviar orden».
async function ordenPlace() {
  if (!_ord || !_ord.orden) return;
  const o0 = _ord;   // el formulario que se va a enviar: tras cada await se usa ESTE, no el global
  const err = $('#oErr'), b = $('#oBtnPlace');
  if (!err || !b) return;
  if (o0.enviando) return;   // ya hay un envío de este formulario en vuelo
  err.textContent = '';
  if (_ord.indeterminado) { err.textContent = 'Verifica en E*TRADE si la orden entró antes de reintentar.'; return; }
  if (!_ord.previewIds || Date.now() > _ord.caduca) { err.textContent = 'La vista previa caducó (3 min). Vuelve a previsualizar.'; return; }
  if (!armadoHasta() && !(await pedirPin())) { err.textContent = 'Sin PIN no se opera.'; return; }
  // mientras se tecleaba el PIN el formulario pudo cerrarse o ser OTRO (la GTC automática,
  // un corte): ese PIN no envía nada ajeno
  if (_ord !== o0) return;
  // el PIN pudo tardar: la vista previa debe seguir vigente
  if (!_ord.previewIds || Date.now() > _ord.caduca) { err.textContent = 'La vista previa caducó mientras tecleabas el PIN. Vuelve a previsualizar.'; return; }
  if ((_ord.broker || 'etrade') === 'schwab') return ordenPlaceSchwab(err, b, o0);
  const cr = etCreds();
  if (!cr) { err.textContent = 'Conecta E*TRADE primero.'; return; }
  const id = o0.filaId, ahora = () => new Date().toISOString();
  const anotar = async (estado, extra) => {
    if (!id) return null;
    const { error } = await sb.from('ordenes').update(Object.assign({ estado, actualizado_at: ahora() }, extra || {})).eq('id', id);
    if (!error) o0.estadoFila = estado;
    return error || null;
  };
  // «Cancelar» sigue activo durante el envío (el POST no tiene tope): si al volver el formulario
  // ya se cerró o es OTRO (p. ej. un corte), la respuesta se anota y se avisa sin tocar el ajeno.
  const propio = () => _ord === o0;
  o0.enviando = true;
  b.disabled = true; b.textContent = 'Enviando a E*TRADE…';
  let r = null, indeterminado = false;
  try {
    r = await etPost(cr, '/etrade/orden/place', { accountIdKey: o0.accountIdKey, orden: o0.orden, previewIds: o0.previewIds });
    const d = r.data || {}, R = d.PlaceOrderResponse || d;
    const em = mensajeError(r);
    const ids = R.OrderIds ? (Array.isArray(R.OrderIds) ? R.OrderIds : [R.OrderIds]) : [];
    // ¿Quién respondió? Solo es un RECHAZO seguro si habló E*TRADE ({Error} o
    // PlaceOrderResponse sin OrderIds) o si el proxy la paró ANTES de llamar
    // (400/401/403 con {error}). Un 5xx o una respuesta sin forma llega DESPUÉS
    // de que la orden pudo salir hacia E*TRADE → indeterminado: nunca 'rechazada'.
    const habloEtrade = !!(d.PlaceOrderResponse || (d.Error && d.Error.message));
    const paroProxy = [400, 401, 403].includes(r.status) && !!d.error && !d.Error;
    if (r.status >= 500 || (!habloEtrade && !paroProxy)) {
      indeterminado = true;
      throw new Error('Sin respuesta clara de E*TRADE al enviar (HTTP ' + r.status + ').');
    }
    if (r.status >= 400 || em || !ids.length || ids[0].orderId == null) {
      await anotar('rechazada', { respuesta: recortarJson(d, 4096) });
      throw new Error(em || 'E*TRADE no confirmó la orden (HTTP ' + r.status + ').');
    }
    const datos = { orden_id_ext: String(ids[0].orderId), respuesta: recortarJson(R, 4096) };
    let e2 = await anotar('enviada', datos);
    if (e2) e2 = await anotar('enviada', datos);   // la orden está viva en E*TRADE: reintento de anotación
    if (e2) toast('Orden #' + ids[0].orderId + ' enviada, pero no pude anotarla: verifica en E*TRADE');
    if (o0.timer) clearInterval(o0.timer);
    toast('Orden enviada a E*TRADE');
    if (propio()) cerrarOrden();
    ruta();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!r || indeterminado) {
      // No se sabe si entró → 'error' y se exige verificar en E*TRADE (jamás
      // inventar éxito ni permitir un reintento a ciegas que la duplique).
      o0.indeterminado = true;
      try { await anotar('error', { respuesta: { error: msg, nota: 'sin respuesta clara al enviar: verifica en E*TRADE' } }); } catch (_) {}
      if (propio()) { err.textContent = msg + ' Verifica en E*TRADE si la orden entró ANTES de reintentar.'; b.disabled = true; b.textContent = 'Verifica en E*TRADE'; }
      else { alert(msg + ' Verifica en E*TRADE si esa orden entró ANTES de repetirla.'); ruta(); }
      return;
    }
    if (propio()) { err.textContent = msg; b.disabled = false; b.textContent = 'Enviar orden'; }
    else toast(msg);
  } finally { o0.enviando = false; }
}

// Envío a Schwab: POST directo (201 + id en Location). Misma semántica de
// rechazo/indeterminado que E*TRADE: solo es rechazo si habló Schwab (400 con
// message/errors) o el proxy paró ANTES (400/403 con {error}).
async function ordenPlaceSchwab(err, b, o0) {
  const id = o0.filaId, ahora = () => new Date().toISOString();
  const anotar = async (estado, extra) => {
    if (!id) return null;
    const { error } = await sb.from('ordenes').update(Object.assign({ estado, actualizado_at: ahora() }, extra || {})).eq('id', id);
    if (!error) o0.estadoFila = estado;
    return error || null;
  };
  const propio = () => _ord === o0;   // ver ordenPlace
  o0.enviando = true;
  b.disabled = true; b.textContent = 'Enviando a Schwab…';
  let r = null, indeterminado = false;
  try {
    r = await swPost('/schwab/orden/place', { hash: o0.accountIdKey, orden: o0.orden });
    const d = r.data || {};
    const em = swMensajeError(r);
    if (r.status === 401) throw new Error('La sesión de Schwab caducó — reconecta en Cuentas → Charles Schwab.');
    const paroProxy = [400, 403].includes(r.status) && !!d.error;
    const habloSchwab = (r.status === 200 && d.orderId != null) || (r.status === 400 && !!(d.message || d.errors));
    if (r.status >= 500 || (!habloSchwab && !paroProxy)) {
      indeterminado = true;
      throw new Error('Sin respuesta clara de Schwab al enviar (HTTP ' + r.status + ').');
    }
    if (r.status >= 400 || d.orderId == null) {
      await anotar('rechazada', { respuesta: recortarJson(d, 4096) });
      throw new Error(em || 'Schwab no confirmó la orden (HTTP ' + r.status + ').');
    }
    const datos = { orden_id_ext: String(d.orderId), respuesta: recortarJson(d, 4096) };
    let e2 = await anotar('enviada', datos);
    if (e2) e2 = await anotar('enviada', datos);
    if (e2) toast('Orden #' + d.orderId + ' enviada a Schwab, pero no pude anotarla: verifícala en Schwab');
    if (o0.timer) clearInterval(o0.timer);
    toast('Orden enviada a Schwab');
    if (propio()) cerrarOrden();
    ruta();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!r || indeterminado) {
      o0.indeterminado = true;
      try { await anotar('error', { respuesta: { error: msg, nota: 'sin respuesta clara al enviar: verifica en Schwab' } }); } catch (_) {}
      if (propio()) { err.textContent = msg + ' Verifica en Schwab si la orden entró ANTES de reintentar.'; b.disabled = true; b.textContent = 'Verifica en Schwab'; }
      else { alert(msg + ' Verifica en Schwab si esa orden entró ANTES de repetirla.'); ruta(); }
      return;
    }
    if (propio()) { err.textContent = msg; b.disabled = false; b.textContent = 'Enviar orden'; }
    else toast(msg);
  } finally { o0.enviando = false; }
}

// ---- Copiloto: ÓRDENES EN TU BRÓKER (E*TRADE y Schwab) ----
function seccionOrdenes(filas) {
  const sinc = _ordSync.err ? `<span style="color:var(--rojo)">${esc(_ordSync.err)} — <a href="#" onclick="location.hash='#/cuentas';return false">Cuentas</a></span>`
    : _ordSync.ts ? `sincronizado con el bróker ${esc(horaNY(_ordSync.ts))} NY · se actualiza sola` : 'se sincroniza sola con el bróker';
  let h = `<div class="sec fila" style="margin-top:8px">ÓRDENES ACTIVAS EN TU BRÓKER
    <a href="#" onclick="MZ.ordenesActualizar();return false">Actualizar ahora</a></div>`;
  if (!filas.length) return h + `<div class="card vacio">Sin órdenes activas en tu bróker.<br><span class="fresco">${sinc}</span></div>`;
  return h + filas.map(tarjetaOrden).join('') + `<div class="fresco" style="margin:2px 4px 6px">${sinc}</div>`;
}
// Estado que muestra la tarjeta: 'enviada' = ACTIVA en E*TRADE (o CANCELANDO /
// PARCIAL según el último detalle sincronizado); 'error' = no se pudo confirmar.
function etiquetaOrden(o) {
  const det = (((o.respuesta || {})._etrade || {}).OrderDetail || [])[0] || {};
  const st = String((((o.respuesta || {})._vivo || {}).status) || det.status || '').toUpperCase();
  if (o.estado === 'enviada') return (st === 'CANCEL_REQUESTED' || st === 'PENDING_CANCEL') ? 'CANCELANDO' : st === 'PARTIAL' ? 'PARCIAL' : 'ACTIVA';
  if (o.estado === 'error') return 'VERIFICA';
  return String(o.estado || '').toUpperCase();
}
function tarjetaOrden(o) {
  const chip = { preview: 'c-esp', enviada: 'c-vig', ejecutada: 'c-op', cancelada: 'c-esp', expirada: 'c-esp', rechazada: 'c-vet', error: 'c-vet' }[o.estado] || 'c-esp';
  const n2 = (v) => v == null ? '—' : Number(v).toFixed(2);
  const contrato = o.security_type === 'EQ' ? `${o.symbol} · acción`
    : `${o.symbol} ${o.direccion || ''} ${o.strike != null ? Number(o.strike) : ''}${o.expiracion ? ' · ' + fmtFechaNY(o.expiracion + 'T12:00:00Z') : ''}`;
  const precio = o.price_type === 'LIMIT' ? `límite $${n2(o.limit_price)}` : o.price_type === 'STOP' ? `stop $${n2(o.stop_price)}`
    : o.price_type === 'TRAILING_STOP_PRCT' ? `trailing ${Number(o.offset_value)}%` : o.price_type === 'MARKET' ? 'mercado' : esc(o.price_type);
  const prop = { entrada: 'entrada', salida_gtc: 'salida GTC', salida_stop: 'salida stop', salida_corte: 'salida de corte', cancelar: 'cancelar', otro: 'otra' }[o.proposito] || o.proposito;
  const ov = Array.isArray(o.overrides) ? o.overrides : [];
  const ppO = planCongelado((o.preview || {})._mz).plan_pct;   // plan congelado en la compra
  return `<div class="card">
    <div class="fila"><span><span class="chip ${chip}">${esc(etiquetaOrden(o))}</span>${o.broker && o.broker !== 'etrade' ? ` <span class="chip c-esp">${esc(BROKER_NOMBRE[o.broker] || o.broker)}</span>` : ''}</span>
      <span class="fresco">${esc(fmtFechaNY(o.creado_at, true))} NY</span></div>
    ${o.estado === 'error' ? `<div class="mut" style="margin-top:4px;color:var(--rojo);font-size:11px">No se pudo confirmar si ${esc(BROKER_NOMBRE[o.broker || 'etrade'] || o.broker)} la recibió: revísala en la app de ${esc(BROKER_NOMBRE[o.broker || 'etrade'] || o.broker)} antes de repetirla.</div>` : ''}
    ${o.estado === 'enviada' && /^BUY/.test(String(o.accion || '')) && o.limit_price ? `<div class="mut" style="margin-top:4px;color:var(--oro);font-size:11px">${((o.preview || {})._mz || {}).gtc_auto === false ? 'Cuando se llene, la Mesa te abre la venta GTC' : 'Cuando se llene, la Mesa ENVÍA sola la venta GTC'} +${ppO}% (≈ $${(gtcLimite(o.limit_price, ppO) || 0).toFixed(2)})${((o.preview || {})._mz || {}).gtc_auto === false ? ' lista para enviar' : ' (te pide el PIN si está desarmado)'}.</div>` : ''}
    <div class="fila" style="margin-top:6px"><b style="font-size:13.5px">${esc(contrato)}</b>
      <span class="mut mono">${esc(o.accion)} ×${esc(Number(o.cantidad))}</span></div>
    <div class="fila" style="margin-top:3px"><span class="mut">${esc(prop)} · ${precio} · ${o.order_term === 'GOOD_UNTIL_CANCEL' ? 'GTC' : 'DAY'}${o.orden_id_ext ? ' · #' + esc(o.orden_id_ext) : ''}</span>
      ${o.estado === 'enviada' && o.orden_id_ext ? `<button class="btnsec" style="flex:none;padding:7px 12px" onclick="MZ.cancelarOrden(${Number(o.id)}, '${esc(o.orden_id_ext)}', '${esc(o.broker || 'etrade')}')">Cancelar</button>` : ''}</div>
    ${ov.length ? `<div class="mut" style="margin-top:4px;color:var(--oro);font-size:11px">override: ${esc(ov.join(' · '))}</div>` : ''}
  </div>`;
}
// op.sinConfirmar: el corte ya pidió confirmación una vez. Devuelve true si el
// bróker aceptó la solicitud (la cancelación la CONFIRMA después la sincronización).
async function cancelarOrden(id, orderId, broker, op) {
  if (broker === 'schwab') return cancelarOrdenSchwab(id, orderId);
  op = op || {};
  if (!op.sinConfirmar && !confirm('¿Cancelar en E*TRADE la orden #' + orderId + '?')) return false;
  const cr = etCreds();
  if (!cr) { toast('Conecta E*TRADE primero'); return false; }
  if (etDiaVencido()) { toast('Sesión de E*TRADE expirada — reconecta'); return false; }
  toast('Cancelando en E*TRADE…');
  try {
    const accountIdKey = await etCuentaKey(cr);
    const r = await etPost(cr, '/etrade/orden/cancel', { accountIdKey, orderId: Number(orderId) });
    const d = r.data || {}, C = d.CancelOrderResponse || d;
    const em = mensajeError(r);
    if (r.status === 401) { toast(texto401Ordenes(em)); return false; }
    // E*TRADE la rechaza (p. ej. ya estaba cancelada desde su app): se avisa y se
    // sincroniza enseguida para que la tarjeta refleje el estado real.
    if (r.status >= 400 || em) { toast('E*TRADE: ' + (em || 'HTTP ' + r.status)); ordenesActualizar({ silencioso: true, forzar: true }); return false; }
    await marcarCancelando(id, C);                       // «being processed»: la sincronización confirma CANCELLED (o FILLED si se llenó antes)
    toast('Cancelación solicitada — se confirma sola');
    ruta();
    setTimeout(() => ordenesActualizar({ silencioso: true, forzar: true }), 4000);
    return true;
  } catch (e) { toast('No pude cancelar: ' + ((e && e.message) || e)); return false; }
}
// Cruza las órdenes 'enviadas' con E*TRADE (abiertas + ejecutadas de los últimos
// 7 días) y actualiza estados; una ENTRADA ejecutada crea la posición y una
// SALIDA ejecutada cierra la suya.
async function cancelarOrdenSchwab(id, orderId, op) {
  op = op || {};
  if (!op.sinConfirmar && !confirm('¿Cancelar en Schwab la orden #' + orderId + '?')) return false;
  if (!swCreds()) { toast('Conecta Schwab primero'); return false; }
  if (swVencido()) { toast('Login semanal de Schwab caducado — reconecta'); return false; }
  toast('Cancelando en Schwab…');
  try {
    const hash = await swCuenta();
    const r = await swPost('/schwab/orden/cancel', { hash, orderId: String(orderId) });
    const em = swMensajeError(r);
    if (r.status === 401) { toast('La sesión de Schwab caducó — reconecta en Cuentas'); return false; }
    if (r.status >= 400 || em) { toast('Schwab: ' + (em || 'HTTP ' + r.status)); ordenesActualizar({ silencioso: true, forzar: true }); return false; }
    await marcarCancelando(id, r.data || {});
    toast('Cancelación solicitada — se confirma sola');
    ruta();
    setTimeout(() => ordenesActualizar({ silencioso: true, forzar: true }), 4000);
    return true;
  } catch (e) { toast('No pude cancelar: ' + ((e && e.message) || e)); return false; }
}
// ---- CORTE (Plan 10%): aviso + salida de UN toque, jamás automática ----
// Nunca un stop del bróker ni OCO: la API de E*TRADE no tiene OCO y un stop suelto
// se rechaza porque la GTC ya reserva los contratos. Al tocar «Cortar»:
//  1) busca las ventas de la posición (GTC, stop o un corte anterior) en estado
//     'enviada' o 'error': si alguna está en 'error' (el envío no se confirmó y
//     puede estar viva) aborta sin tocar nada; las 'enviada' las cancela en su bróker;
//  2) sincroniza hasta que el bróker CONFIRME la cancelación (tope 15 s): si
//     alguna salió ejecutada, vuelve a leer la posición: cerrada → ya se vendió;
//     abierta → se vendió en parte y quedan contratos sin venta viva (pide volver a
//     tocar Cortar); si no confirma, aborta (revisa en el bróker) — nunca se vende
//     con una venta que puede seguir viva;
//  3) abre la venta SELL_CLOSE LIMIT DAY al bid con propósito 'salida_corte' y la
//     previsualiza; ENVIAR sigue siendo el toque de Andrés (y el PIN). Jamás abre su
//     formulario encima de otro cuadro abierto.
// El candado se pone ANTES del primer await: un doble toque no corre dos cortes.
const CORTE_TOPE_MS = 15000, CORTE_PASO_MS = 2000;
const _corte = { enCurso: false };
async function cortarPosicion(posId) {
  if (_corte.enCurso) { toast('Ya hay un corte en curso: espera a que termine'); return 'en_curso'; }
  _corte.enCurso = true;
  try {
    if (document.querySelector('.modal')) { alert('Hay otro cuadro abierto: ciérralo y vuelve a tocar Cortar. No se tocó nada.'); return 'modal_abierto'; }
    const { data: p } = await sb.from('posiciones').select('*').eq('id', posId).maybeSingle();
    if (!p || p.estado !== 'abierta') { toast('Esa posición ya no está abierta'); return 'cerrada'; }
    const broker = p.broker || 'etrade', nombre = BROKER_NOMBRE[broker] || broker;
    if (!['etrade', 'schwab'].includes(broker)) { alert('Esta posición es de ' + nombre + ': córtala en tu bróker y registra la salida.'); return 'sin_broker'; }
    if (!brokersOperables().includes(broker)) { alert('Reconecta ' + nombre + ' (Cuentas) para cortar esta posición.'); return 'sin_broker'; }
    const contrato = `${p.symbol} ${p.direccion}${p.strike != null ? ' ' + Number(p.strike) : ''} ×${Number(p.contratos) || 1}`;
    if (!confirm(`¿Cortar ${contrato}?\n\nSe cancelan tus ventas vivas de esta posición en ${nombre}, se espera a que ${nombre} confirme la cancelación y se abre la venta al bid (DAY). Nada se envía sin tu toque y tu PIN.`)) return 'cancelado';
    gtcAutoMarcar(p.id);            // este equipo ya no abre la GTC automática de esta posición
    const { data: vivas, error } = await sb.from('ordenes').select('*').eq('posicion_id', p.id)
      .in('proposito', ['salida_gtc', 'salida_stop', 'salida_corte']).in('estado', ['enviada', 'error']);
    if (error) { alert('No pude leer tus órdenes (' + error.message + '). No se tocó nada.'); return 'error'; }
    let lista = vivas || [];
    // antes de anotar nada: una venta VIVA sin número del bróker no se puede cancelar desde aquí
    if (lista.some(o => o.estado !== 'error' && !o.orden_id_ext)) { alert('Hay una venta de esta posición sin número de ' + nombre + ': revísala en ' + nombre + ' antes de cortar. No se tocó nada.'); return 'sin_confirmar'; }
    // Una venta en 'error' (su envío no se confirmó) puede estar viva y nada la saca de ese
    // estado: solo Andrés lo sabe. Si confirma que la revisó en su bróker y NO está viva, se
    // anota cancelada a mano y el corte sigue; si no, se aborta sin tocar nada.
    const enError = lista.filter(o => o.estado === 'error');
    if (enError.length) {
      const cuantas = enError.length > 1 ? enError.length + ' ventas' : 'una venta';
      if (!confirm(`Hay ${cuantas} de ${contrato} sin confirmar en ${nombre}: puede estar viva.\n\n¿Ya revisaste en ${nombre} que NO está viva? Si sigue viva, cancélala allí primero.`)) { toast(`Revisa tu venta en ${nombre} antes de cortar. No se tocó nada.`); return 'sin_confirmar'; }
      for (const o of enError) {
        const resp = o.respuesta && typeof o.respuesta === 'object' && !Array.isArray(o.respuesta) ? o.respuesta : {};
        const { error: eUp } = await sb.from('ordenes').update({ estado: 'cancelada', actualizado_at: new Date().toISOString(), respuesta: { ...resp, nota_corte: 'resuelta a mano antes del corte' } }).eq('id', o.id).eq('estado', 'error');
        if (eUp) { alert('No pude anotar la venta como revisada (' + eUp.message + '). No se tocó nada más.'); return 'error'; }
      }
      lista = lista.filter(o => o.estado !== 'error');
    }
    if (lista.length) {
      toast(`Cancelando ${lista.length > 1 ? lista.length + ' ventas' : 'tu venta'} en ${nombre}…`);
      for (const o of lista) {
        if ((o.broker || 'etrade') === 'schwab') await cancelarOrdenSchwab(o.id, o.orden_id_ext, { sinConfirmar: true });
        else await cancelarOrden(o.id, o.orden_id_ext, 'etrade', { sinConfirmar: true });
      }
      const ids = lista.map(o => o.id), t0 = Date.now();
      let confirmado = false;
      for (;;) {
        await ordenesActualizar({ silencioso: true, forzar: true });
        const { data: est } = await sb.from('ordenes').select('id,estado').in('id', ids);
        const filas = est || [];
        if (filas.some(o => o.estado === 'ejecutada')) {
          // la sincronización ya anotó lo vendido: ¿sigue abierta la posición (llenado parcial)?
          const { data: p2 } = await sb.from('posiciones').select('*').eq('id', p.id).maybeSingle();
          if (p2 && p2.estado === 'abierta') {
            const n = Number(p2.contratos) || 1;
            alert(`Se vendió en parte: quedan ${n} contrato${n === 1 ? '' : 's'} sin venta viva. Vuelve a tocar Cortar.`);
            ruta(); return 'parcial';
          }
          alert(`Tu venta de ${contrato} ya se ejecutó en ${nombre} (toda o en parte): ya se vendió, no hace falta cortar. Revisa la posición.`);
          ruta(); return 'ejecutada';
        }
        if (filas.length === ids.length && filas.every(o => ['cancelada', 'expirada', 'rechazada'].includes(o.estado))) { confirmado = true; break; }
        if (Date.now() - t0 >= CORTE_TOPE_MS) break;
        await new Promise(r => setTimeout(r, CORTE_PASO_MS));
      }
      if (!confirmado) {
        alert(`${nombre} no confirmó la cancelación en 15 s. Revisa en ${nombre} si tu venta sigue viva ANTES de vender: no se abrió la venta.`);
        ruta(); return 'sin_confirmar';
      }
    }
    const bid = await bidDeContrato(p);
    // jamás encima de otro cuadro (p. ej. una orden abierta mientras se esperaba la cancelación)
    if (document.querySelector('.modal')) {
      alert(`Tus ventas vivas de ${contrato} ya no están activas, pero hay otro cuadro abierto: ciérralo y vuelve a tocar Cortar para abrir la venta al bid.`);
      ruta(); return 'modal_abierto';
    }
    const pre = preSalida(p, 'salida_corte', bid);
    abrirOrden(pre);
    toast(pre.limitPrice ? `Corte: venta al bid $${pre.limitPrice.toFixed(2)} — revisa y envía` : 'Corte: no leí el bid — tócalo en la cadena y envía');
    if (pre.limitPrice) {
      setTimeout(async () => {
        if (!(_ord && _ord.pre === pre && $('#modalOrden') && !_ord.orden)) return;
        await ordenPreview();       // vista previa automática (no coloca nada); ENVIAR es tu toque
      }, 900);
    }
    return 'abierta';
  } finally { _corte.enCurso = false; }
}
// bid vivo de UN contrato (para la venta del corte) con la sesión del bróker de la posición.
async function bidDeContrato(p) {
  const brk = p.broker || 'etrade', sym = String(p.symbol || '').toUpperCase(), exp = String(p.expiracion || ''), k = Number(p.strike);
  if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(exp) || !(k > 0)) return null;
  try {
    let cad = null;
    if (brk === 'schwab') {
      const rc = await conTope(swRead('/marketdata/v1/chains', { symbol: sym, contractType: p.direccion === 'PUT' ? 'PUT' : 'CALL', strike: k, fromDate: exp, toDate: exp }), 8000, 'sin bid');
      if (rc.status >= 400 || swMensajeError(rc)) return null;
      cad = parsearCadenaSchwab(rc);
    } else {
      const cr = etCreds(); if (!cr) return null;
      const [y, m, d] = exp.split('-').map(Number);
      const rc = await conTope(etRead(cr, '/v1/market/optionchains.json', { symbol: sym, expiryYear: y, expiryMonth: m, expiryDay: d, noOfStrikes: 6,
        includeWeekly: 'true', chainType: 'CALLPUT', priceType: 'ALL', skipAdjusted: 'true', strikePriceNear: k }), 8000, 'sin bid');
      if (rc.status >= 400 || etError(rc)) return null;
      cad = parsearCadena(rc);
    }
    return bidDeCadena(cad, k, p.direccion);
  } catch (_) { return null; }
}
function bidDeCadena(cad, strike, lado) {
  const fila = (cad && Array.isArray(cad.filas)) ? cad.filas.find(r => Number(r.strike) === Number(strike)) : null;
  const o = fila ? (lado === 'PUT' ? fila.put : fila.call) : null;
  return (o && o.bid != null && Number(o.bid) > 0) ? Number(o.bid) : null;
}
// Un cancel aceptado NO es una cancelación confirmada (puede llenarse antes): la
// fila sigue 'enviada' con estado vivo CANCEL_REQUESTED y la sincronización la
// cierra con lo que diga el bróker (CANCELED → cancelada; FILLED → ejecutada).
async function marcarCancelando(id, detalle) {
  const { data: fila } = await sb.from('ordenes').select('respuesta').eq('id', id).maybeSingle();
  const resp = Object.assign({}, (fila && fila.respuesta) || {}, { _vivo: { status: 'CANCEL_REQUESTED', ts: new Date().toISOString() }, _cancel: recortarJson(detalle || {}, 1024) });
  await sb.from('ordenes').update({ respuesta: resp, actualizado_at: new Date().toISOString() }).eq('id', id);
}
// Estado normalizado de una orden remota (E*TRADE o Schwab) para la sincronización:
// {st, nuevo, qty, fill, ejecutadaAt, vivo}. `nuevo` null = sigue activa.
function normalizarRemota(broker, rem) {
  if (broker === 'schwab') {
    const st = String(rem.status || '').toUpperCase();
    let qty = 0, costo = 0;
    for (const act of (rem.orderActivityCollection || [])) for (const el of (act.executionLegs || [])) {
      const q = Number(el.quantity) || 0, p = Number(el.price);
      if (q > 0 && Number.isFinite(p)) { qty += q; costo += q * p; }
    }
    const fill = qty > 0 ? Math.round(costo / qty * 10000) / 10000 : Number(rem.price);
    if (!(qty > 0)) qty = Number(rem.filledQuantity) || 0;
    // un final CANCELED/EXPIRED con contratos llenados es una ejecución PARCIAL: lo llenado cuenta
    const finalConFills = (st === 'CANCELED' || st === 'EXPIRED' || st === 'REPLACED') && qty > 0;
    const nuevo = (st === 'FILLED' || finalConFills) ? 'ejecutada'
      : (st === 'CANCELED' || st === 'REPLACED') ? 'cancelada' : st === 'EXPIRED' ? 'expirada' : st === 'REJECTED' ? 'rechazada' : null;
    const t = rem.closeTime || rem.enteredTime;
    const ejecutadaAt = t && !isNaN(new Date(t)) ? new Date(t).toISOString() : new Date().toISOString();
    // Schwab no tiene status PARTIAL: un fill parcial es WORKING con contratos llenados
    const vivo = st === 'PENDING_CANCEL' ? 'CANCEL_REQUESTED' : (!nuevo && qty > 0) ? 'PARTIAL' : st;
    return { st, nuevo, qty, fill, ejecutadaAt, vivo, parcial: finalConFills ? { llenados: qty, pedidos: Number(rem.quantity) || null, final: st } : null };
  }
  const det = (Array.isArray(rem.OrderDetail) ? rem.OrderDetail[0] : rem.OrderDetail) || {};
  const st = String(det.status || '').toUpperCase();
  const insts = Array.isArray(det.Instrument) ? det.Instrument : (det.Instrument ? [det.Instrument] : []);
  let qty = 0, costo = 0;
  for (const i of insts) { const q = Number(i.filledQuantity) || 0, p = Number(i.averageExecutionPrice); if (q > 0 && Number.isFinite(p)) { qty += q; costo += q * p; } }
  const fill = qty > 0 ? Math.round(costo / qty * 10000) / 10000 : Number((insts[0] || {}).averageExecutionPrice);
  const ejecutadaAt = det.executedTime ? new Date(Number(det.executedTime)).toISOString() : new Date().toISOString();
  let nuevo = estadoLocalDe(st);
  const finalConFills = (nuevo === 'cancelada' || nuevo === 'expirada') && qty > 0 && fill > 0;
  if (finalConFills) nuevo = 'ejecutada';
  return { st, nuevo, qty, fill, ejecutadaAt, vivo: (!nuevo && qty > 0 && st !== 'CANCEL_REQUESTED') ? 'PARTIAL' : st,
    parcial: finalConFills ? { llenados: qty, pedidos: Number((insts[0] || {}).orderedQuantity || (insts[0] || {}).quantity) || null, final: st } : null };
}
// Sincroniza las órdenes 'enviada' con el estado REAL en E*TRADE. Manual (enlace
// «Actualizar ahora») o silenciosa (al abrir Copiloto, cada 60 s mientras haya
// activas, al volver del fondo y tras cancelar). Dos fases para no castigar la
// API: primero OPEN + CANCEL_REQUESTED (lo vivo); solo si alguna local no aparece
// ahí se piden los estados finales (EXECUTED/INDIVIDUAL_FILLS/CANCELLED/EXPIRED/
// REJECTED). Una cancelada desde la app de E*TRADE deja de ser 'enviada' sola.
const _ordSync = { ts: 0, enCurso: false, err: null, activas: null };
// Vigilante de fills: mientras haya órdenes activas y la app esté a la vista,
// consulta E*TRADE cada 20 s (2 llamadas) para detectar el fill cuanto antes y
// disparar el GTC automático; sin órdenes activas no hace nada.
setInterval(() => {
  if (typeof sesionActiva === 'undefined' || !sesionActiva || document.visibilityState === 'hidden') return;
  if (_ordSync.activas === null || _ordSync.activas > 0) ordenesActualizar({ silencioso: true, forzar: true });
}, 20000);
const ORD_SYNC_MS = 60000;
const ORD_ESTADOS_VIVOS = ['OPEN', 'CANCEL_REQUESTED'];
const ORD_ESTADOS_FINALES = ['EXECUTED', 'INDIVIDUAL_FILLS', 'CANCELLED', 'EXPIRED', 'REJECTED'];
// Estado local que corresponde al status de E*TRADE; null = sigue activa.
function estadoLocalDe(st) {
  st = String(st || '').toUpperCase();
  return /EXECUTED|INDIVIDUAL_FILLS/.test(st) ? 'ejecutada' : st === 'CANCELLED' ? 'cancelada' : st === 'EXPIRED' ? 'expirada' : st === 'REJECTED' ? 'rechazada' : null;
}
async function ordenesActualizar(opts) {
  const op = opts || {}, silencioso = !!op.silencioso;
  const aviso = (t) => { if (!silencioso) toast(t); };
  if (silencioso && (_ordSync.enCurso || (!op.forzar && Date.now() - _ordSync.ts < ORD_SYNC_MS))) return;
  const cr = etCreds(), puedeEt = !!cr && !etDiaVencido(), puedeSw = !!swCreds() && !swVencido();
  if (!puedeEt && !puedeSw) { aviso((cr || swCreds()) ? 'Sesión del bróker caducada — reconecta en Cuentas' : 'Conecta E*TRADE o Schwab primero'); return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { aviso('Sin sesión. Sal y vuelve a entrar.'); return; }
  const { data, error } = await sb.from('ordenes').select('*').eq('estado', 'enviada').not('orden_id_ext', 'is', null);
  if (error) { aviso('No pude leer tus órdenes: ' + error.message); return; }
  _ordSync.activas = (data || []).length;
  if (!(data || []).length) { _ordSync.ts = Date.now(); _ordSync.err = null; aviso('No hay órdenes activas que consultar'); return; }
  aviso('Consultando al bróker…');
  _ordSync.enCurso = true;
  try {
    // rango E*TRADE: desde la enviada más antigua (−1 día), con tope de 30 días
    const et = data.filter(l => (l.broker || 'etrade') === 'etrade'), sw = data.filter(l => l.broker === 'schwab');
    const masVieja = (arr) => arr.map(o => o.creado_at).sort()[0];
    const remotas = {};                                     // 'broker:orderId' → orden remota
    const errores = [], sinVigilar = [];
    if (et.length && !puedeEt) sinVigilar.push(`E*TRADE caducada — reconecta en Cuentas (${et.length} orden${et.length > 1 ? 'es' : ''} sin vigilar)`);
    if (sw.length && !puedeSw) sinVigilar.push(`Schwab caducado — reconecta en Cuentas (${sw.length} orden${sw.length > 1 ? 'es' : ''} sin vigilar)`);
    if (et.length && puedeEt) {
      try {
        const desdeMs = Math.max(Date.now() - 30 * 86400000, new Date(masVieja(et)).getTime() - 86400000);
        const accountIdKey = await etCuentaKey(cr);
        const mmdd = (ymd) => ymd.slice(5, 7) + ymd.slice(8, 10) + ymd.slice(0, 4);
        const hoy = hoyNY(), desde = ymdNY(new Date(desdeMs).toISOString());
        const rango = { fromDate: mmdd(desde), toDate: mmdd(hoy), count: 100 };
        const lista = (r) => { const d = r.data || {}, O = d.OrdersResponse || d; const a = O.Order || []; return Array.isArray(a) ? a : (a ? [a] : []); };
        const pedir = async (estados, conRango) => {
          const rs = await Promise.all(estados.map(s => etPost(cr, '/etrade/ordenes',
            { accountIdKey, query: conRango ? { status: s, ...rango } : { status: s, count: 100 } })));
          for (const r of rs) {
            const em = mensajeError(r);
            if (r.status === 401) throw new Error(texto401Ordenes(em));
            if (r.status >= 400 || em) throw new Error(em || 'HTTP ' + r.status);
            for (const x of lista(r)) if (x && x.orderId != null) remotas['etrade:' + String(x.orderId)] = x;
          }
        };
        await pedir(ORD_ESTADOS_VIVOS, false);                                         // fase 1: lo que sigue vivo
        if (et.some(l => !remotas['etrade:' + String(l.orden_id_ext)])) await pedir(ORD_ESTADOS_FINALES, true);   // fase 2: solo si alguna desapareció
      } catch (e) { errores.push('E*TRADE: ' + String((e && e.message) || e)); }
    }
    if (sw.length && puedeSw) {
      try {
        // Schwab: una consulta por rango (hasta 365 d desde la más antigua) y, si alguna
        // no aparece, su orden suelta por id (GTC viejas fuera de rango)
        const hash = await swCuenta();
        const desdeSw = Math.max(Date.now() - 365 * 86400000, new Date(masVieja(sw)).getTime() - 86400000);
        const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');
        const r = await swPost('/schwab/ordenes', { hash, query: { fromEnteredTime: iso(desdeSw), toEnteredTime: iso(Date.now() + 86400000), maxResults: 500 } });
        const em = swMensajeError(r);
        if (r.status === 401) throw new Error('La sesión de Schwab caducó — reconecta en Cuentas → Charles Schwab.');
        if (r.status >= 400 || em) throw new Error('Schwab: ' + (em || 'HTTP ' + r.status));
        for (const x of (Array.isArray(r.data) ? r.data : [])) if (x && x.orderId != null) remotas['schwab:' + String(x.orderId)] = x;
        for (const l of sw) {
          const k = 'schwab:' + String(l.orden_id_ext); if (remotas[k]) continue;
          const r1 = await swPost('/schwab/orden/get', { hash, orderId: String(l.orden_id_ext) });
          if (r1.status === 200 && r1.data && r1.data.orderId != null) remotas[k] = r1.data;
        }
      } catch (e) { errores.push(String((e && e.message) || e)); }
    }
    let cambios = 0, nuevasPosiciones = 0;
    for (const loc of data) {
      const brokerLoc = loc.broker || 'etrade';
      const rem = remotas[brokerLoc + ':' + String(loc.orden_id_ext)]; if (!rem) continue;
      const nr = normalizarRemota(brokerLoc, rem);
      const nuevo = nr.nuevo;
      if (nr.st === 'REPLACED') toast('Orden #' + loc.orden_id_ext + ' reemplazada desde Schwab: la Mesa no sigue la orden nueva; revísala en Schwab.');
      if (!nuevo) {
        // sigue activa (OPEN / CANCEL_REQUESTED / PARTIAL / WORKING…): se guarda el estado
        // vivo solo si cambió, para que la tarjeta diga ACTIVA / CANCELANDO / PARCIAL
        const prev = String((((loc.respuesta || {})._vivo || {}).status) || (((((loc.respuesta || {})._etrade || {}).OrderDetail) || [])[0] || {}).status || '').toUpperCase();
        if (prev !== nr.vivo) {
          const resp = Object.assign({}, loc.respuesta || {}, { _vivo: { status: nr.vivo, ts: new Date().toISOString() } });
          if (brokerLoc === 'etrade') resp._etrade = recortarJson(rem, 3000);
          const { error: e3 } = await sb.from('ordenes').update({ respuesta: resp, actualizado_at: new Date().toISOString() }).eq('id', loc.id);
          if (!e3) cambios++;
        }
        continue;
      }
      const upd = { estado: nuevo, respuesta: recortarJson(rem, 4096), actualizado_at: new Date().toISOString() };
      if (nr.parcial && upd.respuesta && typeof upd.respuesta === 'object') upd.respuesta._parcial = nr.parcial;   // llenada en parte: el resto se canceló/venció
      if (nuevo === 'ejecutada') {
        // varios fills: cantidad = suma; precio = promedio ponderado (normalizarRemota)
        let qty = nr.qty, fill = nr.fill;
        if (!(qty > 0)) qty = Number(loc.cantidad) || 1;
        const ejecutadaAt = nr.ejecutadaAt;
        const esVenta = /^SELL/.test(String(loc.accion || ''));
        if (!esVenta && loc.proposito === 'entrada' && !loc.posicion_id && fill > 0 && loc.security_type === 'OPTN' && loc.direccion) {
          const mz = (loc.preview && loc.preview._mz) || {};
          const sem = ['ok', 'aviso', 'alto'].includes(mz.semaforo) ? mz.semaforo
            : (loc.overrides || []).some(t => /FUERA del rango/.test(String(t))) ? 'alto' : null;
          const pc = planCongelado(mz);     // plan CONGELADO al previsualizar la compra (sin anotación: Plan 35)
          const p = { user_id: uid, symbol: loc.symbol, direccion: loc.direccion, strike: loc.strike, expiracion: loc.expiracion,
            contratos: qty, prima_fill: fill, plan_pct: pc.plan_pct, broker: brokerLoc, senal_id: loc.senal_id || null,
            abierta_at: ejecutadaAt, abierta_fecha_ny: ymdNY(ejecutadaAt) || hoyNY(),
            entrada_semaforo: sem, fuera_de_rango: sem === 'alto' };
          if (pc.stop_pct != null) p.stop_pct = pc.stop_pct;   // sin corte no se envía (compatible sin la migración 0012)
          const pi = await sb.from('posiciones').insert(p).select('id').single();
          if (!pi.error && pi.data) {
            upd.posicion_id = pi.data.id; nuevasPosiciones++;
            const mzp = (loc.preview && loc.preview._mz) || {};
            gtcAutoAnotar(pi.data.id, mzp.gtc_auto !== false);
          }
        } else if (esVenta && loc.posicion_id && Number.isFinite(fill)) {
          const { data: pos } = await sb.from('posiciones').select('*').eq('id', loc.posicion_id).maybeSingle();
          if (pos && pos.estado === 'abierta' && (pos.broker || 'etrade') === brokerLoc) {
            const tot = Number(pos.contratos) || 1, vend = Math.min(qty, tot);
            const res = Math.round((fill - Number(pos.prima_fill)) * vend * 100 * 100) / 100;
            if (vend >= tot) {
              await sb.from('posiciones').update({ estado: fill > 0 ? 'cerrada' : 'expirada', prima_salida: fill,
                resultado_usd: res, cerrada_at: ejecutadaAt }).eq('id', loc.posicion_id);
            } else {
              // cierre PARCIAL: el tramo vendido se anota cerrado (fila propia) y
              // la posición sigue abierta con el resto (posiciones como filas-tramo)
              // fuera: la columna generada, lo que escribe el worker y los avisos (el tramo cerrado no se vigila)
              const { id: _i, gtc_limite: _g, mark: _m, mark_at: _ma, mfe: _f, mae: _e, aviso_corte_at: _ac, aviso_corte_mark: _acm, aviso_cierre_at: _aci, ...base } = pos;
              await sb.from('posiciones').insert({ ...base, user_id: uid, contratos: vend, estado: fill > 0 ? 'cerrada' : 'expirada',
                prima_salida: fill, resultado_usd: res, cerrada_at: ejecutadaAt });
              await sb.from('posiciones').update({ contratos: tot - vend }).eq('id', loc.posicion_id);
            }
          }
        }
      }
      const { error: e2 } = await sb.from('ordenes').update(upd).eq('id', loc.id);
      if (!e2) cambios++;
    }
    _ordSync.ts = Date.now();
    _ordSync.err = [].concat(errores, sinVigilar).join(' · ') || null;
    if (nuevasPosiciones && location.hash !== '#/copiloto') { location.hash = '#/copiloto'; }   // fill nuevo: al Copiloto, donde se abre el GTC automático
    if (cambios) { toast(`${cambios} orden${cambios > 1 ? 'es' : ''} actualizada${cambios > 1 ? 's' : ''} desde el bróker`); ruta(); }
    else if (errores.length) aviso('No pude actualizar: ' + errores.join(' · '));
    else { if (sinVigilar.length) aviso(sinVigilar.join(' · ')); else aviso('Sin cambios en el bróker'); if (!silencioso) ruta(); }
  } catch (e) {
    _ordSync.ts = Date.now(); _ordSync.err = String((e && e.message) || e);
    aviso('No pude actualizar: ' + _ordSync.err);
  }
  _ordSync.enCurso = false;
}
window.MZ = Object.assign(window.MZ || {}, {
  abrirOrden, cerrarOrden, ordenPreview, ordenPlace, ordenEditar, cancelarOrden, ordenesActualizar, cortarPosicion, elegirPlataforma,
  cadenaElegir, cadenaRefrescar: () => { if (_ord) _ord.cadenaGen++; cargarCadena(true); },
  presupuestoPct: async () => {
    const plan = planActivo(), diez = plan.id === 'PLAN_10', max = plan.presupMaxPct || 100;
    const v = prompt(diez ? `Plan 10%: presupuesto por operación, % del saldo del bróker de la orden (la doctrina: ${plan.tamanoMinPct}–${plan.tamanoMaxPct}%)`
      : 'Presupuesto por ticket: % del saldo del bróker de la orden (E*TRADE)', String(presupuestoPct()));
    if (v == null) return;
    const n = Number(String(v).replace(',', '.').replace('%', '').trim());
    if (!(n > 0 && n <= max)) { toast(`Pon un porcentaje entre 1 y ${max}`); return; }
    if (diez) {
      try { await guardarPlanUsuario({ presupuesto_pct: n }); } catch (e) { toast('No se guardó: ' + ((e && e.message) || e)); return; }
    } else { try { localStorage.setItem(PRESUP_K, String(n)); } catch (_) {} }
    if (_ord) { _ord.qtyManual = false; autoCantidad(); pintarAvisosOrden(); pintarTotalOrden(); }
    // sin tope duro: por encima del máximo del plan solo avisa (la orden también lo avisa)
    const pasa = diez && n > plan.tamanoMaxPct;
    toast(`Presupuesto por ticket: ${n}% del saldo${pasa ? ` · más del ${plan.tamanoMaxPct}%: el plan dice máximo ${plan.tamanoMaxPct}%` : ''}`);
  },
  cadenaExp: (v) => { const ex = $('#oExp'); if (ex) ex.value = v; if (_ord) { _ord.cadenaExp = v; _ord.cadenaGen++; } cargarCadena(true); },
  pinOrdenes: async () => { await modalPinOrdenes(pinHash() ? 'cambiar' : 'crear'); pintarOrdenesCuenta(); },
  armar: async () => { if (armadoHasta()) desarmar(); else await pedirPin(); pintarOrdenesCuenta(); },
});

// ---------- Disciplina ----------
function nombreMesNY() {
  return new Intl.DateTimeFormat('es', { timeZone: 'America/New_York', month: 'long' }).format(new Date());
}
// Une las operaciones manuales (posiciones) con los round-trips reales de los
// brókeres (broker_trades) en UN conjunto sin duplicados, para la Disciplina.
//  · Los round-trips del bróker se agrupan por contrato + día NY de apertura:
//    una entrada vendida en dos partes es UNA operación, no dos.
//  · Una posición manual que coincide con un grupo del bróker (symbol, dirección,
//    strike, expiración y mismo día NY de apertura) cuenta una sola vez: el
//    bróker manda en los $; la manual aporta su veredicto de rango
//    (entrada_semaforo / fuera_de_rango). Strike/expiración vacíos en la manual
//    no impiden el emparejamiento.
//  · Un cierre PARCIAL deja una fila-tramo cerrada con el mismo contrato y la misma
//    apertura (abierta_at): las filas manuales de UNA operación se agrupan primero
//    (contratos y resultado sumados), así un tramo no cuenta como otra operación.
function unirOperaciones(posic, trades) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const tramos = {}, manualesAgrupadas = [];
  for (const p of posic || []) {
    if (!p) continue;
    if (!p.abierta_at) { manualesAgrupadas.push([p]); continue; }
    const k = [p.symbol, p.direccion, num(p.strike), p.expiracion || '', p.abierta_at].join('|');
    if (!tramos[k]) { tramos[k] = [p]; manualesAgrupadas.push(tramos[k]); } else tramos[k].push(p);
  }
  const numN = (v) => (v == null || v === '' ? null : num(v));   // null/'' no es 0 (resultado o salida aún sin dato)
  const unirTramos = (filas) => {
    if (filas.length === 1) return filas[0];
    const abierta = filas.find(f => f.estado === 'abierta') || null;
    const base = abierta || filas.slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))[0];   // la original: el tramo se inserta después
    const contratos = filas.reduce((s, f) => s + (num(f.contratos) || 0), 0);
    const costo = filas.reduce((s, f) => s + (num(f.prima_fill) || 0) * (num(f.contratos) || 0), 0);
    const conRes = filas.filter(f => numN(f.resultado_usd) != null);
    const cerradas = filas.filter(f => f.estado !== 'abierta');
    const conSalida = cerradas.filter(f => numN(f.prima_salida) != null);
    const nSal = conSalida.reduce((s, f) => s + (num(f.contratos) || 0), 0);
    return { ...base, contratos,
      prima_fill: contratos ? Math.round(costo / contratos * 10000) / 10000 : base.prima_fill,
      resultado_usd: conRes.length ? r2(conRes.reduce((s, f) => s + numN(f.resultado_usd), 0)) : null,
      estado: abierta ? 'abierta' : cerradas.every(f => f.estado === 'expirada') ? 'expirada' : 'cerrada',
      prima_salida: (!abierta && conSalida.length === cerradas.length && nSal > 0) ? Math.round(conSalida.reduce((s, f) => s + numN(f.prima_salida) * (num(f.contratos) || 0), 0) / nSal * 10000) / 10000 : (abierta ? null : base.prima_salida),
      cerrada_at: abierta ? null : filas.map(f => f.cerrada_at || '').sort().pop() || null,
      fuera_de_rango: filas.some(f => f.fuera_de_rango), _salida_corte: filas.some(f => f._salida_corte), _tramos: filas.length,
      _filas: filas };   // cada tramo con su fecha de cierre (lo ganado de la semana, cerradasDesde)
  };
  const grupos = {};
  for (const t of trades || []) {
    const dia = ymdNY(t.abierta_at);
    const k = [t.symbol, t.direccion, num(t.strike), t.expiracion || '', dia].join('|');
    const g = grupos[k] || (grupos[k] = {
      symbol: t.symbol, direccion: t.direccion, strike: num(t.strike), expiracion: t.expiracion || null,
      abierta_fecha_ny: dia, abierta_at: t.abierta_at || null, cerrada_at: t.cerrada_at || null,
      contratos: 0, _costo: 0, resultado_usd: 0, estado: 'cerrada', broker: t.broker,
      _fuente: t.broker, fuera_de_rango: false, entrada_semaforo: null, _partes: 0, _salida: 0, _salidaN: 0,
    });
    const c = num(t.contratos) || 0;
    g.contratos += c; g._costo += (num(t.prima_fill) || 0) * c; g.resultado_usd += num(t.resultado_usd) || 0;
    if (t.prima_salida != null && num(t.prima_salida) != null) { g._salida += num(t.prima_salida) * c; g._salidaN += c; }
    if (t.abierta_at && (!g.abierta_at || t.abierta_at < g.abierta_at)) g.abierta_at = t.abierta_at;
    if (t.cerrada_at && (!g.cerrada_at || t.cerrada_at > g.cerrada_at)) g.cerrada_at = t.cerrada_at;
    g._partes++;
  }
  const delBroker = Object.values(grupos).map(g => ({ ...g,
    prima_fill: g.contratos ? Math.round(g._costo / g.contratos * 10000) / 10000 : null,
    prima_salida: g._salidaN ? Math.round(g._salida / g._salidaN * 10000) / 10000 : null,   // 0 = se fue a cero
    resultado_usd: r2(g.resultado_usd) }));
  const usados = new Set(); let fusionadas = 0; const manual = [];
  for (const p of manualesAgrupadas.map(unirTramos)) {
    const dia = p.abierta_fecha_ny || ymdNY(p.abierta_at);
    const i = delBroker.findIndex((g, j) => !usados.has(j) && g.symbol === p.symbol && g.direccion === p.direccion
      && g.abierta_fecha_ny === dia && (p.strike == null || num(p.strike) === g.strike)
      && (!p.expiracion || p.expiracion === g.expiracion));
    if (i >= 0) {
      usados.add(i); fusionadas++;
      const g = delBroker[i];
      g.fuera_de_rango = !!p.fuera_de_rango; g.entrada_semaforo = p.entrada_semaforo || null; g._manual_id = p.id;
      g.plan_pct = p.plan_pct; g.stop_pct = p.stop_pct == null ? null : p.stop_pct;   // el plan congelado viaja con la operación
      if (p._salida_corte) g._salida_corte = true;                                     // cerrada por la venta del corte
      continue;
    }
    manual.push({ ...p, abierta_fecha_ny: dia, _fuente: 'manual' });
  }
  const ops = [...manual, ...delBroker].sort((a, b) => (a.abierta_at || '').localeCompare(b.abierta_at || ''));
  const cuenta = (b) => (trades || []).filter(t => t.broker === b).length;
  return { ops, fusionadas, fuentes: { manual: (posic || []).length, etrade: cuenta('etrade'), tasty: cuenta('tasty'), schwab: cuenta('schwab') } };
}

// Filas cerradas (o expiradas) desde `desde` (fecha NY) por fecha de CIERRE, PURA. Una
// operación agrupada (unirOperaciones) se abre en sus tramos: un cierre parcial cuenta en
// la semana en que se cerró aunque el resto siga abierto o cierre otra semana.
function cerradasDesde(ops, desde) {
  const esCerrada = (p) => p.estado === 'cerrada' || p.estado === 'expirada';
  return (ops || []).flatMap(p => (p && p._filas) || [p]).filter(p => p && esCerrada(p) && (ymdNY(p.cerrada_at) || '') >= desde);
}

const TAMANO_PCT = 10;   // doctrina: máximo 10% de la cuenta por operación
// Reglas rotas del período (Disciplina), PURA. Cada operación se juzga con SU plan
// congelado (plan_pct); sin plan_pct → Plan 35 (el default de posiciones.plan_pct):
// cambiar de plan NO es retroactivo. ops en orden de apertura. Tamaño: contra el
// saldo del bróker de cada operación (saldos[broker]) y, si falta, el total (saldo);
// sin ninguno (0) la regla no se evalúa.
//   Plan 35%: fuera de rango, 4ª+ operación de la semana, tamaño >10% (como siempre).
//   Plan 10%: fuera de rango, 2ª+ del día, tamaño >50%.
//   Corte (solo operaciones con stop_pct CONGELADO, con SU stop_pct): se fue a cero,
//   o perdió más que stop_pct + 5 puntos (tolerancia de ejecución: el aviso tarda,
//   la cancelación se confirma y la venta va al bid). Una operación cerrada por una
//   orden salida_corte (_salida_corte) cortó: jamás se marca. En esas dos el costo es
//   lo perdido MÁS ALLÁ del corte.
function reglasRotas(ops, saldo, saldos) {
  ops = ops || [];
  const rotas = [];
  const esCerrada = (p) => p.estado === 'cerrada' || p.estado === 'expirada';
  const costoEntrada = (p) => (Number(p.prima_fill) || 0) * (Number(p.contratos) || 0) * 100;
  const etiqueta = (p) => `${p.symbol} ${p.direccion}${p.strike ? ' ' + p.strike : ''} · ${fmtFechaNY(p.abierta_at)} · ${p._fuente === 'manual' ? 'manual' : p._fuente}`;
  const planDe = (p) => planDePct(p.plan_pct);                  // sin plan_pct → Plan 35
  const r2 = (n) => Math.round(n * 100) / 100;
  const TOLERANCIA_PTS = 5;
  const saldoDe = (p) => {
    const b = p.broker || (p._fuente && p._fuente !== 'manual' ? p._fuente : null);
    const s = (saldos && typeof saldos === 'object' && b) ? Number(saldos[b]) : NaN;
    return s > 0 ? s : (Number(saldo) || 0);
  };
  // (1) entrar FUERA del rango (veredicto que solo existe en el registro manual)
  for (const p of ops.filter(p => p.fuera_de_rango)) {
    const r = esCerrada(p) ? Number(p.resultado_usd) : NaN;
    rotas.push({ regla: 'Entró FUERA del rango óptimo', det: etiqueta(p),
      costo: (Number.isFinite(r) && r < 0) ? r : 0, gano: Number.isFinite(r) && r > 0 });
  }
  // (2) cupo excedido: por semana (lunes NY) en el Plan 35%, por día en el Plan 10%
  const grupos = {};
  for (const p of ops) {
    const d = new Date((p.abierta_fecha_ny || '') + 'T12:00:00Z');
    if (isNaN(d)) continue;
    const plan = planDe(p);
    let key = p.abierta_fecha_ny;
    if (plan.periodo !== 'dia') { const wk = new Date(d); wk.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); key = wk.toISOString().slice(0, 10); }
    const k = plan.id + '|' + key;
    (grupos[k] = grupos[k] || { plan, key, lista: [] }).lista.push(p);
  }
  for (const g of Object.values(grupos)) {
    if (g.lista.length <= g.plan.opsMax) continue;
    const extra = g.lista.slice(g.plan.opsMax);   // las que sobraron (ya en orden de apertura)
    const costo = extra.reduce((s, p) => s + Math.min(0, esCerrada(p) ? (Number(p.resultado_usd) || 0) : 0), 0);
    const sobraron = extra.map(p => p.symbol + ' ' + p.direccion).join(', ');
    if (g.plan.periodo === 'dia') {
      rotas.push({ regla: `${g.lista.length} operaciones ese día (plan: ${g.plan.opsMax} al día)`,
        det: `día ${fmtFechaNY(g.key + 'T12:00:00Z')} · sobraron: ${sobraron}`, costo, gano: false });
    } else {
      rotas.push({ regla: `${g.lista.length} operaciones esa semana (plan: ${g.plan.opsMax})`,
        det: `semana del ${fmtFechaNY(g.key + 'T12:00:00Z')} · sobraron: ${sobraron}`, costo, gano: false });
    }
  }
  // (3) tamaño por encima del tope de SU plan, contra la cuenta de SU bróker
  // (costo de entrada = prima × contratos × 100)
  for (const p of ops) {
    const s = saldoDe(p);
    if (!(s > 0)) continue;
    const plan = planDe(p), tope = s * plan.tamanoMaxPct / 100;
    if (!(costoEntrada(p) > tope)) continue;
    const r = esCerrada(p) ? Number(p.resultado_usd) : NaN;
    rotas.push({ regla: `Tamaño ${usd(costoEntrada(p))}: más del ${plan.tamanoMaxPct}% de la cuenta (${usd(tope)})`,
      det: etiqueta(p), costo: (Number.isFinite(r) && r < 0) ? r : 0, gano: Number.isFinite(r) && r > 0 });
  }
  // (4) y (5) corte: solo con stop_pct CONGELADO en la operación · se fue a cero · cortó tarde
  for (const p of ops) {
    const stop = Number(p.stop_pct);
    if (p.stop_pct == null || !(stop > 0 && stop < 100) || !esCerrada(p) || p._salida_corte) continue;
    const costoE = costoEntrada(p);
    if (!(costoE > 0)) continue;
    const cero = p.estado === 'expirada' || (p.prima_salida != null && p.prima_salida !== '' && Number(p.prima_salida) === 0);
    const r = (p.resultado_usd != null && Number.isFinite(Number(p.resultado_usd))) ? Number(p.resultado_usd) : (cero ? -costoE : NaN);
    if (!Number.isFinite(r)) continue;
    const limite = -costoE * stop / 100;               // lo máximo que el plan deja perder
    if (cero) {
      rotas.push({ regla: `Se fue a cero: no cortó en -${stop}%`, det: etiqueta(p), costo: Math.min(0, r2(r - limite)), gano: false });
    } else if (r < -costoE * (stop + TOLERANCIA_PTS) / 100) {
      rotas.push({ regla: `Cortó por debajo del -${stop}% (-${Math.round(-r / costoE * 100)}%)`, det: etiqueta(p), costo: r2(r - limite), gano: false });
    }
  }
  return rotas;
}
async function vistaDisciplina() {
  const [posR, btR, csR, corR] = await Promise.all([
    sb.from('posiciones').select('*'),
    sb.from('broker_trades').select('*'),
    sb.from('cuenta_snapshots').select('broker,saldo_neto,capturado_at'),
    // ventas de CORTE ejecutadas: esa operación cortó (Disciplina no la acusa de no cortar)
    sb.from('ordenes').select('posicion_id').eq('proposito', 'salida_corte').eq('estado', 'ejecutada'),
    cargarPlanUsuario(),
  ]);
  const plan = planActivo();
  const conCorte = new Set(((corR && corR.data) || []).map(o => String(o.posicion_id)));
  const posic = (posR.data || []).map(p => conCorte.has(String(p.id)) ? { ...p, _salida_corte: true } : p);
  const { ops, fusionadas, fuentes } = unirOperaciones(posic, btR.data || []);
  const snaps = csR.data || [];
  const saldo = snaps.reduce((s, c) => s + (Number(c.saldo_neto) || 0), 0);
  const haySaldo = snaps.length > 0 && saldo > 0;
  // saldo de cada bróker (una fila por bróker): la regla de tamaño mide contra el de la operación
  const saldos = {};
  snaps.forEach(c => { if (c.broker && Number(c.saldo_neto) > 0) saldos[c.broker] = Number(c.saldo_neto); });
  const topesTxt = (pct) => Object.entries(saldos).map(([b, s]) => `${BROKER_NOMBRE[b] || b} ${usd(s * pct / 100)}`).join(' · ');
  const inicioMes = inicioPeriodo('mes');
  const lun = lunesNY();
  const esCerrada = (p) => p.estado === 'cerrada' || p.estado === 'expirada';
  const delMes = ops.filter(p => (p.abierta_fecha_ny || '') >= inicioMes);
  const semana = ops.filter(p => (p.abierta_fecha_ny || '') >= lun);   // ya viene en orden de apertura
  // Lo ganado de la semana se mide por fecha de CIERRE de cada tramo (igual que Cuentas);
  // el cupo 3/semana sí va por fecha de ENTRADA y cuenta operaciones agrupadas.
  const cerradasSem = cerradasDesde(ops, lun);

  // cupo de la semana (conjunto deduplicado; el excedente = más allá de la 3ª)
  const usadas = semana.length;
  const colCupo = usadas > OPS_SEMANA ? 'var(--rojo)' : usadas === OPS_SEMANA ? 'var(--oro)' : 'var(--verde)';
  const extraSem = semana.slice(OPS_SEMANA);

  // excedente a retirar (resultado cerrado positivo de la semana, bróker incluido)
  const resSem = cerradasSem.reduce((s, p) => s + (Number(p.resultado_usd) || 0), 0);
  const excedente = Math.max(0, resSem);

  // reglas rotas del mes: cada operación con SU plan congelado (sin plan_pct → Plan 35:
  // cambiar de plan no es retroactivo) y el tamaño contra la cuenta de SU bróker
  const rotas = reglasRotas(delMes, haySaldo ? saldo : 0, haySaldo ? saldos : null);
  const costoTotal = rotas.reduce((s, r) => s + (r.costo || 0), 0);

  let h = '';
  if (plan.periodo === 'dia') {
    // Plan 10%: cumplimiento del DÍA (1 operación) y tope de tamaño del 50%
    const hoyD = hoyNY();
    const deHoy = ops.filter(p => (p.abierta_fecha_ny || '') === hoyD);
    const usadasHoy = deHoy.length, extraHoy = deHoy.slice(plan.opsMax);
    const colHoy = usadasHoy > plan.opsMax ? 'var(--rojo)' : usadasHoy === plan.opsMax ? 'var(--oro)' : 'var(--verde)';
    const costoExtraHoy = extraHoy.reduce((s, p) => s + Math.min(0, esCerrada(p) ? (Number(p.resultado_usd) || 0) : 0), 0);
    h += `<div class="card">
    <div class="fila"><h3>Plan del día</h3>
      <span style="font-weight:800;font-size:20px;color:${colHoy}">${usadasHoy} / ${plan.opsMax}</span></div>
    <div class="mut" style="margin-top:3px">${esc(plan.nombre)}: ${plan.opsMax} operación al día · ${plan.tamanoMinPct}–${plan.tamanoMaxPct}% de la cuenta · GTC +${plan.gtcPct}% · corte -${plan.stopPct}% · una compañía al día. El plan manda.</div>
    ${extraHoy.length ? `<div class="mut" style="margin-top:6px;color:var(--rojo)">Excedente: ${extraHoy.length} op${extraHoy.length > 1 ? 's' : ''} más allá de la ${plan.opsMax}ª de hoy (${esc(extraHoy.map(p => p.symbol + ' ' + p.direccion).join(', '))})${costoExtraHoy < 0 ? ' · te costaron ' + usd(costoExtraHoy) : ''}</div>` : ''}
    ${haySaldo ? `<div class="fresco" style="margin-top:6px">saldo ${usd(saldo)} · tope por operación (${plan.tamanoMaxPct}% de la cuenta de su bróker, saldo actual): ${topesTxt(plan.tamanoMaxPct)}</div>`
      : `<div class="fresco" style="margin-top:6px">sin saldo de cuenta todavía (cuenta_snapshots): la regla del ${plan.tamanoMaxPct}% no se evalúa</div>`}</div>`;
  } else {
    // cumplimiento del plan (semana) — Plan 35%, como siempre
    const costoExtraSem = extraSem.reduce((s, p) => s + Math.min(0, esCerrada(p) ? (Number(p.resultado_usd) || 0) : 0), 0);
    h += `<div class="card">
    <div class="fila"><h3>Plan de la semana</h3>
      <span style="font-weight:800;font-size:20px;color:${colCupo}">${usadas} / ${OPS_SEMANA}</span></div>
    <div class="mut" style="margin-top:3px">3 operaciones por semana · ${TAMANO_PCT}% de la cuenta por operación · solo tus ${TICKERS.length} tickers. El plan manda.</div>
    ${extraSem.length ? `<div class="mut" style="margin-top:6px;color:var(--rojo)">Excedente: ${extraSem.length} op${extraSem.length > 1 ? 's' : ''} más allá de la 3ª (${esc(extraSem.map(p => p.symbol + ' ' + p.direccion).join(', '))})${costoExtraSem < 0 ? ' · te costaron ' + usd(costoExtraSem) : ''}</div>` : ''}
    ${haySaldo ? `<div class="fresco" style="margin-top:6px">saldo ${usd(saldo)} · tope por operación (${TAMANO_PCT}% de la cuenta de su bróker, saldo actual): ${topesTxt(TAMANO_PCT)}</div>`
      : `<div class="fresco" style="margin-top:6px">sin saldo de cuenta todavía (cuenta_snapshots): la regla del ${TAMANO_PCT}% no se evalúa</div>`}</div>`;
  }

  // excedente a retirar (doctrina del Plan 35%; el Plan 10% no lo define)
  if (plan.periodo !== 'dia' && excedente > 0) {
    h += `<div class="card" style="border-color:rgba(69,208,140,.4)">
      <div class="mut" style="font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--verde)">EXCEDENTE A RETIRAR ESTE VIERNES</div>
      <div class="mono" style="font-size:26px;font-weight:700;color:var(--verde);margin-top:2px">${usd(excedente)}</div>
      <div class="mut" style="margin-top:2px">Lo ganado de la semana. La doctrina: retira el excedente, no lo dejes en riesgo.</div></div>`;
  }

  // reglas rotas
  h += `<div class="sec">REGLAS ROTAS · ${nombreMesNY().toUpperCase()}</div>`;
  if (rotas.length) {
    h += `<div class="card" style="border-color:rgba(242,109,95,.35)">
      <div class="fila"><span class="mut" style="font-weight:700">Te costaron este mes</span>
        <span class="mono" style="font-weight:700;color:var(--rojo)">${usd(costoTotal)}</span></div></div>`;
    h += rotas.map(r => `<div class="card">
      <div class="fila" style="align-items:flex-start">
        <div><div style="font-weight:700;font-size:13.5px;color:var(--rojo)">${esc(r.regla)}</div>
          <div class="mut" style="margin-top:2px">${esc(r.det)}</div></div>
        <span class="mono" style="font-weight:700;color:${r.costo<0?'var(--rojo)':'var(--tx2)'};white-space:nowrap">${
          r.costo < 0 ? usd(r.costo) : (r.gano ? 'ganó igual' : '$0')}</span></div>
    </div>`).join('');
  } else {
    h += `<div class="card vacio">Ninguna regla rota este mes. 🎯<br>Así se construye la cuenta.</div>`;
  }
  h += `<div class="mut" style="text-align:center;font-size:11px;padding:8px 12px">fuentes: manual ${fuentes.manual} · E*TRADE ${fuentes.etrade} · tasty ${fuentes.tasty}${fuentes.schwab ? ' · Schwab ' + fuentes.schwab : ''}${fusionadas ? ` · ${fusionadas} manual${fusionadas > 1 ? 'es' : ''} fusionada${fusionadas > 1 ? 's' : ''} con el bróker` : ''}</div>`;
  $('#vista').innerHTML = h;
}

function vistaProx(tab) {
  const txt = {
    cuentas: 'Cuentas y diario llega pronto.',
  }[tab] || 'Próximamente.';
  $('#vista').innerHTML = `<div class="prox">${esc(txt)}</div>`;
}

// registrar el service worker (shell-only + avisos push)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Mensajes del SW: 'navegar' (al tocar un aviso: enfoca y va a la ruta sin
  // recargar) y 'resuscribir' (el navegador rotó la suscripción push → volver
  // a guardarla en la nube).
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.tipo === 'navegar' && typeof d.url === 'string' && d.url.startsWith('#/')) {
      if (location.hash === d.url) ruta(); else location.hash = d.url;
    }
    if (d.tipo === 'resuscribir') avisosAutocurar();
  });
}
