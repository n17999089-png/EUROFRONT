/* EUROFRONT — карта Европы.
   Подложка Esri World Imagery + рельеф Mapzen/AWS Terrarium (система из LINESTATE):
   hillshade в плоскости, объёмный terrain в 3D, профили по силе устройства,
   якорный плавный зум, CPU-пик рельефа вместо readPixels, восстановление контекста. */
(() => {
'use strict';

/* ------------------------------ хранилище ------------------------------ */

const mem = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }
};
const PREF_KEY = 'EUROFRONT:prefs';
const loadPrefs = () => { try { return JSON.parse(mem.get(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } };
const savePrefs = p => mem.set(PREF_KEY, JSON.stringify(p));

/* ------------------------------ устройство ------------------------------ */

let deviceState = null;

function detectDevice() {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua);
    const touch = (navigator.maxTouchPoints || 0) > 0 || matchMedia('(pointer: coarse)').matches;
    const uaMobile = /Android|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobile/i.test(ua) && !ios;
    const mobile = uaMobile || window.innerWidth <= 700 || (touch && Math.min(window.innerWidth, window.innerHeight) <= 820);
    const root = document.documentElement;
    root.classList.toggle('dev-mobile', mobile);
    root.classList.toggle('dev-touch', touch);
    root.classList.toggle('dev-ios', ios);
    return { mobile, touch, ios };
}
function initDevice() { deviceState = detectDevice(); return deviceState; }
window.addEventListener('resize', initDevice);
window.addEventListener('orientationchange', initDevice);

function docMobile() {
    try { return (deviceState || detectDevice()).mobile; } catch (e) { return false; }
}

// слабый телефон: 3 ГБ памяти или 4 ядра — рисуем грубее и в меньшем DPR
function lowEndDevice() {
    try {
        if (!docMobile()) return false;
        return (navigator.deviceMemory || 4) <= 3 || (navigator.hardwareConcurrency || 4) <= 4;
    } catch (e) { return false; }
}

// сила GPU одним числом: 0 — слабый, 1 — средний, 2 — мощный.
// probe создаёт WebGL-контекст, поэтому кэшируется
let gpuCache = null;
function gpuInfo() {
    if (gpuCache) return gpuCache;
    let renderer = 'unknown', tier = 1;
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
        if (gl) {
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
            const r = renderer.toLowerCase();
            const soft = /swiftshader|llvmpipe|software|basic render/.test(r);
            const weak = /mali-4|mali-t[0-6]|adreno\s*\(tm\)\s*[23]|adreno[- ]?[23]|powervr sgx|hd graphics [234]|geforce [6789]|gt [6789]|radeon hd [2345]|intel\(r\) hd graphics/.test(r);
            const strong = /rtx|radeon rx [5679]|radeon pro|apple m[1-9]|apple gpu|adreno\s*\(tm\)\s*[678]|adreno[- ]?[678]|mali-g[789]|immortalis|geforce (gtx|rtx)|quadro|apple a1[5-9]|apple a[2-9][0-9]/.test(r);
            tier = weak ? 0 : strong ? 2 : 1;
            if (soft && tier === 0) tier = 1;
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) try { lose.loseContext(); } catch (e) { }
        } else { tier = 0; }
    } catch (e) { }
    gpuCache = { renderer, tier };
    return gpuCache;
}

let tierCache = null;
function deviceTier() {
    if (tierCache != null) return tierCache;
    const dev = deviceState || detectDevice();
    const cores = navigator.hardwareConcurrency || 4;
    const memG = navigator.deviceMemory || 4;
    let t = gpuInfo().tier;
    if (cores <= 4 || memG <= 3) t = Math.min(t, 1) - 1;
    else if (cores >= 8 && memG >= 6) t = Math.min(2, t + 1);
    // телефон не держит верхний уровень долго: термопакет душит GPU
    if (dev.mobile && t > 1) t = 1;
    tierCache = Math.max(0, Math.min(2, t));
    return tierCache;
}

const renderPerf = { reliefApplied: 0, reliefSkipped: 0 };

/* ------------------------------ подложки ------------------------------ */

const LITE = /[?&]lite=1/.test(location.search);
const SCRIPT_BASE = (() => {
    try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; }
})();
const GLYPHS = SCRIPT_BASE + 'fonts/{fontstack}/{range}.pbf';

// выше 18 уровня Esri отдаёт заглушку «Map data not yet available»
const TILES_MAXZOOM = 18;

const SATELLITE_SOURCE = {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: TILES_MAXZOOM,
    attribution: 'Esri, Maxar, Earthstar Geographics'
};

// Единственная подложка — спутник. Бумага больше не режим: это наложение
// поверх снимка (текстура листа), его рисуют слои ef-paper-sea и ef-land.
const BASE = {
    version: 8,
    glyphs: GLYPHS,
    sources: { sat: Object.assign({}, SATELLITE_SOURCE) },
    layers: [
        { id: 'ef-bg', type: 'background', paint: { 'background-color': '#0b1013' } },
        {
            // снимок приглушён на обзоре: там он фон под фронтом и цветами стран.
            // Вглубь зум раскрываем яркость и цветность — город обязан быть видно
            id: 'hybrid-sat', type: 'raster', source: 'sat',
            paint: {
                'raster-saturation': ['interpolate', ['linear'], ['zoom'], 2.5, -0.45, 8, -0.26, 12, -0.05],
                'raster-contrast': ['interpolate', ['linear'], ['zoom'], 2.5, 0.16, 12, 0.04],
                'raster-brightness-max': ['interpolate', ['linear'], ['zoom'], 2.5, 0.76, 8, 0.86, 12, 0.95],
                'raster-brightness-min': ['interpolate', ['linear'], ['zoom'], 2.5, 0.2, 8, 0.28, 12, 0.38],
                'raster-opacity': 1
            }
        }
    ]
};

/* ------------------------------ текстура бумаги ------------------------------ */

// периодический value-noise: кратен 256 → тайл сходится без швов
const NOISE_PERM = (() => {
    const p = new Uint8Array(512);
    let s = 20261113;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const base = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    return p;
})();
const vnoise = (x, y) => {
    const ix = Math.floor(x) & 255, iy = Math.floor(y) & 255;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const g = (a, b) => NOISE_PERM[a + NOISE_PERM[b]] / 255;
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
const fbm = (x, y) => {
    let s = 0, amp = .5, f = 1;
    for (let i = 0; i < 4; i++) { s += vnoise(x * f, y * f) * amp; amp *= .5; f *= 2.03; }
    return s;
};

const PAPER_TONE = {
    sea: [163, 178, 176],
    land: [233, 221, 197]
};

function paperTile(kind) {
    const N = 256;
    const img = new ImageData(N, N);
    const d = img.data;
    const [r0, g0, b0] = PAPER_TONE[kind];
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const grain = fbm(x / 7, y / 7);              // волокна
            const blotch = fbm(x / 46 + 11, y / 46 + 7);   // old-пятна
            const fine = vnoise(x * 3.1, y * 3.1);
            // бумага темнее в пятнах, светлее в высветах; море — холоднее и ровнее
            let k = (grain - .5) * 26 + (blotch - .5) * 34 + (fine - .5) * 9;
            if (kind === 'sea') k *= .62;
            const warm = (blotch - .5) * (kind === 'land' ? 15 : 6);
            // альфа — сама текстура: лист ложится на снимок зерном и пятнами, а не
            // сплошной краской, иначе спутник под бумагой перестаёт читаться
            const a = (kind === 'sea' ? 150 : 132) + (blotch - .5) * 88 + (grain - .5) * 54 + (fine - .5) * 20;
            const i = (y * N + x) * 4;
            d[i] = Math.max(0, Math.min(255, r0 + k + warm));
            d[i + 1] = Math.max(0, Math.min(255, g0 + k + warm * .6));
            d[i + 2] = Math.max(0, Math.min(255, b0 + k - warm * .3));
            d[i + 3] = Math.max(40, Math.min(235, a));
        }
    }
    return img;
}

// текстура — часть стиля: после setStyle её нет, добавляем заново
function ensurePaperImages(map) {
    for (const kind of ['sea', 'land']) {
        const id = 'ef-paper-' + kind;
        try {
            if (map.hasImage(id)) continue;
            map.addImage(id, paperTile(kind), { pixelRatio: 2 });
        } catch (e) { }
    }
}


/* ------------------------------ рамка Европы ------------------------------ */

// Исландия → Волга, Нордкап → Кипр/Мальта
const EUROPE_BOUNDS = [[-25.5, 33.5], [46.0, 72.0]];

const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

// "contain": вся Европа в кадре на старте; за рамкой — тот же спутник, не пустота
function homeCamera(w, h) {
    const b = EUROPE_BOUNDS;
    const zW = Math.log2(Math.max(1, w) * 360 / (512 * (b[1][0] - b[0][0])));
    const zH = Math.log2(Math.max(1, h) * Math.PI * 2 / (512 * (mercY(b[1][1]) - mercY(b[0][1]))));
    const midY = (mercY(b[1][1]) + mercY(b[0][1])) / 2;
    return {
        center: [(b[0][0] + b[1][0]) / 2, Math.atan(Math.sinh(midY)) * 180 / Math.PI],
        zoom: Math.min(zW, zH)
    };
}
const minZoomFor = z => Math.max(1.6, z);

/* ------------------------------ рельеф (порт LINESTATE) ------------------------------ */

// terrarium: высота = R·256 + G + B/256 − 32768 метров. Mapzen / AWS Open Terrain
const DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
const DEM_ID = 'ef-dem';
const RELIEF_ID = 'ef-relief';

const S = {
    relief: null, ex: 0, armed: false, reliefPending: false,
    relief3d: true, reliefFlat: true,
    is3d: false, bound: null, gridOn: true
};

// на близком зуме точность важнее гор: поднятие гаснет до пола, но не в ноль —
// хребты остаются, контуры не тонут. hillshade гаснет отдельно и не ниже 0.8:
// именно он показывает рельеф там, где поднятие уже не стоит пикселя
function reliefProfile() {
    const dev = deviceState || detectDevice();
    const tier = deviceTier();
    if (!dev.mobile) {
        const g = gpuInfo().tier;
        if (tier === 0 || g === 0) return { maxzoom: 9, ex: 1, hill: 0.6, full: 10.2, zero: 12.4, floor: .7 };
        if (g < 2) return { maxzoom: 10, ex: 1.2, hill: 0.85, full: 10.6, zero: 12.8, floor: .8 };
        return { maxzoom: 11, ex: 1.35, hill: 1, full: 11, zero: 13.2, floor: .9 };
    }
    if (tier === 0 || lowEndDevice()) return { maxzoom: 8, ex: 0.95, hill: 0.6, full: 9.4, zero: 11.6, floor: .5 };
    return { maxzoom: 9, ex: 1.15, hill: 0.9, full: 10.2, zero: 12, floor: .7 };
}

function reliefEx(p, z) {
    const t = Math.max(0, Math.min(1, (p.zero - z) / (p.zero - p.full)));
    return Math.max(p.floor, p.ex * t * t * (3 - 2 * t));
}

// Рельеф живёт на печатном листе поверх снимка: тёплый верх, глубокая сепия в
// тени — хребты и долины читаются объёмно, а не плоской кашей
function reliefThemeColors() {
    return { accent: '#fff1c6', highlight: '#fffdf4', shadow: '#5a4522' };
}

// Выразительный рельеф: почти полная сила затенки (было 0.5 — горы едва
// проступали). Контраст теней даёт объём, бумага всё ещё читается под ним.
function reliefHill(p) {
    return p.hill * 0.92;
}


function setRelief(map, on) {
    if (!on) {
        try { map.setTerrain(null); } catch (e) { }
        if (map.getLayer(RELIEF_ID)) map.removeLayer(RELIEF_ID);
        if (map.getSource(DEM_ID)) map.removeSource(DEM_ID);
        S.relief = null;
        S.armed = false;
        S.ex = 0;
        syncPolitical(map);
        return;
    }
    const col = reliefThemeColors();
    const p = reliefProfile();
    S.relief = p;
    S.reliefPending = false;
    if (!map.getSource(DEM_ID)) {
        // стиль мог ещё не догрузиться после setStyle — не роняем обработчик;
        // syncRelief вернёт слой, когда стиль будет готов
        try {
            map.addSource(DEM_ID, {
                type: 'raster-dem', tiles: DEM_TILES, tileSize: 256,
                maxzoom: p.maxzoom, encoding: 'terrarium',
                attribution: 'Mapzen / AWS Open Terrain'
            });
        } catch (e) { return; }
    }
    if (map.getLayer(RELIEF_ID)) {
        // подложка сменилась — обновляем только цвета теней, не пересобирая слой
        try {
            map.setPaintProperty(RELIEF_ID, 'hillshade-accent-color', col.accent);
            map.setPaintProperty(RELIEF_ID, 'hillshade-highlight-color', col.highlight);
            map.setPaintProperty(RELIEF_ID, 'hillshade-shadow-color', col.shadow);
            map.setPaintProperty(RELIEF_ID, 'hillshade-exaggeration', reliefHill(p));
        } catch (e) { }
    } else {
        try {
            map.addLayer({
                id: RELIEF_ID, type: 'hillshade', source: DEM_ID,
                paint: {
                    'hillshade-accent-color': col.accent,
                    'hillshade-highlight-color': col.highlight,
                    'hillshade-shadow-color': col.shadow,
                    'hillshade-illumination-anchor': 'map',
                    'hillshade-illumination-direction': 325,
                    'hillshade-exaggeration': reliefHill(p)
                }
            });
        } catch (e) { }
    }
    armTerrain(map);
    syncPolitical(map);
}

function setReliefUser(map, on) {
    on = !!on;
    if (S.is3d) S.relief3d = on; else S.reliefFlat = on;
    try {
        if (on) setRelief(map, true);
        else setRelief(map, false);
    } finally {
        const p = loadPrefs();
        p.relief3d = S.relief3d; p.reliefFlat = S.reliefFlat;
        savePrefs(p);
        syncReliefBtn();
    }
}

// setStyle забирает DEM вместе со стилем; в MapLibre 3.6.2 style.load после
// setStyle не долетает, поэтому рельеф возвращаем явным вызовом
function syncRelief(map) {
    if (S.reliefPending) return;
    const want = S.is3d ? S.relief3d !== false : S.reliefFlat === true;
    if (want) {
        if (!map.getLayer(RELIEF_ID) || !map.getSource(DEM_ID)) setRelief(map, true);
    } else if (map.getLayer(RELIEF_ID)) {
        setRelief(map, false);
    }
}

// MapLibre 3.6.2 падает, если terrain появляется посреди анимации камеры:
// следующий кадр ease читает _elevationCenter, которого ещё нет. Включаем
// terrain на первой паузе жеста; hillshade к тому моменту уже на экране
function armTerrain(map) {
    if (!S.relief || S.armed || !S.is3d) return;
    const moving = () => { try { return !!map.isMoving(); } catch (e) { return false; } };
    const go = () => {
        map.off('moveend', go);
        if (!S.relief || !S.is3d) return;
        S.armed = true;
        applyReliefEx(map, true);
    };
    if (moving()) { map.on('moveend', go); return; }
    go();
}

// старт под завісой: DEM-тайлы не грузим в первую же секунду — рельеф
// включается этим вызовом, когда подложка уже показала кадр
function reliefArm(map) {
    if (S.is3d) {
        if (!S.reliefPending) return;
        setRelief(map, true);
    } else if (S.reliefFlat === true) {
        setRelief(map, true);
    }
}

// Terrain.pointCoordinate читает 1 пиксель из GPU (readPixels) — принудительная
// синхронизация конвейера, десятки мс на событие мыши. Пересечение луча с
// рельефом ищем по CPU бинарным поиском по экранному сдвигу; не сошлось — GPU
function cpuTerrainPick(map) {
    const tr = map.terrain;
    if (!tr || tr._efCpuPick || typeof tr.getElevationForLngLatZoom !== 'function') return;
    const t = map.transform;
    const gpu = tr.pointCoordinate;
    let proto = null;
    const coordAt = (x, y, z) => {
        if (!proto) proto = Object.getPrototypeOf(t.pointCoordinate({ x: 1, y: 1 }));
        const c = Object.create(proto);
        c.x = x; c.y = y; c.z = z;
        return c;
    };
    const st = tr._efPickStats = { cpu: 0, nulls: 0, back: 0 };
    tr.pointCoordinate = function (e) {
        if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) { st.back++; return gpu.call(tr, e); }
        if (e.x < 0 || e.y < 0 || e.x >= t.width || e.y >= t.height) { st.nulls++; return null; }
        if (!(t.pitch >= 1)) { st.nulls++; return null; }
        const c = t.pointCoordinate(t.getCameraPoint());
        const f = t.pointCoordinate(e);
        if (!c || !f) { st.back++; return gpu.call(tr, e); }
        const dx = f.x - c.x, dy = f.y - c.y;
        const dAt = (u) => {
            const ll = coordAt(c.x + dx * u, c.y + dy * u, 0).toLngLat();
            const p = t.locationPoint(ll, tr);
            if (!p || !Number.isFinite(p.y)) return 1e9;
            return p.y - e.y;
        };
        if (!(dAt(0) > 0)) { st.back++; return gpu.call(tr, e); }
        let hi = 1;
        let dh = dAt(hi);
        for (let g = 0; g < 3 && !(dh < 0); g++) { hi += 0.35; dh = dAt(hi); }
        if (!(dh < 0)) { st.nulls++; return null; }
        let lo = 0;
        for (let k = 1; k <= 12; k++) {
            const u = hi * k / 12;
            if (dAt(u) < 0) { hi = u; break; }
            lo = u;
        }
        for (let it = 0; it < 10; it++) {
            const mid = (lo + hi) / 2;
            if (dAt(mid) > 0) lo = mid; else hi = mid;
        }
        const u2 = (lo + hi) / 2;
        const x = c.x + dx * u2, y = c.y + dy * u2;
        const ll = coordAt(x, y, 0).toLngLat();
        const h = tr.getElevationForLngLatZoom(ll, t.tileZoom);
        const chk = t.locationPoint(ll, tr);
        if (!chk || !Number.isFinite(chk.x) || Math.hypot(chk.x - e.x, chk.y - e.y) > 20) {
            st.back++; return gpu.call(tr, e);
        }
        st.cpu++;
        return coordAt(x, y, Number.isFinite(h) ? h : 0);
    };
    tr._efCpuPick = true;
}

// setTerrain трогает стиль — экстраполяцию правим только при заметной разнице
function applyReliefEx(map, force) {
    const p = S.relief;
    if (!p || !S.armed) return;
    const e = reliefEx(p, map.getZoom());
    if (!force && Math.abs(e - S.ex) < 0.05) { renderPerf.reliefSkipped++; return; }
    renderPerf.reliefApplied++;
    S.ex = e;
    const tr = map.terrain;
    if (tr && tr.options && tr.options.source === DEM_ID && Number.isFinite(e)) {
        tr.options.exaggeration = e;
        tr.exaggeration = e;
        map.triggerRepaint();
    } else {
        try { map.setTerrain({ source: DEM_ID, exaggeration: e }); } catch (err) { }
    }
    cpuTerrainPick(map);
    if (map.getLayer(RELIEF_ID)) {
        try {
            map.setPaintProperty(RELIEF_ID, 'hillshade-exaggeration',
                reliefHill(p) * Math.max(0.8, Math.min(1, e / p.ex)));
        } catch (err) { }
    }
}

/* ------------------------------ 3D-режим ------------------------------ */

const THREE_D_PITCH = 55;
const threeDMs = () => docMobile() ? 720 : 880;

function bind3dZoom(map) {
    if (S.bound) return;
    S.bound = { zoom: () => applyReliefEx(map) };
    map.on('zoom', S.bound.zoom);
}
function unbind3dZoom(map) {
    if (!S.bound) return;
    map.off('zoom', S.bound.zoom);
    S.bound = null;
}

let off3d = null;
function set3D(map, on, onDone) {
    if (on === S.is3d && !onDone) return;
    const dur = threeDMs();
    if (on) {
        // повторное включение во время незавершённого выключения: старый
        // слушатель moveend должен исчезнуть, иначе он снимет 3D посреди анимации
        if (off3d) { map.off('moveend', off3d); off3d = null; }
        if (!S.is3d) {
            S.is3d = true;
            map.setMaxPitch(60);
            if (map.dragRotate) map.dragRotate.enable();
            if (map.touchPitch) map.touchPitch.enable();
            if (map.touchZoomRotate) map.touchZoomRotate.enableRotation();
            setRelief(map, S.relief3d !== false);
            bind3dZoom(map);
        }
        try { map.easeTo({ pitch: THREE_D_PITCH, duration: dur }); } catch (e) { }
    } else {
        if (!S.is3d) { if (onDone) onDone(); return; }
        // в плоскость возвращаемся и севером вверх
        const level = () => (map.getPitch() < 0.5) && Math.abs(map.getBearing()) < 0.5;
        try { map.easeTo({ pitch: 0, bearing: 0, duration: dur }); } catch (e) { }
        const off = () => {
            if (!level()) return;
            map.off('moveend', off);
            off3d = null;
            S.is3d = false;
            map.setMaxPitch(0);
            if (map.dragRotate) map.dragRotate.disable();
            if (map.touchPitch) map.touchPitch.disable();
            if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
            unbind3dZoom(map);
            S.reliefPending = false;
            if (S.reliefFlat === true) {
                // рельеф плоской карты — только hillshade, без terrain
                try { map.setTerrain(null); } catch (e) { }
                S.armed = false;
                S.ex = 0;
                if (!map.getLayer(RELIEF_ID)) setRelief(map, true);
            } else {
                setRelief(map, false);
            }
            syncModeUI();
            if (onDone) onDone();
        };
        off3d = off;
        map.on('moveend', off);
        if (level()) off();
    }
    syncModeUI();
}

/* ------------------------------ якорный плавный зум (порт) ------------------------------ */

// jumpTo в MapLibre «around» не читает — якорь считаем сами: в плоскости
// линейной формулой, под наклоном — проективным переносом центра
function smoothZoom(map) {
    const el = map.getContainer();
    try { if (map.scrollZoom) map.scrollZoom.disable(); } catch (e) { }

    const TAU = 72;
    let target = null;
    let last = 0;
    let raf = 0;
    let anchorPx = null;
    let anchorGeo = null;

    const applyZoom = z => {
        try {
            const t = map.transform;
            if (!anchorPx || !anchorGeo) { map.setZoom(z); return; }
            if (S.is3d) {
                t.zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
                t.setLocationAtPoint(anchorGeo, anchorPx);
                map.jumpTo({ zoom: t.zoom, center: [t.center.lng, t.center.lat] });
                return;
            }
            const cx = t.width / 2, cy = t.height / 2;
            const a = map.project(anchorGeo);
            const k = Math.pow(2, z - t.zoom);
            const c = map.unproject([
                cx + (a.x - cx) - (anchorPx.x - cx) / k,
                cy + (a.y - cy) - (anchorPx.y - cy) / k
            ]);
            map.jumpTo({ zoom: z, center: [c.lng, c.lat] });
        } catch (e) { }
    };

    const step = t => {
        raf = 0;
        if (target === null) return;
        const dt = last ? Math.min(120, t - last) : 16;
        last = t;
        let z;
        try { z = map.getZoom(); } catch (e) { target = null; return; }
        // на медленном кадре шаг ограничен долей пути; остаток < 0.1 уровня —
        // конец жеста, ограничение снимаем, иначе карта «доезжает» сама
        const rem = Math.abs(target - z);
        const frac = Math.min(1 - Math.exp(-dt / TAU), rem < 0.1 ? 0.8 : 0.55);
        const next = z + (target - z) * frac;
        if (Math.abs(target - next) < 0.003) {
            applyZoom(target);
            target = null;
            last = 0;
            return;
        }
        applyZoom(next);
        raf = requestAnimationFrame(step);
    };

    const onWheel = e => {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const rect = el.getBoundingClientRect();
        const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        let base;
        try {
            base = target === null ? map.getZoom() : target;
            anchorGeo = map.unproject(px);
        } catch (e) { return; }
        anchorPx = px;
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1);
        // шаг близок к нативному: каждый целый уровень — новый комплект тайлов
        const d = -e.deltaY * unit * 0.0016;
        if (!d) return;
        target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), base + d));
        e.preventDefault();
        if (!raf) { last = 0; raf = requestAnimationFrame(step); }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    map.once('remove', () => {
        el.removeEventListener('wheel', onWheel);
        if (raf) cancelAnimationFrame(raf);
        target = null;
    });
}

/* ------------------------------ создание карты ------------------------------ */


function gfxFail(msg) {
    const el = document.getElementById('fatal');
    const txt = document.getElementById('fatal-text');
    if (txt && msg) txt.textContent = msg;
    if (el) el.hidden = false;
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('off');
}

function createMap() {
    const dev = initDevice();
    const strongGpu = gpuInfo().tier >= 2;
    const memG = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const mobileDprCap = LITE ? 1.25 : ((memG <= 3 || cores <= 4) ? 1.5 : 1.8);
    const home = homeCamera(window.innerWidth, window.innerHeight);

    const prefs = loadPrefs();
    if (typeof prefs.relief3d === 'boolean') S.relief3d = prefs.relief3d;
    if (typeof prefs.reliefFlat === 'boolean') S.reliefFlat = prefs.reliefFlat;
    if (typeof prefs.gridOn === 'boolean') S.gridOn = prefs.gridOn;
    // lite = без растра: бумага полностью локальная, сеть и GPU-тайлы не нужны

    const map = new maplibregl.Map({
        container: 'map',
        style: BASE,
        center: home.center,
        zoom: home.zoom,
        minZoom: minZoomFor(home.zoom),
        maxZoom: TILES_MAXZOOM,
        maxPitch: 0,
        attributionControl: false,
        pixelRatio: dev.mobile ? Math.min(window.devicePixelRatio || 1, mobileDprCap) : undefined,
        antialias: !dev.mobile && strongGpu,
        preserveDrawingBuffer: false,
        refreshExpiredTiles: false,
        dragRotate: false,
        fadeDuration: dev.mobile ? 120 : 0
    });
    if (map.touchPitch) map.touchPitch.disable();
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    let attrCollapsed = false;
    const collapseAttribution = () => {
        if (attrCollapsed) return;
        const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
        if (!el) return;
        el.classList.remove('maplibregl-compact-show');
        el.setAttribute('open', '');
        attrCollapsed = true;
        map.off('styledata', collapseAttribution);
        map.off('sourcedata', collapseAttribution);
        map.off('terrain', collapseAttribution);
    };
    map.on('styledata', collapseAttribution);
    map.on('sourcedata', collapseAttribution);
    map.on('terrain', collapseAttribution);
    collapseAttribution();

    // GPU-контекст телефонов теряется под давлением памяти. MapLibre поднимает
    // новый, но растры не перезаливает — гибрид остаётся чёрным. Растр есть →
    // перезагрузка с сохранением камеры; второй сбой подряд → lite без растра
    (map => {
        const CAM_KEY = 'EUROFRONT:__recover';
        const LOST_KEY = 'EUROFRONT:__ctxlost';
        let dead = false;
        let timer = 0;
        const saveCam = () => {
            try {
                const c = map.getCenter();
                mem.sset(CAM_KEY, JSON.stringify({
                    c: [c.lng, c.lat], z: map.getZoom(),
                    b: map.getBearing(), t: Date.now()
                }));
            } catch (e) { }
        };
        const hasRaster = () => {
            try {
                const layers = (map.getStyle() || {}).layers || [];
                return layers.some(l => l.type === 'raster');
            } catch (e) { return true; }
        };
        const recover = () => {
            timer = 0;
            if (dead) return;
            dead = true;
            saveCam();
            let n = 1;
            try {
                const now = Date.now();
                const list = JSON.parse(mem.sget(LOST_KEY) || '[]').filter(t => now - t < 60000);
                list.push(now);
                mem.sset(LOST_KEY, JSON.stringify(list));
                n = list.length;
            } catch (e) { }
            if (n >= 3) { gfxFail('Графический контекст потерян трижды подряд. Перезагрузите страницу.'); return; }
            const go = () => {
                try {
                    if (n >= 2 && !LITE) {
                        const u = new URL(location.href);
                        u.searchParams.set('lite', '1');
                        location.replace(u.href);
                    } else location.reload();
                } catch (e) { }
            };
            if (document.visibilityState === 'hidden') {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState !== 'hidden') setTimeout(go, 150);
                }, { once: true });
            } else setTimeout(go, 150);
        };
        const arm = () => { if (!timer) timer = setTimeout(recover, LITE ? 900 : 1300); };
        const cv = map.getCanvas();
        cv.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            arm();
        }, false);
        cv.addEventListener('webglcontextrestored', () => {
            if (dead) return;
            if (hasRaster()) return;
            clearTimeout(timer);
            timer = 0;
            try { map.resize(); map.triggerRepaint(); } catch (e) { }
        }, false);
        map.on('remove', () => { dead = true; clearTimeout(timer); });
    })(map);

    // камера прошлой сессии после аварийной перезагрузки
    try {
        const rec = JSON.parse(mem.sget('EUROFRONT:__recover') || 'null');
        if (rec && Date.now() - rec.t < 60000 && Array.isArray(rec.c)) {
            map.jumpTo({ center: rec.c, zoom: rec.z, bearing: rec.b || 0 });
        }
    } catch (e) { }

    map._efFrames = 0;
    map.on('render', () => { map._efFrames++; });

    // под рельефом unproject читает пиксель с GPU в конструкторе каждой мышиной
    // події. Мемоизация по ключу камеры+пиксель: ~1 чтение на состояние камеры
    (map => {
        const raw = map.unproject.bind(map);
        const cache = new Map();
        const camKey = () => {
            const c = map.getCenter();
            return map.getZoom().toFixed(4) + ',' + c.lng.toFixed(6) + ',' + c.lat.toFixed(6) +
                ',' + map.getPitch().toFixed(2) + ',' + map.getBearing().toFixed(2);
        };
        map.unproject = pt => {
            const x = typeof pt.x === 'number' ? pt.x : pt[0];
            const y = typeof pt.y === 'number' ? pt.y : pt[1];
            if (!Number.isFinite(x) || !Number.isFinite(y)) return raw(pt);
            const k = camKey() + '|' + Math.round(x) + ',' + Math.round(y);
            const v = cache.get(k);
            if (v) return v;
            const r = raw(pt);
            if (cache.size > 96) cache.clear();
            cache.set(k, r);
            return r;
        };
        map.on('data', e => { if (e && e.sourceId === DEM_ID) cache.clear(); });
    })(map);

    // нативный maxBounds сам поднимает зум до cover и обрезает континент,
    // поэтому рамку держит кламп вида: на обзоре центр — меркаторская середина
    // (совпадает с homeCamera, без скачка), при зуме внутрь — края в рамке
    let camRaf = 0;
    const clampView = () => {
        camRaf = 0;
        try {
            if (map.isEasing && map.isEasing()) return;
            if (map.handlers && map.handlers.isActive()) return;
            if ((map.getPitch ? map.getPitch() : 0) > 0.5) return;
            const el = map.getContainer();
            const c = map.getCenter();
            const nw = map.unproject([0, 0]);
            const se = map.unproject([el.clientWidth, el.clientHeight]);
            const halfLon = (se.lng - nw.lng) / 2;
            const halfLat = (nw.lat - se.lat) / 2;
            const lo = EUROPE_BOUNDS[0], hi = EUROPE_BOUNDS[1];
            const midLon = (lo[0] + hi[0]) / 2;
            const midLat = Math.atan(Math.sinh((mercY(hi[1]) + mercY(lo[1])) / 2)) * 180 / Math.PI;
            let lng = c.lng, lat = c.lat;
            if (halfLon * 2 >= hi[0] - lo[0]) lng = midLon;
            else lng = Math.max(lo[0] + halfLon, Math.min(hi[0] - halfLon, lng));
            if (halfLat * 2 >= hi[1] - lo[1]) lat = midLat;
            else lat = Math.max(lo[1] + halfLat, Math.min(hi[1] - halfLat, lat));
            if (Math.abs(lng - c.lng) > 1e-6 || Math.abs(lat - c.lat) > 1e-6) {
                map.jumpTo({ center: [lng, lat] });
            }
        } catch (e) { }
    };
    const queueClamp = () => { if (!camRaf) camRaf = requestAnimationFrame(clampView); };
    const applyFitZoom = () => {
        try {
            const z = minZoomFor(homeCamera(window.innerWidth, window.innerHeight).zoom);
            if (map.getMinZoom() !== z) map.setMinZoom(z);
            if (map.getZoom() < z) map.setZoom(z);
        } catch (e) { }
    };
    applyFitZoom();
    map.on('moveend', queueClamp);
    window.addEventListener('resize', () => { applyFitZoom(); queueClamp(); });

    smoothZoom(map);
    return map;
}

/* ------------------------------ политический слой ------------------------------ */

const MASK_ID = 'ef-mask';
const LAND_ID = 'ef-land';
const PAPER_ID = 'ef-paper-sheet';
const LAKE_ID = 'ef-lake';
const LAKE_LINE_ID = 'ef-lake-line';
const FRAME_ID = 'ef-frame';
const FILL_ID = 'ef-country-fill';
// граница страны — четыре чётких штриха без единого пикселя blur: цветная
// полоса внутри, тёмный кейсинг, светлый канал и волосяная линия по центру.
// Размытая «тень» прежнего glow читалась как грязь поверх снимка.
const BAND_ID = 'ef-country-band';
const CASE_ID = 'ef-country-case';
const REGION_ID = 'ef-region-line';
const LINE_ID = 'ef-country-line';
const HAIR_ID = 'ef-country-hair';
// береговая линия (рёбра OSM с одним владельцем) — размытая тень на воде.
// Лежит НИЖЕ заливки страны: сухопутную половину тени закрывает страна,
// морскую видно на листе-море. На сухопутных границах берега нет → тени нет.
const COAST_ID = 'ef-coast-shadow';
// чёткая морская кромка поверх тени: водная граница отличается от сухопутной
// (холодный одиночный штрих + тень, без тёплого политического кейсинга)
const COAST_LINE_ID = 'ef-coast-line';
// координатная сетка (graticule): адаптивный шаг + подписи по краям листа
const GRID_ID = 'ef-grid';
const GRID_LABEL_ID = 'ef-grid-label';

// порядок слоёв снизу вверх; слои фронта/оккупации из game.js встают между
// границами стран и подписями городов. Регионы лежат НИЖЕ кейсинга страны:
// их пунктир совпадает с краем страны и иначе проступал сквозь границу.
// Кейсинг/канал/волосок рисуются ТОЛЬКО по сухопутным границам (ef-border-land):
// берег получает свою морскую кромку, поэтому вода и суша читаются по-разному.
const LAYER_ORDER = [
    'ef-bg', 'hybrid-sat', RELIEF_ID, PAPER_ID, COAST_ID, LAND_ID, MASK_ID, FRAME_ID,
    FILL_ID, LAKE_ID, LAKE_LINE_ID, COAST_LINE_ID, BAND_ID, REGION_ID, CASE_ID, LINE_ID, HAIR_ID,
    GRID_ID, GRID_LABEL_ID,
    'ef-occ-fill', 'ef-occ-hatch', 'ef-annex-fill', 'ef-annex-line',
    'ef-region-hl', 'ef-demand', 'ef-front-glow', 'ef-front-core', 'ef-front',
    'ef-battle-glow', 'ef-battle', 'ef-units', 'ef-draw'
];

function orderLayers(map) {
    for (const id of LAYER_ORDER) {
        try { if (map.getLayer(id)) map.moveLayer(id); } catch (e) { }
    }
}

// за пределами Европы — вуаль: театр войны ограничен континентом.
// Четыре полосы вместо «мир с дырой»: earcut требует противоположного обхода
// внутреннего кольца, и при одинаковом Европа заливалась вуалью вместо фона.
function maskFeature() {
    const w = EUROPE_BOUNDS[0][0], s = EUROPE_BOUNDS[0][1];
    const e = EUROPE_BOUNDS[1][0], n = EUROPE_BOUNDS[1][1];
    const q = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
    return {
        type: 'Feature', properties: {},
        geometry: {
            type: 'MultiPolygon',
            coordinates: [q(-180, -85, 180, s), q(-180, n, 180, 85), q(-180, s, w, n), q(e, s, 180, n)]
        }
    };
}

function frameFeature() {
    const b = EUROPE_BOUNDS;
    return {
        type: 'Feature', properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [[[b[0][0], b[0][1]], [b[1][0], b[0][1]], [b[1][0], b[1][1]], [b[0][0], b[1][1]], [b[0][0], b[0][1]]]]
        }
    };
}

// что и каким тоном рисуем на каждой подложке
// Единственный облик карты: спутниковый снимок + бумажный лист как наложение
// для красоты. Поэтому тон бумаги умеренный — снимок обязан читаться под ним.
function politicalSpec() {
    return {
        land: 'visible',
        lakes: 'visible',
        frame: 'visible',
        // у каждой страны свой цвет в источнике (вне ЕС — нейтральный #5c5346);
        // ['case', ['get','eu'], ['get','color'], …] MapLibre 3.6 рисует чёрным.
        // На городском зуме краска и свечение сходят на нет: игрок смотрит
        // землю, а не легенду — цвет остаётся только подписью и рамкой
        fillColor: ['get', 'color'],
        fillOpacity: ['interpolate', ['linear'], ['zoom'], 2.5, 0.36, 7, 0.26, 11, 0.1, 13, 0.06],
        // волосяная линия по центру светлого канала: классическая двойная
        // политическая граница, читается и на обзоре, и на городском зуме
        hairColor: '#3a2d18',
        hairOpacity: 0.85,
        hairWidth: ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 0.6, 10, 0.9, 14, 1.2],
        lineColor: '#efe6cf',
        lineOpacity: 1,
        lineWidth: ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.5, 10, 2.3, 14, 3.2],
        // кейсинг непрозрачный: под ним пунктир регионов не проступает сквозь
        // край страны — именно это смешение регионов с границами и было багом
        caseColor: '#191207',
        caseOpacity: 0.95,
        caseWidth: ['interpolate', ['linear'], ['zoom'], 2, 2.6, 6, 3.4, 10, 4.2, 14, 5.2],
        // плоская цветная полоса внутри страны вместо размытого свечения:
        // край резкий, страна узнаётся по цвету, но «тени» больше нет
        bandColor: ['get', 'color'],
        bandOpacity: ['interpolate', ['linear'], ['zoom'], 2.5, 0.4, 7, 0.3, 11, 0.14, 13, 0.08],
        bandWidth: ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 8, 11, 14],
        bandOffset: ['interpolate', ['linear'], ['zoom'], 2, 2, 6, 4, 11, 7],
        // регионы — подчинённый слой: тонкий светлый пунктир, только с z≈5,
        // на обзоре карта показывает лишь границы стран
        regionColor: 'rgba(58,47,27,.6)',
        regionDash: [1.7, 1.5],
        regionOpacity: ['interpolate', ['linear'], ['zoom'], 5, 0, 6.2, 0.5, 10, 0.55],
        regionWidth: ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 0.9, 12, 1.3],
        maskColor: '#2f2a1c',
        maskOpacity: 0.66,
        frameColor: '#4a3c25',
        // лист — полупрозрачное зерно (альфа в тайле), поэтому цифры выше, чем
        // были у сплошной бумаги: снимок обязан проступать сквозь текстуру
        sheetOpacity: 0.42,
        landOpacity: 0.3,
        // тень берега на воде: мягкая и глубокая. Центр на линии берега,
        // морская половина ложится на лист-море, сухопутную закрывает страна
        coastColor: '#14201c',
        coastOpacity: ['interpolate', ['linear'], ['zoom'], 2.5, 0.42, 7, 0.36, 12, 0.28],
        coastWidth: ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 6, 10, 8, 14, 11],
        coastBlur: ['interpolate', ['linear'], ['zoom'], 2, 2.2, 8, 2.8, 14, 3.4],
        // чёткая морская кромка поверх тени: холодный одиночный штрих. Сухопутная
        // граница — тёплый двойной кейсинг (case+line+hair), водная — этот штрих +
        // тень. Так вода и суша читаются по-разному, а не одной политической линией
        coastLineColor: '#4f97a0',
        coastLineOpacity: ['interpolate', ['linear'], ['zoom'], 2.5, 0.62, 7, 0.72, 12, 0.82],
        coastLineWidth: ['interpolate', ['linear'], ['zoom'], 2, 0.7, 6, 1.2, 10, 1.9, 14, 2.7],
        // координатная сетка: заметный холодный пунктир + читаемые подписи краёв
        gridColor: '#d6e6df',
        gridOpacity: ['interpolate', ['linear'], ['zoom'], 2, 0.18, 6, 0.3, 10, 0.4, 14, 0.46],
        gridWidth: ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 0.75, 10, 1.05],
        gridLabelColor: '#e6f0ea',
        gridLabelOpacity: ['interpolate', ['linear'], ['zoom'], 2, 0.55, 6, 0.72, 10, 0.82]
    };
}

// адаптивный шаг координатной сетки: на обзоре — крупные параллели (10°),
// вглубь зума — всё мельче, до сотых градуса на городском масштабе
function gridStepFor(z) {
    if (z < 3) return 10;
    if (z < 4.5) return 5;
    if (z < 6) return 2;
    if (z < 7.5) return 1;
    if (z < 9) return 0.5;
    if (z < 11) return 0.25;
    if (z < 13) return 0.1;
    return 0.05;
}
function fmtDeg(v, isLat) {
    const hemi = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    const a = Math.round(Math.abs(v) * 100) / 100;
    return a + '°' + hemi;
}
// сетка пересобирается под текущий кадр: линии в пределах видимой рамки
// (с запасом на.pan), подписи долгот — у верхней кромки, широт — у левой.
// Bearing/pitch заблокированы в 0, поэтому getBounds() — точный прямоугольник.
function updateGrid(map) {
    const src = map.getSource(GRID_ID);
    if (!src) return;
    const feats = [];
    if (S.gridOn) {
        const z = map.getZoom();
        const step = gridStepFor(z);
        const b = map.getBounds();
        const mx = (b.getEast() - b.getWest()) * 0.18, my = (b.getNorth() - b.getSouth()) * 0.18;
        const W = Math.max(EUROPE_BOUNDS[0][0], b.getWest() - mx);
        const E = Math.min(EUROPE_BOUNDS[1][0], b.getEast() + mx);
        const Sd = Math.max(EUROPE_BOUNDS[0][1], b.getSouth() - my);
        const Nd = Math.min(EUROPE_BOUNDS[1][1], b.getNorth() + my);
        if (E > W && Nd > Sd) {
            const topLat = Math.min(EUROPE_BOUNDS[1][1], b.getNorth());
            const leftLng = Math.max(EUROPE_BOUNDS[0][0], b.getWest());
            const inY = (Nd - Sd) * 0.035, inX = (E - W) * 0.02;
            const line = (coords, label) => feats.push({
                type: 'Feature', properties: label ? { label } : {},
                geometry: { type: 'LineString', coordinates: coords }
            });
            const pt = (lng, lat, label) => feats.push({
                type: 'Feature', properties: { label },
                geometry: { type: 'Point', coordinates: [lng, lat] }
            });
            for (let i = Math.ceil(W / step); i * step <= E + 1e-9; i++) {
                const x = Math.round(i * step * 1e6) / 1e6;
                line([[x, Sd], [x, Nd]]);
                if (x >= b.getWest() && x <= b.getEast()) pt(x, topLat - inY, fmtDeg(x, false));
            }
            for (let i = Math.ceil(Sd / step); i * step <= Nd + 1e-9; i++) {
                const y = Math.round(i * step * 1e6) / 1e6;
                line([[W, y], [E, y]]);
                if (y >= b.getSouth() && y <= b.getNorth()) pt(leftLng + inX, y, fmtDeg(y, true));
            }
        }
    }
    try { src.setData({ type: 'FeatureCollection', features: feats }); } catch (e) { }
}

function setGridUser(map, on) {
    S.gridOn = !!on;
    const p = loadPrefs(); p.gridOn = S.gridOn; savePrefs(p);
    updateGrid(map);
    syncGridBtn();
}

function syncPolitical(map) {
    // ждём любой применённый стиль, не isStyleLoaded(): тайлы рельефа/спутника
    // могут висеть вечно (медленная сеть, скрытая вкладка), а тёмный стиль вообще
    // удалённый и без ef-bg
    const st = map.getStyle();
    if (!st || !st.layers || !st.layers.length) return;
    const C = window.EF_COUNTRIES;
    if (!C) return;
    const th = politicalSpec();
    try {
        ensurePaperImages(map);

        // tolerance geojson-vt по умолчанию 0.375 съедает микроизгибы границ:
        // на городском зуме берег и межа выглядели ломаными. 0.05 держит почти
        // все вершины исходных геоджесонов — граница детализирована до пикселя
        if (!map.getSource('ef-countries')) map.addSource('ef-countries', { type: 'geojson', data: C, tolerance: 0.05, buffer: 64 });
        if (!map.getSource('ef-mask')) map.addSource('ef-mask', { type: 'geojson', data: maskFeature() });
        if (!map.getSource('ef-frame')) map.addSource('ef-frame', { type: 'geojson', data: frameFeature() });
        if (!map.getSource('ef-lakes') && window.EF_LAKES) map.addSource('ef-lakes', { type: 'geojson', data: window.EF_LAKES });
        if (!map.getSource('ef-regions') && window.EF_REGIONS) map.addSource('ef-regions', { type: 'geojson', data: window.EF_REGIONS, tolerance: 0.05, buffer: 64 });
        if (!map.getSource('ef-coast') && window.EF_COAST) map.addSource('ef-coast', { type: 'geojson', data: window.EF_COAST, tolerance: 0.05, buffer: 64 });
        // сухопутные границы (рёбра OSM с ≥2 владельцами): только на них ложится
        // тёплый политический кейсинг. Берег (1 владелец) получает морскую кромку
        if (!map.getSource('ef-border-land') && window.EF_BORDER_LAND) map.addSource('ef-border-land', { type: 'geojson', data: window.EF_BORDER_LAND, tolerance: 0.05, buffer: 64 });
        if (!map.getSource(GRID_ID)) map.addSource(GRID_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.2, buffer: 16 });

        if (!map.getLayer(PAPER_ID)) map.addLayer({
            id: PAPER_ID, type: 'fill', source: 'ef-frame',
            paint: { 'fill-pattern': 'ef-paper-sea', 'fill-opacity': th.sheetOpacity }
        });
        if (map.getSource('ef-coast') && !map.getLayer(COAST_ID)) map.addLayer({
            id: COAST_ID, type: 'line', source: 'ef-coast',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': th.coastColor,
                'line-width': th.coastWidth,
                'line-blur': th.coastBlur,
                'line-opacity': th.coastOpacity
            }
        });
        if (!map.getLayer(MASK_ID)) map.addLayer({
            id: MASK_ID, type: 'fill', source: 'ef-mask',
            paint: { 'fill-color': th.maskColor, 'fill-opacity': th.maskOpacity }
        });
        if (!map.getLayer(LAND_ID)) map.addLayer({
            id: LAND_ID, type: 'fill', source: 'ef-countries',
            layout: { visibility: th.land },
            paint: { 'fill-pattern': 'ef-paper-land', 'fill-opacity': th.landOpacity }
        });
        if (!map.getLayer(FILL_ID)) map.addLayer({
            id: FILL_ID, type: 'fill', source: 'ef-countries',
            paint: { 'fill-color': th.fillColor, 'fill-opacity': th.fillOpacity }
        });
        if (map.getSource('ef-lakes') && !map.getLayer(LAKE_ID)) map.addLayer({
            id: LAKE_ID, type: 'fill', source: 'ef-lakes',
            layout: { visibility: th.lakes },
            paint: { 'fill-color': '#a9bcb9', 'fill-opacity': 0.92 }
        });
        if (map.getSource('ef-lakes') && !map.getLayer(LAKE_LINE_ID)) map.addLayer({
            id: LAKE_LINE_ID, type: 'line', source: 'ef-lakes',
            layout: { visibility: th.lakes },
            paint: { 'line-color': '#3f331f', 'line-width': 0.7, 'line-opacity': 0.55 }
        });
        if (map.getSource('ef-coast') && !map.getLayer(COAST_LINE_ID)) map.addLayer({
            id: COAST_LINE_ID, type: 'line', source: 'ef-coast',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': th.coastLineColor,
                'line-width': th.coastLineWidth,
                'line-opacity': th.coastLineOpacity
            }
        });
        if (!map.getLayer(BAND_ID)) map.addLayer({
            id: BAND_ID, type: 'line', source: 'ef-countries',
            filter: ['==', ['get', 'eu'], 1],
            paint: {
                'line-color': th.bandColor,
                'line-width': th.bandWidth,
                'line-offset': th.bandOffset,
                'line-opacity': th.bandOpacity
            }
        });
        if (map.getSource('ef-regions') && !map.getLayer(REGION_ID)) map.addLayer({
            id: REGION_ID, type: 'line', source: 'ef-regions',
            minzoom: 5,
            paint: {
                'line-color': th.regionColor,
                'line-width': th.regionWidth,
                'line-opacity': th.regionOpacity,
                'line-dasharray': th.regionDash
            }
        });
        // политический кейсинг — только по сухопутным границам; если файл границ
        // не загрузился, падаем обратно на контуры стран (карта не остаётся голой)
        const borderSrc = map.getSource('ef-border-land') ? 'ef-border-land' : 'ef-countries';
        if (!map.getLayer(CASE_ID)) map.addLayer({
            id: CASE_ID, type: 'line', source: borderSrc,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': th.caseColor, 'line-width': th.caseWidth, 'line-opacity': th.caseOpacity }
        });
        if (!map.getLayer(LINE_ID)) map.addLayer({
            id: LINE_ID, type: 'line', source: borderSrc,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': th.lineColor, 'line-width': th.lineWidth, 'line-opacity': th.lineOpacity }
        });
        if (!map.getLayer(HAIR_ID)) map.addLayer({
            id: HAIR_ID, type: 'line', source: borderSrc,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': th.hairColor, 'line-width': th.hairWidth, 'line-opacity': th.hairOpacity }
        });
        if (!map.getLayer(GRID_ID)) map.addLayer({
            id: GRID_ID, type: 'line', source: GRID_ID,
            layout: { 'line-cap': 'butt', 'line-join': 'round' },
            paint: {
                'line-color': th.gridColor,
                'line-width': th.gridWidth,
                'line-opacity': th.gridOpacity,
                'line-dasharray': [2.4, 2.2]
            }
        });
        if (!map.getLayer(GRID_LABEL_ID)) map.addLayer({
            id: GRID_LABEL_ID, type: 'symbol', source: GRID_ID,
            layout: {
                'text-field': ['get', 'label'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 2, 8, 6, 9.5, 10, 11],
                'text-letter-spacing': 0.04,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-padding': 0
            },
            paint: {
                'text-color': th.gridLabelColor,
                'text-halo-color': 'rgba(9,14,17,0.9)',
                'text-halo-width': 1.2,
                'text-opacity': th.gridLabelOpacity
            }
        });
        if (!map.getLayer(FRAME_ID)) map.addLayer({
            id: FRAME_ID, type: 'line', source: 'ef-frame',
            layout: { visibility: th.frame },
            paint: { 'line-color': th.frameColor, 'line-width': 1.6, 'line-opacity': 0.7 }
        });

        // подложка сменилась — слои уже созданы, обновляем тон и видимость
        const set = (id, p, v) => {
            try { if (v !== undefined) map.setLayoutProperty(id, 'visibility', v); } catch (e) { }
            for (const k in p) { try { map.setPaintProperty(id, k, p[k]); } catch (e) { } }
        };
        set(PAPER_ID, { 'fill-pattern': 'ef-paper-sea', 'fill-opacity': th.sheetOpacity });
        set(COAST_ID, {
            'line-color': th.coastColor, 'line-width': th.coastWidth,
            'line-blur': th.coastBlur, 'line-opacity': th.coastOpacity
        });
        set(MASK_ID, { 'fill-color': th.maskColor, 'fill-opacity': th.maskOpacity });
        set(LAND_ID, { 'fill-opacity': th.landOpacity }, th.land);
        set(FILL_ID, { 'fill-color': th.fillColor, 'fill-opacity': th.fillOpacity });
        set(LAKE_ID, {}, th.lakes);
        set(LAKE_LINE_ID, {}, th.lakes);
        set(BAND_ID, {
            'line-color': th.bandColor, 'line-width': th.bandWidth,
            'line-offset': th.bandOffset, 'line-opacity': th.bandOpacity
        });
        set(REGION_ID, {
            'line-color': th.regionColor, 'line-dasharray': th.regionDash,
            'line-width': th.regionWidth, 'line-opacity': th.regionOpacity
        });
        set(CASE_ID, { 'line-color': th.caseColor, 'line-width': th.caseWidth, 'line-opacity': th.caseOpacity });
        set(LINE_ID, { 'line-color': th.lineColor, 'line-width': th.lineWidth, 'line-opacity': th.lineOpacity });
        set(HAIR_ID, { 'line-color': th.hairColor, 'line-width': th.hairWidth, 'line-opacity': th.hairOpacity });
        set(COAST_LINE_ID, { 'line-color': th.coastLineColor, 'line-width': th.coastLineWidth, 'line-opacity': th.coastLineOpacity });
        set(GRID_ID, { 'line-color': th.gridColor, 'line-width': th.gridWidth, 'line-opacity': th.gridOpacity });
        set(GRID_LABEL_ID, { 'text-color': th.gridLabelColor, 'text-opacity': th.gridLabelOpacity });
        set(FRAME_ID, { 'line-color': th.frameColor }, th.frame);

        orderLayers(map);
        updateGrid(map);
    } catch (e) {
        // молча проглоченный исключение = пустая политическая карта без всякой
        // зацепки; наружу не выпускаем, но в консоль выводим
        try { console.warn('[ef] syncPolitical:', e && e.message, e && e.stack && e.stack.split('\n')[1]); } catch (err) { }
    }
}


/* ------------------------------ HUD ------------------------------ */

const $ = id => document.getElementById(id);

function syncReliefBtn() {
    const on = S.is3d ? S.relief3d !== false : S.reliefFlat === true;
    const b = $('btn-relief');
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function syncGridBtn() {
    const b = $('btn-grid');
    if (!b) return;
    b.classList.toggle('active', S.gridOn);
    b.setAttribute('aria-pressed', S.gridOn ? 'true' : 'false');
}
function syncModeUI() {
    const b = $('btn-3d');
    b.classList.toggle('active', S.is3d);
    b.setAttribute('aria-pressed', S.is3d ? 'true' : 'false');
    $('readout').classList.toggle('is3d', S.is3d);
    $('ro-mode').textContent = S.is3d ? '3D' : 'ПЛОСКАЯ';
    syncReliefBtn();
}

function wireHud(map) {
    syncModeUI();
    syncGridBtn();

    $('btn-relief').addEventListener('click', () => {
        const on = S.is3d ? S.relief3d !== false : S.reliefFlat === true;
        setReliefUser(map, !on);
    });
    $('btn-3d').addEventListener('click', () => set3D(map, !S.is3d));
    const bg = $('btn-grid');
    if (bg) bg.addEventListener('click', () => setGridUser(map, !S.gridOn));

    const legend = show => {
        $('legend').hidden = !show;
        $('btn-legend').classList.toggle('active', show);
        $('btn-legend').setAttribute('aria-pressed', show ? 'true' : 'false');
    };
    $('btn-legend').addEventListener('click', () => legend($('legend').hidden));
    $('legend-close').addEventListener('click', () => legend(false));

    $('nav-in').addEventListener('click', () => map.easeTo({ zoom: Math.min(map.getMaxZoom(), map.getZoom() + 1), duration: 420 }));
    $('nav-out').addEventListener('click', () => map.easeTo({ zoom: Math.max(map.getMinZoom(), map.getZoom() - 1), duration: 420 }));
    $('nav-home').addEventListener('click', () => {
        const pad = docMobile() ? 14 : 30;
        const fit = () => {
            try { map.stop(); map.fitBounds(EUROPE_BOUNDS, { padding: pad, duration: 900, pitch: 0, bearing: 0 }); } catch (e) { }
        };
        try { map.stop(); } catch (e) { }
        if (S.is3d) set3D(map, false, fit); else fit();
    });
    $('nav-compass').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 450 }));
    $('fatal-reload').addEventListener('click', () => location.reload());

    // показания камеры + компас, не чаще кадра
    let roRaf = 0;
    const updateReadout = () => {
        roRaf = 0;
        try {
            const c = map.getCenter();
            $('ro-coords').textContent =
                'Ш ' + c.lat.toFixed(2) + '° · Д ' + c.lng.toFixed(2) + '°';
            $('ro-zoom').textContent = 'Z ' + map.getZoom().toFixed(1);
            const brg = map.getBearing();
            const comp = $('nav-compass');
            const show = Math.abs(brg) > 0.5;
            comp.hidden = !show;
            if (show) $('compass-needle').style.transform = 'rotate(' + (-brg) + 'deg)';
        } catch (e) { }
    };
    map.on('move', () => { if (!roRaf) roRaf = requestAnimationFrame(updateReadout); });
    updateReadout();
}

/* ------------------------------ стартовая завіса ------------------------------ */

function bootSequence(map) {
    const boot = $('boot');
    const fill = $('boot-fill');
    const pct = $('boot-pct');
    const state = $('boot-state');
    let done = false;
    const setP = (p, txt) => {
        if (done) return;
        fill.style.width = p + '%';
        pct.textContent = Math.round(p) + '%';
        if (txt) state.textContent = txt;
    };
    const finish = () => {
        if (done) return;
        setP(100, 'ГОТОВО');
        done = true;
        setTimeout(() => boot.classList.add('off'), 220);
        setTimeout(() => { boot.style.display = 'none'; }, 900);
    };
    setP(8, 'ПОДЛОЖКА');

    let reliefStarted = false;
    const startRelief = () => {
        if (reliefStarted) return;
        reliefStarted = true;
        setP(72, 'РЕЛЬЕФ');
        reliefArm(map);
        // ждём и DEM-тайлы, и реальные кадры — завіса падает на готовой карте
        const waitIdle = () => {
            if (done) return;
            const demReady = !map.getSource(DEM_ID) || map.isSourceLoaded(DEM_ID);
            if (demReady && map._efFrames > 2 && !map.isMoving()) { finish(); return; }
            setTimeout(waitIdle, 200);
        };
        waitIdle();
    };

    map.once('load', () => {
        setP(45, 'ПОДЛОЖКА');
        const satReady = () => {
            if (map.isSourceLoaded('sat')) startRelief();
            else setTimeout(satReady, 150);
        };
        satReady();
    });

    // watchdog: скрытая вкладка не грузит стиль, Opera GX может резать сеть —
    // завіса не имеет права висеть вечно
    setTimeout(() => { startRelief(); }, 6000);
    setTimeout(() => { finish(); }, 14000);
}

/* ------------------------------ запуск ------------------------------ */

function start() {
    try {
        const map = createMap();
        wireHud(map);
        bootSequence(map);
        const labels = window.EF_LABELS ? window.EF_LABELS.attach(map) : null;
        // смена подложки/стиля может сбросить слои — пересобираем, только если
        // политической разметки реально нет (setPaintProperty сам триггерит styledata)
        const resync = () => { if (!map.getLayer('ef-country-line')) syncPolitical(map); };
        map.on('load', resync);
        map.on('styledata', resync);
        // сетка привязана к географии — пан/зум тянет её сам; пересобираем охват
        // и шаг под новый кадр только на moveend (дёшево, без per-frame работы)
        map.on('moveend', () => updateGrid(map));
        map.on('error', e => {
            try { console.warn('[ef]', e && e.error ? e.error.message : e); } catch (err) { }
        });
        // отладка из консоли, без видимых чипов на карте
        window.EF = {
            map, S, renderPerf,
            device: () => ({ tier: deviceTier(), gpu: gpuInfo().renderer, mobile: docMobile(), lowEnd: lowEndDevice() }),
            reliefProfile, reliefEx: () => S.ex,
            set3D: on => set3D(map, on),
            setRelief: on => setReliefUser(map, on),
            bounds: EUROPE_BOUNDS,
            order: () => orderLayers(map),
            syncPolitical: () => syncPolitical(map),
            setGrid: on => setGridUser(map, on),
            grid: () => S.gridOn,
            labels: () => labels && labels.stats()
        };
    } catch (e) {
        gfxFail('Не удалось создать карту: ' + (e && e.message ? e.message : e));
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

})();