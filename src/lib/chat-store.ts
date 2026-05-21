import type { ChatSession } from "@/types";

const DB_NAME = "resume-assistant";
const STORE_NAME = "chat-sessions";
const MAX_SESSIONS = 3;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const db = await openDB();

  const all = await getChatSessions();
  const existing = all.find((s) => s.id === session.id);

  if (!existing && all.length >= MAX_SESSIONS) {
    const oldest = all[all.length - 1];
    await deleteChatSession(oldest.id);
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChatSessions(): Promise<ChatSession[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const sessions = request.result as ChatSession[];
      sessions.sort((a, b) => b.created_at - a.created_at);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
