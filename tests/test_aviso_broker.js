#!/usr/bin/env node
/* v68 · A «arregla la mesa que ya no estoy operando» (spec70, 2026-11-02). Desde el 24-oct la app daba el token de E*TRADE
   por muerto y dejó de llamar (bien); desde el 28-oct, lo mismo con Schwab. Ninguna ejecución de E*TRADE entró a la Mesa
   en 9 días y la app solo lo decía en letra pequeña dentro de Cuentas. Ahora: una franja GLOBAL «bróker sin conexión»
   debajo de la cabecera (todas las pestañas), con una línea por bróker afectado, desde cuándo, qué hacer, «Conectar»
   (MZ.conectar, el flujo de siempre) y «Ocultar hasta mañana».
     1. diasHabilesDesde · fechaCortaAviso · ultimaEjecucionBrokers (puras)
     2. avisoBrokersEstado: cada estado — E*TRADE login de otro día (ámbar el primer día, rojo después), muerto, nunca
        conectado aquí con datos, sin datos = sin franja (el amigo sin brókeres); Schwab caducado y sin equipo; ocultar
        hasta mañana; conectado = nada; fin de semana sin nada pendiente = nada; «desde» = lo más reciente (sync o datos)
     3. avisoBrokersHtml: texto llano, esc() en todo lo dinámico, botones con claves fijas, rojo/ámbar
     4. pintarAvisoBrokers con las funciones REALES y un DOM de juguete: aparece, desaparece al reconectar, se oculta
        hasta mañana (y vuelve al día siguiente), el amigo no ve nada, almacenamiento roto no rompe; y NINGUNA llamada de
        red (fetch, proxy, supabase) en todo el recorrido
     5. el módulo ENTERO: carga, MZ.avisoOcultar y MZ.conectar conviven, la franja sale sin red; ruta() la pinta antes de
        esperar a nada; las vistas que ya leen broker_trades la alimentan; la última sincronización buena se guarda
     6. index.html: la franja no desborda a 375 px (texto que se parte, botones que bajan) y sigue al ancho grande
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js). Contra la v67 (main 9728186) FALLA: no existe.
   Uso: node test_aviso_broker.js wt-v68/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_aviso_broker.js');
const { FUENTE, assert, igual, construir, extraer, esc, ymdNY, localStorageFalso, nodo, respirar } = C;
const tiene = (n) => { try { extraer(n); return true; } catch (_) { return false; } };

const NOMBRES = ['pintarAvisoBrokers', 'avisoBrokersLeer', 'avisoBrokersEstado', 'avisoBrokersHtml', 'avisoDatosBrokers', 'avisoAnotarTrades', 'avisoOcultar',
  'ultimaEjecucionBrokers', 'diasHabilesDesde', 'fechaCortaAviso'];
const faltan = NOMBRES.filter(n => !tiene(n));
if (faltan.length) { C.falla('no existe el aviso global «bróker sin conexión» (faltan: ' + faltan.join(', ') + ')'); C.resumen(); }

const MS = (iso) => Date.parse(iso);
const P = construir(['diasHabilesDesde', 'fechaCortaAviso', 'ultimaEjecucionBrokers', 'avisoBrokersEstado', 'avisoBrokersHtml'], { esc, ymdNY });

// ════════════════ 1. puras ════════════════
{
  igual(P.diasHabilesDesde('2026-10-23', '2026-11-02'), 6, '23-oct (vie) → 2-nov (lun): 6 días hábiles sin sincronizar (26–30 oct y hoy)');
  igual(P.diasHabilesDesde('2026-10-30', '2026-11-02'), 1, 'viernes → lunes: 1 (solo hoy)');
  igual(P.diasHabilesDesde('2026-10-28', '2026-11-02'), 3, 'mié 28-oct → lun 2-nov: 3');
  igual([P.diasHabilesDesde('2026-11-02', '2026-11-02'), P.diasHabilesDesde('2026-10-30', '2026-11-01')], [0, 0], 'el mismo día: 0 · viernes → domingo: 0');
  igual([P.diasHabilesDesde('2026-11-05', '2026-11-02'), P.diasHabilesDesde(null, '2026-11-02'), P.diasHabilesDesde('ayer', '2026-11-02')], [0, null, null], 'una fecha futura da 0; sin fecha o mala, null');
  igual([P.fechaCortaAviso('2026-10-23'), P.fechaCortaAviso('2026-11-02'), P.fechaCortaAviso('2026-12-31'), P.fechaCortaAviso('x')], ['vie 23-oct', 'lun 2-nov', 'jue 31-dic', ''], 'fecha corta en español: «vie 23-oct»');
  const filas = [
    { broker: 'etrade', user_id: 'u1', lado: 'compra', ejecutado_at: '2026-10-23T18:40:00Z' },
    { broker: 'etrade', user_id: 'u1', lado: 'vencimiento', ejecutado_at: '2026-10-30T20:30:00Z' },   // solo anota el vencimiento
    { broker: 'etrade', user_id: 'OTRO', lado: 'venta', ejecutado_at: '2026-10-31T15:00:00Z' },        // de otro usuario
    { broker: 'schwab', user_id: 'u1', abierta_at: '2026-10-20T14:00:00Z', cerrada_at: '2026-10-28T19:00:00Z' },   // broker_trades
    { broker: 'schwab', user_id: 'u1', cerrada_at: '2027-01-15T21:30:00Z' },                           // futuro: no cuenta
    { broker: 'moomoo', user_id: 'u1', ejecutado_at: '2026-11-02T14:00:00Z' }, { broker: 'tasty', ejecutado_at: '2026-11-02T14:00:00Z' }, null,
    { broker: 'etrade', user_id: 'u1', ejecutado_at: '2026-10-24T03:30:00Z' },   // 23:30 NY del 23-oct: su día NY es el 23
  ];
  igual(P.ultimaEjecucionBrokers(filas, 'u1', MS('2026-11-02T15:30:00Z')), { etrade: '2026-10-23', schwab: '2026-10-28' },
    'última ejecución por bróker: solo E*TRADE/Schwab, solo del usuario, sin «vencimiento», sin futuros, en día NY');
  igual(P.ultimaEjecucionBrokers(null, 'u1', 0), { etrade: null, schwab: null }, 'sin filas: nada');
}

// ════════════════ 2. avisoBrokersEstado: cada estado ════════════════
const HOY = '2026-11-02';
const est = (e) => P.avisoBrokersEstado(Object.assign({ hoy: HOY, et: {}, sw: {}, datos: {}, ocultos: {} }, e));
const corto = (ls) => ls.map(l => [l.broker, l.estado, l.nivel, l.desde, l.fuente, l.dias]);
{
  igual(corto(est({ et: { creds: true, dia: '2026-10-30', okSync: '2026-10-30' } })), [['etrade', 'otro_dia', 'ambar', '2026-10-30', 'sync', 1]],
    'E*TRADE con el login del viernes, el lunes: ÁMBAR (falta el login de hoy), 1 día hábil, fecha de la última sincronización buena');
  igual(corto(est({ et: { creds: true, dia: '2026-10-23', okSync: '2026-10-23' } })), [['etrade', 'otro_dia', 'rojo', '2026-10-23', 'sync', 6]],
    'E*TRADE con el login del 23-oct: ROJO, 6 días hábiles sin sincronizar');
  igual(corto(est({ et: { creds: true, dia: '2026-10-30' } })), [['etrade', 'otro_dia', 'ambar', '2026-10-30', 'login', 1]],
    'sin sincronización guardada ni datos: la fecha es la del último login en este equipo');
  igual(corto(est({ et: { creds: true, dia: 'muerto' }, datos: { etrade: '2026-10-23' } })), [['etrade', 'muerto', 'rojo', '2026-10-23', 'datos', 6]],
    'E*TRADE MUERTO (el caso de Andrés): rojo, desde la última ejecución de E*TRADE en los datos (23-oct), 6 días hábiles');
  igual(corto(est({ et: { creds: true, dia: 'muerto' } })), [['etrade', 'muerto', 'rojo', null, null, null]], 'muerto sin ninguna fecha: rojo igual (sin inventar una fecha)');
  igual(corto(est({ et: { creds: true, dia: 'muerto', okSync: HOY } })), [['etrade', 'muerto', 'ambar', HOY, 'sync', 0]], 'muerto HOY tras sincronizar hoy: ámbar');
  igual(corto(est({ et: { creds: true, dia: 'muerto', okSync: '2026-10-20' }, datos: { etrade: '2026-10-23' } })), [['etrade', 'muerto', 'rojo', '2026-10-23', 'datos', 6]],
    '«desde» = lo MÁS RECIENTE entre la última sincronización buena aquí y la última ejecución en los datos (otro equipo pudo traerla)');
  igual(corto(est({ et: { creds: true, dia: 'muerto', okSync: '2026-10-23' }, datos: { etrade: '2026-10-22' } })), [['etrade', 'muerto', 'rojo', '2026-10-23', 'sync', 6]],
    '… y si la sincronización es más reciente, manda ella (fuente sync)');
  igual(corto(est({ datos: { etrade: '2026-10-23' } })), [['etrade', 'sin_equipo', 'rojo', '2026-10-23', 'datos', 6]],
    'E*TRADE NUNCA conectado en este equipo pero con datos: «no está conectado en este equipo», rojo con sus días');
  igual(corto(est({ datos: { etrade: '2026-10-30' } })), [['etrade', 'sin_equipo', 'ambar', '2026-10-30', 'datos', 1]], '… ámbar si lo último es del día hábil anterior');
  igual(est({}), [], 'SIN DATOS y sin claves = SIN FRANJA');
  igual(est({ datos: { etrade: null, schwab: null } }), [], 'el amigo sin brókeres (Gad, Luca): ninguna franja');
  igual(est({ et: { creds: true, dia: HOY } }), [], 'E*TRADE conectado hoy: nada');
  igual(est({ et: { creds: true, dia: null } }), [], 'token sin día guardado (anterior a v21): se da por vivo, como etDiaVencido');
  igual(est({ et: { creds: true, dia: HOY }, datos: { etrade: '2026-10-23' } }), [], 'conectado hoy aunque lo último sea viejo: nada (la sincronización ya corre)');
  // Schwab
  igual(corto(est({ sw: { creds: true, vencido: true, okSync: '2026-10-28', login: '2026-10-21' } })), [['schwab', 'caducado', 'rojo', '2026-10-28', 'sync', 3]],
    'Schwab con el login semanal CADUCADO: rojo desde la última sincronización buena (28-oct), 3 días hábiles');
  igual(corto(est({ sw: { creds: true, vencido: true, login: '2026-10-21' } })), [["schwab", "caducado", "rojo", "2026-10-21", "login", 8]], 'sin sincronización ni datos: desde el login semanal');
  igual(corto(est({ sw: { creds: true, vencido: true, okSync: '2026-10-30' } })), [['schwab', 'caducado', 'ambar', '2026-10-30', 'sync', 1]], 'caducado hoy con todo al día hasta el viernes: ámbar');
  igual(corto(est({ datos: { schwab: '2026-10-28' } })), [['schwab', 'sin_equipo', 'rojo', '2026-10-28', 'datos', 3]], 'Schwab sin sesión en este equipo pero con datos');
  igual(est({ sw: { creds: true, vencido: false }, datos: { schwab: '2026-10-28' } }), [], 'Schwab con sesión viva: nada');
  igual(corto(est({ sw: { okSync: '2026-10-28' } })), [['schwab', 'sin_equipo', 'rojo', '2026-10-28', 'sync', 3]], 'sin sesión pero con una sincronización buena anterior aquí (se olvidó/caducó la sesión): también');
  // los dos, el día de hoy
  const hoyAndres = est({ et: { creds: true, dia: 'muerto' }, sw: { creds: true, vencido: true, okSync: '2026-10-28', login: '2026-10-21' }, datos: { etrade: '2026-10-23', schwab: '2026-10-27' } });
  igual(corto(hoyAndres), [['etrade', 'muerto', 'rojo', '2026-10-23', 'datos', 6], ['schwab', 'caducado', 'rojo', '2026-10-28', 'sync', 3]], 'los dos a la vez: una línea por bróker, E*TRADE primero');
  // ocultar hasta mañana
  igual(corto(est({ et: { creds: true, dia: 'muerto' }, datos: { etrade: '2026-10-23', schwab: '2026-10-28' }, ocultos: { etrade: HOY } })), [['schwab', 'sin_equipo', 'rojo', '2026-10-28', 'datos', 3]],
    '«Ocultar hasta mañana» de E*TRADE hoy: solo esa línea se va (Schwab sigue)');
  igual(corto(est({ et: { creds: true, dia: 'muerto' }, datos: { etrade: '2026-10-23' }, ocultos: { etrade: '2026-11-01' } })), [['etrade', 'muerto', 'rojo', '2026-10-23', 'datos', 6]],
    'ocultado AYER: hoy vuelve');
  // fin de semana: nada pendiente, nada que avisar; con días pendientes, sí
  igual(est({ hoy: '2026-10-31', et: { creds: true, dia: '2026-10-30', okSync: '2026-10-30' } }), [], 'sábado con todo sincronizado el viernes: sin franja (no hay mercado)');
  igual(corto(est({ hoy: '2026-10-31', et: { creds: true, dia: 'muerto' }, datos: { etrade: '2026-10-23' } })), [['etrade', 'muerto', 'rojo', '2026-10-23', 'datos', 5]], 'sábado con 5 días hábiles perdidos: sí');
  igual(corto(est({ et: { creds: true, dia: 'muerto' }, datos: { etrade: '23 de octubre' } })), [['etrade', 'muerto', 'rojo', null, null, null]], 'una fecha que no es AAAA-MM-DD no se usa');
}

// ════════════════ 3. avisoBrokersHtml ════════════════
{
  const h = P.avisoBrokersHtml(est({ et: { creds: true, dia: 'muerto' }, sw: { creds: true, vencido: true, okSync: '2026-10-28' }, datos: { etrade: '2026-10-23' } }));
  const lin = h.split('<div class="avl ').slice(1);
  igual(lin.length, 2, 'una línea por bróker');
  assert(/^rojo" data-brk="etrade" data-estado="muerto">/.test(lin[0]) && /<b class="avtit">E\*TRADE desconectado<\/b> — tus operaciones de E\*TRADE no entran a la Mesa desde el <b>vie 23-oct<\/b> \(6 días hábiles\)\. E\*TRADE rechazó la sesión: vuelve a entrar\./.test(lin[0]),
    'E*TRADE muerto: «E*TRADE desconectado — tus operaciones de E*TRADE no entran a la Mesa desde el vie 23-oct (6 días hábiles). E*TRADE rechazó la sesión…»', lin[0]);
  assert(/Fecha: la de tu última operación de E\*TRADE guardada en la Mesa\./.test(lin[0]), 'dice de dónde sale la fecha (los datos)');
  assert(/<button type="button" class="avc" onclick="MZ\.conectar\('etrade'\)">Conectar E\*TRADE<\/button>/.test(lin[0]) && /onclick="MZ\.avisoOcultar\('etrade'\)" aria-label="Ocultar el aviso de E\*TRADE hasta mañana">Ocultar hasta mañana<\/button>/.test(lin[0]),
    'botones: «Conectar E*TRADE» abre el flujo de siempre (MZ.conectar) y «Ocultar hasta mañana»');
  assert(/^rojo" data-brk="schwab" data-estado="caducado">/.test(lin[1]) && /Schwab desconectado<\/b> — tus operaciones de Schwab no entran a la Mesa desde el <b>mié 28-oct<\/b> \(3 días hábiles\)\. El login semanal de Schwab caducó/.test(lin[1])
    && /Fecha: la de la última sincronización buena en este equipo\./.test(lin[1]) && /MZ\.conectar\('schwab'\)">Conectar Schwab</.test(lin[1]), 'Schwab caducado: su línea, su fecha y su botón', lin[1]);
  const a = P.avisoBrokersHtml(est({ et: { creds: true, dia: '2026-10-30', okSync: '2026-10-30' } }));
  assert(/^<div class="avl ambar"/.test(a) && /E\*TRADE: falta el login de hoy<\/b>/.test(a) && /\(1 día hábil\)/.test(a) && /cierra la sesión cada medianoche/.test(a), 'el primer día: ámbar, «E*TRADE: falta el login de hoy», «1 día hábil»', a);
  const s = P.avisoBrokersHtml(est({ datos: { etrade: '2026-10-23' } }));
  assert(/E\*TRADE no está conectado en este equipo<\/b> — lo último de E\*TRADE guardado en la Mesa es del <b>vie 23-oct<\/b> \(6 días hábiles\)/.test(s) && /MZ\.conectar\('etrade'\)/.test(s), 'nunca conectado aquí: «E*TRADE no está conectado en este equipo — lo último … es del vie 23-oct»', s);
  const m0 = P.avisoBrokersHtml(est({ et: { creds: true, dia: 'muerto' } }));
  assert(/tus operaciones de E\*TRADE no entran a la Mesa\. E\*TRADE rechazó la sesión/.test(m0) && !/Fecha:/.test(m0) && !/undefined|null/.test(m0), 'sin fecha conocida no se inventa ni se escribe «null»', m0);
  igual(P.avisoBrokersHtml([]), '', 'sin líneas: nada');
  const raro = P.avisoBrokersHtml([{ broker: 'etrade', estado: '"><img src=x onerror=alert(1)>', nivel: 'rojo', desde: '<b>', fuente: 'sync', dias: '<i>' }]);
  assert(!/<img|<i>|"><img/.test(raro) && /&lt;img/.test(raro), 'todo lo dinámico pasa por esc()', raro);
  const malo = P.avisoBrokersHtml([{ broker: "etrade');alert(1);//", estado: 'muerto', nivel: 'rojo', desde: null, dias: null }]);
  assert(/MZ\.conectar\('etrade'\)/.test(malo) && !/alert/.test(malo), 'los botones llevan claves FIJAS (nunca el dato)');
}

// ════════════════ 4. pintarAvisoBrokers con las funciones reales, un DOM de juguete y SIN red ════════════════
const RED = { fetch: 0, proxy: 0, sb: 0 };
function armar(inicial, op) {
  op = op || {};
  const ls = op.lsRoto ? { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } } : localStorageFalso(inicial || {});
  const E = { hoy: HOY };
  const nodos = {};
  const vista = nodo({ id: 'vista' });
  vista.parentNode = { insertBefore: (el, ref) => { nodos['#avisoBrk'] = el; el._antesDe = ref; } };
  const creados = [];
  const doc = { createElement: (t) => { const n = nodo({ tagName: String(t).toUpperCase(), attrs: {} }); n.setAttribute = (k, v) => { n.attrs[k] = v; }; creados.push(n); return n; } };
  const libro = { filas: op.libro || null };
  const ses = { user: { id: op.uid || 'u1' } };
  const M = construir(NOMBRES.concat(['etCreds', 'swCreds', 'swVencido']), {
    esc, ymdNY, hoyNY: () => E.hoy, localStorage: ls, document: doc, $: (q) => (q === '#vista' ? vista : nodos[q] || null),
    sesionActiva: ses, _libro: libro,
    fetch: () => { RED.fetch++; return Promise.reject(new Error('sin red')); },
    etProxy: () => { RED.proxy++; return Promise.reject(new Error('sin red')); },
    sb: { from: () => { RED.sb++; throw new Error('sin red'); } },
  }, { consts: ['AVISO_BRK_K', 'AVISO_BRK', '_avisoBrk', 'ET_K', 'SW_K', 'SW_K_SYNC', 'SW_K_SYNC_LIG', 'SW_REFRESH_DIAS'] });
  return { M, ls, E, nodos, creados, libro, ses, franja: () => nodos['#avisoBrk'] };
}
const fillET = (d) => ({ id: 1, broker: 'etrade', user_id: 'u1', lado: 'venta', ejecutado_at: d + 'T17:00:00Z', fecha_ny: d });
{
  // a. el equipo de Andrés hoy: token de E*TRADE muerto, el libro cargado con la última de E*TRADE el 23-oct
  const A = armar({ mz_et_tok: 'T', mz_et_sec: 'S', mz_et_dia: 'muerto', mz_et_sync2: JSON.stringify({ ts: MS('2026-10-24T04:10:00Z'), resumen: { estado: 'expirado' } }) },
    { libro: [fillET('2026-10-20'), fillET('2026-10-23'), { broker: 'moomoo', user_id: 'u1', ejecutado_at: '2026-11-02T14:00:00Z' }] });
  const h = A.M.pintarAvisoBrokers();
  const el = A.franja();
  assert(!!el && el.id === 'avisoBrk' && el.className === 'avbrk' && el.attrs.role === 'status' && el.attrs['aria-live'] === 'polite' && el._antesDe && el._antesDe.id === 'vista',
    'la franja #avisoBrk se crea UNA vez, justo antes de #vista (fuera de la vista: ninguna pestaña la pisa), con role=status y aria-live cortés');
  assert(/data-brk="etrade" data-estado="muerto"/.test(el.innerHTML) && /desde el <b>vie 23-oct<\/b> \(6 días hábiles\)/.test(el.innerHTML) && el.innerHTML === h,
    'sale la línea de E*TRADE: muerto, desde el vie 23-oct (6 días hábiles; un «expirado» guardado no cuenta como sincronización buena)');
  assert(!/schwab/.test(el.innerHTML), 'Schwab no se menciona: este equipo no lo usa ni hay datos suyos');
  // repintar sin cambios no toca el DOM (role=status no se re-anuncia)
  let escrituras = 0; const el0 = el; let valor = el0.innerHTML;
  Object.defineProperty(el0, 'innerHTML', { get: () => valor, set: (v) => { escrituras++; valor = v; }, configurable: true });
  A.M.pintarAvisoBrokers(); A.M.pintarAvisoBrokers();
  igual([escrituras, A.creados.length], [0, 1], 'repintar con lo mismo: ni una escritura en el DOM ni otra franja');
  // b. ocultar hasta mañana → se va; al día siguiente vuelve
  A.M.avisoOcultar('etrade');
  igual([valor, JSON.parse(A.ls.almacen.mz_aviso_brk_oculto)], ['', { etrade: HOY }], '«Ocultar hasta mañana»: la línea se va y se guarda el día NY');
  A.M.avisoOcultar('moomoo'); A.M.avisoOcultar('<x>');
  igual(Object.keys(JSON.parse(A.ls.almacen.mz_aviso_brk_oculto)), ['etrade'], 'solo E*TRADE y Schwab se pueden ocultar');
  A.E.hoy = '2026-11-03';
  assert(/data-brk="etrade"/.test(A.M.pintarAvisoBrokers()) && /\(7 días hábiles\)/.test(valor), 'al día siguiente vuelve (y ya son 7 días hábiles)');
  A.E.hoy = HOY; A.M.avisoOcultar('etrade');
  // c. reconectar (lo que deja etradePinEnviar: token nuevo y el día de hoy) → la franja desaparece sola y el «ocultar» se olvida
  A.ls.setItem('mz_et_tok', 'T2'); A.ls.setItem('mz_et_dia', HOY);
  igual([A.M.pintarAvisoBrokers(), valor], ['', ''], 'al reconectar E*TRADE la línea desaparece sola');
  assert(!('etrade' in (JSON.parse(A.ls.almacen.mz_aviso_brk_oculto || '{}'))), 'y el «ocultar hasta mañana» de E*TRADE se olvida (si vuelve a caerse hoy, se vuelve a decir)');
  A.ls.setItem('mz_et_dia', 'muerto');
  assert(/data-estado="muerto"/.test(A.M.pintarAvisoBrokers()), 'si vuelve a morir el mismo día, se vuelve a decir');
}
{
  // d. login de otro día (el token murió a medianoche): ámbar el primer día con la última sincronización buena guardada (ET_K.ok)
  const B = armar({ mz_et_tok: 'T', mz_et_sec: 'S', mz_et_dia: '2026-10-30', mz_et_ultok: String(MS('2026-10-30T20:55:00Z')),
    mz_et_sync2: JSON.stringify({ ts: MS('2026-10-31T01:00:00Z'), resumen: { estado: 'expirado' } }) });
  const h = B.M.pintarAvisoBrokers();
  assert(/^<div class="avl ambar" data-brk="etrade" data-estado="otro_dia">/.test(h) && /E\*TRADE: falta el login de hoy/.test(h) && /vie 30-oct/.test(h) && /última sincronización buena en este equipo/.test(h),
    'login del viernes, lunes: ámbar «falta el login de hoy», al día hasta el vie 30-oct (la clave de la última sincronización buena, aunque después se guardara un «expirado»)', h);
  // sin la clave nueva, una completa guardada con estado ok también vale (equipos que vienen de la v67)
  const B2 = armar({ mz_et_tok: 'T', mz_et_sec: 'S', mz_et_dia: '2026-10-23', mz_et_sync2: JSON.stringify({ ts: MS('2026-10-23T20:50:00Z'), resumen: { estado: 'ok' } }),
    mz_et_sync_lig: JSON.stringify({ ts: MS('2026-10-23T21:10:00Z'), estado: 'ok', fills: 0 }) });
  assert(/^<div class="avl rojo" data-brk="etrade" data-estado="otro_dia">/.test(B2.M.pintarAvisoBrokers()) && /desde el <b>vie 23-oct<\/b> \(6 días hábiles\)/.test(B2.M.pintarAvisoBrokers()),
    'equipo que viene de la v67 (sin ET_K.ok): la completa/ligera guardada con estado ok da la fecha; 6 días hábiles → rojo');
  const B3 = armar({ mz_et_tok: 'T', mz_et_sec: 'S', mz_et_dia: '2026-10-23', mz_et_sync_lig: JSON.stringify({ ts: MS('2026-10-30T15:00:00Z'), estado: 'ok', fills_err: 'sin tabla' }) });
  assert(/\(6 días hábiles\)/.test(B3.M.pintarAvisoBrokers()) && /último login/.test(B3.M.pintarAvisoBrokers()), 'una ligera que NO pudo escribir en el libro no cuenta como sincronización buena');
}
{
  // e. Schwab: login semanal caducado (refresh de hace 12 días) con datos; y nunca conectado aquí pero con datos
  const S = armar({ mz_sw_tok: 'A', mz_sw_ref: 'R', mz_sw_ref_ts: String(Date.now() - 12 * 86400000), mz_sw_sync: JSON.stringify({ ts: MS('2026-10-28T22:02:00Z'), resumen: { estado: 'ok' } }) });
  const h = S.M.pintarAvisoBrokers();
  assert(/data-brk="schwab" data-estado="caducado"/.test(h) && /mié 28-oct/.test(h) && /Conectar Schwab/.test(h) && !/data-brk="etrade"/.test(h), 'Schwab caducado: su línea (desde el mié 28-oct), sin E*TRADE', h);
  const S2 = armar({ mz_sw_tok: 'A', mz_sw_ref: 'R', mz_sw_muerto: '1' });
  assert(/data-brk="schwab" data-estado="caducado"/.test(S2.M.pintarAvisoBrokers()), 'Schwab con el refresh RECHAZADO (mz_sw_muerto): también');
  const S3 = armar({ mz_sw_tok: 'A', mz_sw_ref: 'R', mz_sw_ref_ts: String(Date.now() - 2 * 86400000) }, { libro: [{ broker: 'schwab', user_id: 'u1', ejecutado_at: '2026-10-01T15:00:00Z' }] });
  igual(S3.M.pintarAvisoBrokers(), '', 'Schwab con sesión viva: nada, aunque lo último sea viejo');
  const S4 = armar({}, { libro: [{ broker: 'schwab', user_id: 'u1', ejecutado_at: '2026-10-28T15:00:00Z' }, fillET('2026-10-23')] });
  const h4 = S4.M.pintarAvisoBrokers();
  assert(/data-brk="etrade" data-estado="sin_equipo"/.test(h4) && /data-brk="schwab" data-estado="sin_equipo"/.test(h4), 'nunca conectado en este equipo pero con datos de los dos: las dos líneas «no está conectado en este equipo»');
}
{
  // f. el amigo sin brókeres: libro con moomoo/tasty, ninguna clave → NADA (ni se crea la franja)
  const G = armar({}, { libro: [{ broker: 'moomoo', user_id: 'u1', ejecutado_at: '2026-10-30T15:00:00Z' }, { broker: 'tasty', user_id: 'u1', ejecutado_at: '2026-10-30T15:00:00Z' }] });
  igual([G.M.pintarAvisoBrokers(), G.creados.length, G.franja() || null], ['', 0, null], 'amigo sin E*TRADE ni Schwab: ninguna franja (ni el elemento)');
  // filas de E*TRADE de OTRO usuario (no debería pasar con RLS): no cuentan
  const G2 = armar({}, { libro: [{ ...fillET('2026-10-23'), user_id: 'OTRO' }] });
  igual(G2.M.pintarAvisoBrokers(), '', 'filas de otro usuario no cuentan (muralla user_id)');
  // broker_trades ya leídos por una vista (avisoAnotarTrades) también cuentan, y repintan solos
  const G3 = armar({});
  igual(G3.M.pintarAvisoBrokers(), '', 'sin nada cargado: nada');
  G3.M.avisoAnotarTrades({ data: [{ broker: 'etrade', user_id: 'u1', abierta_at: '2026-10-21T14:00:00Z', cerrada_at: '2026-10-23T19:00:00Z' }], error: null });
  assert(/data-estado="sin_equipo"/.test((G3.franja() || {}).innerHTML || ''), 'broker_trades que ya leyó una vista (avisoAnotarTrades): la franja aparece sola');
  G3.M.avisoAnotarTrades({ data: null, error: { message: 'x' } });
  assert(/data-estado="sin_equipo"/.test(G3.franja().innerHTML), 'una lectura con error no borra lo anotado');
  G3.ses.user.id = 'u2';
  igual(G3.M.pintarAvisoBrokers(), '', 'otro usuario en la misma página: lo anotado del anterior no vale');
}
{
  // g. almacenamiento bloqueado (ventana privada): no revienta, no hay franja por claves; «ocultar» vale en memoria
  const L = armar(null, { lsRoto: true, libro: [fillET('2026-10-23')] });
  let h = null; try { h = L.M.pintarAvisoBrokers(); } catch (e) { h = 'REVENTÓ ' + e.message; }
  assert(/data-estado="sin_equipo"/.test(h), 'con localStorage que lanza: no revienta y avisa por los datos', h);
  try { L.M.avisoOcultar('etrade'); } catch (_) {}
  igual(L.M.pintarAvisoBrokers(), '', '«Ocultar hasta mañana» sin almacenamiento: vale en memoria');
}
igual(RED, { fetch: 0, proxy: 0, sb: 0 }, 'en TODO el recorrido (crear, repintar, ocultar, reconectar, anotar): CERO llamadas de red — ni fetch, ni proxy, ni supabase');

// ════════════════ 5. el módulo ENTERO y el cableado ════════════════
{
  const red = { fetch: 0, from: 0 };
  const canal = { on() { return canal; }, subscribe() { return canal; } };
  const consulta = () => { red.from++; const q = {}; ['select', 'eq', 'in', 'not', 'like', 'order', 'limit', 'range', 'gt', 'gte', 'lte', 'is', 'insert', 'update', 'upsert', 'delete'].forEach(m => { q[m] = () => q; });
    q.maybeSingle = () => q; q.single = () => q; q.then = (f) => Promise.resolve({ data: [], error: null }).then(f); return q; };
  const M = C.cargarModuloEntero({ supabase: { createClient: () => ({ from: consulta, channel: () => canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
  assert(M.cargo, 'el main.js entero carga', M.error);
  M.win.fetch = () => { red.fetch++; return Promise.reject(new Error('sin red')); };
  const antes = { ...red };
  M.almacen.mz_et_tok = 'T'; M.almacen.mz_et_sec = 'S'; M.almacen.mz_et_dia = 'muerto';
  const h = M.ev('pintarAvisoBrokers()');
  assert(/data-brk="etrade" data-estado="muerto"/.test(h), 'en el módulo entero la franja sale del estado local (token muerto)');
  igual([red.fetch - antes.fetch, red.from - antes.from], [0, 0], '… sin una sola llamada de red (fetch ni supabase)');
  assert(typeof M.win.MZ.avisoOcultar === 'function' && typeof M.win.MZ.conectar === 'function' && typeof M.win.MZ.etSync === 'function', 'window.MZ: avisoOcultar se suma sin pisar conectar ni lo demás');
  // ruta() pinta la franja ANTES de esperar a nada (estadoWorker va a la red)
  const ru = extraer('ruta');
  const iP = ru.indexOf('pintarAvisoBrokers()'), iA = ru.indexOf('await ');
  assert(iP > 0 && iA > iP && ru.indexOf('if (!sesionActiva) return;') < iP, 'ruta(): con sesión, la franja se pinta en cada pasada y antes del primer await (todas las pestañas)');
  // las vistas que YA leen broker_trades la alimentan (sin consultas nuevas)
  [['vistaCopiloto', 'bt'], ['vistaDisciplina', 'btR'], ['vistaCuentasSaldos', 'btR'], ['vistaDiario', 'btR'], ['opsInforme', 'bt']].forEach(([f, v]) => {
    const src = extraer(f);
    assert(src.includes(`avisoAnotarTrades(${v})`) && /from\('broker_trades'\)/.test(src), f + ': anota los broker_trades que ya leía');
  });
  assert(!/sb\.from|fetch\(|etProxy\(/.test(['pintarAvisoBrokers', 'avisoBrokersLeer', 'avisoBrokersEstado', 'avisoBrokersHtml', 'avisoDatosBrokers', 'avisoAnotarTrades', 'avisoOcultar', 'ultimaEjecucionBrokers'].map(extraer).join('\n')),
    'el código del aviso no tiene ni una llamada de red (ni sb.from, ni fetch, ni etProxy)');
  // la última sincronización BUENA se guarda en las cuatro pasadas (completa y ligera de E*TRADE y de Schwab), sin tokens
  assert(/if \(resumen\.estado === 'ok' && ET_K\.ok\) \{ try \{ localStorage\.setItem\(ET_K\.ok, String\(resumen\.ts\)\)/.test(extraer('etradeSincronizarImpl'))
    && /if \(reg\.estado === 'ok' && !reg\.fills_err && ET_K\.ok\) \{ try \{ localStorage\.setItem\(ET_K\.ok, String\(reg\.ts\)\)/.test(extraer('etradeSincronizarLigera'))
    && /if \(resumen\.estado === 'ok' && SW_K\.ok\) \{ try \{ localStorage\.setItem\(SW_K\.ok, String\(resumen\.ts\)\)/.test(extraer('schwabSincronizarImpl'))
    && /if \(reg\.estado === 'ok' && !reg\.fills_err && SW_K\.ok\) \{ try \{ localStorage\.setItem\(SW_K\.ok, String\(reg\.ts\)\)/.test(extraer('schwabSincronizarLigera')),
    'las cuatro pasadas guardan la hora de la última sincronización BUENA (solo un número; un «expirado» no la pisa)');
  const K = construir([], {}, { consts: ['ET_K', 'SW_K'] });
  igual([K.ET_K.ok, K.SW_K.ok], ['mz_et_ultok', 'mz_sw_ultok'], 'en ET_K / SW_K: «olvidar en este equipo» (etOlvidar / swOlvidar) también la borra');
}

// ════════════════ 6. index.html: sin desborde a 375 px, legible en los dos temas, ancho grande ════════════════
{
  const cssRuta = [path.join(path.dirname(path.resolve(process.argv[2])), '..', 'index.html'), path.join(__dirname, '..', 'index.html')].find(r => fs.existsSync(r));
  const css = cssRuta ? fs.readFileSync(cssRuta, 'utf8') : '';
  const regla = (sel) => { const m = new RegExp('(?:^|[}\\n])\\s*' + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css); return m ? m[1] : null; };
  const avl = regla('.avl') || '', avt = regla('.avl .avt') || '', avb = regla('.avl .avb') || '';
  assert(/flex-wrap:\s*wrap/.test(avl) && /min-width:\s*0/.test(avt) && /overflow-wrap:\s*anywhere/.test(avt) && /flex-wrap:\s*wrap/.test(avb) && /max-width:\s*100%/.test(avb),
    'a 375 px el texto se parte y los botones bajan a su fila (sin desborde lateral)', [avl, avt, avb].join(' | '));
  assert(/var\(--tx\)/.test(avl) && /var\(--rojo\)/.test(regla('.avl .avtit') || '') && /var\(--oro\)/.test(regla('.avl.ambar .avtit') || ''), 'colores con las variables del tema (claro y oscuro)');
  assert(/\.avbrk:empty\{display:none\}/.test(css) && /#app\.ancho \.avbrk\{margin:2px 24px 4px\}/.test(css), 'vacía no ocupa sitio; en la computadora sigue el margen de la vista ancha');
}

C.resumen();
