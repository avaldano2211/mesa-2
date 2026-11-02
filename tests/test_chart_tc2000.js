#!/usr/bin/env node
/* v67 · el gráfico «como TC2000» (spec69 sección G). Andrés 2026-11-01, sobre su captura de TSLA «Medias + H-lines · Día»:
   «aquí deberían de salir las líneas del color correcto y bien identificadas»; «20= amarillo 40= Rojo 100= Verde 200= fuxia».
     1. G1 · paleta fija: lienzo oscuro en los dos temas (ningún color del tema dentro del svg), medias 20 amarilla fina /
        40 roja fina / 100 verde gruesa / 200 fucsia la más gruesa y ENCIMA de las velas, velas verde y rojo vivos, H-lines
        (techo/piso blancos, máx/mín azules, target rojo claro discontinuo, alto/bajo finos punteados, cierre de ayer
        amarillo punteado, apertura gris punteada), Bollinger teal con el medio amarillo; contraste de TODO texto ≥ 4.5
     2. G2 · etiquetas «nombre precio»: con techo, piso, cierre ayer y apertura a menos de 9 px entre sí salen TODAS, sin
        solaparse, bajo la leyenda, a la izquierda (lejos de la cajita del spot) y la que se aparta con su conector
     3. G2 · leyenda «como TC2000»: «AAPL · Día · Avg 20 · …» cada nombre en el color de SU línea; solo se nombra lo
        dibujado (sin historia: «Avg 200 —» tenue); Bollinger «Bollinger Bands 20 2 · Moving Average 20»; el mini del
        Informe compacta y sin pisar velas; el aria-label nombra lo dibujado
     4. G2 · lista H-LINES de la hoja: mismas muestras (color) y nombres que el gráfico, de arriba abajo por precio
     5. G1 · strikes del gestor legibles sobre el lienzo, distintos del blanco de las edge lines y con trazo propio
     6. G2 · editor de target: «Target alto (el más optimista)», «Target bajo (el más pesimista)» y la línea de ayuda
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Contra la v66 (254b8e3) las ayudas nuevas no
   existen: la suite se construye sin ellas y FALLA por lo que dibuja (colores del tema, etiquetas escondidas, sin leyenda).
   Uso: node test_chart_tc2000.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_chart_tc2000.js');
const { assert, igual, construir, esc, haceCuanto, nodo, extraer, existeConst } = C;
const tiene = (n) => { try { extraer(n); return true; } catch (_) { return false; } };
const opc = (ns) => ns.filter(tiene);
const optC = (ns) => ns.filter(existeConst);

// ---------- velas de juguete (las de test_chart.js) ----------
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
const AUX_V67 = opc(['nivelesChart', 'muestraLinea', 'leyendaChartSvg', 'apilarEtiquetas', 'itemLeyendaGestor']);
const CONST_V67 = optC(['CHART_COL']);
const CH = construir(['chartSvg', 'bollingerApp', 'smaApp', 'serieExtM', 'mediasExtM', 'techoPisoProximos', 'chartTiempo', 'hlinesLista', 'rangoValido', 'fmtFechaNY'].concat(AUX_V67),
  { esc, haceCuanto }, { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'].concat(CONST_V67) });

// ---------- lectura del svg ----------
const atributos = (tag) => { const o = {}; for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; };
const elementos = (svg, re) => (svg.match(re) || []).map(atributos);
const uno = (svg, re) => elementos(svg, re)[0] || {};
const hex = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c || '')); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const contraste = (a, b) => { const A = hex(a), B = hex(b); if (!A || !B) return 0; const x = lum(A), y = lum(B); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// tonos (sobre 0-255): amarillo, rojo, verde, fucsia, teal, azul, blanco, rojo claro, gris claro
const TONO = {
  amarillo: ([r, g, b]) => r > 200 && g > 190 && b < 120,
  rojo: ([r, g, b]) => r > 200 && g < 90 && b < 90,
  verde: ([r, g, b]) => g > 190 && r < 120 && b < 140,
  fucsia: ([r, g, b]) => r > 200 && b > 170 && g < 110,
  teal: ([r, g, b]) => r < 100 && g > 140 && b > 130,
  azul: ([r, g, b]) => b > 200 && r < 130 && g < 190,
  blanco: ([r, g, b]) => r > 240 && g > 240 && b > 240,
  rojoClaro: ([r, g, b]) => r > 230 && g > 100 && g < 190 && b > 90 && b < 190,
  grisClaro: ([r, g, b]) => Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 40 && !(r > 240 && g > 240 && b > 240),
};
const es = (c, tono) => { const rgb = hex(c); return !!rgb && TONO[tono](rgb); };
const H_VISTA = { v: 'hl' };   // rev69: la vista de la hoja de juguete (sección 10)
const CHART_COL_SMA200 = () => uno(hl, /<polyline data-sma="200"[^>]*>/g).stroke;   // rev69: el fucsia con que se dibuja la 200

// ---------- el escenario: TSLA-like en Día, 250 velas (historia para las 4 medias) y niveles APRETADOS ----------
//   techo 100.32, cierre ayer 100.27, apertura 100.22 y piso 100.18 caben en ~8 px: con la v66 la etiqueta a < 9 px de la
//   anterior se escondía («cierre ayer» y «apertura» desaparecían)
const NV = { spot: 100.25, techos_hora: [{ p: 100.32, respetos: 2, edad: 5 }], pisos_hora: [{ p: 100.18, respetos: 1, edad: 9 }], cierre_ayer: 100.27, apertura_hoy: 100.22,
  ath: 102.5, atl: 97.6, ath_dias: 397 };
const TG = { target: 101.8, target_alto: 102.9, target_bajo: 98.2, fecha: '2026-10-26', fuente: 'finviz' };
const pkD = { ticker: 'AAPL', tf: 'dia', velas: velas(250, { paso: 86400, t0: T0 - 250 * 86400 }), niveles: NV };
const hl = CH.chartSvg(pkD, { vista: 'hl', h: 300, w: 400, tf: 'dia', targets: TG });
const bb = CH.chartSvg({ ...pkD, tf: 'm15', velas: velas(90) }, { vista: 'bb', h: 200, w: 400, tf: 'm15' });

// ════════════════ 1. G1 · paleta fija y lienzo oscuro ════════════════
{
  assert(/^<svg viewBox="0 0 400 300"/.test(hl), 'el gráfico se dibuja (Medias + H-lines, Día, 400×300)', hl.slice(0, 80));
  const colTema = (s) => (s.match(/(?:fill|stroke)="var\(--[^"]*\)"/g) || []);
  igual([colTema(hl), colTema(bb)], [[], []], 'ningún color del TEMA dentro del svg (en tema claro la 20 salía marrón y techo/piso negros): la paleta es fija');
  const lienzo = uno(hl, /<rect class="lienzo"[^>]*>/g);
  assert(lienzo.fill && hex(lienzo.fill) && lum(hex(lienzo.fill)) < 0.01 && lienzo.width === '400' && lienzo.height === '300', 'lienzo NEGRO (casi) que cubre todo el svg, como TC2000, en los dos temas', JSON.stringify(lienzo));
  assert(hl.indexOf('class="lienzo"') < hl.indexOf('class="ejey"'), 'el lienzo va debajo de todo (rejilla, ejes, velas)');
  // medias
  const sma = {}; ['20', '40', '100', '200'].forEach(k => { sma[k] = uno(hl, new RegExp('<polyline data-sma="' + k + '"[^>]*>', 'g')); });
  assert(es(sma['20'].stroke, 'amarillo'), 'SMA 20 AMARILLA', sma['20'].stroke);
  assert(es(sma['40'].stroke, 'rojo'), 'SMA 40 ROJA', sma['40'].stroke);
  assert(es(sma['100'].stroke, 'verde'), 'SMA 100 VERDE vivo', sma['100'].stroke);
  assert(es(sma['200'].stroke, 'fucsia'), 'SMA 200 FUCSIA (Andrés corrige el «morada»)', sma['200'].stroke);
  const w = (k) => Number(sma[k]['stroke-width']);
  assert(w('20') <= 1.3 && w('40') <= 1.3 && w('100') >= 2 && w('200') > w('100'), '20 y 40 finas, 100 gruesa, 200 la más gruesa', JSON.stringify(['20', '40', '100', '200'].map(w)));
  const ultVela = hl.lastIndexOf('<rect class="vela');
  assert(ultVela > 0 && ['20', '40', '100', '200'].every(k => hl.indexOf('data-sma="' + k + '"') > ultVela), 'las medias van ENCIMA de las velas (si no, la 20 y la 40 finas se ven a trozos entre los cuerpos)');
  // velas
  const vs = elementos(hl, /<rect class="vela[^"]*"[^>]*>/g);
  const sube = new Set(vs.map(v => v.fill).filter(c => es(c, 'verde'))), baja = new Set(vs.map(v => v.fill).filter(c => es(c, 'rojo')));
  assert(sube.size === 1 && baja.size === 1 && vs.every(v => es(v.fill, 'verde') || es(v.fill, 'rojo')), 'velas verde vivo / rojo vivo', JSON.stringify([...new Set(vs.map(v => v.fill))]));
  // H-lines
  const niv = (k) => uno(hl, new RegExp('<line data-nivel="' + k + '"[^>]*>', 'g'));
  assert(es(niv('techo').stroke, 'blanco') && es(niv('piso').stroke, 'blanco'), 'techo y piso de HORA (edge lines) BLANCOS', niv('techo').stroke + ' ' + niv('piso').stroke);
  assert(es(niv('ath').stroke, 'azul') && es(niv('atl').stroke, 'azul'), 'máx/mín del periodo AZULES', niv('ath').stroke);
  assert(es(niv('target').stroke, 'rojoClaro') && niv('target')['stroke-dasharray'], 'target de analistas ROJO CLARO discontinuo', JSON.stringify(niv('target')));
  assert(['target_alto', 'target_bajo'].every(k => es(niv(k).stroke, 'rojoClaro') && niv(k)['stroke-dasharray'] && Number(niv(k)['stroke-width']) < Number(niv('target')['stroke-width'])), 'target alto y bajo rojo claro, más finos y punteados');
  assert(es(niv('cierre_ayer').stroke, 'amarillo') && niv('cierre_ayer')['stroke-dasharray'], 'cierre de ayer AMARILLO punteado («la línea punteada en amarillo… es el precio de cierre del día anterior»)', JSON.stringify(niv('cierre_ayer')));
  assert(es(niv('apertura_hoy').stroke, 'grisClaro') && niv('apertura_hoy')['stroke-dasharray'], 'apertura de hoy gris claro punteado', JSON.stringify(niv('apertura_hoy')));
  // Bollinger
  const b = (q) => uno(bb, new RegExp('<polyline data-bb="' + q + '"[^>]*>', 'g'));
  assert(es(b('sup').stroke, 'teal') && es(b('inf').stroke, 'teal'), 'Bollinger: bandas superior e inferior TEAL', b('sup').stroke);
  assert(es(b('medio').stroke, 'amarillo'), 'y el punto medio AMARILLO (es la SMA 20)', b('medio').stroke);
  const banda = uno(bb, /<polygon data-bb="banda"[^>]*>/g);
  const rb = hex(banda.fill);
  assert(rb && Math.max(...rb) - Math.min(...rb) < 40 && Number(banda['fill-opacity']) > 0 && Number(banda['fill-opacity']) <= 0.25, 'relleno de la banda gris translúcido', JSON.stringify(banda));
  assert(bb.indexOf('data-bb="banda"') < bb.indexOf('<rect class="vela') && bb.indexOf('data-bb="medio"') > bb.lastIndexOf('<rect class="vela'), 'el relleno debajo de las velas; las líneas de la banda encima');
  // contraste de TODOS los textos sobre el lienzo (la cifra de la cajita del spot va sobre la cajita, no sobre el lienzo)
  [['Medias', hl], ['Bollinger', bb]].forEach(([q, s]) => {
    const L = (uno(s, /<rect class="lienzo"[^>]*>/g) || {}).fill;
    const fills = [...s.matchAll(/<(?:text|tspan)\b[^>]*\bfill="([^"]*)"/g)].map(m => m[1]).filter(c => c !== L);
    const malos = [...new Set(fills)].filter(c => contraste(c, L) < 4.5);
    assert(fills.length > 5 && !malos.length, q + ': todo texto sobre el lienzo con contraste ≥ 4.5', JSON.stringify(malos));
  });
}

// ════════════════ 2. G2 · etiquetas «nombre precio», TODAS, apiladas sin solaparse ════════════════
{
  const etq = elementos(hl, /<text data-etq="[^"]*"[^>]*>[^<]*<\/text>/g);
  const txt = {}; for (const m of hl.matchAll(/<text data-etq="([^"]*)"[^>]*>([^<]*)<\/text>/g)) txt[m[1]] = m[2];
  igual(['techo', 'piso', 'cierre_ayer', 'apertura_hoy'].map(k => txt[k]), ['techo hora 100.32', 'piso hora 100.18', 'cierre ayer 100.27', 'apertura hoy 100.22'],
    'con techo, piso, cierre ayer y apertura a menos de 9 px entre sí salen las CUATRO etiquetas, con nombre y precio');
  const yLinea = (k) => Number(uno(hl, new RegExp('<line data-nivel="' + k + '"[^>]*>', 'g')).y1);
  const ys4 = ['techo', 'cierre_ayer', 'apertura_hoy', 'piso'].map(yLinea);
  assert(ys4.every(Number.isFinite) && Math.max(...ys4) - Math.min(...ys4) < 9, 'de verdad sus líneas están a menos de 9 px (todas)', JSON.stringify(ys4));
  igual([txt.ath, txt.atl, txt.target, txt.target_alto, txt.target_bajo], ['máx 397 días 102.50', 'mín 397 días 97.60', 'target analistas 101.80', 'target alto 102.90', 'target bajo 98.20'],
    'máx/mín «397 días» (jamás «ATH»/«hist») y los tres target con nombre y precio (la v66 dibujaba alto y bajo SIN etiqueta)');
  const ys = etq.map(e => Number(e.y)).sort((a, b) => a - b);
  const fs = Math.max(...etq.map(e => Number((/font-size:([\d.]+)px/.exec(e.style || '') || [])[1]) || 9));
  assert(etq.length === 9 && ys.slice(1).every((y, i) => y - ys[i] >= fs), 'las 9 etiquetas separadas al menos una letra (' + fs + ' px): ninguna se monta sobre otra', JSON.stringify(ys));
  // el orden de las etiquetas es el de sus líneas (de arriba abajo), así nadie confunde cuál es cuál
  const orden = etq.slice().sort((a, b) => Number(a.y) - Number(b.y)).map(e => e['data-etq']);
  const ordenLineas = orden.slice().sort((a, b) => yLinea(a) - yLinea(b));
  igual(orden, ordenLineas, 'apiladas en el MISMO orden que sus líneas');
  // la que se aparta de su línea lleva un conector de SU color
  //   (sin moverse, la etiqueta va 3 px por encima de su línea)
  const movidas = etq.filter(e => Math.abs(Number(e.y) - (yLinea(e['data-etq']) - 3)) > 1.5);
  const con = elementos(hl, /<polyline data-conector="[^"]*"[^>]*>/g);
  assert(movidas.length >= 2 && movidas.every(e => con.some(c => c['data-conector'] === e['data-etq'] && c.stroke === e.fill)), 'cada etiqueta apartada de su línea lleva un conector del color de la línea', JSON.stringify(movidas.map(e => e['data-etq'])));
  // a la izquierda, lejos del eje de precios y de la cajita del spot; y debajo de la leyenda
  assert(etq.every(e => e['text-anchor'] === 'start' && Number(e.x) < 40), 'a la IZQUIERDA (la derecha es del eje y de la cajita del spot)');
  const ley = uno(hl, /<text data-leyenda="1"[^>]*>/g);
  assert(ley.y && ys[0] - fs >= Number(ley.y), 'ninguna etiqueta sube a la franja de la leyenda', ys[0] + ' vs leyenda ' + ley.y);
  // cada etiqueta sobre su cajita del lienzo (las líneas vecinas no le pasan por los huecos), sin montarse y sin tapar SU línea
  const fondos = elementos(hl, /<rect data-fondo-etq="[^"]*"[^>]*>/g);
  const fondoDe = (k) => fondos.find(f => f['data-fondo-etq'] === k) || {};
  assert(fondos.length === etq.length && etq.every(e => { const f = fondoDe(e['data-etq']); return Number(f.y) < Number(e.y) && Number(f.y) + Number(f.height) <= Number(e.y) + fs * 0.3 && Number(f.x) <= Number(e.x); }), 'cada etiqueta lleva su cajita de fondo detrás');
  const fy = fondos.map(f => [Number(f.y), Number(f.y) + Number(f.height)]).sort((a, b) => a[0] - b[0]);
  assert(fy.slice(1).every((f, i) => f[0] >= fy[i][1]), 'las cajitas no se montan entre sí', JSON.stringify(fy));
  assert(etq.filter(e => !movidas.includes(e)).every(e => { const f = fondoDe(e['data-etq']); return Number(f.y) + Number(f.height) < yLinea(e['data-etq']); }), 'y la cajita de una etiqueta en su sitio acaba ENCIMA de su línea (la línea se sigue viendo)');
  assert(hl.indexOf('data-fondo-etq') > hl.lastIndexOf('<line data-nivel=') && hl.indexOf('data-fondo-etq="techo"') < hl.indexOf('data-etq="techo"'), 'las cajitas van sobre las líneas y debajo de su texto');
  // cada etiqueta en el color de su línea
  assert(etq.every(e => e.fill === uno(hl, new RegExp('<line data-nivel="' + e['data-etq'] + '"[^>]*>', 'g')).stroke), 'cada etiqueta en el color de SU línea');
  // si de verdad no caben todas (un gráfico bajito con muchas líneas), se quedan las más importantes y la LEYENDA lo dice
  const muchas = Array.from({ length: 10 }, (_, i) => ({ v: 99.2 + i * 0.18, c: '#8CFFB5', lb: 'strike ' + i, k: 'strike', dash: '9 3 2 3' }));
  const bajo = CH.chartSvg({ ...pkD, tf: 'm15', velas: velas(90) }, { vista: 'bb', h: 120, w: 400, tf: 'm15', hlines: true, extra: muchas });
  const nLin = (bajo.match(/<line data-nivel=/g) || []).length, nEtq = (bajo.match(/<text data-etq=/g) || []).length;
  const nota = (/<tspan data-ley="sin-sitio"[^>]*>([^<]*)<\/tspan>/.exec(bajo) || [])[1] || '';
  assert(nEtq < nLin && nota === '+' + (nLin - nEtq) + ' líneas sin etiqueta', 'gráfico bajito con ' + nLin + ' líneas: salen ' + nEtq + ' etiquetas y la leyenda dice «' + nota + '»', nLin + '/' + nEtq + ' ' + nota);
  const ysB = elementos(bajo, /<text data-etq="[^"]*"[^>]*>/g).map(e => Number(e.y)).sort((a, b) => a - b);
  assert(ysB.slice(1).every((y, i) => y - ysB[i] >= 9), 'y las que salen tampoco se montan', JSON.stringify(ysB));
  igual(elementos(bajo, /<text data-etq="[^"]*"[^>]*>/g).map(e => e['data-etq']).filter(k => k !== 'strike'), [], 'con sitio para 7, los 7 son strikes: tus posiciones van primero en la prioridad');
  // un rango de target invertido (bajo > alto) no se dibuja: la regla v66 A2
  const inv = CH.chartSvg(pkD, { vista: 'hl', h: 300, w: 400, tf: 'dia', targets: { target: 101.8, target_alto: 98.2, target_bajo: 102.9 } });
  assert(/data-nivel="target"/.test(inv) && !/data-nivel="target_alto"/.test(inv) && !/data-nivel="target_bajo"/.test(inv), 'target alto/bajo invertidos: no se dibujan (jamás un rango invertido); el target sí');
}

// ════════════════ 3. G2 · leyenda «como TC2000» y aria-label ════════════════
{
  const tsp = (s) => [...s.matchAll(/<tspan data-ley="([^"]*)"[^>]*fill="([^"]*)"[^>]*>([^<]*)<\/tspan>/g)].map(m => ({ k: m[1], c: m[2], t: m[3] }));
  const L = tsp(hl);
  const de = (k) => L.find(x => x.k === k) || {};
  assert(/^AAPL · Día$/.test(de('cab').t || ''), 'arriba a la izquierda: «AAPL · Día»', JSON.stringify(L));
  ['20', '40', '100', '200'].forEach(k => {
    const st = uno(hl, new RegExp('<polyline data-sma="' + k + '"[^>]*>', 'g')).stroke;
    assert(new RegExp('^Avg ' + k + '\\b').test(de(k).t || '') && de(k).c === st, '«Avg ' + k + '» escrito en el color de SU línea', JSON.stringify(de(k)) + ' vs ' + st);
  });
  // en grande (720) caben los valores: el de la última vela dibujada
  const g = CH.chartSvg(pkD, { vista: 'hl', h: 320, w: 720, tf: 'dia', targets: TG });
  const cierres = pkD.velas.map(v => v[4]);
  const s20 = CH.smaApp(cierres, 20), ult20 = s20[s20.length - 1];
  const g20 = (tsp(g).find(x => x.k === '20') || {}).t || '';
  igual(g20, 'Avg 20 ' + ult20.toFixed(2), 'en grande, «Avg 20 <valor de la última vela>» (como TC2000)');
  // sin historia: «Avg 200 —» tenue y JAMÁS nombrada como si estuviera
  const corto = CH.chartSvg({ ...pkD, velas: velas(60, { paso: 86400, t0: T0 - 60 * 86400 }) }, { vista: 'hl', h: 300, w: 400, tf: 'dia' });
  const Lc = tsp(corto);
  const c200 = Lc.find(x => x.k === '200') || {}, c100 = Lc.find(x => x.k === '100') || {}, c20 = Lc.find(x => x.k === '20') || {};
  assert(!/data-sma="200"/.test(corto) && !/data-sma="100"/.test(corto) && /data-sma="20"/.test(corto), 'con 60 velas diarias no hay SMA 100/200 dibujadas (sí la 20)');
  assert(/—/.test(c200.t || '') && /—/.test(c100.t || '') && c200.c !== uno(hl, /<polyline data-sma="200"[^>]*>/g).stroke && !/—/.test(c20.t || '-'), 'la leyenda las dice «Avg 100 —» / «Avg 200 —» en tenue (no en su color)', JSON.stringify(Lc));
  // Bollinger
  const Lb = tsp(bb);
  const lb = Lb.find(x => x.k === 'bb') || {}, lm = Lb.find(x => x.k === 'bb-medio') || {};
  assert(/^Bollinger Bands 20 2$/.test(lb.t || '') && lb.c === uno(bb, /<polyline data-bb="sup"[^>]*>/g).stroke, '«Bollinger Bands 20 2» en el teal de las bandas', JSON.stringify(Lb));
  assert(/^Moving Average 20/.test(lm.t || '') && lm.c === uno(bb, /<polyline data-bb="medio"[^>]*>/g).stroke, '«Moving Average 20» en el amarillo del punto medio');
  assert(!Lb.some(x => /^Avg /.test(x.t)), 'en la ventana Bollinger no se nombran medias que no están');
  // el mini del Informe (380 de ancho, solo las velas de hoy): leyenda compacta, sin el prefijo y SIN pisar velas
  const pk15 = { ticker: 'AAPL', tf: 'm15', velas: velas(90), niveles: { cierre_ayer: 99.5, apertura_hoy: 100.2, spot: 100.4 } };
  const mini = CH.chartSvg(pk15, { vista: 'bb', h: 132, w: 380, tf: 'm15', ventana: { start: 78, end: 90 }, leyenda: 'compacta' });
  const Lm = tsp(mini), lyM = uno(mini, /<text data-leyenda="1"[^>]*>/g);
  assert(Lm.length >= 1 && !Lm.some(x => x.k === 'cab') && Lm.some(x => /Bollinger|BB/.test(x.t)), 'mini del Informe: leyenda compacta (sin «AAPL · 15 min»: la cabecera de la tarjeta ya lo dice)', JSON.stringify(Lm));
  const topVelas = Math.min(...elementos(mini, /<rect class="vela[^"]*"[^>]*>/g).map(v => Number(v.y)));
  const fsM = Number((/font-size:([\d.]+)px/.exec(lyM.style || '') || [])[1]) || 9;
  assert(Number(lyM.y) + fsM * 0.3 < topVelas, 'y la leyenda no pisa ninguna vela (va en su franja, encima)', lyM.y + ' vs ' + topVelas);
  // rev69: en el mini las etiquetas de las dos líneas nativas van EN LA LEYENDA (sobre el área tapaban las velas de la apertura)
  const eM = (k) => Lm.find(x => x.k === 'etq-' + k) || {};
  const nM = (k) => uno(mini, new RegExp('<line data-nivel="' + k + '"[^>]*>', 'g'));
  assert(eM('cierre_ayer').t === 'cierre ayer 99.50' && eM('apertura_hoy').t === 'apertura hoy 100.20' && eM('cierre_ayer').c === nM('cierre_ayer').stroke && eM('apertura_hoy').c === nM('apertura_hoy').stroke,
    'y en el mini salen las dos etiquetas nativas, con su precio, en la leyenda y en el color de su línea', JSON.stringify(Lm));
  // aria-label: nombra las líneas dibujadas
  const aria = (/aria-label="([^"]*)"/.exec(hl) || [])[1] || '';
  assert(['SMA 20', 'SMA 200', 'techo hora 100.32', 'piso hora 100.18', 'cierre ayer 100.27', 'apertura hoy 100.22', 'máx 397 días 102.50', 'target analistas 101.80'].every(t => aria.includes(t)),
    'el aria-label nombra las medias y las H-lines dibujadas', aria);
  assert(/SMA 200 sin historia/.test((/aria-label="([^"]*)"/.exec(corto) || [])[1] || ''), 'y dice qué media no tiene historia');
}

// ════════════════ 4. G2 · lista H-LINES de la hoja: mismas muestras, mismos nombres, por precio ════════════════
{
  const h = CH.hlinesLista(pkD, TG, 2);
  const filas = [...h.matchAll(/<div class="hl" data-hl="([^"]*)"><span><i class="chsw"[^>]*style="color:([^;"]*)[^"]*"[^>]*><\/i>([^<]*)<\/span>/g)].map(m => ({ k: m[1], c: m[2], t: m[3] }));
  const etq = {}; for (const m of hl.matchAll(/<text data-etq="([^"]*)"[^>]*fill="([^"]*)"[^>]*>([^<]*)<\/text>/g)) etq[m[1]] = { c: m[2], t: m[3] };
  igual(filas.map(f => f.k).sort(), Object.keys(etq).sort(), 'la lista lleva las MISMAS H-lines que el gráfico');
  assert(filas.length === 9 && filas.every(f => etq[f.k] && f.t === etq[f.k].t && f.c === etq[f.k].c), 'con el MISMO nombre «nombre precio» y la MISMA muestra de color que el gráfico', JSON.stringify(filas.filter(f => !etq[f.k] || f.t !== etq[f.k].t || f.c !== etq[f.k].c)));
  const precio = (f) => Number(/([\d.]+)$/.exec(f.t)[1]);
  assert(filas.slice(1).every((f, i) => precio(f) <= precio(filas[i])), 'de ARRIBA ABAJO por precio', JSON.stringify(filas.map(precio)));
  assert(/data-trazo="puntos"/.test(h) && /data-trazo="guiones"/.test(h), 'las muestras llevan el trazo (punteado / discontinuo) de su línea');
  const iSpot = h.indexOf('data-hl="spot"');
  assert(iSpot > h.indexOf('data-hl="cierre_ayer"') && iSpot < h.indexOf('data-hl="apertura_hoy"') && /precio 100\.25/.test(h), 'el precio actual en su sitio (entre cierre ayer 100.27 y apertura 100.22)');
  assert(/target_alto"[\s\S]*?el más optimista/.test(h) && /target_bajo"[\s\S]*?el más pesimista/.test(h), 'target alto y bajo dicen qué son');
  // la que el gráfico NO dibujó (lejos del precio: se omite para no aplastar las velas) la lista lo dice
  const lejos = CH.chartSvg({ ...pkD, niveles: { ...NV, ath: 1000 } }, { vista: 'hl', h: 300, w: 400, tf: 'dia', targets: TG });
  const dib = [...lejos.matchAll(/data-nivel="([^"]*)"/g)].map(m => m[1]);
  const hL = CH.hlinesLista({ ...pkD, niveles: { ...NV, ath: 1000 } }, TG, 2, dib);
  assert(!dib.includes('ath') && /data-hl="ath"><span>[^]*?<\/span><span class="fresco">lejos del precio: fuera de este gráfico/.test(hL) && /class="hl fuera" data-hl="ath"/.test(hL), 'un nivel que el gráfico no dibujó: «lejos del precio: fuera de este gráfico»');
  assert((hL.match(/class="hl fuera"/g) || []).length === 1 && !/fuera de este gráfico/.test(h), 'solo ese; y sin la lista de dibujadas no se marca nada');
}

// ════════════════ 5. G1 · strikes del gestor: legibles sobre el lienzo y distintos de las edge lines ════════════════
{
  const SPY = { id: 1, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'CALL', strike: 770, expiracion: '2026-10-02', contratos: 2, prima_fill: 3.30, gtc_limite: 3.65, plan_pct: 10, stop_pct: 20,
    mark: 4.18, mark_at: new Date().toISOString(), mfe: 5.00, mae: 3.10, modo_salida: 'trailing', trail_pct: 20, arm_pct: 0, protege_costo: false, target_pct: null, activo: true, nivel_trailing: 4.0 };
  const L = construir(['nivelesPosicionesChart', 'reglaGestor', 'acotarGestor', 'nivelGestor', 'markGestor', 'gtcDePosicion', 'gtcLimite', 'planDePct', 'corteDe', 'fmtPrima'],
    { PLAN_PCT: 35, PLANES: { PLAN_35: { gtcPct: 35 }, PLAN_10: { gtcPct: 10 } } }, { consts: ['GESTOR_DEF', 'GESTOR_RANGOS', 'GCH_COLORES'].concat(CONST_V67) });
  const call = L.nivelesPosicionesChart([SPY], 'SPY', 2).lineas[0] || {};
  const put = L.nivelesPosicionesChart([{ ...SPY, direccion: 'PUT' }], 'SPY', 2).lineas[0] || {};
  const lienzo = uno(hl, /<rect class="lienzo"[^>]*>/g).fill;
  assert([call.c, put.c].every(c => contraste(c, lienzo) >= 4.5), 'CALL y PUT con un color legible sobre el lienzo oscuro (nada de var(--verde) del tema claro)', call.c + ' / ' + put.c);
  assert(call.c !== put.c && ![call.c, put.c].some(c => es(c, 'blanco')) && call.dash && put.dash, 'distintos entre sí, NO blancos (el blanco es edge line) y con trazo propio', JSON.stringify([call.c, call.dash, put.c, put.dash]));
  const pkG = { ticker: 'SPY', tf: 'm5', velas: velas(120, { paso: 300, base: 770 }), niveles: { spot: 770.3, techos_hora: [{ p: 771.2 }], pisos_hora: [{ p: 769.4 }] } };
  const g = CH.chartSvg(pkG, { vista: 'bb', tf: 'm5', h: 372, w: 1100, hlines: true, extra: [call] });
  const ls = uno(g, /<line data-nivel="strike"[^>]*>/g), lt = uno(g, /<line data-nivel="techo"[^>]*>/g);
  assert(ls.stroke === call.c && ls['stroke-dasharray'] && ls.stroke !== lt.stroke && /<text data-etq="strike"[^>]*>770\.00 CALL ×2/.test(g), 'en el gráfico del gestor el strike sale en su color, raya-punto y con su etiqueta; el techo sigue blanco', JSON.stringify([ls, lt.stroke]));
}

// ════════════════ 6. G2 · editor de target: qué son alto y bajo ════════════════
{
  let html = '';
  const E = construir(['abrirChart'], {
    TICKERS: ['AAPL'], cerrarChart() {}, chartPrefs: () => ({ vista: 'hl', tf: 'dia' }), _targets: { por: { AAPL: TG } }, CHART_INDICES: ['SPY'], esc,
    chartSelectores: () => '', planActivo: () => ({ gtcPct: 10 }), hoyNY: () => '2026-11-02', $: () => null, setInterval: () => 0, cargarChart() {},
    document: { createElement: () => { const n = nodo(); Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; }, body: { appendChild() {} } },
  }, { prefijo: 'let _ch = null;' });
  E.abrirChart('AAPL');
  assert(/<label[^>]*>Target alto \(el más optimista\)<\/label><input id="tgA"/.test(html) && /<label[^>]*>Target bajo \(el más pesimista\)<\/label><input id="tgB"/.test(html), 'los campos se llaman «Target alto (el más optimista)» y «Target bajo (el más pesimista)»');
  assert(/consenso \(el promedio\) de los precios objetivo de los analistas/.test(html) && /el precio objetivo más optimista y el más pesimista/.test(html), 'y una línea explica: Target = consenso (promedio); alto y bajo = los extremos');
  assert(/value="102\.9"/.test(html) && /value="98\.2"/.test(html), 'los campos siguen rellenos con lo guardado');
}

// ════════════════ rev69 · arreglos del juez del frente gráfico (cada bloque FALLA sin su arreglo) ════════════════
// 7. la doctrina escrita en main.js dice la 200 FUCSIA (Andrés corrige el «morada»): una sola doctrina en el archivo
{
  const doctrina = (C.FUENTE.match(/\/\/ \(SMA 20 amarilla fina[^\n]*/) || [''])[0];
  assert(/200 fucsia/.test(doctrina) && !/200 morada/.test(C.FUENTE), 'la doctrina de la cabecera de Charts dice «200 fucsia» y ya no queda ningún «200 morada» en main.js', doctrina);
}

// 8. una media DIBUJADA pero fuera de la escala (la escala solo se estira por las medias a ±35 %): la leyenda y el aria-label
//    no la nombran como si se viera (juez rev69: «Avg 200» en fucsia con 0 de 61 puntos dentro del área de velas)
{
  const T1 = Math.floor(Date.parse('2026-08-03T13:30:00Z') / 1000), vs = [];
  for (let i = 0; i < 260; i++) {   // AAPL de Hora: sube fuerte y luego se queda plana (la SMA 200 queda muy por debajo)
    const o = i < 170 ? 300 + i * 0.6 : 402 + Math.sin(i / 4) * 1.5, c = o + Math.cos(i / 3) * 0.8;
    vs.push([T1 + i * 3600, +o.toFixed(2), +(Math.max(o, c) + .4).toFixed(2), +(Math.min(o, c) - .4).toFixed(2), +c.toFixed(2), 1000]);
  }
  const pkH = { ticker: 'AAPL', tf: 'hora', velas: vs, niveles: { spot: vs[vs.length - 1][4] } };
  const tspans = (s) => [...s.matchAll(/<tspan data-ley="([^"]*)"([^>]*)>([^<]*)<\/tspan>/g)].map(m => ({ k: m[1], a: atributos(m[2]), t: m[3] }));
  [[400, 300], [720, 320]].forEach(([w, h]) => {
    const s = CH.chartSvg(pkH, { vista: 'hl', tf: 'hora', h, w, dec: 2 });
    const clip = uno(s, /<clipPath[^>]*><rect[^>]*>/g), y0 = Number(clip.y), y1 = y0 + Number(clip.height);
    const dentro = (k) => { const m = new RegExp('<polyline data-sma="' + k + '" points="([^"]*)"').exec(s); return m ? m[1].trim().split(' ').map(p => Number(p.split(',')[1])).filter(y => y >= y0 && y <= y1).length : -1; };
    assert(dentro('200') === 0 && dentro('20') > 0, w + ' px: de verdad la SMA 200 se dibuja (data-sma) con 0 puntos dentro del área de velas y la 20 sí se ve', dentro('200') + ' / ' + dentro('20'));
    const L = tspans(s), l200 = L.find(x => x.k === '200') || { a: {} }, l20 = L.find(x => x.k === '20') || { a: {} };
    assert(l200.a.fill !== CHART_COL_SMA200() && l200.a['data-fuera'] === '1' && /^Avg 200( [\d.]+)? ↓ fuera$/.test(l200.t), w + ' px: la leyenda dice «Avg 200 … ↓ fuera» en tenue (no en fucsia como si estuviera)', JSON.stringify(l200));
    assert(l20.a.fill === uno(s, /<polyline data-sma="20"[^>]*>/g).stroke && !l20.a['data-fuera'], 'y la 20, que sí se ve, sigue en su color', JSON.stringify(l20));
    const aria = (/aria-label="([^"]*)"/.exec(s) || [])[1] || '';
    assert(/SMA 200 fuera del gráfico \(por debajo\)/.test(aria) && /SMA 20, /.test(aria), w + ' px: el aria-label dice «SMA 200 fuera del gráfico (por debajo)»', aria);
  });
  // con una media dentro de la escala nada cambia (el escenario de siempre: las 4 en su color)
  assert(!/data-fuera/.test(hl), 'con las cuatro medias a la vista, ninguna se marca fuera');
}

// 9. el mini del Informe: las etiquetas de «apertura hoy» y «cierre ayer» NO tapan las velas de la apertura (su ventana empieza
//    en la primera vela de HOY; con 3 velas cada una ocupa ~80 px). Juez rev69: «apertura_hoy: tapa 55 % del cuerpo de la vela 1»
{
  const ayer0 = Math.floor(Date.parse('2026-10-30T13:30:00Z') / 1000), hoy0 = Math.floor(Date.parse('2026-11-02T14:30:00Z') / 1000), vs = [];
  for (let i = 0; i < 26; i++) { const o = 100 + Math.sin(i / 3) * .3, c = o + Math.cos(i / 4) * .2; vs.push([ayer0 + i * 900, +o.toFixed(2), +(Math.max(o, c) + .1).toFixed(2), +(Math.min(o, c) - .1).toFixed(2), +c.toFixed(2), 1000]); }
  vs.push([hoy0, 101.00, 101.70, 100.90, 101.60, 5000], [hoy0 + 900, 101.60, 101.90, 101.20, 101.30, 4000], [hoy0 + 1800, 101.30, 101.80, 101.25, 101.75, 4000]);
  const pk = { ticker: 'AAPL', tf: 'm15', velas: vs, niveles: { spot: 101.75, cierre_ayer: vs[25][4], apertura_hoy: 101.00 } };
  const mini = CH.chartSvg(pk, { h: 132, w: 380, tf: 'm15', vista: 'bb', ventana: { start: 26, end: vs.length }, dec: 2, leyenda: 'compacta' });
  const caja = (e) => ({ x: Number(e.x), y: Number(e.y), w: Number(e.width), h: Number(e.height) });
  const velasM = elementos(mini, /<rect class="vela[^"]*"[^>]*>/g).map(caja);
  // todo lo escrito dentro del área de velas: cajitas de etiqueta y textos de etiqueta (a ~0.61 em por carácter)
  const fsM = 9;
  const tapas = elementos(mini, /<rect data-fondo-etq="[^"]*"[^>]*>/g).map(caja)
    .concat([...mini.matchAll(/<text data-etq="[^"]*"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) - fsM * 0.8, w: m[3].length * fsM * 0.61, h: fsM })));
  const pisa = tapas.some(t => velasM.some(b => Math.min(t.x + t.w, b.x + b.w) > Math.max(t.x, b.x) && Math.min(t.y + t.h, b.y + b.h) > Math.max(t.y, b.y)));
  assert(velasM.length === 3 && !pisa, 'mini a las 10:15 (3 velas de hoy, apertura con hueco): ninguna etiqueta ni cajita pisa una vela', JSON.stringify(tapas));
  const Lm = [...mini.matchAll(/<tspan data-ley="([^"]*)"[^>]*fill="([^"]*)"[^>]*>([^<]*)<\/tspan>/g)].map(m => ({ k: m[1], c: m[2], t: m[3] }));
  igual(Lm.filter(x => /^etq-/.test(x.k)).map(x => x.t), ['apertura hoy 101.00', 'cierre ayer ' + vs[25][4].toFixed(2)], 'las dos van en la leyenda, con nombre y precio, de arriba abajo por precio');
  const lyM = uno(mini, /<text data-leyenda="1"[^>]*>/g);
  assert(Number(lyM.y) + fsM * 0.3 < Math.min(...velasM.map(b => b.y)), 'y la leyenda va en su franja, encima de las velas');
  // en un mini estrecho no caben: salen las que caben y la leyenda dice cuántas faltan (nunca se esconden en silencio)
  const pk4 = { ...pk, velas: vs.map(r => [r[0], r[1] * 100, r[2] * 100, r[3] * 100, r[4] * 100, r[5]]), niveles: { spot: 10175, cierre_ayer: vs[25][4] * 100, apertura_hoy: 10100 } };
  const est = CH.chartSvg(pk4, { h: 132, w: 320, tf: 'm15', vista: 'bb', ventana: { start: 26, end: vs.length }, dec: 2, leyenda: 'compacta' });
  const Le = [...est.matchAll(/<tspan data-ley="([^"]*)"[^>]*>([^<]*)<\/tspan>/g)].map(m => ({ k: m[1], t: m[2] }));
  const nEtq = Le.filter(x => /^etq-/.test(x.k)).length, nota = (Le.find(x => x.k === 'sin-sitio') || {}).t || '';
  assert(nEtq < 2 && nota === '+' + (2 - nEtq) + ' ' + (2 - nEtq > 1 ? 'líneas' : 'línea') + ' sin etiqueta' && !/data-etq=/.test(est), 'mini estrecho (320) con precios de 5 cifras: la leyenda lleva las que caben y dice «' + nota + '»', JSON.stringify(Le));
  // fuera del mini, nada cambia: las etiquetas siguen en el área, a la izquierda (sección 2)
  assert(!/data-ley="etq-/.test(hl) && (hl.match(/data-etq=/g) || []).length === 9, 'en la hoja y las tarjetas las etiquetas siguen junto a sus líneas (solo el mini las lleva a la leyenda)');
}

// 10. la hoja del gráfico (pintarChart, con sus nodos de juguete): la lista H-LINES recibe las líneas que el gráfico de al
//     lado DIBUJÓ (si no, la marca «fuera de este gráfico» queda desconectada) y, SIN gráfico (el aviso «Sin velas
//     todavía…»), no marca ninguna (el juez vio las 6 de 6 «lejos del precio» con una sola vela)
{
  const nodos = {};
  const H = construir(['pintarChart', 'chartSvg', 'bollingerApp', 'smaApp', 'serieExtM', 'mediasExtM', 'techoPisoProximos', 'chartTiempo', 'hlinesLista', 'rangoValido', 'fmtFechaNY'].concat(AUX_V67, opc(['nivelesDibujados'])),
    { esc, haceCuanto, _ch: { sym: 'AAPL' }, $: (q) => (nodos[q] = nodos[q] || nodo()), chartPrefs: () => ({ vista: H_VISTA.v, tf: 'dia', ext: false }), _velas: new Map(), _targets: { por: {} },
      chartSelectores: () => '', chartFrescoTxt: () => '', anchoVista: () => 375, GESTOR_ANCHO_TABLA: 900, lecturaChart: () => '', document: { activeElement: null } },
    { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'].concat(CONST_V67) });
  const lista = () => (nodos['#chHlines'] || {}).innerHTML || '';
  const pkLejos = { ...pkD, niveles: { ...NV, ath: 1000 } };
  H_VISTA.v = 'hl'; H.pintarChart({ payload: pkLejos }, TG);
  assert(/<svg/.test(nodos['#chSvg'].innerHTML) && /class="hl fuera" data-hl="ath"/.test(lista()) && (lista().match(/class="hl fuera"/g) || []).length === 1,
    'Medias + H-lines: la lista de la hoja marca «fuera de este gráfico» SOLO la línea que el gráfico no dibujó (máx a 1000)', (lista().match(/class="hl[^"]*" data-hl="[^"]*"/g) || []).join(' '));
  H.pintarChart({ payload: { ...pkD, velas: pkD.velas.slice(-1) } }, TG);
  assert(/Sin velas todavía/.test(nodos['#chSvg'].innerHTML) && /data-hl="techo"/.test(lista()) && !/hl fuera/.test(lista()) && !/fuera de este gráfico/.test(lista()),
    'con UNA vela (no hay gráfico, solo el aviso) la lista sigue con sus líneas y no marca NINGUNA «lejos del precio»', (lista().match(/class="hl[^"]*" data-hl="[^"]*"/g) || []).join(' '));
  H.pintarChart({ payload: { ...pkD, velas: pkD.velas.slice(0, 3).concat([[1, 2]]) } }, TG);
  assert(/Sin velas todavía/.test(nodos['#chSvg'].innerHTML) && !/hl fuera/.test(lista()), 'tampoco con una fila de vela mal formada');
  H_VISTA.v = 'bb'; H.pintarChart({ payload: pkLejos }, TG);
  // v68 B (spec70): en Bollinger el gráfico no dibuja las H-lines Sardiñas y la lista YA lo dice («no sale en Bollinger»);
  // la v67 no marcaba nada y la lista enseñaba techo, piso y targets como si estuvieran (test_v68_chart.js lo prueba entero)
  assert(/class="hl fuera" data-hl="techo"/.test(lista()) && /no sale en Bollinger/.test(lista()) && !/class="hl fuera" data-hl="cierre_ayer"/.test(lista()),
    'v68: en la vista Bollinger la lista marca lo que ese gráfico no dibuja («no sale en Bollinger»), no las nativas dibujadas');
}

// 11. la leyenda del gestor (Copiloto, 5 min, 4 h): marca «fuera de este gráfico» los strikes y las H-lines que el svg NO
//     dibujó (juez rev69: con la escala estrecha, «405.00 CALL ×1», «máx 397 días…» y los targets salían como si
//     estuvieran) y lleva las H-lines de ARRIBA ABAJO por precio
{
  const nodos = {};
  const _gch = { sym: 'TSLA', tf: 'm5', tfReal: 'm5', rango: 240, bb: true, view: { count: null, end: null }, pos: [], fila: null, niveles15: null, pintado: null };
  const vsG = velas(120, { paso: 300, base: 396, amp: 1 });
  const nvG = { spot: 396.5, cierre_ayer: 396.1, apertura_hoy: 396.9, techos_hora: [{ p: 397.6 }], pisos_hora: [{ p: 395.2 }], ath: 432, atl: 296, ath_dias: 397 };
  const tgG = { target: 412, target_alto: 426, target_bajo: 381 };
  _gch.fila = { payload: { ticker: 'TSLA', tf: 'm5', velas: vsG, niveles: nvG } };
  const STR = (v, put) => ({ v, c: put ? '#FFA94D' : '#8CFFB5', lb: v.toFixed(2) + (put ? ' PUT' : ' CALL') + ' ×1', k: 'strike', w: 1.6, op: .95, dash: '9 3 2 3', trazo: 'rayaPunto' });
  const strikes = [STR(395.5, true), STR(405, false)];
  const leyendaPos = strikes.map(l => ({ c: l.c, txt: l.lb, k: 'strike', trazo: 'rayaPunto', v: l.v })).concat([{ c: '#f5c542', txt: 'GTC $3.65', prima: true, k: 'gtc' }]);
  const G = construir(['pintarChartGestor', 'gchVentana', 'chartSvg', 'bollingerApp', 'smaApp', 'serieExtM', 'mediasExtM', 'techoPisoProximos', 'chartTiempo', 'rangoValido'].concat(AUX_V67, opc(['leyendaGestorHtml', 'nivelesDibujados'])),
    { esc, haceCuanto, _gch, _targets: { por: { TSLA: tgG } }, anchoVista: () => 375, chartFrescoTxt: () => '', nivelesPosicionesChart: () => ({ lineas: strikes, leyenda: leyendaPos }),
      $: (q) => (nodos[q] = nodos[q] || nodo({ clientWidth: 375 })) },
    { consts: ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol', 'GESTOR_ANCHO_TABLA', 'GCH_TFS', 'GCH_ALTO_MAC', 'GCH_ALTO_IPHONE', 'gchTfDef'].concat(CONST_V67) });
  G.pintarChartGestor();
  const svgG = nodos['#gchSvg'].innerHTML, legG = nodos['#gchLeg'].innerHTML;
  const dib = [...svgG.matchAll(/<line data-nivel="([^"]*)"[^>]*>/g)].map(m => m[1] + (/data-v="([^"]*)"/.exec(m[0]) || [])[1]);
  const items = [...legG.matchAll(/<span data-ley="([^"]*)"( class="fuera")?>[^]*?<\/i>([^<]*)(?: <small class="fresco">([^<]*)<\/small>)?<\/span>/g)].map(m => ({ k: m[1], fuera: !!m[2], t: m[3], nota: m[4] || '' }));
  const de = (t) => items.find(x => x.t === t) || {};
  assert(dib.includes('strike395.5') && !dib.includes('strike405') && !dib.some(d => /^(ath|atl|target)/.test(d)), 'de verdad el gráfico (4 h en 5 min) dibuja el PUT 395.5 y NO el CALL 405, ni el máx/mín ni los targets', JSON.stringify(dib));
  assert(!de('395.50 PUT ×1').fuera && de('405.00 CALL ×1').fuera && de('405.00 CALL ×1').nota === 'fuera de este gráfico', 'la leyenda marca «fuera de este gráfico» el strike que no se dibujó (405 CALL) y NO el que sí (395.5 PUT)', JSON.stringify(items.filter(x => x.k === 'strike')));
  const lejos = ['máx 397 días 432.00', 'target alto 426.00', 'target analistas 412.00', 'target bajo 381.00', 'mín 397 días 296.00'];
  assert(lejos.every(t => de(t).fuera && de(t).nota === 'fuera de este gráfico'), 'y las H-lines lejanas (máx/mín, los tres targets), también', JSON.stringify(items.filter(x => !x.fuera).map(x => x.t)));
  assert(['techo hora 397.60', 'apertura hoy 396.90', 'cierre ayer 396.10', 'piso hora 395.20'].every(t => de(t).k && !de(t).fuera) && de('Bollinger Bands 20 2').k === 'bb' && !de('Bollinger Bands 20 2').fuera,
    'las que SÍ se ven (techo, apertura, cierre, piso) y la Bollinger, sin marca', JSON.stringify(items));
  assert(/GTC \$3\.65/.test(legG) && !/class="prima"[^>]*class="fuera"|fuera[^<]*GTC/.test(legG), 'las primas (no van sobre el precio) nunca se marcan');
  // de ARRIBA ABAJO por precio (las H-lines; los strikes, delante, con las primas)
  const precios = items.filter(x => !['bb', 'strike'].includes(x.k)).map(x => Number(/([\d.]+)$/.exec(x.t)[1]));
  assert(precios.length === 9 && precios.slice(1).every((p, i) => p <= precios[i]), 'las H-lines de la leyenda van de arriba abajo por precio (como el gráfico y la lista H-LINES)', JSON.stringify(precios));
  // sin gráfico (una vela) no hay nada «fuera»
  _gch.fila = { payload: { ticker: 'TSLA', tf: 'm5', velas: vsG.slice(-1), niveles: nvG } }; G.pintarChartGestor();
  assert(!/class="fuera"/.test(nodos['#gchLeg'].innerHTML), 'sin velas para dibujar, la leyenda no marca nada «fuera»');
}

// 12. la lista H-LINES cabe a 375 px (iPhone): el subtítulo largo («lejos del precio: fuera de este gráfico · el más optimista
//     de los analistas», ~345 px) no puede ir en una sola línea sin partir: con nowrap la hoja ganaba scroll lateral (412 vs
//     373) y el nombre quedaba en «target / alto / 250.00». El nombre nunca se parte; el subtítulo baja y se parte.
//     (La medida en el navegador va en rev69; aquí, las reglas de index.html que lo garantizan.)
{
  const fsx = require('fs');   // el index.html al lado del main.js probado (../index.html) o, si no hay, el de este árbol
  const cssRuta = [path.join(path.dirname(path.resolve(process.argv[2])), '..', 'index.html'), path.join(__dirname, '..', 'index.html')].find(r => fsx.existsSync(r));
  const css = cssRuta ? fsx.readFileSync(cssRuta, 'utf8') : '';
  const regla = (sel) => { const m = new RegExp('(?:^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css); return m ? m[1] : null; };
  const hlR = regla('.hl') || '', fr = regla('.hl .fresco') || '', nom = regla('.hl>span:first-child') || '';
  assert(!/white-space:\s*nowrap/.test(fr) && /min-width:\s*0/.test(fr), 'el subtítulo de una fila H-LINES se puede partir (sin nowrap) y encoger', fr);
  assert(/flex-wrap:\s*wrap/.test(hlR) && /margin-left:\s*auto/.test(fr), 'si no cabe al lado del nombre, baja a su propia fila, a la derecha', hlR);
  assert(/white-space:\s*nowrap/.test(nom), 'y el nombre de la línea («target alto 250.00») nunca se parte en columna', nom);
}

// 13. el apilado con las líneas PEGADAS AL EJE DE ABAJO: la pasada hacia arriba las sube (sin ella, las etiquetas bajaban
//     hasta y≈199 en un svg de 200, por debajo del eje y encima de los rótulos del tiempo, sin que nada avisara)
{
  // la función sola: 4 etiquetas cuyas líneas están en el borde de abajo
  const ap = CH.apilarEtiquetas([{ k: 'a', v: 4, y: 182 }, { k: 'b', v: 3, y: 182.5 }, { k: 'c', v: 2, y: 183 }, { k: 'd', v: 1, y: 183.5 }], 11, 20, 179, []);
  const ps = ap.puestas.map(e => e.pos);
  assert(ap.sinSitio.length === 0 && ps.every(y => y >= 20 && y <= 179) && ps.slice(1).every((y, i) => y - ps[i] >= 11 - 1e-9), 'apilarEtiquetas: con 4 líneas en el borde de abajo, todas dentro de [yMin, yMax] y separadas', JSON.stringify(ps));
  igual(ap.puestas.map(e => e.k), ['a', 'b', 'c', 'd'], 'y en el orden de sus líneas');
  // en el gráfico de verdad (el caso del juez: piso, cierre, apertura y mín a centavos del mínimo de las velas)
  const vs = velas(78);
  const lo = Math.min(...vs.map(v => v[3]));
  const pkB = { ticker: 'SPY', velas: vs, niveles: { spot: 100.4, pisos_hora: [{ p: lo + .01 }], cierre_ayer: lo + .04, apertura_hoy: lo + .07, atl: lo + .10, ath: 101.4, ath_dias: 30 } };
  const sB = CH.chartSvg(pkB, { vista: 'hl', tf: 'm15', h: 200, w: 400 });
  const eje = Number(uno(sB, /<clipPath[^>]*><rect[^>]*>/g).y) + Number(uno(sB, /<clipPath[^>]*><rect[^>]*>/g).height);
  const ysB = elementos(sB, /<text data-etq="[^"]*"[^>]*>/g).map(e => Number(e.y));
  assert(ysB.length >= 4 && Math.max(...ysB) <= eje - 3 + 1e-9, 'gráfico 400×200 con 4 líneas pegadas al eje de abajo: ninguna etiqueta baja del área de velas (la más baja en y ' + Math.max(...ysB).toFixed(1) + ', el eje en ' + eje.toFixed(1) + ')', JSON.stringify(ysB));
}

// 14. la lista H-LINES SIN el spot del worker: el precio de referencia es el cierre de la vela en curso (o de la última),
//     como en el gráfico — el «— precio … —» va en su sitio y el techo/piso son los próximos a ESE precio
{
  const nvS = { techos_hora: [{ p: 101.5 }, { p: 99.9 }], pisos_hora: [{ p: 99.0 }, { p: 97.0 }], cierre_ayer: 100.6 };
  const vsS = velas(30);
  const pkS = { ticker: 'AAPL', tf: 'm15', velas: vsS, vela_viva: [vsS[29][0] + 900, 100.0, 100.4, 99.6, 100.2, 10], niveles: nvS };
  const h = CH.hlinesLista(pkS, null, 2);
  const orden = [...h.matchAll(/data-hl="([^"]*)"/g)].map(m => m[1]);
  assert(/data-hl="spot"><span>— precio 100\.20 —/.test(h) && orden.indexOf('spot') === orden.indexOf('cierre_ayer') + 1, 'sin spot del worker, «— precio 100.20 —» (el cierre de la vela en curso) en su sitio, debajo del cierre de ayer 100.60', orden.join(' '));
  assert(/data-hl="techo"><span>[^]*?techo hora 101\.50/.test(h) && /data-hl="piso"><span>[^]*?piso hora 99\.00/.test(h), 'y el techo y el piso son los próximos a ESE precio (101.50 y 99.00; no los de un precio vacío)', h.slice(0, 300));
  const hU = CH.hlinesLista({ ...pkS, vela_viva: null }, null, 2);
  assert(new RegExp('— precio ' + vsS[29][4].toFixed(2).replace('.', '\\.') + ' —').test(hU), 'sin vela en curso, el cierre de la última vela');
}

C.resumen();
