/**
 * UI tree cache — avoids redundant uiautomator dumps.
 *
 * The UI dump is expensive (~500-1000ms per call). Caching the result
 * for a short TTL avoids repeated dumps when multiple tools need the
 * tree in quick succession (e.g., android_look followed by android_tap).
 *
 * Cache is invalidated automatically on any input action (tap, swipe, type, key).
 */

import type { UITreeResult } from "./types.js";

interface CacheEntry {
  tree: UITreeResult;
  timestamp: number;
}

const DEFAULT_TTL_MS = 2000; // 2 seconds — UI is likely unchanged

let cache: CacheEntry | null = null;
let ttlMs = DEFAULT_TTL_MS;

/**
 * Set the cache TTL in milliseconds (default: 2000).
 */
export function setCacheTtl(ms: number): void {
  ttlMs = ms;
}

/**
 * Get a cached UI tree if still valid, or null.
 */
export function getCachedTree(): UITreeResult | null {
  if (!cache) return null;
  if (Date.now() - cache.timestamp > ttlMs) {
    cache = null;
    return null;
  }
  return cache.tree;
}

/**
 * Store a UI tree in the cache.
 */
export function setCachedTree(tree: UITreeResult): void {
  cache = { tree, timestamp: Date.now() };
}

/**
 * Invalidate the cache (call after any input action).
 */
export function invalidateCache(): void {
  cache = null;
}

/**
 * Check if cache has a valid entry.
 */
export function isCacheValid(): boolean {
  return getCachedTree() !== null;
}
