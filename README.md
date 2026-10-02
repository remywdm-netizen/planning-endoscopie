# Planning Endoscopie 2026 — GitHub Pages

Application web de planning médical, accessible en ligne via GitHub Pages.

## 🚀 Mise en ligne (sans terminal, 100% navigateur)

1. Sur **github.com** → **+** → New repository → `planning-endoscopie-2026` → **Public** → Create repository
2. **Add file** → **Upload files** → glisser les 3 fichiers : `index.html` · `planning_data.json` · `README.md`
3. Message : `feat: planning endoscopie 2026` → **Commit changes**
4. **Settings** → **Pages** → Source : **main / root** → **Save**
5. Site disponible sur : `https://TON-PSEUDO.github.io/planning-endoscopie-2026/`

## 🔄 Mettre à jour le planning

1. Modifier sur le site → cliquer **Export JSON**
2. Sur GitHub : cliquer `planning_data.json` → ✏️ → Ctrl+A → coller → **Commit changes**

## 📁 Fichiers (2 seulement à uploader)

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète (planning, indispos, médecins, équité) |
| `planning_data.json` | Données du planning (source de vérité) |

## 📅 Période couverte

Juillet 2026 → Décembre 2026

## 👨‍⚕️ Médecins initiaux

RW · LUL · GR · GA — modifiables depuis l'onglet **Médecins** de l'application

## ✨ Fonctionnalités

- Planning mois par mois (juil → déc 2026)
- Modification des créneaux par clic
- Saisie des indisponibilités par calendrier cliquable
- Ajout / suppression de médecins avec couleur personnalisée
- Suivi de l'équité des consultations libérales
- Export JSON pour sauvegarder sur GitHub

## 💉 Planning consultations d'anesthésie (T4 2026)

Page dédiée : `consultations.html` (lien : `https://TON-PSEUDO.github.io/planning-endoscopie-2026/consultations.html`).

| Fichier | Rôle |
|---|---|
| `consultations.html` | Affichage du planning hebdomadaire, décompte, totaux, export CSV |
| `consultations-engine.js` | Moteur de génération : règles, indisponibilités, fériés, overrides (section `DEFAULT_CONFIG`) |
| `tests/consultations.test.js` | Vérification automatique des règles (`node --test tests/*.test.js`) |

Règles encodées : report de bloc (mardi → lundi suivant, jeudi-C1 → mardi suivant), exclusivité RW/SG/GR sur mardi et jeudi-C1, plafond 2/semaine (RW jusqu'à 3 uniquement pour éviter un « Autre MAR »), équilibrage par priorités, fériés monégasques 19/11 et 08/12, overrides de la semaine du 28/09. Onglets de la page :
- **📅 Planning** : planning hebdomadaire, décompte, totaux, export CSV.
- **🚫 Indisponibilités** : choisir un MAR puis cliquer sur les jours (ou saisir une période) ; le planning est recalculé immédiatement.
- **👨‍⚕️ MAR** : modifier les initiales, la couleur et le plafond hebdomadaire des 3 MAR titulaires. Un changement d'initiales est reporté sur les indisponibilités et la semaine de référence.

Les modifications sont enregistrées dans le navigateur (localStorage). Pour les partager : **Exporter la configuration (JSON)** puis **Importer** sur l'autre poste. Les valeurs d'origine sont dans `DEFAULT_CONFIG` (`consultations-engine.js`).
