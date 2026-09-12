/* Mesa 2.0 — app (PWA). Lee en vivo de Supabase; la muralla es RLS + whitelist.
   Doctrina heredada: JAMÁS presentar un dato viejo como fresco — cada dato
   lleva su antigüedad, y el badge distingue «mercado cerrado» de «worker caído». */
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.MESA2;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

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
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(), password: $('#pass').value });
  if (error) $('#loginErr').textContent = 'No pude entrar: ' + error.message;
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
  return `<div class="card">
    <div class="fila"><h3>${esc(sym)}</h3>
      <span class="fresco">${esc(fr.txt)}</span></div>
    <div class="tend" style="margin-top:6px">
      ${tg('15m', te.m15)} ${tg('hora', te.hora)} ${tg('día', te.dia)}
      ${p.volatilidad ? `<span class="tg">vol <b>${esc(p.volatilidad)}</b></span>` : ''}</div>
    ${av.length ? `<div class="mut" style="margin-top:7px">${av.map(esc).join(' · ')}</div>` : ''}
  </div>`;
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

function vistaProx(tab) {
  const txt = {
    copiloto: 'El Copiloto llega en la próxima entrega: ticket verificado, registro de tu fill en 10 s y aviso de refuerzo.',
    cuentas: 'Cuentas y diario llega pronto: tus 4 brókeres consolidados y el diario con reconciliación.',
    disciplina: 'Disciplina llega pronto: plan 3 ops/semana, reglas rotas con su costo y excedente a retirar.',
  }[tab] || 'Próximamente.';
  $('#vista').innerHTML = `<div class="prox">${esc(txt)}</div>`;
}

// registrar el service worker (shell-only)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
