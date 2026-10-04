# Planning consultations d'anesthésie — T4 2026

Le site s'ouvre directement sur le planning, protégé par le code d'accès **C2026** (simple barrière côté navigateur : le site restant public, ne pas y mettre de données sensibles).

Adresse : `https://remywdm-netizen.github.io/planning-endoscopie/`

| Fichier | Rôle |
|---|---|
| `index.html` | Page du site : affichage du planning hebdomadaire, décompte, totaux, export CSV |
| `consultations-engine.js` | Moteur de génération : règles, indisponibilités, fériés, overrides (section `DEFAULT_CONFIG`) |
| `lib/xlsx.full.min.js` | Lecteur Excel (SheetJS 0.18.5, licence Apache-2.0), embarqué pour fonctionner sans CDN |
| `excel-export.js` | Remplissage du modèle Excel du service (onglet Planning Excel) |
| `lib/exceljs.min.js` | ExcelJS 4.4.0 (licence MIT), chargé à la demande pour écrire l'Excel en gardant la mise en forme |
| `tests/consultations.test.js` | Vérification automatique des règles (`node --test tests/*.test.js`) |

Règles encodées : report de bloc (mardi → lundi suivant, jeudi-C1 → mardi suivant), exclusivité RW/SG/GR sur mardi et jeudi-C1, plafond 2/semaine (RW jusqu'à 3 uniquement pour éviter un « Autre MAR »), équilibrage par priorités (GR : au moins 30 % des consultations libérales), fériés monégasques 19/11 et 08/12, overrides de la semaine du 28/09.

Onglets de la page :
- **📅 Planning** : planning hebdomadaire, décompte, totaux, export CSV. **Cliquer sur une case** pour forcer un praticien (titulaire, « Autre MAR » ou praticien externe comme AFR) ou revenir au calcul automatique. Un créneau forcé est conservé même hors règles (une alerte l'indique) et les autres créneaux sont recalculés autour.
- **🚫 Indisponibilités** : choisir un MAR puis cliquer sur les jours (ou saisir une période) ; le planning est recalculé immédiatement.
- **📥 Consult. libérales** : charger un fichier Excel avec, pour chaque patient, la **date de consultation** et la **date de bloc opératoire** (voir `modele_consultations_liberales.xlsx`). Le MAR de la consultation libérale du jour (mardi, jeudi-C1, lundi-C1 ou mercredi) opère le patient : il doit être disponible à la date de bloc et n'a pas de consultation ce jour-là. Chaque patient est contrôlé (✅ / ⚠️) et signalé 🩺 dans le planning. Les colonnes d'identité patient ne sont pas enregistrées.
- **📊 Planning Excel** : charger le modèle Excel du service (ex. « Planning semaine 41.xlsx »), cocher les semaines, puis **Générer** : un classeur avec une feuille par semaine (n° ISO), au format exact du modèle (mise en forme, formules, annuaire conservés). Sont remplis : Consultations d'anesthésie → ENDOSCOPIES, bloc ENDOSCOPIES du matin (report du mardi / jeudi-C1 et patients libéraux), ABSENTS (indisponibilités des MAR), dates, n° de semaine, jours fériés. Le modèle reste dans le navigateur : il n'est jamais publié.
- **👨‍⚕️ MAR** : ajouter ou retirer un MAR titulaire (2 à 6), modifier ses initiales, sa couleur, son plafond hebdomadaire et sa **part minimale des consultations libérales** (mardi + jeudi-C1 ; GR : au moins 30 % par défaut, arrondi au créneau supérieur — 30 % de 25 → 8 ; les autres se partagent le reste à égalité ; alerte si le minimum est impossible). Un MAR ajouté entre aussitôt dans la rotation et l'équilibrage du décompte. Un changement d'initiales est reporté sur les indisponibilités et les créneaux forcés.

Les modifications sont enregistrées dans le navigateur (localStorage). Pour les partager : **Exporter la configuration (JSON)** puis **Importer** sur l'autre poste. Les valeurs d'origine sont dans `DEFAULT_CONFIG` (`consultations-engine.js`).
