// ============================================================
// EXPORT EXCEL — planning hebdomadaire du service, partie endoscopie
// Remplit le modèle Excel du service (une feuille par semaine) à partir
// du résultat de ConsultEngine.generate(). Utilise ExcelJS, qui conserve
// la mise en forme du modèle. Navigateur : window.ExcelExport ; Node : require.
// ============================================================
(function (root) {
  'use strict';

  const JOURS = 5;          // lundi … vendredi : 4 colonnes par jour (M, M, AM, AM)
  const COL_LUNDI = 2;      // colonne B

  const norm = v => String(v == null ? '' : (v.richText ? v.richText.map(t => t.text).join('') : v))
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  // Repère les lignes du modèle d'après les libellés de la colonne A.
  function lireModele(ws) {
    const lignes = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { lignes[n] = norm(row.getCell(1).value); });
    const trouve = (re, apres = 0) => lignes.findIndex((l, n) => n > apres && l && re.test(l));
    const semaine = trouve(/^SEMAINE/);
    const blocs = trouve(/ANESTHESISTES AUX BLOCS/);
    const consults = trouve(/CONSULTATIONS D.ANESTHESIE/);
    const absents = trouve(/^ABSENT/);
    const referents = trouve(/ANESTHESISTES REFERENTS/);
    const infos = trouve(/^INFO/);
    if ([semaine, blocs, consults, absents].some(n => n < 0)) {
      throw new Error('Modèle non reconnu : il faut les lignes « SEMAINE n° », « ANESTHESISTES AUX BLOCS », « CONSULTATIONS D\'ANESTHESIE » et « ABSENTS » en colonne A.');
    }
    // Ligne(s) d'une rubrique : la ligne du libellé + celles fusionnées avec elle
    const hauteur = n => {
      let fin = n;
      while (fin + 1 < lignes.length && !lignes[fin + 1] && ws.getCell(fin + 1, 1).isMerged
        && ws.getCell(fin + 1, 1).master.address === ws.getCell(n, 1).address) fin++;
      return Array.from({ length: fin - n + 1 }, (_, i) => n + i);
    };
    const endoBloc = trouve(/ENDOSCOP/, blocs);
    const endoConsult = trouve(/ENDOSCOP/, consults);
    if (endoBloc < 0 || endoBloc > consults || endoConsult < 0 || endoConsult > absents) {
      throw new Error('Modèle non reconnu : ligne « ENDOSCOPIES » introuvable dans les blocs ou les consultations.');
    }
    const finEffacement = (referents > 0 ? referents : (infos > 0 ? infos + 2 : absents + 8)) - 1;
    return {
      dates: semaine + 1,
      numero: semaine + 2,
      debut: blocs,
      fin: finEffacement,
      endoBloc: hauteur(endoBloc),
      endoConsult: endoConsult,
      absents: hauteur(absents),
      infos: infos > 0 ? hauteur(infos) : [],
    };
  }

  // Numéro de semaine ISO
  function semaineISO(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    const jour = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - jour + 3);
    const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - premierJeudi) / 864e5 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7);
  }
  function ajoute(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const serieExcel = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5);

  // Contenu "endoscopie" d'une semaine : consultations, bloc, absences, infos.
  function contenuSemaine(result, week) {
    const { config: cfg, weeks } = result;
    const codes = cfg.titulaires.map(t => t.code);
    const jours = [];
    for (let d = 0; d < JOURS; d++) {
      const date = ajoute(week.monday, d);
      const slots = Object.values(week.slots).filter(s => s.date === date);
      const ferie = cfg.feries[date] || null;
      jours.push({
        date,
        ferie,
        consult: ferie ? [] : ['lun1', 'lun2', 'mar', 'mer', 'jeu1', 'jeu2']
          .map(id => week.slots[id]).filter(s => s.date === date).map(s => s.med || ''),
        bloc: [],      // [code, raison]
        absents: codes.filter(t => (cfg.indispos[t] || []).includes(date)),
        nbSlots: slots.length,
      });
    }
    // MAR au bloc d'endoscopie : report du mardi / jeudi-C1 et patients libéraux
    const report = { mar: 6, jeu1: 5 };
    weeks.forEach(w => Object.entries(w.slots).forEach(([id, s]) => {
      if (!s.med || s.med === 'Autre MAR') return; // praticien externe nommé (ex. AFR) compris
      const cibles = [];
      if (report[id] != null) cibles.push(ajoute(s.date, report[id]));
      (s.blocs || []).forEach(b => cibles.push(b));
      cibles.forEach(c => {
        const j = jours.find(x => x.date === c);
        if (j && !j.ferie && !j.bloc.includes(s.med) && !j.absents.includes(s.med)) j.bloc.push(s.med);
      });
    }));
    return jours;
  }

  // Copie une feuille (valeurs, styles, fusions, largeurs) dans le même classeur.
  function copierFeuille(wb, src, nom) {
    const ws = wb.addWorksheet(nom, {
      properties: Object.assign({}, src.properties),
      pageSetup: Object.assign({}, src.pageSetup),
      views: src.views,
    });
    src.columns && src.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.width) col.width = c.width;
      if (c.hidden) col.hidden = true;
    });
    // Fusionner d'abord : la fusion recopie le style de la 1re case, on remet ensuite le style de chaque case
    Object.keys(src._merges || {}).forEach(k => ws.mergeCells(src._merges[k].range));
    src.eachRow({ includeEmpty: true }, (row, r) => {
      const dst = ws.getRow(r);
      if (row.height) dst.height = row.height;
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const d = dst.getCell(c);
        d.style = JSON.parse(JSON.stringify(cell.style || {}));
        if (cell.isMerged && cell.master.address !== cell.address) return;
        if (cell.formula) d.value = { formula: cell.formula };
        else d.value = cell.value;
        if (cell.note) d.note = JSON.parse(JSON.stringify(cell.note));
      });
    });
    // Couleurs automatiques (compteurs d'erreurs rouge / vert), en-têtes d'impression
    (src.conditionalFormattings || []).forEach(cf => ws.addConditionalFormatting(JSON.parse(JSON.stringify(cf))));
    if (src.headerFooter) ws.headerFooter = JSON.parse(JSON.stringify(src.headerFooter));
    return ws;
  }

  function ecrire(ws, r, c, v) {
    const cell = ws.getCell(r, c);
    (cell.isMerged ? cell.master : cell).value = v;
  }

  function remplirSemaine(ws, L, week, jours) {
    const lastCol = COL_LUNDI + 4 * 7 - 1; // jusqu'à AC
    // Effacer les données de l'ancienne semaine (colonnes B à U), sans toucher aux styles ni aux formules
    for (let r = L.debut + 1; r <= L.fin; r++) {
      for (let c = COL_LUNDI; c < COL_LUNDI + 4 * JOURS; c++) {
        const cell = ws.getCell(r, c);
        if (!cell.formula && !(cell.isMerged && cell.master.address !== cell.address)) cell.value = null;
      }
    }
    // Gardes du week-end (ligne des blocs, colonnes V à AC)
    for (let c = COL_LUNDI + 4 * JOURS; c <= lastCol; c++) {
      const cell = ws.getCell(L.debut, c);
      if (!cell.formula && !(cell.isMerged && cell.master.address !== cell.address)) cell.value = null;
    }
    // Numéro de semaine et dates (lundi → dimanche)
    ecrire(ws, L.numero, 1, semaineISO(week.monday));
    for (let d = 0; d < 7; d++) ecrire(ws, L.dates, COL_LUNDI + 4 * d, serieExcel(ajoute(week.monday, d)));

    jours.forEach((j, d) => {
      const base = COL_LUNDI + 4 * d;
      // Consultations d'anesthésie → ENDOSCOPIES (après-midi)
      j.consult.forEach((m, i) => ecrire(ws, L.endoConsult, base + 2 + i, m));
      // Bloc ENDOSCOPIES (matin)
      const cases = L.endoBloc.flatMap(r => [[r, base], [r, base + 1]]);
      j.bloc.slice(0, cases.length).forEach((m, i) => ecrire(ws, cases[i][0], cases[i][1], m));
      // Absents
      const casesAbs = L.absents.flatMap(r => [0, 1, 2, 3].map(k => [r, base + k]));
      j.absents.slice(0, casesAbs.length).forEach((m, i) => ecrire(ws, casesAbs[i][0], casesAbs[i][1], m));
      // Infos : jour férié
      if (j.ferie && L.infos.length) ecrire(ws, L.infos[0], base, `Férié : ${j.ferie}`);
    });
  }

  // Génère le classeur : une feuille par semaine (nommée par son n° ISO).
  // ExcelJS : la classe ExcelJS ; modele : ArrayBuffer/Buffer du fichier modèle.
  async function generer(ExcelJS, modele, result, mondays, nomFeuille) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(modele);
    const src = (nomFeuille && wb.getWorksheet(nomFeuille)) || wb.worksheets[wb.worksheets.length - 1];
    const L = lireModele(src);
    const anciennes = wb.worksheets.slice();
    const semaines = result.weeks.filter(w => mondays.includes(w.monday));
    if (!semaines.length) throw new Error('Aucune semaine sélectionnée.');
    const resume = [];
    semaines.forEach(w => {
      const n = semaineISO(w.monday);
      const ws = copierFeuille(wb, src, `S${n}`);
      const jours = contenuSemaine(result, w);
      remplirSemaine(ws, L, w, jours);
      resume.push({ monday: w.monday, semaine: n, jours });
    });
    anciennes.forEach(ws => wb.removeWorksheet(ws.id));
    semaines.forEach(w => { const ws = wb.getWorksheet(`S${semaineISO(w.monday)}`); if (ws) ws.name = String(semaineISO(w.monday)); });
    wb.calcProperties = Object.assign({}, wb.calcProperties, { fullCalcOnLoad: true });
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, resume, feuilleModele: src.name };
  }

  const api = { generer, lireModele, contenuSemaine, semaineISO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExcelExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
