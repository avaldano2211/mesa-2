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

// ════════════════ 10. lo que se recuerda en este equipo (mz_calc) ════════════════
const BASE_CALC = ['calcLimitStop', 'calcArriba', 'calcNum', 'calcEntrada', 'calcPrefsNormalizar', 'calcPrefsLeer', 'calcPrefsGuardar'];
const VISTA_CALC = ['calcHojaHtml', 'calcLotesHtml', 'calcResumenHtml', 'calcChipsHtml', 'calcObjetivoHtml', 'calcTickHtml', 'calcFeeNota', 'calcFaltaTxt',
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
  assert(/class="cquitar" onclick="MZ\.calcLoteQuitar\(0\)" aria-label="Quitar la compra 1" disabled>/.test(h0), 'la única compra no se puede quitar');
  [[{ n: '0', p: '1' }], [{ n: '-2', p: '0.5' }], [{ n: '2', p: '-1' }], [{ n: 'x', p: 'y' }], [], null].forEach(l => {
    const h = hoja(st({ lotes: l }));
    assert(!SUCIO.test(h) && /<div class="cprecio">—<\/div>/.test(h), 'compras ' + JSON.stringify(l) + ': «—» y sin NaN en pantalla');
  });
  ['', '-1', 'abc'].forEach(o => assert(!SUCIO.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: o }))) && /Pon cuánto quieres ganar/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: o }))), 'objetivo ' + JSON.stringify(o) + ': sin limit, dice qué falta, sin NaN'));
  const hFee = hoja(st({ lotes: [{ n: '1', p: '2.40' }], fee: '' }));
  assert(!SUCIO.test(hFee) && (hFee.match(/Pon la comisión \(0 si tu bróker no cobra\)/g) || []).length === 2 && /Pon la comisión por contrato, en prima/.test(hFee), 'sin comisión: limit y stop piden la comisión y la nota también');
  assert(/Pon un % de pérdida entre 0 y 99/.test(hoja(st({ lotes: [{ n: '1', p: '2.40' }], stop: '100' }))), 'stop del 100 %: lo dice');

  // con datos: TSLA 420, objetivo $4
  const c = { symbol: 'TSLA', direccion: 'CALL', strike: 420, expiracion: '2026-11-20', broker: 'etrade' };
  const s1 = st({ lotes: [{ n: '1', p: '1.21' }, { n: '3', p: '0.29' }], contrato: c, origen: 'tu libro: 2 fichas de este contrato', modo: 'usd', usd: '4' });
  const h1 = hoja(s1);
  assert(!SUCIO.test(h1), 'con datos: nada de NaN');
  assert(/<b class="mono" style="color:var\(--tx\)">TSLA CALL 420 · vence 2026-11-20 · E\*TRADE<\/b> · <span class="fresco">tu libro: 2 fichas de este contrato<\/span>/.test(h1), 'el contrato en el título y de dónde salió');
  assert(/<b class="mono">4<\/b> contratos · costo medio <b class="mono">0\.52<\/b> \(\$52\.00 por contrato\) · pagaste <b class="mono">\$208\.00<\/b>/.test(h1), 'resumen: 4 contratos, costo medio 0.52 ($52.00) y $208.00 pagados (las cifras en mono)');
  assert(/<div class="cprecio" id="cLimit">0\.55<small>= \$55\.00 por contrato<\/small><\/div>/.test(h1), 'el LIMIT grande: 0.55 = $55.00 por contrato');
  assert(/<span>Cobras<\/span><b>\$220\.00<\/b><\/div><div><span>Comisiones<\/span><b>\$8\.00<\/b><\/div><div><span>Ganancia neta<\/span><b style="color:var\(--verde\)">\+\$4\.00<\/b><i style="color:var\(--verde\)">\+1\.92 %<\/i>/.test(h1), 'cobras $220.00 · comisiones $8.00 · ganancia neta +$4.00 y +1.92 % debajo (en verde)');
  assert(/<div class="cprecio" id="cStopP">0\.42<small>= \$42\.00 por contrato<\/small>/.test(h1) && /Pérdida neta<\/span><b style="color:var\(--rojo\)">-\$48\.00<\/b><i style="color:var\(--rojo\)">-23\.08 %<\/i>/.test(h1), 'el STOP: 0.42 y su pérdida neta con comisiones (-$48.00, en rojo)');
  assert(/onclick="MZ\.calcCopiar\('limit'\)">Copiar<\/button>/.test(h1) && /onclick="MZ\.calcCopiar\('stop'\)">Copiar<\/button>/.test(h1), '«Copiar» en el limit y en el stop');
  assert(!/Poner en la orden/.test(h1), 'sin hoja de orden abierta: solo «Copiar»');
  assert(/costo medio 0\.52  \(\$208\.00 ÷ 4 ÷ 100\)\n\+ objetivo  0\.01  \(\$4\.00 ÷ 4 ÷ 100\)\n\+ comisión  0\.02  \(compra \+ venta\)\n= 0\.55 → limit 0\.55 \(arriba a 1¢\)\nstop 0\.52 × \(1 − 20 %\) = 0\.416 → 0\.42/.test(h1), 'la cuenta paso a paso, como en su Excel', h1.split('cFormula">')[1]);
  assert(/value="1\.21"/.test(h1) && /value="0\.29"/.test(h1) && /id="cN1" data-c="n" data-i="1"[^>]*value="3"/.test(h1), 'las dos compras en sus campos');
  assert(/onclick="MZ\.calcLoteQuitar\(1\)" aria-label="Quitar la compra 2">/.test(h1), 'con dos compras sí se puede quitar una');
  assert(/<button type="button" class="">%<\/button><button type="button" class="on">\$ total<\/button>/.test(h1.replace(/ onclick="[^"]*"/g, '')) && /id="cObj"[^>]*value="4"/.test(h1), 'el modo $ marcado y el objetivo 4');
  assert(/Ganancia NETA en dólares, sumando todos los contratos/.test(h1), 'y dice que es neta y de todos los contratos');
  // con el 12 % y la comisión de su Excel
  const h2 = hoja(st({ lotes: [{ n: '1', p: '2.40' }], pct: '12', fee: '0.01' }));
  assert(/id="cLimit">2\.70</.test(h2) && /\+\$29\.00<\/b><i[^>]*>\+12\.08 %/.test(h2) && /id="cStopP">1\.92</.test(h2), 'hoja 1: 2.70 (+$29.00 · +12.08 %) y stop 1.92');
  assert(/0\.01 de prima por contrato = \$0\.50 al comprar \+ \$0\.50 al vender\./.test(h2), 'la nota de la comisión en dólares');
  assert(/12 % de 2\.40/.test(h2), 'la fórmula del % dice de qué');
  assert(/<button type="button" class="chip2 on" onclick="MZ\.calcChip\(12\)">12%<\/button>/.test(h2) && (h2.match(/chip2 on/g) || []).length === 1, 'el chip del 12 % encendido (y solo ese)');
  assert(/<button type="button" class="on" onclick="MZ\.calcTick\(0\.01\)">1¢<\/button><button type="button" class="" onclick="MZ\.calcTick\(0\.05\)">5¢<\/button>/.test(h2), 'el incremento: 1¢ marcado, 5¢ a un toque');
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
  const crear = () => {
    const n = C.nodo({ style: {}, oyentes: {}, id: '' });
    n.addEventListener = (t, f) => { n.oyentes[t] = f; };
    n.remove = () => { const i = cuerpo.indexOf(n); if (i >= 0) cuerpo.splice(i, 1); };
    return n;
  };
  const doc = {
    createElement: crear,
    body: { appendChild: (n) => { cuerpo.push(n); } },
    addEventListener: (t, f) => { escuchas.push([t, f]); },
    querySelector: (s) => {
      if (s === '.modal') return cuerpo.find(n => /(^| )modal( |$)/.test(n.className)) || null;
      const m = /^#([\w-]+)$/.exec(s); if (!m) return null;
      const arriba = cuerpo.find(n => n.id === m[1]); if (arriba) return arriba;
      const dentro = cuerpo.find(n => String(n.innerHTML).includes('id="' + m[1] + '"'));
      return dentro ? (nodos[m[1]] || (nodos[m[1]] = C.nodo({ id: m[1] }))) : null;
    },
  };
  return { doc, cuerpo, nodos, escuchas, $: (s) => doc.querySelector(s), crear };
}
const DOM_CALC = ['abrirCalc', 'cerrarCalc', 'calcTecla', 'calcInput', 'calcManualAnotar', 'calcLoteMas', 'calcLoteQuitar', 'calcModo', 'calcTick', 'calcChip', 'calcCopiar',
  'pintarCalcRes', 'calcResultado', 'calcDestino'];
function armarHoja(E) {
  E = E || {};
  const D = domFalso(), ls = E.ls || C.localStorageFalso(), reg = { toasts: [], timers: [], copias: [] };
  const win = {};
  const deps = Object.assign({ $: D.$, document: D.doc, window: win, localStorage: ls, esc: C.esc, colUtil: C.colUtil,
    toast: (t) => reg.toasts.push(t), setTimeout: (f, ms) => { reg.timers.push({ f, ms }); return 0; },
    navigator: { clipboard: { writeText: async (v) => { if (E.sinPortapapeles) throw new Error('no'); reg.copias.push(v); } } } }, E.deps || {});
  const M = construir(DOM_CALC.concat(BASE_CALC, VISTA_CALC, E.mas || []), deps,
    { consts: CONSTS_CALC.concat(['_calc', '_calcManual'], E.consts || []), prefijo: E.prefijo || '', sufijo: 'function __calc() { return _calc; } function __manual() { return _calcManual; }' + (E.sufijo || ''), extras: ['__calc', '__manual'].concat(E.extras || []) });
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
    assert(/<div class="hoja calc">/.test(m.innerHTML) && /Calculadora de limit y stop/.test(m.innerHTML), 'con la hoja de la calculadora dentro');
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
    igual(reg.timers.length, 1, 'ya llena no salta el teclado (no se enfoca nada)');
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
    const reg = { timers: [], reloads: 0 };
    const R = construir(['recargarSiSePuede'], { document: D.doc, _corte: { enCurso: false }, toast: () => {}, setTimeout: (f, ms) => { reg.timers.push(ms); }, location: { reload: () => reg.reloads++ } }, { prefijo: 'let _versionPendiente = 66;' });
    R.recargarSiSePuede();
    igual([reg.reloads, reg.timers], [0, [15000]], 'una versión nueva NO recarga con la calculadora abierta: espera 15 s');
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
      const puertas = ['calcAbrir', 'calcCerrar', 'calcLoteMas', 'calcLoteQuitar', 'calcModo', 'calcTick', 'calcChip', 'calcCopiar'];
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
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
