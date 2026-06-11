// ==========================================
// FEEDBACK MODAL
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById('feedbackModal');
    const openBtn = document.getElementById('feedbackBtn');
    const closeBtn = document.getElementById('closeModal');
    const form = document.getElementById('feedbackForm');

    // Öffnen
    openBtn.addEventListener('click', () => modal.style.display = 'flex');

    // Schließen
    closeBtn.addEventListener('click', () => modal.style.display = 'none');

    // Absenden (nach kurzem Timeout schließen)
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        setTimeout(() => {
            alert("Vielen Dank für dein Feedback!");
            modal.style.display = 'none';
            form.reset();
        }, 500);
    });

    if (typeof ensureGradeToolUi === 'function') {
        ensureGradeToolUi(document);
    }

    // Notenbuch & Klassenliste sind jetzt im Drucken-Menü integriert
    document.getElementById('open-gradebook-btn')?.addEventListener('click', () => {
        const ctx = (typeof getActiveContext === 'function') ? getActiveContext() : null;
        const lnw = ctx?.activeLNW;
        if (!lnw) return alert('Bitte wähle zuerst eine Klasse aus!');
        openGradeBook(lnw);
    });
    document.getElementById('open-classlist-btn')?.addEventListener('click', () => {
        const ctx = (typeof getActiveContext === 'function') ? getActiveContext() : null;
        const cls = ctx?.activeClass;
        if (!cls) return alert('Bitte wähle zuerst eine Klasse aus!');
        openClassListModal(cls);
    });
});

// ==========================================
// STUDENT MODE SWITCHER (Rückmeldung <-> Notenbuch)
// ==========================================

function switchStudentMode(page, newMode, lnwWrapper) {
    if (!page) return;

    page.setAttribute('data-student-mode', newMode);

    const studentPages = lnwWrapper ? lnwWrapper.querySelectorAll('.page') : [];

    if (newMode === 'noten') {
        // Wechsel zu Notenbuch-Modus
        studentPages.forEach(p => p.style.display = 'none');
        const panel = ensureGradePanel(page, lnwWrapper);
        if (panel) {
            panel.style.display = 'block';
            renderGradePanel(panel, page, lnwWrapper);
        }
        page.style.display = 'none';
    } else {
        // Wechsel zu Rückmeldung-Modus
        studentPages.forEach(p => p.style.display = 'none');
        page.style.display = 'block';
        const panel = lnwWrapper?.querySelector(`.grade-panel[data-student="${page.id}"]`);
        if (panel) panel.style.display = 'none';
    }

    // Tab-Markierung (gelber Rand nur bei Noten)
    const tab = lnwWrapper?.querySelector(`.student-app-tab[data-target="${page.id}"]`);
    if (tab) tab.classList.toggle('grade-mode', newMode === 'noten');

    if (typeof window.updateStudentTabStatus === 'function') window.updateStudentTabStatus(page);
    if (typeof updateGradeUiState === 'function') updateGradeUiState(lnwWrapper);
}

// Jahrgangsstufe aus dem Klassennamen lesen (z. B. "9a" -> 9, "10c" -> 10)
function classLevel(cls) {
    const m = String(cls?.getAttribute('data-klasse') || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// Welche Fächer haben in Stufe 9/10 eine Prüfungs-/Jahresleistung?
// Stufe 9: Mathe, Deutsch, Englisch (Hauptschulabschluss)
// Stufe 10: zusätzlich WPF Technik, WPF Französisch, WPF AES (Realschulabschluss)
function examSubjectAllowed(fach, level) {
    const f = (fach || '').toLowerCase();
    const base = f.includes('mathe') || f.includes('deutsch') || f.includes('englisch');
    if (level === 9) return base;
    if (level === 10) return base || f.includes('technik') || f.includes('franz') || f.includes('aes');
    return false;
}

// Prüfungsmodus (Abschlussklasse) optisch anwenden – nur Stufe 9 & 10
function applyExamMode(cls) {
    if (!cls) return;
    const level = classLevel(cls);
    const eligible = level === 9 || level === 10;
    if (!eligible && cls.dataset.examMode === 'true') cls.dataset.examMode = 'false';
    const on = cls.dataset.examMode === 'true' && eligible;

    const subject = cls.closest('.subject-wrapper');
    const tab = subject?.querySelector(`.class-app-tab[data-target="${cls.id}"]`);
    if (tab) tab.classList.toggle('exam-class', on);

    const btn = cls.querySelector('.exam-mode-btn');
    if (btn) {
        btn.style.display = eligible ? '' : 'none';   // nur in Stufe 9/10 sichtbar
        btn.classList.toggle('active', on);
        btn.textContent = on ? '🎓 Abschlussklasse ✓' : '🎓 Prüfungsmodus';
        btn.title = on ? 'Prüfungsmodus aktiv – klicken zum Deaktivieren' : 'Diese Klasse als Abschlussklasse markieren';
    }

    // Alte Banner aus früheren Ständen entfernen (Text war unnötig)
    const ribbon = cls.querySelector(':scope > .exam-ribbon');
    if (ribbon) ribbon.remove();
}

// ------------------------------------------------------------------
// ABSCHLUSSKLASSE: Prüfungs-/Jahresleistung mit unterteilter Jahresleistung.
// Gespeichert wird FLACH (data-grade-categories, Summe 100 %), damit die
// gesamte Notenrechnung unverändert funktioniert. Die Hierarchie selbst
// steht in data-exam-split, damit das Fenster sie wieder anzeigen kann.
// ------------------------------------------------------------------
let _examConfigSubject = null;
let _examConfigPId = '';

function openExamCategoryConfig(lnw) {
    if (!lnw) return;
    const subject = lnw.closest('.subject-wrapper');
    if (!subject) return;
    _examConfigSubject = subject;
    const fach = subject.getAttribute('data-fach') || '';
    const titleEl = document.getElementById('exam-config-title');
    if (titleEl) titleEl.textContent = fach ? `🎓 Abschlussklasse · ${fach}` : '🎓 Abschlussklasse · Notenverrechnung';

    let split = null;
    try { split = JSON.parse(subject.getAttribute('data-exam-split') || 'null'); } catch (e) {}
    if (!split) {
        // Bestehende Kategorien werden zur Unterteilung der Jahresleistung –
        // bereits eingetragene Noten bleiben dadurch vollständig erhalten.
        const cur = getGradeCategories(lnw).filter(c => c.group !== 'pruefung');
        const sum = cur.reduce((s, c) => s + (c.weight || 0), 0) || 1;
        split = {
            pId: 'cat_' + Date.now() + '_pr',
            pName: 'Prüfungsleistung', pWeight: 50,
            jName: 'Jahresleistung', jWeight: 50,
            subs: cur.map(c => ({ id: c.id, name: c.name, type: c.type || 'schriftlich', weight: Math.round((c.weight || 0) / sum * 100) }))
        };
        const s2 = split.subs.reduce((s, c) => s + c.weight, 0);
        if (split.subs.length) split.subs[split.subs.length - 1].weight += 100 - s2;
    }
    _examConfigPId = split.pId || ('cat_' + Date.now() + '_pr');
    document.getElementById('exam-p-name').value = split.pName || 'Prüfungsleistung';
    document.getElementById('exam-p-weight').value = (split.pWeight ?? 50);
    document.getElementById('exam-j-name').value = split.jName || 'Jahresleistung';
    document.getElementById('exam-j-weight').value = 100 - (split.pWeight ?? 50);
    document.getElementById('exam-sub-list').innerHTML = (split.subs || []).map(s => catRowHtml(s)).join('');
    document.getElementById('exam-config-modal').style.display = 'flex';
}

// Öffnet je nach Fach den passenden Kategorien-Editor:
// Abschlussfach mit Verrechnung -> hierarchisches Fenster, sonst das normale.
function openCategoryConfigSmart(lnw) {
    const subject = lnw?.closest('.subject-wrapper');
    if (subject && subject.getAttribute('data-exam-split')) openExamCategoryConfig(lnw);
    else openGradeConfig(lnw);
}

function ensureSwitchButton(page) {
    const row = page.querySelector('.comment-buttons-row');
    if (row && !row.querySelector('.switch-to-noten-btn')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'app-btn switch-to-noten-btn';
        btn.style.cssText = 'font-size:12px; padding:6px 10px; margin-left:auto;';
        btn.title = 'Diesen Schüler auf Noten-Eingabe umschalten';
        btn.textContent = '📊 Noten erfassen';
        row.appendChild(btn);
    }
}

// Baut die Klassen-Werkzeugleiste in eine aufgeräumte, einheitliche Struktur um.
// Vorhandene Auswahl (LNW-Select) und das Suchfeld bleiben erhalten.
function lnwMakeBtn(cls, label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-btn ' + cls;
    b.textContent = label;
    if (title) b.title = title;
    return b;
}
function lnwMakeItem(cls, label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dropdown-item-btn ' + cls;
    b.textContent = label;
    if (title) b.title = title;
    return b;
}
function canonicalizeLnwBar(bar) {
    if (!bar) return;
    if (bar.dataset.canon === '1') {
        const lupe0 = bar.querySelector('.global-search-toggle-btn');
        if (lupe0) { lupe0.textContent = '🔎'; lupe0.classList.remove('active'); }
        return;
    }

    // Erhaltenswerte Elemente herauslösen
    let select = bar.querySelector('.lnw-select');
    let searchInput = bar.querySelector('.student-search-input');
    const badgeText = bar.querySelector('.student-count-badge')?.textContent || '0 Schüler';

    bar.innerHTML = '';
    bar.dataset.canon = '1';

    // LINKS – Lernnachweis-Verwaltung
    const left = document.createElement('div');
    left.className = 'lnw-bar-left';
    const label = document.createElement('span');
    label.className = 'lnw-bar-label';
    label.textContent = '📑 Lernnachweis';
    if (!select) { select = document.createElement('select'); select.className = 'lnw-select'; }
    left.append(label, select,
        lnwMakeBtn('add-lnw-btn icon-btn', '＋', 'Neuen Lernnachweis hinzufügen'),
        lnwMakeBtn('delete-lnw-btn danger-btn icon-btn', '🗑', 'Diesen Lernnachweis löschen'));

    // RECHTS – Ansicht / Mehr / Zähler / Suche
    const right = document.createElement('div');
    right.className = 'lnw-bar-right';

    const seg = document.createElement('div');
    seg.className = 'seg-toggle';
    seg.append(
        lnwMakeBtn('bulk-feedback-mode-btn', 'Rückmeldung', 'Alle Schüler dieser Klasse: Rückmeldung anzeigen'),
        lnwMakeBtn('bulk-grade-mode-btn', 'Noten', 'Alle Schüler dieser Klasse: Noten anzeigen')
    );

    const dd = document.createElement('div');
    dd.className = 'dropdown lnw-more';
    const ddBtn = document.createElement('button');
    ddBtn.type = 'button';
    ddBtn.className = 'app-btn';
    ddBtn.textContent = '⚙️ Mehr ▾';
    const ddc = document.createElement('div');
    ddc.className = 'dropdown-content';
    const catItem = lnwMakeItem('grade-categories-btn', '⚙️ Noten-Kategorien', 'Kategorien für dieses Fach festlegen');
    catItem.style.display = 'none'; // Sichtbarkeit steuert updateGradeUiState
    ddc.append(
        lnwMakeItem('hotspots-btn', '🔥 Wo brennt es?', 'Auswertung der Klasse'),
        catItem,
        lnwMakeItem('exam-mode-btn', '🎓 Prüfungsmodus', 'Klasse als Abschlussklasse markieren (Stufe 9/10)')
    );
    dd.append(ddBtn, ddc);

    const badge = document.createElement('span');
    badge.className = 'student-count-badge';
    badge.textContent = badgeText;

    const searchWrap = document.createElement('div');
    searchWrap.className = 'search-input-wrap';
    if (!searchInput) {
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'student-search-input';
        searchInput.placeholder = '🔍 Name suchen...';
    }
    searchWrap.append(searchInput, lnwMakeBtn('global-search-toggle-btn', '🔎', 'Globale Schülersuche (alle Fächer & Klassen)'));

    right.append(seg, dd, badge, searchWrap);
    bar.append(left, right);
}

function ensureGradeToolUi(root = document) {
    // Alt-Noten in den Klassen-Store überführen / UIDs sicherstellen
    if (typeof migrateGradesToClassStore === 'function') migrateGradesToClassStore(root);

    root.querySelectorAll('.class-wrapper').forEach(classWrapper => {
        const bar = classWrapper.querySelector('.lnw-level-bar');
        if (!bar) return;
        canonicalizeLnwBar(bar);
        applyExamMode(classWrapper);
    });

    root.querySelectorAll('.lnw-wrapper').forEach(lnwWrapper => {
        lnwWrapper.querySelectorAll('.workspace .page').forEach(page => {
            const tab = lnwWrapper.querySelector(`.student-app-tab[data-target="${page.id}"]`);
            // Alte Emoji-Umschalt-Buttons aus den Tabs entfernen
            tab?.querySelectorAll('.mode-toggle-btn').forEach(b => b.remove());
            // Gelbe Tab-Markierung an gespeicherten Modus angleichen
            if (tab) tab.classList.toggle('grade-mode', (page.getAttribute('data-student-mode') || 'rueckmeldung') === 'noten');
            // "Noten erfassen"-Button im Dokument sicherstellen
            ensureSwitchButton(page);
            ensureGradePanel(page, lnwWrapper);
            // Niveau-Wähler an gespeicherte Zuordnung angleichen
            const nivSel = page.querySelector('.student-niveau-select');
            if (nivSel) {
                const nv = page.dataset.studentNiveau || '';
                nivSel.value = nv;
                if (nv) nivSel.setAttribute('data-niv', nv); else nivSel.removeAttribute('data-niv');
            }
        });
        if (typeof updateGradeUiState === 'function') updateGradeUiState(lnwWrapper);
    });
}

// Steuert die Sichtbarkeit des Kategorien-Buttons:
// - In der Klassenleiste sichtbar, wenn ALLE Schüler im Notenmodus sind.
// - Bei einzelnen Noten-Schülern erscheint der Button stattdessen im jeweiligen Schüler-Panel.
function updateGradeUiState(lnwWrapper) {
    if (!lnwWrapper) return;
    const cls = lnwWrapper.closest('.class-wrapper');
    const pages = Array.from(lnwWrapper.querySelectorAll('.workspace .page'));
    const allNoten = pages.length > 0 && pages.every(p => (p.getAttribute('data-student-mode') || 'rueckmeldung') === 'noten');

    if (cls && lnwWrapper.classList.contains('active')) {
        const catBtn = cls.querySelector('.grade-categories-btn');
        if (catBtn) catBtn.style.display = allNoten ? '' : 'none';
    }

    // Sichtbare Panels neu zeichnen, damit ihr eigener Kategorien-Button passt
    lnwWrapper.querySelectorAll('.grade-panel').forEach(panel => {
        if (panel.style.display !== 'none') {
            const sid = panel.getAttribute('data-student');
            const page = lnwWrapper.querySelector('#' + sid);
            if (page) renderGradePanel(panel, page, lnwWrapper);
        }
    });
}

// ==========================================
// NOTENBUCH (GRADE BOOK) - FUNKTIONEN
// ==========================================

let _nbCurrentLNW = null;
let _nbCurrentGradeSubject = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function getStudentNameFromPage(page) {
    return page?.querySelector('.student-name-input')?.value.trim() || 'Neuer Schüler';
}

function splitStudentName(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return { first: '', last: '' };
    if (clean.includes(',')) {
        const [last, first] = clean.split(',').map(part => part.trim());
        return { first: first || '', last: last || '' };
    }
    const parts = clean.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function formatStudentName(name, mode = 'first-last') {
    const parts = splitStudentName(name);
    if (mode === 'last-first') return [parts.last, parts.first].filter(Boolean).join(', ') || name;
    return [parts.first, parts.last].filter(Boolean).join(' ') || name;
}

function compareStudentNames(a, b, mode = 'first-last') {
    const pa = splitStudentName(a);
    const pb = splitStudentName(b);
    const ak = mode === 'last-first' ? `${pa.last} ${pa.first}` : `${pa.first} ${pa.last}`;
    const bk = mode === 'last-first' ? `${pb.last} ${pb.first}` : `${pb.first} ${pb.last}`;
    return ak.localeCompare(bk, 'de', { sensitivity: 'base' });
}

function getGradeValueOptions(selectedValue = '') {
    let html = '';
    for (let i = 10; i <= 60; i++) {
        const value = (i / 10).toFixed(1);
        const label = value.replace('.', ',');
        html += `<option value="${value}" ${String(selectedValue) === value ? 'selected' : ''}>${label}</option>`;
    }
    return html;
}

function fmtGradeValue(n) {
    return Number(n).toFixed(1).replace('.', ',');
}

function fmtDateDE(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function niveauOptionsHtml(sel) {
    return ['', 'G', 'M', 'E'].map(v => `<option value="${v}" ${sel === v ? 'selected' : ''}>${v === '' ? 'Auto' : v}</option>`).join('');
}

// Effektives Niveau eines Schülers: manuell gewählt, sonst automatisch
// abgeleitet aus dem Niveau-Abschnitt mit den meisten gesetzten schwarzen Kreuzen.
function effectiveNiveau(page) {
    const manual = page?.dataset.studentNiveau;
    if (manual === 'G' || manual === 'M' || manual === 'E') return manual;
    let best = null, bestCount = 0;
    ['G', 'M', 'E'].forEach(n => {
        const sec = page?.querySelector(`.niveau-section[data-section="${n}"]`);
        if (!sec) return;
        let c = 0;
        sec.querySelectorAll('tr[data-row-id] .x-marker-black').forEach(bx => { if (!bx.classList.contains('inactive')) c++; });
        if (c > bestCount) { bestCount = c; best = n; }
    });
    return best;
}

function getActiveLNWFromButton(button) {
    const cls = button?.closest('.class-wrapper');
    return cls?.querySelector('.lnw-wrapper.active') || cls?.querySelector('.lnw-wrapper') || null;
}

function getGradeCategories(lnwWrapper) {
    const subject = lnwWrapper?.closest('.subject-wrapper');
    let raw = subject?.getAttribute('data-grade-categories') || lnwWrapper?.getAttribute('data-grade-categories');
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    const defs = [
        { id: 'cat_' + Date.now() + 'a', name: 'Schriftlich', weight: 50, type: 'schriftlich' },
        { id: 'cat_' + (Date.now()+1) + 'b', name: 'Mündlich', weight: 50, type: 'muendlich' }
    ];
    if (subject) subject.setAttribute('data-grade-categories', JSON.stringify(defs));
    else if (lnwWrapper) lnwWrapper.setAttribute('data-grade-categories', JSON.stringify(defs));
    return defs;
}

// Filtert die Schüler-Tabs innerhalb einer Klasse.
// Die Suche über alle Fächer/Klassen läuft über das globale Such-Modal (openGlobalStudentSearch).
function updateStudentSearchResults(term, classWrapper) {
    if (!classWrapper) return;
    const needle = String(term || '').toLowerCase().trim();
    classWrapper.querySelectorAll('.student-app-tab').forEach(tab => {
        const name = tab.querySelector('span')?.textContent.toLowerCase() || '';
        tab.style.display = (needle === '' || name.includes(needle)) ? 'flex' : 'none';
    });
}

// ------------------------------------------------------------------
// NOTEN-SPEICHER: pro Schüler (stabile UID) auf Klassen-Ebene.
// Dadurch sind alle Noten in JEDEM Lernnachweis derselben Klasse sichtbar –
// man muss nicht mehr über das LNW-Dropdown wechseln.
// ------------------------------------------------------------------
function studentKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getPanelPage(panel) {
    const lnw = panel?.closest('.lnw-wrapper');
    return lnw ? lnw.querySelector('#' + panel.getAttribute('data-student')) : null;
}

function getStudentUid(page) {
    if (!page) return '';
    if (!page.dataset.studentUid) {
        page.dataset.studentUid = 'su_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
    return page.dataset.studentUid;
}

function getClassGradeStore(cls) {
    if (!cls) return {};
    try { return JSON.parse(cls.dataset.gradeStore || '{}'); } catch { return {}; }
}

function setClassGradeStore(cls, store) {
    if (cls) cls.dataset.gradeStore = JSON.stringify(store);
}

function getStudentGrades(panel) {
    if (!panel) return [];
    const cls = panel.closest('.class-wrapper');
    const page = getPanelPage(panel);
    if (cls && page) {
        const store = getClassGradeStore(cls);
        const arr = store[getStudentUid(page)];
        return Array.isArray(arr) ? arr : [];
    }
    try { return JSON.parse(panel.getAttribute('data-grades') || '[]'); } catch { return []; }
}

function setStudentGrades(panel, grades) {
    const cls = panel?.closest('.class-wrapper');
    const page = getPanelPage(panel);
    if (cls && page) {
        const store = getClassGradeStore(cls);
        store[getStudentUid(page)] = grades;
        setClassGradeStore(cls, store);
    }
    // Alt-Spiegel leeren – Klassen-Store ist die alleinige Quelle
    if (panel) panel.setAttribute('data-grades', '[]');
}

// Einmalige Migration: stabile Schüler-UIDs vergeben und Alt-Noten
// (pro Panel gespeichert) in den Klassen-Store überführen.
function migrateGradesToClassStore(root = document) {
    root.querySelectorAll('.class-wrapper').forEach(cls => {
        const nameToUid = {};
        const store = getClassGradeStore(cls);
        let changed = false;
        cls.querySelectorAll('.lnw-wrapper .workspace .page').forEach(page => {
            const key = studentKey(getStudentNameFromPage(page));
            if (page.dataset.studentUid) {
                if (!nameToUid[key]) nameToUid[key] = page.dataset.studentUid;
            } else {
                if (!nameToUid[key]) nameToUid[key] = 'su_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                page.dataset.studentUid = nameToUid[key];
            }
            const uid = page.dataset.studentUid;
            const panel = cls.querySelector(`.grade-panel[data-student="${page.id}"]`);
            const legacy = panel?.getAttribute('data-grades');
            if (legacy && legacy !== '[]') {
                let arr = Array.isArray(store[uid]) ? store[uid] : [];
                try { JSON.parse(legacy).forEach(g => { if (!arr.some(x => x.id === g.id)) arr.push(g); }); } catch (e) {}
                store[uid] = arr;
                panel.setAttribute('data-grades', '[]'); // Alt-Spiegel leeren
                changed = true;
            }
        });
        if (changed) setClassGradeStore(cls, store);
    });
}

function calcCatAvg(grades, catId) {
    const g = grades.filter(x => x.catId === catId);
    return g.length ? g.reduce((s, x) => s + x.value, 0) / g.length : null;
}

function calcTotal(grades, cats) {
    let ws = 0, wt = 0;
    cats.forEach(cat => {
        const avg = calcCatAvg(grades, cat.id);
        if (avg !== null) { ws += avg * cat.weight; wt += cat.weight; }
    });
    return wt > 0 ? ws / wt : null;
}

function fmtNote(n) { return (n !== null && n !== undefined) ? n.toFixed(2).replace('.', ',') : '–'; }

function ensureGradePanel(page, lnwWrapper) {
    if (!page || !lnwWrapper) return null;
    const id = page.id;
    let panel = lnwWrapper.querySelector(`.grade-panel[data-student="${id}"]`);
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'grade-panel';
        panel.setAttribute('data-student', id);
        panel.setAttribute('data-grades', '[]');
        panel.style.display = 'none';
        page.after(panel);
    }
    return panel;
}

function renderGradePanel(panel, page, lnwWrapper) {
    if (!panel || !page) return;
    const cats     = getGradeCategories(lnwWrapper);
    const grades   = getStudentGrades(panel);
    const name     = getStudentNameFromPage(page);
    const total    = calcTotal(grades, cats);
    const totalBad = total !== null && total >= 4.5;

    // Kategorien-Button erscheint hier nur, wenn NICHT alle Schüler Noten bekommen
    // (bei "alle Noten" steht er in der Klassenleiste).
    const pages    = Array.from(lnwWrapper.querySelectorAll('.workspace .page'));
    const allNoten = pages.length > 0 && pages.every(p => (p.getAttribute('data-student-mode') || 'rueckmeldung') === 'noten');

    const nv = page.dataset.studentNiveau || '';
    let html = `<div class="grade-panel-header">
        <span class="grade-panel-title">📊 Noten · <input class="nb-name-edit" data-student="${page.id}" value="${escapeHtml(name)}" placeholder="Name…" title="Schülername bearbeiten"></span>
        <div class="grade-panel-actions">
            <span class="grade-niveau-pick"><span class="student-niveau-label">👤 Niveau:</span>
                <select class="student-niveau-select" data-student="${page.id}" ${nv ? `data-niv="${nv}"` : ''} title="Auf welchem Niveau arbeitet dieser Schüler?">${niveauOptionsHtml(nv)}</select></span>
            ${!allNoten ? `<button class="app-btn nb-config-btn" data-student="${page.id}" title="Noten-Kategorien für dieses Fach festlegen">⚙️ Kategorien</button>` : ''}
            <button class="app-btn primary-btn nb-switch-rb" data-student="${page.id}">📋 Zur Rückmeldung</button>
        </div>
    </div>`;

    html += `<div class="grade-cats-where">Kategorien & Gewichtung gelten für das ganze Fach – änderbar über ${allNoten ? '„⚙️ Mehr → Noten-Kategorien" in der Klassenleiste' : 'den Button „⚙️ Kategorien" oben rechts'}.</div>`;

    html += `<div class="grade-total-banner ${totalBad ? 'gt-bad' : ''}">
        <span class="gt-label">Gesamtnote</span>
        <span class="gt-value">${fmtNote(total)}</span>
    </div>`;

    cats.forEach(cat => {
        const cGrades = grades.filter(g => g.catId === cat.id);
        const cAvg    = calcCatAvg(grades, cat.id);
        html += `<div class="grade-cat-section">
            <div class="grade-cat-hd">
                <span class="grade-cat-name">${escapeHtml(cat.name)} <span class="grade-cat-weight">Gewichtung ${cat.weight} %</span>${cat.groupLabel && cat.groupLabel !== cat.name ? `<span class="cat-group-tag">${escapeHtml(cat.groupLabel)}${cat.subWeight ? ' · ' + cat.subWeight + ' %' : ''}</span>` : ''}</span>
                ${cAvg !== null
                    ? `<span class="grade-cat-avg badge ${cAvg >= 4.5 ? 'nb-bad' : ''}">Ø ${fmtNote(cAvg)}</span>`
                    : `<span class="grade-cat-avg badge muted">noch keine Note</span>`}
            </div>
            <table class="grade-entries-table">
                <thead><tr><th>Bezeichnung</th><th style="width:110px">Datum</th><th style="width:62px">Note</th><th style="width:34px"></th></tr></thead>
                <tbody>${cGrades.length ? cGrades.map(g => `
                    <tr>
                        <td><input class="nb-grade-field nb-edit-name" data-gid="${g.id}" data-sid="${page.id}" value="${escapeHtml(g.name)}" placeholder="Bezeichnung"></td>
                        <td><input type="date" class="nb-grade-field nb-edit-date" data-gid="${g.id}" data-sid="${page.id}" value="${escapeHtml(g.date)}"></td>
                        <td><input type="number" step="0.1" min="1" max="6" inputmode="decimal" class="nb-grade-field nb-edit-val ${g.value >= 4.5 ? 'nb-bad' : ''}" data-gid="${g.id}" data-sid="${page.id}" value="${g.value}"></td>
                        <td><button class="grade-del-btn" data-gid="${g.id}" data-sid="${page.id}" title="Eintrag löschen">×</button></td>
                    </tr>
                `).join('') : `<tr><td colspan="4" class="grade-no-entries">Noch keine Einträge in dieser Kategorie.</td></tr>`}</tbody>
            </table>
            <div class="grade-add-row">
                <input type="text" class="nb-add-name" placeholder="Bezeichnung (z. B. Klassenarbeit 1)">
                <input type="date" class="nb-add-date" value="${new Date().toISOString().split('T')[0]}">
                <input type="number" class="nb-add-val" placeholder="Note" step="0.1" min="1" max="6" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*">
                <button class="grade-add-btn" data-cat="${cat.id}" data-sid="${page.id}">+ Eintrag</button>
            </div>
        </div>`;
    });

    panel.innerHTML = html;
}

function getCatConfigFromForm() {
    return Array.from(document.querySelectorAll('#nb-cat-list .nb-cat-row')).map(row => ({
        id:     row.querySelector('.nb-name-inp').getAttribute('data-cat-id'),
        name:   row.querySelector('.nb-name-inp').value.trim() || 'Kategorie',
        weight: Math.round(parseFloat(row.querySelector('.nb-weight-inp').value) || 0),
        type:   row.querySelector('.nb-type-inp')?.value || 'schriftlich'
    }));
}

// Sorgt dafür, dass die Gewichtungen automatisch 100 % ergeben:
// Ändert man eine Kategorie, verteilen sich die übrigen entsprechend.
// Funktioniert pro Liste ([data-weight-scope]), z. B. auch für die Jahresleistungs-Kategorien.
function rebalanceCatWeights(changedInput) {
    const scope = changedInput.closest('[data-weight-scope]') || document.getElementById('nb-cat-list');
    const inputs = Array.from(scope.querySelectorAll('.nb-weight-inp'));
    if (inputs.length === 0) return;
    if (inputs.length === 1) { inputs[0].value = 100; return; }

    let changedVal = Math.max(0, Math.min(100, Math.round(parseFloat(changedInput.value) || 0)));
    changedInput.value = changedVal;

    const others = inputs.filter(i => i !== changedInput);
    const remaining = 100 - changedVal;
    const sumOthers = others.reduce((s, i) => s + (parseFloat(i.value) || 0), 0);

    let acc = 0;
    others.forEach((inp, idx) => {
        let v;
        if (idx === others.length - 1) {
            v = Math.max(0, remaining - acc);
        } else if (sumOthers > 0) {
            v = Math.round(remaining * (parseFloat(inp.value) || 0) / sumOthers);
        } else {
            v = Math.round(remaining / others.length);
        }
        inp.value = v;
        acc += v;
    });
}

// Verteilt die Gewichtung gleichmäßig (z. B. nach Hinzufügen/Löschen einer Kategorie)
function equalizeCatWeights(scopeEl) {
    const scope = scopeEl || document.getElementById('nb-cat-list');
    if (!scope) return;
    const inputs = Array.from(scope.querySelectorAll('.nb-weight-inp'));
    const n = inputs.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    inputs.forEach((inp, i) => inp.value = (i === n - 1) ? 100 - base * (n - 1) : base);
}

function openGradeConfig(lnwWrapper) {
    if (!lnwWrapper) { alert('Bitte wähle zuerst eine Klasse aus!'); return; }
    _nbCurrentGradeSubject = lnwWrapper?.closest('.subject-wrapper');
    const fach = _nbCurrentGradeSubject?.getAttribute('data-fach') || '';
    const titleEl = document.getElementById('nb-config-title');
    if (titleEl) titleEl.textContent = fach ? `Noten-Kategorien · ${fach}` : 'Noten-Kategorien';
    const cats = getGradeCategories(lnwWrapper);
    document.getElementById('nb-cat-list').innerHTML = cats.map(cat => catRowHtml(cat)).join('');
    document.getElementById('grade-config-modal').style.display = 'flex';
}

function catRowHtml(cat) {
    const type = cat.type || 'schriftlich';
    return `<div class="nb-cat-row">
        <input type="text" class="nb-name-inp" value="${escapeHtml(cat.name)}" data-cat-id="${cat.id}" placeholder="Kategorie">
        <select class="nb-type-inp" title="Art der Note">
            <option value="schriftlich" ${type === 'schriftlich' ? 'selected' : ''}>✍️ schriftlich</option>
            <option value="muendlich" ${type === 'muendlich' ? 'selected' : ''}>💬 mündlich</option>
            <option value="praktisch" ${type === 'praktisch' ? 'selected' : ''}>🛠️ praktisch</option>
            <option value="sonstiges" ${type === 'sonstiges' ? 'selected' : ''}>📦 sonstiges</option>
        </select>
        <input type="number" class="nb-weight-inp" value="${cat.weight}" min="0" max="100" step="5" placeholder="%">
        <span class="nb-cat-pct">%</span>
        <button type="button" class="app-btn danger-btn nb-cat-delete-btn" title="Kategorie löschen">×</button>
    </div>`;
}

function openGradeBook(lnwWrapper) {
    if (!lnwWrapper) return;
    document.getElementById('gradebook-modal').setAttribute('data-gradebook-lnw', lnwWrapper.id);
    const sortMode = document.getElementById('nb-sort-select')?.value || 'last-first';
    const cats   = getGradeCategories(lnwWrapper);
    const cls    = lnwWrapper.closest('.class-wrapper');
    const klasse = cls?.getAttribute('data-klasse') || 'Klasse';
    const fach   = cls?.closest('.subject-wrapper')?.getAttribute('data-fach') || '';
    document.getElementById('nb-modal-title').textContent = `📊 Notenbuch · ${fach} · Klasse ${klasse}`;

    const colsByCat = {};
    cats.forEach(c => colsByCat[c.id] = []);
    const students = [];
    lnwWrapper.querySelectorAll('.student-app-tab').forEach(tab => {
        const sid    = tab.getAttribute('data-target');
        const page   = lnwWrapper.querySelector('#' + sid);
        const panel  = lnwWrapper.querySelector(`.grade-panel[data-student="${sid}"]`);
        const grades = getStudentGrades(panel);
        const name   = getStudentNameFromPage(page) || tab.querySelector('span')?.textContent || '?';
        students.push({ name, grades });
        cats.forEach(cat => grades.filter(g => g.catId === cat.id).forEach(g => {
            if (!colsByCat[cat.id].includes(g.name)) colsByCat[cat.id].push(g.name);
        }));
    });
    students.sort((a, b) => compareStudentNames(a.name, b.name, sortMode));

    let th1 = '<tr><th rowspan="2" class="nb-name-td">Schüler</th>';
    let th2 = '<tr>';
    cats.forEach(cat => {
        const cols = colsByCat[cat.id];
        const catLabel = (cat.groupLabel && cat.groupLabel !== cat.name ? cat.groupLabel + ' · ' : '') + cat.name;
        th1 += `<th colspan="${cols.length + 1}" class="nb-cat-th">${escapeHtml(catLabel)} (${cat.weight} %)</th>`;
        cols.forEach(n => { th2 += `<th style="font-weight:400;font-size:11px;">${escapeHtml(n)}</th>`; });
        th2 += `<th class="nb-avg-td" style="font-size:11px;">Ø</th>`;
    });
    th1 += '<th rowspan="2" class="nb-avg-td">Gesamt</th></tr>';
    th2 += '</tr>';

    const tbody = students.map(st => {
        let row = `<td class="nb-name-td">${escapeHtml(st.name)}</td>`;
        cats.forEach(cat => {
            const gMap = {};
            st.grades.filter(g => g.catId === cat.id).forEach(g => gMap[g.name] = g.value);
            colsByCat[cat.id].forEach(n => {
                const v = gMap[n];
                row += v !== undefined ? `<td class="${v >= 4.5 ? 'nb-bad' : ''}">${fmtGradeValue(v)}</td>` : '<td>–</td>';
            });
            const ca = calcCatAvg(st.grades, cat.id);
            row += `<td class="nb-avg-td ${ca !== null && ca >= 4.5 ? 'nb-bad' : ''}">${fmtNote(ca)}</td>`;
        });
        const tot = calcTotal(st.grades, cats);
        row += `<td class="nb-total-td ${tot !== null && tot >= 4.5 ? 'nb-bad-total' : ''}">${fmtNote(tot)}</td>`;
        return `<tr>${row}</tr>`;
    }).join('');

    const totals = students.map(st => calcTotal(st.grades, cats)).filter(v => v !== null);
    const classAvg = totals.length ? totals.reduce((sum, v) => sum + v, 0) / totals.length : null;
    document.getElementById('nb-overview-wrap').innerHTML = `
        <div class="nb-summary-grid">
            <div class="nb-summary-card"><span>Schüler</span><strong>${students.length}</strong></div>
            <div class="nb-summary-card"><span>Klassenschnitt</span><strong>${fmtNote(classAvg)}</strong></div>
        </div>
        <table class="nb-table"><thead>${th1}${th2}</thead><tbody>${tbody}</tbody></table>`;
    document.getElementById('gradebook-modal').style.display = 'flex';
}

function collectAllStudents() {
    const rows = [];
    document.querySelectorAll('.subject-wrapper').forEach(subject => {
        const fach = subject.getAttribute('data-fach') || '';
        subject.querySelectorAll('.class-wrapper').forEach(cls => {
            const klasse = cls.getAttribute('data-klasse') || '';
            cls.querySelectorAll('.lnw-wrapper').forEach(lnw => {
                const lnwNr = lnw.getAttribute('data-lnw-nr') || '';
                lnw.querySelectorAll('.workspace .page').forEach(page => {
                    rows.push({
                        id: page.id,
                        name: getStudentNameFromPage(page),
                        fach,
                        klasse,
                        lnwNr,
                        page,
                        lnw,
                        subject,
                        cls
                    });
                });
            });
        });
    });
    return rows;
}

function openGlobalStudentSearch(prefill = '') {
    const modal = document.getElementById('global-student-search-modal');
    if (!modal) return;
    const input = document.getElementById('global-student-search-input');
    if (input) input.value = prefill;
    renderGlobalStudentSearch(prefill);
    modal.style.display = 'flex';
    setTimeout(() => input?.focus(), 50);
}

function renderGlobalStudentSearch(term) {
    const wrap = document.getElementById('global-student-search-results');
    if (!wrap) return;
    const needle = String(term || '').toLowerCase().trim();
    const rows = collectAllStudents()
        .filter(row => !needle || `${row.name} ${row.fach} ${row.klasse} LNW ${row.lnwNr}`.toLowerCase().includes(needle))
        .sort((a, b) => compareStudentNames(a.name, b.name, 'last-first'));

    if (!rows.length) {
        wrap.innerHTML = '<div class="nb-empty-state">Keine passenden Schüler gefunden.</div>';
        return;
    }

    wrap.innerHTML = rows.map(row => `
        <button type="button" class="global-student-result" data-student-id="${row.id}">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.fach)} · Klasse ${escapeHtml(row.klasse)} · LNW ${escapeHtml(row.lnwNr)}</span>
        </button>
    `).join('');
}

function jumpToStudent(studentId) {
    const page = document.getElementById(studentId);
    const lnw = page?.closest('.lnw-wrapper');
    const cls = page?.closest('.class-wrapper');
    const subject = page?.closest('.subject-wrapper');
    if (!page || !lnw || !cls || !subject) return;

    document.querySelectorAll('.subject-wrapper').forEach(w => w.classList.remove('active'));
    document.querySelectorAll('.subject-app-tab').forEach(t => t.classList.remove('active'));
    subject.classList.add('active');
    document.querySelector(`.subject-app-tab[data-target="${subject.id}"]`)?.classList.add('active');

    subject.querySelectorAll('.class-wrapper').forEach(w => w.classList.remove('active'));
    subject.querySelectorAll('.class-app-tab').forEach(t => t.classList.remove('active'));
    cls.classList.add('active');
    subject.querySelector(`.class-app-tab[data-target="${cls.id}"]`)?.classList.add('active');

    cls.querySelectorAll('.lnw-wrapper').forEach(w => w.classList.remove('active'));
    lnw.classList.add('active');
    const select = cls.querySelector('.lnw-select');
    if (select) select.value = lnw.id;

    if (typeof window.activateStudent === 'function') {
        window.activateStudent(lnw, page.id);
    } else {
        lnw.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
        page.classList.add('active');
        page.style.display = 'block';
        lnw.querySelectorAll('.student-app-tab').forEach(t => t.classList.remove('active'));
        lnw.querySelector(`.student-app-tab[data-target="${page.id}"]`)?.classList.add('active');
    }
    if (typeof window.updateStudentCount === 'function') window.updateStudentCount(lnw);
    document.getElementById('global-student-search-modal').style.display = 'none';
    setTimeout(() => {
        try { page.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    }, 100);
}

function getClassListRows(classWrapper, sortMode) {
    const activeLNW = classWrapper?.querySelector('.lnw-wrapper.active') || classWrapper?.querySelector('.lnw-wrapper');
    if (!activeLNW) return [];
    return Array.from(activeLNW.querySelectorAll('.workspace .page'))
        .map(page => getStudentNameFromPage(page))
        .filter(Boolean)
        .sort((a, b) => compareStudentNames(a, b, sortMode))
        .map(name => formatStudentName(name, sortMode));
}

function openClassListModal(classWrapper) {
    if (!classWrapper) return;
    const modal = document.getElementById('class-list-modal');
    if (!modal) return;
    modal.setAttribute('data-class-id', classWrapper.id);
    document.getElementById('class-list-title').textContent = `Klassenliste · ${classWrapper.getAttribute('data-klasse') || 'Klasse'}`;
    renderClassList();
    modal.style.display = 'flex';
}

function setClassMode(classWrapper, mode) {
    if (!classWrapper) return;
    classWrapper.querySelectorAll('.lnw-wrapper').forEach(lnw => {
        const pages = Array.from(lnw.querySelectorAll('.workspace .page'));
        pages.forEach(page => {
            page.setAttribute('data-student-mode', mode);
            const tab = lnw.querySelector(`.student-app-tab[data-target="${page.id}"]`);
            if (tab) tab.classList.toggle('grade-mode', mode === 'noten');
            const panel = ensureGradePanel(page, lnw);
            if (panel && mode === 'noten') renderGradePanel(panel, page, lnw);
            if (typeof window.updateStudentTabStatus === 'function') window.updateStudentTabStatus(page);
        });
        // Nur den aktiven Schüler anzeigen – verhindert gestapelte Panels
        const activePage = lnw.querySelector('.page.active') || pages[0];
        if (activePage && typeof window.activateStudent === 'function') window.activateStudent(lnw, activePage.id);
        if (typeof updateGradeUiState === 'function') updateGradeUiState(lnw);
    });
    if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
}

function renderClassList() {
    const modal = document.getElementById('class-list-modal');
    const classWrapper = document.getElementById(modal?.getAttribute('data-class-id'));
    const sortMode = document.getElementById('class-list-sort')?.value || 'first-last';
    const names = getClassListRows(classWrapper, sortMode);
    const head = '<tr><th>Name</th>' + Array.from({ length: 15 }, (_, i) => `<th>${i + 1}</th>`).join('') + '</tr>';
    const body = names.map(name => '<tr><td class="nb-name-td">' + escapeHtml(name) + '</td>' + Array.from({ length: 15 }, () => '<td></td>').join('') + '</tr>').join('');
    document.getElementById('class-list-wrap').innerHTML = `<table class="class-list-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ==========================================
// "WO BRENNT ES?" – AUSWERTUNG DER KLASSE
// ==========================================
function openHotspots(lnw) {
    if (!lnw) return alert('Bitte wähle zuerst eine Klasse aus!');
    const cls    = lnw.closest('.class-wrapper');
    const fach   = cls?.closest('.subject-wrapper')?.getAttribute('data-fach') || '';
    const klasse = cls?.getAttribute('data-klasse') || '';
    const pages  = Array.from(lnw.querySelectorAll('.workspace .page'));

    document.getElementById('hotspots-title').textContent = `🔥 Wo brennt es? · ${fach} · Klasse ${klasse}`;

    // --- A) Kompetenzen mit den meisten "nicht erreicht" (schwarzes X im linken Drittel) ---
    const rowMap = {};
    pages.forEach(page => {
        page.querySelectorAll('tr[data-row-id]').forEach(tr => {
            const rid = tr.getAttribute('data-row-id');
            const text = (tr.querySelector('.kompetenz-text')?.innerText || '').replace(/…/g, '').trim();
            if (!rowMap[rid]) rowMap[rid] = { text: '', notReached: 0, assessed: 0 };
            if (text && !rowMap[rid].text) rowMap[rid].text = text;
            const bx = tr.querySelector('.x-marker-black');
            if (bx && !bx.classList.contains('inactive') && bx.style.left) {
                const pct = parseFloat(bx.style.left) / 100;
                rowMap[rid].assessed++;
                if (pct < 0.34) rowMap[rid].notReached++;
            }
        });
    });
    const compList = Object.values(rowMap)
        .filter(r => r.text && r.notReached > 0)
        .sort((a, b) => b.notReached - a.notReached)
        .slice(0, 3);

    // --- B) Häufigste schlechte Noten (4,0 oder schlechter) – NUR schriftliche Noten ---
    const cats = getGradeCategories(lnw);
    const catName = {}; const writtenIds = new Set();
    cats.forEach(c => { catName[c.id] = c.name; if ((c.type || 'schriftlich') === 'schriftlich') writtenIds.add(c.id); });
    const assessmentMap = {};
    const badStudents = [];
    pages.forEach(page => {
        const panel = lnw.querySelector(`.grade-panel[data-student="${page.id}"]`);
        const grades = getStudentGrades(panel).filter(g => writtenIds.has(g.catId));
        grades.forEach(g => {
            const k = (catName[g.catId] || '') + '::' + g.name;
            if (!assessmentMap[k]) assessmentMap[k] = { label: g.name, cat: catName[g.catId] || '', bad: 0, total: 0 };
            assessmentMap[k].total++;
            if (g.value >= 4) assessmentMap[k].bad++;
        });
        // Schnitt nur über schriftliche Noten
        if (grades.length) {
            const avg = grades.reduce((s, g) => s + g.value, 0) / grades.length;
            if (avg >= 4) badStudents.push({ name: getStudentNameFromPage(page), total: avg });
        }
    });
    const badAssessments = Object.values(assessmentMap)
        .filter(a => a.bad > 0)
        .sort((a, b) => b.bad - a.bad)
        .slice(0, 3);
    badStudents.sort((a, b) => b.total - a.total);

    // --- Rendern ---
    let html = `<div class="hotspot-section"><h4>📉 Kompetenzen am häufigsten „nicht erreicht"</h4>`;
    if (compList.length) {
        html += compList.map((r, i) => `<div class="hotspot-row">
            <span class="hotspot-rank">${i + 1}</span>
            <span class="hotspot-text">${escapeHtml(r.text)}</span>
            <span class="hotspot-count" title="${r.notReached} von ${r.assessed} bewertet">${r.notReached}×</span>
        </div>`).join('');
    } else {
        html += `<div class="hotspot-empty">Keine Kompetenz steht auf „nicht erreicht". 🎉</div>`;
    }
    html += `</div>`;

    html += `<div class="hotspot-section"><h4>📕 Häufigste schwache Noten <small style="font-weight:600;color:#90a4b8;">(nur schriftliche · 4,0 oder schlechter)</small></h4>`;
    if (badAssessments.length) {
        html += badAssessments.map((a, i) => `<div class="hotspot-row">
            <span class="hotspot-rank">${i + 1}</span>
            <span class="hotspot-text">${escapeHtml(a.label)}${a.cat ? ` <small style="color:#90a4b8;">(${escapeHtml(a.cat)})</small>` : ''}</span>
            <span class="hotspot-count" title="${a.bad} von ${a.total} Noten">${a.bad} / ${a.total}</span>
        </div>`).join('');
    } else {
        html += `<div class="hotspot-empty">Keine Noten 4,0 oder schlechter. 👍</div>`;
    }
    if (badStudents.length) {
        html += `<div class="hotspot-subnote"><strong>Schüler mit Gesamtnote 4,0 oder schlechter:</strong> ${badStudents.map(s => escapeHtml(s.name) + ' (' + fmtNote(s.total) + ')').join(', ')}</div>`;
    }
    html += `</div>`;

    document.getElementById('hotspots-body').innerHTML = html;
    document.getElementById('hotspots-modal').style.display = 'flex';
}

function printHtmlTable(title, html) {
    const w = window.open('', '_blank');
    if (!w) return alert('Bitte Pop-ups erlauben.');
    w.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
        <style>body{font-family:Arial,sans-serif;margin:12mm;font-size:11px;color:#102a43}h2{font-size:15px;margin:0 0 10px}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid #b8c5d1;padding:6px 7px;text-align:center;height:24px}
        th{background:#102a43;color:#fff}.nb-name-td{text-align:left;font-weight:700;min-width:42mm}
        .nb-summary-grid{display:none}@page{size:A4 landscape;margin:8mm}</style></head><body>
        <h2>${escapeHtml(title)}</h2>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
}

// ==========================================
// NOTENBUCH - EVENT LISTENER
// ==========================================

document.addEventListener('click', function(e) {
    // EINZELNEN SCHÜLER auf Noten-Eingabe umschalten (Button im Dokument)
    if (e.target.classList.contains('switch-to-noten-btn')) {
        const page = e.target.closest('.page');
        const lnw = page?.closest('.lnw-wrapper');
        if (page && lnw) {
            switchStudentMode(page, 'noten', lnw);
            if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
        }
        return;
    }

    // NOTENBUCH EVENTS
    if (e.target.classList.contains('grade-add-btn')) {
        const catId = e.target.getAttribute('data-cat');
        const sid = e.target.getAttribute('data-sid');
        const lnw = e.target.closest('.lnw-wrapper');
        const page = lnw?.querySelector('#' + sid);
        const panel = lnw?.querySelector(`.grade-panel[data-student="${sid}"]`);
        
        const name = e.target.parentElement.querySelector('.nb-add-name').value.trim() || 'Eintrag';
        const date = e.target.parentElement.querySelector('.nb-add-date').value || new Date().toISOString().split('T')[0];
        let rawValue = e.target.parentElement.querySelector('.nb-add-val').value || '';
        rawValue = String(rawValue).replace(',', '.').trim();
        const value = parseFloat(rawValue) || 1;
        
        const grades = getStudentGrades(panel);
        grades.push({ id: 'gr_' + Date.now(), catId, name, date, value });
        setStudentGrades(panel, grades);
        renderGradePanel(panel, page, lnw);
        if (typeof window.updateStudentTabStatus === 'function') window.updateStudentTabStatus(page);
        saveAppLocal();
        return;
    }

    if (e.target.classList.contains('grade-del-btn')) {
        const gid = e.target.getAttribute('data-gid');
        const sid = e.target.getAttribute('data-sid');
        const lnw = e.target.closest('.lnw-wrapper');
        const page = lnw?.querySelector('#' + sid);
        const panel = lnw?.querySelector(`.grade-panel[data-student="${sid}"]`);
        const grades = getStudentGrades(panel).filter(g => g.id !== gid);
        setStudentGrades(panel, grades);
        renderGradePanel(panel, page, lnw);
        if (typeof window.updateStudentTabStatus === 'function') window.updateStudentTabStatus(page);
        saveAppLocal();
        return;
    }

    if (e.target.classList.contains('nb-switch-rb')) {
        const sid = e.target.getAttribute('data-student');
        const lnw = e.target.closest('.lnw-wrapper');
        switchStudentMode(lnw?.querySelector('#' + sid), 'rueckmeldung', lnw);
        if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
        return;
    }

    if (e.target.classList.contains('nb-config-btn')) {
        openCategoryConfigSmart(e.target.closest('.lnw-wrapper'));
        return;
    }

    const studentResult = e.target.closest('.global-student-result');
    if (studentResult) {
        jumpToStudent(studentResult.getAttribute('data-student-id'));
        return;
    }

    if (e.target.id === 'class-list-print-btn') {
        const html = document.getElementById('class-list-wrap')?.innerHTML;
        if (!html) return alert('Keine Klassenliste verfügbar zum Drucken.');
        printHtmlTable('Klassenliste', html);
        return;
    }

    if (e.target.classList.contains('gradebook-btn')) {
        const _cls = e.target.closest('.class-wrapper');
        openGradeBook(_cls?.querySelector('.lnw-wrapper.active') || _cls?.querySelector('.lnw-wrapper')); 
        return;
    }

    if (e.target.classList.contains('global-search-toggle-btn') || e.target.classList.contains('global-search-btn')) {
        const wrap = e.target.closest('.search-input-wrap') || e.target.closest('.lnw-level-bar');
        const term = wrap?.querySelector('.student-search-input')?.value || '';
        openGlobalStudentSearch(term);
        return;
    }

    if (e.target.classList.contains('grade-categories-btn')) {
        openCategoryConfigSmart(getActiveLNWFromButton(e.target));
        return;
    }

    if (e.target.classList.contains('hotspots-btn')) {
        openHotspots(getActiveLNWFromButton(e.target));
        return;
    }

    if (e.target.classList.contains('exam-mode-btn')) {
        const cls = e.target.closest('.class-wrapper');
        if (!cls) return;
        const turningOn = cls.dataset.examMode !== 'true';
        cls.dataset.examMode = turningOn ? 'true' : 'false';
        applyExamMode(cls);
        const subj = cls.closest('.subject-wrapper');
        if (turningOn) {
            const lnw = cls.querySelector('.lnw-wrapper.active') || cls.querySelector('.lnw-wrapper');
            const fach = subj?.getAttribute('data-fach');
            if (examSubjectAllowed(fach, classLevel(cls))) openExamCategoryConfig(lnw);
        } else if (subj && !subj.querySelector('.class-wrapper[data-exam-mode="true"]')) {
            // Keine Abschlussklasse mehr in diesem Fach -> normaler Kategorien-Editor
            subj.removeAttribute('data-exam-split');
        }
        if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
        return;
    }

    // Niveau-Übersicht: Klick auf den Schülerzähler zeigt G/M/E-Verteilung
    if (e.target.classList.contains('student-count-badge')) {
        const cls = e.target.closest('.class-wrapper');
        const lnw = cls?.querySelector('.lnw-wrapper.active');
        const existing = cls?.querySelector('.niveau-popover');
        document.querySelectorAll('.niveau-popover').forEach(p => p.remove());
        if (existing) return; // war offen -> jetzt geschlossen (Toggle)

        const counts = { G: 0, M: 0, E: 0, none: 0 };
        let total = 0;
        lnw?.querySelectorAll('.workspace .page').forEach(p => {
            total++;
            const nv = effectiveNiveau(p);
            if (nv === 'G' || nv === 'M' || nv === 'E') counts[nv]++; else counts.none++;
        });
        const pop = document.createElement('div');
        pop.className = 'niveau-popover';
        pop.innerHTML = `<div class="nivp-title">Niveau-Übersicht</div>
            <div class="nivp-line"><span class="nivp-dot g"></span>G-Niveau<b>${counts.G}</b></div>
            <div class="nivp-line"><span class="nivp-dot m"></span>M-Niveau<b>${counts.M}</b></div>
            <div class="nivp-line"><span class="nivp-dot e"></span>E-Niveau<b>${counts.E}</b></div>
            ${counts.none ? `<div class="nivp-line"><span class="nivp-dot none"></span>ohne Zuordnung<b>${counts.none}</b></div>` : ''}
            <div class="nivp-hint">${total} Schüler · „Auto" leitet das Niveau automatisch aus den gesetzten Kreuzen ab; im Bogen oder Notenfenster über „👤 Niveau" auch fest wählbar.</div>`;
        e.target.parentElement.style.position = 'relative';
        e.target.parentElement.appendChild(pop);
        return;
    }

    if (e.target.classList.contains('class-list-btn')) {
        const _cls = e.target.closest('.class-wrapper');
        openClassListModal(_cls);
        return;
    }

    if (e.target.classList.contains('bulk-grade-mode-btn')) {
        const _cls = e.target.closest('.class-wrapper');
        setClassMode(_cls, 'noten');
        return;
    }

    if (e.target.classList.contains('bulk-feedback-mode-btn')) {
        const _cls = e.target.closest('.class-wrapper');
        setClassMode(_cls, 'rueckmeldung');
        return;
    }

    if (e.target.classList.contains('nb-cat-delete-btn')) {
        const row = e.target.closest('.nb-cat-row');
        const scope = e.target.closest('[data-weight-scope]');
        if (row) row.remove();
        equalizeCatWeights(scope);
        return;
    }

    if (e.target.id === 'nb-add-category-btn') {
        const list = document.getElementById('nb-cat-list');
        if (!list) return;
        const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        list.insertAdjacentHTML('beforeend', catRowHtml({ id, name: 'Neue Kategorie', weight: 0, type: 'schriftlich' }));
        equalizeCatWeights(list);
        return;
    }

    if (e.target.id === 'exam-sub-add-btn') {
        const list = document.getElementById('exam-sub-list');
        if (!list) return;
        const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        list.insertAdjacentHTML('beforeend', catRowHtml({ id, name: 'Neue Kategorie', weight: 0, type: 'schriftlich' }));
        equalizeCatWeights(list);
        return;
    }
});

// Gewichtungen automatisch auf 100 % halten
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('nb-weight-inp')) {
        rebalanceCatWeights(e.target);
        return;
    }
    // Prüfungs- und Jahresleistung ergänzen sich automatisch zu 100 %
    if (e.target.id === 'exam-p-weight' || e.target.id === 'exam-j-weight') {
        const v = Math.max(0, Math.min(100, Math.round(parseFloat(e.target.value) || 0)));
        e.target.value = v;
        const other = document.getElementById(e.target.id === 'exam-p-weight' ? 'exam-j-weight' : 'exam-p-weight');
        if (other) other.value = 100 - v;
    }
});

// Niveau-Popover schließen, wenn außerhalb geklickt wird
document.addEventListener('click', (e) => {
    if (!e.target.closest('.niveau-popover') && !e.target.classList.contains('student-count-badge')) {
        document.querySelectorAll('.niveau-popover').forEach(p => p.remove());
    }
});

// Niveau-Zuordnung eines Schülers ändern (Wähler im Bogen ODER im Notenfenster)
document.addEventListener('change', (e) => {
    if (!e.target.classList.contains('student-niveau-select')) return;
    const lnw = e.target.closest('.lnw-wrapper');
    let page = e.target.closest('.page');
    if (!page && lnw) page = lnw.querySelector('#' + e.target.getAttribute('data-student'));
    if (!page) return;
    const val = e.target.value;
    page.dataset.studentNiveau = val;

    // Beide Wähler (Dokument + Noten-Panel) gleich setzen
    const sels = [];
    const docSel = page.querySelector('.student-niveau-select');
    if (docSel) sels.push(docSel);
    const panelSel = lnw?.querySelector(`.grade-panel[data-student="${page.id}"] .student-niveau-select`);
    if (panelSel) sels.push(panelSel);
    sels.forEach(s => {
        s.value = val;
        if (val) s.setAttribute('data-niv', val); else s.removeAttribute('data-niv');
        Array.from(s.options).forEach(o => o.removeAttribute('selected'));
        const opt = s.querySelector(`option[value="${val}"]`);
        if (opt) opt.setAttribute('selected', 'selected');
    });
    document.querySelectorAll('.niveau-popover').forEach(p => p.remove());
    if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
});

// Bestehende Noten-Einträge bearbeiten (Bezeichnung / Datum / Note)
document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList.contains('nb-edit-name') && !t.classList.contains('nb-edit-date') && !t.classList.contains('nb-edit-val')) return;
    const gid = t.getAttribute('data-gid');
    const sid = t.getAttribute('data-sid');
    const lnw = t.closest('.lnw-wrapper');
    const page = lnw?.querySelector('#' + sid);
    const panel = lnw?.querySelector(`.grade-panel[data-student="${sid}"]`);
    const grades = getStudentGrades(panel);
    const g = grades.find(x => x.id === gid);
    if (!g) return;

    if (t.classList.contains('nb-edit-name')) {
        g.name = t.value.trim() || 'Eintrag';
    } else if (t.classList.contains('nb-edit-date')) {
        g.date = t.value || g.date;
    } else {
        let v = parseFloat(String(t.value).replace(',', '.'));
        if (isNaN(v)) v = g.value;
        g.value = Math.max(1, Math.min(6, v));
    }
    setStudentGrades(panel, grades);
    renderGradePanel(panel, page, lnw);
    if (typeof window.updateStudentTabStatus === 'function') window.updateStudentTabStatus(page);
    saveAppLocal();
});

// ==========================================
// PROGRAMM ENTSPERREN (LOCKSCREEN)
// ==========================================
// 'DOMContentLoaded' stellt sicher, dass der Code erst ausgeführt wird, 
// wenn die HTML-Seite vollständig geladen ist.
document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Elemente anhand ihrer ID aus dem HTML laden
    // WICHTIG: Prüfe in deiner index.html, ob diese IDs exakt so heißen!
    // Falls sie anders heißen (z.B. 'btn-entsperren'), passe sie hier an.
    const entsperrenBtn = document.getElementById('entsperrenButton'); 
    const passwortFeld = document.getElementById('passwortEingabe');
    const lockScreenModal = document.getElementById('lock-screen-overlay'); // Das Modal, das das Programm verdeckt

    // 2. Prüfen, ob der Button überhaupt auf der Seite existiert
    if (entsperrenBtn) {
        
        // 3. Dem Button den Klick-Befehl zuweisen
        entsperrenBtn.addEventListener('click', () => {
            
            // Das eingegebene Passwort auslesen
            const eingegebenesPasswort = passwortFeld.value;
            
            // Hier legst du dein gewünschtes Passwort fest (z. B. "eks123")
            const korrektesPasswort = "eks123"; 

            // 4. Passwort überprüfen
            if (eingegebenesPasswort === korrektesPasswort) {
                // Wenn das Passwort richtig ist:
                if (lockScreenModal) {
                    // Verstecke den Sperrbildschirm
                    lockScreenModal.style.display = 'none'; 
                }
                // Optional: Leere das Passwortfeld wieder
                passwortFeld.value = ""; 
                
            } else {
                // Wenn das Passwort falsch ist:
                alert("Falsches Passwort! Bitte versuche es erneut.");
                // Optional: Feld leeren, damit der Nutzer es direkt neu versuchen kann
                passwortFeld.value = "";
            }
        });
    }
});

// Config Modal Events
document.getElementById('nb-config-cancel')?.addEventListener('click', () => {
    document.getElementById('grade-config-modal').style.display = 'none';
});

document.getElementById('nb-config-save')?.addEventListener('click', () => {
    const cats = getCatConfigFromForm();
    if (cats.reduce((s,c) => s+c.weight, 0) !== 100) {
        alert('Die Gewichtungen müssen zusammen 100 % ergeben.');
        return;
    }
    if (_nbCurrentGradeSubject) {
        _nbCurrentGradeSubject.setAttribute('data-grade-categories', JSON.stringify(cats));
        _nbCurrentGradeSubject.querySelectorAll('.lnw-wrapper').forEach(lnw => {
            lnw.querySelectorAll('.grade-panel').forEach(panel => {
                const sid = panel.getAttribute('data-student');
                const page = lnw.querySelector('#' + sid);
                if (panel.style.display !== 'none') renderGradePanel(panel, page, lnw);
            });
        });
        if (typeof refreshGradeCategorySummaries === 'function') refreshGradeCategorySummaries();
        saveAppLocal();
    }
    document.getElementById('grade-config-modal').style.display = 'none';
});

// Abschlussklassen-Verrechnung speichern
document.getElementById('exam-config-cancel')?.addEventListener('click', () => {
    document.getElementById('exam-config-modal').style.display = 'none';
});

document.getElementById('exam-config-save')?.addEventListener('click', () => {
    const subject = _examConfigSubject;
    if (!subject) { document.getElementById('exam-config-modal').style.display = 'none'; return; }

    const pName = document.getElementById('exam-p-name').value.trim() || 'Prüfungsleistung';
    const pW = Math.max(0, Math.min(100, Math.round(parseFloat(document.getElementById('exam-p-weight').value) || 0)));
    const jName = document.getElementById('exam-j-name').value.trim() || 'Jahresleistung';
    const jW = 100 - pW;

    const subs = Array.from(document.querySelectorAll('#exam-sub-list .nb-cat-row')).map(row => ({
        id:     row.querySelector('.nb-name-inp').getAttribute('data-cat-id'),
        name:   row.querySelector('.nb-name-inp').value.trim() || 'Kategorie',
        weight: Math.round(parseFloat(row.querySelector('.nb-weight-inp').value) || 0),
        type:   row.querySelector('.nb-type-inp')?.value || 'schriftlich'
    }));
    if (!subs.length) { alert('Die Jahresleistung braucht mindestens eine Kategorie.'); return; }
    if (subs.reduce((s, c) => s + c.weight, 0) !== 100) {
        alert('Die Kategorien der Jahresleistung müssen zusammen 100 % ergeben.');
        return;
    }

    // In flache Kategorien mit effektiver Gewichtung umrechnen (Gesamtsumme = 100 %)
    const flat = [{ id: _examConfigPId, name: pName, weight: pW, type: 'schriftlich', group: 'pruefung', groupLabel: pName }];
    let acc = 0;
    subs.forEach((s, i) => {
        let w = (i === subs.length - 1) ? (jW - acc) : Math.round(jW * s.weight / 100);
        if (w < 0) w = 0;
        acc += w;
        flat.push({ id: s.id, name: s.name, weight: w, type: s.type, group: 'jahr', groupLabel: jName, subWeight: s.weight });
    });

    subject.setAttribute('data-grade-categories', JSON.stringify(flat));
    subject.setAttribute('data-exam-split', JSON.stringify({ pId: _examConfigPId, pName, pWeight: pW, jName, jWeight: jW, subs }));

    subject.querySelectorAll('.lnw-wrapper').forEach(lnw => {
        lnw.querySelectorAll('.grade-panel').forEach(panel => {
            const sid = panel.getAttribute('data-student');
            const page = lnw.querySelector('#' + sid);
            if (panel.style.display !== 'none' && page) renderGradePanel(panel, page, lnw);
        });
    });
    if (typeof window.saveAppLocal === 'function') window.saveAppLocal();
    document.getElementById('exam-config-modal').style.display = 'none';
});

document.getElementById('nb-modal-close')?.addEventListener('click', () => {
    document.getElementById('gradebook-modal').style.display = 'none';
});

document.getElementById('nb-sort-select')?.addEventListener('change', () => {
    const modal = document.getElementById('gradebook-modal');
    const lnwId = modal?.getAttribute('data-gradebook-lnw');
    const lnw = lnwId ? document.getElementById(lnwId) : null;
    if (lnw) openGradeBook(lnw);
});

document.getElementById('nb-modal-print')?.addEventListener('click', () => {
    const tbl = document.getElementById('nb-overview-wrap').innerHTML;
    const title = document.getElementById('nb-modal-title').textContent;
    const w = window.open('', '_blank');
    if (!w) return alert('Bitte Pop-ups erlauben.');
    w.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${title}</title>
        <style>body{font-family:Arial,sans-serif;margin:14mm;font-size:11px}h2{font-size:13px;margin:0 0 8px}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5px 7px;text-align:center}
        th{background:#1a365d;color:#fff}.nb-cat-th{background:#2b5797}.nb-name-td{text-align:left;font-weight:600}
        .nb-avg-td{background:#eef6ff;font-weight:700}.nb-total-td{background:#1a365d;color:#fff;font-weight:700}
        .nb-bad{background:#ffe5e5;color:#c0392b;font-weight:700}.nb-bad-total{background:#c0392b}
        @page{size:A4 landscape;margin:0}</style></head><body>
        <h2>${title}</h2>${tbl}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
});

// Schülername direkt im Notenfenster bearbeiten -> synchron zur Rückmeldung
document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('nb-name-edit')) return;
    const lnw = e.target.closest('.lnw-wrapper');
    const page = lnw?.querySelector('#' + e.target.getAttribute('data-student'));
    const nameInput = page?.querySelector('.student-name-input');
    if (nameInput) {
        nameInput.value = e.target.value;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
});

document.getElementById('global-student-search-input')?.addEventListener('input', (event) => {
    renderGlobalStudentSearch(event.target.value);
});

document.getElementById('global-student-search-clear-btn')?.addEventListener('click', () => {
    const input = document.getElementById('global-student-search-input');
    if (input) {
        input.value = '';
        renderGlobalStudentSearch('');
    }
});

document.getElementById('class-list-sort')?.addEventListener('change', () => {
    renderClassList();
});
