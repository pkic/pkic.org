const GID = '0';
const CHECKBOX_COLUMN_LETTER = 'H';

// Build base URL dynamically depending on hash filters (selected/status/location)
function buildBaseUrl() {
    const hash = readHash();
    const SHEET_ID = hash.sheet;
    if (!SHEET_ID) {
        throw new Error('sheet parameter required in hash');
    }
    // Decide which question column to select (C=original, D=ai) based on hash.show
    const show = (hash.show && hash.show.toLowerCase() === 'ai') ? 'ai' : 'original';
    const questionCol = (show === 'ai') ? 'D' : 'C';

    const parts = [];
    // If select=all is not present, filter by the checkbox column being TRUE
    if (!(hash.select && hash.select.toLowerCase() === 'all')) {
        parts.push(`${CHECKBOX_COLUMN_LETTER}=TRUE`);
    }

    // Case-insensitive room filter using LOWER(E) = 'value'
    if (hash.location) {
        const loc = String(hash.location).replace(/'/g, "\\'").toLowerCase();
        parts.push(`LOWER(E) = '${loc}'`);
    }

    // Case-insensitive status filter using LOWER(G)
    if (hash.status) {
        const st = String(hash.status).replace(/'/g, "\\'").toLowerCase();
        parts.push(`LOWER(G) = '${st}'`);
    }

    const where = parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
    // Select only asker (B) and the chosen question column to minimize data transferred
    const q = `SELECT B, ${questionCol}${where}`;
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&tq=${encodeURIComponent(q)}`;
}

// Cached elements
const questionTextEl = document.getElementById('question-text');
const askerEl = document.getElementById('question-asker');
let filtered = [];
let current = 0;

function readHash() {
    const h = window.location.hash.replace(/^#/, '');
    const p = new URLSearchParams(h.replace(/&/g, '&'));
    return { sheet: p.get('sheet'), location: p.get('location'), show: p.get('show'), select: p.get('select') };
}

function render() {
    if (!filtered.length) {
        questionTextEl.textContent = 'No selected questions.';
        askerEl.textContent = '';
        return;
    }
    const row = filtered[current];
    // server returns two columns: asker in c[0], question text in c[1]
    const asker = (row && row.c && row.c[0]) ? ((typeof row.c[0].v !== 'undefined') ? row.c[0].v : row.c[0].f) : '';
    const text = (row && row.c && row.c[1]) ? ((typeof row.c[1].v !== 'undefined') ? row.c[1].v : row.c[1].f) : '';

    // Only render both together to avoid partial display on first load
    if (text) {
        questionTextEl.textContent = text;
        askerEl.textContent = asker ? `— ${asker}` : '— Anonymous';
    }
}

async function load() {
    questionTextEl.textContent = 'Loading…';
    askerEl.textContent = '';
    try {
        const res = await fetch(buildBaseUrl());
        const txt = await res.text();
        const jsonText = txt.replace('/*O_o*/', '').trim();
        const data = JSON.parse(jsonText.match(/{.*}/s)[0]);
        // server should return only asker and chosen question column
        filtered = data.table.rows || [];
        current = 0;
        render();
    } catch (e) {
        console.error('load error', e);
        questionTextEl.textContent = 'Error: ' + e.message;
        askerEl.textContent = '';
    }
}

// navigation (keyboard only)
document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (current > 0) { current--; render(); } }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (current < filtered.length - 1) { current++; render(); } }
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); load(); }
});

// initial load
load();
