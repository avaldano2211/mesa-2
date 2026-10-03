#!/usr/bin/env node
/* Pruebas de la v55: el GESTOR DE POSICIONES del Copiloto igual al de la mesa vieja y el gráfico
   del gestor. Funciones REALES del fuente con dependencias falsas (casa_pruebas.js): la fórmula de
   «Salta en» (la misma del worker, C2) en los mismos casos —armado, dormido, protege costo, fijo—,
   el guardado de parámetros por id con debounce de 400 ms (y su reversión), la alarma de dinero SIN
   VIGILAR, la barra INVERTIDO · VALOR AHORA · GANANCIA/PÉRDIDA, Vender por bróker sin mandar nada,
   tabla (Mac) vs tarjetas (iPhone) por ancho, y el chart con tf, rango, ventana y líneas de strikes.
   Uso: node test_gestor_app.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_gestor_app.js');
const { assert, igual, cerca, construir, extraer, esc, usd, colUtil, BROKER_NOMBRE, haceCuanto, nodo, sbFalso, respirar, cargarModuloEntero, FUENTE } = C;
const HOY = '2026-09-28';
const hoyNY = () => HOY;
const dineroD = (n) => (n == null || !Number.isFinite(Number(n))) ? '—' : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// fichas de juguete con las columnas de la migración 0018
const SPY = { id: 1, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', contratos: 2, prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20,
  mark: 4.18, mark_at: new Date().toISOString(), mfe: 5.00, mae: 3.10, modo_salida: 'trailing', trail_pct: 20, arm_pct: 0, protege_costo: false, target_pct: null, activo: true, nivel_trailing: 4.0 };
const NVDA = { id: 4, estado: 'abierta', broker: 'schwab', symbol: 'NVDA', direccion: 'CALL', strike: 185, expiracion: '2026-10-16', contratos: 3, prima_fill: 2.10, gtc_limite: 2.86, plan_pct: 35, stop_pct: null,
  mark: 2.25, mfe: 2.30, mae: 1.95, modo_salida: 'trailing', trail_pct: 25, arm_pct: 25, protege_costo: false, activo: true };
const META = { id: 7, estado: 'abierta', broker: 'moomoo', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, prima_fill: 5.00, gtc_limite: 5.52, plan_pct: 10, stop_pct: 20, stop_fijo_pct: 45,
  mark: 4.90, mfe: 5.40, mae: 4.60, modo_salida: 'fijo', trail_pct: 20, arm_pct: 0, protege_costo: false, target_pct: 60, activo: true };
const TSLA = { id: 9, estado: 'abierta', broker: 'etrade', symbol: 'TSLA', direccion: 'CALL', strike: 400, expiracion: '2026-10-09', contratos: 1, prima_fill: 2.00, gtc_limite: 2.22, plan_pct: 10, stop_pct: 20,
  mark: 1.62, mfe: 2.40, mae: 1.60, modo_salida: 'trailing', trail_pct: 20, arm_pct: 0, protege_costo: false, activo: false, nivel_trailing: 1.92 };

(async () => {
  // ════════════════ 1. LA REGLA: defaults, lo tecleado (pend) y los rangos ════════════════
  const R = construir(['reglaGestor', 'acotarGestor', 'markGestor'], { PLAN_PCT: 35 }, { consts: ['GESTOR_DEF', 'GESTOR_RANGOS'] });
  const GESTOR_RANGOS_stop_pct = R.GESTOR_RANGOS.stop_pct;
  {
    const r0 = R.reglaGestor({ id: 1, prima_fill: 3.3, plan_pct: 10, stop_pct: 20 });
    igual([r0.modo, r0.trail_pct, r0.arm_pct, r0.protege_costo, r0.target_pct, r0.target_efectivo, r0.stop_pct, r0.activo], ['trailing', 20, 0, false, null, 10, 20, true],
      'sin las columnas de 0018 la regla nace con los defaults de la vieja (trailing 20 %, armado, sin 🛡️, activa) y el objetivo es el plan de la ficha (+10 %)');
    igual(R.reglaGestor({ plan_pct: 35 }).target_efectivo, 35, 'Plan 35: el objetivo efectivo es +35 %');
    igual(R.reglaGestor({}).target_efectivo, 35, 'sin plan_pct manda la doctrina (PLAN_PCT = 35)');
    const r1 = R.reglaGestor(META);
    igual([r1.modo, r1.target_pct, r1.target_efectivo, r1.stop_fijo_pct, r1.stop_pct], ['fijo', 60, 60, 45, 20], 'fijo: target_pct 60 manda sobre el plan; el stop del modo fijo es stop_fijo_pct (45) y el corte del Plan 10 (stop_pct 20) sigue aparte, intocable');
    igual(R.reglaGestor({ modo_salida: 'fijo', stop_pct: 20 }).stop_fijo_pct, 45, 'sin stop_fijo_pct el modo fijo nace con el −45 % de la vieja (no con el corte del plan)');
    igual(typeof GESTOR_RANGOS_stop_pct, 'undefined', 'stop_pct NO es un campo del gestor (no está en sus rangos): jamás se escribe desde aquí');
    const r2 = R.reglaGestor(SPY, { trail_pct: 25, protege_costo: true });
    igual([r2.trail_pct, r2.protege_costo, r2.arm_pct], [25, true, 0], 'lo tecleado sin guardar (pend) manda sobre la fila');
    igual([R.reglaGestor({ trail_pct: 0 }).trail_pct, R.reglaGestor({ trail_pct: 120 }).trail_pct, R.reglaGestor({ arm_pct: -5 }).arm_pct, R.reglaGestor({ arm_pct: 900 }).arm_pct, R.reglaGestor({ stop_fijo_pct: 150 }).stop_fijo_pct, R.reglaGestor({ modo_salida: 'fijo', target_pct: 0.5 }).target_pct],
      [1, 95, 0, 500, 99, 1], 'los rangos de la vieja (engine.py:235): trail 1–95, arm 0–500, stop 1–99, target 1–2000');
    igual(Object.keys(R.GESTOR_RANGOS).sort(), ['arm_pct', 'stop_fijo_pct', 'target_pct', 'trail_pct'], 'los campos que el gestor puede escribir: trail, arm, target y stop_fijo — stop_pct (el corte del plan) NO');
    igual([R.reglaGestor(SPY).editando, R.reglaGestor(SPY, { trail_pct: 25 }).editando], [false, true], 'la regla sabe si hay algo tecleado sin guardar (editando)');
    igual([R.reglaGestor({ activo: null }).activo, R.reglaGestor({ activo: false }).activo, R.reglaGestor({ activo: true }).activo], [true, false, true], 'activo: null (sin columna) = vigilada; false = apagada');
    igual([R.acotarGestor('trail_pct', '25,5'), R.acotarGestor('trail_pct', 'x'), R.acotarGestor('trail_pct', ''), R.acotarGestor('otro', 7)], [25.5, null, null, 7], 'acotar: coma decimal vale, basura → null, campo desconocido pasa tal cual');
    igual([R.markGestor(SPY, { mark: 4.20 }), R.markGestor(SPY, null), R.markGestor({ mark: null }, { mark: 0 }), R.markGestor({ mark: '' }, null)], [4.20, 4.18, null, null], 'el mark del gestor: el del bróker si lo hay, si no el del worker, si no null (nunca 0)');
  }

  // ════════════════ 2. LA FÓRMULA de «Salta en»: idéntica a la del worker (C2) ════════════════
  const N = construir(['nivelGestor', 'reglaGestor', 'acotarGestor'], { PLAN_PCT: 35 }, { consts: ['GESTOR_DEF', 'GESTOR_RANGOS'] });
  {
    const n1 = N.nivelGestor(SPY, null, 4.20);
    igual([n1.modo, n1.peak, n1.armado, n1.nivel, n1.protegido, n1.margen, n1.hot, n1.tocado, n1.fuente], ['trailing', 5, true, 4, false, 5, false, false, 'app'],
      'ARMADO: peak = mfe 5.00 → nivel = 5.00 × (1 − 20 %) = 4.00; mark 4.20 → margen 5.0 %, ni caliente ni tocado');
    cerca(n1.peak_pct, 51.5, 'máximo +51.5 % sobre el costo');
    const n2 = N.nivelGestor(SPY, null, 4.05);
    assert(n2.hot === true && n2.tocado === false && n2.margen === 1.3, 'a ≤ 2 % del nivel la fila se pone caliente (mark 4.05 vs 4.00: margen 1.3 %)', JSON.stringify(n2));
    const n3 = N.nivelGestor(SPY, null, 3.99);
    assert(n3.tocado === true && n3.hot === true && n3.margen < 0, 'mark por debajo del nivel: TOCADO (el worker manda el push TRAILING STOP)');
    const n4 = N.nivelGestor(NVDA, null, 2.25);
    igual([n4.armado, n4.peak, n4.nivel, n4.peak_pct], [false, 2.3, 1.725, 9.5], 'DORMIDO: arm 25 % y el máximo 2.30 solo lleva +9.5 % sobre 2.10 → no armado; el nivel se calcula igual (1.725) pero no dispara');
    assert(n4.hot === false && n4.tocado === false, 'dormido jamás está caliente ni tocado aunque el mark esté bajo el nivel');
    igual(N.nivelGestor(NVDA, null, 2.70).armado, true, 'con un mark que lleva el máximo a 2.70 (+28.6 %) el trailing se arma (peak = max(mfe, mark), como el worker)');
    const p5 = { prima_fill: 2.59, mfe: 3.00, trail_pct: 20, protege_costo: true };
    const n5 = N.nivelGestor(p5, null, 2.80);
    igual([n5.nivel, n5.protegido], [2.59, true], 'PROTEGE COSTO: 3.00 × 0.8 = 2.40 < costo 2.59 → el piso sube al costo (🛡️)');
    igual([N.nivelGestor({ ...p5, protege_costo: false }, null, 2.80).nivel, N.nivelGestor({ ...p5, protege_costo: false }, null, 2.80).protegido], [2.4, false], 'sin 🛡️ el nivel se queda en 2.40');
    igual([N.nivelGestor({ ...p5, mfe: 4.00 }, null, 3.9).nivel, N.nivelGestor({ ...p5, mfe: 4.00 }, null, 3.9).protegido], [3.2, false], 'con el máximo alto el piso protegido no toca: 3.20 > 2.59, sin 🛡️');
    igual(N.nivelGestor({ prima_fill: 3, mfe: null, trail_pct: 10 }, null, 4).peak, 4, 'sin mfe (el worker aún no marcó) el máximo es el mark de ahora');
    const n6 = N.nivelGestor({ prima_fill: 3, mfe: null, trail_pct: 10, nivel_trailing: 3.5 }, null, null);
    igual([n6.nivel, n6.fuente, n6.margen], [3.5, 'worker', null], 'sin mark ni mfe aquí se enseña el nivel que dejó el worker (nivel_trailing) y se dice');
    igual(N.nivelGestor({ prima_fill: 3, trail_pct: 10 }, null, null).nivel, null, 'sin nada que calcular: nivel null (no se inventa)');
    igual(N.nivelGestor({ prima_fill: 3, mfe: 5, trail_pct: 20 }, null, '4,5').mark, null, 'un mark ilegible no se evalúa (la posición no se olvida: sigue saliendo)');
    // fijo
    const f1 = N.nivelGestor(META, null, 4.90);
    igual([f1.modo, f1.target, f1.stop, f1.margen_target, f1.margen_stop, f1.hot, f1.tocado_target, f1.tocado_stop], ['fijo', 8, 2.75, 63.3, 78.2, false, false, false],
      'FIJO: objetivo = 5.00 × 1.60 = 8.00, stop = 5.00 × 0.55 = 2.75 (stop_fijo_pct, no el corte del plan); con mark 4.90 faltan +63.3 % al objetivo y hay 78.2 % de colchón al stop');
    cerca(f1.caida_stop, -43.9, 'la CAÍDA hasta el stop es stop/mark − 1 = −43.9 % (el 78.2 % es el colchón mark/stop − 1, que solo pinta el color)', 0.05);
    cerca(N.nivelGestor(META, null, 6.00).caida_stop, -54.2, 'con mark 6.00 la caída al stop es −54.2 % (el colchón daría −118 %, una caída imposible para una prima)', 0.05);
    igual(N.nivelGestor({ ...META, stop_pct: 60 }, null, 4.9).stop, 2.75, 'cambiar el corte del Plan 10 (stop_pct) no mueve el stop del modo fijo');
    // el nivel del WORKER manda mientras no se teclea (lo que vigila el servidor); tecleando se recalcula aquí
    const nw = N.nivelGestor({ ...SPY, nivel_trailing: 4.10 }, null, 4.20);
    igual([nw.nivel, nw.fuente], [4.1, 'worker'], 'con nivel_trailing del worker (4.10) distinto del cálculo local (4.00) manda el del worker y se dice');
    const nl = N.nivelGestor({ ...SPY, nivel_trailing: 4.10 }, N.reglaGestor(SPY, { trail_pct: 25 }), 4.20);
    igual([nl.nivel, nl.fuente], [3.75, 'app'], 'tecleando (pend) se recalcula aquí con la misma fórmula: 5.00 × 0.75 = 3.75, sin esperar al worker');
    igual(N.nivelGestor({ ...SPY, nivel_trailing: 4.0 }, null, 4.20).fuente, 'app', 'si el worker y el cálculo local coinciden no se dice nada');
    assert(N.nivelGestor(META, null, 8.10).tocado_target === true, 'mark 8.10 ≥ objetivo: OBJETIVO tocado');
    const f2 = N.nivelGestor(META, null, 2.70);
    assert(f2.tocado_stop === true && f2.hot === true, 'mark 2.70 ≤ stop: STOP tocado y fila caliente');
    assert(N.nivelGestor(META, null, 2.79).hot === true && N.nivelGestor(META, null, 2.79).tocado_stop === false, 'a ≤ 2 % del stop (2.79 vs 2.75) caliente sin tocar');
    igual(N.nivelGestor({ ...META, stop_fijo_pct: null }, null, 4.9).stop, 2.75, 'sin stop_fijo_pct manda el 45 de la vieja (5.00 × 0.55 = 2.75)');
    igual(N.nivelGestor({ ...META, target_pct: null }, null, 4.9).target, 5.5, 'sin target_pct el objetivo es el plan de la ficha (+10 % → 5.50)');
  }

  // ════════════════ 3. La celda «Salta en» y el color del margen ════════════════
  const S = construir(['saltaHtml', 'margenColorGestor', 'nivelGestor', 'reglaGestor', 'acotarGestor', 'fmtPrima'], { esc, PLAN_PCT: 35 }, { consts: ['GESTOR_DEF', 'GESTOR_RANGOS'] });
  {
    igual([S.margenColorGestor(3), S.margenColorGestor(3.1), S.margenColorGestor(10), S.margenColorGestor(10.1), S.margenColorGestor(null)], ['var(--rojo)', 'var(--oro)', 'var(--oro)', 'var(--tx3)', 'var(--tx3)'], 'margen: rojo ≤ 3 %, ámbar ≤ 10 %, gris el resto');
    const r = S.reglaGestor(SPY);
    const h1 = S.saltaHtml(S.nivelGestor(SPY, r, 4.20), r);
    assert(/<b class="mono"[^>]*>4\.00<\/b>/.test(h1) && /−20% del máx 5\.00/.test(h1) && /margen 5\.0%/.test(h1) && /color:var\(--oro\)">margen/.test(h1) && !/🛡️/.test(h1), 'armado: el nivel en negrita, «−20% del máx 5.00» y «margen 5.0%» en ámbar', h1);
    const h2 = S.saltaHtml(S.nivelGestor(SPY, r, 4.05), r);
    assert(/color:var\(--rojo\)">4\.00</.test(h2) && /color:var\(--rojo\)">margen 1\.3%/.test(h2), 'caliente: el nivel y el margen en rojo');
    const rp = S.reglaGestor({ ...SPY, protege_costo: true, mfe: 3.9, nivel_trailing: null });
    const h3 = S.saltaHtml(S.nivelGestor({ ...SPY, protege_costo: true, mfe: 3.9, nivel_trailing: null }, rp, 3.5), rp);
    assert(/🛡️/.test(h3) && /piso = costo 3\.30/.test(h3) && />3\.30<\/b>/.test(h3), 'protegido: 🛡️ y «piso = costo 3.30»', h3);
    const rn = S.reglaGestor(NVDA);
    const h4 = S.saltaHtml(S.nivelGestor(NVDA, rn, 2.25), rn);
    assert(/💤 se arma a \+25%/.test(h4) && /máx 2\.30 · aún \+9\.5%/.test(h4) && !/margen/.test(h4), 'dormido: «💤 se arma a +25%» y «máx 2.30 · aún +9.5%»', h4);
    const rm = S.reglaGestor(META);
    const h5 = S.saltaHtml(S.nivelGestor(META, rm, 4.90), rm);
    assert(/var\(--verde\)[^>]*>8\.00</.test(h5) && /var\(--rojo\)[^>]*>2\.75</.test(h5) && /calculado sobre 5\.00/.test(h5) && /objetivo a \+63\.3% · stop a −43\.9%/.test(h5) && /el corte −20% del Plan 10 sigue aparte/.test(h5), 'fijo: objetivo en verde / stop en rojo, «calculado sobre 5.00», «stop a −43.9%» (la caída real, no el colchón) y el recordatorio de que el corte del plan va aparte', h5);
    const hv = S.saltaHtml(S.nivelGestor(SPY, r, 4.20), r, false);
    assert(/color:var\(--rojo\)">⚠ el servidor aún no vigila este nivel/.test(hv) && /4\.00<\/b>/.test(hv), 'sin nadie vigilando (0018 pendiente o worker sin gestor) la celda lo dice en rojo debajo del nivel');
    assert(!/aún no vigila/.test(S.saltaHtml(S.nivelGestor(SPY, r, 4.20), r, true)) && !/aún no vigila/.test(S.saltaHtml(S.nivelGestor(SPY, r, 4.20), r, null)), 'vigilado (o sin saber) no se dice nada');
    assert(/aún no vigila/.test(S.saltaHtml(S.nivelGestor(NVDA, rn, 2.25), rn, false)), 'también en un trailing dormido');
    const h6 = S.saltaHtml(S.nivelGestor({ prima_fill: 3, mfe: null, trail_pct: 10, nivel_trailing: 3.5 }, S.reglaGestor({ trail_pct: 10 }), null), S.reglaGestor({ trail_pct: 10 }));
    assert(/3\.50/.test(h6) && /nivel del worker/.test(h6), 'sin máximo aquí: el nivel del worker, dicho');
    assert(/sin máximo todavía/.test(S.saltaHtml(S.nivelGestor({ prima_fill: 3, trail_pct: 10 }, S.reglaGestor({ trail_pct: 10 }), null), S.reglaGestor({ trail_pct: 10 }))), 'sin nada: «sin máximo todavía», no un número inventado');
  }

  // ════════════════ 4. GUARDADO por id con debounce de 400 ms (y reversión si falla) ════════════════
  {
    const timers = [];
    const nodes = {};
    const toasts = [];
    let fallo = null;
    const sb = sbFalso((tabla, cadena) => (fallo ? { data: null, error: fallo } : { data: [], error: null }));
    const filas = [JSON.parse(JSON.stringify(SPY)), JSON.parse(JSON.stringify(TSLA))];
    filas[0]._br = { mark: 4.20 };
    const _gestor = { filas, pend: {}, timers: {}, guardado: 0, err: null, sinColumnas: false, worker: null, avisoCol: 0 };
    const G = construir(['gestorTeclear', 'gestorSoltar', 'gestorGuardar', 'gestorCambiar', 'gestorModo', 'gestorCasilla', 'gestorActivo', 'gestorVigilarTodas', 'gestorFila', 'pintarSaltaEnSitio', 'pintarGuardadoGestor',
      'gestorPend', 'errorSinColumnas', 'gestorAnotarSinColumnas', 'gestorVigilado', 'acotarGestor', 'reglaGestor', 'nivelGestor', 'saltaHtml', 'markGestor', 'margenColorGestor', 'fmtPrima', 'textoErrorTabla'],
      { esc, sb, _gestor, PLAN_PCT: 35, toast: (t) => toasts.push(t), ruta: () => toasts.push('ruta'),
        $: (s) => (nodes[s] = nodes[s] || nodo()),
        setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelado: false }); return timers.length; },
        clearTimeout: (id) => { if (id && timers[id - 1]) timers[id - 1].cancelado = true; } },
      { consts: ['GESTOR_DEF', 'GESTOR_RANGOS', 'GESTOR_DEBOUNCE_MS'] });
    nodes['#g_trail_pct_1'] = nodo({ value: '20' });
    G.gestorTeclear(1, 'trail_pct', '25');
    igual(_gestor.pend['1'], { trail_pct: 25 }, 'teclear 25 deja lo tecleado en pend (por ID de la ficha, no por índice)');
    igual(sb.llamadas.length, 0, 'y todavía NO escribe en la base');
    assert(/3\.75/.test(nodes['#g_salta_1'].innerHTML) && /−25% del máx 5\.00/.test(nodes['#g_salta_1'].innerHTML), 'la celda «Salta en» se recalcula al instante con la misma fórmula (5.00 × 0.75 = 3.75)', nodes['#g_salta_1'].innerHTML);
    igual([timers.length, timers[0].ms], [1, 400], 'se arma UN temporizador de 400 ms');
    G.gestorTeclear(1, 'trail_pct', '30');
    assert(timers.length === 2 && timers[0].cancelado === true && timers[1].cancelado === false, 'teclear otra vez cancela el temporizador anterior: una sola escritura al final');
    timers[1].fn(); await respirar(); await respirar();
    igual(sb.llamadas.length, 1, 'al vencer el debounce: UNA escritura');
    igual(sb.llamadas[0].tabla, 'posiciones', 'en posiciones (tabla PERSONAL, RLS del dueño)');
    igual(sb.llamadas[0].cadena, [['update', [{ trail_pct: 30 }]], ['eq', ['id', 1]]], 'UPDATE de ese campo y de esa ficha por id');
    igual([_gestor.pend['1'], filas[0].trail_pct], [undefined, 30], 'guardado: pend se vacía y la ficha en memoria lleva el valor nuevo');
    assert(/guardado \d/.test(nodes['#g_guardado'].innerHTML), 'y la nota «guardado hh:mm:ss»', nodes['#g_guardado'].innerHTML);
    G.gestorTeclear(1, 'trail_pct', '');
    G.gestorTeclear(1, 'trail_pct', 'abc');
    igual([_gestor.pend['1'], timers.length], [undefined, 2], 'vacío o basura a medio teclear: ni pend ni temporizador');
    G.gestorTeclear(1, 'campo_raro', '5');
    igual(_gestor.pend['1'], undefined, 'un campo que no es del gestor no se guarda');
    await G.gestorSoltar(1, 'trail_pct', '120'); await respirar();
    igual(sb.llamadas[1].cadena, [['update', [{ trail_pct: 95 }]], ['eq', ['id', 1]]], 'al soltar el campo se guarda YA y acotado (120 → 95)');
    igual(nodes['#g_trail_pct_1'].value, 95, 'y el campo refleja el valor acotado');
    // fallo de la base (p. ej. la RLS): reversión + toast, sin reventar
    fallo = { code: '42501', message: 'new row violates row-level security policy for table "posiciones"' };
    G.gestorTeclear(1, 'trail_pct', '40');
    timers[timers.length - 1].fn(); await respirar(); await respirar();
    igual([_gestor.pend['1'], filas[0].trail_pct, nodes['#g_trail_pct_1'].value], [undefined, 95, 95], 'si el UPDATE falla se revierte lo tecleado: la ficha y el campo vuelven a lo que tiene la base (95)');
    assert(toasts.some(t => /No se guardó trail_pct/.test(t)) && /No se guardó trail_pct/.test(nodes['#g_guardado'].innerHTML) && /var\(--rojo\)/.test(nodes['#g_guardado'].innerHTML), 'y se dice con un toast y en rojo', toasts.join(' | '));
    fallo = null; toasts.length = 0;
    // cambios inmediatos
    await G.gestorModo(1, 'fijo'); await respirar();
    igual(sb.llamadas[sb.llamadas.length - 1].cadena, [['update', [{ modo_salida: 'fijo' }]], ['eq', ['id', 1]]], 'el chip Objetivo+Stop escribe modo_salida = fijo al instante');
    igual(filas[0].modo_salida, 'fijo', 'y la ficha en memoria cambia de modo');
    assert(toasts.includes('ruta'), 'y se redibuja (los parámetros de la fila cambian de forma)');
    await G.gestorCasilla(1, 'protege_costo', true); await respirar();
    igual(sb.llamadas[sb.llamadas.length - 1].cadena, [['update', [{ protege_costo: true }]], ['eq', ['id', 1]]], 'la casilla 🛡️ escribe protege_costo');
    const antes = sb.llamadas.length;
    igual(await G.gestorCasilla(1, 'activo', true), false, 'gestorCasilla solo conoce 🛡️');
    igual(sb.llamadas.length, antes, '…y no escribe nada con otro campo');
    await G.gestorActivo(9, false); await respirar();
    igual(sb.llamadas[sb.llamadas.length - 1].cadena, [['update', [{ activo: false }]], ['eq', ['id', 9]]], 'la casilla Activo escribe activo = false');
    await G.gestorVigilarTodas(); await respirar();
    igual(sb.llamadas[sb.llamadas.length - 1].cadena, [['update', [{ activo: true }]], ['in', ['id', [9]]]], '«Vigilar todas» reactiva de golpe SOLO las apagadas (activo = true por lista de ids)');
    igual(filas[1].activo, true, 'y la ficha queda vigilada en memoria');
    assert(toasts.some(t => /1 posición\(es\) vuelven a estar vigiladas/.test(t)), 'con su toast');
    igual(await G.gestorVigilarTodas(), false, 'sin apagadas no hay nada que hacer');
    assert(sb.llamadas.every(l => l.tabla === 'posiciones' && l.cadena[0][0] === 'update'), 'TODO lo que escribe el gestor son UPDATE en posiciones: jamás una orden, jamás otra tabla');
    assert(!sb.llamadas.some(l => JSON.stringify(l.cadena).includes('stop_pct')), 'y jamás toca stop_pct (el corte del Plan 10)');
    // «soltar» lo que ya tiene la base NO escribe (en Chrome cada redibujo dispara blur: sin esto, UPDATE → Realtime → redibujo → blur… sin fin)
    { const antes2 = sb.llamadas.length; igual(await G.gestorSoltar(1, 'trail_pct', '95'), false, 'soltar el campo con el valor que ya tiene la base no escribe nada'); igual(sb.llamadas.length, antes2, '…cero UPDATE'); igual(_gestor.pend['1'], undefined, '…y pend queda limpio'); }
    // 0018 sin aplicar (42703 / PGRST204): se recuerda y NO se reintenta en cada blur; los cambios inmediatos tampoco escriben
    fallo = { code: '42703', message: 'column posiciones.trail_pct does not exist' };
    G.gestorTeclear(1, 'trail_pct', '40');
    timers[timers.length - 1].fn(); await respirar(); await respirar();
    igual([_gestor.sinColumnas, G.gestorVigilado()], [true, false], 'un «column … does not exist» apaga el gestor (sinColumnas) y gestorVigilado() pasa a false');
    assert(toasts.some(t => /migración 0018 pendiente/.test(t)) && toasts.some(t => /la columna trail_pct de posiciones aún no existe/.test(t)), 'y se dice qué falta (la columna, no «la tabla»)', toasts.join(' | '));
    { const antes3 = sb.llamadas.length; fallo = null;
      await G.gestorSoltar(1, 'trail_pct', '50'); await respirar();
      igual(sb.llamadas.length, antes3, 'con sinColumnas un blur no vuelve a intentar el UPDATE');
      igual(await G.gestorModo(1, 'trailing'), false, '…ni el chip de modo'); igual(sb.llamadas.length, antes3, '…cero escrituras');
      igual(nodes['#g_trail_pct_1'].value, 95, 'el campo vuelve a lo que tiene la base'); }
    _gestor.sinColumnas = false; toasts.length = 0;
    // LA CARRERA (revisión 2026-09-27): un UPDATE en vuelo no puede llevarse lo tecleado después
    const dif = C.diferido(); let enVuelo = null;
    const sbLento = sbFalso((tabla, cadena) => (enVuelo ? enVuelo : { data: [], error: null }));
    const filasR = [JSON.parse(JSON.stringify(SPY))]; filasR[0]._br = { mark: 4.20 };
    const _gR = { filas: filasR, pend: {}, timers: {}, guardado: 0, err: null, sinColumnas: false, worker: null, avisoCol: 0 };
    const timersR = [], toastsR = [];
    const GR = construir(['gestorTeclear', 'gestorSoltar', 'gestorGuardar', 'gestorFila', 'pintarSaltaEnSitio', 'pintarGuardadoGestor', 'gestorPend', 'errorSinColumnas', 'gestorAnotarSinColumnas', 'gestorVigilado',
      'acotarGestor', 'reglaGestor', 'nivelGestor', 'saltaHtml', 'markGestor', 'margenColorGestor', 'fmtPrima', 'textoErrorTabla'],
      { esc, sb: sbLento, _gestor: _gR, PLAN_PCT: 35, toast: (t) => toastsR.push(t), ruta: () => {}, $: (s) => (nodes['R' + s] = nodes['R' + s] || nodo()),
        setTimeout: (fn, ms) => { timersR.push({ fn, ms }); return timersR.length; }, clearTimeout: () => {} },
      { consts: ['GESTOR_DEF', 'GESTOR_RANGOS', 'GESTOR_DEBOUNCE_MS'] });
    // CASO A (iPhone): «2», pausa > 400 ms (el UPDATE sale y VIAJA), «5» mientras viaja, y luego vence el segundo debounce
    enVuelo = dif.promesa;
    GR.gestorTeclear(1, 'trail_pct', '2');
    const g1 = timersR[0].fn(); await respirar();
    igual(sbLento.llamadas.length, 1, 'el primer UPDATE (trail 2) salió');
    GR.gestorTeclear(1, 'trail_pct', '25');
    igual(_gR.pend['1'], { trail_pct: 25 }, 'lo tecleado mientras viaja vive en pend');
    enVuelo = null; dif.resolver({ data: [], error: null }); await g1; await respirar(); await respirar();
    igual(_gR.pend['1'], { trail_pct: 25 }, 'al volver el UPDATE viejo NO se lleva lo tecleado después (antes borraba la entrada entera)');
    await timersR[1].fn(); await respirar();
    igual(sbLento.llamadas[1].cadena, [['update', [{ trail_pct: 25 }]], ['eq', ['id', 1]]], 'y el segundo debounce guarda el 25: la base termina con lo tecleado, no con el 2 a medias');
    igual([_gR.pend['1'], filasR[0].trail_pct], [undefined, 25], 'pend limpio y la ficha en 25');
    // CASO Tab (Mac): «25» en trail, Tab (blur → UPDATE en vuelo), «10» en armar mientras viaja
    const dif2 = C.diferido(); enVuelo = dif2.promesa;
    const g2 = GR.gestorSoltar(1, 'trail_pct', '30'); await respirar();
    GR.gestorTeclear(1, 'arm_pct', '10');
    enVuelo = null; dif2.resolver({ data: [], error: null }); await g2; await respirar(); await respirar();
    igual(_gR.pend['1'], { arm_pct: 10 }, 'al volver el UPDATE de trail, lo tecleado en armar sigue en pend (la entrada no se borra mientras le queden claves)');
    await timersR[timersR.length - 1].fn(); await respirar();
    igual(sbLento.llamadas.slice(-2).map(l => l.cadena[0][1][0]), [{ trail_pct: 30 }, { arm_pct: 10 }], 'las dos escrituras llegan: trail 30 y armar 10');
  }

  // ════════════════ 5. La ALARMA de dinero sin vigilar ════════════════
  {
    const A = construir(['alarmaSinVigilancia'], { dineroD, esc });
    const h = A.alarmaSinVigilancia([SPY, TSLA, { ...NVDA, activo: false }]);
    assert(/🔕 <b>2 posición\(es\) SIN VIGILANCIA<\/b> — \$830\.00 sin trailing ni avisos de venta/.test(h) && /MZ\.gestorVigilarTodas\(\)/.test(h) && /Vigilar todas/.test(h), 'dos apagadas: «2 posición(es) SIN VIGILANCIA — $830.00» ($200 + $630) con el botón «Vigilar todas»', h);
    igual(A.alarmaSinVigilancia([SPY, NVDA]), '', 'todas vigiladas: sin alarma');
    igual(A.alarmaSinVigilancia([{ ...SPY, activo: null }]), '', 'sin la columna (null) no hay alarma: null es vigilada');
    igual(A.alarmaSinVigilancia([]), '', 'sin posiciones, nada');
  }

  // ════════════════ 6. La BARRA: INVERTIDO · VALOR AHORA · GANANCIA/PÉRDIDA (neto del bróker + comisiones) ════════════════
  {
    const B = construir(['totalesGestor', 'barraTotales', 'brokerCuadraConFicha', 'carteraLeidaAt', 'gananciaTotalesHtml', 'comisionesTotalesHtml', 'sublineaTotalesHtml'], { textoVivoEstado: () => '',  esc, dineroD, colUtil, BROKER_NOMBRE, haceCuanto, CART_FRESCO_MS: 30 * 60000, CART_BROKERS: ['etrade', 'schwab', 'tasty', 'moomoo'] });
    const brSpy = { broker: 'etrade', contratos: 2, prima_fill: 3.30, mark: 4.20, valor_actual: 840, invertido: 660, pnl_usd: 178.70 };
    const brAapl = { broker: 'etrade', symbol: 'AAPL', contratos: 2, prima_fill: 1.32, mark: 1.55, valor_actual: 310, invertido: 264, pnl_usd: 44.70 };
    const t = B.totalesGestor([{ tipo: 'libro', p: SPY, br: brSpy, grupo: null, mark: 4.20 }, { tipo: 'broker', br: brAapl }]);
    igual([t.n, t.sinReg, t.invertido, t.valor, t.pnl, t.pnl_pct, t.comisiones, t.neto, t.sinMark], [2, 1, 924, 1150, 223.4, 24.1, 2.6, 2, 0],
      'invertido = Σ costo × qty × 100 (660 + 264), valor = Σ valor del bróker (840 + 310), P&L = el NETO del bróker (178.70 + 44.70) y la diferencia con el bruto son comisiones (2.60); el % va sobre 924 + 2.60 (la misma base que la celda: neto / invertido del bróker, v56)');
    const t2 = B.totalesGestor([{ tipo: 'libro', p: { ...SPY, contratos: 1 }, br: { ...brSpy, contratos: 3 }, grupo: { fichas: 2, libroContratos: 3 }, mark: 4.20 }, { tipo: 'libro', p: { ...SPY, id: 2, contratos: 2 }, br: { ...brSpy, contratos: 3 }, grupo: { fichas: 2, libroContratos: 3 }, mark: 4.20 }]);
    igual([t2.invertido, t2.valor, t2.pnl, t2.neto, t2.comisiones], [990, 1260, 270, 0, 0], 'con DOS fichas del mismo contrato el bróker manda una sola línea: se suma ficha a ficha con el mark (no el neto del bróker, que sería doble)');
    const t3 = B.totalesGestor([{ tipo: 'libro', p: { ...SPY, mark: null }, br: null, grupo: null, mark: null }]);
    igual([t3.invertido, t3.valor, t3.pnl, t3.sinMark], [660, 660, 0, 1], 'sin mark ni bróker la posición vale lo pagado y se cuenta (sinMark)');
    igual(B.totalesGestor([]).n, 0, 'vacío: cero');
    const filas = [{ tipo: 'libro', p: SPY, br: brSpy, grupo: null, mark: 4.20 }, { tipo: 'broker', br: brAapl }];
    const cart = { etrade: { estado: 'ok', ts: Date.now() - 5000, items: [] }, schwab: { estado: 'sin' } };
    const h = B.barraTotales(filas, cart);
    assert(/CARTERA ABIERTA · E\*TRADE/.test(h) && /2 posición\(es\) abierta\(s\) · 1 sin registrar/.test(h), 'cabecera: CARTERA ABIERTA · bróker · «2 posición(es) abierta(s) · 1 sin registrar»', h.slice(0, 300));
    assert(/INVERTIDO<\/span><b class="mono" id="g_sum_inv">\$924\.00/.test(h) && /VALOR AHORA<\/span><b class="mono" id="g_sum_val">\$1,150\.00/.test(h), 'INVERTIDO $924.00 · VALOR AHORA $1,150.00');
    assert(/GANANCIA \/ PÉRDIDA<\/span><b class="mono" id="g_sum_dif" style="color:var\(--verde\)">\+\$223\.40 <span[^>]*>\(\+24\.1%\)/.test(h), 'GANANCIA / PÉRDIDA +$223.40 (+24.1%) en verde', h);
    assert(/neto — el bróker se llevó \$2\.60 en comisiones/.test(h), 'la coletilla de comisiones (diferencia ≥ 50 centavos)');
    assert(/P&amp;L neto del bróker en 2 de 2/.test(h) && /leído hace segundos/.test(h), 'y se dice de dónde sale el P&L y cuándo se leyó');
    const hSin = B.barraTotales([{ tipo: 'libro', p: SPY, br: null, grupo: null, mark: 4.18 }], cart);
    assert(!/comisiones/.test(hSin) && /P&amp;L = valor − lo pagado/.test(hSin), 'sin neto del bróker no se inventan comisiones y se dice que el P&L es valor − lo pagado');
    igual(B.barraTotales([], cart), '', 'sin filas no hay barra');
    // cantidad o costo distintos del bróker (refuerzo o cierre parcial por fuera, costo a mano): NADA del bróker se mezcla
    const tA = B.totalesGestor([{ tipo: 'libro', p: SPY, br: { ...brSpy, contratos: 3, valor_actual: 1260, invertido: 990, pnl_usd: 268.05 }, grupo: { fichas: 1, libroContratos: 2 }, mark: 4.20 }]);
    igual([tA.invertido, tA.valor, tA.pnl, tA.pnl_pct, tA.neto, tA.noCuadra, tA.comisiones], [660, 840, 180, 27.3, 0, 1, 0], 'bróker ×3 y ficha ×2: invertido, valor (mark × qty de la FICHA) y P&L bruto del libro; sin neto ni «comisiones» inventadas (antes: $331.95)');
    const tB = B.totalesGestor([{ tipo: 'libro', p: SPY, br: { ...brSpy, contratos: 1, valor_actual: 420, invertido: 330, pnl_usd: 89.35 }, grupo: { fichas: 1, libroContratos: 2 }, mark: 4.20 }]);
    igual([tB.invertido, tB.valor, tB.pnl, tB.noCuadra], [660, 840, 180, 1], 'cierre parcial por fuera (bróker ×1, ficha ×2): lo mismo, sin contradecirse (antes: valor $420 con ganancia +$89)');
    const tC = B.totalesGestor([{ tipo: 'libro', p: SPY, br: { ...brSpy, prima_fill: 3.32, invertido: 664, pnl_usd: 174.70 }, grupo: null, mark: 4.20 }]);
    igual([tC.invertido, tC.valor, tC.pnl, tC.neto, tC.noCuadra], [660, 840, 180, 0, 1], 'mismo número de contratos pero costo medio distinto (3.32 vs 3.30): tampoco se mezcla (antes «se llevó $5.30» cuando fueron $1.30)');
    const hA = B.barraTotales([{ tipo: 'libro', p: SPY, br: { ...brSpy, contratos: 3, valor_actual: 1260, pnl_usd: 268.05 }, grupo: { fichas: 1, libroContratos: 2 }, mark: 4.20 }], cart);
    assert(!/comisiones/.test(hA) && /1 con otra cantidad o costo en el bróker: va con el libro/.test(hA), 'la barra lo dice: «con otra cantidad o costo en el bróker: va con el libro», y no habla de comisiones');
    const tD = B.totalesGestor([{ tipo: 'libro', p: SPY, br: { ...brSpy, comisiones: 5.0 }, grupo: null, mark: 4.20 }]);
    igual([tD.comisiones, tD.comisiones_ok], [1.3, false], 'si el bróker dice haberse llevado $5.00 y la diferencia es $1.30, no se bautiza como comisiones');
    assert(/de diferencia con valor − invertido \(no cuadra con las comisiones que reporta\)/.test(B.barraTotales([{ tipo: 'libro', p: SPY, br: { ...brSpy, comisiones: 5.0 }, grupo: null, mark: 4.20 }], cart)), '…y la barra lo enseña como diferencia, no como comisión');
    igual(B.totalesGestor([{ tipo: 'libro', p: SPY, br: { ...brSpy, comisiones: 1.3 }, grupo: null, mark: 4.20 }]).comisiones_ok, true, 'si cuadra con lo que reporta (±50 ¢), sí son comisiones');
    const BC = construir(['brokerCuadraConFicha']);
    igual([BC.brokerCuadraConFicha(brSpy, SPY, null), BC.brokerCuadraConFicha({ ...brSpy, contratos: 3 }, SPY, null), BC.brokerCuadraConFicha({ ...brSpy, prima_fill: 3.4 }, SPY, null), BC.brokerCuadraConFicha(brSpy, SPY, { fichas: 2 }), BC.brokerCuadraConFicha(null, SPY, null), BC.brokerCuadraConFicha({ ...brSpy, pnl_usd: null }, SPY, null)],
      [true, false, false, false, false, false], 'brokerCuadraConFicha: una ficha, misma cantidad y mismo costo (±½ ¢), con neto del bróker');
    assert(/suma SOLO lo que se pudo leer/.test(B.barraTotales(filas, { etrade: { estado: 'ok', ts: Date.now() }, schwab: { estado: 'sesion' } })), 'con un bróker caído la barra avisa que suma solo lo leído');
  }

  // ════════════════ 7. VENDER por bróker: pre-arma, jamás manda ════════════════
  {
    const ordenes = [], toasts = [], modales = [];
    const sb = sbFalso(() => ({ data: [], error: null }));
    const filas = [{ ...SPY, _br: { mark: 4.20 } }, { ...META, _br: null }, { ...SPY, id: 11, contratos: 2.6, _br: null, mark: null }];
    const V = construir(['venderGestor', 'venderConCancelacion', 'preVenta', 'textoTicketVenta', 'gestorFila', 'markGestor', 'abrirVentaFuera', 'cerrarVentaFuera', 'copiarTicketVenta'],
      { esc, sb, BROKER_NOMBRE, _gestor: { filas, pend: {} }, abrirOrden: (pre) => ordenes.push(pre), toast: (t) => toasts.push(t), ruta: () => toasts.push('ruta'),
        $: () => null, navigator: { clipboard: { writeText: async (t) => toasts.push('clip:' + t) } },
        document: { createElement: () => { const n = nodo(); modales.push(n); return n; }, body: nodo() } });
    igual(V.venderGestor(1), 'orden', 'E*TRADE: Vender abre el formulario de orden');
    igual(ordenes[0], { proposito: 'venta_gestor', posicion_id: 1, broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', cantidad: 2, accion: 'venta', orderTerm: 'DAY', priceType: 'LIMIT', limitPrice: 4.2, sin_migracion: false, canceladas: false },
      '…ya lleno: venta de cierre, qty entera (×2), LIMIT al mark del bróker ($4.20), DAY, bróker dueño (E*TRADE); sin ventas vivas conocidas no se cancela nada');
    const pre2 = V.preVenta(filas[2], null);
    igual([pre2.cantidad, pre2.limitPrice, pre2.priceType], [2, undefined, 'LIMIT'], '2.6 contratos → 2 enteros; sin mark el límite va vacío (lo tocas en la cadena), nunca 0');
    igual(V.venderGestor(7), 'fuera', 'moomoo: Vender NO abre el formulario de orden (el servidor no opera moomoo)');
    igual(ordenes.length, 1, '…ninguna orden se armó para moomoo');
    const m = modales[modales.length - 1].innerHTML;
    assert(/Vender en moomoo/.test(m) && /la venta la confirmas tú en la app de moomoo/.test(m) && /el servidor no puede operar tu cuenta/.test(m), 'el cuadro explica que la venta se confirma en la app de moomoo', m.slice(0, 300));
    assert(/VENDER 1 × META 700 PUT vence 2026-10-16 · LIMIT \$4\.90 · DAY · moomoo/.test(m), 'con el ticket pre-armado (qty, contrato, LIMIT al mark, DAY, bróker)', m);
    assert(/MZ\.copiarTicketVenta\(\)/.test(m) && /MZ\.cerrar\(7, 5\)/.test(m), 'con «Copiar ticket» y «Ya vendí: registrar la salida»');
    igual(V.textoTicketVenta({ ...META, broker: 'tasty' }, 4.9), 'VENDER 1 × META 700 PUT vence 2026-10-16 · LIMIT $4.90 · DAY · tastytrade', 'tasty: el mismo ticket con su bróker');
    igual(V.venderGestor(999), 'sin_fila', 'una ficha que ya no está en pantalla: se relee, no se vende a ciegas');
    igual(sb.llamadas.length, 0, 'NADA se escribió ni se mandó por este camino (cero llamadas a la base)');
    // el formulario de orden conoce el prefill del gestor y la bitácora lo registra como salida límite
    assert(/venta_gestor/.test(extraer('abrirOrden')) && /Vender<\/b> \(gestor\): venta de cierre LIMIT DAY al mark/.test(extraer('abrirOrden')), 'abrirOrden muestra el aviso de la venta del gestor (LIMIT DAY al mark)');
    const PD = construir(['propositoDe']);
    igual(PD.propositoDe({ accion: 'venta', priceType: 'LIMIT' }, { proposito: 'venta_gestor' }), 'salida_gestor', 'la bitácora la registra con su propósito PROPIO (salida_gestor, 0018): cuenta como venta viva mientras está enviada y Cortar la cancela, pero no silencia «PON TU GTC» al cancelarse ni veta la GTC automática');
    igual(PD.propositoDe({ accion: 'venta', priceType: 'LIMIT' }, { proposito: 'venta_gestor', sin_migracion: true }), 'salida_gtc', 'sin 0018 (el check de ordenes no admite salida_gestor) cae a salida_gtc, como antes');
    igual(PD.propositoDe({ accion: 'compra', priceType: 'LIMIT' }, { proposito: 'venta_gestor' }), 'entrada', 'una compra sigue siendo entrada');
    assert(/'salida_gestor'/.test(C.extraerConst('PROPOSITOS')) && /in\('proposito', \['salida_gtc', 'salida_corte', 'salida_gestor'\]\)/.test(extraer('vistaCopiloto')), 'el Copiloto lee también las salida_gestor para saber si hay una venta viva');
    const GV = construir(['gtcPendientes', 'gtcAutoVetadas'], { PREVIEW_SEG: 180 });
    igual(GV.gtcPendientes([SPY], [{ posicion_id: 1, estado: 'enviada', proposito: 'salida_gestor', creado_at: new Date().toISOString() }]).length, 0, 'una venta del gestor ENVIADA cuenta como venta viva: no se pide la GTC (los contratos están reservados)');
    igual(GV.gtcPendientes([SPY], [{ posicion_id: 1, estado: 'cancelada', proposito: 'salida_gestor', creado_at: new Date().toISOString() }]).length, 1, 'cancelada, vuelve a pedirse la GTC');
    igual(GV.gtcAutoVetadas([{ posicion_id: 1, estado: 'cancelada', proposito: 'salida_gestor', creado_at: new Date().toISOString() }]).size, 0, 'y una venta del gestor cancelada NO veta la GTC automática (una salida_gtc cancelada sí, como siempre)');
    // Vender con una venta VIVA (la GTC automática): se cancela y se espera la confirmación ANTES de abrir la venta (como Cortar)
    {
      const reg = { cancelados: [], abiertos: [], toasts: [], confirms: [], sync: 0 };
      const sbC = sbFalso((tabla, cadena) => {
        const m0 = cadena[0][0], sel = cadena[0][1][0];
        if (tabla === 'ordenes' && m0 === 'select' && sel === '*') return { data: [{ id: 1, estado: 'enviada', orden_id_ext: '111', proposito: 'salida_gtc', broker: 'etrade' }], error: null };
        if (tabla === 'ordenes' && m0 === 'select' && sel === 'id,estado') return { data: [{ id: 1, estado: 'cancelada' }] };
        throw new Error('consulta no prevista: ' + tabla + ' ' + m0);
      });
      const filasC = [{ ...SPY, _br: { mark: 4.20 }, _gtcPendiente: false }];
      const VC = construir(['venderGestor', 'venderConCancelacion', 'cancelarVentasVivas', 'preVenta', 'gestorFila', 'markGestor'],
        { esc, sb: sbC, BROKER_NOMBRE, _gestor: { filas: filasC, pend: {}, sinColumnas: false }, _corte: { enCurso: false }, abrirOrden: (pre) => reg.abiertos.push(pre), toast: (t) => reg.toasts.push(t), ruta: () => {},
          confirm: (t) => { reg.confirms.push(t); return true; }, alert: (t) => reg.toasts.push('alert:' + t), document: { querySelector: () => null }, brokersOperables: () => ['etrade'], gtcAutoMarcar: () => {},
          cancelarOrden: async (id, ext, br, op) => { reg.cancelados.push([br, id, ext, op]); return true; }, cancelarOrdenSchwab: async () => true, ordenesActualizar: async () => { reg.sync++; }, $: () => nodo(),
          setTimeout, CORTE_TOPE_MS: 15000, CORTE_PASO_MS: 1 }, { consts: ['_venta'] });
      igual(VC.venderGestor(1), 'cancelando', 'con la GTC viva (_gtcPendiente = false) Vender NO abre la orden de golpe: cancela primero');
      await new Promise(r => setTimeout(r, 30)); await respirar();
      assert(/Primero se cancelan tus ventas vivas/.test(reg.confirms[0]), 'lo pregunta antes de tocar nada', reg.confirms[0]);
      igual(reg.cancelados.map(c => [c[0], c[2], c[3]]), [['etrade', '111', { sinConfirmar: true }]], 'cancela la venta viva en su bróker');
      assert(reg.sync >= 1, 'y espera a que el bróker confirme la cancelación');
      igual(reg.abiertos.length, 1, 'entonces abre la venta');
      igual([reg.abiertos[0].proposito, reg.abiertos[0].orderTerm, reg.abiertos[0].priceType, reg.abiertos[0].limitPrice, reg.abiertos[0].canceladas], ['venta_gestor', 'DAY', 'LIMIT', 4.2, true], 'LIMIT DAY al mark, con la marca de que las ventas vivas ya se cancelaron (el formulario lo dice)');
      igual(sbC.llamadas.filter(l => l.cadena[0][0] !== 'select').length, 0, 'por este camino no se escribe nada en la base (cancelar y ordenar van por el proxy y el formulario)');
      assert(/Tus ventas vivas de esta posición ya están canceladas/.test(extraer('abrirOrden')) && /No había ninguna venta viva/.test(extraer('abrirOrden')), 'abrirOrden dice si las ventas vivas se cancelaron o si no había ninguna');
    }
  }

  // ════════════════ 8. TABLA (Mac) vs TARJETAS (iPhone) por ancho, con el módulo ENTERO ════════════════
  {
    const F = construir(['gestorFormato', 'anchoVista'], {}, { consts: ['GESTOR_ANCHO_TABLA'] });
    igual([F.gestorFormato(899), F.gestorFormato(900), F.gestorFormato(1200), F.gestorFormato(0), F.gestorFormato(null)], ['tarjetas', 'tabla', 'tabla', 'tarjetas', 'tarjetas'], 'desde 900 px la tabla; por debajo (y sin ancho) tarjetas');
    igual(F.anchoVista(), 0, 'sin window (pruebas) el ancho es 0 → tarjetas');
    const mod = cargarModuloEntero({ hash: '#/copiloto' });
    assert(mod.cargo, 'app/main.js entero carga en el DOM de juguete', mod.error);
    const MZ = mod.ev('window.MZ');
    ['gestorTeclear', 'gestorSoltar', 'gestorCasilla', 'gestorModo', 'gestorActivo', 'gestorVigilarTodas', 'venderGestor', 'cerrarVentaFuera', 'copiarTicketVenta', 'gchSym', 'gchTf', 'gchRango', 'gchBB', 'gchZoom', 'gchReset']
      .forEach(k => assert(typeof MZ[k] === 'function', 'window.MZ.' + k + ' existe (los onclick de la tabla y del gráfico lo necesitan)'));
    const cart = { etrade: { estado: 'ok', ts: Date.now(), truncada: false, otros: {}, items: [
      { broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', contratos: 2, prima_fill: 3.30, mark: 4.20, valor_actual: 840, invertido: 660, pnl_usd: 178.70, pnl_pct: 27.1, clave: 'etrade|SPY|CALL|770|2026-10-02' },
      { broker: 'etrade', symbol: 'AAPL', direccion: 'CALL', strike: 235, expiracion: '2026-10-09', contratos: 2, prima_fill: 1.32, mark: 1.55, valor_actual: 310, invertido: 264, pnl_usd: 44.70, pnl_pct: 16.9, clave: 'etrade|AAPL|CALL|235|2026-10-09' }] },
      schwab: { estado: 'sin', items: [] }, tasty: { estado: 'sin_foto', items: [] }, moomoo: { estado: 'sin_foto', items: [] } };
    mod.win._cartPrueba = cart;
    mod.ev('_posPrueba = ' + JSON.stringify([SPY, NVDA, META, TSLA]));
    mod.win.innerWidth = 1200;
    const mac = mod.ev("seccionPosiciones(_posPrueba, _cartPrueba, PLANES.PLAN_10, '" + HOY + "')");
    assert(/<table class="gtbl">/.test(mac) && (mac.match(/<th>/g) || []).length === 10, 'Mac (1200 px): UNA tabla con las 10 columnas', String((mac.match(/<th>/g) || []).length));
    assert(/<th>Contrato<\/th><th>Cant<\/th><th>Costo<\/th><th>Mark<\/th><th>P&amp;L<\/th><th>Modo de salida<\/th><th>Parámetros<\/th><th>Salta en<\/th><th>Activo<\/th><th><\/th>/.test(mac), 'en el orden de la mesa vieja: Contrato · Cant · Costo · Mark · P&L · Modo de salida · Parámetros · Salta en · Activo · Vender');
    igual((mac.match(/<tr class="grow/g) || []).length, 5, '5 filas: 4 del libro + AAPL sin registrar en la MISMA tabla');
    assert(/SPY 770 CALL<\/b><span class="gbrk">E\*TRADE<\/span>/.test(mac) && /pagaste \$660\.00/.test(mac) && /vale \$840\.00/.test(mac) && /\+27\.1%/.test(mac) && /\+\$178\.70/.test(mac) && /neto/.test(mac), 'fila SPY: contrato + pastilla, «pagaste $660.00», mark del bróker «vale $840.00», P&L +27.1 % y +$178.70 neto del bróker (el % y el $ salen de la MISMA fuente: totalGainPct del bróker, no el mark de la app contra su $ neto)');
    assert(/id="g_salta_1"[^>]*>[^]*?4\.00<\/b>/.test(mac) && /−20% del máx 5\.00/.test(mac) && /margen 5\.0%/.test(mac), 'SALTA EN de SPY: 4.00, «−20% del máx 5.00», «margen 5.0%»');
    assert(/💤 se arma a \+25%/.test(mac) && /8\.00<\/span> \/ /.test(mac) && /calculado sobre 5\.00/.test(mac), 'NVDA dormido y META en Objetivo+Stop en la misma tabla');
    assert(/id="g_trail_pct_1"[^>]*value="20"[^>]*oninput="MZ\.gestorTeclear\(1, 'trail_pct', this\.value\)"[^>]*onblur="MZ\.gestorSoltar\(1, 'trail_pct', this\.value\)"/.test(mac), 'los parámetros son inputs en la fila que guardan por ID (oninput → debounce, onblur → ya)');
    assert(/id="g_target_pct_7"[^>]*value="60"/.test(mac) && /id="g_stop_fijo_pct_7"[^>]*value="45"/.test(mac) && !/id="g_stop_pct_/.test(mac), 'en fijo los inputs son +target % y −stop_fijo % (el corte del plan no es editable desde el gestor)');
    assert(/<input class="gin" type="text" inputmode="decimal"/.test(mac) && !/type="number"/.test(mac), 'los parámetros son type=text inputmode=decimal (conservan el cursor en el redibujo; number no da selectionStart)');
    assert(/gestor: cada posición usa UN modo de salida; la Mesa avisa y pre-arma la venta, tú confirmas con un toque \(sin latido del worker/.test(mac), 'sin latido del worker la cabecera no afirma que alguien vigile');
    // 0018 sin aplicar: la primera lectura no trae modo_salida → el gestor se apaga y lo dice
    mod.ev('_posPrueba0018 = ' + JSON.stringify([SPY, NVDA].map(p => { const q = { ...p }; delete q.modo_salida; delete q.trail_pct; delete q.arm_pct; delete q.protege_costo; delete q.activo; delete q.nivel_trailing; delete q.stop_fijo_pct; return q; })));
    const sinMig = mod.ev("seccionPosiciones(_posPrueba0018, _cartPrueba, PLANES.PLAN_10, '" + HOY + "')");
    assert(/avisos del gestor PENDIENTES: la migración 0018 no está en la base/.test(sinMig) && /⚠ el servidor aún no vigila este nivel/.test(sinMig), 'sin 0018 la cabecera y la celda «Salta en» dicen que nadie vigila (no «la Mesa avisa»)', sinMig.slice(0, 400));
    assert(/id="g_trail_pct_1"[^>]*disabled/.test(sinMig) && /class="gchip on" disabled/.test(sinMig) && /id="g_activo_1"[^>]*disabled/.test(sinMig), 'y los inputs, chips y casillas van desactivados');
    igual(mod.ev('_gestor.sinColumnas'), true, '_gestor.sinColumnas queda anotado');
    mod.ev("_gestor.worker = { import_ok: true, migracion_0018: true }");
    const conW = mod.ev("seccionPosiciones(_posPrueba, _cartPrueba, PLANES.PLAN_10, '" + HOY + "')");
    assert(/la Mesa avisa \(el worker vigila estos niveles cada minuto en sesión\)/.test(conW) && !/aún no vigila/.test(conW) && !/disabled/.test(conW.slice(conW.indexOf('<table'))), 'con las columnas y el latido del worker con gestor + 0018: «el worker vigila estos niveles», sin avisos ni inputs apagados');
    mod.ev("_gestor.worker = { import_ok: true, migracion_0018: false }");
    assert(/PENDIENTES del worker/.test(mod.ev("seccionPosiciones(_posPrueba, _cartPrueba, PLANES.PLAN_10, '" + HOY + "')")), 'worker sin 0018 a la vista: «avisos del gestor PENDIENTES del worker»');
    mod.ev("gestorEstadoDelLatido({ detalle: { tasty_ok: true } })");
    igual(mod.ev('_gestor.worker && _gestor.worker.sin_gestor'), true, 'un latido SIN detalle.gestor (worker 0.1.6) se lee como «sin gestor»');
    mod.ev("gestorEstadoDelLatido(null); _gestor.sinColumnas = false");
    assert(/MZ\.gestorModo\(1, 'trailing'\)/.test(mac) && /MZ\.gestorModo\(1, 'fijo'\)/.test(mac), 'chips Trailing | Objetivo+Stop');
    assert(/id="g_activo_9"[^>]*(?!checked)/.test(mac) && /class="grow dormida/.test(mac) && /🔕/.test(mac), 'TSLA apagada: casilla sin marcar, fila teñida y 🔕');
    assert(/MZ\.venderGestor\(1\)/.test(mac) && />Vender<\/button>/.test(mac) && /MZ\.venderGestor\(7\)/.test(mac) && />Vender en moomoo<\/button>/.test(mac), 'Vender por bróker: «Vender» en E*TRADE, «Vender en moomoo» en moomoo');
    assert(/SIN REGISTRAR/.test(mac) && /MZ\.adoptar\('etrade\|AAPL\|CALL\|235\|2026-10-09'\)/.test(mac), 'la sin registrar sale en la tabla con su Adoptar');
    assert(/SIN VIGILANCIA/.test(mac) && /CARTERA ABIERTA/.test(mac) && mac.indexOf('SIN VIGILANCIA') < mac.indexOf('CARTERA ABIERTA') && mac.indexOf('CARTERA ABIERTA') < mac.indexOf('<table class="gtbl">'), 'encima de la tabla, en orden: alarma → barra → tabla');
    assert(/MZ\.cortarPosicion\(1\)/.test(mac) && />GTC \+10% \(\$3\.65\)/.test(mac) && /MZ\.notaDePosicion\(1, 'SPY'\)/.test(mac) && /MZ\.cerrar\(1, 3\.3\)/.test(mac), 'la fila de detalle conserva lo de siempre: Cortar, GTC, Nota, Registrar salida');
    mod.win.innerWidth = 390;
    const iph = mod.ev("seccionPosiciones(_posPrueba, _cartPrueba, PLANES.PLAN_10, '" + HOY + "')");
    assert(!/<table class="gtbl">/.test(iph) && (iph.match(/class="gest/g) || []).length === 4, 'iPhone (390 px): sin tabla, un bloque del gestor en cada una de las 4 tarjetas');
    ['−20% del máx 5.00', 'margen 5.0%', '💤 se arma a +25%', 'calculado sobre 5.00', "MZ.gestorModo(1, 'fijo')", 'id="g_trail_pct_1"', 'MZ.venderGestor(1)', 'Vender en moomoo', 'MZ.gestorActivo(9, this.checked)', 'SIN VIGILANCIA', 'CARTERA ABIERTA', 'MZ.adoptar(']
      .forEach(t => assert(iph.includes(t), 'las tarjetas no pierden nada: «' + t + '»'));
    assert(/class="card dormida"/.test(iph) && /🔕 TSLA CALL 400/.test(iph), 'la tarjeta apagada va teñida y con 🔕');
    assert(/Trailing<\/button>/.test(iph) && /Objetivo\+Stop<\/button>/.test(iph), 'chips en la tarjeta también');
    // el Copiloto usa todo esto
    const vc = extraer('vistaCopiloto');
    assert(/seccionGrafico\(abiertas, hoy\)/.test(vc) && /pintarConservandoFoco\(\$\('#vista'\), h\)/.test(vc) && /copilotoAncho\(true\)/.test(vc) && /gchWire\(\)/.test(vc) && /cargarChartGestor\(false\)/.test(vc) && /gestorEstadoDelLatido\(hb\)/.test(vc),
      'vistaCopiloto: gráfico debajo de la tabla, redibujo conservando el foco (parámetros a medio teclear), envoltorio ancho, gestos del chart y el latido del gestor');
    assert(/if \(copilotoEnUso\(\)\) \{ \(_gestor\.filas \|\| \[\]\)\.forEach\(p => pintarSaltaEnSitio\(p\.id\)\); \}/.test(vc), 'con un parámetro del gestor enfocado NO se repinta #vista (solo las celdas «Salta en» en sitio): sin bucle blur → UPDATE → Realtime → redibujo');
    // copilotoEnUso y el cursor al final
    {
      let activo = null;
      const vista = nodo({ contains: (a) => a && a.dentro === true });
      const U = construir(['copilotoEnUso', 'pintarConservandoFoco'], { document: { get activeElement() { return activo; } }, $: (s) => (s === '#vista' ? vista : (activo && activo.id === s.slice(1) ? activo : null)) });
      igual(U.copilotoEnUso(), false, 'sin nada enfocado, el Copiloto no está en uso');
      activo = { tagName: 'INPUT', classList: { contains: (c) => c === 'gin' }, dentro: true, id: 'g_trail_pct_1' };
      igual(U.copilotoEnUso(), true, 'un .gin enfocado dentro de #vista = en uso');
      activo = { tagName: 'INPUT', classList: { contains: () => false }, dentro: true, id: 'oSym' };
      igual(U.copilotoEnUso(), false, 'otro input (p. ej. del formulario de orden) no cuenta');
      activo = { tagName: 'BUTTON', classList: { contains: () => true }, dentro: true, id: 'b' };
      igual(U.copilotoEnUso(), false, 'un botón tampoco');
      let sel = null;
      const campo = { id: 'g_trail_pct_1', value: '25', selectionStart: null, selectionEnd: null, dentro: true, tagName: 'INPUT', classList: { contains: () => true }, focus() {}, setSelectionRange(a, b) { sel = [a, b]; } };
      activo = campo;
      const el = nodo({ contains: () => true });
      U.pintarConservandoFoco(el, '<x/>');
      igual([el.innerHTML, sel], ['<x/>', [2, 2]], 'sin posición guardada (selectionStart null, como en type=number) el cursor va al FINAL del valor, no al inicio (2, pausa, 5 → 25, no 52)');
      campo.selectionStart = 1; campo.selectionEnd = 1; sel = null;
      U.pintarConservandoFoco(el, '<y/>');
      igual(sel, [1, 1], 'con posición guardada se restaura tal cual');
    }
    assert(/if \(tab === 'copiloto' && typeof copilotoAncho === 'function'\) copilotoAncho\(true\);/.test(extraer('ruta')), 'ruta() enciende el ancho del Copiloto en el mismo tick (sin salto de ancho cada minuto)');
    assert(/\.gtbl\{/.test(require('fs').readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8')) && /\.gest\{/.test(require('fs').readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8')), 'index.html trae el CSS de la tabla y del bloque del gestor');
  }

  // ════════════════ 9. moomoo como bróker del worker en la cartera ════════════════
  {
    const FOTO = [{ user_id: 'u', broker: 'moomoo', clave: 'META  261016P00700000', symbol: 'META', direccion: 'PUT', strike: 700, expiracion: '2026-10-16', contratos: 1, costo_promedio: 5, mark: 4.9, mark_fuente: 'vivo', valor_usd: 490, pl_usd: -10, pl_pct: -2, origen: 'worker', actualizado_at: new Date().toISOString() }];
    const sb = sbFalso((tabla, cadena) => ({ data: FOTO.filter(f => cadena.every(([m, a]) => m !== 'eq' || f[a[0]] === a[1])), error: null }));
    const W = construir(['leerCarteraWorker', 'leerCarteraMoomoo', 'leerCarteraTasty', 'normalizarPosBroker', 'claveCartera', 'claveContrato', 'textoErrorTabla', 'textoLecturaBroker'], { sb, FOTO_VIEJA_MS: 3 * 3600000, BROKER_NOMBRE });
    const rm = await W.leerCarteraMoomoo();
    assert(rm.estado === 'ok' && rm.items.length === 1 && rm.items[0].broker === 'moomoo' && rm.items[0].prima_fill === 5 && rm.origen === 'worker', 'leerCarteraMoomoo: la foto del worker de moomoo entra como un bróker más (mismo shape que tasty/E*TRADE)', JSON.stringify(rm).slice(0, 200));
    igual(sb.llamadas[0].cadena, [['select', ['*']], ['eq', ['broker', 'moomoo']]], 'lee posiciones_broker filtrando broker = moomoo');
    igual((await W.leerCarteraTasty()).estado, 'sin_foto', 'tasty sin filas: sin_foto (no «no tienes nada»)');
    assert(/^moomoo: sin filas en la foto del worker/.test(W.textoLecturaBroker('moomoo', { estado: 'sin_foto' })), 'el texto de «sin foto» nombra al bróker');
    assert(/CART_BROKERS/.test(extraer('brokersLeidos')) && /CART_BROKERS/.test(extraer('itemsCartera')) && /CART_BROKERS/.test(extraer('firmaCartera')) && /moomoo: null/.test(C.extraerConst('_cart')), 'la cartera (leídos, ítems, firma, estado) va por CART_BROKERS con moomoo dentro');
  }

  // ════════════════ 10. EL GRÁFICO del gestor: tf, rango, ventana, strikes y leyenda ════════════════
  const T0 = Math.floor(Date.parse('2026-09-28T13:30:00Z') / 1000);
  const velas = (n, paso, base) => Array.from({ length: n }, (_, i) => { const o = base + Math.sin(i / 5), c = o + Math.cos(i / 3) * 0.4; return [T0 - (n - i) * paso, +o.toFixed(2), +(Math.max(o, c) + 0.3).toFixed(2), +(Math.min(o, c) - 0.3).toFixed(2), +c.toFixed(2), 100 + i]; });
  {
    const CH = construir(['chartSvg', 'bollingerApp', 'smaApp', 'techoPisoProximos', 'chartTiempo', 'chartFrescoTxt'], { esc, haceCuanto }, { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'] });
    const pk = { ticker: 'SPY', tf: 'm5', velas: velas(400, 300, 770), vela_viva: [T0, 770.1, 770.6, 769.9, 770.3, 50], niveles: { spot: 770.3, cierre_ayer: 769.0, apertura_hoy: 769.6, ath: 780.5, atl: 742.0, ath_dias: 120, techos_hora: [{ p: 771.5 }], pisos_hora: [{ p: 768.8 }] } };   // niveles CERCA del precio: un nivel lejano (±35 %) se omite a propósito
    const svg = CH.chartSvg(pk, { vista: 'bb', tf: 'm5', h: 372, w: 1100, ventana: { start: 352, end: 400 }, hlines: true, extra: [{ v: 770, c: 'var(--verde)', lb: '770.00 CALL ×2 +27%', k: 'strike', w: 1.6, op: .95 }] });
    assert(/viewBox="0 0 1100 372"/.test(svg) && /aria-label="SPY 5 min Bollinger"/.test(svg), 'viewBox ancho del Mac (1100 × 372) y «5 min» en el aria-label', svg.slice(0, 120));
    igual((svg.match(/<rect class="vela"/g) || []).length, 48, 'ventana {352, 400}: 48 velas cerradas (4 h de 5 min)');
    assert(/class="vela viva"/.test(svg), 'mirando el presente sale la vela en curso');
    assert(/data-nivel="strike"/.test(svg) && />770\.00 CALL ×2 \+27%<\/text>/.test(svg), 'la línea del strike con su etiqueta «770.00 CALL ×2 +27%»');
    assert(/data-nivel="techo"/.test(svg) && /data-nivel="piso"/.test(svg) && /data-nivel="cierre_ayer"/.test(svg), 'las H-lines Sardiñas (techo/piso de hora, cierre de ayer) también sobre Bollinger (op.hlines)');
    assert(/data-bb="banda"/.test(svg), 'con BB encendido va la banda');
    const sinBB = CH.chartSvg(pk, { vista: 'bb', tf: 'm5', bb: false, ventana: { start: 352, end: 400 } });
    assert(!/data-bb=/.test(sinBB) && /<rect class="vela"/.test(sinBB), 'BB apagado: velas sin banda');
    const atras = CH.chartSvg(pk, { vista: 'bb', tf: 'm5', ventana: { start: 100, end: 148 } });
    assert(!/viva/.test(atras) && (atras.match(/<rect class="vela"/g) || []).length === 48, 'arrastrado al pasado (end < total): 48 velas y SIN vela viva');
    igual((CH.chartSvg({ ...pk, vela_viva: null }, { vista: 'bb', tf: 'm5' }).match(/<rect class="vela"/g) || []).length, 96, 'sin ventana, en 5 min se ven las últimas 96 (MAXV)');
    igual((CH.chartSvg({ ...pk, tf: 'm1', velas: velas(400, 60, 770), vela_viva: null }, { vista: 'bb', tf: 'm1' }).match(/<rect class="vela"/g) || []).length, 120, 'en 1 min, 120 por defecto');
    assert(!/data-nivel="techo"/.test(CH.chartSvg(pk, { vista: 'bb', tf: 'm5' })) && /viewBox="0 0 400 200"/.test(CH.chartSvg(pk, { vista: 'bb', tf: 'm5' })), 'sin op.hlines ni op.w el chart de Tickers sigue igual (400 de ancho, sin techo/piso en Bollinger)');
    assert(/última vela/.test(CH.chartFrescoTxt({ payload: pk }, 'm5')), 'chartFrescoTxt entiende m5');
    const CHV = construir(['gchVentana'], {}, { consts: ['GCH_TFS', 'gchTfDef'] });
    igual(CHV.gchVentana(400, 5, 240, { count: null, end: null }), { start: 352, end: 400, count: 48, total: 400 }, 'rango 4 h en 5 min = 48 velas pegadas al presente');
    igual(CHV.gchVentana(400, 1, 960, { count: null, end: null }), { start: 0, end: 400, count: 400, total: 400 }, 'Sesión (960 min) en 1 min pide 960 velas: con las 400 publicadas se ven todas');
    igual(CHV.gchVentana(400, 1, 240, { count: null, end: null }), { start: 160, end: 400, count: 240, total: 400 }, '4 h en 1 min = 240 velas');
    igual(CHV.gchVentana(60, 15, 960, { count: null, end: null }), { start: 0, end: 60, count: 60, total: 60 }, 'con menos velas que el rango se ve todo');
    igual(CHV.gchVentana(400, 5, 240, { count: 30, end: 200 }), { start: 170, end: 200, count: 30, total: 400 }, 'zoom + arrastre: 30 velas terminando en la 200');
    igual(CHV.gchVentana(400, 5, 240, { count: 3, end: 9000 }), { start: 394, end: 400, count: 6, total: 400 }, 'mínimo 6 velas y el fin nunca pasa del total');
    igual(CHV.gchTfDef('m1')[3], ['m1', '1m'], 'el tf 1m se busca en ticker_velas con sus dos grafías (m1 y 1m)');
    igual(CHV.gchTfDef('raro')[0], 'm5', 'un tf desconocido cae a 5 min');
  }
  {
    const L = construir(['nivelesPosicionesChart', 'reglaGestor', 'acotarGestor', 'nivelGestor', 'markGestor', 'gtcDePosicion', 'gtcLimite', 'planDePct', 'corteDe', 'fmtPrima'], { PLAN_PCT: 35, PLANES: { PLAN_35: { gtcPct: 35 }, PLAN_10: { gtcPct: 10 } } }, { consts: ['GESTOR_DEF', 'GESTOR_RANGOS', 'GCH_COLORES'] });
    const r = L.nivelesPosicionesChart([{ ...SPY, _br: { mark: 4.20 } }, META, NVDA], 'SPY', 2);
    igual(r.lineas.map(l => [l.v, l.c, l.lb, l.k]), [[770, 'var(--verde)', '770.00 CALL ×2  +27%', 'strike']], 'una línea por strike del ticker elegido (CALL en verde) con la etiqueta «770.00 CALL ×2 +27%»; las de otros tickers no entran');
    igual(r.leyenda.map(l => l.txt), ['770.00 CALL ×2  +27%', 'GTC $3.65', 'corte $2.64', 'trailing $4.00'], 'la leyenda: el strike, y el GTC, el corte y el nivel de trailing como PRIMAS (no como líneas del subyacente)');
    assert(r.leyenda.slice(1).every(l => l.prima === true) && r.leyenda[1].c === 'var(--oro)' && r.leyenda[2].c === 'var(--rojo)' && r.leyenda[3].c === 'var(--morado)', 'cada prima con su color: GTC oro, corte rojo, trailing morado');
    const rm = L.nivelesPosicionesChart([META], 'META', 2);
    igual([rm.lineas[0].c, rm.lineas[0].lb, rm.leyenda.map(l => l.txt)], ['var(--rojo)', '700.00 PUT ×1  -2%', ['700.00 PUT ×1  -2%', 'GTC $5.52', 'corte $4.00', 'objetivo $8.00', 'stop $2.75']], 'un PUT en rojo; en modo fijo la leyenda lleva objetivo y stop (2.75, stop_fijo_pct) y el corte del plan aparte (4.00)');
    igual(L.nivelesPosicionesChart([NVDA], 'NVDA', 2).leyenda.map(l => l.txt), ['185.00 CALL ×3  +7%', 'GTC $2.86', 'trailing 💤 +25%'], 'trailing dormido: «trailing 💤 +25%», y sin corte (Plan 35) no hay corte');
    igual(L.nivelesPosicionesChart([{ ...SPY, strike: null }], 'SPY', 2).lineas, [], 'sin strike no hay línea');
  }
  {
    // cargarVelasGestor: pide el tf con sus grafías y cachea; sin filas devuelve null
    const filas = [{ symbol: 'SPY', tf: '5m', payload: { velas: velas(50, 300, 770) }, actualizado_at: new Date().toISOString() }];
    const sb = sbFalso((tabla, cadena) => ({ data: filas.filter(f => cadena.every(([m, a]) => (m === 'eq' ? f[a[0]] === a[1] : m === 'in' ? a[1].includes(f[a[0]]) : true))), error: null }));
    const V = construir(['cargarVelasGestor'], { sb, _velas: new Map(), _velasVuelo: new Map(), CHART_CACHE_MS: 50000 }, { consts: ['GCH_TFS', 'gchTfDef'] });
    const f = await V.cargarVelasGestor('SPY', 'm5');
    assert(f && f.tf === '5m', 'el tf «m5» se encuentra aunque el worker lo publique como «5m»');
    igual(sb.llamadas[0].cadena.filter(x => x[0] !== 'select'), [['eq', ['symbol', 'SPY']], ['in', ['tf', ['m5', '5m']]]], 'la consulta: symbol = SPY y tf in (m5, 5m)');
    await V.cargarVelasGestor('SPY', 'm5');
    igual(sb.llamadas.length, 1, 'la segunda lectura dentro de los 50 s sale de la caché');
    igual(await V.cargarVelasGestor('SPY', 'm1'), null, 'sin velas de 1 min: null (quien llama cae a 15 min y lo dice)');
    // cargarChartGestor: sin 5m se pinta 15m y se dice; el título dice «SPY · 15 min»
    const nodes = {};
    const _gch = { sym: 'SPY', symManual: false, tf: 'm5', rango: 240, bb: true, view: { count: null, end: null }, pos: [], gen: 0, fila: null, tfReal: null, niveles15: null, pintado: null };
    const fila15 = { symbol: 'SPY', tf: 'm15', payload: { ticker: 'SPY', tf: 'm15', velas: velas(130, 900, 770), niveles: { spot: 770.3, cierre_ayer: 766.2 } }, actualizado_at: new Date().toISOString() };
    const P = construir(['cargarChartGestor', 'pintarChartGestor', 'gchVentana', 'nivelesPosicionesChart', 'reglaGestor', 'acotarGestor', 'nivelGestor', 'markGestor', 'gtcDePosicion', 'gtcLimite', 'planDePct', 'corteDe', 'fmtPrima', 'techoPisoProximos'],
      { esc, _gch, _targets: { por: {} }, PLAN_PCT: 35, PLANES: { PLAN_35: { gtcPct: 35 }, PLAN_10: { gtcPct: 10 } }, decDe: () => 2, anchoVista: () => 1200, chartFrescoTxt: () => 'última vela hace 1 min',
        cargarVelasGestor: async (sym, tf) => (tf === 'm15' ? fila15 : null), cargarTargets: async () => ({}), chartSvg: (pk, op) => `<svg data-tf="${op.tf}" data-w="${op.w}" data-h="${op.h}" data-extra="${(op.extra || []).length}"></svg>`,
        $: (s) => (nodes[s] = nodes[s] || nodo({ clientWidth: 1100 })) },
      { consts: ['GESTOR_ANCHO_TABLA', 'GESTOR_DEF', 'GESTOR_RANGOS', 'GCH_TFS', 'GCH_RANGOS', 'GCH_COLORES', 'GCH_ALTO_MAC', 'GCH_ALTO_IPHONE', 'gchTfDef'] });
    _gch.pos = [SPY];
    await P.cargarChartGestor(true);
    igual([_gch.tfReal, nodes['#gchTitulo'].textContent], ['m15', 'SPY · 15 min'], 'sin velas de 5 min se cae a 15 min y el título lo dice');
    assert(/sin velas de 5 min todavía \(el worker aún no las publica\): se muestra 15 min/.test(nodes['#gchFresco'].textContent), 'y el pie lo explica', nodes['#gchFresco'].textContent);
    assert(/data-tf="m15" data-w="1100" data-h="372" data-extra="1"/.test(nodes['#gchSvg'].innerHTML), 'el svg se pide con el tf real, el ancho del contenedor, 372 de alto (Mac) y la línea del strike');
    assert(/770\.00 CALL ×2/.test(nodes['#gchLeg'].innerHTML) && /GTC \$3\.65/.test(nodes['#gchLeg'].innerHTML) && /cierre ayer 766\.20/.test(nodes['#gchLeg'].innerHTML) && /PRIMAS del contrato/.test(nodes['#gchLeg'].innerHTML), 'la leyenda lleva el strike, las primas (con su aviso) y las líneas Sardiñas');
    igual(nodes['#gchZoomTxt'].textContent, '', 'en reposo (sin zoom ni arrastre) el pie del zoom NO dice «⤢ para volver al presente» aunque el rango recorte las velas');
    assert(_gch.pintado && _gch.pintado.sym === 'SPY' && /<svg/.test(_gch.pintado.svg) && /770\.00 CALL/.test(_gch.pintado.leg), 'lo pintado se guarda (svg, leyenda, pie) para el siguiente redibujo');
    // el HTML inicial del siguiente redibujo lleva el svg anterior, no «cargando velas…» (sin salto de 69 px cada minuto)
    const SG = construir(['seccionGrafico', 'gchSimbolo'], { esc, _gch, gchPrefs: () => {}, focoDeHoy: () => null, planFilaCache: () => null, TICKERS: ['SPY', 'AAPL'], anchoVista: () => 1200, gchTfDef: () => ['m5', '5m', 5] }, { consts: ['GCH_TFS', 'GCH_RANGOS', 'GESTOR_ANCHO_TABLA'] });
    const hg = SG.seccionGrafico([SPY], HOY);
    assert(/<div class="gchart" id="gchSvg"><svg/.test(hg) && !/cargando velas/.test(hg) && /770\.00 CALL/.test(hg), 'seccionGrafico reutiliza el svg y la leyenda del tick anterior (mismo símbolo)');
    _gch.pintado.sym = 'AAPL';
    assert(/cargando velas…/.test(SG.seccionGrafico([SPY], HOY)), 'con otro símbolo pintado antes, vuelve el «cargando velas…»');
    _gch.pintado.sym = 'SPY';
    // el pie del zoom: solo tras zoom o arrastre, y «volver al presente» solo si de verdad se fue
    _gch.view = { count: 12, end: null }; P.pintarChartGestor();
    assert(/🔍 velas 119–130 de 130 · ⤢ para ver el rango entero/.test(nodes['#gchZoomTxt'].textContent), 'con zoom y en el presente: «⤢ para ver el rango entero»', nodes['#gchZoomTxt'].textContent);
    _gch.view = { count: 12, end: 100 }; P.pintarChartGestor();
    assert(/🔍 velas 89–100 de 130 · ⤢ para volver al presente/.test(nodes['#gchZoomTxt'].textContent), 'arrastrado al pasado: «⤢ para volver al presente»');
    _gch.view = { count: null, end: null }; P.pintarChartGestor();
    // una petición que no trae nada nuevo conserva lo pintado (no borra el gráfico)
    const gen0 = _gch.gen; const filaAntes = _gch.fila;
    const P2 = construir(['cargarChartGestor'], { $: (s) => nodes[s], _gch, cargarVelasGestor: async () => null, cargarTargets: async () => ({}), pintarChartGestor: () => {} });
    await P2.cargarChartGestor(true);
    assert(_gch.fila === filaAntes && _gch.tfReal === 'm15' && _gch.gen === gen0 + 1, 'sin velas nuevas (las dos consultas vacías) se conservan la fila y el tf pintados');
    // zoom y arrastre sobre la ventana
    const Z = construir(['gchZoom', 'gchPan', 'gchVentana'], { _gch, pintarChartGestor: () => {} }, { consts: ['GCH_TFS', 'gchTfDef'] });
    Z.gchZoom(0.75);
    igual(_gch.view.count, 12, 'acercar (×0.75) sobre las 16 velas de 4 h en 15 min → 12');
    Z.gchZoom(1.35); igual(_gch.view.count, 16, 'alejar (×1.35) → 16');
    Z.gchPan(-10); igual(_gch.view.end, 120, 'arrastrar 10 velas al pasado: la ventana termina en la 120 (de 130)');
    Z.gchPan(50); igual(_gch.view.end, null, 'arrastrar más allá del presente vuelve a pegarse al presente (end null)');
    _gch.view.count = 130; Z.gchPan(-5); igual(_gch.view.end, null, 'con todas las velas a la vista no hay pasado al que moverse');
  }

  // ════════════════ 11. DIARIO: los días operados cuentan cualquier ejecución (compras incluidas) ════════════════
  {
    const claveContrato = construir(['claveContrato']).claveContrato;
    const D = construir(['emparejarFillsFIFO', 'viajeDe', 'operacionCerrada', 'claveFill', 'durMin', 'diasEntre', 'diaADia', 'resumenPorPeriodo', 'lunesDe', 'viernesDe', 'metricasDiario', 'spotDeFill', 'peorFuenteSpot'],
      { claveContrato, hoyNY, ymdNY: C.ymdNY, DIARIO_LADOS_SALIDA: C.extraerConst('DIARIO_LADOS_SALIDA') ? new Function(C.extraerConst('DIARIO_LADOS_SALIDA') + '; return DIARIO_LADOS_SALIDA;')() : [] },
      { consts: ['FUENTES_SPOT'] });   // v60: el contable lleva el spot de la acción
    const F = (broker, clave, lado, contratos, precio, at) => ({ broker, clave_ext: clave, symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-16', lado, contratos, precio, comision: 0, ejecutado_at: at, fecha_ny: at.slice(0, 10), origen: 'dispositivo' });
    // el caso del hallazgo: compra lunes 21, venta martes 22, venta miércoles 23, compra jueves 24 (NVDA, sigue abierta)
    const fills = [F('etrade', 'a', 'compra', 2, 3.00, '2026-09-21T14:00:00.000Z'), F('etrade', 'b', 'venta', 1, 4.50, '2026-09-22T14:00:00.000Z'), F('etrade', 'c', 'venta', 1, 2.00, '2026-09-23T14:00:00.000Z'), { ...F('etrade', 'd', 'compra', 1, 2.10, '2026-09-24T14:00:00.000Z'), symbol: 'NVDA' }];
    const R = D.emparejarFillsFIFO(fills, '2026-09-25');
    const dias = D.diaADia(R.cerradas, null, null, R.viajes);
    const M0 = D.metricasDiario(R.cerradas, dias, R.viajes);
    const M1 = D.metricasDiario(R.cerradas, dias, R.viajes, fills);
    igual([M0.dias_operados, M1.dias_operados], [2, 4], 'sin fills (uso suelto) 2 días con cierre; con los fills del período 4 días operados (los de solo compra también, como la vieja)');
    igual([M1.prom_dia, M1.proy_mes, M1.proy_anio], [Math.round(M1.total / 4 * 100) / 100, Math.round(Math.round(M1.total / 4 * 100) / 100 * 21 * 100) / 100, Math.round(Math.round(M1.total / 4 * 100) / 100 * 252 * 100) / 100], 'promedio y proyecciones sobre los 4 días (antes salían el doble)');
    const sem = D.resumenPorPeriodo(R.cerradas, 'semana', null, null, R.viajes, fills);
    igual(sem[0].dias, 4, 'RESUMEN SEMANAL «Días operados» = 4 con los fills');
    igual(D.resumenPorPeriodo(R.cerradas, 'semana', null, null, R.viajes)[0].dias, 2, 'sin fills, 2 (uso suelto de la pura)');
    igual(D.resumenPorPeriodo(R.cerradas, 'mes', null, null, R.viajes, fills)[0].dias, 4, 'y el mensual igual');
    igual(D.metricasDiario([], [], [], fills).dias_operados, 4, 'un período con solo compras cuenta sus días (antes 0: sin promedio)');
    const vd = extraer('vistaDiario');
    assert(/metricasDiario\(cerradasSel, dias, viajesSel, fillsSelDias\)/.test(vd) && /resumenPorPeriodo\(F\.cerradas, 'mes', null, null, F\.viajes, fills\)/.test(vd), 'vistaDiario pasa los fills del período a las métricas y a los resúmenes');
    const T = construir(['tarjetasResumenDiario'], { esc, dineroD, dineroS: dineroD, pctD2: (x) => (x == null ? '—' : x + '%'), colD: () => 'var(--tx)', BROKER_NOMBRE, hoyNY, subtituloPeriodoDiario: () => 'Todo el historial · 2026-09-21 → 2026-09-25' }, { consts: ['nOps'] });
    const hT = T.tarjetasResumenDiario({ total: -163.25, ops: 2, aciertos: 1, pct: -20.15, mejor: 1, peor: -2, dias_operados: 4, prom_dia: -40.81, proy_mes: -857.01, proy_anio: -10284.12, vencidas: 0, comisiones: 3.25, costo: 810 }, { modo: 'todo' }, []);
    assert(/TOTAL DEL PERÍODO<\/div><div class="vl"[^>]*>-\$163\.25<\/div><div class="sb">[^<]*neto de comisiones<\/div>/.test(hT), 'la tarjeta TOTAL dice «neto de comisiones» (la vieja decía «sin comisiones»: aquí van descontadas y se dice)', hT.slice(0, 300));
    assert(!/neto de comisiones/.test(T.tarjetasResumenDiario({ total: -160, ops: 2, aciertos: 1, pct: -19.75, dias_operados: 4, prom_dia: -40, proy_mes: -840, proy_anio: -10080, vencidas: 0, comisiones: 0 }, { modo: 'todo' }, [])), 'sin comisiones no se dice nada');
    const DD = construir(['seccionDiaADia'], { esc, dineroS: dineroD, pctD: (x) => (x == null ? '—' : x + '%'), colD: () => 'var(--tx)', fechaCorta: (d) => d, BROKER_CORTO: { etrade: 'E*T' } });
    const hD = DD.seccionDiaADia([{ fecha_ny: '2026-09-22', por_broker: { etrade: { pnl: 149, ops: 0, vencidos: 0 } }, total: 149, ops: 0, aciertos: 0, costo: 300, pct: 49.67, acumulado: 149, vencidos: 0 }], ['etrade'], []);
    assert(/tramo de un viaje que cerró otro día/.test(hD) && !/0 ops/.test(hD) && /por TRAMOS vendidos ese día/.test(hD), 'un día con $ y cero operaciones cerradas lo dice («tramo de un viaje que cerró otro día») y el pie explica que el $ y el % van por tramos');
  }

  // ════════════════ 12. textoErrorTabla: una columna que falta no es «la tabla no está» ════════════════
  {
    const E = construir(['textoErrorTabla', 'errorSinColumnas']);
    igual(E.textoErrorTabla({ code: '42703', message: 'column posiciones.trail_pct does not exist' }, 'posiciones'), 'la columna trail_pct de posiciones aún no existe (migración pendiente)', '42703: dice la columna');
    igual(E.textoErrorTabla({ code: 'PGRST204', message: "Could not find the 'activo' column of 'posiciones' in the schema cache" }, 'posiciones'), 'la columna activo de posiciones aún no existe (migración pendiente)', 'PGRST204 (caché del esquema): la columna');
    igual(E.textoErrorTabla({ code: '42P01', message: 'relation "fills" does not exist' }, 'fills'), 'la tabla fills aún no está en la base (migración pendiente)', 'la tabla que no existe sigue diciéndose como tabla');
    igual([E.errorSinColumnas({ code: '42703' }), E.errorSinColumnas({ message: "Could not find the 'x' column" }), E.errorSinColumnas({ code: '42501', message: 'policy' }), E.errorSinColumnas(null)], [true, true, false, false], 'errorSinColumnas reconoce 42703/PGRST204 y nada más');
  }

  // ════════════════ 13. CSS: áreas de toque en iPhone ════════════════
  {
    const css = require('fs').readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8');
    const m = /@media \(max-width:899px\)\{([\s\S]*?)\n  \}/.exec(css);
    assert(m && /\.gchip\{padding:9px 12px;font-size:12px;min-height:34px\}/.test(m[1]) && /\.gin\{padding:8px 6px;font-size:14px;min-height:34px/.test(m[1]) && /\.gvender\{padding:10px 13px;font-size:13px;min-height:36px\}/.test(m[1]) && /\.gchk input,\.gact\{width:22px;height:22px\}/.test(m[1]) && /\.gchk\{padding:8px 6px/.test(m[1]),
      'por debajo de 900 px: chips ≥ 34 px, inputs ≥ 34 px, Vender ≥ 36 px, casillas de 22 px con área de toque en el label (antes 13 px)', m && m[1]);
    assert(/\.gin\[disabled\],\.gchip\[disabled\]\{opacity:\.45;cursor:not-allowed\}/.test(css), 'y los controles apagados (0018 pendiente) se ven apagados');
  }

  C.resumen();
})().catch(e => { C.falla('excepción inesperada', String(e && e.stack || e)); C.resumen(); });
