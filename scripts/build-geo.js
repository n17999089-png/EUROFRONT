// EUROFRONT — подробные геоданные Европы: страны (10m) + тон/свечение/точка подписи,
// регионы (10m admin-1), озёра (10m). Населённые пункты — в build-places.js.
const fs = require('fs');
const path = require('path');
const turf = require('../assets/vendor/turf.min.js');

const BOUNDS = [-25.5, 33.5, 46.0, 72.0];
const clipPoly = turf.bboxPolygon(BOUNDS);
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'data/' + f), 'utf8'));

// цвет страны по английскому имени (Natural Earth NAME); #5c5346 — соседи вне театра
const COLOR = {
    'Russia': '#3e9b63', 'Ukraine': '#f2c94c', 'Belarus': '#86b06b', 'Poland': '#d95f43',
    'Germany': '#8d99ae', 'France': '#4f7fd9', 'Spain': '#e0a437', 'Portugal': '#2a9d8f',
    'Italy': '#58b368', 'United Kingdom': '#b0567a', 'Ireland': '#43aa8b', 'Norway': '#577590',
    'Sweden': '#4d9de0', 'Finland': '#7fb3d5', 'Denmark': '#c0576f', 'Netherlands': '#e76f51',
    'Belgium': '#f4a261', 'Luxembourg': '#9bc53d', 'Switzerland': '#d64550', 'Austria': '#e9c46a',
    'Czechia': '#7d6b9e', 'Slovakia': '#6a8caf', 'Hungary': '#b56576', 'Romania': '#e9a13b',
    'Bulgaria': '#6a994e', 'Greece': '#4cc9f0', 'Turkey': '#c1666b', 'Serbia': '#9d5c63',
    'Croatia': '#5f8fb4', 'Bosnia and Herz.': '#8a7f5c', 'Montenegro': '#a26769', 'Albania': '#b5838d',
    'Macedonia': '#d9a441', 'Slovenia': '#79a37f', 'Estonia': '#6d9dc5', 'Latvia': '#9e6b7f',
    'Lithuania': '#a3b18a', 'Moldova': '#c9a227', 'Iceland': '#a8dadc', 'Kosovo': '#b08968',
    'Cyprus': '#d4a373', 'Malta': '#e5989b', 'Andorra': '#9a8c98', 'Monaco': '#c9ada7',
    'San Marino': '#a5a58d', 'Liechtenstein': '#b7b7a4', 'Vatican': '#ddbea9',
    'Faeroe Is.': '#84a98c', 'Isle of Man': '#9c89b8', 'Åland': '#83c5be',
    'Morocco': '#5c5346', 'Algeria': '#5c5346', 'Tunisia': '#5c5346', 'Libya': '#5c5346',
    'Egypt': '#5c5346', 'Syria': '#5c5346', 'Iraq': '#5c5346', 'Georgia': '#5c5346',
    'Armenia': '#5c5346', 'Azerbaijan': '#5c5346', 'Kazakhstan': '#5c5346', 'Iran': '#5c5346'
};
const EU = new Set(Object.keys(COLOR).filter(k => COLOR[k] !== '#5c5346'));

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
// внутреннее свечение: тёмный тон собственного цвета страны
const glowOf = c => mix(hex(c), hex('#1d1408'), 0.62);

/* ---------- анти-меридиан + обрезка к рамке Европы ---------- */

function clipCountry(geom) {
    const rawPolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const kept = [];
    for (let rings of rawPolys) {
        let bb = turf.bbox(turf.polygon(rings));
        if (bb[0] < -90 && bb[2] > 90) {
            rings = rings.map(([x, y]) => [x < 0 ? x + 360 : x, y]);
            bb = turf.bbox(turf.polygon(rings));
        }
        if (bb[2] < BOUNDS[0] || bb[0] > BOUNDS[2] || bb[3] < BOUNDS[1] || bb[1] > BOUNDS[3]) continue;
        if (bb[0] >= BOUNDS[0] && bb[2] <= BOUNDS[2] && bb[1] >= BOUNDS[1] && bb[3] <= BOUNDS[3]) { kept.push(rings); continue; }
        let piece; try { piece = turf.intersect(turf.polygon(rings), clipPoly); } catch (e) { piece = null; }
        if (piece && piece.geometry) {
            const g = piece.geometry;
            if (g.type === 'Polygon') kept.push(g.coordinates);
            else if (g.type === 'MultiPolygon') kept.push(...g.coordinates);
        }
    }
    return kept.length ? turf.multiPolygon(kept) : null;
}

// точка подписи: центроид самого большого кольца, при промахе — сетка внутри полигона
function ringCentroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (!a) return ring[0];
    return [cx / a / 3, cy / a / 3];
}
function labelPoint(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    let best = null, ba = -1;
    for (const p of polys) {
        const a = Math.abs(turf.area(turf.polygon([p[0]])));
        if (a > ba) { ba = a; best = p; }
    }
    const c = ringCentroid(best[0]);
    const q = turf.point([0, 0]);
    const inside = pt => {
        q.coordinates = pt;
        for (const p of polys) {
            if (!turf.booleanPointInPolygon(q, turf.polygon([p[0]]))) continue;
            let hole = false;
            for (let i = 1; i < p.length; i++) if (turf.booleanPointInPolygon(q, turf.polygon([p[i]]))) { hole = true; break; }
            if (!hole) return true;
        }
        return false;
    };
    if (inside(c)) return [+c[0].toFixed(3), +c[1].toFixed(3)];
    const bb = turf.bbox(turf.multiPolygon(polys));
    let bp = null, bd = 1e9;
    for (let i = 0; i <= 48; i++) for (let k = 0; k <= 48; k++) {
        const pt = [bb[0] + (bb[2] - bb[0]) * i / 48, bb[1] + (bb[3] - bb[1]) * k / 48];
        if (!inside(pt)) continue;
        const d = Math.hypot(pt[0] - c[0], pt[1] - c[1]);
        if (d < bd) { bd = d; bp = pt; }
    }
    return bp ? [+bp[0].toFixed(3), +bp[1].toFixed(3)] : [+c[0].toFixed(3), +c[1].toFixed(3)];
}

/* ------------------------------ страны ------------------------------ */

// Геометрия — полные OSM-полигоны (polygons.openstreetmap.fr): общие границы
// соседних стран идут по одним way-узлам, поэтому контуры совпадают вершина-в-вершину.
// Natural Earth остаётся источником русских имён и запасной геометрией (Аланды).
const NAME_ISO = {
    'Russia': 'RUS', 'Ukraine': 'UKR', 'Belarus': 'BLR', 'Poland': 'POL', 'Germany': 'DEU',
    'France': 'FRA', 'Spain': 'ESP', 'Portugal': 'PRT', 'Italy': 'ITA', 'United Kingdom': 'GBR',
    'Ireland': 'IRL', 'Norway': 'NOR', 'Sweden': 'SWE', 'Finland': 'FIN', 'Denmark': 'DNK',
    'Netherlands': 'NLD', 'Belgium': 'BEL', 'Luxembourg': 'LUX', 'Switzerland': 'CHE', 'Austria': 'AUT',
    'Czechia': 'CZE', 'Slovakia': 'SVK', 'Hungary': 'HUN', 'Romania': 'ROU', 'Bulgaria': 'BGR',
    'Greece': 'GRC', 'Turkey': 'TUR', 'Serbia': 'SRB', 'Croatia': 'HRV', 'Bosnia and Herz.': 'BIH',
    'Montenegro': 'MNE', 'Albania': 'ALB', 'Macedonia': 'MKD', 'Slovenia': 'SVN', 'Estonia': 'EST',
    'Latvia': 'LVA', 'Lithuania': 'LTU', 'Moldova': 'MDA', 'Iceland': 'ISL', 'Kosovo': 'XKX',
    'Cyprus': 'CYP', 'Malta': 'MLT', 'Andorra': 'AND', 'Monaco': 'MCO', 'San Marino': 'SMR',
    'Liechtenstein': 'LIE', 'Vatican': 'VAT', 'Faeroe Is.': 'FRO', 'Isle of Man': 'IMN', 'Åland': 'ALA',
    'Morocco': 'MAR', 'Algeria': 'DZA', 'Tunisia': 'TUN', 'Libya': 'LBY', 'Egypt': 'EGY',
    'Syria': 'SYR', 'Iraq': 'IRQ', 'Georgia': 'GEO', 'Armenia': 'ARM', 'Azerbaijan': 'AZE',
    'Kazakhstan': 'KAZ', 'Iran': 'IRN'
};
const OSM_DIR = path.join(__dirname, 'data/osm');
const osmCache = {};
function osmGeom(iso) {
    if (iso in osmCache) return osmCache[iso];
    let g = null;
    try { g = JSON.parse(fs.readFileSync(path.join(OSM_DIR, iso + '.geojson'), 'utf8')).geometry; } catch (e) { g = null; }
    osmCache[iso] = g;
    return g;
}
const round5 = ring => ring.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
// Знаковая площадь кольца (shoelace). < 0 — по часовой, > 0 — против.
function signedArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return a / 2;
}
// Внешнее кольцо — по часовой (area < 0), дырки — против (area > 0). Только при
// таком обходе положительный line-offset уходит ВНУТРЬ страны. OSM отдаёт обход
// вразнобой (DEU по часовой, POL против) — без нормализации внутренняя цветная
// полоса («светление») вылезала наружу за границу у половины стран.
function normalizeWinding(poly) {
    return poly.map((ring, idx) => {
        const a = signedArea(ring);
        const wantNeg = idx === 0;
        if ((wantNeg && a > 0) || (!wantNeg && a < 0)) return ring.slice().reverse();
        return ring;
    });
}
function roundGeom(g) {
    if (g.type === 'Polygon') g.coordinates = normalizeWinding(g.coordinates.map(round5));
    else g.coordinates = g.coordinates.map(poly => normalizeWinding(poly.map(round5)));
    return g;
}
const round4geom = g => {
    const r = ring => ring.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]);
    if (g.type === 'Polygon') g.coordinates = g.coordinates.map(r);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(poly => poly.map(r));
    return g;
};

const cg = read('ne10-countries.geojson');
const byIso = {};
const cfeats = [];
const rawForCoast = [];
for (const f of cg.features) {
    const name = f.properties.NAME;
    if (!COLOR[name]) continue;
    const iso = f.properties.ADM0_A3;
    const src = osmGeom(NAME_ISO[name] || iso) || f.geometry;
    let g = clipCountry(src);
    if (!g) continue;
    let s; try { s = turf.simplify(g, { tolerance: 0.0005, highQuality: true, mutate: true }); } catch (e) { s = g; }
    if (turf.area(s) < 8e7) continue;
    rawForCoast.push(src);
    roundGeom(s.geometry);
    const ru = f.properties.NAME_RU || name;
    byIso[iso] = { name, ru };
    cfeats.push({
        type: 'Feature',
        properties: {
            name, ru, color: COLOR[name], glow: glowOf(COLOR[name]),
            eu: EU.has(name) ? 1 : 0, lp: labelPoint(s.geometry)
        },
        geometry: s.geometry
    });
}
cfeats.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
fs.writeFileSync(path.join(__dirname, '../assets/countries.js'),
    'self.EF_COUNTRIES=' + JSON.stringify({ type: 'FeatureCollection', features: cfeats }) + ';\n');
console.log('countries', cfeats.length, 'KB', Math.round(fs.statSync(path.join(__dirname, '../assets/countries.js')).size / 1024));

/* ------------------------------ берег: тень на воде ------------------------------ */

// Общие границы соседних стран идут по одним OSM-узлам → ребро встречается в
// двух полигонах. Ребро с одним владельцем — берег (вода), с двумя — сухопутная
// граница. Собираем рёбра из ПОЛНЫХ геометрий (до simplify, пока узлы совпадают),
// цепляем в линии. Берег → тень на воде; суша → чёткая политическая граница.
function buildEdges(rawList, pick, tol, hq) {
    const inB = (x, y) => x >= BOUNDS[0] - 1 && x <= BOUNDS[2] + 1 && y >= BOUNDS[1] - 1 && y <= BOUNDS[3] + 1;
    const nk = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);
    const count = new Map(), seg = new Map();
    const eachRing = (g, fn) => {
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) for (const ring of poly) fn(ring);
    };
    for (const g of rawList) {
        if (!g) continue;
        eachRing(g, ring => {
            for (let i = 1; i < ring.length; i++) {
                const a = ring[i - 1], b = ring[i];
                if (!inB((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
                const ka = nk(a), kb = nk(b);
                if (ka === kb) continue;
                const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
                count.set(k, (count.get(k) || 0) + 1);
                if (!seg.has(k)) seg.set(k, [a, b, ka, kb]);
            }
        });
    }
    const adj = new Map(), nodePt = new Map(), keys = [];
    for (const [k, c] of count) {
        if (!pick(c)) continue;
        keys.push(k);
        const s = seg.get(k);
        nodePt.set(s[2], s[0]); nodePt.set(s[3], s[1]);
        if (!adj.has(s[2])) adj.set(s[2], []);
        if (!adj.has(s[3])) adj.set(s[3], []);
        adj.get(s[2]).push({ to: s[3], k });
        adj.get(s[3]).push({ to: s[2], k });
    }
    const used = new Set(), lines = [];
    const walk = (startKey) => {
        const out = [];
        let cur = startKey, guard = 0;
        while (guard++ < 500000) {
            const list = adj.get(cur) || [];
            let next = null;
            for (const e of list) if (!used.has(e.k)) { next = e; break; }
            if (!next) break;
            used.add(next.k);
            out.push(nodePt.get(next.to));
            cur = next.to;
        }
        return out;
    };
    for (const k0 of keys) {
        if (used.has(k0)) continue;
        used.add(k0);
        const s0 = seg.get(k0);
        const back = walk(s0[2]).reverse();
        const fwd = walk(s0[3]);
        const full = back.concat([s0[0], s0[1]], fwd);
        if (full.length >= 2) lines.push(full);
    }
    const feats = [];
    for (const ln of lines) {
        const f = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ln } };
        let s; try { s = turf.simplify(f, { tolerance: tol, highQuality: hq, mutate: true }); } catch (e) { s = f; }
        const c = s.geometry.coordinates.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
        if (c.length >= 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
    }
    return { type: 'FeatureCollection', features: feats };
}
// берег: мягкая детализация (тень размыта, узлы не важны)
const coast = buildEdges(rawForCoast, c => c === 1, 0.0025, false);
fs.writeFileSync(path.join(__dirname, '../assets/coast.js'),
    'self.EF_COAST=' + JSON.stringify(coast) + ';\n');
console.log('coast', coast.features.length, 'KB', Math.round(fs.statSync(path.join(__dirname, '../assets/coast.js')).size / 1024));
// сухопутная граница: та же детализация, что и заливка страны (0.0005 highQuality),
// чтобы кейсинг лёг точно на край полигона, без зазора на городском зуме
const landBorder = buildEdges(rawForCoast, c => c >= 2, 0.0005, true);
fs.writeFileSync(path.join(__dirname, '../assets/border-land.js'),
    'self.EF_BORDER_LAND=' + JSON.stringify(landBorder) + ';\n');
console.log('border-land', landBorder.features.length, 'KB', Math.round(fs.statSync(path.join(__dirname, '../assets/border-land.js')).size / 1024));

/* ------------------------------ регионы (admin-1) ------------------------------ */

const rg = read('ne10-regions.geojson');
const rfeats = [];
for (const f of rg.features) {
    const iso = f.properties.adm0_a3;
    const owner = byIso[iso];
    if (!owner || !EU.has(owner.name)) continue;
    if (f.properties.featurecla === 'Country') continue;
    if (!f.geometry) continue;
    let piece; try { piece = turf.intersect(turf.feature(f.geometry), clipPoly); } catch (e) { piece = null; }
    if (!piece || !piece.geometry) continue;
    // 0.012° (~1.3 км) съедал почти всю детализацию admin-1. 0.002° (~220 м)
    // держит изгибы границ регионов почти как у стран; размер гасим округлением.
    let s; try { s = turf.simplify(piece, { tolerance: 0.002, highQuality: false, mutate: true }); } catch (e) { s = piece; }
    if (turf.area(s) < 3e8) continue;
    round4geom(s.geometry);
    rfeats.push({
        type: 'Feature',
        properties: { name: f.properties.name_ru || f.properties.name_en || f.properties.name || 'Регион', country: owner.name, iso },
        geometry: s.geometry
    });
}
fs.writeFileSync(path.join(__dirname, '../assets/regions.js'),
    'self.EF_REGIONS=' + JSON.stringify({ type: 'FeatureCollection', features: rfeats }) + ';\n');
console.log('regions', rfeats.length, 'KB', Math.round(fs.statSync(path.join(__dirname, '../assets/regions.js')).size / 1024));

/* ------------------------------ озёра ------------------------------ */

const lg = read('ne10-lakes.geojson');
const lfeats = [];
const seenLake = new Set();
for (const f of lg.features) {
    if (!f.geometry) continue;
    const bb = turf.bbox(f);
    if (!bb || bb[2] < BOUNDS[0] || bb[0] > BOUNDS[2] || bb[3] < BOUNDS[1] || bb[1] > BOUNDS[3]) continue;
    let piece; try { piece = turf.intersect(turf.feature(f.geometry), clipPoly); } catch (e) { piece = null; }
    if (!piece || !piece.geometry) continue;
    let s; try { s = turf.simplify(piece, { tolerance: 0.004, highQuality: false, mutate: true }); } catch (e) { s = piece; }
    const a = turf.area(s);
    if (a < 2.2e7) continue;                       // мелкие лужи не читаются на бумаге
    const nm = (f.properties.name_ru || f.properties.name || '').trim();
    const k = nm + '|' + Math.round(bb[0] * 4) + '|' + Math.round(bb[1] * 4);
    if (seenLake.has(k)) continue;
    seenLake.add(k);
    lfeats.push({ type: 'Feature', properties: { name: nm, big: a > 4e10 ? 1 : 0 }, geometry: s.geometry });
}
fs.writeFileSync(path.join(__dirname, '../assets/lakes.js'),
    'self.EF_LAKES=' + JSON.stringify({ type: 'FeatureCollection', features: lfeats }) + ';\n');
console.log('lakes', lfeats.length, 'KB', Math.round(fs.statSync(path.join(__dirname, '../assets/lakes.js')).size / 1024));
