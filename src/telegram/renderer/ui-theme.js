import { getSettingsManager } from '../../settings/settings-manager.js';

export function getUiMode() {
  try {
    return getSettingsManager().get('stealth_mode');
  } catch {
    return 'NORMAL';
  }
}

export function isStealthMode() {
  return getUiMode() === 'STEALTH';
}

export function uiIcon(normal, stealth = '▪') {
  return isStealthMode() ? stealth : normal;
}

export function uiTitle(normalIcon, title, stealthPrefix = '■') {
  return `${isStealthMode() ? stealthPrefix : normalIcon} ${title}`;
}

export function uiStatusIcon(kind) {
  if (isStealthMode()) {
    return ({ success: '✓', error: '×', warning: '!', info: '·', active: '●', inactive: '○' })[kind] || '·';
  }
  return ({ success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️', active: '🟢', inactive: '⚪' })[kind] || '•';
}
