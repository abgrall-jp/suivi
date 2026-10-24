#!/bin/bash
# Suivi sur le port 3300, branché sur les émulateurs (projet de Mémoriser) ; Mémoriser réel sur 3100, faux Texte à trous sur 3201.
cd /home/user/tests-suivi
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
for p in $(pgrep -f "fausse-porte.mjs"); do kill $p; done
for p in $(pgrep -f "suivi/dist/server.cjs"); do kill $p; done
sleep 1
setsid nohup node fausse-porte.mjs > porte.log 2>&1 < /dev/null &
cd /home/user/suivi
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=gen-lang-client-0301284188 FIRESTORE_DATABASE_ID=suivi-eu USE_FIREBASE_EMULATORS=1 PORT=3300 ADMIN_EMAILS=admin@ecole.fr \
  SUIVI_CLE_MEMORISER=cle-de-test SUIVI_URL_MEMORISER=http://127.0.0.1:3100 SUIVI_CLE_TEXTETROUS=cle-tat SUIVI_URL_TEXTETROUS=http://127.0.0.1:3201 \
  setsid nohup node /home/user/suivi/dist/server.cjs > /home/user/tests-suivi/server.log 2>&1 < /dev/null &
sleep 3
