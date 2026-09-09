// Façade transport (Axe A2, cf. PLAN.md). Point de couture unique entre le
// reste du client et le(s) transport(s) réseau : aujourd'hui uniquement
// socket.ts (Socket.IO / serveur central), demain aussi radio.ts (BLE →
// boîtier Meshtastic, Axe A3/A4). Les appelants (soloOrders.ts,
// views/mapView.ts, views/roomMenu.ts, views/commsPanel.ts) importent
// exclusivement d'ici, jamais de socket.ts directement — pour que l'ajout du
// transport radio ne touche qu'à ce fichier, pas à eux.
//
// Tant qu'un seul transport existe, cette façade se contente de relayer
// socket.ts telle quelle : aucun changement de comportement aujourd'hui.
// Le jour où radio.ts existe, chaque fonction choisira ici quelle
// implémentation appeler (réglage utilisateur, ou détection d'un boîtier
// appairé) au lieu de renvoyer systématiquement vers socket.ts.

export {
  FIXED_ROLE,
  createRoom,
  joinRoom,
  connectForSession,
  sendPosition,
  sendOrder,
  pendingOrderCount,
  restorePendingOrders,
  leaveRoom,
} from './socket';
export type { RoomState } from './socket';
