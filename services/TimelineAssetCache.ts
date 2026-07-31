import { Asset } from "expo-asset";

import {
  bundledAssetModule,
  type TimelineBackgroundFile,
} from "@/constants/pet-assets";

const memory = new Map<TimelineBackgroundFile, string>();
const inflight = new Map<TimelineBackgroundFile, Promise<string>>();

function bundledUri(filename: TimelineBackgroundFile): string {
  const asset = Asset.fromModule(bundledAssetModule(filename));
  return asset.localUri ?? asset.uri;
}

async function resolveOne(filename: TimelineBackgroundFile): Promise<string> {
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

export const TimelineAssetCache = {
  remoteUrl: bundledUri,

  resolve(filename: TimelineBackgroundFile): Promise<string> {
    return resolveOne(filename);
  },

  ensure(filenames: readonly TimelineBackgroundFile[]): void {
    for (const filename of new Set(filenames)) {
      void resolveOne(filename);
    }
  },

  trySource(filename: TimelineBackgroundFile): { uri: string } | null {
    const uri = memory.get(filename);
    return uri ? { uri } : null;
  },
};
