const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Codigo.gs es un script de Apps Script sin módulos: se carga en un contexto aislado.
const g = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Codigo.gs'), 'utf8'), g);

const fila = (tipo, total, cargo = '') => ['', tipo, 0, 0, total, '', '', '', '', '', '', cargo];

test('stock: ingresos menos salidas', () => {
  const filas = [fila('INGRESO', 3), fila('INGRESO', 10), fila('SALIDA', 2, 1), fila('SALIDA', 1, 2)];
  assert.strictEqual(g.calcularStock(filas), 10);
  assert.strictEqual(g.calcularStock([]), 0);
});

test('siguiente cargo: máximo + 1', () => {
  assert.strictEqual(g.siguienteCargo([fila('SALIDA', 1, 1), fila('INGRESO', 5), fila('SALIDA', 1, 2)]), 3);
  assert.strictEqual(g.siguienteCargo([]), 1);
});

test('filas de una planilla de 15', () => {
  const filas = [fila('INGRESO', 3), fila('SALIDA', 1, 15), fila('SALIDA', 1, 16), fila('SALIDA', 1, 30), fila('SALIDA', 1, 31)];
  assert.deepStrictEqual([...g.filasDePlanilla(filas, 1)], [1]);
  assert.deepStrictEqual([...g.filasDePlanilla(filas, 2)], [2, 3]);
  assert.deepStrictEqual([...g.filasDePlanilla(filas, 4)], []);
});

test('cantidad en texto', () => {
  assert.strictEqual(g.cantidadTexto(1, 0), '1 caja');
  assert.strictEqual(g.cantidadTexto(0, 3), '3 paquetes');
  assert.strictEqual(g.cantidadTexto(2, 1), '2 cajas + 1 paquete');
});

// Las fechas se crean con el Date del contexto aislado para que `instanceof Date` funcione dentro de Codigo.gs
const D = (...a) => new (vm.runInContext('Date', g))(...a);
const mov = (fecha, tipo, total, lugar, recibe = '') =>
  [fecha, tipo, 0, total, total, '', lugar, '', recibe, '', '', '', ''];
const datos = [
  mov(D(2026, 7, 20, 12), 'INGRESO', 30, 'Administración'),
  mov(D(2026, 8, 5, 12), 'SALIDA', 4, 'Admisión', 'Ana'),
  mov(D(2026, 9, 1, 12), 'SALIDA', 2, 'Admisión', 'Luis'),
  mov(D(2026, 9, 3, 12), 'SALIDA', 5, 'Referencias', 'Ana'),
  mov(D(2026, 9, 4, 12), 'INGRESO', 10, 'Service'),
];

test('agrupar por área en un período (fechas inclusive)', () => {
  const r = g.agrupar(datos, 'SALIDA', 6, D(2026, 9, 1), D(2026, 9, 4));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [['Referencias', 5], ['Admisión', 2]]);
  assert.strictEqual(g.agrupar(datos, 'SALIDA', 6, D(2026, 9, 2), D(2026, 9, 2)).length, 0);
});

test('barras: porcentaje del total y largo relativo al mayor', () => {
  const r = g.conBarras([['A', 6], ['B', 2]]);
  assert.strictEqual(r[0][2], 0.75);
  assert.strictEqual(r[0][3].length, 14);
  assert.strictEqual(r[1][3].length, 5);
  assert.strictEqual(g.conBarras([]).length, 0);
});

test('mes a mes desde el primer mes con movimientos, con saldo al cierre', () => {
  const r = JSON.parse(JSON.stringify(g.mesAMes(datos, D(2026, 9, 4), 12)));
  assert.deepStrictEqual(r, [['ago 2026', 30, 0, 30], ['sep 2026', 0, 4, 26], ['oct 2026', 10, 7, 29]]);
  assert.deepStrictEqual([...g.mesAMes([], D(2026, 9, 4), 12)], []);
});

test('consumo por área en los últimos meses', () => {
  const r = JSON.parse(JSON.stringify(g.areasPorMes(datos, D(2026, 9, 4), 3)));
  assert.deepStrictEqual(r.meses, ['ago 2026', 'sep 2026', 'oct 2026']);
  assert.deepStrictEqual(r.filas, [['Admisión', 0, 4, 2], ['Referencias', 0, 0, 5]]);
});

test('planilla: la firma va junto al nombre de quien recibe', () => {
  const titulos = n => [...g.columnasPlanilla(n)].map(c => c[0]);
  assert.deepStrictEqual(titulos(1).slice(2, 4), ['Nombre de quien recibe', 'Firma de quien recibe']);
  assert.strictEqual(titulos(1).length, 7);
});
