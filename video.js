/* =========================================================
   PESTAÑA VÍDEO
   - Varios clips con recorte y transiciones entre ellos
   - Cortinilla de Radio Pikota con la entradilla al inicio/final
   - Filtros, velocidad, título y logos
   - Exportar vídeo, exportar solo audio o enviarlo al podcast
   ========================================================= */

const V = {
  clips: [],            // los vídeos del montaje
  sel: null,            // id del clip seleccionado
  entInicio: false,     // entradilla al inicio
  entFinal: false,      // entradilla al final
  reproduciendo: false,
  exportando: false,
  cancelado: false,
  plan: null,           // orden y tiempos de todo el montaje
  origen: 0, desde: 0,  // para saber en qué segundo vamos
  extras: [],           // sonidos de la entradilla en marcha
  grabador: null,
  idSig: 1
};
const lienzo = $('lienzoVideo');
const ctxV = lienzo.getContext('2d');

/* Contenedor invisible donde viven los <video> originales */
const almacenVideos = document.createElement('div');
almacenVideos.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
document.body.append(almacenVideos);

/* Mezclador de sonido de la pestaña vídeo */
let mezclaV = null, destinoV = null;
function asegurarAudioVideo() {
  const ac = obtenerAudioCtx();
  if (!mezclaV) {
    mezclaV = ac.createGain();
    mezclaV.connect(ac.destination);          // para oírlo
    destinoV = ac.createMediaStreamDestination();
    mezclaV.connect(destinoV);                // para grabarlo al exportar
  }
  return ac;
}

/* Pequeña ayuda para crear elementos HTML */
function el(etiqueta, props = {}, ...hijos) {
  const e = document.createElement(etiqueta);
  Object.assign(e, props);
  hijos.forEach(h => e.append(h));
  return e;
}

/* Espera a que un vídeo salte al segundo indicado */
function buscar(video, t) {
  return new Promise(res => {
    if (Math.abs(video.currentTime - t) < 0.01) return res();
    const listo = () => { clearTimeout(tope); res(); };
    const tope = setTimeout(() => { video.removeEventListener('seeked', listo); res(); }, 3000);
    video.addEventListener('seeked', listo, { once: true });
    video.currentTime = t;
  });
}

/* =========================================================
   LOGOS (casillas) y logo para la cortinilla
   ========================================================= */
const logoPikota = new Image();
logoPikota.src = LOGOS.find(l => l.nombre === 'Radio Pikota').imagen;

const logosV = LOGOS.map(logo => {
  const img = new Image();
  img.src = logo.imagen;
  const casilla = el('input', { type: 'checkbox' });
  casilla.addEventListener('change', vistaFija);
  $('vListaLogos').append(el('label', { className: 'logo-opcion' }, casilla, el('img', { src: logo.imagen }), logo.nombre));
  return { img, casilla };
});

/* =========================================================
   AÑADIR VÍDEOS
   ========================================================= */
$('vArchivos').addEventListener('change', async () => {
  const archivos = [...$('vArchivos').files];
  $('vArchivos').value = '';
  for (const archivo of archivos) {
    $('vEstado').textContent = `Cargando ${archivo.name}...`;
    try { await agregarClip(archivo); }
    catch (e) { avisar(`No se ha podido abrir ${archivo.name}`, 'error'); }
  }
  $('vEstado').textContent = V.clips.length ? 'Listo. Ajusta el montaje y exporta cuando quieras.' : 'Añade un vídeo para empezar.';
});

async function agregarClip(archivo) {
  const ac = asegurarAudioVideo();
  const video = el('video', { playsInline: true, preload: 'auto', src: URL.createObjectURL(archivo) });
  almacenVideos.append(video);
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = rej; });

  // Algunos vídeos (grabados con el móvil o con webm) no dicen su duración a la primera
  if (!isFinite(video.duration)) {
    video.currentTime = 1e9;
    await new Promise(res => {
      const t = setTimeout(res, 4000);
      video.ondurationchange = () => { if (isFinite(video.duration)) { clearTimeout(t); res(); } };
    });
    await buscar(video, 0);
  }

  // Su sonido pasa por el mezclador (así se puede subir/bajar en las transiciones)
  const fuente = ac.createMediaElementSource(video);
  const ganancia = ac.createGain();
  ganancia.gain.value = 0;
  fuente.connect(ganancia);
  ganancia.connect(mezclaV);

  const duracion = video.duration;
  const clip = {
    id: V.idSig++, archivo, nombre: archivo.name, video, ganancia,
    duracion, ini: 0, fin: +duracion.toFixed(2),
    transicion: 'fundido', miniatura: '', audio: undefined
  };

  // Miniatura
  await buscar(video, Math.min(1, duracion * 0.1));
  const mini = el('canvas', { width: 192, height: 108 });
  dibujarVideoEn(mini.getContext('2d'), video, 192, 108);
  clip.miniatura = mini.toDataURL('image/jpeg', 0.7);
  await buscar(video, 0);
  video.addEventListener('seeked', () => { if (!V.reproduciendo) vistaFija(); });

  V.clips.push(clip);
  if (V.clips.length === 1) ajustarLienzo();
  V.sel = clip.id;
  pintarLista();
  actualizarBotones();
  vistaFija();
}

/* =========================================================
   FORMATO: tamaño del vídeo final según dónde se va a publicar
   ========================================================= */
const FORMATOS = {
  horizontal: { w: 1920, h: 1080, texto: '1920 × 1080 px · ideal para YouTube y para proyectar en clase.' },
  vertical:   { w: 1080, h: 1920, texto: '1080 × 1920 px · ideal para Reels, Historias, TikTok y Shorts. Los logos suben un poco para que no los tapen los botones de la red social.' },
  cuadrado:   { w: 1080, h: 1080, texto: '1080 × 1080 px · publicación cuadrada de Instagram.' },
  retrato:    { w: 1080, h: 1350, texto: '1080 × 1350 px · publicación vertical de Instagram.' }
};

function ajustarLienzo() {
  const f = FORMATOS[$('vFormato').value];
  let w, h;
  if (f) { w = f.w; h = f.h; }
  else {
    // "Igual que el primer vídeo" (como mucho 1920 px por el lado largo)
    const v = V.clips[0] ? V.clips[0].video : null;
    w = v && v.videoWidth ? v.videoWidth : 1920;
    h = v && v.videoHeight ? v.videoHeight : 1080;
    const e = Math.min(1, 1920 / Math.max(w, h));
    w *= e; h *= e;
  }
  lienzo.width = Math.round(w / 2) * 2;
  lienzo.height = Math.round(h / 2) * 2;
  $('vInfoFormato').textContent = f ? f.texto : `${lienzo.width} × ${lienzo.height} px · la forma del primer vídeo.`;
}
$('vFormato').addEventListener('change', () => { ajustarLienzo(); vistaFija(); });
$('vEncaje').addEventListener('change', vistaFija);

/* En vertical, Instagram y TikTok tapan la parte de abajo con sus botones */
const esVertical = () => lienzo.height > lienzo.width * 1.5;

/* =========================================================
   LISTA DE CLIPS (ordenar, recortar, transiciones)
   ========================================================= */
const TRANSICIONES = [
  ['fundido', 'Fundido'], ['negro', 'Fundido a negro'], ['deslizar', 'Deslizar'], ['zoom', 'Zoom'], ['ninguna', 'Corte directo']
];

function pintarLista() {
  const cont = $('vListaClips');
  cont.innerHTML = '';
  V.clips.forEach((c, i) => {
    if (i > 0) {
      const sel = el('select');
      TRANSICIONES.forEach(([v, t]) => sel.append(el('option', { value: v, textContent: t })));
      sel.value = c.transicion;
      sel.addEventListener('change', () => { c.transicion = sel.value; actualizarTiempo(0); });
      cont.append(el('div', { className: 'transicion-entre' }, '🔀 Transición:', sel));
    }

    const subir = el('button', { textContent: '▲', title: 'Subir', disabled: i === 0, className: 'secundario' });
    const bajar = el('button', { textContent: '▼', title: 'Bajar', disabled: i === V.clips.length - 1, className: 'secundario' });
    const quitar = el('button', { textContent: '✕', title: 'Quitar clip', className: 'secundario' });
    subir.onclick = e => { e.stopPropagation(); mover(i, -1); };
    bajar.onclick = e => { e.stopPropagation(); mover(i, 1); };
    quitar.onclick = e => { e.stopPropagation(); quitarClip(i); };

    const tarjeta = el('div', { className: 'clip-video' + (c.id === V.sel ? ' seleccionado' : '') },
      el('img', { src: c.miniatura }),
      el('div', {},
        el('div', { className: 'nombre', textContent: `${i + 1}. ${c.nombre}` }),
        el('div', { className: 'info', textContent: `Usas de ${c.ini.toFixed(1)} s a ${c.fin.toFixed(1)} s (de ${c.duracion.toFixed(1)} s)` })
      ),
      el('div', { className: 'acciones' }, subir, bajar, quitar)
    );

    if (c.id === V.sel) {
      const ini = el('input', { type: 'range', min: 0, max: c.duracion.toFixed(1), step: 0.1, value: c.ini });
      const fin = el('input', { type: 'range', min: 0, max: c.duracion.toFixed(1), step: 0.1, value: c.fin });
      const vIni = el('b', { textContent: c.ini.toFixed(1) }), vFin = el('b', { textContent: c.fin.toFixed(1) });
      ini.addEventListener('input', () => {
        c.ini = Math.min(+ini.value, c.fin - 0.2); ini.value = c.ini; vIni.textContent = c.ini.toFixed(1);
        if (!V.reproduciendo) c.video.currentTime = c.ini;
        actualizarTiempo(0);
      });
      fin.addEventListener('input', () => {
        c.fin = Math.max(+fin.value, c.ini + 0.2); fin.value = c.fin; vFin.textContent = c.fin.toFixed(1);
        if (!V.reproduciendo) c.video.currentTime = c.fin;
        actualizarTiempo(0);
      });
      ini.addEventListener('change', pintarLista);
      fin.addEventListener('change', pintarLista);
      tarjeta.append(el('div', { className: 'recorte' },
        el('label', {}, '✂️ Inicio: ', vIni, ' s', ini),
        el('label', {}, '✂️ Fin: ', vFin, ' s', fin)));
    }

    tarjeta.addEventListener('click', e => {
      if (e.target.closest('input, button, select') || V.sel === c.id) return;
      V.sel = c.id;
      pintarLista();
      if (!V.reproduciendo) c.video.currentTime = c.ini;
    });
    cont.append(tarjeta);
  });
  actualizarTiempo(0);
}

function mover(i, dir) {
  const j = i + dir;
  [V.clips[i], V.clips[j]] = [V.clips[j], V.clips[i]];
  if (i === 0 || j === 0) ajustarLienzo();
  pintarLista();
}

function quitarClip(i) {
  if (V.reproduciendo) detener();
  const [c] = V.clips.splice(i, 1);
  c.video.pause();
  c.ganancia.disconnect();
  URL.revokeObjectURL(c.video.src);
  c.video.remove();
  if (V.sel === c.id) V.sel = V.clips[0] ? V.clips[0].id : null;
  if (i === 0) ajustarLienzo();
  pintarLista();
  actualizarBotones();
  vistaFija();
}

function actualizarBotones() {
  const hay = V.clips.length > 0, ocupado = V.exportando;
  $('vPlay').disabled = !hay || ocupado;
  $('vStop').disabled = !hay;
  $('vExportar').disabled = !hay || ocupado || V.reproduciendo;
  $('vExportarAudio').disabled = !hay || ocupado;
  $('vEnviarPodcast').disabled = !hay || ocupado;
  $('vArchivos').disabled = ocupado;
}

/* =========================================================
   PLAN DEL MONTAJE: en qué segundo empieza cada cosa
   ========================================================= */
function calcularPlan() {
  const vel = +$('vVelocidad').value;
  const T = +$('vDurTrans').value;
  const ent = entradillaBuffer ? entradillaBuffer.duration : 0;
  const items = [];
  let t = 0;

  if (V.entInicio && ent) { items.push({ tipo: 'cortinilla', inicio: 0, dur: ent, tr: null }); t = ent; }

  V.clips.forEach((c, i) => {
    const dur = (c.fin - c.ini) / vel;
    let tr = null;
    const prev = items[items.length - 1];
    if (prev) {
      const tipo = i === 0 ? 'fundido' : c.transicion;   // tras la cortinilla, siempre fundido
      const base = i === 0 ? 0.8 : T;
      if (tipo === 'negro') tr = { tipo, d: Math.min(base / 2, dur / 2, prev.dur / 2) };
      else if (tipo !== 'ninguna') tr = { tipo, d: Math.min(base, dur / 2, prev.dur / 2) };
    }
    const solape = tr && tr.tipo !== 'negro' ? tr.d : 0;
    const item = { tipo: 'clip', clip: c, inicio: t - solape, dur, tr };
    items.push(item);
    t = item.inicio + dur;
  });

  if (V.entFinal && ent && items.length) {
    const prev = items[items.length - 1];
    const d = Math.min(0.8, prev.dur / 2);
    items.push({ tipo: 'cortinilla', inicio: t - d, dur: ent, tr: { tipo: 'fundido', d } });
    t = t - d + ent;
  }
  items.forEach((it, i) => { it.sig = items[i + 1] || null; });
  return { items, total: t, vel };
}

/* Cómo se ve y se oye cada elemento en el segundo t (transiciones) */
function factores(it, t) {
  const local = t - it.inicio;
  let alfa = 1, negro = 0, dx = 0, esc = 1, vol = 1;
  if (it.tr && local < it.tr.d) {
    const p = Math.max(0, local / it.tr.d);
    vol = p;
    if (it.tr.tipo === 'fundido') alfa = p;
    else if (it.tr.tipo === 'negro') negro = 1 - p;
    else if (it.tr.tipo === 'deslizar') dx = 1 - p;
    else if (it.tr.tipo === 'zoom') { esc = 1.3 - 0.3 * p; alfa = p; }
  }
  const sig = it.sig, restante = it.inicio + it.dur - t;
  if (sig && sig.tr && restante < sig.tr.d) {
    const q = Math.max(0, restante / sig.tr.d);
    vol *= q;
    if (sig.tr.tipo === 'negro') negro = Math.max(negro, 1 - q);
  }
  return { alfa, negro, dx, esc, vol };
}

/* =========================================================
   DIBUJAR
   ========================================================= */
function filtroCSS() {
  return `brightness(${$('vBrillo').value}%) contrast(${$('vContraste').value}%) ` +
         `saturate(${$('vSaturacion').value}%) grayscale(${$('vBN').value}%)`;
}

/* Dibuja un vídeo en el lienzo sin deformarlo:
   - bandas: se ve entero, con bandas negras
   - rellenar: ocupa todo y se recortan los bordes
   - difuminado: se ve entero sobre una copia ampliada y borrosa */
const lienzoBorroso = document.createElement('canvas');
function dibujarVideoEn(c, video, W, H, modo = 'bandas') {
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  if (!video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const cubrir = Math.max(W / vw, H / vh), encajar = Math.min(W / vw, H / vh);
  if (modo === 'rellenar') {
    c.drawImage(video, (W - vw * cubrir) / 2, (H - vh * cubrir) / 2, vw * cubrir, vh * cubrir);
    return;
  }
  if (modo === 'difuminado' && Math.abs(cubrir - encajar) > 0.01) {
    // Truco rápido para difuminar: se dibuja muy pequeño y luego se amplía
    lienzoBorroso.width = Math.max(8, Math.round(W / 24));
    lienzoBorroso.height = Math.max(8, Math.round(H / 24));
    const b = lienzoBorroso.getContext('2d');
    const e = cubrir / 24;
    b.drawImage(video, (lienzoBorroso.width - vw * e) / 2, (lienzoBorroso.height - vh * e) / 2, vw * e, vh * e);
    c.save();
    c.imageSmoothingQuality = 'high';
    c.drawImage(lienzoBorroso, 0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, W, H);
    c.restore();
  }
  c.drawImage(video, (W - vw * encajar) / 2, (H - vh * encajar) / 2, vw * encajar, vh * encajar);
}

function dibujarCortinilla(local) {
  const W = lienzo.width, H = lienzo.height, c = ctxV;
  c.fillStyle = '#FDF9F6';
  c.fillRect(0, 0, W, H);
  // Manchas de acuarela
  [[0.15, 0.25, '191,72,88'], [0.85, 0.2, '200,142,59'], [0.82, 0.82, '140,146,71'], [0.18, 0.8, '203,95,53']].forEach(([x, y, col]) => {
    const g = c.createRadialGradient(x * W, y * H, 0, x * W, y * H, W * 0.35);
    g.addColorStop(0, `rgba(${col},0.25)`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  });
  // Ondas de sonido animadas con el degradado del logo
  const grad = c.createLinearGradient(0, 0, W, 0);
  ['#A3414D', '#BF4858', '#CB5F35', '#C88E3B', '#8C9247'].forEach((col, i) => grad.addColorStop(i / 4, col));
  c.save();
  c.globalAlpha *= 0.35;
  c.fillStyle = grad;
  const barras = W > H ? 56 : 28, bw = W / barras * 0.45;
  for (let i = 0; i < barras; i++) {
    const x = W * (i + 0.5) / barras;
    const h = H * (0.05 + 0.3 * Math.abs(Math.sin(local * 3.2 + i * 0.55)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.23 + local))));
    c.fillRect(x - bw / 2, H * 0.48 - h / 2, bw, h);
  }
  c.restore();
  // Logo que aparece con un pequeño "pop"
  if (logoPikota.complete && logoPikota.naturalWidth) {
    const a = Math.min(1, local / 0.6);
    const esc = 0.85 + 0.15 * (1 - Math.pow(1 - a, 3));
    let lw = W * 0.55 * esc, lh = lw * logoPikota.naturalHeight / logoPikota.naturalWidth;
    if (lh > H * 0.7 * esc) { lh = H * 0.7 * esc; lw = lh * logoPikota.naturalWidth / logoPikota.naturalHeight; }
    c.save();
    c.globalAlpha *= a;
    c.drawImage(logoPikota, (W - lw) / 2, (H - lh) / 2 - H * 0.04, lw, lh);
    c.fillStyle = '#7a6a6c';
    c.font = `600 ${Math.round(Math.min(W, H) / 26)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.fillText('IES Valle del Jerte', W / 2, H * 0.9);
    c.restore();
  }
}

/* Título y logos encima del vídeo */
function dibujarSuperpuestos() {
  const W = lienzo.width, H = lienzo.height, c = ctxV;
  const arribaLogos = dibujarLogos();
  const texto = $('vTitulo').value.trim();
  if (texto) {
    // El tamaño depende del lado corto y se reduce si el título no cabe
    let tam = Math.round(Math.min(W, H) / 12);
    c.font = `bold ${tam}px system-ui, sans-serif`;
    while (c.measureText(texto).width > W * 0.9 && tam > 12) {
      tam = Math.round(tam * 0.9);
      c.font = `bold ${tam}px system-ui, sans-serif`;
    }
    c.textAlign = 'center';
    c.lineWidth = tam / 8;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.fillStyle = $('vColorTitulo').value;
    const margenVertical = esVertical() ? H * 0.12 : 0;   // zona que tapan las redes en vertical
    let y = $('vPosTitulo').value === 'arriba' ? tam * 1.4 + (esVertical() ? H * 0.08 : 0) : H - tam * 0.8 - margenVertical;
    if ($('vPosTitulo').value === 'abajo') y = Math.min(y, arribaLogos - tam * 0.4);
    c.strokeText(texto, W / 2, y);
    c.fillText(texto, W / 2, y);
  }
}

function dibujarLogos() {
  const W = lienzo.width, H = lienzo.height, c = ctxV;
  const elegidos = logosV.filter(l => l.casilla.checked && l.img.complete);
  if (!elegidos.length) return H;
  const base = Math.min(W, H);
  const alto = base * $('vTamLogo').value / 100;
  const margen = base * 0.03, hueco = alto * 0.15, relleno = alto * 0.1;
  const anchos = elegidos.map(l => alto * l.img.naturalWidth / l.img.naturalHeight);
  const anchoTotal = anchos.reduce((a, b) => a + b, 0) + hueco * (elegidos.length - 1);
  let x = W - margen - relleno - anchoTotal;
  const y = H - margen - relleno - alto - (esVertical() ? H * 0.12 : 0);
  if ($('vFondoLogo').checked) {
    c.fillStyle = 'rgba(255,255,255,0.88)';
    c.beginPath();
    c.roundRect(x - relleno, y - relleno, anchoTotal + relleno * 2, alto + relleno * 2, relleno);
    c.fill();
  }
  elegidos.forEach((l, i) => { c.drawImage(l.img, x, y, anchos[i], alto); x += anchos[i] + hueco; });
  return y - relleno;
}

/* Dibuja el montaje completo en el segundo t */
function dibujarFotograma(t) {
  const W = lienzo.width, H = lienzo.height;
  ctxV.fillStyle = '#000';
  ctxV.fillRect(0, 0, W, H);
  const activos = V.plan.items.filter(it => t >= it.inicio && t < it.inicio + it.dur);
  let hayClip = false;
  for (const it of activos) {
    const f = factores(it, t);
    ctxV.save();
    ctxV.globalAlpha = f.alfa;
    if (f.dx || f.esc !== 1) {
      ctxV.translate(W / 2 + f.dx * W, H / 2);
      ctxV.scale(f.esc, f.esc);
      ctxV.translate(-W / 2, -H / 2);
    }
    if (it.tipo === 'clip') {
      ctxV.filter = filtroCSS();
      dibujarVideoEn(ctxV, it.clip.video, W, H, $('vEncaje').value);
      ctxV.filter = 'none';
      hayClip = true;
    } else {
      dibujarCortinilla(t - it.inicio);
    }
    ctxV.restore();
    if (f.negro > 0) { ctxV.fillStyle = `rgba(0,0,0,${f.negro})`; ctxV.fillRect(0, 0, W, H); }
  }
  if (hayClip) dibujarSuperpuestos();
}

/* Vista quieta (cuando no se reproduce): el clip elegido con sus efectos */
function vistaFija() {
  if (V.reproduciendo) return;
  const c = V.clips.find(x => x.id === V.sel);
  if (!c) { dibujarCortinilla(2); return; }
  ctxV.filter = filtroCSS();
  dibujarVideoEn(ctxV, c.video, lienzo.width, lienzo.height, $('vEncaje').value);
  ctxV.filter = 'none';
  dibujarSuperpuestos();
}
['vBrillo', 'vContraste', 'vSaturacion', 'vBN', 'vTitulo', 'vColorTitulo', 'vPosTitulo', 'vTamLogo', 'vFondoLogo']
  .forEach(id => $(id).addEventListener('input', vistaFija));
$('vResetFiltros').addEventListener('click', () => {
  $('vBrillo').value = $('vContraste').value = $('vSaturacion').value = 100;
  $('vBN').value = 0;
  vistaFija();
});
$('vDurTrans').addEventListener('input', () => { $('vValTrans').textContent = (+$('vDurTrans').value).toFixed(1); actualizarTiempo(0); });
$('vVelocidad').addEventListener('change', () => actualizarTiempo(0));
logoPikota.onload = vistaFija;

function actualizarTiempo(t) {
  const plan = calcularPlan();
  $('vTiempo').textContent = `${formatear(t)} / ${formatear(plan.total)}`;
  $('vBarraRelleno').style.width = plan.total ? `${Math.min(100, t / plan.total * 100)}%` : '0';
}

/* =========================================================
   ENTRADILLA (botones de activar/desactivar)
   ========================================================= */
async function alternarEntradilla(cual, boton) {
  await obtenerEntradilla();
  V[cual] = !V[cual];
  boton.classList.toggle('activo', V[cual]);
  actualizarTiempo(0);
  avisar(V[cual] ? '🍒 Entradilla añadida' : 'Entradilla quitada');
}
$('vEntInicio').addEventListener('click', e => alternarEntradilla('entInicio', e.currentTarget));
$('vEntFinal').addEventListener('click', e => alternarEntradilla('entFinal', e.currentTarget));

/* =========================================================
   REPRODUCIR
   ========================================================= */
async function prepararDesde(t) {
  for (const it of V.plan.items) {
    if (it.tipo !== 'clip') continue;
    const v = it.clip.video;
    v.pause();
    v.playbackRate = V.plan.vel;
    it.clip.ganancia.gain.value = 0;
    const objetivo = Math.min(it.clip.fin, it.clip.ini + Math.max(0, t - it.inicio) * V.plan.vel);
    await buscar(v, objetivo);
  }
}

function tiempoActual() { return V.desde + (audioCtx.currentTime - V.origen); }

async function reproducir(desde = 0, alEmpezar = null) {
  if (!V.clips.length) return;
  const ac = asegurarAudioVideo();
  if (V.entInicio || V.entFinal) await obtenerEntradilla();
  V.plan = calcularPlan();
  if (desde >= V.plan.total - 0.05) desde = 0;
  await prepararDesde(desde);
  if (alEmpezar) alEmpezar();

  const origen = ac.currentTime + 0.1;
  V.extras = [];
  for (const it of V.plan.items) {
    if (it.tipo !== 'cortinilla' || desde >= it.inicio + it.dur) continue;
    const s = ac.createBufferSource();
    s.buffer = entradillaBuffer;
    s.connect(mezclaV);
    s.start(origen + Math.max(0, it.inicio - desde), Math.max(0, desde - it.inicio));
    V.extras.push(s);
  }
  V.origen = origen;
  V.desde = desde;
  V.reproduciendo = true;
  $('vPlay').textContent = '⏸ Pausa';
  actualizarBotones();
  requestAnimationFrame(bucleVideo);
}

function bucleVideo() {
  if (!V.reproduciendo) return;
  const t = Math.max(V.desde, tiempoActual());
  const ahora = audioCtx.currentTime;
  for (const it of V.plan.items) {
    if (it.tipo !== 'clip') continue;
    const v = it.clip.video;
    const activo = t >= it.inicio && t < it.inicio + it.dur;
    if (activo) {
      if (v.paused) v.play().catch(() => {});
      const esperado = it.clip.ini + (t - it.inicio) * V.plan.vel;
      if (Math.abs(v.currentTime - esperado) > 0.35) v.currentTime = esperado;
      it.clip.ganancia.gain.setTargetAtTime(factores(it, t).vol, ahora, 0.015);
    } else {
      if (!v.paused) v.pause();
      it.clip.ganancia.gain.setTargetAtTime(0, ahora, 0.015);
    }
  }
  dibujarFotograma(t);
  actualizarTiempo(t);
  if (V.exportando) $('vProgreso').value = t / V.plan.total * 100;
  if (t >= V.plan.total) { V.pausaEn = 0; detener(); return; }
  requestAnimationFrame(bucleVideo);
}

function detener() {
  V.reproduciendo = false;
  V.clips.forEach(c => { c.video.pause(); c.ganancia.gain.value = 0; });
  V.extras.forEach(s => { try { s.stop(); } catch (e) {} });
  V.extras = [];
  $('vPlay').textContent = '▶ Reproducir';
  if (V.exportando && V.grabador && V.grabador.state === 'recording') V.grabador.stop();
  actualizarBotones();
}

$('vPlay').addEventListener('click', () => {
  if (V.reproduciendo) { V.pausaEn = tiempoActual(); detener(); }
  else reproducir(V.pausaEn || 0);
});
$('vStop').addEventListener('click', () => {
  if (V.exportando) V.cancelado = true;
  detener();
  V.pausaEn = 0;
  actualizarTiempo(0);
  vistaFija();
});

/* Pulsar en la barra = saltar a ese momento */
$('vBarra').addEventListener('click', async e => {
  if (!V.clips.length || V.exportando) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (V.entInicio || V.entFinal) await obtenerEntradilla();
  V.plan = calcularPlan();
  const t = (e.clientX - r.left) / r.width * V.plan.total;
  V.pausaEn = t;
  if (V.reproduciendo) { detener(); reproducir(t); }
  else { await prepararDesde(t); dibujarFotograma(t); actualizarTiempo(t); }
});

/* =========================================================
   EXPORTAR VÍDEO (se reproduce el montaje y se graba)
   ========================================================= */
$('vExportar').addEventListener('click', async () => {
  asegurarAudioVideo();
  const flujo = lienzo.captureStream(30);
  destinoV.stream.getAudioTracks().forEach(p => flujo.addTrack(p));
  const formatos = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const tipo = formatos.find(f => MediaRecorder.isTypeSupported(f));
  V.grabador = new MediaRecorder(flujo, { ...(tipo ? { mimeType: tipo } : {}), videoBitsPerSecond: 6000000 });
  const trozos = [];
  V.grabador.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
  V.grabador.onstop = () => {
    V.exportando = false;
    $('vProgreso').hidden = true;
    actualizarBotones();
    if (V.cancelado) { V.cancelado = false; $('vEstado').textContent = 'Exportación cancelada.'; return; }
    const ext = V.grabador.mimeType.includes('mp4') ? 'mp4' : 'webm';
    descargar(new Blob(trozos, { type: V.grabador.mimeType }), `video-radio-pikota-${$('vFormato').value}.${ext}`);
    $('vEstado').textContent = `✅ ¡Hecho! Tu vídeo se ha descargado (${ext.toUpperCase()}).`;
    avisar('✅ Vídeo exportado', 'ok');
  };
  V.exportando = true;
  V.cancelado = false;
  $('vProgreso').hidden = false;
  $('vProgreso').value = 0;
  $('vEstado').textContent = '⏺ Grabando el montaje... no cambies de pestaña ni de ventana hasta que termine.';
  actualizarBotones();
  await reproducir(0, () => V.grabador.start(250));
});

/* =========================================================
   AUDIO DEL MONTAJE (sin vídeo): exportar o enviar al podcast
   ========================================================= */
async function audioDelMontaje() {
  for (const c of V.clips) {
    if (c.audio === undefined) {
      try { c.audio = await decodificar(await c.archivo.arrayBuffer()); }
      catch (e) { c.audio = null; }   // vídeo sin sonido
    }
  }
  if (V.entInicio || V.entFinal) await obtenerEntradilla();
  const plan = calcularPlan();
  const sr = obtenerAudioCtx().sampleRate;
  const off = new OfflineAudioContext(2, Math.ceil(plan.total * sr) + 1, sr);
  for (const it of plan.items) {
    const buffer = it.tipo === 'clip' ? it.clip.audio : entradillaBuffer;
    if (!buffer) continue;
    const s = off.createBufferSource();
    s.buffer = buffer;
    const g = off.createGain();
    s.connect(g); g.connect(off.destination);
    if (it.tipo === 'clip') {
      s.playbackRate.value = plan.vel;
      const fin = it.inicio + it.dur;
      const puntos = [it.inicio, it.inicio + (it.tr ? it.tr.d : 0), fin - (it.sig && it.sig.tr ? it.sig.tr.d : 0), fin];
      let ultimo = it.inicio;
      g.gain.setValueAtTime(factores(it, it.inicio).vol, it.inicio);
      puntos.slice(1).forEach(p => {
        p = Math.max(ultimo, Math.min(fin, p));
        g.gain.linearRampToValueAtTime(factores(it, Math.min(p, fin - 1e-4)).vol, p);
        ultimo = p;
      });
      s.start(it.inicio, it.clip.ini, it.clip.fin - it.clip.ini);
    } else {
      s.start(it.inicio);
    }
  }
  return off.startRendering();
}

$('vExportarAudio').addEventListener('click', async () => {
  $('vEstado').textContent = '🎧 Preparando el audio...';
  $('vProgreso').hidden = false;
  try {
    const buffer = limitar(await audioDelMontaje(), 0.98);
    await exportarAudio(buffer, $('vFormatoAudio').value, 'audio-radio-pikota', p => { $('vProgreso').value = p * 100; });
    $('vEstado').textContent = '✅ Audio descargado.';
    avisar('✅ Audio exportado', 'ok');
  } catch (e) {
    $('vEstado').textContent = 'No se ha podido sacar el audio.';
  }
  $('vProgreso').hidden = true;
});

$('vEnviarPodcast').addEventListener('click', async () => {
  $('vEstado').textContent = '🎙️ Preparando el audio para el podcast...';
  const buffer = await audioDelMontaje();
  podcast.agregarAudio(buffer, 'Audio del vídeo', 'voces');
  $('vEstado').textContent = '✅ Audio enviado a la pestaña Podcast.';
  cambiarPestana('panelPodcast');
  avisar('🎙️ Audio del vídeo añadido al podcast', 'ok');
});

ajustarLienzo();
actualizarTiempo(0);
vistaFija();
