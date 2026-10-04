# Control de Papel Bond

Herramienta para controlar el ingreso y la salida de papel bond A4 en una oficina, con cargo firmado por quien lo recibe.

Registra cada movimiento por cajas y paquetes, mantiene el stock al día y numera cada entrega en una planilla A4 de 15 filas para la firma. Funciona con Google Sheets y Apps Script, sin instalar software.

**Estado:** recién implementado (octubre de 2026). No es un desarrollo oficial de ninguna institución.

## Qué hace

- Registra ingresos (proveedor u otra oficina) y salidas (persona, área, quién autorizó y por qué medio) desde un formulario dentro de la hoja.
- Cuenta en cajas y paquetes: 1 caja = 10 paquetes de 500 hojas. No admite hojas sueltas.
- Rechaza una salida mayor al stock disponible y evita cargos duplicados cuando registran varias personas a la vez.
- Asigna a cada salida un N° de cargo y su fila en la planilla de firmas: una hoja A4 cada 15 entregas en lugar de un cargo por entrega.
- Sube el escaneo de la planilla firmada a Drive y marca como firmadas sus entregas.
- Muestra el stock con alerta configurable, las entregas pendientes de firma y reportes por período (consumo por área y por persona, ingresos por origen) y mes a mes.
- Exporta el resumen a PDF en Drive.
- Protege la hoja de movimientos con aviso ante ediciones manuales.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `src/Codigo.gs` | Menú, formulario, registro, planilla, escaneos, reportes y configuración inicial |
| `src/Formulario.html` | Formulario de ingreso y salida |
| `test/codigo.test.js` | Pruebas de la lógica pura: stock, numeración de cargos, planillas y cantidades |

## Pruebas

Requieren Node.js (probado con la versión 24), sin dependencias:

```bash
node --test
```

GitHub Actions las ejecuta en cada push.

## Instalación

1. Crear una hoja de Google Sheets en blanco con la cuenta que será propietaria.
2. En **Extensiones → Apps Script**, pegar `src/Codigo.gs` en `Código.gs` y crear un archivo HTML llamado `Formulario` con el contenido de `src/Formulario.html`. También se puede subir con [clasp](https://github.com/google/clasp) (`clasp push` con `--rootDir src`).
3. Al inicio de `Codigo.gs`, configurar `INSTITUCION`, `OFICINA` y `MANUAL_URL` (enlace a un manual de uso compartido).
4. Recargar la hoja y ejecutar **Papel Bond → Configuración inicial**: pide el stock inicial en paquetes y crea las hojas Resumen, Movimientos y Planilla.
5. Opcional: insertar el logo de la institución en la celda superior izquierda de la hoja Planilla.

Para imprimir la planilla: **Archivo → Imprimir**, A4, ajustar al ancho, sin cuadrícula.

## Datos

Los movimientos, escaneos y reportes viven en la hoja y en el Drive de quien la usa; el repositorio no contiene datos. Los escaneos de planillas firmadas llevan nombres y firmas: no deben subirse aquí.

## Licencia

[MIT](LICENSE)
