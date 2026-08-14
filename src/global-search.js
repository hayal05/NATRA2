(() => {
  const input = document.querySelector("#globalSearch");
  if (!input) return;

  const searchBox = input.closest(".global-search");
  const panel = document.createElement("div");
  panel.className = "global-search-panel";
  panel.setAttribute("role", "listbox");
  panel.hidden = true;
  searchBox?.appendChild(panel);

  const style = document.createElement("style");
  style.textContent = `
  .global-search { position: relative; }
  .global-search-panel {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: min(520px, calc(100vw - 32px));
    max-height: 420px;
    overflow-y: auto;
    z-index: 1000;
    padding: 8px;
    border: 1px solid rgba(127,127,127,.22);
    border-radius: 14px;
    background: var(--card, #fff);
    box-shadow: 0 16px 40px rgba(0,0,0,.18);
  }
  .global-search-group {
    padding: 8px 10px 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .08em;
    opacity: .6;
  }
  .global-search-result {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 11px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .global-search-result:hover,
  .global-search-result:focus-visible { background: rgba(127,127,127,.10); outline: none; }
  .global-search-result .result-icon { width: 24px; text-align: center; opacity: .75; }
  .global-search-result .result-text { min-width: 0; flex: 1; }
  .global-search-result b { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .global-search-result small { display: block; margin-top: 2px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .global-search-empty { padding: 24px 14px; text-align: center; opacity: .65; }
  .global-search-hint { padding: 8px 11px 4px; font-size: 11px; opacity: .55; }
  @media (max-width: 700px) {
    .global-search-panel { position: fixed; top: 64px; left: 16px; right: 16px; width: auto; max-height: 55vh; }
    .global-search kbd { display: none; }
  }
  `;
  document.head.appendChild(style);

  const normalize = value => String(value || "").trim().toLowerCase();
  const pageName = id => {
    const button = document.querySelector(`.nav-btn[data-page="${CSS.escape(id)}"]`);
    return button?.textContent?.trim() || id;
  };

  function navigate(pageId, query = "") {
    const button = document.querySelector(`.nav-btn[data-page="${CSS.escape(pageId)}"]`);
    if (button) button.click();

    if (query) {
      const page = document.querySelector(`#page-${CSS.escape(pageId)}`);
      const localSearch = page?.querySelector("#productSearch, #movementSearch, #posSearch, #customerSearch, #supplierSearch, #transactionSearch");
      if (localSearch) {
        localSearch.value = query;
        localSearch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    input.blur();
    panel.hidden = true;
  }

  function buildIndex() {
    const results = [];

    document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
      const id = button.dataset.page;
      const label = button.textContent.trim();
      if (id && label) results.push({ type: "module", title: label, subtitle: "Open module", page: id, icon: "▣", key: `module:${id}` });
    });

    document.querySelectorAll(".page").forEach(page => {
      const id = page.id.replace(/^page-/, "");
      const title = page.querySelector("h1")?.textContent?.trim();
      if (title) results.push({ type: "page", title, subtitle: "Page", page: id, icon: "↗", key: `page:${id}` });

      page.querySelectorAll("tbody tr").forEach((row, index) => {
        const cells = [...row.querySelectorAll("td")].map(cell => cell.textContent.trim()).filter(Boolean);
        if (!cells.length) return;
        const titleText = cells.slice(0, 3).join(" · ");
        results.push({
          type: "data",
          title: titleText,
          subtitle: pageName(id),
          page: id,
          query: cells[0],
          icon: "•",
          key: `data:${id}:${index}:${titleText}`
        });
      });
    });

    return results;
  }

  function render(query) {
    const q = normalize(query);
    if (!q) {
      panel.innerHTML = `<div class="global-search-hint">Search modules, products, customers, suppliers, transactions and other loaded records.</div>`;
      panel.hidden = false;
      return;
    }

    const index = buildIndex();
    const matches = [];
    const seen = new Set();

    for (const item of index) {
      const haystack = normalize(`${item.title} ${item.subtitle}`);
      if (!haystack.includes(q)) continue;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      matches.push(item);
      if (matches.length >= 24) break;
    }

    if (!matches.length) {
      panel.innerHTML = `<div class="global-search-empty">No results for <b>${escapeHtml(query)}</b></div>`;
      panel.hidden = false;
      return;
    }

    const groups = [["module", "Modules"], ["page", "Pages"], ["data", "Records"]];
    panel.innerHTML = groups.map(([type, label]) => {
      const items = matches.filter(item => item.type === type);
      if (!items.length) return "";
      return `<div class="global-search-group">${label}</div>${items.map(item => `
        <button class="global-search-result" type="button" role="option" data-result-index="${matches.indexOf(item)}">
          <span class="result-icon">${item.icon}</span>
          <span class="result-text"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span>
          <span>›</span>
        </button>`).join("")}`;
    }).join("");

    panel.hidden = false;
    panel.querySelectorAll(".global-search-result").forEach(button => {
      button.addEventListener("click", () => {
        const item = matches[Number(button.dataset.resultIndex)];
        if (item) navigate(item.page, item.type === "data" ? item.query : "");
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
    }[c]));
  }

  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const first = panel.querySelector(".global-search-result");
      if (first) first.click();
    }
    if (event.key === "Escape") {
      panel.hidden = true;
      input.blur();
    }
  });

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === "Escape" && document.activeElement !== input) panel.hidden = true;
  });

  document.addEventListener("click", event => {
    if (!searchBox.contains(event.target)) panel.hidden = true;
  });
})();
