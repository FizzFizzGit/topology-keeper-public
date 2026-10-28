const { getLanguage } = require('obsidian');
const { normalizeLanguage, createTranslator } = require('./i18n-core');
let locale;
let translate;
function t(key, values) {
  const current = normalizeLanguage(typeof getLanguage === 'function' ? getLanguage() : 'en');
  if (current !== locale) { locale = current; translate = createTranslator(current); }
  return translate(key, values);
}
module.exports = { t };
