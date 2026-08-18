const fs = require('fs');
const path = require('path');
const { dispatch } = require('./printers/dispatcher');

const MAX_INTENTOS = 5;
const INTERVALO_MS = 5000;

let QUEUE_FILE = null;
let listenersEstado = [];

function inicializarRutas(userDataPath) {
  QUEUE_FILE = path.join(userDataPath, 'pending_jobs.json');
}

function leerCola() {
  if (!QUEUE_FILE || !fs.existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch (err) {
    console.error('[queue] Cola corrupta, se reinicia vacia:', err.message);
    return [];
  }
}

function guardarCola(cola) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(cola, null, 2));
}

function encolar(job) {
  const cola = leerCola();
  cola.push({ ...job, intentos: 0, timestamp: Date.now(), estado: 'pendiente' });
  guardarCola(cola);
  notificarEstado(job, 'en_cola');
}

function onEstadoJob(callback) {
  listenersEstado.push(callback);
}

function notificarEstado(job, estado, detalle) {
  listenersEstado.forEach((cb) => {
    try { cb({ id: job.id, target: job.target, estado, detalle }); }
    catch (err) { console.error('[queue] Error notificando estado:', err.message); }
  });
}

const TIMEOUT_JOB_MS = 20000;

function conTimeout(promesa, ms) {
  let temporizador;
  const timeout = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error(`El trabajo excedio el tiempo limite (${ms / 1000}s) sin completarse.`)), ms);
  });
  return Promise.race([promesa, timeout]).finally(() => clearTimeout(temporizador));
}

async function procesarCola() {
  const cola = leerCola();
  if (cola.length === 0) return;

  const pendientes = [];
  for (const job of cola) {
    try {
      notificarEstado(job, 'imprimiendo');
      const resultado = await conTimeout(dispatch(job), TIMEOUT_JOB_MS);
      notificarEstado(job, 'impreso', resultado);
    } catch (err) {
      job.intentos += 1;
      if (job.intentos < MAX_INTENTOS) {
        job.ultimo_error = err.message;
        pendientes.push(job);
      } else {
        console.error(`[queue] Job ${job.id} fallo definitivamente:`, err.message);
        notificarEstado(job, 'fallo_definitivo', err.message);
      }
    }
  }
  guardarCola(pendientes);
}

let procesandoCiclo = false;

async function cicloDeProcesamiento() {
  // Si el ciclo anterior todavia no termino (ej. un trabajo de HTML que
  // tarda mas de 5 segundos), NO arrancar uno nuevo encima -- eso causaba
  // que dos ciclos leyeran/escribieran el mismo archivo de cola al mismo
  // tiempo, pisandose entre si (contador de intentos que nunca avanzaba,
  // trabajos exitosos reportados como impresos varias veces).
  if (procesandoCiclo) return;

  procesandoCiclo = true;
  try {
    await procesarCola();
  } catch (err) {
    console.error('[queue] Error inesperado procesando la cola:', err.message);
  } finally {
    procesandoCiclo = false;
  }
}

function iniciarProcesamiento() {
  setInterval(cicloDeProcesamiento, INTERVALO_MS);
  cicloDeProcesamiento();
}

module.exports = { inicializarRutas, encolar, procesarCola, iniciarProcesamiento, onEstadoJob, leerCola };
