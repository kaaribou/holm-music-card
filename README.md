# 🎵 HOLM Music Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/)
![Version](https://img.shields.io/github/v/release/kaaribou/holm-music-card)
![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.1%2B-03a9f4)
![Music Assistant](https://img.shields.io/badge/Music%20Assistant-2.x-8a2be2)

**Un lecteur Music Assistant moderne pour Home Assistant : la pochette en grand, les couleurs qui suivent la musique, votre bibliothèque et toutes vos enceintes dans une seule carte.**

HOLM Music Card exploite **toutes les possibilités de [Music Assistant](https://music-assistant.io/)** : lecture en cours, file d'attente, bibliothèque complète avec recherche sur tous vos services, radios, podcasts, multiroom… Le fond et la couleur d'accent sont **tirés de la pochette**, les gestes sont naturels (glisser pour changer de titre, double-toucher pour ajouter aux favoris), et une **vue mini** permet de l'intégrer dans une barre ou un coin de tableau de bord.

> ✨ **Zéro YAML.** On ajoute la carte depuis le sélecteur de cartes, on choisit son lecteur, et **tous les réglages se font dans l'éditeur visuel**.

### En bref

- 🎨 **Lecture en cours** : pochette carrée ou **vinyle qui tourne**, fond flouté et couleur d'accent **extraits de la pochette**, titres longs qui défilent, barre de progression interactive, aléatoire, répétition, favori, volume.
- 🎤 **Paroles** dans le lecteur agrandi, **synchronisées** avec la musique quand Music Assistant les fournit (la ligne chantée s'illumine, un toucher sur une ligne y saute).
- ➕ **Ajouter à une playlist** le titre en cours (ou un titre de la file d'attente), en choisissant parmi vos playlists modifiables.
- 👆 **Gestes** : glisser sur la pochette = titre suivant / précédent, double-toucher = favori ♥.
- 📜 **File d'attente** : titre en cours et suivants, lecture d'un titre, déplacement, « lire ensuite », suppression, vider la file, **enregistrer comme playlist**.
- 📚 **Bibliothèque** : accueil (écoutés récemment, favoris, ajouts récents), playlists, albums, artistes, titres, radios, podcasts, livres audio ; tris, filtre favoris, fiches album / artiste / playlist.
- 🔎 **Recherche globale**, dans votre bibliothèque **et** sur vos services de streaming.
- ▶️ **Lire maintenant, ensuite, ajouter à la file, remplacer**, ou lancer un **mode radio** (titres similaires).
- 🔊 **Enceintes** : changer de lecteur, **transférer la lecture** d'une pièce à l'autre, **regrouper** (multiroom), volume par enceinte.
- 🪟 **Vue mini** : une barre compacte avec précédent, lecture / pause, suivant et **volume** (le curseur apparaît d'un toucher) ; un toucher sur le titre ouvre le lecteur complet en fenêtre.
- 🧭 Utilisée par **[HOLM Navbar Card](https://github.com/kaaribou/holm-navbar-card)** pour le mini lecteur, la note de musique et les lecteurs en cours.

| Lecture en cours | File d'attente | Bibliothèque | Enceintes |
|---|---|---|---|
| ![Lecture](docs/images/lecture.png) | ![File d'attente](docs/images/file.png) | ![Bibliothèque](docs/images/bibliotheque.png) | ![Enceintes](docs/images/enceintes.png) |

**Vue mini**

![Vue mini](docs/images/mini.png)

---

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [File d'attente complète (connexion directe)](#file-dattente-complète-connexion-directe)
- [Pochettes](#pochettes)
- [Utilisation avec HOLM Navbar Card](#utilisation-avec-holm-navbar-card)
- [Exemples YAML](#exemples-yaml)
- [FAQ / dépannage](#faq--dépannage)

---

## Prérequis

> [!IMPORTANT]
> Cette carte est un lecteur **pour Music Assistant uniquement**. Il faut :
> - un serveur **[Music Assistant](https://music-assistant.io/) 2.x** (module complémentaire ou conteneur) ;
> - l'intégration **Music Assistant** installée dans Home Assistant (Paramètres → Appareils et services) ;
> - **Home Assistant 2025.1** ou plus récent.
>
> Les lecteurs proposés sont les entités `media_player` créées par l'intégration Music Assistant.

---

## Installation

### Avec HACS (recommandé)

1. HACS → menu ⋮ → **Dépôts personnalisés**.
2. Ajoutez `https://github.com/kaaribou/holm-music-card`, catégorie **Tableau de bord** (*Dashboard / Plugin*).
3. Recherchez **HOLM Music Card** → **Télécharger**.
4. Rechargez la page (Ctrl + F5).

### Manuellement

1. Copiez `dist/holm-music-card.js` dans `config/www/community/holm-music-card/`.
2. **Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter** : `/local/community/holm-music-card/holm-music-card.js`, type **Module JavaScript**.
3. Rechargez la page.

---

## Configuration

Ajoutez la carte **HOLM Musique** depuis le sélecteur de cartes, choisissez votre lecteur : c'est prêt. Tout le reste se règle dans l'éditeur.

| Option | Description | Par défaut |
|---|---|---|
| `entity` | Lecteur Music Assistant (**obligatoire**) | — |
| `mode` | `full` (complet) ou `mini` (barre compacte) | `full` |
| `artwork` | `square` (pochette) ou `vinyl` (vinyle qui tourne) | `square` |
| `start_tab` | Onglet à l'ouverture : `now`, `queue`, `library`, `speakers` | `now` |
| `dynamic_color` | Couleurs tirées de la pochette | `true` |
| `accent` | Couleur d'accent (si couleurs dynamiques désactivées ou sans pochette) | `#26c6da` |
| `height` | Hauteur de la carte complète (px) | `640` |
| `mini_prev` | Vue mini : bouton Précédent | `true` |
| `mini_volume` | Vue mini : réglage du volume | `true` |
| `library_types` | Rubriques de la bibliothèque : `home`, `playlist`, `album`, `artist`, `track`, `radio`, `podcast`, `audiobook` | `home, playlist, album, artist, track, radio` |
| `show_players` | Onglet **Enceintes** | `true` |
| `players` | Lecteurs proposés (vide = tous ceux de Music Assistant) | tous |
| `ma_url` / `ma_token` | Serveur Music Assistant séparé uniquement (inutile avec l'add-on) | — |
| `ma_image_url` | Adresse HTTPS des images, si Music Assistant n'est pas l'add-on (voir [Pochettes](#pochettes)) | — |

---

## File d'attente complète (connexion directe)

- **Avec l'add-on Music Assistant** (Home Assistant OS / Supervised) : **rien à faire**. La carte se connecte automatiquement à Music Assistant **via Home Assistant** : file complète (déplacer, lire ensuite, supprimer, vider, enregistrer comme playlist), en HTTPS comme depuis l'extérieur.
- **Serveur Music Assistant séparé** (Docker, autre machine) : renseignez dans **Serveur Music Assistant séparé** l'adresse du serveur (`http://192.168.1.10:8095`) et un **jeton d'accès** créé dans Music Assistant. Sans cela, la file montre le titre en cours et le suivant.

> 🔒 Le jeton est stocké dans la configuration du tableau de bord : ne le renseignez que sur un dashboard réservé à votre foyer. Une adresse `http://` ne fonctionne pas si Home Assistant est ouvert en HTTPS.

---

## Pochettes

Music Assistant fournit les pochettes depuis son propre serveur (par exemple `http://192.168.1.10:8095/imageproxy/…`). Un navigateur ne peut pas les afficher quand Home Assistant est ouvert en **HTTPS** ou **depuis l'extérieur**.

- **Avec l'add-on Music Assistant** (Home Assistant OS / Supervised) : rien à faire, la carte fait passer automatiquement les images par Home Assistant (ingress de l'add-on).
- **Serveur Music Assistant séparé** (Docker, autre machine) : renseignez dans **Pochettes (avancé)** l'adresse HTTPS de votre serveur Music Assistant joignable par le navigateur (`ma_image_url`).

---

## Utilisation avec HOLM Navbar Card

**[HOLM Navbar Card](https://github.com/kaaribou/holm-navbar-card)** utilise ce lecteur pour :

- le **mini lecteur** au-dessus de la barre de navigation ;
- la **note de musique** animée sur un onglet quand un lecteur joue ;
- le panneau **« En cours de lecture »** à l'appui long (un mini lecteur par enceinte).

👉 Si vous utilisez ces fonctions de la barre, **HOLM Music Card doit être installée**.

![Lecteurs en cours dans la barre](docs/images/navbar-lecteurs.png)

---

## Exemples YAML

```yaml
# Lecteur complet
type: custom:holm-music-card
entity: media_player.salon
artwork: vinyl
height: 680
```

```yaml
# Vue mini
type: custom:holm-music-card
entity: media_player.salon
mode: mini
```

```yaml
# Bibliothèque sur mesure, lecteurs limités
type: custom:holm-music-card
entity: media_player.salon
start_tab: library
library_types: [home, playlist, album, radio, podcast]
players: [media_player.salon, media_player.cuisine, media_player.bureau]
```

---

## FAQ / dépannage

| Problème | Solution |
|---|---|
| Aucun lecteur proposé dans l'éditeur | L'intégration **Music Assistant** doit être installée dans Home Assistant ; seuls ses lecteurs sont proposés. |
| La file ne montre que 2 titres | Avec l'add-on : rechargez la page. Serveur séparé : renseignez l'adresse et le jeton Music Assistant. |
| La bibliothèque est vide | Vérifiez que Music Assistant a bien synchronisé vos services (dans l'interface de Music Assistant). |
| Le favori ne fonctionne pas | Le titre doit venir d'un service qui accepte les favoris ; avec la connexion directe, l'ajout passe par Music Assistant. |
| Pas de pochettes (carrés vides) | Avec l'add-on : rechargez la page. Sans l'add-on : renseignez `ma_image_url` (voir [Pochettes](#pochettes)). |
| La nouvelle version ne s'affiche pas | Videz le cache (Ctrl + F5, ou « Recharger les ressources » dans l'application mobile). |

---

## Un petit merci ?

Le lecteur vous plaît ? Vous pouvez m'offrir une bière 🍺

[![Offrez-moi une bière](https://img.shields.io/badge/Offrez--moi_une_bi%C3%A8re-PayPal-0070ba?logo=paypal&logoColor=white)](https://paypal.me/kaaribou)

---

## Licence

Code sous licence **MIT** — © kaaribou. Voir le [CHANGELOG](CHANGELOG.md).
Music Assistant est un projet indépendant ([music-assistant.io](https://music-assistant.io/)).

Fait partie de la collection **HOLM** : [HOLM Navbar Card](https://github.com/kaaribou/holm-navbar-card) · [HOLM Sentinel Card](https://github.com/kaaribou/holm-sentinel-card) · [Carburant HOLM](https://github.com/kaaribou/carburant-holm).
