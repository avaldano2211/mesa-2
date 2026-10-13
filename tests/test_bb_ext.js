#!/usr/bin/env node
/* Pruebas de la v64 (Andrés 2026-10-13, captura de la hoja de AAPL, 15 min, Bollinger, Extendido encendido: «Mejora
   esto porque no estás dibujando Bollinger Bands ni las líneas de punto medio en los horarios extendidos, y debe
   hacerlo»). Con Extendido el gráfico se porta como TC2000/TradingView con horario extendido:
     1. serieExtM: la serie combinada M (regulares cerradas ∪ extendidas cerradas, por t, manda la regular, sin vivas)
     2. chartSvg con extendido (juguete y UNO REAL de AAPL m15, 2026-10-12): UNA polilínea medio/sup/inf y UN polígono
        de banda, con puntos sobre las zonas sombreadas (data-ext), y sus Y (invertidas con el eje de precios) son las de
        bollingerApp sobre la serie combinada, ±0,1 px; la escala incluye esas bandas
     3. vista Medias + H-lines: las SMA continuas igual
     4. rendimiento: M y los indicadores UNA vez por llamada (bollingerApp una vez, sobre los cierres de M)
     5. no regresión: Extendido apagado / Día / sin velas_ext / extendidas fuera de la ventana / gestor / Informe → SVG
        IDÉNTICO byte a byte al de v63 (git show 1651303:app/main.js, el main de la v63)
     6. lecturaChart con ext: la última vela es la más reciente de M ∪ vivas, BB y SMA de la combinada, rótulo nuevo;
        sin ext, idéntica a v63
     7. la cabecera de chartInline, el aria-label y la nota de honestidad de la hoja (pintarChart) solo con Extendido
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_bb_ext.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const casa = require(path.join(__dirname, 'casa_pruebas.js'));
const C = casa(process.argv[2], 'test_bb_ext.js');
const { assert, igual, cerca, construir, esc, haceCuanto, localStorageFalso, nodo } = C;

const NOMBRES = ['chartSvg', 'bollingerApp', 'smaApp', 'serieExtM', 'techoPisoProximos', 'chartTiempo', 'chartFrescoTxt', 'chartInline', 'lecturaChart'];
const CONSTS = ['CHART_TFS', 'CHART_VISTAS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol'];
const CH = construir(NOMBRES, { esc, haceCuanto }, { consts: CONSTS });

// ---------- el main.js de la v63 (para la no regresión byte a byte) ----------
// Se fija el commit de la v63 (1651303 = main al cortar la v64): comparar contra «main» a secas dejaría de probar nada
// en cuanto la v64 se fusione. Sin git (una copia suelta del repo) la comparación se omite y se dice.
const V63 = '1651303';
let CH63 = null;
try {
  const src = execFileSync('git', ['-C', path.dirname(path.resolve(process.argv[2])), 'show', V63 + ':app/main.js'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const C63 = casa('git:' + V63 + ':app/main.js', 'v63', { auxiliar: true, fuente: src });
  CH63 = C63.construir(NOMBRES.filter(n => n !== 'serieExtM'), { esc, haceCuanto }, { consts: CONSTS });
} catch (e) { console.log('nota: sin el main.js de la v63 (git show ' + V63 + ' falló: ' + String(e && e.message).split('\n')[0] + '): se omite la comparación byte a byte'); }

// ---------- velas de juguete: tres sesiones (mar 22 → jue 24 sep 2026, horario de verano NY = UTC−4) ----------
const DIAS = ['2026-09-22', '2026-09-23', '2026-09-24'];
const T = (d, hmZ) => Math.floor(Date.parse(d + 'T' + hmZ + ':00Z') / 1000);
// precio con tendencia y un salto en el pre: así las bandas con pre/post se separan de las regulares
const fila = (t, k, base) => { const o = (base || 100) + Math.sin(k / 4) + k * 0.03, c = o + Math.cos(k / 3) * 0.5; return [t, +o.toFixed(2), +(Math.max(o, c) + 0.3).toFixed(2), +(Math.min(o, c) - 0.3).toFixed(2), +c.toFixed(2), 1000 + k]; };
const serie = (d, h0, cnt, paso, base) => Array.from({ length: cnt }, (_, i) => fila(T(d, h0) + i * (paso || 900), i, base));
const REG = DIAS.flatMap(d => serie(d, '13:30', 26));                                                  // 9:30–15:45 ET: 26/día = 78
const EXT = DIAS.flatMap(d => serie(d, '08:30', 20, 900, 101.5).concat(serie(d, '20:00', 16, 900, 98.8)));   // pre 4:30–9:15 (20) + post 16:00–19:45 (16)
const PK = { ticker: 'AAPL', tf: 'm15', velas: REG, velas_ext: EXT };
// el real: AAPL 15 min del 2026-10-12 a las 14:00 ET (77 regulares + 114 extendidas, vela viva regular de las 14:00)
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'datos', 'aapl_m15_2026-10-12.json'), 'utf8'));
const PR = REAL.payload;

// ---------- lectores del SVG ----------
const cuenta = (s, re) => (s.match(re) || []).length;
const pares = (txt) => txt.trim().split(' ').map(p => p.split(',').map(Number));
const polis = (svg, attr, val) => [...svg.matchAll(new RegExp('<polyline ' + attr + '="' + val + '" points="([^"]*)"', 'g'))].map(m => pares(m[1]));
const poligono = (svg) => { const m = /<polygon data-bb="banda" points="([^"]*)"/.exec(svg); return m ? m[1] : null; };
const zonasExt = (svg) => [...svg.matchAll(/<rect data-ext="1" x="([^"]*)" y="[^"]*" width="([^"]*)"/g)].map(m => [Number(m[1]), Number(m[1]) + Number(m[2])]);
const velasSvg = (svg) => [...svg.matchAll(/<rect class="(vela[^"]*)" x="([^"]*)" y="[^"]*" width="([^"]*)"/g)].map(m => ({ clase: m[1], cx: Number(m[2]) + Number(m[3]) / 2 }));
const ticks = (svg) => [...svg.matchAll(/<text class="ejey" x="[^"]*" y="([^"]*)" fill="var\(--tx3\)">([^<]*)<\/text>/g)].map(m => [Number(m[2]), Number(m[1]) - 3]);
const saltoMax = (pts) => pts.slice(1).reduce((m, p, i) => Math.max(m, p[0] - pts[i][0]), 0);
const enZona = (x, zonas) => zonas.some(([a, b]) => x > a && x < b);
// recta y = a + b·v por mínimos cuadrados
function ajuste(pv) {
  const n = pv.length, mv = pv.reduce((s, p) => s + p[0], 0) / n, my = pv.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0; pv.forEach(([v, y]) => { sxy += (v - mv) * (y - my); sxx += (v - mv) * (v - mv); });
  const b = sxy / sxx; return { a: my - b * mv, b, Y: (v) => my - b * mv + b * v };
}
// El oráculo de la serie combinada, escrito aparte desde la spec (A1): regulares ∪ extendidas, por t, manda la regular
function combinada(pk) {
  const m = new Map();
  pk.velas.forEach(v => m.set(Number(v[0]), { t: Number(v[0]), c: Number(v[4]), ext: false, v }));
  (pk.velas_ext || []).forEach(v => { if (!m.has(Number(v[0]))) m.set(Number(v[0]), { t: Number(v[0]), c: Number(v[4]), ext: true, v }); });
  return [...m.values()].sort((a, b) => a.t - b.t);
}
// Une cada vela CERRADA dibujada con su posición en M: las cerradas dibujadas son el final de M (las regulares de la
// ventana y las extendidas desde su arranque); se comprueba que el patrón regular/extendida casa vela a vela.
function velasEnM(svg, M) {
  const cerr = velasSvg(svg).filter(v => !/viva/.test(v.clase));
  const k0 = M.length - cerr.length;
  return { cerr: cerr.map((v, k) => Object.assign(v, { j: k0 + k })), casa: cerr.every((v, k) => /ext/.test(v.clase) === M[k0 + k].ext) };
}
// Los puntos de una polilínea → [valor esperado, y dibujada] por la X de su vela
function emparejar(pts, cerr, serieM, bw) {
  return pts.map(([x, y]) => {
    let mejor = null; cerr.forEach(v => { if (!mejor || Math.abs(v.cx - x) < Math.abs(mejor.cx - x)) mejor = v; });
    return mejor && Math.abs(mejor.cx - x) < bw / 2 ? [serieM[mejor.j], y, mejor] : [NaN, y, null];
  });
}

// ════════════════ 1. serieExtM: la serie combinada M ════════════════
{
  const M = CH.serieExtM(REG, EXT), O = combinada(PK);
  igual([M.t.length, M.ext.size], [78 + 108, 108], 'M = las 78 regulares + las 108 extendidas cerradas del juguete');
  igual(M.t, O.map(x => x.t), 'en orden de tiempo (regulares y extendidas entremezcladas)');
  igual(M.c, O.map(x => x.c), 'con sus cierres');
  assert(M.t.every((t, i) => M.pos.get(t) === i), 'pos: índice por t (sin búsquedas por vela)');
  const dup = EXT.concat([[REG[40][0], 1, 2, 0.5, 1.5, 9]]);                 // una extendida que pisa una ranura regular
  const Md = CH.serieExtM(REG, dup);
  igual([Md.t.length, Md.c[Md.pos.get(REG[40][0])], Md.ext.has(REG[40][0])], [186, REG[40][4], false], 'si coinciden en t, manda la regular (ni se repite ni cuenta como extendida)');
  const Ms = CH.serieExtM(REG, EXT.concat([[1, 2], ['x', 'y', 'z', 'w', 'q'], null, 'raro', [T(DIAS[0], '23:59'), 1, 2, NaN, 1]]));
  igual(Ms.t.length, 186, 'filas mal formadas (cortas, NaN, null, texto) no entran');
  igual(CH.serieExtM(REG, undefined).t.length, 78, 'sin velas_ext, M son las regulares');
  igual([CH.serieExtM(null, null).t.length, CH.serieExtM(REG.slice().reverse(), []).t[0]], [0, REG[0][0]], 'sin nada no revienta; y ordena aunque llegue al revés');
  // REAL
  const MR = CH.serieExtM(PR.velas, PR.velas_ext), OR = combinada(PR);
  igual([MR.t.length, MR.ext.size], [77 + 114, 114], 'real AAPL m15: 77 regulares + 114 extendidas = 191');
  igual(MR.c, OR.map(x => x.c), 'real: los cierres de M en orden de tiempo');
  assert(!MR.t.includes(Number(PR.vela_viva[0])), 'la vela viva NO entra en M (los indicadores son de velas cerradas)');
}

// ════════════════ 2. chartSvg con extendido: Bollinger continuo sobre pre y post ════════════════
function revisarBB(nombre, pk, op) {
  const svg = CH.chartSvg(pk, Object.assign({ vista: 'bb', tf: 'm15', ext: true }, op || {}));
  const O = combinada(pk), b = CH.bollingerApp(O.map(x => x.c), 20, 2);
  // (1) exactamente UNA de cada
  igual([cuenta(svg, /data-bb="medio"/g), cuenta(svg, /data-bb="sup"/g), cuenta(svg, /data-bb="inf"/g), cuenta(svg, /<polygon data-bb="banda"/g)], [1, 1, 1, 1],
    nombre + ': UNA polilínea data-bb medio, UNA sup, UNA inf y UN polígono banda (nada de troceo)');
  const zonas = zonasExt(svg), { cerr, casa: casaM } = velasEnM(svg, O);
  assert(zonas.length >= 1 && casaM, nombre + ': hay zonas sombreadas y las velas cerradas dibujadas son el final de M (patrón regular/extendida idéntico)');
  const bw = cerr.length > 1 ? (cerr[cerr.length - 1].cx - cerr[0].cx) / (cerr.length - 1) : 1;
  const med = (polis(svg, 'data-bb', 'medio')[0] || []), sup = (polis(svg, 'data-bb', 'sup')[0] || []), inf = (polis(svg, 'data-bb', 'inf')[0] || []);
  // (2) los puntos cubren las X de las velas extendidas
  const extCerr = cerr.filter(v => /ext/.test(v.clase) && b.medio[v.j] != null).length;
  const enExt = med.filter(([x]) => enZona(x, zonas)).length;
  assert(enExt > 0 && enExt === extCerr, nombre + ': la línea media pasa por DENTRO de las zonas sombreadas, un punto por cada extendida cerrada (' + enExt + ' de ' + extCerr + ')');
  assert(saltoMax(med) < 1.2 * bw && saltoMax(sup) < 1.2 * bw && saltoMax(inf) < 1.2 * bw, nombre + ': y continua, vela a vela (paso máximo = una vela, también al cruzar pre y post)');
  igual(med.length, cerr.filter(v => b.medio[v.j] != null).length, nombre + ': un punto por cada vela cerrada a la vista con 20 velas de historia (regular o extendida)');
  // (3) los valores: Y invertida con el eje de precios, ±0,1 px
  const pv = [].concat(emparejar(med, cerr, b.medio, bw), emparejar(sup, cerr, b.sup, bw), emparejar(inf, cerr, b.inf, bw));
  assert(pv.every(p => Number.isFinite(p[0])), nombre + ': cada punto cae sobre una vela cerrada con valor');
  const A = ajuste(pv), res = Math.max(...pv.map(([v, y]) => Math.abs(A.Y(v) - y)));
  assert(A.b < 0 && res <= 0.1, nombre + ': las Y son bollingerApp(20, 2σ) sobre la serie COMBINADA en esas posiciones, ±0,1 px (residuo máx ' + res.toFixed(3) + ')');
  const tk = ticks(svg), resTk = Math.max(...tk.map(([v, y]) => Math.abs(A.Y(v) - y)));
  assert(tk.length >= 2 && resTk <= 0.1, nombre + ': con la MISMA escala que el eje de precios (' + tk.length + ' marcas, ±0,1 px; máx ' + resTk.toFixed(3) + ')');
  igual(poligono(svg), sup.concat(inf.slice().reverse()).map(p => p.join(',')).join(' ').replace(/(-?\d+(?:\.\d+)?)/g, (m) => Number(m).toFixed(1)), nombre + ': el polígono de la banda = sup + inf al revés');
  // (3b) que no son las de la sesión regular: con las bandas solo-regulares las Y no casan
  const reg = combinada({ velas: pk.velas }), bReg = CH.bollingerApp(reg.map(x => x.c), 20, 2), iReg = new Map(reg.map((x, i) => [x.t, i]));
  const desv = Math.max(...emparejar(med, cerr, b.medio, bw).filter(p => p[2] && !O[p[2].j].ext).map(p => { const i = iReg.get(O[p[2].j].t); return bReg.medio[i] == null ? 0 : Math.abs(A.Y(bReg.medio[i]) - p[1]); }));
  assert(desv > 1, nombre + ': y NO son las de la sesión regular sola (alguna regular a la vista se mueve ' + desv.toFixed(1) + ' px)');
  // la escala incluye las bandas calculadas (A3)
  const yMin = Math.min(...sup.map(p => p[1])), yMax = Math.max(...inf.map(p => p[1]));
  assert(yMin >= 8 - 0.05 && yMax <= Number(/viewBox="0 0 \d+ (\d+)"/.exec(svg)[1]) - 18 + 0.05, nombre + ': y la escala vertical las incluye (ni la sup ni la inf se salen del área de dibujo)');
  return { svg, A };
}
revisarBB('juguete', PK);
revisarBB('juguete, hoja grande 880×380', PK, { w: 880, h: 380 });
revisarBB('juguete en Hora', { ticker: 'AAPL', tf: 'hora', velas: serie('2026-09-01', '13:30', 90, 3600).map((v, i) => [T('2026-09-01', '13:30') + Math.floor(i / 7) * 86400 + (i % 7) * 3600].concat(v.slice(1))),
  velas_ext: Array.from({ length: 13 }, (_, d) => [8, 9, 10, 11, 12].map(h => fila(T('2026-09-01', '08:30') + d * 86400 + (h - 8) * 3600, d * 5 + h, 102)).concat([20, 21, 22, 23].map(h => fila(T('2026-09-01', '20:00') + d * 86400 + (h - 20) * 3600, d * 4 + h, 98)))).flat() }, { tf: 'hora' });
const R = revisarBB('REAL AAPL 15 min (2026-10-12)', PR);
assert(/data-ext="1"/.test(R.svg) && /<rect class="vela viva"/.test(R.svg), 'real: con sus zonas sombreadas y la vela viva regular de las 14:00 (sin punto de banda: es una vela en curso)');
{
  // la vela viva (regular o extendida) nunca lleva punto de banda
  const O = combinada(PR), svg = R.svg, { cerr } = velasEnM(svg, O), viva = velasSvg(svg).find(v => /viva/.test(v.clase));
  const med = (polis(svg, 'data-bb', 'medio')[0] || []);
  assert(viva && med[med.length - 1][0] < viva.cx - 1 && Math.abs(med[med.length - 1][0] - cerr[cerr.length - 1].cx) < 0.11, 'real: la línea media termina en la última vela CERRADA (13:45), no en la viva');
  const pkV = { ...PK, velas_ext: EXT.slice(0, -1), vela_viva_ext: EXT[EXT.length - 1] };
  const sv = CH.chartSvg(pkV, { vista: 'bb', tf: 'm15', ext: true }), vv = velasSvg(sv).find(v => /viva/.test(v.clase)), m2 = (polis(sv, 'data-bb', 'medio')[0] || []);
  assert(/vela ext viva/.test(vv.clase) && m2[m2.length - 1][0] < vv.cx - 1, 'post-mercado en curso: la viva extendida se dibuja, sin punto de banda');
  // menos de 20 velas de historia: esos puntos no se dibujan (como hoy)
  const corto = { ticker: 'AAPL', tf: 'm15', velas: serie(DIAS[2], '13:30', 10), velas_ext: serie(DIAS[2], '08:30', 20, 900, 101.5) };
  const sc = CH.chartSvg(corto, { vista: 'bb', tf: 'm15', ext: true });
  igual([velasSvg(sc).length, (polis(sc, 'data-bb', 'medio')[0] || []).length], [30, 11], 'con 30 velas en M (20 del pre + 10 regulares) la banda empieza en la 20.ª: 11 puntos, sin nulos dibujados');
  const sc2 = CH.chartSvg({ ...corto, velas_ext: serie(DIAS[2], '12:00', 6, 900, 101.5) }, { vista: 'bb', tf: 'm15', ext: true });
  igual([cuenta(sc2, /data-bb=/g), /aria-label="AAPL 15 min Bollinger extendido con indicadores de sesión extendida"/.test(sc2)], [0, true], 'con menos de 20 velas en M no hay banda (ni un trazo inventado), y el extendido sigue dibujado');
  // solo la viva extendida (velas_ext vacía): M = las regulares; una sola banda, sin reventar
  const sv0 = CH.chartSvg({ ...PK, velas_ext: [], vela_viva_ext: EXT[EXT.length - 1] }, { vista: 'bb', tf: 'm15', ext: true });
  igual([cuenta(sv0, /data-bb="medio"/g), cuenta(sv0, /vela ext viva/g)], [1, 1], 'solo con la viva extendida: una banda (de las regulares) y la viva');
}

// ════════════════ 3. Medias + H-lines: las SMA continuas igual ════════════════
function revisarSMA(nombre, pk) {
  const svg = CH.chartSvg(pk, { vista: 'hl', tf: 'm15', ext: true });
  const O = combinada(pk), { cerr, casa: casaM } = velasEnM(svg, O), zonas = zonasExt(svg);
  const bw = (cerr[cerr.length - 1].cx - cerr[0].cx) / (cerr.length - 1);
  assert(casaM && cuenta(svg, /data-bb=/g) === 0, nombre + ': en Medias + H-lines no hay Bollinger y las velas casan con M');
  const pv = [];
  ['20', '40', '100', '200'].forEach(k => {
    const s = CH.smaApp(O.map(x => x.c), Number(k)), conValor = cerr.filter(v => s[v.j] != null).length;
    const ps = polis(svg, 'data-sma', k);
    if (conValor < 2) { igual(ps.length, 0, nombre + ': SMA ' + k + ' sin historia en M (' + O.length + ' velas): no se dibuja'); return; }
    const p0 = ps[0] || [];
    igual([ps.length, p0.length], [1, conValor], nombre + ': SMA ' + k + ' es UNA polilínea, un punto por vela cerrada con valor (' + conValor + ')');
    assert(saltoMax(p0) < 1.2 * bw && p0.some(([x]) => enZona(x, zonas)), nombre + ': SMA ' + k + ' continua y sobre las zonas sombreadas');
    emparejar(p0, cerr, s, bw).forEach(p => pv.push(p));
  });
  const A = ajuste(pv), res = Math.max(...pv.map(([v, y]) => Math.abs(A.Y(v) - y)));
  const tk = ticks(svg), resTk = Math.max(...tk.map(([v, y]) => Math.abs(A.Y(v) - y)));
  assert(A.b < 0 && res <= 0.1 && resTk <= 0.1, nombre + ': las Y de las medias son smaApp sobre la serie combinada con la escala del eje, ±0,1 px (' + res.toFixed(3) + ' / ' + resTk.toFixed(3) + ')');
}
revisarSMA('juguete', PK);
revisarSMA('REAL AAPL', PR);

// ════════════════ 4. rendimiento: M y los indicadores UNA vez por llamada ════════════════
{
  const reg = { bb: [], sma: [] };
  const P = construir(['chartSvg', 'serieExtM', 'techoPisoProximos', 'chartTiempo'], { esc, haceCuanto,
    bollingerApp: (c, n, k) => { reg.bb.push(c.slice()); return CH.bollingerApp(c, n, k); },
    smaApp: (c, n) => { reg.sma.push([n, c.length]); return CH.smaApp(c, n); } }, { consts: CONSTS });
  P.chartSvg(PR, { vista: 'bb', tf: 'm15', ext: true });
  igual([reg.bb.length, reg.sma.length], [1, 0], 'Bollinger con extendido: bollingerApp UNA vez por llamada y ninguna SMA (el pk.bb regular ni se toca)');
  igual(reg.bb[0], combinada(PR).map(x => x.c), 'y sobre los cierres de la serie combinada M (191, sin la viva)');
  reg.bb = []; reg.sma = [];
  P.chartSvg(PR, { vista: 'hl', tf: 'm15', ext: true });
  igual([reg.bb.length, reg.sma], [0, [[20, 191], [40, 191], [100, 191], [200, 191]]], 'Medias + H-lines con extendido: las 4 SMA una vez cada una sobre M');
  reg.bb = []; reg.sma = [];
  P.chartSvg(PR, { vista: 'bb', tf: 'm15' });
  igual([reg.bb.length, reg.sma.length], [0, 0], 'sin extendido, como v63: las bandas y medias del worker (pk.bb / pk.sma), nada recalculado');
  const t0 = Date.now(); for (let i = 0; i < 100; i++) CH.chartSvg(PR, { vista: i % 2 ? 'hl' : 'bb', tf: 'm15', ext: true, w: 880, h: 380 });
  const ms = Date.now() - t0;
  assert(ms < 3000, '100 gráficos reales con extendido en ' + ms + ' ms (la hoja y las tarjetas siguen siendo instantáneas)');
}

// ════════════════ 5. no regresión: byte a byte con la v63 ════════════════
if (CH63) {
  const ventana10 = { ventana: { start: 10, end: 60 } };
  const m5 = { ticker: 'AAPL', tf: 'm5', velas: serie(DIAS[0], '13:30', 100, 300), velas_ext: serie(DIAS[0], '12:00', 10, 300), niveles: { spot: 100.2 } };
  const dia = { ...PK, tf: 'dia', velas: serie('2026-01-05', '05:00', 150, 86400) };
  const casos = [
    ['juguete, Extendido apagado (bb)', PK, { vista: 'bb', tf: 'm15' }],
    ['juguete, Extendido apagado (hl)', PK, { vista: 'hl', tf: 'm15' }],
    ['juguete, ext false explícito, grande', PK, { vista: 'bb', tf: 'm15', ext: false, w: 720, h: 320 }],
    ['juguete, ext «si» (solo el booleano enciende)', PK, { vista: 'hl', tf: 'm15', ext: 'si' }],
    ['Día con Extendido', dia, { vista: 'bb', tf: 'dia', ext: true }],
    ['payload sin velas_ext con Extendido', { ...PK, velas_ext: undefined }, { vista: 'bb', tf: 'm15', ext: true }],
    ['velas_ext vacía con Extendido', { ...PK, velas_ext: [] }, { vista: 'hl', tf: 'm15', ext: true }],
    ['velas_ext que no es lista', { ...PK, velas_ext: 'raro' }, { vista: 'bb', tf: 'm15', ext: true }],
    ['extendidas publicadas pero fuera de la ventana (ni una dibujada)', { ...PK, velas_ext: EXT.slice(0, 36) }, { vista: 'bb', tf: 'm15', ext: true }],
    ['real AAPL, Extendido apagado (bb)', PR, { vista: 'bb', tf: 'm15', w: 880, h: 380 }],
    ['real AAPL, Extendido apagado (hl)', PR, { vista: 'hl', tf: 'm15' }],
    ['real AAPL sin velas_ext con Extendido', { ...PR, velas_ext: undefined, vela_viva_ext: undefined }, { vista: 'bb', tf: 'm15', ext: true }],
    ['real AAPL en Día con Extendido', PR, { vista: 'bb', tf: 'dia', ext: true }],
    ['gestor m5 con ventana, H-lines, strikes y ext', m5, { vista: 'bb', tf: 'm5', ext: true, hlines: true, extra: [{ v: 100.5, lb: 'strike' }], ...ventana10 }],
    ['gestor m5 sin Bollinger', m5, { vista: 'bb', tf: 'm5', bb: false, ...ventana10 }],
    ['Informe: mini gráfico de hoy (m15 con ventana)', PR, { vista: 'bb', tf: 'm15', h: 110, w: 380, ventana: { start: 60, end: PR.velas.length }, fondo: 'var(--bg2)' }],
  ];
  casos.forEach(([n, pk, op]) => igual(CH.chartSvg(pk, op), CH63.chartSvg(pk, op), 'v63 byte a byte · chartSvg · ' + n));
  // chartInline y lecturaChart sin extendido
  const hoy = new Date().toISOString(), fila15 = { payload: PK, actualizado_at: hoy }, filaR = { payload: PR, actualizado_at: hoy };
  igual(CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, false), CH63.chartInline('AAPL', fila15, 'bb', 'm15', null, false, false), 'v63 byte a byte · chartInline con Extendido apagado');
  igual(CH.chartInline('AAPL', filaR, 'hl', 'dia', null, true, true), CH63.chartInline('AAPL', filaR, 'hl', 'dia', null, true, true), 'v63 byte a byte · chartInline en Día con Extendido');
  igual(CH.chartInline('AAPL', { payload: { ...PK, velas_ext: undefined }, actualizado_at: hoy }, 'bb', 'm15', null, false, true), CH63.chartInline('AAPL', { payload: { ...PK, velas_ext: undefined }, actualizado_at: hoy }, 'bb', 'm15', null, false, true), 'v63 byte a byte · chartInline con Extendido y sin velas_ext');
  [[PK, 'm15'], [PR, 'm15'], [PR, 'dia'], [{ ...PR, vela_viva: null }, 'hora']].forEach(([pk, tf], i) => {
    igual(CH.lecturaChart(pk, tf, 2), CH63.lecturaChart(pk, tf, 2), 'v63 byte a byte · lecturaChart sin ext (#' + (i + 1) + ', ' + tf + ')');
    igual(CH.lecturaChart(pk, tf, 2, false), CH63.lecturaChart(pk, tf, 2), 'v63 byte a byte · lecturaChart con ext false (#' + (i + 1) + ')');
  });
  igual(CH.lecturaChart(PR, 'dia', 2, true), CH63.lecturaChart(PR, 'dia', 2), 'v63 byte a byte · lecturaChart con ext en Día');
  igual(CH.lecturaChart({ ...PR, velas_ext: undefined }, 'm15', 2, true), CH63.lecturaChart({ ...PR, velas_ext: undefined }, 'm15', 2), 'v63 byte a byte · lecturaChart con ext y sin velas_ext');
  igual(CH.lecturaChart({ ...PK, velas_ext: [] }, 'm15', 2, true), CH63.lecturaChart({ ...PK, velas_ext: [] }, 'm15', 2), 'v63 byte a byte · lecturaChart con ext y velas_ext vacía (sin viva extendida)');
  // y lo que SÍ cambia, cambia
  assert(CH.chartSvg(PR, { vista: 'bb', tf: 'm15', ext: true }) !== CH63.chartSvg(PR, { vista: 'bb', tf: 'm15', ext: true }), 'con Extendido y velas extendidas a la vista el SVG ya no es el de la v63 (ahí está el cambio)');
}

// ════════════════ 6. lecturaChart con ext ════════════════
{
  const f2 = (v) => Number(v).toFixed(2);
  const ult = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
  const celda = (et, val) => `<div><span>${et}</span><b class="mono">${val}</b></div>`;
  // post-mercado cerrado: la última vela es la extendida más nueva (19:45 del día 3)
  const O = combinada(PK), bO = CH.bollingerApp(O.map(x => x.c), 20, 2), u = EXT[EXT.length - 1], tt = CH.chartTiempo(u[0]);
  const l = CH.lecturaChart(PK, 'm15', 2, true);
  assert(l.includes(celda('última vela (extendida)', `${tt.hm} · ${tt.dia}`)) && tt.hm === '19:45', 'post: «última vela (extendida)» = la extendida más nueva de M (19:45)', l.slice(0, 400));
  assert(l.includes(celda('apertura', f2(u[1]))) && l.includes(celda('cierre', f2(u[4]))) && l.includes(celda('máximo', f2(u[2]))) && l.includes(celda('mínimo', f2(u[3]))), 'con SU apertura, cierre, máximo y mínimo');
  assert(l.includes('Bollinger y medias con pre/post · última vela cerrada (19:45)'), 'rótulo «Bollinger y medias con pre/post · última vela cerrada (hh:mm)»');
  assert(l.includes(celda('BB superior', f2(ult(bO.sup)))) && l.includes(celda('BB medio', f2(ult(bO.medio)))) && l.includes(celda('BB inferior', f2(ult(bO.inf)))), 'BB superior/medio/inferior de la serie combinada (último valor no nulo de M)');
  const s20 = ult(CH.smaApp(O.map(x => x.c), 20)), s100 = ult(CH.smaApp(O.map(x => x.c), 100));
  assert(l.includes(celda('SMA 20', f2(s20))) && l.includes(celda('SMA 100', f2(s100))) && !/SMA 200/.test(l) && /no hay historia para una media/.test(l), 'SMA 20/40/100 de la combinada; la 200 no tiene historia en M (186) y se dice');
  assert(/^<div class="mut" data-nota-ext="1"[^>]*>Con Extendido, Bollinger y medias se calculan con las velas de pre y post; las señales de la Mesa usan solo la sesión regular\.<\/div>/.test(l), 'arriba, pegada al gráfico, la nota de honestidad');
  // post-mercado EN CURSO: la viva extendida es la más nueva
  const pkV = { ...PK, velas_ext: EXT.slice(0, -1), vela_viva_ext: u };
  const lv = CH.lecturaChart(pkV, 'm15', 2, true), Ov = combinada(pkV), bv = CH.bollingerApp(Ov.map(x => x.c), 20, 2);
  assert(lv.includes(celda('vela extendida en curso', `${tt.hm} · ${tt.dia}`)) && lv.includes(celda('cierre', f2(u[4]))), 'post en curso: «vela extendida en curso» con la viva extendida');
  assert(lv.includes('última vela cerrada (19:30)') && lv.includes(celda('BB superior', f2(ult(bv.sup)))), 'y las bandas de la última CERRADA de M (19:30): la viva no entra');
  // REAL (14:00 ET, sesión regular en curso): la viva regular es la más nueva; las bandas, de M (con el pre de hoy)
  const OR = combinada(PR), bR = CH.bollingerApp(OR.map(x => x.c), 20, 2), tv = CH.chartTiempo(PR.vela_viva[0]);
  const lr = CH.lecturaChart(PR, 'm15', 2, true);
  assert(lr.includes(celda('vela en curso', `${tv.hm} · ${tv.dia}`)) && tv.hm === '14:00', 'real: la vela en curso (14:00) es la más nueva de M ∪ vivas');
  assert(lr.includes('Bollinger y medias con pre/post · última vela cerrada (13:45)') && lr.includes(celda('BB superior', f2(ult(bR.sup)))) && lr.includes(celda('BB inferior', f2(ult(bR.inf)))), 'real: BB de la combinada a las 13:45');
  assert(f2(ult(bR.sup)) !== f2(ult(PR.bb.sup)) && !lr.includes(celda('BB superior', f2(ult(PR.bb.sup)))), 'real: y NO las del worker (la sesión regular: ' + f2(ult(PR.bb.sup)) + ' frente a ' + f2(ult(bR.sup)) + ')');
  const lsin = CH.lecturaChart(PR, 'm15', 2);
  assert(lsin.includes(celda('BB superior', f2(ult(PR.bb.sup)))) && lsin.includes('Bollinger y medias · última vela cerrada<') && !/data-nota-ext|pre\/post/.test(lsin), 'sin ext: las del worker, el rótulo de siempre y sin nota');
  // con viva regular Y viva extendida (una extendida rancia): manda la regular, como en el dibujo
  const lrr = CH.lecturaChart({ ...PR, vela_viva_ext: [Number(PR.vela_viva[0]) + 900, 1, 2, 0.5, 1.5, 7] }, 'm15', 2, true);
  assert(lrr.includes(celda('vela en curso', `${tv.hm} · ${tv.dia}`)), 'con vela viva regular la viva extendida no cuenta (chartSvg tampoco la dibuja)');
}

// ════════════════ 7. cabecera, aria-label y la nota de la hoja: solo con Extendido ════════════════
{
  const hoy = new Date().toISOString(), fila15 = { payload: PK, actualizado_at: hoy };
  const cab = (h) => (/<span class="fresco">([^<]*)<\/span>/.exec(h) || [])[1];
  igual(cab(CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, true)), '15 min · Bollinger · extendido (bandas con pre/post)', 'cabecera con Extendido: «15 min · Bollinger · extendido (bandas con pre/post)»');
  igual(cab(CH.chartInline('AAPL', fila15, 'hl', 'm15', null, true, true)), '15 min · Medias + H-lines · extendido (medias con pre/post)', 'en Medias + H-lines: «(medias con pre/post)»');
  igual(cab(CH.chartInline('AAPL', { payload: PR, actualizado_at: hoy }, 'bb', 'hora', null, false, true)), 'Hora · Bollinger · extendido (bandas con pre/post)', 'en Hora igual');
  igual(cab(CH.chartInline('AAPL', fila15, 'bb', 'm15', null, false, false)), '15 min · Bollinger', 'sin Extendido, la de siempre');
  igual(cab(CH.chartInline('AAPL', fila15, 'bb', 'dia', null, false, true)), 'Día · Bollinger', 'en Día, la de siempre');
  igual(cab(CH.chartInline('AAPL', { payload: { ...PK, velas_ext: EXT.slice(0, 36) }, actualizado_at: hoy }, 'bb', 'm15', null, false, true)), '15 min · Bollinger', 'extendidas fuera de la ventana (ni una dibujada): no dice «extendido» (lo que se dice = lo que se ve)');
  assert(/aria-label="AAPL 15 min Bollinger extendido con indicadores de sesión extendida"/.test(CH.chartSvg(PK, { vista: 'bb', tf: 'm15', ext: true })), 'aria-label con Extendido: «… extendido con indicadores de sesión extendida»');
  assert(/aria-label="AAPL 15 min medias y H-lines extendido con indicadores de sesión extendida"/.test(CH.chartSvg(PK, { vista: 'hl', tf: 'm15', ext: true })), 'también en Medias + H-lines');
  assert(/aria-label="AAPL 15 min Bollinger"/.test(CH.chartSvg(PK, { vista: 'bb', tf: 'm15' })), 'sin Extendido no');

  // la hoja: pintarChart con las preferencias de verdad (localStorage) y su nota bajo el gráfico
  function hoja(almacen, fila) {
    const nodos = {}; ['#chSel', '#chFresco', '#chSvg', '#chLectura', '#chHlines', '#modalChart', '#tgT', '#tgA', '#tgB', '#tgF', '#tgS'].forEach(id => { nodos[id] = nodo(); });
    const P = construir(['pintarChart', 'chartPrefs', 'chartSelectores', 'chartFrescoTxt', 'chartSvg', 'lecturaChart', 'hlinesLista', 'serieExtM',
      'bollingerApp', 'smaApp', 'techoPisoProximos', 'chartTiempo', 'fmtFechaNY'], { esAdmin: () => true, anchoVista: () => 400, GESTOR_ANCHO_TABLA: 900,
      $: (s) => nodos[s] || null, localStorage: localStorageFalso(almacen), esc, haceCuanto, document: { activeElement: null } },
    { consts: ['CHART_VISTA_K', 'CHART_VISTAS', 'CHART_TFS', 'nombreTf', 'nombreVista', 'decDe', 'fmtVol', '_velas', '_targets'], prefijo: 'let _ch = { sym: "AAPL", gen: 0, timer: null };' });
    P.pintarChart(fila, null);
    return nodos;
  }
  const filaR = { payload: PR, actualizado_at: hoy };
  const on = hoja({ mz_chart_ext: '1' }, filaR);
  assert(/data-nota-ext="1"/.test(on['#chLectura'].innerHTML) && /Con Extendido, Bollinger y medias se calculan con las velas de pre y post; las señales de la Mesa usan solo la sesión regular\./.test(on['#chLectura'].innerHTML), 'hoja con Extendido: debajo del gráfico, la nota de honestidad');
  assert(/con pre\/post · última vela cerrada \(13:45\)/.test(on['#chLectura'].innerHTML) && cuenta(on['#chSvg'].innerHTML, /data-bb="medio"/g) === 1 && /data-ext="1"/.test(on['#chSvg'].innerHTML), 'y la lectura con pre/post junto al gráfico con UNA banda continua');
  const off = hoja({}, filaR);
  assert(!/data-nota-ext|pre\/post/.test(off['#chLectura'].innerHTML), 'hoja sin Extendido: ni nota ni «pre/post»');
  if (CH63) igual(off['#chLectura'].innerHTML, CH63.lecturaChart(PR, 'm15', 2), 'y la lectura es byte a byte la de la v63');
  const sinExt = hoja({ mz_chart_ext: '1' }, { payload: { ...PR, velas_ext: undefined, vela_viva_ext: undefined }, actualizado_at: hoy });
  assert(!/data-nota-ext/.test(sinExt['#chLectura'].innerHTML) && !/data-ext/.test(sinExt['#chSvg'].innerHTML), 'Extendido encendido pero sin velas_ext (worker viejo): ni sombras ni nota');
  const fuera = hoja({ mz_chart_ext: '1' }, { payload: { ...PK, velas_ext: EXT.slice(0, 36) }, actualizado_at: hoy });
  assert(!/data-nota-ext/.test(fuera['#chLectura'].innerHTML), 'ni con extendidas publicadas pero ninguna a la vista (la lectura dice lo que el gráfico enseña)');
  const dia = hoja({ mz_chart_ext: '1', mz_chart_tf: 'dia' }, filaR);
  assert(!/data-nota-ext/.test(dia['#chLectura'].innerHTML), 'ni en Día');
}

C.resumen();
