function showToast(message, duration = 2500) {
    let toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: #1f2937;
        color: #fff;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        pointer-events: none;
    `;
    document.body.appendChild(toast);

    // trigger transition
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateX(-50%) translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(20px)";
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, duration);
}