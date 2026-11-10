// Наложение расчётного поля: матрица 432x432 в сетке EASE2 -> экран.
//
// Это точка подключения данных пайплайна. Слой принимает Float32Array длиной
// 432*432 (порядок строк -- как в netCDF, row 0 = север) и рисует его поверх
// подложки.
//
// Как это пересчитывается быстро
// ------------------------------
// Обе проекции азимутальные с центром в полюсе, поэтому переход из одной в
// другую -- чисто РАДИАЛЬНЫЙ: азимут сохраняется, меняется только расстояние
// от полюса. Значит вместо вызова proj4 на каждый пиксель (миллион вызовов на
// кадр) достаточно один раз построить таблицу r_ease(r_stere) и на пиксель
// делать одно умножение. Разворот карты при этом учитывается той же матрицей
// поворота, что и в подложке.

import { DATA_PROJ, DATA_GRID } from './config.js';

const LUT_N = 1024;

function buildRadialLut(crs) {
  const toEase = proj4('WGS84', DATA_PROJ);
  const lut = new Float64Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const r = crs.radius * i / LUT_N;
    if (r === 0) { lut[i] = 0; continue; }
    // Берём точку на меридиане 0: стерео (0, -r) -- это lon=0.
    const [lon, lat] = crs.inverseRaw(0, -r);
    const [, ey] = toEase.forward([lon, lat]);
    lut[i] = Math.abs(ey) / r;          // коэффициент растяжения радиуса
  }
  lut[0] = lut[1];
  return lut;
}

/** Палитры. Каждая -- функция [0..1] -> [r,g,b]. */
export const COLORMAPS = {
  // Сплочённость льда: от воды к белому льду, как на картах NSIDC.
  sic: (t) => {
    const stops = [[0.00, 106, 145, 178], [0.15, 126, 166, 196], [0.40, 168, 199, 219],
                   [0.70, 215, 232, 241], [1.00, 252, 253, 255]];
    return interp(stops, t);
  },
  // Расходящаяся: аномалии относительно нормы.
  anomaly: (t) => {
    const stops = [[0.0, 33, 89, 145], [0.25, 116, 165, 201], [0.5, 243, 240, 232],
                   [0.75, 206, 125, 88], [1.0, 140, 45, 34]];
    return interp(stops, t);
  },
  // Последовательная тёплая: полезность предиктора, значимость и т.п.
  utility: (t) => {
    const stops = [[0.0, 247, 244, 234], [0.35, 226, 199, 145], [0.65, 199, 134, 79],
                   [1.0, 128, 47, 39]];
    return interp(stops, t);
  },
};

function interp(stops, t) {
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], l[2], l[3]];
}

export const ArcticField = L.Layer.extend({
  initialize(options) {
    L.setOptions(this, options);
    this._mode = null;            // 'scalar' | 'category'
    this._grid = null;
    this._cmap = COLORMAPS.sic;
    this._range = [0, 1];
    this._opacity = 0.9;
  },

  onAdd(map) {
    this._map = map;
    this._lut = buildRadialLut(map.options.crs);
    this._canvas = L.DomUtil.create('canvas', 'arctic-field leaflet-zoom-hide',
                                    this.getPane());
    this._ctx = this._canvas.getContext('2d');
    this.redraw();
    return this;
  },

  onRemove() {
    L.DomUtil.remove(this._canvas);
    this._canvas = null;
  },

  getEvents() {
    return { viewreset: this.redraw, zoomend: this.redraw,
             moveend: this.redraw, resize: this.redraw };
  },

  /**
   * @param {Float32Array|Array} grid  432*432, row 0 -- север; NaN = нет данных
   * @param {object} opts  {cmap, range, opacity}
   */
  setField(grid, opts) {
    this._mode = grid ? 'scalar' : null;
    this._grid = grid;
    if (opts) {
      if (opts.cmap) this._cmap = opts.cmap;
      if (opts.range) this._range = opts.range;
      if (opts.opacity !== undefined) this._opacity = opts.opacity;
    }
    this.redraw();
  },

  /**
   * Категориальный слой: в ячейке не число, а «кто ведёт».
   *
   * cat -- индекс группы предикторов (или catInsignificant / catNodata),
   * weight -- отрыв лидера от второго, приведённый к 0..255. Отрыв правит
   * насыщенностью: ячейка, где первый обгоняет второго на волос, и ячейка,
   * где втрое, обязаны отличаться на вид, иначе карта лидера показывает
   * мозаику там, где на деле шум.
   */
  setCategories(cat, weight, opts) {
    this._mode = cat ? 'category' : null;
    this._cat = cat;
    this._weight = weight;
    if (opts) {
      this._colors = opts.colors || this._colors;        // [[r,g,b], ...]
      this._insig = opts.insignificant || [222, 220, 214];
      this._catInsig = opts.catInsignificant !== undefined
        ? opts.catInsignificant : 254;
      this._catNodata = opts.catNodata !== undefined ? opts.catNodata : 255;
      // Вне домена постановки: красится тем же серым, что и незначимый
      // лидер. Путаницы не будет -- у постановок с таким доменом
      // значимость не считалась, и «незначимых» ячеек в них нет.
      this._catOutside = opts.catOutside !== undefined ? opts.catOutside : 253;
      // «Не хватило данных для оценки» -- тот же нейтральный серый: для
      // глаза это одинаково «здесь ответа нет», а различие называет
      // подсказка и строка легенды.
      this._catNoEst = opts.catNoEstimate !== undefined ? opts.catNoEstimate : 252;
      if (opts.opacity !== undefined) this._opacity = opts.opacity;
    }
    this.redraw();
  },

  clear() {
    this._mode = null;
    this._grid = null;
    this._cat = null;
    this.redraw();
  },

  setOpacity(v) {
    this._opacity = v;
    if (this._canvas) this._canvas.style.opacity = v;
  },

  redraw() {
    if (!this._canvas || !this._map) return;
    const map = this._map;
    const crs = map.options.crs;
    const size = map.getSize();
    const cv = this._canvas;

    cv.width = size.x;
    cv.height = size.y;
    cv.style.width = size.x + 'px';
    cv.style.height = size.y + 'px';
    cv.style.opacity = this._opacity;
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));

    if (!this._mode) {
      this._ctx.clearRect(0, 0, size.x, size.y);
      return;
    }

    const N = DATA_GRID.size;
    const cell = DATA_GRID.cellSize;
    const half = DATA_GRID.halfExtent;
    const [lo, hi] = this._range;
    const span = (hi - lo) || 1;
    const cmap = this._cmap;
    const lut = this._lut;
    const R = crs.radius;
    const cats = this._mode === 'category';
    const cat = this._cat, wgt = this._weight;
    const colors = this._colors, insig = this._insig;
    const catInsig = this._catInsig, catNodata = this._catNodata;
    const catOutside = this._catOutside, catNoEst = this._catNoEst;

    // Экранный пиксель -> метры проекции отображения (обратная матрица к той,
    // что строит подложка).
    const k = crs.scale(map.getZoom());
    const a = crs.getAngle() * Math.PI / 180;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const topLeft = map.containerPointToLayerPoint([0, 0]).add(map.getPixelOrigin());

    const img = this._ctx.createImageData(size.x, size.y);
    const d = img.data;

    for (let py = 0; py < size.y; py++) {
      const worldY = topLeft.y + py;
      const Ym = R - worldY / k;
      for (let px = 0; px < size.x; px++) {
        const worldX = topLeft.x + px;
        const Xm = worldX / k - R;

        // снимаем поворот
        const xs = Xm * cosA + Ym * sinA;
        const ys = -Xm * sinA + Ym * cosA;

        const r = Math.hypot(xs, ys);
        if (r > R) continue;
        const f = lut[Math.round(r / R * LUT_N)];
        const ex = xs * f, ey = ys * f;
        if (ex < -half || ex >= half || ey <= -half || ey > half) continue;

        const col = (ex + half) / cell | 0;
        const row = (half - ey) / cell | 0;
        const at = row * N + col;
        const o = (py * size.x + px) * 4;

        if (cats) {
          const c = cat[at];
          if (c === catNodata) continue;
          if (c === catInsig || c === catOutside || c === catNoEst) {
            d[o] = insig[0]; d[o + 1] = insig[1]; d[o + 2] = insig[2];
          } else {
            const base = colors[c];
            if (!base) continue;
            const wv = wgt ? wgt[at] / 255 : 1;
            d[o] = 255 - (255 - base[0]) * wv;
            d[o + 1] = 255 - (255 - base[1]) * wv;
            d[o + 2] = 255 - (255 - base[2]) * wv;
          }
          d[o + 3] = 255;
          continue;
        }

        const v = this._grid[at];
        if (v === undefined || v !== v) continue;       // NaN -- нет данных
        const rgb = cmap((v - lo) / span);
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
      }
    }
    this._ctx.putImageData(img, 0, 0);
  },
});

export function arcticField(options) {
  return new ArcticField(options);
}

/**
 * Загрузка настоящего поля, подготовленного tools/export_field.py.
 *
 * Формат намеренно примитивный: сырой float32 little-endian, 432*432,
 * построчно с севера. Разбора нет вообще -- ArrayBuffer сразу становится
 * Float32Array, 746 КБ на матрицу. Для сервиса, где кадры перелистывают
 * по дням, это важнее компактности: PNG пришлось бы декодировать и
 * квантовать, а netCDF -- тащить парсер в браузер.
 */
export async function loadField(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('поле не читается: ' + url + ' -> ' + res.status);
  const buf = await res.arrayBuffer();
  const need = DATA_GRID.size * DATA_GRID.size * 4;
  if (buf.byteLength !== need) {
    throw new Error('ожидалось ' + need + ' байт, пришло ' + buf.byteLength);
  }
  return new Float32Array(buf);
}
