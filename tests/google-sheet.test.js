// Tests du script Google Sheet (google-sheet/Code.gs), exécuté dans une simulation de Google Sheets.
// Lancer : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function scriptAvec(code, codeIndispos = '', codeLecture = '') {
  const feuilles = {};
  const feuille = nom => {
    const f = {
      cells: [], cache: false,
      getLastRow: () => f.cells.length,
      getRange: (r, c, nr, nc) => ({
        getValues() {
          return Array.from({ length: nr }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((f.cells[r - 1 + i] || [])[c - 1 + j]) ?? ''));
        },
        setValues(v) { v.forEach((l, i) => { f.cells[r - 1 + i] = f.cells[r - 1 + i] || []; l.forEach((x, j) => { f.cells[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
      }),
      clear() { f.cells = []; }, hideSheet() { f.cache = true; }, setFrozenRows() {}, autoResizeColumns() {},
    };
    feuilles[nom] = f;
    return f;
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => feuilles[n] || null, insertSheet: feuille }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ texte: t, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'google-sheet', 'Code.gs'), 'utf8');
  let txt = code ? src.replace("'A-CHANGER';", `'${code}';`) : src;
  txt = txt.replace("const CODE_INDISPOS = '';", `const CODE_INDISPOS = '${codeIndispos}';`)
    .replace("const CODE_LECTURE = '';", `const CODE_LECTURE = '${codeLecture}';`);
  vm.runInContext(txt, ctx);
  vm.runInContext('this.doGet = doGet; this.doPost = doPost;', ctx);
  const get = p => JSON.parse(ctx.doGet({ parameter: p }).texte);
  const post = b => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).texte);
  return { get, post, feuilles };
}

test('Google Sheet : refuse tant que le code secret n\'est pas défini, ou s\'il est faux', () => {
  assert.match(scriptAvec(null).get({ code: 'A-CHANGER' }).erreur, /non défini/);
  const s = scriptAvec('s3cret');
  assert.equal(s.get({ code: 'faux' }).ok, false);
  assert.equal(s.post({ code: 'faux', reglages: {} }).ok, false);
  assert.equal(s.feuilles._reglages, undefined, 'rien écrit avec un mauvais code');
});

test('Google Sheet : enregistre puis relit les réglages, écrit Planning et Décompte', () => {
  const s = scriptAvec('s3cret');
  assert.deepEqual(s.get({ code: 's3cret' }), { ok: true, role: 'admin', reglages: null, majLe: 0, codes: { indispos: '', lecture: '' } });
  // Réglages volumineux : répartis sur plusieurs cellules (limite de 50 000 caractères)
  const reglages = { titulaires: [{ code: 'RW' }], indispos: { RW: Array.from({ length: 9000 }, (_, i) => 'date-' + i) } };
  const r = s.post({ code: 's3cret', reglages, majLe: 123,
    planning: [['Semaine', 'Mardi'], ['05/10', 'RW']], decompte: [['Praticien', 'Libérales'], ['RW', 3]] });
  assert.equal(r.ok, true);
  assert.ok(s.feuilles._reglages.cells.length > 2, 'réglages découpés en plusieurs cellules');
  assert.ok(s.feuilles._reglages.cache, 'feuille des réglages masquée');
  const lu = s.get({ code: 's3cret' });
  assert.deepEqual(lu.reglages, reglages);
  assert.equal(lu.majLe, 123);
  assert.deepEqual(s.feuilles.Planning.cells, [['Semaine', 'Mardi'], ['05/10', 'RW']]);
  assert.deepEqual(s.feuilles['Décompte'].cells[1], ['RW', 3]);
});

test('Google Sheet : accès consultation et indisponibilités vérifiés par le script', () => {
  const s = scriptAvec('admin1', 'indisp2', 'voir3');
  const reglages = { titulaires: [{ code: 'RW' }], indispos: { RW: ['2026-11-03'] }, overrides: { '2026-11-23': { mar: 'FERMÉ' } } };
  assert.equal(s.post({ code: 'admin1', reglages, majLe: 1 }).ok, true);
  // L'administrateur reçoit les codes pour fabriquer les liens ; les autres non
  assert.deepEqual(s.get({ code: 'admin1' }).codes, { indispos: 'indisp2', lecture: 'voir3' });
  assert.equal(s.get({ code: 'indisp2' }).role, 'indispos');
  assert.equal(s.get({ code: 'indisp2' }).codes, undefined);
  // Consultation : lecture possible, écriture refusée
  const v = s.get({ code: 'voir3' });
  assert.equal(v.role, 'lecture');
  assert.deepEqual(v.reglages, reglages);
  assert.equal(s.post({ code: 'voir3', reglages: { titulaires: [], indispos: {} }, majLe: 2 }).ok, false);
  assert.deepEqual(s.get({ code: 'admin1' }).reglages, reglages, 'rien modifié par le lien consultation');
  // Indisponibilités : seules les indispos changent, le reste est conservé
  const r = s.post({ code: 'indisp2', majLe: 3, reglages: {
    titulaires: [{ code: 'PIRATE' }], indispos: { RW: ['2026-11-03', '2026-11-04'] }, overrides: {} } });
  assert.equal(r.ok, true);
  const apres = s.get({ code: 'admin1' }).reglages;
  assert.deepEqual(apres.indispos, { RW: ['2026-11-03', '2026-11-04'] });
  assert.deepEqual(apres.titulaires, [{ code: 'RW' }], 'MAR inchangés');
  assert.deepEqual(apres.overrides, reglages.overrides, 'créneau fermé conservé');
  // Codes optionnels vides : non acceptés
  const t = scriptAvec('admin1');
  assert.equal(t.get({ code: '' }).ok, false);
});
