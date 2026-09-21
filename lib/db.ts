import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { Memory, MemoryLink } from "@/types";

interface JevBenchmarkDB extends DBSchema {
  memories: {
    key: string;
    value: Memory;
    indexes: {
      "by-status": MemoryStatus;
      "by-type": string;
      "by-sourceChunk": number;
    };
  };
  memory_links: {
    key: string;
    value: MemoryLink;
    indexes: {
      "by-from": string;
      "by-to": string;
    };
  };
}

import type { MemoryStatus } from "@/types";

const DB_NAME = "jev-benchmark";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<JevBenchmarkDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<JevBenchmarkDB>> {
  if (!dbPromise) {
    dbPromise = openDB<JevBenchmarkDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // memories store
        const memStore = db.createObjectStore("memories", { keyPath: "id" });
        memStore.createIndex("by-status", "status");
        memStore.createIndex("by-type", "type");
        memStore.createIndex("by-sourceChunk", "sourceChunkId");

        // memory_links store
        const linkStore = db.createObjectStore("memory_links", { keyPath: "id" });
        linkStore.createIndex("by-from", "fromId");
        linkStore.createIndex("by-to", "toId");
      },
    });
  }
  return dbPromise;
}

// ─── Memory CRUD ─────────────────────────────────────────────────────────────

export async function getAllMemories(): Promise<Memory[]> {
  const db = await getDb();
  return db.getAll("memories");
}

export async function getActiveMemories(): Promise<Memory[]> {
  const db = await getDb();
  return db.getAllFromIndex("memories", "by-status", "active");
}

export async function getMemoryById(id: string): Promise<Memory | undefined> {
  const db = await getDb();
  return db.get("memories", id);
}

export async function upsertMemory(memory: Memory): Promise<void> {
  const db = await getDb();
  await db.put("memories", memory);
}

export async function supersede(
  oldId: string,
  newMemory: Memory
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("memories", "readwrite");
  const old = await tx.store.get(oldId);
  if (old) {
    old.status = "superseded";
    old.supersededBy = newMemory.id;
    await tx.store.put(old);
  }
  await tx.store.put(newMemory);
  await tx.done;
}

export async function appendMemory(memory: Memory): Promise<void> {
  const db = await getDb();
  await db.put("memories", memory);
}

// ─── Memory Links CRUD ───────────────────────────────────────────────────────

export async function getAllLinks(): Promise<MemoryLink[]> {
  const db = await getDb();
  return db.getAll("memory_links");
}

export async function createLink(link: MemoryLink): Promise<void> {
  const db = await getDb();
  await db.put("memory_links", link);
}

export async function getLinksForMemory(memoryId: string): Promise<MemoryLink[]> {
  const db = await getDb();
  const fromLinks = await db.getAllFromIndex("memory_links", "by-from", memoryId);
  const toLinks = await db.getAllFromIndex("memory_links", "by-to", memoryId);
  return [...fromLinks, ...toLinks];
}

// ─── Seeded memories (first-run) ─────────────────────────────────────────────

export const SEEDED_MEMORIES: Memory[] = [
  {
    id: "seed-001",
    content:
      "Alice prefers Python for backend development work and uses it as the primary language for all server-side projects.",
    type: "semantic",
    status: "active",
    sourceChunkId: -1,
    confidence: 0.85,
    createdAt: Date.now() - 86400000 * 7,
    tags: ["alice", "python", "backend"],
  },
  {
    id: "seed-002",
    content:
      "The engineering team uses session-based authentication with server-side cookies for all internal services.",
    type: "episodic",
    status: "active",
    sourceChunkId: -1,
    confidence: 0.9,
    createdAt: Date.now() - 86400000 * 14,
    tags: ["auth", "session", "cookies"],
  },
  {
    id: "seed-003",
    content:
      "Project Nexus is currently in the planning and design phase, with no confirmed launch date.",
    type: "episodic",
    status: "active",
    sourceChunkId: -1,
    confidence: 0.88,
    createdAt: Date.now() - 86400000 * 30,
    tags: ["nexus", "project", "planning"],
  },
  {
    id: "seed-004",
    content:
      "The internal API has a rate limit of 500 requests per minute with simple retry logic.",
    type: "procedural",
    status: "active",
    sourceChunkId: -1,
    confidence: 0.92,
    createdAt: Date.now() - 86400000 * 10,
    tags: ["api", "rate-limit", "retry"],
  },
  {
    id: "seed-005",
    content:
      "Carol prefers synchronous video calls for important discussions and scheduling updates.",
    type: "semantic",
    status: "active",
    sourceChunkId: -1,
    confidence: 0.8,
    createdAt: Date.now() - 86400000 * 5,
    tags: ["carol", "communication", "video"],
  },
];

export async function seedIfEmpty(): Promise<void> {
  const db = await getDb();
  const count = await db.count("memories");
  if (count === 0) {
    const tx = db.transaction("memories", "readwrite");
    await Promise.all(SEEDED_MEMORIES.map((m) => tx.store.put(m)));
    await tx.done;
  }
}

export async function clearAllData(): Promise<void> {
  dbPromise = null;
  indexedDB.deleteDatabase(DB_NAME);
}
