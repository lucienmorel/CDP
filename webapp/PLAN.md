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

### A1. Format de message compact + fragmentation (`shared/`)
Le format actuel (`shared/src/protocol.ts`, `OrderMessage` / `Position` en JSON) vise du JSON sans limite de taille, pas ~200 octets par trame radio.
- Concevoir un format binaire compact (nouveau fichier, ex. `shared/src/radioProtocol.ts`) : id court, type, coordonnées quantifiées.
- Prévoir la fragmentation des ordres `graphic` (une ligne à plusieurs points dépasse vite 200 octets) : trames numérotées (id de fragment, index/total), réassemblées à la réception.
- `shared/src/protocol.ts` reste inchangé pour le mode serveur.
- **Ce format est le contrat partagé avec l'Axe B** (le firmware doit reconnaître exactement ces mêmes trames) — à figer et documenter avant d'avancer sur B2.

### A2. Façade "transport" commune (`client/src/transport.ts`, à créer)
Trois fichiers importent aujourd'hui des fonctions directement depuis `client/src/socket.ts` : `client/src/soloOrders.ts` (`sendOrder`), `client/src/views/mapView.ts` (`connectForSession`, `leaveRoom`, `pendingOrderCount`, `restorePendingOrders`, `sendPosition`), `client/src/views/roomMenu.ts` (`createRoom`, `joinRoom`, `FIXED_ROLE`).
- Créer `transport.ts`, mêmes noms de fonctions exposés, redirection interne vers l'implémentation active (serveur ou radio).
- Rebrancher les imports de ces 3 fichiers vers `transport.ts` — leur logique ne change pas.
- Réglage pour choisir le transport actif (dans `roomMenu.ts` ou un nouvel écran).

### A3. Connexion BLE au boîtier, protocole Meshtastic (`client/src/radio.ts`, à créer)
- `navigator.bluetooth` (Web Bluetooth, Chrome/Android) pour se connecter au boîtier.
- Suivre le protocole d'interaction BLE **officiel de Meshtastic** (service GATT, échanges protobuf tels qu'utilisés par leur client web) — ne pas réinventer un protocole de liaison, seulement l'utiliser pour transporter nos trames TacMesh (format A1) en payload applicatif.
- Reprendre le cycle d'état déjà utilisé par `socket.ts` (`connected` / `reconnecting` / `offline`, via `state.ts::setConn`) pour que l'indicateur de connexion (déjà géré par `bus.on('conn', ...)` dans `mapView.ts`) fonctionne sans y toucher.
- Pas de gestion de canal/paramètres LoRa ici : on lit/utilise le canal déjà configuré sur le boîtier (via l'appli Meshtastic officielle), on ne le crée pas.

### A4. Position et ordres via radio
- `sendPosition` / `sendOrder` côté `radio.ts` : écriture BLE vers le boîtier (format A1) au lieu de `socket.emit(...)`.
- À la réception, réassembler les fragments et rappeler **exactement** `state.orders.set(o.id, o)` + `bus.emit('orders')` — comme le fait déjà `socket.ts`.
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
