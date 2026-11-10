// Вращаемая полярная CRS для Leaflet.
//
// Почему вращение сделано внутри проекции, а не поворотом контейнера
// -----------------------------------------------------------------
// Обычный приём "повернуть карту" -- CSS-трансформация на панели Leaflet.
// Он ломает две вещи: обработку мыши (Leaflet считает координаты по
// неповёрнутой системе) и подписи (они поворачиваются вместе с картой, их
// приходится контр-вращать по одной).
//
// У азимутальной проекции с центром в полюсе есть свойство, которого нет у
// Меркатора: поворот вокруг полюса -- это в точности смена центрального
// меридиана, то есть жёсткое вращение плоскости проекции. Поэтому вращение
// можно вложить прямо в project/unproject. Тогда для Leaflet карта остаётся
// обычной неповёрнутой картой: перетаскивание, зум и координаты курсора
// работают штатно, а подписи в DOM остаются горизонтальными сами собой --
// контр-вращать нечего.
//
// Цена -- перерисовка тайлов при смене угла. Тайлы у нас векторные и
// рисуются из предпроецированной геометрии, так что это дёшево.

import { TILE } from './config.js';

/**
 * @param {string} projDef  строка proj4 для проекции отображения
 * @param {number} minLat   широта обрезки; задаёт радиус мира
 */
export function makeArcticCRS(projDef, minLat) {
  const tr = proj4('WGS84', projDef);

  // Радиус мира: расстояние от полюса до параллели обрезки. Всё, что мы
  // рисуем, лежит внутри этого круга, и при вращении круг переходит в себя --
  // поэтому границы CRS от угла не зависят.
  const [rx, ry] = tr.forward([0, minLat]);
  const R = Math.hypot(rx, ry);

  let angle = 0;          // угол поворота плоскости, градусы, против часовой
  let cosA = 1, sinA = 0;

  const projection = {
    bounds: L.bounds([-R, -R], [R, R]),

    project(latlng) {
      const [x, y] = tr.forward([latlng.lng, latlng.lat]);
      return new L.Point(x * cosA - y * sinA, x * sinA + y * cosA);
    },

    unproject(point) {
      const x = point.x * cosA + point.y * sinA;
      const y = -point.x * sinA + point.y * cosA;
      const [lng, lat] = tr.inverse([x, y]);
      return new L.LatLng(lat, lng);
    },
  };

  const crs = L.extend({}, L.CRS, {
    code: 'ARCTIC:STERE',
    projection,
    // Плоскость в метрах -> единичный квадрат [0, 2R], дальше домножается
    // на scale(z). Знак -1 по y: в метрах y растёт вверх, в пикселях вниз.
    transformation: new L.Transformation(1, R, -1, R),
    scale: (z) => TILE * Math.pow(2, z) / (2 * R),
    zoom: (s) => Math.log(s * 2 * R / TILE) / Math.LN2,
    infinite: false,
    distance: L.CRS.Earth.distance,
    R: L.CRS.Earth.R,
  });

  /** Радиус мира в метрах проекции. */
  crs.radius = R;

  /** Проекция без учёта поворота -- для предварительного проецирования данных. */
  crs.forwardRaw = (lon, lat) => tr.forward([lon, lat]);
  crs.inverseRaw = (x, y) => tr.inverse([x, y]);

  crs.setAngle = (deg) => {
    angle = ((deg % 360) + 360) % 360;
    const a = angle * Math.PI / 180;
    cosA = Math.cos(a);
    sinA = Math.sin(a);
  };
  crs.getAngle = () => angle;

  // Пользователю удобнее думать не про угол поворота, а про то, какой
  // меридиан смотрит вверх. Связь: при нулевом повороте вверху 180 в.д.
  // (у полярной стереографической y = -rho*cos(lambda), см. Snyder).
  crs.setLonUp = (lon) => crs.setAngle(180 - lon);
  crs.getLonUp = () => {
    const lon = ((180 - angle) % 360 + 540) % 360 - 180;
    return lon;
  };

  crs.setLonUp(180);
  return crs;
}

/**
 * Зум, при котором в окно вписывается круг до широты `lat`.
 * Нужен и для стартового вида, и для нижней границы зума.
 */
export function zoomForLat(crs, lat, viewportPx) {
  const [x, y] = crs.forwardRaw(0, lat);
  const r = Math.hypot(x, y);
  return Math.log2(viewportPx * crs.radius / (TILE * r));
}
