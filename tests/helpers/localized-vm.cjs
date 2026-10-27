const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../../src');
const catalogs = Object.fromEntries(fs.readdirSync(path.join(directory, 'locales')).filter(name => /^[a-z]{2,3}-[A-Z]{2}\.json$/.test(name))
  .map(name => { const value = JSON.parse(fs.readFileSync(path.join(directory, 'locales', name), 'utf8')); return [value._meta.locale, value]; }));
const source = fs.readFileSync(path.join(directory, 'i18n.js'), 'utf8');
function createContext(...args) {
  const context = vm.createContext(...args);
  // Existing UI fixtures use Spanish; language-detection tests supply their own navigator.
  if (!('navigator' in context)) context.navigator = { language: 'es-AR' };
  context.OpenCabinetLocaleCatalogs = catalogs;
  vm.runInContext(source, context);
  return context;
}
module.exports = { ...vm, createContext,
  runInNewContext(code, sandbox = {}, options) { return vm.runInContext(code, createContext(sandbox), options); },
};
