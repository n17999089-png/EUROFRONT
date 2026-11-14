// Плотный список населённых пунктов Европы: GeoNames cities500 + русские названия.
// Вход:  scripts/data/cities500.txt, scripts/data/places.geojson (50m — эталонные NAME_RU)
// Выход: assets/places.js  ->  self.EF_PLACES = [[lng, lat, pop, cap, имя, cc], ...]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'data', 'cities500.txt');
const NE50 = path.join(ROOT, 'scripts', 'data', 'places.geojson');

const B = [-25.5, 33.2, 46.5, 72.2];
const CC = new Set(('AD AL AT BA BE BG CH CY CZ DE DK EE ES FI FR GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA ' +
    'XK RU BY TR MA DZ TN GE AM AZ').split(' '));
const CLASSES = /^(PPL|PPLC|PPLA|PPLA2|PPLA3|PPLA4|PPLCH|PPLF|PPLG|PPLL|PPLR|PPLS|PPLX|STLMT|LGN)$/;
const RU_LETTERS = /^[\u0410-\u044FёЁ][\u0410-\u044FёЁ\s.'’\-]{1,33}$/;

/* ---------- выбор кириллического варианта: транслитерация против латинского имени ---------- */

const TR = [['щ', 'shch'], ['ш', 'sh'], ['щ', 'sh'], ['ч', 'ch'], ['ж', 'zh'], ['х', 'kh'], ['ц', 'ts'],
['ю', 'yu'], ['я', 'ya'], ['ё', 'yo'], ['э', 'e'], ['ы', 'y'], ['ь', ''], ['ъ', ''], ['й', 'y']];
const SINGLE = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f' };

function translit(s) {
    let out = '', x = s.toLowerCase();
    for (let i = 0; i < x.length; i++) {
        let hit = null;
        for (const [k, v] of TR) if (x.startsWith(k, i)) { hit = [k, v]; break; }
        if (hit) { out += hit[1]; i += hit[0].length - 1; continue; }
        const c = x[i];
        out += SINGLE[c] !== undefined ? SINGLE[c] : (/[a-z]/.test(c) ? c : '');
    }
    return out;
}

function lev(a, b) {
    const n = b.length, m = a.length;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        const t = prev; prev = cur; cur = t;
    }
    return prev[n];
}

const LATIN_CORE = /[-'’\s]/g;
function words(s) {
    return (s || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/[\s'-]+/)
        .filter(w => w.length > 2 && !/^(saint|st|city|of|the|el|al|isl|nab|rajs|shah|ban|mun|kota|jila)$/i.test(w));
}

// оценка: минимальное расстояние Лева между транслитом кандидата и словами латинского имени
function score(cand, latin) {
    const t = translit(cand);
    if (!t) return 99;
    const ws = latin.length ? latin : [t];
    let best = 99;
    for (const w of ws) {
        const d = lev(t, w.replace(LATIN_CORE, '')) / Math.max(t.length, w.length, 3);
        if (d < best) best = d;
    }
    return best;
}

/* ---------- эталонные русские имена из Natural Earth 50m ---------- */

const ruRef = [];   // {lng, lat, cc, ru}
try {
    const ne = JSON.parse(fs.readFileSync(NE50, 'utf8'));
    for (const f of ne.features) {
        const p = f.properties || {};
        const ru = p.NAME_RU || p.name_ru;
        if (!ru || !RU_LETTERS.test(ru.trim())) continue;
        const c = f.geometry && f.geometry.coordinates;
        if (!c) continue;
        ruRef.push({ lng: c[0], lat: c[1], cc: p.ISO_A2 || '', ru: ru.trim() });
    }
} catch (e) { console.log('NE50 пропущен:', e.message); }

const refGrid = new Map();
const cell = (lng, lat) => Math.floor(lng) + ':' + Math.floor(lat);
for (const r of ruRef) {
    const k = cell(r.lng, r.lat);
    if (!refGrid.has(k)) refGrid.set(k, []);
    refGrid.get(k).push(r);
}
function refNear(lng, lat, cc, lw) {
    let best = null, bd = 0.18;      // ~20 км: тот же город, а не соседняя деревня
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const a = refGrid.get(Math.floor(lng + dx) + ':' + Math.floor(lat + dy));
        if (!a) continue;
        for (const r of a) {
            if (r.cc && cc && r.cc !== cc) continue;
            // имя обязано совпадать: иначе деревня у мегаполиса получит его имя
            if (score(r.ru, lw) >= 0.34) continue;
            const d = Math.hypot((r.lng - lng) * 0.7, r.lat - lat);
            if (d < bd) { bd = d; best = r; }
        }
    }
    return best;
}

/* ---------- основной проход ---------- */

const out = [];
const seen = new Set();
const ids = {};                              // geonameid -> индекс в out

for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (!CC.has(f[8]) || f[6] !== 'P' || !CLASSES.test(f[7])) continue;
    const lat = +f[4], lng = +f[5];
    if (lng < B[0] || lng > B[2] || lat < B[1] || lat > B[3]) continue;
    const pop = +f[14] || 0;
    // 500 жителей — это уже село: на городском зуме игрок требует видеть все
    // окрестные деревни, а не только города
    if (pop < 500) continue;

    const local = (f[1] || f[2] || '').trim();
    const lw = words((f[2] || '') + ' ' + local);
    let ru = null, bs = 0.34;
    for (const raw of (f[3] || '').split(',')) {
        const t = raw.trim();
        if (!RU_LETTERS.test(t)) continue;
        const s = score(t, lw);
        if (s < bs) { bs = s; ru = t; }
    }
    const ref = refNear(lng, lat, f[8], lw);
    const name = (ref ? ref.ru : ru) || local;
    if (!name) continue;

    const key = name + '|' + Math.round(lng * 160) + '|' + Math.round(lat * 160);
    if (seen.has(key)) continue;
    seen.add(key);

    ids[f[0]] = out.length;
    out.push([+lng.toFixed(4), +lat.toFixed(4), pop,
    f[7] === 'PPLC' ? 1 : (f[7] === 'PPLA' || f[7] === 'PPLA2' ? 2 : 0),
    name.replace(/\s+/g, ' ').slice(0, 30), f[8], f[0]]);
}

out.sort((a, b) => b[2] - a[2]);

// точные русские названия из alternateNamesV2 (isolanguage=ru) — главный источник
const IDKEY = {};
out.forEach((p, i) => { IDKEY[p[6]] = i; });
try {
    const tag = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'ru-names.json'), 'utf8'));
    let hit = 0;
    for (const id in tag) {
        const i = IDKEY[id];
        const v = (tag[id] || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        if (i === undefined || !v) continue;
        if (out[i][4] !== v) { out[i][4] = v; hit++; }
    }
    console.log('ru-names применено', hit);
} catch (e) { console.log('ru-names нет:', e.message); }

fs.writeFileSync(path.join(ROOT, 'scripts', 'data', 'place-ids.json'), JSON.stringify(IDKEY));
// geonameid в файле не хранится — только в place-ids.json для пересборки имён
out.forEach(p => { p.length = 6; });

const body = JSON.stringify(out);
fs.writeFileSync(path.join(ROOT, 'assets', 'places.js'), 'self.EF_PLACES=' + body + ';');
console.log('places', out.length, 'MB', (body.length / 1048576).toFixed(2),
    'cyrillic', Math.round(out.filter(p => /[Ѐ-ӿ]/.test(p[4])).length / out.length * 100) + '%');

console.log('топ-16 по населению:');
out.slice(0, 16).forEach(p => console.log(' ', p[4], '|', p[5], p[2]));
