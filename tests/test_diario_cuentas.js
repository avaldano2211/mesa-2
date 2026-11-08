#!/usr/bin/env node
/* Pruebas de la v72 · «arregla también lo del Diario con las dos cuentas» (Andrés, domingo 8-nov-2026). Desde el 6-nov
   Andrés tiene DOS cuentas reales de moomoo: EFECTIVO 283***520 (CASH) y MARGEN 283***704 (MARGIN). El worker 0.1.16 escribe
   en cada fill de moomoo su cuenta (`cuenta`, la máscara) y su tipo (`cuenta_tipo`), sql 0024, y rellena las viejas; las
   filas que aún no tienen la columna la traen en `crudo.cuenta` (worker 0.1.14+). La app:
     1. cuentaFill(f): la cuenta de un fill de moomoo (columna, si no crudo.cuenta); otros brókeres, null.
     2. emparejarFillsFIFO: la cola y el viaje de moomoo van por cuenta cuando TODAS las filas de moomoo del contrato la
        dicen; si alguna no, ese contrato junto como en la v71 (nunca peor). Tramos, viajes, abiertos y huérfanas llevan
        `cuenta` y `cuenta_tipo`. Lo demás idéntico (comisiones por acumulado, vencimientos, orden).
     3. Pantalla: con MÁS de una cuenta de moomoo en el libro, operaciones, abiertos y ejecuciones de moomoo dicen
        «efectivo» / «margen» (sin tipo, la máscara); con una sola, el HTML es el de la v71 byte a byte. El día a día sigue
        con una columna por bróker (la suma de sus cuentas); con las dos cuentas, «ef»/«mg» en pequeño bajo moomoo (sección 10).
     4. «Calcular limit» de un abierto: la clave lleva la cuenta (claveAbiertoCalc); nunca mezcla compras de dos cuentas.
     5. marcarLotesAbiertosCuentas: un grupo de moomoo con raw.cuenta mira solo los lotes de esa cuenta.
     4b. (v72 rev, juez de dinero) un contrato emparejado JUNTO (alguna fila sin cuenta): cada abierto dice `por_cuenta`
        falso, y la calculadora y Cuentas van por `bróker|contrato`, como la v71 (nunca peor).
     6. comprasLibroHoy (good faith): sin las compras de MARGEN (la regla solo existe en la de EFECTIVO).
     7. compararAbiertos con dos lotes del mismo contrato en dos cuentas: cuadra contra el total del bróker.
     8. Versión v72 (index.html ?v=72, sw.js mesa2-v61).
     9. «Historial de cada cuenta»: de una cuenta SIN conexión, hasta cuándo hay datos («última ejecución el 30-oct ·
        leída por última vez el 2-nov 13:50»).
   Funciones REALES del fuente (casa_pruebas.js) y, para la no regresión, las de la v71 (git show 4053a36:app/main.js).
   Datos de juguete: ni una cifra real (las máscaras son las de las dos cuentas, que no son secretas: el worker las escribe
   en el latido). No toca la red, ni Supabase, ni ningún bróker.
   Uso: node test_diario_cuentas.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const casa = require(path.join(__dirname, 'casa_pruebas.js'));
const C = casa(process.argv[2], 'test_diario_cuentas.js');
const { assert, igual, cerca, extraer, construir, ymdNY } = C;
const RAIZ = path.join(path.dirname(process.argv[2]), '..');

const EF = '283***520', MG = '283***704';            // EFECTIVO (CASH) y MARGEN (MARGIN)
const HOY = '2026-11-09';                            // lunes
const hoyNY = () => HOY;

// ---------- las funciones REALES ----------
const CONSTS = ['DIARIO_LADOS_SALIDA', 'FUENTES_SPOT', 'esc', 'dineroD', 'pctD', 'colD', 'BROKER_CORTO', 'BROKER_NOMBRE', 'MESES_ES_C',
  'COMISION_PENDIENTE_HABILES', 'CONCEPTOS_COMISION_CORTO'];
const CONTABLE = ['emparejarFillsFIFO', 'cuentaFill', 'instanteVencimiento', 'vencimientoMoomoo', 'fillSoloVencimiento', 'viajeDe', 'operacionCerrada',
  'parteComision', 'claveFill', 'claveContrato', 'durMin', 'diasEntre', 'diaADia', 'spotDeFill', 'peorFuenteSpot', 'sinHoraIso', 'horaNY'];
const NUEVAS = ['cuentaFill', 'cuentasMoomooLibro', 'textoCuentaMoomoo', 'claveAbiertoCalc', 'fechaDiaMes'];
const faltan = NUEVAS.filter(n => { try { extraer(n); return false; } catch (_) { return true; } });
NUEVAS.forEach(n => assert(!faltan.includes(n), `existe function ${n} en el fuente`));
if (faltan.length) C.resumen();

const D = construir(CONTABLE.concat(['cuentasMoomooLibro', 'textoCuentaMoomoo', 'claveAbiertoCalc', 'calcDatosDeAbiertos', 'calcContrato', 'calcLote',
  'marcarLotesAbiertosCuentas', 'diaOpNY', 'fechaNyTransaccion', 'comprasLibroHoy', 'compararAbiertos', 'coberturaFills', 'seccionCoberturaDiario',
  'fechaDiaMes', 'ymdNY', 'seccionOperacionesDiario', 'seccionAbiertosDiario', 'seccionEjecucionesDiario', 'fechaHoraD', 'textoDuracionOp',
  'fechaCorta', 'fmtFechaNY', 'durTxt', 'estadoComisionFill', 'estadoComisionCrudo', 'comisionAunPendiente', 'diasHabilesDesde',
  'detalleComisionFill', 'textoDetalleComision']),
  { hoyNY, filaAccionDiario: () => '' },   // la fila de la acción se prueba en test_spot.js
  { consts: CONSTS });

// el main.js de la v71 (la base de esta rama: 4053a36) para la no regresión. Sin git, se omite y se dice.
const V71 = '4053a36';
let D71 = null;
try {
  const src = execFileSync('git', ['-C', path.dirname(path.resolve(process.argv[2])), 'show', V71 + ':app/main.js'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  D71 = casa('git:' + V71 + ':app/main.js', 'v71', { auxiliar: true, fuente: src }).construir(
    CONTABLE.filter(n => n !== 'cuentaFill').concat(['seccionOperacionesDiario', 'seccionAbiertosDiario', 'seccionEjecucionesDiario', 'fechaHoraD', 'textoDuracionOp',
      'fechaCorta', 'fmtFechaNY', 'durTxt', 'diaOpNY', 'fechaNyTransaccion', 'ymdNY', 'estadoComisionFill', 'estadoComisionCrudo', 'comisionAunPendiente', 'diasHabilesDesde',
      'detalleComisionFill', 'textoDetalleComision', 'calcDatosDeAbiertos', 'calcContrato', 'calcLote', 'marcarLotesAbiertosCuentas', 'comprasLibroHoy']),
    { hoyNY, filaAccionDiario: () => '' }, { consts: CONSTS });
} catch (e) { console.log('nota: sin el main.js de la v71 (git show ' + V71 + ' falló: ' + String(e && e.message).split('\n')[0] + '): se omite la comparación con la v71'); }

// un fill de juguete; `cta` = [máscara, tipo] (tipo opcional), `crudo` = true pone la máscara SOLO en crudo.cuenta (worker 0.1.14)
let seq = 0;
const FL = (broker, lado, contratos, precio, at, op) => {
  const o = op || {};
  const f = { id: ++seq, broker, clave_ext: o.clave || ('k' + seq), symbol: o.symbol || 'SPY', direccion: o.dir || 'CALL', strike: o.strike || 600,
    expiracion: o.exp || '2026-11-20', lado, contratos, precio, comision: o.com || 0, ejecutado_at: at, fecha_ny: ymdNY(at), origen: 'worker',
    crudo: { fuente: 'moomoo OpenD history_deal_list_query' }, creado_at: o.creado || at };
  if (o.cta) {
    if (o.crudo) f.crudo.cuenta = o.cta[0];
    else { f.cuenta = o.cta[0]; f.cuenta_tipo = o.cta[1] || null; }
  }
  return f;
};
const sinCuenta = (o) => { const c = { ...o }; delete c.cuenta; delete c.cuenta_tipo; delete c.por_cuenta; if (Array.isArray(c.tramos)) c.tramos = c.tramos.map(sinCuenta); return c; };
const limpio = (R) => ({ cerradas: R.cerradas.map(sinCuenta), viajes: R.viajes.map(sinCuenta), abiertos: R.abiertos.map(sinCuenta), huerfanas: R.huerfanas.map(sinCuenta) });
const quitarCuentas = (fs0) => fs0.map(f => { const c = { ...f, crudo: { ...f.crudo } }; delete c.cuenta; delete c.cuenta_tipo; delete c.crudo.cuenta; return c; });

// ════════════════ 1. cuentaFill, cuentasMoomooLibro, textoCuentaMoomoo ════════════════
{
  igual([D.cuentaFill({ broker: 'moomoo', cuenta: MG, crudo: { cuenta: EF } }), D.cuentaFill({ broker: 'moomoo', crudo: { cuenta: EF } }),
    D.cuentaFill({ broker: 'moomoo', cuenta: null, crudo: { cuenta: ' ' + EF + ' ' } }), D.cuentaFill({ broker: 'moomoo', crudo: {} }), D.cuentaFill({ broker: 'moomoo' }),
    D.cuentaFill({ broker: 'moomoo', cuenta: '', crudo: { cuenta: '' } }), D.cuentaFill({ broker: 'moomoo', crudo: 'texto' })],
    [MG, EF, EF, null, null, null, null], 'cuentaFill: la columna manda; sin ella, crudo.cuenta (recortada); sin ninguna (o vacía), null');
  igual(['etrade', 'schwab', 'tasty'].map(b => D.cuentaFill({ broker: b, cuenta: 'X', crudo: { cuenta: 'Y' } })).concat([D.cuentaFill(null), D.cuentaFill(undefined)]),
    [null, null, null, null, null], 'cuentaFill: E*TRADE, Schwab y tasty → null aunque traigan algo parecido; null/undefined → null');
  const L = [FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z', { cta: [MG, 'MARGIN'] }), FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z', { cta: [EF], crudo: true }),
    FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z'), FL('etrade', 'compra', 1, 1, '2026-11-02T15:00:00Z', { cta: ['ET1'] }), FL('moomoo', 'venta', 1, 1, '2026-11-02T16:00:00Z', { cta: [MG] })];
  igual([D.cuentasMoomooLibro(L), D.cuentasMoomooLibro(L.slice(0, 1)), D.cuentasMoomooLibro([]), D.cuentasMoomooLibro(null)], [[EF, MG], [MG], [], []],
    'cuentasMoomooLibro: las cuentas DISTINTAS de moomoo del libro, ordenadas (columna o crudo); E*TRADE no cuenta');
  const T = D.textoCuentaMoomoo;
  igual([T({ broker: 'moomoo', cuenta: EF, cuenta_tipo: 'CASH' }, true), T({ broker: 'moomoo', cuenta: MG, cuenta_tipo: 'MARGIN' }, true),
    T({ broker: 'moomoo', cuenta: MG, cuenta_tipo: null }, true), T({ broker: 'moomoo', crudo: { cuenta: EF } }, true), T({ broker: 'moomoo' }, true),
    T({ broker: 'moomoo', cuenta_tipo: 'OTRO', cuenta: MG }, true), T({ broker: 'moomoo', cuenta: EF, cuenta_tipo: 'CASH' }, false), T({ broker: 'moomoo', cuenta: EF, cuenta_tipo: 'CASH' }),
    T({ broker: 'etrade', cuenta: EF, cuenta_tipo: 'CASH' }, true), T(null, true)],
    ['efectivo', 'margen', MG, EF, '', MG, '', '', '', ''], 'textoCuentaMoomoo: «efectivo»/«margen» por tipo; sin tipo (o uno desconocido), la máscara; sin cuenta, nada; con una sola cuenta (multi falso), nada; solo moomoo');
}

// ════════════════ 2. EL CONTABLE por cuenta ════════════════
// El caso cruzado: el mismo contrato en las dos cuentas. EFECTIVO compra 2 a 1.00 el viernes; MARGEN compra 3 a 2.00 el
// lunes y los vende a 2.50; EFECTIVO vende 1 a 0.50. Sin la cuenta (v71), la venta de MARGEN se comía el lote de EFECTIVO.
const cruce = (op) => {
  const o = op || {};
  const m = (cta) => (o.soloCrudo ? { cta: [cta], crudo: true } : { cta: [cta, cta === EF ? 'CASH' : 'MARGIN'] });
  return [
    FL('moomoo', 'compra', 2, 1.00, '2026-11-06T15:00:00Z', { clave: 'c-ef', com: o.com ? 0.58 : 0, ...m(EF) }),
    FL('moomoo', 'compra', 3, 2.00, '2026-11-09T15:00:00Z', { clave: 'c-mg', com: o.com ? 1.03 : 0, ...m(MG) }),
    FL('moomoo', 'venta', 3, 2.50, '2026-11-09T15:10:00Z', { clave: 'v-mg', com: o.com ? 1.05 : 0, ...m(MG) }),
    FL('moomoo', 'venta', 1, 0.50, '2026-11-09T15:20:00Z', { clave: 'v-ef', com: o.com ? 0.29 : 0, ...m(EF) }),
  ];
};
{
  const R = D.emparejarFillsFIFO(cruce(), HOY);
  igual(R.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.contratos, c.pnl, c.fecha_ny, c.cuenta, c.cuenta_tipo]),
    [['c-mg', 'v-mg', 3, 150, '2026-11-09', MG, 'MARGIN'], ['c-ef', 'v-ef', 1, -50, '2026-11-09', EF, 'CASH']],
    'cruce: la venta de MARGEN cierra el lote de MARGEN (+$150) y la de EFECTIVO el de EFECTIVO (−$50): cada tramo con SU cuenta');
  igual(R.viajes.map(v => [v.ids.abre, v.pnl, v.pct, v.cuenta, v.cuenta_tipo]), [['c-mg', 150, 25, MG, 'MARGIN']],
    'cruce: un viaje cerrado (el de MARGEN, +25 %); el de EFECTIVO sigue abierto (le queda 1)');
  igual(R.abiertos.map(a => [a.clave_ext, a.contratos, a.prima, a.fecha_ny, a.cuenta, a.cuenta_tipo]), [['c-ef', 1, 1, '2026-11-06', EF, 'CASH']],
    'cruce: el abierto es 1 de EFECTIVO a $1.00 del viernes (no 1 de MARGEN a $2.00 del lunes)');
  igual(R.huerfanas.length, 0, 'cruce: sin huérfanas');
  const dd = D.diaADia(R.cerradas, null, null, R.viajes);
  igual(dd.map(d => [d.fecha_ny, Object.keys(d.por_broker), d.por_broker.moomoo.pnl, d.total]), [['2026-11-09', ['moomoo'], 100, 100]],
    'día a día: UNA columna por bróker (moomoo = la suma de sus dos cuentas: +150 − 50)');
  // contra la v71: la misma historia sin cuenta cruzaba los lotes (por eso esta entrega)
  if (D71) {
    const R71 = D71.emparejarFillsFIFO(cruce(), HOY);
    igual(R71.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.contratos, c.pnl]), [['c-ef', 'v-mg', 2, 300], ['c-mg', 'v-mg', 1, 50], ['c-mg', 'v-ef', 1, -150]],
      'v71 (lo que se arregla): la venta de MARGEN se comía el lote de EFECTIVO y la de EFECTIVO uno de MARGEN');
    igual(R71.abiertos.map(a => [a.clave_ext, a.prima]), [['c-mg', 2]], 'v71: y el abierto salía de MARGEN a $2.00');
  }
  // con comisiones: el reparto por ACUMULADO sigue por lote (Σ tramos + lo que queda en el lote = Σ fills.comision)
  const RC = D.emparejarFillsFIFO(cruce({ com: true }), HOY);
  igual(RC.cerradas.map(c => [c.ids.abre, c.comisiones, c.pnl]), [['c-mg', 2.08, 147.92], ['c-ef', 0.58, -50.58]],
    'comisiones por acumulado: MARGEN $1.03 + $1.05 = $2.08; EFECTIVO $0.29 de su lote (1 de 2) + $0.29 de su venta');
  cerca(RC.cerradas.reduce((s, c) => s + c.comisiones, 0) + RC.abiertos.reduce((s, a) => s + a.comision, 0), 0.58 + 1.03 + 1.05 + 0.29,
    'Σ comisiones de los tramos + lo que le queda al lote abierto = Σ fills.comision al centavo', 1e-9);
  // con la cuenta SOLO en crudo.cuenta (filas del worker 0.1.14 sin la columna todavía): igual, sin tipo
  const RK = D.emparejarFillsFIFO(cruce({ soloCrudo: true }), HOY);
  igual(RK.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.pnl, c.cuenta, c.cuenta_tipo]), [['c-mg', 'v-mg', 150, MG, null], ['c-ef', 'v-ef', -50, EF, null]],
    'con la cuenta solo en crudo.cuenta: también por cuenta (el tipo, null: no se inventa)');
}
// MIXTO: alguna fila de moomoo del contrato SIN cuenta (anterior al relleno) → ese contrato junto, idéntico a la v71
{
  const mix = cruce();
  delete mix[0].cuenta; delete mix[0].cuenta_tipo;           // la compra de EFECTIVO del viernes aún sin cuenta
  const R = D.emparejarFillsFIFO(mix, HOY), RJ = D.emparejarFillsFIFO(quitarCuentas(mix), HOY);
  igual(limpio(R), limpio(RJ), 'mixto: con una fila sin cuenta, el contrato se empareja JUNTO, exactamente como sin ninguna cuenta (nunca peor que la v71)');
  if (D71) igual(limpio(R), limpio(D71.emparejarFillsFIFO(mix, HOY)), 'mixto: e idéntico a la v71 con las mismas filas');
  igual(R.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.cuenta]), [['c-ef', 'v-mg', null], ['c-mg', 'v-mg', MG], ['c-mg', 'v-ef', null]],
    'mixto: un tramo lleva cuenta solo si su compra y su venta dicen LA MISMA; si no, null (no se inventa)');
  igual(R.viajes.map(v => v.cuenta), [], 'mixto: (sin viajes cerrados: queda 1 abierto)');
  igual(R.abiertos.map(a => [a.clave_ext, a.cuenta, a.cuenta_tipo]), [['c-mg', MG, 'MARGIN']], 'mixto: el abierto lleva la cuenta de SU compra (un hecho de esa compra)');
  // otro contrato del mismo libro, todo con cuenta, NO se contagia: va por cuenta
  const otro = cruce().map(f => ({ ...f, strike: 610, clave_ext: f.clave_ext + '-610' }));
  const R2 = D.emparejarFillsFIFO(mix.concat(otro), HOY);
  igual(R2.cerradas.filter(c => c.strike === 610).map(c => [c.ids.abre, c.ids.cierra, c.cuenta]), [['c-mg-610', 'v-mg-610', MG], ['c-ef-610', 'v-ef-610', EF]],
    'la decisión es POR CONTRATO: el 610 (todas con cuenta) va por cuenta aunque el 600 vaya junto');
}
// LA VENTA SIN SU COMPRA EN SU CUENTA: huérfana de esa cuenta, y el lote de la otra no se toca
{
  const fs1 = [FL('moomoo', 'compra', 2, 1.00, '2026-11-09T15:00:00Z', { clave: 'c-ef', cta: [EF, 'CASH'] }),
    FL('moomoo', 'venta', 1, 1.50, '2026-11-09T15:30:00Z', { clave: 'v-mg', cta: [MG, 'MARGIN'] })];
  const R = D.emparejarFillsFIFO(fs1, HOY);
  igual([R.cerradas.length, R.huerfanas.map(h => [h.clave_ext, h.contratos, h.cuenta, h.cuenta_tipo]), R.abiertos.map(a => [a.clave_ext, a.contratos, a.cuenta])],
    [0, [['v-mg', 1, MG, 'MARGIN']], [['c-ef', 2, EF]]], 'una venta de MARGEN sin compra de MARGEN es huérfana (con su cuenta) y el lote de EFECTIVO sigue entero');
}
// VENCIMIENTOS: deducido por cuenta, y la venta a $0 de madrugada (vencimientoMoomoo) con su cuenta en crudo
{
  const fs2 = [FL('moomoo', 'compra', 25, 0.44, '2026-11-05T16:17:20Z', { clave: 'c-ef', exp: '2026-11-06', cta: [EF, 'CASH'] }),
    FL('moomoo', 'compra', 4, 0.50, '2026-11-06T14:40:00Z', { clave: 'c-mg', exp: '2026-11-06', cta: [MG, 'MARGIN'] }),
    FL('moomoo', 'venta', 4, 0.90, '2026-11-06T15:00:00Z', { clave: 'v-mg', exp: '2026-11-06', cta: [MG, 'MARGIN'] })];
  const R = D.emparejarFillsFIFO(fs2, HOY);
  igual(R.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.contratos, c.pnl, c.fecha_ny, c.derivado, c.cuenta]),
    [['c-mg', 'v-mg', 4, 160, '2026-11-06', false, MG], ['c-ef', 'venc2026-11-06', 25, -1100, '2026-11-06', true, EF]],
    'vencimiento deducido: las 25 de EFECTIVO vencen sin valor el 6-nov (−$1,100, con su cuenta); la venta de MARGEN no las toca');
  const fs3 = fs2.slice(0, 1).concat([FL('moomoo', 'venta', 25, 0, '2026-11-07T05:21:45Z', { clave: 'v-ven', exp: '2026-11-06', cta: [EF], crudo: true })]);
  fs3[0] = { ...fs3[0] }; delete fs3[0].cuenta; delete fs3[0].cuenta_tipo; fs3[0].crudo = { cuenta: EF };   // las dos con la cuenta solo en crudo
  const R3 = D.emparejarFillsFIFO(fs3, HOY);
  igual(R3.cerradas.map(c => [c.lado_salida, c.fecha_ny, c.pnl, c.derivado, c.cuenta]), [['vencimiento', '2026-11-06', -1100, false, EF]],
    'la venta a $0 que moomoo anota de madrugada sigue siendo el VENCIMIENTO del día de la expiración, con su cuenta');
}
// E*TRADE, Schwab, tasty: ni se enteran (cuenta null en todo, y el emparejamiento es el de la v71)
{
  const fs4 = [FL('etrade', 'compra', 2, 1.00, '2026-11-06T15:00:00Z', { clave: 'e1', cta: ['A1', 'CASH'] }), FL('etrade', 'compra', 1, 2.00, '2026-11-09T15:00:00Z', { clave: 'e2', cta: ['B2', 'MARGIN'] }),
    FL('etrade', 'venta', 2, 1.50, '2026-11-09T15:10:00Z', { clave: 'e3', cta: ['B2', 'MARGIN'] }), FL('schwab', 'compra', 1, 1.00, '2026-11-09T15:00:00Z', { clave: 's1' }),
    FL('tasty', 'compra', 1, 1.00, '2026-11-09T15:00:00Z', { clave: 't1' }), FL('tasty', 'venta', 1, 3.00, '2026-11-09T16:00:00Z', { clave: 't2' })];
  const R = D.emparejarFillsFIFO(fs4, HOY);
  igual(R.cerradas.map(c => [c.ids.abre, c.ids.cierra, c.cuenta, c.cuenta_tipo]), [['e1', 'e3', null, null], ['t1', 't2', null, null]], 'otros brókeres: FIFO del bróker entero (como siempre) y cuenta null');
  assert(R.cerradas.concat(R.viajes, R.abiertos, R.huerfanas).every(x => 'cuenta' in x && 'cuenta_tipo' in x), 'tramos, viajes, abiertos y huérfanas llevan SIEMPRE los dos campos (null si no aplica)');
  if (D71) igual(limpio(R), limpio(D71.emparejarFillsFIFO(fs4, HOY)), 'otros brókeres: idéntico a la v71');
}
// NO REGRESIÓN amplia: un libro sin ninguna cuenta (el de hoy, antes del relleno) da EXACTAMENTE lo de la v71
if (D71) {
  const libro = [];
  const sims = ['SPY', 'QQQ', 'TSLA'];
  let t = Date.parse('2026-10-26T14:00:00Z');
  for (let i = 0; i < 60; i++) {
    const b = ['moomoo', 'etrade', 'schwab', 'tasty'][i % 4], s = sims[i % 3], k = 600 + (i % 2) * 5;
    const exp = i % 5 === 0 ? '2026-10-30' : '2026-11-20';
    libro.push(FL(b, 'compra', 1 + (i % 3), 1 + (i % 7) / 10, new Date(t).toISOString(), { symbol: s, strike: k, exp, com: b === 'moomoo' ? 0.37 : 0.65 }));
    if (i % 2) libro.push(FL(b, 'venta', 1 + ((i + 1) % 2), 1.2 + (i % 5) / 10, new Date(t + 7 * 60000).toISOString(), { symbol: s, strike: k, exp, com: b === 'moomoo' ? 0.21 : 0.65 }));
    t += 3 * 3600000;
  }
  igual(limpio(D.emparejarFillsFIFO(libro, HOY)), limpio(D71.emparejarFillsFIFO(libro, HOY)), 'un libro de 4 brókeres SIN cuentas: tramos, viajes, abiertos y huérfanas idénticos a la v71');
  const R = D.emparejarFillsFIFO(libro, HOY);
  assert(R.cerradas.concat(R.viajes, R.abiertos, R.huerfanas).every(x => x.cuenta === null && x.cuenta_tipo === null), 'y sin cuentas, todos con cuenta null');
}

// ════════════════ 3. «Calcular limit» de un abierto: nunca mezcla dos cuentas ════════════════
{
  const fs5 = [FL('moomoo', 'compra', 2, 2.40, '2026-11-09T15:00:00Z', { clave: 'c1', cta: [EF, 'CASH'] }), FL('moomoo', 'compra', 1, 1.90, '2026-11-09T15:05:00Z', { clave: 'c2', cta: [MG, 'MARGIN'] }),
    FL('moomoo', 'compra', 3, 1.00, '2026-11-09T15:05:00Z', { clave: 'c3', strike: 610 }), FL('etrade', 'compra', 1, 1.10, '2026-11-09T15:06:00Z', { clave: 'e1' })];
  const A = D.emparejarFillsFIFO(fs5, HOY).abiertos;
  igual(A.map(D.claveAbiertoCalc), ['moomoo|' + EF + '|SPY|CALL|600|2026-11-20', 'moomoo|' + MG + '|SPY|CALL|600|2026-11-20', 'moomoo|SPY|CALL|610|2026-11-20', 'etrade|SPY|CALL|600|2026-11-20'],
    'claveAbiertoCalc: moomoo con cuenta → moomoo|cuenta|contrato; sin cuenta y los demás → bróker|contrato (como la v71)');
  const dEf = D.calcDatosDeAbiertos(D.claveAbiertoCalc(A[0]), A), dMg = D.calcDatosDeAbiertos(D.claveAbiertoCalc(A[1]), A);
  igual([dEf.lotes, dMg.lotes], [[{ n: '2', p: '2.4' }], [{ n: '1', p: '1.9' }]], 'la calculadora de EFECTIVO abre con su compra (2 a 2.40) y la de MARGEN con la suya (1 a 1.90): nunca 3 a un medio mezclado');
  igual([D.calcDatosDeAbiertos('moomoo|SPY|CALL|600|2026-11-20', A), D.calcDatosDeAbiertos('moomoo|SPY|CALL|610|2026-11-20', A).lotes, D.calcDatosDeAbiertos('etrade|SPY|CALL|600|2026-11-20', A).lotes],
    [null, [{ n: '3', p: '1' }], [{ n: '1', p: '1.1' }]], 'la clave vieja (sin cuenta) ya no junta los de dos cuentas; un lote sin cuenta y E*TRADE, como siempre');
  if (D71) igual(D71.calcDatosDeAbiertos('moomoo|SPY|CALL|600|2026-11-20', A.map(sinCuenta)).lotes.length, 2, 'v71 (lo que se arregla): la clave sin cuenta juntaba las compras de las dos cuentas');
  const h = D.seccionAbiertosDiario(A, [], [], true);
  assert(h.includes(`MZ.calcDeAbierto('moomoo|${EF}|SPY|CALL|600|2026-11-20')`) && h.includes(`MZ.calcDeAbierto('moomoo|${MG}|SPY|CALL|600|2026-11-20')`) && h.includes("MZ.calcDeAbierto('etrade|SPY|CALL|600|2026-11-20')"),
    'el enlace «Calcular limit» de cada lote lleva SU clave (claveAbiertoCalc)');
  assert(/MZ\.calcDeAbierto\('\$\{esc\(claveAbiertoCalc\(a\)\)\}'\)/.test(extraer('seccionAbiertosDiario')), 'y está escrito con claveAbiertoCalc en el fuente');
  assert(/claveAbiertoCalc\(a\) === String\(clave \|\| ''\)/.test(extraer('calcDatosDeAbiertos')), 'calcDatosDeAbiertos filtra con la misma clave');
}

// ════════════════ 4. marcarLotesAbiertosCuentas (Cuentas): cada grupo de moomoo mira SU cuenta ════════════════
{
  const lotes = [{ broker: 'moomoo', contrato: 'SPY|CALL|600|2026-11-20', entrada_at: '2026-11-09T15:00:00Z', cuenta: EF, cuenta_tipo: 'CASH', por_cuenta: true }];
  const grupo = (raws) => ({ broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-11-20', estado: 'cerrada', cerrada_at: '2026-11-09T16:00:00Z',
    _partes_filas: raws.map((r, i) => ({ broker: 'moomoo', clave_ext: 'x' + i, cerrada_at: '2026-11-09T16:00:00Z', raw: r })) });
  const M = (op, ls) => !!D.marcarLotesAbiertosCuentas([op], ls || lotes)[0]._lote_abierto;
  igual([M(grupo([{ cuenta: MG }])), M(grupo([{ cuenta: EF }])), M(grupo([{ cuenta: MG }, { cuenta: MG }])), M(grupo([{ cuenta: MG }, { cuenta: EF }]))],
    [false, true, false, true], 'un grupo de MARGEN no se da por abierto por un lote de EFECTIVO; uno de EFECTIVO sí; uno con filas de las dos mira las dos');
  igual([M(grupo([{ fuente: 'x' }])), M(grupo([{ cuenta: MG }, {}])), M(grupo([{ cuenta: MG }, null].map(r => r))), M({ ...grupo([{ cuenta: MG }]), _partes_filas: [{ broker: 'moomoo', cerrada_at: '2026-11-09T16:00:00Z' }] })],
    [true, true, true, true], 'un grupo con alguna fila sin raw.cuenta mira TODOS los lotes de su contrato, como la v71');
  igual(M(grupo([{ cuenta: MG }]), [{ ...lotes[0], cuenta: null, cuenta_tipo: null }]), true, 'un lote sin cuenta conocida se sigue mirando (puede ser de esa cuenta): nunca peor que la v71');
  igual(D.marcarLotesAbiertosCuentas([{ ...grupo([{ cuenta: MG }]), broker: 'etrade', _partes_filas: [{ broker: 'etrade', raw: { cuenta: MG } }] }], [{ ...lotes[0], broker: 'etrade' }])[0]._lote_abierto, true,
    'E*TRADE: raw.cuenta no se mira (solo moomoo empareja por cuenta)');
  if (D71) igual(!!D71.marcarLotesAbiertosCuentas([grupo([{ cuenta: MG }])], lotes)[0]._lote_abierto, true, 'v71 (lo que se arregla): el lote de EFECTIVO dejaba «abierta» la operación de MARGEN');
  igual([M(grupo([{ cuenta: MG }]), [{ ...lotes[0], por_cuenta: false }]), M(grupo([{ cuenta: MG }]), [{ ...lotes[0], por_cuenta: undefined }]),
    M(grupo([{ cuenta: MG }]), [lotes[0], { ...lotes[0], cuenta: MG, cuenta_tipo: 'MARGIN', por_cuenta: false }])], [true, true, true],
    '(v72 rev) un lote de un contrato emparejado JUNTO (por_cuenta falso o ausente) no filtra por cuenta: todos los lotes, como la v71');
}

// ════════════════ 4b. (v72 rev, juez de dinero) un contrato emparejado JUNTO: la calculadora y Cuentas, como la v71 ════════════════
// Alguna fila de moomoo del contrato sin cuenta (antes del relleno, sin la 0024, CUENTAS_FILLS=0, o escrita con el roster
// vacío): el Diario lo empareja junto, y la calculadora y Cuentas no pueden separar por la cuenta de la compra.
{
  // D1 · EFECTIVO ×2 a 1.00 (2-nov, fila vieja SIN cuenta) + EFECTIVO ×2 a 3.00 (9-nov, crudo.cuenta): UNA posición de 4 a 2.00
  const fs6 = [FL('moomoo', 'compra', 2, 1.00, '2026-11-02T15:00:00Z', { clave: 'viejo' }), FL('moomoo', 'compra', 2, 3.00, '2026-11-09T15:00:00Z', { clave: 'nuevo', cta: [EF], crudo: true })];
  const A = D.emparejarFillsFIFO(fs6, HOY).abiertos;
  igual(A.map(a => [a.clave_ext, a.cuenta, a.por_cuenta]), [['viejo', null, false], ['nuevo', EF, false]],
    'contrato junto: cada abierto conserva la cuenta de SU compra (el rótulo) y dice por_cuenta falso');
  igual(A.map(D.claveAbiertoCalc), ['moomoo|SPY|CALL|600|2026-11-20', 'moomoo|SPY|CALL|600|2026-11-20'], 'claveAbiertoCalc: los dos enlaces con la clave del contrato (la cola del Diario)');
  const lotesCalc = A.map(a => D.calcDatosDeAbiertos(D.claveAbiertoCalc(a), A).lotes);
  igual(lotesCalc, [[{ n: '2', p: '1' }, { n: '2', p: '3' }], [{ n: '2', p: '1' }, { n: '2', p: '3' }]], 'los dos enlaces abren los 4 contratos (2 a 1.00 + 2 a 3.00): la posición real, no la mitad');
  igual(D.calcDatosDeAbiertos('moomoo|' + EF + '|SPY|CALL|600|2026-11-20', A), null, 'y no existe una clave por cuenta para un contrato junto');
  if (D71) {
    const A71 = D71.emparejarFillsFIFO(fs6, HOY).abiertos;
    igual(lotesCalc, A71.map(a => D71.calcDatosDeAbiertos(`${a.broker}|${a.contrato}`, A71).lotes), 'idéntico a la v71 (nunca peor)');
  }
  // con las DOS filas con cuenta (después del relleno) el contrato va por cuenta y la calculadora también
  const B = D.emparejarFillsFIFO([fs6[0], { ...fs6[1] }].map((f, i) => i === 0 ? { ...f, cuenta: EF, cuenta_tipo: 'CASH' } : f), HOY).abiertos;
  igual(B.map(a => [a.por_cuenta, D.claveAbiertoCalc(a)]), [[true, 'moomoo|' + EF + '|SPY|CALL|600|2026-11-20'], [true, 'moomoo|' + EF + '|SPY|CALL|600|2026-11-20']],
    'tras el relleno: por_cuenta verdadero y la clave con la cuenta');
  igual(D.calcDatosDeAbiertos(D.claveAbiertoCalc(B[0]), B).lotes, [{ n: '2', p: '1' }, { n: '2', p: '3' }], 'y la calculadora sigue con los 4 contratos de esa cuenta');
  // otros brókeres: por_cuenta siempre falso
  igual(D.emparejarFillsFIFO([FL('etrade', 'compra', 1, 1, '2026-11-09T15:00:00Z', { clave: 'e' })], HOY).abiertos.map(a => a.por_cuenta), [false], 'E*TRADE: por_cuenta falso');
}
{
  // D2 · EF compra ×2 (2-nov, sin cuenta), MG compra ×1 (9-nov), EF vende 1 (15:10), MG vende 1 (15:20). Realidad: EF con 1
  // abierto, MG plana. El Diario (junto) deja «abierto» el lote de MG: el grupo de EFECTIVO NO puede darse por plano.
  const fs7 = [FL('moomoo', 'compra', 2, 1.00, '2026-11-02T15:00:00Z', { clave: 'ef-c' }), FL('moomoo', 'compra', 1, 1.00, '2026-11-09T15:00:00Z', { clave: 'mg-c', cta: [MG], crudo: true }),
    FL('moomoo', 'venta', 1, 1.50, '2026-11-09T15:10:00Z', { clave: 'ef-v', cta: [EF], crudo: true }), FL('moomoo', 'venta', 1, 1.50, '2026-11-09T15:20:00Z', { clave: 'mg-v', cta: [MG], crudo: true })];
  const A = D.emparejarFillsFIFO(fs7, HOY).abiertos;
  igual(A.map(a => [a.clave_ext, a.contratos, a.cuenta, a.por_cuenta]), [['mg-c', 1, MG, false]], 'el Diario empareja junto (como la v71): queda «abierto» el lote de MG, con por_cuenta falso');
  const grupo = (cta, cierre, id) => ({ broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-11-20', estado: 'cerrada', cerrada_at: cierre,
    _partes_filas: [{ broker: 'moomoo', clave_ext: id, cerrada_at: cierre, raw: { cuenta: cta } }] });
  const gEF = grupo(EF, '2026-11-09T15:10:00Z', 'ef'), gMG = grupo(MG, '2026-11-09T15:20:00Z', 'mg');
  const m = D.marcarLotesAbiertosCuentas([gEF, gMG], A).map(o => !!o._lote_abierto);
  igual(m[0], true, 'Cuentas: el grupo de EFECTIVO (que SÍ tiene un lote abierto) no se da por plano');
  if (D71) igual(m, D71.marcarLotesAbiertosCuentas([gEF, gMG], D71.emparejarFillsFIFO(fs7, HOY).abiertos).map(o => !!o._lote_abierto), 'idéntico a la v71 en los dos grupos (nunca peor)');
  // el mismo libro con TODAS las filas con cuenta: por cuenta, y cada grupo mira lo suyo (EF abierto, MG plana)
  const fs8 = fs7.map((f, i) => i === 0 ? { ...f, cuenta: EF, cuenta_tipo: 'CASH' } : f);
  const A8 = D.emparejarFillsFIFO(fs8, HOY).abiertos;
  igual(A8.map(a => [a.clave_ext, a.contratos, a.cuenta, a.por_cuenta]), [['ef-c', 1, EF, true]], 'tras el relleno: por cuenta, sigue abierto 1 de EFECTIVO');
  igual(D.marcarLotesAbiertosCuentas([gEF, gMG], A8).map(o => !!o._lote_abierto), [true, false], 'y Cuentas acierta en las dos: EFECTIVO abierto, MARGEN plana');
}

// ════════════════ 5. good faith: comprasLibroHoy sin las compras de MARGEN ════════════════
{
  const hoyF = [FL('moomoo', 'compra', 2, 1.00, '2026-11-09T15:00:00Z', { clave: 'ef', cta: [EF, 'CASH'] }), FL('moomoo', 'compra', 3, 1.00, '2026-11-09T15:01:00Z', { clave: 'mg', cta: [MG, 'MARGIN'] }),
    FL('moomoo', 'compra', 1, 1.00, '2026-11-09T15:02:00Z', { clave: 'sin' }), FL('moomoo', 'compra', 1, 1.00, '2026-11-09T15:03:00Z', { clave: 'crudo', cta: [MG], crudo: true }),
    FL('moomoo', 'venta', 1, 1.20, '2026-11-09T15:04:00Z', { clave: 'vta', cta: [EF, 'CASH'] })];
  igual(D.comprasLibroHoy(hoyF, HOY).map(c => c.clave), ['ef', 'sin', 'crudo'], 'comprasLibroHoy: fuera la de MARGEN (cuenta_tipo MARGIN); sin tipo (sin cuenta o solo crudo), como siempre: se mira');
  if (D71) igual(D71.comprasLibroHoy(hoyF, HOY).map(c => c.clave), ['ef', 'mg', 'sin', 'crudo'], 'v71 (lo que se arregla): la de MARGEN salía «sin evaluar» (aviso falso)');
}

// ════════════════ 6. compararAbiertos: dos lotes del mismo contrato en dos cuentas ════════════════
{
  const fs6 = [FL('moomoo', 'compra', 3, 1.00, '2026-11-09T15:00:00Z', { clave: 'ef', cta: [EF, 'CASH'] }), FL('moomoo', 'compra', 2, 1.50, '2026-11-09T15:01:00Z', { clave: 'mg', cta: [MG, 'MARGIN'] })];
  const A = D.emparejarFillsFIFO(fs6, HOY).abiertos;
  igual(A.map(a => [a.contratos, a.cuenta]), [[3, EF], [2, MG]], 'el Diario: dos lotes del mismo contrato, uno por cuenta');
  const it = (n) => ({ broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-11-20', contratos: n });
  const pos = [{ broker: 'moomoo', symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-11-20', contratos: 5, estado: 'abierta' }];
  const dos = D.compararAbiertos(A, [it(3), it(2)], pos, ['moomoo']);
  igual(dos.map(x => [x.clave, x.fills, x.broker_n, x.libro, x.coincide]), [['moomoo|SPY|CALL|600|2026-11-20', 5, 5, 5, true]],
    'cartera de moomoo con una línea por cuenta (3 + 2): UNA fila por bróker + contrato y cuadra (5 = 5 = 5)');
  igual(D.compararAbiertos(A, [it(5)], pos, ['moomoo']).map(x => [x.fills, x.broker_n, x.coincide]), [[5, 5, true]], 'cartera con una sola línea de 5: también cuadra');
  igual(D.compararAbiertos(A, [it(3)], pos, ['moomoo']).map(x => [x.fills, x.broker_n, x.dif_broker, x.coincide]), [[5, 3, 2, false]], 'si el bróker solo tiene los 3 de una cuenta, se dice (dif 2): nada se esconde');
  igual(D.compararAbiertos(A, [], pos.map(p => ({ ...p, contratos: 3 })), []).map(x => [x.fills, x.libro, x.dif_libro, x.comprobado]), [[5, 3, 2, false]], 'y contra el libro de la Mesa, igual');
}

// ════════════════ 7. PANTALLA: «efectivo» / «margen» solo con más de una cuenta ════════════════
{
  const fsP = cruce().concat([FL('etrade', 'compra', 1, 1, '2026-11-09T15:00:00Z', { clave: 'e1' }), FL('etrade', 'venta', 1, 1.2, '2026-11-09T15:30:00Z', { clave: 'e2' }),
    FL('moomoo', 'compra', 1, 1, '2026-11-09T16:00:00Z', { clave: 'sinc', strike: 610 }), FL('moomoo', 'venta', 1, 1.5, '2026-11-09T16:10:00Z', { clave: 'sincv', strike: 610 }),
    FL('moomoo', 'compra', 1, 1, '2026-11-09T16:00:00Z', { clave: 'cru', strike: 620, cta: [MG], crudo: true })]);
  const R = D.emparejarFillsFIFO(fsP, HOY);
  const multi = D.cuentasMoomooLibro(fsP).length > 1;
  assert(multi, 'este libro tiene dos cuentas de moomoo');
  const ops = D.seccionOperacionesDiario(R.viajes, null, true), ops1 = D.seccionOperacionesDiario(R.viajes, null, false);
  assert(/×3 · moomoo margen<\/span>/.test(ops) && /×1 · moomoo<\/span>/.test(ops) && /×1 · E\*TRADE<\/span>/.test(ops),
    'operaciones: la de MARGEN dice «moomoo margen»; la de moomoo sin cuenta y la de E*TRADE, como siempre');
  assert(!/efectivo|margen/.test(ops1), 'con una sola cuenta (multi falso), ninguna operación dice cuenta');
  const ab = D.seccionAbiertosDiario(R.abiertos, [], [], true), ab1 = D.seccionAbiertosDiario(R.abiertos, [], [], false);
  assert(/moomoo efectivo · entró/.test(ab) && new RegExp('moomoo ' + MG.replace(/\*/g, '\\*') + ' · entró').test(ab), 'abiertos: «moomoo efectivo»; con la cuenta solo en crudo (sin tipo), la máscara');
  assert(!/efectivo|margen|283\*\*\*/.test(ab1.replace(/MZ\.calcDeAbierto\('[^']*'\)/g, '')), 'abiertos con multi falso: no se rotula ninguna cuenta (el enlace sí lleva la clave por cuenta)');
  const ej = D.seccionEjecucionesDiario(fsP, 'todos', true, Date.parse('2026-11-09T21:00:00Z'), true);
  const ej1 = D.seccionEjecucionesDiario(fsP, 'todos', true, Date.parse('2026-11-09T21:00:00Z'), false);
  igual((ej.match(/ · moomoo margen<\/span>/g) || []).length, 2, 'ejecuciones: las dos de MARGEN dicen «moomoo margen»');
  igual((ej.match(/ · moomoo efectivo<\/span>/g) || []).length, 2, 'ejecuciones: las dos de EFECTIVO dicen «moomoo efectivo»');
  igual((ej.match(/ · moomoo 283\*\*\*704<\/span>/g) || []).length, 1, 'ejecuciones: la que solo trae crudo.cuenta, su máscara');
  igual((ej.match(/ · moomoo<\/span>/g) || []).length, 2, 'ejecuciones: las de moomoo sin cuenta, sin rótulo');
  assert(!/efectivo|margen|283\*\*\*/.test(ej1), 'ejecuciones con multi falso: ningún rótulo de cuenta');
  // con una sola cuenta, el HTML de las tres secciones es el de la v71 BYTE A BYTE
  if (D71) {
    igual(ops1, D71.seccionOperacionesDiario(R.viajes), 'operaciones con una sola cuenta = v71 byte a byte');
    const R71 = D71.emparejarFillsFIFO(quitarCuentas(fsP), HOY);
    const fsSin = quitarCuentas(fsP);
    const A0 = D.emparejarFillsFIFO(fsSin, HOY).abiertos;
    igual(D.seccionAbiertosDiario(A0, [], [], false), D71.seccionAbiertosDiario(R71.abiertos, [], []), 'abiertos sin cuentas = v71 byte a byte (enlace incluido)');
    igual(ej1, D71.seccionEjecucionesDiario(fsP, 'todos', true, Date.parse('2026-11-09T21:00:00Z')), 'ejecuciones con una sola cuenta = v71 byte a byte');
  }
  // vistaDiario lo cablea con las cuentas del LIBRO entero
  const vd = extraer('vistaDiario');
  assert(/const multiCta = cuentasMoomooLibro\(fills\)\.length > 1;/.test(vd), 'vistaDiario: multiCta = más de una cuenta de moomoo en el LIBRO (no solo en el período)');
  assert(/seccionOperacionesDiario\(viajesSel, null, multiCta\)/.test(vd) && /seccionAbiertosDiario\(F\.abiertos, cmp, F\.huerfanas, multiCta\)/.test(vd)
    && /seccionEjecucionesDiario\(fillsSel, _diario\.brokerFiltro, _diario\.masEjec, Date\.now\(\), multiCta\)/.test(vd), 'vistaDiario pasa multiCta a operaciones, abiertos y ejecuciones');
  assert(/const brokersDias = \['etrade', 'schwab', 'tasty', 'moomoo'\]\.filter/.test(vd), 'el día a día sigue con una columna por bróker');
  assert(/const partirDias = partirMoomooDiaADia\(cerradasSel, cuentasMoomooLibro\(fills\)\.length > 1\);/.test(vd)
    && /seccionDiaADia\(dias, brokersDias, [^\n]*, partirDias\)/.test(vd), 'vistaDiario: el desglose «ef»/«mg» con las cuentas del LIBRO (partirMoomooDiaADia, sección 10)');
}

// ════════════════ 8. «Historial de cada cuenta»: hasta cuándo hay datos de una cuenta sin conexión ════════════════
{
  const fsH = [FL('etrade', 'compra', 1, 1, '2026-10-28T15:00:00Z', { clave: 'e1', creado: '2026-10-28T20:00:00Z' }),
    FL('etrade', 'venta', 1, 1.5, '2026-10-30T15:00:00Z', { clave: 'e2', creado: '2026-11-02T18:50:03.997857+00:00' }),
    { ...FL('etrade', 'vencimiento', 1, 0, '2026-10-31T04:00:00Z', { clave: 'e3', creado: '2026-11-01T10:00:00Z' }), fecha_ny: '2026-10-31' },
    FL('schwab', 'compra', 1, 1, '2026-10-27T14:00:00Z', { clave: 's1', creado: '2026-10-27T18:32:48.665399+00:00' }),
    FL('tasty', 'compra', 1, 1, '2026-09-25T14:00:00Z', { clave: 't1', creado: '2026-09-26T11:33:24Z' }),
    FL('moomoo', 'compra', 1, 1, '2026-11-06T14:00:00Z', { clave: 'm1', creado: '2026-11-07T05:44:25Z' })];
  const cob = D.coberturaFills(fsH, { etrade: 'caducada', schwab: 'sin', tasty: 'worker', moomoo: 'worker' });
  igual(cob.map(c => [c.broker, c.ultima, c.ultima_ejec, c.leida_at]), [['etrade', '2026-10-31', '2026-10-30', '2026-11-02T18:50:03.997857+00:00'], ['schwab', '2026-10-27', '2026-10-27', '2026-10-27T18:32:48.665399+00:00'],
    ['tasty', '2026-09-25', '2026-09-25', '2026-09-26T11:33:24Z'], ['moomoo', '2026-11-06', '2026-11-06', '2026-11-07T05:44:25Z']],
    'coberturaFills: ultima_ejec = la última fecha de una EJECUCIÓN (el «Option Expired» del sábado no lo es) y leida_at = el mayor creado_at');
  const h = D.seccionCoberturaDiario(cob, null);
  assert(h.includes('<b>E*TRADE</b> desde <b>2026-10-28</b> · <span style="color:var(--oro)">sin conexión ahora (se muestra lo guardado)</span> · <span class="fresco">última ejecución el 30-oct · leída por última vez el 2-nov 13:50</span>'),
    'E*TRADE caducada: «última ejecución el 30-oct · leída por última vez el 2-nov 13:50» (hora NY, ya en horario de invierno)');
  assert(h.includes('<b>Charles Schwab (thinkorswim)</b> desde <b>2026-10-27</b> · <span style="color:var(--oro)">sin conexión ahora (se muestra lo guardado)</span> · <span class="fresco">última ejecución el 27-oct · leída por última vez el 27-oct 14:32</span>'),
    'Schwab sin sesión: «última ejecución el 27-oct · leída por última vez el 27-oct 14:32» (horario de verano)');
  assert(/<b>tastytrade<\/b> desde <b>2026-09-25<\/b> <span class="fresco">\(la escribe el worker\)<\/span><\/span>/.test(h) && /<b>moomoo<\/b> desde <b>2026-11-06<\/b> <span class="fresco">\(la escribe el worker\)<\/span><\/span>/.test(h),
    'las del worker, como siempre (sin «hasta»)');
  const hOk = D.seccionCoberturaDiario(D.coberturaFills(fsH, { etrade: 'ok', schwab: 'ok', tasty: 'worker', moomoo: 'worker' }), null);
  assert(!/última ejecución|leída por última vez/.test(hOk), 'con conexión, como siempre: sin «hasta»');
  const sinCreado = D.coberturaFills(fsH.map(f => ({ ...f, creado_at: undefined })), { etrade: 'sin' });
  assert(D.seccionCoberturaDiario(sinCreado, null).includes('· <span class="fresco">última ejecución el 30-oct</span>'), 'sin creado_at (una caché vieja), solo la última ejecución: no se inventa la lectura');
  assert(D.seccionCoberturaDiario(D.coberturaFills([], { etrade: 'sin' }), null).includes('<b>E*TRADE</b> sin ejecuciones en el libro todavía · <span style="color:var(--oro)">sin conexión ahora (se muestra lo guardado)</span></span>'),
    'sin ejecuciones, nada que decir de «hasta»');
  igual([D.fechaDiaMes('2026-10-30'), D.fechaDiaMes('2026-01-02'), D.fechaDiaMes('x'), D.fechaDiaMes(null)], ['30-oct', '2-ene', 'x', ''], 'fechaDiaMes: «30-oct»');
}

// ════════════════ 9. versión y módulo entero ════════════════
{
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  assert(/config\.js\?v=72"/.test(html) && /app\/main\.js\?v=72"/.test(html), 'index.html carga config.js?v=72 y app/main.js?v=72');
  assert(/const VER = 'mesa2-v61';/.test(sw), 'sw.js VER mesa2-v61 (la caché vieja se borra al activarse)');
  const mod = C.cargarModuloEntero({ src: './app/main.js?v=72', hash: '#/cuentas' });
  assert(mod.cargo, 'main.js entero carga en el DOM de juguete', mod.error);
  if (mod.cargo) {
    igual(mod.ev('[typeof cuentaFill, typeof cuentasMoomooLibro, typeof textoCuentaMoomoo, typeof claveAbiertoCalc, typeof fechaDiaMes, typeof MZ.calcDeAbierto].join()'),
      'function,function,function,function,function,function', 'dentro del módulo REAL están las funciones nuevas y MZ.calcDeAbierto');
  }
  assert(!/\.(insert|update|upsert|delete)\(/.test(['cuentaFill', 'cuentasMoomooLibro', 'textoCuentaMoomoo', 'claveAbiertoCalc', 'emparejarFillsFIFO', 'coberturaFills'].map(extraer).join('\n')),
    'nada de esto escribe en la base: la app solo LEE lo que escribe el worker');
}

// ════════════════ 10. DÍA A DÍA con el desglose por cuenta de moomoo (las capturas de Andrés del 8-nov) ════════════════
// moomoo enseña el «Today's P/L» de CADA cuenta (antes de comisiones); el Diario sumaba las dos en una cifra. Con más de una
// cuenta en el libro y TODOS los tramos de moomoo del período emparejados POR CUENTA con su tipo, bajo la cifra de moomoo
// van «ef» y «mg» en pequeño (no columnas aparte: a 375 px sacaban «Acum.» de la pantalla). por_broker no cambia y
// ef + mg = moomoo al centavo.
{
  const V = construir(['diaADia', 'partirMoomooDiaADia', 'seccionDiaADia', 'fechaCorta'],
    {}, { consts: ['esc', 'colD', 'pctD', 'dineroS', 'BROKER_CORTO', 'MESES_ES_C'].filter(n => C.existeConst(n)) });
  const t = (broker, fecha, pnl, tipo, extra) => ({ broker, fecha_ny: fecha, pnl, costo: 100, contratos: 1, cuenta_tipo: tipo || null,
    cuenta: tipo ? (tipo === 'CASH' ? EF : MG) : null, por_cuenta: broker === 'moomoo' && !!tipo, ...(extra || {}) });
  // el viernes 6-nov de juguete: margen gana, efectivo pierde un vencimiento, Schwab otro
  const tramos = [t('moomoo', '2026-11-06', 211.3, 'MARGIN'), t('moomoo', '2026-11-06', -110.09, 'CASH', { vencido: true, contratos: 25 }),
    t('schwab', '2026-11-06', -10, null, { vencido: true, contratos: 5 }), t('moomoo', '2026-11-05', 92.2, 'CASH')];
  const viajes = tramos.map(x => ({ ...x }));
  igual([V.partirMoomooDiaADia(tramos, true), V.partirMoomooDiaADia(tramos, false)], [true, false],
    'partirMoomooDiaADia: con dos cuentas en el libro y todo emparejado por cuenta, sí; con una sola cuenta en el libro, no');
  igual(V.partirMoomooDiaADia(tramos.concat([t('moomoo', '2026-11-04', 5, null)]), true), false,
    'partirMoomooDiaADia: con UN tramo de moomoo sin tipo no se desglosa: nunca un reparto que no sume');
  igual(V.partirMoomooDiaADia(tramos.concat([t('moomoo', '2026-11-04', 5, 'CASH', { por_cuenta: false })]), true), false,
    'partirMoomooDiaADia: con UN tramo con tipo pero de un contrato emparejado JUNTO (por_cuenta falso), no se desglosa (juez de la columna)');
  igual([V.partirMoomooDiaADia(tramos.filter(x => x.cuenta_tipo !== 'MARGIN'), true), V.partirMoomooDiaADia([], true), V.partirMoomooDiaADia(null, true)],
    [false, false, false], 'partirMoomooDiaADia: si en el período operó una sola cuenta, o no hay tramos, no');
  const dias = V.diaADia(tramos, null, null, viajes);
  const v6 = dias.find(d => d.fecha_ny === '2026-11-06');
  igual([v6.por_cuenta['moomoo:MARGIN'].pnl, v6.por_cuenta['moomoo:CASH'].pnl, v6.por_broker.moomoo.pnl, v6.total], [211.3, -110.09, 101.21, 91.21],
    'diaADia: por_cuenta lleva cada cuenta y por_broker la suma de moomoo, igual que antes; el total del día no cambia');
  cerca(v6.por_cuenta['moomoo:MARGIN'].pnl + v6.por_cuenta['moomoo:CASH'].pnl, v6.por_broker.moomoo.pnl, 'diaADia: efectivo + margen = moomoo al centavo', 0.005);
  igual([v6.por_cuenta['moomoo:CASH'].vencidos, v6.por_cuenta['moomoo:MARGIN'].vencidos, v6.por_broker.moomoo.vencidos], [25, 0, 25], 'diaADia: los vencidos van a su cuenta');
  igual(Object.keys(v6.por_cuenta).sort(), ['moomoo:CASH', 'moomoo:MARGIN'], 'diaADia: Schwab y lo que no tiene tipo no entran en por_cuenta');
  const junto = V.diaADia([t('moomoo', '2026-11-04', -250, 'MARGIN', { por_cuenta: false })], null, null, []);
  igual(junto[0].por_cuenta, {}, 'diaADia: un tramo de un contrato emparejado JUNTO no entra en el desglose aunque traiga tipo');
  if (D71) {
    igual(dias.map(d => { const c = { ...d }; delete c.por_cuenta; return c; }), D71.diaADia(tramos, null, null, viajes),
      'diaADia: sin por_cuenta, idéntico a la v71 (mismo por_broker, totales, ops y acumulado)');
  }
  const h = V.seccionDiaADia(dias, ['schwab', 'moomoo'], [], true);
  assert(/<th>Schwab<\/th><th>moomoo<\/th><th>Total<\/th>/.test(h), 'seccionDiaADia: las mismas columnas de siempre (ninguna de más: el ancho del teléfono)', h.slice(0, 260));
  assert(/<small style="color:var\(--rojo\);font-weight:500">ef -\$110<\/small><br><small style="color:var\(--verde\);font-weight:500">mg \+\$211<\/small>/.test(h),
    'seccionDiaADia: bajo la cifra de moomoo, «ef» y «mg» en pequeño con su color');
  assert(h.includes('ANTES de comisiones') && h.includes('desde el cierre de ayer'), 'seccionDiaADia: la nota explica en qué difiere del Today\'s P/L de moomoo');
  const h1 = V.seccionDiaADia(dias, ['schwab', 'moomoo'], [], false);
  assert(!/>ef |>mg /.test(h1) && !h1.includes('ANTES de comisiones'), 'seccionDiaADia: sin desglose (una cuenta o emparejado junto), sin «ef»/«mg» ni nota');
  if (D71 && D71.seccionDiaADia) igual(h1, D71.seccionDiaADia(D71.diaADia(tramos, null, null, viajes), ['schwab', 'moomoo'], []), 'seccionDiaADia sin desglose: el HTML de la v71 byte a byte');
  // los tramos del contable dicen si su contrato se emparejó por cuenta
  const L = [FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z', { cta: [EF, 'CASH'] }), FL('moomoo', 'venta', 1, 2, '2026-11-02T16:00:00Z', { cta: [EF, 'CASH'] }),
    FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z', { cta: [MG, 'MARGIN'], strike: 601 }), FL('moomoo', 'venta', 1, 2, '2026-11-02T16:00:00Z', { cta: [MG, 'MARGIN'], strike: 601 }),
    FL('moomoo', 'compra', 1, 1, '2026-11-02T15:00:00Z', { strike: 602 }), FL('moomoo', 'compra', 1, 1, '2026-11-02T15:10:00Z', { cta: [EF, 'CASH'], strike: 602 }),
    FL('moomoo', 'venta', 2, 2, '2026-11-02T16:00:00Z', { cta: [EF, 'CASH'], strike: 602 })];
  const R = D.emparejarFillsFIFO(L, HOY);
  igual(R.cerradas.map(c => [c.strike, c.por_cuenta]).sort(), [[600, true], [601, true], [602, false], [602, false]],
    'emparejarFillsFIFO: por_cuenta en cada tramo (verdadero solo si su contrato se emparejó por cuenta)');
  igual(R.viajes.map(v => [v.strike, v.por_cuenta]).sort(), [[600, true], [601, true], [602, false]], 'emparejarFillsFIFO: y en cada viaje');
}
C.resumen();
