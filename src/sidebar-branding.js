// NATRA sidebar branding
function applyNatraSidebarBranding() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const status = sidebar.querySelector('.sidebar-status');
  if (!status) return;

  const modeDetail = status.querySelector('#modeDetail');
  if (modeDetail) modeDetail.remove();

  let brand = sidebar.querySelector('.natra-sidebar-brand');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'natra-sidebar-brand';
    brand.innerHTML = '<b>Powered by NATRA Technology</b><span>Addis Ababa ©2026</span>';
    sidebar.appendChild(brand);
  }

  if (!document.getElementById('natra-sidebar-branding-style')) {
    const style = document.createElement('style');
    style.id = 'natra-sidebar-branding-style';
    style.textContent = `
      .natra-sidebar-brand{margin-top:10px;padding:10px 8px 2px;text-align:center;color:#fff;font-size:9px;line-height:1.5;letter-spacing:.01em}
      .natra-sidebar-brand b{display:block;font-weight:900}
      .natra-sidebar-brand span{display:block;font-weight:500;color:#9eb1c9}
      .sidebar-collapsed .natra-sidebar-brand{font-size:8px;padding-left:2px;padding-right:2px}
    `;
    document.head.appendChild(style);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyNatraSidebarBranding);
else applyNatraSidebarBranding();

const brandingObserver = new MutationObserver(applyNatraSidebarBranding);
brandingObserver.observe(document.body, { childList: true, subtree: true });
