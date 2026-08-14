// NATRA sidebar branding
// Keep the requested two-line footer at the bottom of the sidebar.
function applyNatraSidebarBranding() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const status = sidebar.querySelector('.sidebar-status');
  if (!status) return;

  // Remove the database filename description while preserving offline/backup status.
  const modeDetail = status.querySelector('#modeDetail');
  if (modeDetail) modeDetail.remove();

  let brand = sidebar.querySelector('.natra-sidebar-brand');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'natra-sidebar-brand';
    brand.innerHTML = '<b>Powered by NATRA Technology</b><span>Addis Ababa ©2026</span>';
    sidebar.appendChild(brand);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyNatraSidebarBranding);
} else {
  applyNatraSidebarBranding();
}

// main.js builds the shell synchronously, but keep this resilient if the shell is rebuilt.
const brandingObserver = new MutationObserver(applyNatraSidebarBranding);
brandingObserver.observe(document.body, { childList: true, subtree: true });
