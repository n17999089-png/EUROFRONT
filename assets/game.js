/* EUROFRONT — игровой слой: война, анимированный фронт, оккупация, мирная
   конференция с тремя режимами аннексии и ИИ-оценкой договора.
   Вся булева геометрия — в воркере с таймаутом: главный поток не зависает. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const T = () => turf;
const G = () => window.EFG;
// currentScript живёт только во время синхронного разбора этого файла
const SELF = (document.currentScript && document.currentScript.src) ||
    new URL('assets/game.js', location.href).href;

/* ------------------------------ звук ------------------------------ */
const Sound = {
    ctx: null, master: null, on: true,
    init() {
        if (this.ctx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.5;
            this.master.connect(this.ctx.destination);
        } catch (e) { }
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); },
    setOn(on) { this.on = on; if (this.master) this.master.gain.value = on ? 0.5 : 0; },
    blip(f, dur, type, vol) {
        if (!this.on || !this.ctx) return;
        try {
            const t = this.ctx.currentTime;
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.type = type || 'square'; o.frequency.value = f;
            g.gain.setValueAtTime(vol || 0.15, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
        } catch (e) { }
    },
    click() { this.blip(880, 0.06, 'square', 0.08); },
    attack() { this.blip(160, 0.22, 'sawtooth', 0.2); this.blip(90, 0.3, 'sine', 0.25); },
    battle() { this.blip(60, 0.18, 'sine', 0.3); },
    win() { this.blip(523, 0.15, 'triangle', 0.2); setTimeout(() => this.blip(784, 0.25, 'triangle', 0.2), 140); },
    lose() { this.blip(180, 0.3, 'sawtooth', 0.18); setTimeout(() => this.blip(120, 0.4, 'sawtooth', 0.18), 180); }
};

/* ------------------------------ воркер геометрии ------------------------------ */
class GeoWorker {
    constructor(urls) { this.urls = urls; this.pending = new Map(); this.seq = 0; this.spawn(); }
    spawn() {
        const u = this.urls;
        const src =
            'importScripts(' + JSON.stringify(u.turf) + ',' + JSON.stringify(u.countries) + ',' +
            JSON.stringify(u.regions) + ',' + JSON.stringify(u.geo) + ');\n' +
            'var PF=null,EF=null,AX=null;\n' +
            'function handle(cmd,a){switch(cmd){\n' +
            ' case "setup": PF=a.pf;EF=a.ef;AX=EFG.makeAxis(PF,EF,a.capital,a.sectors);return {W:AX.W,D:AX.D,enemyArea:EFG.areaKm2(EF)};\n' +
            ' case "occupied": return EFG.occupiedPoly(AX,a.tArr,EF,a.seed);\n' +
            ' case "regions": return (self.EF_REGIONS.features||[]).filter(function(f){return f.properties.country===a.name;})\n' +
            // iso у регионов — код СТРАНЫ (POL у всех 16 воеводств), так что ключ
            // обязан быть iso+имя: иначе выбор двух регионов гасил сам себя
            '   .map(function(f){return {id:f.properties.iso+"#"+f.properties.name, name:f.properties.name, geometry:f.geometry};});\n' +
            ' case "unionAll": return turf.union.apply(null, a.map(function(g){return {type:"Feature",properties:{},geometry:g};}));\n' +
            ' case "intersect": return turf.intersect(a[0],a[1]);\n' +
            ' case "union": return turf.union(a[0],a[1]);\n' +
            ' case "difference": return turf.difference(a[0],a[1]);\n' +
            ' case "area": return EFG.areaKm2(a);\n' +
            '}return null;}\n' +
            'self.onmessage=function(e){var d=e.data,r=null,err=null;try{r=handle(d.cmd,d.args);}catch(ex){err=String(ex&&ex.message||ex);}self.postMessage({id:d.id,ok:!err,err:err,r:r});};\n';
        this.blob = new Blob([src], { type: 'text/javascript' });
        this.url = URL.createObjectURL(this.blob);
        this.w = new Worker(this.url);
        this.w.onmessage = e => {
            const d = e.data, p = this.pending.get(d.id);
            if (!p) return;
            this.pending.delete(d.id); clearTimeout(p.timer);
            p.resolve(d.ok ? d.r : null);
        };
        this.w.onerror = () => {
            for (const [, p] of this.pending) { clearTimeout(p.timer); p.resolve(null); }
            this.pending.clear();
        };
        // убийство по таймауту сбрасывает состояние воркера — ось фронтаrestore
        if (this.lastSetup) this.call('setup', this.lastSetup, 6000);
    }
    call(cmd, args, timeout) {
        return new Promise(res => {
            if (cmd === 'setup') this.lastSetup = args;
            const id = ++this.seq;
            const timer = setTimeout(() => { this.pending.delete(id); this.kill(); res(null); }, timeout || 500);
            this.pending.set(id, { resolve: res, timer });
            try { this.w.postMessage({ id, cmd, args }); }
            catch (e) { clearTimeout(timer); this.pending.delete(id); res(null); }
        });
    }
    kill() {
        try { this.w.terminate(); } catch (e) { }
        try { URL.revokeObjectURL(this.url); } catch (e) { }
        this.spawn();
    }
}

/* ------------------------------ состояние ------------------------------ */
const N = 40;
const S = {
    phase: 'setup',
    player: 'Ukraine', enemy: 'Russia',
    playerColor: '#f2c94c', enemyColor: '#3e9b63',
    difficulty: 1, speed: 1,
    front: new Array(N + 1).fill(0),
    disp: new Array(N + 1).fill(0),
    seed: 1.7,
    cp: 60, cpMax: 100,
    warScore: 0, enemyWill: 100,
    occupied: null, occupiedFrac: 0, enemyArea: 1,
    capitalCaptured: false,
    attack: null, defend: false,
    // роль в войне: 'attack' = Вы переходите в наступление первыми,
    // 'defend' = войну начинает враг; ROLE ниже меняет под это симуляцию
    role: 'attack', thrust: null, chanceMod: 0,
    battles: [], units: [],
    regions: [], selected: new Set(),
    mode: 'front', draw: [], demand: null, demandArea: 0,
    annexed: [],
    chance: 0,
    axis: null,
    tickTimer: 0, raf: 0, lastOcc: 0, lastT: 0
};
let map = null, geo = null;

const countryFeat = n => (window.EF_COUNTRIES.features.find(f => f.properties.name === n) || null);
// столица страны: первая точка флага (cap=1) внутри её полигона — GeoNames-имена
function capitalOf(n) {
    const f = countryFeat(n);
    if (!f) return null;
    const PL = window.EF_PLACES || [];
    const t = T();
    for (let i = 0; i < PL.length; i++) {
        const p = PL[i];
        if (p[3] !== 1) continue;
        try { if (t.booleanPointInPolygon(t.point([p[0], p[1]]), f)) return [p[0], p[1]]; } catch (e) { }
    }
    for (let i = 0; i < PL.length; i++) {
        const p = PL[i];
        if (p[3] !== 2) continue;
        try { if (t.booleanPointInPolygon(t.point([p[0], p[1]]), f)) return [p[0], p[1]]; } catch (e) { }
    }
    const lp = f.properties.lp;
    return lp ? [lp[0], lp[1]] : null;
}
const ruName = n => { const f = countryFeat(n); return f ? f.properties.ru : n; };
const colorOf = n => { const f = countryFeat(n); return f ? f.properties.color : '#5c5346'; };

/* ------------------------------ флаги в HTML ------------------------------ */
// dataURL кэшируется по стране: меню и HUD перерисовываются часто, а canvas +
// toDataURL на каждый вызов грузили бы процессор. 120×80 — с запасом под ретину
const flagUrlCache = {};
function flagURL(name) {
    if (flagUrlCache[name]) return flagUrlCache[name];
    let u = 'none';
    try { if (window.EF_FLAGS) u = 'url(' + window.EF_FLAGS.dataURL(name, 120, 80, colorOf(name)) + ')'; } catch (e) { }
    flagUrlCache[name] = u;
    return u;
}
function setFlagBg(el, name) { if (el) el.style.backgroundImage = flagURL(name); }
function updateSetupFlags() {
    setFlagBg($('fp-player'), $('sel-player').value);
    setFlagBg($('fp-enemy'), $('sel-enemy').value);
}

/* ------------------------------ слои ------------------------------ */
// addImage принимает ImageData, а не canvas: с canvas он бросал, try{} глотал
// ошибку — и штриховка оккупации с шевронами отрядов просто не существовали
function hatchImage() {
    const c = document.createElement('canvas'); c.width = 14; c.height = 14;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 14, 14);
    x.strokeStyle = 'rgba(255,90,90,0.85)'; x.lineWidth = 2;
    x.beginPath();
    x.moveTo(-4, 18); x.lineTo(18, -4);
    x.moveTo(-4, 11); x.lineTo(11, -4);
    x.moveTo(3, 18); x.lineTo(18, 3);
    x.stroke();
    return x.getImageData(0, 0, 14, 14);
}
function roundRect(x, X, Y, W, H, r) {
    x.beginPath();
    x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
    x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}
// Бригада как на видео: флаг страны в рамке-заготовке (светлая карточка, тонкий
// тёмный контур, мягкая тень) + номер поверх полотнища белым с чёрной обводкой.
// Рендер в 2× ради чёткости; MapLibre получает ImageData с pixelRatio.
function unitBadge(name, num, color) {
    const W = 54, H = 40, S = 2;
    const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
    const x = c.getContext('2d'); x.scale(S, S);
    const pad = 2.5, r = 4, iw = W - 2 * pad, ih = H - 2 * pad;
    x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 2.4; x.shadowOffsetY = 1.4;
    roundRect(x, pad, pad, iw, ih, r); x.fillStyle = '#fff'; x.fill();
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    x.save(); roundRect(x, pad, pad, iw, ih, r); x.clip();
    x.translate(pad, pad);
    if (window.EF_FLAGS) window.EF_FLAGS.draw(x, name, iw, ih, color);
    else { x.fillStyle = color || '#5c5346'; x.fillRect(0, 0, iw, ih); }
    x.restore();
    roundRect(x, pad, pad, iw, ih, r); x.lineWidth = 1.4; x.strokeStyle = 'rgba(12,14,18,0.9)'; x.stroke();
    x.font = 'bold ' + Math.round(H * 0.5) + 'px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.lineWidth = 3.2; x.strokeStyle = 'rgba(6,8,12,0.92)'; x.strokeText(num, W / 2, H / 2 + 1);
    x.fillStyle = '#fff'; x.fillText(num, W / 2, H / 2 + 1);
    return x.getImageData(0, 0, W * S, H * S);
}
// кэш иконок по (сторона, страна, номер): 14 бригад переиспользуются каждый кадр,
// а ключ с названием не даёт старому флагу пережить смену сторон в новой войне
const unitIcons = new Set();
function ensureUnitIcon(m, side, name, num, color) {
    const slug = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
    const id = 'ef-u-' + side + '-' + slug + '-' + num;
    if (unitIcons.has(id) || m.hasImage(id)) return id;
    try { m.addImage(id, unitBadge(name, num, color), { pixelRatio: 2 }); unitIcons.add(id); } catch (e) { }
    return id;
}
function clearUnitIcons(m) {
    for (const id of unitIcons) { try { if (m.hasImage(id)) m.removeImage(id); } catch (e) { } }
    unitIcons.clear();
}
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

/* MapLibre держит ОДИН _pendingCallback на весь GeoJSONWorkerSource, а он один
   на все geojson-источники: любой новый loadData бросает предыдущий как
   abandoned, и главный поток даже не кладёт тайл. Фронт, юниты и бои пушатся
   каждый кадр, поэтому однократный контент (аннексия, требование, регионы,
   рисованная граница) молча терялся — земля договора не появлялась.
   Лечится окном тишины: пока очередь висит, кадр целиком принадлежит ей —
   ежекадровые пуши пропускаются, а пере-послка идёт раз в несколько кадров,
   иначе очередь абортит саму себя. */
const shots = new Map();
const QUIET = 5;
function paint(id, fc) {
    const src = map.getSource(id);
    if (!src) return;
    src.setData(fc);
    // подтверждение нужно и пустому слою: его push воркер бросает так же, как
    // любой другой, — иначе штриховка оккупации переживает мирный договор
    shots.set(id, { fc, tries: 40, wait: QUIET, want: fc.features.length ? 1 : 0 });
}
function flushShots() {
    if (!shots.size) return;
    for (const [id, s] of shots) {
        const src = map.getSource(id);
        if (!src || --s.tries <= 0) { shots.delete(id); continue; }
        let have = -1;
        try { have = map.querySourceFeatures(id).length; } catch (e) { have = 0; }
        if (have === s.want) { shots.delete(id); continue; }
        if (s.wait > 0) { s.wait--; continue; }
        src.setData(s.fc);
        s.wait = QUIET;
    }
}

function addGameLayers() {
    const m = map;
    const src = (id) => { if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: emptyFC() }); };
    src('ef-annex-src'); src('ef-occ-src'); src('ef-region-src'); src('ef-demand-src');
    src('ef-front-src'); src('ef-battle-src'); src('ef-units-src'); src('ef-draw-src');
    try {
        if (!m.hasImage('ef-hatch')) m.addImage('ef-hatch', hatchImage());
    } catch (e) { }
    const L = (o) => { if (!m.getLayer(o.id)) m.addLayer(o); };
    L({ id: 'ef-occ-fill', type: 'fill', source: 'ef-occ-src', paint: { 'fill-color': '#4a0d13', 'fill-opacity': 0.62 } });
    L({ id: 'ef-occ-hatch', type: 'fill', source: 'ef-occ-src', paint: { 'fill-pattern': 'ef-hatch', 'fill-opacity': 0.75 } });
    // аннексия — свершившийся раздел, она рисуется поверх оккупационной штриховки
    L({ id: 'ef-annex-fill', type: 'fill', source: 'ef-annex-src', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 } });
    L({ id: 'ef-annex-line', type: 'line', source: 'ef-annex-src', paint: { 'line-color': '#e8eef6', 'line-width': 1.6, 'line-opacity': 0.9 } });
    L({ id: 'ef-region-hl', type: 'fill', source: 'ef-region-src', paint: { 'fill-color': '#e8bf78', 'fill-opacity': 0.30 } });
    L({ id: 'ef-demand', type: 'line', source: 'ef-demand-src', paint: { 'line-color': '#e8bf78', 'line-width': 2, 'line-dasharray': [2, 1.4], 'line-opacity': 0.95 } });
    // линия соприкосновения как на референсе: широкое размытое оранжевое свечение
    // (ореол) + светящийся золотой пунктир по краю + раскалённое ядро. Всё дышит
    // в animateFront: пульс ширины/прозрачности/блюра, ярче в наступлении
    L({ id: 'ef-front-glow', type: 'line', source: 'ef-front-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff4a12', 'line-width': 9, 'line-blur': 6, 'line-opacity': 0.34 } });
    L({ id: 'ef-front-core', type: 'line', source: 'ef-front-src', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffb347', 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [2.4, 1.8] } });
    L({ id: 'ef-front', type: 'line', source: 'ef-front-src', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#fff1c8', 'line-width': 1.2, 'line-opacity': 0.95, 'line-dasharray': [2.4, 1.8] } });
    // бой: ореол + ядро. Радиус и прозрачность едут из данных (setBattles)
    L({ id: 'ef-battle-glow', type: 'circle', source: 'ef-battle-src', paint: { 'circle-color': '#ff6a1f', 'circle-blur': 1, 'circle-radius': ['*', ['get', 'r'], 2.3], 'circle-opacity': ['*', ['get', 'o'], 0.5] } });
    L({ id: 'ef-battle', type: 'circle', source: 'ef-battle-src', paint: { 'circle-color': '#ffd27a', 'circle-blur': 0.5, 'circle-radius': ['get', 'r'], 'circle-opacity': ['get', 'o'] } });
    L({ id: 'ef-units', type: 'symbol', source: 'ef-units-src', layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.62, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    L({ id: 'ef-draw', type: 'line', source: 'ef-draw-src', paint: { 'line-color': '#7ef0a8', 'line-width': 2, 'line-dasharray': [1.5, 1] } });
    window.EF.order();
    // стиль мог смениться ровно между setData и подтверждением воркера —
    // возвращаем отложенный контент в свежие источники, но вразнобой: подряд
    // идущие push абортят друг друга в том же самом окне тишины
    let gap = 0;
    for (const [id, s] of shots) shots.set(id, { fc: s.fc, tries: 40, want: s.want, wait: QUIET * (++gap) });
}

/* ------------------------------ фронт / кадр ------------------------------ */
function frontFeature() {
    const g = G();
    const line = g.clipLineToPolygon(g.frontLine(S.axis, S.disp, S.seed, S.lastT / 900), countryFeat(S.enemy));
    if (line.length < 2) return null;
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } };
}
function setFront() {
    const f = frontFeature();
    map.getSource('ef-front-src').setData(f ? { type: 'FeatureCollection', features: [f] } : emptyFC());
    return f;
}
function depthOffset(i, dist) {
    const a = S.axis;
    // сдвиг вдоль оси наступления, а не поперёк линии: «−» за фронтом свои,
    // «+» впереди — враг, которого выбивают из его страны
    return [a.ax * dist / a.k, a.ay * dist];
}
function setUnits(front) {
    if (!front) { map.getSource('ef-units-src').setData(emptyFC()); return; }
    const line = front.geometry.coordinates;
    const feats = [];
    const M = 7;
    for (let u = 0; u < M; u++) {
        const idx = Math.round((u + 0.5) / M * (line.length - 1));
        const p = line[idx];
        const offP = depthOffset(idx, -S.axis.W * 0.05);
        const offE = depthOffset(idx, S.axis.W * 0.05);
        const np = String(10 + ((u * 7) % 40)), ne = String(11 + ((u * 13) % 40));
        feats.push({ type: 'Feature', properties: { icon: ensureUnitIcon(map, 'p', S.player, np, S.playerColor) }, geometry: { type: 'Point', coordinates: [p[0] + offP[0], p[1] + offP[1]] } });
        feats.push({ type: 'Feature', properties: { icon: ensureUnitIcon(map, 'e', S.enemy, ne, S.enemyColor) }, geometry: { type: 'Point', coordinates: [p[0] + offE[0], p[1] + offE[1]] } });
    }
    map.getSource('ef-units-src').setData({ type: 'FeatureCollection', features: feats });
}
function setBattles(dt) {
    const feats = [];
    S.battles = S.battles.filter(b => (b.age += dt) < 900);
    for (const b of S.battles) {
        const t = b.age / 900;
        feats.push({ type: 'Feature', properties: { r: 3 + t * 14, o: 0.85 * (1 - t) }, geometry: { type: 'Point', coordinates: b.pt } });
    }
    map.getSource('ef-battle-src').setData({ type: 'FeatureCollection', features: feats });
}
function spawnBattle(sector) {
    const g = G();
    const line = g.frontLine(S.axis, S.disp, S.seed, 0);
    const i = Math.max(0, Math.min(line.length - 1, sector));
    S.battles.push({ pt: line[i], age: 0 });
    if (S.battles.length > 24) S.battles.shift();
}

async function refreshOccupation(force) {
    // штриховка живёт ровно до мирной конференции: после договора оккупации нет,
    // есть аннексированные земли в цвете игрока
    if (S.phase !== 'war') return;
    const now = performance.now();
    if (!force && now - S.lastOcc < 300) return;
    S.lastOcc = now;
    const occ = await geo.call('occupied', { tArr: Array.from(S.disp), seed: S.seed }, 450);
    S.occupied = occ;
    S.occupiedFrac = occ ? Math.min(1, G().areaKm2(occ) / S.enemyArea) : 0;
    map.getSource('ef-occ-src').setData(occ ? { type: 'FeatureCollection', features: [occ] } : emptyFC());
}

/* ------------------------------ HUD войны ------------------------------ */
function syncWarHud() {
    const R = ROLE[S.role];
    $('wh-player-name').textContent = ruName(S.player);
    $('wh-enemy-name').textContent = ruName(S.enemy);
    setFlagBg($('wh-player-dot'), S.player);
    setFlagBg($('wh-enemy-dot'), S.enemy);
    // роль видна без открытия модалки: кто именно перешёл в наступление
    $('wh-role').textContent = R.label;
    $('wh-role').className = 'wh-role ' + S.role;
    $('wh-role').title = R.hint;
    // куда враг бьёт клином — на телефоне #wh-msg скрыт, поэтому сектор live здесь
    $('wh-thrust').hidden = !S.thrust || S.thrust.ticks <= 0;
    if (S.thrust) $('wh-thrust-sector').textContent = S.thrust.sector;
    $('wh-score-fill').style.width = Math.round(S.warScore) + '%';
    $('wh-score').textContent = Math.round(S.warScore);
    $('wh-will-fill').style.width = Math.round(S.enemyWill) + '%';
    $('wh-will').textContent = Math.round(S.enemyWill);
    $('wh-cp').textContent = Math.round(S.cp);
    $('btn-defend').classList.toggle('active', S.defend);
    $('btn-defend').setAttribute('aria-pressed', S.defend ? 'true' : 'false');
    $('btn-speed').textContent = S.speed + '×';
    $('btn-peace').classList.toggle('pulse', S.capitalCaptured || S.enemyWill <= 0);
    $('btn-war-label').textContent = S.phase === 'setup' ? 'ОБЪЯВИТЬ ВОЙНУ' : 'НОВАЯ ВОЙНА';
}
function toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show ' + (kind || '');
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = ''; }, 3200);
}

/* ------------------------------ игровой тик ------------------------------ */
function diffPush() { return [0.012, 0.02, 0.03][S.difficulty] || 0.02; }
/* Роль в войне меняет саму симуляцию, а не только подпись. Агрессор получает
   мобилизацию: очков больше, клин бьёт в полную силу, ответные контратаки
   разрознены — зато под вторжением воля врага сплочается (возвращается к 100,
   пока Вы не наступайте) и ИИ на конференции не отдаёт землю захватчику.
   Обороняющийся бьёт дешевле по очкам, но враг наступает сконцентрированным
   клином по настоящему сектору и каждый его удар выжигает его же волю —
   линию можно выиграть, просто её держа. */
const ROLE = {
    attack: {
        label: 'ВЫ НАСТАПАЕТЕ',
        hint: 'Агрессор: 80 стартовых командных очков, наступление в полную силу, контратаки врага слабы и разрознены. Но оккупанту не верят: вне боёв воля врага восстанавливается, а на конференции за вторжение берут цену — шанс договора ниже.',
        cp: 80, gain: 3, strike: 1, hits: 1, push: 0.7, thrust: 0, will: 0.55, rally: 0.3, chance: -14
    },
    defend: {
        label: 'ВЫ ОБОРОНЯЕТЕСЬ',
        hint: 'Оборона: 50 стартовых очков, но они прибывают быстрее, а Ваш контрудар бьёт слабее. Враг наступает клином по одному сектору — удар видно по боям на карте. Кнопка ОБОРОНА в панели войны режет его натиск и он сгорает в этих атаках; без неё фронт отходит, но враг платит за прорыв меньше.',
        cp: 50, gain: 5, strike: 0.6, hits: 2, push: 1, thrust: 1, will: 1.45, rally: 0.05, chance: 10
    }
};
function tick() {
    if (S.phase !== 'war') return;
    const R = ROLE[S.role], push = diffPush();
    // сколоченный удар врага: свой сектор на всё время удара, бой виден на карте
    if (R.thrust) {
        if (!S.thrust || S.thrust.ticks <= 0) {
            S.thrust = { sector: Math.floor(Math.random() * (N + 1)), ticks: 6 + Math.floor(Math.random() * 5) };
            $('wh-msg').textContent = 'ВРАГ НАСТАПАЕТ В СЕКТОРЕ ' + S.thrust.sector + ' — ОБОРОНА ЕГО СЖИГАЕТ, БЕЙТЕ ПО ЕГО ФЛАНГУ';
        }
        const c = S.thrust.sector;
        for (let d = -3; d <= 3; d++) {
            const i = c + d;
            if (i < 0 || i > N) continue;
            const w = 1 - Math.abs(d) / 4;
            S.front[i] = Math.max(0, S.front[i] - push * 1.3 * w * (S.defend ? 0.4 : 1));
        }
        S.thrust.ticks--;
        spawnBattle(c);
        Sound.battle();
        // атакующий исткается: по готовой обороне вдвое дороже, чем по прорванному фронту
        S.enemyWill = Math.max(0, S.enemyWill - (S.defend ? 0.75 : 0.25));
    } else {
        S.thrust = null;
    }
    // контратаки врага по случайным секторам
    const hits = R.hits + S.difficulty;
    for (let k = 0; k < hits; k++) {
        const i = Math.floor(Math.random() * (N + 1));
        const red = S.defend ? 0.35 : 1;
        S.front[i] = Math.max(0, S.front[i] - push * R.push * red * (0.6 + Math.random() * 0.8));
    }
    // наступление игрока
    if (S.attack && S.attack.ticks > 0) {
        const c = S.attack.sector;
        for (let d = -3; d <= 3; d++) {
            const i = c + d;
            if (i < 0 || i > N) continue;
            const w = 1 - Math.abs(d) / 4;
            S.front[i] = Math.min(1, S.front[i] + 0.035 * w * R.strike * (S.defend ? 0.5 : 1));
        }
        S.attack.ticks--;
        spawnBattle(c);
        Sound.battle();
        if (S.attack.ticks <= 0) S.attack = null;
    }
    S.cp = Math.min(S.cpMax, S.cp + R.gain);
    // счёт войны и воля врага
    const target = S.occupiedFrac * 100;
    S.warScore += (target * 0.7 + (100 - S.enemyWill) * 0.3 - S.warScore) * 0.15;
    const drain = S.occupiedFrac * 0.9 * R.will + (S.attack ? 0.5 * R.strike : 0);
    const rally = (S.attack ? 0 : 0.15) + R.rally;
    S.enemyWill = Math.min(100, Math.max(0, S.enemyWill - drain + rally));
    // столица — свой сектор и своя глубина (axis.capSector/capT), а не «середина фронта на 97%»
    const ax = S.axis, cs = ax ? Math.max(0, Math.min(N, ax.capSector)) : Math.round(N / 2);
    S.capitalCaptured = S.front[cs] >= (ax ? ax.capT : 0.97);
    if (S.capitalCaptured || S.enemyWill <= 0) {
        if (!S._won) { S._won = true; Sound.win(); toast('СТОЛИЦА ВЗЯТА — ОТКРЫТА МИРНАЯ КОНФЕРЕНЦИЯ', 'good'); }
    }
    syncWarHud();
}
function startTick() {
    stopTick();
    S.tickTimer = setInterval(tick, 650 / S.speed);
}
function stopTick() { if (S.tickTimer) clearInterval(S.tickTimer); S.tickTimer = 0; }

/* ------------------------------ цикл кадра ------------------------------ */
// «дыхание» линии фронта: два разнесённых по частоте синуса дают живой пульс
// ореола и тремор раскалённого ядра. Частоту кадрируем ~30 к/с — на слабом
// мобильном GPU этого хватает, а 60 к/с перекрашивали бы слои впустую
let lastAnim = 0;
function animateFront(now) {
    const m = map;
    if (!m.getLayer('ef-front-glow')) return;
    if (now - lastAnim < 33) return;
    lastAnim = now;
    const heat = 0.55 + (S.attack ? 0.45 : 0) + S.occupiedFrac * 0.25;
    const p1 = 0.5 + 0.5 * Math.sin(now / 640);
    const p2 = 0.5 + 0.5 * Math.sin(now / 300 + 1.3);
    const sp = (id, p, v) => { try { m.setPaintProperty(id, p, v); } catch (e) { } };
    sp('ef-front-glow', 'line-width', 7 + 7 * p1 * heat);
    sp('ef-front-glow', 'line-opacity', 0.2 + 0.3 * p1);
    sp('ef-front-glow', 'line-blur', 5 + 3.5 * p1);
    sp('ef-front-core', 'line-width', 2.4 + 1.6 * p1 * heat);
    sp('ef-front-core', 'line-opacity', 0.62 + 0.38 * p2);
    sp('ef-front', 'line-width', 1 + 0.7 * p2);
    sp('ef-front', 'line-opacity', 0.7 + 0.3 * p2);
}
function frame(t) {
    S.raf = requestAnimationFrame(frame);
    const dt = S.lastT ? Math.min(120, t - S.lastT) : 16;
    S.lastT = t;
    if (S.phase === 'setup' || !S.axis) return;
    // переключение подложки меняет стиль, а со стилем уходят источники, слои и
    // текстуры войны — возвращаем их до первого setData этого же кадра
    if (!map.getSource('ef-front-src')) addGameLayers();
    animateFront(t);
    // очередь однократного контента забирает кадр целиком: её push не должен
    // конкурировать с ежекадровыми фронт/юниты — иначе воркер вечно бросает договор
    if (shots.size) { flushShots(); return; }
    // фронтовые вспышки сами по себе: чем глубже занято и активнее бой, тем чаще
    if (t > S.nextAmbient) {
        S.nextAmbient = t + 480 + Math.random() * 1000;
        const inten = 0.3 + S.occupiedFrac * 0.5 + (S.attack ? 0.4 : 0);
        if (Math.random() < 0.35 + inten * 0.5) spawnBattle(Math.floor(Math.random() * (N + 1)));
    }
    const k = Math.min(1, dt / 180);
    for (let i = 0; i <= N; i++) S.disp[i] += (S.front[i] - S.disp[i]) * k;
    const f = setFront();
    setUnits(f);
    setBattles(dt);
    refreshOccupation(false);
}

/* ------------------------------ приказы ------------------------------ */
function sectorAt(lngLat) {
    const a = S.axis;
    const dx = (lngLat.lng - a.C[0]) * a.k, dy = lngLat.lat - a.C[1];
    const pp = dx * a.perp[0] + dy * a.perp[1];
    // фронт отсчитывается от axis.mid, а не от нуля: иначе сектора съезжали у
    // стран, несимметричных относительно оси наступления
    const frac = (pp - (a.mid || 0)) / a.W + 0.5;
    return Math.max(0, Math.min(N, Math.round(frac * N)));
}
function launchAttack(sector) {
    if (S.phase !== 'war') return;
    if (S.cp < 25) { toast('НЕДОСТАТОЧКО КОМАНДНЫХ ОЧКОВ', 'bad'); Sound.lose(); return; }
    S.cp -= 25;
    S.attack = { sector, ticks: 5 };
    Sound.attack();
    spawnBattle(sector);
    syncWarHud();
}

/* ------------------------------ мирная конференция ------------------------------ */
function openPeace() {
    if (S.phase !== 'war' && S.phase !== 'done') return;
    S.phase = 'peace';
    stopTick();
    // тик встал — чип про вражеский клин обязан погаснуть, а не зависнуть на
    // последнем секторе: при возврате к войне tick создаст новый удар
    S.thrust = null;
    syncWarHud();
    $('peace').hidden = false;
    setMode(S.mode);
    refreshDemand();
    Sound.click();
}
function closePeace(resume) {
    $('peace').hidden = true;
    S.draw = [];
    paint('ef-draw-src', emptyFC());
    if (resume && S.phase === 'peace') { S.phase = 'war'; startTick(); }
}
function setMode(mode) {
    S.mode = mode;
    document.querySelectorAll('#pc-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('pc-regions').hidden = mode !== 'regions';
    $('pc-custom').hidden = mode !== 'custom';
    if (mode === 'regions' && !S.regions.length) loadRegions();
    if (mode !== 'custom') { S.draw = []; paint('ef-draw-src', emptyFC()); }
    refreshDemand();
}
async function loadRegions() {
    const regs = await geo.call('regions', { name: S.enemy }, 4000);
    S.regions = (regs || []).map(r => ({
        id: r.id || r.name,
        name: r.name,
        geometry: r.geometry,
        feature: { type: 'Feature', properties: {}, geometry: r.geometry }
    })).filter(r => r.geometry).map(r => {
        r.area = G().areaKm2(r.feature);
        return r;
    }).sort((a, b) => b.area - a.area);
    const box = $('pc-regions');
    box.innerHTML = '';
    if (!S.regions.length) { box.innerHTML = '<div class="pc-empty">Регионы недоступны</div>'; return; }
    for (const r of S.regions) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pc-chip'; b.dataset.id = r.id;
        b.innerHTML = '<span>' + r.name + '</span><em>' + Math.round(r.area / 1000) + ' тыс. км²</em>';
        b.addEventListener('click', () => {
            if (S.selected.has(r.id)) S.selected.delete(r.id); else S.selected.add(r.id);
            b.classList.toggle('on', S.selected.has(r.id));
            Sound.click();
            refreshDemand();
        });
        box.appendChild(b);
    }
    highlightRegions();
}
function highlightRegions() {
    // подсветка имеет смысл только пока требование собирается по регионам:
    // в режиме фронта или своего контура она показывала бы неиспрошенное
    const feats = S.mode === 'regions' ? S.regions.filter(r => S.selected.has(r.id)).map(r => r.feature) : [];
    paint('ef-region-src', { type: 'FeatureCollection', features: feats });
}
async function refreshDemand() {
    let demand = null;
    if (S.mode === 'front') demand = S.occupied;
    else if (S.mode === 'regions') {
        const sel = S.regions.filter(r => S.selected.has(r.id));
        if (sel.length === 1) demand = sel[0].feature;
        else if (sel.length > 1) {
            demand = await geo.call('unionAll', sel.map(r => r.geometry), 900);
            if (!demand) demand = sel[0].feature;      // union не сошёлся — берём первый
        }
    } else if (S.mode === 'custom') {
        if (S.draw.length >= 3) {
            const ring = [...S.draw, S.draw[0]];
            const poly = T().polygon([ring]);
            demand = await geo.call('intersect', [poly, countryFeat(S.enemy)], 400);
        }
    }
    S.demand = demand;
    S.demandArea = demand ? G().areaKm2(demand) : 0;
    const occArea = S.occupied ? G().areaKm2(S.occupied) : 0;
    const over = Math.max(0, S.demandArea - occArea) / S.enemyArea;
    // роль стоит на переговорах: захватчику землю не отдают добром
    S.chance = Math.max(2, Math.min(97, G().aiChance({
        warScore: S.warScore, occupiedFrac: S.occupiedFrac,
        demandFrac: S.demandArea / S.enemyArea, overFrac: over,
        capitalCaptured: S.capitalCaptured, enemyWill: S.enemyWill
    }) + (S.chanceMod || 0)));
    $('pc-demand-area').textContent = Math.round(S.demandArea).toLocaleString('ru-RU') + ' км²';
    $('pc-demand-pct').textContent = (S.demandArea / S.enemyArea * 100).toFixed(1) + '%';
    $('pc-occ-pct').textContent = (S.occupiedFrac * 100).toFixed(1) + '%';
    $('pc-chance').textContent = S.chance + '%';
    $('pc-chance-fill').style.width = S.chance + '%';
    $('pc-chance-fill').className = S.chance >= 60 ? 'good' : S.chance >= 35 ? 'mid' : 'bad';
    $('pc-chance-note').textContent =
        S.chance >= 60 ? 'ИИ склонен принять договор' :
        S.chance >= 35 ? 'ИИ колеблется — умерьте требования' :
        'ИИ скорее всего откажет';
    paint('ef-demand-src', demand ? { type: 'FeatureCollection', features: [demand] } : emptyFC());
    highlightRegions();
}
async function propose() {
    if (!S.demand || S.demandArea <= 0) { toast('НЕТ ТЕРРИТОРИЙ ДЛЯ ТРЕБОВАНИЯ', 'bad'); return; }
    const btn = $('btn-propose');
    btn.disabled = true; btn.textContent = 'ПЕРЕГОВОРЫ…';
    await new Promise(r => setTimeout(r, 700));
    const accept = Math.random() * 100 < S.chance;
    btn.disabled = false; btn.textContent = 'ПРЕДЛОЖИТЬ ДОГОВОР';
    if (accept) {
        Sound.win();
        S.annexed.push({ feature: S.demand, color: S.playerColor });
        S.phase = 'done';
        stopTick();
        S.occupied = null; S.occupiedFrac = 0;
        paint('ef-occ-src', emptyFC());
        closePeace(false);
        // последней: её перевод в воркере не должен перекрывать следующий setData
        paint('ef-annex-src', { type: 'FeatureCollection', features: S.annexed.map(a => ({ type: 'Feature', properties: { color: a.color }, geometry: a.feature.geometry })) });
        $('pc-result').hidden = true;
        toast('ДОГОВОР ПРИНЯТ — ТЕРРИТОРИИ АННЕКСИРОВАНЫ', 'good');
        $('wh-msg').textContent = 'ВОЙНА ОКОНЧЕНА · ДОГОВОР ПОДПИСАН';
    } else {
        Sound.lose();
        S.enemyWill = Math.max(0, S.enemyWill - 8);
        $('pc-result').hidden = false;
        $('pc-result').textContent = 'ИИ ОТКЛОНИЛ ДОГОВОР (шанс был ' + S.chance + '%). Война продолжается.';
        toast('ДОГОВОР ОТКЛОНЁН', 'bad');
        closePeace(true);
    }
    syncWarHud();
}

/* ------------------------------ своя граница ------------------------------ */
function onMapClick(e) {
    if (S.phase === 'peace' && S.mode === 'custom') {
        S.draw.push([e.lngLat.lng, e.lngLat.lat]);
        const line = S.draw.length >= 2 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: S.draw } } : null;
        paint('ef-draw-src', line ? { type: 'FeatureCollection', features: [line] } : emptyFC());
        Sound.click();
        refreshDemand();
        return;
    }
    if (S.phase === 'war') launchAttack(sectorAt(e.lngLat));
}

/* ------------------------------ setup / reset ------------------------------ */
function fillSelects() {
    const eu = window.EF_COUNTRIES.features.filter(f => f.properties.eu);
    for (const id of ['sel-player', 'sel-enemy']) {
        const sel = $(id); sel.innerHTML = '';
        for (const f of eu) {
            const o = document.createElement('option');
            o.value = f.properties.name; o.textContent = f.properties.ru;
            sel.appendChild(o);
        }
    }
    $('sel-player').value = S.player;
    $('sel-enemy').value = S.enemy;
    updateSetupFlags();
}
// единственная точка, где роль становится ролью: вкладки, подсказка и модификатор
// шанса договора едут за ней, а не расходятся по трём местам
function setRole(role) {
    S.role = ROLE[role] ? role : 'attack';
    document.querySelectorAll('#role-tabs button').forEach(b => {
        const on = b.dataset.role === S.role;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('role-hint').textContent = ROLE[S.role].hint;
    S.chanceMod = ROLE[S.role].chance;
}
async function startWar() {
    S.player = $('sel-player').value; S.enemy = $('sel-enemy').value;
    if (S.player === S.enemy) { toast('ВЫБЕРИТЕ РАЗНЫЕ СТОРОНЫ', 'bad'); return; }
    S.difficulty = parseInt($('sel-diff').value, 10) || 1;
    const R = ROLE[S.role];
    const pf = countryFeat(S.player), ef = countryFeat(S.enemy);
    S.playerColor = pf.properties.color; S.enemyColor = ef.properties.color;
    Sound.init(); Sound.resume(); Sound.click();
    $('setup').hidden = true;
    $('war-hud').hidden = false;
    // сброс
    S.front.fill(0); S.disp.fill(0);
    S.cp = R.cp; S.warScore = 0; S.enemyWill = 100; S.occupied = null; S.occupiedFrac = 0;
    S.capitalCaptured = false; S._won = false; S.attack = null; S.defend = false; S.thrust = null;
    S.battles = []; S.regions = []; S.selected = new Set(); S.draw = []; S.demand = null; S.annexed = [];
    S.nextAmbient = 0;
    S.seed = 1 + Math.random() * 3;
    S.phase = 'war';
    addGameLayers();
    shots.clear();
    clearUnitIcons(map);
    paint('ef-annex-src', emptyFC());
    paint('ef-occ-src', emptyFC());
    paint('ef-region-src', emptyFC());
    paint('ef-demand-src', emptyFC());
    const info = await geo.call('setup', { pf, ef, capital: capitalOf(S.enemy), sectors: N }, 4000);
    S.enemyArea = (info && info.enemyArea) || G().areaKm2(ef);
    S.axis = G().makeAxis(pf, ef, capitalOf(S.enemy), N);
    $('wh-msg').textContent = R.label + ' · КЛИК ПО ФРОНТУ = НАСТУПЛЕНИЕ В СЕКТОРЕ';
    syncWarHud();
    startTick();
    // камера к театру
    try {
        const bb = T().bbox(ef);
        map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, duration: 900 });
    } catch (e) { }
    await refreshOccupation(true);
}
function newWar() {
    stopTick();
    S.phase = 'setup';
    S.thrust = null;
    $('war-hud').hidden = true;
    $('peace').hidden = true;
    $('setup').hidden = false;
    $('btn-war-label').textContent = 'ОБЪЯВИТЬ ВОЙНУ';
    updateSetupFlags();
    shots.clear();
    for (const id of ['ef-occ-src', 'ef-front-src', 'ef-units-src', 'ef-battle-src', 'ef-annex-src', 'ef-region-src', 'ef-demand-src', 'ef-draw-src']) {
        const s = map.getSource(id); if (s) s.setData(emptyFC());
    }
    Sound.click();
}

/* ------------------------------ wiring ------------------------------ */
function wire() {
    $('btn-start').addEventListener('click', startWar);
    $('sel-player').addEventListener('change', updateSetupFlags);
    $('sel-enemy').addEventListener('change', updateSetupFlags);
    $('btn-random').addEventListener('click', () => {
        const eu = window.EF_COUNTRIES.features.filter(f => f.properties.eu);
        const a = eu[Math.floor(Math.random() * eu.length)];
        let b = eu[Math.floor(Math.random() * eu.length)];
        let guard = 0;
        while (b.properties.name === a.properties.name && guard++ < 20) b = eu[Math.floor(Math.random() * eu.length)];
        $('sel-player').value = a.properties.name; $('sel-enemy').value = b.properties.name;
        setRole(Math.random() < 0.5 ? 'attack' : 'defend');
        updateSetupFlags();
        Sound.click();
    });
    document.querySelectorAll('#role-tabs button').forEach(b => b.addEventListener('click', () => { setRole(b.dataset.role); Sound.click(); }));
    $('btn-attack').addEventListener('click', () => launchAttack(Math.round(N / 2)));
    $('btn-defend').addEventListener('click', () => { S.defend = !S.defend; Sound.click(); syncWarHud(); });
    $('btn-peace').addEventListener('click', openPeace);
    $('btn-speed').addEventListener('click', () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; if (S.phase === 'war') startTick(); Sound.click(); syncWarHud(); });
    $('btn-war').addEventListener('click', newWar);
    $('btn-sound').addEventListener('click', () => {
        Sound.init(); Sound.setOn(!Sound.on);
        $('btn-sound').classList.toggle('active', Sound.on);
        $('btn-sound').setAttribute('aria-pressed', Sound.on ? 'true' : 'false');
        $('btn-sound').querySelector('span').textContent = Sound.on ? 'ЗВУК' : 'ТИХО';
        if (Sound.on) { Sound.resume(); Sound.click(); }
    });
    $('peace-close').addEventListener('click', () => closePeace(true));
    $('btn-continue-war').addEventListener('click', () => closePeace(true));
    $('btn-propose').addEventListener('click', propose);
    document.querySelectorAll('#pc-tabs button').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); Sound.click(); }));
    $('pc-draw-clear').addEventListener('click', () => { S.draw = []; paint('ef-draw-src', emptyFC()); refreshDemand(); });
    $('pc-draw-finish').addEventListener('click', () => { refreshDemand(); toast('ГРАНИЦА ЗАМКНУТА — ПРОВЕРЬТЕ ШАНС', 'good'); });
    map.on('click', onMapClick);
}

/* ------------------------------ запуск ------------------------------ */
function start() {
    map = window.EF.map;
    const base = new URL('.', SELF).href;
    geo = new GeoWorker({
        turf: base + 'vendor/turf.min.js',
        countries: base + 'countries.js?v=2',
        regions: base + 'regions.js?v=2',
        geo: base + 'war-geo.js?v=4'
    });
    fillSelects();
    setRole(S.role);
    wire();
    S.raf = requestAnimationFrame(frame);
    window.EF.game = {
        S, launchAttack, openPeace, startWar, newWar, setRole,
        geo: (cmd, args, ms) => geo.call(cmd, args, ms),
        chance: () => S.chance,
        state: () => ({ phase: S.phase, role: S.role, score: S.warScore, will: S.enemyWill, occ: S.occupiedFrac, capital: S.capitalCaptured, cp: S.cp, thrust: S.thrust ? S.thrust.sector : null })
    };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();