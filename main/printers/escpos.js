const { printer: ThermalPrinter, types } = require('node-thermal-printer');

async function generarRecibo(datos) {
  const printer = new ThermalPrinter({ type: types.EPSON, interface: 'buffer' });

  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(datos.negocio || 'Recibo');
  printer.bold(false);
  printer.setTextNormal();

  (datos.encabezado || []).forEach((linea) => printer.println(linea));

  printer.drawLine();
  printer.alignLeft();

  (datos.items || []).forEach((item) => {
    const cantidad = item.cantidad || 1;
    const etiqueta = `${cantidad}x ${item.nombre}`;
    printer.leftRight(etiqueta, formatearMoneda(item.precio * cantidad, datos.moneda));
  });

  printer.drawLine();
  printer.bold(true);
  printer.leftRight('TOTAL', formatearMoneda(datos.total, datos.moneda));
  printer.bold(false);

  if (datos.pie && datos.pie.length) {
    printer.alignCenter();
    datos.pie.forEach((linea) => printer.println(linea));
  }

  printer.newLine();
  printer.cut();

  return printer.getBuffer();
}

function formatearMoneda(valor, moneda) {
  const numero = Number(valor || 0);
  const simbolo = moneda || '$';
  return `${simbolo}${numero.toLocaleString('es-CO')}`;
}

/**
 * Construye manualmente el comando ESC/POS de codigo de barras CODE128
 * (GS k m n {codigo}). No todos los clones de impresora ESC/POS soportan
 * codigo de barras exactamente igual, pero esta es la secuencia estandar
 * documentada por Epson y ampliamente compatible.
 */
function comandoBarcodeCode128(texto) {
  const datos = Buffer.from('{B' + texto, 'ascii'); // "{B" selecciona Code Set B (alfanumerico)
  const n = datos.length;

  return Buffer.concat([
    Buffer.from([0x1d, 0x68, 60]),        // GS h n  -> alto del codigo (60 dots)
    Buffer.from([0x1d, 0x77, 2]),         // GS w n  -> ancho de cada barra
    Buffer.from([0x1d, 0x48, 2]),         // GS H n  -> imprime el texto legible debajo
    Buffer.from([0x1d, 0x6b, 73, n]),     // GS k m n -> m=73 (CODE128), n=longitud de datos
    datos
  ]);
}

/**
 * Genera un ticket de acceso (nombre + codigo + fecha + codigo de barras)
 * para impresoras termicas ESC/POS angostas (ej. ZJ-58 de 58mm), como
 * alternativa a un brazalete TSPL cuando la impresora real no es TSC.
 */
async function generarTicketAccesoEscPos(datos) {
  const printer = new ThermalPrinter({ type: types.EPSON, interface: 'buffer' });

  printer.alignCenter();
  printer.bold(true);
  printer.println('ACCESO PARQUE AVENTURA');
  printer.bold(false);
  printer.drawLine();
  printer.bold(true);
  printer.println(datos.nombre || '');
  printer.bold(false);
  printer.println(`Codigo: ${datos.codigo || ''}`);
  printer.println(`Fecha: ${datos.fecha || ''}`);
  printer.drawLine();
  printer.newLine();

  const bufferTexto = printer.getBuffer();
  const bufferBarcode = datos.codigo ? comandoBarcodeCode128(datos.codigo) : Buffer.alloc(0);
  const corte = Buffer.from([0x0a, 0x0a, 0x1d, 0x56, 0x00]);

  return Buffer.concat([bufferTexto, bufferBarcode, corte]);
}

module.exports = { generarRecibo, generarTicketAccesoEscPos, comandoBarcodeCode128 };
