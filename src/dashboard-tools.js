import "./dashboard-tools.css";

const topActions = document.querySelector(".top-actions");
if (topActions) {
  const buttons = [...topActions.querySelectorAll("button.icon-btn")];
  const notificationButton = buttons.find((button) => button.title === "Notifications");
  const helpButton = buttons.find((button) => button.title === "Help");

  if (notificationButton && helpButton) {
    notificationButton.id = "notificationButton";
    helpButton.id = "helpButton";
    notificationButton.setAttribute("aria-haspopup", "dialog");
    helpButton.setAttribute("aria-haspopup", "dialog");

    const notifyDot = notificationButton.querySelector(".notify-dot");
    if (notifyDot) notifyDot.setAttribute("aria-label", "Unread notifications");

    const overlay = document.createElement("div");
    overlay.id = "dashboardToolsOverlay";
    overlay.className = "dashboard-tools-overlay";
    overlay.innerHTML = `
      <section class="dashboard-tools-panel" id="notificationsPanel" role="dialog" aria-modal="true" aria-labelledby="notificationsTitle" hidden>
        <div class="dashboard-tools-head">
          <div><h2 id="notificationsTitle">Notifications</h2><p id="notificationSummary">Checking your business status…</p></div>
          <button class="icon-btn dashboard-tools-close" data-close-tools aria-label="Close notifications">×</button>
        </div>
        <div class="notification-list" id="notificationList"></div>
        <div class="dashboard-tools-foot"><button class="btn" id="refreshNotifications">Refresh</button><button class="btn primary" id="markNotificationsRead">Mark all as read</button></div>
      </section>
      <section class="dashboard-tools-panel help-panel" id="helpPanel" role="dialog" aria-modal="true" aria-labelledby="helpTitle" hidden>
        <div class="dashboard-tools-head">
          <div><h2 id="helpTitle">NATRA Help</h2><p>Quick guidance for the main dashboard and daily workflow.</p></div>
          <button class="icon-btn dashboard-tools-close" data-close-tools aria-label="Close help">×</button>
        </div>
        <div class="help-grid">
          <article class="help-card"><b>Dashboard</b><span>Monitor sales, profit, cash flow, stock value and items needing attention.</span><button class="link-btn" data-page="dashboard">Open Dashboard</button></article>
          <article class="help-card"><b>Inventory</b><span>Products, stock adjustments, low-stock items and stock movement are kept together.</span><button class="link-btn" data-page="products">Open Inventory</button></article>
          <article class="help-card"><b>Sales & POS</b><span>Create a sale from New Sale, then review completed sales and returns.</span><button class="link-btn" data-page="pos">Open New Sale</button></article>
          <article class="help-card"><b>Cash Flow</b><span>Review income, expenses, transfers and the closing balance.</span><button class="link-btn" data-page="cashflow">Open Cash Flow</button></article>
          <article class="help-card"><b>Settings</b><span>Configure the application and persistent business preferences.</span><button class="link-btn" data-page="settings">Open Settings</button></article>
          <article class="help-card"><b>Keyboard shortcuts</b><span><kbd>Ctrl + K</kbd> focuses global search · <kbd>?</kbd> opens Help · <kbd>Esc</kbd> closes this window.</span></article>
        </div>
        <div class="help-note"><b>Offline first:</b> NATRA continues using the local database when the computer is offline.</div>
      </section>`;
    document.body.appendChild(overlay);

    const notificationList = document.getElementById("notificationList");
    const notificationSummary = document.getElementById("notificationSummary");
    const notificationsPanel = document.getElementById("notificationsPanel");
    const helpPanel = document.getElementById("helpPanel");
    const markReadButton = document.getElementById("markNotificationsRead");
    const refreshButton = document.getElementById("refreshNotifications");
    const readKey = "natra.dashboard.notifications.readSignature";
    let activePanel = null;

    function closeTools() {
      activePanel = null;
      notificationsPanel.hidden = true;
      helpPanel.hidden = true;
      overlay.classList.remove("open");
    }

    function openTools(panel) {
      activePanel = panel;
      notificationsPanel.hidden = panel !== "notifications";
      helpPanel.hidden = panel !== "help";
      overlay.classList.add("open");
      if (panel === "notifications") renderNotifications();
    }

    function getNotificationItems() {
      const items = [];
      const lowStockRows = [...document.querySelectorAll("#lowStockBody tr")].filter((row) => !row.querySelector(".empty"));
      const lowStockCount = lowStockRows.length;
      if (lowStockCount > 0) items.push({ id: "low-stock", type: "warning", icon: "!", title: `${lowStockCount} low-stock item${lowStockCount === 1 ? "" : "s"}`, text: "Review products that are at or below their minimum stock level.", page: "lowstock" });

      const backupText = document.getElementById("backupLabel")?.textContent?.trim() || "";
      if (backupText && /checking|never|overdue|failed|error/i.test(backupText)) items.push({ id: "backup", type: /failed|error/i.test(backupText) ? "danger" : "info", icon: "↻", title: "Backup status needs attention", text: backupText, page: "backup" });

      const alerts = [...document.querySelectorAll("#alertsList .alert-row")].map((row) => {
        const title = row.querySelector("b")?.textContent?.trim();
        const sub = row.querySelector("small")?.textContent?.trim();
        return title && !/loading alerts/i.test(title) ? { title, text: sub || "Review this dashboard alert.", page: "lowstock" } : null;
      }).filter(Boolean);
      for (const alert of alerts.slice(0, 5)) {
        const id = `alert-${alert.title}`;
        if (!items.some((item) => item.id === id)) items.push({ id, type: "warning", icon: "!", ...alert });
      }
      if (!items.length) items.push({ id: "all-clear", type: "success", icon: "✓", title: "All clear", text: "No active dashboard alerts were detected.", page: "dashboard" });
      return items;
    }

    function renderNotifications() {
      const items = getNotificationItems();
      const signature = items.map((item) => item.id).sort().join("|");
      const unread = localStorage.getItem(readKey) !== signature;
      if (notifyDot) {
        notifyDot.textContent = unread ? (items.length > 9 ? "9+" : String(items.length)) : "0";
        notifyDot.hidden = !unread;
      }
      notificationSummary.textContent = unread ? `${items.length} notification${items.length === 1 ? "" : "s"} need your attention.` : "You're up to date.";
      notificationList.innerHTML = items.map((item) => `<button class="notification-item ${item.type}" data-page="${item.page}" type="button"><span class="notification-icon">${item.icon}</span><span class="notification-copy"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.text)}</small></span><span class="notification-arrow">›</span></button>`).join("");
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '\"':"&quot;", "'":"&#039;" }[char]));
    }

    function navigate(page) {
      const button = [...document.querySelectorAll(`[data-page="${CSS.escape(page)}"]`)].find((candidate) => candidate.closest(".sidebar, .content"));
      if (button) button.click();
      closeTools();
    }

    notificationButton.addEventListener("click", () => openTools("notifications"));
    helpButton.addEventListener("click", () => openTools("help"));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close-tools]")) closeTools();
      const pageButton = event.target.closest("[data-page]");
      if (pageButton) navigate(pageButton.dataset.page);
    });
    refreshButton.addEventListener("click", renderNotifications);
    markReadButton.addEventListener("click", () => {
      const signature = getNotificationItems().map((item) => item.id).sort().join("|");
      localStorage.setItem(readKey, signature);
      renderNotifications();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activePanel) closeTools();
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        openTools("help");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("globalSearch")?.focus();
      }
    });

    setInterval(renderNotifications, 5000);
    renderNotifications();
  }
}
