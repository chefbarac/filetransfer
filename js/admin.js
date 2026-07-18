const STATUS_LABEL = {
    uploading: "Uploading",
    received: "Received",
    printing: "Printing",
    ready: "Ready for pickup",
    picked_up: "Picked up",
};
const STATUS_FLOW = ["received", "printing", "ready", "picked_up"];

const PAPER_SIZES = [
    { id: "short", label: "Short (Letter, 8.5×11in)", css: "8.5in 11in" },
    { id: "long", label: "Long (Legal/Folio, 8.5×13in)", css: "8.5in 13in" },
    { id: "a4", label: "A4", css: "210mm 297mm" },
    { id: "a3", label: "A3", css: "297mm 420mm" },
];

let adminPw = sessionStorage.getItem("adminPw") || "";
let businessName = sessionStorage.getItem("businessName") || "";
let orders = [];

const $ = (id) => document.getElementById(id);

// ---------------- Login ----------------

async function tryLogin(pw) {
    const rows = await SB.rpc("verify_business_password", { pw });
    const row = rows && rows[0];
    if (!row) return false;
    adminPw = pw;
    businessName = row.name;
    sessionStorage.setItem("adminPw", pw);
    sessionStorage.setItem("businessName", businessName);
    return true;
}

async function boot() {
    if (adminPw) {
        const rows = await SB.rpc("verify_business_password", { pw: adminPw }).catch(() => []);
        if (rows && rows[0]) {
            businessName = rows[0].name;
            return enterDashboard();
        }
        sessionStorage.removeItem("adminPw");
        sessionStorage.removeItem("businessName");
    }
    show($("login"));
}

$("loginBtn").onclick = async () => {
    $("loginError").classList.add("hidden");
    const pw = $("loginPw").value.trim();
    if (!pw) return;
    $("loginBtn").disabled = true;
    try {
        const ok = await tryLogin(pw);
        if (ok) enterDashboard();
        else {
            $("loginError").textContent = "Wrong password.";
            $("loginError").classList.remove("hidden");
        }
    } finally {
        $("loginBtn").disabled = false;
    }
};
$("loginPw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function enterDashboard() {
    hide($("login"));
    show($("dash"));
    $("shopNameHead").textContent = businessName || window.SHOP_NAME || "PRINT SHOP";
    loadOrders();
    setInterval(loadOrders, 6000);
}

// ---------------- Orders list ----------------

async function loadOrders() {
    try {
        orders = await SB.rpc("admin_list_orders", { admin_pw: adminPw });
        renderOrders();
    } catch (e) {
        // Session likely expired — bounce to login.
    }
}

function renderOrders() {
    const wrap = $("orders");
    if (!orders.length) {
        wrap.innerHTML = `<div class="empty">No orders yet. Click "Receive files" to generate a link for a customer.</div>`;
        return;
    }
    wrap.innerHTML = "";
    for (const o of orders) {
        // if (o.status === 'picked_up') continue;
        const ticket = document.createElement("div");
        ticket.className = "ticket";
        const created = new Date(o.created_at).toLocaleString();
        const expired = new Date(o.expires_at) < new Date();
        ticket.innerHTML = `
      <div class="order-no mono">ORDER ${o.id.slice(0, 8).toUpperCase()} — ${created}</div>
      <div class="folder">${escapeHtml(o.folder_name)} <span class="muted" style="font-weight:400">· ${escapeHtml(o.customer_name)}</span></div>
      <span class="stamp ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
      ${expired && o.status === "uploading" ? `<span class="stamp uploading" style="margin-left:6px">Link expired</span>` : ""}
      <div class="perf"></div>
      <div class="files"></div>
      ${`<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;` + (o.status === 'picked_up' ? 'display: none;"' : '"') + `">
        ${statusButtons(o)}
        <button class="primary save-btn">Download All Files</button>
      </div>`}
    `;
        const filesBox = ticket.querySelector(".files");
        if (o.status === "picked_up") {
            filesBox.innerHTML = `<p class="muted" > Files have been deleted after pickup.</ > `;
        }
        else if (!o.files || !o.files.length) {
            filesBox.innerHTML = `<p class="muted">No files uploaded yet.</p>`;
        } else {
            for (const [i, f] of o.files.entries()) {
                const row = document.createElement("div");
                row.className = "file-row";
                row.innerHTML = `
          <span class="name" style="flex-grow: 1;">${i + 1}. ${escapeHtml(f.name)}</span>
          <span class="size" style="flex-shrink: 0;">${(f.size / 1024 / 1024).toFixed(2)} MB</span>
        `;
                const printBtn = document.createElement("button");
                printBtn.className = "secondary";
                printBtn.textContent = "Print";
                printBtn.style.marginLeft = "10px";
                printBtn.onclick = () => openPrintView(f);
                row.appendChild(printBtn);
                filesBox.appendChild(row);
            }
        }
        ticket.querySelectorAll("[data-status]").forEach((btn) => {
            btn.onclick = () => updateStatus(o, btn.dataset.status);
        });
        ticket.querySelector(".save-btn").onclick = () => saveOrderToPC(o);
        wrap.appendChild(ticket);
    }
}

function statusButtons(o) {
    return STATUS_FLOW.map((s) => {
        const active = s === o.status;
        return `<button data-status="${s}" class="${active ? "" : "secondary"}" ${active ? "disabled" : ""}>${STATUS_LABEL[s]}</button>`;
    }).join("");
}

async function updateStatus(order, status) {
    try {
        // If marking as picked up, delete uploaded files first
        if (status === "picked_up") {
            if (!confirm('Files will be deleted. Continue?')) return;
            if (order?.files?.length) {
                await SB.deleteFiles(order.files.map(f => f.path));
            }
        }

        // Update the order status
        const { error } = await SB.rpc("admin_update_status", {
            admin_pw: adminPw,
            order_id: order.id,
            new_status: status
        });

        if (error) {
            showToast(error.message);
            return;
        }

        loadOrders();
    } catch (err) {
        console.error(err);
        showToast("Something went wrong.");
    }
}

// ---------------- Save to PC (File System Access API) ----------------
async function saveOrderToPC(o) {
    if (!o.files || !o.files.length) {
        showToast("No files to download yet.");
        return;
    }

    try {
        showToast(`Started downloading ${o.files.length} file(s).`);
        requestAnimationFrame(async () => {
            for (const f of o.files) {
                const url = await SB.fetchFile(f.path);

                const a = document.createElement("a");
                a.href = url;
                a.download = f.name; // Suggested filename
                a.style.display = "none";

                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                // Small delay so browsers don't block multiple downloads
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        })
    } catch (e) {
        showToast("Couldn't download files: " + e.message);
    }
}

function sanitizeFolderName(name) {
    return (name || "Untitled order").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Untitled order";
}

// ---------------- Print (auto-stretch to page) ----------------

async function openPrintView(file) {
    // const sizeId = sessionStorage.getItem("lastPaperSize") || "short";
    // const size = PAPER_SIZES.find((p) => p.id === sizeId) || PAPER_SIZES[0];
    // const picked = prompt(
    //     `Paper size for "${file.name}":\n` + PAPER_SIZES.map((p, i) => `${i + 1}) ${p.label}`).join("\n"),
    //     String(PAPER_SIZES.indexOf(size) + 1)
    // );
    // const chosen = PAPER_SIZES[parseInt(picked, 10) - 1] || size;
    // sessionStorage.setItem("lastPaperSize", chosen.id);

    /* @page { size: ${chosen.css}; margin: 0; } */

    const url = await SB.fetchFile(file.path);
    const isPdf = /\.pdf$/i.test(file.name);
    const win = window.open("", "_blank");

    win.document.write(`
    <html>
                    <head>
                        <title>Print Image</title>
                        <style>
                            body {
                                margin: 0;
                                padding: 0;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                height: 100vh;
                            }
                            img {
                                width: 100%;
                                height: 100%;
                                object-fit: fill; /* Ensures it stays stretched */
                            }
                            @page {
                                margin: 0; /* Removes browser header/footer margins */
                            }
                        </style>
                    </head>
                    <body>
                        <img src="${url}" />
                        <script>
                            // Wait for the image to load in the new tab, then trigger print
                            window.onload = function() {
                                window.print();
                                // Optional:
                                window.close(); // Closes the tab automatically after printing
                            };
                        <\/script>
                    </body>
                    </html>
  `);
    win.document.close();
}

// ---------------- Receive-link modal ----------------

$("receiveBtn").onclick = () => {
    $("newCustomerName").value = "";
    $("newFolderName").value = "";
    hide($("newLinkBox"));
    show($("receiveModal"));
};
$("closeReceiveModal").onclick = () => hide($("receiveModal"));

$("createOrderBtn").onclick = async () => {
    $("createOrderBtn").disabled = true;
    try {
        const id = await SB.rpc("admin_create_order", {
            admin_pw: adminPw,
            p_customer_name: $("newCustomerName").value.trim(),
            p_folder_name: $("newFolderName").value.trim(),
        });
        const link = `${location.origin}${location.pathname.replace("index.html", "")}send.html?order=${id}`;
        $("newLinkInput").value = link;
        show($("newLinkBox"));
        loadOrders();
    } catch (e) {
        alert("Couldn't create link: " + e.message);
    } finally {
        $("createOrderBtn").disabled = false;
    }
};
$("copyLinkBtn").onclick = () => {
    $("newLinkInput").select();
    document.execCommand("copy");
    $("copyLinkBtn").textContent = "Copied";
    setTimeout(() => $("copyLinkBtn").textContent = "Copy", 1500);
};

// ---------------- Change dashboard password ----------------

$("changePwBtn").onclick = () => {
    $("oldPwInput").value = "";
    $("newPwInput").value = "";
    $("changePwError").classList.add("hidden");
    show($("changePwModal"));
};
$("closeChangePwModal").onclick = () => hide($("changePwModal"));

$("savePwBtn").onclick = async () => {
    $("changePwError").classList.add("hidden");
    const oldPw = $("oldPwInput").value.trim();
    const newPw = $("newPwInput").value.trim();
    if (!oldPw || !newPw) return;
    $("savePwBtn").disabled = true;
    try {
        await SB.rpc("change_business_password", { old_pw: oldPw, new_pw: newPw });
        adminPw = newPw;
        sessionStorage.setItem("adminPw", newPw);
        hide($("changePwModal"));
    } catch (e) {
        $("changePwError").textContent = "Current password was incorrect.";
        $("changePwError").classList.remove("hidden");
    } finally {
        $("savePwBtn").disabled = false;
    }
};

boot();
