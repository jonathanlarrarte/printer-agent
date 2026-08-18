const { leerConfigLocal } = require('./config');
const { probarConexionTCP, estadoImpresoraLocal } = require('./printers/discovery');

const INTERVALO_MS = 15000;
let ultimoEstado = {};

async function verificarEstadoImpresoras() {
  const config = leerConfigLocal();
  const estado = {};

  for (const [alias, cfg] of Object.entries(config.printers || {})) {
    if (cfg.tipo === 'red') {
      const online = await probarConexionTCP(cfg.ip, cfg.puerto);
      estado[alias] = { online, tipo: 'red', destino: `${cfg.ip}:${cfg.puerto || 9100}` };
    } else {
      const estadoSistema = await estadoImpresoraLocal(cfg.nombre_sistema);
      estado[alias] = {
        online: estadoSistema !== 'no-encontrada' && estadoSistema !== 'error',
        tipo: 'local',
        destino: cfg.nombre_sistema,
        detalle: estadoSistema
      };
    }
  }

  ultimoEstado = estado;
  return estado;
}

function obtenerUltimoEstado() {
  return ultimoEstado;
}

function iniciarHeartbeat() {
  verificarEstadoImpresoras();
  setInterval(verificarEstadoImpresoras, INTERVALO_MS);
}

module.exports = { iniciarHeartbeat, obtenerUltimoEstado, verificarEstadoImpresoras };
