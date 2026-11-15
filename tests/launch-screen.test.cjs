const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({console});vm.runInContext(fs.readFileSync('src/launch-screen.js','utf8'),context);
const api=context.OpenCabinetLaunchScreen;
test('Presentation preserves the selected edition and disc artwork, with cartridge and missing-art fallbacks',()=>{
  const game={discs:[{id:11},{id:12}],images:[{kind:'logo',path:'logo.webp'},
    {kind:'fanart_background',path:'background.webp'},{kind:'disc',path:'disc1.png'},
    {kind:'disc',path:'disc2.png'}]};
  const art=api.artwork(game,12);assert.equal(art.media,'disc2.png');assert.equal(art.spinning,true);
  assert.equal(art.logo,'logo.webp');assert.equal(art.background,'background.webp');
  assert.equal(api.artwork({images:[{kind:'cart_label',path:'label.webp'}]}).spinning,false);
  assert.equal(api.artwork({}).media,null);
});
test('Invalid saved settings fall back to bounded defaults',()=>{
  const settings=api.normalize({seconds:Infinity,timeoutSeconds:-1,color:'red;background:url(x)',enabled:'yes'});
  assert.equal(settings.seconds,8);assert.equal(settings.timeoutSeconds,5);assert.equal(settings.color,'#14161e');
  assert.equal(settings.enabled,true);assert.equal(api.normalize(null).mode,'auto');
});
test('Merged editions borrow missing logos and media independently without replacing their own artwork or title',async()=>{
  const game={title:'Selected edition',discs:[{id:11},{id:12}],images:[{kind:'logo',path:'own-logo.webp'}]};
  const other={title:'Another edition',discs:[{id:21},{id:22}],images:[{kind:'logo',path:'other-logo.webp'},
    {kind:'disc',path:'other-disc1.webp'},{kind:'disc',path:'other-disc2.webp'}]};
  let art=api.artwork(game,12,[other]);assert.equal(art.logo,'own-logo.webp');
  assert.equal(art.media,'other-disc2.webp');assert.equal(art.spinning,true);
  game.images=[{kind:'disc',path:'own-disc.webp'}];
  art=api.artwork(game,12,[other]);assert.equal(art.logo,'other-logo.webp');assert.equal(art.media,'own-disc.webp');
  art=api.artwork({images:[]},null,[{images:[{kind:'cart_label',path:'label.webp'}]}]);
  assert.equal(art.media,'label.webp');assert.equal(art.spinning,false);
  assert.equal(api.artwork({images:[]}).logo,null);
  let payload;
  const manager=api.create({getPreferences:()=>({}),invoke:async(_,args)=>{payload=args.presentation;return 'ticket';}});
  await manager.begin(game,12,[other]);assert.equal(payload.title,'Selected edition');assert.equal(payload.logo,'other-logo.webp');
});
test('Disabled presentations make no native call; failure never blocks a launch and stale dismissals cannot hide the next overlay',async()=>{
  let preferences={launchScreen:{enabled:false}},closed,counter=0;const calls=[],errors=[];
  const manager=api.create({getPreferences:()=>preferences,themeColor:()=>'#123456',
    listen:async(_,handler)=>{closed=handler;},onError:error=>errors.push(error),
    invoke:async(command,args)=>{calls.push([command,args]);return command==='show_launch_screen'?String(++counter):undefined;}});
  assert.equal(await manager.begin({title:'No overlay'}),null);assert.equal(calls.length,0);
  preferences={launchScreen:{mode:'fixed',seconds:3}};
  const id=await manager.begin({title:'First'});assert.equal(id,'1');assert.equal(manager.active,true);
  assert.equal(calls[0][1].presentation.color,'#123456');
  closed({payload:'1'});assert.equal(manager.active,false);
  assert.equal(await manager.begin({title:'Second'}),'2');
  closed({payload:'1'});assert.equal(manager.active,true);
  await manager.dismiss('1');assert.equal(manager.active,true);
  await manager.dismiss('2');assert.equal(manager.active,false);
  const broken=api.create({getPreferences:()=>({}),invoke:async()=>{throw Error('No webview');},onError:error=>errors.push(error)});
  assert.equal(await broken.begin({}),null);assert.equal(broken.active,false);assert.equal(errors.length,1);
});
test('The shared launch selects a region and disc before presenting artwork and dismisses the overlay on failure',async()=>{
  const order=[];let cancel=false,fail=false;
  const source={id:2,title:'Regional title',images:[{kind:'logo',path:'regional.webp'}],discs:[{id:21},{id:22}]};
  const selected={id:1,title:'Group title',regions:[{game:{id:1,images:[{kind:'disc',path:'fallback.webp'}]}},{game:source}]};
  const overlay={active:false,begin:async(game,discId,alternatives)=>{order.push('screen');assert.equal(game.title,'Regional title');
    assert.equal(alternatives.length,1);assert.equal(alternatives[0].images[0].path,'fallback.webp');
    assert.equal(game.images[0].path,'regional.webp');assert.equal(discId,22);return 'ticket';},
    dismiss:async id=>{assert.equal(id,'ticket');order.push('dismiss');}};
  const app=vm.createContext({console:{error(){}},allGames:[selected],launchingGames:new Set(),selectedGameId:1,
    launchPresentation:overlay,getLaunchPresentation:()=>overlay,displayGameImages:game=>game.images,
    getLibraryTools:()=>({diagnostic(){}}),updatePlatformStatistics(){},updatePlayStatus(){},showToast(){},applyPlayStatistics(){},
    window:{OpenCabinetRegions:{chooseRegion:async()=>{order.push('region');return cancel?null:2;}},
      OpenCabinetDiscs:{chooseDisc:async()=>{order.push('disc');return 22;}}},
    invoke:async(command,args)=>{if(command==='get_game_discs')return source.discs;
      order.push('launch');assert.equal(args.launchScreenId,'ticket');assert.equal(args.regionId,2);
      if(fail)throw Error('Missing executable');return {message:'OK'};}});
  const main=fs.readFileSync('src/main.js','utf8');
  vm.runInContext(main.slice(main.indexOf('async function launchGame('),main.indexOf('async function loadEmulators()')),app);
  await vm.runInContext('launchGame(1,"Group title")',app);assert.deepEqual(order,['region','disc','screen','launch']);
  order.length=0;cancel=true;await vm.runInContext('launchGame(1,"Group title")',app);assert.deepEqual(order,['region']);
  order.length=0;cancel=false;fail=true;await vm.runInContext('launchGame(1,"Group title")',app);
  assert.deepEqual(order,['region','disc','screen','launch','dismiss']);
  assert.equal(app.launchingGames.size,0);
});
