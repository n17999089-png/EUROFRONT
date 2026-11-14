/* EUROFRONT — чистая геометрия войны (без DOM): ось наступления от общей границы
   к столице врага, линия фронта, оккупация как пересечение страны с областью за
   фронтом, регионы-вороные. Всё считается в локальных координатах (долгота
   масштабируется cos широты), поэтому фронт не «плывёт» на севере. */
(() => {
'use strict';
const T = () => (typeof turf !== 'undefined' ? turf : window.turf);

const centroid = f => T().centroid(f).geometry.coordinates;
const areaKm2 = f => (f ? T().area(f) / 1e6 : 0);

function ringsOf(f) {
    return f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
}

// ось: C — точка границы врага, ближайшая к центру атакующего; цель — столица врага.
// sectorCount — число секторов фронта (N в game.js), от него зависит шаг лучей
function makeAxis(pf, ef, capital, sectorCount) {
    const SECT = Math.max(4, sectorCount || 40);
    const t = T();
    const p = centroid(pf), e = centroid(ef);
    // точка входа луча «центр атакующего → центр врага» в страну врага:
    // от неё фронт стартует с нулевой оккупацией
    let C = null;
    const steps = 240;
    for (let i = 1; i <= steps; i++) {
        const q = [p[0] + (e[0] - p[0]) * i / steps, p[1] + (e[1] - p[1]) * i / steps];
        if (t.booleanPointInPolygon(t.point(q), ef)) { C = q; break; }
    }
    if (!C) {
        let best = 1e9;
        for (const ring of ringsOf(ef)) for (const pt of ring) {
            const d = Math.hypot(pt[0] - p[0], pt[1] - p[1]);
            if (d < best) { best = d; C = pt; }
        }
    }
    if (!C) C = e;
    const target = capital || e;
    const lat = (C[1] + target[1]) / 2, k = Math.cos(lat * Math.PI / 180) || 1;
    let ax = (target[0] - C[0]) * k, ay = target[1] - C[1];
    const len = Math.hypot(ax, ay) || 1; ax /= len; ay /= len;
    const perp = [-ay, ax];
    // Ширина фронта — поперечник СТРАНЫ ВРАГА вокруг оси наступления, а не поперечник
    // атакующего: bbox России через меридиан растягивал фронт на 48°, кольцо оккупации
    // самопересекалось и turf.intersect давал null — тёмно-красных земель не было видно.
    // mid — центр поперечника: страна почти никогда не симметрична относительно оси.
    const D = Math.hypot((target[0] - C[0]) * k, target[1] - C[1]) || 1;
    let pmin = 1e9, pmax = -1e9, amin = 1e9, amax = -1e9;
    for (const ring of ringsOf(ef)) for (const pt of ring) {
        const lx = (pt[0] - C[0]) * k, ly = pt[1] - C[1];
        const pp = lx * perp[0] + ly * perp[1];
        const al = lx * ax + ly * ay;
        if (pp < pmin) pmin = pp;
        if (pp > pmax) pmax = pp;
        if (al < amin) amin = al;
        if (al > amax) amax = al;
    }
    const mid = (pmin + pmax) / 2;
    const W = Math.max(pmax - pmin, 3);
    const at = (a, pp) => [C[0] + (a * ax + pp * perp[0]) / k, C[1] + a * ay + pp * perp[1]];

    // Глубина фронта по секторам. Луч, перпендикулярный оси наступления, входит в
    // страну врага не у столицы, а там, где реально начинается граница: entry —
    // линия соприкосновения при t=0, exit — дальний край страны при t=1.
    // С «одной базовой линией» было хуже вдвойне: первые 40% наступления не
    // занимали ничего (фронт стартовал в сотнях км за границей), а оккупация
    // под конец дорастала лишь до половины страны.
    const lo = amin - W * 0.05, hi = amax + W * 0.05;
    const entry = [], exit = [];
    for (let i = 0; i <= SECT; i++) {
        const r = rayDepths(t, ef, at, mid + (i / SECT - 0.5) * W, lo, hi);
        entry.push(r && r[0] !== null ? r[0] : null);
        exit.push(r ? r[1] : null);
    }
    // сектор над морём глубины не имеет: тянем её от соседа, иначе кольцо оккупации
    // режет страну клином от пустого луча к живой границе
    for (let i = 0; i <= SECT; i++) {
        if (entry[i] !== null) continue;
        for (let d = 1; d <= SECT; d++) {
            const a = i - d, b = i + d;
            if (a >= 0 && entry[a] !== null) { entry[i] = entry[a]; exit[i] = exit[a]; break; }
            if (b <= SECT && entry[b] !== null) { entry[i] = entry[b]; exit[i] = exit[b]; break; }
        }
        if (entry[i] === null) { entry[i] = lo; exit[i] = hi; }
    }
    // столица стоит на оси (pp = 0), а не на середине фронта: сектор и момент её
    // падения считаем от её собственной глубины D
    const fcap = Math.max(0, Math.min(1, (0 - mid) / W + 0.5));
    const e20 = depthAt(entry, fcap), x20 = depthAt(exit, fcap);
    return {
        p, e, C, target, ax, ay, perp, k, W, mid, D, at,
        entry, exit, sect: SECT,
        capT: Math.max(0.05, Math.min(1, (D - e20) / (x20 - e20 || 1))),
        capSector: Math.round(fcap * SECT),
        base: at(Math.min(0, ...entry), mid), tip: at(Math.max(D, ...exit), mid),
        big: Math.max(0, -Math.min(...entry)) + W * 0.5 + 1, bbox: t.bbox(ef)
    };
}

// луч pp = const сквозь страну врага: [глубина входа, глубина выхода] или null
const RAY_S = 30, RAY_Q = 6;
function rayDepths(t, ef, at, pp, lo, hi) {
    const step = (hi - lo) / RAY_S;
    const ins = [];
    for (let s = 0; s <= RAY_S; s++) ins.push(t.booleanPointInPolygon(t.point(at(lo + step * s, pp)), ef));
    // сходимся к границе: lo-сторона сохраняет своё «внутри/снаружи»
    const cross = (a, b, aIn) => {
        for (let q = 0; q < RAY_Q; q++) {
            const m = (a + b) / 2;
            if (t.booleanPointInPolygon(t.point(at(m, pp)), ef) === aIn) a = m; else b = m;
        }
        return a;
    };
    let entry = null, exit = null;
    for (let s = 1; s <= RAY_S; s++) {
        if (ins[s] === ins[s - 1]) continue;
        const x = cross(lo + step * (s - 1), lo + step * s, ins[s - 1]);
        if (ins[s]) { if (entry === null) entry = x; exit = null; }
        else exit = x;
    }
    if (ins[0] && entry === null) entry = lo;
    if (ins[RAY_S] && exit === null) exit = hi;
    return entry === null ? null : [entry, exit];
}

const depthAt = (arr, frac) => {
    const n = arr.length - 1, x = Math.max(0, Math.min(1, frac)) * n;
    const i0 = Math.floor(x), i1 = Math.min(n, i0 + 1);
    return arr[i0] + (arr[i1] - arr[i0]) * (x - i0);
};

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const noise = (i, seed) => Math.sin(i * 1.31 + seed) * 0.55 + Math.sin(i * 0.47 + seed * 2.1) * 0.45;

// tArr — глубина наступления по секторам (0 = граница, 1 = дальний край страны),
// phase — фаза «живой» линии (радианы, можно от таймстампа). Шум идёт вдоль оси
// наступления, а не поперёк: поперечные шаги монотонны и кольцо оккупации
// не самопересекается.
function frontLine(axis, tArr, seed, phase) {
    const n = tArr.length - 1;
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const f = i / n;
        const e = depthAt(axis.entry, f), x = depthAt(axis.exit, f);
        const j = noise(i, seed) * 0.03 + Math.sin(i * 0.9 + (phase || 0)) * 0.01;
        const t = Math.max(0, Math.min(1, tArr[i] + j));
        pts.push(axis.at(e + (x - e) * t, axis.mid + (f - 0.5) * axis.W));
    }
    return pts;
}

// оставляем лишь тот участок линии, что идёт по стране врага
function clipLineToPolygon(line, feat) {
    const t = T();
    const inside = line.map(pt => t.booleanPointInPolygon(t.point(pt), feat));
    let first = -1, last = -1;
    for (let i = 0; i < inside.length; i++) if (inside[i]) { if (first < 0) first = i; last = i; }
    if (first < 0) return line;
    const a = Math.max(0, first - 1), b = Math.min(line.length - 1, last + 1);
    return line.slice(a, b + 1);
}

// оккупация = страна врага ∩ область «позади» фронта (со стороны атакующего)
function occupiedPoly(axis, tArr, enemyFeat, seed) {
    const t = T();
    const pts = frontLine(axis, tArr, seed, 0);
    const m = axis.mid || 0, half = axis.W / 2 + axis.W * 0.1;
    const bp = axis.at(-axis.big, m + half);
    const bm = axis.at(-axis.big, m - half);
    const ring = [...pts, bp, bm, pts[0]];
    let occ = null;
    try { occ = t.intersect(enemyFeat, t.polygon([ring])); } catch (e) { occ = null; }
    return occ;
}

// регионы врага — настоящие admin-1 из regions.js (см. game.js: loadRegions)

// вероятность принятия договора ИИ: спрос против реально занятого и счёта войны
function aiChance(s) {
    const base = 18 + s.warScore * 0.45 + s.occupiedFrac * 30 +
        (s.capitalCaptured ? 22 : 0) + (100 - s.enemyWill) * 0.15;
    const c = base - s.demandFrac * 55 - s.overFrac * 130;
    return Math.max(2, Math.min(97, Math.round(c)));
}

const api = { centroid, areaKm2, makeAxis, frontLine, clipLineToPolygon, occupiedPoly, lerp, aiChance };
const G = (typeof self !== 'undefined' ? self : globalThis);
G.EFG = api;
if (typeof module !== 'undefined') module.exports = api;
})();