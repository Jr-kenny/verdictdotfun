import type { Address } from "viem";

const LOCAL_PROFILE_STORAGE_PREFIX = "verdict-arena.local-profile";

function getStorageKey(address: Address) {
  return `${LOCAL_PROFILE_STORAGE_PREFIX}.${address.toLowerCase()}`;
}

export async function fetchStoredLocalProfileName(address: Address | null | undefined) {
  if (!address || typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(getStorageKey(address))?.trim() ?? "";
  return stored || null;
}

export function getLocalProfileQueryKey(address: Address | null | undefined) {
  return ["local-profile", address ?? "guest"] as const;
}

export function storeLocalProfileName(address: Address, name: string) {
  if (typeof window === "undefined") {
    return;
  }

  const trimmedName = name.trim();

  if (!trimmedName) {
    window.localStorage.removeItem(getStorageKey(address));
    return;
  }

  window.localStorage.setItem(getStorageKey(address), trimmedName);
}
