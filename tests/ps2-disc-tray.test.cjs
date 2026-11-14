const {test}=require('node:test'),assert=require('node:assert/strict');
test('PS2 swing trays require exactly two sources in the selected emulated edition, never two regions',async()=>{
  const {ps2DiscSources}=await import('../src/three-ps2-disc-tray.js');
  const first={id:1,rom_path:'Game (Disc 1).iso'},second={id:2,rom_path:'Game (Disc 2).iso'},game={id:7,platform:'Sony PlayStation 2',discs:[first,second]};
  assert.deepEqual(ps2DiscSources(game),[first,second]);
  for(const platform of ['Sony PlayStation','Sega Dreamcast','Nintendo Wii','Sony PlayStation 3'])assert.deepEqual(ps2DiscSources({...game,platform}),[]);
  for(const discs of [[],[first],[first,first],[first,second,{rom_path:'Disc 3.iso'}]])assert.deepEqual(ps2DiscSources({...game,discs}),[]);
  assert.deepEqual(ps2DiscSources({...game,launch_directly:true}),[]);
  const usa={...game,id:8,discs:[first]},europe={...game,id:9,discs:[second]};
  assert.deepEqual(ps2DiscSources({...usa,default_region_id:8,regions:[{game:usa},{game:europe}]}),[]);
  assert.deepEqual(ps2DiscSources({...usa,default_region_id:9,regions:[{game:usa},{game:{...europe,discs:[first,second]}}]}),[first,second]);
});
