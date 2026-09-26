#!/usr/bin/env node
/* Pruebas de la v52: el LIBRO de fills, el DIARIO (contable FIFO puro), las notas, la cartera de
   tastytrade en el Copiloto, la foto del dispositivo, las órdenes puestas fuera de la Mesa y los
   tickers editables. Estilo de la casa: se extraen las funciones REALES del fuente con new Function
   y dependencias falsas — nada se reimplementa aquí. No toca la red, ni Supabase, ni ningún bróker.
   Uso: node test_diario.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RUTA = process.argv[2] || path.join(__dirname, 'mesa-2-app', 'app', 'main.js');
const FUENTE = fs.readFileSync(RUTA, 'utf8');
const INDEX = fs.readFileSync(path.join(path.dirname(RUTA), '..', 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(path.dirname(RUTA), '..', 'sw.js'), 'utf8');

let verdes = 0, fallos = 0;
function ok(msg) { verdes++; console.log('ok ' + msg); }
function falla(msg, extra) { fallos++; console.log('FALLA: ' + msg + (extra ? ' → ' + extra : '')); }
function assert(cond, msg, extra) { if (cond) ok(msg); else falla(msg, extra); }
function igual(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A === B) ok(msg); else falla(msg, 'esperaba ' + B + ' y llegó ' + A); }
function cerca(a, b, msg, tol) { if (Math.abs(Number(a) - Number(b)) <= (tol == null ? 1e-6 : tol)) ok(msg); else falla(msg, 'esperaba ~' + b + ' y llegó ' + a); }

// ---------- extractor (el mismo escáner con estados de test_posiciones_broker.js) ----------
function extraer(nombre) {
  const re = new RegExp('^(?:async )?function ' + nombre + '\\s*\\(', 'm');
  const m = re.exec(FUENTE);
  if (!m) throw new Error('no encontré `function ' + nombre + '` en el fuente');
  let i = FUENTE.indexOf('{', m.index);
  const ANTES_REGEX = '(,=:[!&|?{};+-*%<>~^';
  const pila = [];
  let est = 'codigo', cierre = '', ultimo = '', enClase = false;
  for (; i < FUENTE.length; i++) {
    const c = FUENTE[i], d = FUENTE[i + 1];
    if (est === 'cadena') { if (c === '\\') { i++; continue; } if (c === cierre) est = 'codigo'; continue; }
    if (est === 'linea') { if (c === '\n') est = 'codigo'; continue; }
    if (est === 'bloque') { if (c === '*' && d === '/') { i++; est = 'codigo'; } continue; }
    if (est === 'regex') { if (c === '\\') { i++; continue; } if (c === '[') enClase = true; else if (c === ']') enClase = false; else if (c === '/' && !enClase) { est = 'codigo'; ultimo = '/'; } continue; }
    if (est === 'plantilla') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { est = 'codigo'; pila.pop(); ultimo = '`'; continue; }
      if (c === '$' && d === '{') { i++; pila.push('llave'); est = 'codigo'; ultimo = '{'; continue; }
      continue;
    }
    if (c === '/' && d === '/') { est = 'linea'; i++; continue; }
    if (c === '/' && d === '*') { est = 'bloque'; i++; continue; }
    if (c === '/') { if (!ultimo || ANTES_REGEX.includes(ultimo)) { est = 'regex'; enClase = false; continue; } ultimo = '/'; continue; }
    if (c === '\'' || c === '"') { est = 'cadena'; cierre = c; ultimo = c; continue; }
    if (c === '`') { est = 'plantilla'; pila.push('plantilla'); continue; }
    if (c === '{') { pila.push('llave'); ultimo = '{'; continue; }
    if (c === '}') { pila.pop(); ultimo = '}'; if (!pila.length) return FUENTE.slice(m.index, i + 1); if (pila[pila.length - 1] === 'plantilla') est = 'plantilla'; continue; }
    if (!/\s/.test(c)) ultimo = c;
  }
  throw new Error('no pude cerrar la función ' + nombre);
}
// Constantes del fuente (const X = ...;) para no copiarlas a mano. La sentencia puede ocupar varias
// líneas (v53: ORD_VIVOS_SCHWAB): se cierra en el primer `;` con los corchetes equilibrados, saltando
// cadenas y comentarios de línea (una regex como TICKER_RE lleva sus corchetes equilibrados).
function constante(nombre) {
  const m = new RegExp('^const ' + nombre + ' = ', 'm').exec(FUENTE);
  if (!m) throw new Error('no encontré la constante ' + nombre);
  let i = m.index + m[0].length, prof = 0, est = 'codigo', cierre = '';
  for (; i < FUENTE.length; i++) {
    const c = FUENTE[i], d = FUENTE[i + 1];
    if (est === 'cadena') { if (c === '\\') { i++; continue; } if (c === cierre) est = 'codigo'; continue; }
    if (est === 'linea') { if (c === '\n') est = 'codigo'; continue; }
    if (c === '/' && d === '/') { est = 'linea'; i++; continue; }
    if (c === '\'' || c === '"' || c === '`') { est = 'cadena'; cierre = c; continue; }
    if (c === '[' || c === '{' || c === '(') prof++;
    else if (c === ']' || c === '}' || c === ')') prof--;
    else if (c === ';' && prof === 0) break;
  }
  if (i >= FUENTE.length) throw new Error('no pude cerrar la constante ' + nombre);
  return new Function('return (' + FUENTE.slice(m.index + m[0].length, i) + ');')();
}
function construir(nombres, deps, prologo) {
  deps = deps || {};
  const claves = Object.keys(deps);
  const cuerpo = (prologo || '') + '\n' + nombres.map(extraer).join('\n\n');
  const f = new Function(...claves, '"use strict";\n' + cuerpo + '\nreturn { ' + nombres.join(', ') + ' };');
  return f(...claves.map(k => deps[k]));
}

// ---------- dobles comunes ----------
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const colUtil = (n) => n == null ? 'var(--tx2)' : n > 0 ? 'var(--verde)' : n < 0 ? 'var(--rojo)' : 'var(--tx2)';
const BROKER_NOMBRE = { etrade: 'E*TRADE', schwab: 'Charles Schwab', tasty: 'tastytrade', moomoo: 'moomoo' };
const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iso ? new Date(iso) : new Date()); } catch (_) { return ''; } };
const HOY = '2026-09-25';                 // viernes
const hoyNY = () => HOY;
const haceCuanto = (iso) => { const min = (Date.now() - new Date(iso).getTime()) / 60000; return { txt: min < 60 ? `hace ${Math.round(min)} min` : `hace ${Math.floor(min / 60)} h`, min }; };
const fmtFechaNY = (iso, conHora) => { if (!iso) return '—'; const o = { timeZone: 'America/New_York', day: '2-digit', month: 'short' }; if (conHora) { o.hour = '2-digit'; o.minute = '2-digit'; o.hour12 = false; } return new Intl.DateTimeFormat('es', o).format(new Date(iso)); };
const durTxt = (a, b) => { if (!a || !b) return '—'; const min = (new Date(b) - new Date(a)) / 60000; if (min < 60) return `${Math.round(min)} min`; const h = min / 60; if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} h`; return `${Math.round(h / 24)} d`; };
const PLANES = {
  PLAN_35: { id: 'PLAN_35', nombre: 'Plan 35%', gtcPct: 35, stopPct: null, opsMax: 3, periodo: 'semana' },
  PLAN_10: { id: 'PLAN_10', nombre: 'Plan 10%', gtcPct: 10, stopPct: 20, opsMax: 1, periodo: 'dia' },
};
// Supabase falso que GRABA cada llamada (tabla, operación, filtros) y contesta lo que se le diga.
function sbGrabador(respuestas) {
  const llamadas = [];
  const cadena = (tabla, op, args) => {
    const c = { tabla, op, args, filtros: [] };
    llamadas.push(c);
    const q = {};
    ['eq', 'lt', 'gt', 'gte', 'lte', 'neq', 'like', 'in', 'is', 'not'].forEach(k => { q[k] = (...a) => { c.filtros.push([k, ...a]); return q; }; });
    q.select = (s) => { c.select = s; return q; }; q.single = () => { c.single = true; return q; }; q.maybeSingle = () => q;
    q.order = () => q; q.limit = (n) => { c.limit = n; return q; }; q.range = (a, b) => { c.range = [a, b]; return q; };
    q.then = (f, r) => Promise.resolve().then(() => (respuestas && respuestas[tabla + ':' + op]) ? respuestas[tabla + ':' + op](c) : { data: [], error: null }).then(f, r);
    return q;
  };
  return { llamadas, from: (tabla) => ({
    select: (s) => cadena(tabla, 'select', [s]).select(s),
    insert: (f) => cadena(tabla, 'insert', [f]), update: (f) => cadena(tabla, 'update', [f]),
    upsert: (f, o) => cadena(tabla, 'upsert', [f, o]), delete: () => cadena(tabla, 'delete', []),
  }) };
}

(async () => {
  // ════════════════ 1. EL LIBRO: de la respuesta cruda del bróker a filas de `fills` ════════════════
  const desOsi = construir(['desOsi']).desOsi;
  const L = construir(['ladoFillEtrade', 'fechaNyTransaccion', 'fillsDeTransaccionesEtrade', 'fillsDeOrdenesSchwabLibro', 'textoErrorTabla', 'textoErrorFills'], { ymdNY, desOsi });
  igual([L.ladoFillEtrade('Bought To Open', 2), L.ladoFillEtrade('Sold To Close', -2), L.ladoFillEtrade('Option Expired', 2), L.ladoFillEtrade('Option Assigned', 1), L.ladoFillEtrade('Exercised', 1), L.ladoFillEtrade('', 3), L.ladoFillEtrade('', -3), L.ladoFillEtrade('', 0)],
    ['compra', 'venta', 'vencimiento', 'asignacion', 'ejercicio', 'compra', 'venta', null], 'E*TRADE: el tipo manda el lado; el signo solo desempata');
  igual(L.fechaNyTransaccion(Date.parse('2026-09-22T04:00:00Z')), '2026-09-22', 'fecha NY: medianoche ET (04:00Z en verano) es ese mismo día');
  igual(L.fechaNyTransaccion(Date.parse('2026-09-22T00:00:00Z')), '2026-09-22', 'fecha NY: medianoche UTC exacta NO se corre al día anterior');
  igual(L.fechaNyTransaccion(Date.parse('2026-09-22T23:30:00Z')), '2026-09-22', 'fecha NY: una hora real se resuelve en Nueva York');
  const txET = (id, tipo, qty, price, fecha, extra) => ({ transactionId: id, transactionDate: Date.parse(fecha + 'T04:00:00Z'), transactionType: tipo, description: 'x',
    brokerage: Object.assign({ quantity: qty, price, fee: 0.65, product: { symbol: 'SPY', securityType: 'OPTN', callPut: 'CALL', strikePrice: 769, expiryYear: 26, expiryMonth: 9, expiryDay: 25 } }, extra || {}) });
  const fET = L.fillsDeTransaccionesEtrade([
    txET(1, 'Bought To Open', 2, 3.30, '2026-09-22'), txET(2, 'Sold To Close', -1, 4.00, '2026-09-23'), txET(3, 'Option Expired', 1, 0, '2026-09-25'),
    { transactionId: 4, transactionDate: Date.parse('2026-09-23T04:00:00Z'), transactionType: 'Bought', brokerage: { quantity: 10, price: 180, fee: 0, product: { symbol: 'AAPL', securityType: 'EQ' } } },
    txET(null, 'Bought To Open', 1, 1, '2026-09-22'),
  ]);
  igual(fET.length, 3, 'E*TRADE: solo opciones y solo con transactionId (la acción y la fila sin id quedan fuera)');
  igual(fET.map(f => [f.clave_ext, f.lado, f.contratos, f.precio, f.fecha_ny]), [['1', 'compra', 2, 3.3, '2026-09-22'], ['2', 'venta', 1, 4, '2026-09-23'], ['3', 'vencimiento', 1, 0, '2026-09-25']], 'E*TRADE: clave = transactionId; lado, contratos (positivos), precio (0 al vencer) y fecha NY');
  igual([fET[0].symbol, fET[0].direccion, fET[0].strike, fET[0].expiracion, fET[0].broker, fET[0].origen, fET[0].comision], ['SPY', 'CALL', 769, '2026-09-25', 'etrade', 'dispositivo', 0.65], 'E*TRADE: contrato normalizado (año de 2 dígitos → 4), origen dispositivo y comisión de ESA ejecución');
  assert(fET[0].crudo && fET[0].crudo.tipo === 'Bought To Open' && !('token' in fET[0].crudo) && JSON.stringify(fET[0]).indexOf('oauth') < 0, 'E*TRADE: el crudo va recortado, sin nada con poder');
  const OSI = 'NVDA  261016C00180000';
  const swOrd = { orderId: 77, status: 'FILLED', enteredTime: '2026-09-21T14:00:00Z', closeTime: '2026-09-21T14:05:00Z', price: 2.1, filledQuantity: 3,
    orderLegCollection: [{ instruction: 'BUY_TO_OPEN', quantity: 3, instrument: { assetType: 'OPTION', symbol: OSI } }],
    orderActivityCollection: [{ activityId: 9001, executionLegs: [{ legId: 1, quantity: 2, price: 2.10, time: '2026-09-21T14:03:00Z' }, { legId: 1, quantity: 1, price: 2.12, time: '2026-09-21T14:05:00Z' }] }] };
  const fSW = L.fillsDeOrdenesSchwabLibro([swOrd, { ...swOrd, orderId: 78, status: 'CANCELED' }, { ...swOrd, orderId: 79, orderLegCollection: [{ instruction: 'BUY', quantity: 10, instrument: { assetType: 'EQUITY', symbol: 'SPY' } }] }]);
  igual(fSW.length, 2, 'Schwab: una fila por EJECUCIÓN (dos legs); la cancelada y la acción no entran');
  igual(fSW.map(f => f.clave_ext), ['77#9001#1#2026-09-21T14:03:00Z#0', '77#9001#1#2026-09-21T14:05:00Z#1'], 'Schwab: clave estable = orderId + activityId + legId + hora + ordinal de la ejecución (dos ejecuciones del mismo leg no chocan)');
  // v53: sin activityId y dos fills del mismo leg en el MISMO segundo (el esquema documentado de OrderActivity no
  // trae activityId y `time` va a segundos): el ordinal las separa; antes la segunda se descartaba en silencio
  const swMismoSeg = { ...swOrd, orderId: 80, orderActivityCollection: [{ executionLegs: [{ legId: 1, quantity: 3, price: 2.10, time: '2026-09-21T14:03:00+0000' }, { legId: 1, quantity: 2, price: 2.10, time: '2026-09-21T14:03:00+0000' }] }] };
  const fMismo = L.fillsDeOrdenesSchwabLibro([swMismoSeg]);
  assert(fMismo.length === 2 && fMismo[0].clave_ext !== fMismo[1].clave_ext && fMismo[0].contratos + fMismo[1].contratos === 5, 'Schwab: dos ejecuciones del mismo leg en el mismo segundo y sin activityId dan dos claves distintas (los 5 contratos entran al libro)');
  // v53: una orden de dos patas (vertical) casa cada ejecución con SU pata por legId: compra 180 + venta 190, no dos compras del 180
  const swVertical = { orderId: 81, status: 'FILLED', enteredTime: '2026-09-21T14:00:00Z', closeTime: '2026-09-21T14:05:00Z', price: 1.0, filledQuantity: 1,
    orderLegCollection: [{ legId: 1, instruction: 'BUY_TO_OPEN', quantity: 1, instrument: { assetType: 'OPTION', symbol: 'NVDA  261016C00180000' } }, { legId: 2, instruction: 'SELL_TO_OPEN', quantity: 1, instrument: { assetType: 'OPTION', symbol: 'NVDA  261016C00190000' } }],
    orderActivityCollection: [{ activityId: 1, executionLegs: [{ legId: 1, quantity: 1, price: 2.10, time: '2026-09-21T14:05:00Z' }, { legId: 2, quantity: 1, price: 1.10, time: '2026-09-21T14:05:00Z' }] }] };
  igual(L.fillsDeOrdenesSchwabLibro([swVertical]).map(f => [f.strike, f.lado, f.precio]), [[180, 'compra', 2.1], [190, 'venta', 1.1]], 'Schwab: en una orden de dos patas cada ejecución lleva el contrato y el lado de SU pata (legId)');
  // v53: 'Exercised' y 'Option Assigned' de E*TRADE entran a precio 0 (contrato 0015, igual que el worker): en un
  // ejercicio brokerage.price puede traer el STRIKE y contarlo como venta inflaba el Diario ($23.000 por contrato)
  igual(L.fillsDeTransaccionesEtrade([txET(7, 'Exercised', 1, 230, '2026-09-25'), txET(8, 'Option Assigned', 1, 230, '2026-09-25')]).map(f => [f.lado, f.precio]), [['ejercicio', 0], ['asignacion', 0]], 'E*TRADE: ejercicio y asignación van al libro a precio 0, no al strike');
  igual([fSW[0].symbol, fSW[0].direccion, fSW[0].strike, fSW[0].expiracion, fSW[0].lado, fSW[0].contratos, fSW[0].precio, fSW[0].comision, fSW[0].fecha_ny], ['NVDA', 'CALL', 180, '2026-10-16', 'compra', 2, 2.1, 0, '2026-09-21'], 'Schwab: contrato desde el OSI, comisión 0 (no la manda) y fecha NY');
  const fSW2 = L.fillsDeOrdenesSchwabLibro([{ ...swOrd, orderActivityCollection: [], orderLegCollection: [{ instruction: 'SELL_TO_CLOSE', quantity: 3, instrument: { assetType: 'OPTION', symbol: OSI } }] }]);
  igual([fSW2.length, fSW2[0].clave_ext, fSW2[0].lado, fSW2[0].contratos], [1, '77#orden', 'venta', 3], 'Schwab: sin executionLegs, UNA fila por la orden entera (clave orderId#orden)');
  assert(/migración pendiente/.test(L.textoErrorFills({ code: 'PGRST205', message: "Could not find the table 'public.fills' in the schema cache" })), 'tabla fills sin aplicar → texto discreto de migración pendiente, no un error críptico');
  assert(/policy pendiente/.test(L.textoErrorTabla({ code: '42501', message: 'new row violates row-level security policy' }, 'notas')), 'un rechazo de RLS se dice como policy pendiente');

  // guardarFills: upsert idempotente, user_id explícito, sin duplicados, y si la tabla no existe no revienta
  {
    const sb = sbGrabador({ 'fills:upsert': (c) => ({ data: c.args[0].map((_, i) => ({ id: i })), error: null }) });
    const G = construir(['guardarFills', 'textoErrorFills', 'textoErrorTabla'], { sb });
    const r = await G.guardarFills(fET.concat([fET[0]]), 'uid-1');
    igual([r.nuevos, r.error], [3, null], 'guardarFills: devuelve cuántas entraron; una repetida en el mismo lote se descarta antes de enviar');
    const u = sb.llamadas.find(c => c.op === 'upsert');
    assert(u && u.tabla === 'fills' && u.args[1].onConflict === 'user_id,broker,clave_ext' && u.args[1].ignoreDuplicates === true, 'guardarFills: upsert en fills con onConflict user_id,broker,clave_ext e ignoreDuplicates');
    assert(u.args[0].every(f => f.user_id === 'uid-1'), 'guardarFills: user_id explícito de la sesión en cada fila (RLS)');
    assert(!sb.llamadas.some(c => c.op === 'delete'), 'guardarFills: NUNCA borra nada del libro');
    const sb2 = sbGrabador({ 'fills:upsert': () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) });
    const G2 = construir(['guardarFills', 'textoErrorFills', 'textoErrorTabla'], { sb: sb2 });
    const r2 = await G2.guardarFills(fET, 'uid-1');
    assert(r2.nuevos === 0 && /migración pendiente/.test(r2.error), 'sin la tabla (0015 sin aplicar) la app no se rompe: aviso discreto y sigue');
    igual((await G.guardarFills(fET, null)).error, 'sin sesión', 'sin sesión no se escribe nada');
    const muchos = Array.from({ length: 450 }, (_, i) => ({ ...fET[0], clave_ext: 'k' + i }));
    const sb3 = sbGrabador({ 'fills:upsert': (c) => ({ data: c.args[0].map(() => ({})), error: null }) });
    const G3 = construir(['guardarFills', 'textoErrorFills', 'textoErrorTabla'], { sb: sb3 });
    igual((await G3.guardarFills(muchos, 'u')).nuevos, 450, 'guardarFills: 450 ejecuciones entran en lotes de 200 (3 llamadas)');
    igual(sb3.llamadas.filter(c => c.op === 'upsert').length, 3, 'guardarFills: tres lotes');
  }

  // ════════════════ 2. EL CONTABLE: emparejarFillsFIFO ════════════════
  const claveContrato = construir(['claveContrato']).claveContrato;
  const D = construir(['emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'claveFill', 'durMin', 'diasEntre', 'diaADia', 'resumenPorPeriodo', 'lunesDe', 'viernesDe', 'metricasDiario',
    'periodoDiarioNormalizar', 'enPeriodoDiario', 'periodoDiarioToggle', 'tituloPeriodoDiario', 'nombreMesYm', 'textoSemana', 'fechaCorta', 'coberturaFills', 'compararAbiertos'],
    { claveContrato, hoyNY, ymdNY, DIARIO_LADOS_SALIDA: constante('DIARIO_LADOS_SALIDA'), MESES_ES: constante('MESES_ES'), MESES_ES_C: constante('MESES_ES_C') });
  const F = (broker, clave, symbol, direccion, strike, expiracion, lado, contratos, precio, at, comision) => ({ broker, clave_ext: clave, symbol, direccion, strike, expiracion, lado, contratos, precio, comision: comision || 0, ejecutado_at: at, fecha_ny: ymdNY(at), origen: broker === 'tasty' ? 'worker' : 'dispositivo' });
  const FILLS = [
    // E*TRADE: compra 2, venta 1 y venta 1 (parciales) con comisiones prorrateadas
    F('etrade', 'e1', 'SPY', 'CALL', 769, '2026-09-25', 'compra', 2, 3.30, '2026-09-22T04:00:00.000Z', 1.30),
    F('etrade', 'e2', 'SPY', 'CALL', 769, '2026-09-25', 'venta', 1, 4.00, '2026-09-23T04:00:00.000Z', 0.65),
    F('etrade', 'e3', 'SPY', 'CALL', 769, '2026-09-25', 'venta', 1, 3.50, '2026-09-24T04:00:00.000Z', 0.65),
    // Schwab: compra que VENCIÓ sin venderse (Schwab no reporta el vencimiento) → se deduce
    F('schwab', 's1', 'NVDA', 'CALL', 180, '2026-09-11', 'compra', 1, 2.10, '2026-09-08T14:00:00.000Z'),
    // E*TRADE: vencimiento REPORTADO (Option Expired) → se usa esa fila, no se duplica
    F('etrade', 'e4', 'TSLA', 'PUT', 400, '2026-09-18', 'compra', 1, 1.50, '2026-09-16T04:00:00.000Z'),
    F('etrade', 'e5', 'TSLA', 'PUT', 400, '2026-09-18', 'vencimiento', 1, 0, '2026-09-18T04:00:00.000Z'),
    // tasty: vence HOY (sigue viva) y una abierta normal
    F('tasty', 't1', 'AAPL', 'CALL', 230, '2026-09-25', 'compra', 1, 1.00, '2026-09-24T14:31:00.000Z'),
    F('tasty', 't2', 'META', 'PUT', 700, '2026-10-16', 'compra', 2, 5.00, '2026-09-20T15:00:00.000Z'),
    // tasty: compra y venta con la MISMA hora (la compra va primero)
    F('tasty', 't4', 'QQQ', 'CALL', 500, '2026-10-02', 'venta', 1, 2.50, '2026-09-23T15:00:00.000Z'),
    F('tasty', 't3', 'QQQ', 'CALL', 500, '2026-10-02', 'compra', 1, 2.00, '2026-09-23T15:00:00.000Z'),
    // Schwab: venta SIN compra en el libro → huérfana (no se descarta, se cuenta)
    F('schwab', 's9', 'SPY', 'CALL', 769, '2026-09-25', 'venta', 1, 4.00, '2026-09-23T15:00:00.000Z'),
  ];
  const R = D.emparejarFillsFIFO(FILLS, HOY);
  igual(R.cerradas.length, 5, 'FIFO: 5 TRAMOS cerrados (2 de SPY, NVDA vencida deducida, TSLA vencida reportada, QQQ): la unidad del $');
  // v53: la OPERACIÓN es el VIAJE (de la primera compra con el ciclo plano a quedar plano), como en el Diario viejo
  igual(R.viajes.map(v => [v.symbol, v.fecha_ny, v.pnl, v.costo, v.venta, v.pct, v.compras, v.salidas, v.tramos.length]),
    [['NVDA', '2026-09-11', -210, 210, 0, -100, 1, 1, 1], ['TSLA', '2026-09-18', -150, 150, 0, -100, 1, 1, 1], ['QQQ', '2026-09-23', 50, 200, 250, 25, 1, 1, 1], ['SPY', '2026-09-24', 87.4, 660, 750, 13.24, 1, 2, 2]],
    'VIAJES: 4 operaciones; la de SPY (una compra, dos ventas) es UNA sola con costo 660, venta 750, +87.40 y +13.24 % sobre lo que costó, cerrada el día de la ÚLTIMA salida');
  cerca(R.viajes.reduce((s, v) => s + v.pnl, 0), R.cerradas.reduce((s, c) => s + c.pnl, 0), 'el $ de los viajes es exactamente el $ de los tramos (nada se pierde ni se duplica)');
  assert(R.viajes.find(v => v.symbol === 'SPY').prima_entrada === 3.3 && R.viajes.find(v => v.symbol === 'SPY').prima_salida === 3.75 && R.viajes.find(v => v.symbol === 'SPY').comisiones === 2.6, 'el viaje lleva la prima media de entrada y salida y todas sus comisiones');
  const spy = R.cerradas.filter(c => c.symbol === 'SPY');
  cerca(spy[0].pnl, 68.70, 'tramo 1 de SPY: 400 − 330 − comisiones (0.65 de la compra prorrateada + 0.65 de la venta) = 68.70');
  cerca(spy[0].pct, 20.82, '…y su % es sobre lo que costó ESA compra (330): +20.82%');
  cerca(spy[1].pnl, 18.70, 'tramo 2 de SPY: 350 − 330 − 1.30 = 18.70 (el resto de la comisión de compra viaja con el resto del lote)');
  igual([spy[0].contratos, spy[0].entrada_at, spy[0].salida_at, spy[0].fecha_ny, spy[0].sin_hora], [1, '2026-09-22T04:00:00.000Z', '2026-09-23T04:00:00.000Z', '2026-09-23', true], 'cada tramo lleva entrada, salida, contratos y el día NY de la venta (E*TRADE sin hora)');
  const nvda = R.cerradas.find(c => c.symbol === 'NVDA');
  assert(nvda && nvda.vencido && nvda.derivado && nvda.fecha_ny === '2026-09-11' && nvda.pnl === -210 && nvda.pct === -100, 'lote con expiración pasada y sin venta → pérdida total el día del vencimiento (deducido)');
  const tsla = R.cerradas.filter(c => c.symbol === 'TSLA');
  assert(tsla.length === 1 && tsla[0].vencido && !tsla[0].derivado && tsla[0].pnl === -150 && tsla[0].ids.cierra === 'e5', 'vencimiento REPORTADO por E*TRADE: se usa su fila y NO se duplica con la deducción');
  igual(R.vencidas.length, 2, 'las dos vencidas (una deducida, una reportada) se listan aparte');
  const qqq = R.cerradas.find(c => c.symbol === 'QQQ');
  assert(qqq && qqq.pnl === 50 && qqq.ids.abre === 't3' && qqq.ids.cierra === 't4', 'con la MISMA hora la compra va antes que la venta: se emparejan');
  igual(R.abiertos.map(a => [a.symbol, a.contratos, a.costo, a.vence_en, a.dias_abiertos]), [['META', 2, 1000, 21, 5], ['AAPL', 1, 100, 0, 1]], 'abiertos: en orden de ENTRADA (la META del 20 antes que la AAPL del 24, como el libro); el que vence HOY sigue vivo (vence_en 0) y la META con sus días abiertos');
  assert(/abiertosLista\.sort\(\(a, b\) => \(a\.entrada_at < b\.entrada_at \? -1 : a\.entrada_at > b\.entrada_at \? 1 : String\(a\.contrato\)\.localeCompare\(String\(b\.contrato\)\)\)\)/.test(extraer('emparejarFillsFIFO')), 'y ese orden (entrada_at, contrato de desempate) está escrito así en el fuente');
  igual(R.huerfanas.map(h => [h.broker, h.symbol, h.contratos]), [['schwab', 'SPY', 1]], 'la venta sin compra queda contada como huérfana (por bróker), no se descarta ni se inventa su costo');
  assert(!R.cerradas.some(c => c.broker === 'schwab' && c.symbol === 'SPY'), 'y la venta huérfana de Schwab NO se empareja con la compra de E*TRADE: cada bróker lleva su libro');
  igual(D.emparejarFillsFIFO([], HOY), { cerradas: [], viajes: [], abiertos: [], huerfanas: [], vencidas: [] }, 'sin fills → todo vacío, sin reventar');
  // v53: el CASO A de la revisión (el mismo de calcular_pnl de la mesa vieja): refuerzo + salida escalonada en AAPL
  const FA = [
    F('etrade', 'a1', 'AAPL', 'CALL', 200, '2026-10-16', 'compra', 2, 1.00, '2026-09-21T04:00:00.000Z'), F('etrade', 'a2', 'AAPL', 'CALL', 200, '2026-10-16', 'venta', 1, 1.50, '2026-09-22T04:00:00.000Z'),
    F('etrade', 'a3', 'AAPL', 'CALL', 200, '2026-10-16', 'compra', 1, 1.20, '2026-09-23T04:00:00.000Z'), F('etrade', 'a4', 'AAPL', 'CALL', 200, '2026-10-16', 'venta', 2, 0.80, '2026-09-24T04:00:00.000Z'),
    F('schwab', 'b1', 'TSLA', 'CALL', 400, '2026-09-18', 'compra', 1, 0.90, '2026-09-15T14:30:00.000Z'),
    F('tasty', 'c1', 'NVDA', 'CALL', 180, '2026-10-02', 'compra', 1, 2.00, '2026-09-16T14:31:00.000Z'), F('tasty', 'c2', 'NVDA', 'CALL', 180, '2026-10-02', 'venta', 2, 2.50, '2026-09-17T15:00:00.000Z'),
  ];
  const RA = D.emparejarFillsFIFO(FA, HOY);
  igual([RA.cerradas.length, RA.viajes.length, RA.viajes.filter(v => v.pnl > 0).length], [5, 3, 1], 'CASO A: 5 tramos pero 3 operaciones y 1 acierto, exactamente lo que decía el Diario viejo (3 viajes, 1 ✓)');
  const vA = RA.viajes.find(v => v.symbol === 'AAPL');
  igual([vA.costo, vA.venta, vA.pnl, vA.pct, vA.fecha_ny, vA.contratos, vA.compras, vA.salidas], [320, 310, -10, -3.12, '2026-09-24', 3, 2, 2], 'CASO A: AAPL es UN viaje en rojo (costo 320 → venta 310: −3.125 %, que Math.round deja en −3.12 porque lleva el medio hacia arriba; en pantalla sale −3.1 %) el día que quedó plano, no tres «operaciones» con una en verde');
  const dA = D.diaADia(RA.cerradas, null, null, RA.viajes);
  igual(dA.map(d => [d.fecha_ny, d.total, d.ops, d.aciertos]), [['2026-09-17', 50, 1, 1], ['2026-09-18', -90, 1, 0], ['2026-09-22', 50, 0, 0], ['2026-09-24', -60, 1, 0]], 'CASO A día a día: el $ de cada día no cambia (por tramos); las operaciones y aciertos van al día en que la operación quedó plana');
  igual(D.metricasDiario(RA.cerradas, dA, RA.viajes).aciertos, 1, 'CASO A métricas: 1 acierto de 3');
  // v53: un vencimiento REPORTADO el sábado (E*TRADE lo anota al día siguiente) cae el día de la EXPIRACIÓN, como el deducido
  const RS = D.emparejarFillsFIFO([F('etrade', 's1', 'AAPL', 'CALL', 200, '2026-09-18', 'compra', 2, 1.00, '2026-09-15T04:00:00.000Z'), F('etrade', 's2', 'AAPL', 'CALL', 200, '2026-09-18', 'vencimiento', 2, 0, '2026-09-19T04:00:00.000Z')], HOY);
  igual([RS.cerradas[0].fecha_ny, RS.cerradas[0].salida_at, RS.viajes[0].fecha_ny, RS.cerradas[0].derivado], ['2026-09-18', '2026-09-18T20:00:00.000Z', '2026-09-18', false], 'vencimiento reportado un sábado → el día es el viernes de la expiración (un vencimiento del 30 no se va al mes siguiente)');
  // v53: venta parcial y el resto vencido = UN viaje que venció en parte, con las dos salidas
  const RP = D.emparejarFillsFIFO([F('schwab', 'p1', 'SPY', 'CALL', 650, '2026-09-18', 'compra', 2, 1.00, '2026-09-15T14:00:00.000Z'), F('schwab', 'p2', 'SPY', 'CALL', 650, '2026-09-18', 'venta', 1, 1.50, '2026-09-16T14:00:00.000Z')], HOY);
  igual([RP.viajes.length, RP.viajes[0].pnl, RP.viajes[0].vencido, RP.viajes[0].vencido_total, RP.viajes[0].derivado, RP.viajes[0].fecha_ny, RP.viajes[0].salidas], [1, -50, true, false, true, '2026-09-18', 2], 'venta parcial + resto vencido: un solo viaje (−50) que «venció en parte», cerrado el día del vencimiento');
  igual(D.emparejarFillsFIFO([{ broker: 'etrade', symbol: 'SPY', lado: 'compra', contratos: 0, precio: 1 }, null], HOY).abiertos.length, 0, 'basura (contratos 0, null) se ignora');
  // día a día
  const dias = D.diaADia(R.cerradas, null, null, R.viajes);
  igual(dias.map(d => d.fecha_ny), ['2026-09-11', '2026-09-18', '2026-09-23', '2026-09-24'], 'día a día: una fila por día NY, en orden');
  igual(dias.map(d => [d.ops, d.aciertos]), [[1, 0], [1, 0], [1, 1], [1, 1]], 'día a día: las operaciones y los aciertos van por VIAJES (SPY cuenta el 24, cuando quedó plana; el 23 solo QQQ)');
  igual(D.diaADia(R.cerradas).map(d => d.ops), [1, 1, 2, 1], 'día a día sin viajes (uso suelto de la pura): cuenta tramos');
  igual(dias.map(d => d.total), [-210, -150, 118.7, 18.7], 'día a día: el total del día');
  igual(dias.map(d => d.acumulado), [-210, -360, -241.3, -222.6], 'día a día: el acumulado corre');
  igual(dias[2].por_broker, { etrade: { pnl: 68.7, ops: 0, vencidos: 0 }, tasty: { pnl: 50, ops: 1, vencidos: 0 } }, 'día a día: una columna por bróker (en el orden en que salió cada tramo: SPY 04:00Z antes que QQQ 15:00Z); el $ de E*TRADE cuenta el 23 pero su operación —el viaje SPY— el 24, cuando quedó plana');
  igual([dias[0].vencidos, dias[0].por_broker.schwab.vencidos], [1, 1], 'día a día: los contratos vencidos se marcan en su día y su bróker');
  igual(D.diaADia(R.cerradas, '2026-09-23', '2026-09-24').map(d => d.acumulado), [118.7, 137.4], 'día a día acotado: el acumulado empieza en el rango');
  // resúmenes
  const meses = D.resumenPorPeriodo(R.cerradas, 'mes', null, null, R.viajes);
  igual([meses.length, meses[0].clave, meses[0].pnl, meses[0].ops, meses[0].aciertos, meses[0].dias, meses[0].pct, meses[0].acumulado, meses[0].mejor, meses[0].peor], [1, '2026-09', -222.6, 4, 2, 4, -18.25, -222.6, 87.4, -210], 'resumen mensual: P&L, ops y aciertos (viajes), días operados, % ponderado por costo, acumulado, mejor y peor viaje');
  igual(D.resumenPorPeriodo(R.cerradas, 'mes')[0].ops, 5, 'resumen sin viajes (uso suelto de la pura): cuenta tramos');
  const sem = D.resumenPorPeriodo(R.cerradas, 'semana', null, null, R.viajes);
  igual(sem.map(s => [s.desde, s.hasta, s.pnl, s.acumulado]), [['2026-09-21', '2026-09-25', 137.4, -222.6], ['2026-09-14', '2026-09-18', -150, -360], ['2026-09-07', '2026-09-11', -210, -210]], 'resumen semanal: lunes→viernes, de la más reciente a la más vieja, con el acumulado cronológico');
  igual([D.lunesDe('2026-09-25'), D.lunesDe('2026-09-21'), D.lunesDe('2026-09-20'), D.viernesDe('2026-09-21'), D.lunesDe('x')], ['2026-09-21', '2026-09-21', '2026-09-14', '2026-09-25', ''], 'lunesDe/viernesDe: el domingo 20 pertenece a la semana del 14');
  const M = D.metricasDiario(R.cerradas, dias, R.viajes);
  igual([M.total, M.ops, M.aciertos, M.pct, M.mejor, M.peor, M.dias_operados, M.prom_dia, M.proy_mes, M.proy_anio, M.vencidas], [-222.6, 4, 2, -18.25, 87.4, -210, 4, -55.65, -1168.65, -14023.8, 2], 'métricas: total y % ponderado por tramos; ops, aciertos, mejor/peor y vencidas por VIAJES; promedio por día operado y proyección 21/252 días');
  igual(D.metricasDiario(R.cerradas, dias).ops, 5, 'métricas sin viajes (uso suelto de la pura): cuenta tramos');
  igual(D.metricasDiario([], []).prom_dia, null, 'sin días operados no hay promedio ni proyección (null, no 0)');
  // selector de período
  igual(D.periodoDiarioNormalizar(null), { modo: 'todo' }, 'selector: sin nada guardado → todo el historial');
  igual(D.periodoDiarioNormalizar({ modo: 'meses', vals: ['2026-09', '2026-08', '2026-09', 'x'] }), { modo: 'meses', vals: ['2026-08', '2026-09'] }, 'selector: meses sin repetir, ordenados, basura fuera');
  igual(D.periodoDiarioNormalizar({ modo: 'semanas', vals: ['2026-09-23'] }), { modo: 'semanas', vals: ['2026-09-21'] }, 'selector: una semana se guarda por su lunes');
  igual(D.periodoDiarioNormalizar({ modo: 'rango', desde: '2026-09-30', hasta: '2026-09-01' }), { modo: 'rango', desde: '2026-09-01', hasta: '2026-09-30' }, 'selector: un rango al revés se endereza');
  igual(D.periodoDiarioNormalizar({ modo: 'meses', vals: [] }), { modo: 'todo' }, 'selector: meses vacíos = todo');
  const s1 = D.periodoDiarioToggle({ modo: 'todo' }, 'mes', '2026-09');
  const s2 = D.periodoDiarioToggle(s1, 'mes', '2026-08');
  const s3 = D.periodoDiarioToggle(s2, 'mes', '2026-09');
  igual([s1, s2, s3], [{ modo: 'meses', vals: ['2026-09'] }, { modo: 'meses', vals: ['2026-08', '2026-09'] }, { modo: 'meses', vals: ['2026-08'] }], 'toggle: los meses se SUMAN al tocar varios y se quitan al volver a tocar');
  igual(D.periodoDiarioToggle(s2, 'mes', '2026-09', true), { modo: 'meses', vals: ['2026-09'] }, 'toggle «solo»: una fila del resumen deja ese mes solo');
  igual(D.periodoDiarioToggle(s2, 'sem', '2026-09-23'), { modo: 'semanas', vals: ['2026-09-21'] }, 'toggle: pasar de meses a semanas empieza de cero');
  igual(D.periodoDiarioToggle(s1, 'mes', '2026-09'), { modo: 'todo' }, 'toggle: quitar el último vuelve a todo');
  // v53 (Andrés 2026-09-25: «aquí falta día»): modo DÍAS — el chip «Hoy» y los días sueltos del día a día (se suman)
  igual(D.periodoDiarioNormalizar({ modo: 'dias', vals: ['2026-09-24', '2026-09-22', '2026-09-24', 'x', '2026-9-1'] }), { modo: 'dias', vals: ['2026-09-22', '2026-09-24'] }, 'selector: días sin repetir, ordenados, basura fuera');
  igual(D.periodoDiarioNormalizar({ modo: 'dias', vals: [] }), { modo: 'todo' }, 'selector: días vacíos = todo');
  const dd1 = D.periodoDiarioToggle({ modo: 'todo' }, 'dia', HOY);
  const dd2 = D.periodoDiarioToggle(dd1, 'dia', '2026-09-23');
  igual([dd1, dd2], [{ modo: 'dias', vals: [HOY] }, { modo: 'dias', vals: ['2026-09-23', HOY] }], 'toggle «Hoy»: crea {modo: dias, vals: [hoy]}; un segundo día se SUMA (y se ordena)');
  igual(D.periodoDiarioToggle(dd2, 'dia', '2026-09-23', true), { modo: 'dias', vals: ['2026-09-23'] }, 'toggle «solo» (una fila del día a día) deja ese día solo');
  igual(D.periodoDiarioToggle(dd1, 'dia', HOY), { modo: 'todo' }, 'toggle: quitar el único día vuelve a todo');
  igual(D.periodoDiarioToggle(s2, 'dia', HOY), { modo: 'dias', vals: [HOY] }, 'toggle: pasar de meses a un día empieza de cero');
  igual(R.cerradas.filter(c => D.enPeriodoDiario({ modo: 'dias', vals: ['2026-09-23'] }, c.fecha_ny)).map(c => c.symbol), ['SPY', 'QQQ'], 'filtrar por un día deja solo lo cerrado ESE día (el tramo 1 de SPY y QQQ el 23)');
  igual(R.cerradas.filter(c => D.enPeriodoDiario(dd2, c.fecha_ny)).length, 2, 'con dos días elegidos (23 y hoy 25) entran los del 23 y ninguno más');
  igual([D.tituloPeriodoDiario({ modo: 'dias', vals: ['2026-09-24'] }), D.tituloPeriodoDiario(dd2)], ['24 sep', '2 días'], 'títulos del modo días: «24 sep» y «2 días»');
  // y la pestaña Cuentas (saldos) gana «Hoy»: inicioPeriodo('dia') es hoy en Nueva York
  const IP = construir(['inicioPeriodo'], { lunesNY: () => '2026-09-21' });
  igual([IP.inicioPeriodo('dia'), IP.inicioPeriodo('semana'), IP.inicioPeriodo('mes').slice(-3), IP.inicioPeriodo('ytd').slice(-6)], [ymdNY(), '2026-09-21', '-01', '-01-01'], 'inicioPeriodo: dia = hoy NY; semana = el lunes; mes y ytd como siempre');
  const enSem = R.cerradas.filter(c => D.enPeriodoDiario({ modo: 'semanas', vals: ['2026-09-21'] }, c.fecha_ny));
  cerca(enSem.reduce((s, c) => s + c.pnl, 0), 137.4, 'filtrar por «esta semana» deja solo lo cerrado esa semana');
  igual(R.cerradas.filter(c => D.enPeriodoDiario({ modo: 'rango', desde: '2026-09-11', hasta: '2026-09-18' }, c.fecha_ny)).length, 2, 'rango a medida con dos fechas (inclusivo)');
  igual(R.cerradas.filter(c => D.enPeriodoDiario({ modo: 'todo' }, c.fecha_ny)).length, 5, 'todo el historial no filtra');
  igual([D.tituloPeriodoDiario({ modo: 'todo' }), D.tituloPeriodoDiario(s2), D.tituloPeriodoDiario({ modo: 'semanas', vals: ['2026-09-21'] }), D.tituloPeriodoDiario({ modo: 'rango', desde: '2026-09-01', hasta: '2026-09-25' })],
    ['todo el historial', 'agosto 2026 + septiembre 2026', 'semana del 21–25 sep', 'del 1 sep al 25 sep'], 'títulos humanos del período');
  // cobertura
  const cob = D.coberturaFills(FILLS, { etrade: 'ok', schwab: 'caducada', tasty: 'worker' });
  igual(cob.map(c => [c.broker, c.primera, c.ultima, c.n, c.sesion]), [['etrade', '2026-09-16', '2026-09-24', 5, 'ok'], ['schwab', '2026-09-08', '2026-09-23', 2, 'caducada'], ['tasty', '2026-09-20', '2026-09-24', 4, 'worker']], 'cobertura: desde cuándo hay fills por bróker, cuántas y el estado de la sesión; moomoo sin fills no sale');
  igual(cob.find(c => c.broker === 'tasty').origen, { worker: 4 }, 'cobertura: se sabe cuántas puso el worker');
  // v54: moomoo entra al libro por el worker (moomoo_fills, OpenD headless en el VPS): sesión 'worker', sin login en este equipo
  assert(/moomoo: 'worker'/.test(extraer('vistaDiario')) && /tasty: 'worker'/.test(extraer('vistaDiario')), 'v54: el mapa de sesiones de vistaDiario lleva moomoo: worker (igual que tasty)');
  const FILLS_MM = FILLS.concat([{ ...F('moomoo', 'm1', 'AMD', 'CALL', 200, '2026-10-16', 'compra', 1, 1.20, '2026-09-24T15:00:00.000Z'), origen: 'worker' }]);
  const cobMM = D.coberturaFills(FILLS_MM, { etrade: 'ok', schwab: 'caducada', tasty: 'worker', moomoo: 'worker' });
  igual(cobMM.map(c => [c.broker, c.primera, c.n, c.sesion]).slice(3), [['moomoo', '2026-09-24', 1, 'worker']], 'v54 cobertura: moomoo sale con sus fills, su primera fecha y sesión worker');
  igual(cobMM.find(c => c.broker === 'moomoo').origen, { worker: 1 }, 'v54 cobertura: las de moomoo las puso el worker');
  igual(D.coberturaFills(FILLS, { moomoo: 'worker' }).map(c => [c.broker, c.n, c.sesion]).slice(3), [['moomoo', 0, 'worker']], 'v54 cobertura: sin fills pero con la sesión declarada (lo que hace vistaDiario) moomoo también sale, con 0');
  // comparar abiertos: libro de fills vs cartera del bróker vs posiciones
  const cmp = D.compararAbiertos(R.abiertos,
    [{ broker: 'tasty', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 2 }, { broker: 'tasty', symbol: 'AMD', direccion: 'CALL', strike: 200, expiracion: '2026-10-16', contratos: 1 }],
    [{ estado: 'abierta', broker: 'tasty', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 2 }, { estado: 'abierta', broker: 'tasty', symbol: 'AAPL', direccion: 'CALL', strike: 230, expiracion: '2026-09-25', contratos: 3 }],
    ['tasty']);
  const cm = Object.fromEntries(cmp.map(x => [x.contrato.split('|')[0], x]));
  assert(cm.META.coincide && cm.META.comprobado && cm.META.fills === 2 && cm.META.broker_n === 2 && cm.META.libro === 2, 'comparar: META cuadra en las tres fuentes');
  assert(!cm.AAPL.coincide && cm.AAPL.fills === 1 && cm.AAPL.libro === 3 && cm.AAPL.broker_n === 0, 'comparar: AAPL no cuadra (fills ×1, Mesa ×3, bróker ×0) y se dice');
  assert(!cm.AMD.coincide && cm.AMD.fills === 0 && cm.AMD.broker_n === 1, 'comparar: lo que el bróker tiene y el libro de fills no, también se dice');
  const cmp2 = D.compararAbiertos(R.abiertos, [], [], []);
  assert(cmp2.every(x => !x.comprobado && x.broker_n == null), 'comparar: sin lectura del bróker no se afirma nada contra él (comprobado=false)');

  // ════════════════ 3. RENDER del Diario (HTML puro sobre los datos) ════════════════
  const V = construir(['seccionPeriodoDiario', 'tarjetasResumenDiario', 'seccionCoberturaDiario', 'seccionDiaADia', 'seccionResumenesDiario', 'seccionOperacionesDiario', 'seccionAbiertosDiario',
    'seccionEjecucionesDiario', 'seccionNotasDiario', 'selectorCuentas', 'textoDuracionOp', 'fechaHoraD', 'periodoDiarioNormalizar', 'lunesDe', 'viernesDe', 'nombreMesYm', 'textoSemana', 'fechaCorta', 'tituloPeriodoDiario', 'diasEntre', 'claveFill'],
    { esc, usd, colUtil, BROKER_NOMBRE, hoyNY, ymdNY, fmtFechaNY, durTxt, claveContrato,
      MESES_ES: constante('MESES_ES'), MESES_ES_C: constante('MESES_ES_C'), BROKER_CORTO: constante('BROKER_CORTO'),
      dineroD: constante('dineroD'), dineroS: constante('dineroS'), pctD: constante('pctD'), colD: constante('colD'), nOps: constante('nOps') });
  const hEj = V.seccionEjecucionesDiario(FILLS, 'todos', false);
  assert((hEj.match(/class="ej"/g) || []).length === FILLS.length && !/<table/.test(hEj) && /EJECUCIONES DEL PERÍODO · 11/.test(hEj), 'la lista de EJECUCIONES sale A LA VISTA con todas las filas, una ficha por ejecución (v53: sin tabla, se lee entera a 390 px sin desplazar de lado); lo primero que Andrés va a buscar');
  assert(/MZ\.diarioBroker\('etrade'\)/.test(hEj) && /COMPRA/.test(hEj) && /VENTA/.test(hEj) && /VENCIMIENTO/.test(hEj), 'ejecuciones: filtro por bróker y el lado de cada una');
  assert((V.seccionEjecucionesDiario(FILLS, 'schwab', false).match(/class="ej"/g) || []).length === 2, 'ejecuciones filtradas por Schwab: solo las suyas (s1 y s9)');
  // v54: moomoo entra al libro por el worker (moomoo_fills): chip propio en el filtro y sus fichas
  const hEjMM = V.seccionEjecucionesDiario(FILLS_MM, 'moomoo', false);
  assert(/MZ\.diarioBroker\('moomoo'\)/.test(hEj) && (hEjMM.match(/class="ej"/g) || []).length === 1 && /AMD CALL 200/.test(hEjMM) && /· moomoo<\/span>/.test(hEjMM) && /class="chip2 on" onclick="MZ\.diarioBroker\('moomoo'\)">moomoo<small>1<\/small>/.test(hEjMM), 'v54: el filtro de ejecuciones por bróker incluye moomoo (con su cuenta) y deja solo las suyas');
  assert(/tasty y moomoo las escribe el worker/.test(V.seccionEjecucionesDiario(FILLS, 'moomoo', false)), 'v54: sin ejecuciones de moomoo se dice que las escribe el worker');
  assert(/Sin ejecuciones de moomoo/.test(V.seccionEjecucionesDiario(FILLS, 'moomoo', false)), 'sin ejecuciones de ese bróker se dice, no queda una tabla vacía muda');
  const muchas = Array.from({ length: 130 }, (_, i) => ({ ...FILLS[0], clave_ext: 'm' + i, ejecutado_at: '2026-09-0' + (1 + (i % 9)) + 'T14:00:00Z' }));
  assert(/Ver las 10 restantes/.test(V.seccionEjecucionesDiario(muchas, 'todos', false)) && !/Ver las/.test(V.seccionEjecucionesDiario(muchas, 'todos', true)), 'más de 120: se ofrece ver las restantes (y con «todas» salen todas)');
  const hD = V.seccionDiaADia(dias, ['etrade', 'schwab', 'tasty']);
  assert(/<th>E\*TRADE<\/th>/.test(hD) && /<th>Schwab<\/th>/.test(hD) && /<th>tasty<\/th>/.test(hD) && /Acum\./.test(hD) && /⚠1/.test(hD), 'día a día: una columna por bróker, el acumulado y el aviso de vencidos');
  // v53: cada fila del día a día es clicable (una fila = ese día solo) y el día elegido va marcado
  assert(/toca un día para verlo solo/.test(hD) && /<tr class="pick" onclick="MZ\.diarioPeriodo\('dia','2026-09-24',true\)">/.test(hD) && (hD.match(/<tr class="pick/g) || []).length === 4 && !/pick sel/.test(hD), 'día a día: cada día es un <tr class="pick"> con MZ.diarioPeriodo(dia, fecha, true) y el texto «toca un día para verlo solo»; sin día elegido, ninguno marcado');
  const hDs = V.seccionDiaADia(dias, ['etrade', 'schwab', 'tasty'], ['2026-09-23']);
  assert(/<tr class="pick sel" onclick="MZ\.diarioPeriodo\('dia','2026-09-23',true\)">/.test(hDs) && (hDs.match(/pick sel/g) || []).length === 1, 'día a día: el día elegido (modo días) lleva class="pick sel", y solo ese');
  assert(/<th>moomoo<\/th>/.test(V.seccionDiaADia(dias, [])) && !/<th>moomoo<\/th>/.test(hD), 'v54 día a día: sin lista de brókeres salen las cuatro columnas (moomoo incluida); con la lista, solo las que operaron en el período');
  const hR = V.seccionResumenesDiario(meses, sem, { modo: 'semanas', vals: ['2026-09-21'] });
  assert(/RESUMEN MENSUAL/.test(hR) && /RESUMEN SEMANAL/.test(hR) && /MZ\.diarioPeriodo\('sem','2026-09-21',true\)/.test(hR) && /class="pick sel"/.test(hR), 'resúmenes mensual y semanal, clicables (una fila = ese período solo) y con la elegida marcada');
  const hP = V.seccionPeriodoDiario({ modo: 'meses', vals: ['2026-09'] }, meses, sem, HOY);
  assert(/Todo el historial/.test(hP) && /Este mes/.test(hP) && /Esta semana/.test(hP) && /id="dDesde"/.test(hP) && /MZ\.diarioRango\(\)/.test(hP) && /septiembre 2026/.test(hP), 'selector: Todo · este mes · esta semana · meses · semanas · rango a medida');
  const hPt = V.seccionPeriodoDiario({ modo: 'todo' }, meses, sem, HOY, { desde: '2026-09-01' });
  assert(/id="dDesde" value="2026-09-01"/.test(hPt) && /MZ\.diarioRangoTmp\('desde', this\.value\)/.test(hPt) && /MZ\.diarioRangoTmp\('hasta', this\.value\)/.test(hPt), 'rango a medida: la fecha ya elegida sobrevive al redibujo (se guarda al cambiarla, se pinta desde ahí)');
  // v53: el chip «Hoy» (modo días): encendido con hoy elegido, apagado con un mes elegido
  const hPh = V.seccionPeriodoDiario({ modo: 'dias', vals: [HOY] }, meses, sem, HOY);
  assert(/<button class="chip2 on" onclick="MZ\.diarioPeriodo\('dia','2026-09-25'\)" title="">Hoy<\/button>/.test(hPh) && /<span class="fresco">25 sep<\/span>/.test(hPh), 'selector: el chip «Hoy» (MZ.diarioPeriodo(dia, hoy)) sale encendido con hoy elegido y el título del período dice «25 sep»');
  assert(/<button class="chip2" onclick="MZ\.diarioPeriodo\('dia','2026-09-25'\)" title="">Hoy<\/button>/.test(hP) && /<button class="chip2 on" onclick="MZ\.diarioPeriodo\('mes','2026-09'\)"/.test(hP), 'selector: con un mes elegido el chip «Hoy» va apagado (y el del mes encendido)');
  assert(/<button class="chip2" onclick="MZ\.diarioPeriodo\('dia','2026-09-25'\)" title="">Hoy<\/button>/.test(V.seccionPeriodoDiario({ modo: 'dias', vals: ['2026-09-23', HOY] }, meses, sem, HOY)), 'selector: con hoy Y otro día elegidos, «Hoy» no se enciende (solo cuando hoy es el único)');
  const hM = V.tarjetasResumenDiario(M, { modo: 'todo' }, cob.map(c => ({ ...c, pnl_periodo: -1 })));
  assert(/TOTAL DEL PERÍODO · TODO EL HISTORIAL/.test(hM) && /-\$222\.60/.test(hM) && /PROYECCIÓN MENSUAL/.test(hM) && /estimación/.test(hM) && /no una promesa/.test(hM), 'tarjetas: total, % por $, promedio por día y proyecciones dichas como ESTIMACIÓN');
  assert(/4 operaciones cerradas · 2 en verde \(50%\)/.test(hM) && /2 operaciones vencieron/.test(hM) && !/tramo/.test(hM), 'tarjetas: cuenta VIAJES («4 operaciones cerradas · 2 en verde»), sin hablar de tramos');
  const hM1 = V.tarjetasResumenDiario({ ...M, ops: 1, aciertos: 1, vencidas: 1 }, { modo: 'todo' }, []);
  assert(/1 operación cerrada · 1 en verde/.test(hM1) && /1 operación venció/.test(hM1) && /lo que costó la operación/.test(hM1), 'plural en claro: «1 operación cerrada», no «1 operaciones»');
  const hC = V.seccionCoberturaDiario(cob, null);
  assert(/E\*TRADE/.test(hC) && /caducó/.test(hC) && /worker/.test(hC) && /desde <b>16 sep 2026/.test(hC), 'cobertura: desde cuándo hay historia por cuenta y si falta un login');
  assert(/<b>moomoo<\/b><\/span><span class="mut" style="text-align:right">sin ejecuciones en el libro todavía · la escribe el worker \(24\/5\)/.test(V.seccionCoberturaDiario(D.coberturaFills(FILLS, { moomoo: 'worker' }), null)), 'v54 cobertura pintada: moomoo con «sin ejecuciones en el libro todavía · la escribe el worker (24/5)»');
  const hO = V.seccionOperacionesDiario(R.viajes);
  assert(/OPERACIONES CERRADAS · 4/.test(hO) && /venció \(deducido\)/.test(hO) && /mismo día|1 d|2 d/.test(hO) && /\+13\.2%/.test(hO) && /1 compra y 2 salidas/.test(hO) && /×1 \$3\.30→\$4\.00 · ×1 \$3\.30→\$3\.50/.test(hO), 'operaciones cerradas: una tarjeta por VIAJE con su % sobre lo que costó, sus tramos debajo y las vencidas marcadas (deducida vs reportada)');
  assert(/-\$10\.00 · -3\.1%/.test(V.seccionOperacionesDiario(RA.viajes)), 'CASO A en pantalla: «-$10.00 · -3.1%» (el segundo decimal del redondeo no se ve)');
  assert(/venció en parte/.test(V.seccionOperacionesDiario(RP.viajes)) && /Ejercida: la prima cuenta como perdida aquí/.test(V.seccionOperacionesDiario([{ ...R.viajes[2], lado_salida: 'ejercicio', vencido: false }])), 'una operación vencida en parte lo dice, y una ejercida avisa de que el resultado real está en las acciones');
  const hA = V.seccionAbiertosDiario(R.abiertos, cmp, R.huerfanas);
  assert(/ABIERTOS SEGÚN EL LIBRO DE FILLS/.test(hA) && /HOY/.test(hA) && /No cuadra con el libro en 2 contratos/.test(hA) && /nada se cambia solo/.test(hA) && /1 venta sin su compra/.test(hA), 'abiertos: la que vence HOY, las diferencias contra el libro (solo dichas) y la huérfana');
  const hN = V.seccionNotasDiario([{ id: 1, fecha_ny: HOY, texto: 'No perseguir <el> precio', symbol: 'SPY', creado_at: '2026-09-25T13:00:00Z' }, { id: 2, fecha_ny: '2026-09-24', texto: 'b', posicion_id: 9, creado_at: '2026-09-24T13:00:00Z' }],
    { posicion_id: 9, symbol: 'SPY', fecha: HOY }, ['AAPL', 'SPY'], [{ id: 9, symbol: 'SPY', direccion: 'CALL', strike: 769, estado: 'abierta', abierta_fecha_ny: '2026-09-22' }], null, null);
  assert(/&lt;el&gt;/.test(hN) && /maxlength="4000"/.test(hN) && /<option value="SPY" selected>/.test(hN) && /<option value="9" selected>/.test(hN) && /MZ\.notaEditar\('1'\)/.test(hN) && /MZ\.notaBorrar\('2'\)/.test(hN) && /HOY/.test(hN), 'notas: campo de 4000, ticker y posición preseleccionados (desde la tarjeta del Copiloto), lista por fecha con editar y borrar, texto escapado');
  assert(/<textarea id="nEd_1"/.test(V.seccionNotasDiario([{ id: 1, fecha_ny: HOY, texto: 'x', creado_at: '2026-09-25T13:00:00Z' }], null, [], [], 1, null)), 'notas: en edición la nota se vuelve un textarea con Guardar/Cancelar');
  // v53: el formulario se pinta desde el BORRADOR (texto incluido) y la edición desde lo tecleado, no desde el original
  const hNb = V.seccionNotasDiario([{ id: 1, fecha_ny: HOY, texto: 'original', creado_at: '2026-09-25T13:00:00Z' }], { texto: 'lo que iba <escribiendo>', fecha: '2026-09-24', symbol: 'AAPL' }, ['AAPL', 'SPY'], [], 1, null, 'original corregido');
  assert(/oninput="MZ\.notaBorrador\(this\.value\)">lo que iba &lt;escribiendo&gt;<\/textarea>/.test(hNb) && /id="nFecha" value="2026-09-24"/.test(hNb) && /<option value="AAPL" selected>/.test(hNb) && /MZ\.notaBorradorCampo\('fecha'/.test(hNb), 'notas: el texto, la fecha y el ticker del borrador se repintan tal cual (y cada tecla lo actualiza)');
  assert(/id="nEd_1" maxlength="4000" oninput="MZ\.notaEdBorrador\(this\.value\)">original corregido<\/textarea>/.test(hNb), 'notas: la nota en edición se repinta con lo TECLEADO, no con su texto original');
  assert(/class="lnk"[^>]*MZ\.notaEditar\('1'\)/.test(V.seccionNotasDiario([{ id: 1, fecha_ny: HOY, texto: 'x', creado_at: '2026-09-25T13:00:00Z' }], null, [], [], null, null)) && /a\.lnk\{display:inline-block;padding:10px 8px/.test(INDEX), 'Editar/Borrar con área de toque de 32 px (clase lnk)');
  assert(/Diario<\/button>/.test(V.selectorCuentas('diario')) && /perbtn on"[^>]*MZ\.cuentasVista\('cuentas'\)/.test(V.selectorCuentas('cuentas')), 'la pestaña Cuentas lleva el selector Diario · Cuentas arriba');

  // ════════════════ 4. NOTAS: CRUD optimista con reversión (sb falso) ════════════════
  {
    const NA = construir(['notasAplicar']).notasAplicar;
    igual(NA([{ id: 1 }], { tipo: 'alta', fila: { id: 2 } }).map(n => n.id), [2, 1], 'notasAplicar: el alta va primero');
    igual(NA([{ id: 1, texto: 'a' }], { tipo: 'cambio', id: 1, cambios: { texto: 'b' } }), [{ id: 1, texto: 'b' }], 'notasAplicar: cambio por id');
    igual(NA([{ id: 1 }, { id: 2 }], { tipo: 'baja', id: '1' }), [{ id: 2 }], 'notasAplicar: baja por id (string o número)');
    const pintadas = [], toasts = [];
    const mk = (sb, lista) => construir(['notaAltaImpl', 'notaCambioImpl', 'notaBajaImpl', 'notasAplicar', 'textoErrorNotas', 'textoErrorTabla'],
      { sb, _notas: { lista, ts: 0, err: null, editando: 5 }, pintarNotas: () => pintadas.push('p'), toast: (t) => toasts.push(t) });
    const sbOk = sbGrabador({ 'notas:insert': (c) => ({ data: { ...c.args[0], id: 55, creado_at: 'x' }, error: null }) });
    const N1 = mk(sbOk, [{ id: 1, texto: 'vieja' }]);
    const okAlta = await N1.notaAltaImpl({ user_id: 'u', fecha_ny: HOY, texto: 'nueva', symbol: null, posicion_id: null });
    const lista1 = N1.__proto__ === undefined ? null : null;
    assert(okAlta === true && pintadas.length === 2, 'alta: se pinta en el acto (optimista) y otra vez con el id real');
    const ins = sbOk.llamadas.find(c => c.op === 'insert');
    assert(ins && ins.tabla === 'notas' && ins.args[0].user_id === 'u' && ins.args[0].texto === 'nueva', 'alta: insert en notas con user_id explícito');
    const sbMal = sbGrabador({ 'notas:insert': () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) });
    const lista2 = [{ id: 1, texto: 'vieja' }];
    const st2 = { lista: lista2, ts: 0, err: null, editando: null };
    const N2 = construir(['notaAltaImpl', 'notaCambioImpl', 'notaBajaImpl', 'notasAplicar', 'textoErrorNotas', 'textoErrorTabla'],
      { sb: sbMal, _notas: st2, pintarNotas: () => pintadas.push('p'), toast: (t) => toasts.push(t) });
    const r2 = await N2.notaAltaImpl({ user_id: 'u', fecha_ny: HOY, texto: 'x' });
    assert(r2 === false && st2.lista === lista2 && /No se guardó la nota/.test(toasts[toasts.length - 1]) && /migración pendiente/.test(toasts[toasts.length - 1]), 'alta con la base fallando: la lista VUELVE a la de antes y el toast dice por qué');
    const sbMal2 = sbGrabador({ 'notas:update': () => ({ error: { message: 'boom' } }), 'notas:delete': () => ({ error: null }) });
    const lista3 = [{ id: 1, texto: 'vieja' }, { id: 2, texto: 'otra' }];
    const st3 = { lista: lista3, ts: 0, err: null, editando: 1 };
    const N3 = construir(['notaAltaImpl', 'notaCambioImpl', 'notaBajaImpl', 'notasAplicar', 'textoErrorNotas', 'textoErrorTabla'],
      { sb: sbMal2, _notas: st3, pintarNotas: () => pintadas.push('p'), toast: (t) => toasts.push(t) });
    const r3 = await N3.notaCambioImpl(1, { texto: 'editada' });
    assert(r3 === false && st3.lista === lista3 && st3.lista[0].texto === 'vieja', 'editar con la base fallando: reversión al texto de antes');
    const r4 = await N3.notaBajaImpl(2);
    assert(r4 === true && st3.lista.length === 1 && st3.lista[0].id === 1, 'borrar: la nota desaparece de la lista y la base recibe el delete');
    const del = sbMal2.llamadas.find(c => c.op === 'delete');
    igual(del && del.filtros, [['eq', 'id', 2]], 'borrar: delete solo de ESA nota (por id; la RLS pone el user_id)');
    // v53: notaGuardar NO vacía el campo antes de que la base acepte; el borrador solo se limpia con la nota guardada
    const alm = {};
    const mkG = (okAlta) => {
      const pint = [];
      const G = construir(['notaGuardar', 'notaBorradorLeer', 'notaBorradorPoner', 'notaBorradorLimpiar'],
        { sesionActiva: { user: { id: 'u' } }, hoyNY, toast: () => {}, $: (s) => ({ '#nTexto': { value: 'una lección larga' }, '#nFecha': { value: HOY }, '#nSym': { value: 'SPY' }, '#nPos': { value: '' } }[s] || null),
          notaAltaImpl: async () => okAlta, pintarNotas: () => pint.push('p'), localStorage: { getItem: (k) => (k in alm ? alm[k] : null), setItem: (k, v) => { alm[k] = String(v); }, removeItem: (k) => { delete alm[k]; } } },
        'const _diario = { notaPre: { posicion_id: 1 }, borrador: null };\nconst NOTA_BORRADOR_K = "mz_nota_borrador";\n');
      G.notaBorradorPoner({ texto: 'una lección larga', symbol: 'SPY' });
      return { G, pint };
    };
    const g1 = mkG(false);
    await g1.G.notaGuardar();
    assert(g1.G.notaBorradorLeer().texto === 'una lección larga' && alm.mz_nota_borrador && g1.pint.length === 0, 'guardar con la base fallando: el texto sigue en el borrador (y en localStorage), nada se vacía');
    const g2 = mkG(true);
    await g2.G.notaGuardar();
    assert(g2.G.notaBorradorLeer() === null && !alm.mz_nota_borrador && g2.pint.length === 1, 'guardar con la base aceptando: el borrador se limpia y el bloque se repinta vacío');
  }
  // v53: GRAVE — la nota que se está escribiendo se borraba sola en cada redibujo (timer de 60 s, Realtime, vuelta del fondo)
  {
    const nodo = (id, tag, value) => ({ id, tagName: tag, value: value || '', selectionStart: 3, selectionEnd: 3, focos: 0, focus() { this.focos++; }, setSelectionRange(a, b) { this.sel = [a, b]; } });
    const ta = nodo('nTexto', 'TEXTAREA', 'a medio escribir');
    const vista = { innerHTML: '', hijos: [ta], contains(n) { return this.hijos.includes(n); } };
    const doc = { activeElement: ta, querySelector: (s) => (s === '#vista' ? vista : s === '#nTexto' ? vista.hijos[0] : null) };
    const U = construir(['diarioEnUso', 'pintarConservandoFoco'], { document: doc, $: doc.querySelector });
    assert(U.diarioEnUso() === true, 'diarioEnUso: un textarea con el foco dentro de #vista = Andrés está escribiendo');
    doc.activeElement = { tagName: 'BUTTON' };
    assert(U.diarioEnUso() === false, 'diarioEnUso: con el foco en un botón (o en nada) no está escribiendo');
    doc.activeElement = ta;
    const ta2 = nodo('nTexto', 'TEXTAREA', 'a medio escribir');
    Object.defineProperty(vista, 'innerHTML', { set(h) { this.h = h; this.hijos = [ta2]; }, get() { return this.h; } });
    U.pintarConservandoFoco(vista, '<textarea id="nTexto"></textarea>');
    assert(vista.h.includes('nTexto') && ta2.focos === 1 && JSON.stringify(ta2.sel) === '[3,3]', 'pintarConservandoFoco: tras reasignar innerHTML el foco y el cursor vuelven al campo con el mismo id');
    // vistaDiario ENTERA (real) con el foco en la nota: el redibujo automático se frena; el pedido (forzar) sigue
    let lecturas = 0, sincronizaciones = 0, cacheado = { estado: 'ok', fills: 12, cambio: false };
    const vista2 = { innerHTML: '', contains() { return false; } };
    const doc2 = { activeElement: ta, querySelector: (s) => (s === '#vista' ? vista2 : null) };
    vista2.contains = (n) => n === ta;
    const deps = {
      hoyNY, carteraDesdeCache() {}, sb: sbGrabador({}), document: doc2, $: doc2.querySelector,
      leerFillsTodos: async () => { lecturas++; return { filas: [], error: null }; }, notasCargar: async () => [],
      location: { hash: '#/cuentas' }, etCreds: () => ({ t: 'x' }), etDiaVencido: () => false, swCreds: () => null, swVencido: () => true,
      etradeSincronizar: async () => { sincronizaciones++; return cacheado; }, schwabSincronizar: async () => ({ estado: 'sin' }),
      TICKERS: ['AAPL'], periodoDiarioSel: () => ({ modo: 'todo' }), emparejarFillsFIFO: () => ({ cerradas: [], viajes: [], abiertos: [], huerfanas: [], vencidas: [] }), enPeriodoDiario: () => true,
      diaADia: () => [], metricasDiario: () => ({ total: 0, ops: 0, aciertos: 0, comisiones: 0, vencidas: 0, dias_operados: 0 }), resumenPorPeriodo: () => [],
      coberturaFills: () => [], brokersLeidos: () => [], itemsCartera: () => [], compararAbiertos: () => [], _cart: {}, resumenPeriodo: () => ({ util: 0 }), unirOperaciones: () => ({ ops: [] }), dineroD: () => '$0',
      selectorCuentas: () => '', seccionPeriodoDiario: () => '', tarjetasResumenDiario: () => '', seccionCoberturaDiario: () => '', seccionDiaADia: () => '', seccionResumenesDiario: () => '',
      seccionOperacionesDiario: () => '', seccionAbiertosDiario: () => '', seccionEjecucionesDiario: () => '', seccionNotasDiario: () => '<textarea id="nTexto"></textarea>', esc, _notas: { lista: [], editando: null, err: null },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };
    const W = construir(['vistaDiario', 'sincronizarLibroFondo', 'diarioEnUso', 'pintarConservandoFoco', 'diarioCapturarCampos', 'notaBorradorLeer', 'notaBorradorPoner'], deps,
      'let _cuentasVista = "diario"; const _diario = { gen: 0, brokerFiltro: "todos", masEjec: false, notaPre: null, syms: [], posic: [], fills: [], borrador: null, rangoTmp: null, enfocarNota: false }; const NOTA_BORRADOR_K = "k";\n');
    await W.vistaDiario();
    assert(lecturas === 0 && vista2.innerHTML === '', 'vistaDiario (timer/Realtime) con la nota enfocada: NO lee ni repinta nada');
    await W.vistaDiario(true);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert(lecturas === 1 && /nTexto/.test(vista2.innerHTML), 'vistaDiario(forzar) (un toque de Andrés) sí redibuja aunque el campo tenga el foco');
    // GRAVE: el bucle. Con la sincronización CACHEADA (fills: 12, cambio: false) una entrada = una lectura
    doc2.activeElement = null; lecturas = 0; sincronizaciones = 0;
    await W.vistaDiario();
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    igual([lecturas, sincronizaciones], [1, 1], 'una entrada al Diario con la sincronización cacheada (fills: 12, cambio: false) = UNA lectura del libro y UNA sincronización: ya no se muerde la cola');
    lecturas = 0; sincronizaciones = 0; let primera = true;
    deps.etradeSincronizar = async () => { sincronizaciones++; const r = primera ? { estado: 'ok', fills: 3, cambio: true } : { estado: 'ok', fills: 3, cambio: false }; primera = false; return r; };
    const W2 = construir(['vistaDiario', 'sincronizarLibroFondo', 'diarioEnUso', 'pintarConservandoFoco', 'diarioCapturarCampos', 'notaBorradorLeer', 'notaBorradorPoner'], deps,
      'let _cuentasVista = "diario"; const _diario = { gen: 0, brokerFiltro: "todos", masEjec: false, notaPre: null, syms: [], posic: [], fills: [], borrador: null, rangoTmp: null, enfocarNota: false }; const NOTA_BORRADOR_K = "k";\n');
    await W2.vistaDiario();
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
    igual([lecturas, sincronizaciones], [2, 2], 'con una sincronización REAL que trajo fills (cambio: true) se redibuja UNA vez más y para');
    assert(!/Number\(s\.fills\)/.test(extraer('sincronizarLibroFondo')) && /s && s\.cambio && enDiario\(\)/.test(extraer('sincronizarLibroFondo')), 'sincronizarLibroFondo solo mira `cambio` (nunca el `fills` del resumen cacheado)');
    // «Nota» desde el Copiloto: la preselección se consume en el primer pintado (no vuelve a saltar cada 60 s)
    const almN = {};
    const deps3 = { ...deps, etradeSincronizar: async () => ({ estado: 'sin' }), localStorage: { getItem: (k) => (k in almN ? almN[k] : null), setItem: (k, v) => { almN[k] = String(v); }, removeItem: (k) => { delete almN[k]; } } };
    const ta3 = nodo('nTexto', 'TEXTAREA', ''); ta3.scrollIntoView = function () { this.scrolls = (this.scrolls || 0) + 1; };
    deps3.document = { activeElement: null, querySelector: (s) => (s === '#vista' ? vista2 : s === '#nTexto' ? ta3 : null) }; deps3.$ = deps3.document.querySelector;
    const W3 = construir(['vistaDiario', 'sincronizarLibroFondo', 'diarioEnUso', 'pintarConservandoFoco', 'diarioCapturarCampos', 'notaBorradorLeer', 'notaBorradorPoner'], deps3,
      'let _cuentasVista = "diario"; const _diario = { gen: 0, brokerFiltro: "todos", masEjec: false, notaPre: { posicion_id: 7, symbol: "META", fecha: "2026-09-25" }, syms: [], posic: [], fills: [], borrador: null, rangoTmp: null, enfocarNota: false }; const NOTA_BORRADOR_K = "k";\nconst __d = () => _diario;\n', );
    await W3.vistaDiario(); await W3.vistaDiario(); await W3.vistaDiario();
    assert(ta3.focos === 1 && ta3.scrolls === 1 && W3.notaBorradorLeer().posicion_id === 7 && W3.notaBorradorLeer().symbol === 'META', '«Nota» del Copiloto: se enfoca y se centra UNA sola vez; la posición y el ticker quedan en el borrador para los redibujos siguientes');
    // v53: diarioCapturarCampos — lo que HAY en el campo pasa al borrador antes de repintar aunque ningún `input` lo avisara (dictado, autocorrección, pegar)
    ta3.value = 'dictado sin evento input';
    await W3.vistaDiario(true);
    assert(W3.notaBorradorLeer().texto === 'dictado sin evento input' && W3.notaBorradorLeer().posicion_id === 7 && /dictado sin evento input/.test(almN.k || ''), 'diarioCapturarCampos: el texto que había en #nTexto queda en el borrador (y en localStorage) antes del repintado, y la posición preseleccionada no se pierde');
  }

  // ════════════════ 5. CARTERA DE TASTYTRADE en el Copiloto (foto del worker) ════════════════
  const claveCartera = construir(['claveCartera', 'claveContrato']).claveCartera;
  const T = construir(['normalizarPosBroker', 'claveCartera', 'claveContrato']);
  const FOTO = [
    { user_id: 'u', broker: 'tasty', clave: 'NVDA  261016C00180000', symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-16', contratos: 2, costo_promedio: 1.5, mark: 1.8, mark_fuente: 'vivo', valor_usd: 360, pl_usd: 60, pl_pct: 20, origen: 'worker', actualizado_at: '2026-09-25T13:00:00Z' },
    { user_id: 'u', broker: 'tasty', clave: 'SPY   261002P00600000', symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: '2026-10-02', contratos: -1, costo_promedio: 3, mark: 2.5, origen: 'worker', actualizado_at: '2026-09-25T13:00:00Z' },
    { user_id: 'u', broker: 'tasty', clave: 'META  261016P00700000', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, costo_promedio: 5, mark: 4.9, mark_fuente: 'cierre_previo', valor_usd: null, pl_usd: null, pl_pct: null, origen: 'worker', actualizado_at: '2026-09-25T12:00:00Z' },
  ];
  const nb = T.normalizarPosBroker(FOTO, 'tasty');
  igual([nb.items.length, nb.otros.vendidas, nb.foto_at, nb.origen], [2, 1, '2026-09-25T13:00:00Z', 'worker'], 'normalizarPosBroker: la corta (contratos negativos) se cuenta aparte; la foto lleva su sello más reciente');
  const n0 = nb.items[0];
  igual([n0.broker, n0.symbol, n0.direccion, n0.strike, n0.expiracion, n0.contratos, n0.prima_fill, n0.mark, n0.valor_actual, n0.pnl_usd, n0.invertido, n0.origen_invertido, n0.clave, n0.osi, n0.mark_fuente],
    ['tasty', 'NVDA', 'CALL', 180, '2026-10-16', 2, 1.5, 1.8, 360, 60, 300, 'broker', 'tasty|NVDA|CALL|180|2026-10-16', 'NVDA  261016C00180000', 'vivo'], 'normalizarPosBroker: el MISMO shape que E*TRADE/Schwab (v50), con el OSI como clave del bróker');
  const n1 = nb.items[1];
  igual([n1.invertido, n1.origen_invertido, n1.valor_actual, n1.mark_fuente, n1.abierta_estimada], [500, 'calculado', null, 'cierre_previo', true], 'normalizarPosBroker: sin valor/P&L del bróker el invertido sale del costo y queda marcado; el mark de ayer viaja como cierre_previo');
  {
    const mk = (resp) => construir(['leerCarteraTasty', 'normalizarPosBroker', 'claveCartera', 'claveContrato', 'textoErrorTabla'], { sb: sbGrabador(resp), FOTO_VIEJA_MS: 3 * 3600000 });
    const ahoraIso = new Date().toISOString();
    const rOk = await mk({ 'posiciones_broker:select': () => ({ data: FOTO.map(f => ({ ...f, actualizado_at: ahoraIso })), error: null }) }).leerCarteraTasty();
    assert(rOk.estado === 'ok' && rOk.items.length === 2 && rOk.vieja === false && rOk.origen === 'worker', 'leerCarteraTasty: lee posiciones_broker (broker=tasty) y entrega la cartera con estado ok');
    const rVacia = await mk({ 'posiciones_broker:select': () => ({ data: [], error: null }) }).leerCarteraTasty();
    igual(rVacia.estado, 'sin_foto', 'leerCarteraTasty: sin filas NO se afirma «no tienes nada»: estado sin_foto');
    const rVieja = await mk({ 'posiciones_broker:select': () => ({ data: FOTO, error: null }) }).leerCarteraTasty();
    assert(rVieja.estado === 'ok' && rVieja.vieja === true, 'leerCarteraTasty: una foto de hace más de 3 h queda marcada VIEJA');
    const rErr = await mk({ 'posiciones_broker:select': () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) }).leerCarteraTasty();
    assert(rErr.estado === 'error' && /posiciones_broker/.test(rErr.detalle), 'leerCarteraTasty: sin la tabla (0014) se dice, no se revienta');
    const rCierre = await mk({ 'posiciones_broker:select': () => ({ data: [{ ...FOTO[2], actualizado_at: ahoraIso }], error: null }) }).leerCarteraTasty();
    assert(rCierre.cierre_previo === true, 'leerCarteraTasty: si todos los marks son el cierre de ayer, la cartera lo dice');
  }
  // casar, adoptar y la tarjeta con tasty
  const C = construir(['casarCarteraLibro', 'claveCartera', 'claveContrato', 'brokersLeidos', 'itemsCartera', 'carteraLeidaAt'], { CART_FRESCO_MS: 30 * 60000 });
  const cartT = { etrade: { estado: 'sin', items: [] }, schwab: { estado: 'sin', items: [] }, tasty: { estado: 'ok', items: nb.items, otros: nb.otros, ts: Date.now(), vieja: false } };
  igual(C.brokersLeidos(cartT), ['tasty'], 'brokersLeidos: tasty entra como tercer bróker cuando su foto es fresca');
  igual(C.brokersLeidos({ ...cartT, tasty: { ...cartT.tasty, vieja: true } }), [], 'brokersLeidos: una foto VIEJA del worker no vale para acusar a nadie');
  igual(C.itemsCartera(cartT).map(i => i.symbol), ['NVDA', 'META'], 'itemsCartera: los ítems de tasty entran en la cartera');
  const libroT = [{ id: 1, estado: 'abierta', broker: 'tasty', symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-16', contratos: 2, prima_fill: 1.5 },
    { id: 2, estado: 'abierta', broker: 'tasty', symbol: 'AMD', direccion: 'CALL', strike: 200, expiracion: '2026-10-16', contratos: 1, prima_fill: 2 }];
  const cas = C.casarCarteraLibro(C.itemsCartera(cartT), libroT, C.brokersLeidos(cartT));
  igual([cas.enAmbos.length, cas.soloBroker.map(b => b.symbol), cas.soloLibro.map(p => p.symbol)], [1, ['META'], ['AMD']], 'casar con tasty: la NVDA casa, la META está en tasty sin ficha, la AMD ya no está en tasty');
  const casVieja = C.casarCarteraLibro([], libroT, C.brokersLeidos({ ...cartT, tasty: { ...cartT.tasty, vieja: true } }));
  igual([casVieja.soloLibro.length, casVieja.noComprobadas.length], [0, 2], 'con la foto vieja las fichas de tasty quedan «sin comprobar», nunca «ya no está»');
  // v53: una ficha registrada DESPUÉS de la foto del worker no se acusa con un dato anterior a ella
  const fotoAt = new Date(Date.now() - 14 * 60000).toISOString();
  const libroPost = libroT.concat([{ id: 3, estado: 'abierta', broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-16', contratos: 1, prima_fill: 3, abierta_at: new Date(Date.now() - 60000).toISOString() }]);
  const casPost = C.casarCarteraLibro(C.itemsCartera(cartT), libroPost, ['tasty'], { tasty: fotoAt });
  igual([casPost.soloLibro.map(p => p.symbol), casPost.noComprobadas.map(x => [x.pos.symbol, x.motivo])], [['AMD'], [['TSLA', 'foto_anterior']]], 'casar: la TSLA registrada hace 1 min (foto de hace 14) queda «foto_anterior», no «ya no está»; la AMD vieja sí se acusa');
  const libroRef = [{ ...libroT[0] }, { ...libroT[0], id: 5, contratos: 1, abierta_at: new Date(Date.now() - 60000).toISOString() }];
  const casRef = C.casarCarteraLibro(C.itemsCartera(cartT), libroRef, ['tasty'], { tasty: fotoAt });
  assert(casRef.enAmbos.length === 2 && casRef.enAmbos[0].dif === 0 && casRef.enAmbos[0].posteriores === 1, 'casar: un refuerzo registrado después de la foto no dispara «el bróker dice ×2 y tu libro ×3» (dif 0, se comprueba en la próxima)');
  assert(C.casarCarteraLibro(C.itemsCartera(cartT), libroPost, ['tasty']).soloLibro.length === 2, 'sin `fotos` (E*TRADE/Schwab, lectura en vivo) todo sigue igual: la ausencia sí se afirma');
  const A = construir(['filaAdopcion', 'adoptarDecide', 'claveCartera', 'claveContrato'], { hoyNY, ymdNY });
  const fa = A.filaAdopcion(nb.items[1], PLANES.PLAN_10, 'uid-1', HOY);
  igual([fa.broker, fa.symbol, fa.direccion, fa.strike, fa.expiracion, fa.contratos, fa.prima_fill, fa.plan_pct, fa.stop_pct, fa.abierta_fecha_ny, fa._estimada, fa.mark], ['tasty', 'META', 'PUT', 700, '2026-10-16', 1, 5, 10, 20, HOY, true, 4.9], 'adoptar una de tasty: la misma ficha que E*TRADE/Schwab, con el plan congelado, HOY como apertura (estimada) y el mark del bróker');
  igual(A.adoptarDecide(nb.items[0], libroT).accion, 'existe', 'adoptar es idempotente también con tasty: si ya hay ficha abierta no se crea otra');
  igual(A.adoptarDecide(nb.items[1], libroT).accion, 'insertar', '…y si no la hay, se inserta');
  const S = construir(['tarjetaSinRegistrar', 'textoVencimiento', 'diasAlVencimiento', 'durTxt'], { esc, usd, colUtil, BROKER_NOMBRE, hoyNY, haceCuanto });
  const hT = S.tarjetaSinRegistrar(nb.items[1], PLANES.PLAN_10, HOY, { viejo: false, txt: '' });
  assert(/vende en tu bróker/.test(hT) && /cierre de ayer/.test(hT) && /foto del worker de hace/.test(hT) && /MZ\.adoptar\(/.test(hT), 'tarjeta SIN REGISTRAR de tasty: Adoptar, «vende en tu bróker», la antigüedad de la foto y «cierre de ayer»');
  const hTv = S.tarjetaSinRegistrar(nb.items[1], PLANES.PLAN_10, HOY, { viejo: true, fotoVieja: true, txt: 'hace 26 h' });
  assert(!/MZ\.adoptar\(/.test(hTv) && /foto del worker de hace 26 h: no se adopta hasta que la refresque/.test(hTv), 'v53: con la foto del worker VIEJA no se ofrece Adoptar y se dice por qué');
  {
    const pasos = [];
    const AD = construir(['adoptar'], { buscarItemCartera: () => ({ ...nb.items[0], clave: 'tasty|NVDA|CALL|180|2026-10-16' }), _cart: { tasty: { estado: 'ok', ts: Date.now(), vieja: true, foto_at: new Date(Date.now() - 26 * 3600000).toISOString() } },
      toast: (t) => pasos.push('toast:' + t), BROKER_NOMBRE, haceCuanto, CART_FRESCO_MS: 30 * 60000, cargarCartera: () => { pasos.push('cargar'); return Promise.resolve(); }, ruta: () => pasos.push('ruta'), $: () => { pasos.push('modal'); return null; } });
    AD.adoptar('tasty|NVDA|CALL|180|2026-10-16');
    assert(pasos.length === 1 && /foto del worker de tastytrade es de hace 26 h: no se adopta/.test(pasos[0]), 'v53: adoptar() con la foto vieja frena con un toast antes de abrir el cuadro (aunque `ts` sea de ahora)');
    assert(/if \(lec && lec\.vieja\) \{/.test(extraer('adoptarConfirmar')) && /no se adopta hasta que la refresque/.test(extraer('adoptarConfirmar')), 'v53: la misma puerta en adoptarConfirmar (el cuadro pudo quedarse abierto)');
  }
  const P = construir(['tarjetaPosicion', 'pnlVivo', 'corteTocado', 'corteDe', 'gtcDePosicion', 'gtcLimite', 'fmtPrima', 'preSalida', 'lineasCartera', 'margenHasta', 'diasAlVencimiento', 'textoVencimiento', 'durTxt', 'planDePct'],
    { esc, usd, colUtil, BROKER_NOMBRE, hoyNY, haceCuanto, PLANES, PLAN_PCT: 35 });
  const posTasty = { id: 7, estado: 'abierta', broker: 'tasty', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, prima_fill: 5, gtc_limite: 5.52, plan_pct: 10, stop_pct: 20, mark: 4.9, mark_at: new Date().toISOString() };
  const hPT = P.tarjetaPosicion(posTasty, nb.items[1], HOY, null);
  assert(/vende en tu bróker/.test(hPT) && !/MZ\.cortarPosicion/.test(hPT) && !/MZ\.abrirOrden/.test(hPT), 'tarjeta de una posición de tasty: dice «vende en tu bróker» donde v50 pone Cortar y NO ofrece órdenes');
  assert(/MZ\.notaDePosicion\(7, 'META'\)/.test(hPT), 'la tarjeta de posición lleva el enlace «Nota» que abre el Diario con esa posición');
  assert(/mark = cierre de ayer/.test(hPT), 'y con un mark de cierre_previo lo dice: no es precio de ahora');
  const hPE = P.tarjetaPosicion({ ...posTasty, broker: 'etrade' }, null, HOY, null);
  assert(/MZ\.cortarPosicion\(7\)/.test(hPE) && /MZ\.abrirOrden/.test(hPE) && !/vende en tu bróker/.test(hPE), 'lo de siempre no cambia: en E*TRADE sigue el Cortar y las órdenes');
  // seccionPosiciones con los tres brókeres
  const SP = construir(['seccionPosiciones', 'barraTotales', 'totalesCartera', 'itemsCartera', 'brokersLeidos', 'casarCarteraLibro', 'claveCartera', 'claveContrato', 'textoLecturaBroker',
    'lineaDifContratos', 'tarjetaSinRegistrar', 'tarjetaSoloLibro', 'diasAlVencimiento', 'textoVencimiento', 'durTxt', 'carteraLeidaAt', 'haceCuanto', 'tarjetaFotoConocida'],
    { esc, usd, colUtil, BROKER_NOMBRE, hoyNY, CART_FRESCO_MS: 30 * 60000, tarjetaPosicion: (p) => `<div class="card">POS ${p.symbol}</div>`, brokersOperables: () => ['etrade'] });
  const h3 = SP.seccionPosiciones(libroT, { etrade: { estado: 'ok', items: [], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] }, tasty: { ...cartT.tasty, foto_at: new Date(Date.now() - 120000).toISOString(), cierre_previo: false } }, PLANES.PLAN_10, HOY);
  assert(/CARTERA ABIERTA · TASTYTRADE/.test(h3) && /foto del worker de hace 2 min/.test(h3) && /SIN REGISTRAR/.test(h3) && /YA NO ESTÁ EN EL BRÓKER/.test(h3), 'Copiloto: la cartera de tasty entra como tercer bróker (totales, foto fechada, sin registrar, ya no está)');
  const h3v = SP.seccionPosiciones(libroT, { etrade: { estado: 'sin', items: [] }, schwab: { estado: 'sin', items: [] }, tasty: { ...cartT.tasty, vieja: true, foto_at: new Date(Date.now() - 26 * 3600000).toISOString(), cierre_previo: false } }, PLANES.PLAN_10, HOY);
  assert(/VIEJA/.test(h3v) && /SIN REGISTRAR/.test(h3v) && !/MZ\.adoptar\(/.test(h3v) && /no se adopta hasta que la refresque/.test(h3v) && !/YA NO ESTÁ EN EL BRÓKER/.test(h3v), 'v53 Copiloto: con la foto del worker de hace 26 h la sección dice VIEJA, NO ofrece Adoptar y no acusa a nadie');
  const h3p = SP.seccionPosiciones(libroPost, { etrade: { estado: 'sin', items: [] }, schwab: { estado: 'sin', items: [] }, tasty: { ...cartT.tasty, foto_at: fotoAt, cierre_previo: false } }, PLANES.PLAN_10, HOY);
  assert(/1 ficha registrada después de la última foto del worker/.test(h3p) && (h3p.match(/YA NO ESTÁ EN EL BRÓKER/g) || []).length === 1 && !/Registrar salida[\s\S]*TSLA|TSLA[\s\S]*?YA NO ESTÁ/.test(h3p.split('POS TSLA')[1] || ''), 'v53 Copiloto: la ficha posterior a la foto se dice como «se comprueba en la próxima foto» y solo la AMD sale como «ya no está»');
  const h4 = SP.seccionPosiciones([], { etrade: { estado: 'ok', items: [], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] }, tasty: { estado: 'sin_foto', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/sin filas en la foto del worker/.test(h4) && !/Volver a preguntar/.test(h4.split('sin filas')[1] || '') && /E\*TRADE confirma que no hay ninguna/.test(h4), 'tasty sin foto: se dice DISCRETO (sin botón rojo) y no se afirma nada; E*TRADE sí confirma vacío');
  const fotoEt = { items: [{ ...n0, broker: 'etrade', clave: 'etrade|NVDA|CALL|180|2026-10-16' }], at: new Date(Date.now() - 5 * 3600000).toISOString(), leida: Date.now() };
  const h5 = SP.seccionPosiciones([], { etrade: { estado: 'sesion', items: [], ts: Date.now(), foto: fotoEt }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/ÚLTIMA LECTURA CONOCIDA DE E\*TRADE/.test(h5) && /ÚLTIMA FOTO/.test(h5) && /de hace 5 h/.test(h5) && !/MZ\.adoptar\(/.test(h5) && /lo que se vendió o venció después no aparece/.test(h5), 'sin sesión aquí: la última foto conocida sale fechada, sin Adoptar y sin afirmar nada de lo que pasó después');

  // ════════════════ 6. FOTO DEL DISPOSITIVO → posiciones_broker (sin tocar origen worker) ════════════════
  const osiDe = construir(['osiDe']).osiDe;
  const FD = construir(['fotoFilaDe', 'escribirFotoDispositivo', 'textoErrorTabla'], { osiDe, sb: null });
  const itEt = { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, prima_fill: 3.3, mark: 3.4, valor_actual: 680, pnl_usd: 20, pnl_pct: 3.03, clave: 'etrade|SPY|CALL|769|2026-09-26' };
  const ff = FD.fotoFilaDe(itEt, '2026-09-25T14:00:00.000Z', 'uid-1', true);
  igual(ff, { user_id: 'uid-1', broker: 'etrade', clave: 'SPY   260926C00769000', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, costo_promedio: 3.3, mark: 3.4, mark_fuente: 'vivo', valor_usd: 680, pl_usd: 20, pl_pct: 3.03, origen: 'dispositivo', actualizado_at: '2026-09-25T14:00:00.000Z' }, 'fotoFilaDe: fila de posiciones_broker (0014) con clave OSI, origen dispositivo y el sello');
  igual(FD.fotoFilaDe(itEt, 's', 'u', false).mark_fuente, 'cierre_previo', 'fotoFilaDe: con el mercado cerrado el mark del bróker es el cierre previo y así se guarda');
  igual(FD.fotoFilaDe({ ...itEt, osi: 'SPY   260926C00769000' }, 's', 'u', true).clave, 'SPY   260926C00769000', 'fotoFilaDe: Schwab trae su OSI y se respeta como clave');
  igual(FD.fotoFilaDe({ ...itEt, strike: null }, 's', 'u', true), null, 'fotoFilaDe: sin strike no hay fila (no se inventa)');
  {
    const sb = sbGrabador({ 'posiciones_broker:upsert': () => ({ error: null }), 'posiciones_broker:delete': () => ({ error: null }) });
    const E = construir(['fotoFilaDe', 'escribirFotoDispositivo', 'textoErrorTabla'], { osiDe, sb });
    const r = await E.escribirFotoDispositivo('etrade', { estado: 'ok', items: [itEt], otros: { ilegibles: 0 }, truncada: false }, 'uid-1', true);
    assert(r.escrito === true && r.filas === 1, 'escribirFotoDispositivo: escribe la foto tras una lectura completa');
    const up = sb.llamadas.find(c => c.op === 'upsert'), del = sb.llamadas.find(c => c.op === 'delete');
    assert(up && up.tabla === 'posiciones_broker' && up.args[1].onConflict === 'user_id,broker,clave' && up.args[0][0].actualizado_at === r.sello, 'patrón del worker (1): upsert con el MISMO sello en todas las filas');
    assert(sb.llamadas.indexOf(up) < sb.llamadas.indexOf(del), 'patrón del worker (2): el delete va DESPUÉS del upsert (nunca un instante con la cartera vacía)');
    igual(del.filtros, [['eq', 'user_id', 'uid-1'], ['eq', 'broker', 'etrade'], ['eq', 'origen', 'dispositivo'], ['lt', 'actualizado_at', r.sello]], 'patrón del worker (3): borra SOLO ese bróker, SOLO origen dispositivo y SOLO sello anterior — jamás toca origen worker');
    const sbMal = sbGrabador({ 'posiciones_broker:upsert': () => ({ error: { message: 'boom' } }), 'posiciones_broker:delete': () => ({ error: null }) });
    const E2 = construir(['fotoFilaDe', 'escribirFotoDispositivo', 'textoErrorTabla'], { osiDe, sb: sbMal });
    const r2 = await E2.escribirFotoDispositivo('etrade', { estado: 'ok', items: [itEt], otros: {}, truncada: false }, 'uid-1', true);
    assert(r2.escrito === false && !sbMal.llamadas.some(c => c.op === 'delete'), 'si el upsert falla NO se borra nada: la foto anterior se queda con su fecha');
    const sb3 = sbGrabador({});
    const E3 = construir(['fotoFilaDe', 'escribirFotoDispositivo', 'textoErrorTabla'], { osiDe, sb: sb3 });
    const r3 = await E3.escribirFotoDispositivo('etrade', { estado: 'ok', items: [itEt], otros: {}, truncada: true }, 'uid-1', true);
    const r4 = await E3.escribirFotoDispositivo('etrade', { estado: 'ok', items: [itEt], otros: { ilegibles: 1 }, truncada: false }, 'uid-1', true);
    const r5 = await E3.escribirFotoDispositivo('etrade', { estado: 'sin_red', items: [], otros: null }, 'uid-1', true);
    assert(!r3.escrito && !r4.escrito && !r5.escrito && sb3.llamadas.length === 0, 'una lectura truncada, con ilegibles o fallida NO escribe ni borra: una foto a medias borraría posiciones reales');
    const r6 = await E3.escribirFotoDispositivo('etrade', { estado: 'ok', items: [], otros: { ilegibles: 0 }, truncada: false }, 'uid-1', true);
    assert(r6.escrito && r6.filas === 0 && sb3.llamadas.length === 1 && sb3.llamadas[0].op === 'delete', 'cartera vacía LEÍDA completa = foto vacía legítima: solo se limpia lo viejo (de este bróker y origen dispositivo)');
    const r7 = await E3.escribirFotoDispositivo('schwab', { estado: 'ok', items: [itEt], otros: {}, truncada: false }, 'uid-1', true);
    assert(r7.escrito && r7.filas === 0, 'la foto de un bróker solo lleva SUS ítems (uno de E*TRADE no se cuela en la de Schwab)');
    // v53: el sello es la hora de la LECTURA del bróker, no la de la escritura
    const r8 = await E3.escribirFotoDispositivo('etrade', { estado: 'ok', items: [itEt], otros: {}, truncada: false, ts: Date.parse('2026-09-25T14:00:00Z') }, 'uid-1', true);
    igual(r8.sello, '2026-09-25T14:00:00.000Z', 'v53: la foto se sella con la hora en que se LEYÓ la cartera (otro equipo no verá «hace segundos» sobre datos de hace 15 min)');
    // v53: si el delete de la foto anterior falla, se reintenta en la siguiente pasada aunque nada haya cambiado
    let deletes = 0;
    const sbR = sbGrabador({ 'posiciones_broker:upsert': () => ({ error: null }), 'posiciones_broker:delete': () => ({ error: deletes++ === 0 ? { message: 'timeout' } : null }) });
    const cartR = { etrade: { estado: 'ok', items: [itEt], otros: { ilegibles: 0 }, truncada: false, ts: Date.parse('2026-09-25T14:00:00Z') }, schwab: null };
    const fotoR = { firma: {}, ts: {}, sello: {}, pendienteBorrar: {}, err: null };
    const FS = construir(['fotoDispositivoSincronizar', 'escribirFotoDispositivo', 'fotoFilaDe', 'textoErrorTabla'],
      { osiDe, sb: sbR, sesionActiva: { user: { id: 'uid-1' } }, _cart: cartR, _foto: fotoR, CART_TTL_CERRADO: 15 * 60000, FOTO_MIN_MS: 5 * 60000, normalizarPosBroker: () => ({ items: [], foto_at: null }) });
    await FS.fotoDispositivoSincronizar(true);
    assert(fotoR.pendienteBorrar.etrade === '2026-09-25T14:00:00.000Z' && sbR.llamadas.filter(c => c.op === 'upsert').length === 1, 'delete fallido tras el upsert: queda anotado como pendiente (la foto se subió igual)');
    await FS.fotoDispositivoSincronizar(true);
    assert(!fotoR.pendienteBorrar.etrade && sbR.llamadas.filter(c => c.op === 'delete').length === 2 && sbR.llamadas.filter(c => c.op === 'upsert').length === 1, 'en la siguiente pasada se reintenta SOLO el delete (mismo sello, sin volver a subir la foto: la lectura no avanzó)');
  }

  // ════════════════ 7. ÓRDENES VIVAS DEL BRÓKER puestas fuera de la Mesa ════════════════
  const O = construir(['normalizarOrdenVivaEtrade', 'normalizarOrdenVivaSchwab', 'ordenesFueraMesa', 'tarjetaOrdenFuera', 'accionOrdenTexto'], { desOsi, esc, BROKER_NOMBRE, fmtFechaNY, ACCION_ORDEN_ES: constante('ACCION_ORDEN_ES'), ORD_VIVOS_SCHWAB: constante('ORD_VIVOS_SCHWAB') });
  const oET = { orderId: 501, OrderDetail: [{ status: 'OPEN', orderTerm: 'GOOD_UNTIL_CANCEL', priceType: 'LIMIT', limitPrice: 4.45, placedTime: Date.parse('2026-09-25T13:40:00Z'),
    Instrument: [{ orderAction: 'SELL_CLOSE', orderedQuantity: 2, filledQuantity: 0, Product: { symbol: 'SPY', securityType: 'OPTN', callPut: 'CALL', strikePrice: 769, expiryYear: 2026, expiryMonth: 9, expiryDay: 26 } }] }] };
  const vET = O.normalizarOrdenVivaEtrade(oET);
  igual([vET.broker, vET.orderId, vET.status, vET.symbol, vET.direccion, vET.strike, vET.expiracion, vET.accion, vET.cantidad, vET.price_type, vET.limit_price, vET.order_term], ['etrade', '501', 'OPEN', 'SPY', 'CALL', 769, '2026-09-26', 'SELL_CLOSE', 2, 'LIMIT', 4.45, 'GOOD_UNTIL_CANCEL'], 'E*TRADE: una orden OPEN se normaliza (contrato, acción, cantidad, precio, tipo, vigencia)');
  igual(O.normalizarOrdenVivaEtrade({ orderId: 502, OrderDetail: [{ status: 'EXECUTED' }] }), null, 'E*TRADE: una ejecutada no es una orden viva');
  const oSW = { orderId: 9007, status: 'WORKING', orderType: 'LIMIT', price: 2.5, duration: 'GOOD_TILL_CANCEL', enteredTime: '2026-09-25T13:41:00+0000', quantity: 1, filledQuantity: 0,
    orderLegCollection: [{ instruction: 'SELL_TO_CLOSE', quantity: 1, instrument: { assetType: 'OPTION', symbol: OSI } }] };
  const vSW = O.normalizarOrdenVivaSchwab(oSW);
  igual([vSW.broker, vSW.orderId, vSW.status, vSW.symbol, vSW.direccion, vSW.strike, vSW.expiracion, vSW.accion, vSW.cantidad, vSW.limit_price, vSW.order_term], ['schwab', '9007', 'WORKING', 'NVDA', 'CALL', 180, '2026-10-16', 'SELL_TO_CLOSE', 1, 2.5, 'GOOD_TILL_CANCEL'], 'Schwab: una orden WORKING se normaliza desde el OSI');
  igual([O.normalizarOrdenVivaSchwab({ ...oSW, status: 'FILLED' }), O.normalizarOrdenVivaSchwab({ ...oSW, status: 'PENDING_CANCEL' }).status], [null, 'CANCEL_REQUESTED'], 'Schwab: FILLED no es viva; PENDING_CANCEL se ve como CANCELANDO');
  const fuera = O.ordenesFueraMesa([vET, vSW], [{ broker: 'etrade', orden_id_ext: '501', estado: 'enviada' }]);
  igual(fuera.map(v => v.broker + ':' + v.orderId), ['schwab:9007'], 'ordenesFueraMesa: la que la Mesa conoce (bitácora, cualquier estado) NO es «fuera de la Mesa»; la otra sí');
  igual(O.ordenesFueraMesa([vET], [{ broker: 'etrade', orden_id_ext: 501, estado: 'cancelada' }]).length, 0, 'ordenesFueraMesa: el id se compara como texto y en cualquier estado');
  const hF = O.tarjetaOrdenFuera(vSW);
  assert(/PUESTA FUERA DE LA MESA/.test(hF) && /NVDA CALL 180/.test(hF) && /vender para cerrar ×1/.test(hF) && /límite \$2\.50 · GTC · #9007/.test(hF) && /MZ\.cancelarOrdenFuera\('schwab', '9007'\)/.test(hF) && /Charles Schwab/.test(hF), 'tarjeta: contrato, acción EN CLARO («vender para cerrar»), cantidad, precio, tipo, vigencia y su Cancelar');
  igual([O.accionOrdenTexto('SELL_CLOSE'), O.accionOrdenTexto('BUY_TO_OPEN'), O.accionOrdenTexto('RARA_X')], ['vender para cerrar', 'comprar para abrir', 'rara x'], 'la acción del bróker se traduce; lo desconocido sale en minúsculas');
  assert(/if \(idsR && idsR\.error\) \{/.test(extraer('ordenesActualizar')) && /se recalculan en la próxima/.test(extraer('ordenesActualizar')), 'v53: si la lectura de TODA la bitácora falla, las «puestas fuera de la Mesa» no se recalculan con solo las activas');
  assert(!/MZ\.cancelarOrdenFuera/.test(O.tarjetaOrdenFuera({ ...vSW, status: 'CANCEL_REQUESTED' })) && /CANCELANDO/.test(O.tarjetaOrdenFuera({ ...vSW, status: 'CANCEL_REQUESTED' })), 'una cancelación ya pedida no ofrece cancelar otra vez');
  assert(!/abrirOrden|ordenPlace|editar|replicar/i.test(hF.replace(/no se edita ni se replica/, '')), 'nada más: no se edita ni se replica (solo Cancelar)');
  assert(/if \(id != null\) await marcarCancelando\(id, C\);/.test(FUENTE) && /else fueraMarcarCancelando\('etrade', orderId\)/.test(FUENTE) && /else fueraMarcarCancelando\('schwab', orderId\)/.test(FUENTE), 'cancelar una puesta fuera pasa por cancelarOrden/cancelarOrdenSchwab (misma confirmación) sin tocar una fila que no existe');
  assert(/function cancelarOrdenFuera\(broker, orderId\) \{\n  if \(broker === 'schwab'\) return cancelarOrdenSchwab\(null, orderId\);\n  return cancelarOrden\(null, orderId, 'etrade'\);/.test(FUENTE), 'cancelarOrdenFuera reutiliza las cancelaciones de siempre (con su confirm)');

  // ════════════════ 8. TICKERS editables ════════════════
  const K = construir(['tickersOperables', 'textoErrorTickers', 'simboloTicker'], { TICKER_RE: constante('TICKER_RE') });
  // v53: la MISMA forma que exige el worker (^[A-Z][A-Z0-9.]{0,9}$, acotada a 6): «$SPX» y «.» ya no entran; BRK.B y X1 sí
  igual(K.tickersOperables([{ symbol: '$SPX', rol: 'operable', activo: true, orden: 1 }, { symbol: '.', rol: 'operable', activo: true, orden: 2 }, { symbol: 'BRK.B', rol: 'operable', activo: true, orden: 3 }, { symbol: 'X1', rol: 'operable', activo: true, orden: 4 }], []), ['BRK.B', 'X1'], 'tickersOperables: rechaza lo que el worker descartaría ($SPX, .) y acepta lo que él acepta (BRK.B, X1)');
  igual([K.simboloTicker(' $spx '), K.simboloTicker('meta')], ['SPX', 'META'], 'simboloTicker: recorta el $ de tasty/TOS y pone mayúsculas');
  const CAT = [{ symbol: 'SPY', nombre: 'S&P', rol: 'operable', activo: true, orden: 4 }, { symbol: 'AAPL', rol: 'operable', activo: true, orden: 1 }, { symbol: 'MERCADO', rol: 'global', activo: true, orden: 0 },
    { symbol: 'TSLA', rol: 'operable', activo: false, orden: 2 }, { symbol: 'META', rol: 'operable', activo: null, orden: 5 }, { symbol: 'NVDA', rol: 'operable', activo: true, orden: 3 }, { symbol: 'aapl', rol: 'operable', activo: true, orden: 9 }];
  igual(K.tickersOperables(CAT, ['X']), ['AAPL', 'NVDA', 'SPY', 'META'], 'tickersOperables: rol operable y activo (null cuenta como activo), por orden, sin repetidos; el global no entra');
  igual(K.tickersOperables([], ['AAPL', 'TSLA']), ['AAPL', 'TSLA'], 'tickersOperables: catálogo vacío → el respaldo');
  igual(K.tickersOperables(null, ['A']), ['A'], 'tickersOperables: catálogo nulo → el respaldo');
  assert(/0017/.test(K.textoErrorTickers({ code: '42501', message: 'new row violates row-level security policy for table "tickers"' })), 'sin la policy adm_ins (0017) el error se dice claro');
  assert(/ya existe/.test(K.textoErrorTickers({ code: '23505', message: 'duplicate key' })), 'un duplicado se dice como «ya existe»');
  {
    const mk = (sb, filasIni) => {
      const cuerpo = 'let TICKERS = TICKERS_RESPALDO.slice();\nconst TICKER_RE = ' + String(constante('TICKER_RE')) + ';\n' + extraer('tickersOperables') + '\n' + extraer('cargarTickers') + '\nreturn { cargarTickers, lista: () => TICKERS };';
      return new Function('sb', '_tickers', 'TICKERS_RESPALDO', cuerpo)(sb, { filas: filasIni || null, ts: 0, err: null }, ['AAPL', 'TSLA', 'NVDA', 'SPY', 'META']);
    };
    const sbOk = sbGrabador({ 'tickers:select': () => ({ data: CAT, error: null }) });
    const m1 = mk(sbOk);
    const c1 = await m1.cargarTickers(true);
    igual([c1, m1.lista()], [true, ['AAPL', 'NVDA', 'SPY', 'META']], 'cargarTickers: lee la tabla tickers y TICKERS pasa a ser la lista dinámica (cambio = true)');
    assert(sbOk.llamadas[0].tabla === 'tickers' && /symbol,nombre,rol,activo,orden/.test(sbOk.llamadas[0].select), 'cargarTickers: consulta tickers (symbol, nombre, rol, activo, orden)');
    const m2 = mk(sbGrabador({ 'tickers:select': () => ({ data: null, error: { message: 'boom' } }) }));
    const c2 = await m2.cargarTickers(true);
    igual([c2, m2.lista()], [false, ['AAPL', 'TSLA', 'NVDA', 'SPY', 'META']], 'cargarTickers: si la lectura falla, la lista de respaldo sigue intacta');
    const m3 = mk(sbGrabador({ 'tickers:select': () => { throw new Error('sin red'); } }));
    let lanzo = false; try { await m3.cargarTickers(true); } catch (_) { lanzo = true; }
    assert(!lanzo && JSON.stringify(m3.lista()) === JSON.stringify(['AAPL', 'TSLA', 'NVDA', 'SPY', 'META']), 'cargarTickers: sin red no revienta y queda el respaldo');
    // v53: «leí y no hay ninguno activo» deja la lista VACÍA (y el ⚙ lo dice); un catálogo sin filas sí vuelve al respaldo
    const m4 = mk(sbGrabador({ 'tickers:select': () => ({ data: CAT.map(f => ({ ...f, activo: false })), error: null }) }));
    igual([await m4.cargarTickers(true), m4.lista()], [true, []], 'cargarTickers: todos desactivados → lista vacía honesta, no los 5 de respaldo en silencio');
    const m5 = mk(sbGrabador({ 'tickers:select': () => ({ data: [], error: null }) }));
    igual([await m5.cargarTickers(true), m5.lista()], [false, ['AAPL', 'TSLA', 'NVDA', 'SPY', 'META']], 'cargarTickers: catálogo sin filas (no es una decisión) → respaldo');
    const LT0 = construir(['listaTickersHtml'], { esc, TICKERS: [], _tickers: {} });
    assert(/Ningún ticker activo: activa alguno/.test(LT0.listaTickersHtml(CAT.map(f => ({ ...f, activo: false })))), '⚙: con todos inactivos lo dice');
    // v53: tickerAgregar recorta el $ y reconoce la fila existente (SPX inactiva) en vez de insertar «$SPX»
    const err = { style: {}, textContent: '' }, escrituras = [];
    const TA = construir(['tickerAgregar', 'simboloTicker'], { TICKER_RE: constante('TICKER_RE'), $: (s) => (s === '#tkSym' ? { value: '$spx' } : s === '#tkNom' ? { value: '' } : s === '#tkErr' ? err : null),
      _tickers: { filas: [{ symbol: 'SPX', rol: 'operable', activo: false, orden: 7 }] }, tickerEscribir: (fn) => { escrituras.push(fn); }, sb: null });
    TA.tickerAgregar();
    assert(escrituras.length === 0 && /SPX ya está en el catálogo \(inactivo\)/.test(err.textContent), 'tickerAgregar: «$spx» se lee como SPX, que ya existe inactiva → «actívalo en la lista», sin insertar nada');
    const TA2 = construir(['tickerAgregar', 'simboloTicker'], { TICKER_RE: constante('TICKER_RE'), $: (s) => (s === '#tkSym' ? { value: '.' } : s === '#tkNom' ? { value: '' } : s === '#tkErr' ? err : null), _tickers: { filas: [] }, tickerEscribir: (fn) => { escrituras.push(fn); }, sb: null });
    TA2.tickerAgregar();
    assert(escrituras.length === 0 && /Símbolo inválido/.test(err.textContent), 'tickerAgregar: «.» no pasa (el worker lo descartaría y quedaría atrapado en el catálogo)');
    assert(/queda en la lista/.test(construir(['seccionTickersCuenta', 'listaTickersHtml'], { esc, TICKERS: ['AAPL'], _tickers: { filas: CAT } }).seccionTickersCuenta()), '⚙ dice que un ticker mal escrito solo se puede desactivar (queda en la lista)');
  }
  assert(/^let TICKERS = TICKERS_RESPALDO\.slice\(\);/m.test(FUENTE) && /^const TICKERS_RESPALDO = \['AAPL', 'TSLA', 'NVDA', 'SPY', 'META'\];/m.test(FUENTE), 'TICKERS deja de ser constante fija: nace del respaldo y se recarga de la base');
  assert(/cargarTickers\(\)\.then\(c => \{ if \(c\) ruta\(\); \}\)/.test(FUENTE) && /_mzTimerTickers = setInterval/.test(FUENTE) && /10 \* 60000\);/.test(FUENTE), 'al arrancar y cada 10 min se relee el catálogo');
  const LT = construir(['listaTickersHtml', 'seccionTickersCuenta'], { esc, TICKERS: ['AAPL', 'META'], _tickers: { filas: CAT } });
  const hTk = LT.seccionTickersCuenta();
  assert(/TICKERS/.test(hTk) && /MZ\.tickerAgregar\(\)/.test(hTk) && /MZ\.tickerActivo\('TSLA', true\)/.test(hTk) && /MZ\.tickerActivo\('SPY', false\)/.test(hTk) && /MZ\.tickerMover\('NVDA', -1\)/.test(hTk) && /10 min/.test(hTk) && /necesita historia/.test(hTk) && /Desactivar NO borra/.test(hTk) && !/MERCADO/.test(hTk.split('Los tickers globales')[0]),
    '⚙ Tu cuenta → Tickers: lista con interruptor activo/inactivo y orden, Agregar ticker, y la explicación del worker (10 min) y de la historia; el global no se toca');
  assert(/RANGOS_TABLA\[sym\] \|\| null/.test(FUENTE) && /RANGOS_TABLA\[f\.symbol\] \|\| null/.test(FUENTE) && /RANGOS_TABLA\[e\.symbol\] \|\| null/.test(FUENTE), 'un ticker sin fila en RANGOS_TABLA no rompe nada (todas las lecturas van con || null)');
  const TR = construir(['textoRangoOrden', 'bandaDelDia'], { esc, fmtFechaNY, RANGOS_TABLA_ANALISIS: '2026-05-19', DIAS_ES: constante('DIAS_ES') });
  assert(/no está en la tabla de rangos/.test(TR.textoRangoOrden('ZZZ', null, null, 1)), 'y el formulario de orden lo dice sin reventar');

  // ════════════════ 9. LA VERSIÓN y el módulo ENTERO ════════════════
  // v54: 31184c9 (v53) ya está publicado; sin subir el número la Mesa instalada no se actualiza sola
  assert(/config\.js\?v=54/.test(INDEX) && /app\/main\.js\?v=54/.test(INDEX), 'index.html carga config.js?v=54 y app/main.js?v=54');
  assert(/const VER = 'mesa2-v43';/.test(SW), 'sw.js VER mesa2-v43');
  assert(/font-size:16px;line-height:1\.45/.test(INDEX) && /\.card select,\.card input\[type=date\]\{[^}]*font-size:16px/.test(INDEX) && /\.chip2\{[^}]*padding:9px 12px/.test(INDEX) && /#tkSym::placeholder\{text-transform:none\}/.test(INDEX), 'CSS: campos nuevos a 16 px (iOS no hace zoom), chips de 33 px de alto, placeholder sin mayúsculas forzadas');
  assert(/\.tbl\{/.test(INDEX) && /\.chip2\{/.test(INDEX) && /\.card textarea\{/.test(INDEX), 'index.html trae el CSS del Diario (tablas, chips, notas)');
  // la doctrina de v50 sigue: el camino de la cartera solo LEE (insert de la adopción y update del ajuste)
  const ini = FUENTE.indexOf('Cartera abierta LEÍDA DEL BRÓKER'), finB = FUENTE.indexOf('function resumenPeriodo');
  const BLOQUE = FUENTE.slice(ini, finB);
  igual((BLOQUE.match(/\.(insert|update|upsert|delete)\(/g) || []).sort(), ['.insert(', '.update('], 'la escritura de la foto vive FUERA del bloque de la cartera: ese camino sigue solo leyendo');
  const v52 = FUENTE.slice(FUENTE.indexOf('v52 · EL DIARIO'));
  ['ordenPlace(', 'ordenPreview(', 'etPost(', 'swPost(', '/etrade/place', '/etrade/preview', 'construirOrden(', 'abrirOrden('].forEach(t => assert(!v52.includes(t), 'el bloque v52 no arma ni envía órdenes: no toca «' + t + '»'));
  assert(!/sb\.from\('fills'\)[\s\S]{0,200}\.delete\(/.test(FUENTE), 'nadie borra del libro de fills');
  assert(!/console\.log\(.*token/i.test(v52), 'nada imprime tokens');
  assert(/guardarFills\(fillsDeTransaccionesEtrade\(txs\), uid\)/.test(FUENTE) && FUENTE.indexOf('guardarFills(fillsDeTransaccionesEtrade(txs), uid)') < FUENTE.indexOf('const rts = emparejarEtrade(txs);'), 'E*TRADE: las ejecuciones van al libro ANTES de emparejar');
  assert(/guardarFills\(fillsDeOrdenesSchwabLibro\(res\.ordenes\), uid\)/.test(FUENTE) && FUENTE.indexOf('guardarFills(fillsDeOrdenesSchwabLibro(res.ordenes), uid)') < FUENTE.indexOf('const rts = emparejarFillsSchwab(fills);'), 'Schwab: idem');
  // módulo entero en un DOM de juguete
  const nodo = () => ({ innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, forEach() {} });
  const almacen = {};
  const canal = { on() { return canal; }, subscribe() { return canal; } };
  const consulta = () => { const q = {}; ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'range', 'lt', 'gte', 'lte', 'neq', 'is', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single'].forEach(k => { q[k] = () => q; });
    q.then = (f) => Promise.resolve({ data: [], error: null }).then(f); return q; };
  const win = { MESA2: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', PROXY_URL: 'https://proxy' },
    supabase: { createClient: () => ({ from: consulta, channel: () => canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) },
    localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
    addEventListener() {}, location: { hash: '#/copiloto', reload() {} }, Intl, Date, Math, JSON, Promise,
    setTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => Promise.reject(new Error('sin red')),
    navigator: { serviceWorker: { register: () => Promise.resolve(), addEventListener() {} } },
    document: { querySelector: () => nodo(), querySelectorAll: () => [], createElement: () => nodo(), addEventListener() {}, body: nodo(), currentScript: { src: './app/main.js?v=54' } } };
  win.window = win;
  vm.createContext(win);
  let cargo = true;
  try { vm.runInContext(FUENTE, win, { filename: 'main.js' }); } catch (e) { cargo = false; falla('app/main.js entero se evalúa sin reventar', String(e && e.message)); }
  if (cargo) {
    ok('app/main.js entero se evalúa sin reventar (orden de carga intacto)');
    const ev = (t) => vm.runInContext(t, win);
    const viejas = ['abrirFill', 'guardarFill', 'cerrar', 'copiar', 'quitarSenal', 'restaurarSenal', 'abrirCuenta', 'salir', 'chartAbrir', 'chartGuardarTarget', 'abrirOrden', 'ordenPreview', 'ordenPlace',
      'cancelarOrden', 'cortarPosicion', 'elegirPlataforma', 'conectar', 'etSync', 'swSync', 'periodo', 'pinOrdenes', 'armar', 'elegirFoco', 'adoptar', 'adoptarConfirmar', 'cerrarAdoptar', 'ajustarContratos', 'carteraRefrescar'];
    igual(viejas.filter(k => typeof win.MZ[k] !== 'function'), [], 'la v52 NO pisa window.MZ: todo lo de v49/v50/v51 sigue enganchado');
    const nuevas = ['cuentasVista', 'diarioPeriodo', 'diarioRango', 'diarioBroker', 'diarioMasEjec', 'diarioSincronizar', 'notaGuardar', 'notaEditar', 'notaEditarGuardar', 'notaEditarCancelar', 'notaBorrar', 'notaDePosicion', 'cancelarOrdenFuera', 'tickerActivo', 'tickerMover', 'tickerAgregar',
      'notaBorrador', 'notaBorradorCampo', 'notaEdBorrador', 'diarioRangoTmp'];
    igual(nuevas.filter(k => typeof win.MZ[k] !== 'function'), [], 'las 16 puertas de la v52 y las 4 del borrador (v53) cuelgan de window.MZ');
    // v53: el Realtime de posiciones (marks del worker) pasa por rutaSalvoDiario: con el Diario a la vista no redibuja
    const registros = []; canal.on = (ev, cfg, cb) => { registros.push([cfg && cfg.table, cb && cb.name]); return canal; };
    ev('suscribir()');
    assert(registros.some(r => r[0] === 'posiciones' && r[1] === 'rutaSalvoDiario') && registros.some(r => r[0] === 'senales' && r[1] === 'ruta'), 'Realtime: posiciones → rutaSalvoDiario; senales sigue → ruta');
    ev("location.hash = '#/cuentas'; _cuentasVista = 'diario'; window.__rutas = 0; ruta = () => { window.__rutas++; };");
    ev('rutaSalvoDiario()');
    assert(ev('window.__rutas') === 0, 'rutaSalvoDiario en el Diario: no llama a ruta()');
    ev("location.hash = '#/copiloto'"); ev('rutaSalvoDiario()');
    assert(ev('window.__rutas') === 1, 'rutaSalvoDiario fuera del Diario: llama a ruta() como siempre');
    igual(ev('TICKERS'), ['AAPL', 'TSLA', 'NVDA', 'SPY', 'META'], 'sin sesión ni base, TICKERS es el respaldo');
    assert(ev('typeof vistaCuentasSaldos') === 'function' && ev('typeof vistaDiario') === 'function' && ev('_cuentasVista') === 'diario', 'Cuentas tiene dos vistas y abre en Diario por defecto');
    // v53: la pestaña Cuentas (saldos) lleva «Hoy» en su selector (Andrés: «aquí falta día») y con él el título dice UTILIDAD · HOY
    {
      const vistaCta = nodo();
      win.document.querySelector = (s) => (s === '#vista' ? vistaCta : nodo());
      ev("location.hash = '#/cuentas'; _cuentasVista = 'cuentas'; _periodoSel = 'dia';");
      try { await ev('vistaCuentasSaldos()'); } catch (e) { falla('vistaCuentasSaldos corre en el DOM de juguete', String(e && e.message)); }
      const hc = vistaCta.innerHTML;
      assert(/<button class="perbtn on" onclick="MZ\.periodo\('dia'\)">Hoy<\/button><button class="perbtn " onclick="MZ\.periodo\('semana'\)">Semana<\/button><button class="perbtn " onclick="MZ\.periodo\('mes'\)">Mes<\/button><button class="perbtn " onclick="MZ\.periodo\('ytd'\)">YTD<\/button>/.test(hc), 'Cuentas: el selector es Hoy · Semana · Mes · YTD (en ese orden) y «Hoy» sale encendido');
      assert(/UTILIDAD · HOY/.test(hc) && !/UTILIDAD · DIA/.test(hc), 'Cuentas: con «Hoy» el título dice UTILIDAD · HOY (no DIA)');
      ev("_periodoSel = 'semana';");
      try { await ev('vistaCuentasSaldos()'); } catch (_) {}
      assert(/UTILIDAD · SEMANA/.test(vistaCta.innerHTML) && /<button class="perbtn on" onclick="MZ\.periodo\('semana'\)">Semana<\/button>/.test(vistaCta.innerHTML), 'Cuentas: con «Semana» el título sigue diciendo UTILIDAD · SEMANA');
      assert(/\[\['dia','Hoy'\],\['semana','Semana'\],\['mes','Mes'\],\['ytd','YTD'\]\]/.test(extraer('vistaCuentasSaldos')) && /^let _periodoSel = 'semana';/m.test(FUENTE), 'y en el fuente el selector está escrito así, con la semana por defecto');
      win.document.querySelector = () => nodo();
    }
    ev("_ordSync.fuera = [{ broker: 'etrade', orderId: '77', status: 'OPEN', symbol: 'SPY', security_type: 'OPTN', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', accion: 'SELL_CLOSE', cantidad: 1, price_type: 'LIMIT', limit_price: 4.4, order_term: 'GOOD_UNTIL_CANCEL' }]");
    const hOrd = ev('seccionOrdenes([])');
    assert(/PUESTAS FUERA DE LA MESA/.test(hOrd) && /MZ\.cancelarOrdenFuera\('etrade', '77'\)/.test(hOrd) && !/Sin órdenes activas en tu bróker/.test(hOrd), 'ÓRDENES ACTIVAS EN TU BRÓKER lista también las vivas puestas fuera de la Mesa, con su Cancelar');
    ev('_ordSync.fuera = []');
    assert(/Sin órdenes activas en tu bróker/.test(ev('seccionOrdenes([])')), 'y sin ninguna, el vacío de siempre');
    assert(/ORDENES ACTIVAS EN TU BRÓKER|ÓRDENES ACTIVAS EN TU BRÓKER/.test(hOrd), 'el título de la sección no cambia');
    assert(/\['etrade', 'schwab', 'tasty'\]/.test(extraer('firmaCartera')) && /uno\('tasty', leerCarteraTasty\)/.test(extraer('cargarCartera')) && /fotoDispositivoSincronizar\(abierto\)/.test(extraer('cargarCartera')), 'cargarCartera lee los tres brókeres y sincroniza la foto del dispositivo');
  }

  console.log('');
  console.log(fallos ? `${fallos} FALLA(S) · ${verdes} asserts verdes` : `${verdes} asserts verdes`);
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
