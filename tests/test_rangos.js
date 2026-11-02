#!/usr/bin/env node
/* v66 · A2 «rango invertido en el Copiloto» (spec68, 2026-10-31). La señal CT15A META del 12-oct traía rango_vivo
   invertido (lo 208 > hi 104): el Informe decía «rango inválido» pero el Copiloto (textoTicket) pintaba «$208–$104».
   Ahora TODA pintura de un rango (lo–hi) pasa por rangoValido: números finitos, > 0 y lo ≤ hi; si no, «rango inválido»,
   sin inventar orden (jamás se intercambian lo y hi).
     1. rangoValido: la tabla de casos (invertido, 0, negativo, texto, hueco, booleano, infinito, iguales, cadenas numéricas)
     2. textoTicket (el Copiloto): el caso de META 12-oct con la forma real del ticket del vigilante
     3. detalleSenalInforme (Informe), textoRangoTarjeta (tarjeta del ticker): también ≤ 0 y no numérico
     4. el registro del fill, semaforoRango, avisosOrden, enRangoCadena y la leyenda de la cadena: nada se juzga ni se pinta
        contra un rango que no vale
     5. textoRangoOrden (formulario de orden): academia, tabla y delta
     6. hlinesLista: el mínimo–máximo de ayer y el bajo–alto del target
     7. barrido del fuente: toda función que pinta un lo–hi llama a rangoValido (o a semaforoRango, que lo llama)
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Contra un main.js SIN el arreglo (la v65), las
   pruebas se construyen sin rangoValido y FALLAN por comportamiento (se pinta «$208–$104», «$0–$50», «$-5–$100»…).
   Uso: node test_rangos.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_rangos.js');
const { FUENTE, assert, igual, construir, extraer, esc, haceCuanto } = C;

const tiene = (n) => { try { extraer(n); return true; } catch (_) { return false; } };
const RV = tiene('rangoValido') ? ['rangoValido'] : [];   // sin el arreglo la suite corre igual y falla por lo que pinta
const fmtFechaNY = (iso) => new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', day: 'numeric', month: 'short' }).format(new Date(iso));

// ════════════════ 1. rangoValido ════════════════
if (RV.length) {
  const { rangoValido } = construir(['rangoValido']);
  const casos = [
    [[104, 208], true, 'un rango normal (lo < hi)'],
    [[50, 50], true, 'lo = hi también vale (un solo precio)'],
    [['40', '80'], true, 'cadenas numéricas (la base puede devolver numeric como texto)'],
    [[0.5, 0.9], true, 'decimales positivos'],
    [[208, 104], false, 'INVERTIDO (lo 208 > hi 104, la CT15A META del 12-oct)'],
    [[0, 50], false, 'lo = 0 no es un rango de prima'],
    [[-5, 100], false, 'un negativo'],
    [[50, -1], false, 'hi negativo'],
    [[NaN, 50], false, 'NaN'],
    [['x', 50], false, 'texto que no es número'],
    [[null, 50], false, 'hueco (null) no es 0'],
    [['', 50], false, 'cadena vacía no es 0'],
    [['  ', 50], false, 'espacios no son 0'],
    [[undefined, undefined], false, 'sin datos'],
    [[true, 5], false, 'un booleano no es un número (Number(true) sería 1)'],
    [[Infinity, Infinity], false, 'infinito'],
    [[10, Infinity], false, 'hi infinito'],
    [[[10], [20]], false, 'un arreglo no es un número'],
  ];
  casos.forEach(([[lo, hi], esperado, msg]) => igual(rangoValido(lo, hi), esperado, 'rangoValido(' + JSON.stringify(lo) + ', ' + JSON.stringify(hi) + ') → ' + esperado + ': ' + msg));
} else {
  C.falla('no existe function rangoValido en el fuente (la regla común de qué rango se puede pintar)');
}

// ════════════════ 2. textoTicket: el Copiloto ════════════════
{
  const T = construir(['textoTicket'].concat(RV), { esc });
  // forma real del ticket del vigilante (worker/mesa2/vigilante.py: "rango": [rv.get("lo"), rv.get("hi")])
  const meta = { id: 29, symbol: 'META', direccion: 'CALL', titulo: '🐟 CT15A · COMPRAR CALL · META',
    payload: { ticket: { ask: 5.45, exp: '2026-10-12', strike: 737.5, direccion: 'CALL', rango: [208, 104], spot: 736.8 } } };
  const h = T.textoTicket(meta);
  assert(/Ticket armado: META CALL 737\.5 · vence 2026-10-12 · ask \$5\.45/.test(h), 'el ticket se sigue armando (contrato, vencimiento y ask)', h);
  assert(!/\$208/.test(h) && !/\$104/.test(h), 'el rango invertido de META 12-oct NO se pinta: ni «$208–$104» ni «$104–$208» (sin inventar orden)', h);
  assert(/rango inválido/.test(h), 'dice «rango inválido», como el Informe', h);
  const ok = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: [104.4, 207.6] } } });
  assert(/ · rango \$104–\$208<\/div>$/.test(ok) && !/inválido/.test(ok), 'un rango válido se pinta como siempre (redondeado)', ok);
  const cero = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: [0, 50] } } });
  assert(/rango inválido/.test(cero) && !/\$0–\$50/.test(cero), 'lo = 0: «rango inválido», nunca «$0–$50»', cero);
  const neg = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: [-5, 100] } } });
  assert(/rango inválido/.test(neg) && !/\$-5/.test(neg), 'un negativo: «rango inválido», nunca «$-5–$100»', neg);
  const medio = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: [100, null] } } });
  assert(/rango inválido/.test(medio) && !/NaN|\$0/.test(medio), 'con solo un extremo: «rango inválido», nunca «$100–$0» ni NaN', medio);
  const txt = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: ['abc', 50] } } });
  assert(/rango inválido/.test(txt) && !/NaN/.test(txt), 'un extremo que no es número: «rango inválido», nunca «$NaN»', txt);
  const sin = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: undefined } } });
  assert(!/rango/.test(sin) && /Ticket armado/.test(sin), 'sin rango en el ticket: no se habla de rango', sin);
  const nulos = T.textoTicket({ ...meta, payload: { ticket: { ...meta.payload.ticket, rango: [null, null] } } });
  assert(!/rango/.test(nulos), 'con [null, null] (el vigilante sin rango_vivo): tampoco', nulos);
  igual(T.textoTicket({ symbol: 'META', payload: {} }), '', 'sin ticket no hay línea');
}

// ════════════════ 3. Informe: detalleSenalInforme · tarjeta del ticker: textoRangoTarjeta ════════════════
{
  const D = construir(['detalleSenalInforme', 'estrategiaSenal', 'horaNY'].concat(RV), { esc }, { consts: ['decDe', 'ESTRATEGIA_NOMBRE'] });
  const s = { id: 29, symbol: 'META', estrategia_id: 'E8', titulo: 'CT15A · META', creado_at: '2026-10-12T13:31:27+00:00' };
  const inv = D.detalleSenalInforme({ ...s, rango_vivo: { lo: 208, hi: 104 } });
  assert(/rango óptimo <b>—<\/b> rango inválido \(mín &gt; máx\)/.test(inv) && !/\$208|\$104/.test(inv), 'invertido: «—», «rango inválido (mín > máx)» y ningún número', inv);
  const neg = D.detalleSenalInforme({ ...s, rango_vivo: { lo: -5, hi: 100 } });
  assert(/rango óptimo <b>—<\/b> rango inválido/.test(neg) && !/\$-5|\$100|mín &gt; máx/.test(neg), 'un negativo: «rango inválido» (sin decir «mín > máx», que no es el motivo) y nunca «$-5–$100»', neg);
  const cero = D.detalleSenalInforme({ ...s, rango_vivo: { lo: 0, hi: 0 } });
  assert(/rango inválido/.test(cero) && !/\$0–\$0/.test(cero), 'lo = hi = 0: «rango inválido», nunca «$0–$0»', cero);
  const txt = D.detalleSenalInforme({ ...s, rango_vivo: { lo: 'abc', hi: 100 } });
  assert(/rango inválido/.test(txt), 'un extremo que no es número también se dice (antes desaparecía la línea sin explicación)', txt);
  const ok = D.detalleSenalInforme({ ...s, rango_vivo: { lo: '104', hi: '208.4', exp: '2026-10-14' } });
  assert(/rango óptimo <b>\$104–\$208<\/b> por contrato · por delta · exp 10-14/.test(ok), 'uno válido (aunque llegue como texto) se pinta como siempre', ok);
  const hueco = D.detalleSenalInforme({ ...s, rango_vivo: { lo: null, hi: 100 } });
  assert(!/rango óptimo/.test(hueco), 'con un extremo que FALTA (null) no sale la línea, como antes: faltar no es un dato malo', hueco);

  const R = construir(['textoRangoTarjeta', 'componerRango'].concat(RV), { esc }, { consts: ['RANGOS_TABLA'] });
  const c0 = R.textoRangoTarjeta({ rango_vivo: { lo: 0, hi: 50 } }, 'ZZZZ');
  assert(/<b class="mono">—<\/b>/.test(c0) && /rango inválido/.test(c0) && !/\$0–\$50/.test(c0), 'tarjeta del ticker: lo = 0 por delta es «—» y «rango inválido»', c0);
  const cn = R.textoRangoTarjeta({ rango_academia: { lo: -40, hi: 80 } }, 'ZZZZ');
  assert(/rango inválido/.test(cn) && !/\$-40/.test(cn), 'tarjeta del ticker: un negativo del método de la academia también', cn);
  const ci = R.textoRangoTarjeta({ rango_academia: { lo: 208, hi: 104 } }, 'META');
  assert(/rango inválido/.test(ci) && !/\$208|\$104/.test(ci), 'tarjeta del ticker: academia invertida — ni la academia ni un orden inventado', ci);
  assert(/\$150–\$210/.test(R.textoRangoTarjeta({}, 'META')), 'sin ejercicio del worker manda la tabla (válida) como siempre');
}

// ════════════════ 4. registro del fill, semáforo, avisos, cadena ════════════════
{
  assert(/rangoValido\(rango\.lo, rango\.hi\)/.test(extraer('abrirFill')), 'registro del fill (abrirFill → evaluar): el rango se valida con rangoValido antes de pintar «Rango óptimo $lo–$hi» y juzgar la prima (ese veredicto se guarda en posiciones)');
  const S = construir(['semaforoRango'].concat(RV));
  igual([S.semaforoRango(0.5, { lo: 35, hi: 90 }), S.semaforoRango(0.5, { lo: 90, hi: 35 })], ['ok', null], 'semaforoRango: un rango válido juzga; uno invertido no (como antes)');
  igual(S.semaforoRango(0.5, { lo: -10, hi: 90 }), null, 'semaforoRango: con lo negativo NO juzga (antes «ok»: el veredicto se guardaba en la orden y en Disciplina)');
  igual(S.semaforoRango(0.5, { lo: 0, hi: 0 }), null, 'semaforoRango: con 0–0 no juzga (antes «alto»: FUERA del rango con un rango que no existe)');
  igual(S.semaforoRango(0.5, { lo: 'x', hi: 90 }), null, 'semaforoRango: con un extremo no numérico no juzga');

  const A = construir(['avisosOrden', 'semaforoRango', 'requiereOverride'].concat(RV), { usd: C.usd }, { consts: ['PLANES', 'TICKERS', 'OPS_SEMANA', 'TAMANO_PCT', 'SPREAD_MAX_PCT'] });
  const f = { symbol: 'META', tipo: 'CALL', accion: 'compra', strike: 737.5, expiracion: '2026-10-12', cantidad: 1, priceType: 'LIMIT', limitPrice: 2.5, orderTerm: 'DAY' };
  const avOk = A.avisosOrden(f, { plan: A.PLANES.PLAN_35, rango: { lo: 104, hi: 208 } });
  assert(avOk.some(a => /FUERA del rango óptimo \$104–\$208/.test(a)), 'avisosOrden: con un rango válido la prima de $250 avisa FUERA del rango $104–$208');
  const avInv = A.avisosOrden(f, { plan: A.PLANES.PLAN_35, rango: { lo: 208, hi: 104 } });
  assert(!avInv.some(a => /rango/.test(a)), 'avisosOrden: con el rango invertido no hay aviso de rango (ni «$208–$104»)', JSON.stringify(avInv));
  const avNeg = A.avisosOrden({ ...f, limitPrice: 9 }, { plan: A.PLANES.PLAN_35, rango: { lo: -100, hi: 50 } });
  assert(!avNeg.some(a => /\$-100/.test(a)), 'avisosOrden: con un negativo tampoco se pinta «$-100–$50»', JSON.stringify(avNeg));

  const E = construir(['enRangoCadena'].concat(RV));
  const o = { bid: 0.5, ask: 0.6 };   // mid 0.55 → $55 por contrato
  igual(E.enRangoCadena(o, { lo: 40, hi: 80 }), 'ok', 'enRangoCadena: $55 en un rango 40–80 → en rango (como siempre)');
  igual(E.enRangoCadena(o, { lo: -50, hi: 100 }), null, 'enRangoCadena: con lo negativo no se marca nada (antes media cadena salía «en rango»)');
  igual(E.enRangoCadena(o, { lo: 0, hi: 60 }), null, 'enRangoCadena: con lo = 0 tampoco');
  igual(E.enRangoCadena(o, { lo: 208, hi: 104 }), null, 'enRangoCadena: invertido → nada que marcar');
  assert(/rangoValido\(rango\.lo, rango\.hi\)/.test(extraer('pintarCadena')) && /rango óptimo: rango inválido/.test(extraer('pintarCadena')), 'la leyenda de la cadena (pintarCadena) valida el rango y, si no vale, dice «rango óptimo: rango inválido»');
}

// ════════════════ 5. formulario de orden: textoRangoOrden ════════════════
{
  const TR = construir(['textoRangoOrden', 'bandaDelDia'].concat(RV), { esc, fmtFechaNY }, { consts: ['RANGOS_TABLA', 'RANGOS_TABLA_ANALISIS', 'DIAS_ES'] });
  const ra = { lo: 208, hi: 104, lado: 'call', fecha: '2026-10-12', exp: '2026-10-16' };
  const hA = TR.textoRangoOrden('META', { lo: 208, hi: 104, fuente: 'academia', academia: ra, delta: null }, TR.RANGOS_TABLA.META, 1);
  assert(/método de la academia · rango inválido/.test(hA) && !/\$208–\$104/.test(hA) && !/\$104–\$208/.test(hA), 'academia invertida: «rango inválido», ni «$208–$104» ni un orden inventado', hA);
  assert(/Tabla Investep \$150–\$210/.test(hA), 'y la tabla de Investep (válida) sigue saliendo debajo');
  const hOk = TR.textoRangoOrden('META', { lo: 150, hi: 205, fuente: 'academia', academia: { ...ra, lo: 150, hi: 205 }, delta: null }, TR.RANGOS_TABLA.META, 1);
  assert(/Rango óptimo \$150–\$205<\/b> por contrato · método de la academia/.test(hOk), 'academia válida: como siempre', hOk);
  const hD = TR.textoRangoOrden('META', { lo: 150, hi: 205, fuente: 'academia', academia: { ...ra, lo: 150, hi: 205 }, delta: { lo: 208, hi: 104, exp: '2026-10-12' } }, null, 1);
  assert(/Referencia por delta 0\.15–0\.30: rango inválido/.test(hD) && !/\$208/.test(hD), 'la referencia por delta invertida: «rango inválido», sin números', hD);
  const hT = TR.textoRangoOrden('ZZZ', { lo: 0, hi: 0, fuente: 'tabla', academia: null, delta: null }, null, 1);
  assert(/tabla de la academia · rango inválido/.test(hT) && !/\$0–\$0/.test(hT), 'la tabla compuesta con 0–0: «rango inválido»', hT);
}

// ════════════════ 6. hlinesLista: mínimo–máximo de ayer y bajo–alto del target ════════════════
{
  // v67: hlinesLista nombra las líneas como el gráfico (nivelesChart, muestraLinea, la paleta CHART_COL)
  const v67 = tiene('nivelesChart') ? ['nivelesChart', 'muestraLinea'] : [];
  const CH = construir(['hlinesLista', 'techoPisoProximos', 'fmtFechaNY'].concat(RV, v67), { esc, haceCuanto }, { consts: ['decDe'].concat(v67.length ? ['CHART_COL'] : []) });
  const nv = { spot: 100, cierre_ayer: 99.5, max_ayer: 98, min_ayer: 101 };   // invertido
  const h = CH.hlinesLista({ niveles: nv }, { target: 115, target_alto: 105, target_bajo: 125, fuente: 'finviz' }, 2);
  assert(/cierre (de )?ayer \$?99\.50/.test(h) && /ayer: rango inválido/.test(h) && !/101\.00–98\.00/.test(h), 'el mínimo–máximo de ayer invertido no se pinta: «ayer: rango inválido»', h);
  assert(/target (analistas )?\$?115\.00/.test(h) && /bajo–alto: rango inválido/.test(h) && !/125\.00–105\.00/.test(h), 'el bajo–alto del target invertido tampoco (el target sí)', h);
  const ok = CH.hlinesLista({ niveles: { ...nv, max_ayer: 101, min_ayer: 98 } }, { target: 115, target_alto: 125, target_bajo: 105 }, 2);
  assert(/ayer 98\.00–101\.00/.test(ok) && /105\.00–125\.00/.test(ok), 'válidos: como siempre');
  const medio = CH.hlinesLista({ niveles: { ...nv, max_ayer: 101, min_ayer: null } }, { target: 115, target_alto: 125 }, 2);
  assert(/ayer —–101\.00/.test(medio) && /—–125\.00/.test(medio), 'con un solo extremo, el otro es «—» (como siempre: falta, no es inválido)', medio);
}

// ════════════════ 7. barrido: toda función que pinta un lo–hi valida ════════════════
{
  const nombres = [...FUENTE.matchAll(/^(?:async )?function (\w+)\s*\(/gm)].map(m => m[1]);
  const pintan = [];
  for (const n of nombres) {
    let b; try { b = extraer(n); } catch (_) { continue; }
    if (/\.(lo|hi)\b|rango\[0\]|r\[0\]/.test(b) && /–/.test(b)) pintan.push(n);
  }
  const sin = pintan.filter(n => !/rangoValido\(|semaforoRango\(/.test(extraer(n)));
  assert(pintan.length >= 7, 'el barrido encuentra las funciones que pintan un rango (' + pintan.join(', ') + ')');
  igual(sin, [], 'TODAS validan con rangoValido (o con semaforoRango, que lo usa)');
  assert(/function semaforoRango[\s\S]*?rangoValido\(rango\.lo, rango\.hi\)/.test(extraer('semaforoRango')), 'semaforoRango usa rangoValido');
}

C.resumen();
