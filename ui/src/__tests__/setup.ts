/**
 * Vitest global setup.
 *
 * Node 25 injects --localstorage-file which provides a global `localStorage`
 * that is missing `.clear()` and cannot be spied on via vi.spyOn. This setup
 * replaces window.localStorage with a full in-memory implementation before
 * any test module runs, so all storage tests get a predictable, full API.
 */

class InMemoryStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

// Replace the Node 25 / jsdom localStorage with our reliable in-memory implementation.
Object.defineProperty(window, "localStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});
