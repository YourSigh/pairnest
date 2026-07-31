import { Asset } from "expo-asset";

import { bundledAssetModule } from "@/constants/pet-assets";

export type PetImageSource = { uri: string };

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function bundledUri(filename: string): string {
  const asset = Asset.fromModule(bundledAssetModule(filename));
  return asset.localUri ?? asset.uri;
}

async function resolveOne(filename: string): Promise<string> {
  const cached = memory.get(filename);
  if (cached) return cached;

  const existing = inflight.get(filename);
  if (existing) return existing;

  const promise = Asset.fromModule(bundledAssetModule(filename))
    .downloadAsync()
    .then((asset) => {
      const uri = asset.localUri ?? asset.uri;
      memory.set(filename, uri);
      return uri;
    })
    .finally(() => {
      if (inflight.get(filename) === promise) inflight.delete(filename);
    });

  inflight.set(filename, promise);
  return promise;
}

export const PetAssetCache = {
  remoteUrl: bundledUri,

  resolve(filename: string): Promise<string> {
    return resolveOne(filename);
  },

  async preload(filenames: readonly string[]): Promise<void> {
    await Promise.all([...new Set(filenames)].map((filename) => resolveOne(filename)));
  },

  ensure(filenames: readonly string[]): void {
    for (const filename of new Set(filenames)) {
      void resolveOne(filename);
    }
  },

  source(filename: string): PetImageSource {
    return { uri: memory.get(filename) ?? bundledUri(filename) };
  },

  trySource(filename: string): PetImageSource | null {
    const uri = memory.get(filename);
    return uri ? { uri } : null;
  },
};
