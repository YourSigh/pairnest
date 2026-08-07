import { randomBytes } from "crypto";

import {
  createServerBoundBytes,
  hashOpaqueToken,
  tokenHashMatches,
} from "./auth";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 26;
export const PAIRING_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizePairingCode(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function formatPairingCode(raw: string) {
  const normalized = normalizePairingCode(raw);
  if (normalized.length !== PAIRING_CODE_LENGTH) return normalized;
  return [
    normalized.slice(0, 5),
    normalized.slice(5, 10),
    normalized.slice(10, 15),
    normalized.slice(15, 20),
    normalized.slice(20),
  ].join("-");
}

export function generatePairingCode() {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let raw = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    raw += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(raw);
}

export function createServerBoundPairingCode(
  domain: string,
  ...parts: string[]
) {
  const bytes = createServerBoundBytes(domain, ...parts);
  let raw = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    raw += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(raw);
}

export function hashPairingCode(code: string) {
  const normalized = normalizePairingCode(code);
  if (normalized.length !== PAIRING_CODE_LENGTH) return "";
  return hashOpaqueToken(normalized);
}

export function pairingCodeMatches(code: string, storedHash: string | null) {
  if (!storedHash) return false;
  const normalized = normalizePairingCode(code);
  if (normalized.length !== PAIRING_CODE_LENGTH) return false;
  return tokenHashMatches(normalized, storedHash);
}

export function pairingCodeExpiresAt(now = Date.now()) {
  return new Date(now + PAIRING_CODE_TTL_MS);
}
