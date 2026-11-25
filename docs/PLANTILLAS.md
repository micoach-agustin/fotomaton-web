# Personalizar las plantillas

Todos los recursos del fotomatón están en [`public/templates/`](../public/templates/). El [manifiesto](../public/templates/manifest.json) enumera los 36 PNG incluidos.

## Marcos

Hay 9 pares, definidos en [`src/photobooth/frames.ts`](../src/photobooth/frames.ts): nombres, fecha, campanas, coche, cabina, retro, viaje, bloques y magia. Cada par tiene su propio PNG vertical y horizontal. El cambio de orientación conserva el diseño elegido.

Para cambiar un diseño, sustituye sus dos archivos manteniendo sus nombres, o edita `portrait` y `landscape` en `frames.ts`. Usa PNG con transparencia en la zona de la cámara y conserva la relación 9:16 para vertical y 16:9 para horizontal. La foto exportada se compone a la resolución del PNG. Los vídeos se procesan con un límite de 1920 píxeles en el lado largo.

Los nombres y fechas de los marcos originales están dibujados dentro del PNG. Sustitúyelos para reutilizarlos en otro evento; no cambian con las variables de entorno. Los diseños retro, viaje, bloques y magia sirven como punto de partida alternativo.

## Accesorios

[`src/photobooth/props.ts`](../src/photobooth/props.ts) define 12 opciones a partir de 11 imágenes, incluyendo una combinación de los dos carteles. `faceX`/`faceY` colocan el punto de apoyo en el marco, `anchorX`/`anchorY` indican ese punto dentro del PNG y `width` controla su tamaño. Los valores son proporciones; no son coordenadas de un detector facial.

Los accesorios funcionan en vertical y en horizontal. En horizontal se conserva su escala dentro de un área central de proporción 9:16, para que las lentes y los demás accesorios no se estiren a todo el ancho. El botón Accesorios activa las lentes; las flechas o un deslizamiento cambian de accesorio. Al girar el dispositivo se mantiene la selección. La persona debe colocarse dentro del visor. La composición guarda primero la cámara, después los accesorios y finalmente el marco; los controles de interfaz no aparecen en la foto.

## Controles ilustrados

Los siete PNG restantes son botones de foto, mensaje, cambio de cámara, captura de foto, grabación de vídeo, accesorios y descarga. Puedes sustituirlos conservando sus nombres y transparencia. Cada botón mantiene una etiqueta accesible en el código.

Después de editar, ejecuta `npm test` y `npm run build`, y sube de nuevo todo `dist/`.
