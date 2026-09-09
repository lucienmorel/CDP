// Format compact du transport radio (Meshtastic), cf. PLAN.md — Axe A1.
//
// Portée volontairement réduite : TacMesh v1 ne transmet en radio que des
// « symboles » (un type de figuré + une position), jamais les lignes/box/
// missions (`OrderPayload` kind `'graphic'`) ni le chat (`kind: 'text'`).
// Un seul symbole tient largement sous les ~200 octets d'une trame LoRa
// (~80 octets au pire, cf. tests) : PAS de fragmentation/réassemblage ici.
//
// Deux économies volontaires par rapport à `shared/src/protocol.ts` (le
// format « serveur », inchangé, toujours utilisé par `server/src/handlers.ts`) :
//  - pas d'`authorId` dans le payload : le paquet Meshtastic porte déjà
//    l'identifiant du nœud émetteur (champ `from`), fourni gratuitement par
//    la couche transport. C'est à `radio.ts` (Axe A3/A4, pas encore écrit) de
//    recombiner `packet.from` + `localId` pour reconstruire un
//    `OrderMessage.id`/`.authorId` compatibles avec `state.ts`.
//  - pas de `ts` : la fraîcheur d'un symbole ne sert à aucune logique côté
//    carte (`map/orders.ts` ne compare que position/nom/couleur/sidc) ; s'il
//    en faut un pour l'affichage, `radio.ts` peut utiliser l'heure de
//    réception locale ou celle que le firmware Meshtastic expose déjà.

export const RADIO_VERSION = 1;
/** Budget réel d'une trame LoRa Meshtastic — cf. ANALYSE.md. */
export const RADIO_MAX_BYTES = 200;
/** Nom tronqué au-delà (UTF-8) : large marge sous le budget, cf. tests. */
export const RADIO_MAX_NAME_BYTES = 32;
/** Même borne que `SIDC_REGEX` (`shared/src/constants.ts`). */
export const RADIO_MAX_SIDC_LEN = 30;

const OP_SET = 0;
const OP_REMOVE = 1;
const SYMBOL_SIDC = 0;
const SYMBOL_COLOR = 1;

export interface RadioSetSymbol {
  op: 'set';
  /** Id choisi par l'auteur (pas un uuid : combiné au node id Meshtastic de
   *  l'expéditeur par la couche transport pour former un id global). */
  localId: number;
  lat: number;
  lng: number;
  name: string;
  symbol:
    | { kind: 'sidc'; sidc: string }
    | { kind: 'color'; color: string /* '#rgb' ou '#rrggbb' */ };
}

export interface RadioRemoveSymbol {
  op: 'remove';
  localId: number;
}

export type RadioMessage = RadioSetSymbol | RadioRemoveSymbol;

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Tronque `s` pour que son encodage UTF-8 tienne dans `maxBytes`, sans
 *  jamais couper un codepoint au milieu. */
function truncateUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  let out = s;
  while (enc.encode(out).length > maxBytes) out = out.slice(0, -1);
  return out;
}

function encodeDeg(deg: number, maxAbs: number): number {
  if (!Number.isFinite(deg) || Math.abs(deg) > maxAbs) {
    throw new Error(`Coordonnée radio hors limite : ${deg}`);
  }
  return Math.round(deg * 1e7);
}

function decodeDeg(raw: number): number {
  return raw / 1e7;
}

function encodeColor(color: string): Uint8Array {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m) throw new Error(`Couleur invalide pour l'encodage radio : ${color}`);
  const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  return new Uint8Array([
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]);
}

function decodeColor(bytes: Uint8Array, offset: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(bytes[offset]!)}${hex(bytes[offset + 1]!)}${hex(bytes[offset + 2]!)}`;
}

/** Encode un symbole en trame radio compacte. Lève si les données ne
 *  tiennent pas dans le format (coordonnée hors limite, SIDC trop long,
 *  couleur invalide) — au caller de valider avant, comme pour tout envoi. */
export function encodeRadioMessage(msg: RadioMessage): Uint8Array {
  if (msg.op === 'remove') {
    const buf = new Uint8Array(6);
    const view = new DataView(buf.buffer);
    view.setUint8(0, RADIO_VERSION);
    view.setUint8(1, OP_REMOVE);
    view.setUint32(2, msg.localId, true);
    return buf;
  }

  const name = truncateUtf8(msg.name, RADIO_MAX_NAME_BYTES);
  const nameBytes = new TextEncoder().encode(name);

  let symbolKind: number;
  let symbolBytes: Uint8Array;
  if (msg.symbol.kind === 'sidc') {
    const { sidc } = msg.symbol;
    if (sidc.length > RADIO_MAX_SIDC_LEN) {
      throw new Error(`SIDC trop long pour la radio (${sidc.length} > ${RADIO_MAX_SIDC_LEN})`);
    }
    symbolKind = SYMBOL_SIDC;
    const sidcBytes = new TextEncoder().encode(sidc);
    symbolBytes = concatBytes([new Uint8Array([sidcBytes.length]), sidcBytes]);
  } else {
    symbolKind = SYMBOL_COLOR;
    symbolBytes = encodeColor(msg.symbol.color);
  }

  const head = new Uint8Array(15); // version,op,localId(4),lat(4),lng(4),symbolKind
  const headView = new DataView(head.buffer);
  headView.setUint8(0, RADIO_VERSION);
  headView.setUint8(1, OP_SET);
  headView.setUint32(2, msg.localId, true);
  headView.setInt32(6, encodeDeg(msg.lat, 90), true);
  headView.setInt32(10, encodeDeg(msg.lng, 180), true);
  headView.setUint8(14, symbolKind);

  const out = concatBytes([head, symbolBytes, new Uint8Array([nameBytes.length]), nameBytes]);
  if (out.length > RADIO_MAX_BYTES) {
    // Ne devrait jamais arriver vu les bornes ci-dessus — filet de sécurité.
    throw new Error(`Message radio trop long (${out.length} > ${RADIO_MAX_BYTES} octets)`);
  }
  return out;
}

/** Décode une trame radio reçue. Lève sur toute trame malformée/tronquée —
 *  au caller (`radio.ts`) d'attraper et de jeter silencieusement le paquet,
 *  comme pour toute donnée reçue d'un lien non fiable. */
export function decodeRadioMessage(bytes: Uint8Array): RadioMessage {
  if (bytes.length < 6) throw new Error('Trame radio trop courte');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== RADIO_VERSION) throw new Error(`Version radio inconnue : ${version}`);
  const op = view.getUint8(1);
  const localId = view.getUint32(2, true);

  if (op === OP_REMOVE) return { op: 'remove', localId };
  if (op !== OP_SET) throw new Error(`Opcode radio inconnu : ${op}`);
  if (bytes.length < 16) throw new Error('Trame radio "set" tronquée');

  const lat = decodeDeg(view.getInt32(6, true));
  const lng = decodeDeg(view.getInt32(10, true));
  const symbolKind = view.getUint8(14);

  let offset = 15;
  let symbol: RadioSetSymbol['symbol'];
  if (symbolKind === SYMBOL_SIDC) {
    const len = bytes[offset]!;
    offset += 1;
    if (offset + len > bytes.length) throw new Error('SIDC tronqué');
    symbol = { kind: 'sidc', sidc: new TextDecoder().decode(bytes.subarray(offset, offset + len)) };
    offset += len;
  } else if (symbolKind === SYMBOL_COLOR) {
    if (offset + 3 > bytes.length) throw new Error('Couleur tronquée');
    symbol = { kind: 'color', color: decodeColor(bytes, offset) };
    offset += 3;
  } else {
    throw new Error(`Type de symbole radio inconnu : ${symbolKind}`);
  }

  if (offset >= bytes.length) throw new Error('Longueur du nom manquante');
  const nameLen = bytes[offset]!;
  offset += 1;
  if (offset + nameLen > bytes.length) throw new Error('Nom tronqué');
  const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLen));

  return { op: 'set', localId, lat, lng, name, symbol };
}
