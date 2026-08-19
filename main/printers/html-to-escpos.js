const { BrowserWindow } = require('electron');

/**
 * Envuelve una promesa con un limite de tiempo. Si no se resuelve a
 * tiempo, se rechaza con un mensaje claro -- esto evita que un fallo de
 * renderizado (ventana que nunca termina de cargar, etc.) bloquee la
 * cola de impresion completa de forma indefinida.
 */
function conTimeout(promesa, ms, mensaje) {
  let temporizador;
  const timeout = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(temporizador));
}

/**
 * Renderiza un string de HTML en una ventana oculta de Electron (usa el
 * mismo motor Chromium interno) y devuelve una imagen (nativeImage) con
 * el contenido ya dibujado, ajustada al ancho de impresion deseado.
 *
 * anchoPx: ancho en pixeles/dots. A 203dpi (estandar en termicas y TSC),
 * 8 dots equivalen a 1mm. 576 dots = 72mm, tipico para una termica de 80mm.
 */
async function renderizarHTMLaBitmap(html, anchoPx = 576) {
  console.log('[html-to-escpos] Paso 1: creando ventana oculta...');
  const ventana = new BrowserWindow({
    width: anchoPx,
    height: 50,
    show: false,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      offscreen: false,
      backgroundThrottling: false
    }
  });

  try {
    // IMPORTANTE: se evita loadURL('data:text/html,...') porque en algunos
    // entornos Windows el evento 'did-finish-load' nunca se dispara para
    // URLs tipo data:, dejando la espera colgada indefinidamente. En su
    // lugar, se carga una pagina en blanco (100% confiable) y se inyecta
    // el HTML directamente via document.write() con executeJavaScript.
    console.log('[html-to-escpos] Paso 2: cargando about:blank...');
    await ventana.loadURL('about:blank');
    console.log('[html-to-escpos] Paso 3: about:blank cargado.');

    console.log('[html-to-escpos] Paso 4: inyectando HTML via document.write...');
    await ventana.webContents.executeJavaScript(`
      document.open();
      document.write(${JSON.stringify(html)});
      document.close();
    `);
    console.log('[html-to-escpos] Paso 5: HTML inyectado correctamente.');

    // Reset de renderizado: sin esto, el antialiasing normal de Chromium
    // deja bordes grises en el texto que el umbral de imagenABitsEmpaquetados
    // (una linea dura blanco/negro) convierte en manchas y "ruido" en vez de
    // trazos limpios -- es la causa principal de que un recibo salga
    // impreso como si fuera una foto borrosa en vez de texto nitido. Se
    // inserta como PRIMER elemento del <head> para que cualquier <style>
    // del HTML recibido (que aparece despues en el DOM) siga pudiendo
    // pisar el font-family/tamano por cascada normal.
    await ventana.webContents.executeJavaScript(`
      (function () {
        var reset = document.createElement('style');
        reset.textContent = [
          '* { -webkit-font-smoothing: none; text-rendering: optimizeSpeed; }',
          'body { font-family: Arial, "Segoe UI", sans-serif; color: #000; background: #fff; margin: 0; }'
        ].join('\\n');
        var head = document.head || document.documentElement;
        head.insertBefore(reset, head.firstChild);
      })();
    `);

    // Pequena espera para que termine el reflow/layout del contenido inyectado
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log('[html-to-escpos] Paso 6: midiendo scrollHeight...');
    const altoReal = await ventana.webContents.executeJavaScript('document.body.scrollHeight');
    console.log('[html-to-escpos] Paso 7: altura medida =', altoReal);

    ventana.setContentSize(anchoPx, Math.max(altoReal, 10));
    console.log('[html-to-escpos] Paso 8: tamano ajustado - esperando reflow final...');

    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log('[html-to-escpos] Paso 9: capturando pagina (capturePage)...');
    const imagen = await ventana.webContents.capturePage();
    console.log('[html-to-escpos] Paso 10: captura completa. isEmpty =', imagen.isEmpty());

    if (imagen.isEmpty()) {
      throw new Error('La captura de la pagina resulto vacia (posible fallo de renderizado).');
    }

    return imagen;
  } finally {
    ventana.destroy();
    console.log('[html-to-escpos] Ventana destruida.');
  }
}

/**
 * Convierte una nativeImage a un bitmap 1-bit (blanco/negro) empaquetado,
 * SIN ningun encabezado de protocolo todavia. Este resultado se puede
 * envolver despues tanto en comandos ESC/POS como en comandos TSPL.
 */
function imagenABitsEmpaquetados(nativeImg, umbral = 200) {
  const { width, height } = nativeImg.getSize();
  const buffer = nativeImg.toBitmap(); // formato BGRA, 4 bytes por pixel

  const bytesPorLinea = Math.ceil(width / 8);
  const datos = Buffer.alloc(bytesPorLinea * height, 0);
  let pixelesNegros = 0;
  const totalPixeles = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const b = buffer[idx];
      const g = buffer[idx + 1];
      const r = buffer[idx + 2];
      const luminancia = 0.299 * r + 0.587 * g + 0.114 * b;

      if (luminancia < umbral) {
        pixelesNegros++;
        const byteIndex = y * bytesPorLinea + (x >> 3);
        const bit = 7 - (x % 8);
        datos[byteIndex] |= (1 << bit);
      }
    }
  }

  const proporcionNegro = totalPixeles > 0 ? pixelesNegros / totalPixeles : 0;
  console.log(`[html-to-escpos] Imagen ${width}x${height}, ${(proporcionNegro * 100).toFixed(2)}% de pixeles oscuros`);

  if (proporcionNegro === 0) {
    throw new Error('La imagen renderizada salio completamente en blanco (0% de contenido oscuro).');
  }
  if (proporcionNegro > 0.98) {
    throw new Error('La imagen renderizada salio casi completamente negra (posible fallo de captura).');
  }

  return { width, height, bytesPorLinea, datos };
}

/**
 * Envuelve el bitmap en el comando ESC/POS "GS v 0" (impresion de imagen
 * cruda), el estandar que hablan las impresoras termicas de recibos.
 */
function envolverParaEscPos({ width, height, bytesPorLinea, datos }) {
  const xL = bytesPorLinea & 0xff;
  const xH = (bytesPorLinea >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  const inicializar = Buffer.from([0x1b, 0x40]); // ESC @ : resetea cualquier estado previo de la impresora
  const encabezado = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const corteYAvance = Buffer.from([0x0a, 0x0a, 0x1d, 0x56, 0x00]);

  return Buffer.concat([inicializar, encabezado, datos, corteYAvance]);
}

/**
 * Envuelve el bitmap en comandos TSPL (SIZE/GAP/CLS/BITMAP/PRINT), el
 * lenguaje que hablan las impresoras TSC de etiquetas/brazaletes.
 * El comando BITMAP espera: x,y,ancho_en_bytes,alto_en_dots,modo,<datos crudos>
 */
function envolverParaTSPL({ width, height, bytesPorLinea, datos }) {
  const anchoMm = Math.ceil(width / 8);  // 8 dots/mm a 203dpi
  const altoMm = Math.ceil(height / 8) + 4; // margen pequeno extra

  const encabezado = [
    `SIZE ${anchoMm} mm, ${altoMm} mm`,
    'GAP 2 mm, 0 mm',
    'DIRECTION 1',
    'CLS',
    `BITMAP 0,0,${bytesPorLinea},${height},0,`
  ].join('\r\n');

  const pie = '\r\nPRINT 1,1\r\n';

  return Buffer.concat([
    Buffer.from(encabezado, 'ascii'),
    datos,
    Buffer.from(pie, 'ascii')
  ]);
}

/**
 * Envuelve el bitmap en el comando ESC/POS antiguo "ESC *" (modo de
 * imagen de bits por bandas), mucho mas ampliamente soportado por clones
 * economicos que no implementan el comando moderno "GS v 0". Imprime la
 * imagen en bandas horizontales de 24 puntos de alto cada una.
 */
function envolverParaEscStar({ width, height, bytesPorLinea, datos }) {
  const ALTURA_BANDA = 24; // modo m=33 (doble densidad), 24 puntos por banda
  const partes = [];

  const obtenerBit = (x, y) => {
    if (y >= height) return 0;
    const byteIndex = y * bytesPorLinea + (x >> 3);
    const bit = 7 - (x % 8);
    return (datos[byteIndex] >> bit) & 1;
  };

  partes.push(Buffer.from([0x1b, 0x40]));               // ESC @  -> inicializar
  partes.push(Buffer.from([0x1b, 0x33, ALTURA_BANDA]));  // ESC 3 n -> espaciado de linea = altura de banda

  for (let bandaInicio = 0; bandaInicio < height; bandaInicio += ALTURA_BANDA) {
    const nL = width & 0xff;
    const nH = (width >> 8) & 0xff;
    const columnas = Buffer.alloc(width * 3); // 3 bytes por columna = 24 bits verticales

    for (let x = 0; x < width; x++) {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (obtenerBit(x, bandaInicio + bit)) b0 |= (1 << (7 - bit));
        if (obtenerBit(x, bandaInicio + 8 + bit)) b1 |= (1 << (7 - bit));
        if (obtenerBit(x, bandaInicio + 16 + bit)) b2 |= (1 << (7 - bit));
      }
      columnas[x * 3] = b0;
      columnas[x * 3 + 1] = b1;
      columnas[x * 3 + 2] = b2;
    }

    partes.push(Buffer.from([0x1b, 0x2a, 33, nL, nH])); // ESC * 33 nL nH
    partes.push(columnas);
    partes.push(Buffer.from([0x0a])); // avanza a la siguiente banda
  }

  partes.push(Buffer.from([0x1b, 0x32]));  // ESC 2 -> restaura espaciado de linea normal
  partes.push(Buffer.from([0x0a, 0x0a])); // avance final (sin comando de corte,
                                            // muchos clones tampoco lo soportan)

  return Buffer.concat(partes);
}

/**
 * Funcion principal: recibe HTML (string) y el protocolo destino
 * ("escpos", "escpos-legacy" o "tspl"), y devuelve el buffer ya listo
 * para esa impresora. El protocolo se determina automaticamente segun
 * la impresora configurada, a menos que se indique explicitamente.
 * "escpos-legacy" usa el modo de imagen antiguo (ESC *), recomendado
 * para clones economicos (ej. ZJ-58) que no soportan "GS v 0".
 */
async function generarReciboDesdeHTML(html, anchoPx = 576, protocolo = 'escpos') {
  const imagen = await conTimeout(
    renderizarHTMLaBitmap(html, anchoPx),
    15000,
    'Renderizado de HTML excedio el tiempo limite (15s). Revisa si el HTML tiene contenido muy pesado o bloqueante.'
  );
  const bits = imagenABitsEmpaquetados(imagen);

  if (protocolo === 'tspl') {
    return envolverParaTSPL(bits);
  }
  if (protocolo === 'escpos-legacy') {
    return envolverParaEscStar(bits);
  }
  return envolverParaEscPos(bits);
}

module.exports = {
  generarReciboDesdeHTML,
  renderizarHTMLaBitmap,
  imagenABitsEmpaquetados,
  envolverParaEscPos,
  envolverParaEscStar,
  envolverParaTSPL
};
