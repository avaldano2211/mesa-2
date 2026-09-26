#!/usr/bin/env node
/* Pruebas de los charts (v45+): chartSvg (velas + Bollinger / medias + H-lines),
   pintarChart, lecturaChart, hlinesLista, techoPisoProximos, textoRangoTarjeta, la
   caché de velas de 50 s, chartVista/chartTf y la guarda de identidad de cargarChart.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_chart.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_chart.js');
const { assert, igual, cerca, construir, esc, haceCuanto, localStorageFalso, nodo, sbFalso, diferido, respirar } = C;

// ---------- velas de juguete: n velas cerradas de `paso` segundos desde t0, precio ~base ----------
const T0 = Math.floor(Date.parse('2026-09-22T13:30:00Z') / 1000);   // martes 22-sep-2026, 9:30 ET
function velas(n, op) {
  op = Object.assign({ t0: T0, paso: 900, base: 100, amp: 1 }, op || {});
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = op.base + Math.sin(i / 3) * op.amp, c = o + Math.cos(i / 5) * op.amp * 0.6;
    out.push([op.t0 + i * op.paso, Number(o.toFixed(2)), Number((Math.max(o, c) + 0.3).toFixed(2)), Number((Math.min(o, c) - 0.3).toFixed(2)), Number(c.toFixed(2)), 1000 + i]);
  }
  return out;
}
const CH = construir(['chartSvg', 'bollingerApp', 'smaApp', 'techoPisoProximos', 'chartTiempo', 'chartFrescoTxt', 'lecturaChart', 'hlinesLista', 'fmtFechaNY'],
  { esc, haceCuanto }, { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'] });

// ════════════════ 1. bollingerApp / smaApp / techoPisoProximos ════════════════
{
  const cierres = Array.from({ length: 25 }, (_, i) => i + 1);
  const bb = CH.bollingerApp(cierres, 20, 2);
  igual([bb.n, bb.k, bb.desv], [20, 2, 'pstdev'], 'Bollinger de respaldo: (20, 2) con desviación POBLACIONAL, como el worker');
  igual(bb.medio.slice(0, 19).every(v => v === null), true, 'null donde aún no hay 20 datos');
  cerca(bb.medio[19], 10.5, 'la media de 1..20 es 10.5');
  cerca(bb.sup[19], 10.5 + 2 * Math.sqrt(33.25), 'banda superior = media + 2σ (σ poblacional de 1..20 = √33.25)');
  cerca(bb.inf[24], 15.5 - 2 * Math.sqrt(33.25), 'banda inferior de la última ventana (6..25: media 15.5)');
  igual(bb.medio.length, 25, 'alineado 1:1 con los cierres');
  igual(CH.smaApp([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4], 'SMA simple de 3, alineada 1:1');
  igual(CH.smaApp([], 20), [], 'sin cierres, nada');
  igual(CH.bollingerApp(null, 20, 2).medio, [], 'sin cierres (null) tampoco revienta');
  const nv = { techos_hora: [{ p: 110, respetos: 2 }, { p: 105, respetos: 1 }, { p: 99 }], pisos_hora: [{ p: 95 }, { p: 90 }, { p: 101 }] };
  const tp = CH.techoPisoProximos(nv, 100);
  igual([tp.techo.p, tp.piso.p], [105, 95], 'el techo de HORA más próximo por ENCIMA (105, no 110 ni 99) y el piso más próximo por DEBAJO (95, no 101)');
  igual(CH.techoPisoProximos(nv, 106).techo.p, 110, 'roto el 105, el siguiente pasa a ser el próximo (se recorren, no se acumulan)');
  igual(CH.techoPisoProximos(nv, 120).techo, null, 'por encima de todos: sin techo próximo');
  igual(CH.techoPisoProximos(null, 100), { techo: null, piso: null }, 'sin niveles → nulls');
  igual(CH.techoPisoProximos(nv, 0), { techo: null, piso: null }, 'sin spot → nulls');
  igual(CH.techoPisoProximos({ techos_hora: 'raro' }, 100), { techo: null, piso: null }, 'listas mal formadas no revientan');
  const t = CH.chartTiempo(T0);
  igual([t.ymd, t.hm, t.mod], ['2026-09-22', '09:30', 570], 'chartTiempo: epoch en segundos → hora de Nueva York (9:30 ET = minuto 570)');
  igual(CH.chartTiempo(Math.floor(Date.parse('2026-01-15T15:00:00Z') / 1000)).hm, '10:00', 'en invierno (EST) 15:00Z son las 10:00 ET');
  assert(/22 sept?/.test(t.dia), 'y el día corto en español', t.dia);
}

// ════════════════ 2. chartSvg: vacíos honestos y las dos ventanas del curso ════════════════
{
  const vacio = (h) => /Sin velas todavía para este marco/.test(h) && !/<svg/.test(h);
  assert(vacio(CH.chartSvg(null, {})), 'sin payload: «Sin velas todavía», no un svg vacío');
  assert(vacio(CH.chartSvg({ velas: [] }, {})), 'sin velas: vacío honesto');
  assert(vacio(CH.chartSvg({ velas: velas(1) }, {})), 'una sola vela no es un chart');
  assert(vacio(CH.chartSvg({ velas: velas(30).concat([[1, 2, 3]]) }, {})), 'una fila mal formada (menos de 5 campos) no se dibuja a medias: vacío');
  assert(vacio(CH.chartSvg({ velas: velas(30).map(v => [v[0], 'x', 'x', 'x', 'x']) }, {})), 'velas sin números: vacío (no NaN pintado)');
  const pk = { ticker: 'AAPL', tf: 'm15', velas: velas(90), niveles: { cierre_ayer: 99.5, apertura_hoy: 100.2, spot: 100.4 } };
  const bb = CH.chartSvg(pk, { vista: 'bb', h: 200, tf: 'm15' });
  assert(/^<svg viewBox="0 0 400 200"/.test(bb) && /<\/svg>$/.test(bb), 'vista Bollinger: un svg 400×200', bb.slice(0, 80));
  assert(/aria-label="AAPL 15 min Bollinger"/.test(bb), 'con su aria-label (ticker, marco y ventana)');
  assert(/data-bb="banda"/.test(bb) && /data-bb="sup"/.test(bb) && /data-bb="inf"/.test(bb) && /data-bb="medio"/.test(bb), 'banda + superior/inferior punteadas + medio');
  assert(!/data-sma=/.test(bb), 'en la ventana Bollinger no van las medias');
  assert(/data-nivel="cierre_ayer"/.test(bb) && /data-nivel="apertura_hoy"/.test(bb), 'las líneas nativas (cierre de ayer, apertura de hoy) van en las dos ventanas');
  assert(/>cierre ayer<\/text>/.test(bb) && />apertura<\/text>/.test(bb), 'con su etiqueta');
  assert(/data-spot="1"/.test(bb) && />100\.40<\/text>/.test(bb), 'la cajita del precio actual lleva el spot del worker');
  igual((bb.match(/<rect class="vela"/g) || []).length, 78, 'en 15 min se ven 78 velas (3 sesiones): las 90 se recortan por la derecha');
  assert((bb.match(/class="ejex"/g) || []).length >= 3, 'eje de tiempo con varias etiquetas');
  assert((bb.match(/class="ejey"/g) || []).length >= 3, 'eje de precios con varias etiquetas');
  assert(bb.match(/class="ejey"[^>]*>(\d+\.\d\d)<\/text>/), 'los precios llevan 2 decimales');
  const hl = CH.chartSvg({ ...pk, velas: velas(250, { paso: 86400, t0: T0 - 250 * 86400 }), tf: 'dia', niveles: { ...pk.niveles, ath: 102.5, atl: 97.5, ath_dias: 250, techos_hora: [{ p: 101.5 }], pisos_hora: [{ p: 98.7 }] } },
    { vista: 'hl', h: 300, tf: 'dia', targets: { target: 102, target_alto: 103, target_bajo: 99 } });
  assert(/viewBox="0 0 400 300"/.test(hl) && /aria-label="AAPL Día medias y H-lines"/.test(hl), 'vista Medias + H-lines a 300 de alto');
  ['20', '40', '100', '200'].forEach(k => assert(new RegExp('data-sma="' + k + '"').test(hl), 'SMA ' + k + ' dibujada (con 250 velas hay historia para las cuatro)'));
  assert(!/data-bb=/.test(hl), 'en esta ventana no va la banda de Bollinger');
  assert(/data-nivel="ath"/.test(hl) && /data-nivel="atl"/.test(hl) && />máx 250 d<\/text>/.test(hl) && />mín 250 d<\/text>/.test(hl), 'máx/mín del periodo en azul con «250 d» (jamás «hist»: no es el all-time)');
  assert(/data-nivel="techo"/.test(hl) && /data-nivel="piso"/.test(hl), 'techo y piso de HORA próximos');
  assert(/data-nivel="target"/.test(hl) && />target \$102\.00<\/text>/.test(hl) && /data-nivel="target_alto"/.test(hl) && /data-nivel="target_bajo"/.test(hl), 'target de analistas con sus alto y bajo');
  assert(!/data-nivel="target"/.test(CH.chartSvg(pk, { vista: 'bb', targets: { target: 102 } })), 'el target NO va en la ventana Bollinger');
  assert(/data-nivel="ath"/.test(hl) && !/data-nivel="ath"/.test(CH.chartSvg({ ...pk, niveles: { ...pk.niveles, ath: 1000 } }, { vista: 'hl' })), 'un nivel lejano (±35 %) no aplasta las velas: se omite');
  igual((hl.match(/<rect class="vela"/g) || []).length, 120, 'en Día se ven 120 velas');
  // vela viva: punteada y translúcida; solo si trae 5 campos
  const viva = CH.chartSvg({ ...pk, vela_viva: [T0 + 90 * 900, 100.1, 100.6, 99.9, 100.3, 500] }, { vista: 'bb' });
  assert(/class="vela viva"[^>]*stroke-dasharray="2 2"/.test(viva), 'la vela en curso sale punteada y aparte');
  igual((viva.match(/<rect class="vela/g) || []).length, 79, 'y se suma a las 78 cerradas');
  assert(!/viva/.test(CH.chartSvg({ ...pk, vela_viva: [1, 2] }, { vista: 'bb' })), 'una vela viva mal formada se ignora');
  // Bollinger del worker solo si es la del curso (20, 2); otra cosa se recalcula aquí
  const garbage = { n: 10, k: 2, medio: pk.velas.map(() => 999), sup: pk.velas.map(() => 1000), inf: pk.velas.map(() => 998) };
  igual(CH.chartSvg({ ...pk, bb: garbage }, { vista: 'bb' }), CH.chartSvg(pk, { vista: 'bb' }), 'un bb del worker que no es (20, 2) se ignora y se recalcula (mismo dibujo que sin bb)');
  const alineada = CH.bollingerApp(pk.velas.map(v => v[4]), 20, 2);
  igual(CH.chartSvg({ ...pk, bb: { n: 20, k: 2, medio: alineada.medio, sup: alineada.sup, inf: alineada.inf } }, { vista: 'bb' }), CH.chartSvg(pk, { vista: 'bb' }), 'la bb (20, 2) del worker alineada 1:1 da el mismo dibujo que el respaldo');
  assert(!/data-bb="banda"/.test(CH.chartSvg({ ...pk, velas: velas(15) }, { vista: 'bb' })) && /<svg/.test(CH.chartSvg({ ...pk, velas: velas(15) }, { vista: 'bb' })), 'con menos de 20 velas hay chart pero sin banda (no hay 20 datos)');
  // SPX sin decimales
  const spx = CH.chartSvg({ ...pk, ticker: 'SPX', velas: velas(40, { base: 6500, amp: 20 }), niveles: { spot: 6510 } }, { vista: 'bb', dec: 0 });
  assert(!/class="ejey"[^>]*>\d+\.\d+</.test(spx) && />6510<\/text>/.test(spx), 'con dec 0 (SPX) el eje y el spot van sin decimales');
  assert(/viewBox="0 0 400 120"/.test(CH.chartSvg(pk, { h: 50 })), 'el alto mínimo es 120');
  assert(/<svg/.test(CH.chartSvg({ velas: velas(30) }, {})), 'sin ticker ni niveles también se dibuja');
  // el chart no puede reventar dentro del redibujo de la vista con niveles raros
  let ok = true; try { CH.chartSvg({ ...pk, niveles: { cierre_ayer: 'x', techos_hora: 'y', spot: null } }, { vista: 'hl' }); } catch (_) { ok = false; }
  assert(ok, 'niveles mal formados no lanzan');
}

// ════════════════ 3. chartFrescoTxt: antigüedad honesta de la última vela ════════════════
{
  igual(CH.chartFrescoTxt(null, 'm15'), 'sin velas', 'sin fila: «sin velas»');
  igual(CH.chartFrescoTxt({ payload: { velas: [] } }, 'm15'), 'sin velas', 'sin velas: «sin velas»');
  const ahora = Math.floor(Date.now() / 1000);
  const f1 = { payload: { velas: [[ahora - 900 - 120, 1, 1, 1, 1, 1]], vela_viva: [ahora, 1, 1, 1, 1, 1] }, actualizado_at: new Date().toISOString() };
  assert(/^última vela hace 2 min · en curso$/.test(CH.chartFrescoTxt(f1, 'm15')), 'vela cerrada hace 2 min + viva publicada ahora: «en curso»', CH.chartFrescoTxt(f1, 'm15'));
  const f2 = { ...f1, actualizado_at: new Date(Date.now() - 45 * 60000).toISOString() };
  assert(/en curso/.test(CH.chartFrescoTxt(f2, 'm15')) === false && /sin cerrar \(publicada hace 45 min\)/.test(CH.chartFrescoTxt(f2, 'm15')), 'la viva publicada hace 45 min NO se presenta como en curso');
  assert(/^última vela hace 2 min$/.test(CH.chartFrescoTxt({ payload: { velas: f1.payload.velas } }, 'm15')), 'sin vela viva solo la antigüedad');
  assert(/hace 1 h/.test(CH.chartFrescoTxt({ payload: { velas: [[ahora - 3600 - 3600 - 10, 1, 1, 1, 1, 1]] } }, 'hora')), 'en Hora la vela cierra 60 min después de abrir');
}

// ════════════════ 4. lecturaChart y hlinesLista (hoja modal) ════════════════
{
  const pk = { ticker: 'AAPL', velas: velas(30), bb: { n: 20, k: 2, sup: [null, 102.1], medio: [null, 100.0], inf: [null, 97.9] }, sma: { '20': [null, 100.3], '40': [null, 100.9], '100': [null], '200': [null] } };
  igual(CH.lecturaChart(null, 'm15', 2), '', 'sin payload no hay lectura');
  igual(CH.lecturaChart({ velas: [] }, 'm15', 2), '', 'sin velas tampoco');
  const l1 = CH.lecturaChart(pk, 'm15', 2);
  assert(/<span>última vela<\/span><b class="mono">\d\d:\d\d · \d+ \w+\.?<\/b>/.test(l1), 'sin vela viva: «última vela» con hora y día', l1.slice(0, 160));
  assert(/BB superior<\/span><b class="mono">102\.10/.test(l1) && /BB medio<\/span><b class="mono">100\.00/.test(l1) && /BB inferior<\/span><b class="mono">97\.90/.test(l1), 'Bollinger de la última vela CERRADA (el último valor no nulo)');
  assert(/Bollinger y medias · última vela cerrada/.test(l1), 'y se dice que son de la última cerrada');
  assert(/SMA 20<\/span><b class="mono">100\.30/.test(l1) && /SMA 40<\/span><b class="mono">100\.90/.test(l1) && !/SMA 100/.test(l1), 'solo las medias con dato');
  assert(/no hay historia para 2 medias/.test(l1), 'y se dice cuántas faltan (2)');
  assert(/no hay historia para una media/.test(CH.lecturaChart({ ...pk, sma: { ...pk.sma, '100': [null, 99] } }, 'm15', 2)), 'con una sola que falta: «una media»');
  const l2 = CH.lecturaChart({ ...pk, vela_viva: [T0 + 30 * 900, 100.5, 101, 100, 100.8, 4321] }, 'm15', 2);
  assert(/<span>vela en curso<\/span>/.test(l2) && /apertura<\/span><b class="mono">100\.50/.test(l2) && /cierre<\/span><b class="mono">100\.80/.test(l2) && /volumen<\/span><b class="mono">4K/.test(l2), 'con vela viva: «vela en curso» y sus precios/volumen');
  assert(!/·/.test(CH.lecturaChart(pk, 'dia', 2).split('</b>')[0]), 'en Día la fecha va sin hora');
  assert(/>—</.test(CH.lecturaChart({ ...pk, bb: {} }, 'm15', 2)), 'sin bandas: «—», nunca NaN');
  // H-lines
  const nv = { spot: 100.4, techos_hora: [{ p: 105, respetos: 3, edad: 12 }, { p: 110, respetos: 1, edad: 40 }], pisos_hora: [{ p: 95, respetos: 2, edad: 8 }], ath: 120, ath_fecha: '2026-06-01', atl: 80, atl_fecha: '2026-01-05', ath_dias: 250,
    techos_dia: [{ p: 118 }], pisos_dia: [{ p: 85 }], cierre_ayer: 99.5, max_ayer: 101, min_ayer: 98, apertura_hoy: 100.2, salto: { lado: 'arriba', desde: 98, hasta: 100, gap_pct: 2.04, hace_velas: 3 } };
  const h = CH.hlinesLista({ niveles: nv }, { target: 115, target_alto: 125, target_bajo: 105, fuente: 'finviz', fecha: '2026-09-21' }, 2);
  assert(/target \$115\.00/.test(h) && /finviz · 21 sept?\.? · 105\.00–125\.00/.test(h), 'el target de analistas con fuente, fecha y rango', h.slice(0, 200));
  assert(/techo hora \$105\.00 <b style="color:var\(--oro\)">· próximo<\/b>/.test(h) && /3 respetos · edad 12 velas/.test(h), 'el techo PRÓXIMO arriba, con respetos y edad');
  assert(/piso hora \$95\.00 <b[^>]*>· próximo/.test(h), 'y el piso próximo');
  assert(/ver los demás swings de hora \(1\)<\/summary>/.test(h) && /<details/.test(h), 'los demás swings (el 110) van en un desplegable: pocas líneas, nada de espagueti');
  assert(/máx 250 d \$120\.00/.test(h) && /mín 250 d \$80\.00/.test(h), 'máx/mín del periodo con «250 d»');
  assert(/referencias de día \(no son H-lines\)/.test(h) && /\$118\.00/.test(h) && /\$85\.00/.test(h), 'los swings de DÍA salen como referencias, no como H-lines');
  assert(/cierre de ayer \$99\.50/.test(h) && /ayer 98\.00–101\.00/.test(h) && /apertura de hoy \$100\.20/.test(h), 'cierre de ayer con su rango y apertura de hoy');
  assert(/salto arriba \$98\.00 → \$100\.00/.test(h) && /\+2\.0% · hace 3 velas/.test(h), 'el salto (gap) con su % y antigüedad');
  assert(/Sin niveles publicados todavía\./.test(CH.hlinesLista({ niveles: {} }, null, 2)), 'sin niveles: se dice');
  assert(/Sin niveles publicados todavía\./.test(CH.hlinesLista(null, null, 2)), 'sin payload tampoco revienta');
  assert(!/target/.test(CH.hlinesLista({ niveles: nv }, null, 2)), 'sin target personal no se inventa uno');
  assert(/del periodo \$120\.00/.test(CH.hlinesLista({ niveles: { ...nv, ath_dias: null } }, null, 2)), 'sin ath_dias: «del periodo» (jamás «hist»)');
  assert(!/hist/.test(h), 'la palabra «hist» no aparece: no es el all-time del curso');
  assert(/techo hora \$110\.00/.test(CH.hlinesLista({ niveles: { ...nv, spot: 106 } }, null, 2).split('<details')[0]), 'roto el 105, el 110 pasa a ser el próximo');
}

// ════════════════ 5. textoRangoTarjeta: rango inválido (lo > hi) → «—» ════════════════
{
  const R = construir(['textoRangoTarjeta', 'componerRango'], { esc }, { consts: ['RANGOS_TABLA'] });
  igual(R.textoRangoTarjeta({}, 'ZZZZ'), '', 'sin rango de ninguna fuente no sale la línea');
  const a = R.textoRangoTarjeta({ rango_academia: { lo: 40, hi: 80 }, rango_vivo: { lo: 30, hi: 60, exp: '2026-10-02', spot: 231.5 } }, 'AAPL');
  assert(/\$40–\$80/.test(a) && /método academia/.test(a) && /exp 10-02/.test(a) && /spot \$231\.5/.test(a), 'manda el método de la academia; el rango por delta aporta exp y spot', a);
  const t = R.textoRangoTarjeta({}, 'AAPL');
  assert(/\$35–\$90/.test(t) && /tabla academia/.test(t), 'sin ejercicio del worker manda la tabla de la academia (AAPL 35–90)');
  const d = R.textoRangoTarjeta({ rango_vivo: { lo: 30.4, hi: 60.6 } }, 'ZZZZ');
  assert(/\$30–\$61/.test(d) && /por delta/.test(d), 'sin academia ni tabla: el rango por delta, redondeado');
  const inv = R.textoRangoTarjeta({ rango_vivo: { lo: 108, hi: 56 } }, 'ZZZZ');
  assert(/<b class="mono">—<\/b>/.test(inv) && /rango inválido \(cotizaciones fuera de sesión\)/.test(inv) && !/\$108/.test(inv), 'un rango invertido (TSLA «$108–$56» del 2026-09-14) sale como «—», nunca al revés');
  assert(/—/.test(R.textoRangoTarjeta({ rango_academia: { lo: 'x', hi: 50 } }, 'ZZZZ')), 'un lo que no es número también es inválido');
  igual(R.componerRango(null, null, null), null, 'componerRango sin nada → null');
  igual(R.componerRango({ lo: 1, hi: 2 }, null, [35, 90]).fuente, 'tabla', 'la tabla manda sobre el delta');
  igual(R.componerRango({ lo: 1, hi: 2 }, { lo: 3, hi: 4 }, [35, 90]).fuente, 'academia', 'y la academia sobre la tabla');
}

// ════════════════ 6. caché de velas de 50 s y peticiones en vuelo ════════════════
(async () => {
  {
    let consultas = 0, resultado = () => ({ data: [{ symbol: 'AAPL', tf: 'm15', payload: { velas: [] }, actualizado_at: 'x' }], error: null });
    let esperar = null;
    const sb = sbFalso(async (tabla, cadena) => { consultas++; if (esperar) await esperar.promesa; return resultado(cadena); });
    const V = construir(['cargarVelas', 'cargarTargets'], { sb }, { consts: ['CHART_CACHE_MS', '_velas', '_velasVuelo', '_targets'] });
    const r1 = await V.cargarVelas(['AAPL'], 'm15');
    igual([consultas, !!r1.AAPL, r1.AAPL && r1.AAPL.symbol], [1, true, 'AAPL'], 'la primera vez se piden las velas a ticker_velas');
    const q = sb.llamadas[0].cadena;
    assert(q.some(c => c[0] === 'in' && c[1][0] === 'symbol' && c[1][1][0] === 'AAPL') && q.some(c => c[0] === 'eq' && c[1][0] === 'tf' && c[1][1] === 'm15'), 'filtrando por símbolo y marco');
    await V.cargarVelas(['AAPL'], 'm15');
    igual(consultas, 1, 'a los pocos segundos NO se vuelve a pedir (caché de 50 s: ruta() corre cada 60 s)');
    await V.cargarVelas(['AAPL'], 'hora');
    igual(consultas, 2, 'otro marco es otra caché');
    await V.cargarVelas(['AAPL', 'TSLA'], 'm15');
    igual([consultas, sb.llamadas[2].cadena.find(c => c[0] === 'in')[1][1]], [3, ['TSLA']], 'con AAPL cacheada solo se pide TSLA');
    await V.cargarVelas(['AAPL'], 'm15', true);
    igual(consultas, 4, 'forzar (la hoja del chart al volver del fondo) sí relee');
    // en vuelo: dos ruta() seguidas comparten la misma petición
    esperar = diferido();
    const pA = V.cargarVelas(['NVDA'], 'm15'), pB = V.cargarVelas(['NVDA'], 'm15');
    await respirar();
    igual(consultas, 5, 'dos cargas a la vez del mismo símbolo = UNA petición');
    esperar.resolver(); esperar = null; await pA; await pB;
    igual(V._velasVuelo.size, 0, 'y la petición en vuelo se limpia al terminar');
    // error: se conserva lo cacheado y se reintenta en la próxima vuelta
    resultado = () => ({ data: null, error: { message: 'boom' } });
    const rE = await V.cargarVelas(['AAPL'], 'm15', true);
    assert(rE.AAPL && rE.AAPL.symbol === 'AAPL', 'si Supabase falla se conserva la fila cacheada');
    igual(V._velas.has('SPY|m15'), false, 'y un símbolo nuevo con error no queda cacheado como «sin velas»');
    await V.cargarVelas(['SPY'], 'm15');
    igual((await V.cargarVelas(['SPY'], 'm15')).SPY, null, 'sin fila y con error: null, sin reventar');
    resultado = () => ({ data: [], error: null });
    // la caché caduca a los 50 s: se simula adelantando el reloj
    const ahora0 = Date.now; const n0 = consultas;
    Date.now = () => ahora0() + 60000;
    try { await V.cargarVelas(['AAPL'], 'm15'); } finally { Date.now = ahora0; }
    igual(consultas, n0 + 1, 'pasados 50 s se vuelve a pedir');
    // targets personales: misma caché
    resultado = () => ({ data: [{ symbol: 'AAPL', target: 260 }], error: null });
    const t1 = await V.cargarTargets(); const c1 = consultas;
    igual(t1.AAPL.target, 260, 'cargarTargets indexa por símbolo');
    await V.cargarTargets();
    igual(consultas, c1, 'y también se cachea 50 s');
    resultado = () => ({ data: null, error: { message: 'boom' } });
    igual((await V.cargarTargets(true)).AAPL.target, 260, 'con error se devuelve lo último conocido');
  }

  // ════════════════ 7. chartPrefs / chartSelectores / chartVista / chartTf ════════════════
  function armarVista(E) {
    E = Object.assign({ almacen: {}, modal: false, hash: '#/tickers', ch: null }, E || {});
    const reg = { pintarChart: 0, cargarChart: [], vistaTickers: 0, sel: nodo({ outerHTML: '' }) };
    const ls = localStorageFalso(E.almacen);
    const M = construir(['chartPrefs', 'chartSelectores', 'chartVista', 'chartTf', 'pintarSelectores'], {
      localStorage: ls, $: (s) => (s === '#modalChart' ? (E.modal ? nodo() : null) : s === '#chartSel' ? reg.sel : null),
      location: { hash: E.hash }, vistaTickers: () => reg.vistaTickers++, pintarChart: () => reg.pintarChart++, cargarChart: (f) => reg.cargarChart.push(f),
    }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS'], extras: ['CHART_TF_K', '__html'], prefijo: 'let _vistaTickersHtml = "algo"; let _ch = ' + JSON.stringify(E.ch) + ';', sufijo: 'function __html() { return _vistaTickersHtml; }' });
    return { M, reg, ls };
  }
  {
    const { M } = armarVista();
    igual(M.chartPrefs(), { vista: 'bb', tf: 'm15' }, 'sin preferencias: Bollinger a 15 min');
    igual(armarVista({ almacen: { mz_chart_vista: 'hl', mz_chart_tf: 'dia' } }).M.chartPrefs(), { vista: 'hl', tf: 'dia' }, 'las preferencias guardadas mandan');
    igual(armarVista({ almacen: { mz_chart_vista: 'xx', mz_chart_tf: 'semana' } }).M.chartPrefs(), { vista: 'bb', tf: 'm15' }, 'valores desconocidos → los de por defecto');
    const s = M.chartSelectores('hl', 'hora');
    assert(/id="chartSel"/.test(s) && /perbtn on" onclick="MZ\.chartVista\('hl'\)">Medias \+ H-lines/.test(s) && /perbtn on" onclick="MZ\.chartTf\('hora'\)">Hora/.test(s), 'los selectores marcan la vista y el marco elegidos', s);
    assert(/perbtn " onclick="MZ\.chartVista\('bb'\)">Bollinger/.test(s), 'y el otro sale apagado');
    assert(/id="chartSelHoja"/.test(M.chartSelectores('bb', 'm15', 'chartSelHoja')), 'la hoja modal usa su propio id');
  }
  {
    const { M, reg, ls } = armarVista({ hash: '#/tickers' });
    M.chartVista('zz');
    igual([ls.almacen.mz_chart_vista, reg.sel.outerHTML, reg.vistaTickers, M.__html()], [undefined, '', 0, 'algo'], 'una vista desconocida no hace nada');
    M.chartVista('hl');
    igual([ls.almacen.mz_chart_vista, reg.vistaTickers, reg.pintarChart, M.__html()], ['hl', 1, 0, ''], 'chartVista guarda la preferencia, invalida el HTML de Tickers y la redibuja (sin hoja abierta no pinta el chart grande)');
    assert(/perbtn on" onclick="MZ\.chartVista\('hl'\)"/.test(reg.sel.outerHTML), 'y repinta los selectores AL TOQUE, antes de pedir nada a la red (en el iPhone esperar se lee como toque perdido)');
    M.chartTf('dia');
    igual([ls.almacen.mz_chart_tf, reg.vistaTickers, reg.cargarChart], ['dia', 2, []], 'chartTf igual, y sin hoja abierta no carga velas nuevas');
    assert(/perbtn on" onclick="MZ\.chartTf\('dia'\)"/.test(reg.sel.outerHTML), 'los selectores ya marcan Día');
    M.chartTf('semana');
    igual(ls.almacen.mz_chart_tf, 'dia', 'un marco desconocido no pisa el guardado');
  }
  {
    const { M, reg } = armarVista({ hash: '#/copiloto', modal: true, ch: { sym: 'AAPL', gen: 0 } });
    M.chartVista('bb'); M.chartTf('hora');
    igual([reg.vistaTickers, reg.pintarChart, reg.cargarChart], [0, 1, [false]], 'con la hoja abierta desde otra pestaña: se repinta la hoja (vista) o se recargan sus velas (marco), sin tocar Tickers');
  }

  // ════════════════ 8. pintarChart y la guarda de identidad de cargarChart ════════════════
  {
    const nodos = {}; ['#chSel', '#chFresco', '#chSvg', '#chLectura', '#chHlines', '#modalChart', '#tgT', '#tgA', '#tgB', '#tgF', '#tgS'].forEach(id => { nodos[id] = nodo(); });
    const pk = { ticker: 'AAPL', tf: 'm15', velas: velas(40), niveles: { spot: 100.4 } };
    let velasResp = { AAPL: { payload: pk, actualizado_at: new Date().toISOString() } }, esperarVelas = null;
    const reg = { cargasVelas: [] };
    const P = construir(['pintarChart', 'cargarChart', 'chartPrefs', 'chartSelectores', 'chartFrescoTxt', 'chartSvg', 'lecturaChart', 'hlinesLista',
      'bollingerApp', 'smaApp', 'techoPisoProximos', 'chartTiempo', 'fmtFechaNY', 'cerrarChart'], {
      $: (s) => nodos[s] || null, localStorage: localStorageFalso({}), esc, haceCuanto, document: { activeElement: nodos['#tgT'] },
      cargarVelas: async (syms, tf, forzar) => { reg.cargasVelas.push([syms, tf, forzar]); if (esperarVelas) await esperarVelas.promesa; return velasResp; },
      cargarTargets: async () => ({ AAPL: { target: 260, target_alto: 280, target_bajo: 240, fecha: '2026-09-21', fuente: 'finviz' } }),
      clearInterval() {},
    }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol', '_velas', '_targets'], extras: ['CHART_TF_K', '__setCh', '__getCh'],
      prefijo: 'let _ch = null; function __setCh(v) { _ch = v; } function __getCh() { return _ch; }' });
    P.__setCh({ sym: 'AAPL', gen: 0, timer: null });
    await P.cargarChart(false);
    igual(reg.cargasVelas, [[['AAPL'], 'm15', false]], 'cargarChart pide las velas del símbolo con el marco preferido');
    assert(/<svg viewBox="0 0 400 300"/.test(nodos['#chSvg'].innerHTML), 'la hoja pinta el chart grande (300 de alto)');
    assert(/última vela/.test(nodos['#chFresco'].textContent), 'con su antigüedad');
    assert(/BB superior/.test(nodos['#chLectura'].innerHTML) && /target \$260\.00/.test(nodos['#chHlines'].innerHTML), 'la lectura y las H-lines (con el target personal)');
    igual([nodos['#tgA'].value, nodos['#tgB'].value, nodos['#tgF'].value, nodos['#tgS'].value], [280, 240, '2026-09-21', 'finviz'], 'el editor del target se rellena con lo guardado');
    igual(nodos['#tgT'].value, '', 'pero NO el campo que se está escribiendo (activeElement)');
    // la guarda: una carga vieja no pinta si la hoja se cerró, cambió de símbolo o hubo otra carga después
    esperarVelas = diferido(); nodos['#chSvg'].innerHTML = '';
    const p1 = P.cargarChart(true);
    P.cerrarChart();                                  // la hoja se cerró mientras llegaban las velas
    esperarVelas.resolver(); await p1;
    igual(nodos['#chSvg'].innerHTML, '', 'una carga que vuelve con la hoja ya cerrada no pinta nada');
    nodos['#modalChart'] = nodo();
    const o = { sym: 'AAPL', gen: 0, timer: null }; P.__setCh(o);
    esperarVelas = diferido();
    const p2 = P.cargarChart(true);
    o.gen++;                                          // llegó otra carga (o un cambio de marco) después
    esperarVelas.resolver(); await p2;
    igual(nodos['#chSvg'].innerHTML, '', 'una carga superada por otra más nueva (gen) tampoco pinta');
    esperarVelas = null;
    await P.cargarChart(false);
    assert(/<svg/.test(nodos['#chSvg'].innerHTML), 'la carga vigente sí pinta');
    // pintarChart sin argumentos usa la caché de velas (cambio de vista sin red)
    nodos['#chSvg'].innerHTML = '';
    P._velas.set('AAPL|m15', { fila: { payload: pk, actualizado_at: new Date().toISOString() }, ts: Date.now() });
    P.pintarChart();
    assert(/<svg/.test(nodos['#chSvg'].innerHTML), 'pintarChart() sin fila pinta desde la caché (cambiar de vista no pide velas)');
    P.__setCh(null); nodos['#chSvg'].innerHTML = '';
    P.pintarChart(); igual(nodos['#chSvg'].innerHTML, '', 'sin hoja abierta pintarChart no toca nada');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
