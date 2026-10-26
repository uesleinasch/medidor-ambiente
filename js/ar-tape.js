import { heightAboveBase, multiplyMat4, projectToScreen } from './geometry.js';
import { formatMeters } from './drawing.js';

const HORIZONTAL_NORMAL_MIN_Y = 0.85;
const MIN_HEIGHT_M = 0.05;

const MESSAGES = {
  searching: 'Mova o celular devagar, apontando para o chão',
  distanceStart: 'Mire no início e toque no botão. Para a largura de uma parede, meça no chão, rente a ela.',
  distanceEnd: 'Leve a mira até o fim e toque no botão',
  heightStart: 'Mire no chão, na base do que vai medir. Para o pé-direito, use o canto da sala.',
  heightEnd: 'Suba a mira em linha reta até o topo e toque no botão',
  heightNeedsFloor: 'A base precisa estar no chão ou numa superfície horizontal',
  pickDone: 'Confira a medida. Desfazer mede de novo.',
  freeDone: 'Toque no botão para começar outra medida',
};

export async function arUnavailableReason() {
  if (!window.isSecureContext) {
    return 'A fita métrica em AR só funciona em endereço seguro. Abra o endereço https:// do servidor (veja o README) ou ative a flag "Insecure origins treated as secure" no Chrome.';
  }
  if (!navigator.xr) {
    return 'Este navegador não oferece WebXR. Use o Chrome atualizado no Android.';
  }
  try {
    if (await navigator.xr.isSessionSupported('immersive-ar')) return null;
  } catch {}
  return 'O Chrome não encontrou suporte a realidade aumentada. Instale ou atualize o app "Google Play Services para RA" na Play Store.';
}

const toPoint = ({ x, y, z }) => ({ x, y, z });
const distance3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function requestHitSource(session, space) {
  try {
    return await session.requestHitTestSource({ space, entityTypes: ['plane', 'point'] });
  } catch {
    return session.requestHitTestSource({ space });
  }
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

export async function openArTape(ui, { mode: initialMode = 'distance', pick = false } = {}) {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'dom-overlay'],
    domOverlay: { root: ui.overlay },
  });
  const gl = document.createElement('canvas').getContext('webgl', { xrCompatible: true });
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const localSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await requestHitSource(session, viewerSpace);
  const ctx = ui.canvas.getContext('2d');

  let mode = initialMode;
  let start = null;
  let live = null;
  let surface = null;
  let result = null;
  const measurements = [];

  const picked = () => pick && measurements.length > 0;

  const canMark = () => {
    if (picked()) return false;
    if (start) return Boolean(live);
    return Boolean(surface) && (mode === 'distance' || surface.horizontal);
  };

  const message = () => {
    if (picked()) return MESSAGES.pickDone;
    if (start) return mode === 'distance' ? MESSAGES.distanceEnd : MESSAGES.heightEnd;
    if (!surface) return MESSAGES.searching;
    if (mode === 'height') return surface.horizontal ? MESSAGES.heightStart : MESSAGES.heightNeedsFloor;
    return measurements.length ? MESSAGES.freeDone : MESSAGES.distanceStart;
  };

  const updateUi = () => {
    const lastLength = measurements.at(-1)?.length;
    const reading = start && live ? distance3(start, live) : lastLength;
    setText(ui.message, message());
    setText(ui.reading, reading ? formatMeters(reading * 100) : '');
    ui.action.hidden = picked();
    ui.action.disabled = !canMark();
    ui.use.hidden = !picked();
    if (picked()) setText(ui.use, `Usar ${formatMeters(lastLength * 100)}`);
    ui.undo.disabled = !start && !measurements.length;
    ui.guide.hidden = Boolean(surface || start || measurements.length);
    ui.crosshair.classList.toggle('ready', canMark());
    ui.modeDistance.setAttribute('aria-pressed', String(mode === 'distance'));
    ui.modeHeight.setAttribute('aria-pressed', String(mode === 'height'));
  };

  const drawDot = (p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111827';
    ctx.stroke();
  };

  const drawLabel = (x, y, text) => {
    ctx.font = '600 15px system-ui, sans-serif';
    const width = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 14, width, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };

  const drawSegment = (toScreen, a, b, dashed) => {
    const pa = toScreen(a);
    const pb = toScreen(b);
    if (!pa || !pb) return;
    ctx.save();
    ctx.setLineDash(dashed ? [10, 8] : []);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    drawDot(pa);
    drawDot(pb);
    drawLabel((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, formatMeters(distance3(a, b) * 100));
  };

  const draw = (pose) => {
    const { canvas } = ui;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!pose) return;

    const view = pose.views[0];
    const viewProjection = multiplyMat4(view.projectionMatrix, view.transform.inverse.matrix);
    const toScreen = (p) => projectToScreen(viewProjection, p, width, height);

    for (const m of measurements) drawSegment(toScreen, m.a, m.b, false);
    if (start && live) drawSegment(toScreen, start, live, true);
    else if (start) {
      const p = toScreen(start);
      if (p) drawDot(p);
    }
  };

  const onFrame = (_time, frame) => {
    session.requestAnimationFrame(onFrame);
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pose = frame.getViewerPose(localSpace);
    const hitPose = frame.getHitTestResults(hitSource)[0]?.getPose(localSpace);
    surface = hitPose
      ? { point: toPoint(hitPose.transform.position), horizontal: hitPose.transform.matrix[5] >= HORIZONTAL_NORMAL_MIN_Y }
      : null;

    if (start && mode === 'distance') {
      live = surface?.point ?? null;
    } else if (start && mode === 'height' && pose) {
      const m = pose.transform.matrix;
      const rise = heightAboveBase(toPoint(pose.transform.position), { x: -m[8], y: -m[9], z: -m[10] }, start);
      live = rise !== null && rise >= MIN_HEIGHT_M ? { x: start.x, y: start.y + rise, z: start.z } : null;
    }

    draw(pose);
    updateUi();
  };

  const setMode = (next) => {
    mode = next;
    start = null;
    live = null;
  };

  ui.use.onclick = () => {
    if (!picked()) return;
    result = Math.round(measurements.at(-1).length * 1000) / 10;
    session.end();
  };
  ui.action.onclick = () => {
    if (!canMark()) return;
    navigator.vibrate?.(15);
    if (start) {
      measurements.push({ a: start, b: live, length: distance3(start, live) });
      start = null;
      live = null;
    } else {
      start = surface.point;
    }
  };
  ui.undo.onclick = () => {
    if (start) {
      start = null;
      live = null;
    } else {
      measurements.pop();
    }
  };
  ui.modeDistance.onclick = () => setMode('distance');
  ui.modeHeight.onclick = () => setMode('height');
  ui.close.onclick = () => session.end();

  const preventSelect = (e) => e.preventDefault();
  ui.overlay.addEventListener('beforexrselect', preventSelect);
  ui.overlay.hidden = false;
  updateUi();
  session.requestAnimationFrame(onFrame);

  return new Promise((resolve) => {
    session.addEventListener('end', () => {
      hitSource.cancel();
      ui.overlay.removeEventListener('beforexrselect', preventSelect);
      ui.overlay.hidden = true;
      resolve(result);
    });
  });
}
