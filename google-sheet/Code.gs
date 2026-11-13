// ============================================================
// SYNCHRONISATION GOOGLE SHEET — Planning consultations d'anesthésie
// À coller dans le Google Sheet : Extensions → Apps Script.
// Toute la saisie se fait sur le site ; ce Sheet conserve les réglages
// (partagés entre tous les postes) et affiche le planning.
// ============================================================

// 1) Choisir un code secret (le même sera saisi sur le site). Ne pas le partager.
const CODE_SECRET = 'A-CHANGER';

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

function traiter(params, corps) {
  params = params || {};
  if (CODE_SECRET === 'A-CHANGER') return { ok: false, erreur: 'Code secret non défini dans le script (CODE_SECRET)' };
  if (String(params.code || '') !== CODE_SECRET) return { ok: false, erreur: 'Code secret incorrect' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!corps) { // lecture
    const lu = lireReglages(ss);
    return { ok: true, reglages: lu.reglages, majLe: lu.majLe };
  }
  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    ecrireReglages(ss, corps.reglages, corps.majLe);
    if (corps.planning) ecrireTableau(ss, FEUILLE_PLANNING, corps.planning);
    if (corps.decompte) ecrireTableau(ss, FEUILLE_DECOMPTE, corps.decompte);
    SpreadsheetApp.flush();
  } finally {
    verrou.releaseLock();
  }
  return { ok: true, majLe: corps.majLe };
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
