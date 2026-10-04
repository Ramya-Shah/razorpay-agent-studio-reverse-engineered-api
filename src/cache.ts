import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface Entry {
  storedAt: number;
  body: string;
}

export class DiskCache {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string): string {
    return path.join(this.dir, createHash("sha256").update(key).digest("hex") + ".json");
  }

  async get(key: string, ttlMs: number): Promise<string | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), "utf8")) as Entry;
      if (this.now() - entry.storedAt <= ttlMs) return entry.body;
    } catch {
      // missing or unreadable entry counts as a miss
    }
    return undefined;
  }

  async set(key: string, body: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: Entry = { storedAt: this.now(), body };
    await writeFile(this.file(key), JSON.stringify(entry), "utf8");
  }
}
