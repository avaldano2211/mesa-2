#!/usr/bin/env node
/* Pruebas de la CALCULADORA DE LIMIT Y STOP (v65, pedido de Andrés del 2026-10-30 con dos fotos de sus hojas de Excel):
   el cálculo puro (calcLimitStop, calcArriba, calcNum) contra sus dos hojas, los flotantes, el incremento de 5¢ y las
   entradas vacías / 0 / negativas.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js): nada se reimplementa aquí.
   Uso: node test_calc_limit.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_calc_limit.js');
const { assert, igual, cerca, construir } = C;

const K = construir(['calcLimitStop', 'calcArriba', 'calcNum'], {}, { consts: ['CALC_TICKS'] });
const calc = (x) => K.calcLimitStop(Object.assign({ fee: 0.02, tick: 0.01, modo: 'pct', objetivo: 12, stopPct: 20 }, x || {}));
const TSLA = [{ n: 1, p: 1.21 }, { n: 3, p: 0.29 }];   // hoja 2: Buy 1 a $121 + Buy 3 a $29

// ════════════════ 1. hoja 2 (TSLA 420): 4 contratos a $52, objetivo $4 → limit 0.55 y $4.00 netos ════════════════
{
  const r = calc({ lotes: TSLA, modo: 'usd', objetivo: 4 });
  igual([r.n, r.pagado], [4, 208], '1 a 1.21 + 3 a 0.29 = 4 contratos y $208 pagados');
  cerca(r.medio, 0.52, 'costo medio 0.52 ($52 por contrato)');
  igual(r.comisiones, 8, 'comisiones de ida y vuelta: 0.02 × 100 × 4 = $8');
  cerca(r.sube, 0.01, '$4 ÷ (100 × 4) = 0.01 de prima por contrato');
  igual(r.limit.precio, 0.55, 'objetivo $4 → limit 0.55 (la hoja: Sell 4 a $55)');
  igual([r.limit.venta, r.limit.neta], [220, 4], 'cobras $220 y ganas $4.00 netos (la hoja: neto $4.00)');
  cerca(r.limit.netaPct, 4 / 208 * 100, 'que es el 1.92 % de lo pagado');
}
// ════════════════ 2. el mismo TSLA pidiendo el 2 %: 0.55 deja el 1.9 % → 0.56 ($8.00, 3.85 %) ════════════════
{
  const r = calc({ lotes: TSLA, modo: 'pct', objetivo: 2 });
  igual(r.limit.precio, 0.56, '2 % → limit 0.56 (0.5504 sube al siguiente centavo: nunca por debajo de lo pedido)');
  igual([r.limit.venta, r.limit.neta], [224, 8], 'cobras $224 y ganas $8.00 netos');
  cerca(r.limit.netaPct, 3.846153846, 'el 3.85 % de lo pagado', 1e-6);
  igual((Math.round(r.limit.netaPct * 100) / 100).toFixed(2), '3.85', 'que en pantalla es 3.85');
}
// ════════════════ 3. hoja 1: Ask 2.40 al 12 % → 2.71 con 2¢ (29.00, 12.08 %) y 2.70 con 1¢ ════════════════
{
  const r = calc({ lotes: [{ n: 1, p: 2.40 }], objetivo: 12, fee: 0.02 });
  igual(r.limit.precio, 2.71, '2.40 + 12 % + 0.02 = 2.708 → 2.71');
  igual([r.limit.venta, r.comisiones, r.limit.neta], [271, 2, 29], 'cobras $271, comisiones $2, ganas $29.00');
  cerca(r.limit.netaPct, 29 / 240 * 100, '12.08 % neto');
  igual((Math.round(r.limit.netaPct * 100) / 100).toFixed(2), '12.08', 'que en pantalla es 12.08');
  const r1 = calc({ lotes: [{ n: 1, p: 2.40 }], objetivo: 12, fee: 0.01 });
  igual(r1.limit.precio, 2.70, 'con 0.01 de comisión (su Excel: Fee 1.00) → 2.70, como en su hoja');
  igual([r1.comisiones, r1.limit.neta], [1, 29], 'comisión $1 y $29.00 netos');
  const r3 = calc({ lotes: [{ n: 3, p: 2.40 }], objetivo: 12, fee: 0.02 });
  igual([r3.limit.precio, r3.limit.neta], [2.71, 87], 'con 3 contratos el precio es el mismo y la ganancia se triplica');
}
// ════════════════ 4. el stop: 2.40 al −20 % → 1.92 (hacia arriba: la pérdida nunca pasa del %) ════════════════
{
  const r = calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: 20 });
  igual(r.stop.precio, 1.92, '2.40 × 0.8 = 1.92 (y no 1.93 por el 1.9200000000000002 de la coma flotante)');
  igual([r.stop.venta, r.stop.neta], [192, -50], 'cobras $192: pierdes $48 de prima + $2 de comisiones = -$50');
  cerca(r.stop.netaPct, -50 / 240 * 100, 'la pérdida neta en % (-20.83 %) lleva las comisiones: se dicen, no se esconden');
  igual(calc({ lotes: TSLA, stopPct: 20 }).stop.precio, 0.42, 'TSLA a 0.52 con −20 %: 0.416 → 0.42 (sube: la caída queda en 19.2 %, no pasa del 20)');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: 0 }).stop.precio, 2.40, '0 % de stop = salir al costo');
  igual([calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: 100 }).stop, calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: 100 }).falta], [null, ['stop']], '100 % no es un stop: sin stop y lo dice');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: -5 }).stop, null, 'un % negativo tampoco');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: '' }).stop, null, 'ni vacío');
  assert(calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: '' }).limit !== null, 'sin stop el limit sigue saliendo (son independientes)');
}
// ════════════════ 5. flotantes: 0.52 + 0.01 + 0.02 NO salta a 0.56 ════════════════
{
  igual(Math.ceil((0.52 + 0.01 + 0.02) * 100) / 100, 0.56, '(el problema existe: subir al centavo con Math.ceil(x × 100) da 0.56, porque 0.55 × 100 es 55.00000000000001)');
  igual(K.calcArriba(0.52 + 0.01 + 0.02, 0.01), 0.55, 'calcArriba lo deja en 0.55');
  igual(K.calcArriba(0.5500000000000001, 0.01), 0.55, 'y también el 0.5500000000000001 que dan otras sumas');
  igual(calc({ lotes: [{ n: 4, p: 0.52 }], modo: 'usd', objetivo: 4 }).limit.precio, 0.55, '4 a 0.52 con $4: 0.55 (el mismo caso por la puerta grande)');
  igual(K.calcArriba(2.4 * 0.8, 0.01), 1.92, '2.4 × 0.8 = 1.9200000000000002 → 1.92');
  igual(K.calcArriba(0.5504, 0.01), 0.56, 'un exceso REAL (0.5504) sí sube: 0.56');
  igual(K.calcArriba(0.55000001, 0.01), 0.56, 'y uno de una diezmilésima de centavo también (el ruido que se tira es de 1e-6 incrementos)');
  igual(K.calcArriba(0.1 + 0.2, 0.01), 0.3, '0.1 + 0.2 → 0.3');
  igual(K.calcArriba(1.15, 0.05), 1.15, '1.15 con 5¢ se queda (1.15 / 0.05 = 22.999999999999996)');
  [0.07, 0.29, 0.58, 1.13, 2.71, 4.35, 9.99, 12.34, 101.01].forEach(x => igual(K.calcArriba(x, 0.01), x, 'un precio que ya es de centavo exacto se queda igual: ' + x));
  const precioLimpio = calc({ lotes: [{ n: 7, p: 0.33 }, { n: 2, p: 0.41 }], objetivo: 15 }).limit.precio;
  igual(Math.round(precioLimpio * 100) / 100, precioLimpio, 'el precio sale limpio a 2 decimales (sin 0.55000000000000004)');
}
// ════════════════ 6. el incremento de 5¢ ════════════════
{
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], objetivo: 12, tick: 0.05 }).limit.precio, 2.75, '2.708 con 5¢ → 2.75');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], stopPct: 20, tick: 0.05 }).stop.precio, 1.95, 'stop 1.92 con 5¢ → 1.95 (hacia arriba: la pérdida no pasa del 20 %)');
  igual(calc({ lotes: TSLA, modo: 'usd', objetivo: 4, tick: 0.05 }).limit.precio, 0.55, 'TSLA $4 con 5¢: 0.55 ya es de 5¢');
  igual(calc({ lotes: TSLA, modo: 'pct', objetivo: 2, tick: 0.05 }).limit.precio, 0.60, 'TSLA 2 % con 5¢: 0.5504 → 0.60');
  igual(K.calcArriba(0.6, 0.05), 0.6, '0.60 con 5¢ se queda');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], tick: 0.10 }).tick, 0.01, 'un incremento que no es 1¢ ni 5¢ vuelve a 1¢');
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], tick: '0.05' }).tick, 0.05, 'el 5¢ llega también como texto');
}
// ════════════════ 7. objetivo en $, en 0 y la comisión ════════════════
{
  const r = calc({ lotes: [{ n: 2, p: 1.00 }], modo: 'usd', objetivo: 50 });
  igual([r.limit.precio, r.limit.neta], [1.27, 50], '2 a 1.00 con $50 netos: 1.00 + 0.25 + 0.02 = 1.27 y ganas $50.00');
  const r0 = calc({ lotes: [{ n: 2, p: 1.00 }], objetivo: 0 });
  igual([r0.limit.precio, r0.limit.neta], [1.02, 0], 'objetivo 0: salir a la par con las comisiones cubiertas (1.02, $0.00)');
  const sin = calc({ lotes: [{ n: 2, p: 1.00 }], objetivo: 10, fee: 0 });
  igual([sin.limit.precio, sin.comisiones, sin.limit.neta], [1.10, 0, 20], 'comisión 0 (bróker sin comisión): 1.10, $0, $20');
  ['', null, undefined, -0.02, 'abc'].forEach(f => {
    const x = calc({ lotes: [{ n: 2, p: 1.00 }], fee: f });
    igual([x.limit, x.stop, x.comisiones, x.falta.includes('comision')], [null, null, null, true], 'comisión ' + JSON.stringify(f) + ': sin limit ni stop y dice que falta la comisión');
  });
  ['', null, -5, 'x'].forEach(o => {
    const x = calc({ lotes: [{ n: 2, p: 1.00 }], objetivo: o });
    igual([x.limit, x.falta], [null, ['objetivo']], 'objetivo ' + JSON.stringify(o) + ': sin limit y dice que falta el objetivo');
    assert(x.stop !== null, 'el stop sigue saliendo sin objetivo');
  });
  igual(calc({ lotes: [{ n: 1, p: 2.40 }], modo: 'raro' }).modo, 'pct', 'un modo desconocido es %');
}
// ════════════════ 8. entradas vacías / 0 / negativas: sin resultado, sin NaN ════════════════
{
  [[], null, undefined, [{ n: '', p: '' }], [{ n: 0, p: 1 }], [{ n: 1, p: 0 }], [{ n: -1, p: 0.5 }], [{ n: 2, p: -0.5 }], [{ n: 'abc', p: '1' }], [{}], [null]]
    .forEach(l => igual(calc({ lotes: l }), null, 'compras ' + JSON.stringify(l) + ' → sin resultado'));
  igual(K.calcLimitStop(undefined), null, 'sin entrada → null (no revienta)');
  const mezcla = calc({ lotes: [{ n: 1, p: 1.21 }, { n: 0, p: 5 }, { n: '', p: '' }, { n: 3, p: 0.29 }], modo: 'usd', objetivo: 4 });
  igual([mezcla.n, mezcla.pagado, mezcla.limit.precio], [4, 208, 0.55], 'una fila vacía o a 0 entre las buenas se ignora (no rompe el costo medio)');
  const todo = JSON.stringify(calc({ lotes: [{ n: 1, p: 2.4 }], fee: '', objetivo: '', stopPct: '' }));
  assert(!/NaN|Infinity|undefined/.test(todo) && JSON.parse(todo).limit === null, 'con todo vacío salvo la compra: nada de NaN, Infinity ni undefined en el resultado', todo);
}
// ════════════════ 9. el texto de los campos (coma decimal del iPhone, $ y %) ════════════════
{
  igual([K.calcNum('0,52'), K.calcNum('$1.21'), K.calcNum('12%'), K.calcNum(' 3 '), K.calcNum('.5'), K.calcNum(7)], [0.52, 1.21, 12, 3, 0.5, 7], 'calcNum: coma decimal, $, %, espacios, «.5» y números');
  igual([K.calcNum(''), K.calcNum('1.2.3'), K.calcNum('abc'), K.calcNum(null), K.calcNum(undefined), K.calcNum(NaN), K.calcNum(Infinity), K.calcNum('1e3')].map(x => Number.isNaN(x)), [true, true, true, true, true, true, true, true], 'vacío, dos puntos, letras, null, NaN, Infinity y notación científica → NaN');
  const r = calc({ lotes: [{ n: '1', p: '1,21' }, { n: '3', p: '0,29' }], modo: 'usd', objetivo: '$4', fee: '0,02' });
  igual([r.n, r.pagado, r.limit.precio, r.limit.neta], [4, 208, 0.55, 4], 'el TSLA tecleado con comas da lo mismo');
}
// ════════════════ 9b. rev67: contratos ENTEROS ≥ 1 (una fracción diminuta daba n = 0 y un costo medio Infinity) ════════════════
{
  ['0.00001', '0,00004', '0.5', '1.5', '1,5', 0.00001, 2.5].forEach(n => igual(calc({ lotes: [{ n, p: '1' }] }), null, 'contratos ' + JSON.stringify(n) + ' (no es un entero ≥ 1) → sin resultado, no Infinity'));
  const r = calc({ lotes: [{ n: '1.5', p: '9' }, { n: '1', p: '1.21' }, { n: '0,00004', p: '1' }, { n: '3', p: '0.29' }], modo: 'usd', objetivo: 4 });
  igual([r.n, r.pagado, r.limit.precio], [4, 208, 0.55], 'una compra con fracción entre las buenas no cuenta (el TSLA sigue en 4 a 0.52 → 0.55)');
  igual([calc({ lotes: [{ n: '4.0', p: '0.52' }] }).n, calc({ lotes: [{ n: 4, p: 0.52 }] }).n], [4, 4], '«4.0» es un entero: vale');
  const todo = JSON.stringify(calc({ lotes: [{ n: '0.00001', p: '1' }, { n: '1', p: '0.52' }] }));
  assert(!/NaN|Infinity|null,"pagado"/.test(todo) && JSON.parse(todo).n === 1, 'la diminuta junto a una buena: n = 1 y nada de NaN ni Infinity', todo);
  const nueves = '9'.repeat(400);
  igual([Number(nueves), K.calcNum(nueves), K.calcNum('$' + nueves + '%')], [Infinity, NaN, NaN], 'calcNum: un texto de 400 cifras (Infinity en Number) → NaN');
  igual([calc({ lotes: [{ n: 1, p: 2.4 }], objetivo: nueves }).limit, calc({ lotes: [{ n: 1, p: nueves }] })], [null, null], 'un objetivo o una prima así: sin limit / sin resultado (nunca «Infinity»)');
}

// ════════════════ 10. lo que se recuerda en este equipo (mz_calc) ════════════════
const BASE_CALC = ['calcLimitStop', 'calcArriba', 'calcNum', 'calcEntrada', 'calcPrefsNormalizar', 'calcPrefsLeer', 'calcPrefsGuardar'];
const VISTA_CALC = ['calcHojaHtml', 'calcLotesHtml', 'calcResumenHtml', 'calcLotesPartidos', 'calcChipsHtml', 'calcObjetivoHtml', 'calcTickHtml', 'calcFeeNota', 'calcFaltaTxt',
  'calcCifrasHtml', 'calcLimitHtml', 'calcStopHtml', 'calcFormulaHtml', 'calcTitulo', 'fmtPrima', 'pctEsp'];
const CONSTS_CALC = ['CALC_TICKS', 'CALC_K', 'CALC_DEF', 'CALC_CHIPS', 'dineroD', 'BROKER_CORTO'];
{
  const ls = C.localStorageFalso();
  const P = construir(BASE_CALC, { localStorage: ls }, { consts: ['CALC_TICKS', 'CALC_K', 'CALC_DEF'] });
  const DEF = { fee: 0.02, tick: 0.01, modo: 'pct', pct: 12, usd: 50, stop: 20 };
  igual(P.calcPrefsNormalizar(null), DEF, 'de fábrica: comisión 0.02, 1¢, en %, 12 %, $50 y stop del 20 %');
  igual(P.calcPrefsLeer(), DEF, 'sin nada guardado se leen las de fábrica');
  igual(P.calcPrefsNormalizar({ fee: '0,01', tick: '0.05', modo: 'usd', pct: '10', usd: '4', stop: '25', lotes: [{ n: 1, p: 2 }], contrato: { symbol: 'TSLA' }, cuenta: 'x' }),
    { fee: 0.01, tick: 0.05, modo: 'usd', pct: 10, usd: 4, stop: 25 }, 'lo válido se queda (texto con coma incluido) y lo que no es de la calculadora (compras, contrato, cuenta) ni sale');
  igual(P.calcPrefsNormalizar({ fee: -1, tick: 0.1, modo: 'x', pct: -3, usd: 'abc', stop: 100 }), DEF, 'lo inválido vuelve a fábrica (comisión negativa, 10¢, modo raro, % negativo, stop del 100 %)');
  igual(P.calcPrefsNormalizar({ fee: '' }, { ...DEF, fee: 0.01 }).fee, 0.01, 'un campo vacío toma el de la BASE (el último bueno guardado), no el de fábrica');
  ls.almacen.mz_calc = '{roto';
  igual(P.calcPrefsLeer(), DEF, 'un JSON roto en mz_calc → las de fábrica, sin reventar');
  delete ls.almacen.mz_calc;
  // se guarda lo que hay en la hoja… y solo eso
  P.calcPrefsGuardar({ lotes: [{ n: '4', p: '0.52' }], contrato: { symbol: 'TSLA', strike: 420 }, origen: 'tu libro', modo: 'usd', pct: '2', usd: '4', fee: '0.01', tick: 0.05, stop: '30', ordVista: {} });
  const g = JSON.parse(ls.almacen.mz_calc);
  igual(g, { fee: 0.01, tick: 0.05, modo: 'usd', pct: 2, usd: 4, stop: 30 }, 'se guardan comisión, incremento, modo, objetivo (% y $) y % de stop');
  assert(!/lotes|0\.52|TSLA|420|contrato|origen|ordVista/.test(ls.almacen.mz_calc), 'NUNCA compras, primas, contrato ni nada de la cuenta', ls.almacen.mz_calc);
  P.calcPrefsGuardar({ modo: 'usd', pct: '', usd: '4', fee: ',', tick: 0.05, stop: '-' });
  igual(JSON.parse(ls.almacen.mz_calc), g, 'un campo a medio teclear (vacío, «,», «-») no borra lo último bueno');
  igual(P.calcPrefsLeer(), g, 'y al volver a abrir se lee lo guardado');
  P.calcPrefsGuardar(null);
  igual(JSON.parse(ls.almacen.mz_calc), g, 'sin hoja no se escribe nada');
  // localStorage que revienta (Safari privado, cuota): ni leer ni guardar tumban la hoja
  const roto = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cuota'); }, removeItem() {} };
  const P2 = construir(BASE_CALC, { localStorage: roto }, { consts: ['CALC_TICKS', 'CALC_K', 'CALC_DEF'] });
  igual(P2.calcPrefsLeer(), DEF, 'localStorage que lanza al leer → las de fábrica');
  let lanzo = false; try { P2.calcPrefsGuardar({ fee: '0.01' }); } catch (_) { lanzo = true; }
  igual(lanzo, false, 'y al guardar no lanza (try/catch)');
  igual(P.calcEntrada({ lotes: [1], fee: 'f', tick: 0.05, modo: 'usd', pct: '12', usd: '4', stop: '20' }), { lotes: [1], fee: 'f', tick: 0.05, modo: 'usd', objetivo: '4', stopPct: '20' }, 'calcEntrada: el objetivo es el del modo elegido ($)');
  igual(P.calcEntrada({ modo: 'pct', pct: '12', usd: '4' }).objetivo, '12', '…o el %');
}

// ════════════════ 11. la vista (HTML puro) con y sin datos ════════════════
const V = construir(BASE_CALC.concat(VISTA_CALC), { esc: C.esc, colUtil: C.colUtil, localStorage: C.localStorageFalso() }, { consts: CONSTS_CALC });
const st = (x) => Object.assign({ lotes: [{ n: '1', p: '' }], contrato: null, origen: '', modo: 'pct', pct: '12', usd: '50', fee: '0.02', tick: 0.01, stop: '20' }, x || {});
const hoja = (s, dest) => V.calcHojaHtml(s, V.calcLimitStop(V.calcEntrada(s)), dest);
const SUCIO = /NaN|undefined|Infinity|\[object/;
{
  // sin datos
  const h0 = hoja(st());
  assert(!SUCIO.test(h0), 'sin datos: ni NaN, ni undefined, ni Infinity en pantalla');
  assert(/LIMIT PARA VENDER<\/div><div class="cprecio">—<\/div><div class="fresco">Pon tus compras arriba\.<\/div>/.test(h0), 'sin compras el limit es «—» y dice qué falta');
  assert(/<div class="cres cstop"><div class="cprecio">—<\/div><div class="fresco">Pon tus compras arriba\.<\/div>/.test(h0), 'y el stop igual');
  assert(/Pon al menos una compra con contratos y prima/.test(h0) && /aquí verás la cuenta paso a paso/.test(h0), 'el resumen y la fórmula piden las compras');
  assert(/A mano: escribe tus compras/.test(h0), 'abierta a mano lo dice (sin contrato en el título)');
  assert(!/Poner en la orden/.test(h0) && !/MZ\.calcCopiar/.test(h0), 'sin precio no hay «Copiar» ni «Poner en la orden»');
  assert(/id="cN0" data-c="n" data-i="0" type="text" inputmode="decimal"[^>]*value="1"/.test(h0) && /id="cP0" data-c="p" data-i="0"[^>]*value=""[^>]*placeholder="0\.52"/.test(h0), 'una compra vacía: contratos 1 y la prima por llenar (0.52 de ejemplo)');
  assert(/class="cquitar" onclick="MZ\.calcLoteQuitar\(0\)" aria-label="Quitar la compra 1" id="cQuitar0" disabled>/.test(h0), 'la única compra no se puede quitar');
  [[{ n: '0', p: '1' }], [{ n: '-2', p: '0.5' }], [{ n: '2', p: '-1' }], [{ n: 'x', p: 'y' }], [], null].forEach(l => {
    const h = hoja(st({ lotes: l }));
    assert(!SUCIO.test(h) && /<div class="cprecio">—<\/div>/.test(h), 'compras ' + JSON.stringify(l) + ': «—» y sin NaN en pantalla');
  });
  // rev67: la fracción diminuta del revisor (antes «costo medio Infinity», «LIMIT Infinity», «STOP Infinity») y el aviso
  [[{ n: '0.00001', p: '1' }], [{ n: '0,00004', p: '1' }]].forEach(l => {
    const h = hoja(st({ lotes: l }));
    assert(!SUCIO.test(h) && /<div class="cprecio">—<\/div>/.test(h) && /Los contratos van enteros \(1, 2, 3…\): la compra 1 no cuenta\./.test(h), 'contratos ' + JSON.stringify(l[0].n) + ': «—», sin Infinity en pantalla y dice que la compra 1 no cuenta', h.slice(0, 900));
  });
  const hFr = hoja(st({ lotes: [{ n: '1,5', p: '1' }, { n: '4', p: '0.52' }, { n: '0.5', p: '1' }] }));
  assert(/<b class="mono">4<\/b> contratos · costo medio <b class="mono">0\.52/.test(hFr) && /Los contratos van enteros \(1, 2, 3…\): las compras 1, 3 no cuentan\./.test(hFr), '«1,5» y «0.5» entre buenas: el resumen de las buenas y el aviso de las dos que no cuentan');
  assert(!/van enteros/.test(hoja(st({ lotes: [{ n: '4', p: '0.52' }, { n: '', p: '' }, { n: '0', p: '1' }] }))), 'una compra vacía o a 0 no lleva aviso (ya se ve que no cuenta)');
  igual([V.calcLotesPartidos([{ n: '1.5' }, { n: '2' }, { n: 'x' }, null, { n: '-0.5' }, { n: '0,25' }]), V.calcLotesPartidos(null)], [[1, 6], []], 'calcLotesPartidos: solo los positivos no enteros, numerados desde 1');
  ['', '-1', 'abc'].forEach(o => assert(!SUCIO.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: o }))) && /Pon cuánto quieres ganar/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: o }))), 'objetivo ' + JSON.stringify(o) + ': sin limit, dice qué falta, sin NaN'));
  const hFee = hoja(st({ lotes: [{ n: '1', p: '2.40' }], fee: '' }));
  assert(!SUCIO.test(hFee) && (hFee.match(/Pon la comisión \(0 si tu bróker no cobra\)/g) || []).length === 2 && /Pon la comisión por contrato, en prima/.test(hFee), 'sin comisión: limit y stop piden la comisión y la nota también');
  assert(/Pon un % de pérdida entre 0 y 99/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], stop: '100' }))), 'stop del 100 %: lo dice');

  // con datos: TSLA 420, objetivo $4
  const c = { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' };
  const s1 = st({ lotes: [{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], contrato: c, origen: 'tu libro: 2 fichas de este contrato', modo: 'usd', usd: '4' });
  const h1 = hoja(s1);
  assert(!SUCIO.test(h1), 'con datos: nada de NaN');
  assert(/<b class="mono" style="color:var\(--tx\)">TSLA CALL 420 · vence 2026-11-20 · E\*TRADE<\/b><span class="fresco" style="display:block">tu libro: 2 fichas de este contrato<\/span>/.test(h1), 'el contrato en el título y, debajo, de dónde salió');
  assert(/<b class="mono">4<\/b> contratos · costo medio <b class="mono">0\.52<\/b> \(\$52\.00 por contrato\) · pagaste <b class="mono">\$208\.00<\/b>/.test(h1), 'resumen: 4 contratos, costo medio 0.52 ($52.00) y $208.00 pagados (las cifras en mono)');
  assert(/<div class="cprecio" id="cLimit">0\.55<small>= \$55\.00 por contrato<\/small><\/div>/.test(h1), 'el LIMIT grande: 0.55 = $55.00 por contrato');
  assert(/<span>Cobras<\/span><b>\$220\.00<\/b><\/div><div><span>Comisiones<\/span><b>\$8\.00<\/b><\/div><div><span>Ganancia neta<\/span><b style="color:var\(--verde\)">\+\$4\.00<\/b><i style="color:var\(--verde\)">\+1\.92 %<\/i>/.test(h1), 'cobras $220.00 · comisiones $8.00 · ganancia neta +$4.00 y +1.92 % debajo (en verde)');
  assert(/<div class="cprecio" id="cStopP">0\.42<small>= \$42\.00 por contrato<\/small>/.test(h1) && /Pérdida neta<\/span><b style="color:var\(--rojo\)">-\$48\.00<\/b><i style="color:var\(--rojo\)">-23\.08 %<\/i>/.test(h1), 'el STOP: 0.42 y su pérdida neta con comisiones (-$48.00, en rojo)');
  assert(/onclick="MZ\.calcCopiar\('limit'\)">Copiar<\/button>/.test(h1) && /onclick="MZ\.calcCopiar\('stop'\)">Copiar<\/button>/.test(h1), '«Copiar» en el limit y en el stop');
  assert(!/Poner en la orden/.test(h1), 'sin hoja de orden abierta: solo «Copiar»');
  assert(/costo medio 0\.52  \(\$208\.00 ÷ 4 ÷ 100\)\n\+ objetivo  0\.01  \(\$4\.00 ÷ 4 ÷ 100\)\n\+ comisión  0\.02  \(compra \+ venta\)\n= 0\.55 → limit 0\.55 \(arriba a 1¢\)\nstop 0\.52 × \(1 − 20 %\) = 0\.416 → 0\.42/.test(h1), 'la cuenta paso a paso, como en su Excel', h1.split('cFormula">')[1]);
  assert(/value="1\.21"/.test(h1) && /value="0\.29"/.test(h1) && /id="cN1" data-c="n" data-i="1"[^>]*value="3"/.test(h1), 'las dos compras en sus campos');
  assert(/onclick="MZ\.calcLoteQuitar\(1\)" aria-label="Quitar la compra 2" id="cQuitar1">/.test(h1), 'con dos compras sí se puede quitar una');
  assert(/<button type="button" class="">%<\/button><button type="button" class="on">\$ total<\/button>/.test(h1.replace(/ (onclick|id|aria-pressed)="[^"]*"/g, '')) && /id="cObj"[^>]*value="4"/.test(h1), 'el modo $ marcado y el objetivo 4');
  assert(/onclick="MZ\.calcModo\('pct'\)" id="cModoPct" aria-pressed="false">%<\/button><button type="button" class="on" onclick="MZ\.calcModo\('usd'\)" id="cModoUsd" aria-pressed="true">\$ total/.test(h1), 'rev67: %/$ con aria-pressed (el lector de pantalla dice cuál está elegido) y un id para devolverles el foco');
  assert(/Ganancia NETA en dólares, sumando todos los contratos/.test(h1), 'y dice que es neta y de todos los contratos');
  // con el 12 % y la comisión de su Excel
  const h2 = hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: '12', fee: '0.01' }));
  assert(/id="cLimit">2\.70</.test(h2) && /\+\$29\.00<\/b><i[^>]*>\+12\.08 %/.test(h2) && /id="cStopP">1\.92</.test(h2), 'hoja 1: 2.70 (+$29.00 · +12.08 %) y stop 1.92');
  assert(/0\.01 de prima por contrato = \$0\.50 al comprar \+ \$0\.50 al vender\./.test(h2), 'la nota de la comisión en dólares');
  assert(/12 % de 2\.40/.test(h2), 'la fórmula del % dice de qué');
  assert(/<button type="button" class="chip2 on" onclick="MZ\.calcChip\(12\)" id="cChipP12" aria-pressed="true">12%<\/button>/.test(h2) && (h2.match(/chip2 on/g) || []).length === 1, 'el chip del 12 % encendido (y solo ese)');
  igual([(h2.match(/aria-pressed="true"/g) || []).length, (h2.match(/class="chip2" onclick="MZ\.calcChip\(\d+\)" id="cChipP\d+" aria-pressed="false"/g) || []).length], [3, 7], 'rev67: aria-pressed en los chips (el 12 % sí, los otros 7 no), en %/$ y en 1¢/5¢');
  assert(/<button type="button" class="on" onclick="MZ\.calcTick\(0\.01\)" id="cTick1" aria-pressed="true">1¢<\/button><button type="button" class="" onclick="MZ\.calcTick\(0\.05\)" id="cTick5" aria-pressed="false">5¢<\/button>/.test(h2), 'el incremento: 1¢ marcado, 5¢ a un toque');
  assert(/id="cLimit">2\.75</.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], tick: 0.05 }))) && /arriba a 5¢/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], tick: 0.05 }))), 'con 5¢: 2.75 y la fórmula lo dice');
  // lo tecleado se escapa
  const h3 = hoja(st({ lotes: [{ n: '"><b>', p: '<img>' }], contrato: { symbol: 'A<B', direccion: 'CALL', strike: 1, expiracion: '2026-11-20' } }));
  assert(!/<img>|"><b>|A<B/.test(h3) && /&lt;img&gt;/.test(h3) && /A&lt;B/.test(h3), 'lo tecleado y el contrato se escapan');
  // el stop en ganancia (0 % sin comisión): no dice «pérdida»
  assert(/Resultado neto<\/span><b style="color:var\(--tx2\)">\$0\.00<\/b><i style="color:var\(--tx2\)">0\.00 %<\/i>/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], fee: '0', stop: '0' }))), 'un stop sin pérdida dice «Resultado neto», no «Pérdida»');
  // los cuatro estados de la hoja de orden en el LIMIT
  const r1 = V.calcLimitStop(V.calcEntrada(s1));
  const ok = V.calcLimitHtml(r1, { estado: 'ok', texto: 'La orden de venta de este contrato está abierta.' });
  assert(/<button type="button" class="pri" onclick="MZ\.calcPonerEnOrden\(\)">Poner en la orden<\/button><button type="button" class="btnsec" onclick="MZ\.calcCopiar\('limit'\)">Copiar<\/button>/.test(ok), 'orden de venta Límite de este contrato abierta: «Poner en la orden» y «Copiar»');
  const bl = V.calcLimitHtml(r1, { estado: 'bloqueada', texto: 'La orden ya tiene vista previa: toca «Editar la orden» y vuelve a ponerlo.' });
  assert(/class="pri" disabled[^>]*>Poner en la orden/.test(bl) && !/MZ\.calcPonerEnOrden/.test(bl) && /toca «Editar la orden»/.test(bl), 'con vista previa: el botón apagado y por qué');
  assert(/class="pri" disabled/.test(V.calcLimitHtml(r1, { estado: 'no_limit', texto: 'no es Límite' })), 'si no es Límite: apagado');
  const otra = V.calcLimitHtml(r1, { estado: 'otra', texto: 'La orden abierta es de SPY CALL 690, no de este contrato: no se toca.' });
  assert(!/Poner en la orden/.test(otra) && /no de este contrato: no se toca/.test(otra), 'una orden de otro contrato: sin botón y lo dice');
  assert(!/Poner en la orden/.test(V.calcLimitHtml(r1, null)), 'sin destino: solo «Copiar»');
  igual(V.calcTitulo({ symbol: 'SPY', direccion: 'PUT', strike: 690, expiracion: null, broker: 'schwab' }), 'SPY PUT 690 · Schwab', 'calcTitulo sin vencimiento');
  igual(V.calcTitulo(null), '', 'calcTitulo sin contrato → vacío');
}

// ════════════════ 12. la hoja en pantalla (DOM de juguete): abrir, teclear, cerrar, Escape ════════════════
// <body> con sus cuadros, y los nodos de DENTRO de la hoja (por id) solo si su HTML los trae.
function domFalso() {
  const cuerpo = [], nodos = {}, escuchas = [];
  // rev67: el FOCO, con un DOM de juguete algo más fiel. Cada bloque repintado guarda su HTML (`bloques`) y la página
  // efectiva es el HTML de los cuadros del <body> con los bloques sustituidos. Un innerHTML nuevo (o quitar el cuadro) se
  // lleva los nodos que había DENTRO: dejan de estar conectados, el siguiente $('#id') da uno NUEVO (apagado si su etiqueta
  // lo dice) y, si uno tenía el foco, el foco cae a <body> — lo que hace el navegador. focus() lo anota en activeElement.
  const bloques = {};
  const VACIOS = /^(input|br|img|hr|meta|link)$/i;
  // [ini, fin) del contenido del elemento con ese id en `h`, o null
  const interior = (h, id) => {
    const p = h.indexOf('id="' + id + '"'); if (p < 0) return null;
    const a = h.lastIndexOf('<', p), cierre = h.indexOf('>', p); if (a < 0 || cierre < 0) return null;
    const tag = (/^<(\w+)/.exec(h.slice(a)) || [])[1]; if (!tag) return null;
    if (VACIOS.test(tag)) return [cierre + 1, cierre + 1];
    const re = /<(\/?)(\w+)[^>]*>/g; re.lastIndex = cierre + 1; let prof = 1, m;
    while ((m = re.exec(h))) { if (m[2] !== tag) continue; prof += m[1] ? -1 : 1; if (!prof) return [cierre + 1, m.index]; }
    return null;
  };
  const efectivo = (h) => {
    h = String(h);
    Object.keys(bloques).forEach(k => { const r = interior(h, k); if (r) h = h.slice(0, r[0]) + efectivo(bloques[k]) + h.slice(r[1]); });
    return h;
  };
  const pagina = () => cuerpo.map(n => efectivo(n.__html)).join('\n');
  const idsDe = (h) => (String(h).match(/id="([\w-]+)"/g) || []).map(x => x.slice(4, -1));
  const soltar = (h) => idsDe(h).forEach(k => {
    delete bloques[k];
    const viejo = nodos[k]; if (!viejo) return;
    delete nodos[k]; viejo.isConnected = false;
    if (doc.activeElement === viejo) doc.activeElement = doc.body;
  });
  const enfocable = (n) => { n.focus = () => { doc.activeElement = n; }; return n; };
  const crear = () => {
    const n = enfocable(C.nodo({ style: {}, oyentes: {}, id: '' }));
    n.__html = '';
    Object.defineProperty(n, 'innerHTML', { get: () => n.__html, set: (v) => { soltar(efectivo(n.__html)); n.__html = String(v); }, enumerable: true, configurable: true });
    n.contains = (x) => !!x && !!x.id && idsDe(efectivo(n.__html)).includes(x.id);
    n.addEventListener = (t, f) => { n.oyentes[t] = f; };
    n.remove = () => { const i = cuerpo.indexOf(n); if (i >= 0) { cuerpo.splice(i, 1); soltar(efectivo(n.__html)); } };
    return n;
  };
  const interno = (id, tag) => {
    const n = enfocable(C.nodo({ id, disabled: /\sdisabled[\s>]/.test(tag) }));
    Object.defineProperty(n, 'innerHTML', { get: () => (id in bloques ? bloques[id] : ''), set: (v) => {
      // lo que había dentro (en la página efectiva) se va con el HTML viejo
      const pg = pagina(), r = interior(pg, id);
      if (r) soltar(pg.slice(r[0], r[1]));
      bloques[id] = String(v);
    }, enumerable: true, configurable: true });
    return (nodos[id] = n);
  };
  const doc = {
    createElement: crear,
    body: { appendChild: (n) => { cuerpo.push(n); }, id: '' },
    activeElement: null,
    addEventListener: (t, f) => { escuchas.push([t, f]); },
    querySelector: (s) => {
      if (s === '.modal') return cuerpo.find(n => /(^| )modal( |$)/.test(n.className)) || null;
      const m = /^#([\w-]+)$/.exec(s); if (!m) return null;
      const arriba = cuerpo.find(n => n.id === m[1]); if (arriba) return arriba;
      if (nodos[m[1]]) return nodos[m[1]];
      const pg = pagina();
      const tag = (pg.match(new RegExp('<[^>]*id="' + m[1] + '"[^>]*>')) || [null])[0];
      return tag ? interno(m[1], tag) : null;
    },
    querySelectorAll: (s) => s === '.modal' ? cuerpo.filter(n => /(^| )modal( |$)/.test(n.className)) : [],
  };
  doc.activeElement = doc.body;
  return { doc, cuerpo, nodos, escuchas, $: (s) => doc.querySelector(s), crear };
}
const DOM_CALC = ['abrirCalc', 'cerrarCalc', 'calcTecla', 'calcInput', 'calcManualAnotar', 'calcLoteMas', 'calcLoteQuitar', 'calcModo', 'calcTick', 'calcChip', 'calcCopiar',
  'calcTecladoFisico', 'calcFocoId', 'calcFocoVolver', 'pintarCalcRes', 'calcResultado', 'calcDestino', 'ordenParaCalc', 'estadoOrdenCalc', 'claveContrato', 'calcPonerEnOrden'];
function armarHoja(E) {
  E = E || {};
  const D = domFalso(), ls = E.ls || C.localStorageFalso(), reg = { toasts: [], timers: [], copias: [] };
  const win = {};
  const deps = Object.assign({ $: D.$, document: D.doc, window: win, localStorage: ls, esc: C.esc, colUtil: C.colUtil,
    toast: (t) => reg.toasts.push(t), setTimeout: (f, ms) => { reg.timers.push({ f, ms }); return 0; },
    navigator: { clipboard: { writeText: async (v) => { if (E.sinPortapapeles) throw new Error('no'); reg.copias.push(v); } } } }, E.deps || {});
  const M = construir(DOM_CALC.concat(BASE_CALC, VISTA_CALC, E.mas || []), deps,
    { consts: CONSTS_CALC.concat(['_calc', '_calcManual', '_calcVuelta'], E.consts || []), prefijo: E.prefijo || '', sufijo: 'function __calc() { return _calc; } function __manual() { return _calcManual; }' + (E.sufijo || ''), extras: ['__calc', '__manual'].concat(E.extras || []) });
  return { M, D, ls, reg, win };
}
const ev = (id, valor, extra) => ({ target: Object.assign({ id, value: valor, dataset: {} }, extra || {}) });
const evLote = (c, i, valor) => ({ target: { id: 'c' + c.toUpperCase() + i, value: valor, dataset: { c, i: String(i) } } });
(async () => {
  {
    const { M, D, ls, reg, win } = armarHoja();
    M.abrirCalc(null);
    igual(D.cuerpo.length, 1, 'abrir: un cuadro en <body> (fuera de #vista: el repintado de la vista no lo toca)');
    const m = D.cuerpo[0];
    igual([m.className, m.id, m.style.zIndex], ['modal', 'modalCalc', 52], 'es una .modal (los guardas de la app la ven) con id modalCalc, encima de la orden (50) y debajo del PIN (55)');
    assert(/<div class="hoja calc" id="cHoja" tabindex="-1" role="dialog" aria-modal="true" aria-label="Calculadora de limit y stop">/.test(m.innerHTML) && /Calculadora de limit y stop/.test(m.innerHTML), 'con la hoja de la calculadora dentro (un diálogo que puede recibir el foco)');
    igual(typeof m.oyentes.input, 'function', 'escucha los tecleos de sus campos (input)');
    igual(D.escuchas.filter(e => e[0] === 'keydown').length, 1, 'y Escape (keydown en el documento)');
    igual([reg.timers.length, reg.timers[0] && reg.timers[0].ms], [1, 60], 'a mano y sin prima: el foco va a la primera prima');
    // teclear el TSLA
    m.oyentes.input(evLote('p', 0, '1.21'));
    igual(M.__calc().lotes[0], { n: '1', p: '1.21' }, 'teclear la prima la pone en el estado, tal cual');
    assert(/id="cLimit">1\.38</.test(D.nodos.cResLimit.innerHTML), 'y el limit se repinta en su sitio (1.21 + 12 % + 0.02 = 1.3752 → 1.38)', D.nodos.cResLimit.innerHTML);
    M.calcLoteMas();
    igual(M.__calc().lotes.length, 2, '«+ Añadir compra» añade una fila');
    assert(/id="cP1"/.test(D.nodos.cLotes.innerHTML), 'y se repintan las compras (solo ese bloque)');
    m.oyentes.input(evLote('n', 1, '3')); m.oyentes.input(evLote('p', 1, '0,29'));
    m.oyentes.input(ev('cObj', '2'));
    assert(/id="cLimit">0\.56</.test(D.nodos.cResLimit.innerHTML) && /<b class="mono">4<\/b> contratos · costo medio <b class="mono">0\.52/.test(D.nodos.cResumen.innerHTML), 'TSLA con 2 %: 0.56 y el resumen de 4 contratos a 0.52');
    M.calcModo('usd');
    assert(/class="on" onclick="MZ\.calcModo\('usd'\)"/.test(D.nodos.cObjBox.innerHTML) && /id="cObj"[^>]*value="50"/.test(D.nodos.cObjBox.innerHTML), 'cambiar a $: el bloque del objetivo se repinta con su último $ (50 de fábrica)');
    m.oyentes.input(ev('cObj', '4'));
    assert(/id="cLimit">0\.55</.test(D.nodos.cResLimit.innerHTML) && /\+\$4\.00<\/b><i[^>]*>\+1\.92 %/.test(D.nodos.cResLimit.innerHTML), 'con $4: 0.55 y +$4.00');
    M.calcChip(25);
    igual(M.__calc().usd, '25', 'un chip pone el objetivo');
    assert(/class="chip2 on" onclick="MZ\.calcChip\(25\)"/.test(D.nodos.cChips.innerHTML), 'y se enciende');
    M.calcTick(0.05);
    assert(/class="on" onclick="MZ\.calcTick\(0\.05\)"/.test(D.nodos.cTick.innerHTML), '5¢ marcado');
    M.calcTick(0.1); igual(M.__calc().tick, 0.05, 'un incremento que no existe se ignora');
    m.oyentes.input(ev('cFee', '0.01')); m.oyentes.input(ev('cStop', '30'));
    igual(JSON.parse(ls.almacen.mz_calc), { fee: 0.01, tick: 0.05, modo: 'usd', pct: 2, usd: 25, stop: 30 }, 'persistencia: comisión, incremento, modo, objetivos y stop');
    assert(!/1\.21|0\.29|0,29|lotes/.test(ls.almacen.mz_calc), 'y nada de las compras');
    m.oyentes.input(ev('otro', 'x'));
    m.oyentes.input({ target: null });
    igual(M.__calc().usd, '25', 'un input ajeno (o sin target) no toca nada');
    await M.calcCopiar('limit');
    igual([reg.copias.pop(), reg.toasts.pop()], [M.calcLimitStop(M.calcEntrada(M.__calc())).limit.precio.toFixed(2), 'Limit ' + M.calcLimitStop(M.calcEntrada(M.__calc())).limit.precio.toFixed(2) + ' copiado'], 'Copiar el limit: al portapapeles y lo dice');
    await M.calcCopiar('stop');
    assert(/^Stop \d+\.\d\d copiado$/.test(reg.toasts.pop()), 'Copiar el stop');
    M.calcLoteQuitar(0);
    igual(M.__calc().lotes, [{ n: '3', p: '0,29' }], 'quitar la primera compra');
    M.calcLoteQuitar(0);
    igual(M.__calc().lotes.length, 1, 'la última no se quita');
    // a mano: las compras se recuerdan EN MEMORIA al cerrar y volver a abrir desde la cabecera
    igual(M.__manual(), [{ n: '3', p: '0,29' }], 'las compras tecleadas a mano quedan en memoria');
    // Escape cierra
    const tecla = D.escuchas.find(e => e[0] === 'keydown')[1];
    tecla({ key: 'Enter' });
    igual(D.cuerpo.length, 1, 'otra tecla no cierra');
    tecla({ key: 'Escape' });
    igual([D.cuerpo.length, M.__calc()], [0, null], 'Escape cierra la hoja y suelta su estado');
    tecla({ key: 'Escape' });
    igual(D.cuerpo.length, 0, 'Escape sin hoja: nada');
    M.pintarCalcRes(); M.calcLoteMas(); M.calcModo('pct'); M.calcChip(5); M.calcInput(ev('cObj', '3'));
    C.ok('con la hoja cerrada, repintar y los botones no revientan');
    await M.calcCopiar('limit');
    igual(reg.toasts.pop(), 'Todavía no hay precio que copiar.', 'Copiar sin hoja: lo dice');
    M.abrirCalc(null);
    igual(M.__calc().lotes, [{ n: '3', p: '0,29' }], 'volver a abrir a mano: siguen las compras de antes (en memoria, no guardadas)');
    igual(D.escuchas.filter(e => e[0] === 'keydown').length, 1, 'Escape se registra UNA vez aunque se abra dos veces');
    igual(win._mzCalcTecla, true, '(la marca vive en window, como los timers)');
    igual(M.__calc().modo, 'usd', 'abre con el último modo recordado');
    igual([M.__calc().fee, M.__calc().tick, M.__calc().stop, M.__calc().usd], ['0.01', 0.05, '30', '25'], 'y con la comisión, el incremento, el stop y el objetivo de la última vez');
    // abrir otra vez con la hoja abierta: la sustituye, nunca dos
    M.abrirCalc({ contrato: { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' }, lotes: [{ n: 4, p: 0.52 }], origen: 'tu libro' });
    igual(D.cuerpo.filter(n => n.id === 'modalCalc').length, 1, 'abrir con una ya abierta la sustituye: nunca dos calculadoras');
    igual(M.__calc().lotes, [{ n: '4', p: '0.52' }], 'ya llena: los lotes de la posición (en texto)');
    assert(/TSLA CALL 420 · vence 2026-11-20 · E\*TRADE/.test(D.cuerpo[0].innerHTML) && /id="cLimit">/.test(D.cuerpo[0].innerHTML), 'con su contrato en el título y el resultado ya calculado');
    // rev67: ahora el foco ENTRA en la hoja; sin teclado físico (sin matchMedia aquí: el teléfono) va a la hoja misma, no a un campo
    reg.timers[reg.timers.length - 1].f();
    igual(D.doc.activeElement && D.doc.activeElement.id, 'cHoja', 'ya llena no salta el teclado: en el teléfono el foco va a la HOJA (tabindex=-1), no a un campo');
    igual(M.__manual(), [{ n: '3', p: '0,29' }], 'y no pisa las compras tecleadas a mano');
    M.abrirCalc({ contrato: { symbol: 'X' }, lotes: [{ n: NaN, p: null }] });
    igual(M.__calc().lotes, [{ n: '', p: '' }], 'un NaN o null de una posición rara sale como campo vacío, no como «NaN»');
    assert(!SUCIO.test(D.cuerpo[0].innerHTML), 'y sin NaN en pantalla');
    // cerrar la calculadora no cierra la orden de debajo
    const orden = D.crear(); orden.className = 'modal'; orden.id = 'modalOrden'; D.cuerpo.unshift(orden);
    M.cerrarCalc();
    igual(D.cuerpo.map(n => n.id), ['modalOrden'], 'cerrar la calculadora deja la hoja de orden de debajo tal cual');
  }
  {
    const { M, reg } = armarHoja({ sinPortapapeles: true });
    M.abrirCalc({ contrato: { symbol: 'TSLA' }, lotes: [{ n: 1, p: 2.4 }] });
    await M.calcCopiar('limit');
    igual(reg.toasts.pop(), 'Copia manual: 2.71', 'sin portapapeles: «Copia manual» con el precio');
  }
  {
    const roto = { getItem() { throw new Error('privado'); }, setItem() { throw new Error('cuota'); }, removeItem() {} };
    const { M, D } = armarHoja({ ls: roto });
    M.abrirCalc(null);
    D.cuerpo[0].oyentes.input(evLote('p', 0, '2.40'));
    assert(/id="cLimit">2\.71</.test(D.nodos.cResLimit.innerHTML), 'con localStorage bloqueado la hoja funciona igual (de fábrica: 12 % y 0.02 → 2.71)');
  }

  // ════════════════ 12b. rev67: el FOCO entra en la hoja, no se pierde al repintar y vuelve al cerrar ════════════════
  // (ningún cuadro es inert y la hoja es lo último del <body>: con el foco en <body>, el Tab de la Mac recorría todo el Copiloto)
  const MAC = { matchMedia: (q) => ({ matches: q === '(hover: hover) and (pointer: fine)' }) };
  const TSLA_L = { contrato: { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' }, lotes: [{ n: 1, p: 1.21 }, { n: 3, p: 0.29 }], origen: 'tu libro' };
  const id = (D) => D.doc.activeElement && D.doc.activeElement.id;
  const correr = (reg) => { const t = reg.timers.splice(0); t.forEach(x => x.f()); };
  {
    const { M, D, reg } = armarHoja({ deps: { window: MAC } });
    const boton = D.crear(); boton.id = 'bCalc8'; boton.focus();          // «Calcular limit» de la ficha 8, en el Copiloto
    M.abrirCalc(TSLA_L);
    correr(reg);
    igual(id(D), 'cObj', 'Mac: abierta ya llena desde una posición, el foco ENTRA en la hoja, en el objetivo (lo que se cambia)');
    // un chip (15 %) con el teclado: pintarCalcRes rehace los chips con innerHTML
    const chip = D.$('#cChipP15'); chip.focus();
    M.calcChip(15);
    assert(id(D) === 'cChipP15' && D.doc.activeElement !== chip && chip.isConnected === false, 'un chip: el foco sigue en el 15 % (el NUEVO botón; el viejo se fue con el repintado), no en <body>', id(D));
    assert(/class="chip2 on" onclick="MZ\.calcChip\(15\)" id="cChipP15" aria-pressed="true"/.test(D.nodos.cChips.innerHTML), '(y es el encendido, con aria-pressed)');
    // 1¢/5¢
    D.$('#cTick5').focus(); M.calcTick(0.05);
    igual(id(D), 'cTick5', '5¢: el foco sigue en 5¢');
    // %/$
    D.$('#cModoUsd').focus(); M.calcModo('usd');
    igual(id(D), 'cModoUsd', '$ total: el foco sigue en «$ total» (el bloque del objetivo se rehízo entero)');
    D.$('#cModoPct').focus(); M.calcModo('pct');
    igual(id(D), 'cModoPct', 'y de vuelta a %');
    // un chip tocado con el ratón en Safari (el botón no se enfoca): no se le pone el foco a nada
    D.$('#cObj').focus(); M.calcChip(20);
    igual(id(D), 'cObj', 'un chip con el foco en el campo del objetivo: el foco se queda en el campo');
    // quitar compras con el teclado
    M.calcLoteMas(); D.$('#cQuitar1').focus();
    M.calcLoteQuitar(1);
    igual([M.__calc().lotes.length, id(D)], [2, 'cQuitar1'], '× de la compra 2 de 3: el foco pasa a la × que queda en su sitio');
    M.calcLoteQuitar(1);
    igual([M.__calc().lotes.length, id(D)], [1, 'cMas'], '× de la última que se podía quitar: la que queda tiene la × apagada → el foco va a «+ Añadir compra»');
    D.doc.activeElement = D.doc.body; M.calcLoteMas(); D.doc.activeElement = D.doc.body;
    M.calcLoteQuitar(0);
    igual(id(D), '', 'quitar con el ratón (foco en <body>): no se mueve el foco a ningún lado');
    // Escape: vuelve al botón que la abrió
    const tecla = D.escuchas.find(e => e[0] === 'keydown')[1];
    tecla({ key: 'Escape' });
    igual([D.cuerpo.length, D.doc.activeElement === boton], [0, true], 'Escape: el foco vuelve a «Calcular limit» de la ficha 8, no a <body>');
    // «Cerrar»
    M.abrirCalc(TSLA_L); D.$('#cFee').focus(); M.cerrarCalc();
    igual(D.doc.activeElement === boton, true, '«Cerrar» (o ✕): igual');
    // la abre OTRA desde dentro (la sustituye): al cerrar, vuelve al botón de la primera
    M.abrirCalc(TSLA_L); D.$('#cObj').focus();
    M.abrirCalc({ contrato: TSLA_L.contrato, lotes: [{ n: 4, p: 0.52 }] });
    M.cerrarCalc();
    igual(D.doc.activeElement === boton, true, 'si otra la sustituye desde dentro, al cerrar se vuelve al botón de la primera (no a un campo que ya no existe)');
    // el botón que la abrió ya no está (la página se repintó): no se enfoca un nodo suelto
    M.abrirCalc(TSLA_L); boton.isConnected = false; D.doc.activeElement = D.$('#cObj');
    M.cerrarCalc();
    assert(D.doc.activeElement !== boton, 'si el botón de origen ya no está en la página, no se le da el foco');
    // un temporizador de una hoja ya cerrada no mueve el foco
    boton.isConnected = true; boton.focus();
    M.abrirCalc(TSLA_L); M.cerrarCalc(); correr(reg);
    igual(D.doc.activeElement === boton, true, 'cerrada antes de sus 60 ms: su temporizador no toca el foco');
    // a mano y sin prima: a la primera prima (como siempre)
    M.abrirCalc(null); correr(reg);
    igual(id(D), 'cP0', 'a mano y sin prima: el foco a la primera prima, como antes');
  }
  {
    // el teléfono (sin teclado físico): a la hoja, nunca a un campo (no salta el teclado)
    const { M, D, reg } = armarHoja({ deps: { window: { matchMedia: () => ({ matches: false }) } } });
    M.abrirCalc(TSLA_L); correr(reg);
    igual(id(D), 'cHoja', 'teléfono: ya llena, el foco a la hoja (tabindex=-1), no al objetivo: no sale el teclado tapando el resultado');
    const { M: M2, D: D2, reg: reg2 } = armarHoja({ deps: { window: { matchMedia: () => { throw new Error('viejo'); } } } });
    M2.abrirCalc(TSLA_L); correr(reg2);
    igual(id(D2), 'cHoja', 'un matchMedia que revienta cuenta como teléfono');
  }
  // ════════════════ 13. los guardas de la app con la calculadora abierta ════════════════
  {
    const { M, D } = armarHoja();
    M.abrirCalc(null);
    // la GTC automática no se abre encima
    let pregunto = 0;
    const G = construir(['abrirGtcAutomatico'], { document: D.doc, _corte: { enCurso: false }, brokersOperables: () => { pregunto++; return ['etrade']; } });
    G.abrirGtcAutomatico([{ id: 1, broker: 'etrade' }]);
    igual(pregunto, 0, 'la GTC automática ve la calculadora (.modal) y no abre la orden encima');
    // la versión nueva espera
    const reg = { timers: [], reloads: 0, franja: [] };
    // v66: recargarSiSePuede mira lo que frena la recarga con motivoNoRecargar (cuadro, salida, orden, texto) y lo dice en la franja
    const R = construir(['recargarSiSePuede', 'motivoNoRecargar', 'campoConTexto', 'recargaYaIntentada', 'anotarRecarga', 'pedirActualizarSW'], { document: D.doc, _corte: { enCurso: false }, toast: () => {}, setTimeout: (f, ms) => { reg.timers.push(ms); }, location: { reload: () => reg.reloads++ }, franjaVersion: (m) => reg.franja.push(m) },
      { consts: ['VERSION_ESPERA_MS', 'VERSION_RECARGA_K', 'VERSION_RECARGA_VENTANA_MS'], prefijo: 'let _versionPendiente = 66; const _verEstado = { ultima: 0, timer: 0, atascada: 0, oculta: \'\' };' });
    R.recargarSiSePuede();
    igual([reg.reloads, reg.timers, reg.franja], [0, [15000], ['cuadro']], 'una versión nueva NO recarga con la calculadora abierta: espera 15 s (v66: y la franja dice «se actualiza al cerrar el cuadro»)');
    // el libro (Realtime) no repinta el Diario debajo
    let pinto = 0;
    const L = construir(['repintarVistaLibro'], { document: D.doc, vistaLibroAbierta: () => 'diario', diarioEnUso: () => false, vistaDiario: () => { pinto++; }, vistaCuentas: () => { pinto++; } });
    igual(L.repintarVistaLibro(), false, 'un fill por Realtime no repinta el Diario con la calculadora abierta');
    await C.respirar();
    igual(pinto, 0, '(ni después)');
    M.cerrarCalc();
    igual(L.repintarVistaLibro(), true, 'cerrada, el repintado vuelve');
  }
  {
    // el cableado en el fuente
    const ab = C.extraer('abrirCalc');
    assert(/m\.className = 'modal'; m\.id = 'modalCalc';/.test(ab) && /document\.body\.appendChild\(m\);/.test(ab), 'abrirCalc: una .modal en <body>, como el fill y la orden');
    const quien = C.FUENTE.split('\n').filter(l => /modalCalc/.test(l));
    assert(quien.every(l => /m\.id = 'modalCalc'|\$\('#modalCalc'\)/.test(l)), 'solo la calculadora busca o crea #modalCalc (nadie más la pinta)', quien.join('\n'));
    const pr = C.extraer('pintarCalcRes');
    igual((pr.match(/poner\('(\w+)'/g) || []).map(x => x.slice(7, -1)), ['cResumen', 'cChips', 'cFeeNota', 'cResLimit', 'cResStop', 'cFormula'], 'al teclear se repintan SOLO los resultados, nunca los campos (no se pierde el cursor)');
    assert(/if \(!_calc \|\| !\$\('#modalCalc'\)\) return;/.test(pr), 'y con la hoja cerrada no pinta nada');
    const todas = DOM_CALC.concat(BASE_CALC, VISTA_CALC.filter(n => /^calc/.test(n))).map(C.extraer).join('\n');
    assert(!/\bconfirm\(|\bprompt\(|\balert\(/.test(todas), 'sin confirm(), prompt() ni alert()');
    igual((todas.match(/\.(insert|update|upsert|delete)\(/g) || []), [], 'no escribe en la base');
    assert(!/sb\.from|fetch\(|PROXY_URL/.test(todas), 'ni lee la base, ni la red: solo calcula');
  }
  {
    // el módulo entero: la cabecera y window.MZ
    const fs = require('fs');
    const mod = C.cargarModuloEntero({ src: './app/main.js?v=65' });
    assert(mod.cargo, 'main.js entero carga con la calculadora', mod.error);
    if (mod.cargo) {
      const puertas = ['calcAbrir', 'calcCerrar', 'calcLoteMas', 'calcLoteQuitar', 'calcModo', 'calcTick', 'calcChip', 'calcCopiar', 'calcDePosicion', 'calcDeBroker', 'calcDeAbierto', 'calcDeOrden', 'calcPonerEnOrden'];
      igual(puertas.filter(k => typeof mod.win.MZ[k] !== 'function'), [], 'las puertas de la calculadora cuelgan de window.MZ');
      const viejas = ['abrirFill', 'abrirCuenta', 'abrirOrden', 'ordenPreview', 'ordenPlace', 'cortarPosicion', 'adoptar', 'venderGestor', 'notaDePosicion', 'diarioSincronizar', 'tickerAgregar'];
      igual(viejas.filter(k => typeof mod.win.MZ[k] !== 'function'), [], 'y no pisa ninguna de las de antes');
    }
    const INDEX = fs.readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8');
    const cab = (INDEX.match(/<header class="top">[\s\S]*?<\/header>/) || [''])[0];
    assert(/<button class="cfg" type="button" onclick="MZ\.calcAbrir\(\)" aria-label="Calculadora de limit y stop" title="Calculadora de limit y stop"><svg[^>]*stroke="currentColor"[\s\S]*?<\/svg><\/button>\s*<button class="cfg" type="button" onclick="MZ\.abrirCuenta\(\)"/.test(cab), 'la cabecera lleva el botón de la calculadora JUSTO antes del de ajustes (⚙), con el mismo estilo discreto y el color del tema');
    const css = (INDEX.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    assert(/\.calc \.cprecio\{[^}]*var\(--mono\)[^}]*font-variant-numeric:tabular-nums/.test(css) && /\.calc input\{[^}]*font-variant-numeric:tabular-nums;font-size:16px/.test(css), 'CSS: el precio y los campos en mono tabular, los campos a 16 px (iOS no amplía)');
    assert(/\.calc \.cstop \.cprecio\{color:var\(--rojo\)\}/.test(css) && /\.calc \.cseg button\.on\{background:var\(--oro\)/.test(css), 'CSS: el stop en rojo y lo elegido en oro (los colores del tema: claro y oscuro)');
    assert(/\.calc \.clote\{display:grid;grid-template-columns:18px minmax\(0,1fr\) minmax\(0,1\.4fr\) 40px/.test(css), 'CSS: cada compra en una fila que cabe a 375 px (columnas con minmax(0,…))');
    assert(/\.hoja\.calc:focus\{outline:none\}/.test(css), 'CSS rev67: la hoja enfocada (en el teléfono) sin un marco alrededor de todo el cuadro');
    // rev67 · la cabecera a 375 px con el mercado cerrado: medida en el navegador con la cabecera REAL (rev67/cabecera), «Cuentas
    // y diario» + «mercado cerrado» pasaba de 62 a 97 px (la fecha partida en «VIERNES, 30 OCT ·» / «NY» y el título en dos)
    assert(/header\.top \.fecha\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(css), 'CSS: la fecha no se parte (y, si de verdad no cabe, se recorta con «…» en vez de montarse sobre la píldora)');
    assert(/header\.top\{gap:8px\}/.test(css) && /header\.top>div:first-child\{min-width:0\}/.test(css), 'CSS: el bloque del título cede (min-width:0) y nunca queda pegado a la píldora (gap)');
    assert(/@media\(max-width:400px\)\{#estadoWorker\.b-vivo,#estadoWorker\.b-cerrado\{font-size:0;gap:0;padding:6px\}\}/.test(css), 'CSS: en pantallas estrechas «en vivo» y «mercado cerrado» se quedan en su punto');
    assert(!/@media\(max-width:400px\)\{[^}]*b-caido/.test(css), 'CSS: «worker caído» y «sin latido» conservan sus palabras (una alarma se lee)');
    const ew = C.extraer('estadoWorker');
    assert(/dot\('var\(--tx2\)'\) \+ 'mercado cerrado'/.test(ew) && /dot\('var\(--verde\)'\) \+ 'en vivo'/.test(ew), '(el texto sigue en la píldora: solo se oculta a la vista, el lector de pantalla lo lee)');
  }

  // ════════════════ 14. ya llena desde una posición (libro, bróker, libro de fills) ════════════════
  // las dos fichas de TSLA 420 de la hoja 2 de Andrés (un refuerzo registrado aparte) y una AAPL que el bróker tiene sin registrar
  const T1 = { id: 7, estado: 'abierta', broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', contratos: 1, prima_fill: 1.21, gtc_limite: 1.35, plan_pct: 10, stop_pct: 20, abierta_at: '2026-10-28T14:00:00Z', mark: 0.50, activo: true, modo_salida: 'trailing', trail_pct: 20 };
  const T2 = { ...T1, id: 8, contratos: 3, prima_fill: 0.29, gtc_limite: 0.34, abierta_at: '2026-10-29T14:00:00Z' };
  const OTRA = { ...T1, id: 9, strike: 430, contratos: 2, prima_fill: 0.80, abierta_at: '2026-10-27T14:00:00Z' };
  const SCHW = { ...T1, id: 10, broker: 'schwab', contratos: 5, prima_fill: 0.40 };
  const AAPL = { broker: 'etrade', symbol: 'AAPL', direccion: 'CALL', strike: 235, expiracion: '2026-11-20', contratos: 2, prima_fill: 1.3233333, mark: 1.55, valor_actual: 310, invertido: 264.67, pnl_usd: 45.33, pnl_pct: 17.1, clave: 'etrade|AAPL|CALL|235|2026-11-20' };
  {
    const B = construir(['calcDatosDePosicion', 'calcDatosDeItem', 'calcDatosDeAbiertos', 'claveAbiertoCalc', 'calcContrato', 'calcLote', 'claveCartera', 'claveContrato'], { BROKER_NOMBRE: C.BROKER_NOMBRE });
    igual(B.calcLote(4, 0.52), { n: '4', p: '0.52' }, 'calcLote: el texto de los campos');
    igual(B.calcLote(2, 1.3233333), { n: '2', p: '1.323333' }, 'el costo medio de un bróker con 6 decimales (lo pagado cuadra al centavo)');
    igual([B.calcLote(null, null), B.calcLote(0, -1), B.calcLote('', ''), B.calcLote(NaN, 'x')], [{ n: '', p: '' }, { n: '', p: '' }, { n: '', p: '' }, { n: '', p: '' }], 'lo que no es un número positivo sale como campo vacío (nunca «NaN» ni «0»)');
    igual(B.calcContrato({ symbol: ' tsla ', direccion: 'call', strike: '420', expiracion: '2026-11-20T00:00:00Z', broker: 'etrade' }), { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' }, 'calcContrato normaliza el contrato');
    igual(B.calcContrato({ symbol: 'X', strike: '' }), { symbol: 'X', direccion: '', strike: null, expiracion: null, broker: null }, 'sin strike ni vencimiento: null, no 0');
    const d = B.calcDatosDePosicion(8, [OTRA, T2, SCHW, T1, { ...T1, id: 11, estado: 'cerrada' }]);
    igual(d.lotes, [{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], 'la ficha y su hermana del MISMO contrato y bróker, en orden de apertura (1 a 1.21 + 3 a 0.29)');
    igual(d.contrato, { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' }, 'con su contrato');
    igual(d.origen, 'tu libro: 2 fichas de este contrato', 'y dice de dónde salen');
    igual(B.calcDatosDePosicion(9, [OTRA, T1, T2]).lotes, [{ n: '2', p: '0.8' }], 'otro strike no se mezcla');
    igual(B.calcDatosDePosicion(10, [T1, T2, SCHW]).lotes, [{ n: '5', p: '0.4' }], 'el mismo contrato en OTRO bróker tampoco');
    igual(B.calcDatosDePosicion(11, [T1, { ...T1, id: 11, estado: 'cerrada' }]), null, 'una ficha cerrada no abre la calculadora');
    igual([B.calcDatosDePosicion(99, [T1]), B.calcDatosDePosicion(7, null)], [null, null], 'una ficha que no está → null');
    const sinK = B.calcDatosDePosicion(12, [{ ...T1, id: 12, strike: null }, { ...T1, id: 13, strike: null }]);
    igual(sinK.lotes.length, 1, 'una ficha sin strike no se agrupa con nadie (sin clave no hay «mismo contrato»)');
    const it = B.calcDatosDeItem(AAPL);
    igual([it.contrato.symbol, it.contrato.broker, it.lotes, it.origen], ['AAPL', 'etrade', [{ n: '2', p: '1.323333' }], 'costo medio de E*TRADE'], 'una línea del bróker: sus contratos y SU costo medio');
    igual(B.calcDatosDeItem(null), null, 'sin línea → null');
    const ab = [{ broker: 'schwab', contrato: 'SPY|PUT|680|2026-11-06', symbol: 'SPY', direccion: 'PUT', strike: 680, expiracion: '2026-11-06', contratos: 2, prima: 2.40 },
      { broker: 'etrade', contrato: 'SPY|PUT|680|2026-11-06', symbol: 'SPY', direccion: 'PUT', strike: 680, expiracion: '2026-11-06', contratos: 9, prima: 9 },
      { broker: 'schwab', contrato: 'SPY|PUT|680|2026-11-06', symbol: 'SPY', direccion: 'PUT', strike: 680, expiracion: '2026-11-06', contratos: 1, prima: 1.90 }];
    const dA = B.calcDatosDeAbiertos('schwab|SPY|PUT|680|2026-11-06', ab);
    igual([dA.lotes, dA.contrato.broker, dA.origen], [[{ n: '2', p: '2.4' }, { n: '1', p: '1.9' }], 'schwab', 'libro de fills: 2 compras abiertas'], 'Diario: las compras vivas de ESE contrato y bróker (FIFO)');
    igual(B.calcDatosDeAbiertos('x|y', ab), null, 'un contrato que ya no está abierto → null');
  }
  {
    // el módulo REAL: los botones en Posiciones (Mac y teléfono) y la hoja que abren
    const mod = C.cargarModuloEntero({ hash: '#/copiloto' });
    assert(mod.cargo, 'el módulo entero carga', mod.error);
    if (mod.cargo) {
      const HOY = '2026-10-30';
      mod.win._cartCalc = { etrade: { estado: 'ok', ts: Date.now(), truncada: false, otros: {}, items: [AAPL] }, schwab: { estado: 'sin', items: [] }, tasty: { estado: 'sin_foto', items: [] }, moomoo: { estado: 'sin_foto', items: [] } };
      mod.ev('_posCalc = ' + JSON.stringify([T2, T1]));
      mod.win.innerWidth = 1200;
      const mac = mod.ev("seccionPosiciones(_posCalc, _cartCalc, PLANES.PLAN_10, '" + HOY + "')");
      assert(/<tr class="gdet">[\s\S]*?onclick="MZ\.calcDePosicion\(7\)"[^>]*>Calcular limit<\/button>/.test(mac) && /onclick="MZ\.calcDePosicion\(8\)"/.test(mac), 'Mac: «Calcular limit» en la fila de detalle de cada ficha');
      assert(/onclick="MZ\.calcDeBroker\('etrade\|AAPL\|CALL\|235\|2026-11-20'\)"[^>]*>Calcular limit<\/button><\/td><\/tr>/.test(mac), 'Mac: y en la fila de la AAPL sin registrar, junto a Adoptar');
      mod.win.innerWidth = 390;
      const tel = mod.ev("seccionPosiciones(_posCalc, _cartCalc, PLANES.PLAN_10, '" + HOY + "')");
      assert(/onclick="MZ\.calcDePosicion\(7\)" title="Calculadora de limit y stop con el costo de esta posición">Calcular limit<\/button><\/div>/.test(tel) && /MZ\.calcDePosicion\(8\)/.test(tel), 'teléfono: «Calcular limit» en la tarjeta de cada ficha');
      assert(/<button class="btnsec" onclick="MZ\.calcDeBroker\('etrade\|AAPL\|CALL\|235\|2026-11-20'\)"[^>]*>Calcular limit<\/button>/.test(tel), 'teléfono: y en la tarjeta SIN REGISTRAR');
      // tocar «Calcular limit» de la ficha 8: la hoja sale con las DOS fichas del contrato
      mod.ev('MZ.calcDePosicion(8)');
      igual(JSON.parse(mod.ev('JSON.stringify(_calc.lotes)')), [{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], 'tocar «Calcular limit» en la ficha de 3: la hoja trae las dos compras del contrato (1 a 1.21 + 3 a 0.29)');
      igual(mod.ev('calcTitulo(_calc.contrato)'), 'TSLA CALL 420 · vence 2026-11-20 · E*TRADE', 'y su contrato en el título');
      mod.ev("_calc.modo = 'usd'; _calc.usd = '4'");
      igual(mod.ev('JSON.stringify(calcLimitStop(calcEntrada(_calc)).limit)'), JSON.stringify({ precio: 0.55, crudo: 0.55, venta: 220, neta: 4, netaPct: 4 / 208 * 100 }), 'y con $4: limit 0.55 y $4.00 netos (la hoja 2 de Andrés)');
      mod.ev('Object.assign(_cart, window._cartCalc)');   // la cartera leída del bróker (la que busca buscarItemCartera)
      mod.ev("MZ.calcDeBroker('etrade|AAPL|CALL|235|2026-11-20')");
      igual([JSON.parse(mod.ev('JSON.stringify(_calc.lotes)')), mod.ev('_calc.origen')], [[{ n: '2', p: '1.323333' }], 'costo medio de E*TRADE'], 'la sin registrar: sus contratos y el costo medio del bróker');
      mod.ev('cerrarCalc()');
      const toasts = []; mod.win.__toasts = toasts; mod.ev('toast = (t) => window.__toasts.push(t)');
      mod.ev('MZ.calcDePosicion(999)'); mod.ev("MZ.calcDeBroker('nada')"); mod.ev("MZ.calcDeAbierto('nada')");
      igual([toasts.length, mod.ev('_calc')], [3, null], 'una posición que ya no está: lo dice y no abre nada');
      // Diario: el abierto del libro de fills
      const fills = [
        { broker: 'schwab', symbol: 'SPY', direccion: 'PUT', strike: 680, expiracion: '2026-11-06', lado: 'compra', contratos: 2, precio: 2.40, comision: 1.3, ejecutado_at: '2026-10-29T14:10:00Z', fecha_ny: '2026-10-29', clave_ext: 'a1' },
        { broker: 'schwab', symbol: 'SPY', direccion: 'PUT', strike: 680, expiracion: '2026-11-06', lado: 'compra', contratos: 1, precio: 1.90, comision: 0.65, ejecutado_at: '2026-10-30T15:10:00Z', fecha_ny: '2026-10-30', clave_ext: 'a2' },
        { broker: 'etrade', symbol: 'QQQ', direccion: 'CALL', strike: 600, expiracion: '2026-10-23', lado: 'compra', contratos: 1, precio: 1.00, ejecutado_at: '2026-10-20T14:10:00Z', fecha_ny: '2026-10-20', clave_ext: 'b1' }];
      mod.win.__fills = fills;
      mod.ev("_diario.abiertos = emparejarFillsFIFO(window.__fills, '" + HOY + "').abiertos");
      const hA = mod.ev('seccionAbiertosDiario(_diario.abiertos, [], [])');
      igual((hA.match(/onclick="MZ\.calcDeAbierto\('schwab\|SPY\|PUT\|680\|2026-11-06'\);return false"[^>]*>Calcular limit<\/a>/g) || []).length, 2, 'Diario: «Calcular limit» en cada compra abierta del contrato');
      assert(!/calcDeAbierto\('etrade\|QQQ/.test(hA), 'y no en un contrato ya vencido (no se puede vender)');
      mod.ev("MZ.calcDeAbierto('schwab|SPY|PUT|680|2026-11-06')");
      igual(JSON.parse(mod.ev('JSON.stringify(_calc.lotes)')), [{ n: '2', p: '2.4' }, { n: '1', p: '1.9' }], 'tocarlo abre la hoja con las dos compras vivas (2 a 2.40 + 1 a 1.90)');
      igual(mod.ev('calcLimitStop(calcEntrada(_calc)).medio.toFixed(4)'), '2.2333', 'costo medio 2.2333');
      assert(/_diario\.abiertos = F\.abiertos;/.test(C.extraer('vistaDiario')), 'vistaDiario deja a mano los abiertos que pintó');
    }
  }

  // ════════════════ 15. «Poner en la orden»: SOLO el precio, nada se envía ════════════════
  {
    // rev67: el MISMO contrato TSLA 420 ×4 en otra cuenta (una línea de moomoo) y en el libro de fills
    const MOO_T = { broker: 'moomoo', symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', contratos: 4, prima_fill: 0.80, clave: 'moomoo|TSLA|CALL|420|2026-11-20' };
    const ABIERTOS_T = [{ broker: 'etrade', contrato: 'TSLA|CALL|420|2026-11-20', symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', contratos: 4, prima: 0.52 }];
    const CAMPOS = { oSym: 'TSLA', oTipo: 'CALL', oAcc: 'venta', oStrike: '420', oExp: '2026-11-20', oQty: '4', oTerm: 'GTC', oPt: 'LIMIT', oPrecio: '0.34', oBroker: 'etrade', oGtcAuto: '' };
    const envio = { llamadas: [] };
    const espia = (n) => (...a) => { envio.llamadas.push(n); return Promise.resolve({}); };
    const repintes = [];
    function armarOrden(E) {
      E = E || {};
      const H = armarHoja({ mas: ['leerFormOrden', 'calcContrato', 'calcLote', 'calcDatosDePosicion', 'calcDatosDeItem', 'calcDeOrden', 'claveCartera',
        'calcDatosDeAbiertos', 'claveAbiertoCalc', 'calcHayOtroCuadro', 'calcDesdeLaPagina', 'calcDePosicion', 'calcDeBroker', 'calcDeAbierto'],
        prefijo: 'let _ord = null; let _gestor = { filas: [] }; let _cart = {};', sufijo: ' function __setOrd(o) { _ord = o; } function __setGestor(f) { _gestor.filas = f; } function __setCart(c) { _cart = c; }', extras: ['__setOrd', '__setGestor', '__setCart'],
        deps: { ajustarFormOrden: () => repintes.push('ajustar'), pintarAvisosOrden: () => repintes.push('avisos'), pintarTotalOrden: () => repintes.push('total'),
          itemsCartera: (c) => (c && c.etrade && c.etrade.items) || [], BROKER_NOMBRE: C.BROKER_NOMBRE,
          buscarItemCartera: (k) => [AAPL, MOO_T].find(it => it.clave === k) || null, _diario: { abiertos: ABIERTOS_T },
          ordenPreview: espia('ordenPreview'), ordenPlace: espia('ordenPlace'), ordenPreviewSchwab: espia('ordenPreviewSchwab'), ordenPlaceSchwab: espia('ordenPlaceSchwab'),
          etPost: espia('etPost'), swPost: espia('swPost'), abrirOrden: espia('abrirOrden'), construirOrden: espia('construirOrden'), construirOrdenSchwab: espia('construirOrdenSchwab'),
          sb: { from: espia('sb.from') }, ...(E.deps || {}) } });
      // la hoja de orden abierta, con sus campos
      const orden = H.D.crear(); orden.className = 'modal'; orden.id = 'modalOrden';
      const campos = Object.assign({}, CAMPOS, E.campos || {});
      orden.innerHTML = Object.keys(campos).concat(['oBtnPrev']).map(k => `<i id="${k}"></i>`).join('');
      H.D.cuerpo.push(orden);
      Object.keys(campos).forEach(k => { const n = C.nodo({ id: k, value: campos[k], disabled: !!(E.apagados || []).includes(k) }); n.focus = () => { H.D.doc.activeElement = n; }; H.D.nodos[k] = n; });
      H.D.nodos.oBtnPrev = C.nodo({ id: 'oBtnPrev', disabled: !!E.btnApagado });
      const ord = Object.assign({ broker: 'etrade', pre: { posicion_id: 8, broker: 'etrade', proposito: 'salida_gtc' } }, E.ord || {});
      H.M.__setOrd(ord);
      const foto = () => JSON.stringify(Object.keys(campos).map(k => [k, H.D.nodos[k].value]));
      return Object.assign(H, { ord, orden, foto });
    }
    const TSLA_C = { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' };
    const abrirTsla = (H) => { H.M.abrirCalc({ contrato: TSLA_C, lotes: [{ n: 1, p: 1.21 }, { n: 3, p: 0.29 }], origen: 'tu libro' }); H.M.calcModo('usd'); H.D.cuerpo.find(n => n.id === 'modalCalc').oyentes.input(ev('cObj', '4')); };
    {
      const H = armarOrden();
      abrirTsla(H);
      const antes = JSON.parse(H.foto());
      assert(/<button type="button" class="pri" onclick="MZ\.calcPonerEnOrden\(\)">Poner en la orden<\/button>/.test(H.D.nodos.cResLimit.innerHTML), 'con la hoja de venta Límite de ESTE contrato abierta debajo: «Poner en la orden»');
      assert(/la envías tú, con tu toque y tu PIN/.test(H.D.nodos.cResLimit.innerHTML), 'y dice que solo escribe el precio');
      igual(H.M.__calc().ordVista, H.ord, 'la calculadora anota a QUÉ hoja de orden se lo ofreció');
      repintes.length = 0;
      igual(H.M.calcPonerEnOrden(), true, 'tocar «Poner en la orden»…');
      const despues = JSON.parse(H.foto());
      igual(H.D.nodos.oPrecio.value, '0.55', '…escribe el limit (0.55) en el campo Límite');
      igual(despues.filter((x, i) => x[1] !== antes[i][1]).map(x => x[0]), ['oPrecio'], 'y SOLO ese campo cambia (ticker, tipo, acción, strike, vencimiento, cantidad, término, tipo de precio, bróker: igual)');
      igual(envio.llamadas, [], 'no llama a NINGUNA función de envío (ni vista previa, ni place, ni E*TRADE, ni Schwab, ni la base)');
      igual(repintes, ['ajustar', 'avisos', 'total'], 'repinta lo mismo que un tecleo en el campo (etiquetas, avisos de doctrina, total)');
      igual([H.D.cuerpo.map(n => n.id), H.M.__calc()], [['modalOrden'], null], 'la calculadora se cierra y la hoja de orden queda a la vista, sin enviar');
      igual(H.reg.toasts.pop(), 'Limit 0.55 puesto en la orden: revísala y envíala con tu toque y tu PIN.', 'y lo dice');
    }
    {
      // rev67 · el foco tras «Poner en la orden»: Mac → al campo Límite (de ahí se sigue a «Revisar»); teléfono → al enlace
      // de la orden que abrió la calculadora (un foco en el campo sacaría el teclado encima de la orden)
      const enlace = (H) => { const a = H.D.crear(); a.id = 'oCalcLnk'; return a; };
      const Hm = armarOrden({ deps: { window: { matchMedia: () => ({ matches: true }) } } });
      const am = enlace(Hm); am.focus();
      abrirTsla(Hm); Hm.D.$('#cObj').focus();   // con el teclado, el foco está en la calculadora al pulsar el botón
      igual([Hm.M.calcPonerEnOrden(), Hm.D.doc.activeElement === Hm.D.nodos.oPrecio], [true, true], 'Mac: el foco queda en el campo Límite con el 0.55 recién puesto, no en <body>');
      const Ht = armarOrden({ deps: { window: { matchMedia: () => ({ matches: false }) } } });
      const at = enlace(Ht); at.focus();
      abrirTsla(Ht); Ht.D.$('#cObj').focus();
      igual([Ht.M.calcPonerEnOrden(), Ht.D.doc.activeElement === at], [true, true], 'teléfono: vuelve al enlace «Calcular el limit…» de la orden (sin teclado encima)');
    }
    {
      // identidad: la hoja de orden cambió (otra del MISMO contrato) entre que se ofreció el botón y el toque
      const H = armarOrden();
      abrirTsla(H);
      const nueva = Object.assign({}, H.ord);
      H.M.__setOrd(nueva);
      igual(H.M.calcPonerEnOrden(), false, 'si la hoja de orden ya es OTRA (aunque del mismo contrato), no se toca');
      igual([H.D.nodos.oPrecio.value, envio.llamadas], ['0.34', []], 'el precio sigue como estaba y nada se envía');
      assert(/cambió mientras calculabas: no toqué nada/.test(H.reg.toasts.pop()), 'y lo dice');
      igual(H.D.cuerpo.some(n => n.id === 'modalCalc'), true, 'la calculadora sigue abierta (con el botón recalculado para la hoja nueva)');
      assert(H.M.__calc().ordVista === nueva, 'ahora se ofrece a la hoja nueva (y un segundo toque ya iría a ESA)');
      igual([H.M.calcPonerEnOrden(), H.D.nodos.oPrecio.value, envio.llamadas], [true, '0.55', []], 'el segundo toque, ya sobre la hoja nueva, sí pone el precio (y sigue sin enviar nada)');
    }
    const casos = [
      ['vista previa', { ord: { orden: { x: 1 }, previewIds: [{ previewId: 1 }] } }, 'bloqueada', /ya tiene vista previa: toca «Editar la orden»/, true],
      ['enviándose', { ord: { enviando: true } }, 'bloqueada', /se está enviando o espera la respuesta/, true],
      ['sin respuesta clara', { ord: { indeterminado: true } }, 'bloqueada', /se está enviando o espera la respuesta/, true],
      ['revisión en vuelo (botón apagado)', { btnApagado: true }, 'bloqueada', /esperando al bróker o no se puede enviar/, true],
      ['campo apagado', { apagados: ['oPrecio'] }, 'bloqueada', /esperando al bróker o no se puede enviar/, true],
      ['trailing', { campos: { oPt: 'TRAILING_STOP_PRCT', oPrecio: '20' } }, 'no_limit', /no es Límite: cámbiala a Límite/, true],
      ['una compra', { campos: { oAcc: 'compra' } }, 'compra', /es una compra: el limit de venta no va ahí/, false],
      ['otro strike', { campos: { oStrike: '425' } }, 'otra', /es de TSLA CALL 425, no de este contrato/, false],
      ['otro vencimiento', { campos: { oExp: '2026-11-27' } }, 'otra', /no de este contrato/, false],
      ['PUT', { campos: { oTipo: 'PUT' } }, 'otra', /TSLA PUT 420/, false],
      ['otro ticker', { campos: { oSym: 'NVDA' } }, 'otra', /NVDA CALL 420/, false],
      ['una acción', { campos: { oTipo: 'EQ' } }, 'otra', /TSLA \(acción\)/, false],
    ];
    casos.forEach(([nombre, E, estado, re, apagado]) => {
      const H = armarOrden(E);
      abrirTsla(H);
      const h = H.D.nodos.cResLimit.innerHTML, antes = H.foto();
      igual(H.M.estadoOrdenCalc(TSLA_C, H.M.ordenParaCalc()).estado, estado, nombre + ': estado «' + estado + '»');
      assert(!/MZ\.calcPonerEnOrden/.test(h) && re.test(h) && (apagado ? /class="pri" disabled[^>]*>Poner en la orden/.test(h) : !/Poner en la orden/.test(h)), nombre + ': ' + (apagado ? 'el botón sale APAGADO' : 'sin botón') + ' y se dice por qué', h);
      igual([H.M.calcPonerEnOrden(), H.foto(), envio.llamadas], [false, antes, []], nombre + ': un toque forzado no toca la orden ni envía nada');
    });
    {
      // rev67 · contratos «0.00001» con la orden abierta: antes «Poner en la orden» escribía «Infinity» en el input
      // type=number (que lo deja VACÍO); ahora no hay limit y no se escribe nada
      const H = armarOrden();
      H.M.abrirCalc({ contrato: TSLA_C, lotes: [{ n: '0.00001', p: '1' }] });
      const antes = H.foto();
      igual([H.M.calcPonerEnOrden(), H.foto(), H.reg.toasts.pop()], [false, antes, 'Todavía no hay limit calculado.'], 'contratos 0.00001: «Poner en la orden» no escribe nada en la orden y lo dice');
      await H.M.calcCopiar('limit');
      igual([H.reg.copias, H.reg.toasts.pop()], [[], 'Todavía no hay precio que copiar.'], 'ni «Copiar» copia nada');
      // y si algún día el cálculo devolviera un precio no finito, el toque tampoco lo escribe (ni lo copia)
      const D = domFalso(), reg = { toasts: [], copias: [] };
      const F = construir(['calcPonerEnOrden', 'calcCopiar', 'estadoOrdenCalc', 'claveContrato'], {
        $: D.$, toast: (t) => reg.toasts.push(t), navigator: { clipboard: { writeText: async (v) => { reg.copias.push(v); } } },
        calcResultado: () => ({ n: 4, limit: { precio: Infinity }, stop: { precio: NaN } }), ordenParaCalc: () => { throw new Error('no debería mirar la orden'); },
        ajustarFormOrden: () => {}, pintarAvisosOrden: () => {}, pintarTotalOrden: () => {}, pintarCalcRes: () => {}, cerrarCalc: () => {} },
        { prefijo: 'let _calc = { contrato: null, ordVista: null };', consts: ['BROKER_CORTO'] });
      igual([F.calcPonerEnOrden(), reg.toasts.pop()], [false, 'Todavía no hay limit calculado.'], 'limit Infinity: no se pone en la orden');
      await F.calcCopiar('limit'); await F.calcCopiar('stop');
      igual([reg.copias, reg.toasts], [[], ['Todavía no hay precio que copiar.', 'Todavía no hay precio que copiar.']], 'ni se copia (limit Infinity, stop NaN)');
    }
    {
      // rev67 · el BRÓKER también: el mismo contrato y la misma cantidad en otra cuenta no es «este contrato» (claveContrato no
      // lo lleva, y el limit saldría del costo de OTRA cuenta sin ningún aviso)
      const H = armarOrden();   // la venta Límite ×4 es de E*TRADE
      H.M.abrirCalc({ contrato: Object.assign({}, TSLA_C, { broker: 'moomoo' }), lotes: [{ n: 4, p: 0.80 }], origen: 'costo medio de moomoo' });
      const h = H.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML, antes = H.foto();
      igual(H.M.estadoOrdenCalc(H.M.__calc().contrato, H.M.ordenParaCalc()).estado, 'otra', 'una línea de moomoo frente a una venta de E*TRADE del MISMO contrato y cantidad: «otra», no «ok»');
      assert(!/Poner en la orden/.test(h) && /La orden abierta es de E\*TRADE y este contrato es de moomoo: no se toca\./.test(h) && !/Ojo: la orden es de/.test(h), 'sin botón, sin el aviso de cantidad (es la misma) y dice por qué', h);
      igual([H.M.__calc().ordVista, H.M.calcPonerEnOrden(), H.foto(), envio.llamadas], [null, false, antes, []], 'no se anota a qué orden se ofreció y un toque forzado no toca la orden ni envía nada');
      const Ht = armarOrden({ ord: { broker: 'tasty' } });
      Ht.M.abrirCalc({ contrato: TSLA_C, lotes: [{ n: 4, p: 0.52 }] });
      const ht = Ht.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML;
      assert(/La orden abierta es de tasty y este contrato es de E\*TRADE: no se toca\./.test(ht) && !/Poner en la orden/.test(ht), 'y al revés: fichas de E*TRADE frente a una orden de tasty');
      const Hn = armarOrden({ ord: { broker: undefined } });
      Hn.M.abrirCalc({ contrato: Object.assign({}, TSLA_C, { broker: null }), lotes: [{ n: 4, p: 0.52 }] });
      igual(Hn.M.estadoOrdenCalc(Hn.M.__calc().contrato, Hn.M.ordenParaCalc()).estado, 'ok', 'sin bróker en los dos lados es E*TRADE en los dos: «ok»');
    }
    {
      // rev67 · desde la página de DETRÁS no se abre encima de otro cuadro: ningún cuadro es inert y el Tab de la Mac llega al
      // «Calcular limit» de otra ficha con la hoja de orden abierta (la GTC de la ficha 7, ×1 a 1.21)
      const H = armarOrden({ campos: { oQty: '1', oPrecio: '1.35' }, ord: { pre: { posicion_id: 7, broker: 'etrade', proposito: 'salida_gtc' } } });
      H.M.__setGestor([T1, T2]);
      H.M.calcDePosicion(8);
      igual([H.M.__calc(), H.D.cuerpo.map(n => n.id)], [null, ['modalOrden']], '«Calcular limit» de la ficha 8 con la orden de la 7 abierta: la hoja NO se abre (ni encima ni con el medio 0.52 de las dos)');
      igual(H.reg.toasts.pop(), 'Hay otro cuadro abierto: ciérralo y vuelve a tocar «Calcular limit». No se abrió nada.', 'y lo dice');
      H.M.calcDeBroker(MOO_T.clave); H.M.calcDeAbierto('etrade|TSLA|CALL|420|2026-11-20');
      igual([H.M.__calc(), H.D.cuerpo.length, H.reg.toasts.length], [null, 1, 2], 'lo mismo desde la línea del bróker y desde el Diario');
      H.M.calcDeOrden();
      igual([H.M.__calc() && H.M.__calc().lotes, H.D.cuerpo.map(n => n.id)], [[{ n: '1', p: '1.21' }], ['modalOrden', 'modalCalc']], 'el enlace de la PROPIA orden sí la abre encima (con SU ficha: vende ×1)');
      assert(/MZ\.calcPonerEnOrden\(\)">Poner en la orden/.test(H.D.cuerpo[1].innerHTML), '(y ahí sí ofrece «Poner en la orden»)');
      H.M.calcDePosicion(8);
      igual(H.M.__calc().lotes, [{ n: '1', p: '1.21' }], 'con la calculadora ya abierta encima de la orden, el Tab al botón de detrás tampoco la cambia');
      H.orden.remove(); H.M.cerrarCalc();
      H.M.calcDePosicion(8);
      igual(H.M.__calc().lotes, [{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], 'sin cuadro abierto, «Calcular limit» abre como siempre (las dos fichas)');
      H.M.calcDeBroker(MOO_T.clave);
      igual([H.M.__calc().contrato.broker, H.D.cuerpo.filter(n => n.id === 'modalCalc').length], ['moomoo', 1], 'y con solo la calculadora abierta, otra la sustituye (nunca dos)');
      H.M.calcDeAbierto('etrade|TSLA|CALL|420|2026-11-20');
      igual(H.M.__calc().lotes, [{ n: '4', p: '0.52' }], '(también desde el Diario)');
    }
    {
      // sin hoja de orden: solo Copiar; y una orden cerrada entre el render y el toque
      const H = armarHoja({ deps: { BROKER_NOMBRE: C.BROKER_NOMBRE } });
      H.M.abrirCalc({ contrato: TSLA_C, lotes: [{ n: 4, p: 0.52 }] });
      assert(!/Poner en la orden/.test(H.D.nodos.cResLimit ? H.D.nodos.cResLimit.innerHTML : H.D.cuerpo[0].innerHTML), 'sin hoja de orden abierta: solo «Copiar»');
      igual(H.M.calcPonerEnOrden(), false, 'y un toque forzado no hace nada');
      const H2 = armarOrden();
      abrirTsla(H2);
      H2.orden.remove();
      igual([H2.M.calcPonerEnOrden(), envio.llamadas], [false, []], 'la orden se cerró antes del toque: no se toca nada');
      const H3 = armarOrden();
      H3.M.abrirCalc(null);
      igual(H3.M.estadoOrdenCalc(null, H3.M.ordenParaCalc()).estado, 'otra', 'abierta a mano (sin contrato) con una orden debajo: no es «este contrato»');
      const H4 = armarOrden();
      H4.M.abrirCalc({ contrato: TSLA_C, lotes: [{ n: '', p: '' }] });
      igual([H4.M.calcPonerEnOrden(), H4.D.nodos.oPrecio.value], [false, '0.34'], 'sin limit calculado no se pone nada');
      igual(H4.reg.toasts.pop(), 'Todavía no hay limit calculado.', 'y lo dice');
    }
    {
      // calcDeOrden: desde la hoja de una venta, ya llena
      const H = armarOrden();
      H.M.__setGestor([T1, T2, OTRA]);
      H.M.calcDeOrden();
      igual([H.M.__calc().lotes, H.M.__calc().contrato.strike], [[{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], 420], 'desde la orden de salida de una ficha: las fichas del contrato (la de la orden y su hermana)');
      assert(/<button type="button" class="pri" onclick="MZ\.calcPonerEnOrden\(\)">Poner en la orden/.test(H.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML), 'y ofrece «Poner en la orden» a esa misma hoja');
      igual(H.M.__calc().ordVista, H.ord, '(anotada como la hoja a la que se ofreció)');
      assert(!/Ojo: la orden es de/.test(H.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML), 'la orden vende ×4 y se calculan ×4: sin aviso');
      // la GTC de UNA ficha (×3, la de 0.29): el costo es el de esa ficha, no el medio de las dos
      const Hs = armarOrden({ campos: { oQty: '3' } });
      Hs.M.__setGestor([T1, T2]);
      Hs.M.calcDeOrden();
      igual([Hs.M.__calc().lotes, Hs.M.__calc().origen], [[{ n: '3', p: '0.29' }], 'tu libro'], 'la orden vende ×3 = SU ficha: solo esa ficha (venderla al limit del medio de las dos sería vender con pérdida)');
      const Hq = armarOrden({ campos: { oQty: '2' } });
      Hq.M.__setGestor([T1, T2]);
      Hq.M.calcDeOrden();
      igual(Hq.M.__calc().lotes.length, 2, 'la orden vende ×2 (ni su ficha ni el total): las dos fichas…');
      assert(/Ojo: la orden es de ×2 y aquí calculas ×4 \(con su costo medio\): revisa las compras o la cantidad de la orden\./.test(Hq.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML), '…y la hoja AVISA que la orden es de ×2 y se calculan ×4 (sin bloquear: una venta parcial vale)');
      assert(/MZ\.calcPonerEnOrden\(\)">Poner en la orden/.test(Hq.D.cuerpo.find(n => n.id === 'modalCalc').innerHTML), '(el botón sigue ahí)');
      const Hb = armarOrden({ ord: { pre: {} }, campos: { oSym: 'AAPL', oStrike: '235', oExp: '2026-11-20', oQty: '2' } });
      Hb.M.__setCart({ etrade: { items: [AAPL] } });
      Hb.M.calcDeOrden();
      igual([Hb.M.__calc().lotes, Hb.M.__calc().origen], [[{ n: '2', p: '1.323333' }], 'costo medio de E*TRADE'], 'una venta sin ficha: el costo medio que da el bróker de ese contrato');
      const Hc = armarOrden({ ord: { pre: {} }, campos: { oSym: 'NVDA', oStrike: '190', oQty: '3' } });
      Hc.M.calcDeOrden();
      igual([Hc.M.__calc().lotes, Hc.M.__calc().origen], [[{ n: '3', p: '' }], 'la orden abierta: pon la prima que pagaste'], 'sin ficha ni bróker: la cantidad de la orden y la prima por poner');
      const Hd = armarOrden({ campos: { oStrike: '425' } });
      Hd.M.__setGestor([T1, T2]);
      Hd.M.calcDeOrden();
      igual([Hd.M.__calc().contrato.strike, Hd.M.__calc().lotes], [425, [{ n: '4', p: '' }]], 'si el formulario ya no es el contrato de su ficha, manda lo que dice la hoja (no las fichas de otro strike)');
      const He = armarOrden({ campos: { oTipo: 'EQ' } });
      He.M.calcDeOrden();
      igual([He.M.__calc(), He.reg.toasts.pop()], [null, 'La calculadora es para opciones (×100 por contrato).'], 'una orden de ACCIONES: no abre (la calculadora es ×100)');
    }
    {
      // el enlace en la hoja de orden y cuándo se ve
      const ab = C.extraer('abrirOrden');
      assert(/<div id="oCalcWrap" class="fresco"[^>]*><a href="#" class="lnk" onclick="MZ\.calcDeOrden\(\);return false">Calcular el limit con tu costo y tu objetivo<\/a><\/div>/.test(ab), 'la hoja de orden lleva «Calcular el limit con tu costo y tu objetivo» bajo el precio');
      const vis = (tipo, acc) => {
        const n = {}; const reg = [];
        ['oTipo', 'oAcc', 'oPt', 'oPrecioWrap', 'oPrecioLbl', 'oOptn', 'oGtcAutoWrap', 'oCalcWrap'].forEach(k => { n[k] = C.nodo({ id: k }); n[k].classList = { toggle: (c, on) => reg.push([k, c, on]) }; });
        n.oTipo.value = tipo; n.oAcc.value = acc; n.oPt.value = 'LIMIT'; n.oPt.options = [];
        construir(['ajustarFormOrden'], { $: (s) => n[s.slice(1)] || null }).ajustarFormOrden();
        return reg.filter(r => r[0] === 'oCalcWrap').map(r => r[2]);
      };
      igual([vis('CALL', 'venta'), vis('PUT', 'venta'), vis('CALL', 'compra'), vis('EQ', 'venta')], [[false], [false], [true], [true]], 'se ve solo al VENDER una opción (CALL o PUT); en una compra o con acciones se oculta');
    }
    {
      // doctrina en el fuente: el camino de la calculadora no arma ni envía órdenes
      const nombres = ['calcLimitStop', 'calcArriba', 'calcNum', 'calcPrefsNormalizar', 'calcPrefsLeer', 'calcPrefsGuardar', 'calcEntrada', 'calcTitulo', 'calcLotesHtml', 'calcResumenHtml', 'calcLotesPartidos', 'calcChipsHtml',
        'calcObjetivoHtml', 'calcTickHtml', 'calcFeeNota', 'calcFaltaTxt', 'calcCifrasHtml', 'calcLimitHtml', 'calcStopHtml', 'calcFormulaHtml', 'calcHojaHtml', 'calcResultado', 'calcDestino', 'pintarCalcRes',
        'abrirCalc', 'cerrarCalc', 'calcTecla', 'calcManualAnotar', 'calcInput', 'calcLoteMas', 'calcLoteQuitar', 'calcModo', 'calcTick', 'calcChip', 'calcCopiar', 'calcContrato', 'calcLote',
        'calcDatosDePosicion', 'calcDatosDeItem', 'calcDatosDeAbiertos', 'claveAbiertoCalc', 'calcHayOtroCuadro', 'calcDesdeLaPagina', 'calcDePosicion', 'calcDeBroker', 'calcDeAbierto', 'ordenParaCalc', 'estadoOrdenCalc', 'calcPonerEnOrden', 'calcDeOrden'];
      const todo = nombres.map(C.extraer).join('\n');
      ['ordenPreview', 'ordenPlace', 'etPost', 'swPost', 'abrirOrden', 'construirOrden', 'preSalida', '/etrade/', '/schwab/', 'cancelarOrden', 'cortarPosicion', 'venderGestor', 'armar(', 'pedirPin', 'unlock']
        .forEach(t => assert(!todo.includes(t), 'la calculadora no toca «' + t + '»: nada arma ni envía órdenes'));
      igual((todo.match(/\.(insert|update|upsert|delete)\(/g) || []), [], 'ni escribe en la base');
      assert(!/sb\.from|fetch\(/.test(todo), 'ni la lee: todo sale de lo que la app ya tiene en memoria');
      assert(!/\bconfirm\(|\bprompt\(|\balert\(/.test(todo), 'sin confirm(), prompt() ni alert()');
      const pon = C.extraer('calcPonerEnOrden');
      igual((pon.match(/\.value = /g) || []).length, 1, 'calcPonerEnOrden escribe UN valor…');
      assert(/const el = \$\('#oPrecio'\);/.test(pon) && /el\.value = v;/.test(pon), '…el del campo Límite (#oPrecio)');
      assert(/o\.ord !== visto/.test(pon) && /d\.estado !== 'ok'/.test(pon), 'y antes comprueba que la hoja sea la MISMA a la que se ofreció y que siga siendo venta Límite de este contrato');
    }
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
