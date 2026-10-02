// ============================================================
// PLANNING CONSULTATIONS D'ANESTHÉSIE — MOTEUR DE GÉNÉRATION
// Utilisable dans le navigateur (window.ConsultEngine) et dans Node
// (require('./consultations-engine.js')).
// ============================================================
(function (root) {
  'use strict';

  const TITULAIRES = ['RW', 'SG', 'GR'];
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
    // Plafond hebdomadaire normal ; RW peut monter à rwMax.
    cap: 2,
    rwMax: 3,
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
    // Overrides manuels, indexés par le lundi de la semaine.
    overrides: {
      '2026-09-28': { lun1: 'RW', lun2: 'GR', mar: 'AFR', mer: 'SG', jeu1: 'GR', jeu2: 'RW' },
    },
  };

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

  const isTitulaire = m => TITULAIRES.includes(m);

  // ── Génération ──────────────────────────────────────────────
  function generate(userConfig) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, userConfig || {});
    const indispo = {};
    TITULAIRES.forEach(t => { indispo[t] = new Set(cfg.indispos[t] || []); });

    const blocked = {};   // iso → Map(praticien → raison)
    const cum = {};       // cumuls par priorité
    TITULAIRES.forEach(t => { cum[t] = { 1: 0, 2: 0, 3: 0 }; });

    const weeks = [];
    for (let monday = cfg.start; monday <= cfg.end; monday = addDays(monday, 7)) {
      const week = { monday, slots: {}, override: !!cfg.overrides[monday] };

      // Contexte de chaque créneau
      const ctx = SLOTS.map(s => {
        const date = addDays(monday, s.dow);
        const info = { slot: s, date, ferie: cfg.feries[date] || null, horsPeriode: date > cfg.end };
        info.exclus = {};
        TITULAIRES.forEach(t => {
          if (indispo[t].has(date)) info.exclus[t] = 'Indisponible';
          else if (blocked[date] && blocked[date].has(t)) info.exclus[t] = blocked[date].get(t);
        });
        return info;
      });

      let choice;
      if (week.override) {
        const ov = cfg.overrides[monday];
        choice = SLOTS.map(s => ov[s.id] || null);
      } else {
        choice = bestWeek(ctx, cum, cfg);
      }

      ctx.forEach((c, i) => {
        const who = choice[i];
        week.slots[c.slot.id] = {
          date: c.date,
          med: who,
          ferie: c.ferie,
          horsPeriode: c.horsPeriode,
          exclus: c.exclus,
          override: week.override,
        };
        if (!who) return;
        if (isTitulaire(who)) cum[who][c.slot.prio]++;
        const rep = REPORT_BLOC[c.slot.id];
        if (rep && isTitulaire(who)) {
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
  function bestWeek(ctx, cum, cfg) {
    const cands = ctx.map(c => {
      if (c.ferie || c.horsPeriode) return [null];
      return TITULAIRES.filter(t => !c.exclus[t]).concat([AUTRE]);
    });

    let best = null, bestScore = null;
    const cur = new Array(ctx.length);
    const load = { RW: 0, SG: 0, GR: 0 };

    (function rec(i) {
      if (i === ctx.length) {
        const sc = score(ctx, cur, cum);
        if (!bestScore || lexLess(sc, bestScore)) { bestScore = sc; best = cur.slice(); }
        return;
      }
      for (const who of cands[i]) {
        if (isTitulaire(who)) {
          const max = who === 'RW' ? cfg.rwMax : cfg.cap;
          if (load[who] >= max) continue;
          // Un praticien ne fait qu'une consultation par après-midi
          let clash = false;
          for (let j = 0; j < i; j++) if (cur[j] === who && ctx[j].date === ctx[i].date) clash = true;
          if (clash) continue;
          // Exclusivité : pas mardi ET jeudi-C1 la même semaine
          if (ctx[i].slot.id === 'jeu1') {
            const iMar = ctx.findIndex(c => c.slot.id === 'mar');
            if (iMar < i && cur[iMar] === who) continue;
          }
        }
        cur[i] = who;
        if (isTitulaire(who)) load[who]++;
        rec(i + 1);
        if (isTitulaire(who)) load[who]--;
      }
    })(0);
    return best;
  }

  // Score lexicographique (plus petit = meilleur) :
  //  1. priorité 1 (mardi + jeudi-C1) : nb "Autre MAR", puis équilibre
  //  2. nb "Autre MAR" sur les autres créneaux
  //  3. RW au-delà de 2 (accepté seulement si ça évite un "Autre MAR")
  //  4. équilibre priorité 2 (lundi-C1 + mercredi), puis rotation priorité 3
  // Équilibre = somme des carrés des cumuls → favorise les cumuls les plus bas.
  function score(ctx, cur, cum) {
    const autre = { 1: 0, 2: 0, 3: 0 };
    const add = {};
    TITULAIRES.forEach(t => { add[t] = { 1: 0, 2: 0, 3: 0 }; });
    ctx.forEach((c, i) => {
      if (!cur[i]) return;
      if (cur[i] === AUTRE) autre[c.slot.prio]++;
      else add[cur[i]][c.slot.prio]++;
    });
    const bal = prio => TITULAIRES.reduce((acc, t) => {
      const v = cum[t][prio] + add[t][prio];
      return acc + v * v;
    }, 0);
    const weekRW = add.RW[1] + add.RW[2] + add.RW[3];
    const tot = TITULAIRES.reduce((acc, t) => {
      const v = [1, 2, 3].reduce((a, p) => a + cum[t][p] + add[t][p], 0);
      return acc + v * v;
    }, 0);
    return [
      autre[1], bal(1),
      autre[2] + autre[3],
      Math.max(0, weekRW - 2),
      autre[2], bal(2), bal(3),
      tot,
      // Départage final stable
      cur.map(w => (w === null ? 0 : TITULAIRES.indexOf(w) + 1)).join(''),
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
  function verify(result) {
    const { config: cfg, weeks } = result;
    const errors = [];
    const indispo = {};
    TITULAIRES.forEach(t => { indispo[t] = new Set(cfg.indispos[t] || []); });
    const blocked = {};

    weeks.forEach(w => {
      const load = {};
      SLOTS.forEach(s => {
        const c = w.slots[s.id];
        const who = c.med;
        if (c.ferie && who) errors.push(`${c.date} férié mais attribué à ${who}`);
        if (!c.ferie && !c.horsPeriode && !who) errors.push(`${c.date} ${s.label} non attribué`);
        if (!who || !isTitulaire(who)) return;
        load[who] = (load[who] || 0) + 1;
        if (w.override) return;
        if (indispo[who].has(c.date)) errors.push(`${c.date} ${s.label} : ${who} indisponible`);
        if (blocked[c.date] && blocked[c.date].has(who)) errors.push(`${c.date} ${s.label} : ${who} au bloc (report)`);
      });
      SLOTS.forEach(s => {
        const c = w.slots[s.id];
        if (REPORT_BLOC[s.id] && isTitulaire(c.med)) {
          const t = addDays(c.date, REPORT_BLOC[s.id].offset);
          (blocked[t] = blocked[t] || new Set()).add(c.med);
        }
      });
      if (w.override) return;

      const mar = w.slots.mar.med, jeu1 = w.slots.jeu1.med;
      if (mar && mar === jeu1 && isTitulaire(mar)) errors.push(`Semaine ${w.monday} : ${mar} fait mardi ET jeudi-C1`);
      if (w.slots.lun1.med && w.slots.lun1.med === w.slots.lun2.med && isTitulaire(w.slots.lun1.med))
        errors.push(`Semaine ${w.monday} : ${w.slots.lun1.med} sur les 2 consultations du lundi`);
      if (w.slots.jeu1.med && w.slots.jeu1.med === w.slots.jeu2.med && isTitulaire(w.slots.jeu1.med))
        errors.push(`Semaine ${w.monday} : ${w.slots.jeu1.med} sur les 2 consultations du jeudi`);
      Object.entries(load).forEach(([t, n]) => {
        const max = t === 'RW' ? cfg.rwMax : cfg.cap;
        if (n > max) errors.push(`Semaine ${w.monday} : ${t} a ${n} consultations (max ${max})`);
      });

      // Exclusivité : "Autre MAR" sur mardi / jeudi-C1 seulement si aucun titulaire n'était éligible
      ['mar', 'jeu1'].forEach(id => {
        const c = w.slots[id];
        if (c.med !== AUTRE) return;
        const other = id === 'mar' ? jeu1 : mar;
        const eligibles = TITULAIRES.filter(t => !c.exclus[t] && t !== other && (load[t] || 0) < (t === 'RW' ? cfg.rwMax : cfg.cap));
        if (eligibles.length) errors.push(`${c.date} ${id} : Autre MAR alors que ${eligibles.join(', ')} éligible(s)`);
      });
    });
    return errors;
  }

  const api = {
    TITULAIRES, AUTRE, SLOTS, REPORT_BLOC, DEFAULT_CONFIG,
    generate, verify, decompte, totaux, addDays, labelFR, isTitulaire,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConsultEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
