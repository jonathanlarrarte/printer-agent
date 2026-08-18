let formPlataformaCargado = false;

function actualizarEstadoPlataforma(estado) {
  const form = document.getElementById('form-plataforma');
  if (!formPlataformaCargado) {
    form.plataforma_url.value = estado.plataforma_url || '';
    form.cliente_codigo.value = estado.cliente_codigo === 'sin-asignar' ? '' : estado.cliente_codigo;
    formPlataformaCargado = true;
  }

  const p = document.getElementById('plataforma-estado');
  if (!estado.plataforma_url) {
    p.innerHTML = 'Sin configurar todavia -- completa la URL y el codigo de cliente abajo.';
  } else if (estado.plataforma_conectado) {
    p.innerHTML = '<span class="badge-online">Conectado</span>';
  } else {
    p.innerHTML = '<span class="badge-offline">Configurado, esperando conexion...</span>';
  }
}

async function cargarEstado() {
  const estado = await window.printbridge.obtenerEstado();

  document.getElementById('tarjeta-info').innerHTML = `
    Instalacion: <strong>${estado.instalacion_id}</strong><br>
    Cliente: <strong>${estado.cliente_codigo}</strong><br>
    Version: <strong>${estado.version}</strong><br>
    Canal de impresion: <strong>ws://localhost:${estado.puerto_ws}/ws</strong><br>
    Token (usar en la integracion del POS): <code>${estado.token}</code>
  `;

  actualizarEstadoPlataforma(estado);

  const tbody = document.getElementById('tbody-impresoras');
  tbody.innerHTML = '';
  Object.entries(estado.impresoras || {}).forEach(([alias, cfg]) => {
    const hb = (estado.heartbeat || {})[alias];
    const online = hb ? hb.online : null;
    const destino = cfg.tipo === 'red' ? `${cfg.ip}:${cfg.puerto}` : cfg.nombre_sistema;
    const badge = online === null
      ? '-'
      : (online ? '<span class="badge-online">Online</span>' : '<span class="badge-offline">Offline</span>');

    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td>${alias}</td><td>${cfg.tipo}</td><td>${destino}</td><td>${badge}</td>
      <td><button data-alias="${alias}" class="btn-eliminar">Eliminar</button></td>
    `;
    tbody.appendChild(fila);
  });

  document.querySelectorAll('.btn-eliminar').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.printbridge.eliminarImpresora(btn.dataset.alias);
      cargarEstado();
    });
  });
}

async function cargarImpresorasSistema() {
  const impresoras = await window.printbridge.listarImpresorasDisponibles();
  const select = document.getElementById('select-impresoras');
  select.innerHTML = impresoras
    .map((p) => `<option value="${p.nombre}">${p.nombre} (${p.estado})</option>`)
    .join('') || '<option value="">No se detectaron impresoras</option>';
}

document.getElementById('select-tipo').addEventListener('change', (e) => {
  const esRed = e.target.value === 'red';
  document.getElementById('campos-usb').style.display = esRed ? 'none' : 'block';
  document.getElementById('campos-red').style.display = esRed ? 'block' : 'none';
});

document.getElementById('form-impresora').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const datos = Object.fromEntries(fd.entries());
  await window.printbridge.guardarImpresora(datos);
  e.target.reset();
  cargarEstado();
});

document.getElementById('btn-carpeta').addEventListener('click', () => {
  window.printbridge.abrirCarpetaDatos();
});

document.getElementById('form-plataforma').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const datos = Object.fromEntries(fd.entries());
  const mensajeEl = document.getElementById('plataforma-mensaje');

  mensajeEl.textContent = 'Conectando...';
  mensajeEl.className = '';

  const resultado = await window.printbridge.guardarPlataforma(datos);

  mensajeEl.textContent = resultado.mensaje;
  mensajeEl.className = resultado.ok ? 'badge-online' : 'badge-offline';
  actualizarEstadoPlataforma(resultado);
});

cargarEstado();
cargarImpresorasSistema();
setInterval(cargarEstado, 10000);
