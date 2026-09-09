// Vit ici (côté client) et pas dans shared/ car c'est le seul workspace
// équipé de vitest pour l'instant ; `@tq/shared/radioProtocol` se résout
// normalement via les workspaces npm, comme `@tq/shared/protocol` déjà
// utilisé par map/orderFilter.test.ts.
import { describe, expect, it } from 'vitest';
import {
  RADIO_MAX_BYTES,
  RADIO_MAX_NAME_BYTES,
  decodeRadioMessage,
  encodeRadioMessage,
  type RadioMessage,
} from '@tq/shared/radioProtocol';

describe('encodeRadioMessage / decodeRadioMessage', () => {
  it('fait l’aller-retour sur un symbole SIDC', () => {
    const msg: RadioMessage = {
      op: 'set',
      localId: 42,
      lat: 45.1234567,
      lng: 5.7654321,
      name: 'ENI',
      symbol: { kind: 'sidc', sidc: 'SHGPUCI----G' },
    };
    const bytes = encodeRadioMessage(msg);
    expect(bytes.length).toBeLessThan(RADIO_MAX_BYTES);
    expect(decodeRadioMessage(bytes)).toEqual(msg);
  });

  it('fait l’aller-retour sur un point coloré nommé', () => {
    const msg: RadioMessage = {
      op: 'set',
      localId: 7,
      lat: -12.5,
      lng: 100.25,
      name: 'OBJ ALPHA',
      symbol: { kind: 'color', color: '#e8d44d' },
    };
    const bytes = encodeRadioMessage(msg);
    expect(decodeRadioMessage(bytes)).toEqual(msg);
  });

  it('développe une couleur courte (#rgb) en #rrggbb au décodage', () => {
    const bytes = encodeRadioMessage({
      op: 'set', localId: 1, lat: 0, lng: 0, name: '',
      symbol: { kind: 'color', color: '#0f0' },
    });
    const out = decodeRadioMessage(bytes) as { symbol: { color: string } };
    expect(out.symbol.color).toBe('#00ff00');
  });

  it('fait l’aller-retour sur une suppression, sans les champs de position', () => {
    const msg: RadioMessage = { op: 'remove', localId: 123456 };
    const bytes = encodeRadioMessage(msg);
    expect(bytes.length).toBe(6);
    expect(decodeRadioMessage(bytes)).toEqual(msg);
  });

  it('conserve la précision GPS utile (~1 cm) malgré la quantification', () => {
    const msg: RadioMessage = {
      op: 'set', localId: 1, lat: 45.1789012, lng: 5.7123456, name: '',
      symbol: { kind: 'color', color: '#fff' },
    };
    const out = decodeRadioMessage(encodeRadioMessage(msg)) as { lat: number; lng: number };
    expect(out.lat).toBeCloseTo(msg.lat, 6);
    expect(out.lng).toBeCloseTo(msg.lng, 6);
  });

  it('tronque un nom trop long plutôt que de dépasser le budget radio', () => {
    const bytes = encodeRadioMessage({
      op: 'set', localId: 1, lat: 0, lng: 0,
      name: 'un nom vraiment beaucoup trop long pour une trame LoRa',
      symbol: { kind: 'color', color: '#fff' },
    });
    expect(bytes.length).toBeLessThan(RADIO_MAX_BYTES);
    const out = decodeRadioMessage(bytes) as { name: string };
    expect(new TextEncoder().encode(out.name).length).toBeLessThanOrEqual(RADIO_MAX_NAME_BYTES);
  });

  it('ne coupe jamais un nom au milieu d’un caractère multi-octets', () => {
    // Emoji (4 octets UTF-8) répété pour dépasser largement la limite.
    const bytes = encodeRadioMessage({
      op: 'set', localId: 1, lat: 0, lng: 0,
      name: '🚩'.repeat(20),
      symbol: { kind: 'color', color: '#fff' },
    });
    const out = decodeRadioMessage(bytes) as { name: string };
    // Un décodage qui réussit sans lever prouve qu'aucun octet UTF-8 n'a été
    // coupé au milieu (sinon TextDecoder aurait produit un caractère de
    // remplacement U+FFFD ou levé) : chaque drapeau restant est intact.
    expect([...out.name].every((c) => c === '🚩')).toBe(true);
  });

  it('rejette un SIDC trop long pour la radio', () => {
    expect(() =>
      encodeRadioMessage({
        op: 'set', localId: 1, lat: 0, lng: 0, name: '',
        symbol: { kind: 'sidc', sidc: 'S'.repeat(31) },
      }),
    ).toThrow();
  });

  it('rejette une coordonnée hors limite', () => {
    expect(() =>
      encodeRadioMessage({
        op: 'set', localId: 1, lat: 91, lng: 0, name: '',
        symbol: { kind: 'color', color: '#fff' },
      }),
    ).toThrow();
  });

  it('rejette une couleur invalide', () => {
    expect(() =>
      encodeRadioMessage({
        op: 'set', localId: 1, lat: 0, lng: 0, name: '',
        symbol: { kind: 'color', color: 'rgb(0,0,0)' },
      }),
    ).toThrow();
  });

  it('décodage : lève sur une trame trop courte', () => {
    expect(() => decodeRadioMessage(new Uint8Array([1, 0, 0]))).toThrow();
  });

  it('décodage : lève sur une version radio inconnue', () => {
    const bytes = encodeRadioMessage({ op: 'remove', localId: 1 });
    bytes[0] = 99;
    expect(() => decodeRadioMessage(bytes)).toThrow();
  });

  it('décodage : lève sur une trame "set" tronquée avant la fin', () => {
    const bytes = encodeRadioMessage({
      op: 'set', localId: 1, lat: 1, lng: 1, name: 'X',
      symbol: { kind: 'sidc', sidc: 'ABCDEFGHIJ' },
    });
    expect(() => decodeRadioMessage(bytes.subarray(0, bytes.length - 3))).toThrow();
  });
});
