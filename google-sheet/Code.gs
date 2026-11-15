// ============================================================
// SYNCHRONISATION GOOGLE SHEET — Planning consultations d'anesthésie
// À coller dans le Google Sheet : Extensions → Apps Script.
// Toute la saisie se fait sur le site ; ce Sheet conserve les réglages
// (partagés entre tous les postes) et affiche le planning.
// ============================================================

// Codes d'accès (le site les met dans les liens de connexion). Ne pas les partager hors de l'équipe.
const CODE_SECRET = 'A-CHANGER';  // administrateur : tout modifier
const CODE_INDISPOS = '';         // optionnel : saisie des indisponibilités seulement (ex. 'Indispo2026')
const CODE_LECTURE = '';          // optionnel : consultation seulement (ex. 'Voir2026')
// Après une modification de ce script : Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer.

const FEUILLE_REGLAGES = '_reglages';   // réglages du site (ne pas modifier à la main)
const FEUILLE_PLANNING = 'Planning';
const FEUILLE_DECOMPTE = 'Décompte';
const TAILLE_BLOC = 40000;              // une cellule Google Sheet contient au plus 50 000 caractères

function doGet(e) {
  return repondre(traiter(e && e.parameter, null));
}

function doPost(e) {
  let corps = {};
  try { corps = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return repondre({ ok: false, erreur: 'Requête illisible' }); }
  return repondre(traiter(corps, corps));
}

function roleDuCode(code) {
  code = String(code || '');
  if (code && code === CODE_SECRET) return 'admin';
  if (CODE_INDISPOS && code === CODE_INDISPOS) return 'indispos';
  if (CODE_LECTURE && code === CODE_LECTURE) return 'lecture';
  return null;
}

function traiter(params, corps) {
  try {
    params = params || {};
    if (CODE_SECRET === 'A-CHANGER') return { ok: false, erreur: 'Code secret non défini dans le script (CODE_SECRET)' };
    const role = roleDuCode(params.code);
    if (!role) return { ok: false, erreur: 'Code secret incorrect' };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { ok: false, erreur: 'Script à créer depuis le Google Sheet (Extensions → Apps Script)' };
    if (!corps) { // lecture
      const lu = lireReglages(ss);
      const rep = { ok: true, role: role, reglages: lu.reglages, majLe: lu.majLe };
      if (role === 'admin') rep.codes = { indispos: CODE_INDISPOS, lecture: CODE_LECTURE };
      return rep;
    }
    if (role === 'lecture') return { ok: false, role: role, erreur: 'Accès en consultation : modification refusée' };
    const verrou = LockService.getScriptLock();
    verrou.waitLock(20000);
    try {
      let reglages = corps.reglages;
      if (role === 'indispos') {
        // Seules les indisponibilités peuvent changer ; le reste est repris du Sheet
        const lu = lireReglages(ss);
        if (!lu.reglages) return { ok: false, role: role, erreur: 'Réglages absents du Sheet : un administrateur doit d\'abord se connecter' };
        reglages = Object.assign({}, lu.reglages, { indispos: (corps.reglages || {}).indispos || lu.reglages.indispos });
      }
      ecrireReglages(ss, reglages, corps.majLe);
      if (corps.planning) ecrireTableau(ss, FEUILLE_PLANNING, corps.planning);
      if (corps.decompte) ecrireTableau(ss, FEUILLE_DECOMPTE, corps.decompte);
      SpreadsheetApp.flush();
    } finally {
      verrou.releaseLock();
    }
    return { ok: true, role: role, majLe: corps.majLe };
  } catch (err) {
    return { ok: false, erreur: 'Erreur du script : ' + err.message };
  }
}

function lireReglages(ss) {
  const f = ss.getSheetByName(FEUILLE_REGLAGES);
  if (!f || f.getLastRow() < 2) return { reglages: null, majLe: 0 };
  const valeurs = f.getRange(1, 1, f.getLastRow(), 1).getValues().map(l => String(l[0]));
  const majLe = Number(valeurs[0]) || 0;
  const texte = valeurs.slice(1).join('');
  return { reglages: texte ? JSON.parse(texte) : null, majLe };
}

function ecrireReglages(ss, reglages, majLe) {
  let f = ss.getSheetByName(FEUILLE_REGLAGES);
  if (!f) { f = ss.insertSheet(FEUILLE_REGLAGES); f.hideSheet(); }
  const texte = JSON.stringify(reglages || {});
  const lignes = [[String(majLe || Date.now())]];
  for (let i = 0; i < texte.length; i += TAILLE_BLOC) lignes.push([texte.slice(i, i + TAILLE_BLOC)]);
  f.clear();
  f.getRange(1, 1, lignes.length, 1).setNumberFormat('@').setValues(lignes);
}

// tableau = [[en-têtes…], [ligne…], …]
function ecrireTableau(ss, nom, tableau) {
  let f = ss.getSheetByName(nom);
  if (!f) f = ss.insertSheet(nom);
  f.clear();
  if (!tableau.length) return;
  const largeur = Math.max.apply(null, tableau.map(l => l.length));
  const donnees = tableau.map(l => { const r = l.slice(); while (r.length < largeur) r.push(''); return r; });
  f.getRange(1, 1, donnees.length, largeur).setValues(donnees);
  f.getRange(1, 1, 1, largeur).setFontWeight('bold').setBackground('#eaeef2');
  f.setFrozenRows(1);
  f.autoResizeColumns(1, largeur);
}

function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}
