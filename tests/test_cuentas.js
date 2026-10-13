#!/usr/bin/env node
/* Pruebas de la v62 · «Cuentas con todo el detalle y a pantalla completa en la computadora» (Andrés, 2026-10-11, desde
   el laptop, viendo la vista «Cuentas» en la columna de 440 px: «dame más detalles y completa la pantalla en la
   computadora»). A: unirOperaciones solo AÑADE campos (fees, _partes_filas) y no cambia nada de lo que ya devolvía;
   spotDeOperacion, senalDeOperacion, dteEntrada y metricasCuentas (coherente con resumenPeriodo). B: la tarjeta (teléfono)
   y la fila de la tabla (computadora) dicen cada dato. C: en ancho la vista pinta la tabla de 15 columnas, en el teléfono
   tarjetas; «ver más» de 200 en 200; una lectura caída de fills o de señales no rompe la vista. Funciones REALES del
   fuente con dependencias falsas (casa_pruebas.js) y el módulo ENTERO en un DOM de juguete.
   Uso: node test_cuentas.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_cuentas.js');
const { FUENTE, assert, igual, cerca, construir, extraer, ymdNY, nodo, respirar } = C;
const RAIZ = path.join(path.dirname(process.argv[2]), '..');
const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// Claves ordenadas: compara objetos sin depender del orden en que se crearon
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;

// Las funciones de Cuentas, REALES, con sus constantes del fuente
const NOMBRES = ['spotDeOperacion', 'senalDeOperacion', 'dteEntrada', 'metricasCuentas', 'sinHoraIso', 'detalleOpCuentas', 'horaOpCuentas',
  'contratoOpCuentas', 'entradaOpCuentas', 'salidaOpCuentas', 'duracionOpCuentas', 'accionOpCuentas', 'senalOpCuentasHtml', 'tramosOpCuentasHtml',
  'tarjetaHistorial', 'filaHistorialCuentas', 'tilesCuentasHtml', 'tablasDesgloseCuentasHtml', 'seccionHistorialCuentas', 'ctaVerMas', 'ctaCambiaFormato',
  'cuentasAncho', 'unirOperaciones', 'resumenPeriodo', 'cerradasDesde', 'claveContrato', 'spotDeFill', 'peorFuenteSpot', 'distanciaStrike', 'pctEsp',
  'usdSigno', 'horaNY', 'fechaCorta', 'durTxt', 'diasEntre', 'gestorFormato',
  // v62 rev
  'diaOpNY', 'diaAperturaOp', 'partesOpCuentas', 'comisionDelBroker', 'filaVencioCuentas', 'filaPresuntaCuentas', 'indiceCuentas', 'accionParteCuentas',
  'claveDetalleCuentas', 'ctaPaginaHtml', 'ctaEstadoGuardar', 'ctaEstadoRestaurar', 'fechaNyTransaccion',
  // v62 rev2
  'senalCortaCuentas', 'tituloCelda', 'duracionTablaCuentas',
  // v62 rev3
  'filasEtradeVigentes'];
const CONSTS = ['CTA_PASO', 'CTA_MARGEN_MS', '_cta', 'CTA_COLS', 'BROKERS_CON_COMISION', 'FUENTES_SPOT', 'FUENTE_SPOT_TXT', 'SIN_HORA_TXT', 'SIN_HORA_CORTO', 'LADO_DINERO',
  'BROKER_CORTO', 'BROKER_NOMBRE', 'MESES_ES_C', 'dineroD', 'pctD', 'pctD2', 'usd', 'colUtil', 'esc', 'GESTOR_ANCHO_TABLA', 'ET_GEMELA_MS'];
function cuentas(op) {
  op = op || {};
  return construir(NOMBRES, { ymdNY, $: op.$ || (() => null), anchoVista: op.anchoVista || (() => 1400) },
    { consts: CONSTS, prefijo: `let _cuentasVista = ${JSON.stringify(op.vista || 'cuentas')};` });
}
const K = cuentas();

// El conjunto representativo de la prueba de NO regresión (A1) y su salida con la v61 (8dcbba6), claves ordenadas.
const POS_A1 = [
  { id: 1, symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', contratos: 2, prima_fill: 2.10, prima_salida: 2.45, estado: 'cerrada', broker: 'etrade',
    abierta_at: '2026-10-06T14:57:00Z', cerrada_at: '2026-10-06T15:02:00Z', abierta_fecha_ny: '2026-10-06', resultado_usd: 70, fuera_de_rango: true, entrada_semaforo: 'verde', plan_pct: 10, stop_pct: 45 },
  { id: 10, symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-10', contratos: 1, prima_fill: 2.10, prima_salida: 2.33, estado: 'cerrada', broker: 'schwab',
    abierta_at: '2026-10-07T14:00:00Z', cerrada_at: '2026-10-07T18:00:00Z', abierta_fecha_ny: '2026-10-07', resultado_usd: 23 },
  { id: 11, symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-10', contratos: 2, prima_fill: 2.10, prima_salida: 2.50, estado: 'cerrada', broker: 'schwab',
    abierta_at: '2026-10-07T14:00:00Z', cerrada_at: '2026-10-08T15:00:00Z', abierta_fecha_ny: '2026-10-07', resultado_usd: 80 },
  { id: 20, symbol: 'SPY', direccion: 'PUT', strike: 660, expiracion: '2026-10-17', contratos: 3, prima_fill: 1.00, estado: 'abierta', broker: 'etrade',
    abierta_at: '2026-10-08T14:00:00Z', abierta_fecha_ny: '2026-10-08', resultado_usd: null },
  { id: 21, symbol: 'SPY', direccion: 'PUT', strike: 660, expiracion: '2026-10-17', contratos: 2, prima_fill: 1.00, prima_salida: 1.72, estado: 'cerrada', broker: 'etrade',
    abierta_at: '2026-10-08T14:00:00Z', cerrada_at: '2026-10-09T15:00:00Z', abierta_fecha_ny: '2026-10-08', resultado_usd: 144 },
  { id: 30, symbol: 'AAPL', direccion: 'CALL', strike: null, expiracion: null, contratos: 1, prima_fill: 3, prima_salida: 0, estado: 'expirada', abierta_at: '2026-10-01T15:00:00Z', abierta_fecha_ny: '2026-10-01', cerrada_at: '2026-10-03T20:00:00Z', resultado_usd: -300 },
];
const BT_A1 = [
  { broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.20, prima_salida: 2.60,
    abierta_at: '2026-10-06T14:59:00Z', cerrada_at: '2026-10-06T15:05:00Z', resultado_usd: 38.70, fees: 1.30, clave_ext: 'e2' },
  { broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: '392.5', expiracion: '2026-10-09', contratos: '1', prima_fill: '2.00', prima_salida: '2.30',
    abierta_at: '2026-10-06T14:57:00Z', cerrada_at: '2026-10-06T15:02:00Z', resultado_usd: '28.70', fees: '1.30', clave_ext: 'e1' },
  { broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', contratos: 3, prima_fill: 2.05, prima_salida: 1.50,
    abierta_at: '2026-10-06T15:30:00Z', cerrada_at: '2026-10-06T17:00:00Z', resultado_usd: -165, fees: 0, clave_ext: 'm1' },
  { broker: 'schwab', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-10', contratos: 1, prima_fill: 4.00, prima_salida: null,
    abierta_at: '2026-10-09T13:45:00Z', cerrada_at: '2026-10-09T19:59:00Z', resultado_usd: -400, fees: null, clave_ext: 's1' },
  { broker: 'tasty', symbol: 'SPY', direccion: 'CALL', strike: 670, expiracion: '2026-10-09', contratos: 2, prima_fill: 0.80, prima_salida: 1.30,
    abierta_at: '2026-10-09T14:31:00Z', cerrada_at: '2026-10-09T14:50:00Z', resultado_usd: 100, clave_ext: 't1' },
  { broker: 'etrade', symbol: 'NVDA', direccion: 'PUT', strike: 175, expiracion: '2026-10-17', contratos: 4, prima_fill: 1.25, prima_salida: 2.10,
    abierta_at: '2026-10-02T19:00:00Z', cerrada_at: '2026-10-05T14:40:00Z', resultado_usd: 337.4, fees: 2.6, clave_ext: 'e3' },
];
const GOLDEN_V61 = {"fuentes":{"etrade":3,"manual":6,"schwab":1,"tasty":1},"fusionadas":1,"ops":[{"_fuente":"manual","abierta_at":"2026-10-01T15:00:00Z","abierta_fecha_ny":"2026-10-01","cerrada_at":"2026-10-03T20:00:00Z","contratos":1,"direccion":"CALL","estado":"expirada","expiracion":null,"id":30,"prima_fill":3,"prima_salida":0,"resultado_usd":-300,"strike":null,"symbol":"AAPL"},{"_costo":5,"_fuente":"etrade","_partes":1,"_salida":8.4,"_salidaN":4,"abierta_at":"2026-10-02T19:00:00Z","abierta_fecha_ny":"2026-10-02","broker":"etrade","cerrada_at":"2026-10-05T14:40:00Z","contratos":4,"direccion":"PUT","entrada_semaforo":null,"estado":"cerrada","expiracion":"2026-10-17","fuera_de_rango":false,"prima_fill":1.25,"prima_salida":2.1,"resultado_usd":337.4,"strike":175,"symbol":"NVDA"},{"_costo":4.2,"_fuente":"etrade","_manual_id":1,"_partes":2,"_salida":4.9,"_salidaN":2,"abierta_at":"2026-10-06T14:57:00Z","abierta_fecha_ny":"2026-10-06","broker":"etrade","cerrada_at":"2026-10-06T15:05:00Z","contratos":2,"direccion":"CALL","entrada_semaforo":"verde","estado":"cerrada","expiracion":"2026-10-09","fuera_de_rango":true,"plan_pct":10,"prima_fill":2.1,"prima_salida":2.45,"resultado_usd":67.4,"stop_pct":45,"strike":392.5,"symbol":"TSLA"},{"_costo":6.1499999999999995,"_fuente":"moomoo","_partes":1,"_salida":4.5,"_salidaN":3,"abierta_at":"2026-10-06T15:30:00Z","abierta_fecha_ny":"2026-10-06","broker":"moomoo","cerrada_at":"2026-10-06T17:00:00Z","contratos":3,"direccion":"CALL","entrada_semaforo":null,"estado":"cerrada","expiracion":"2026-10-09","fuera_de_rango":false,"prima_fill":2.05,"prima_salida":1.5,"resultado_usd":-165,"strike":392.5,"symbol":"TSLA"},{"_filas":[{"abierta_at":"2026-10-07T14:00:00Z","abierta_fecha_ny":"2026-10-07","broker":"schwab","cerrada_at":"2026-10-07T18:00:00Z","contratos":1,"direccion":"CALL","estado":"cerrada","expiracion":"2026-10-10","id":10,"prima_fill":2.1,"prima_salida":2.33,"resultado_usd":23,"strike":180,"symbol":"NVDA"},{"abierta_at":"2026-10-07T14:00:00Z","abierta_fecha_ny":"2026-10-07","broker":"schwab","cerrada_at":"2026-10-08T15:00:00Z","contratos":2,"direccion":"CALL","estado":"cerrada","expiracion":"2026-10-10","id":11,"prima_fill":2.1,"prima_salida":2.5,"resultado_usd":80,"strike":180,"symbol":"NVDA"}],"_fuente":"manual","_salida_corte":false,"_tramos":2,"abierta_at":"2026-10-07T14:00:00Z","abierta_fecha_ny":"2026-10-07","broker":"schwab","cerrada_at":"2026-10-08T15:00:00Z","contratos":3,"direccion":"CALL","estado":"cerrada","expiracion":"2026-10-10","fuera_de_rango":false,"id":10,"prima_fill":2.1,"prima_salida":2.4433,"resultado_usd":103,"strike":180,"symbol":"NVDA"},{"_filas":[{"abierta_at":"2026-10-08T14:00:00Z","abierta_fecha_ny":"2026-10-08","broker":"etrade","contratos":3,"direccion":"PUT","estado":"abierta","expiracion":"2026-10-17","id":20,"prima_fill":1,"resultado_usd":null,"strike":660,"symbol":"SPY"},{"abierta_at":"2026-10-08T14:00:00Z","abierta_fecha_ny":"2026-10-08","broker":"etrade","cerrada_at":"2026-10-09T15:00:00Z","contratos":2,"direccion":"PUT","estado":"cerrada","expiracion":"2026-10-17","id":21,"prima_fill":1,"prima_salida":1.72,"resultado_usd":144,"strike":660,"symbol":"SPY"}],"_fuente":"manual","_salida_corte":false,"_tramos":2,"abierta_at":"2026-10-08T14:00:00Z","abierta_fecha_ny":"2026-10-08","broker":"etrade","cerrada_at":null,"contratos":5,"direccion":"PUT","estado":"abierta","expiracion":"2026-10-17","fuera_de_rango":false,"id":20,"prima_fill":1,"prima_salida":null,"resultado_usd":144,"strike":660,"symbol":"SPY"},{"_costo":4,"_fuente":"schwab","_partes":1,"_salida":0,"_salidaN":0,"abierta_at":"2026-10-09T13:45:00Z","abierta_fecha_ny":"2026-10-09","broker":"schwab","cerrada_at":"2026-10-09T19:59:00Z","contratos":1,"direccion":"PUT","entrada_semaforo":null,"estado":"cerrada","expiracion":"2026-10-10","fuera_de_rango":false,"prima_fill":4,"prima_salida":null,"resultado_usd":-400,"strike":700,"symbol":"META"},{"_costo":1.6,"_fuente":"tasty","_partes":1,"_salida":2.6,"_salidaN":2,"abierta_at":"2026-10-09T14:31:00Z","abierta_fecha_ny":"2026-10-09","broker":"tasty","cerrada_at":"2026-10-09T14:50:00Z","contratos":2,"direccion":"CALL","entrada_semaforo":null,"estado":"cerrada","expiracion":"2026-10-09","fuera_de_rango":false,"prima_fill":0.8,"prima_salida":1.3,"resultado_usd":100,"strike":670,"symbol":"SPY"}]};

(async () => {
  // ════════════════ 1. A1 · unirOperaciones: solo AÑADE fees y _partes_filas ════════════════
  {
    const u = K.unirOperaciones(JSON.parse(JSON.stringify(POS_A1)), JSON.parse(JSON.stringify(BT_A1)));
    const sinNuevas = canon(JSON.parse(JSON.stringify(u)));
    sinNuevas.ops.forEach(o => { delete o.fees; delete o._partes_filas; });
    igual(sinNuevas, GOLDEN_V61, 'A1 NO regresión: quitando fees y _partes_filas, la salida es IDÉNTICA a la de la v61 (ops, fusionadas y fuentes; todas las claves)');
    const g = (sym, br) => u.ops.find(o => o.symbol === sym && o.broker === br && o._fuente !== 'manual');
    igual(g('TSLA', 'etrade').fees, 2.6, 'fees: la suma de las comisiones del grupo (1.30 + «1.30» en texto)');
    igual(g('TSLA', 'etrade')._partes_filas.map(t => t.clave_ext), ['e1', 'e2'], '_partes_filas: las filas originales del grupo, ordenadas por abierta_at (10:57 antes que 10:59)');
    igual(g('TSLA', 'moomoo').fees, 0, 'un bróker que manda 0 deja fees en 0');
    igual([g('META', 'schwab').fees, g('SPY', 'tasty').fees], [null, null], 'sin ninguna fila con fees (null o sin campo): fees null, «sin dato» no es $0');
    assert(u.ops.filter(o => o._fuente === 'manual').every(o => !('_partes_filas' in o)), 'las operaciones a mano no ganan _partes_filas (siguen con su _filas de tramos)');
    assert(!/(?<![a-z])_filas: g\./.test(extraer('unirOperaciones')) && /_partes_filas: g\._partes_filas\.slice\(\)/.test(extraer('unirOperaciones')), 'las filas del bróker NO se llaman _filas: cerradasDesde las abriría como tramos y cambiaría Disciplina');
  }

  // ════════════════ 2. A3 · spotDeOperacion (v62 rev: anclada a las idas y vueltas del PROPIO grupo) ════════════════
  {
    const ROW = { broker: 'schwab', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', contratos: 4, prima_fill: 2, prima_salida: 2.5,
      abierta_at: '2026-10-06T14:57:00Z', cerrada_at: '2026-10-06T15:05:00Z', resultado_usd: 200, clave_ext: 's1' };
    const OP = K.unirOperaciones([], [ROW]).ops[0];
    const F = (o) => Object.assign({ broker: 'schwab', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', lado: 'compra', contratos: 1, fecha_ny: '2026-10-06', spot_fuente: 'm1' }, o);
    const fills = [
      F({ ejecutado_at: '2026-10-06T14:57:05Z', spot: 430 }),
      F({ ejecutado_at: '2026-10-06T14:58:30Z', spot: 431, contratos: 3, spot_fuente: 'm15' }),     // a ±2 min de la apertura
      F({ ejecutado_at: '2026-10-06T15:00:00Z', spot: 432 }),                                     // 3 min después de abrir: OTRO lote
      F({ ejecutado_at: '2026-10-06T15:30:00Z', spot: 440, contratos: 2 }),                        // otra compra DESPUÉS del cierre
      F({ ejecutado_at: '2026-10-07T14:57:00Z', fecha_ny: '2026-10-07', spot: 450 }),               // otro día, a la misma hora
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: null }),                                     // sin spot: no entra en la media (sí en n_fills)
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: 500, broker: 'moomoo' }),                    // otro bróker
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: 500, strike: 395 }),                         // otro contrato
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:04:00Z', spot: 432.5 }),
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:05:00Z', spot: 433, contratos: 3, spot_fuente: 'dia' }),
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:02:00Z', spot: 400 }),                       // 3 min antes del cierre
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:08:00Z', spot: 400 }),                       // 3 min después del cierre
      F({ lado: 'vencimiento', ejecutado_at: '2026-10-06T15:05:00Z', spot: 400 }),                 // solo ventas dan la salida
    ];
    const base = (x) => ({ entrada: x.entrada, salida: x.salida, fuente_entrada: x.fuente_entrada, fuente_salida: x.fuente_salida, sin_hora: x.sin_hora });
    const r = K.spotDeOperacion(OP, fills);
    igual(base(r), { entrada: 430.75, salida: 432.875, fuente_entrada: 'm15', fuente_salida: 'dia', sin_hora: false },
      'ANCLADA: entrada = media ponderada de las compras a ±2 min de la apertura (430×1 + 431×3) / 4 = 430.75 (la de 3 min después es otro lote); salida (432.5×1 + 433×3) / 4 = 432.875; la fuente es la PEOR de cada lado');
    igual([r.n_fills, r.por_ventana, r.partes.length], [5, false, 1], 'n_fills = 5 fills que casan (3 compras, una aún sin spot, y 2 ventas); sin respaldo de ventana; una sola ida y vuelta');
    cerca(r.mov, (432.875 - 430.75) / 430.75 * 100, 'mov = el movimiento de la acción de su ida y vuelta (+0.49 %)', 1e-3);
    const sinSpot = K.spotDeOperacion(OP, fills.map(f => ({ ...f, spot: null })));
    igual([sinSpot.entrada, sinSpot.salida, sinSpot.mov, sinSpot.n_fills], [null, null, null, 5], 'sin ningún fill con spot: todo null, y n_fills = 5 (hay fills que el worker completará)');
    igual([K.spotDeOperacion(OP, []).entrada, K.spotDeOperacion(OP, []).n_fills], [null, 0], 'sin fills: null y n_fills 0');
    const otros = K.spotDeOperacion(OP, fills.filter(f => f.broker === 'moomoo' || f.strike === 395));
    igual([otros.entrada, otros.n_fills], [null, 0], 'los fills de OTRO bróker u OTRO contrato no entran ni cuentan');
    igual(K.spotDeOperacion(OP, fills.filter(f => f.lado === 'venta' && f.spot === 400)).salida, null, 'una venta a más de 2 min del cierre (antes o después) no entra');
    igual(K.spotDeOperacion(OP, fills.filter(f => f.spot === 432 || f.spot === 440)).entrada, null, 'una compra a más de 2 min de la apertura (otro lote, o después del cierre) no entra');
    igual(K.spotDeOperacion({ ...OP, strike: null }, fills).entrada, null, 'una operación sin strike no tiene contrato: null');
    // ficha A MANO cuya hora no casa con ningún fill (registrada 5 min tarde): la ventana de antes como respaldo, y se dice
    const MAN = { symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', broker: 'schwab', contratos: 1, abierta_fecha_ny: '2026-10-06', abierta_at: '2026-10-06T15:02:00Z', cerrada_at: '2026-10-06T15:20:00Z' };
    const rm = K.spotDeOperacion(MAN, [F({ ejecutado_at: '2026-10-06T14:57:00Z', spot: 430 }), F({ lado: 'venta', ejecutado_at: '2026-10-06T15:20:00Z', spot: 435 })]);
    igual([rm.entrada, rm.salida, rm.por_ventana, rm.n_fills], [430, 435, true, 2], 'ficha a mano registrada tarde: la compra sale por la ventana del día (respaldo) con por_ventana; la venta casa con su cierre');
    igual(K.spotDeOperacion(OP, [F({ ejecutado_at: '2026-10-06T14:50:00Z', spot: 430 })]).por_ventana, false, 'un grupo del BRÓKER nunca usa la ventana');
    // v62 rev2: fills SIN HORA (FECHAS a medianoche ET, sinHoraIso) —aquí de E*TRADE, pero la regla es por INSTANTE—: se anclan por DÍA y se avisa
    const ROWE = { ...ROW, broker: 'etrade', abierta_at: '2026-10-06T04:00:00Z', cerrada_at: '2026-10-07T04:00:00Z', clave_ext: 'e1' };
    const OPE = K.unirOperaciones([], [ROWE]).ops[0];
    const FE = (o) => F(Object.assign({ broker: 'etrade', ejecutado_at: '2026-10-06T04:00:00Z' }, o));
    const re = K.spotDeOperacion(OPE, [FE({ spot: 429.1 }), FE({ lado: 'venta', spot: 429.1 }), FE({ lado: 'venta', fecha_ny: '2026-10-07', ejecutado_at: '2026-10-07T04:00:00Z', spot: 433 }), FE({ lado: 'venta', fecha_ny: '2026-10-08', ejecutado_at: '2026-10-08T04:00:00Z', spot: 999 })]);
    igual(base(re), { entrada: 429.1, salida: 433, fuente_entrada: 'm1', fuente_salida: 'm1', sin_hora: true }, 'fills sin hora (00:00 NY): compra el día de apertura; venta SOLO el día de cierre (ni la del día de apertura, de otro viaje, ni la del 8); sin_hora para decir «sin hora: cierre del día»');
    igual(K.spotDeOperacion({ symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', broker: null, abierta_at: '2026-10-06T04:00:00Z', cerrada_at: '2026-10-07T04:00:00Z' }, [FE({ spot: 429.1 })]).entrada, 429.1, 'una ficha a mano sin bróker se lee como de E*TRADE (como claveCartera)');
  }

  // ════════════════ 3. A3 · senalDeOperacion ════════════════
  {
    const OP = { symbol: 'TSLA', direccion: 'CALL', abierta_fecha_ny: '2026-10-06', abierta_at: '2026-10-06T14:57:00Z' };
    const S = (estrategia_id, creado_at, o) => Object.assign({ symbol: 'TSLA', direccion: 'CALL', estrategia_id, creado_at, fecha_ny: ymdNY(creado_at) }, o);
    const sen = [
      S('E5', '2026-10-06T13:31:00Z'),
      S('CT15A', '2026-10-06T14:45:00Z', { direccion: null }),        // sin dirección: vale
      S('E1', '2026-10-06T14:50:00Z', { direccion: 'PUT' }),          // otra dirección
      S('E2', '2026-10-06T15:00:00Z'),                                // después de entrar
      S('E5', '2026-10-05T14:00:00Z'),                                // otro día
      S('E5', '2026-10-06T14:55:00Z', { symbol: 'NVDA' }),            // otro símbolo
    ];
    igual(K.senalDeOperacion(OP, sen), { estrategia_id: 'CT15A', hora: '10:45', direccion: null, sin_hora: false }, 'de las que valen, la MÁS RECIENTE antes de entrar (CT15A 10:45; la PUT y la de después no)');
    igual(K.senalDeOperacion(OP, sen.filter(s => s.estrategia_id !== 'CT15A')), { estrategia_id: 'E5', hora: '09:31', direccion: 'CALL', sin_hora: false }, 'sin ella, la E5 de las 9:31 (hora NY)');
    igual(K.senalDeOperacion(OP, [S('E2', '2026-10-06T15:00:00Z')]), null, 'solo una señal DESPUÉS de la entrada: null');
    igual(K.senalDeOperacion(OP, [S('E5', '2026-10-05T14:00:00Z')]), null, 'solo una de OTRO día: null');
    igual(K.senalDeOperacion(OP, [S('E1', '2026-10-06T14:50:00Z', { direccion: 'PUT' })]), null, 'solo una de OTRA dirección: null');
    igual(K.senalDeOperacion(OP, [S('E5', '2026-10-06T14:57:00Z')]).estrategia_id, 'E5', 'creada en el mismo instante de la entrada: cuenta (creado_at ≤ abierta_at)');
    igual(K.senalDeOperacion({ ...OP, symbol: 'tsla' }, [S('E5', '2026-10-06T13:31:00Z', { symbol: 'TSLA' })]).hora, '09:31', 'el símbolo se compara en mayúsculas');
    igual(K.senalDeOperacion({ ...OP, abierta_at: '2026-10-06T04:00:00Z' }, sen), { estrategia_id: 'E2', hora: '11:00', direccion: 'CALL', sin_hora: true }, 'entrada SIN hora (E*TRADE a medianoche): la más reciente de ese día y con sin_hora para decirlo');
    igual([K.senalDeOperacion(null, sen), K.senalDeOperacion({ symbol: 'TSLA' }, sen), K.senalDeOperacion(OP, null)], [null, null, null], 'sin operación, sin hora de apertura o sin señales: null');
  }

  // ════════════════ 4. A3 · dteEntrada ════════════════
  {
    igual([K.dteEntrada({ abierta_fecha_ny: '2026-10-06', expiracion: '2026-10-09' }), K.dteEntrada({ abierta_fecha_ny: '2026-10-09', expiracion: '2026-10-09' }),
      K.dteEntrada({ abierta_at: '2026-10-06T14:57:00Z', expiracion: '2026-10-09' }), K.dteEntrada({ abierta_fecha_ny: '2026-10-06', expiracion: null }),
      K.dteEntrada({ abierta_fecha_ny: '2026-10-10', expiracion: '2026-10-09' }), K.dteEntrada(null)], [3, 0, 3, null, null, null],
    'DTE al entrar: 3 días naturales; 0 el día del vencimiento (0DTE); del abierta_at en NY si falta la fecha; sin expiración, o vencida antes de entrar, o sin operación → null');
  }

  // ════════════════ 5. A3 · metricasCuentas (y su coherencia con resumenPeriodo) ════════════════
  {
    const ops = K.unirOperaciones(POS_A1, BT_A1).ops;
    const R = K.resumenPeriodo(ops, '2026-10-01');
    const M = K.metricasCuentas(R.ops, '2026-10-01');
    igual([M.util, M.n, M.con_resultado, M.ganadoras, M.perdedoras, M.winrate], [-113.2, 8, 8, 5, 3, 63], 'utilidad neta −$113.20, 8 operaciones, 5 en verde y 3 en rojo, 63 % de aciertos');
    igual([M.ganancia_bruta, M.perdida_bruta, M.gan_media, M.perd_media, M.factor], [751.8, -865, 150.36, -288.33, 0.87], 'ganancia bruta $751.80 y pérdida bruta −$865; media por ganadora $150.36 y por perdedora −$288.33; factor de beneficio 751.8 / 865 = 0.87');
    igual([M.capital, M.rentabilidad, M.comisiones], [3225, -3.51, 5.2], 'capital usado Σ prima × contratos × 100 = $3,225; rentabilidad −3.51 %; comisiones 2.6 + 2.6 + 0 = $5.20 (las sin dato no suman)');
    igual([M.mejor, M.peor, M.racha], [337.4, -400, { tipo: 'perdedoras', n: 1 }], 'mejor $337.40, peor −$400; racha: la última por fecha de cierre (META −$400) es una perdedora y la anterior ganó');
    igual(M.por_activo.map(x => [x.clave, x.ops, x.aciertos, x.utilidad, x.capital, x.rentabilidad]),
      [['NVDA', 2, 100, 440.4, 1130, 38.97], ['SPY', 2, 100, 244, 360, 67.78], ['TSLA', 2, 50, -97.6, 1035, -9.43], ['AAPL', 1, 0, -300, 300, -100], ['META', 1, 0, -400, 400, -100]],
      'por activo: ops, aciertos %, utilidad, capital y rentabilidad, ordenado por utilidad');
    igual(M.por_broker.map(x => [x.clave, x.ops, x.aciertos, x.utilidad, x.rentabilidad]),
      [['etrade', 3, 100, 548.8, 49], ['tasty', 1, 100, 100, 62.5], ['moomoo', 1, 0, -165, -26.83], ['schwab', 2, 50, -297, -28.83], ['manual', 1, 0, -300, -100]],
      'por bróker (la ficha a mano sin bróker va como «manual»), ordenado por utilidad');
    igual([M.util, M.n, M.winrate, M.mejor, M.peor], [R.util, R.n, R.winrate, R.mejor, R.peor], 'COHERENTE con resumenPeriodo sobre los mismos datos: utilidad, n, % de aciertos, mejor y peor');
    // un corte a mitad de un cierre parcial: cada operación aporta solo lo que cerró EN el período, como resumenPeriodo
    const R2 = K.resumenPeriodo(ops, '2026-10-08'), M2 = K.metricasCuentas(R2.ops, '2026-10-08');
    igual([M2.util, M2.n, M2.winrate, M2.mejor, M2.peor], [R2.util, R2.n, R2.winrate, R2.mejor, R2.peor], 'coherente también cortando a mitad del cierre parcial de NVDA (desde el 8 de octubre)');
    igual([M2.util, M2.n, M2.capital], [-76, 4, 1180], 'y de NVDA solo cuenta el tramo del 8 ($80 sobre $420 de capital: 420 + 200 + 400 + 160)');
    // un resultado nulo cuenta en n pero no en los aciertos, igual que en resumenPeriodo
    const nulas = [{ estado: 'cerrada', cerrada_at: '2026-10-06T18:00:00Z', resultado_usd: 150, symbol: 'X', prima_fill: 1, contratos: 1 },
      { estado: 'cerrada', cerrada_at: '2026-10-07T18:00:00Z', resultado_usd: null, symbol: 'X', prima_fill: 1, contratos: 1 }];
    const M3 = K.metricasCuentas(nulas, '2026-10-01'), R3 = K.resumenPeriodo(nulas, '2026-10-01');
    igual([M3.n, M3.winrate, M3.factor, M3.racha, M3.comisiones], [R3.n, R3.winrate, null, { tipo: 'ganadoras', n: 1 }, null], 'una operación sin resultado cuenta en n pero no en los aciertos; sin pérdidas, factor null; sin fees, comisiones null');
    const M4 = K.metricasCuentas([], '2026-10-01');
    igual([M4.util, M4.n, M4.winrate, M4.mejor, M4.peor, M4.rentabilidad, M4.racha, M4.por_activo], [0, 0, 0, null, null, null, { tipo: null, n: 0 }, []], 'sin operaciones: todo en cero o null, sin inventar nada');
    const racha = K.metricasCuentas([10, 20, -5, 30, 40, 50].map((r, i) => ({ estado: 'cerrada', cerrada_at: `2026-10-0${i + 1}T18:00:00Z`, resultado_usd: r, symbol: 'X' })), '2026-10-01').racha;
    igual(racha, { tipo: 'ganadoras', n: 3 }, 'racha: 3 ganadoras seguidas hasta la última (la −5 la cortó)');
  }

  // ════════════════ 6. B · la tarjeta y la fila de la tabla dicen CADA dato ════════════════
  const BT_B = [
    { broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 432.5, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.00, prima_salida: 2.30,
      abierta_at: '2026-10-06T14:57:00Z', cerrada_at: '2026-10-06T15:02:00Z', resultado_usd: 28.70, fees: 1.30, clave_ext: 'a' },
    { broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 432.5, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.20, prima_salida: 2.60,
      abierta_at: '2026-10-06T14:59:00Z', cerrada_at: '2026-10-06T15:05:00Z', resultado_usd: 38.70, fees: 1.30, clave_ext: 'b' },
  ];
  const FILL = (lado, at, spot, o) => Object.assign({ broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 432.5, expiracion: '2026-10-09', lado, contratos: 1, ejecutado_at: at, fecha_ny: '2026-10-06', spot, spot_fuente: 'm1' }, o);
  const FILLS_B = [FILL('compra', '2026-10-06T14:57:00Z', 430), FILL('compra', '2026-10-06T14:59:00Z', 431), FILL('venta', '2026-10-06T15:02:00Z', 431.5), FILL('venta', '2026-10-06T15:05:00Z', 432.5)];
  const SEN_B = [{ symbol: 'TSLA', direccion: 'CALL', estrategia_id: 'E5', creado_at: '2026-10-06T13:31:00Z', fecha_ny: '2026-10-06' }];
  const OPB = K.unirOperaciones([], BT_B).ops[0];
  const CTX = { fills: FILLS_B, senales: SEN_B, errFills: null, errSen: null };
  {
    const t = K.tarjetaHistorial(OPB, CTX), f = K.filaHistorialCuentas(OPB, CTX);
    const datos = [
      ['contrato', /TSLA CALL 432\.5/], ['expiración y DTE', /exp 9 oct · 3 DTE/], ['×contratos', /×2|>2</], ['P&L neto', /\$67\.40/], ['% neto', /\+16\.0%/],
      ['comisión', /\$2\.60/], ['bruto (hay comisión)', /bruto \$70\.00/], ['costo', /\$420\.00/], ['venta', /\$490\.00/],
      ['acción entrada → salida y su %', /\$430\.50 → \$432\.00 \(\+0\.35 %\)/], ['contrato vs acción', /\+16\.0 % con la acción \+0\.35 %/],
      ['strike vs acción al entrar', /432\.5: \+\$2\.00 \(\+0\.46 %\) fuera del dinero/], ['señal', /señal E5 · 09:31/],
      ['desglose plegable (con su clave estable data-k)', /<details class="ctram" data-k="tasty\|TSLA\|CALL\|432\.5\|2026-10-09\|2026-10-06\|\d+"><summary>2 idas y vueltas · ver el desglose<\/summary>/], ['tramo 1', /10:57 → 11:02[\s\S]*?\$2\.00 → \$2\.30[\s\S]*?\$28\.70/],
      ['tramo 2', /10:59 → 11:05[\s\S]*?\$2\.20 → \$2\.60[\s\S]*?\$38\.70/],
    ];
    datos.forEach(([q, re]) => assert(re.test(t), 'TARJETA: ' + q, (t.match(re) ? '' : t.replace(/\s+/g, ' ').slice(0, 300))));
    datos.forEach(([q, re]) => assert(re.test(f), 'FILA de la tabla: ' + q));
    assert(/entrada<\/span><b>6 oct 10:57 · \$2\.10<\/b>/.test(t) && /salida<\/span><b>11:05 · \$2\.45<\/b>/.test(t) && /duración<\/span><b>8 min<\/b>/.test(t), 'TARJETA: entrada con fecha, hora NY y prima; salida con hora y prima; duración');
    assert(/×2<\/span><b>tasty<\/b>/.test(t), 'TARJETA: ×contratos y bróker');
    igual((f.match(/<tr class="crow">[\s\S]*?<\/tr>/)[0].match(/<td/g) || []).length, 15, 'FILA: 15 celdas, una por columna');
    assert(/<td>6 oct<\/td>/.test(f) && /<td>10:57<span class="csub">\$2\.10<\/span><\/td>/.test(f) && /<td>11:05<span class="csub">\$2\.45<\/span><\/td>/.test(f) && /<td>8 min<\/td>/.test(f) && /<td>tasty<\/td>/.test(f), 'FILA: fecha, entrada (hora y debajo la prima), salida (hora y prima), duración y bróker en sus columnas');
    assert(/<tr class="cdet"><td colspan="15">/.test(f), 'FILA: el desglose va en una fila de detalle que ocupa las 15 columnas');
    // sin datos: «sin dato aún», «sin señal ese día», sin «bruto» sin comisión
    const sola = K.unirOperaciones([], [{ ...BT_B[0], broker: 'schwab', fees: 0 }]).ops[0];
    const t2 = K.tarjetaHistorial(sola, { fills: [], senales: [] }), f2 = K.filaHistorialCuentas(sola, { fills: [], senales: [] });
    [t2, f2].forEach((h, i) => {
      const q = i ? 'FILA' : 'TARJETA';
      assert(/sin fills en el libro para esta operación/.test(h) && !/el worker lo completa/.test(h), q + ': sin NINGÚN fill en el libro, «sin fills en el libro para esta operación» (v62 rev: no se promete lo que el worker no puede completar)');
      assert(/sin señal CALL ese día/.test(h), q + ': sin señal, «sin señal CALL ese día» (con la dirección)');
      assert(!/bruto/.test(h), q + ': sin comisión (Schwab manda 0), NO se dice «bruto»');
      assert(!/<details/.test(h), q + ': una sola ida y vuelta: sin desglose');
    });
    assert(/exp 9 oct · 3 DTE/.test(t2) && /acción: sin dato/.test(t2), 'TARJETA: el contrato y «contrato vs acción» con «acción: sin dato»');
    // la señal que hubo DESPUÉS de entrar: no se dice «sin señal ese día» (sería falso)
    const t3 = K.tarjetaHistorial(sola, { fills: [], senales: [{ symbol: 'TSLA', direccion: 'CALL', estrategia_id: 'E2', creado_at: '2026-10-06T15:30:00Z', fecha_ny: '2026-10-06' }] });
    assert(/sin señal antes de entrar \(hubo E2 a las 11:30, después\)/.test(t3) && !/sin señal ese día/.test(t3), 'con una señal solo DESPUÉS de entrar: «sin señal antes de entrar (hubo E2 a las 11:30, después)»');
    // lecturas caídas
    const t4 = K.tarjetaHistorial(OPB, { fills: [], senales: [], errFills: 'la tabla fills aún no está', errSen: 'sin red' }), f4 = K.filaHistorialCuentas(OPB, { errFills: 'x', errSen: 'y' });
    assert(/acción: sin dato/.test(t4) && /señal: no se pudo leer/.test(t4) && /acción: sin dato/.test(f4) && /señal: no se pudo leer/.test(f4), 'con la lectura de fills o de señales caída: «acción: sin dato» y «señal: no se pudo leer» (tarjeta y fila)');
    // acción plana, fuente a la vista, E*TRADE sin hora, expirada
    const plano = K.tarjetaHistorial(OPB, { fills: FILLS_B.map(x => ({ ...x, spot: 430, spot_fuente: 'm15' })), senales: [] });
    assert(/\$430\.00 → \$430\.00 \(0\.00 %\) <span class="fresco">\(15 min\)<\/span>/.test(plano) && /\+16\.0 % · acción plana/.test(plano), 'acción quieta (< 0,05 %): «acción plana»; la fuente va a la vista: «(15 min)»');
    const opE = { ...OPB, broker: 'etrade', abierta_at: '2026-10-06T04:00:00Z', cerrada_at: '2026-10-06T04:00:00Z', abierta_fecha_ny: '2026-10-06' };
    const fE = FILLS_B.map(x => ({ ...x, broker: 'etrade', ejecutado_at: '2026-10-06T04:00:00Z', spot: 429 }));
    const tE = K.tarjetaHistorial(opE, { fills: fE, senales: [] });
    assert(/el bróker no dio la hora: precio de cierre del día, no del fill/.test(tE) && /\(sin hora: cierre del día\)/.test(tE) && !/E\*TRADE no da/.test(tE), 'fills SIN HORA (00:00 NY): la acción dice que el bróker no dio la hora y que es el precio de CIERRE del día, no del fill (sin nombrar a E*TRADE)');
    assert(/entrada<\/span><b>6 oct · \$2\.10<\/b>/.test(tE) && /duración<\/span><b>mismo día<\/b>/.test(tE) && !/00:00/.test(tE), 'entrada sin hora: solo la fecha (nunca «00:00») y la duración en días («mismo día»)');
    assert(/sin hora/.test(K.filaHistorialCuentas(opE, { fills: fE, senales: [] })), 'y en la fila, «sin hora» en la columna Entrada');
    const exp = K.tarjetaHistorial({ symbol: 'SPY', direccion: 'PUT', strike: 660, expiracion: '2026-10-08', contratos: 1, prima_fill: 1, prima_salida: 0, estado: 'expirada', broker: 'etrade', abierta_at: '2026-10-06T14:00:00Z', abierta_fecha_ny: '2026-10-06', cerrada_at: '2026-10-08T20:00:00Z', resultado_usd: -100 }, { fills: [], senales: [] });
    assert(/salida<\/span><b><span style="color:var\(--oro\)">expiró<\/span><\/b>/.test(exp) && /exp 8 oct · 2 DTE/.test(exp), 'una expirada dice «expiró» en la salida');
    assert(/tramo cobrado · la posición sigue abierta con el resto/.test(K.tarjetaHistorial({ ...POS_A1[4], _tramoAbierta: true }, CTX)) && /tramo cobrado/.test(K.filaHistorialCuentas({ ...POS_A1[4], _tramoAbierta: true }, CTX)), 'el aviso del tramo cobrado de una abierta se conserva (tarjeta y fila)');
    assert(/0DTE/.test(K.tarjetaHistorial({ ...OPB, expiracion: '2026-10-06' }, CTX)), 'vence el día de entrada: «0DTE»');
  }

  // ════════════════ 7. C2/C3 · tiles, desglose, historial y «ver más» ════════════════
  {
    const ops = K.unirOperaciones(POS_A1, BT_A1).ops;
    const M = K.metricasCuentas(K.resumenPeriodo(ops, '2026-10-01').ops, '2026-10-01');
    const tl = K.tilesCuentasHtml(M, 'semana');
    igual((tl.match(/class="dcard"/g) || []).length, 8, 'ocho tiles');
    ['UTILIDAD · SEMANA', 'OPERACIONES Y ACIERTOS', 'GANANCIA / PÉRDIDA MEDIA', 'FACTOR DE BENEFICIO', 'CAPITAL Y RENTABILIDAD', 'COMISIONES', 'MEJOR / PEOR', 'RACHA'].forEach(l => assert(tl.includes(l), 'tile ' + l));
    assert(/-\$113/.test(tl) && /8 ops/.test(tl) && /63% aciertos/.test(tl) && /0\.87/.test(tl) && /-3\.51%/.test(tl) && /\$5\.20/.test(tl) && /\$337/.test(tl) && /-\$400/.test(tl) && />1<\/div><div class="sb">perdedora seguida hasta la última cerrada/.test(tl), 'los tiles dicen utilidad, ops, aciertos, factor, rentabilidad, comisiones, mejor/peor y la racha (en singular)');
    assert(/UTILIDAD · HOY/.test(K.tilesCuentasHtml(M, 'dia')), 'con «Hoy» el tile dice UTILIDAD · HOY');
    const dg = K.tablasDesgloseCuentasHtml(M);
    assert(/<div class="ctados">/.test(dg) && /POR ACTIVO/.test(dg) && /POR BRÓKER/.test(dg) && /<th>Ops<\/th><th>Aciertos<\/th><th>Utilidad<\/th><th>Rentab\.<\/th>/.test(dg) && /<b>NVDA<\/b><\/td><td>2<\/td><td>100%<\/td>/.test(dg) && /<b>E\*TRADE<\/b>/.test(dg) && /<b>a mano<\/b>/.test(dg), 'POR ACTIVO y POR BRÓKER: ops · aciertos · utilidad · rentabilidad');
    // 450 operaciones: de 200 en 200
    const muchas = Array.from({ length: 450 }, (_, i) => ({ ...OPB, strike: 300 + i, _partes_filas: null }));
    const h1 = K.seccionHistorialCuentas(muchas, CTX, 200, 'tabla');
    igual([(h1.match(/<tr class="crow">/g) || []).length, /Se muestran 200 de 450/.test(h1), /MZ\.ctaVerMas\(\)/.test(h1)], [200, true, true], 'tabla: 200 filas, «Se muestran 200 de 450» y el botón «ver más»');
    igual((h1.match(/<thead><tr>[\s\S]*?<\/tr><\/thead>/)[0].match(/<th[ >]/g) || []).length, 15, 'la cabecera de la tabla tiene 15 columnas');
    const h2 = K.seccionHistorialCuentas(muchas, CTX, 400, 'tarjetas');
    igual([(h2.match(/<div class="card">/g) || []).length, /Se muestran 400 de 450/.test(h2), /ver más \(50\)/.test(h2)], [400, true, true], 'tarjetas con tope 400: 400 tarjetas y «ver más (50)»');
    const h3 = K.seccionHistorialCuentas(muchas, CTX, 600, 'tabla');
    igual([(h3.match(/<tr class="crow">/g) || []).length, /ctaVerMas/.test(h3)], [450, false], 'con todas a la vista, sin botón');
    assert(/Aún no hay operaciones cerradas/.test(K.seccionHistorialCuentas([], CTX, 200, 'tabla')), 'sin operaciones: el vacío de siempre');
    // ctaVerMas: suma 200 y repinta SOLO el historial con lo ya leído (nada se relee)
    const nodoHist = nodo();
    const V = cuentas({ $: (s) => (s === '#ctaHist' ? nodoHist : null) });
    Object.assign(V._cta, { cerradas: muchas, ctx: CTX, formato: 'tabla', tope: 200 });
    V.ctaVerMas();
    igual([V._cta.tope, (nodoHist.innerHTML.match(/<tr class="crow">/g) || []).length, /Se muestran 400 de 450/.test(nodoHist.innerHTML)], [400, 400, true], 'ctaVerMas: tope 400 y el historial repintado en #ctaHist con 400 filas');
    V.ctaVerMas();
    igual([V._cta.tope, (nodoHist.innerHTML.match(/<tr class="crow">/g) || []).length], [600, 450], 'otra vez: las 450');
    let nada = true; try { cuentas().ctaVerMas(); } catch (_) { nada = false; }
    assert(nada, 'ctaVerMas sin #ctaHist (otra vista) no revienta');
    // ctaCambiaFormato: solo con la vista Cuentas y solo al cruzar los 900 px
    const Fm = (vista, ancho, formato) => { const X = cuentas({ vista, anchoVista: () => ancho }); X._cta.formato = formato; return X.ctaCambiaFormato(); };
    igual([Fm('cuentas', 1400, 'tabla'), Fm('cuentas', 390, 'tabla'), Fm('cuentas', 1000, 'tarjetas'), Fm('diario', 390, 'tabla'), Fm('cuentas', 390, null)], [false, true, true, false, false],
      'resize: se redibuja solo si la vista Cuentas cruza los 900 px (tabla ↔ tarjetas); el Diario no');
  }

  // ════════════════ 8. C1 · el envoltorio ancho (#app.ancho + #app.cta), ruta() y el CSS ════════════════
  {
    const clases = new Set();
    const app = { classList: { toggle: (c, on) => { if (on) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c) } };
    const A = cuentas({ $: (s) => (s === '#app' ? app : null) });
    A.cuentasAncho(true);
    igual([...clases].sort(), ['ancho', 'cta'], 'cuentasAncho(true): #app.ancho (1180 px) y #app.cta');
    A.cuentasAncho(false);
    igual([...clases].sort(), ['ancho'], 'cuentasAncho(false) solo quita .cta (el ancho lo gobierna diarioAncho)');
    let ok2 = true; try { cuentas({ $: () => null }).cuentasAncho(true); } catch (_) { ok2 = false; }
    assert(ok2, 'cuentasAncho sin #app no revienta');
    const vc = extraer('vistaCuentas');
    assert(/diarioAncho\(_cuentasVista === 'diario'\);\s*cuentasAncho\(_cuentasVista === 'cuentas'\);/.test(vc), 'vistaCuentas enciende el ancho también en la vista Cuentas');
    assert(/if \(tab !== 'cuentas' && typeof cuentasAncho === 'function'\) cuentasAncho\(false\);/.test(extraer('ruta')), 'ruta() quita .cta al salir de la pestaña');
    assert(/if \(_cuentasVista === 'diario'\) vistaDiario\(true\); else vistaCuentas\(\); \},/.test(FUENTE) && !/cuentasVista: \(v\) => \{[^\n]*cuentasAncho\(/.test(FUENTE), 'MZ.cuentasVista (v62 rev): al pasar al Diario NO quita .cta (la vista Cuentas sigue en pantalla mientras el Diario lee; sin salto)');
    assert(/\(tab === 'cuentas' && ctaCambiaFormato\(\)\)\) ruta\(\);/.test(FUENTE), 'el handler de resize redibuja Cuentas si cambia de formato');
    assert(/ctaVerMas,/.test(FUENTE.slice(FUENTE.indexOf("periodo: (k) => { _periodoSel = k; vistaCuentas(); },"))), 'MZ.ctaVerMas cuelga de window.MZ');
    assert(/@media \(min-width:900px\)\{\s*#app\.cta \.ctabrk\{grid-template-columns:repeat\(auto-fit,minmax\(240px,1fr\)\)\}/.test(INDEX), 'CSS: brókeres en rejilla auto-fit minmax(240px,1fr) desde 900 px');
    assert(/#app\.cta \.ctados\{grid-template-columns:1fr 1fr/.test(INDEX) && /\.ctabrk,\.ctados\{display:grid;grid-template-columns:1fr;/.test(INDEX), 'CSS: «por activo» y «por bróker» lado a lado en la computadora y apilados en el teléfono');
    assert(/\.ctbl th\{position:sticky;top:0;/.test(INDEX) && /\.ctabla\{[^}]*overflow:auto;max-height:calc\(100dvh - 110px\)/.test(INDEX), 'CSS: el encabezado de la tabla queda fijo al desplazar (sticky dentro de su panel de casi toda la altura, que se desplaza de lado si no cabe)');
    assert(/#app\.cta \.ctav \.dcards\{grid-template-columns:repeat\(auto-fill,minmax\(128px,1fr\)\)\}/.test(INDEX) && /\.dcards\{display:grid;grid-template-columns:1fr 1fr/.test(INDEX), 'CSS: los tiles en una fila en la computadora y a 2 columnas en el teléfono');
    assert(/\.ctram summary\{/.test(INDEX), 'CSS: el desglose plegable (details/summary)');
  }

  // ════════════════ 9. vistaCuentasSaldos REAL (módulo entero): tabla en ancho, tarjetas en el teléfono, lecturas caídas ════════════════
  {
    const BT_V = BT_A1.concat(BT_B);
    async function correr(ancho, op) {
      op = op || {};
      const llamadas = [];
      const sb = C.sbFalso((tabla, cadena) => {
        llamadas.push({ tabla, cadena });
        if (tabla === 'broker_trades') return { data: JSON.parse(JSON.stringify(BT_V)), error: null };
        if (tabla === 'posiciones') return { data: JSON.parse(JSON.stringify(POS_A1)), error: null };
        if (tabla === 'fills') {
          if (op.fillsLanza) throw new Error('sin red');
          if (op.fillsError) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.fills' } };
          return { data: FILLS_B, error: null };
        }
        if (tabla === 'senales') return op.senError ? { data: null, error: { message: 'timeout' } } : { data: SEN_B, error: null };
        return { data: [], error: null };
      });
      const canal = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
      const mod = C.cargarModuloEntero({ src: './app/main.js?v=64', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
      if (!mod.cargo) return { error: mod.error };
      mod.win.innerWidth = ancho;
      let html = '';
      // op.panel: el panel .ctabla de #ctaHist; pintar #vista lo «crea de nuevo» (scroll a 0), como el navegador
      const hist = op.panel ? nodo({ querySelector: (s) => (s === '.ctabla' ? op.panel : null), querySelectorAll: () => [] }) : nodo();
      mod.win.document.querySelector = (s) => { if (s === '#ctaHist') return hist; const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; if (op.panel) { op.panel.scrollTop = 0; op.panel.scrollLeft = 0; } }, get() { return html; } }); return n; };
      mod.ev("location.hash = '#/cuentas'; _cuentasVista = 'cuentas'; _periodoSel = 'semana';");
      let revento = null;
      try { await mod.ev('vistaCuentasSaldos()'); } catch (e) { revento = String((e && e.stack) || e); }
      await respirar();
      return { html, revento, llamadas, mod, hist };
    }
    const W = await correr(1400);
    assert(!W.error && !W.revento, 'vistaCuentasSaldos corre entera en el DOM de juguete a 1400 px', W.error || W.revento);
    const thead = (W.html.match(/<table class="ctbl"><thead><tr>([\s\S]*?)<\/tr><\/thead>/) || [])[1] || '';
    igual((thead.match(/<th/g) || []).length, 15, 'a 1400 px: el HISTORIAL es una TABLA con la cabecera de 15 columnas');
    igual(thead.replace(/<small>[^<]*<\/small>/g, '').match(/>([^<]+)<\/th>/g).map(x => x.slice(1, -5)), ['Fecha', 'Contrato', 'Bróker', '×', 'Entrada', 'Salida', 'Duración', 'Costo', 'Venta', 'Comisión', 'P&amp;L $', '%', 'Acción', 'Strike vs acción', 'Señal'], 'las columnas en el orden de la especificación');
    assert(/<div class="ctav">/.test(W.html) && /<div class="ctabrk">/.test(W.html) && /class="dcards"/.test(W.html) && /<div class="ctados">/.test(W.html) && /id="ctaHist"/.test(W.html), 'la vista lleva su envoltorio, la rejilla de brókeres, los tiles, las dos tablas y el historial');
    assert(/UTILIDAD · SEMANA/.test(W.html) && /<button class="perbtn on" onclick="MZ\.periodo\('semana'\)">Semana<\/button>/.test(W.html), 'el selector de período y el tile UTILIDAD · SEMANA siguen');
    assert(/\$430\.50 → \$432\.00 \(\+0\.35 %\)/.test(W.html) && /señal E5 · 09:31/.test(W.html), 'la fila de TSLA 432.5 lleva la acción (del libro de fills) y la señal (de senales)');
    const sel = W.llamadas.find(l => l.tabla === 'senales');
    assert(sel && JSON.stringify(sel.cadena[0]) === '["select",["id,symbol,estrategia_id,direccion,fecha_ny,creado_at"]]' && sel.cadena.some(c => c[0] === 'gte' && c[1][0] === 'fecha_ny' && c[1][1] === '2026-10-01') && sel.cadena.some(c => c[0] === 'range'),
      'señales: solo las columnas necesarias, desde la operación más antigua (1 de octubre), paginadas');
    assert(W.llamadas.some(l => l.tabla === 'fills' && l.cadena.some(c => c[0] === 'range')), 'fills: el lector paginado del Diario (leerFillsTodos)');
    assert(!W.llamadas.some(l => l.cadena.some(c => ['insert', 'update', 'upsert', 'delete'].includes(c[0]))), 'la vista solo LEE: nada se escribe en la base');
    igual(W.mod.ev('_cta.formato'), 'tabla', 'y deja anotado el formato (para el resize)');
    W.mod.ev('_cta.tope = 200; ctaVerMas()');
    assert(W.mod.ev('_cta.tope') === 400 && /<table class="ctbl">/.test(W.hist.innerHTML), 'ctaVerMas en el módulo real repinta #ctaHist con lo ya leído');
    const T = await correr(390);
    assert(!T.revento && !/<table class="ctbl">/.test(T.html) && /<div class="hist">/.test(T.html) && /señal E5 · 09:31/.test(T.html), 'a 390 px: el historial en TARJETAS (sin la tabla), con el mismo detalle');
    igual(T.mod.ev('_cta.formato'), 'tarjetas', 'formato tarjetas anotado');
    const E1 = await correr(1400, { fillsError: true, senError: true });
    assert(!E1.revento && /HISTORIAL DE OPERACIONES · /.test(E1.html) && /acción: sin dato/.test(E1.html) && /señal: no se pudo leer/.test(E1.html), 'con fills y señales devolviendo error: la vista sale entera y dice «acción: sin dato» y «señal: no se pudo leer»');
    assert(/la tabla fills aún no está en la base \(migración pendiente\)/.test(E1.html), 'y el pie dice por qué (el texto de textoErrorTabla)');
    const E2 = await correr(1400, { fillsLanza: true });
    assert(!E2.revento && /acción: sin dato/.test(E2.html) && /señal E5 · 09:31/.test(E2.html), 'si la lectura de fills REVIENTA (excepción), la vista sale igual; las señales siguen');
    const Z = await correr(1400);
    Z.mod.ev("location.hash = '#/copiloto';");
    let pintado = false;
    Z.mod.win.document.querySelector = (s) => { const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set() { pintado = true; }, get() { return ''; } }); return n; };
    await Z.mod.ev('vistaCuentasSaldos()');
    assert(!pintado, 'si mientras cargaba se cambió de pestaña, no pinta encima de lo que hay ahora');
    // v62 rev (arreglo 9) con el módulo real: el repintado devuelve el scroll del panel de la tabla
    const panel = { scrollTop: 8000, scrollLeft: 25 };
    const P = await correr(1400, { panel });
    igual([P.revento, panel.scrollTop, panel.scrollLeft], [null, 8000, 25], '(arreglo 9) vistaCuentasSaldos real: tras reemplazar #vista el panel vuelve a la fila donde estaba Andrés (8000 px), no a la 1');
    // v62 rev (arreglo 13) al pasar al Diario no se quita .cta en el mismo tick; (arreglo 12) el tope vuelve a 200 solo al ENTRAR
    {
      const M2 = W.mod;
      const clases = new Set(['ancho', 'cta']);
      const app = nodo({ classList: { toggle: (c, on) => { if (on) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } });
      M2.win.document.querySelector = (s) => (s === '#app' ? app : nodo());
      M2.ev("location.hash = '#/cuentas'; _cuentasVista = 'cuentas'; window.__diario = 0; window.__saldos = 0; vistaDiario = () => { window.__diario++; return Promise.resolve(); }; vistaCuentasSaldos = () => { window.__saldos++; return Promise.resolve(); };");
      M2.ev("MZ.cuentasVista('diario')");
      assert(clases.has('cta') && clases.has('ancho') && M2.ev('window.__diario') === 1, '(arreglo 13) MZ.cuentasVista(«diario»): .cta se queda mientras el Diario lee (la vista Cuentas no salta de rejilla a columna)');
      M2.ev('vistaCuentas()');
      assert(!clases.has('cta') && clases.has('ancho') && M2.ev('window.__diario') === 2, '(arreglo 13) la quita el siguiente vistaCuentas, con el Diario a la vista (donde .cta no toca nada)');
      M2.ev("_cta.tope = 600; MZ.cuentasVista('cuentas')");
      igual([M2.ev('_cta.tope'), M2.ev('_cta.dentro'), clases.has('cta'), M2.ev('window.__saldos')], [200, true, true, 1], '(arreglo 12) al ENTRAR en la vista Cuentas el historial vuelve a las primeras 200');
      M2.ev("_cta.tope = 600; vistaCuentas(); MZ.periodo('mes');");
      igual([M2.ev('_cta.tope'), M2.ev('window.__saldos')], [600, 3], '(arreglo 12) el repintado automático y el cambio de período conservan las 600 que Andrés abrió');
      M2.ev("_cta.dentro = false; vistaCuentas();");
      igual(M2.ev('_cta.tope'), 200, '(arreglo 12) tras salir de la pestaña (ruta pone dentro = false) y volver: 200');
      assert(/if \(tab !== 'cuentas' && typeof _cta === 'object' && _cta\) _cta\.dentro = false;/.test(extraer('ruta')), '(arreglo 12) ruta() marca la salida de la pestaña');
    }
  }

  // ════════════════ 10. v62 rev · los arreglos de la revisión, con las funciones REALES ════════════════
  // (arreglo 1) spotDeOperacion ya no mezcla fills de OTRAS operaciones: casos (1) a (4) de la revisión
  {
    const base = { broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-16' };
    const F = (lado, at, spot, o) => Object.assign({ ...base, lado, contratos: 1, ejecutado_at: at, fecha_ny: ymdNY(at), spot, spot_fuente: 'm1' }, o);
    // (1) un viaje de un día para otro (lun 15:00 ET → mar 14:00 ET) y otro viaje el martes (10:00 → 10:30) del mismo contrato
    const BT = [
      { ...base, contratos: 1, prima_fill: 3.00, prima_salida: 4.00, abierta_at: '2026-10-05T19:00:00Z', cerrada_at: '2026-10-06T18:00:00Z', resultado_usd: 98.7, fees: 1.3, clave_ext: 'A' },
      { ...base, contratos: 1, prima_fill: 5.00, prima_salida: 6.00, abierta_at: '2026-10-06T14:00:00Z', cerrada_at: '2026-10-06T14:30:00Z', resultado_usd: 98.7, fees: 1.3, clave_ext: 'B' },
    ];
    const FILLS = [F('compra', '2026-10-05T19:00:00Z', 430), F('venta', '2026-10-06T18:00:00Z', 450), F('compra', '2026-10-06T14:00:00Z', 440), F('venta', '2026-10-06T14:30:00Z', 400)];
    const ops = K.unirOperaciones([], BT).ops;
    const A = ops.find(o => o.abierta_fecha_ny === '2026-10-05'), B = ops.find(o => o.abierta_fecha_ny === '2026-10-06');
    const sA = K.spotDeOperacion(A, FILLS), sB = K.spotDeOperacion(B, FILLS);
    igual([sA.entrada, sA.salida, sB.entrada, sB.salida], [430, 450, 440, 400], '(1) de un día para otro: A = 430 → 450 (la venta de B a 400 ya no entra en A); B = 440 → 400');
    const accA = K.accionOpCuentas(A, K.detalleOpCuentas(A, { fills: FILLS, senales: [] }));
    assert(/\$430\.00 → \$450\.00 \(\+4\.65 %\)/.test(accA.accion) && /\+32\.9 % con la acción \+4\.65 %/.test(accA.vs), '(1) la tarjeta dice que la acción SUBIÓ +4.65 % (antes «-1.16 %», con el signo cambiado)', accA.accion + ' | ' + accA.vs);
    // (2) los tramos cobrados de una abierta ×3: ×1 vendido a las 10:30 (665) y ×1 a las 11:00 (650)
    const b2 = { broker: 'tasty', symbol: 'SPY', direccion: 'PUT', strike: 660, expiracion: '2026-10-16', abierta_at: '2026-10-06T14:00:00Z', abierta_fecha_ny: '2026-10-06', prima_fill: 1 };
    const pos = [{ ...b2, id: 1, contratos: 1, estado: 'abierta' }, { ...b2, id: 2, contratos: 1, estado: 'cerrada', cerrada_at: '2026-10-06T14:30:00Z', prima_salida: 1.5, resultado_usd: 50 },
      { ...b2, id: 3, contratos: 1, estado: 'cerrada', cerrada_at: '2026-10-06T15:00:00Z', prima_salida: 2, resultado_usd: 100 }];
    const F2 = (lado, at, spot, c) => ({ ...b2, lado, contratos: c, ejecutado_at: at, fecha_ny: ymdNY(at), spot, spot_fuente: 'm1' });
    const fills2 = [F2('compra', '2026-10-06T14:00:00Z', 670, 3), F2('venta', '2026-10-06T14:30:00Z', 665, 1), F2('venta', '2026-10-06T15:00:00Z', 650, 1)];
    const tramos = K.unirOperaciones(pos, []).ops.filter(p => p.estado === 'abierta').flatMap(p => p._filas.filter(f => f.estado === 'cerrada').map(f => ({ ...f, _tramoAbierta: true })));
    igual(tramos.map(t => [t.id, K.spotDeOperacion(t, fills2).entrada, K.spotDeOperacion(t, fills2).salida]), [[2, 670, 665], [3, 670, 650]], '(2) cada tramo cobrado con SU venta: 665 y 650 (antes el 2.º daba 657.5)');
    // (3) un lote del mismo día comprado después y que sigue abierto
    const op3 = K.unirOperaciones([], [{ ...base, contratos: 1, prima_fill: 3, prima_salida: 4, abierta_at: '2026-10-07T14:00:00Z', cerrada_at: '2026-10-07T16:00:00Z', resultado_usd: 100 }]).ops[0];
    igual(K.spotDeOperacion(op3, [F('compra', '2026-10-07T14:00:00Z', 430), F('compra', '2026-10-07T15:00:00Z', 470), F('venta', '2026-10-07T16:00:00Z', 440)]).entrada, 430,
      '(3) la entrada es la compra de SU apertura (430), no la media con el lote de las 11:00 que sigue abierto (450)');
    // (4) E*TRADE de lunes a miércoles con otro viaje el martes
    const be = { ...base, broker: 'etrade' };
    const ops4 = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 3, prima_salida: 4, abierta_at: '2026-10-05T04:00:00Z', cerrada_at: '2026-10-07T04:00:00Z', resultado_usd: 98, fees: 2 },
      { ...be, contratos: 1, prima_fill: 3, prima_salida: 4, abierta_at: '2026-10-06T04:00:00Z', cerrada_at: '2026-10-06T04:00:00Z', resultado_usd: 98, fees: 2 }]).ops;
    const FE = (lado, d, spot) => ({ ...be, lado, contratos: 1, ejecutado_at: d + 'T04:00:00Z', fecha_ny: d, spot, spot_fuente: 'm1' });
    const fills4 = [FE('compra', '2026-10-05', 430), FE('compra', '2026-10-06', 440), FE('venta', '2026-10-06', 440), FE('venta', '2026-10-07', 460)];
    const s4 = K.spotDeOperacion(ops4.find(o => o.abierta_fecha_ny === '2026-10-05'), fills4), s4b = K.spotDeOperacion(ops4.find(o => o.abierta_fecha_ny === '2026-10-06'), fills4);
    igual([s4.entrada, s4.salida, s4.sin_hora, s4b.entrada, s4b.salida], [430, 460, true, 440, 440], '(4) E*TRADE lunes → miércoles: salida = la venta del MIÉRCOLES (460), no la media con la del martes, que es del otro viaje');
  }
  // (arreglo 2) «sin dato aún (el worker lo completa)» solo si hay fills que completar
  {
    const vieja = K.unirOperaciones([], [{ broker: 'tasty', symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: '2026-07-10', contratos: 1, prima_fill: 1, prima_salida: 2, abierta_at: '2026-07-08T14:00:00Z', cerrada_at: '2026-07-08T15:00:00Z', resultado_usd: 98.7, fees: 1.3 }]).ops[0];
    const a1 = K.accionOpCuentas(vieja, K.detalleOpCuentas(vieja, { fills: [], senales: [] })).accion;
    assert(/sin fills en el libro para esta operación/.test(a1) && !/worker/.test(a1), '(arreglo 2) una operación anterior al libro (ningún fill): «sin fills en el libro para esta operación», sin prometer lo que el worker no completará');
    const FV = (lado, at) => ({ broker: 'tasty', symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: '2026-07-10', lado, contratos: 1, ejecutado_at: at, fecha_ny: '2026-07-08', spot: null });
    const a2 = K.accionOpCuentas(vieja, K.detalleOpCuentas(vieja, { fills: [FV('compra', '2026-07-08T14:00:00Z'), FV('venta', '2026-07-08T15:00:00Z')], senales: [] })).accion;
    assert(/sin dato aún \(el worker lo completa\)/.test(a2), '(arreglo 2) con fills que casan pero aún sin spot: «sin dato aún (el worker lo completa)»');
  }
  // (arreglo 3) E*TRADE del mismo día: el movimiento intradía no se puede medir
  {
    const be = { broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09' };
    const op = K.unirOperaciones([], [{ ...be, contratos: 2, prima_fill: 2.0, prima_salida: 3.0, abierta_at: '2026-10-06T04:00:00.000Z', cerrada_at: '2026-10-06T04:00:00.000Z', resultado_usd: 197.4, fees: 2.6 }]).ops[0];
    const FD = (lado) => ({ ...be, lado, contratos: 2, ejecutado_at: '2026-10-06T04:00:00.000Z', fecha_ny: '2026-10-06', spot: 436.12, spot_fuente: 'dia' });
    const A = K.accionOpCuentas(op, K.detalleOpCuentas(op, { fills: [FD('compra'), FD('venta')], senales: [] }));
    assert(A.mov === null && /movimiento intradía no medible \(el bróker no dio la hora\)/.test(A.vs) && !/acción plana/.test(A.vs), '(arreglo 3) fills sin hora del mismo día: «movimiento intradía no medible (el bróker no dio la hora)», nunca «acción plana»', A.vs);
    assert(/\$436\.12 → \$436\.12 <span class="fresco">\(cierre del día\)<\/span>/.test(A.accion) && !/0\.00 %/.test(A.accion), '(arreglo 3) la acción sin un 0.00 % inventado y con su fuente', A.accion);
    assert(/440: \+\$3\.88 \(\+0\.89 %\) fuera del dinero <span class="fresco">\(cierre del día\)<\/span>/.test(A.strike), '(arreglo 3) el strike «al entrar» dice que es el cierre del día', A.strike);
    const FM = (lado) => ({ ...FD(lado), spot: 429, spot_fuente: 'm1' });
    const AM = K.accionOpCuentas(op, K.detalleOpCuentas(op, { fills: [FM('compra'), FM('venta')], senales: [] }));
    assert(/movimiento intradía no medible/.test(AM.vs) && /\(sin hora: cierre del día\)<\/span>$/.test(AM.strike), '(arreglo 3) con el worker anterior (m1 sin hora): igual de no medible, y el strike con «(sin hora: cierre del día)»', AM.strike);
    const opN = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 2, prima_salida: 3, abierta_at: '2026-10-05T04:00:00Z', cerrada_at: '2026-10-07T04:00:00Z', resultado_usd: 98, fees: 2 }]).ops[0];
    const FN = (lado, d, spot) => ({ ...be, lado, contratos: 1, ejecutado_at: d + 'T04:00:00Z', fecha_ny: d, spot, spot_fuente: 'm1' });
    const AN = K.accionOpCuentas(opN, K.detalleOpCuentas(opN, { fills: [FN('compra', '2026-10-05', 430), FN('venta', '2026-10-07', 440)], senales: [] }));
    assert(/con la acción \+2\.33 %/.test(AN.vs) && /\(sin hora: cierre del día\)/.test(AN.vs), 'fills sin hora de un día para otro: el movimiento SÍ se mide (de cierre a cierre del día) y lo dice', AN.vs);
  }
  // (arreglo 4) varias idas y vueltas: el movimiento es la media de los de cada viaje, dicho como media, y cada viaje el suyo
  {
    const b = { broker: 'tasty', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09' };
    const BT = [{ ...b, contratos: 1, prima_fill: 2, prima_salida: 2.5, abierta_at: '2026-10-06T14:00:00Z', cerrada_at: '2026-10-06T14:20:00Z', resultado_usd: 48.7, fees: 1.3 },
      { ...b, contratos: 1, prima_fill: 7, prima_salida: 6, abierta_at: '2026-10-06T18:00:00Z', cerrada_at: '2026-10-06T18:20:00Z', resultado_usd: -101.3, fees: 1.3 }];
    const F = (lado, at, spot) => ({ ...b, lado, contratos: 1, ejecutado_at: at, fecha_ny: ymdNY(at), spot, spot_fuente: 'm1' });
    const fills = [F('compra', '2026-10-06T14:00:00Z', 430), F('venta', '2026-10-06T14:20:00Z', 432), F('compra', '2026-10-06T18:00:00Z', 445), F('venta', '2026-10-06T18:20:00Z', 443)];
    const op = K.unirOperaciones([], BT).ops[0];
    const sp = K.spotDeOperacion(op, fills);
    igual(sp.partes.map(x => [x.entrada, x.salida]), [[430, 432], [445, 443]], '(arreglo 4) cada ida y vuelta con SU acción: 430 → 432 y 445 → 443');
    cerca(sp.mov, ((2 / 430) + (-2 / 445)) / 2 * 100, '(arreglo 4) mov = la media ponderada de los movimientos de cada viaje (+0.47 % y -0.45 %), no la diferencia de las medias', 1e-3);
    const d = K.detalleOpCuentas(op, { fills, senales: [] }), A = K.accionOpCuentas(op, d);
    assert(/\(media de 2 idas y vueltas\)/.test(A.accion) && /\(media de 2 idas y vueltas\)/.test(A.vs) && /\(media de 2 idas y vueltas\)/.test(A.strike), '(arreglo 4) acción, contrato vs acción y strike dicen que son la MEDIA de 2 idas y vueltas', A.vs);
    const des = K.tramosOpCuentasHtml(op, d);
    assert(/acción \$430\.00 → \$432\.00 \(\+0\.47 %\)/.test(des) && /acción \$445\.00 → \$443\.00 \(-0\.45 %\)/.test(des), '(arreglo 4) el desglose da la acción de CADA ida y vuelta', des);
    const d1 = K.detalleOpCuentas(op, { fills: fills.slice(0, 2), senales: [] });
    assert(/\(media de 1 de 2 idas y vueltas, las que tienen dato\)/.test(K.accionOpCuentas(op, d1).vs), 'si solo una ida y vuelta tiene dato, se dice «1 de 2»');
    assert(!/ctspot/.test(K.tramosOpCuentasHtml(op, K.detalleOpCuentas(op, { fills: [], senales: [] }))), 'sin ningún dato de la acción, el desglose no repite «sin dato» en cada fila');
  }
  // (arreglo 5) neto y bruto bien dichos: moomoo y Schwab no mandan comisión
  {
    const b = { symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09', contratos: 1, prima_fill: 2, prima_salida: 3 };
    const BT = [{ ...b, broker: 'etrade', abierta_at: '2026-10-06T04:00:00Z', cerrada_at: '2026-10-06T04:00:00Z', resultado_usd: 97.4, fees: 2.6 },
      { ...b, broker: 'moomoo', abierta_at: '2026-10-06T14:00:00Z', cerrada_at: '2026-10-06T15:00:00Z', resultado_usd: 100, fees: 0, raw: { fees: 'no disponibles' } }];
    const ops = K.unirOperaciones([], BT).ops;
    const M = K.metricasCuentas(K.resumenPeriodo(ops, '2026-10-01').ops, '2026-10-01');
    igual([M.comisiones, M.com_brokers, M.sin_com_brokers], [2.6, ['etrade'], ['moomoo']], '(arreglo 5) comisiones solo de quien las manda (E*TRADE); moomoo anotado aparte');
    const tl = K.tilesCuentasHtml(M, 'semana');
    assert(/neta de las comisiones de E\*TRADE; moomoo no las da \(su P&L va sin descontarlas\)/.test(tl) && /ya descontadas del neto · las da E\*TRADE \(moomoo no\)/.test(tl) && !/comisiones ya descontadas/.test(tl),
      '(arreglo 5) UTILIDAD: «neta de las comisiones de E*TRADE; moomoo no las da (su P&L va sin descontarlas)»; COMISIONES dice quién las da');
    const mm = ops.find(o => o.broker === 'moomoo');
    const solo = K.metricasCuentas(K.resumenPeriodo([mm], '2026-10-01').ops, '2026-10-01');
    const ts = K.tilesCuentasHtml(solo, 'semana');
    assert(solo.comisiones === null && /COMISIONES<\/div><div class="vl" style="color:var\(--tx\)">—<\/div><div class="sb">moomoo no las da<\/div>/.test(ts) && !/\$0\.00/.test(ts) && /moomoo no las da: P&L sin descontarlas/.test(ts),
      '(arreglo 5) solo moomoo en el período: COMISIONES «—» (no $0.00) y la utilidad dice que va sin descontarlas');
    const cuatro = K.unirOperaciones([], [BT[0], BT[1], { ...b, broker: 'tasty', abierta_at: '2026-10-07T14:00:00Z', cerrada_at: '2026-10-07T15:00:00Z', resultado_usd: 98.7, fees: 1.3 },
      { ...b, broker: 'schwab', abierta_at: '2026-10-07T14:00:00Z', cerrada_at: '2026-10-07T15:00:00Z', resultado_usd: 100, fees: 0 }]).ops;
    const M4 = K.metricasCuentas(K.resumenPeriodo(cuatro, '2026-10-01').ops, '2026-10-01');
    assert(M4.comisiones === 3.9 && /neta de las comisiones de E\*TRADE y tasty; Schwab y moomoo no las dan \(su P&L va sin descontarlas\)/.test(K.tilesCuentasHtml(M4, 'semana')),
      '(arreglo 5) con los cuatro: «neta de las comisiones de E*TRADE y tasty; Schwab y moomoo no las dan (su P&L va sin descontarlas)»');
    assert(/title="sin comisión del bróker"><b>\$100\.00<\/b><span class="csub">sin comisión<\/span>/.test(K.filaHistorialCuentas(mm, { fills: [], senales: [] })) && /sin comisión del bróker/.test(K.tarjetaHistorial(mm, {})),
      '(arreglo 5) la tarjeta de moomoo dice «sin comisión del bróker» bajo su P&L; la fila (v62 rev2, en corto) «sin comisión» en una línea pequeña y el texto entero en el title');
    assert(!/sin comisión del bróker/.test(K.filaHistorialCuentas(ops.find(o => o.broker === 'etrade'), {})) && !/sin comisión del bróker/.test(K.filaHistorialCuentas(cuatro.find(o => o.broker === 'tasty'), {})), 'E*TRADE y tasty con comisión: «bruto», nunca «sin comisión del bróker»');
    igual(K.CTA_COLS[10], ['P&L $', 'neto si hay comisión', 0], '(arreglo 5) la columna se titula «P&L $ · neto si hay comisión»');
    igual([K.comisionDelBroker({ broker: 'etrade', fees: 0 }), K.comisionDelBroker({ broker: 'tasty', fees: 1.3 }), K.comisionDelBroker({ broker: 'moomoo', fees: 0 }), K.comisionDelBroker({ broker: 'schwab', fees: null }),
      K.comisionDelBroker({ broker: 'schwab', fees: 0.65 }), K.comisionDelBroker({ fees: undefined }), K.comisionDelBroker(null)], [true, true, false, false, true, false, false],
    'comisionDelBroker: E*TRADE y tasty la mandan (aunque sea 0); moomoo y Schwab con 0 o sin fees no; un fees > 0 de quien sea, sí');
  }
  // (arreglo 6) E*TRADE a medianoche UTC: día, DTE, acción y señal del día correcto
  {
    const be = { broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09' };
    const op = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 3, prima_salida: 4, abierta_at: '2026-10-06T00:00:00.000Z', cerrada_at: '2026-10-06T00:00:00.000Z', resultado_usd: 98, fees: 2 }]).ops[0];
    const ms = Date.parse('2026-10-06T00:00:00Z');
    const FILLS = ['compra', 'venta'].map(lado => ({ ...be, lado, contratos: 1, ejecutado_at: new Date(ms).toISOString(), fecha_ny: K.fechaNyTransaccion(ms), spot: 430, spot_fuente: 'm1' }));
    const SEN = [{ symbol: 'TSLA', direccion: 'CALL', estrategia_id: 'E1', creado_at: '2026-10-05T19:30:00Z', fecha_ny: '2026-10-05' }, { symbol: 'TSLA', direccion: 'CALL', estrategia_id: 'E5', creado_at: '2026-10-06T13:31:00Z', fecha_ny: '2026-10-06' }];
    igual([op.abierta_fecha_ny, K.diaOpNY(op.abierta_at), K.diaAperturaOp(op), K.dteEntrada(op)], ['2026-10-05', '2026-10-06', '2026-10-06', 3], '(arreglo 6) E*TRADE a medianoche UTC: unirOperaciones no cambia (5 oct), Cuentas toma el 6 (fechaNyTransaccion) y el DTE es 3, no 4');
    const sp = K.spotDeOperacion(op, FILLS);
    igual([sp.entrada, sp.salida], [430, 430], '(arreglo 6) la acción sale del libro (antes «sin dato aún» porque 10-06 ≠ 10-05)');
    igual(K.senalDeOperacion(op, SEN).estrategia_id, 'E5', '(arreglo 6) la señal es la E5 del 6, no la E1 del 5');
    const t = K.tarjetaHistorial(op, { fills: FILLS, senales: SEN });
    assert(/entrada<\/span><b>6 oct · \$3\.00<\/b>/.test(t) && /exp 9 oct · 3 DTE/.test(t) && /señal E5/.test(t) && /\$430\.00 → \$430\.00/.test(t) && /intradía no medible/.test(t), '(arreglo 6) la tarjeta: entrada el 6 oct, 3 DTE, la acción 430 del libro y la señal E5', t.replace(/\s+/g, ' ').slice(0, 400));
    const tI = K.tarjetaHistorial(op, { fills: FILLS, senales: SEN, idx: K.indiceCuentas(FILLS, SEN) });
    assert(/señal E5/.test(tI) && /\$430\.00 → \$430\.00/.test(tI), '(arreglo 6) y con el índice (la clave del día también es la del 6)');
    igual([K.horaOpCuentas('2026-10-06T00:00:00Z', '2026-10-06'), K.diaOpNY('2026-10-06T14:57:00Z'), K.diaOpNY('2026-10-06T04:00:00Z'), K.diaOpNY(null)], ['6 oct', '2026-10-06', '2026-10-06', ''],
      'diaOpNY: medianoche UTC → día UTC; con hora o a medianoche ET → día NY; sin instante → vacío (no «hoy»)');
  }
  // (arreglo 7) los vencimientos del bróker dicen «expiró» (y la presunta de Schwab, «presunto»)
  {
    const v = { broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 200, expiracion: '2026-12-04', contratos: 1, prima_fill: 1.5, prima_salida: 0,
      abierta_at: '2026-12-02T15:10:00+00:00', cerrada_at: '2026-12-04T20:00:00+00:00', resultado_usd: -150, fees: 0,
      clave_ext: 'NVDA  261204C00200000#9>venc2026-12-04', raw: { abre: 9, cierra: 'vencimiento', nota: 'venció sin venderse (A2): pérdida total PRESUNTA' } };
    const op = K.unirOperaciones([], [v]).ops[0];
    const d = K.detalleOpCuentas(op, { fills: [], senales: [] });
    igual([op.estado, d.expirada, d.presunta], ['cerrada', true, true], '(arreglo 7) unirOperaciones la deja «cerrada» (no cambia); Cuentas la ve expirada y presunta');
    const t = K.tarjetaHistorial(op, {});
    assert(/expiró<\/span> <span class="fresco">\(presunto\)<\/span>/.test(K.salidaOpCuentas(op, d, false)) && /expiró/.test(t) && !/15:00/.test(t), '(arreglo 7) Schwab presunta: «expiró (presunto)», sin la hora inventada de las 15:00');
    igual(K.duracionOpCuentas(op, d), '2 d hasta vencer', '(arreglo 7) la duración, en días hasta el vencimiento');
    // v62 rev2: en la TABLA, «presunto» y «hasta vencer» / «venció» van debajo, en pequeño (en una línea ensanchaban su columna)
    igual([K.salidaOpCuentas(op, d, true), K.duracionTablaCuentas(op, d), K.duracionTablaCuentas({ ...op, expiracion: '2026-12-02' }, d)],
      ['<span style="color:var(--oro)">expiró</span><span class="csub">presunto</span>', '<td title="2 d hasta vencer">2 d<span class="csub">hasta vencer</span></td>', '<td title="venció el mismo día">mismo día<span class="csub">venció</span></td>'],
      'v62 rev2 · tabla: «expiró» con «presunto» debajo; «2 d» con «hasta vencer» debajo; «mismo día» con «venció» debajo (el texto entero en el title)');
    igual(K.duracionTablaCuentas(OPB, K.detalleOpCuentas(OPB, CTX)), '<td>8 min</td>', 'v62 rev2 · tabla: una duración normal sigue igual');
    const et = K.unirOperaciones([], [{ ...v, broker: 'etrade', clave_ext: 'X#1>2#1', raw: { abre: 1, cierra: 2, tipo: 'Option Expired' } }]).ops[0];
    const de = K.detalleOpCuentas(et, {});
    assert(de.expirada && !de.presunta && /expiró<\/span><\/b>/.test(K.tarjetaHistorial(et, {})), '(arreglo 7) E*TRADE «Option Expired»: expiró (sin «presunto»)');
    const mixto = K.unirOperaciones([], [v, { ...v, clave_ext: 'b', raw: { abre: 10, cierra: 77 }, cerrada_at: '2026-12-03T15:00:00Z', prima_salida: 2, resultado_usd: 50 }]).ops[0];
    const dm = K.detalleOpCuentas(mixto, {});
    assert(!dm.expirada && /expiró \(presunto\)/.test(K.tramosOpCuentasHtml(mixto, dm)), '(arreglo 7) un grupo con una venta real no es «expirada»; en su desglose, el tramo vencido dice «expiró (presunto)»');
    igual([K.filaVencioCuentas(v), K.filaVencioCuentas({ clave_ext: 'X#1>2#1', raw: { tipo: 'Sold To Close' } }), K.filaPresuntaCuentas(v), K.filaPresuntaCuentas(null)], [true, false, true, false], 'filaVencioCuentas / filaPresuntaCuentas');
  }
  // (arreglo 8) «sin señal ese día» con la dirección, y la de la dirección contraria si la hubo
  {
    const op = { symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09', broker: 'tasty', contratos: 1, prima_fill: 1, prima_salida: 1.2, resultado_usd: 20, estado: 'cerrada',
      abierta_fecha_ny: '2026-10-06', abierta_at: '2026-10-06T14:00:00Z', cerrada_at: '2026-10-06T14:30:00Z' };
    const sen = [{ symbol: 'TSLA', direccion: 'PUT', estrategia_id: 'E1', creado_at: '2026-10-06T13:40:00Z', fecha_ny: '2026-10-06' }];
    assert(/sin señal CALL ese día \(hubo E1 PUT a las 09:40\)/.test(K.tarjetaHistorial(op, { fills: [], senales: sen })), '(arreglo 8) «sin señal CALL ese día (hubo E1 PUT a las 09:40)»: ya no se dice que no hubo señal');
    assert(/sin señal CALL ese día \(hubo E1 PUT a las 09:40\)/.test(K.filaHistorialCuentas(op, { fills: [], senales: sen, idx: K.indiceCuentas([], sen) })), 'y con el índice');
  }
  // (arreglo 9) el repintado automático no devuelve el panel a la fila 1 ni pliega los desgloses
  {
    const panel = { scrollTop: 8000, scrollLeft: 40 };
    const det = (k, open) => ({ dataset: { k }, open });
    let detalles = [det('a', true), det('b', false), det('c', true)];
    const hist = nodo({ querySelector: (s) => (s === '.ctabla' ? panel : null), querySelectorAll: (s) => (s === 'details[open]' ? detalles.filter(x => x.open) : s === 'details[data-k]' ? detalles : []) });
    const V = cuentas({ $: (s) => (s === '#ctaHist' ? hist : null) });
    const est = V.ctaEstadoGuardar();
    igual(est, { scroll: [8000, 40], abiertos: ['a', 'c'] }, '(arreglo 9) se guarda el scroll del panel y los desgloses abiertos (por su data-k)');
    panel.scrollTop = 0; panel.scrollLeft = 0; detalles = [det('a', false), det('b', false), det('c', false), det('d', false)];   // el repintado: panel nuevo, todo plegado
    V.ctaEstadoRestaurar(est);
    igual([panel.scrollTop, panel.scrollLeft, detalles.map(x => x.open)], [8000, 40, [true, false, true, false]], '(arreglo 9) tras pintar vuelven el scroll y los desgloses que estaban abiertos');
    let ok = true; try { cuentas().ctaEstadoRestaurar(cuentas().ctaEstadoGuardar()); cuentas().ctaEstadoRestaurar(null); } catch (_) { ok = false; }
    assert(ok, 'sin #ctaHist (otra vista, la primera vez) no revienta');
    assert(/const est = ctaEstadoGuardar\(\);\s*\$\('#vista'\)\.innerHTML = `<div class="ctav">\$\{h\}<\/div>`;\s*ctaEstadoRestaurar\(est\);/.test(extraer('vistaCuentasSaldos')), '(arreglo 9) vistaCuentasSaldos guarda el estado justo antes de reemplazar #vista y lo devuelve justo después');
    const k1 = K.claveDetalleCuentas(OPB, K.detalleOpCuentas(OPB, CTX)), k2 = K.claveDetalleCuentas(OPB, K.detalleOpCuentas(OPB, { fills: [], senales: [] }));
    assert(k1 === k2 && k1 === 'tasty|TSLA|CALL|432.5|2026-10-09|2026-10-06|' + Date.parse('2026-10-06T14:57:00Z'), '(arreglo 9) la clave del desglose es estable (no depende de lo leído): bróker|contrato|día|apertura', k1);
  }
  // (arreglo 10) «ver más» AÑADE las filas nuevas sin repintar el panel
  {
    const muchas = Array.from({ length: 450 }, (_, i) => ({ ...OPB, strike: 300 + i, _partes_filas: null }));
    const añadidas = [];
    const tbody = { insertAdjacentHTML: (pos, html) => añadidas.push([pos, html]) };
    const pie = { innerHTML: 'viejo', quitado: false, remove() { this.quitado = true; } };
    const hist = nodo({ querySelector: (s) => (s === '.ctabla tbody' ? tbody : s === '#ctaMas' ? pie : null) });
    const V = cuentas({ $: (s) => (s === '#ctaHist' ? hist : null) });
    Object.assign(V._cta, { cerradas: muchas, ctx: CTX, formato: 'tabla', tope: 200 });
    V.ctaVerMas();
    igual([V._cta.tope, añadidas.length, añadidas[0][0], (añadidas[0][1].match(/<tr class="crow">/g) || []).length, hist.innerHTML], [400, 1, 'beforeend', 200, ''],
      '(arreglo 10) «ver más» AÑADE las 200 nuevas al final del cuerpo de la tabla y no toca #ctaHist (el panel sigue siendo el mismo, con su scroll)');
    assert(/TSLA CALL 500</.test(añadidas[0][1]) && /TSLA CALL 699</.test(añadidas[0][1]) && !/TSLA CALL 499</.test(añadidas[0][1]) && !/TSLA CALL 700</.test(añadidas[0][1]), 'son las filas 201 a 400: ninguna de las que ya estaban');
    assert(/Se muestran 400 de 450/.test(pie.innerHTML) && /ver más \(50\)/.test(pie.innerHTML) && !pie.quitado, 'el pie cambia a «Se muestran 400 de 450 · ver más (50)»');
    V.ctaVerMas();
    igual([V._cta.tope, (añadidas[1][1].match(/<tr class="crow">/g) || []).length, pie.quitado], [600, 50, true], 'otra vez: las 50 que faltaban y el pie desaparece');
    const tarjetas = [], lista = { insertAdjacentHTML: (p, h) => tarjetas.push(h) };
    const hist2 = nodo({ querySelector: (s) => (s === '.ctalista' ? lista : null) });
    const V2 = cuentas({ $: (s) => (s === '#ctaHist' ? hist2 : null) });
    Object.assign(V2._cta, { cerradas: muchas, ctx: CTX, formato: 'tarjetas', tope: 200 });
    V2.ctaVerMas();
    igual([(tarjetas[0].match(/<div class="card">/g) || []).length, hist2.innerHTML], [200, ''], 'en el teléfono igual: 200 tarjetas más al final de su .ctalista');
    assert(/<div class="ctalista">/.test(K.seccionHistorialCuentas(muchas, CTX, 200, 'tarjetas')) && /<div class="fila" id="ctaMas"/.test(K.seccionHistorialCuentas(muchas, CTX, 200, 'tabla')), 'las tarjetas van en .ctalista y el pie en #ctaMas');
    assert(/\.ctalista\{display:flex;flex-direction:column;gap:11px\}/.test(INDEX), 'CSS: .ctalista con el mismo espacio entre tarjetas que la vista');
  }
  // (arreglo 11) el tile MEJOR / PEOR no corta la cifra en la computadora
  assert(/\.ctav \.dcard \.vl\.vl2\{white-space:normal;overflow:visible;text-overflow:clip/.test(INDEX) && /\.ctav \.dcard \.vl\.vl2 span\{white-space:nowrap\}/.test(INDEX),
    '(arreglo 11) CSS: los tiles de dos valores parten en la «/» y cada cifra queda entera («$530 / -$1,861», no «$530 / -$1,…»)');
  // (arreglo 12) índice por lectura: cada operación mira solo SU trozo
  {
    const ix = K.indiceCuentas(FILLS_B.concat([{ ...FILLS_B[0], strike: null }]), SEN_B.concat([{ symbol: 'nvda', creado_at: '2026-10-07T14:00:00Z' }]));
    igual([[...ix.fills.keys()], [...ix.senales.keys()]], [['tasty|TSLA|CALL|432.5|2026-10-09'], ['TSLA|2026-10-06', 'NVDA|2026-10-07']], '(arreglo 12) fills por bróker|contrato (sin contrato no entra) y señales por SÍMBOLO|día NY');
    igual(K.filaHistorialCuentas(OPB, { ...CTX, idx: K.indiceCuentas(FILLS_B, SEN_B) }), K.filaHistorialCuentas(OPB, CTX), '(arreglo 12) con el índice la fila sale IDÉNTICA');
    const trampa = { fills: FILLS_B.map(f => ({ ...f, spot: 999 })), senales: [{ ...SEN_B[0], estrategia_id: 'TRAMPA' }], idx: K.indiceCuentas(FILLS_B, SEN_B) };
    const ft = K.filaHistorialCuentas(OPB, trampa);
    assert(/\$430\.50 → \$432\.00/.test(ft) && /señal E5/.test(ft) && !/999|TRAMPA/.test(ft), '(arreglo 12) con índice, la operación NO recorre los arreglos enteros (los ~900 fills y ~2300 señales): solo su trozo');
    assert(/ctx\.idx = indiceCuentas\(ctx\.fills, ctx\.senales\);/.test(extraer('vistaCuentasSaldos')), '(arreglo 12) vistaCuentasSaldos indexa UNA vez por lectura (y «ver más» lo reutiliza desde _cta.ctx)');
    // 600 operaciones, 900 fills y 2304 señales: con el índice el historial entero se pinta mucho más rápido
    const sy = ['TSLA', 'NVDA', 'SPY', 'META', 'AAPL', 'AMD'];
    const ops6 = Array.from({ length: 600 }, (_, i) => { const d = `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`; return { ...OPB, symbol: sy[i % 6], strike: 300 + (i % 50), abierta_fecha_ny: d, abierta_at: d + 'T14:57:00Z', cerrada_at: d + 'T15:05:00Z', _partes_filas: null }; });
    const fills6 = Array.from({ length: 900 }, (_, i) => ({ ...FILLS_B[i % 4], symbol: sy[i % 6], strike: 300 + (i % 50), fecha_ny: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}` }));
    const sen6 = Array.from({ length: 2304 }, (_, i) => ({ ...SEN_B[0], symbol: sy[i % 6], fecha_ny: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, creado_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T13:31:00Z` }));
    // con el ymdNY REAL del fuente (su formateador se crea una vez, como horaNY): la copia de casa_pruebas lo crea en cada llamada
    const KP = construir(NOMBRES.concat(['ymdNY']), { $: () => null, anchoVista: () => 1400 }, { consts: CONSTS, prefijo: `let _cuentasVista = 'cuentas';` });
    const ctx6 = { fills: fills6, senales: sen6 }, ctx6i = { ...ctx6, idx: KP.indiceCuentas(fills6, sen6) };
    KP.seccionHistorialCuentas(ops6.slice(0, 20), ctx6i, 20, 'tabla');   // calentar
    let t0 = Date.now(); const hSin = KP.seccionHistorialCuentas(ops6, ctx6, 600, 'tabla'); const tSin = Date.now() - t0;
    t0 = Date.now(); const hCon = KP.seccionHistorialCuentas(ops6, ctx6i, 600, 'tabla'); const tCon = Date.now() - t0;
    assert(hSin === hCon && tCon * 1.5 < tSin, `(arreglo 12) 600 operaciones × 900 fills × 2304 señales: el MISMO HTML, con índice ${tCon} ms y sin él ${tSin} ms`);
    assert(/ymdNY\._f \|\| \(ymdNY\._f = new Intl\.DateTimeFormat/.test(extraer('ymdNY')) && /horaNY\._f \|\| \(horaNY\._f = new Intl\.DateTimeFormat/.test(extraer('horaNY')), 'ymdNY y horaNY crean su formateador UNA vez (era la mitad del coste del historial)');
    igual([KP.ymdNY('2026-10-06T03:59:00Z'), KP.ymdNY('2026-10-06T04:00:00Z'), KP.ymdNY('basura'), K.horaNY(Date.parse('2026-10-06T13:31:00Z'))], ['2026-10-05', '2026-10-06', '', '09:31'], 'y dan lo mismo que antes (también con un instante inválido: «»)');
  }

  // ════════════════ 11. v62 rev2 · «sin hora» es POR INSTANTE (sinHoraIso), nunca por bróker ════════════════
  // Datos reales de Andrés: los 435 fills de E*TRADE traen hora (2026-10-09T13:32:15Z) y sus filas del bróker también
  // (10:57 → 11:09). Solo un instante a 00:00:00 UTC o a 00:00 NY es «no sé la hora» (la regla del worker 0.1.9b).
  {
    igual(['2026-10-09T13:32:15Z', '2026-10-09T13:32:15+00:00', '2026-10-09T00:00:00Z', '2026-10-09T04:00:00Z', '2026-12-09T05:00:00Z', '2026-10-09T00:00:01Z', '2026-10-09T00:01:00Z', null, 'basura'].map(K.sinHoraIso),
      [false, false, true, true, true, false, false, false, false], 'sinHoraIso: con hora → false; 00:00:00 UTC exacto o 00:00 NY (verano 04:00Z, invierno 05:00Z) → true; un segundo después ya es una hora; vacío o basura → false');
    // v62 rev3: EXACTAMENTE 00:00:00.000, como el worker (spot_fills.es_fecha_sin_hora): un segundo o un milisegundo suelto ya es una hora
    igual(['2026-10-09T04:00:30Z', '2026-10-09T04:00:59Z', '2026-12-09T05:00:45Z', '2026-10-09T00:00:00.500Z', '2026-10-09T04:00:00.001Z', '2026-10-09T04:00:00.000Z', '2026-12-09T05:00:00.000Z', '2026-10-09T00:00:00.000Z'].map(K.sinHoraIso),
      [false, false, false, false, false, true, true, true], 'sinHoraIso (rev3): 00:00:30 / 00:00:59 NY, 00:00:45 NY en invierno, 00:00:00.500 UTC y 00:00:00.001 NY → false (una liquidación de moomoo a minutos sueltos no es «sin hora»); 00:00:00.000 NY o UTC → true');
    igual([K.horaOpCuentas('2026-10-09T04:00:30Z', ''), K.horaOpCuentas('2026-10-09T04:00:00Z', '')], ['9 oct 00:00', '9 oct'], 'y en Cuentas un fill a las 00:00:30 NY se pinta con su HORA («9 oct 00:00»); solo el 00:00:00 exacto es la fecha sola');
    assert(!/f\.broker === 'etrade'/.test(extraer('spotDeOperacion')) && !/broker === 'etrade'/.test(extraer('operacionCerrada')) && !/x\.broker === 'etrade'/.test(extraer('seccionEjecucionesDiario')),
      'el fuente ya no decide «sin hora» por bróker (spotDeOperacion, operacionCerrada, ejecuciones del Diario)');
    assert(!/E\*TRADE no da la hora|no da la hora/.test(FUENTE), 'ningún texto dice «E*TRADE no da la hora»');
    // TSLA CALL 392.5 ×1 de E*TRADE del 9 oct 10:57 → 11:09 (como en los datos reales), con un SEGUNDO viaje del mismo contrato a 2 min
    const be = { broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-10' };
    const op = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 6.1, prima_salida: 4.8, abierta_at: '2026-10-09T14:57:02Z', cerrada_at: '2026-10-09T15:09:04Z', resultado_usd: -131.3, fees: 1.3, clave_ext: 'x1' }]).ops[0];
    const FT = (lado, at, spot, o) => ({ ...be, lado, contratos: 1, ejecutado_at: at, fecha_ny: '2026-10-09', spot, spot_fuente: 'm1', ...(o || {}) });
    const fT = [FT('compra', '2026-10-09T14:57:02Z', 387.51), FT('venta', '2026-10-09T15:09:04Z', 385.4),
      FT('compra', '2026-10-09T14:59:06Z', 387.11), FT('venta', '2026-10-09T15:07:01Z', 385.43)];   // el otro viaje: a 2 min 4 s y 2 min 3 s
    const sT = K.spotDeOperacion(op, fT);
    igual([sT.entrada, sT.salida, sT.sin_hora, sT.fuente_entrada, sT.n_fills], [387.51, 385.4, false, 'm1', 2], 'E*TRADE CON hora: se ancla a ±2 min como los demás (la compra de las 10:59 y la venta de las 11:07 son del otro viaje), sin sin_hora');
    cerca(sT.mov, (385.4 - 387.51) / 387.51 * 100, 'y su movimiento intradía SÍ se mide (−0.54 %)', 1e-3);
    const dT = K.detalleOpCuentas(op, { fills: fT, senales: [] }), AT = K.accionOpCuentas(op, dT);
    assert(!dT.sinHora && /con la acción -0\.54 %/.test(AT.vs) && !/no medible|no dio la hora|sin hora/.test(AT.accion + AT.vs + AT.strike), 'la acción de E*TRADE con hora: «con la acción -0.54 %», sin ningún aviso de «sin hora»', AT.accion + ' | ' + AT.vs);
    const tT = K.tarjetaHistorial(op, { fills: fT, senales: [] }), rT = K.filaHistorialCuentas(op, { fills: fT, senales: [] });
    assert(/entrada<\/span><b>9 oct 10:57 · \$6\.10<\/b>/.test(tT) && /salida<\/span><b>11:09 · \$4\.80<\/b>/.test(tT) && /duración<\/span><b>12 min<\/b>/.test(tT), 'la tarjeta: entrada 10:57, salida 11:09 y 12 min (nada de «mismo día»)', tT.replace(/\s+/g, ' ').slice(0, 300));
    assert(!/sin hora|no dio la hora|cierre del día/.test(rT) && /10:57/.test(rT) && /11:09/.test(rT), 'y la fila de la tabla igual: con hora, sin avisos');
    // el MISMO viaje en otro bróker (tasty) da la MISMA acción: E*TRADE con hora no es un caso aparte
    const opTy = K.unirOperaciones([], [{ ...be, broker: 'tasty', contratos: 1, prima_fill: 6.1, prima_salida: 4.8, abierta_at: '2026-10-09T14:57:02Z', cerrada_at: '2026-10-09T15:09:04Z', resultado_usd: -131.3, fees: 1.3, clave_ext: 'x1' }]).ops[0];
    const sTy = K.spotDeOperacion(opTy, fT.map(f => ({ ...f, broker: 'tasty' })));
    igual(canon(sTy), canon(sT), 'la misma operación en tasty da EXACTAMENTE el mismo resultado que en E*TRADE');
    igual(K.accionOpCuentas(opTy, K.detalleOpCuentas(opTy, { fills: fT.map(f => ({ ...f, broker: 'tasty' })), senales: [] })), AT, 'y los mismos textos de la acción');
    // y al revés: un fill de SCHWAB a 00:00:00 UTC exacto es «sin hora» (se ancla por día y se avisa)
    const bs = { ...be, broker: 'schwab' };
    const opS = K.unirOperaciones([], [{ ...bs, contratos: 1, prima_fill: 6, prima_salida: 7, abierta_at: '2026-10-09T00:00:00Z', cerrada_at: '2026-10-09T00:00:00Z', resultado_usd: 100, clave_ext: 's1' }]).ops[0];
    const fS = [{ ...bs, lado: 'compra', contratos: 1, ejecutado_at: '2026-10-09T00:00:00Z', fecha_ny: '2026-10-09', spot: 386, spot_fuente: 'm1' }, { ...bs, lado: 'venta', contratos: 1, ejecutado_at: '2026-10-09T00:00:00Z', fecha_ny: '2026-10-09', spot: 386, spot_fuente: 'm1' }];
    const sS = K.spotDeOperacion(opS, fS), AS = K.accionOpCuentas(opS, K.detalleOpCuentas(opS, { fills: fS, senales: [] }));
    igual([sS.entrada, sS.salida, sS.sin_hora, sS.mov], [386, 386, true, null], 'un fill de Schwab a 00:00:00Z: sin hora, anclado por día, sin movimiento intradía medible');
    assert(/movimiento intradía no medible \(el bróker no dio la hora\)/.test(AS.vs) && /el bróker no dio la hora: precio de cierre del día, no del fill/.test(AS.accion), 'y lo dice sin nombrar a nadie: «el bróker no dio la hora»', AS.accion);
    assert(/9 oct/.test(K.horaOpCuentas('2026-10-09T00:00:00Z', '')) && !/00:00|20:00/.test(K.horaOpCuentas('2026-10-09T00:00:00Z', '')), 'horaOpCuentas: un instante sin hora (de cualquier bróker) es solo su fecha, la del día que dice (no el anterior)');
    // un fill CON hora contra un tramo cuya apertura/cierre llegó sin hora: se ancla por el día del tramo (no se pierde)
    const opMix = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 6.1, prima_salida: 4.8, abierta_at: '2026-10-09T04:00:00Z', cerrada_at: '2026-10-09T04:00:00Z', resultado_usd: -131.3, fees: 1.3, clave_ext: 'm1' }]).ops[0];
    const sMix = K.spotDeOperacion(opMix, fT.slice(0, 2));
    igual([sMix.entrada, sMix.salida, sMix.sin_hora], [387.51, 385.4, false], 'tramo sin hora y fills con hora: los fills se anclan por el DÍA del tramo y su spot es el del fill (sin aviso)');
  }

  // ════════════════ 12. v62 rev2 · a 1400 px la tabla cabe: ancho grande y celdas en CORTO (el texto largo, en el title) ════════════════
  {
    const f = K.filaHistorialCuentas(OPB, CTX), t = K.tarjetaHistorial(OPB, CTX);
    const celdas = (f.match(/<tr class="crow">[\s\S]*?<\/tr>/)[0].match(/<td[^>]*>[\s\S]*?<\/td>/g) || []);
    igual(celdas.length, 15, 'la fila sigue con 15 celdas');
    const visible = (c) => c.replace(/^<td[^>]*>/, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const titulo = (c) => ((c.match(/^<td[^>]*title="([^"]*)"/) || [])[1] || '');
    igual([visible(celdas[12]), visible(celdas[13]), visible(celdas[14])], ['$430.50 → $432.00 (+0.35 %) contrato +16.0 % · media de 2', '432.5 · +$2.00 (+0.46 %) fuera media de 2', 'E5 · 9:31'],
      'en CORTO: Acción «$430.50 → $432.00 (+0.35 %)» y debajo «contrato +16.0 % · media de 2»; Strike «432.5 · +$2.00 (+0.46 %) fuera» (y su etiqueta corta); Señal «E5 · 9:31»');
    assert(/<td class="ctxt cacc" title="[^"]*"><span class="c1">\$430\.50 → \$432\.00 \(\+0\.35 %\)<\/span><span class="csub">contrato \+16\.0 % · media de 2<\/span><\/td>/.test(f), 'Acción: la línea de la acción en .c1 (sin partir) y las etiquetas cortas en .csub');
    igual([titulo(celdas[12]), titulo(celdas[13]), titulo(celdas[14])],
      ['$430.50 → $432.00 (+0.35 %) (media de 2 idas y vueltas) · contrato +16.0 % con la acción +0.35 % (media de 2 idas y vueltas)', '432.5: +$2.00 (+0.46 %) fuera del dinero (media de 2 idas y vueltas)', 'señal E5 · 09:31'],
      'nada se pierde: el texto LARGO de la tarjeta va en el title de cada celda (accesible)');
    assert(/\$430\.50 → \$432\.00 \(\+0\.35 %\) <span class="fresco">\(media de 2 idas y vueltas\)<\/span>/.test(t) && /señal E5 · 09:31/.test(t), 'la TARJETA del teléfono no cambia: sigue con los textos largos');
    igual([visible(celdas[10]), titulo(celdas[10])], ['$67.40 bruto $70.00', 'neto · bruto $70.00 − comisión $2.60'], 'P&L: el neto y «bruto $X» en una línea pequeña; el desglose en el title');
    // sin señal antes de entrar: «—» con el detalle en el title
    const sola = K.unirOperaciones([], [{ ...BT_B[0], broker: 'schwab', fees: 0 }]).ops[0];
    const f2 = K.filaHistorialCuentas(sola, { fills: [], senales: [] });
    const c2 = f2.match(/<tr class="crow">[\s\S]*?<\/tr>/)[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
    igual([visible(c2[12]), visible(c2[13]), visible(c2[14]), titulo(c2[14]), visible(c2[10])], ['sin fills contrato +14.4 %', 'sin dato', '—', 'sin señal CALL ese día', '$28.70 sin comisión'],
      'sin datos: «sin fills», «sin dato», la señal «—» (detalle en el title) y el P&L «sin comisión» en corto');
    assert(/title="sin fills en el libro para esta operación · contrato \+14\.4 % · acción: sin dato"/.test(f2), 'y el title de la acción con el texto largo');
    // una entrada sin hora: la señal con «*» (el title dice «ese día; la entrada no trae hora»); con la lectura caída, «—»
    const dS = { senal: { estrategia_id: 'E2', hora: '11:00', sin_hora: true } };
    igual([K.senalCortaCuentas(dS), K.senalCortaCuentas({ senal: { estrategia_id: 'CT15A', hora: '10:45' } }), K.senalCortaCuentas({ errSen: true, senal: { estrategia_id: 'X', hora: '09:00' } }), K.senalCortaCuentas(null)],
      ['E2 · 11:00<span class="fresco">*</span>', 'CT15A · 10:45', '<span class="fresco">—</span>', '<span class="fresco">—</span>'], 'senalCortaCuentas: «E2 · 11:00*» sin hora de entrada, «—» sin señal o con la lectura caída');
    igual(K.tituloCelda('<b>a</b>  <span class="x">"b"</span>'), 'a &quot;b&quot;', 'tituloCelda: sin etiquetas, espacios juntos y comillas escapadas para el atributo');
    // fills sin hora en la tabla: la etiqueta corta «sin hora» (y «intradía no medible» del mismo día)
    const be = { broker: 'schwab', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-09' };
    const opZ = K.unirOperaciones([], [{ ...be, contratos: 1, prima_fill: 2, prima_salida: 3, abierta_at: '2026-10-06T00:00:00Z', cerrada_at: '2026-10-06T00:00:00Z', resultado_usd: 100, clave_ext: 'z' }]).ops[0];
    const FZ = (lado) => ({ ...be, lado, contratos: 1, ejecutado_at: '2026-10-06T00:00:00Z', fecha_ny: '2026-10-06', spot: 429, spot_fuente: 'm1' });
    const fZ = K.filaHistorialCuentas(opZ, { fills: [FZ('compra'), FZ('venta')], senales: [] });
    assert(/<span class="csub">contrato \+50\.0 % · sin hora · intradía no medible<\/span>/.test(fZ) && /<span class="c1">440 · \+\$11\.00 \(\+2\.56 %\) fuera<\/span><span class="csub">sin hora<\/span>/.test(fZ)
      && /title="\$429\.00 → \$429\.00 \(el bróker no dio la hora: precio de cierre del día, no del fill\)/.test(fZ), 'fills sin hora (Schwab a 00:00Z): en corto «sin hora · intradía no medible» y el strike «sin hora»; el aviso entero en el title', fZ.replace(/\s+/g, ' ').slice(0, 600));
    // CSS: Cuentas usa el ancho grande en la computadora, y las celdas largas ya no fuerzan anchos mínimos
    assert(/@media \(min-width:900px\)\{[^}]*#app\.ancho\.tk\{max-width:1560px\}\s*#app\.ancho\.cta\{max-width:1560px\}/.test(INDEX), 'CSS: #app.ancho.cta{max-width:1560px} en ≥ 900 px, junto a la de Tickers (con el padding lateral de #app.ancho main.vista)');
    assert(!/nth-child\(13\)\{min-width:170px\}/.test(INDEX) && /\.ctbl td\.ctxt \.c1\{display:block;white-space:nowrap/.test(INDEX) && /\.ctbl td:not\(\.ctxt\) \.csub\{white-space:nowrap\}/.test(INDEX),
      'CSS: sin los min-width de 170/130 px; la línea .c1 no se parte y el «bruto» / «sin comisión» va en una línea');
  }

  // ════════════════ 13. v62 rev3 · los arreglos de la revisión de rev2, con las funciones REALES ════════════════
  // (a) un viaje del MISMO día con la vela DIARIA en las dos patas (el worker pone 'dia' a los fills de más de ~5 días),
  //     AUNQUE los fills traigan hora: ni «acción plana» ni «0.00 %». El caso real: SPY PUT 757 del 14 sep, E*TRADE
  //     10:23:09 → 10:36:31, las dos patas a 760.8812 ('dia').
  {
    const be = { broker: 'etrade', symbol: 'SPY', direccion: 'PUT', strike: 757, expiracion: '2026-09-14' };
    const filas = [{ ...be, contratos: 41, prima_fill: 0.41, prima_salida: 0.57, abierta_at: '2026-09-14T14:23:09+00:00', cerrada_at: '2026-09-14T14:36:31+00:00', resultado_usd: 613.91, fees: 42.09, clave_ext: 'p1', raw: { abre: '943', cierra: '945' } },
      { ...be, contratos: 9, prima_fill: 0.42, prima_salida: 0.57, abierta_at: '2026-09-14T14:23:09+00:00', cerrada_at: '2026-09-14T14:36:31+00:00', resultado_usd: 125.76, fees: 9.24, clave_ext: 'p2', raw: { abre: '944', cierra: '945' } }];
    const op = K.unirOperaciones([], filas).ops[0];
    const FD = (lado, c, at, o) => ({ ...be, lado, contratos: c, ejecutado_at: at, fecha_ny: '2026-09-14', spot: 760.8812, spot_fuente: 'dia', ...(o || {}) });
    const fD = [FD('compra', 41, '2026-09-14T14:23:09+00:00', { clave_ext: '943' }), FD('compra', 9, '2026-09-14T14:23:09+00:00', { clave_ext: '944' }), FD('venta', 50, '2026-09-14T14:36:31+00:00', { clave_ext: '945' })];
    const sD = K.spotDeOperacion(op, fD);
    igual([sD.entrada, sD.salida, sD.sin_hora, sD.fuente_entrada, sD.fuente_salida, sD.mov, sD.n_mov, sD.partes.map(x => x.mov)], [760.8812, 760.8812, false, 'dia', 'dia', null, 0, [null, null]],
      '(rev3) fills CON hora y fuente «dia» en las dos patas del mismo día: sin sin_hora, pero sin movimiento medible (mov null en la operación y en cada ida y vuelta)');
    const dD = K.detalleOpCuentas(op, { fills: fD, senales: [] }), AD = K.accionOpCuentas(op, dD);
    assert(AD.mov === null && /movimiento intradía no medible \(cierre del día en las dos patas\)/.test(AD.vs) && !/acción plana/.test(AD.vs), '(rev3) «movimiento intradía no medible (cierre del día en las dos patas)», nunca «acción plana»', AD.vs);
    assert(!/0\.00 %/.test(AD.accion + AD.vs + AD.corta.linea) && /\$760\.88 → \$760\.88 <span class="fresco">\(cierre del día\)<\/span>/.test(AD.accion), '(rev3) la acción sin un 0.00 % inventado y con su fuente «(cierre del día)»', AD.accion);
    assert(!/no dio la hora|sin hora/.test(AD.accion + AD.vs + AD.strike), '(rev3) y sin decir que el bróker no dio la hora: los fills la traen');
    assert(AD.corta.etq.includes('intradía no medible') && !AD.corta.etq.includes('acción plana') && AD.corta.etq.includes('cierre del día'), '(rev3) en corto: «cierre del día · intradía no medible», sin «acción plana»', JSON.stringify(AD.corta.etq));
    const tD = K.tarjetaHistorial(op, { fills: fD, senales: [] }), rD = K.filaHistorialCuentas(op, { fills: fD, senales: [] });
    assert(!/acción plana|\(0\.00 %\)/.test(tD) && !/acción plana|\(0\.00 %\)/.test(rD), '(rev3) ni la tarjeta ni la fila de la tabla (desglose de idas y vueltas incluido) dicen «acción plana» ni «(0.00 %)»');
    // de un día para otro con la vela diaria: el movimiento SÍ se mide (de cierre a cierre) y lo dice
    const opN = K.unirOperaciones([], [{ ...filas[0], cerrada_at: '2026-09-15T14:36:31+00:00' }]).ops[0];
    const sN = K.spotDeOperacion(opN, [FD('compra', 41, '2026-09-14T14:23:09+00:00'), FD('venta', 41, '2026-09-15T14:36:31+00:00', { fecha_ny: '2026-09-15', spot: 765 })]);
    cerca(sN.mov, (765 - 760.8812) / 760.8812 * 100, '(rev3) «dia» de un día para otro: el movimiento se mide (de cierre a cierre)', 1e-3);
    // una sola pata con la vela diaria (la otra con la del minuto): se mide
    const sM = K.spotDeOperacion(op, [FD('compra', 41, '2026-09-14T14:23:09+00:00', { spot: 760.2, spot_fuente: 'm1' }), FD('venta', 41, '2026-09-14T14:36:31+00:00')]);
    assert(sM.mov != null && sM.fuente_salida === 'dia', '(rev3) el mismo día con «dia» en UNA sola pata: se mide (con la fuente peor a la vista)', JSON.stringify(sM.partes));
  }
  // (b) filas de E*TRADE SUSTITUIDAS (el ID pendiente y el contabilizado): con el libro de fills cuentan una vez
  {
    const be = { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 764, expiracion: '2026-09-17', osi: 'SPY|2026-09-17|CALL|764' };
    const buena = { ...be, contratos: 1, prima_fill: 0.14, prima_salida: 0.11, abierta_at: '2026-09-17T18:17:14+00:00', cerrada_at: '2026-09-17T18:22:47+00:00', resultado_usd: -4.03, fees: 1.03,
      clave_ext: 'SPY|2026-09-17|CALL|764#26260501293386>26260501293387#1', raw: { abre: '26260501293386', cierra: '26260501293387', tipo: 'Sold To Close' } };
    const vieja = { ...be, contratos: 1, prima_fill: 0.14, prima_salida: 0.11, abierta_at: '2026-09-17T18:19:16+00:00', cerrada_at: '2026-09-17T18:24:50+00:00', resultado_usd: -4.0, fees: 1.0,
      clave_ext: 'SPY|2026-09-17|CALL|764#26260201484550>26260201541834#1', raw: { abre: '26260201484550', cierra: '26260201541834', tipo: 'Sold' } };
    const FL = (id, lado, at) => ({ broker: 'etrade', clave_ext: id, symbol: 'SPY', direccion: 'CALL', strike: 764, expiracion: '2026-09-17', lado, contratos: 1, ejecutado_at: at, fecha_ny: '2026-09-17' });
    const libro = [FL('26260501293386', 'compra', '2026-09-17T18:17:14+00:00'), FL('26260501293387', 'venta', '2026-09-17T18:22:47+00:00')];
    const sin = K.unirOperaciones([], [vieja, buena]).ops, con = K.unirOperaciones([], [vieja, buena], libro).ops;
    igual(sin.map(o => [o.contratos, o.resultado_usd, o._partes_filas.length]), [[2, -8.03, 2]], 'sin el libro, como siempre: ×2 −$8.03 (la fila sustituida suma dos veces)');
    igual(con.map(o => [o.contratos, o.resultado_usd, o._partes_filas.length, o._partes_filas[0].clave_ext]), [[1, -4.03, 1, buena.clave_ext]], '(rev3) con el libro: UNA operación ×1 −$4.03, la fila cuyos IDs están en el libro');
    igual(K.filasEtradeVigentes([vieja, buena], libro), [buena], 'filasEtradeVigentes: descarta la fila «Sold» a +2:02 cuyos IDs no están en el libro');
    const arr = [vieja, buena];
    igual([K.filasEtradeVigentes(arr, []) === arr, K.filasEtradeVigentes(arr, null) === arr, K.filasEtradeVigentes(arr, [{ ...libro[0], broker: 'tasty' }]) === arr], [true, true, true], 'sin libro de E*TRADE (vacío, caído o de otro bróker): las filas tal cual');
    igual(K.filasEtradeVigentes([vieja, buena], libro.slice(0, 1)).length, 2, 'si la gemela tampoco está ENTERA en el libro, nada se tira (el libro no puede desmentirla)');
    igual(K.filasEtradeVigentes([vieja, { ...buena, prima_salida: 0.12 }], libro).length, 2, 'con otra prima no es gemela: se queda');
    igual(K.filasEtradeVigentes([{ ...vieja, abierta_at: '2026-09-17T18:20:20+00:00' }, buena], libro).length, 2, 'con la apertura a más de 3 min (3:06) no es gemela: se queda');
    igual(K.filasEtradeVigentes([{ ...vieja, raw: { abre: '26260501293386', cierra: '26260501293387' }, clave_ext: 'otra' }, buena], libro).length, 2, 'dos filas con los IDs en el libro (dos viajes de verdad iguales): las dos se quedan');
    igual(K.filasEtradeVigentes([vieja, buena, { ...vieja, broker: 'tasty' }], libro).map(t => t.broker), ['etrade', 'tasty'], 'solo E*TRADE: las filas de otros brókeres no se tocan');
    // un vencimiento anotado DOS veces (META CALL 690 del 16 sep: el mismo lote, otro ID de cierre a 1 h 31 min): cuenta una
    const bm = { broker: 'etrade', symbol: 'META', direccion: 'CALL', strike: 690, expiracion: '2026-09-16' };
    const vb = { ...bm, contratos: 5, prima_fill: 1.71, prima_salida: 0, abierta_at: '2026-09-16T13:53:50+00:00', cerrada_at: '2026-09-17T07:00:00+00:00', resultado_usd: -857.56, fees: 2.56, clave_ext: 'm#846>379#5', raw: { abre: '846', cierra: '379', tipo: 'Option Expired' } };
    const vv = { ...vb, cerrada_at: '2026-09-17T08:31:38+00:00', clave_ext: 'm#846>551#5', raw: { abre: '846', cierra: '551', tipo: 'Option Expired' } };
    const libM = [{ ...bm, broker: 'etrade', clave_ext: '846', lado: 'compra', contratos: 5 }, { ...bm, broker: 'etrade', clave_ext: '379', lado: 'vencimiento', contratos: 7 }];
    igual(K.unirOperaciones([], [vb, vv], libM).ops.map(o => [o.contratos, o.resultado_usd]), [[5, -857.56]], '(rev3) el vencimiento anotado dos veces (mismo lote de apertura, cierre fuera del libro): ×5 −$857.56, no ×10');
    // Cuentas y la comprobación del Diario pasan el libro (sin él si la lectura falló)
    assert(/unirOperaciones\(posR\.data \|\| \[\], btR\.data \|\| \[\], fillsR\.error \? null : fillsR\.filas\)/.test(extraer('vistaCuentasSaldos')), 'vistaCuentasSaldos: unirOperaciones con el libro de fills (null si la lectura falló)');
    assert(/unirOperaciones\(posic, btR\.data \|\| \[\], fillsR\.error \? null : fills\)/.test(extraer('vistaDiario')), 'vistaDiario: «¿coincide con Cuentas?» con el mismo libro');
  }
// v62 rev4: TODAS las pantallas que suman operaciones pasan el libro (mismas cifras en Cuentas, Disciplina y los cupos)
{
  const llamadas = (C.FUENTE.match(/unirOperaciones\([^)]*\)/g) || []).filter(x => !/^unirOperaciones\(posic, trades, fills\)$/.test(x));
  C.assert(llamadas.length >= 5 && llamadas.every(x => /,\s*[^,()]+\)$/.test(x) && x.split(',').length >= 3), 'cada llamada a unirOperaciones pasa el libro como tercer argumento: ' + llamadas.join(' | '));
  C.assert(/async function libroParaUnir\(\)/.test(C.FUENTE), 'un solo lector del libro para unir (caché de 60 s; null si falla)');
}

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
