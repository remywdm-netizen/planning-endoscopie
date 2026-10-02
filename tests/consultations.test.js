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

const withForce = (monday, slotId, who) => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.overrides[monday] = Object.assign({}, cfg.overrides[monday], { [slotId]: who });
  return E.generate(cfg);
};

test('forcer un praticien : créneau figé, le reste s\'adapte sans erreur', () => {
  const r = withForce('2026-11-30', 'lun2', 'RW'); // RW calculé en lun1 sans forçage
  assert.equal(slot('2026-11-30', 'lun1').med, 'RW');
  const w = r.weeks.find(x => x.monday === '2026-11-30');
  assert.equal(w.slots.lun2.med, 'RW');
  assert.ok(w.slots.lun2.force);
  assert.notEqual(w.slots.lun1.med, 'RW', 'pas 2 consultations le même après-midi');
  assert.ok(!w.override, 'semaine partiellement forcée');
  assert.deepEqual(E.verify(r), []);
  assert.deepEqual(E.alertes(r), []);
});

test('forcer sur le mardi : exclusivité respectée sur le jeudi-C1', () => {
  const r = withForce('2026-11-23', 'mar', 'GR');
  const w = r.weeks.find(x => x.monday === '2026-11-23');
  assert.equal(w.slots.mar.med, 'GR');
  assert.notEqual(w.slots.jeu1.med, 'GR');
  assert.deepEqual(E.verify(r), []);
  // Report de bloc appliqué au forçage : GR exclu le lundi 30/11
  assert.match(r.weeks.find(x => x.monday === '2026-11-30').slots.lun1.exclus.GR, /bloc/i);
});

test('forcer un MAR indisponible : alerte, mais pas d\'erreur', () => {
  const r = withForce('2026-11-02', 'mar', 'RW'); // RW indisponible le 03/11
  assert.equal(r.weeks.find(x => x.monday === '2026-11-02').slots.mar.med, 'RW');
  assert.deepEqual(E.verify(r), []);
  assert.ok(E.alertes(r).some(a => /RW indisponible/.test(a)));
});

test('forcer un praticien externe', () => {
  const r = withForce('2026-10-12', 'jeu2', 'AFR');
  assert.equal(r.weeks.find(x => x.monday === '2026-10-12').slots.jeu2.med, 'AFR');
  assert.deepEqual(E.verify(r), []);
});

test('un forçage sur un jour férié est ignoré', () => {
  const r = withForce('2026-11-16', 'jeu1', 'RW');
  assert.equal(r.weeks.find(x => x.monday === '2026-11-16').slots.jeu1.med, null);
});

const withPresences = presences => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.presences = presences;
  return E.generate(cfg);
};

test('présence requise : le MAR obtient une consultation ce jour-là', () => {
  // Sans contrainte, RW n'a pas de consultation le mercredi 02/12
  const jour = '2026-12-02';
  const avant = E.SLOTS.filter(s => s.dow === 2).map(s => slot('2026-11-30', s.id).med);
  assert.ok(!avant.includes('RW'));
  const r = withPresences([{ date: jour, med: 'RW', info: 'Coloscopie' }]);
  const w = r.weeks.find(x => x.monday === '2026-11-30');
  assert.equal(w.slots.mer.med, 'RW');
  assert.deepEqual(E.verify(r), []);
  const st = E.presenceStatus(r);
  assert.equal(st[0].slot.id, 'mer');
  assert.deepEqual(E.alertes(r), []);
});

test('présence impossible (MAR indisponible) : alerte', () => {
  const r = withPresences([{ date: '2026-10-05', med: 'RW' }]); // RW indispo le 05/10
  assert.deepEqual(E.verify(r), []);
  assert.ok(E.alertes(r).some(a => /présence de RW/.test(a) && /indisponible/.test(a)));
});

test('présence un vendredi ou hors période : ignorée sans alerte', () => {
  const r = withPresences([{ date: '2026-10-09', med: 'SG' }, { date: '2027-01-05', med: 'SG' }]);
  const st = E.presenceStatus(r);
  assert.equal(st[0].raison, 'pas de consultation ce jour-là');
  assert.equal(st[1].raison, 'hors période');
  assert.deepEqual(E.alertes(r), []);
});

test('renommer un MAR reporte ses présences requises', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.presences = [{ date: '2026-12-02', med: 'RW' }];
  const r = E.generate(E.renameTitulaire(cfg, 'RW', 'ZZ'));
  assert.equal(r.weeks.find(x => x.monday === '2026-11-30').slots.mer.med, 'ZZ');
});
