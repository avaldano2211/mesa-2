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

C.resumen();
