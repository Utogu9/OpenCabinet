const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const context=vm.createContext({});vm.runInContext(fs.readFileSync('src/game-order.js','utf8'),context);
const api=context.OpenCabinetOrder;
const definition={id:1,titles:['Gran Turismo 4','Gran Turismo 3','Gran Turismo 2','Gran Turismo']};
const game=(id,title,group=null)=>({id,title,order_group:group});
const names=games=>Array.from(games,item=>item.title);

test('A custom title group is contiguous at its first normal position without changing other games or source arrays',()=>{
  const original=[game(1,'Ace Combat'),game(2,'Gran Turismo',definition),game(3,'Gran Turismo 2',definition),game(4,'Gran Turismo 3',definition),game(5,'Gran Turismo 4',definition),game(6,'Mario')];
  const result=api.apply(original);
  assert.deepEqual(names(result),['Ace Combat','Gran Turismo 4','Gran Turismo 3','Gran Turismo 2','Gran Turismo','Mario']);
  assert.deepEqual(names(original),['Ace Combat','Gran Turismo','Gran Turismo 2','Gran Turismo 3','Gran Turismo 4','Mario']);
  assert.equal(result[1],original[4]);
});

test('Filtering never brings back hidden games; missing titles start applying when imported',()=>{
  const library=[game(1,'Gran Turismo',definition),game(2,'Gran Turismo 2',definition)];
  assert.deepEqual(names(api.apply(library,library)),['Gran Turismo 2','Gran Turismo']);
  const imported=game(3,'Gran Turismo 4');library.push(imported);
  assert.deepEqual(names(api.apply([library[0],imported],library)),['Gran Turismo 4','Gran Turismo']);
  assert.equal(api.apply([],library).length,0);
});

test('Title matching ignores case and outer whitespace, preserves accents and keeps duplicate-platform entries stable',()=>{
  const group={id:2,titles:['Pokémon','Other']};
  const source=[game(1,'Other',group),game(2,' POKÉMON '),game(3,'Pokémon'),game(4,'Pokemon')];
  assert.deepEqual(Array.from(api.apply(source),item=>item.id),[2,3,1,4]);
  assert.equal(api.key('Poke\u0301mon'),api.key('Pokémon'));
});

test('Several groups are independent and ungrouped libraries retain their normal ordering',()=>{
  const a={id:1,titles:['A2','A1']},b={id:2,titles:['B2','B1']};
  const source=[game(1,'A1',a),game(2,'B1',b),game(3,'C'),game(4,'A2',a),game(5,'B2',b)];
  assert.deepEqual(names(api.apply(source)),['A2','A1','B2','B1','C']);
  const none=[game(1,'C'),game(2,'B')];assert.equal(api.apply(none),none);
});
