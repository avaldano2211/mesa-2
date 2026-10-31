#!/usr/bin/env node
/* v66 · A3 «Schwab >venc con T20:00Z» (spec68, 2026-10-31). Schwab no emite nada al vencer: la app DEDUCE el vencimiento
   (emparejarFillsSchwab) y escribe una fila «>venc» en broker_trades. Hasta la v65 rev6 se escribía con cerrada_at =
   exp + T20:00Z (16:00 ET en verano, 15:00 ET en invierno) y la clave_ext no lleva la hora: el upsert (ignoreDuplicates)
   nunca la reescribe. La de E*TRADE ya se relee a las 16:30 NY (instanteVencimiento, en filasEtradeVigentes); la de Schwab
   no. Ahora filasSchwabVencimiento (en unirOperaciones) la relee igual, sin tocar la base:
     1. filasSchwabVencimiento: verano (20:00Z → 20:30Z) e invierno (20:00Z → 21:30Z), la clave sin expiración, lo que NO
        toca (otros brókers, una venta real, una fecha mala, la ya leída), sin mutar y leyendo dos veces
     2. Cuentas: invierno con una venta a las 15:30 ET y el resto vencido → «venció en parte (presunto)», no «15:30»;
        verano con una venta 0DTE a las 16:10 ET → lo mismo; todo vencido → «expiró (presunto)» en su día
     3. lo que se escribe hoy (emparejarFillsSchwab) y lo que se relee de lo viejo dan el MISMO instante
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Las de Cuentas se construyen con la lista de
   test_cuentas.js (filtrada a las que existen): contra un main.js SIN el arreglo (la v65) la suite corre y FALLA por lo
   que pinta («15:30 · $2.00» en vez de «venció en parte»).
   Uso: node test_schwab_venc.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_schwab_venc.js');
const { FUENTE, assert, igual, construir, extraer, ymdNY } = C;

// Las funciones de Cuentas: la MISMA lista que test_cuentas.js (NOMBRES / CONSTS), solo las que existen en este fuente.
const TC = fs.readFileSync(path.join(__dirname, 'test_cuentas.js'), 'utf8');
const lista = (nombre) => eval(new RegExp('const ' + nombre + ' = (\\[[\\s\\S]*?\\]);').exec(TC)[1]);
const exF = (n) => new RegExp('^(?:async )?function ' + n + '\\s*\\(', 'm').test(FUENTE);
const exC = (n) => new RegExp('^(?:const|let|var) ' + n + '\\s*=', 'm').test(FUENTE);
const NOMBRES = lista('NOMBRES').concat(['filasSchwabVencimiento', 'emparejarFillsSchwab', 'desOsi', 'hoyNY']).filter((n, i, a) => exF(n) && a.indexOf(n) === i);
const K = construir(NOMBRES, { ymdNY, $: () => null, anchoVista: () => 1400 },
  { consts: lista('CONSTS').filter(exC), prefijo: 'let _cuentasVista = "cuentas";' });
const HAY = typeof K.filasSchwabVencimiento === 'function';
if (!HAY) C.falla('no existe function filasSchwabVencimiento en el fuente (la relectura de la «>venc» de Schwab)');
const leer = HAY ? K.filasSchwabVencimiento : (x) => x;

// Una fila «>venc» de Schwab como la escribía la v65 hasta la rev6 (forma de emparejarFillsSchwab; contrato inventado)
const NOTA = 'venció sin venderse (A2): pérdida total PRESUNTA';
function venc(exp, contratos, prima, abre, extra) {
  const osi = 'SPY   ' + exp.slice(2).replace(/-/g, '') + 'P00600000';
  return Object.assign({ id: 900 + Number(abre), broker: 'schwab', symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: exp, contratos, prima_fill: prima, prima_salida: 0,
    abierta_at: exp + 'T17:00:00+00:00', cerrada_at: exp + 'T20:00:00+00:00', resultado_usd: Math.round(-prima * contratos * 100 * 100) / 100, fees: 0,
    clave_ext: `${osi}#${abre}>venc${exp}`, raw: { abre, cierra: 'vencimiento', nota: NOTA } }, extra || {});
}
function venta(exp, contratos, prima, salida, abre, cierra, cerradaAt) {
  const osi = 'SPY   ' + exp.slice(2).replace(/-/g, '') + 'P00600000';
  return { id: 800 + Number(cierra), broker: 'schwab', symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: exp, contratos, prima_fill: prima, prima_salida: salida,
    abierta_at: exp + 'T17:00:00+00:00', cerrada_at: cerradaAt, resultado_usd: Math.round((salida - prima) * contratos * 100 * 100) / 100, fees: 0,
    clave_ext: `${osi}#${abre}>${cierra}#${contratos}`, raw: { abre, cierra } };
}

// ════════════════ 1. filasSchwabVencimiento ════════════════
{
  const ver = venc('2026-09-18', 2, 1.5, 11), inv = venc('2026-12-18', 2, 1.5, 12);
  const r = leer([ver, inv]);
  igual(r.map(t => t.cerrada_at), ['2026-09-18T20:30:00.000Z', '2026-12-18T21:30:00.000Z'],
    'VERANO (EDT): 20:00Z (16:00 ET) → 20:30Z (16:30 ET) · INVIERNO (EST): 20:00Z (15:00 ET) → 21:30Z (16:30 ET), con el horario de NY de ese día');
  igual(r.map(t => ymdNY(t.cerrada_at)), ['2026-09-18', '2026-12-18'], 'el día NY sigue siendo el de la expiración');
  igual([ver.cerrada_at, inv.cerrada_at], ['2026-09-18T20:00:00+00:00', '2026-12-18T20:00:00+00:00'], 'las filas originales no se mutan (la base no se toca: copias)');
  igual(r.map(t => [t.clave_ext, t.raw.cierra, t.raw.nota, t.resultado_usd]), [[ver.clave_ext, 'vencimiento', NOTA, -300], [inv.clave_ext, 'vencimiento', NOTA, -300]], 'la clave, la marca de vencimiento, la nota de presunta y el $ se quedan como están');
  assert(r.every(t => K.filaVencioCuentas(t) && K.filaPresuntaCuentas(t)), 'filaVencioCuentas y filaPresuntaCuentas la siguen reconociendo');
  // el lunes 2-nov-2026 (primer día de EST tras el cambio del domingo 1-nov) y un viernes de marzo antes del cambio del 8-mar
  igual(leer([venc('2026-11-02', 1, 1, 13), venc('2026-03-06', 1, 1, 14), venc('2026-03-13', 1, 1, 15)]).map(t => t.cerrada_at),
    ['2026-11-02T21:30:00.000Z', '2026-03-06T21:30:00.000Z', '2026-03-13T20:30:00.000Z'], 'alrededor de los cambios de hora: 2-nov EST, 6-mar EST, 13-mar EDT');
  const sinExp = venc('2026-12-18', 1, 1, 16, { expiracion: null });
  igual(leer([sinExp])[0].cerrada_at, '2026-12-18T21:30:00.000Z', 'sin expiración en la fila, la fecha sale de la clave (…>venc2026-12-18)');
  const soloRaw = venc('2026-12-18', 1, 1, 17, { clave_ext: 'otra-clave' });
  igual(leer([soloRaw])[0].cerrada_at, '2026-12-18T21:30:00.000Z', 'una fila de Schwab marcada raw.cierra «vencimiento» con otra clave también');
  const ya = venc('2026-12-18', 1, 1, 18, { cerrada_at: '2026-12-18T21:30:00+00:00' });
  const arrYa = [ya];
  assert(leer(arrYa) === arrYa, 'la que ya está en su instante (aunque en otro formato, +00:00) no se toca: el MISMO arreglo (nadie redibuja por nada)');
  const una = leer([inv]);
  assert(leer(una) === una, 'leer dos veces no cambia nada');
  const noToca = [
    ['una venta real de Schwab (aunque sea 0DTE)', venta('2026-12-18', 1, 1.5, 2, 12, 77, '2026-12-18T20:30:00+00:00')],
    ['una fila de E*TRADE', { ...inv, broker: 'etrade' }],
    ['una fila de tasty', { ...inv, broker: 'tasty' }],
    ['una de moomoo', { ...inv, broker: 'moomoo' }],
    ['una expiración que no es fecha (ni en la fila ni en la clave)', { ...inv, expiracion: '2026-02-30', clave_ext: 'SPY#12>venc2026-02-30' }],
    ['un null', null],
  ];
  for (const [nombre, t] of noToca) { const arr = [t]; assert(leer(arr) === arr, 'NO toca: ' + nombre); }
  igual([leer(null), leer(undefined)], [null, undefined], 'sin filas no revienta');
}

// ════════════════ 2. Cuentas: «venció en parte (presunto)» y «expiró (presunto)» ════════════════
{
  // INVIERNO · vie 18-dic-2026 (EST): compra 3 (12:00 ET), vende 1 a las 15:30 ET (20:30Z), vencen 2 (la «>venc» de la v65 a 20:00Z = 15:00 ET)
  const W = [venta('2026-12-18', 1, 1.5, 2, 21, 77, '2026-12-18T20:30:00+00:00'), venc('2026-12-18', 2, 1.5, 21)];
  const opW = K.unirOperaciones([], W).ops;
  igual([opW.length, opW[0] && opW[0].contratos, opW[0] && opW[0].resultado_usd], [1, 3, -250], 'invierno: UNA operación ×3 −$250 (+$50 vendido, −$300 vencido): el $ no cambia');
  const dW = K.detalleOpCuentas(opW[0], { fills: [], senales: [] });
  igual(opW[0].cerrada_at, '2026-12-18T21:30:00.000Z', 'invierno: el cierre del grupo es el vencimiento a las 16:30 ET (21:30Z), DESPUÉS de la venta de las 15:30 (antes: la venta)');
  igual([dW.expirada, dW.vencioEnParte, dW.presunta], [false, true, true], 'invierno: vendida en parte, venció en parte y presunta (Schwab no reporta el vencimiento)');
  igual([K.salidaOpCuentas(opW[0], dW, false), K.salidaOpCuentas(opW[0], dW, true)],
    ['<span style="color:var(--oro)">venció en parte</span> <span class="fresco">(presunto)</span> · $0.67', '<span style="color:var(--oro)">venció</span><span class="csub">en parte · presunto · $0.67</span>'],
    'invierno: Cuentas dice «venció en parte (presunto)» con la prima media, NO «15:30 · $0.67» (la hora de la venta como si fuera la salida)');
  igual(K.duracionOpCuentas(opW[0], dW), 'venció el mismo día', 'invierno: la duración en días hasta el vencimiento, como una expirada');
  const tW = K.tarjetaHistorial(opW[0], {}), fW = K.filaHistorialCuentas(opW[0], {});
  assert(/venció en parte/.test(tW) && /en parte · presunto/.test(fW) && !/21:30|16:30|15:00/.test(tW + fW), 'invierno: la tarjeta y la fila de la tabla lo dicen igual y no enseñan una hora de vencimiento inventada');
  assert(/15:30/.test(K.tramosOpCuentasHtml(opW[0], dW)) && /expiró \(presunto\)/.test(K.tramosOpCuentasHtml(opW[0], dW)), 'invierno: en el desglose, la venta con su hora (15:30) y el tramo vencido «expiró (presunto)»');

  // VERANO · vie 18-sep-2026 (EDT): compra 3, vende 1 a las 16:10 ET (20:10Z: SPY cotiza hasta las 16:15), vencen 2 (a 20:00Z = 16:00 ET)
  const S = [venta('2026-09-18', 1, 1.5, 2, 31, 78, '2026-09-18T20:10:00+00:00'), venc('2026-09-18', 2, 1.5, 31)];
  const opS = K.unirOperaciones([], S).ops[0], dS = K.detalleOpCuentas(opS, { fills: [], senales: [] });
  igual([opS.cerrada_at, dS.vencioEnParte, dS.presunta], ['2026-09-18T20:30:00.000Z', true, true], 'verano: con una venta 0DTE a las 16:10 ET el vencimiento (16:30 ET) sigue siendo el último cierre: «venció en parte (presunto)»');
  assert(/venció en parte/.test(K.salidaOpCuentas(opS, dS, false)) && !/16:10/.test(K.salidaOpCuentas(opS, dS, false)), 'verano: la salida no es «16:10»');

  // todo vencido: «expiró (presunto)» y en el día de la expiración (como antes: no cambia de día ni de $)
  const T = [venc('2026-12-18', 2, 1.5, 41)];
  const opT = K.unirOperaciones([], T).ops[0], dT = K.detalleOpCuentas(opT, { fills: [], senales: [] });
  igual([dT.expirada, dT.presunta, K.salidaOpCuentas(opT, dT, false), ymdNY(opT.cerrada_at), opT.resultado_usd],
    [true, true, '<span style="color:var(--oro)">expiró</span> <span class="fresco">(presunto)</span>', '2026-12-18', -300], 'todo vencido: «expiró (presunto)», el día de la expiración y −$300');
  // una venta normal de Schwab no cambia
  const opN = K.unirOperaciones([], [venta('2026-12-18', 1, 1.5, 2, 51, 79, '2026-12-18T20:30:00+00:00')]).ops[0], dN = K.detalleOpCuentas(opN, {});
  igual([dN.vencioEnParte, K.salidaOpCuentas(opN, dN, false)], [false, '15:30 · $2.00'], 'una operación de Schwab vendida entera sigue con su hora de salida');
  assert(/filasSchwabVencimiento\(filasMoomooVencimiento\(filasEtradeVigentes\(/.test(extraer('unirOperaciones')), 'unirOperaciones lee SIEMPRE la «>venc» de Schwab con filasSchwabVencimiento (Cuentas, Disciplina, los cupos y el Informe cuentan lo mismo)');
}

// ════════════════ 3. lo que se escribe hoy = lo que se relee de lo viejo ════════════════
if (typeof K.emparejarFillsSchwab === 'function') {
  for (const exp of ['2026-09-18', '2026-12-18']) {
    const osi = 'SPY   ' + exp.slice(2).replace(/-/g, '') + 'P00600000';
    const fills = [{ id: 'c1', side: 'BUY', osi, symbol: 'SPY', direccion: 'PUT', strike: 600, expiracion: exp, qty: 2, price: 1.5, ts: exp + 'T17:00:00+00:00', fee: 0 }];
    const hoy = K.emparejarFillsSchwab(fills, '2026-12-31');
    const fila = (hoy.expiradas || [])[0];
    assert(!!fila, exp + ': emparejarFillsSchwab deduce el vencimiento');
    if (fila) {
      const vieja = { ...fila, cerrada_at: exp + 'T20:00:00+00:00' };   // la misma fila guardada por la v65 antes de la rev6
      igual(leer([vieja])[0].cerrada_at, fila.cerrada_at, exp + ': la fila vieja (20:00Z) se relee en el MISMO instante que escribe hoy la app (' + fila.cerrada_at + ')');
    }
  }
}

C.resumen();
