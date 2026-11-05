#!/usr/bin/env node
/* v69 · «Settled Cash» de moomoo y aviso de good faith violation (spec71, 2026-11-04). La cuenta de moomoo de Andrés es de
   EFECTIVO: comprar con dinero sin liquidar está permitido; VENDER esa compra antes de que se liquide el dinero con que se
   pagó es una good faith violation. El worker 0.1.13 (sql 0022) escribe la liquidez en el row moomoo de cuenta_snapshots y
   una fila por compra de hoy en compras_no_liquidadas; la app la LEE y la enseña:
     1. puras: liquidezDeFila (N/A → «no sé», nunca 0; sin la 0022 → sinColumnas), edadLiquidez (s, min, la hora en sesión,
        otro día, «dato viejo» > 30 min), nombreContratoGfv, gfvComprasHoy (abiertas / vendidas / desconocidas / por contrato)
     2. la tarjeta «Liquidez moomoo · cuenta de efectivo» (solo CASH): las tres cifras con sus frases, «se libera el jue
        5-nov», la edad, role=status, la línea roja por compra, el «no sé» de las desconocidas, la venta que pudo ser GFV,
        esc() en todo lo dinámico; la insignia, el aviso del cuadro «Vender en moomoo» y «liquidado $X» de Cuentas
     3. cargarLiquidez con un supabase de juguete: el amigo sin moomoo hace UNA consulta barata (y nada más en 10 min), sin la
        0022 no hay segunda consulta ni canales, con CASH lee las compras de HOY y abre sus canales (solo INSERT/UPDATE), un
        fallo no borra lo leído ni rechaza, una lectura forzada durante otra encadena UNA sola más
     4. Realtime → repintado EN SITIO (pintarLiquidezEnSitio, liquidezCambio): la tarjeta, sus líneas solo si cambian, las
        insignias; nunca #vista; otros brókeres de cuenta_snapshots no tocan nada
     5. el módulo ENTERO: vistaCopiloto pinta la tarjeta y la insignia (tarjetas y tabla), el amigo y la base sin 0022 no ven
        nada nuevo, un evento de Realtime repinta en sitio sin tocar #vista; Cuentas dice «liquidado $X»; el Diario y el
        cuadro «Vender en moomoo» llevan el aviso
     6. el fuente: nada escribe en las tablas nuevas, ni event «*», ni columnas nuevas nombradas en un select; CSS a 375 px
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Contra la v68 (main 7e3f9fd) FALLA: no existe.
   Números inventados con la forma de los reales (ninguna cifra de la cuenta de Andrés).
   Uso: node test_liquidez.js wt-v69/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_liquidez.js');
const { FUENTE, assert, igual, construir, extraer, esc, ymdNY, nodo, respirar } = C;
const tiene = (n) => { try { extraer(n); return true; } catch (_) { return false; } };

const NOMBRES = ['liquidezDeFila', 'edadLiquidez', 'nombreContratoGfv', 'gfvComprasHoy', 'lineasLiquidezHtml', 'tarjetaLiquidezHtml', 'insigniaGfvHtml',
  'avisoVentaGfvHtml', 'liquidadoCuentaHtml', 'gfvDe', 'cargarLiquidez', 'suscribirLiquidez', 'liquidezCambio', 'pintarLiquidezEnSitio'];
const faltan = NOMBRES.filter(n => !tiene(n));
if (faltan.length) { C.falla('no existe la liquidez de moomoo ni el aviso de good faith (faltan: ' + faltan.join(', ') + ')'); C.resumen(); }

const PURAS = ['liquidezDeFila', 'edadLiquidez', 'edadLiquidezHtml', 'claseEdadLiquidez', 'nombreContratoGfv', 'gfvComprasHoy', 'lineasLiquidezHtml',
  'tarjetaLiquidezHtml', 'montoGfv', 'insigniaGfvHtml', 'avisoVentaGfvHtml', 'liquidadoCuentaHtml', 'fechaGfvHtml', 'fechaCortaAviso', 'horaNY', 'claveCartera', 'claveContrato'];
const P = construir(PURAS, { esc, ymdNY }, { consts: ['dineroD', 'LIQ_RUIDO_USD', 'LIQ_MISMA_LECTURA_MS', 'LIQ_VIEJO_MIN'] });

const HOY = '2026-11-04';                 // miércoles (las secciones PURAS: la hora entra como argumento)
// Las secciones que corren con el reloj de VERDAD (ctxLiquidez usa Date.now, cargarModuloEntero el día real) usan el día NY
// real y el siguiente hábil: con un HOY fijo, `hace 2x s` solo era verde el 4-nov (revisión de seguridad, fecha_falsa.js).
const HOYR = ymdNY();
const MANANA = (() => { const d = new Date(HOYR + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); })();
const MS = (iso) => Date.parse(iso);
const AHORA = MS('2026-11-04T19:52:00Z');  // 14:52 ET
// Un row moomoo de cuenta_snapshots con la 0022 (cuenta de efectivo, números inventados)
const ROW = (o) => Object.assign({ broker: 'moomoo', origen: 'vps', numero_mascara: '12***89', saldo_neto: 3871.05, efectivo: 3871.05, poder_compra: 3871.05,
  capturado_at: '2026-11-04T19:51:48Z', efectivo_liquidado: 63.42, tipo_cuenta: 'CASH', liquidado_at: '2026-11-04T19:51:48Z',
  liquidado_inicio: 3402.9, liquidado_inicio_fecha: HOY, se_libera_el: '2026-11-05' }, o || {});
// Una fila de compras_no_liquidadas (compra de hoy)
const COMPRA = (o) => Object.assign({ user_id: 'u1', broker: 'moomoo', clave_fill: 'mm-1', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: '2026-11-07',
  contratos: 2, monto_usd: 512, liquidado_antes_usd: 312, no_liquidado_usd: 200, estado: 'no_liquidada', ejecutado_at: '2026-11-04T14:53:00Z', fecha_ny: HOY,
  libre_desde: '2026-11-05', vendida_antes_at: null }, o || {});

// ════════════════ 1. puras ════════════════
{
  const L = P.liquidezDeFila(ROW());
  igual([L.tipo, L.liquidado, L.efectivo, L.sinLiquidar, L.poder, L.liberaEl, L.inicio, L.inicioFecha, L.sinColumnas],
    ['CASH', 63.42, 3871.05, 3807.63, 3871.05, '2026-11-05', 3402.9, HOY, false], 'el row CASH: liquidado, efectivo, sin liquidar = efectivo − liquidado, poder de compra, cuándo se libera, el liquidado del inicio');
  const NA = P.liquidezDeFila(ROW({ efectivo_liquidado: null, poder_compra: 'N/A', liquidado_inicio: '', se_libera_el: null }));
  igual([NA.liquidado, NA.sinLiquidar, NA.poder, NA.inicio, NA.liberaEl], [null, null, null, null, null], 'N/A / null / vacío → null («no sé»), nunca 0; sin liquidado no hay «sin liquidar»');
  igual(P.liquidezDeFila(ROW({ efectivo: 50, efectivo_liquidado: 63.42 })).sinLiquidar, null, 'efectivo por debajo del liquidado más allá de $1: las cifras no casan → «no sé»');
  igual(P.liquidezDeFila(ROW({ efectivo: 63, efectivo_liquidado: 63.42 })).sinLiquidar, 0, '… dentro del ruido de $1 (tasas): 0');
  igual(P.liquidezDeFila({ broker: 'moomoo', saldo_neto: 1000, efectivo: 1000, poder_compra: 1000, origen: 'vps', capturado_at: '2026-11-04T19:00:00Z' }), { sinColumnas: true },
    'SIN la 0022 (el row no trae la clave tipo_cuenta): sinColumnas — la app sigue como la v68');
  igual([P.liquidezDeFila(null), P.liquidezDeFila(undefined)], [null, null], 'sin row: null');
  igual([P.liquidezDeFila(ROW({ tipo_cuenta: 'margin' })).tipo, P.liquidezDeFila(ROW({ tipo_cuenta: null })).tipo, P.liquidezDeFila(ROW({ tipo_cuenta: 'RARA' })).tipo], ['MARGIN', null, null],
    'tipo_cuenta: CASH | MARGIN (mayúsculas); null u otro = no se sabe');

  const e = (at, ahora, ses, hoy) => P.edadLiquidez(at, ahora, ses, hoy == null ? HOY : hoy);
  igual(e('2026-11-04T19:51:48Z', AHORA, true), { txt: 'hace 12 s', viejo: false }, '«hace 12 s»');
  igual(e('2026-11-04T19:49:30Z', AHORA, true), { txt: 'hace 2 min', viejo: false }, '«hace 2 min»');
  igual(e('2026-11-04T19:45:00Z', AHORA, true), { txt: 'dato de las 14:45', viejo: false }, 'EN SESIÓN, pasados 5 min: la HORA del dato (14:45 ET)');
  igual(e('2026-11-04T19:45:00Z', AHORA, false), { txt: 'hace 7 min', viejo: false }, 'fuera de sesión: «hace 7 min»');
  igual(e('2026-11-04T19:20:00Z', AHORA, true), { txt: 'dato de las 14:20', viejo: true }, 'más de 30 min: viejo (ámbar)');
  igual(e('2026-11-04T16:00:00Z', AHORA, false), { txt: 'hace 3 h', viejo: true }, 'fuera de sesión, horas: «hace 3 h», viejo');
  igual(e('2026-11-04T00:52:00Z', AHORA, false), { txt: 'dato del mar 3-nov a las 19:52', viejo: true }, 'de OTRO día NY: «dato del mar 3-nov a las 19:52» (el liquidado de ayer no es el de hoy)');
  igual(e(null, AHORA, true), { txt: 'sin la hora de la lectura', viejo: true }, 'sin hora: se dice, y viejo');
  igual(e('2026-11-04T19:53:00Z', AHORA, true), { txt: 'hace 0 s', viejo: false }, 'un reloj adelantado no da edad negativa');
  igual([P.edadLiquidezHtml({ txt: 'hace 3 h', viejo: true }), P.claseEdadLiquidez({ viejo: true }), P.claseEdadLiquidez({ viejo: false })],
    ['hace 3 h · dato viejo', 'liqedad viejo', 'liqedad'], 'viejo → «· dato viejo» y la clase ámbar');

  igual([P.nombreContratoGfv(COMPRA()), P.nombreContratoGfv(COMPRA({ direccion: 'PUT', strike: '7.50', symbol: 'sofi' })), P.nombreContratoGfv(COMPRA({ strike: null }))],
    ['SPY 585C', 'SOFI 7.5P', 'SPY'], 'nombre corto del contrato: «SPY 585C» (como el push del worker)');

  const G = P.gfvComprasHoy([
    COMPRA(),
    COMPRA({ clave_fill: 'mm-2', no_liquidado_usd: 55.5, monto_usd: 255.5, ejecutado_at: '2026-11-04T15:10:00Z' }),          // otra del mismo contrato
    COMPRA({ clave_fill: 'mm-3', symbol: 'QQQ', strike: 520, estado: 'liquidada', no_liquidado_usd: 0, libre_desde: HOY }),  // pagada con liquidado
    COMPRA({ clave_fill: 'mm-4', symbol: 'TSLA', strike: 450, vendida_antes_at: '2026-11-04T16:20:00Z' }),                   // vendida antes de liberarse
    COMPRA({ clave_fill: 'mm-5', symbol: 'NVDA', strike: 210, estado: 'desconocido', no_liquidado_usd: null }),
    COMPRA({ clave_fill: 'mm-6', fecha_ny: '2026-11-03', libre_desde: HOY }),                                                 // de ayer
    COMPRA({ clave_fill: 'mm-7', broker: 'tasty' }),                                                                           // otro bróker
    COMPRA({ clave_fill: 'mm-8', symbol: 'AAPL', strike: 270, libre_desde: HOY }),                                             // ya libre
    null,
  ], HOY);
  igual(G.abiertas.map(c => c.clave_fill), ['mm-1', 'mm-2'], 'abiertas: las «no_liquidada» de hoy aún no libres y sin vender');
  igual(G.vendidas.map(c => c.clave_fill), ['mm-4'], 'vendidas: la que se vendió HOY antes de liberarse (posible GFV)');
  igual(G.desconocidas.map(c => c.clave_fill), ['mm-5'], 'desconocidas: el worker no supo el liquidado del inicio');
  igual(G.porContrato, { 'moomoo|SPY|CALL|585|2026-11-07': { usd: 255.5, sinMonto: false, libre: '2026-11-05', n: 2 }, 'moomoo|TSLA|CALL|450|2026-11-07': { usd: 200, sinMonto: false, libre: '2026-11-05', n: 1 } },
    'por contrato: la suma sin liquidar y el día en que queda libre (la vendida también: si queda parte abierta, sigue sin poder venderse); nada de liquidadas, de ayer, de otro bróker ni ya libres');
  igual(P.gfvComprasHoy([COMPRA({ no_liquidado_usd: null }), COMPRA({ clave_fill: 'x', no_liquidado_usd: 40 })], HOY).porContrato['moomoo|SPY|CALL|585|2026-11-07'],
    { usd: 40, sinMonto: true, libre: '2026-11-05', n: 2 }, 'una compra sin monto se anota (sinMonto): nunca se inventa');
  igual(P.gfvComprasHoy(null, HOY), { abiertas: [], vendidas: [], desconocidas: [], porContrato: {} }, 'sin filas: nada');
  igual(P.gfvComprasHoy([COMPRA({ vendida_antes_at: '2026-11-03T16:00:00Z' })], HOY).vendidas.length, 0, 'una venta de otro día no es «de hoy»');
  igual([P.montoGfv({ usd: 122.83, sinMonto: false }), P.montoGfv({ usd: 50, sinMonto: true }), P.montoGfv({ usd: 0, sinMonto: true }), P.montoGfv(null)],
    ['$122.83', 'al menos $50.00', null, null], 'el monto de la insignia: exacto, «al menos» o null (no se sabe)');
}

// ════════════════ 2. la tarjeta, la insignia, el aviso del cuadro y Cuentas ════════════════
const CTX = { hoy: HOY, ahoraMs: AHORA, enSesion: false, err: null, errCompras: null };
{
  const L = P.liquidezDeFila(ROW());
  const G0 = P.gfvComprasHoy([], HOY);
  const h = P.tarjetaLiquidezHtml(L, G0, CTX);
  const txt = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  assert(/<h3>Liquidez moomoo · cuenta de efectivo<\/h3>/.test(h), 'título «Liquidez moomoo · cuenta de efectivo»');
  assert(txt(h).includes('Liquidado $63.42 — lo que compres hasta esto lo puedes vender hoy'), '«Liquidado $63.42 — lo que compres hasta esto lo puedes vender hoy»', txt(h).slice(0, 300));
  assert(txt(h).includes('Sin liquidar $3,807.63 — se libera el jue 5-nov'), '«Sin liquidar $3,807.63 — se libera el jue 5-nov»');
  assert(txt(h).includes('Poder de compra $3,871.05'), '«Poder de compra $3,871.05»');
  assert(/<span id="liq_edad" class="liqedad">hace 12 s<\/span>/.test(h), 'la edad del dato en la cabecera: «hace 12 s»');
  assert(/<div id="liq_lineas" role="status" aria-live="polite">/.test(h), 'las líneas en una región role=status, aria-live cortés');
  assert(txt(h).includes('al empezar el día: $3,402.90 liquidado'), 'el liquidado al empezar el día (de HOY)');
  assert(!/class="liqal"/.test(h) && !/class="liqam"/.test(h), 'sin compras sin liquidar hoy: ni líneas rojas ni ámbar');
  assert(/good faith violation/.test(h) && /comprar con dinero sin liquidar está permitido/.test(h), 'una línea explica la regla (comprar sí; vender esa compra antes, no)');
  igual([P.tarjetaLiquidezHtml(null, G0, CTX), P.tarjetaLiquidezHtml({ sinColumnas: true }, G0, CTX), P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ tipo_cuenta: 'MARGIN' })), G0, CTX),
    P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ tipo_cuenta: null })), G0, CTX)], ['', '', '', ''], 'SIN tarjeta: sin row, sin la 0022, cuenta de margen o tipo desconocido');
  // el caso de prueba «real» (forma del 4-nov): tres compras, todas pagadas con dinero liquidado → ninguna línea roja
  const todas = [COMPRA({ estado: 'liquidada', no_liquidado_usd: 0, liquidado_antes_usd: 2100, monto_usd: 2100, libre_desde: HOY }),
    COMPRA({ clave_fill: 'mm-2', estado: 'liquidada', no_liquidado_usd: 0, monto_usd: 1150, libre_desde: HOY }),
    COMPRA({ clave_fill: 'mm-3', estado: 'liquidada', no_liquidado_usd: 0.1, monto_usd: 89.5, libre_desde: HOY })];
  const hT = P.tarjetaLiquidezHtml(L, P.gfvComprasHoy(todas, HOY), CTX);
  assert(!/class="liqal"/.test(hT) && !/No la vendas/i.test(hT), 'TODAS las compras de hoy pagadas con liquidado (el caso del 4-nov): ni una línea roja');
  // una compra pagada en parte con dinero sin liquidar
  const hP = P.tarjetaLiquidezHtml(L, P.gfvComprasHoy([COMPRA()], HOY), CTX);
  assert(txt(hP).includes('⚠ SPY 585C ×2 · 09:53 · $200.00 de $512.00 sin liquidar — no la vendas hoy: libre desde el jue 5-nov'), 'una línea ROJA por compra: contrato, cantidad, hora, cuánto sin liquidar y desde cuándo libre', txt(hP));
  assert(/<div class="liqal">⚠ <b>SPY 585C<\/b>/.test(hP), '… con la clase roja');
  // desconocidas, venta que pudo ser GFV, errores
  const hD = P.tarjetaLiquidezHtml(L, P.gfvComprasHoy([COMPRA({ estado: 'desconocido', no_liquidado_usd: null })], HOY), CTX);
  assert(txt(hD).includes('No sé si tus compras de hoy usaron dinero sin liquidar (el servidor arrancó a media sesión): mira Settled Cash en moomoo'), 'desconocido: «no sé si tus compras de hoy usaron dinero sin liquidar … mira Settled Cash en moomoo»');
  assert(/class="liqam"/.test(hD) && !/class="liqal"/.test(hD), '… en ámbar, sin inventar una línea roja');
  const hV = P.tarjetaLiquidezHtml(L, P.gfvComprasHoy([COMPRA({ vendida_antes_at: '2026-11-04T16:20:00Z' })], HOY), CTX);
  assert(/<div class="liqal">⚠ <b>Hoy hubo una venta que puede contar como good faith violation<\/b>: SPY 585C \(vendida a las 11:20, libre desde el <span class="liqf">jue 5-nov<\/span>\)/.test(hV), 'vendida antes de liberarse: aviso ROJO «hoy hubo una venta que puede contar como good faith violation»', hV.slice(0, 400));
  assert(hV.indexOf('Hoy hubo una venta') < hV.indexOf('Liquidado'), '… lo primero de la tarjeta');
  assert(!/\b[0-9]+ violaci/i.test(txt(hV)) && /puede limitar la cuenta 90 días/.test(hV), 'no afirma cuántas violaciones disparan la restricción (no está confirmado)');
  const hE = P.tarjetaLiquidezHtml(L, G0, { ...CTX, errCompras: 'la tabla compras_no_liquidadas aún no está en la base (migración pendiente)', err: 'sin red' });
  assert(/No pude leer tus compras de hoy \(la tabla compras_no_liquidadas/.test(hE) && /no pude volver a leer la liquidez \(sin red\): las cifras son de la última lectura/.test(hE), 'los fallos de lectura se dicen (y lo leído antes se presenta como de antes)');
  // huecos: «no sé», jamás $0
  const hN = P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ efectivo_liquidado: null, poder_compra: null })), G0, CTX);
  assert(txt(hN).includes('Liquidado no sé — moomoo no dio el dato (Settled Cash)') && txt(hN).includes('Sin liquidar no sé') && txt(hN).includes('Poder de compra sin dato') && !/\$0\.00/.test(hN),
    'sin liquidado (N/A): «no sé», nunca $0.00');
  assert(txt(P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ efectivo: 63.42 })), G0, CTX)).includes('Sin liquidar $0.00 — todo tu efectivo está liquidado'), 'todo liquidado: «$0.00 — todo tu efectivo está liquidado»');
  assert(txt(P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ se_libera_el: null })), G0, CTX)).includes('se libera el próximo día hábil'), 'sin se_libera_el: «el próximo día hábil» (sin inventar la fecha)');
  // dato viejo y de otro día
  const hOld = P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ liquidado_at: '2026-11-04T00:52:00Z', liquidado_inicio_fecha: '2026-11-03' })), G0, CTX);
  assert(/<span id="liq_edad" class="liqedad viejo">dato del mar 3-nov a las 19:52 · dato viejo<\/span>/.test(hOld) && !/al empezar el día/.test(hOld), 'dato de ayer: ámbar «dato viejo» con su fecha y hora; el inicio de AYER no se presenta como de hoy');
  // revisión «la verdad del dato»: una lectura de OTRO día NY no se presenta como de hoy (R1 y caso_viejo de los revisores)
  {
    const ROWV = (o) => ROW(Object.assign({ efectivo: 4000, saldo_neto: 4000, poder_compra: 4000, efectivo_liquidado: 80, liquidado_inicio: null, liquidado_inicio_fecha: null }, o));
    const t = (row, hoy, ahoraIso) => txt(P.tarjetaLiquidezHtml(P.liquidezDeFila(row), P.gfvComprasHoy([], hoy), { hoy, ahoraMs: MS(ahoraIso), enSesion: false }));
    // jue 5-nov 9:00 ET con la lectura del mié 19:52 (se_libera_el = jue)
    const r1 = t(ROWV({ capturado_at: '2026-11-05T00:52:00Z', liquidado_at: '2026-11-05T00:52:00Z', se_libera_el: '2026-11-05' }), '2026-11-05', '2026-11-05T14:00:00Z');
    assert(!/próximo día hábil/.test(r1) && !/lo puedes vender hoy/.test(r1), 'lectura de AYER: ni «se libera el próximo día hábil» ni «lo puedes vender hoy» (eran de hoy y falsas)', r1);
    assert(r1.includes('Liquidado hoy no sé — la última lectura de moomoo es del mié 4-nov a las 19:52: mira Settled Cash en su app antes de vender algo comprado hoy'), '… dice «Liquidado hoy no sé» y de cuándo es la lectura', r1);
    assert(r1.includes('según esa lectura: liquidado $80.00 · sin liquidar $3,920.00, que se liberaba el jue 5-nov (ya debería estar liquidado) · poder de compra $4,000.00'), '… y las cifras como DE ESA LECTURA: lo no liquidado se liberaba hoy (ya debería estar liquidado)', r1);
    // lun 9-nov 8:40 ET con la lectura del vie 6-nov 19:50 (OpenD caído el fin de semana), se_libera_el = lun
    const cv = t(ROWV({ efectivo: 1000, saldo_neto: 1000, poder_compra: 1000, capturado_at: '2026-11-07T00:50:00Z', liquidado_at: '2026-11-07T00:50:00Z', se_libera_el: '2026-11-09' }), '2026-11-09', '2026-11-09T13:40:00Z');
    assert(cv.includes('sin liquidar $920.00, que se liberaba el lun 9-nov (ya debería estar liquidado)') && !/próximo día hábil/.test(cv), 'lunes con la lectura del viernes: «se liberaba el lun 9-nov (ya debería estar liquidado)», nunca «el próximo día hábil» (= martes)', cv);
    // sáb 7-nov con la lectura del vie: se libera el lunes (todavía no)
    const sa = t(ROWV({ capturado_at: '2026-11-07T00:50:00Z', liquidado_at: '2026-11-07T00:50:00Z', se_libera_el: '2026-11-09' }), '2026-11-07', '2026-11-07T15:00:00Z');
    assert(sa.includes('sin liquidar $3,920.00, que se libera el lun 9-nov ·'), 'sábado con la lectura del viernes: «que se libera el lun 9-nov»', sa);
    const sn = t(ROWV({ capturado_at: '2026-11-05T00:52:00Z', liquidado_at: '2026-11-05T00:52:00Z', se_libera_el: null }), '2026-11-05', '2026-11-05T14:00:00Z');
    assert(sn.includes('(no sé cuándo se libera)'), 'de otro día y sin se_libera_el: «no sé cuándo se libera»', sn);
    // una lectura de HOY con se_libera_el ≤ hoy no casa: «no sé cuándo» (y «el próximo día hábil» solo sin el dato)
    assert(txt(P.tarjetaLiquidezHtml(P.liquidezDeFila(ROW({ se_libera_el: HOY })), G0, CTX)).includes('Sin liquidar $3,807.63 — no sé cuándo se libera'), 'lectura de hoy con se_libera_el = hoy: «no sé cuándo se libera»');
  }
  // R2: el efectivo de HOY con el liquidado de AYER (LIQUIDEZ=0 o el worker 0.1.12 tras la 0022: brokers_sync escribe el
  // saldo cada 30 min sin las columnas de liquidez) → la resta sería inventada
  {
    const mez = P.liquidezDeFila(ROW({ efectivo: 3000, saldo_neto: 3000, poder_compra: 3000, efectivo_liquidado: 80, capturado_at: '2026-11-05T15:30:00Z', liquidado_at: '2026-11-04T20:00:00Z' }));
    igual([mez.mezcla, mez.sinLiquidar, mez.liquidado], [true, null, 80], 'capturado_at (efectivo) más nuevo que liquidado_at: mezcla → sin liquidar «no sé» (el liquidado se queda, con su hora)');
    const r2 = txt(P.tarjetaLiquidezHtml(mez, P.gfvComprasHoy([], '2026-11-05'), { hoy: '2026-11-05', ahoraMs: MS('2026-11-05T15:31:00Z'), enSesion: true }));
    assert(!/2,920/.test(r2) && r2.includes('sin liquidar no sé'), 'R2: ni $2,920.00 inventados ni «lo puedes vender hoy» con el liquidado de ayer', r2);
    const mezHoy = P.liquidezDeFila(ROW({ capturado_at: '2026-11-04T19:58:00Z', liquidado_at: '2026-11-04T19:51:48Z' }));
    assert(txt(P.tarjetaLiquidezHtml(mezHoy, G0, CTX)).includes('Sin liquidar no sé — el efectivo y el liquidado de esta fila son de lecturas distintas'), 'mezcla dentro del día: «son de lecturas distintas»');
    igual([P.liquidezDeFila(ROW({ capturado_at: '2026-11-04T19:30:00Z', liquidado_at: '2026-11-04T19:51:48Z' })).sinLiquidar,
      P.liquidezDeFila(ROW({ capturado_at: '2026-11-04T19:51:52Z', liquidado_at: '2026-11-04T19:51:48Z' })).sinLiquidar,
      P.liquidezDeFila(ROW({ liquidado_at: null })).sinLiquidar], [3807.63, 3807.63, null],
      'la foto del worker escribe efectivo + liquidado sin capturado_at (capturado más viejo): misma lectura; ≤ 5 s de diferencia: misma; sin liquidado_at: no se sabe');
  }
  // escape
  const hX = P.tarjetaLiquidezHtml(L, P.gfvComprasHoy([COMPRA({ symbol: '<img src=x onerror=alert(1)>', estado: 'no_liquidada' })], HOY), CTX);
  assert(!/<img/.test(hX) && /&lt;IMG SRC=X ONERROR=ALERT\(1\)&gt;/.test(hX), 'todo texto dinámico pasa por esc()');

  // la insignia
  igual(P.insigniaGfvHtml({ usd: 255.5, sinMonto: false, libre: '2026-11-05', n: 2 }), '<span class="gfv">⚠ No la vendas hoy · good faith · libre desde <span class="liqf">jue 5-nov</span> ($255.50 sin liquidar)</span>',
    'la insignia: «⚠ No la vendas hoy · good faith · libre desde jue 5-nov ($X sin liquidar)»');
  igual(P.insigniaGfvHtml({ usd: 0, sinMonto: true, libre: '2026-11-09', n: 1 }), '<span class="gfv">⚠ No la vendas hoy · good faith · libre desde <span class="liqf">lun 9-nov</span> (no sé cuánto sin liquidar)</span>', 'sin monto: «no sé cuánto» (viernes → lunes)');
  igual([P.insigniaGfvHtml(null), P.insigniaGfvHtml({ usd: 1 })], ['', ''], 'sin compra (o sin día de liberación): nada');
  const av = P.avisoVentaGfvHtml({ usd: 200, sinMonto: false, libre: '2026-11-05' });
  assert(/^<div class="aviso gfvav" role="alert">⚠ <b>No la vendas hoy<\/b>: la compraste hoy con \$200\.00 de dinero sin liquidar y queda libre desde el <span class="liqf">jue 5-nov<\/span>\. Venderla antes puede contar como <b>good faith violation<\/b>/.test(av), 'el aviso del cuadro «Vender en moomoo»', av);
  igual(P.avisoVentaGfvHtml(null), '', 'sin compra sin liquidar: el cuadro de siempre');
  // Cuentas
  igual(P.liquidadoCuentaHtml(ROW(), AHORA, HOY), '<div class="fresco liqcta">liquidado <b class="mono">$63.42</b></div>', 'Cuentas: «liquidado $63.42» junto al saldo');
  assert(/liqcta viejo">liquidado <b class="mono">\$63\.42<\/b> · hace 3 h · dato viejo/.test(P.liquidadoCuentaHtml(ROW({ liquidado_at: '2026-11-04T16:00:00Z' }), AHORA, HOY)), '… viejo: con su edad y «dato viejo»');
  igual([P.liquidadoCuentaHtml(ROW({ efectivo_liquidado: null }), AHORA, HOY), P.liquidadoCuentaHtml(ROW({ tipo_cuenta: 'MARGIN' }), AHORA, HOY),
    P.liquidadoCuentaHtml({ broker: 'moomoo', saldo_neto: 10 }, AHORA, HOY), P.liquidadoCuentaHtml(null, AHORA, HOY)], ['', '', '', ''], 'sin dato, cuenta de margen o sin la 0022: nada');
}

// ════════════════ 3. cargarLiquidez con un supabase de juguete ════════════════
function armarCarga(rutas, op) {
  op = op || {};
  const reg = { pintados: 0, timers: [] };
  const sb = C.sbFalso((tabla, cadena) => {
    const r = rutas[tabla];
    if (typeof r === 'function') return r(cadena);
    return r || { data: null, error: null };
  });
  const canales = [];
  sb.channel = (nombre) => { const c = { nombre, regs: [], on(_e, cfg, cb) { c.regs.push({ event: cfg && cfg.event, table: cfg && cfg.table, cb }); return c; }, subscribe() { c.suscrito = true; return c; } }; canales.push(c); return c; };
  const reloj = { hoy: op.hoy || HOY };
  const M = construir(['cargarLiquidez', 'suscribirLiquidez', 'liquidezDeFila', 'textoErrorTabla', 'liquidezCambio'], {
    sb, hoyNY: () => reloj.hoy, sesionActiva: op.sinSesion ? null : { user: { id: 'u1' } }, enCopilotoAhora: () => op.copiloto !== false,
    pintarLiquidezEnSitio: () => { reg.pintados++; return 1; }, setTimeout: (f, ms) => { reg.timers.push({ f, ms }); return reg.timers.length; }, clearTimeout: () => {},
  }, { consts: ['_liq', 'LIQ_TTL_MS', 'LIQ_TTL_SIN_MS', 'LIQ_TTL_SQL_MS', 'LIQ_TTL_ERR_MS', 'LIQ_RUIDO_USD', 'LIQ_MISMA_LECTURA_MS'] });
  return { M, sb, canales, reloj, reg, de: (t) => sb.llamadas.filter(l => l.tabla === t) };
}
(async () => {
  // a) el amigo sin moomoo: UNA consulta barata (su row moomoo por RLS) y nada más en 10 min
  {
    const A = armarCarga({ cuenta_snapshots: { data: null, error: null } });
    igual(await A.M.cargarLiquidez(), true, 'el amigo: la lectura sale bien');
    igual(A.sb.llamadas.map(l => [l.tabla, JSON.stringify(l.cadena)]), [['cuenta_snapshots', '[["select",["*"]],["eq",["broker","moomoo"]]]']],
      'UNA consulta: cuenta_snapshots select(*) del row moomoo (sin nombrar columnas: sin la 0022 no hay un 400 en la consola)');
    await A.M.cargarLiquidez(); await A.M.cargarLiquidez();
    igual([A.sb.llamadas.length, A.canales.length, A.M._liq.L, A.M._liq.ttl], [1, 0, null, 10 * 60000], 'en los 10 min siguientes ni una más; ningún canal de Realtime nuevo; sin tarjeta');
  }
  // b) sin la 0022: el row sin tipo_cuenta → ni segunda consulta ni canales
  {
    const S = armarCarga({ cuenta_snapshots: { data: { broker: 'moomoo', saldo_neto: 900, efectivo: 900, poder_compra: 900, origen: 'vps' }, error: null } });
    await S.M.cargarLiquidez();
    igual([S.de('compras_no_liquidadas').length, S.canales.length, S.M._liq.sinColumnas, S.M._liq.L, S.M._liq.ttl], [0, 0, true, null, 15 * 60000],
      'SIN la 0022: ni compras_no_liquidadas, ni canales, ni tarjeta; se vuelve a mirar en 15 min');
  }
  // c) cuenta de margen: sin compras
  {
    const Mg = armarCarga({ cuenta_snapshots: { data: ROW({ tipo_cuenta: 'MARGIN' }), error: null } });
    await Mg.M.cargarLiquidez();
    igual([Mg.de('compras_no_liquidadas').length, Mg.canales.length, Mg.M._liq.L.tipo], [0, 0, 'MARGIN'], 'cuenta MARGIN: no se leen compras ni se abren canales (la GFV es de las cuentas de efectivo)');
  }
  // d) cuenta CASH: las compras de HOY y sus canales (solo INSERT/UPDATE), una vez
  {
    const K = armarCarga({ cuenta_snapshots: { data: ROW(), error: null }, compras_no_liquidadas: { data: [COMPRA()], error: null } });
    igual(await K.M.cargarLiquidez(), true, 'CASH: lectura buena');
    igual(K.de('compras_no_liquidadas').map(l => JSON.stringify(l.cadena)), ['[["select",["*"]],["eq",["broker","moomoo"]],["eq",["fecha_ny","2026-11-04"]],["order",["ejecutado_at",{"ascending":true}]]]'],
      'las compras de moomoo de HOY (fecha_ny = hoyNY()), en orden de ejecución');
    igual([K.M._liq.L.liquidado, K.M._liq.compras.length, K.M._liq.ttl, K.M._liq.hoy], [63.42, 1, 30000, HOY], 'la caché: liquidez, compras, 30 s');
    igual(K.canales.map(c => [c.nombre, c.suscrito, c.regs.map(r => r.event + ':' + r.table)]), [
      ['mesa2-liquidez', true, ['INSERT:cuenta_snapshots', 'UPDATE:cuenta_snapshots']],
      ['mesa2-gfv', true, ['INSERT:compras_no_liquidadas', 'UPDATE:compras_no_liquidadas']]], 'Realtime en SUS canales, solo INSERT y UPDATE (nunca «*»: los DELETE no pasan por RLS)');
    await K.M.cargarLiquidez();
    igual([K.sb.llamadas.length, K.canales.length], [2, 2], 'dentro de los 30 s: de la caché, sin abrir canales dos veces');
    await K.M.cargarLiquidez(true);
    igual([K.sb.llamadas.length, K.canales.length], [4, 2], 'forzada: relee las dos (y los canales siguen siendo dos)');
    // el día cambia: se relee aunque la caché sea joven, y las compras de ayer no se arrastran
    K.reloj.hoy = '2026-11-05';
    await K.M.cargarLiquidez();
    assert(K.de('compras_no_liquidadas').slice(-1)[0].cadena.some(x => x[0] === 'eq' && x[1][1] === '2026-11-05'), 'al cambiar el día NY se piden las compras del día nuevo');
  }
  // e) fallos: lo leído se queda (con su hora), no rechaza, se reintenta al minuto
  {
    let falla = false;
    const F = armarCarga({ cuenta_snapshots: () => (falla ? { data: null, error: { message: 'fetch failed' } } : { data: ROW(), error: null }), compras_no_liquidadas: { data: [COMPRA()], error: null } });
    await F.M.cargarLiquidez();
    falla = true;
    igual(await F.M.cargarLiquidez(true), false, 'una lectura que falla devuelve false (no rechaza)');
    igual([F.M._liq.L && F.M._liq.L.liquidado, F.M._liq.compras.length, F.M._liq.err, F.M._liq.ttl], [63.42, 1, 'fetch failed', 60000],
      'lo leído antes se queda (su hora va a la vista) y el error se anota; reintento en 1 min');
    const F2 = armarCarga({ cuenta_snapshots: { data: ROW(), error: null }, compras_no_liquidadas: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } });
    await F2.M.cargarLiquidez();
    igual(F2.M._liq.errCompras, 'la tabla compras_no_liquidadas aún no está en la base (migración pendiente)', 'si falta la tabla nueva, se dice (texto de la casa)');
    const F3 = armarCarga({ cuenta_snapshots: () => { throw new Error('se cortó'); } });
    igual(await F3.M.cargarLiquidez(), false, 'una excepción del cliente tampoco rechaza');
  }
  // f) una lectura forzada DURANTE otra: UNA sola más encadenada
  {
    const d = C.diferido();
    let n = 0;
    const E = armarCarga({ cuenta_snapshots: () => { n++; return n === 1 ? d.promesa : { data: ROW(), error: null }; }, compras_no_liquidadas: { data: [], error: null } });
    const p1 = E.M.cargarLiquidez();
    const p2 = E.M.cargarLiquidez(true), p3 = E.M.cargarLiquidez(true), p4 = E.M.cargarLiquidez();
    igual([p2 === p3, p4 === p1], [true, true], 'dos forzadas durante una lectura comparten UNA relectura; la no forzada espera la que va');
    d.resolver({ data: ROW(), error: null });
    await Promise.all([p1, p2, p3, p4]);
    igual(n, 2, 'dos lecturas en total (la que iba + una relectura): ningún bucle');
  }
  // g) liquidezCambio: solo moomoo; marca la caché; con el Copiloto a la vista relee forzado y repinta EN SITIO
  {
    const R = armarCarga({ cuenta_snapshots: { data: ROW(), error: null }, compras_no_liquidadas: { data: [], error: null } });
    await R.M.cargarLiquidez();
    R.M.liquidezCambio({ new: { broker: 'etrade', saldo_neto: 1 } });
    R.M.liquidezCambio({ new: { broker: 'tasty' } }); R.M.liquidezCambio(null); R.M.liquidezCambio({});
    igual([R.reg.timers.length, R.M._liq.ts > 0], [0, true], 'E*TRADE / tasty / basura en cuenta_snapshots: nada (ni relectura ni repintado)');
    R.M.liquidezCambio({ new: { broker: 'moomoo', clave_fill: 'mm-9' } });
    igual([R.reg.timers.length, R.reg.timers[0].ms, R.M._liq.ts], [1, 800, 0], 'un evento de moomoo: la caché deja de valer y se relee con 800 ms de debounce');
    const antes = R.sb.llamadas.length;
    R.reg.timers[0].f(); await respirar(); await respirar(); await respirar();
    igual([R.sb.llamadas.length - antes, R.reg.pintados], [2, 1], 'al vencer: relectura forzada (row + compras) y repintado EN SITIO');
    const Q = armarCarga({ cuenta_snapshots: { data: ROW(), error: null } }, { copiloto: false });
    Q.M.liquidezCambio({ new: { broker: 'moomoo' } }); Q.reg.timers[0].f(); await respirar();
    igual([Q.sb.llamadas.length, Q.reg.pintados], [0, 0], 'fuera del Copiloto: solo se invalida la caché (la próxima visita lee fresco)');
  }

  // ════════════════ 4. pintarLiquidezEnSitio: la tarjeta, sus líneas solo si cambian, las insignias; nunca #vista ════════════════
  {
    const nodos = {};
    let vistaSets = 0;
    const $ = (s) => { if (s === '#vista') return { set innerHTML(v) { vistaSets++; }, get innerHTML() { return ''; } }; return nodos[s] || null; };
    const N = (id) => { const n = nodo(); let ih = ''; n.sets = 0; Object.defineProperty(n, 'innerHTML', { set(v) { ih = v; n.sets++; }, get() { return ih; } }); nodos['#' + id] = n; return n; };
    const _gestor = { filas: [{ id: 7, broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: '585.00', expiracion: '2026-11-07' }, { id: 8, broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: '2026-11-07' }] };
    const _cart = { moomoo: { estado: 'ok', items: [{ broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 450, expiracion: '2026-11-07', clave: 'moomoo|TSLA|CALL|450|2026-11-07' }] } };
    let enCop = true;
    const W = construir(['pintarLiquidezEnSitio', 'ctxLiquidez', 'gfvDe', 'insigniaGfvDe'].concat(PURAS), {
      esc, ymdNY, $, hoyNY: () => HOYR, sesionNY: () => 'regular', _hbUltimo: null, enCopilotoAhora: () => enCop, _gestor, _cart,
      itemsCartera: (c) => (c.moomoo.items || []), claveSlug: (k) => String(k || '').replace(/[^A-Za-z0-9]/g, '_'),
    }, { consts: ['_liq', 'dineroD', 'LIQ_RUIDO_USD', 'LIQ_MISMA_LECTURA_MS', 'LIQ_VIEJO_MIN'] });
    Object.assign(W._liq, { L: P.liquidezDeFila(ROW({ liquidado_at: new Date(Date.now() - 20000).toISOString() })), compras: [], hoy: HOYR });
    const HOY4 = (o) => COMPRA(Object.assign({ fecha_ny: HOYR, libre_desde: MANANA }, o || {}));   // compras de HOY (el día real)
    const LIBRE4 = P.fechaCortaAviso(MANANA);
    const cont = N('liq_moomoo'); const g7 = N('g_gfv_7'); const g8 = N('g_gfv_8'); const gb = N('g_bgfv_moomoo_TSLA_CALL_450_2026_11_07');
    igual(W.pintarLiquidezEnSitio(), 3, 'sin la tarjeta pintada todavía: el contenedor y las dos insignias de moomoo (nunca las de E*TRADE)');
    assert(/Liquidez moomoo · cuenta de efectivo/.test(cont.innerHTML) && vistaSets === 0, 'la tarjeta aparece EN SITIO (en #liq_moomoo), sin tocar #vista');
    igual([g7.innerHTML, g8.sets, gb.innerHTML], ['', 0, ''], 'sin compras sin liquidar: insignias vacías');
    // ya pintada: llega una compra sin liquidar del contrato de la ficha 7 y otra del de la cartera
    const lin = N('liq_lineas'), ed = N('liq_edad');
    W._liq.pintadas = null;
    W._liq.compras = [HOY4(), HOY4({ clave_fill: 'mm-4', symbol: 'TSLA', strike: 450, no_liquidado_usd: 80 })];
    W._liq.por = null;
    const setsCont = cont.sets;
    W.pintarLiquidezEnSitio();
    igual([cont.sets, lin.sets, ed.sets], [setsCont, 1, 1], 'con la tarjeta ya en pantalla: solo sus LÍNEAS (role=status) y su edad, el contenedor no se rehace');
    assert(/SPY 585C/.test(lin.innerHTML) && /TSLA 450C/.test(lin.innerHTML) && /hace 2\d s/.test(ed.innerHTML), 'las líneas rojas nuevas y la edad al día');
    igual(g7.innerHTML, '<span class="gfv">⚠ No la vendas hoy · good faith · libre desde <span class="liqf">' + LIBRE4 + '</span> ($200.00 sin liquidar)</span>', 'la ficha de moomoo (strike «585.00» del libro) lleva su insignia');
    assert(/\$80\.00 sin liquidar/.test(gb.innerHTML) && g8.sets === 0, 'lo que el bróker tiene sin registrar también; la ficha de E*TRADE del mismo contrato, no');
    W.pintarLiquidezEnSitio();
    igual([lin.sets, ed.sets], [1, 2], 'sin cambios: las líneas NO se reescriben (el lector de pantalla no repite), la edad sí');
    // la cuenta deja de ser CASH (o se borra el row): la tarjeta se va
    W._liq.L = P.liquidezDeFila(ROW({ tipo_cuenta: 'MARGIN' })); W._liq.por = null;
    W.pintarLiquidezEnSitio();
    igual([cont.innerHTML, g7.innerHTML], ['', ''], 'sin cuenta CASH: ni tarjeta ni insignias');
    enCop = false;
    igual([W.pintarLiquidezEnSitio(), vistaSets], [0, 0], 'fuera del Copiloto no toca nada; #vista NUNCA');
    // gfvDe: solo moomoo, solo CASH, por contrato
    enCop = true;
    W._liq.L = P.liquidezDeFila(ROW()); W._liq.por = null; W._liq.compras = [HOY4()];
    igual([!!W.gfvDe({ broker: 'moomoo', symbol: 'spy', direccion: 'call', strike: 585, expiracion: '2026-11-07T00:00:00' }), W.gfvDe({ broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: '2026-11-07' }),
      W.gfvDe({ broker: 'moomoo', symbol: 'SPY', direccion: 'PUT', strike: 585, expiracion: '2026-11-07' }), W.gfvDe(null)], [true, null, null, null], 'gfvDe: el MISMO contrato de moomoo (mayúsculas, strike, fecha); otro bróker, otro lado o nada → null');
  }

  // ════════════════ 5. el módulo ENTERO ════════════════
  function armarModulo(rutas, op) {
    op = op || {};
    const llamadas = [];
    const sb = C.sbFalso((tabla, cadena) => { llamadas.push({ tabla, cadena }); const r = rutas[tabla]; return typeof r === 'function' ? r(cadena) : (r || { data: [], error: null }); });
    const canales = [];
    const canal = (nombre) => { const c = { nombre, regs: [], on(_e, cfg, cb) { c.regs.push({ event: cfg && cfg.event, table: cfg && cfg.table, cb }); return c; }, subscribe() { c.suscrito = true; return c; } }; canales.push(c); return c; };
    const mod = C.cargarModuloEntero({ hash: op.hash || '#/copiloto', src: './app/main.js?v=69', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
    const nodos = {};
    let vista = '', vistaSets = 0;
    const N = (s) => { if (nodos[s]) return nodos[s]; const n = nodo(); let ih = ''; n.sets = 0; Object.defineProperty(n, 'innerHTML', { set(v) { ih = v; n.sets++; }, get() { return ih; } }); nodos[s] = n; return n; };
    mod.win.document.querySelector = (s) => {
      if (s === '#vista') { const n = nodo(); Object.defineProperty(n, 'innerHTML', { set(v) { vista = v; vistaSets++; }, get() { return vista; } }); return n; }
      if (/^#(liq_|g_gfv_|g_bgfv_)/.test(s)) return (op.sinNodos ? null : N(s));
      return op.modal && s === '.modal' ? nodo() : (s === '.modal' ? null : nodo());
    };
    if (op.ancho) mod.win.innerWidth = op.ancho;
    if (mod.cargo) mod.ev("sesionActiva = { user: { id: 'u1' } }; _hbUltimo = null;");
    return { mod, llamadas, canales, nodos, N, vista: () => vista, vistaSets: () => vistaSets, de: (t) => llamadas.filter(l => l.tabla === t) };
  }
  const POSM = { id: 7, user_id: 'u1', estado: 'abierta', broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: MANANA, contratos: 2, prima_fill: 2.56, abierta_at: new Date(Date.now() - 3600000).toISOString(), plan_pct: 35 };
  const rutasCash = (compras) => ({
    cuenta_snapshots: (cadena) => cadena.some(c => c[0] === 'eq' && c[1][0] === 'broker') ? { data: ROW({ liquidado_at: new Date(Date.now() - 12000).toISOString(), liquidado_inicio_fecha: HOYR, se_libera_el: MANANA }), error: null } : { data: [ROW({ liquidado_at: new Date(Date.now() - 12000).toISOString() })], error: null },
    compras_no_liquidadas: () => ({ data: compras(), error: null }),
    posiciones: { data: [POSM], error: null },
  });
  let comprasHoy = [COMPRA({ expiracion: MANANA, fecha_ny: HOYR, libre_desde: MANANA, ejecutado_at: new Date().toISOString() })];
  // a) Andrés (CASH) en el iPhone: la tarjeta y la insignia en la tarjeta de la posición
  {
    const Z = armarModulo(rutasCash(() => comprasHoy));
    assert(Z.mod.cargo, 'main.js entero carga con el supabase de juguete', Z.mod.error);
    let revento = null;
    try { await Z.mod.ev('vistaCopiloto(null)'); } catch (e) { revento = String((e && e.stack) || e); }
    assert(!revento, 'vistaCopiloto corre entero en el DOM de juguete', revento);
    const v = Z.vista();
    assert(/<div id="liq_moomoo"><div class="card liq">/.test(v) && /Liquidez moomoo · cuenta de efectivo/.test(v), 'el Copiloto pinta la tarjeta de liquidez');
    assert(v.indexOf('id="liq_moomoo"') < v.indexOf('POSICIONES ABIERTAS'), '… justo encima de las posiciones');
    const libre = Z.mod.ev(`fechaCortaAviso('${MANANA}')`);
    assert(new RegExp('<div class="gfvw" id="g_gfv_7"><span class="gfv">⚠ No la vendas hoy · good faith · libre desde <span class="liqf">' + libre + '</span> \\(\\$200\\.00 sin liquidar\\)</span></div>').test(v), 'la tarjeta de la posición de moomoo lleva la insignia roja (iPhone)', (v.match(/g_gfv_7[\s\S]{0,200}/) || [''])[0]);
    igual([Z.de('cuenta_snapshots').length, Z.de('compras_no_liquidadas').length], [1, 1], 'UNA lectura del row y UNA de las compras');
    assert(Z.canales.some(c => c.nombre === 'mesa2-liquidez') && Z.canales.some(c => c.nombre === 'mesa2-gfv') && Z.canales.flatMap(c => c.regs).every(r => r.event !== '*'), 'con la cuenta CASH se abren sus canales (sin «*»)');
    // Realtime: una compra nueva → repintado EN SITIO (#liq_lineas y la insignia), #vista intacta. Antes, que termine lo
    // que vistaCopiloto dejó en marcha (la cartera leída DESPUÉS de pintar redibuja una vez si cambió: eso no es Realtime)
    for (let i = 0; i < 30; i++) await respirar();
    Z.mod.ev("sesionActiva = { user: { id: 'u1' } };");   // al cargar, getSession() de juguete (sin sesión) llamó a arrancar(null)
    Z.mod.win.setTimeout = (f) => { f(); return 1; };
    Z.N('#liq_lineas'); Z.N('#liq_edad'); Z.N('#liq_moomoo'); Z.N('#g_gfv_7');
    const sets0 = Z.vistaSets();
    comprasHoy = comprasHoy.concat([COMPRA({ clave_fill: 'mm-2', no_liquidado_usd: 100, expiracion: MANANA, fecha_ny: HOYR, libre_desde: MANANA, ejecutado_at: new Date().toISOString() })]);
    const cGfv = Z.canales.find(c => c.nombre === 'mesa2-gfv');
    cGfv.regs.find(r => r.event === 'INSERT').cb({ new: { broker: 'moomoo', clave_fill: 'mm-2' } });
    for (let i = 0; i < 30; i++) await respirar();
    igual(Z.vistaSets(), sets0, 'el evento NO repinta #vista (ni cierra un cuadro ni quita el foco)');
    assert(/\$300\.00 sin liquidar/.test(Z.nodos['#g_gfv_7'].innerHTML) && /mm-2|SPY 585C[\s\S]*SPY 585C/.test(Z.nodos['#liq_lineas'].innerHTML), 'la insignia suma la compra nueva y la tarjeta tiene su línea, en sitio', Z.nodos['#g_gfv_7'].innerHTML);
    // con un cuadro abierto, igual en sitio
    Z.mod.win.document.querySelector = ((q) => (s) => (s === '.modal' ? nodo() : q(s)))(Z.mod.win.document.querySelector);
    Z.canales.find(c => c.nombre === 'mesa2-liquidez').regs.find(r => r.event === 'UPDATE').cb({ new: { broker: 'moomoo' } });
    for (let i = 0; i < 30; i++) await respirar();
    igual(Z.vistaSets(), sets0, 'con un cuadro abierto tampoco se toca #vista');
    // el cuadro «Vender en moomoo» avisa
    let hojaHtml = '';
    Z.mod.win.document.createElement = () => { const n = nodo(); Object.defineProperty(n, 'innerHTML', { set(x) { hojaHtml = x; }, get() { return hojaHtml; } }); return n; };
    Z.mod.win.document.body = nodo({ appendChild() {} });
    Z.mod.ev('abrirVentaFuera(gestorFila(7), 2.9)');
    assert(/<div class="aviso gfvav" role="alert">⚠ <b>No la vendas hoy<\/b>: la compraste hoy con \$300\.00 de dinero sin liquidar/.test(hojaHtml), 'el cuadro «Vender en moomoo» dice «No la vendas hoy» antes del ticket', hojaHtml.slice(0, 500));
    // el Diario: la insignia en «abiertos según el libro»
    const hA = Z.mod.ev(`seccionAbiertosDiario([{ broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: '${MANANA}', contrato: 'SPY|CALL|585|${MANANA}', contratos: 2, prima: 2.56, costo: 512, fecha_ny: '${HOYR}', dias_abiertos: 0, vence_en: 1 },
      { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 585, expiracion: '${MANANA}', contrato: 'SPY|CALL|585|${MANANA}', contratos: 1, prima: 2, costo: 200, fecha_ny: '${HOYR}', dias_abiertos: 0, vence_en: 1 }], [], [])`);
    igual((hA.match(/class="gfv"/g) || []).length, 1, 'Diario: la insignia en el abierto de moomoo (y no en el de E*TRADE)');
  }
  // b) en la computadora (tabla del gestor): la insignia arriba del detalle de la fila
  {
    const T = armarModulo(rutasCash(() => [COMPRA({ expiracion: MANANA, fecha_ny: HOYR, libre_desde: MANANA })]), { ancho: 1400 });
    await T.mod.ev('vistaCopiloto(null)');
    assert(/<tr class="gdet"><td colspan="10"><div class="gfvw" id="g_gfv_7"><span class="gfv">⚠ No la vendas hoy/.test(T.vista()), 'tabla del Mac: la insignia encabeza la fila de detalle de la posición de moomoo');
  }
  // c) el amigo (sin moomoo) y la base sin la 0022: nada nuevo a la vista, una sola consulta, ningún canal
  for (const [nombre, fila] of [['el amigo sin moomoo', null], ['la base SIN la 0022', { broker: 'moomoo', saldo_neto: 900, efectivo: 900, poder_compra: 900, origen: 'vps', capturado_at: new Date().toISOString() }]]) {
    const A = armarModulo({ cuenta_snapshots: (cadena) => cadena.some(c => c[0] === 'eq') ? { data: fila, error: null } : { data: fila ? [fila] : [], error: null } });
    await A.mod.ev('vistaCopiloto(null)');
    await A.mod.ev('vistaCopiloto(null)');
    const v = A.vista();
    assert(/<div id="liq_moomoo"><\/div>/.test(v) && !/Liquidez moomoo|class="gfv/.test(v), nombre + ': el contenedor vacío (oculto por :empty) y ninguna tarjeta ni insignia');
    igual([A.de('cuenta_snapshots').length, A.de('compras_no_liquidadas').length, A.canales.filter(c => /liquidez|gfv/.test(c.nombre)).length], [1, 0, 0],
      nombre + ': UNA consulta barata en dos visitas, ninguna a compras_no_liquidadas, ningún canal nuevo');
  }
  // d) Cuentas: «liquidado $X» junto al saldo de moomoo
  {
    const K = armarModulo(rutasCash(() => []), { hash: '#/cuentas' });
    K.mod.ev("_cuentasVista = 'cuentas'; etradeSaldo = async () => null; schwabSaldo = async () => null;");
    let revento = null;
    try { await K.mod.ev('vistaCuentasSaldos()'); } catch (e) { revento = String((e && e.stack) || e); }
    assert(!revento, 'vistaCuentasSaldos corre entera', revento);
    assert(/\$3,871<\/span><div class="fresco liqcta">liquidado <b class="mono">\$63\.42<\/b><\/div>/.test(K.vista()), 'Cuentas: la tarjeta de moomoo dice «liquidado $63.42» debajo del saldo', (K.vista().match(/moomoo[\s\S]{0,600}/) || [''])[0].slice(0, 600));
  }

  // ════════════════ 6. el fuente y el CSS ════════════════
  {
    const codigo = NOMBRES.concat(['ctxLiquidez', 'insigniaGfvDe', 'avisoVentaGfv']).map(extraer).join('\n');
    assert(!/\.(insert|update|upsert|delete)\(/.test(codigo), 'el código de la liquidez solo LEE (ni insert, ni update, ni upsert, ni delete)');
    assert(!/fetch\(|etProxy\(|swLlamar\(/.test(codigo), '… y no habla con brókeres ni con el proxy');
    assert(!/select\('[^']*(efectivo_liquidado|tipo_cuenta|liquidado_at|se_libera_el)/.test(FUENTE), 'ninguna consulta nombra las columnas nuevas (sin la 0022 sería un 400): select(*) y se mira la clave');
    assert(!/table: 'compras_no_liquidadas' \}, [^)]*\)[\s\S]{0,5}/.test(extraer('suscribir')), 'suscribir() no abre los canales nuevos para todos (solo suscribirLiquidez, con la cuenta CASH)');
    const vc = extraer('vistaCopiloto');
    assert(/cargarLiquidez\(\),/.test(vc) && vc.indexOf('cargarLiquidez()') < vc.indexOf('libroParaUnir()'), 'vistaCopiloto lee la liquidez en el mismo Promise.all que lo demás');
    assert(/if \(copilotoEnUso\(\)\) pintarLiquidezEnSitio\(\);/.test(vc), 'con un parámetro del gestor enfocado, la liquidez va en sitio (no se repinta #vista)');
    assert(/cargarLiquidez\(\) : null\]\)/.test(extraer('vistaDiario')) && /typeof cargarLiquidez === 'function'/.test(extraer('vistaDiario')), 'el Diario usa la misma caché (con su guarda typeof)');
    const INDEX = fs.readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8');
    assert(/#liq_moomoo:empty\{display:none\}/.test(INDEX) && /\.gfvw:empty\{display:none\}/.test(INDEX), 'CSS: contenedores vacíos ocultos (el amigo no ve ni un hueco)');
    assert(/\.gfv\{display:inline-block;max-width:100%;[^}]*white-space:normal/.test(INDEX) && /\.liqal,\.liqam,\.gfv\{overflow-wrap:anywhere/.test(INDEX), 'CSS: la insignia y las líneas se parten a 375 px (sin desborde lateral)');
    assert(/\.liqal\{[^}]*color:var\(--avrojo\)/.test(INDEX) && /\.liqam\{[^}]*color:var\(--avoro\)/.test(INDEX) && /\.gfv\{[^}]*color:var\(--avrojo\)/.test(INDEX), 'CSS: rojo y ámbar con --avrojo/--avoro (AA en tema claro y oscuro)');
    assert(/\.liqedad\.viejo\{color:var\(--avoro\)/.test(INDEX), 'CSS: «dato viejo» en ámbar');
    assert(/\.liqf\{white-space:nowrap\}/.test(INDEX), 'CSS: «jue 5-nov» no se parte en «jue 5-» / «nov»');
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
