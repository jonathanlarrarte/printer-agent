const fs = require('fs');
const { getConfigPath } = require('./setup/generar-identidad');

function leerConfigLocal() {
  return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
}

function guardarConfigLocal(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
  return config;
}

function actualizarImpresora(alias, datosImpresora) {
  const config = leerConfigLocal();
  config.printers[alias] = datosImpresora;
  return guardarConfigLocal(config);
}

function eliminarImpresora(alias) {
  const config = leerConfigLocal();
  delete config.printers[alias];
  return guardarConfigLocal(config);
}

module.exports = {
  leerConfigLocal,
  guardarConfigLocal,
  actualizarImpresora,
  eliminarImpresora
};
