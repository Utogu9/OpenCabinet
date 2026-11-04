const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Playlist editing, random filtering and action arguments work in the browser',{timeout:60000},async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const base=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="actions"></div>');return;}
    const file=path.resolve(base,'.'+name);if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/svg+xml');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const messages=JSON.parse(fs.readFileSync('src/locales/en-US.json','utf8')).messages;
  await page.evaluate(messages=>{window.OpenCabinetI18n={t:(key,...args)=>(messages[key]||key).replace(/\{(\d+)\}/g,(_,n)=>args[n]??'')};},messages);
  for(const file of ['ui-icons.js','library-play.js'])await page.addScriptTag({url:'/src/'+file});
  await page.evaluate(async()=>{
    window.db=[{id:'friends',name:'Friends',games:[1,2]}];window.selected=null;window.launches=[];
    window.games=[{id:1,title:'One',platform:'PS2',max_players:2},{id:2,title:'Two',platform:'PS2',session_count:3},{id:3,title:'Three',platform:'Wii',max_players:4,personal:{favorite:true}}];
    window.app=OpenCabinetPlay.create({document,getGames:()=>games,confirm:async()=>true,onPick:game=>selected=game.id,launch:async game=>launches.push(game.id),invoke:async(name,args)=>{
      if(name==='get_playlists')return structuredClone(db);
      if(name==='save_playlist'){const value=structuredClone(args.playlist);db=db.filter(list=>list.id!==value.id);db.push(value);return structuredClone(db);}
      if(name==='get_game_launch_actions')return {before:[],after:[]};
      if(name==='choose_launch_action')return '/tools/before';throw Error(name);
    }});
    await app.playlists();
  });
  await page.getByRole('button',{name:'Three · Wii',exact:true}).click();
  await page.getByRole('button',{name:'Move Three up',exact:true}).click();
  await page.getByRole('button',{name:'Move Three up',exact:true}).click();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.waitForFunction(()=>db[0].games[0]===3);
  assert.deepEqual(await page.evaluate(()=>db[0].games),[3,1,2]);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{void app.random();});
  await page.getByLabel('Minimum players',{exact:true}).fill('4');await page.getByLabel('Minimum players',{exact:true}).dispatchEvent('change');
  await page.getByRole('button',{name:'Show in library',exact:true}).click();
  assert.equal(await page.evaluate(()=>selected),3);assert.deepEqual(await page.evaluate(()=>launches),[]);
  await page.evaluate(async()=>{window.editor=await app.actionEditor(document.getElementById('actions'),1);});
  await page.getByRole('button',{name:'Add action',exact:true}).first().click();
  await page.getByRole('button',{name:'Browse…',exact:true}).click();
  await page.getByLabel('Arguments (one per line)',{exact:true}).fill('argument with spaces\n%ROM%');
  const action=await page.evaluate(()=>editor.value().before[0]);assert.equal(action.executable,'/tools/before');assert.deepEqual(action.arguments,['argument with spaces','%ROM%']);assert.equal(action.wait,true);
  await page.addStyleTag({url:'/src/sofa-mode.css'});await page.addScriptTag({url:'/src/sofa-mode.js'});
  await page.evaluate(async()=>{
    localStorage.setItem('opencabinet.sofaView','cover');
    window.sofa=OpenCabinetSofa.create({document,window,games:()=>games,platforms:()=>[],getPlaylists:()=>db,
      chooseRandom:initial=>app.random({...initial,pickOnly:true}),images:()=>[],sourceGame:game=>game,imageSource:path=>path,
      sortGames:items=>[...items].sort((a,b)=>a.title.localeCompare(b.title)),formatPlayTime:()=>'',platformDetails:async()=>({images:[]}),
      availability:async()=>({available:true}),launch:async game=>launches.push(game.id),onError:error=>{throw error;}});
    await sofa.open();
  });
  await page.locator('.sofa-playlist').selectOption('friends');
  await page.waitForSelector('.sofa-card.is-selected[data-game-id="3"]');
  await page.keyboard.press('ArrowRight');await page.waitForSelector('.sofa-card.is-selected[data-game-id="1"]');
  await page.locator('.sofa-random').click();
  await page.getByLabel('Minimum players',{exact:true}).fill('4');await page.getByLabel('Minimum players',{exact:true}).dispatchEvent('change');
  await page.getByRole('button',{name:'Choose this game',exact:true}).click();
  await page.waitForSelector('.sofa-card.is-selected[data-game-id="3"]');
  assert.equal(await page.evaluate(()=>sofa.active),true);assert.deepEqual(await page.evaluate(()=>launches),[]);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
});
