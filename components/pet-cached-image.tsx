import { Image, type ImageProps } from "expo-image";
import { useEffect, useState } from "react";

import { PetAssetCache } from "@/services/PetAssetCache";

type PetCachedImageProps = Omit<ImageProps, "source"> & {
  file: string;
};

/** 按需下载到本地缓存；已有缓存则直接用本地 uri */
export function PetCachedImage({ file, ...props }: PetCachedImageProps) {
  const [uri, setUri] = useState(
    () => PetAssetCache.trySource(file)?.uri ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    const cached = PetAssetCache.trySource(file);
    setUri(cached?.uri ?? null);
    void PetAssetCache.resolve(file).then((next) => {
      if (!cancelled) setUri(next);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const requestedCachePolicy = props.cachePolicy;
  const cachePolicy = uri?.startsWith("file://")
    ? "none"
    : requestedCachePolicy === "memory-disk" || requestedCachePolicy === "memory"
      ? "disk"
      : (requestedCachePolicy ?? "disk");

  return (
    <Image
      {...props}
      source={uri ? { uri } : null}
      cachePolicy={cachePolicy}
    />
  );
}
