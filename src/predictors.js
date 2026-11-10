// Карты преобладающих предикторов: загрузка и состояние.
//
// Постановок несколько: месячная на полном ряде и суточные по фазам ледового
// цикла. У них РАЗНЫЕ домены -- месячная считана на всей океанской маске,
// суточная только в краевой ледовой зоне, -- поэтому суточная карта выглядит
// кольцом. Палитра при этом общая, иначе переключение между постановками
// перестало бы что-либо сравнивать.
//
// Два представления одного результата, и смысл карты -- в их расхождении:
//
//   регионы -- одно значение на море, как в опубликованных постановках
//              («предикторы для Карского моря»);
//   ячейки  -- тот же выбор в каждой ячейке сетки.
//
// Поэтому режимы взаимоисключающие и переключаются одним щелчком: сравнение
// делается памятью глаза, а не совмещением двух слоёв.
//
// Данные готовит tools/export_predictor_maps.py. Попиксельные слои лежат
// сырыми байтами -- три плоскости (категория, U лидера, отрыв), 546 КБ на
// горизонт -- и подгружаются по требованию: грузить все пять при старте
// незачем, а gzip ужимает их примерно вдесятеро.

import { DATA_PROJ, DATA_GRID } from './config.js';

export function hexToRgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16),
          parseInt(s.slice(2, 4), 16),
          parseInt(s.slice(4, 6), 16)];
}

export async function loadPredictors(baseUrl) {
  const meta = await fetch(baseUrl + 'predictors.json').then((r) => {
    if (!r.ok) throw new Error('predictors.json: ' + r.status);
    return r.json();
  });
  const regionIndex = new Uint8Array(
    await fetch(baseUrl + 'region_index.bin').then((r) => r.arrayBuffer()));

  const colors = meta.groups.map((g) => hexToRgb(g.color));
  const regionByKey = {};
  meta.regions.forEach((r, i) => { regionByKey[r.key] = { ...r, id: i }; });
  const setupByKey = {};
  for (const st of meta.setups) setupByKey[st.key] = st;

  return {
    baseUrl, meta, regionIndex, colors, regionByKey, setupByKey,
    setups: meta.setups,
    cache: new Map(),
    insignificant: hexToRgb(meta.colorInsignificant),
  };
}

/**
 * Постановки, доступные для этой дискретизации, в порядке ледового цикла.
 *
 * Показываем только те, для которых есть попиксельные карты. Суточный
 * «весь год» посчитан лишь по морям, и держать сезон, который работает в
 * одном режиме и пуст в другом, -- источник недоумения, а не возможность.
 * Появятся для него карты -- сезон вернётся в список сам.
 */
export function seasonsOf(P, disc) {
  // Постановка с вычтенным календарём отвечает на другой вопрос, но сезоны
  // и горизонты у неё те же. В списке сезонов она не участвует, иначе
  // каждый сезон стоял бы в выпадающем списке дважды.
  return P.setups.filter((st) => st.disc === disc && st.pixel && !st.cal);
}

/** Горизонты, доступные в этом режиме: у ячеек и морей они могут расходиться. */
export function lagsOf(setup, mode) {
  if (!setup) return [];
  if (mode === 'pixel') return setup.lags || [];
  // Пустой список регионов -- не повод падать на `||`: пустой массив
  // истинен, и постановка без региональных расчётов (такова любая с
  // вычтенным календарём) оставалась бы вовсе без горизонтов.
  const reg = setup.lagsRegion || [];
  return reg.length ? reg : (setup.lags || []);
}

/**
 * Попиксельный слой для горизонта, с кэшем.
 *
 * В файле три плоскости по байту на ячейку: категория, U лидера и отрыв
 * U1-U2. Квантование снимается масштабами из манифеста, так что наружу
 * уходят настоящие наты, а не безразмерная шкала.
 *
 * Насыщенность цвета считается здесь же, по тем же перцентилям 10/90, что и
 * в `plot_region_vs_pixel.py`: ячейка, где лидер обгоняет второго на волос,
 * и ячейка, где втрое, не должны краситься одинаково. Раньше она приезжала
 * из экспорта готовой -- и подсказка под курсором показывала её вместо
 * отрыва, то есть параметр отрисовки вместо измеренной величины.
 */
export async function lagLayer(P, setupKey, lag) {
  const id = setupKey + '/' + lag;
  if (P.cache.has(id)) return P.cache.get(id);
  const buf = await fetch(
    P.baseUrl + 'pixel_leader_' + setupKey + '_lag' + lag + '.bin')
    .then((r) => {
      if (!r.ok) throw new Error(id + ': ' + r.status);
      return r.arrayBuffer();
    });
  const n = DATA_GRID.size * DATA_GRID.size;
  // Три плоскости обязательны, четвёртая -- необязательная: конкретная
  // переменная-лидер. Она есть там, где исходные данные считались по
  // переменным, а не по свёрнутым группам (суточная постановка).
  const planes = buf.byteLength / n;
  if (planes !== 3 && planes !== 4) {
    throw new Error('неожиданный размер слоя lag ' + lag + ': ' + buf.byteLength);
  }
  const setup = P.setupByKey[setupKey] || {};
  const meta = (setup.lagMeta || {})[String(lag)] || {};
  const gap = new Uint8Array(buf, 2 * n, n);

  const lo = meta.gapP10 || 0;
  const hi = meta.gapP90 || 1;
  const scale = meta.gapScale || 1 / 255;
  const span = Math.max(hi - lo, 1e-9);
  const weight = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const nats = gap[i] * scale;
    const t = Math.min(Math.max((nats - lo) / span, 0), 1);
    weight[i] = Math.round((0.32 + 0.68 * t) * 255);
  }

  const layer = {
    cat: new Uint8Array(buf, 0, n),
    u1: new Uint8Array(buf, n, n),
    vars: planes === 4 ? new Uint8Array(buf, 3 * n, n) : null,
    gap, weight,
    u1Scale: meta.u1Scale || 1 / 255,
    gapScale: scale,
  };
  P.cache.set(id, layer);
  return layer;
}

/** Цвета заливки морей для региональной постановки: {ключ: css-цвет}. */
export function regionPaint(P, setupKey, lag) {
  const setup = P.setupByKey[setupKey] || {};
  const table = (setup.regionLeader || {})[String(lag)] || {};
  const out = {};
  for (const [key, rec] of Object.entries(table)) {
    out[key] = rec.sig ? P.meta.groups[rec.g].color : P.meta.colorInsignificant;
  }
  return out;
}

let _toEase = null;

/**
 * Точка на карте -> ячейка сетки EASE2.
 * Возвращает null вне сетки. Один вызов proj4 на точку -- для подсказки
 * под курсором этого достаточно, в отличие от отрисовки поля.
 */
export function cellAt(latlng) {
  if (!_toEase) _toEase = proj4('WGS84', DATA_PROJ);
  const [x, y] = _toEase.forward([latlng.lng, latlng.lat]);
  const half = DATA_GRID.halfExtent;
  const cell = DATA_GRID.cellSize;
  if (x < -half || x >= half || y <= -half || y > half) return null;
  const col = Math.floor((x + half) / cell);
  const row = Math.floor((half - y) / cell);
  if (row < 0 || row >= DATA_GRID.size || col < 0 || col >= DATA_GRID.size) {
    return null;
  }
  return { row, col, at: row * DATA_GRID.size + col };
}

/** Что показать в подсказке под курсором. */
export function probe(P, setupKey, layer, lag, latlng, lang) {
  const c = cellAt(latlng);
  if (!c) return null;

  const rid = P.regionIndex[c.at];
  const region = rid === 255 ? null : P.meta.regions[rid];
  const out = { region: region ? (lang === 'ru' ? region.ru : region.en) : null,
                regionKey: region ? region.key : null };

  const setup = P.setupByKey[setupKey] || {};
  if (region) {
    const rec = ((setup.regionLeader || {})[String(lag)] || {})[region.key];
    if (rec) {
      out.regionLeader = rec.name;
      out.regionSig = rec.sig;
      out.share = rec.share;
    }
  }
  if (layer) {
    const cat = layer.cat[c.at];
    if (cat === P.meta.catNodata) {
      out.cell = 'nodata';
    } else if (cat === P.meta.catOutside) {
      out.cell = 'outside';
    } else if (cat === P.meta.catNoEstimate) {
      out.cell = 'noestimate';
    } else if (cat === P.meta.catInsignificant) {
      out.cell = 'insignificant';
    } else {
      out.cell = P.meta.groups[cat].key;
      // Карта красится по группам, чтобы месячная и суточная сравнивались
      // между собой. Но если известна конкретная переменная -- под курсором
      // называем её: «strd/ssrd/tcc» и «ssrd» -- утверждения разной точности.
      if (layer.vars) {
        const v = layer.vars[c.at];
        const setup = P.setupByKey[setupKey];
        const names = setup && setup.varNames;
        if (names && v < names.length) out.variable = names[v];
      }
      // Настоящие величины, в натах: U лидера и его отрыв от второй группы.
      out.u1 = layer.u1[c.at] * layer.u1Scale;
      out.gap = layer.gap[c.at] * layer.gapScale;
      out.rel = out.u1 > 0 ? out.gap / out.u1 : null;
    }
  }
  return out;
}
