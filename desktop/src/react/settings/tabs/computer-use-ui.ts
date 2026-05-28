import { t } from '../helpers';

export type PermissionItem = { name?: string; granted?: boolean };

export type ApprovedApp = {
  providerId: string;
  appId: string;
  appName?: string;
  scope?: string;
  approvedAt?: string;
};

export function approvalKey(item: ApprovedApp) {
  return `${item.providerId}:${item.appId}`;
}

export function approvalMeta(item: ApprovedApp) {
  const parts = [item.providerId];
  if (item.scope) parts.push(item.scope);
  if (item.approvedAt) parts.push(item.approvedAt.slice(0, 10));
  return parts.join(' · ');
}

export function permissionName(permission: PermissionItem) {
  return permission.name || 'permission';
}

export function summarizeComputerPermissions(permissions: PermissionItem[]) {
  if (!permissions.length) {
    return {
      ok: false,
      granted: false,
      text: t('settings.computerUse.permissionsUnknown'),
      buttonLabel: t('settings.computerUse.checkPermissions'),
    };
  }

  const missing = permissions.filter((permission) => permission.granted === false);
  if (!missing.length) {
    return {
      ok: true,
      granted: true,
      text: `${t('settings.computerUse.permissionsGranted')}: ${permissions.map(permissionName).join(' · ')}`,
      buttonLabel: t('settings.computerUse.recheckPermissions'),
    };
  }

  return {
    ok: false,
    granted: false,
    text: `${t('settings.computerUse.permissionsMissing')}: ${missing.map(permissionName).join(' · ')}`,
    buttonLabel: t('settings.computerUse.openPermissions'),
  };
}
