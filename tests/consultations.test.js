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

test('patient libéral : le MAR retenu est celui qui a le moins de patients à donner', () => {
  // Mardi 24/11 : le MAR calculé est X ; on importe 2 patients opérés un jour où X est absent
  const x = slot('2026-11-23', 'mar').med;
  assert.ok(E.isTitulaire(x));
  const bloc = E.DEFAULT_CONFIG.indispos[x].find(d => d > '2026-11-24' && !E.DEFAULT_CONFIG.feries[d]);
  assert.ok(bloc, 'une indisponibilité de ' + x + ' après le 24/11');
  const r = withLib([{ consult: '2026-11-24', bloc, nb: 2, info: 'Coloscopie' }]);
  const c = r.weeks.find(y => y.monday === '2026-11-23').slots.mar;
  assert.equal(c.aDonner[x], 2, x + ' aurait 2 patients à donner');
  // Le MAR choisi a le minimum de patients à donner parmi les titulaires possibles ce mardi
  const possibles = E.TITULAIRES.filter(t => !c.exclus[t]);
  const mini = Math.min(...possibles.map(t => c.aDonner[t] || 0));
  if (E.isTitulaire(c.med)) assert.equal(c.aDonner[c.med] || 0, mini, JSON.stringify(c.aDonner));
  assert.deepEqual(E.verify(r), []);
  assert.equal(E.liberaleStatus(r)[0].slot.id, 'mar');
});

test('patient libéral : à défaut, un MAR absent au bloc plutôt qu\'« Autre MAR », avec patients à donner', () => {
  // Mardi 01/12 : RW absent ce jour-là ; SG et GR possibles. 3 patients opérés le 11/12 (SG et GR absents).
  const r = withLib([{ consult: '2026-12-01', bloc: '2026-12-11', nb: 3 }]);
  const c = r.weeks.find(y => y.monday === '2026-11-30').slots.mar;
  assert.notEqual(c.med, E.AUTRE, 'règle du mardi : un titulaire');
  assert.equal(c.med, 'SG', 'GR autonome ne peut pas donner : SG retenu');
  assert.ok(E.alertes(r).some(a => /3 patient\(s\) du 11\/12 à donner \(SG absent/.test(a)), JSON.stringify(E.alertes(r)));
  const st = E.liberaleStatus(r)[0];
  assert.equal(st.statut, 'alerte');
  assert.ok(st.aDonner);
  assert.deepEqual(E.verify(r), []);
});

test('patient libéral : bloc le matin, le MAR peut consulter l\'après-midi du même jour', () => {
  // Consultation jeudi 26/11 (jeudi-C1), bloc mercredi 02/12 : rien n'interdit au MAR de consulter le 02/12
  const r = withLib([{ consult: '2026-11-26', bloc: '2026-12-02', nb: 2 }]);
  const op = r.weeks.find(x => x.monday === '2026-11-23').slots.jeu1.med;
  assert.ok(E.isTitulaire(op));
  const mer = r.weeks.find(x => x.monday === '2026-11-30').slots.mer;
  assert.ok(!mer.exclus[op] || !/libéral/.test(mer.exclus[op]), 'pas d\'exclusion liée au bloc libéral');
  assert.deepEqual(E.verify(r), []);
  assert.equal(E.liberaleStatus(r)[0].statut, 'ok');
  // Même semaine : consultation lundi 30/11, bloc jeudi 03/12 → le MAR peut faire le jeudi après-midi
  const r2 = withLib([{ consult: '2026-11-30', bloc: '2026-12-03', nb: 1 }]);
  assert.deepEqual(E.verify(r2), []);
  assert.equal(E.liberaleStatus(r2)[0].statut, 'ok');
  // Patients confiés : celui qui les reçoit peut aussi consulter l'après-midi du jour de bloc
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.liberales = [{ consult: '2026-11-24', bloc: '2026-12-02', nb: 2, donneA: 'SG' }];
  const r3 = E.generate(cfg);
  const w3 = r3.weeks.find(x => x.monday === '2026-11-30');
  E.SLOTS.forEach(s => { if (w3.slots[s.id].date === '2026-12-02') assert.ok(!w3.slots[s.id].exclus.SG || !/confiés/.test(w3.slots[s.id].exclus.SG)); });
  assert.deepEqual(E.verify(r3), []);
});

test('patient libéral : forçage incompatible signalé en alerte', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.liberales = [{ consult: '2026-11-24', bloc: '2026-11-30' }];
  cfg.overrides['2026-11-23'] = { mar: 'SG' }; // SG indisponible le 30/11
  const r = E.generate(cfg);
  assert.deepEqual(E.verify(r), []);
  assert.ok(E.alertes(r).some(a => /patient\(s\) du 30\/11 à donner \(SG absent/.test(a)), JSON.stringify(E.alertes(r)));
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

test('fermer un créneau : pas de consultation, ni décompte, ni report de bloc', () => {
  const avant = slot('2026-11-23', 'mar').med;
  assert.ok(E.isTitulaire(avant));
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.overrides['2026-11-23'] = { mar: E.FERME };
  const r = E.generate(cfg);
  const w = r.weeks.find(x => x.monday === '2026-11-23');
  assert.equal(w.slots.mar.med, null);
  assert.ok(w.slots.mar.ferme);
  assert.ok(!w.override, 'les autres créneaux restent calculés');
  assert.ok(w.slots.jeu1.med, 'jeudi-C1 toujours attribué');
  assert.deepEqual(E.verify(r), []);
  assert.deepEqual(E.alertes(r), []);
  // Plus de report de bloc depuis ce mardi : personne n'est « au bloc » le lundi 30/11 à cause du 24/11
  const lun = r.weeks.find(x => x.monday === '2026-11-30').slots.lun1;
  Object.values(lun.exclus).forEach(x => assert.doesNotMatch(x, /Mardi du 24\/11/));
  // Décompte : une libérale de moins
  const tot = res => Object.values(E.decompte(res.weeks, '2026-10-01', '2026-12-31')).reduce((a, b) => a + b, 0);
  assert.equal(tot(r), tot(result) - 1);
});

test('patient libéral vu un jour où le créneau est fermé : alerte', () => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.overrides['2026-11-23'] = { mar: E.FERME };
  cfg.liberales = [{ consult: '2026-11-24', bloc: '2026-12-01' }];
  const st = E.liberaleStatus(E.generate(cfg));
  assert.equal(st[0].statut, 'alerte');
  assert.match(st[0].raison, /fermé/);
});

// 4 MAR (AB sans indisponibilité) : GR est autonome, il faut un autre MAR pour recevoir des patients
const cfg4 = (liberales = []) => {
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.titulaires.push({ code: 'AB', couleur: '#000', max: 2 });
  cfg.indispos.AB = [];
  cfg.liberales = liberales;
  return cfg;
};

test('patients libéraux confiés : le MAR de la consultation n\'a plus à être au bloc', () => {
  const base = E.generate(cfg4());
  const x = base.weeks.find(w => w.monday === '2026-11-23').slots.mar.med;
  assert.ok(E.isTitulaire(x, base.config));
  const bloc = (base.config.indispos[x] || []).find(d => d > '2026-11-24' && !E.DEFAULT_CONFIG.feries[d]);
  assert.ok(bloc, 'une indisponibilité de ' + x + ' après le 24/11');
  // Sans don : X écarté de la consultation (absent un jour de bloc)
  const sans = E.generate(cfg4([{ consult: '2026-11-24', bloc, nb: 3 }]));
  assert.notEqual(sans.weeks.find(w => w.monday === '2026-11-23').slots.mar.med, x);
  // Les 3 patients confiés à un MAR non autonome présent ce jour-là : X n'est plus écarté
  const y = ['RW', 'SG', 'AB'].find(t => t !== x && !(base.config.indispos[t] || []).includes(bloc) && !(base.config.indispos[t] || []).includes('2026-11-24'));
  const avec = E.generate(cfg4([{ consult: '2026-11-24', bloc, nb: 3, donneA: y }]));
  const w = avec.weeks.find(v => v.monday === '2026-11-23');
  assert.ok(!w.slots.mar.exclus[x] || !/patient libéral/.test(w.slots.mar.exclus[x]));
  assert.deepEqual(E.verify(avec), []);
  // Y est au bloc le matin : il peut consulter l'après-midi (pas de contrainte)
  const st = E.liberaleStatus(avec)[0];
  assert.equal(st.statut, 'ok', st.raison);
  assert.equal(st.operateur, y);
  assert.match(st.raison, /confiés à/);
});

test('patients libéraux : une partie confiée, le reste garde la contrainte de présence', () => {
  const base = E.generate(cfg4());
  const x = base.weeks.find(w => w.monday === '2026-11-23').slots.mar.med;
  const bloc = (base.config.indispos[x] || []).find(d => d > '2026-11-24' && !E.DEFAULT_CONFIG.feries[d]);
  const y = ['RW', 'SG', 'AB'].find(t => t !== x && !(base.config.indispos[t] || []).includes(bloc));
  const r = E.generate(cfg4([{ consult: '2026-11-24', bloc, nb: 2 }, { consult: '2026-11-24', bloc, nb: 1, donneA: y }]));
  assert.notEqual(r.weeks.find(v => v.monday === '2026-11-23').slots.mar.med, x, 'X doit encore être au bloc pour 2 patients');
  assert.deepEqual(E.verify(r), []);
});

test('patients confiés à un MAR indisponible ce jour-là : alerte', () => {
  const r = withLib([{ consult: '2026-11-24', bloc: '2026-12-14', nb: 2, donneA: 'RW' }]); // RW indisponible le 14/12
  assert.ok(E.alertes(r).some(a => /RW reçoit des patients libéraux mais est indisponible/.test(a)));
  assert.equal(E.liberaleStatus(r)[0].statut, 'alerte');
});

test('patients confiés : le MAR qui les reçoit doit être présent le jour de la consultation', () => {
  // Consultation mardi 03/11 : RW et GR indisponibles ce jour-là ; patients confiés à RW → alerte
  const r = withLib([{ consult: '2026-11-03', bloc: '2026-11-05', nb: 2, donneA: 'RW' }]);
  assert.ok(E.alertes(r).some(a => /RW reçoit des patients libéraux vus ce jour-là mais est indisponible/.test(a)), JSON.stringify(E.alertes(r)));
  const st = E.liberaleStatus(r)[0];
  assert.equal(st.statut, 'alerte');
  assert.match(st.raison, /jour de la consultation/);
});

test('GR autonome : ne donne ni ne reçoit de patients libéraux', () => {
  assert.ok(E.DEFAULT_CONFIG.titulaires.find(t => t.code === 'GR').autonome);
  // GR ne reçoit pas : alerte si des patients lui sont confiés
  const r1 = withLib([{ consult: '2026-11-24', bloc: '2026-11-25', nb: 2, donneA: 'GR' }]);
  assert.ok(E.alertes(r1).some(a => /GR est autonome et ne reçoit pas/.test(a)));
  assert.equal(E.liberaleStatus(r1)[0].statut, 'alerte');
  // GR ne donne pas : une consultation avec des patients confiés n'est jamais attribuée à GR
  const w0 = week('2026-11-23');
  const jeudi = w0.slots.jeu1; // jeudi 26/11
  assert.equal(jeudi.med, 'GR', 'GR fait le jeudi-C1 du 26/11 sans patients confiés');
  const r2 = withLib([{ consult: '2026-11-26', bloc: '2026-12-01', nb: 2, donneA: 'SG' }]);
  const j2 = r2.weeks.find(w => w.monday === '2026-11-23').slots.jeu1;
  assert.notEqual(j2.med, 'GR');
  assert.match(j2.exclus.GR, /Autonome/);
  assert.deepEqual(E.verify(r2), []);
});

test('patients libéraux sur la consultation 2 du lundi', () => {
  // Lundi 23/11 : 2 patients sur Lun. C2, opérés le 25/11 (RW et SG absents ce jour-là)
  const r = withLib([{ consult: '2026-11-23', slot: 'lun2', bloc: '2026-11-25', nb: 2 }]);
  const w = r.weeks.find(x => x.monday === '2026-11-23');
  assert.deepEqual(w.slots.lun2.blocs, ['2026-11-25']);
  assert.deepEqual(w.slots.lun1.blocs, [], 'Lun. C1 non concerné');
  const st = E.liberaleStatus(r)[0];
  assert.equal(st.slot.id, 'lun2');
  assert.equal(st.med, w.slots.lun2.med);
  // Le MAR de Lun. C2 n'est pas en consultation le jour du bloc s'il opère
  if (E.isTitulaire(w.slots.lun2.med) && !E.DEFAULT_CONFIG.indispos[w.slots.lun2.med].includes('2026-11-25'))
    assert.notEqual(w.slots.mer.med, w.slots.lun2.med);
  assert.deepEqual(E.verify(r), []);
  // Sans créneau précisé, un lundi reste sur Lun. C1 (compatibilité)
  const r1 = withLib([{ consult: '2026-11-23', bloc: '2026-11-25', nb: 1 }]);
  assert.equal(E.liberaleStatus(r1)[0].slot.id, 'lun1');
});

test('journées passées figées : plus jamais recalculées', () => {
  // Fige les consultations jusqu'au 13/11 telles que calculées aujourd'hui
  const figes = {};
  result.weeks.forEach(w => E.SLOTS.forEach(s => {
    const c = w.slots[s.id];
    if (c.date < '2026-11-14' && !c.ferie && !c.horsPeriode) figes[c.date + '|' + s.id] = c.ferme ? E.FERME : c.med;
  }));
  // Changements après coup : nouvelles indisponibilités, un MAR en plus, des patients libéraux
  const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
  cfg.figes = figes;
  cfg.indispos.SG.push('2026-10-13', '2026-10-15', '2026-11-10');
  cfg.titulaires.push({ code: 'AB', couleur: '#000', max: 2 });
  cfg.indispos.AB = [];
  cfg.liberales = [{ consult: '2026-10-20', bloc: '2026-10-26', nb: 2 }];
  const r = E.generate(cfg);
  r.weeks.forEach((w, i) => E.SLOTS.forEach(s => {
    const c = w.slots[s.id];
    if (c.date < '2026-11-14') {
      assert.equal(c.med, result.weeks[i].slots[s.id].med, `${c.date} ${s.id} inchangé`);
      if (!c.ferie && !c.horsPeriode) assert.ok(c.fige, `${c.date} ${s.id} figé`);
    }
  }));
  // Les journées passées ne comptent pas comme erreurs même si elles ne respectent plus les nouvelles règles
  assert.deepEqual(E.verify(r), []);
  // Après le 14/11, le calcul tient compte des changements (AB intégré)
  assert.ok(r.weeks.some(w => w.monday >= '2026-11-16' && E.SLOTS.some(s => w.slots[s.id].med === 'AB')));
});

test('patients libéraux sur la consultation 2 du jeudi', () => {
  // Jeudi 26/11 : 2 patients sur Jeu. C2, opérés le 30/11
  const r = withLib([{ consult: '2026-11-26', slot: 'jeu2', bloc: '2026-11-30', nb: 2 }]);
  const w = r.weeks.find(x => x.monday === '2026-11-23');
  assert.deepEqual(w.slots.jeu2.blocs, ['2026-11-30']);
  assert.deepEqual(w.slots.jeu1.blocs, [], 'Jeu. C1 non concerné');
  const st = E.liberaleStatus(r)[0];
  assert.equal(st.slot.id, 'jeu2');
  assert.equal(st.med, w.slots.jeu2.med);
  assert.deepEqual(E.verify(r), []);
  // Sans créneau précisé, un jeudi reste sur Jeu. C1
  assert.equal(E.liberaleStatus(withLib([{ consult: '2026-11-26', bloc: '2026-11-30' }]))[0].slot.id, 'jeu1');
});

test('décompte des patients libéraux par praticien (consultation, bloc, donnés, reçus)', () => {
  const base = E.generate(cfg4());
  const w = base.weeks.find(v => v.monday === '2026-11-23');
  const x = w.slots.mar.med, z = w.slots.jeu1.med;
  const y = ['RW', 'SG', 'AB'].find(t => t !== x && !(base.config.indispos[t] || []).includes('2026-12-01') && !(base.config.indispos[t] || []).includes('2026-11-24'));
  const r = E.generate(Object.assign(cfg4([
    { consult: '2026-11-24', bloc: '2026-12-01', nb: 3 },
    { consult: '2026-11-24', bloc: '2026-12-01', nb: 2, donneA: y },
    { consult: '2026-11-26', bloc: '2026-12-02', nb: 4 },
    { consult: '2027-01-05', bloc: '2027-01-06', nb: 9 }, // hors période : non compté
  ]), { overrides: Object.assign({}, E.DEFAULT_CONFIG.overrides, { '2026-11-23': { mar: x, jeu1: z } }) }));
  const d = E.decompteLiberaux(r);
  const tot = k => Object.values(d).reduce((a, v) => a + v[k], 0);
  assert.equal(tot('consult'), 9);
  assert.equal(tot('donnes'), 2);
  assert.equal(tot('recus'), 2);
  assert.equal(d[x].donnes, 2);
  assert.equal(d[y].recus, 2);
  assert.equal(d[x].consult, 5 + (x === z ? 4 : 0));
  assert.equal(tot('bloc') + tot('aDonner'), 9, 'chaque patient compté une fois : assuré au bloc ou encore à donner');
  assert.ok(r.config.codes.every(c => d[c]), 'tous les MAR présents dans le décompte');
});
