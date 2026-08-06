let cacheGeneration = 0;

/** Monotonic epoch bumped whenever couple-scoped local data is cleared. */
export const CoupleCacheEpoch = {
  get() {
    return cacheGeneration;
  },
  bump() {
    cacheGeneration += 1;
    return cacheGeneration;
  },
  isCurrent(generation: number) {
    return generation === cacheGeneration;
  },
};
