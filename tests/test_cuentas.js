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
const { FUENTE, assert, igual, construir, extraer, ymdNY, nodo, respirar } = C;
const RAIZ = path.join(path.dirname(process.argv[2]), '..');
const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// Claves ordenadas: compara objetos sin depender del orden en que se crearon
const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;

// Las funciones de Cuentas, REALES, con sus constantes del fuente
const NOMBRES = ['spotDeOperacion', 'senalDeOperacion', 'dteEntrada', 'metricasCuentas', 'sinHoraIso', 'detalleOpCuentas', 'horaOpCuentas',
  'contratoOpCuentas', 'entradaOpCuentas', 'salidaOpCuentas', 'duracionOpCuentas', 'accionOpCuentas', 'senalOpCuentasHtml', 'tramosOpCuentasHtml',
  'tarjetaHistorial', 'filaHistorialCuentas', 'tilesCuentasHtml', 'tablasDesgloseCuentasHtml', 'seccionHistorialCuentas', 'ctaVerMas', 'ctaCambiaFormato',
  'cuentasAncho', 'unirOperaciones', 'resumenPeriodo', 'cerradasDesde', 'claveContrato', 'spotDeFill', 'peorFuenteSpot', 'distanciaStrike', 'pctEsp',
  'usdSigno', 'horaNY', 'fechaCorta', 'durTxt', 'diasEntre', 'gestorFormato'];
const CONSTS = ['CTA_PASO', 'CTA_MARGEN_MS', '_cta', 'CTA_COLS', 'FUENTES_SPOT', 'FUENTE_SPOT_TXT', 'SIN_HORA_TXT', 'SIN_HORA_CORTO', 'LADO_DINERO',
  'BROKER_CORTO', 'BROKER_NOMBRE', 'MESES_ES_C', 'dineroD', 'pctD', 'pctD2', 'usd', 'colUtil', 'esc', 'GESTOR_ANCHO_TABLA'];
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

  // ════════════════ 2. A3 · spotDeOperacion ════════════════
  {
    const OP = { symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', broker: 'schwab', abierta_fecha_ny: '2026-10-06', abierta_at: '2026-10-06T14:57:00Z', cerrada_at: '2026-10-06T15:05:00Z' };
    const F = (o) => Object.assign({ broker: 'schwab', symbol: 'TSLA', direccion: 'CALL', strike: 392.5, expiracion: '2026-10-09', lado: 'compra', contratos: 1, fecha_ny: '2026-10-06', spot_fuente: 'm1' }, o);
    const fills = [
      F({ ejecutado_at: '2026-10-06T14:57:05Z', spot: 430 }),
      F({ ejecutado_at: '2026-10-06T14:59:00Z', spot: 431, contratos: 3, spot_fuente: 'm15' }),
      F({ ejecutado_at: '2026-10-06T15:06:30Z', spot: 432 }),                                     // dentro de los +2 min del cierre
      F({ ejecutado_at: '2026-10-06T15:30:00Z', spot: 440, contratos: 2 }),                        // otra compra DESPUÉS del cierre: otro viaje
      F({ ejecutado_at: '2026-10-07T14:00:00Z', fecha_ny: '2026-10-07', spot: 450 }),               // otro día
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: null }),                                     // sin spot: no cuenta
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: 500, broker: 'moomoo' }),                    // otro bróker
      F({ ejecutado_at: '2026-10-06T14:58:00Z', spot: 500, strike: 395 }),                         // otro contrato
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:02:00Z', spot: 432.5 }),
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:05:00Z', spot: 433, contratos: 3, spot_fuente: 'dia' }),
      F({ lado: 'venta', ejecutado_at: '2026-10-06T14:54:00Z', spot: 400 }),                       // antes de la apertura −2 min
      F({ lado: 'venta', ejecutado_at: '2026-10-06T15:08:00Z', spot: 400 }),                       // después del cierre +2 min
      F({ lado: 'vencimiento', ejecutado_at: '2026-10-06T15:03:00Z', spot: 400 }),                 // solo ventas dan la salida
    ];
    igual(K.spotDeOperacion(OP, fills), { entrada: 431, salida: 432.875, fuente_entrada: 'm15', fuente_salida: 'dia', sin_hora: false },
      'entrada = media ponderada por contratos (430×1 + 431×3 + 432×1) / 5 = 431; salida (432.5×1 + 433×3) / 4 = 432.875; la fuente es la PEOR de cada lado');
    igual(K.spotDeOperacion(OP, fills.filter(f => f.spot !== 431 && f.spot !== 432 && f.spot !== 433)), { entrada: 430, salida: 432.5, fuente_entrada: 'm1', fuente_salida: 'm1', sin_hora: false }, 'con un solo fill por lado, su spot y su fuente');
    igual(K.spotDeOperacion(OP, fills.map(f => ({ ...f, spot: null }))), { entrada: null, salida: null, fuente_entrada: null, fuente_salida: null, sin_hora: false }, 'sin ningún fill con spot: todo null («sin dato aún»)');
    igual(K.spotDeOperacion(OP, []).entrada, null, 'sin fills: null');
    igual(K.spotDeOperacion(OP, fills.filter(f => f.broker === 'moomoo' || f.strike === 395)).entrada, null, 'los fills de OTRO bróker u OTRO contrato no entran');
    igual(K.spotDeOperacion(OP, fills.filter(f => f.lado === 'venta' && (f.spot === 400))).salida, null, 'una venta fuera de la ventana (antes de la apertura −2 min o después del cierre +2 min) no entra');
    igual(K.spotDeOperacion({ ...OP, strike: null }, fills).entrada, null, 'una operación sin strike no tiene contrato: null');
    // E*TRADE: los fills son FECHAS (medianoche ET); la ventana va por día y se avisa
    const OPE = { ...OP, broker: 'etrade', cerrada_at: '2026-10-07T15:05:00Z' };
    const FE = (o) => F(Object.assign({ broker: 'etrade', ejecutado_at: '2026-10-06T04:00:00Z' }, o));
    igual(K.spotDeOperacion(OPE, [FE({ spot: 429.1 }), FE({ lado: 'venta', spot: 429.1 }), FE({ lado: 'venta', fecha_ny: '2026-10-07', ejecutado_at: '2026-10-07T04:00:00Z', spot: 433 }), FE({ lado: 'venta', fecha_ny: '2026-10-08', ejecutado_at: '2026-10-08T04:00:00Z', spot: 999 })]),
      { entrada: 429.1, salida: 431.05, fuente_entrada: 'm1', fuente_salida: 'm1', sin_hora: true }, 'E*TRADE (sin hora): compra el día de apertura; ventas entre el día de apertura y el de cierre (la del 8 no); sin_hora para decir «inicio del día»');
    igual(K.spotDeOperacion({ ...OPE, broker: null }, [FE({ spot: 429.1 })]).entrada, 429.1, 'una ficha a mano sin bróker se lee como de E*TRADE (como claveCartera)');
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
      ['desglose plegable', /<details class="ctram"><summary>2 idas y vueltas · ver el desglose<\/summary>/], ['tramo 1', /10:57 → 11:02[\s\S]*?\$2\.00 → \$2\.30[\s\S]*?\$28\.70/],
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
      assert(/sin dato aún \(el worker lo completa\)/.test(h), q + ': sin spot, «sin dato aún (el worker lo completa)»');
      assert(/sin señal ese día/.test(h), q + ': sin señal, «sin señal ese día»');
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
    assert(/E\*TRADE no da la hora: precio del inicio del día, no del fill/.test(tE) && /\(inicio del día\)/.test(tE), 'fills de E*TRADE: la acción dice que es el precio del INICIO del día, no del fill');
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
    assert(/else vistaCuentas\(\); cuentasAncho\(_cuentasVista === 'cuentas'\); \}/.test(FUENTE), 'MZ.cuentasVista: al pasar al Diario se quita .cta');
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
      const mod = C.cargarModuloEntero({ src: './app/main.js?v=62', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
      if (!mod.cargo) return { error: mod.error };
      mod.win.innerWidth = ancho;
      let html = '';
      const hist = nodo();
      mod.win.document.querySelector = (s) => { if (s === '#ctaHist') return hist; const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; };
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
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
