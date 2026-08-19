const fs = require('fs');
const path = require('path');

/**
 * Certificado autofirmado para localhost, bundleado con la app (ver
 * assets/tls/) -- el MISMO certificado en cada instalacion, no uno nuevo
 * por maquina. El paso de instalacion de NSIS lo agrega al almacen de
 * certificados de confianza de Windows (ver build/installer.nsh) para que
 * el navegador confie en https://localhost:<puerto> sin advertencia.
 *
 * Alcance de la confianza: el certificado solo es valido para el nombre
 * "localhost"/127.0.0.1 (ver Subject Alternative Name al generarlo) --
 * aunque la clave privada sea compartida entre instalaciones, no sirve
 * para suplantar ningun otro dominio. El unico riesgo residual es que otro
 * proceso con YA acceso al loopback de esa misma maquina podria levantar
 * su propio servidor TLS presentandose como "localhost" -- un escenario
 * que ya requiere ejecucion de codigo local, nivel de acceso donde HTTPS
 * local deja de ser la linea de defensa relevante.
 */
function rutaAssetsTLS() {
  let electronApp = null;
  try {
    electronApp = require('electron').app;
  } catch (err) {
    // No estamos en el proceso principal de Electron (ej. pruebas fuera de la app)
  }

  if (electronApp && electronApp.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'tls');
  }
  return path.join(__dirname, '..', 'assets', 'tls');
}

/**
 * @returns {{key: Buffer, cert: Buffer}} listo para https.createServer().
 * @throws si los archivos no existen -- el llamador decide si eso es
 * fatal o si el agente sigue funcionando solo por HTTP.
 */
function obtenerCredencialesTLS() {
  const base = rutaAssetsTLS();
  return {
    key: fs.readFileSync(path.join(base, 'localhost-key.pem')),
    cert: fs.readFileSync(path.join(base, 'localhost-cert.pem'))
  };
}

module.exports = { obtenerCredencialesTLS, rutaAssetsTLS };
