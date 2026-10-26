const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const path=require('node:path');

function editor(prefix = 'platform') {
  const elements=new Map(), previews=[];
  const get=id=>{
    if(!elements.has(id)) {
      const classes=new Set();
      elements.set(id,{value:'',checked:false,open:true,children:[],classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},appendChild(item){this.children.push(item);},addEventListener(name,handler){this[name]=handler;}});
    }
    return elements.get(id);
  };
  const context=vm.createContext({document:{getElementById:get,createElement:()=>({})}});
  for(const file of ['game-box.js','box-settings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  let cleared=0;
  context.OpenCabinet3D.createViewer=()=>({update:(game,images,settings)=>previews.push(JSON.parse(JSON.stringify({game,images,settings}))),clear:()=>cleared++});
  const ui=context.OpenCabinetBoxSettings.createEditor({imageSource:path=>path,prefix});
  const field=name=>get(prefix+'-box-'+name);
  const change=(name,value)=>{field(name).value=value;field(name).onchange();};
  return {ui,field,get,change,previews,api:context.OpenCabinet3D,cleared:()=>cleared};
}

test('Box editor offers presets and keeps regional changes independent, inherited until enabled',()=>{
  const app=editor();app.ui.open(null,'New console',[]);
  assert.ok(app.field('model').children.some(option=>option.value==='dvd'));
  assert.equal(app.field('model').value,'');
  app.change('model','switch');
  app.change('region','europe');
  assert.equal(app.field('inherit').checked,true);
  assert.equal(app.field('model').disabled,true);
  app.field('inherit').checked=false;app.field('inherit').onchange();
  app.change('model','jewelPal');app.change('region','base');
  assert.equal(app.field('model').value,'switch');
  assert.equal(app.ui.getValue().regions.europe.model,'jewelPal');
  app.change('region','europe');app.field('inherit').checked=true;app.field('inherit').onchange();
  assert.equal(app.ui.getValue().regions.europe,undefined);
  assert.equal(app.previews.at(-1).game.rom_path,'Preview (Europe).rom');
});

test('Custom dimensions validate every region, color and spine can be overridden, reset restores automatic',()=>{
  const app=editor();app.ui.open(null,'PS2',[]);
  app.change('model','custom');app.change('width','155');app.change('height','200');app.change('depth','25');
  app.field('auto-color').checked=false;app.field('auto-color').onchange();app.change('color','#123456');app.change('spine','top');
  assert.equal(app.ui.getValue().base.width,155);assert.equal(app.ui.getValue().base.color,'#123456');
  app.change('region','japan');app.field('inherit').checked=false;app.field('inherit').onchange();app.change('depth','0');app.change('region','base');
  assert.throws(()=>app.ui.getValue(),/medidas/);
  app.change('region','japan');app.get('btn-reset-platform-box').onclick();
  assert.equal(app.ui.getValue().regions.japan,undefined);
  app.change('region','base');app.get('btn-reset-platform-box').onclick();
  assert.equal(app.ui.getValue().base.model,null);assert.equal(app.ui.getValue().base.color,null);
});

test('Box previews stay in drafts, release images on close, and disable fields while saving',()=>{
  const app=editor(), saved={base:{model:'dvd'},regions:{europe:{model:'jewelPal'}}};
  app.ui.open(saved,'PS2',[]);app.change('model','custom');app.change('width','180');
  assert.equal(saved.base.model,'dvd');
  app.ui.setBusy(true);assert.equal(app.field('width').disabled,true);assert.equal(app.field('region').disabled,true);
  app.ui.setBusy(false);assert.equal(app.field('width').disabled,false);
  app.ui.close();assert.ok(app.cleared()>0);
  app.ui.open(saved,'PS2',[]);assert.equal(app.field('model').value,'dvd');
  const draft=app.ui.getValue();draft.base.model='switch';assert.equal(app.ui.getValue().base.model,'dvd');
});

test('Unknown-console dimensions are rounded for manual editing and presets seed their own dimensions and color',()=>{
  const app=editor();app.ui.open(null,'New console',[]);
  assert.equal(Number(app.field('width').value),120.7);
  app.change('model','bluray');
  assert.equal(Number(app.field('height').value),171);
  assert.equal(app.field('color').value,'#164578');
  app.change('model','custom');assert.equal(app.ui.getValue().base.height,171);
});

test('A game box overrides platform and regional colors while unspecified values inherit the console',()=>{
  const app=editor('game');
  const defaults={base:{model:'dvd',color:'#101010'},regions:{europe:{color:'#0000ff'},japan:{model:'jewel'}}};
  const game={base:{color:'#ff0000'},regions:{japan:{color:'#00ff00'}}};
  const merged=app.api.resolveSettings(defaults,game);
  assert.equal(merged.base.model,'dvd');assert.equal(merged.regions.europe.color,'#ff0000');
  assert.equal(merged.regions.japan.model,'jewel');assert.equal(merged.regions.japan.color,'#00ff00');
  assert.equal(app.api.resolveSettings(defaults,null),defaults);assert.equal(defaults.regions.europe.color,'#0000ff');
  app.ui.open(game,'Sony PlayStation 2',[],defaults);
  assert.equal(app.field('color').value,'#ff0000');
  app.field('auto-color').checked=true;app.field('auto-color').onchange();
  assert.equal(app.field('color').value,'#101010');
  app.change('model','bluray');assert.equal(app.ui.getValue().base.model,'bluray');
  assert.equal(defaults.base.model,'dvd');
  const regionalOnly=app.api.resolveSettings({base:{model:'bluray'},regions:{}},{base:{},regions:{europe:{color:'#abcdef'}}});
  assert.equal(regionalOnly.regions.europe.model,'bluray');
  const noPlatform=app.api.resolveSettings(null,{base:{model:'switch'},regions:{europe:{color:'#abcdef'}}});
  assert.equal(noPlatform.regions.europe.model,'switch');
});
