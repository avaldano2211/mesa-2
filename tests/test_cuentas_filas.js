#!/usr/bin/env node
/* Pruebas de la v67 · C «Cuentas por FILAS, el día de cada cierre» (Andrés, domingo 2026-11-01, mercado cerrado: «sí,
   arréglalo y publícalo YA QUE ESTA CERRADO EL MERCADO»). Hasta la v66 Cuentas agrupaba las filas de broker_trades por
   contrato + día de apertura + bróker y el grupo contaba ENTERO el día de su ÚLTIMO cierre: un CALL ×3 de tasty con dos
   tramos vendidos el día de la compra y el resto vencido otro día ponía los tres el día del vencimiento (y en agosto
   moomoo tenía días descuadrados con el Diario aunque el total cuadraba). Ahora todo lo que atribuye RESULTADO a un día o
   período (utilidad del día, semana, mes y año, capital, comisiones, «lo ganado de la semana» de Disciplina) va por FILA
   del bróker, en el día NY de su cerrada_at, como el Diario; la OPERACIÓN se cuenta el día en que queda plana, con su
   resultado entero (como un viaje del Diario), y su tarjeta y su fila siguen agrupadas. Funciones REALES del fuente con
   dependencias falsas (casa_pruebas.js); todos los datos son de juguete.
   Uso: node test_cuentas_filas.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_cuentas_filas.js');
const { FUENTE, assert, igual, construir, existeConst, ymdNY, nodo, sbFalso, esc, usd, BROKER_NOMBRE } = C;
const existe = (n) => new RegExp('^(?:async )?function ' + n + '\\s*\\(', 'm').test(FUENTE);

// Cuentas (unirOperaciones y sus lectores, los períodos y los tiles) y el Diario (el FIFO del libro y el día a día)
const NOMBRES = ['unirOperaciones', 'filasEtradeVigentes', 'fillsEtradeVigentes', 'tipoFillEtrade', 'claveFill', 'claveContrato', 'instanteVencimiento',
  'vencimientoMoomoo', 'filasMoomooVencimiento', 'filasSchwabVencimiento', 'cerradasDesde', 'aportePeriodoCuentas', 'resumenPeriodo', 'metricasCuentas',
  'comisionDelBroker', 'tilesCuentasHtml', 'detalleOpCuentas', 'diaOpNY', 'diaAperturaOp', 'sinHoraIso', 'horaNY', 'fechaNyTransaccion', 'dteEntrada',
  'diasEntre', 'filaVencioCuentas', 'filaPresuntaCuentas', 'spotDeOperacion', 'partesOpCuentas', 'senalDeOperacion', 'spotDeFill', 'peorFuenteSpot',
  'emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'durMin', 'diaADia'].filter(existe);
const CONSTS = ['ET_PROV_ANTES_MS', 'ET_PROV_DESPUES_MS', 'ET_TIPO_PROVISIONAL', 'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT', 'BROKERS_CON_COMISION', 'BROKER_CORTO',
  'CTA_MARGEN_MS', 'dineroD', 'pctD2', 'usd', 'colUtil', 'esc'].filter(existeConst);
const K = construir(NOMBRES, { ymdNY, hoyNY: () => '2026-11-01' }, { consts: CONSTS });
const r2 = (n) => Math.round(n * 100) / 100;
const copia = (x) => JSON.parse(JSON.stringify(x));
// El $ y los contratos de Cuentas en UN día NY, con las funciones reales: lo que dice el período que empieza ese día menos
// lo que dice el que empieza el día siguiente (resumenPeriodo solo tiene «desde»; así sale el día suelto)
const sig = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const delDia = (ops, d) => ({ util: r2(K.resumenPeriodo(ops, d).util - K.resumenPeriodo(ops, sig(d)).util), n: K.resumenPeriodo(ops, d).n - K.resumenPeriodo(ops, sig(d)).n });
const ctosDia = (ops, d) => K.cerradasDesde(ops, d).reduce((s, t) => s + Number(t.contratos), 0) - K.cerradasDesde(ops, sig(d)).reduce((s, t) => s + Number(t.contratos), 0);

// ════════════════ 1. tasty: dos tramos vendidos el viernes y el resto vencido el lunes ════════════════
// CALL ×3 comprado el vie 16-oct a $1.30 (comisión $1.50), vende 1 a $1.10 y 1 a $1.05 ese viernes ($0.64 cada venta) y
// el último vence el lun 19-oct (la fila «>venc» del worker 0.1.12, a las 16:30 ET).
const T = { broker: 'tasty', symbol: 'NVDA', direccion: 'CALL', strike: 230, expiracion: '2026-10-19', abierta_at: '2026-10-16T14:00:00Z', prima_fill: 1.30 };
const BT_T = [
  { ...T, contratos: 1, prima_salida: 1.10, cerrada_at: '2026-10-16T14:30:00Z', resultado_usd: -21.14, fees: 1.14, clave_ext: 'c1>v1' },
  { ...T, contratos: 1, prima_salida: 1.05, cerrada_at: '2026-10-16T15:00:00Z', resultado_usd: -26.14, fees: 1.14, clave_ext: 'c1>v2' },
  { ...T, contratos: 1, prima_salida: 0, cerrada_at: K.instanteVencimiento('2026-10-19'), resultado_usd: -130.5, fees: 0.5, clave_ext: 'c1>venc2026-10-19', raw: { cierra: 'vencimiento' } },
];
// el mismo viaje en el libro de fills (lo que suma el Diario): el vencimiento lo deduce el FIFO (expiración pasada)
const FT = { broker: 'tasty', symbol: 'NVDA', direccion: 'CALL', strike: 230, expiracion: '2026-10-19' };
const FILLS_T = [
  { ...FT, lado: 'compra', contratos: 3, precio: 1.30, comision: 1.50, ejecutado_at: '2026-10-16T14:00:00Z', fecha_ny: '2026-10-16', clave_ext: 'c1' },
  { ...FT, lado: 'venta', contratos: 1, precio: 1.10, comision: 0.64, ejecutado_at: '2026-10-16T14:30:00Z', fecha_ny: '2026-10-16', clave_ext: 'v1' },
  { ...FT, lado: 'venta', contratos: 1, precio: 1.05, comision: 0.64, ejecutado_at: '2026-10-16T15:00:00Z', fecha_ny: '2026-10-16', clave_ext: 'v2' },
];
{
  const u = K.unirOperaciones([], copia(BT_T));
  igual([u.ops.length, u.ops[0].contratos, u.ops[0].resultado_usd, u.ops[0]._partes_filas.length], [1, 3, -177.78, 3], 'la operación sigue AGRUPADA: una sola ×3 −$177.78 con sus 3 filas');
  const ops = u.ops;
  igual(K.cerradasDesde(ops, '2026-10-19').map(t => t.resultado_usd), [-130.5], 'cerradasDesde abre el grupo del bróker: desde el lunes solo cuenta la fila del vencimiento (v66: el grupo entero)');
  igual(r2(K.cerradasDesde(ops, '2026-10-12').reduce((s, t) => s + t.resultado_usd, 0)), -177.78, 'y la semana del 12 suma las tres filas');
  igual([delDia(ops, '2026-10-16'), delDia(ops, '2026-10-19')], [{ util: -47.28, n: 0 }, { util: -130.5, n: 1 }],
    'POR DÍA: el viernes −$47.28 (los dos tramos vendidos, sin operación plana) y el lunes −$130.50 y la operación (v66: $0 el viernes y −$177.78 el lunes)');
  igual([ctosDia(ops, '2026-10-16'), ctosDia(ops, '2026-10-19')], [2, 1], 'los contratos también por día: 2 el viernes y 1 el lunes');
  const Rl = K.resumenPeriodo(ops, '2026-10-19');
  igual([Rl.util, Rl.n, Rl.mejor, Rl.peor, Rl.winrate], [-130.5, 1, -177.78, -177.78, 0], 'la semana del lunes 19: utilidad −$130.50 (por fila) y UNA operación, que cuenta con su resultado ENTERO (−$177.78) el día en que quedó plana');
  const Rs = K.resumenPeriodo(ops, '2026-10-12');
  igual([Rs.util, Rs.n], [-177.78, 1], 'la semana del 12 (o el mes): todo, una operación');
  igual(K.resumenPeriodo(ops, '2000-01-01').util, r2(BT_T.reduce((s, t) => s + t.resultado_usd, 0)), 'el total de la historia NO cambia: la suma de las filas');

  // Diario = Cuentas, día por día (las funciones reales del Diario sobre el mismo viaje)
  if (K.emparejarFillsFIFO && K.diaADia) {
    const F = K.emparejarFillsFIFO(copia(FILLS_T), '2026-11-01');
    const dD = {}; K.diaADia(F.cerradas, null, null, F.viajes).forEach(x => { dD[x.fecha_ny] = [x.total, x.ops]; });
    igual(dD, { '2026-10-16': [-47.28, 0], '2026-10-19': [-130.5, 1] }, 'el Diario: −$47.28 sin operación el viernes y −$130.50 con la operación el lunes');
    igual({ '2026-10-16': [delDia(ops, '2026-10-16').util, delDia(ops, '2026-10-16').n], '2026-10-19': [delDia(ops, '2026-10-19').util, delDia(ops, '2026-10-19').n] }, dD,
      'Diario = Cuentas por DÍA: el mismo $ y las mismas operaciones cada día');
    igual([F.viajes.length, F.viajes[0].pnl], [1, u.ops[0].resultado_usd], 'y el viaje del Diario es la operación de Cuentas: el mismo resultado entero');
  }

  // las métricas de la pantalla, sobre el mismo período
  const M = K.metricasCuentas(Rl.ops, '2026-10-19');
  igual([M.util, M.n, M.capital, M.rentabilidad, M.comisiones, M.mejor, M.sin_cerrar], [-130.5, 1, 130, -100.38, 0.5, -177.78, 0],
    'métricas del lunes: utilidad −$130.50, capital $130 y comisión $0.50 de la fila del vencimiento; la operación con su −$177.78');
  igual([M.util, M.n, M.winrate, M.mejor, M.peor], [Rl.util, Rl.n, Rl.winrate, Rl.mejor, Rl.peor], 'metricasCuentas COHERENTE con resumenPeriodo por filas');
  const Ms = K.metricasCuentas(Rs.ops, '2026-10-12');
  igual([Ms.util, Ms.capital, Ms.comisiones, Ms.por_broker.map(x => [x.clave, x.ops, x.utilidad])], [-177.78, 390, 2.78, [['tasty', 1, -177.78]]], 'la semana entera: $, capital y comisiones de las tres filas; por bróker, una operación');
  // la tarjeta (agrupada) y su marca «venció en parte» no cambian
  const d = K.detalleOpCuentas(ops[0], { fills: [], senales: [] });
  igual([d.vencioEnParte, d.expirada, d.neto, d.c], [true, false, -177.78, 3], 'la tarjeta de la operación sigue agrupada: ×3, −$177.78 y «venció en parte»');
}

// ════════════════ 2. el «Hoy» del viernes (aún sin la fila del vencimiento) y la abierta con un tramo cobrado ════════════════
{
  const viernes = K.unirOperaciones([], copia(BT_T.slice(0, 2))).ops;
  igual([K.resumenPeriodo(viernes, '2026-10-16').util, K.resumenPeriodo(viernes, '2026-10-16').n], [-47.28, 1], 'el viernes, con lo que había (dos filas): −$47.28 y una operación (el bróker solo trae idas y vueltas cerradas)');
  // ficha a mano abierta con un tramo cobrado (GTC llenada a medias): su dinero va al período, la operación aún no cuenta
  const base = { symbol: 'SPY', direccion: 'PUT', strike: 660, expiracion: '2026-10-30', prima_fill: 1.00, broker: 'etrade', abierta_at: '2026-10-20T14:00:00Z', abierta_fecha_ny: '2026-10-20' };
  const ab = K.unirOperaciones([{ id: 1, ...base, contratos: 3, estado: 'abierta', resultado_usd: null },
    { id: 2, ...base, contratos: 2, prima_salida: 1.72, estado: 'cerrada', cerrada_at: '2026-10-21T15:00:00Z', resultado_usd: 144 }], []).ops;
  const R = K.resumenPeriodo(ab, '2026-10-19'), M = K.metricasCuentas(R.ops, '2026-10-19');
  igual([R.util, R.n, M.util, M.n, M.sin_cerrar, M.capital], [144, 0, 144, 0, 1, 200], 'abierta con un tramo cobrado: $144 en la utilidad, 0 operaciones planas y +1 «con dinero sin quedar plana»');
  assert(/0 ops/.test(K.tilesCuentasHtml(M, 'semana')) && /\+1 con dinero aquí que no quedó plana en el período/.test(K.tilesCuentasHtml(M, 'semana')), 'el tile OPERACIONES lo dice: «0 ops» y «+1 con dinero aquí que no quedó plana en el período»');
  // y debajo de los tiles, SIEMPRE (como el «bajo el día» del Diario), cómo se reparte el período
  const tl = K.tilesCuentasHtml(M, 'dia'), tl0 = K.tilesCuentasHtml(K.metricasCuentas([], '2026-10-19'), 'dia');
  assert([tl, tl0].every(h => /<\/div>\s*<div class="fresco"[^>]*>el \$, el capital y las comisiones van por cada venta o vencimiento, en su día de Nueva York \(como el Diario\) · una operación cuenta, con su resultado entero, el día en que quedó plana · el historial la enseña entera<\/div>$/.test(h.trim()))
    && (tl.match(/class="dcard"/g) || []).length === 8,
    'bajo los tiles (con o sin operaciones): «el $… va por cada venta o vencimiento, en su día de Nueva York (como el Diario) · una operación cuenta… el día en que quedó plana»; siguen siendo 8 tiles');
}

// ════════════════ 3. moomoo: la venta a $0 anotada de madrugada tras el vencimiento (v65 rev7) sigue en su día ════════════════
{
  const M0 = { broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 450, expiracion: '2026-10-23', abierta_at: '2026-10-22T14:00:00Z', prima_fill: 1.00, fees: 0 };
  const bt = [{ ...M0, contratos: 1, prima_salida: 1.50, cerrada_at: '2026-10-22T16:00:00Z', resultado_usd: 50, clave_ext: 'm1' },
    { ...M0, contratos: 1, prima_salida: 0, cerrada_at: '2026-10-24T05:22:00Z', resultado_usd: -100, clave_ext: 'm2' }];   // sáb 01:22 ET
  const ops = K.unirOperaciones([], copia(bt)).ops;
  igual([ops.length, ops[0].cerrada_at], [1, K.instanteVencimiento('2026-10-23')], 'moomoo: una operación; su último cierre es el vencimiento del viernes a las 16:30 ET (no el sábado)');
  igual([delDia(ops, '2026-10-22'), delDia(ops, '2026-10-23'), delDia(ops, '2026-10-24')], [{ util: 50, n: 0 }, { util: -100, n: 1 }, { util: 0, n: 0 }],
    'por día: +$50 el jueves (la venta), −$100 el viernes (el vencimiento, releído a su día) y nada el sábado (v66: −$50 todo el viernes)');
  const FM = { broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 450, expiracion: '2026-10-23' };
  const F = K.emparejarFillsFIFO([{ ...FM, lado: 'compra', contratos: 2, precio: 1.00, comision: 0, ejecutado_at: '2026-10-22T14:00:00Z', fecha_ny: '2026-10-22', clave_ext: 'a' },
    { ...FM, lado: 'venta', contratos: 1, precio: 1.50, comision: 0, ejecutado_at: '2026-10-22T16:00:00Z', fecha_ny: '2026-10-22', clave_ext: 'b' },
    { ...FM, lado: 'venta', contratos: 1, precio: 0, comision: 0, ejecutado_at: '2026-10-24T05:22:00Z', fecha_ny: '2026-10-24', clave_ext: 'c' }], '2026-11-01');
  const dD = {}; K.diaADia(F.cerradas, null, null, F.viajes).forEach(x => { dD[x.fecha_ny] = [x.total, x.ops]; });
  igual({ '2026-10-22': [50, 0], '2026-10-23': [-100, 1] }, dD, 'Diario = Cuentas por día también en moomoo');
}

// ════════════════ 4. E*TRADE: «Option Expired» anotado el miércoles (filasEtradeVigentes) ════════════════
{
  const E = { broker: 'etrade', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-27', abierta_at: '2026-10-26T14:00:00Z', prima_fill: 2.00 };
  const bt = [{ ...E, contratos: 1, prima_salida: 2.50, cerrada_at: '2026-10-26T15:00:00Z', resultado_usd: 48.70, fees: 1.30, clave_ext: 'e1', raw: { tipo: 'Sold To Close', abre: 1, cierra: 2 } },
    { ...E, contratos: 1, prima_salida: 0, cerrada_at: '2026-10-28T04:00:00Z', resultado_usd: -200.65, fees: 0.65, clave_ext: 'e2', raw: { tipo: 'Option Expired', abre: 1, cierra: 3 } }];
  const ops = K.unirOperaciones([], copia(bt), null).ops;
  igual([delDia(ops, '2026-10-26'), delDia(ops, '2026-10-27'), delDia(ops, '2026-10-28')], [{ util: 48.7, n: 0 }, { util: -200.65, n: 1 }, { util: 0, n: 0 }],
    'E*TRADE: +$48.70 el lunes (la venta) y −$200.65 el martes (el vencimiento en su día, no el miércoles de la anotación)');
  const M = K.metricasCuentas(K.resumenPeriodo(ops, '2026-10-27').ops, '2026-10-27');
  igual([M.util, M.comisiones, M.com_brokers], [-200.65, 0.65, ['etrade']], 'las comisiones van por fila: el martes solo la del vencimiento ($0.65)');
}

// ════════════════ 5. Schwab: la «>venc» presunta (v66 A3) y la regla «sin dato no es $0» ════════════════
{
  const S = { broker: 'schwab', symbol: 'QQQ', direccion: 'CALL', strike: 600, expiracion: '2026-11-06', abierta_at: '2026-11-05T15:00:00Z', prima_fill: 1.00, fees: null };
  const bt = [{ ...S, contratos: 1, prima_salida: 1.20, cerrada_at: '2026-11-05T19:00:00Z', resultado_usd: 20, clave_ext: 's1' },
    { ...S, contratos: 1, prima_salida: 0, cerrada_at: '2026-11-06T20:00:00Z', resultado_usd: -100, clave_ext: 's1>venc2026-11-06', raw: { nota: 'pérdida total presunta' } }];
  const ops = K.unirOperaciones([], copia(bt)).ops;
  igual([ops[0].cerrada_at, delDia(ops, '2026-11-05'), delDia(ops, '2026-11-06')], [K.instanteVencimiento('2026-11-06'), { util: 20, n: 0 }, { util: -100, n: 1 }],
    'Schwab: la «>venc» releída a las 16:30 ET de su día; +$20 el jueves y −$100 el viernes');
  const d = K.detalleOpCuentas(ops[0], { fills: [], senales: [] });
  igual([d.vencioEnParte, d.presunta], [true, true], 'y la tarjeta sigue diciendo «venció en parte (presunto)»');
  const M = K.metricasCuentas(K.resumenPeriodo(ops, '2026-11-06').ops, '2026-11-06');
  igual([M.comisiones, M.sin_com_brokers], [null, ['schwab']], 'Schwab no manda comisión: «sin dato» (null), nunca $0');
}

// ════════════════ 6. fusión con una ficha a mano, filas sin cerrada_at y filas abiertas ════════════════
{
  const ficha = { id: 9, symbol: 'NVDA', direccion: 'CALL', strike: 230, expiracion: '2026-10-19', contratos: 3, prima_fill: 1.30, estado: 'cerrada', broker: 'tasty',
    abierta_at: '2026-10-16T14:00:00Z', abierta_fecha_ny: '2026-10-16', cerrada_at: '2026-10-19T20:30:00Z', resultado_usd: -177, plan_pct: 10, stop_pct: 20, _salida_corte: true, entrada_semaforo: 'verde' };
  const u = K.unirOperaciones([ficha], copia(BT_T));
  const g = u.ops[0];
  igual([u.ops.length, u.fusionadas, g.plan_pct, g.stop_pct, g._salida_corte, g.entrada_semaforo, g.resultado_usd], [1, 1, 10, 20, true, 'verde', -177.78], 'fusionada con la ficha: una operación, el plan congelado de la ficha (plan_pct, stop_pct, salida_corte) y el $ del bróker');
  igual([delDia(u.ops, '2026-10-16'), delDia(u.ops, '2026-10-19')], [{ util: -47.28, n: 0 }, { util: -130.5, n: 1 }], 'y su dinero va igual por fila');
  // una fila sin cerrada_at no pertenece a NINGÚN período; una fila que dijera estar abierta tampoco cuenta
  const raras = copia(BT_T.slice(0, 2)).concat([{ ...T, contratos: 1, prima_salida: 1.40, cerrada_at: null, resultado_usd: 9.36, fees: 0.64, clave_ext: 'sin-fecha' },
    { ...T, contratos: 1, estado: 'abierta', resultado_usd: 99, cerrada_at: '2026-10-16T19:00:00Z', clave_ext: 'abierta' }]);
  const o2 = K.unirOperaciones([], raras).ops;
  igual(K.cerradasDesde(o2, '2000-01-01').map(t => t.clave_ext), ['c1>v1', 'c1>v2'], 'sin cerrada_at (ni en «todo») y abierta: fuera de todo período');
  igual(K.resumenPeriodo(o2, '2000-01-01').util, -47.28, 'su dinero no aparece en ningún día ni período');
  // v67 rev69 (juez de Cuentas) · y los tiles NO se contradicen: la fila que dice estar ABIERTA deja la operación sin
  // quedar plana (como el tramo abierto de una ficha a mano), así que no cuenta como ganadora con un resultado que suma
  // filas fuera de todo período (antes: −$47.28 de utilidad con 1 ganadora, 100 % y mejor +$61.08)
  const Mr = K.metricasCuentas(K.resumenPeriodo(o2, '2000-01-01').ops, '2000-01-01');
  igual([Mr.util, Mr.n, Mr.ganadoras, Mr.winrate, Mr.mejor, Mr.ganancia_bruta, Mr.sin_cerrar], [-47.28, 0, 0, 0, null, 0, 1],
    'una fila ABIERTA en el grupo: −$47.28 de utilidad, 0 operaciones planas, ninguna ganadora, sin mejor y +1 «con dinero sin quedar plana»');
  // la fila SIN cerrada_at (la columna lo admite) tampoco entra en el resultado entero: la operación cuenta con lo que
  // cuentan sus filas con fecha (antes: −$31.30 de utilidad y a la vez 1 ganadora, 100 %, mejor +$167.40 y factor «sin pérdidas»)
  const E = { broker: 'etrade', symbol: 'AAPL', direccion: 'CALL', strike: 270, expiracion: '2026-10-30', abierta_at: '2026-10-27T14:00:00Z', prima_fill: 1.00 };
  const o3 = K.unirOperaciones([], [{ ...E, contratos: 1, prima_salida: 0.70, cerrada_at: '2026-10-27T15:00:00Z', resultado_usd: -31.30, fees: 1.30, clave_ext: 'x1' },
    { ...E, contratos: 1, prima_salida: 3.00, cerrada_at: null, resultado_usd: 198.70, fees: 1.30, clave_ext: 'x2' }], null).ops;
  const Rs3 = K.resumenPeriodo(o3, '2026-10-26'), Ms3 = K.metricasCuentas(Rs3.ops, '2026-10-26');
  igual([Ms3.util, Ms3.n, Ms3.ganadoras, Ms3.perdedoras, Ms3.winrate, Ms3.mejor, Ms3.peor, Ms3.ganancia_bruta, Ms3.factor], [-31.3, 1, 0, 1, 0, -31.3, -31.3, 0, 0],
    'una fila SIN cerrada_at: la semana −$31.30 y UNA perdedora de −$31.30 (mejor = peor = la utilidad), sin ganancia bruta');
  igual([Rs3.util, Rs3.n, Rs3.ganadoras, Rs3.mejor], [-31.3, 1, 0, -31.3], 'resumenPeriodo dice lo mismo que los tiles');
  // con filas normales nada cambia: el resultado entero es el del grupo (la ficha fusionada de arriba, −$177.78)
  igual([K.resumenPeriodo(u.ops, '2026-10-19').mejor, K.metricasCuentas(K.resumenPeriodo(u.ops, '2026-10-19').ops, '2026-10-19').mejor], [-177.78, -177.78], 'con todas sus filas con fecha: el resultado entero de siempre');
}

// ════════════════ 7. Disciplina: «lo ganado de la semana» por fila (vistaDisciplina cableada) ════════════════
(async () => {
  if (existe('vistaDisciplina')) {
    const W = { broker: 'tasty', symbol: 'AAPL', direccion: 'CALL', strike: 250, expiracion: '2026-10-23', abierta_at: '2026-10-16T14:00:00Z', prima_fill: 1.00 };
    const trades = [{ ...W, contratos: 2, prima_salida: 2.00, cerrada_at: '2026-10-16T15:00:00Z', resultado_usd: 200, fees: 0, clave_ext: 'w1' },
      { ...W, contratos: 1, prima_salida: 1.30, cerrada_at: '2026-10-19T15:00:00Z', resultado_usd: 30, fees: 0, clave_ext: 'w2' }];
    const vista = nodo();
    const sb = sbFalso((tabla) => ({ posiciones: { data: [] }, broker_trades: { data: copia(trades) }, cuenta_snapshots: { data: [] }, ordenes: { data: [] } }[tabla] || { data: [] }));
    const D = construir(['vistaDisciplina', 'unirOperaciones', 'filasEtradeVigentes', 'instanteVencimiento', 'filasMoomooVencimiento', 'filasSchwabVencimiento', 'vencimientoMoomoo',
      'fillsEtradeVigentes', 'tipoFillEtrade', 'claveFill', 'claveContrato', 'cerradasDesde', 'reglasRotas', 'planDePct', 'fmtFechaNY', 'planActivo', 'planFilaCache', 'planUid'].filter(existe), {
      libroParaUnir: async () => null, sb, $: () => vista, cargarPlanUsuario: async () => null, sesionActiva: { user: { id: 'u1' } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      inicioPeriodo: () => '2026-10-01', lunesNY: () => '2026-10-19', hoyNY: () => '2026-10-20', nombreMesNY: () => 'octubre', BROKER_NOMBRE, usd, esc, ymdNY,
    }, { consts: ['PLANES', 'TICKERS', 'OPS_SEMANA', 'TAMANO_PCT', 'PLAN_K', '_plan', 'ET_PROV_ANTES_MS', 'ET_PROV_DESPUES_MS', 'ET_TIPO_PROVISIONAL', 'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'].filter(existeConst) });
    await D.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/EXCEDENTE A RETIRAR ESTE VIERNES/.test(h) && /\$30</.test(h) && !/\$230</.test(h),
      'Disciplina: lo ganado de la semana del 19 son los $30 de la fila vendida el lunes; los $200 del viernes 16 eran de la semana pasada (v66: $230)', (/EXCEDENTE[\s\S]{0,300}/.exec(h) || [''])[0].replace(/<[^>]*>/g, ' ').slice(0, 160));
    assert(/">0 \/ 3</.test(h), 'y el cupo sigue por APERTURA: abierta el viernes 16, no gasta cupo de la semana del 19');
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
