#!/usr/bin/env node
/* Pruebas de la v71 · «que la Mesa descuente las comisiones en el Diario» (Andrés, 7-nov-2026). Hasta la v70 la Mesa
   registraba comision = 0 en TODAS las ejecuciones de moomoo y el Diario y Cuentas enseñaban su P&L BRUTO, con un pie fijo
   que decía que moomoo no manda comisiones. Desde la sql 0023 y el worker 0.1.15, el worker pide a OpenD la comisión de
   cada ORDEN (order_fee_query) cuando la orden tiene ≥ 30 min, la reparte entre sus ejecuciones por contratos y la escribe
   en fills.comision con comision_fuente ('moomoo_orden' | 'moomoo_sin_dato'), comision_detalle (los conceptos de la orden
   entera) y comision_at; y en broker_trades.fees la parte de cada ida y vuelta. La app (que ya descontaba fills.comision en
   los tramos) ahora:
     · Diario: el pie dice de QUÉ brókeres son las comisiones del período (de los datos) y cuántas ejecuciones de moomoo
       tienen la comisión «pendiente» (comision 0, sin resolver, < 4 días hábiles NY) o «sin dato» (el worker no pudo, o null más
       vieja); con alguna, el total es «neto de las comisiones conocidas». Sin las columnas de la 0023 no afirma nada.
     · Lista de ejecuciones: «com pendiente» / «com sin dato» / «com $0.00» (un 0 real) y el desglose de la ORDEN en corto
       (OCC, ORF, SEC, TAF, CAT, contrato, bolsa) con esc().
     · Cuentas: moomoo con fees 0 es «aún sin dato», nunca «no la da» ni «sin comisión del bróker»; con datos mezclados se
       dice a la vez quién las da y cuántas idas y vueltas de moomoo aún no la traen. moomoo NO entra en BROKERS_CON_COMISION.
     · Versión v71 (index.html ?v=71, sw.js mesa2-v60).
   v71 rev (dos jueces, 7-nov): (1) Cuentas lee NETA la fila de moomoo con fees > 0 que el worker 0.1.15 deja en BRUTO
   (filasMoomooNetas; nunca dos descuentos si ya viene neta); (2) el FIFO del Diario reparte la comisión por ACUMULADO como el
   worker (Σ tramos = Σ fills.comision al centavo); (3) el pie del Diario mira también las ejecuciones de otro período que
   entran en sus tramos; (4) Cuentas dice POR QUÉ falta la comisión de moomoo con el libro (pendiente / sin dato / $0 real /
   sin libro) y solo promete la que el worker va a escribir; (5) «pendiente» en días HÁBILES NY (3 del worker + 1 de margen).
   Funciones REALES del fuente (casa_pruebas.js) y el módulo ENTERO en un DOM de juguete con un supabase de juguete (el
   Diario pintado de punta a punta). Datos de juguete: ni una cifra real. No toca la red, ni Supabase, ni ningún bróker.
   Uso: node test_comisiones_moomoo.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_comisiones_moomoo.js');
const { assert, igual, cerca, extraer, construir, ymdNY, nodo, sbFalso, respirar } = C;
const RAIZ = path.join(path.dirname(process.argv[2]), '..');

(async () => {
  // ════════════════ 0. versión v71 y lo que tiene que existir ════════════════
  {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
    assert(/config\.js\?v=72"/.test(html) && /app\/main\.js\?v=72"/.test(html), 'index.html carga config.js?v=72 y app/main.js?v=72');
    assert(/const VER = 'mesa2-v61';/.test(sw), 'sw.js VER mesa2-v61 (la caché vieja se borra al activarse)');
  }
  const NUEVAS = ['estadoComisionFill', 'detalleComisionFill', 'textoDetalleComision', 'comisionesDiario', 'textoComisionOpCuentas', 'parteComision',
    'comisionAunPendiente', 'estadoComisionCrudo', 'filasMoomooNetas', 'estadoComisionTramoMoomoo', 'comMoomooFila', 'marcarComisionMoomooCuentas', 'cortoComisionOpCuentas'];   // v71 rev
  const faltan = NUEVAS.filter(n => { try { extraer(n); return false; } catch (_) { return true; } });
  NUEVAS.forEach(n => assert(!faltan.includes(n), `existe function ${n} en el fuente`));
  // el pie fijo de la v70 ya no puede estar en ningún sitio
  assert(!/ni moomoo en sus ejecuciones/.test(C.FUENTE), 'el pie del Diario ya no dice «Schwab no las manda en sus órdenes ni moomoo en sus ejecuciones»');
  assert(!/moomoo \(ejecuciones de OpenD\) no mandan comisiones/.test(C.FUENTE), 'la lista de ejecuciones ya no dice que moomoo no manda comisiones');
  if (faltan.length) { C.resumen(); return; }

  // ════════════════ 1. estadoComisionFill: pendiente / sin dato / orden / nada (sin columnas) ════════════════
  const HOY = '2026-11-09';                                   // lunes
  const AHORA = Date.parse('2026-11-09T21:00:00Z');           // 16:00 ET
  const DIA = 86400000;
  const D = construir(['emparejarFillsFIFO', 'cuentaFill', 'textoCuentaMoomoo', 'instanteVencimiento', 'vencimientoMoomoo', 'fillSoloVencimiento', 'viajeDe', 'operacionCerrada', 'parteComision', 'claveFill', 'durMin', 'diasEntre',
    'diaADia', 'metricasDiario', 'spotDeFill', 'peorFuenteSpot', 'claveContrato', 'sinHoraIso', 'horaNY', 'diaOpNY', 'fechaNyTransaccion', 'fechaCorta', 'fmtFechaNY',
    'estadoComisionFill', 'estadoComisionCrudo', 'detalleComisionFill', 'textoDetalleComision', 'comisionesDiario', 'tarjetasResumenDiario', 'seccionEjecucionesDiario', 'parteComision',
    'comisionAunPendiente', 'diasHabilesDesde'],
    { hoyNY: () => HOY, ymdNY, subtituloPeriodoDiario: () => 'Todo el historial · 2026-11-02 → 2026-11-09' },
    { consts: ['DIARIO_LADOS_SALIDA', 'FUENTES_SPOT', 'COMISION_PENDIENTE_HABILES', 'CONCEPTOS_COMISION_CORTO', 'esc', 'dineroD', 'dineroS', 'pctD2', 'colD', 'nOps', 'BROKER_NOMBRE', 'BROKER_CORTO', 'MESES_ES_C'] });
  // una ejecución de moomoo de juguete CON las columnas de la 0023 (comision_fuente null = nadie la resolvió aún)
  const FM = (clave, lado, contratos, precio, at, extra) => Object.assign({ id: clave, broker: 'moomoo', clave_ext: clave, symbol: 'TSLA', direccion: 'CALL', strike: 450,
    expiracion: '2026-11-13', lado, contratos, precio, comision: 0, ejecutado_at: at, fecha_ny: ymdNY(at), origen: 'worker',
    comision_fuente: null, comision_detalle: null, comision_at: null }, extra || {});
  const sinCols = (f) => { const o = Object.assign({}, f); delete o.comision_fuente; delete o.comision_detalle; delete o.comision_at; return o; };
  const iso = (ms) => new Date(ms).toISOString();
  {
    const E = (f) => D.estadoComisionFill(f, AHORA);
    igual(E(FM('p1', 'compra', 1, 1, iso(AHORA - 10 * 60000))), 'pendiente', 'moomoo, comision 0, fuente null, de hace 10 min: «pendiente»');
    // v71 rev: en DÍAS HÁBILES NY como el worker (3) más uno de margen (el festivo que la app no conoce y la pasada)
    igual(E(FM('p2', 'compra', 1, 1, '2026-11-06T20:00:00Z')), 'pendiente', 'una orden del VIERNES 6-nov 15:00 ET mirada el LUNES 9-nov 16:00 ET (75 h, 1 día hábil): «pendiente», no «sin dato» (el worker aún la resuelve)');
    igual(D.estadoComisionFill(FM('p2b', 'compra', 1, 1, '2026-11-06T20:00:00Z'), Date.parse('2026-11-09T20:00:00Z')), 'pendiente', '… también a las 72 h justas (lunes 15:00 ET): con días de calendario ya decía «sin dato»');
    igual(E(FM('p3', 'compra', 1, 1, '2026-11-04T15:00:00Z')), 'pendiente', 'miércoles 4-nov mirado el lunes (3 días hábiles: el plazo del worker): aún «pendiente» (un día de margen)');
    igual(E(FM('p3b', 'compra', 1, 1, '2026-11-03T15:00:00Z')), 'sin_dato', 'martes 3-nov mirado el lunes (4 días hábiles): «sin dato» (nunca pendiente eterno)');
    igual(D.estadoComisionFill(FM('p3c', 'compra', 1, 1, '2026-11-06T20:00:00Z'), Date.parse('2026-11-12T15:00:00Z')), 'sin_dato', 'la del viernes, el jueves siguiente (4 días hábiles): «sin dato»');
    igual(D.estadoComisionFill(FM('p3d', 'compra', 1, 1, '2026-11-06T20:00:00Z'), Date.parse('2026-11-11T15:00:00Z')), 'pendiente', '… y el miércoles (3 días hábiles, cuando el worker la da por «sin dato» si no llega) todavía «pendiente»');
    igual(E(FM('p4', 'compra', 1, 1, '2026-10-01T14:00:00Z')), 'sin_dato', 'una null vieja (la app publicada antes de que el worker termine): «sin dato», nunca $0');
    igual(E(FM('p5', 'compra', 1, 1, 'no es fecha')), 'sin_dato', 'sin instante legible: «sin dato» (no se presume reciente)');
    igual(E(FM('p6', 'compra', 1, 1, iso(AHORA - 60000), { comision_fuente: 'moomoo_orden', comision: 0.38 })), 'orden', 'resuelta por el worker: «orden»');
    igual(E(FM('p7', 'compra', 1, 1, iso(AHORA - 60000), { comision_fuente: 'moomoo_orden', comision: 0 })), 'orden', 'resuelta con $0 de verdad: «orden» (un 0 real, no pendiente)');
    igual(E(FM('p8', 'compra', 1, 1, iso(AHORA - 60000), { comision_fuente: 'moomoo_sin_dato' })), 'sin_dato', 'el worker no pudo saberla: «sin dato» aunque sea de hoy');
    igual(E(sinCols(FM('p9', 'compra', 1, 1, iso(AHORA - 60000)))), null, 'SIN las columnas de la 0023 (la fila no trae comision_fuente): null, no se afirma nada');
    igual(E(FM('p10', 'compra', 1, 1, iso(AHORA - 60000), { broker: 'etrade' })), null, 'E*TRADE (su comisión viene con la ejecución): null');
    igual(E(FM('p11', 'compra', 1, 1, iso(AHORA - 60000), { comision_fuente: 'otra_cosa' })), null, 'una fuente que esta versión no conoce no se interpreta');
    igual(E(FM('p12', 'venta', 2, 0, '2026-11-14T06:22:00Z', { expiracion: '2026-11-13' })), null, 'la venta a $0 que moomoo anota tras el vencimiento: null (un vencimiento no es una orden)');
    igual(E(FM('p13', 'vencimiento', 2, 0, '2026-11-13T21:30:00Z')), null, 'un lado «vencimiento»: null');
    igual([E(null), E(undefined), E('x')], [null, null, null], 'basura: null');
    igual(D.estadoComisionFill(FM('p14', 'compra', 1, 1, iso(Date.now() - 60000))), 'pendiente', 'sin `ahoraMs` usa la hora del equipo');
  }

  // ════════════════ 2. desglose de la ORDEN (comision_detalle) en corto, con esc() ════════════════
  {
    const det = D.detalleComisionFill({ comision_detalle: { orden_total: 0.5700000000000001, ejecuciones: 2, conceptos: { 'Options Regulatory Fees': 0.19, 'OCC Fees': 0.38, 'Consolidated Audit Trail Fees': 0 } } });
    igual(det, { total: 0.57, ejecuciones: 2, conceptos: [{ nombre: 'Options Regulatory Fees', corto: 'ORF', monto: 0.19 }, { nombre: 'OCC Fees', corto: 'OCC', monto: 0.38 }, { nombre: 'Consolidated Audit Trail Fees', corto: 'CAT', monto: 0 }] },
      'el desglose: total a centavos, ejecuciones y conceptos en su orden, con su nombre corto');
    const todos = D.detalleComisionFill({ comision_detalle: { orden_total: 7, conceptos: { 'OCC Fees': 1, 'Options Regulatory Fees': 1, 'SEC Fees': 1, 'Trading Activity Fees': 1, 'Consolidated Audit Trail Fees': 1, 'Contract Fees': 1, 'Exchange Proprietary Fees': 1, 'Platform Fees': 0.5 } } });
    igual(todos.conceptos.map(c => c.corto), ['OCC', 'ORF', 'SEC', 'TAF', 'CAT', 'contrato', 'bolsa', 'Platform'], 'abreviados: OCC, ORF, SEC, TAF, CAT, contrato, bolsa; uno desconocido con su nombre sin « Fees»');
    igual(D.detalleComisionFill({ comision_detalle: JSON.stringify({ orden_total: 0.24, ejecuciones: 1, conceptos: { 'SEC Fees': 0.05 } }) }).conceptos[0].corto, 'SEC', 'acepta el jsonb como texto JSON');
    igual(D.detalleComisionFill({ comision_detalle: { orden_total: 0.57, conceptos: [['OCC Fees', 0.38], ['Options Regulatory Fees', 0.19]] } }).conceptos.map(c => c.corto), ['OCC', 'ORF'], 'acepta la lista de pares de order_fee_query');
    igual([D.detalleComisionFill({}), D.detalleComisionFill({ comision_detalle: null }), D.detalleComisionFill({ comision_detalle: '{roto' }), D.detalleComisionFill({ comision_detalle: [1, 2] }), D.detalleComisionFill({ comision_detalle: { conceptos: {} } }), D.detalleComisionFill(null)],
      [null, null, null, null, null, null], 'sin desglose, roto, o vacío: null (no se pinta nada)');
    const t = D.textoDetalleComision(det);
    igual(t.linea, 'comisión de la orden $0.57 repartida en 2 ejecuciones: ORF $0.19 · OCC $0.38', 'la línea pequeña: total de la orden, en cuántas ejecuciones se reparte y los conceptos con monto (el CAT a $0 no ocupa sitio)');
    igual(t.titulo, 'comisión de la orden $0.57 repartida en 2 ejecuciones: Options Regulatory Fees $0.19 · OCC Fees $0.38 · Consolidated Audit Trail Fees $0.00', 'el title: todos los conceptos con su nombre entero');
    igual(D.textoDetalleComision(D.detalleComisionFill({ comision_detalle: { orden_total: 0.24, ejecuciones: 1, conceptos: { 'SEC Fees': 0.05 } } })).linea, 'comisión de la orden $0.24: SEC $0.05', 'una sola ejecución: sin «repartida»');
    const xss = D.textoDetalleComision(D.detalleComisionFill({ comision_detalle: { orden_total: 1, ejecuciones: 1, conceptos: { '<img src=x onerror=alert(1)>': 0.5, '"><script>alert(2)</script>': 0.5 } } }));
    assert(!/<img|<script/.test(xss.linea) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(xss.linea) && /&quot;&gt;&lt;script&gt;/.test(xss.linea), 'XSS: los conceptos (texto libre de OpenD) van escapados en la línea', xss.linea);
  }

  // ════════════════ 3. Diario: neto = bruto − comisiones con fills de moomoo resueltos ════════════════
  const T0 = '2026-11-06T14:40:00Z', T1 = '2026-11-06T15:00:00Z', T2 = '2026-11-06T15:10:00Z';
  const RES = [
    FM('m1', 'compra', 3, 2.00, T0, { comision: 0.57, comision_fuente: 'moomoo_orden', comision_at: '2026-11-06T15:20:00Z',
      comision_detalle: { orden_total: 0.57, ejecuciones: 1, conceptos: { 'Options Regulatory Fees': 0.19, 'OCC Fees': 0.38, 'Consolidated Audit Trail Fees': 0 } } }),
    FM('m2', 'venta', 1, 2.50, T1, { comision: 0.24, comision_fuente: 'moomoo_orden', comision_detalle: { orden_total: 0.24, ejecuciones: 1, conceptos: { 'Options Regulatory Fees': 0.06, 'OCC Fees': 0.13, 'SEC Fees': 0.05 } } }),
    FM('m3', 'venta', 2, 3.00, T2, { comision: 0.43, comision_fuente: 'moomoo_orden', comision_detalle: { orden_total: 0.43, ejecuciones: 1, conceptos: { 'Options Regulatory Fees': 0.13, 'OCC Fees': 0.25, 'SEC Fees': 0.05 } } }),
  ];
  {
    const R = D.emparejarFillsFIFO(RES, HOY);
    igual(R.cerradas.map(c => [c.contratos, c.comisiones, c.pnl]), [[1, 0.43, 49.57], [2, 0.81, 199.19]],
      'tramos: la comisión de la compra prorrateada por contratos (0.19 + 0.38) más la de cada venta (0.24 y 0.43)');
    const v = R.viajes[0];
    igual([v.costo, v.venta, v.comisiones, v.pnl], [600, 850, 1.24, 248.76], 'el viaje: bruto $250 − comisiones $1.24 = neto $248.76');
    const M = D.metricasDiario(R.cerradas, D.diaADia(R.cerradas, null, null, R.viajes), R.viajes, RES);
    igual([M.total, M.comisiones], [248.76, 1.24], 'metricasDiario: total NETO y las comisiones descontadas del período');
    cerca(M.total, (850 - 600) - 1.24, 'total = bruto − comisiones', 1e-9);
    const sinRes = D.emparejarFillsFIFO(RES.map(f => Object.assign({}, f, { comision: 0, comision_fuente: null })), HOY);
    igual(sinRes.viajes[0].pnl, 250, 'las mismas ejecuciones sin la comisión resuelta: el P&L es el bruto (no se inventa nada)');
    const Cm = D.comisionesDiario(R.cerradas, RES, AHORA);
    igual(Cm, { por_broker: { moomoo: 1.24 }, pendientes: 0, sin_dato: 0 }, 'comisionesDiario: $1.24 de moomoo, nada pendiente');
  }

  // ════════════════ 3b. v71 rev · el reparto por ACUMULADO, como el worker: Σ de los tramos = Σ fills.comision al centavo ════════════════
  // (juez de dinero: con el reparto proporcional cada tramo se redondeaba por su lado y una salida en tercios perdía 1 ¢;
  // los centavos esperados están hechos A MANO con floor(F·C_k/Q) − floor(F·C_{k−1}/Q), como los escribe el worker)
  {
    const R = (cf) => cf.map(([c, l, n, p, at, com]) => FM(c, l, n, p, at, { comision: com, comision_fuente: 'moomoo_orden' }));
    const suma = (xs) => Math.round(xs.reduce((s, c) => s + c.comisiones, 0) * 100) / 100;
    const t3 = D.emparejarFillsFIFO(R([['t1', 'compra', 3, 2.00, T0, 0.58], ['t2', 'venta', 1, 2.50, T1, 0.20], ['t3', 'venta', 1, 2.50, '2026-11-06T15:05:00Z', 0.20], ['t4', 'venta', 1, 2.50, T2, 0.20]]), HOY);
    igual(t3.cerradas.map(c => [c.comisiones, c.pnl]), [[0.39, 49.61], [0.39, 49.61], [0.40, 49.60]],
      '3 × 1 (compra $0.58, tres ventas de $0.20): 0.19+0.20, 0.19+0.20, 0.20+0.20 — los tramos que escribe el worker en broker_trades');
    igual([suma(t3.cerradas), t3.viajes[0].comisiones, t3.viajes[0].pnl], [1.18, 1.18, 148.82], 'Σ tramos = $1.18 (Σ fills.comision) y el neto $148.82 = $150 − $1.18 (antes: $1.17 y $148.83)');
    const M3 = D.metricasDiario(t3.cerradas, D.diaADia(t3.cerradas, null, null, t3.viajes), t3.viajes, []);
    igual([M3.total, M3.comisiones], [148.82, 1.18], 'metricasDiario: el total y las comisiones del pie, al centavo');
    const t118 = D.emparejarFillsFIFO(R([['u1', 'compra', 10, 1.00, T0, 1.03], ['u2', 'venta', 1, 1.50, T1, 0.13], ['u3', 'venta', 1, 1.50, '2026-11-06T15:05:00Z', 0.13], ['u4', 'venta', 8, 2.00, T2, 0.71]]), HOY);
    igual(t118.cerradas.map(c => [c.contratos, c.comisiones, c.pnl]), [[1, 0.23, 49.77], [1, 0.23, 49.77], [8, 1.54, 798.46]],
      '10 en 1 + 1 + 8 (compra $1.03): 0.10, 0.10 y 0.83 de la compra (antes 1.53 en el último: faltaba 1 ¢)');
    igual([suma(t118.cerradas), t118.viajes[0].pnl], [2.00, 898.00], 'Σ = $2.00 = $1.03 + $0.13 + $0.13 + $0.71; neto $898.00 = $900 − $2.00');
    const t87 = D.emparejarFillsFIFO(R([['v1', 'compra', 8, 1.00, T0, 0.41], ['v2', 'compra', 7, 1.00, '2026-11-06T14:40:01Z', 0.36], ['v3', 'venta', 15, 1.20, T2, 0.92]]), HOY);
    igual(t87.cerradas.map(c => [c.contratos, c.comisiones, c.pnl]), [[8, 0.90, 159.10], [7, 0.79, 139.21]],
      '15 en 8 + 7 (la orden de $0.77 repartida 0.41 / 0.36; la venta de $0.92: 0.49 a los 8 y 0.43 a los 7)');
    igual(suma(t87.cerradas), 1.69, 'Σ = $1.69 = $0.77 + $0.92');
    const ab = D.emparejarFillsFIFO(R([['w1', 'compra', 3, 2.00, T0, 0.58], ['w2', 'venta', 1, 2.50, T1, 0.20]]), HOY);
    igual([ab.cerradas[0].comisiones, ab.abiertos[0].comision], [0.39, 0.39], 'lote abierto: le queda la parte de sus 2 contratos aún sin cerrar ($0.58 − $0.19 = $0.39)');
    const vc = D.emparejarFillsFIFO(R([['x1', 'compra', 3, 2.00, '2026-11-02T14:40:00Z', 0.58], ['x2', 'venta', 1, 2.50, '2026-11-02T15:00:00Z', 0.20]]).map(f => ({ ...f, expiracion: '2026-11-06' })), HOY);
    igual(vc.cerradas.map(c => [c.contratos, c.comisiones, c.vencido]), [[1, 0.39, false], [2, 0.39, true]], 'el resto que vence sin venderse lleva la parte que le queda al lote ($0.39): Σ = $0.78 = $0.58 + $0.20');
    // E*TRADE y tasty: proporcional como sus emparejadores (emparejarEtrade / tasty_cuenta escriben así broker_trades): lote de 3
    // con $1.97, ventas de 1 ($0.65) y 2 ($1.30) → 1.97/3 + 0.65 y 2·1.97/3 + 1.30 → P&L 8.69 y 37.39, como su fila en Cuentas
    const et = D.emparejarFillsFIFO(R([['y1', 'compra', 3, 1.00, T0, 1.97], ['y2', 'venta', 1, 1.10, T1, 0.65], ['y3', 'venta', 2, 1.20, T2, 1.30]]).map(f => ({ ...f, broker: 'etrade', comision_fuente: null })), HOY);
    igual(et.cerradas.map(c => [c.comisiones, c.pnl]), [[1.31, 8.69], [2.61, 37.39]], 'E*TRADE sigue con el reparto proporcional de emparejarEtrade (Diario = Cuentas tramo a tramo)');
    const mmIgual = D.emparejarFillsFIFO(R([['y1', 'compra', 3, 1.00, T0, 1.97], ['y2', 'venta', 1, 1.10, T1, 0.65], ['y3', 'venta', 2, 1.20, T2, 1.30]]), HOY);
    igual(mmIgual.cerradas.map(c => [c.comisiones, c.pnl]), [[1.30, 8.70], [2.62, 37.38]], 'las mismas ejecuciones de moomoo: por acumulado (0.65 + 0.65 y 1.32 + 1.30), como el worker');
    igual([D.parteComision(1.9725, 0, 1, 3), D.parteComision(1.9725, 1, 2, 3), D.parteComision(1.9725, 2, 3, 3)], [0.6575, 0.6575, 0.6575], 'parteComision con 4 decimales: el acumulado va en diezmilésimas, no en centavos');
    igual([D.parteComision(0.58, 0, 1, 3), D.parteComision(0.58, 1, 2, 3), D.parteComision(0.58, 2, 3, 3), D.parteComision(0, 0, 1, 3), D.parteComision(0.58, 0, 1, 0), D.parteComision('x', 0, 1, 3)],
      [0.19, 0.19, 0.2, 0, 0, 0], 'parteComision: el acumulado de la casa; con F = 0, q = 0 o basura, 0');
  }

  // ════════════════ 4. el pie del Diario: de qué brókeres son, pendientes y sin dato ════════════════
  const MB = { total: 245.59, ops: 2, aciertos: 2, pct: 30, mejor: 200, peor: 45, dias_operados: 1, prom_dia: 245.59, proy_mes: 5157.39, proy_anio: 61888.68, vencidas: 0, costo: 800 };
  const pie = (h) => ((h.match(/<\/div><div class="fresco" style="padding:0 4px">([\s\S]*)<\/div>$/) || [])[1] || '');
  const sub = (h) => ((h.match(/TOTAL DEL PERÍODO<\/div><div class="vl"[^>]*>[^<]*<\/div><div class="sb">([^<]*)<\/div>/) || [])[1] || '');
  {
    const ET = { broker: 'etrade', comisiones: 2.6 };
    const MM = { broker: 'moomoo', comisiones: 0.57 };
    const dos = D.comisionesDiario([ET, MM, { broker: 'schwab', comisiones: 0 }], [], AHORA);
    igual(dos, { por_broker: { etrade: 2.6, moomoo: 0.57 }, pendientes: 0, sin_dato: 0 }, 'comisionesDiario: por bróker DE LOS DATOS (Schwab, sin comisión, no aparece)');
    const h = D.tarjetasResumenDiario({ ...MB, comisiones: 3.17, com: dos }, { modo: 'todo' }, [], HOY);
    assert(/comisiones ya descontadas: \$3\.17 \(E\*TRADE \$2\.60 · moomoo \$0\.57\)/.test(pie(h)), 'pie: «comisiones ya descontadas: $3.17 (E*TRADE $2.60 · moomoo $0.57)»', pie(h));
    assert(!/Schwab|tasty|las reporta|no las manda/.test(pie(h)), 'el pie no dice nada fijo de ningún bróker: solo los que tienen comisión en el período');
    igual(sub(h), 'Todo el historial · 2026-11-02 → 2026-11-09 · neto de comisiones', 'sin nada pendiente: el total es «neto de comisiones»');
    const soloET = D.tarjetasResumenDiario({ ...MB, comisiones: 2.6, com: D.comisionesDiario([ET], [], AHORA) }, { modo: 'todo' }, [], HOY);
    assert(/comisiones ya descontadas: \$2\.60 \(E\*TRADE \$2\.60\)/.test(pie(soloET)) && !/moomoo/.test(pie(soloET)), 'solo E*TRADE en el período: el pie dice solo E*TRADE');
    const soloMM = D.tarjetasResumenDiario({ ...MB, comisiones: 0.57, com: D.comisionesDiario([MM], [], AHORA) }, { modo: 'todo' }, [], HOY);
    assert(/comisiones ya descontadas: \$0\.57 \(moomoo \$0\.57\)/.test(pie(soloMM)), 'solo moomoo: «(moomoo $0.57)»');
    const viejo = D.tarjetasResumenDiario({ ...MB, comisiones: 3.17 }, { modo: 'todo' }, [], HOY);
    assert(/comisiones ya descontadas: \$3\.17(?! \()/.test(pie(viejo)) && !/moomoo|E\*TRADE las/.test(pie(viejo)), 'sin M.com (quien llame como antes): solo el monto, sin afirmar de quién es');
    // pendientes y sin dato
    const FILLS = [
      FM('a', 'compra', 1, 1.00, iso(AHORA - 10 * 60000)),                                   // pendiente
      FM('b', 'venta', 1, 1.20, iso(AHORA - 5 * 60000)),                                     // pendiente
      FM('c', 'compra', 1, 1.00, '2026-11-02T15:00:00Z'),                                     // null vieja → sin dato
      FM('d', 'compra', 1, 1.00, iso(AHORA - 3600000), { comision_fuente: 'moomoo_sin_dato' }),   // el worker no pudo → sin dato
      FM('e', 'compra', 1, 1.00, iso(AHORA - 3600000), { comision_fuente: 'moomoo_orden', comision: 0 }),   // $0 real: nada que decir
      FM('f', 'venta', 1, 0, '2026-11-08T06:22:00Z', { expiracion: '2026-11-07' }),            // vencimiento anotado: no cuenta
      { ...FM('g', 'compra', 1, 1.00, iso(AHORA - 60000)), broker: 'etrade', comision: 0.65 },
    ];
    const Cp = D.comisionesDiario([ET], FILLS, AHORA);
    igual([Cp.pendientes, Cp.sin_dato], [2, 2], 'comisionesDiario: 2 pendientes (de hoy) y 2 sin dato (la null vieja y la que el worker no pudo); el $0 real y el vencimiento no cuentan');
    const hp = D.tarjetasResumenDiario({ ...MB, comisiones: 2.6, com: Cp }, { modo: 'todo' }, [], HOY);
    assert(/2 ejecuciones de moomoo con la comisión pendiente \(moomoo la asienta minutos después; la Mesa la pide a los 30 min\)/.test(pie(hp)), 'pie: «2 ejecuciones de moomoo con la comisión pendiente (moomoo la asienta minutos después; la Mesa la pide a los 30 min)»', pie(hp));
    assert(/2 ejecuciones de moomoo sin dato de comisión/.test(pie(hp)), 'pie: «2 ejecuciones de moomoo sin dato de comisión»');
    igual(sub(hp), 'Todo el historial · 2026-11-02 → 2026-11-09 · neto de las comisiones conocidas', 'con alguna pendiente o sin dato el total es «neto de las comisiones conocidas»');
    const h1 = D.tarjetasResumenDiario({ ...MB, comisiones: 0, com: D.comisionesDiario([], [FILLS[0]], AHORA) }, { modo: 'todo' }, [], HOY);
    assert(/1 ejecución de moomoo con la comisión pendiente/.test(pie(h1)) && !/comisiones ya descontadas/.test(pie(h1)) && !/neto/.test(sub(h1)) && !/\$0\.00/.test(pie(h1)),
      'solo una pendiente y nada descontado: «1 ejecución … pendiente», sin «comisiones ya descontadas: $0.00» ni «neto»');
    // sin la 0023: las mismas ejecuciones sin columnas → nada se afirma
    const Cs = D.comisionesDiario([ET], FILLS.map(sinCols), AHORA);
    igual([Cs.pendientes, Cs.sin_dato], [0, 0], 'SIN las columnas de la 0023: ni pendientes ni sin dato');
    const hs = D.tarjetasResumenDiario({ ...MB, comisiones: 2.6, com: Cs }, { modo: 'todo' }, [], HOY);
    assert(!/pendiente|sin dato/.test(pie(hs)) && /comisiones ya descontadas: \$2\.60 \(E\*TRADE \$2\.60\)/.test(pie(hs)) && / · neto de comisiones$/.test(sub(hs)), 'sin la 0023 el pie solo dice lo que hay: nada se rompe, nada se afirma');
  }

  // ════════════════ 4b. v71 rev · el pie mira también las ejecuciones de OTRO período que entran en sus tramos ════════════════
  // (juez de dinero: una compra del viernes sin dato pesa en el P&L del lunes y el total decía «neto de comisiones» sin aviso)
  {
    const L = [FM('d1', 'compra', 2, 2.00, '2026-11-06T15:00:00Z', { expiracion: '2026-11-20', comision_fuente: 'moomoo_sin_dato' }),
      FM('d2', 'venta', 2, 2.50, '2026-11-09T15:00:00Z', { expiracion: '2026-11-20', comision: 0.43, comision_fuente: 'moomoo_orden' })];
    const F = D.emparejarFillsFIFO(L, HOY);
    const cer = F.cerradas.filter(c => c.fecha_ny === '2026-11-09'), delDia = L.filter(f => f.fecha_ny === '2026-11-09');
    igual([cer.length, cer[0] && cer[0].pnl], [1, 99.57], 'el lunes cierra un tramo con la compra del viernes: $100 − $0.43 de la venta (la de la compra no se sabe)');
    igual(D.comisionesDiario(cer, delDia, AHORA), { por_broker: { moomoo: 0.43 }, pendientes: 0, sin_dato: 0 }, 'sin el libro (quien llame como antes): solo las ejecuciones del período');
    const Cl = D.comisionesDiario(cer, delDia, AHORA, L);
    igual(Cl, { por_broker: { moomoo: 0.43 }, pendientes: 0, sin_dato: 1 }, 'con el libro: la compra del VIERNES sin dato que entra en el tramo del lunes cuenta (1 sin dato)');
    const h = D.tarjetasResumenDiario({ ...MB, comisiones: 0.43, com: Cl }, { modo: 'todo' }, [], HOY);
    assert(/ · neto de las comisiones conocidas$/.test(sub(h)) && /1 ejecución de moomoo sin dato de comisión/.test(pie(h)), 'el total del lunes es «neto de las comisiones conocidas» y el pie lo cuenta', sub(h));
    const Cp = D.comisionesDiario(cer, delDia, AHORA, [{ ...L[0], comision_fuente: null }, L[1]]);
    igual([Cp.pendientes, Cp.sin_dato], [1, 0], 'la compra del viernes aún sin resolver (worker parado o más lento): 1 pendiente');
    igual(D.comisionesDiario(cer, L, AHORA, L).sin_dato, 1, 'una ejecución del período que además entra en un tramo se cuenta UNA sola vez');
    igual(D.comisionesDiario(cer, delDia, AHORA, [{ ...L[0], broker: 'etrade' }, L[1]]).sin_dato, 0, 'la misma clave_ext de OTRO bróker no se confunde con la del tramo');
    igual(D.comisionesDiario(cer, delDia, AHORA, L.map(sinCols)), { por_broker: { moomoo: 0.43 }, pendientes: 0, sin_dato: 0 }, 'sin la 0023 en el libro: nada se afirma');
  }

  // ════════════════ 5. la lista de ejecuciones ════════════════
  {
    const L = (fills, ahora) => D.seccionEjecucionesDiario(fills, 'todos', true, ahora == null ? AHORA : ahora);
    const h = L(RES);
    assert(/monto \$600\.00 · com \$0\.57<\/span>/.test(h) && /monto \$250\.00 · com \$0\.24<\/span>/.test(h) && /monto \$600\.00 · com \$0\.43<\/span>/.test(h), 'resueltas: «com $0.57», «com $0.24», «com $0.43» como siempre');
    assert(/<div class="fresco" style="margin-top:2px;text-align:right" title="comisión de la orden \$0\.57: Options Regulatory Fees \$0\.19 · OCC Fees \$0\.38 · Consolidated Audit Trail Fees \$0\.00">comisión de la orden \$0\.57: ORF \$0\.19 · OCC \$0\.38<\/div>/.test(h),
      'bajo la ejecución, en una línea pequeña, el desglose de su ORDEN en corto (ORF, OCC) y entero en el title');
    assert(/comisión de la orden \$0\.24: ORF \$0\.06 · OCC \$0\.13 · SEC \$0\.05/.test(h), 'la venta lleva su SEC');
    const p = L([FM('a', 'compra', 1, 1.00, iso(AHORA - 10 * 60000)), FM('c', 'compra', 2, 1.00, '2026-11-02T15:00:00Z'), FM('d', 'compra', 3, 1.00, iso(AHORA - 3600000), { comision_fuente: 'moomoo_sin_dato' }),
      FM('e', 'compra', 4, 1.00, iso(AHORA - 3600000), { comision_fuente: 'moomoo_orden', comision: 0 })]);
    assert(/monto \$100\.00 · <span title="moomoo la asienta minutos después; la Mesa la pide a los 30 min">com pendiente<\/span><\/span>/.test(p), 'la de hace 10 min sin resolver: «com pendiente» (con el porqué en el title)');
    assert(/monto \$200\.00 · com sin dato<\/span>/.test(p) && /monto \$300\.00 · com sin dato<\/span>/.test(p), 'la null vieja y la que el worker no pudo: «com sin dato»');
    assert(/monto \$400\.00 · com \$0\.00<\/span>/.test(p), 'un $0 que moomoo dio de verdad: «com $0.00» (es dato)');
    assert(!/com \$0\.00/.test(p.replace(/monto \$400\.00 · com \$0\.00/, '')), 'y ninguna pendiente o sin dato sale como $0.00');
    const s = L([sinCols(FM('a', 'compra', 1, 1.00, iso(AHORA - 10 * 60000))), sinCols(FM('c', 'compra', 2, 1.00, '2026-11-02T15:00:00Z'))]);
    assert(!/pendiente|sin dato|com \$/.test(s.replace(/«pendiente» hasta entonces, «sin dato» si no se pudo saber/, '')), 'SIN las columnas de la 0023: ni «pendiente», ni «sin dato», ni un $0 inventado');
    const et = L([{ ...FM('g', 'compra', 1, 1.00, iso(AHORA - 60000)), broker: 'etrade', comision: 0.65 }, { ...FM('h', 'compra', 1, 1.00, iso(AHORA - 60000)), broker: 'schwab' }]);
    assert(/monto \$100\.00 · com \$0\.65<\/span>/.test(et) && !/com pendiente|com sin dato/.test(et), 'E*TRADE con su comisión y Schwab sin ella: como siempre (nada de «pendiente» fuera de moomoo)');
    const venc = L([FM('f', 'venta', 1, 0, '2026-11-08T06:22:00Z', { expiracion: '2026-11-07' })]);
    assert(/VENCIMIENTO/.test(venc) && !/com pendiente|com sin dato/.test(venc), 'un vencimiento anotado por moomoo no dice «com pendiente» ni «sin dato»');
    // XSS en los conceptos: escapados también dentro del title
    const x = L([FM('x', 'compra', 1, 1.00, T0, { comision: 0.5, comision_fuente: 'moomoo_orden', comision_detalle: { orden_total: 0.5, ejecuciones: 1, conceptos: { '"><img src=x onerror=alert(1)>': 0.5 } } })]);
    assert(!/<img/.test(x) && /title="comisión de la orden \$0\.50: &quot;&gt;&lt;img src=x onerror=alert\(1\)&gt; \$0\.50"/.test(x), 'XSS: un concepto con «"><img …>» no rompe el title ni mete etiquetas', (x.match(/margin-top:2px;text-align:right"[^\n]*/) || [''])[0]);
    // el pie de la lista
    assert(/moomoo la cobra por ORDEN y la asienta minutos después: la Mesa la pide a los 30 min y la reparte entre las ejecuciones de la orden por contratos/.test(h) && /Schwab no manda comisiones en sus órdenes/.test(h) && !/moomoo \(ejecuciones de OpenD\)/.test(h),
      'el pie de la lista: moomoo SÍ (por orden, repartida entre sus ejecuciones); Schwab no');
    assert(/^function seccionEjecucionesDiario\(fills, filtro, todas, ahoraMs[,)]/.test(extraer('seccionEjecucionesDiario')), 'seccionEjecucionesDiario recibe `ahoraMs` (sin él, la hora del equipo)');
  }

  // ════════════════ 6. el cableado en vistaDiario ════════════════
  {
    const vd = extraer('vistaDiario');
    assert(/const M = metricasDiario\(cerradasSel, dias, viajesSel, fillsSelDias\);\s*M\.com = comisionesDiario\(cerradasSel, fillsSelDias, Date\.now\(\), fills\);/.test(vd),
      'vistaDiario: M.com = comisionesDiario(cerradasSel, fillsSelDias, Date.now(), fills) con los tramos y las ejecuciones DEL PERÍODO y el libro entero (v71 rev)');
    assert(/tarjetasResumenDiario\(M, sel, cob, hoy\)/.test(vd) && /seccionEjecucionesDiario\(fillsSel, _diario\.brokerFiltro, _diario\.masEjec(, Date\.now\(\), multiCta)?\)/.test(vd), 'las llamadas de siempre (el pie lee M.com; la lista, la hora del equipo)');
    assert(!/\.(insert|update|upsert|delete)\(/.test(extraer('comisionesDiario') + extraer('estadoComisionFill') + extraer('detalleComisionFill') + extraer('textoDetalleComision')), 'nada de esto escribe en la base: la app solo LEE lo que escribe el worker');
  }

  // ════════════════ 7. Cuentas (el módulo ENTERO): moomoo «aún sin dato» / «sin dato» / $0 real, datos mezclados ════════════════
  const mod = C.cargarModuloEntero({ src: './app/main.js?v=71', hash: '#/informe' });
  assert(mod.cargo, 'main.js entero carga en el DOM de juguete', mod.error);
  if (mod.cargo) {
    const W = mod.win;
    igual(mod.ev('BROKERS_CON_COMISION'), ['etrade', 'tasty'], 'moomoo NO entra en BROKERS_CON_COMISION (un 0 pendiente no es un 0 real)');
    igual([W.comisionDelBroker({ broker: 'moomoo', fees: 0.81 }), W.comisionDelBroker({ broker: 'moomoo', fees: 0 }), W.comisionDelBroker({ broker: 'moomoo', fees: null })], [true, false, false],
      'comisionDelBroker: moomoo con fees > 0 es neta; con 0 o sin fees, no');
    const b = { symbol: 'TSLA', direccion: 'CALL', strike: 450, expiracion: '2026-11-13', contratos: 1, prima_fill: 2, prima_salida: 3 };
    // v71 rev: las idas y vueltas de moomoo llevan la clave de moomoo_cuenta.emparejar («osi|ts|ts|n|lote>venta»): sus deal_id
    // son la clave_ext de sus ejecuciones en el libro, y Cuentas las MARCA con él (marcarComisionMoomooCuentas)
    const cl = (osi, ab, ce, n, ids) => `${osi}|${ab}|${ce}|${n}|${ids}`;
    const BT = [
      { ...b, broker: 'etrade', abierta_at: '2026-11-03T14:00:00Z', cerrada_at: '2026-11-03T15:00:00Z', resultado_usd: 97.4, fees: 2.6, clave_ext: 'e1' },
      { ...b, broker: 'moomoo', strike: 455, abierta_at: '2026-11-04T14:00:00Z', cerrada_at: '2026-11-04T15:00:00Z', resultado_usd: 99.19, fees: 0.81, clave_ext: cl('T455', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z', 1, 'a1>b1') },
      { ...b, broker: 'moomoo', strike: 460, abierta_at: '2026-11-05T14:00:00Z', cerrada_at: '2026-11-05T15:00:00Z', resultado_usd: 100, fees: 0, clave_ext: cl('T460', '2026-11-05T14:00:00Z', '2026-11-05T15:00:00Z', 1, 'a2>b2') },
    ];
    // el libro: a1/b1 resueltas (su ida y vuelta ya trae fees); a2/b2 de hace 2 días hábiles, aún sin resolver (pendientes)
    const LIB = [FM('a1', 'compra', 1, 2, '2026-11-04T14:00:00Z', { strike: 455, comision: 0.38, comision_fuente: 'moomoo_orden' }), FM('b1', 'venta', 1, 3, '2026-11-04T15:00:00Z', { strike: 455, comision: 0.43, comision_fuente: 'moomoo_orden' }),
      FM('a2', 'compra', 1, 2, '2026-11-05T14:00:00Z', { strike: 460 }), FM('b2', 'venta', 1, 3, '2026-11-05T15:00:00Z', { strike: 460 })];
    const mk = (ops, lib) => W.marcarComisionMoomooCuentas(ops, lib === undefined ? LIB : lib, AHORA);
    const met = (ops) => W.metricasCuentas(W.resumenPeriodo(ops, '2026-11-01').ops, '2026-11-01');
    const ops = mk(W.unirOperaciones([], BT).ops);
    const M = met(ops);
    igual([M.comisiones, M.com_brokers, M.sin_com_brokers, M.com_sin_dato, M.com_pend_mm, M.com_sin_mm], [3.41, ['etrade', 'moomoo'], [], 1, 1, 0],
      'datos mezclados: comisiones de E*TRADE y moomoo ($3.41) y 1 ida y vuelta de moomoo aún sin la suya (pendiente: el worker la va a escribir)');
    const tl = W.tilesCuentasHtml(M, 'semana');
    assert(/neta de las comisiones de E\*TRADE y moomoo; 1 ida y vuelta de moomoo aún sin dato de comisión \(su P&L va sin descontarlas\)/.test(tl), 'UTILIDAD: «neta de las comisiones de E*TRADE y moomoo; 1 ida y vuelta de moomoo aún sin dato de comisión (su P&L va sin descontarlas)»', tl.slice(0, 400));
    assert(/<div class="sb">ya descontadas del neto · las dan E\*TRADE y moomoo · 1 ida y vuelta de moomoo aún sin dato de comisión<\/div>/.test(tl), 'COMISIONES: «las dan E*TRADE y moomoo · 1 ida y vuelta de moomoo aún sin dato de comisión»');
    assert(!/moomoo no|no las da/.test(tl), 'nunca «moomoo no las da»');
    const todas = met(mk(W.unirOperaciones([], BT.slice(0, 2)).ops));
    const tlt = W.tilesCuentasHtml(todas, 'semana');
    assert(todas.com_sin_dato === 0 && /neta de las comisiones de E\*TRADE y moomoo<\/div>/.test(tlt) && !/sin dato/.test(tlt), 'todas resueltas: «neta de las comisiones de E*TRADE y moomoo», sin «sin dato»');
    const solo = met(mk(W.unirOperaciones([], [BT[2]]).ops));
    const tls = W.tilesCuentasHtml(solo, 'semana');
    assert(solo.comisiones === null && /COMISIONES<\/div><div class="vl" style="color:var\(--tx\)">—<\/div><div class="sb">1 ida y vuelta de moomoo aún sin dato de comisión<\/div>/.test(tls) && !/\$0\.00/.test(tls),
      'solo moomoo aún sin dato: COMISIONES «—» (nunca $0.00) y por qué');
    const m3 = { ...BT[2], strike: 465, clave_ext: cl('T465', '2026-11-05T14:00:00Z', '2026-11-05T15:00:00Z', 1, 'a3>b3') };
    const LIB3 = LIB.concat([FM('a3', 'compra', 1, 2, '2026-11-05T14:00:00Z', { strike: 465 }), FM('b3', 'venta', 1, 3, '2026-11-05T15:00:00Z', { strike: 465 })]);
    const con2 = met(mk(W.unirOperaciones([], [BT[0], BT[2], m3, { ...b, broker: 'schwab', abierta_at: '2026-11-05T14:00:00Z', cerrada_at: '2026-11-05T15:00:00Z', resultado_usd: 100, fees: 0, clave_ext: 's1' }]).ops, LIB3));
    assert(/neta de las comisiones de E\*TRADE; Schwab no las da; 2 idas y vueltas de moomoo aún sin dato de comisión \(su P&L va sin descontarlas\)/.test(W.tilesCuentasHtml(con2, 'semana')),
      'con Schwab: «Schwab no las da; 2 idas y vueltas de moomoo aún sin dato de comisión»');
    // la operación: tarjeta y fila
    const mmSin = ops.find(o => o.broker === 'moomoo' && Number(o.fees) === 0), mmCon = ops.find(o => o.broker === 'moomoo' && Number(o.fees) > 0);
    const tS = W.tarjetaHistorial(mmSin, {}), fS = W.filaHistorialCuentas(mmSin, { fills: [], senales: [] });
    assert(/comisión de moomoo aún sin dato \(P&amp;L bruto hasta que moomoo la asiente y la Mesa la reparta\)/.test(tS) && !/sin comisión del bróker/.test(tS + fS), 'moomoo con fees 0 y sus ejecuciones aún sin resolver: «comisión de moomoo aún sin dato», nunca «sin comisión del bróker»');
    assert(/<span class="csub">com\. pendiente<\/span>/.test(fS) && /title="comisión de moomoo aún sin dato/.test(fS), 'la fila: «com. pendiente» en corto y el texto entero en el title');
    const tC = W.tarjetaHistorial(mmCon, {});
    assert(/neto · bruto \$100\.00 − comisión \$0\.81/.test(tC) && !/comisión de moomoo|sin dato de comisión/.test(tC), 'moomoo con su comisión: «neto · bruto $100.00 − comisión $0.81»');
    const sw = W.unirOperaciones([], [{ ...b, broker: 'schwab', abierta_at: '2026-11-05T14:00:00Z', cerrada_at: '2026-11-05T15:00:00Z', resultado_usd: 100, fees: 0 }]).ops[0];
    assert(/sin comisión del bróker/.test(W.tarjetaHistorial(sw, {})) && !/comisión de moomoo|sin dato de comisión/.test(W.tarjetaHistorial(sw, {})), 'Schwab sigue «sin comisión del bróker»');
    // una operación de moomoo con dos idas y vueltas: una con su comisión y otra aún sin ella
    const AB6 = '2026-11-06T14:40:00Z';
    const dosIV = mk(W.unirOperaciones([], [
      // v71 rev: como las escribe el worker 0.1.15 (resultado_usd en BRUTO de sus primas, fees aparte; filasMoomooNetas lo lee neto)
      { ...b, broker: 'moomoo', prima_salida: 2.5, abierta_at: AB6, cerrada_at: '2026-11-06T15:00:00Z', resultado_usd: 50, fees: 0.43, clave_ext: cl('T450', AB6, '2026-11-06T15:00:00Z', 1, 'f1>f2') },
      { ...b, broker: 'moomoo', contratos: 2, abierta_at: AB6, cerrada_at: '2026-11-06T15:10:00Z', resultado_usd: 200, fees: 0, clave_ext: cl('T450', AB6, '2026-11-06T15:10:00Z', 2, 'f1>f3') }]).ops,
      [FM('f1', 'compra', 3, 2, AB6, { comision: 0.57, comision_fuente: 'moomoo_orden' }), FM('f2', 'venta', 1, 2.5, '2026-11-06T15:00:00Z', { comision: 0.24, comision_fuente: 'moomoo_orden' }),
        FM('f3', 'venta', 2, 3, '2026-11-06T15:10:00Z')]);
    const op2 = dosIV.find(o => Array.isArray(o._partes_filas) && o._partes_filas.length === 2);
    assert(!!op2, 'las dos idas y vueltas del mismo contrato y día forman UNA operación (para probar los datos mezclados dentro de ella)', JSON.stringify(dosIV.map(o => (o._partes_filas || []).length)));
    if (op2) {
      const d2 = W.detalleOpCuentas(op2, {});
      igual([d2.com, d2.comPendParte, d2.comSinParte, d2.comPendTotal, d2.comPendiente], [0.43, 1, 0, 2, false], 'detalle: comisión conocida $0.43 y 1 de 2 idas y vueltas aún sin dato (su venta aún sin resolver)');
      assert(/neto · bruto \$250\.00 − comisión \$0\.43 \(1 de 2 idas y vueltas aún sin dato de comisión\)/.test(W.tarjetaHistorial(op2, {})), 'la tarjeta lo dice: «(1 de 2 idas y vueltas aún sin dato de comisión)»');
      assert(/<span class="csub">bruto \$250\.00 · parcial<\/span>/.test(W.filaHistorialCuentas(op2, { fills: [], senales: [] })), 'la fila: «bruto $250.00 · parcial»');
      igual([d2.neto, d2.bruto], [249.57, 250], '… y su neto es $249.57 = $250 − $0.43 (la fila con comisión, leída neta)');
    }

    // ── 7c. v71 rev · POR QUÉ falta (jueces de dinero y de seguridad: «toda ida y vuelta de moomoo con fees 0 promete "hasta que
    // la Mesa la reparta", y muchas no van a cambiar nunca»): el estado de cada una sale de SUS ejecuciones en el libro
    {
      const E = (lib, extra) => W.estadoComisionTramoMoomoo({ ...BT[2], ...(extra || {}) }, new Map(lib.map(f => [f.clave_ext, f])), AHORA);
      const a = (x) => FM('a2', 'compra', 1, 2, '2026-11-05T14:00:00Z', x), v = (x) => FM('b2', 'venta', 1, 3, '2026-11-05T15:00:00Z', x);
      const OR = (c, at) => ({ comision: c, comision_fuente: 'moomoo_orden', comision_at: at || '2026-11-05T15:40:00Z' });
      igual(E([a(), v()]), 'pendiente', 'las dos aún sin resolver y jóvenes: «pendiente» (el worker la va a escribir)');
      igual(E([a({ comision_fuente: 'moomoo_sin_dato' }), v(OR(0.24))]), 'sin_dato', 'la compra que el worker no pudo saber y la venta resuelta: «sin dato» (el worker nunca escribe esa ida y vuelta)');
      igual(E([a(OR(0)), v(OR(0))]), 'cero', 'las dos órdenes cobraron $0 de verdad: «cero» (un $0 real, no un pendiente eterno)');
      igual(E([a(OR(0.38)), v(OR(0.24))]), 'pendiente', 'las dos resueltas con monto y la ida y vuelta aún en 0: «pendiente» (el worker la escribe en su pasada siguiente)');
      igual(E([a(OR(0.38, '2026-10-27T15:00:00Z')), v(OR(0.24, '2026-10-27T15:00:00Z'))]), 'sin_dato', '… pero resueltas hace ≥ 4 días hábiles y aún en 0: «sin dato» (no se promete para siempre)');
      igual(E([FM('a2', 'compra', 1, 2, '2026-10-27T14:00:00Z'), FM('b2', 'venta', 1, 3, '2026-10-27T15:00:00Z')]), 'sin_dato', 'sin resolver pasado el plazo: «sin dato»');
      igual(E([a(), v()].map(sinCols)), 'desconocido', 'SIN la sql 0023 (el libro no trae comision_fuente): «desconocido», nada se afirma');
      igual(E([a()]), 'desconocido', 'falta una de sus ejecuciones en el libro: «desconocido»');
      igual(E([a(), v()], { clave_ext: 'm2' }), 'desconocido', 'una clave sin la forma de emparejar: «desconocido»');
      igual(E([a(), v()], { fees: 0.4 }), 'con', 'con fees > 0: «con» (lo demás no importa)');
      igual(W.estadoComisionTramoMoomoo({ ...BT[0] }, new Map(), AHORA), null, 'otro bróker: null');
      igual(E([a(OR(0.57)), FM('b2', 'venta', 1, 0, '2026-11-14T06:22:00Z', { expiracion: '2026-11-13', comision_fuente: 'moomoo_sin_dato' })], { cerrada_at: '2026-11-14T06:22:00Z' }), 'sin_dato',
        'la ida y vuelta que cierra con el VENCIMIENTO (venta a $0) que el worker dio por «sin dato»: «sin dato» (el lado del vencimiento cuenta aquí)');
      // la operación y los tiles con cada estado
      const pinta = (lib) => { const o = mk(W.unirOperaciones([], [BT[2]]).ops, lib)[0]; return { d: W.detalleOpCuentas(o, {}), t: W.tarjetaHistorial(o, {}), f: W.filaHistorialCuentas(o, { fills: [], senales: [] }), M: met([o]) }; };
      const sd = pinta([a({ comision_fuente: 'moomoo_sin_dato' }), v(OR(0.24))]);
      assert(sd.d.comMM === 'sin_dato' && /comisión de moomoo sin dato \(P&amp;L bruto: no se pudo saber\)/.test(sd.t) && !/aún sin dato|la Mesa la reparta/.test(sd.t + sd.f) && /<span class="csub">com\. sin dato<\/span>/.test(sd.f),
        'sin dato: «comisión de moomoo sin dato (P&L bruto: no se pudo saber)», «com. sin dato», sin «aún» ni promesa');
      const tsd = W.tilesCuentasHtml(sd.M, 'semana');
      assert(sd.M.com_pend_mm === 0 && sd.M.com_sin_mm === 1 && /1 ida y vuelta de moomoo sin dato de comisión/.test(tsd) && !/aún sin dato/.test(tsd), 'los tiles: «1 ida y vuelta de moomoo sin dato de comisión» (sin «aún»)');
      const ce = pinta([a(OR(0)), v(OR(0))]);
      assert(ce.d.com === 0 && ce.d.comMM === null && /neto · bruto \$100\.00 − comisión \$0\.00/.test(ce.t) && !/comisión de moomoo|com\. sin dato|com\. pendiente/.test(ce.t + ce.f), '$0 real: «neto · bruto $100.00 − comisión $0.00» (un dato, no un pendiente)');
      igual([ce.M.comisiones, ce.M.com_brokers, ce.M.sin_com_brokers, ce.M.com_sin_dato, ce.M.util], [0, ['moomoo'], [], 0, 100], 'los tiles: la de moomoo es $0.00 descontado (neta), nada «sin dato»');
      const de = pinta(null);
      assert(de.d.comMM === 'desconocido' && /P&amp;L bruto \(sin la comisión de moomoo\)/.test(de.t) && !/la Mesa la reparta|aún sin dato/.test(de.t + de.f) && /<span class="csub">bruto<\/span>/.test(de.f),
        'sin libro (lectura fallida): «P&L bruto (sin la comisión de moomoo)», sin promesa');
      const ne = pinta([a(), v()].map(sinCols));
      assert(ne.d.comMM === 'desconocido' && !/la Mesa la reparta|aún sin dato/.test(ne.t), 'sin la 0023: lo mismo (nada se afirma)');
      // marcar: solo AÑADE el campo, en copias
      const crudas = W.unirOperaciones([], BT).ops, marcadas = mk(crudas);
      assert(crudas.every(o => (o._partes_filas || []).every(t => !('_com_mm' in t))) && marcadas.find(o => o.broker === 'etrade') === crudas.find(o => o.broker === 'etrade'),
        'marcarComisionMoomooCuentas no toca las leídas (copias) ni las operaciones de otros brókeres');
      igual(marcadas.filter(o => o.broker === 'moomoo').map(o => o._partes_filas.map(t => t._com_mm)), [['con'], ['pendiente']], 'marca cada ida y vuelta de moomoo');
      igual([W.marcarComisionMoomooCuentas(null, LIB, AHORA), W.marcarComisionMoomooCuentas([null], LIB, AHORA)], [null, [null]], 'sin operaciones o con basura: no se rompe');
      assert(/todas = marcarComisionMoomooCuentas\(todas, fillsR\.error \? null : fillsR\.filas, Date\.now\(\)\)/.test(extraer('vistaCuentasSaldos')), 'vistaCuentasSaldos marca con el MISMO libro que ya lee (sin consultas nuevas); sin él, null');
    }

    // ── 7b. v71 rev · las filas TAL CUAL las escribe moomoo_cuenta.emparejar del worker 0.1.15: resultado_usd en BRUTO y la
    // comisión aparte en fees (salida del emparejar REAL con deals de juguete: compra 3 @2.00 de $0.57, venta 1 @2.50 de
    // $0.24, venta 2 @3.00 de $0.43). Jueces de dinero y de seguridad: Cuentas daba $250 «neta» con el Diario en $248.76.
    const RAWW = { fuente: 'moomoo OpenD history_deal_list_query', fees: 'moomoo order_fee_query, repartidas por contratos', cuenta: 'MARGEN' };
    const OSI = 'TSLA  261113C00450000', AB = '2026-11-06T09:40:00-05:00';
    const fila = (n, ps, cierre, res, fees, ids) => ({ broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 450.0, expiracion: '2026-11-13', contratos: n,
      prima_fill: 2.0, prima_salida: ps, abierta_at: AB, cerrada_at: cierre, resultado_usd: res, fees, clave_ext: `${OSI}|${AB}|${cierre}|${n}|${ids}`, raw: { ...RAWW } });
    const WA = [fila(1, 2.5, '2026-11-06T10:00:00-05:00', 50.0, 0.43, 'd1>d2'), fila(2, 3.0, '2026-11-06T10:10:00-05:00', 200.0, 0.81, 'd1>d3')];
    const FA = [FM('d1', 'compra', 3, 2.00, AB, { comision: 0.57, comision_fuente: 'moomoo_orden' }), FM('d2', 'venta', 1, 2.50, '2026-11-06T10:00:00-05:00', { comision: 0.24, comision_fuente: 'moomoo_orden' }),
      FM('d3', 'venta', 2, 3.00, '2026-11-06T10:10:00-05:00', { comision: 0.43, comision_fuente: 'moomoo_orden' })];
    const util = (bt) => W.metricasCuentas(W.resumenPeriodo(W.unirOperaciones([], bt).ops, '2026-11-01').ops, '2026-11-01');
    const diario = (fs) => { const R = D.emparejarFillsFIFO(fs, HOY); return D.metricasDiario(R.cerradas, D.diaADia(R.cerradas, null, null, R.viajes), R.viajes, fs).total; };
    const MA = util(WA);
    igual([MA.util, MA.comisiones, MA.com_brokers], [248.76, 1.24, ['moomoo']], 'Cuentas con las filas del worker: utilidad NETA $248.76 = $250 − $1.24 (antes $250 rotulada «neta»)');
    igual(MA.util, diario(FA), 'Cuentas = Diario al centavo con las MISMAS ejecuciones');
    const opA = W.unirOperaciones([], WA).ops[0], dA = W.detalleOpCuentas(opA, {});
    igual([dA.neto, dA.bruto, dA.com], [248.76, 250, 1.24], 'la operación: neto $248.76, bruto $250.00 (el de sus primas, no $251.24 inventado) y comisión $1.24');
    assert(/neto · bruto \$250\.00 − comisión \$1\.24/.test(W.tarjetaHistorial(opA, {})), 'la tarjeta: «neto · bruto $250.00 − comisión $1.24»');
    // el mismo período si el worker escribe la convención de la casa (resultado_usd NETO): idéntico, nunca dos descuentos
    const WN = WA.map(t => ({ ...t, resultado_usd: Math.round((t.resultado_usd - t.fees) * 100) / 100 }));
    igual([util(WN).util, W.detalleOpCuentas(W.unirOperaciones([], WN).ops[0], {}).bruto], [248.76, 250], 'filas ya NETAS (E*TRADE y tasty lo hacen así): $248.76 y bruto $250.00, sin restar dos veces');
    // salida escalonada por tercios (compra $0.58, tres ventas de $0.20): el worker reparte 0.39 / 0.39 / 0.40
    const WB = [fila(1, 2.5, '2026-11-06T10:00:00-05:00', 50.0, 0.39, 'd1>d2'), fila(1, 2.5, '2026-11-06T10:05:00-05:00', 50.0, 0.39, 'd1>d3'), fila(1, 2.5, '2026-11-06T10:10:00-05:00', 50.0, 0.40, 'd1>d4')];
    const FB = [FM('d1', 'compra', 3, 2.00, AB, { comision: 0.58, comision_fuente: 'moomoo_orden' })].concat(['10:00', '10:05', '10:10'].map((h, i) => FM('d' + (i + 2), 'venta', 1, 2.50, `2026-11-06T${h}:00-05:00`, { comision: 0.20, comision_fuente: 'moomoo_orden' })));
    igual([util(WB).util, diario(FB)], [148.82, 148.82], 'salida en tercios: Cuentas y Diario $148.82 = $150 − $1.18 (antes $150 y $148.83)');
    // filasMoomooNetas, sola
    const N = W.filasMoomooNetas;
    const otras = [{ ...WA[0], broker: 'etrade' }, { ...WA[0], fees: 0 }, { ...WA[0], prima_salida: null }, { ...WA[0], contratos: 0 }, WN[0]];
    assert(N(otras) === otras, 'no toca: E*TRADE, moomoo con fees 0, sin prima o sin contratos, ni la que ya viene neta (el MISMO arreglo)');
    const n1 = N(WA);
    igual([n1[0].resultado_usd, n1[0].raw.moomoo_bruto, n1[0].raw.fees, WA[0].resultado_usd, WA[0].raw.moomoo_bruto], [49.57, 50, RAWW.fees, 50, undefined], 'copia con el neto y el bruto en raw.moomoo_bruto; la fila leída no cambia');
    igual(N(n1).map(t => t.resultado_usd), [49.57, 199.19], 'leída dos veces no resta dos veces');
    igual([N(null), N(undefined), N([null, {}]).length], [null, undefined, 2], 'sin filas o con basura: no se rompe');
  }

  // ════════════════ 8. el Diario ENTERO pintado (módulo real, supabase de juguete) ════════════════
  async function diarioPintado(fills) {
    const sb = sbFalso((tabla) => (tabla === 'fills' ? { data: fills, error: null } : { data: [], error: null }));
    const m = C.cargarModuloEntero({ src: './app/main.js?v=71', hash: '#/cuentas',
      supabase: { createClient: () => ({ from: sb.from, channel: () => ({ on() { return this; }, subscribe() { return this; } }), auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
    if (!m.cargo) return { error: m.error };
    let vista = '';
    m.win.document.querySelector = (s) => {
      if (s === '#vista') { const n = nodo(); Object.defineProperty(n, 'innerHTML', { set(v) { vista = v; }, get() { return vista; } }); return n; }
      return nodo();
    };
    await respirar();
    m.ev("sesionActiva = { user: { id: 'u1' } }; _cuentasVista = 'diario';");
    let error = null;
    try { await m.ev('vistaDiario(true)'); } catch (e) { error = String((e && e.stack) || e); }
    return { vista, error };
  }
  {
    const ahora = Date.now();
    const hoyRes = RES.map((f, i) => ({ ...f, ejecutado_at: iso(ahora - (3 - i) * 3600000), fecha_ny: ymdNY(iso(ahora - (3 - i) * 3600000)), expiracion: '2099-12-31' }));
    const pend = [FM('a', 'compra', 1, 1.00, iso(ahora - 10 * 60000), { expiracion: '2099-12-31', strike: 470 })];
    const R1 = await diarioPintado(hoyRes.concat(pend));
    assert(!R1.error && /EJECUCIONES DEL PERÍODO · 4/.test(R1.vista), 'el Diario entero se pinta con las ejecuciones de moomoo (resueltas y una pendiente)', R1.error || R1.vista.slice(0, 200));
    assert(/comisiones ya descontadas: \$1\.24 \(moomoo \$1\.24\)/.test(R1.vista), 'el pie del Diario real: «comisiones ya descontadas: $1.24 (moomoo $1.24)»');
    assert(/1 ejecución de moomoo con la comisión pendiente/.test(R1.vista) && /neto de las comisiones conocidas/.test(R1.vista), '… «1 ejecución de moomoo con la comisión pendiente» y el total «neto de las comisiones conocidas»');
    assert(/\+?\$248\.76/.test(R1.vista), 'el total del Diario es el NETO ($248.76 = $250 − $1.24)');
    assert(/com pendiente/.test(R1.vista) && /comisión de la orden \$0\.57: ORF \$0\.19 · OCC \$0\.38/.test(R1.vista), 'la lista: «com pendiente» y el desglose de la orden');
    const R2 = await diarioPintado(hoyRes.concat(pend).map(sinCols));
    assert(!R2.error && /EJECUCIONES DEL PERÍODO · 4/.test(R2.vista) && !/com pendiente|sin dato de comisión|comisión pendiente|com sin dato/.test(R2.vista),
      'SIN la sql 0023 (las filas no traen las columnas): el Diario se pinta igual y no afirma nada de pendientes', R2.error || '');
  }

  // ════════════════ 9. v71 rev · Cuentas ENTERA pintada (módulo real, supabase de juguete) con lo que escribe el worker ════════════════
  {
    const ahora = Date.now(), at = (h) => new Date(ahora - h * 3600000).toISOString();
    const OSI = 'TSLA  991231C00450000', base = { broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', expiracion: '2099-12-31', prima_fill: 2.0 };
    const fila = (strike, n, ps, ab, ce, res, fees, ids) => ({ ...base, strike, contratos: n, prima_salida: ps, abierta_at: ab, cerrada_at: ce, resultado_usd: res, fees,
      clave_ext: `${OSI}|${ab}|${ce}|${n}|${ids}`, raw: { fuente: 'moomoo OpenD history_deal_list_query', fees: 'moomoo order_fee_query, repartidas por contratos' } });
    // la operación de la 7b (bruto + fees, como el emparejar REAL) y otra con su venta aún sin resolver (fees 0, pendiente)
    const BTW = [fila(450, 1, 2.5, at(3), at(2.9), 50.0, 0.43, 'd1>d2'), fila(450, 2, 3.0, at(3), at(2.8), 200.0, 0.81, 'd1>d3'), fila(460, 1, 3.0, at(2), at(1), 100.0, 0, 'p1>p2')];
    const FW = [FM('d1', 'compra', 3, 2.00, at(3), { expiracion: '2099-12-31', comision: 0.57, comision_fuente: 'moomoo_orden' }), FM('d2', 'venta', 1, 2.50, at(2.9), { expiracion: '2099-12-31', comision: 0.24, comision_fuente: 'moomoo_orden' }),
      FM('d3', 'venta', 2, 3.00, at(2.8), { expiracion: '2099-12-31', comision: 0.43, comision_fuente: 'moomoo_orden' }),
      FM('p1', 'compra', 1, 2.00, at(2), { strike: 460, expiracion: '2099-12-31', comision: 0.19, comision_fuente: 'moomoo_orden' }), FM('p2', 'venta', 1, 3.00, at(1), { strike: 460, expiracion: '2099-12-31' })];
    async function cuentasPintada(op) {
      const sb = sbFalso((tabla) => {
        if (tabla === 'broker_trades') return { data: JSON.parse(JSON.stringify(BTW)), error: null };
        if (tabla === 'fills') return op.fillsError ? { data: null, error: { message: 'timeout' } } : { data: JSON.parse(JSON.stringify(FW)), error: null };
        return { data: [], error: null };
      });
      const canal = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
      const m = C.cargarModuloEntero({ src: './app/main.js?v=71', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
      if (!m.cargo) return { error: m.error };
      m.win.innerWidth = op.ancho || 1400;
      let html = '';
      m.win.document.querySelector = (s) => { const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; };
      m.ev("location.hash = '#/cuentas'; _cuentasVista = 'cuentas'; _periodoSel = 'ytd';");
      let error = null;
      try { await m.ev('vistaCuentasSaldos()'); } catch (e) { error = String((e && e.stack) || e); }
      await respirar();
      return { html, error };
    }
    const P = await cuentasPintada({});
    assert(!P.error && /UTILIDAD · YTD/.test(P.html), 'Cuentas se pinta entera con las filas del worker y el libro', P.error || P.html.slice(0, 200));
    assert(/\+?\$348\.76/.test(P.html), 'la utilidad es NETA de la comisión que ya está: $250 − $1.24 + $100 (la otra, aún bruta) = $348.76 (antes $350.00)');
    assert(/neta de las comisiones de moomoo; 1 ida y vuelta de moomoo aún sin dato de comisión \(su P&L va sin descontarlas\)/.test(P.html), 'el tile: «neta de las comisiones de moomoo; 1 ida y vuelta de moomoo aún sin dato de comisión»');
    assert(/title="neto · bruto \$250\.00 − comisión \$1\.24"><b>\+?\$248\.76<\/b><span class="csub">bruto \$250\.00<\/span>/.test(P.html), 'la fila de la operación con comisión: $248.76 neto, «bruto $250.00» (no $251.24)');
    assert(/title="comisión de moomoo aún sin dato \(P&amp;L bruto hasta que moomoo la asiente y la Mesa la reparta\)"><b>\+?\$100\.00<\/b><span class="csub">com\. pendiente<\/span>/.test(P.html), 'la que tiene su venta aún sin resolver: «com. pendiente» y la promesa (el worker SÍ la va a escribir)');
    const T = await cuentasPintada({ ancho: 390 });
    assert(!T.error && /neto · bruto \$250\.00 − comisión \$1\.24/.test(T.html) && /comisión de moomoo aún sin dato/.test(T.html), 'a 390 px (tarjetas): lo mismo bajo el P&L');
    const S = await cuentasPintada({ fillsError: true });
    assert(!S.error && /\+?\$348\.76/.test(S.html) && /title="P&amp;L bruto \(sin la comisión de moomoo\)"><b>\+?\$100\.00<\/b><span class="csub">bruto<\/span>/.test(S.html) && !/la Mesa la reparta/.test(S.html)
      && /1 ida y vuelta de moomoo sin dato de comisión/.test(S.html), 'con la lectura del libro caída: la neta sigue neta, la otra «P&L bruto (sin la comisión de moomoo)» y «sin dato» en los tiles, sin promesa');
  }

  C.resumen();
})().catch(e => { C.falla('excepción inesperada', String((e && e.stack) || e)); C.resumen(); });
