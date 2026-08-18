# Ejemplo de integración en Vue

```vue
<script setup>
import { onMounted } from 'vue';
import { PrintBridge } from './printbridge-sdk';

const pb = new PrintBridge({ token: import.meta.env.VITE_PRINTBRIDGE_TOKEN });

onMounted(async () => {
  await pb.conectar();
});

async function imprimirVentaCompleta(venta) {
  // 1. Recibo en la impresora térmica
  await pb.print({
    target: 'receipt',
    format: 'escpos',
    data: {
      negocio: 'Parque Aventura',
      encabezado: ['NIT 900.123.456-7', `Caja ${venta.caja}`],
      items: venta.items,
      total: venta.total
    }
  });

  // 2. Brazalete en la impresora TSC (mismo equipo, otra impresora física)
  await pb.print({
    target: 'wristband',
    format: 'tspl',
    data: {
      nombre: venta.cliente.nombre,
      codigo: venta.codigoAcceso,
      fecha: new Date().toLocaleDateString('es-CO')
    }
  });
}
</script>
```

El desarrollador que integra **nunca** necesita saber:
- El nombre exacto de la impresora en Windows.
- Si es USB o de red.
- El lenguaje de comandos (ESC/POS vs TSPL).

Todo eso vive en la configuración local del agente (`config.json`), asociada
al alias lógico (`receipt`, `wristband`, etc.).
