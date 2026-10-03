#!/usr/bin/env node
/* Pruebas de la v60 · «La acción detrás del contrato» (Andrés, 2026-10-03, viendo el Diario: «¿en qué
   precio estaba la acción? […] a qué distancia está cada contrato de la acción»). Diario: el spot del
   fill (lo escribe el worker, 0020) viaja al tramo y al viaje (media ponderada, fuente PEOR) y la tarjeta
   de cada operación cerrada gana una tercera fila (acción · contrato vs acción · strike al entrar).
   Copiloto: bajo cada contrato, «acción $X · strike a +$Y (+Z %) fuera del dinero» con el spot de AHORA
   (cotización en vivo de la acción, pedida junto a los contratos sin desplazarlos; si no, el spot del
   worker con su edad; si no, se dice). Funciones REALES del fuente (casa_pruebas.js).
   Uso: node test_spot.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_spot.js');
const { FUENTE, assert, igual, cerca, construir, esc, usd, colUtil, BROKER_NOMBRE, nodo, haceCuanto, extraer } = C;
const HOY = '2026-10-03';

(async () => {
  // ════════════════ 1. distanciaStrike: CALL / PUT · fuera / dentro / en el dinero ════════════════
  {
    const D = construir(['distanciaStrike']);
    igual(D.distanciaStrike('CALL', 372.5, 370.7), { usd: 1.8, pct: 0.49, lado: 'fuera' }, 'CALL con strike por encima del spot: +$1.80 (+0.49 %) fuera del dinero');
    igual(D.distanciaStrike('CALL', 365, 370.7), { usd: -5.7, pct: -1.54, lado: 'dentro' }, 'CALL con strike por debajo: dentro del dinero (signo negativo)');
    igual(D.distanciaStrike('PUT', 365, 370.7), { usd: 5.7, pct: 1.54, lado: 'fuera' }, 'PUT con strike por debajo: fuera del dinero y POSITIVO (el signo es spot − strike en PUT)');
    igual(D.distanciaStrike('PUT', 380, 370.7), { usd: -9.3, pct: -2.51, lado: 'dentro' }, 'PUT con strike por encima: dentro del dinero');
    igual(D.distanciaStrike('CALL', 370.7, 370.7), { usd: 0, pct: 0, lado: 'en' }, 'strike = spot: en el dinero');
    igual(D.distanciaStrike('CALL', 370.8, 370.7).lado, 'en', 'a menos del 0,05 % (0.027 %) sigue siendo «en el dinero»');
    igual(D.distanciaStrike('CALL', 371, 370.7).lado, 'fuera', 'al 0,08 % ya es fuera del dinero');
    igual(D.distanciaStrike('put', '365', '370.70'), { usd: 5.7, pct: 1.54, lado: 'fuera' }, 'dirección en minúsculas y números como texto');
    igual([D.distanciaStrike('CALL', 372.5, null), D.distanciaStrike('CALL', null, 370.7), D.distanciaStrike('CALL', 372.5, 0), D.distanciaStrike('CALL', 'x', 370.7)], [null, null, null, null], 'sin spot, sin strike, spot 0 o basura → null (no se inventa una distancia)');
  }
  // ════════════════ 2. el contable: el spot viaja del fill al tramo y al viaje (ponderado, fuente PEOR) ════════════════
  const D = construir(['emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'claveFill', 'durMin', 'diasEntre', 'spotDeFill', 'peorFuenteSpot', 'claveContrato'],
    { hoyNY: () => HOY, ymdNY: C.ymdNY }, { consts: ['DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'] });
  const F = (broker, clave, symbol, direccion, strike, expiracion, lado, contratos, precio, at, spot, fuente) =>
    ({ broker, clave_ext: clave, symbol, direccion, strike, expiracion, lado, contratos, precio, comision: 0, ejecutado_at: at, fecha_ny: C.ymdNY(at), spot, spot_fuente: fuente });
  {
    igual(D.FUENTES_SPOT, ['m1', 'm15', 'dia', 'manual'], 'las fuentes del spot, de mejor a peor: m1 < m15 < dia < manual');
    igual([D.peorFuenteSpot(['m1', 'm15']), D.peorFuenteSpot(['dia', 'm1', 'm15']), D.peorFuenteSpot(['m1', 'manual']), D.peorFuenteSpot([null, 'm1']), D.peorFuenteSpot([null, null]), D.peorFuenteSpot(['rara'])], ['m15', 'dia', 'manual', 'm1', null, null], 'peorFuenteSpot: la peor de la lista; null si ninguna (una fuente desconocida no cuenta)');
    igual([D.spotDeFill({ spot: 370.70001, spot_fuente: 'm1' }), D.spotDeFill({ spot: 0, spot_fuente: 'm1' }), D.spotDeFill({ spot: null }), D.spotDeFill({ spot: 'x' }), D.spotDeFill({ spot: 12, spot_fuente: 'rara' }), D.spotDeFill(null)],
      [{ spot: 370.7, fuente: 'm1' }, { spot: null, fuente: null }, { spot: null, fuente: null }, { spot: null, fuente: null }, { spot: 12, fuente: null }, { spot: null, fuente: null }], 'spotDeFill: a 4 decimales; 0, vacío, basura o nulo → sin spot; una fuente desconocida → null');
    // SPY: compra ×2 con spot 370.70 (m1), venta ×1 con 371.20 (m1) y venta ×1 con 372.00 (m15)
    const R = D.emparejarFillsFIFO([
      F('etrade', 'e1', 'SPY', 'CALL', 372.5, '2026-10-02', 'compra', 2, 3.30, '2026-09-29T14:00:00.000Z', 370.70, 'm1'),
      F('etrade', 'e2', 'SPY', 'CALL', 372.5, '2026-10-02', 'venta', 1, 4.00, '2026-09-30T14:00:00.000Z', 371.20, 'm1'),
      F('etrade', 'e3', 'SPY', 'CALL', 372.5, '2026-10-02', 'venta', 1, 3.50, '2026-10-01T14:00:00.000Z', 372.00, 'm15'),
    ], HOY);
    igual(R.cerradas.map(t => [t.spot_entrada, t.spot_salida, t.spot_fuente_entrada, t.spot_fuente_salida]), [[370.7, 371.2, 'm1', 'm1'], [370.7, 372, 'm1', 'm15']], 'cada TRAMO lleva el spot (y la fuente) del fill de compra y del de salida');
    const v = R.viajes[0];
    igual([v.spot_entrada, v.spot_salida, v.spot_fuente_entrada, v.spot_fuente_salida, v.spot_fuente], [370.7, 371.6, 'm1', 'm15', 'm15'], 'el VIAJE: entrada 370.70, salida = media ponderada (371.20 + 372.00) / 2 = 371.60, y la fuente PEOR (m15)');
    // refuerzo: compra ×2 con spot 100 y ×1 con spot 103 → salida ×3: la entrada pondera por contratos
    const R2 = D.emparejarFillsFIFO([
      F('schwab', 'a1', 'AAPL', 'CALL', 200, '2026-10-16', 'compra', 2, 1.00, '2026-09-21T14:00:00.000Z', 100, 'm1'),
      F('schwab', 'a2', 'AAPL', 'CALL', 200, '2026-10-16', 'compra', 1, 1.20, '2026-09-22T14:00:00.000Z', 103, 'dia'),
      F('schwab', 'a3', 'AAPL', 'CALL', 200, '2026-10-16', 'venta', 3, 1.50, '2026-09-23T14:00:00.000Z', 104, 'm1'),
    ], HOY);
    igual([R2.viajes[0].spot_entrada, R2.viajes[0].spot_salida, R2.viajes[0].spot_fuente], [101, 104, 'dia'], 'refuerzo: entrada = (100×2 + 103×1) / 3 = 101; la fuente peor es «dia» aunque dos de tres sean m1');
    // sin spot en ningún fill (el worker aún no pasó): todo null, nada revienta
    const R3 = D.emparejarFillsFIFO([
      F('tasty', 't1', 'QQQ', 'CALL', 500, '2026-10-02', 'compra', 1, 2.00, '2026-09-23T15:00:00.000Z'),
      F('tasty', 't2', 'QQQ', 'CALL', 500, '2026-10-02', 'venta', 1, 2.50, '2026-09-24T15:00:00.000Z'),
    ], HOY);
    igual([R3.viajes[0].spot_entrada, R3.viajes[0].spot_salida, R3.viajes[0].spot_fuente, R3.viajes[0].pnl], [null, null, null, 50], 'sin spot en los fills: null en el viaje (y el P&L de siempre intacto)');
    // vencimiento DEDUCIDO: el spot de salida es null (no hay instante), el de entrada se conserva
    const R4 = D.emparejarFillsFIFO([F('schwab', 's1', 'NVDA', 'CALL', 180, '2026-09-11', 'compra', 1, 2.10, '2026-09-08T14:00:00.000Z', 175.5, 'dia')], HOY);
    igual([R4.viajes[0].vencido, R4.viajes[0].spot_entrada, R4.viajes[0].spot_salida, R4.viajes[0].spot_fuente], [true, 175.5, null, 'dia'], 'vencida deducida: spot de salida null (no se cuela el de la compra), entrada 175.50 (dia)');
    // vencimiento REPORTADO con spot a mano: la fuente peor es «manual»
    const R5 = D.emparejarFillsFIFO([
      F('etrade', 'e4', 'TSLA', 'PUT', 400, '2026-09-18', 'compra', 1, 1.50, '2026-09-16T04:00:00.000Z', 410, 'm1'),
      F('etrade', 'e5', 'TSLA', 'PUT', 400, '2026-09-18', 'vencimiento', 1, 0, '2026-09-18T04:00:00.000Z', 405, 'manual'),
    ], HOY);
    igual([R5.viajes[0].spot_entrada, R5.viajes[0].spot_salida, R5.viajes[0].spot_fuente], [410, 405, 'manual'], 'vencimiento reportado con spot manual: se usa y la fuente del viaje es «manual» (la peor)');
  }
  // ════════════════ 3. la tarjeta de la operación cerrada: la tercera fila en sus variantes ════════════════
  {
    const V = construir(['seccionOperacionesDiario', 'filaAccionDiario', 'distanciaStrike', 'pctEsp', 'usdSigno'],
      { esc, fechaHoraD: () => 'FECHA', textoDuracionOp: () => 'DURO', fechaCorta: (s) => String(s || '') },
      { consts: ['LADO_DINERO', 'FUENTE_SPOT_TXT', 'BROKER_CORTO', 'dineroD', 'pctD', 'colD'] });
    igual([V.pctEsp(0.4856, 2), V.pctEsp(-1.544, 1), V.pctEsp(0, 1), V.pctEsp(null), V.usdSigno(1.8), V.usdSigno(-9.3), V.usdSigno(0), V.usdSigno(null)], ['+0.49 %', '-1.5 %', '0.0 %', '—', '+$1.80', '-$9.30', '+$0.00', '—'], 'pctEsp / usdSigno: signo siempre, espacio antes del %');
    const base = { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 372.5, expiracion: '2026-10-02', contratos: 2, prima_entrada: 3.3, prima_salida: 3.75, costo: 660, venta: 750, comisiones: 0, pnl: 90, pct: 16.3,
      entrada_at: '2026-09-29T14:00:00.000Z', salida_at: '2026-10-01T14:00:00.000Z', fecha_ny: '2026-10-01', vencido: false, lado_salida: 'venta', compras: 1, salidas: 1, tramos: [{}] };
    const h1 = V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: 371.2, spot_fuente: 'm1' });
    assert(/<span>acción<\/span><b class="mono">\$370\.70 → \$371\.20 \(\+0\.13 %\)<\/b>/.test(h1), 'ambos spots: «$370.70 → $371.20 (+0.13 %)» → ' + h1);
    assert(/<span>contrato vs acción<\/span><b class="mono">\+16\.3 % con la acción \+0\.13 %<\/b>/.test(h1), 'contrato vs acción: los DOS porcentajes, sin inventar un multiplicador');
    assert(/<span>strike al entrar<\/span><b class="mono">372\.5: \+\$1\.80 \(\+0\.49 %\) fuera del dinero<\/b>/.test(h1), 'strike al entrar: «372.5: +$1.80 (+0.49 %) fuera del dinero»');
    assert(!/15 min|cierre del día|a mano/.test(h1), 'con fuente m1 no hay sufijo (es el instante)');
    const hPlana = V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: 370.75, spot_fuente: 'm1' });
    assert(/\+16\.3 % · acción plana/.test(hPlana) && /\$370\.70 → \$370\.75 \(\+0\.01 %\)/.test(hPlana), 'con la acción movida menos del 0,05 %: «acción plana» (nada de multiplicadores con un denominador casi cero)');
    const hE = V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: null, spot_fuente: 'm1' });
    assert(/\$370\.70 → sin dato<\/b>/.test(hE) && /\+16\.3 % · <span class="fresco">acción: sin dato<\/span>/.test(hE) && /372\.5: \+\$1\.80/.test(hE), 'solo entrada: «$370.70 → sin dato», el contrato sin comparar, y el strike al entrar sí');
    const hS = V.filaAccionDiario({ ...base, spot_entrada: null, spot_salida: 371.2, spot_fuente: 'm1' });
    assert(/sin dato → \$371\.20<\/b>/.test(hS) && /strike al entrar<\/span><b class="mono"><span class="fresco">sin dato<\/span>/.test(hS), 'solo salida: «sin dato → $371.20» y el strike al entrar sin dato');
    const h0 = V.filaAccionDiario({ ...base, spot_entrada: null, spot_salida: null, spot_fuente: null });
    assert(/sin dato aún \(el worker lo completa\)/.test(h0) && /acción: sin dato/.test(h0) && !/\$—/.test(h0), 'sin ninguno: «sin dato aún (el worker lo completa)»; nunca un «$—» mudo');
    const hD = V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: 371.2, spot_fuente: 'dia' });
    assert(/\$370\.70 → \$371\.20 \(\+0\.13 %\) <span class="fresco">\(cierre del día\)<\/span>/.test(hD), 'con fuente «dia» el sufijo pequeño «(cierre del día)»');
    assert(/\(15 min\)/.test(V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: 371.2, spot_fuente: 'm15' })) && /\(a mano\)/.test(V.filaAccionDiario({ ...base, spot_entrada: 370.7, spot_salida: 371.2, spot_fuente: 'manual' })), '«(15 min)» con m15 y «(a mano)» con manual');
    const hV = V.filaAccionDiario({ ...base, vencido: true, lado_salida: 'vencimiento', pct: -100, spot_entrada: 370.7, spot_salida: null, spot_fuente: 'm1' });
    assert(/\$370\.70 → venció<\/b>/.test(hV) && /-100\.0 % · <span class="fresco">acción: sin dato/.test(hV), 'vencida: la salida dice «venció» (spot de salida null salvo que exista)');
    const hP = V.filaAccionDiario({ ...base, direccion: 'PUT', strike: 380, spot_entrada: 370.7, spot_salida: 368, spot_fuente: 'm1' });
    assert(/380: -\$9\.30 \(-2\.51 %\) dentro del dinero/.test(hP) && /\(-0\.73 %\)/.test(hP), 'PUT con strike por encima: dentro del dinero, y la acción bajó −0.73 %');
    // la tarjeta entera: las dos filas de siempre y la tercera detrás, en ese orden
    const hT = V.seccionOperacionesDiario([{ ...base, spot_entrada: 370.7, spot_salida: 371.2, spot_fuente: 'm1' }]);
    const iEnt = hT.indexOf('<span>entrada</span>'), iCos = hT.indexOf('<span>costó</span>'), iAcc = hT.indexOf('<span>acción</span>');
    assert(iEnt > 0 && iCos > iEnt && iAcc > iCos, 'la tarjeta conserva «entrada / salida / duró» y «costó / vendido / ×N» y añade la fila de la acción DESPUÉS');
    assert((hT.match(/<div class="hist">/g) || []).length === 3, 'tres filas .hist por tarjeta');
    assert(/OPERACIONES CERRADAS · 1/.test(hT) && /\$90\.00 · \+16\.3%/.test(hT), 'y el titular de la operación no cambia');
  }
  // ════════════════ 4. EN VIVO: la acción detrás de cada contrato ════════════════
  const PUROS = ['claveContrato', 'claveCartera', 'itemsCartera', 'simboloOpcionEtrade', 'contratosVivo', 'markDeCotizacion',
    'parsearCotizacionesEtrade', 'parsearCotizacionesSchwab', 'desOsi', 'osiDe', 'aplicarCotizacion', 'claveSlug', 'celdaMarkHtml',
    'celdaPnlHtml', 'lineaValorBroker', 'cifrasFila', 'markGestor', 'brokerCuadraConFicha', 'fmtPrima', 'totalesGestor', 'carteraToca',
    'etError', 'swMensajeError', 'haceCuantoSeg', 'esVivo', 'itemSinVivo', 'fotoFilaDe', 'casarCarteraLibro', 'brokersLeidos',
    'carteraLeidaAt', 'gananciaTotalesHtml', 'comisionesTotalesHtml', 'sublineaTotalesHtml',
    'distanciaStrike', 'pctEsp', 'usdSigno', 'spotDe', 'lineaDistanciaHtml', 'celdaDistHtml'];
  const VIVOS = ['aplicarVivoLista', 'aplicarVivo', 'vivoToca', 'vivoFuente', 'cotizarVivo', 'tickVivo', 'fotoBrokerCambio', 'pintarVivoEnSitio',
    'textoVivoEstado', 'pintarVivoEstado', 'armarFilasGestor', 'carteraParaCache'];
  const CONSTS = ['VIVO_MS', 'VIVO_CARTERA_MS', 'VIVO_FRESCA_MS', 'VIVO_MAX_SIMBOLOS', 'VIVO_FALLOS_PAUSA', 'ETIQUETA_DEL_BROKER', '_vivo',
    'CART_BROKERS', 'BROKERS_WORKER', 'CART_TTL_ABIERTO', 'CART_MIN_MS', 'CART_MIN_FORZAR_MS', 'CART_TTL_EXTENDIDO', 'CART_FRESCO_MS',
    'num2', 'dineroD', 'enCopilotoAhora', '_velas', 'LADO_DINERO', 'VIVAS_ACCION'];
  function armar(E) {
    E = Object.assign({ abierto: true, creds: { token: 't', token_secret: 's' }, sw: null, hash: '#/copiloto', visible: 'visible', modal: false, cambio: false }, E || {});
    const reg = { lecturas: [], swLecturas: [], vistas: 0, carteras: 0, saltas: [], timers: [], limpiados: 0, nodos: {} };
    const $ = (s) => reg.nodos[s] || null;
    const _gestor = { filas: [], pend: {}, sinColumnas: false };
    const _cart = { etrade: null, schwab: null, tasty: null, moomoo: null, enVuelo: {}, firma: '', releer: {} };
    const M = construir(PUROS.concat(VIVOS), {
      $, esc, usd, colUtil, BROKER_NOMBRE, haceCuanto, _gestor, _cart, hoyNY: () => HOY,
      location: { hash: E.hash }, document: { get visibilityState() { return E.visible; }, querySelector: () => (E.modal ? {} : null) },
      sesionActiva: E.sesion === undefined ? { user: { id: 'u' } } : E.sesion, _hbUltimo: null,
      sesionNY: () => (E.abierto === true ? 'regular' : E.abierto === 'extendido' ? 'extendida' : 'cerrado'),
      etCreds: () => E.creds, etDiaVencido: () => !!E.etVencido, swCreds: () => E.sw, swVencido: () => !!E.swVencido,
      etRead: async (cr, p, query) => { reg.lecturas.push({ cr, path: p, query }); return typeof E.etrade === 'function' ? E.etrade(p, query) : E.etrade; },
      swRead: async (p, query) => { reg.swLecturas.push({ path: p, query }); return typeof E.schwab === 'function' ? E.schwab(p, query) : E.schwab; },
      pintarSaltaEnSitio: (id) => reg.saltas.push(id), pnlVivo: (p) => 'PV ' + p.mark, lineasCartera: (p, br) => 'LC ' + (br ? br.mark : '-'),
      cargarCartera: async () => { reg.carteras++; return E.cambio; }, vistaCopiloto: () => { reg.vistas++; },
      setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; }, clearTimeout: () => { reg.limpiados++; },
    }, { consts: CONSTS, extras: ['VIVO_PAUSA_MS', 'ETIQUETA_EN_VIVO'] });
    return { M, reg, E, _gestor, _cart };
  }
  const RT = (s, extra) => Object.assign({ status: 200 }, extra || {}, { data: s });
  const q = (symbol, dir, y, m, d, strike, bid, ask, last, estado) => ({ quoteStatus: estado || 'REALTIME',
    Intraday: { bid, ask, lastTrade: last }, Product: { symbol, securityType: 'OPTN', callPut: dir, expiryYear: y, expiryMonth: m, expiryDay: d, strikePrice: strike } });
  const qEq = (symbol, bid, ask, last, estado, utc) => ({ quoteStatus: estado || 'REALTIME', dateTimeUTC: utc, All: { bid, ask, lastTrade: last }, Product: { symbol, securityType: 'EQ' } });
  const NV = { symbol: 'NVDA', direccion: 'CALL', strike: 235, expiracion: '2026-09-28' };
  const SP = { symbol: 'SPY', direccion: 'PUT', strike: 662.5, expiracion: '2026-10-02' };
  const K_NV = 'NVDA|CALL|235|2026-09-28', K_SP = 'SPY|PUT|662.5|2026-10-02';
  const itemBroker = (base, extra) => Object.assign({ ...base, clave: base.broker + '|' + [base.symbol, base.direccion, base.strike, base.expiracion].join('|'),
    origen_invertido: 'broker', origen_pnl: 'broker', origen_valor: 'broker', origen_mark: 'broker' }, extra || {});
  // ---- 4a. contratosVivo: las acciones detrás de los contratos, sin desplazarlos ----
  {
    const { M } = armar();
    const abiertas = [{ id: 1, ...NV, broker: 'etrade' }, { id: 2, ...SP, broker: 'etrade' }, { id: 3, symbol: 'META', direccion: 'CALL', expiracion: '2026-10-02' }];
    const cart = { moomoo: { estado: 'ok', items: [{ ...NV, broker: 'moomoo', clave: 'moomoo|' + K_NV }, { symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-09', broker: 'moomoo', clave: 'moomoo|TSLA|CALL|400|2026-10-09' }] } };
    const r = M.contratosVivo(abiertas, cart);
    igual([r.lista.map(x => x.clave), r.acciones, r.recortados, r.accionesFuera], [[K_NV, K_SP, 'TSLA|CALL|400|2026-10-09'], ['NVDA', 'SPY', 'TSLA'], 0, 0], 'una ACCIÓN por subyacente, en el orden de los contratos (NVDA una sola vez aunque esté en dos brókeres); la ficha sin strike no aporta');
    const muchos = Array.from({ length: 30 }, (_, i) => ({ symbol: 'SPY', direccion: 'CALL', strike: 600 + i, expiracion: '2026-10-02' }));
    const r2 = M.contratosVivo(muchos, {});
    igual([r2.lista.length, r2.recortados, r2.acciones, r2.accionesFuera], [25, 5, [], 1], 'con el tope lleno de contratos la acción NO desplaza a ninguno: queda fuera y se cuenta');
    const casi = Array.from({ length: 23 }, (_, i) => ({ symbol: ['SPY', 'NVDA', 'TSLA'][i % 3], direccion: 'CALL', strike: 600 + i, expiracion: '2026-10-02' }));
    const r3 = M.contratosVivo(casi, {});
    igual([r3.lista.length, r3.acciones, r3.accionesFuera], [23, ['SPY', 'NVDA'], 1], '23 contratos de 3 subyacentes: caben 2 acciones (hasta completar 25) y una queda fuera');
    igual(M.contratosVivo([], {}), { lista: [], recortados: 0, acciones: [], accionesFuera: 0 }, 'sin contratos: nada');
  }
  // ---- 4b. parsearCotizacionesEtrade con una acción (EQ) ----
  {
    const { M } = armar();
    const pedidos = [{ clave: K_NV }];
    const r = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), qEq('NVDA', 233.1, 233.3, 233.2, 'REALTIME', 1790000000)] } }), pedidos);
    igual([r.n, r.estado, r.por[K_NV].mark], [1, 'REALTIME', 6], 'el contrato se casa como siempre (n cuenta CONTRATOS)');
    igual(r.por_accion, { NVDA: { last: 233.2, bid: 233.1, ask: 233.3, estado: 'REALTIME', at: 1790000000000 } }, 'y la acción (Product.securityType EQ, All.lastTrade) va a por_accion por su símbolo, con su estado y la hora del dato');
    const r2 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), qEq('nvda', 233.1, 233.3, 233.2, 'DELAYED')] } }), pedidos);
    igual([r2.estado, r2.por_accion.NVDA.estado], ['REALTIME', 'DELAYED'], 'una acción CON RETRASO no contagia al lote de contratos (sigue REALTIME): lleva su propio estado y no se usará; símbolo en mayúsculas');
    const r3 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2, lastTrade: 1.1 }, Product: { symbol: 'TSLA' } }] } }), pedidos);
    igual([r3.n, Object.keys(r3.por_accion)], [0, ['TSLA']], 'un Product con símbolo y sin callPut (sin securityType) también es una acción');
    igual(M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [qEq('NVDA', 0, 0, 0)] } }), pedidos).por_accion, {}, 'una acción sin último cruce (0) no se guarda (no se inventa un spot)');
    const r4 = M.parsearCotizacionesEtrade(RT({ QuoteResponse: { QuoteData: [{ quoteStatus: 'REALTIME', Intraday: { bid: 1, ask: 1.2 } }] } }), pedidos);
    igual([r4.n, r4.por[K_NV].mark, r4.por_accion], [1, 1.1, {}], 'sin Product y con el largo de lo pedido se sigue casando por posición como contrato (no como acción)');
  }
  // ---- 4c. parsearCotizacionesSchwab con una acción ----
  {
    const { M } = armar();
    const r = M.parsearCotizacionesSchwab(RT({ 'NVDA  260928C00235000': { realtime: true, quote: { bidPrice: 5.9, askPrice: 6.1, lastPrice: 6 } },
      'NVDA': { assetMainType: 'EQUITY', realtime: true, quote: { bidPrice: 233.1, askPrice: 233.3, lastPrice: 233.2 } }, 'errors': { invalids: ['X'] } }));
    igual([r.n, r.estado, r.por[K_NV].mark, r.por_accion], [1, 'REALTIME', 6, { NVDA: { last: 233.2, bid: 233.1, ask: 233.3, estado: 'REALTIME' } }], 'Schwab: la clave que no es OSI («NVDA») es la acción; el contrato por su OSI; errors se ignora');
    igual(M.parsearCotizacionesSchwab(RT({ 'NVDA': { realtime: false, quote: { lastPrice: 233.2 } } })).por_accion.NVDA.estado, 'DELAYED', 'realtime=false → la acción con retraso (no se usará)');
    igual(M.parsearCotizacionesSchwab(RT({ 'NVDA': { quote: { lastPrice: 233.2 } } })).por_accion.NVDA.estado, 'DELAYED', 'sin el campo realtime no se presume en vivo');
  }
  // ---- 4d. _vivo.spot: fresco sí, viejo no ----
  {
    const { M } = armar();
    const ahora = Date.now();
    M._vivo.por_accion = { NVDA: { last: 233.2, ts: ahora - 3000, estado: 'REALTIME' }, SPY: { last: 662, ts: ahora - 20000, estado: 'REALTIME' }, TSLA: { last: 0, ts: ahora } };
    igual([M._vivo.spot('NVDA'), M._vivo.spot('nvda'), M._vivo.spot('SPY'), M._vivo.spot('TSLA'), M._vivo.spot('META'), M._vivo.spot(null)], [233.2, 233.2, null, null, null, null], '_vivo.spot: el last de hace 3 s sí; el de hace 20 s ya no (VIVO_FRESCA_MS = 15 s); un last 0 o un símbolo sin cotizar → null');
  }
  // ---- 4e. spotDe y lineaDistanciaHtml: vivo → worker → nada, siempre dicho ----
  {
    const { M } = armar();
    const p = { id: 7, ...NV };
    M._vivo.por_accion = { NVDA: { last: 233.2, ts: Date.now(), estado: 'REALTIME' } };
    igual(M.spotDe('NVDA'), { spot: 233.2, fuente: 'vivo', txt: 'en vivo' }, 'spotDe: (1) la cotización en vivo');
    const hV = M.lineaDistanciaHtml(p, M.spotDe('NVDA'));
    igual(hV, 'acción <b>$233.20</b> · strike a <b>+$1.80</b> (+0.8 %) fuera del dinero <span class="fresco">(en vivo)</span>', 'la línea con el spot vivo: «acción $233.20 · strike a +$1.80 (+0.8 %) fuera del dinero (en vivo)»');
    M._vivo.por_accion.NVDA.ts = Date.now() - 20000;
    M._velas.set('NVDA|m15', { fila: { payload: { niveles: { spot: 230 } }, actualizado_at: new Date(Date.now() - 3 * 60000).toISOString() }, ts: Date.now() });
    const sW = M.spotDe('NVDA');
    igual([sW.spot, sW.fuente, sW.txt], [230, 'worker', 'worker, hace 3 min'], 'spotDe: (2) con la cotización envejecida, el spot de la fila m15 del worker en caché, con su edad');
    const hW = M.lineaDistanciaHtml(p, sW);
    assert(/acción <b>\$230\.00<\/b> · strike a <b>\+\$5\.00<\/b> \(\+2\.2 %\) fuera del dinero <span class="fresco">\(worker, hace 3 min\)<\/span>/.test(hW), 'la línea con el spot del worker dice «(worker, hace 3 min)» → ' + hW);
    M._velas.set('NVDA|m15', { fila: { payload: { niveles: {} }, actualizado_at: 'x' }, ts: 1 });
    igual(M.spotDe('NVDA'), { spot: null, fuente: null, txt: 'sin dato' }, 'spotDe: (3) sin spot en la fila del worker: nada');
    M._velas.clear();
    igual(M.lineaDistanciaHtml(p, M.spotDe('NVDA')), '<span class="fresco">acción: sin dato (ni cotización en vivo ni spot del worker)</span>', 'y la línea lo dice: «acción: sin dato» (nunca «$—»)');
    assert(/acción <b>\$233\.20<\/b> <span class="fresco">\(en vivo\)<\/span> · <span class="fresco">strike: sin dato<\/span>/.test(M.lineaDistanciaHtml({ symbol: 'NVDA', direccion: 'CALL' }, { spot: 233.2, fuente: 'vivo', txt: 'en vivo' })), 'con spot pero sin strike: el precio de la acción y «strike: sin dato»');
    const pP = { ...NV, direccion: 'PUT', strike: 240 };
    assert(/strike a <b>-\$6\.80<\/b> \(-2\.9 %\) dentro del dinero/.test(M.lineaDistanciaHtml(pP, { spot: 233.2, fuente: 'vivo', txt: 'en vivo' })), 'PUT 240 con la acción a 233.20: −$6.80 (−2.9 %) dentro del dinero');
  }
  // ---- 4f. cotizarVivo: pide las acciones, guarda solo las REALTIME, y pintarVivoEnSitio repinta g_dist_ ----
  {
    const nodos = { '#g_dist_7': nodo(), '#g_mark_7': nodo(), '#g_vivo_estado': nodo() };
    const A = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), qEq('NVDA', 233.1, 233.3, 233.2, 'REALTIME', 1790000000)] } }) });
    Object.assign(A.reg.nodos, nodos);
    const br = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5, valor_actual: 1000, invertido: 905, pnl_usd: 95, pnl_pct: 10.5 });
    A._cart.etrade = { estado: 'ok', ts: Date.now(), items: [br] };
    A._gestor.filas = [{ id: 7, ...NV, broker: 'etrade', estado: 'abierta', contratos: 2, prima_fill: 4.5, mark: 5 }];
    const r = await A.M.cotizarVivo();
    igual(A.reg.lecturas[0].path, '/v1/market/quote/NVDA:2026:9:28:CALL:235,NVDA.json', 'la petición a E*TRADE lleva el contrato y, detrás, la acción');
    igual([r.n, A.M._vivo.n, br.mark, A.M._vivo.spot('NVDA')], [1, 1, 6, 233.2], 'el contrato se aplica como siempre y la acción queda fresca en _vivo.por_accion');
    assert(/acción <b>\$233\.20<\/b> · strike a <b>\+\$1\.80<\/b> \(\+0\.8 %\) fuera del dinero <span class="fresco">\(en vivo\)<\/span>/.test(nodos['#g_dist_7'].innerHTML), 'g_dist_7 repintado EN SITIO con el spot vivo → ' + nodos['#g_dist_7'].innerHTML);
    assert(/<b>6\.00<\/b>/.test(nodos['#g_mark_7'].innerHTML), 'la celda Mark sigue repintándose igual');
    igual(A.reg.vistas, 0, 'nada se redibujó entero');
    // la cotización envejece: g_dist_ cae al spot del worker (y lo dice)
    A.M._vivo.por_accion.NVDA.ts = Date.now() - 20000;
    A.M._velas.set('NVDA|m15', { fila: { payload: { niveles: { spot: 230 } }, actualizado_at: new Date(Date.now() - 2 * 60000).toISOString() }, ts: Date.now() });
    A.M.pintarVivoEnSitio();
    assert(/acción <b>\$230\.00<\/b>/.test(nodos['#g_dist_7'].innerHTML) && /\(worker, hace 2 min\)/.test(nodos['#g_dist_7'].innerHTML), 'con la cotización de hace 20 s, el repintado usa el spot del worker y dice «(worker, hace 2 min)» → ' + nodos['#g_dist_7'].innerHTML);
    A.M._velas.clear(); A.M.pintarVivoEnSitio();
    assert(/acción: sin dato/.test(nodos['#g_dist_7'].innerHTML), 'sin nada: «acción: sin dato»');
    // una acción CON RETRASO no se guarda, y el contrato sigue en vivo
    const B = armar({ etrade: RT({ QuoteResponse: { QuoteData: [q('NVDA', 'CALL', 2026, 9, 28, 235, 5.9, 6.1, 6), qEq('NVDA', 233.1, 233.3, 233.2, 'DELAYED')] } }) });
    const brB = itemBroker({ ...NV, broker: 'etrade', contratos: 2, prima_fill: 4.5, mark: 5 });
    B._cart.etrade = { estado: 'ok', ts: Date.now(), items: [brB] };
    await B.M.cotizarVivo();
    igual([brB.mark, B.M._vivo.estado, B.M._vivo.spot('NVDA'), B.M._vivo.por_accion.NVDA], [6, 'REALTIME', null, undefined], 'acción DELAYED con el contrato REALTIME: el contrato se aplica, la acción no se guarda (ni se presenta como de ahora)');
    // Schwab de respaldo: el OSI y, detrás, la acción
    const S = armar({ creds: null, sw: { token: 'x' }, schwab: RT({ 'NVDA  260928C00235000': { realtime: true, quote: { bidPrice: 5.9, askPrice: 6.1, lastPrice: 6 } }, 'NVDA': { realtime: true, quote: { lastPrice: 233.2 } } }) });
    S._cart.moomoo = { estado: 'ok', ts: Date.now(), items: [itemBroker({ ...NV, broker: 'moomoo', contratos: 1, prima_fill: 3, mark: 3.1 })] };
    await S.M.cotizarVivo();
    igual([S.reg.swLecturas[0].query.symbols, S.M._vivo.spot('NVDA')], ['NVDA  260928C00235000,NVDA', 233.2], 'por Schwab: el OSI y la acción en la misma petición; el spot queda fresco');
    // la barra dice las acciones que no cupieron
    const T = armar(); T.reg.nodos['#g_vivo_estado'] = nodo();
    T.M._vivo.ts = Date.now(); T.M._vivo.fuente = 'etrade'; T.M._vivo.estado = 'REALTIME'; T.M._vivo.n = 25; T.M._vivo.accionesFuera = 2;
    T.M.pintarVivoEstado();
    assert(/2 acción\(es\) fuera del tope: su distancia al strike va con el spot del worker/.test(T.reg.nodos['#g_vivo_estado'].textContent), 'la barra dice cuántas acciones no cupieron en el tope de 25 → ' + T.reg.nodos['#g_vivo_estado'].textContent);
  }
  // ════════════════ 5. el fuente: la línea bajo el contrato en la tarjeta y en la tabla; versiones ════════════════
  {
    assert(/<div class="mut mono" id="g_dist_\$\{Number\(p\.id\)\}" style="margin-top:4px;font-size:11\.5px">\$\{celdaDistHtml\(p\)\}<\/div>/.test(extraer('tarjetaPosicion')), 'la tarjeta de posición lleva la línea g_dist_ bajo el contrato');
    const tp = extraer('tarjetaPosicion');
    assert(tp.indexOf('id="g_dist_') < tp.indexOf('fill <b class="mono"') && tp.indexOf('id="g_dist_') > tp.indexOf('<h3>'), 'y va entre el título del contrato y la línea del fill');
    assert(/<span class="gsub2" id="g_dist_\$\{id\}" style="white-space:normal">\$\{celdaDistHtml\(p\)\}<\/span><\/td>/.test(extraer('filaGestor')), 'la fila de la tabla (Mac) lleva la misma línea en la celda Contrato');
    assert(/const ed = \$\('#g_dist_' \+ id\); if \(ed\) \{ ed\.innerHTML = celdaDistHtml\(p\); pintados\+\+; \}/.test(extraer('pintarVivoEnSitio')), 'pintarVivoEnSitio la repinta en sitio cada tic (sin innerHTML de #vista)');
    assert(/id="g_vivo_\$\{Number\(p\.id\)\}"/.test(tp) && /id="g_bl_\$\{Number\(p\.id\)\}"/.test(tp), 'las líneas g_vivo_ y g_bl_ de siempre siguen en la tarjeta');
    assert(/\$\{filaAccionDiario\(c\)\}\s*\$\{tramos\(c\)\}\$\{ejercida\(c\)\}/.test(extraer('seccionOperacionesDiario')), 'la tarjeta del Diario pinta la fila de la acción antes de los tramos');
    assert(/\.concat\(acciones \|\| \[\]\)/.test(extraer('cotizarVivo')) && (extraer('cotizarVivo').match(/\.concat\(acciones \|\| \[\]\)/g) || []).length === 2, 'las dos rutas (E*TRADE y Schwab) añaden las acciones DETRÁS de los contratos');
    assert(!/por_accion\[[^\]]*\]\s*=.*(user_id|posicion_id)/.test(FUENTE), 'muralla: nada personal viaja con la cotización de una acción');
    const raiz = path.join(path.dirname(process.argv[2]), '..');
    const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
    assert(/config\.js\?v=60/.test(html) && /app\/main\.js\?v=60/.test(html), 'index.html carga config.js?v=60 y app/main.js?v=60');
    assert(/const VER = 'mesa2-v49';/.test(sw), 'sw.js VER mesa2-v49');
    const mod = C.cargarModuloEntero({ src: './app/main.js?v=60' });
    assert(mod.cargo, 'main.js entero carga en el DOM de juguete', mod.error);
    if (mod.cargo) igual(mod.ev('typeof distanciaStrike + typeof filaAccionDiario + typeof celdaDistHtml + typeof _vivo.spot'), 'functionfunctionfunctionfunction', 'dentro del módulo REAL están las funciones nuevas y _vivo.spot');
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
