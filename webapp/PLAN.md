# TacQuest → TacMesh : plan d'étapes

Ce document reprend les conclusions de `ANALYSE.md` et les transforme en étapes concrètes, dans l'ordre où les faire. Rien n'est codé pour l'instant, c'est la feuille de route.

Décisions déjà prises :
- **Salle = canal Meshtastic.** Pas de code de salle généré et vérifié par un serveur (`server/src/rooms.ts::generateCode()`) : le "code" en mode radio, c'est le nom du canal réglé sur le boîtier.
- **Identité = node id Meshtastic.** Chaque boîtier a un identifiant matériel unique et stable (`!a1b2c3d4`, par ex.). On l'utilise comme identité du membre, ce qui règle d'un coup deux problèmes distincts :
  - *Unicité des indicatifs* : le `callsign` reste une simple étiquette d'affichage, sans arbitre pour la valider. Une alerte locale (non bloquante) signale juste si deux node id différents affichent le même `callsign`.
  - *`sessionToken` / reconnexion* : plus besoin d'un secret délivré par un serveur pour "prouver qui on est" — le node id est déjà la preuve, il vient du matériel. Se reconnecter, c'est juste recapter le canal avec le même node id.
- **Historique pour les retardataires : pas géré en v1.** Un arrivant tardif démarre avec une carte vide et se met à jour au fil de l'eau. Rattraper l'historique coûterait trop cher en ~200 octets/trame. On regardera plus tard si besoin — et de toute façon un futur remplacement du transport LoRa par un protocole opportuniste (mentionné par l'utilisateur, à préciser plus tard) rendra cette question différente : c'est justement pour pouvoir changer de transport facilement que l'étape 2 (façade commune) est prioritaire.
- **Anti-abus par IP et console d'admin : hors scope.** Restent des fonctionnalités du mode serveur uniquement (`server/src/rateLimit.ts`, `server/src/admin.ts`) ; pas d'équivalent radio pour l'instant.

Point d'attention transverse : le futur protocole de communication sera **opportuniste** (les messages transitent quand des nœuds se croisent, pas de garantie de livraison immédiate ni de connexion permanente). Pas d'action spécifique aujourd'hui, mais ça renforce l'intérêt de tout ce qui suit : ne jamais supposer qu'un message part et arrive tout de suite, garder la couche transport interchangeable, et ne pas construire de mécanique qui suppose un lien toujours actif.

---

## Étape 1 — Format de message compact (`shared/`)

Le format actuel (`shared/src/protocol.ts`, `OrderMessage` / `Position` en JSON) est prévu pour du JSON sans limite de taille, pas pour ~200 octets par trame radio.

- Concevoir un format binaire compact dédié au transport radio (nouveau fichier, ex. `shared/src/radioProtocol.ts`) : id court, type, coordonnées quantifiées (entiers plutôt que `float64` JSON).
- Prévoir la **fragmentation** des ordres `graphic` (une ligne à plusieurs points dépasse vite 200 octets) : découpage en plusieurs trames numérotées (id de fragment, index/total) et réassemblage à la réception.
- `shared/src/protocol.ts` reste inchangé pour le mode serveur — les deux formats coexistent, la façade (étape 2) fait la conversion vers le même `OrderMessage` en interne des deux côtés.

## Étape 2 — Façade "transport" commune (`client/src/transport.ts`, à créer)

Aujourd'hui, trois fichiers importent des fonctions directement depuis `client/src/socket.ts` : `client/src/soloOrders.ts` (`sendOrder`), `client/src/views/mapView.ts` (`connectForSession`, `leaveRoom`, `pendingOrderCount`, `restorePendingOrders`, `sendPosition`), `client/src/views/roomMenu.ts` (`createRoom`, `joinRoom`, `FIXED_ROLE`).

- Créer `transport.ts`, qui expose **exactement les mêmes noms de fonctions**, et redirige en interne vers l'implémentation active (serveur ou radio).
- Rebrancher les imports de ces 3 fichiers vers `transport.ts` — leur logique ne change pas.
- Ajouter un réglage (dans `roomMenu.ts` ou un nouvel écran) pour choisir le transport actif.

Priorité haute : c'est le point de couture qui permettra, plus tard, de remplacer ou d'ajouter un transport (Meshtastic, protocole opportuniste, autre) sans toucher au reste du client.

## Étape 3 — Salle = canal Meshtastic

- `createRoom` (mode radio) : configurer/sélectionner le canal actif sur le boîtier via Bluetooth. Pas de génération de code, pas de vérification d'unicité côté logiciel.
- `joinRoom` (mode radio) : se brancher sur ce canal. Plus de `ROOM_NOT_FOUND` possible — on est sur le canal ou pas.
- Pas de `MAX_ROOMS` ni de compteur de salles côté client en mode radio : ça n'a plus de sens sans registre central.

## Étape 4 — Connexion Bluetooth au boîtier (`client/src/radio.ts`, à créer)

- `navigator.bluetooth` pour se connecter au boîtier Meshtastic (service GATT Meshtastic).
- Reprendre le même cycle d'état que `socket.ts` (`connected` / `reconnecting` / `offline`, via `state.ts::setConn`) pour que l'indicateur de connexion à l'écran (déjà géré par `bus.on('conn', ...)` dans `mapView.ts`) fonctionne sans y toucher.

## Étape 5 — Position et ordres via radio

- `sendPosition` / `sendOrder` côté `radio.ts` : écriture Bluetooth vers le boîtier (format compact de l'étape 1, fragmenté si besoin) au lieu de `socket.emit(...)`.
- À la réception (le boîtier remonte par Bluetooth ce qu'il capte en LoRa), réassembler les fragments et rappeler **exactement** `state.orders.set(o.id, o)` + `bus.emit('orders')` — comme le fait déjà `socket.ts` aujourd'hui.
- Résultat : `state.ts`, `map/orders.ts`, `map/orderFilter.ts` ne changent pas — ils ne voient jamais la différence entre "ça vient du serveur" et "ça vient de la radio".

## Étape 6 — Identité = node id Meshtastic

- `state.ts::Session.memberId` (mode radio) = node id Meshtastic, au lieu d'un uuid généré côté client. Unique par construction, stable d'une session à l'autre.
- `callsign` reste une étiquette d'affichage ; alerte locale non bloquante si deux node id différents affichent le même `callsign`.
- Pas de `sessionToken` en mode radio : le node id suffit, la reconnexion consiste juste à recapter le canal.

## Étape 7 — Tests

- Tests unitaires sur la fragmentation/réassemblage (nouveau fichier, dans le style de `client/src/map/orderFilter.test.ts` : pur, sans Bluetooth, testable directement).
- Test manuel avec deux boîtiers Meshtastic physiques une fois les étapes 1 à 5 en place.

---

## Hors scope pour l'instant

- **Historique pour les retardataires** : pas de rattrapage automatique en v1. À revoir plus tard, probablement différemment une fois le transport opportuniste en place.
- **Anti-abus par IP** (`server/src/rateLimit.ts`) : reste un mécanisme du mode serveur uniquement.
- **Console d'admin / purge des salles** (`server/src/admin.ts`, `RoomManager.sweep()`) : idem, pas d'équivalent radio prévu pour l'instant.
