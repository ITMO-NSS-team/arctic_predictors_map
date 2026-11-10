// Загрузка подложки и предварительное проецирование.
//
// Геометрия проецируется ровно один раз -- при загрузке, в неповёрнутые
// координаты плоскости. Дальше отрисовка тайла и поворот карты сводятся к
// аффинному преобразованию уже готовых чисел: четыре умножения на точку.
// Это то, что позволяет вращать карту без пересчёта проекции.
//
// Для отсечения невидимого у каждого объекта считается описывающая
// ОКРУЖНОСТЬ, а не прямоугольник: при повороте плоскости окружность
// переходит в окружность того же радиуса, достаточно повернуть центр.
// С прямоугольником пришлось бы поворачивать все четыре угла.

import { MIN_LAT, DATA_PROJ, DATA_GRID } from './config.js';

const ARCTIC_CIRCLE_LAT = 66.5634;

function projectFlat(crs, flat) {
  const n = flat.length / 2;
  const out = new Float64Array(flat.length);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, y] = crs.forwardRaw(flat[2 * i], flat[2 * i + 1]);
    out[2 * i] = x;
    out[2 * i + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { pts: out, cx, cy, rad: Math.hypot(maxX - cx, maxY - cy) };
}

/**
 * То же, но исходные координаты -- метры EASE2, а не широты/долготы.
 * В этом виде приходят границы морей: обратной LAEA в питоновском экспорте
 * нет, а здесь proj4 уже загружен (см. tools/export_predictor_maps.py).
 */
function projectFlatEase(crs, flat, toWgs) {
  const lonlat = new Float64Array(flat.length);
  for (let i = 0; i < flat.length / 2; i++) {
    const [lon, lat] = toWgs.forward([flat[2 * i], flat[2 * i + 1]]);
    lonlat[2 * i] = lon;
    lonlat[2 * i + 1] = lat;
  }
  return projectFlat(crs, lonlat);
}

function projectFeatures(crs, features) {
  return features.map((f) => {
    const rings = f.g.map((g) => projectFlat(crs, g));
    let cx = 0, cy = 0, rad = 0;
    if (rings.length === 1) {
      ({ cx, cy, rad } = rings[0]);
    } else {
      // Описывающая окружность объекта из нескольких колец: грубая оценка
      // через объединение -- нам она нужна только для отбраковки.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of rings) {
        minX = Math.min(minX, r.cx - r.rad);
        maxX = Math.max(maxX, r.cx + r.rad);
        minY = Math.min(minY, r.cy - r.rad);
        maxY = Math.max(maxY, r.cy + r.rad);
      }
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
      rad = Math.hypot(maxX - cx, maxY - cy);
    }
    return { a: f.a || {}, rings, cx, cy, rad };
  });
}

async function loadLayer(crs, baseUrl, name) {
  const res = await fetch(baseUrl + name + '.json');
  if (!res.ok) throw new Error('не читается слой ' + name + ': ' + res.status);
  const raw = await res.json();
  return { kind: raw.kind, features: projectFeatures(crs, raw.features) };
}

/** Меридианы, параллели, полярный круг и обрез карты -- строятся, не качаются. */
function buildGraticule(crs) {
  const meridians = [];
  for (let lon = -180; lon < 180; lon += 15) {
    const flat = [];
    for (let lat = MIN_LAT; lat <= 90.0001; lat += 0.5) flat.push(lon, Math.min(lat, 90));
    meridians.push({ g: [flat], a: { lon } });
  }
  const parallels = [];
  for (const lat of [20, 30, 40, 50, 60, 70, 80]) {
    const flat = [];
    for (let lon = -180; lon <= 180.0001; lon += 2) flat.push(lon, lat);
    parallels.push({ g: [flat], a: { lat } });
  }
  const circle = [];
  for (let lon = -180; lon <= 180.0001; lon += 2) circle.push(lon, ARCTIC_CIRCLE_LAT);

  return {
    meridians: { kind: 'line', features: projectFeatures(crs, meridians) },
    parallels: { kind: 'line', features: projectFeatures(crs, parallels) },
    arcticCircle: { kind: 'line', features: projectFeatures(crs, [{ g: [circle] }]) },
  };
}

/** Контур расчётной сетки EASE2 432x432 -- граница области, где есть данные. */
function buildGridDomain(crs) {
  const inv = proj4(DATA_PROJ, 'WGS84');
  const h = DATA_GRID.halfExtent;
  const steps = 60;
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  const flat = [];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[(c + 1) % 4];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const [lon, lat] = inv.forward([ax + (bx - ax) * t, ay + (by - ay) * t]);
      flat.push(lon, lat);
    }
  }
  const [lon0, lat0] = inv.forward(corners[0]);
  flat.push(lon0, lat0);
  return { kind: 'line', features: projectFeatures(crs, [{ g: [flat] }]) };
}

/** Границы морей: формат тот же, но координаты в метрах EASE2. */
async function loadRegions(crs, baseUrl) {
  const res = await fetch(baseUrl + 'regions.json');
  if (!res.ok) return null;
  const raw = await res.json();
  const toWgs = proj4(DATA_PROJ, 'WGS84');
  const features = raw.features.map((f) => {
    const rings = f.g.map((g) => projectFlatEase(crs, g, toWgs));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) {
      minX = Math.min(minX, r.cx - r.rad);
      maxX = Math.max(maxX, r.cx + r.rad);
      minY = Math.min(minY, r.cy - r.rad);
      maxY = Math.max(maxY, r.cy + r.rad);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { a: f.a, rings, cx, cy, rad: Math.hypot(maxX - cx, maxY - cy) };
  });
  // Ключ -> объект: заливка региона цветом лидера ищет по ключу.
  const byKey = {};
  for (const f of features) byKey[f.a.key] = f;
  return { kind: 'polygon', features, byKey };
}

export async function loadBasemap(crs, baseUrl) {
  const manifest = await fetch(baseUrl + 'manifest.json').then((r) => r.json());

  const names = ['land', 'lakes', 'rivers', 'borders'];
  const bathyNames = (manifest.bathymetry || []).map((d) => 'bathy_' + d);

  const loaded = await Promise.all(
    [...bathyNames, ...names].map((n) => loadLayer(crs, baseUrl, n)));

  const layers = {};
  [...bathyNames, ...names].forEach((n, i) => { layers[n] = loaded[i]; });

  // Уровни батиметрии в порядке возрастания глубины: рисуются один поверх
  // другого, каждый следующий темнее.
  layers.bathymetry = (manifest.bathymetry || []).map((d, i) => ({
    depth: d, level: i + 1, data: layers['bathy_' + d],
  }));

  Object.assign(layers, buildGraticule(crs));
  layers.gridDomain = buildGridDomain(crs);

  const [labels, regions] = await Promise.all([
    fetch(baseUrl + 'labels.json').then((r) => r.json()),
    loadRegions(crs, baseUrl).catch(() => null),
  ]);
  layers.regions = regions;

  return { manifest, layers, labels, regions };
}
