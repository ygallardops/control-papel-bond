# Control de Papel Bond

[![Pruebas](https://github.com/ygallardops/control-papel-bond/actions/workflows/pruebas.yml/badge.svg)](https://github.com/ygallardops/control-papel-bond/actions/workflows/pruebas.yml)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)
![Sin dependencias](https://img.shields.io/badge/dependencias-0-brightgreen)

Herramienta para controlar el ingreso y la salida de papel bond A4 en una oficina, con cargo firmado por quien lo recibe.

Registra cada movimiento por cajas y paquetes, mantiene el stock al día y numera cada entrega en una planilla A4 de 15 filas para la firma. Funciona con Google Sheets y Apps Script, sin instalar software.

> [!NOTE]
> Recién implementado (octubre de 2026). No es un desarrollo oficial de ninguna institución.

![Formulario de salida, de ingreso y confirmación del registro](docs/formulario.png)

Las capturas de este documento usan datos ficticios (ver [Capturas](#capturas)).

## Contenido

- [Cómo funciona](#cómo-funciona)
- [Qué hace](#qué-hace)
- [Hojas](#hojas)
- [Instalación](#instalación)
- [Uso](#uso)
- [Estructura](#estructura)
- [Pruebas](#pruebas)
- [Capturas](#capturas)
- [Datos](#datos)
- [Licencia](#licencia)

## Cómo funciona

En lugar de un cargo por entrega, se imprime una hoja A4 cada 15 entregas (constante `FILAS_PLANILLA` de `Codigo.gs`).

```mermaid
flowchart LR
    A[Registrar la salida<br>en el formulario] --> B[El script asigna<br>N° de cargo y fila]
    B --> C[Quien recibe firma<br>esa fila de la planilla]
    C --> D{¿Planilla<br>completa?}
    D -- No --> A
    D -- Sí --> E[Escanear y subir<br>la planilla firmada]
    E --> F[Sus entregas quedan<br>marcadas como firmadas]
```

1. Cada salida se registra en el formulario, que le asigna un N° de cargo y una fila en la planilla.
2. Quien recibe escribe su nombre y la cantidad, y firma esa fila en la planilla impresa.
3. Cuando la planilla completa sus filas, se escanea y se sube: sus entregas quedan marcadas como firmadas.

## Qué hace

- Registra ingresos (proveedor u otra oficina) y salidas (persona, área, quién autorizó y por qué medio) desde un formulario dentro de la hoja, que sugiere los nombres y áreas ya usados.
- Cuenta en cajas y paquetes: 1 caja = 10 paquetes de 500 hojas (constante `PAQ_POR_CAJA`). No admite hojas sueltas.
- Rechaza una salida mayor al stock disponible y evita cargos duplicados cuando registran varias personas a la vez.
- Muestra en el formulario, antes de registrar, el N° de cargo y la planilla que corresponden a la entrega.
- Genera la planilla en PDF A4 vertical, lista para imprimir y llenar a mano.
- Sube el escaneo de la planilla firmada a una carpeta compartida de Drive, marca como firmadas sus entregas y muestra en la planilla si ya tiene escaneo.
- Estima cuántas semanas alcanza el stock al ritmo de las salidas de los últimos 30 días y avisa cuando baja del mínimo configurado.
- Calcula reportes por período: consumo por área y por persona, ingresos por origen, mes a mes y por área en los últimos meses.
- Exporta el Resumen a PDF en Drive, en una hoja A4 vertical.
- Protege la hoja de movimientos con aviso ante ediciones manuales.

## Hojas

La configuración inicial crea tres hojas:

| Hoja | Contenido | Se edita a mano |
| --- | --- | --- |
| Resumen | Stock, pendientes de firma y reportes del período | Solo las celdas amarillas |
| Movimientos | Un registro por cada ingreso o salida | Solo para corregir errores |
| Planilla | Vista imprimible de 15 cargos | Solo el N° de planilla |

### Resumen

El script la redibuja tras cada registro o edición. Las celdas amarillas son la alerta de stock y las fechas del período.

| Tarjeta | Muestra |
| --- | --- |
| Stock actual | Paquetes disponibles, su equivalente en cajas y cuántas semanas alcanzan. En rojo si quedan tantos paquetes como la alerta o menos |
| Pendientes de firma | Salidas sin la casilla Firmado marcada (en ámbar si hay alguna, en verde si no) y el próximo N° de cargo y de planilla |
| Alerta de stock | Mínimo en paquetes; se edita en la celda amarilla (5 por defecto) |

Debajo de las tarjetas están los ingresos y salidas del período elegido y los reportes, uno debajo de otro, con el mismo diseño que el PDF exportado.

<img src="docs/resumen.png" alt="Hoja Resumen con stock, pendientes de firma y reportes por período" width="620">

### Planilla

Se imprime en blanco para llenarla a mano. En pantalla, cada fila se completa con lo registrado, lo que sirve para revisar o reimprimir.

<img src="docs/planilla.png" alt="Planilla de cargos N° 2 con nueve entregas registradas" width="720">

## Instalación

1. Crear una hoja de Google Sheets en blanco con la cuenta que será propietaria.
2. En <kbd>Extensiones</kbd> → <kbd>Apps Script</kbd>, pegar [`src/Codigo.gs`](src/Codigo.gs) en `Código.gs` y crear un archivo HTML llamado `Formulario` con el contenido de [`src/Formulario.html`](src/Formulario.html).
3. Al inicio de `Codigo.gs`, configurar estos valores:

   | Constante | Uso |
   | --- | --- |
   | `INSTITUCION` | Nombre que aparece en el Resumen y en la planilla |
   | `OFICINA` | Oficina responsable del papel |
   | `MANUAL_URL` | Enlace a un manual de uso compartido (opcional) |
   | `CARPETA_ESCANEOS_ID` | Id de la carpeta de Drive para los escaneos, compartida como Editor con quienes los suben (opcional; vacío, cada persona los guarda en su propio Drive) |

4. Recargar la hoja y ejecutar <kbd>Papel Bond</kbd> → <kbd>Configuración inicial</kbd>: pide el stock inicial en paquetes y crea las hojas.
5. Opcional: insertar el logo de la institución en la celda superior izquierda de la hoja Planilla.

<details>
<summary>Alternativa: subir el código con clasp</summary>

Con [clasp](https://github.com/google/clasp) instalado y la sesión iniciada, crear un `.clasp.json` con el ID del script y `"rootDir": "src"`, y luego:

```bash
clasp push
```

`.clasp.json` está en `.gitignore`: no se sube al repositorio.

</details>

<details>
<summary>Permisos que solicita el script</summary>

La primera vez, Google pide autorizar el script. Los necesita para:

- leer y escribir la hoja de cálculo;
- crear en Drive las carpetas de escaneos y de reportes, y guardar ahí los archivos;
- generar los PDF de la planilla y del Resumen;
- anotar el correo de quien registra cada movimiento.

</details>

## Uso

Todo se hace desde el menú <kbd>Papel Bond</kbd> de la hoja:

| Opción | Qué hace |
| --- | --- |
| Registrar movimiento | Abre el formulario de salida o ingreso |
| Ir a la planilla actual | Muestra la planilla que se está llenando |
| Imprimir planilla | Abre en PDF la planilla que muestra la hoja |
| Subir escaneo de planilla firmada | Guarda el escaneo (PDF o imagen, máx. 10 MB) en la carpeta de escaneos y marca sus entregas como firmadas |
| Actualizar resumen | Redibuja la hoja Resumen |
| Exportar reporte a PDF | Guarda en Drive el Resumen del período elegido |
| Manual de uso | Abre el enlace configurado en `MANUAL_URL` |

> [!TIP]
> Los errores se corrigen editando la hoja Movimientos; el Resumen se actualiza después de cada edición.

## Estructura

```text
.
├── src
│   ├── Codigo.gs          Menú, registro, planilla, escaneos, reportes y configuración inicial
│   ├── Formulario.html    Formulario de ingreso y salida
│   └── appsscript.json    Manifiesto de Apps Script (zona horaria y entorno de ejecución)
├── test
│   └── codigo.test.js     Pruebas de la lógica pura
└── docs                   Capturas de este documento
    └── capturas           Páginas HTML que generan las capturas
```

## Pruebas

Cubren la lógica pura: stock, cobertura del stock, cargos, planillas, cantidades y agregaciones de los reportes. Requieren Node.js (probado con la versión 24), sin dependencias:

```bash
node --test
```

GitHub Actions las ejecuta en cada push y pull request.

## Capturas

Cada captura de `docs/` se genera desde una página HTML de `docs/capturas/`, con datos ficticios:

| Captura | Generador | Origen del diseño |
| --- | --- | --- |
| `formulario.png` | [`formulario.html`](docs/capturas/formulario.html) | Carga `src/Formulario.html` y simula las respuestas del servidor |
| `resumen.png` | [`resumen.html`](docs/capturas/resumen.html) | Reproduce la hoja que dibuja `renderResumen()` |
| `planilla.png` | [`planilla.html`](docs/capturas/planilla.html) | Reproduce la hoja que crea `crearPlanilla_()`, con un logo de ejemplo |

Para regenerar una, se ejecuta desde la raíz del repositorio el comando anotado al inicio de su HTML, con Microsoft Edge o Chrome sin interfaz. Por ejemplo, el Resumen:

```bash
msedge --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=736,1223 --screenshot=docs/resumen.png docs/capturas/resumen.html
```

> [!NOTE]
> El generador del formulario usa el formulario real: tras un cambio, basta con volver a ejecutarlo. `resumen.html` y `planilla.html` copian el diseño a mano: si cambia el diseño de esas hojas en `Codigo.gs`, hay que ajustar también su HTML.

## Datos

Los movimientos, escaneos y reportes viven en la hoja y en el Drive de quien la usa; el repositorio no contiene datos.

> [!WARNING]
> Los escaneos de planillas firmadas llevan nombres y firmas: no deben subirse aquí.

## Licencia

[MIT](LICENSE)
