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

Règles encodées : report de bloc (mardi → lundi suivant, jeudi-C1 → mardi suivant), exclusivité RW/SG/GR sur mardi et jeudi-C1, plafond 2/semaine (RW jusqu'à 3 uniquement pour éviter un « Autre MAR »), équilibrage par priorités, fériés monégasques 19/11 et 08/12, overrides de la semaine du 28/09. Pour modifier une indisponibilité, éditer `DEFAULT_CONFIG.indispos` dans `consultations-engine.js`.
