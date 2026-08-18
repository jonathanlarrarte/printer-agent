function generarBrazaleteTSPL(datos) {
  const ancho = datos.ancho_mm || 50;
  const alto = datos.alto_mm || 25;
  const gap = datos.gap_mm != null ? datos.gap_mm : 2;
  const copias = datos.copias || 1;

  const lineas = [
    `SIZE ${ancho} mm, ${alto} mm`,
    `GAP ${gap} mm, 0 mm`,
    'DIRECTION 1',
    'DENSITY 8',
    'CLS'
  ];

  if (datos.nombre) {
    lineas.push(`TEXT 20,20,"3",0,1,1,"${escaparTexto(datos.nombre)}"`);
  }
  if (datos.fecha) {
    lineas.push(`TEXT 20,60,"2",0,1,1,"${escaparTexto(datos.fecha)}"`);
  }
  if (datos.codigo) {
    lineas.push(`BARCODE 20,90,"128",50,1,0,2,2,"${escaparTexto(datos.codigo)}"`);
  }

  lineas.push(`PRINT ${copias},1`);

  return Buffer.from(lineas.join('\r\n') + '\r\n', 'ascii');
}

function escaparTexto(texto) {
  return String(texto).replace(/"/g, '\\"');
}

module.exports = { generarBrazaleteTSPL };
