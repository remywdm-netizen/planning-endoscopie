// Tests du script Google Sheet (google-sheet/Code.gs), exécuté dans une simulation de Google Sheets.
// Lancer : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function scriptAvec(code) {
  const feuilles = {};
  const feuille = nom => {
    const f = {
      cells: [], cache: false,
      getLastRow: () => f.cells.length,
      getLastColumn: () => Math.max(0, ...f.cells.map(l => (l || []).length)),
      deleteRows: (r, n) => { f.cells.splice(r - 1, n); },
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
  vm.runInContext(code ? src.replace("'A-CHANGER';", `'${code}';`) : src, ctx);
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
  assert.deepEqual(s.get({ code: 's3cret' }), { ok: true, reglages: null, majLe: 0, version: 2 });
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

const riche = {
  titulaires: [{ code: 'RW' }, { code: 'SG' }, { code: 'GR' }],
  indispos: { RW: ['2026-12-01', '2026-12-02', '2026-12-03'], SG: ['2026-11-03'], GR: [] },
  overrides: { '2026-11-30': { mar: 'SG', jeu1: 'RW' }, '2026-12-07': { lun1: 'FERMÉ' } },
  liberales: [{ consult: '2026-12-01', bloc: '2026-12-07', nb: 3 }, { consult: '2026-12-03', bloc: '2026-12-08' },
    { consult: '2026-12-10', bloc: '2026-12-14' }, { consult: '2026-12-15', bloc: '2026-12-21' }],
};
const vide = { titulaires: [{ code: 'RW' }, { code: 'SG' }, { code: 'GR' }], indispos: { RW: [] }, overrides: {}, liberales: [] };

test('Google Sheet : refuse d\'être écrasé par des réglages vides, sauf confirmation', () => {
  const s = scriptAvec('s3cret');
  assert.equal(s.post({ code: 's3cret', reglages: riche, majLe: 100 }).ok, true);
  const r = s.post({ code: 's3cret', reglages: vide, majLe: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.protege, true);
  assert.equal(r.actuel.lib, 4);
  assert.equal(r.envoye.lib, 0);
  assert.deepEqual(s.get({ code: 's3cret' }).reglages, riche, 'le Sheet est intact');
  assert.equal(s.post({ code: 's3cret', majLe: 300 }).ok, false, 'envoi sans réglages refusé');
  // Petite modification : acceptée
  const modif = JSON.parse(JSON.stringify(riche)); modif.liberales.pop();
  assert.equal(s.post({ code: 's3cret', reglages: modif, majLe: 400 }).ok, true);
  // Confirmé par l'utilisateur : accepté
  assert.equal(s.post({ code: 's3cret', reglages: vide, majLe: 500, forcer: true }).ok, true);
  assert.deepEqual(s.get({ code: 's3cret' }).reglages, vide);
});

test('Google Sheet : garde des sauvegardes datées, restaurables', () => {
  const s = scriptAvec('s3cret');
  assert.deepEqual(s.get({ code: 's3cret', action: 'sauvegardes' }).sauvegardes, []);
  s.post({ code: 's3cret', reglages: riche, majLe: 100 });
  const modif = JSON.parse(JSON.stringify(riche)); modif.liberales.pop();
  s.post({ code: 's3cret', reglages: modif, majLe: 200 });   // sauvegarde de la version 100
  s.post({ code: 's3cret', reglages: riche, majLe: 300 });   // moins de 20 min après : pas de nouvelle sauvegarde
  let l = s.get({ code: 's3cret', action: 'sauvegardes' }).sauvegardes;
  assert.equal(l.length, 1);
  assert.equal(l[0].majLe, 100);
  assert.match(l[0].resume, /4 libéraux/);
  s.post({ code: 's3cret', reglages: vide, majLe: 400, forcer: true }); // écrasement confirmé : toujours sauvegardé
  l = s.get({ code: 's3cret', action: 'sauvegardes' }).sauvegardes;
  assert.equal(l.length, 2);
  assert.equal(l[0].majLe, 300, 'la plus récente en premier');
  assert.deepEqual(s.get({ code: 's3cret', action: 'sauvegarde', id: l[0].id }).reglages, riche);
  assert.equal(s.get({ code: 's3cret', action: 'sauvegarde', id: 'x' }).ok, false);
  assert.equal(s.feuilles._sauvegardes.cache, true, 'feuille des sauvegardes masquée');
  // Gros réglages : sauvegarde répartie sur plusieurs cellules, relue à l'identique
  const gros = JSON.parse(JSON.stringify(riche)); gros.indispos.RW = Array.from({ length: 9000 }, (_, i) => 'date-' + i);
  s.post({ code: 's3cret', reglages: gros, majLe: 500, forcer: true });
  s.post({ code: 's3cret', reglages: riche, majLe: 600, forcer: true });
  const id = s.get({ code: 's3cret', action: 'sauvegardes' }).sauvegardes[0].id;
  assert.deepEqual(s.get({ code: 's3cret', action: 'sauvegarde', id }).reglages, gros);
});
