# Changelog

## 1.2.0
- **Paroles** dans le lecteur agrandi (bouton micro en haut à droite) : synchronisées avec la musique quand Music Assistant les fournit, la ligne en cours s'illumine et un toucher sur une ligne y saute ; sinon paroles simples. (#4)
- **Ajouter à une playlist** : bouton ➕ à côté du cœur pour ajouter le titre en cours à l'une de vos playlists modifiables, et entrée « Ajouter à une playlist » sur chaque titre de la file d'attente. (#1)
- **Vue mini** plus haute et plus complète : boutons Précédent, Lecture / pause, Suivant et **Volume** (le curseur remplace le titre quelques secondes). Options `mini_prev` et `mini_volume`. (#3)
- **Vue mini** : la carte ne déborde plus sur la carte du dessous (hauteur automatique dans les tableaux de bord en sections). (#2)
- Connexion à Music Assistant plus robuste : une connexion coupée est rouverte automatiquement.

## 1.1.0
- **File d'attente complète automatique** avec l'add-on Music Assistant : la carte se connecte à Music Assistant via Home Assistant (ingress), sans adresse ni jeton, en HTTPS et depuis l'extérieur.
- Compatibilité avec les pochettes de Music Assistant 2.10 (`proxy_id`).
- **Pochettes partout** (file d'attente, « À suivre », bibliothèque, fiches) : les images de Music Assistant passent désormais automatiquement par Home Assistant (ingress de l'add-on), même en HTTPS ou depuis l'extérieur.
- Tailles d'images adaptées à ce qu'accepte Music Assistant (80, 160, 256, 512, 1024).
- Nouvelle option `ma_image_url` pour les serveurs Music Assistant hors add-on.
- Icône de remplacement quand un titre n'a pas de pochette (plus d'image cassée).
- Fenêtre du lecteur : le bouton de fermeture ne recouvre plus les commandes.

## 1.0.0
- Première version publique.
- Lecture en cours (pochette ou vinyle, couleurs tirées de la pochette, gestes), file d'attente, bibliothèque avec recherche globale, enceintes et multiroom, vue mini.
- Connexion directe optionnelle à Music Assistant pour la file d'attente complète.
- Éditeur visuel complet.
