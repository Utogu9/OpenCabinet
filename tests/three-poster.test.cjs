const {test}=require('node:test'),assert=require('node:assert/strict');

test('Poster grids preserve paired front/back UVs and unfold into one flat sheet with bounded geometry',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {createPosterSheet,posterGrid}=await import('../src/three-poster.js');
  assert.deepEqual(posterGrid(),{columns:2,rows:2});assert.deepEqual(posterGrid({posterColumns:3,posterRows:4}),{columns:3,rows:4});
  assert.deepEqual(posterGrid({posterColumns:9,posterRows:.5}),{columns:2,rows:2});
  for(const [columns,rows] of [[1,1],[2,2],[2,3],[3,2],[8,8]]){
    const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide});
    const paper=createPosterSheet(90,130,columns,rows,front,back);
    const folded=new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3());
    assert.ok(Math.abs(folded.x-90)<1e-6&&Math.abs(folded.y-130)<1e-6);
    const ray=new THREE.Raycaster(new THREE.Vector3(90*.37,-130*.41,50),new THREE.Vector3(0,0,-1));
    assert.equal(ray.intersectObjects(paper.meshes,false)[0].object.material,front,'the visible outside of every folded packet is printed front artwork');
    for(let i=0;i<paper.meshes.length;i+=3){
      const a=paper.meshes[i].geometry.attributes.uv,b=paper.meshes[i+1].geometry.attributes.uv;
      for(let j=0;j<a.count;j++){assert.ok(Math.abs(a.getX(j)+b.getX(j)-1)<1e-6);assert.equal(a.getY(j),b.getY(j));}
    }
    paper.pose(1);const flat=new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3());
    assert.ok(Math.abs(flat.x-90*columns)<1e-6&&Math.abs(flat.y-130*rows)<1e-6);
    assert.ok(flat.z<.05,'unfolded panels form one sheet without doubled white faces');
    ray.set(new THREE.Vector3(90*.37,-130*.41,-50),new THREE.Vector3(0,0,1));
    assert.equal(ray.intersectObjects(paper.meshes,false)[0].object.material,back,'unfolding retains the separate paper reverse');
    assert.equal(paper.meshes.length,columns*rows*3);
    paper.pose(.5);assert.ok(new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3()).y>=130);
    paper.pose(0);assert.ok(new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3()).distanceTo(folded)<1e-6);
    paper.dispose();front.dispose();back.dispose();
  }
});

test('Poster orientation, starting corner and opening order preserve artwork and the printed folded outside',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {createPosterSheet,posterLayout,posterTextureUV}=await import('../src/three-poster.js');
  assert.deepEqual(posterTextureUV(0,1,90),[0,0]);
  assert.deepEqual(posterTextureUV(0,1,270),[1,1]);
  for(const [columns,rows] of [[3,1],[1,3]]){
    const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide});
    const paper=createPosterSheet(100,100,columns,rows,front,back);
    paper.pose(.75);
    assert.ok(paper.meshes.at(-3).getWorldPosition(new THREE.Vector3()).z<-20,'an inner wrap unfolds from behind the preceding panel, not through its printed side');
    paper.dispose();front.dispose();back.dispose();
  }
  for(const rotation of [0,90,180,270])for(const corner of ['top_left','top_right','bottom_left','bottom_right'])for(const fold_order of ['rows_first','columns_first'])for(const first_side of ['front','back']){
    const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide}),width=110,height=175;
    const aspect=rotation%180?1/1.5:1.5,layout=posterLayout(aspect,width,height,3,2,fold_order),settings={rotation,corner,first_side,fold_order};
    const paper=createPosterSheet(width,height,3,2,front,back,layout,settings),dx=corner.endsWith('right')?-1:1,dy=corner.startsWith('bottom')?1:-1;
    const opposite=createPosterSheet(width,height,3,2,front,back,layout,{...settings,first_side:first_side==='back'?'front':'back'});
    assert.deepEqual(Array.from(paper.frontMesh.geometry.attributes.uv.array),Array.from(opposite.frontMesh.geometry.attributes.uv.array),'choosing the outside face never mirrors its printed text');opposite.dispose();
    const ray=new THREE.Raycaster(new THREE.Vector3(dx*width*.37,dy*height*.41,50),new THREE.Vector3(0,0,-1));
    assert.equal(ray.intersectObjects(paper.meshes,false)[0].object.material,front,'the chosen starting face stays outside '+JSON.stringify(settings));
    paper.pose(1);const bounds=new THREE.Box3().setFromObject(paper.group),size=bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x/size.y-aspect)<1e-5);
    assert.ok(dx>0?Math.abs(bounds.min.x)<1e-5:Math.abs(bounds.max.x)<1e-5,'the unfolded sheet extends toward the chosen side');
    assert.ok(dy<0?Math.abs(bounds.max.y)<1e-5:Math.abs(bounds.min.y)<1e-5,'the unfolded sheet extends vertically from its starting corner');
    for(const mesh of paper.meshes.filter((_,index)=>index%3<2)){const uv=mesh.geometry.attributes.uv;for(let i=0;i<uv.count;i++)assert.ok(uv.getX(i)>=-1e-6&&uv.getX(i)<=1+1e-6&&uv.getY(i)>=-1e-6&&uv.getY(i)<=1+1e-6);}
    paper.pose(.5);assert.ok(paper.meshes.every(mesh=>mesh.matrixWorld.elements.every(Number.isFinite)));paper.dispose();front.dispose();back.dispose();
  }
});

test('Poster fold panels follow booklet proportions without stretching the complete artwork',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {createPosterSheet,posterLayout}=await import('../src/three-poster.js');
  const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide});
  for(const [width,height] of [[120,180],[115,115],[85,165]])for(const aspect of [.7,1,1.5,2.3])for(const [columns,rows] of [[1,1],[2,2],[3,2],[8,8]]){
    const layout=posterLayout(aspect,width,height,columns,rows);
    assert.equal(layout.widths.length,columns,'the requested column count is never replaced');
    assert.equal(layout.heights.length,rows,'the requested row count is never replaced');
    assert.ok([...layout.widths,...layout.heights].every(value=>value>0),'each chosen part is real, not a zero-width flap');
    const paper=createPosterSheet(width,height,columns,rows,front,back,layout);
    const size=()=>new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3());
    const folded=size();
    assert.ok(folded.x<=width+1e-5&&folded.y<=height+1e-5,'the chosen folds fit beneath the booklet');
    assert.equal(paper.meshes.length,columns*rows*3,'each requested panel has both sides and paper edges');
    assert.ok(Math.abs(folded.x-layout.widths[0])<1e-5&&Math.abs(folded.y-layout.heights[0])<1e-5,'inner flaps never stick out beyond the outside panel');
    for(let i=0;i<paper.meshes.length;i+=3){
      const mesh=paper.meshes[i],uv=mesh.geometry.attributes.uv,points=mesh.geometry.attributes.position;
      const w=Math.abs(points.getX(1)-points.getX(0)),h=Math.abs(points.getY(2)-points.getY(0));
      const u=Math.abs(uv.getX(1)-uv.getX(0)),v=Math.abs(uv.getY(2)-uv.getY(0));
      assert.ok(Math.abs((w/u)/(h/v)-aspect)<1e-5,'unequal end flaps retain the original image aspect');
    }
    const ray=new THREE.Raycaster(new THREE.Vector3(folded.x*.37,-folded.y*.41,50),new THREE.Vector3(0,0,-1));
    assert.equal(ray.intersectObjects(paper.meshes,false)[0].object.material,front,'partial end flaps remain behind the printed outside');
    paper.pose(1);const flat=size();assert.ok(Math.abs(flat.x/flat.y-aspect)<1e-5,'the unfolded sheet retains the scan proportions');
    paper.pose(0);assert.ok(size().distanceTo(folded)<1e-5);paper.dispose();
  }
  const extreme=posterLayout(100,120,180,8,8);
  assert.ok(extreme.widths.length<=8&&extreme.heights.length<=8);
  assert.ok(Math.abs(extreme.widths.reduce((a,b)=>a+b,0)/extreme.heights.reduce((a,b)=>a+b,0)-100)<1e-5);
  front.dispose();back.dispose();
});

test('Wrap folds retain exact divisions and put real printed panels on both outside faces without hiding paper',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {createPosterSheet,posterLayout}=await import('../src/three-poster.js');
  const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide});
  for(const aspect of [2580/3200,1.5])for(const fold_order of ['rows_first','columns_first'])for(let columns=1;columns<=8;columns++)for(let rows=1;rows<=8;rows++){
    const layout=posterLayout(aspect,116.1925925925926,184,columns,rows,fold_order);
    assert.equal(layout.widths.length,columns);assert.equal(layout.heights.length,rows);
    assert.ok(layout.widths.every(w=>w>0)&&layout.heights.every(h=>h>0));
    const paper=createPosterSheet(116.1925925925926,184,columns,rows,front,back,layout,{fold_order});
    assert.ok(paper.meshes.every(mesh=>mesh.visible),'all paper surfaces remain present, including every reverse side');
    const layers=new Set(paper.meshes.filter((_,index)=>index%3===0).map(mesh=>Math.round(mesh.getWorldPosition(new THREE.Vector3()).z/.06)));
    assert.equal(layers.size,columns*rows,'every folded panel occupies its own physical layer, without coplanar overlaps');
    const ray=new THREE.Raycaster();
    const checkOutside=()=>{for(const z of [50,-50])for(let y=0;y<4;y++)for(let x=0;x<4;x++){
      ray.set(new THREE.Vector3(layout.widths[0]*(x+.5)/4,-layout.heights[0]*(y+.5)/4,z),new THREE.Vector3(0,0,z>0?-1:1));
      const expected=columns*rows===1&&z<0?back:front;
      assert.equal(ray.intersectObjects(paper.meshes,false)[0]?.object.material,expected,'folded outside stays printed at every sampled point: '+JSON.stringify({columns,rows,fold_order,x,y,z}));
    }};
    checkOutside();paper.pose(1);assert.ok(paper.meshes.every(mesh=>mesh.visible));
    paper.pose(0);checkOutside();
    paper.dispose();
  }
  front.dispose();back.dispose();
});
