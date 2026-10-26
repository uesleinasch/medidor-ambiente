import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiplyMat4, projectToScreen } from '../js/geometry.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

const [nearPlane, farPlane] = [0.1, 100];
const projection = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, (farPlane + nearPlane) / (nearPlane - farPlane), -1,
  0, 0, (2 * farPlane * nearPlane) / (nearPlane - farPlane), 0,
];
const cameraAtZ2Inverse = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2, 1];
const viewProjection = multiplyMat4(projection, cameraAtZ2Inverse);
const screen = (p) => projectToScreen(viewProjection, p, 400, 800);

test('ponto à frente da câmera cai no centro da tela', () => {
  const p = screen({ x: 0, y: 0, z: 0 });
  near(p.x, 200);
  near(p.y, 400);
});

test('direita vai para a direita e cima vai para cima na tela', () => {
  near(screen({ x: 1, y: 0, z: 0 }).x, 300);
  near(screen({ x: 0, y: 1, z: 0 }).y, 200);
});

test('ponto atrás da câmera não é desenhado', () => {
  assert.equal(screen({ x: 0, y: 0, z: 3 }), null);
});

test('multiplicação em colunas aplica primeiro a vista e depois a projeção', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual(multiplyMat4(identity, cameraAtZ2Inverse), cameraAtZ2Inverse);
  assert.deepEqual(multiplyMat4(cameraAtZ2Inverse, identity), cameraAtZ2Inverse);
});
