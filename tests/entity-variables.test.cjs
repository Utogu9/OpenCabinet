const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('./helpers/localized-vm.cjs'),path=require('node:path');
const context=vm.createContext({});
for(const file of ['entity-variables.js','library-navigation.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
const vars=context.OpenCabinetVariables,library=context.OpenCabinetLibrary;
const plain=x=>JSON.parse(JSON.stringify(x));
const platform={id:1,name:'Sony Playstation 2'},game={id:7,title:'Game',platform:platform.name,steam_app_id:10};

test('Grouped game categories use variables from the default edition without inheriting the primary edition overrides',()=>{
  const europe={id:7,platform:platform.name},usa={id:8,platform:platform.name};
  const grouped={...europe,default_region_id:8,regions:[{game:europe},{game:usa}]};
  const data={games:{7:{idioma:'es',favorito:'yes'},8:{idioma:'en'}}};
  assert.equal(vars.gameValues(grouped,platform,data).idioma,'en');
  assert.equal(vars.gameValues(grouped,platform,data).favorito,undefined);
  grouped.default_region_id=7;
  assert.equal(vars.gameValues(grouped,platform,data).idioma,'es');
  assert.equal(vars.gameValues(grouped,platform,data).favorito,'yes');
});
test('Steam classification is editable without changing the source or execution identity',()=>{
  const data={games:{7:{steam:'no',favorito:'yes'}}};
  assert.equal(vars.gameValues(game,platform,data).steam,undefined);
  assert.equal(game.steam_app_id,10);
  assert.ok(vars.matches({scope:'game',name:'favorito',operator:'eq',value:'sí'},game,platform,data));
  const tree=library.groups([game],'categories',library.defaults(),[platform],{},data);
  assert.equal(tree.find(g=>g.label==='PC').children.some(c=>c.label==='Steam'),false);
  assert.equal(tree.find(g=>g.label==='PC').children.some(c=>c.label==='Windows'),true);
});
test('Platform variables change default portable groups and games inherit custom values with optional overrides',()=>{
  const local={...game,steam_app_id:null};
  const data={platforms:{1:{portatil:'yes',marca_personal:'Grupo A'}},games:{7:{marca_personal:'Grupo B'}}};
  const effective=vars.platformValues(platform,data);
  assert.equal(effective.portatil,'yes');assert.equal(effective.consola,undefined);
  assert.equal(vars.gameValues(local,platform,data).marca_personal,'Grupo B');
  assert.ok(vars.matches({scope:'platform',name:'marca_personal',operator:'eq',value:'grupo a'},local,platform,data));
  const tree=library.groups([local],'categories',library.defaults(),[platform],{},data);
  assert.deepEqual(plain(tree.map(g=>g.label)),['Portátiles']);
});
test('Variable categories combine scopes using all or any and handle absent keys explicitly',()=>{
  const local={...game,steam_app_id:null};
  const category={id:'custom',name:'Favoritas portátiles',parent_id:null,platforms:[],rule:'variables',match_mode:'all',conditions:[
    {scope:'game',name:'favorito',operator:'eq',value:'yes'},
    {scope:'platform',name:'portatil',operator:'eq',value:'yes'},
  ]};
  const data={platforms:{1:{portatil:'yes'}},games:{7:{favorito:'no'}}};
  let tree=library.groups([local],'categories',[category],[platform],{},data);
  assert.equal(tree[0].label,'Sin categoría');
  tree=library.groups([local],'categories',[{...category,match_mode:'any'}],[platform],{},data);
  assert.equal(tree[0].label,'Favoritas portátiles');
  for(const [operator,expected] of [['exists',false],['not_exists',true],['neq',false]]){
    assert.equal(vars.matches({scope:'game',name:'missing',operator,value:'no'},local,platform,data),expected);
  }
});
test('Conditions support text, numeric comparisons, no/false values and reject inherited object properties',()=>{
  const data={games:{7:{rating:'8.5',terminado:'false',idioma:'Español e Inglés',empty:''}}};
  for(const [name,operator,value,expected] of [['rating','gte','8',true],['rating','lt','8',false],['terminado','eq','no',true],
    ['idioma','contains','espanol',true],['rating','gt','abc',false],['empty','lte','0',false],['constructor','exists','',false]]){
    assert.equal(vars.matches({scope:'game',name,operator,value},game,platform,data),expected);
  }
});
test('Variable editor preserves overrides, leaves automatic values inherited and rejects duplicates',()=>{
  class Element{
    constructor(){this.children=[];this.attributes={};this.value='';}
    append(...items){this.children.push(...items);items.forEach(i=>i.parent=this);}appendChild(i){this.append(i);}
    replaceChildren(...items){this.children=[];this.append(...items);}setAttribute(k,v){this.attributes[k]=v;}
    remove(){this.parent.children=this.parent.children.filter(i=>i!==this);}focus(){}
  }
  const container=new Element(),editor=vars.createEditor(container,{createElement:()=>new Element()});
  editor.set({steam:'yes',portatil:'no'},{favorito:'yes'});
  assert.deepEqual(plain(editor.value()),{favorito:'yes'});
  const list=container.children[0];
  const steam=list.children.find(row=>row.children[0].value==='steam');steam.children[1].value='no';
  assert.deepEqual(plain(editor.value()),{favorito:'yes',steam:'no'});
  container.children[1].onclick();const added=list.children.at(-1);added.children[0].value='steam';added.children[1].value='yes';
  assert.throws(()=>editor.value(),/únicos/);
  added.children[2].onclick();steam.children[2].onclick();
  assert.deepEqual(plain(editor.value()),{favorito:'yes',steam:'no'});
});

test('Missing and disabled variables mean no in equality and existence conditions without numeric or text matches',()=>{
  const data={games:{7:{favorito:'no',oculto:'false',puntos:'0'}}};
  for(const name of ['missing','favorito','oculto']){
    for(const [operator,value,expected] of [['eq','no',true],['eq','yes',false],['neq','yes',true],['exists','',false],['not_exists','',true],['contains','no',false],['gte','0',false]]){
      assert.equal(vars.matches({scope:'game',name,operator,value},game,platform,data),expected,`${name}: ${operator}`);
    }
    assert.equal(Object.hasOwn(vars.gameValues(game,platform,data),name),false);
  }
  assert.equal(vars.gameValues(game,platform,data).puntos,'0');
  assert.equal(vars.matches({scope:'game',name:'puntos',operator:'gte',value:'0'},game,platform,data),true);
  assert.equal(vars.matches({scope:'platform',name:'missing',operator:'eq',value:'no'},game,platform,data),true);
});

function editorApp(getNames=()=>[]){
  class Element{
    constructor(){this.children=[];this.attributes={};this.value='';}
    append(...items){this.children.push(...items);items.forEach(item=>item.parent=this);}appendChild(item){this.append(item);}
    replaceChildren(...items){this.children=[];this.append(...items);}setAttribute(name,value){this.attributes[name]=value;}
    remove(){this.parent.children=this.parent.children.filter(item=>item!==this);}focus(){}
  }
  const container=new Element(),editor=vars.createEditor(container,{createElement:()=>new Element()},{getNames});
  return {container,editor,list:container.children[0],add:container.children[1],suggestions:container.children[2]};
}

test('False rows stay hidden across saves; removing inherited values masks them and readding activates them',()=>{
  const app=editorApp();const base={steam:'yes',consola:'yes',epic:'no',familia:'Nintendo'};
  app.editor.set(base,{steam:'no',favorito:'no',pendiente:'yes'});
  assert.deepEqual(app.list.children.map(row=>row.children[0].value),['consola','familia','pendiente']);
  assert.deepEqual(plain(app.editor.value()),{steam:'no',pendiente:'yes'});
  app.list.children.find(row=>row.children[0].value==='familia').children[2].onclick();
  const saved=plain(app.editor.value());assert.equal(saved.familia,'no');
  app.editor.set(base,saved);
  assert.deepEqual(app.list.children.map(row=>row.children[0].value),['consola','pendiente']);
  app.list.children[0].children[2].onclick();app.add.onclick();
  const row=app.list.children.at(-1);row.children[0].value='consola';assert.equal(row.children[1].value,'yes');
  assert.equal(Object.hasOwn(app.editor.value(),'consola'),false,'Reactivated automatic value can follow its source again');
  row.children[1].value='no';row.children[1].onchange();assert.equal(app.editor.value().consola,'no');
});

test('New variable names are suggested from games and consoles without forcing a predefined name',()=>{
  const context={games:{8:{favorito:'yes',terminado:'no',saga:'Zelda'}},platforms:{2:{fabricante:'Nintendo',inventado:'false'}}};
  const known=vars.knownNames(context);
  assert.ok(known.includes('favorito')&&known.includes('fabricante')&&known.includes('saga'));
  assert.ok(!known.includes('terminado')&&!known.includes('inventado'));
  const app=editorApp(()=>known);app.editor.set({steam:'no'},{favorito:'yes'});app.add.onclick();
  const name=app.list.children.at(-1).children[0];assert.equal(name.attributes.list,app.suggestions.id);
  assert.ok(app.suggestions.children.some(option=>option.value==='fabricante'));
  assert.ok(!app.suggestions.children.some(option=>option.value==='favorito'));
  name.value='mi_variable_nueva';assert.equal(app.editor.value().mi_variable_nueva,'yes');
});
