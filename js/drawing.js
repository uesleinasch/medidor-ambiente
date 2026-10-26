import { layoutPlan } from './geometry.js';

const EXPORT_WIDTH = 800;
const OPENING_STYLES = {
  door: { label: 'Porta', fill: '#fde68a' },
  window: { label: 'Janela', fill: '#bfdbfe' },
};

export const formatMeters = (cm) => `${(cm / 100).toFixed(2).replace('.', ',')} m`;

const escapeXml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function svgDocument(minX, minY, width, height, body) {
  const pixelHeight = Math.round((EXPORT_WIDTH * height) / width);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${EXPORT_WIDTH}" height="${pixelHeight}" font-family="system-ui, -apple-system, sans-serif">
<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff"/>
${body}
</svg>`;
}

function textLines(x, y, lines, fontSize, { anchor = 'middle', attrs = '' } = {}) {
  const offset = ((lines.length - 1) * fontSize * 1.2) / 2;
  const spans = lines
    .map((line, i) => `<tspan x="${x}" y="${y - offset + i * fontSize * 1.2}">${escapeXml(line)}</tspan>`)
    .join('');
  return `<text font-size="${fontSize}" text-anchor="${anchor}" dominant-baseline="middle" fill="#111827" ${attrs}>${spans}</text>`;
}

export function planSvg(walls) {
  const { segments, closureGap } = layoutPlan(walls);
  const toSvg = (p) => ({ x: p.x, y: -p.y });
  const points = segments.flatMap((s) => [toSvg(s.start), toSvg(s.end)]);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 100);
  const fontSize = size * 0.045;
  const pad = fontSize * 6;

  const lines = segments.map((s) => {
    const a = toSvg(s.start);
    const b = toSvg(s.end);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#111827" stroke-width="${size * 0.014}" stroke-linecap="round"/>`;
  });

  const labels = segments.map((s, i) => {
    const a = toSvg(s.start);
    const b = toSvg(s.end);
    const outX = Math.sin(s.heading);
    const outY = Math.cos(s.heading);
    const anchor = outX > 0.5 ? 'start' : outX < -0.5 ? 'end' : 'middle';
    const distanceOut = anchor === 'middle' ? fontSize * 1.8 : fontSize * 0.8;
    const x = (a.x + b.x) / 2 + outX * distanceOut;
    const y = (a.y + b.y) / 2 + outY * distanceOut;
    return textLines(x, y, [walls[i].name, formatMeters(walls[i].length)], fontSize, { anchor });
  });

  let gap = '';
  if (segments.length > 2 && closureGap > 1) {
    const end = toSvg(segments.at(-1).end);
    gap = `<line x1="${end.x}" y1="${end.y}" x2="0" y2="0" stroke="#dc2626" stroke-width="${size * 0.008}" stroke-dasharray="${fontSize * 0.6}"/>`;
  }

  return svgDocument(
    minX - pad,
    minY - pad,
    Math.max(...xs) - minX + pad * 2,
    Math.max(...ys) - minY + pad * 2,
    [...lines, gap, ...labels].join('\n'),
  );
}

export function elevationSvg({ name, width, height, openings }) {
  const size = Math.max(width, height);
  const fontSize = size * 0.04;
  const stroke = size * 0.008;
  const pad = fontSize * 4;
  const tick = fontSize * 0.4;

  const openingShapes = openings.map((o) => {
    const style = OPENING_STYLES[o.type];
    const top = height - o.y - o.height;
    const labelSize = Math.min(fontSize * 0.8, o.width * 0.11);
    const lines = [style.label, `${formatMeters(o.width)} × ${formatMeters(o.height)}`];
    if (o.type === 'window') lines.push(`peitoril ${formatMeters(o.y)}`);
    return `<rect x="${o.x}" y="${top}" width="${o.width}" height="${o.height}" fill="${style.fill}" stroke="#111827" stroke-width="${stroke * 0.6}"/>
${textLines(o.x + o.width / 2, top + o.height / 2, lines, labelSize)}`;
  });

  const bottom = height + fontSize * 0.9;
  const left = -fontSize * 0.9;
  const dimensions = `<g stroke="#4b5563" stroke-width="${stroke * 0.5}">
<line x1="0" y1="${bottom}" x2="${width}" y2="${bottom}"/>
<line x1="0" y1="${bottom - tick}" x2="0" y2="${bottom + tick}"/>
<line x1="${width}" y1="${bottom - tick}" x2="${width}" y2="${bottom + tick}"/>
<line x1="${left}" y1="0" x2="${left}" y2="${height}"/>
<line x1="${left - tick}" y1="0" x2="${left + tick}" y2="0"/>
<line x1="${left - tick}" y1="${height}" x2="${left + tick}" y2="${height}"/>
</g>
${textLines(width / 2, bottom + fontSize, [formatMeters(width)], fontSize)}
${textLines(left - fontSize, height / 2, [formatMeters(height)], fontSize, { attrs: `transform="rotate(-90 ${left - fontSize} ${height / 2})"` })}
${textLines(width / 2, -fontSize * 1.4, [name], fontSize * 1.1, { attrs: 'font-weight="600"' })}`;

  return svgDocument(
    -pad,
    -pad,
    width + pad * 2,
    height + pad * 2,
    [
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#f3f4f6" stroke="#111827" stroke-width="${stroke}"/>`,
      ...openingShapes,
      dimensions,
    ].join('\n'),
  );
}
