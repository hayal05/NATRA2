function applyNatraBranding() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return false;

  // Remove the database filename from the sidebar status area.
  const databaseDetail = document.querySelector('#modeDetail');
  if (databaseDetail) databaseDetail.remove();

  // Replace the old footer branding completely.
  const footer = document.querySelector('.footer');
  if (footer) footer.remove();

  let branding = sidebar.querySelector('.natra-sidebar-branding');
  if (!branding) {
    branding = document.createElement('div');
    branding.className = 'natra-sidebar-branding';
    branding.textContent = 'NATRA Technology';
    sidebar.appendChild(branding);
  }

  return true;
}

if (!applyNatraBranding()) {
  const observer = new MutationObserver(() => {
    if (applyNatraBranding()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

const style = document.createElement('style');
style.textContent = `
  .sidebar .natra-sidebar-branding {
    flex: 0 0 auto;
    margin: 10px 4px 2px;
    padding: 10px 8px 4px;
    border-top: 1px solid rgba(255,255,255,.12);
    color: #ffffff;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: .01em;
    text-align: center;
  }
  .sidebar-collapsed .natra-sidebar-branding {
    font-size: 0;
    padding-left: 0;
    padding-right: 0;
  }
  .sidebar-collapsed .natra-sidebar-branding::after {
    content: 'N';
    font-size: 13px;
    font-weight: 900;
  }
`;
document.head.appendChild(style);
