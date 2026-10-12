#!/usr/bin/env node
/* Pruebas de la v63: «El informe de la mañana» con más detalle y a pantalla completa en la computadora (Andrés
   2026-10-12, desde el laptop: el Informe salía en la columna de 440 px del teléfono, el título decía «(E5)» con una
   señal CT15A y la doctrina del 35% iba antes y más visible que «Tu plan (manda)»).
     1. el título «SEÑALES DE HOY» sin «(E5)», igual que en el Copiloto
     2. lineasGtcSenal: con el Plan 10 el plan propio PRIMERO y en grande, la doctrina debajo pequeña y gris; con el
        Plan 35 exactamente como antes (y el Copiloto usa la misma función)
     3. B1 · el detalle de una señal (estrategia, hora NY, acción al sonar, rango, contrato) con y sin datos
     4. B2 · los números del día de un ticker (spot, cambio, apertura, máx/mín de HOY con la vela viva) con y sin velas
     5. «Mercado ahora» (ventana de señales) y «Tu plan hoy» (solo lectura)
     6. vistaInforme REAL (módulo entero en un DOM de juguete) a 1400 px y a 390 px, informeAncho al cambiar de pestaña,
        el resize y el CSS
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js): nada se reimplementa aquí.
   Uso: node test_informe.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_informe.js');
const { FUENTE, assert, igual, cerca, construir, extraer, esc, haceCuanto, colUtil, nodo, sbFalso, respirar } = C;
const INDEX = fs.readFileSync(path.join(path.dirname(process.argv[2]), '..', 'index.html'), 'utf8');

// ---------- ayudantes de tiempo (solo arman datos de prueba; la lógica es la del fuente) ----------
const fmtNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dosD = (n) => String(n).padStart(2, '0');
// epoch (s) cuyo reloj de Nueva York marca ymd hh:mm (EDT o EST)
function epochNY(ymd, hh, mm) {
  const base = Date.parse(`${ymd}T${dosD(hh)}:${dosD(mm)}:00Z`) / 1000;
  for (const off of [4, 5]) { const t = base + off * 3600; if (fmtNY.format(new Date(t * 1000)).replace(',', '') === `${ymd} ${dosD(hh)}:${dosD(mm)}`) return t; }
  throw new Error('epochNY sin solución ' + ymd);
}
const ymdMenos = (ymd, d) => { const x = new Date(ymd + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };
// Fila m15 de ticker_velas: `ayer` velas del día anterior (deben quedar FUERA de lo de hoy), las de hoy desde las 9:30 y la viva
function filaVelas(sym, hoy, op) {
  op = Object.assign({ ayer: 6, hoy: [[100, 101, 99.5, 100.5], [100.5, 102, 100.2, 101.8], [101.8, 101.9, 98.7, 99.1], [99.1, 100.3, 99, 100.2]],
    viva: [100.2, 103.4, 100.1, 103.2], spot: 103.2, cierre_ayer: 100.0, fecha_ny: hoy, actualizado_at: new Date().toISOString() }, op || {});
  const ay = ymdMenos(hoy, 1), velas = [];
  for (let i = 0; i < op.ayer; i++) velas.push([epochNY(ay, 9 + Math.floor((30 + 15 * i) / 60), (30 + 15 * i) % 60), 90, 140, 50, 95, 1000]);   // máx 140 y mín 50: si se colaran, se notaría
  op.hoy.forEach((v, i) => velas.push([epochNY(hoy, 9 + Math.floor((30 + 15 * i) / 60), (30 + 15 * i) % 60), v[0], v[1], v[2], v[3], 5000]));
  const k = op.hoy.length;
  const viva = op.viva ? [epochNY(hoy, 9 + Math.floor((30 + 15 * k) / 60), (30 + 15 * k) % 60), op.viva[0], op.viva[1], op.viva[2], op.viva[3], 800] : null;
  const niveles = {}; if (op.spot != null) niveles.spot = op.spot; if (op.cierre_ayer != null) niveles.cierre_ayer = op.cierre_ayer;
  return { symbol: sym, tf: 'm15', actualizado_at: op.actualizado_at,
    payload: { ticker: sym, tf: 'm15', fecha_ny: op.fecha_ny, velas, vela_viva: viva, niveles, schema_version: 1 } };
}
const HOY_FIJO = '2026-10-12';   // lunes

(async () => {
  // ════════════════ 1. el título sin «(E5)» ════════════════
  {
    const vi = extraer('vistaInforme');
    assert(!/\(E5\)/.test(vi) && /seccionSenales\('SEÑALES DE HOY', sen,/.test(vi), 'B3: vistaInforme titula «SEÑALES DE HOY» (sin «(E5)»)');
    assert(/seccionSenales\('SEÑALES DE HOY', senales,/.test(extraer('vistaCopiloto')), 'y es el mismo título del Copiloto');
    assert(!/SEÑALES DE HOY \(E5\)/.test(FUENTE), 'no queda ningún «SEÑALES DE HOY (E5)» en el fuente');
  }

  // ════════════════ 2. lineasGtcSenal: Plan 10 (orden y estilos) y Plan 35 (como antes) ════════════════
  {
    const L = construir(['lineasGtcSenal'], { esc }, { consts: ['PLANES'] });
    const INS = 'al llenarte pon YA tu venta límite GTC a fill×(1+35/100)+$0.02';
    const h10 = L.lineasGtcSenal(INS, L.PLANES.PLAN_10);
    const iPlan = h10.indexOf('Tu plan (manda): GTC +10% · corte -20%'), iDoc = h10.indexOf('doctrina del curso (Plan 35%): ' + INS);
    assert(iPlan >= 0 && iDoc > iPlan, 'Plan 10: «Tu plan (manda): GTC +10% · corte -20%» PRIMERO y la doctrina del curso DEBAJO', h10);
    assert(/^<div class="mono gtcplan">Tu plan \(manda\)/.test(h10) && /<div class="mono gtcdoc">doctrina del curso \(Plan 35%\): /.test(h10), 'Plan 10: el plan con .gtcplan (grande) y la doctrina con .gtcdoc (pequeña y gris)');
    assert(!/var\(--oro\)/.test(h10) && !/Doctrina Plan 35%/.test(h10), 'Plan 10: la doctrina ya no va en dorado ni como «Doctrina Plan 35%:» arriba');
    igual(L.lineasGtcSenal(null, L.PLANES.PLAN_10), '<div class="mono gtcplan">Tu plan (manda): GTC +10% · corte -20%</div>', 'Plan 10 sin instrucción: solo la línea del plan propio');
    assert(/doctrina del curso \(Plan 35%\): a&lt;b&gt;/.test(L.lineasGtcSenal('a<b>', L.PLANES.PLAN_10)), 'la instrucción de la señal (texto de la base) va escapada');
    // Plan 35: EXACTAMENTE la cadena de antes (v62): `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(instruccion)}</div>`
    igual(L.lineasGtcSenal(INS, L.PLANES.PLAN_35), `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(INS)}</div>`, 'Plan 35: la línea de siempre, idéntica a la v62');
    igual([L.lineasGtcSenal(null, L.PLANES.PLAN_35), L.lineasGtcSenal('', L.PLANES.PLAN_35), L.lineasGtcSenal(INS, null)], ['', '', `<div class="mut mono" style="margin-top:6px;color:var(--oro)">${esc(INS)}</div>`], 'Plan 35 sin instrucción: nada; sin plan: como el Plan 35');
    assert(/\$\{lineasGtcSenal\(s\.instruccion_gtc, plan\)\}/.test(extraer('tarjetaSenal')) && /lineasGtcSenal\(s\.instruccion_gtc, plan\)/.test(extraer('tarjetaSenalInforme')), 'el Copiloto (tarjetaSenal) y el Informe usan la MISMA lineasGtcSenal: se ve igual en los dos');
    const cssPlan = (INDEX.match(/\n  \.gtcplan\{([^}]*)\}/) || [])[1] || '', cssDoc = (INDEX.match(/\n  \.gtcdoc\{([^}]*)\}/) || [])[1] || '';
    const fs1 = Number((/font-size:([\d.]+)px/.exec(cssPlan) || [])[1]), fs2 = Number((/font-size:([\d.]+)px/.exec(cssDoc) || [])[1]);
    assert(fs1 > fs2 && fs1 >= 14 && /font-weight:700/.test(cssPlan) && /color:var\(--azul\)/.test(cssPlan) && /color:var\(--tx3\)/.test(cssDoc), 'CSS: .gtcplan grande y en negrita (azul), .gtcdoc pequeña y gris (fuera de cualquier @media: igual en Copiloto e Informe)', cssPlan + ' | ' + cssDoc);
  }

  // ════════════════ 3. B1 · el detalle de una señal ════════════════
  {
    const D = construir(['detalleSenalInforme', 'estrategiaSenal', 'horaNY'], { esc }, { consts: ['decDe', 'ESTRATEGIA_NOMBRE'] });
    const meta = { id: 29, symbol: 'META', estrategia_id: 'E8', direccion: 'CALL', titulo: '🐟 CT15A · COMPRAR CALL · META', spot: 736.8, creado_at: '2026-10-12T13:31:27+00:00',
      rango_vivo: { hi: 104.0, lo: 208.0, exp: '2026-10-12', dte: 0, spot: 736.8 },
      payload: { ticket: { ask: 5.45, exp: '2026-10-12', strike: 737.5, direccion: 'CALL', rango: [208, 104] }, detector: 'E8 CT15A · cambio de tendencia en 15 min al alza' } };
    igual(D.estrategiaSenal(meta), { id: 'E8', codigo: 'CT15A', nombre: 'cambio de tendencia 15 min' }, 'estrategiaSenal: el id de la base (E8) y el código con nombre del detector (CT15A → «cambio de tendencia 15 min»)');
    igual(D.estrategiaSenal({ estrategia_id: 'E5', titulo: '🐟 E5 · COMPRAR PUT · SPY' }), { id: 'E5', codigo: null, nombre: '' }, 'E5 (sin nombre en la tabla): solo el id, nada inventado');
    igual(D.estrategiaSenal({ estrategia_id: 'E9', titulo: 'CT15B · COMPRAR PUT · SPY' }).codigo, 'CT15B', 'CT15B también se reconoce (por el título)');
    igual(D.estrategiaSenal({ estrategia_id: 'E8', titulo: 'XCT15AX' }).codigo, null, 'un código pegado a otras letras no cuenta');
    const h = D.detalleSenalInforme(meta);
    assert(/<div class="infdet">/.test(h) && /estrategia <b>E8 · CT15A<\/b> cambio de tendencia 15 min/.test(h), 'la estrategia con su nombre corto', h);
    assert(/sonó <b>09:31 ET<\/b>/.test(h), 'la hora NY a la que sonó (13:31Z → 09:31 ET)');
    assert(/acción al sonar <b>\$736\.80<\/b>/.test(h), 'el spot de la acción al sonar (senales.spot)');
    assert(/rango óptimo <b>—<\/b> rango inválido \(mín &gt; máx\)/.test(h) && !/\$208–\$104/.test(h) && !/\$104–\$208/.test(h), 'un rango_vivo invertido (lo 208 > hi 104, el de la captura) NUNCA se pinta: «—» y «rango inválido»');
    assert(/contrato sugerido <b>CALL 737\.5<\/b> · vence 10-12 · ask \$5\.45/.test(h), 'el contrato sugerido del payload.ticket');
    const ok = D.detalleSenalInforme({ ...meta, rango_vivo: { lo: 104, hi: 208.4, exp: '2026-10-14' } });
    assert(/rango óptimo <b>\$104–\$208<\/b> por contrato · por delta · exp 10-14/.test(ok), 'un rango válido: lo–hi por contrato (redondeado, como la tarjeta del ticker) y su expiración', ok);
    const sin = D.detalleSenalInforme({ id: 5, symbol: 'SPY', estrategia_id: 'E5', titulo: 'E5 · COMPRAR PUT · SPY', creado_at: '2026-10-12T13:45:31Z' });
    assert(/estrategia <b>E5<\/b><\/span>/.test(sin) && /sonó <b>09:45 ET<\/b>/.test(sin) && !/acción al sonar/.test(sin) && !/rango óptimo/.test(sin) && !/contrato sugerido/.test(sin), 'sin spot, rango ni ticket: solo estrategia y hora (nada inventado)', sin);
    igual(D.detalleSenalInforme({ id: 6, symbol: 'SPY' }), '', 'sin nada que decir: cadena vacía');
    igual(D.detalleSenalInforme(null), '', 'null no revienta');
    const raro = D.detalleSenalInforme({ symbol: 'SPY', estrategia_id: '<b>E5</b>', spot: 'abc', creado_at: 'no-fecha', rango_vivo: { lo: null, hi: 5 }, payload: { ticket: { strike: 'x' } } });
    assert(/&lt;b&gt;E5&lt;\/b&gt;/.test(raro) && !/NaN|undefined|Invalid/.test(raro) && !/sonó|acción al sonar|rango óptimo|contrato sugerido/.test(raro), 'datos raros: escapados y sin NaN ni campos inventados', raro);
    const spx = D.detalleSenalInforme({ symbol: 'SPX', estrategia_id: 'E5', spot: 6712.4 });
    assert(/acción al sonar <b>\$6712<\/b>/.test(spx), 'SPX sin decimales (decDe)');
  }

  // ════════════════ 4. B2 · los números del día de un ticker ════════════════
  {
    const T = construir(['datosTickerHoy', 'detalleTickerHtml', 'chartTiempo', 'fmtFechaNY', 'inicioVelasHoy'], { esc, haceCuanto, colUtil }, { consts: ['decDe'] });
    const f = filaVelas('AAPL', HOY_FIJO);
    const d = T.datosTickerHoy(f, HOY_FIJO);
    igual([d.spot, d.cierreAyer, d.apertura, d.max, d.min, d.velasHoy, d.conViva, d.sesion], [103.2, 100, 100, 103.4, 98.7, 5, true, null], 'con velas de hoy y la viva: spot del worker, apertura = la primera de hoy, máx de la VIVA (103.4) y mín de una cerrada (98.7); las de ayer (máx 140 / mín 50) no cuentan');
    cerca(d.cambio, 3.2, 'cambio vs el cierre de ayer en $');
    cerca(d.pct, 3.2, 'y en %');
    const sinViva = T.datosTickerHoy(filaVelas('AAPL', HOY_FIJO, { viva: null }), HOY_FIJO);
    igual([sinViva.max, sinViva.min, sinViva.velasHoy, sinViva.conViva], [102, 98.7, 4, false], 'sin vela viva: máx/mín de las cerradas de hoy');
    const fv = filaVelas('AAPL', HOY_FIJO); fv.payload.vela_viva = fv.payload.velas[fv.payload.velas.length - 1].slice(); fv.payload.vela_viva[2] = 999;
    igual(T.datosTickerHoy(fv, HOY_FIJO).velasHoy, 4, 'una viva con el mismo instante que una cerrada no se cuenta dos veces');
    const sinSpot = T.datosTickerHoy(filaVelas('AAPL', HOY_FIJO, { spot: null }), HOY_FIJO);
    igual(sinSpot.spot, 103.2, 'sin niveles.spot: el cierre de la última vela de HOY (la viva)');
    const sinAyer = T.datosTickerHoy(filaVelas('AAPL', HOY_FIJO, { cierre_ayer: null }), HOY_FIJO);
    igual([sinAyer.cambio, sinAyer.pct], [null, null], 'sin cierre de ayer: sin cambio (nunca un número inventado)');
    const otraSesion = T.datosTickerHoy(filaVelas('AAPL', '2026-10-09', { fecha_ny: '2026-10-09' }), HOY_FIJO);
    igual([otraSesion.spot, otraSesion.apertura, otraSesion.max, otraSesion.min, otraSesion.velasHoy, otraSesion.sesion], [103.2, null, null, null, 0, '2026-10-09'], 'velas solo de otra sesión (viernes): spot y cambio de esa foto, sin apertura/máx/mín de hoy, y se dice de qué sesión es');
    igual([T.datosTickerHoy(null, HOY_FIJO), T.datosTickerHoy({ payload: { velas: [] } }, HOY_FIJO), T.datosTickerHoy({ payload: { velas: [['x', 1, 2, 3, 4]] } }, HOY_FIJO)], [null, null, null], 'sin velas (o mal formadas): null');

    // HTML · teléfono: una línea; computadora: casillas
    const tel = T.detalleTickerHtml(d, 'AAPL', false);
    assert(/^<div class="mut infdet1">spot <b>\$103\.20<\/b> · <b style="color:var\(--verde\)">\+\$3\.20 \(\+3\.20 %\)<\/b> vs ayer · apertura \$100\.00 · máx \$103\.40 · mín \$98\.70 · <span class="fresco">hace segundos<\/span><\/div>$/.test(tel), 'teléfono: spot, cambio en $ y %, apertura, máx y mín de hoy y la antigüedad en UNA línea', tel);
    assert(!/infnum/.test(tel), 'teléfono: sin casillas');
    const pc = T.detalleTickerHtml(d, 'AAPL', true);
    igual((pc.match(/<div( class="[^"]*")?><span>/g) || []).length, 5, 'computadora: cinco casillas (spot, vs cierre ayer, apertura, máx y mín de hoy)');
    assert(/<div class="infnum"><div><span>spot<\/span><b class="mono">\$103\.20<\/b><\/div><div class="infcamb"><span>vs cierre ayer<\/span><b class="mono" style="color:var\(--verde\)">\+\$3\.20 \(\+3\.20 %\)<\/b><\/div><div><span>apertura hoy<\/span><b class="mono">\$100\.00<\/b><\/div><div><span>máx hoy<\/span><b class="mono">\$103\.40<\/b><\/div><div><span>mín hoy<\/span><b class="mono">\$98\.70<\/b><\/div><\/div>/.test(pc), 'computadora: las casillas en su orden', pc);
    assert(/cierre de ayer \$100\.00/.test(pc), 'y debajo la antigüedad del spot y el cierre de ayer');
    const baja = T.detalleTickerHtml(T.datosTickerHoy(filaVelas('TSLA', HOY_FIJO, { spot: 379.25, cierre_ayer: 382.7 }), HOY_FIJO), 'TSLA', false);
    assert(/<b style="color:var\(--rojo\)">-\$3\.45 \(-0\.90 %\)<\/b>/.test(baja), 'a la baja: «-$3.45 (-0.90 %)» en rojo', baja);
    igual(T.detalleTickerHtml(null, 'AAPL', false), '<div class="mut infdet1">sin velas todavía</div>', 'sin velas (teléfono): «sin velas todavía»');
    igual(T.detalleTickerHtml(null, 'AAPL', true), '<div class="mut infdet1">sin velas todavía</div>', 'sin velas (computadora): lo mismo, nunca un número inventado');
    const telV = T.detalleTickerHtml(otraSesion, 'AAPL', false), pcV = T.detalleTickerHtml(otraSesion, 'AAPL', true);
    assert(/hoy sin velas todavía/.test(telV) && /sesión del 09 oct/.test(telV) && !/apertura|máx|mín/.test(telV), 'velas de otra sesión (teléfono): «hoy sin velas todavía» y la sesión de la foto', telV);
    assert(/<div class="infhoy"><span>hoy<\/span><b>sin velas todavía<\/b><\/div>/.test(pcV) && !/apertura hoy/.test(pcV) && /sesión del 09 oct/.test(pcV), 'velas de otra sesión (computadora): la casilla «hoy: sin velas todavía»');
    const plano = T.detalleTickerHtml(T.datosTickerHoy(filaVelas('SPY', HOY_FIJO, { spot: 100, cierre_ayer: 100 }), HOY_FIJO), 'SPY', false);
    assert(/<b style="color:var\(--tx2\)">\$0\.00 \(0\.00 %\)<\/b>/.test(plano), 'sin cambio: «$0.00 (0.00 %)» sin signo ni color', plano);
    assert(!/NaN|undefined/.test(tel + pc + telV + pcV + plano), 'ningún NaN ni undefined');
    igual([T.inicioVelasHoy(f.payload, HOY_FIJO), T.inicioVelasHoy(f.payload, '2026-10-13'), T.inicioVelasHoy(null, HOY_FIJO)], [6, -1, -1], 'inicioVelasHoy: el índice de la primera vela de hoy (tras las 6 de ayer)');
  }

  // ════════════════ 5. «Mercado ahora» y «Tu plan hoy» ════════════════
  {
    const V = construir(['ventanaSenalesTxt'], {}, { consts: ['VENTANA_SENALES_MIN'] });
    const en = (hh, mm, ymd) => new Date(epochNY(ymd || HOY_FIJO, hh, mm) * 1000);
    assert(/Próxima ventana de señales: <b[^>]*>hoy 9:30–9:48 ET<\/b> \(en 30 min\)/.test(V.ventanaSenalesTxt(en(9, 0))), 'a las 9:00 ET: la próxima ventana es hoy 9:30–9:48 (en 30 min)');
    assert(/\(en 2 h 15 min\)/.test(V.ventanaSenalesTxt(en(7, 15))) && /\(en 1 h\)/.test(V.ventanaSenalesTxt(en(8, 30))), 'faltas en h y min');
    assert(/abierta ahora/.test(V.ventanaSenalesTxt(en(9, 30))) && /abierta ahora/.test(V.ventanaSenalesTxt(en(9, 48))), 'de 9:30 a 9:48: abierta ahora');
    igual([V.ventanaSenalesTxt(en(9, 49)), V.ventanaSenalesTxt(en(14, 0)), V.ventanaSenalesTxt(en(9, 0, '2026-10-10'))], ['', '', ''], 'ya pasó (9:49, 14:00) o fin de semana: nada');

    const fakeHoy = () => HOY_FIJO;
    const M = construir(['tarjetaMercadoAhora', 'antesDe1030NY', 'ventanaSenalesTxt'], { esc, haceCuanto, hoyNY: fakeHoy }, { consts: ['VENTANA_SENALES_MIN'] });
    const merc = { symbol: 'MERCADO', sesion: 'regular', actualizado_at: new Date().toISOString(), payload: { fecha_ny: HOY_FIJO, sesion: 'regular', regla_1030: true, avisos_globales: ['FED a las 14:00 <hoy>', 'CPI mañana'] } };
    const hm = M.tarjetaMercadoAhora(merc, null, HOY_FIJO, en(9, 10));
    assert(/<h3>Mercado ahora<\/h3>/.test(hm) && /Sesión <b[^>]*>regular \(9:30–16:00 ET\)<\/b>/.test(hm) && /antes de las 10:30 ET<\/b>: la doctrina espera/.test(hm), 'Mercado ahora: la sesión y la regla de las 10:30 del payload MERCADO de hoy', hm);
    assert(/hoy 9:30–9:48 ET<\/b> \(en 20 min\)/.test(hm), 'y la ventana de señales si aún no pasó');
    assert(/Avisos globales:/.test(hm) && /<div>· FED a las 14:00 &lt;hoy&gt;<\/div><div>· CPI mañana<\/div>/.test(hm), 'los avisos globales, todos y escapados');
    const viejo = M.tarjetaMercadoAhora({ ...merc, sesion: 'cerrado', payload: { ...merc.payload, fecha_ny: '2026-10-09' } }, { sesion: 'pre' }, HOY_FIJO, en(14, 0));
    assert(/El estado de MERCADO aún no es de hoy/.test(viejo) && !/FED/.test(viejo) && /pre-mercado/.test(viejo) && !/ventana de señales/i.test(viejo), 'un MERCADO de otro día no se presenta como de hoy (sus avisos no salen; la sesión, del latido)', viejo);
    assert(/Sin estado de MERCADO todavía/.test(M.tarjetaMercadoAhora(null, null, HOY_FIJO, en(14, 0))) && /Sesión <b[^>]*>sin dato/.test(M.tarjetaMercadoAhora(null, null, HOY_FIJO, en(14, 0))), 'sin MERCADO ni latido: lo dice');
    assert(/Sin avisos globales hoy/.test(M.tarjetaMercadoAhora({ ...merc, payload: { ...merc.payload, avisos_globales: [] } }, null, HOY_FIJO, en(14, 0))), 'sin avisos: «Sin avisos globales hoy.»');

    const P = construir(['tarjetaPlanHoy', 'focoDeHoy', 'lunesNY'], { esc }, { consts: ['PLANES', 'OPS_SEMANA'] });
    const op = (dia) => ({ symbol: 'AAPL', direccion: 'CALL', abierta_fecha_ny: dia });
    const h10 = P.tarjetaPlanHoy(P.PLANES.PLAN_10, { ops: [op(HOY_FIJO), op('2026-10-09')] }, HOY_FIJO, { symbol_foco: 'aapl', foco_fecha: HOY_FIJO });
    assert(/<h3>Tu plan hoy<\/h3>/.test(h10) && /color:var\(--oro\)">1 \/ 1</.test(h10) && /Plan 10% · operaciones de hoy/.test(h10), 'Plan 10: operaciones de HOY contra el cupo (1 / 1, la del viernes no cuenta)', h10);
    assert(/objetivo GTC \+10% · corte -20% · 1 operación al día · 30–50% de la cuenta/.test(h10) && /Compañía de hoy: <b[^>]*>AAPL<\/b>/.test(h10), 'objetivo, corte y la compañía de hoy');
    assert(!/onclick|elegirFoco|<button/.test(h10), 'SOLO lectura: sin los botones de la compañía (escriben en plan_usuario)');
    assert(/Compañía de hoy: sin elegir/.test(P.tarjetaPlanHoy(P.PLANES.PLAN_10, { ops: [] }, HOY_FIJO, { symbol_foco: 'AAPL', foco_fecha: '2026-10-09' })), 'foco de otro día: sin elegir');
    const err = P.tarjetaPlanHoy(P.PLANES.PLAN_10, { ops: null, error: 'x' }, HOY_FIJO, null);
    assert(/>— \/ 1</.test(err) && /no pude leer tus operaciones/.test(err) && !/>0 \/ 1</.test(err), 'sin poder leer: «— / 1» y lo dice (jamás «0» por no haber podido preguntar)');
    const h35 = P.tarjetaPlanHoy(P.PLANES.PLAN_35, { ops: [] }, HOY_FIJO, null);
    assert(/>0 \/ 3</.test(h35) && /Plan 35% · operaciones esta semana/.test(h35) && /objetivo GTC \+35% · sin corte · 3 operaciones por semana · máximo 10% de la cuenta/.test(h35) && !/Compañía/.test(h35), 'Plan 35: el cupo SEMANAL, objetivo +35% y sin corte', h35);
    assert(/>0 \/ 3</.test(P.tarjetaPlanHoy(null, { ops: [] }, HOY_FIJO, null)), 'sin plan: Plan 35');
  }

  // ════════════════ 6. vistaInforme REAL a 1400 y a 390, informeAncho, resize y CSS ════════════════
  {
    const hoy = C.ymdNY();
    const VEL = [filaVelas('AAPL', hoy), filaVelas('NVDA', hoy, { spot: 226.41, cierre_ayer: 229.28 }), filaVelas('SPY', ymdMenos(hoy, 3), { fecha_ny: ymdMenos(hoy, 3) }), filaVelas('META', hoy, { hoy: [[700, 701, 699, 700.5]] })];   // TSLA sin fila
    const EST = [
      { symbol: 'MERCADO', sesion: 'regular', actualizado_at: new Date().toISOString(), payload: { fecha_ny: hoy, sesion: 'regular', regla_1030: false, avisos_globales: ['FED <hoy>'] } },
      { symbol: 'AAPL', actualizado_at: new Date().toISOString(), payload: { tendencias: { m15: 'alcista', hora: 'lateral', dia: 'alcista' }, avisos: ['uno <b>', 'dos', 'tres'], rango_academia: { lo: 20, hi: 50 } } },
      { symbol: 'NVDA', actualizado_at: new Date().toISOString(), payload: { tendencias: {}, avisos: [] } },
    ];
    const SEN = [
      { id: 29, fecha_ny: hoy, symbol: 'META', estrategia_id: 'E8', direccion: 'CALL', titulo: '🐟 CT15A · COMPRAR CALL · META', motivo: 'salto <de> apertura', instruccion_gtc: 'al llenarte pon YA tu venta límite GTC a fill×(1+35/100)+$0.02', spot: 736.8, creado_at: new Date(Date.now() - 4 * 3600000).toISOString(),
        rango_vivo: { lo: 208, hi: 104, exp: hoy }, payload: { ticket: { ask: 5.45, exp: hoy, strike: 737.5, direccion: 'CALL' }, detector: 'E8 CT15A · cambio de tendencia en 15 min al alza' } },
      { id: 30, fecha_ny: hoy, symbol: 'SPY', estrategia_id: 'E5', direccion: 'PUT', titulo: '🐟 E5 · COMPRAR PUT · SPY', motivo: 'ruptura', instruccion_gtc: null, creado_at: new Date().toISOString() },
    ];
    async function correr(ancho, op) {
      op = op || {};
      const sb = sbFalso((tabla) => {
        if (tabla === 'ticker_estado') return { data: EST, error: null };
        if (tabla === 'senales') return { data: SEN, error: null };
        if (tabla === 'ticker_velas') return { data: VEL, error: null };
        if (tabla === 'plan_usuario') return { data: { user_id: 'u1', plan: op.plan || 'PLAN_10', symbol_foco: 'NVDA', foco_fecha: hoy }, error: null };
        if (tabla === 'posiciones') return op.posError ? { data: null, error: { message: 'timeout' } } : { data: [{ id: 1, symbol: 'NVDA', direccion: 'CALL', strike: 230, expiracion: hoy, estado: 'abierta', abierta_fecha_ny: hoy, prima_fill: 1.2, contratos: 1, broker: 'etrade' }], error: null };
        if (tabla === 'broker_trades') return { data: [], error: null };
        return { data: [], error: null };
      });
      const canal = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
      const mod = C.cargarModuloEntero({ src: './app/main.js?v=63', hash: '#/informe', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
      if (!mod.cargo) return { error: mod.error };
      await respirar();
      mod.win.innerWidth = ancho;
      let html = '';
      const clases = new Set(op.clases || []);
      const app = nodo({ classList: { toggle: (c, on) => { if (on === undefined ? !clases.has(c) : on) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } });
      mod.win.document.querySelector = (s) => { if (s === '#app') return app; const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; };
      mod.ev("sesionActiva = { user: { id: 'u1' } };");
      mod.win.__hb = { latido_at: new Date().toISOString(), estado_proceso: 'vigilando', sesion: 'regular' };
      let revento = null;
      try { await mod.ev('vistaInforme(window.__hb)'); } catch (e) { revento = String((e && e.stack) || e); }
      return { html, clases, revento, mod, llamadas: sb.llamadas };
    }
    const escribe = (ll) => ll.some(l => l.cadena.some(c => ['insert', 'update', 'upsert', 'delete'].includes(c[0])));

    const W = await correr(1400);
    assert(!W.error && !W.revento, 'vistaInforme corre entera en el DOM de juguete a 1400 px', W.error || W.revento);
    assert(W.clases.has('inf') && W.clases.has('ancho'), 'a 1400 px: #app.inf y #app.ancho', [...W.clases].join(','));
    const arriba = (W.html.match(/<div class="infarriba">([\s\S]*?)<\/div>\s*<div class="infsen">/) || [])[1] || '';
    assert(/<h3>Estado del sistema<\/h3>[\s\S]*<h3>Mercado ahora<\/h3>[\s\S]*<h3>Tu plan hoy<\/h3>/.test(arriba), 'arriba, en una fila: Estado del sistema, Mercado ahora y Tu plan hoy (en ese orden)');
    assert(/FED &lt;hoy&gt;/.test(arriba) && /color:var\(--oro\)">1 \/ 1</.test(arriba) && /Compañía de hoy: <b[^>]*>NVDA<\/b>/.test(arriba), 'Mercado ahora con el aviso global (escapado) y Tu plan hoy con la operación de hoy (1 / 1) y la compañía');
    assert(/<div class="infsen"><div class="sec fila">SEÑALES DE HOY<span class="acc">/.test(W.html) && !/\(E5\)/.test(W.html), 'debajo, la sección SEÑALES DE HOY (sin «(E5)») dentro de su rejilla, con sus enlaces');
    assert(/estrategia <b>E8 · CT15A<\/b> cambio de tendencia 15 min/.test(W.html) && /rango inválido/.test(W.html) && /contrato sugerido <b>CALL 737\.5<\/b>/.test(W.html) && /salto &lt;de&gt; apertura/.test(W.html), 'la señal con su detalle B1 y el motivo escapado');
    assert(W.html.indexOf('Tu plan (manda): GTC +10%') > 0 && W.html.indexOf('Tu plan (manda): GTC +10%') < W.html.indexOf('doctrina del curso (Plan 35%)'), 'con el Plan 10: «Tu plan (manda)» antes que la doctrina');
    assert(/<div class="sec">TUS TICKERS<\/div><div class="inftk">/.test(W.html), 'y TUS TICKERS en su rejilla');
    igual((W.html.match(/viewBox="0 0 380 120"/g) || []).length, 2, 'mini gráfico (chartSvg real, w 380; h 110 → el piso de 120 del propio chartSvg) en AAPL y NVDA, que tienen ≥ 2 velas cerradas de hoy');
    assert(/onclick="MZ\.chartAbrir\('AAPL'\)"/.test(W.html) && /class="chart infchart"/.test(W.html), 'tocar el gráfico abre la hoja (MZ.chartAbrir), como en Tickers');
    assert(!/chartSel|perbtn/.test(W.html), 'sin selectores');
    igual((W.html.match(/Sin velas de hoy todavía/g) || []).length, 3, 'TSLA (sin fila), SPY (solo velas de otra sesión) y META (una sola vela de hoy): «Sin velas de hoy todavía» en vez de un gráfico');
    assert(/<div class="mut infdet1">sin velas todavía<\/div>/.test(W.html), 'TSLA sin velas: «sin velas todavía»');
    assert(/<div class="infnum"><div><span>spot<\/span><b class="mono">\$103\.20<\/b>/.test(W.html) && /\+\$3\.20 \(\+3\.20 %\)/.test(W.html), 'AAPL con sus casillas del día');
    assert(/<div class="mut infav" style="margin-top:7px"><div>· uno &lt;b&gt;<\/div><div>· dos<\/div><div>· tres<\/div><\/div>/.test(W.html), 'en la computadora TODOS los avisos del ticker (escapados)');
    assert(!escribe(W.llamadas), 'el Informe solo LEE: nada se escribe en la base');
    assert(!/MZ\.elegirFoco|MZ\.abrirOrden|MZ\.abrirFill/.test(W.html), 'y no lleva botones que escriban o manden órdenes');
    assert(W.llamadas.some(l => l.tabla === 'posiciones') && W.llamadas.some(l => l.tabla === 'broker_trades'), 'en la computadora lee tus operaciones (para «Tu plan hoy»)');
    const vt = W.llamadas.filter(l => l.tabla === 'ticker_velas');
    assert(vt.length === 1 && vt[0].cadena.some(c => c[0] === 'eq' && c[1][0] === 'tf' && c[1][1] === 'm15'), 'las velas m15 en UNA consulta (cargarVelas, caché de 50 s)');
    igual(W.mod.ev('_inf.grande'), true, 'deja anotado el formato (para el resize)');
    {
      const n0 = W.llamadas.filter(l => l.tabla === 'broker_trades').length;
      await W.mod.ev('Promise.all([vistaInforme(window.__hb), vistaInforme(window.__hb)])');
      igual(W.llamadas.filter(l => l.tabla === 'broker_trades').length, n0, 'tus operaciones con caché de 60 s: dos redibujos seguidos (Realtime) no vuelven a pedir broker_trades');
      W.mod.ev("_inf.ops.ts = Date.now() - 61000;");
      await W.mod.ev('Promise.all([vistaInforme(window.__hb), vistaInforme(window.__hb)])');
      igual(W.llamadas.filter(l => l.tabla === 'broker_trades').length, n0 + 1, 'pasado el minuto, UNA lectura nueva aunque lleguen dos redibujos a la vez');
      W.mod.ev("sesionActiva = { user: { id: 'u2' } };");
      await W.mod.ev('vistaInforme(window.__hb)');
      igual(W.llamadas.filter(l => l.tabla === 'broker_trades').length, n0 + 2, 'otro usuario en el mismo equipo: no hereda la caché');
      W.mod.ev("sesionActiva = { user: { id: 'u1' } };");
    }
    W.mod.win.innerWidth = 390; igual(W.mod.ev('informeCambiaFormato()'), true, 'informeCambiaFormato: de 1400 a 390 cruza los 900 px');
    W.mod.win.innerWidth = 1800; igual(W.mod.ev('informeCambiaFormato()'), false, 'de 1400 a 1800, no');

    const T = await correr(390, { clases: ['ancho'] });
    assert(!T.revento, 'vistaInforme a 390 px no revienta', T.revento);
    assert(T.clases.has('inf') && !T.clases.has('ancho'), 'a 390 px: #app.inf pero SIN #app.ancho', [...T.clases].join(','));
    assert(!/<svg/.test(T.html) && !/infchart/.test(T.html), 'a 390 px: sin gráfico');
    assert(!/infarriba|infsen|inftk|infnum/.test(T.html) && !/Mercado ahora|Tu plan hoy/.test(T.html), 'a 390 px: la estructura del teléfono (sin la fila de tres tarjetas ni rejillas)');
    assert(/^<div class="card"><div class="fila"><h3>Estado del sistema<\/h3>/.test(T.html) && /<div class="sec fila">SEÑALES DE HOY<span/.test(T.html) && /<div class="sec">TUS TICKERS<\/div><div class="card">/.test(T.html), 'el orden de siempre: estado, señales, tickers');
    assert(/<div class="mut infdet1">spot <b>\$103\.20<\/b> · <b style="color:var\(--verde\)">\+\$3\.20 \(\+3\.20 %\)<\/b> vs ayer · apertura/.test(T.html), 'cada ticker con el detalle B2 en una línea');
    assert(/<div class="mut" style="margin-top:7px">uno &lt;b&gt;<\/div>/.test(T.html) && !/· dos/.test(T.html), 'en el teléfono, el primer aviso como siempre');
    assert(/estrategia <b>E8 · CT15A<\/b>/.test(T.html) && /<div class="mono gtcplan">Tu plan \(manda\)/.test(T.html), 'la señal con su detalle B1 también en el teléfono');
    assert(!T.llamadas.some(l => l.tabla === 'posiciones' || l.tabla === 'broker_trades' || l.tabla === 'fills'), 'en el teléfono no se leen tus operaciones (no hay tarjeta que las use)');
    assert(!escribe(T.llamadas), 'a 390 tampoco se escribe nada');

    const E = await correr(1400, { posError: true, plan: 'PLAN_35' });
    assert(!E.revento && />— \/ 3</.test(E.html) && /no pude leer tus operaciones/.test(E.html), 'con la lectura de posiciones en error: «— / 3» y lo dice; el resto del Informe sale igual');
    {
      const n0 = E.llamadas.filter(l => l.tabla === 'posiciones').length;
      await E.mod.ev('vistaInforme(window.__hb)');
      igual(E.llamadas.filter(l => l.tabla === 'posiciones').length, n0 + 1, 'un error no se guarda en la caché: la siguiente vuelta vuelve a preguntar');
    }
    assert(/<div class="mut mono" style="margin-top:6px;color:var\(--oro\)">al llenarte pon YA/.test(E.html) && !/gtcplan/.test(E.html), 'con el Plan 35 la línea de la señal sale como siempre');

    // cambió de pestaña mientras cargaba: no pinta encima
    {
      const Z = await correr(1400);
      Z.mod.ev("location.hash = '#/copiloto';");
      let pintado = false;
      Z.mod.win.document.querySelector = (s) => { const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set() { pintado = true; }, get() { return ''; } }); return n; };
      await Z.mod.ev('vistaInforme(window.__hb)');
      assert(!pintado, 'si mientras cargaba se cambió de pestaña, no pinta encima de lo que hay ahora');
    }

    // informeAncho con ruta(): se pone en el Informe y se quita al ir a otra pestaña
    {
      const R = await correr(1400);
      const M2 = R.mod;
      const clases = new Set(['inf', 'ancho']);
      const app = nodo({ classList: { toggle: (c, on) => { if (on === undefined ? !clases.has(c) : on) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } });
      M2.win.document.querySelector = (s) => (s === '#app' ? app : nodo());
      M2.win.innerWidth = 1400;
      M2.ev("location.hash = '#/disciplina';");
      M2.ev('ruta().catch(() => {})');
      assert(!clases.has('inf') && !clases.has('ancho'), 'ruta() hacia Disciplina: quita .inf (y .ancho, por diarioAncho)', [...clases].join(','));
      M2.ev("location.hash = '#/informe';");
      M2.ev('ruta().catch(() => {})');
      assert(clases.has('inf') && clases.has('ancho'), 'ruta() de vuelta al Informe a 1400: .inf y .ancho en el mismo tick', [...clases].join(','));
      M2.ev("location.hash = '#/tickers';");
      M2.ev('ruta().catch(() => {})');
      assert(!clases.has('inf') && clases.has('tk') && clases.has('ancho'), 'ruta() hacia Tickers: sin .inf, con las clases de Tickers', [...clases].join(','));
      M2.win.innerWidth = 390;
      M2.ev("location.hash = '#/informe';");
      M2.ev('ruta().catch(() => {})');
      assert(clases.has('inf') && !clases.has('ancho') && !clases.has('tk'), 'ruta() al Informe a 390: .inf sin .ancho', [...clases].join(','));
      await respirar();
    }
    {
      const app = { classList: null };
      let ok2 = true; try { construir(['informeAncho', 'informeGrande'], { $: () => app, anchoVista: () => 1400 }, { consts: ['GESTOR_ANCHO_TABLA'] }).informeAncho(true); construir(['informeAncho', 'informeGrande'], { $: () => null, anchoVista: () => 1400 }, { consts: ['GESTOR_ANCHO_TABLA'] }).informeAncho(true); } catch (_) { ok2 = false; }
      assert(ok2, 'informeAncho sin #app (o sin classList) no revienta');
    }
    assert(/if \(typeof informeAncho === 'function'\) informeAncho\(tab === 'informe'\);/.test(extraer('ruta')), 'ruta() pone y quita #app.inf al cambiar de pestaña (junto a tickersAncho)');
    assert(/\(tab === 'informe' && informeCambiaFormato\(\)\) \|\| \(tab === 'cuentas' && ctaCambiaFormato\(\)\)\) ruta\(\);/.test(FUENTE), 'el handler de resize redibuja el Informe si cruza los 900 px');
    // las funciones nuevas no preguntan con cuadros nativos ni escriben
    const nuevas = ['vistaInforme', 'tarjetaEstadoSistema', 'tarjetaMercadoAhora', 'opsInforme', 'tarjetaPlanHoy', 'tarjetaSenalInforme', 'detalleSenalInforme', 'datosTickerHoy', 'detalleTickerHtml', 'miniChartInforme', 'tarjetaTickerInforme', 'informeAncho'].map(extraer).join('\n');
    assert(!/confirm\(|prompt\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(nuevas), 'sin confirm()/prompt() y sin escrituras en la base');
  }

  // ════════════════ 7. CSS y versión ════════════════
  {
    const css = (INDEX.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    const media = css.split('@media (min-width:900px){').slice(1).join('\n');
    assert(/#app\.ancho\.inf\{max-width:1560px\}/.test(media), 'CSS: #app.ancho.inf hasta 1560 px (≥ 900 px)');
    assert(/#app\.ancho\.inf \.infarriba\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(media), 'CSS: la fila de tres tarjetas');
    assert(/#app\.ancho\.inf \.infsen\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(460px,1fr\)\)/.test(media) && /#app\.ancho\.inf \.infsen>\.sec[^{]*\{grid-column:1\/-1\}/.test(media), 'CSS: señales en rejilla (auto-fit, 460 px) con el encabezado a todo el ancho');
    assert(/#app\.ancho\.inf \.inftk\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(380px,1fr\)\)/.test(media), 'CSS: tickers en rejilla (auto-fit, 380 px)');
    assert(/\n  \.infarriba,\.infsen,\.inftk\{display:flex;flex-direction:column;gap:11px\}/.test(css), 'fuera de la computadora (un instante, al cambiar el ancho) los envoltorios son una columna');
    assert(/config\.js\?v=63/.test(INDEX) && /app\/main\.js\?v=63/.test(INDEX), 'index.html carga config.js?v=63 y app/main.js?v=63');
    const SW = fs.readFileSync(path.join(path.dirname(process.argv[2]), '..', 'sw.js'), 'utf8');
    assert(/const VER = 'mesa2-v52';/.test(SW), 'sw.js VER mesa2-v52');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
