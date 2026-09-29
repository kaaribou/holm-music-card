# Changelog

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
