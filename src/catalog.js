// Справочник предикторов: выдвижная панель справа.
//
// Зачем он на карте, а не в документации: в легенде стоят `t2m/2d/t500` и
// `mld001/mld003`, и без расшифровки карта читается только теми, кто и так
// знает набор. Справочник отвечает на три вопроса, которые возникают прямо
// у карты -- что это за аббревиатура, откуда данные и как они агрегированы.
//
// Содержимое генерируется из карточки датасета (tools/export_catalog.py), а
// не набрано в разметке: иначе оно разошлось бы с карточкой на первом же
// прогоне аудита.
//
// Цветной квадрат у переменной -- цвет её группы избыточности на карте. Это
// единственная связка между легендой и справочником, и она же объясняет,
// почему переменные объединены: в одной группе -- те, что конкурируют за
// одну и ту же информацию.

import * as i18n from './i18n.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function loadCatalog(baseUrl) {
  const res = await fetch(baseUrl + 'catalog.json');
  if (!res.ok) throw new Error('catalog.json: ' + res.status);
  return res.json();
}

/**
 * @param {object} cat      содержимое catalog.json
 * @param {object} groupColor  {имя группы: css-цвет} из слоя предикторов
 */
export function createCatalog(map, cat, groupColor) {
  const panel = document.createElement('div');
  panel.className = 'catalog';
  panel.hidden = true;
  document.body.appendChild(panel);

  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = L.DomUtil.create('div', 'cat-btn');
      box.innerHTML = '<button data-i18n="catalog.open"></button>';
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(box, 'pointerdown', L.DomEvent.stopPropagation);
      i18n.apply(box);
      this._box = box;
      return box;
    },
  });
  const ctl = new Control();
  map.addControl(ctl);
  const button = ctl._box.querySelector('button');

  function row(v) {
    const lang = i18n.getLang();
    const title = (lang === 'ru' ? v.ru : v.en) || v.ru || v.en;
    const units = lang === 'ru' ? v.units : (v.unitsEn || v.units);
    const agg = lang === 'ru' ? v.agg : (v.aggEn || v.agg);
    const native = lang === 'ru' ? v.nativeStep : (v.nativeStepEn || v.nativeStep);
    const step = lang === 'ru' ? v.step : (v.stepEn || v.step);
    const caveat = lang === 'ru' ? v.caveatRu : (v.caveatEn || v.caveatRu);
    const colour = (v.group && groupColor[v.group]) || 'transparent';

    // Постановки, в которые переменная допущена: у ORAS5 родной шаг
    // месячный, и в суточные она не попадает -- это результат, а не изъян,
    // поэтому значок стоит у всех, а не только у «неполных».
    const badges = [];
    if (v.inMonthly) badges.push('<i class="cat-b">' + i18n.t('unit.month') + '</i>');
    if (v.inDaily) badges.push('<i class="cat-b">' + i18n.t('unit.day') + '</i>');

    const meta = [units, agg, native && step && native !== step
      ? native + ' → ' + step : step].filter(Boolean).map(esc).join(' · ');

    return '<div class="cat-v' + (caveat ? ' has-note' : '') + '">' +
      '<div class="cat-head">' +
        '<i class="cat-sw" style="background:' + colour + '"></i>' +
        '<code>' + esc(v.key) + '</code>' +
        '<span class="cat-t">' + esc(title) + '</span>' +
        '<span class="cat-badges">' + badges.join('') + '</span>' +
      '</div>' +
      '<div class="cat-meta">' + meta +
        (v.group && v.group !== v.key
          ? ' · <span class="cat-g">' + esc(v.group) + '</span>' : '') +
        (v.derivedFrom ? ' · ' + i18n.t('catalog.derived') + ' ' +
          esc(v.derivedFrom) : '') +
      '</div>' +
      (caveat ? '<div class="cat-note">' + esc(caveat) + '</div>' : '') +
      '</div>';
  }

  function render() {
    const lang = i18n.getLang();
    const parts = ['<div class="cat-top">' +
      '<h2 data-i18n="catalog.title"></h2>' +
      '<button class="cat-close" data-i18n-title="catalog.close">×</button>' +
      '</div>' +
      '<p class="cat-sub">' + i18n.t('catalog.sub', {
        n: cat.vars.length,
        grid: esc((lang === 'ru' ? cat.grid : (cat.gridEn || cat.grid)) || ''),
      }) + '</p>'];

    for (const key of cat.sourceOrder) {
      const s = cat.sources[key];
      const vars = cat.vars.filter((v) => v.source === key);
      if (!vars.length) continue;
      const lic = lang === 'ru' ? s.licence : (s.licenceEn || s.licence);
      const nat = lang === 'ru' ? s.nativeStep : (s.nativeStepEn || s.nativeStep);
      parts.push('<div class="cat-src">' +
        '<h3>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" ' +
          'rel="noopener">' + esc(s.name) + '</a>' : esc(s.name)) + '</h3>' +
        '<p class="cat-srcmeta">' + esc(s.provider) +
          (lic ? ' · ' + esc(lic) : '') + '</p>' +
        '<p class="cat-srcmeta">' +
          esc((lang === 'ru' ? s.nativeGrid : (s.nativeGridEn || s.nativeGrid)) || '') +
          (nat ? ' · ' + esc(nat) : '') + '</p>' +
        '</div>');
      parts.push(vars.map(row).join(''));
    }

    parts.push('<p class="cat-foot">' + i18n.t('catalog.foot') + '</p>');
    panel.innerHTML = parts.join('');
    i18n.apply(panel);

    panel.querySelector('.cat-close').addEventListener('click', toggle);
    // Оговорка раскрывается щелчком по строке: она нужна не всем и не
    // всегда, но спрятать её в документацию значит потерять.
    panel.querySelectorAll('.cat-v.has-note .cat-head').forEach((h) => {
      h.addEventListener('click', () => h.parentNode.classList.toggle('open'));
    });
  }

  function toggle(open) {
    const show = typeof open === 'boolean' ? open : panel.hidden;
    if (show) render();
    panel.hidden = !show;
    button.classList.toggle('on', show);
  }

  button.addEventListener('click', () => toggle());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !panel.hidden) toggle(false);
  });
  // Перерисовка при смене языка -- только если панель открыта: закрытая
  // всё равно рендерится заново при показе.
  return { toggle, refresh: () => { if (!panel.hidden) render(); } };
}
