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

function actualizarPlataforma({ plataforma_url, cliente_codigo }) {
  const config = leerConfigLocal();
  const urlNueva = (plataforma_url || '').trim().replace(/\/+$/, '') || null;

  // Si cambia la URL o el codigo de cliente, el token viejo (si habia) ya
  // no sirve -- fuerza un re-registro contra el destino nuevo.
  if (urlNueva !== config.plataforma_url || cliente_codigo !== config.cliente_codigo) {
    config.plataforma_token = null;
  }

  config.plataforma_url = urlNueva;
  config.cliente_codigo = cliente_codigo || 'sin-asignar';
  return guardarConfigLocal(config);
}

module.exports = {
  leerConfigLocal,
  guardarConfigLocal,
  actualizarImpresora,
  eliminarImpresora,
  actualizarPlataforma
};
