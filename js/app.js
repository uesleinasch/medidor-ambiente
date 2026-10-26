import { layoutPlan, measureOpening, measureWall, measureWallByHeight, polygonArea } from './geometry.js';
import { PointMarker } from './marker.js';
import { elevationSvg, formatMeters, planSvg } from './drawing.js';
import { readFocalLength35mm } from './exif.js';
import { arUnavailableReason, openArTape } from './ar-tape.js';

const STORAGE_KEY = 'medidor-ambiente:v1';
const MAX_PHOTO_SIDE = 1400;
const DEFAULT_FOCAL_35MM = 26;
const FULL_FRAME_DIAGONAL_MM = 43.27;
const CLOSURE_TOLERANCE_CM = 5;
const REFERENCES = {
  door: { label: 'Porta padrão', detail: '80 × 210 cm', width: 80, height: 210 },
  a4Portrait: { label: 'Folha A4 em pé', detail: '21 × 29,7 cm', width: 21, height: 29.7 },
  a4Landscape: { label: 'Folha A4 deitada', detail: '29,7 × 21 cm', width: 29.7, height: 21 },
  card: { label: 'Cartão deitado', detail: '8,56 × 5,4 cm', width: 8.56, height: 5.4 },
  custom: { label: 'Outro objeto', detail: 'medidas próprias' },
};
const OPENINGS = {
  door: { label: 'Porta', plural: 'portas', icon: 'door-front', color: '#16a34a' },
  window: { label: 'Janela', plural: 'janelas', icon: 'window', color: '#0891b2' },
};
const COLORS = { reference: '#2563eb', wall: '#f57c00' };
const ANGLE_PRESETS = [90, 135, 45, 270];
const FILLED_ICONS = new Set(['photo-library', 'view-carousel']);
const STEP_TITLES = { reference: 'Referência', wall: 'Cantos da parede', openings: 'Portas e janelas' };
const VIEWS = ['walls', 'plan', 'elevations'];

const $ = (selector, root = document) => root.querySelector(selector);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decimalText = (value) => String(value).replace('.', ',');
const parseDecimal = (text) => {
  const value = parseFloat(String(text).trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
};
const metersInputValue = (cm) => (cm ? decimalText(Math.round(cm) / 100) : '');
const formatArea = (cm2) => `${decimalText((cm2 / 10000).toFixed(1))} m²`;
const formatAngle = (degrees) => `${decimalText(Math.round(degrees * 10) / 10)}°`;
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const slugify = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'desenho';

const state = loadState();
let arReady = false;
let currentView = 'walls';
let editor = null;
let editorImage = null;
const marker = new PointMarker($('#marker'), () => refreshEditor());

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.walls)) {
      saved.ceilingHeight ??= null;
      for (const wall of saved.walls) wall.scaleMode ??= 'object';
      return saved;
    }
  } catch {}
  return { roomName: 'Sala', ceilingHeight: null, walls: [] };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showSnackbar('Sem espaço para salvar no aparelho. Exclua paredes antigas.');
  }
}

function createWall() {
  return {
    id: newId(),
    name: `Parede ${state.walls.length + 1}`,
    photo: null,
    photoWidth: null,
    photoHeight: null,
    focal35: null,
    scaleMode: 'ceiling',
    refType: 'door',
    refCustomWidth: null,
    refCustomHeight: null,
    refPoints: [],
    wallPoints: [],
    openings: [],
    widthOverride: null,
    heightOverride: null,
    cornerAngle: 90,
  };
}

const layers = [];

function openLayer(close) {
  layers.push(close);
  history.pushState({ layer: layers.length }, '');
}

function closeLayer() {
  if (layers.length) history.back();
}

window.addEventListener('popstate', () => {
  const close = layers.at(-1);
  if (!close) return;
  if (close() === false) {
    history.pushState({ layer: layers.length }, '');
    return;
  }
  layers.pop();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && layers.length) closeLayer();
});

let snackbarTimer;
function showSnackbar(text, { action, onAction } = {}) {
  const bar = $('#snackbar');
  const button = $('#snackbar-action');
  $('#snackbar-text').textContent = text;
  button.hidden = !action;
  button.textContent = action ?? '';
  button.onclick = () => {
    bar.hidden = true;
    onAction?.();
  };
  bar.hidden = true;
  void bar.offsetWidth;
  bar.hidden = false;
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => (bar.hidden = true), action ? 6000 : 3500);
}

function showSheet({ title, body = '', items, actions = [], onOpen }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    const titleId = `sheet-${newId()}`;
    sheet.setAttribute('aria-labelledby', titleId);

    const menu = items
      ? `<ul class="menu-list">${items
          .map(
            (item) =>
              `<li><button type="button" data-value="${item.value}" class="${item.danger ? 'danger' : ''}" ${item.disabled ? 'disabled' : ''}>${icon(item.icon)}${escapeHtml(item.label)}</button></li>`,
          )
          .join('')}</ul>`
      : '';
    const buttons = actions
      .map((a) =>
        a === 'spacer'
          ? '<span class="spacer"></span>'
          : `<button type="button" class="btn ${a.variant ?? 'text'}" data-value="${a.value}">${escapeHtml(a.label)}</button>`,
      )
      .join('');
    sheet.innerHTML = `<div class="sheet-handle"></div>
      <h2 class="sheet-title" id="${titleId}">${escapeHtml(title)}</h2>
      <div class="sheet-body">${body}${menu}</div>
      ${buttons ? `<div class="sheet-actions">${buttons}</div>` : ''}`;

    let result = null;
    const finish = (value) => {
      result = value;
      closeLayer();
    };
    sheet.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-value]');
      if (button) finish(button.dataset.value);
    });
    sheet.addEventListener('keydown', (e) => {
      const primary = actions.find((a) => a.primary);
      if (e.key === 'Enter' && primary && e.target.matches('input')) {
        e.preventDefault();
        finish(primary.value);
      }
    });
    scrim.addEventListener('click', () => finish(null));

    document.body.append(scrim, sheet);
    if (arReady) addArButtons(sheet);
    onOpen?.(sheet, finish);
    requestAnimationFrame(() => {
      scrim.classList.add('open');
      sheet.classList.add('open');
      sheet.querySelector('[autofocus]')?.focus({ preventScroll: true });
    });

    openLayer(() => {
      scrim.classList.remove('open');
      sheet.classList.add('closing');
      setTimeout(() => {
        scrim.remove();
        sheet.remove();
      }, 300);
      resolve({ value: result, sheet });
    });
  });
}

const textField = ({ label, name, value = '', placeholder = '', ar, unit, autofocus = false, mode = 'decimal' }) =>
  `<label class="text-field"><span class="field-label">${label}</span><span class="input-row"><input name="${name}" type="text" inputmode="${mode}" autocomplete="off" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${ar ? `data-ar="${ar}"` : ''} ${unit ? `data-unit="${unit}"` : ''} ${autofocus ? 'autofocus' : ''} /></span></label>`;

function arUi() {
  return {
    overlay: $('#ar-overlay'),
    canvas: $('#ar-canvas'),
    message: $('#ar-message'),
    reading: $('#ar-reading'),
    crosshair: $('#ar-crosshair'),
    guide: $('#ar-guide'),
    modeDistance: $('#ar-mode-distance'),
    modeHeight: $('#ar-mode-height'),
    close: $('#ar-close'),
    undo: $('#ar-undo'),
    action: $('#ar-action'),
    use: $('#ar-use'),
  };
}

async function runArTape(options) {
  try {
    return await openArTape(arUi(), options);
  } catch {
    showSnackbar('Não foi possível iniciar a realidade aumentada.');
    return null;
  }
}

function addArButtons(root) {
  root.querySelectorAll('input[data-ar]').forEach((input) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tonal small';
    button.setAttribute('aria-label', 'Medir com a fita em realidade aumentada');
    button.innerHTML = `${icon('straighten')}AR`;
    input.after(button);
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const cm = await runArTape({ mode: input.dataset.ar, pick: true });
      if (!cm) return;
      const value = input.dataset.unit === 'cm' ? Math.round(cm * 10) / 10 : Math.round(cm) / 100;
      input.value = decimalText(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function referenceSize(wall) {
  if (wall.refType === 'custom') return { width: wall.refCustomWidth, height: wall.refCustomHeight };
  return REFERENCES[wall.refType];
}

function knownHeight(wall) {
  return wall.heightOverride ?? state.ceilingHeight;
}

function focalPixels(wall) {
  const focal35 = wall.focal35 ?? DEFAULT_FOCAL_35MM;
  return (focal35 * Math.hypot(wall.photoWidth, wall.photoHeight)) / FULL_FRAME_DIAGONAL_MM;
}

function measureByScale(wall) {
  if (wall.wallPoints.length !== 4) return null;
  if (wall.scaleMode === 'ceiling') {
    if (!knownHeight(wall) || !wall.photoWidth) return null;
    const center = { x: wall.photoWidth / 2, y: wall.photoHeight / 2 };
    return measureWallByHeight(wall.wallPoints, knownHeight(wall), focalPixels(wall), center);
  }
  const size = referenceSize(wall);
  if (wall.refPoints.length !== 4 || !(size.width > 0 && size.height > 0)) return null;
  return measureWall(wall.refPoints, size, wall.wallPoints);
}

function measure(wall) {
  let measured = null;
  try {
    measured = measureByScale(wall);
  } catch {
    measured = null;
  }

  if (!measured) {
    if (wall.widthOverride && wall.heightOverride) {
      return { measured: null, width: wall.widthOverride, height: wall.heightOverride, openings: [] };
    }
    return null;
  }

  const width = wall.widthOverride ?? measured.width;
  const height = wall.heightOverride ?? measured.height;
  const scaleX = width / measured.width;
  const scaleY = height / measured.height;
  const openings = wall.openings
    .filter((o) => o.points.length === 4)
    .map((o) => {
      const r = measureOpening(measured.corners, o.points.map(measured.toReal));
      return { id: o.id, type: o.type, x: r.x * scaleX, y: r.y * scaleY, width: r.width * scaleX, height: r.height * scaleY };
    });

  return { measured, width, height, openings };
}

function measuredWalls() {
  return state.walls.map((wall) => ({ wall, result: measure(wall) })).filter(({ result }) => result);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function downscale(image) {
  const ratio = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * ratio);
  canvas.height = Math.round(image.naturalHeight * ratio);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height };
}

async function readPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const [image, focal35] = await Promise.all([loadImage(url), readFocalLength35mm(file)]);
    const { dataUrl, width, height } = downscale(image);
    return { photo: dataUrl, photoWidth: width, photoHeight: height, focal35 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgToPng(svg) {
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth * 2;
  canvas.height = image.naturalHeight * 2;
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function drawingCard(svg, baseName, title) {
  const card = document.createElement('figure');
  card.className = 'drawing-card';
  card.innerHTML = `<h3>${escapeHtml(title)}</h3>
    <div class="paper">${svg}</div>
    <div class="button-row">
      <button class="btn outlined small" type="button" data-format="svg">${icon('download')}SVG</button>
      <button class="btn tonal small" type="button" data-format="png">${icon('download')}PNG</button>
    </div>`;
  card.querySelector('[data-format="svg"]').addEventListener('click', () =>
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`),
  );
  card.querySelector('[data-format="png"]').addEventListener('click', async () =>
    downloadBlob(await svgToPng(svg), `${baseName}.png`),
  );
  return card;
}

const banner = (kind, iconName, title, text) =>
  `<div class="banner ${kind}">${icon(iconName)}<div><strong>${title}</strong>${text ? `<p>${text}</p>` : ''}</div></div>`;

const emptyState = (iconName, title, text) =>
  `<div class="empty-state"><div class="cookie">${icon(iconName)}</div><h3>${title}</h3><p>${text}</p></div>`;

function openingsSummary(result) {
  if (!result?.openings.length) return '';
  return Object.entries(OPENINGS)
    .map(([type, info]) => {
      const count = result.openings.filter((o) => o.type === type).length;
      if (!count) return '';
      return `${count} ${count === 1 ? info.label.toLowerCase() : info.plural}`;
    })
    .filter(Boolean)
    .join(' · ');
}

function renderAll() {
  $('#room-name').textContent = state.roomName || 'Ambiente';
  renderCeiling();
  renderWalls();
  renderPlan();
  renderElevations();
  renderNav();
}

function renderCeiling() {
  const value = $('#ceiling-value');
  const hasCeiling = Boolean(state.ceilingHeight);
  value.classList.toggle('empty', !hasCeiling);
  if (hasCeiling) {
    value.innerHTML = `${decimalText((state.ceilingHeight / 100).toFixed(2))}<small>m</small>`;
    $('#ceiling-support').textContent = 'Usado como escala nas fotos das paredes.';
  } else {
    value.textContent = 'Não definido';
    $('#ceiling-support').textContent = arReady
      ? 'Meça do chão ao teto com a câmera. Com ele, as fotos dispensam objeto de referência.'
      : 'Informe a altura do chão ao teto. Com ela, as fotos dispensam objeto de referência.';
  }
  $('#ceiling-edit').textContent = hasCeiling ? 'Editar' : 'Digitar';
  $('#ceiling-ar').hidden = !arReady;
}

function renderWalls() {
  const count = state.walls.length;
  $('#walls-count').textContent = count ? String(count) : '';
  $('#walls-empty').hidden = count > 0;
  const list = $('#wall-list');
  list.hidden = !count;

  list.innerHTML = state.walls
    .map((wall, index) => {
      const result = measure(wall);
      const size = result ? `${formatMeters(result.width)} × ${formatMeters(result.height)}` : 'Medição incompleta';
      const meta = openingsSummary(result);
      const next = state.walls[(index + 1) % count];
      const thumb = wall.photo ? `<img src="${wall.photo}" alt="" />` : icon('image');
      const corner =
        count > 1
          ? `<div class="corner-link"><button class="chip" type="button" data-action="angle" aria-label="Ângulo entre ${escapeHtml(wall.name)} e ${escapeHtml(next.name)}">${icon('rotate-right')}Canto ${formatAngle(wall.cornerAngle)}${index === count - 1 ? ` · volta à ${escapeHtml(next.name)}` : ''}</button></div>`
          : '';
      return `<li class="wall-item" data-id="${wall.id}" style="animation-delay:${Math.min(index, 8) * 40}ms">
        <article class="wall-card ${result ? '' : 'incomplete'}">
          <button class="wall-main" type="button" data-action="edit">
            <span class="wall-thumb">${thumb}<span class="wall-index">${index + 1}</span></span>
            <span class="wall-text">
              <span class="wall-name">${escapeHtml(wall.name)}</span>
              <span class="wall-size">${size}</span>
              ${meta ? `<span class="wall-meta">${meta}</span>` : ''}
            </span>
          </button>
          <button class="icon-btn" type="button" data-action="menu" aria-label="Mais ações para ${escapeHtml(wall.name)}">${icon('more-vert')}</button>
        </article>
        ${corner}
      </li>`;
    })
    .join('');
}

function renderPlan() {
  const view = $('#view-plan');
  const measured = measuredWalls();
  if (!measured.length) {
    view.innerHTML = emptyState(
      'architecture',
      'A planta aparece aqui',
      'Meça as paredes em sequência. Com 3 ou mais, o app confere se o ambiente fecha e calcula a área.',
    );
    return;
  }

  const planWalls = measured.map(({ wall, result }) => ({
    name: wall.name,
    length: result.width,
    cornerAngle: wall.cornerAngle,
  }));
  const { segments, closureGap } = layoutPlan(planWalls);
  const perimeter = planWalls.reduce((sum, w) => sum + w.length, 0);
  const canClose = measured.length >= 3;
  const closed = canClose && closureGap < CLOSURE_TOLERANCE_CM;
  const missing = state.walls.length - measured.length;

  const status = !canClose
    ? banner('info', 'info', 'Planta parcial', 'Com 3 ou mais paredes medidas, o app confere se o ambiente fecha.')
    : closed
      ? banner('success', 'check-circle', 'O ambiente fecha', 'Medidas e ângulos estão coerentes.')
      : banner(
          'warn',
          'error',
          `Faltam ${formatMeters(closureGap)} para fechar`,
          'Confira as medidas, a ordem das paredes e os ângulos dos cantos. A linha vermelha mostra a diferença.',
        );
  const missingNote = missing
    ? banner('info', 'info', `${missing} ${missing === 1 ? 'parede ficou' : 'paredes ficaram'} fora`, 'Termine a medição para incluí-las na planta.')
    : '';
  const stats = [
    closed && ['Área', formatArea(polygonArea(segments.map((s) => s.start)))],
    ['Perímetro', formatMeters(perimeter)],
    state.ceilingHeight && ['Pé-direito', formatMeters(state.ceilingHeight)],
  ].filter(Boolean);

  view.innerHTML = `${status}${missingNote}<dl class="stats">${stats
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>`;
  view.append(drawingCard(planSvg(planWalls), `${slugify(state.roomName)}-planta`, 'Planta baixa'));
}

function renderElevations() {
  const view = $('#view-elevations');
  const measured = measuredWalls();
  if (!measured.length) {
    view.innerHTML = emptyState(
      'view-carousel',
      'As vistas das paredes',
      'Cada parede medida vira um desenho de frente, com portas, janelas e cotas.',
    );
    return;
  }
  view.replaceChildren();
  const roomSlug = slugify(state.roomName);
  for (const { wall, result } of measured) {
    const svg = elevationSvg({ name: wall.name, width: result.width, height: result.height, openings: result.openings });
    view.append(drawingCard(svg, `${roomSlug}-${slugify(wall.name)}`, wall.name));
  }
}

function renderNav() {
  for (const view of VIEWS) $(`#view-${view}`).hidden = view !== currentView;
  document.querySelectorAll('.nav-bar button').forEach((button) => {
    const active = button.dataset.view === currentView;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    const base = button.dataset.icon;
    button.querySelector('use').setAttribute('href', `#i-${base}${active && FILLED_ICONS.has(base) ? '-filled' : ''}`);
  });
  $('#fab-new-wall').classList.toggle('hidden-fab', currentView !== 'walls');
}

async function renameRoom() {
  const { value, sheet } = await showSheet({
    title: 'Nome do ambiente',
    body: textField({ label: 'Nome', name: 'name', value: state.roomName, mode: 'text', autofocus: true }),
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Salvar', value: 'save', variant: 'filled', primary: true },
    ],
  });
  if (value !== 'save') return;
  state.roomName = $('[name=name]', sheet).value.trim() || state.roomName;
  saveState();
  renderAll();
}

async function editCeiling() {
  const { value, sheet } = await showSheet({
    title: 'Pé-direito',
    body: `<p class="supporting">Altura do chão ao teto. Meça com trena ou com a fita em AR.</p>
      ${textField({ label: 'Altura (m)', name: 'ceiling', value: metersInputValue(state.ceilingHeight), placeholder: '2,60', ar: 'height', autofocus: !state.ceilingHeight })}`,
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Salvar', value: 'save', variant: 'filled', primary: true },
    ],
  });
  if (value !== 'save') return;
  const meters = parseDecimal($('[name=ceiling]', sheet).value);
  state.ceilingHeight = meters ? meters * 100 : null;
  saveState();
  renderAll();
}

async function measureCeilingWithAr() {
  const cm = await runArTape({ mode: 'height', pick: true });
  if (!cm) return;
  state.ceilingHeight = cm;
  saveState();
  renderAll();
  showSnackbar(`Pé-direito salvo: ${formatMeters(cm)}`);
}

async function wallMenu(id) {
  const index = state.walls.findIndex((w) => w.id === id);
  const wall = state.walls[index];
  const { value } = await showSheet({
    title: wall.name,
    items: [
      { value: 'edit', label: 'Editar pontos e medidas', icon: 'edit' },
      { value: 'up', label: 'Mover para cima', icon: 'arrow-upward', disabled: index === 0 },
      { value: 'down', label: 'Mover para baixo', icon: 'arrow-downward', disabled: index === state.walls.length - 1 },
      { value: 'delete', label: 'Excluir parede', icon: 'delete', danger: true },
    ],
  });

  if (value === 'edit') return openEditor(wall);
  if (value === 'up' || value === 'down') {
    const target = value === 'up' ? index - 1 : index + 1;
    [state.walls[index], state.walls[target]] = [state.walls[target], state.walls[index]];
  } else if (value === 'delete') {
    state.walls.splice(index, 1);
    showSnackbar(`${wall.name} excluída`, {
      action: 'Desfazer',
      onAction: () => {
        state.walls.splice(index, 0, wall);
        saveState();
        renderAll();
      },
    });
  } else {
    return;
  }
  saveState();
  renderAll();
}

async function editAngle(id) {
  const index = state.walls.findIndex((w) => w.id === id);
  const wall = state.walls[index];
  const next = state.walls[(index + 1) % state.walls.length];
  const { value, sheet } = await showSheet({
    title: 'Ângulo do canto',
    body: `<p class="supporting">Entre <strong>${escapeHtml(wall.name)}</strong> e <strong>${escapeHtml(next.name)}</strong>, medido por dentro do ambiente. Cantos comuns têm 90°. Use 270° quando a parede faz um canto para dentro, como num ambiente em L.</p>
      <div class="chip-set">${ANGLE_PRESETS.map(
        (a) => `<button type="button" class="chip ${a === wall.cornerAngle ? 'selected' : ''}" data-angle="${a}">${a}°</button>`,
      ).join('')}</div>
      ${textField({ label: 'Ângulo (°)', name: 'angle', value: decimalText(wall.cornerAngle) })}`,
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Salvar', value: 'save', variant: 'filled', primary: true },
    ],
    onOpen: (root) => {
      const input = $('[name=angle]', root);
      const sync = () =>
        root.querySelectorAll('[data-angle]').forEach((chip) => {
          chip.classList.toggle('selected', parseDecimal(input.value) === Number(chip.dataset.angle));
        });
      root.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-angle]');
        if (!chip) return;
        input.value = chip.dataset.angle;
        sync();
      });
      input.addEventListener('input', sync);
    },
  });
  if (value !== 'save') return;
  const angle = parseDecimal($('[name=angle]', sheet).value);
  if (!angle || angle >= 360) {
    showSnackbar('Informe um ângulo entre 1° e 359°.');
    return;
  }
  wall.cornerAngle = angle;
  saveState();
  renderAll();
}

function stepsFor(wall) {
  return wall.scaleMode === 'object' ? ['reference', 'wall', 'openings'] : ['wall', 'openings'];
}

function canLeave(step) {
  const { wall } = editor;
  if (step === 'reference') {
    const size = referenceSize(wall);
    return wall.refPoints.length === 4 && size.width > 0 && size.height > 0;
  }
  if (step === 'wall') return wall.wallPoints.length === 4;
  return true;
}

function activeGroupKey() {
  if (!editorImage) return null;
  if (editor.step === 'reference') return 'reference';
  if (editor.step === 'wall') return 'wall';
  return editor.activeOpeningId;
}

async function startNewWall(file) {
  const wall = createWall();
  try {
    Object.assign(wall, await readPhoto(file));
  } catch {
    showSnackbar('Não consegui abrir essa imagem. Tente uma foto em JPG ou PNG.');
    return;
  }
  await openEditor(wall, { isNew: true });
}

async function openEditor(wall, { isNew = false } = {}) {
  editor = {
    wall: structuredClone(wall),
    isNew,
    saved: false,
    discard: false,
    snapshot: JSON.stringify(wall),
    activeOpeningId: null,
    step: null,
  };
  const steps = stepsFor(editor.wall);
  editor.step = isNew ? steps[0] : (steps.find((s) => !canLeave(s)) ?? 'wall');
  editorImage = editor.wall.photo ? await loadImage(editor.wall.photo) : null;
  if (editorImage && !editor.wall.photoWidth) {
    editor.wall.photoWidth = editorImage.naturalWidth;
    editor.wall.photoHeight = editorImage.naturalHeight;
  }

  document.body.classList.add('locked');
  $('#editor').hidden = false;
  marker.setImage(editorImage);
  renderEditor();
  openLayer(closeEditorLayer);
}

function isEditorDirty() {
  return !editor.saved && (editor.isNew || JSON.stringify(editor.wall) !== editor.snapshot);
}

function closeEditorLayer() {
  if (isEditorDirty() && !editor.discard) {
    queueMicrotask(confirmDiscard);
    return false;
  }
  $('#editor').hidden = true;
  document.body.classList.remove('locked');
  editor = null;
  editorImage = null;
  renderAll();
}

async function confirmDiscard() {
  if (!editor) return;
  const { value } = await showSheet({
    title: editor.isNew ? 'Descartar esta parede?' : 'Descartar alterações?',
    body: `<p class="supporting">${editor.isNew ? 'A foto e os pontos marcados serão perdidos.' : 'As mudanças feitas agora serão perdidas.'}</p>`,
    actions: [
      { label: 'Continuar editando', value: 'keep' },
      { label: 'Descartar', value: 'discard', variant: 'filled' },
    ],
  });
  if (value === 'discard' && editor) {
    editor.discard = true;
    closeLayer();
  }
}

function saveEditor() {
  const { wall } = editor;
  const index = state.walls.findIndex((w) => w.id === wall.id);
  if (index >= 0) state.walls[index] = wall;
  else state.walls.push(wall);
  saveState();
  editor.saved = true;
  const result = measure(wall);
  closeLayer();
  showSnackbar(
    result
      ? `${wall.name}: ${formatMeters(result.width)} × ${formatMeters(result.height)}`
      : `${wall.name} salva. Falta completar a medição.`,
  );
}

function renderEditor() {
  if (!editor) return;
  const { wall } = editor;
  const steps = stepsFor(wall);
  if (!steps.includes(editor.step)) editor.step = steps[0];
  const index = steps.indexOf(editor.step);

  $('#editor-name').textContent = wall.name;
  $('#step-track').innerHTML = steps
    .map((_, i) => `<span class="${i < index ? 'done' : i === index ? 'current' : ''}"></span>`)
    .join('');
  $('#step-label').textContent = `Passo ${index + 1} de ${steps.length} · ${STEP_TITLES[editor.step]}`;
  $('#photo-empty').hidden = Boolean(editorImage);
  $('#marker-frame').hidden = !editorImage;
  $('#photo-chip').hidden = !editorImage;
  $('#openings-panel').hidden = editor.step !== 'openings';

  marker.setGroups(
    [
      ...(wall.scaleMode === 'object' ? [{ key: 'reference', points: wall.refPoints, color: COLORS.reference }] : []),
      { key: 'wall', points: wall.wallPoints, color: COLORS.wall },
      ...wall.openings.map((o) => ({ key: o.id, points: o.points, color: OPENINGS[o.type].color })),
    ],
    activeGroupKey(),
  );
  refreshEditor();
}

function openingName(opening) {
  const sameType = editor.wall.openings.filter((o) => o.type === opening.type);
  return `${OPENINGS[opening.type].label} ${sameType.indexOf(opening) + 1}`;
}

function renderScaleChip() {
  const { wall } = editor;
  let label;
  let warn = false;
  if (wall.scaleMode === 'ceiling') {
    const height = knownHeight(wall);
    label = height ? `Pé-direito ${formatMeters(height)}` : 'Defina o pé-direito';
    warn = !height;
  } else if (wall.refType === 'custom') {
    const { width, height } = referenceSize(wall);
    warn = !(width > 0 && height > 0);
    label = warn ? 'Informe o objeto' : `Objeto ${decimalText(width)} × ${decimalText(height)} cm`;
  } else {
    label = REFERENCES[wall.refType].label;
  }
  $('#scale-chip-label').textContent = label;
  $('#scale-chip').classList.toggle('warn', warn);
  $('#scale-chip use').setAttribute('href', `#i-${wall.scaleMode === 'ceiling' ? 'height' : 'square-foot'}`);
}

function refreshEditor() {
  if (!editor) return;
  const { wall, step } = editor;
  const steps = stepsFor(wall);
  const index = steps.indexOf(step);
  const active = marker.active;
  const count = active?.points.length ?? 0;

  renderScaleChip();

  let title;
  let text;
  if (!editorImage) {
    title = 'Adicione a foto da parede';
    text = 'De frente, com os 4 cantos aparecendo.';
  } else if (step === 'reference') {
    const ref = REFERENCES[wall.refType];
    title = 'Marque o objeto de referência';
    text = `Toque nos 4 cantos: ${ref.label.toLowerCase()} (${ref.detail}).`;
  } else if (step === 'wall') {
    title = 'Marque os 4 cantos da parede';
    text = 'Onde a parede encontra o teto e o chão. Arraste um ponto para ajustar; a lupa mostra o detalhe.';
  } else {
    const opening = wall.openings.find((o) => o.id === editor.activeOpeningId);
    title = opening ? `Marque os 4 cantos: ${openingName(opening)}` : 'Portas e janelas';
    text = opening ? 'Toque nos cantos na foto. Pode ajustar arrastando.' : 'Opcional. Adicione cada uma e marque os 4 cantos.';
  }
  if (active && count === 4) text = 'Pronto. Arraste um ponto se precisar ajustar.';
  $('#instruction-title').textContent = title;
  $('#instruction-text').textContent = text;

  const dots = $('#corner-dots');
  dots.hidden = !active;
  dots.style.setProperty('--dot-color', active?.color ?? '');
  dots.querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i < count));

  $('#undo-point').disabled = !count;
  $('#clear-points').disabled = !count;
  $('#prev-step').hidden = index <= 0;
  const last = index === steps.length - 1;
  const next = $('#next-step');
  next.innerHTML = last ? `${icon('check')}Concluir` : 'Próximo';
  next.disabled = !editorImage || (!last && !canLeave(step));

  renderOpeningList();
  renderResult();
}

function renderOpeningList() {
  const { wall, activeOpeningId } = editor;
  const sizes = new Map((measure(wall)?.openings ?? []).map((o) => [o.id, o]));
  $('#opening-list').innerHTML = wall.openings
    .map((o) => {
      const info = OPENINGS[o.type];
      const size = sizes.get(o.id);
      const detail = size ? `${formatMeters(size.width)} × ${formatMeters(size.height)}` : `${o.points.length}/4`;
      const selected = o.id === activeOpeningId ? 'selected' : '';
      const name = openingName(o);
      return `<li class="opening-chip" data-id="${o.id}">
        <button type="button" class="chip ${selected}" data-action="select"><svg class="icon" aria-hidden="true" style="color:${info.color}"><use href="#i-${info.icon}"/></svg>${name} · ${detail}</button>
        <button type="button" class="chip ${selected}" data-action="remove" aria-label="Remover ${name}">${icon('close')}</button>
      </li>`;
    })
    .join('');
}

function renderResult() {
  const { wall } = editor;
  const result = measure(wall);
  $('#result-width').textContent = result ? formatMeters(result.width) : '—';
  $('#result-height').textContent = result ? formatMeters(result.height) : '—';

  let note;
  if (!result) {
    note =
      wall.scaleMode === 'ceiling' && !knownHeight(wall)
        ? 'Defina o pé-direito no chip sobre a foto para calcular.'
        : 'Marque os pontos para calcular.';
  } else if (wall.widthOverride || wall.heightOverride) {
    note = result.measured
      ? `Ajustado à mão. Pela foto: ${formatMeters(result.measured.width)} × ${formatMeters(result.measured.height)}.`
      : 'Medidas digitadas.';
  } else if (wall.scaleMode === 'ceiling') {
    note = `Pela foto, com pé-direito de ${formatMeters(knownHeight(wall))}${wall.focal35 ? '' : ' · lente estimada'}.`;
  } else {
    note = 'Pela foto, com o objeto de referência.';
  }
  $('#result-note').textContent = note;
}

function goToStep(step) {
  if (!step) return;
  editor.step = step;
  if (step === 'openings' && !editor.activeOpeningId) editor.activeOpeningId = editor.wall.openings.at(-1)?.id ?? null;
  renderEditor();
}

async function replacePhoto(file) {
  if (!file || !editor) return;
  try {
    Object.assign(editor.wall, await readPhoto(file));
  } catch {
    showSnackbar('Não consegui abrir essa imagem.');
    return;
  }
  Object.assign(editor.wall, { refPoints: [], wallPoints: [], openings: [] });
  editor.activeOpeningId = null;
  editorImage = await loadImage(editor.wall.photo);
  marker.setImage(editorImage);
  editor.step = stepsFor(editor.wall)[0];
  renderEditor();
}

function changePhoto() {
  const { wall } = editor;
  const hasPoints = wall.refPoints.length || wall.wallPoints.length || wall.openings.length;
  showSheet({
    title: 'Trocar foto',
    body: `${hasPoints ? '<p class="supporting">Os pontos marcados nesta foto serão apagados.</p>' : ''}
      <ul class="menu-list">
        <li><label>${icon('photo-camera')}Tirar outra foto<input type="file" accept="image/*" capture="environment" hidden /></label></li>
        <li><label>${icon('image')}Escolher da galeria<input type="file" accept="image/*" hidden /></label></li>
      </ul>`,
    actions: [{ label: 'Cancelar', value: 'cancel' }],
    onOpen: (root, finish) => {
      root.querySelectorAll('input[type=file]').forEach((input) =>
        input.addEventListener('change', () => {
          const file = input.files[0];
          finish('photo');
          replacePhoto(file);
        }),
      );
    },
  });
}

async function editScale() {
  const { wall } = editor;
  const lens = wall.focal35
    ? `Lente da foto: ${wall.focal35} mm (equivalente), lida do arquivo.`
    : `A foto não informou a lente; usando ${DEFAULT_FOCAL_35MM} mm, típico da câmera principal. Fotos de frente dependem menos disso.`;
  const options = Object.entries(REFERENCES)
    .map(([key, ref]) => `<option value="${key}" ${key === wall.refType ? 'selected' : ''}>${ref.label} (${ref.detail})</option>`)
    .join('');

  const { value, sheet } = await showSheet({
    title: 'Escala da foto',
    body: `<div class="choice-list">
        <label class="choice"><input type="radio" name="scaleMode" value="ceiling" ${wall.scaleMode === 'ceiling' ? 'checked' : ''} />
          <span><strong>Pé-direito da sala</strong><small>Nada na parede: a altura do teto define a escala.</small></span></label>
        <label class="choice"><input type="radio" name="scaleMode" value="object" ${wall.scaleMode === 'object' ? 'checked' : ''} />
          <span><strong>Objeto de tamanho conhecido</strong><small>Uma porta, folha A4 ou cartão na foto, marcando os 4 cantos dele.</small></span></label>
      </div>
      <div class="sheet-body" data-mode="ceiling">
        ${textField({ label: 'Pé-direito (m)', name: 'ceiling', value: metersInputValue(state.ceilingHeight), placeholder: '2,60', ar: 'height' })}
        <p class="supporting">${lens}</p>
      </div>
      <div class="sheet-body" data-mode="object">
        <label class="text-field"><span class="field-label">Objeto</span><select name="refType">${options}</select></label>
        <div class="field-row" data-custom>
          ${textField({ label: 'Largura (cm)', name: 'refWidth', value: wall.refCustomWidth ? decimalText(wall.refCustomWidth) : '', ar: 'distance', unit: 'cm' })}
          ${textField({ label: 'Altura (cm)', name: 'refHeight', value: wall.refCustomHeight ? decimalText(wall.refCustomHeight) : '', ar: 'distance', unit: 'cm' })}
        </div>
      </div>`,
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Aplicar', value: 'apply', variant: 'filled', primary: true },
    ],
    onOpen: (root) => {
      const sync = () => {
        const mode = $('input[name=scaleMode]:checked', root).value;
        root.querySelectorAll('[data-mode]').forEach((el) => (el.hidden = el.dataset.mode !== mode));
        $('[data-custom]', root).hidden = $('[name=refType]', root).value !== 'custom';
      };
      root.addEventListener('change', sync);
      sync();
    },
  });
  if (value !== 'apply' || !editor) return;

  wall.scaleMode = $('input[name=scaleMode]:checked', sheet).value;
  if (wall.scaleMode === 'ceiling') {
    const meters = parseDecimal($('[name=ceiling]', sheet).value);
    if (meters) {
      state.ceilingHeight = meters * 100;
      saveState();
    }
  } else {
    wall.refType = $('[name=refType]', sheet).value;
    wall.refCustomWidth = parseDecimal($('[name=refWidth]', sheet).value);
    wall.refCustomHeight = parseDecimal($('[name=refHeight]', sheet).value);
  }
  renderEditor();
}

async function adjustMeasures() {
  const { wall } = editor;
  const measured = measure({ ...wall, widthOverride: null, heightOverride: null });
  const { value, sheet } = await showSheet({
    title: 'Ajustar medidas',
    body: `<p class="supporting">Corrija com uma trena ou com a fita em AR. Deixe vazio para usar a medida da foto${
      measured ? ` (${formatMeters(measured.width)} × ${formatMeters(measured.height)})` : ''
    }.</p>
      ${textField({ label: 'Largura (m)', name: 'width', value: metersInputValue(wall.widthOverride), placeholder: measured ? metersInputValue(measured.width) : '', ar: 'distance' })}
      ${textField({ label: 'Altura (m)', name: 'height', value: metersInputValue(wall.heightOverride), placeholder: measured ? metersInputValue(measured.height) : '', ar: 'height' })}`,
    actions: [
      { label: 'Usar a foto', value: 'reset' },
      'spacer',
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Aplicar', value: 'apply', variant: 'filled', primary: true },
    ],
  });
  if (!editor || (value !== 'apply' && value !== 'reset')) return;
  if (value === 'reset') {
    wall.widthOverride = null;
    wall.heightOverride = null;
  } else {
    const width = parseDecimal($('[name=width]', sheet).value);
    const height = parseDecimal($('[name=height]', sheet).value);
    wall.widthOverride = width ? width * 100 : null;
    wall.heightOverride = height ? height * 100 : null;
  }
  refreshEditor();
}

async function renameWall() {
  const { value, sheet } = await showSheet({
    title: 'Nome da parede',
    body: textField({ label: 'Nome', name: 'name', value: editor.wall.name, mode: 'text', autofocus: true }),
    actions: [
      { label: 'Cancelar', value: 'cancel' },
      { label: 'Salvar', value: 'save', variant: 'filled', primary: true },
    ],
  });
  if (value !== 'save' || !editor) return;
  editor.wall.name = $('[name=name]', sheet).value.trim() || editor.wall.name;
  renderEditor();
}

$('#room-title').addEventListener('click', renameRoom);
$('#open-tape').addEventListener('click', () => runArTape({ mode: 'distance' }));
$('#ceiling-ar').addEventListener('click', measureCeilingWithAr);
$('#ceiling-edit').addEventListener('click', editCeiling);

document.querySelectorAll('input[data-new-wall]').forEach((input) =>
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) startNewWall(file);
  }),
);

$('#wall-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const id = button.closest('.wall-item').dataset.id;
  const action = button.dataset.action;
  if (action === 'edit') openEditor(state.walls.find((w) => w.id === id));
  else if (action === 'menu') wallMenu(id);
  else if (action === 'angle') editAngle(id);
});

document.querySelectorAll('.nav-bar button').forEach((button) =>
  button.addEventListener('click', () => {
    if (currentView === button.dataset.view) return;
    currentView = button.dataset.view;
    renderNav();
    window.scrollTo({ top: 0 });
  }),
);

window.addEventListener(
  'scroll',
  () => document.querySelector('.top-app-bar').classList.toggle('scrolled', window.scrollY > 4),
  { passive: true },
);

$('#editor-close').addEventListener('click', closeLayer);
$('#editor-save').addEventListener('click', saveEditor);
$('#editor-title').addEventListener('click', renameWall);
$('#scale-chip').addEventListener('click', editScale);
$('#photo-chip').addEventListener('click', changePhoto);
$('#adjust-open').addEventListener('click', adjustMeasures);
$('#undo-point').addEventListener('click', () => marker.undo());
$('#clear-points').addEventListener('click', () => marker.clear());

$('#prev-step').addEventListener('click', () => {
  const steps = stepsFor(editor.wall);
  goToStep(steps[steps.indexOf(editor.step) - 1]);
});
$('#next-step').addEventListener('click', () => {
  const steps = stepsFor(editor.wall);
  const index = steps.indexOf(editor.step);
  if (index === steps.length - 1) saveEditor();
  else if (canLeave(editor.step)) goToStep(steps[index + 1]);
});

document.querySelectorAll('input[data-replace-photo]').forEach((input) =>
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    replacePhoto(file);
  }),
);

document.querySelectorAll('[data-add-opening]').forEach((button) =>
  button.addEventListener('click', () => {
    const opening = { id: newId(), type: button.dataset.addOpening, points: [] };
    editor.wall.openings.push(opening);
    editor.activeOpeningId = opening.id;
    renderEditor();
  }),
);

$('#opening-list').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('li').dataset.id;
  if (button.dataset.action === 'remove') {
    editor.wall.openings = editor.wall.openings.filter((o) => o.id !== id);
    if (editor.activeOpeningId === id) editor.activeOpeningId = null;
  } else {
    editor.activeOpeningId = id;
  }
  renderEditor();
});

arUnavailableReason().then((reason) => {
  arReady = !reason;
  $('#open-tape').hidden = !arReady;
  $('#ar-hint').hidden = arReady;
  $('#ar-hint-text').textContent = reason ?? '';
  renderCeiling();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderAll();
