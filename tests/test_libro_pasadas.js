#!/usr/bin/env node
/* Pruebas de la v65 rev · las pasadas del historial de E*TRADE y Schwab al libro, en un MUNDO de juguete con reloj propio.
   Revisión 2026-10-17 (hallazgos confirmados por los jueces, medidos con las funciones reales):
     [1] en sesión, cada 2 min se releían los 180 días ENTEROS (12 llamadas a E*TRADE, ~357 KB que bajan, el libro entero
         y los round-trips de broker_trades que suben) para escribir 0 a 20 fills → pasada LIGERA (4 días, solo al
         libro) entre dos COMPLETAS (180 días, con broker_trades) que vuelven a su tope de 10 min; Cuentas dice la verdad
         de las dos.
   El mundo: un E*TRADE que pagina de 50 en 50 como el real (~460 fills desde el 31-jul más 20 transacciones que no son
   opciones), un Schwab que filtra por fromEnteredTime/toEnteredTime, una base con la clave única de verdad
   (ignoreDuplicates) y un reloj que avanza a mano (Date de juguete). Las funciones son las REALES del fuente
   (casa_pruebas.js); las que aún no existen en un fuente viejo simplemente no se cargan, para que estas pruebas
   FALLEN por comportamiento (y no por una excepción) al correrlas contra la versión sin el arreglo.
     [2] con la app OCULTA no se leía al bróker solo desde el timer: ruta() cada 60 s → Diario/Cuentas → sincronizar lo
         hacía cada 2 min toda la sesión; y el freno de 15 min tras un «expirado» tampoco valía en ese camino (16
         intentos en 30 min). Los dos frenos viven ahora en pasadaSyncAhora, por donde pasan todos.
     [4] a las 16:00 (13:00 en media sesión) el latido pasa a «post» y el ritmo saltaba a 15 min / 10 min: un 0DTE cerrado
         a las 15:59:30 entraba al libro hacia las 16:14 → una o dos pasadas con el ritmo de sesión justo tras el cierre.
   Uso: node test_libro_pasadas.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_libro_pasadas.js');
const { FUENTE, assert, igual, construir, existeConst, localStorageFalso, sbFalso, respirar } = C;

const existe = (n) => new RegExp('^(?:async )?function ' + n + '\\s*\\(', 'm').test(FUENTE);
const MIN = 60000;
const NY_11 = Date.UTC(2026, 9, 16, 15, 0, 0);   // viernes 16-oct-2026, 11:00 ET (EDT = UTC-4)

// ---------- E*TRADE de juguete: transacciones con la forma de la API (ListTransactions v1), DESC como la real ----------
function generarTxEt(nOpt, nOtras, hasta) {
  const txs = [];
  const t0 = Date.UTC(2026, 6, 31, 4), t1 = Date.UTC(2026, 9, 16, 4);   // medianoche ET (transactionDate es una FECHA)
  let id = 26210000000000;
  const dias = Math.round((t1 - t0) / 86400000);
  for (let i = 0; i < nOpt; i++) {
    const d = t0 + Math.floor(i * (dias + 1) / nOpt) * 86400000;
    txs.push(txEt(id++, d, i % 2 === 0, 640 + (Math.floor(i / 2) % 20)));
  }
  for (let i = 0; i < nOtras; i++) {
    const d = t0 + i * 4 * 86400000;
    txs.push({ transactionId: id++, transactionDate: d, amount: 0.12, description: 'INTEREST ON CREDIT BALANCE', transactionType: 'Interest Income',
      brokerage: { product: { symbol: '', securityType: '' }, quantity: 0, price: 0, fee: 0 } });
  }
  return txs;
}
function txEt(id, d, compra, strike) {
  return { transactionId: id, transactionDate: d, postDate: d, amount: compra ? -151.95 : 171.05,
    description: (compra ? 'BOUGHT' : 'SOLD') + ' 1 CALL SPY 10/16/26 ' + strike + '.000', transactionType: compra ? 'Bought To Open' : 'Sold To Close',
    brokerage: { product: { symbol: 'SPY', securityType: 'OPTN', callPut: 'CALL', expiryYear: 26, expiryMonth: 10, expiryDay: 16, strikePrice: strike },
      quantity: compra ? 1 : -1, price: compra ? 1.51 : 1.72, fee: 0.95 } };
}
// ---------- Schwab de juguete: órdenes FILLED de opciones con su ejecución ----------
function ordenSw(id, ms, compra) {
  const t = new Date(ms).toISOString();
  return { orderId: id, status: 'FILLED', enteredTime: t, closeTime: t, filledQuantity: 1, price: compra ? 2.1 : 2.4,
    orderLegCollection: [{ legId: 1, instruction: compra ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE', instrument: { assetType: 'OPTION', symbol: 'QQQ   261016C00600000' } }],
    orderActivityCollection: [{ activityId: id * 10, executionLegs: [{ legId: 1, quantity: 1, price: compra ? 2.1 : 2.4, time: t }] }] };
}
function generarOrdenesSw(n) {
  const out = [], t0 = Date.UTC(2026, 3, 20, 14), t1 = NY_11 - 30 * MIN;
  for (let i = 0; i < n; i++) out.push(ordenSw(5000 + i, t0 + Math.floor(i * (t1 - t0) / n), i % 2 === 0));
  return out;
}

// ---------- el mundo ----------
const FN_MUNDO = ['etradeSincronizar', 'etradeSincronizarImpl', 'etradeSincronizarLigera', 'pasadaSyncAhora', 'appOcultaSync', 'ultimaPasadaSync', 'tipoPasadaSync',
  'syncTtlAhora', 'ttlSyncLibro', 'sesionNY', 'sesionNYLibro', 'ritmoSyncLibro', 'resumenSyncGuardado', 'etradeTransacciones', 'etRead', 'etRenovar',
  'etMarcarMuerto', 'etError', 'etCuentaKey', 'emparejarEtrade', 'fillsDeTransaccionesEtrade', 'ladoFillEtrade', 'fechaNyTransaccion', 'guardarFills',
  'textoErrorFills', 'textoErrorTabla', 'etDiaVencido',
  'schwabSincronizar', 'schwabSincronizarImpl', 'schwabSincronizarLigera', 'schwabOrdenesHistoricas', 'swMensajeError', 'fillsDeOrdenesSchwab',
  'emparejarFillsSchwab', 'vencidasASobrar', 'fillsDeOrdenesSchwabLibro', 'desOsi',
  'syncBrokersFondo', 'cadenciaSyncLibro', 'ultimaSyncBroker', 'syncFondoResultado', 'sincronizarLibroFondo'];
const CONST_MUNDO = ['ET_K', 'ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'ET_DIAS_HIST', 'ET_DIAS_LIGERA', 'ET_TOPE_MS', 'SW_DIAS_HIST', 'SW_TRAMO_DIAS',
  'SW_K_SYNC', 'SW_K_SYNC_LIG', 'SW_DIAS_LIGERA', 'SW_K', 'SYNC_EXPIRADO_MS', 'LIBRO_SYNC_SESION_MS', 'LIBRO_SYNC_FUERA_MS', 'LIBRO_TRAS_CIERRE_MS', '_syncFondo',
  '_etSyncEnVuelo', '_etRenovando', '_swSyncEnVuelo', '_ultimaRegular'];

function armarMundo(op) {
  op = Object.assign({ ses: 'regular', visible: 'visible', T: NY_11, et: true, sw: false, swAcct: true, nOpt: 460, nOtras: 20, nSw: 200, hash: '#/tickers', vista: 'diario' }, op || {});
  const W = { T: op.T, ses: op.ses, visible: op.visible, txs: generarTxEt(op.nOpt, op.nOtras), ordenes: generarOrdenesSw(op.nSw),
    et401: false, etFalla: false, renew: { status: 200, data: { ok: true } }, sw401: false, hash: op.hash,
    reg: { et: [], sw: [], swCuenta: 0, sb: [], inval: 0, repintar: 0, diario: 0 } };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(W.T); } static now() { return W.T; } }
  const haceCuanto = (iso) => {
    if (!iso) return { txt: 'sin dato', min: Infinity };
    const min = (W.T - new Date(iso).getTime()) / 60000;
    if (min < 1) return { txt: 'hace segundos', min };
    if (min < 60) return { txt: `hace ${Math.round(min)} min`, min };
    return { txt: `hace ${Math.floor(min / 60)} h`, min };
  };
  const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso || W.T)); } catch (_) { return ''; } };
  const hoyNY = () => ymdNY(new Date(W.T).toISOString());
  const alm = {};
  if (op.et) { alm.mz_et_tok = 't'; alm.mz_et_sec = 's'; alm.mz_et_dia = hoyNY(); }
  if (op.sw && op.swAcct) alm.mz_sw_acct = 'h1';
  const ls = localStorageFalso(alm);
  // proxy de juguete: lista de cuentas, transacciones paginadas de 50 (con marker) que respetan startDate, renew y /diag
  const etProxy = async (ruta, body) => {
    W.reg.et.push({ t: W.T, ruta, path: body && body.path, query: body && body.query });
    if (ruta === '/diag') return { status: 200, data: {} };
    if (ruta === '/etrade/renew') return W.renew;
    if (ruta !== '/etrade/read') return { status: 404, data: {} };
    if (W.et401) return { status: 401, data: {} };
    if (W.etFalla) return { status: 500, data: { error: 'E*TRADE 500' } };
    if (body.path === '/v1/accounts/list.json') return { status: 200, data: { AccountListResponse: { Accounts: { Account: [{ accountIdKey: 'k1', accountStatus: 'ACTIVE' }] } } } };
    const q = body.query || {};
    const sd = String(q.startDate || ''), desdeMs = sd.length === 8 ? new Date(Number(sd.slice(4)), Number(sd.slice(0, 2)) - 1, Number(sd.slice(2, 4))).getTime() : 0;
    const todas = W.txs.filter(t => t.transactionDate >= desdeMs).sort((a, b) => b.transactionDate - a.transactionDate || b.transactionId - a.transactionId);
    const ini = q.marker ? Number(q.marker) : 0, n = Number(q.count) || 50;
    const arr = todas.slice(ini, ini + n), mas = ini + n < todas.length;
    if (!arr.length) return { status: 204, data: null };
    return { status: 200, data: { TransactionListResponse: { moreTransactions: mas, totalCount: todas.length, Transaction: arr,
      next: mas ? 'https://api.etrade.com/v1/accounts/k1/transactions?marker=' + (ini + n) + '&count=50' : undefined, marker: mas ? String(ini + n) : undefined } } };
  };
  const swLlamar = async (ruta, body) => {
    const q = (body && body.query) || {};
    W.reg.sw.push({ t: W.T, ruta, query: q });
    if (W.sw401) return { status: 401, data: { error: 'Schwab sin sesión' } };
    const a = Date.parse(q.fromEnteredTime), b = Date.parse(q.toEnteredTime);
    return { status: 200, data: JSON.parse(JSON.stringify(W.ordenes.filter(o => { const t = Date.parse(o.enteredTime); return t >= a && t <= b; }))) };
  };
  // base de juguete con la clave única (user_id, broker, clave_ext): ignoreDuplicates devuelve solo las nuevas
  const unicas = { fills: new Set(), broker_trades: new Set() };
  W.unicas = unicas;
  const sb = sbFalso((tabla, cadena) => {
    const opn = cadena.map(c => c[0]).find(m => ['upsert', 'delete', 'insert', 'update'].includes(m)) || 'select';
    const up = cadena.find(c => c[0] === 'upsert');
    W.reg.sb.push({ t: W.T, tabla, op: opn, n: up ? up[1][0].length : 0 });
    if (up) {
      const nuevas = up[1][0].filter(f => { const k = f.user_id + '|' + f.broker + '|' + f.clave_ext; if (unicas[tabla].has(k)) return false; unicas[tabla].add(k); return true; });
      return { data: nuevas.map((_, i) => ({ id: i + 1 })), error: null };
    }
    return { data: [], error: null };
  });
  const deps = {
    Date: FakeDate, haceCuanto, ymdNY, hoyNY, localStorage: ls, URL,
    etCreds: () => (ls.getItem('mz_et_tok') ? { token: 't', token_secret: 's' } : null),
    swCreds: () => (op.sw ? { token: 't', refresh: 'r' } : null), swVencido: () => false,
    swCuenta: async () => { W.reg.swCuenta++; return 'h1'; }, swLlamar,
    sesionActiva: { user: { id: 'u' } }, sb, etProxy,
    libroInvalidar: () => { W.reg.inval++; }, libroRepintarPronto: () => { W.reg.repintar++; },
    document: { get visibilityState() { return W.visible; }, querySelector: () => null },
    location: { get hash() { return W.hash; } },
    vistaDiario: () => { W.reg.diario++; },
  };
  const fns = FN_MUNDO.filter(existe), consts = CONST_MUNDO.filter(existeConst);
  const M = construir(fns, deps, { consts,
    prefijo: 'let _hbUltimo = null; let _cuentasVista = ' + JSON.stringify(op.vista) + '; function __hb(h) { _hbUltimo = h; }', extras: ['__hb'] });
  // el latido del worker: fresco, con la sesión que diga el mundo (como lo deja ruta() en _hbUltimo)
  const latir = () => M.__hb({ sesion: W.ses === 'extendida' ? 'post' : W.ses, latido_at: new Date(W.T - 20000).toISOString() });
  latir();
  const llamadasEt = (desde) => W.reg.et.filter(x => x.t >= (desde || 0) && x.ruta === '/etrade/read');
  const lecturasTx = (desde) => llamadasEt(desde).filter(x => /transactions/.test(x.path || ''));
  const escriturasBT = (desde) => W.reg.sb.filter(x => x.t >= (desde || 0) && x.tabla === 'broker_trades');
  const upsertsFills = (desde) => W.reg.sb.filter(x => x.t >= (desde || 0) && x.tabla === 'fills' && x.op === 'upsert');
  const guardado = (k) => { try { return JSON.parse(ls.getItem(k) || 'null'); } catch (_) { return null; } };
  const correr = async () => { for (let i = 0; i < 25; i++) await respirar(); };
  return { M, W, ls, latir, llamadasEt, lecturasTx, escriturasBT, upsertsFills, guardado, correr, fns };
}

(async () => {
  // ════════════════ 0. [1] las funciones PURAS de las dos pasadas ════════════════
  if (existe('tipoPasadaSync')) {
    const P = construir(['ultimaPasadaSync', 'tipoPasadaSync', 'resumenHistorialSync', 'resumenSyncGuardado'], {}, { consts: ['ET_SYNC_TTL'].concat(existeConst('SYNC_EXPIRADO_MS') ? ['SYNC_EXPIRADO_MS'] : []) });
    const prev = { ts: 1000, resumen: { estado: 'ok', txs: 9 } };
    igual(P.ultimaPasadaSync(null, { ts: 5000, estado: 'ok' }), null, 'ultimaPasadaSync: sin completa guardada → null (la próxima es completa, aunque haya una ligera)');
    const tse = (x) => x && { tc: x.tc, ts: x.ts, estado: x.estado };
    igual(tse(P.ultimaPasadaSync(prev, null)), { tc: 1000, ts: 1000, estado: 'ok' }, 'solo la completa: su hora y su estado');
    igual(tse(P.ultimaPasadaSync(prev, { ts: 3000, estado: 'error' })), { tc: 1000, ts: 3000, estado: 'error' }, 'una ligera POSTERIOR manda en la hora y el estado (la completa sigue en tc)');
    igual(tse(P.ultimaPasadaSync(prev, { ts: 500, estado: 'expirado' })), { tc: 1000, ts: 1000, estado: 'ok' }, 'una ligera ANTERIOR a la completa no cuenta');
    const u = (tc, ts, estado) => ({ tc, ts, estado: estado || 'ok' });
    const T0 = 100 * MIN;
    igual([P.tipoPasadaSync(null, T0, 2 * MIN, false), P.tipoPasadaSync(u(T0, T0), T0 + 1, 2 * MIN, true)], ['completa', 'completa'], 'tipoPasadaSync: sin completa guardada o con forzar → completa');
    igual(P.tipoPasadaSync(u(T0, T0), T0 + 10 * MIN, 2 * MIN, false), 'completa', 'la completa vencida (10 min) → completa');
    igual(P.tipoPasadaSync(u(T0, T0 + 9 * MIN), T0 + 10 * MIN, 2 * MIN, false), 'completa', '…aunque haya una ligera de hace 1 min');
    igual(P.tipoPasadaSync(u(T0, T0 + 3 * MIN), T0 + 4 * MIN, 2 * MIN, false), 'guardada', 'dentro del tope de ahora (2 min en sesión) → guardada, sin preguntar');
    igual(P.tipoPasadaSync(u(T0, T0 + 3 * MIN), T0 + 5 * MIN, 2 * MIN, false), 'ligera', 'pasado el tope, con la completa al día → ligera');
    igual(P.tipoPasadaSync(u(T0, T0), T0 + 5 * MIN, 10 * MIN, false), 'guardada', 'fuera de sesión (tope = el de la completa) nunca hay ligera');
    igual(P.resumenHistorialSync(prev, { ts: 3000, estado: 'ok', fills: 2 }), { estado: 'ok', txs: 9, lig: { ts: 3000, estado: 'ok', fills: 2, fills_err: null, detalle: null } }, 'resumenHistorialSync: el resumen de la completa con la ligera posterior en `lig`');
    igual([P.resumenHistorialSync(prev, { ts: 900, estado: 'ok' }), P.resumenHistorialSync(null, { ts: 3000 })], [{ estado: 'ok', txs: 9 }, null], 'sin `lig` si la ligera es anterior; null sin completa');
    igual([P.tipoPasadaSync(u(T0, T0 + 3 * MIN, 'expirado'), T0 + 6 * MIN, 2 * MIN, false), P.tipoPasadaSync(u(T0, T0 + 3 * MIN, 'expirado'), T0 + 17 * MIN, 2 * MIN, false), P.tipoPasadaSync(u(T0, T0 + 3 * MIN, 'expirado'), T0 + 18 * MIN + 1, 2 * MIN, false)],
      ['guardada', 'guardada', 'completa'], '[2] tras un «expirado» (de la completa o de la ligera) no se insiste hasta 15 min después; luego, la completa (aunque la completa venciera antes)');
    igual(P.tipoPasadaSync(u(T0, T0 + 3 * MIN, 'expirado'), T0 + 4 * MIN, 2 * MIN, true), 'completa', '[2] «sincronizar» (forzar) pasa igual');
    if (existe('ritmoSyncLibro')) {
      const R = construir(['ritmoSyncLibro'], {}, { consts: ['LIBRO_TRAS_CIERRE_MS'] });
      const A = 1000 * MIN;
      igual([R.ritmoSyncLibro('regular', 0, A, false), R.ritmoSyncLibro('extendida', A - 3 * MIN, A, false), R.ritmoSyncLibro('extendida', A - 4 * MIN, A, false),
        R.ritmoSyncLibro('extendida', 0, A, true), R.ritmoSyncLibro('cerrado', 0, A, false), R.ritmoSyncLibro(null, 0, A, false)],
        ['regular', 'regular', 'extendida', 'regular', 'cerrado', null], '[4] ritmoSyncLibro: regular en sesión, en los 4 min tras la última vez que se vio, y mientras la última pasada guardada sea de la sesión; si no, la sesión tal cual');
    } else C.falla('[4] no existe ritmoSyncLibro: tras el cierre el ritmo salta a 15 min');
    igual([P.resumenSyncGuardado(prev), P.resumenSyncGuardado(null)], [{ estado: 'ok', txs: 9, cambio: false }, { cambio: false }], 'resumenSyncGuardado: lo guardado sin cambio (y sin inventar un estado si no hay nada)');
  } else C.falla('[1] no existe tipoPasadaSync: no hay pasada ligera');

  // ════════════════ 1. [1] la primera pasada es COMPLETA; la de 2 min después, LIGERA ════════════════
  {
    const X = armarMundo();
    let r = await X.M.etradeSincronizar();
    const t0 = X.W.T;
    igual([r.estado, r.txs, r.dias], ['ok', 480, 180], 'sin nada guardado: pasada COMPLETA de 180 días (480 transacciones)');
    igual([X.llamadasEt().length, X.lecturasTx().length, X.escriturasBT().map(x => x.op).join()], [11, 10, 'delete,upsert'], 'la completa: list.json + 10 páginas de transacciones; y los round-trips a broker_trades (autolimpieza + upsert)');
    const sync0 = X.ls.getItem('mz_et_sync2');
    // 2 min y 5 s después, en sesión, sin nada nuevo en E*TRADE
    X.W.T += 2 * MIN + 5000; X.latir();
    const t1 = X.W.T;
    r = await X.M.etradeSincronizar();
    const tx1 = X.lecturasTx(t1);
    igual(tx1.length, 1, 'en sesión, a los 2 min: UNA sola página de transacciones (la LIGERA), no las 10 de los 180 días');
    const sd = tx1[0] && tx1[0].query.startDate, d4 = new Date(t1 - 4 * 86400000);
    igual(sd, String(d4.getMonth() + 1).padStart(2, '0') + String(d4.getDate()).padStart(2, '0') + d4.getFullYear(), 'y pide solo los últimos 4 días (startDate = hoy − 4 d)');
    igual(X.escriturasBT(t1).length, 0, 'la ligera NO toca broker_trades: ni el delete de autolimpieza ni el upsert de round-trips (un FIFO de 4 días emparejaría mal)');
    const up1 = X.upsertsFills(t1);
    assert(up1.length === 1 && up1[0].n > 0 && up1[0].n <= 50, 'y sube al libro solo las ejecuciones de esos días, en un upsert (' + (up1[0] && up1[0].n) + ' filas frente a las 460 de la completa)');
    assert(X.ls.getItem('mz_et_sync2') === sync0, 'no pisa el resumen de la completa (mz_et_sync2: lo que enseña Cuentas)');
    const lig = X.guardado('mz_et_sync_lig');
    igual([lig && lig.estado, lig && lig.ts, lig && lig.fills], ['ok', t1, 0], 'su hora y su resultado van a su propia clave (mz_et_sync_lig)');
    igual([r.cambio, r.estado, r.txs], [false, 'ok', 480], 'devuelve el resumen de la completa con cambio: false (nada nuevo)');
    igual(X.W.reg.et.filter(x => x.t >= t1 && x.ruta === '/diag').length, 0, 'y, sin nada que contar, no escribe en la bitácora del proxy (el proxy ya anota cada lectura)');
    // la cuenta: la primera ligera la pidió una vez y la deja guardada; la siguiente ya no pide list.json
    X.W.T += 2 * MIN + 5000; X.latir();
    const t2 = X.W.T;
    await X.M.etradeSincronizar();
    igual(X.llamadasEt(t2).map(x => /list\.json/.test(x.path) ? 'list' : 'tx'), ['tx'], 'con la cuenta ya guardada (mz_et_acct), la ligera es UNA llamada a E*TRADE');
    // entra una ejecución nueva hoy: la ligera la escribe, avisa (cambio) e invalida la caché del libro
    X.W.txs.push(txEt(26299999999999, Date.UTC(2026, 9, 16, 4), true, 655));
    X.W.T += 2 * MIN + 5000; X.latir();
    const t3 = X.W.T, inv0 = X.W.reg.inval;
    r = await X.M.etradeSincronizar();
    igual([r.cambio, X.W.reg.inval - inv0, (X.guardado('mz_et_sync_lig') || {}).fills], [true, 1, 1], 'una ejecución nueva: la ligera la escribe (fills: 1), devuelve cambio: true e invalida la caché del libro');
    igual(X.W.reg.et.filter(x => x.t >= t3 && x.ruta === '/diag').length, 1, 'y eso sí va a la bitácora (solo contadores)');
    // dentro de los 2 min: guardada, sin preguntar
    X.W.T += 60000; X.latir();
    const t4 = X.W.T;
    r = await X.M.etradeSincronizar();
    igual([X.W.reg.et.filter(x => x.t >= t4).length, r.cambio], [0, false], 'al minuto de la ligera: no se pregunta nada (tope de 2 min en sesión)');
    // a los 10 min de la completa: COMPLETA otra vez, aunque haya una ligera reciente
    X.W.T = t0 + 10 * MIN + 1000; X.latir();
    const t5 = X.W.T;
    r = await X.M.etradeSincronizar();
    igual([X.lecturasTx(t5).length, X.escriturasBT(t5).length > 0, JSON.parse(X.ls.getItem('mz_et_sync2')).ts], [10, true, t5], 'a los 10 min de la completa toca la COMPLETA (180 días y round-trips), con su hora nueva en mz_et_sync2');
  }

  // ════════════════ 2. [1] la carga de una sesión: 30 min con el timer, el Diario abierto y ruta() cada 60 s ════════════════
  {
    const X = armarMundo({ hash: '#/cuentas', vista: 'diario' });
    const t0 = X.W.T;
    const pasadas = [];   // [inicio, 'completa' | 'ligera']
    const lecturas0 = () => X.lecturasTx().length;
    for (let s = 0; s < 30 * 4; s++) {   // tic de 15 s durante 30 min
      X.latir();
      const antes = lecturas0();
      if (X.M.syncBrokersFondo) X.M.syncBrokersFondo();
      if (s % 4 === 0 && X.M.sincronizarLibroFondo) X.M.sincronizarLibroFondo();   // ruta() cada 60 s → vistaDiario → sincronizarLibroFondo
      await X.correr();
      const n = lecturas0() - antes;
      if (n) pasadas.push([X.W.T - t0, n >= 5 ? 'completa' : 'ligera']);
      X.W.T += 15000;
    }
    const completas = pasadas.filter(p => p[1] === 'completa'), ligeras = pasadas.filter(p => p[1] === 'ligera');
    igual(completas.length, 3, '30 min de sesión: 3 pasadas COMPLETAS (una cada 10 min, como en la v64), no una cada 2 min');
    assert(completas.every((p, i) => !i || p[0] - completas[i - 1][0] >= 10 * MIN), 'nunca dos completas a menos de 10 min');
    assert(ligeras.length >= 10 && ligeras.length <= 12, 'entre medias, la LIGERA cada ~2 min (' + ligeras.length + ')');
    assert(pasadas.every((p, i) => !i || p[0] - pasadas[i - 1][0] >= 2 * MIN), 'nunca dos lecturas a E*TRADE a menos de 2 min');
    const llamadas = X.llamadasEt().length;
    assert(llamadas <= 3 * 11 + 14, 'en total ≤ ' + (3 * 11 + 14) + ' llamadas a E*TRADE en 30 min (' + llamadas + '; cada 2 min la completa eran ~165)');
    igual(X.escriturasBT().filter(x => x.op === 'upsert').length, 3, 'broker_trades se escribe solo con las completas (3 upserts en 30 min, no 15)');
    const filasSubidas = X.upsertsFills().reduce((a, x) => a + x.n, 0);
    assert(filasSubidas < 3 * 460 + 12 * 50, 'filas reenviadas al libro: ' + filasSubidas + ' (antes ~6.900 en 30 min)');
  }

  // ════════════════ 3. [1] fuera de sesión no hay ligera: la completa cada 10 min, como en la v64 ════════════════
  {
    const X = armarMundo({ ses: 'cerrado', T: Date.UTC(2026, 9, 16, 22, 0, 0) });
    await X.M.etradeSincronizar();
    X.W.T += 3 * MIN; X.latir();
    const t1 = X.W.T;
    await X.M.etradeSincronizar();
    igual(X.W.reg.et.filter(x => x.t >= t1).length, 0, 'mercado cerrado, a los 3 min: nada (tope de 10 min)');
    X.W.T += 7 * MIN + 1000; X.latir();
    const t2 = X.W.T;
    await X.M.etradeSincronizar();
    igual([X.lecturasTx(t2).length, X.guardado('mz_et_sync_lig')], [10, null], 'a los 10 min, la COMPLETA; la ligera no existe fuera de sesión');
  }

  // ════════════════ 4. [1] los fallos de la ligera: se guardan en SU clave y no tocan el resumen de la completa ════════════════
  {
    const X = armarMundo();
    await X.M.etradeSincronizar();
    const sync0 = X.ls.getItem('mz_et_sync2');
    X.W.etFalla = true; X.W.T += 2 * MIN + 5000; X.latir();
    let r = await X.M.etradeSincronizar();
    const lig = X.guardado('mz_et_sync_lig');
    igual([lig && lig.estado, r.cambio, X.ls.getItem('mz_et_sync2') === sync0], ['error', false, true], 'E*TRADE falla en la ligera: «error» en su clave, cambio: false, el resumen de la completa intacto');
    assert(/E\*TRADE 500|HTTP 500/.test(String(lig && lig.detalle)), 'con el detalle (' + (lig && lig.detalle) + ')');
    X.W.etFalla = false; X.W.et401 = true; X.W.renew = { status: 503, data: { error: 'E*TRADE 5xx' } };
    X.W.T += 2 * MIN + 5000; X.latir();
    r = await X.M.etradeSincronizar();
    igual([r.estado, (X.guardado('mz_et_sync_lig') || {}).estado], ['expirado', 'expirado'], 'un 401 en la ligera: «expirado» (lo que dirá Cuentas)');
  }

  // ════════════════ 5. [1] Schwab: la ligera es UNA consulta de 4 días y solo al libro ════════════════
  {
    const X = armarMundo({ et: false, sw: true });
    let r = await X.M.schwabSincronizar();
    igual([r.estado, X.W.reg.sw.length, X.W.reg.swCuenta], ['ok', 3, 1], 'Schwab sin nada guardado: la COMPLETA (3 tramos de 60 días)');
    const bt0 = X.escriturasBT().length, sync0 = X.ls.getItem('mz_sw_sync');
    assert(bt0 >= 2, 'la completa lee las vencidas y escribe round-trips en broker_trades (' + bt0 + ')');
    X.W.ordenes.push(ordenSw(9001, X.W.T + 30000, true));
    X.W.T += 2 * MIN + 5000; X.latir();
    const t1 = X.W.T;
    r = await X.M.schwabSincronizar();
    const q = X.W.reg.sw.filter(x => x.t >= t1);
    igual(q.length, 1, 'a los 2 min en sesión: UNA consulta (la ligera), no tres de 60 días con maxResults 3000');
    const dias = q[0] ? (Date.parse(q[0].query.toEnteredTime) - Date.parse(q[0].query.fromEnteredTime)) / 86400000 : null;
    igual(Math.round(dias), 4, 'de los últimos 4 días');
    igual([X.escriturasBT(t1).length, X.W.reg.swCuenta], [0, 1], 'sin el select de vencidas, su limpieza ni el upsert de round-trips; y sin pedir la cuenta (la que ya hay)');
    igual([r.cambio, X.W.reg.inval > 0, (X.guardado('mz_sw_sync_lig') || {}).fills, X.ls.getItem('mz_sw_sync') === sync0], [true, true, 1, true], 'la orden nueva entra al libro (cambio, invalida la caché) sin pisar el resumen de la completa');
    // sin la cuenta guardada en este equipo, la ligera no pregunta nada (pedirla podría abrir el cuadro de elegir cuenta desde un timer)
    const Y = armarMundo({ et: false, sw: true, swAcct: false });
    await Y.M.schwabSincronizar();
    const n0 = Y.W.reg.sw.length, c0 = Y.W.reg.swCuenta;
    Y.W.T += 2 * MIN + 5000; Y.latir();
    await Y.M.schwabSincronizar();
    igual([Y.W.reg.sw.length - n0, Y.W.reg.swCuenta - c0], [0, 0], 'sin la cuenta guardada (mz_sw_acct), la ligera no llama a Schwab ni pide la cuenta: lo hará la completa');
  }

  // ════════════════ 6. [1] el timer cuenta su cadencia desde la pasada más reciente (completa o ligera) ════════════════
  {
    const X = armarMundo();
    await X.M.etradeSincronizar();
    X.W.T += 2 * MIN + 5000; X.latir();
    await X.M.etradeSincronizar();   // ligera
    X.W.T += 60000; X.latir();
    igual(X.M.syncBrokersFondo(), [], 'al minuto de la ligera el tic no lanza: la cadencia cuenta desde la ligera, no desde la completa de hace 3 min');
    X.W.T += 61000; X.latir();
    igual(X.M.syncBrokersFondo(), ['etrade'], 'y a los 2 min de la ligera, sí');
  }
  // v65 rev2: un «ya» DENTRO de la cadencia (volver de la app del bróker, arrancar, TOKEN_REFRESHED) que acaba en «guardada»
  // no reinicia la cadencia: la siguiente lectura real llega cuando tocaba, no una cadencia entera después
  {
    // tics de 15 s desde `desde` hasta `hasta` (s); devuelve los segundos (desde t0) de los tics que LEYERON al bróker
    const lecturas = async (X, t0, desde, hasta) => {
      const out = [];
      for (let s = desde; s <= hasta; s += 15) {
        X.W.T = t0 + s * 1000; X.latir();
        const n0 = X.lecturasTx(t0 + 1).length;
        X.M.syncBrokersFondo(); await X.correr();
        if (X.lecturasTx(t0 + 1).length > n0) out.push(s);
      }
      return out;
    };
    const X = armarMundo();
    await X.M.etradeSincronizar(); await X.correr();   // la completa en t0
    const t0 = X.W.T;
    X.W.T = t0 + 90000; X.latir();
    igual(X.M.syncBrokersFondo(true), ['etrade'], '(v65 rev2) en sesión, a t0+90 s Andrés vuelve de la app de E*TRADE: «ya» lanza la sincronización…');
    await X.correr();
    igual(X.lecturasTx(t0 + 1).length, 0, '(v65 rev2) …que sale «guardada» (dentro del tope de 2 min): no lee nada');
    igual((await lecturas(X, t0, 105, 300))[0], 120, '(v65 rev2) la siguiente lectura real llega a t0+120 s, cuando tocaba (no a t0+210 s: el «ya» no reinicia la cadencia)');
    const Z = armarMundo({ ses: 'cerrado' });
    await Z.M.etradeSincronizar(); await Z.correr();
    const z0 = Z.W.T;
    Z.W.T = z0 + 9 * MIN; Z.latir(); Z.M.syncBrokersFondo(true); await Z.correr();
    igual(Z.lecturasTx(z0 + 1).length, 0, '(v65 rev2) fuera de sesión, el «ya» de los 9 min sale «guardada» (tope de 10)');
    igual((await lecturas(Z, z0, 9 * 60 + 15, 40 * 60))[0], 15 * 60, '(v65 rev2) y la siguiente lectura llega a los 15 min, no a los 24');
  }

  // ════════════════ 7. [2] con la app OCULTA no se lee al bróker por NINGÚN camino ════════════════
  {
    const X = armarMundo({ sw: true, hash: '#/cuentas', vista: 'diario' });
    await X.M.etradeSincronizar(); await X.M.schwabSincronizar();   // la completa, con la app a la vista
    const et0 = X.ls.getItem('mz_et_sync2'), sw0 = X.ls.getItem('mz_sw_sync');
    X.W.visible = 'hidden';
    const tOculta = X.W.T;
    // 30 min de sesión con la Mesa en una pestaña de fondo, el Diario abierto: el tic del timer (15 s), ruta() cada 60 s
    // (→ vistaDiario → sincronizarLibroFondo) y Cuentas (→ etradeSincronizar/schwabSincronizar sin forzar)
    for (let s = 0; s < 30 * 4; s++) {
      X.W.T += 15000; X.latir();
      X.M.syncBrokersFondo();
      if (s % 4 === 0) { X.M.sincronizarLibroFondo(); X.M.etradeSincronizar(); X.M.schwabSincronizar(); }
      await X.correr();
    }
    igual([X.W.reg.et.filter(x => x.t > tOculta).length, X.W.reg.sw.filter(x => x.t > tOculta).length], [0, 0], '30 min con la app oculta en el Diario (timer, ruta() cada 60 s y Cuentas): ni una llamada a E*TRADE ni a Schwab');
    igual([X.ls.getItem('mz_et_sync2') === et0, X.ls.getItem('mz_sw_sync') === sw0, X.guardado('mz_et_sync_lig'), X.guardado('mz_sw_sync_lig')], [true, true, null, null], 'y no se escribe nada (ni completa ni ligera): la próxima, al volver');
    // «sincronizar» es un toque de Andrés: pasa aunque la app esté oculta
    const tF = X.W.T;
    await X.M.etradeSincronizar(true);
    igual(X.lecturasTx(tF).length, 10, 'forzar («sincronizar») pasa con la app oculta (la completa)');
    // al volver a la vista: syncBrokersFondo(true) pone el libro al día enseguida
    X.W.visible = 'visible'; X.W.T += 3 * MIN; X.latir();
    const tV = X.W.T;
    igual(X.M.syncBrokersFondo(true).join(), 'etrade,schwab', 'al volver a la vista, el timer lanza los dos con «ya»');
    await X.correr();
    assert(X.lecturasTx(tV).length >= 1 && X.W.reg.sw.filter(x => x.t >= tV).length >= 1, 'y los dos leen (E*TRADE la ligera; Schwab la completa vencida)');
  }

  // ════════════════ 8. [2] tras un «expirado», 15 min de freno también en el camino de ruta()/Diario/Cuentas ════════════════
  {
    // E*TRADE contesta 401 y el renew da 5xx: etRenovar no puede decidir y el token NO se marca muerto (se sigue probando)
    const X = armarMundo({ hash: '#/cuentas', vista: 'diario' });
    X.W.et401 = true; X.W.renew = { status: 503, data: { error: 'E*TRADE 5xx' } };
    for (let s = 0; s < 30 * 4; s++) {   // 30 min visible en el Diario: tic de 15 s + ruta() cada 60 s + Cuentas
      X.latir();
      X.M.syncBrokersFondo();
      if (s % 4 === 0) { X.M.sincronizarLibroFondo(); X.M.etradeSincronizar(); }
      await X.correr();
      X.W.T += 15000;
    }
    const lect = X.W.reg.et.filter(x => x.ruta === '/etrade/read').length, renews = X.W.reg.et.filter(x => x.ruta === '/etrade/renew').length;
    igual(renews, 2, '30 min con la sesión de E*TRADE «expirada» y el Diario abierto: 2 intentos (al empezar y a los 15 min), no 16');
    assert(lect <= 4, '… y ≤ 4 lecturas con 401 (' + lect + '; antes 32)');
    igual(X.ls.getItem('mz_et_dia') === 'muerto', false, '(el token no se dio por muerto: el renew no pudo decidir; por eso hace falta el freno)');
    // la ligera que da «expirado» frena igual
    const Y = armarMundo({ hash: '#/cuentas', vista: 'diario' });
    await Y.M.etradeSincronizar();
    Y.W.et401 = true; Y.W.renew = { status: 503, data: {} };
    Y.W.T += 2 * MIN + 5000; Y.latir();
    await Y.M.etradeSincronizar();   // ligera → expirado
    const t1 = Y.W.T;
    for (let m = 1; m <= 14; m++) { Y.W.T = t1 + m * MIN; Y.latir(); Y.M.sincronizarLibroFondo(); await Y.M.etradeSincronizar(); await Y.correr(); }
    igual(Y.W.reg.et.filter(x => x.t > t1).length, 0, 'una ligera que dio «expirado»: el Diario y Cuentas no vuelven a preguntar en 15 min');
    Y.W.T = t1 + 15 * MIN + 1000; Y.latir();
    await Y.M.etradeSincronizar();
    igual(Y.W.reg.et.filter(x => x.t > t1 + 15 * MIN && /list\.json/.test(x.path || '')).length >= 1, true, 'a los 15 min se vuelve a intentar (la completa)');
    // Schwab, igual
    const Z = armarMundo({ et: false, sw: true, hash: '#/cuentas', vista: 'diario' });
    Z.W.sw401 = true;
    for (let s = 0; s < 30 * 4; s++) {
      Z.latir(); Z.M.syncBrokersFondo();
      if (s % 4 === 0) { Z.M.sincronizarLibroFondo(); Z.M.schwabSincronizar(); }
      await Z.correr(); Z.W.T += 15000;
    }
    igual(Z.W.reg.sw.length, 2, 'Schwab «sin sesión» (401) con el Diario abierto 30 min: 2 intentos, no 15');
  }

  // ════════════════ 9. [4] el cierre: lo operado en el último minuto entra al libro en un par de minutos ════════════════
  // El reloj del mundo avanza en tics de 15 s (el del timer); ruta() no hace falta: basta el timer en otra pestaña.
  // La completa a las −7:10 y las ligeras a −5:10, −3:10 y −1:10: la venta de −0:30 llega DESPUÉS de la última pasada en
  // sesión (y la completa siguiente no vence hasta +2:50): solo la entra una pasada tras el cierre.
  async function cierre(cierreUtc, aparece) {
    aparece = aparece == null ? -25000 : aparece;   // cuándo publica E*TRADE la venta (respecto al cierre)
    const t0 = cierreUtc - 7 * MIN - 10000;
    const X = armarMundo({ T: t0, hash: '#/tickers' });
    const pasadas = [];
    const idNuevo = 26300000000001;
    for (let t = t0; t < cierreUtc + 20 * MIN; t += 15000) {
      X.W.T = t;
      X.W.ses = t >= cierreUtc ? 'extendida' : 'regular';   // el latido del worker pasa a «post» a la hora del cierre
      if (t === cierreUtc + aparece) X.W.txs.push(txEt(idNuevo, cierreUtc - 12 * 3600000, false, 650));   // vende el 0DTE a falta de 25 s
      X.latir();
      const antes = X.lecturasTx().length;
      X.M.syncBrokersFondo(t === t0);
      await X.correr();
      if (X.lecturasTx().length > antes) pasadas.push(t - cierreUtc);
    }
    const escrito = X.W.unicas.fills.has('u|etrade|' + idNuevo);
    const primeraTras = pasadas.find(d => d >= aparece);
    return { pasadas, escrito, primeraTras, tras: pasadas.filter(d => d >= 0 && d < 6 * MIN), luego: pasadas.filter(d => d >= 6 * MIN && d < 17 * MIN) };
  }
  for (const [nombre, cierreUtc] of [['16:00', Date.UTC(2026, 9, 16, 20, 0, 0)], ['13:00 (media sesión)', Date.UTC(2026, 10, 27, 18, 0, 0)]]) {
    const R = await cierre(cierreUtc);
    assert(R.escrito && R.primeraTras != null && R.primeraTras <= 2 * MIN, nombre + ': la venta de las ' + (nombre.startsWith('16') ? '15:59:35' : '12:59:35') + ' entra al libro en la primera pasada tras ella, a ≤ 2 min del cierre (' + (R.primeraTras / 1000) + ' s), no hacia el cuarto de hora');
    assert(R.tras.length >= 1 && R.tras.length <= 2, nombre + ': tras el cierre, una o dos pasadas con el ritmo de sesión (' + R.tras.map(d => Math.round(d / 1000) + ' s').join(', ') + ')');
    igual(R.luego, [], nombre + ': y después vuelve el ritmo de fuera (nada entre +6 y +17 min)');
  }
  {
    // E*TRADE publica la transacción con retraso: la venta de las 15:59:35 aparece en su API a las 16:01:35, después de la
    // primera pasada tras el cierre (16:00:50): la SEGUNDA (16:02:50, el rato tras el cierre) la recoge
    const R = await cierre(Date.UTC(2026, 9, 16, 20, 0, 0), 95000);
    assert(R.escrito && R.primeraTras != null && R.primeraTras <= 3 * MIN, '16:00 con E*TRADE publicando tarde (16:01:35): la segunda pasada tras el cierre la entra (' + (R.primeraTras / 1000) + ' s), no a las 16:14');
  }
  // el iPhone que estaba en la app del bróker: congelado de 15:57:15 a 16:02 (ni un tic: iOS congela los timers), vuelve
  // con la última pasada hecha EN sesión (la ligera de las 15:57) y la completa de las 15:53 aún sin vencer
  {
    const cierreUtc = Date.UTC(2026, 9, 16, 20, 0, 0);
    const X = armarMundo({ T: cierreUtc - 7 * MIN, hash: '#/copiloto' });
    for (let t = X.W.T; t <= cierreUtc - 2 * MIN - 45000; t += 15000) { X.W.T = t; X.latir(); X.M.syncBrokersFondo(t === cierreUtc - 7 * MIN); await X.correr(); }
    const idNuevo = 26300000000002;
    X.W.txs.push(txEt(idNuevo, cierreUtc - 12 * 3600000, false, 651));   // 15:59:30, con el iPhone congelado
    X.W.T = cierreUtc + 2 * MIN; X.W.ses = 'extendida'; X.latir();
    const tV = X.W.T;
    X.M.syncBrokersFondo(true);   // visibilitychange → syncBrokersFondo(true) a los 800 ms
    await X.correr();
    assert(X.lecturasTx(tV).length >= 1 && X.W.unicas.fills.has('u|etrade|' + idNuevo), 'iPhone congelado en el cierre: al volver a las 16:02 la pasada del cierre aún falta (la última se hizo en sesión) y lee: la venta de las 15:59:30 entra ya');
    const n = X.lecturasTx().length;
    for (let t = tV + 15000; t < tV + 14 * MIN; t += 15000) { X.W.T = t; X.latir(); X.M.syncBrokersFondo(); await X.correr(); }
    igual(X.lecturasTx().length - n, 0, 'hecha esa (ya fuera de sesión), el ritmo de fuera: nada en los 14 min siguientes');
  }
  // a la mañana siguiente (pre-mercado), la última pasada guardada de ayer «en sesión» no deja el ritmo de sesión puesto
  {
    const X = armarMundo({ T: Date.UTC(2026, 9, 16, 19, 50, 0) });
    await X.M.etradeSincronizar();   // 15:50 ET, en sesión
    X.W.T = Date.UTC(2026, 9, 19, 13, 0, 0); X.W.ses = 'cerrado'; X.latir();   // lunes 9:00 ET (el token de E*TRADE ya sería otro: aquí da igual)
    X.ls.setItem('mz_et_dia', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(X.W.T)));
    const t0 = X.W.T;
    for (let t = t0; t < t0 + 14 * MIN; t += 15000) { X.W.T = t; X.latir(); X.M.syncBrokersFondo(); await X.correr(); }
    igual(X.lecturasTx(t0).length, 10, 'pre-mercado del día siguiente: UNA pasada (la completa vencida) y luego el ritmo de fuera, no una cada 2 min');
  }

  // ════════════════ 10. (v65 rev2) los IDs PROVISIONALES de E*TRADE: el Diario cuenta UNA operación, no dos ════════════════
  // E*TRADE enseña la operación del día con IDs provisionales («Bought»/«Sold») y días después la contabiliza con otros
  // («Bought To Open»/«Sold To Close», ~2 min antes, fee 1.03; caso real del 17-sep, test_cuentas). La pasada de cada 2 min
  // escribe la provisional; la contabilizada entra luego con otra clave_ext y el libro (no-delete) guarda las cuatro. Todo
  // REAL: etradeSincronizar (ligera y completa), guardarFills, leerFillsTodos/libroParaUnir y emparejarFillsFIFO, sobre una
  // tabla fills de juguete con su clave única y su id que solo crece.
  {
    const W = { T: Date.UTC(2026, 9, 16, 15, 20), txs: [] };
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(W.T); } static now() { return W.T; } }
    const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso || W.T)); } catch (_) { return ''; } };
    const hoyNY = () => ymdNY(new Date(W.T).toISOString());
    const ls = localStorageFalso({ mz_et_tok: 't', mz_et_sec: 's', mz_et_dia: hoyNY(), mz_et_acct: 'k1' });
    const tx = (id, ms, tipo, qty, price, fee) => ({ transactionId: id, transactionDate: ms, postDate: ms, amount: 0, description: tipo, transactionType: tipo,
      brokerage: { product: { symbol: 'SPY', securityType: 'OPTN', callPut: 'CALL', expiryYear: 26, expiryMonth: 10, expiryDay: 16, strikePrice: 764 }, quantity: qty, price, fee } });
    const etProxy = async (ruta, body) => {
      if (ruta !== '/etrade/read') return { status: 200, data: {} };
      if (body.path === '/v1/accounts/list.json') return { status: 200, data: { AccountListResponse: { Accounts: { Account: [{ accountIdKey: 'k1', accountStatus: 'ACTIVE' }] } } } };
      const arr = W.txs.slice().sort((a, b) => b.transactionDate - a.transactionDate);
      return arr.length ? { status: 200, data: { TransactionListResponse: { moreTransactions: false, totalCount: arr.length, Transaction: arr } } } : { status: 204, data: null };
    };
    const tabla = []; let idSig = 1;
    const sb = sbFalso((t, cadena) => {
      if (t !== 'fills') return { data: [], error: null };
      const up = cadena.find(c => c[0] === 'upsert');
      if (up) {
        const nuevas = [];
        for (const f of up[1][0]) {
          if (tabla.some(x => x.user_id === f.user_id && x.broker === f.broker && x.clave_ext === f.clave_ext)) continue;   // ignoreDuplicates
          const fila = Object.assign(JSON.parse(JSON.stringify(f)), { id: idSig++ }); tabla.push(fila); nuevas.push({ id: fila.id });
        }
        return { data: nuevas, error: null };
      }
      if (cadena.some(c => c[0] === 'delete')) throw new Error('nadie borra del libro');
      const gt = cadena.find(c => c[0] === 'gt'), rg = cadena.find(c => c[0] === 'range');
      const porId = cadena.filter(c => c[0] === 'order').map(c => c[1][0]).join() === 'id';
      let d = tabla.filter(f => !gt || f.id > Number(gt[1][1]))
        .sort(porId ? (a, b) => a.id - b.id : (a, b) => Date.parse(a.ejecutado_at) - Date.parse(b.ejecutado_at) || a.id - b.id);
      if (rg) d = d.slice(rg[1][0], rg[1][1] + 1);
      return { data: JSON.parse(JSON.stringify(d)), error: null };
    });
    const FN = ['etradeSincronizar', 'etradeSincronizarImpl', 'etradeSincronizarLigera', 'pasadaSyncAhora', 'appOcultaSync', 'ultimaPasadaSync', 'tipoPasadaSync', 'syncTtlAhora',
      'ttlSyncLibro', 'sesionNY', 'sesionNYLibro', 'ritmoSyncLibro', 'resumenSyncGuardado', 'etradeTransacciones', 'etRead', 'etRenovar', 'etMarcarMuerto', 'etError', 'etCuentaKey',
      'emparejarEtrade', 'fillsDeTransaccionesEtrade', 'ladoFillEtrade', 'fechaNyTransaccion', 'guardarFills', 'textoErrorFills', 'textoErrorTabla', 'etDiaVencido',
      'leerFillsTodos', 'libroInvalidar', 'libroParaUnir', 'fusionarLibro', 'ordenarLibro', 'instanteLibro', 'maxIdLibro', 'libroVigente', 'fillsEtradeVigentes', 'tipoFillEtrade',
      'claveFill', 'claveContrato', 'emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'durMin', 'diasEntre', 'spotDeFill', 'peorFuenteSpot', 'sinHoraIso', 'horaNY'].filter(existe);
    const M = construir(FN, { Date: FakeDate, ymdNY, hoyNY, localStorage: ls, URL, sb, etProxy, sesionActiva: { user: { id: 'u' } },
      haceCuanto: (iso) => ({ min: (W.T - new Date(iso).getTime()) / 60000 }), etCreds: () => ({ token: 't', token_secret: 's' }),
      document: { visibilityState: 'visible' }, libroRepintarPronto: () => {} },
      { consts: ['ET_K', 'ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'ET_DIAS_HIST', 'ET_DIAS_LIGERA', 'ET_TOPE_MS', 'SYNC_EXPIRADO_MS', 'LIBRO_TRAS_CIERRE_MS', '_etSyncEnVuelo', '_etRenovando',
        '_ultimaRegular', '_libro', 'LIBRO_TTL_MS', 'LIBRO_COMPLETA_MS', 'LIBRO_RT_MAX', 'ET_GEMELA_MS', 'ET_TIPO_PROVISIONAL', 'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'].filter(existeConst),
        prefijo: 'let _hbUltimo = null; function __hb(h) { _hbUltimo = h; }', extras: ['__hb'] });
    const latir = () => M.__hb({ sesion: 'regular', latido_at: new Date(W.T - 20000).toISOString() });
    const diario = (filas) => { const F = M.emparejarFillsFIFO(filas, hoyNY()); return [F.cerradas.length, F.cerradas.reduce((s, c) => s + c.contratos, 0), Math.round(F.cerradas.reduce((s, c) => s + c.pnl, 0) * 100) / 100]; };
    latir(); await M.etradeSincronizar();   // 11:20 ET, la completa (aún sin la operación)
    // 11:19 compra y 11:24 vende 1 SPY CALL 764: E*TRADE la enseña al momento con los IDs PROVISIONALES
    const t19 = Date.UTC(2026, 9, 16, 15, 19, 16), t24 = Date.UTC(2026, 9, 16, 15, 24, 50);
    W.txs.push(tx(26289201484550, t19, 'Bought', 1, 0.14, 1.0), tx(26289201541834, t24, 'Sold', -1, 0.11, 1.0));
    W.T = Date.UTC(2026, 9, 16, 15, 26); latir();
    const r1 = await M.etradeSincronizar();   // la LIGERA de cada 2 min
    let r = await M.leerFillsTodos();
    igual([r1.cambio, tabla.map(f => f.clave_ext).sort(), diario(r.filas)], [true, ['26289201484550', '26289201541834'], [1, 1, -5]], '(v65 rev2) a las 11:26 la ligera mete la PROVISIONAL y el Diario ya la ve: 1 operación ×1 (−$5.00 con las comisiones del día)');
    // el lunes E*TRADE la CONTABILIZA: otros IDs, ~2 min antes, otra comisión; las provisionales desaparecen de su API
    W.txs = [tx(26289501293386, t19 - 122000, 'Bought To Open', 1, 0.14, 1.03), tx(26289501293387, t24 - 123000, 'Sold To Close', -1, 0.11, 1.03)];
    W.T = Date.UTC(2026, 9, 19, 15, 0); ls.setItem('mz_et_dia', hoyNY()); latir();
    const r2 = await M.etradeSincronizar();   // la COMPLETA (180 días): la contabilizada entra con otra clave_ext
    igual([r2.cambio, tabla.length], [true, 4], '(v65 rev2) la contabilizada ENTRA en el libro (otra clave_ext) y nada se borra: la tabla guarda las 4 ejecuciones');
    r = await M.leerFillsTodos();   // la sincronización invalidó la caché: lectura incremental (id > 2)
    igual([r.error, r.filas.map(f => f.clave_ext)], [null, ['26289501293386', '26289501293387']], '(v65 rev2) leerFillsTodos (incremental) devuelve el libro VIGENTE: la compra y la venta contabilizadas, sin sus provisionales');
    igual(diario(r.filas), [1, 1, -5.06], '(v65 rev2) el Diario (emparejarFillsFIFO real): UNA operación ×1 −$5.06, no dos ×2 −$10.06');
    r = await M.leerFillsTodos(true);
    igual([r.filas.length, diario(r.filas)], [2, [1, 1, -5.06]], '(v65 rev2) y lo mismo con la lectura COMPLETA («Sincronizar ahora»)');
    const u = await M.libroParaUnir();
    igual((u || []).map(f => f.clave_ext), ['26289501293386', '26289501293387'], '(v65 rev2) libroParaUnir (Cuentas, Disciplina y los cupos): el mismo libro vigente');
    const r3 = await M.leerFillsTodos();
    assert(r3.filas === r.filas, '(v65 rev2) dentro de los 60 s, el MISMO arreglo (la vista vigente se recuerda: nadie redibuja por nada)');
  }

  // ════════════════ 11. (v65 rev2) Schwab sin cuenta elegida: el timer no abre el cuadro y ninguna llamada queda colgada ════════════════
  // swCodigoEnviar BORRA la cuenta (SW_K.acct) y mz_sw_sync en cada login semanal. Con dos cuentas, la completa de Schwab
  // que lanzaba el timer llamaba a swCuenta → «¿Qué cuenta de Schwab usa la Mesa?» desde el fondo, encima de la hoja de
  // orden; y si otra llamada a swCuenta abría su cuadro, elegirCuentaSchwab quitaba el anterior SIN resolverlo: la
  // sincronización quedaba colgada, _swSyncEnVuelo no se liberaba y Schwab no volvía a leer órdenes hasta recargar.
  // Funciones REALES: syncBrokersFondo, schwabSincronizar/Impl, swCuenta, elegirCuentaSchwab (DOM de juguete).
  {
    const W = { T: NY_11, sw: [] };
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(W.T); } static now() { return W.T; } }
    const cuerpo = [];
    const nodoModal = (id) => { const n = { id, className: 'modal', innerHTML: '', style: {}, handlers: [], addEventListener(_t, h) { n.handlers.push(h); }, remove() { const i = cuerpo.indexOf(n); if (i >= 0) cuerpo.splice(i, 1); } }; return n; };
    const elegir = (n, i) => n.handlers.forEach(h => h({ target: { closest: () => ({ getAttribute: () => String(i) }) } }));
    const cuadros = () => cuerpo.filter(n => n.id === 'modalSwCta');
    cuerpo.push(nodoModal('modalOrden'));   // Andrés está en la hoja de orden de Schwab
    const document = { visibilityState: 'visible', createElement: () => nodoModal(''), body: { appendChild: (n) => cuerpo.push(n) },
      querySelector: (q) => (q === '.modal' ? cuerpo.find(n => n.className === 'modal') || null : null) };
    const $ = (sel) => cuerpo.find(n => '#' + n.id === sel) || null;
    const ls = localStorageFalso({});   // tras el login semanal: sin SW_K.acct ni mz_sw_sync
    const swRead = async (p) => { W.sw.push(p); return { status: 200, data: [{ accountNumber: '11111111', hashValue: 'HASH-A' }, { accountNumber: '22222222', hashValue: 'HASH-B' }] }; };
    const swLlamar = async (ruta, body) => { W.sw.push(ruta + (body && body.hash ? '@' + body.hash : '')); return { status: 200, data: [] }; };
    const ymdNY = (iso) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso || W.T)); } catch (_) { return ''; } };
    const FN = ['syncBrokersFondo', 'cadenciaSyncLibro', 'ultimaSyncBroker', 'ultimaPasadaSync', 'syncFondoResultado', 'ritmoSyncLibro', 'sesionNYLibro', 'sesionNY',
      'schwabSincronizar', 'schwabSincronizarImpl', 'schwabSincronizarLigera', 'pasadaSyncAhora', 'appOcultaSync', 'tipoPasadaSync', 'syncTtlAhora', 'ttlSyncLibro',
      'resumenSyncGuardado', 'schwabOrdenesHistoricas', 'swMensajeError', 'fillsDeOrdenesSchwab', 'emparejarFillsSchwab', 'vencidasASobrar', 'fillsDeOrdenesSchwabLibro',
      'desOsi', 'guardarFills', 'textoErrorFills', 'textoErrorTabla', 'swCuenta', 'elegirCuentaSchwab'].filter(existe);
    const M = construir(FN, { Date: FakeDate, document, $, esc: C.esc, localStorage: ls, sb: sbFalso(() => ({ data: [], error: null })), swRead, swLlamar, ymdNY,
      hoyNY: () => ymdNY(new Date(W.T).toISOString()),
      haceCuanto: (iso) => ({ min: (W.T - new Date(iso).getTime()) / 60000 }), sesionActiva: { user: { id: 'u' } },
      etCreds: () => null, etDiaVencido: () => false, swCreds: () => ({ token: 't', refresh: 'r' }), swVencido: () => false,
      etradeSincronizar: async () => ({}), etProxy: async () => ({ status: 200, data: {} }), libroInvalidar: () => {}, libroRepintarPronto: () => {},
      mascaraCuenta: (n) => String(n).slice(0, 2) + '***' + String(n).slice(-3) },
      { consts: ['ET_K', 'ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'SW_DIAS_HIST', 'SW_TRAMO_DIAS', 'SW_K_SYNC', 'SW_K_SYNC_LIG', 'SW_DIAS_LIGERA', 'SW_K', 'ET_TOPE_MS',
        'SYNC_EXPIRADO_MS', 'LIBRO_SYNC_SESION_MS', 'LIBRO_SYNC_FUERA_MS', 'LIBRO_TRAS_CIERRE_MS', '_syncFondo', '_swSyncEnVuelo', '_ultimaRegular'].filter(existeConst),
        prefijo: 'let _hbUltimo = { sesion: "regular", latido_at: new Date(Date.now() - 20000).toISOString() };' });
    const correr = async (n) => { for (let i = 0; i < (n || 30); i++) await respirar(); };
    // el tic de 15 s con la hoja de orden abierta, y luego sin ella: sin cuenta elegida, el timer no toca Schwab
    let l1 = M.syncBrokersFondo(true); await correr();
    cuerpo.splice(0, cuerpo.length);   // cierra la hoja de orden
    const l2 = M.syncBrokersFondo(true); await correr();
    W.T += 3 * MIN; const l3 = M.syncBrokersFondo(); await correr();
    igual([l1, l2, l3, cuadros().length, W.sw.length], [[], [], [], 0, 0], '(v65 rev2) sin la cuenta de Schwab elegida, el timer (con la hoja de orden abierta o sin ella) no lanza Schwab: ni cuadro «¿Qué cuenta…?» ni una llamada a Schwab');
    // el Diario (sincronizarLibroFondo) SÍ la pide, como en la v64: abre el cuadro…
    let termino = null;
    M.schwabSincronizar().then(r => { termino = r; });
    await correr();
    igual(cuadros().length, 1, '(v65 rev2) el Diario sí pide la cuenta (como en la v64): abre el cuadro');
    // …y mientras tanto Cuentas (schwabSaldo → swCuenta) abre el suyo; Andrés elige la cuenta B en el que ve
    const otra = M.swCuenta();
    await correr();
    igual(cuadros().length, 1, '(v65 rev2) la segunda llamada a swCuenta deja UN solo cuadro (quita el anterior)');
    elegir(cuadros()[0], 1);
    igual(await otra, 'HASH-B', '(v65 rev2) la llamada de Cuentas recibe la cuenta elegida (B)');
    await correr();
    assert(termino && termino.estado === 'error' && /No elegiste cuenta/.test(termino.detalle || ''), '(v65 rev2) la sincronización cuyo cuadro se quitó TERMINA («no elegiste cuenta»): no se queda colgada', JSON.stringify(termino));
    // «sincronizar» (un toque) ya no se une a una promesa colgada: lee las órdenes de la cuenta B
    let fin2 = null;
    M.schwabSincronizar(true).then(r => { fin2 = r; });
    await correr(60);
    igual([fin2 && fin2.estado, W.sw.filter(x => x === '/schwab/ordenes@HASH-B').length > 0, ls.getItem('mz_sw_acct')], ['ok', true, 'HASH-B'], '(v65 rev2) «sincronizar» de Schwab termina y lee /schwab/ordenes de la cuenta B');
    // y con la cuenta ya elegida, el timer sigue solo
    W.T += 11 * MIN;
    igual(M.syncBrokersFondo(), ['schwab'], '(v65 rev2) con la cuenta elegida, el timer vuelve a lanzar Schwab');
    await correr(60);
    igual(cuadros().length, 0, '(v65 rev2) y sin abrir ningún cuadro');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
