#!/usr/bin/env node
/* Pruebas de la v65 · «El Diario al día en un par de minutos». Diagnóstico 2026-10-14 (7 días de datos reales): los fills
   de E*TRADE llegaban al libro con una mediana de 503 min y un p90 de 55 h porque SOLO se escribían al abrir el Diario; el
   Diario bajaba el libro ENTERO (~650 KB) en cada refresco; `fills` no estaba en Realtime; y el login decía «Sin conexión»
   al primer fallo de red.
     C1 · sincronización de E*TRADE/Schwab en segundo plano desde CUALQUIER pestaña (2 min en sesión regular, 15 fuera;
          con la app visible y la sesión del bróker válida en este equipo) y el tope de syncTtlAhora (2 / 10 min).
     C2 · Realtime de `fills` en su PROPIO canal 'mesa2-fills' (INSERT y UPDATE, nunca '*'): fusión en la caché por id y
          repintado con debounce de 1,5 s de la vista abierta (Diario o Cuentas) con sus guardas.
     C3 · lectura INCREMENTAL del libro (id > el mayor de la caché), completa cada 15 min o con forzar, y el MISMO orden
          que una lectura completa (ejecutado_at asc, id asc).
     C4 · login: 2 reintentos (1 s y 3 s) solo si falla la RED; una respuesta del servidor (400/401) no se reintenta.
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_libro_vivo.js mesa-2-app/app/main.js */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_libro_vivo.js');
const { FUENTE, assert, igual, construir, extraer, nodo, respirar, diferido, haceCuanto, sbFalso, localStorageFalso } = C;

const ahoraIso = () => new Date().toISOString();
const hbDe = (sesion, minAtras) => ({ sesion, latido_at: new Date(Date.now() - (minAtras || 0) * 60000).toISOString() });
const ids = (filas) => (filas || []).map(f => f.id);

// Un libro CANÓNICO: instantes no decrecientes (saltos de 0 —empate—, 1 µs, 7 µs, 0,5 ms, 1 ms, 1 s y 61 s) escritos en
// los formatos de PostgREST (fracción recortada, fracción de 6 dígitos, «Z» con milisegundos) y, dentro de cada empate,
// ids crecientes. Por CONSTRUCCIÓN ese es el orden de la base (order by ejecutado_at, id): la prueba no reimplementa la
// ordenación. Los ids se reparten al azar entre las posiciones: un id nuevo puede ser un fill VIEJO (una sincronización
// de E*TRADE que trae ejecuciones de hace dos días), que es justo lo que la fusión tiene que intercalar bien.
function libroCanonico(n, semilla) {
  let x = semilla >>> 0 || 1;
  const rnd = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x / 4294967296; };
  const SALTOS = [0, 0, 1, 7, 500, 1000, 1000000, 61000000];
  const fmt = (us, estilo) => {
    const ms = Math.floor(us / 1000), fr = (ms % 1000) * 1000 + (us % 1000);
    const base = new Date(ms).toISOString().slice(0, 19), f6 = String(fr).padStart(6, '0');
    if (estilo === 2 && us % 1000 === 0) return base + '.' + f6.slice(0, 3) + 'Z';
    if (estilo === 1) return base + '.' + f6 + '+00:00';
    return fr ? base + '.' + f6.replace(/0+$/, '') + '+00:00' : base + '+00:00';
  };
  let us = Date.UTC(2026, 9, 9, 13, 30, 0) * 1000;
  const pos = [];   // { us, grupo }
  let grupo = 0;
  for (let i = 0; i < n; i++) {
    const s = i ? SALTOS[Math.floor(rnd() * SALTOS.length)] : 0;
    if (i && s) grupo++;
    us += s;
    pos.push({ us, grupo });
  }
  const perm = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  // en cada empate los ids van crecientes (eso dice la base: id asc desempata)
  const porGrupo = {};
  pos.forEach((p, i) => { (porGrupo[p.grupo] = porGrupo[p.grupo] || []).push(i); });
  Object.values(porGrupo).forEach(is => { const v = is.map(i => perm[i]).sort((a, b) => a - b); is.forEach((i, k) => { perm[i] = v[k]; }); });
  return pos.map((p, i) => ({ id: perm[i], user_id: 'u', broker: ['etrade', 'schwab', 'tasty', 'moomoo'][perm[i] % 4], clave_ext: 'k' + perm[i],
    symbol: 'SPY', direccion: 'CALL', strike: 600, expiracion: '2026-10-16', lado: perm[i] % 2 ? 'compra' : 'venta', contratos: 1, precio: 1.5,
    ejecutado_at: fmt(p.us, Math.floor(rnd() * 3)), fecha_ny: '2026-10-09', crudo: { n: perm[i] }, spot: null }));
}

// Una base de juguete para `fills`: SOLO filtra (gt), elige el orden pedido (por id, o el canónico en que ya vienen las
// filas) y pagina con range. Cada petición queda anotada (lo que pidió y cuántas filas bajó).
function baseFalsa(canon) {
  const st = { filas: canon.slice(), pedidas: [], error: null, espera: null };
  const sb = sbFalso((tabla, cadena) => {
    if (tabla !== 'fills') return { data: [], error: null };
    const responder = () => {
      if (st.error) { st.pedidas.push({ error: true }); return { data: null, error: st.error }; }
      const gt = cadena.find(c => c[0] === 'gt'), rg = cadena.find(c => c[0] === 'range');
      const ords = cadena.filter(c => c[0] === 'order').map(c => c[1][0] + (c[1][1] && c[1][1].ascending === false ? ' desc' : ''));
      let d = st.filas.filter(f => !gt || Number(f.id) > Number(gt[1][1]));
      if (ords.join() === 'id') d = d.slice().sort((a, b) => a.id - b.id);
      else if (ords.join() !== 'ejecutado_at,id') throw new Error('orden inesperado: ' + ords.join());
      if (rg) d = d.slice(rg[1][0], rg[1][1] + 1);
      st.pedidas.push({ gt: gt ? gt[1] : null, ords: ords.join(), range: rg ? rg[1] : null, n: d.length });
      return { data: JSON.parse(JSON.stringify(d)), error: null };
    };
    if (st.espera) { const e = st.espera; st.espera = null; return e.promesa.then(responder); }
    return responder();
  });
  return { sb, st };
}
const LIBRO_FN = ['leerFillsTodos', 'libroInvalidar', 'libroParaUnir', 'fusionarLibro', 'ordenarLibro', 'instanteLibro', 'maxIdLibro',
  'textoErrorFills', 'textoErrorTabla', 'libroFillRT', 'libroFillNuevo', 'libroFillCambiado', 'filaLibroRT'];
function armarLibro(canon, op) {
  op = op || {};
  const { sb, st } = baseFalsa(canon);
  const reg = { repintar: 0 };
  const M = construir(LIBRO_FN, { sb, sesionActiva: op.sesion === undefined ? { user: { id: 'u' } } : op.sesion, libroRepintarPronto: () => { reg.repintar++; } },
    { consts: ['_libro', 'LIBRO_TTL_MS', 'LIBRO_COMPLETA_MS', 'LIBRO_RT_MAX'] });
  return { M, st, reg };
}

(async () => {
  // ════════════════ 1. C1 · las funciones PURAS del ritmo: tope (TTL) y cadencia ════════════════
  {
    const T = construir(['ttlSyncLibro', 'cadenciaSyncLibro', 'syncTtlAhora', 'sesionNY'], { haceCuanto },
      { consts: ['ET_SYNC_TTL', 'ET_SYNC_TTL_SESION', 'LIBRO_SYNC_SESION_MS', 'LIBRO_SYNC_FUERA_MS', 'LIBRO_SYNC_TIC_MS'],
        prefijo: 'let _hbUltimo = null;', sufijo: 'function __hb(h) { _hbUltimo = h; }', extras: ['__hb'] });
    igual([T.ET_SYNC_TTL, T.ET_SYNC_TTL_SESION, T.LIBRO_SYNC_SESION_MS, T.LIBRO_SYNC_FUERA_MS], [600000, 120000, 120000, 900000], 'constantes: ET_SYNC_TTL sigue en 10 min (el tope FUERA), 2 min en sesión; el timer cada 2 min en sesión y cada 15 fuera');
    assert(T.LIBRO_SYNC_TIC_MS > 0 && T.LIBRO_SYNC_TIC_MS <= 15000, 'el tic que mira si toca es corto (≤ 15 s): el paso a la sesión regular se nota enseguida (' + T.LIBRO_SYNC_TIC_MS + ' ms)');
    igual([T.ttlSyncLibro('regular'), T.ttlSyncLibro('extendida'), T.ttlSyncLibro('cerrado'), T.ttlSyncLibro(undefined), T.ttlSyncLibro(null)], [120000, 600000, 600000, 600000, 600000], 'ttlSyncLibro: 2 min en la sesión regular; pre/post, cerrado o sin dato → 10 min');
    igual([T.cadenciaSyncLibro('regular'), T.cadenciaSyncLibro('extendida'), T.cadenciaSyncLibro('cerrado'), T.cadenciaSyncLibro(undefined)], [120000, 900000, 900000, 900000], 'cadenciaSyncLibro: 2 min en la sesión regular, 15 fuera (pre/post incluidos)');
    T.__hb(hbDe('regular')); igual(T.syncTtlAhora(), 120000, 'syncTtlAhora con el latido fresco en «regular» → 2 min');
    T.__hb(hbDe('post')); igual(T.syncTtlAhora(), 600000, 'con el latido en «post» (extendida) → 10 min');
    T.__hb(hbDe('cerrado')); igual(T.syncTtlAhora(), 600000, 'con el mercado cerrado → 10 min');
    T.__hb(null); igual(T.syncTtlAhora(), T.sesionNY(null) === 'regular' ? 120000 : 600000, 'sin latido decide el reloj de NY (el mismo criterio que sesionNY)');
    const T2 = construir(['syncTtlAhora'], {}, { consts: ['ET_SYNC_TTL'] });
    igual(T2.syncTtlAhora(), 600000, 'si algo falla al decidir (sin sesionNY ni latido) el tope es el prudente: 10 min');
  }

  // ════════════════ 2. C1 · las sincronizaciones REALES aplican el tope de AHORA ════════════════
  {
    function armarSync(E) {
      const reg = { lecturas: 0 };
      const alm = {};
      if (E.cacheMs != null) { const c = JSON.stringify({ ts: Date.now() - E.cacheMs, resumen: { estado: 'ok', txs: 4, ops: 2, rts: 1, fills: 0, ts: Date.now() - E.cacheMs } }); alm.mz_et_sync2 = c; alm.mz_sw_sync = c; }
      const M = construir(['etradeSincronizarImpl', 'schwabSincronizarImpl', 'syncTtlAhora', 'ttlSyncLibro', 'sesionNY'], {
        haceCuanto, localStorage: localStorageFalso(alm), ET_K: { sync: 'mz_et_sync2' }, SW_K_SYNC: 'mz_sw_sync',
        etCreds: () => ({ token: 't', token_secret: 's' }), etDiaVencido: () => false, swCreds: () => ({ token: 't' }), swVencido: () => false,
        sesionActiva: { user: { id: 'u' } }, etProxy: () => Promise.resolve({}),
        etRead: async () => { reg.lecturas++; return { status: 401, data: null }; }, etError: () => null,
        swCuenta: async () => { reg.lecturas++; throw new Error('Schwab: sesión caducó'); },
      }, { consts: ['ET_SYNC_TTL', 'ET_SYNC_TTL_SESION'], prefijo: 'let _hbUltimo = ' + JSON.stringify(E.hb) + ';' });
      return { M, reg };
    }
    for (const b of ['etrade', 'schwab']) {
      const fn = b === 'etrade' ? 'etradeSincronizarImpl' : 'schwabSincronizarImpl';
      let A = armarSync({ hb: hbDe('regular'), cacheMs: 3 * 60000 });
      let r = await A.M[fn]();
      igual([A.reg.lecturas, r.estado], [1, 'expirado'], b + ': en sesión regular, con la última sincronización de hace 3 min, SÍ se pregunta al bróker (tope 2 min)');
      A = armarSync({ hb: hbDe('regular'), cacheMs: 90000 });
      r = await A.M[fn]();
      igual([A.reg.lecturas, r.estado, r.cambio], [0, 'ok', false], b + ': en sesión, con la de hace 90 s, se devuelve la guardada (cambio: false)');
      A = armarSync({ hb: hbDe('cerrado'), cacheMs: 3 * 60000 });
      r = await A.M[fn]();
      igual([A.reg.lecturas, r.estado, r.cambio], [0, 'ok', false], b + ': fuera de sesión, la de hace 3 min vale (tope 10 min, como antes)');
      A = armarSync({ hb: hbDe('post'), cacheMs: 11 * 60000 });
      await A.M[fn]();
      igual(A.reg.lecturas, 1, b + ': fuera de sesión, pasados 10 min, se vuelve a preguntar');
      A = armarSync({ hb: hbDe('regular'), cacheMs: 30000 });
      await A.M[fn](true);
      igual(A.reg.lecturas, 1, b + ': forzar («sincronizar») salta el tope como siempre');
    }
  }

  // ════════════════ 3. C1 · el timer de segundo plano (syncBrokersFondo) ════════════════
  function armarFondo(E) {
    E = Object.assign({ ses: 'regular', visible: 'visible', sesion: { user: { id: 'u' } }, et: true, etVenc: false, sw: false, swVenc: false, alm: {}, hash: '#/tickers' }, E || {});
    const reg = { et: 0, sw: 0, inval: [], repintar: 0, resEt: E.resEt || { estado: 'ok', cambio: false }, resSw: E.resSw || { estado: 'ok', cambio: false } };
    const ls = E.lsRoto ? { getItem() { throw new Error('almacenamiento bloqueado'); }, setItem() { throw new Error('x'); }, removeItem() {} } : localStorageFalso(E.alm);
    const M = construir(['syncBrokersFondo', 'cadenciaSyncLibro', 'ultimaSyncBroker', 'syncFondoResultado'], {
      sesionActiva: E.sesion, document: { visibilityState: E.visible }, location: { hash: E.hash }, sesionNY: () => E.ses, _hbUltimo: null,
      etCreds: () => (E.et ? { token: 't', token_secret: 's' } : null), etDiaVencido: () => E.etVenc,
      swCreds: () => (E.sw ? { token: 't' } : null), swVencido: () => E.swVenc,
      ET_K: { sync: 'mz_et_sync2' }, SW_K_SYNC: 'mz_sw_sync', localStorage: ls,
      etradeSincronizar: () => { reg.et++; return E.etLanza ? Promise.reject(new Error('sin red')) : Promise.resolve(reg.resEt); },
      schwabSincronizar: () => { reg.sw++; return Promise.resolve(reg.resSw); },
      libroInvalidar: (c) => { reg.inval.push(c); }, libroRepintarPronto: () => { reg.repintar++; },
    }, { consts: ['_syncFondo', 'LIBRO_SYNC_SESION_MS', 'LIBRO_SYNC_FUERA_MS'] });
    return { M, reg, E };
  }
  const guardada = (msAtras, estado) => JSON.stringify({ ts: Date.now() - msAtras, resumen: { estado: estado || 'ok' } });
  {
    let F = armarFondo({ alm: { mz_et_sync2: guardada(121000) } });
    igual(F.M.syncBrokersFondo(), ['etrade'], 'en sesión regular, a los 2 min de la última sincronización: lanza E*TRADE');
    await respirar();
    igual(F.reg.et, 1, 'y llama a etradeSincronizar() (sin forzar: su tope sigue mandando)');
    F = armarFondo({ alm: { mz_et_sync2: guardada(100000) } });
    igual([F.M.syncBrokersFondo(), F.reg.et], [[], 0], 'en sesión, a los 100 s: todavía no toca');
    F = armarFondo({ ses: 'cerrado', alm: { mz_et_sync2: guardada(14 * 60000) } });
    igual(F.M.syncBrokersFondo(), [], 'fuera de sesión, a los 14 min: no toca (cadencia de 15)');
    F = armarFondo({ ses: 'cerrado', alm: { mz_et_sync2: guardada(15 * 60000 + 1000) } });
    igual(F.M.syncBrokersFondo(), ['etrade'], 'fuera de sesión, pasados 15 min: lanza');
    F = armarFondo({ ses: 'extendida', alm: { mz_et_sync2: guardada(5 * 60000) } });
    igual(F.M.syncBrokersFondo(), [], 'pre/post (extendida) cuenta como fuera: a los 5 min no toca');
    F = armarFondo({ alm: {} });
    igual(F.M.syncBrokersFondo(), ['etrade'], 'sin ninguna sincronización guardada: lanza ya');
    // en CUALQUIER pestaña: el timer no mira la pestaña
    const tabs = ['#/informe', '#/tickers', '#/copiloto', '#/cuentas', '#/disciplina', ''];
    igual(tabs.map(h => armarFondo({ hash: h, alm: { mz_et_sync2: guardada(130000) } }).M.syncBrokersFondo().join()), tabs.map(() => 'etrade'), 'lanza igual en Informe, Tickers, Copiloto, Cuentas, Disciplina y sin pestaña: no depende del Diario');
    // la app OCULTA no corre; sin sesión de la Mesa tampoco
    F = armarFondo({ visible: 'hidden', alm: { mz_et_sync2: guardada(30 * 60000) } });
    igual([F.M.syncBrokersFondo(), F.M.syncBrokersFondo(true), F.reg.et], [[], [], 0], 'con la app oculta (en el fondo) no lanza nada, ni siquiera con «ya»');
    F = armarFondo({ sesion: null });
    igual([F.M.syncBrokersFondo(true), F.reg.et], [[], 0], 'sin sesión de la Mesa no lanza nada');
    // con y sin sesión del bróker en ESTE equipo
    F = armarFondo({ et: false });
    igual([F.M.syncBrokersFondo(true), F.reg.et, F.reg.sw], [[], 0, 0], 'sin login de E*TRADE ni de Schwab en este equipo: nada (el servidor no tiene los tokens: opción B)');
    F = armarFondo({ etVenc: true });
    igual([F.M.syncBrokersFondo(true), F.reg.et], [[], 0], 'E*TRADE con el día vencido (murió a medianoche ET): no se molesta al proxy');
    F = armarFondo({ et: false, sw: true });
    igual(F.M.syncBrokersFondo(true), ['schwab'], 'con Schwab válida: lanza Schwab');
    await respirar();
    igual([F.reg.sw, F.reg.et], [1, 0], 'y llama a schwabSincronizar()');
    F = armarFondo({ et: false, sw: true, swVenc: true });
    igual(F.M.syncBrokersFondo(true), [], 'Schwab con el login semanal caducado: nada');
    F = armarFondo({ sw: true, alm: { mz_et_sync2: guardada(130000), mz_sw_sync: guardada(60000) } });
    igual(F.M.syncBrokersFondo(), ['etrade'], 'cada bróker con su reloj: E*TRADE toca (130 s), Schwab no (60 s)');
    // «ya» (al arrancar / al volver del fondo): sin esperar a la cadencia
    F = armarFondo({ alm: { mz_et_sync2: guardada(10000) } });
    igual(F.M.syncBrokersFondo(true), ['etrade'], 'con «ya» (arranque o vuelta del fondo) lanza aunque la última fue hace 10 s: el tope de la sincronización decide si pregunta');
    // no martillea: sesión del bróker muerta a media jornada (401 guardado como «expirado») → cadencia de fuera
    F = armarFondo({ alm: { mz_et_sync2: guardada(3 * 60000, 'expirado') } });
    igual(F.M.syncBrokersFondo(), [], 'con el último resultado «expirado» (401) no insiste cada 2 min en sesión');
    F = armarFondo({ alm: { mz_et_sync2: guardada(16 * 60000, 'expirado') } });
    igual(F.M.syncBrokersFondo(), ['etrade'], '…y lo vuelve a intentar a los 15 min');
    // no martillea aunque el almacenamiento local falle (modo privado): el timer recuerda cuándo lanzó
    F = armarFondo({ lsRoto: true });
    igual(F.M.syncBrokersFondo(), ['etrade'], 'con el almacenamiento roto lanza la primera vez…');
    igual([F.M.syncBrokersFondo(), F.M.syncBrokersFondo()], [[], []], '…y no relanza en los tics siguientes (lanzado[b])');
    F.M._syncFondo.lanzado.etrade = Date.now() - 121000;
    igual(F.M.syncBrokersFondo(), ['etrade'], '…hasta que pasa su cadencia');
    // el resultado: con cambio, invalida la caché y repinta (debounce); sin cambio, nada; un fallo no rompe nada
    F = armarFondo({ resEt: { estado: 'ok', cambio: true, fills: 3 } });
    F.M.syncBrokersFondo(true); await respirar(); await respirar();
    igual([F.reg.inval.length, F.reg.repintar], [1, 1], 'sincronización con cambio (entraron fills o round-trips): libroInvalidar + repintado de la vista abierta');
    F = armarFondo({ resEt: { estado: 'ok', cambio: false, fills: 12 } });
    F.M.syncBrokersFondo(true); await respirar(); await respirar();
    igual([F.reg.inval.length, F.reg.repintar], [0, 0], 'sin cambio (aunque el resumen guardado diga fills: 12): ni invalida ni repinta');
    F = armarFondo({ etLanza: true });
    let reviento = null;
    try { F.M.syncBrokersFondo(true); await respirar(); await respirar(); } catch (e) { reviento = e; }
    igual([reviento, F.reg.repintar], [null, 0], 'una sincronización que revienta (sin red) no rompe el timer ni repinta');
    igual([F.M.syncFondoResultado(null), F.M.syncFondoResultado({ estado: 'error' })], [false, false], 'syncFondoResultado sin resultado o con error: nada');
  }

  // ════════════════ 4. C1/C2 · el repintado: SOLO la vista abierta que usa el libro, con sus guardas y debounce ════════════════
  function armarRepinta(E) {
    E = Object.assign({ hash: '#/cuentas', vista: 'diario', modal: false, foco: null, sesion: { user: { id: 'u' } } }, E || {});
    const reg = { diario: 0, cuentas: 0, timers: [], limpiados: [] };
    const vista = { contains: (n) => !!n && n === E.foco };
    const doc = { activeElement: E.foco, querySelector: (s) => (s === '.modal' ? (E.modal ? {} : null) : s === '#vista' ? vista : null) };
    const M = construir(['repintarVistaLibro', 'vistaLibroAbierta', 'libroRepintarPronto', 'diarioEnUso'], {
      sesionActiva: E.sesion, location: { hash: E.hash }, document: doc, $: doc.querySelector,
      vistaDiario: async () => { reg.diario++; }, vistaCuentas: async () => { reg.cuentas++; },
      setTimeout: (fn, ms) => { reg.timers.push({ fn, ms }); return reg.timers.length; }, clearTimeout: (id) => { reg.limpiados.push(id); },
    }, { consts: ['_libro', 'LIBRO_REPINTAR_MS'], prefijo: 'let _cuentasVista = ' + JSON.stringify(E.vista) + ';' });
    return { M, reg };
  }
  {
    let R = armarRepinta();
    igual(R.M.vistaLibroAbierta(), 'diario', 'vistaLibroAbierta: Cuentas → Diario');
    assert(R.M.repintarVistaLibro() === true, 'con el Diario a la vista repinta…'); await respirar();
    igual([R.reg.diario, R.reg.cuentas], [1, 0], '…el Diario (y solo el Diario)');
    R = armarRepinta({ vista: 'cuentas' });
    R.M.repintarVistaLibro(); await respirar();
    igual([R.reg.diario, R.reg.cuentas, R.M.vistaLibroAbierta()], [0, 1, 'cuentas'], 'con la vista Cuentas a la vista repinta Cuentas');
    for (const h of ['#/informe', '#/tickers', '#/copiloto', '#/disciplina', '']) {
      R = armarRepinta({ hash: h });
      assert(R.M.repintarVistaLibro() === false && R.M.vistaLibroAbierta() === null, 'en ' + (h || 'la pestaña por defecto (Informe)') + ' no repinta nada (esa vista no usa el libro a la vista)');
    }
    R = armarRepinta({ modal: true }); R.M.repintarVistaLibro(); await respirar();
    igual(R.reg.diario, 0, 'con un cuadro abierto (.modal: orden, PIN, fill a mano) no se repinta debajo');
    const ta = { tagName: 'TEXTAREA', id: 'nTexto' };
    R = armarRepinta({ foco: ta }); R.M.repintarVistaLibro(); await respirar();
    igual(R.reg.diario, 0, 'con la nota del Diario enfocada (diarioEnUso) no se le pisa lo que escribe');
    R = armarRepinta({ vista: 'cuentas', foco: { tagName: 'INPUT' } }); R.M.repintarVistaLibro(); await respirar();
    igual(R.reg.cuentas, 0, 'en Cuentas, un campo de #vista con el foco también frena el repintado');
    R = armarRepinta({ vista: 'cuentas', foco: { tagName: 'BUTTON' } }); R.M.repintarVistaLibro(); await respirar();
    igual(R.reg.cuentas, 1, 'con el foco en un botón (o fuera de la vista) sí repinta');
    R = armarRepinta({ sesion: null });
    igual(R.M.repintarVistaLibro(), false, 'sin sesión no repinta');
    // debounce de 1,5 s
    R = armarRepinta();
    R.M.libroRepintarPronto(); R.M.libroRepintarPronto(); R.M.libroRepintarPronto();
    igual([R.reg.timers.length, R.reg.timers.map(t => t.ms), R.reg.limpiados], [3, [1500, 1500, 1500], [1, 2]], 'libroRepintarPronto: cada evento reprograma a 1,5 s y anula el anterior (debounce)');
    R.reg.timers[2].fn(); await respirar();
    igual(R.reg.diario, 1, 'al cumplirse, UN solo repintado por la ráfaga');
    igual(R.M._libro.repTimer, null, 'y el temporizador queda libre');
  }

  // ════════════════ 5. C3 · las funciones PURAS del libro: instante, orden, fusión ════════════════
  {
    const P = construir(['instanteLibro', 'ordenarLibro', 'maxIdLibro', 'fusionarLibro', 'filaLibroRT']);
    const base = Date.UTC(2026, 9, 9, 13, 32, 15) * 1000;
    igual([P.instanteLibro('2026-10-09T13:32:15+00:00'), P.instanteLibro('2026-10-09T13:32:15.123456+00:00'), P.instanteLibro('2026-10-09T13:32:15.5+00:00'), P.instanteLibro('2026-10-09T13:32:15.500Z')],
      [base, base + 123456, base + 500000, base + 500000], 'instanteLibro: microsegundos (fracción recortada, de 6 dígitos o en milisegundos con Z)');
    igual([P.instanteLibro('2026-10-09 13:32:15+00'), P.instanteLibro('2026-10-09T09:32:15-04:00'), P.instanteLibro('2026-10-09T15:02:15+01:30')], [base, base, base], 'el mismo instante con espacio y zona corta, o con otra zona horaria');
    igual([P.instanteLibro(null), P.instanteLibro(''), P.instanteLibro('basura')], [null, null, null], 'sin instante o ilegible → null');
    // dos fills en el MISMO milisegundo: manda el microsegundo (Date.parse los empataría y desempataría por id)
    const A = { id: 3, ejecutado_at: '2026-10-09T13:32:15.123456+00:00' }, B = { id: 9, ejecutado_at: '2026-10-09T13:32:15.123401+00:00' };
    igual(ids(P.ordenarLibro([A, B])), [9, 3], 'ordenarLibro: en el mismo milisegundo, el microsegundo antes que el id (como la base)');
    const E1 = { id: 5, ejecutado_at: '2026-10-09T13:32:15.5+00:00' }, E2 = { id: 2, ejecutado_at: '2026-10-09T13:32:15.500000+00:00' };
    igual(ids(P.ordenarLibro([E1, E2])), [2, 5], 'mismo instante escrito distinto (.5 y .500000): empate → id asc');
    const N = { id: 1, ejecutado_at: null };
    igual(ids(P.ordenarLibro([N, A, B])), [9, 3, 1], 'sin instante va al final (NULLS LAST)');
    const orig = [A, B]; const ord = P.ordenarLibro(orig);
    assert(ord !== orig && ids(orig).join() === '3,9', 'ordenarLibro devuelve una copia: el arreglo que tiene el Diario no cambia bajo sus pies');
    igual([P.maxIdLibro([A, B, N]), P.maxIdLibro([]), P.maxIdLibro(null), P.maxIdLibro([{ id: '12' }, { id: 7 }])], [9, 0, 0, 12], 'maxIdLibro: el mayor id (0 si no hay; ids que llegan como texto también)');
    // fusión
    const viejo = { id: 4, ejecutado_at: '2026-10-09T13:00:00+00:00', spot: 600.5, spot_fuente: 'm1', crudo: { grande: true } };
    const F1 = P.fusionarLibro([viejo], [{ fila: { id: 4, ejecutado_at: '2026-10-09T13:00:00+00:00', spot: null, crudo: null }, modo: 'insert' }]);
    igual([F1.length, F1[0].spot, F1[0].crudo], [1, 600.5, { grande: true }], 'fusionarLibro insert: un id que ya está NO se pisa (la caché puede traer ya el spot)');
    const F2 = P.fusionarLibro([viejo], [{ fila: { id: 4, spot: 601.25, spot_fuente: 'm1' }, modo: 'update' }]);
    igual([F2.length, F2[0].spot, F2[0].crudo, F2[0].ejecutado_at], [1, 601.25, { grande: true }, '2026-10-09T13:00:00+00:00'], 'update reemplaza lo que trae y conserva lo que no (las columnas TOAST que Realtime no reenvía)');
    assert(viejo.spot === 600.5, 'sin tocar el objeto de la caché anterior');
    const F3 = P.fusionarLibro([viejo], [{ fila: { id: 4, ejecutado_at: '2026-10-09T13:00:00+00:00', spot: 602 }, modo: 'lectura' }]);
    igual([F3[0].spot, 'crudo' in F3[0]], [602, false], 'lectura: lo que devolvió la base manda entero');
    const F4 = P.fusionarLibro([viejo], [{ fila: { id: 1, ejecutado_at: '2026-10-08T13:00:00+00:00' }, modo: 'insert' }, { fila: { id: 8, ejecutado_at: '2026-10-10T13:00:00+00:00' }, modo: 'update' }, { fila: null }, { fila: { ejecutado_at: 'x' } }]);
    igual(ids(F4), [1, 4, 8], 'una fila nueva entra en su sitio por instante (un id menor puede ir antes); un update de una fila que no estaba la añade; sin id se ignora');
    // filaLibroRT: los instantes al formato de PostgREST (Safari no entiende «2026-10-09 13:32:15+00»)
    igual(P.filaLibroRT({ id: 1, ejecutado_at: '2026-10-09 13:32:15.12+00', creado_at: '2026-10-09T13:32:16+00:00', fecha_ny: '2026-10-09', expiracion: '2026-10-16', symbol: 'SPY' }),
      { id: 1, ejecutado_at: '2026-10-09T13:32:15.12+00:00', creado_at: '2026-10-09T13:32:16+00:00', fecha_ny: '2026-10-09', expiracion: '2026-10-16', symbol: 'SPY' }, 'filaLibroRT normaliza solo los *_at con espacio y zona corta; fechas y lo demás intactos');
  }

  // ════════════════ 6. C3 · la lectura INCREMENTAL de leerFillsTodos ════════════════
  {
    const canon = libroCanonico(40, 7);
    const K = 25;   // la base tiene al principio los ids 1..25; luego entran los 26..40 (muchos con ejecutado_at VIEJO)
    const L = armarLibro(canon.filter(f => f.id <= K));
    let r = await L.M.leerFillsTodos();
    igual([r.error, L.st.pedidas.length, L.st.pedidas[0].gt, L.st.pedidas[0].ords, JSON.stringify(L.st.pedidas[0].range)], [null, 1, null, 'ejecutado_at,id', '[0,999]'], 'la primera lectura es COMPLETA: sin gt, ordenada por ejecutado_at e id, paginada');
    igual(ids(r.filas), ids(canon.filter(f => f.id <= K)), 'y trae el libro en el orden de la base');
    r = await L.M.leerFillsTodos();
    igual(L.st.pedidas.length, 1, 'dentro de los 60 s no se vuelve a pedir nada (caché)');
    L.st.filas = canon.slice();   // entran los ids 26..40
    L.M._libro.ts = Date.now() - 61000;
    r = await L.M.leerFillsTodos();
    const inc = L.st.pedidas[1];
    igual([inc.gt, inc.ords, JSON.stringify(inc.range), inc.n], [['id', K], 'id', '[0,999]', 15], 'vencida la caché: una lectura INCREMENTAL pide id=gt.25 ordenada por id (paginada) y baja SOLO las 15 nuevas');
    igual(ids(r.filas), ids(canon), 'el resultado tiene el MISMO orden que una lectura completa (las nuevas intercaladas por instante)');
    const C2 = armarLibro(canon); const rc = await C2.M.leerFillsTodos();
    igual(JSON.stringify(r.filas), JSON.stringify(rc.filas), 'idéntico, fila a fila, a lo que devuelve una lectura completa de la misma base');
    L.M._libro.ts = Date.now() - 61000;
    const antes = r.filas;
    r = await L.M.leerFillsTodos();
    igual([L.st.pedidas[2].gt, L.st.pedidas[2].n], [['id', 40], 0], 'la siguiente pide id=gt.40: nunca vuelve a bajar lo que ya tiene');
    assert(r.filas === antes, 'sin filas nuevas devuelve el MISMO arreglo (nadie repinta por nada)');
    L.M.libroInvalidar();
    r = await L.M.leerFillsTodos();
    igual([L.st.pedidas.length, L.st.pedidas[3].gt], [4, ['id', 40]], 'libroInvalidar(): la próxima lectura sale ya (sin esperar a los 60 s) y es incremental');
    L.M._libro.tsCompleta = Date.now() - 15 * 60000 - 1000; L.M._libro.ts = 0;
    r = await L.M.leerFillsTodos();
    igual([L.st.pedidas[4].gt, L.st.pedidas[4].ords], [null, 'ejecutado_at,id'], 'pasados 15 min desde la última completa: lectura COMPLETA (recoge lo que no llegó por Realtime)');
    igual(ids(r.filas), ids(canon), 'con el mismo orden');
    r = await L.M.leerFillsTodos(true);
    igual(L.st.pedidas[5].gt, null, 'con forzar: completa');
    L.M.libroInvalidar(true);
    await L.M.leerFillsTodos();
    igual(L.st.pedidas[6].gt, null, 'libroInvalidar(true) («Sincronizar ahora»): la siguiente es completa');
    await L.M.leerFillsTodos();
    igual(L.st.pedidas.length, 7, 'y tras ella vuelve la caché de 60 s');
    // un UPDATE que no llegó por Realtime (el spot de spot_fills) solo lo recoge la completa
    L.st.filas = L.st.filas.map(f => (f.id === 3 ? { ...f, spot: 599.1, spot_fuente: 'm1' } : f));
    L.M._libro.ts = 0;
    r = await L.M.leerFillsTodos();
    igual(r.filas.find(f => f.id === 3).spot, null, 'la incremental NO ve un UPDATE (por eso Realtime y la completa de 15 min)');
    L.M._libro.ts = 0; L.M._libro.tsCompleta = 0;
    r = await L.M.leerFillsTodos();
    igual(r.filas.find(f => f.id === 3).spot, 599.1, 'la completa sí');
    // paginación incremental con 2500 filas nuevas
    const grande = libroCanonico(2700, 3);
    const G = armarLibro(grande.filter(f => f.id <= 200));
    await G.M.leerFillsTodos();
    G.st.filas = grande.slice(); G.M._libro.ts = 0;
    r = await G.M.leerFillsTodos();
    igual(G.st.pedidas.slice(1).map(p => [p.gt[1], p.ords, p.range.join('-'), p.n]), [[200, 'id', '0-999', 1000], [200, 'id', '1000-1999', 1000], [200, 'id', '2000-2999', 500]], 'con 2500 nuevas pagina de 1000 en 1000, siempre con gt.200 y por id');
    igual(ids(r.filas), ids(grande), 'y el orden final es el de la base (2700 filas)');
    // 25 libros al azar: incremental (en uno, dos o tres saltos) = completa
    let iguales = 0;
    for (let s = 1; s <= 25; s++) {
      const cn = libroCanonico(30 + s * 7, 1000 + s);
      const n = cn.length, cortes = [Math.floor(n * 0.3), Math.floor(n * 0.6), n];
      const X = armarLibro(cn.filter(f => f.id <= cortes[0]));
      await X.M.leerFillsTodos();
      for (const c of cortes.slice(1)) { X.st.filas = cn.filter(f => f.id <= c); X.M._libro.ts = 0; await X.M.leerFillsTodos(); }
      const Y = armarLibro(cn); const ry = await Y.M.leerFillsTodos();
      if (JSON.stringify(X.M._libro.filas) === JSON.stringify(ry.filas) && X.st.pedidas.slice(1).every(p => p.gt && p.ords === 'id')) iguales++;
    }
    igual(iguales, 25, '25 libros al azar (empates, microsegundos, ids nuevos con fills viejos): la caché tras dos incrementales es idéntica a una lectura completa');
    // errores
    const E = armarLibro(canon.filter(f => f.id <= K));
    await E.M.leerFillsTodos();
    const cache = E.M._libro.filas, tsCache = E.M._libro.ts;
    E.st.error = { message: 'timeout' }; E.M._libro.ts = 0;
    r = await E.M.leerFillsTodos();
    assert(r.error === 'timeout' && r.filas === cache && E.M._libro.filas === cache && E.M._libro.ts === 0, 'una incremental que falla devuelve la caché que había CON el error (la vista lo dice) y la deja vencida para reintentar');
    assert(tsCache > 0, '(la caché tenía su hora)');
    const r2 = await E.M.libroParaUnir();
    igual(r2, null, 'libroParaUnir con error → null (todo como siempre, sin el filtro del libro)');
    E.st.error = null;
    r = await E.M.leerFillsTodos();
    igual([r.error, ids(r.filas)], [null, ids(canon.filter(f => f.id <= K))], 'y la siguiente se recupera');
    const E0 = armarLibro(canon); E0.st.error = { code: 'PGRST205', message: 'Could not find the table public.fills' };
    r = await E0.M.leerFillsTodos();
    igual([r.error, r.filas.length, E0.M._libro.filas], ['la tabla fills aún no está en la base (migración pendiente)', 0, null], 'la primera (completa) que falla: el error de siempre y nada en caché');
  }

  // ════════════════ 7. C2 · Realtime de fills: fusión en la caché ════════════════
  {
    const canon = libroCanonico(20, 11);
    const L = armarLibro(canon);
    await L.M.leerFillsTodos();
    const nueva = { id: 21, user_id: 'u', broker: 'moomoo', clave_ext: 'd21', symbol: 'TSLA', direccion: 'CALL', strike: 440, expiracion: '2026-10-16', lado: 'compra', contratos: 1, precio: 2,
      ejecutado_at: '2026-10-01T14:05:00.25+00:00', fecha_ny: '2026-10-01', crudo: { deal: 21 }, spot: null };   // id NUEVO, fill VIEJO: va el primero
    const antes = L.M._libro.filas;
    assert(L.M.libroFillNuevo({ eventType: 'INSERT', new: nueva }) === true, 'INSERT de Realtime: se acepta');
    const f21 = L.M._libro.filas;
    assert(f21 !== antes && f21.length === 21 && f21.some(f => f.id === 21), 'la fila nueva entra en la caché (copia nueva del arreglo)');
    const esperado = [21].concat(ids(canon));
    igual(ids(f21), esperado, 'en su sitio por instante: el id más alto pero el fill más viejo va el PRIMERO');
    igual(L.reg.repintar, 1, 'y pide el repintado con debounce (libroRepintarPronto)');
    L.M.libroFillNuevo({ eventType: 'INSERT', new: { ...nueva, spot: 1 } });
    igual([L.M._libro.filas.length, L.M._libro.filas.find(f => f.id === 21).spot], [21, null], 'un INSERT repetido del mismo id no duplica ni pisa');
    L.M.libroFillCambiado({ eventType: 'UPDATE', new: { id: 21, user_id: 'u', spot: 436.5, spot_fuente: 'm1', spot_at: '2026-10-09 13:32:00+00' } });
    const u21 = L.M._libro.filas.find(f => f.id === 21);
    igual([u21.spot, u21.spot_fuente, u21.spot_at, u21.crudo, u21.symbol], [436.5, 'm1', '2026-10-09T13:32:00+00:00', { deal: 21 }, 'TSLA'], 'UPDATE de Realtime (el spot de spot_fills): reemplaza esos campos, normaliza su instante y conserva el resto');
    // la muralla, por si acaso
    const n0 = L.M._libro.filas.length;
    assert(L.M.libroFillNuevo({ new: { ...nueva, id: 99, user_id: 'otro' } }) === false && L.M._libro.filas.length === n0, 'una fila de OTRO usuario se ignora (la RLS ya lo filtra; esto es el cinturón)');
    assert(L.M.libroFillNuevo({ new: null }) === false && L.M.libroFillNuevo(null) === false && L.M.libroFillCambiado({ new: { user_id: 'u' } }) === false, 'eventos sin fila o sin id: se ignoran sin reventar');
    const S = armarLibro(canon, { sesion: null });
    assert(S.M.libroFillNuevo({ new: nueva }) === false, 'sin sesión no se fusiona nada');
    // sin caché: no hay nada que fusionar (la primera lectura ya la trae), pero se anota y se repinta
    const V = armarLibro(canon);
    assert(V.M.libroFillNuevo({ new: nueva }) === true && V.M._libro.filas === null && V.reg.repintar === 1, 'sin caché todavía: no inventa un libro de una fila; deja la lectura para el repintado');
    // GRAVE: un UPDATE que llega MIENTRAS una lectura completa está en vuelo no se pierde
    const R = armarLibro(canon);
    await R.M.leerFillsTodos();
    const d = diferido(); R.st.espera = d;
    const lectura = R.M.leerFillsTodos(true);
    await respirar();
    R.M.libroFillCambiado({ new: { id: canon[2].id, user_id: 'u', spot: 777.25, spot_fuente: 'm1' } });
    R.M.libroFillNuevo({ new: nueva });
    d.resolver(); const rr = await lectura;
    const f2 = rr.filas.find(f => f.id === canon[2].id);
    igual([f2.spot, rr.filas.length, rr.filas.some(f => f.id === 21)], [777.25, 21, true], 'la lectura que estaba en vuelo (con la fila de ANTES) no pisa el spot ni pierde el INSERT que llegaron mientras leía');
    igual(ids(rr.filas), esperado, 'y el orden sigue siendo el de la base');
    // el diario de eventos tiene tope
    const T = armarLibro(canon);
    for (let i = 0; i < T.M.LIBRO_RT_MAX + 40; i++) T.M.libroFillCambiado({ new: { id: 1, user_id: 'u', spot: i } });
    igual(T.M._libro.rt.length, T.M.LIBRO_RT_MAX, 'el diario de eventos no crece sin fin (tope ' + T.M.LIBRO_RT_MAX + ')');
  }

  // ════════════════ 8. el módulo ENTERO: canal propio, fusión, debounce y repintado ════════════════
  {
    const canales = [];
    const canal = (nombre) => { const c = { nombre, regs: [], on(_e, cfg, cb) { c.regs.push({ event: cfg && cfg.event, table: cfg && cfg.table, cb }); return c; }, subscribe() { c.suscrito = true; return c; } }; canales.push(c); return c; };
    const canon = libroCanonico(12, 5);
    const { sb, st } = baseFalsa(canon);
    const mod = C.cargarModuloEntero({ src: './app/main.js?v=65', hash: '#/cuentas', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
    assert(mod.cargo, 'main.js entero carga en el DOM de juguete', mod.error);
    if (mod.cargo) {
      await respirar();   // que pase el arrancar(null) de getSession (sin sesión) ANTES de poner la de la prueba
      mod.ev('suscribir()');
      const cf = canales.find(c => c.nombre === 'mesa2-fills');
      assert(cf && cf.suscrito, 'Realtime: canal PROPIO «mesa2-fills», suscrito');
      igual(cf && cf.regs.map(r => [r.event, r.table, r.cb && r.cb.name]), [['INSERT', 'fills', 'libroFillNuevo'], ['UPDATE', 'fills', 'libroFillCambiado']], 'con INSERT y UPDATE de fills (y nada más)');
      igual(canales.filter(c => c.nombre !== 'mesa2-fills').flatMap(c => c.regs).filter(r => r.table === 'fills').length, 0, 'fills no va en ningún otro canal (si 0021 no está aplicada, solo cae el suyo)');
      igual(canales.flatMap(c => c.regs).filter(r => r.table === 'fills' && r.event === '*').length, 0, 'nunca event «*» sobre fills (los DELETE no pasan por RLS)');
      assert(canales.some(c => c.nombre === 'mesa2' && c.suscrito) && canales.some(c => c.nombre === 'mesa2-broker'), 'los canales de siempre siguen');
      // fusión + debounce + repintado del Diario con el módulo real
      const timers = []; let limpiados = 0;
      mod.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      mod.win.clearTimeout = () => { limpiados++; };
      mod.win.document.querySelector = (s) => (s === '.modal' ? null : s === '#vista' ? { contains: () => false } : nodo());
      mod.ev("sesionActiva = { user: { id: 'u' } }; _cuentasVista = 'diario'; window.__rep = []; vistaDiario = async () => { window.__rep.push('diario'); }; vistaCuentas = async () => { window.__rep.push('cuentas'); };");
      const r0 = await mod.ev('leerFillsTodos()');
      igual([r0.error, r0.filas.length, st.pedidas.length], [null, 12, 1], 'el módulo real lee el libro (completa la primera vez)');
      const fila = (id, extra) => Object.assign({ id, user_id: 'u', broker: 'tasty', clave_ext: 't' + id, symbol: 'NVDA', direccion: 'PUT', strike: 180, expiracion: '2026-10-16', lado: 'venta', contratos: 1, precio: 1, ejecutado_at: '2026-10-20T14:00:00+00:00', fecha_ny: '2026-10-20' }, extra || {});
      cf.regs[0].cb({ eventType: 'INSERT', new: fila(50) });
      cf.regs[0].cb({ eventType: 'INSERT', new: fila(51) });
      cf.regs[1].cb({ eventType: 'UPDATE', new: { id: 50, user_id: 'u', spot: 181.5, spot_fuente: 'm1' } });
      const cache = mod.ev('_libro.filas');
      igual([cache.length, cache[cache.length - 2].id, cache[cache.length - 1].id, cache[cache.length - 2].spot], [14, 50, 51, 181.5], 'los eventos se fusionan en la caché del módulo (INSERT añade, UPDATE reemplaza)');
      igual([timers.length, timers.every(t => t.ms === 1500), limpiados], [3, true, 2], 'tres eventos → tres reprogramaciones a 1,5 s, dos anuladas');
      timers[2].fn(); await respirar(); await respirar();
      igual(mod.ev('window.__rep'), ['diario'], 'al cumplirse el debounce: UN repintado del Diario');
      const r1 = await mod.ev('leerFillsTodos()');
      igual([r1.filas.length, st.pedidas.length], [14, 1], 'y el Diario lo pinta de la caché: no se relee la base');
      mod.ev("_cuentasVista = 'cuentas'; window.__rep = [];");
      cf.regs[0].cb({ new: fila(52) }); timers[timers.length - 1].fn(); await respirar();
      igual(mod.ev('window.__rep'), ['cuentas'], 'con la vista Cuentas a la vista se repinta Cuentas');
      mod.ev("location.hash = '#/informe'; window.__rep = [];");
      cf.regs[0].cb({ new: fila(53) }); timers[timers.length - 1].fn(); await respirar();
      igual([mod.ev('window.__rep'), mod.ev('_libro.filas.length')], [[], 16], 'en otra pestaña: se fusiona en la caché pero no se repinta nada');
      // el timer de segundo plano con el módulo real: en Tickers, con E*TRADE conectada aquí, en sesión regular
      mod.ev("location.hash = '#/tickers'; _hbUltimo = { sesion: 'regular', latido_at: new Date().toISOString() }; window.__et = 0; etradeSincronizar = () => { window.__et++; return Promise.resolve({ estado: 'ok', cambio: false }); };");
      mod.win.localStorage.setItem('mz_et_tok', 't'); mod.win.localStorage.setItem('mz_et_sec', 's'); mod.win.localStorage.setItem('mz_et_dia', mod.ev('hoyNY()'));
      mod.win.localStorage.setItem('mz_et_sync2', JSON.stringify({ ts: Date.now() - 130000, resumen: { estado: 'ok' } }));
      igual(mod.ev('syncBrokersFondo()'), ['etrade'], 'módulo real: en Tickers, con E*TRADE conectada y la última sincronización de hace 130 s, el timer la lanza');
      await respirar();
      igual(mod.ev('window.__et'), 1, 'y llama a etradeSincronizar');
      igual(mod.ev('syncBrokersFondo()'), [], 'el tic siguiente no la relanza');
      mod.win.document.visibilityState = 'hidden';
      mod.ev('_syncFondo.lanzado.etrade = 0');
      igual(mod.ev('syncBrokersFondo(true)'), [], 'con la app oculta no corre');
      mod.win.document.visibilityState = 'visible';
    }
  }

  // ════════════════ 9. C1 · Cuentas dice la verdad sobre «sincronizando…» con el tope nuevo ════════════════
  {
    async function correrCuentas(hb, msAtras) {
      const { sb } = baseFalsa([]);
      const canal = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
      const mod = C.cargarModuloEntero({ src: './app/main.js?v=65', hash: '#/cuentas', supabase: { createClient: () => ({ from: sb.from, channel: canal, auth: { onAuthStateChange() {}, getSession: () => Promise.resolve({ data: { session: null } }) } }) } });
      if (!mod.cargo) return { error: mod.error };
      await respirar();   // el arrancar(null) de getSession, antes de poner la sesión de la prueba
      const htmls = [];   // cada pintado (el primero es el que se juzga: con «en curso» Cuentas se repinta al terminar la sincronización)
      mod.win.document.querySelector = (s) => { const n = nodo(); if (s === '#vista') Object.defineProperty(n, 'innerHTML', { set(v) { htmls.push(v); }, get() { return htmls[htmls.length - 1] || ''; } }); return n; };
      mod.win.localStorage.setItem('mz_et_tok', 't'); mod.win.localStorage.setItem('mz_et_sec', 's'); mod.win.localStorage.setItem('mz_et_dia', mod.ev('hoyNY()'));
      mod.win.localStorage.setItem('mz_et_sync2', JSON.stringify({ ts: Date.now() - msAtras, resumen: { estado: 'ok', txs: 7, ops: 5, rts: 2, dias: 180, ts: Date.now() - msAtras } }));
      mod.win.__hb = hb;
      mod.ev("sesionActiva = { user: { id: 'u' } }; _hbUltimo = window.__hb; _cuentasVista = 'cuentas'; window.__et = 0;");
      mod.ev("etradeSaldo = async () => ({ broker: 'etrade', saldo_neto: 1000, capturado_at: new Date().toISOString(), _vivo: true }); schwabSaldo = async () => null;");
      // como la de verdad: una lectura real deja su hora guardada (sin eso, «en curso» repintaría Cuentas sin fin)
      mod.ev("etradeSincronizar = () => { window.__et++; localStorage.setItem('mz_et_sync2', JSON.stringify({ ts: Date.now(), resumen: { estado: 'ok', txs: 7, ops: 5, rts: 2, dias: 180, ts: Date.now() } })); return Promise.resolve({ estado: 'ok', cambio: false }); };");
      let revento = null;
      try { await mod.ev('vistaCuentasSaldos()'); } catch (e) { revento = String((e && e.stack) || e); }
      for (let i = 0; i < 20; i++) await respirar();
      return { html: htmls[0] || '', pintados: htmls.length, revento, et: mod.ev('window.__et') };
    }
    const S = await correrCuentas(hbDe('regular'), 3 * 60000);
    assert(!S.error && !S.revento, 'vistaCuentasSaldos corre entera', S.error || S.revento);
    assert(/historial: sincronizando…/.test(S.html), 'en sesión regular con la última sincronización de hace 3 min: «historial: sincronizando…» (de verdad toca leer: tope 2 min)');
    const F = await correrCuentas(hbDe('cerrado'), 3 * 60000);
    assert(!/historial: sincronizando…/.test(F.html) && /historial 180 d: 7 transacciones · 5 de opciones · 2 round-trips/.test(F.html), 'fuera de sesión, con la de hace 3 min: el resumen guardado (tope 10 min: no hay lectura en curso)');
    const S2 = await correrCuentas(hbDe('regular'), 60000);
    assert(!/historial: sincronizando…/.test(S2.html) && /historial 180 d:/.test(S2.html), 'en sesión, con la de hace 1 min: el resumen guardado');
    assert(S.et >= 1 && F.et >= 1 && S2.et >= 1, 'en los tres casos se llama a etradeSincronizar (su tope decide; Cuentas solo dice la verdad sobre lo que va a pasar)');
    igual([S.pintados, F.pintados, S2.pintados], [2, 1, 1], 'solo con la lectura «en curso» se repinta al terminar (una vez: la hora nueva corta el bucle)');
  }

  // ════════════════ 10. C4 · el login reintenta SOLO si falla la red ════════════════
  {
    function armarLogin(respuestas) {
      const reg = { fetches: 0, esperas: [], textos: [], guardado: null, recargas: 0 };
      const err = {}; let txt = '';
      Object.defineProperty(err, 'textContent', { set(v) { txt = v; reg.textos.push(v); }, get() { return txt; } });
      const nodos = { '#loginErr': err, '#email': { value: ' Andres@Ejemplo.com ' }, '#pass': { value: 'clave-de-prueba' } };
      const M = construir(['entrarLogin', 'tokenLogin'], {
        $: (s) => nodos[s] || null, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon',
        fetch: async (url, op) => {
          const r = respuestas[Math.min(reg.fetches, respuestas.length - 1)]; reg.fetches++;
          reg.ultimo = { url, op };
          if (r === 'red') throw new TypeError('Load failed');
          return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
        },
        setTimeout: (fn, ms) => { reg.esperas.push(ms); Promise.resolve().then(fn); return 0; },
        localStorage: { setItem: (k, v) => { reg.guardado = [k, v]; } }, claveSesion: () => 'sb-x-auth-token', location: { reload: () => { reg.recargas++; } },
      }, { consts: ['LOGIN_REINTENTOS_MS', 'LOGIN_SIN_RED', '_loginEnCurso'] });
      return { M, reg };
    }
    const ev = () => ({ prevenido: 0, preventDefault() { this.prevenido++; } });
    let L = armarLogin(['red', 'red', 'red']);
    let e = ev(); await L.M.entrarLogin(e);
    igual([e.prevenido, L.reg.fetches, L.reg.esperas], [1, 3, [1000, 3000]], 'sin red: tres intentos (el primero y 2 reintentos a 1 s y a 3 s)');
    igual(L.reg.textos, ['Entrando…', 'Reintentando…', 'Reintentando…', 'No pude contactar con el servidor de la Mesa. Revisa tu internet (o Tailscale) e inténtalo de nuevo.'], 'diciendo «Reintentando…» y, al final, el mensaje que dice qué revisar');
    igual([L.reg.guardado, L.reg.recargas], [null, 0], 'y no guarda nada ni recarga');
    L = armarLogin(['red', { status: 200, body: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u' } } }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.esperas, L.reg.textos], [2, [1000], ['Entrando…', 'Reintentando…']], 'un fallo de red y luego bien: UN reintento a 1 s');
    const ses = JSON.parse(L.reg.guardado[1]);
    assert(L.reg.guardado[0] === 'sb-x-auth-token' && ses.access_token === 'tok' && ses.expires_at > Date.now() / 1000, 'guarda la sesión donde la lee supabase-js (con expires_at)');
    igual(L.reg.recargas, 1, 'y recarga');
    igual([L.reg.ultimo.url, L.reg.ultimo.op.method, JSON.parse(L.reg.ultimo.op.body)], ['https://x.supabase.co/auth/v1/token?grant_type=password', 'POST', { email: 'andres@ejemplo.com', password: 'clave-de-prueba' }], 'la petición es la de siempre (correo recortado y en minúsculas)');
    L = armarLogin([{ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.esperas, L.reg.textos], [1, [], ['Entrando…', 'Correo o contraseña incorrectos.']], '400 de credenciales: NO se reintenta (repetir una contraseña mala no la arregla)');
    L = armarLogin([{ status: 401, body: { msg: 'unauthorized' } }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.esperas, L.reg.textos[1]], [1, [], 'No pude entrar: unauthorized'], '401: tampoco');
    L = armarLogin([{ status: 400, body: { error_description: 'Email not confirmed' } }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.textos[1]], [1, 'Correo sin confirmar.'], 'correo sin confirmar: lo de siempre, sin reintento');
    L = armarLogin([{ status: 503, body: null }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.textos[1]], [1, 'No pude entrar: 503'], 'el servidor CONTESTÓ (503): no es un fallo de red, se dice tal cual');
    L = armarLogin(['red', 'red', { status: 400, body: { error_description: 'Invalid login credentials' } }]);
    await L.M.entrarLogin(ev());
    igual([L.reg.fetches, L.reg.esperas, L.reg.textos[L.reg.textos.length - 1]], [3, [1000, 3000], 'Correo o contraseña incorrectos.'], 'dos fallos de red y a la tercera contesta «credenciales»: se dice eso (y se acabó)');
    // un segundo toque a «Entrar» mientras reintenta no abre otro intento en paralelo
    L = armarLogin(['red', 'red', 'red']);
    const p1 = L.M.entrarLogin(ev()), p2 = L.M.entrarLogin(ev());
    await p1; await p2;
    igual(L.reg.fetches, 3, 'dos toques seguidos = UNA tanda de intentos');
    await L.M.entrarLogin(ev());
    igual(L.reg.fetches, 6, 'al terminar, otro toque vuelve a intentarlo');
  }

  // ════════════════ 11. el cableado en el fuente ════════════════
  {
    const arr = extraer('arrancar');
    assert(/if \(!window\._mzTimerLibro\) window\._mzTimerLibro = setInterval\(\(\) => \{ try \{ syncBrokersFondo\(\); \} catch \(_\) \{\} \}, LIBRO_SYNC_TIC_MS\);/.test(arr), 'arrancar: el timer de segundo plano, colgado de window (uno solo aunque arrancar corra dos veces)');
    assert(/setTimeout\(\(\) => \{ try \{ syncBrokersFondo\(true\); \} catch \(_\) \{\} \}, 1500\);/.test(arr), 'arrancar: y una pasada al arrancar, sin esperar al primer tic');
    const vis = FUENTE.slice(FUENTE.indexOf("document.addEventListener('visibilitychange'"), FUENTE.indexOf("document.addEventListener('visibilitychange'") + 1500);
    assert(/setTimeout\(\(\) => \{ try \{ syncBrokersFondo\(true\); \} catch \(_\) \{\} \}, 800\);/.test(vis) && vis.indexOf('syncBrokersFondo(true)') < vis.indexOf('if (!sesionActiva || !_ocultaDesde'), 'al volver del fondo (visible): una pasada enseguida, antes del corte de los 30 s');
    assert(/sb\.channel\('mesa2-fills'\)\s*\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: 'fills' \}, libroFillNuevo\)\s*\.on\('postgres_changes', \{ event: 'UPDATE', schema: 'public', table: 'fills' \}, libroFillCambiado\)\s*\.subscribe\(\);/.test(extraer('suscribir')), 'suscribir: el canal mesa2-fills con INSERT y UPDATE');
    ['etradeSincronizarImpl', 'schwabSincronizarImpl'].forEach(fn => assert(/Date\.now\(\) - prev\.ts < syncTtlAhora\(\)/.test(extraer(fn)) && !/ET_SYNC_TTL/.test(extraer(fn)), fn + ': el tope es syncTtlAhora() (ya no el de 10 min fijo)'));
    const vc = extraer('vistaCuentasSaldos');
    assert(/const ttlSync = syncTtlAhora\(\);/.test(vc) && /Date\.now\(\) - \(etHist\.ts \|\| 0\) >= ttlSync/.test(vc) && /Date\.now\(\) - \(swHist\.ts \|\| 0\) >= ttlSync/.test(vc) && !/ET_SYNC_TTL/.test(vc), 'Cuentas: «sincronizando…» con el MISMO tope que aplicará la sincronización');
    assert(/libroInvalidar\(true\);/.test(FUENTE.slice(FUENTE.indexOf('diarioSincronizar: async'), FUENTE.indexOf('diarioSincronizar: async') + 900)), '«Sincronizar ahora» del Diario: relectura COMPLETA del libro');
    assert(/^\$\('#loginForm'\)\.addEventListener\('submit', entrarLogin\);/m.test(FUENTE) && !/Sin conexión/.test(extraer('entrarLogin') + extraer('tokenLogin')), 'el formulario de login usa entrarLogin (y su «Sin conexión» a la primera ya no existe; el de cambiar contraseña es otra pantalla)');
    // doctrina: nada de esto manda órdenes, nadie borra del libro
    const v65 = ['syncBrokersFondo', 'syncFondoResultado', 'ultimaSyncBroker', 'cadenciaSyncLibro', 'leerFillsTodos', 'libroFillRT', 'fusionarLibro', 'repintarVistaLibro', 'libroRepintarPronto', 'entrarLogin', 'tokenLogin'].map(extraer).join('\n');
    ['ordenPlace(', 'ordenPreview(', 'etPost(', 'swPost(', '/etrade/place', '/etrade/preview', 'construirOrden(', 'abrirOrden(', 'unlock', 'place_order'].forEach(t => assert(!v65.includes(t), 'el código de la v65 no arma ni envía órdenes: no toca «' + t + '»'));
    igual((v65.match(/\.(insert|update|upsert|delete)\(/g) || []), [], 'el código nuevo solo LEE de la base (las escrituras en fills/broker_trades siguen siendo las de etradeSincronizar/schwabSincronizar)');
    assert(!/sb\.from\('fills'\)[\s\S]{0,200}\.delete\(/.test(FUENTE), 'nadie borra del libro de fills');
    assert(!/console\.log\([^)]*(token|password|pass)/i.test(v65), 'nada imprime tokens ni contraseñas');
    assert(!/\bconfirm\(|\bprompt\(/.test(v65), 'sin confirm()/prompt()');
  }

  // ════════════════ 12. la versión ════════════════
  {
    const raiz = path.join(path.dirname(process.argv[2]), '..');
    const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
    assert(/config\.js\?v=65/.test(html) && /app\/main\.js\?v=65/.test(html), 'index.html carga config.js?v=65 y app/main.js?v=65');
    assert(/const VER = 'mesa2-v54';/.test(sw), 'sw.js VER mesa2-v54');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); C.resumen(); });
