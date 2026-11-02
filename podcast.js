/* =========================================================
   PESTAÑA PODCAST
   - Pistas de Voces, Música y Efectos
   - Grabar con el micrófono o añadir archivos
   - Mover, recortar, cortar, borrar y deshacer
   - Nivelar volumen, quitar ruido, fundidos
   - Entradilla de Radio Pikota y sonidos de efectos
   - Exportar a MP3 o WAV
   ========================================================= */

const P = {
  pistas: [
    { id: 'voces', nombre: '🎤 Voces', vol: 1, mute: false },
    { id: 'musica', nombre: '🎵 Música', vol: 0.8, mute: false },
    { id: 'efectos', nombre: '✨ Efectos', vol: 1, mute: false }
  ],
  clips: [],          // trozos de audio colocados en la línea de tiempo
  sel: null,          // id del trozo seleccionado
  zoom: 40,           // píxeles por segundo
  cabezal: 0,         // posición de la línea roja (segundos)
  reproduciendo: false,
  fuentes: [], origen: 0, desde: 0,
  historial: [],      // para deshacer
  grabador: null,
  idSig: 1,
  numGrabacion: 1
};
let mezclaP = null;

/* =========================================================
   AÑADIR AUDIO A LA LÍNEA DE TIEMPO
   ========================================================= */
function agregarAudio(buffer, nombre, pista = 'voces', evitarSolape = true, extra = {}) {
  let inicio = P.cabezal;
  if (evitarSolape) {
    const mismos = P.clips.filter(c => c.pista === pista);
    if (mismos.some(c => inicio < c.inicio + c.dur && inicio + buffer.duration > c.inicio)) {
      inicio = Math.max(...mismos.map(c => c.inicio + c.dur));
    }
  }
  const clip = {
    id: P.idSig++, pista, buffer, original: null, nombre,
    inicio, offset: 0, dur: buffer.duration,
    vol: 1, fadeIn: 0, fadeOut: 0, procesos: [], ...extra
  };
  P.clips.push(clip);
  P.sel = clip.id;
  pintarP();
  return clip;
}

/* Lo que usa la pestaña Vídeo para mandar su audio */
const podcast = {
  agregarAudio: (buffer, nombre, pista) => { guardarHistorial(); return agregarAudio(buffer, nombre, pista, true); }
};

/* Archivos de audio (o vídeo: se usa su sonido) */
$('pArchivos').addEventListener('change', async () => {
  const archivos = [...$('pArchivos').files];
  $('pArchivos').value = '';
  for (const a of archivos) {
    $('pEstado').textContent = `Cargando ${a.name}...`;
    try {
      const buffer = await decodificar(await a.arrayBuffer());
      guardarHistorial();
      agregarAudio(buffer, a.name.replace(/\.[^.]+$/, ''), $('pPistaDestino').value, true);
    } catch (e) { avisar(`No se ha podido abrir ${a.name}`, 'error'); }
  }
  $('pEstado').textContent = '';
});

/* =========================================================
   GRABAR CON EL MICRÓFONO
   ========================================================= */
$('pGrabar').addEventListener('click', async () => {
  const boton = $('pGrabar');
  if (P.grabador && P.grabador.state === 'recording') { P.grabador.stop(); return; }
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    avisar('No se puede usar el micrófono. Revisa los permisos del navegador.', 'error');
    return;
  }
  if (P.reproduciendo) pararP();
  const trozos = [];
  const grabador = new MediaRecorder(flujo);
  const inicioEn = P.cabezal, empezo = Date.now();
  grabador.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
  grabador.onstop = async () => {
    clearInterval(P.relojGrab);
    flujo.getTracks().forEach(t => t.stop());
    boton.classList.remove('activo');
    boton.textContent = '⏺ Grabar';
    try {
      const buffer = await decodificar(await new Blob(trozos).arrayBuffer());
      guardarHistorial();
      P.cabezal = inicioEn;
      agregarAudio(buffer, `Grabación ${P.numGrabacion++}`, 'voces', true);
      avisar('🎤 Grabación añadida', 'ok');
    } catch (e) { avisar('No se ha podido guardar la grabación', 'error'); }
  };
  grabador.start();
  P.grabador = grabador;
  boton.classList.add('activo');
  P.relojGrab = setInterval(() => { boton.textContent = `⏹ Parar (${formatear((Date.now() - empezo) / 1000)})`; }, 250);
  boton.textContent = '⏹ Parar (0:00)';
});

/* =========================================================
   ENTRADILLA DE RADIO PIKOTA
   ========================================================= */
$('pEntInicio').addEventListener('click', async () => {
  if (P.clips.some(c => c.entradilla === 'inicio')) return avisar('La entradilla del inicio ya está puesta');
  const ent = await obtenerEntradilla();
  guardarHistorial();
  // Dejamos sitio al principio: la voz entra justo cuando la sintonía se va apagando
  const hueco = ent.duration - 0.6;
  const primero = P.clips.length ? Math.min(...P.clips.map(c => c.inicio)) : hueco;
  const mover = Math.max(0, hueco - primero);
  P.clips.forEach(c => { c.inicio += mover; });
  P.cabezal = 0;
  agregarAudio(ent, '🍒 Entradilla Radio Pikota', 'musica', false, { fadeOut: 1, entradilla: 'inicio' });
  P.cabezal = 0;
  pintarP();
  avisar('🍒 Entradilla añadida al inicio', 'ok');
});

$('pEntFinal').addEventListener('click', async () => {
  if (P.clips.some(c => c.entradilla === 'final')) return avisar('La entradilla del final ya está puesta');
  const ent = await obtenerEntradilla();
  guardarHistorial();
  P.cabezal = Math.max(0, finProyecto() - 0.3);
  agregarAudio(ent, '🍒 Entradilla Radio Pikota', 'musica', false, { fadeIn: 0.3, entradilla: 'final' });
  avisar('🍒 Entradilla añadida al final', 'ok');
});

/* =========================================================
   SONIDOS DE EFECTOS
   ========================================================= */
SONIDOS.forEach(s => {
  const b = el('button', { textContent: s.nombre });
  b.addEventListener('click', async () => {
    const buffer = await generarSonido(s.id);
    guardarHistorial();
    agregarAudio(buffer, s.nombre, 'efectos', false);
  });
  $('pSonidos').append(b);
});
const subirSonido = el('label', { className: 'boton', textContent: '📁 Subir mi sonido', htmlFor: 'pArchivoSonido' });
const inputSonido = el('input', { type: 'file', id: 'pArchivoSonido', accept: 'audio/*', hidden: true });
inputSonido.addEventListener('change', async () => {
  const a = inputSonido.files[0];
  inputSonido.value = '';
  if (!a) return;
  try {
    const buffer = await decodificar(await a.arrayBuffer());
    guardarHistorial();
    agregarAudio(buffer, a.name.replace(/\.[^.]+$/, ''), 'efectos', false);
  } catch (e) { avisar('No se ha podido abrir ese sonido', 'error'); }
});
$('pSonidos').append(subirSonido, inputSonido);

/* =========================================================
   DIBUJAR LA LÍNEA DE TIEMPO
   ========================================================= */
const pistaDe = id => P.pistas.find(p => p.id === id);
const clipSel = () => P.clips.find(c => c.id === P.sel);
const finProyecto = () => P.clips.reduce((m, c) => Math.max(m, c.inicio + c.dur), 0);

function construirPistas() {
  $('pCabeceras').innerHTML = '<div class="hueco-regla"></div>';
  $('pCarriles').innerHTML = '';
  P.pistas.forEach(p => {
    const mute = el('button', { textContent: '🔇', title: 'Silenciar pista' });
    mute.addEventListener('click', () => { p.mute = !p.mute; mute.classList.toggle('activo', p.mute); refrescarSiSuena(); });
    const vol = el('input', { type: 'range', min: 0, max: 150, value: p.vol * 100, title: 'Volumen de la pista' });
    vol.addEventListener('input', () => { p.vol = vol.value / 100; });
    vol.addEventListener('change', refrescarSiSuena);
    $('pCabeceras').append(el('div', { className: 'cabecera-pista' }, el('div', { className: 'titulo' }, p.nombre, mute), vol));
    const carril = el('div', { className: 'carril' });
    carril.dataset.pista = p.id;
    $('pCarriles').append(carril);
  });
}

/* Picos de la onda (se calculan una vez por audio) */
const cachePicos = new WeakMap();
function picos(buffer) {
  if (cachePicos.has(buffer)) return cachePicos.get(buffer);
  const paso = Math.max(1, Math.floor(buffer.sampleRate / 200));
  const arr = new Float32Array(Math.ceil(buffer.length / paso));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]), k = (i / paso) | 0;
      if (a > arr[k]) arr[k] = a;
    }
  }
  const r = { arr, paso };
  cachePicos.set(buffer, r);
  return r;
}

const COLORES_ONDA = { voces: ['#A3414D', '#BF4858'], musica: ['#CB5F35', '#C88E3B'], efectos: ['#8C9247', '#C88E3B'] };

function dibujarOnda(canvas, c) {
  const w = canvas.width, h = canvas.height, g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  const { arr, paso } = picos(c.buffer);
  const sr = c.buffer.sampleRate;
  const ini = c.offset * sr / paso, cuantos = c.dur * sr / paso;
  const grad = g.createLinearGradient(0, 0, 0, h);
  const [c1, c2] = COLORES_ONDA[c.pista];
  grad.addColorStop(0, c1); grad.addColorStop(0.5, c2); grad.addColorStop(1, c1);
  g.fillStyle = grad;
  for (let x = 0; x < w; x++) {
    const a = Math.floor(ini + x / w * cuantos), b = Math.max(a + 1, Math.floor(ini + (x + 1) / w * cuantos));
    let m = 0;
    for (let i = a; i < b && i < arr.length; i++) if (arr[i] > m) m = arr[i];
    // El dibujo tiene en cuenta el volumen y los fundidos
    const t = x / w * c.dur;
    let f = c.vol;
    if (c.fadeIn > 0 && t < c.fadeIn) f *= t / c.fadeIn;
    if (c.fadeOut > 0 && t > c.dur - c.fadeOut) f *= (c.dur - t) / c.fadeOut;
    const y = Math.min(1, m * f) * h / 2 * 0.95;
    g.fillRect(x, h / 2 - y, 1, Math.max(1, y * 2));
  }
}

function pintarP() {
  const scroll = $('pScroll');
  const finVisible = Math.max(finProyecto() + 30, scroll.clientWidth / P.zoom);
  // Los navegadores no dibujan lienzos de más de ~30000 px: limitamos el zoom
  if (finVisible * P.zoom > 30000) { P.zoom = Math.floor(30000 / finVisible); $('pZoom').value = P.zoom; }
  const ancho = Math.ceil(finVisible * P.zoom);
  $('pContenido').style.width = ancho + 'px';
  $('pContenido').style.setProperty('--px-seg', P.zoom + 'px');
  dibujarRegla(ancho);

  document.querySelectorAll('.carril').forEach(c => { c.innerHTML = ''; });
  for (const c of P.clips) {
    const div = el('div', { className: `clip-audio ${c.pista}` + (c.id === P.sel ? ' seleccionado' : '') });
    div.dataset.id = c.id;
    div.style.left = c.inicio * P.zoom + 'px';
    div.style.width = Math.max(6, c.dur * P.zoom) + 'px';
    const etiqueta = el('div', { className: 'etiqueta', textContent: `${c.procesos.join('')} ${c.nombre}` });
    const lienzoOnda = el('canvas', { width: Math.min(8000, Math.max(1, Math.round(c.dur * P.zoom))), height: 54 });
    dibujarOnda(lienzoOnda, c);
    div.append(etiqueta, lienzoOnda, el('div', { className: 'asa izq' }), el('div', { className: 'asa der' }));
    document.querySelector(`.carril[data-pista="${c.pista}"]`).append(div);
  }
  posicionarCabezal();
  actualizarPanelClip();
}

function dibujarRegla(ancho) {
  const r = $('pRegla');
  r.width = ancho;
  const g = r.getContext('2d');
  g.fillStyle = '#fbf3f0';
  g.fillRect(0, 0, ancho, r.height);
  const intervalo = [1, 2, 5, 10, 15, 30, 60, 120].find(i => i * P.zoom >= 60) || 300;
  g.fillStyle = '#7a6a6c';
  g.strokeStyle = '#d9c7c1';
  g.font = '11px system-ui, sans-serif';
  const total = ancho / P.zoom;
  for (let s = 0; s <= total; s++) {
    const x = Math.round(s * P.zoom) + 0.5;
    const grande = s % intervalo === 0;
    if (!grande && P.zoom < 8) continue;
    g.beginPath();
    g.moveTo(x, r.height);
    g.lineTo(x, grande ? 8 : 20);
    g.stroke();
    if (grande) g.fillText(formatear(s), x + 3, 12);
  }
}

function posicionarCabezal() {
  $('pCabezal').style.left = P.cabezal * P.zoom + 'px';
  $('pTiempo').textContent = `${formatear(P.cabezal, true)} / ${formatear(finProyecto())}`;
}

/* =========================================================
   RATÓN: seleccionar, mover, recortar, mover la línea roja
   ========================================================= */
let arrastre = null;

$('pContenido').addEventListener('pointerdown', e => {
  const x = e.clientX - $('pContenido').getBoundingClientRect().left;
  const div = e.target.closest('.clip-audio');
  if (!div) {
    // Clic en la regla o en un hueco: mover la línea roja
    P.cabezal = Math.max(0, x / P.zoom);
    if (e.target.closest('.carril')) P.sel = null;
    pintarP();
    refrescarSiSuena();
    return;
  }
  const c = P.clips.find(k => k.id === +div.dataset.id);
  P.sel = c.id;
  document.querySelectorAll('.clip-audio').forEach(d => d.classList.toggle('seleccionado', d === div));
  actualizarPanelClip();
  const tipo = e.target.classList.contains('izq') ? 'izq' : e.target.classList.contains('der') ? 'der' : 'mover';
  arrastre = { tipo, c, div, x0: e.clientX, inicio0: c.inicio, offset0: c.offset, dur0: c.dur, antes: foto(), movido: false };
  e.preventDefault();
});

window.addEventListener('pointermove', e => {
  if (!arrastre) return;
  const a = arrastre, c = a.c;
  const dx = (e.clientX - a.x0) / P.zoom;
  if (Math.abs(e.clientX - a.x0) > 3) a.movido = true;
  if (!a.movido && a.tipo === 'mover') {
    // también puede moverse solo de pista
    const bajo = document.elementFromPoint(e.clientX, e.clientY);
    if (!bajo || !bajo.closest('.carril') || bajo.closest('.carril').dataset.pista === c.pista) return;
    a.movido = true;
  }
  if (a.tipo === 'mover') {
    let nuevo = Math.max(0, a.inicio0 + dx);
    // Imán: se pega al inicio, a la línea roja y a los bordes de otros trozos
    const imanes = [0, P.cabezal];
    P.clips.forEach(k => { if (k !== c) imanes.push(k.inicio, k.inicio + k.dur); });
    for (const m of imanes) {
      if (Math.abs(nuevo - m) * P.zoom < 8) { nuevo = m; break; }
      if (Math.abs(nuevo + c.dur - m) * P.zoom < 8) { nuevo = m - c.dur; break; }
    }
    c.inicio = Math.max(0, nuevo);
    a.div.style.left = c.inicio * P.zoom + 'px';
    const bajo = document.elementFromPoint(e.clientX, e.clientY);
    const carril = bajo && bajo.closest('.carril');
    if (carril && carril.dataset.pista !== c.pista) {
      c.pista = carril.dataset.pista;
      carril.append(a.div);
      a.div.className = `clip-audio ${c.pista} seleccionado`;
    }
  } else if (a.tipo === 'izq') {
    let delta = Math.max(-a.offset0, Math.min(a.dur0 - 0.1, dx));
    delta = Math.max(delta, -a.inicio0);
    c.offset = a.offset0 + delta;
    c.inicio = a.inicio0 + delta;
    c.dur = a.dur0 - delta;
    a.div.style.left = c.inicio * P.zoom + 'px';
    a.div.style.width = c.dur * P.zoom + 'px';
  } else {
    c.dur = Math.max(0.1, Math.min(c.buffer.duration - c.offset, a.dur0 + dx));
    a.div.style.width = c.dur * P.zoom + 'px';
  }
});

window.addEventListener('pointerup', () => {
  if (!arrastre) return;
  const a = arrastre;
  arrastre = null;
  if (a.movido) {
    P.historial.push(a.antes);
    pintarP();
    refrescarSiSuena();
  }
});

/* =========================================================
   PANEL DEL TROZO SELECCIONADO
   ========================================================= */
function actualizarPanelClip() {
  const c = clipSel();
  $('pSinSeleccion').hidden = !!c;
  $('pAjustesClip').hidden = !c;
  if (!c) return;
  if (document.activeElement !== $('pNombreClip')) $('pNombreClip').value = c.nombre;
  $('pVolClip').value = Math.round(c.vol * 100);
  $('pValVol').textContent = Math.round(c.vol * 100);
  $('pFadeIn').value = c.fadeIn;
  $('pValFIn').textContent = c.fadeIn.toFixed(1);
  $('pFadeOut').value = c.fadeOut;
  $('pValFOut').textContent = c.fadeOut.toFixed(1);
  $('pOriginal').disabled = !c.original;
  $('pProcesos').textContent = c.procesos.length
    ? 'Aplicado: ' + c.procesos.map(p => p === '🔊' ? '🔊 volumen nivelado' : '🧹 ruido quitado').join(', ')
    : `Duración: ${c.dur.toFixed(1)} s`;
}

/* Cuando se toca un deslizador, se guarda el estado una sola vez para poder deshacer */
function conHistorial(input, aplicar) {
  let guardado = false;
  input.addEventListener('input', () => {
    const c = clipSel();
    if (!c) return;
    if (!guardado) { guardarHistorial(); guardado = true; }
    aplicar(c, input.value);
    pintarP();
  });
  input.addEventListener('change', () => { guardado = false; refrescarSiSuena(); });
}
conHistorial($('pVolClip'), (c, v) => { c.vol = v / 100; });
conHistorial($('pFadeIn'), (c, v) => { c.fadeIn = Math.min(+v, c.dur / 2); });
conHistorial($('pFadeOut'), (c, v) => { c.fadeOut = Math.min(+v, c.dur / 2); });
conHistorial($('pNombreClip'), (c, v) => { c.nombre = v; });

async function procesar(c, tipo) {
  const ocupado = [$('pNivelar'), $('pQuitarRuido'), $('pNivelarVoces')];
  ocupado.forEach(b => { b.disabled = true; });
  $('pProgreso').hidden = false;
  await esperar(30);
  try {
    if (!c.original) c.original = c.buffer;
    if (tipo === 'nivelar') {
      $('pEstado').textContent = '🔊 Nivelando el volumen...';
      c.buffer = nivelarVolumen(c.buffer);
      c.procesos.push('🔊');
    } else {
      $('pEstado').textContent = '🧹 Quitando ruido... (puede tardar un poco)';
      c.buffer = await quitarRuido(c.buffer, $('pIntensidad').value, p => { $('pProgreso').value = p * 100; });
      c.procesos.push('🧹');
    }
    $('pEstado').textContent = '✅ Hecho';
  } catch (e) {
    $('pEstado').textContent = 'No se ha podido procesar el audio.';
  }
  $('pProgreso').hidden = true;
  ocupado.forEach(b => { b.disabled = false; });
  pintarP();
  refrescarSiSuena();
}

$('pNivelar').addEventListener('click', () => { const c = clipSel(); if (c) { guardarHistorial(); procesar(c, 'nivelar'); } });
$('pQuitarRuido').addEventListener('click', () => { const c = clipSel(); if (c) { guardarHistorial(); procesar(c, 'ruido'); } });
$('pOriginal').addEventListener('click', () => {
  const c = clipSel();
  if (!c || !c.original) return;
  guardarHistorial();
  c.buffer = c.original;
  c.original = null;
  c.procesos = [];
  pintarP();
});

/* Igualar todas las voces al mismo nivel */
$('pNivelarVoces').addEventListener('click', async () => {
  const voces = P.clips.filter(c => c.pista === 'voces');
  if (!voces.length) return avisar('No hay nada en la pista de Voces');
  guardarHistorial();
  $('pNivelarVoces').disabled = true;
  $('pEstado').textContent = '🔊 Igualando las voces...';
  await esperar(30);
  const hechos = new Map();   // trozos cortados del mismo audio se procesan una sola vez
  for (const c of voces) {
    if (!hechos.has(c.buffer)) hechos.set(c.buffer, nivelarVolumen(c.buffer));
    if (!c.original) c.original = c.buffer;
    c.buffer = hechos.get(c.buffer);
    if (!c.procesos.includes('🔊')) c.procesos.push('🔊');
    await esperar(0);
  }
  $('pNivelarVoces').disabled = false;
  $('pEstado').textContent = '✅ Todas las voces tienen ahora un volumen parecido.';
  pintarP();
  refrescarSiSuena();
});

/* =========================================================
   CORTAR, BORRAR, DESHACER
   ========================================================= */
function foto() { return P.clips.map(c => ({ ...c, procesos: [...c.procesos] })); }
function guardarHistorial() {
  P.historial.push(foto());
  if (P.historial.length > 60) P.historial.shift();
}

function cortar() {
  const t = P.cabezal;
  const candidatos = clipSel() ? [clipSel()] : P.clips;
  const aCortar = candidatos.filter(c => t > c.inicio + 0.05 && t < c.inicio + c.dur - 0.05);
  if (!aCortar.length) return avisar('Pon la línea roja encima del trozo que quieres cortar');
  guardarHistorial();
  aCortar.forEach(c => {
    const corte = t - c.inicio;
    P.clips.push({ ...c, id: P.idSig++, inicio: t, offset: c.offset + corte, dur: c.dur - corte, fadeIn: 0, procesos: [...c.procesos], entradilla: undefined });
    c.dur = corte;
    c.fadeOut = 0;
  });
  pintarP();
  avisar('✂️ Cortado');
}

function borrar() {
  const c = clipSel();
  if (!c) return avisar('Primero pulsa el trozo que quieres borrar');
  guardarHistorial();
  P.clips = P.clips.filter(k => k !== c);
  P.sel = null;
  pintarP();
  refrescarSiSuena();
}

function deshacer() {
  const anterior = P.historial.pop();
  if (!anterior) return avisar('No hay nada que deshacer');
  P.clips = anterior;
  if (!clipSel()) P.sel = null;
  pintarP();
  refrescarSiSuena();
}

$('pCortar').addEventListener('click', cortar);
$('pBorrar').addEventListener('click', borrar);
$('pDeshacer').addEventListener('click', deshacer);

document.addEventListener('keydown', e => {
  if (!$('panelPodcast').classList.contains('activo')) return;
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('pPlay').click(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); borrar(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
  else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) cortar();
});

$('pZoom').addEventListener('input', () => { P.zoom = +$('pZoom').value; pintarP(); });
window.addEventListener('resize', () => { if ($('panelPodcast').classList.contains('activo')) pintarP(); });

/* =========================================================
   SONAR: programar cada trozo con su volumen y fundidos
   (lo mismo sirve para escuchar y para exportar)
   ========================================================= */
function programarClip(ac, destino, c, origen, desde, volPista) {
  const fin = c.inicio + c.dur;
  if (fin <= desde) return null;
  const src = ac.createBufferSource();
  src.buffer = c.buffer;
  const g = ac.createGain();
  src.connect(g);
  g.connect(destino);
  const fIn = Math.min(c.fadeIn, c.dur / 2), fOut = Math.min(c.fadeOut, c.dur / 2);
  const valor = tl => {
    const local = tl - c.inicio;
    let f = 1;
    if (fIn > 0 && local < fIn) f = local / fIn;
    if (fOut > 0 && local > c.dur - fOut) f = Math.min(f, (c.dur - local) / fOut);
    return c.vol * volPista * Math.max(0, f);
  };
  const aCtx = tl => origen + (tl - desde);
  const empieza = Math.max(desde, c.inicio);
  g.gain.setValueAtTime(valor(empieza), aCtx(empieza));
  [c.inicio + fIn, fin - fOut, fin].filter(p => p > empieza).sort((a, b) => a - b)
    .forEach(p => g.gain.linearRampToValueAtTime(valor(p), aCtx(p)));
  const salto = empieza - c.inicio;
  src.start(aCtx(empieza), c.offset + salto, c.dur - salto);
  return src;
}

function reproducirP(desde) {
  const ac = obtenerAudioCtx();
  if (!mezclaP) { mezclaP = ac.createGain(); mezclaP.connect(ac.destination); }
  const origen = ac.currentTime + 0.05;
  P.fuentes = P.clips.map(c => {
    const p = pistaDe(c.pista);
    return p.mute ? null : programarClip(ac, mezclaP, c, origen, desde, p.vol);
  }).filter(Boolean);
  P.origen = origen;
  P.desde = desde;
  P.reproduciendo = true;
  $('pPlay').textContent = '⏸ Pausa';
  requestAnimationFrame(bucleP);
}

function bucleP() {
  if (!P.reproduciendo) return;
  const t = Math.max(P.desde, P.desde + audioCtx.currentTime - P.origen);
  P.cabezal = t;
  posicionarCabezal();
  const scroll = $('pScroll'), px = t * P.zoom;
  if (px > scroll.scrollLeft + scroll.clientWidth - 60) scroll.scrollLeft = px - 100;
  if (t > finProyecto() + 0.1) { pararP(); return; }
  requestAnimationFrame(bucleP);
}

function pararP() {
  P.fuentes.forEach(s => { try { s.stop(); } catch (e) {} });
  P.fuentes = [];
  P.reproduciendo = false;
  $('pPlay').textContent = '▶ Reproducir';
}

/* Si algo cambia mientras suena, se vuelve a programar desde donde iba */
function refrescarSiSuena() {
  if (!P.reproduciendo) return;
  const t = P.cabezal;
  pararP();
  reproducirP(t);
}

$('pPlay').addEventListener('click', () => {
  if (P.reproduciendo) return pararP();
  if (!P.clips.length) return avisar('Añade o graba algún audio primero');
  if (P.cabezal >= finProyecto()) P.cabezal = 0;
  reproducirP(P.cabezal);
});
$('pStop').addEventListener('click', () => {
  pararP();
  P.cabezal = 0;
  $('pScroll').scrollLeft = 0;
  posicionarCabezal();
});

/* =========================================================
   EXPORTAR EL PODCAST
   ========================================================= */
async function mezclarPodcast() {
  const sr = obtenerAudioCtx().sampleRate;
  const off = new OfflineAudioContext(2, Math.ceil(finProyecto() * sr) + 1, sr);
  P.clips.forEach(c => {
    const p = pistaDe(c.pista);
    if (!p.mute) programarClip(off, off.destination, c, 0, 0, p.vol);
  });
  return off.startRendering();
}

$('pExportar').addEventListener('click', async () => {
  if (!P.clips.length) return avisar('El podcast está vacío');
  $('pExportar').disabled = true;
  $('pProgreso').hidden = false;
  $('pProgreso').value = 0;
  $('pEstado').textContent = '🎚️ Mezclando las pistas...';
  try {
    let buffer = await mezclarPodcast();
    if ($('pNormalizar').checked) { limitar(buffer, 0.95); normalizarPico(buffer, -1); }
    $('pEstado').textContent = '💾 Creando el archivo...';
    await exportarAudio(buffer, $('pFormato').value, 'podcast-radio-pikota', p => { $('pProgreso').value = p * 100; });
    $('pEstado').textContent = '✅ ¡Podcast descargado!';
    avisar('✅ Podcast exportado', 'ok');
  } catch (e) {
    $('pEstado').textContent = 'Algo ha fallado al exportar.';
  }
  $('pProgreso').hidden = true;
  $('pExportar').disabled = false;
});

/* ---------- Arranque ---------- */
construirPistas();
pintarP();
