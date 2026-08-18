const { leerConfigLocal } = require('./config');

function validarToken(token) {
  if (!token) return false;
  const config = leerConfigLocal();
  return token === config.token;
}

function validarOrigen(origin) {
  const config = leerConfigLocal();
  const permitidos = config.dominios_permitidos || [];
  if (permitidos.length === 0) return true;
  if (!origin) return false;
  return permitidos.some((dominio) => origin.startsWith(dominio));
}

module.exports = { validarToken, validarOrigen };
