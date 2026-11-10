// Неизбыточный набор предикторов: «сколько их нужно в этой ячейке».
//
// Отличие от карты ведущего предиктора -- в вопросе, а не в оформлении.
// Лидер отвечает «кто сильнее в одиночку»; второй по силе обычно похож на
// первого, потому что они про одно явление. Жадный отбор на каждом шаге
// берёт того, кто добавляет НОВОЕ сверх уже взятого, поэтому в набор
// попадают другие переменные и в другом порядке.
//
// Порог в данные не зашит намеренно (ТЗ, раздел 3): в файле лежат прирост
// и его отношение к шуму, а сколько шагов проходит -- решает ползунок, и
// пересчёт идёт на клиенте за пару миллисекунд. Так строгость становится
// тем, чем она и является: параметром чтения карты, а не свойством данных.
//
// Считаются ПЕРВЫЕ ПОДРЯД прошедшие шаги. Если второй не прошёл, третий не
// учитывается, даже если формально выше порога: набор обрывается там, где
// обрывается прирост, а не там, где случайно нашлась ещё одна переменная.

import { DATA_GRID } from './config.js';

const NPX = DATA_GRID.size * DATA_GRID.size;

/**
 * Ступени шкалы «сколько нужно»: один тон от светлого к тёмному.
 *
 * Величина порядковая, поэтому шкала последовательная, а не радуга и не
 * расходящаяся: это счётчик, а не отклонение от нуля. Начало шкалы взято
 * заметно темнее кремовой суши -- иначе самая частая ступень (один
 * предиктор) сливалась бы с подложкой, и карта читалась бы как пустая.
 *
 * Ноль -- отдельная категория вне шкалы: серый, но темнее, чем заливка
 * «вне домена», чтобы «ничего не проходит» и «не считалось» различались.
 */
export const NEED_COLORS = [
  [168, 164, 155],   // 0 -- ни один предиктор не проходит порог
  [240, 200, 138],   // 1
  [224, 160, 86],    // 2
  [200, 118, 50],    // 3
  [166, 82, 33],     // 4
  [122, 52, 22],     // 5
  [74, 28, 14],      // 6
];

// Значения-метки в плоскости order: шага нет и оценки нет.
const NO_STEP = -1, NO_ESTIMATE = -2;

export async function loadSets(baseUrl) {
  const res = await fetch(baseUrl + 'sets.json');
  if (!res.ok) throw new Error('sets.json: ' + res.status);
  const meta = await res.json();
  // Ступеней в шкале должно хватать на всю глубину отбора. Не хватит --
  // ячейка останется без цвета и не нарисуется вовсе, а выглядеть это будет
  // как дыра в данных, а не как отсутствующая краска.
  const deepest = Math.max(...Object.values(meta.cells).map((c) => c.depth));
  if (deepest >= NEED_COLORS.length) {
    throw new Error('глубина отбора ' + deepest + ', а ступеней в шкале '
                    + NEED_COLORS.length + ' -- дополните NEED_COLORS');
  }
  return { baseUrl, meta, cache: new Map(), domains: new Map() };
}

/** Карта «позиция в сетке -> позиция в векторе значений», одна на домен. */
export async function domainIndex(S, domain) {
  if (S.domains.has(domain)) return S.domains.get(domain);
  const d = S.meta.domains[domain];
  const buf = await fetch(S.baseUrl + d.file).then((r) => r.arrayBuffer());
  const idx = new Uint16Array(buf);
  S.domains.set(domain, idx);
  return idx;
}

/** Клетка (постановка + горизонт) со всеми плоскостями, с кэшем. */
export async function cellLayer(S, setupKey, lag) {
  const id = setupKey + '/' + lag;
  if (S.cache.has(id)) return S.cache.get(id);
  const c = S.meta.cells[id];
  if (!c) return null;

  const [buf, index] = await Promise.all([
    fetch(S.baseUrl + c.file).then((r) => {
      if (!r.ok) throw new Error(c.file + ': ' + r.status);
      return r.arrayBuffer();
    }),
    domainIndex(S, c.domain),
  ]);
  const n = c.n, depth = c.depth;
  if (buf.byteLength !== c.bytes) {
    throw new Error('размер ' + c.file + ': ' + buf.byteLength
                    + ' вместо ' + c.bytes);
  }
  // Смещения берутся из манифеста: плоскость order выровнена там до
  // кратности четырём, потому что depth*N бывает нечётным, а Uint16Array
  // требует чётного смещения.
  const layer = {
    meta: c, index,
    order: new Int8Array(buf, c.offsets.order, depth * n),
    gain: new Uint16Array(buf, c.offsets.gain, depth * n),
    ratio: new Uint16Array(buf, c.offsets.ratio, depth * n),
    // Сколько шагов реально оценено в каждой ячейке: последний шаг считали
    // не во всех, и без этого числа «-1» в его строке неотличимо от
    // «прироста нет».
    cdepth: new Uint8Array(buf, c.offsets.cdepth, n),
    // Информация о будущем льде в его собственной истории. Есть только у
    // суточных клеток -- у месячных её не считали, и там подсказка остаётся
    // без процентов, а не делит на выдуманный знаменатель.
    hIce: c.offsets.hIce === null || c.offsets.hIce === undefined
      ? null : new Uint16Array(buf, c.offsets.hIce, n),
    // Информация самой календарной даты. Есть только у постановки U':
    // там она вычтена из вкладов предикторов и потому является отдельным
    // слагаемым. В постановке U она тоже посчитана, но не вычтена --
    // показывать её там значило бы учесть одно и то же дважды.
    cal: c.offsets.cal === null || c.offsets.cal === undefined
      ? null : new Uint16Array(buf, c.offsets.cal, n),
  };
  S.cache.set(id, layer);
  return layer;
}

const at = (layer, step, i) => step * layer.meta.n + i;
const hIceOf = (layer, i) =>
  layer.hIce[i] * layer.meta.hIceScale + layer.meta.hIceOffset;
const calOf = (layer, i) =>
  layer.cal[i] * layer.meta.calScale + layer.meta.calOffset;
const positive = (v) => (v > 0 ? v : 0);

/**
 * Потолок качества модели по накопленной информации.
 *
 * I нат взаимной информации ограничивают любую модель сверху: R^2 не может
 * превысить 1 - exp(-2I). Каждый нат режет среднеквадратичную ошибку втрое.
 * Это замена процентам вклада: доли законны, только если слагаемые
 * складываются в целое, а цепное правило здесь выполняется приближённо --
 * у трёхчастного разложения с календарём невязка доходит до 45 %.
 */
export const r2max = (nats) => 1 - Math.exp(-2 * nats);

/**
 * Вся известная информация о будущем льде в ячейке, наты.
 *
 * По цепному правилу взаимной информации это история самого льда плюс
 * приросты всех шагов, поэтому доли от этой суммы складываются в сто.
 * Суммируются ТОЛЬКО положительные вклады и только по реально оценённым
 * шагам: отрицательное значение -- шум оценщика, а шаг за пределами
 * computed_depth не считался вовсе, и брать оттуда число нельзя.
 *
 * Правило «только положительные» распространено и на историю льда: в 1.5 %
 * месячных и 1.9 % суточных ячеек она оценивается отрицательной, и без
 * этого подсказка показывала бы «лёд сам -- -30 %», что не означает
 * ничего. Наты при этом показываются как измерены -- молча править число
 * нельзя, а доля в таких ячейках честно нулевая.
 */
function totalInfo(layer, i) {
  if (!layer.hIce) return null;
  let total = positive(hIceOf(layer, i));
  if (layer.cal) total += positive(calOf(layer, i));
  const lim = Math.min(layer.meta.depth, layer.cdepth[i]);
  for (let step = 0; step < lim; step++) {
    if (layer.order[at(layer, step, i)] === NO_STEP) break;
    total += positive(gainOf(layer, step, i));
  }
  return total > 0 ? total : null;
}
const gainOf = (layer, step, i) =>
  layer.gain[at(layer, step, i)] * layer.meta.gainScale + layer.meta.gainOffset;
const ratioOf = (layer, step, i) =>
  layer.ratio[at(layer, step, i)] * layer.meta.ratioScale + layer.meta.ratioOffset;

/**
 * Сколько предикторов нужно в каждой ячейке сетки при пороге k.
 *
 * Возвращает две сетки 432x432. `grid` -- категории: 0..depth -- ответ,
 * catNoEstimate -- оценивать было нечего (p = NaN, метка -2 в order),
 * catOutside -- ячейка вне домена постановки, catNodata -- вне расчётной
 * области вообще. `capped` -- ячейки, где порог прошли ВСЕ оценённые шаги:
 * там ответ «столько и более», а не «столько».
 *
 * Ноль и «нет оценки» -- разные ответы, и путать их нельзя: ноль означает,
 * что порога не проходит даже лидер (таких больше всего в сезон таяния), а
 * «нет оценки» -- что данных в ячейке не хватило на сам отбор.
 *
 * Потолок теперь у каждой ячейки свой: шестой шаг считали только там, где
 * набор упирался в потолок на пятом. Поэтому «и более» -- свойство ячейки,
 * а не всей строки легенды: в строке «5» соседствуют ячейки, где шестой шаг
 * не прошёл порог, и ячейки, где его не считали.
 */
export function neededGrid(layer, k, ocean, catOutside, catNodata,
                           catNoEstimate) {
  const out = new Uint8Array(NPX).fill(catNodata);
  const capped = new Uint8Array(NPX);
  const { index, meta } = layer;
  const depth = meta.depth;
  for (let g = 0; g < NPX; g++) {
    const i = index[g];
    if (i === 65535) {
      // Ячейка расчётной области, но не этой постановки: у суточных это
      // центральный бассейн. Серая заливка честнее прозрачной дыры.
      if (ocean && ocean[g] !== 65535) out[g] = catOutside;
      continue;
    }
    if (layer.order[at(layer, 0, i)] === NO_ESTIMATE) {
      out[g] = catNoEstimate;
      continue;
    }
    const lim = Math.min(depth, layer.cdepth[i]);
    let n = 0;
    for (let step = 0; step < lim; step++) {
      const j = at(layer, step, i);
      if (layer.order[j] === NO_STEP) break;
      if (!(layer.ratio[j] * meta.ratioScale + meta.ratioOffset > k)) break;
      n++;
    }
    out[g] = n;
    if (lim > 0 && n === lim) capped[g] = 1;
  }
  return { grid: out, capped };
}

/** Шаги отбора в одной ячейке -- для подсказки под курсором. */
export function stepsAt(layer, gridPos, k) {
  const i = layer.index[gridPos];
  if (i === 65535) return null;
  if (layer.order[at(layer, 0, i)] === NO_ESTIMATE) return 'noestimate';
  const rows = [];
  let broken = false;
  const lim = Math.min(layer.meta.depth, layer.cdepth[i]);
  const total = totalInfo(layer, i);
  // Потолок R^2 накапливается по мере добавления шагов -- он и показывает,
  // что даёт каждый следующий предиктор сверх уже набранного.
  let acc = layer.hIce ? positive(hIceOf(layer, i)) : 0;
  const ice = layer.hIce
    ? { nats: hIceOf(layer, i), r2: r2max(acc) } : null;
  let date = null;
  if (layer.cal) {
    acc += positive(calOf(layer, i));
    date = { nats: calOf(layer, i), r2: r2max(acc) };
  }
  for (let step = 0; step < lim; step++) {
    const j = at(layer, step, i);
    if (layer.order[j] === NO_STEP) break;
    const ratio = ratioOf(layer, step, i);
    const passed = !broken && ratio > k;
    if (!passed) broken = true;
    const gain = gainOf(layer, step, i);
    acc += positive(gain);
    rows.push({
      name: layer.meta.names[layer.order[j]],
      gain, ratio, passed,
      r2: layer.hIce ? r2max(acc) : null,
    });
    // Показываем первый непрошедший шаг и обрываемся: он объясняет, почему
    // набор такой длины, а дальнейшие шаги уже ничего не добавляют к ответу.
    if (!passed) break;
  }
  // `computed` нужен подписи: «дальше не считали» и «дальше не добавляет» --
  // разные утверждения, и выбор между ними зависит от этой ячейки.
  return { rows, computed: lim, ice, date };
}

/**
 * Из каких именно предикторов состоят наборы -- в разрезе их длины.
 *
 * Число «двух предикторов хватает в 17 % ячеек» не говорит, каких именно;
 * под курсором состав виден, но по одной ячейке, а спрашивают про море или
 * полигон целиком.
 *
 * Наборы, отличающиеся только ПОРЯДКОМ, объединяются. Порядок в жадном
 * отборе содержателен для одной ячейки (первым идёт сильнейший в одиночку),
 * но при агрегировании он расщепляет одну и ту же пару на две строки: в
 * Карском море `sst+ssrd` и `ssrd+sst` набирали 9 % и 8 % и занимали третье
 * и четвёртое места, тогда как вместе это 17 % и первое. Подписывается
 * объединённый набор тем порядком, который в нём преобладает, -- так
 * сохраняется и сумма, и указание на более сильный предиктор.
 *
 * Возвращает счётчики, а не доли: знаменатель выбирает вызывающий код.
 * Здесь это было источником путаницы -- доля внутри группы стояла рядом с
 * долей от области, и числа не сходились на глаз.
 */
export function setBreakdown(layer, grid, depth, inside, topN = 3) {
  const { index, meta } = layer;
  // На каждую длину: ключ неупорядоченного набора -> {всего, варианты}.
  const maps = [];
  for (let n = 0; n <= depth; n++) maps.push(new Map());

  const buf = new Int32Array(depth);
  for (let g = 0; g < NPX; g++) {
    const n = grid[g];
    if (n < 1 || n > depth) continue;
    if (inside && !inside(g)) continue;
    const i = index[g];
    if (i === 65535) continue;

    let ordered = 0;
    for (let step = 0; step < n; step++) {
      const v = layer.order[at(layer, step, i)] + 1;
      buf[step] = v;
      ordered = ordered * 32 + v;
    }
    // Ключ набора -- те же индексы, но отсортированные: он и объединяет
    // варианты, различающиеся только порядком.
    const sorted = buf.slice(0, n).sort();
    let key = 0;
    for (let step = 0; step < n; step++) key = key * 32 + sorted[step];

    const m = maps[n];
    let rec = m.get(key);
    if (!rec) { rec = { total: 0, variants: new Map() }; m.set(key, rec); }
    rec.total++;
    rec.variants.set(ordered, (rec.variants.get(ordered) || 0) + 1);
  }

  const decode = (key, n) => {
    const names = [];
    let k = key;
    for (let step = 0; step < n; step++) {
      names.unshift(meta.names[(k % 32) - 1]);
      k = Math.floor(k / 32);
    }
    return names;
  };

  return maps.map((m, n) => {
    if (!n || !m.size) return null;
    let groupTotal = 0;
    for (const rec of m.values()) groupTotal += rec.total;
    const top = [...m.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, topN)
      .map((rec) => {
        // Подпись -- по самому частому порядку внутри объединённого набора.
        let bestKey = 0, bestCount = -1;
        for (const [k, c] of rec.variants) {
          if (c > bestCount) { bestCount = c; bestKey = k; }
        }
        return { names: decode(bestKey, n), count: rec.total };
      });
    const shown = top.reduce((a, b) => a + b.count, 0);
    return { top, groupTotal, other: groupTotal - shown };
  });
}

/**
 * Рекомендованный набор каналов для модели по выбранной области.
 *
 * Это не пересказ карты, а воспроизведение отбора из абляции
 * (`analysis/report_set_thresholds.py`, проверено на 245 обучениях в
 * Карском море). Правило целиком:
 *
 *   1. мера -- U', добавка сверх истории льда И календаря: предиктор,
 *      который держится на сезонном ходе, модели не нужен, она знает дату
 *      и так;
 *   2. в каждой ячейке -- свой неизбыточный набор: первые ПОДРЯД шаги
 *      жадного отбора, прошедшие порог k*sigma (ползунок строгости);
 *   3. набор ячейки -- ОБЪЕДИНЕНИЕ по сезонам. Выборка сезонно-слепая:
 *      модель видит ячейку круглый год и переключать каналы по времени
 *      года не может, значит ей нужно всё, что ячейка требует хоть в
 *      каком сезоне. Критерий по парам (ячейка, сезон) слабее -- в
 *      абляции он давал 2 канала вместо 6 на горизонте 7 суток, и с теми
 *      списками предикторы УХУДШАЛИ кромку;
 *   4. ячейка покрыта, когда ВЕСЬ её объединённый набор внутри выбранных:
 *      предикторы в неизбыточном наборе друг друга не заменяют;
 *   5. переменные добавляются в порядке убывания числа ячеек, которым они
 *      нужны, пока покрытие не достигнет порога (по умолчанию 90 %).
 *
 * `layers` -- клетки одного горизонта по всем сезонам.
 */
export function recommendSet(layers, k, inside, threshold = 0.9) {
  const live = layers.filter(Boolean);
  if (!live.length) return null;

  // Общий словарь имён: у клеток свои массивы names, и склеивать наборы
  // можно только по именам, а не по индексам.
  const bitOf = new Map();
  for (const L of live) {
    for (const n of L.meta.names) if (!bitOf.has(n)) bitOf.set(n, bitOf.size);
  }
  if (bitOf.size > 30) return null;        // маски держим в int32

  const masks = new Int32Array(NPX);
  const seen = new Uint8Array(NPX);
  for (const L of live) {
    const bits = L.meta.names.map((n) => 1 << bitOf.get(n));
    const depth = L.meta.depth;
    for (let g = 0; g < NPX; g++) {
      const i = L.index[g];
      if (i === 65535) continue;
      if (inside && !inside(g)) continue;
      if (L.order[at(L, 0, i)] === NO_ESTIMATE) continue;
      seen[g] = 1;
      const lim = Math.min(depth, L.cdepth[i]);
      for (let step = 0; step < lim; step++) {
        const j = at(L, step, i);
        const v = L.order[j];
        if (v === NO_STEP) break;
        if (!(L.ratio[j] * L.meta.ratioScale + L.meta.ratioOffset > k)) break;
        masks[g] |= bits[v];
      }
    }
  }

  const cells = [];
  for (let g = 0; g < NPX; g++) if (seen[g]) cells.push(masks[g]);
  if (!cells.length) return null;

  const names = [...bitOf.keys()];
  const count = names.map((_, v) => {
    let c = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] & (1 << v)) c++;
    return c;
  });
  const rank = names.map((_, v) => v).filter((v) => count[v] > 0)
    .sort((a, b) => count[b] - count[a]);

  let chosen = 0;
  const picked = [];
  let cov = 0;
  for (const v of rank) {
    chosen |= 1 << v;
    picked.push(names[v]);
    let ok = 0;
    for (let i = 0; i < cells.length; i++) if ((cells[i] & ~chosen) === 0) ok++;
    cov = ok / cells.length;
    if (cov >= threshold - 1e-9) break;
  }
  return { names: picked, coverage: cov, cells: cells.length };
}

/**
 * Доли ячеек по числу нужных предикторов -- для легенды.
 *
 * Ячейки без оценки считаются отдельно и входят в знаменатель: иначе строки
 * легенды в сумме дадут больше ста процентов, а выпавшие ячейки останутся
 * серыми на карте без всякого объяснения.
 */
export function needShares(grid, depth, inside, catNoEstimate, capped) {
  const counts = new Array(depth + 1).fill(0);
  let noEst = 0;
  let nCapped = 0;
  let total = 0;
  for (let g = 0; g < NPX; g++) {
    const v = grid[g];
    if (inside && !inside(g)) continue;
    if (v === catNoEstimate) { noEst++; total++; continue; }
    if (v > depth) continue;              // служебные категории
    counts[v]++;
    if (capped && capped[g]) nCapped++;
    total++;
  }
  return { counts, noEst, capped: nCapped, total };
}
