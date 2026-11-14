/* EUROFRONT — подписи на canvas-оверлее: пиксельный шрифт, все сёла и города,
   прогрессивное раскрытие по зуму, фейд ин и фейд аут.
   Рендер вне MapLibre-глифов: веб-шрифт не может уронить подписи (Opera GX).
   Кадры движения рисуются в событии map «render» — знак стоит ровно там, где
   карта нарисовала землю в этом же кадре, поэтому при зуме города не плывут.
   В покое анимации ведёт собственный rAF без перерисовки карты (экономия GPU). */
(function () {
    'use strict';

    const P = window.EF_PLACES || [];
    const N = P.length;
    const CELL = 0.25;                       // градусы на ячейку пространственной сетки
    const MAX_CAND = 900;
    const MAX_LABEL = 120;
    const EASE = t => 1 - Math.pow(1 - t, 3);
    const FADE_IN = 260, FADE_OUT = 300;

    const FONT = "'Handjet','Press Start 2P','Courier New',monospace";

    // Облик один: спутник под бумажным листом. Тёмные чернильные подписи с
    // плотным тёплым ореолом — снимок пёстрый, тонкий ореол на нём тонет.
    // grey — кейсинг ключевых городов и столиц (серая обводка + внутреннее
    // свечение, как у границ стран); сёла и городки остаются плоскими.
    const THEME = {
        ink: '#2b2314', ink2: 'rgba(43,35,20,.82)', rural: 'rgba(58,47,27,.68)',
        halo: 'rgba(240,231,208,.94)', haloW: 3.8,
        dot: '#241c10', dotFill: '#f3ead4', state: 'rgba(43,35,20,.5)',
        grey: '#8a9099'
    };

    /* ---------- ранги населённых пунктов: свой знак и своя типографика ----------
       Семь силуэтов: звезда в кольце, мишень, ромб, квадрат, открытый круг,
       треугольник и крест — читаются даже в 3 px. Столицы, миллионники и
       региональные центры (rank ≤ 2) получают серую обводку и внутреннее
       свечение; остальные знаки плоские, без бликов. */
    const RANKS = [
        { r: 3.6, fs: 15, weight: 700, upper: true, ink: 'ink', alpha: 1 },      // столица
        { r: 3.2, fs: 13, weight: 700, upper: true, ink: 'ink', alpha: 1 },      // миллионник
        { r: 2.8, fs: 12, weight: 700, upper: false, ink: 'ink', alpha: 1 },     // региональный центр
        { r: 2.6, fs: 11, weight: 700, upper: false, ink: 'ink', alpha: 1 },     // город
        { r: 2.3, fs: 10, weight: 400, upper: false, ink: 'ink2', alpha: 0.95 }, // городок
        { r: 2.1, fs: 9, weight: 400, upper: false, ink: 'rural', alpha: 0.85 }, // село
        { r: 1.7, fs: 9, weight: 400, upper: false, ink: 'rural', alpha: 0.72 }  // деревня
    ];
    function rankOf(pop, cap) {
        if (cap === 1) return 0;
        if (pop >= 1e6) return 1;
        if (cap === 2) return 2;
        if (pop >= 1e5) return 3;
        if (pop >= 1e4) return 4;
        if (pop >= 3e3) return 5;
        return 6;
    }

    /* ---------- минимальный зум для каждой точки (по населению + статусу) ---------- */

    const BANDS = [[1e6, 2.2], [4e5, 2.9], [18e4, 3.5], [9e4, 4.1], [45e3, 4.7],
    [22e3, 5.3], [11e3, 6.0], [55e2, 6.8], [3e3, 7.6], [15e2, 8.4], [7e2, 9.2], [0, 9.9]];

    // на телефоне Европа целиком влезает только на z≈1.9 — без пола карта была
    // бы совсем без названий, даже столиц
    const REVEAL_FLOOR = 2.6;

    const mz = new Float32Array(N);
    const sz = new Float32Array(N);
    const rk = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
        const p = P[i], pop = p[2], cap = p[3];
        let z = BANDS[BANDS.length - 1][1];
        for (let b = 0; b < BANDS.length; b++) {
            if (pop >= BANDS[b][0]) { z = BANDS[b][1]; break; }
        }
        if (cap === 1) z -= 0.9;
        else if (cap === 2) z -= 0.45;
        mz[i] = Math.max(2.2, z);
        rk[i] = rankOf(pop, cap);
        sz[i] = RANKS[rk[i]].fs;
    }

    // префикс по mz: порядок обхода = порядок важности (массив отсортирован по населению)
    const byMz = new Uint32Array(N);
    for (let i = 0; i < N; i++) byMz[i] = i;
    byMz.sort((a, b) => mz[a] - mz[b]);
    const mzSorted = new Float32Array(N);
    for (let i = 0; i < N; i++) mzSorted[i] = mz[byMz[i]];

    function prefixCount(z) {
        let lo = 0, hi = N;
        while (lo < hi) { const m = (lo + hi) >> 1; if (mzSorted[m] <= z) lo = m + 1; else hi = m; }
        return lo;
    }

    /* ---------- пространственная сетка для близкого зума ---------- */

    const grid = new Map();
    const gk = (cx, cy) => cx * 4096 + cy;
    for (let i = 0; i < N; i++) {
        const cx = Math.floor(P[i][0] / CELL), cy = Math.floor(P[i][1] / CELL);
        const k = gk(cx, cy);
        let a = grid.get(k);
        if (!a) { a = []; grid.set(k, a); }
        a.push(i);
    }

    /* ---------- государства: рамка для размера подписи ---------- */

    const STATES = [];
    (function () {
        const C = window.EF_COUNTRIES;
        if (!C || !C.features) return;
        const scan = (ring, bb) => {
            for (const c of ring) {
                if (c[0] < bb[0]) bb[0] = c[0]; if (c[0] > bb[2]) bb[2] = c[0];
                if (c[1] < bb[1]) bb[1] = c[1]; if (c[1] > bb[3]) bb[3] = c[1];
            }
        };
        for (const f of C.features) {
            const pr = f.properties;
            if (!pr.eu || !pr.lp) continue;
            const bb = [1e9, 1e9, -1e9, -1e9];
            const g = f.geometry;
            if (g.type === 'Polygon') g.coordinates.forEach(ring => scan(ring, bb));
            else g.coordinates.forEach(poly => scan(poly[0], bb));
            STATES.push({ name: pr.ru, lp: pr.lp, bb: bb, glow: pr.glow });
        }
    })();

    /* ---------- оверлей ---------- */

    let map = null, cv = null, ctx = null, raf = 0;
    let lastCam = null, W = 0, H = 0, dpr = 1;
    let ready = false, fadeActive = false, focusActive = false, animating = false;
    let lastRenderT = 0, lastIdleDraw = 0;
    const live = new Map();                      // idx -> время появления (фейд ин)
    const leaving = new Map();                   // idx -> время ухода (фейд аут)
    const cand = [], placed = [];
    let prevDrawn = new Set();
    let focus = -1, frameCount = 0, labelCount = 0;
    const twCache = new Map();                   // кэш ширины подписи (i*64+fs)

    function attach(m) {
        map = m;
        if (!N) return null;
        cv = document.createElement('canvas');
        cv.id = 'ef-places';
        cv.setAttribute('aria-hidden', 'true');
        (map.getContainer ? map.getContainer() : document.getElementById('map')).appendChild(cv);
        ctx = cv.getContext('2d');
        resize();
        map.on('resize', resize);
        window.addEventListener('resize', resize);
        if (document.fonts && document.fonts.load) {
            // unicode-range: каждая подвыборка грузится отдельно, иначе канвас рисует фолбэком
            const need = [['700 16px Handjet', 'АБВГДЕЖЗИЙКЛФЪЫЬЭЮЯ'], ['400 16px Handjet', 'абвгдежзийклфъыьэюя'], ['700 16px Handjet', 'EUROFRONT']];
            for (const [f, t] of need) {
                document.fonts.load(f, t).catch(() => { }).then(() => { lastCam = null; twCache.clear(); ensureTick(); });
            }
        }
        // единственный источник кадров движения — render карты: трансформация в
        // этот момент ровно та, что нарисована на глифе, поэтому знак не плывёт
        map.on('render', onRender);
        map.on('moveend', ensureTick);
        ensureTick();
        return {
            stats: () => ({
                places: N, drawn: labelCount, live: live.size, leaving: leaving.size, dpr: dpr,
                cand: cand.length, th: 'sat', z: +map.getZoom().toFixed(2), frames: frameCount
            })
        };
    }

    function resize() {
        if (!map || !cv) return;
        const c = map.getCanvas();
        const cap = (window.EF && window.EF.device ? window.EF.device().mobile : false) ? 2 : 2.5;
        dpr = Math.min(window.devicePixelRatio || 1, cap);
        W = c.clientWidth || window.innerWidth;
        H = c.clientHeight || window.innerHeight;
        cv.width = Math.max(1, Math.round(W * dpr));
        cv.height = Math.max(1, Math.round(H * dpr));
        cv.style.width = W + 'px';
        cv.style.height = H + 'px';
        lastCam = null;
        twCache.clear();
    }

    function ensureTick() { if (!raf) raf = requestAnimationFrame(tick); }

    function onRender() {
        if (document.hidden) return;
        if (!ready) {
            const s = map.getStyle && map.getStyle();
            if (!s || !s.layers || !s.layers.some(l => l.id === 'ef-country-line')) return;
            ready = true;
        }
        const now = performance.now();
        lastRenderT = now;
        draw(now);
        if (animating) ensureTick();
    }

    // В покое карта кадров не даёт — анимации (фейд, пульс) ведём сами на своём
    // канвасе, НЕ дёргая triggerRepaint: перерисовка всей карты ради подписи
    // сожгла бы GPU и батарею. Во время движения render уже рисует каждый кадр.
    function tick() {
        raf = 0;
        if (document.hidden) return;
        if (!ready) { ensureTick(); return; }
        const now = performance.now();
        const idle = now - lastRenderT > 48;
        if (idle && animating) {
            const interval = fadeActive ? 33 : 80;   // фейд — 30 fps, пульс — ~12 fps
            if (now - lastIdleDraw >= interval) { lastIdleDraw = now; draw(now); }
        }
        if (animating) ensureTick();
    }

    function cameraKey() {
        const z = map.getZoom(), c = map.getCenter();
        return z.toFixed(3) + ',' + c.lng.toFixed(4) + ',' + c.lat.toFixed(4) + ',' + map.getBearing().toFixed(1);
    }

    function measureCached(i, fs, text) {
        const k = i * 64 + fs;
        let w = twCache.get(k);
        if (w === undefined) {
            w = ctx.measureText(text).width;
            if (twCache.size > 4000) twCache.clear();
            twCache.set(k, w);
        }
        return w;
    }

    function draw(now) {
        const th = THEME;
        const zoom = map.getZoom();
        const key = cameraKey();
        const moved = key !== lastCam;
        lastCam = key;

        const b = map.getBounds();
        const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n2 = b.getNorth();
        // окно кандидатов растёт вместе с кадром: фиксированные 0.4° на городском
        // зуме приносили в восемь раз лишней земли и вытесняли видимые сёла
        const pad = Math.max(0.05, Math.min(0.4, (e - w) * 0.35, (n2 - s) * 0.35));

        if (moved) {
            const zq = Math.max(zoom, REVEAL_FLOOR);
            cand.length = 0;
            const cx0 = Math.floor((w - pad) / CELL), cx1 = Math.floor((e + pad) / CELL);
            const cy0 = Math.floor((s - pad) / CELL), cy1 = Math.floor((n2 + pad) / CELL);
            const cells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
            if (cells > 4096) {
                const cnt = prefixCount(zq + 0.001);
                for (let j = 0; j < cnt && cand.length < MAX_CAND; j++) {
                    const i = byMz[j];
                    if (mz[i] <= zq && inBox(i, w - pad, s - pad, e + pad, n2 + pad)) cand.push(i);
                }
            } else {
                for (let cx = cx0; cx <= cx1; cx++) {
                    for (let cy = cy0; cy <= cy1; cy++) {
                        const a = grid.get(gk(cx, cy));
                        if (!a) continue;
                        for (let k = 0; k < a.length; k++) {
                            const i = a[k];
                            if (mz[i] <= zq && inBox(i, w - pad, s - pad, e + pad, n2 + pad)) {
                                cand.push(i);
                                if (cand.length >= MAX_CAND) break;
                            }
                        }
                        if (cand.length >= MAX_CAND) break;
                    }
                    if (cand.length >= MAX_CAND) break;
                }
            }
            cand.sort((x, y) => P[y][2] - P[x][2]);
            // новые точки стартуют с нуля: появление с анимацией
            for (let k = 0; k < cand.length; k++) {
                const i = cand[k];
                if (!live.has(i)) live.set(i, now);
            }
            if (live.size > 2600) {
                const cs = new Set(cand);
                for (const [i, t0] of live) if (!cs.has(i) && now - t0 > 900) live.delete(i);
            }
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        placed.length = 0;
        labelCount = 0;
        fadeActive = false;

        drawStates(th, zoom, map.project([1, 0]).x - map.project([0, 0]).x);

        const mobile = window.EF && window.EF.device ? window.EF.device().mobile : false;
        const maxLabel = mobile ? MAX_LABEL * 0.62 : MAX_LABEL;
        focus = -1; let focusPop = -1;
        const drawn = new Set();

        for (let k = 0; k < cand.length; k++) {
            const i = cand[k], p = P[i];
            const pt = map.project([p[0], p[1]]);
            const x = pt.x, y = pt.y;
            if (x < -40 || x > W + 40 || y < -30 || y > H + 30) continue;

            if (leaving.has(i)) leaving.delete(i);   // вернулся в кадр — гасить нечего
            const t0 = live.get(i);
            const a = Math.min(1, (now - t0) / FADE_IN);
            const ea = EASE(a);
            if (a < 1) fadeActive = true;
            const pop = p[2], rank = rk[i], RK = RANKS[rank];

            // знак населённого пункта: свой силуэт на каждый ранг
            let r = RK.r * (zoom > 8 ? 1.15 : 1);
            r *= 0.55 + 0.45 * ea;
            ctx.globalAlpha = ea;
            glyph(ctx, rank, x, y, r, th);
            drawn.add(i);
            const gr = rank === 0 ? r + 2.4 : r + 1;

            // однотонный «пинг» при появлении крупных городов
            if (a < 1 && rank <= 3) {
                ctx.beginPath();
                ctx.arc(x, y, r + 3 + ea * 16, 0, 6.2832);
                ctx.lineWidth = 1.6; ctx.strokeStyle = th.ink;
                ctx.globalAlpha = (1 - ea) * 0.55;
                ctx.stroke();
                ctx.globalAlpha = ea;
            }

            // подпись
            if (labelCount < maxLabel) {
                const fs = Math.round(sz[i] * (mobile ? 0.92 : 1)) + (zoom > 8 ? 1 : 0);
                const alpha = 0.35 + 0.65 * ea;
                const text = RK.upper ? p[4].toUpperCase() : p[4];
                ctx.font = RK.weight + ' ' + fs + 'px ' + FONT;
                const tw = measureCached(i, fs, text);
                // бокс = ореол + спуск + сам знак: без этого подписи впритык
                // сливаются в кашу на городском зуме
                const base = y - gr - 4;
                const hp = th.haloW / 2 + 2;
                const bx = x - tw / 2 - hp, by = base - fs - hp;
                const bw = tw + 2 * hp, bh = fs * 1.45 + gr + 4 + 2 * hp;
                if (free(bx, by, bw, bh)) {
                    ctx.globalAlpha = alpha * RK.alpha;
                    ctx.lineWidth = th.haloW; ctx.strokeStyle = th.halo;
                    ctx.lineJoin = 'round';
                    ctx.strokeText(text, x, base);
                    ctx.fillStyle = th[RK.ink];
                    ctx.fillText(text, x, base);
                    ctx.globalAlpha = 1;
                    placed.push([bx, by, bw, bh]);
                    labelCount++;
                    if (pop > focusPop && x > W * .28 && x < W * .72 && y > H * .28 && y < H * .72) {
                        focus = i; focusPop = pop;
                    }
                }
            }
            ctx.globalAlpha = 1;
        }

        // фейд аут: знак, который в прошлом кадре был виден, а теперь ушёл из
        // кандидатов (зум мимо порога, уезд за кадр, проигрыш коллизии), гаснет
        // на своём географическом месте, а не исчезает скачком
        for (const i of prevDrawn) if (!drawn.has(i) && !leaving.has(i)) leaving.set(i, now);
        for (const [i, t0] of leaving) {
            const la = 1 - EASE(Math.min(1, (now - t0) / FADE_OUT));
            if (la <= 0.02) { leaving.delete(i); continue; }
            fadeActive = true;
            const p = P[i];
            const pt = map.project([p[0], p[1]]);
            if (pt.x < -60 || pt.x > W + 60 || pt.y < -50 || pt.y > H + 50) continue;
            ghost(i, pt.x, pt.y, la, th, zoom, mobile);
        }

        // «на вас смотрит» город: медленное кольцо на самом крупном в центре кадра
        focusActive = focus >= 0 && zoom > 3.4;
        if (focusActive) {
            const p = P[focus];
            const pt = map.project([p[0], p[1]]);
            const ph = (now % 2600) / 2600;
            const g = 0.34 + 0.66 * Math.sin(ph * Math.PI);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 7 + ph * 15, 0, 6.2832);
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = th.ink;
            ctx.globalAlpha = (1 - ph) * 0.5 * g + 0.12;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        prevDrawn = drawn;
        animating = fadeActive || focusActive;
        frameCount++;
    }

    function inBox(i, w0, s0, e0, n0) {
        const p = P[i];
        return p[0] >= w0 && p[0] <= e0 && p[1] >= s0 && p[1] <= n0;
    }

    function free(x, y, w, h) {
        for (let k = 0; k < placed.length; k++) {
            const q = placed[k];
            if (x < q[0] + q[2] && x + w > q[0] && y < q[1] + q[3] && y + h > q[1]) return false;
        }
        return true;
    }

    // гаснущий знак: тот же силуэт и подпись, но без брони коллизии — это призрак
    function ghost(i, x, y, la, th, zoom, mobile) {
        const p = P[i], rank = rk[i], RK = RANKS[rank];
        const r = RK.r * (zoom > 8 ? 1.15 : 1);
        ctx.globalAlpha = la;
        glyph(ctx, rank, x, y, r, th);
        const fs = Math.round(sz[i] * (mobile ? 0.92 : 1)) + (zoom > 8 ? 1 : 0);
        const text = RK.upper ? p[4].toUpperCase() : p[4];
        ctx.font = RK.weight + ' ' + fs + 'px ' + FONT;
        const gr = rank === 0 ? r + 2.4 : r + 1;
        const base = y - gr - 4;
        ctx.globalAlpha = la * RK.alpha;
        ctx.lineWidth = th.haloW; ctx.strokeStyle = th.halo; ctx.lineJoin = 'round';
        ctx.strokeText(text, x, base);
        ctx.fillStyle = th[RK.ink];
        ctx.fillText(text, x, base);
        ctx.globalAlpha = 1;
    }

    // внутреннее свечение ключевых городов: тёплый яркий центр, гаснет к краю
    function glow(c, x, y, r) {
        const g = c.createRadialGradient(x, y, 0, x, y, Math.max(0.5, r));
        g.addColorStop(0, 'rgba(255,253,245,.98)');
        g.addColorStop(0.55, 'rgba(255,244,214,.6)');
        g.addColorStop(1, 'rgba(255,244,214,0)');
        return g;
    }
    function diamond(c, x, y, r) {
        c.beginPath();
        c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y);
        c.closePath();
    }

    // силуэты знаков: столица — звезда в кольце, миллионник — мишень,
    // региональный центр — ромб, город — квадрат, городок — круг,
    // село — треугольник, деревня — крест. Формы различимы и в 3 px.
    // rank ≤ 2: серый кейсинг снаружи + внутреннее свечение (как у границ стран).
    function glyph(c, rank, x, y, r, th) {
        c.lineWidth = 1.3;
        c.strokeStyle = th.dot;
        c.fillStyle = th.dotFill;
        if (rank === 0) {
            c.beginPath(); c.arc(x, y, r + 2.6, 0, 6.2832);
            c.lineWidth = 2.2; c.strokeStyle = th.grey; c.stroke();
            c.beginPath(); c.arc(x, y, r + 1.6, 0, 6.2832);
            c.fillStyle = glow(c, x, y, r + 1.6); c.fill();
            star(c, x, y, r + 0.5, glow(c, x, y, r + 0.5), th.dot);
        } else if (rank === 1) {
            c.beginPath(); c.arc(x, y, r + 1.8, 0, 6.2832);
            c.lineWidth = 2; c.strokeStyle = th.grey; c.stroke();
            c.beginPath(); c.arc(x, y, r, 0, 6.2832);
            c.fillStyle = glow(c, x, y, r); c.fill();
            c.lineWidth = 1.3; c.strokeStyle = th.dot; c.stroke();
            c.beginPath(); c.arc(x, y, Math.max(0.8, r * 0.42), 0, 6.2832);
            c.fillStyle = th.dot; c.fill();
        } else if (rank === 2) {
            diamond(c, x, y, r + 1.8);
            c.lineWidth = 2; c.strokeStyle = th.grey; c.stroke();
            diamond(c, x, y, r);
            c.fillStyle = glow(c, x, y, r); c.fill();
            c.lineWidth = 1.3; c.strokeStyle = th.dot; c.stroke();
            c.beginPath(); c.arc(x, y, Math.max(0.7, r * 0.3), 0, 6.2832);
            c.fillStyle = th.dot; c.fill();
        } else if (rank === 3) {
            c.fillStyle = th.dot;
            c.fillRect(x - r, y - r, r * 2, r * 2);
            c.lineWidth = 1.1; c.strokeStyle = th.dotFill;
            c.strokeRect(x - r, y - r, r * 2, r * 2);
        } else if (rank === 4) {
            c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
            c.lineWidth = 1.4; c.stroke();
        } else if (rank === 5) {
            c.beginPath();
            c.moveTo(x, y - r); c.lineTo(x + r * 0.9, y + r * 0.7); c.lineTo(x - r * 0.9, y + r * 0.7);
            c.closePath(); c.fill(); c.lineWidth = 1.1; c.stroke();
        } else {
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(x - r, y); c.lineTo(x + r, y);
            c.moveTo(x, y - r); c.lineTo(x, y + r);
            c.stroke();
        }
    }

    function star(c, x, y, r, fill, stroke) {
        c.beginPath();
        for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + k * Math.PI / 5;
            const rr = k % 2 ? r * 0.44 : r;
            const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
            k ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath();
        c.fillStyle = fill; c.fill();
        c.lineWidth = 1.3; c.strokeStyle = stroke; c.stroke();
    }

    // названия стран: крупный разрядный кегль, гаснет по мере приближения
    function drawStates(th, zoom, pxdeg) {
        if (!STATES.length || zoom > 7.4) return;
        const fade = zoom < 6.4 ? 1 : Math.max(0, 1 - (zoom - 6.4) / 1.0);
        ctx.font = '700 ' + (zoom > 5 ? 15 : 14) + 'px ' + FONT;
        ctx.globalAlpha = 0.62 * fade;
        for (const st of STATES) {
            const wpx = (st.bb[2] - st.bb[0]) * pxdeg;
            if (wpx < 78) continue;
            const pt = map.project(st.lp);
            if (pt.x < -120 || pt.x > W + 120 || pt.y < -40 || pt.y > H + 40) continue;
            const name = st.name.toUpperCase();
            if (!free(pt.x - wpx / 2, pt.y - 12, wpx, 20)) continue;
            ctx.lineWidth = th.haloW * 1.1; ctx.strokeStyle = th.halo; ctx.lineJoin = 'round';
            ctx.strokeText(name, pt.x, pt.y);
            ctx.fillStyle = th.state;
            ctx.fillText(name, pt.x, pt.y);
            placed.push([pt.x - wpx / 2, pt.y - 12, wpx, 20]);
        }
        ctx.globalAlpha = 1;
    }

    function detach() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (map) { map.off('render', onRender); map.off('moveend', ensureTick); }
        if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
        cv = null; ctx = null; live.clear(); leaving.clear(); twCache.clear();
    }

    window.EF_LABELS = { attach, detach, count: () => N };
})();