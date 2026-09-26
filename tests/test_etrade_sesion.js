#!/usr/bin/env node
/* Pruebas de la sesión de E*TRADE en el dispositivo (opción B): etRead con 401 →
   etRenovar → reintento, el token muerto (etMarcarMuerto, etDiaVencido), etError
   con {Error.message}, etradeSaldo, etPost, etCuentaKey, etProxy con tope y el
   login a medias (reanudarLoginEtrade). Funciones REALES del fuente con
   dependencias falsas (casa_pruebas.js). Ningún token real, ninguna red.
   Uso: node test_etrade_sesion.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_etrade_sesion.js');
const { FUENTE, assert, igual, construir, localStorageFalso, nodo, diferido, respirar } = C;

const HOY = '2026-09-24';
const hoyNY = () => HOY;
const CR = { token: 'tok1', token_secret: 'sec1' };
// Un proxy de juguete: por cada ruta, una cola de respuestas (o funciones) que se consumen en orden.
function proxyFalso(colas) {
  const llamadas = [];
  const etProxy = async (p, body, tope) => {
    llamadas.push({ path: p, body, tope });
    const cola = colas[p] || [];
    const r = cola.length > 1 ? cola.shift() : cola[0];
    if (r === undefined) throw new Error('sin red');
    const v = typeof r === 'function' ? await r(body) : r;
    if (v instanceof Error) throw v;
    return v;
  };
  return { etProxy, llamadas };
}
const NOMBRES_SESION = ['etRead', 'etRenovar', 'etMarcarMuerto', 'etDiaVencido', 'etCreds', 'etError', 'etOlvidar', 'etOlvidarCuenta', 'etGuardar'];
function armar(colas, almacen) {
  const px = proxyFalso(colas);
  const ls = localStorageFalso(Object.assign({ mz_et_tok: 'tok1', mz_et_sec: 'sec1', mz_et_dia: HOY }, almacen || {}));
  const M = construir(NOMBRES_SESION, { etProxy: px.etProxy, localStorage: ls, hoyNY }, { consts: ['ET_K', 'ET_TOPE_MS'], prefijo: 'let _etRenovando = null;' });
  return { M, px, ls };
}
const rutas = (px) => px.llamadas.map(l => l.path);

(async () => {
  // ════════════════ 1. etRead: 401 → renovar → reintentar ════════════════
  {
    const { M, px, ls } = armar({ '/etrade/read': [{ status: 401, data: { Error: { message: 'oauth_problem=token_expired' } } }, { status: 200, data: { ok: 1 } }], '/etrade/renew': [{ status: 200, data: { ok: true } }] });
    const r = await M.etRead(CR, '/v1/accounts/list.json');
    igual(rutas(px), ['/etrade/read', '/etrade/renew', '/etrade/read'], 'un 401 dispara renew_access_token y se reintenta la lectura');
    igual(r.status, 200, 'la lectura reintentada vuelve bien');
    igual(px.llamadas[1].body, { token: 'tok1', token_secret: 'sec1' }, 'la renovación va con el token del dispositivo');
    igual([px.llamadas[0].body.path, px.llamadas[0].body.query, px.llamadas[0].body.token, px.llamadas[0].tope], ['/v1/accounts/list.json', {}, 'tok1', 25000], 'la lectura lleva path, query vacía por defecto, el token y el tope de 25 s');
    igual(ls.almacen.mz_et_dia, HOY, 'el token sigue vivo: nada se marca');
    igual(M.etDiaVencido(), false, 'y etDiaVencido sigue en falso');
  }
  { const { M, px } = armar({ '/etrade/read': [{ status: 200, data: {} }] }); await M.etRead(CR, '/x'); igual(rutas(px), ['/etrade/read'], 'con 200 no se renueva nada'); }
  {
    const { M, px, ls } = armar({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 200, data: { ok: false, status: 401 } }] });
    const r = await M.etRead(CR, '/x');
    igual([r.status, rutas(px).length, ls.almacen.mz_et_dia, M.etDiaVencido()], [401, 3, 'muerto', true], 'E*TRADE RECHAZA la renovación (ok:false, 401) y la lectura sigue en 401: el token se da por muerto (mz_et_dia = muerto)');
  }
  {
    const { M, ls } = armar({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 500, data: {} }] });
    await M.etRead(CR, '/x');
    igual([ls.almacen.mz_et_dia, M.etDiaVencido()], [HOY, false], 'un 5xx del renew (no se pudo saber) NO da el token por muerto: la app no se queda pidiendo reconectar por un fallo del proxy');
  }
  { const { M, ls } = armar({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 200, data: { ok: false, status: 503 } }] }); await M.etRead(CR, '/x'); igual(ls.almacen.mz_et_dia, HOY, 'un ok:false con status 503 de E*TRADE tampoco (solo 400/401/403 son un rechazo explícito)'); }
  { const { M, ls } = armar({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 200, data: { ok: true }}] }); await M.etRead(CR, '/x'); igual(ls.almacen.mz_et_dia, HOY, 'renovado pero E*TRADE sigue en 401 (endpoint restringido): no es un token muerto'); }
  { const { M, ls, px } = armar({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [new Error('proxy caído')] }); const r = await M.etRead(CR, '/x'); igual([r.status, rutas(px).length, ls.almacen.mz_et_dia], [401, 3, HOY], 'si el renew revienta (proxy caído) se reintenta igual y no se marca nada'); }
  {
    // renovación COMPARTIDA: dos lecturas en paralelo con 401 = UN renew
    const d = diferido();
    const { M, px } = armar({ '/etrade/read': [{ status: 401, data: {} }, { status: 401, data: {} }, { status: 200, data: {} }], '/etrade/renew': [() => d.promesa] });
    const p1 = M.etRead(CR, '/a'), p2 = M.etRead(CR, '/b');
    await respirar(); await respirar();
    igual(rutas(px).filter(x => x === '/etrade/renew').length, 1, 'dos lecturas con 401 a la vez comparten UNA renovación (_etRenovando)');
    d.resolver({ status: 200, data: { ok: true } }); await p1; await p2;
    igual(rutas(px).filter(x => x === '/etrade/read').length, 4, 'y las dos reintentan');
  }
  {
    const { M, ls } = armar({});
    ls.setItem('mz_et_tok', 'tokNUEVO');
    M.etMarcarMuerto({ token: 'tokVIEJO' });
    igual(ls.almacen.mz_et_dia, HOY, 'etMarcarMuerto solo marca si el token que falló sigue siendo el guardado: un login nuevo en vuelo no se da por muerto');
    M.etMarcarMuerto({ token: 'tokNUEVO' });
    igual(ls.almacen.mz_et_dia, 'muerto', 'con el token actual sí');
    M.etMarcarMuerto(null);
    igual(ls.almacen.mz_et_dia, 'muerto', 'sin credenciales marca igual (compatibilidad)');
  }

  // ════════════════ 2. etDiaVencido, etCreds, etError, etOlvidar ════════════════
  {
    const { M } = armar({}, { mz_et_dia: HOY }); igual(M.etDiaVencido(), false, 'login de HOY (NY): vivo');
    igual(armar({}, { mz_et_dia: '2026-09-23' }).M.etDiaVencido(), true, 'login de AYER: E*TRADE lo mató a medianoche ET, sin molestar al proxy');
    igual(armar({}, { mz_et_dia: 'muerto' }).M.etDiaVencido(), true, 'marcado muerto: vencido');
    const sinDia = armar({}); sinDia.ls.removeItem('mz_et_dia'); igual(sinDia.M.etDiaVencido(), false, 'sin fecha guardada (token de antes de la v21) no se da por vencido a ciegas');
    igual(M.etCreds(), { token: 'tok1', token_secret: 'sec1' }, 'etCreds devuelve el par del dispositivo');
    const medio = armar({}); medio.ls.removeItem('mz_et_sec'); igual(medio.M.etCreds(), null, 'sin el secret no hay credenciales');
    igual(M.etError({ data: { Error: { code: 100, message: 'Invalid account' } } }), 'Invalid account', 'etError lee {Error.message} de E*TRADE');
    igual(M.etError({ data: { error: 'ruta no permitida' } }), 'ruta no permitida', 'y {error} del proxy');
    igual([M.etError({ data: {} }), M.etError(null), M.etError({ data: 'texto' }), M.etError({ data: { Error: {} } })], [null, null, null, null], 'sin mensaje → null (no se inventa un error)');
    igual(M.etError({ data: { Error: { message: 'A' }, error: 'B' } }), 'A', 'si vienen los dos manda el de E*TRADE');
    M.etGuardar('t2', 's2'); igual([M.ls === undefined, armar({}).ls.almacen.mz_et_tok], [true, 'tok1'], '(etGuardar escribe tok y sec)');
    const olv = armar({}, { mz_et_cache: 'x', mz_et_sync2: 'y', mz_et_acct: 'K', mz_et_login: 'l' });
    olv.M.etOlvidar();
    igual(Object.keys(olv.ls.almacen), [], 'etOlvidar borra TODAS las claves de E*TRADE del equipo (token, secret, caché, sync, día, cuenta, login)');
    const olvC = armar({}, { mz_et_acct: 'K' }); olvC.M.etOlvidarCuenta();
    igual([olvC.ls.almacen.mz_et_acct, olvC.ls.almacen.mz_et_tok], [undefined, 'tok1'], 'etOlvidarCuenta solo borra el accountIdKey cacheado');
  }

  // ════════════════ 3. etradeSaldo: snapshot | {_expirado} | null | {_sinRed} ════════════════
  const LISTA = { status: 200, data: { AccountListResponse: { Accounts: { Account: [{ accountIdKey: 'KCERRADA', accountId: '11112222', accountStatus: 'CLOSED' }, { accountIdKey: 'K2', accountId: '87654321', accountStatus: 'ACTIVE', institutionType: 'BROKERAGE' }] } } } };
  const BALANCE = { status: 200, data: { BalanceResponse: { Computed: { RealTimeValues: { totalAccountValue: 25000.5 }, cashBalance: 5000, cashBuyingPower: 10000 } } } };
  function armarSaldo(colas, almacen) {
    const px = proxyFalso(colas);
    const ls = localStorageFalso(Object.assign({ mz_et_tok: 'tok1', mz_et_sec: 'sec1', mz_et_dia: HOY }, almacen || {}));
    const reg = { snaps: [] };
    const M = construir(['etradeSaldo'].concat(NOMBRES_SESION), { etProxy: px.etProxy, localStorage: ls, hoyNY, etradeGuardarSnapshot: (s) => reg.snaps.push(s) }, { consts: ['ET_K', 'ET_TOPE_MS', 'num2'], prefijo: 'let _etRenovando = null;' });
    return { M, px, ls, reg };
  }
  {
    const { M, px, ls, reg } = armarSaldo({ '/etrade/read': [LISTA, BALANCE, LISTA, BALANCE] });   // dos lecturas completas (la cola repite la última)
    const s = await M.etradeSaldo();
    igual([s.broker, s.saldo_neto, s.efectivo, s.poder_compra, s.numero_mascara, s.origen, s._vivo], ['etrade', 25000.5, 5000, 10000, '876***321', 'dispositivo', true], 'el saldo vivo se adapta al shape de snapshot (número enmascarado, origen dispositivo)');
    igual(px.llamadas[1].body.path, '/v1/accounts/K2/balance.json', 'se salta la cuenta CERRADA y pide el saldo de la activa');
    igual(px.llamadas[1].body.query, { instType: 'BROKERAGE', realTimeNAV: 'true' }, 'con instType y realTimeNAV');
    assert(JSON.parse(ls.almacen.mz_et_cache).snap.saldo_neto === 25000.5, 'y queda cacheado 5 min en el equipo');
    igual(reg.snaps.length, 1, 'y se manda a cuenta_snapshots (etradeGuardarSnapshot)');
    const s2 = await M.etradeSaldo();
    igual([s2.saldo_neto, px.llamadas.length], [25000.5, 2], 'la segunda vez sale de la caché sin tocar el proxy');
    await M.etradeSaldo(true);
    igual(px.llamadas.length, 4, 'forzar relee');
  }
  { const { M, px } = armarSaldo({}); const sin = armarSaldo({}); sin.ls.removeItem('mz_et_tok'); igual([await sin.M.etradeSaldo(), sin.px.llamadas.length], [null, 0], 'sin token → null sin llamar al proxy'); void M; void px; }
  { const v = armarSaldo({}, { mz_et_dia: '2026-09-23' }); igual([await v.M.etradeSaldo(), v.px.llamadas.length], [{ _expirado: true }, 0], 'token de ayer → {_expirado} sin llamar al proxy'); }
  { const v = armarSaldo({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 200, data: { ok: false, status: 401 } }] }); igual(await v.M.etradeSaldo(), { _expirado: true }, '401 aun tras renovar → {_expirado}'); igual(v.ls.almacen.mz_et_dia, 'muerto', 'y el token queda marcado muerto para toda la app'); }
  { const v = armarSaldo({ '/etrade/read': [{ status: 200, data: { Error: { message: 'raro' } } }] }); igual(await v.M.etradeSaldo(), null, 'un error de E*TRADE en la lista → null'); }
  { const v = armarSaldo({ '/etrade/read': [{ status: 200, data: { AccountListResponse: { Accounts: { Account: [] } } } }] }); igual(await v.M.etradeSaldo(), null, 'sin cuentas → null'); }
  { const v = armarSaldo({ '/etrade/read': [new Error('Load failed')] }); igual(await v.M.etradeSaldo(), { _sinRed: true }, 'proxy inalcanzable / fetch cortado por iOS → {_sinRed}: Cuentas ofrece reintentar, no «Conectar»'); }
  { const v = armarSaldo({ '/etrade/read': [LISTA, { status: 200, data: { BalanceResponse: { Computed: { netAccountValue: 100, settledCashForInvestment: 40, marginBuyingPower: 80 } } } }] }); const s = await v.M.etradeSaldo(); igual([s.saldo_neto, s.efectivo, s.poder_compra], [100, 40, 80], 'sin RealTimeValues se usan los campos de respaldo (netAccountValue, settledCash, marginBuyingPower)'); }

  // ════════════════ 4. etPost, etCuentaKey, texto401Ordenes, errorCadena401 ════════════════
  function armarPost(colas, almacen) {
    const px = proxyFalso(colas);
    const ls = localStorageFalso(Object.assign({ mz_et_tok: 'tok1', mz_et_sec: 'sec1', mz_et_dia: HOY }, almacen || {}));
    const M = construir(['etPost', 'etCuentaKey', 'texto401Ordenes', 'errorCadena401', 'brokersOperables', 'swCreds', 'swVencido'].concat(NOMBRES_SESION), { etProxy: px.etProxy, localStorage: ls, hoyNY }, { consts: ['ET_K', 'ET_TOPE_MS', 'SW_K', 'SW_REFRESH_DIAS'], prefijo: 'let _etRenovando = null;' });
    return { M, px, ls };
  }
  {
    const { M, px } = armarPost({ '/etrade/orden/preview': [{ status: 401, data: {} }, { status: 200, data: { PreviewOrderResponse: {} } }], '/etrade/renew': [{ status: 200, data: { ok: true } }] });
    const r = await M.etPost(CR, '/etrade/orden/preview', { orden: { x: 1 } });
    igual([r.status, rutas(px)], [200, ['/etrade/orden/preview', '/etrade/renew', '/etrade/orden/preview']], 'etPost también renueva ante un 401 y reintenta');
    igual(px.llamadas[0].body, { token: 'tok1', token_secret: 'sec1', orden: { x: 1 } }, 'el POST lleva las credenciales fusionadas con el cuerpo');
    igual(px.llamadas[0].tope, undefined, 'las órdenes NO llevan tope: abortar un place dejaría la orden en estado indeterminado');
  }
  { const { M } = armarPost({ '/etrade/orden/place': [new Error('boom')] }); let msg = ''; try { await M.etPost(CR, '/etrade/orden/place', {}); } catch (e) { msg = e.message; } igual(msg, 'No pude contactar el proxy (¿Funnel activo?).', 'proxy caído en un POST: mensaje claro'); }
  {
    const { M, px, ls } = armarPost({ '/etrade/read': [LISTA] });
    igual(await M.etCuentaKey(CR), 'K2', 'etCuentaKey elige la cuenta que no está CLOSED');
    igual(ls.almacen.mz_et_acct, 'K2', 'y la cachea para siempre en el equipo');
    igual(await M.etCuentaKey(CR), 'K2', 'la segunda vez sale de la caché');
    igual(px.llamadas.length, 1, 'sin volver al proxy');
  }
  { const { M } = armarPost({ '/etrade/read': [{ status: 401, data: {} }], '/etrade/renew': [{ status: 200, data: { ok: false, status: 401 } }] }); let m = ''; try { await M.etCuentaKey(CR); } catch (e) { m = e.message; } assert(/sesión de E\*TRADE expiró/.test(m), 'etCuentaKey con sesión muerta lanza el mensaje de reconectar', m); }
  { const { M } = armarPost({ '/etrade/read': [{ status: 200, data: { Error: { message: 'Invalid consumer' } } }] }); let m = ''; try { await M.etCuentaKey(CR); } catch (e) { m = e.message; } igual(m, 'E*TRADE: Invalid consumer', 'un error de E*TRADE en la lista se lanza con su texto'); }
  { const { M } = armarPost({ '/etrade/read': [{ status: 200, data: {} }] }); let m = ''; try { await M.etCuentaKey(CR); } catch (e) { m = e.message; } igual(m, 'E*TRADE no devolvió ninguna cuenta.', 'sin cuentas se dice'); }
  {
    const { M } = armarPost({}, { mz_et_dia: 'muerto' });
    igual(M.texto401Ordenes('x'), 'La sesión de E*TRADE expiró — reconecta en Cuentas → E*TRADE.', 'texto401Ordenes con token muerto: reconectar');
    igual(M.errorCadena401('x'), 'RECONECTAR', 'errorCadena401 con token muerto: RECONECTAR (la vista pone el enlace)');
    const vivo = armarPost({}).M;
    igual(vivo.texto401Ordenes('oauth_problem'), 'E*TRADE rechazó la llamada (401): oauth_problem', 'con token vivo: el motivo literal de E*TRADE');
    igual(vivo.texto401Ordenes(null), 'E*TRADE rechazó la llamada (401): sin detalle', 'sin motivo: «sin detalle»');
    igual(vivo.errorCadena401('restricted'), 'E*TRADE rechazó la lectura de mercado (401): restricted', 'la cadena igual');
    igual(vivo.brokersOperables(), ['etrade'], 'brokersOperables: E*TRADE con token vivo');
    igual(M.brokersOperables(), [], 'con el token muerto E*TRADE deja de ser operable');
    igual(armarPost({}, { mz_sw_tok: 'a', mz_sw_ref: 'b', mz_sw_ref_ts: String(Date.now()) }).M.brokersOperables(), ['etrade', 'schwab'], 'y Schwab entra con su refresh vivo');
    igual(armarPost({}, { mz_sw_tok: 'a', mz_sw_ref: 'b', mz_sw_ref_ts: String(Date.now() - 8 * 86400000) }).M.brokersOperables(), ['etrade'], 'un refresh de Schwab de más de 7 días no cuenta');
  }

  // ════════════════ 5. etProxy: solo firma, con tope en lecturas ════════════════
  {
    const reg = { fetches: [] };
    const P = construir(['etProxy'], { PROXY_URL: 'https://proxy.ejemplo', fetch: async (url, op) => { reg.fetches.push({ url, op }); return { status: 200, json: async () => ({ ok: 1 }) }; }, AbortController, setTimeout, clearTimeout });
    const r = await P.etProxy('/etrade/read', { token: 't', path: '/x' }, 25000);
    igual([r.status, r.data, reg.fetches[0].url, reg.fetches[0].op.method, reg.fetches[0].op.headers['Content-Type']], [200, { ok: 1 }, 'https://proxy.ejemplo/etrade/read', 'POST', 'application/json'], 'POST JSON al proxy con la ruta pegada');
    assert(reg.fetches[0].op.signal && typeof reg.fetches[0].op.signal.aborted === 'boolean', 'con tope va un AbortSignal');
    await P.etProxy('/etrade/orden/place', {});
    igual(reg.fetches[1].op.signal, undefined, 'sin tope (órdenes) no hay señal de aborto');
    igual(reg.fetches[1].op.body, '{}', 'sin cuerpo se manda {}');
    const P2 = construir(['etProxy'], { PROXY_URL: '', fetch: async () => { throw new Error('no debería'); }, AbortController, setTimeout, clearTimeout });
    let m = ''; try { await P2.etProxy('/x', {}); } catch (e) { m = e.message; } igual(m, 'proxy sin configurar', 'sin PROXY_URL se dice, sin intentar nada');
    const P3 = construir(['etProxy'], { PROXY_URL: 'https://p', fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, AbortController, setTimeout, clearTimeout });
    m = ''; try { await P3.etProxy('/x', {}, 10); } catch (e) { m = e.message; } igual(m, 'el proxy no respondió a tiempo', 'el aborto por tope se traduce');
    const P4 = construir(['etProxy'], { PROXY_URL: 'https://p', fetch: async () => ({ status: 502, json: async () => { throw new Error('html'); } }), AbortController, setTimeout, clearTimeout });
    igual(await P4.etProxy('/x', {}), { status: 502, data: {} }, 'una respuesta que no es JSON (502 con HTML) da data {} y el status');
    const P5 = construir(['etProxy'], { PROXY_URL: 'https://p', fetch: async () => { throw new TypeError('Load failed'); }, AbortController, setTimeout, clearTimeout });
    m = ''; try { await P5.etProxy('/x', {}); } catch (e) { m = e.message; } igual(m, 'Load failed', 'otros fallos de red se propagan tal cual (cada llamador los traduce)');
  }

  // ════════════════ 6. login a medias y el final del login ════════════════
  {
    function armarLogin(almacen, E) {
      E = Object.assign({ modalAbierto: false }, E || {});
      const reg = { modales: [], toasts: [] };
      const ls = localStorageFalso(almacen || {});
      const M = construir(['reanudarLoginEtrade', 'etLoginOlvidar', 'etCreds', 'etDiaVencido'], { localStorage: ls, $: (s) => (s === '#modalPin' && E.modalAbierto ? nodo() : null), modalPin: (...a) => reg.modales.push(a), toast: (t) => reg.toasts.push(t), hoyNY }, { consts: ['ET_K', 'ET_LOGIN_TTL'] });
      return { M, reg, ls };
    }
    const pend = () => JSON.stringify({ rt: 'RT1', url: 'https://us.etrade.com/e/t/etws/authorize?x', ts: Date.now() - 5 * 60000 });
    { const { M, reg } = armarLogin({ mz_et_login: pend() }); M.reanudarLoginEtrade(); igual([reg.modales.length, reg.modales[0] && reg.modales[0][0], reg.modales[0] && reg.modales[0][2]], [1, 'RT1', false], 'un login de hace 5 min sin sesión: se vuelve a ofrecer el cuadro del código con su request token'); assert(/login de E\*TRADE a medias/.test(reg.toasts[0]), 'y se dice'); }
    { const { M, reg, ls } = armarLogin({ mz_et_login: JSON.stringify({ rt: 'RT1', ts: Date.now() - 10 * 60000 }) }); M.reanudarLoginEtrade(); igual([reg.modales.length, ls.almacen.mz_et_login], [0, undefined], 'un login de hace 10 min ya caducó (el request token vive 10 min en el proxy): se olvida'); }
    { const { M, reg, ls } = armarLogin({ mz_et_login: pend(), mz_et_tok: 't', mz_et_sec: 's', mz_et_dia: HOY }); M.reanudarLoginEtrade(); igual([reg.modales.length, ls.almacen.mz_et_login], [0, undefined], 'si ya hay sesión válida el login a medias se olvida'); }
    { const { M, reg } = armarLogin({ mz_et_login: pend(), mz_et_tok: 't', mz_et_sec: 's', mz_et_dia: '2026-09-23' }); M.reanudarLoginEtrade(); igual(reg.modales.length, 1, 'con la sesión de ayer (muerta) sí se reanuda'); }
    { const { M, reg } = armarLogin({ mz_et_login: pend() }, { modalAbierto: true }); M.reanudarLoginEtrade(); igual(reg.modales.length, 0, 'con el cuadro ya abierto no se duplica'); }
    { const { M, reg } = armarLogin({}); M.reanudarLoginEtrade(); igual(reg.modales.length, 0, 'sin login a medias no pasa nada'); }
    { const { M, reg } = armarLogin({ mz_et_login: '{roto' }); M.reanudarLoginEtrade(); igual(reg.modales.length, 0, 'un JSON roto no revienta'); }
    // el final del login: token guardado, día anotado, sync y caché borradas, cuadro cerrado
    const px = proxyFalso({ '/etrade/login/finish': [{ status: 200, data: { token: 'TOK', token_secret: 'SEC' } }] });
    const ls = localStorageFalso({ mz_et_sync2: 'viejo', mz_et_cache: 'viejo', mz_et_login: pend() });
    const reg = { rutas: 0, toasts: [], quitado: 0, cadena: 0 };
    const pinNodo = nodo({ value: ' 12345 ' }), errNodo = nodo(), modal = nodo({ remove: () => reg.quitado++ });
    const F = construir(['etradePinEnviar', 'etGuardar', 'etLoginOlvidar'], { $: (s) => ({ '#etPin': pinNodo, '#etErr': errNodo, '#modalPin': modal }[s] || null), etProxy: px.etProxy, localStorage: ls, hoyNY, toast: (t) => reg.toasts.push(t), ruta: () => reg.rutas++, cargarCadena: () => reg.cadena++ }, { consts: ['ET_K'], prefijo: 'let _ord = null;' });
    await F.etradePinEnviar('RT1');
    igual(px.llamadas[0].body, { rt: 'RT1', pin: '12345' }, 'el código se manda recortado con el request token');
    igual([ls.almacen.mz_et_tok, ls.almacen.mz_et_sec, ls.almacen.mz_et_dia, ls.almacen.mz_et_sync2, ls.almacen.mz_et_cache, ls.almacen.mz_et_login], ['TOK', 'SEC', HOY, undefined, undefined, undefined], 'al conectar: token y secret guardados, día = HOY (vale hasta medianoche ET), sync/caché/login a medias borrados');
    igual([reg.quitado, reg.rutas, reg.toasts[0]], [1, 1, 'E*TRADE conectada ✓'], 'se cierra el cuadro, se avisa y se redibuja');
    const F2 = construir(['etradePinEnviar', 'etGuardar', 'etLoginOlvidar'], { $: (s) => ({ '#etPin': nodo({ value: '' }), '#etErr': errNodo }[s] || null), etProxy: px.etProxy, localStorage: ls, hoyNY, toast: () => {}, ruta: () => {}, cargarCadena: () => {} }, { consts: ['ET_K'], prefijo: 'let _ord = null;' });
    await F2.etradePinEnviar('RT1'); igual(errNodo.textContent, 'Pega el código de verificación.', 'sin código no se manda nada');
    const px3 = proxyFalso({ '/etrade/login/finish': [{ status: 200, data: { error: 'PIN inválido' } }] });
    const F3 = construir(['etradePinEnviar', 'etGuardar', 'etLoginOlvidar'], { $: (s) => ({ '#etPin': nodo({ value: '1' }), '#etErr': errNodo }[s] || null), etProxy: px3.etProxy, localStorage: ls, hoyNY, toast: () => {}, ruta: () => {}, cargarCadena: () => {} }, { consts: ['ET_K'], prefijo: 'let _ord = null;' });
    await F3.etradePinEnviar('RT1'); igual([errNodo.textContent, ls.almacen.mz_et_tok], ['PIN inválido', 'TOK'], 'un código rechazado deja el error a la vista y no pisa el token que había');
  }

  // ════════════════ 7. el fuente: nada con poder de operar sale del dispositivo ════════════════
  assert(!/console\.(log|warn|error)\([^)]*(token_secret|\.token\b)/.test(FUENTE), 'ningún console.* imprime el token o el secret');
  assert(!/sb\.from\([^)]*\)\.(insert|upsert|update)\([^)]*token_secret/.test(FUENTE), 'el token de E*TRADE jamás se escribe en Supabase');
  assert(/localStorage\.setItem\(ET_K\.tok, t\); localStorage\.setItem\(ET_K\.sec, s\);/.test(FUENTE), 'el token con poder vive en localStorage del dispositivo (opción B)');
  assert(/if \(r\.status === 401 && renovado === false\) etMarcarMuerto\(cr\);/.test(C.extraer('etRead')) && /if \(r\.status === 401 && renovado === false\) etMarcarMuerto\(cr\);/.test(C.extraer('etPost')), 'etRead y etPost solo dan el token por muerto con un rechazo EXPLÍCITO del renew');

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
