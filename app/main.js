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
  } else if (timer) { clearInterval(timer); }
}
window.addEventListener('hashchange', ruta);

// Realtime: la campanada (senales), el estado y el pulso llegan al instante.
function suscribir() {
  if (canal) return;
  canal = sb.channel('mesa2')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'senales' }, ruta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticker_estado' }, ruta)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_heartbeat' }, ruta)
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
  const [estados, senales] = await Promise.all([
    sb.from('ticker_estado').select('*'),
    sb.from('senales').select('*').order('creado_at', { ascending: false }).limit(8),
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
  const [sen, pos] = await Promise.all([
    sb.from('senales').select('*').eq('fecha_ny', hoy).order('creado_at', { ascending: false }),
    sb.from('posiciones').select('*').order('abierta_at', { ascending: false }),
  ]);
  const senales = sen.data || [];
  const posic = pos.data || [];
  const abiertas = posic.filter(p => p.estado === 'abierta');
  const semana = posic.filter(p => p.abierta_fecha_ny >= lunesNY());
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

  // registrar a mano (útil siempre)
  h += `<button class="pri" style="width:100%" onclick="MZ.abrirFill()">+ Registrar una operación</button>`;

  // posiciones abiertas
  h += `<div class="sec">POSICIONES ABIERTAS</div>`;
  if (abiertas.length) {
    h += abiertas.map(tarjetaPosicion).join('');
  } else {
    h += `<div class="card vacio">Sin posiciones abiertas.</div>`;
  }
  $('#vista').innerHTML = h;
}

function tarjetaSenal(s, posic) {
  const yaReg = posic.some(p => p.senal_id === s.id);
  return `<div class="card" style="border-color:rgba(231,181,77,.45)">
    <div class="fila"><span style="font-weight:700;font-size:13.5px">${esc(s.titulo)}</span>
      <span class="fresco">${esc(haceCuanto(s.creado_at).txt)}</span></div>
    <div class="mut" style="margin-top:5px">${esc(s.motivo || '')}</div>
    ${s.instruccion_gtc ? `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(s.instruccion_gtc)}</div>` : ''}
    ${yaReg ? `<div class="mut" style="margin-top:8px;color:var(--verde)">✓ ya registraste tu fill</div>`
      : `<button class="pri" style="width:100%;margin-top:9px" onclick='MZ.abrirFill(${JSON.stringify({
          senal_id: s.id, symbol: s.symbol, direccion: s.direccion }).replace(/'/g, "&#39;")})'>Registrar mi fill</button>`}
  </div>`;
}

function tarjetaPosicion(p) {
  const pnl = p.prima_salida != null
    ? ((p.prima_salida - p.prima_fill) / p.prima_fill * 100) : null;
  return `<div class="card">
    <div class="fila"><h3>${esc(p.symbol)} ${esc(p.direccion)}${p.strike ? ' ' + esc(p.strike) : ''}</h3>
      <span class="fresco">×${esc(p.contratos)} · ${esc(p.broker || '—')}</span></div>
    <div class="fila" style="margin-top:6px">
      <span class="mut">fill <b class="mono" style="color:var(--tx)">$${esc(p.prima_fill)}</b></span>
      <span class="mut">límite GTC <b class="mono" style="color:var(--oro)">$${esc(p.gtc_limite)}</b></span></div>
    <div class="fila" style="margin-top:9px;gap:8px">
      <button class="btnsec" onclick="MZ.copiar('${esc(p.gtc_limite)}')">Copiar GTC</button>
      <button class="btnsec" onclick="MZ.cerrar(${p.id}, ${p.prima_fill})">Registrar salida</button></div>
  </div>`;
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
      <div><label>Strike</label><input id="fStrike" type="number" inputmode="decimal" placeholder="opcional"></div>
      <div><label>Expira</label><input id="fExp" type="date"></div></div>
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
  const { data: { user } } = await sb.auth.getUser();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const sem = ($('#fRango') || {}).dataset ? $('#fRango').dataset.n : '';  // veredicto del rango
  const fila = {
    user_id: user.id, symbol: g('fSym'), direccion: g('fDir'),
    strike: g('fStrike') ? parseFloat(g('fStrike')) : null,
    expiracion: g('fExp') || null, contratos: qty, prima_fill: prima,
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
    <button class="btnsec" style="width:100%;margin-top:12px" onclick="MZ.salir()">Salir de la Mesa</button>
  </div>`;
  document.body.appendChild(m);
  diagSesion().then(t => { const d = $('#cpDiag'); if (d) d.textContent = t; });
  setTimeout(() => { const i = $('#cpActual'); if (i) i.focus(); }, 60);
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
window.MZ = Object.assign(window.MZ, { abrirCuenta, cerrarCuenta, cambiarPass, salir });

// ---------- Cuentas y diario (historial + resúmenes) ----------
let _periodoSel = 'semana';   // semana | mes | ytd

function inicioPeriodo(clave) {
  // fecha YYYY-MM-DD (NY) de inicio del período
  const ymdNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  if (clave === 'semana') return lunesNY();
  if (clave === 'mes') return ymdNY.slice(0, 8) + '01';
  return ymdNY.slice(0, 4) + '-01-01';   // ytd
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
const ET_K = { tok: 'mz_et_tok', sec: 'mz_et_sec', cache: 'mz_et_cache', sync: 'mz_et_sync' };
const num2 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
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
async function etProxy(path, body) {
  if (!PROXY_URL) throw new Error('proxy sin configurar');
  const r = await fetch(PROXY_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// Lectura E*TRADE con auto-renovación: si el token quedó INACTIVO (>2 h sin
// uso) E*TRADE responde 401; renew_access_token lo reactiva sin login. Muere
// de verdad a medianoche ET (ahí sí toca reconectar).
async function etRead(cr, path, query) {
  let r = await etProxy('/etrade/read', { ...cr, path, query: query || {} });
  if (r.status === 401) {
    try { await etProxy('/etrade/renew', { token: cr.token, token_secret: cr.token_secret }); } catch (_) {}
    r = await etProxy('/etrade/read', { ...cr, path, query: query || {} });
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
    return null;  // proxy inalcanzable (¿Funnel apagado?) → se ofrece Conectar
  }
}

async function conectarEtrade() {
  if (!PROXY_URL) { toast('Falta configurar el proxy'); return; }
  toast('Preparando login de E*TRADE…');
  let r;
  try { r = await etProxy('/etrade/login/start', {}); }
  catch (_) { toast('No pude contactar el proxy (¿Funnel activo?)'); return; }
  const d = r.data || {};
  if (!d.authorize_url) { toast('E*TRADE no respondió: ' + (d.error || 'error')); return; }
  window.open(d.authorize_url, '_blank', 'noopener');
  modalPin(d.rt);
}
function modalPin(rt) {
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modalPin';
  m.innerHTML = `<div class="hoja">
    <h3 style="margin:0 0 6px">Conectar E*TRADE</h3>
    <div class="mut" style="font-size:12.5px;line-height:1.45">Se abrió E*TRADE en otra pestaña. Inicia sesión, <b>autoriza el acceso</b> y copia el <b>código de verificación</b> que te muestra. Pégalo aquí:</div>
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
  const m = $('#modalPin'); if (m) m.remove();
  try { localStorage.removeItem(ET_K.sync); } catch (_) {}   // fuerza sincronizar historial
  toast('E*TRADE conectada ✓');
  vistaCuentas();
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
        clave_ext: `${contrato}|${ap.ts}|${ts}|${usa}`,
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
async function etradeSincronizar(forzar) {
  const cr = etCreds();
  if (!cr) return { estado: 'sin' };
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
  vistaCuentas();
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
  if (etSnap && !etSnap._expirado) {
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
    etradeSincronizar().then(s => { if (s && (s.cambio || enCurso)) vistaCuentas(); });
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
        ? ` · <a href="#" onclick="MZ.conectar('etrade');return false" style="color:var(--oro)">reconectar</a>` : '';
      const hist = b.k === 'etrade' ? etradeLineaHistorial(etHist) : '';
      return `<div class="card"><div class="fila">
      <div><b style="font-size:14px">${esc(b.n)}</b> <span class="mut">${esc(c.numero_mascara||'')}</span>
        <div class="fresco">${orig} · ${esc(haceCuanto(c.capturado_at).txt)}${reconn}</div>
        ${hist ? `<div class="fresco">${hist}</div>` : ''}</div>
      <span class="mono" style="font-weight:700;font-size:15px">${usd(c.saldo_neto)}</span></div></div>`;
    }
    const sub = b.k === 'tasty' ? 'conectando…'
      : (b.k === 'etrade' && etExpirado) ? 'sesión expirada — vuelve a entrar'
      : b.k === 'etrade' ? 'inicia sesión (login diario, con PIN)'
      : b.k === 'schwab' ? 'en aprobación de Schwab' : 'requiere tu login';
    const btn = b.k === 'tasty' ? ''
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
  pinCancelar: () => { const m = $('#modalPin'); if (m) m.remove(); },
  etSync: () => etSyncAhora(),
});

// ---------- Disciplina ----------
function nombreMesNY() {
  return new Intl.DateTimeFormat('es', { timeZone: 'America/New_York', month: 'long' }).format(new Date());
}
async function vistaDisciplina() {
  const { data } = await sb.from('posiciones').select('*').order('abierta_at', { ascending: false });
  const pos = data || [];
  const inicioMes = inicioPeriodo('mes');
  const lun = lunesNY();
  const cerradas = pos.filter(p => p.estado === 'cerrada' || p.estado === 'expirada');
  const delMes = pos.filter(p => (p.abierta_fecha_ny || '') >= inicioMes);
  const cerradasSem = cerradas.filter(p => (p.abierta_fecha_ny || '') >= lun);

  // cupo de la semana
  const semana = pos.filter(p => (p.abierta_fecha_ny || '') >= lun);
  const usadas = semana.length;
  const colCupo = usadas > OPS_SEMANA ? 'var(--rojo)' : usadas === OPS_SEMANA ? 'var(--oro)' : 'var(--verde)';

  // excedente a retirar (resultado cerrado positivo de la semana)
  const resSem = cerradasSem.reduce((s, p) => s + (Number(p.resultado_usd) || 0), 0);
  const excedente = Math.max(0, resSem);

  // reglas rotas del mes
  const rotas = [];
  // (1) entrar FUERA del rango
  for (const p of delMes.filter(p => p.fuera_de_rango)) {
    const r = Number(p.resultado_usd);
    rotas.push({ regla: 'Entró FUERA del rango óptimo',
      det: `${p.symbol} ${p.direccion} · ${fmtFechaNY(p.abierta_at)}`,
      costo: (r != null && r < 0) ? r : 0, gano: r != null && r > 0 });
  }
  // (2) 4ª+ operación de una semana (cupo excedido) — agrupar por semana ISO
  const porSemana = {};
  for (const p of delMes) {
    const d = new Date((p.abierta_fecha_ny || '') + 'T12:00:00Z');
    const wk = new Date(d); wk.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = wk.toISOString().slice(0, 10);
    (porSemana[key] = porSemana[key] || []).push(p);
  }
  for (const [wk, ops] of Object.entries(porSemana)) {
    if (ops.length > OPS_SEMANA) {
      const extra = ops.slice(OPS_SEMANA); // las que sobraron
      const costo = extra.reduce((s, p) => s + Math.min(0, Number(p.resultado_usd) || 0), 0);
      rotas.push({ regla: `${ops.length} operaciones esa semana (plan: ${OPS_SEMANA})`,
        det: `semana del ${fmtFechaNY(wk + 'T12:00:00Z')}`, costo, gano: false });
    }
  }
  const costoTotal = rotas.reduce((s, r) => s + (r.costo || 0), 0);

  let h = '';
  // cumplimiento del plan (semana)
  h += `<div class="card">
    <div class="fila"><h3>Plan de la semana</h3>
      <span style="font-weight:800;font-size:20px;color:${colCupo}">${usadas} / ${OPS_SEMANA}</span></div>
    <div class="mut" style="margin-top:3px">3 operaciones por semana · 10% de la cuenta por operación · solo tus 4 tickers. El plan manda.</div></div>`;

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
  $('#vista').innerHTML = h;
}

function vistaProx(tab) {
  const txt = {
    cuentas: 'Cuentas y diario llega pronto.',
  }[tab] || 'Próximamente.';
  $('#vista').innerHTML = `<div class="prox">${esc(txt)}</div>`;
}

// registrar el service worker (shell-only)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
