#!/usr/bin/env node
/* Pruebas de la actualización sola de la PWA (v47+): VERSION_APP desde el ?v= del
   script, versionPublicada, buscarVersionNueva (no-store, solo una versión MAYOR)
   y recargarSiSePuede (espera mientras haya un cuadro abierto o un corte en curso).
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

// ════════════════ 3. buscarVersionNueva: no-store, una sola vez a la vez, SOLO mayor ════════════════
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
  }, { prefijo: 'let _buscandoVersion = false, _versionPendiente = 0;', sufijo: 'function __pendiente() { return _versionPendiente; } function __buscando() { return _buscandoVersion; }', extras: ['__pendiente', '__buscando'] });
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
  }
  { const { M, reg } = armarBusqueda({ html: '<script src="./app/main.js?v=51">' }); await M.buscarVersionNueva(); igual([reg.recargas.length, M.__pendiente()], [0, 0], 'la misma versión: nada que hacer'); }
  { const { M, reg } = armarBusqueda({ html: '<script src="./app/main.js?v=50">' }); await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'una publicada MENOR (rollback o caché rara) no recarga: solo mayor'); }
  { const { M, reg } = armarBusqueda({ html: '<html>sin scripts</html>' }); await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'un index.html sin main.js (0) no recarga'); }
  { const { M, reg } = armarBusqueda({ ok: false }); await M.buscarVersionNueva(); igual(reg.recargas.length, 0, 'una respuesta no ok (404/500 de Pages) no recarga'); igual(M.__buscando(), false, 'y suelta la bandera'); }
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

  // ════════════════ 4. recargarSiSePuede: jamás a mitad de una orden o de un corte ════════════════
  function armarRecarga(E) {
    E = Object.assign({ pendiente: 52, modal: null, corte: false }, E || {});
    const reg = { toasts: [], timers: [], reloads: 0 };
    const M = construir(['recargarSiSePuede'], {
      document: { querySelector: (s) => (s === '.modal' ? E.modal : null) },
      _corte: { enCurso: E.corte }, toast: (t) => reg.toasts.push(t),
      setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return 0; },
      location: { reload: () => reg.reloads++ },
    }, { prefijo: 'let _buscandoVersion = false, _versionPendiente = ' + E.pendiente + ';' });
    return { M, reg, E };
  }
  { const { M, reg } = armarRecarga({ pendiente: 0 }); M.recargarSiSePuede(); igual([reg.timers.length, reg.toasts.length, reg.reloads], [0, 0, 0], 'sin versión pendiente no hace nada'); }
  {
    const { M, reg } = armarRecarga({ modal: {} });
    M.recargarSiSePuede();
    igual([reg.toasts.length, reg.reloads, reg.timers.length, reg.timers[0].ms], [0, 0, 1, 15000], 'con un cuadro abierto (.modal: una orden, un fill, el PIN) espera 15 s');
    assert(reg.timers[0].fn === M.recargarSiSePuede, 'y lo que reprograma es la propia comprobación (vuelve a mirar si sigue el cuadro)');
  }
  { const { M, reg } = armarRecarga({ corte: true }); M.recargarSiSePuede(); igual([reg.reloads, reg.timers.length, reg.timers[0].ms], [0, 1, 15000], 'con un corte en curso también espera: la recarga mataría la espera de la cancelación'); }
  {
    const { M, reg } = armarRecarga();
    M.recargarSiSePuede();
    igual(reg.toasts, ['Actualizando la Mesa a la versión 52…'], 'libre: avisa con la versión que viene');
    igual([reg.reloads, reg.timers.length, reg.timers[0].ms], [0, 1, 700], 'y recarga a los 700 ms (que se lea el toast)');
    reg.timers[0].fn();
    igual(reg.reloads, 1, 'la recarga es location.reload()');
  }

  // ════════════════ 5. el cableado en el fuente ════════════════
  assert(/if \(document\.visibilityState === 'hidden'\) \{ _ocultaDesde = Date\.now\(\); return; \}\s*\n\s*buscarVersionNueva\(\);/.test(FUENTE), 'al volver a la app (visibilitychange → visible) se busca versión nueva ANTES de cualquier otra cosa');
  assert(/setTimeout\(buscarVersionNueva, 5000\)/.test(FUENTE), 'al arrancar se busca a los 5 s');
  assert(/window\._mzTimerVersion = setInterval\(buscarVersionNueva, 10 \* 60000\)/.test(FUENTE), 'y cada 10 min, con el timer colgado de window (una sola vez aunque arrancar corra dos veces)');
  assert(/if \(!window\._mzTimerVersion\)/.test(FUENTE), 'el timer de 10 min no se duplica');
  assert(/typeof _corte !== 'undefined' && _corte\.enCurso/.test(C.extraer('recargarSiSePuede')), 'recargarSiSePuede consulta _corte con typeof: no depende del orden de carga');
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
    if (mod.cargo) igual(mod.ev('VERSION_APP'), Number(vMain[1]), 'dentro del módulo REAL, VERSION_APP es el ?v= del script');
  }
  if (fs.existsSync(sw)) {
    const swTxt = fs.readFileSync(sw, 'utf8');
    assert(/const VER = 'mesa2-v\d+'/.test(swTxt), 'sw.js lleva su propia versión de caché (mesa2-vN)');
    assert(!/app\/main\.js\?v=/.test(swTxt), 'el service worker no fija un ?v= de main.js en su lista de shell (index.html decide la versión)');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
