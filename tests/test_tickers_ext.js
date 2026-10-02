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
     · v58 rev (revisión adversarial): el redibujo automático de la pestaña no pisa #tkSym/#tkErr y el forzado los
       conserva (también pintarSelectores); chartFrescoTxt con vela regular en curso; [Quitar] fallido cierra con
       redibujo + toast; ✕ sobre la lista de respaldo no escribe a 0 filas; el pre solo si la ventana abre su día;
       la cabecera dice «extendido» solo si se dibujó algo extendido
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_tickers_ext.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_tickers_ext.js');
const { assert, igual, cerca, construir, extraer, esc, haceCuanto, localStorageFalso, nodo, sbFalso, respirar } = C;

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
  const M = construir(['chartPrefs', 'chartSelectores', 'editorTickersHtml', 'chartExt', 'pintarSelectores', 'editorTickersCapturar', 'editorTickersRestaurar'], {
    localStorage: ls, esc, _tickers: { filas: E.filas },
    $: (s) => (s === '#modalChart' ? (E.modal ? nodo() : null) : s === '#chartSel' ? reg.sel : null),
    location: { hash: E.hash }, vistaTickers: (f) => { reg.vistaTickers++; reg.forzado = f; }, pintarChart: () => reg.pintarChart++,
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
  igual(reg.forzado, true, 'y la pide FORZADA: es un toque y repinta aunque el campo #tkSym tenga el foco (v58 rev)');
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

{
  // v58 rev: pintarSelectores (Bollinger / Hora / Extendido) reemplaza #chartSel por outerHTML y se llevaba lo escrito
  // en #tkSym y el aviso de #tkErr: ahora los captura del nodo viejo y los devuelve al nuevo (foco y cursor incluidos)
  const mkInp = (v) => ({ id: 'tkSym', value: v, selectionStart: v.length, selectionEnd: v.length, focos: 0, sel: null, focus() { this.focos++; doc.activeElement = this; }, setSelectionRange(a, b) { this.sel = [a, b]; } });
  const viejo = { inp: mkInp('ME'), err: { textContent: 'META ya está en el catálogo.', style: { color: 'var(--rojo)' } }, html: '' };
  viejo.querySelector = (s) => (s === '#tkSym' ? viejo.inp : s === '#tkErr' ? viejo.err : null);
  let reemplazado = false;
  Object.defineProperty(viejo, 'outerHTML', { set(h) { reemplazado = true; viejo.html = h; }, get() { return viejo.html; } });
  const nuevo = { inp: mkInp(''), err: { textContent: '', style: {} } };
  nuevo.querySelector = (s) => (s === '#tkSym' ? nuevo.inp : s === '#tkErr' ? nuevo.err : null);
  const doc = { activeElement: viejo.inp };
  const M = construir(['chartPrefs', 'chartSelectores', 'editorTickersHtml', 'pintarSelectores', 'editorTickersCapturar', 'editorTickersRestaurar'], {
    localStorage: localStorageFalso({}), esc, _tickers: { filas: [] }, document: doc,
    $: (s) => (s === '#chartSel' ? (reemplazado ? nuevo : viejo) : null),
  }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS'] });
  M.pintarSelectores();
  assert(reemplazado && /tkedit/.test(viejo.html), 'pintarSelectores repinta #chartSel con el editor');
  igual([nuevo.inp.value, nuevo.inp.focos, nuevo.inp.sel, doc.activeElement === nuevo.inp], ['ME', 1, [2, 2], true], 'y el #tkSym nuevo hereda «ME», el foco y el cursor (v58 rev)');
  igual([nuevo.err.textContent, nuevo.err.style.color], ['META ya está en el catálogo.', 'var(--rojo)'], 'y el aviso de #tkErr sigue a la vista, con su color');
  // sin foco y sin texto no se toca nada del nodo nuevo (ni se roba el foco)
  reemplazado = false; viejo.inp = mkInp(''); viejo.err.textContent = ''; doc.activeElement = null; nuevo.inp = mkInp(''); nuevo.err = { textContent: '', style: {} };
  M.pintarSelectores();
  igual([nuevo.inp.value, nuevo.inp.focos, nuevo.err.textContent, doc.activeElement], ['', 0, '', null], 'campo vacío y sin foco: el repintado no toca el nodo nuevo');
  const E0 = construir(['editorTickersCapturar', 'editorTickersRestaurar'], { document: doc });
  igual([E0.editorTickersCapturar(null), E0.editorTickersCapturar(nodo()), E0.editorTickersCapturar({ querySelector: () => { throw new Error('x'); } })], [null, null, null], 'editorTickersCapturar: sin raíz, sin #tkSym o con un DOM que lanza → null, sin reventar');
  let ok0 = true; try { E0.editorTickersRestaurar(nodo(), null); E0.editorTickersRestaurar(null, { valor: 'A', foco: true }); E0.editorTickersRestaurar({ querySelector: () => { throw new Error('x'); } }, { valor: 'A', foco: true }); } catch (_) { ok0 = false; }
  assert(ok0, 'editorTickersRestaurar tampoco lanza con nada que restaurar o un DOM roto');
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
  // v58 rev: el worker publica 5 sesiones (N_MAX m15 = 130) y en sesión la ventana de 2 (MAXV_EXT 52) empieza a
  // MEDIA sesión de D−2: el pre de ese día no puede pegarse a la regular de mediodía (continuidad temporal falsa)
  {
    const D4 = ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'], hoyD = '2026-09-24';
    const reg = serie('2026-09-17', '13:30', 26).slice(-16).concat(D4.flatMap(d => serie(d, '13:30', 26))).concat(serie(hoyD, '13:30', 10));   // 130: jueves 12:05 ET, 10 cerradas hoy
    const ext = ['2026-09-17'].concat(D4).flatMap(d => serie(d, '08:00', 22).concat(serie(d, '20:00', 16))).concat(serie(hoyD, '08:00', 22));   // pre 4:00–9:15 (22) + post 16:00–19:45 (16) por día
    const pkM = { ticker: 'AAPL', tf: 'm15', velas: reg, velas_ext: ext.slice(-200), vela_viva: fila(T(hoyD, '16:00'), 7) };
    const svgM = CH.chartSvg(pkM, { vista: 'bb', tf: 'm15', ext: true });
    const clasesM = [...svgM.matchAll(/<rect class="(vela[^"]*)"/g)].map(m => m[1]);
    igual([reg.length, clasesM[0]], [130, 'vela'], '130 regulares con el día a medias: la ventana empieza en la regular del martes 12:00 y la PRIMERA vela dibujada es esa regular (sin el pre del martes pegado delante)');
    igual([cuenta(svgM, /<rect class="vela"/g), cuenta(svgM, /<rect class="vela ext"/g), cuenta(svgM, /<rect data-ext="1"/g)], [52, 76, 2], '52 regulares + solo las extendidas POSTERIORES a esa regular: post mar (16) + pre mié (22) + post mié (16) + pre jue (22) = 76, en dos sombras');
    igual([clasesM.slice(0, 16).every(c => c === 'vela'), clasesM[16]], [true, 'vela ext'], 'las 16 primeras son las regulares del martes 12:00–15:45 y la primera extendida es la del post de ese día (16:00): el borde izquierdo no inventa continuidad');
    // con la ventana abriendo su día (5 sesiones completas, fuera de sesión) el pre de ese día SÍ entra, como antes
    const reg5 = ['2026-09-17'].concat(D4).flatMap(d => serie(d, '13:30', 26));
    const svg5 = CH.chartSvg({ ticker: 'AAPL', tf: 'm15', velas: reg5, velas_ext: ext.slice(0, 190).slice(-200) }, { vista: 'bb', tf: 'm15', ext: true });
    const clases5 = [...svg5.matchAll(/<rect class="(vela[^"]*)"/g)].map(m => m[1]);
    igual([reg5.length, clases5[0], cuenta(svg5, /<rect class="vela ext"/g)], [130, 'vela ext', 76], '130 regulares en 5 sesiones completas: la ventana abre el martes a las 9:30 y el pre del martes (4:00–9:15) entra delante: 22 + 16 + 22 + 16 = 76');
  }
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
  // v58 rev: con una vela REGULAR en curso (la primera hora de la sesión en Hora, los primeros 15 min en 15 min) la
  // última regular CERRADA es la de ayer y la extendida del pre es más nueva; lo que se dibuja es la viva regular
  const vivaH = ahora - 20 * 60;   // Hora, 9:50 ET: viva regular = bucket 9:30; última ext cerrada = bucket 8:30 (cerró 9:30)
  const fH = { payload: { velas: [[vivaH - 18 * 3600, 1, 1, 1, 1, 1]], vela_viva: [vivaH, 1, 1, 1, 1, 1], velas_ext: [[vivaH - 3600, 1, 1, 1, 1, 1]] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(fH, 'hora', true), 'última vela hace 17 h · en curso', 'Hora a las 9:50 ET con ext: hay vela regular en curso → la frase regular, NO «última vela (extendida) hace 20 min»');
  igual(CH.chartFrescoTxt(fH, 'hora', true), CH.chartFrescoTxt(fH, 'hora', false), 'y coincide con la de ext apagado (lo que se dice = lo que se ve)');
  const viva15 = ahora - 8 * 60;   // 15 min, 9:38 ET: viva = 9:30; última ext cerrada = 9:15
  const f15 = { payload: { velas: [[viva15 - 18 * 3600, 1, 1, 1, 1, 1]], vela_viva: [viva15, 1, 1, 1, 1, 1], velas_ext: [[viva15 - 900, 1, 1, 1, 1, 1]] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(f15, 'm15', true), 'última vela hace 17 h · en curso', '15 min a las 9:38 ET con ext: igual');
  const fHv = { ...fH, actualizado_at: new Date(Date.now() - 45 * 60000).toISOString() };
  igual(CH.chartFrescoTxt(fHv, 'hora', true), 'última vela hace 17 h · sin cerrar (publicada hace 45 min)', 'con la viva regular publicada hace 45 min (worker parado) sigue mandando la regular, y honesta');
  const fPost = { payload: { velas: [[ahora - 2 * 3600, 1, 1, 1, 1, 1]], vela_viva: null, velas_ext: [[ahora - 900 - 300, 1, 1, 1, 1, 1]] }, actualizado_at: hoy };
  igual(CH.chartFrescoTxt(fPost, 'm15', true), 'última vela (extendida) hace 5 min', 'sin viva regular (post) la extendida más nueva sí manda, como antes');
  // cabecera de chartInline
  const fila15 = { payload: { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: EXT }, actualizado_at: hoy };
  const ci = CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger · extendido<\/span>/.test(ci) && /vela ext/.test(ci), 'chartInline con ext: cabecera «15 min · Bollinger · extendido» y el svg con las extendidas');
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, false)), 'sin ext la cabecera de siempre');
  const sinDatos = CH.chartInline('AAPL', { payload: { ticker: 'AAPL', tf: 'm15', velas: REG } , actualizado_at: hoy }, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(sinDatos) && /extendido: sin datos aún/.test(sinDatos) && !/vela ext/.test(sinDatos), 'ext sin datos: la cabecera no dice «extendido» pero la frescura dice «sin datos aún»');
  assert(/<span class="fresco">Día · Bollinger<\/span>/.test(CH.chartInline('AAPL', fila15, 'bb', 'dia', null, false, true)), 'en Día la cabecera no dice extendido');
  // v58 rev: «· extendido» solo si el svg DIBUJÓ alguna extendida (el mismo criterio que su aria-label)
  const fuera = CH.chartInline('AAPL', { payload: { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: serie('2026-09-21', '20:00', 16) }, actualizado_at: hoy }, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(fuera) && !/vela ext/.test(fuera) && /aria-label="AAPL 15 min Bollinger"/.test(fuera), 'velas_ext publicadas pero fuera de la ventana (solo el post de un día anterior): ni una dibujada → la cabecera NO dice «extendido»', fuera.slice(0, 200));
  assert(/<span class="fresco">última vela hace \d+ h<\/span>/.test(fuera), 'y la frescura es la regular');
  const malas = CH.chartInline('AAPL', { payload: { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: [[1, 2]] }, actualizado_at: hoy }, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger<\/span>/.test(malas) && /extendido: sin datos aún/.test(malas) && !/data-ext/.test(malas), 'filas extendidas mal formadas: sin «extendido» en la cabecera y «sin datos aún» en la frescura');
  const soloVivaI = CH.chartInline('AAPL', { payload: { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: [], vela_viva_ext: EXT[EXT.length - 1] }, actualizado_at: hoy }, 'bb', 'm15', null, false, true);
  assert(/<span class="fresco">15 min · Bollinger · extendido<\/span>/.test(soloVivaI) && /vela ext viva/.test(soloVivaI), 'solo con la viva extendida dibujada ya dice «extendido»');
}

// ════════════════ 4. vistaTickers: editor en la pestaña, ✕ por tarjeta y quitar en dos toques ════════════════
(async () => {
  function armarTab(E) {
    E = Object.assign({ hash: '#/tickers', estados: [{ symbol: 'AAPL', payload: { tendencias: { m15: 'alcista' }, avisos: ['aviso uno'] }, actualizado_at: new Date().toISOString() }],
      filas: [{ symbol: 'AAPL', rol: 'operable', activo: true, orden: 1 }, { symbol: 'TSLA', rol: 'operable', activo: true, orden: 2 }, { symbol: 'META', rol: 'operable', activo: false, orden: 3 }] }, E || {});
    const vista = E.vista || nodo({ querySelector: () => null });
    const reg = { activo: [], charts: [], toast: [] };
    const sb = sbFalso((tabla) => (tabla === 'ticker_estado' ? { data: E.estados, error: null } : { data: [], error: null }));
    const M = construir(['vistaTickers', 'tarjetaTicker', 'cabeceraTicker', 'chartPrefs', 'chartSelectores', 'editorTickersHtml', 'tickerQuitar', 'tickerQuitarSi', 'tickerQuitarNo', 'tickersGrande',
      'tickerEnCatalogo', 'tickerQuitarAviso', 'tickersEnUso', 'editorTickersCapturar', 'editorTickersRestaurar', 'pintarTickersConservando'], {
      sb, esc, haceCuanto, localStorage: localStorageFalso(E.almacen || {}), TICKERS: ['AAPL', 'TSLA'],
      cargarVelas: async () => ({}), cargarTargets: async () => ({}),
      chartInline: (sym, fila, vista, tf, tg, grande, ext) => { reg.charts.push([sym, tf, ext]); return `<div class="chart">chart ${sym}</div>`; },
      tg: () => '', volTxt: () => '', textoRangoTarjeta: () => '', toast: (m) => reg.toast.push(m), document: E.doc || { activeElement: null },
      location: { hash: E.hash }, $: (s) => (s === '#vista' ? vista : s === '#tkErr' ? (vista.err || null) : null), anchoVista: () => 400, GESTOR_ANCHO_TABLA: 900,
      tickerActivo: (sym, on) => { reg.activo.push([sym, on]); return Promise.resolve('escrito'); },
    }, { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS', '_tickers'], extras: ['__html', '__blank'], prefijo: 'let _vistaTickersHtml = "";', sufijo: 'function __html() { return _vistaTickersHtml; } function __blank() { _vistaTickersHtml = ""; }' });
    M._tickers.filas = E.filas;
    return { M, reg, vista, E };
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
    igual([reg.activo, M._tickers.quitando], [[['AAPL', false]], 'AAPL'], 'tickerQuitarSi: tickerActivo(sym, false) (no se borra: activo false); la tarjeta sigue preguntando hasta saber el resultado (v58 rev)');
    igual(await r, 'escrito', 'y devuelve la promesa de la escritura');
    await respirar();
    igual(M._tickers.quitando, null, 'al terminar limpia el estado…');
    assert(!/¿Quitar/.test(vista.innerHTML) && cuenta(vista.innerHTML, /class="tkquitar"/g) === 2, '…y cierra con un redibujo: la tarjeta vuelve a su cabecera (la escritura falsa de aquí no saca a AAPL de TICKERS)');
    igual(reg.toast, [], 'sin toast de error');
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

  // ── v58 rev: el redibujo AUTOMÁTICO (ruta() cada 60 s, Realtime) no pisa el editor mientras se escribe; el
  // FORZADO (un toque) repinta conservando texto, cursor, foco y el aviso de #tkErr ──
  function domEditor() {
    // #vista de juguete: como en el DOM real, cada innerHTML crea un #tkSym y un #tkErr NUEVOS (los viejos mueren)
    const doc = { activeElement: null };
    const vista = nodo({ reemplazos: 0, campo: null, err: null });
    vista.contains = (a) => !!a && a === vista.campo;
    vista.querySelector = (s) => (s === '#chartSel' ? (/id="chartSel"/.test(vista._h || '') ? nodo() : null) : s === '#tkSym' ? vista.campo : s === '#tkErr' ? vista.err : null);
    Object.defineProperty(vista, 'innerHTML', { get() { return this._h || ''; }, set(h) {
      this._h = h; this.reemplazos++;
      this.campo = /id="tkSym"/.test(h) ? { id: 'tkSym', tagName: 'INPUT', value: '', selectionStart: 0, selectionEnd: 0, focos: 0, sel: null,
        focus() { this.focos++; doc.activeElement = this; }, setSelectionRange(a, b) { this.sel = [a, b]; } } : null;
      this.err = /id="tkErr"/.test(h) ? { id: 'tkErr', textContent: '', style: {} } : null;
    } });
    return { vista, doc };
  }
  {
    const dom = domEditor();
    const { M, vista, E } = armarTab({ vista: dom.vista, doc: dom.doc });
    await M.vistaTickers();
    igual([vista.reemplazos, !!vista.campo, !!vista.err], [1, true, true], 'primer pintado: #vista nace con su #tkSym y su #tkErr');
    // Andrés teclea «ME» (foco en el campo); un minuto después la cabecera de AAPL pasa de «hace segundos» a «hace 1 min»
    const campo1 = vista.campo; campo1.value = 'ME'; campo1.selectionStart = campo1.selectionEnd = 2; dom.doc.activeElement = campo1;
    E.estados[0].actualizado_at = new Date(Date.now() - 61000).toISOString();
    const antes = M.__html();
    await M.vistaTickers();                                       // ruta() de los 60 s / Realtime: AUTOMÁTICA
    igual([vista.reemplazos, vista.campo === campo1, campo1.value, M.__html() === antes], [1, true, 'ME', true], 'vuelta automática con el campo en uso: NO se redibuja (el input sigue vivo con «ME», el teclado abierto) y _vistaTickersHtml no se toca');
    // sin el foco (tocó fuera) la vuelta automática sí repinta, y lo escrito pasa al input nuevo sin robar el foco
    dom.doc.activeElement = null;
    await M.vistaTickers();
    igual([vista.reemplazos, vista.campo !== campo1, vista.campo.value, vista.campo.focos, /hace 1 min/.test(vista.innerHTML)], [2, true, 'ME', 0, true], 'sin el foco la vuelta automática repinta («hace 1 min») y el #tkSym nuevo hereda «ME» sin robar el foco');
    // con un aviso en #tkErr y el foco en el campo, un toque (tickerQuitar = forzado) repinta conservando todo
    const campo2 = vista.campo; campo2.value = 'META'; campo2.selectionStart = campo2.selectionEnd = 4; dom.doc.activeElement = campo2;
    vista.err.textContent = 'META ya está en el catálogo.'; vista.err.style.color = 'var(--rojo)';
    await M.tickerQuitar('TSLA');
    igual([vista.reemplazos, vista.campo !== campo2, vista.campo.value, vista.campo.focos, vista.campo.sel, dom.doc.activeElement === vista.campo], [3, true, 'META', 1, [4, 4], true], 'tickerQuitar (toque): repinta FORZADO aunque el campo tenga el foco, y el #tkSym nuevo recupera texto, foco y cursor');
    igual([vista.err.textContent, vista.err.style.color], ['META ya está en el catálogo.', 'var(--rojo)'], 'y el aviso de #tkErr sigue a la vista (antes lo borraba cada redibujo)');
    assert(/¿Quitar TSLA\?/.test(vista.innerHTML), 'con la tarjeta de TSLA preguntando');
    // tickerEscribir acaba de escribir en el catálogo (_vistaTickersHtml = '') → la vuelta de ruta() repinta aunque haya foco
    M.__blank();
    E.estados[0].actualizado_at = new Date(Date.now() - 122000).toISOString();
    await M.vistaTickers();
    igual([vista.reemplazos, vista.campo.value, vista.campo.focos, /hace 2 min/.test(vista.innerHTML)], [4, 'META', 1, true], 'con _vistaTickersHtml vacío (tras escribir en el catálogo) la vuelta automática repinta aunque el campo tenga el foco: lo nuevo se ve, y el campo sobrevive');
    // el mismo HTML no toca el DOM (como siempre), tenga o no el foco
    await M.vistaTickers();
    igual(vista.reemplazos, 4, 'sin cambios en el HTML no se toca el DOM');
    // tickersEnUso solo cuenta el #tkSym de #vista: otro campo (el del cuadro de la cuenta, fuera de #vista) no bloquea
    dom.doc.activeElement = { id: 'tkSym', tagName: 'INPUT' };
    E.estados[0].actualizado_at = new Date(Date.now() - 183000).toISOString();
    await M.vistaTickers();
    igual([vista.reemplazos, /hace 3 min/.test(vista.innerHTML)], [5, true], 'un #tkSym que no está dentro de #vista (el del cuadro ⚙) no frena el redibujo de la pestaña');
    igual([M.tickersEnUso(vista), M.tickersEnUso(null)], [false, false], 'tickersEnUso: false con el foco fuera de #vista y sin raíz');
    dom.doc.activeElement = vista.campo;
    igual(M.tickersEnUso(vista), true, 'y true con el foco en el #tkSym de la pestaña');
  }
  {
    // ── v58 rev: [Quitar] con la escritura FALLIDA (policy 42501) y con éxito: el estado se mantiene hasta saber el
    // resultado y SIEMPRE se cierra con un redibujo forzado; el error va al #tkErr Y a un toast ──
    const armarQ = (respuestaUpdate) => {
      const errTab = { style: {}, textContent: '' }, reg = { ruta: 0, vt: 0, forzado: null, toast: [] };
      const sb = sbFalso((tabla, cadena) => (cadena.some(c => c[0] === 'update') ? respuestaUpdate : { data: [], error: null }));
      const M = construir(['tickerQuitarSi', 'tickerQuitar', 'tickerQuitarNo', 'tickerEnCatalogo', 'tickerQuitarAviso', 'tickerActivo', 'tickerEscribir', 'textoErrorTickers'], {
        sb, esc, $: (s) => (s === '#tkErr' ? errTab : null), cargarTickers: async () => true, pintarTickersCuenta() {},
        toast: (m) => reg.toast.push(m), ruta: () => reg.ruta++, vistaTickers: (f) => { reg.vt++; reg.forzado = f; return Promise.resolve(); }, location: { hash: '#/tickers' },
      }, { consts: ['_tickers'], extras: ['__html'], prefijo: 'let _vistaTickersHtml = "x";', sufijo: 'function __html() { return _vistaTickersHtml; }' });
      M._tickers.filas = [{ symbol: 'AAPL', rol: 'operable', activo: true, orden: 1 }];
      M._tickers.quitando = 'AAPL';
      return { M, reg, errTab, sb };
    };
    const F = armarQ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } });
    const pF = F.M.tickerQuitarSi('AAPL');
    igual(F.M._tickers.quitando, 'AAPL', 'tickerQuitarSi: mientras se escribe, la tarjeta sigue preguntando (el estado no se limpia antes de saber el resultado)');
    const rF = await pF;
    igual([F.M._tickers.quitando, F.reg.vt, F.reg.forzado, F.M.__html(), F.reg.ruta, rF], [null, 1, true, '', 0, false], 'fallo → quitando null, UN redibujo forzado de la pestaña (la tarjeta vuelve a su cabecera), sin ruta(), y tickerEscribir devuelve false');
    assert(/migración 0017/.test(F.errTab.textContent) && F.errTab.style.color === 'var(--rojo)', 'el error va al #tkErr de la fila de edición…', F.errTab.textContent);
    igual(F.reg.toast, [F.errTab.textContent], '…y también a un toast, donde se tocó (en el iPhone la fila de arriba queda fuera de pantalla)');
    const upd = F.sb.llamadas.find(l => l.tabla === 'tickers' && l.cadena.some(c => c[0] === 'update'));
    igual(upd && upd.cadena, [['update', [{ activo: false }]], ['eq', ['symbol', 'AAPL']]], 'la escritura fue el update activo=false de siempre (no se borra)');
    const S = armarQ({ data: [{ symbol: 'AAPL' }], error: null });
    const rS = await S.M.tickerQuitarSi('AAPL');
    igual([S.M._tickers.quitando, S.reg.ruta, S.reg.vt, S.reg.forzado, S.M.__html(), rS, S.reg.toast, S.errTab.textContent], [null, 1, 1, true, '', true, ['AAPL: inactivo (no se borra)'], ''], 'éxito → el toast de siempre, ruta() (lista nueva) + el redibujo forzado de cierre, sin error');
    // fuera de la pestaña (ruta() ya limpió quitando al cambiar) el cierre no redibuja Tickers
    const O = armarQ({ data: [], error: null });
    const MO = construir(['tickerQuitarSi', 'tickerEnCatalogo', 'tickerQuitarAviso'], { $: () => null, toast() {}, location: { hash: '#/copiloto' }, vistaTickers: () => { O.reg.vt++; return Promise.resolve(); },
      tickerActivo: () => Promise.resolve(true) }, { consts: ['_tickers'], prefijo: 'let _vistaTickersHtml = "x";' });
    MO._tickers.filas = [{ symbol: 'AAPL', rol: 'operable', activo: true }]; MO._tickers.quitando = 'AAPL';
    await MO.tickerQuitarSi('AAPL');
    igual([MO._tickers.quitando, O.reg.vt], [null, 0], 'desde otra pestaña: limpia el estado y no pinta Tickers');
  }
  {
    // ── v58 rev: ✕ sobre un ticker de la lista de RESPALDO (catálogo sin leer o vacío): un update a 0 filas que
    // PostgREST contesta sin error NO es un éxito; se avisa y no se escribe ──
    const errTab = { style: {}, textContent: '' }, reg = { toast: [], vt: 0, activo: [] };
    const M = construir(['tickerQuitar', 'tickerQuitarSi', 'tickerQuitarNo', 'tickerEnCatalogo', 'tickerQuitarAviso', 'cabeceraTicker'], {
      esc, $: (s) => (s === '#tkErr' ? errTab : null), toast: (m) => reg.toast.push(m), vistaTickers: () => { reg.vt++; return Promise.resolve(); },
      tickerActivo: (sym, on) => { reg.activo.push([sym, on]); return Promise.resolve(true); }, location: { hash: '#/tickers' },
    }, { consts: ['_tickers'], prefijo: 'let _vistaTickersHtml = "x";' });
    igual(M._tickers.filas, null, 'catálogo sin leer (la pestaña enseña la lista de respaldo)');
    assert(/tkquitar/.test(M.cabeceraTicker('AAPL', false, '')), 'la tarjeta de AAPL lleva su ✕ igual (decisión: un botón que falta no explica nada; el aviso sí)');
    await M.tickerQuitar('AAPL');
    igual([M._tickers.quitando, reg.vt, reg.activo], [null, 0, []], 'el ✕ sobre un ticker que no está en el catálogo leído no entra en «quitando», no redibuja y no escribe');
    igual(errTab.textContent, 'AAPL no está en el catálogo leído (lista de respaldo): no se puede quitar desde aquí.', 'lo dice en #tkErr…');
    igual([reg.toast, errTab.style.color], [[errTab.textContent], 'var(--rojo)'], '…y en un toast, en rojo');
    M._tickers.quitando = 'AAPL';                                   // por si el catálogo cambió entre los dos toques
    await M.tickerQuitarSi('AAPL');
    igual([reg.activo, reg.toast.length, M._tickers.quitando, reg.vt], [[], 2, null, 1], 'tickerQuitarSi tampoco escribe: avisa y cierra la pregunta con un redibujo');
    M._tickers.filas = [{ symbol: 'aapl', rol: 'operable', activo: true, orden: 1 }, { symbol: 'MERCADO', rol: 'mercado', activo: true }];
    await M.tickerQuitar('AAPL');
    igual([M._tickers.quitando, reg.vt, reg.toast.length], ['AAPL', 2, 2], 'con AAPL en el catálogo leído (da igual la caja) el ✕ pasa a preguntar');
    await M.tickerQuitarSi('AAPL');
    igual([reg.activo, M._tickers.quitando], [[['AAPL', false]], null], 'y [Quitar] escribe activo=false');
    M._tickers.filas = [];
    await M.tickerQuitar('AAPL');
    igual([M._tickers.quitando, reg.toast.length], [null, 3], 'catálogo leído pero VACÍO (respaldo otra vez): tampoco se puede quitar');
    igual([M.tickerEnCatalogo('aapl'), M.tickerEnCatalogo(''), M.tickerEnCatalogo(null)], [false, false, false], 'tickerEnCatalogo con lista vacía o sin símbolo: false');
  }

  // ════════════════ 5. textos «≤2 min», el campo del cuadro manda, y las puertas de window.MZ ════════════════
  {
    const msgs = [], err = { style: {}, textContent: '' }, inpTab = { value: 'meta' };
    const TA = construir(['tickerAgregar', 'simboloTicker'], { $: (s) => (s === '#tkSym' ? inpTab : s === '#tkErr' ? err : null), _tickers: { filas: [] },
      tickerEscribir: (fn, ok) => { msgs.push(ok); return Promise.resolve(true); }, sb: null }, { consts: ['TICKER_RE'] });
    const pA = TA.tickerAgregar();
    igual(msgs, ['META agregado: el worker empieza a vigilarlo en ≤2 min'], 'tickerAgregar desde la pestaña (sin #tkNom): «≤2 min» (el worker 0.1.8 relee el catálogo cada 2 min)');
    igual([await pA, inpTab.value], [true, ''], 'v58 rev: tras agregar con éxito el campo de la pestaña se vacía (el redibujo ya no lo vacía de rebote: conserva lo escrito)');
    inpTab.value = 'nvda';
    const TAf = construir(['tickerAgregar', 'simboloTicker'], { $: (s) => (s === '#tkSym' ? inpTab : s === '#tkErr' ? err : null), _tickers: { filas: [] },
      tickerEscribir: () => Promise.resolve(false), sb: null }, { consts: ['TICKER_RE'] });
    igual([await TAf.tickerAgregar(), inpTab.value], [false, 'nvda'], 'si la escritura falla el campo conserva lo escrito (para corregir y reintentar)');
    assert(!/10 min/.test(extraer('tickerAgregar')) && !/10 min/.test(extraer('seccionTickersCuenta')), 'ya no queda ningún «10 min» en tickerAgregar ni en seccionTickersCuenta');
    const cta = construir(['seccionTickersCuenta', 'listaTickersHtml'], { esc, TICKERS: ['AAPL'], _tickers: { filas: [] } }).seccionTickersCuenta();
    assert(/hasta 2 min/.test(cta) && /id="tkSym"/.test(cta) && /MZ\.tickerAgregar\(\)/.test(cta), '⚙ Tu cuenta: «hasta 2 min», y su editor sigue igual');
    // con el cuadro de la cuenta abierto ENCIMA de la pestaña hay dos #tkSym: manda el del cuadro
    const sb = sbFalso(() => ({ data: null, error: null }));
    const inpCuadro = { value: 'nvda' }, inpAtras = { value: 'meta' };
    const TB = construir(['tickerAgregar', 'simboloTicker'], { $: (s) => (s === '#modalCuenta #tkSym' ? inpCuadro : s === '#tkSym' ? inpAtras : s === '#modalCuenta #tkNom' ? { value: 'Nvidia' } : s === '#tkErr' ? err : null),
      _tickers: { filas: [] }, tickerEscribir: (fn) => fn().then(() => true), sb }, { consts: ['TICKER_RE'] });
    await TB.tickerAgregar();
    const ins = sb.llamadas[0] && sb.llamadas[0].cadena.find(c => c[0] === 'insert');
    assert(sb.llamadas[0].tabla === 'tickers' && ins && ins[1][0].symbol === 'NVDA' && ins[1][0].nombre === 'Nvidia' && ins[1][0].activo === true, 'tickerAgregar: con ⚙ abierto sobre la pestaña se inserta lo escrito en el cuadro (NVDA), no lo de atrás', JSON.stringify(ins));
    igual([inpCuadro.value, inpAtras.value], ['nvda', 'meta'], 'el campo del cuadro de la cuenta NO se vacía (sigue como estaba) ni se toca el de atrás');
    const toasts = [], rutas = [];
    const TE = construir(['tickerEscribir'], { $: (s) => (s === '#modalCuenta #tkErr' ? err : null), cargarTickers: async () => true, pintarTickersCuenta() {}, toast: (m) => toasts.push(m), ruta: () => rutas.push(1), textoErrorTickers: (e) => String((e && e.message) || e) },
      { extras: ['__html'], prefijo: 'let _vistaTickersHtml = "x";', sufijo: 'function __html() { return _vistaTickersHtml; }' });
    const okE = await TE.tickerEscribir(async () => ({ error: null }), null);
    igual([err.textContent, okE, TE.__html(), rutas.length, toasts], ['', true, '', 1, []], 'tickerEscribir también escribe el #tkErr del cuadro cuando está abierto; devuelve true, invalida el HTML de Tickers (la vuelta de ruta() repinta aunque el campo tenga el foco) y llama a ruta()');
    const malE = await TE.tickerEscribir(async () => ({ error: { message: 'se cayó' } }), 'no sale');
    igual([malE, err.textContent, err.style.color, toasts, rutas.length], [false, 'se cayó', 'var(--rojo)', [], 1], 'fallo con el cuadro abierto: false, el error bajo el botón del cuadro, SIN toast (ahí se ve) y sin ruta()');
    const errTab2 = { style: {}, textContent: '' };
    const TE2 = construir(['tickerEscribir'], { $: (s) => (s === '#tkErr' ? errTab2 : null), cargarTickers: async () => true, pintarTickersCuenta() {}, toast: (m) => toasts.push(m), ruta() {}, textoErrorTickers: (e) => String((e && e.message) || e) }, { prefijo: 'let _vistaTickersHtml = "x";' });
    igual([await TE2.tickerEscribir(async () => ({ error: { message: 'policy' } }), 'no sale'), errTab2.textContent, toasts], [false, 'policy', ['policy']], 'fallo desde la pestaña: el error en el #tkErr de la fila de edición Y en un toast (v58 rev: se ve donde se tocó)');
    igual(await TE2.tickerEscribir(async () => { throw new Error('red caída'); }, null), false, 'una excepción (fetch cortado) también devuelve false');
    // el #tkErr se busca de nuevo al terminar: un redibujo automático durante la escritura lo reemplaza por otro nodo
    const e1 = { style: {}, textContent: '' }, e2 = { style: {}, textContent: '' }; let vueltas = 0;
    const TE3 = construir(['tickerEscribir'], { $: (s) => (s === '#tkErr' ? (vueltas++ ? e2 : e1) : null), cargarTickers: async () => true, pintarTickersCuenta() {}, toast() {}, ruta() {}, textoErrorTickers: (e) => String((e && e.message) || e) }, { prefijo: 'let _vistaTickersHtml = "x";' });
    await TE3.tickerEscribir(async () => ({ error: { message: 'tarde' } }), null);
    igual([e1.textContent, e2.textContent, e2.style.color], ['Guardando…', 'tarde', 'var(--rojo)'], 'si un redibujo reemplazó el #tkErr durante la escritura, el resultado va al nodo VIVO (el viejo, fuera del DOM, se queda con «Guardando…» sin que importe)');
    const e3 = { style: {}, textContent: '' }, e4 = { style: { color: 'var(--rojo)' }, textContent: 'Guardando…' }; vueltas = 0;
    const TE4 = construir(['tickerEscribir'], { $: (s) => (s === '#tkErr' ? (vueltas++ ? e4 : e3) : null), cargarTickers: async () => true, pintarTickersCuenta() {}, toast() {}, ruta() {}, textoErrorTickers: (e) => String(e) }, { prefijo: 'let _vistaTickersHtml = "x";' });
    igual([await TE4.tickerEscribir(async () => ({ error: null }), null), e4.textContent], [true, ''], 'y con éxito el nodo vivo queda limpio (no «Guardando…»)');
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
