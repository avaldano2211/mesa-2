#!/usr/bin/env node
/* Pruebas de la carrera de la cadena de opciones en vivo (cargarCadena): la guarda
   de identidad vigente() (= mismo formulario _ord y misma generación cadenaGen)
   hace que una carga vieja no pise la nueva ni un formulario ya cerrado. Las
   respuestas de E*TRADE/Schwab se resuelven A MANO (promesas diferidas) para
   cruzarlas con cambios de ticker, de vencimiento y cierres del formulario.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_cadena_carrera.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_cadena_carrera.js');
const { FUENTE, assert, igual, construir, esc, BROKER_NOMBRE, nodo, diferido, respirar } = C;

const HOY = '2026-09-24';
// respuestas de E*TRADE de juguete (la forma real de /v1/market)
const RESP = {
  quote: (last) => ({ status: 200, data: { QuoteResponse: { QuoteData: [{ All: { lastTrade: last, bid: last - 0.1, ask: last + 0.1 }, quoteStatus: 'REALTIME' }] } } }),
  vencs: () => ({ status: 200, data: { OptionExpireDateResponse: { ExpirationDate: [{ year: 2026, month: 9, day: 26, expiryType: 'WEEKLY' }, { year: 2026, month: 10, day: 2, expiryType: 'WEEKLY' }] } } }),
  cadena: (exp, strike) => ({ status: 200, data: { OptionChainResponse: { OptionPair: [{ Call: { symbol: 'c', strikePrice: strike, bid: 3.2, ask: 3.4, OptionGreeks: { delta: 0.3 } }, Put: { symbol: 'p', strikePrice: strike, bid: 2.9, ask: 3.1 } }],
    SelectedED: { year: Number(exp.slice(0, 4)), month: Number(exp.slice(5, 7)), day: Number(exp.slice(8, 10)) }, quoteType: 'REALTIME', nearPrice: strike } } }),
};
function armar(E) {
  E = Object.assign({ creds: { token: 't', token_secret: 's' }, vencido: false, sw: null, swVencido: false, modal: true }, E || {});
  const form = Object.assign({ symbol: 'AAPL', tipo: 'CALL', accion: 'compra', strike: '230', expiracion: '2026-09-26' }, E.form || {});
  const reg = { lecturas: [], swLecturas: [], pintadas: 0, avisos: 0, timers: [], box: nodo(), exp: nodo() };
  const nodos = { '#oCadena': reg.box, '#oExp': reg.exp, '#modalOrden': E.modal ? nodo() : null };
  const M = construir(['cargarCadena', 'parsearCotizacion', 'parsearVencimientos', 'parsearCadena', 'etError', 'errorCadena401', 'textoErrorCadena',
    'swMensajeError', 'parsearCotizacionSchwab', 'parsearVencimientosSchwab', 'parsearCadenaSchwab'], {
    $: (s) => nodos[s] || null, leerFormOrden: () => Object.assign({}, form), swCreds: () => E.sw, etCreds: () => E.creds, swVencido: () => E.swVencido, etDiaVencido: () => E.vencido,
    BROKER_NOMBRE, esc, hoyNY: () => HOY, pintarCadena: () => reg.pintadas++, pintarAvisosOrden: () => reg.avisos++,
    setInterval: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; },
    // cada lectura queda diferida: la prueba decide cuándo y con qué contesta E*TRADE
    etRead: (cr, p, query) => { const d = diferido(); reg.lecturas.push({ path: p, query, d }); return d.promesa; },
    swRead: (p, query) => { const d = diferido(); reg.swLecturas.push({ path: p, query, d }); return d.promesa; },
  }, { consts: ['CADENA_STRIKES', 'num2'], extras: ['CADENA_REFRESCO_MS', '__setOrd'], prefijo: 'let _ord = null; function __setOrd(v) { _ord = v; }' });
  const nuevoOrd = (x) => Object.assign({ pre: {}, broker: 'etrade', ctx: null, orden: null, cadena: null, cadenaSym: null, cadenaExp: null, cadenaClave: '', cadenaTs: 0, cadenaTimer: null, cadenaErr: null, cadenaCargando: false, cadenaGen: 0, cotiz: null, cotizTs: 0, vencs: [] }, x || {});
  // contesta la lectura número i con la respuesta que toque por su path
  const contestar = async (i, resp) => { const l = reg.lecturas[i]; l.d.resolver(resp || (/quote/.test(l.path) ? RESP.quote(230.5) : /expiredate/.test(l.path) ? RESP.vencs() : RESP.cadena(l.query.expiryYear + '-' + String(l.query.expiryMonth).padStart(2, '0') + '-' + String(l.query.expiryDay).padStart(2, '0'), 230))); await respirar(); await respirar(); };
  return { M, reg, form, E, nuevoOrd, contestar };
}
const simbolos = (reg) => reg.lecturas.map(l => (/quote\/(\w+)\.json/.exec(l.path) || [])[1] || l.query.symbol);

(async () => {
  // ════════════════ 1. cambio de ticker EN VUELO: la carga vieja se descarta y se relanza con el formulario actual ════════════════
  {
    const { M, reg, form, nuevoOrd, contestar } = armar();
    const o = nuevoOrd(); M.__setOrd(o);
    const p = M.cargarCadena(false);
    igual([reg.lecturas.length, simbolos(reg)], [2, ['AAPL', 'AAPL']], 'símbolo nuevo: se piden a la vez la cotización y los vencimientos de AAPL');
    assert(/consultando E\*TRADE/.test(reg.box.innerHTML) && o.cadenaCargando === true, 'mientras tanto la caja dice «consultando» y la carga queda marcada en curso');
    igual(await M.cargarCadena(true), undefined, 'una segunda llamada con la carga en curso vuelve enseguida (no duplica lecturas)');
    igual(reg.lecturas.length, 2, 'sin lecturas nuevas');
    // Andrés cambia el ticker a TSLA (lo que hace el manejador change: cadenaSym = null, gen++, cargarCadena(true))
    form.symbol = 'TSLA'; o.cadenaSym = null; o.cadenaGen++; M.cargarCadena(true);
    igual(reg.lecturas.length, 2, 'el cambio no lanza nada mientras la carga vieja sigue en vuelo');
    await contestar(0); await contestar(1);           // llegan las respuestas de AAPL, ya viejas
    await p;
    igual([o.cotiz, o.vencs, o.cadenaSym], [null, [], null], 'la respuesta vieja de AAPL NO entra en el formulario');
    igual([reg.lecturas.length, simbolos(reg).slice(2)], [4, ['TSLA', 'TSLA']], 'y se relanza sola con el formulario actual: cotización y vencimientos de TSLA');
    igual(reg.pintadas, 0, 'la carga vieja no pintó nada');
    await contestar(2, RESP.quote(400)); await contestar(3);
    igual([reg.lecturas.length, reg.lecturas[4].query.symbol, reg.lecturas[4].query.expiryDay], [5, 'TSLA', 26], 'con cotización y vencimientos llega la cadena de TSLA del vencimiento del formulario');
    igual([reg.lecturas[4].query.noOfStrikes, reg.lecturas[4].query.strikePriceNear], [14, 400], '14 strikes alrededor del precio de TSLA');
    await contestar(4, RESP.cadena('2026-09-26', 400));
    igual([o.cadenaSym, o.cadenaClave, o.cadenaExp, o.cadena.filas.length, o.cadena.filas[0].strike, o.cotiz.last, o.cadenaErr, o.cadenaCargando], ['TSLA', 'TSLA|2026-09-26', '2026-09-26', 1, 400, 400, null, false], 'la cadena vigente es la de TSLA');
    igual([reg.pintadas, reg.avisos], [1, 1], 'y se pinta UNA vez (la cadena y los avisos)');
    igual([reg.timers.length, reg.timers[0].ms], [1, 15000], 'el refresco automático de 15 s se programa una sola vez por formulario');
  }

  // ════════════════ 2. formulario CERRADO en vuelo: nada se toca, nada se relanza ════════════════
  {
    const { M, reg, nuevoOrd, contestar } = armar();
    const o = nuevoOrd(); M.__setOrd(o);
    const p = M.cargarCadena(false);
    M.__setOrd(null);                                 // cerrarOrden() mientras E*TRADE contestaba
    await contestar(0); await contestar(1); await p;
    igual([o.cotiz, o.cadena, o.cadenaCargando, reg.lecturas.length, reg.pintadas], [null, null, false, 2, 0], 'con el formulario cerrado la respuesta se descarta, no se relanza ni se pinta, y la marca de carga se suelta');
  }

  // ════════════════ 3. formulario REABIERTO (otro _ord) en vuelo: la vieja no pisa la nueva ════════════════
  {
    const { M, reg, nuevoOrd, contestar } = armar();
    const o1 = nuevoOrd(); M.__setOrd(o1);
    const p = M.cargarCadena(false);
    const o2 = nuevoOrd({ pre: { symbol: 'AAPL' } }); M.__setOrd(o2);   // cerrado y abierto de nuevo: OTRO objeto
    await contestar(0); await contestar(1); await p;
    igual([o1.cotiz, o2.cotiz, o2.cadena, reg.lecturas.length], [null, null, null, 2], 'la carga del formulario viejo no toca ni al viejo ni al nuevo, y no relanza nada (el nuevo pide lo suyo)');
    M.cargarCadena(false);
    igual(reg.lecturas.length, 4, 'el formulario nuevo pide su propia cadena');
    await contestar(2); await contestar(3); await contestar(4);
    assert(o2.cadenaSym === 'AAPL' && o2.cadena && o1.cadena === null, 'y solo el nuevo la recibe');
  }

  // ════════════════ 4. cambio de VENCIMIENTO mientras llega la cadena ════════════════
  {
    const { M, reg, form, nuevoOrd, contestar } = armar();
    const o = nuevoOrd(); M.__setOrd(o);
    const p = M.cargarCadena(false);
    await contestar(0); await contestar(1);           // cotización y vencimientos ya están; la cadena del 26-sep está en vuelo
    igual([o.cadenaSym, reg.lecturas.length, reg.lecturas[2].query.expiryDay], ['AAPL', 3, 26], 'con la cotización dentro se pide la cadena del vencimiento del formulario');
    form.expiracion = '2026-10-02'; o.cadenaGen++; M.cargarCadena(true);   // el manejador change del vencimiento
    await contestar(2); await p;                      // llega la cadena del 26-sep, ya vieja
    igual(o.cadena, null, 'la cadena vieja (26-sep) no entra');
    igual([reg.lecturas.length, /quote/.test(reg.lecturas[3].path)], [4, true], 'se relanza: el símbolo ya se conoce, así que solo se refresca la cotización…');
    await contestar(3);
    igual([reg.lecturas.length, reg.lecturas[4].query.expiryMonth, reg.lecturas[4].query.expiryDay], [5, 10, 2], '…y se pide la cadena del vencimiento NUEVO (2-oct)');
    await contestar(4);
    igual([o.cadenaExp, o.cadenaClave, reg.pintadas], ['2026-10-02', 'AAPL|2026-10-02', 1], 'la cadena vigente es la del 2-oct y se pintó una sola vez');
  }

  // ════════════════ 5. errores: E*TRADE rechaza, 401, red; y un error viejo tampoco pisa ════════════════
  {
    const { M, reg, nuevoOrd, contestar } = armar();
    const o = nuevoOrd(); M.__setOrd(o);
    const p = M.cargarCadena(false);
    await contestar(0, { status: 400, data: { Error: { message: 'Invalid symbol' } } }); await contestar(1); await p;
    igual([o.cadenaErr, o.cadenaCargando, reg.pintadas, o.cotiz], ['Invalid symbol', false, 1, null], 'E*TRADE rechaza la cotización: el motivo literal queda en cadenaErr y se pinta (la vista lo muestra)');
    const { M: M2, reg: r2, nuevoOrd: n2, contestar: c2 } = armar();
    const o2 = n2(); M2.__setOrd(o2);
    const p2 = M2.cargarCadena(false);
    await c2(0, { status: 401, data: { Error: { message: 'oauth_problem=token_expired' } } }); await c2(1); await p2;
    assert(/E\*TRADE rechazó la lectura de mercado \(401\): oauth_problem=token_expired/.test(o2.cadenaErr), 'un 401 con el token aún vivo muestra el motivo de E*TRADE', o2.cadenaErr);
    const { M: M3, nuevoOrd: n3, contestar: c3 } = armar();
    const o3 = n3(); M3.__setOrd(o3);
    const p3 = M3.cargarCadena(false);
    await c3(0, { status: 200, data: {} }); await c3(1); await c3(2, { status: 200, data: { Error: { message: 'Chain unavailable' } } }); await p3;
    igual([o3.cadenaErr, o3.cadena, o3.cadenaSym], ['Chain unavailable', null, 'AAPL'], 'si falla solo la cadena, la cotización se queda y el error es el de la cadena');
    // excepción de red de Safari/iOS (fetch cortado al ir al fondo): se traduce
    const { M: M4, reg: r4, nuevoOrd: n4 } = armar();
    const o4 = n4(); M4.__setOrd(o4);
    const p4 = M4.cargarCadena(false);
    r4.lecturas[0].d.rechazar(new TypeError('Load failed')); r4.lecturas[1].d.resolver(RESP.vencs()); await p4;
    assert(/sin conexión con el proxy — revisa la red y toca ↻/.test(o4.cadenaErr), '«Load failed» de iOS se traduce a «sin conexión con el proxy», no es un error de E*TRADE', o4.cadenaErr);
    // un ERROR viejo (el formulario ya cambió de ticker) no se queda: se relanza y el nuevo manda
    const { M: M5, reg: r5, form: f5, nuevoOrd: n5, contestar: c5 } = armar();
    const o5 = n5(); M5.__setOrd(o5);
    const p5 = M5.cargarCadena(false);
    f5.symbol = 'NVDA'; o5.cadenaSym = null; o5.cadenaGen++;
    await c5(0, { status: 400, data: { Error: { message: 'Invalid symbol' } } }); await c5(1); await p5;
    igual([r5.pintadas, r5.lecturas.length, simbolos(r5)[2]], [0, 4, 'NVDA'], 'el error de la carga vieja no se pinta: se relanza con NVDA');
    await c5(2, RESP.quote(180)); await c5(3); await c5(4, RESP.cadena('2026-09-26', 180));
    igual([o5.cadenaErr, o5.cadenaSym, r5.pintadas], [null, 'NVDA', 1], 'y la buena limpia el error');
  }

  // ════════════════ 6. caché de 5 s, forzar, sin sesión, acción ════════════════
  {
    const { M, reg, form, nuevoOrd, contestar } = armar();
    const o = nuevoOrd(); M.__setOrd(o);
    const p = M.cargarCadena(false); await contestar(0); await contestar(1); await contestar(2); await p;
    igual(reg.lecturas.length, 3, 'una carga completa son 3 lecturas');
    await M.cargarCadena(false);
    igual(reg.lecturas.length, 3, 'a los pocos segundos, con la misma clave, no se vuelve a pedir (5 s de gracia entre redibujos)');
    const p2 = M.cargarCadena(true);
    igual([reg.lecturas.length, /quote/.test(reg.lecturas[3].path)], [4, true], 'forzar (refresco de 15 s, volver del fondo): solo la cotización…');
    await contestar(3, RESP.quote(231)); igual(reg.lecturas.length, 5, '…y la cadena');
    await contestar(4); await p2;
    igual([o.cotiz.last, reg.pintadas], [231, 2], 'la cotización se refrescó y se repintó');
    // el refresco automático solo corre si el formulario sigue siendo este, sin vista previa en curso
    o.orden = { previsualizada: true }; reg.timers[0].fn();
    igual(reg.lecturas.length, 5, 'con una vista previa en curso el refresco de 15 s no toca la cadena');
    o.orden = null; reg.timers[0].fn();
    igual(reg.lecturas.length, 6, 'sin vista previa, el refresco relee');
    await contestar(5); await contestar(6);
    M.__setOrd(nuevoOrd()); reg.timers[0].fn();
    igual(reg.lecturas.length, 7, 'el refresco de un formulario viejo no dispara nada en el nuevo');
    form.tipo = 'EQ'; await M.cargarCadena(true);
    igual([reg.box.innerHTML, reg.lecturas.length], ['', 7], 'una acción no tiene cadena: la caja se vacía sin pedir nada');
  }
  {
    const { M, reg, nuevoOrd } = armar({ creds: null });
    M.__setOrd(nuevoOrd()); await M.cargarCadena(false);
    assert(/conecta E\*TRADE/.test(reg.box.innerHTML) && /MZ\.conectar\('etrade'\)/.test(reg.box.innerHTML) && reg.lecturas.length === 0, 'sin sesión de E*TRADE: enlace para conectar y ninguna lectura');
    const { M: M2, reg: r2, nuevoOrd: n2 } = armar({ vencido: true });
    M2.__setOrd(n2()); await M2.cargarCadena(false);
    assert(/caducó — <a[^>]*>reconectar/.test(r2.box.innerHTML) && r2.lecturas.length === 0, 'token muerto: «caducó — reconectar» sin molestar al proxy');
    const { M: M3, reg: r3 } = armar();
    M3.__setOrd(null); await M3.cargarCadena(false);
    igual(r3.lecturas.length, 0, 'sin formulario no hay cadena');
  }
  // vencimiento: el del formulario si existe; si no, el del rango vivo; si no, el primero desde hoy — y se escribe en #oExp
  {
    const { M, reg, nuevoOrd, contestar } = armar({ form: { expiracion: '' } });
    const o = nuevoOrd({ ctx: { rangos: { AAPL: { exp: '2026-10-02' } } } }); M.__setOrd(o);
    const p = M.cargarCadena(false); await contestar(0); await contestar(1);
    igual([reg.lecturas[2].query.expiryDay, reg.exp.value], [2, '2026-10-02'], 'sin vencimiento en el formulario manda el del rango vivo y se escribe en el campo');
    await contestar(2); await p;
    const { M: M2, reg: r2, nuevoOrd: n2, contestar: c2 } = armar({ form: { expiracion: '2026-09-19' } });
    M2.__setOrd(n2()); const p2 = M2.cargarCadena(false); await c2(0); await c2(1);
    igual([r2.lecturas[2].query.expiryDay, r2.exp.value], [26, '2026-09-26'], 'un vencimiento que E*TRADE no lista (ya pasó) se sustituye por el primero desde hoy');
    await c2(2); await p2;
  }

  // ════════════════ 7. Schwab: mismo contrato de datos, misma guarda ════════════════
  {
    const { M, reg, form, nuevoOrd } = armar({ sw: { token: 't' }, creds: null });
    const o = nuevoOrd({ broker: 'schwab' }); M.__setOrd(o);
    const p = M.cargarCadena(false);
    igual(reg.swLecturas.map(l => l.path), ['/marketdata/v1/quotes', '/marketdata/v1/expirationchain'], 'Schwab: cotización y vencimientos por sus rutas de marketdata');
    form.symbol = 'TSLA'; o.cadenaSym = null; o.cadenaGen++; M.cargarCadena(true);
    reg.swLecturas[0].d.resolver({ status: 200, data: { AAPL: { quote: { lastPrice: 230.5, bidPrice: 230.4, askPrice: 230.6 }, realtime: true } } });
    reg.swLecturas[1].d.resolver({ status: 200, data: { expirationList: [{ expirationDate: '2026-09-26', expirationType: 'W', daysToExpiration: 2 }] } });
    await respirar(); await respirar(); await p;
    igual([o.cotiz, reg.swLecturas.length, reg.swLecturas[2].query.symbols], [null, 4, 'TSLA'], 'la guarda es la misma en Schwab: la respuesta vieja de AAPL se descarta y se relanza con TSLA');
    reg.swLecturas[2].d.resolver({ status: 200, data: { TSLA: { quote: { lastPrice: 400, bidPrice: 399.9, askPrice: 400.1 }, realtime: true } } });
    reg.swLecturas[3].d.resolver({ status: 200, data: { expirationList: [{ expirationDate: '2026-09-26', expirationType: 'W' }] } });
    await respirar(); await respirar();
    igual([reg.swLecturas[4].path, reg.swLecturas[4].query.symbol, reg.swLecturas[4].query.fromDate], ['/marketdata/v1/chains', 'TSLA', '2026-09-26'], 'y la cadena de Schwab del vencimiento elegido');
    reg.swLecturas[4].d.resolver({ status: 200, data: { status: 'SUCCESS', underlyingPrice: 400, callExpDateMap: { '2026-09-26:2': { '400.0': [{ symbol: 'TSLA  260926C00400000', bid: 3.2, ask: 3.4, delta: 0.3 }] } }, putExpDateMap: { '2026-09-26:2': { '400.0': [{ symbol: 'TSLA  260926P00400000', bid: 2.9, ask: 3.1, delta: -0.3 }] } } } });
    await respirar(); await respirar();
    igual([o.cadenaSym, o.cadena.filas.length, o.cadena.filas[0].call.delta, o.cadena.estado, o.cotiz.last, reg.pintadas], ['TSLA', 1, 0.3, 'REALTIME', 400, 1], 'la cadena de Schwab llega con la MISMA forma que la de E*TRADE');
    const { M: M2, reg: r2, nuevoOrd: n2 } = armar({ sw: { token: 't' }, creds: null, swVencido: true });
    M2.__setOrd(n2({ broker: 'schwab' })); await M2.cargarCadena(false);
    assert(/Charles Schwab caducó/.test(r2.box.innerHTML) && r2.swLecturas.length === 0, 'login semanal de Schwab caducado: se dice sin leer nada');
    const { M: M3, reg: r3, nuevoOrd: n3 } = armar({ sw: { token: 't' }, creds: null });
    const o3 = n3({ broker: 'schwab' }); M3.__setOrd(o3);
    const p3 = M3.cargarCadena(false);
    r3.swLecturas[0].d.resolver({ status: 401, data: { error: 'Schwab sin sesión' } }); r3.swLecturas[1].d.resolver({ status: 200, data: { expirationList: [] } });
    await p3;
    assert(/Schwab rechazó la lectura \(401\): Schwab sin sesión/.test(o3.cadenaErr), 'un 401 de Schwab con el login aún vivo muestra su motivo', o3.cadenaErr);
  }

  // ════════════════ 8. el cableado en el fuente: quién sube la generación ════════════════
  const abrir = C.extraer('abrirOrden');
  assert(/if \(\['oSym', 'oTipo', 'oExp', 'oAcc'\]\.includes\(id\)\) \{ _ord\.cadenaGen\+\+; cargarCadena\(true\); \}/.test(abrir), 'cambiar ticker, tipo, vencimiento o acción sube la generación y relanza la cadena');
  assert(/if \(id === 'oSym'\) _ord\.cadenaSym = null;/.test(abrir), 'un símbolo nuevo obliga a pedir cotización y vencimientos de nuevo');
  assert(/cadenaRefrescar: \(\) => \{ if \(_ord\) _ord\.cadenaGen\+\+; cargarCadena\(true\); \}/.test(FUENTE), 'el botón ↻ sube la generación');
  assert(/cadenaExp: \(v\) => \{[^}]*_ord\.cadenaGen\+\+;[^}]*\} cargarCadena\(true\); \}/.test(FUENTE), 'elegir un vencimiento en la cadena también');
  assert(/_ord\.cadenaGen\+\+;\s*\n\s*_ord\.qtyManual = false; autoCantidad\(\);/.test(C.extraer('cambiarBrokerOrden')), 'cambiar de bróker en el formulario vacía la cadena y sube la generación');
  assert(/if \(typeof _ord !== 'undefined' && _ord && \$\('#modalOrden'\)\) cargarCadena\(true\);/.test(FUENTE), 'al volver del fondo con el formulario abierto se recarga la cadena');
  const cc = C.extraer('cargarCadena');
  igual((cc.match(/if \(!vigente\(\)\) return descartar\(\);/g) || []).length, 6, 'tras CADA await de red (2 caminos × 3 lecturas) se comprueba vigente(): seis puertas');
  assert(/const vigente = \(\) => _ord === o && o\.cadenaGen === gen;/.test(cc), 'vigente() = mismo formulario Y misma generación');
  assert(/const descartar = \(\) => \{ o\.cadenaCargando = false; if \(_ord === o\) cargarCadena\(true\); \};/.test(cc), 'descartar suelta la marca y relanza SOLO si el formulario sigue siendo este');
  assert(/if \(!vigente\(\)\) \{ if \(_ord === o\) cargarCadena\(true\); return; \}\s*\n\s*pintarCadena\(\); pintarAvisosOrden\(\);/.test(cc), 'y antes de pintar se vuelve a comprobar (también cubre el camino del error)');

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
