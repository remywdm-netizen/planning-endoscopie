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
  // Pas de report depuis le 19/11 → personne n'est exclu « au bloc » le mardi 24/11 à cause du 19/11
  Object.values(slot('2026-11-23', 'mar').exclus).forEach(r => assert.doesNotMatch(r, /19\/11/));
  // Lundi 2 novembre férié (Toussaint reportée)
  assert.equal(slot('2026-11-02', 'lun1').med, null);
  assert.equal(slot('2026-11-02', 'lun2').med, null);
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

test('report de bloc : le MAR du mardi / jeudi-C1 est disponible le jour de son bloc', () => {
  const ind = {};
  E.TITULAIRES.forEach(t => { ind[t] = new Set(E.DEFAULT_CONFIG.indispos[t]); });
  result.weeks.filter(w => !w.override).forEach(w => [['mar', 6], ['jeu1', 5]].forEach(([id, off]) => {
    const c = w.slots[id];
    if (!E.isTitulaire(c.med)) return;
    const bloc = E.addDays(c.date, off);
    if (E.DEFAULT_CONFIG.feries[bloc]) return;
    assert.ok(!ind[c.med].has(bloc), `${c.date} ${id} : ${c.med} indisponible le ${bloc}`);
  }));
});

test('libérales : le moins d\'« Autre MAR » possible (8 au T4 avec RW, SG, GR)', () => {
  const d = E.decompte(result.weeks, '2026-10-01', '2026-12-31');
  assert.equal(d[E.AUTRE], 8, JSON.stringify(d));
  // Chaque « Autre MAR » du mardi / jeudi-C1 : aucun titulaire n'était possible
  assert.deepEqual(E.verify(result), []);
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
  // Le MAR calculé en lun1 le 30/11 est forcé en lun2 : lun1 doit changer
  const x = slot('2026-11-30', 'lun1').med;
  assert.ok(E.isTitulaire(x));
  const r = withForce('2026-11-30', 'lun2', x);
  const w = r.weeks.find(y => y.monday === '2026-11-30');
  assert.equal(w.slots.lun2.med, x);
  assert.ok(w.slots.lun2.force);
  assert.notEqual(w.slots.lun1.med, x, 'pas 2 consultations le même après-midi');
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
  // Mardi 24/11 : le MAR calculé est X ; on importe un patient opéré un jour où X est indisponible
  const x = slot('2026-11-23', 'mar').med;
  assert.ok(E.isTitulaire(x));
  const bloc = E.DEFAULT_CONFIG.indispos[x].find(d => d > '2026-11-24' && !E.DEFAULT_CONFIG.feries[d]);
  assert.ok(bloc, 'une indisponibilité de ' + x + ' après le 24/11');
  const r = withLib([{ consult: '2026-11-24', bloc, info: 'Coloscopie' }]);
  const w = r.weeks.find(y => y.monday === '2026-11-23');
  assert.notEqual(w.slots.mar.med, x);
  assert.match(w.slots.mar.exclus[x], new RegExp('Indisponible le ' + E.labelFR(bloc).replace('/', '\\/')));
  assert.deepEqual(E.verify(r), []);
  const st = E.liberaleStatus(r);
  assert.equal(st[0].slot.id, 'mar');
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
  if (E.isTitulaire(w.slots.lun1.med)) assert.equal(E.liberaleStatus(r)[0].statut, 'ok');
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

test('GR : au moins 30 % des consultations libérales, de 3 à 6 MAR', () => {
  [[], ['AFR'], ['AFR', 'AB'], ['AFR', 'AB', 'CD']].forEach(extra => {
    const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
    extra.forEach(code => cfg.titulaires.push({ code, couleur: '#000', max: 2 }));
    const r = E.generate(cfg);
    const d = E.decompte(r.weeks, '2026-10-01', '2026-12-31');
    const total = Object.values(d).reduce((a, b) => a + b, 0);
    assert.ok(d.GR >= E.minimumPart(30, total), `${3 + extra.length} MAR : ${JSON.stringify(d)}`);
    assert.ok(d.GR / total >= 0.3, `${3 + extra.length} MAR : ${JSON.stringify(d)}`);
    assert.deepEqual(E.verify(r), []);
  });
});

test('minimum arrondi au créneau supérieur', () => {
  assert.equal(E.minimumPart(30, 25), 8);
  assert.equal(E.minimumPart(30, 20), 6);
  assert.equal(E.minimumPart(30, 21), 7);
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

const X = require('../excel-export.js');

test('export Excel : numéro de semaine ISO', () => {
  assert.equal(X.semaineISO('2026-10-05'), 41);
  assert.equal(X.semaineISO('2026-12-28'), 53);
  assert.equal(X.semaineISO('2026-09-28'), 40);
});

test('export Excel : contenu endoscopie de la semaine 41', () => {
  const w = week('2026-10-05');
  const jours = X.contenuSemaine(result, w);
  assert.equal(jours.length, 5);
  // Consultations de l'après-midi = planning du site
  assert.deepEqual(jours[0].consult, [w.slots.lun1.med, w.slots.lun2.med]);
  assert.deepEqual(jours[1].consult, [w.slots.mar.med]);
  assert.deepEqual(jours[3].consult, [w.slots.jeu1.med, w.slots.jeu2.med]);
  assert.deepEqual(jours[4].consult, []);
  // Bloc du matin par report : AFR (mardi 29/09) le lundi, GR (jeudi-C1 01/10) le mardi
  assert.deepEqual(jours[0].bloc, ['AFR']);
  assert.deepEqual(jours[1].bloc, ['GR']);
  // Absents = indisponibilités des MAR
  assert.ok(jours[0].absents.includes('RW'));
});

test('export Excel : jour férié sans consultation', () => {
  const jours = X.contenuSemaine(result, week('2026-11-16'));
  assert.equal(jours[3].ferie, 'Fête Nationale Monégasque');
  assert.deepEqual(jours[3].consult, []);
});

test('indisponibilités d\'AFR en novembre (dont repos le 27/11)', () => {
  assert.deepEqual(E.DEFAULT_CONFIG.indispos.AFR,
    ['2026-11-03', '2026-11-09', '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-27']);
  assert.ok(!E.DEFAULT_CONFIG.indispos.GR.includes('2026-11-27'));
  // AFR ajouté comme MAR : jamais en consultation ni au bloc de report un jour indisponible
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.titulaires.push({ code: 'AFR', couleur: '#0891b2', max: 2 });
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  const ind = new Set(cfg.indispos.AFR);
  r.weeks.forEach(w => E.SLOTS.forEach(s => {
    const c = w.slots[s.id];
    if (c.med === 'AFR' && !w.override) assert.ok(!ind.has(c.date), c.date);
  }));
});
