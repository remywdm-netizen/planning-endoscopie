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
