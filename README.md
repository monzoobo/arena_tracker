# Arena Tracker Skin Guess Server

Serveur WebSocket public pour les rooms ephemeres Skin Guess.

## Deploy Render

1. Cree un repo GitHub avec uniquement ce dossier.
2. Sur Render, cree un `Web Service`.
3. Connecte ce repo.
4. Configuration manuelle si tu n'utilises pas `render.yaml` :
   - Root Directory : vide si ce repo ne contient que ces fichiers
   - Runtime : Node
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Environment variable : `HOST=0.0.0.0`

Render fournit automatiquement `PORT`.

## URL a mettre dans Arena Tracker

Si Render donne :

```text
https://arena-tracker-skin-guess.onrender.com
```

Alors dans Arena Tracker, utilise :

```text
wss://arena-tracker-skin-guess.onrender.com
```

## Test HTTP

Ouvre :

```text
https://arena-tracker-skin-guess.onrender.com/test
```

La page doit afficher `HTTP: OK` et `WebSocket: OK`.

## Local

```powershell
npm install
npm start
```

Par defaut en local, le serveur ecoute sur `127.0.0.1`.
Pour l'exposer sur le reseau local :

```powershell
$env:HOST="0.0.0.0"
npm start
```
