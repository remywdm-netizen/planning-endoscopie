// ============================================================
// SYNCHRONISATION GOOGLE SHEET — Planning consultations d'anesthésie
// À coller dans le Google Sheet : Extensions → Apps Script.
// Toute la saisie se fait sur le site ; ce Sheet conserve les réglages
// (partagés entre tous les postes) et affiche le planning.
// ============================================================

// 1) Choisir un code secret (le même sera saisi sur le site, ou contenu dans le lien de connexion).
//    Ne le partager qu'avec l'équipe.
const CODE_SECRET = 'A-CHANGER';
// Protections : le Sheet refuse d'être écrasé par des réglages vides ou revenus à l'origine,
// et garde des sauvegardes datées (feuille masquée « _sauvegardes »), restaurables depuis le site.
// Après une modification de ce script : Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer.

const FEUILLE_REGLAGES = '_reglages';   // réglages du site (ne pas modifier à la main)
const FEUILLE_PLANNING = 'Planning';
const FEUILLE_DECOMPTE = 'Décompte';
const FEUILLE_SAUVEGARDES = '_sauvegardes'; // versions précédentes des réglages (restaurables depuis le site)
const TAILLE_BLOC = 40000;              // une cellule Google Sheet contient au plus 50 000 caractères
const VERSION_SCRIPT = 2;
const NB_SAUVEGARDES = 60;              // sauvegardes conservées (les plus récentes)
const ECART_SAUVEGARDE = 20 * 60 * 1000; // au plus une sauvegarde automatique toutes les 20 minutes

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
  const r = traiterSansVersion(params, corps);
  r.version = VERSION_SCRIPT;
  return r;
}

function traiterSansVersion(params, corps) {
  try {
    params = params || {};
    if (CODE_SECRET === 'A-CHANGER') return { ok: false, erreur: 'Code secret non défini dans le script (CODE_SECRET)' };
    if (String(params.code || '') !== CODE_SECRET) return { ok: false, erreur: 'Code secret incorrect' };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { ok: false, erreur: 'Script à créer depuis le Google Sheet (Extensions → Apps Script)' };
    if (!corps) { // lecture
      if (params.action === 'sauvegardes') return { ok: true, sauvegardes: listeSauvegardes(ss) };
      if (params.action === 'sauvegarde') {
        const sv = lireSauvegarde(ss, params.id);
        return sv ? { ok: true, reglages: sv } : { ok: false, erreur: 'Sauvegarde introuvable' };
      }
      const lu = lireReglages(ss);
      return { ok: true, reglages: lu.reglages, majLe: lu.majLe };
    }
    if (!corps.reglages || !Array.isArray(corps.reglages.titulaires) || !corps.reglages.titulaires.length) {
      return { ok: false, erreur: 'Réglages vides : envoi refusé' };
    }
    const verrou = LockService.getScriptLock();
    verrou.waitLock(20000);
    try {
      const actuel = lireReglages(ss);
      // Protection : un poste aux réglages vides ou revenus à l'origine n'écrase pas le Sheet
      if (actuel.reglages && !corps.forcer && plusPauvre(compter(actuel.reglages), compter(corps.reglages))) {
        return { ok: false, protege: true, actuel: compter(actuel.reglages), envoye: compter(corps.reglages),
          erreur: 'Envoi bloqué : le Google Sheet contient beaucoup plus de données que ce poste' };
      }
      if (actuel.reglages) sauvegarder(ss, actuel, !!corps.forcer);
      ecrireReglages(ss, corps.reglages, corps.majLe);
      if (corps.planning) ecrireTableau(ss, FEUILLE_PLANNING, corps.planning);
      if (corps.decompte) ecrireTableau(ss, FEUILLE_DECOMPTE, corps.decompte);
      SpreadsheetApp.flush();
    } finally {
      verrou.releaseLock();
    }
    return { ok: true, majLe: corps.majLe };
  } catch (err) {
    return { ok: false, erreur: 'Erreur du script : ' + err.message };
  }
}

// Quantité de données saisies (pour repérer un écrasement par des réglages vides)
function compter(r) {
  r = r || {};
  const ov = Object.values(r.overrides || {}).reduce((n, o) => n + Object.keys(o || {}).length, 0);
  const ind = Object.values(r.indispos || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  return { lib: (r.liberales || []).length, ov: ov, ind: ind, mar: (r.titulaires || []).length };
}
function plusPauvre(a, b) {
  const sa = a.lib + a.ov + a.ind, sb = b.lib + b.ov + b.ind;
  return (a.lib >= 3 && b.lib < a.lib / 2) || (a.ov >= 3 && b.ov < a.ov / 2) || (sa >= 10 && sb < sa * 0.6);
}
function resume(c) {
  return c.mar + ' MAR · ' + c.ind + ' indispo. · ' + c.ov + ' forçages · ' + c.lib + ' libéraux';
}

// Sauvegardes : une ligne par version = [horodatage, majLe, résumé, morceaux du texte…]
function sauvegarder(ss, actuel, forcee) {
  let f = ss.getSheetByName(FEUILLE_SAUVEGARDES);
  if (!f) { f = ss.insertSheet(FEUILLE_SAUVEGARDES); f.hideSheet(); }
  const n = f.getLastRow();
  const texte = JSON.stringify(actuel.reglages);
  if (n) {
    const derniere = f.getRange(n, 1, 1, 2).getValues()[0];
    if (Number(derniere[1]) === Number(actuel.majLe)) return; // déjà sauvegardée
    if (!forcee && Date.now() - Number(derniere[0]) < ECART_SAUVEGARDE) return;
  }
  const ligne = [String(Date.now()), String(actuel.majLe || 0), resume(compter(actuel.reglages))];
  for (let i = 0; i < texte.length; i += TAILLE_BLOC) ligne.push(texte.slice(i, i + TAILLE_BLOC));
  f.getRange(n + 1, 1, 1, ligne.length).setNumberFormat('@').setValues([ligne]);
  if (n + 1 > NB_SAUVEGARDES) f.deleteRows(1, n + 1 - NB_SAUVEGARDES);
}
function listeSauvegardes(ss) {
  const f = ss.getSheetByName(FEUILLE_SAUVEGARDES);
  if (!f || !f.getLastRow()) return [];
  return f.getRange(1, 1, f.getLastRow(), 3).getValues()
    .map(l => ({ id: String(l[0]), quand: Number(l[0]), majLe: Number(l[1]) || 0, resume: String(l[2]) }))
    .reverse();
}
function lireSauvegarde(ss, id) {
  const f = ss.getSheetByName(FEUILLE_SAUVEGARDES);
  if (!f || !f.getLastRow()) return null;
  const n = f.getLastRow(), largeur = Math.max(4, f.getLastColumn());
  const lignes = f.getRange(1, 1, n, largeur).getValues();
  const l = lignes.find(x => String(x[0]) === String(id));
  return l ? JSON.parse(l.slice(3).map(String).join('')) : null;
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
