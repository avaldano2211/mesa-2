/* Ayudante común de las suites test_*.js de la Mesa 2.0 (estilo de la casa, el
   mismo de test_posiciones_broker.js): se extraen las funciones REALES del fuente
   con new Function y dependencias falsas — nada se reimplementa en las pruebas,
   porque una prueba que reimplementa la lógica solo se prueba a sí misma.
   Uso: const C = require('./smoke_tmp/casa_pruebas.js')(rutaAMainJs);
   Cada suite recibe la ruta de main.js como argumento y termina con C.resumen(). */
'use strict';
const fs = require('fs');
const vm = require('vm');

module.exports = function casa(RUTA, nombreSuite) {
  if (!RUTA) { console.error('uso: node ' + (nombreSuite || 'test_x.js') + ' <ruta a main.js>'); process.exit(2); }
  const FUENTE = fs.readFileSync(RUTA, 'utf8');

  // ---------- contadores y aserciones ----------
  let verdes = 0, fallos = 0;
  function ok(msg) { verdes++; console.log('ok ' + msg); }
  function falla(msg, extra) { fallos++; console.log('FALLA: ' + msg + (extra ? ' → ' + extra : '')); }
  function assert(cond, msg, extra) { if (cond) ok(msg); else falla(msg, extra); }
  function igual(a, b, msg) {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A === B) ok(msg); else falla(msg, 'esperaba ' + B + ' y llegó ' + A);
  }
  function cerca(a, b, msg, tol) {
    if (Math.abs(Number(a) - Number(b)) <= (tol == null ? 1e-6 : tol)) ok(msg);
    else falla(msg, 'esperaba ~' + b + ' y llegó ' + a);
  }
  // Última línea en el formato de la casa: «N asserts verdes» (o «K FALLA(S) · N asserts verdes»), exit 1 si hay fallos.
  let terminado = false;
  function resumen() {
    terminado = true;
    console.log('');
    console.log(fallos ? `${fallos} FALLA(S) · ${verdes} asserts verdes` : `${verdes} asserts verdes`);
    process.exit(fallos ? 1 : 0);
  }
  // Una promesa colgada (un await que nunca vuelve) vacía el bucle de eventos y node
  // sale con 0 en silencio: eso NO es una suite verde. Sin resumen → FALLA y exit 1.
  process.on('exit', (code) => {
    if (terminado) return;
    console.log('FALLA: la suite terminó sin llegar al resumen (una promesa quedó colgada o hubo una excepción fuera de las pruebas) · ' + verdes + ' asserts verdes antes de morir');
    if (code === 0) process.exitCode = 1;
  });

  // ---------- escáner del fuente ----------
  // Recorre desde `i` con estados (código / cadena / plantilla / comentario / regex)
  // para que ni las llaves de un `${...}`, ni un comentario, ni una comilla dentro de
  // una expresión regular (tarjetaPosicion lleva un /'/g) descoloquen el conteo.
  //   modo 'llaves':    devuelve el índice de la } que deja la pila vacía (cuerpo de función)
  //   modo 'sentencia': devuelve el índice del ; con la pila vacía (una const/let de nivel superior)
  function recorrer(i, modo) {
    // Tras estos caracteres una «/» abre una expresión regular; tras una letra, un
    // número, «)» o «]» es una división.
    const ANTES_REGEX = '(,=:[!&|?{};+-*%<>~^';
    const pila = [];
    let est = 'codigo', cierre = '', ultimo = '', enClase = false;
    for (; i < FUENTE.length; i++) {
      const c = FUENTE[i], d = FUENTE[i + 1];
      if (est === 'cadena') { if (c === '\\') { i++; continue; } if (c === cierre) est = 'codigo'; continue; }
      if (est === 'linea') { if (c === '\n') est = 'codigo'; continue; }
      if (est === 'bloque') { if (c === '*' && d === '/') { i++; est = 'codigo'; } continue; }
      if (est === 'regex') {
        if (c === '\\') { i++; continue; }
        if (c === '[') enClase = true;
        else if (c === ']') enClase = false;
        else if (c === '/' && !enClase) { est = 'codigo'; ultimo = '/'; }
        continue;
      }
      if (est === 'plantilla') {
        if (c === '\\') { i++; continue; }
        if (c === '`') { est = 'codigo'; pila.pop(); ultimo = '`'; continue; }
        if (c === '$' && d === '{') { i++; pila.push('llave'); est = 'codigo'; ultimo = '{'; continue; }
        continue;
      }
      // estado código
      if (c === '/' && d === '/') { est = 'linea'; i++; continue; }
      if (c === '/' && d === '*') { est = 'bloque'; i++; continue; }
      if (c === '/') {
        if (!ultimo || ANTES_REGEX.includes(ultimo)) { est = 'regex'; enClase = false; continue; }
        ultimo = '/'; continue;                       // división
      }
      if (c === '\'' || c === '"') { est = 'cadena'; cierre = c; ultimo = c; continue; }
      if (c === '`') { est = 'plantilla'; pila.push('plantilla'); continue; }
      if (c === '(' || c === '[') { pila.push(c); ultimo = c; continue; }
      if (c === ')' || c === ']') { pila.pop(); ultimo = c; continue; }
      if (c === '{') { pila.push('llave'); ultimo = '{'; continue; }
      if (c === '}') {
        pila.pop(); ultimo = '}';
        if (!pila.length && modo === 'llaves') return i;
        if (pila[pila.length - 1] === 'plantilla') est = 'plantilla';
        continue;
      }
      if (c === ';' && !pila.length && modo === 'sentencia') return i;
      if (!/\s/.test(c)) ultimo = c;
    }
    return -1;
  }
  // Texto exacto de `function nombre(...) {...}` (o `async function`) del fuente.
  function extraer(nombre) {
    const re = new RegExp('^(?:async )?function ' + nombre + '\\s*\\(', 'm');
    const m = re.exec(FUENTE);
    if (!m) throw new Error('no encontré `function ' + nombre + '` en el fuente');
    const i = FUENTE.indexOf('{', m.index);
    if (i < 0) throw new Error('función sin cuerpo: ' + nombre);
    const fin = recorrer(i, 'llaves');
    if (fin < 0) throw new Error('no pude cerrar la función ' + nombre);
    return FUENTE.slice(m.index, fin + 1);
  }
  // Texto exacto de una `const NOMBRE = ...;` o `let NOMBRE = ...;` de nivel superior
  // (al principio de línea). Si la sentencia declara varias (`const A = 1, B = 2;`)
  // el texto las trae todas: las demás se devuelven con `extras` en construir().
  function extraerConst(nombre) {
    const re = new RegExp('^(?:const|let|var) ' + nombre + '\\s*=', 'm');
    const m = re.exec(FUENTE);
    if (!m) throw new Error('no encontré `const/let ' + nombre + ' =` al principio de una línea del fuente');
    const fin = recorrer(m.index + m[0].length, 'sentencia');
    if (fin < 0) throw new Error('no pude cerrar la sentencia de ' + nombre);
    return FUENTE.slice(m.index, fin + 1);
  }
  // ¿Existe `const/let NOMBRE =` de nivel superior en el fuente?
  const existeConst = (nombre) => new RegExp('^(?:const|let|var) ' + nombre + '\\s*=', 'm').test(FUENTE);
  // Una const puede depender de otra (v52: `let TICKERS = TICKERS_RESPALDO.slice();`): se
  // incluyen ANTES las de nivel superior que nombra, salvo las que la prueba ya pasa como
  // dependencia falsa. Así una suite no se rompe cuando una constante cambia de forma.
  function constsConDeps(nombres, yaDadas) {
    const orden = [], vistos = new Set();
    const meter = (n) => {
      if (vistos.has(n)) return;
      vistos.add(n);
      const texto = extraerConst(n);
      const ids = texto.slice(texto.indexOf('=') + 1).match(/[A-Za-z_$][\w$]*/g) || [];
      ids.forEach(id => { if (id !== n && !yaDadas.has(id) && !vistos.has(id) && existeConst(id)) meter(id); });
      orden.push(texto);
    };
    nombres.forEach(meter);
    return orden;
  }
  // Construye un módulo con esas funciones reales y las dependencias falsas que se le pasen.
  //   op.consts:  nombres de const/let del fuente que se incluyen tal cual (y se devuelven),
  //               con las const de nivel superior de las que dependan (ver constsConDeps)
  //   op.prefijo / op.sufijo: código que se antepone / pospone (p. ej. `let _ord = null;` con
  //               un setter, para que una prueba cambie el estado del módulo entre awaits)
  //   op.extras:  nombres adicionales que devolver (los declara prefijo/sufijo o una const múltiple)
  function construir(nombres, deps, op) {
    deps = deps || {}; op = op || {};
    const claves = Object.keys(deps);
    const consts = constsConDeps(op.consts || [], new Set(claves)).join('\n');
    const cuerpo = (op.prefijo || '') + '\n' + consts + '\n' + nombres.map(extraer).join('\n\n') + '\n' + (op.sufijo || '');
    const devolver = nombres.concat(op.consts || [], op.extras || []);
    const f = new Function(...claves, '"use strict";\n' + cuerpo + '\nreturn { ' + devolver.join(', ') + ' };');
    return f(...claves.map(k => deps[k]));
  }

  // ---------- dependencias falsas comunes (copias fieles de las del fuente) ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const usd = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const colUtil = (n) => n == null ? 'var(--tx2)' : n > 0 ? 'var(--verde)' : n < 0 ? 'var(--rojo)' : 'var(--tx2)';
  const BROKER_NOMBRE = { etrade: 'E*TRADE', schwab: 'Charles Schwab', tasty: 'tastytrade', moomoo: 'moomoo' };
  const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iso ? new Date(iso) : new Date()); } catch (_) { return ''; } };
  const haceCuanto = (iso) => {
    if (!iso) return { txt: 'sin dato', min: Infinity };
    const min = (Date.now() - new Date(iso).getTime()) / 60000;
    if (min < 1) return { txt: 'hace segundos', min };
    if (min < 60) return { txt: `hace ${Math.round(min)} min`, min };
    return { txt: `hace ${Math.floor(min / 60)} h`, min };
  };
  // localStorage de juguete con su almacén a la vista
  function localStorageFalso(inicial) {
    const almacen = Object.assign({}, inicial || {});
    return { almacen,
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; } };
  }
  // Nodo DOM de juguete (lo justo para innerHTML/textContent/classList/dataset)
  function nodo(extra) {
    const n = { innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '', disabled: false, tagName: 'DIV',
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, forEach() {} };
    return Object.assign(n, extra || {});
  }
  // Promesa que se resuelve desde fuera (para simular una respuesta del bróker que llega tarde)
  function diferido() {
    let resolver, rechazar;
    const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });
    return { promesa, resolver, rechazar };
  }
  // Deja correr las microtareas pendientes (las continuaciones tras un await)
  const respirar = () => new Promise(r => setImmediate(r));

  // Un supabase-js de juguete: sb.from(tabla) devuelve un builder encadenable que al
  // hacerse await (then) o al pedir maybeSingle()/single() consulta a `enrutar(tabla,
  // cadena)`, donde cadena = [[metodo, args], ...]. Así una prueba decide qué contesta
  // cada consulta sin reimplementar nada.
  function sbFalso(enrutar) {
    const llamadas = [];
    const from = (tabla) => {
      const cadena = [];
      const q = {};
      ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'is', 'gte', 'lte'].forEach(m => {
        q[m] = (...args) => { cadena.push([m, args]); return q; };
      });
      const consulta = () => { llamadas.push({ tabla, cadena: cadena.slice() }); return Promise.resolve().then(() => enrutar(tabla, cadena)); };
      q.maybeSingle = () => consulta();
      q.single = () => consulta();
      q.then = (f, g) => consulta().then(f, g);
      q.catch = (g) => consulta().catch(g);
      return q;
    };
    return { from, llamadas };
  }

  // ---------- el módulo ENTERO en un DOM de juguete (para wiring y window.MZ) ----------
  // Evalúa app/main.js completo: si una versión rompiera el orden de carga o pisara
  // window.MZ, sale aquí. `op.supabase` permite pasar un cliente de juguete propio.
  function cargarModuloEntero(op) {
    op = op || {};
    const almacen = {};
    const canales = [];
    const canal = (nombre) => { const c = { nombre, tablas: [], on(_e, cfg) { c.tablas.push(cfg && cfg.table); return c; }, subscribe() { c.suscrito = true; return c; } }; canales.push(c); return c; };
    const consulta = () => { const q = { select: () => q, eq: () => q, in: () => q, not: () => q, like: () => q, order: () => q, limit: () => q,
      insert: () => q, update: () => q, upsert: () => q, delete: () => q, maybeSingle: () => q, single: () => q,
      then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; return q; };
    const win = { MESA2: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', PROXY_URL: 'https://proxy' },
      supabase: op.supabase || { createClient: () => ({ from: consulta, channel: canal,
        auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) },
      localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
      addEventListener() {}, location: { hash: op.hash || '#/copiloto', reload() {} }, Intl, Date, Math, JSON,
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => Promise.reject(new Error('sin red')),
      navigator: { serviceWorker: { register: () => Promise.resolve(), addEventListener() {} }, userAgent: 'prueba' },
      document: { querySelector: () => nodo(), querySelectorAll: () => [], createElement: () => nodo(),
        addEventListener() {}, body: nodo(), currentScript: { src: op.src || './app/main.js?v=52' }, visibilityState: 'visible' } };
    win.window = win;
    vm.createContext(win);
    let cargo = true, error = null;
    try { vm.runInContext(FUENTE, win, { filename: 'main.js' }); }
    catch (e) { cargo = false; error = String(e && e.message); }
    return { win, cargo, error, canales, almacen, ev: (t) => vm.runInContext(t, win) };
  }

  return { FUENTE, ok, falla, assert, igual, cerca, resumen, extraer, extraerConst, existeConst, construir,
    esc, usd, colUtil, BROKER_NOMBRE, ymdNY, haceCuanto, localStorageFalso, nodo, diferido, respirar, sbFalso, cargarModuloEntero };
};
