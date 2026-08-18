const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

let CONFIG_PATH = null;

function inicializarRutas(userDataPath) {
  CONFIG_PATH = path.join(userDataPath, 'config.json');
}

function generarInstalacionId() {
  const hostname = os.hostname();
  const random = crypto.randomBytes(4).toString('hex');
  return `pos-${hostname}-${random}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function configPorDefecto() {
  return {
    dominios_permitidos: ['http://localhost', 'https://miapp-parque.com'],
    puerto_ws: 8181,
    printers: {},
    // Backend central (PrintBridge Platform). Mientras plataforma_url no
    // este configurada, el agente sigue funcionando 100% local (ver
    // main/plataforma.js) -- no es un requisito para imprimir.
    plataforma_url: null,
    plataforma_token: null
  };
}

/**
 * Crea config.json en el primer arranque (dentro de userData, persiste
 * entre actualizaciones de la app). En arranques posteriores, respeta
 * lo que ya exista (nunca regenera instalacion_id/token).
 */
function inicializarConfig(codigoClienteInicial) {
  if (!CONFIG_PATH) throw new Error('inicializarRutas() debe llamarse antes de inicializarConfig()');

  if (fs.existsSync(CONFIG_PATH)) {
    console.log('[identidad] config.json ya existe, no se regenera identidad.');
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  const config = {
    ...configPorDefecto(),
    instalacion_id: generarInstalacionId(),
    cliente_codigo: codigoClienteInicial || 'sin-asignar',
    fecha_instalacion: new Date().toISOString(),
    token: crypto.randomBytes(16).toString('hex'),
    version_agente: require('../../package.json').version
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('[identidad] Nueva instalacion generada:', config.instalacion_id);
  return config;
}

function getConfigPath() {
  return CONFIG_PATH;
}

module.exports = { inicializarRutas, inicializarConfig, generarInstalacionId, getConfigPath };
