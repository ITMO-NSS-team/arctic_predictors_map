// Векторная подложка: слой тайлов, который рисует геометрию на canvas.
//
// Почему не готовые растровые тайлы
// ---------------------------------
// Растровый тайл пришлось бы печь заново при каждом изменении палитры и
// отдельным комплектом на каждый угол поворота. Здесь тайл рисуется из уже
// спроецированной геометрии (см. geodata.js) прямо в браузере: поворот --
// это другая матрица, смена палитры -- перезагрузка страницы, и никакого
// конвейера сборки.
//
// Если понадобится отдать подложку статикой на CDN, тот же код печатает
// PNG-тайлы в headless-браузере: рисование вынесено в чистую функцию
// drawTile(ctx, ...), не зависящую от Leaflet.

import { PALETTE, WIDTHS, oceanColor } from './palette.js';

/** Аффинное преобразование: метры проекции -> пиксели тайла. */
function tileTransform(crs, coords, tileSize, dpr) {
  const k = crs.scale(coords.z) * dpr;
  const a = crs.getAngle() * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return {
    a11: k * cos, a12: -k * sin, tx: k * crs.radius - coords.x * tileSize * dpr,
    a21: -k * sin, a22: -k * cos, ty: k * crs.radius - coords.y * tileSize * dpr,
    k,
  };
}

/**
 * Кладёт кольца объекта в текущий путь ctx.
 * Точки ближе minStep пикселей к предыдущей выбрасываются: на мелких зумах
 * это убирает до 90 % вершин, а на глаз разницы нет.
 */
function trace(ctx, rings, T, minStep, closed) {
  for (const ring of rings) {
    const p = ring.pts;
    const n = p.length / 2;
    if (n < 2) continue;
    let lx = 0, ly = 0, started = false, kept = 0;
    for (let i = 0; i < n; i++) {
      const x = p[2 * i], y = p[2 * i + 1];
      const sx = T.a11 * x + T.a12 * y + T.tx;
      const sy = T.a21 * x + T.a22 * y + T.ty;
      if (!started) {
        ctx.moveTo(sx, sy);
        lx = sx; ly = sy; started = true; kept = 1;
        continue;
      }
      if (i < n - 1 && Math.abs(sx - lx) + Math.abs(sy - ly) < minStep) continue;
      ctx.lineTo(sx, sy);
      lx = sx; ly = sy; kept++;
    }
    if (closed && kept > 2) ctx.closePath();
  }
}

/** Отбраковка: описывающая окружность объекта против прямоугольника тайла. */
function visible(f, T, w, h, margin) {
  const fx = T.a11 * f.cx + T.a12 * f.cy + T.tx;
  const fy = T.a21 * f.cx + T.a22 * f.cy + T.ty;
  const r = f.rad * T.k + margin;
  return fx + r >= 0 && fx - r <= w && fy + r >= 0 && fy - r <= h;
}

function pathOf(ctx, layer, T, w, h, minStep, closed, margin = 24) {
  ctx.beginPath();
  let any = false;
  for (const f of layer.features) {
    if (!visible(f, T, w, h, margin)) continue;
    trace(ctx, f.rings, T, minStep, closed);
    any = true;
  }
  return any;
}

/**
 * Рисование одного тайла. Чистая функция от контекста и данных -- ни одного
 * обращения к карте, поэтому годится и для выпечки статических тайлов.
 *
 * Подложка режется на две части: `ocean` (заливка и глубины) и `land` (всё
 * остальное). Между ними в стопке лежит слой данных -- поле сплочённости
 * должно лежать НА воде, но ПОД берегом и подписями, иначе карта перестаёт
 * читаться ровно там, где на неё смотрят.
 */
export function drawTile(ctx, data, crs, coords, tileSize, dpr, opts) {
  const draft = !!(opts && opts.draft);
  const show = (opts && opts.show) || {};
  const part = (opts && opts.part) || 'all';
  const T = tileTransform(crs, coords, tileSize, dpr);
  const w = tileSize * dpr, h = tileSize * dpr;
  const z = coords.z;
  const L_ = data.layers;

  // Порог прореживания: на мелких зумах агрессивнее, при перетаскивании
  // компаса ещё агрессивнее -- там важнее кадровая частота.
  const step = draft ? 1.6 : 0.65;
  const lw = (v) => v * dpr;

  ctx.save();

  // Круг карты. Всё, что рисуется дальше, обрезано по 16.6 с.ш.: охват
  // подложки ровно совпадает с областью расчётной сетки.
  ctx.beginPath();
  ctx.arc(T.tx, T.ty, crs.radius * T.k, 0, Math.PI * 2);
  ctx.clip();

  // --- океан ступенями по глубине ---
  if (part !== 'land') {
    ctx.fillStyle = oceanColor(0);
    ctx.fillRect(0, 0, w, h);

    if (show.bathymetry !== false) {
      for (const lvl of L_.bathymetry) {
        if (pathOf(ctx, lvl.data, T, w, h, step, true)) {
          ctx.fillStyle = oceanColor(lvl.level);
          ctx.fill('evenodd');
          if (!draft && z >= 1) {
            ctx.strokeStyle = PALETTE.isobath;
            ctx.lineWidth = lw(WIDTHS.isobath);
            ctx.stroke();
          }
        }
      }
    }
    // Заливка морей цветом ведущего предиктора (региональная постановка).
    // Живёт в «водяной» части: в этом режиме попиксельный слой выключен,
    // и спор за место в стопке невозможен.
    const paint = opts && opts.regionPaint;
    if (paint && L_.regions) {
      ctx.save();
      // Заливка полупрозрачна не для красоты: под ней остаётся бровка шельфа,
      // а именно с ней и надо сопоставлять «один цвет на море».
      ctx.globalAlpha = opts.regionAlpha === undefined ? 0.92 : opts.regionAlpha;
      for (const f of L_.regions.features) {
        const col = paint[f.a.key];
        if (!col || !visible(f, T, w, h, 8)) continue;
        ctx.beginPath();
        trace(ctx, f.rings, T, step, true);
        ctx.fillStyle = col;
        ctx.fill('evenodd');
      }
      ctx.restore();
    }

    if (part === 'ocean') {
      ctx.restore();
      return;
    }
  }

  // --- суша с ореолом в воду ---
  if (pathOf(ctx, L_.land, T, w, h, step, true, 48)) {
    if (!draft) {
      ctx.shadowColor = PALETTE.landGlow;
      ctx.shadowBlur = PALETTE.landGlowBlur * dpr;
    }
    ctx.fillStyle = PALETTE.land;
    ctx.fill('evenodd');
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = PALETTE.landEdge;
    ctx.lineWidth = lw(z >= 4 ? WIDTHS.coastBold : WIDTHS.coast);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // --- озёра ---
  if (show.water !== false && !draft && pathOf(ctx, L_.lakes, T, w, h, step, true)) {
    ctx.fillStyle = PALETTE.lake;
    ctx.fill('evenodd');
    ctx.strokeStyle = PALETTE.lakeEdge;
    ctx.lineWidth = lw(WIDTHS.lake);
    ctx.stroke();
  }

  // --- реки ---
  if (show.water !== false && !draft && z >= 1 && pathOf(ctx, L_.rivers, T, w, h, step, false)) {
    ctx.strokeStyle = PALETTE.river;
    ctx.lineWidth = lw(Math.min(1.1, 0.45 + z * 0.12));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // --- границы государств: светлая подложка + пунктир ---
  if (show.borders !== false && !draft && z >= 1
      && pathOf(ctx, L_.borders, T, w, h, step, false)) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = PALETTE.borderCasing;
    ctx.lineWidth = lw(WIDTHS.borderCasing);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = lw(WIDTHS.border);
    ctx.setLineDash([lw(5), lw(3.5)]);
    ctx.stroke();
    ctx.restore();
  }

  // --- границы морей-регионов ---
  // Рисуются в «сухой» части, то есть поверх слоя данных: под попиксельной
  // мозаикой граница нужна как раз для того, чтобы видеть, где кончается
  // море, по которому осредняют.
  if (show.regions && L_.regions) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const f of L_.regions.features) {
      if (!visible(f, T, w, h, 8)) continue;
      trace(ctx, f.rings, T, step, true);
    }
    ctx.strokeStyle = PALETTE.regionCasing;
    ctx.lineWidth = lw(WIDTHS.regionCasing);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.regionEdge;
    ctx.lineWidth = lw(WIDTHS.region);
    ctx.stroke();
    ctx.restore();
  }

  // --- градусная сетка ---
  if (show.graticule !== false) {
    ctx.save();
    ctx.strokeStyle = PALETTE.graticule;
    ctx.lineWidth = lw(WIDTHS.graticule);
    ctx.setLineDash([lw(2.5), lw(3)]);
    ctx.beginPath();
    for (const f of L_.meridians.features) trace(ctx, f.rings, T, step, false);
    for (const f of L_.parallels.features) trace(ctx, f.rings, T, step, false);
    ctx.stroke();

    ctx.setLineDash([lw(7), lw(4)]);
    ctx.strokeStyle = PALETTE.arcticCircle;
    ctx.lineWidth = lw(WIDTHS.arcticCircle);
    ctx.beginPath();
    for (const f of L_.arcticCircle.features) trace(ctx, f.rings, T, step, false);
    ctx.stroke();
    ctx.restore();
  }

  // --- контур расчётной сетки EASE2 ---
  if (show.gridDomain) {
    ctx.save();
    ctx.strokeStyle = PALETTE.gridDomain;
    ctx.lineWidth = lw(WIDTHS.gridDomain);
    ctx.setLineDash([lw(9), lw(5)]);
    ctx.beginPath();
    for (const f of L_.gridDomain.features) trace(ctx, f.rings, T, step, false);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // --- обрез карты: рисуется вне клипа, поэтому линия не срезана пополам ---
  ctx.save();
  ctx.beginPath();
  ctx.arc(T.tx, T.ty, crs.radius * T.k, 0, Math.PI * 2);
  ctx.strokeStyle = PALETTE.rim;
  ctx.lineWidth = lw(WIDTHS.rim);
  ctx.stroke();
  ctx.restore();
}

export const ArcticBasemap = L.GridLayer.extend({
  initialize(data, options) {
    L.setOptions(this, options);
    this._data = data;
    this._draft = false;
    this._show = { gridDomain: false, regions: false };
    this._regionPaint = null;
    this._regionAlpha = 0.92;
  },

  /**
   * Заливка морей: {ключ региона: цвет} или null.
   * Цвета приходят из слоя предикторов, подложка о них ничего не знает.
   */
  setRegionPaint(paint, alpha) {
    this._regionPaint = paint;
    if (alpha !== undefined) this._regionAlpha = alpha;
    this.redraw();
  },

  /**
   * Черновой режим на время перетаскивания компаса: меньше слоёв, грубее.
   * silent -- не перерисовывать сразу: вызывающий код всё равно сбросит вид.
   */
  setDraft(on, silent) {
    if (this._draft === on) return;
    this._draft = on;
    if (!silent) this.redraw();
  },

  setVisible(key, on) {
    this._show[key] = on;
    this.redraw();
  },

  isVisible(key) {
    return this._show[key] !== false;
  },

  createTile(coords, done) {
    const size = this.getTileSize().x;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    tile.width = size * dpr;
    tile.height = size * dpr;
    tile.style.width = size + 'px';
    tile.style.height = size + 'px';
    const ctx = tile.getContext('2d');
    drawTile(ctx, this._data, this._map.options.crs, coords, size, dpr,
             { draft: this._draft, show: this._show, part: this.options.part,
               regionPaint: this._regionPaint,
               regionAlpha: this._regionAlpha });
    // Тайл готов сразу, но done нельзя звать синхронно: Leaflet ещё не
    // зарегистрировал элемент, и без отложенного вызова тайл останется
    // прозрачным (класс leaflet-tile-loaded не проставится).
    setTimeout(() => done(null, tile), 0);
    return tile;
  },
});

export function arcticBasemap(data, options) {
  return new ArcticBasemap(data, options);
}
