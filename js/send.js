const params = new URLSearchParams(location.search);
const orderId = params.get("order");
let previousStatus = null;
let orderLineNextNum = 1;

const els = {
    main: document.getElementById("main"),
    loading: document.getElementById("loading"),
    shopName: document.getElementById("shopName"),
    orderNo: document.getElementById("orderNo"),
    folderLabel: document.getElementById("folderLabel"),
    statusStamp: document.getElementById("statusStamp"),
    fileInput: document.getElementById("fileInput"),
    fileList: document.getElementById("fileList"),
    uploadArea: document.getElementById("uploadArea"),
    reopenNote: document.getElementById("reopenNote"),
    addFilesBtn: document.getElementById("addFilesBtn"),
    uploadedFiles: document.getElementById("uploadedFiles"),
};

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function renderStamp(status) {
    els.statusStamp.innerHTML = `<span class="stamp ${status}">${STATUS_LABEL[status] || status}</span>`;
}

function shortId(id) {
    return id ? id.slice(0, 8).toUpperCase() : "—";
}

async function refreshStatus() {
    try {
        const rows = await SB.rpc("get_order_status", { order_id: orderId });
        const row = rows && rows[0];
        if (!row) return;
        els.folderLabel.textContent = row.folder_name;
        els.shopName.textContent = row.business_name || window.SHOP_NAME || "Print Shop";

        // Play ping only after initial load
        if (previousStatus && previousStatus !== row.status) {
            playPing();
        }
        previousStatus = row.status;

        renderStamp(row.status);

        if (row.expired && row.status === "uploading") {
            hide(els.uploadArea);
            els.reopenNote.textContent = "This link has expired. Ask the shop for a new one.";
        }
        else if (row.status !== "uploading") {
            // Shop has moved past receiving — hide the file picker, they're done.
            hide(els.uploadArea);
        }
        if (row.status === 'received') {
            show(els.addFilesBtn);
        } else {
            hide(els.addFilesBtn); // This automatically covers 'uploading', 'for pickup', etc.
        }
    } catch (e) {
        // Non-fatal — just skip this poll.
    }
}

async function init() {
    if (!orderId) {
        els.loading.querySelector("p").textContent = "This link is missing an order — ask the shop for a new one.";
        return;
    }
    hide(els.loading);
    show(els.main);
    els.orderNo.textContent = `ORDER ${shortId(orderId)}`;
    await refreshStatus();
    setInterval(refreshStatus, 4000);
}

function fileRow(file) {
    const row = document.createElement("div");
    row.className = "file-row";
    row.style.display = "block";
    const size = (file.size / 1024 / 1024).toFixed(2) + " MB";
    row.innerHTML = `
    <div style="display:flex;justify-content:space-between">
      <span class="name">${file.id}. ${file.name}</span>
      <span class="size">${size}</span>
    </div>
    <div class="progress"><i></i></div>
  `;
    return row;
}

els.fileInput.addEventListener("change", async () => {
    const files = Array.from(els.fileInput.files);
    els.fileInput.value = "";
    for (const file of files) {
        file.id = orderLineNextNum++;
        const row = fileRow(file);
        els.fileList.appendChild(row);
        const bar = row.querySelector(".progress > i");
        try {
            const path = await SB.uploadFile(orderId, file, (pct) => {
                bar.style.width = pct + "%";
            });
            await SB.rpc("append_order_file", {
                order_id: orderId,
                file_name: file.name,
                storage_path: path,
                size_bytes: file.size,
            });
            bar.style.width = "100%";
            row.style.opacity = "0.7";
            if (/\.(jpe?g|png|gif|webp)$/i.test(file.name)) {
                const thumbBlob = await makeThumbnailBlob(file);
                await saveThumbnail(orderId, file.id, thumbBlob);
            }
            refreshStatus();
        } catch (e) {
            bar.style.background = "var(--brand)";
            row.insertAdjacentHTML("beforeend", `<div class="muted" style="color:var(--brand)">${e.message.includes("expired") ? "This link has expired" : "Upload failed — try again"}</div>`);
        }
    }
    // reRender Gallery view
    orderLineNextNum = 1;
    loadFiles();
});

els.addFilesBtn.addEventListener("click", () => {
    els.fileInput.click();
});

async function renderGallery(rows) {
    els.uploadedFiles.innerHTML = "";
    els.uploadedFiles.className = "file-gallery";

    for (const file of rows) {
        const lineNum = file.id;
        const size = formatSize(file.size);

        const card = document.createElement("div");
        card.className = "file-card";

        // Placeholder while thumbnail loads
        card.innerHTML = `
            <div class="file-thumb-wrap">
                <div class="file-thumb file-thumb--loading"></div>
            </div>
            <div class="file-meta">
                <span class="file-line">${lineNum}</span>
                <div class="file-info">
                    <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                    <span class="file-size">${size}</span>
                </div>
            </div>
        `;
        els.uploadedFiles.appendChild(card);

        // Fetch thumbnail keyed by orderId + line number, swap in once ready
        loadThumbForCard(card, file, lineNum);
    }
}

async function loadThumbForCard(card, file, lineNum) {
    const wrap = card.querySelector(".file-thumb-wrap");
    const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(file.name);

    let blob = null;
    try {
        blob = await getThumbnail(orderId, lineNum); // IndexedDB lookup
    } catch (e) {
        console.warn("Thumbnail lookup failed", e);
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        wrap.innerHTML = `<img src="${url}" alt="${escapeHtml(file.name)}" class="file-thumb" loading="lazy" />`;
        wrap.querySelector("img").onload = () => URL.revokeObjectURL(url);
        // wrap.addEventListener("click", () => openLightbox(url, file.name));
    } else {
        wrap.innerHTML = `<div class="file-thumb file-thumb--icon ${isImage ? "" : "file-thumb--doc"}">${fileTypeIcon(file.name)}</div>`;
    }
}

function formatSize(bytes) {
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function fileTypeIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    const icons = {
        pdf: "📄", doc: "📝", docx: "📝",
        xls: "📊", xlsx: "📊",
        zip: "🗜️", rar: "🗜️",
        mp4: "🎬", mov: "🎬",
        jpg: "🖼️", "jpeg": "🖼️", "png": "🖼️",
        default: "📂"
    };
    return icons[ext] || icons.default;
}

function openLightbox(url, name) {
    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.innerHTML = `
        <div class="lightbox-content">
            <img src="${url}" alt="${escapeHtml(name)}" />
        </div>
        <span class="lightbox-close">&times;</span>
    `;
    overlay.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
}

async function loadFiles() {
    let rows = await SB.rpc("get_order_files", {
        order_id: orderId
    });

    els.uploadedFiles.innerHTML = "";
    rows = rows.map(file => {
        return {
            ...file,
            id: orderLineNextNum++
        }
    });

    renderGallery(rows)
}

init();
loadFiles();