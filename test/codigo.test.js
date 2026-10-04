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
