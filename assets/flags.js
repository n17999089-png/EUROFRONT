/* EUROFRONT — флаги стран, нарисованные примитивами canvas 2D.
   Самодостаточны: ни картинок, ни шрифтов, ни сети — работают в Opera GX, где
   внешние ассеты и удалённые ресурсы режутся. Каждый флаг — мини-программа
   рисования на нормированном поле w×h. Реальные геральдические детали (орлы,
   вензеля) упрощены до читаемого силуэта: на иконке бригады важна узнаваемость
   полотнища, а не филигрань. */
(() => {
'use strict';

const TAU = Math.PI * 2;

function rect(x, c, X, Y, W, H) { x.fillStyle = c; x.fillRect(X, Y, W, H); }
function hbands(x, w, h, arr) {
    const n = arr.length, bh = h / n;
    for (let i = 0; i < n; i++) rect(x, arr[i], 0, i * bh, w, bh + 0.6);
}
function vbands(x, w, h, arr) {
    const n = arr.length, bw = w / n;
    for (let i = 0; i < n; i++) rect(x, arr[i], i * bw, 0, bw + 0.6, h);
}
function disc(x, c, cx, cy, r) { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); }
function poly(x, c, pts) {
    x.fillStyle = c; x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.closePath(); x.fill();
}
function star(x, c, cx, cy, r, rot) {
    x.fillStyle = c; x.beginPath();
    for (let i = 0; i < 5; i++) {
        const a = (rot === undefined ? -Math.PI / 2 : rot) + i * TAU / 5;
        const b = a + Math.PI / 5;
        x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        x.lineTo(cx + Math.cos(b) * r * 0.42, cy + Math.sin(b) * r * 0.42);
    }
    x.closePath(); x.fill();
}
// полумесяц: белый круг минус смещённый круг цвета поля
function crescent(x, c, field, cx, cy, r, ox, oy) {
    disc(x, c, cx, cy, r);
    disc(x, field, cx + ox, cy + oy, r * 0.82);
}
// скандинавский крест: смещён к древку; fimb — оторочка
function nordic(x, w, h, field, cross, fimb) {
    rect(x, field, 0, 0, w, h);
    const t = h * 0.30, vx = w * 0.34;
    const draw = (col, th) => {
        rect(x, col, vx - th / 2, 0, th, h);
        rect(x, col, 0, h / 2 - th / 2, w, th);
    };
    if (fimb) draw(fimb, t * 1.7);
    draw(cross, t);
}
// швейцарский равносторонний крест по центру (не касается краёв)
function plusCross(x, w, h, c) {
    const t = h * 0.22, len = h * 0.62;
    rect(x, c, w / 2 - t / 2, h / 2 - len / 2, t, len);
    rect(x, c, w / 2 - len / 2, h / 2 - t / 2, len, t);
}
// щит-геральдика: прямоугольник со скруглённым низом
function shield(x, c, X, Y, W, H) {
    x.fillStyle = c; x.beginPath();
    x.moveTo(X, Y); x.lineTo(X + W, Y); x.lineTo(X + W, Y + H * 0.62);
    x.quadraticCurveTo(X + W, Y + H, X + W / 2, Y + H);
    x.quadraticCurveTo(X, Y + H, X, Y + H * 0.62);
    x.closePath(); x.fill();
}

const F = {
    'France': (x, w, h) => vbands(x, w, h, ['#0055A4', '#fff', '#EF4135']),
    'Italy': (x, w, h) => vbands(x, w, h, ['#009246', '#fff', '#CE2B37']),
    'Ireland': (x, w, h) => vbands(x, w, h, ['#169B62', '#fff', '#FF883E']),
    'Belgium': (x, w, h) => vbands(x, w, h, ['#000', '#FAE04D', '#F43518']),
    'Romania': (x, w, h) => vbands(x, w, h, ['#002B7F', '#FCD116', '#CE1126']),
    'Moldova': (x, w, h) => {
        vbands(x, w, h, ['#0046AE', '#FFD200', '#CC0921']);
        shield(x, '#C0913B', w * 0.42, h * 0.3, w * 0.16, h * 0.4);
    },
    'Andorra': (x, w, h) => {
        vbands(x, w, h, ['#001B79', '#FFCE00', '#F10600']);
        shield(x, '#B5A25A', w * 0.42, h * 0.28, w * 0.16, h * 0.44);
    },
    'Germany': (x, w, h) => hbands(x, w, h, ['#000', '#DD0000', '#FFCE00']),
    'Netherlands': (x, w, h) => hbands(x, w, h, ['#AE1C28', '#fff', '#21468B']),
    'Luxembourg': (x, w, h) => hbands(x, w, h, ['#ED2939', '#fff', '#00A1DE']),
    'Russia': (x, w, h) => hbands(x, w, h, ['#fff', '#0039A6', '#D52B1E']),
    'Austria': (x, w, h) => hbands(x, w, h, ['#ED2939', '#fff', '#ED2939']),
    'Hungary': (x, w, h) => hbands(x, w, h, ['#CD2A3E', '#fff', '#436F4D']),
    'Bulgaria': (x, w, h) => hbands(x, w, h, ['#fff', '#00966E', '#D62612']),
    'Poland': (x, w, h) => hbands(x, w, h, ['#fff', '#DC143C']),
    'Ukraine': (x, w, h) => hbands(x, w, h, ['#0057B7', '#FFD700']),
    'Belarus': (x, w, h) => {
        rect(x, '#C83138', 0, 0, w, h * 0.66);
        rect(x, '#4AA02C', 0, h * 0.66, w, h * 0.34);
        // орнаментальная полоса у древка: белая с красным ромбовидным узором
        rect(x, '#fff', 0, 0, w * 0.13, h);
        x.fillStyle = '#C83138';
        const cols = 2, rows = 8;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const cx = w * (0.035 + i * 0.055), cy = h * ((j + 0.5) / rows);
            poly(x, '#C83138', [[cx, cy - h * 0.035], [cx + w * 0.02, cy], [cx, cy + h * 0.035], [cx - w * 0.02, cy]]);
        }
    },
    'Lithuania': (x, w, h) => hbands(x, w, h, ['#FDB913', '#006A44', '#C1272D']),
    'Estonia': (x, w, h) => hbands(x, w, h, ['#0072C6', '#000', '#fff']),
    'Latvia': (x, w, h) => {
        rect(x, '#9E3038', 0, 0, w, h);
        rect(x, '#fff', 0, h * 0.4, w, h * 0.2);
    },
    'Monaco': (x, w, h) => hbands(x, w, h, ['#CE1126', '#fff']),
    'San Marino': (x, w, h) => {
        hbands(x, w, h, ['#fff', '#5DBCE8']);
        shield(x, '#8A8F98', w * 0.44, h * 0.28, w * 0.12, h * 0.44);
    },
    'Czechia': (x, w, h) => {
        rect(x, '#fff', 0, 0, w, h / 2);
        rect(x, '#D7141A', 0, h / 2, w, h / 2);
        poly(x, '#11457E', [[0, 0], [w * 0.46, h / 2], [0, h]]);
    },
    'Slovakia': (x, w, h) => {
        hbands(x, w, h, ['#fff', '#0B4EA2', '#EE1C25']);
        shield(x, '#EE1C25', w * 0.16, h * 0.24, w * 0.2, h * 0.5);
        // белый двойной крест на трёх холмах
        rect(x, '#fff', w * 0.245, h * 0.3, w * 0.03, h * 0.34);
        rect(x, '#fff', w * 0.2, h * 0.36, w * 0.12, h * 0.028);
        rect(x, '#fff', w * 0.22, h * 0.42, w * 0.08, h * 0.028);
    },
    'Slovenia': (x, w, h) => {
        hbands(x, w, h, ['#fff', '#005DA4', '#ED1C24']);
        shield(x, '#ED1C24', w * 0.12, h * 0.22, w * 0.16, h * 0.34);
        rect(x, '#005DA4', w * 0.12, h * 0.22, w * 0.16, h * 0.12);
    },
    'Croatia': (x, w, h) => {
        hbands(x, w, h, ['#FF0000', '#fff', '#171796']);
        // шахматная хорватская шаховница в центре
        const sx = w * 0.42, sy = h * 0.3, sw = w * 0.16, sh = h * 0.4;
        shield(x, '#fff', sx, sy, sw, sh);
        const n = 5, m = 4, cw = sw / n, ch = (sh * 0.7) / m;
        x.fillStyle = '#D20000';
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++)
            if ((i + j) % 2 === 0) x.fillRect(sx + i * cw, sy + j * ch, cw + 0.4, ch + 0.4);
    },
    'Serbia': (x, w, h) => {
        hbands(x, w, h, ['#C6363C', '#0C4076', '#fff']);
        shield(x, '#C6363C', w * 0.16, h * 0.26, w * 0.18, h * 0.48);
        rect(x, '#E8C87A', w * 0.22, h * 0.36, w * 0.06, h * 0.24);
    },
    'Montenegro': (x, w, h) => {
        rect(x, '#D60000', 0, 0, w, h);
        x.strokeStyle = '#E8C87A'; x.lineWidth = h * 0.08;
        x.strokeRect(w * 0.06, h * 0.08, w * 0.88, h * 0.84);
        disc(x, '#E8C87A', w * 0.5, h * 0.5, h * 0.16);
    },
    'Bosnia and Herz.': (x, w, h) => {
        rect(x, '#002395', 0, 0, w, h);
        poly(x, '#FECB0B', [[w * 0.42, 0], [w * 0.72, 0], [w * 0.72, h]]);
        x.fillStyle = '#fff';
        for (let i = 0; i < 7; i++) star(x, '#fff', w * 0.36 + i * w * 0.02, h * (0.1 + i * 0.12), h * 0.045);
    },
    'Macedonia': (x, w, h) => {
        rect(x, '#D20000', 0, 0, w, h);
        x.fillStyle = '#FFE600';
        // восемь лучей солнца, расходящихся к краям
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const ex = w / 2 + Math.cos(a) * w, ey = h / 2 + Math.sin(a) * h;
            const nx = Math.cos(a + Math.PI / 2) * h * 0.12, ny = Math.sin(a + Math.PI / 2) * h * 0.12;
            poly(x, '#FFE600', [[w / 2, h / 2], [ex + nx, ey + ny], [ex - nx, ey - ny]]);
        }
        disc(x, '#FFE600', w / 2, h / 2, h * 0.16);
        disc(x, '#D20000', w / 2, h / 2, h * 0.11);
    },
    'Albania': (x, w, h) => {
        rect(x, '#ED1C24', 0, 0, w, h);
        x.fillStyle = '#000';
        // двуглавый орёл — силуэт: тело + два крыла + две головы
        disc(x, '#000', w * 0.5, h * 0.5, h * 0.14);
        poly(x, '#000', [[w * 0.5, h * 0.4], [w * 0.22, h * 0.28], [w * 0.3, h * 0.62], [w * 0.5, h * 0.56]]);
        poly(x, '#000', [[w * 0.5, h * 0.4], [w * 0.78, h * 0.28], [w * 0.7, h * 0.62], [w * 0.5, h * 0.56]]);
        disc(x, '#000', w * 0.42, h * 0.3, h * 0.07);
        disc(x, '#000', w * 0.58, h * 0.3, h * 0.07);
    },
    'Kosovo': (x, w, h) => {
        rect(x, '#2B5DB4', 0, 0, w, h);
        poly(x, '#F5C439', [[w * 0.4, h * 0.42], [w * 0.62, h * 0.38], [w * 0.6, h * 0.66], [w * 0.44, h * 0.6]]);
        for (let i = 0; i < 6; i++) star(x, '#fff', w * (0.28 + i * 0.09), h * (0.22 - Math.abs(i - 2.5) * 0.03), h * 0.045);
    },
    'Greece': (x, w, h) => {
        const n = 9, sh = h / n;
        for (let i = 0; i < n; i++) rect(x, i % 2 ? '#fff' : '#0D5EAF', 0, i * sh, w, sh + 0.6);
        const cw = 5 * sh;
        rect(x, '#0D5EAF', 0, 0, cw, cw);
        rect(x, '#fff', cw / 2 - cw * 0.1, 0, cw * 0.2, cw);
        rect(x, '#fff', 0, cw / 2 - cw * 0.1, cw, cw * 0.2);
    },
    'Turkey': (x, w, h) => {
        rect(x, '#E30A17', 0, 0, w, h);
        crescent(x, '#fff', '#E30A17', w * 0.42, h * 0.5, h * 0.28, h * 0.07, 0);
        star(x, '#fff', w * 0.6, h * 0.5, h * 0.12);
    },
    'Spain': (x, w, h) => {
        rect(x, '#AA151B', 0, 0, w, h);
        rect(x, '#F1BF00', 0, h * 0.25, w, h * 0.5);
        shield(x, '#AA151B', w * 0.16, h * 0.3, w * 0.14, h * 0.4);
        rect(x, '#F1BF00', w * 0.16, h * 0.3, w * 0.14, h * 0.14);
    },
    'Portugal': (x, w, h) => {
        rect(x, '#006600', 0, 0, w * 0.4, h);
        rect(x, '#FF0000', w * 0.4, 0, w * 0.6, h);
        disc(x, '#FFCC00', w * 0.4, h * 0.5, h * 0.19);
        disc(x, '#FF0000', w * 0.4, h * 0.5, h * 0.1);
    },
    'Finland': (x, w, h) => nordic(x, w, h, '#fff', '#003580'),
    'Sweden': (x, w, h) => nordic(x, w, h, '#006AA7', '#FECC02'),
    'Norway': (x, w, h) => nordic(x, w, h, '#BA0C2F', '#002053', '#fff'),
    'Denmark': (x, w, h) => nordic(x, w, h, '#C8102E', '#fff'),
    'Iceland': (x, w, h) => {
        nordic(x, w, h, '#02529C', '#fff', null);
        const t = h * 0.16, vx = w * 0.34;
        rect(x, '#DC1E35', vx - t / 2, 0, t, h);
        rect(x, '#DC1E35', 0, h / 2 - t / 2, w, t);
    },
    'Faeroe Is.': (x, w, h) => nordic(x, w, h, '#fff', '#E31C1D', '#0050AA'),
    'Åland': (x, w, h) => nordic(x, w, h, '#0053A5', '#E31C1D', '#FFD100'),
    'Switzerland': (x, w, h) => { rect(x, '#D52B1E', 0, 0, w, h); plusCross(x, w, h, '#fff'); },
    'United Kingdom': (x, w, h) => {
        rect(x, '#012169', 0, 0, w, h);
        x.save(); x.beginPath(); x.rect(0, 0, w, h); x.clip();
        x.strokeStyle = '#fff'; x.lineWidth = h * 0.22;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
        x.strokeStyle = '#C8102E'; x.lineWidth = h * 0.09;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
        x.restore();
        x.fillStyle = '#fff';
        x.fillRect(w * 0.5 - h * 0.2, 0, h * 0.4, h); x.fillRect(0, h * 0.5 - h * 0.2, w, h * 0.4);
        x.fillStyle = '#C8102E';
        x.fillRect(w * 0.5 - h * 0.12, 0, h * 0.24, h); x.fillRect(0, h * 0.5 - h * 0.12, w, h * 0.24);
    },
    'Malta': (x, w, h) => {
        rect(x, '#fff', 0, 0, w / 2, h);
        rect(x, '#CF142B', w / 2, 0, w / 2, h);
        // крест Георга — белый с красной каймой в углу древка
        rect(x, '#9EA7B3', w * 0.02, h * 0.06, w * 0.16, h * 0.26);
        rect(x, '#fff', w * 0.03, h * 0.07, w * 0.14, h * 0.24);
        x.fillStyle = '#C0392B';
        x.fillRect(w * 0.085, h * 0.09, w * 0.03, h * 0.2);
        x.fillRect(w * 0.045, h * 0.15, w * 0.11, h * 0.035);
    },
    'Cyprus': (x, w, h) => {
        rect(x, '#fff', 0, 0, w, h);
        x.fillStyle = '#C47D3B';
        x.beginPath(); x.ellipse(w * 0.5, h * 0.44, w * 0.2, h * 0.13, 0, 0, TAU); x.fill();
        x.strokeStyle = '#3E7A3E'; x.lineWidth = h * 0.05;
        x.beginPath(); x.arc(w * 0.42, h * 0.66, h * 0.22, -0.4, 1.3); x.stroke();
        x.beginPath(); x.arc(w * 0.58, h * 0.66, h * 0.22, Math.PI - 1.3, Math.PI + 0.4); x.stroke();
    },
    'Liechtenstein': (x, w, h) => {
        rect(x, '#002B7F', 0, 0, w, h * 0.55);
        rect(x, '#CE1126', 0, h * 0.55, w, h * 0.45);
        // корона — золотая дуга с зубцами у древка
        x.fillStyle = '#FCD116';
        x.fillRect(w * 0.1, h * 0.16, w * 0.16, h * 0.08);
        for (let i = 0; i < 3; i++) rect(x, '#FCD116', w * (0.11 + i * 0.06), h * 0.1, w * 0.03, h * 0.08);
    },
    'Vatican': (x, w, h) => {
        rect(x, '#F6E27F', 0, 0, w / 2, h);
        rect(x, '#fff', w / 2, 0, w / 2, h);
        // скрещённые ключи + тиара (упрощённо) на белом поле
        x.strokeStyle = '#9AA0A6'; x.lineWidth = h * 0.06;
        x.beginPath(); x.moveTo(w * 0.66, h * 0.72); x.lineTo(w * 0.86, h * 0.42); x.stroke();
        x.beginPath(); x.moveTo(w * 0.86, h * 0.72); x.lineTo(w * 0.66, h * 0.42); x.stroke();
        disc(x, '#C0C4C9', w * 0.66, h * 0.4, h * 0.06);
        disc(x, '#C0C4C9', w * 0.86, h * 0.4, h * 0.06);
    },
    'Isle of Man': (x, w, h) => {
        rect(x, '#E82029', 0, 0, w, h);
        // трискелион — три согнутые руки (упрощённо: три луча из центра)
        x.strokeStyle = '#fff'; x.lineWidth = h * 0.12; x.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            const a = i * TAU / 3 - Math.PI / 2;
            x.beginPath(); x.moveTo(w / 2, h / 2);
            x.lineTo(w / 2 + Math.cos(a) * h * 0.3, h / 2 + Math.sin(a) * h * 0.3);
            x.lineTo(w / 2 + Math.cos(a + 0.9) * h * 0.34, h / 2 + Math.sin(a + 0.9) * h * 0.34);
            x.stroke();
        }
        x.lineCap = 'butt';
    },
    // соседи вне театра — для полноты легенды и запасных ролей
    'Georgia': (x, w, h) => {
        rect(x, '#fff', 0, 0, w, h);
        rect(x, '#FF0000', w / 2 - h * 0.09, 0, h * 0.18, h);
        rect(x, '#FF0000', 0, h / 2 - h * 0.09, w, h * 0.18);
        const t = h * 0.05;
        for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
            rect(x, '#FF0000', w * cx - t / 2, h * cy - t * 1.6, t, t * 3.2);
            rect(x, '#FF0000', w * cx - t * 1.4, h * cy - t / 2, t * 2.8, t);
        }
    },
    'Armenia': (x, w, h) => hbands(x, w, h, ['#D90012', '#0033A0', '#F2A800']),
    'Azerbaijan': (x, w, h) => {
        hbands(x, w, h, ['#00B5E2', '#EF3340', '#509E2F']);
        crescent(x, '#fff', '#EF3340', w * 0.46, h * 0.5, h * 0.16, h * 0.05, 0);
        star(x, '#fff', w * 0.62, h * 0.5, h * 0.09);
    },
    'Morocco': (x, w, h) => {
        rect(x, '#C1272D', 0, 0, w, h);
        x.strokeStyle = '#006233'; x.lineWidth = h * 0.05;
        x.beginPath();
        for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * 4 * Math.PI / 5; const px = w / 2 + Math.cos(a) * h * 0.28, py = h / 2 + Math.sin(a) * h * 0.28; i ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.closePath(); x.stroke();
    },
    'Algeria': (x, w, h) => {
        rect(x, '#006233', 0, 0, w / 2, h);
        rect(x, '#fff', w / 2, 0, w / 2, h);
        crescent(x, '#D21034', '#fff', w * 0.5, h * 0.5, h * 0.22, h * 0.06, 0);
        star(x, '#D21034', w * 0.56, h * 0.5, h * 0.1);
    },
    'Tunisia': (x, w, h) => {
        rect(x, '#E70013', 0, 0, w, h);
        disc(x, '#fff', w / 2, h / 2, h * 0.3);
        crescent(x, '#E70013', '#fff', w * 0.48, h * 0.5, h * 0.2, h * 0.06, 0);
        star(x, '#E70013', w * 0.56, h * 0.5, h * 0.09);
    },
    'Libya': (x, w, h) => {
        rect(x, '#E70013', 0, 0, w, h * 0.25);
        rect(x, '#000', 0, h * 0.25, w, h * 0.5);
        rect(x, '#239E46', 0, h * 0.75, w, h * 0.25);
        crescent(x, '#fff', '#000', w * 0.48, h * 0.5, h * 0.16, h * 0.05, 0);
        star(x, '#fff', w * 0.58, h * 0.5, h * 0.08);
    },
    'Egypt': (x, w, h) => {
        hbands(x, w, h, ['#CE1126', '#fff', '#000']);
        x.fillStyle = '#C0933F'; disc(x, '#C0933F', w / 2, h / 2, h * 0.12);
    },
    'Syria': (x, w, h) => {
        hbands(x, w, h, ['#CE1126', '#fff', '#000']);
        star(x, '#007A3D', w * 0.36, h / 2, h * 0.11);
        star(x, '#007A3D', w * 0.64, h / 2, h * 0.11);
    },
    'Iraq': (x, w, h) => {
        hbands(x, w, h, ['#CE1126', '#fff', '#000']);
        x.fillStyle = '#007A3D';
        for (let i = 0; i < 3; i++) rect(x, '#007A3D', w * (0.42 + i * 0.06), h * 0.44, w * 0.03, h * 0.12);
    },
    'Kazakhstan': (x, w, h) => {
        rect(x, '#00AFCA', 0, 0, w, h);
        disc(x, '#FEC50C', w * 0.55, h * 0.5, h * 0.16);
        x.strokeStyle = '#FEC50C'; x.lineWidth = h * 0.04;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(w * 0.55 + Math.cos(a) * h * 0.2, h * 0.5 + Math.sin(a) * h * 0.2); x.lineTo(w * 0.55 + Math.cos(a) * h * 0.3, h * 0.5 + Math.sin(a) * h * 0.3); x.stroke(); }
        rect(x, '#FEC50C', w * 0.04, 0, w * 0.06, h);
    },
    'Iran': (x, w, h) => {
        hbands(x, w, h, ['#239F40', '#fff', '#DA0000']);
        disc(x, '#DA0000', w / 2, h / 2, h * 0.1);
    }
};

// нейтральная подложка: цвет страны + буква названия, если полотнище не описано
function draw(x, name, w, h, color) {
    const fn = F[name];
    if (fn) { fn(x, w, h); return true; }
    rect(x, color || '#5c5346', 0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.font = 'bold ' + Math.round(h * 0.5) + 'px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((name || '?').slice(0, 1).toUpperCase(), w / 2, h / 2 + 1);
    return false;
}

function makeCanvas(name, w, h, color) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), name, w, h, color);
    return c;
}

window.EF_FLAGS = {
    has: name => !!F[name],
    draw,
    canvas: makeCanvas,
    imageData(name, w, h, color) {
        const c = makeCanvas(name, w, h, color);
        return c.getContext('2d').getImageData(0, 0, w, h);
    },
    dataURL(name, w, h, color) { return makeCanvas(name, w, h, color).toDataURL('image/png'); }
};

})();
