const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('./helpers/localized-vm.cjs');
test('OST launches use the chosen disc and never open a loading screen, emulator or play session',async()=>{
 const calls=[],song={id:22,rom_path:'OST.cue',available:true};let chosen=22;
 const game={id:7,title:'Game',rom_path:'game.iso',discs:[{id:21,rom_path:'game.iso'},song]};
 const context=vm.createContext({allGames:[game],launchingGames:new Set(),selectedGameId:7,console,
  launchPresentation:null,sourceSeen:null,soundtrackPlayer:{stop(){calls.push('stop');}},
  OpenCabinetOST:{candidate:path=>/\.cue$/.test(path)},getSoundtracks:()=>({launch:async(source,path)=>{calls.push(['music',source.id,path]);return true;}}),
  invoke:async(command)=>{calls.push(command);return game.discs;},
  getLibraryTools:()=>null,updatePlatformStatistics(){},updatePlayStatus(){},showToast(){},applyPlayStatistics(){calls.push('stats');},
  getLaunchPresentation(){calls.push('screen');},window:{OpenCabinetDiscs:{chooseDisc:async()=>chosen}}});
 const main=fs.readFileSync('src/main.js','utf8');vm.runInContext(main.slice(main.indexOf('async function launchGame('),main.indexOf('async function loadEmulators()')),context);
 await vm.runInContext('launchGame(7,"Game")',context);assert.deepEqual(calls,['get_game_discs',['music',7,'OST.cue']]);assert.equal(context.launchingGames.size,0);
 calls.length=0;chosen=null;await vm.runInContext('launchGame(7,"Game")',context);assert.deepEqual(calls,['get_game_discs']);
});
test('Music format detection excludes standalone data images and duration labels remain stable',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync('src/soundtracks.js','utf8'),context);const api=context.OpenCabinetOST;
 for(const file of ['OST.CUE','Songs.m3u','Album.m3u8'])assert.equal(api.candidate(file),true);
 for(const file of ['Game.chd','Game.iso','Game.bin','song.mp3',''])assert.equal(api.candidate(file),false);
 assert.equal(api.time(125.9),'2:05');assert.equal(api.time(null),'--:--');assert.equal(api.time(-5),'0:00');
});
