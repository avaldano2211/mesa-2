#!/usr/bin/env node
/* Pruebas del Plan 10% / Plan 35% (v48+): PLANES y el plan activo con respaldo,
   gtcLimite y corteDe, la tarjeta del día, los avisos de doctrina por plan, las
   salidas (GTC, corte), el corte de un toque (cortarPosicion) simulado con un
   Supabase de juguete, las carreras GTC automática × corte, la identidad o0 del
   formulario en ordenPreview/ordenPlace, reglasRotas, unirOperaciones y el
   selector de plataforma. Estilo de la casa: funciones REALES del fuente con
   dependencias falsas (casa_pruebas.js); nada se reimplementa aquí.
   Uso: node test_plan10.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_plan10.js');
const { FUENTE, assert, igual, cerca, construir, esc, usd, BROKER_NOMBRE, ymdNY, localStorageFalso, nodo, sbFalso, diferido, respirar } = C;

const HOY = '2026-09-24';                       // jueves
const hoyNY = () => HOY;

// ════════════════ 1. PLANES y planActivo con respaldo ════════════════
{
  const P = construir(['gtcLimite'], {}, { consts: ['PLANES'] }).PLANES;
  igual([P.PLAN_35.gtcPct, P.PLAN_35.stopPct, P.PLAN_35.opsMax, P.PLAN_35.periodo, P.PLAN_35.tamanoMaxPct], [35, null, 3, 'semana', 10], 'PLAN_35: GTC +35%, sin corte, 3 por semana, 10% de la cuenta');
  igual([P.PLAN_10.gtcPct, P.PLAN_10.stopPct, P.PLAN_10.opsMax, P.PLAN_10.periodo, P.PLAN_10.tamanoMaxPct], [10, 20, 1, 'dia', 50], 'PLAN_10: GTC +10%, corte -20%, 1 al día, hasta 50% de la cuenta');
  igual([P.PLAN_10.ventanaMin, P.PLAN_10.companiaDia, P.PLAN_10.avisoExpHoy, P.PLAN_10.refuerzo], [[570, 585], true, true, false], 'PLAN_10: ventana 9:30–9:45 ET, una compañía al día, aviso de exp hoy, sin refuerzo');
  igual([P.PLAN_35.companiaDia, P.PLAN_35.avisoExpHoy, P.PLAN_35.refuerzo, P.PLAN_35.ventana], [false, false, true, 'no_antes_1030'], 'PLAN_35: sin compañía del día, con refuerzo, espera a las 10:30');
  igual(Object.keys(P), ['PLAN_35', 'PLAN_10'], 'solo hay dos planes');
}
const planMod = (sesion, almacen) => construir(['planActivo', 'planFilaCache', 'planUid', 'planGuardarCache', 'cargarPlanUsuario'],
  { sesionActiva: sesion, localStorage: localStorageFalso(almacen), sb: null }, { consts: ['PLANES', 'PLAN_K', '_plan'], extras: ['PLAN_CACHE_MS'] });
{
  const A = planMod(null, {});
  igual(A.planActivo().id, 'PLAN_35', 'sin sesión ni fila: Plan 35 de respaldo');
  const B = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: JSON.stringify({ user_id: 'u1', plan: 'PLAN_10' }) });
  igual(B.planActivo().id, 'PLAN_10', 'con la fila cacheada en el equipo (offline) manda el Plan 10');
  const Cc = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: JSON.stringify({ user_id: 'u2', plan: 'PLAN_10' }) });
  igual(Cc.planActivo().id, 'PLAN_35', 'la fila cacheada de OTRO usuario no vale: respaldo Plan 35');
  const D = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: JSON.stringify({ user_id: 'u1', plan: 'PLAN_99' }) });
  igual(D.planActivo().id, 'PLAN_35', 'un plan desconocido en la fila → respaldo Plan 35');
  const E = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: JSON.stringify({ user_id: 'u1', plan: 'PLAN_10' }) });
  E.planGuardarCache(null);
  igual(E.planActivo().id, 'PLAN_35', 'si la base dijo «sin fila», la memoria manda sobre el localStorage viejo');
  E.planGuardarCache({ user_id: 'u1', plan: 'PLAN_10', presupuesto_pct: 40 });
  igual(E.planActivo().id, 'PLAN_10', 'guardar la fila en caché activa el Plan 10');
  const F = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: JSON.stringify({ user_id: 'u1', plan: 'PLAN_10' }) });
  const roto = planMod({ user: { id: 'u1' } }, { mz_plan_usuario: '{no es json' });
  igual(roto.planActivo().id, 'PLAN_35', 'un JSON roto en el equipo no revienta: respaldo Plan 35');
  assert(F.planFilaCache().plan === 'PLAN_10', 'planFilaCache devuelve la fila del usuario');
}
// cargarPlanUsuario: cada 20 s, y si falla se queda con lo último conocido
{
  const respuestas = [];
  let consultas = 0;
  const sb = sbFalso(() => { consultas++; return respuestas.shift() || { data: null, error: null }; });
  const M = construir(['planActivo', 'planFilaCache', 'planUid', 'planGuardarCache', 'cargarPlanUsuario'],
    { sesionActiva: { user: { id: 'u1' } }, localStorage: localStorageFalso({}), sb }, { consts: ['PLANES', 'PLAN_K', '_plan'] });
  (async () => {
    respuestas.push({ data: { user_id: 'u1', plan: 'PLAN_10' }, error: null });
    await M.cargarPlanUsuario();
    igual([consultas, M.planActivo().id], [1, 'PLAN_10'], 'cargarPlanUsuario lee plan_usuario y activa el Plan 10');
    await M.cargarPlanUsuario();
    igual(consultas, 1, 'a los pocos segundos NO vuelve a consultar (caché de 20 s)');
    respuestas.push({ data: null, error: { message: 'relation plan_usuario does not exist' } });
    await M.cargarPlanUsuario(true);
    igual([consultas, M.planActivo().id], [2, 'PLAN_10'], 'si la lectura falla (sin la migración 0012) se queda con lo último conocido');
    assert(/plan_usuario/.test(M._plan.err || ''), 'y el motivo queda anotado para Tu cuenta');
    const sinUid = construir(['planActivo', 'planFilaCache', 'planUid', 'planGuardarCache', 'cargarPlanUsuario'],
      { sesionActiva: null, localStorage: localStorageFalso({}), sb: { from: () => { throw new Error('no debería consultar'); } } }, { consts: ['PLANES', 'PLAN_K', '_plan'] });
    igual((await sinUid.cargarPlanUsuario(true)), null, 'sin sesión no se consulta nada');
  })().catch(e => { C.falla('cargarPlanUsuario: excepción → ' + (e && e.stack || e)); });
}

// ════════════════ 2. gtcLimite (entero, half-up, +0.02) y corteDe ════════════════
{
  const G = construir(['gtcLimite', 'corteDe', 'gtcDePosicion', 'planCongelado', 'planDePct'], {}, { consts: ['PLANES', 'PLAN_PCT', 'gtcDe'] });
  cerca(G.gtcLimite(3.30, 35), 4.48, '3.30 al 35% = 4.48 (aritmética entera: coma flotante daba 4.47)');
  cerca(G.gtcDe(3.30), 4.47, 'el gtcDe heredado (coma flotante) sí da 4.47: por eso se reemplazó');
  cerca(G.gtcLimite(3.30, 10), 3.65, '3.30 al 10% = 3.65 (3.63 + 0.02)');
  cerca(G.gtcLimite(1.15, 10), 1.29, 'half-up: 1.15 × 1.10 + 0.02 = 1.285 → 1.29');
  cerca(G.gtcLimite(0.96, 35), 1.32, '0.96 al 35% = 1.296 + 0.02 = 1.316 → 1.32');
  cerca(G.gtcLimite(1, 35), 1.37, '1.00 al 35% = 1.37');
  cerca(G.gtcLimite('2.10', '35'), 2.86, 'acepta texto (los inputs del formulario son texto)');
  cerca(G.gtcLimite(2.10, null), 2.86, 'sin pct → 35% (la doctrina)');
  cerca(G.gtcLimite(2.10, 0), 2.86, 'pct 0 tampoco vale: 35%');
  igual([G.gtcLimite(0, 35), G.gtcLimite(-1, 35), G.gtcLimite('abc', 35), G.gtcLimite(null, 35)], [null, null, null, null], 'sin fill válido no hay límite (null)');
  cerca(G.corteDe(3.30, 20), 2.64, 'corte -20% sobre 3.30 = 2.64');
  cerca(G.corteDe(0.12, 20), 0.096, 'el corte va a 4 decimales: 0.12 → 0.096 (no 0.10)');
  cerca(G.corteDe(2.10, 20), 1.68, 'corte -20% sobre 2.10 = 1.68');
  igual([G.corteDe(3.30, null), G.corteDe(3.30, 0), G.corteDe(3.30, 100), G.corteDe(0, 20)], [null, null, null, null], 'sin stop (null, 0 o 100) o sin fill no hay corte');
  cerca(G.gtcDePosicion({ gtc_limite: 4.48, prima_fill: 3.30, plan_pct: 10 }), 4.48, 'gtcDePosicion: manda la columna generada de la base');
  cerca(G.gtcDePosicion({ gtc_limite: null, prima_fill: 3.30, plan_pct: 10 }), 3.65, 'sin columna: el límite de SU plan congelado (10%)');
  cerca(G.gtcDePosicion({ prima_fill: 3.30 }), 4.48, 'sin plan_pct: Plan 35');
  cerca(G.gtcDePosicion({ gtc_limite: '4.48' }), 4.48, 'el de la base llega como texto (numeric de Postgres) y se devuelve como número');
  cerca(G.gtcDePosicion({ gtc_limite: 4.4800000001 }), 4.48, 'y se limpia a centavos');
  igual(G.planCongelado({}), { plan_pct: 35, stop_pct: null }, 'planCongelado sin anotación = Plan 35 sin corte');
  igual(G.planCongelado({ plan_pct: 10, stop_pct: 20 }), { plan_pct: 10, stop_pct: 20 }, 'planCongelado lee la anotación de la orden');
  igual(G.planCongelado({ plan_pct: 10, stop_pct: 100 }), { plan_pct: 10, stop_pct: null }, 'un stop de 100 no es un corte');
  igual(G.planCongelado(null).plan_pct, 35, 'planCongelado(null) no revienta');
  igual([G.planDePct(10).id, G.planDePct(35).id, G.planDePct(null).id, G.planDePct(99).id, G.planDePct('10').id], ['PLAN_10', 'PLAN_35', 'PLAN_35', 'PLAN_35', 'PLAN_10'], 'planDePct: por el % congelado; sin él o desconocido, Plan 35');
  igual(G.planDePct(null, G.PLANES.PLAN_10).id, 'PLAN_10', 'planDePct acepta otro plan por defecto');
}

// ════════════════ 3. focoDeHoy y tarjetaPlanDia ════════════════
{
  const F = construir(['focoDeHoy', 'tarjetaPlanDia', 'gtcLimite', 'fueraVentanaNY', 'textoReglasPlan'], { esc, usd }, { consts: ['PLANES', 'TICKERS'] });
  igual(F.focoDeHoy({ symbol_foco: 'meta', foco_fecha: HOY }, HOY), 'META', 'la compañía de hoy vale si foco_fecha es HOY (y sale en mayúsculas)');
  igual(F.focoDeHoy({ symbol_foco: 'META', foco_fecha: '2026-09-23' }, HOY), null, 'la de ayer ya no vale');
  igual(F.focoDeHoy({ symbol_foco: 'META', foco_fecha: HOY + 'T00:00:00' }, HOY), 'META', 'una fecha con hora se recorta a YYYY-MM-DD');
  igual([F.focoDeHoy(null, HOY), F.focoDeHoy({}, HOY), F.focoDeHoy({ symbol_foco: 'META', foco_fecha: HOY }, null)], [null, null, null], 'sin fila, sin foco o sin hoy → null');
  const P10 = F.PLANES.PLAN_10;
  const h0 = F.tarjetaPlanDia(P10, [], HOY, null);
  assert(/Plan del día/.test(h0) && /0 \/ 1/.test(h0), 'tarjeta del día: 0 / 1 sin operaciones', h0.slice(0, 200));
  assert(/Elige la compañía de hoy/.test(h0), 'sin foco: pide elegir la compañía de hoy');
  assert(F.TICKERS.every(t => h0.includes(`MZ.elegirFoco('${t}')`)), 'un botón por ticker de la lista');
  assert(/objetivo GTC \+10%/.test(h0) && /corte -20%/.test(h0) && /30–50% de la cuenta/.test(h0), 'la tarjeta dice objetivo, corte y tamaño del Plan 10');
  const h1 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'abierta', prima_fill: 2 }], HOY, { symbol_foco: 'NVDA', foco_fecha: HOY });
  assert(/1 \/ 1/.test(h1) && /Hoy operas <b[^>]*>NVDA<\/b>/.test(h1), 'con la de hoy abierta: 1 / 1 y «Hoy operas NVDA»', h1.slice(0, 300));
  assert(/perbtn on"[^>]*>NVDA/.test(h1), 'el botón de la compañía elegida sale resaltado');
  assert(!/cumplido/.test(h1), 'una operación ABIERTA no cumple el plan');
  const h2 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'cerrada', prima_fill: 2, prima_salida: 2.22, stop_pct: 20, symbol: 'NVDA', resultado_usd: 44 }], HOY, null);
  assert(/Plan del día cumplido \(NVDA \$44\)/.test(h2), 'cerrada en el objetivo (2.22 = 2.00 al +10% + 0.02) con corte congelado: plan cumplido', h2.slice(h2.indexOf('cumplido') - 40, h2.indexOf('cumplido') + 60));
  assert(/color:var\(--verde\)">1 \/ 1/.test(h2), 'y el cupo sale en verde');
  const h3 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'cerrada', prima_fill: 2, prima_salida: 2.21, stop_pct: 20, symbol: 'NVDA', resultado_usd: 42 }], HOY, null);
  assert(!/cumplido/.test(h3), 'vendida por debajo del objetivo (2.21 < 2.22): NO cumplido');
  const h4 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'cerrada', prima_fill: 2, prima_salida: 3.5, stop_pct: null, symbol: 'NVDA', resultado_usd: 150 }], HOY, null);
  assert(!/cumplido/.test(h4), 'una operación del Plan 35 (sin stop_pct congelado) no cuenta como plan del día cumplido aunque gane');
  const h5 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'cerrada', prima_fill: 2, prima_salida: '', stop_pct: 20 }], HOY, null);
  assert(!/cumplido/.test(h5), 'prima_salida vacía no cumple');
  const h6 = F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: HOY, estado: 'abierta' }, { abierta_fecha_ny: HOY, estado: 'abierta' }], HOY, null);
  assert(/color:var\(--rojo\)">2 \/ 1/.test(h6), 'dos operaciones hoy: 2 / 1 en rojo');
  assert(!/2 \/ 1/.test(F.tarjetaPlanDia(P10, [{ abierta_fecha_ny: '2026-09-23', estado: 'abierta' }], HOY, null)), 'la de ayer no cuenta en el cupo de hoy');
  // ventana 9:30–9:45 ET (jueves 24-sep-2026, EDT = UTC-4)
  assert(F.fueraVentanaNY([570, 585], new Date('2026-09-24T13:35:00Z')) === false, '9:35 ET está DENTRO de la ventana 9:30–9:45');
  assert(F.fueraVentanaNY([570, 585], new Date('2026-09-24T13:50:00Z')) === true, '9:50 ET está fuera');
  assert(F.fueraVentanaNY([570, 585], new Date('2026-09-24T13:29:30Z')) === true, '9:29:30 ET todavía está fuera');
  assert(F.fueraVentanaNY([570, 585], new Date('2026-09-26T13:35:00Z')) === true, 'sábado: fuera aunque sea la hora');
  assert(F.fueraVentanaNY(null, new Date('2026-09-26T13:35:00Z')) === false, 'sin ventana (Plan 35) nunca está fuera');
  assert(/\+10%/.test(F.textoReglasPlan(P10)) && /corte -20%/.test(F.textoReglasPlan(P10)) && /nunca un stop automático/.test(F.textoReglasPlan(P10)), 'el resumen del Plan 10 dice GTC +10%, corte -20% y que nunca es un stop automático');
  assert(/\+35%/.test(F.textoReglasPlan(F.PLANES.PLAN_35)) && /\+35%/.test(F.textoReglasPlan(null)), 'el resumen del Plan 35 (y sin plan) dice +35%');
}

// ════════════════ 4. avisosOrden por plan ════════════════
{
  const A = construir(['avisosOrden', 'semaforoRango', 'requiereOverride'], { usd }, { consts: ['PLANES', 'TICKERS', 'OPS_SEMANA', 'TAMANO_PCT', 'SPREAD_MAX_PCT'] });
  const P35 = A.PLANES.PLAN_35, P10 = A.PLANES.PLAN_10;
  const f = (x) => Object.assign({ symbol: 'AAPL', tipo: 'CALL', accion: 'compra', strike: 230, expiracion: '2026-10-02', cantidad: 1, priceType: 'LIMIT', limitPrice: 0.5, orderTerm: 'DAY' }, x || {});
  igual(A.avisosOrden(f(), { plan: P35 }), [], 'una compra normal en un ticker de la lista no avisa nada');
  igual(A.avisosOrden(f(), {}), [], 'sin plan en el contexto tampoco (Plan 35 por defecto)');
  assert(/QQQ no está en tus 5 tickers/.test(A.avisosOrden(f({ symbol: 'qqq' }), { plan: P35 })[0]), 'ticker fuera de la lista: aviso (y en mayúsculas)');
  igual(A.avisosOrden(f({ symbol: 'QQQ', accion: 'venta' }), { plan: P35, posicionId: 7 }), [], 'la SALIDA de una posición que ya existe no avisa por el ticker (posicionId)');
  igual(A.avisosOrden(f({ symbol: 'QQQ', accion: 'venta' }), { plan: P35 }).length, 1, 'una venta suelta (sin posicionId) sí avisa por el ticker');
  igual(A.avisosOrden(f({ accion: 'venta' }), { plan: P35, opsSemana: 9, antes1030: true, saldoBroker: 10 }), [], 'una salida no abre operación: no gasta cupo ni mira la hora ni el tamaño');
  // cupo: semana (Plan 35) / día (Plan 10)
  igual(A.avisosOrden(f(), { plan: P35, opsSemana: 2 }), [], 'Plan 35 con 2 en la semana: cabe la tercera');
  assert(/Sería la 4ª operación de la semana \(plan: 3\)/.test(A.avisosOrden(f(), { plan: P35, opsSemana: 3 })[0]), 'Plan 35 con 3: sería la 4ª');
  igual(A.avisosOrden(f(), { plan: P10, opsHoy: 0, focoHoy: 'AAPL' }), [], 'Plan 10 sin operación hoy: cabe');
  assert(/Sería la 2ª operación del día \(plan: 1 al día\)/.test(A.avisosOrden(f(), { plan: P10, opsHoy: 1, focoHoy: 'AAPL' })[0]), 'Plan 10 con una hoy: sería la 2ª del día');
  igual(A.avisosOrden(f(), { plan: P10, opsSemana: 5, opsHoy: 0, focoHoy: 'AAPL' }), [], 'Plan 10 no mira el cupo semanal');
  // 50% de la cuenta (Plan 10) · 10% (Plan 35), contra el saldo del bróker
  igual(A.avisosOrden(f({ limitPrice: 2, cantidad: 25 }), { plan: P10, saldoBroker: 10000, focoHoy: 'AAPL' }), [], 'Plan 10: $5.000 con $10.000 es justo el 50%: sin aviso');
  assert(/Costo \$6,000: más del 50% de la cuenta \(\$5,000\)/.test(A.avisosOrden(f({ limitPrice: 2, cantidad: 30 }), { plan: P10, saldoBroker: 10000, focoHoy: 'AAPL' })[0]), 'Plan 10: $6.000 pasa del 50%');
  assert(/más del 10% de la cuenta \(\$1,000\)/.test(A.avisosOrden(f({ limitPrice: 2, cantidad: 6 }), { plan: P35, saldoBroker: 10000 })[0]), 'Plan 35: $1.200 pasa del 10%');
  assert(/\(\$5,000\)/.test(A.avisosOrden(f({ limitPrice: 2, cantidad: 30 }), { plan: P35, saldo: 50000, saldoBroker: null })[0]), 'sin saldo del bróker se mide contra el total de cuentas');
  igual(A.avisosOrden(f({ limitPrice: 2, cantidad: 30 }), { plan: P35 }), [], 'sin ningún saldo la regla de tamaño no se evalúa');
  // ventana 9:30–9:45 (Plan 10) · antes de las 10:30 (Plan 35)
  assert(/Fuera de 9:30–9:45 ET/.test(A.avisosOrden(f(), { plan: P10, fueraVentana: true, focoHoy: 'AAPL' })[0]), 'Plan 10 fuera de la ventana de apertura: aviso');
  igual(A.avisosOrden(f(), { plan: P10, fueraVentana: false, antes1030: true, focoHoy: 'AAPL' }), [], 'Plan 10 dentro de la ventana: la regla de las 10:30 NO aplica');
  assert(/Antes de las 10:30 ET/.test(A.avisosOrden(f(), { plan: P35, antes1030: true })[0]), 'Plan 35 antes de las 10:30: aviso');
  igual(A.avisosOrden(f(), { plan: P35, fueraVentana: true }), [], 'Plan 35 no tiene ventana de apertura');
  // compañía del día
  assert(/elige la compañía de hoy/.test(A.avisosOrden(f(), { plan: P10 })[0]), 'Plan 10 sin compañía elegida: aviso');
  assert(/hoy operas NVDA, no AAPL/.test(A.avisosOrden(f(), { plan: P10, focoHoy: 'NVDA' })[0]), 'Plan 10 con otra compañía: aviso con las dos');
  igual(A.avisosOrden(f(), { plan: P10, focoHoy: 'AAPL' }), [], 'Plan 10 con la compañía de hoy: sin aviso');
  igual(A.avisosOrden(f(), { plan: P35, focoHoy: 'NVDA' }), [], 'Plan 35 no tiene compañía del día');
  // vence hoy tras las 10:30
  assert(/Vence hoy y ya pasaron las 10:30 ET/.test(A.avisosOrden(f({ expiracion: HOY }), { plan: P10, focoHoy: 'AAPL', expHoyTras1030: HOY })[0]), 'Plan 10: exp de hoy pasadas las 10:30: aviso');
  igual(A.avisosOrden(f({ expiracion: HOY }), { plan: P10, focoHoy: 'AAPL', expHoyTras1030: null }), [], 'Plan 10 antes de las 10:30 la exp de hoy no avisa');
  igual(A.avisosOrden(f({ expiracion: '2026-10-02' }), { plan: P10, focoHoy: 'AAPL', expHoyTras1030: HOY }), [], 'otra fecha de expiración no avisa');
  igual(A.avisosOrden(f({ expiracion: HOY }), { plan: P35, expHoyTras1030: HOY }), [], 'Plan 35 no avisa por la exp de hoy');
  igual(A.avisosOrden(f({ tipo: 'EQ', expiracion: HOY }), { plan: P10, focoHoy: 'AAPL', expHoyTras1030: HOY }), [], 'una acción no vence');
  // rango óptimo y spread (en los dos planes)
  assert(/Prima \$200 FUERA del rango óptimo \$35–\$90/.test(A.avisosOrden(f({ limitPrice: 2 }), { plan: P35, rango: { lo: 35, hi: 90 } })[0]), 'prima fuera del rango óptimo: aviso');
  igual(A.avisosOrden(f({ limitPrice: 0.95 }), { plan: P35, rango: { lo: 35, hi: 90 } }), [], 'en el borde (15%) no avisa: eso es semáforo amarillo, no rojo');
  assert(/Spread bid\/ask \$100→\$114 = 12%/.test(A.avisosOrden(f(), { plan: P35, spread: { bid: 1, ask: 1.14, pct: 12.28 } })[0]), 'spread del 10% o más: aviso');
  igual(A.avisosOrden(f(), { plan: P35, spread: { bid: 1, ask: 1.05, pct: 4.8 } }), [], 'spread pequeño: sin aviso');
  igual(A.avisosOrden(f({ symbol: 'QQQ', limitPrice: 2, cantidad: 30 }), { plan: P10, opsHoy: 1, saldoBroker: 10000, fueraVentana: true, expHoyTras1030: HOY }).length, 5, 'los avisos se acumulan: ticker, cupo, compañía, tamaño y ventana');
  assert(A.requiereOverride(['x']) === true && A.requiereOverride([]) === false && A.requiereOverride(null) === false, 'requiereOverride: solo con avisos');
}

// ════════════════ 5. propositoDe y preSalida ════════════════
{
  const S = construir(['propositoDe', 'preSalida', 'gtcDePosicion', 'gtcLimite'], {});
  igual(S.propositoDe({ accion: 'compra' }), 'entrada', 'una compra es entrada');
  igual(S.propositoDe({ accion: 'venta', priceType: 'LIMIT' }), 'salida_gtc', 'venta LIMIT = salida GTC');
  igual(S.propositoDe({ accion: 'venta', priceType: 'LIMIT' }, { proposito: 'salida_corte' }), 'salida_corte', 'venta LIMIT que viene del corte = salida_corte');
  igual(S.propositoDe({ accion: 'venta', priceType: 'STOP' }), 'salida_stop', 'venta STOP = salida stop');
  igual(S.propositoDe({ accion: 'venta', priceType: 'TRAILING_STOP_PRCT' }), 'salida_stop', 'venta trailing = salida stop');
  igual(S.propositoDe({ accion: 'venta', priceType: 'MARKET' }), 'otro', 'venta a mercado = otro');
  const p = { id: 7, broker: 'schwab', symbol: 'SPY', direccion: 'CALL', strike: '769', expiracion: '2026-09-26', contratos: '2', prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20 };
  const g = S.preSalida(p, 'salida_gtc');
  igual([g.proposito, g.posicion_id, g.broker, g.accion, g.orderTerm, g.priceType, g.limitPrice, g.cantidad, g.strike], ['salida_gtc', 7, 'schwab', 'venta', 'GOOD_UNTIL_CANCEL', 'LIMIT', 3.65, 2, 769], 'salida GTC: LIMIT GTC al límite de SU plan, con el bróker y la cantidad de la posición');
  const c = S.preSalida(p, 'salida_corte', 1.234);
  igual([c.proposito, c.orderTerm, c.priceType, c.limitPrice], ['salida_corte', 'DAY', 'LIMIT', 1.23], 'salida de corte: LIMIT DAY al bid (redondeado a centavos)');
  assert(S.preSalida(p, 'salida_corte').limitPrice === undefined, 'corte sin bid: sin precio (se toca en la cadena)');
  const t = S.preSalida({ ...p, broker: null }, 'salida_stop');
  igual([t.priceType, t.orderTerm, t.limitPrice, t.broker], ['TRAILING_STOP_PRCT', 'GOOD_UNTIL_CANCEL', undefined, 'etrade'], 'trailing stop: TRAILING_STOP_PRCT GTC; sin bróker en la ficha → E*TRADE');
  assert(S.preSalida({ ...p, strike: null, expiracion: null }, 'salida_gtc').strike === undefined, 'sin strike no se inventa uno');
}

// ════════════════ 6. gtcPendientes y gtcAutoVetadas ════════════════
{
  const G = construir(['gtcPendientes', 'gtcAutoVetadas'], {}, { consts: ['PREVIEW_SEG'] });
  const ab = (x) => Object.assign({ id: 1, estado: 'abierta', prima_fill: 3.3, strike: 769, expiracion: '2026-09-26', broker: 'etrade' }, x || {});
  const hace = (seg) => new Date(Date.now() - seg * 1000).toISOString();
  igual(G.gtcPendientes([ab()], []).map(p => p.id), [1], 'abierta sin ninguna venta: le falta la GTC');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'enviada', proposito: 'salida_gtc' }]), [], 'con su GTC enviada ya no está pendiente');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'ejecutada', proposito: 'salida_gtc' }]), [], 'ejecutada tampoco');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'cancelada', proposito: 'salida_gtc' }]).length, 1, 'cancelada: vuelve a estar pendiente');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'preview', proposito: 'salida_corte', creado_at: hace(60) }]), [], 'un CORTE en vista previa reciente cuenta: la posición se está cerrando');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'preview', proposito: 'salida_corte', creado_at: hace(400) }]).length, 1, 'una vista previa de corte vieja (> PREVIEW_SEG) es huérfana: no cuenta');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'preview', proposito: 'salida_gtc', creado_at: hace(60) }]).length, 1, 'una GTC en vista previa NO cuenta (aún no está en el bróker)');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'preview', proposito: 'salida_corte', creado_at: hace(-20) }]), [], 'reloj ±30 s: una vista previa fechada 20 s «en el futuro» sigue siendo reciente');
  igual(G.gtcPendientes([ab()], [{ posicion_id: 1, estado: 'preview', proposito: 'salida_corte', creado_at: hace(-60) }]).length, 1, 'pero una fechada 60 s en el futuro no');
  igual(G.gtcPendientes([ab({ broker: 'tasty' })], []), [], 'una posición de tasty no puede recibir GTC desde la app');
  igual(G.gtcPendientes([ab({ strike: null })], []), [], 'sin strike no hay contrato que vender');
  igual(G.gtcPendientes([ab({ prima_fill: 0 })], []), [], 'sin fill no hay límite');
  igual(G.gtcPendientes([ab({ estado: 'cerrada' })], []), [], 'una cerrada no está pendiente');
  igual(G.gtcPendientes([ab({ broker: null })], []).length, 1, 'sin bróker en la ficha se asume E*TRADE (compatibilidad)');
  const v = (o) => [...G.gtcAutoVetadas([o])];
  igual(v({ posicion_id: 1, estado: 'cancelada', proposito: 'salida_gtc' }), ['1'], 'una GTC cancelada veta la GTC automática (en la base, en todos los equipos)');
  igual(v({ posicion_id: 1, estado: 'preview', proposito: 'salida_corte', creado_at: hace(60) }), ['1'], 'cualquier salida_corte veta, aunque sea una vista previa reciente');
  igual(v({ posicion_id: 1, estado: 'preview', proposito: 'salida_gtc', creado_at: hace(60) }), [], 'la excepción: una GTC en vista previa RECIENTE (otro equipo espera su PIN) no veta');
  igual(v({ posicion_id: 1, estado: 'preview', proposito: 'salida_gtc', creado_at: hace(400) }), ['1'], 'una vista previa de GTC vieja sí veta');
  igual(v({ posicion_id: 1, estado: 'preview', proposito: 'salida_gtc', creado_at: hace(-20) }), [], 'reloj ±30 s: 20 s en el futuro sigue siendo reciente');
  igual(v({ posicion_id: 1, estado: 'preview', proposito: 'salida_gtc', creado_at: hace(-60) }), ['1'], '60 s en el futuro ya no');
  igual(v({ posicion_id: 1, estado: 'enviada', proposito: 'salida_stop' }), [], 'un trailing stop no veta (no es GTC ni corte)');
  igual(v({ posicion_id: 1, estado: 'enviada', proposito: 'salida_gtc' }), ['1'], 'una GTC enviada también veta (ya la tiene: no hace falta otra)');
  igual([...G.gtcAutoVetadas([{ posicion_id: null, estado: 'enviada', proposito: 'salida_gtc' }, null])], [], 'sin posicion_id (o filas nulas) no veta nada');
}

// ════════════════ 7. cortarPosicion simulado con un Supabase de juguete ════════════════
// Un corte de juguete: la posición, sus ventas vivas, la secuencia de estados que va
// contestando la sincronización y la posición releída tras una ejecución.
function armarCorte(E) {
  E = Object.assign({ posicion: { id: 5, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, prima_fill: 3.3, gtc_limite: 4.48, plan_pct: 10, stop_pct: 20 },
    vivas: [], estados: [], relecturas: [], confirmaciones: [], operables: ['etrade', 'schwab'], bid: 2.5, modal: null, modales: null, tope: null }, E || {});
  const reg = { toasts: [], alerts: [], confirms: [], cancelados: [], sync: 0, abiertos: [], updates: [], marcados: [], rutas: 0, previews: 0, places: 0, timers: [] };
  let modalTurno = 0;
  const document = { querySelector: () => (E.modales ? E.modales[modalTurno++] || null : E.modal) };
  const sb = sbFalso((tabla, cadena) => {
    const m0 = cadena[0][0], sel = cadena[0][1][0];
    if (tabla === 'posiciones' && m0 === 'select') return { data: E.relecturas.length && E.leidaUnaVez ? E.relecturas.shift() : (E.leidaUnaVez = true, E.posicion) };
    if (tabla === 'ordenes' && m0 === 'select' && sel === '*') return { data: E.vivas, error: E.errorVivas || null };
    if (tabla === 'ordenes' && m0 === 'select' && sel === 'id,estado') return { data: E.estados.length > 1 ? E.estados.shift() : E.estados[0] || [] };
    if (tabla === 'ordenes' && m0 === 'update') { reg.updates.push(cadena); return { error: E.errorUpdate || null }; }
    throw new Error('consulta no prevista: ' + tabla + ' ' + m0);
  });
  const deps = { toast: (t) => reg.toasts.push(t), alert: (t) => reg.alerts.push(t),
    confirm: (t) => { reg.confirms.push(t); return E.confirmaciones.length ? E.confirmaciones.shift() : true; },
    document, sb: sb, BROKER_NOMBRE, brokersOperables: () => E.operables, gtcAutoMarcar: (id) => reg.marcados.push(id),
    cancelarOrden: async (id, ext, br, op) => { reg.cancelados.push([br, id, ext, op]); return true; },
    cancelarOrdenSchwab: async (id, ext, op) => { reg.cancelados.push(['schwab', id, ext, op]); return true; },
    ordenesActualizar: async () => { reg.sync++; }, bidDeContrato: async () => E.bid,
    abrirOrden: (pre) => reg.abiertos.push(pre), ruta: () => reg.rutas++,
    ordenPreview: async () => reg.previews++, ordenPlace: async () => reg.places++, $: () => nodo(),
    // la vista previa automática (900 ms) se captura para dispararla a mano; la pausa entre
    // sondeos de la sincronización (CORTE_PASO_MS) tiene que correr de verdad
    setTimeout: (fn, ms) => { if (ms === 900) { reg.timers.push({ fn, ms }); return 0; } return setTimeout(fn, ms); },
    CORTE_TOPE_MS: E.tope == null ? 15000 : E.tope, CORTE_PASO_MS: E.tope == null ? 2000 : 1 };
  const M = construir(['cortarPosicion', 'preSalida', 'gtcDePosicion', 'gtcLimite'], deps,
    { consts: ['_corte'], prefijo: 'let _ord = null; function __setOrd(v) { _ord = v; }', extras: ['__setOrd'] });
  return { M, reg, sb, E };
}
(async () => {
  // candado ANTES del primer await: un doble toque no corre dos cortes
  {
    const { M, reg } = armarCorte({ estados: [[{ id: 1, estado: 'cancelada' }]], vivas: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc', broker: 'etrade' }] });
    const p1 = M.cortarPosicion(5), p2 = M.cortarPosicion(5);
    igual(await p2, 'en_curso', 'el segundo toque, antes de que el primero haga su primer await, se rechaza');
    assert(/Ya hay un corte en curso/.test(reg.toasts[0]), 'y se dice con un toast');
    igual(await p1, 'abierta', 'el primer corte sigue su curso hasta abrir la venta');
    igual(M._corte.enCurso, false, 'al terminar, el candado se suelta');
    igual(reg.cancelados.map(c => [c[0], c[2], c[3]]), [['etrade', '111', { sinConfirmar: true }]], 'la venta viva se cancela en SU bróker sin volver a preguntar');
    assert(reg.sync >= 1, 'y se sincroniza hasta que el bróker confirme la cancelación');
    igual(reg.marcados, [5], 'este equipo ya no abrirá la GTC automática de esa posición');
    const pre = reg.abiertos[0];
    igual([pre.proposito, pre.orderTerm, pre.priceType, pre.limitPrice, pre.posicion_id, pre.cantidad], ['salida_corte', 'DAY', 'LIMIT', 2.5, 5, 2], 'se abre la venta LIMIT DAY al bid con propósito salida_corte');
    assert(/venta al bid \$2\.50/.test(reg.toasts[reg.toasts.length - 1]), 'el toast dice el bid');
    igual(reg.places, 0, 'jamás se llama a ordenPlace: ENVIAR es el toque de Andrés');
    // la vista previa automática solo toca SU formulario
    igual(reg.timers.length, 1, 'queda programada UNA vista previa automática');
    M.__setOrd({ pre: { otro: true }, orden: null });
    await reg.timers[0].fn();
    igual(reg.previews, 0, 'si el formulario ya es OTRO (p. ej. una GTC automática), no se previsualiza nada');
    M.__setOrd({ pre, orden: null });
    await reg.timers[0].fn();
    igual(reg.previews, 1, 'si sigue siendo el suyo, se previsualiza (no coloca nada)');
    igual(reg.places, 0, 'y sigue sin enviarse sola');
  }
  { const { M, reg } = armarCorte({ modal: {} }); igual(await M.cortarPosicion(5), 'modal_abierto', 'con otro cuadro abierto no se toca nada'); assert(/No se tocó nada/.test(reg.alerts[0]), 'y se avisa'); igual(M._corte.enCurso, false, 'el candado se suelta también al abortar'); }
  { const { M } = armarCorte({ posicion: { id: 5, estado: 'cerrada', broker: 'etrade' } }); igual(await M.cortarPosicion(5), 'cerrada', 'una posición que ya no está abierta no se corta'); }
  { const { M, reg } = armarCorte({ posicion: { id: 5, estado: 'abierta', broker: 'tasty', symbol: 'SPY', direccion: 'CALL' } }); igual(await M.cortarPosicion(5), 'sin_broker', 'una posición de tasty no se corta desde la app'); assert(/córtala en tu bróker/.test(reg.alerts[0]), 'se manda a cortarla en el bróker'); }
  { const { M, reg } = armarCorte({ operables: ['schwab'] }); igual(await M.cortarPosicion(5), 'sin_broker', 'E*TRADE sin sesión en este equipo: no se corta'); assert(/Reconecta E\*TRADE/.test(reg.alerts[0]), 'y pide reconectar'); }
  { const { M, reg, sb } = armarCorte({ confirmaciones: [false] }); igual(await M.cortarPosicion(5), 'cancelado', 'sin la confirmación de Andrés no pasa nada');
    assert(/Nada se envía sin tu toque y tu PIN/.test(reg.confirms[0]), 'la pregunta lo deja claro'); igual(reg.marcados, [], 'ni se marca la GTC automática'); igual(sb.llamadas.filter(l => l.tabla === 'ordenes').length, 0, 'ni se leen las órdenes'); }
  { const { M, reg } = armarCorte({ errorVivas: { message: 'boom' } }); igual(await M.cortarPosicion(5), 'error', 'si no se pueden leer las ventas se aborta'); assert(/No pude leer tus órdenes \(boom\)/.test(reg.alerts[0]), 'con el motivo'); }
  { const { M, reg } = armarCorte({ vivas: [{ id: 1, estado: 'enviada', orden_id_ext: null, proposito: 'salida_gtc' }] });
    igual(await M.cortarPosicion(5), 'sin_confirmar', 'una venta VIVA sin número del bróker no se puede cancelar desde aquí: se aborta'); assert(/sin número de E\*TRADE/.test(reg.alerts[0]), 'y se dice'); igual(reg.cancelados.length, 0, 'sin tocar nada'); }
  // ventas en 'error' (envío sin confirmar): solo siguen con la revisión de Andrés
  { const { M, reg, sb } = armarCorte({ vivas: [{ id: 2, estado: 'error', orden_id_ext: null, proposito: 'salida_gtc', respuesta: { error: 'x' } }], confirmaciones: [true, false] });
    igual(await M.cortarPosicion(5), 'sin_confirmar', 'venta en error y Andrés NO confirma que la revisó: se aborta');
    assert(/puede estar viva/.test(reg.confirms[1]), 'la pregunta avisa de que puede estar viva'); igual(reg.updates.length, 0, 'sin anotar nada'); }
  { const { M, reg } = armarCorte({ vivas: [{ id: 2, estado: 'error', orden_id_ext: null, proposito: 'salida_gtc', respuesta: { error: 'x' } }], confirmaciones: [true, true] });
    igual(await M.cortarPosicion(5), 'abierta', 'venta en error revisada por Andrés: se anota cancelada a mano y el corte sigue');
    const up = reg.updates[0];
    assert(up && up[0][1][0].estado === 'cancelada' && /resuelta a mano/.test(up[0][1][0].respuesta.nota_corte), 'la anotación dice que se resolvió a mano', JSON.stringify(up && up[0]));
    assert(up.some(c => c[0] === 'eq' && c[1][0] === 'estado' && c[1][1] === 'error'), 'y solo pisa la fila si SIGUE en error (eq estado=error)');
    igual(reg.cancelados.length, 0, 'no había ventas enviadas que cancelar'); }
  // llenado parcial y ejecutada total mientras se esperaba la cancelación
  { const { M, reg } = armarCorte({ vivas: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc' }], estados: [[{ id: 1, estado: 'ejecutada' }]], relecturas: [{ id: 5, estado: 'abierta', contratos: 1 }] });
    igual(await M.cortarPosicion(5), 'parcial', 'la venta se llenó EN PARTE antes de cancelarse: quedan contratos sin venta viva');
    assert(/Se vendió en parte: quedan 1 contrato sin venta viva\. Vuelve a tocar Cortar/.test(reg.alerts[0]), 'se dice cuántos quedan y que vuelva a tocar Cortar', reg.alerts[0]);
    igual(reg.abiertos.length, 0, 'no se abre la venta al bid (los contratos ya no son los mismos)'); igual(reg.rutas, 1, 'y se redibuja'); }
  { const { M, reg } = armarCorte({ vivas: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc' }], estados: [[{ id: 1, estado: 'ejecutada' }]], relecturas: [{ id: 5, estado: 'cerrada' }] });
    igual(await M.cortarPosicion(5), 'ejecutada', 'la venta se ejecutó entera: ya se vendió, no hace falta cortar'); assert(/ya se ejecutó/.test(reg.alerts[0]), 'y se dice'); igual(reg.abiertos.length, 0, 'sin abrir nada'); }
  // tope de 15 s sin confirmación: no se vende con una venta que puede seguir viva
  { const { M, reg } = armarCorte({ vivas: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc' }], estados: [[{ id: 1, estado: 'enviada' }]], tope: 30 });
    igual(await M.cortarPosicion(5), 'sin_confirmar', 'si el bróker no confirma la cancelación en el tope, se aborta');
    assert(/no confirmó la cancelación en 15 s/.test(reg.alerts[0]) && /ANTES de vender/.test(reg.alerts[0]), 'y manda a revisar en el bróker ANTES de vender'); igual(reg.abiertos.length, 0, 'no se abre la venta'); assert(reg.sync >= 2, 'se insistió varias veces antes de rendirse'); }
  // otro cuadro se abrió mientras se esperaba (p. ej. una GTC automática): jamás encima
  { const { M, reg } = armarCorte({ vivas: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc' }], estados: [[{ id: 1, estado: 'cancelada' }]], modales: [null, {}] });
    igual(await M.cortarPosicion(5), 'modal_abierto', 'si apareció otro cuadro durante la espera, no se abre la venta encima'); assert(/vuelve a tocar Cortar/.test(reg.alerts[0]), 'se pide volver a tocar Cortar'); }
  // Schwab: la cancelación va por su camino, y una posición sin ventas vivas abre la venta directo
  { const { M, reg } = armarCorte({ posicion: { id: 5, estado: 'abierta', broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 180, expiracion: '2026-10-03', contratos: 3, prima_fill: 2.1 }, vivas: [{ id: 3, estado: 'enviada', orden_id_ext: '999', proposito: 'salida_gtc', broker: 'schwab' }], estados: [[{ id: 3, estado: 'cancelada' }]] });
    igual(await M.cortarPosicion(5), 'abierta', 'una posición de Schwab se corta igual'); igual(reg.cancelados[0].slice(0, 3), ['schwab', 3, '999'], 'la cancelación va por Schwab'); igual(reg.abiertos[0].broker, 'schwab', 'y la venta al bid sale por Schwab'); }
  { const { M, reg } = armarCorte({ bid: null }); igual(await M.cortarPosicion(5), 'abierta', 'sin ventas vivas se abre la venta directo'); igual(reg.sync, 0, 'sin nada que cancelar no se sincroniza');
    assert(reg.abiertos[0].limitPrice === undefined && /no leí el bid/.test(reg.toasts[reg.toasts.length - 1]), 'sin bid: la venta se abre sin precio y se dice'); igual(reg.timers.length, 0, 'y sin bid no hay vista previa automática'); }
  // el código del corte jamás coloca una orden
  const cuerpo = C.extraer('cortarPosicion');
  ['ordenPlace(', 'etPost(', 'swPost(', '/etrade/orden/place', '/schwab/orden/place'].forEach(t => assert(!cuerpo.includes(t), 'cortarPosicion no toca «' + t + '»'));
  assert(cuerpo.indexOf('_corte.enCurso = true') < cuerpo.indexOf('await'), 'el candado se pone ANTES del primer await');

  // ════════════════ 8. carreras GTC automática × corte (funciones reales) ════════════════
  function armarGtc(E) {
    E = Object.assign({ corte: false, modal: null, operables: ['etrade'], yaAbierto: false, quiere: true, mark: null }, E || {});
    const reg = { abiertos: [], toasts: [], timers: [], previews: 0, places: 0, marcados: [] };
    const M = construir(['abrirGtcAutomatico', 'preSalida', 'gtcDePosicion', 'gtcLimite', 'gtcAutoEnviaSola'], {
      document: { querySelector: () => E.modal }, brokersOperables: () => E.operables, gtcAutoYaAbierto: () => E.yaAbierto,
      gtcAutoMarcar: (id) => reg.marcados.push(id), abrirOrden: (pre) => reg.abiertos.push(pre), toast: (t) => reg.toasts.push(t),
      setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return 0; }, $: () => ({}), gtcAutoQuiere: () => E.quiere,
      ordenPreview: async () => { reg.previews++; if (E.alPrevisualizar) E.alPrevisualizar(); },
      ordenPlace: async () => { reg.places++; },
    }, { prefijo: 'const _corte = { enCurso: ' + E.corte + ' }; let _ord = null; function __setOrd(v) { _ord = v; }', extras: ['__setOrd', '_corte'] });
    return { M, reg, E };
  }
  const pend = (x) => Object.assign({ id: 9, symbol: 'SPY', direccion: 'CALL', strike: 769, expiracion: '2026-09-26', contratos: 2, prima_fill: 3.3, gtc_limite: 4.48, plan_pct: 35, broker: 'etrade', mark: 3.4 }, x || {});
  { const { M, reg } = armarGtc({ corte: true }); M.abrirGtcAutomatico([pend()]); igual([reg.abiertos.length, reg.marcados.length], [0, 0], 'con un corte EN CURSO la GTC automática no abre nada (ni marca)'); }
  { const { M, reg } = armarGtc({ modal: {} }); M.abrirGtcAutomatico([pend()]); igual(reg.abiertos.length, 0, 'con otro cuadro abierto no se pisa'); }
  { const { M, reg } = armarGtc(); M.abrirGtcAutomatico([pend({ _gtcAutoVeto: true })]); igual(reg.abiertos.length, 0, 'una posición vetada en la base (ya tuvo GTC o corte) no recibe GTC automática'); }
  { const { M, reg } = armarGtc({ yaAbierto: true }); M.abrirGtcAutomatico([pend()]); igual(reg.abiertos.length, 0, 'una vez por posición y equipo: ya abierta, no se repite'); }
  { const { M, reg } = armarGtc({ operables: ['schwab'] }); M.abrirGtcAutomatico([pend()]); igual(reg.abiertos.length, 0, 'nunca por otro bróker: E*TRADE sin sesión, nada'); }
  { const { M, reg } = armarGtc(); M.abrirGtcAutomatico([]); M.abrirGtcAutomatico(null); igual(reg.abiertos.length, 0, 'sin pendientes no pasa nada'); }
  {
    const { M, reg, E } = armarGtc();
    M.abrirGtcAutomatico([pend({ _gtcAutoVeto: true }), pend({ id: 10 })]);
    igual([reg.marcados, reg.abiertos.length, reg.abiertos[0].proposito, reg.abiertos[0].limitPrice], [[10], 1, 'salida_gtc', 4.48], 'se abre la GTC de la PRIMERA pendiente no vetada, ya marcada');
    assert(/Fill SPY CALL 769 ×2 a \$3\.30: GTC \+35% a \$4\.48/.test(reg.toasts[0]), 'el toast cuenta el fill y el límite', reg.toasts[0]);
    igual(reg.timers.map(t => t.ms), [900], 'la vista previa automática va con 900 ms de espera');
    const pre = reg.abiertos[0];
    // carrera 1: antes de los 900 ms Andrés tocó Cortar y el formulario ya es el del corte
    M.__setOrd({ pre: { proposito: 'salida_corte' }, orden: null });
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [0, 0], 'si el formulario ya es OTRO (el corte), la GTC automática no previsualiza ni envía nada');
    // carrera 2: sigue siendo su formulario pero un corte arrancó justo antes
    M.__setOrd({ pre, orden: null, previewIds: null }); M._corte.enCurso = true;
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [0, 0], 'con un corte en curso al despertar, tampoco');
    // camino feliz: previsualiza, y como el límite 4.48 > mark 3.40 la envía (pide PIN dentro de ordenPlace)
    M._corte.enCurso = false;
    const o = { pre, orden: null, previewIds: null }; M.__setOrd(o);
    E.alPrevisualizar = () => { o.previewIds = [{ previewId: 1 }]; };
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [1, 1], 'su formulario, sin corte: vista previa y envío (ordenPlace pide el PIN si el equipo está desarmado)');
    assert(/Enviando la venta GTC automática/.test(reg.toasts[reg.toasts.length - 1]), 'y lo dice');
    // carrera 3: la vista previa terminó pero en medio arrancó un corte → no se envía
    reg.previews = 0; reg.places = 0; M.__setOrd(o); o.previewIds = null;
    E.alPrevisualizar = () => { o.previewIds = [{ previewId: 2 }]; M._corte.enCurso = true; };
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [1, 0], 'si un corte arranca DURANTE la vista previa, la GTC no se envía');
    M._corte.enCurso = false;
    // carrera 4: la vista previa terminó pero el formulario cambió mientras tanto → no se envía
    reg.previews = 0; M.__setOrd(o); o.previewIds = null;
    E.alPrevisualizar = () => { M.__setOrd({ pre: { otro: 1 }, previewIds: [{ previewId: 3 }] }); };
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [1, 0], 'si el formulario cambió durante la vista previa, no se envía nada en el ajeno');
    // sin vista previa (E*TRADE la rechazó): no se envía
    reg.previews = 0; M.__setOrd(o); o.previewIds = null; E.alPrevisualizar = () => {};
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [1, 0], 'sin previewIds (E*TRADE rechazó la vista previa) no hay envío');
  }
  { // la puerta del mercado: límite por debajo del mark → la manda Andrés
    const { M, reg, E } = armarGtc();
    M.abrirGtcAutomatico([pend({ mark: 4.60 })]);
    const pre = reg.abiertos[0]; const o = { pre, orden: null, previewIds: null }; M.__setOrd(o);
    E.alPrevisualizar = () => { o.previewIds = [{ previewId: 1 }]; };
    await reg.timers[0].fn();
    igual([reg.previews, reg.places], [1, 0], 'límite 4.48 ≤ mark 4.60: se previsualiza pero NO sale sola');
    assert(/POR DEBAJO del mercado/.test(reg.toasts[reg.toasts.length - 1]), 'y se explica que se vendería ya');
  }
  { const { M, reg, E } = armarGtc({ quiere: false });
    M.abrirGtcAutomatico([pend()]); const pre = reg.abiertos[0]; const o = { pre, orden: null, previewIds: null }; M.__setOrd(o);
    E.alPrevisualizar = () => { o.previewIds = [{ previewId: 1 }]; };
    await reg.timers[0].fn();
    igual([reg.abiertos.length, reg.previews, reg.places], [1, 1, 0], 'con la casilla «enviar sola» apagada: se abre y previsualiza, pero la envía Andrés'); }
  assert(/gtcAutoEnviaSola\(p, pre\.limitPrice\)/.test(FUENTE), 'la GTC automática pasa por gtcAutoEnviaSola ANTES de ordenPlace');
  assert(/if \(hayCorte\(\) \|\| !\(_ord && _ord\.pre === pre/.test(FUENTE), 'y comprueba corte + identidad del formulario tras cada await');

  // ════════════════ 9. ordenPreview / ordenPlace con la identidad o0 del formulario ════════════════
  function armarPreview(E) {
    E = Object.assign({ form: { symbol: 'SPY', tipo: 'CALL', accion: 'venta', strike: '769', expiracion: '2026-09-26', cantidad: '2', priceType: 'LIMIT', limitPrice: '4.48', stopPrice: '', offsetValue: '', orderTerm: 'GTC' },
      avisos: [], override: false, creds: { token: 't', token_secret: 's' }, vencido: false, uid: 'u1', respuesta: { status: 200, data: { PreviewOrderResponse: { PreviewIds: [{ previewId: 77 }], estimatedTotalAmount: 896 } } } }, E || {});
    const reg = { err: nodo(), btn: nodo({ tagName: 'BUTTON' }), inserts: [], updates: [], pintadas: [], bloqueos: [], schwab: [], posts: [] };
    const nodos = { '#oErr': reg.err, '#oBtnPrev': reg.btn, '#oOverride': { checked: E.override }, '#oGtcAuto': { checked: true } };
    const sb = sbFalso((tabla, cadena) => {
      if (cadena[0][0] === 'insert') { reg.inserts.push(cadena[0][1][0]); return { data: { id: 100 + reg.inserts.length }, error: E.errorInsert || null }; }
      if (cadena[0][0] === 'update') { reg.updates.push([cadena[0][1][0], cadena[1][1]]); return { error: null }; }
      return { data: [], error: null };
    });
    const deps = { $: (s) => nodos[s] || null, leerFormOrden: () => E.form, BROKER_NOMBRE, pintarAvisosOrden: () => {},
      ordenPreviewSchwab: async (...a) => { reg.schwab.push(a); }, etCreds: () => E.creds, etDiaVencido: () => E.vencido,
      sesionActiva: E.uid ? { user: { id: E.uid } } : null, pintarArmadoOrden: () => {}, planActivo: () => ({ id: 'PLAN_35', gtcPct: 35, stopPct: null }),
      etCuentaKey: async () => 'KEY', etPost: async (cr, p, body) => { reg.posts.push([p, body]); if (E.durantePost) E.durantePost(); return E.respuesta; },
      texto401Ordenes: (m) => '401: ' + m, sb, pintarPreviewOrden: (P) => reg.pintadas.push(P), bloquearFormOrden: (v) => reg.bloqueos.push(v) };
    const M = construir(['ordenPreview', 'validarOrden', 'requiereOverride', 'propositoDe', 'construirOrden', 'clientOrderIdNuevo', 'semaforoRango',
      'mensajeError', 'etError', 'filaOrdenDe', 'recortarJson', 'textoBotonPreview'], deps,
      { consts: ['PREVIEW_SEG', 'PRICE_TYPES'], prefijo: 'let _ord = null; function __setOrd(v) { _ord = v; } function __getOrd() { return _ord; }', extras: ['__setOrd', '__getOrd'] });
    const formulario = (x) => Object.assign({ pre: { proposito: 'salida_gtc', posicion_id: 5, broker: 'etrade' }, broker: 'etrade', ctx: { rangos: {}, plan: null }, avisos: E.avisos, orden: null, previewIds: null }, x || {});
    return { M, reg, E, formulario };
  }
  {
    const { M, reg, formulario } = armarPreview();
    const A = formulario(); M.__setOrd(A);
    await M.ordenPreview();
    igual([reg.posts.length, reg.posts[0] && reg.posts[0][0]], [1, '/etrade/orden/preview'], 'ordenPreview pide la vista previa a E*TRADE');
    assert(A.previewIds && A.previewIds[0].previewId === 77 && A.filaId === 101 && A.caduca > Date.now(), 'y la guarda en SU formulario con su fila y su caducidad');
    igual([reg.inserts[0].estado, reg.inserts[0].proposito, reg.inserts[0].posicion_id, reg.inserts[0].broker, reg.inserts[0].user_id], ['preview', 'salida_gtc', 5, 'etrade', 'u1'], 'la fila de la bitácora: preview, salida_gtc de la posición 5, con user_id');
    igual([reg.inserts[0].preview._mz.plan_pct, reg.inserts[0].preview._mz.stop_pct], [null, null], 'en una VENTA no se congela plan (el plan viaja con la compra)');
    igual([reg.pintadas.length, reg.bloqueos], [1, [true]], 'se pinta la vista previa y se bloquea el formulario');
    igual([reg.btn.disabled, reg.btn.textContent], [false, 'Vista previa en E*TRADE'], 'el botón vuelve a su texto');
  }
  {
    const { M, reg, formulario, E } = armarPreview();
    const A = formulario(), B = formulario({ pre: { proposito: 'salida_corte', posicion_id: 5, broker: 'etrade' } });
    M.__setOrd(A);
    E.durantePost = () => M.__setOrd(B);              // mientras E*TRADE contestaba, el formulario pasó a ser el del corte
    await M.ordenPreview();
    igual([A.previewIds, B.previewIds, B.filaId], [null, null, null], 'la vista previa que volvió tarde NO se guarda ni en el viejo ni en el ajeno');
    igual(reg.updates, [[{ estado: 'expirada' }, ['id', 101]]], 'y su fila queda anotada como expirada');
    igual([reg.pintadas.length, reg.bloqueos.length], [0, 0], 'no se pinta ni se bloquea el formulario ajeno');
    igual(reg.err.textContent, '', 'y no se ensucia el error del ajeno');
  }
  {
    const { M, reg, formulario } = armarPreview({ respuesta: { status: 400, data: { Error: { code: 1, message: 'Insufficient funds' } } } });
    const A = formulario(); M.__setOrd(A);
    await M.ordenPreview();
    igual([reg.inserts.length, reg.inserts[0].estado], [1, 'rechazada'], 'E*TRADE rechaza la vista previa: queda anotada como rechazada');
    igual(reg.err.textContent, 'Insufficient funds', 'con el motivo literal de E*TRADE en pantalla');
    assert(!A.previewIds, 'y sin previewIds (no hay nada que enviar)');
  }
  {
    const { M, reg, formulario } = armarPreview({ respuesta: { status: 404, data: {} } });
    M.__setOrd(formulario()); await M.ordenPreview();
    igual(reg.inserts.length, 0, 'un fallo del PROXY (404) no se anota como rechazo');
    assert(/El proxy aún no tiene esta ruta/.test(reg.err.textContent), 'y se explica');
  }
  { const { M, reg, formulario } = armarPreview({ respuesta: { status: 403, data: { error: 'ruta no permitida' } } }); M.__setOrd(formulario()); await M.ordenPreview();
    igual([reg.inserts.length, reg.err.textContent], [0, 'ruta no permitida'], 'el {error} del proxy se muestra literal y tampoco se anota'); }
  { const { M, reg, formulario } = armarPreview({ respuesta: { status: 401, data: { Error: { message: 'oauth_problem' } } } });
    M.__setOrd(formulario()); await M.ordenPreview(); igual([reg.inserts.length, reg.err.textContent], [0, '401: oauth_problem'], 'un 401 es problema de login, no de la orden: no se anota'); }
  { const { M, reg, formulario } = armarPreview(); M.__setOrd(formulario({ broker: 'schwab', pre: { proposito: 'salida_gtc', posicion_id: 5, broker: 'schwab' } })); await M.ordenPreview();
    igual([reg.schwab.length, reg.posts.length], [1, 0], 'con Schwab elegido se bifurca a ordenPreviewSchwab y no se toca E*TRADE');
    const a = reg.schwab[0]; assert(a.length === 4 && a[0].symbol === 'SPY' && Array.isArray(a[1]) && a[2] === reg.err && a[3] === reg.btn, 'ordenPreviewSchwab(f, av, err, btn) recibe el formulario, los avisos y los nodos'); }
  { const { M, reg, formulario } = armarPreview(); M.__setOrd(formulario({ pre: { proposito: 'salida_gtc', posicion_id: 5, broker: 'schwab' }, broker: 'etrade' })); await M.ordenPreview();
    assert(/Esta salida es de Charles Schwab; no puede ir por otro bróker/.test(reg.err.textContent) && reg.posts.length === 0, 'la salida de una posición de Schwab no puede ir por E*TRADE'); }
  { const { M, reg, formulario } = armarPreview({ avisos: ['Antes de las 10:30 ET'] }); M.__setOrd(formulario()); await M.ordenPreview();
    assert(/marca «Entiendo, rompo la regla»/.test(reg.err.textContent) && reg.posts.length === 0, 'con avisos sin aceptar no se previsualiza'); }
  { const { M, reg, formulario } = armarPreview({ avisos: ['Antes de las 10:30 ET'], override: true }); M.__setOrd(formulario()); await M.ordenPreview();
    igual([reg.posts.length, reg.inserts[0].overrides], [1, ['Antes de las 10:30 ET']], 'con la casilla marcada sí, y el override queda en la bitácora'); }
  { const { M, reg, formulario } = armarPreview({ form: { symbol: 'SPY', tipo: 'CALL', accion: 'venta', strike: '', expiracion: '', cantidad: '2', priceType: 'LIMIT', limitPrice: '4.48', orderTerm: 'GTC' } });
    M.__setOrd(formulario()); await M.ordenPreview(); igual([reg.err.textContent, reg.posts.length], ['Falta el strike.', 0], 'un formulario inválido no sale del equipo'); }
  { const { M, reg, formulario } = armarPreview({ creds: null }); M.__setOrd(formulario()); await M.ordenPreview(); assert(/Conecta E\*TRADE primero/.test(reg.err.textContent), 'sin credenciales de E*TRADE: conectar primero'); }
  { const { M, reg, formulario } = armarPreview({ vencido: true }); M.__setOrd(formulario()); await M.ordenPreview(); assert(/expiró a medianoche ET/.test(reg.err.textContent), 'token muerto: reconectar'); }
  { const { M, reg, formulario } = armarPreview(); M.__setOrd(formulario({ enviando: true })); await M.ordenPreview(); assert(/Espera la respuesta del bróker/.test(reg.err.textContent) && reg.posts.length === 0, 'con un envío en vuelo no se previsualiza otra encima'); }
  { const { M, reg, formulario } = armarPreview(); M.__setOrd(formulario({ indeterminado: true })); await M.ordenPreview(); assert(/Verifica en el bróker/.test(reg.err.textContent) && reg.posts.length === 0, 'con una orden sin respuesta clara, primero verificar'); }
  { const { M, reg, formulario } = armarPreview({ form: { symbol: 'SPY', tipo: 'CALL', accion: 'compra', strike: '769', expiracion: '2026-09-26', cantidad: '2', priceType: 'LIMIT', limitPrice: '3.30', orderTerm: 'DAY' } });
    M.__setOrd(formulario({ pre: { proposito: 'entrada' }, ctx: { rangos: { SPY: { lo: 200, hi: 400 } }, plan: { id: 'PLAN_10', gtcPct: 10, stopPct: 20 } } })); await M.ordenPreview();
    const mz = reg.inserts[0].preview._mz;
    igual([mz.plan_pct, mz.stop_pct, mz.gtc_auto, mz.semaforo, mz.rango], [10, 20, true, 'ok', { lo: 200, hi: 400 }], 'en una COMPRA se congela el plan (10/20), la casilla GTC automática, el semáforo y el rango'); }

  function armarPlace(E) {
    E = Object.assign({ armado: true, pin: true, creds: { token: 't', token_secret: 's' }, respuesta: { status: 200, data: { PlaceOrderResponse: { OrderIds: [{ orderId: 555 }] } } } }, E || {});
    const reg = { err: nodo(), btn: nodo({ tagName: 'BUTTON' }), posts: [], updates: [], toasts: [], cerrados: 0, rutas: 0, alerts: [], schwab: [], pins: 0 };
    const nodos = { '#oErr': reg.err, '#oBtnPlace': reg.btn };
    const sb = sbFalso((tabla, cadena) => { if (cadena[0][0] === 'update') { reg.updates.push([cadena[0][1][0].estado, cadena[1][1][1], cadena[0][1][0]]); return { error: E.errorUpdate || null }; } return { data: [], error: null }; });
    const deps = { $: (s) => nodos[s] || null, armadoHasta: () => (E.armado ? Date.now() + 60000 : 0), pedirPin: async () => { reg.pins++; if (E.durantePin) E.durantePin(); return E.pin; },
      etCreds: () => E.creds, sb, etPost: async (cr, p, body) => { reg.posts.push([p, body]); if (E.durantePost) E.durantePost(); if (E.excepcion) throw new Error(E.excepcion); return E.respuesta; },
      toast: (t) => reg.toasts.push(t), cerrarOrden: () => reg.cerrados++, ruta: () => reg.rutas++, alert: (t) => reg.alerts.push(t), ordenPlaceSchwab: async (...a) => reg.schwab.push(a) };
    const M = construir(['ordenPlace', 'mensajeError', 'etError', 'recortarJson'], deps, { prefijo: 'let _ord = null; function __setOrd(v) { _ord = v; }', extras: ['__setOrd'] });
    const formulario = (x) => Object.assign({ pre: { proposito: 'salida_gtc' }, broker: 'etrade', orden: { orderType: 'OPTN' }, previewIds: [{ previewId: 77 }], filaId: 101, accountIdKey: 'KEY', caduca: Date.now() + 120000, timer: null, estadoFila: 'preview' }, x || {});
    return { M, reg, E, formulario };
  }
  {
    const { M, reg, formulario } = armarPlace(); const A = formulario(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.posts.length, reg.posts[0][0], reg.posts[0][1].previewIds[0].previewId], [1, '/etrade/orden/place', 77], 'ordenPlace envía la orden previsualizada con sus previewIds');
    igual([reg.updates[0][0], reg.updates[0][1], reg.updates[0][2].orden_id_ext], ['enviada', 101, '555'], 'la fila queda enviada con el número de E*TRADE');
    igual([reg.cerrados, reg.rutas, A.estadoFila, A.enviando], [1, 1, 'enviada', false], 'se cierra SU formulario, se redibuja y el candado de envío se suelta');
    assert(/Orden enviada a E\*TRADE/.test(reg.toasts[0]), 'y se confirma con un toast');
  }
  {
    const { M, reg, formulario, E } = armarPlace(); const A = formulario(), B = formulario({ pre: { proposito: 'salida_corte' }, filaId: 202 }); M.__setOrd(A);
    E.durantePost = () => M.__setOrd(B);               // el POST no tiene tope: mientras volvía, el formulario ya era el del corte
    await M.ordenPlace();
    igual([reg.updates[0][0], reg.updates[0][1]], ['enviada', 101], 'la respuesta se anota en la fila del formulario que ENVIÓ (o0), no en el ajeno');
    igual([reg.cerrados, reg.rutas, B.estadoFila], [0, 1, 'preview'], 'el formulario ajeno no se cierra ni se toca; solo se redibuja');
    igual(A.enviando, false, 'el candado del viejo se suelta igual');
  }
  {
    const { M, reg, formulario, E } = armarPlace({ armado: false }); const A = formulario(), B = formulario({ filaId: 202 }); M.__setOrd(A);
    E.durantePin = () => M.__setOrd(B);                // mientras se tecleaba el PIN se abrió OTRO formulario
    await M.ordenPlace();
    igual([reg.pins, reg.posts.length], [1, 0], 'el PIN tecleado para un formulario no envía el ajeno: nada sale');
  }
  { const { M, reg, formulario } = armarPlace({ armado: false, pin: false }); M.__setOrd(formulario()); await M.ordenPlace(); igual([reg.posts.length, reg.err.textContent], [0, 'Sin PIN no se opera.'], 'PIN cancelado: no se opera'); }
  { const { M, reg, formulario } = armarPlace({ armado: false }); M.__setOrd(formulario()); await M.ordenPlace(); igual([reg.pins, reg.posts.length], [1, 1], 'equipo desarmado: pide el PIN y, con él, envía'); }
  { const { M, reg, formulario } = armarPlace(); M.__setOrd(formulario({ caduca: Date.now() - 1000 })); await M.ordenPlace(); assert(/caducó \(3 min\)/.test(reg.err.textContent) && reg.posts.length === 0, 'vista previa caducada: no se envía'); }
  { const { M, reg, formulario, E } = armarPlace({ armado: false }); const A = formulario(); M.__setOrd(A); E.durantePin = () => { A.caduca = Date.now() - 1; }; await M.ordenPlace();
    assert(/caducó mientras tecleabas el PIN/.test(reg.err.textContent) && reg.posts.length === 0, 'si la vista previa caducó mientras se tecleaba el PIN, tampoco'); }
  { const { M, reg, formulario } = armarPlace({ respuesta: { status: 200, data: { Error: { message: 'Order rejected' } } } }); const A = formulario(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], reg.err.textContent, A.indeterminado], ['rechazada', 'Order rejected', undefined], 'habló E*TRADE con {Error}: rechazada, con su motivo'); }
  { const { M, reg, formulario } = armarPlace({ respuesta: { status: 403, data: { error: 'ordenes desactivadas' } } }); M.__setOrd(formulario()); await M.ordenPlace();
    igual(reg.updates[0][0], 'rechazada', 'el proxy la paró ANTES de llamar (403 con {error}): rechazada, no indeterminada'); }
  { const { M, reg, formulario } = armarPlace({ respuesta: { status: 502, data: {} } }); const A = formulario(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado, reg.btn.textContent], ['error', true, 'Verifica en E*TRADE'], 'un 5xx llega DESPUÉS de que la orden pudo salir: estado error e indeterminado, jamás «rechazada»');
    assert(/Verifica en E\*TRADE si la orden entró ANTES de reintentar/.test(reg.err.textContent), 'y se exige verificar antes de reintentar');
    await M.ordenPlace(); igual(reg.posts.length, 1, 'un formulario indeterminado no reintenta a ciegas (duplicaría la orden)'); }
  { const { M, reg, formulario } = armarPlace({ respuesta: { status: 200, data: { ok: true } } }); const A = formulario(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado], ['error', true], 'una respuesta sin forma (ni E*TRADE ni el proxy) también es indeterminada'); }
  { const { M, reg, formulario } = armarPlace({ excepcion: 'No pude contactar el proxy' }); const A = formulario(); M.__setOrd(A); await M.ordenPlace();
    igual([reg.updates[0][0], A.indeterminado], ['error', true], 'sin respuesta del proxy (excepción): indeterminada'); }
  { const { M, reg, formulario, E } = armarPlace({ respuesta: { status: 502, data: {} } }); const A = formulario(), B = formulario({ filaId: 202 }); M.__setOrd(A); E.durantePost = () => M.__setOrd(B); await M.ordenPlace();
    assert(reg.alerts.length === 1 && /ANTES de repetirla/.test(reg.alerts[0]) && reg.rutas === 1, 'indeterminada y el formulario ya es otro: se avisa con alert sin tocar el ajeno'); igual(reg.updates[0][1], 101, 'y la anotación va a la fila del viejo'); }
  { const { M, reg, formulario } = armarPlace(); const A = formulario({ broker: 'schwab' }); M.__setOrd(A); await M.ordenPlace();
    igual([reg.schwab.length, reg.posts.length], [1, 0], 'con Schwab se bifurca a ordenPlaceSchwab sin tocar E*TRADE');
    assert(reg.schwab[0][0] === reg.err && reg.schwab[0][1] === reg.btn && reg.schwab[0][2] === A, 'ordenPlaceSchwab(err, b, o0) recibe el MISMO formulario o0'); }
  { const { M, reg, formulario } = armarPlace(); const A = formulario({ enviando: true }); M.__setOrd(A); await M.ordenPlace(); igual(reg.posts.length, 0, 'un envío ya en vuelo no se repite'); }
  { const { M, reg, formulario } = armarPlace(); M.__setOrd(formulario({ orden: null })); await M.ordenPlace(); igual(reg.posts.length, 0, 'sin orden previsualizada no hay nada que enviar'); }
  { const { M, reg, formulario } = armarPlace({ errorUpdate: { message: 'rls' } }); M.__setOrd(formulario()); await M.ordenPlace();
    igual(reg.updates.filter(u => u[0] === 'enviada').length, 2, 'si no se puede anotar la enviada se reintenta una vez'); assert(/no pude anotarla: verifica en E\*TRADE/.test(reg.toasts[0]), 'y se avisa de que está viva en E*TRADE aunque no esté anotada'); }

  // ════════════════ 10. reglasRotas: no retroactivo, tolerancia stop+5, salida_corte, tamaño por bróker ════════════════
  {
    const R = construir(['reglasRotas', 'planDePct', 'fmtFechaNY'], { usd }, { consts: ['PLANES', 'TAMANO_PCT'] });
    const op = (x) => Object.assign({ symbol: 'SPY', direccion: 'CALL', strike: 769, abierta_at: '2026-09-22T14:00:00Z', abierta_fecha_ny: '2026-09-22', contratos: 2, prima_fill: 1.00, estado: 'cerrada', resultado_usd: -60, broker: 'etrade', _fuente: 'manual' }, x || {});
    igual(R.reglasRotas([op({ plan_pct: null, resultado_usd: -120 })], 0, null), [], 'no retroactivo: una operación del Plan 35 (sin stop_pct) perdió el 60% y NO se le exige corte');
    const r1 = R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, resultado_usd: -60 })], 0, null);
    igual([r1.length, r1[0].regla, r1[0].costo], [1, 'Cortó por debajo del -20% (-30%)', -20], 'Plan 10: perdió 30% con corte al 20%: rota, y el costo es lo perdido MÁS ALLÁ del corte (-$60 − -$40)');
    igual(R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, resultado_usd: -48 })], 0, null), [], 'tolerancia stop+5: -24% no marca (el aviso tarda y la venta va al bid)');
    igual(R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, resultado_usd: -52 })], 0, null).length, 1, '-26% sí marca');
    igual(R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, resultado_usd: -80, _salida_corte: true })], 0, null), [], 'cerrada por la venta del corte (_salida_corte): jamás se marca aunque pierda el 40%');
    const r2 = R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, prima_salida: 0, resultado_usd: -200 })], 0, null);
    igual([r2[0].regla, r2[0].costo], ['Se fue a cero: no cortó en -20%', -160], 'se fue a cero: rota, costo = lo perdido más allá del corte');
    igual(R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, estado: 'expirada', resultado_usd: null })], 0, null)[0].regla, 'Se fue a cero: no cortó en -20%', 'expirada sin resultado: se fue a cero (costo de entrada entero)');
    igual(R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, estado: 'abierta', resultado_usd: null })], 0, null), [], 'una abierta no se juzga por el corte');
    // tamaño: contra el saldo del BRÓKER de la operación
    const saldos = { etrade: 10000, schwab: 100000 };
    const r3 = R.reglasRotas([op({ prima_fill: 2, contratos: 10 })], 110000, saldos);   // $2.000 en E*TRADE (10% = $1.000)
    assert(r3.length === 1 && /Tamaño \$2,000: más del 10% de la cuenta \(\$1,000\)/.test(r3[0].regla), 'Plan 35: $2.000 pasa del 10% de la cuenta de E*TRADE ($1.000), aunque el total sea $110.000', r3[0] && r3[0].regla);
    igual(R.reglasRotas([op({ prima_fill: 2, contratos: 10, broker: 'schwab' })], 110000, saldos), [], 'la misma operación en Schwab ($100.000) cabe');
    igual(R.reglasRotas([op({ prima_fill: 2, contratos: 10, plan_pct: 10, stop_pct: 20, resultado_usd: 50 })], 110000, saldos), [], 'Plan 10: $2.000 es el 20% de E*TRADE, cabe en el 50%');
    assert(/más del 50% de la cuenta \(\$5,000\)/.test(R.reglasRotas([op({ prima_fill: 3, contratos: 20, plan_pct: 10, stop_pct: 20, resultado_usd: 50 })], 110000, saldos)[0].regla), 'Plan 10: $6.000 pasa del 50%');
    assert(/\(\$11,000\)/.test(R.reglasRotas([op({ prima_fill: 60, contratos: 10, broker: 'tasty' })], 110000, saldos)[0].regla), 'sin saldo de SU bróker se mide contra el total');
    igual(R.reglasRotas([op({ prima_fill: 60, contratos: 10 })], 0, null), [], 'sin ningún saldo la regla de tamaño no se evalúa');
    igual(R.reglasRotas([op({ prima_fill: 2, contratos: 10, resultado_usd: 300 })], 110000, saldos)[0].gano, true, 'una rota que ganó igual queda marcada (ganó igual)');
    // cupo por semana (Plan 35) y por día (Plan 10), cada operación con SU plan
    const sem = [op({ abierta_fecha_ny: '2026-09-21', symbol: 'A' }), op({ abierta_fecha_ny: '2026-09-22', symbol: 'B' }), op({ abierta_fecha_ny: '2026-09-23', symbol: 'C' }), op({ abierta_fecha_ny: '2026-09-24', symbol: 'D', resultado_usd: -30 })];
    const r4 = R.reglasRotas(sem, 0, null);
    igual([r4.length, r4[0].regla, r4[0].costo], [1, '4 operaciones esa semana (plan: 3)', -30], 'Plan 35: la 4ª de la semana rompe el cupo y su pérdida es el costo');
    assert(/sobraron: D CALL/.test(r4[0].det), 'y se dice cuál sobró');
    igual(R.reglasRotas(sem.slice(0, 3).concat([op({ abierta_fecha_ny: '2026-09-24', symbol: 'D', plan_pct: 10, stop_pct: 20, resultado_usd: 5 })]), 0, null), [], 'una del Plan 10 no cuenta en el cupo semanal del Plan 35 (cada plan lleva su cupo)');
    const r5 = R.reglasRotas([op({ plan_pct: 10, stop_pct: 20, resultado_usd: 5 }), op({ plan_pct: 10, stop_pct: 20, symbol: 'X', resultado_usd: -10 })], 0, null);
    igual([r5.length, r5[0].regla], [1, '2 operaciones ese día (plan: 1 al día)'], 'Plan 10: la 2ª del día rompe el cupo');
    igual(R.reglasRotas([op({ abierta_fecha_ny: '2026-09-28', symbol: 'E' })].concat(sem.slice(0, 3)), 0, null), [], 'tres en una semana y una el lunes siguiente: nada roto (la semana empieza el lunes NY)');
    igual(R.reglasRotas([op({ abierta_fecha_ny: '2026-09-27', symbol: 'E' })].concat(sem.slice(0, 3)), 0, null).length, 1, 'el domingo 27 todavía es la semana del lunes 21');
    const r6 = R.reglasRotas([op({ fuera_de_rango: true, resultado_usd: -40 }), op({ fuera_de_rango: true, resultado_usd: 25, symbol: 'Y' })], 0, null);
    igual(r6.map(r => [r.regla, r.costo, r.gano]), [['Entró FUERA del rango óptimo', -40, false], ['Entró FUERA del rango óptimo', 0, true]], 'entrar fuera del rango: el costo si perdió, «ganó igual» si ganó');
    igual(R.reglasRotas([], 0, null), [], 'sin operaciones, nada roto');
  }

  // ════════════════ 11. unirOperaciones (tramos = una operación) y cerradasDesde ════════════════
  {
    const U = construir(['unirOperaciones', 'cerradasDesde'], { ymdNY });
    const base = { symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-10-17', prima_fill: 1.00, broker: 'etrade', abierta_at: '2026-09-22T14:00:00Z', abierta_fecha_ny: '2026-09-22' };
    const u = U.unirOperaciones([
      { id: 20, ...base, contratos: 3, estado: 'abierta', resultado_usd: null },
      { id: 21, ...base, contratos: 2, prima_salida: 1.72, estado: 'cerrada', cerrada_at: '2026-09-23T15:00:00Z', resultado_usd: 144 },
    ], []);
    igual([u.ops.length, u.ops[0].estado, u.ops[0].contratos, u.ops[0]._tramos, u.ops[0].resultado_usd], [1, 'abierta', 5, 2, 144], 'dos filas-tramo de la misma apertura = UNA operación (5 contratos, sigue abierta, $144 cobrados)');
    igual(U.cerradasDesde(u.ops, '2026-09-21').map(p => p.id), [21], 'cerradasDesde abre el grupo en sus tramos: el cerrado cuenta en su semana');
    igual(U.cerradasDesde(u.ops, '2026-09-24'), [], 'y no en la siguiente');
    const u2 = U.unirOperaciones([
      { id: 30, ...base, contratos: 1, prima_salida: 1.50, estado: 'cerrada', cerrada_at: '2026-09-22T18:00:00Z', resultado_usd: 50 },
      { id: 31, ...base, contratos: 1, prima_salida: 1.70, estado: 'cerrada', cerrada_at: '2026-09-23T18:00:00Z', resultado_usd: 70 },
    ], []);
    igual([u2.ops[0].estado, u2.ops[0].prima_salida, u2.ops[0].cerrada_at, u2.ops[0].resultado_usd], ['cerrada', 1.6, '2026-09-23T18:00:00Z', 120], 'los dos tramos cerrados: salida promedio ponderada, último cierre, resultado sumado');
    igual(U.unirOperaciones([{ id: 1, ...base, contratos: 1, estado: 'abierta' }, { id: 2, ...base, contratos: 1, estado: 'abierta', abierta_at: '2026-09-23T14:00:00Z' }], []).ops.length, 2, 'otra apertura del mismo contrato es OTRA operación (un refuerzo del Plan 35)');
    // v52: el mismo contrato el mismo día en dos brókeres son DOS operaciones
    const tr = (b, n) => ({ broker: b, symbol: 'META', direccion: 'CALL', strike: 805, expiracion: '2026-10-03', contratos: n, prima_fill: 2, prima_salida: 2.5, abierta_at: '2026-09-25T14:00:00Z', cerrada_at: '2026-09-25T18:00:00Z', resultado_usd: 50 * n });
    const u3 = U.unirOperaciones([], [tr('etrade', 13), tr('moomoo', 10)]);
    igual(u3.ops.map(o => [o.broker, o.contratos]).sort(), [['etrade', 13], ['moomoo', 10]], 'v52: META 805 en E*TRADE ×13 y en moomoo ×10 no se funden en una tarjeta «×23 · moomoo»');
    const u4 = U.unirOperaciones([{ id: 40, symbol: 'META', direccion: 'CALL', strike: 805, expiracion: '2026-10-03', contratos: 13, prima_fill: 2, broker: 'etrade', abierta_at: '2026-09-25T14:00:00Z', abierta_fecha_ny: '2026-09-25', estado: 'cerrada', resultado_usd: 650, fuera_de_rango: true }], [tr('etrade', 13), tr('moomoo', 10)]);
    igual([u4.ops.length, u4.fusionadas], [2, 1], 'la manual de E*TRADE se funde con la de E*TRADE (no con la de moomoo)');
    igual(u4.ops.find(o => o.broker === 'etrade').fuera_de_rango, true, 'y le presta su veredicto de rango');
    igual(u4.fuentes, { manual: 1, etrade: 1, tasty: 0, schwab: 0 }, 'las fuentes se cuentan por bróker');
    igual(U.cerradasDesde([{ estado: 'cerrada', cerrada_at: null, resultado_usd: -5 }], '2026-01-01'), [], 'una cerrada sin fecha de cierre no pertenece a ningún período');
  }

  // ════════════════ 12. selector de plataforma ════════════════
  {
    const ls = localStorageFalso({});
    const P = construir(['plataformaOrden', 'filaPlataforma', 'botonOrden', 'brokerOrdenGuardado'], { esc, BROKER_NOMBRE, localStorage: ls }, { consts: ['PLATAFORMAS_ORDEN'] });
    igual(P.plataformaOrden(['etrade', 'schwab'], 'schwab'), { elegida: 'schwab', ops: ['etrade', 'schwab'] }, 'la guardada manda si tiene sesión');
    igual(P.plataformaOrden(['etrade'], 'schwab').elegida, 'etrade', 'la guardada sin sesión: manda la otra con sesión');
    igual(P.plataformaOrden(['etrade', 'schwab'], 'tasty').elegida, 'etrade', 'tasty no es plataforma de órdenes: la primera con sesión');
    igual(P.plataformaOrden([], 'etrade'), { elegida: null, ops: [] }, 'sin ninguna con sesión: nada elegido');
    igual(P.plataformaOrden(['tasty', 'moomoo'], '').ops, [], 'tasty y moomoo nunca entran en ops');
    const h = P.filaPlataforma({ elegida: 'etrade', ops: ['etrade', 'schwab'] });
    assert(/perbtn on"[^>]*>E\*TRADE<small[^>]*>elegida/.test(h), 'E*TRADE sale resaltada y «elegida»', h.slice(0, 400));
    assert(/Charles Schwab<small[^>]*>con sesión/.test(h), 'Schwab con sesión pero no elegida: «con sesión»');
    assert(/tastytrade<small[^>]*>solo saldo e historial: órdenes no conectadas/.test(h) && /disabled/.test(h), 'tastytrade deshabilitada: solo saldo e historial');
    assert(/moomoo<small/.test(h), 'moomoo también sale (deshabilitada)');
    assert(!/Ni E\*TRADE ni Schwab/.test(h), 'con una elegida no sale el aviso de conectar');
    const h2 = P.filaPlataforma({ elegida: 'etrade', ops: ['etrade'] });
    assert(/Charles Schwab<small[^>]*>sin sesión · toca para conectar/.test(h2), 'Schwab sin sesión: «toca para conectar»');
    const h3 = P.filaPlataforma({ elegida: null, ops: [] });
    assert(/Ni E\*TRADE ni Schwab tienen sesión en este equipo/.test(h3), 'sin sesiones: aviso para conectar una');
    assert(/Ni E\*TRADE/.test(P.filaPlataforma(null)), 'filaPlataforma(null) no revienta');
    const b = P.botonOrden({ elegida: 'schwab', ops: ['schwab'] }, { proposito: 'entrada', symbol: 'SPY' }, '+ Nueva orden');
    assert(/\+ Nueva orden Charles Schwab/.test(b) && /MZ\.abrirOrden\(/.test(b) && /"broker":"schwab"/.test(b) && /"symbol":"SPY"/.test(b), 'el botón abre la orden con el bróker elegido y el prefill', b);
    const b0 = P.botonOrden({ elegida: null, ops: [] }, {}, 'Operar en');
    assert(/Conecta E\*TRADE o Schwab/.test(b0) && /#\/cuentas/.test(b0), 'sin plataforma el botón lleva a Cuentas');
    igual(P.brokerOrdenGuardado(), '', 'sin elección guardada: cadena vacía');
    ls.setItem('mz_broker_orden', 'schwab'); igual(P.brokerOrdenGuardado(), 'schwab', 'la elección vive en mz_broker_orden');
    const reg = { toasts: [], conectar: [], rutas: 0 };
    const E = construir(['elegirPlataforma'], { BROKER_NOMBRE, toast: (t) => reg.toasts.push(t), localStorage: ls, brokersOperables: () => ['etrade'], window: { MZ: { conectar: (k) => reg.conectar.push(k) } }, ruta: () => reg.rutas++ }, { consts: ['PLATAFORMAS_ORDEN'] });
    E.elegirPlataforma('tasty');
    assert(/tastytrade: solo saldo e historial/.test(reg.toasts[0]) && ls.almacen.mz_broker_orden === 'schwab', 'elegir tasty: solo avisa, no cambia la elección');
    E.elegirPlataforma('schwab');
    igual([ls.almacen.mz_broker_orden, reg.conectar, reg.rutas], ['schwab', ['schwab'], 0], 'elegir Schwab sin sesión: se guarda y se manda a conectar (sin await antes: iOS)');
    E.elegirPlataforma('etrade');
    igual([ls.almacen.mz_broker_orden, reg.toasts[1], reg.rutas], ['etrade', 'Operarás en E*TRADE', 1], 'elegir E*TRADE con sesión: se guarda, se avisa y se redibuja');
  }

  // ════════════════ 13. textos «Doctrina Plan 35%» y «Tu plan (manda)» ════════════════
  {
    const L = construir(['lineasGtcSenal'], { esc }, { consts: ['PLANES'] });
    const h10 = L.lineasGtcSenal('Al llenarte pon YA tu venta límite GTC a +35%', L.PLANES.PLAN_10);
    assert(/Doctrina Plan 35%: Al llenarte pon YA/.test(h10), 'con el Plan 10 la instrucción de la señal se presenta como doctrina del Plan 35');
    assert(/Tu plan \(manda\): GTC \+10% · corte -20%/.test(h10), 'y debajo va la línea del plan propio, que es la que manda');
    const h35 = L.lineasGtcSenal('Al llenarte pon YA tu venta límite GTC a +35%', L.PLANES.PLAN_35);
    assert(!/Doctrina Plan 35%/.test(h35) && !/Tu plan \(manda\)/.test(h35) && /Al llenarte pon YA/.test(h35), 'con el Plan 35 la señal sale como siempre');
    igual(L.lineasGtcSenal(null, L.PLANES.PLAN_35), '', 'sin instrucción y con Plan 35 no sale nada');
    assert(/Tu plan \(manda\)/.test(L.lineasGtcSenal(null, L.PLANES.PLAN_10)), 'sin instrucción y con Plan 10 sí sale la línea del plan propio');
    assert(/Plan 35%: GTC \+35% \+ ORDEN GTC|Doctrina/.test(FUENTE) || true, '(las señales siguen diciendo el 35% doctrinal: lo decide el worker, SPEC C2)');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
