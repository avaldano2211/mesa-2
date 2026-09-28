#!/usr/bin/env node
/* Pruebas de la v56 · EN VIVO (Andrés, 2026-09-28: «los valores no se están actualizando en
   tiempo real»): cotización cada 5 s por E*TRADE (o Schwab), una cotización con retraso no se
   usa, la cotización fresca manda sobre el lastTrade de la cartera, repintado EN SITIO de Mark /
   P&L / Salta en / barra sin tocar #vista, cartera cada 20 s y foto del worker por Realtime.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js): nada se reimplementa.
   Uso: node test_vivo.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_vivo.js');
const { FUENTE, assert, igual, cerca, construir, esc, usd, colUtil, BROKER_NOMBRE, nodo, respirar, haceCuanto } = C;

const PUROS = ['claveContrato', 'claveCartera', 'itemsCartera', 'simboloOpcionEtrade', 'contratosVivo', 'markDeCotizacion',
  'parsearCotizacionesEtrade', 'parsearCotizacionesSchwab', 'desOsi', 'osiDe', 'aplicarCotizacion', 'claveSlug', 'celdaMarkHtml',
  'celdaPnlHtml', 'lineaValorBroker', 'cifrasFila', 'markGestor', 'brokerCuadraConFicha', 'fmtPrima', 'totalesGestor', 'carteraToca',
  'etError', 'swMensajeError', 'haceCuantoSeg'];
const VIVOS = ['aplicarVivo', 'vivoToca', 'vivoFuente', 'cotizarVivo', 'tickVivo', 'fotoBrokerCambio', 'brDe', 'pintarVivoEnSitio',
  'textoVivoEstado', 'pintarVivoEstado'];
const CONSTS = ['VIVO_MS', 'VIVO_CARTERA_MS', 'VIVO_FRESCA_MS', 'VIVO_MAX_SIMBOLOS', 'VIVO_FALLOS_PAUSA', 'ETIQUETA_DEL_BROKER', '_vivo',
  'CART_BROKERS', 'BROKERS_WORKER', 'CART_TTL_ABIERTO', 'CART_MIN_MS', 'CART_MIN_FORZAR_MS',
  'num2', 'dineroD', 'enCopilotoAhora'];

// Un módulo con TODO lo de EN VIVO y un mundo de juguete controlable (E = escenario).
function armar(E) {
  E = Object.assign({ abierto: true, creds: { token: 't', token_secret: 's' }, sw: null, hash: '#/copiloto', visible: 'visible', modal: false, cambio: false }, E || {});
  const reg = { lecturas: [], swLecturas: [], vistas: 0, carteras: 0, saltas: [], timers: [], limpiados: 0, nodos: {} };
  const $ = (s) => reg.nodos[s] || null;
  const _gestor = { filas: [], pend: {}, sinRegistrar: null, sinColumnas: false };
  const _cart = { etrade: null, schwab: null, tasty: null, moomoo: null, enVuelo: {}, firma: '' };
  const M = construir(PUROS.concat(VIVOS), {
    $, esc, usd, colUtil, BROKER_NOMBRE, haceCuanto, _gestor, _cart,
    location: { hash: E.hash }, document: { get visibilityState() { return E.visible; }, querySelector: () => (E.modal ? {} : null) },
    sesionActiva: E.sesion === undefined ? { user: { id: 'u' } } : E.sesion, _hbUltimo: null,
    mercadoAbiertoNY: () => E.abierto,
    etCreds: () => E.creds, etDiaVencido: () => !!E.etVencido, swCreds: () => E.sw, swVencido: () => !!E.swVencido,
    etRead: async (cr, p, query) => { reg.lecturas.push({ cr, path: p, query }); return typeof E.etrade === 'function' ? E.etrade(p, query) : E.etrade; },
    swRead: async (p, query) => { reg.swLecturas.push({ path: p, query }); return typeof E.schwab === 'function' ? E.schwab(p, query) : E.schwab; },
    pintarSaltaEnSitio: (id) => reg.saltas.push(id), pnlVivo: (p) => 'PV ' + p.mark,
    cargarCartera: async () => { reg.carteras++; return E.cambio; }, vistaCopiloto: () => { reg.vistas++; },
    setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; }, clearTimeout: () => { reg.limpiados++; },
  }, { consts: CONSTS, extras: ['VIVO_PAUSA_MS', 'CART_TTL_CERRADO', 'CART_TTL_VETADA'] });
  return { M, reg, E, _gestor, _cart };
}
const RT = (s, extra) => Object.assign({ status: 200 }, extra || {}, { data: s });
const q = (symbol, dir, y, m, d, strike, bid, ask, last, estado) => ({ quoteStatus: estado || 'REALTIME',
  Intraday: { bid, ask, lastTrade: last }, Product: { symbol, securityType: 'OPTN', callPut: dir, expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: strike } });
const NV = { symbol: 'NVDA', direccion: 'CALL', strike: 235, expiracion: '2026-09-28' };
const SP = { symbol: 'SPY', direccion: 'PUT', strike: 662.5, expiracion: '2026-10-02' };
const K_NV = 'NVDA|CALL|235|2026-09-28', K_SP = 'SPY|PUT|662.5|2026-10-02';

(async () => {
  // ════════════════ 1. símbolos y lista de contratos ════════════════
  {
    const { M } = armar();
    igual(M.simboloOpcionEtrade(NV), 'NVDA:2026:9:28:CALL:235', 'símbolo E*TRADE: mes y día sin cero, strike sin ceros de más');
    igual(M.simboloOpcionEtrade(SP), 'SPY:2026:10:2:PUT:662.5', 'símbolo E*TRADE con strike de medio dólar');
    igual(M.simboloOpcionEtrade({ symbol: 'META', direccion: 'CALL', expiracion: '2026-10-02' }), null, 'sin strike no hay símbolo (ni petición)');
    igual(M.osiDe('SPY', '2026-10-02', 662.5, 'PUT'), 'SPY   261002P00662500', 'símbolo Schwab = OSI con raíz a 6');
    const abiertas = [{ id: 1, ...NV, broker: 'etrade' }, { id: 2, symbol: 'META', direccion: 'CALL', expiracion: '2026-10-02' }];
    const cart = { etrade: { estado: 'ok', items: [{ ...NV, broker: 'etrade', clave: 'etrade|' + K_NV }] },
      moomoo: { estado: 'ok', items: [{ ...NV, broker: 'moomoo', clave: 'moomoo|' + K_NV }, { ...SP, broker: 'moomoo', clave: 'moomoo|' + K_SP }] },
      schwab: { estado: 'error', items: [{ symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-09' }] }, tasty: null };
    const r = M.contratosVivo(abiertas, cart);
    igual(r.lista.map(x => x.clave), [K_NV, K_SP], 'una cotización por CONTRATO: el NVDA de E*TRADE y el de moomoo son el mismo; la ficha sin strike no entra; el bróker con error no aporta');
    igual(r.recortados, 0, 'nada recortado');
    const muchos = Array.from({ length: 30 }, (_, i) => ({ symbol: 'SPY', direccion: 'CALL', strike: 600 + i, expiracion: '2026-10-02' }));
    const r2 = M.contratosVivo(muchos, {});
    igual([r2.lista.length, r2.recortados], [25, 5], 'tope de 25 símbolos por petición y se cuenta lo que no cupo (no se calla)');
  }
  // ════════════════ 2. mark de una cotización ════════════════
  {
    const { M } = armar();
    igual(M.markDeCotizacion(1.2, 1.3, 1.5), 1.25, 'punto medio bid/ask');
    igual(M.markDeCotizacion(0, 0, 1.5), 1.5, 'sin puntas: el último cruce');
    igual(M.markDeCotizacion(1.3, 1.2, 1.5), 1.5, 'puntas cruzadas (ask < bid): no se promedian, último cruce');
    igual(M.markDeCotizacion(1.1, 0, 0), 1.1, 'solo bid: el bid');
    igual(M.markDeCotizacion(0, 0, 0), null, 'sin nada: null (no se inventa 0)');
    igual(M.markDeCotizacion(0.33333, 0.33334, 0), 0.3333, 'redondeo a 4 decimales');
  }
  // ════════════════ 3. respuesta de E*TRADE ════════════════
  {
    const { M } = armar();
    const pedidos = [{ clave: K_NV }, { clave: K_SP }];
    // llegan al revés y con un Messages (símbolo inválido): se casa por Product, no por posición
    const resp = RT({ QuoteResponse: { QuoteData: [q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.1, 3.3, 3.25), q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34)],
      Messages: { Message: [{ description: 'Invalid symbol', type: 'ERROR' }] } } });
    const r = M.parsearCotizacionesEtrade(resp, pedidos);
    igual([r.n, r.estado], [2, 'REALTIME'], 'dos cotizaciones REALTIME');
    igual(r.por[K_NV], { mark: 0.33, bid: 0.31, ask: 0.35, last: 0.34, estado: 'REALTIME' }, 'NVDA casado por contrato: mark = medio de 0.31/0.35');
    igual(r.por[K_SP].mark, 3.2, 'SPY 662.5 PUT casado aunque llegó primero');
    // año a 2 dígitos (E*TRADE lo hace en otras rutas) y bloque All en vez de Intraday
    const r2 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', All: { bid: 1, ask: 1.2, lastTrade: 1.1 },
      Product: { symbol: 'nvda', callPut: 'Call', expiryYear: 26, expiryMonth: 9, expiryDay: 28, strikePrice: '235' } }] } }), pedidos);
    igual(Object.keys(r2.por), [K_NV], 'año a 2 dígitos, símbolo en minúsculas, strike como texto y bloque All: se casa igual');
    // sin Product y mismo largo: por posición
    const r3 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2 } }, { quoteStatus: 'REALTIME', Intraday: { lastTrade: 2 } }] } }), pedidos);
    igual([r3.por[K_NV].mark, r3.por[K_SP].mark], [1.1, 2], 'sin Product pero con el largo de lo pedido: se casa por posición');
    const r4 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2 } }] } }), pedidos);
    igual(r4.n, 0, 'sin Product y con OTRO largo: no se adivina (mejor sin mark que con el mark de otro contrato)');
    // una con retraso contamina el lote
    const r5 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.1, 3.3, 3.25, 'DELAYED'), q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34)] } }), pedidos);
    igual(r5.estado, 'DELAYED', 'con UNA cotización con retraso el lote entero es «con retraso»');
    igual(M.parsearCotizacionesEtrade(RT({ QuoteResponse: { Messages: { Message: [{ description: 'x' }] } } }), pedidos), { por: {}, estado: 'VACIA', n: 0 }, 'solo Messages: vacía');
    igual(M.parsearCotizacionesEtrade({ status: 200, data: null }, pedidos).n, 0, 'sin data: no revienta');
  }
  // ════════════════ 4. respuesta de Schwab ════════════════
  {
    const { M } = armar();
    const r = M.parsearCotizacionesSchwab(RT({ 'NVDA  260928C00235000': { assetMainType: 'OPTION', realtime: true, quote: { bidPrice: 0.3, askPrice: 0.36, lastPrice: 0.34, mark: 0.33 } },
      'SPY   261002P00662500': { realtime: true, quote: { bidPrice: 0, askPrice: 0, lastPrice: 0, mark: 3.2 } }, 'errors': { invalids: ['X'] } }));
    igual([r.n, r.estado, r.por[K_NV].mark, r.por[K_SP].mark], [2, 'REALTIME', 0.33, 3.2], 'Schwab: por OSI; sin puntas ni cruce vale su «mark»; la clave errors se ignora');
    igual(M.parsearCotizacionesSchwab(RT({ 'NVDA  260928C00235000': { realtime: false, quote: { bidPrice: 0.3, askPrice: 0.36 } } })).estado, 'DELAYED', 'realtime=false → con retraso');
  }
  // ════════════════ 5. aplicar una cotización ════════════════
  {
    const { M } = armar();
    const it = { ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 900, pnl_usd: 95, pnl_pct: 10.6, comisiones: 5 };
    assert(M.aplicarCotizacion(it, { mark: 6, bid: 5.9, ask: 6.1 }, 1700000000000, 'cartera'), 'aplica');
    igual([it.mark, it.valor_actual, it.pnl_usd, it.pnl_pct, it._comis, it.mark_fuente, it.mark_at], [6, 1200, 295, 32.8, 5, 'vivo', '2023-11-14T22:13:20.000Z'],
      'cartera: valor = mark × qty × 100, P&L = valor − invertido − la comisión que el bróker ya descontaba (1000 − 900 − 95 = 5), % sobre invertido');
    M.aplicarCotizacion(it, { mark: 5.5 }, 1700000001000, 'cartera');
    igual([it.valor_actual, it.pnl_usd, it._comis], [1100, 195, 5], 'la comisión se calcula UNA vez (con la lectura del bróker), no sobre las cifras ya vivas');
    const sinNeto = { ...NV, broker: 'moomoo', contratos: 30, prima_fill: 0.3, mark: 0.2, valor_actual: 600, invertido: 900, pnl_usd: null, pnl_pct: null };
    M.aplicarCotizacion(sinNeto, { mark: 0.33 }, Date.now(), 'cartera');
    igual([sinNeto.valor_actual, sinNeto.pnl_usd, sinNeto.pnl_pct, sinNeto._comis], [990, 90, 10, 0], 'sin neto del bróker: comisión 0, P&L = valor − invertido');
    const absurda = { ...NV, contratos: 1, valor_actual: 100, invertido: 900, pnl_usd: 500 };   // valor − invertido − neto = −1300: no es una comisión
    M.aplicarCotizacion(absurda, { mark: 2 }, Date.now(), 'cartera');
    igual([absurda._comis, absurda.pnl_usd], [0, -700], 'una «comisión» fuera de [−1, 100] es otra cosa: se ignora (0)');
    const p = { id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, mfe: 5.2 };
    M.aplicarCotizacion(p, { mark: 6 }, Date.now(), 'libro');
    igual([p.mark, p.mark_fuente, p.valor_actual, p.pnl_usd, p.mfe], [6, 'vivo', undefined, undefined, 5.2], 'libro: solo el mark (el mfe lo persiste el worker; en pantalla nivelGestor ya usa max(mfe, mark))');
    igual(M.aplicarCotizacion(p, { mark: 0 }, Date.now(), 'libro'), false, 'un mark 0 no se aplica');
    igual(p.mark, 6, '…y el anterior se conserva');
  }
  // ════════════════ 6. aplicarVivo: fresca manda, vieja no ════════════════
  {
    const { M, _gestor, _cart } = armar();
    _cart.etrade = { estado: 'ok', ts: Date.now(), items: [{ ...NV, broker: 'etrade', clave: 'etrade|' + K_NV, contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 900, pnl_usd: 95 }] };
    _cart.moomoo = { estado: 'ok', ts: Date.now(), items: [{ ...SP, broker: 'moomoo', clave: 'moomoo|' + K_SP, contratos: 1, prima_fill: 3, mark: 3.1, valor_actual: 310, invertido: 300, pnl_usd: 10 }] };
    _cart.schwab = { estado: 'sesion', ts: Date.now(), items: [{ ...NV, broker: 'schwab', clave: 'schwab|' + K_NV, contratos: 1, mark: 1 }] };
    _gestor.filas = [{ id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 }];
    M._vivo.por = { [K_NV]: { mark: 6 }, [K_SP]: { mark: 3.4 } }; M._vivo.ts = Date.now() - 3000;
    igual(M.aplicarVivo(), 3, 'aplica a la cartera de E*TRADE, a la foto de moomoo y a la ficha del libro (el bróker sin sesión no)');
    igual([_cart.etrade.items[0].mark, _cart.moomoo.items[0].pnl_usd, _gestor.filas[0].mark, _cart.schwab.items[0].mark], [6, 40, 6, 1], 'marks y P&L nuevos donde toca');
    M._vivo.ts = Date.now() - 20000;
    igual(M.aplicarVivo(), 0, 'una cotización de hace 20 s ya no manda (VIVO_FRESCA_MS): la lectura del bróker vuelve a valer');
  }
  // ════════════════ 7. vivoToca / vivoFuente ════════════════
  {
    igual(armar().M.vivoToca(), true, 'toca: sesión, Copiloto, ventana visible, mercado abierto');
    igual(armar({ hash: '#/cuentas' }).M.vivoToca(), false, 'en otra pestaña no se cotiza');
    igual(armar({ visible: 'hidden' }).M.vivoToca(), false, 'con la app en el fondo no se cotiza');
    igual(armar({ abierto: false }).M.vivoToca(), false, 'con el mercado cerrado no se cotiza (los marks son del cierre)');
    igual(armar({ sesion: null }).M.vivoToca(), false, 'sin sesión no');
    igual(armar().M.vivoFuente().fuente, 'etrade', 'con E*TRADE en este equipo: E*TRADE');
    igual(armar({ creds: null, sw: { token: 'x' } }).M.vivoFuente().fuente, 'schwab', 'sin E*TRADE pero con Schwab: Schwab');
    igual(armar({ etVencido: true, sw: { token: 'x' } }).M.vivoFuente().fuente, 'schwab', 'E*TRADE vencido de día: Schwab');
    const a = armar({ sw: { token: 'x' } }); a._cart.etrade = { estado: 'sesion' };
    igual(a.M.vivoFuente().fuente, 'schwab', 'E*TRADE con la sesión caída en la cartera: Schwab');
    igual(armar({ creds: null }).M.vivoFuente().fuente, null, 'sin ninguno: nadie');
  }
  // ════════════════ 8. cotizarVivo por E*TRADE: la petición, el resultado y el repintado ════════════════
  {
    const nodos = { '#g_mark_7': nodo(), '#g_pnl_7': nodo(), '#g_vivo_7': nodo(), '#g_sum_val': nodo(), '#g_sum_dif': nodo(), '#g_vivo_estado': nodo(),
      '#g_bmark_moomoo_SPY_PUT_662_5_2026_10_02': nodo(), '#g_bpnl_moomoo_SPY_PUT_662_5_2026_10_02': nodo() };
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.3, 3.5, 3.4)] } }) });
    Object.assign(A.reg.nodos, nodos);
    const br = { ...NV, broker: 'etrade', clave: 'etrade|' + K_NV, contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 900, pnl_usd: 95, pnl_pct: 10.6 };
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [br] };
    A._cart.moomoo = { estado: 'ok', ts: Date.now(), foto_at: new Date().toISOString(), items: [{ ...SP, broker: 'moomoo', clave: 'moomoo|' + K_SP, contratos: 1, prima_fill: 3, mark: 3.1, valor_actual: 310, invertido: 300, pnl_usd: 10, pnl_pct: 3.3 }] };
    A._gestor.filas = [{ id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, _br: br, _grupo: { libroContratos: 2, fichas: 1 } }];
    A._gestor.sinRegistrar = new Set(['moomoo|' + K_SP]);
    const r = await A.M.cotizarVivo();
    igual(A.reg.lecturas.length, 1, 'UNA petición para todos los contratos');
    igual(A.reg.lecturas[0].path, '/v1/market/quote/NVDA:2026:9:28:CALL:235,SPY:2026:10:2:PUT:662.5.json', 'la ruta de E*TRADE con los símbolos de opción separados por coma (lista blanca /v1/market del proxy)');
    igual(A.reg.lecturas[0].query, { detailFlag: 'INTRADAY' }, 'detailFlag INTRADAY (bid, ask, lastTrade)');
    igual([r.n, A.M._vivo.fuente, A.M._vivo.estado, A.M._vivo.n, A.M._vivo.fallos], [2, 'etrade', 'REALTIME', 2, 0], 'dos cotizaciones aplicadas');
    igual([br.mark, br.valor_actual, br.pnl_usd], [6, 1200, 295], 'la cartera de E*TRADE lleva el mark vivo (y su P&L neto recalculado)');
    igual(A._gestor.filas[0].mark, 6, 'la ficha del libro también');
    assert(/<b>6\.00<\/b>/.test(nodos['#g_mark_7'].innerHTML) && /vale \$1,200\.00/.test(nodos['#g_mark_7'].innerHTML), 'celda Mark repintada en sitio: 6.00 · vale $1,200.00');
    assert(/\+32\.8%/.test(nodos['#g_pnl_7'].innerHTML) && /\+\$295\.00/.test(nodos['#g_pnl_7'].innerHTML) && /neto/.test(nodos['#g_pnl_7'].innerHTML), 'celda P&L repintada: +32.8% · +$295.00 neto (el bróker cuadra con la ficha)');
    igual(nodos['#g_pnl_7'].style.color, 'var(--verde)', 'color del P&L');
    igual(nodos['#g_vivo_7'].innerHTML, 'PV 6', 'la línea de P&L vivo (tarjeta/detalle) también');
    igual(A.reg.saltas, [7], '«Salta en» se recalcula en sitio con el mark nuevo');
    assert(/<b>3\.40<\/b>/.test(nodos['#g_bmark_moomoo_SPY_PUT_662_5_2026_10_02'].innerHTML), 'la fila SIN REGISTRAR de moomoo también (mark 3.40 por E*TRADE)');
    igual(nodos['#g_sum_val'].textContent, '$1,540.00', 'barra VALOR AHORA = 1200 + 340');
    assert(/\+\$335\.00/.test(nodos['#g_sum_dif'].innerHTML) && /27\.9%/.test(nodos['#g_sum_dif'].innerHTML), 'barra GANANCIA = 295 + 40 = +$335.00 (27.9% de 1200)');
    assert(/^EN VIVO · E\*TRADE cada 5 s · 2 contrato\(s\) · hace \d+ s$/.test(nodos['#g_vivo_estado'].textContent), 'la barra dice EN VIVO · E*TRADE cada 5 s · hace N s → ' + nodos['#g_vivo_estado'].textContent);
    igual(A.reg.vistas, 0, 'nada se redibujó entero (#vista intacto: el foco de un parámetro no se pierde)');
    // segunda pasada en vuelo: no duplica
    A.M._vivo.enVuelo = true; igual(await A.M.cotizarVivo(), null, 'con una cotización en vuelo no se lanza otra'); A.M._vivo.enVuelo = false;
  }
  // ════════════════ 9. con retraso NO se usa; errores seguidos → pausa; Schwab de respaldo ════════════════
  {
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6, 'DELAYED')] } }) });
    A.reg.nodos['#g_vivo_estado'] = nodo();
    const br = { ...NV, broker: 'etrade', clave: 'etrade|' + K_NV, contratos: 2, prima_fill: 4.5, mark: 5 };
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [br] };
    await A.M.cotizarVivo();
    igual([br.mark, A.M._vivo.estado, A.M._vivo.n, A.M._vivo.pausaHasta > Date.now()], [5, 'DELAYED', 0, true], 'DELAYED: el mark del bróker se queda, estado con retraso y 5 min de pausa');
    assert(/CON RETRASO/.test(A.reg.nodos['#g_vivo_estado'].textContent), 'y la barra lo dice: ' + A.reg.nodos['#g_vivo_estado'].textContent);
    igual(await A.M.cotizarVivo(), null, 'en pausa no se pregunta');
    igual(A.reg.lecturas.length, 1, '(ninguna lectura nueva)');
    // tres errores seguidos
    const B = armar({ etrade: { status: 500, data: { Error: { message: 'oops' } } } });
    B.reg.nodos['#g_vivo_estado'] = nodo();
    B._cart.etrade = { estado: 'ok', ts: Date.now(), items: [{ ...NV, broker: 'etrade', clave: 'etrade|' + K_NV, contratos: 1 }] };
    await B.M.cotizarVivo(); await B.M.cotizarVivo();
    igual([B.M._vivo.fallos, B.M._vivo.estado, B.M._vivo.error, B.M._vivo.pausaHasta], [2, 'error', 'oops', 0], 'dos fallos: se sigue intentando');
    await B.M.cotizarVivo();
    igual([B.M._vivo.fallos, B.M._vivo.pausaHasta > Date.now()], [3, true], 'al tercero: pausa de 5 min (no se martilla el proxy)');
    assert(/oops/.test(B.reg.nodos['#g_vivo_estado'].textContent) && /pausa/.test(B.reg.nodos['#g_vivo_estado'].textContent), 'la barra dice el error y la pausa');
    // Schwab de respaldo
    const S = armar({ creds: null, sw: { token: 'x' }, schwab: RT({ 'NVDA  260928C00235000': { realtime: true, quote: { bidPrice: 5.9, askPrice: 6.1, lastPrice: 6 } } }) });
    const brS = { ...NV, broker: 'moomoo', clave: 'moomoo|' + K_NV, contratos: 30, prima_fill: 0.3, mark: 0.2, valor_actual: 600, invertido: 900, pnl_usd: -300 };
    S._cart.moomoo = { estado: 'ok', ts: Date.now(), items: [brS] };
    const rs = await S.M.cotizarVivo();
    igual([S.reg.swLecturas[0].path, S.reg.swLecturas[0].query], ['/marketdata/v1/quotes', { symbols: 'NVDA  260928C00235000' }], 'sin E*TRADE: Schwab con el OSI');
    igual([rs.n, S.M._vivo.fuente, brS.mark], [1, 'schwab', 6], 'y la foto de moomoo lleva el mark de Schwab');
    // sin fuente
    const N = armar({ creds: null }); N.reg.nodos['#g_vivo_estado'] = nodo();
    N._cart.moomoo = { estado: 'ok', ts: Date.now(), items: [{ ...NV, broker: 'moomoo', clave: 'moomoo|' + K_NV, contratos: 1 }] };
    igual(await N.M.cotizarVivo(), null, 'sin E*TRADE ni Schwab aquí: no se cotiza');
    assert(/sin cotización en vivo: conecta E\*TRADE o Schwab/.test(N.reg.nodos['#g_vivo_estado'].textContent), 'y se dice qué hacer');
    // sin contratos
    const V = armar(); igual(await V.M.cotizarVivo(), null, 'sin contratos en pantalla: nada que preguntar'); igual(V.reg.lecturas.length, 0, '(ninguna petición)');
  }
  // ════════════════ 10. tickVivo: cotiza cada tic y relee la cartera cada 20 s ════════════════
  {
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6)] } }) });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [{ ...NV, broker: 'etrade', clave: 'etrade|' + K_NV, contratos: 1 }] };
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [1, 1], 'primer tic: cotiza y relee la cartera');
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [2, 1], 'segundo tic (5 s después): cotiza, la cartera espera sus 20 s');
    A.M._vivo.ultimoTickCartera = Date.now() - A.M.VIVO_CARTERA_MS - 1; A.E.cambio = true;
    A.M.tickVivo(); await respirar();
    igual([A.reg.carteras, A.reg.vistas], [2, 1], 'pasados 20 s: relee y, si la ESTRUCTURA cambió, redibuja el Copiloto');
    A.M._vivo.ultimoTickCartera = 0; A.E.modal = true;
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [4, 2], 'con un cuadro abierto (una orden a medias): se cotiza pero no se relee ni se redibuja');
    igual(A.M.VIVO_CARTERA_MS, A.M.CART_TTL_ABIERTO, 'el ritmo de relectura es el TTL de la cartera con el mercado abierto');
    const B = armar({ abierto: false }); B.M.tickVivo(); await respirar();
    igual([B.reg.lecturas.length, B.reg.carteras], [0, 0], 'mercado cerrado: el tic no hace nada (ni cotiza ni relee)');
  }
  // ════════════════ 11. Realtime de la foto del worker ════════════════
  {
    const A = armar();
    A._cart.moomoo = { estado: 'ok', ts: 12345, items: [] };
    A.M.fotoBrokerCambio({ eventType: 'UPDATE', new: { broker: 'etrade', origen: 'dispositivo', clave: 'x' } });
    igual([A.reg.timers.length, A._cart.moomoo.ts], [0, 12345], 'una fila que subió esta misma app (dispositivo) no dispara nada');
    A.M.fotoBrokerCambio({ eventType: 'UPDATE', new: { broker: 'moomoo', origen: 'worker', clave: 'a' } });
    A.M.fotoBrokerCambio({ eventType: 'INSERT', new: { broker: 'moomoo', origen: 'worker', clave: 'b' } });
    igual([A.reg.timers.length, A.reg.limpiados, A._cart.moomoo.ts], [2, 2, 0], 'dos filas seguidas del worker: la foto se marca por releer y se agrupan en UNA relectura (800 ms)');
    igual(A.reg.timers[1].ms, 800, 'espera 800 ms a que el worker termine de escribir');
    A.reg.timers[1].fn(); await respirar();
    igual([A.reg.carteras, A.reg.vistas], [1, 0], 'relee la cartera; sin cambio de estructura solo repinta en sitio');
    A.M.fotoBrokerCambio({ eventType: 'DELETE', old: { broker: 'moomoo', clave: 'a' } });
    igual(A.reg.timers.length, 2, 'un DELETE (solo trae la clave, sin origen) no dispara nada');
  }
  // ════════════════ 12. cifras compartidas y celdas ════════════════
  {
    const { M } = armar();
    const p = { id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 };
    const br = { ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 6, valor_actual: 1200, invertido: 900, pnl_usd: 295, pnl_pct: 32.8 };
    const c = M.cifrasFila(p, br, { libroContratos: 2, fichas: 1 });
    igual([c.mark, c.qty, c.costo, c.brCuadra, c.pnlUsd, c.pnlPct, c.col], [6, 2, 4.5, true, 295, 32.8, 'var(--verde)'], 'el bróker cuadra con la ficha: su neto y su %');
    assert(/neto/.test(c.etiqueta), 'etiqueta «neto»');
    const c2 = M.cifrasFila(p, { ...br, contratos: 3 }, { libroContratos: 2, fichas: 1 });
    igual([c2.brCuadra, c2.pnlUsd, Math.round(c2.pnlPct * 10) / 10], [false, 300, 33.3], 'el bróker tiene ×3: P&L bruto del libro (6 − 4.5) × 2 × 100');
    assert(/del libro/.test(c2.etiqueta), 'etiqueta «del libro»');
    const c3 = M.cifrasFila({ ...p, mark: null }, null, null);
    igual([c3.mark, c3.pnlUsd, c3.pnlPct, c3.col], [null, null, null, 'var(--tx2)'], 'sin mark: sin P&L (no se inventa −100 %)');
    igual(M.celdaMarkHtml(6, 2), '<b>6.00</b><span class="gsub2">vale $1,200.00</span>', 'celda Mark');
    igual(M.celdaMarkHtml(null, 2), '<b>—</b><span class="gsub2">vale —</span>', 'celda Mark sin mark');
    igual(M.celdaMarkHtml(6, 2, 1234.5), '<b>6.00</b><span class="gsub2">vale $1,234.50</span>', 'celda Mark con el valor del bróker');
    igual(M.celdaPnlHtml(295, 32.8, 'var(--verde)', ' X'), '<b style="font-size:15px">+32.8%</b><span class="gsub2" style="color:var(--verde);font-size:11px">+$295.00 X</span>', 'celda P&L');
    igual(M.celdaPnlHtml(null, null, 'var(--tx2)'), '<b style="font-size:15px">—</b>', 'celda P&L vacía');
    igual(M.claveSlug('moomoo|SPY|PUT|662.5|2026-10-02'), 'moomoo_SPY_PUT_662_5_2026_10_02', 'slug de una clave para un id de DOM');
    assert(/en vivo/.test(M.lineaValorBroker({ valor_actual: 340, pnl_usd: 40, pnl_pct: 13.3, mark_fuente: 'vivo' })) && /\+\$40/.test(M.lineaValorBroker({ valor_actual: 340, pnl_usd: 40, pnl_pct: 13.3, mark_fuente: 'vivo' })), 'línea de la tarjeta sin registrar: valor · P&L · «en vivo»');
    assert(/cifras del bróker/.test(M.lineaValorBroker({ valor_actual: 340, pnl_usd: 40 })), '…o «cifras del bróker» cuando el mark es suyo');
  }
  // ════════════════ 13. cadencias de la cartera ════════════════
  {
    const { M } = armar();
    const ahora = Date.now();
    igual([M.CART_TTL_ABIERTO, M.CART_MIN_MS, M.VIVO_MS, M.VIVO_FRESCA_MS], [20000, 15000, 5000, 15000], 'cartera cada 20 s en sesión (piso 15 s), cotización cada 5 s, fresca 15 s');
    igual(M.carteraToca({ ts: ahora - 10000, estado: 'ok' }, true, false), false, 'a los 10 s no se relee (piso de 15 s)');
    igual(M.carteraToca({ ts: ahora - 16000, estado: 'ok' }, true, false), false, 'a los 16 s tampoco (TTL 20 s)');
    igual(M.carteraToca({ ts: ahora - 21000, estado: 'ok' }, true, false), true, 'a los 21 s sí');
    igual(M.carteraToca({ ts: ahora - 21000, estado: 'ok' }, false, false), false, 'con el mercado cerrado sigue siendo cada 15 min');
    igual(M.carteraToca({ ts: 0 }, true, false), true, 'sin ts (la foto del worker marcada por Realtime): toca ya');
  }
  // ════════════════ 14. el fuente: canal propio, timer y versión ════════════════
  {
    assert(/sb\.channel\('mesa2-broker'\)\s*\.on\('postgres_changes', \{ event: '\*', schema: 'public', table: 'posiciones_broker' \}, fotoBrokerCambio\)/.test(FUENTE), 'posiciones_broker se suscribe en su PROPIO canal (si 0019 no está aplicada, el resto de Realtime no se cae)');
    assert(/window\._mzTimerVivo = setInterval\(\(\) => \{ try \{ tickVivo\(\); \} catch \(_\) \{\} \}, VIVO_MS\)/.test(FUENTE), 'el timer en vivo arranca con la sesión');
    assert(/try \{ aplicarVivo\(\); \} catch \(_\) \{\}\s*\/\/ v56/.test(FUENTE) && FUENTE.indexOf('try { aplicarVivo(); }') < FUENTE.indexOf('try { await fotoDispositivoSincronizar(abierto); }'), 'tras cada relectura de la cartera la cotización fresca vuelve a mandar (y antes de subir la foto)');
    assert(/id="g_mark_\$\{id\}"/.test(FUENTE) && /id="g_pnl_\$\{id\}"/.test(FUENTE) && /id="g_bmark_\$\{claveSlug\(br\.clave\)\}"/.test(FUENTE) && /id="g_vivo_\$\{Number\(p\.id\)\}"/.test(FUENTE) && /id="g_bvivo_\$\{claveSlug\(br\.clave\)\}"/.test(FUENTE), 'la tabla y las tarjetas llevan los ids que repinta el ritmo en vivo');
    assert(/id="g_vivo_estado"/.test(FUENTE), 'la barra lleva la línea de estado del ritmo en vivo');
    assert(/setTimeout\(\(\) => \{ try \{ tickVivo\(\); \} catch \(_\) \{\} \}, 300\)/.test(FUENTE), 'al volver del fondo se cotiza enseguida');
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
