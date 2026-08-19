const os = require('os');
const { leerConfigLocal, guardarConfigLocal } = require('./config');
const { obtenerUltimoEstado } = require('./heartbeat');
const { onEstadoJob, encolar } = require('./queue');

const INTERVALO_HEARTBEAT_MS = 20000;
const TIMEOUT_REQUEST_MS = 5000;

// Traduce los estados que ya emite queue.js (via onEstadoJob) al catalogo de
// event_type de la plataforma (seccion 8.1 del doc de arquitectura -- los
// valores del catalogo son en ingles de punta a punta, ver App\Support\EventType
// del lado de la plataforma).
const TIPO_EVENTO_POR_ESTADO = {
  en_cola: 'job.created',
  imprimiendo: 'job.printing',
  impreso: 'job.printed',
  fallo_definitivo: 'job.failed'
};

async function llamarPlataforma(ruta, opciones) {
  const config = leerConfigLocal();
  if (!config.plataforma_url) return null;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_REQUEST_MS);

  try {
    const respuesta = await fetch(`${config.plataforma_url}${ruta}`, {
      ...opciones,
      signal: controlador.signal,
      headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) }
    });
    return respuesta;
  } catch (err) {
    // La plataforma caida o inalcanzable NUNCA debe afectar la impresion
    // local -- solo se registra en consola.
    console.warn(`[plataforma] Error llamando a ${ruta}:`, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @returns {Promise<{ok: boolean, mensaje: string}>} pensado tanto para el
 * llamado periodico (que ignora el resultado) como para el boton "Conectar"
 * de la ventana de configuracion (que SI necesita feedback inmediato).
 */
async function registrarSiHaceFalta() {
  const config = leerConfigLocal();

  if (!config.plataforma_url) {
    return { ok: false, mensaje: 'Configura la URL de la plataforma primero.' };
  }
  if (config.plataforma_token) {
    return { ok: true, mensaje: 'Ya conectado.' };
  }

  const respuesta = await llamarPlataforma('/agent/register', {
    method: 'POST',
    body: JSON.stringify({
      installation_id: config.instalacion_id,
      client_code: config.cliente_codigo,
      display_name: os.hostname(),
      agent_version: config.version_agente
    })
  });

  if (!respuesta) {
    return { ok: false, mensaje: 'No se pudo conectar con la plataforma (revisa la URL y la conexion a internet).' };
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    console.warn('[plataforma] No se pudo registrar el agente:', respuesta.status);
    return { ok: false, mensaje: cuerpo.error || `La plataforma respondio con error ${respuesta.status}.` };
  }

  const datos = await respuesta.json();
  guardarConfigLocal({ ...leerConfigLocal(), plataforma_token: datos.token });
  console.log('[plataforma] Agente registrado en la plataforma.');
  return { ok: true, mensaje: 'Conectado correctamente.' };
}

async function enviarHeartbeat() {
  const config = leerConfigLocal();
  if (!config.plataforma_url || !config.plataforma_token) return;

  const estadoLocal = obtenerUltimoEstado();
  const impresoras = {};

  for (const [alias, cfg] of Object.entries(config.printers || {})) {
    const estado = estadoLocal[alias] || {};
    impresoras[alias] = {
      online: !!estado.online,
      type: cfg.tipo,
      ip: cfg.ip || null,
      port: cfg.puerto || null,
      system_name: cfg.nombre_sistema || null,
      protocol: cfg.formato_default || null
    };
  }

  const respuesta = await llamarPlataforma('/agent/heartbeat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.plataforma_token}` },
    body: JSON.stringify({ agent_version: config.version_agente, printers: impresoras })
  });

  if (!respuesta || !respuesta.ok) return;

  // Unico "empuje" de la plataforma hacia el agente (impresiones de
  // prueba pedidas desde el dashboard): viajan montadas en la respuesta
  // del heartbeat, no por un canal aparte -- el agente sigue siendo quien
  // inicia siempre la conexion. De aca en mas es un trabajo mas: mismos
  // reintentos, mismo reporte de estado que un job real del POS.
  const cuerpo = await respuesta.json().catch(() => null);
  (cuerpo?.pending_commands || []).forEach((comando) => {
    console.log(`[plataforma] Comando de prueba recibido para "${comando.target}".`);
    encolar({ id: comando.id, target: comando.target, format: comando.format, data: comando.data });
  });
}

async function reportarEvento(evento) {
  const config = leerConfigLocal();
  if (!config.plataforma_url || !config.plataforma_token) return;

  const tipoEvento = TIPO_EVENTO_POR_ESTADO[evento.estado];
  if (!tipoEvento) return;

  await llamarPlataforma('/agent/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.plataforma_token}` },
    body: JSON.stringify({
      event_type: tipoEvento,
      external_job_id: evento.id,
      target: evento.target,
      error_message: evento.estado === 'fallo_definitivo' ? String(evento.detalle || '') : undefined
    })
  });
}

function iniciarReporteAPlataforma() {
  registrarSiHaceFalta();
  enviarHeartbeat();
  setInterval(() => {
    registrarSiHaceFalta();
    enviarHeartbeat();
  }, INTERVALO_HEARTBEAT_MS);

  onEstadoJob(reportarEvento);
}

module.exports = { iniciarReporteAPlataforma, registrarSiHaceFalta, enviarHeartbeat, reportarEvento };
