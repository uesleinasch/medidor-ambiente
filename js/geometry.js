export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (v) => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};

export function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-12) {
      throw new Error('Pontos degenerados: não é possível calcular a perspectiva.');
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let k = col; k <= n; k++) rows[row][k] -= factor * rows[col][k];
    }
  }

  return rows.map((row, i) => row[n] / row[i]);
}

export function computeHomography(source, target) {
  const matrix = [];
  const vector = [];
  source.forEach(({ x, y }, i) => {
    const { x: u, y: v } = target[i];
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    vector.push(v);
  });
  return [...solveLinearSystem(matrix, vector), 1];
}

export function applyHomography(h, { x, y }) {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

export function orderQuad(points) {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const start = sorted.reduce(
    (best, p, i) => (p.x + p.y < sorted[best].x + sorted[best].y ? i : best),
    0,
  );
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

export function measureWall(referencePoints, referenceSize, wallPoints) {
  const { width, height } = referenceSize;
  const homography = computeHomography(orderQuad(referencePoints), [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]);
  const toReal = (p) => applyHomography(homography, p);
  const corners = orderQuad(wallPoints).map(toReal);
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  return {
    width: (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2,
    height: (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2,
    corners,
    toReal,
  };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function rectangleAspectRatio(points, focalPx, center) {
  const [topLeft, topRight, bottomRight, bottomLeft] = orderQuad(points);
  const homogeneous = (p) => [p.x - center.x, p.y - center.y, 1];
  const m1 = homogeneous(topLeft);
  const m2 = homogeneous(topRight);
  const m3 = homogeneous(bottomLeft);
  const m4 = homogeneous(bottomRight);

  const k2 = dot3(cross(m1, m4), m3) / dot3(cross(m2, m4), m3);
  const k3 = dot3(cross(m1, m4), m2) / dot3(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  const f2 = focalPx * focalPx;
  const norm = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];

  return Math.sqrt(norm(n2) / norm(n3));
}

export function measureWallByHeight(wallPoints, height, focalPx, center) {
  const width = rectangleAspectRatio(wallPoints, focalPx, center) * height;
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const homography = computeHomography(orderQuad(wallPoints), corners);
  return { width, height, corners, toReal: (p) => applyHomography(homography, p) };
}

export function heightAboveBase(rayOrigin, rayDirection, base) {
  const u = rayDirection;
  const w0 = { x: rayOrigin.x - base.x, y: rayOrigin.y - base.y, z: rayOrigin.z - base.z };
  const a = u.x * u.x + u.y * u.y + u.z * u.z;
  const b = u.y;
  const d = u.x * w0.x + u.y * w0.y + u.z * w0.z;
  const e = w0.y;
  const denominator = a - b * b;
  if (denominator < 1e-9) return null;
  return (a * e - b * d) / denominator;
}

export function multiplyMat4(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function projectToScreen(m, { x, y, z }, width, height) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0.01) return null;
  return { x: ((cx / cw + 1) / 2) * width, y: ((1 - cy / cw) / 2) * height };
}

export function measureOpening(wallCorners, openingPoints) {
  const [topLeft, , bottomRight, bottomLeft] = wallCorners;
  const alongFloor = unit(subtract(bottomRight, bottomLeft));
  const upward = unit(subtract(topLeft, bottomLeft));
  const local = openingPoints.map((p) => {
    const offset = subtract(p, bottomLeft);
    return { x: dot(offset, alongFloor), y: dot(offset, upward) };
  });
  const xs = local.map((p) => p.x);
  const ys = local.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

export function polygonArea(points) {
  let twiceArea = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    twiceArea += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twiceArea) / 2;
}

export function layoutPlan(walls) {
  let heading = 0;
  let cursor = { x: 0, y: 0 };

  const segments = walls.map(({ length, cornerAngle }) => {
    const start = cursor;
    const end = {
      x: start.x + length * Math.cos(heading),
      y: start.y + length * Math.sin(heading),
    };
    const segment = { start, end, heading };
    cursor = end;
    heading += Math.PI - (cornerAngle * Math.PI) / 180;
    return segment;
  });

  return {
    segments,
    closureGap: walls.length ? distance(cursor, { x: 0, y: 0 }) : 0,
  };
}
