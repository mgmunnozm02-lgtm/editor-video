# 🍒 Estudio Radio Pikota

App web para editar **vídeos y podcasts** del IES Valle del Jerte con la imagen de Radio Pikota. Funciona en el navegador, sin instalar nada. Los archivos no se suben a ningún servidor: todo se procesa en tu ordenador.

## 🎬 Pestaña Vídeo
- Varios clips en un mismo montaje: se pueden ordenar y recortar
- Transiciones entre clips: fundido, fundido a negro, deslizar, zoom o corte directo
- 🍒 Entradilla de Radio Pikota al inicio y/o al final, con cortinilla animada del logo
- Filtros (brillo, contraste, saturación, blanco y negro) y velocidad
- Título encima del vídeo
- Logos en la esquina inferior derecha: IES Valle del Jerte, Radio Pikota y Frecuencia Maker
- Exportar el vídeo, exportar solo el audio (MP3/WAV) o enviarlo a la pestaña Podcast

## 🎙️ Pestaña Podcast
- Tres pistas: 🎤 Voces, 🎵 Música y ✨ Efectos
- Grabar con el micrófono o añadir archivos de audio (o de vídeo)
- Mover los trozos (también de una pista a otra), recortarlos estirando los bordes y cortarlos por la línea roja
- 🔊 Nivelar volumen: sube las voces flojas y baja las fuertes
- 🧹 Quitar ruido de fondo (suave, medio o fuerte)
- Volumen y fundidos de entrada y salida para cada trozo
- 🍒 Entradilla de Radio Pikota al inicio y al final
- Sonidos de efectos: campanita, ¡tachán!, whoosh, aplausos, redoble, golpe, pitido y fallo (o subir los tuyos)
- Deshacer (Ctrl+Z)
- Exportar en MP3 o WAV

## ⌨️ Atajos en la pestaña Podcast
| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| C | Cortar en la línea roja |
| Supr | Borrar el trozo elegido |
| Ctrl + Z | Deshacer |

## 📁 Archivos del proyecto
| Archivo | Qué contiene |
|---|---|
| `index.html` | La estructura de la página |
| `estilos.css` | Colores y diseño (Radio Pikota) |
| `recursos.js` | Logos y entradilla guardados dentro del código |
| `comun.js` | Herramientas de audio: nivelar, quitar ruido, exportar, sonidos |
| `video.js` | Todo lo de la pestaña Vídeo |
| `podcast.js` | Todo lo de la pestaña Podcast |
| `lame.min.js` | Codificador MP3 (lamejs, licencia LGPL) |

## Autora
María Gloria Muñoz Mariño · IES Valle del Jerte
