/** Control de Papel Bond A4 — Google Sheets + Apps Script */

const PAQ_POR_CAJA = 10;    // paquetes (de 500 hojas) por caja
const FILAS_PLANILLA = 15;  // filas de firma por planilla A4
// Configura estos tres valores antes de la "Configuración inicial"
const INSTITUCION = 'Nombre de la institución';
const OFICINA = 'Nombre de la oficina';
const MANUAL_URL = ''; // enlace al manual de uso (por ejemplo, un Google Doc compartido)
const ENCABEZADOS =['Fecha', 'Tipo', 'Cajas', 'Paquetes', 'Total paquetes', 'Cantidad', 'Origen / Área',
  'Entregado por', 'Recibido por', 'Autorizado por', 'Medio', 'Cargo N°', 'Firmado', 'Registrado por', 'Registrado el',
  'Escaneo planilla'];
// Índices (base 0) de columnas en la hoja Movimientos
const C = { FECHA: 0, TIPO: 1, TOTAL: 4, LUGAR: 6, ENTREGA: 7, RECIBE: 8, AUTORIZA: 9, CARGO: 11, FIRMADO: 12, ESCANEO: 15 };
// Celdas editables (amarillas) del Resumen: se conservan cada vez que se redibuja
const R = { MIN: 'E6', DESDE: 'B10', HASTA: 'D10' };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Papel Bond')
    .addItem('Registrar movimiento', 'abrirFormulario')
    .addItem('Ir a la planilla actual', 'irPlanillaActual')
    .addItem('Imprimir planilla', 'imprimirPlanilla')
    .addItem('Subir escaneo de planilla firmada', 'abrirEscaneo')
    .addItem('Actualizar resumen', 'renderResumen')
    .addItem('Exportar reporte a PDF', 'exportarReportePdf')
    .addItem('Manual de uso', 'abrirManual')
    .addSeparator()
    .addItem('Configuración inicial (solo una vez)', 'configurar')
    .addToUi();
  const mov = SpreadsheetApp.getActive().getSheetByName('Movimientos');
  if (mov && !mov.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) protegerMovimientos_(mov);
  renderResumen(); // "Actualizado" y el período por defecto quedan al día
}

// Redibuja el Resumen al editar sus celdas amarillas o la hoja Movimientos (p. ej. la casilla Firmado)
function onEdit(e) {
  const nombre = e.range.getSheet().getName();
  if (nombre === 'Movimientos' || (nombre === 'Resumen' && Object.values(R).includes(e.range.getA1Notation())))
    renderResumen();
  if (nombre === 'Planilla' && e.range.getA1Notation() === 'C4') ordenarPlanilla_(e.range.getSheet());
}

function abrirFormulario() {
  const html = HtmlService.createHtmlOutputFromFile('Formulario').setWidth(420).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Movimiento de papel bond');
}

// ---------- Llamadas desde el formulario ----------

function datosFormulario() {
  const filas = filasMovimientos_();
  const unicos = i => [...new Set(filas.map(r => String(r[i]).trim()).filter(Boolean))].sort();
  return {
    paqCaja: PAQ_POR_CAJA,
    stock: calcularStock(filas),
    proximoCargo: siguienteCargo(filas),
    filasPlanilla: FILAS_PLANILLA,
    minimo: Number(hoja_('Resumen').getRange(R.MIN).getValue()) || 0,
    custodio: PropertiesService.getUserProperties().getProperty('custodio') || '',
    lugares: unicos(C.LUGAR),
    personas: [...new Set([...unicos(C.ENTREGA), ...unicos(C.RECIBE)])].sort(),
    autorizadores: unicos(C.AUTORIZA),
  };
}

function registrar(f) {
  const tipo = ['INGRESO', 'SALIDA'].includes(f.tipo) ? f.tipo : null;
  if (!tipo) throw new Error('Tipo de movimiento inválido.');
  const cajas = Number(f.cajas) || 0, paquetes = Number(f.paquetes) || 0;
  if (![cajas, paquetes].every(n => Number.isInteger(n) && n >= 0) || cajas + paquetes === 0)
    throw new Error('Indica una cantidad válida (cajas y/o paquetes enteros, mayor a cero).');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.fecha || '');
  if (!m) throw new Error('Fecha inválida.');
  const fecha = new Date(m[1], m[2] - 1, m[3], 12); // mediodía: evita saltos de día por zona horaria

  // Texto libre: se recorta y se evita que se interprete como fórmula
  const t = k => String(f[k] || '').trim().replace(/^[=+\-@]/, "'$&");
  const requeridos = tipo === 'SALIDA'
    ? { recibe: 'Persona que recibe', lugar: 'Área', autoriza: 'Autorizado por', entrega: 'Entregado por' }
    : { lugar: 'Origen', entrega: 'Persona que entrega', recibe: 'Recibido por' };
  for (const k in requeridos) if (!t(k)) throw new Error(`Falta completar: ${requeridos[k]}.`);

  const lock = LockService.getDocumentLock();
  lock.waitLock(15000); // varios usuarios: evita cargos duplicados
  try {
    const sh = hoja_('Movimientos');
    const filas = filasMovimientos_(sh);
    const total = cajas * PAQ_POR_CAJA + paquetes;
    const stock = calcularStock(filas);
    if (tipo === 'SALIDA' && total > stock) throw new Error(`Stock insuficiente: solo hay ${stock} paquete(s).`);
    const salida = tipo === 'SALIDA';
    const cargo = salida ? siguienteCargo(filas) : '';

    sh.appendRow([fecha, tipo, cajas, paquetes, total, cantidadTexto(cajas, paquetes), t('lugar'), t('entrega'),
      t('recibe'), salida ? t('autoriza') : '', salida ? t('medio') : '', cargo, '',
      Session.getActiveUser().getEmail(), new Date()]);
    if (salida) sh.getRange(sh.getLastRow(), C.FIRMADO + 1).insertCheckboxes();
    PropertiesService.getUserProperties().setProperty('custodio', salida ? t('entrega') : t('recibe'));
    renderResumen();

    return {
      tipo, cargo, cantidad: cantidadTexto(cajas, paquetes),
      planilla: salida ? Math.ceil(cargo / FILAS_PLANILLA) : '',
      stock: stock + (salida ? -total : total),
    };
  } finally {
    lock.releaseLock();
  }
}

function irPlanillaActual() {
  const sh = hoja_('Planilla');
  sh.getRange('C4').setValue(Math.ceil(siguienteCargo(filasMovimientos_()) / FILAS_PLANILLA));
  ordenarPlanilla_(sh);
  sh.activate();
}

// PDF de la planilla que muestra la hoja (celda Planilla N°), listo para imprimir: A4 vertical, sin cuadrícula ni notas
function urlPlanillaPdf_() {
  const ss = SpreadsheetApp.getActive(), sh = hoja_('Planilla');
  SpreadsheetApp.flush();
  return `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=pdf&gid=${sh.getSheetId()}` +
    `&r1=0&c1=0&r2=${6 + FILAS_PLANILLA + 3}&c2=${PLANILLA_COLUMNAS.length}` +
    '&size=A4&portrait=true&fitw=true&gridlines=false&printnotes=false&printtitle=false&sheetnames=false' +
    '&pagenum=UNDEFINED&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4';
}

function imprimirPlanilla() {
  const sh = hoja_('Planilla'), n = sh.getRange('C4').getValue();
  ordenarPlanilla_(sh);
  dialogoEnlace_('Imprimir planilla', `Abrir la planilla N° ${n} en PDF para imprimir`, urlPlanillaPdf_());
}

// Apps Script no abre pestañas directamente: se intenta con window.open y queda el enlace por si el navegador lo bloquea
function abrirManual() {
  if (!MANUAL_URL) throw new Error('Falta configurar MANUAL_URL al inicio de Codigo.gs.');
  dialogoEnlace_('Manual de uso', 'Abrir el manual de uso', MANUAL_URL);
}

function dialogoEnlace_(titulo, texto, url) {
  const html = HtmlService.createHtmlOutput(`
<p style="font:14px Arial,sans-serif"><a href="${url}" target="_blank" onclick="setTimeout(google.script.host.close, 300)">${texto}</a></p>
<script>if (window.open('${url}', '_blank')) google.script.host.close();</script>`).setWidth(320).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, titulo);
}

// Exporta el Resumen (A4 vertical, solo el área dibujada) a PDF y lo guarda en Drive
function exportarReportePdf() {
  const ss = SpreadsheetApp.getActive(), sh = hoja_('Resumen');
  renderResumen();
  const [desde, hasta] = [R.DESDE, R.HASTA].map(a => sh.getRange(a).getValue());
  if (!(desde instanceof Date) || !(hasta instanceof Date))
    throw new Error('Revisa las fechas "desde" y "hasta" en la hoja Resumen.');
  SpreadsheetApp.flush();
  const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=pdf&gid=${sh.getSheetId()}` +
    `&r1=0&c1=0&r2=${sh.getLastRow()}&c2=6&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false` +
    '&sheetnames=false&pagenum=CENTER&horizontal_alignment=CENTER' +
    '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
  const resp = UrlFetchApp.fetch(url,
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error(`No se pudo generar el PDF (código ${resp.getResponseCode()}).`);
  const f = d => Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), 'dd-MM-yyyy');
  const archivo = carpeta_('carpetaReportes', 'Reportes - Papel Bond')
    .createFile(resp.getBlob().setName(`Reporte papel bond ${f(desde)} al ${f(hasta)}.pdf`));
  dialogoEnlace_('Reporte PDF', 'Abrir el reporte PDF', archivo.getUrl());
}

// ---------- Escaneo de planillas firmadas ----------

function abrirEscaneo() {
  const ultima = Math.max(1, Math.ceil((siguienteCargo(filasMovimientos_()) - 1) / FILAS_PLANILLA));
  const html = HtmlService.createHtmlOutput(`
<div style="font:14px Arial,sans-serif;padding:6px">
  <label><b>Planilla N°</b><br><input id="n" type="number" min="1" value="${ultima}" style="width:100%;padding:6px"></label><br><br>
  <label><b>Archivo escaneado (PDF o imagen, máx. 10 MB)</b><br><input id="f" type="file" accept="application/pdf,image/*"></label><br><br>
  <button id="b" onclick="subir()" style="padding:9px 14px;font-weight:bold">Subir</button>
  <p id="m"></p>
</div>
<script>
  function subir() {
    var file = document.getElementById('f').files[0], m = document.getElementById('m'), b = document.getElementById('b');
    if (!file) return m.textContent = 'Elige un archivo.';
    if (file.size > 10 * 1024 * 1024) return m.textContent = 'El archivo supera 10 MB.';
    b.disabled = true; m.textContent = 'Subiendo…';
    var r = new FileReader();
    r.onload = function () {
      google.script.run
        .withSuccessHandler(function (x) { b.disabled = false; m.textContent = '✔ Subido. ' + x.filas + ' entrega(s) marcadas como firmadas.'; })
        .withFailureHandler(function (e) { b.disabled = false; m.textContent = e.message; })
        .subirEscaneo(document.getElementById('n').value, { nombre: file.name, tipo: file.type, base64: r.result.split(',')[1] });
    };
    r.readAsDataURL(file);
  }
</script>`).setWidth(400).setHeight(280);
  SpreadsheetApp.getUi().showModalDialog(html, 'Subir escaneo de planilla');
}

function subirEscaneo(planilla, archivo) {
  planilla = Number(planilla);
  if (!Number.isInteger(planilla) || planilla < 1) throw new Error('N° de planilla inválido.');
  if (!/^(application\/pdf|image\/)/.test(archivo.tipo)) throw new Error('Sube un PDF o una imagen.');
  const sh = hoja_('Movimientos');
  const indices = filasDePlanilla(filasMovimientos_(sh), planilla);
  if (!indices.length) throw new Error(`La planilla N° ${planilla} no tiene entregas registradas.`);

  const punto = archivo.nombre.lastIndexOf('.');
  const ext = punto > 0 ? archivo.nombre.slice(punto) : '';
  const blob = Utilities.newBlob(Utilities.base64Decode(archivo.base64), archivo.tipo, `Planilla N° ${planilla}${ext}`);
  const url = carpeta_('carpetaEscaneos', 'Escaneos - Planillas Papel Bond').createFile(blob).getUrl();

  sh.getRange(1, C.ESCANEO + 1).setValue('Escaneo planilla'); // por si la hoja se creó antes de esta columna
  indices.forEach(i => {
    sh.getRange(i + 2, C.FIRMADO + 1).setValue(true);
    sh.getRange(i + 2, C.ESCANEO + 1).setValue(url);
  });
  renderResumen();
  return { filas: indices.length };
}

function carpeta_(clave, nombre) {
  const props = PropertiesService.getDocumentProperties();
  const id = props.getProperty(clave);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* carpeta eliminada: se crea otra */ }
  }
  const f = DriveApp.createFolder(nombre);
  props.setProperty(clave, f.getId());
  return f;
}

// ---------- Lógica pura (probada en test/codigo.test.js) ----------

// Índices (en `filas`) de las salidas cuyo cargo cae en la planilla indicada
function filasDePlanilla(filas, planilla) {
  return filas.map((r, i) => Math.ceil((Number(r[C.CARGO]) || 0) / FILAS_PLANILLA) === planilla ? i : -1)
    .filter(i => i >= 0);
}

function calcularStock(filas) {
  return filas.reduce((s, r) =>
    s + (r[C.TIPO] === 'INGRESO' ? 1 : r[C.TIPO] === 'SALIDA' ? -1 : 0) * (Number(r[C.TOTAL]) || 0), 0);
}

function siguienteCargo(filas) {
  return Math.max(0, ...filas.map(r => Number(r[C.CARGO]) || 0)) + 1;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Movimientos de un tipo entre dos fechas (inclusive, por día), agrupados por columna y ordenados de mayor a menor
function agrupar(filas, tipo, col, desde, hasta) {
  const fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() + 1);
  const totales = {};
  filas.filter(r => r[C.TIPO] === tipo && r[C.FECHA] instanceof Date && r[C.FECHA] >= desde && r[C.FECHA] < fin)
    .forEach(r => { const k = String(r[col]).trim() || '(sin dato)'; totales[k] = (totales[k] || 0) + Number(r[C.TOTAL]); });
  return Object.entries(totales).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// [nombre, total] → [nombre, total, % del total, barra de texto]
function conBarras(lista) {
  const total = lista.reduce((s, [, n]) => s + n, 0), max = lista.length ? lista[0][1] : 0;
  return lista.map(([k, n]) => [k, n, total ? n / total : 0, '█'.repeat(Math.max(1, Math.round(n / max * 14)))]);
}

// Últimos n meses hasta `hoy` (desde el primer mes con movimientos): [mes, ingresos, salidas, saldo al cierre]
function mesAMes(filas, hoy, n) {
  const datadas = filas.filter(r => r[C.FECHA] instanceof Date);
  if (!datadas.length) return [];
  const primero = new Date(Math.min(...datadas.map(r => r[C.FECHA])));
  const salida = [];
  for (let i = n - 1; i >= 0; i--) {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1), fin = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
    if (fin <= new Date(primero.getFullYear(), primero.getMonth(), 1)) continue;
    const suma = (tipo, desde) => datadas.filter(r => r[C.TIPO] === tipo && r[C.FECHA] >= desde && r[C.FECHA] < fin)
      .reduce((s, r) => s + Number(r[C.TOTAL]), 0);
    salida.push([`${MESES[ini.getMonth()]} ${ini.getFullYear()}`, suma('INGRESO', ini), suma('SALIDA', ini),
      suma('INGRESO', new Date(0)) - suma('SALIDA', new Date(0))]);
  }
  return salida;
}

// Consumo por área en los últimos n meses: { meses: [etiquetas], filas: [[área, ...n valores]] } por total desc
function areasPorMes(filas, hoy, n) {
  const meses = [...Array(n)].map((_, i) => new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - i), 1));
  const porArea = {};
  meses.forEach((ini, i) => agrupar(filas, 'SALIDA', C.LUGAR, ini, new Date(ini.getFullYear(), ini.getMonth() + 1, 0))
    .forEach(([area, total]) => { (porArea[area] = porArea[area] || Array(n).fill(0))[i] = total; }));
  const suma = v => v.reduce((a, b) => a + b, 0);
  return {
    meses: meses.map(d => `${MESES[d.getMonth()]} ${d.getFullYear()}`),
    filas: Object.entries(porArea).sort((a, b) => suma(b[1]) - suma(a[1])).map(([area, v]) => [area, ...v]),
  };
}

function cantidadTexto(cajas, paquetes) {
  const n = (x, s, p) => `${x} ${x === 1 ? s : p}`;
  return [cajas && n(cajas, 'caja', 'cajas'), paquetes && n(paquetes, 'paquete', 'paquetes')].filter(Boolean).join(' + ');
}

// ---------- Utilidades ----------

function hoja_(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh) throw new Error('Primero ejecuta "Papel Bond > Configuración inicial".');
  return sh;
}

// Solo advertencia: el formulario escribe con la cuenta de quien lo usa, un bloqueo real lo rompería
function protegerMovimientos_(sh) {
  sh.protect().setWarningOnly(true)
    .setDescription('Registra con el menú Papel Bond. Edita a mano solo para corregir errores.');
}

function filasMovimientos_(sh = hoja_('Movimientos')) {
  return sh.getDataRange().getValues().slice(1);
}

// ---------- Resumen (se redibuja completo desde los datos) ----------

const COLOR = {
  primario: '#0b5394', suave: '#e8f0fe', tarjeta: '#f4f7fb', borde: '#d0d7e2', gris: '#5f6368',
  alerta: '#fde8e8', alertaTexto: '#a50e0e', editable: '#fff8e1', zebra: '#f8fafc',
};

function renderResumen() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('Resumen');
  if (!sh || !ss.getSheetByName('Movimientos')) return;
  const filas = filasMovimientos_();

  // Conserva lo que el usuario escribió en las celdas amarillas (fórmula o valor), si es válido
  const fecha = (a, porDefecto) => {
    const r = sh.getRange(a), v = r.getValue();
    return v instanceof Date && v.getFullYear() >= 2000 ? (r.getFormula() || v) : porDefecto;
  };
  const minLeido = sh.getRange(R.MIN).getValue();
  const min = typeof minLeido === 'number' ? minLeido : 10;
  const desde = fecha(R.DESDE, '=EOMONTH(TODAY(),-1)+1'), hasta = fecha(R.HASTA, '=TODAY()');

  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearNote().breakApart();
  sh.setConditionalFormatRules([]);
  sh.setHiddenGridlines(true);
  [200, 85, 85, 85, 85, 85].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1, sh.getMaxRows(), 6).setFontFamily('Arial').setFontSize(9).setVerticalAlignment('middle');
  sh.setRowHeights(1, sh.getMaxRows(), 21);

  // Encabezado
  sh.getRange('A1:F1').merge().setValue('Control de Papel Bond A4').setBackground(COLOR.primario)
    .setFontColor('#ffffff').setFontSize(16).setFontWeight('bold');
  sh.setRowHeight(1, 38);
  sh.getRange('A2:F2').merge().setValue(`${INSTITUCION} · ${OFICINA}`).setFontColor(COLOR.gris).setWrap(true);
  sh.setRowHeight(2, 30);
  const tz = ss.getSpreadsheetTimeZone();
  sh.getRange('A3:F3').merge().setValue('Actualizado: ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontColor(COLOR.gris).setFontSize(8).setFontStyle('italic').setHorizontalAlignment('right');
  sh.setRowHeight(4, 8);

  // Tarjetas
  const stock = calcularStock(filas);
  const pendientes = filas.filter(r => r[C.TIPO] === 'SALIDA' && r[C.FIRMADO] !== true).length;
  const bajo = stock <= min;
  tarjeta_(sh, 1, 'STOCK ACTUAL', stock,
    `${Math.floor(stock / PAQ_POR_CAJA)} caja(s) + ${stock % PAQ_POR_CAJA} paquete(s)` + (bajo ? ' · STOCK BAJO' : ''),
    bajo ? COLOR.alerta : COLOR.tarjeta, bajo ? COLOR.alertaTexto : COLOR.primario);
  tarjeta_(sh, 3, 'PENDIENTES DE FIRMA', pendientes, 'entregas sin firma registrada', COLOR.tarjeta, COLOR.primario);
  tarjeta_(sh, 5, 'ALERTA DE STOCK', min, 'avisa si quedan ≤ (editable)', COLOR.editable, '#202124');
  sh.getRange('A6').setNumberFormat('0 "paquetes"');
  sh.getRange(R.MIN).setNumberFormat('0 "paquetes"');
  sh.setRowHeight(6, 36);
  sh.setRowHeight(8, 10);

  // Período
  seccion_(sh, 9, 'Período del reporte');
  sh.getRange('A10:F11').setValues([
    ['Desde', '', 'Hasta', '', 'Ingresos', ''],
    ['Cambia las fechas amarillas para ver otro período.', '', '', '', 'Salidas', ''],
  ]);
  sh.getRange(R.DESDE).setValue(desde);
  sh.getRange(R.HASTA).setValue(hasta);
  sh.getRange('A10').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('C10').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('E10:E11').setHorizontalAlignment('right').setFontColor(COLOR.gris);
  sh.getRange('A11:D11').merge().setFontSize(8).setFontStyle('italic').setFontColor(COLOR.gris);
  [R.DESDE, R.HASTA].forEach(a => sh.getRange(a).setNumberFormat('dd/mm/yyyy').setBackground(COLOR.editable)
    .setHorizontalAlignment('center').setBorder(true, true, true, true, false, false, COLOR.borde, null));
  SpreadsheetApp.flush();
  const d = sh.getRange(R.DESDE).getValue(), h = sh.getRange(R.HASTA).getValue();
  const okPeriodo = d instanceof Date && h instanceof Date;
  const area = okPeriodo ? agrupar(filas, 'SALIDA', C.LUGAR, d, h) : [];
  const persona = okPeriodo ? agrupar(filas, 'SALIDA', C.RECIBE, d, h) : [];
  const origen = okPeriodo ? agrupar(filas, 'INGRESO', C.LUGAR, d, h) : [];
  const suma = l => l.reduce((s, [, n]) => s + n, 0);
  sh.getRange('F10:F11').setValues([[suma(origen)], [suma(area)]]).setNumberFormat('0 "paq."').setFontWeight('bold');

  // Tablas, una debajo de otra
  const vacio = okPeriodo ? 'Sin movimientos en el período.' : 'Revisa las fechas del período.';
  const hoy = new Date();
  const am = areasPorMes(filas, hoy, 5);
  let fila = 13;
  fila = tabla_(sh, fila, 'Consumo por área', ['Área', 'Paquetes', '%', ''], conBarras(area), true, vacio);
  fila = tabla_(sh, fila, 'Consumo por persona', ['Persona', 'Paquetes', '%', ''], conBarras(persona), true, vacio);
  fila = tabla_(sh, fila, 'Ingresos por origen', ['Origen', 'Paquetes', '%', ''], conBarras(origen), true, vacio);
  fila = tabla_(sh, fila, 'Mes a mes (últimos 12 meses, paquetes)', ['Mes', 'Ingresos', 'Salidas', 'Saldo al cierre'],
    mesAMes(filas, hoy, 12), false, 'Sin movimientos.');
  tabla_(sh, fila, 'Consumo por área (últimos 5 meses, paquetes)', ['Área', ...am.meses], am.filas, false,
    'Sin entregas en los últimos 5 meses.');
}

function tarjeta_(sh, col, etiqueta, valor, nota, fondo, colorValor) {
  sh.getRange(5, col, 3, 2).setBackground(fondo).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, COLOR.borde, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(5, col, 1, 2).merge().setValue(etiqueta).setFontSize(8).setFontWeight('bold').setFontColor(COLOR.gris);
  sh.getRange(6, col, 1, 2).merge().setValue(valor).setFontSize(20).setFontWeight('bold').setFontColor(colorValor);
  sh.getRange(7, col, 1, 2).merge().setValue(nota).setFontSize(8).setFontColor(COLOR.gris);
}

function seccion_(sh, fila, titulo) {
  sh.getRange(fila, 1, 1, 6).merge().setValue(titulo).setFontSize(11).setFontWeight('bold').setFontColor(COLOR.primario)
    .setBorder(null, null, true, null, null, null, COLOR.primario, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

// Dibuja una tabla de hasta 6 columnas desde `fila`; con `barras`, la 4.ª columna (D:F) es una barra de texto.
// Devuelve la siguiente fila libre, dejando una en blanco.
function tabla_(sh, fila, titulo, encabezados, datos, barras, vacio) {
  seccion_(sh, fila, titulo);
  const enc = sh.getRange(fila + 1, 1, 1, 6).setBackground(COLOR.suave).setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encabezados.length).setNumberFormat('@').setValues([encabezados]);
  sh.getRange(fila + 1, 2, 1, 5).setHorizontalAlignment('right');
  if (barras) enc.offset(0, 3, 1, 3).merge();
  if (!datos.length) {
    sh.getRange(fila + 2, 1, 1, 6).merge().setValue(vacio).setFontColor(COLOR.gris).setFontStyle('italic');
    return fila + 4;
  }
  const n = datos.length, cols = datos[0].length;
  sh.getRange(fila + 2, 1, n, 1).setNumberFormat('@'); // nombres y meses como texto ("oct 2026" no es una fecha)
  sh.getRange(fila + 2, 1, n, cols).setValues(datos);
  sh.getRange(fila + 2, 1, n, 6).setBackgrounds(datos.map((_, i) => Array(6).fill(i % 2 ? COLOR.zebra : '#ffffff')))
    .setBorder(null, null, true, null, null, null, COLOR.borde, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(fila + 2, 2, n, 5).setHorizontalAlignment('right');
  if (barras) {
    sh.getRange(fila + 2, 3, n, 1).setNumberFormat('0%');
    for (let i = 0; i < n; i++) sh.getRange(fila + 2 + i, 4, 1, 3).merge();
    sh.getRange(fila + 2, 4, n, 1).setHorizontalAlignment('left').setFontColor(COLOR.primario);
  }
  return fila + 3 + n;
}

// ---------- Configuración inicial ----------

function configurar() {
  const ss = SpreadsheetApp.getActive(), ui = SpreadsheetApp.getUi();
  if (ss.getSheetByName('Movimientos')) return ui.alert('La hoja ya está configurada.');
  const r = ui.prompt('Stock inicial', '¿Cuántos PAQUETES hay hoy en stock? (1 caja = 10 paquetes)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const inicial = parseInt(r.getResponseText(), 10) || 0;

  // Movimientos
  const mov = ss.insertSheet('Movimientos');
  mov.appendRow(ENCABEZADOS);
  mov.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight('bold').setBackground('#0b5394').setFontColor('#ffffff');
  mov.setFrozenRows(1);
  protegerMovimientos_(mov);
  mov.getRange('A:A').setNumberFormat('dd/mm/yyyy');
  mov.getRange('O:O').setNumberFormat('dd/mm/yyyy hh:mm');
  if (inicial > 0) {
    const hoy = new Date();
    mov.appendRow([new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12), 'INGRESO', 0, inicial, inicial,
      cantidadTexto(0, inicial), 'Stock inicial', '', '', '', '', '', '', Session.getActiveUser().getEmail(), hoy]);
  }

  ss.insertSheet('Resumen', 0);
  crearPlanilla_(ss);
  ss.getSheets().filter(s => !['Resumen', 'Movimientos', 'Planilla'].includes(s.getName()) && s.getLastRow() === 0)
    .forEach(s => ss.deleteSheet(s));
  renderResumen();
  ss.getSheetByName('Resumen').activate();
  ui.alert('Listo. Usa el menú "Papel Bond > Registrar movimiento".');
}

// Planilla A4 para imprimir en blanco: quien recibe escribe nombre y cantidad y firma a mano.
// En pantalla, cada fila se llena sola con lo registrado (útil para revisar o reimprimir llena).
const PLANILLA_COLUMNAS = [ // [encabezado, ancho, columna de Movimientos que la llena]
  ['N°', 35], ['Fecha', 75, 'A'], ['Nombre de quien recibe', 190, 'I'], ['Firma de quien recibe', 150],
  ['Área', 110, 'G'], ['Cantidad', 85, 'F'], ['Entregó', 105, 'H'],
];
// Planillas que ya se imprimieron con la firma en la última columna: conservan ese orden (0 = ninguna)
const PLANILLA_FIRMA_AL_FINAL_HASTA = 0;

// Columnas de la planilla N° n, en el orden en que se imprime
function columnasPlanilla(n) {
  if (n > PLANILLA_FIRMA_AL_FINAL_HASTA) return PLANILLA_COLUMNAS;
  const [num, fecha, nombre, firma, ...resto] = PLANILLA_COLUMNAS;
  return [num, fecha, nombre, ...resto, firma];
}

// Pone encabezados, anchos y fórmulas de las columnas D en adelante según el N° de planilla de C4.
// No toca Movimientos ni el formato de la hoja: la planilla es solo una vista.
function ordenarPlanilla_(sh) {
  const cols = columnasPlanilla(Number(sh.getRange('C4').getValue()) || 1), n = cols.length;
  sh.getRange(6, 4, 1, n - 3).setValues([cols.slice(3).map(([t]) => t)]);
  sh.getRange(7, 4, FILAS_PLANILLA, n - 3).clearContent();
  cols.forEach(([, ancho, origen], i) => {
    if (i < 3) return;
    sh.setColumnWidth(i + 1, ancho);
    if (origen) sh.getRange(7, i + 1, FILAS_PLANILLA, 1)
      .setFormula(`=IFERROR(INDEX(Movimientos!${origen}:${origen},MATCH($A7,Movimientos!$L:$L,0)),"")`);
  });
}

function crearPlanilla_(ss) {
  const sh = ss.insertSheet('Planilla');
  sh.setHiddenGridlines(true);
  sh.getRange('A1:B3').merge(); // logo de la institución: Insertar > Imagen > Imagen en la celda
  sh.getRange('C1:G1').merge().setValue(INSTITUCION).setFontWeight('bold').setFontSize(14);
  sh.getRange('C2:G2').merge().setValue(OFICINA).setWrap(true).setFontSize(9);
  sh.getRange('C3:G3').merge().setValue('PLANILLA DE CARGOS – ENTREGA DE PAPEL BOND A4').setFontWeight('bold');
  sh.setRowHeight(2, 32);
  sh.getRange('A4:B4').merge().setValue('Planilla N°').setFontWeight('bold');
  sh.getRange('C4').setValue(1).setFontWeight('bold').setHorizontalAlignment('left').setBackground('#fff2cc');
  formatearPlanilla_(sh);
}

// Encabezados, fórmulas, anchos y bordes de la tabla (filas 5 en adelante). No toca el logo ni el título.
function formatearPlanilla_(sh) {
  const fin = 6 + FILAS_PLANILLA, n = PLANILLA_COLUMNAS.length;
  PLANILLA_COLUMNAS.slice(0, 3).forEach(([, ancho], i) => sh.setColumnWidth(i + 1, ancho));
  sh.getRange(5, 1, 1, n).merge()
    .setValue('Quien recibe escribe su nombre y la cantidad, y firma en la fila del N° de cargo que indica el formulario.')
    .setFontSize(8).setFontStyle('italic');
  sh.getRange(6, 1, 1, n).setFontWeight('bold').setBackground('#d9e2f3').setWrap(true);
  sh.getRange(6, 1, 1, 3).setValues([PLANILLA_COLUMNAS.slice(0, 3).map(([t]) => t)]);
  sh.getRange('A7').setFormula(`=SEQUENCE(${FILAS_PLANILLA},1,($C$4-1)*${FILAS_PLANILLA}+1)`);
  ['A', 'I'].forEach((origen, i) => sh.getRange(7, i + 2, FILAS_PLANILLA, 1)
    .setFormula(`=IFERROR(INDEX(Movimientos!${origen}:${origen},MATCH($A7,Movimientos!$L:$L,0)),"")`));
  ordenarPlanilla_(sh);
  sh.getRange(`B7:B${fin}`).setNumberFormat('dd/mm/yyyy');
  sh.setRowHeights(7, FILAS_PLANILLA, 40);
  sh.getRange(6, 1, FILAS_PLANILLA + 1, n).setBorder(true, true, true, true, true, true)
    .setVerticalAlignment('middle').setFontSize(9).setWrap(true);
  sh.getRange(`A${fin + 3}`)
    .setValue('Revisado por (responsable del papel): ____________________________     Firma: ____________________');
}
