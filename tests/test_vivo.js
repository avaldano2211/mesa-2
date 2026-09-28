#!/usr/bin/env node
/* Pruebas de la v56 · EN VIVO (Andrés, 2026-09-28: «los valores no se están actualizando en
   tiempo real»): cotización cada 5 s por E*TRADE (o Schwab) SOLO en la sesión regular, solo
   REALTIME se aplica (DELAYED y CLOSING/EH_* no), la cotización fresca (por contrato) manda sobre
   el lastTrade de la cartera, el P&L vivo solo cuando el bróker dio su neto, repintado EN SITIO de
   Mark / P&L / Salta en / barra sin tocar #vista, cartera cada 20 s (60 s en pre/post), foto del
   worker por Realtime con marca `releer`, la foto del dispositivo y la caché con las cifras DEL
   BRÓKER, etiquetas «en vivo» solo con cotización fresca. Incluye los arreglos de las tres
   revisiones adversariales del 2026-09-28. Funciones REALES del fuente (casa_pruebas.js).
   Uso: node test_vivo.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_vivo.js');
const { FUENTE, assert, igual, cerca, construir, esc, usd, colUtil, BROKER_NOMBRE, nodo, respirar, haceCuanto } = C;

const PUROS = ['claveContrato', 'claveCartera', 'itemsCartera', 'simboloOpcionEtrade', 'contratosVivo', 'markDeCotizacion',
  'parsearCotizacionesEtrade', 'parsearCotizacionesSchwab', 'desOsi', 'osiDe', 'aplicarCotizacion', 'claveSlug', 'celdaMarkHtml',
  'celdaPnlHtml', 'lineaValorBroker', 'cifrasFila', 'markGestor', 'brokerCuadraConFicha', 'fmtPrima', 'totalesGestor', 'carteraToca',
  'etError', 'swMensajeError', 'haceCuantoSeg', 'esVivo', 'itemSinVivo', 'fotoFilaDe', 'casarCarteraLibro', 'brokersLeidos',
  'carteraLeidaAt', 'gananciaTotalesHtml', 'comisionesTotalesHtml', 'sublineaTotalesHtml'];
const VIVOS = ['aplicarVivoLista', 'aplicarVivo', 'vivoToca', 'vivoFuente', 'cotizarVivo', 'tickVivo', 'fotoBrokerCambio', 'pintarVivoEnSitio',
  'textoVivoEstado', 'pintarVivoEstado', 'armarFilasGestor', 'carteraParaCache'];
const CONSTS = ['VIVO_MS', 'VIVO_CARTERA_MS', 'VIVO_FRESCA_MS', 'VIVO_MAX_SIMBOLOS', 'VIVO_FALLOS_PAUSA', 'ETIQUETA_DEL_BROKER', '_vivo',
  'CART_BROKERS', 'BROKERS_WORKER', 'CART_TTL_ABIERTO', 'CART_MIN_MS', 'CART_MIN_FORZAR_MS', 'CART_TTL_EXTENDIDO', 'CART_FRESCO_MS',
  'num2', 'dineroD', 'enCopilotoAhora'];

// Un módulo con TODO lo de EN VIVO y un mundo de juguete controlable (E = escenario).
function armar(E) {
  E = Object.assign({ abierto: true, creds: { token: 't', token_secret: 's' }, sw: null, hash: '#/copiloto', visible: 'visible', modal: false, cambio: false }, E || {});
  const reg = { lecturas: [], swLecturas: [], vistas: 0, carteras: 0, saltas: [], timers: [], limpiados: 0, nodos: {} };
  const $ = (s) => reg.nodos[s] || null;
  const _gestor = { filas: [], pend: {}, sinColumnas: false };
  const _cart = { etrade: null, schwab: null, tasty: null, moomoo: null, enVuelo: {}, firma: '', releer: {} };
  const M = construir(PUROS.concat(VIVOS), {
    $, esc, usd, colUtil, BROKER_NOMBRE, haceCuanto, _gestor, _cart, hoyNY: () => '2026-09-28',
    location: { hash: E.hash }, document: { get visibilityState() { return E.visible; }, querySelector: () => (E.modal ? {} : null) },
    sesionActiva: E.sesion === undefined ? { user: { id: 'u' } } : E.sesion, _hbUltimo: null,
    sesionNY: () => (E.abierto === true ? 'regular' : E.abierto === 'extendido' ? 'extendida' : 'cerrado'),
    etCreds: () => E.creds, etDiaVencido: () => !!E.etVencido, swCreds: () => E.sw, swVencido: () => !!E.swVencido,
    etRead: async (cr, p, query) => { reg.lecturas.push({ cr, path: p, query }); return typeof E.etrade === 'function' ? E.etrade(p, query) : E.etrade; },
    swRead: async (p, query) => { reg.swLecturas.push({ path: p, query }); return typeof E.schwab === 'function' ? E.schwab(p, query) : E.schwab; },
    pintarSaltaEnSitio: (id) => reg.saltas.push(id), pnlVivo: (p) => 'PV ' + p.mark, lineasCartera: (p, br) => 'LC ' + (br ? br.mark : '-'),
    cargarCartera: async () => { reg.carteras++; return E.cambio; }, vistaCopiloto: () => { reg.vistas++; },
    setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; }, clearTimeout: () => { reg.limpiados++; },
  }, { consts: CONSTS, extras: ['VIVO_PAUSA_MS', 'CART_TTL_CERRADO', 'CART_TTL_VETADA', 'ETIQUETA_EN_VIVO'] });
  return { M, reg, E, _gestor, _cart };
}
const RT = (s, extra) => Object.assign({ status: 200 }, extra || {}, { data: s });
const q = (symbol, dir, y, m, d, strike, bid, ask, last, estado) => ({ quoteStatus: estado || 'REALTIME',
  Intraday: { bid, ask, lastTrade: last }, Product: { symbol, securityType: 'OPTN', callPut: dir, expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: strike } });
const NV = { symbol: 'NVDA', direccion: 'CALL', strike: 235, expiracion: '2026-09-28' };
const SP = { symbol: 'SPY', direccion: 'PUT', strike: 662.5, expiracion: '2026-10-02' };
const K_NV = 'NVDA|CALL|235|2026-09-28', K_SP = 'SPY|PUT|662.5|2026-10-02';
// ítem de cartera tal como lo dejan los normalizadores: invertido = valor − neto (lleva la comisión dentro)
const itemBroker = (base, extra) => Object.assign({ ...base, clave: base.broker + '|' + [base.symbol, base.direccion, base.strike, base.expiracion].join('|'),
  origen_invertido: 'broker', origen_pnl: 'broker', origen_valor: 'broker', origen_mark: 'broker' }, extra || {});

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
    igual(M.markDeCotizacion(0, 0.01, 0.05), 0.005, 'bid 0 y ask 0.01 (un 0DTE muerto): ask/2, no el último cruce de hace horas');
    igual(M.markDeCotizacion(0, 0, 0), null, 'sin nada: null (no se inventa 0)');
    igual(M.markDeCotizacion(0.33333, 0.33334, 0), 0.3333, 'redondeo a 4 decimales');
  }
  // ════════════════ 3. respuesta de E*TRADE ════════════════
  {
    const { M } = armar();
    const pedidos = [{ clave: K_NV }, { clave: K_SP }];
    const resp = RT({ QuoteResponse: { QuoteData: [q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.1, 3.3, 3.25), q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34)],
      Messages: { Message: [{ description: 'Invalid symbol', type: 'ERROR' }] } } });
    const r = M.parsearCotizacionesEtrade(resp, pedidos);
    igual([r.n, r.estado], [2, 'REALTIME'], 'dos cotizaciones REALTIME');
    igual(r.por[K_NV], { mark: 0.33, bid: 0.31, ask: 0.35, last: 0.34, estado: 'REALTIME', at: null }, 'NVDA casado por contrato: mark = medio de 0.31/0.35');
    igual(r.por[K_SP].mark, 3.2, 'SPY 662.5 PUT casado aunque llegó primero');
    // detailFlag OPTIONS: bloque Option con osiKey (la clave más fiable) y dateTimeUTC (la hora DEL DATO)
    const rO = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', dateTimeUTC: 1790000000,
      Option: { bid: 1, ask: 1.2, lastTrade: 1.1, osiKey: 'NVDA--260928C00235000' }, Product: { symbol: 'NVDA', securityType: 'OPTN' } }] } }), pedidos);
    igual([Object.keys(rO.por), rO.por[K_NV].at], [[K_NV], 1790000000000], 'bloque Option: se casa por osiKey aunque Product venga sin el contrato; at = dateTimeUTC en ms');
    const r2 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', All: { bid: 1, ask: 1.2, lastTrade: 1.1 },
      Product: { symbol: 'nvda', callPut: 'Call', expiryYear: 26, expiryMonth: 9, expiryDay: 28, strikePrice: '235' } }] } }), pedidos);
    igual(Object.keys(r2.por), [K_NV], 'año a 2 dígitos, símbolo en minúsculas, strike como texto y bloque All: se casa igual');
    const r3 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2 } }, { quoteStatus: 'REALTIME', Intraday: { lastTrade: 2 } }] } }), pedidos);
    igual([r3.por[K_NV].mark, r3.por[K_SP].mark], [1.1, 2], 'sin Product pero con el largo de lo pedido: se casa por posición');
    const r4 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2 } }] } }), pedidos);
    igual(r4.n, 0, 'sin Product y con OTRO largo: no se adivina (mejor sin mark que con el mark de otro contrato)');
    const r5 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.1, 3.3, 3.25, 'DELAYED'), q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34)] } }), pedidos);
    igual(r5.estado, 'DELAYED', 'con UNA cotización con retraso el lote entero es «con retraso»');
    const r6 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.1, 3.3, 3.25, 'CLOSING'), q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34)] } }), pedidos);
    igual([r6.estado, r6.n], ['CLOSING', 2], 'con una CLOSING (el cierre, no un precio de ahora) el lote no es REALTIME: se dice cuál');
    igual(M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 0.31, 0.35, 0.34, 'INDICATIVE_REALTIME')] } }), pedidos).estado, 'REALTIME', 'INDICATIVE_REALTIME cuenta como en vivo');
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
    // E*TRADE: valor 1000, neto 95 → invertido 905 (la comisión de 5 va DENTRO del invertido)
    const it = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, mark_fuente: null, valor_actual: 1000, invertido: 905, pnl_usd: 95, pnl_pct: 10.5, comisiones: 5 });
    assert(M.aplicarCotizacion(it, { mark: 6, bid: 5.9, ask: 6.1 }, 1700000000000, 'cartera'), 'aplica');
    igual([it.mark, it.valor_actual, it.pnl_usd, it.pnl_pct, it.mark_fuente, it.mark_at, it.vivo_at, it.origen_pnl], [6, 1200, 295, 32.6, 'vivo', '2023-11-14T22:13:20.000Z', 1700000000000, 'vivo'],
      'cartera con neto del bróker: valor = mark × qty × 100, P&L = valor − invertido (sigue siendo neto: el invertido ya lleva la comisión), % sobre invertido');
    igual(it._broker, { mark: 5, mark_fuente: null, mark_at: undefined, valor_actual: 1000, pnl_usd: 95, pnl_pct: 10.5, origen_valor: 'broker', origen_pnl: 'broker', origen_mark: 'broker' }, 'las cifras del bróker se guardan aparte (para la foto y la caché)');
    M.aplicarCotizacion(it, { mark: 5.5, at: 1700000005000 }, 1700000006000, 'cartera');
    igual([it._broker.mark, it.mark_at, it.vivo_at], [5, '2023-11-14T22:13:25.000Z', 1700000006000], 'la segunda cotización no pisa las cifras del bróker; mark_at es la hora DEL DATO (at) y vivo_at la de recepción');
    const sinNeto = itemBroker({ ...NV, broker: 'moomoo', contratos: 30, prima_fill: 0.3, mark: 0.2, valor_actual: 600, invertido: 900, pnl_usd: null, pnl_pct: null }, { origen_invertido: 'calculado', origen_pnl: 'sin' });
    M.aplicarCotizacion(sinNeto, { mark: 0.33 }, Date.now(), 'cartera');
    igual([sinNeto.valor_actual, sinNeto.pnl_usd, sinNeto.pnl_pct, sinNeto.origen_pnl], [990, null, null, 'sin'], 'sin neto del bróker: el valor sí se recalcula, el P&L se queda null (la celda cae al bruto del libro, sin «neto»)');
    const p = { id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, mfe: 5.2 };
    M.aplicarCotizacion(p, { mark: 6 }, Date.now(), 'libro');
    igual([p.mark, p.mark_fuente, p.valor_actual, p.pnl_usd, p.mfe, p._broker], [6, 'vivo', undefined, undefined, 5.2, undefined], 'libro: solo el mark (el mfe lo persiste el worker; nivelGestor ya usa max(mfe, mark))');
    igual(M.aplicarCotizacion(p, { mark: 0 }, Date.now(), 'libro'), false, 'un mark 0 no se aplica');
    igual(p.mark, 6, '…y el anterior se conserva');
    // esVivo / itemSinVivo
    igual([M.esVivo(it), M.esVivo({ ...it, vivo_at: Date.now() - 20000 }), M.esVivo({ mark_fuente: 'vivo' })], [false, false, false], 'esVivo: solo con vivo_at fresco (mark_fuente «vivo» también lo escribe el worker en fotos viejas)');
    it.vivo_at = Date.now(); igual(M.esVivo(it), true, 'con vivo_at de ahora: en vivo');
    const limpio = M.itemSinVivo(it);
    igual([limpio.mark, limpio.valor_actual, limpio.pnl_usd, limpio.pnl_pct, limpio.vivo_at, limpio.bid, limpio._broker, limpio.origen_pnl], [5, 1000, 95, 10.5, undefined, undefined, undefined, 'broker'], 'itemSinVivo: las cifras del bróker, sin rastro de la cotización (para la caché de mañana)');
    igual(M.itemSinVivo(sinNeto) === sinNeto ? 'mismo' : 'copia', 'copia', 'un ítem tocado por la cotización se devuelve limpio (copia)');
  }
  // ════════════════ 6. aplicarVivo: fresca POR CONTRATO manda, vieja no ════════════════
  {
    const { M, _gestor, _cart } = armar();
    _cart.etrade = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 905, pnl_usd: 95 })] };
    _cart.moomoo = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...SP, broker: 'moomoo', contratos: 1, prima_fill: 3, mark: 3.1, valor_actual: 310, invertido: 300, pnl_usd: 10 })] };
    _cart.schwab = { estado: 'sesion', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'schwab', contratos: 1, mark: 1 })] };
    _gestor.filas = [{ id: 7, ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 }];
    const ahora = Date.now();
    M._vivo.por = { [K_NV]: { mark: 6, ts: ahora - 3000 }, [K_SP]: { mark: 3.4, ts: ahora - 20000 } };
    igual(M.aplicarVivo(), 2, 'aplica NVDA (de hace 3 s) a la cartera de E*TRADE y a la ficha; SPY (de hace 20 s) ya no manda; el bróker sin sesión no');
    igual([_cart.etrade.items[0].mark, _cart.etrade.items[0].pnl_usd, _cart.moomoo.items[0].mark, _gestor.filas[0].mark, _cart.schwab.items[0].mark], [6, 295, 3.1, 6, 1], 'marks y P&L nuevos solo donde la cotización es fresca');
    M._vivo.por[K_SP].ts = ahora;
    igual(M.aplicarVivo(), 3, 'con SPY fresco: los tres');
    igual(_cart.moomoo.items[0].pnl_usd, 40, 'moomoo: 340 − 300');
  }
  // ════════════════ 7. vivoToca / vivoFuente ════════════════
  {
    igual(armar().M.vivoToca(), true, 'toca: sesión, Copiloto, ventana visible, sesión regular');
    igual(armar({ hash: '#/cuentas' }).M.vivoToca(), false, 'en otra pestaña no se cotiza');
    igual(armar({ visible: 'hidden' }).M.vivoToca(), false, 'con la app en el fondo no se cotiza');
    igual(armar({ abierto: false }).M.vivoToca(), false, 'con el mercado cerrado no se cotiza (los marks son del cierre)');
    igual(armar({ abierto: 'extendido' }).M.vivoToca(), false, 'en pre/post tampoco: el bróker devuelve el cierre (CLOSING/EH_*), no un precio de ahora');
    igual(armar({ sesion: null }).M.vivoToca(), false, 'sin sesión no');
    igual(armar().M.vivoFuente().fuente, 'etrade', 'con E*TRADE en este equipo: E*TRADE');
    igual(armar({ creds: null, sw: { token: 'x' } }).M.vivoFuente().fuente, 'schwab', 'sin E*TRADE pero con Schwab: Schwab');
    igual(armar({ etVencido: true, sw: { token: 'x' } }).M.vivoFuente().fuente, 'schwab', 'E*TRADE vencido de día: Schwab');
    const a = armar({ sw: { token: 'x' } }); a._cart.etrade = { estado: 'sesion' };
    igual(a.M.vivoFuente().fuente, 'schwab', 'E*TRADE con la sesión caída en la cartera: Schwab');
    const v = armar({ sw: { token: 'x' } }); v.M._vivo.vetoEtrade = true;
    igual(v.M.vivoFuente().fuente, 'schwab', 'E*TRADE vetado (el proxy no permite la ruta): Schwab');
    igual(armar({ creds: null }).M.vivoFuente().fuente, null, 'sin ninguno: nadie');
  }
  // ════════════════ 8. cotizarVivo por E*TRADE: la petición, el resultado y el repintado ════════════════
  {
    const ids = ['#g_mark_7', '#g_pnl_7', '#g_vivo_7', '#g_bl_7', '#g_sum_val', '#g_sum_dif', '#g_sum_com', '#g_sum_sub', '#g_vivo_estado',
      '#g_bmark_moomoo_SPY_PUT_662_5_2026_10_02', '#g_bpnl_moomoo_SPY_PUT_662_5_2026_10_02', '#g_bvivo_moomoo_SPY_PUT_662_5_2026_10_02'];
    const nodos = {}; ids.forEach(i => { nodos[i] = nodo(); });
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), q('SPY', 'PUT', 2026, 10, 2, 662.5, 3.3, 3.5, 3.4)] } }) });
    Object.assign(A.reg.nodos, nodos);
    const br = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 905, pnl_usd: 95, pnl_pct: 10.5, comisiones: 5 });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [br] };
    A._cart.moomoo = { estado: 'ok', ts: Date.now(), foto_at: new Date().toISOString(), items: [itemBroker({ ...SP, broker: 'moomoo', contratos: 1, prima_fill: 3, mark: 3.1, valor_actual: 310, invertido: 300, pnl_usd: 10, pnl_pct: 3.3 })] };
    A._gestor.filas = [{ id: 7, ...NV, broker: 'etrade', estado: 'abierta', contratos: 2, prima_fill: 4.5, mark: 5 }];
    const r = await A.M.cotizarVivo();
    igual(A.reg.lecturas.length, 1, 'UNA petición para todos los contratos');
    igual(A.reg.lecturas[0].path, '/v1/market/quote/NVDA:2026:9:28:CALL:235,SPY:2026:10:2:PUT:662.5.json', 'la ruta de E*TRADE con los símbolos de opción separados por coma (lista blanca /v1/market del proxy)');
    igual(A.reg.lecturas[0].query, { detailFlag: 'OPTIONS' }, 'detailFlag OPTIONS (bloque Option: bid, ask, lastTrade, osiKey)');
    igual([r.n, A.M._vivo.fuente, A.M._vivo.estado, A.M._vivo.n, A.M._vivo.fallos], [2, 'etrade', 'REALTIME', 2, 0], 'dos cotizaciones aplicadas');
    igual([br.mark, br.valor_actual, br.pnl_usd, br.pnl_pct], [6, 1200, 295, 32.6], 'la cartera de E*TRADE lleva el mark vivo y su P&L neto recalculado (1200 − 905)');
    igual(A._gestor.filas[0].mark, 6, 'la ficha del libro también');
    assert(/<b>6\.00<\/b>/.test(nodos['#g_mark_7'].innerHTML) && /vale \$1,200\.00/.test(nodos['#g_mark_7'].innerHTML), 'celda Mark repintada en sitio: 6.00 · vale $1,200.00');
    assert(/\+32\.6%/.test(nodos['#g_pnl_7'].innerHTML) && /\+\$295\.00/.test(nodos['#g_pnl_7'].innerHTML) && /neto · en vivo/.test(nodos['#g_pnl_7'].innerHTML), 'celda P&L repintada: +32.6% · +$295.00 «neto · en vivo» (el bróker cuadra con la ficha) → ' + nodos['#g_pnl_7'].innerHTML);
    igual(nodos['#g_pnl_7'].style.color, 'var(--verde)', 'color del P&L');
    igual(nodos['#g_vivo_7'].innerHTML, 'PV 6', 'la línea de P&L vivo (tarjeta/detalle) también');
    igual(nodos['#g_bl_7'].innerHTML, 'LC 6', 'y la línea «E*TRADE confirma… (en vivo)» del detalle');
    igual(A.reg.saltas, [7], '«Salta en» se recalcula en sitio con el mark nuevo');
    assert(/<b>3\.40<\/b>/.test(nodos['#g_bmark_moomoo_SPY_PUT_662_5_2026_10_02'].innerHTML), 'la fila SIN REGISTRAR de moomoo también (mark 3.40 por E*TRADE)');
    assert(/en vivo/.test(nodos['#g_bpnl_moomoo_SPY_PUT_662_5_2026_10_02'].innerHTML) && /\+\$40\.00/.test(nodos['#g_bpnl_moomoo_SPY_PUT_662_5_2026_10_02'].innerHTML), 'su P&L +$40.00 «en vivo» (ya no «del bróker»)');
    assert(/en vivo/.test(nodos['#g_bvivo_moomoo_SPY_PUT_662_5_2026_10_02'].innerHTML), 'y la línea de la tarjeta sin registrar dice «en vivo»');
    igual(nodos['#g_sum_val'].textContent, '$1,540.00', 'barra VALOR AHORA = 1200 + 340');
    // inv de la barra: la ficha va con su costo (900) y la sin registrar con el invertido del bróker (300) → 1200; comisiones = (1540 − 1200) − 335 = 5 (cuadra con br.comisiones) → % sobre 1205
    assert(/\+\$335\.00/.test(nodos['#g_sum_dif'].innerHTML) && /27\.8%/.test(nodos['#g_sum_dif'].innerHTML), 'barra GANANCIA = 295 + 40 = +$335.00 (27.8% sobre 1200 + 5 de comisiones: la misma base que la celda) → ' + nodos['#g_sum_dif'].innerHTML);
    assert(/se llevó \$5\.00 en comisiones/.test(nodos['#g_sum_com'].innerHTML), 'la sublínea de comisiones se repinta en sitio: ' + nodos['#g_sum_com'].innerHTML);
    assert(/neto del bróker en 2 de 2/.test(nodos['#g_sum_sub'].innerHTML), 'y la sublínea de la barra también: ' + nodos['#g_sum_sub'].innerHTML);
    assert(/^EN VIVO · E\*TRADE cada 5 s · 2 contrato\(s\) · hace \d+ s$/.test(nodos['#g_vivo_estado'].textContent), 'la barra dice EN VIVO · E*TRADE cada 5 s · hace N s → ' + nodos['#g_vivo_estado'].textContent);
    igual(A.reg.vistas, 0, 'nada se redibujó entero (#vista intacto: el foco de un parámetro no se pierde)');
    A.M._vivo.enVuelo = true; igual(await A.M.cotizarVivo(), null, 'con una cotización en vuelo no se lanza otra'); A.M._vivo.enVuelo = false;
    // el redibujo entero trae fichas NUEVAS de la base (mark del worker): armarFilasGestor les aplica la cotización fresca antes de pintar
    const nuevas = [{ id: 7, ...NV, broker: 'etrade', estado: 'abierta', contratos: 2, prima_fill: 4.5, mark: 5 }];
    const F = A.M.armarFilasGestor(nuevas, A._cart);
    igual([nuevas[0].mark, F.filas[0].mark, F.filas[0].br === br], [6, 6, true], 'tras un redibujo la ficha nueva ya lleva el mark vivo (no vuelve a 5 hasta el próximo tic) y va casada con la cartera de ahora');
    // la barra envejece con honestidad
    A.M._vivo.ts = Date.now() - 40000; A.M.pintarVivoEstado();
    assert(/^última cotización hace 40 s: ya no manda/.test(nodos['#g_vivo_estado'].textContent), 'con la última cotización de hace 40 s la barra deja de decir EN VIVO → ' + nodos['#g_vivo_estado'].textContent);
    A.E.abierto = 'extendido'; A.M.pintarVivoEstado();
    assert(/fuera de la sesión regular/.test(nodos['#g_vivo_estado'].textContent), 'en pre/post la barra dice que la cotización en vivo corre de 9:30 a 16:00');
  }
  // ════════════════ 9. con retraso o cierre NO se usan; errores seguidos → pausa; veto del proxy → Schwab ════════════════
  {
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6, 'DELAYED')] } }) });
    A.reg.nodos['#g_vivo_estado'] = nodo();
    const br = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [br] };
    await A.M.cotizarVivo();
    igual([br.mark, A.M._vivo.estado, A.M._vivo.n, A.M._vivo.pausaHasta > Date.now()], [5, 'DELAYED', 0, true], 'DELAYED: el mark del bróker se queda, estado con retraso y 5 min de pausa');
    assert(/CON RETRASO/.test(A.reg.nodos['#g_vivo_estado'].textContent), 'y la barra lo dice: ' + A.reg.nodos['#g_vivo_estado'].textContent);
    igual(await A.M.cotizarVivo(), null, 'en pausa no se pregunta');
    igual(A.reg.lecturas.length, 1, '(ninguna lectura nueva)');
    // CLOSING (16:00 en punto, o EH_*): es el cierre, no se aplica, 1 min de pausa
    const Cl = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6, 'CLOSING')] } }) });
    Cl.reg.nodos['#g_vivo_estado'] = nodo();
    const brC = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 });
    Cl._cart.etrade = { estado: 'ok', ts: Date.now(), items: [brC] };
    await Cl.M.cotizarVivo();
    const pausaC = Cl.M._vivo.pausaHasta - Date.now();
    igual([brC.mark, brC.mark_fuente, Cl.M._vivo.estado, Cl.M._vivo.detalle, pausaC > 50000 && pausaC <= 60000], [5, undefined, 'no_vivo', 'CLOSING', true], 'CLOSING: no se aplica, estado «no_vivo» con el detalle y ~1 min de pausa');
    assert(/devuelve «CLOSING»/.test(Cl.reg.nodos['#g_vivo_estado'].textContent), 'la barra dice que E*TRADE devuelve el cierre: ' + Cl.reg.nodos['#g_vivo_estado'].textContent);
    // tres errores seguidos
    const B = armar({ etrade: { status: 500, data: { Error: { message: 'oops' } } } });
    B.reg.nodos['#g_vivo_estado'] = nodo();
    B._cart.etrade = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'etrade', contratos: 1 })] };
    await B.M.cotizarVivo(); await B.M.cotizarVivo();
    igual([B.M._vivo.fallos, B.M._vivo.estado, B.M._vivo.error, B.M._vivo.pausaHasta, B.M._vivo.vetoEtrade], [2, 'error', 'oops', 0, false], 'dos fallos DEL BRÓKER: se sigue intentando, sin veto');
    await B.M.cotizarVivo();
    igual([B.M._vivo.fallos, B.M._vivo.pausaHasta > Date.now()], [3, true], 'al tercero: pausa de 5 min (no se martilla el proxy)');
    assert(/oops/.test(B.reg.nodos['#g_vivo_estado'].textContent) && /pausa/.test(B.reg.nodos['#g_vivo_estado'].textContent), 'la barra dice el error y la pausa');
    // el PROXY no permite la ruta (403 sin Error del bróker): veto y Schwab al siguiente tic
    const P = armar({ sw: { token: 'x' }, etrade: { status: 403, data: { error: 'ruta no permitida (solo lectura de cuentas)' } },
      schwab: RT({ 'NVDA  260928C00235000': { realtime: true, quote: { bidPrice: 5.9, askPrice: 6.1, lastPrice: 6 } } }) });
    const brP = itemBroker({ ...NV, broker: 'etrade', contratos: 1, prima_fill: 4.5, mark: 5, valor_actual: 500, invertido: 455, pnl_usd: 45 });
    P._cart.etrade = { estado: 'ok', ts: Date.now(), items: [brP] };
    await P.M.cotizarVivo();
    igual([P.M._vivo.vetoEtrade, P.M._vivo.fallos, P.M._vivo.pausaHasta], [true, 0, 0], '403 del proxy: E*TRADE vetado para la sesión, sin contar como fallo ni dormir');
    assert(/se usa Schwab/.test(P.M._vivo.error), 'y se dice que se pasa a Schwab');
    const rP = await P.M.cotizarVivo();
    igual([rP.n, P.M._vivo.fuente, brP.mark, P.reg.swLecturas.length, P.reg.lecturas.length], [1, 'schwab', 6, 1, 1], 'el siguiente tic cotiza por Schwab (sin volver a pegar a E*TRADE)');
    // Schwab de respaldo sin E*TRADE
    const S = armar({ creds: null, sw: { token: 'x' }, schwab: RT({ 'NVDA  260928C00235000': { realtime: true, quote: { bidPrice: 5.9, askPrice: 6.1, lastPrice: 6 } } }) });
    const brS = itemBroker({ ...NV, broker: 'moomoo', contratos: 30, prima_fill: 0.3, mark: 0.2, valor_actual: 600, invertido: 900, pnl_usd: -300 });
    S._cart.moomoo = { estado: 'ok', ts: Date.now(), items: [brS] };
    const rs = await S.M.cotizarVivo();
    igual([S.reg.swLecturas[0].path, S.reg.swLecturas[0].query], ['/marketdata/v1/quotes', { symbols: 'NVDA  260928C00235000' }], 'sin E*TRADE: Schwab con el OSI');
    igual([rs.n, S.M._vivo.fuente, brS.mark], [1, 'schwab', 6], 'y la foto de moomoo lleva el mark de Schwab');
    const N = armar({ creds: null }); N.reg.nodos['#g_vivo_estado'] = nodo();
    N._cart.moomoo = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'moomoo', contratos: 1 })] };
    igual(await N.M.cotizarVivo(), null, 'sin E*TRADE ni Schwab aquí: no se cotiza');
    assert(/sin cotización en vivo: conecta E\*TRADE o Schwab/.test(N.reg.nodos['#g_vivo_estado'].textContent), 'y se dice qué hacer');
    const V = armar(); igual(await V.M.cotizarVivo(), null, 'sin contratos en pantalla: nada que preguntar'); igual(V.reg.lecturas.length, 0, '(ninguna petición)');
  }
  // ════════════════ 10. tickVivo: cotiza cada tic, relee la cartera cada 20 s (o ya, si Realtime lo pidió) ════════════════
  {
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6)] } }) });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'etrade', contratos: 1 })] };
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [1, 1], 'primer tic: cotiza y relee la cartera');
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [2, 1], 'segundo tic (5 s después): cotiza, la cartera espera sus 20 s');
    A._cart.releer.moomoo = true; A.M.tickVivo(); await respirar();
    igual(A.reg.carteras, 2, 'con la marca «releer» de Realtime la cartera se relee sin esperar los 20 s');
    A._cart.releer.moomoo = false;
    A.M._vivo.ultimoTickCartera = Date.now() - A.M.VIVO_CARTERA_MS - 1; A.E.cambio = true;
    A.M.tickVivo(); await respirar();
    igual([A.reg.carteras, A.reg.vistas], [3, 1], 'pasados 20 s: relee y, si la ESTRUCTURA cambió, redibuja el Copiloto');
    A.M._vivo.ultimoTickCartera = 0; A.E.modal = true;
    A.M.tickVivo(); await respirar();
    igual([A.reg.lecturas.length, A.reg.carteras], [5, 3], 'con un cuadro abierto (una orden a medias): se cotiza pero no se relee ni se redibuja');
    igual(A.M.VIVO_CARTERA_MS, A.M.CART_TTL_ABIERTO, 'el ritmo de relectura es el TTL de la cartera con el mercado abierto');
    const B = armar({ abierto: false }); B.reg.nodos['#g_vivo_estado'] = nodo(); B.M.tickVivo(); await respirar();
    igual([B.reg.lecturas.length, B.reg.carteras], [0, 0], 'mercado cerrado: el tic no hace nada (ni cotiza ni relee)');
    assert(/fuera de la sesión regular/.test(B.reg.nodos['#g_vivo_estado'].textContent), '…pero la barra se repinta (no se queda en «EN VIVO»)');
  }
  // ════════════════ 11. Realtime de la foto del worker ════════════════
  {
    const A = armar();
    A._cart.moomoo = { estado: 'ok', ts: 12345, items: [] };
    A.M.fotoBrokerCambio({ eventType: 'UPDATE', new: { broker: 'etrade', origen: 'dispositivo', clave: 'x' } });
    igual([A.reg.timers.length, A._cart.releer.etrade], [0, undefined], 'una fila que subió esta misma app (dispositivo) no dispara nada');
    A.M.fotoBrokerCambio({ eventType: 'UPDATE', new: { broker: 'moomoo', origen: 'worker', clave: 'a' } });
    A.M.fotoBrokerCambio({ eventType: 'INSERT', new: { broker: 'moomoo', origen: 'worker', clave: 'b' } });
    igual([A.reg.timers.length, A.reg.limpiados, A._cart.releer.moomoo, A._cart.moomoo.ts], [2, 2, true, 12345], 'dos filas seguidas del worker: la foto queda MARCADA para releer (sin tocar el objeto, que una lectura en vuelo podría reemplazar) y se agrupan en UNA relectura (800 ms)');
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
    const br = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 6, valor_actual: 1200, invertido: 905, pnl_usd: 295, pnl_pct: 30 });
    const c = M.cifrasFila(p, br, { libroContratos: 2, fichas: 1 });
    igual([c.mark, c.qty, c.costo, c.brCuadra, c.pnlUsd, Math.round(c.pnlPct * 10) / 10, c.col], [6, 2, 4.5, true, 295, 32.6, 'var(--verde)'], 'el bróker cuadra con la ficha: su neto y el % neto/invertido (nunca su totalGainPct: no salta de base al vivir o envejecer la cotización)');
    assert(/>neto</.test(c.etiqueta), 'etiqueta «neto» (cifras del bróker)');
    assert(/neto · en vivo/.test(M.cifrasFila(p, { ...br, vivo_at: Date.now() }, { libroContratos: 2, fichas: 1 }).etiqueta), 'con cotización fresca: «neto · en vivo»');
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
    const lv = M.lineaValorBroker({ valor_actual: 340, pnl_usd: 40, pnl_pct: 13.3, vivo_at: Date.now() });
    assert(/en vivo/.test(lv) && /\+\$40/.test(lv), 'línea de la tarjeta sin registrar: valor · P&L · «en vivo» con cotización fresca');
    assert(/cifras del bróker/.test(M.lineaValorBroker({ valor_actual: 340, pnl_usd: 40, mark_fuente: 'vivo' })), '…y «cifras del bróker» con una foto del worker (aunque su mark_fuente diga «vivo»)');
    // la barra: % sobre inv + comisiones cuando cuadran (la misma base que la celda)
    const t = M.totalesGestor([{ tipo: 'libro', p: { ...p, prima_fill: 1 }, br: itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 1, mark: 1.4, valor_actual: 280, invertido: 205.05, pnl_usd: 74.95, comisiones: 5.05 }), grupo: { libroContratos: 2, fichas: 1 }, mark: 1.4 }]);
    igual([t.invertido, t.valor, t.pnl, t.comisiones, t.comisiones_ok, t.pnl_pct], [200, 280, 74.95, 5.05, true, 36.6], 'barra: fill 1.00 ×2 con 5.05 de comisión y mark 1.40 → neto 74.95, comisiones 5.05 (cuadran) y 36.6% sobre 205.05 = lo que dice la celda');
  }
  // ════════════════ 13. cadencias de la cartera ════════════════
  {
    const { M } = armar();
    const ahora = Date.now();
    igual([M.CART_TTL_ABIERTO, M.CART_TTL_EXTENDIDO, M.CART_MIN_MS, M.VIVO_MS, M.VIVO_FRESCA_MS], [20000, 60000, 15000, 5000, 15000], 'cartera cada 20 s en sesión regular, 60 s en pre/post (piso 15 s); cotización cada 5 s, fresca 15 s');
    igual(M.carteraToca({ ts: ahora - 10000, estado: 'ok' }, true, false), false, 'a los 10 s no se relee (piso de 15 s)');
    igual(M.carteraToca({ ts: ahora - 16000, estado: 'ok' }, true, false), false, 'a los 16 s tampoco (TTL 20 s)');
    igual(M.carteraToca({ ts: ahora - 21000, estado: 'ok' }, true, false), true, 'a los 21 s sí');
    igual(M.carteraToca({ ts: ahora - 30000, estado: 'ok' }, 'extendido', false), false, 'en pre/post a los 30 s no (60 s)');
    igual(M.carteraToca({ ts: ahora - 61000, estado: 'ok' }, 'extendido', false), true, 'en pre/post a los 61 s sí');
    igual(M.carteraToca({ ts: ahora - 61000, estado: 'ok' }, false, false), false, 'con el mercado cerrado sigue siendo cada 15 min');
    igual(M.carteraToca({ ts: 0 }, true, false), true, 'sin ts: toca ya');
  }
  // ════════════════ 14. la foto del dispositivo y la caché llevan las cifras DEL BRÓKER ════════════════
  {
    const { M, _cart } = armar();
    const it = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 905, pnl_usd: 95, pnl_pct: 10.5 });
    M.aplicarCotizacion(it, { mark: 6 }, Date.now(), 'cartera');
    const fila = M.fotoFilaDe(it, '2026-09-28T14:00:00.000Z', 'u', true);
    igual([fila.mark, fila.valor_usd, fila.pl_usd, fila.pl_pct, fila.mark_fuente, fila.clave], [5, 1000, 95, 10.5, 'vivo', 'NVDA  260928C00235000'], 'fotoFilaDe: lo que dijo E*TRADE (mark 5, valor 1000, neto 95), no la cotización aplicada encima (0014: «tal como lo cuenta ese bróker»)');
    igual(M.fotoFilaDe(it, '2026-09-28T21:00:00.000Z', 'u', false).mark_fuente, 'cierre_previo', 'fuera de la sesión regular la foto dice «cierre_previo»');
    _cart.etrade = { estado: 'ok', ts: 1, items: [it] }; _cart.moomoo = { estado: 'sin_foto', ts: 1, items: [] };
    const cache = M.carteraParaCache();
    igual([cache.etrade.items[0].mark, cache.etrade.items[0].pnl_usd, cache.etrade.items[0].vivo_at, cache.etrade.items[0]._broker, it.mark], [5, 95, undefined, undefined, 6], 'la caché local guarda las cifras del bróker (mañana la cotización sería vieja) y el ítem en memoria sigue vivo');
    igual(cache.moomoo.items, [], 'los demás brókeres van tal cual');
  }
  // ════════════════ 15. la barra en sitio suma EXACTAMENTE lo que la sección (dos líneas del mismo contrato) ════════════════
  {
    const nodos = { '#g_sum_val': nodo(), '#g_sum_dif': nodo(), '#g_bmark_etrade_NVDA_CALL_235_2026_09_28': nodo() };
    const A = armar(); Object.assign(A.reg.nodos, nodos);
    // E*TRADE tiene el mismo contrato en dos líneas (dos lotes): la ficha casa con la primera, la segunda queda SIN REGISTRAR
    const l1 = itemBroker({ ...NV, broker: 'etrade', contratos: 1, prima_fill: 1, mark: 1.3002, valor_actual: 130.02, invertido: 105.05, pnl_usd: 24.97, comisiones: 5.05 });
    const l2 = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 1.2, mark: 1.3002, valor_actual: 260.04, invertido: 245.14, pnl_usd: 14.9 });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [l1, l2] };
    A._gestor.filas = [{ id: 9, ...NV, broker: 'etrade', estado: 'abierta', contratos: 1, prima_fill: 1, mark: 1.3 }];
    const F = A.M.armarFilasGestor(A._gestor.filas, A._cart);
    igual([F.filas.length, F.filasBroker.length, F.filas[0].br === l1, F.filasBroker[0].br === l2], [1, 1, true, true], 'una fila del libro (casada con la línea 1) y una SIN REGISTRAR (la línea 2)');
    const t = A.M.totalesGestor(F.filas.concat(F.filasBroker));
    igual([t.n, t.valor, t.pnl], [2, 390.06, 39.87], 'la sección suma 130.02 + 260.04 y 24.97 + 14.90');
    A.M.pintarVivoEnSitio();
    igual(nodos['#g_sum_val'].textContent, '$390.06', 'la barra en sitio suma lo MISMO (antes la línea 1 entraba dos veces: $520.08)');
    assert(/\+\$39\.87/.test(nodos['#g_sum_dif'].innerHTML), 'y la misma ganancia: ' + nodos['#g_sum_dif'].innerHTML);
  }
  // ════════════════ 16. sesionNY (real) ════════════════
  {
    const S = construir(['sesionNY'], { haceCuanto });
    const hb = (s, min) => ({ sesion: s, latido_at: new Date(Date.now() - (min || 0) * 60000).toISOString() });
    igual([S.sesionNY(hb('regular')), S.sesionNY(hb('pre')), S.sesionNY(hb('post')), S.sesionNY(hb('cerrado'))], ['regular', 'extendida', 'extendida', 'cerrado'], 'con latido fresco manda la sesión del worker (pre/post = extendida)');
    igual(['regular', 'cerrado'].includes(S.sesionNY(hb('regular', 9))), true, 'con el latido viejo (9 min) decide el reloj de NY (regular o cerrado)');
    igual(['regular', 'cerrado'].includes(S.sesionNY(null)), true, 'sin latido, el reloj');
  }
  // ════════════════ 17. el fuente: canal propio (INSERT/UPDATE), timer y foco ════════════════
  {
    assert(/sb\.channel\('mesa2-broker'\)\s*\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: 'posiciones_broker' \}, fotoBrokerCambio\)\s*\.on\('postgres_changes', \{ event: 'UPDATE', schema: 'public', table: 'posiciones_broker' \}, fotoBrokerCambio\)/.test(FUENTE), 'posiciones_broker se suscribe en su PROPIO canal y solo a INSERT/UPDATE (los DELETE no pasan por RLS)');
    assert(!/event: '\*', schema: 'public', table: 'posiciones_broker'/.test(FUENTE), 'nada se suscribe a los DELETE de posiciones_broker');
    assert(/window\._mzTimerVivo = setInterval\(\(\) => \{ try \{ tickVivo\(\); \} catch \(_\) \{\} \}, VIVO_MS\)/.test(FUENTE), 'el timer en vivo arranca con la sesión');
    assert(/try \{ aplicarVivo\(\); \} catch \(_\) \{\}\s*\/\/ v56/.test(FUENTE) && FUENTE.indexOf('try { aplicarVivo(); }') < FUENTE.indexOf('try { await fotoDispositivoSincronizar(abierto === true); }'), 'tras cada relectura de la cartera la cotización fresca vuelve a mandar, y la foto sube después (con las cifras del bróker y «vivo» solo en la regular)');
    assert(/JSON\.stringify\(carteraParaCache\(\)\)/.test(FUENTE), 'la caché local se escribe sin la cotización viva');
    assert(/id="g_mark_\$\{id\}"/.test(FUENTE) && /id="g_pnl_\$\{id\}"/.test(FUENTE) && /id="g_bmark_\$\{claveSlug\(br\.clave\)\}"/.test(FUENTE) && /id="g_vivo_\$\{Number\(p\.id\)\}"/.test(FUENTE) && /id="g_bvivo_\$\{claveSlug\(br\.clave\)\}"/.test(FUENTE) && /id="g_bl_\$\{Number\(p\.id\)\}"/.test(FUENTE), 'la tabla y las tarjetas llevan los ids que repinta el ritmo en vivo');
    assert(/id="g_vivo_estado"/.test(FUENTE) && /id="g_sum_sub"/.test(FUENTE) && /id="g_sum_com"/.test(FUENTE), 'la barra lleva la línea de estado y sus sublíneas con id');
    assert(/setTimeout\(\(\) => \{ try \{ tickVivo\(\); \} catch \(_\) \{\} \}, 300\)/.test(FUENTE), 'al volver del fondo se cotiza enseguida');
    assert(/fila\.classList\.toggle\('hot', !!n\.hot\)/.test(FUENTE), 'la fila se enciende (hot) en sitio con la celda «Salta en»');
    assert(/P&amp;L bruto <b/.test(FUENTE) && /exc\(conMark\(p\.mfe, Math\.max\)\)/.test(FUENTE), 'pnlVivo dice «bruto» y su MFE/MAE van con el mark de ahora');
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
