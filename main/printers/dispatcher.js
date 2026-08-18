const { leerConfigLocal } = require('../config');
const { generarRecibo, generarTicketAccesoEscPos } = require('./escpos');
const { generarBrazaleteTSPL } = require('./tspl');
const { imprimirRaw, imprimirPorRed } = require('./enviar');
const { generarReciboDesdeHTML } = require('./html-to-escpos');

async function dispatch(job) {
  const config = leerConfigLocal();
  const impresora = config.printers[job.target];

  if (!impresora) {
    throw new Error(`No hay impresora configurada para el alias "${job.target}"`);
  }

  const formato = job.format || impresora.formato_default || 'raw';
  const buffer = await generarBuffer(formato, job.data, impresora);

  if (impresora.tipo === 'red') {
    return imprimirPorRed(impresora.ip, impresora.puerto, buffer);
  }
  if (impresora.tipo === 'usb' || impresora.tipo === 'local') {
    return imprimirRaw(impresora.nombre_sistema, buffer);
  }
  throw new Error(`Tipo de impresora no soportado: "${impresora.tipo}"`);
}

async function generarBuffer(formato, data, impresora) {
  switch (formato) {
    case 'escpos':
      return generarRecibo(data);

    case 'tspl': {
      // "tspl" aqui significa "quiero imprimir un brazalete/ticket de acceso"
      // (nombre + codigo + fecha), sin importar que protocolo hable la
      // impresora fisica. El protocolo real (TSPL para una TSC de verdad,
      // o ESC/POS para una termica angosta como la ZJ-58) se decide segun
      // como este configurada ESA impresora en el agente.
      const protocolo = impresora.formato_default || 'tspl';
      if (protocolo === 'escpos') {
        return generarTicketAccesoEscPos(data);
      }
      return generarBrazaleteTSPL(data);
    }

    case 'html': {
      const html = typeof data === 'string' ? data : data.html;
      const anchoPx = (typeof data === 'object' && data.ancho_px) || 576;
      const protocoloExplicito = typeof data === 'object' && data.protocolo;
      const protocolo = protocoloExplicito || impresora.formato_default || 'escpos';
      return generarReciboDesdeHTML(html, anchoPx, protocolo);
    }

    case 'raw':
    default:
      return typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(String(data));
  }
}

module.exports = { dispatch };
