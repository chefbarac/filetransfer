// thumbnailStore.js
const DB_NAME = "orderThumbnails";
const STORE_NAME = "thumbs";
const DB_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h safety net

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
                store.createIndex("orderId", "orderId", { unique: false });
                store.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// --- Save a thumbnail blob ---
async function saveThumbnail(orderId, fileId, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({
            key: `${orderId}:${fileId}`,
            orderId,
            fileId,
            blob,
            createdAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Get all thumbnails for an order (for rendering) ---
async function getThumbnailsForOrder(orderId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const idx = tx.objectStore(STORE_NAME).index("orderId");
        const req = idx.getAll(IDBKeyRange.only(orderId));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Add this to thumbnailStore.js — single lookup by orderId + line number
async function getThumbnail(orderId, lineNum) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(`${orderId}:${lineNum}`);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

// --- Explicit cleanup: call when transaction closes ---
async function clearThumbnailsForOrder(orderId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const idx = tx.objectStore(STORE_NAME).index("orderId");
        const req = idx.openCursor(IDBKeyRange.only(orderId));
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Safety net: sweep anything older than MAX_AGE_MS ---
async function sweepStaleThumbnails() {
    const db = await openDB();
    const cutoff = Date.now() - MAX_AGE_MS;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const idx = tx.objectStore(STORE_NAME).index("createdAt");
        const req = idx.openCursor(IDBKeyRange.upperBound(cutoff));
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function makeThumbnailBlob(file, maxDim = 512) {
    const img = await createImageBitmap(file);
    const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
}

window.addEventListener("load", () => {
    sweepStaleThumbnails().catch(console.error);
});