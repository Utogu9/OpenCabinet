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
  for(const rotation of [0,90,180,270])for(const corner of ['top_left','top_right','bottom_left','bottom_right'])for(const fold_order of ['rows_first','columns_first'])for(const first_side of ['front','back']){
    const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial({side:THREE.BackSide}),width=110,height=175;
    const aspect=rotation%180?1/1.5:1.5,layout=posterLayout(aspect,width,height,3,2),settings={rotation,corner,first_side,fold_order};
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
    const paper=createPosterSheet(width,height,columns,rows,front,back,layout);
    const size=()=>new THREE.Box3().setFromObject(paper.group).getSize(new THREE.Vector3());
    const folded=size();
    assert.ok(Math.abs(folded.x-width)<1e-5&&Math.abs(folded.y-height)<1e-5,'folded artwork matches the booklet footprint');
    assert.ok(paper.meshes.length<=8*8*3,'automatic extra folds keep bounded geometry');
    for(let i=0;i<paper.meshes.length;i+=3){
      const mesh=paper.meshes[i],uv=mesh.geometry.attributes.uv,points=mesh.geometry.attributes.position;
      const w=Math.abs(points.getX(1)-points.getX(0)),h=Math.abs(points.getY(2)-points.getY(0));
      const u=Math.abs(uv.getX(1)-uv.getX(0)),v=Math.abs(uv.getY(2)-uv.getY(0));
      assert.ok(Math.abs((w/u)/(h/v)-aspect)<1e-5,'unequal end flaps retain the original image aspect');
    }
    const ray=new THREE.Raycaster(new THREE.Vector3(width*.37,-height*.41,50),new THREE.Vector3(0,0,-1));
    assert.equal(ray.intersectObjects(paper.meshes,false)[0].object.material,front,'partial end flaps remain behind the printed outside');
    paper.pose(1);const flat=size();assert.ok(Math.abs(flat.x/flat.y-aspect)<1e-5,'the unfolded sheet retains the scan proportions');
    paper.pose(0);assert.ok(size().distanceTo(folded)<1e-5);paper.dispose();
  }
  const extreme=posterLayout(100,120,180,8,8);
  assert.ok(extreme.widths.length<=8&&extreme.heights.length<=8);
  assert.ok(Math.abs(extreme.widths.reduce((a,b)=>a+b,0)/extreme.heights.reduce((a,b)=>a+b,0)-100)<1e-5);
  front.dispose();back.dispose();
});
