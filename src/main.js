// Сборка приложения.

import { MIN_LAT, INITIAL_LAT, INITIAL_LON_UP, TILE, DISPLAY_PROJ, DATA_URL,
         LAYERS_URL } from './config.js';
import { makeArcticCRS, zoomForLat } from './crs.js';
import { loadBasemap } from './geodata.js';
import { arcticBasemap } from './basemap.js';
import { arcticLabels } from './labels.js';
import { arcticField, COLORMAPS } from './field.js';
import { createCompass } from './compass.js';
import { loadPredictors, lagLayer, regionPaint, probe, seasonsOf, lagsOf,
         cellAt } from './predictors.js';
import { loadCatalog, createCatalog } from './catalog.js';
import { createScope } from './scope.js';
import { loadSets, cellLayer, domainIndex, neededGrid, stepsAt, needShares,
         recommendSet,
         setBreakdown, NEED_COLORS } from './sets.js';
import * as i18n from './i18n.js';

// Состояние вида в адресной строке: ссылка на конкретный разворот, охват и
// слой -- то, чем в сервисе обмениваются («посмотри на Карское море при 90E
// вверху, горизонт 6 месяцев»).
const url = new URLSearchParams(location.search);
const num = (key, def) => {
  const v = parseFloat(url.get(key));
  return Number.isFinite(v) ? v : def;
};

i18n.setLang(i18n.initialLang(url));

const crs = makeArcticCRS(DISPLAY_PROJ, MIN_LAT);
crs.setLonUp(num('up', INITIAL_LON_UP));

const viewport = () => Math.min(window.innerWidth, window.innerHeight);

const map = L.map('map', {
  crs,
  center: [num('lat', 90), num('lon', 0)],
  zoom: num('z', zoomForLat(crs, INITIAL_LAT, viewport())),
  minZoom: zoomForLat(crs, MIN_LAT, viewport()),
  maxZoom: 8,
  zoomSnap: 0,
  zoomDelta: 0.4,
  wheelPxPerZoomLevel: 110,
  zoomControl: false,
  attributionControl: true,
  worldCopyJump: false,
  inertia: true,
});
map.attributionControl.setPrefix('');
let attribText = null;
function refreshAttribution() {
  if (attribText) map.attributionControl.removeAttribution(attribText);
  attribText = i18n.t('attrib');
  map.attributionControl.addAttribution(attribText);
}
refreshAttribution();
L.control.zoom({ position: 'topright' }).addTo(map);

// Штамп сборки на карте не показывается: подпись под картой -- про источник
// подложки, а не про версию сервиса. Версию по-прежнему кладёт deploy.sh в
// build.json, и она доступна в консоли -- `arctic.build`.
const buildInfo = fetch('build.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

/**
 * Удержание охвата: окно не должно выходить за обрез карты.
 *
 * Требование строже, чем «центр внутри круга»: пустое поле в кадре читается
 * как поломка сервиса, а не как край данных. Ограничиваем так, чтобы ВЕСЬ
 * прямоугольник окна лежал внутри круга, то есть центр -- внутри круга
 * радиуса (R - половина диагонали окна). Когда окно крупнее круга (мелкий
 * зум на широком экране), допустимый радиус обращается в ноль, и карта
 * держится по центру сама.
 *
 * Leaflet-овский maxBounds здесь не годится: он работает с прямоугольником
 * в широтах/долготах, а у нас круг, и такой прямоугольник в полярной
 * проекции вырождается.
 */
function clampCenter(animate) {
  const size = map.getSize();
  const k = crs.scale(map.getZoom());                 // пикселей на метр
  const halfDiag = Math.hypot(size.x, size.y) / 2 / k;
  const maxR = Math.max(0, crs.radius - halfDiag);
  const p = crs.projection.project(map.getCenter());
  const r = Math.hypot(p.x, p.y);
  if (r <= maxR + 1) return;
  const f = r > 0 ? maxR / r : 0;
  map.panTo(crs.projection.unproject(L.point(p.x * f, p.y * f)),
            { animate: !!animate, duration: 0.3 });
}
map.on('drag', () => clampCenter(false));
map.on('moveend zoomend', () => clampCenter(true));

window.addEventListener('resize', () => {
  map.setMinZoom(zoomForLat(crs, MIN_LAT, viewport()));
  clampCenter(false);
});

// --- загрузка и запуск ---
Promise.all([
  loadBasemap(crs, DATA_URL),
  loadPredictors(LAYERS_URL).catch((e) => {
    console.warn('слой предикторов недоступен:', e.message);
    return null;
  }),
  // Справочник -- необязательная часть: без него карта работает, просто
  // аббревиатуры остаются нерасшифрованными.
  loadCatalog(LAYERS_URL).catch((e) => {
    console.warn('справочник предикторов недоступен:', e.message);
    return null;
  }),
  loadSets(LAYERS_URL).catch((e) => {
    console.warn('слой неизбыточных наборов недоступен:', e.message);
    return null;
  }),
]).then(([data, P, CAT, S]) => {
  // Стопка слоёв: вода -> данные -> суша и всё линейное -> подписи.
  // Поле данных обязано лежать под берегом, иначе на карте пропадает
  // единственная линия, по которой её и читают.
  for (const [name, z] of [['baseOcean', 200], ['fieldPane', 250], ['baseLand', 300]]) {
    map.createPane(name);
    map.getPane(name).style.zIndex = z;
  }
  map.getPane('fieldPane').style.pointerEvents = 'none';
  map.getPane('baseLand').style.pointerEvents = 'none';

  const tileOpts = {
    tileSize: TILE, noWrap: true, keepBuffer: 1, updateWhenZooming: false,
  };
  const ocean = arcticBasemap(data,
    Object.assign({ part: 'ocean', pane: 'baseOcean' }, tileOpts)).addTo(map);
  const land = arcticBasemap(data,
    Object.assign({ part: 'land', pane: 'baseLand' }, tileOpts)).addTo(map);
  const basemap = {
    setVisible: (k, v) => { ocean.setVisible(k, v); land.setVisible(k, v); },
    setDraft: (v, s) => { ocean.setDraft(v, s); land.setDraft(v, s); },
    setRegionPaint: (p, a) => { ocean.setRegionPaint(p, a); },
    redraw: () => { ocean.redraw(); land.redraw(); },
  };

  const field = arcticField({ pane: 'fieldPane' }).addTo(map);
  const labels = arcticLabels(data.labels, { lang: i18n.getLang() }).addTo(map);
  const readout = document.getElementById('readout');

  // --- вращение ---
  // Поворот применяется здесь, а не в компасе: центр карты надо снять до
  // смены проекции. Перерисовка ставится в очередь на кадр -- при
  // перетаскивании кольца события приходят чаще, чем браузер рисует.
  let queued = null;
  let raf = 0;

  function rotateNow(lonUp, dragging) {
    const center = map.getCenter();
    const zoom = map.getZoom();
    basemap.setDraft(dragging, true);
    crs.setLonUp(lonUp);
    // Приватный метод Leaflet: единственный способ заставить карту пересчитать
    // вид при неизменных центре и зуме. Публичный setView в этом случае
    // выходит без действия.
    map._resetView(center, zoom, true);
  }

  function requestRotate(lonUp, dragging) {
    queued = [lonUp, dragging];
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const [l, d] = queued;
      rotateNow(l, d);
    });
  }

  /**
   * Переключатель языка -- контрол карты, а не строка панели.
   *
   * Две кнопки RU/EN говорят сами за себя, подпись «Язык» рядом с ними
   * ничего не добавляла. В правом верхнем углу он попадается на глаза
   * сразу, а не после прокрутки панели до самого низа.
   */
  function createLangSwitch(m) {
    const Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const box = L.DomUtil.create('div', 'seg seg-sm lang-ctl');
        box.innerHTML = '<button data-lang="ru">RU</button>'
                      + '<button data-lang="en">EN</button>';
        L.DomEvent.disableClickPropagation(box);
        return box;
      },
    });
    const ctl = new Ctl();
    m.addControl(ctl);
    return ctl.getContainer();
  }

  // Язык -- над компасом, в том же правом верхнем углу. Leaflet кладёт
  // контролы в порядке добавления, поэтому он идёт первым.
  const langSeg = createLangSwitch(map);
  createCompass(map, crs, requestRotate);

  // Справочник знает цвета групп от слоя предикторов: цветной квадрат в нём
  // должен совпадать с цветом в легенде карты, иначе связка бесполезна.
  let catalog = null;
  if (CAT) {
    const groupColor = {};
    if (P) for (const g of P.meta.groups) groupColor[g.key] = g.color;
    catalog = createCatalog(map, CAT, groupColor);
    // Ссылкой можно открыть сразу справочник -- удобно, когда объясняешь
    // коллеге, что за переменные в легенде.
    if (url.get('catalog') === '1') catalog.toggle(true);
  }

  // ─────────────────────────── ведущий предиктор ──────────────────────
  // Постановок несколько: месячная на полном ряде и суточные по фазам
  // ледового цикла. Выбор разложен на две оси -- шаг и сезон, -- а не на
  // один длинный список: сравнивают обычно вдоль одной из них, а сезоны у
  // месячной постановки пока и не считались.
  const predBox = document.getElementById('predMode');
  const discBox = document.getElementById('predDisc');
  const discRow = document.getElementById('predDiscRow');
  const seasonSel = document.getElementById('predSeason');
  const seasonRow = document.getElementById('predSeasonRow');
  const lagBox = document.getElementById('predLag');
  const lagRow = document.getElementById('predLagRow');
  const lagUnit = document.getElementById('predLagUnit');
  const opacityRow = document.getElementById('predOpacityRow');
  const predOpacity = document.getElementById('predOpacity');
  const predLegend = document.getElementById('predLegend');
  const kRow = document.getElementById('predK');
  const kRange = document.getElementById('predKRange');
  const kValue = document.getElementById('kValue');
  const setupNote = document.getElementById('predSetupNote');

  let scope = null;
  let predMode = 'off';
  let predDisc = 'monthly';
  let predSeason = 'all';
  let predLag = null;
  let predCal = false;            // вычтен ли календарь (постановка U')
  let predLayer = null;           // попиксельный слой текущей постановки
  let setLayer = null;            // клетка неизбыточных наборов
  let needGrid = null;            // сколько предикторов нужно, по сетке
  let oceanIdx = null;            // общая маска расчётной области
  let cappedGrid = null;          // где набор упёрся в глубину счёта
  let predK = S ? S.meta.kDefault : 3;
  const countsCache = new Map();  // сколько ячеек за каждой группой

  // Ключ постановки складывается из шага, сезона и того, вычтен ли
  // календарь. Вторая постановка отвечает на другой вопрос -- «что даёт
  // предиктор сверх льда И даты», -- поэтому это отдельная постановка со
  // своими слоями и своей глубиной наборов, а не режим показа.
  const setup = () => (P ? P.setupByKey[predDisc + '_' + predSeason
                                        + (predCal ? '__cal' : '')] : null);
  const setKey = () => (setup() ? setup().key + '/' + predLag : null);
  const hasSet = () => !!(S && setKey() && S.meta.cells[setKey()]);

  function setPredMode(mode, cal) {
    if (cal !== undefined) predCal = !!cal;
    // Попиксельных карт может не быть: у суточной постановки «весь год»
    // считаны только регионы. Кнопка в таких случаях выключена, но приход
    // из адреса надо всё равно перехватить.
    if (mode === 'pixel' && setup() && !setup().pixel) mode = 'region';
    if (mode === 'sets' && !hasSet()) mode = 'pixel';
    predMode = mode;
    applyPred();
  }

  /** Сезоны текущего шага и выбор допустимого горизонта при переключении. */
  function refreshSetupControls() {
    const list = seasonsOf(P, predDisc);
    seasonSel.innerHTML = list
      .map((st) => '<option value="' + st.season + '">' +
        i18n.t('season.' + st.season) + '</option>').join('');
    if (!list.some((st) => st.season === predSeason)) {
      predSeason = list[0].season;
    }
    seasonSel.value = predSeason;
    // Строка сезона прячется, когда выбирать не из чего: одна кнопка на
    // выбор -- это не выбор, а лишняя строка в плотной панели.
    seasonRow.hidden = list.length < 2;

    const st = setup();
    // Наборы считаны по ячейкам, поэтому горизонты у них те же, что у
    // попиксельной карты; отдельная ось горизонтов есть только у морей.
    const lags = lagsOf(st, predMode === 'region' ? 'region' : 'pixel');
    // Горизонт сохраняем при переходе, если он есть в новой постановке:
    // 30 суток и 1 месяц -- разные оси, но человек листает по одной.
    if (!lags.includes(predLag)) predLag = lags[0];
    lagBox.innerHTML = lags
      .map((l) => '<button data-lag="' + l + '">' + l + '</button>').join('');
    lagBox.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', +b.dataset.lag === predLag);
      b.addEventListener('click', () => { predLag = +b.dataset.lag; applyPred(); });
    });
    lagUnit.textContent = i18n.t('unit.' + (st ? st.lagUnit : 'month'));

    discBox.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.disc === predDisc));
    // Каждая кнопка проверяет СВОЮ постановку, а не текущую: иначе ряд с
    // календарём выглядел бы доступным там, где его не считали.
    predBox.querySelectorAll('button').forEach((b) => {
      const cal = b.dataset.cal === '1';
      const key = predDisc + '_' + predSeason + (cal ? '__cal' : '');
      const target = P ? P.setupByKey[key] : null;
      const off = b.dataset.mode === 'sets'
        ? !(S && target && S.meta.cells[target.key + '/' + predLag])
        : !(target && target.pixel);
      b.disabled = off;
      b.title = off ? i18n.t('pred.note.nodata') : '';
      b.classList.toggle('on', !off && predMode === b.dataset.mode
                               && predCal === cal);
    });

    setupNote.textContent = st
      ? i18n.t('domain.' + st.domainKind, {
        n: st.domainCells.toLocaleString(i18n.getLang() === 'ru' ? 'ru-RU' : 'en-US'),
      })
      : '';
  }

  /**
   * Сбой в слое предикторов должен быть виден.
   *
   * Раньше исключение внутри отрисовки легенды не ловил никто: карта
   * оставалась нарисованной, а на месте легенды навсегда застывала надпись
   * «загрузка слоя…», и понять причину можно было только через консоль.
   * Молчащий сбой под видом загрузки -- худший вариант из возможных.
   */
  function showPredError(e) {
    console.error('слой предикторов:', e);
    predLegend.hidden = false;
    predLegend.innerHTML = '<div class="pl-error">' +
      i18n.t('pred.failed') + '<br><code>' +
      String(e && e.message ? e.message : e).slice(0, 160) + '</code><br>' +
      i18n.t('pred.failed.hint') + '</div>';
  }

  async function applyPred() {
    try {
      await applyPredInner();
    } catch (e) {
      showPredError(e);
    }
  }

  async function applyPredInner() {
    if (!P) return;
    refreshSetupControls();
    const st = setup();

    discRow.hidden = predMode === 'off';
    lagRow.hidden = predMode === 'off';
    opacityRow.hidden = predMode === 'off';
    if (scope) scope.show(predMode === 'pixel' || predMode === 'sets');
    predLegend.hidden = predMode === 'off';
    if (predMode === 'off') seasonRow.hidden = true;

    kRow.hidden = predMode !== 'sets';
    renderKValue();

    if (predMode === 'off') {
      basemap.setRegionPaint(null);
      predLayer = null;
      field.clear();
      syncUrl();
      return;
    }

    if (predMode === 'region') {
      predLayer = null;
      field.clear();
      basemap.setRegionPaint(regionPaint(P, st.key, predLag),
                             predOpacity.value / 100);
      renderPredLegend();
      syncUrl();
      return;
    }

    if (predMode === 'sets') {
      predLayer = null;
      basemap.setRegionPaint(null);
      predLegend.innerHTML = '<div class="pl-loading">' +
        i18n.t('pred.loading') + '</div>';
      await applySets();
      syncUrl();
      return;
    }

    // попиксельный режим
    setLayer = null;
    needGrid = null;
    basemap.setRegionPaint(null);
    predLegend.innerHTML = '<div class="pl-loading">' +
      i18n.t('pred.loading') + '</div>';
    const wanted = st.key + '/' + predLag;
    const layer = await lagLayer(P, st.key, predLag);
    // Пока грузилось, могли переключить постановку -- тогда рисовать чужое
    // нельзя: подписи в легенде разъедутся с картой.
    if (predMode !== 'pixel' || setup().key + '/' + predLag !== wanted) return;
    predLayer = layer;
    field.setCategories(layer.cat, layer.weight, {
      colors: P.colors,
      insignificant: P.insignificant,
      catInsignificant: P.meta.catInsignificant,
      catNodata: P.meta.catNodata,
      catOutside: P.meta.catOutside,
      catNoEstimate: P.meta.catNoEstimate,
      opacity: predOpacity.value / 100,
    });
    renderPredLegend();
    syncUrl();
  }

  /**
   * Сколько ячеек за каждой группой (для легенды).
   *
   * `inside` -- фильтр области: null означает весь охват. Кэш держим только
   * для полного охвата: областей бесконечно много, а проход по 186 тысячам
   * ячеек занимает единицы миллисекунд, и кэшировать его незачем.
   *
   * Ячейки вне домена постановки в знаменатель НЕ входят: они не считались,
   * и включать их значило бы разбавлять доли предикторов пустотой. Их
   * количество показывается отдельной строкой.
   */
  function groupCounts(layer, key, inside) {
    if (!inside && countsCache.has(key)) return countsCache.get(key);
    const c = new Array(P.meta.groups.length).fill(0);
    let insig = 0;
    let outside = 0;
    let noEst = 0;
    const cat = layer.cat;
    for (let i = 0; i < cat.length; i++) {
      const v = cat[i];
      if (v === P.meta.catNodata) continue;
      if (inside && !inside(i)) continue;
      if (v === P.meta.catOutside) outside++;
      else if (v === P.meta.catNoEstimate) noEst++;
      else if (v === P.meta.catInsignificant) insig++;
      else if (v < c.length) c[v]++;
    }
    // Ячейки без оценки -- часть домена, поэтому они в знаменателе: иначе
    // строки легенды в сумме дадут больше ста процентов. Отдельная строка
    // называет их своим именем, чтобы их не читали как «лидер незначим».
    const res = { c, insig, outside, noEst,
                  total: c.reduce((a, b) => a + b, 0) + insig + noEst };
    if (!inside) countsCache.set(key, res);
    return res;
  }

  /**
   * Карта «сколько предикторов нужно».
   *
   * Порог не зашит в данные: в клетке лежат прирост и его отношение к шуму,
   * а ползунок -- это параметр чтения карты. Пересчёт полной сетки занимает
   * пару миллисекунд, поэтому ползунок работает без задержки и без
   * обращения к серверу.
   */
  async function applySets() {
    const key = setKey();
    // Расчётная область одна на обе постановки (суточная пересчитана на
    // тех же 25 115 ячейках), поэтому домен и зовётся по смыслу. Ветка
    // «вне домена» при этом сохранена: досчитают постановку на более
    // узкой маске -- она снова понадобится.
    if (!oceanIdx) oceanIdx = await domainIndex(S, 'ocean');
    const layer = await cellLayer(S, setup().key, predLag);
    if (predMode !== 'sets' || setKey() !== key) return;   // успели переключить
    setLayer = layer;
    recomputeNeed();
    refreshRecommend();
  }

  // --- всплывающие подсказки ------------------------------------------
  //
  // Своя, а не браузерная: та появляется через секунду с лишним, рисунок в
  // неё не вставить, а фон у неё системный. Элемент помечается `data-tip`
  // (ключ словаря) и необязательным `data-tip-img` (шаблон пути с %s вместо
  // языка). Текст и рисунок перечитываются при каждом показе -- иначе после
  // смены языка подсказка осталась бы на прежнем.
  const tip = document.getElementById('tip');
  const esc = (t) => t.replace(/[&<>]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

  function showTip(el) {
    const img = el.dataset.tipImg;
    tip.innerHTML = esc(i18n.t(el.dataset.tip))
      + (img ? '<img src="' + img.replace('%s', i18n.getLang()) + '" alt="">' : '');
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    // Вправо от ПАНЕЛИ, а не от самого значка: иначе подсказка ложится
    // поверх панели и закрывает то, рядом с чем её открыли. Если справа не
    // помещается -- прижимается к краю окна, а не вылезает за него.
    const host = el.closest('.panel');
    const left = (host ? host.getBoundingClientRect().right : r.right) + 10;
    const x = Math.min(left, window.innerWidth - w - 8);
    const y = Math.min(r.top, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mouseenter', () => showTip(el));
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
  });

  // --- рекомендованный набор каналов ---------------------------------
  //
  // Отбор тот же, что в абляции (`analysis/report_set_thresholds.py`), но
  // считается по ОТКРЫТОЙ клетке: своя постановка, свой сезон, свой
  // горизонт. Так видно и то, ради чего обе постановки считались, -- набор
  // «сверх льда» длиннее, и разница ровно в тех предикторах, что были прокси
  // календаря.
  let recSet = null;
  const recKey = () => (!P ? null : [setup() ? setup().key : '', predLag, predK,
                                     scope ? scope.label() : ''].join('|'));

  async function refreshRecommend() {
    if (!P || !S || !setup()) return;
    const key = recKey();
    if (recSet && recSet.key === key) return;
    const layer = await cellLayer(S, setup().key, predLag).catch(() => null);
    if (recKey() !== key) return;             // успели переключить
    const r = recommendSet([layer], predK, scope ? scope.filter() : null);
    recSet = r ? { ...r, key } : null;
    if (predMode === 'sets') renderPredLegend();
  }

  function recomputeNeed() {
    if (!setLayer) return;
    const need = neededGrid(setLayer, predK, oceanIdx,
                            P.meta.catOutside, P.meta.catNodata,
                            P.meta.catNoEstimate);
    needGrid = need.grid;
    cappedGrid = need.capped;
    refreshRecommend();
    field.setCategories(needGrid, null, {
      colors: NEED_COLORS,
      insignificant: P.insignificant,
      catInsignificant: P.meta.catInsignificant,
      catNodata: P.meta.catNodata,
      catOutside: P.meta.catOutside,
      catNoEstimate: P.meta.catNoEstimate,
      opacity: predOpacity.value / 100,
    });
    renderPredLegend();
  }

  function renderKValue() {
    const names = { 2: 'k.soft', 3: 'k.normal', 4: 'k.hard' };
    const tag = names[predK] ? ' · ' + i18n.t(names[predK]) : '';
    kValue.textContent = predK.toFixed(1).replace(/\.0$/, '') + ' σ' + tag;
  }

  /** Легенда карты наборов: доли по числу нужных предикторов. */
  function renderSetsLegend() {
    const depth = setLayer.meta.depth;
    const inside = scope ? scope.filter() : null;
    const { counts, noEst, capped, total } =
      needShares(needGrid, depth, inside, P.meta.catNoEstimate, cappedGrid);
    if (!total) {
      predLegend.innerHTML = '<div class="pl-loading">' +
        i18n.t('scope.empty') + '</div>';
      return;
    }
    const rows = [];
    if (scope) {
      rows.push('<div class="pl-scope">' + scope.label() + ' · ' +
        i18n.t('scope.cells', { n: total.toLocaleString(
          i18n.getLang() === 'ru' ? 'ru-RU' : 'en-US') }) + '</div>');
    }
    // Рекомендованный набор каналов по выбранной области -- тем же отбором,
    // что в абляции. Считается по постановке U' и по ВСЕМ сезонам сразу,
    // поэтому не зависит от того, какая постановка и какой сезон открыты;
    // слои подгружаются отдельно и строка дорисовывается, когда они готовы.
    if (recSet && recSet.key === recKey()) {
      rows.push('<div class="pl-scope pl-rec">' + i18n.t('sets.recommend', {
        list: recSet.names.join(', '),
        n: recSet.names.length,
        cov: Math.round(100 * recSet.coverage),
      }) + '</div>');
    }
    // Состав наборов: «двух предикторов хватает в 45 % ячеек» не отвечает на
    // вопрос, каких именно. Под курсором это видно по одной ячейке, здесь --
    // по выбранной области целиком.
    const parts = setBreakdown(setLayer, needGrid, depth, inside);
    // Несовпадение версий модулей должно быть слышно. Молча пропустить
    // разбор -- значит показать урезанную легенду как нормальную: именно
    // так предыдущая версия этой проверки и спрятала поломку.
    const shaped = parts.find((x) => x);
    if (shaped && !shaped.top) throw new Error('sets.js устарел в кеше');
    const rgb = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    for (let n = 0; n <= depth; n++) {
      if (!counts[n]) continue;
      const label = n === 0 ? i18n.t('sets.legend0') : String(n);
      rows.push('<div class="pl"><i class="sw" style="background:' +
        rgb(NEED_COLORS[Math.min(n, NEED_COLORS.length - 1)]) +
        '"></i><span class="pl-var">' + label + '</span>' +
        '<span class="pl-note">' + Math.round(100 * counts[n] / total) +
        ' %</span></div>');
      // На горстке ячеек состав -- шум, а не результат: разбор показываем
      // только там, где он на чём-то держится.
      const part = parts[n];
      if (!part || counts[n] < 20) continue;
      // Доли составов берутся от ТОЙ ЖЕ области, что и процент группы, а не
      // от размера группы: иначе в соседних строках стоят два разных
      // знаменателя и числа не сходятся на глаз. Остаток дописывается явно,
      // чтобы строки группы складывались ровно в её процент.
      const pct = (c) => 100 * c / total;
      const fmt = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
      const mix = part.top.map((c) =>
        '<span><b>' + c.names.join('+') + '</b> ' + fmt(pct(c.count)) +
        ' %</span>');
      if (part.other > 0) {
        const rest = pct(counts[n]) - part.top.reduce(
          (a, b) => a + pct(b.count), 0);
        mix.push('<span class="mix-rest">' + i18n.t('sets.other') + ' ' +
          fmt(rest) + ' %</span>');
      }
      rows.push('<div class="pl-mix">' + mix.join('') + '</div>');
    }
    if (noEst / total >= 0.005) {
      rows.push('<div class="pl"><i class="sw" style="background:' +
        P.meta.colorInsignificant + '"></i><span class="pl-var">' +
        i18n.t('pred.legend.noest') + '</span><span class="pl-note">' +
        Math.round(100 * noEst / total) + ' %</span></div>');
    }
    // Потолок счёта -- свойство ячейки, а не строки: последний шаг считали
    // не везде, поэтому в строке «5» соседствуют ячейки, где шестой шаг не
    // прошёл порог, и ячейки, где его не считали. Отдельной строки в легенде
    // такая мелочь не заслуживает, а умолчания -- заслуживает.
    // Строку не показываем, когда она округляется в ноль: «0 %» сообщает не
    // «мало», а «считать нечего», и читается как недоработка.
    if (100 * capped / total >= 0.05) {
      rows.push('<div class="pl-scope">' + i18n.t('sets.capped', {
        p: capped / total >= 0.005
          ? Math.round(100 * capped / total)
          : (Math.round(1000 * capped / total) / 10),
      }) + '</div>');
    }
    predLegend.innerHTML = rows.join('');
  }

  /**
   * Легенда показывает только то, что есть на карте сейчас.
   * Полный список из двенадцати групп занял бы полпанели, и почти все строки
   * в нём были бы про цвета, которых в кадре нет.
   */
  function renderPredLegend() {
    try {
      renderPredLegendInner();
    } catch (e) {
      showPredError(e);
    }
  }

  function renderPredLegendInner() {
    if (!P) return;
    if (predMode === 'sets') {
      if (setLayer && needGrid) renderSetsLegend();
      return;
    }
    const st = setup();
    const rows = [];
    const add = (color, text, note) => {
      rows.push('<div class="pl"><i class="sw" style="background:' + color +
        '"></i><span class="pl-var">' + text + '</span>' +
        (note ? '<span class="pl-note">' + note + '</span>' : '') + '</div>');
    };

    if (predMode === 'region') {
      const tbl = (st.regionLeader || {})[String(predLag)] || {};
      const seen = new Set();
      let anyInsig = false;
      for (const rec of Object.values(tbl)) {
        if (!rec.sig) { anyInsig = true; continue; }
        if (seen.has(rec.g)) continue;
        seen.add(rec.g);
        add(P.meta.groups[rec.g].color, rec.name);
      }
      if (anyInsig) add(P.meta.colorInsignificant, i18n.t('pred.legend.insig'));
    } else if (predLayer) {
      const inside = scope ? scope.filter() : null;
      const { c, insig, outside, noEst, total } =
        groupCounts(predLayer, st.key + '/' + predLag, inside);
      if (!total) {
        predLegend.innerHTML = '<div class="pl-loading">' +
          i18n.t('scope.empty') + '</div>';
        return;
      }
      // Заголовок с областью и числом ячеек: без него проценты по полигону
      // неотличимы от процентов по всему охвату.
      if (scope) {
        rows.push('<div class="pl-scope">' + scope.label() + ' · ' +
          i18n.t('scope.cells', { n: total.toLocaleString(
            i18n.getLang() === 'ru' ? 'ru-RU' : 'en-US') }) + '</div>');
      }
      const order = c.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]);
      for (const [n, i] of order) {
        if (n / total < 0.005) continue;
        add(P.meta.groups[i].color, P.meta.groups[i].key,
            Math.round(100 * n / total) + ' %');
      }
      // Строки «лидер незначим» не будет там, где значимость не считалась:
      // пустая категория честнее нуля.
      if (st.pixelSignificance && insig / total >= 0.005) {
        add(P.meta.colorInsignificant, i18n.t('pred.legend.insig'),
            Math.round(100 * insig / total) + ' %');
      }
      // Серое поле в центре объясняется в легенде, но без процента: эти
      // ячейки не в знаменателе.
      if (outside) {
        add(P.meta.colorInsignificant, i18n.t('pred.legend.outside'), '');
      }
      if (noEst / total >= 0.005) {
        add(P.meta.colorInsignificant, i18n.t('pred.legend.noest'),
            Math.round(100 * noEst / total) + ' %');
      }
    }
    predLegend.innerHTML = rows.join('');
  }

  if (!P) {
    predBox.closest('.grp').hidden = true;
  } else {
    const d = url.get('disc');
    if (P.setups.some((st) => st.disc === d)) predDisc = d;
    const se = url.get('season');
    if (P.setups.some((st) => st.disc === predDisc && st.season === se)) {
      predSeason = se;
    }
    const wanted = num('lag', 0);
    const lags = lagsOf(setup(), 'pixel');
    predLag = lags.includes(wanted) ? wanted : lags[0];

    discBox.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        predDisc = b.dataset.disc;
        applyPred();
      });
    });
    seasonSel.addEventListener('change', () => {
      predSeason = seasonSel.value;
      applyPred();
    });
    predBox.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (!b.disabled) setPredMode(b.dataset.mode, b.dataset.cal === '1');
      });
    });
    scope = createScope(map, P, () => {
      renderPredLegend();
      if (predMode === 'sets') refreshRecommend();
    });
    kRange.min = S ? S.meta.kMin : 2;
    kRange.max = S ? S.meta.kMax : 4;
    kRange.step = S ? S.meta.kStep : 0.5;
    kRange.value = predK;
    kRange.addEventListener('input', () => {
      predK = parseFloat(kRange.value);
      renderKValue();
      recomputeNeed();
      syncUrl();
    });
    scope.select(url.get('scope'));
    predOpacity.addEventListener('input', () => {
      if (predMode === 'pixel') field.setOpacity(predOpacity.value / 100);
      else if (predMode === 'region') {
        basemap.setRegionPaint(regionPaint(P, setup().key, predLag),
                               predOpacity.value / 100);
      }
    });
    refreshSetupControls();
  }

  // --- переключатели слоёв ---
  document.querySelectorAll('[data-layer]').forEach((el) => {
    const fromUrl = url.get(el.dataset.layer);
    if (fromUrl !== null) el.checked = fromUrl === '1';
    basemap.setVisible(el.dataset.layer, el.checked);
    el.addEventListener('change', () => {
      basemap.setVisible(el.dataset.layer, el.checked);
      // Подписи меридианов -- часть градусной сетки, гасятся вместе с ней.
      if (el.dataset.layer === 'graticule') labels.setVisible('grat', el.checked);
    });
  });

  document.querySelectorAll('[data-labels]').forEach((el) => {
    const kinds = el.dataset.labels === 'sea'
      ? ['sea', 'basin', 'strait', 'relief'] : ['city'];
    el.addEventListener('change', () => {
      kinds.forEach((k) => labels.setVisible(k, el.checked));
    });
  });

  // --- язык ---
  function paintLang() {
    langSeg.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.lang === i18n.getLang()));
  }
  langSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      i18n.setLang(b.dataset.lang);
      labels.setLang(b.dataset.lang);
      refreshAttribution();
      paintLang();
      if (catalog) catalog.refresh();
      if (scope) scope.refreshLang();
      if (P) applyPred();
      renderPredLegend();
      readout.innerHTML = '';
      syncUrl();
    });
  });
  paintLang();

  /**
   * Подсказка карты наборов: шаги отбора с приростом, числом сигм и долей
   * информации. Показывается и первый НЕ прошедший шаг -- он объясняет,
   * почему набор оборвался именно здесь; без него порог выглядел бы
   * произволом.
   *
   * Первой строкой идёт «лёд сам» -- то, что известно о будущем льде из его
   * собственной истории, без всяких предикторов. Она отделена чертой и в
   * счёт шагов не входит. Без неё проценты врут в самую важную сторону: на
   * суточных горизонтах лёд сам даёт девяносто с лишним процентов, и
   * подсказка «sit -- 75 %» читалась бы как «sit объясняет три четверти
   * всего», тогда как это три четверти ОСТАТКА сверх истории льда.
   */
  function setsTip(latlng) {
    if (!setLayer) return '';
    const c = cellAt(latlng);
    if (!c) return '';
    const res = stepsAt(setLayer, c.at, predK);
    if (!res) {
      return '<span class="ro-sub">' + i18n.t('probe.outside') + '</span>';
    }
    if (res === 'noestimate') {
      return '<span class="ro-sub">' + i18n.t('probe.noestimate') + '</span>';
    }
    const { rows, computed, ice, date } = res;
    // Вместо долей -- потолок качества модели: доли законны, только если
    // слагаемые складываются в целое, а цепное правило выполняется слишком
    // приближённо. Потолок считается по накопленной информации и растёт от
    // строки к строке, показывая, что даёт каждый следующий предиктор.
    const cap = (v) => (v === null || v === undefined ? ''
      : '     ' + i18n.t('sets.r2') + ' = ' + v.toFixed(2));
    // «-0.000 нат» -- артефакт округления: знак при нуле сообщает о величине
    // то, чего в ней нет.
    const nat = (v) => {
      const t = v.toFixed(3);
      return t === '-0.000' ? '0.000' : t;
    };
    const passed = rows.filter((r) => r.passed).length;
    // Прошли все шаги, оценённые В ЭТОЙ ячейке, -- значит счёт упёрся в
    // глубину, а не в порог, и набор здесь может быть длиннее. Подписывать
    // такую ячейку точным числом -- значит выдавать потолок измерения за
    // результат. Глубина у ячеек разная: последний шаг считали не везде.
    const capped = passed === computed;
    const out = ['<b>' + (passed
      ? i18n.t(capped ? 'sets.needCap' : 'sets.need', { n: passed })
      : i18n.t('sets.none')) + '</b>'];
    const base = (label, v) => '<span class="ro-step ro-ice">' +
      label.padEnd(10, ' ') + '  ' + nat(v.nats) + ' ' + i18n.t('probe.nats') +
      '        ' + cap(v.r2) + '</span>';
    if (ice) out.push(base(i18n.t('sets.ice'), ice));
    // Дату показываем только там, где она ВЫЧТЕНА из вкладов предикторов.
    // В постановке без календаря она тоже посчитана, но сидит внутри
    // приростов, и отдельной строкой учлась бы дважды.
    if (date) out.push(base(i18n.t('sets.date'), date));
    rows.forEach((r, i) => {
      out.push('<span class="ro-step' + (r.passed ? '' : ' ro-cut') + '">' +
        (i + 1) + '. ' + r.name +
        '  ' + (r.gain >= 0 ? '+' : '') + nat(r.gain) + ' ' +
        i18n.t('probe.nats') +
        '  (' + r.ratio.toFixed(1).padStart(4, ' ') + ' σ)' + cap(r.r2) +
        (r.passed ? '' : '  ← ' + i18n.t('sets.below')) + '</span>');
    });
    // У ячейки, где прошли все посчитанные шаги, «остальные не добавляют» --
    // утверждение, которого никто не проверял: дальше просто не считали.
    if (passed) {
      out.push('<span class="ro-rest">' +
        i18n.t(capped ? 'sets.restCap' : 'sets.rest', { n: computed }) +
        '</span>');
    }
    return '<span class="ro-sub ro-sets">' + out.join('') + '</span>';
  }

  // --- подсказка под курсором ---
  const fmt = (v, pos, neg) =>
    Math.abs(v).toFixed(2) + '° ' + i18n.t(v >= 0 ? pos : neg);

  map.on('mousemove', (e) => {
    const coords = fmt(e.latlng.lat, 'dir.n', 'dir.s') + '&nbsp;&nbsp; ' +
      fmt(((e.latlng.lng + 540) % 360) - 180, 'dir.e', 'dir.w');
    if (!P || predMode === 'off') {
      readout.innerHTML = coords;
      return;
    }
    if (predMode === 'sets') {
      readout.innerHTML = coords + setsTip(e.latlng);
      return;
    }
    const info = probe(P, setup().key, predMode === 'pixel' ? predLayer : null,
                       predLag, e.latlng, i18n.getLang());
    if (!info) {
      readout.innerHTML = coords;
      return;
    }
    // Вне именованного моря подпись региона просто опускается: в
    // попиксельном режиме значение в ячейке есть и там.
    const bits = info.region ? ['<b>' + info.region + '</b>'] : [];
    if (predMode === 'region' && info.regionLeader) {
      const col = info.regionSig
        ? P.meta.groups[setup().regionLeader[String(predLag)][info.regionKey].g].color
        : P.meta.colorInsignificant;
      bits.push(i18n.t('probe.sea') + ': <i class="ro-sw" style="background:' +
        col + '"></i>' + (info.regionSig ? info.regionLeader
          : i18n.t('probe.insignificant')));
      if (info.regionSig && info.share !== null && info.share !== undefined) {
        bits.push(i18n.t('probe.share', { p: Math.round(info.share * 100) }));
      }
    } else if (predMode === 'pixel' && info.cell) {
      if (info.cell === 'outside') {
        bits.push(i18n.t('probe.outside'));
      } else if (info.cell === 'noestimate') {
        bits.push(i18n.t('probe.noestimate'));
      } else if (info.cell === 'insignificant') {
        bits.push(i18n.t('probe.cell') + ': ' + i18n.t('probe.insignificant'));
      } else if (info.cell === 'nodata') {
        bits.push(i18n.t('probe.cell') + ': ' + i18n.t('probe.nodata'));
      } else {
        const rel = info.rel === null ? ''
          : ' (' + Math.round(info.rel * 100) + ' %)';
        bits.push(i18n.t('probe.cell') + ': ' + info.cell +
          (info.variable && info.variable !== info.cell
            ? ' (' + info.variable + ')' : ''));
        bits.push('U ' + info.u1.toFixed(3) + ' ' + i18n.t('probe.nats'));
        bits.push(i18n.t('probe.margin') + ' ' + info.gap.toFixed(3) + rel);
      }
    }
    readout.innerHTML = coords + (bits.length
      ? '<span class="ro-sub">' + bits.join(' · ') + '</span>' : '');
  });
  map.on('mouseout', () => { readout.innerHTML = ''; });

  // --- состояние в адресе ---
  let urlTimer = 0;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const c = map.getCenter();
      const q = new URLSearchParams({
        lat: c.lat.toFixed(3),
        lon: (((c.lng + 540) % 360) - 180).toFixed(3),
        z: map.getZoom().toFixed(2),
        up: crs.getLonUp().toFixed(1),
        lang: i18n.getLang(),
      });
      if (P && predMode !== 'off') {
        q.set('pred', predMode);
        q.set('disc', predDisc);
        q.set('season', predSeason);
        q.set('lag', String(predLag));
        if (predCal) q.set('cal', '1');
        if (predMode === 'sets') q.set('k', String(predK));
      }
      history.replaceState(null, '', location.pathname + '?' + q);
    }, 400);
  }
  map.on('moveend zoomend viewreset', syncUrl);

  // Начальное состояние слоя предикторов -- из адреса.
  const kFromUrl = num('k', 0);
  if (S && kFromUrl >= S.meta.kMin && kFromUrl <= S.meta.kMax) {
    predK = kFromUrl;
    kRange.value = predK;
  }
  const predFromUrl = url.get('pred');
  if (P && (predFromUrl === 'region' || predFromUrl === 'pixel'
            || predFromUrl === 'sets')) {
    predCal = url.get('cal') === '1';
    setPredMode(predFromUrl, predCal);
  } else if (P) {
    // Без параметров открываем главный результат работы, а не пустую
    // подложку: суточное намерзание на сутки вперёд, сверх льда И даты.
    // Именно эта пара отвечает на вопрос, ради которого сервис и сделан, --
    // что остаётся от предиктора, когда календарь уже учтён.
    predDisc = 'daily';
    predSeason = 'freeze_up';
    predLag = 1;
    predCal = true;
    setPredMode('pixel', true);
  }

  document.getElementById('boot').classList.add('done');

  // Ручка для консоли и для будущего кода сервиса.
  window.arctic = { map, crs, ocean, land, field, labels, data, P, S,
                    COLORMAPS, build: buildInfo };
}).catch((err) => {
  document.getElementById('boot').innerHTML =
    '<span>' + i18n.t('boot.failed') + ': ' + err.message +
    '<br>' + i18n.t('boot.hint') + '</span>';
  console.error(err);
});
