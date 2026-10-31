export function allowsVlbMoneyAction(
  role: string | null | undefined,
  permissions: Array<{ module: string; can_view?: boolean; can_edit?: boolean }>
): boolean {
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'staff') return false;
  const vlb = permissions.find((row) => row.module === 'vlb');
  const finance = permissions.find((row) => row.module === 'finance');
  return vlb?.can_edit === true && finance?.can_edit === true;
}
