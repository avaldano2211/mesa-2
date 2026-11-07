#!/usr/bin/env node
/* Pruebas de la v70 · «Cuentas en segundos»: Realtime de broker_trades. Hecho (Andrés, 6-nov-2026): «la mesa no me está
   actualizando y dando la información correcta del día de hoy» — la pestaña Cuentas (vistaCuentasSaldos cuenta las idas y
   vueltas de broker_trades vía unirOperaciones) solo se repintaba con el respaldo de 60 s (ruta) y con el Realtime de fills,
   mientras el worker rehace broker_trades a los 5 s de cada ejecución de moomoo (0.1.12b). Ahora suscribir() abre UN canal
   propio 'mesa2-trades' con INSERT y UPDATE de broker_trades (nunca '*' ni DELETE: los DELETE no pasan por RLS) y cada
   evento (tradeBrokerCambio) invalida la caché de operaciones del Informe (opsInforme) y repinta Cuentas o el Diario EN
   SITIO por el mismo camino que un fill de Realtime (libroRepintarPronto: debounce de 1,5 s; sin cuadro abierto ni campo en
   uso). El timer de 60 s sigue de respaldo. Funciones REALES del fuente (casa_pruebas.js) y el módulo ENTERO en un DOM de
   juguete con sbFalso y un sb.channel de juguete (el patrón de test_liquidez.js). No toca la red ni Supabase.
   Uso: node test_cuentas_rt.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_cuentas_rt.js');
const { assert, igual, extraer, nodo, respirar } = C;

// El módulo ENTERO con un supabase de juguete que anota las consultas (sbFalso) y los canales de Realtime que se abren.
function armar(op) {
  op = op || {};
  const canales = [];
  const canal = (nombre) => { const c = { nombre, regs: [], on(_e, cfg, cb) { c.regs.push({ event: cfg && cfg.event, table: cfg && cfg.table, cb }); return c; }, subscribe() { c.suscrito = true; return c; } }; canales.push(c); return c; };
  const sb = C.sbFalso((tabla) => (tabla === 'broker_trades' ? { data: op.bt || [], error: null } : { data: [], error: null }));
  const mod = C.cargarModuloEntero({ src: './app/main.js?v=70', hash: op.hash || '#/cuentas',
    supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
  return { mod, sb, canales, de: (t) => sb.llamadas.filter(l => l.tabla === t) };
}
// Una fila de broker_trades como la manda Realtime (una ida y vuelta de moomoo). Datos de juguete.
const fila = (extra) => Object.assign({ id: 1, user_id: 'u', broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 430, expiracion: '2026-11-07', contratos: 1,
  prima_fill: 2.1, prima_salida: 2.4, abierta_at: '2026-11-06T15:00:00+00:00', cerrada_at: '2026-11-06T15:20:00+00:00', resultado_usd: 30, fees: 0, clave_ext: 'm1' }, extra || {});

(async () => {
  // ════════════════ 1. el cableado en el fuente ════════════════
  {
    const sus = extraer('suscribir');
    assert(/^\s*if \(canal\) return;/m.test(sus), 'suscribir() sale si ya hay canal: un re-render no abre ningún canal dos veces');
    assert(/sb\.channel\('mesa2-trades'\)\s*\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: 'broker_trades' \}, tradeBrokerCambio\)\s*\.on\('postgres_changes', \{ event: 'UPDATE', schema: 'public', table: 'broker_trades' \}, tradeBrokerCambio\)\s*\.subscribe\(\);/.test(sus),
      'suscribir: UN canal propio «mesa2-trades» con INSERT y UPDATE de broker_trades → tradeBrokerCambio');
    igual((sus.match(/table: 'broker_trades'/g) || []).length, 2, 'broker_trades aparece dos veces (INSERT y UPDATE) y en ningún otro canal');
    assert(!/event: '(\*|DELETE)'[^\n]*table: 'broker_trades'/.test(sus), 'nunca «*» ni DELETE sobre broker_trades (los DELETE no pasan por RLS)');
    assert(/timer = setInterval\(ruta, 60000\);/.test(extraer('arrancar')), 'el respaldo de 60 s (ruta cada minuto) sigue');
    const tb = extraer('tradeBrokerCambio');
    assert(/libroRepintarPronto\(\);/.test(tb) && /informeOpsInvalidar\(\)/.test(tb), 'tradeBrokerCambio reutiliza libroRepintarPronto (el debounce y las guardas de los fills) e invalida la caché de operaciones del Informe');
    assert(!/vistaCuentas\(|vistaDiario\(|innerHTML|setTimeout/.test(tb), 'y no repinta por su cuenta ni toca el DOM ni lleva otro timer: nada duplicado');
    assert(/sb\.from\('broker_trades'\)\.select\('\*'\)/.test(extraer('vistaCuentasSaldos')), 'Cuentas vuelve a leer broker_trades en cada pintado (no guarda una caché que haya que invalidar)');
    assert(!/\.(insert|update|upsert|delete)\(/.test(tb + extraer('libroRepintarPronto') + extraer('repintarVistaLibro')), 'nada de este camino escribe en la base');
  }

  // ════════════════ 2. el módulo ENTERO: un canal, los dos eventos, un solo repintado en sitio ════════════════
  {
    const A = armar();
    assert(A.mod.cargo, 'main.js entero carga en el DOM de juguete', A.mod.error);
    if (A.mod.cargo) {
      await respirar();   // que pase el arrancar(null) de getSession (sin sesión) antes de poner la de la prueba
      A.mod.ev('suscribir()');
      const ct = A.canales.filter(c => c.nombre === 'mesa2-trades');
      igual(ct.length, 1, 'suscribir() abre UN canal «mesa2-trades»');
      const c = ct[0];
      assert(c && c.suscrito, 'y queda suscrito');
      igual(c.regs.map(r => r.event + ':' + r.table), ['INSERT:broker_trades', 'UPDATE:broker_trades'], 'con INSERT:broker_trades y UPDATE:broker_trades (y nada más)');
      igual(c.regs.map(r => r.cb && r.cb.name), ['tradeBrokerCambio', 'tradeBrokerCambio'], 'los dos eventos van al mismo manejador');
      igual(A.canales.filter(x => x.nombre !== 'mesa2-trades').flatMap(x => x.regs).filter(r => r.table === 'broker_trades').length, 0, 'broker_trades no va en ningún otro canal (si faltara en la publicación solo caería el suyo)');
      igual(A.canales.flatMap(x => x.regs).filter(r => r.event === '*' || r.event === 'DELETE').map(r => r.table), ['senales', 'ticker_estado', 'worker_heartbeat'], 'solo las tablas de MERCADO van con «*»; ninguna personal con «*» ni DELETE');
      assert(A.canales.some(x => x.nombre === 'mesa2-fills' && x.suscrito) && A.canales.some(x => x.nombre === 'mesa2' && x.suscrito), 'los canales de siempre siguen');
      const n0 = A.canales.length;
      A.mod.ev('suscribir()');
      igual(A.canales.length, n0, 'un segundo suscribir() (re-render, arrancar de nuevo) no abre ningún canal más');

      // un evento → programa el repintado de Cuentas con el debounce del libro e invalida la caché del Informe
      const timers = []; let limpiados = 0;
      A.mod.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      A.mod.win.clearTimeout = () => { limpiados++; };
      const sinCuadro = (s) => (s === '.modal' ? null : s === '#vista' ? { contains: () => false } : nodo());
      A.mod.win.document.querySelector = sinCuadro;
      A.mod.ev("sesionActiva = { user: { id: 'u' } }; _cuentasVista = 'cuentas'; window.__rep = []; vistaCuentas = async () => { window.__rep.push('cuentas'); }; vistaDiario = async () => { window.__rep.push('diario'); };");
      A.mod.ev("_inf.ops = { uid: 'u', ts: Date.now(), r: { ops: [], error: null } };");
      igual(c.regs[0].cb({ eventType: 'INSERT', new: fila() }), true, 'un INSERT de broker_trades del usuario se atiende');
      igual([timers.length, timers[0] && timers[0].ms, A.mod.ev('_inf.ops'), A.mod.ev('window.__rep').length], [1, 1500, null, 0], 'programa UN repintado con el debounce del libro (1,5 s), invalida la caché de operaciones del Informe («Tu plan hoy») y aún no pinta');
      igual(c.regs[1].cb({ eventType: 'UPDATE', new: fila({ resultado_usd: 31 }) }), true, 'un UPDATE también');
      igual([timers.length, limpiados], [2, 1], 'el segundo evento dentro del debounce cancela el timer anterior y pone otro (una sincronización escribe decenas de filas: un solo repintado)');
      timers[timers.length - 1].fn(); await respirar();
      igual(A.mod.ev('window.__rep'), ['cuentas'], 'al vencer el debounce repinta la vista Cuentas en sitio (vistaCuentas: conserva el scroll de la tabla y las filas de «ver más»), una sola vez');
      igual(A.canales.length, n0, 'y no vuelve a abrir ningún canal');
      // con el Diario a la vista se repinta el Diario (también lee broker_trades: «¿coincide con Cuentas?»)
      A.mod.ev("_cuentasVista = 'diario'; window.__rep = [];");
      c.regs[0].cb({ eventType: 'INSERT', new: fila({ id: 2 }) }); timers[timers.length - 1].fn(); await respirar();
      igual(A.mod.ev('window.__rep'), ['diario'], 'con el Diario a la vista, se repinta el Diario');
      // en otra pestaña nada que repintar (el Informe y el Copiloto releen de la base en su próximo pintado)
      A.mod.ev("location.hash = '#/copiloto'; window.__rep = [];");
      c.regs[0].cb({ eventType: 'INSERT', new: fila({ id: 3 }) }); timers[timers.length - 1].fn(); await respirar();
      igual(A.mod.ev('window.__rep'), [], 'en otra pestaña no se repinta nada');
      // con un cuadro abierto (orden, PIN, fill a mano) tampoco: lo recoge el repintado de 60 s
      A.mod.ev("location.hash = '#/cuentas'; _cuentasVista = 'cuentas'; window.__rep = [];");
      A.mod.win.document.querySelector = (s) => (s === '.modal' ? nodo() : s === '#vista' ? { contains: () => false } : nodo());
      c.regs[0].cb({ eventType: 'INSERT', new: fila({ id: 4 }) }); timers[timers.length - 1].fn(); await respirar();
      igual(A.mod.ev('window.__rep'), [], 'con un cuadro abierto no se repinta debajo (lo recoge el respaldo de 60 s)');
      A.mod.win.document.querySelector = sinCuadro;

      // payload vacío o incompleto: no lanza, no repinta, no toca nada
      const antes = timers.length;
      let revento = null, r = null;
      try { r = [c.regs[0].cb(undefined), c.regs[0].cb(null), c.regs[0].cb({}), c.regs[1].cb({ eventType: 'UPDATE' }), c.regs[1].cb({ new: null }), c.regs[0].cb({ new: 'x' }), c.regs[0].cb({ old: fila() })]; }
      catch (e) { revento = String((e && e.message) || e); }
      igual([revento, r, timers.length], [null, [false, false, false, false, false, false, false], antes], 'un evento con payload vacío o incompleto (sin new, new que no es objeto, solo old) no lanza, no repinta y no toca nada');
      igual(c.regs[0].cb({ eventType: 'INSERT', new: fila({ user_id: 'otro' }) }), false, 'una fila de OTRO usuario (la RLS ya lo impide; aquí, por si acaso) se ignora');
      igual([c.regs[1].cb({ eventType: 'UPDATE', new: { id: 1, resultado_usd: 32 } }), timers.length], [true, antes + 1], 'un UPDATE parcial sin user_id vale (la RLS garantiza que es nuestro) y programa el repintado');
      A.mod.ev('sesionActiva = null');
      igual([c.regs[0].cb({ eventType: 'INSERT', new: fila() }), timers.length], [false, antes + 1], 'sin sesión, nada');
    }
  }

  // ════════════════ 3. el repintado REAL: vistaCuentas → vistaCuentasSaldos vuelve a pedir broker_trades ════════════════
  {
    const B = armar();
    assert(B.mod.cargo, 'main.js entero carga de nuevo en el DOM de juguete', B.mod.error);
    if (B.mod.cargo) {
      await respirar();
      B.mod.ev('suscribir()');
      const c = B.canales.find(x => x.nombre === 'mesa2-trades');
      const timers = [];
      B.mod.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      B.mod.win.clearTimeout = () => {};
      B.mod.win.innerWidth = 1400;
      B.mod.win.document.querySelector = (s) => (s === '.modal' ? null : nodo());
      B.mod.ev("sesionActiva = { user: { id: 'u' } }; location.hash = '#/cuentas'; _cuentasVista = 'cuentas';");
      const n0 = B.de('broker_trades').length;
      igual(c.regs[0].cb({ eventType: 'INSERT', new: fila({ id: 9 }) }), true, 'llega una ida y vuelta nueva');
      timers[timers.length - 1].fn();
      for (let i = 0; i < 25; i++) await respirar();
      igual(B.de('broker_trades').length, n0 + 1, 'el repintado real (vistaCuentas → vistaCuentasSaldos) vuelve a pedir broker_trades a la base: lo que se pinta es lo de ahora');
      assert(!B.sb.llamadas.some(l => l.cadena.some(x => ['insert', 'update', 'upsert', 'delete'].includes(x[0]))), 'y todo este camino solo LEE');
    }
  }
  C.resumen();
})();
