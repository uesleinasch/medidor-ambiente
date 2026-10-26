import { orderQuad } from './geometry.js';

const HIT_RADIUS = 28;
const LOUPE_RADIUS = 64;
const LOUPE_ZOOM = 3;
const MAX_POINTS = 4;

export class PointMarker {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.image = null;
    this.groups = [];
    this.activeKey = null;
    this.drag = null;
    this.scale = 1;

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    canvas.addEventListener('pointerup', () => this.#up());
    canvas.addEventListener('pointercancel', () => this.#up());
    new ResizeObserver(() => this.render()).observe(canvas.parentElement);
  }

  get active() {
    return this.groups.find((g) => g.key === this.activeKey) ?? null;
  }

  setImage(image) {
    this.image = image;
    this.render();
  }

  setGroups(groups, activeKey) {
    this.groups = groups;
    this.activeKey = activeKey;
    this.render();
  }

  undo() {
    if (!this.active?.points.length) return;
    this.active.points.pop();
    this.render();
    this.onChange();
  }

  clear() {
    if (!this.active?.points.length) return;
    this.active.points.length = 0;
    this.render();
    this.onChange();
  }

  render() {
    const { canvas, ctx, image } = this;
    const available = canvas.parentElement.clientWidth;
    if (!image || !available) return;

    this.scale = Math.min(available / image.naturalWidth, (window.innerHeight * 0.6) / image.naturalHeight);
    const width = image.naturalWidth * this.scale;
    const height = image.naturalHeight * this.scale;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    for (const group of this.groups) this.#drawGroup(group, group.key === this.activeKey);
    if (this.drag) this.#drawLoupe(width);
  }

  #toImage(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.scale,
      y: (event.clientY - rect.top) / this.scale,
    };
  }

  #clamp(p) {
    return {
      x: Math.min(Math.max(p.x, 0), this.image.naturalWidth),
      y: Math.min(Math.max(p.y, 0), this.image.naturalHeight),
    };
  }

  #down(event) {
    const group = this.active;
    if (!this.image || !group) return;
    const pointer = this.#toImage(event);
    const hitRadius = HIT_RADIUS / this.scale;

    let index = -1;
    let best = Infinity;
    group.points.forEach((p, i) => {
      const d = Math.hypot(p.x - pointer.x, p.y - pointer.y);
      if (d < hitRadius && d < best) {
        best = d;
        index = i;
      }
    });

    if (index >= 0) {
      const p = group.points[index];
      this.drag = { index, offset: { x: pointer.x - p.x, y: pointer.y - p.y } };
    } else if (group.points.length < MAX_POINTS) {
      group.points.push(this.#clamp(pointer));
      this.drag = { index: group.points.length - 1, offset: { x: 0, y: 0 } };
    } else {
      return;
    }

    this.canvas.setPointerCapture(event.pointerId);
    this.render();
  }

  #move(event) {
    if (!this.drag) return;
    const pointer = this.#toImage(event);
    this.active.points[this.drag.index] = this.#clamp({
      x: pointer.x - this.drag.offset.x,
      y: pointer.y - this.drag.offset.y,
    });
    this.render();
  }

  #up() {
    if (!this.drag) return;
    this.drag = null;
    this.render();
    this.onChange();
  }

  #drawGroup(group, isActive) {
    const { ctx } = this;
    const points = group.points.map((p) => ({ x: p.x * this.scale, y: p.y * this.scale }));
    const outline = points.length === MAX_POINTS ? orderQuad(points) : points;

    ctx.save();
    ctx.globalAlpha = isActive ? 1 : 0.55;
    ctx.strokeStyle = group.color;
    ctx.lineWidth = isActive ? 2.5 : 1.5;

    if (outline.length > 1) {
      ctx.beginPath();
      outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (outline.length === MAX_POINTS) {
        ctx.closePath();
        ctx.fillStyle = `${group.color}26`;
        ctx.fill();
      }
      ctx.stroke();
    }

    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, isActive ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawLoupe(canvasWidth) {
    const { ctx, image } = this;
    const point = this.active.points[this.drag.index];
    const margin = 8;
    const cx = point.x * this.scale < canvasWidth / 2 ? canvasWidth - LOUPE_RADIUS - margin : LOUPE_RADIUS + margin;
    const cy = LOUPE_RADIUS + margin;
    const zoom = this.scale * LOUPE_ZOOM;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - LOUPE_RADIUS, cy - LOUPE_RADIUS, LOUPE_RADIUS * 2, LOUPE_RADIUS * 2);
    ctx.drawImage(
      image,
      cx - point.x * zoom,
      cy - point.y * zoom,
      image.naturalWidth * zoom,
      image.naturalHeight * zoom,
    );
    ctx.strokeStyle = this.active.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - LOUPE_RADIUS, cy);
    ctx.lineTo(cx + LOUPE_RADIUS, cy);
    ctx.moveTo(cx, cy - LOUPE_RADIUS);
    ctx.lineTo(cx, cy + LOUPE_RADIUS);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}
