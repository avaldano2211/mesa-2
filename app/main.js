/* Mesa 2.0 — app (PWA). Lee en vivo de Supabase; la muralla es RLS + whitelist.
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

const TICKERS = ['AAPL', 'TSLA', 'NVDA', 'SPY'];
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
    setTimeout(reanudarLoginEtrade, 400);   // login de E*TRADE a medias (PWA recargada durante el 2FA)
  } else if (timer) { clearInterval(timer); }
}
window.addEventListener('hashchange', ruta);
// Al volver del fondo (iOS congela la PWA y corta los fetch en vuelo): si estuvo
// oculta más de 30 s se redibuja la vista y, si hay un formulario de orden
// abierto, se recarga la cadena.
let _ocultaDesde = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { _ocultaDesde = Date.now(); return; }
  if (!sesionActiva || !_ocultaDesde || Date.now() - _ocultaDesde < 30000) return;
  _ocultaDesde = 0;
  ruta();
  if (typeof _ord !== 'undefined' && _ord && $('#modalOrden')) cargarCadena(true);
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
  $('#titulo').textContent = titulos[tab] || 'Mesa 2.0';
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
  const [estados, senales] = await Promise.all([
    sb.from('ticker_estado').select('*'),
    // solo las de HOY (NY): un dato viejo jamás se presenta como fresco
    sb.from('senales').select('*').eq('fecha_ny', hoy).order('creado_at', { ascending: false }).limit(8),
  ]);
  const est = estados.data || [];
  const merc = est.find(e => e.symbol === 'MERCADO');
  const sen = senales.data || [];
  let h = '';

  // resumen del worker
  const fr = hb ? haceCuanto(hb.latido_at) : { txt: 'sin dato' };
  h += `<div class="card"><div class="fila"><h3>Estado del sistema</h3>
    <span class="fresco">latido ${esc(fr.txt)}</span></div>
    <div class="mut">${hb ? `El analista está <b style="color:var(--tx)">${esc(hb.estado_proceso)}</b> · sesión <b style="color:var(--tx)">${esc(hb.sesion)}</b>. `
      : 'Sin latido del worker todavía. '}${
      merc && merc.payload && merc.payload.regla_1030 ? 'Antes de las 10:30 ET.' : ''}</div></div>`;

  // señales del día
  h += `<div class="sec">SEÑALES DE HOY (E5)</div>`;
  if (sen.length) {
    h += sen.map(s => `<div class="card"><div class="fila">
      <span style="font-weight:700;font-size:13.5px">${esc(s.titulo)}</span>
      <span class="fresco">${esc(haceCuanto(s.creado_at).txt)}</span></div>
      <div class="mut" style="margin-top:5px">${esc(s.motivo || '')}</div>
      ${s.instruccion_gtc ? `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(s.instruccion_gtc)}</div>` : ''}
    </div>`).join('');
  } else {
    h += `<div class="card vacio">Sin señales todavía hoy.<br>E5 evalúa la apertura de las 9:30 ET.</div>`;
  }

  // tickers resumidos
  h += `<div class="sec">TUS TICKERS</div>`;
  h += TICKERS.map(t => tarjetaTicker(est.find(e => e.symbol === t), t, true)).join('') ||
    `<div class="card vacio">Aún no hay estado publicado.</div>`;
  $('#vista').innerHTML = h;
}

function tarjetaTicker(e, sym, compacto) {
  if (!e) return `<div class="card"><div class="fila"><h3>${sym}</h3>
    <span class="chip c-esp">SIN DATO</span></div></div>`;
  const p = e.payload || {};
  const te = p.tendencias || {};
  const fr = haceCuanto(e.actualizado_at);
  const av = (p.avisos || []).slice(0, compacto ? 1 : 4);
  const rv = p.rango_vivo;
  return `<div class="card">
    <div class="fila"><h3>${esc(sym)}</h3>
      <span class="fresco">${esc(fr.txt)}</span></div>
    <div class="tend" style="margin-top:6px">
      ${tg('15m', te.m15)} ${tg('hora', te.hora)} ${tg('día', te.dia)}
      ${volTxt(p.volatilidad)}</div>
    ${rv && rv.lo != null ? `<div class="rango">
      <span>Rango óptimo del día</span>
      <b class="mono">$${esc(Math.round(rv.lo))}–$${esc(Math.round(rv.hi))}</b>
      <span class="fresco">exp ${esc((rv.exp||'').slice(5))} · spot $${esc(rv.spot)}</span></div>` : ''}
    ${av.length ? `<div class="mut" style="margin-top:7px">${av.map(esc).join(' · ')}</div>` : ''}
  </div>`;
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

async function vistaTickers() {
  const { data } = await sb.from('ticker_estado').select('*');
  const est = data || [];
  $('#vista').innerHTML = TICKERS.map(t =>
    tarjetaTicker(est.find(e => e.symbol === t), t, false)).join('') ||
    `<div class="card vacio">Aún no hay estado publicado.</div>`;
}

// ---------- Copiloto ----------
const PLAN_PCT = 35;      // doctrina (literal); el plan personal lo afinará plan_semanal
const OPS_SEMANA = 3;     // 3 ops/semana
const gtcDe = (fill) => Math.round((fill * (1 + PLAN_PCT / 100) + 0.02) * 100) / 100;
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
  const [sen, pos, bt, ord] = await Promise.all([
    sb.from('senales').select('*').eq('fecha_ny', hoy).order('creado_at', { ascending: false }),
    sb.from('posiciones').select('*').order('abierta_at', { ascending: false }),
    sb.from('broker_trades').select('*'),
    sb.from('ordenes').select('*').in('estado', ['enviada', 'error']).order('creado_at', { ascending: false }).limit(20),   // solo ACTIVAS (y las que no se pudo confirmar)
  ]);
  const senales = sen.data || [];
  const posic = pos.data || [];
  const abiertas = posic.filter(p => p.estado === 'abierta');
  // Mismo cupo que Disciplina: manual + bróker, deduplicado.
  const semana = unirOperaciones(posic, bt.data || []).ops.filter(p => (p.abierta_fecha_ny || '') >= lunesNY());
  let h = '';

  // cupo semanal
  const usadas = semana.length;
  const colorCupo = usadas > OPS_SEMANA ? 'var(--rojo)' : usadas === OPS_SEMANA ? 'var(--oro)' : 'var(--verde)';
  h += `<div class="card"><div class="fila"><h3>Plan de la semana</h3>
    <span style="font-weight:700;color:${colorCupo}">${usadas} / ${OPS_SEMANA}</span></div>
    <div class="mut">Operaciones esta semana. La doctrina: 3 por semana, ni una más.</div></div>`;

  // señales de hoy → ticket
  h += `<div class="sec">SEÑALES DE HOY</div>`;
  if (senales.length) {
    h += senales.map(s => tarjetaSenal(s, posic)).join('');
  } else {
    h += `<div class="card vacio">Sin señales todavía hoy.<br>E5 evalúa la apertura de las 9:30 ET.</div>`;
  }

  // registrar a mano (útil siempre) · nueva orden en E*TRADE (vista previa primero)
  h += `<div class="dos">
    <button class="btnsec" style="padding:12px" onclick="MZ.abrirFill()">+ Registrar una operación</button>
    <button class="pri" onclick="MZ.abrirOrden({proposito:'entrada'})">+ Nueva orden E*TRADE</button></div>`;

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
}

function tarjetaSenal(s, posic) {
  const yaReg = posic.some(p => p.senal_id === s.id);
  return `<div class="card" style="border-color:rgba(231,181,77,.45)">
    <div class="fila"><span style="font-weight:700;font-size:13.5px">${esc(s.titulo)}</span>
      <span class="fresco">${esc(haceCuanto(s.creado_at).txt)}</span></div>
    <div class="mut" style="margin-top:5px">${esc(s.motivo || '')}</div>
    ${s.instruccion_gtc ? `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(s.instruccion_gtc)}</div>` : ''}
    ${yaReg ? `<div class="mut" style="margin-top:8px;color:var(--verde)">✓ ya registraste tu fill</div>`
      : `<div class="dos" style="margin-top:9px">
        <button class="btnsec" onclick='MZ.abrirFill(${JSON.stringify({
          senal_id: s.id, symbol: s.symbol, direccion: s.direccion }).replace(/'/g, "&#39;")})'>Registrar mi fill</button>
        <button class="pri" onclick='MZ.abrirOrden(${JSON.stringify({
          senal_id: s.id, symbol: s.symbol, direccion: s.direccion, proposito: 'entrada' }).replace(/'/g, "&#39;")})'>Operar en E*TRADE</button></div>`}
  </div>`;
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

function tarjetaPosicion(p) {
  return `<div class="card">
    <div class="fila"><h3>${esc(p.symbol)} ${esc(p.direccion)}${p.strike ? ' ' + esc(p.strike) : ''}</h3>
      <span class="fresco">×${esc(p.contratos)} · ${esc(p.broker || '—')}</span></div>
    <div class="fila" style="margin-top:6px">
      <span class="mut">fill <b class="mono" style="color:var(--tx)">$${esc(p.prima_fill)}</b></span>
      <span class="mut">límite GTC <b class="mono" style="color:var(--oro)">$${esc(p.gtc_limite)}</b></span></div>
    ${pnlVivo(p)}
    <div class="fila" style="margin-top:9px;gap:8px">
      <button class="btnsec" onclick="MZ.copiar('${esc(p.gtc_limite)}')">Copiar GTC</button>
      <button class="btnsec" onclick="MZ.cerrar(${p.id}, ${p.prima_fill})">Registrar salida</button></div>
    ${(!p.broker || p.broker === 'etrade') ? `<div class="fila" style="margin-top:8px;gap:8px">
      <button class="btnsec" style="color:var(--oro);border-color:rgba(231,181,77,.45)" onclick='MZ.abrirOrden(${JSON.stringify(preSalida(p, 'salida_gtc')).replace(/'/g, "&#39;")})'>GTC +${PLAN_PCT}% ($${esc(gtcDe(Number(p.prima_fill)).toFixed(2))})</button>
      <button class="btnsec" onclick='MZ.abrirOrden(${JSON.stringify(preSalida(p, 'salida_stop')).replace(/'/g, "&#39;")})'>Trailing stop</button></div>` : ''}
  </div>`;
}
// Prefill de una orden de SALIDA (SELL_CLOSE) desde una posición abierta.
function preSalida(p, proposito) {
  const gtc = proposito === 'salida_gtc';
  return { proposito, posicion_id: p.id, symbol: p.symbol, direccion: p.direccion,
    strike: p.strike == null ? undefined : Number(p.strike), expiracion: p.expiracion || undefined,
    cantidad: Number(p.contratos) || 1, accion: 'venta', orderTerm: 'GOOD_UNTIL_CANCEL',
    priceType: gtc ? 'LIMIT' : 'TRAILING_STOP_PRCT',
    limitPrice: gtc ? gtcDe(Number(p.prima_fill)) : undefined };
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
    <select id="fSym">${['AAPL','TSLA','NVDA','SPY'].map(t =>
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
  const evaluar = () => {
    const v = parseFloat(prima.value);
    m.querySelector('#fGtc').textContent = v > 0
      ? `Límite GTC a colocar: $${gtcDe(v).toFixed(2)}  (fill ×1.35 + $0.02)` : 'Límite GTC: —';
    const rh = m.querySelector('#fRango');
    if (!rango || rango.lo == null) { rh.textContent = 'Rango óptimo: sin dato'; rh.dataset.n = ''; return; }
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
    rango = data && data.payload ? data.payload.rango_vivo : null;
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
  const fila = {
    user_id: uid, symbol: g('fSym'), direccion: g('fDir'),
    strike, expiracion: g('fExp'), contratos: qty, prima_fill: prima,
    plan_pct: PLAN_PCT, broker: g('fBr'), senal_id: senalId || null,
    abierta_fecha_ny: hoy,
    entrada_semaforo: (sem === 'ok' || sem === 'aviso' || sem === 'alto') ? sem : null,
    fuera_de_rango: sem === 'alto',
  };
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
  setTimeout(() => { const i = $('#cpActual'); if (i) i.focus(); }, 60);
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
window.MZ = Object.assign(window.MZ, { abrirCuenta, cerrarCuenta, cambiarPass, salir, avisos: avisosToggle });

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

const BROKERS = [
  { k: 'etrade', n: 'E*TRADE' }, { k: 'tasty', n: 'tastytrade' },
  { k: 'schwab', n: 'Charles Schwab' },
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
  // Historial E*TRADE: se muestra el resumen cacheado y se sincroniza en segundo
  // plano; se re-dibuja al terminar (el tope de 10 min evita bucles).
  let etHist = null;
  try { const p = JSON.parse(localStorage.getItem(ET_K.sync) || 'null'); etHist = p ? p.resumen : null; } catch (_) {}
  if (etCreds() && !etExpirado) {
    const enCurso = !etHist || Date.now() - (etHist.ts || 0) >= ET_SYNC_TTL;
    if (enCurso) etHist = { estado: 'sincronizando' };
    // Solo se re-dibuja si el usuario sigue en Cuentas (la sincronización tarda).
    const enCuentas = () => (location.hash.replace('#/', '') || 'informe') === 'cuentas';
    etradeSincronizar().then(s => { if (s && (s.cambio || enCurso) && enCuentas()) vistaCuentas(); });
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
      const reconn = b.k === 'etrade'
        ? ` · <a href="#" onclick="MZ.conectar('etrade');return false" style="color:var(--oro)">reconectar</a>`
          + ` · <a href="#" onclick="MZ.etOlvidar();return false" style="color:var(--tx3)">olvidar en este equipo</a>` : '';
      const hist = b.k === 'etrade' ? etradeLineaHistorial(etHist) : '';
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
      : b.k === 'schwab' ? 'en aprobación de Schwab' : 'requiere tu login';
    const btn = b.k === 'tasty' ? ''
      : (b.k === 'etrade' && etSinRed) ? `<button class="btnsec" style="flex:none;padding:8px 14px" onclick="MZ.etReintentar()">Reintentar</button>`
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
    if (b === 'schwab') { toast('Schwab: la activamos en cuanto apruebe tu app'); return; }
    toast('Bróker no soportado');
  },
  pinEnviar: (rt) => etradePinEnviar(rt),
  pinCancelar: () => { etLoginOlvidar(); const m = $('#modalPin'); if (m) m.remove(); },
  etReintentar: () => ruta(),
  etSync: () => etSyncAhora(),
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
const PROPOSITOS = ['entrada', 'salida_gtc', 'salida_stop', 'cancelar', 'otro'];

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
  const lo = Math.round(rango.lo), hi = Math.round(rango.hi), cent = prima * 100, borde = (hi - lo) * 0.15;
  if (cent < lo - borde || cent > hi + borde) return 'alto';
  if (cent < lo || cent > hi) return 'aviso';
  return 'ok';
}

// Avisos de doctrina EN VIVO (amarillos; nunca bloquean). ctx: {rango, opsSemana,
// saldo, antes1030}. La regla del ticker aplica a toda orden; las demás solo a
// ENTRADAS (una salida no abre operación ni gasta cupo).
function avisosOrden(f, ctx) {
  f = f || {}; ctx = ctx || {};
  const av = [];
  const sym = String(f.symbol || '').trim().toUpperCase();
  const esEntrada = f.accion !== 'venta';
  const esOpt = f.tipo !== 'EQ';
  const qty = Number(f.cantidad) || 0;
  const precio = f.priceType === 'LIMIT' ? Number(f.limitPrice) : null;
  if (sym && !TICKERS.includes(sym)) av.push(`${sym} no está en tus 4 tickers (${TICKERS.join(', ')})`);
  if (!esEntrada) return av;
  if (esOpt && precio > 0 && ctx.rango && ctx.rango.lo != null && semaforoRango(precio, ctx.rango) === 'alto') {
    av.push(`Prima $${(precio * 100).toFixed(0)} FUERA del rango óptimo $${Math.round(ctx.rango.lo)}–$${Math.round(ctx.rango.hi)} — así se perdió en agosto`);
  }
  const ops = Number(ctx.opsSemana) || 0;
  if (ops >= OPS_SEMANA) av.push(`Sería la ${ops + 1}ª operación de la semana (plan: ${OPS_SEMANA})`);
  const saldo = Number(ctx.saldo) || 0;
  if (precio > 0 && qty > 0 && saldo > 0) {
    const costo = precio * qty * (esOpt ? 100 : 1), tope = saldo * TAMANO_PCT / 100;
    if (costo > tope) av.push(`Costo ${usd(costo)}: más del ${TAMANO_PCT}% de la cuenta (${usd(tope)})`);
  }
  if (ctx.antes1030) av.push('Antes de las 10:30 ET: la doctrina espera a que el mercado defina');
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
function propositoDe(f) {
  if (f.accion !== 'venta') return 'entrada';
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
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalOrden';
  m.innerHTML = `<div class="hoja">
    <div class="fila"><h3 style="margin:0">Orden E*TRADE</h3><span class="fresco" id="oArm"></span></div>
    <div class="mut" style="margin-bottom:4px">Primero la vista previa de E*TRADE; nada se envía sin tu toque.</div>
    <label>Ticker</label>
    <input id="oSym" list="oSyms" value="${esc(pre.symbol || '')}" placeholder="AAPL" autocapitalize="characters" autocomplete="off" spellcheck="false" style="text-transform:uppercase">
    <datalist id="oSyms">${TICKERS.map(t => `<option value="${t}">`).join('')}</datalist>
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
    <div class="dos">
      <div><label>Precio</label><select id="oPt">
        <option value="LIMIT" ${pt === 'LIMIT' ? 'selected' : ''}>Límite</option>
        <option value="MARKET" ${pt === 'MARKET' ? 'selected' : ''}>Mercado</option>
        <option value="STOP" ${pt === 'STOP' ? 'selected' : ''}>Stop</option>
        <option value="TRAILING_STOP_PRCT" ${pt === 'TRAILING_STOP_PRCT' ? 'selected' : ''}>Trailing stop %</option></select></div>
      <div id="oPrecioWrap"><label id="oPrecioLbl">Límite</label><input id="oPrecio" type="number" inputmode="decimal" step="0.01" value="${precio0 == null ? '' : esc(precio0)}" placeholder="ej. 0.98"></div></div>
    <div id="oAvisos"></div>
    <div id="oPrev"></div>
    <div class="err" id="oErr" style="text-align:left"></div>
    <div class="dos" style="margin-top:6px">
      <button class="btnsec" onclick="MZ.cerrarOrden()">Cancelar</button>
      <button class="pri" id="oBtnPrev" onclick="MZ.ordenPreview()">Vista previa en E*TRADE</button></div>
  </div>`;
  document.body.appendChild(m);
  _ord = { pre, ctx: null, f: null, orden: null, previewIds: null, filaId: null, accountIdKey: null, caduca: 0, timer: null, avisos: [], avisosTxt: '',
    cadena: null, cadenaSym: null, cadenaExp: null, cadenaClave: '', cadenaTs: 0, cadenaTimer: null, cadenaErr: null, cadenaCargando: false, cadenaGen: 0, cotiz: null, cotizTs: 0, vencs: [] };
  m.addEventListener('input', () => { ajustarFormOrden(); pintarAvisosOrden(); });
  m.addEventListener('change', (e) => {
    ajustarFormOrden(); pintarAvisosOrden();
    const id = e && e.target && e.target.id;
    if (id === 'oSym') _ord.cadenaSym = null;                      // símbolo nuevo → cotización y vencimientos de nuevo
    if (['oSym', 'oTipo', 'oExp', 'oAcc'].includes(id)) { _ord.cadenaGen++; cargarCadena(true); }   // gen++: una carga en vuelo se descarta y se relanza
  });
  ajustarFormOrden(); pintarArmadoOrden();
  cargarCtxOrden().then(() => { pintarAvisosOrden(); pintarCadena(); });
  cargarCadena();
  setTimeout(() => { const i = $('#oSym'); if (i && !i.value) i.focus(); }, 60);
}
// Una vista previa que no se envía (caduca, se edita o se cierra) queda 'expirada'
// en la bitácora, para que el Copiloto no se llene de previews muertas.
function expirarPreviewHuerfana() {
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
  const cr = etCreds();
  if (!cr) { box.innerHTML = `<div class="mut" style="margin-top:8px;font-size:11.5px">Cadena en vivo: <a href="#" onclick="MZ.conectar('etrade');return false">conecta E*TRADE</a> para ver aquí los precios de calls y puts.</div>`; return; }
  if (etDiaVencido()) { box.innerHTML = `<div class="mut" style="margin-top:8px;font-size:11.5px">Cadena en vivo: la sesión de E*TRADE expiró (muere a medianoche ET) — <a href="#" onclick="MZ.conectar('etrade');return false">reconectar E*TRADE</a>.</div>`; return; }
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
    if (o.cadenaSym !== sym) {                          // símbolo nuevo: cotización + vencimientos
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
      const rc = await etRead(cr, '/v1/market/optionchains.json', q);
      if (!vigente()) return descartar();
      if (rc.status === 401) throw new Error(errorCadena401(etError(rc)));
      const e2 = etError(rc); if (e2) throw new Error(e2);
      cadena = parsearCadena(rc);
    }
    Object.assign(o, { cadena, cadenaExp: exp, cadenaClave: sym + '|' + (exp || ''), cadenaTs: Date.now(), cadenaErr: null });
  } catch (e) { o.cadenaErr = textoErrorCadena(e); }
  o.cadenaCargando = false;
  if (!vigente()) { if (_ord === o) cargarCadena(true); return; }
  pintarCadena();
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
  const rangoTxt = rango && rango.lo != null ? ` · rango óptimo $${Math.round(rango.lo)}–$${Math.round(rango.hi)}` : '';
  let h = `<div class="cadena"><div class="fila" style="margin-bottom:4px">
    <span class="mut"><b style="color:var(--tx)">${esc(f.symbol)}</b> ${q.last != null ? '$' + q.last.toFixed(2) : ''} ${(q.bid != null && q.ask != null) ? `<span class="fresco">${q.bid.toFixed(2)}/${q.ask.toFixed(2)}</span>` : ''} ${vivo}</span>
    <span style="display:flex;gap:8px;align-items:center">${sel}<a href="#" onclick="MZ.cadenaRefrescar();return false" style="font-size:13px">↻</a></span></div>`;
  if (err === 'RECONECTAR') h += `<div class="mut" style="color:var(--rojo);font-size:11.5px">Cadena: la sesión de E*TRADE expiró — <a href="#" onclick="MZ.conectar('etrade');return false">reconectar E*TRADE</a></div>`;
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
      return `<td class="cel${cls}" onclick="MZ.cadenaElegir('${lado}',${strike},${o.ask != null ? o.ask : 'null'},${o.bid != null ? o.bid : 'null'})">${precio}${dl}</td>`;
    };
    const lineaAtm = spot != null ? `<tr class="atm-linea"><td colspan="3"><span>ATM · $${spot.toFixed(2)}</span></td></tr>` : '';
    const filas = []; let lineaPuesta = spot == null;
    for (const r of c.filas) {
      if (!lineaPuesta && r.strike >= spot) { filas.push(lineaAtm); lineaPuesta = true; }
      filas.push(`<tr class="${dist != null && Math.abs(r.strike - spot) === dist ? 'atm' : ''}">${celda(r.put, 'PUT', r.strike)}<td class="k">${r.strike}</td>${celda(r.call, 'CALL', r.strike)}</tr>`);
    }
    if (!lineaPuesta) filas.push(lineaAtm);
    h += `<table><thead><tr><th>PUT bid/ask</th><th>strike</th><th>CALL bid/ask</th></tr></thead><tbody>${filas.join('')}</tbody></table>
      <div class="fresco leyenda" style="margin-top:5px"><span class="sw itm"></span> in the money · <span class="sw otm"></span> out of the money · <span style="color:var(--oro);font-weight:700">━</span> at the money${spot != null ? ' $' + spot.toFixed(2) : ''} · <span class="sw rango"></span> prima en rango${rangoTxt}</div>
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
  ajustarFormOrden(); pintarAvisosOrden(); pintarCadena();
}
// Contexto de doctrina (rango por ticker, cupo semanal, saldo, hora): una consulta.
async function cargarCtxOrden() {
  const [te, pos, bt, cs] = await Promise.all([
    sb.from('ticker_estado').select('symbol,payload'),
    sb.from('posiciones').select('*'),
    sb.from('broker_trades').select('*'),
    sb.from('cuenta_snapshots').select('broker,saldo_neto'),
  ]);
  const est = te.data || [];
  const merc = est.find(e => e.symbol === 'MERCADO');
  const rangos = {};
  est.forEach(e => { rangos[e.symbol] = e.payload && e.payload.rango_vivo ? e.payload.rango_vivo : null; });
  const lun = lunesNY();
  const opsSemana = unirOperaciones(pos.data || [], bt.data || []).ops.filter(p => (p.abierta_fecha_ny || '') >= lun).length;
  const saldo = (cs.data || []).reduce((s, c) => s + (Number(c.saldo_neto) || 0), 0);
  if (_ord) _ord.ctx = { rangos, opsSemana, saldo, antes1030: antesDe1030NY(merc) };
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
  const av = c ? avisosOrden(f, { rango: c.rangos[f.symbol] || null, opsSemana: c.opsSemana, saldo: c.saldo, antes1030: c.antes1030 }) : [];
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
  const err = $('#oErr'), btn = $('#oBtnPrev');
  if (!err || !btn) return;
  err.textContent = '';
  const f = leerFormOrden();
  const e1 = validarOrden(f); if (e1) { err.textContent = e1; return; }
  pintarAvisosOrden();
  const av = _ord.avisos || [];
  if (requiereOverride(av) && !($('#oOverride') && $('#oOverride').checked)) {
    err.textContent = 'Hay avisos de doctrina: marca «Entiendo, rompo la regla» para seguir, o corrige la orden.'; return;
  }
  // 1) credenciales de E*TRADE (viven en este dispositivo) — antes del PIN,
  //    para no hacer teclear el PIN si falta el login diario
  const cr = etCreds();
  if (!cr) { err.textContent = 'Conecta E*TRADE primero: Cuentas → E*TRADE → Conectar (login diario).'; return; }
  if (etDiaVencido()) { err.textContent = 'La sesión de E*TRADE expiró a medianoche ET. Reconecta en Cuentas → E*TRADE.'; return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { err.textContent = 'Sin sesión. Sal y vuelve a entrar.'; return; }
  // 2) armado por PIN (sin PIN configurado → se crea aquí mismo)
  if (!(await pedirPin())) { err.textContent = 'Sin PIN no se opera.'; return; }
  pintarArmadoOrden();
  btn.disabled = true; btn.textContent = 'Consultando E*TRADE…';
  const pre = _ord.pre || {};
  const proposito = propositoDe(f);
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
      preview: Object.assign({ _mz: { semaforo, rango: rango ? { lo: rango.lo, hi: rango.hi } : null } }, recortarJson(P, 4000)) };
    const ins = await sb.from('ordenes').insert(fila).select('id').single();
    if (ins.error) throw new Error('No pude guardar la vista previa: ' + ins.error.message);
    Object.assign(_ord, { f, orden, previewIds, filaId: ins.data.id, estadoFila: 'preview', indeterminado: false, accountIdKey, caduca: Date.now() + PREVIEW_SEG * 1000 });
    pintarPreviewOrden(P);
    bloquearFormOrden(true);
  } catch (e) {
    err.textContent = String((e && e.message) || e);
  }
  btn.disabled = false; btn.textContent = 'Vista previa en E*TRADE';
}
function pintarPreviewOrden(P) {
  const box = $('#oPrev'); if (!box || !_ord) return;
  const o = (Array.isArray(P.Order) ? P.Order[0] : P.Order) || {};
  const msgs = (((o.messages || {}).Message) || []).map(x => x && x.description).filter(Boolean);
  const n = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : (Number(v) < 0 ? '-$' : '$') + Math.abs(Number(v)).toFixed(2);
  box.innerHTML = `<div class="prevbox">
    <div class="fila"><span class="mut">Costo estimado</span><b class="mono">${n(P.estimatedTotalAmount)}</b></div>
    <div class="fila"><span class="mut">Comisión</span><b class="mono">${n(P.estimatedCommission)}</b></div>
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
  const err = $('#oErr'), b = $('#oBtnPlace');
  if (!err || !b) return;
  err.textContent = '';
  if (_ord.indeterminado) { err.textContent = 'Verifica en E*TRADE si la orden entró antes de reintentar.'; return; }
  if (!_ord.previewIds || Date.now() > _ord.caduca) { err.textContent = 'La vista previa caducó (3 min). Vuelve a previsualizar.'; return; }
  if (!armadoHasta() && !(await pedirPin())) { err.textContent = 'Sin PIN no se opera.'; return; }
  // el PIN pudo tardar: la vista previa debe seguir vigente
  if (!_ord.previewIds || Date.now() > _ord.caduca) { err.textContent = 'La vista previa caducó mientras tecleabas el PIN. Vuelve a previsualizar.'; return; }
  const cr = etCreds();
  if (!cr) { err.textContent = 'Conecta E*TRADE primero.'; return; }
  const id = _ord.filaId, ahora = () => new Date().toISOString();
  const anotar = async (estado, extra) => {
    if (!id) return null;
    const { error } = await sb.from('ordenes').update(Object.assign({ estado, actualizado_at: ahora() }, extra || {})).eq('id', id);
    if (!error && _ord) _ord.estadoFila = estado;
    return error || null;
  };
  b.disabled = true; b.textContent = 'Enviando a E*TRADE…';
  let r = null, indeterminado = false;
  try {
    r = await etPost(cr, '/etrade/orden/place', { accountIdKey: _ord.accountIdKey, orden: _ord.orden, previewIds: _ord.previewIds });
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
    if (_ord.timer) clearInterval(_ord.timer);
    toast('Orden enviada a E*TRADE');
    cerrarOrden(); ruta();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!r || indeterminado) {
      // No se sabe si entró → 'error' y se exige verificar en E*TRADE (jamás
      // inventar éxito ni permitir un reintento a ciegas que la duplique).
      if (_ord) _ord.indeterminado = true;
      try { await anotar('error', { respuesta: { error: msg, nota: 'sin respuesta clara al enviar: verifica en E*TRADE' } }); } catch (_) {}
      err.textContent = msg + ' Verifica en E*TRADE si la orden entró ANTES de reintentar.';
      b.disabled = true; b.textContent = 'Verifica en E*TRADE';
      return;
    }
    err.textContent = msg;
    b.disabled = false; b.textContent = 'Enviar orden';
  }
}

// ---- Copiloto: ÓRDENES EN E*TRADE ----
function seccionOrdenes(filas) {
  const sinc = _ordSync.err ? `<span style="color:var(--rojo)">sin consultar E*TRADE: ${esc(_ordSync.err)}</span>`
    : _ordSync.ts ? `sincronizado con E*TRADE ${esc(horaNY(_ordSync.ts))} NY · se actualiza sola` : 'se sincroniza sola con E*TRADE';
  let h = `<div class="sec fila" style="margin-top:8px">ÓRDENES ACTIVAS EN E*TRADE
    <a href="#" onclick="MZ.ordenesActualizar();return false">Actualizar ahora</a></div>`;
  if (!filas.length) return h + `<div class="card vacio">Sin órdenes activas en E*TRADE.<br><span class="fresco">${sinc}</span></div>`;
  return h + filas.map(tarjetaOrden).join('') + `<div class="fresco" style="margin:2px 4px 6px">${sinc}</div>`;
}
// Estado que muestra la tarjeta: 'enviada' = ACTIVA en E*TRADE (o CANCELANDO /
// PARCIAL según el último detalle sincronizado); 'error' = no se pudo confirmar.
function etiquetaOrden(o) {
  const det = (((o.respuesta || {})._etrade || {}).OrderDetail || [])[0] || {};
  const st = String(det.status || '').toUpperCase();
  if (o.estado === 'enviada') return st === 'CANCEL_REQUESTED' ? 'CANCELANDO' : st === 'PARTIAL' ? 'PARCIAL' : 'ACTIVA';
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
  const prop = { entrada: 'entrada', salida_gtc: 'salida GTC', salida_stop: 'salida stop', cancelar: 'cancelar', otro: 'otra' }[o.proposito] || o.proposito;
  const ov = Array.isArray(o.overrides) ? o.overrides : [];
  return `<div class="card">
    <div class="fila"><span class="chip ${chip}">${esc(etiquetaOrden(o))}</span>
      <span class="fresco">${esc(fmtFechaNY(o.creado_at, true))} NY</span></div>
    ${o.estado === 'error' ? `<div class="mut" style="margin-top:4px;color:var(--rojo);font-size:11px">No se pudo confirmar si E*TRADE la recibió: revísala en la app de E*TRADE antes de repetirla.</div>` : ''}
    <div class="fila" style="margin-top:6px"><b style="font-size:13.5px">${esc(contrato)}</b>
      <span class="mut mono">${esc(o.accion)} ×${esc(Number(o.cantidad))}</span></div>
    <div class="fila" style="margin-top:3px"><span class="mut">${esc(prop)} · ${precio} · ${o.order_term === 'GOOD_UNTIL_CANCEL' ? 'GTC' : 'DAY'}${o.orden_id_ext ? ' · #' + esc(o.orden_id_ext) : ''}</span>
      ${o.estado === 'enviada' && o.orden_id_ext ? `<button class="btnsec" style="flex:none;padding:7px 12px" onclick="MZ.cancelarOrden(${Number(o.id)}, '${esc(o.orden_id_ext)}')">Cancelar</button>` : ''}</div>
    ${ov.length ? `<div class="mut" style="margin-top:4px;color:var(--oro);font-size:11px">override: ${esc(ov.join(' · '))}</div>` : ''}
  </div>`;
}
async function cancelarOrden(id, orderId) {
  if (!confirm('¿Cancelar en E*TRADE la orden #' + orderId + '?')) return;
  const cr = etCreds();
  if (!cr) { toast('Conecta E*TRADE primero'); return; }
  if (etDiaVencido()) { toast('Sesión de E*TRADE expirada — reconecta'); return; }
  toast('Cancelando en E*TRADE…');
  try {
    const accountIdKey = await etCuentaKey(cr);
    const r = await etPost(cr, '/etrade/orden/cancel', { accountIdKey, orderId: Number(orderId) });
    const d = r.data || {}, C = d.CancelOrderResponse || d;
    const em = mensajeError(r);
    if (r.status === 401) { toast(texto401Ordenes(em)); return; }
    // E*TRADE la rechaza (p. ej. ya estaba cancelada desde su app): se avisa y se
    // sincroniza enseguida para que la tarjeta refleje el estado real.
    if (r.status >= 400 || em) { toast('E*TRADE: ' + (em || 'HTTP ' + r.status)); ordenesActualizar({ silencioso: true, forzar: true }); return; }
    await sb.from('ordenes').update({ estado: 'cancelada', respuesta: recortarJson(C, 4096), actualizado_at: new Date().toISOString() }).eq('id', id);
    toast('Orden cancelada');
    ruta();
    setTimeout(() => ordenesActualizar({ silencioso: true, forzar: true }), 4000);   // «being processed» → confirmar CANCELLED
  } catch (e) { toast('No pude cancelar: ' + ((e && e.message) || e)); }
}
// Cruza las órdenes 'enviadas' con E*TRADE (abiertas + ejecutadas de los últimos
// 7 días) y actualiza estados; una ENTRADA ejecutada crea la posición y una
// SALIDA ejecutada cierra la suya.
// Sincroniza las órdenes 'enviada' con el estado REAL en E*TRADE. Manual (enlace
// «Actualizar ahora») o silenciosa (al abrir Copiloto, cada 60 s mientras haya
// activas, al volver del fondo y tras cancelar). Dos fases para no castigar la
// API: primero OPEN + CANCEL_REQUESTED (lo vivo); solo si alguna local no aparece
// ahí se piden los estados finales (EXECUTED/INDIVIDUAL_FILLS/CANCELLED/EXPIRED/
// REJECTED). Una cancelada desde la app de E*TRADE deja de ser 'enviada' sola.
const _ordSync = { ts: 0, enCurso: false, err: null };
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
  const cr = etCreds();
  if (!cr) { aviso('Conecta E*TRADE primero'); return; }
  if (etDiaVencido()) { aviso('Sesión de E*TRADE expirada — reconecta'); return; }
  const uid = sesionActiva && sesionActiva.user && sesionActiva.user.id;
  if (!uid) { aviso('Sin sesión. Sal y vuelve a entrar.'); return; }
  const { data, error } = await sb.from('ordenes').select('*').eq('estado', 'enviada').not('orden_id_ext', 'is', null);
  if (error) { aviso('No pude leer tus órdenes: ' + error.message); return; }
  if (!(data || []).length) { _ordSync.ts = Date.now(); _ordSync.err = null; aviso('No hay órdenes activas que consultar'); return; }
  aviso('Consultando E*TRADE…');
  _ordSync.enCurso = true;
  try {
    const accountIdKey = await etCuentaKey(cr);
    const mmdd = (ymd) => ymd.slice(5, 7) + ymd.slice(8, 10) + ymd.slice(0, 4);
    // rango: desde la enviada más antigua (−1 día), con tope de 30 días
    const masVieja = data.map(o => o.creado_at).sort()[0];
    const desdeMs = Math.max(Date.now() - 30 * 86400000, new Date(masVieja).getTime() - 86400000);
    const hoy = hoyNY(), desde = ymdNY(new Date(desdeMs).toISOString());
    const rango = { fromDate: mmdd(desde), toDate: mmdd(hoy), count: 100 };
    const lista = (r) => { const d = r.data || {}, O = d.OrdersResponse || d; const a = O.Order || []; return Array.isArray(a) ? a : (a ? [a] : []); };
    const remotas = {};
    const pedir = async (estados, conRango) => {
      const rs = await Promise.all(estados.map(s => etPost(cr, '/etrade/ordenes',
        { accountIdKey, query: conRango ? { status: s, ...rango } : { status: s, count: 100 } })));
      for (const r of rs) {
        const em = mensajeError(r);
        if (r.status === 401) throw new Error(texto401Ordenes(em));
        if (r.status >= 400 || em) throw new Error(em || 'HTTP ' + r.status);
        for (const x of lista(r)) if (x && x.orderId != null) remotas[String(x.orderId)] = x;
      }
    };
    await pedir(ORD_ESTADOS_VIVOS, false);                                         // fase 1: lo que sigue vivo
    if (data.some(l => !remotas[String(l.orden_id_ext)])) await pedir(ORD_ESTADOS_FINALES, true);   // fase 2: solo si alguna desapareció
    let cambios = 0;
    for (const loc of data) {
      const rem = remotas[String(loc.orden_id_ext)]; if (!rem) continue;
      const det = (Array.isArray(rem.OrderDetail) ? rem.OrderDetail[0] : rem.OrderDetail) || {};
      const st = String(det.status || '').toUpperCase();
      const nuevo = estadoLocalDe(st);
      if (!nuevo) {
        // sigue activa (OPEN / CANCEL_REQUESTED / PARTIAL): se guarda el detalle solo si
        // cambió, para que la tarjeta diga ACTIVA / CANCELANDO / PARCIAL
        const prev = ((((loc.respuesta || {})._etrade || {}).OrderDetail) || [])[0] || {};
        if (String(prev.status || '').toUpperCase() !== st) {
          const resp = Object.assign({}, loc.respuesta || {}, { _etrade: recortarJson(rem, 3000) });
          const { error: e3 } = await sb.from('ordenes').update({ respuesta: resp, actualizado_at: new Date().toISOString() }).eq('id', loc.id);
          if (!e3) cambios++;
        }
        continue;
      }
      const upd = { estado: nuevo, respuesta: recortarJson(rem, 4096), actualizado_at: new Date().toISOString() };
      if (nuevo === 'ejecutada') {
        // varios fills: cantidad = suma; precio = promedio ponderado
        const insts = Array.isArray(det.Instrument) ? det.Instrument : (det.Instrument ? [det.Instrument] : []);
        let qty = 0, costo = 0;
        for (const i of insts) { const q = Number(i.filledQuantity) || 0, p = Number(i.averageExecutionPrice); if (q > 0 && Number.isFinite(p)) { qty += q; costo += q * p; } }
        let fill = qty > 0 ? Math.round(costo / qty * 10000) / 10000 : Number((insts[0] || {}).averageExecutionPrice);
        if (!(qty > 0)) qty = Number(loc.cantidad) || 1;
        const ejecutadaAt = det.executedTime ? new Date(Number(det.executedTime)).toISOString() : new Date().toISOString();
        const esVenta = /^SELL/.test(String(loc.accion || ''));
        if (!esVenta && loc.proposito === 'entrada' && !loc.posicion_id && fill > 0 && loc.security_type === 'OPTN' && loc.direccion) {
          const mz = (loc.preview && loc.preview._mz) || {};
          const sem = ['ok', 'aviso', 'alto'].includes(mz.semaforo) ? mz.semaforo
            : (loc.overrides || []).some(t => /FUERA del rango/.test(String(t))) ? 'alto' : null;
          const p = { user_id: uid, symbol: loc.symbol, direccion: loc.direccion, strike: loc.strike, expiracion: loc.expiracion,
            contratos: qty, prima_fill: fill, plan_pct: PLAN_PCT, broker: 'etrade', senal_id: loc.senal_id || null,
            abierta_at: ejecutadaAt, abierta_fecha_ny: ymdNY(ejecutadaAt) || hoyNY(),
            entrada_semaforo: sem, fuera_de_rango: sem === 'alto' };
          const pi = await sb.from('posiciones').insert(p).select('id').single();
          if (!pi.error && pi.data) upd.posicion_id = pi.data.id;
        } else if (esVenta && loc.posicion_id && Number.isFinite(fill)) {
          const { data: pos } = await sb.from('posiciones').select('*').eq('id', loc.posicion_id).maybeSingle();
          if (pos && pos.estado === 'abierta') {
            const tot = Number(pos.contratos) || 1, vend = Math.min(qty, tot);
            const res = Math.round((fill - Number(pos.prima_fill)) * vend * 100 * 100) / 100;
            if (vend >= tot) {
              await sb.from('posiciones').update({ estado: fill > 0 ? 'cerrada' : 'expirada', prima_salida: fill,
                resultado_usd: res, cerrada_at: ejecutadaAt }).eq('id', loc.posicion_id);
            } else {
              // cierre PARCIAL: el tramo vendido se anota cerrado (fila propia) y
              // la posición sigue abierta con el resto (posiciones como filas-tramo)
              const { id: _i, gtc_limite: _g, mark: _m, mark_at: _ma, mfe: _f, mae: _e, ...base } = pos;
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
    _ordSync.ts = Date.now(); _ordSync.err = null;
    if (cambios) { toast(`${cambios} orden${cambios > 1 ? 'es' : ''} actualizada${cambios > 1 ? 's' : ''} desde E*TRADE`); ruta(); }
    else { aviso('Sin cambios en E*TRADE'); if (!silencioso) ruta(); }
  } catch (e) {
    _ordSync.ts = Date.now(); _ordSync.err = String((e && e.message) || e);
    aviso('No pude actualizar: ' + _ordSync.err);
  }
  _ordSync.enCurso = false;
}
window.MZ = Object.assign(window.MZ || {}, {
  abrirOrden, cerrarOrden, ordenPreview, ordenPlace, ordenEditar, cancelarOrden, ordenesActualizar,
  cadenaElegir, cadenaRefrescar: () => { if (_ord) _ord.cadenaGen++; cargarCadena(true); },
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
function unirOperaciones(posic, trades) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const grupos = {};
  for (const t of trades || []) {
    const dia = ymdNY(t.abierta_at);
    const k = [t.symbol, t.direccion, num(t.strike), t.expiracion || '', dia].join('|');
    const g = grupos[k] || (grupos[k] = {
      symbol: t.symbol, direccion: t.direccion, strike: num(t.strike), expiracion: t.expiracion || null,
      abierta_fecha_ny: dia, abierta_at: t.abierta_at || null, cerrada_at: t.cerrada_at || null,
      contratos: 0, _costo: 0, resultado_usd: 0, estado: 'cerrada', broker: t.broker,
      _fuente: t.broker, fuera_de_rango: false, entrada_semaforo: null, _partes: 0,
    });
    const c = num(t.contratos) || 0;
    g.contratos += c; g._costo += (num(t.prima_fill) || 0) * c; g.resultado_usd += num(t.resultado_usd) || 0;
    if (t.abierta_at && (!g.abierta_at || t.abierta_at < g.abierta_at)) g.abierta_at = t.abierta_at;
    if (t.cerrada_at && (!g.cerrada_at || t.cerrada_at > g.cerrada_at)) g.cerrada_at = t.cerrada_at;
    g._partes++;
  }
  const delBroker = Object.values(grupos).map(g => ({ ...g,
    prima_fill: g.contratos ? Math.round(g._costo / g.contratos * 10000) / 10000 : null,
    resultado_usd: r2(g.resultado_usd) }));
  const usados = new Set(); let fusionadas = 0; const manual = [];
  for (const p of posic || []) {
    const dia = p.abierta_fecha_ny || ymdNY(p.abierta_at);
    const i = delBroker.findIndex((g, j) => !usados.has(j) && g.symbol === p.symbol && g.direccion === p.direccion
      && g.abierta_fecha_ny === dia && (p.strike == null || num(p.strike) === g.strike)
      && (!p.expiracion || p.expiracion === g.expiracion));
    if (i >= 0) {
      usados.add(i); fusionadas++;
      const g = delBroker[i];
      g.fuera_de_rango = !!p.fuera_de_rango; g.entrada_semaforo = p.entrada_semaforo || null; g._manual_id = p.id;
      continue;
    }
    manual.push({ ...p, abierta_fecha_ny: dia, _fuente: 'manual' });
  }
  const ops = [...manual, ...delBroker].sort((a, b) => (a.abierta_at || '').localeCompare(b.abierta_at || ''));
  const cuenta = (b) => (trades || []).filter(t => t.broker === b).length;
  return { ops, fusionadas, fuentes: { manual: (posic || []).length, etrade: cuenta('etrade'), tasty: cuenta('tasty'), schwab: cuenta('schwab') } };
}

const TAMANO_PCT = 10;   // doctrina: máximo 10% de la cuenta por operación
async function vistaDisciplina() {
  const [posR, btR, csR] = await Promise.all([
    sb.from('posiciones').select('*'),
    sb.from('broker_trades').select('*'),
    sb.from('cuenta_snapshots').select('broker,saldo_neto,capturado_at'),
  ]);
  const { ops, fusionadas, fuentes } = unirOperaciones(posR.data || [], btR.data || []);
  const snaps = csR.data || [];
  const saldo = snaps.reduce((s, c) => s + (Number(c.saldo_neto) || 0), 0);
  const haySaldo = snaps.length > 0 && saldo > 0;
  const tope = haySaldo ? saldo * TAMANO_PCT / 100 : null;
  const inicioMes = inicioPeriodo('mes');
  const lun = lunesNY();
  const esCerrada = (p) => p.estado === 'cerrada' || p.estado === 'expirada';
  const delMes = ops.filter(p => (p.abierta_fecha_ny || '') >= inicioMes);
  const semana = ops.filter(p => (p.abierta_fecha_ny || '') >= lun);   // ya viene en orden de apertura
  // Lo ganado de la semana se mide por fecha de CIERRE (igual que Cuentas); el
  // cupo 3/semana sí va por fecha de ENTRADA.
  const cerradasSem = ops.filter(p => esCerrada(p) && (ymdNY(p.cerrada_at) || '') >= lun);
  const costoEntrada = (p) => (Number(p.prima_fill) || 0) * (Number(p.contratos) || 0) * 100;

  // cupo de la semana (conjunto deduplicado; el excedente = más allá de la 3ª)
  const usadas = semana.length;
  const colCupo = usadas > OPS_SEMANA ? 'var(--rojo)' : usadas === OPS_SEMANA ? 'var(--oro)' : 'var(--verde)';
  const extraSem = semana.slice(OPS_SEMANA);

  // excedente a retirar (resultado cerrado positivo de la semana, bróker incluido)
  const resSem = cerradasSem.reduce((s, p) => s + (Number(p.resultado_usd) || 0), 0);
  const excedente = Math.max(0, resSem);

  // reglas rotas del mes
  const rotas = [];
  const etiqueta = (p) => `${p.symbol} ${p.direccion}${p.strike ? ' ' + p.strike : ''} · ${fmtFechaNY(p.abierta_at)} · ${p._fuente === 'manual' ? 'manual' : p._fuente}`;
  // (1) entrar FUERA del rango (veredicto que solo existe en el registro manual)
  for (const p of delMes.filter(p => p.fuera_de_rango)) {
    const r = esCerrada(p) ? Number(p.resultado_usd) : NaN;
    rotas.push({ regla: 'Entró FUERA del rango óptimo', det: etiqueta(p),
      costo: (Number.isFinite(r) && r < 0) ? r : 0, gano: Number.isFinite(r) && r > 0 });
  }
  // (2) 4ª+ operación de una semana (cupo excedido) — agrupar por semana (lunes NY)
  const porSemana = {};
  for (const p of delMes) {
    const d = new Date((p.abierta_fecha_ny || '') + 'T12:00:00Z');
    if (isNaN(d)) continue;
    const wk = new Date(d); wk.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = wk.toISOString().slice(0, 10);
    (porSemana[key] = porSemana[key] || []).push(p);
  }
  for (const [wk, lista] of Object.entries(porSemana)) {
    if (lista.length > OPS_SEMANA) {
      const extra = lista.slice(OPS_SEMANA);   // las que sobraron (ya en orden de apertura)
      const costo = extra.reduce((s, p) => s + Math.min(0, esCerrada(p) ? (Number(p.resultado_usd) || 0) : 0), 0);
      rotas.push({ regla: `${lista.length} operaciones esa semana (plan: ${OPS_SEMANA})`,
        det: `semana del ${fmtFechaNY(wk + 'T12:00:00Z')} · sobraron: ${extra.map(p => p.symbol + ' ' + p.direccion).join(', ')}`,
        costo, gano: false });
    }
  }
  // (3) tamaño > 10% del saldo (costo de entrada = prima × contratos × 100)
  if (tope != null) {
    for (const p of delMes.filter(p => costoEntrada(p) > tope)) {
      const r = esCerrada(p) ? Number(p.resultado_usd) : NaN;
      rotas.push({ regla: `Tamaño ${usd(costoEntrada(p))}: más del ${TAMANO_PCT}% de la cuenta (${usd(tope)})`,
        det: etiqueta(p), costo: (Number.isFinite(r) && r < 0) ? r : 0, gano: Number.isFinite(r) && r > 0 });
    }
  }
  const costoTotal = rotas.reduce((s, r) => s + (r.costo || 0), 0);

  let h = '';
  // cumplimiento del plan (semana)
  const costoExtraSem = extraSem.reduce((s, p) => s + Math.min(0, esCerrada(p) ? (Number(p.resultado_usd) || 0) : 0), 0);
  h += `<div class="card">
    <div class="fila"><h3>Plan de la semana</h3>
      <span style="font-weight:800;font-size:20px;color:${colCupo}">${usadas} / ${OPS_SEMANA}</span></div>
    <div class="mut" style="margin-top:3px">3 operaciones por semana · ${TAMANO_PCT}% de la cuenta por operación · solo tus 4 tickers. El plan manda.</div>
    ${extraSem.length ? `<div class="mut" style="margin-top:6px;color:var(--rojo)">Excedente: ${extraSem.length} op${extraSem.length > 1 ? 's' : ''} más allá de la 3ª (${esc(extraSem.map(p => p.symbol + ' ' + p.direccion).join(', '))})${costoExtraSem < 0 ? ' · te costaron ' + usd(costoExtraSem) : ''}</div>` : ''}
    ${haySaldo ? `<div class="fresco" style="margin-top:6px">saldo ${usd(saldo)} · tope por operación ${usd(tope)} (según el saldo actual)</div>`
      : `<div class="fresco" style="margin-top:6px">sin saldo de cuenta todavía (cuenta_snapshots): la regla del ${TAMANO_PCT}% no se evalúa</div>`}</div>`;

  // excedente a retirar
  if (excedente > 0) {
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
