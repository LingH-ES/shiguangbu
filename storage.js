import { initialState, makeBackup, migrateState } from './model.js';

const DATABASE = 'time-balance-private';
const STORE = 'state';
let db;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('time-balance-changes') : null;

export async function openStorage() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('请先关闭其他时光簿页面后重试'));
  });
  return updateState(current => current);
}

export function updateState(mutator, { recovery = false } = {}) {
  // A single read/write transaction serializes updates from every open tab.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const read = store.get('current');
    let next;
    let failure;
    read.onsuccess = () => {
      try {
        const current = migrateState(read.result || initialState());
        if (recovery) store.put(makeBackup(current), 'beforeRestore');
        next = mutator(structuredClone(current)) || current;
        store.put(next, 'current');
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { channel?.postMessage('changed'); resolve(next); };
    tx.onerror = () => reject(failure || tx.error || new Error('无法保存本机数据'));
    tx.onabort = () => reject(failure || tx.error || new Error('保存已取消'));
  });
}

export function readState(key = 'current') {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function onExternalChange(callback) {
  if (channel) channel.onmessage = callback;
}
