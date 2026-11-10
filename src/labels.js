// Слой подписей.
//
// Подписи -- DOM, а не canvas, по трём причинам: текст не режется границей
// тайла; он остаётся текстом (поиск по странице, доступность, выделение);
// и он не требует контр-вращения -- см. комментарий в src/crs.js, карта для
// Leaflet остаётся неповёрнутой, так что подписи горизонтальны сами собой.
//
// Отбор подписей -- жадный по приоритету с проверкой на пересечение
// прямоугольников. Ширина текста оценивается по длине строки, а не меряется
// в DOM: измерение сотен элементов на каждый кадр стоит дороже, чем ошибка
// в пару пикселей на краю подписи.

import { MIN_LAT } from './config.js';

const FONTS = {
  pole:    { size: 11, cls: 'lb-pole',    prio: 0 },
  region:  { size: 12, cls: 'lb-region',  prio: 1 },
  island:  { size: 10, cls: 'lb-island',  prio: 2 },
  sea:     { size: 12, cls: 'lb-sea',     prio: 3 },
  basin:   { size: 10, cls: 'lb-basin',   prio: 4 },
  strait:  { size: 10, cls: 'lb-basin',   prio: 4 },
  relief:  { size: 10, cls: 'lb-relief',  prio: 5 },
  grat:    { size: 10, cls: 'lb-grat',    prio: 1 },
  city:    { size: 11, cls: 'lb-city',    prio: 7 },
};

/** Оценка ширины в пикселях: множитель подобран по строчным с засечками. */
function estWidth(text, size, letterSpaced) {
  return text.length * size * (letterSpaced ? 0.78 : 0.54);
}

/**
 * Штраф за удалённость от полюса.
 *
 * Natural Earth расставляет пороги показа исходя из карты всего мира, где
 * Филиппинское море и море Бофорта равноправны. У нас сервис арктический:
 * то, что южнее, должно уступать дорогу. Штраф в зумах, линейный по широте,
 * -- самый дешёвый способ это выразить, и он же убирает основную часть
 * мусора из подписей городов Китая и Индии на общем виде.
 */
function southPenalty(lat) {
  return Math.max(0, (62 - lat) / 10);
}

function buildItems(labels, lang) {
  const items = [];
  const pick = (o) => (lang === 'ru' && o.ru) ? o.ru : o.n;

  const skip = new Set(labels.skip || []);
  for (const w of labels.water || []) {
    if (skip.has(w.n)) continue;
    // min_label Natural Earth рассчитан на веб-меркаторские зумы; у нас
    // диапазон вдвое короче, поэтому порог сжимается, а не сдвигается.
    items.push({ text: pick(w), ll: w.ll, kind: 'sea',
                 min: ((w.min || 2) - 1) * 0.5 + southPenalty(w.ll[1]), max: 9 });
  }
  for (const w of labels.water_extra || []) {
    items.push({ text: pick(w), ll: w.ll, kind: w.kind || 'basin',
                 min: w.min || 0, max: w.max || 9 });
  }
  for (const l of labels.land || []) {
    items.push({ text: pick(l), ll: l.ll, kind: l.kind || 'region',
                 min: l.min || 0, max: l.max || 9 });
  }
  for (const c of labels.cities || []) {
    // labelrank Natural Earth: 1 -- мировые столицы, 10 -- посёлки.
    // Растягиваем ранг на весь диапазон зумов: на общем виде остаются только
    // столицы, мелкие северные посёлки появляются кz=6.
    const rank = (c.rank || 8) - (c.cap ? 0.6 : 0);
    items.push({ text: pick(c), ll: c.ll, kind: 'city', dot: true,
                 min: (rank - 1) / 1.35 + southPenalty(c.ll[1]) * 0.8, max: 9 });
  }
  items.sort((a, b) => FONTS[a.kind].prio - FONTS[b.kind].prio);
  return items;
}

export const ArcticLabels = L.Layer.extend({
  initialize(labels, options) {
    L.setOptions(this, options);
    this._raw = labels;
    this._lang = (options && options.lang) || 'en';
    this._items = buildItems(labels, this._lang);
    this._hidden = {};
  },

  onAdd(map) {
    this._map = map;
    if (!map.getPane('arcticLabels')) {
      map.createPane('arcticLabels');
      map.getPane('arcticLabels').style.zIndex = 620;
      map.getPane('arcticLabels').style.pointerEvents = 'none';
    }
    this._pane = map.getPane('arcticLabels');
    this._root = L.DomUtil.create('div', 'arctic-labels leaflet-zoom-hide', this._pane);
    this.update();
    return this;
  },

  onRemove() {
    L.DomUtil.remove(this._root);
    this._root = null;
  },

  getEvents() {
    return { viewreset: this.update, zoomend: this.update, moveend: this.update };
  },

  setLang(lang) {
    this._lang = lang;
    this._items = buildItems(this._raw, lang);
    this.update();
  },

  setVisible(kind, on) {
    this._hidden[kind] = !on;
    this.update();
  },

  /**
   * Подписи меридианов по краю окна.
   *
   * Считаются заново на каждое обновление, потому что при вращении и
   * перемещении меридиан входит в окно в другом месте. Идём по меридиану с
   * юга на север и берём первую точку, попавшую в окно: она и лежит на
   * границе кадра. При вращении это единственный ориентир, привязанный к
   * самой карте, а не к элементу интерфейса.
   */
  _frameItems() {
    const map = this._map;
    const size = map.getSize();
    const inset = 26;
    const out = [];
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = MIN_LAT; lat <= 88; lat += 1) {
        const c = map.latLngToContainerPoint(L.latLng(lat, lon));
        if (c.x >= inset && c.y >= inset &&
            c.x <= size.x - inset && c.y <= size.y - inset) {
          const t = lon === 0 ? '0°' : (lon === -180 ? '180°'
            : Math.abs(lon) + '°' + (lon > 0 ? 'E' : 'W'));
          out.push({ text: t, ll: [lon, lat], kind: 'grat', min: 0, max: 9 });
          break;
        }
      }
    }
    return out;
  },

  update() {
    if (!this._root || !this._map) return;
    const map = this._map;
    const z = map.getZoom();
    const size = map.getSize();
    const placed = [];
    const html = [];

    const all = this._hidden.grat ? this._items
      : this._items.concat(this._frameItems())
          .sort((a, b) => FONTS[a.kind].prio - FONTS[b.kind].prio);

    for (const it of all) {
      if (this._hidden[it.kind]) continue;
      if (z < it.min || z > it.max) continue;

      // Позиция -- в координатах слоя (панель уже сдвинута Leaflet при
      // перетаскивании), отбор видимого -- в координатах контейнера.
      const p = map.latLngToLayerPoint(L.latLng(it.ll[1], it.ll[0]));
      const c = map.layerPointToContainerPoint(p);
      if (c.x < -60 || c.y < -30 || c.x > size.x + 60 || c.y > size.y + 30) continue;

      const f = FONTS[it.kind];
      const spaced = it.kind === 'region' || it.kind === 'island' || it.kind === 'pole';
      const w = estWidth(it.text, f.size, spaced);
      const h = f.size + 4;
      const dx = it.dot ? 7 : -w / 2;     // город подписывается справа от точки
      const box = [p.x + dx, p.y - h / 2, p.x + dx + w, p.y + h / 2];

      let clash = false;
      for (const q of placed) {
        if (box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push(box);

      const style = 'left:' + p.x.toFixed(1) + 'px;top:' + p.y.toFixed(1) + 'px';
      if (it.dot) html.push('<i class="lb-dot" style="' + style + '"></i>');
      html.push('<span class="lb ' + f.cls + (it.dot ? ' lb-anchor-left' : '') +
                '" style="' + style + '">' + it.text + '</span>');
    }
    this._root.innerHTML = html.join('');
  },
});

export function arcticLabels(labels, options) {
  return new ArcticLabels(labels, options);
}
