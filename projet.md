# Overview / contexte du projet

**Problème** : outil de SITAC centralisé (DeltaSuite, TacQuest). Ne fonctionnent pas sans accès internet/serveur.  

**Objectif du projet** : permettre une exécution décentralisée et off-grid d'un outil de SITAC.

## TacQuest

projet développé en interne ESM1 (EO Aumont).  
_décrire ici_

## Meshtastic

Projet open-source : microgiciel (firmware) implémentant un **protocole de communication** permettant d'établir un **réseau maillé** sur la technologie radio **LoRa**.  
Le projet Meshtastic inclus égalemement des applications clientes (chat, cartographie et SITAC via ATAK) web, mobile et python.

D'autres solutions concurrentes existent mais sont moins matures que Meshtastic (ex: MeshCore ou encore le projet RECSANet).

## TacMesh / fonctionnalités

L'idée est donc de modifier le code de TacQuest pour que l'application (web progressive) puisse:

* se connecter à un module radio Meshtastic
* partager des objets carto sur le réseau meshtastic.
* (optionnel) garder un mode de fonctionnement centralisé quand un réseau (cellulaire/WiFi) est disponible

Il faudra pour cela:

* au niveau de TacQuest
    * que l'application gère les données localement (salons, clés publiques des autres membres, messages/chat, etc.)
    * (optionnel) assurer la cohérence de ces données avec une approche CRDT (ex: yjs)
    * que l'application gère la connexion BLE et la transmission des infos (messages textes/objets carto) au module radio, selon un protocole/format de message spécifié
        * cf. stack bluetooth du navigateur (Chrome)
        * en utilisant le mode d'interaction défini par Meshtastic (cf. client web Meshtastic)
    * (hors-scope) la configuration de meshtastic (canaux, paramètres LoRa) se fera par les différents clients disponibles
* au niveau du firmware Meshtastic
    * prendre en compte les messages spécifiques TacQuest
    * écrire pour cela un module (extension du firmware) TacMesh
    * si le module doit être configuré, créer les paramètres de config correspondant et éventuellement permettre leur configuration depuis TacQuest

# Rendus / attendus du projet

* rapport (conception etc)
* poster A0
* soutenance/présentation
* livrables (code)
