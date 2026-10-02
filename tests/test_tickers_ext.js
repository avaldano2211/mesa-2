#!/usr/bin/env node
/* Pruebas de la v58 (Andrés 2026-10-02, pestaña Tickers: «agregar y remover tickers que vaya usando,
   dependiendo de la semana» + «ver after hours, pre-market y post-market»):
     · chartPrefs.ext, el botón «Extendido» de chartSelectores (on/off, deshabilitado en Día) y chartExt
     · chartSvg con velas_ext: ventana de 2 sesiones, extendidas sombreadas y aparte, bb/sma troceadas por
       tramos de regulares (jamás una recta atraviesa una zona extendida), viva extendida, paridad sin datos
     · chartFrescoTxt con ext (sus tres frases) y la cabecera de chartInline
     · el editor de tickers EN la pestaña (vistaTickers), el ✕ de cada tarjeta y el flujo quitar en dos toques
       (tickerQuitar / tickerQuitarSi / tickerQuitarNo), sin confirm() nativo
     · textos «≤2 min» y las puertas nuevas de window.MZ
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_tickers_ext.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_tickers_ext.js');
const { assert, igual, cerca, construir, extraer, esc, haceCuanto, localStorageFalso, nodo, sbFalso } = C;

// ---------- velas de juguete: tres sesiones (mar 22 → jue 24 sep 2026, horario de verano NY = UTC−4) ----------
const DIAS = ['2026-09-22', '2026-09-23', '2026-09-24'];
const T = (d, hmZ) => Math.floor(Date.parse(d + 'T' + hmZ + ':00Z') / 1000);
const fila = (t, k) => { const o = 100 + Math.sin(k / 4), c = o + Math.cos(k / 3) * 0.5; return [t, +o.toFixed(2), +(Math.max(o, c) + 0.3).toFixed(2), +(Math.min(o, c) - 0.3).toFixed(2), +c.toFixed(2), 1000 + k]; };
const serie = (d, h0, cnt, paso) => Array.from({ length: cnt }, (_, i) => fila(T(d, h0) + i * (paso || 900), i));
const REG = DIAS.flatMap(d => serie(d, '13:30', 26));                                   // 9:30–15:45 ET: 26 velas/día = 78
const EXT = DIAS.flatMap(d => serie(d, '08:30', 20).concat(serie(d, '20:00', 16)));     // pre 4:30–9:15 (20) + post 16:00–19:45 (16)
const cuenta = (s, re) => (s.match(re) || []).length;
const xsDe = (pts) => pts.split(' ').map(p => Number(p.split(',')[0]));
const polilineas = (svg, attr) => (svg.match(new RegExp('<polyline ' + attr + '="[^"]*" points="[^"]*"', 'g')) || []).map(m => xsDe(/points="([^"]*)"/.exec(m)[1]));
const saltoMax = (xs) => xs.slice(1).reduce((m, x, i) => Math.max(m, x - xs[i]), 0);

const CH = construir(['chartSvg', 'bollingerApp', 'smaApp', 'techoPisoProximos', 'chartTiempo', 'chartFrescoTxt', 'chartInline'],
  { esc, haceCuanto }, { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'] });

// ════════════════ 1. chartPrefs.ext · botón «Extendido» · editor en los selectores · chartExt ════════════════
function armarSel(E) {
  E = Object.assign({ almacen: {}, modal: false, hash: '#/tickers', ch: null, filas: [] }, E || {});
  const reg = { pintarChart: 0, vistaTickers: 0, sel: nodo({ outerHTML: '' }) };
  const ls = localStorageFalso(E.almacen);
  const M = construir(['chartPrefs', 'chartSelectores', 'editorTickersHtml', 'chartExt', 'pintarSelectores'], {
    localStorage: ls, esc, _tickers: { filas: E.filas },
    $: (s) => (s === '#modalChart' ? (E.modal ? nodo() : null) : s === '#chartSel' ? reg.sel : null),
    location: { hash: E.hash }, vistaTickers: () => reg.vistaTickers++, pintarChart: () => reg.pintarChart++,
  }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS'], extras: ['CHART_EXT_K', '__html'],
    prefijo: 'let _vistaTickersHtml = "algo"; let _ch = ' + JSON.stringify(E.ch) + ';', sufijo: 'function __html() { return _vistaTickersHtml; }' });
  return { M, reg, ls };
}
{
  const { M } = armarSel();
  igual(M.CHART_EXT_K, 'mz_chart_ext', 'la preferencia vive en localStorage mz_chart_ext');
  igual(M.chartPrefs().ext, false, 'chartPrefs: sin preferencia, extendido APAGADO (el gráfico de siempre)');
  igual(armarSel({ almacen: { mz_chart_ext: '1' } }).M.chartPrefs().ext, true, "'1' → encendido");
  igual(armarSel({ almacen: { mz_chart_ext: '0' } }).M.chartPrefs().ext, false, "'0' → apagado");
  igual(armarSel({ almacen: { mz_chart_ext: 'true' } }).M.chartPrefs().ext, false, 'cualquier otra cosa → apagado');
  const s = M.chartSelectores('bb', 'm15');
  assert(/<button class="perbtn " onclick="MZ\.chartExt\(\)">Extendido<\/button>/.test(s), 'chartSelectores: cuarto botón «Extendido», apagado', s);
  assert(s.indexOf('Extendido') > s.indexOf("MZ.chartTf('dia')") && s.indexOf('Extendido') < s.lastIndexOf('</div>'), 'en la fila de las temporalidades, tras Día');
  assert(!/disabled/.test(s) && !/tkedit/.test(s), 'en 15 min no va deshabilitado; sin conEditor no hay fila de edición');
  assert(/<button class="perbtn on" onclick="MZ\.chartExt\(\)">Extendido<\/button>/.test(armarSel({ almacen: { mz_chart_ext: '1' } }).M.chartSelectores('bb', 'hora')), 'con la preferencia guardada sale encendido');
  const d = M.chartSelectores('bb', 'dia');
  assert(/<button class="perbtn " disabled title="solo 15 min y Hora" onclick="MZ\.chartExt\(\)">Extendido<\/button>/.test(d), 'en Día va deshabilitado con su title («solo 15 min y Hora»)', d);
  assert(/perbtn on" disabled title="solo 15 min y Hora"/.test(armarSel({ almacen: { mz_chart_ext: '1' } }).M.chartSelectores('bb', 'dia')), 'en Día sigue reflejando la preferencia (al volver a 15 min no hay sorpresa), solo que deshabilitado');
  // el editor de tickers (solo con conEditor): campo + Agregar + chips de inactivos + #tkErr
  const CAT = [{ symbol: 'AAPL', rol: 'operable', activo: true, orden: 1 }, { symbol: 'META', rol: 'operable', activo: false, orden: 5 },
    { symbol: 'NFLX', rol: 'operable', activo: false, orden: 3 }, { symbol: 'MERCADO', rol: 'mercado', activo: false, orden: 0 }, { symbol: 'TSLA', rol: 'operable', activo: null, orden: 2 }];
  const e = armarSel({ filas: CAT }).M.chartSelectores('bb', 'm15', undefined, true);
  assert(/<div class="tkedit">/.test(e) && /id="chartSel"/.test(e), 'con conEditor la fila .tkedit va dentro de #chartSel');
  assert(/<input id="tkSym" placeholder="agregar ticker \(ej\. META\)" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="7" style="text-transform:uppercase"/.test(e), 'el campo #tkSym con mayúsculas y sin autocorrección', e);
  assert(/onkeydown="if\(event\.key==='Enter'\)\{event\.preventDefault\(\);MZ\.tickerAgregar\(\)\}"/.test(e), 'Enter en el campo = Agregar');
  assert(/<button class="btnsec" onclick="MZ\.tickerAgregar\(\)">Agregar<\/button>/.test(e), 'y el botón Agregar');
  assert(/<span class="fresco">inactivos:<\/span>/.test(e), 'los operables INACTIVOS se listan como chips');
  assert(/<button class="btnsec tkoff" title="volver a activar NFLX" onclick="MZ\.tickerActivo\('NFLX', true\)">NFLX ↺<\/button><button class="btnsec tkoff" title="volver a activar META" onclick="MZ\.tickerActivo\('META', true\)">META ↺<\/button>/.test(e), 'NFLX y META (por orden), un toque = tickerActivo(sym, true)', e);
  assert(!/MERCADO/.test(e) && !/AAPL/.test(e) && !/TSLA/.test(e), 'ni el global (rol mercado) ni los activos (activo true o null) salen como inactivos');
  assert(/<div class="err" id="tkErr"><\/div><\/div>/.test(e), 'y el #tkErr que escribe tickerEscribir cierra la fila');
  const e0 = armarSel({ filas: [{ symbol: 'AAPL', rol: 'operable', activo: true }] }).M.chartSelectores('bb', 'm15', undefined, true);
  assert(/tkedit/.test(e0) && !/inactivos:/.test(e0) && !/tkoff/.test(e0), 'sin inactivos no sale la palabra «inactivos:»');
  assert(/tkedit/.test(armarSel({ filas: null }).M.chartSelectores('bb', 'm15', undefined, true)), 'con el catálogo aún sin leer (null) la fila sale igual (sin chips)');
  assert(!/tkedit/.test(M.chartSelectores('bb', 'm15', 'chartSelHoja')), 'la hoja del gráfico no lleva el editor');
}
{
  const { M, reg, ls } = armarSel({ hash: '#/tickers' });
  M.chartExt();
  igual([ls.almacen.mz_chart_ext, reg.vistaTickers, reg.pintarChart, M.__html()], ['1', 1, 0, ''], "chartExt: invierte (→ '1'), invalida el HTML de Tickers y la redibuja; sin hoja abierta no pinta el chart grande");
  assert(/perbtn on" onclick="MZ\.chartExt\(\)">Extendido/.test(reg.sel.outerHTML), 'y repinta los selectores AL TOQUE (antes de pedir nada a la red)');
  assert(/tkedit/.test(reg.sel.outerHTML), 'el repintado de #chartSel conserva el editor de tickers de la pestaña');
  M.chartExt();
  igual([ls.almacen.mz_chart_ext, reg.vistaTickers], ['0', 2], "otro toque → '0' y vuelve a redibujar");
  assert(/perbtn " onclick="MZ\.chartExt\(\)">Extendido/.test(reg.sel.outerHTML), 'los selectores ya lo marcan apagado');
  M.pintarSelectores();
  assert(/tkedit/.test(reg.sel.outerHTML), 'pintarSelectores (chartVista/chartTf) también conserva el editor en la pestaña');
}
{
  const { M, reg } = armarSel({ hash: '#/copiloto', modal: true, ch: { sym: 'AAPL', gen: 0 } });
  M.chartExt();
  igual([reg.vistaTickers, reg.pintarChart], [0, 1], 'con la hoja abierta desde otra pestaña: se repinta la hoja (con las velas cacheadas), sin tocar Tickers');
}

// ════════════════ 2. chartSvg con velas extendidas ════════════════
{
  const pk = { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: EXT, niveles: { spot: 100.4 } };
  const sin = CH.chartSvg(pk, { vista: 'bb', tf: 'm15' });
  const con = CH.chartSvg(pk, { vista: 'bb', tf: 'm15', ext: true });
  igual(cuenta(sin, /<rect class="vela"/g), 78, 'sin extendido: las 78 regulares de siempre (3 sesiones) y nada más');
  igual(cuenta(sin, /vela ext|data-ext/g), 0, 'y ni una vela ni una sombra extendida');
  igual(cuenta(con, /<rect class="vela"/g), 52, 'con extendido: 52 regulares (MAXV_EXT m15 = 2 sesiones)');
  igual(cuenta(con, /<rect class="vela ext"/g), 72, 'y las extendidas que caen en la ventana: pre+post de las 2 sesiones (36 × 2); las del día anterior quedan fuera');
  igual(cuenta(con, /<rect data-ext="1"/g), 3, 'tres sombras: pre del día 2 · post día 2 + pre día 3 (seguidas) · post día 3');
  const anchos = (con.match(/<rect data-ext="1" x="[^"]*" y="8" width="([^"]*)"/g) || []).map(m => Number(/width="([^"]*)"/.exec(m)[1]));
  const bw = (400 - 6 - 48) / (52 + 72);
  cerca(anchos[0], 20 * bw, 'la primera sombra mide 20 velas (el pre del día 2)', 0.2);
  cerca(anchos[1], 36 * bw, 'la segunda 36 (post 16 + pre 20 seguidas)', 0.2);
  cerca(anchos[2], 16 * bw, 'la tercera 16 (el post del día 3)', 0.2);
  assert(/<rect data-ext="1"[^>]*fill="var\(--tx3\)" fill-opacity="\.09"\/>/.test(con), 'sombra tenue del color de texto terciario');
  assert(con.indexOf('data-ext="1"') < con.indexOf('data-bb="banda"') && con.indexOf('data-ext="1"') > con.indexOf('<g clip-path'), 'las sombras van dentro del clip y DEBAJO de las líneas y velas');
  assert(/<rect class="vela ext"[^>]*fill-opacity="\.75"\/>/.test(con), 'las velas extendidas van translúcidas (.75)');
  igual(cuenta(con, /data-bb="medio"/g), 2, 'la línea media de Bollinger se trocea: una polilínea por tramo de regulares consecutivas (2 sesiones)');
  igual([cuenta(con, /data-bb="banda"/g), cuenta(con, /data-bb="sup"/g), cuenta(con, /data-bb="inf"/g)], [2, 2, 2], 'y la banda, sup e inf igual');
  igual([cuenta(sin, /data-bb="medio"/g), cuenta(sin, /data-bb="banda"/g)], [1, 1], 'sin extendido sigue siendo UNA polilínea (dibujo de siempre)');
  const saltos = polilineas(con, 'data-bb').map(saltoMax);
  assert(saltos.length === 6 && saltos.every(s => s < 2 * bw), 'ninguna polilínea tiene dos puntos consecutivos separados por una zona extendida (salto máximo < 2 velas)', JSON.stringify(saltos.map(s => s.toFixed(1))));
  cerca(saltoMax(polilineas(sin, 'data-bb')[0]), (400 - 6 - 48) / 78, 'y sin extendido el paso entre puntos es exactamente una vela (±0.1 por el redondeo a un decimal)', 0.1);
  const xsVelas = (con.match(/<rect class="vela[^"]*" x="([^"]*)"/g) || []).map(m => Number(/x="([^"]*)"/.exec(m)[1]));
  assert(xsVelas.length === 124 && xsVelas.every((x, i) => i === 0 || x > xsVelas[i - 1]), 'las 124 velas salen en orden ascendente por tiempo (regulares y extendidas entremezcladas)');
  assert(/aria-label="AAPL 15 min Bollinger extendido"/.test(con), 'el aria-label añade « extendido»');
  assert(/aria-label="AAPL 15 min Bollinger"/.test(sin), 'y sin extendido no');
  assert(cuenta(con, /<line x1="[^"]*" y1="8" x2="[^"]*" y2="[^"]*" stroke="var\(--tx3\)" stroke-width="1" opacity="\.45"\/>/g) >= 1, 'el separador de día sigue saliendo (ahora al primer pre del día)');
  // medias (ventana izquierda) también por tramo
  const hl = CH.chartSvg(pk, { vista: 'hl', tf: 'm15', ext: true });
  igual([cuenta(hl, /data-sma="20"/g), cuenta(hl, /data-sma="40"/g)], [2, 2], 'en Medias + H-lines las SMA 20 y 40 también van troceadas en 2 tramos');
  assert(polilineas(hl, 'data-sma').every(xs => saltoMax(xs) < 2 * bw), 'y ninguna media cruza una zona extendida');
  // vela viva extendida: solo mirando el presente y sin vela viva regular
  const pkV = { ...pk, velas_ext: EXT.slice(0, -1), vela_viva_ext: EXT[EXT.length - 1] };
  const v = CH.chartSvg(pkV, { vista: 'bb', tf: 'm15', ext: true });
  igual(cuenta(v, /<rect class="vela ext viva"/g), 1, 'fuera de la sesión regular la vela extendida en formación se dibuja');
  assert(/<rect class="vela ext viva"[^>]*fill-opacity="\.45" stroke="var\(--[a-z]+\)" stroke-width="1" stroke-dasharray="2 2"\/>/.test(v), 'punteada y translúcida como la viva de siempre');
  igual(cuenta(v, /<rect class="vela ext"/g), 71, 'y las cerradas extendidas son una menos');
  assert(/aria-label="AAPL 15 min Bollinger extendido"/.test(v), 'cuenta como extendido');
  const pkR = { ...pk, vela_viva: fila(T(DIAS[2], '13:30') + 26 * 900, 99), vela_viva_ext: fila(T(DIAS[2], '20:00'), 5) };
  const r = CH.chartSvg(pkR, { vista: 'bb', tf: 'm15', ext: true });
  igual([cuenta(r, /<rect class="vela viva"/g), cuenta(r, /vela ext viva/g)], [1, 0], 'con vela viva REGULAR (sesión en curso) la viva extendida NO se dibuja');
  igual(cuenta(r, /<rect class="vela ext"/g), 56, 'y las extendidas por delante de la viva regular tampoco (post del día 3 fuera: 36 + 20)');
  const soloViva = CH.chartSvg({ ...pk, velas_ext: [], vela_viva_ext: EXT[EXT.length - 1] }, { vista: 'bb', tf: 'm15', ext: true });
  igual([cuenta(soloViva, /<rect class="vela"/g), cuenta(soloViva, /vela ext viva/g)], [52, 1], 'solo con la viva extendida (primera vela del pre) ya hay extendido: ventana de 2 sesiones y la viva');
  // paridad: sin datos extendidos, en Día o con ext false, la MISMA cadena
  igual(CH.chartSvg({ ...pk, velas_ext: undefined }, { vista: 'bb', tf: 'm15', ext: true }), sin, 'ext true pero sin velas_ext (worker viejo) → cadena IDÉNTICA a ext false');
  igual(CH.chartSvg({ ...pk, velas_ext: [] }, { vista: 'bb', tf: 'm15', ext: true }), sin, 'velas_ext vacía → idéntica (nada inventado)');
  igual(CH.chartSvg({ ...pk, velas_ext: 'raro' }, { vista: 'bb', tf: 'm15', ext: true }), sin, 'velas_ext que no es lista → idéntica, sin reventar');
  igual(CH.chartSvg(pk, { vista: 'bb', tf: 'm15', ext: false }), sin, 'ext false explícito → idéntica a no pasar ext (v57)');
  igual(CH.chartSvg(pk, { vista: 'bb', tf: 'm15', ext: 'si' }), sin, 'solo el booleano true enciende el extendido');
  const dia = { ...pk, tf: 'dia', velas: serie('2026-01-05', '05:00', 150, 86400), velas_ext: EXT };
  igual(CH.chartSvg(dia, { vista: 'bb', tf: 'dia', ext: true }), CH.chartSvg(dia, { vista: 'bb', tf: 'dia' }), 'en Día el extendido no aplica: idéntica');
  // filas raras y colisiones
  const sucio = { ...pk, velas_ext: EXT.concat([[1, 2], ['x', 'y', 'z', 'w', 'q'], REG[70]]) };
  igual(CH.chartSvg(sucio, { vista: 'bb', tf: 'm15', ext: true }), con, 'filas extendidas mal formadas o que pisan una ranura regular se ignoran (misma cadena)');
  const vacioExt = CH.chartSvg({ ...pk, velas_ext: EXT.slice(0, 36) }, { vista: 'bb', tf: 'm15', ext: true });
  igual([cuenta(vacioExt, /<rect class="vela"/g), cuenta(vacioExt, /vela ext/g)], [52, 0], 'extendidas publicadas pero fuera de la ventana (solo las del día 1): ventana de 2 sesiones y ninguna dibujada');
  assert(/aria-label="AAPL 15 min Bollinger"/.test(vacioExt), 'y entonces el aria-label no dice extendido');
  // Hora: MAXV_EXT 60 y las extendidas tras la última regular
  const regH = serie('2026-09-22', '13:30', 90, 3600), ultH = regH[regH.length - 1][0];
  const extH = [1, 2, 3, 4].map(k => fila(ultH + k * 3600, k));
  const h = CH.chartSvg({ ticker: 'AAPL', tf: 'hora', velas: regH, velas_ext: extH }, { vista: 'bb', tf: 'hora', ext: true });
  igual([cuenta(h, /<rect class="vela"/g), cuenta(h, /<rect class="vela ext"/g), cuenta(h, /data-ext="1"/g)], [60, 4, 1], 'en Hora: 60 regulares (MAXV_EXT) + las 4 extendidas del post en una sombra');
  assert(/aria-label="AAPL Hora Bollinger extendido"/.test(h), 'con su aria-label');
  igual(cuenta(CH.chartSvg({ ticker: 'AAPL', tf: 'hora', velas: regH }, { vista: 'bb', tf: 'hora', ext: true }), /<rect class="vela"/g), 90, 'en Hora sin velas_ext siguen siendo 90');
  // el gráfico del gestor (m1/m5, con ventana) no cambia aunque llegue ext
  const m5 = { ticker: 'AAPL', tf: 'm5', velas: serie('2026-09-22', '13:30', 100, 300), velas_ext: serie('2026-09-22', '12:00', 10, 300) };
  igual(CH.chartSvg(m5, { vista: 'bb', tf: 'm5', ext: true, ventana: { start: 10, end: 60 } }), CH.chartSvg(m5, { vista: 'bb', tf: 'm5', ventana: { start: 10, end: 60 } }), 'm5 con ventana (gestor): ext no aplica, idéntica');
  let ok = true; try { CH.chartSvg({ ...pk, velas_ext: [null, 5, { a: 1 }] }, { vista: 'hl', tf: 'm15', ext: true }); } catch (_) { ok = false; }
  assert(ok, 'una velas_ext con basura no lanza dentro del redibujo de la vista');
}

// ════════════════ 3. chartFrescoTxt con ext · cabecera de chartInline ════════════════
{
  const ahora = Math.floor(Date.now() / 1000), hoy = new Date().toISOString();
  const reg2 = [[ahora - 900 - 120, 1, 1, 1, 1, 1]];
  const f1 = { payload: { velas: reg2, velas_ext: [], vela_viva_ext: [ahora, 1, 1, 1, 1, 1] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(f1, 'm15', true), 'vela extendida en curso', 'viva extendida publicada ahora: «vela extendida en curso»');
  const f1v = { ...f1, actualizado_at: new Date(Date.now() - 45 * 60000).toISOString() };
  igual(CH.chartFrescoTxt(f1v, 'm15', true), 'extendido: sin datos aún', 'la viva extendida publicada hace 45 min NO se presenta como en curso (y sin cerradas extendidas: «sin datos aún»)');
  const f2 = { payload: { velas: [[ahora - 3 * 3600, 1, 1, 1, 1, 1]], velas_ext: [[ahora - 900 - 300, 1, 1, 1, 1, 1]] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(f2, 'm15', true), 'última vela (extendida) hace 5 min', 'la última extendida más nueva que la última regular (post de hoy): «última vela (extendida) hace N»');
  igual(CH.chartFrescoTxt(f2, 'm15', false), 'última vela hace 2 h', 'sin ext: la lectura regular de siempre');
  const f3 = { payload: { velas: reg2, velas_ext: [[ahora - 5 * 3600, 1, 1, 1, 1, 1]] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(f3, 'm15', true), 'última vela hace 2 min', 'extendida más vieja que la regular (el pre de hoy, en sesión): la frase regular');
  igual(CH.chartFrescoTxt({ payload: { velas: reg2 }, actualizado_at: hoy }, 'm15', true), 'extendido: sin datos aún', 'sin velas_ext (worker viejo): «extendido: sin datos aún», nada inventado');
  igual(CH.chartFrescoTxt({ payload: { velas: reg2, velas_ext: [[1, 2]] }, actualizado_at: hoy }, 'm15', true), 'extendido: sin datos aún', 'una fila extendida mal formada no cuenta como dato');
  igual(CH.chartFrescoTxt({ payload: { velas: [[ahora - 16 * 3600 - 3600, 1, 1, 1, 1, 1]], velas_ext: [[ahora - 60, 1, 1, 1, 1, 1]] }, actualizado_at: hoy }, 'dia', true), 'última vela hace 1 h', 'en Día el ext no aplica');
  igual(CH.chartFrescoTxt({ payload: { velas: reg2, vela_viva: [ahora, 1, 1, 1, 1, 1], velas_ext: [] }, actualizado_at: hoy }, 'm15', false), 'última vela hace 2 min · en curso', 'ext apagado: como siempre, aunque el payload traiga las claves nuevas');
  igual(CH.chartFrescoTxt(null, 'm15', true), 'sin velas', 'sin fila: «sin velas» también con ext');
  // cabecera de chartInline
  const fila15 = { payload: { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: EXT }, actualizado_at: hoy };
  const ci = CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger · extendido<\/span>/.test(ci) && /vela ext/.test(ci), 'chartInline con ext: cabecera «15 min · Bollinger · extendido» y el svg con las extendidas');
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, false)), 'sin ext la cabecera de siempre');
  const sinDatos = CH.chartInline('AAPL', { payload: { ticker: 'AAPL', tf: 'm15', velas: REG } , actualizado_at: hoy }, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(sinDatos) && /extendido: sin datos aún/.test(sinDatos) && !/vela ext/.test(sinDatos), 'ext sin datos: la cabecera no dice «extendido» pero la frescura dice «sin datos aún»');
  assert(/<span class="fresco">Día · Bollinger<\/span>/.test(CH.chartInline('AAPL', fila15, 'bb', 'dia', null, false, true)), 'en Día la cabecera no dice extendido');
}

// ════════════════ 4. vistaTickers: editor en la pestaña, ✕ por tarjeta y quitar en dos toques ════════════════
(async () => {
  function armarTab(E) {
    E = Object.assign({ hash: '#/tickers', estados: [{ symbol: 'AAPL', payload: { tendencias: { m15: 'alcista' }, avisos: ['aviso uno'] }, actualizado_at: new Date().toISOString() }],
      filas: [{ symbol: 'AAPL', rol: 'operable', activo: true, orden: 1 }, { symbol: 'TSLA', rol: 'operable', activo: true, orden: 2 }, { symbol: 'META', rol: 'operable', activo: false, orden: 3 }] }, E || {});
    const vista = nodo({ querySelector: () => null });
    const reg = { activo: [], charts: [] };
    const sb = sbFalso((tabla) => (tabla === 'ticker_estado' ? { data: E.estados, error: null } : { data: [], error: null }));
    const M = construir(['vistaTickers', 'tarjetaTicker', 'cabeceraTicker', 'chartPrefs', 'chartSelectores', 'editorTickersHtml', 'tickerQuitar', 'tickerQuitarSi', 'tickerQuitarNo', 'tickersGrande'], {
      sb, esc, haceCuanto, localStorage: localStorageFalso(E.almacen || {}), TICKERS: ['AAPL', 'TSLA'],
      cargarVelas: async () => ({}), cargarTargets: async () => ({}),
      chartInline: (sym, fila, vista, tf, tg, grande, ext) => { reg.charts.push([sym, tf, ext]); return `<div class="chart">chart ${sym}</div>`; },
      tg: () => '', volTxt: () => '', textoRangoTarjeta: () => '',
      location: { hash: E.hash }, $: (s) => (s === '#vista' ? vista : null), anchoVista: () => 400, GESTOR_ANCHO_TABLA: 900,
      tickerActivo: (sym, on) => { reg.activo.push([sym, on]); return Promise.resolve('escrito'); },
    }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS', '_tickers'], extras: ['__html'], prefijo: 'let _vistaTickersHtml = "";', sufijo: 'function __html() { return _vistaTickersHtml; }' });
    M._tickers.filas = E.filas;
    return { M, reg, vista };
  }
  {
    const { M, reg, vista } = armarTab();
    await M.vistaTickers();
    const h = vista.innerHTML;
    assert(/id="chartSel"/.test(h) && /<div class="tkedit"><input id="tkSym"/.test(h) && /MZ\.tickerAgregar\(\)">Agregar</.test(h), 'la pestaña Tickers lleva el editor: #tkSym y Agregar dentro de #chartSel', h.slice(0, 300));
    assert(/inactivos:<\/span><button class="btnsec tkoff"[^>]*onclick="MZ\.tickerActivo\('META', true\)">META ↺<\/button>/.test(h), 'y el chip del inactivo (META ↺) para volver a activarlo');
    igual(cuenta(h, /<button class="tkquitar" title="Quitar de la Mesa \(no se borra\)" onclick="MZ\.tickerQuitar\('[A-Z]+'\)">✕<\/button>/g), 2, 'un ✕ «Quitar de la Mesa (no se borra)» por tarjeta (AAPL con estado y TSLA SIN DATO)');
    assert(/<h3>AAPL<\/h3>\s*<span class="tkder"><span class="fresco">hace segundos<\/span><button class="tkquitar"/.test(h), 'en la tarjeta con estado el ✕ va junto a la frescura', h);
    assert(/<h3>TSLA<\/h3>\s*<span class="tkder"><span class="chip c-esp">SIN DATO<\/span><button class="tkquitar"/.test(h), 'en la tarjeta SIN DATO (ticker recién agregado) también: se puede quitar un error al momento');
    assert(!/¿Quitar/.test(h) && !/tickerQuitarSi/.test(h), 'sin toque, ninguna tarjeta pregunta');
    igual(reg.charts, [['AAPL', 'm15', false], ['TSLA', 'm15', false]], 'chartInline recibe el ext de las preferencias (apagado)');
    igual(M._tickers.quitando, null, 'nadie en estado quitando');
    // primer toque: la tarjeta pregunta; el resto sigue igual
    const p = M.tickerQuitar('AAPL');
    igual([M._tickers.quitando, M.__html()], ['AAPL', ''], 'tickerQuitar: marca el símbolo e invalida el HTML de la pestaña');
    await p;
    const q = vista.innerHTML;
    assert(/<div class="tkconf"><div class="mut">¿Quitar AAPL\? El worker deja de vigilarlo y sus señales no suenan; se puede volver a activar aquí\.<\/div>/.test(q), 'la tarjeta de AAPL pregunta en vez de la cabecera (sin confirm() nativo)', q);
    assert(/onclick="MZ\.tickerQuitarSi\('AAPL'\)">Quitar<\/button><button class="btnsec" onclick="MZ\.tickerQuitarNo\(\)">No<\/button>/.test(q), 'con [Quitar] y [No]');
    assert(!/<h3>AAPL<\/h3>/.test(q) && /<h3>TSLA<\/h3>/.test(q) && cuenta(q, /class="tkquitar"/g) === 1, 'la cabecera normal de AAPL desaparece mientras pregunta; TSLA conserva su ✕');
    assert(/chart AAPL/.test(q), 'el gráfico de la tarjeta sigue ahí');
    // [Quitar] = activo false, y limpia
    const r = M.tickerQuitarSi('AAPL');
    igual([reg.activo, M._tickers.quitando], [[['AAPL', false]], null], 'tickerQuitarSi: tickerActivo(sym, false) (no se borra: activo false) y limpia el estado');
    igual(await r, 'escrito', 'y devuelve la promesa de la escritura');
    // [No] vuelve a la cabecera normal
    await M.tickerQuitar('TSLA');
    assert(/¿Quitar TSLA\?/.test(vista.innerHTML), 'TSLA pregunta');
    await M.tickerQuitarNo();
    igual(M._tickers.quitando, null, 'tickerQuitarNo limpia');
    assert(!/¿Quitar/.test(vista.innerHTML) && cuenta(vista.innerHTML, /class="tkquitar"/g) === 2, 'y la pestaña vuelve a las dos cabeceras normales');
    igual(reg.activo.length, 1, 'sin escribir nada más');
  }
  {
    const { M, reg, vista } = armarTab({ almacen: { mz_chart_ext: '1' }, hash: '#/copiloto' });
    await M.vistaTickers();
    igual(reg.charts[0][2], true, 'con Extendido guardado, chartInline lo recibe encendido');
    igual(vista.innerHTML, '', 'si se cambió de pestaña mientras cargaba, no se pinta');
  }
  {
    // tarjetaTicker directa: en el Informe (compacto) ni ✕ ni pregunta, aunque haya un quitando pendiente
    const { M } = armarTab();
    M._tickers.quitando = 'AAPL';
    const e = { symbol: 'AAPL', payload: {}, actualizado_at: new Date().toISOString() };
    const inf = M.tarjetaTicker(e, 'AAPL', true);
    assert(!/tkquitar/.test(inf) && !/¿Quitar/.test(inf) && /<h3>AAPL<\/h3>\s*<span class="fresco">hace segundos<\/span><\/div>/.test(inf), 'en el Informe (compacto) la cabecera es la de siempre: sin ✕ y sin pregunta', inf);
    assert(!/tkquitar/.test(M.tarjetaTicker(undefined, 'TSLA', true)) && /SIN DATO/.test(M.tarjetaTicker(undefined, 'TSLA', true)), 'y la SIN DATO compacta tampoco lleva ✕');
    assert(/¿Quitar AAPL\?/.test(M.tarjetaTicker(e, 'AAPL', false)), 'en la pestaña (no compacto) la misma tarjeta pregunta');
    assert(/onclick="MZ\.tickerQuitar\('NVDA'\)"/.test(M.tarjetaTicker(undefined, 'NVDA', false)), 'y la SIN DATO de la pestaña lleva su ✕');
  }
  assert(/if \(tab !== 'tickers' && typeof _tickers === 'object' && _tickers\) _tickers\.quitando = null;/.test(extraer('ruta')), 'ruta(): la pregunta «¿Quitar X?» no sobrevive a un cambio de pestaña');

  // ════════════════ 5. textos «≤2 min», el campo del cuadro manda, y las puertas de window.MZ ════════════════
  {
    const msgs = [], err = { style: {}, textContent: '' };
    const TA = construir(['tickerAgregar', 'simboloTicker'], { $: (s) => (s === '#tkSym' ? { value: 'meta' } : s === '#tkErr' ? err : null), _tickers: { filas: [] },
      tickerEscribir: (fn, ok) => { msgs.push(ok); }, sb: null }, { consts: ['TICKER_RE'] });
    TA.tickerAgregar();
    igual(msgs, ['META agregado: el worker empieza a vigilarlo en ≤2 min'], 'tickerAgregar desde la pestaña (sin #tkNom): «≤2 min» (el worker 0.1.8 relee el catálogo cada 2 min)');
    assert(!/10 min/.test(extraer('tickerAgregar')) && !/10 min/.test(extraer('seccionTickersCuenta')), 'ya no queda ningún «10 min» en tickerAgregar ni en seccionTickersCuenta');
    const cta = construir(['seccionTickersCuenta', 'listaTickersHtml'], { esc, TICKERS: ['AAPL'], _tickers: { filas: [] } }).seccionTickersCuenta();
    assert(/hasta 2 min/.test(cta) && /id="tkSym"/.test(cta) && /MZ\.tickerAgregar\(\)/.test(cta), '⚙ Tu cuenta: «hasta 2 min», y su editor sigue igual');
    // con el cuadro de la cuenta abierto ENCIMA de la pestaña hay dos #tkSym: manda el del cuadro
    const sb = sbFalso(() => ({ data: null, error: null }));
    const TB = construir(['tickerAgregar', 'simboloTicker'], { $: (s) => (s === '#modalCuenta #tkSym' ? { value: 'nvda' } : s === '#tkSym' ? { value: 'meta' } : s === '#modalCuenta #tkNom' ? { value: 'Nvidia' } : s === '#tkErr' ? err : null),
      _tickers: { filas: [] }, tickerEscribir: (fn) => fn(), sb }, { consts: ['TICKER_RE'] });
    await TB.tickerAgregar();
    const ins = sb.llamadas[0] && sb.llamadas[0].cadena.find(c => c[0] === 'insert');
    assert(sb.llamadas[0].tabla === 'tickers' && ins && ins[1][0].symbol === 'NVDA' && ins[1][0].nombre === 'Nvidia' && ins[1][0].activo === true, 'tickerAgregar: con ⚙ abierto sobre la pestaña se inserta lo escrito en el cuadro (NVDA), no lo de atrás', JSON.stringify(ins));
    const TE = construir(['tickerEscribir'], { $: (s) => (s === '#modalCuenta #tkErr' ? err : null), cargarTickers: async () => true, pintarTickersCuenta() {}, toast() {}, ruta() {}, textoErrorTickers: (e) => String(e) });
    await TE.tickerEscribir(async () => ({ error: null }), null);
    igual(err.textContent, '', 'tickerEscribir también escribe el #tkErr del cuadro cuando está abierto');
  }
  {
    const mod = C.cargarModuloEntero({ hash: '#/tickers' });
    assert(mod.cargo, 'app/main.js entero se evalúa sin reventar', mod.error);
    if (mod.cargo) {
      igual(['chartExt', 'tickerQuitar', 'tickerQuitarSi', 'tickerQuitarNo', 'chartVista', 'chartTf', 'tickerAgregar', 'tickerActivo'].filter(k => typeof mod.win.MZ[k] !== 'function'), [], 'las puertas nuevas (chartExt, tickerQuitar/Si/No) cuelgan de window.MZ junto a las viejas');
      igual(mod.ev('_tickers.quitando'), null, 'el estado quitando nace vacío');
      igual(mod.ev('chartPrefs().ext'), false, 'y el extendido nace apagado en el módulo real');
    }
  }
  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
