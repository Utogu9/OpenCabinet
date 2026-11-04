const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {matches,choose,ordered}=vm.runInThisContext('(function(module){'+fs.readFileSync('src/library-play.js','utf8')+';return module.exports;})({exports:{}})');
const games=[
  {id:1,title:'One',platform:'PS2',genre:'Racing',max_players:2,session_count:0,personal:{favorite:true,status:'planned'}},
  {id:2,title:'Two',platform:'PS2',genre:'Action; Adventure',max_players:1,session_count:2,personal:{status:'completed'}},
  {id:3,title:'Three',platform:'Wii',genre:'Racing',max_players:4,session_count:0,play_time_seconds:20,personal:{favorite:true}},
  {id:4,title:'Running',platform:'Wii',is_running:true},
];
const lists=[{id:'friends',name:'Friends',games:[3,1]}];
test('Random filters combine platform, manual list, status, players, genre, favorites and recorded play',()=>{
  assert.equal(matches(games[0],{platform:'PS2',playlist:'friends',status:'planned',players:2,genre:'RAC',favorite:true,unplayed:true},lists),true);
  for(const filter of [{platform:'Wii'},{playlist:'missing'},{status:'completed'},{players:3},{genre:'Action'}])assert.equal(matches(games[0],filter,lists),false);
  assert.equal(matches(games[1],{unplayed:true}),false);assert.equal(matches(games[2],{unplayed:true}),false);
  assert.equal(matches(games[3],{}),false);assert.equal(matches({id:5},{players:1}),false);
  assert.equal(matches({id:5},{status:'unplayed'}),true);
});
test('A reroll avoids the previous game, supports a single candidate and never returns a running game',()=>{
  assert.equal(choose(games,{platform:'PS2'},lists,1,()=>0).id,2);
  assert.equal(choose(games,{status:'planned'},lists,1,()=>0).id,1);
  assert.equal(choose(games,{platform:'missing'},lists),null);
  assert.equal(choose(games,{},lists,null,()=>.99999).id,3);
});
test('Playlist order overrides alphabetical order and ignores deleted games without changing input',()=>{
  const list={games:[3,99,1]};assert.deepEqual(ordered(games,list).map(game=>game.id),[3,1]);
  assert.deepEqual(list.games,[3,99,1]);assert.equal(ordered(games,null),games);
});
