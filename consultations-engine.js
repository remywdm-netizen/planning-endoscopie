// ============================================================
// PLANNING CONSULTATIONS D'ANESTHÉSIE — MOTEUR DE GÉNÉRATION
// Utilisable dans le navigateur (window.ConsultEngine) et dans Node
// (require('./consultations-engine.js')).
// ============================================================
(function (root) {
  'use strict';

  const AUTRE = 'Autre MAR';

  // Créneaux de consultation (après-midi). dow : 0 = lundi … 3 = jeudi.
  // prio 1 = mardi + jeudi-C1 (comptés au décompte)
  // prio 2 = lundi-C1 + mercredi
  // prio 3 = lundi-C2 + jeudi-C2 (rotation simple)
  const SLOTS = [
    { id: 'lun1', dow: 0, jour: 'Lundi', label: 'Lun. C1', prio: 2 },
    { id: 'lun2', dow: 0, jour: 'Lundi', label: 'Lun. C2', prio: 3 },
    { id: 'mar', dow: 1, jour: 'Mardi', label: 'Mardi', prio: 1 },
    { id: 'mer', dow: 2, jour: 'Mercredi', label: 'Mercredi', prio: 2 },
    { id: 'jeu1', dow: 3, jour: 'Jeudi', label: 'Jeu. C1', prio: 1 },
    { id: 'jeu2', dow: 3, jour: 'Jeudi', label: 'Jeu. C2', prio: 3 },
  ];

  // Report de bloc : le praticien du créneau est au bloc N jours plus tard.
  const REPORT_BLOC = {
    mar: { offset: 6, cible: 'Lundi suivant' },   // mardi → lundi suivant
    jeu1: { offset: 5, cible: 'Mardi suivant' },  // jeudi-C1 → mardi suivant
  };

  function days(month, list) {
    return list.map(d => `2026-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const DEFAULT_CONFIG = {
    start: '2026-09-28', // lundi de la semaine de référence
    end: '2026-12-31',
    // Plafond hebdomadaire normal ; un titulaire dont "max" est plus élevé
    // ne le dépasse que si cela évite un "Autre MAR".
    cap: 2,
    // Les 3 MAR titulaires (modifiables depuis l'onglet "MAR").
    titulaires: [
      { code: 'RW', couleur: '#0550ae', max: 3 },
      { code: 'SG', couleur: '#9333ea', max: 2 },
      { code: 'GR', couleur: '#1b5e20', max: 2 },
    ],
    feries: {
      '2026-11-19': 'Fête Nationale Monégasque',
      '2026-12-08': 'Immaculée Conception',
    },
    indispos: {
      RW: [
        ...days(10, [5, 8, 9, 19, 20, 21, 22, 23, 27]),
        ...days(11, [3, 9, 10, 17, 18, 25, 27]),
        ...days(12, [1, 14, 15, 16, 17, 18, 21, 22, 23, 24]),
      ],
      SG: [
        ...days(10, [1, 2, 6, 12, 14, 26, 27, 28, 29, 30]),
        ...days(11, [4, 6, 18, 20, 25, 30]),
        ...days(12, [11, 14, 16, 21, 22, 23, 24]),
      ],
      GR: [
        ...days(10, [14, 15, 16, 20]), // erratum : 14 et non 17
        ...days(11, [3, 4, 5, 6, 9, 10, 11, 12, 13]),
        ...days(12, [11, 28, 29, 30, 31]),
      ],
    },
    // Praticiens forcés, indexés par le lundi de la semaine puis par créneau.
    // Un créneau forcé n'est pas recalculé ; les autres s'adaptent autour.
    // (La semaine du 28/09 est entièrement forcée : semaine de référence.)
    overrides: {
      '2026-09-28': { lun1: 'RW', lun2: 'GR', mar: 'AFR', mer: 'SG', jeu1: 'GR', jeu2: 'RW' },
    },
  };
  const TITULAIRES = DEFAULT_CONFIG.titulaires.map(t => t.code);

  // ── Dates (UTC pour éviter tout décalage de fuseau) ─────────
  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function toISO(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(iso, n) {
    const dt = parseISO(iso);
    dt.setUTCDate(dt.getUTCDate() + n);
    return toISO(dt);
  }
  function labelFR(iso) {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  function resolveConfig(userConfig) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
    cfg.codes = cfg.titulaires.map(t => t.code);
    cfg.maxOf = {};
    cfg.titulaires.forEach(t => { cfg.maxOf[t.code] = t.max || cfg.cap; });
    return cfg;
  }

  // Renomme un titulaire : reporte ses indisponibilités et overrides
  // sur le nouveau code. Renvoie une nouvelle config (sans muter l'ancienne).
  function renameTitulaire(config, oldCode, newCode) {
    const cfg = JSON.parse(JSON.stringify(config));
    cfg.titulaires.forEach(t => { if (t.code === oldCode) t.code = newCode; });
    if (cfg.indispos && cfg.indispos[oldCode]) {
      cfg.indispos[newCode] = cfg.indispos[oldCode];
      delete cfg.indispos[oldCode];
    }
    Object.values(cfg.overrides || {}).forEach(ov => {
      Object.keys(ov).forEach(k => { if (ov[k] === oldCode) ov[k] = newCode; });
    });
    return cfg;
  }

  // ── Génération ──────────────────────────────────────────────
  function generate(userConfig) {
    const cfg = resolveConfig(userConfig);
    const codes = cfg.codes;
    const isTit = m => codes.includes(m);
    const indispo = {};
    codes.forEach(t => { indispo[t] = new Set(cfg.indispos[t] || []); });

    const blocked = {};   // iso → Map(praticien → raison)
    const cum = {};       // cumuls par priorité
    codes.forEach(t => { cum[t] = { 1: 0, 2: 0, 3: 0 }; });

    const weeks = [];
    for (let monday = cfg.start; monday <= cfg.end; monday = addDays(monday, 7)) {
      const forces = cfg.overrides[monday] || {};
      const week = { monday, slots: {} };

      // Contexte de chaque créneau
      const ctx = SLOTS.map(s => {
        const date = addDays(monday, s.dow);
        const info = { slot: s, date, ferie: cfg.feries[date] || null, horsPeriode: date > cfg.end };
        info.force = !info.ferie && !info.horsPeriode && forces[s.id] ? forces[s.id] : null;
        info.exclus = {};
        codes.forEach(t => {
          if (indispo[t].has(date)) info.exclus[t] = 'Indisponible';
          else if (blocked[date] && blocked[date].has(t)) info.exclus[t] = blocked[date].get(t);
        });
        return info;
      });

      const actifs = ctx.filter(c => !c.ferie && !c.horsPeriode);
      week.override = actifs.length > 0 && actifs.every(c => c.force);
      const choice = bestWeek(ctx, cum, cfg);

      ctx.forEach((c, i) => {
        const who = choice[i];
        week.slots[c.slot.id] = {
          date: c.date,
          med: who,
          ferie: c.ferie,
          horsPeriode: c.horsPeriode,
          exclus: c.exclus,
          force: !!c.force,
          override: week.override,
        };
        if (!who) return;
        if (isTit(who)) cum[who][c.slot.prio]++;
        const rep = REPORT_BLOC[c.slot.id];
        if (rep && isTit(who)) {
          const target = addDays(c.date, rep.offset);
          if (!blocked[target]) blocked[target] = new Map();
          blocked[target].set(who, `Au bloc (report ${c.slot.label} du ${labelFR(c.date)})`);
        }
      });
      weeks.push(week);
    }
    return { config: cfg, weeks, decompte: decompte(weeks) };
  }

  // Recherche exhaustive de la meilleure semaine (≤ 4^6 combinaisons).
  // Les créneaux forcés sont figés ; les autres respectent les règles
  // vis-à-vis d'eux (même après-midi, mardi/jeudi-C1, plafond).
  function bestWeek(ctx, cum, cfg) {
    const codes = cfg.codes;
    const cands = ctx.map(c => {
      if (c.ferie || c.horsPeriode) return [null];
      if (c.force) return [c.force];
      return codes.filter(t => !c.exclus[t]).concat([AUTRE]);
    });

    let best = null, bestScore = null;
    const cur = new Array(ctx.length);
    const load = {};
    codes.forEach(t => { load[t] = 0; });
    ctx.forEach(c => { if (c.force && load[c.force] !== undefined) load[c.force]++; });
    const iMar = ctx.findIndex(c => c.slot.id === 'mar');
    const iJeu1 = ctx.findIndex(c => c.slot.id === 'jeu1');
    // Valeur connue d'un créneau : forcé, ou déjà choisi dans la récursion
    const known = (j, i) => (ctx[j].force ? ctx[j].force : (j < i ? cur[j] : undefined));

    (function rec(i) {
      if (i === ctx.length) {
        const sc = score(ctx, cur, cum, cfg);
        if (!bestScore || lexLess(sc, bestScore)) { bestScore = sc; best = cur.slice(); }
        return;
      }
      if (ctx[i].force || cands[i][0] === null) {
        cur[i] = cands[i][0];
        rec(i + 1);
        return;
      }
      for (const who of cands[i]) {
        const tit = who !== AUTRE;
        if (tit) {
          if (load[who] >= cfg.maxOf[who]) continue;
          // Un praticien ne fait qu'une consultation par après-midi
          let clash = false;
          for (let j = 0; j < ctx.length; j++) {
            if (j !== i && ctx[j].date === ctx[i].date && known(j, i) === who) clash = true;
          }
          if (clash) continue;
          // Exclusivité : pas mardi ET jeudi-C1 la même semaine
          if (i === iJeu1 && known(iMar, i) === who) continue;
          if (i === iMar && known(iJeu1, i) === who) continue;
        }
        cur[i] = who;
        if (tit) load[who]++;
        rec(i + 1);
        if (tit) load[who]--;
      }
    })(0);
    return best;
  }

  // Score lexicographique (plus petit = meilleur) :
  //  1. priorité 1 (mardi + jeudi-C1) : nb "Autre MAR", puis équilibre
  //  2. nb "Autre MAR" sur les autres créneaux
  //  3. dépassement du plafond normal (accepté seulement si ça évite un "Autre MAR")
  //  4. équilibre priorité 2 (lundi-C1 + mercredi), puis rotation priorité 3
  // Équilibre = somme des carrés des cumuls → favorise les cumuls les plus bas.
  function score(ctx, cur, cum, cfg) {
    const codes = cfg.codes;
    const autre = { 1: 0, 2: 0, 3: 0 };
    const add = {};
    codes.forEach(t => { add[t] = { 1: 0, 2: 0, 3: 0 }; });
    ctx.forEach((c, i) => {
      if (!cur[i]) return;
      if (cur[i] === AUTRE) autre[c.slot.prio]++;
      else if (add[cur[i]]) add[cur[i]][c.slot.prio]++;
      // (praticien externe forcé, ex. AFR : identique dans toutes les combinaisons)
    });
    const bal = prio => codes.reduce((acc, t) => {
      const v = cum[t][prio] + add[t][prio];
      return acc + v * v;
    }, 0);
    const depassement = codes.reduce((acc, t) =>
      acc + Math.max(0, add[t][1] + add[t][2] + add[t][3] - cfg.cap), 0);
    const tot = codes.reduce((acc, t) => {
      const v = [1, 2, 3].reduce((a, p) => a + cum[t][p] + add[t][p], 0);
      return acc + v * v;
    }, 0);
    return [
      autre[1], bal(1),
      autre[2] + autre[3],
      depassement,
      autre[2], bal(2), bal(3),
      tot,
      // Départage final stable
      cur.map(w => (w === null ? 0 : codes.indexOf(w) + 1)).join(''),
    ];
  }
  function lexLess(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  }

  // ── Décompte : uniquement mardi + jeudi-C1 ──────────────────
  function decompte(weeks, from, to) {
    const res = {};
    weeks.forEach(w => ['mar', 'jeu1'].forEach(id => {
      const s = w.slots[id];
      if (!s.med) return;
      if (from && s.date < from) return;
      if (to && s.date > to) return;
      res[s.med] = (res[s.med] || 0) + 1;
    }));
    return res;
  }

  // Toutes consultations confondues, par praticien.
  function totaux(weeks, from, to) {
    const res = {};
    weeks.forEach(w => SLOTS.forEach(s => {
      const c = w.slots[s.id];
      if (!c.med) return;
      if (from && c.date < from) return;
      if (to && c.date > to) return;
      res[c.med] = res[c.med] || { total: 0, 1: 0, 2: 0, 3: 0 };
      res[c.med].total++;
      res[c.med][s.prio]++;
    }));
    return res;
  }

  // ── Vérification de toutes les règles ───────────────────────
  // Chaque écart est rattaché aux créneaux concernés : s'il implique un
  // créneau forcé, c'est une alerte (choix manuel), sinon une erreur.
  function check(result) {
    const { config: cfg, weeks } = result;
    const codes = cfg.codes;
    const isTit = m => codes.includes(m);
    const issues = [];
    const add = (msg, ...cells) => issues.push({ msg, force: cells.some(c => c && c.force) });
    const indispo = {};
    codes.forEach(t => { indispo[t] = new Set(cfg.indispos[t] || []); });
    const blocked = {};

    weeks.forEach(w => {
      const cellsOf = {};
      SLOTS.forEach(s => {
        const c = w.slots[s.id];
        const who = c.med;
        if (c.ferie && who) add(`${c.date} férié mais attribué à ${who}`, c);
        if (!c.ferie && !c.horsPeriode && !who) add(`${c.date} ${s.label} non attribué`, c);
        if (!who || !isTit(who)) return;
        (cellsOf[who] = cellsOf[who] || []).push(c);
        if (indispo[who].has(c.date)) add(`${labelFR(c.date)} ${s.label} : ${who} indisponible`, c);
        if (blocked[c.date] && blocked[c.date].has(who)) add(`${labelFR(c.date)} ${s.label} : ${who} au bloc (report)`, c);
      });
      SLOTS.forEach(s => {
        const c = w.slots[s.id];
        if (REPORT_BLOC[s.id] && isTit(c.med)) {
          const t = addDays(c.date, REPORT_BLOC[s.id].offset);
          (blocked[t] = blocked[t] || new Set()).add(c.med);
        }
      });

      const sl = w.slots;
      const sem = `Semaine du ${labelFR(w.monday)}`;
      if (isTit(sl.mar.med) && sl.mar.med === sl.jeu1.med) add(`${sem} : ${sl.mar.med} fait mardi ET jeudi-C1`, sl.mar, sl.jeu1);
      if (isTit(sl.lun1.med) && sl.lun1.med === sl.lun2.med) add(`${sem} : ${sl.lun1.med} sur les 2 consultations du lundi`, sl.lun1, sl.lun2);
      if (isTit(sl.jeu1.med) && sl.jeu1.med === sl.jeu2.med) add(`${sem} : ${sl.jeu1.med} sur les 2 consultations du jeudi`, sl.jeu1, sl.jeu2);
      Object.entries(cellsOf).forEach(([t, cells]) => {
        if (cells.length > cfg.maxOf[t]) add(`${sem} : ${t} a ${cells.length} consultations (max ${cfg.maxOf[t]})`, ...cells);
      });

      // Exclusivité : "Autre MAR" sur mardi / jeudi-C1 seulement si aucun titulaire n'était éligible
      ['mar', 'jeu1'].forEach(id => {
        const c = sl[id];
        if (c.med !== AUTRE || c.force) return;
        const other = id === 'mar' ? sl.jeu1.med : sl.mar.med;
        const eligibles = codes.filter(t => !c.exclus[t] && t !== other
          && (cellsOf[t] || []).length < cfg.maxOf[t]
          && !(cellsOf[t] || []).some(x => x.date === c.date));
        if (eligibles.length) add(`${labelFR(c.date)} ${id} : Autre MAR alors que ${eligibles.join(', ')} éligible(s)`, c);
      });
    });
    return issues;
  }
  // Règles non respectées par le calcul automatique (doit être vide).
  function verify(result) { return check(result).filter(i => !i.force).map(i => i.msg); }
  // Écarts aux règles causés par un praticien forcé manuellement.
  function alertes(result) { return check(result).filter(i => i.force).map(i => i.msg); }

  const api = {
    TITULAIRES, AUTRE, SLOTS, REPORT_BLOC, DEFAULT_CONFIG,
    generate, verify, alertes, decompte, totaux, addDays, labelFR, renameTitulaire,
    isTitulaire: (m, cfg) => (cfg ? cfg.titulaires.map(t => t.code) : TITULAIRES).includes(m),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConsultEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
