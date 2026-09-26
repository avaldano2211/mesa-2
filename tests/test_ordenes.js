#!/usr/bin/env node
/* Pruebas de las órdenes (E*TRADE y Schwab): construirOrden/construirOrdenSchwab,
   validarOrden, normalizarRemota (FILLED / CANCELED parcial), etiquetaOrden,
   textoBotonPreview, la bifurcación preview/place por bróker, filaOrdenDe,
   propositoDe, semaforoRango y la revisión/envío de Schwab con la identidad o0.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_ordenes.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_ordenes.js');
const { FUENTE, assert, igual, cerca, construir, esc, usd, BROKER_NOMBRE, localStorageFalso, nodo, sbFalso } = C;

const f = (x) => Object.assign({ symbol: 'spy ', tipo: 'CALL', accion: 'compra', strike: '769', expiracion: '2026-09-26', cantidad: '2', priceType: 'LIMIT', limitPrice: '3.30', stopPrice: '', offsetValue: '', orderTerm: 'GTC', clientOrderId: 'mzprueba1' }, x || {});

// ════════════════ 1. construirOrden: la forma EXACTA del contrato app↔proxy (E*TRADE) ════════════════
{
  const O = construir(['construirOrden', 'clientOrderIdNuevo'], {});
  const o = O.construirOrden(f());
  igual([o.orderType, o.clientOrderId, o.Order.length], ['OPTN', 'mzprueba1', 1], 'una opción: orderType OPTN, con el clientOrderId dado');
  const ord = o.Order[0];
  igual([ord.priceType, ord.orderTerm, ord.marketSession, ord.allOrNone, ord.limitPrice], ['LIMIT', 'GOOD_UNTIL_CANCEL', 'REGULAR', false, 3.3], 'LIMIT GTC: GOOD_UNTIL_CANCEL, sesión REGULAR, sin allOrNone, límite numérico');
  const ins = ord.Instrument[0];
  igual([ins.orderAction, ins.quantityType, ins.quantity], ['BUY_OPEN', 'QUANTITY', 2], 'compra de opción = BUY_OPEN con cantidad entera');
  igual(ins.Product, { securityType: 'OPTN', symbol: 'SPY', callPut: 'CALL', expiryYear: 2026, expiryMonth: 9, expiryDay: 26, strikePrice: 769 }, 'el Product lleva el símbolo en mayúsculas sin espacios, la expiración en tres campos y el strike numérico');
  igual(O.construirOrden(f({ accion: 'venta' })).Order[0].Instrument[0].orderAction, 'SELL_CLOSE', 'venta de opción = SELL_CLOSE');
  igual(O.construirOrden(f({ tipo: 'PUT' })).Order[0].Instrument[0].Product.callPut, 'PUT', 'PUT va como PUT');
  igual(O.construirOrden(f({ orderTerm: 'DAY' })).Order[0].orderTerm, 'GOOD_FOR_DAY', 'DAY = GOOD_FOR_DAY');
  const eq = O.construirOrden(f({ tipo: 'EQ', accion: 'venta', cantidad: '10.7' }));
  igual([eq.orderType, eq.Order[0].Instrument[0].orderAction, eq.Order[0].Instrument[0].quantity, eq.Order[0].Instrument[0].Product], ['EQ', 'SELL', 10, { securityType: 'EQ', symbol: 'SPY' }], 'una acción: EQ, SELL/BUY y cantidad truncada a entero');
  igual(O.construirOrden(f({ tipo: 'EQ' })).Order[0].Instrument[0].orderAction, 'BUY', 'compra de acción = BUY');
  const st = O.construirOrden(f({ priceType: 'STOP', stopPrice: '2.5', limitPrice: '' })).Order[0];
  igual([st.stopPrice, 'limitPrice' in st], [2.5, false], 'STOP lleva stopPrice y no limitPrice');
  const tr = O.construirOrden(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '15', limitPrice: '' })).Order[0];
  igual([tr.offsetType, tr.offsetValue, 'limitPrice' in tr], ['TRAILING_STOP_PRCT', 15, false], 'trailing stop: offsetType + offsetValue');
  igual('limitPrice' in O.construirOrden(f({ priceType: 'MARKET' })).Order[0], false, 'MARKET no lleva precio');
  const sinId = O.construirOrden(f({ clientOrderId: undefined }));
  assert(/^mz[a-z0-9]{1,18}$/.test(sinId.clientOrderId) && sinId.clientOrderId.length <= 20, 'sin clientOrderId se genera uno ≤ 20 alfanumérico que empieza por mz', sinId.clientOrderId);
  // 200 instantes DISTINTOS: dos ids del mismo milisegundo solo se distinguen por 4 letras al azar
  // (36⁴ = 1,68 M valores), y 200 en un mismo ms chocaban ~1 % de las veces sin que el código fallara.
  const ids = new Set(Array.from({ length: 200 }, (_, i) => O.clientOrderIdNuevo(1700000000000 + i)));
  igual(ids.size, 200, 'clientOrderIdNuevo no repite (200 instantes seguidos, todos distintos)');
  igual(O.clientOrderIdNuevo(0).slice(0, 3), 'mz0', 'lleva el tiempo en base 36');
}

// ════════════════ 2. construirOrdenSchwab: el Trader API de Schwab (una pierna) ════════════════
{
  const S = construir(['construirOrdenSchwab', 'osiDe', 'desOsi', 'filaOrdenSchwab', 'clientOrderIdNuevo'], {});
  const o = S.construirOrdenSchwab(f());
  igual([o.orderType, o.session, o.duration, o.orderStrategyType, o.complexOrderStrategyType, o.price], ['LIMIT', 'NORMAL', 'GOOD_TILL_CANCEL', 'SINGLE', 'NONE', '3.30'], 'LIMIT GTC: precio como TEXTO con 2 decimales, duración GOOD_TILL_CANCEL');
  const leg = o.orderLegCollection[0];
  igual([leg.instruction, leg.quantity, leg.instrument], ['BUY_TO_OPEN', 2, { symbol: 'SPY   260926C00769000', assetType: 'OPTION' }], 'la pierna: BUY_TO_OPEN del OSI del contrato');
  igual(S.osiDe('spy', '2026-09-26', 769, 'CALL'), 'SPY   260926C00769000', 'OSI: símbolo a 6, yymmdd, C/P y strike × 1000 a 8 dígitos');
  igual(S.osiDe('NVDA', '2026-10-03', 180.5, 'PUT'), 'NVDA  261003P00180500', 'un strike con medio dólar');
  igual(S.desOsi('NVDA  261003P00180500'), { symbol: 'NVDA', expiracion: '2026-10-03', strike: 180.5, direccion: 'PUT' }, 'desOsi deshace osiDe');
  igual(S.desOsi(S.osiDe('SPY', '2026-09-26', 769, 'CALL')).strike, 769, 'ida y vuelta');
  igual(S.desOsi('rarísimo'), null, 'un OSI mal formado → null');
  igual(S.construirOrdenSchwab(f({ accion: 'venta' })).orderLegCollection[0].instruction, 'SELL_TO_CLOSE', 'venta = SELL_TO_CLOSE');
  igual(S.construirOrdenSchwab(f({ orderTerm: 'DAY' })).duration, 'DAY', 'DAY = DAY');
  const eq = S.construirOrdenSchwab(f({ tipo: 'EQ' }));
  igual([eq.orderLegCollection[0].instruction, eq.orderLegCollection[0].instrument, 'complexOrderStrategyType' in eq], ['BUY', { symbol: 'SPY', assetType: 'EQUITY' }, false], 'una acción: BUY/SELL, EQUITY y sin complexOrderStrategyType');
  const tr = S.construirOrdenSchwab(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '15', limitPrice: '' }));
  igual([tr.orderType, tr.stopPriceLinkBasis, tr.stopPriceLinkType, tr.stopPriceOffset, 'price' in tr], ['TRAILING_STOP', 'MARK', 'PERCENT', 15, false], 'trailing stop: TRAILING_STOP en % sobre el MARK');
  igual(S.construirOrdenSchwab(f({ priceType: 'STOP', stopPrice: '2.5', limitPrice: '' })).stopPrice, '2.50', 'STOP: stopPrice como texto');
  const fila = S.filaOrdenSchwab(f(), o, { proposito: 'entrada' });
  igual([fila.broker, fila.client_order_id, fila.symbol, fila.security_type, fila.direccion, fila.strike, fila.expiracion, fila.accion, fila.cantidad, fila.price_type, fila.limit_price, fila.order_term, fila.proposito],
    ['schwab', 'mzprueba1', 'SPY', 'OPTN', 'CALL', 769, '2026-09-26', 'BUY_OPEN', 2, 'LIMIT', 3.3, 'GOOD_UNTIL_CANCEL', 'entrada'], 'la fila de Schwab usa el MISMO vocabulario que E*TRADE (BUY_OPEN, GOOD_UNTIL_CANCEL) para que el resto de la app no distinga brókeres');
  igual(S.filaOrdenSchwab(f({ accion: 'venta' }), S.construirOrdenSchwab(f({ accion: 'venta' })), {}).accion, 'SELL_CLOSE', 'venta → SELL_CLOSE');
  const filaEq = S.filaOrdenSchwab(f({ tipo: 'EQ' }), eq, {});
  igual([filaEq.security_type, filaEq.direccion, filaEq.strike, filaEq.expiracion, filaEq.accion], ['EQ', null, null, null, 'BUY'], 'acción: EQ sin dirección, strike ni expiración');
  igual(S.filaOrdenSchwab(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '15', limitPrice: '' }), tr, {}).offset_value, 15, 'el trailing viaja en offset_value');
}

// ════════════════ 3. validarOrden ════════════════
{
  const V = construir(['validarOrden'], {}, { consts: ['PRICE_TYPES'] });
  igual(V.validarOrden(f()), null, 'un formulario completo es válido');
  igual(V.validarOrden(f({ symbol: 'toolong1' })), 'Ticker inválido (1 a 6 letras).', 'ticker de 7 letras');
  igual(V.validarOrden(f({ symbol: 'brk.b' })), null, 'BRK.B (con punto) vale');
  igual(V.validarOrden(f({ tipo: 'FUT' })), 'Tipo inválido.', 'tipo raro');
  igual(V.validarOrden(f({ accion: 'hold' })), 'Acción inválida.', 'acción rara');
  igual(V.validarOrden(f({ cantidad: '1.5' })), 'La cantidad es un entero mayor que 0.', 'cantidad fraccionaria');
  igual(V.validarOrden(f({ cantidad: '0' })), 'La cantidad es un entero mayor que 0.', 'cantidad 0');
  igual(V.validarOrden(f({ strike: '' })), 'Falta el strike.', 'sin strike');
  igual(V.validarOrden(f({ expiracion: '26-09-26' })), 'Falta la expiración.', 'expiración mal formada');
  igual(V.validarOrden(f({ tipo: 'EQ', strike: '', expiracion: '' })), null, 'una acción no necesita strike ni expiración');
  igual(V.validarOrden(f({ priceType: 'STOP_LIMIT' })), 'Tipo de precio inválido.', 'STOP_LIMIT no está en el formulario');
  igual(V.validarOrden(f({ limitPrice: '' })), 'Falta el precio límite.', 'LIMIT sin precio');
  igual(V.validarOrden(f({ priceType: 'STOP', stopPrice: '0' })), 'Falta el precio stop.', 'STOP sin precio');
  igual(V.validarOrden(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '100' })), 'El trailing stop es un % entre 0 y 100.', 'trailing de 100%');
  igual(V.validarOrden(f({ priceType: 'MARKET', limitPrice: '' })), null, 'MARKET no necesita precio');
  igual(V.validarOrden(f({ orderTerm: 'GOOD_UNTIL_CANCEL' })), 'Término inválido.', 'el término del formulario es DAY|GTC');
  igual(V.validarOrden(null), 'Ticker inválido (1 a 6 letras).', 'null no revienta');
}

// ════════════════ 4. normalizarRemota: FILLED, CANCELED parcial, vivas ════════════════
{
  const N = construir(['normalizarRemota', 'estadoLocalDe'], {});
  const et = (status, insts, extra) => ({ OrderDetail: [Object.assign({ status, Instrument: insts }, extra || {})] });
  const r1 = N.normalizarRemota('etrade', et('OPEN', [{ filledQuantity: 0, orderedQuantity: 2 }]));
  igual([r1.st, r1.nuevo, r1.qty, r1.vivo, r1.parcial], ['OPEN', null, 0, 'OPEN', null], 'E*TRADE OPEN: sigue activa');
  const r2 = N.normalizarRemota('etrade', et('EXECUTED', [{ filledQuantity: 2, averageExecutionPrice: 1.5 }], { executedTime: Date.parse('2026-09-24T14:00:00Z') }));
  igual([r2.nuevo, r2.qty, r2.fill, r2.ejecutadaAt], ['ejecutada', 2, 1.5, '2026-09-24T14:00:00.000Z'], 'EXECUTED: ejecutada con cantidad, precio y hora de ejecución');
  igual(N.normalizarRemota('etrade', et('INDIVIDUAL_FILLS', [{ filledQuantity: 1, averageExecutionPrice: 1.5 }, { filledQuantity: 1, averageExecutionPrice: 1.7 }])).fill, 1.6, 'varios fills: precio PROMEDIO ponderado');
  const r3 = N.normalizarRemota('etrade', et('CANCELLED', [{ filledQuantity: 1, averageExecutionPrice: 1.5, orderedQuantity: 3 }]));
  igual([r3.nuevo, r3.qty, r3.parcial], ['ejecutada', 1, { llenados: 1, pedidos: 3, final: 'CANCELLED' }], 'CANCELLED con contratos llenados = ejecución PARCIAL: lo llenado cuenta');
  igual(N.normalizarRemota('etrade', et('CANCELLED', [{ filledQuantity: 0 }])).nuevo, 'cancelada', 'CANCELLED sin fills = cancelada');
  igual(N.normalizarRemota('etrade', et('EXPIRED', [{ filledQuantity: 0 }])).nuevo, 'expirada', 'EXPIRED = expirada');
  igual(N.normalizarRemota('etrade', et('REJECTED', [])).nuevo, 'rechazada', 'REJECTED = rechazada');
  igual(N.normalizarRemota('etrade', et('OPEN', [{ filledQuantity: 1, averageExecutionPrice: 1.5, orderedQuantity: 3 }])).vivo, 'PARTIAL', 'OPEN con contratos llenados = PARCIAL (viva)');
  igual(N.normalizarRemota('etrade', et('CANCEL_REQUESTED', [{ filledQuantity: 1, averageExecutionPrice: 1.5 }])).vivo, 'CANCEL_REQUESTED', 'CANCEL_REQUESTED con fills sigue diciendo CANCEL_REQUESTED, no PARCIAL');
  igual(N.normalizarRemota('etrade', { OrderDetail: { status: 'OPEN', Instrument: { filledQuantity: 0 } } }).st, 'OPEN', 'OrderDetail e Instrument como objeto suelto también se leen');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(N.normalizarRemota('etrade', et('EXECUTED', [{ filledQuantity: 1, averageExecutionPrice: 1 }])).ejecutadaAt), 'sin executedTime se usa AHORA como hora de ejecución');
  igual([N.estadoLocalDe('executed'), N.estadoLocalDe('CANCELLED'), N.estadoLocalDe('OPEN'), N.estadoLocalDe(null)], ['ejecutada', 'cancelada', null, null], 'estadoLocalDe: mapa E*TRADE → local, null = sigue activa');
  // Schwab
  const sw = (status, legs, extra) => Object.assign({ status, orderActivityCollection: legs ? [{ executionLegs: legs }] : [] }, extra || {});
  const s1 = N.normalizarRemota('schwab', sw('FILLED', [{ quantity: 1, price: 2.0 }, { quantity: 1, price: 2.2 }], { closeTime: '2026-09-24T14:05:00.000+0000' }));
  igual([s1.nuevo, s1.qty, s1.fill, s1.ejecutadaAt], ['ejecutada', 2, 2.1, '2026-09-24T14:05:00.000Z'], 'Schwab FILLED: ejecutada, cantidad sumada, precio ponderado, closeTime');
  const s2 = N.normalizarRemota('schwab', sw('WORKING', [{ quantity: 1, price: 2.0 }], { quantity: 3 }));
  igual([s2.nuevo, s2.vivo, s2.qty], [null, 'PARTIAL', 1], 'Schwab no tiene PARTIAL: WORKING con fills se presenta como PARCIAL');
  igual(N.normalizarRemota('schwab', sw('WORKING', [])).vivo, 'WORKING', 'WORKING sin fills = WORKING');
  const s3 = N.normalizarRemota('schwab', sw('CANCELED', [{ quantity: 2, price: 2.0 }], { quantity: 5 }));
  igual([s3.nuevo, s3.parcial], ['ejecutada', { llenados: 2, pedidos: 5, final: 'CANCELED' }], 'Schwab CANCELED con fills = ejecución parcial');
  igual(N.normalizarRemota('schwab', sw('CANCELED', [])).nuevo, 'cancelada', 'CANCELED sin fills = cancelada');
  igual(N.normalizarRemota('schwab', sw('REPLACED', [])).nuevo, 'cancelada', 'REPLACED (reemplazada desde Schwab) = cancelada para la Mesa');
  igual(N.normalizarRemota('schwab', sw('EXPIRED', [])).nuevo, 'expirada', 'EXPIRED = expirada');
  igual(N.normalizarRemota('schwab', sw('REJECTED', [])).nuevo, 'rechazada', 'REJECTED = rechazada');
  igual(N.normalizarRemota('schwab', sw('PENDING_CANCEL', [])).vivo, 'CANCEL_REQUESTED', 'PENDING_CANCEL se normaliza a CANCEL_REQUESTED (la etiqueta CANCELANDO es la misma)');
  igual(N.normalizarRemota('schwab', sw('FILLED', null, { filledQuantity: 2, price: 1.9 })).fill, 1.9, 'sin executionLegs: filledQuantity y price de la orden');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(N.normalizarRemota('schwab', sw('FILLED', [{ quantity: 1, price: 1 }], { closeTime: 'no es fecha' })).ejecutadaAt), 'una fecha ilegible de Schwab no revienta: ahora');
}

// ════════════════ 5. etiquetaOrden y textoBotonPreview ════════════════
{
  const E = construir(['etiquetaOrden', 'textoBotonPreview'], {});
  igual(E.etiquetaOrden({ estado: 'enviada' }), 'ACTIVA', 'enviada sin detalle = ACTIVA');
  igual(E.etiquetaOrden({ estado: 'enviada', respuesta: { _vivo: { status: 'CANCEL_REQUESTED' } } }), 'CANCELANDO', 'con cancelación pedida = CANCELANDO');
  igual(E.etiquetaOrden({ estado: 'enviada', respuesta: { _vivo: { status: 'PENDING_CANCEL' } } }), 'CANCELANDO', 'PENDING_CANCEL (Schwab) también CANCELANDO');
  igual(E.etiquetaOrden({ estado: 'enviada', respuesta: { _vivo: { status: 'PARTIAL' } } }), 'PARCIAL', 'llenada en parte = PARCIAL');
  igual(E.etiquetaOrden({ estado: 'enviada', respuesta: { _etrade: { OrderDetail: [{ status: 'CANCEL_REQUESTED' }] } } }), 'CANCELANDO', 'el detalle sincronizado de E*TRADE también vale');
  igual(E.etiquetaOrden({ estado: 'enviada', respuesta: { _vivo: { status: 'OPEN' }, _etrade: { OrderDetail: [{ status: 'CANCEL_REQUESTED' }] } } }), 'ACTIVA', 'y el estado vivo más reciente manda sobre el detalle viejo');
  igual(E.etiquetaOrden({ estado: 'error' }), 'VERIFICA', 'sin respuesta clara = VERIFICA (jamás inventar éxito)');
  igual([E.etiquetaOrden({ estado: 'ejecutada' }), E.etiquetaOrden({ estado: 'preview' }), E.etiquetaOrden({})], ['EJECUTADA', 'PREVIEW', ''], 'los demás estados en mayúsculas');
  igual([E.textoBotonPreview('schwab'), E.textoBotonPreview('etrade'), E.textoBotonPreview(undefined)], ['Revisar orden', 'Vista previa en E*TRADE', 'Vista previa en E*TRADE'], 'el botón dice «Revisar orden» en Schwab (no hay vista previa del bróker) y «Vista previa en E*TRADE» si no');
}

// ════════════════ 6. filaOrdenDe, propositoDe, semaforoRango, totales y presupuesto ════════════════
{
  const F = construir(['filaOrdenDe', 'construirOrden', 'clientOrderIdNuevo', 'propositoDe', 'semaforoRango', 'totalOrden', 'cantidadPorPresupuesto', 'presupuestoTicket', 'recortarJson', 'mensajeError', 'etError'], { presupuestoPct: () => 35 });
  const fila = F.filaOrdenDe(f(), F.construirOrden(f()), { proposito: 'entrada', senal_id: 9 });
  igual(fila, { broker: 'etrade', client_order_id: 'mzprueba1', symbol: 'SPY', security_type: 'OPTN', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', accion: 'BUY_OPEN', cantidad: 2, price_type: 'LIMIT', limit_price: 3.3, stop_price: null, offset_value: null, order_term: 'GOOD_UNTIL_CANCEL', proposito: 'entrada', senal_id: 9 }, 'la fila de la bitácora sale de la orden construida, con lo extra fusionado');
  const filaEq = F.filaOrdenDe(f({ tipo: 'EQ' }), F.construirOrden(f({ tipo: 'EQ' })));
  igual([filaEq.security_type, filaEq.direccion, filaEq.strike, filaEq.expiracion, filaEq.accion], ['EQ', null, null, null, 'BUY'], 'una acción: sin dirección, strike ni expiración');
  igual(F.filaOrdenDe(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '12', accion: 'venta', limitPrice: '' }), F.construirOrden(f({ priceType: 'TRAILING_STOP_PRCT', offsetValue: '12', accion: 'venta', limitPrice: '' }))).offset_value, 12, 'el trailing viaja en offset_value');
  igual([F.propositoDe({ accion: 'compra' }), F.propositoDe({ accion: 'venta', priceType: 'LIMIT' }), F.propositoDe({ accion: 'venta', priceType: 'LIMIT' }, { proposito: 'salida_corte' }), F.propositoDe({ accion: 'venta', priceType: 'TRAILING_STOP_PRCT' }), F.propositoDe({ accion: 'venta', priceType: 'MARKET' })],
    ['entrada', 'salida_gtc', 'salida_corte', 'salida_stop', 'otro'], 'propositoDe: entrada / salida_gtc / salida_corte (del corte) / salida_stop / otro');
  const rango = { lo: 35, hi: 90 };
  igual([F.semaforoRango(0.5, rango), F.semaforoRango(0.95, rango), F.semaforoRango(1.0, rango), F.semaforoRango(0.30, rango), F.semaforoRango(0.2, rango)], ['ok', 'aviso', 'alto', 'aviso', 'alto'], 'semáforo: dentro ok, en el borde del 15% aviso, fuera alto (por arriba y por abajo)');
  igual([F.semaforoRango(0.5, null), F.semaforoRango(0.5, { lo: 90, hi: 35 }), F.semaforoRango(0, rango), F.semaforoRango(0.5, { lo: null, hi: 90 })], [null, null, null, null], 'sin rango, rango invertido o sin prima no se juzga (null)');
  igual([F.totalOrden(f({ limitPrice: '2.5', cantidad: '3' })), F.totalOrden(f({ tipo: 'EQ', limitPrice: '2.5', cantidad: '3' })), F.totalOrden(f({ priceType: 'STOP', stopPrice: '2', cantidad: '1' })), F.totalOrden(f({ priceType: 'MARKET' })), F.totalOrden(f({ limitPrice: '' }))], [750, 7.5, 200, null, null], 'total: cantidad × precio × 100 en opciones (× 1 en acciones); sin precio, null');
  igual([F.cantidadPorPresupuesto(3500, 2.5, true), F.cantidadPorPresupuesto(3500, 2.5, false), F.cantidadPorPresupuesto(100, 2.5, true), F.cantidadPorPresupuesto(3500, 0, true), F.cantidadPorPresupuesto(null, 2.5, true)], [14, 1400, 1, null, null], 'contratos por presupuesto: ⌊presupuesto ÷ (precio × 100)⌋, mínimo 1; sin precio o presupuesto, null');
  igual([F.presupuestoTicket({ saldoBroker: 10000 }, 35), F.presupuestoTicket({ saldoBroker: 10000 }), F.presupuestoTicket({ saldoBroker: 0 }, 35), F.presupuestoTicket(null, 35)], [3500, 3500, null, null], 'presupuesto del ticket: % del saldo del bróker; sin saldo, null');
  igual(F.recortarJson({ a: 1 }), { a: 1 }, 'un JSON pequeño pasa tal cual');
  const grande = F.recortarJson({ t: 'x'.repeat(5000) }, 4096);
  assert(grande._recortado === true && grande.bytes > 4096 && grande.texto.length === 4096 - 80, 'uno grande se recorta y se dice (bytes y texto truncado)');
  igual(F.recortarJson(null), {}, 'null → {}');
  igual([F.mensajeError(null), F.mensajeError({ status: 404, data: {} }), F.mensajeError({ status: 403, data: {} }), F.mensajeError({ status: 500, data: {} }), F.mensajeError({ status: 200, data: {} })],
    ['sin respuesta del proxy', 'El proxy aún no tiene esta ruta de órdenes (despliegue pendiente en el VPS).', 'Órdenes desactivadas en el proxy.', 'HTTP 500', null], 'mensajeError por código cuando no hay texto');
  igual([F.mensajeError({ status: 400, data: { Error: { message: 'Insufficient funds' } } }), F.mensajeError({ status: 403, data: { error: 'no permitido' } })], ['Insufficient funds', 'no permitido'], 'y el texto literal de E*TRADE o del proxy cuando lo hay');
}

// ════════════════ 7. resumenPreviewSchwab y swMensajeError ════════════════
{
  const R = construir(['resumenPreviewSchwab', 'swMensajeError'], {}, { consts: ['num2'] });
  igual(R.resumenPreviewSchwab(null), { valor: null, comision: null, rechazos: [], avisos: [] }, 'sin respuesta: todo vacío');
  const P = { orderStrategy: { orderBalance: { orderValue: 660, projectedCommission: 1.3 }, orderValidationResult: { rejects: [{ message: 'Insufficient buying power' }], warns: [{ activityMessage: 'Mercado cerrado' }], alerts: ['texto suelto'] } } };
  igual(R.resumenPreviewSchwab(P), { valor: 660, comision: 1.3, rechazos: ['Insufficient buying power'], avisos: ['Mercado cerrado', 'texto suelto'] }, 'lee valor, comisión, rechazos y avisos (forma tolerante)');
  igual(R.resumenPreviewSchwab({ orderBalance: { orderValue: 10 }, commissionAndFee: { commission: { commissionLegs: [{ commissionValues: [{ value: 0.65 }, { value: 0.65 }] }] } } }).comision, 1.3, 'sin projectedCommission se suman las patas de commissionAndFee');
  igual([R.swMensajeError({ data: { error: 'proxy' } }), R.swMensajeError({ data: { message: 'schwab dice' } }), R.swMensajeError({ data: { errors: [{ title: 'A' }, { detail: 'B' }] } }), R.swMensajeError({ data: {} }), R.swMensajeError(null), R.swMensajeError({ data: 'texto' })],
    ['proxy', 'schwab dice', 'A · B', null, null, null], 'swMensajeError: {error} del proxy, {message} o {errors[]} de Schwab; si no, null');
}

// ════════════════ 8. la bifurcación por bróker en el fuente y la tarjeta ════════════════
{
  const prev = C.extraer('ordenPreview'), place = C.extraer('ordenPlace');
  assert(/if \(\(_ord\.broker \|\| 'etrade'\) === 'schwab'\) return ordenPreviewSchwab\(f, av, err, btn\);/.test(prev), 'ordenPreview bifurca a ordenPreviewSchwab(f, av, err, btn) DESPUÉS de validar y de los avisos');
  assert(prev.indexOf('validarOrden(f)') < prev.indexOf('ordenPreviewSchwab(') && prev.indexOf('requiereOverride(av)') < prev.indexOf('ordenPreviewSchwab('), 'la validación y el override van antes de la bifurcación (valen para los dos brókeres)');
  assert(/if \(\(_ord\.broker \|\| 'etrade'\) === 'schwab'\) return ordenPlaceSchwab\(err, b, o0\);/.test(place), 'ordenPlace bifurca a ordenPlaceSchwab(err, b, o0) con el MISMO formulario o0');
  assert(place.indexOf('pedirPin()') < place.indexOf('ordenPlaceSchwab('), 'el PIN se pide ANTES de la bifurcación: Schwab también pasa por el PIN');
  assert(place.indexOf('if (_ord !== o0) return;') > place.indexOf('pedirPin()') && place.indexOf('if (_ord !== o0) return;') < place.indexOf('ordenPlaceSchwab('), 'y tras el PIN se comprueba la identidad del formulario antes de enviar por cualquier bróker');
  const T = construir(['tarjetaOrden', 'etiquetaOrden', 'planCongelado', 'gtcLimite', 'fmtFechaNY'], { esc, BROKER_NOMBRE });
  const o = { id: 3, estado: 'enviada', broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-03', accion: 'BUY_OPEN', cantidad: 2, price_type: 'LIMIT', limit_price: 2.1, order_term: 'GOOD_UNTIL_CANCEL', proposito: 'entrada', orden_id_ext: '999', creado_at: '2026-09-24T14:00:00Z', preview: { _mz: { plan_pct: 10, stop_pct: 20, gtc_auto: true } }, overrides: ['Antes de las 10:30 ET'] };
  const h = T.tarjetaOrden(o);
  assert(/chip c-vig">ACTIVA/.test(h) && /chip c-esp">Charles Schwab/.test(h), 'la tarjeta dice ACTIVA y el bróker cuando no es E*TRADE', h.slice(0, 200));
  assert(/NVDA CALL 180 · 03 oct/.test(h) && /BUY_OPEN ×2/.test(h) && /entrada · límite \$2\.10 · GTC · #999/.test(h), 'contrato, acción, propósito, precio, término y número del bróker');
  assert(/MZ\.cancelarOrden\(3, '999', 'schwab'\)/.test(h), 'el botón Cancelar lleva el bróker');
  assert(/ENVÍA sola la venta GTC \+10% \(≈ \$2\.33\)/.test(h), 'una compra activa anuncia la GTC automática con el plan CONGELADO en la orden (10%)');
  assert(/override: Antes de las 10:30 ET/.test(h), 'y los overrides quedan a la vista');
  assert(/te abre la venta GTC \+35%/.test(T.tarjetaOrden({ ...o, broker: 'etrade', preview: { _mz: { gtc_auto: false } } })), 'con la casilla apagada: «te abre» (no envía), y sin anotación de plan = 35%');
  assert(!/venta GTC/.test(T.tarjetaOrden({ ...o, accion: 'SELL_CLOSE' })), 'una venta no anuncia GTC automática');
  assert(/chip c-vet">VERIFICA/.test(T.tarjetaOrden({ ...o, estado: 'error' })) && /revísala en la app de Charles Schwab antes de repetirla/.test(T.tarjetaOrden({ ...o, estado: 'error' })), 'en error: VERIFICA y la instrucción de revisar en el bróker antes de repetir');
  assert(!/Cancelar</.test(T.tarjetaOrden({ ...o, orden_id_ext: null })), 'sin número del bróker no hay botón Cancelar');
}

// ════════════════ 9. ordenPreviewSchwab y ordenPlaceSchwab con la identidad o0 ════════════════
function armarSchwab(E) {
  E = Object.assign({ creds: { token: 't' }, vencido: false, uid: 'u1', num: '12345678', preview: { status: 200, data: { orderStrategy: { orderBalance: { orderValue: 660, projectedCommission: 1.3 }, orderValidationResult: {} } } },
    place: { status: 200, data: { orderId: 4242 } }, armado: true }, E || {});
  const reg = { err: nodo(), btn: nodo({ tagName: 'BUTTON' }), posts: [], inserts: [], updates: [], pintadas: [], bloqueos: [], toasts: [], cerrados: 0, rutas: 0, alerts: [] };
  const nodos = { '#oErr': reg.err, '#oBtnPrev': reg.btn, '#oBtnPlace': reg.btn, '#oGtcAuto': { checked: false } };
  const sb = sbFalso((tabla, cadena) => {
    if (cadena[0][0] === 'insert') { reg.inserts.push(cadena[0][1][0]); return { data: { id: 300 + reg.inserts.length }, error: null }; }
    if (cadena[0][0] === 'update') { reg.updates.push([cadena[0][1][0].estado, cadena[1][1][1], cadena[0][1][0]]); return { error: null }; }
    return { data: [], error: null };
  });
  const deps = { $: (s) => nodos[s] || null, swCreds: () => E.creds, swVencido: () => E.vencido, sesionActiva: E.uid ? { user: { id: E.uid } } : null,
    pintarArmadoOrden: () => {}, planActivo: () => ({ id: 'PLAN_10', gtcPct: 10, stopPct: 20 }), swCuenta: async () => 'HASH1', localStorage: localStorageFalso({ mz_sw_num: E.num }),
    swPost: async (p, body) => { reg.posts.push([p, body]); if (E.durante) E.durante(p); if (E.excepcion) throw new Error(E.excepcion); return p.endsWith('preview') ? E.preview : E.place; },
    sb, pintarPreviewOrden: (P) => reg.pintadas.push(P), bloquearFormOrden: (v) => reg.bloqueos.push(v), toast: (t) => reg.toasts.push(t), cerrarOrden: () => reg.cerrados++, ruta: () => reg.rutas++, alert: (t) => reg.alerts.push(t),
    armadoHasta: () => (E.armado ? Date.now() + 60000 : 0), pedirPin: async () => true, etCreds: () => null, etPost: async () => { throw new Error('no debería ir por E*TRADE'); }, mensajeError: () => null, etError: () => null };
  const M = construir(['ordenPreviewSchwab', 'ordenPlaceSchwab', 'ordenPlace', 'propositoDe', 'construirOrdenSchwab', 'osiDe', 'semaforoRango', 'filaOrdenSchwab', 'clientOrderIdNuevo',
    'swMensajeError', 'resumenPreviewSchwab', 'totalOrden', 'recortarJson', 'textoBotonPreview'], deps,
    { consts: ['PREVIEW_SEG', 'SW_K', 'mascaraCuenta', 'num2'], prefijo: 'let _ord = null; function __setOrd(v) { _ord = v; }', extras: ['__setOrd'] });
  const formulario = (x) => Object.assign({ pre: { proposito: 'entrada' }, broker: 'schwab', ctx: { rangos: { SPY: { lo: 200, hi: 400 } }, plan: null }, avisos: [], orden: null, previewIds: null, filaId: null, caduca: 0 }, x || {});
  return { M, reg, E, formulario };
}
(async () => {
  {
    const { M, reg, formulario } = armarSchwab();
    const A = formulario(); M.__setOrd(A);
    await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    igual([reg.posts.length, reg.posts[0][0], reg.posts[0][1].hash, reg.posts[0][1].orden.orderLegCollection[0].instruction], [1, '/schwab/orden/preview', 'HASH1', 'BUY_TO_OPEN'], 'la revisión pide la vista previa REAL de Schwab (previewOrder) con el hash de la cuenta');
    igual([reg.inserts[0].estado, reg.inserts[0].broker, reg.inserts[0].accion, reg.inserts[0].user_id, reg.inserts[0].preview._mz.local, reg.inserts[0].preview._mz.plan_pct, reg.inserts[0].preview._mz.stop_pct], ['preview', 'schwab', 'BUY_OPEN', 'u1', false, 10, 20], 'la fila preview lleva el vocabulario de la Mesa, local:false (hubo vista previa de Schwab) y el plan CONGELADO (10/20)');
    igual([A.filaId, A.previewIds, A.accountIdKey, A.estadoFila], [301, [{ local: false, schwab: true }], 'HASH1', 'preview'], 'el formulario queda listo para enviar, con el mismo reloj de 3 min');
    assert(A.caduca > Date.now() + 170000 && A.caduca <= Date.now() + 180000, 'la revisión caduca a los 3 min (PREVIEW_SEG)');
    const P = reg.pintadas[0];
    igual([P._local, P.estimatedTotalAmount, P.estimatedCommission], [false, 660, 1.3], 'se pinta el costo y la comisión que dio Schwab');
    assert(/entra directo a tu cuenta de Schwab 12\*\*\*678 \(SPY   260926C00769000\)/.test(P.Order[0].messages.Message[0].description), 'el mensaje dice que al tocar Enviar entra DIRECTO a la cuenta (enmascarada) y el contrato', P.Order[0].messages.Message[0].description);
    igual([reg.bloqueos, reg.btn.textContent], [[true], 'Revisar orden'], 'formulario bloqueado y botón de Schwab');
  }
  {
    const { M, reg, formulario, E } = armarSchwab();
    const A = formulario(), B = formulario({ pre: { proposito: 'salida_corte' } }); M.__setOrd(A);
    E.durante = () => M.__setOrd(B);
    await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    igual([A.previewIds, B.previewIds, reg.updates], [null, null, [['expirada', 301, { estado: 'expirada' }]]], 'la revisión que volvió tarde no se guarda en ningún formulario y su fila queda expirada');
    igual([reg.pintadas.length, reg.bloqueos.length], [0, 0], 'ni se pinta ni se bloquea el ajeno');
  }
  { const { M, reg, formulario } = armarSchwab({ preview: { status: 400, data: { message: 'Invalid strike' } } }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    igual([reg.inserts[0].estado, reg.err.textContent], ['rechazada', 'Schwab rechazó la orden en la revisión: Invalid strike'], 'Schwab rechaza en la revisión (400 con message): rechazada, con su motivo'); }
  { const { M, reg, formulario } = armarSchwab({ preview: { status: 200, data: { orderStrategy: { orderValidationResult: { rejects: [{ message: 'Insufficient buying power' }] } } } } }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    igual([reg.inserts[0].estado, reg.err.textContent], ['rechazada', 'Schwab rechazó la orden en la revisión: Insufficient buying power'], 'un 200 con rejects también es un rechazo'); }
  {
    const { M, reg, formulario } = armarSchwab({ preview: { status: 502, data: {} } }); const A = formulario(); M.__setOrd(A);
    await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    igual([reg.inserts[0].estado, reg.inserts[0].preview._mz.local, A.previewIds], ['preview', true, [{ local: true, schwab: false }]], 'si Schwab no da vista previa (5xx) la revisión es LOCAL y queda dicho');
    assert(reg.pintadas[0]._local === true && reg.pintadas[0].estimatedTotalAmount === 660 && reg.pintadas[0].Order[0].messages.Message.some(m => /revisión local/.test(m.description)), 'se pinta el total calculado aquí (2 × 3.30 × 100) y se avisa de que es revisión local');
  }
  { const { M, reg, formulario } = armarSchwab({ preview: { status: 401, data: { error: 'login semanal de Schwab caducado' } } }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    assert(/La sesión de Schwab caducó/.test(reg.err.textContent) && reg.inserts.length === 0, 'un 401 es problema de login: no se anota nada'); }
  { const { M, reg, formulario } = armarSchwab({ creds: null }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn); assert(/Conecta Schwab primero/.test(reg.err.textContent) && reg.posts.length === 0, 'sin credenciales de Schwab: conectar'); }
  { const { M, reg, formulario } = armarSchwab({ vencido: true }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn); assert(/login semanal de Schwab caducó/.test(reg.err.textContent), 'login semanal caducado: reconectar'); }
  { const { M, reg, formulario } = armarSchwab({ uid: null }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn); assert(/Sin sesión/.test(reg.err.textContent), 'sin sesión de la Mesa no se revisa'); }
  { const { M, reg, formulario } = armarSchwab({ excepcion: 'No pude contactar el proxy (¿Funnel activo?).' }); M.__setOrd(formulario()); await M.ordenPreviewSchwab(f(), [], reg.err, reg.btn);
    assert(/No pude contactar el proxy/.test(reg.err.textContent) && reg.inserts.length === 0, 'proxy caído en la revisión: se dice y no se anota nada'); }
  // envío
  const listo = (x) => Object.assign({ pre: { proposito: 'entrada' }, broker: 'schwab', orden: { orderType: 'LIMIT' }, previewIds: [{ schwab: true }], filaId: 301, accountIdKey: 'HASH1', caduca: Date.now() + 120000, estadoFila: 'preview', timer: null }, x || {});
  {
    const { M, reg } = armarSchwab(); const A = listo(); M.__setOrd(A);
    await M.ordenPlace();
    igual([reg.posts.length, reg.posts[0][0], reg.posts[0][1].hash], [1, '/schwab/orden/place', 'HASH1'], 'ordenPlace con Schwab envía por /schwab/orden/place (vía ordenPlaceSchwab)');
    igual([reg.updates[0][0], reg.updates[0][1], reg.updates[0][2].orden_id_ext, A.estadoFila, reg.cerrados, reg.rutas, A.enviando], ['enviada', 301, '4242', 'enviada', 1, 1, false], 'enviada con el orderId de Schwab, se cierra el formulario y se redibuja');
    assert(/Orden enviada a Schwab/.test(reg.toasts[0]), 'y se confirma');
  }
  {
    const { M, reg, E } = armarSchwab(); const A = listo(), B = listo({ filaId: 302 }); M.__setOrd(A);
    E.durante = (p) => { if (p.endsWith('place')) M.__setOrd(B); };
    await M.ordenPlace();
    igual([reg.updates[0][1], reg.cerrados, B.estadoFila], [301, 0, 'preview'], 'si el formulario cambió mientras Schwab contestaba, se anota en la fila de o0 y no se cierra el ajeno');
  }
  { const { M, reg } = armarSchwab({ place: { status: 400, data: { message: 'Order rejected by Schwab' } } }); const A = listo(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], reg.err.textContent, A.indeterminado], ['rechazada', 'Order rejected by Schwab', undefined], 'habló Schwab (400 con message): rechazada'); }
  { const { M, reg } = armarSchwab({ place: { status: 403, data: { error: 'ordenes desactivadas' } } }); M.__setOrd(listo()); await M.ordenPlace();
    igual(reg.updates[0][0], 'rechazada', 'el proxy la paró ANTES (403 con {error}): rechazada'); }
  { const { M, reg } = armarSchwab({ place: { status: 500, data: {} } }); const A = listo(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado, reg.btn.textContent], ['error', true, 'Verifica en Schwab'], 'un 5xx en el envío: indeterminado, jamás «rechazada»');
    assert(/Verifica en Schwab si la orden entró ANTES de reintentar/.test(reg.err.textContent), 'y se exige verificar en Schwab'); }
  { const { M, reg } = armarSchwab({ place: { status: 200, data: {} } }); const A = listo(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado], ['error', true], 'un 200 sin orderId no es un éxito: indeterminado'); }
  { const { M, reg } = armarSchwab({ place: { status: 401, data: { error: 'login semanal de Schwab caducado' } } }); const A = listo(); M.__setOrd(A); await M.ordenPlace();
    assert(/La sesión de Schwab caducó/.test(reg.err.textContent) && reg.updates.length === 0 && !A.indeterminado, 'un 401 al enviar: se dice, sin anotar ni marcar indeterminado (Schwab no la recibió)'); }
  { const { M, reg } = armarSchwab({ excepcion: 'No pude contactar el proxy (¿Funnel activo?).' }); const A = listo(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado], ['error', true], 'sin respuesta del proxy al enviar: indeterminado'); }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
