#!/usr/bin/env node
/* Pruebas de la v66 (A4, 2026-10-31) · la CAUSA de los duplicados de E*TRADE en broker_trades.
   La pasada completa empareja FIFO 180 días de transacciones y sube los round-trips con upsert por clave_ext
   (contrato#abre>cierra#contratos) e ignoreDuplicates: un emparejado distinto daba OTRAS claves y las filas viejas se
   quedaban para siempre (la v62-v65 solo las quitaba al LEER). Libro real del 22-oct: la SPY PUT 757 del 14-sep ×109 con
   50 reales (41+9 provisionales, 41+9 contabilizadas y un «41>50 ×9» re-emparejado el 9-oct) y la META CALL 690 ×14 con 7
   (el vencimiento anotado provisional y luego contabilizado, con otro ID). Aquí, con datos de JUGUETE de la misma forma:
     [1] claves estables: emparejarEtrade no cuenta dos veces una transacción repetida (dos páginas que se solapan) y no
         depende del orden de la lista (empate de hora → por transactionId);
     [2] etradeTransacciones dice si la lista llegó ENTERA (completa) y cuántas repetidas quitó;
     [3] filasEtradeSupersedidas (PURA): qué filas viejas están supersedidas, con TODAS las salvaguardas (pasada completa,
         dentro de la ventana, solo E*TRADE y solo del usuario, contrato entero, todos los IDs cubiertos por otra fila);
     [4] la sincronización REAL (etradeSincronizar → etradeReemplazarSupersedidas) contra una base de juguete: retira las
         supersedidas, Cuentas = Diario sigue igual, una segunda pasada no toca nada y una pasada parcial o fallida no
         borra nada.
   Las funciones son las REALES del fuente (casa_pruebas.js); contra la v66 sin el arreglo FALLAN por comportamiento.
   Uso: node test_etrade_supersedidas.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_etrade_supersedidas.js');
const { FUENTE, assert, igual, construir, existeConst, localStorageFalso, sbFalso } = C;

const existe = (n) => new RegExp('^(?:async )?function ' + n + '\\s*\\(', 'm').test(FUENTE);
const ymdNY = C.ymdNY;
const r2 = (n) => Math.round(n * 100) / 100;
const copia = (x) => JSON.parse(JSON.stringify(x));

// ---------- datos de JUGUETE con la forma real (IDs inventados; provisional 26…2…, contabilizada 26…5…) ----------
const pSPY = { symbol: 'SPY', securityType: 'OPTN', callPut: 'PUT', strikePrice: 757, expiryYear: 26, expiryMonth: 9, expiryDay: 14 };
const pMETA = { symbol: 'META', securityType: 'OPTN', callPut: 'CALL', strikePrice: 690, expiryYear: 26, expiryMonth: 9, expiryDay: 16 };
const pQQQ = { symbol: 'QQQ', securityType: 'OPTN', callPut: 'CALL', strikePrice: 600, expiryYear: 26, expiryMonth: 10, expiryDay: 2 };
const tx = (id, tipo, qty, price, iso, prod) => ({ transactionId: id, transactionDate: Date.parse(iso), transactionType: tipo, description: tipo,
  brokerage: { quantity: qty, price, fee: /expir/i.test(tipo) ? 0 : 0.65, product: prod } });
// SPY PUT 757 (0DTE del lun 14-sep): compras 9 + 41 en el mismo instante, venta 50; la provisional ~2 min después
const P0 = tx(26257501000109, 'Bought To Open', 9, 1.20, '2026-09-14T14:23:10Z', pSPY);
const P1 = tx(26257501000141, 'Bought To Open', 41, 1.20, '2026-09-14T14:23:10Z', pSPY);
const P2 = tx(26257501000250, 'Sold To Close', -50, 1.50, '2026-09-14T14:36:20Z', pSPY);
const Q5 = tx(26257200300109, 'Bought', 9, 1.20, '2026-09-14T14:25:15Z', pSPY);
const Q3 = tx(26257200300141, 'Bought', 41, 1.20, '2026-09-14T14:25:15Z', pSPY);
const Q4 = tx(26257200300250, 'Sold', -50, 1.50, '2026-09-14T14:38:25Z', pSPY);
// META CALL 690 (vence el mié 16-sep): 1 comprada y vendida el 15; 5 + 1 + 1 compradas el 16 que vencen (7); el vencimiento
// anotado PROVISIONAL (M6) y luego CONTABILIZADO con otro ID (M5)
const M0 = tx(26258501000201, 'Bought To Open', 1, 2.00, '2026-09-15T14:06:00Z', pMETA);
const M1 = tx(26258501000202, 'Sold To Close', -1, 2.50, '2026-09-15T18:42:00Z', pMETA);
const M2 = tx(26259501000305, 'Bought To Open', 5, 1.10, '2026-09-16T13:53:00Z', pMETA);
const M3 = tx(26259501000311, 'Bought To Open', 1, 1.15, '2026-09-16T13:58:00Z', pMETA);
const M4 = tx(26259501000312, 'Bought To Open', 1, 1.15, '2026-09-16T13:58:00Z', pMETA);
const M6 = tx(26260200100007, 'Option Expired', 7, 0, '2026-09-17T08:31:00Z', pMETA);
const M5 = tx(26260501000007, 'Option Expired', 7, 0, '2026-09-17T07:00:00Z', pMETA);
const TXS_HOY = [P2, P1, P0, M5, M4, M3, M2, M1, M0];   // lo que E*TRADE devuelve hoy (las provisionales ya no están)
const HOY_MS = Date.UTC(2026, 9, 31, 14, 0);           // sáb 31-oct-2026, 10:00 ET
const DESDE_MS = HOY_MS - 180 * 86400000;

// Cuentas (unirOperaciones con el libro) y el Diario (emparejarFillsFIFO del libro vigente): las funciones REALES
const NOMBRES_CTA = ['unirOperaciones', 'filasEtradeVigentes', 'fillsEtradeVigentes', 'tipoFillEtrade', 'claveFill', 'claveContrato', 'emparejarFillsFIFO', 'viajeDe',
  'operacionCerrada', 'durMin', 'diasEntre', 'spotDeFill', 'peorFuenteSpot', 'sinHoraIso', 'horaNY', 'instanteVencimiento', 'vencimientoMoomoo', 'filasMoomooVencimiento',
  'filasSchwabVencimiento', 'cerradasDesde', 'diaOpNY', 'diaAperturaOp'].filter(existe);
const K = construir(NOMBRES_CTA, { ymdNY, hoyNY: () => '2026-10-31' },
  { consts: ['ET_PROV_ANTES_MS', 'ET_PROV_DESPUES_MS', 'ET_TIPO_PROVISIONAL', 'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'].filter(existeConst) });
const E = construir(['emparejarEtrade', 'instanteVencimiento', 'fillsDeTransaccionesEtrade', 'ladoFillEtrade', 'fechaNyTransaccion'], { ymdNY });
// filasEtradeSupersedidas y lo que usa: desde la rev68 hace la prueba de la lectura (filasEtradeVigentes y su FIFO)
const NOMBRES_SUP = ['filasEtradeSupersedidas', 'filasEtradeVigentes', 'emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'durMin', 'diasEntre', 'spotDeFill',
  'peorFuenteSpot', 'sinHoraIso', 'horaNY', 'instanteVencimiento', 'fillsEtradeVigentes', 'tipoFillEtrade', 'claveFill', 'claveContrato'].filter(existe);
const CONSTS_SUP = ['ET_SUPERSEDIDA_MARGEN_MS', 'ET_PROV_ANTES_MS', 'ET_PROV_DESPUES_MS', 'ET_TIPO_PROVISIONAL', 'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'].filter(existeConst);
const claveDe = (t) => `${t.raw.abre}>${t.raw.cierra} x${t.contratos}`;
const ctos = (filas, sym) => filas.filter(t => !sym || t.symbol === sym).reduce((s, t) => s + Number(t.contratos), 0);

// el libro (fills) como lo deja la app: fillsDeTransaccionesEtrade de lo leído, con su id y su creado_at
let idFill = 1;
const alLibro = (txs, creado) => E.fillsDeTransaccionesEtrade(txs).map(f => ({ ...f, id: idFill++, user_id: 'u', creado_at: creado }));
// filas viejas de broker_trades como las dejaron pasadas anteriores (emparejarEtrade de lo que E*TRADE devolvía entonces)
let idBT = 1;
const aBase = (rts, creado, extra) => rts.map(r => ({ ...r, user_id: 'u', id: idBT++, creado_at: creado, ...(extra || {}) }));
function juncoViejo() {
  idBT = 1;
  const prov14 = aBase(E.emparejarEtrade([Q4, Q3, Q5]), '2026-09-14T14:43:00+00:00');                  // el día: IDs provisionales
  const cont17 = aBase(E.emparejarEtrade([P2, P1, P0]), '2026-09-17T15:55:00+00:00');                  // contabilizadas
  const v41 = cont17.find(t => t.contratos === 41);
  const bogus = aBase([{ ...v41, contratos: 9, resultado_usd: r2(v41.resultado_usd * 9 / 41), fees: r2(v41.fees * 9 / 41),
    clave_ext: v41.clave_ext.replace(/#41$/, '#9') }].map(({ id, user_id, creado_at, ...r }) => r), '2026-10-09T14:26:00+00:00');   // el «41>50 ×9» del 9-oct
  const meta17 = aBase(E.emparejarEtrade([M6, M4, M3, M2, M1, M0]), '2026-09-17T15:55:00+00:00');      // el vencimiento PROVISIONAL
  const meta25 = aBase(E.emparejarEtrade([M5, M4, M3, M2, M1, M0]).filter(t => !meta17.some(o => o.clave_ext === t.clave_ext)), '2026-09-25T11:32:00+00:00');
  return { prov14, cont17, bogus, meta17, meta25, todas: [].concat(prov14, cont17, bogus, meta17, meta25) };
}
function libroJuguete(conProvisionales) {
  idFill = 1;
  const l = alLibro([P0, P1, P2, M0, M1, M2, M3, M4], '2026-09-25T16:27:00+00:00').concat(alLibro([M5], '2026-09-25T16:27:01+00:00'));
  if (!conProvisionales) return l;
  // desde la v65 la pasada ligera escribe la provisional en el libro (el vencimiento provisional, antes que el contabilizado)
  return alLibro([Q5, Q3, Q4], '2026-09-14T14:40:00+00:00').concat(alLibro([M6], '2026-09-17T09:00:00+00:00'), l);
}

(async () => {
  // ════════════════ [1] claves estables: emparejarEtrade ════════════════
  {
    // una transacción REPETIDA (dos páginas que se solapan): P1 dos veces, después de P0 en la lista DESC
    const conRep = E.emparejarEtrade([P2, P0, P1, copia(P1)]);
    igual(conRep.map(claveDe).sort(), ['26257501000109>26257501000250 x9', '26257501000141>26257501000250 x41'],
      '[1] la compra repetida (mismo transactionId dos veces) cuenta UNA vez: 9 + 41 = 50, sin el «41>50 ×9» re-emparejado de la SPY PUT 757');
    igual([ctos(conRep), conRep.huerfanas.length], [50, 0], '[1] 50 contratos (no 50 + un lote fantasma), sin huérfanas');
    const repVenta = E.emparejarEtrade([copia(P2), P2, P1, P0]);
    igual([repVenta.length, ctos(repVenta), repVenta.huerfanas.length], [2, 50, 0], '[1] la VENTA repetida tampoco cuenta dos veces (ni deja una «venta sin compra» falsa)');
    // el mismo CONJUNTO en otro orden de lista da las MISMAS claves (empate de hora, venta parcial que reparte los lotes)
    const A = tx(26270501000001, 'Bought To Open', 5, 1.00, '2026-10-02T14:00:00Z', pQQQ), B = tx(26270501000002, 'Bought To Open', 5, 1.10, '2026-10-02T14:00:00Z', pQQQ);
    const S = tx(26270501000003, 'Sold To Close', -3, 1.30, '2026-10-02T14:30:00Z', pQQQ), S2 = tx(26270501000004, 'Sold To Close', -7, 1.40, '2026-10-02T15:00:00Z', pQQQ);
    const o1 = E.emparejarEtrade([S2, S, A, B]).map(t => t.clave_ext), o2 = E.emparejarEtrade([S2, S, B, A]).map(t => t.clave_ext);
    igual(o1, o2, '[1] el mismo conjunto en otro orden de lista → las MISMAS clave_ext (re-sincronizar no crea filas nuevas)');
    igual(E.emparejarEtrade([S2, S, B, A]).map(claveDe), ['26270501000001>26270501000003 x3', '26270501000001>26270501000004 x2', '26270501000002>26270501000004 x5'],
      '[1] empate de hora: primero el transactionId menor (A), venga como venga la lista');
    // sin repetidas ni empates, nada cambia (regresión): el caso de siempre
    igual(E.emparejarEtrade(TXS_HOY).map(claveDe), ['26257501000109>26257501000250 x9', '26257501000141>26257501000250 x41', '26258501000201>26258501000202 x1',
      '26259501000305>26260501000007 x5', '26259501000311>26260501000007 x1', '26259501000312>26260501000007 x1'], '[1] la lista de hoy: 6 filas, 50 SPY + 1 + 7 META');
  }

  // ════════════════ [2] etradeTransacciones: ¿llegó la lista ENTERA? ════════════════
  {
    const lista = []; for (let i = 0; i < 130; i++) lista.push(tx(26270000000000 + i, i % 2 ? 'Sold To Close' : 'Bought To Open', i % 2 ? -1 : 1, 1, new Date(HOY_MS - (i + 1) * 3600000).toISOString(), pQQQ));
    const proxy = (modo) => async (cr, ruta, q) => {
      const todas = lista.slice().sort((a, b) => b.transactionDate - a.transactionDate);
      const ini = q.marker ? Number(q.marker) : 0, n = Number(q.count) || 50;
      if (modo === 'cortada' && ini > 0) return { status: 200, data: { TransactionListResponse: { moreTransactions: true, totalCount: todas.length, Transaction: [] } } };
      const arr = todas.slice(ini, ini + n), mas = ini + n < todas.length;
      const sig = modo === 'solapada' ? ini + n - 1 : ini + n;   // la siguiente página empieza con la ÚLTIMA de esta
      if (modo === 'tope') return { status: 200, data: { TransactionListResponse: { moreTransactions: true, totalCount: 99999, Transaction: [tx(26280000000000 + ini, 'Bought To Open', 1, 1, new Date(HOY_MS - ini * 60000).toISOString(), pQQQ)], next: 'https://api.etrade.com/x?marker=' + (ini + 1) } } };
      return { status: 200, data: { TransactionListResponse: { moreTransactions: mas, totalCount: modo === 'cuenta' ? todas.length + 5 : todas.length, Transaction: arr,
        next: mas ? 'https://api.etrade.com/v1/accounts/k1/transactions?marker=' + sig : undefined } } };
    };
    class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(HOY_MS); } static now() { return HOY_MS; } }
    const T = (modo) => construir(['etradeTransacciones', 'etError'], { etRead: proxy(modo), Date: FD, URL }).etradeTransacciones({}, 'k1', 180);
    const ok = await T('normal'), sol = await T('solapada'), cor = await T('cortada'), tope = await T('tope'), cuenta = await T('cuenta');
    igual([ok.txs.length, ok.completa, ok.repetidas, ok.desdeMs], [130, true, 0, DESDE_MS], '[2] lista normal: 130 transacciones, completa, sin repetidas y con dónde empieza la ventana (desdeMs)');
    igual([sol.txs.length, new Set(sol.txs.map(t => t.transactionId)).size, sol.completa, sol.repetidas], [130, 130, true, 2],
      '[2] páginas que se solapan: las 2 repetidas fuera, y se sigue paginando hasta tener las 130 distintas (completa)');
    igual([cor.completa, cor.txs.length], [false, 50], '[2] E*TRADE dice que hay más y no da con qué seguir: la lista quedó a medias (completa = false)');
    igual([tope.completa, tope.txs.length], [false, 40], '[2] el tope de 40 páginas con E*TRADE diciendo que hay más: a medias');
    igual([cuenta.completa, cuenta.txs.length], [false, 130], '[2] menos transacciones distintas que su totalCount: a medias');
  }

  // ════════════════ [3] filasEtradeSupersedidas (PURA) ════════════════
  if (!existe('filasEtradeSupersedidas')) C.falla('[3] no existe filasEtradeSupersedidas: las filas re-emparejadas y las provisionales ya contabilizadas se quedan para siempre en broker_trades');
  else {
    // rev68: filasEtradeSupersedidas lee la base como Cuentas (filasEtradeVigentes, con su FIFO) antes de borrar
    const S = construir(NOMBRES_SUP, { ymdNY }, { consts: CONSTS_SUP });
    const nuevas = E.emparejarEtrade(TXS_HOY);
    const pasada = (extra) => ({ completa: true, desdeMs: DESDE_MS, ahoraMs: HOY_MS, fills: E.fillsDeTransaccionesEtrade(TXS_HOY), huerfanas: nuevas.huerfanas, ...(extra || {}) });
    const J = juncoViejo();
    igual([ctos(J.todas, 'SPY'), ctos(J.todas, 'META')], [109, 15], '[3] el junco de juguete tiene la forma real: SPY ×109 (50 reales), META ×15 (1 + 7 vencidos ×2)');
    // (a) con las provisionales en el libro (la v65 las escribe): se retiran las 3 de la SPY y las 3 del vencimiento provisional
    const libroP = libroJuguete(true);
    const s = S.filasEtradeSupersedidas(J.todas, nuevas, pasada(), libroP, 'u');
    const quedan = J.todas.filter(t => !s.borrar.includes(t));
    igual(s.borrar.map(claveDe).sort(), [...J.prov14, ...J.bogus, ...J.meta17.filter(t => /26260200100007/.test(t.clave_ext))].map(claveDe).sort(),
      '[3] supersedidas: las 2 provisionales de la SPY, el «41>50 ×9» re-emparejado y las 3 del vencimiento provisional de META');
    igual([s.recolocadas, s.gemelas, ctos(quedan, 'SPY'), ctos(quedan, 'META')], [1, 5, 50, 8], '[3] 1 re-emparejada y 5 provisionales con su contabilizada; quedan SPY ×50 y META ×8 (1 + 7), como el libro');
    assert(quedan.every(t => nuevas.some(n => n.clave_ext === t.clave_ext)), '[3] todo lo que queda es lo que la pasada vuelve a escribir (claves estables)');
    // (b) el libro REAL de hoy no tiene las provisionales del 14 y del 17-sep (el libro empezó el 25-sep): solo la re-emparejada
    const libroR = libroJuguete(false);
    const sR = S.filasEtradeSupersedidas(J.todas, nuevas, pasada(), libroR, 'u');
    igual(sR.borrar.map(claveDe), J.bogus.map(claveDe), '[3] sin las provisionales en el libro (sus IDs no están en ningún sitio: huérfanas, no supersedidas) solo sale la re-emparejada');
    const quedanR = J.todas.filter(t => !sR.borrar.includes(t));
    const opsR = K.unirOperaciones([], quedanR, libroR).ops, opsAntes = K.unirOperaciones([], J.todas, libroR).ops;
    const diario = K.emparejarFillsFIFO(K.fillsEtradeVigentes(libroR), '2026-10-31');
    const tot = (ops) => [ops.reduce((x, o) => x + o.contratos, 0), r2(ops.reduce((x, o) => x + o.resultado_usd, 0))];
    igual([tot(opsR), tot(opsAntes)], [tot(diario.cerradas.map(c => ({ contratos: c.contratos, resultado_usd: c.pnl }))), tot(diario.cerradas.map(c => ({ contratos: c.contratos, resultado_usd: c.pnl })))],
      '[3] Cuentas (con la lectura de siempre de red) = Diario, antes y después de retirar: ' + JSON.stringify(tot(opsR)));
    igual(diario.huerfanas.length, 0, '[3] y el Diario sin huérfanas');
    // ── las salvaguardas: ante cualquier duda, no se borra ──
    const nada = (r) => r.borrar.length;
    igual(nada(S.filasEtradeSupersedidas(J.todas, nuevas, pasada({ completa: false }), libroP, 'u')), 0, '[3] pasada a medias (completa ≠ true): nada');
    igual(nada(S.filasEtradeSupersedidas(J.todas, nuevas, pasada(), null, 'u')), 0, '[3] sin libro (lectura fallida): nada');
    igual(nada(S.filasEtradeSupersedidas(J.todas, [], pasada(), libroP, 'u')), 0, '[3] una pasada sin filas nuevas no supersede nada');
    igual(nada(S.filasEtradeSupersedidas(J.todas, nuevas, pasada(), libroP, null)), 0, '[3] sin usuario: nada');
    const ajenas = [{ ...J.bogus[0], user_id: 'otro' }, { ...J.bogus[0], broker: 'schwab' }, { ...J.bogus[0], clave_ext: 'SPY|2026-09-14|PUT|757|1.2' }];
    igual(nada(S.filasEtradeSupersedidas(ajenas, nuevas, pasada(), libroP, 'u')), 0, '[3] la misma fila de OTRO usuario, de otro bróker o con la clave vieja sin «#»: nunca');
    igual(nada(S.filasEtradeSupersedidas(J.todas, nuevas, pasada({ desdeMs: Date.parse('2026-09-13T00:00:00Z') }), libroP, 'u')), 0,
      '[3] fila pegada al BORDE de la ventana leída (a menos de 3 días): se queda (el FIFO puede haber perdido un lote anterior)');
    const conHuerf = E.emparejarEtrade(TXS_HOY.concat([tx(26259501000399, 'Sold To Close', -2, 1.00, '2026-09-15T15:00:00Z', pMETA)]));
    const sH = S.filasEtradeSupersedidas(J.todas, conHuerf, pasada({ huerfanas: conHuerf.huerfanas }), libroP, 'u');
    igual([sH.borrar.filter(t => t.symbol === 'META').length, sH.borrar.filter(t => t.symbol === 'SPY').length], [0, 3], '[3] un contrato con una venta HUÉRFANA en la pasada no se toca (el otro sí)');
    const libroExtra = libroP.concat(alLibro([tx(26257501000777, 'Bought To Open', 2, 1.30, '2026-09-14T15:00:00Z', pSPY)], '2026-09-25T16:28:00+00:00'));
    const sX = S.filasEtradeSupersedidas(J.todas, nuevas, pasada(), libroExtra, 'u');
    igual([sX.borrar.filter(t => t.symbol === 'SPY').length, sX.borrar.filter(t => t.symbol === 'META').length], [0, 3], '[3] el libro tiene de ese contrato algo que E*TRADE no devolvió: el contrato no se toca');
    const sinGem = J.prov14.map(t => ({ ...t, prima_salida: 1.55 }));
    igual(nada(S.filasEtradeSupersedidas(sinGem, nuevas, pasada(), libroP, 'u')), 0, '[3] provisional sin gemela exacta en la pasada (otra prima): se queda');
    // un ID que E*TRADE devolvió pero que ninguna fila nueva usa (lote aún abierto): la fila vieja que lo empareja se queda
    const B1 = tx(26270501000011, 'Bought To Open', 2, 1.00, '2026-10-05T14:00:00Z', pQQQ), B2 = tx(26270501000012, 'Bought To Open', 2, 1.05, '2026-10-05T14:10:00Z', pQQQ);
    const S1 = tx(26270501000013, 'Sold To Close', -2, 1.20, '2026-10-05T15:00:00Z', pQQQ);
    const txQ = TXS_HOY.concat([S1, B2, B1]), nQ = E.emparejarEtrade(txQ);
    const malQ = aBase(E.emparejarEtrade([S1, B2]), '2026-10-06T00:00:00+00:00');   // «B2>S1» de una lista sin B1
    const sQ = S.filasEtradeSupersedidas(malQ, nQ, pasada({ fills: E.fillsDeTransaccionesEtrade(txQ), huerfanas: nQ.huerfanas }), libroP.concat(alLibro([B1, B2, S1], '2026-10-05T16:00:00+00:00')), 'u');
    igual(nada(sQ), 0, '[3] la fila vieja «B2>S1» con B2 aún abierto (ninguna fila nueva usa B2): no se borra (la lectura la descarta)');
    assert(J.todas.every(t => !nuevas.some(n => n.clave_ext === t.clave_ext) || !s.borrar.includes(t)), '[3] una fila que la pasada vuelve a escribir nunca se borra');
  }

  // ════════════════ [3b] rev68 · la limpieza no DESENMASCARA nada: Cuentas lee igual antes y después ════════════════
  // El revisor de A4: filasEtradeVigentes descarta una fila con un ID fuera del libro vigente solo si tiene su gemela entre
  // las filas del libro. Si la limpieza borra justo esa gemela y deja la otra por dudosa, la lectura la vuelve a contar.
  if (existe('filasEtradeSupersedidas')) {
    const S = construir(NOMBRES_SUP, { ymdNY }, { consts: CONSTS_SUP });
    const nomDe = {};
    const et = (t) => `${nomDe[t.raw.abre] || t.raw.abre}>${nomDe[t.raw.cierra] || t.raw.cierra}×${t.contratos}`;
    const totC = (filas, libro) => { const o = K.unirOperaciones([], filas, libro).ops; return [o.reduce((x, y) => x + y.contratos, 0), r2(o.reduce((x, y) => x + y.resultado_usd, 0))]; };
    const totD = (libro) => { const c = K.emparejarFillsFIFO(K.fillsEtradeVigentes(libro), '2026-10-31').cerradas; return [c.reduce((x, y) => x + y.contratos, 0), r2(c.reduce((x, y) => x + y.pnl, 0))]; };
    const lee = (filas, libro) => K.filasEtradeVigentes(filas, libro).map(et).sort();
    // (a) QQQ 600C con una pasada a MEDIO contabilizar: compras CB0 ×3 a 0.90 y CB1 ×5 a 1.00, venta CS ×5 a 1.50, vencen 3;
    //     las provisionales (PB0, PB1, PS) ~2 min después. La base guarda cuatro pasadas: todo provisional; CB1 contabilizada
    //     con la venta aún provisional («CB1>PS ×5»); CB1 y CS contabilizadas con CB0 aún provisional («CB1>CS ×5»); la final.
    {
      const pQ = { symbol: 'QQQ', securityType: 'OPTN', callPut: 'CALL', strikePrice: 600, expiryYear: 26, expiryMonth: 10, expiryDay: 9 };
      const CB0 = tx(26282501000001, 'Bought To Open', 3, 0.90, '2026-10-08T13:59:00Z', pQ), PB0 = tx(26282200000001, 'Bought', 3, 0.90, '2026-10-08T14:01:06Z', pQ);
      const CB1 = tx(26282501000002, 'Bought To Open', 5, 1.00, '2026-10-08T14:00:00Z', pQ), PB1 = tx(26282200000002, 'Bought', 5, 1.00, '2026-10-08T14:02:06Z', pQ);
      const CS = tx(26282501000003, 'Sold To Close', -5, 1.50, '2026-10-08T14:30:00Z', pQ), PS = tx(26282200000003, 'Sold', -5, 1.50, '2026-10-08T14:32:06Z', pQ);
      const CV = tx(26283501000004, 'Option Expired', 3, 0, '2026-10-10T07:00:00Z', pQ);
      Object.assign(nomDe, { [CB0.transactionId]: 'CB0', [CB1.transactionId]: 'CB1', [CS.transactionId]: 'CS', [CV.transactionId]: 'CV', [PB0.transactionId]: 'PB0', [PB1.transactionId]: 'PB1', [PS.transactionId]: 'PS' });
      idBT = 1; idFill = 1;
      const fin = E.emparejarEtrade([CV, CS, CB1, CB0]);
      const base = [].concat(aBase(E.emparejarEtrade([PS, PB1, PB0]), '2026-10-08T14:40:00Z'), aBase(E.emparejarEtrade([PS, PB0, CB1]), '2026-10-08T18:00:00Z'),
        aBase(E.emparejarEtrade([CS, PB0, CB1]), '2026-10-09T13:00:00Z'), aBase(fin, '2026-10-12T13:00:00Z'));
      const libro = alLibro([PB0, PB1, PS], '2026-10-08T14:40:00Z').concat(alLibro([CB1], '2026-10-08T18:00:00Z'), alLibro([CS], '2026-10-09T13:00:00Z'),
        alLibro([CB0], '2026-10-12T13:00:00Z'), alLibro([CV], '2026-10-12T13:00:00Z'));
      igual(base.map(et).sort(), ['CB0>CS×3', 'CB1>CS×2', 'CB1>CS×5', 'CB1>CV×3', 'CB1>PS×5', 'PB0>PS×3', 'PB1>PS×2'], '[3b] la base de juguete del revisor: siete filas de cuatro pasadas');
      const TXS = [CV, CS, CB1, CB0];
      const s = S.filasEtradeSupersedidas(base, fin, { completa: true, desdeMs: HOY_MS - 180 * 864e5, ahoraMs: HOY_MS, fills: E.fillsDeTransaccionesEtrade(TXS), huerfanas: fin.huerfanas }, libro, 'u');
      const despues = base.filter(t => !s.borrar.includes(t));
      igual(lee(despues, libro), lee(base, libro), '[3b] QQQ a medio contabilizar: la lectura cuenta las MISMAS filas después de la limpieza (antes de la rev68 «CB1>PS ×5» volvía a contar)');
      igual([totC(despues, libro), totC(base, libro)], [totD(libro), totD(libro)], '[3b] …y Cuentas = Diario = ' + JSON.stringify(totD(libro)) + ' antes y después (antes de la rev68, tras limpiar: 13 ctos y +$226.75)');
      igual([s.borrar.length, s.dudas, s.recolocadas + s.gemelas], [0, 4, 0], '[3b] en ese contrato no se borra nada: lo elegido pasa a dudas (la lectura sigue filtrándolo) y los contadores cuadran');
    }
    // (b) SPY PUT 757 con lotes a precios DISTINTOS (9 a 1.20 y 41 a 1.25), venta de 50: el «41>50 ×9» re-emparejado con IDs
    //     contabilizados y su espejo con IDs provisionales anteriores al libro (el libro empezó el 25-sep)
    {
      const P0 = tx(26257501000109, 'Bought To Open', 9, 1.20, '2026-09-14T14:23:10Z', pSPY), P1b = tx(26257501000141, 'Bought To Open', 41, 1.25, '2026-09-14T14:23:10Z', pSPY);
      const Q5b = tx(26257200300109, 'Bought', 9, 1.20, '2026-09-14T14:25:15Z', pSPY), Q3b = tx(26257200300141, 'Bought', 41, 1.25, '2026-09-14T14:25:15Z', pSPY);
      idBT = 1; idFill = 1;
      const cont = aBase(E.emparejarEtrade([P2, P1b, P0]), '2026-09-17T15:55:00+00:00');
      const prov = aBase(E.emparejarEtrade([Q4, Q3b, Q5b]), '2026-09-14T14:43:00+00:00');
      const bog = (t, creado) => aBase([{ ...t, contratos: 9, resultado_usd: r2(t.resultado_usd * 9 / 41), fees: r2(t.fees * 9 / 41), clave_ext: t.clave_ext.replace(/#41$/, '#9') }]
        .map(({ id, user_id, creado_at, ...r }) => r), creado);
      const base = [].concat(cont, prov, bog(cont.find(t => t.contratos === 41), '2026-10-09T14:26:00+00:00'), bog(prov.find(t => t.contratos === 41), '2026-09-14T15:10:00+00:00'));
      const libro = alLibro([P0, P1b, P2], '2026-09-25T16:27:00+00:00');
      const TXS = [P2, P1b, P0], nuevas = E.emparejarEtrade(TXS);
      const s = S.filasEtradeSupersedidas(base, nuevas, { completa: true, desdeMs: DESDE_MS, ahoraMs: HOY_MS, fills: E.fillsDeTransaccionesEtrade(TXS), huerfanas: nuevas.huerfanas }, libro, 'u');
      const despues = base.filter(t => !s.borrar.includes(t));
      igual([totC(despues, libro), totC(base, libro)], [totD(libro), totD(libro)], '[3b] SPY PUT 757 con el espejo provisional: Cuentas = Diario = ' + JSON.stringify(totD(libro)) + ' antes y después (antes de la rev68: 59 / $1,517.79 tras limpiar)');
      igual(lee(despues, libro), lee(base, libro), '[3b] …la lectura cuenta las mismas filas');
      igual(s.borrar.length, 0, '[3b] …y la re-emparejada se queda (su espejo provisional solo se descarta gracias a ella)');
    }
    // (c) la prueba de la lectura no estorba lo que sí se puede limpiar: el junco de siempre sigue saliendo y Cuentas no cambia
    {
      const J = juncoViejo(), libroP = libroJuguete(true), nuevas = E.emparejarEtrade(TXS_HOY);
      const s = S.filasEtradeSupersedidas(J.todas, nuevas, { completa: true, desdeMs: DESDE_MS, ahoraMs: HOY_MS, fills: E.fillsDeTransaccionesEtrade(TXS_HOY), huerfanas: nuevas.huerfanas }, libroP, 'u');
      const despues = J.todas.filter(t => !s.borrar.includes(t));
      igual([s.borrar.length, lee(despues, libroP).length === lee(J.todas, libroP).length, totC(despues, libroP)], [6, true, totC(J.todas, libroP)],
        '[3b] el junco SPY/META de [3]: siguen saliendo las 6 supersedidas y Cuentas lee lo mismo');
      assert(/filasEtradeVigentes\(filas, libro\)/.test(C.extraer('filasEtradeSupersedidas')), '[3b] filasEtradeSupersedidas lee la base con la MISMA lectura de Cuentas (filasEtradeVigentes) antes de borrar');
    }
  }

  // ════════════════ [4] la sincronización REAL contra una base de juguete ════════════════
  if (!existe('etradeReemplazarSupersedidas')) C.falla('[4] no existe etradeReemplazarSupersedidas: la sincronización nunca retira una fila supersedida');
  {
    const mundo = (op) => {
      op = Object.assign({ txs: TXS_HOY, libroProv: true, modo: 'normal' }, op || {});
      const W = { T: HOY_MS, logs: [], ops: [] };
      class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(W.T); } static now() { return W.T; } }
      const hoyNY = () => ymdNY(new Date(W.T).toISOString());
      const ls = localStorageFalso({ mz_et_tok: 't', mz_et_sec: 's', mz_et_dia: hoyNY(), mz_et_acct: 'k1' });
      const etProxy = async (ruta, body) => {
        if (ruta !== '/etrade/read') return { status: 200, data: {} };
        if (body.path === '/v1/accounts/list.json') return { status: 200, data: { AccountListResponse: { Accounts: { Account: [{ accountIdKey: 'k1', accountStatus: 'ACTIVE' }] } } } };
        const q = body.query || {};
        const sd = String(q.startDate || ''), dias = Math.round((W.T - new Date(Number(sd.slice(4)), Number(sd.slice(0, 2)) - 1, Number(sd.slice(2, 4))).getTime()) / 86400000);
        if (op.modo === 'falla180' && dias > 100) return { status: 500, data: { error: 'rango demasiado grande' } };
        const todas = op.txs.slice().sort((a, b) => b.transactionDate - a.transactionDate || b.transactionId - a.transactionId);
        const ini = q.marker ? Number(q.marker) : 0, n = 4;   // páginas de 4: la lista de juguete ocupa 3
        if (ini > 0 && op.modo === 'falla') return { status: 500, data: { error: 'E*TRADE 500' } };
        if (ini > 0 && op.modo === 'cortada') return { status: 200, data: { TransactionListResponse: { moreTransactions: true, totalCount: todas.length, Transaction: [] } } };
        const arr = todas.slice(ini, ini + n), mas = ini + n < todas.length;
        const sig = op.modo === 'solapada' ? ini + n - 1 : ini + n;
        return { status: 200, data: { TransactionListResponse: { moreTransactions: mas, totalCount: todas.length, Transaction: copia(arr),
          next: mas ? 'https://api.etrade.com/v1/accounts/k1/transactions?marker=' + sig : undefined } } };
      };
      const J = juncoViejo();
      const otras = [{ ...J.bogus[0], id: 900, user_id: 'otro' }, { ...J.bogus[0], id: 901, broker: 'schwab', clave_ext: 'SPY   260914P00757000#x>y#9' },
        { ...J.bogus[0], id: 902, abierta_at: '2026-01-05T15:00:00+00:00', cerrada_at: '2026-01-05T16:00:00+00:00', clave_ext: 'SPY|2026-01-05|PUT|757#1>2#9', raw: { abre: '1', cierra: '2', tipo: 'Sold To Close' } }];
      const bt = copia(J.todas.concat(otras)); let idSig = 1000;
      const fills = libroJuguete(op.libroProv); let idF = 5000;
      W.bt = bt; W.fills = fills; W.J = J;
      const filtra = (filas, cadena) => filas.filter(f => cadena.every(([m, a]) => {
        if (m === 'eq') return String(f[a[0]]) === String(a[1]);
        if (m === 'in') return a[1].map(String).includes(String(f[a[0]]));
        if (m === 'gte') return String(f[a[0]]) >= String(a[1]);
        if (m === 'not') return !(a[1] === 'like' && new RegExp('^' + String(a[2]).replace(/%/g, '.*') + '$').test(String(f[a[0]])));
        return true;
      }));
      const sb = sbFalso((tabla, cadena) => {
        const opn = cadena.map(c => c[0]).find(m => ['upsert', 'delete', 'insert', 'update'].includes(m)) || 'select';
        W.ops.push(tabla + ':' + opn);
        if (tabla === 'fills') {
          if (opn === 'delete' || opn === 'update') throw new Error('nadie toca el libro');
          if (opn === 'upsert') {
            const nuevas = [];
            for (const f of cadena.find(c => c[0] === 'upsert')[1][0]) {
              if (fills.some(x => x.user_id === f.user_id && x.broker === f.broker && x.clave_ext === f.clave_ext)) continue;
              const fila = { ...copia(f), id: idF++, creado_at: new Date(W.T).toISOString() }; fills.push(fila); nuevas.push({ id: fila.id });
            }
            return { data: nuevas, error: null };
          }
          if (op.libroFalla) return { data: null, error: { message: 'red caída' } };
          const gt = cadena.find(c => c[0] === 'gt'), rg = cadena.find(c => c[0] === 'range');
          let d = fills.filter(f => !gt || f.id > Number(gt[1][1])).sort((a, b) => a.id - b.id);
          if (rg) d = d.slice(rg[1][0], rg[1][1] + 1);
          return { data: copia(d), error: null };
        }
        if (tabla !== 'broker_trades') return { data: [], error: null };
        if (opn === 'upsert') {
          if (op.upsertFalla) return { data: null, error: { message: 'upsert falló' } };
          const nuevas = [];
          for (const f of cadena.find(c => c[0] === 'upsert')[1][0]) {
            if (bt.some(x => x.user_id === f.user_id && x.broker === f.broker && x.clave_ext === f.clave_ext)) continue;   // ignoreDuplicates
            const fila = { ...copia(f), id: idSig++, creado_at: new Date(W.T).toISOString() }; bt.push(fila); nuevas.push({ id: fila.id });
          }
          return { data: nuevas, error: null };
        }
        if (opn === 'delete') {
          const fuera = filtra(bt, cadena);
          fuera.forEach(f => bt.splice(bt.indexOf(f), 1));
          return { data: fuera.map(f => ({ id: f.id })), error: null };
        }
        if (op.selectFalla) return { data: null, error: { message: 'select falló' } };
        const rg = cadena.find(c => c[0] === 'range');
        let d = filtra(bt, cadena).sort((a, b) => a.id - b.id);
        if (rg) d = d.slice(rg[1][0], rg[1][1] + 1);
        return { data: copia(d), error: null };
      });
      const FN = ['etradeSincronizar', 'etradeSincronizarImpl', 'etradeSincronizarLigera', 'pasadaSyncAhora', 'appOcultaSync', 'ultimaPasadaSync', 'tipoPasadaSync', 'syncTtlAhora',
        'ttlSyncLibro', 'sesionNY', 'sesionNYLibro', 'ritmoSyncLibro', 'resumenSyncGuardado', 'etradeTransacciones', 'etRead', 'etRenovar', 'etMarcarMuerto', 'etError', 'etCuentaKey',
        'emparejarEtrade', 'fillsDeTransaccionesEtrade', 'ladoFillEtrade', 'fechaNyTransaccion', 'guardarFills', 'textoErrorFills', 'textoErrorTabla', 'etDiaVencido',
        'leerFillsTodos', 'libroInvalidar', 'fusionarLibro', 'ordenarLibro', 'instanteLibro', 'maxIdLibro', 'libroVigente', 'fillsEtradeVigentes', 'tipoFillEtrade',
        'claveFill', 'claveContrato', 'instanteVencimiento', 'filasEtradeSupersedidas', 'libroCrudoEtrade', 'etradeReemplazarSupersedidas',
        'filasEtradeVigentes', 'emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'durMin', 'diasEntre', 'spotDeFill', 'peorFuenteSpot', 'sinHoraIso', 'horaNY'].filter(existe);
      const consola = { info: (...a) => W.logs.push(a), log() {}, warn() {}, error() {} };
      const M = construir(FN, { Date: FakeDate, ymdNY, hoyNY, localStorage: ls, URL, sb, etProxy, sesionActiva: { user: { id: 'u' } }, console: consola,
        haceCuanto: (iso) => ({ min: (W.T - new Date(iso).getTime()) / 60000 }), etCreds: () => ({ token: 't', token_secret: 's' }),
        document: { visibilityState: 'visible' }, libroRepintarPronto: () => {} },
        { consts: ['ET_K', 'ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'ET_DIAS_HIST', 'ET_DIAS_LIGERA', 'ET_TOPE_MS', 'SYNC_EXPIRADO_MS', 'LIBRO_TRAS_CIERRE_MS', '_etSyncEnVuelo', '_etRenovando',
          '_ultimaRegular', '_libro', 'LIBRO_TTL_MS', 'LIBRO_COMPLETA_MS', 'LIBRO_RT_MAX', 'ET_PROV_ANTES_MS', 'ET_PROV_DESPUES_MS', 'ET_TIPO_PROVISIONAL', 'ET_SUPERSEDIDA_MARGEN_MS',
          'DIARIO_LADOS_SALIDA', 'FUENTES_SPOT'].filter(existeConst),
          prefijo: 'let _hbUltimo = null;' });
      return { M, W, J, otras };
    };
    // las filas de E*TRADE del usuario, sin las tres de control (otro usuario, Schwab y la de enero: ids 900+)
    const etDe = (W, sym) => W.bt.filter(t => t.broker === 'etrade' && t.user_id === 'u' && !(t.id >= 900 && t.id < 1000) && (!sym || t.symbol === sym));
    const cuadre = (W) => {
      const ops = K.unirOperaciones([], W.bt.filter(t => t.user_id === 'u'), W.fills).ops.filter(o => o.broker === 'etrade' && ymdNY(o.cerrada_at) >= '2026-09-01');
      const D = K.emparejarFillsFIFO(K.fillsEtradeVigentes(W.fills), '2026-10-31');
      const dc = D.cerradas.filter(c => c.broker === 'etrade' && c.fecha_ny >= '2026-09-01');
      return { cuentas: [ops.reduce((s, o) => s + o.contratos, 0), r2(ops.reduce((s, o) => s + o.resultado_usd, 0))], diario: [dc.reduce((s, c) => s + c.contratos, 0), r2(dc.reduce((s, c) => s + c.pnl, 0))], huerfanas: D.huerfanas.length };
    };

    // (a) pasada COMPLETA con el junco: se retiran las 6 supersedidas; lo demás, intacto
    {
      const { M, W, otras } = mundo();
      const antes = cuadre(W), ids0 = W.bt.map(t => t.id);
      const r = await M.etradeSincronizar(true);
      igual([r.estado, r.completa, r.repetidas, r.reemplazadas, r.limpieza_err], ['ok', true, 0, 6, undefined], '[4] pasada completa: ok, lista entera, 6 filas supersedidas retiradas y sin error de limpieza');
      igual([ctos(etDe(W, 'SPY')), ctos(etDe(W, 'META')), etDe(W).length], [50, 8, 6], '[4] en la BASE: SPY ×50 y META ×8 (1 + 7), 6 filas: las que la pasada escribe');
      assert(otras.every(o => W.bt.some(t => t.id === o.id)), '[4] la fila de OTRO usuario, la de Schwab y la de enero (fuera de la ventana) siguen ahí');
      igual([r.nuevos, W.bt.filter(t => !ids0.includes(t.id)).length], [0, 0], '[4] nada nuevo que insertar (las claves de hoy ya estaban: claves estables)');
      const desp = cuadre(W);
      igual([desp.cuentas, desp.diario, desp.huerfanas], [antes.cuentas, antes.diario, 0], '[4] Cuentas = Diario sigue igual (' + JSON.stringify(desp.cuentas) + ') y sin huérfanas');
      igual(desp.cuentas, desp.diario, '[4] y Cuentas = Diario');
      assert(W.logs.length === 1 && /6 fila\(s\) supersedida\(s\) retirada\(s\)/.test(String(W.logs[0][0])) && Array.isArray(W.logs[0][1]) && W.logs[0][1].length === 6,
        '[4] la consola dice cuántas se retiraron (6: 1 re-emparejada y 5 provisionales) y con qué claves', JSON.stringify(W.logs));
      assert(!W.ops.includes('fills:delete') && !W.ops.includes('fills:update'), '[4] el libro de fills no se toca');
      // (b) re-sincronizar: idempotente, nada se escribe ni se borra
      W.T += 11 * 60000;
      const n0 = W.bt.length, r2b = await M.etradeSincronizar(true);
      igual([r2b.estado, r2b.nuevos, r2b.reemplazadas, W.bt.length], ['ok', 0, 0, n0], '[4] re-sincronizar: 0 nuevas, 0 retiradas (la misma pasada escribe las mismas claves)');
    }
    // (c) páginas que se SOLAPAN (la transacción repetida): no entra ninguna fila de más
    {
      const { M, W } = mundo({ modo: 'solapada' });
      const r = await M.etradeSincronizar(true);
      igual([r.estado, r.completa, r.repetidas > 0, ctos(etDe(W, 'SPY')), ctos(etDe(W, 'META'))], ['ok', true, true, 50, 8], '[4] con páginas solapadas: las repetidas fuera, completa, y la base queda en SPY ×50 / META ×8');
    }
    // (d) pasadas PARCIALES o FALLIDAS: nada se borra
    const nadaBorrado = async (op, nombre, extra) => {
      const { M, W } = mundo(op);
      const ids0 = W.bt.map(t => t.id);
      const r = await M.etradeSincronizar(true);
      const borradas = ids0.filter(id => !W.bt.some(t => t.id === id)).length;
      igual([borradas, r.reemplazadas || 0, ctos(etDe(W, 'SPY')) >= 109], [0, 0, true], `[4] ${nombre}: nada se borra (estado ${r.estado}${r.completa === false ? ', lista a medias' : ''})`);
      if (extra) extra(r, W);
    };
    await nadaBorrado({ modo: 'cortada' }, 'lista cortada (E*TRADE dice que hay más y no da con qué seguir)', (r) => igual(r.completa, false, '[4] …y el resumen dice completa = false'));
    await nadaBorrado({ modo: 'falla' }, 'E*TRADE falla en la 2ª página', (r) => igual(r.estado, 'error', '[4] …y la pasada da error'));
    await nadaBorrado({ modo: 'falla180' }, 'la de 180 días falla y entra la de 60 de respaldo', (r) => igual([r.estado, r.dias], ['ok', 60], '[4] …la de 60 días escribe pero no limpia'));
    await nadaBorrado({ upsertFalla: true }, 'el upsert de broker_trades falla', (r, W) => assert(!W.ops.includes('broker_trades:select'), '[4] …y ni siquiera se leen las viejas'));
    await nadaBorrado({ libroFalla: true }, 'el libro de fills no se puede leer');
    await nadaBorrado({ selectFalla: true }, 'la lectura de broker_trades falla', (r) => assert(/select falló/.test(r.limpieza_err || ''), '[4] …y el resumen lo dice (limpieza_err)'));
    // (e) el libro de HOY (sin las provisionales de septiembre): solo la re-emparejada; Cuentas = Diario igual
    {
      const { M, W } = mundo({ libroProv: false });
      const antes = cuadre(W);
      const r = await M.etradeSincronizar(true);
      const desp = cuadre(W);
      igual([r.reemplazadas, ctos(etDe(W, 'SPY')), ctos(etDe(W, 'META'))], [1, 100, 15], '[4] con el libro de hoy (las provisionales nunca entraron): sale solo la «41>50 ×9»; las provisionales se quedan y las filtra la lectura');
      igual([desp.cuentas, desp.diario, desp.huerfanas], [antes.cuentas, antes.cuentas, 0], '[4] …y Cuentas = Diario como antes (' + JSON.stringify(desp.cuentas) + '), sin huérfanas');
    }
  }

  // ════════════════ [5] Cuentas lo dice ════════════════
  if (existe('etradeLineaHistorial')) {
    const L = construir(['etradeLineaHistorial', 'lineaPasadaLigera'], { esc: C.esc, haceCuanto: C.haceCuanto }, { consts: ['ET_DIAS_LIGERA'] });
    const base = { estado: 'ok', txs: 9, ops: 9, rts: 6, nuevos: 0, dias: 180, huerfanas: 0, fills: 0, ts: Date.now() };
    assert(/ · 6 filas repetidas retiradas/.test(L.etradeLineaHistorial({ ...base, reemplazadas: 6 })) && /1 fila repetida retirada/.test(L.etradeLineaHistorial({ ...base, reemplazadas: 1 }))
      && !/retirad/.test(L.etradeLineaHistorial(base)), '[5] la línea del historial dice «N filas repetidas retiradas» solo si las hubo');
  }

  C.resumen();
})().catch(e => { C.falla('excepción: ' + (e && e.stack || e)); C.resumen(); });
