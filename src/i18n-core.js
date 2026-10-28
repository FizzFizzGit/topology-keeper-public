const { dictionaries } = require('./ui-dictionary');
function normalizeLanguage(language) {
  return typeof language === 'string' && /^ja(?:[-_]|$)/i.test(language.trim()) ? 'ja' : 'en';
}
function createTranslator(language, catalogs = dictionaries) {
  const locale = normalizeLanguage(language);
  return (key, values = {}) => {
    const pluralKey = typeof values.count === 'number' && values.count === 1 ? `${key}.one` : key;
    const message = catalogs[locale]?.[pluralKey] ?? catalogs.en?.[pluralKey]
      ?? catalogs[locale]?.[key] ?? catalogs.en?.[key] ?? key;
    return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder);
  };
}
module.exports = { normalizeLanguage, createTranslator };
