function applyNatraBranding() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return false;

  // Remove the database filename from the sidebar status area.
  const databaseDetail = document.querySelector('#modeDetail');
  if (databaseDetail) databaseDetail.remove();

  // Remove the old main footer branding.
  const footer = document.querySelector('.footer');
  if (footer) footer.remove();

  let branding = sidebar.querySelector('.natra-sidebar-branding');
  if (!branding) {
    branding = document.createElement('div');
    branding.className = 'natra-sidebar-branding';
    sidebar.appendChild(branding);
  }

  branding.innerHTML = '<b>Powered by NATRA Technology</b><span>Addis Ababa ©2026</span>';
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
    font-size: 9px;
    line-height: 1.5;
    letter-spacing: .01em;
    text-align: center;
  }
  .sidebar .natra-sidebar-branding b {
    display: block;
    font-weight: 900;
  }
  .sidebar .natra-sidebar-branding span {
    display: block;
    color: #9eb1c9;
    font-weight: 500;
  }
  .sidebar-collapsed .natra-sidebar-branding {
    font-size: 8px;
  }
`;
document.head.appendChild(style);
