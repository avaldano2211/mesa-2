#!/usr/bin/env node
/* Pruebas de las señales quitadas (v49): partirSenales, seccionSenales en sus
   estados, quitar/restaurar optimistas con cola y tope, cargarOcultas con lecturas
   numeradas, marcarToque sin cambiar el texto, el canal Realtime propio y la
   muralla (el cliente JAMÁS escribe en senales ni en ninguna tabla de mercado).
   Funciones REALES del fuente con dependencias falsas (casa_pruebas.js).
   Uso: node test_senales_ocultas.js mesa-2-app/app/main.js */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, 'casa_pruebas.js'))(process.argv[2], 'test_senales_ocultas.js');
const { FUENTE, assert, igual, construir, esc, haceCuanto, nodo, sbFalso, diferido, respirar } = C;

const NOMBRES = ['idSenal', 'partirSenales', 'seccionSenales', 'cabeceraSenal', 'motivoSenal', 'botonQuitarSenal', 'senalQuitadaHtml', 'marcarToque', 'soltarToque',
  'cargarOcultas', 'cerrarVerSinQuitadas', 'aplicarOcultasLeidas', 'motivoOcultas', 'escribirOcultas', 'quitarSenales', 'quitarSenal', 'restaurarSenal', 'verQuitadas'];
// Un módulo fresco (con su propio _ocultas) por escenario; `enrutar` decide qué contesta Supabase.
function armar(E) {
  E = Object.assign({ uid: 'u1', tope: 10000, enrutar: () => ({ data: [], error: null }) }, E || {});
  const reg = { toasts: [], rutas: 0, avisos: [] };
  const sb = sbFalso((tabla, cadena) => E.enrutar(tabla, cadena));
  const M = construir(NOMBRES, { esc, haceCuanto, planUid: () => E.uid, sb, toast: (t) => reg.toasts.push(t), ruta: () => reg.rutas++, TOPE_OCULTAS_MS: E.tope, console: { warn: (m) => reg.avisos.push(m) } },
    { consts: ['_ocultas', 'SENALES_VACIO', 'conTope'] });
  return { M, reg, sb, E };
}
const sen = (id, x) => Object.assign({ id, titulo: 'E5 · SPY CALL', motivo: 'ruptura', creado_at: new Date(Date.now() - 3600000).toISOString(), symbol: 'SPY', direccion: 'CALL' }, x || {});
const tarjeta = (s) => `<div class="card">TARJETA ${s.id}</div>`;

// ════════════════ 1. idSenal y partirSenales ════════════════
{
  const { M } = armar();
  igual([M.idSenal('12'), M.idSenal(12), M.idSenal(' 7 '), M.idSenal('abc'), M.idSenal(null), M.idSenal(1.5), M.idSenal(''), M.idSenal('12a')], ['12', '12', '7', null, null, null, null, null], 'idSenal: solo dígitos (el bigint de la base) como texto; cualquier otra cosa → null');
  const r = M.partirSenales([sen(1), sen(2), null, sen('3'), sen('x')], new Set(['2', '3']));
  igual([r.visibles.map(s => s.id), r.quitadas.map(s => s.id)], [[1, 'x'], [2, '3']], 'parte en visibles y quitadas conservando el orden; los nulos se ignoran; un id no numérico nunca se oculta');
  igual(M.partirSenales([sen(1)], null).visibles.length, 1, 'sin Set de ocultas todo es visible');
  igual(M.partirSenales(null, new Set()), { visibles: [], quitadas: [] }, 'sin señales no revienta');
}

// ════════════════ 2. seccionSenales en todos sus estados ════════════════
{
  const { M } = armar();
  const h0 = M.seccionSenales('SEÑALES DE HOY', [], new Set(), false, tarjeta);
  assert(/<div class="sec">SEÑALES DE HOY<\/div>/.test(h0) && h0.includes(M.SENALES_VACIO) && !/Quitar/.test(h0), 'sin señales: el texto vacío de siempre y ningún enlace');
  const h1 = M.seccionSenales('SEÑALES DE HOY', [sen(1), sen(2)], new Set(), false, tarjeta);
  assert(/TARJETA 1/.test(h1) && /TARJETA 2/.test(h1), 'con señales visibles se dibuja cada tarjeta');
  assert(/MZ\.quitarSenales\(\['1','2'\], this\)/.test(h1) && /Quitar todas/.test(h1), '«Quitar todas» lleva los ids VISIBLES');
  assert(!/Ver quitadas/.test(h1) && !/Ocultar quitadas/.test(h1), 'sin quitadas no hay enlace de ver/ocultar');
  const h2 = M.seccionSenales('SEÑALES DE HOY', [sen(1), sen(2)], new Set(['2']), false, tarjeta);
  assert(/TARJETA 1/.test(h2) && !/TARJETA 2/.test(h2), 'una quitada no se dibuja');
  assert(/MZ\.verQuitadas\(true, this\)[^>]*>Ver quitadas \(1\)/.test(h2) && /MZ\.quitarSenales\(\['1'\], this\)/.test(h2), '«Ver quitadas (1)» y «Quitar todas» solo con la visible');
  const h3 = M.seccionSenales('SEÑALES DE HOY', [sen(1), sen(2)], new Set(['2']), true, tarjeta);
  assert(/Ocultar quitadas/.test(h3) && /class="card quitada"/.test(h3) && /MZ\.restaurarSenal\('2', this\)[^>]*>Restaurar/.test(h3), 'abiertas: «Ocultar quitadas», la quitada atenuada con «Restaurar»');
  assert(/Quitar solo esconde la señal en tus equipos: no se borra/.test(h3), 'y el pie explica que no se borra');
  assert(!/MZ\.abrirFill/.test(h3.split('card quitada')[1]) && !/Operar en/.test(h3.split('card quitada')[1]), 'una quitada no ofrece fill ni orden: primero se restaura');
  const h4 = M.seccionSenales('SEÑALES DE HOY', [sen(1)], new Set(['1']), false, tarjeta);
  assert(/Quitaste la señal de hoy\./.test(h4) && /MZ\.verQuitadas\(true, this\)[^>]*>Ver quitadas</.test(h4) && !/TARJETA/.test(h4), 'todas quitadas (una): «Quitaste la señal de hoy.» con el botón Ver quitadas');
  const h5 = M.seccionSenales('SEÑALES DE HOY', [sen(1), sen(2)], new Set(['1', '2']), false, tarjeta);
  assert(/Quitaste las 2 señales de hoy\./.test(h5) && !/Quitar todas/.test(h5) && !/Ver quitadas \(2\)/.test(h5), 'todas quitadas (dos): plural, sin «Quitar todas» ni el enlace del encabezado (el botón está en la tarjeta)');
  const h6 = M.seccionSenales('SEÑALES DE HOY', [sen(1), sen(2)], new Set(['1', '2']), true, tarjeta);
  assert(!/Quitaste/.test(h6) && (h6.match(/card quitada/g) || []).length === 2 && /Ocultar quitadas/.test(h6), 'todas quitadas y abiertas: se ven las dos atenuadas');
  const h7 = M.seccionSenales('SEÑALES DE HOY', [sen(1, { titulo: 'a<b>' })], new Set(), false, tarjeta);
  assert(/<div class="sec fila">SEÑALES DE HOY<span class="acc">/.test(h7), 'el título va escapado dentro de la fila de acciones');
  igual(M.seccionSenales('X', null, null, false, tarjeta).includes(M.SENALES_VACIO), true, 'null en todo no revienta');
  // cabecera / motivo / botón
  assert(/<span style="font-weight:700;font-size:13.5px">E5 · SPY CALL<\/span><button class="btnquitar" onclick="MZ\.quitarSenal\('1', this\)" aria-label="Quitar esta señal de tu lista de hoy">Quitar<\/button>/.test(M.cabeceraSenal(sen(1))), 'la cabecera lleva el título y el botón Quitar (arriba a la derecha, lejos de Registrar/Operar)');
  igual(M.botonQuitarSenal(sen('raro')), '', 'sin id numérico no hay botón Quitar');
  assert(/<span class="fresco">hace 1 h · <\/span>ruptura/.test(M.motivoSenal(sen(1))), '«hace 1 h» va DELANTE del motivo');
  assert(/class="mut tenue"/.test(M.motivoSenal(sen(1), true)), 'la quitada va tenue');
  assert(/<span class="fresco">hace 1 h<\/span><\/div>/.test(M.motivoSenal(sen(1, { motivo: '' }))), 'sin motivo: solo «hace 1 h», sin el punto medio');
  assert(/class="tenue"[^>]*>E5 · SPY CALL/.test(M.senalQuitadaHtml(sen(1))) && !/Restaurar/.test(M.senalQuitadaHtml(sen('raro'))), 'senalQuitadaHtml: título tenue; sin id, sin Restaurar');
}

// ════════════════ 3. marcarToque / soltarToque: respuesta en el sitio sin cambiar el texto ════════════════
{
  const { M } = armar();
  const card = nodo({ style: {} });
  const btn = nodo({ tagName: 'BUTTON', textContent: 'Quitar', closest: () => card });
  M.marcarToque(btn, null, true);
  igual([btn.disabled, btn.textContent, btn.dataset.txt, card.style.opacity], [true, 'Quitar', 'Quitar', '.45'], 'un botón se deshabilita SIN cambiar su texto (no cambia de ancho ni parte el título) y la tarjeta se atenúa');
  M.soltarToque(btn);
  igual([btn.disabled, btn.textContent, 'txt' in btn.dataset, card.style.opacity], [false, 'Quitar', false, ''], 'soltarToque lo deja como estaba');
  const link = nodo({ tagName: 'A', textContent: 'Ver quitadas (1)', closest: () => null });
  M.marcarToque(link);
  igual([link.style.opacity, link.style.pointerEvents, link.textContent], ['.6', 'none', 'Ver quitadas (1)'], 'un enlace (sin disabled) se atenúa y deja de recibir toques');
  M.soltarToque(link);
  igual([link.style.opacity, link.style.pointerEvents], ['', ''], 'y vuelve');
  const conTexto = nodo({ tagName: 'BUTTON', textContent: 'Quitar' });
  M.marcarToque(conTexto, 'Quitando…');
  igual([conTexto.textContent, conTexto.dataset.txt], ['Quitando…', 'Quitar'], 'con texto explícito sí cambia, y recuerda el original');
  M.soltarToque(conTexto); igual(conTexto.textContent, 'Quitar', 'que se restaura al soltar');
  M.marcarToque(null); M.soltarToque(undefined); M.marcarToque({});
  C.ok('sin nodo (o un nodo sin style) no revienta: el nodo pudo salir de la pantalla');
}

// ════════════════ 4. quitar / restaurar optimistas, cola, tope, «el último toque manda» ════════════════
(async () => {
  {
    const escrituras = [];
    const { M, reg, sb } = armar({ enrutar: (tabla, cadena) => { const d = diferido(); escrituras.push({ tabla, cadena, d }); return d.promesa; } });
    const btn = nodo({ tagName: 'BUTTON', textContent: 'Quitar', closest: () => null });
    const p = M.quitarSenal('5', btn);
    igual([M._ocultas.ids.has('5'), reg.rutas, btn.disabled, M._ocultas.pend.get('5')], [true, 1, true, 1], 'quitar es OPTIMISTA: el id entra en memoria, se redibuja y el botón queda marcado antes de que conteste Supabase');
    await respirar();
    igual([escrituras.length, escrituras[0].tabla, escrituras[0].cadena[0][0]], [1, 'senales_ocultas', 'upsert'], 'la escritura es un upsert en senales_ocultas (tabla PERSONAL)');
    igual(escrituras[0].cadena[0][1], [[{ user_id: 'u1', senal_id: 5 }], { onConflict: 'user_id,senal_id', ignoreDuplicates: true }], 'con el user_id de la sesión, senal_id numérico e ignorando duplicados (doble toque, dos equipos)');
    // una segunda quitada mientras la primera vuela: en cola, en orden
    const p2 = M.quitarSenal('6', null);
    await respirar();
    igual([escrituras.length, M._ocultas.ids.has('6')], [1, true], 'la segunda escritura espera en la cola (una a la vez), pero la memoria ya la tiene');
    escrituras[0].d.resolver({ error: null }); await respirar(); await respirar();
    igual([await p, escrituras.length, M._ocultas.pend.has('5'), btn.disabled], [true, 2, false, true], 'al confirmar la primera: true, sale de pendientes, arranca la segunda y el botón sigue marcado (el redibujo lo reconcilia)');
    escrituras[1].d.resolver({ error: null }); igual(await p2, true, 'y la segunda confirma');
    // fallo: se revierte, se avisa con el motivo corto y se redibuja
    const p3 = M.quitarSenal('7', null); await respirar();
    escrituras[2].d.resolver({ error: { message: 'relation "senales_ocultas" does not exist in schema cache' } });
    igual(await p3, false, 'si Supabase falla, quitar devuelve false');
    igual([M._ocultas.ids.has('7'), reg.toasts[reg.toasts.length - 1], reg.rutas], [false, 'No se pudo quitar: la Mesa aún no está lista para esto', 4], 'se revierte, el toast dice el motivo corto (sin la migración 0013) y se redibuja');
    const p4 = M.quitarSenal('8', null); await respirar(); escrituras[3].d.rechazar(new Error('Failed to fetch'));
    igual([await p4, reg.toasts[reg.toasts.length - 1]], [false, 'No se pudo quitar: sin conexión'], 'una excepción de red también revierte, con «sin conexión»');
    // doble toque: un id ya quitado no se vuelve a escribir
    const n = escrituras.length;
    igual([await M.quitarSenal('5', btn), escrituras.length], [true, n], 'quitar un id ya quitado no escribe nada (y con toque, redibuja)');
    igual(await M.quitarSenales(['5', 'x', null], null), true, 'ids inválidos o repetidos se filtran');
    igual(escrituras.length, n, 'sin escritura');
    // restaurar: delete por senal_id (RLS: solo las tuyas)
    const p5 = M.restaurarSenal('5', btn);
    igual([M._ocultas.ids.has('5'), reg.rutas], [false, 8], 'restaurar es optimista: sale de memoria y se redibuja');
    await respirar();
    igual([escrituras[n].cadena[0][0], escrituras[n].cadena[1]], ['delete', ['eq', ['senal_id', 5]]], 'la escritura es delete().eq(senal_id) — el RLS limita a las tuyas');
    escrituras[n].d.resolver({ error: null }); igual(await p5, true, 'y confirma');
    igual(await M.restaurarSenal('999', null), true, 'restaurar algo que no está quitado no escribe nada');
    const p6 = M.restaurarSenal('6', null); await respirar(); escrituras[n + 1].d.resolver({ error: { message: 'jwt expired' } });
    igual([await p6, M._ocultas.ids.has('6'), reg.toasts[reg.toasts.length - 1]], [false, true, 'No se pudo restaurar: tu sesión venció, vuelve a entrar'], 'si restaurar falla, el id vuelve a quitado y se dice');
    // «el último toque manda»: quitar y restaurar el mismo id antes de que conteste el primero
    const p7 = M.quitarSenal('9', null); await respirar();
    const p8 = M.restaurarSenal('9', null); await respirar();
    igual([M._ocultas.ids.has('9'), M._ocultas.pend.get('9')], [false, 2], 'con las dos en vuelo la memoria dice lo del ÚLTIMO toque (restaurada) y el id tiene 2 pendientes');
    const t0 = reg.toasts.length;
    escrituras[n + 2].d.resolver({ error: { message: 'boom' } }); await respirar(); await respirar();
    igual([await p7, M._ocultas.ids.has('9'), reg.toasts.length], [false, false, t0], 'el fallo del quitar NO revierte (hay otro toque detrás) ni avisa: el último toque manda');
    escrituras[n + 3].d.resolver({ error: null }); igual([await p8, M._ocultas.pend.has('9')], [true, false], 'y al confirmar el restaurar el id queda limpio');
    igual(M._ocultas.gen >= 16, true, 'gen sube al empezar y al terminar cada escritura (para que una lectura cruzada no pise la memoria)');
  }
  {
    const { M, reg } = armar({ uid: null });
    igual([await M.quitarSenal('1', null), reg.toasts[0], M._ocultas.ids.size], [false, 'Sin sesión. Sal y vuelve a entrar.', 0], 'sin sesión no se quita nada');
    M._ocultas.ids.add('2');
    igual([await M.restaurarSenal('2', null), reg.toasts[1]], [false, 'Sin sesión. Sal y vuelve a entrar.'], 'ni se restaura');
  }
  {
    // tope: si supabase-js no responde, la cola no se traba y cuenta como fallo
    const { M, reg } = armar({ tope: 30, enrutar: () => new Promise(() => {}) });
    const p = M.quitarSenal('1', null);
    igual([await p, M._ocultas.ids.has('1'), reg.toasts[0]], [false, false, 'No se pudo quitar: sin respuesta, inténtalo de nuevo'], 'pasado el tope la escritura se da por fallida, se revierte y se avisa');
    const p2 = M.quitarSenal('2', null);
    igual(await p2, false, 'y la cola sigue viva para la siguiente (que también caduca)');
    assert(reg.avisos.some(a => /supabase-js no respondió/.test(a)), 'el texto crudo del error va a la consola');
  }
  {
    const { M } = armar();
    igual([M.motivoOcultas({ message: 'relation senales_ocultas does not exist' }), M.motivoOcultas({ message: 'NetworkError when attempting to fetch' }), M.motivoOcultas(new Error('tiempo agotado')), M.motivoOcultas({ message: '401 unauthorized' }), M.motivoOcultas({ message: 'otra cosa' }), M.motivoOcultas(null)],
      ['la Mesa aún no está lista para esto', 'sin conexión', 'sin respuesta, inténtalo de nuevo', 'tu sesión venció, vuelve a entrar', 'inténtalo de nuevo', 'inténtalo de nuevo'], 'motivoOcultas: corto y en español para la píldora del iPhone');
  }

  // ════════════════ 5. cargarOcultas con lecturas numeradas ════════════════
  {
    const { M } = armar({ enrutar: () => ({ data: [{ senal_id: 2 }], error: null }) });
    const ids = await M.cargarOcultas(Promise.resolve({ data: [sen(1), sen(2), sen(3)] }));
    igual([[...ids].sort(), [...M._ocultas.hoy].sort(), M._ocultas.lect, M._ocultas.aplicada, M._ocultas.err], [['2'], ['1', '2', '3'], 1, 1, null], 'lee las quitadas de HOY (filtradas por los ids de las señales del día) y numera la lectura');
    const { M: M0, sb } = armar({ uid: null });
    await M0.cargarOcultas(Promise.resolve({ data: [sen(1)] }));
    igual([sb.llamadas.length, M0._ocultas.ids.size], [0, 0], 'sin sesión no se consulta');
    const { M: M1, sb: sb1 } = armar();
    await M1.cargarOcultas(Promise.resolve({ data: [] }));
    igual(sb1.llamadas.length, 0, 'sin señales hoy tampoco');
    const { M: M2 } = armar({ enrutar: () => ({ data: null, error: { message: 'relation senales_ocultas does not exist' } }) });
    M2._ocultas.ids.add('9');
    await M2.cargarOcultas(Promise.resolve({ data: [sen(9)] }));
    igual([M2._ocultas.ids.has('9'), /senales_ocultas/.test(M2._ocultas.err)], [true, true], 'con error (sin la migración 0013) se queda con lo último conocido y anota el motivo');
    const { M: M3 } = armar({ enrutar: () => { throw new Error('boom'); } });
    await M3.cargarOcultas(Promise.resolve({ data: [sen(1)] }));
    igual(M3._ocultas.err, 'boom', 'una excepción tampoco tumba la vista');
    await M3.cargarOcultas(Promise.reject(new Error('senales caídas')));
    igual(M3._ocultas.err, 'senales caídas', 'ni que falle la consulta de señales');
    // «Ver quitadas» se cierra si ya no hay quitadas de hoy
    const { M: M4 } = armar({ enrutar: () => ({ data: [], error: null }) });
    M4._ocultas.ver = true; M4._ocultas.ids.add('1');
    await M4.cargarOcultas(Promise.resolve({ data: [sen(1)] }));
    igual([M4._ocultas.ids.has('1'), M4._ocultas.ver], [false, false], 'restaurada en otro equipo: el id sale y «Ver quitadas» se cierra');
    // dos lecturas cruzadas por Realtime: la más vieja que vuelve tarde no pisa a la nueva
    const lecturas = [];
    const { M: M5 } = armar({ enrutar: () => { const d = diferido(); lecturas.push(d); return d.promesa; } });
    const pA = M5.cargarOcultas(Promise.resolve({ data: [sen(1), sen(2)] })); await respirar();
    const pB = M5.cargarOcultas(Promise.resolve({ data: [sen(1), sen(2)] })); await respirar();
    igual([lecturas.length, M5._ocultas.lect], [2, 2], 'dos relecturas en vuelo, numeradas 1 y 2');
    lecturas[1].resolver({ data: [{ senal_id: 2 }], error: null }); await pB;
    igual([[...M5._ocultas.ids], M5._ocultas.aplicada], [['2'], 2], 'la 2ª (más nueva) llega primero y se aplica');
    lecturas[0].resolver({ data: [], error: null }); await pA;
    igual([[...M5._ocultas.ids], M5._ocultas.aplicada], [['2'], 2], 'la 1ª (más vieja) llega tarde con la foto de antes y NO pisa');
    // una lectura cruzada con una ESCRITURA (gen cambió) tampoco pisa; un id con escritura en cola no se toca
    igual(M5.aplicarOcultasLeidas(['1', '2'], [], M5._ocultas.gen - 1, 3), false, 'gen distinta (hubo una escritura mientras se leía): la foto puede ser de antes, manda la memoria');
    M5._ocultas.pend.set('2', 1);
    igual([M5.aplicarOcultasLeidas(['1', '2'], [{ senal_id: 1 }], M5._ocultas.gen, 3), [...M5._ocultas.ids].sort()], [true, ['1', '2']], 'con gen igual se aplica: el 1 entra (está en la base) y el 2, con escritura en cola, no se toca');
    igual(M5.aplicarOcultasLeidas(['1'], [], M5._ocultas.gen, 3), false, 'una lectura con el mismo número que la última aplicada tampoco pisa');
  }

  // ════════════════ 6. verQuitadas y el canal Realtime propio ════════════════
  {
    const { M, reg } = armar();
    const link = nodo({ tagName: 'A', closest: () => null });
    M.verQuitadas(true, link);
    igual([M._ocultas.ver, reg.rutas, link.style.pointerEvents], [true, 1, 'none'], 'verQuitadas abre, redibuja y marca el enlace tocado');
    M.verQuitadas(false, null); igual(M._ocultas.ver, false, 'y cierra');
    const mod = C.cargarModuloEntero();
    assert(mod.cargo, 'app/main.js entero se evalúa en el DOM de juguete', mod.error);
    if (mod.cargo) {
      mod.ev('suscribir()');
      const c = (n) => mod.canales.find(x => x.nombre === n);
      assert(c('mesa2') && c('mesa2').tablas.includes('senales') && c('mesa2').tablas.includes('posiciones') && c('mesa2').suscrito, 'el canal mesa2 lleva la campanada de senales (y ticker_estado, worker_heartbeat, posiciones)');
      igual(c('mesa2-ocultas') && c('mesa2-ocultas').tablas, ['senales_ocultas'], 'senales_ocultas va en SU PROPIO canal: si la 0013 no está en la publicación, la campanada de senales no se cae con ella');
      assert(!c('mesa2').tablas.includes('senales_ocultas'), 'y no en el de siempre');
      mod.ev('suscribir()');
      igual(mod.canales.filter(x => x.nombre === 'mesa2').length, 1, 'suscribir() dos veces no duplica canales');
      igual(['quitarSenal', 'quitarSenales', 'restaurarSenal', 'verQuitadas'].filter(k => typeof mod.win.MZ[k] !== 'function'), [], 'las cuatro puertas cuelgan de window.MZ');
    }
  }

  // ════════════════ 7. la muralla: el cliente jamás escribe en senales ni en tablas de MERCADO ════════════════
  {
    const usosDe = (t) => { const re = new RegExp("from\\('" + t + "'\\)\\s*\\.(\\w+)\\(", 'g'); const usos = []; let m; while ((m = re.exec(FUENTE))) usos.push(m[1]); return usos; };
    ['senales', 'ticker_estado', 'ticker_velas', 'worker_heartbeat', 'config_kv', 'ticker_targets_mercado'].forEach(t => {
      const usos = usosDe(t);
      igual(usos.filter(u => u !== 'select'), [], 'la tabla de MERCADO «' + t + '» solo se LEE desde el cliente (' + usos.length + ' uso' + (usos.length === 1 ? '' : 's') + ')');
    });
    // tickers (0017): el admin puede INSERTAR y ACTUALIZAR (agregar META, desactivar, reordenar); el DELETE sigue prohibido
    const usosT = usosDe('tickers');
    igual(usosT.filter(u => !['select', 'insert', 'update'].includes(u)), [], 'la tabla tickers solo se lee, inserta o actualiza desde el cliente (' + usosT.join(', ') + '): un ticker se desactiva, nunca se borra');
    assert(/from\('senales_ocultas'\)\.upsert\(ids\.map\(id => \(\{ user_id: uid, senal_id: Number\(id\) \}\)\)/.test(FUENTE), 'las quitadas van a senales_ocultas (PERSONAL) con el user_id de la sesión');
    assert(/from\('senales_ocultas'\)\.delete\(\)\.eq\('senal_id', Number\(ids\[0\]\)\)/.test(FUENTE), 'restaurar es un delete por senal_id (el RLS user_id = auth.uid() hace el resto)');
    assert(!/from\('senales'\)\.delete/.test(FUENTE) && !/from\('senales'\)\.update/.test(FUENTE), 'una señal JAMÁS se borra ni se edita: senales es append-only (auditoría, dedupe del worker, FKs)');
    assert(/\.select\('senal_id'\)\.eq\('user_id', uid\)\.in\('senal_id', ids\)/.test(C.extraer('cargarOcultas')), 'la lectura de quitadas se acota a las señales de HOY y al usuario');
  }

  C.resumen();
})().catch(e => { console.log('FALLA: excepción inesperada → ' + (e && e.stack || e)); process.exit(1); });
