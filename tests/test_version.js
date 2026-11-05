#!/usr/bin/env node
/* Pruebas de la actualización sola de la PWA (v47+): VERSION_APP desde el ?v= del
   script, versionPublicada, buscarVersionNueva (no-store, solo una versión MAYOR)
   y recargarSiSePuede (espera mientras haya un cuadro abierto o un corte en curso).
   v66 (A1 «no lo veo publicado», spec68 2026-10-31): se pregunta al arrancar, cada 5 min con la Mesa a la vista, en
   visibilitychange, focus, online y pageshow (bfcache) con un mínimo de 15 s entre respuestas; no se recarga con un cuadro,
   una salida o una orden en vuelo ni con un campo de texto enfocado con algo escrito, y entonces lo dice una franja con
   «Actualizar ahora» y la marca «vNN → vMM» junto a la fecha; como mucho 1 recarga por versión cada 10 min
   (sessionStorage) y a la segunda se pide al SW que se actualice («Cierra y vuelve a abrir la Mesa para la vNN»);
   ⚙ Tu cuenta dice la versión (de VERSION_APP) y cuándo se cargó; sw.js v55: navegación e index.html con no-cache y
   sin guardar lo pedido con no-store (se ejecuta sw.js en un contexto de juguete).
   rev68 (revisor de A1): una orden enviada o una cancelación en vuelo frena la recarga aunque el formulario ya se haya
   cerrado («Cancelar» con el POST en vuelo) o no haya formulario (cancelar desde la lista del Copiloto) — 4b; y la
   recarga ya decidida (700 ms) vuelve a mirar al dispararse: un corte o la GTC automática que empiezan en el hueco — 4c;
   la franja aparta el cuadro abierto (body.con-vernueva) y no ofrece «Actualizar ahora» sobre el formulario de una orden — 4d.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_version.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_version.js');
const { FUENTE, assert, igual, construir, nodo } = C;

// ════════════════ 1. VERSION_APP: el ?v= con que index.html cargó main.js ════════════════
const ver = (script) => construir([], { document: script }, { consts: ['VERSION_APP'] }).VERSION_APP;
igual(ver({ currentScript: { src: './app/main.js?v=51' } }), 51, 'main.js?v=51 → 51');
igual(ver({ currentScript: { src: 'https://avaldano2211.github.io/mesa-2/app/main.js?x=1&v=7' } }), 7, 'el v puede ir detrás de otro parámetro (&v=)');
igual(ver({ currentScript: { src: './app/main.js' } }), 0, 'sin ?v= → 0 (y con 0 la app no busca versiones: no sabe cuál corre)');
igual(ver({ currentScript: null }), 0, 'sin currentScript (script cargado a mano) → 0');
igual(ver({ get currentScript() { throw new Error('no'); } }), 0, 'si el navegador revienta al leerlo → 0, sin tumbar la carga');
igual(ver({ currentScript: { src: './app/main.js?v=abc' } }), 0, 'un v que no es número → 0');

// ════════════════ 2. versionPublicada: lo que dice el index.html publicado ════════════════
{
  const V = construir(['versionPublicada']);
  igual(V.versionPublicada('<script src="./config.js?v=52"></script>\n<script src="./app/main.js?v=52"></script>'), 52, 'lee el ?v= de app/main.js del HTML');
  igual(V.versionPublicada('<script src="./app/main.js?v=53">'), 53, 'con solo la línea de main.js también');
  igual(V.versionPublicada('<script src="./config.js?v=52">'), 0, 'el ?v= de config.js NO cuenta: manda el de main.js');
  igual(V.versionPublicada('<html>sin scripts</html>'), 0, 'sin main.js → 0');
  igual([V.versionPublicada(null), V.versionPublicada(''), V.versionPublicada(undefined)], [0, 0, 0], 'sin HTML → 0');
  igual(V.versionPublicada('app/main.js?v=abc'), 0, 'v no numérico → 0');
}

// ════════════════ 3. buscarVersionNueva: no-store, una sola vez a la vez, SOLO mayor, mínimo de 15 s ════════════════
const tiene = (n) => { try { C.extraer(n); return true; } catch (_) { return false; } };
const ESTADO = "let _buscandoVersion = false, _versionPendiente = 0; const _verEstado = { ultima: 0, timer: 0, atascada: 0, oculta: '' };";
function armarBusqueda(E) {
  E = Object.assign({ version: 51, ok: true, html: '<script src="./app/main.js?v=52">', lanzar: null, diferir: false }, E || {});
  const reg = { fetches: [], recargas: [] };
  const M = construir(['buscarVersionNueva', 'versionPublicada'], {
    VERSION_APP: E.version,
    fetch: async (url, op) => {
      reg.fetches.push({ url, op });
      if (E.lanzar) throw new Error(E.lanzar);
      if (E.diferir) await E.diferir.promesa;
      return { ok: E.ok, text: async () => E.html };
    },
    recargarSiSePuede: () => reg.recargas.push(true),
  }, { consts: ['VERSION_MIN_MS'].filter(C.existeConst), prefijo: ESTADO, sufijo: 'function __pendiente() { return _versionPendiente; } function __buscando() { return _buscandoVersion; } function __estado() { return _verEstado; }', extras: ['__pendiente', '__buscando', '__estado'] });
  return { M, reg, E };
}
(async () => {
  {
    const { M, reg } = armarBusqueda();
    await M.buscarVersionNueva();
    igual(reg.fetches.length, 1, 'se pide el index.html publicado');
    assert(/^\.\/index\.html\?nv=\d+$/.test(reg.fetches[0].url), 'con un parámetro nv= distinto cada vez (rompe la caché del navegador)', reg.fetches[0].url);
    igual(reg.fetches[0].op.cache, 'no-store', 'y con cache: no-store (el service worker no puede servir un index viejo)');
    igual([reg.recargas.length, M.__pendiente()], [1, 52], 'publicada 52 > corre 51: queda pendiente y se intenta recargar');
    igual(M.__buscando(), false, 'la bandera de búsqueda se suelta al terminar');
    // v66: focus + pageshow + visibilitychange llegan juntos al volver: una sola pregunta en 15 s
    await M.buscarVersionNueva(); await M.buscarVersionNueva();
    igual(reg.fetches.length, 1, '(v66) otra pregunta antes de 15 s de una respuesta buena no sale (al volver llegan tres eventos juntos)');
    M.__estado().ultima = Date.now() - 16000;
    await M.buscarVersionNueva();
    igual(reg.fetches.length, 2, '(v66) pasados 15 s vuelve a preguntar');
    igual(C.existeConst('VERSION_MIN_MS') && C.extraerConst('VERSION_MIN_MS'), 'const VERSION_MIN_MS = 15000;', '(v66) el mínimo es de 15 s');
  }
  { const { M, reg } = armarBusqueda({ html: '<script src="./app/main.js?v=51">' }); await M.buscarVersionNueva(); igual([reg.recargas.length, M.__pendiente()], [0, 0], 'la misma versión: nada que hacer'); }
  { const { M, reg } = armarBusqueda({ html: '<script src="./app/main.js?v=50">' }); await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'una publicada MENOR (rollback o caché rara) no recarga: solo mayor'); }
  { const { M, reg } = armarBusqueda({ html: '<html>sin scripts</html>' }); await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'un index.html sin main.js (0) no recarga'); }
  {
    const { M, reg, E } = armarBusqueda({ ok: false });
    await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'una respuesta no ok (404/500 de Pages) no recarga'); igual(M.__buscando(), false, 'y suelta la bandera');
    E.ok = true; await M.buscarVersionNueva();
    igual([reg.fetches.length, reg.recargas.length], [2, 1], '(v66) una respuesta mala no cuenta para el mínimo de 15 s: la siguiente ocasión pregunta ya');
  }
  {
    const { M, reg, E } = armarBusqueda({ lanzar: 'sin red' });
    await M.buscarVersionNueva();
    igual([reg.recargas.length, M.__buscando()], [0, false], 'sin red: no revienta, no recarga y suelta la bandera');
    E.lanzar = null; await M.buscarVersionNueva();
    igual([reg.fetches.length, reg.recargas.length], [2, 1], 'en la siguiente ocasión vuelve a mirar y ya recarga');
  }
  { const { M, reg } = armarBusqueda({ version: 0 }); await M.buscarVersionNueva(); igual(reg.fetches.length, 0, 'con VERSION_APP 0 (no se sabe qué corre) ni se pregunta'); }
  {
    const d = C.diferido();
    const { M, reg } = armarBusqueda({ diferir: d });
    const p1 = M.buscarVersionNueva(), p2 = M.buscarVersionNueva();
    igual([reg.fetches.length, M.__buscando()], [1, true], 'dos búsquedas a la vez (arranque + visibilitychange) = UN fetch');
    d.resolver(); await p1; await p2;
    igual([reg.recargas.length, M.__buscando()], [1, false], 'y una sola recarga pendiente');
  }

  // ════════════════ 4. recargarSiSePuede: jamás a mitad de una orden, de una salida, de un cuadro ni de un texto ════════════════
  const RECARGA = ['recargarSiSePuede', 'motivoNoRecargar', 'campoConTexto', 'recargaYaIntentada', 'anotarRecarga', 'pedirActualizarSW', 'franjaVersion', 'pintarVersionCab', 'actualizarAhora', 'textoVersionApp', 'ocultarFranjaVersion'];
  const RECARGA_REV68 = ['marcarFranjaVersion'].filter(tiene);   // rev68: la franja aparta el cuadro (sin ella, la suite de antes)
  const sesionFalsa = (inicial, rota) => {
    const alm = Object.assign({}, inicial || {});
    return { alm, getItem: (k) => { if (rota) throw new Error('bloqueado'); return k in alm ? alm[k] : null; }, setItem: (k, v) => { if (rota) throw new Error('bloqueado'); alm[k] = String(v); } };
  };
  function armarRecarga(E) {
    E = Object.assign({ pendiente: 52, version: 51, modal: null, corte: false, venta: false, ord: null, activo: null, sesion: null, sesionRota: false, swUpdate: true, ahora: null,
      altoFranja: 65, formOrden: false }, E || {});
    const reg = { toasts: [], timers: [], reloads: 0, updates: 0, dom: {}, cab: { texto: '', oculto: true }, body: {}, vars: {} };
    if (E.formOrden) reg.dom['#modalOrden'] = { id: 'modalOrden' };   // rev68: el formulario de una orden abierto
    const ss = sesionFalsa(E.sesion, E.sesionRota);
    const verCab = { set textContent(t) { reg.cab.texto = t; }, get textContent() { return reg.cab.texto; }, classList: { toggle: (c, on) => { if (c === 'oculto') reg.cab.oculto = !!on; } } };
    const $ = (s) => (s === '#verCab' ? verCab : reg.dom[s] || null);
    const doc = {
      querySelector: (s) => (s === '.modal' ? E.modal : null),
      get activeElement() { return E.activo; },
      createElement: () => { const n = { innerHTML: '', id: '', className: '', attrs: {}, offsetHeight: E.altoFranja, setAttribute(k, v) { n.attrs[k] = v; }, remove() { delete reg.dom['#' + n.id]; } }; return n; },
      body: { appendChild: (n) => { reg.dom['#' + n.id] = n; }, classList: { toggle: (c, on) => { reg.body[c] = !!on; } } },
      documentElement: { style: { setProperty: (k, v) => { reg.vars[k] = v; } } },
    };
    const M = construir(RECARGA.concat(RECARGA_REV68), {
      document: doc, $, esc: C.esc, VERSION_APP: E.version, VERSION_CARGADA_MS: Date.parse('2026-10-31T14:42:00Z'),
      _corte: { enCurso: E.corte }, _venta: { enCurso: E.venta }, _ord: E.ord, toast: (t) => reg.toasts.push(t),
      setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; },
      location: { reload: () => reg.reloads++ }, sessionStorage: ss,
      navigator: { serviceWorker: E.swUpdate ? { getRegistration: () => Promise.resolve({ update: () => { reg.updates++; return Promise.resolve(); } }) } : undefined },
      ymdNY: C.ymdNY, horaNY: (ms) => new Intl.DateTimeFormat('es', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)),
      fechaCorta: (ymd) => Number(String(ymd).slice(8, 10)) + ' ' + ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'][Number(String(ymd).slice(5, 7)) - 1],
    }, { consts: ['VERSION_ESPERA_MS', 'VERSION_RECARGA_K', 'VERSION_RECARGA_VENTANA_MS'], prefijo: ESTADO.replace('_versionPendiente = 0', '_versionPendiente = ' + E.pendiente),
      sufijo: 'function __estado() { return _verEstado; } function __pend(v) { _versionPendiente = v; }', extras: ['__estado', '__pend'] });
    return { M, reg, E, ss };
  }
  const franja = (reg) => reg.dom['#verNueva'] ? reg.dom['#verNueva'].innerHTML : '';
  if (!RECARGA.every(tiene)) C.falla('(v66) faltan funciones de la actualización: ' + RECARGA.filter(n => !tiene(n)).join(', '));
  else {
    { const { M, reg } = armarRecarga({ pendiente: 0 }); M.recargarSiSePuede(); igual([reg.timers.length, reg.toasts.length, reg.reloads, franja(reg)], [0, 0, 0, ''], 'sin versión pendiente no hace nada'); }
    {
      const { M, reg } = armarRecarga({ modal: {} });
      M.recargarSiSePuede();
      igual([reg.toasts.length, reg.reloads, reg.timers.length, reg.timers[0].ms], [0, 0, 1, 15000], 'con un cuadro abierto (.modal: una orden, un fill, el PIN, la calculadora) espera 15 s');
      igual(franja(reg), '<span>Hay una versión nueva (v52): se actualiza al cerrar el cuadro</span><button type="button" onclick="MZ.actualizarAhora()">Actualizar ahora</button><button type="button" class="vercerrar" onclick="MZ.ocultarFranjaVersion(\'cuadro\')" aria-label="Ocultar este aviso">✕</button>', '(v66) y lo dice: la franja «Hay una versión nueva (v52): se actualiza al cerrar el cuadro» con «Actualizar ahora» y ✕');
      igual([reg.dom['#verNueva'].className, reg.dom['#verNueva'].attrs.role], ['vernueva', 'status'], '(v66) la franja es discreta (.vernueva) y la lee el lector de pantalla (role status)');
      igual([reg.cab.texto, reg.cab.oculto], ['v51 → v52', false], '(v66) y junto a la fecha de la cabecera, en pequeño: «v51 → v52»');
      M.recargarSiSePuede(); M.recargarSiSePuede();
      igual(reg.timers.length, 1, '(v66) cada búsqueda que vuelve a encontrarla NO apila otra espera de 15 s (antes se acumulaban)');
      M.ocultarFranjaVersion('cuadro');
      igual([franja(reg), reg.cab.texto, reg.cab.oculto], ['', 'v51 → v52', false], '(v66) ✕ oculta la franja; la marca de la cabecera sigue');
      M.recargarSiSePuede();
      igual(franja(reg), '', '(v66) y no vuelve a salir por el mismo motivo y la misma versión (cada 15 s llega lo mismo)');
      M.__pend(53); M.recargarSiSePuede();
      assert(/v53/.test(franja(reg)), '(v66) con OTRA versión vuelve a salir');
      M.__pend(52);
      reg.timers[0].fn();
      igual([reg.reloads, reg.timers.length], [0, 2], 'si el cuadro sigue abierto a los 15 s, vuelve a esperar');
    }
    {
      const E0 = { modal: {} };
      const { M, reg, E, ss } = armarRecarga(E0);
      M.recargarSiSePuede();
      E.modal = null;                       // se cierra el cuadro
      reg.timers[0].fn();
      igual(reg.toasts, ['Actualizando la Mesa a la versión 52…'], 'cerrado el cuadro, a los 15 s se actualiza sola (avisa con la versión que viene)');
      igual([reg.reloads, reg.timers[1].ms], [0, 700], 'y recarga a los 700 ms (que se lea el toast)');
      reg.timers[1].fn();
      igual(reg.reloads, 1, 'la recarga es location.reload()');
      const anot = JSON.parse(ss.alm.mz_recarga_version || 'null');
      assert(anot && anot.v === 52 && Math.abs(Date.now() - anot.ts) < 5000, '(v66) antes de recargar se anota en sessionStorage la versión y la hora (el freno del bucle)', JSON.stringify(anot));
    }
    {
      const { M, reg } = armarRecarga({ corte: true });
      M.recargarSiSePuede();
      igual([reg.reloads, reg.timers.length, reg.timers[0].ms], [0, 1, 15000], 'con un corte en curso también espera: la recarga mataría la espera de la cancelación');
      igual(franja(reg), '<span>Hay una versión nueva (v52): se actualiza al terminar la salida en curso</span><button type="button" class="vercerrar" onclick="MZ.ocultarFranjaVersion(\'corte\')" aria-label="Ocultar este aviso">✕</button>', '(v66) la franja lo dice, SIN «Actualizar ahora» (no se puede mientras el bróker no conteste)');
    }
    { const { M, reg } = armarRecarga({ venta: true }); M.recargarSiSePuede(); igual([reg.reloads, reg.timers.length], [0, 1], '(v66) una venta con cancelación esperando al bróker (_venta.enCurso) también frena la recarga, como el corte'); }
    {
      for (const o of [{ enviando: true }, { indeterminado: true }]) {
        const { M, reg } = armarRecarga({ ord: o, modal: {} });
        M.recargarSiSePuede();
        assert(reg.reloads === 0 && /cuando el bróker conteste a la orden/.test(franja(reg)) && !/Actualizar ahora/.test(franja(reg)), '(v66) una orden ' + Object.keys(o)[0] + ': espera a que el bróker conteste, sin «Actualizar ahora»', franja(reg));
      }
    }
    // un campo de texto enfocado con algo escrito
    {
      const campo = (tagName, type, value, extra) => Object.assign({ tagName, type, value }, extra || {});
      const casos = [
        [campo('INPUT', 'text', 'nota a medias'), 'texto', 'un input de texto con algo escrito'],
        [campo('TEXTAREA', undefined, 'AAPL rompió el techo…'), 'texto', 'un textarea con algo escrito (la nota del Diario)'],
        [campo('INPUT', 'number', '1.35'), 'texto', 'un número a medias (la prima)'],
        [campo('INPUT', 'password', 'x'), 'texto', 'la contraseña nueva a medio escribir'],
        [{ tagName: 'DIV', isContentEditable: true, textContent: 'hola' }, 'texto', 'un contenteditable con texto'],
        [campo('INPUT', 'text', ''), '', 'un input vacío no frena'],
        [campo('TEXTAREA', undefined, '   \n '), '', 'solo espacios no frenan'],
        [campo('INPUT', 'checkbox', 'on'), '', 'una casilla no es texto'],
        [campo('BUTTON', 'button', 'Ver'), '', 'un botón no es texto'],
        [{ tagName: 'DIV', isContentEditable: false, textContent: 'algo' }, '', 'un div normal no es texto'],
        [null, '', 'sin nada enfocado no frena'],
      ];
      for (const [activo, esperado, msg] of casos) {
        const { M, reg } = armarRecarga({ activo });
        igual(M.motivoNoRecargar(), esperado, '(v66) motivoNoRecargar: ' + msg);
        M.recargarSiSePuede();
        if (esperado) assert(reg.reloads === 0 && reg.toasts.length === 0 && /se actualiza al terminar de escribir/.test(franja(reg)) && /Actualizar ahora/.test(franja(reg)), '(v66) ' + msg + ': no recarga y la franja dice «se actualiza al terminar de escribir»', franja(reg));
        else assert(reg.toasts.length === 1 && !franja(reg), '(v66) ' + msg + ': se actualiza', JSON.stringify(reg.toasts));
      }
    }
    // el freno del bucle: como mucho 1 recarga por versión cada 10 min
    {
      const hace = (ms) => JSON.stringify({ v: 52, ts: Date.now() - ms });
      const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: hace(60000) } });
      M.recargarSiSePuede();
      await C.respirar();
      igual([reg.reloads, reg.toasts.length], [0, 0], '(v66) ya se recargó por la v52 hace 1 min y sigue corriendo la v51 (caché): NO se recarga otra vez (sin bucle)');
      igual(reg.updates, 1, '(v66) a la segunda se pide al service worker que se actualice (registration.update())');
      igual(franja(reg), '<span>Cierra y vuelve a abrir la Mesa para la v52</span><button type="button" onclick="MZ.actualizarAhora()">Actualizar ahora</button><button type="button" class="vercerrar" onclick="MZ.ocultarFranjaVersion(\'atascada\')" aria-label="Ocultar este aviso">✕</button>', '(v66) y se dice «Cierra y vuelve a abrir la Mesa para la v52»');
      M.recargarSiSePuede(); M.recargarSiSePuede();
      await C.respirar();
      igual([reg.reloads, reg.updates], [0, 1], '(v66) las búsquedas siguientes (cada 5 min) no recargan ni vuelven a molestar al SW');
      assert(/ya está la v52: cierra y vuelve a abrir la Mesa/.test(M.textoVersionApp()), '(v66) ⚙ Tu cuenta también lo dice');
    }
    { const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: JSON.stringify({ v: 52, ts: Date.now() - 11 * 60000 }) } }); M.recargarSiSePuede(); igual(reg.toasts.length, 1, '(v66) pasados 10 min se permite OTRA recarga por la misma versión (1 cada 10 min)'); }
    { const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: JSON.stringify({ v: 51, ts: Date.now() - 1000 }) } }); M.recargarSiSePuede(); igual(reg.toasts.length, 1, '(v66) la anotación de OTRA versión no frena'); }
    { const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: JSON.stringify({ v: 52, ts: Date.now() + 3600000 }) } }); M.recargarSiSePuede(); igual(reg.toasts.length, 1, '(v66) una anotación del futuro (reloj cambiado) no frena para siempre'); }
    { const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: '{roto' } }); M.recargarSiSePuede(); igual(reg.toasts.length, 1, '(v66) una anotación ilegible no revienta'); }
    { const { M, reg } = armarRecarga({ sesionRota: true }); M.recargarSiSePuede(); igual([reg.toasts.length, reg.timers.length], [1, 1], '(v66) sin sessionStorage (bloqueado: try/catch) se actualiza como antes, sin reventar'); }
    { const { M, reg } = armarRecarga({ sesion: { mz_recarga_version: JSON.stringify({ v: 52, ts: Date.now() - 1000 }) }, swUpdate: false }); M.recargarSiSePuede(); igual(reg.reloads, 0, '(v66) sin service worker (navegador sin SW) el freno sigue y no revienta'); }
    // «Actualizar ahora»
    {
      const { M, reg, ss } = armarRecarga({ modal: {} });
      M.actualizarAhora();
      igual(reg.reloads, 1, '(v66) «Actualizar ahora» es el toque de Andrés: recarga aunque haya un cuadro abierto');
      assert(JSON.parse(ss.alm.mz_recarga_version).v === 52, '(v66) y también anota la recarga (el freno del bucle cuenta con ella)');
    }
    { const { M, reg } = armarRecarga({ activo: { tagName: 'INPUT', type: 'text', value: 'x' } }); M.actualizarAhora(); igual(reg.reloads, 1, '(v66) «Actualizar ahora» con texto a medias: recarga (a sabiendas)'); }
    for (const [nombre, E] of [['un corte', { corte: true }], ['una venta con cancelación', { venta: true }], ['una orden enviándose', { ord: { enviando: true } }], ['una orden indeterminada', { ord: { indeterminado: true } }]]) {
      const { M, reg } = armarRecarga(E);
      M.actualizarAhora();
      assert(reg.reloads === 0 && /Espera a que termine/.test(reg.toasts[0] || ''), '(v66) «Actualizar ahora» NUNCA con ' + nombre + ' esperando al bróker: lo dice y no recarga');
    }
    // la versión que corre: ⚙ Tu cuenta y la cabecera
    {
      const { M, reg } = armarRecarga({ pendiente: 0, version: 66 });
      igual(M.textoVersionApp(Date.parse('2026-10-31T20:00:00Z')), 'Mesa 2.0 · versión 66 · cargada hoy a las 10:42 ET', '(v66) ⚙ Tu cuenta: «Mesa 2.0 · versión 66» y la hora NY en que se cargó');
      igual(M.textoVersionApp(Date.parse('2026-11-02T15:00:00Z')), 'Mesa 2.0 · versión 66 · cargada el 31 oct a las 10:42 ET', '(v66) cargada otro día: se dice el día (una pestaña abierta desde hace días se delata)');
      M.pintarVersionCab();
      igual([reg.cab.texto, reg.cab.oculto], ['', true], '(v66) sin versión pendiente, la cabecera NO lleva marca');
      M.__pend(67);
      assert(/· hay una nueva \(v67\): se actualiza al cerrar este cuadro$/.test(M.textoVersionApp()), '(v66) con una pendiente, ⚙ lo dice');
      M.pintarVersionCab();
      igual([reg.cab.texto, reg.cab.oculto], ['v66 → v67', false], '(v66) y la cabecera: «v66 → v67»');
    }
    { const { M } = armarRecarga({ pendiente: 0, version: 0 }); assert(/^Mesa 2\.0 · versión sin número · /.test(M.textoVersionApp()), '(v66) sin ?v= no se inventa un número'); }
    assert(!/\b6\d\b/.test(C.extraer('textoVersionApp')) && /VERSION_APP/.test(C.extraer('textoVersionApp')), '(v66) el número sale de VERSION_APP: no está escrito a mano');
    assert(/id="cpVersion"[^>]*>\$\{esc\(textoVersionApp\(\)\)\}<\/div>/.test(C.extraer('abrirCuenta')), '(v66) ⚙ Tu cuenta pinta textoVersionApp()');
  }

  // ════════════════ 4d. rev68 · la franja no tapa la hoja abierta ni ofrece «Actualizar ahora» sobre una orden ════════════════
  // El revisor de A1: la franja (fija a 64 px bajo la muesca, encima del .modal) tapaba la primera banda de las hojas altas:
  // a 375×812 el ✕ de la calculadora quedaba bajo el ✕ de la franja y el título del formulario de orden bajo la franja.
  {
    {
      const { M, reg } = armarRecarga({ modal: {}, altoFranja: 65 });
      M.recargarSiSePuede();
      igual([reg.body['con-vernueva'], reg.vars['--vernueva-alto']], [true, '65px'], '(rev68) con la franja a la vista, el body lleva .con-vernueva y su alto medido (--vernueva-alto: 65px) para apartar el cuadro');
      M.ocultarFranjaVersion('cuadro');
      igual(reg.body['con-vernueva'], false, '(rev68) ✕ la quita y el cuadro vuelve a su sitio');
      M.__pend(53); M.recargarSiSePuede();
      igual(reg.body['con-vernueva'], true, '(rev68) con otra versión vuelve a salir (y vuelve a apartar el cuadro)');
    }
    {
      const { M, reg } = armarRecarga({ modal: {} });
      M.recargarSiSePuede();
      M.franjaVersion('');                         // quitarla (franjaVersion sin estado)
      igual([franja(reg), reg.body['con-vernueva']], ['', false], '(rev68) franjaVersion sin estado la quita y el body pierde .con-vernueva');
    }
    {
      const { M, reg } = armarRecarga({ modal: {}, formOrden: true });
      M.recargarSiSePuede();
      assert(/se actualiza al cerrar el cuadro/.test(franja(reg)) && !/Actualizar ahora/.test(franja(reg)),
        '(rev68) con el FORMULARIO DE UNA ORDEN abierto (en un corte, con las ventas vivas ya canceladas) la franja no ofrece «Actualizar ahora»', franja(reg));
      M.actualizarAhora();
      assert(reg.reloads === 0 && /Cierra antes el formulario de la orden/.test(reg.toasts.slice(-1)[0] || ''), '(rev68) y «Actualizar ahora» de una franja pintada antes tampoco recarga encima de la orden: lo dice');
    }
    {
      const { M, reg } = armarRecarga({ modal: {} });   // la calculadora u otro cuadro: el botón sigue
      M.recargarSiSePuede();
      assert(/Actualizar ahora/.test(franja(reg)), '(rev68) con otro cuadro (la calculadora, ⚙) «Actualizar ahora» sigue');
    }
    const raiz = path.resolve(path.dirname(process.argv[2]), '..'), index = path.join(raiz, 'index.html');
    if (fs.existsSync(index)) {
      const css = fs.readFileSync(index, 'utf8');
      const topF = /\.vernueva\{[^}]*top:calc\(env\(safe-area-inset-top\) \+ (\d+)px\)/.exec(css);
      const padM = /body\.con-vernueva \.modal\{padding-top:calc\(env\(safe-area-inset-top\) \+ (\d+)px \+ var\(--vernueva-alto,\d+px\)\)\}/.exec(css);
      assert(topF && padM && Number(padM[1]) > Number(topF[1]),
        '(rev68) index.html: con .con-vernueva el .modal empieza por debajo de la franja (muesca + ' + (padM && padM[1]) + ' px + su alto > muesca + ' + (topF && topF[1]) + ' px + su alto)');
      assert(/body\.con-vernueva \.modal>\.hoja\{max-height:min\(92dvh,100%\)\}/.test(css), '(rev68) …y la hoja cabe en lo que queda (max-height: min(92dvh, 100%))');
    }
  }

  // ════════════════ 4b. rev68 · una escritura al bróker EN VUELO frena la recarga aunque el formulario ya no esté ════════════════
  // El revisor de A1: «Cancelar» sigue activo con el POST de la orden en vuelo (no tiene tope) y cerrarOrden pone _ord = null;
  // motivoNoRecargar solo miraba _ord, así que la re-comprobación de 15 s recargaba con la orden en el aire: la fila se
  // quedaba en «preview» y no salía el «Verifica en E*TRADE». Igual al cancelar desde la lista del Copiloto (sin cuadro).
  {
    const NOMB = ['ordenPlace', 'ordenPlaceSchwab', 'cerrarOrden', 'expirarPreviewHuerfana', 'cancelarOrden', 'cancelarOrdenSchwab', 'motivoNoRecargar', 'campoConTexto',
      'recargarSiSePuede', 'recargaYaIntentada', 'anotarRecarga', 'pedirActualizarSW'];
    const hayContador = C.existeConst('_escriturasBroker');
    const armarEnvio = (op) => {
      op = Object.assign({ falla: false, modal: true }, op || {});
      const reg = { reloads: 0, timers: [], franja: [], anotado: [], alerts: [], toasts: [], posts: [] };
      let modal = op.modal;
      const err = nodo(), btn = nodo();
      const doc = { activeElement: null, querySelector: (s) => (s === '.modal' && modal) ? nodo() : null };
      const $ = (s) => s === '#oErr' ? err : s === '#oBtnPlace' ? btn : s === '#modalOrden' ? (modal ? { remove() { modal = false; } } : null) : null;
      const pend = { '/etrade/orden/place': C.diferido(), '/etrade/orden/cancel': C.diferido(), '/schwab/orden/place': C.diferido(), '/schwab/orden/cancel': C.diferido() };
      const sb = { from: () => ({ update: (o) => ({ eq: async () => { reg.anotado.push(o.estado); return { error: null }; } }) }) };
      const post = async (ruta) => { reg.posts.push(ruta); if (op.falla) throw new Error('No pude contactar el proxy (¿Funnel activo?).'); return pend[ruta].promesa; };
      const M = construir(NOMB, {
        $, document: doc, sb, armadoHasta: () => Date.now() + 60000, pedirPin: async () => true, etCreds: () => ({ t: 'x' }),
        etPost: (cr, ruta) => post(ruta), swPost: (ruta) => post(ruta),
        mensajeError: () => null, swMensajeError: () => null, recortarJson: (o) => o, etDiaVencido: () => false, etCuentaKey: async () => 'k1',
        swCreds: () => ({ token: 't' }), swVencido: () => false, swCuenta: async () => 'HASH', confirm: () => true, texto401Ordenes: (m) => m,
        marcarCancelando: async () => {}, fueraMarcarCancelando: () => {}, ordenesActualizar: () => {},
        toast: (m) => reg.toasts.push(m), ruta: () => {}, alert: (m) => reg.alerts.push(m),
        location: { reload: () => reg.reloads++ },
        setTimeout: (f, ms) => { reg.timers.push({ f, ms }); return reg.timers.length; }, clearTimeout: () => {}, clearInterval: () => {},
        sessionStorage: { getItem: () => null, setItem: () => {} }, navigator: {}, franjaVersion: (m) => reg.franja.push(m),
      }, { consts: ['VERSION_ESPERA_MS', 'VERSION_RECARGA_K', 'VERSION_RECARGA_VENTANA_MS'].concat(hayContador ? ['_escriturasBroker'] : []),
        prefijo: "let _ord = null; const _corte = { enCurso: false }; const _venta = { enCurso: false };\n" +
          "let _versionPendiente = 67; const _verEstado = { ultima: 0, timer: 0, atascada: 0, oculta: '' };",
        sufijo: 'function __set(o) { _ord = o; } function __ord() { return _ord; }', extras: ['__set', '__ord'] });
      const form = (broker) => ({ orden: { x: 1 }, previewIds: [1], caduca: Date.now() + 120000, filaId: 9, estadoFila: 'preview', accountIdKey: 'k1', timer: null, broker });
      const recarga = () => reg.timers.find(t => t.ms === 700);
      return { M, reg, pend, form, recarga };
    };
    for (const broker of ['etrade', 'schwab']) {
      const nombre = broker === 'etrade' ? 'E*TRADE' : 'Schwab';
      const { M, reg, pend, form, recarga } = armarEnvio();
      M.__set(form(broker));
      igual(M.motivoNoRecargar(), 'cuadro', `(rev68) ${nombre}: con el formulario de orden abierto, el motivo es «cuadro»`);
      const envio = M.ordenPlace();
      await C.respirar();
      igual([reg.posts, M.motivoNoRecargar()], [[`/${broker}/orden/place`], 'orden'], `(rev68) ${nombre}: tras «Enviar», el POST sale y el motivo es «orden»`);
      M.cerrarOrden();                                  // «Cancelar» sigue activo durante el envío
      igual([M.__ord(), M.motivoNoRecargar()], [null, 'orden'], `(rev68) ${nombre}: «Cancelar» con el POST en vuelo cierra el formulario, pero la recarga sigue frenada («orden»)`);
      M.recargarSiSePuede();
      igual([reg.reloads, !!recarga(), reg.franja.slice(-1)[0], reg.timers.filter(t => t.ms === 15000).length], [0, false, 'orden', 1],
        `(rev68) ${nombre}: la re-comprobación NO recarga: la franja dice que espera al bróker y vuelve a mirar en 15 s`);
      pend[`/${broker}/orden/place`].resolver({ status: 502, data: {} });   // el proxy contesta tarde y sin forma: indeterminada
      await envio;
      igual([reg.anotado, reg.alerts.length, M.motivoNoRecargar()], [['error'], 1, ''], `(rev68) ${nombre}: la respuesta llega y se anota («error» + «Verifica…»); entonces sí se puede recargar`);
      M.recargarSiSePuede(); recarga().f();
      igual(reg.reloads, 1, `(rev68) ${nombre}: y la Mesa se actualiza con la orden ya anotada`);
    }
    for (const [broker, fn] of [['etrade', 'cancelarOrden'], ['schwab', 'cancelarOrdenSchwab']]) {
      const { M, reg, pend, recarga } = armarEnvio({ modal: false });   // la lista de órdenes del Copiloto: sin cuadro
      const c = broker === 'etrade' ? M.cancelarOrden(7, '123', 'etrade') : M.cancelarOrdenSchwab(7, '123');
      await C.respirar(); await C.respirar();
      igual([reg.posts, M.motivoNoRecargar()], [[`/${broker}/orden/cancel`], 'orden'], `(rev68) ${fn} desde la lista del Copiloto (sin cuadro): con la cancelación en vuelo el motivo es «orden»`);
      M.recargarSiSePuede();
      assert(reg.reloads === 0 && !recarga(), `(rev68) ${fn}: la recarga espera a que el bróker conteste la cancelación`);
      pend[`/${broker}/orden/cancel`].resolver({ status: 200, data: {} });
      igual([await c, M.motivoNoRecargar()], [true, ''], `(rev68) ${fn}: contestada la cancelación, el freno se suelta`);
    }
    {
      const { M, reg, form } = armarEnvio({ falla: true });
      M.__set(form('etrade'));
      await M.ordenPlace();
      M.cerrarOrden();
      igual([reg.anotado, M.motivoNoRecargar()], [['error'], ''], '(rev68) un envío que revienta (proxy caído) suelta el freno al terminar (finally): no se queda bloqueada para siempre');
      const r2 = await M.cancelarOrden(7, '123', 'etrade');
      igual([r2, M.motivoNoRecargar()], [false, ''], '(rev68) …y una cancelación que revienta, también');
    }
  }

  // ════════════════ 4c. rev68 · la recarga ya decidida (700 ms) vuelve a mirar al dispararse ════════════════
  // El revisor de A1: un corte, una venta o la GTC automática que empiezan en el hueco de 700 ms se perdían (el corte en su
  // primera espera; la GTC quedaba marcada como abierta en localStorage y nunca se reintentaba).
  {
    const armarHueco = (ls) => {
      const reg = { reloads: 0, timers: [], franja: [], toasts: [], ordenesAbiertas: 0, sesion: {} };
      let modal = false;
      const cancel = C.diferido();
      const doc = { activeElement: null, querySelector: (s) => (s === '.modal' && modal) ? {} : null };
      const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 5, estado: 'abierta', broker: 'etrade', symbol: 'SPY', direccion: 'PUT', strike: 680, contratos: 2 } }) }) }) }) };
      const M = construir(['recargarSiSePuede', 'motivoNoRecargar', 'campoConTexto', 'recargaYaIntentada', 'anotarRecarga', 'pedirActualizarSW',
        'cortarPosicion', 'abrirGtcAutomatico', 'gtcAutoYaAbierto', 'gtcAutoMarcar'], {
        document: doc, sb, $: () => null, localStorage: ls, toast: (m) => reg.toasts.push(m), alert: () => {}, confirm: () => true, ruta: () => {},
        BROKER_NOMBRE: { etrade: 'E*TRADE' }, brokersOperables: () => ['etrade'],
        cancelarVentasVivas: async () => cancel.promesa, bidDeContrato: async () => 1.2, preSalida: () => ({ limitPrice: 1.5 }),
        abrirOrden: () => { modal = true; reg.ordenesAbiertas++; }, ordenPreview: async () => {}, ordenPlace: async () => {}, gtcAutoEnviaSola: () => ({ enviar: true }),
        location: { reload: () => reg.reloads++ },
        setTimeout: (f, ms) => { reg.timers.push({ f, ms }); return reg.timers.length; },
        sessionStorage: { getItem: (k) => reg.sesion[k] || null, setItem: (k, v) => { reg.sesion[k] = v; } },
        navigator: {}, franjaVersion: (m) => reg.franja.push(m),
      }, {
        consts: ['VERSION_ESPERA_MS', 'VERSION_RECARGA_K', 'VERSION_RECARGA_VENTANA_MS', 'GTC_AUTO_K'].concat(C.existeConst('_escriturasBroker') ? ['_escriturasBroker'] : []),
        prefijo: "let _ord = null; const _venta = { enCurso: false }; const _corte = { enCurso: false };\n" +
          "let _versionPendiente = 67; const _verEstado = { ultima: 0, timer: 0, atascada: 0, oculta: '' };",
        sufijo: 'function __corte() { return _corte; }', extras: ['__corte'],
      });
      const ultimo700 = () => reg.timers.filter(t => t.ms === 700).slice(-1)[0];
      return { M, reg, cancel, ultimo700, cerrarCuadro: () => { modal = false; } };
    };
    // (a) el corte que empieza en el hueco
    {
      const { M, reg, cancel, ultimo700 } = armarHueco(C.localStorageFalso());
      M.recargarSiSePuede();
      igual([reg.toasts[0], !!ultimo700()], ['Actualizando la Mesa a la versión 67…', true], '(rev68) vía libre: «Actualizando la Mesa a la versión 67…» y la recarga a 700 ms');
      M.recargarSiSePuede();
      igual([reg.timers.filter(t => t.ms === 700).length, reg.franja.length], [1, 0], '(rev68) otra pregunta dentro de esos 700 ms no programa otra recarga (ni la da por «atascada»)');
      const corte = M.cortarPosicion(5);
      await C.respirar(); await C.respirar();
      igual([M.__corte().enCurso, M.motivoNoRecargar()], [true, 'corte'], '(rev68) en el hueco Andrés toca «Cortar» y confirma: corte en curso');
      ultimo700().f();
      igual([reg.reloads, reg.franja.slice(-1)[0], reg.timers.filter(t => t.ms === 15000).length, reg.sesion.mz_recarga_version], [0, 'corte', 1, undefined],
        '(rev68) al dispararse, la recarga VUELVE A MIRAR: no sale con el corte en curso, la franja lo dice, se re-comprueba en 15 s y no se anota como intentada');
      cancel.resolver('abortado'); await corte;
      const dispara = (ms) => { const t = reg.timers.filter(x => x.ms === ms).slice(-1)[0]; if (t) t.f(); };
      dispara(15000);                                       // a los 15 s, el corte ya terminó
      dispara(700);
      assert(reg.reloads === 1 && JSON.parse(reg.sesion.mz_recarga_version || 'null').v === 67, '(rev68) terminado el corte, se actualiza (y entonces sí se anota la recarga)');
    }
    // (b) la GTC automática que se abre en el hueco: ni se recarga ni se pierde
    {
      const ls = C.localStorageFalso();
      const { M, reg, ultimo700, cerrarCuadro } = armarHueco(ls);
      const pos = { id: 41, broker: 'etrade', symbol: 'SPY', direccion: 'PUT', strike: 680, contratos: 2, prima_fill: 1.2, plan_pct: 10 };
      M.recargarSiSePuede();
      M.abrirGtcAutomatico([pos]);
      igual([reg.ordenesAbiertas, M.gtcAutoYaAbierto(41)], [1, true], '(rev68) en el hueco llega el fill y se abre la GTC automática (marcada en localStorage)');
      ultimo700().f();
      igual([reg.reloads, reg.franja.slice(-1)[0]], [0, 'cuadro'], '(rev68) la recarga no sale con su formulario abierto: el envío automático (900 ms) llega a salir');
      const envio = reg.timers.find(t => t.ms === 900);
      assert(!!envio, '(rev68) …y el envío automático de la GTC sigue programado');
      cerrarCuadro();
      const dispara = (ms) => { const t = reg.timers.filter(x => x.ms === ms).slice(-1)[0]; if (t) t.f(); };
      dispara(15000); dispara(700);
      igual(reg.reloads, 1, '(rev68) cerrado el cuadro (la GTC ya enviada), se actualiza');
    }
  }

  // ════════════════ 5. el cableado en el fuente ════════════════
  assert(/if \(document\.visibilityState === 'hidden'\) \{ _ocultaDesde = Date\.now\(\); return; \}\s*\n\s*buscarVersionNueva\(\);/.test(FUENTE), 'al volver a la app (visibilitychange → visible) se busca versión nueva ANTES de cualquier otra cosa');
  assert(/setTimeout\(buscarVersionNueva, 5000\)/.test(FUENTE), 'al arrancar se busca a los 5 s');
  assert(/window\._mzTimerVersion = setInterval\(\(\) => \{ if \(document\.visibilityState !== 'hidden'\) buscarVersionNueva\(\); \}, VERSION_CADA_MS\)/.test(FUENTE), '(v66) y cada VERSION_CADA_MS con la Mesa a la vista, con el timer colgado de window (una sola vez aunque arrancar corra dos veces)');
  igual(C.existeConst('VERSION_CADA_MS') && C.extraerConst('VERSION_CADA_MS'), 'const VERSION_CADA_MS = 5 * 60000;', '(v66) cada 5 min (antes 10)');
  assert(/if \(!window\._mzTimerVersion\)/.test(FUENTE), 'el timer no se duplica');
  assert(/window\.addEventListener\('focus', \(\) => \{ buscarVersionNueva\(\); \}\);/.test(FUENTE), '(v66) en focus (volver a la ventana de la computadora)');
  assert(/window\.addEventListener\('online', \(\) => \{ buscarVersionNueva\(\); \}\);/.test(FUENTE), '(v66) en online (vuelve la red)');
  assert(/window\.addEventListener\('pageshow', \(e\) => \{ if \(e && e\.persisted\) buscarVersionNueva\(\); \}\);/.test(FUENTE), '(v66) en pageshow desde el bfcache (persisted)');
  assert(/typeof _corte !== 'undefined' && _corte && _corte\.enCurso/.test(C.extraer('motivoNoRecargar')), 'motivoNoRecargar consulta _corte con typeof: no depende del orden de carga');
  assert(/register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)[\s\S]{0,120}reg\.update\(\)/.test(FUENTE), '(v66) el service worker se registra con updateViaCache none y, al arrancar, update()');
  // index.html y sw.js del repo, si están al lado del main.js que se prueba
  const raiz = path.join(path.dirname(process.argv[2]), '..');
  const index = path.join(raiz, 'index.html'), sw = path.join(raiz, 'sw.js');
  if (fs.existsSync(index)) {
    const html = fs.readFileSync(index, 'utf8');
    const vMain = /app\/main\.js\?v=(\d+)/.exec(html), vConf = /config\.js\?v=(\d+)/.exec(html);
    assert(vMain && vConf && vMain[1] === vConf[1], 'index.html carga config.js y app/main.js con el MISMO ?v= (' + (vMain && vMain[1]) + ')', (vMain && vMain[1]) + ' vs ' + (vConf && vConf[1]));
    const V = construir(['versionPublicada']);
    assert(V.versionPublicada(html) > 0, 'versionPublicada lee el index.html real del repo (v' + V.versionPublicada(html) + ')');
    const mod = C.cargarModuloEntero({ src: './app/main.js?v=' + vMain[1] });
    assert(mod.cargo, 'main.js entero carga en el DOM de juguete', mod.error);
    if (mod.cargo) {
      igual(mod.ev('VERSION_APP'), Number(vMain[1]), 'dentro del módulo REAL, VERSION_APP es el ?v= del script');
      igual([typeof mod.win.MZ.actualizarAhora, typeof mod.win.MZ.ocultarFranjaVersion], ['function', 'function'], '(v66) «Actualizar ahora» y ✕ cuelgan de window.MZ');
    }
    assert(/<div class="fecha"><span class="vercab oculto" id="verCab"><\/span><span id="fecha">—<\/span><\/div>/.test(html), '(v66) la marca de versión va junto a la fecha de la cabecera (oculta mientras no haya una pendiente); la fecha sigue en #fecha');
    const css = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    const zFranja = Number((/\.vernueva\{[^}]*z-index:(\d+)/.exec(css) || [])[1]), zModal = Number((/\.modal\{[^}]*z-index:(\d+)/.exec(css) || [])[1]), zToast = Number((/\.toast\{[^}]*z-index:(\d+)/.exec(css) || [])[1]);
    assert(zFranja > zModal && zFranja > zToast && zFranja > 60, '(v66) la franja va por encima de un cuadro abierto (z-index ' + zFranja + ' > .modal ' + zModal + ', los cuadros de 55/60 y el toast ' + zToast + ')');
    assert(/\.vernueva\{[^}]*max-width:calc\(100vw - 32px\)/.test(css) && /\.vernueva\{[^}]*top:calc\(env\(safe-area-inset-top\) \+ 64px\)/.test(css), '(v66) cabe a 375 px (16 px de margen a cada lado), respeta la muesca del iPhone y va DEBAJO de la cabecera (no tapa ⚙ ni la calculadora)');
  }
  if (fs.existsSync(sw)) {
    const swTxt = fs.readFileSync(sw, 'utf8');
    assert(/const VER = 'mesa2-v\d+'/.test(swTxt), 'sw.js lleva su propia versión de caché (mesa2-vN)');
    assert(!/app\/main\.js\?v=/.test(swTxt), 'el service worker no fija un ?v= de main.js en su lista de shell (index.html decide la versión)');
    // ════════════════ 6. sw.js EJECUTADO en un contexto de juguete (v55, app v66) ════════════════
    const vm = require('vm');
    const oyentes = {}, guardadas = [], pedidas = [];
    class RequestFalso {
      constructor(entrada, init) {
        const base = typeof entrada === 'string' ? { url: entrada, method: 'GET', mode: 'cors', cache: 'default' } : entrada;
        this.url = base.url; this.method = base.method || 'GET'; this.mode = base.mode === 'navigate' ? 'same-origin' : base.mode;
        this.cache = (init && init.cache) || base.cache || 'default'; this.redirect = base.redirect; this.copia = !!init;
      }
    }
    const ctx = { self: { addEventListener: (t, f) => { oyentes[t] = f; }, registration: { scope: 'https://avaldano2211.github.io/mesa-2/' }, clients: {} },
      location: { origin: 'https://avaldano2211.github.io' }, URL, Request: RequestFalso, Promise, console,
      fetch: (r) => { pedidas.push(r); return Promise.resolve({ ok: true, status: 200, clone() { return this; } }); },
      caches: { open: () => Promise.resolve({ put: (req) => { guardadas.push(req.url); }, addAll: () => Promise.resolve() }), match: () => Promise.resolve(null), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) } };
    vm.createContext(ctx);
    vm.runInContext(swTxt, ctx, { filename: 'sw.js' });
    igual(/const VER = '(mesa2-v\d+)'/.exec(swTxt)[1], 'mesa2-v58', '(v69) sw.js VER mesa2-v58 (la caché vieja se borra al activarse)');
    const pedir = async (req) => { let resp = null; pedidas.length = 0; oyentes.fetch({ request: req, respondWith: (p) => { resp = p; } }); if (resp) await resp; await C.respirar(); return resp; };
    const B = 'https://avaldano2211.github.io/mesa-2/';
    guardadas.length = 0;
    await pedir({ url: B, method: 'GET', mode: 'navigate', cache: 'default', redirect: 'manual' });
    assert(pedidas.length === 1 && pedidas[0].cache === 'no-cache' && pedidas[0].copia, '(v66) una NAVEGACIÓN (recarga, abrir la PWA) va a la red con cache no-cache: la caché HTTP no puede devolver el index.html viejo', JSON.stringify(pedidas[0]));
    igual(pedidas[0].redirect, 'manual', '(v66) conservando el modo de redirección de la navegación');
    igual(guardadas, [B], '(v66) y se guarda para abrir sin red');
    guardadas.length = 0;
    await pedir({ url: B + 'index.html', method: 'GET', mode: 'cors', cache: 'default' });
    igual([pedidas[0].cache, guardadas.length], ['no-cache', 1], '(v66) index.html pedido como recurso también con no-cache');
    guardadas.length = 0;
    const nv = { url: B + 'index.html?nv=1730000000000', method: 'GET', mode: 'cors', cache: 'no-store' };
    await pedir(nv);
    assert(pedidas[0] === nv && guardadas.length === 0, '(v66) la pregunta de versión (index.html?nv=…, no-store) va tal cual y NO se guarda en la caché (antes dejaba una copia por pregunta)');
    guardadas.length = 0;
    const js = { url: B + 'app/main.js?v=66', method: 'GET', mode: 'no-cors', cache: 'default' };
    await pedir(js);
    assert(pedidas[0].cache === 'no-cache' && pedidas[0].url === js.url && guardadas[0] === js.url, '(v66) main.js?v=66 también se revalida (no-cache: un arreglo publicado con el mismo número no se queda en la caché HTTP) y se guarda para abrir sin red');
    guardadas.length = 0;
    await pedir({ url: B + 'config.js?v=66', method: 'GET', mode: 'no-cors', cache: 'default' });
    igual([pedidas[0].cache, guardadas.length], ['no-cache', 1], '(v66) config.js?v=66 igual');
    guardadas.length = 0;
    const ico = { url: B + 'icon-192.png', method: 'GET', mode: 'no-cors', cache: 'default' };
    await pedir(ico);
    assert(pedidas[0] === ico, '(v66) lo demás del shell (iconos, vendor) va como siempre');
    const r0 = await pedir({ url: 'https://pcslhnnaohsdouddlfyv.supabase.co/rest/v1/senales', method: 'GET', mode: 'cors', cache: 'default' });
    igual([r0, pedidas.length], [null, 0], 'Supabase NUNCA pasa por el service worker (ni caché ni respondWith): la regla de siempre');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
