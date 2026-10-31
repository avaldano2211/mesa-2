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

  C.resumen();
})().catch(e => { C.falla('excepción: ' + (e && e.stack || e)); C.resumen(); });
