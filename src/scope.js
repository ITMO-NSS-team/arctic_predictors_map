// Область, по которой считается статистика в легенде.
//
// Зачем: доли в легенде по всему охвату отвечают на вопрос «что ведёт в
// Арктике вообще», а спрашивают обычно про конкретное море или про участок,
// который человек видит на экране. Одна и та же карта при этом остаётся на
// месте -- меняется только то, по каким ячейкам считаются проценты.
//
// Почему это не утяжеляет страницу
// --------------------------------
// Никаких предрасчётов: ячеек всего 186 624, и проход по ним с фильтром
// занимает единицы миллисекунд. Регион берётся из растра region_index.bin,
// который и так загружен ради подсказки под курсором. Для произвольного
// полигона строится маска -- один проход с проверкой «точка внутри
// многоугольника» по алгоритму пересечений луча.
//
// Полигон проверяется в координатах EASE2, а не в широтах/долготах: у сетки
// там прямые оси и центр ячейки известен точно, без обратной проекции на
// каждую из 186 тысяч ячеек. Рёбра полигона перед пересчётом уплотняются в
// плоскости отображения -- то есть в той, где человек его нарисовал, --
// иначе прямая на экране стала бы кривой в EASE2 и выделение поехало бы.

import { DATA_GRID, DATA_PROJ } from './config.js';
import * as i18n from './i18n.js';

const N = DATA_GRID.size;
const HALF = DATA_GRID.halfExtent;
const CELL = DATA_GRID.cellSize;

/** Уплотнение ребра в плоскости отображения, чтобы форма не поехала. */
function densify(map, a, b, steps) {
  const pa = map.latLngToLayerPoint(a);
  const pb = map.latLngToLayerPoint(b);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    out.push(map.layerPointToLatLng(
      L.point(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t)));
  }
  return out;
}

/** Маска ячеек внутри полигона: Uint8Array длиной N*N. */
export function polygonMask(map, latlngs) {
  const toEase = proj4('WGS84', DATA_PROJ);
  const xs = [], ys = [];
  for (let i = 0; i < latlngs.length; i++) {
    const seg = densify(map, latlngs[i], latlngs[(i + 1) % latlngs.length], 24);
    for (const ll of seg) {
      const [x, y] = toEase.forward([ll.lng, ll.lat]);
      xs.push(x);
      ys.push(y);
    }
  }
  const n = xs.length;
  const mask = new Uint8Array(N * N);
  if (n < 3) return mask;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  // Рамка отсекает подавляющее большинство ячеек до дорогой проверки.
  const c0 = Math.max(0, Math.floor((minX + HALF) / CELL));
  const c1 = Math.min(N - 1, Math.ceil((maxX + HALF) / CELL));
  const r0 = Math.max(0, Math.floor((HALF - maxY) / CELL));
  const r1 = Math.min(N - 1, Math.ceil((HALF - minY) / CELL));

  for (let row = r0; row <= r1; row++) {
    const py = HALF - (row + 0.5) * CELL;
    for (let col = c0; col <= c1; col++) {
      const px = -HALF + (col + 0.5) * CELL;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        if ((ys[i] > py) !== (ys[j] > py)
            && px < (xs[j] - xs[i]) * (py - ys[i]) / (ys[j] - ys[i]) + xs[i]) {
          inside = !inside;
        }
      }
      if (inside) mask[row * N + col] = 1;
    }
  }
  return mask;
}

/** Разбор координат из текстового поля: по строке на вершину, «широта, долгота». */
export function parseCoords(text) {
  const pts = [];
  for (const line of text.split(/[\n;]/)) {
    const m = line.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,\s]\s*(-?\d+(?:[.,]\d+)?)$/);
    if (!m) continue;
    const lat = parseFloat(m[1].replace(',', '.'));
    const lon = parseFloat(m[2].replace(',', '.'));
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push(L.latLng(lat, lon));
  }
  return pts;
}

export function createScope(map, P, onChange) {
  const sel = document.getElementById('predScope');
  const row = document.getElementById('predScopeRow');
  const box = document.getElementById('predPoly');
  const btnDraw = document.getElementById('polyDraw');
  const btnClear = document.getElementById('polyClear');
  const btnCoords = document.getElementById('polyCoords');
  const area = document.getElementById('polyText');
  const hint = document.getElementById('polyHint');

  let drawing = false;
  let pts = [];
  let shape = null;
  let mask = null;

  function fillOptions() {
    const opts = ['<option value="all">' + i18n.t('scope.all') + '</option>'];
    for (const r of P.meta.regions) {
      opts.push('<option value="r:' + r.key + '">' +
        (i18n.getLang() === 'ru' ? r.ru : r.en) + '</option>');
    }
    opts.push('<option value="poly">' + i18n.t('scope.polygon') + '</option>');
    const keep = sel.value;
    sel.innerHTML = opts.join('');
    if (keep) sel.value = keep;
  }

  function redraw() {
    if (shape) { map.removeLayer(shape); shape = null; }
    if (!pts.length) return;
    shape = L.polygon(pts, {
      color: '#7c1a2e', weight: 2, dashArray: '6 4',
      fillColor: '#7c1a2e', fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
  }

  function setHint() {
    if (sel.value !== 'poly') { hint.textContent = ''; return; }
    if (drawing) hint.textContent = i18n.t('poly.hint.drawing', { n: pts.length });
    else if (pts.length >= 3) hint.textContent = i18n.t('poly.hint.ready', { n: pts.length });
    else hint.textContent = i18n.t('poly.hint.empty');
  }

  function commit() {
    mask = (sel.value === 'poly' && pts.length >= 3)
      ? polygonMask(map, pts) : null;
    setHint();
    onChange();
  }

  function onMapClick(e) {
    if (!drawing) return;
    pts.push(e.latlng);
    redraw();
    setHint();
  }

  function stopDrawing() {
    if (!drawing) return;
    drawing = false;
    map.off('click', onMapClick);
    map.off('dblclick', stopDrawing);
    map.doubleClickZoom.enable();
    btnDraw.classList.remove('on');
    commit();
  }

  btnDraw.addEventListener('click', () => {
    if (drawing) { stopDrawing(); return; }
    pts = [];
    mask = null;
    redraw();
    drawing = true;
    btnDraw.classList.add('on');
    map.doubleClickZoom.disable();
    map.on('click', onMapClick);
    map.on('dblclick', stopDrawing);
    setHint();
  });

  btnClear.addEventListener('click', () => {
    stopDrawing();
    pts = [];
    mask = null;
    redraw();
    area.value = '';
    commit();
  });

  btnCoords.addEventListener('click', () => {
    area.hidden = !area.hidden;
    if (!area.hidden) {
      area.value = pts.map((p) => p.lat.toFixed(3) + ', ' + p.lng.toFixed(3)).join('\n');
      area.focus();
    }
  });

  area.addEventListener('change', () => {
    const parsed = parseCoords(area.value);
    if (parsed.length >= 3) {
      pts = parsed;
      redraw();
      commit();
    } else {
      hint.textContent = i18n.t('poly.hint.badcoords');
    }
  });

  sel.addEventListener('change', () => {
    if (sel.value !== 'poly') stopDrawing();
    box.hidden = sel.value !== 'poly';
    commit();
  });

  fillOptions();

  return {
    /** Выбрать область из адреса: ?scope=kara. */
    select(key) {
      if (!key) return;
      const v = key === 'all' || key === 'poly' ? key : 'r:' + key;
      if ([...sel.options].some((o) => o.value === v)) {
        sel.value = v;
        box.hidden = v !== 'poly';
      }
    },
    /** null -- весь охват; иначе функция «принадлежит ли ячейка области». */
    filter() {
      const v = sel.value;
      if (v === 'all') return null;
      if (v === 'poly') return mask ? ((at) => mask[at] === 1) : null;
      const key = v.slice(2);
      const id = P.meta.regions.findIndex((r) => r.key === key);
      if (id < 0) return null;
      return (at) => P.regionIndex[at] === id;
    },
    /** Подпись выбранной области для заголовка легенды. */
    label() {
      const v = sel.value;
      if (v === 'all') return i18n.t('scope.all');
      if (v === 'poly') return i18n.t('scope.polygon');
      const r = P.meta.regions.find((x) => x.key === v.slice(2));
      return r ? (i18n.getLang() === 'ru' ? r.ru : r.en) : v;
    },
    show(on) { row.hidden = !on; box.hidden = !on || sel.value !== 'poly'; },
    refreshLang() { fillOptions(); setHint(); },
  };
}
