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

const withLib = liberales => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.liberales = liberales;
  return E.generate(cfg);
};

test('patient libéral : MAR indisponible le jour du bloc écarté de la consultation', () => {
  // Sans import, SG fait le mardi 24/11 ; SG est indisponible le 30/11
  assert.equal(slot('2026-11-23', 'mar').med, 'SG');
  const r = withLib([{ consult: '2026-11-24', bloc: '2026-11-30', info: 'Coloscopie' }]);
  const w = r.weeks.find(x => x.monday === '2026-11-23');
  assert.notEqual(w.slots.mar.med, 'SG');
  assert.match(w.slots.mar.exclus.SG, /Indisponible le 30\/11/);
  assert.deepEqual(E.verify(r), []);
  const st = E.liberaleStatus(r);
  assert.equal(st[0].slot.id, 'mar');
  assert.equal(st[0].statut, 'ok');
});

test('patient libéral : le MAR est au bloc ce jour-là, pas en consultation', () => {
  // Consultation jeudi 26/11, bloc mercredi 02/12
  const r = withLib([{ consult: '2026-11-26', bloc: '2026-12-02' }]);
  const op = r.weeks.find(x => x.monday === '2026-11-23').slots.jeu1.med;
  assert.ok(E.isTitulaire(op));
  const mer = r.weeks.find(x => x.monday === '2026-11-30').slots.mer;
  assert.notEqual(mer.med, op);
  assert.match(mer.exclus[op], /patient libéral/);
  assert.deepEqual(E.verify(r), []);
  assert.equal(E.liberaleStatus(r)[0].statut, 'ok');
});

test('patient libéral : bloc dans la même semaine que la consultation', () => {
  // Consultation lundi 30/11 (lun1), bloc jeudi 03/12
  const r = withLib([{ consult: '2026-11-30', bloc: '2026-12-03' }]);
  const w = r.weeks.find(x => x.monday === '2026-11-30');
  if (E.isTitulaire(w.slots.lun1.med)) {
    assert.notEqual(w.slots.jeu1.med, w.slots.lun1.med);
    assert.notEqual(w.slots.jeu2.med, w.slots.lun1.med);
  }
  assert.deepEqual(E.verify(r), []);
  assert.equal(E.liberaleStatus(r)[0].statut, 'ok');
});

test('patient libéral : forçage incompatible signalé en alerte', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.liberales = [{ consult: '2026-11-24', bloc: '2026-11-30' }];
  cfg.overrides['2026-11-23'] = { mar: 'SG' }; // SG indisponible le 30/11
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  assert.ok(E.alertes(r).some(a => /SG voit des patients libéraux opérés le 30\/11/.test(a)));
  assert.equal(E.liberaleStatus(r)[0].statut, 'alerte');
});

test('patient libéral : vendredi, hors période, bloc avant consultation', () => {
  const r = withLib([
    { consult: '2026-10-09', bloc: '2026-10-12' },
    { consult: '2027-01-05', bloc: '2027-01-11' },
    { consult: '2026-11-24', bloc: '2026-11-20' },
  ]);
  const st = E.liberaleStatus(r);
  assert.equal(st[0].statut, 'hors');
  assert.equal(st[1].statut, 'hors');
  assert.equal(st[2].statut, 'alerte');
  assert.deepEqual(E.verify(r), []);
  assert.deepEqual(E.alertes(r), []);
});

test('ajout d\'un 4e MAR : intégré à la rotation et au décompte', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.titulaires.push({ code: 'AB', couleur: '#b45309', max: 2 });
  cfg.indispos.AB = ['2026-10-13'];
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  const d = E.decompte(r.weeks, '2026-10-01', '2026-12-31');
  assert.ok((d.AB || 0) > 0, JSON.stringify(d));
  assert.notEqual(r.weeks.find(w => w.monday === '2026-10-12').slots.mar.med, 'AB');
  // Plus de MAR → moins de recours à "Autre MAR"
  const autre = res => res.weeks.reduce((n, w) => n + E.SLOTS.filter(s => w.slots[s.id].med === E.AUTRE).length, 0);
  assert.ok(autre(r) < autre(result));
});

test('GR : 30 % des consultations libérales (à 1 créneau près)', () => {
  const lib = r => {
    const d = E.decompte(r.weeks, '2026-10-01', '2026-12-31');
    return { d, total: Object.values(d).reduce((a, b) => a + b, 0) };
  };
  const scenarios = [[], ['AFR'], ['AFR', 'AB']];
  scenarios.forEach(extra => {
    const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
    extra.forEach(code => cfg.titulaires.push({ code, couleur: '#000', max: 2 }));
    const r = E.generate(cfg);
    const { d, total } = lib(r);
    assert.ok(Math.abs(d.GR - 0.3 * total) <= 1, `${3 + extra.length} MAR : ${JSON.stringify(d)}`);
    assert.deepEqual(E.verify(r), []);
  });
});

test('part libérale personnalisée : 50 % pour un MAR ajouté', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.titulaires.push({ code: 'AFR', couleur: '#000', max: 2 });
  cfg.titulaires.forEach(t => { delete t.part; if (t.code === 'AFR') t.part = 50; });
  const r = E.generate(cfg);
  const d = E.decompte(r.weeks, '2026-10-01', '2026-12-31');
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  assert.ok(d.AFR > d.RW && d.AFR > d.SG && d.AFR > d.GR, JSON.stringify(d));
  assert.ok(Math.abs(d.AFR - 0.5 * total) <= 2, JSON.stringify(d));
});
