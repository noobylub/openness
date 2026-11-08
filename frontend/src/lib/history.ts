import type { Conversation } from "./contracts";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("larasati-studio", 1);
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore("conversations", { keyPath: "id" });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () =>
      reject(new Error("Local history is unavailable in this browser."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("conversations", mode);
    const result = operation(tx.objectStore("conversations"));
    tx.oncomplete = () => {
      resolve(result.result);
      db.close();
    };
    tx.onerror = () => {
      reject(new Error("Could not update local history."));
      db.close();
    };
    tx.onabort = () => {
      reject(new Error("Local history update was interrupted."));
      db.close();
    };
  });
}

export async function loadHistory() {
  const items = await transaction<Conversation[]>("readonly", (store) =>
    store.getAll(),
  );
  return items
    .filter(
      (item) =>
        item && Array.isArray(item.messages) && Array.isArray(item.selections),
    )
    .sort((first, second) => second.updated - first.updated);
}
export const saveConversation = (conversation: Conversation) =>
  transaction("readwrite", (store) => store.put(conversation));
export const removeConversation = (id: string) =>
  transaction("readwrite", (store) => store.delete(id));
