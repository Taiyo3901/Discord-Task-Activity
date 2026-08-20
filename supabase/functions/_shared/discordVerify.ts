import nacl from "npm:tweetnacl@1";

function hexToBytes(hex: string): Uint8Array {
  const bytes = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(bytes.map((byte) => parseInt(byte, 16)));
}

export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string): boolean {
  try {
    const message = new TextEncoder().encode(timestamp + rawBody);
    return nacl.sign.detached.verify(message, hexToBytes(signatureHex), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
