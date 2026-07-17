// Thin helper layer over Supabase's REST endpoints.
// Uses plain fetch/XHR (not the supabase-js SDK) so we get real upload
// progress events, and so the whole thing is just two small files to host.

const SB = {
    headers() {
        return {
            "apikey": window.SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${window.SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
        };
    },

    async rpc(fn, args) {
        const res = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(args),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `${fn} failed`);
        }
        return res.json();
    },

    // Uploads a File to the "uploads" bucket at <orderId>/<filename>, reporting
    // progress via onProgress(0..100). Resolves with the storage path.
    uploadFile(orderId, file, onProgress) {
        return new Promise((resolve, reject) => {
            const safeName = file.name.replace(/[^\w.\-]+/g, "_");
            const path = `${orderId}/${Date.now()}_${safeName}`;
            const xhr = new XMLHttpRequest();
            xhr.open(
                "POST",
                `${window.SUPABASE_URL}/storage/v1/object/uploads/${encodeURIComponent(path)}`
            );
            xhr.setRequestHeader("apikey", window.SUPABASE_ANON_KEY);
            xhr.setRequestHeader("Authorization", `Bearer ${window.SUPABASE_ANON_KEY}`);
            xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(path);
                else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
            };
            xhr.onerror = () => reject(new Error("Network error during upload"));
            xhr.send(file);
        });
    },

    // The "uploads" bucket is private, so every read needs the anon key
    // attached — there's no plain public URL. Fetch the bytes and hand back
    // a local object URL for <img src>, downloads, or printing.
    async fetchFileUrl(path) {
        const res = await fetch(
            `${window.SUPABASE_URL}/storage/v1/object/uploads/${encodeURIComponent(path)}`,
            { headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: `Bearer ${window.SUPABASE_ANON_KEY}` } }
        );
        if (!res.ok) throw new Error(`Could not fetch file (${res.status})`);
        const blob = await res.blob();
        return URL.createObjectURL(blob);
    },

    async deleteFiles(paths) {
        const res = await fetch(
            `${window.SUPABASE_URL}/storage/v1/object/uploads`,
            {
                method: "DELETE",
                headers: {
                    apikey: window.SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ prefixes: paths })
            }
        );

        if (!res.ok) {
            throw new Error(await res.text());
        }
    }
};
