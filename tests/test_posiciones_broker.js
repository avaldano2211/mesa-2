#!/usr/bin/env node
/* Pruebas de la v50: cartera abierta leída del bróker (bloque B) y los arreglos de
   integridad (A1, A2, A3). Estilo de la casa: se extraen las funciones REALES del
   fuente con new Function y dependencias falsas — nada se reimplementa aquí, porque
   una prueba que reimplementa la lógica solo se prueba a sí misma.
   Uso: node test_posiciones_broker.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const RUTA = process.argv[2];
if (!RUTA) { console.error('uso: node test_posiciones_broker.js <ruta a main.js>'); process.exit(2); }
const FUENTE = fs.readFileSync(RUTA, 'utf8');

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

// ---------- extractor: saca el texto exacto de una función del fuente ----------
// Escáner con estados (código / cadena / plantilla / comentario) para que las llaves
// de un template `${...}` o de un comentario no descoloquen el conteo.
function extraer(nombre) {
  const re = new RegExp('^(?:async )?function ' + nombre + '\\s*\\(', 'm');
  const m = re.exec(FUENTE);
  if (!m) throw new Error('no encontré `function ' + nombre + '` en ' + RUTA);
  const ini = m.index;
  let i = FUENTE.indexOf('{', ini);
  if (i < 0) throw new Error('función sin cuerpo: ' + nombre);
  const pila = [];            // 'llave' | 'plantilla'
  let est = 'codigo', cierre = '';
  for (; i < FUENTE.length; i++) {
    const c = FUENTE[i], d = FUENTE[i + 1];
    if (est === 'cadena') { if (c === '\\') { i++; continue; } if (c === cierre) est = 'codigo'; continue; }
    if (est === 'linea') { if (c === '\n') est = 'codigo'; continue; }
    if (est === 'bloque') { if (c === '*' && d === '/') { i++; est = 'codigo'; } continue; }
    if (est === 'plantilla') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { est = 'codigo'; pila.pop(); continue; }
      if (c === '$' && d === '{') { i++; pila.push('llave'); est = 'codigo'; continue; }
      continue;
    }
    // estado código
    if (c === '/' && d === '/') { est = 'linea'; i++; continue; }
    if (c === '/' && d === '*') { est = 'bloque'; i++; continue; }
    if (c === '\'' || c === '"') { est = 'cadena'; cierre = c; continue; }
    if (c === '`') { est = 'plantilla'; pila.push('plantilla'); continue; }
    if (c === '{') { pila.push('llave'); continue; }
    if (c === '}') {
      pila.pop();
      if (!pila.length) return FUENTE.slice(ini, i + 1);
      if (pila[pila.length - 1] === 'plantilla') est = 'plantilla';
      continue;
    }
  }
  throw new Error('no pude cerrar la función ' + nombre);
}
// Construye un módulo con esas funciones reales y las dependencias falsas que se le pasen.
function construir(nombres, deps) {
  deps = deps || {};
  const claves = Object.keys(deps);
  const cuerpo = nombres.map(extraer).join('\n\n');
  const f = new Function(...claves, '"use strict";\n' + cuerpo + '\nreturn { ' + nombres.join(', ') + ' };');
  return f(...claves.map(k => deps[k]));
}

// ---------- dependencias falsas comunes ----------
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const colUtil = (n) => n == null ? 'var(--tx2)' : n > 0 ? 'var(--verde)' : n < 0 ? 'var(--rojo)' : 'var(--tx2)';
const BROKER_NOMBRE = { etrade: 'E*TRADE', schwab: 'Charles Schwab', tasty: 'tastytrade', moomoo: 'moomoo' };
const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(iso ? new Date(iso) : new Date()); } catch (_) { return ''; } };
const HOY = '2026-09-24';
const hoyNY = () => HOY;
const PLANES = {
  PLAN_35: { id: 'PLAN_35', nombre: 'Plan 35%', gtcPct: 35, stopPct: null, opsMax: 3, periodo: 'semana' },
  PLAN_10: { id: 'PLAN_10', nombre: 'Plan 10%', gtcPct: 10, stopPct: 20, opsMax: 1, periodo: 'dia' },
};

// ════════════════ 1. NORMALIZAR las dos respuestas al MISMO shape ════════════════
const desOsi = construir(['desOsi']).desOsi;
const N = construir(['normalizarPosEtrade', 'normalizarPosSchwab', 'claveCartera', 'claveContrato'], { desOsi });

const RESP_ET = { PortfolioResponse: { AccountPortfolio: [{ accountId: '1234', totalPages: 1, Position: [
  { positionId: 1, quantity: 2, pricePaid: 3.30, marketValue: 840, totalGain: 180, totalGainPct: 27.27,
    commissions: 1.30, dateAcquired: Date.parse('2026-09-22T13:35:00Z'),
    Product: { symbol: 'SPY', securityType: 'OPTN', callPut: 'CALL', expiryYear: 2026, expiryMonth: 9, expiryDay: 26, strikePrice: 769 },
    Quick: { lastTrade: 4.20 } },
  { positionId: 2, quantity: 100, pricePaid: 180, marketValue: 18500, totalGain: 500,
    Product: { symbol: 'AAPL', securityType: 'EQ' }, Quick: { lastTrade: 185 } },
  { positionId: 3, quantity: -1, pricePaid: 1.10, marketValue: -90, totalGain: 20,
    Product: { symbol: 'TSLA', securityType: 'OPTN', callPut: 'PUT', expiryYear: 26, expiryMonth: 10, expiryDay: 3, strikePrice: 400 }, Quick: {} },
] }] } };
const et = N.normalizarPosEtrade(RESP_ET);
igual(et.items.length, 1, 'E*TRADE: de 3 posiciones solo la OPCIÓN comprada entra a la lista');
igual(et.otros.acciones, 1, 'E*TRADE: la acción se cuenta aparte (se dice en pantalla, no se mezcla)');
igual(et.otros.vendidas, 1, 'E*TRADE: la opción VENDIDA se cuenta aparte y no se adopta');
const e0 = et.items[0];
igual([e0.symbol, e0.direccion, e0.strike, e0.expiracion, e0.contratos], ['SPY', 'CALL', 769, '2026-09-26', 2], 'E*TRADE: contrato normalizado (symbol, dirección, strike, expiración, contratos)');
cerca(e0.prima_fill, 3.30, 'E*TRADE: prima_fill = pricePaid del bróker');
cerca(e0.valor_actual, 840, 'E*TRADE: valor ahora = marketValue del bróker');
cerca(e0.pnl_usd, 180, 'E*TRADE: P&L = totalGain del bróker (no se recalcula)');
cerca(e0.invertido, 660, 'E*TRADE: invertido = valor − P&L, los dos del bróker');
igual([e0.origen_valor, e0.origen_pnl, e0.origen_invertido], ['broker', 'broker', 'broker'], 'E*TRADE: queda dicho que las cifras son del bróker');
cerca(e0.mark, 4.20, 'E*TRADE: mark = lastTrade del bróker');
assert(e0.abierta_at === '2026-09-22T13:35:00.000Z' && e0.abierta_estimada === false, 'E*TRADE: dateAcquired da la fecha de apertura real', e0.abierta_at);

const RESP_SW = { securitiesAccount: { accountNumber: '9***999', positions: [
  { instrument: { assetType: 'OPTION', symbol: 'NVDA  261003C00180000', putCall: 'CALL', strikePrice: 180, underlyingSymbol: 'NVDA' },
    longQuantity: 3, shortQuantity: 0, averagePrice: 2.10, marketValue: 750, currentDayProfitLoss: 45, longOpenProfitLoss: 120 },
  { instrument: { assetType: 'EQUITY', symbol: 'SPY' }, longQuantity: 10, marketValue: 6900 },
  { instrument: { assetType: 'CASH_EQUIVALENT', symbol: 'MMDA1' }, longQuantity: 5000, marketValue: 5000 },
  { instrument: { assetType: 'OPTION', symbol: 'TSLA  261003P00400000' }, longQuantity: 0, shortQuantity: 1, averagePrice: 1.1, marketValue: -90 },
] } };
const sw = N.normalizarPosSchwab(RESP_SW);
igual(sw.items.length, 1, 'Schwab: de 4 posiciones solo la OPCIÓN comprada entra a la lista');
igual([sw.otros.acciones, sw.otros.efectivo, sw.otros.vendidas], [1, 1, 1], 'Schwab: acciones, efectivo y la vendida se cuentan aparte');
const s0 = sw.items[0];
igual([s0.symbol, s0.direccion, s0.strike, s0.expiracion, s0.contratos], ['NVDA', 'CALL', 180, '2026-10-03', 3], 'Schwab: el OSI se desarma al MISMO shape que E*TRADE');
cerca(s0.prima_fill, 2.10, 'Schwab: prima_fill = averagePrice del bróker');
cerca(s0.valor_actual, 750, 'Schwab: valor ahora = marketValue del bróker');
cerca(s0.pnl_usd, 120, 'Schwab: P&L = longOpenProfitLoss (desde la apertura, no el del día)');
cerca(s0.pnl_dia_usd, 45, 'Schwab: el P&L del día se guarda aparte, sin confundirlo con el de la operación');
cerca(s0.invertido, 630, 'Schwab: invertido = valor − P&L');
assert(s0.comisiones === null, 'Schwab: sin comisiones en la respuesta → null, no un 0 inventado');
assert(s0.abierta_at === null && s0.abierta_estimada === true, 'Schwab: no da fecha de apertura y queda marcado');
igual(Object.keys(e0).filter(k => !(k in s0)).filter(k => k !== 'osi'), [], 'los dos brókeres devuelven el MISMO shape (E*TRADE ⊆ Schwab)');
assert(N.claveCartera(e0) === 'etrade|SPY|CALL|769|2026-09-26', 'la clave lleva bróker + contrato', N.claveCartera(e0));
assert(N.claveContrato({ symbol: 'SPY', direccion: 'CALL', strike: '769.0', expiracion: '2026-09-26T00:00:00' }) === 'SPY|CALL|769|2026-09-26', 'la clave normaliza strike y expiración (769.0 y un ISO largo casan igual)');
assert(N.claveContrato({ symbol: 'SPY', direccion: 'CALL', strike: null, expiracion: '2026-09-26' }) === '', 'sin strike no hay clave: no se casa a ciegas (Number(null) es 0, no NaN)');
assert(N.claveContrato({ symbol: 'SPY', direccion: 'CALL', strike: '', expiracion: '2026-09-26' }) === '', 'strike vacío tampoco da clave');
assert(N.claveContrato({ symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: null }) === '', 'sin expiración tampoco hay clave');

// ════════════════ 2. CASAR bróker × libro: los tres estados ════════════════
const C = construir(['casarCarteraLibro', 'claveCartera', 'claveContrato'], {});
const LIBRO = [
  { id: 1, estado: 'abierta', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, prima_fill: 3.30, broker: 'etrade' },
  { id: 2, estado: 'abierta', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-17', contratos: 1, prima_fill: 5.00, broker: 'etrade' },
  { id: 3, estado: 'cerrada', symbol: 'AAPL', direccion: 'CALL', strike: 230, expiracion: '2026-09-19', contratos: 1, prima_fill: 1.00, broker: 'etrade' },
  { id: 4, estado: 'abierta', symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-03', contratos: 3, prima_fill: 2.10, broker: 'schwab' },
];
const cas = C.casarCarteraLibro([e0, s0], LIBRO, ['etrade', 'schwab']);
igual(cas.enAmbos.map(x => x.pos.id), [1, 4], '(a) en el bróker Y en el libro: casan por contrato + bróker');
igual(cas.soloBroker.length, 0, 'nada sobra del bróker cuando todo está en el libro');
igual(cas.soloLibro.map(p => p.id), [2], '(c) en el libro y NO en el bróker: se señala (se vendió por fuera o venció)');
assert(!cas.enAmbos.concat(cas.soloLibro.map(p => ({ pos: p }))).some(x => x.pos.estado !== 'abierta'), 'una posición CERRADA del libro no entra al casado');
const casB = C.casarCarteraLibro([e0, s0], LIBRO.filter(p => p.broker === 'etrade'), ['etrade', 'schwab']);
igual(casB.soloBroker.map(x => x.clave), ['schwab|NVDA|CALL|180|2026-10-03'], '(b) en el bróker y NO en el libro: sale como sin registrar');
// el mismo contrato en OTRO bróker NO es la misma posición
const casC = C.casarCarteraLibro([{ ...e0, broker: 'schwab', clave: 'schwab|SPY|CALL|769|2026-09-26' }], LIBRO, ['etrade', 'schwab']);
assert(casC.soloBroker.length === 1 && casC.soloLibro.some(p => p.id === 1), 'el mismo contrato en otro bróker es OTRA posición (no se cruzan)');
// bróker que NO se pudo leer: jamás se acusa de «ya no la tiene»
const casD = C.casarCarteraLibro([e0], LIBRO, ['etrade']);
assert(casD.soloLibro.every(p => p.broker !== 'schwab'), 'un bróker que no contestó no produce falsos «el bróker ya no la tiene»');
igual(casD.noComprobadas.map(x => [x.pos.id, x.motivo]), [[4, 'sin_lectura']], 'la posición de un bróker mudo queda como SIN COMPROBAR');
const casE = C.casarCarteraLibro([], [{ id: 9, estado: 'abierta', symbol: 'SPY', direccion: 'CALL', strike: null, expiracion: null, broker: 'etrade' }], ['etrade']);
igual(casE.noComprobadas.map(x => x.motivo), ['sin_contrato'], 'una posición del libro sin strike/expiración no se puede comparar: se dice, no se acusa');

// ════════════════ 3. DIFERENCIA DE CANTIDAD ════════════════
const casF = C.casarCarteraLibro([{ ...e0, contratos: 3, clave: 'etrade|SPY|CALL|769|2026-09-26' }], LIBRO, ['etrade', 'schwab']);
const par = casF.enAmbos.find(x => x.pos.id === 1);
igual(par.dif, 1, 'el bróker dice 3 y el libro 2 → diferencia +1, nunca silenciada');
const casG = C.casarCarteraLibro([{ ...e0, contratos: 1, clave: 'etrade|SPY|CALL|769|2026-09-26' }], LIBRO, ['etrade', 'schwab']);
igual(casG.enAmbos.find(x => x.pos.id === 1).dif, -1, 'el bróker dice 1 y el libro 2 → diferencia −1 (también se avisa)');
igual(cas.enAmbos.find(x => x.pos.id === 1).dif, 0, 'cantidades iguales → 0, sin ruido');

// ════════════════ 4. ADOPTAR: idempotente, congela plan y no pisa nada ════════════════
const A = construir(['filaAdopcion', 'adoptarDecide', 'claveCartera', 'claveContrato'], { hoyNY, ymdNY });
const d1 = A.adoptarDecide(s0, LIBRO.filter(p => p.broker === 'etrade'));
igual(d1.accion, 'insertar', 'adoptar una que el libro no tiene: inserta');
const d2 = A.adoptarDecide(s0, LIBRO);
igual(d2.accion, 'existe', 'adoptar DOS VECES no crea dos filas (idempotente por contrato + bróker)');
assert(d2.posicion && d2.posicion.id === 4, 'al adoptar algo ya registrado se devuelve la ficha existente, no se pisa');
const d3 = A.adoptarDecide({ ...s0, contratos: 9, prima_fill: 99 }, LIBRO);
igual(d3.accion, 'existe', 'aunque el bróker diga otra cantidad o precio, la ficha del libro NO se pisa al adoptar');
const f10 = A.filaAdopcion(s0, PLANES.PLAN_10, 'uid-1', HOY);
igual([f10.plan_pct, f10.stop_pct], [10, 20], 'adoptar con Plan 10% congela plan_pct 10 y stop_pct 20');
igual([f10.symbol, f10.direccion, f10.strike, f10.expiracion, f10.contratos, f10.broker, f10.estado], ['NVDA', 'CALL', 180, '2026-10-03', 3, 'schwab', 'abierta'], 'la fila adoptada entra como una posición normal (estado abierta)');
cerca(f10.prima_fill, 2.10, 'el costo promedio del bróker entra como prima_fill');
igual([f10.abierta_fecha_ny, f10._estimada], [HOY, true], 'sin fecha del bróker: se usa HOY y queda MARCADO como estimado');
const f35 = A.filaAdopcion(e0, PLANES.PLAN_35, 'uid-1', HOY);
assert(!('stop_pct' in f35), 'Plan 35% no tiene corte: stop_pct no se envía (compatible sin migración)');
igual([f35.plan_pct, f35.abierta_at, f35._estimada], [35, '2026-09-22T13:35:00.000Z', false], 'con fecha del bróker se respeta la apertura real');
igual(f35.user_id, 'uid-1', 'la fila adoptada lleva user_id (la muralla RLS la exige)');
assert(A.filaAdopcion(e0, PLANES.PLAN_35, null, HOY) === null, 'sin sesión no se arma ninguna fila');
// v53: la ficha adoptada lleva el precio de AHORA del bróker (mark/mark_at, columnas que ya existen):
// en OTRO equipo (localStorage limpio) gtcAutoEnviaSola necesita saber si el límite GTC —calculado
// sobre el costo histórico— ya queda POR DEBAJO del mercado; si no, la venta automática saldría sola.
const fMk = A.filaAdopcion({ ...e0, mark: 4.6 }, PLANES.PLAN_35, 'uid-1', HOY);
assert(fMk.mark === 4.6 && typeof fMk.mark_at === 'string' && !isNaN(Date.parse(fMk.mark_at)), 'la ficha adoptada guarda el mark del bróker y su mark_at (una fecha ISO)', JSON.stringify([fMk.mark, fMk.mark_at]));
const fSinMk = A.filaAdopcion({ ...s0, mark: null }, PLANES.PLAN_35, 'uid-1', HOY);
assert(!('mark' in fSinMk) && !('mark_at' in fSinMk), 'sin mark del bróker no se inventa ninguno (ni mark ni mark_at en la fila)');
assert(!('mark' in A.filaAdopcion({ ...e0, mark: 0 }, PLANES.PLAN_35, 'uid-1', HOY)), 'un mark 0 tampoco es un precio: no viaja');
const GA = construir(['gtcAutoEnviaSola', 'gtcAutoQuiere', 'gtcLimite'], { GTC_AUTO_ENV_K: 'mz_gtc_auto_env', localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
const limMk = GA.gtcLimite(fMk.prima_fill, 35);
cerca(limMk, 4.48, 'GTC +35% sobre el fill 3.30 = 4.48 (al centavo, como la columna generada)');
igual(GA.gtcAutoEnviaSola({ id: 1, ...fMk }, limMk), { enviar: false, motivo: 'bajo_mercado' }, 'con el mark 4.60 guardado al adoptar, el límite 4.48 queda POR DEBAJO del mercado: la GTC automática NO sale sola (bajo_mercado)');
const fPerd = A.filaAdopcion({ ...e0, mark: 2.5 }, PLANES.PLAN_35, 'uid-1', HOY);
igual(GA.gtcAutoEnviaSola({ id: 2, ...fPerd }, GA.gtcLimite(fPerd.prima_fill, 35)), { enviar: true, motivo: '' }, 'una perdedora (mark 2.50 < límite 4.48) sí deja salir la GTC automática: es una orden en reposo esperando el objetivo');
igual(GA.gtcAutoEnviaSola({ id: 3, ...fSinMk }, GA.gtcLimite(fSinMk.prima_fill, 35)).enviar, true, 'sin mark no hay con qué frenar: sale (como antes de la v53)');

// ════════════════ 5. MARGEN hasta el GTC y hasta el CORTE ════════════════
const M = construir(['margenHasta', 'gtcLimite', 'corteDe', 'gtcDePosicion'], {});
const posM = { prima_fill: 3.30, plan_pct: 10, stop_pct: 20, contratos: 2, gtc_limite: 3.65 };
const gtc = M.gtcDePosicion(posM), corte = M.corteDe(posM.prima_fill, posM.stop_pct);
cerca(gtc, 3.65, 'límite GTC de la posición: el de la base (fill 3.30 al +10% + 0.02)');
cerca(corte, 2.64, 'corte -20% sobre el fill 3.30 = 2.64');
const mg = M.margenHasta(3.40, gtc, 'arriba');
cerca(mg.falta, 0.25, 'con mark 3.40 faltan $0.25 de prima para tocar el GTC 3.65');
cerca(mg.pct, 7.4, 'esos $0.25 son +7.4% sobre la prima de ahora', 0.05);
assert(mg.tocado === false, 'el GTC todavía no está tocado');
const mg2 = M.margenHasta(3.70, gtc, 'arriba');
assert(mg2.tocado === true && mg2.falta <= 0, 'con mark 3.70 el GTC 3.65 ya está alcanzado');
const mc = M.margenHasta(3.40, corte, 'abajo');
cerca(mc.falta, 0.76, 'colchón hasta el corte: 3.40 − 2.64 = $0.76');
cerca(mc.pct, 22.4, 'el colchón es un 22.4% de la prima de ahora', 0.05);
const mc2 = M.margenHasta(2.60, corte, 'abajo');
assert(mc2.tocado === true, 'con mark 2.60 el corte 2.64 está TOCADO');
assert(M.margenHasta(null, gtc, 'arriba') === null && M.margenHasta(3.4, null, 'abajo') === null, 'sin mark o sin objetivo no se inventa margen (null)');
cerca(Math.round(mg.falta * 2 * 100 * 100) / 100, 50, 'el margen en dólares de la posición: $0.25 × 2 contratos × 100 = $50');

// ════════════════ 6. DÍAS AL VENCIMIENTO y VENCE HOY ════════════════
const V = construir(['diasAlVencimiento', 'textoVencimiento'], { hoyNY });
igual(V.diasAlVencimiento('2026-09-26', HOY), 2, 'del 24 al 26 de septiembre: 2 días');
igual(V.diasAlVencimiento('2026-09-24', HOY), 0, 'vence hoy → 0 días');
igual(V.diasAlVencimiento('2026-09-19', HOY), -5, 'ya vencido → días negativos');
assert(V.textoVencimiento('2026-09-24', HOY) === 'VENCE HOY', 'el día del vencimiento se dice a gritos: VENCE HOY', V.textoVencimiento('2026-09-24', HOY));
assert(/vence en 2 d/.test(V.textoVencimiento('2026-09-26', HOY)), 'texto normal: vence en 2 d');
assert(/venció hace 5 d/.test(V.textoVencimiento('2026-09-19', HOY)), 'ya vencida: venció hace 5 d');
igual(V.diasAlVencimiento(null, HOY), null, 'sin expiración no se inventan días');
igual(V.diasAlVencimiento('2027-03-14', '2027-03-07'), 7, 'el cambio de horario de NY no descuadra el conteo (7 días)');

// ════════════════ 7. TOTALES de la cartera abierta ════════════════
const T = construir(['totalesCartera'], {});
const t = T.totalesCartera([e0, s0]);
cerca(t.invertido, 1290, 'totales: invertido 660 + 630 = 1290');
cerca(t.valor, 1590, 'totales: valor ahora 840 + 750 = 1590');
cerca(t.pnl, 300, 'totales: P&L 180 + 120 = 300 (los dos del bróker)');
cerca(t.pnl_pct, 23.3, 'totales: P&L = +23.3% sobre lo invertido', 0.05);
cerca(t.comisiones, 1.30, 'las comisiones van APARTE y solo las que dio el bróker');
igual(t.brokers, ['etrade', 'schwab'], 'los totales dicen de qué brókeres son');
igual(T.totalesCartera([s0]).comisiones, null, 'sin comisiones del bróker: null, no un 0 que parezca gratis');
igual(T.totalesCartera([]).n, 0, 'cartera vacía: totales en cero, sin reventar');

// ════════════════ 8. BRÓKER CAÍDO / SESIÓN CADUCADA / RUTA NO PERMITIDA ════════════════
const L = construir(['lecturaBroker', 'textoLecturaBroker'], { BROKER_NOMBRE });
igual(L.lecturaBroker({ status: 200, data: { PortfolioResponse: {} } }).estado, 'ok', '200 → ok');
igual(L.lecturaBroker({ status: 204, data: {} }).estado, 'ok', '204 (sin posiciones) → ok, no error');
assert(L.lecturaBroker({ status: 204, data: {} }).vacio === true, '204 se marca como vacío de verdad');
igual(L.lecturaBroker({ status: 401, data: { error: 'token expired' } }).estado, 'sesion', '401 → sesión caducada (no «no tienes nada»)');
igual(L.lecturaBroker({ status: 403, data: { error: 'ruta no permitida' } }).estado, 'no_permitido', '403 del proxy → ruta no permitida por la lista blanca');
igual(L.lecturaBroker({ status: 404, data: { error: 'not found' } }).estado, 'no_permitido', '404 del proxy → ruta no permitida');
igual(L.lecturaBroker({ status: 500, data: { error: 'boom' } }).estado, 'error', '500 → error del bróker');
igual(L.lecturaBroker(null).estado, 'sin_red', 'sin respuesta → sin_red (no se pudo ni preguntar)');
igual(L.lecturaBroker({ _excepcion: 'Load failed' }).estado, 'sin_red', 'fetch cortado por iOS → sin_red');
const txtSes = L.textoLecturaBroker('etrade', { estado: 'sesion' });
assert(/sesión expiró/i.test(txtSes) && /Reconecta/.test(txtSes), 'sesión caducada de E*TRADE: dice reconectar', txtSes);
assert(/login semanal/i.test(L.textoLecturaBroker('schwab', { estado: 'sesion' })), 'sesión caducada de Schwab: habla del login SEMANAL');
const txtNP = L.textoLecturaBroker('etrade', { estado: 'no_permitido', detalle: 'ruta no permitida' });
assert(/todav[íi]a no permite/i.test(txtNP) && /Claude/.test(txtNP), 'ruta rechazada por el proxy: mensaje claro y dice avisarle a Claude', txtNP);
const txtSR = L.textoLecturaBroker('schwab', { estado: 'sin_red' });
assert(/NO quiere decir que no tengas nada/i.test(txtSR), 'bróker caído: se niega explícitamente el «no tienes nada»', txtSR);
assert(L.textoLecturaBroker('etrade', { estado: 'ok' }) === '', 'con lectura buena no hay aviso');

// ---- que la ruta rechazada NO entre en bucle ----
// v53: el piso de 30 s protege al refresco AUTOMÁTICO; «Volver a preguntar» (forzar) es un toque de
// Andrés y su piso es CART_MIN_FORZAR_MS (3 s): antes el de 30 s se comía el forzado y la app decía
// que había preguntado sin preguntar. Los fallos SEGUIDOS espacian el reintento (×fallos, tope media hora).
const R = construir(['carteraToca'], { CART_MIN_MS: 30000, CART_MIN_FORZAR_MS: 3000, CART_TTL_ABIERTO: 60000, CART_TTL_CERRADO: 900000, CART_TTL_VETADA: 1800000 });
const hace = (ms, estado) => ({ ts: Date.now() - ms, estado: estado || 'ok' });
assert(R.carteraToca(null, true, false) === true, 'sin lectura previa se pregunta');
assert(R.carteraToca(hace(10000), true, false) === false, 'piso duro: no se vuelve a preguntar antes de 30 s');
assert(R.carteraToca(hace(10000), true, true) === true, 'forzando («Volver a preguntar») a los 10 s SÍ se relee: el piso del toque es de 3 s, no de 30');
assert(R.carteraToca(hace(1000), true, true) === false, 'ni forzando se relee antes de 3 s (dos toques seguidos no castigan al proxy)');
assert(R.carteraToca({ ts: Date.now() - 70000, estado: 'error', fallos: 3 }, true, false) === false && R.carteraToca({ ts: Date.now() - 70000, estado: 'error', fallos: 1 }, true, false) === true, 'tres fallos seguidos espacian el reintento (×3: al minuto no; con un solo fallo sí)');
assert(R.carteraToca(hace(70000), true, false) === true, 'mercado abierto: se vuelve a preguntar al minuto');
assert(R.carteraToca(hace(70000), false, false) === false, 'mercado cerrado: al minuto NO se pregunta (cada 15 min)');
assert(R.carteraToca(hace(16 * 60000), false, false) === true, 'mercado cerrado: a los 16 min sí');
assert(R.carteraToca(hace(5 * 60000, 'no_permitido'), true, false) === false, 'ruta no permitida: a los 5 min NO se reintenta — nada de bucles');
assert(R.carteraToca(hace(31 * 60000, 'no_permitido'), true, false) === true, 'ruta no permitida: se reintenta a la media hora, por si Claude ya la habilitó');
assert(R.carteraToca(hace(5 * 60000, 'no_permitido'), true, true) === true, '«volver a preguntar» a mano sí reintenta la ruta vetada');

// ---- la lectura real de E*TRADE con la ruta rechazada: un solo intento y mensaje claro ----
let llamadasEtRead = 0, ultimaRuta = '';
const LE = construir(['leerCarteraEtrade', 'lecturaBroker', 'normalizarPosEtrade', 'claveCartera', 'claveContrato'], {
  etCreds: () => ({ token: 't', token_secret: 's' }),
  etDiaVencido: () => false,
  etCuentaKey: async () => 'KEY1',
  etRead: async (cr, path, query) => { llamadasEtRead++; ultimaRuta = path; return { status: 403, data: { error: 'ruta no permitida' } }; },
});
(async () => {
  const r = await LE.leerCarteraEtrade();
  igual(r.estado, 'no_permitido', 'E*TRADE con ruta rechazada por el proxy: estado no_permitido');
  igual(llamadasEtRead, 1, 'la ruta rechazada se pide UNA vez: no hay reintento en bucle dentro de la lectura');
  assert(/\/portfolio\.json$/.test(ultimaRuta), 'la ruta pedida es la oficial de cartera de E*TRADE', ultimaRuta);
  igual(r.items, [], 'con la ruta rechazada no se inventa ninguna posición');

  // sesión muerta: ni se molesta al proxy
  let tocado = 0;
  const LE2 = construir(['leerCarteraEtrade', 'lecturaBroker', 'normalizarPosEtrade', 'claveCartera', 'claveContrato'], {
    etCreds: () => ({ token: 't', token_secret: 's' }), etDiaVencido: () => true,
    etCuentaKey: async () => { tocado++; return 'K'; }, etRead: async () => { tocado++; return { status: 200, data: {} }; },
  });
  const r2 = await LE2.leerCarteraEtrade();
  assert(r2.estado === 'sesion' && tocado === 0, 'token de E*TRADE muerto: se dice y NO se llama al proxy', 'tocado=' + tocado);

  // Schwab: el path del saldo + fields=positions (la lista blanca ya lo cubre)
  let qSw = null, pathSw = '';
  const LS = construir(['leerCarteraSchwab', 'lecturaBroker', 'normalizarPosSchwab', 'claveCartera', 'claveContrato'], {
    swCreds: () => ({ token: 't' }), swVencido: () => false, swCuenta: async () => 'HASH1', desOsi,
    swRead: async (path, query) => { pathSw = path; qSw = query; return { status: 200, data: RESP_SW }; },
  });
  const r3 = await LS.leerCarteraSchwab();
  igual([pathSw, qSw], ['/trader/v1/accounts/HASH1', { fields: 'positions' }], 'Schwab: mismo path del saldo con fields=positions');
  igual(r3.items.length, 1, 'Schwab: la lectura devuelve la opción comprada');
  const LS2 = construir(['leerCarteraSchwab', 'lecturaBroker', 'normalizarPosSchwab', 'claveCartera', 'claveContrato'], {
    swCreds: () => ({ token: 't' }), swVencido: () => false, swCuenta: async () => { throw new Error('La sesión de Schwab caducó. Reconecta en Cuentas → Schwab.'); },
    swRead: async () => { throw new Error('no debería'); }, desOsi,
  });
  igual((await LS2.leerCarteraSchwab()).estado, 'sesion', 'Schwab con login semanal caducado: estado sesión, sin reventar la vista');
  const LS3 = construir(['leerCarteraSchwab', 'lecturaBroker', 'normalizarPosSchwab', 'claveCartera', 'claveContrato'], {
    swCreds: () => null, swVencido: () => false, swCuenta: async () => 'H', swRead: async () => ({ status: 200, data: {} }), desOsi,
  });
  igual((await LS3.leerCarteraSchwab()).estado, 'sin', 'Schwab sin sesión en este equipo: estado «sin» (no es un error)');

  // ════════════════ 9. LA LISTA nunca dice «no hay nada» cuando no se pudo preguntar ════════════════
  const S = construir(['seccionPosiciones', 'barraTotales', 'totalesCartera', 'itemsCartera', 'brokersLeidos',
    'casarCarteraLibro', 'claveCartera', 'claveContrato', 'textoLecturaBroker', 'lineaDifContratos',
    'tarjetaSinRegistrar', 'tarjetaSoloLibro', 'diasAlVencimiento', 'textoVencimiento', 'durTxt',
    'carteraLeidaAt', 'haceCuanto'], {
    esc, usd, colUtil, BROKER_NOMBRE, hoyNY, CART_FRESCO_MS: 30 * 60000,
    tarjetaPosicion: (p) => `<div class="card">POS ${p.symbol} ${p.strike}</div>`,
    brokersOperables: () => ['etrade', 'schwab'],
  });
  const cartOk = { etrade: { estado: 'ok', items: [e0], otros: {}, ts: Date.now() }, schwab: { estado: 'ok', items: [s0], otros: {}, ts: Date.now() } };
  const h1 = S.seccionPosiciones([], cartOk, PLANES.PLAN_10, HOY);
  assert(!/Sin posiciones abiertas/.test(h1), 'con posiciones en el bróker NO se dice «sin posiciones abiertas»');
  assert(/SIN REGISTRAR/.test(h1) && /MZ\.adoptar\(/.test(h1), 'las del bróker sin ficha salen con su botón Adoptar');
  const cartVacia = { etrade: { estado: 'ok', items: [], otros: {}, ts: Date.now() }, schwab: { estado: 'ok', items: [], otros: {}, ts: Date.now() } };
  const h2 = S.seccionPosiciones([], cartVacia, PLANES.PLAN_10, HOY);
  assert(/Sin posiciones abiertas/.test(h2) && /confirman que no hay ninguna/.test(h2), 'vacío DE VERDAD: se dice que los brókeres lo confirman', h2.slice(0, 220));
  // sin ningún bróker conectado en este equipo: se invita a conectar, no se miente
  const S0 = construir(['seccionPosiciones', 'barraTotales', 'totalesCartera', 'itemsCartera', 'brokersLeidos',
    'casarCarteraLibro', 'claveCartera', 'claveContrato', 'textoLecturaBroker', 'lineaDifContratos',
    'tarjetaSinRegistrar', 'tarjetaSoloLibro', 'diasAlVencimiento', 'textoVencimiento', 'durTxt',
    'carteraLeidaAt', 'haceCuanto'], {
    esc, usd, colUtil, BROKER_NOMBRE, hoyNY, CART_FRESCO_MS: 30 * 60000,
    tarjetaPosicion: (p) => '', brokersOperables: () => [],
  });
  const h2b = S0.seccionPosiciones([], { etrade: { estado: 'sin', items: [] }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/Conecta E\*TRADE o Schwab/.test(h2b), 'sin ningún bróker conectado: se invita a conectar en vez de afirmar que no hay nada', h2b.slice(0, 200));
  const cartCaida = { etrade: { estado: 'sin_red', detalle: 'proxy', items: [], ts: Date.now() }, schwab: { estado: 'sin', items: [] } };
  const h3 = S.seccionPosiciones([], cartCaida, PLANES.PLAN_10, HOY);
  assert(!/^(?![\s\S]*no pude preguntarle)[\s\S]*Sin posiciones abiertas/.test(h3), 'bróker caído: jamás un «sin posiciones» a secas');
  assert(/no pude preguntarle a E\*TRADE/i.test(h3), 'bróker caído: la LISTA dice a quién no se pudo preguntar', h3.slice(0, 300));
  const cartSes = { etrade: { estado: 'sesion', items: [], ts: Date.now() }, schwab: { estado: 'sin', items: [] } };
  const h4 = S.seccionPosiciones([], cartSes, PLANES.PLAN_10, HOY);
  assert(/sesión expiró/i.test(h4) && /Reconecta/.test(h4), 'sesión caducada: aviso en la lista de posiciones, no solo en Cuentas');
  const h5 = S.seccionPosiciones(LIBRO.filter(p => p.estado === 'abierta'), { etrade: { estado: 'ok', items: [{ ...e0, contratos: 3 }], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/El bróker dice ×3 y tu libro ×2/.test(h5), 'la diferencia de cantidad se muestra tal cual');
  assert(/MZ\.ajustarContratos\(1, 3, null, 3\.3\)/.test(h5), 'y ofrece ajustar el libro al bróker de un toque (misma prima: el costo medio viaja como null y no se toca)');
  // el ajuste lleva también el costo medio del bróker cuando difiere: de prima_fill cuelgan el GTC, el corte y el invertido
  const h5p = S.seccionPosiciones(LIBRO.filter(p => p.estado === 'abierta'), { etrade: { estado: 'ok', items: [{ ...e0, contratos: 3, prima_fill: 3.5 }], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/El costo medio también cambió: tu libro \$3\.30 y el bróker \$3\.50/.test(h5p) && /MZ\.ajustarContratos\(1, 3, 3\.5, 3\.3\)/.test(h5p), 'si el costo medio del bróker difiere, el ajuste lo dice y lo lleva (3.50) junto al del libro (3.30)');
  const dosFichas = LIBRO.filter(p => p.estado === 'abierta').concat([{ ...LIBRO[0], id: 7, contratos: 1 }]);
  const h5m = S.seccionPosiciones(dosFichas, { etrade: { estado: 'ok', items: [{ ...e0, contratos: 4 }], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(/El bróker dice ×4 y tu libro ×3 \(×2 \+ ×1\)/.test(h5m) && /Tienes 2 fichas de este contrato en la Mesa/.test(h5m) && !/MZ\.ajustarContratos\(/.test(h5m), 'con DOS fichas del mismo contrato (×2 + ×1) y el bróker en ×4 se avisa la suma pero NO hay botón de ajuste: igualar una sola al total duplicaría el libro');
  const h5s = S.seccionPosiciones(dosFichas, { etrade: { estado: 'ok', items: [{ ...e0, contratos: 3 }], otros: {}, ts: Date.now() }, schwab: { estado: 'sin', items: [] } }, PLANES.PLAN_10, HOY);
  assert(!/El bróker dice/.test(h5s) && (h5s.match(/POS SPY 769/g) || []).length === 2, 'dos fichas que SUMAN lo del bróker (2 + 1 = 3) no producen ningún aviso: cada una se pinta como posición normal');
  assert(/YA NO ESTÁ EN EL BRÓKER/.test(h5) && /MZ\.cerrar\(2,/.test(h5), 'la del libro que el bróker no tiene ofrece registrar la salida');
  assert(!/YA NO ESTÁ EN EL BRÓKER[\s\S]*NVDA/.test(h5), 'la de Schwab (bróker sin leer) NO se acusa de haber desaparecido');
  assert(/CARTERA ABIERTA/.test(h1) && /invertido/.test(h1) && /valor ahora/.test(h1), 'la barra de totales sale encima de la lista');
  assert(/leído hace segundos/.test(h1), 'la barra dice CUÁNDO se leyó (un dato viejo jamás se presenta como fresco)', h1.slice(h1.indexOf('cifras del bróker'), h1.indexOf('cifras del bróker') + 160));
  // caché de ayer: se pinta para no salir en blanco, pero NO sirve para acusar a nadie
  const cartVieja = { etrade: { estado: 'ok', items: [e0], otros: {}, ts: Date.now() - 20 * 3600000 }, schwab: { estado: 'sin', items: [] } };
  const h7 = S.seccionPosiciones(LIBRO.filter(p => p.estado === 'abierta' && p.broker === 'etrade'), cartVieja, PLANES.PLAN_10, HOY);
  assert(!/YA NO ESTÁ EN EL BRÓKER/.test(h7), 'con una lectura VIEJA no se acusa a ninguna posición de haber desaparecido');
  assert(/lectura vieja/.test(h7) && /leído hace \d+ h/.test(h7), 'con una lectura vieja se dice su antigüedad y que se está preguntando de nuevo');
  assert(/sin comprobar contra el bróker todavía/.test(h7), 'y las del libro quedan explícitamente SIN COMPROBAR');
  const h6 = S.seccionPosiciones([], { etrade: { estado: 'ok', items: [e0], otros: { acciones: 1, efectivo: 2, vendidas: 1 }, ts: Date.now() }, schwab: null }, PLANES.PLAN_10, HOY);
  assert(/1 en acciones/.test(h6) && /2 de efectivo/.test(h6) && /VENDIDA/.test(h6), 'acciones, efectivo y vendidas se dicen en pantalla aunque no entren a la lista');

  // ════════════════ 10. NINGUNA ORDEN sale de este camino ════════════════
  const ini = FUENTE.indexOf('Cartera abierta LEÍDA DEL BRÓKER');
  const finB = FUENTE.indexOf('function resumenPeriodo');
  assert(ini > 0 && finB > ini, 'el bloque de la cartera está donde se espera');
  const BLOQUE = FUENTE.slice(ini, finB);
  const prohibido = ['ordenPlace', 'ordenPreview', 'etPost(', 'swPost(', '/etrade/place', '/etrade/preview', '/schwab/ordenes', 'construirOrden', 'abrirOrden', 'preSalida('];
  prohibido.forEach(t => assert(!BLOQUE.includes(t), 'el camino de la cartera no toca «' + t + '»: solo LEE'));
  assert(!/sb\.from\('ordenes'\)/.test(BLOQUE), 'el camino de la cartera no escribe en la bitácora de órdenes');
  const escrituras = (BLOQUE.match(/\.(insert|update|upsert|delete)\(/g) || []);
  igual(escrituras.sort(), ['.insert(', '.update('], 'solo dos escrituras: la ficha adoptada (insert) y el ajuste de contratos (update)');
  assert(/sb\.from\('posiciones'\)[\s\S]{0,400}\.insert\(/.test(BLOQUE), 'el insert va a posiciones (la tabla PERSONAL con RLS), a ninguna otra');

  // ════════════════ 11. A1 · Cuentas y Disciplina cuentan LO MISMO ════════════════
  const U = construir(['unirOperaciones', 'resumenPeriodo', 'cerradasDesde'], { ymdNY });
  const POS_A1 = [
    // la MISMA operación registrada a mano y traída del bróker
    { id: 1, user_id: 'u', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-19', contratos: 2,
      prima_fill: 3.30, prima_salida: 4.46, estado: 'cerrada', broker: 'etrade', abierta_at: '2026-09-18T14:00:00Z',
      cerrada_at: '2026-09-18T19:00:00Z', abierta_fecha_ny: '2026-09-18', resultado_usd: 232 },
  ];
  const BT_A1 = [
    { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-19', contratos: 2,
      prima_fill: 3.30, prima_salida: 4.46, abierta_at: '2026-09-18T14:00:00Z', cerrada_at: '2026-09-18T19:00:00Z',
      resultado_usd: 230.70, fees: 1.30, clave_ext: 'k1' },
  ];
  const u1 = U.unirOperaciones(POS_A1, BT_A1);
  igual(u1.ops.length, 1, 'A1: la misma operación a mano + del bróker es UNA, no dos');
  const q1 = U.resumenPeriodo(u1.ops, '2026-09-01');
  igual([q1.n, q1.util], [1, 230.7], 'A1: la utilidad ya no se cuenta dos veces (manda el número del bróker)');
  const viejoTotal = POS_A1.concat(BT_A1).reduce((s, p) => s + p.resultado_usd, 0);
  assert(Math.abs(viejoTotal - q1.util) > 200, 'A1: el cálculo viejo (concatenar sin deduplicar) inflaba la utilidad', 'viejo=' + viejoTotal + ' nuevo=' + q1.util);
  // cierre PARCIAL: dos filas manuales del mismo contrato y la misma apertura = UNA operación
  const POS_PARC = [
    { id: 10, symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-09-26', contratos: 1, prima_fill: 2.10,
      prima_salida: 2.33, estado: 'cerrada', broker: 'schwab', abierta_at: '2026-09-22T14:00:00Z', cerrada_at: '2026-09-22T18:00:00Z',
      abierta_fecha_ny: '2026-09-22', resultado_usd: 23 },
    { id: 11, symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-09-26', contratos: 2, prima_fill: 2.10,
      prima_salida: 2.50, estado: 'cerrada', broker: 'schwab', abierta_at: '2026-09-22T14:00:00Z', cerrada_at: '2026-09-23T15:00:00Z',
      abierta_fecha_ny: '2026-09-22', resultado_usd: 80 },
  ];
  const u2 = U.unirOperaciones(POS_PARC, []);
  igual(u2.ops.length, 1, 'A1: un cierre PARCIAL se ve como UNA operación');
  const q2 = U.resumenPeriodo(u2.ops, '2026-09-01');
  igual([q2.n, q2.util, q2.winrate], [1, 103, 100], 'A1: el parcial suma sus dos tramos en una sola operación ganadora');
  // mejor/peor: un resultado nulo ya no se cuela como el peor del mes
  const q3 = U.resumenPeriodo([
    { estado: 'cerrada', cerrada_at: '2026-09-20T18:00:00Z', resultado_usd: 150 },
    { estado: 'expirada', cerrada_at: '2026-09-21T18:00:00Z', resultado_usd: -80 },
    { estado: 'cerrada', cerrada_at: '2026-09-22T18:00:00Z', resultado_usd: null },
  ], '2026-09-01');
  igual([q3.mejor, q3.peor, q3.n], [150, -80, 3], 'A1: mejor/peor ignoran las operaciones sin resultado (antes el null salía como peor)');
  igual(q3.winrate, 50, 'A1: los aciertos se miden sobre las que SÍ tienen resultado');
  const q4 = U.resumenPeriodo([{ estado: 'cerrada', cerrada_at: '2026-09-19T00:30:00Z', resultado_usd: 10 }], '2026-09-19');
  igual(q4.n, 0, 'A1: el corte del período va por fecha de NUEVA YORK (00:30Z del 19 es el 18 en NY)');
  igual(U.resumenPeriodo([], '2026-09-01').mejor, null, 'A1: sin operaciones, mejor/peor son null (no un −1e9 disfrazado)');

  // ════════════════ 12. A2 · lo que vence en Schwab sin venderse es PÉRDIDA ════════════════
  const E2 = construir(['emparejarFillsSchwab', 'fillsDeOrdenesSchwab'], { desOsi, hoyNY });
  const OSI_VIEJO = 'SPY   260919C00650000';     // venció el 2026-09-19
  const OSI_VIVO = 'SPY   261003C00700000';      // vence el 2026-10-03
  const fills = [
    { osi: OSI_VIEJO, symbol: 'SPY', expiracion: '2026-09-19', direccion: 'CALL', strike: 650, side: 'BUY', qty: 2, price: 1.50, ts: '2026-09-17T14:00:00Z', fee: 0, id: 'b1' },
    { osi: OSI_VIVO, symbol: 'SPY', expiracion: '2026-10-03', direccion: 'CALL', strike: 700, side: 'BUY', qty: 1, price: 2.00, ts: '2026-09-23T14:00:00Z', fee: 0, id: 'b2' },
  ];
  const rts = E2.emparejarFillsSchwab(fills, HOY);
  igual(rts.length, 1, 'A2: el lote vencido sin venta produce UN round-trip; el que sigue vivo no');
  const venc = rts[0];
  igual([venc.broker, venc.symbol, venc.contratos, venc.prima_salida], ['schwab', 'SPY', 2, 0], 'A2: se cierra a 0 (pérdida total)');
  cerca(venc.resultado_usd, -300, 'A2: 2 contratos a $1.50 perdidos completos = -$300');
  assert(ymdNY(venc.cerrada_at) === '2026-09-19', 'A2: la pérdida cuenta el DÍA DE SU VENCIMIENTO en NY', venc.cerrada_at);
  assert(/venc2026-09-19/.test(venc.clave_ext), 'A2: clave_ext propia del vencimiento (no choca con ninguna venta)', venc.clave_ext);
  igual(rts.expiradas.length, 1, 'A2: las vencidas quedan contadas aparte para decirlo en Cuentas');
  const rts2 = E2.emparejarFillsSchwab(fills, HOY);
  igual(rts2[0].clave_ext, venc.clave_ext, 'A2: la clave es estable → el upsert no duplica la pérdida en cada sincronización');
  // vence HOY: sigue viva hasta las 16:00 ET, no se da por perdida
  const hoyFills = [{ osi: 'SPY   260924C00660000', symbol: 'SPY', expiracion: HOY, direccion: 'CALL', strike: 660, side: 'BUY', qty: 1, price: 1.00, ts: '2026-09-24T14:00:00Z', fee: 0, id: 'b3' }];
  igual(E2.emparejarFillsSchwab(hoyFills, HOY).length, 0, 'A2: un contrato que vence HOY sigue vivo: no se declara perdido');
  // con venta normal, nada cambia respecto a la v49
  const conVenta = fills.slice(0, 1).concat([{ osi: OSI_VIEJO, symbol: 'SPY', expiracion: '2026-09-19', direccion: 'CALL', strike: 650, side: 'SELL', qty: 2, price: 2.10, ts: '2026-09-18T15:00:00Z', fee: 0, id: 's1' }]);
  const rts3 = E2.emparejarFillsSchwab(conVenta, HOY);
  igual(rts3.length, 1, 'A2: un lote vendido normal sigue dando UN round-trip, no dos');
  cerca(rts3[0].resultado_usd, 120, 'A2: el round-trip normal no se toca (2 × (2.10−1.50) × 100 = $120)');
  igual(rts3.expiradas.length, 0, 'A2: nada que vender = nada que expirar');
  // un cierre PARCIAL antes del vencimiento: se vende 1 y vence 1
  const parcial = [
    { osi: OSI_VIEJO, symbol: 'SPY', expiracion: '2026-09-19', direccion: 'CALL', strike: 650, side: 'BUY', qty: 2, price: 1.50, ts: '2026-09-17T14:00:00Z', fee: 0, id: 'b1' },
    { osi: OSI_VIEJO, symbol: 'SPY', expiracion: '2026-09-19', direccion: 'CALL', strike: 650, side: 'SELL', qty: 1, price: 2.00, ts: '2026-09-18T15:00:00Z', fee: 0, id: 's1' },
  ];
  const rts4 = E2.emparejarFillsSchwab(parcial, HOY);
  igual(rts4.length, 2, 'A2: vendido uno y vencido el otro = dos tramos');
  cerca(rts4.reduce((s, r) => s + r.resultado_usd, 0), -100, 'A2: +$50 del vendido y −$150 del vencido = −$100');
  // Schwab solo entrega órdenes FILLED: de ahí venía el agujero
  igual(E2.fillsDeOrdenesSchwab([{ status: 'CANCELED', orderLegCollection: [{ instrument: { assetType: 'OPTION', symbol: OSI_VIEJO }, instruction: 'BUY_TO_OPEN' }] }]).length, 0, 'A2: una orden cancelada no es un fill (eso no cambia)');
  igual(E2.fillsDeOrdenesSchwab([{ orderId: 7, status: 'FILLED', filledQuantity: 1, price: 1.5, closeTime: '2026-09-17T14:00:00Z', orderLegCollection: [{ instrument: { assetType: 'OPTION', symbol: OSI_VIEJO }, instruction: 'BUY_TO_OPEN' }] }]).length, 1, 'A2: la compra llena sigue leyéndose igual');

  // ════════════════ 13. A3 · la venta sin compra deja constancia ════════════════
  const E3 = construir(['emparejarEtrade'], {});
  const tx = (id, tipo, qty, price, fecha, extra) => ({ transactionId: id, transactionType: tipo, transactionDate: Date.parse(fecha),
    brokerage: { quantity: qty, price, fee: 0, product: Object.assign({ securityType: 'OPTN', symbol: 'SPY', callPut: 'CALL', strikePrice: 650, expiryYear: 26, expiryMonth: 9, expiryDay: 19 }, extra || {}) } });
  const soloVenta = E3.emparejarEtrade([tx(2, 'Sold To Close', -2, 2.10, '2026-09-18')]);
  igual(soloVenta.length, 0, 'A3: una venta sin compra no inventa ningún round-trip');
  igual(soloVenta.huerfanas.length, 1, 'A3: pero queda CONSTANCIA de esa venta huérfana');
  igual([soloVenta.huerfanas[0].symbol, soloVenta.huerfanas[0].contratos, soloVenta.huerfanas[0].prima_salida], ['SPY', 2, 2.10], 'A3: la constancia trae contrato, cantidad y precio de la venta');
  const completo = E3.emparejarEtrade([tx(1, 'Bought To Open', 2, 1.50, '2026-09-17'), tx(2, 'Sold To Close', -2, 2.10, '2026-09-18')]);
  igual([completo.length, completo.huerfanas.length], [1, 0], 'A3: con su compra, nada queda huérfano (la v49 sigue igual)');
  cerca(completo[0].resultado_usd, 120, 'A3: el round-trip de siempre no cambia');
  const mitad = E3.emparejarEtrade([tx(1, 'Bought To Open', 1, 1.50, '2026-09-17'), tx(2, 'Sold To Close', -3, 2.10, '2026-09-18')]);
  igual([mitad.length, mitad.huerfanas.length, mitad.huerfanas[0].contratos], [1, 1, 2], 'A3: si solo hay compra para parte de la venta, el resto queda anotado');
  const expET = E3.emparejarEtrade([tx(1, 'Bought To Open', 2, 1.50, '2026-09-17'), tx(2, 'Option Expired', 2, 0, '2026-09-19')]);
  cerca(expET[0].resultado_usd, -300, 'A3/A2: en E*TRADE el vencimiento ya entraba como venta a 0 (−$300) y sigue igual');

  // ════════════════ 14. mercado abierto/cerrado (el ritmo de B8) ════════════════
  const MA = construir(['mercadoAbiertoNY'], { haceCuanto: (iso) => ({ txt: '', min: (Date.now() - Date.parse(iso)) / 60000 }) });
  const ahora = new Date().toISOString();
  assert(MA.mercadoAbiertoNY({ sesion: 'regular', latido_at: ahora }) === true, 'el latido fresco del worker manda: sesión regular = abierto');
  assert(MA.mercadoAbiertoNY({ sesion: 'cerrado', latido_at: ahora }) === false, 'latido fresco con sesión cerrada = cerrado');
  const viejo = new Date(Date.now() - 60 * 60000).toISOString();
  igual(typeof MA.mercadoAbiertoNY({ sesion: 'regular', latido_at: viejo }), 'boolean', 'con latido viejo no se cree al worker: decide el reloj de NY');
  igual(typeof MA.mercadoAbiertoNY(null), 'boolean', 'sin latido, el reloj de NY decide');


  // ════════════════ 15. el módulo ENTERO sigue cargando y la v49 sigue intacta ════════════════
  // Se evalúa app/main.js completo en un DOM de juguete: si la v50 rompiera el orden
  // de carga o pisara window.MZ (a Andrés se le quedarían los botones muertos), sale aquí.
  const nodo = () => ({ innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, focus() {}, forEach() {} });
  const almacen = {};
  const canal = { on() { return canal; }, subscribe() { return canal; } };
  const consulta = () => { const q = { select: () => q, eq: () => q, in: () => q, not: () => q, order: () => q, limit: () => q,
    insert: () => q, update: () => q, upsert: () => q, delete: () => q, maybeSingle: () => q, single: () => q,
    then: (f) => Promise.resolve({ data: [], error: null }).then(f) }; return q; };
  const win = { MESA2: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', PROXY_URL: 'https://proxy' },
    supabase: { createClient: () => ({ from: consulta, channel: () => canal,
      auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) },
    localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } },
    addEventListener() {}, location: { hash: '#/copiloto', reload() {} }, Intl, Date, Math, JSON,
    setTimeout, setInterval: () => 0, clearInterval() {}, console, fetch: () => Promise.reject(new Error('sin red')),
    navigator: { serviceWorker: { register: () => Promise.resolve(), addEventListener() {} } },
    document: { querySelector: () => nodo(), querySelectorAll: () => [], createElement: () => nodo(),
      addEventListener() {}, body: nodo(), currentScript: { src: './app/main.js?v=54' } } };
  win.window = win;
  vm.createContext(win);
  let cargo = true;
  try { vm.runInContext(FUENTE, win, { filename: 'main.js' }); }
  catch (e) { cargo = false; falla('app/main.js entero se evalúa sin reventar', String(e && e.message)); }
  if (cargo) {
    ok('app/main.js entero se evalúa sin reventar (orden de carga intacto)');
    const ev = (t) => vm.runInContext(t, win);
    const v49 = ['abrirFill', 'guardarFill', 'cerrar', 'copiar', 'quitarSenal', 'restaurarSenal', 'abrirCuenta', 'salir',
      'chartAbrir', 'chartGuardarTarget', 'abrirOrden', 'ordenPreview', 'ordenPlace', 'cancelarOrden', 'cortarPosicion',
      'elegirPlataforma', 'conectar', 'etSync', 'swSync', 'periodo', 'pinOrdenes', 'armar', 'elegirFoco'];
    const rotos = v49.filter(k => typeof win.MZ[k] !== 'function');
    igual(rotos, [], 'la v50 NO pisa window.MZ: Plan 10/35, órdenes, corte, GTC, señales, charts y Disciplina siguen enganchados');
    const nuevas = ['adoptar', 'adoptarConfirmar', 'cerrarAdoptar', 'ajustarContratos', 'carteraRefrescar'];
    igual(nuevas.filter(k => typeof win.MZ[k] !== 'function'), [], 'las 5 puertas nuevas de la v50 quedan colgadas de window.MZ');
    assert(ev('typeof _cart') === 'object' && ev('typeof cargarCartera') === 'function', 'el estado de la cartera y su cargador viven en el módulo');
    const htmlReal = ev('seccionPosiciones([], { etrade:{estado:"sin_red",items:[],ts:Date.now()}, schwab:{estado:"sin",items:[]} }, PLANES.PLAN_10, "2026-09-24")');
    assert(/no pude preguntarle a E\*TRADE/i.test(htmlReal), 'dentro del módulo REAL, un bróker caído nunca se presenta como «no tienes nada»');
    const vacioReal = ev('seccionPosiciones([], { etrade:{estado:"sin",items:[]}, schwab:{estado:"sin",items:[]} }, PLANES.PLAN_35, "2026-09-24")');
    assert(/Conecta E\*TRADE o Schwab/.test(vacioReal), 'sin brókeres conectados se invita a conectar (no se afirma que no haya nada)');
  }

  // ---------- resumen ----------
  console.log('');
  console.log(fallos ? `${fallos} FALLA(S) · ${verdes} asserts verdes` : `${verdes} asserts verdes`);
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
