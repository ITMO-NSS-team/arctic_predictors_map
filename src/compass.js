// Компас: вращение карты вокруг полюса.
//
// На полярной карте «север» -- это центр, а не направление, поэтому обычная
// стрелка бессмысленна. Вращение задаётся тем, какой МЕРИДИАН смотрит вверх,
// и компас показывает именно это: кольцо с меридианами, которое крутится
// вместе с картой.
//
// Геометрия. При повороте плоскости на alpha меридиан m оказывается под углом
// (180 - m - alpha) по часовой от верха экрана, а так как alpha = 180 - lonUp
// (см. crs.js), угол сводится к (lonUp - m). То есть достаточно нарисовать
// метки на фиксированных углах -m и повернуть всё кольцо на lonUp.

import { apply as applyI18n } from './i18n.js';

const TICKS = [];
for (let m = -180; m < 180; m += 30) TICKS.push(m);

function label(m) {
  if (m === 0) return '0°';
  if (m === 180 || m === -180) return '180°';
  return Math.abs(m) + (m > 0 ? 'E' : 'W');
}

function buildSvg() {
  const r = 34, rl = 25;
  const parts = [
    '<circle class="cp-face" cx="0" cy="0" r="' + r + '"/>',
    '<g class="cp-ring">',
  ];
  for (const m of TICKS) {
    const a = -m * Math.PI / 180;           // угол по часовой от верха
    const sx = Math.sin(a), cy = -Math.cos(a);
    const major = m % 90 === 0;
    parts.push('<line class="cp-tick' + (major ? ' cp-major' : '') + '" x1="' +
      (sx * r).toFixed(2) + '" y1="' + (cy * r).toFixed(2) + '" x2="' +
      (sx * (r - (major ? 7 : 4))).toFixed(2) + '" y2="' +
      (cy * (r - (major ? 7 : 4))).toFixed(2) + '"/>');
    if (major) {
      // Подпись едет вместе с кольцом, но читаться должна горизонтально,
      // поэтому в render() ей добавляется обратный поворот вокруг себя.
      parts.push('<text class="cp-lab" data-x="' + (sx * rl).toFixed(2) +
        '" data-y="' + (cy * rl).toFixed(2) +
        '" x="' + (sx * rl).toFixed(2) + '" y="' +
        (cy * rl + 3.2).toFixed(2) + '">' + label(m) + '</text>');
    }
  }
  parts.push('</g>');
  // Неподвижная метка верха экрана.
  parts.push('<path class="cp-up" d="M 0 -' + (r + 9) + ' l 5 8 l -10 0 z"/>');
  parts.push('<circle class="cp-hub" cx="0" cy="0" r="2.6"/>');
  return '<svg viewBox="-48 -48 96 96" width="96" height="96">' + parts.join('') + '</svg>';
}

/**
 * @param {L.Map} map
 * @param {object} crs      наш вращаемый CRS
 * @param {function} onChange  (lonUp, dragging) -> void
 */
export function createCompass(map, crs, onChange) {
  const Control = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = L.DomUtil.create('div', 'compass');
      box.innerHTML =
        '<div class="cp-dial">' + buildSvg() + '</div>' +
        '<div class="cp-read"><span class="cp-val"></span>' +
        '<span class="cp-cap" data-i18n="compass.up"></span></div>' +
        '<div class="cp-presets">' +
        '<button data-lon="180" data-i18n-title="compass.preset.180">180°</button>' +
        '<button data-lon="0" data-i18n-title="compass.preset.0">0°</button>' +
        '<button data-lon="90" data-i18n-title="compass.preset.90">90E</button>' +
        '<button data-lon="-90" data-i18n-title="compass.preset.-90">90W</button>' +
        '</div>';
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      // disableClickPropagation ловит mousedown/touchstart, но не pointerdown:
      // без этого карта уедет вместе с кольцом.
      L.DomEvent.on(box, 'pointerdown', L.DomEvent.stopPropagation);
      applyI18n(box);
      this._box = box;
      return box;
    },
  });

  const ctl = new Control();
  map.addControl(ctl);

  const box = ctl._box;
  const dial = box.querySelector('.cp-dial');
  const ring = box.querySelector('.cp-ring');
  const val = box.querySelector('.cp-val');

  // Текущий угол компас держит у себя, а не спрашивает у CRS: применение
  // поворота к карте отложено на кадр анимации, и чтение из CRS во время
  // перетаскивания возвращало бы значение предыдущего кадра.
  let cur = crs.getLonUp();

  const texts = Array.prototype.slice.call(ring.querySelectorAll('.cp-lab'));

  function render() {
    ring.setAttribute('transform', 'rotate(' + cur.toFixed(2) + ')');
    for (const t of texts) {
      t.setAttribute('transform', 'rotate(' + (-cur).toFixed(2) + ',' +
        t.dataset.x + ',' + t.dataset.y + ')');
    }
    val.textContent = label(Math.round(cur * 10) / 10);
  }

  // CRS меняет вызывающая сторона, а не компас: положение центра карты надо
  // снять ДО поворота, иначе центр «уедет» вместе с плоскостью.
  function apply(lonUp, dragging) {
    cur = ((lonUp % 360) + 540) % 360 - 180;
    onChange(cur, dragging);
    render();
  }

  // --- перетаскивание кольца ---
  let grabbed = null;
  const angleAt = (ev) => {
    const b = dial.getBoundingClientRect();
    const px = ev.clientX - (b.left + b.width / 2);
    const py = ev.clientY - (b.top + b.height / 2);
    return Math.atan2(px, -py) * 180 / Math.PI;    // по часовой от верха
  };

  dial.addEventListener('pointerdown', (ev) => {
    dial.setPointerCapture(ev.pointerId);
    grabbed = cur - angleAt(ev);                   // меридиан под курсором
    dial.classList.add('cp-dragging');
    ev.preventDefault();
  });
  dial.addEventListener('pointermove', (ev) => {
    if (grabbed === null) return;
    apply(angleAt(ev) + grabbed, true);
  });
  const release = (ev) => {
    if (grabbed === null) return;
    grabbed = null;
    dial.classList.remove('cp-dragging');
    apply(cur, false);
    if (ev && ev.pointerId !== undefined && dial.hasPointerCapture(ev.pointerId)) {
      dial.releasePointerCapture(ev.pointerId);
    }
  };
  dial.addEventListener('pointerup', release);
  dial.addEventListener('pointercancel', release);

  // Двойной щелчок по кольцу -- к ближайшим 15 градусам: удобно, когда
  // нужен «ровный» разворот для рисунка в статью.
  dial.addEventListener('dblclick', () => {
    apply(Math.round(cur / 15) * 15, false);
  });

  box.querySelectorAll('.cp-presets button').forEach((b) => {
    b.addEventListener('click', () => apply(parseFloat(b.dataset.lon), false));
  });

  // Клавиши [ и ] -- шаг 15 градусов.
  document.addEventListener('keydown', (ev) => {
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.key === '[') apply(cur + 15, false);
    else if (ev.key === ']') apply(cur - 15, false);
  });

  render();
  return { render, apply };
}
