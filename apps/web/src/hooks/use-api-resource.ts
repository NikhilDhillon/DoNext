"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiRequest, ApiRequestError } from "@/lib/api";

export function useApiResource<T>(path: string | null) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    if (!path) {
      setData(null);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      setData(await apiRequest<T>(path));
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 401) {
        router.replace("/login");
        return;
      }
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "The local API is unavailable. Start it and try again.",
      );
    } finally {
      setLoadedPath(path);
      setRefreshing(false);
    }
  }, [path, router]);

  useEffect(() => {
    if (!path) return;
    let ignore = false;
    apiRequest<T>(path)
      .then((response) => {
        if (ignore) return;
        setData(response);
        setError(null);
        setLoadedPath(path);
      })
      .catch((requestError: unknown) => {
        if (ignore) return;
        if (requestError instanceof ApiRequestError && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof ApiRequestError
            ? requestError.message
            : "The local API is unavailable. Start it and try again.",
        );
        setLoadedPath(path);
      });
    return () => {
      ignore = true;
    };
  }, [path, router]);

  const loading = refreshing || (Boolean(path) && loadedPath !== path && !error);
  return { data, setData, error, loading, reload };
}
