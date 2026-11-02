#!/usr/bin/env node
/* v68 · B y C (spec70, 2026-11-02), los dos detalles pendientes de la v67 en el gráfico:
     B. la lista H-LINES de la hoja del gráfico en la vista BOLLINGER: el gráfico solo dibuja cierre de ayer y apertura
        (las nativas), pero la lista enseñaba techo, piso, targets y máx/mín sin decir que ahí no están. Ahora la lista
        marca lo que ese gráfico NO dibujó con la MISMA lógica (nivelesDibujados sobre el svg real): «no sale en Bollinger
        — cambia a Medias + H-lines» (con el enlace a esa vista) para las que Bollinger nunca dibuja, y «lejos del precio:
        fuera de este gráfico» para una nativa que no cupo. Medias + H-lines queda IGUAL que en la v67 (byte a byte).
     C. el aria-label del gráfico del gestor (Copiloto) con BB APAGADO decía «… Bollinger: …»: ahora dice lo que de verdad
        se dibuja («velas y H-lines»); con BB encendido, Tickers y la hoja, igual que antes.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Contra la v67 (main 9728186) FALLA: la lista en
   Bollinger no marca nada y el aria-label con BB apagado dice «Bollinger».
   Uso: node test_v68_chart.js wt-v68/app/main.js */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const casa = require(path.join(__dirname, 'casa_pruebas.js'));
const C = casa(process.argv[2], 'test_v68_chart.js');
const { assert, igual, construir, esc, haceCuanto, nodo, extraer, existeConst } = C;
const tiene = (n) => { try { extraer(n); return true; } catch (_) { return false; } };

// ---------- velas y niveles de juguete (los de test_chart_tc2000.js) ----------
const T0 = Math.floor(Date.parse('2026-09-22T13:30:00Z') / 1000);
function velas(n, op) {
  op = Object.assign({ t0: T0, paso: 900, base: 100, amp: 1 }, op || {});
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = op.base + Math.sin(i / 3) * op.amp, c = o + Math.cos(i / 5) * op.amp * 0.6;
    out.push([op.t0 + i * op.paso, Number(o.toFixed(2)), Number((Math.max(o, c) + 0.3).toFixed(2)), Number((Math.min(o, c) - 0.3).toFixed(2)), Number(c.toFixed(2)), 1000 + i]);
  }
  return out;
}
const NV = { spot: 100.25, techos_hora: [{ p: 100.32, respetos: 2, edad: 5 }], pisos_hora: [{ p: 100.18, respetos: 1, edad: 9 }], cierre_ayer: 100.27, apertura_hoy: 100.22,
  ath: 102.5, atl: 97.6, ath_dias: 397 };
const TG = { target: 101.8, target_alto: 102.9, target_bajo: 98.2, fecha: '2026-10-26', fuente: 'finviz' };
const pkD = { ticker: 'AAPL', tf: 'dia', velas: velas(250, { paso: 86400, t0: T0 - 250 * 86400 }), niveles: NV };
const NOMBRES = ['chartSvg', 'bollingerApp', 'smaApp', 'serieExtM', 'mediasExtM', 'techoPisoProximos', 'chartTiempo', 'hlinesLista', 'rangoValido', 'fmtFechaNY',
  'nivelesChart', 'muestraLinea', 'leyendaChartSvg', 'apilarEtiquetas', 'nivelesDibujados'].filter(tiene);
const CONSTS = ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol', 'CHART_COL'].filter(existeConst);
const CH = construir(NOMBRES, { esc, haceCuanto }, { consts: CONSTS });
const NO_BB = /no sale en Bollinger — <a href="#" onclick="MZ\.chartVista\('hl'\);return false">cambia a Medias \+ H-lines<\/a>/;
const filas = (h) => [...h.matchAll(/<div class="hl( fuera)?" data-hl="([^"]*)"><span>[\s\S]*?<\/span><span class="fresco">([^]*?)<\/span><\/div>/g)].map(m => ({ k: m[2], fuera: !!m[1], sub: m[3] }));

// ════════════════ B1. hlinesLista en Bollinger, con las líneas que de verdad dibujó el svg ════════════════
{
  const svgBB = CH.chartSvg(pkD, { vista: 'bb', h: 300, w: 400, tf: 'dia', targets: TG });
  const dib = CH.nivelesDibujados(svgBB).map(x => x.k);
  igual(dib.slice().sort(), ['apertura_hoy', 'cierre_ayer'], 'el gráfico Bollinger de la hoja dibuja SOLO las nativas: cierre de ayer y apertura de hoy');
  const h = CH.hlinesLista(pkD, TG, 2, dib, 'bb');
  const F = filas(h);
  const noBB = F.filter(f => f.fuera).map(f => f.k).sort();
  igual(noBB, ['ath', 'atl', 'piso', 'target', 'target_alto', 'target_bajo', 'techo'], 'en Bollinger la lista marca TODO lo que ese gráfico no dibuja (techo, piso, máx/mín, los tres targets)');
  assert(F.filter(f => f.fuera).every(f => NO_BB.test(f.sub)), '… y cada una dice «no sale en Bollinger — cambia a Medias + H-lines» con el enlace a esa vista', JSON.stringify(F.filter(f => f.fuera && !NO_BB.test(f.sub))));
  assert(F.filter(f => !f.fuera).every(f => !/no sale en Bollinger|fuera de este gráfico/.test(f.sub)) && F.some(f => f.k === 'cierre_ayer' && !f.fuera) && F.some(f => f.k === 'apertura_hoy' && !f.fuera),
    'cierre de ayer y apertura (sí dibujadas) no llevan marca');
  assert(!/lejos del precio/.test(h), 'en Bollinger no se dice «lejos del precio» de lo que Bollinger nunca dibuja (no es la distancia: es la vista)');
  assert(/target"[\s\S]*?no sale en Bollinger[\s\S]*?finviz/.test(h) && /techo"[\s\S]*?no sale en Bollinger[\s\S]*?próximo · 2 respetos/.test(h), 'la marca va delante del subtítulo de siempre (fuente del target, respetos del techo), que sigue');
  // una NATIVA que no cupo (cierre de ayer muy lejos del precio): sigue siendo «lejos del precio», no «no sale en Bollinger»
  const pkL = { ...pkD, niveles: { ...NV, cierre_ayer: 1000 } };
  const svgL = CH.chartSvg(pkL, { vista: 'bb', h: 300, w: 400, tf: 'dia', targets: TG });
  const dibL = CH.nivelesDibujados(svgL).map(x => x.k);
  const FL = filas(CH.hlinesLista(pkL, TG, 2, dibL, 'bb'));
  const cierre = FL.find(f => f.k === 'cierre_ayer') || {};
  assert(!dibL.includes('cierre_ayer') && cierre.fuera && /^lejos del precio: fuera de este gráfico/.test(cierre.sub) && !/no sale en Bollinger/.test(cierre.sub),
    'una nativa que no cupo (cierre de ayer a 1000) en Bollinger: «lejos del precio: fuera de este gráfico»', JSON.stringify(cierre));
  // sin gráfico (nivelesDibujados null: «Sin velas todavía…») no se marca nada, tampoco en Bollinger
  const svg1 = CH.chartSvg({ ...pkD, velas: pkD.velas.slice(-1) }, { vista: 'bb', tf: 'dia' });
  igual(CH.nivelesDibujados(svg1), null, 'con una sola vela no hay gráfico (nivelesDibujados null)');
  assert(!/hl fuera|no sale en Bollinger/.test(CH.hlinesLista(pkD, TG, 2, null, 'bb')), 'y sin la lista de dibujadas la lista de Bollinger no marca nada');
  // sin targets: solo marca lo que hay
  const sinTg = filas(CH.hlinesLista(pkD, null, 2, dib, 'bb')).filter(f => f.fuera).map(f => f.k).sort();
  igual(sinTg, ['ath', 'atl', 'piso', 'techo'], 'sin target personal, marca techo, piso y máx/mín (no inventa targets)');
}

// ════════════════ B2. Medias + H-lines: IGUAL que en la v67 (byte a byte) ════════════════
{
  const V67 = '9728186';
  let CH67 = null;
  try {
    const src = execFileSync('git', ['-C', path.dirname(path.resolve(process.argv[2])), 'show', V67 + ':app/main.js'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    CH67 = casa('git:' + V67 + ':app/main.js', 'v67', { auxiliar: true, fuente: src }).construir(NOMBRES, { esc, haceCuanto }, { consts: CONSTS });
  } catch (e) { console.log('nota: sin el main.js de la v67 (git show ' + V67 + '): se omite la comparación byte a byte'); }
  if (CH67) {
    const casos = [['niveles apretados', pkD], ['máx a 1000 (lejos)', { ...pkD, niveles: { ...NV, ath: 1000 } }], ['sin velas', { ...pkD, velas: pkD.velas.slice(-1) }]];
    casos.forEach(([n, pk]) => {
      const svg = CH.chartSvg(pk, { vista: 'hl', h: 300, w: 400, tf: 'dia', targets: TG });
      const d = CH.nivelesDibujados(svg);
      const k = d ? d.map(x => x.k) : null;
      igual(CH.hlinesLista(pk, TG, 2, k, 'hl'), CH67.hlinesLista(pk, TG, 2, k), 'Medias + H-lines (' + n + '): la lista es la MISMA de la v67, byte a byte');
    });
    igual(CH.hlinesLista(pkD, TG, 2), CH67.hlinesLista(pkD, TG, 2), 'sin lista de dibujadas ni vista: la misma de la v67');
  }
}

// ════════════════ B3. la hoja (pintarChart) pasa la vista y las dibujadas también en Bollinger ════════════════
{
  const nodos = {};
  const VISTA = { v: 'bb' };
  const H = construir(['pintarChart'].concat(NOMBRES),
    { esc, haceCuanto, _ch: { sym: 'AAPL' }, $: (q) => (nodos[q] = nodos[q] || nodo()), chartPrefs: () => ({ vista: VISTA.v, tf: 'dia', ext: false }), _velas: new Map(), _targets: { por: {} },
      chartSelectores: () => '', chartFrescoTxt: () => '', anchoVista: () => 375, GESTOR_ANCHO_TABLA: 900, lecturaChart: () => '', document: { activeElement: null } },
    { consts: CONSTS });
  const lista = () => (nodos['#chHlines'] || {}).innerHTML || '';
  H.pintarChart({ payload: pkD }, TG);
  const F = filas(lista());
  assert(/<svg/.test(nodos['#chSvg'].innerHTML) && F.filter(f => f.fuera).length === 7 && F.filter(f => f.fuera).every(f => NO_BB.test(f.sub)),
    'Bollinger en la hoja: la lista marca las 7 líneas que el gráfico de al lado no dibuja, con «no sale en Bollinger»', JSON.stringify(F.map(f => [f.k, f.fuera])));
  VISTA.v = 'hl'; H.pintarChart({ payload: { ...pkD, niveles: { ...NV, ath: 1000 } } }, TG);
  const FH = filas(lista());
  assert(FH.filter(f => f.fuera).map(f => f.k).join() === 'ath' && /^lejos del precio/.test(FH.find(f => f.k === 'ath').sub) && !/no sale en Bollinger/.test(lista()),
    'Medias + H-lines en la hoja: solo el máx lejano, «lejos del precio» (como en la v67)');
  VISTA.v = 'bb'; H.pintarChart({ payload: { ...pkD, velas: pkD.velas.slice(-1) } }, TG);
  assert(/Sin velas todavía/.test(nodos['#chSvg'].innerHTML) && !/hl fuera|no sale en Bollinger/.test(lista()), 'Bollinger sin gráfico (una vela): la lista no marca nada');
}

// ════════════════ C. aria-label del gestor con BB apagado: lo que de verdad se dibuja ════════════════
{
  const pk = { ticker: 'SPY', tf: 'm5', velas: velas(400, { paso: 300, base: 770 }), vela_viva: null,
    niveles: { spot: 770.3, cierre_ayer: 769.0, apertura_hoy: 769.6, techos_hora: [{ p: 771.5 }], pisos_hora: [{ p: 768.8 }] } };
  const op = { vista: 'bb', tf: 'm5', h: 372, w: 1100, ventana: { start: 352, end: 400 }, hlines: true, extra: [{ v: 770, c: '#8CFFB5', lb: '770.00 CALL ×2', k: 'strike', w: 1.6, op: .95 }] };
  const aria = (svg) => (/aria-label="([^"]*)"/.exec(svg) || [])[1] || '';
  const con = aria(CH.chartSvg(pk, op)), sin = aria(CH.chartSvg(pk, { ...op, bb: false }));
  assert(/^SPY 5 min Bollinger: Bollinger Bands 20 2/.test(con), 'gestor con BB encendido: «SPY 5 min Bollinger: Bollinger Bands 20 2 …» (como antes)', con);
  assert(!/Bollinger/.test(sin), 'gestor con BB APAGADO: el aria-label ya no dice «Bollinger» (no se dibuja)', sin);
  assert(/^SPY 5 min velas y H-lines: /.test(sin) && /770\.00 CALL ×2/.test(sin) && /techo hora/.test(sin), 'dice lo que hay: «SPY 5 min velas y H-lines: …» con el strike y las H-lines dibujadas', sin);
  const svgSin = CH.chartSvg(pk, { ...op, bb: false });
  assert(!/data-bb=/.test(svgSin), 'y de verdad no hay banda en el svg');
  const solo = aria(CH.chartSvg(pk, { vista: 'bb', tf: 'm5', bb: false }));
  assert(/^SPY 5 min velas[:"]?/.test(solo) && !/Bollinger|H-lines/.test(solo), 'BB apagado sin H-lines Sardiñas: «velas» (cierre de ayer y apertura van en la lista de líneas)', solo);
  // lo demás no cambia: Tickers (Bollinger con banda) y la hoja en Medias + H-lines
  assert(/aria-label="SPY 5 min Bollinger: /.test(CH.chartSvg(pk, { vista: 'bb', tf: 'm5' })), 'Tickers (bb por defecto): «Bollinger» como siempre');
  assert(/aria-label="SPY 5 min medias y H-lines: /.test(CH.chartSvg(pk, { vista: 'hl', tf: 'm5' })), 'Medias + H-lines: como siempre');
}

C.resumen();
