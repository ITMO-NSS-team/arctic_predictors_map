// Две версии сайта из одного кода.
//
// Словарь плоский, ключ -- смысл строки, а не место на экране: одна и та же
// подпись встречается и в панели, и в подсказке, и разъезжаться они не
// должны. Разметка помечена атрибутами data-i18n / data-i18n-title, поэтому
// перевод -- это один проход по DOM, без перерисовки интерфейса.
//
// Язык влияет и на подписи на карте (см. labels.js): переключатель один,
// иначе получилась бы карта с английским интерфейсом и русскими морями.

export const LANGS = ['ru', 'en'];

const DICT = {
  ru: {
    'app.title': 'Арктика',
    'app.subtitle': 'полярная стереографическая, 90°–16.6° с.ш.',
    'boot.loading': 'Loading…',
    'boot.failed': 'не удалось загрузить подложку',
    'boot.hint': 'запускали ли вы tools/fetch_natural_earth.py и tools/prepare_basemap.py?',

    'group.base': 'Подложка',
    'layer.bathymetry': 'Батиметрия',
    'layer.water': 'Реки и озёра',
    'layer.borders': 'Границы стран',
    'layer.graticule': 'Градусная сетка',
    'layer.gridDomain': 'Контур сетки EASE2',
    'layer.regions': 'Границы морей',

    'group.labels': 'Подписи',
    'labels.sea': 'Акватории',
    'labels.city': 'Города',

    'group.predictors': 'Карты предикторов',
    'pred.mode.sets': 'набор',
    'pred.k': 'Строгость',
    'k.soft': 'мягкий',
    'k.hard': 'строгий',
    'k.normal': 'обычный',
    'k.note': 'Порог выражен в единицах шума: во сколько раз прирост информации должен превышать разброс случайного предиктора.',
    'sets.need': 'Нужно предикторов: {n}',
    'sets.needCap': 'Нужно предикторов: {n} и более',
    'sets.none': 'Ни один предиктор не проходит порог',
    'sets.ice': 'лёд сам',
    'sets.date': 'дата',
    'sets.r2': 'потолок R²',
    'sets.recommend': 'Для модели: <b>{list}</b> — {n} канал(ов) на {cov} % ячеек.',
    'sets.below': 'ниже порога',
    'sets.rest': 'Остальные не добавляют информации сверх этих.',
    'sets.restCap': 'Дальше шагов не считали: глубина отбора -- {n}.',
    'sets.other': 'прочие',
    'sets.legend0': 'ни одного',
    'sets.legendN': '{n}',
    'sets.capped': 'В {p} % ячеек набор упёрся в глубину счёта — там «и более».',
    'sets.title': 'Сколько предикторов нужно',
    'pred.disc': 'Шаг',
    'pred.disc.monthly': 'месячный',
    'pred.disc.daily': 'суточный',
    'pred.season': 'Сезон',
    'pred.season.hint': ['Сезоны по фазам ледового цикла, а не по календарным кварталам:',
                        'намерзание — октябрь, ноябрь, декабрь',
                        'зима — январь, февраль, март',
                        'начало таяния — апрель, май, июнь',
                        'таяние — июль, август, сентябрь',
                        'весь год — весь ряд без разбиения'].join(String.fromCharCode(10)),
    'season.all': 'весь год',
    'season.freeze_up': 'намерзание',
    'season.winter': 'зима',
    'season.melt_onset': 'начало таяния',
    'season.melt': 'таяние',
    'unit.month': 'мес',
    'unit.day': 'сут',
    'domain.ocean': 'вся океанская маска, ячеек: {n}',
    'domain.miz': 'краевая ледовая зона, ячеек: {n}',
    'pred.note.nosig': 'Значимость по ячейкам для этой постановки ещё не считана: показан лидер и его отрыв, но не проверено, отличим ли он от шума.',
    'pred.note.nodata': 'для этой постановки не посчитано',
    'pred.note.nopixel': 'Попиксельных карт для этой постановки нет — доступен только показ по морям.',
    'pred.mode': 'Показ',
    'pred.cap.plain': 'сверх льда',
    'pred.cap.cal': 'сверх льда и даты',
    'pred.mode.off': 'выключен',
    'pred.mode.region': 'по морям',
    'pred.mode.pixel': 'по ячейкам',
    'pred.lag': 'Горизонт',
    'pred.lag.unit': 'мес',
    'pred.opacity': 'Прозрачность',
    'pred.legend.other': 'прочие группы',
    'pred.legend.insig': 'лидер незначим',
    'pred.loading': 'загрузка слоя…',
    'pred.failed': 'Слой не построился.',
    'pred.failed.hint': 'Если страница была открыта во время обновления — перезагрузите её с Ctrl+Shift+R.',


    'hint.compass': 'Компас справа вверху — вращение вокруг полюса. Тянуть кольцо мышью, двойной щелчок — округлить до 15°.',

    'compass.up': 'вверху',
    'compass.preset.180': 'Берингов пролив вверху',
    'compass.preset.0': 'Гринвич вверху',
    'compass.preset.90': 'Карское море вверху',
    'compass.preset.-90': 'Канада вверху',

    'dir.n': 'с.ш.', 'dir.s': 'ю.ш.', 'dir.e': 'в.д.', 'dir.w': 'з.д.',

    'probe.sea': 'по морю',
    'probe.cell': 'в ячейке',
    'probe.margin': 'отрыв от 2-й группы',
    'probe.nats': 'нат',
    'probe.insignificant': 'незначим',
    'probe.nodata': 'нет данных',
    'probe.outside': 'вне краевой ледовой зоны — не считалось',
    'pred.legend.outside': 'вне краевой зоны',
    'pred.legend.noest': 'нет оценки',
    'probe.noestimate': 'не хватило данных для оценки',
    'pred.scope': 'Статистика',
    'scope.all': 'весь охват',
    'scope.polygon': 'свой полигон',
    'scope.cells': 'ячеек: {n}',
    'scope.empty': 'в выбранной области нет посчитанных ячеек',
    'poly.draw': 'Нарисовать',
    'poly.clear': 'Сбросить',
    'poly.coords': 'Координаты',
    'poly.placeholder': 'по вершине в строке: 78.5, 60.0',
    'poly.hint.empty': 'Нажмите «Нарисовать» и отмечайте вершины щелчками по карте; двойной щелчок замыкает полигон.',
    'poly.hint.drawing': 'Вершин: {n}. Двойной щелчок — замкнуть.',
    'poly.hint.ready': 'Полигон из {n} вершин. «Координаты» — посмотреть или вписать вручную.',
    'poly.hint.badcoords': 'Нужно минимум три строки вида «широта, долгота».',
    'probe.share': 'тот же лидер в {p} % ячеек моря',

    'catalog.open': 'Предикторы',
    'catalog.title': 'Справочник предикторов',
    'catalog.close': 'Закрыть',
    'catalog.sub': '{n} переменные, все приведены к общей сетке {grid}. Цветной квадрат — цвет группы избыточности на карте; в одной группе переменные, конкурирующие за одну и ту же информацию.',
    'catalog.derived': 'производная от',
    'catalog.foot': 'Значки «мес» и «сут» — постановки, в которые переменная допущена: её родной шаг не должен быть грубее шага постановки. Строки, отмеченные точкой, раскрываются щелчком.',

    'attrib': 'Подложка: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain) · проекция: полярная стереографическая, lat_ts=70',
  },

  en: {
    'app.title': 'The Arctic',
    'app.subtitle': 'polar stereographic, 90°–16.6° N',
    'boot.loading': 'Loading…',
    'boot.failed': 'could not load the basemap',
    'boot.hint': 'did you run tools/fetch_natural_earth.py and tools/prepare_basemap.py?',

    'group.base': 'Basemap',
    'layer.bathymetry': 'Bathymetry',
    'layer.water': 'Rivers and lakes',
    'layer.borders': 'Country borders',
    'layer.graticule': 'Graticule',
    'layer.gridDomain': 'EASE2 grid outline',
    'layer.regions': 'Sea boundaries',

    'group.labels': 'Labels',
    'labels.sea': 'Water bodies',
    'labels.city': 'Cities',

    'group.predictors': 'Predictor maps',
    'pred.mode.sets': 'set',
    'pred.k': 'Strictness',
    'k.soft': 'lenient',
    'k.hard': 'strict',
    'k.normal': 'normal',
    'k.note': 'The threshold is expressed in units of noise: how many times the information gain must exceed the spread of a random predictor.',
    'sets.need': 'Predictors needed: {n}',
    'sets.needCap': 'Predictors needed: {n} or more',
    'sets.none': 'No predictor passes the threshold',
    'sets.ice': 'ice itself',
    'sets.date': 'date',
    'sets.r2': 'R² ceiling',
    'sets.recommend': 'For a model: <b>{list}</b> — {n} channel(s) for {cov} % of cells.',
    'sets.below': 'below threshold',
    'sets.rest': 'The rest add no information beyond these.',
    'sets.restCap': 'No further steps were computed: selection depth is {n}.',
    'sets.other': 'прочие',
    'sets.other': 'other',
    'sets.legend0': 'none',
    'sets.legendN': '{n}',
    'sets.capped': 'In {p} % of cells the set hit the counting depth — those are “or more”.',
    'sets.title': 'How many predictors are needed',
    'pred.disc': 'Step',
    'pred.disc.monthly': 'monthly',
    'pred.disc.daily': 'daily',
    'pred.season': 'Season',
    'pred.season.hint': ['Seasons follow the phases of the ice cycle, not calendar quarters:',
                        'freeze-up — October, November, December',
                        'winter — January, February, March',
                        'melt onset — April, May, June',
                        'melt — July, August, September',
                        'whole year — the full series, no split'].join(String.fromCharCode(10)),
    'season.all': 'whole year',
    'season.freeze_up': 'freeze-up',
    'season.winter': 'winter',
    'season.melt_onset': 'melt onset',
    'season.melt': 'melt',
    'unit.month': 'mo',
    'unit.day': 'd',
    'domain.ocean': 'full ocean mask, {n} cells',
    'domain.miz': 'marginal ice zone, {n} cells',
    'pred.note.nosig': 'Per-cell significance has not been computed for this setup yet: the leader and its margin are shown, but whether it stands out from noise is untested.',
    'pred.note.nodata': 'not computed for this setup',
    'pred.note.nopixel': 'No per-cell maps exist for this setup — only the by-sea view is available.',
    'pred.mode': 'Display',
    'pred.cap.plain': 'beyond the ice',
    'pred.cap.cal': 'beyond the ice and the date',
    'pred.mode.off': 'off',
    'pred.mode.region': 'by sea',
    'pred.mode.pixel': 'by grid cell',
    'pred.lag': 'Lead time',
    'pred.lag.unit': 'mo',
    'pred.opacity': 'Opacity',
    'pred.legend.other': 'other groups',
    'pred.legend.insig': 'leader not significant',
    'pred.loading': 'loading layer…',
    'pred.failed': 'The layer could not be built.',
    'pred.failed.hint': 'If the page was open while the app was updated, reload it with Ctrl+Shift+R.',


    'hint.compass': 'The compass at top right rotates the map about the pole. Drag the ring, double-click to snap to 15°.',

    'compass.up': 'up',
    'compass.preset.180': 'Bering Strait up',
    'compass.preset.0': 'Greenwich up',
    'compass.preset.90': 'Kara Sea up',
    'compass.preset.-90': 'Canada up',

    'dir.n': 'N', 'dir.s': 'S', 'dir.e': 'E', 'dir.w': 'W',

    'probe.sea': 'sea',
    'probe.cell': 'cell',
    'probe.margin': 'margin over 2nd group',
    'probe.nats': 'nats',
    'probe.insignificant': 'not significant',
    'probe.nodata': 'no data',
    'probe.outside': 'outside the marginal ice zone — not computed',
    'pred.legend.outside': 'outside the marginal zone',
    'pred.legend.noest': 'no estimate',
    'probe.noestimate': 'not enough data to estimate',
    'pred.scope': 'Statistics',
    'scope.all': 'whole domain',
    'scope.polygon': 'custom polygon',
    'scope.cells': 'cells: {n}',
    'scope.empty': 'no computed cells in the selected area',
    'poly.draw': 'Draw',
    'poly.clear': 'Reset',
    'poly.coords': 'Coordinates',
    'poly.placeholder': 'one vertex per line: 78.5, 60.0',
    'poly.hint.empty': 'Press “Draw” and click vertices on the map; double-click closes the polygon.',
    'poly.hint.drawing': 'Vertices: {n}. Double-click to close.',
    'poly.hint.ready': 'Polygon of {n} vertices. “Coordinates” shows or accepts them as text.',
    'poly.hint.badcoords': 'At least three lines of the form “lat, lon” are required.',
    'probe.share': 'same leader in {p} % of the sea’s cells',

    'catalog.open': 'Predictors',
    'catalog.title': 'Predictor reference',
    'catalog.close': 'Close',
    'catalog.sub': '{n} variables, all regridded onto the common {grid} grid. The colour square is the colour of the redundancy group on the map; a group holds variables competing for the same information.',
    'catalog.derived': 'derived from',
    'catalog.foot': 'The “mo” and “d” badges mark the setups a variable is admitted to: its native step must not be coarser than the setup’s. Rows marked with a dot expand on click.',

    'attrib': 'Basemap: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain) · projection: polar stereographic, lat_ts=70',
  },
};

let current = 'ru';

export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : 'ru';
  document.documentElement.lang = current;
  apply();
  return current;
}

export function getLang() {
  return current;
}

/** t('probe.share', {p: 42}) */
export function t(key, vars) {
  let s = DICT[current][key];
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
  }
  return s;
}

/** Прогон по разметке: текст, подсказки и значения option. */
export function apply(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
}

/**
 * Начальный язык: адрес важнее памяти браузера, память важнее умолчания.
 * Пользователь, приславший ссылку с ?lang=en, хочет показать английскую
 * версию, даже если у получателя выбран русский.
 */
export function initialLang(url) {
  const fromUrl = url && url.get('lang');
  if (LANGS.includes(fromUrl)) return fromUrl;
  // Выбор языка НЕ запоминается между заходами. Запоминание казалось
  // удобством, но ломало главное свойство ссылки: страница без ?lang
  // открывалась на том языке, который посетитель выбрал когда-то прежде, и
  // автор ссылки не мог знать, что увидит получатель. Умолчание --
  // английский: сервис комплиментарен англоязычной публикации.
  return 'en';
}
