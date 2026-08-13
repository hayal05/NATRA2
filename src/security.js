
const PERMISSIONS = {
  admin: ["*"],
  manager: ["dashboard","inventory","movement","pos","sales","purchases","transactions","cashflow","reports","customers","suppliers"],
  cashier: ["dashboard","pos","sales","customers"],
  storekeeper: ["dashboard","inventory","movement","purchases"],
  accountant: ["dashboard","transactions","cashflow","reports","customers","suppliers"]
};

export function can(role, permission) {
  const list = PERMISSIONS[role] || [];
  return list.includes("*") || list.includes(permission);
}

export function filterNavigation(role, buttons) {
  return buttons.filter(b => can(role, b.dataset.page));
}

export { PERMISSIONS };
