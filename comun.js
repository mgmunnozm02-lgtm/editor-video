/* =========================================================
   COMÚN · Herramientas que usan las dos pestañas
   - Pestañas, avisos, utilidades
   - Procesado de audio: nivelar volumen, quitar ruido, normalizar
   - Exportar a WAV y MP3
   - Sonidos de efectos generados por la propia app
   ========================================================= */

const $ = id => document.getElementById(id);

/* ---------- Pestañas ---------- */
document.querySelectorAll('.pestana').forEach(boton => {
  boton.addEventListener('click', () => cambiarPestana(boton.dataset.panel));
});
function cambiarPestana(idPanel) {
  document.querySelectorAll('.pestana').forEach(b => b.classList.toggle('activa', b.dataset.panel === idPanel));
  document.querySelectorAll('.panel-pestana').forEach(p => p.classList.toggle('activo', p.id === idPanel));
  window.dispatchEvent(new Event('resize'));
}

/* ---------- Logo de la cabecera ---------- */
$('logoCabecera').src = LOGOS.find(l => l.nombre === 'Radio Pikota').imagen;

/* ---------- Avisos flotantes ---------- */
let temporizadorAviso;
function avisar(texto, tipo = '') {
  const a = $('aviso');
  a.textContent = texto;
  a.className = 'aviso visible ' + tipo;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => a.classList.remove('visible'), 3500);
}

/* ---------- Utilidades ---------- */
function formatear(seg, decimas = false) {
  seg = Math.max(0, seg);
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60).toString().padStart(2, '0');
  return decimas ? `${m}:${s}.${Math.floor((seg % 1) * 10)}` : `${m}:${s}`;
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

function base64ABuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function cargarImagen(src) {
  return new Promise(res => { const img = new Image(); img.onload = () => res(img); img.src = src; });
}

function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* ---------- Motor de audio (uno para toda la app) ---------- */
let audioCtx = null;
function obtenerAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
async function decodificar(arrayBuffer) {
  return obtenerAudioCtx().decodeAudioData(arrayBuffer.slice(0));
}
function nuevoBuffer(canales, longitud, sr) {
  return new AudioBuffer({ numberOfChannels: canales, length: Math.max(1, longitud), sampleRate: sr });
}

/* La entradilla se prepara una sola vez */
let entradillaBuffer = null;
async function obtenerEntradilla() {
  if (!entradillaBuffer) entradillaBuffer = await decodificar(base64ABuffer(ENTRADILLA_MP3));
  return entradillaBuffer;
}

/* =========================================================
   PROCESADO DE AUDIO
   ========================================================= */

/* 🔊 NIVELAR VOLUMEN
   Mide el volumen cada 50 ms: sube lo flojo y baja lo fuerte
   hasta un nivel parecido, sin subir los silencios. */
function nivelarVolumen(buffer) {
  const sr = buffer.sampleRate, n = buffer.length, canales = buffer.numberOfChannels;
  const ventana = Math.round(sr * 0.05);
  const numV = Math.ceil(n / ventana);
  const datos = [...Array(canales)].map((_, c) => buffer.getChannelData(c));

  // 1) Volumen (RMS) de cada ventana
  const rms = new Float32Array(numV);
  for (let v = 0; v < numV; v++) {
    let suma = 0, cuenta = 0;
    const fin = Math.min(n, (v + 1) * ventana);
    for (let i = v * ventana; i < fin; i++) {
      let m = 0;
      for (let c = 0; c < canales; c++) m += datos[c][i];
      m /= canales;
      suma += m * m; cuenta++;
    }
    rms[v] = Math.sqrt(suma / Math.max(1, cuenta));
  }

  // 2) Nivel del ruido de fondo (lo más flojo) y umbral de "hay voz"
  const ordenado = Array.from(rms).filter(x => x > 1e-6).sort((a, b) => a - b);
  const suelo = ordenado.length ? ordenado[Math.floor(ordenado.length * 0.1)] : 0;
  // Entre -54 dB y -42 dB: así una voz muy floja también cuenta como voz
  const umbral = Math.min(0.008, Math.max(suelo * 2.5, 0.002));
  const objetivo = 0.1;              // ≈ -20 dB
  const gMax = 8, gMin = 0.15;       // como mucho +18 dB / -16 dB

  // 3) Ganancia por ventana, suavizada (baja rápido, sube despacio)
  const ganancia = new Float32Array(numV);
  let g = 1;
  const primeraVoz = rms.findIndex(x => x > umbral);
  if (primeraVoz >= 0) g = Math.min(gMax, Math.max(gMin, objetivo / rms[primeraVoz]));
  for (let v = 0; v < numV; v++) {
    let deseada = g;
    if (rms[v] > umbral) deseada = Math.min(gMax, Math.max(gMin, objetivo / rms[v]));
    g += (deseada - g) * (deseada < g ? 0.5 : 0.12);
    ganancia[v] = g;
  }

  // 4) Aplicamos la ganancia (interpolada) y un limitador para que no sature
  const salida = nuevoBuffer(canales, n, sr);
  const techo = 0.95;
  for (let c = 0; c < canales; c++) {
    const x = datos[c], y = salida.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const pos = i / ventana - 0.5;
      const a = Math.max(0, Math.min(numV - 1, Math.floor(pos)));
      const b = Math.min(numV - 1, a + 1);
      const f = Math.max(0, Math.min(1, pos - a));
      y[i] = x[i] * (ganancia[a] * (1 - f) + ganancia[b] * f);
    }
  }
  limitar(salida, techo);
  return normalizarPico(salida, -1);
}

/* Limitador: evita que los picos pasen del techo */
function limitar(buffer, techo = 0.95) {
  const canales = buffer.numberOfChannels, n = buffer.length;
  const datos = [...Array(canales)].map((_, c) => buffer.getChannelData(c));
  const liberar = Math.exp(-1 / (buffer.sampleRate * 0.08));
  let env = 0;
  for (let i = 0; i < n; i++) {
    let pico = 0;
    for (let c = 0; c < canales; c++) pico = Math.max(pico, Math.abs(datos[c][i]));
    env = pico > env ? pico : env * liberar + pico * (1 - liberar);
    if (env > techo) {
      const g = techo / env;
      for (let c = 0; c < canales; c++) datos[c][i] *= g;
    }
  }
  return buffer;
}

/* Sube o baja todo para que el pico más alto quede en "objetivoDb" */
function normalizarPico(buffer, objetivoDb = -1) {
  let pico = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pico) pico = a; }
  }
  if (pico < 1e-6) return buffer;
  const g = Math.pow(10, objetivoDb / 20) / pico;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buffer;
}

/* 🧹 QUITAR RUIDO (resta espectral)
   1) Busca los trozos más silenciosos: eso es el "ruido de fondo".
   2) Lo resta de todo el audio, frecuencia a frecuencia. */
function crearFFT(n) {
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return function fft(re, im, inversa) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let tam = 2; tam <= n; tam *= 2) {
      const mitad = tam / 2, paso = n / tam;
      for (let i = 0; i < n; i += tam) {
        for (let j = 0, k = 0; j < mitad; j++, k += paso) {
          const l = i + j + mitad;
          const c = cos[k], s = inversa ? sin[k] : -sin[k];
          const tre = re[l] * c - im[l] * s, tim = re[l] * s + im[l] * c;
          re[l] = re[i + j] - tre; im[l] = im[i + j] - tim;
          re[i + j] += tre; im[i + j] += tim;
        }
      }
    }
    if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };
}

function pasoAlto(x, sr, freq = 80) {
  const w0 = 2 * Math.PI * freq / sr, cw = Math.cos(w0), alfa = Math.sin(w0) / (2 * 0.7071);
  const a0 = 1 + alfa;
  const b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - alfa) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

async function quitarRuido(buffer, intensidad = 'medio', alProgreso = () => {}) {
  const conf = { suave: { a: 1.5, b: 0.25 }, medio: { a: 2.5, b: 0.12 }, fuerte: { a: 4, b: 0.05 } }[intensidad];
  const N = 2048, H = 512, sr = buffer.sampleRate, n = buffer.length;
  const fft = crearFFT(N);
  const ventana = new Float32Array(N);
  for (let i = 0; i < N; i++) ventana[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const salida = nuevoBuffer(buffer.numberOfChannels, n, sr);
  const numTramas = Math.ceil((n + N) / H);
  const re = new Float64Array(N), im = new Float64Array(N);
  const total = numTramas * buffer.numberOfChannels;
  let hechas = 0;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const x = pasoAlto(buffer.getChannelData(c), sr, 80);
    const y = new Float32Array(n + 2 * N);
    const leer = (pos, i) => { const p = pos + i; return p >= 0 && p < n ? x[p] : 0; };

    // 1) Energía de cada trama para encontrar las más silenciosas
    const energias = [];
    for (let f = 0; f < numTramas; f++) {
      const pos = f * H - N;
      let e = 0;
      for (let i = 0; i < N; i += 4) { const v = leer(pos, i); e += v * v; }
      if (e > 1e-9) energias.push([e, f]);
    }
    energias.sort((a, b) => a[0] - b[0]);
    const silenciosas = energias.slice(0, Math.max(5, Math.floor(energias.length * 0.1)));

    // 2) Perfil del ruido: espectro medio de las tramas silenciosas
    const ruido = new Float64Array(N / 2 + 1);
    for (const [, f] of silenciosas) {
      const pos = f * H - N;
      for (let i = 0; i < N; i++) { re[i] = leer(pos, i) * ventana[i]; im[i] = 0; }
      fft(re, im, false);
      for (let k = 0; k <= N / 2; k++) ruido[k] += Math.hypot(re[k], im[k]) / silenciosas.length;
    }

    // 3) Restamos el ruido trama a trama y reconstruimos el sonido
    const gPrevia = new Float64Array(N / 2 + 1).fill(1);
    for (let f = 0; f < numTramas; f++) {
      const pos = f * H - N;
      for (let i = 0; i < N; i++) { re[i] = leer(pos, i) * ventana[i]; im[i] = 0; }
      fft(re, im, false);
      for (let k = 0; k <= N / 2; k++) {
        const mag = Math.hypot(re[k], im[k]) + 1e-12;
        let g = Math.max(1 - conf.a * ruido[k] / mag, conf.b);
        g = 0.6 * g + 0.4 * gPrevia[k];
        gPrevia[k] = g;
        re[k] *= g; im[k] *= g;
        if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) y[pos + N + i] += re[i] * ventana[i] / 1.5;
      if (++hechas % 400 === 0) { alProgreso(hechas / total); await esperar(0); }
    }
    salida.getChannelData(c).set(y.subarray(N, N + n));
  }
  alProgreso(1);
  return salida;
}

/* =========================================================
   EXPORTAR
   ========================================================= */
function aWav(buffer) {
  const canales = Math.min(2, buffer.numberOfChannels), sr = buffer.sampleRate, n = buffer.length;
  const datos = new DataView(new ArrayBuffer(44 + n * canales * 2));
  const texto = (o, s) => { for (let i = 0; i < s.length; i++) datos.setUint8(o + i, s.charCodeAt(i)); };
  texto(0, 'RIFF'); datos.setUint32(4, 36 + n * canales * 2, true); texto(8, 'WAVE');
  texto(12, 'fmt '); datos.setUint32(16, 16, true); datos.setUint16(20, 1, true);
  datos.setUint16(22, canales, true); datos.setUint32(24, sr, true);
  datos.setUint32(28, sr * canales * 2, true); datos.setUint16(32, canales * 2, true); datos.setUint16(34, 16, true);
  texto(36, 'data'); datos.setUint32(40, n * canales * 2, true);
  const ch = [...Array(canales)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < canales; c++) {
    const v = Math.max(-1, Math.min(1, ch[c][i]));
    datos.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([datos], { type: 'audio/wav' });
}

async function aMp3(buffer, alProgreso = () => {}, kbps = 160) {
  // El codificador MP3 solo acepta 44100 o 48000 Hz: si hace falta, convertimos
  if (![44100, 48000].includes(buffer.sampleRate)) buffer = await remuestrear(buffer, 44100);
  const canales = Math.min(2, buffer.numberOfChannels);
  const codificador = new lamejs.Mp3Encoder(canales, buffer.sampleRate, kbps);
  const aEntero = d => { const r = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const v = Math.max(-1, Math.min(1, d[i])); r[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return r; };
  const izq = aEntero(buffer.getChannelData(0));
  const der = canales > 1 ? aEntero(buffer.getChannelData(1)) : null;
  const trozos = [], bloque = 1152 * 20;
  for (let i = 0; i < izq.length; i += bloque) {
    const a = izq.subarray(i, i + bloque);
    const mp3 = der ? codificador.encodeBuffer(a, der.subarray(i, i + bloque)) : codificador.encodeBuffer(a);
    if (mp3.length) trozos.push(new Uint8Array(mp3));
    if ((i / bloque) % 50 === 0) { alProgreso(i / izq.length); await esperar(0); }
  }
  const final = codificador.flush();
  if (final.length) trozos.push(new Uint8Array(final));
  alProgreso(1);
  return new Blob(trozos, { type: 'audio/mpeg' });
}

async function remuestrear(buffer, sr) {
  const off = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * sr), sr);
  const s = off.createBufferSource(); s.buffer = buffer; s.connect(off.destination); s.start();
  return off.startRendering();
}

/* Exporta un audio en el formato elegido y lo descarga */
async function exportarAudio(buffer, formato, nombre, alProgreso) {
  const blob = formato === 'wav' ? aWav(buffer) : await aMp3(buffer, alProgreso);
  descargar(blob, `${nombre}.${formato}`);
}

/* =========================================================
   SONIDOS DE EFECTOS (los crea la propia app, sin archivos)
   ========================================================= */
const SONIDOS = [
  { id: 'ding', nombre: '🔔 Campanita' },
  { id: 'tada', nombre: '🎉 ¡Tachán!' },
  { id: 'whoosh', nombre: '💨 Whoosh' },
  { id: 'aplausos', nombre: '👏 Aplausos' },
  { id: 'redoble', nombre: '🥁 Redoble' },
  { id: 'golpe', nombre: '💥 Golpe' },
  { id: 'pitido', nombre: '🤐 Pitido (censura)' },
  { id: 'error', nombre: '❌ Fallo' }
];
const cacheSonidos = {};

async function generarSonido(id) {
  if (cacheSonidos[id]) return cacheSonidos[id];
  const sr = obtenerAudioCtx().sampleRate;
  const durs = { ding: 2, tada: 2.2, whoosh: 1, aplausos: 3, redoble: 2.4, golpe: 0.8, pitido: 0.8, error: 1.2 };
  const off = new OfflineAudioContext(2, Math.ceil(durs[id] * sr), sr);
  const salida = off.createGain(); salida.gain.value = 0.8; salida.connect(off.destination);

  const ruido = segundos => {
    const b = off.createBuffer(1, Math.ceil(segundos * sr), sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = off.createBufferSource(); s.buffer = b; return s;
  };
  const tono = (tipo, freq, inicio, dur, vol = 0.5) => {
    const o = off.createOscillator(), g = off.createGain();
    o.type = tipo; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(vol, inicio + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    o.connect(g); g.connect(salida); o.start(inicio); o.stop(inicio + dur + 0.05);
    return o;
  };
  const golpeRuido = (inicio, dur, vol, freq = 1500, q = 1) => {
    const s = ruido(dur), f = off.createBiquadFilter(), g = off.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, inicio); g.gain.exponentialRampToValueAtTime(0.001, inicio + dur);
    s.connect(f); f.connect(g); g.connect(salida); s.start(inicio);
  };

  if (id === 'ding') {
    tono('sine', 1318, 0, 1.9, 0.5); tono('sine', 2636, 0, 1.2, 0.15); tono('sine', 3950, 0, 0.6, 0.06);
  } else if (id === 'tada') {
    [523, 659, 784].forEach((f, i) => tono('triangle', f, i * 0.12, 0.3, 0.35));
    [523, 659, 784, 1047].forEach(f => tono('triangle', f, 0.4, 1.7, 0.22));
  } else if (id === 'whoosh') {
    const s = ruido(1), f = off.createBiquadFilter(), g = off.createGain();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(3500, 0.5); f.frequency.exponentialRampToValueAtTime(600, 1);
    g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(1.2, 0.45); g.gain.exponentialRampToValueAtTime(0.001, 1);
    s.connect(f); f.connect(g); g.connect(salida); s.start(0);
  } else if (id === 'aplausos') {
    for (let i = 0; i < 260; i++) {
      const t = Math.random() * 2.6, vol = 0.25 * (t < 2 ? 1 : (2.6 - t) / 0.6);
      golpeRuido(t, 0.05 + Math.random() * 0.04, Math.max(0.01, vol), 1200 + Math.random() * 1500, 1.5);
    }
  } else if (id === 'redoble') {
    let t = 0, paso = 0.12;
    while (t < 1.8) { golpeRuido(t, 0.08, 0.5, 1800, 0.8); t += paso; paso = Math.max(0.035, paso * 0.93); }
    golpeRuido(1.85, 0.5, 0.9, 1500, 0.5);
    const o = off.createOscillator(), g = off.createGain();
    o.frequency.setValueAtTime(150, 1.85); o.frequency.exponentialRampToValueAtTime(50, 2.3);
    g.gain.setValueAtTime(1, 1.85); g.gain.exponentialRampToValueAtTime(0.001, 2.35);
    o.connect(g); g.connect(salida); o.start(1.85); o.stop(2.4);
  } else if (id === 'golpe') {
    const o = off.createOscillator(), g = off.createGain();
    o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(40, 0.5);
    g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.7);
    o.connect(g); g.connect(salida); o.start(0); o.stop(0.75);
    golpeRuido(0, 0.15, 0.6, 800, 0.7);
  } else if (id === 'pitido') {
    const o = off.createOscillator(), g = off.createGain();
    o.frequency.value = 1000;
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.4, 0.01);
    g.gain.setValueAtTime(0.4, 0.75); g.gain.linearRampToValueAtTime(0, 0.78);
    o.connect(g); g.connect(salida); o.start(0); o.stop(0.8);
  } else if (id === 'error') {
    [392, 370, 349].forEach((f, i) => tono('square', f, i * 0.3, i === 2 ? 0.8 : 0.28, 0.15));
  }
  cacheSonidos[id] = await off.startRendering();
  return cacheSonidos[id];
}
