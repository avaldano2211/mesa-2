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
const FN_MUNDO = ['etradeSincronizar', 'etradeSincronizarImpl', 'etradeSincronizarLigera', 'pasadaSyncAhora', 'ultimaPasadaSync', 'tipoPasadaSync',
  'syncTtlAhora', 'ttlSyncLibro', 'sesionNY', 'sesionNYLibro', 'ritmoSyncLibro', 'resumenSyncGuardado', 'etradeTransacciones', 'etRead', 'etRenovar',
  'etMarcarMuerto', 'etError', 'etCuentaKey', 'emparejarEtrade', 'fillsDeTransaccionesEtrade', 'ladoFillEtrade', 'fechaNyTransaccion', 'guardarFills',
  'textoErrorFills', 'textoErrorTabla', 'etDiaVencido',
  'schwabSincronizar', 'schwabSincronizarImpl', 'schwabSincronizarLigera', 'schwabOrdenesHistoricas', 'swMensajeError', 'fillsDeOrdenesSchwab',
  'emparejarFillsSchwab', 'vencidasASobrar', 'fillsDeOrdenesSchwabLibro', 'desOsi',
  'syncBrokersFondo', 'cadenciaSyncLibro', 'ultimaSyncBroker', 'syncFondoResultado', 'sincronizarLibroFondo'];
const CONST_MUNDO = ['ET_K', 'ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'ET_DIAS_HIST', 'ET_DIAS_LIGERA', 'ET_TOPE_MS', 'SW_DIAS_HIST', 'SW_TRAMO_DIAS',
  'SW_K_SYNC', 'SW_K_SYNC_LIG', 'SW_DIAS_LIGERA', 'SW_K', 'LIBRO_SYNC_SESION_MS', 'LIBRO_SYNC_FUERA_MS', 'LIBRO_TRAS_CIERRE_MS', '_syncFondo',
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
    const P = construir(['ultimaPasadaSync', 'tipoPasadaSync', 'resumenHistorialSync', 'resumenSyncGuardado'], {}, { consts: ['ET_SYNC_TTL'].concat(existeConst('LIBRO_SYNC_FUERA_MS') ? ['LIBRO_SYNC_FUERA_MS'] : []) });
    const prev = { ts: 1000, resumen: { estado: 'ok', txs: 9 } };
    igual(P.ultimaPasadaSync(null, { ts: 5000, estado: 'ok' }), null, 'ultimaPasadaSync: sin completa guardada → null (la próxima es completa, aunque haya una ligera)');
    igual(P.ultimaPasadaSync(prev, null), { tc: 1000, ts: 1000, estado: 'ok' }, 'solo la completa: su hora y su estado');
    igual(P.ultimaPasadaSync(prev, { ts: 3000, estado: 'error' }), { tc: 1000, ts: 3000, estado: 'error' }, 'una ligera POSTERIOR manda en la hora y el estado (la completa sigue en tc)');
    igual(P.ultimaPasadaSync(prev, { ts: 500, estado: 'expirado' }), { tc: 1000, ts: 1000, estado: 'ok' }, 'una ligera ANTERIOR a la completa no cuenta');
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

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
