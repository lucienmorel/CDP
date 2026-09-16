# TacQuest → TacMesh : plan d'étapes

Ce document reprend les conclusions de `ANALYSE.md`, recadrées d'après le brief du sujet (`projet.md`), puis par le mail du prof du 16/10 (répartition du travail, premiers objectifs).

## Mail du prof (16/10) : compatible, avec quelques ajouts

Réponse courte : oui, largement compatible avec ce qui a déjà été fait.

- **I.b (fournir une abstraction de la couche transport, orientant vers `socket.ts` ou un module mesh)** : c'est exactement A2, déjà fait (`client/src/transport.ts`). Seule différence : le prof nomme le futur module radio `mesh.ts`, pas `radio.ts` comme je l'avais prévu — renommé ci-dessous (A4). Aucun impact sur A2 : c'est justement le but d'une façade que ce renommage ne touche qu'un seul fichier pas encore écrit.
- **I.a (format des tracés, compatible LoRa ou à condenser ?)** : déjà analysé (`ANALYSE.md`, et A1 ci-dessous) — conclusion : le format JSON actuel (`geojson.coordinates`) n'est pas compatible tel quel avec un débit LoRa dès qu'un tracé a plusieurs points. C'est cette analyse qui a justifié la décision, prise avec toi, de ne *pas* transporter les tracés en v1 plutôt que d'implémenter une fragmentation — cohérent avec la question du prof, pas contradictoire avec sa demande de continuer l'analyse.
- **I.c (identifiants de salle/callsign mappés sur les node id)** : confirme la décision déjà prise (A6 ci-dessous : identité = node id) — généralisée par le prof aux autres réseaux mesh possibles (RECSANet). Aucun changement d'architecture, juste une note ajoutée.
- **Nouveau, ajouté au plan** : I.d (menu de config du nœud radio → intégré à A4), I.e (persistance IndexedDB → nouvelle étape A3), II (analyse de `meshtastic/web` → nouvel Axe C, qui doit précéder l'écriture de `mesh.ts`).
- **Pas encore fait par nous, un des "premiers objectifs" du mail** : faire tourner TacQuest et observer le réseau/la console du navigateur. Je peux le faire à la demande (le dépôt tourne, `npm install` fonctionne, testé pour lancer les tests) — dis-moi si tu veux que je m'en charge ou si quelqu'un d'autre de l'équipe le prend.

---

## Ce que le sujet (`projet.md`) précise, en plus d'`ANALYSE.md`

- **Deux volets distincts**, pas un seul : un **client** (TacQuest/TacMesh, ce dépôt) et un **firmware** (module Meshtastic dédié) — voir Axe B.
- **La config d'un canal Meshtastic (créer, PSK, nom) est hors scope** — faite par les clients Meshtastic existants, pas par TacQuest. *(nuancée par le mail du 16/10, voir A4 et Hors scope)*
- **Le protocole BLE à utiliser est celui défini par Meshtastic** ("en utilisant le mode d'interaction défini par Meshtastic (cf. client web Meshtastic)") — on implémente un client de leur API, on n'en invente pas une. *(le mail du 16/10 formalise ça en Axe C : étudier `meshtastic/web` avant d'écrire notre propre client)*
- **Nouvelles données à gérer localement** côté client : salons, **clés publiques des autres membres**, messages/chat (A7).
- **CRDT (option)** : approche suggérée (ex. Yjs) pour la cohérence des données en environnement décentralisé/opportuniste — à garder en option, pas un prérequis v1 (A8).
- Le mode serveur centralisé (existant) est **optionnel à conserver**, en repli quand un réseau classique est disponible.
- **Décisions déjà actées avec toi**, toujours valables : identité de membre = node id Meshtastic (unicité + reconnexion réglées d'un coup, plus besoin de `sessionToken`) ; pas de rattrapage d'historique pour les retardataires en v1 ; anti-abus IP et console d'admin laissés tels quels côté serveur, sans équivalent mesh.

---

## Axe A — Client (TacQuest/TacMesh)

### A1. Format de message compact — ✅ fait (`shared/src/radioProtocol.ts`)
Le format serveur (`shared/src/protocol.ts`, `OrderMessage` / `Position` en JSON) vise du JSON sans limite de taille, pas ~200 octets par trame radio. `shared/src/protocol.ts` reste inchangé, inutile pour le mode serveur.

**Portée réduite, décidée avec toi** : la radio ne transporte que des *symboles* (un type de figuré + une position) — pas les lignes/box/missions (`OrderPayload` kind `'graphic'`), pas le chat (`kind: 'text'`). Un symbole tient largement sous les ~200 octets (≈80 octets au pire), donc **pas de fragmentation/réassemblage** — la partie la plus lourde du plan initial disparaît. C'est directement la réponse à la question I.a du prof (tracés non condensés pour l'instant → non transportés en v1).

Implémenté dans `shared/src/radioProtocol.ts` (exporté via `shared/package.json` sous `@tq/shared/radioProtocol`), testé dans `client/src/radioProtocol.test.ts` (13 tests, aller-retour encode/decode + cas d'erreur) :
- Trame `set` (≈15 + taille SIDC/couleur + nom, jamais >200o) : version, opcode, `localId` (uint32, choisi par l'auteur), lat/lng quantifiés en `int32` (×1e7, ~1 cm de précision — même technique que Meshtastic en interne), type de symbole (SIDC *ou* point coloré nommé), nom (tronqué à 32 octets UTF-8 sans jamais couper un caractère).
- Trame `remove` : 6 octets (version, opcode, `localId`).
- **Pas d'`authorId` ni de `ts` dans le payload** : l'auteur vient gratuitement du champ `from` du paquet Meshtastic (fourni par la couche transport, cf. A4/A5) ; l'horodatage n'est utilisé par aucune logique de rendu de symbole (`map/orders.ts` ne compare que position/nom/couleur/sidc).
- **Contrat partagé avec l'Axe B** : le firmware doit reconnaître exactement ce format — à ne plus changer sans coordination une fois B2 commencé.

### A2. Façade "transport" commune — ✅ fait (`client/src/transport.ts`)
Quatre fichiers (un de plus que prévu — repéré en le faisant) importaient des fonctions directement depuis `client/src/socket.ts` : `client/src/soloOrders.ts` (`sendOrder`), `client/src/views/mapView.ts` (`connectForSession`, `leaveRoom`, `pendingOrderCount`, `restorePendingOrders`, `sendPosition`), `client/src/views/roomMenu.ts` (`createRoom`, `joinRoom`, `FIXED_ROLE`), **et `client/src/views/commsPanel.ts`** (`sendOrder`, pour le chat).
- `transport.ts` re-exporte aujourd'hui `socket.ts` tel quel (un seul transport existe encore) — aucun changement de comportement, juste le point de couture posé.
- Les 4 fichiers importent désormais de `transport.ts`, plus aucun d'eux n'importe `socket.ts` directement.
- Réglage pour choisir le transport actif : pas encore fait, à ajouter quand `mesh.ts` (A4) existera réellement — inutile tant qu'il n'y a qu'une implémentation à choisir.

Vérifié : `tsc --noEmit`, `vitest run` (52 tests, dont les 13 nouveaux), `vite build` — tous verts.

### A3. Persistance locale : `localStorage` → IndexedDB
Nouveau (mail du 16/10, I.e), classé parmi les "premiers objectifs" — donc prioritaire, et indépendant du reste (ne dépend d'aucune autre étape, peut être fait dès maintenant, en parallèle du reste).

Aujourd'hui, le stockage local du client passe par `localStorage`, éparpillé en plusieurs endroits :
- `state.ts` : session (`SESSION_KEY`), dernière salle (`LAST_ROOM_KEY`), indicatif (`CALLSIGN_KEY`), historique des salles (`ROOM_HISTORY_KEY`)
- `soloOrders.ts` : figurés de la carte solo (`SOLO_ORDERS_KEY`)
- `socket.ts` : file d'ordres en attente hors-ligne (`OUTBOX_KEY`)

Pourquoi migrer : le serveur stocke aujourd'hui rooms/membres/objets carto dans des fichiers JSON (`server/src/persistence.ts`), et chaque client devrait avoir un réplicat local complet des données de sa salle — pas juste quelques clés éparses. `localStorage` est limité (~5 Mo, API synchrone bloquante, pas de requêtes/index) : inadapté à ce volume. IndexedDB (asynchrone, capacité bien plus grande, indexable) est l'outil adapté.

- Remplacer les clés `localStorage` ci-dessus par des object stores IndexedDB (une petite lib type `idb` simplifie l'API, sinon l'API native suffit).
- Garder la même interface publique (`saveSession`/`loadSession`, `loadSoloOrders`, etc.) — seules les implémentations internes de `state.ts`/`soloOrders.ts`/`socket.ts` changent, pas leurs appelants (même bénéfice de façade qu'A2).
- Prévoir dès maintenant le schéma pour ce qu'ajoute A7 (salons, clés publiques, messages) plutôt que migrer deux fois.
- **Point d'attention** : `loadSession()`/`loadSoloOrders()` etc. sont aujourd'hui **synchrones** (lues au boot de l'app). IndexedDB est asynchrone — ça change la séquence de démarrage (`main.ts`/`mapView.ts` doivent attendre la lecture avant de rendre l'état initial). À vérifier à l'implémentation, probable petit effet de bord sur l'écran de démarrage.

### A4. Connexion au réseau maillé + config du nœud (`client/src/mesh.ts`, à créer)
*Renommé `radio.ts` → `mesh.ts`, pour matcher le vocabulaire du mail du 16/10. Pur renommage : `transport.ts` (A2) isole déjà ce nom du reste du code, rien d'autre à toucher.*

**À écrire seulement après l'Axe C** (étudier `meshtastic/web` avant d'écrire ce module — le sujet et le mail insistent tous les deux : ne pas réinventer leur protocole).

- `navigator.bluetooth` (Web Bluetooth, Chrome/Android) pour se connecter au boîtier, selon les mêmes mécanismes GATT/protobuf que `meshtastic/web` (Axe C1).
- Reprendre le cycle d'état déjà utilisé par `socket.ts` (`connected`/`reconnecting`/`offline`, via `state.ts::setConn`) pour que l'indicateur de connexion existant fonctionne sans y toucher.
- **Nouveau (mail du 16/10, I.d) : menu de config minimale du nœud radio**, dans une nouvelle vue (ou intégré à `roomMenu.ts`) :
  - choix du device / appariement Bluetooth — le cœur de cette étape, pas optionnel ;
  - éventuellement choix du réseau maillé (Meshtastic / RECSANet / MeshCore…) — voir note ci-dessous ;
  - optionnellement choix du canal physique/preset LoRa (`MEDIUM_FAST`, `SHORT_FAST`, `LONG_SLOW`…) — explicitement "optionnellement" dans le mail, priorité basse.
- **Nuance sur le "hors scope" précédent** : créer/configurer un canal (PSK, nom) reste fait par l'appli Meshtastic officielle. Mais *choisir* un device, et plus tard un preset LoRa déjà existant, *depuis TacQuest*, est maintenant explicitement demandé — mis à jour dans la section Hors scope plus bas.
- **`mesh.ts` comme interface générique, pas seulement Meshtastic** : le mail (I.b, I.d) envisage un module capable d'orienter vers plusieurs réseaux maillés (Meshtastic aujourd'hui, RECSANet/MeshCore plus tard). Pour l'instant on implémente seulement le backend Meshtastic ; on garde `mesh.ts` comme le nom/point d'entrée de cette façade pour ne pas avoir à la renommer si un second backend arrive un jour.
- Pas de gestion de canal/paramètres LoRa avancée ici (au-delà du preset optionnel ci-dessus) : on lit/utilise le canal déjà configuré sur le boîtier.

### A5. Position et ordres via le réseau maillé
- `sendPosition` / `sendOrder` côté `mesh.ts` : `encodeRadioMessage()` (A1) puis écriture BLE vers le boîtier, au lieu de `socket.emit(...)`. Une seule trame par symbole, pas de réassemblage nécessaire.
- À la réception, `decodeRadioMessage()`, reconstruire un `OrderMessage` (id = `packet.from` + `localId`, `authorId` = `packet.from`) et rappeler **exactement** `state.orders.set(o.id, o)` + `bus.emit('orders')` — comme le fait déjà `socket.ts`.
- Résultat : `state.ts`, `map/orders.ts`, `map/orderFilter.ts` ne changent pas.

### A6. Identité = node id (Meshtastic, ou équivalent selon le backend)
- `state.ts::Session.memberId` (mode mesh) = node id du réseau actif, au lieu d'un uuid généré côté client. Unique par construction, stable d'une session à l'autre.
- `callsign` reste une étiquette d'affichage ; alerte locale non bloquante si deux node id différents affichent le même `callsign`.
- Pas de `sessionToken` en mode mesh.
- *(mail du 16/10, I.c : généralise ce principe à un éventuel nodeId RECSANet — même mécanique, seule la source de l'id change selon le backend `mesh.ts` actif.)*

### A7. Données locales : salons, membres, clés publiques, messages
Le sujet demande explicitement que l'app gère ça localement, en IndexedDB (cf. A3, pas `localStorage` comme envisagé au départ).
- Étendre le modèle `state.ts` (aujourd'hui `Session`, `MemberPublic`, `Map<string, OrderMessage>`) pour couvrir : la liste des salons connus (actuellement seulement `roomCode` d'une session active + `RoomHistoryEntry` côté `loadRoomHistory()`), les clés publiques des membres croisés, l'historique de chat.
- **À clarifier avant de coder** : Meshtastic gère déjà nativement des clés publiques par nœud (chiffrement des messages directs). Reste à voir si "clés publiques des autres membres" désigne : (a) simplement mémoriser/afficher celles que Meshtastic expose déjà par node id, ou (b) une couche d'identité/signature propre à TacMesh par-dessus. À trancher avec le prof ou par test empirique de ce que l'API BLE Meshtastic expose réellement (utile de vérifier pendant l'Axe C).

### A8. (Optionnel) CRDT pour la cohérence des données
Le sujet le mentionne en option (ex. Yjs). Pertinent parce qu'en mode opportuniste, les messages arrivent dans le désordre, en double, ou partiellement. Le modèle actuel (`state.orders` = `Map` réconciliée "dernier écrit gagne", ordres idempotents par `id`) fonctionne déjà raisonnablement pour des ajouts/suppressions d'ordres. À réévaluer si des conflits concrets apparaissent plutôt que d'intégrer un CRDT préventivement — chantier lourd, à ne déclencher qu'une fois d'autres étapes validées.

### A9. Tests
- Tests unitaires (déjà en place pour A1, cf. `client/src/radioProtocol.test.ts`) à étendre au fil des étapes : `mesh.ts` (A4/A5), la couche IndexedDB (A3), dans le même esprit — pur/testable sans matériel quand c'est possible.
- Test manuel avec un boîtier Meshtastic physique une fois A1, A4, A5 en place.

---

## Axe C — Recherche : l'application web Meshtastic officielle

Nouveau (mail du 16/10, partie II). Pas du code TacMesh : de la lecture de code chez Meshtastic, pour ne pas réinventer leur protocole avant d'écrire `mesh.ts` (A4).

```
git clone https://github.com/meshtastic/web.git
```

À documenter (nouveau fichier suggéré, ex. `ANALYSE_MESHTASTIC.md`, même esprit qu'`ANALYSE.md`) :
- **C1. Liaison BLE** : comment l'appli web gère la connexion Bluetooth (service/caractéristiques GATT utilisés, séquence de connexion/appairage).
- **C2. Messages texte** : comment un message texte est envoyé (forgé côté appli ? quel encodage/protobuf ?) et comment il est remonté à la réception.
- **C3. Positions** : comment une position GPS est envoyée/remontée — référence directe pour `sendPosition`/la réception de position dans `mesh.ts` (A5).
- **C4. Canaux** : le paquet est-il forgé côté appli web (elle choisit/inclut le canal), ou le canal est-il un réglage du firmware/device que l'appli ne fait que sélectionner ? Conditionne directement comment `mesh.ts` doit s'y prendre pour émettre "sur le bon canal".

**Gate A4** : ne pas commencer à écrire `mesh.ts` avant d'avoir au moins C1 et C4 (connexion + canaux) — les deux points qui déterminent la structure même du module.

---

## Axe B — Firmware Meshtastic (module TacMesh)

Le sujet demande explicitement un module firmware dédié, pas seulement du code client.

### B1. Prise en main du firmware Meshtastic
- Étudier l'architecture des modules/plugins du firmware Meshtastic (dépôt officiel, en C++, cible ESP32/nRF52 selon le matériel) : comment un module tiers s'enregistre, reçoit des paquets, en émet.
- Identifier le point d'extension le plus adapté pour un module applicatif dédié.

### B2. Reconnaître les messages TacMesh
- Écrire le module TacMesh (extension du firmware) qui reconnaît le format défini en A1 (contrat partagé avec l'Axe A) et le traite spécifiquement, plutôt que de le laisser transiter comme un message texte générique.
- Vérifier le relayage multi-saut : un message TacMesh doit continuer à être relayé par les nœuds intermédiaires du maillage comme les autres paquets Meshtastic.

### B3. Paramètres de configuration du module (si besoin)
- Si le module TacMesh nécessite des réglages propres, les définir au niveau firmware.
- Optionnel : permettre leur configuration depuis TacQuest (le menu A4 pourrait s'étendre pour ça — à ne faire que si un besoin concret apparaît).

---

## Hors scope

- **Créer/configurer un canal Meshtastic (PSK, nom)** : toujours fait par l'appli Meshtastic officielle, pas par TacQuest. *(le mail du 16/10 nuance : choisir un device et, en option basse priorité, un preset LoRa déjà existant, ça reste dans notre scope — cf. A4)*
- **Historique pour les retardataires** : pas de rattrapage automatique en v1.
- **Anti-abus par IP** (`server/src/rateLimit.ts`) : reste un mécanisme du mode serveur uniquement.
- **Console d'admin / purge des salles** (`server/src/admin.ts`, `RoomManager.sweep()`) : idem, pas d'équivalent mesh prévu pour l'instant.

---

## Rappel : rendus attendus du projet (d'après `projet.md`)

Pas seulement du code — à garder en tête pour le planning global : rapport (conception, etc. — l'analyse d'`ANALYSE_MESHTASTIC.md`, Axe C, y a sa place), poster A0, soutenance/présentation, livrables (code, Axe A + Axe B).
