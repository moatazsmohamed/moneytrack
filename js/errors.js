import { t, translations } from './translations.js';

export function errorMessage(error) {
  const key = `cloud.error.${String(error?.code || '').toUpperCase()}`;
  if (Object.hasOwn(translations.en, key)) return t(key);
  return t('cloud.error.GENERIC');
}
