import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHomography,
  computeHomography,
  layoutPlan,
  measureOpening,
  measureWall,
  orderQuad,
  polygonArea,
} from '../js/geometry.js';

const camera = [1.2, 0.1, 30, -0.05, 0.9, 40, 0.0004, 0.0002, 1];
const photograph = (points) => points.map((p) => applyHomography(camera, p));
const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`);

const wallReal = [
  { x: 0, y: 0 },
  { x: 350, y: 0 },
  { x: 350, y: 260 },
  { x: 0, y: 260 },
];
const a4Real = [
  { x: 100, y: 80 },
  { x: 121, y: 80 },
  { x: 121, y: 109.7 },
  { x: 100, y: 109.7 },
];

test('homografia leva os 4 pontos de origem aos de destino', () => {
  const source = [
    { x: 10, y: 20 },
    { x: 300, y: 35 },
    { x: 280, y: 400 },
    { x: 5, y: 380 },
  ];
  const target = [
    { x: 0, y: 0 },
    { x: 21, y: 0 },
    { x: 21, y: 29.7 },
    { x: 0, y: 29.7 },
  ];
  const h = computeHomography(source, target);
  source.forEach((p, i) => {
    const mapped = applyHomography(h, p);
    near(mapped.x, target[i].x);
    near(mapped.y, target[i].y);
  });
});

test('orderQuad devolve sup. esq., sup. dir., inf. dir., inf. esq.', () => {
  const [tl, tr, br, bl] = [
    { x: 12, y: 8 },
    { x: 410, y: 30 },
    { x: 395, y: 300 },
    { x: 20, y: 290 },
  ];
  assert.deepEqual(orderQuad([br, tl, bl, tr]), [tl, tr, br, bl]);
});

test('mede a parede a partir de uma foto em perspectiva com folha A4', () => {
  const result = measureWall(photograph(a4Real).reverse(), { width: 21, height: 29.7 }, photograph(wallReal));
  near(result.width, 350);
  near(result.height, 260);
});

test('mede posição e tamanho de uma janela na parede', () => {
  const wall = measureWall(photograph(a4Real), { width: 21, height: 29.7 }, photograph(wallReal));
  const windowReal = [
    { x: 50, y: 40 },
    { x: 170, y: 40 },
    { x: 170, y: 160 },
    { x: 50, y: 160 },
  ];
  const opening = measureOpening(wall.corners, photograph(windowReal).map(wall.toReal));
  near(opening.x, 50);
  near(opening.y, 100);
  near(opening.width, 120);
  near(opening.height, 120);
});

test('planta retangular com cantos de 90° fecha', () => {
  const { segments, closureGap } = layoutPlan([
    { length: 400, cornerAngle: 90 },
    { length: 300, cornerAngle: 90 },
    { length: 400, cornerAngle: 90 },
    { length: 300, cornerAngle: 90 },
  ]);
  assert.equal(segments.length, 4);
  near(segments[1].end.x, 400);
  near(segments[1].end.y, 300);
  near(closureGap, 0);
});

test('área da planta em L', () => {
  const { segments } = layoutPlan([
    { length: 400, cornerAngle: 90 },
    { length: 300, cornerAngle: 90 },
    { length: 150, cornerAngle: 90 },
    { length: 100, cornerAngle: 270 },
    { length: 250, cornerAngle: 90 },
    { length: 200, cornerAngle: 90 },
  ]);
  near(polygonArea(segments.map((s) => s.start)), 400 * 300 - 250 * 100);
});

test('planta acusa a diferença quando as medidas não fecham', () => {
  const { closureGap } = layoutPlan([
    { length: 400, cornerAngle: 90 },
    { length: 300, cornerAngle: 90 },
    { length: 380, cornerAngle: 90 },
    { length: 300, cornerAngle: 90 },
  ]);
  near(closureGap, 20);
});
