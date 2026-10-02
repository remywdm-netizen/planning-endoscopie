// Tests du moteur de planning des consultations d'anesthésie.
// Lancer : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../consultations-engine.js');

const result = E.generate();
const week = monday => result.weeks.find(w => w.monday === monday);
const slot = (monday, id) => week(monday).slots[id];

test('aucune règle violée', () => {
  assert.deepEqual(E.verify(result), []);
});

test('semaine de référence 28/09 : overrides appliqués', () => {
  const w = week('2026-09-28');
  assert.equal(w.slots.lun1.med, 'RW');
  assert.equal(w.slots.lun2.med, 'GR');
  assert.equal(w.slots.mar.med, 'AFR');
  assert.equal(w.slots.mer.med, 'SG');
  assert.equal(w.slots.jeu1.med, 'GR');
  assert.equal(w.slots.jeu2.med, 'RW');
});

test('report de bloc : GR (jeudi-C1 du 01/10) exclu le mardi 06/10', () => {
  assert.notEqual(slot('2026-10-05', 'mar').med, 'GR');
  assert.match(slot('2026-10-05', 'mar').exclus.GR, /bloc/i);
});

test('report de bloc : praticien du mardi exclu le lundi suivant', () => {
  result.weeks.slice(0, -1).forEach((w, i) => {
    const m = w.slots.mar.med;
    if (!E.isTitulaire(m)) return;
    const next = result.weeks[i + 1];
    assert.notEqual(next.slots.lun1.med, m, `${next.monday} lun1`);
    assert.notEqual(next.slots.lun2.med, m, `${next.monday} lun2`);
  });
});

test('jours fériés sans consultation ni report de bloc', () => {
  assert.equal(slot('2026-11-16', 'jeu1').med, null);
  assert.equal(slot('2026-11-16', 'jeu2').med, null);
  assert.equal(slot('2026-12-07', 'mar').med, null);
  // Pas de report depuis le 19/11 → personne n'est exclu "au bloc" le mardi 24/11
  Object.values(slot('2026-11-23', 'mar').exclus).forEach(r => assert.doesNotMatch(r, /bloc/i));
});

test('indisponibilités respectées', () => {
  const ind = {};
  E.TITULAIRES.forEach(t => { ind[t] = new Set(E.DEFAULT_CONFIG.indispos[t]); });
  result.weeks.filter(w => !w.override).forEach(w => E.SLOTS.forEach(s => {
    const c = w.slots[s.id];
    if (E.isTitulaire(c.med)) assert.ok(!ind[c.med].has(c.date), `${c.med} le ${c.date}`);
  }));
});

test('erratum GR : indisponible le 14/10, disponible le 17/10', () => {
  const gr = new Set(E.DEFAULT_CONFIG.indispos.GR);
  assert.ok(gr.has('2026-10-14'));
  assert.ok(!gr.has('2026-10-17'));
});

test('plafonds hebdomadaires : SG/GR ≤ 2, RW ≤ 3', () => {
  result.weeks.filter(w => !w.override).forEach(w => {
    const load = {};
    E.SLOTS.forEach(s => { const m = w.slots[s.id].med; if (m) load[m] = (load[m] || 0) + 1; });
    assert.ok((load.SG || 0) <= 2, w.monday);
    assert.ok((load.GR || 0) <= 2, w.monday);
    assert.ok((load.RW || 0) <= 3, w.monday);
  });
});

test('mardi / jeudi-C1 : jamais le même titulaire la même semaine', () => {
  result.weeks.forEach(w => {
    if (E.isTitulaire(w.slots.mar.med)) assert.notEqual(w.slots.mar.med, w.slots.jeu1.med, w.monday);
  });
});

test('décompte T4 équilibré entre titulaires (écart ≤ 1)', () => {
  const d = E.decompte(result.weeks, '2026-10-01', '2026-12-31');
  const vals = E.TITULAIRES.map(t => d[t] || 0);
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, JSON.stringify(d));
});

test('génération déterministe', () => {
  assert.deepEqual(E.generate().weeks, result.weeks);
});

test('renommer un MAR conserve ses indisponibilités et le planning', () => {
  const cfg = E.renameTitulaire(E.DEFAULT_CONFIG, 'SG', 'XY');
  assert.deepEqual(E.DEFAULT_CONFIG.titulaires.map(t => t.code), ['RW', 'SG', 'GR'], 'config par défaut intacte');
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  r.weeks.forEach((w, i) => E.SLOTS.forEach(s => {
    const before = result.weeks[i].slots[s.id].med;
    assert.equal(w.slots[s.id].med, before === 'SG' ? 'XY' : before, `${w.monday} ${s.id}`);
  }));
});

test('une indisponibilité ajoutée est prise en compte', () => {
  const who = slot('2026-11-30', 'mar').med;
  assert.ok(E.isTitulaire(who));
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.indispos[who].push('2026-12-01');
  const r = E.generate(cfg);
  assert.notEqual(r.weeks.find(w => w.monday === '2026-11-30').slots.mar.med, who);
  assert.deepEqual(E.verify(r), []);
});

test('plafond personnalisé : un MAR à 3 / semaine', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.titulaires.forEach(t => { t.max = t.code === 'GR' ? 3 : 2; });
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  r.weeks.filter(w => !w.override).forEach(w => {
    const n = E.SLOTS.filter(s => w.slots[s.id].med === 'RW').length;
    assert.ok(n <= 2, w.monday);
  });
});
