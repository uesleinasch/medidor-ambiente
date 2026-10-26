import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightAboveBase, measureOpening, measureWallByHeight, rectangleAspectRatio } from '../js/geometry.js';

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`);

const IMAGE = { width: 1400, height: 1050 };
const CENTER = { x: IMAGE.width / 2, y: IMAGE.height / 2 };
const FOCAL = (26 * Math.hypot(IMAGE.width, IMAGE.height)) / 43.27;

function camera({ position, yaw, pitch, focal = FOCAL }) {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  return ({ x, y, z = 0 }) => {
    const [dx, dy, dz] = [x - position.x, y - position.y, z - position.z];
    const x1 = cy * dx - sy * dz;
    const z1 = sy * dx + cy * dz;
    const y2 = cp * dy - sp * z1;
    const z2 = sp * dy + cp * z1;
    return { x: CENTER.x + (focal * x1) / z2, y: CENTER.y - (focal * y2) / z2 };
  };
}

const wall = (width, height) => [
  { x: 0, y: height },
  { x: width, y: height },
  { x: width, y: 0 },
  { x: 0, y: 0 },
];

const aimedAtWallCenter = (name, position) => {
  const [dx, dy, dz] = [175 - position.x, 130 - position.y, -position.z];
  return { name, position, yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};

const shots = [
  aimedAtWallCenter('de frente', { x: 175, y: 140, z: -330 }),
  aimedAtWallCenter('da esquerda, ~35°', { x: -60, y: 150, z: -330 }),
  aimedAtWallCenter('da direita, ~39°, de baixo', { x: 420, y: 110, z: -300 }),
];

for (const shot of shots) {
  test(`proporção da parede recuperada pela lente: ${shot.name}`, () => {
    const photo = wall(350, 260).map(camera(shot));
    assert.ok(photo.every((p) => p.x > 0 && p.x < IMAGE.width && p.y > 0 && p.y < IMAGE.height));
    near(rectangleAspectRatio(photo, FOCAL, CENTER), 350 / 260, 0.005);
  });
}

test('foto de frente não depende da lente', () => {
  const photo = wall(350, 260).map(camera(shots[0]));
  near(rectangleAspectRatio(photo, FOCAL * 1.3, CENTER), 350 / 260, 0.01);
});

test('com o pé-direito conhecido, mede largura e janela', () => {
  const project = camera(shots[1]);
  const result = measureWallByHeight(wall(350, 260).map(project), 260, FOCAL, CENTER);
  near(result.width, 350, 1);
  near(result.height, 260, 1e-9);

  const windowCorners = [
    { x: 50, y: 220 },
    { x: 170, y: 220 },
    { x: 170, y: 100 },
    { x: 50, y: 100 },
  ];
  const opening = measureOpening(result.corners, windowCorners.map(project).map(result.toReal));
  near(opening.x, 50, 1);
  near(opening.y, 100, 1);
  near(opening.width, 120, 1);
  near(opening.height, 120, 1);
});

test('altura do teto pela mira apontada acima do ponto do chão', () => {
  const base = { x: 0.4, y: -1.45, z: -2.6 };
  const ceiling = { x: base.x, y: base.y + 2.62, z: base.z };
  const origin = { x: 0.1, y: 0, z: 0.05 };
  const direction = { x: ceiling.x - origin.x, y: ceiling.y - origin.y, z: ceiling.z - origin.z };
  near(heightAboveBase(origin, direction, base), 2.62, 1e-9);

  const slightlyOff = { ...direction, x: direction.x + 0.05 };
  near(heightAboveBase(origin, slightlyOff, base), 2.62, 0.01);
});

test('mira na vertical não tem resposta', () => {
  assert.equal(heightAboveBase({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }), null);
});
