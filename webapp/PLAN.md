# TacQuest → TacMesh : plan d'étapes

Ce document reprend les conclusions de `ANALYSE.md`, recadrées d'après le brief du sujet (`projet.md`), et les transforme en étapes concrètes.

## Ce que le sujet précise, et que ça change au plan précédent

- **Deux volets distincts**, pas un seul : un **client** (TacQuest/TacMesh, ce dépôt) et un **firmware** (module Meshtastic dédié). Mon plan précédent ne couvrait que le client — voir Axe B ci-dessous, entièrement nouveau.
- **La config des canaux Meshtastic est explicitement hors scope** ("la configuration de meshtastic (canaux, paramètres LoRa) se fera par les différents clients disponibles" — l'appli officielle Meshtastic, pas TacQuest). Ça corrige mon étape 3 précédente : TacQuest ne crée/configure pas de canal, il se contente d'utiliser celui déjà réglé sur le boîtier par ailleurs.
- **Le protocole BLE à utiliser est celui défini par Meshtastic**, pas un protocole maison entre TacQuest et le boîtier ("en utilisant le mode d'interaction défini par Meshtastic (cf. client web Meshtastic)"). On implémente un client de leur API, on n'en invente pas une.
- **Nouvelles données à gérer localement** côté client : salons, **clés publiques des autres membres**, messages/chat. Absent de mon plan précédent.
- **CRDT (option)** : le sujet suggère explicitement une approche CRDT (ex. Yjs) pour la cohérence des données en environnement décentralisé/opportuniste — à garder en option, pas un prérequis v1.
- Le mode serveur centralisé (existant) est **optionnel à conserver**, en repli quand un réseau classique est disponible — confirme ce qu'on avait déjà prévu avec la façade transport.
- **Décisions déjà actées avec toi**, toujours valables : identité de membre = node id Meshtastic (unicité + reconnexion réglées d'un coup, plus besoin de `sessionToken`) ; pas de rattrapage d'historique pour les retardataires en v1 ; anti-abus IP et console d'admin laissés tels quels côté serveur, sans équivalent radio.

---

## Axe A — Client (TacQuest/TacMesh)

### A1. Format de message compact — ✅ fait (`shared/src/radioProtocol.ts`)
Le format serveur (`shared/src/protocol.ts`, `OrderMessage` / `Position` en JSON) vise du JSON sans limite de taille, pas ~200 octets par trame radio. `shared/src/protocol.ts` reste inchangé, inutile pour le mode serveur.

**Portée réduite, décidée avec toi** : la radio ne transporte que des *symboles* (un type de figuré + une position) — pas les lignes/box/missions (`OrderPayload` kind `'graphic'`), pas le chat (`kind: 'text'`). Un symbole tient largement sous les ~200 octets (≈80 octets au pire), donc **pas de fragmentation/réassemblage** — la partie la plus lourde du plan initial disparaît.

Implémenté dans `shared/src/radioProtocol.ts` (exporté via `shared/package.json` sous `@tq/shared/radioProtocol`), testé dans `client/src/radioProtocol.test.ts` (13 tests, aller-retour encode/decode + cas d'erreur) :
- Trame `set` (≈15 + taille SIDC/couleur + nom, jamais >200o) : version, opcode, `localId` (uint32, choisi par l'auteur), lat/lng quantifiés en `int32` (×1e7, ~1 cm de précision — même technique que Meshtastic en interne), type de symbole (SIDC *ou* point coloré nommé), nom (tronqué à 32 octets UTF-8 sans jamais couper un caractère).
- Trame `remove` : 6 octets (version, opcode, `localId`).
- **Pas d'`authorId` ni de `ts` dans le payload** : l'auteur vient gratuitement du champ `from` du paquet Meshtastic (fourni par la couche transport, cf. A3/A4) ; l'horodatage n'est utilisé par aucune logique de rendu de symbole (`map/orders.ts` ne compare que position/nom/couleur/sidc).
- **Contrat partagé avec l'Axe B** : le firmware doit reconnaître exactement ce format — à ne plus changer sans coordination une fois B2 commencé.

### A2. Façade "transport" commune — ✅ fait (`client/src/transport.ts`)
Quatre fichiers (un de plus que prévu — repéré en le faisant) importaient des fonctions directement depuis `client/src/socket.ts` : `client/src/soloOrders.ts` (`sendOrder`), `client/src/views/mapView.ts` (`connectForSession`, `leaveRoom`, `pendingOrderCount`, `restorePendingOrders`, `sendPosition`), `client/src/views/roomMenu.ts` (`createRoom`, `joinRoom`, `FIXED_ROLE`), **et `client/src/views/commsPanel.ts`** (`sendOrder`, pour le chat).
- `transport.ts` re-exporte aujourd'hui `socket.ts` tel quel (un seul transport existe encore) — aucun changement de comportement, juste le point de couture posé.
- Les 4 fichiers importent désormais de `transport.ts`, plus aucun d'eux n'importe `socket.ts` directement.
- Réglage pour choisir le transport actif : pas encore fait, à ajouter quand `radio.ts` (A3) existera réellement — inutile tant qu'il n'y a qu'une implémentation à choisir.

Vérifié : `tsc --noEmit`, `vitest run` (52 tests, dont les 13 nouveaux), `vite build` — tous verts.

### A3. Connexion BLE au boîtier, protocole Meshtastic (`client/src/radio.ts`, à créer)
- `navigator.bluetooth` (Web Bluetooth, Chrome/Android) pour se connecter au boîtier.
- Suivre le protocole d'interaction BLE **officiel de Meshtastic** (service GATT, échanges protobuf tels qu'utilisés par leur client web) — ne pas réinventer un protocole de liaison, seulement l'utiliser pour transporter nos trames TacMesh (format A1) en payload applicatif.
- Reprendre le cycle d'état déjà utilisé par `socket.ts` (`connected` / `reconnecting` / `offline`, via `state.ts::setConn`) pour que l'indicateur de connexion (déjà géré par `bus.on('conn', ...)` dans `mapView.ts`) fonctionne sans y toucher.
- Pas de gestion de canal/paramètres LoRa ici : on lit/utilise le canal déjà configuré sur le boîtier (via l'appli Meshtastic officielle), on ne le crée pas.

### A4. Position et ordres via radio
- `sendPosition` / `sendOrder` côté `radio.ts` : `encodeRadioMessage()` (A1) puis écriture BLE vers le boîtier, au lieu de `socket.emit(...)`. Une seule trame par symbole, pas de réassemblage nécessaire.
- À la réception, `decodeRadioMessage()`, reconstruire un `OrderMessage` (id = `packet.from` + `localId`, `authorId` = `packet.from`) et rappeler **exactement** `state.orders.set(o.id, o)` + `bus.emit('orders')` — comme le fait déjà `socket.ts`.
- Résultat : `state.ts`, `map/orders.ts`, `map/orderFilter.ts` ne changent pas.

### A5. Identité = node id Meshtastic
- `state.ts::Session.memberId` (mode radio) = node id Meshtastic, au lieu d'un uuid généré côté client. Unique par construction, stable d'une session à l'autre.
- `callsign` reste une étiquette d'affichage ; alerte locale non bloquante si deux node id différents affichent le même `callsign`.
- Pas de `sessionToken` en mode radio.

### A6. Données locales : salons, membres, clés publiques, messages
Nouveau par rapport à mon plan précédent — le sujet demande explicitement que l'app gère ça localement.
- Étendre le modèle `state.ts` (aujourd'hui `Session`, `MemberPublic`, `Map<string, OrderMessage>`) pour couvrir : la liste des salons connus (actuellement seulement `roomCode` d'une session active + `RoomHistoryEntry` côté `loadRoomHistory()`), les clés publiques des membres croisés, l'historique de chat.
- **À clarifier avant de coder** : Meshtastic gère déjà nativement des clés publiques par nœud (chiffrement des messages directs). Reste à voir si "clés publiques des autres membres" dans le sujet désigne : (a) simplement mémoriser/afficher celles que Meshtastic expose déjà par node id, ou (b) une couche d'identité/signature propre à TacMesh par-dessus. À trancher avec le prof ou par test empirique de ce que l'API BLE Meshtastic expose réellement.
- Persistance locale : réutiliser le pattern déjà en place (`localStorage`, cf. `state.ts::saveSession`/`loadSession`, `soloOrders.ts`) plutôt qu'introduire un nouveau mécanisme de stockage.

### A7. (Optionnel) CRDT pour la cohérence des données
Le sujet le mentionne en option (ex. Yjs). Pertinent parce qu'en mode opportuniste, les messages arrivent dans le désordre, en double, ou partiellement. Le modèle actuel (`state.orders` = `Map` réconciliée "dernier écrit gagne", ordres idempotents par `id`) fonctionne déjà raisonnablement pour des ajouts/suppressions d'ordres. À réévaluer si des conflits concrets apparaissent (ex. deux modifications du même point par deux membres hors ligne l'un de l'autre) plutôt que d'intégrer un CRDT préventivement — c'est un chantier lourd, à ne déclencher qu'une fois d'autres étapes validées.

### A8. Tests
- Tests unitaires sur la fragmentation/réassemblage (A1), dans le style de `client/src/map/orderFilter.test.ts` : pur, sans BLE, testable directement.
- Test manuel avec un boîtier Meshtastic physique une fois A1 à A4 en place.

---

## Axe B — Firmware Meshtastic (module TacMesh)

Absent de mon plan précédent : le sujet demande explicitement un module firmware dédié, pas seulement du code client.

### B1. Prise en main du firmware Meshtastic
- Étudier l'architecture des modules/plugins du firmware Meshtastic (dépôt officiel, en C++, cible ESP32/nRF52 selon le matériel) : comment un module tiers s'enregistre, reçoit des paquets, en émet.
- Identifier le point d'extension le plus adapté pour un module applicatif dédié (les projets Meshtastic exposent typiquement un mécanisme de module/plugin pour ce genre d'usage).

### B2. Reconnaître les messages TacMesh
- Écrire le module TacMesh (extension du firmware) qui reconnaît le format défini en A1 (à partager/synchroniser avec l'Axe A) et le traite spécifiquement, plutôt que de le laisser transiter comme un message texte générique.
- Vérifier le relayage multi-saut : un message TacMesh doit continuer à être relayé par les nœuds intermédiaires du maillage comme les autres paquets Meshtastic.

### B3. Paramètres de configuration du module (si besoin)
- Si le module TacMesh nécessite des réglages propres (ex. fréquence d'envoi, taille max, etc.), les définir au niveau firmware.
- Optionnel : permettre leur configuration depuis TacQuest (ferait passer certains réglages par l'app plutôt que par les clients Meshtastic génériques — à ne faire que si un besoin concret apparaît).

---

## Hors scope

- **Configuration des canaux et paramètres LoRa** : faite par les clients Meshtastic existants (app officielle), pas par TacQuest. *(précisé par le sujet)*
- **Historique pour les retardataires** : pas de rattrapage automatique en v1.
- **Anti-abus par IP** (`server/src/rateLimit.ts`) : reste un mécanisme du mode serveur uniquement.
- **Console d'admin / purge des salles** (`server/src/admin.ts`, `RoomManager.sweep()`) : idem, pas d'équivalent radio prévu pour l'instant.

---

## Rappel : rendus attendus du projet (d'après `projet.md`)

Pas seulement du code — à garder en tête pour le planning global : rapport (conception, etc.), poster A0, soutenance/présentation, livrables (code, Axe A + Axe B).
