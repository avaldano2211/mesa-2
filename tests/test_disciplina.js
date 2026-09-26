#!/usr/bin/env node
/* Pruebas de Disciplina y del P&L vivo: pnlVivo/marks (mark no numérico), corteTocado
   y fmtPrima, el banner de corte de la tarjeta («La Mesa te avisó» vs «El último
   mark») y el cableado de vistaDisciplina (cupo, excedente por tramo, reglas rotas,
   fuentes) con un Supabase de juguete. Funciones REALES del fuente con dependencias
   falsas (casa_pruebas.js).
   Uso: node test_disciplina.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_disciplina.js');
const { assert, igual, cerca, construir, esc, usd, BROKER_NOMBRE, ymdNY, haceCuanto, nodo, sbFalso } = C;

const HOY = '2026-09-24', LUNES = '2026-09-21', MES = '2026-09-01';
const hoyNY = () => HOY;

// ════════════════ 1. pnlVivo: mark, P&L, MFE/MAE; sin mark se dice, nunca se inventa ════════════════
{
  const P = construir(['pnlVivo'], { esc, usd, haceCuanto });
  const p = { contratos: 2, prima_fill: 3.30, mark: 4.20, mfe: 4.50, mae: 3.00, mark_at: new Date(Date.now() - 2 * 60000).toISOString(), strike: 769, expiracion: '2026-09-26' };
  const h = P.pnlVivo(p);
  assert(/mark <b[^>]*>\$4\.20<\/b>/.test(h), 'muestra el mark', h);
  assert(/P&amp;L <b style="color:var\(--verde\)">\+\$180 \(\+27%\)<\/b>/.test(h), 'P&L en USD con el fill y los contratos: (4.20 − 3.30) × 2 × 100 = +$180 (+27%)');
  assert(/MFE <span[^>]*>\+\$240<\/span> \/ MAE <span[^>]*>-\$60<\/span>/.test(h), 'MFE y MAE son el mejor y peor MARK convertidos a USD');
  assert(/hace 2 min/.test(h), 'y la antigüedad del mark');
  assert(/color:var\(--rojo\)">-\$100 \(-15%\)/.test(P.pnlVivo({ ...p, mark: 2.80 })), 'perdiendo: rojo y con signo');
  assert(/color:var\(--tx2\)">\$0 \(0%\)/.test(P.pnlVivo({ ...p, mark: 3.30 })), 'en el fill: $0 (0%) en gris, sin signo');
  assert(/aún sin mark \(el worker lo calcula cada minuto en sesión\)/.test(P.pnlVivo({ ...p, mark: null })), 'sin mark: se dice honesto');
  assert(/aún sin mark/.test(P.pnlVivo({ ...p, mark: 'abc' })), 'un mark NO numérico (texto raro de la base) se trata como sin mark: nada de NaN en pantalla');
  assert(!/NaN/.test(P.pnlVivo({ ...p, mark: 'abc' })) && !/NaN/.test(P.pnlVivo({ ...p, mark: 4.2, mfe: 'x', mae: null })), 'jamás sale NaN, ni con mfe/mae raros');
  assert(/MFE <span[^>]*>—<\/span> \/ MAE <span[^>]*>—<\/span>/.test(P.pnlVivo({ ...p, mfe: null, mae: undefined })), 'sin mfe/mae: «—»');
  assert(/necesita strike y expiración \(regístralos en el fill\)/.test(P.pnlVivo({ ...p, mark: null, strike: null })), 'sin strike el worker no puede cotizar: se dice qué falta');
  assert(/necesita strike y expiración/.test(P.pnlVivo({ ...p, mark: null, expiracion: '' })), 'sin expiración igual');
  assert(/\$4\.20/.test(P.pnlVivo({ ...p, mark: '4.2' })), 'un mark en texto numérico (numeric de Postgres) vale');
  assert(/\+\$90 \(\+27%\)/.test(P.pnlVivo({ ...p, contratos: null })), 'sin contratos se asume 1');
  assert(/\+\$840<\/b>/.test(P.pnlVivo({ ...p, prima_fill: 0 })) && !/\([+-]?\d+%\)/.test(P.pnlVivo({ ...p, prima_fill: 0 })), 'con fill 0 hay P&L pero no % (no se divide por cero)');
}

// ════════════════ 2. corteTocado, corteDe y fmtPrima ════════════════
{
  const K = construir(['corteTocado', 'corteDe', 'fmtPrima'], {});
  const p = { prima_fill: 3.30, stop_pct: 20 };                  // corte 2.64
  igual(K.corteTocado({ ...p, mark: 2.64 }), true, 'mark en el corte: tocado');
  igual(K.corteTocado({ ...p, mark: 2.60 }), true, 'mark por debajo: tocado');
  igual(K.corteTocado({ ...p, mark: 2.65 }), false, 'un centavo por encima: no');
  igual(K.corteTocado({ ...p, mark: 1.0, aviso_corte_at: null, stop_pct: null }), false, 'sin stop_pct (Plan 35) nunca hay corte');
  igual(K.corteTocado({ ...p, mark: null, aviso_corte_at: '2026-09-24T14:00:00Z' }), true, 'el aviso del worker manda aunque el mark no esté');
  igual([K.corteTocado({ ...p, mark: null }), K.corteTocado({ ...p, mark: '' }), K.corteTocado({ ...p, mark: 'abc' })], [false, false, false], 'sin mark (null, vacío o no numérico) no se toca nada');
  igual(K.corteTocado({ ...p, mark: '2.6' }), true, 'un mark en texto vale');
  igual(K.corteTocado(null), false, 'null no revienta');
  igual([K.fmtPrima(2.64), K.fmtPrima(0.096), K.fmtPrima(1.5), K.fmtPrima(1.2345), K.fmtPrima('2.1'), K.fmtPrima(0.1)], ['2.64', '0.096', '1.50', '1.2345', '2.10', '0.10'], 'fmtPrima: 2 decimales, o hasta 4 si hacen falta (0.096 no se redondea a 0.10)');
}

// ════════════════ 3. el banner de corte en la tarjeta: «La Mesa te avisó» vs «El último mark» ════════════════
{
  const T = construir(['tarjetaPosicion', 'corteDe', 'corteTocado', 'fmtPrima', 'pnlVivo', 'preSalida', 'gtcDePosicion', 'gtcLimite'], { esc, usd, haceCuanto, BROKER_NOMBRE, lineasCartera: () => '', hoyNY });
  const p = { id: 5, symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20, mark: 3.40, mark_at: new Date().toISOString(), broker: 'etrade' };
  const h0 = T.tarjetaPosicion(p, null, HOY);
  assert(!/⚠ La Mesa te avisó/.test(h0) && !/El último mark/.test(h0) && !/border-color:rgba\(242,109,95,\.6\)/.test(h0), 'con el mark por encima del corte no hay banner ni borde rojo');
  assert(/plan \+10%/.test(h0) && /corte -20% <b class="mono" style="color:var\(--rojo\)">\$2\.64<\/b>/.test(h0), 'la tarjeta dice el plan congelado y el corte ($2.64)');
  assert(/MZ\.cortarPosicion\(5\)/.test(h0) && /color:var\(--rojo\);border-color:rgba\(242,109,95,\.45\)"[^>]*>Cortar/.test(h0), 'el botón Cortar sale en rojo tenue mientras no se toca el corte');
  assert(/GTC \+10% \(\$3\.65\)/.test(h0) && !/Trailing stop/.test(h0), 'la GTC es la de SU plan (+10%) y con corte no hay trailing stop');
  const h1 = T.tarjetaPosicion({ ...p, mark: 2.60 }, null, HOY);
  assert(/⚠ El último mark está en tu corte -20% \(\$2\.64\) · mark \$2\.60\.<\/b> Aún sin aviso de la Mesa \(el mark puede venir de una sola punta\): mira el bid\./.test(h1), 'mark en el corte SIN aviso del worker: «El último mark…» y manda a mirar el bid (una sola punta puede engañar)', h1.slice(h1.indexOf('⚠'), h1.indexOf('⚠') + 200));
  assert(/Si la entrada fue mala, corta ya: no la dejes ir a cero\./.test(h1), 'y la doctrina: corta ya');
  assert(/border-color:rgba\(242,109,95,\.6\)/.test(h1) && /background:var\(--rojo\);color:#fff;border-color:var\(--rojo\);font-weight:700"[^>]*>Cortar/.test(h1), 'borde rojo y el botón Cortar en rojo pleno');
  const h2 = T.tarjetaPosicion({ ...p, mark: 2.60, aviso_corte_at: '2026-09-24T14:00:00Z', aviso_corte_mark: 2.61 }, null, HOY);
  assert(/⚠ La Mesa te avisó del corte -20% \(\$2\.64\) · prima \$2\.61\.<\/b>/.test(h2) && !/El último mark/.test(h2), 'con el aviso del worker: «La Mesa te avisó…» con la prima del aviso');
  assert(!/prima \$/.test(T.tarjetaPosicion({ ...p, mark: 2.60, aviso_corte_at: '2026-09-24T14:00:00Z' }, null, HOY).split('⚠')[1].split('</b>')[0]), 'sin aviso_corte_mark no se inventa la prima');
  const h3 = T.tarjetaPosicion({ ...p, mark: 2.60, broker: 'tasty' }, null, HOY);
  assert(/Vende en tu bróker\./.test(h3) && !/MZ\.cortarPosicion/.test(h3) && !/MZ\.abrirOrden/.test(h3), 'una posición de tasty (no operable): el banner manda a vender en el bróker y no hay botones de orden');
  const h4 = T.tarjetaPosicion({ ...p, stop_pct: null, plan_pct: 35, gtc_limite: 4.48, mark: 1.0 }, null, HOY);
  assert(!/⚠/.test(h4) && !/Cortar/.test(h4) && /Trailing stop/.test(h4) && /GTC \+35% \(\$4\.48\)/.test(h4), 'Plan 35 (sin corte): ni banner ni Cortar aunque el mark esté bajo; sí trailing stop y GTC +35%');
  assert(/⚠ PON TU GTC \+10%/.test(T.tarjetaPosicion({ ...p, _gtcPendiente: true }, null, HOY)), 'sin la GTC en el bróker el botón grita «PON TU GTC»');
  assert(/aún sin mark/.test(T.tarjetaPosicion({ ...p, mark: null }, null, HOY)) && !/⚠ El último/.test(T.tarjetaPosicion({ ...p, mark: null }, null, HOY)), 'sin mark no hay banner de corte, solo «aún sin mark»');
  assert(/MZ\.cerrar\(5, 3\.3\)/.test(h0) && /MZ\.copiar\('3\.65'\)/.test(h0), 'Registrar salida y Copiar GTC de siempre');
}

// ════════════════ 4. vistaDisciplina cableada con un Supabase de juguete ════════════════
function armarVista(E) {
  E = Object.assign({ plan: 'PLAN_35', posiciones: [], trades: [], snaps: [], cortes: [] }, E || {});
  const vista = nodo();
  const sb = sbFalso((tabla) => ({ posiciones: { data: E.posiciones }, broker_trades: { data: E.trades }, cuenta_snapshots: { data: E.snaps }, ordenes: { data: E.cortes } }[tabla] || { data: [] }));
  const M = construir(['vistaDisciplina', 'unirOperaciones', 'cerradasDesde', 'reglasRotas', 'planDePct', 'fmtFechaNY', 'planActivo', 'planFilaCache', 'planUid'], {
    sb, $: () => vista, cargarPlanUsuario: async () => null, sesionActiva: { user: { id: 'u1' } },
    localStorage: { getItem: () => (E.plan === 'PLAN_10' ? JSON.stringify({ user_id: 'u1', plan: 'PLAN_10' }) : null), setItem() {}, removeItem() {} },
    inicioPeriodo: () => MES, lunesNY: () => LUNES, hoyNY, nombreMesNY: () => 'septiembre', BROKER_NOMBRE, usd, esc, ymdNY,
  }, { consts: ['PLANES', 'TICKERS', 'OPS_SEMANA', 'TAMANO_PCT', 'PLAN_K', '_plan'] });
  return { M, vista, sb };
}
const pos = (x) => Object.assign({ id: 1, symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-10-02', contratos: 2, prima_fill: 1.00, estado: 'abierta', broker: 'etrade', abierta_at: '2026-09-22T14:00:00Z', abierta_fecha_ny: '2026-09-22', plan_pct: 35, stop_pct: null, resultado_usd: null }, x || {});
const SEMANA = [
  pos({ id: 1 }),
  pos({ id: 2, symbol: 'AAPL', estado: 'cerrada', cerrada_at: '2026-09-23T15:00:00Z', prima_salida: 1.75, resultado_usd: 150 }),
  pos({ id: 3, symbol: 'TSLA', direccion: 'PUT', abierta_at: '2026-09-23T14:00:00Z', abierta_fecha_ny: '2026-09-23', contratos: 1, prima_fill: 2.00, plan_pct: 10, stop_pct: 20, estado: 'cerrada', cerrada_at: '2026-09-23T18:00:00Z', prima_salida: 1.20, resultado_usd: -80 }),
  pos({ id: 4, symbol: 'NVDA', abierta_at: '2026-09-24T14:00:00Z', abierta_fecha_ny: HOY }),
];
(async () => {
  {
    const { M, vista, sb } = armarVista({ posiciones: SEMANA, snaps: [{ broker: 'etrade', saldo_neto: 10000 }], cortes: [{ posicion_id: 3 }] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    igual(sb.llamadas.map(l => l.tabla).sort(), ['broker_trades', 'cuenta_snapshots', 'ordenes', 'posiciones'], 'lee posiciones, broker_trades, cuenta_snapshots y las ventas de corte ejecutadas');
    const oc = sb.llamadas.find(l => l.tabla === 'ordenes').cadena;
    assert(oc.some(c => c[0] === 'eq' && c[1][0] === 'proposito' && c[1][1] === 'salida_corte') && oc.some(c => c[0] === 'eq' && c[1][0] === 'estado' && c[1][1] === 'ejecutada'), 'las órdenes se filtran a salida_corte + ejecutada');
    assert(/Plan de la semana/.test(h) && /color:var\(--rojo\)">4 \/ 3</.test(h), 'Plan 35: cupo de la semana 4 / 3 en rojo (todas las de la semana, abiertas y cerradas)', h.slice(0, 300));
    assert(/Excedente: 1 op más allá de la 3ª \(NVDA CALL\)/.test(h), 'el excedente nombra la 4ª (NVDA, la última en abrirse)');
    assert(/EXCEDENTE A RETIRAR ESTE VIERNES/.test(h) && /\$70</.test(h), 'lo ganado de la semana por fecha de CIERRE: +150 − 80 = $70 a retirar');
    // OJO (particularidad del fuente, no de la prueba): la tarjeta cuenta las 4 de la semana sin
    // mirar el plan, pero reglasRotas agrupa por el plan CONGELADO de cada una (la TSLA es Plan 10),
    // así que el cupo semanal del Plan 35 queda en 3 y NO sale como regla rota.
    assert(!/4 operaciones esa semana/.test(h) && /Ninguna regla rota este mes/.test(h), 'reglas rotas del mes: con planes mezclados, las tres del Plan 35 no rompen SU cupo (cada operación con su plan)');
    assert(!/Cortó por debajo/.test(h), 'TSLA perdió el 40% con corte al 20%, pero cerró por la venta de CORTE (ordenes salida_corte ejecutada): no se la acusa de no cortar');
    assert(/saldo \$10,000 · tope por operación \(10% de la cuenta de su bróker, saldo actual\): E\*TRADE \$1,000/.test(h), 'el tope del 10% se dice por bróker');
    assert(/fuentes: manual 4 · E\*TRADE 0 · tasty 0/.test(h) && !/fusionada/.test(h), 'pie de fuentes sin fusiones');
    assert(!/Te costaron este mes/.test(h), 'sin reglas rotas no hay costo del mes');
  }
  {
    // las cuatro del Plan 35: ahí sí rompe el cupo semanal y la 4ª (que perdió) es el costo
    const cuatro = SEMANA.map(p => (p.id === 3 ? { ...p, plan_pct: 35, stop_pct: null } : p));
    const { M, vista } = armarVista({ posiciones: cuatro, snaps: [{ broker: 'etrade', saldo_neto: 10000 }] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/4 operaciones esa semana \(plan: 3\)/.test(h) && /sobraron: NVDA CALL/.test(h), 'con las cuatro del Plan 35 el cupo semanal sale como regla rota, nombrando la que sobró');
    assert(/Te costaron este mes/.test(h) && /\$0</.test(h), 'y el costo: la 4ª (NVDA) sigue abierta, así que $0 por ahora');
    assert(!/Cortó por debajo/.test(h), 'la TSLA del Plan 35 (sin corte congelado) no se juzga por el corte aunque perdiera el 40%');
  }
  {
    const { M, vista } = armarVista({ posiciones: SEMANA, snaps: [{ broker: 'etrade', saldo_neto: 10000 }], cortes: [] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/Cortó por debajo del -20% \(-40%\)/.test(h) && /TSLA PUT 769 · 23 sept?\.? · manual/.test(h), 'sin la venta de corte, la misma TSLA sí rompe la regla del corte (−40% con corte al −20%)', (/Cortó[^<]*/.exec(h) || [''])[0]);
    assert(/-\$40</.test(h), 'y su costo es lo perdido MÁS ALLÁ del corte: −80 − (−40) = −$40');
  }
  {
    const { M, vista } = armarVista({ posiciones: [pos({ id: 1 })], snaps: [] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/color:var\(--verde\)">1 \/ 3</.test(h) && !/Excedente/.test(h) && !/EXCEDENTE A RETIRAR/.test(h), 'una sola abierta: 1 / 3 en verde, sin excedentes');
    assert(/sin saldo de cuenta todavía \(cuenta_snapshots\): la regla del 10% no se evalúa/.test(h), 'sin saldo la regla de tamaño se declara no evaluada');
    assert(/Ninguna regla rota este mes/.test(h), 'y ninguna regla rota');
  }
  {
    // el excedente se mide por TRAMO cerrado: una GTC llenada a medias cobra $144 aunque el resto siga abierto
    const media = [pos({ id: 20, contratos: 3 }), pos({ id: 21, contratos: 2, prima_salida: 1.72, estado: 'cerrada', cerrada_at: '2026-09-23T15:00:00Z', resultado_usd: 144 })];
    const { M, vista } = armarVista({ posiciones: media });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/">1 \/ 3</.test(h), 'dos filas-tramo de la misma apertura cuentan UNA en el cupo');
    assert(/EXCEDENTE A RETIRAR ESTE VIERNES/.test(h) && /\$144</.test(h), 'y el tramo cobrado ($144) sí cuenta como excedente de la semana aunque la operación siga abierta');
    const vieja = [pos({ id: 30, abierta_at: '2026-09-15T14:00:00Z', abierta_fecha_ny: '2026-09-15', estado: 'cerrada', cerrada_at: '2026-09-22T15:00:00Z', prima_salida: 2, resultado_usd: 200 })];
    const v2 = armarVista({ posiciones: vieja }); await v2.M.vistaDisciplina();
    assert(/">0 \/ 3</.test(v2.vista.innerHTML) && /\$200</.test(v2.vista.innerHTML), 'una abierta la semana pasada y cerrada esta: no gasta cupo de esta semana, pero su ganancia sí es excedente de esta');
  }
  {
    // el bróker y la manual se funden: manda el $ del bróker; el veredicto de rango lo pone la manual
    const tr = { broker: 'etrade', symbol: 'AAPL', direccion: 'CALL', strike: 769, expiracion: '2026-10-02', contratos: 2, prima_fill: 1.0, prima_salida: 1.75, abierta_at: '2026-09-22T14:10:00Z', cerrada_at: '2026-09-23T15:00:00Z', resultado_usd: 148.7, clave_ext: 'k' };
    const { M, vista } = armarVista({ posiciones: [pos({ id: 2, symbol: 'AAPL', estado: 'cerrada', cerrada_at: '2026-09-23T15:00:00Z', prima_salida: 1.75, resultado_usd: 150, fuera_de_rango: true })], trades: [tr] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/fuentes: manual 1 · E\*TRADE 1 · tasty 0 · 1 manual fusionada con el bróker/.test(h), 'el pie dice que la manual se fusionó con la del bróker');
    assert(/\$149</.test(h) && /">1 \/ 3</.test(h), 'cuenta UNA operación y el excedente es el del bróker ($148.7 → $149)');
    assert(/Entró FUERA del rango óptimo/.test(h) && /AAPL CALL 769 · 22 sept?\.? · etrade/.test(h), 'la regla del rango viene de la manual y la etiqueta dice la fuente del bróker');
  }
  {
    const { M, vista } = armarVista({ plan: 'PLAN_10', posiciones: SEMANA.concat([pos({ id: 5, symbol: 'META', abierta_at: '2026-09-24T15:00:00Z', abierta_fecha_ny: HOY, plan_pct: 10, stop_pct: 20 })]), snaps: [{ broker: 'etrade', saldo_neto: 10000 }, { broker: 'schwab', saldo_neto: 4000 }] });
    await M.vistaDisciplina();
    const h = vista.innerHTML;
    assert(/Plan del día/.test(h) && /color:var\(--rojo\)">2 \/ 1</.test(h), 'Plan 10: cupo del DÍA 2 / 1 en rojo (NVDA y META hoy)');
    assert(/Plan 10%: 1 operación al día · 30–50% de la cuenta · GTC \+10% · corte -20% · una compañía al día\. El plan manda\./.test(h), 'la tarjeta resume el Plan 10');
    assert(/Excedente: 1 op más allá de la 1ª de hoy \(META CALL\)/.test(h), 'el excedente del día nombra la 2ª');
    assert(!/EXCEDENTE A RETIRAR/.test(h) && !/Plan de la semana/.test(h), 'el Plan 10 no tiene excedente semanal a retirar ni tarjeta de la semana');
    assert(/tope por operación \(50% de la cuenta de su bróker, saldo actual\): E\*TRADE \$5,000 · Charles Schwab \$2,000/.test(h), 'el tope del 50% por bróker');
    assert(!/operaciones esa semana/.test(h) && !/operaciones ese día/.test(h), 'cupos: SPY, AAPL y NVDA (Plan 35) son 3 en su semana y META (Plan 10) es 1 en su día: ningún cupo roto (cada operación con su plan congelado), aunque la tarjeta del día diga 2 / 1');
    assert(/Cortó por debajo del -20% \(-40%\)/.test(h), 'la única regla rota es la TSLA del Plan 10 que no cortó (aquí sin la venta de corte)');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
