const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');
const catalogs = Object.fromEntries(['es-AR','en-US'].map(code => [code,JSON.parse(fs.readFileSync(`src/locales/${code}.json`,'utf8'))]));
const keyFor = spanish => Object.keys(catalogs['es-AR'].messages).find(key=>catalogs['es-AR'].messages[key]===spanish);

test('Both complete catalogs preserve interpolation tokens and valid metadata',()=>{
  const base=catalogs['es-AR'].messages, english=catalogs['en-US'].messages;
  assert.deepEqual(Object.keys(base).sort(),Object.keys(english).sort());
  const tokens=value=>[...new Set(value.match(/(?<!\{)\{[^{}]*\}(?!\})/g)||[])].sort();
  for(const [key,spanish]of Object.entries(base)){
    assert.equal(typeof english[key],'string',key);assert.ok(english[key].length,key);
    assert.deepEqual(tokens(english[key]),tokens(spanish),`${key}: ${spanish}`);
  }
});

test('Initial language detects all Spanish locales and otherwise uses English without overriding saved choices',()=>{
  for(const language of ['es','es-ES','es-MX','ES-ar','es_CL','en-US','fr-FR','pt-BR','ja-JP','']) {
    const api=vm.createContext({navigator:{language}}).OpenCabinetI18n;
    assert.equal(api.locale,/^es(?:[-_]|$)/i.test(language)?'es-AR':'en-US');
  }
  assert.equal(vm.createContext({navigator:{languages:['es-ES']}}).OpenCabinetI18n.locale,'es-AR');
  const stored=vm.createContext({navigator:{language:'es-MX'},localStorage:{getItem:()=>JSON.stringify({language:'en-US'})}});
  assert.equal(stored.OpenCabinetI18n.locale,'en-US');
  const corrupt=vm.createContext({navigator:{language:'de-DE'},localStorage:{getItem:()=>'{broken'}});
  assert.equal(corrupt.OpenCabinetI18n.locale,'en-US');
});

test('The chosen language translates dynamic UI text while interpolation keeps user content verbatim',()=>{
  const content='Guardar <My Game> / 日本語';
  const storage=new Map([['opencabinet.preferences',JSON.stringify({language:'en-US'})]]);
  const context=vm.createContext({localStorage:{getItem:key=>storage.get(key)}});
  const api=context.OpenCabinetI18n;
  assert.equal(api.locale,'en-US');assert.equal(api.t(keyFor('Cancelar')),'Cancel');
  assert.equal(api.t(keyFor('Logo de {0}'),content),`Logo for ${content}`);
  assert.equal(api.t('time.range','2–5'),'2–5 times');
  api.setLocale('unknown');assert.equal(api.locale,'es-AR');assert.equal(api.t(keyFor('Cancelar')),'Cancelar');
});

test('The built-in cooperative mode and full-screen case title are localized without translating custom modes',()=>{
  const api=vm.createContext({}).OpenCabinetI18n;
  api.setLocale('en-US');
  assert.equal(api.t('box.viewer.title','Juego original'),'3D case · Juego original');
  assert.equal(api.gameMode('Cooperativo'),'Cooperative');
  assert.equal(api.gameMode('Cooperativo local personalizado'),'Cooperativo local personalizado');
  api.setLocale('es-AR');assert.equal(api.gameMode('Cooperative'),'Cooperativo');
});

test('DOM translation only updates explicitly marked UI nodes, including accessible attributes',()=>{
  const context=vm.createContext({});const api=context.OpenCabinetI18n;api.setLocale('en-US');
  const ui={textContent:'Cancelar',getAttribute:()=>keyFor('Cancelar')};
  const game={textContent:'Cancelar'};const input={attributes:{},getAttribute:()=>keyFor('Buscar juegos...'),setAttribute(k,v){this.attributes[k]=v;}};
  const root={documentElement:{setAttribute(k,v){this[k]=v;},removeAttribute(){}},querySelectorAll(selector){
    return selector==='[data-i18n]'?[ui]:selector==='[data-i18n-placeholder]'?[input]:[];
  }};
  api.translateDOM(root);assert.equal(ui.textContent,'Cancel');assert.equal(game.textContent,'Cancelar');
  assert.equal(input.attributes.placeholder,'Search games...');assert.equal(root.documentElement.lang,'en-US');
});

test('Additional and incomplete locale catalogs are discovered and fall back per message',()=>{
  const extra=JSON.parse(JSON.stringify(catalogs));extra['pt-BR']={_meta:{locale:'pt-BR',name:'Português (Brasil)'},messages:{[keyFor('Cancelar')]:'Cancelar PT'}};
  const context=vm.createContext({OpenCabinetLocaleCatalogs:extra});context.OpenCabinetLocaleCatalogs=extra;
  vm.runInContext(fs.readFileSync('src/i18n.js','utf8'),context);const api=context.OpenCabinetI18n;
  api.setLocale('pt-BR');assert.ok(api.languages.some(item=>item.code==='pt-BR'));
  assert.equal(api.t(keyFor('Cancelar')),'Cancelar PT');assert.equal(api.t(keyFor('Guardar')),'Guardar');
});

test('Every referenced UI and native translation key exists in the fallback catalog',()=>{
  const files=[...fs.readdirSync('src',{recursive:true}).filter(file=>/\.(js|html)$/.test(file)&&!file.includes('vendor')&&!file.includes('locales')).map(file=>path.join('src',file)),
    ...fs.readdirSync('src-tauri/src',{recursive:true}).filter(file=>file.endsWith('.rs')).map(file=>path.join('src-tauri/src',file))];
  for(const file of files)for(const match of fs.readFileSync(file,'utf8').matchAll(/['"](msg\.[a-f\d]+|language\.[\w]+|time\.[\w]+|order\.[\w]+|update\.[\w]+)['"]/g)){
    if (match[1] === 'language.json') continue;
    assert.ok(Object.hasOwn(catalogs['es-AR'].messages,match[1]),`${file}: ${match[1]}`);
  }
});
