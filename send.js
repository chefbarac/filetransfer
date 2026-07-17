const STATUS_LABEL = {
  uploading: "Uploading",
  received: "Received",
  printing: "Printing",
  ready: "Ready for pickup",
  picked_up: "Picked up",
};

const params = new URLSearchParams(location.search);
const orderId = params.get("order");

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
    renderStamp(row.status);

    if (row.expired && row.status === "uploading") {
      hide(els.uploadArea);
      els.reopenNote.textContent = "This link has expired. Ask the shop for a new one.";
    } else if (row.status !== "uploading") {
      // Shop has moved past receiving — hide the file picker, they're done.
      hide(els.uploadArea);
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
      <span class="name">${file.name}</span>
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
    const row = fileRow(file);
    els.fileList.prepend(row);
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
      refreshStatus();
    } catch (e) {
      bar.style.background = "var(--brand)";
      row.insertAdjacentHTML("beforeend", `<div class="muted" style="color:var(--brand)">${e.message.includes("expired") ? "This link has expired" : "Upload failed — try again"}</div>`);
    }
  }
});

init();
