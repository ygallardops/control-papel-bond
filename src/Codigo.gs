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
const C = { TIPO: 1, TOTAL: 4, LUGAR: 6, ENTREGA: 7, RECIBE: 8, AUTORIZA: 9, CARGO: 11, FIRMADO: 12, ESCANEO: 15 };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Papel Bond')
    .addItem('Registrar movimiento', 'abrirFormulario')
    .addItem('Ir a la planilla actual', 'irPlanillaActual')
    .addItem('Subir escaneo de planilla firmada', 'abrirEscaneo')
    .addItem('Exportar reporte a PDF', 'exportarReportePdf')
    .addItem('Manual de uso', 'abrirManual')
    .addSeparator()
    .addItem('Configuración inicial (solo una vez)', 'configurar')
    .addToUi();
  // Hojas configuradas antes de existir el reporte mensual: se agrega una sola vez
  const res = SpreadsheetApp.getActive().getSheetByName('Resumen');
  if (res && !res.getRange('J13').getValue()) crearReporteMensual_(res);
  const mov = SpreadsheetApp.getActive().getSheetByName('Movimientos');
  if (mov && !mov.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) protegerMovimientos_(mov);
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
    minimo: Number(hoja_('Resumen').getRange('B5').getValue()) || 0,
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
  sh.activate();
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

// Exporta la hoja Resumen (período desde/hasta + mes a mes) a PDF A4 horizontal y lo guarda en Drive
function exportarReportePdf() {
  const ss = SpreadsheetApp.getActive(), sh = hoja_('Resumen');
  const [desde, hasta] = sh.getRange('B8:B9').getValues().map(r => r[0]);
  if (!(desde instanceof Date) || !(hasta instanceof Date))
    throw new Error('Revisa las fechas "desde" y "hasta" en la hoja Resumen.');
  SpreadsheetApp.flush();
  const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=pdf&gid=${sh.getSheetId()}` +
    '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER';
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

  crearResumen_(ss);
  crearPlanilla_(ss);
  ss.getSheets().filter(s => !['Resumen', 'Movimientos', 'Planilla'].includes(s.getName()) && s.getLastRow() === 0)
    .forEach(s => ss.deleteSheet(s));
  ss.getSheetByName('Resumen').activate();
  ui.alert('Listo. Usa el menú "Papel Bond > Registrar movimiento".');
}

function crearResumen_(ss) {
  const sh = ss.insertSheet('Resumen', 0);
  sh.setColumnWidth(1, 240);
  sh.getRange('A1').setValue('Control de Papel Bond A4').setFontSize(16).setFontWeight('bold');
  const sumTipo = (tipo, periodo) => `SUMIFS(Movimientos!E:E,Movimientos!B:B,"${tipo}"` +
    (periodo ? ',Movimientos!A:A,">="&$B$8,Movimientos!A:A,"<"&($B$9+1))' : ')');
  sh.getRange('A3:B11').setValues([
    ['Stock actual (paquetes)', `=${sumTipo('INGRESO')}-${sumTipo('SALIDA')}`],
    ['Equivale a', `=INT(B3/${PAQ_POR_CAJA})&" caja(s) + "&MOD(B3,${PAQ_POR_CAJA})&" paquete(s)"`],
    ['Alerta si el stock es ≤ (paquetes)', 10],
    ['Entregas pendientes de firma', '=COUNTIFS(Movimientos!B:B,"SALIDA",Movimientos!M:M,FALSE)'],
    ['', ''],
    ['Reportes — desde', '=EOMONTH(TODAY(),-1)+1'],
    ['Reportes — hasta', '=TODAY()'],
    ['Ingresos en el período (paquetes)', `=${sumTipo('INGRESO', true)}`],
    ['Salidas en el período (paquetes)', `=${sumTipo('SALIDA', true)}`],
  ]);
  sh.getRange('A3:A11').setFontWeight('bold');
  sh.getRange('B3').setFontSize(14).setFontWeight('bold');
  sh.getRange('B5').setBackground('#fff2cc').setNote('Valor configurable: 10 paquetes = 1 caja.');
  sh.getRange('B8:B9').setNumberFormat('dd/mm/yyyy').setBackground('#fff2cc')
    .setNote('Puedes escribir otras fechas para ver otro período.');
  sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B$3<=$B$5').setBackground('#f4cccc').setFontColor('#990000')
    .setRanges([sh.getRange('A3:B4')]).build()]);

  // Reportes por período (columnas: G=Origen/Área, I=Recibido por, E=Total, B=Tipo, A=Fecha)
  const reporte = (col, tipo, etiqueta) => `=IFERROR(QUERY(FILTER(Movimientos!A2:O,Movimientos!B2:B="${tipo}",` +
    `Movimientos!A2:A>=$B$8,Movimientos!A2:A<$B$9+1),"select Col${col}, sum(Col5) group by Col${col} ` +
    `order by sum(Col5) desc label Col${col} '${etiqueta}', sum(Col5) 'Paquetes'",0),"Sin datos")`;
  [['A13', 'Consumo por área', reporte(7, 'SALIDA', 'Área')],
   ['D13', 'Consumo por persona', reporte(9, 'SALIDA', 'Persona')],
   ['G13', 'Ingresos por origen', reporte(7, 'INGRESO', 'Origen')]].forEach(([celda, titulo, formula]) => {
    const r = sh.getRange(celda);
    r.setValue(titulo).setFontWeight('bold').setBackground('#d9e2f3');
    r.offset(1, 0).setFormula(formula);
  });
  [4, 7].forEach(c => sh.setColumnWidth(c, 180));
  crearReporteMensual_(sh);
}

// Todo el historial, mes a mes (no depende de las fechas desde/hasta)
function crearReporteMensual_(sh) {
  const mensual = (where, pivot) => `=IFERROR(QUERY(Movimientos!A2:P,"select year(Col1), month(Col1)+1, sum(Col5) ` +
    `where ${where} group by year(Col1), month(Col1)+1 ` + // group by ya ordena; order by + pivot da #VALUE!
    `pivot ${pivot} label year(Col1) 'Año', month(Col1)+1 'Mes'",0),"Sin datos")`;
  [['J13', 'Mes a mes: ingresos y salidas (paquetes)', mensual('Col1 is not null', 'Col2')],
   ['O13', 'Mes a mes: consumo por área (paquetes)', mensual("Col2='SALIDA'", 'Col7')]].forEach(([celda, titulo, formula]) => {
    const r = sh.getRange(celda);
    r.setValue(titulo).setFontWeight('bold').setBackground('#d9e2f3');
    r.offset(1, 0).setFormula(formula);
  });
}

function crearPlanilla_(ss) {
  const sh = ss.insertSheet('Planilla');
  const fin = 6 + FILAS_PLANILLA;
  sh.setHiddenGridlines(true);
  [40, 80, 125, 100, 90, 100, 100, 130].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('A1:B3').merge().setNote('Logo: Insertar > Imagen > Imagen en la celda.');
  sh.getRange('C1:H1').merge().setValue(INSTITUCION).setFontWeight('bold').setFontSize(14);
  sh.getRange('C2:H2').merge().setValue(OFICINA).setWrap(true).setFontSize(9);
  sh.getRange('C3:H3').merge().setValue('PLANILLA DE CARGOS – ENTREGA DE PAPEL BOND A4').setFontWeight('bold');
  sh.setRowHeight(2, 32);
  sh.getRange('A4:B4').merge().setValue('Planilla N°').setFontWeight('bold');
  sh.getRange('C4').setValue(1).setFontWeight('bold').setHorizontalAlignment('left').setBackground('#fff2cc');

  sh.getRange('A6:H6').setValues([['N°', 'Fecha', 'Recibe (nombre)', 'Área', 'Cantidad', 'Autorizó', 'Entregó', 'Firma']])
    .setFontWeight('bold').setBackground('#d9e2f3');
  sh.getRange('A7').setFormula(`=SEQUENCE(${FILAS_PLANILLA},1,($C$4-1)*${FILAS_PLANILLA}+1)`);
  // Destino ← columna de Movimientos (L = Cargo N°)
  [['B', 'A'], ['C', 'I'], ['D', 'G'], ['E', 'F'], ['F', 'J'], ['G', 'H']].forEach(([d, o]) =>
    sh.getRange(`${d}7:${d}${fin}`)
      .setFormula(`=IFERROR(INDEX(Movimientos!${o}:${o},MATCH($A7,Movimientos!$L:$L,0)),"")`));
  sh.getRange(`B7:B${fin}`).setNumberFormat('dd/mm/yyyy');
  sh.setRowHeights(7, FILAS_PLANILLA, 34);
  sh.getRange(`A6:H${fin}`).setBorder(true, true, true, true, true, true)
    .setVerticalAlignment('middle').setFontSize(9).setWrap(true);
  sh.getRange(`A${fin + 3}`).setValue('Revisado por (responsable del papel): ____________________________     Firma: ____________________');
}
