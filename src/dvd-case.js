// Articulated keep-case interior. Coordinates are millimetres in the closed case.
// The viewer owns transforms, lighting, image lifetime and the opening animation.
(() => {
  const openingChannel = profile => {
    const handheld = ['psp','switch','ds','dsPal','threeDs'].includes(profile.id);
    if (!handheld && !['dvd','bluray','gameCubeJapan'].includes(profile.id)) return null;
    return { length: handheld ? .60 : .45, width: .72, radius: 1.3,
      intrusion: Math.min(4.8, profile.depth * .30) };
  };
  const canOpen = profile => ["dvd", "bluray", "psp", "switch", "genesis", "jewel", "jewelPal", "longbox", "gameCubeJapan", "ds", "dsPal", "threeDs"].includes(profile?.id) && profile.spineFace === "left";
  // Both open halves must rest on the same outside plane. Reflect the front
  // acrylic onto the OUTSIDE of the rear shell, not onto the raised tray.
  const jewelPivot = profile => {
    const frontOutside=profile.depth/2+.12,rearOutside=-profile.depth/2;
    return { x:-profile.width/2+1.2, z:(frontOutside+rearOutside)/2 };
  };
  function motion(profile, amount) {
    const jewel=["jewel","jewelPal","longbox"].includes(profile.id);
    const angle = amount * (jewel?180:170), radians = angle * Math.PI / 180;
    const { width: w, height: h, depth: d } = profile;
    if (["jewel","jewelPal","longbox"].includes(profile.id)) {
      const {x:px,z:pz}=jewelPivot(profile);
      const points=[[-w/2,-d/2-.95],[w/2,-d/2-.95],[-w/2,d/2+.95],[w/2,d/2+.95]];
      for(const x of [px,w/2])for(const z of [-d/2+1,d/2+.95])points.push([
        px+(x-px)*Math.cos(radians)-(z-pz)*Math.sin(radians),pz+(x-px)*Math.sin(radians)+(z-pz)*Math.cos(radians)]);
      const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
      const x1=Math.min(...xs),x2=Math.max(...xs),z1=Math.min(...zs),z2=Math.max(...zs);
      return {angle,center:[(x1+x2)/2,(z1+z2)/2],diameter:Math.hypot(x2-x1,h+3,z2-z1),
        lid:s=>`translate3d(${px*s}px,0,${pz*s}px) rotateY(${-angle}deg) translate3d(${-px*s}px,0,${-pz*s}px)`,spine:()=>""};
    }
    const hinge = [-w / 2 - d * Math.sin(radians / 2), -d / 2 + d * Math.cos(radians / 2)];
    const points = [[-w/2,-d/2], [w/2,-d/2], [-w/2,0], [w/2,0]];
    for (const x of [0, w]) for (const z of [-d/2, 0]) {
      points.push([hinge[0] + x*Math.cos(radians) - z*Math.sin(radians),
        hinge[1] + x*Math.sin(radians) + z*Math.cos(radians)]);
    }
    const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), z1 = Math.min(...zs), z2 = Math.max(...zs);
    return { angle, center: [(x1+x2)/2, (z1+z2)/2], diameter: Math.hypot(x2-x1,h,z2-z1),
      lid: s => "translate3d(" + hinge[0]*s + "px,0," + hinge[1]*s + "px) rotateY(" + -angle + "deg) translate3d(" + w*s/2 + "px,0," + -d*s/2 + "px) ",
      spine: s => "translate3d(" + -w*s/2 + "px,0," + -d*s/2 + "px) rotateY(" + -angle/2 + "deg) translate3d(" + w*s/2 + "px,0," + d*s/2 + "px) " };
  }
  function build({ profile, game, images, addFace, removeFace = () => {}, imageSource, trackTexture, isCurrent, schedule }) {
    const { width: w, height: h, depth: d } = profile;
    const variant = profile.variant || (/^(sony)?playstation2$|^ps2$/.test(String(game.platform || "").toLowerCase().replace(/[^a-z0-9]/g, "")) ? "ps2" : profile.id);
    const ps2 = variant === "ps2", gamecube = variant === "gamecube";
    const handheld=['ds','threeDs'].includes(variant);
    const jewel = ["jewel", "jewelPal", "longbox"].includes(profile.id);
    const hookClips = profile.id === "dvd" || gamecube || handheld;
    const clear = (profile.translucency ?? 1) < 1, header = profile.headerHeight || 0;
    const shell = clear ? 'var(--box-shell)' : 'var(--box-material)';
    const base = -d/2 + 1.15;
    const channel = openingChannel(profile);
    const paperHoles=[];
    let manualLift = 0, manualFaces = [];
    const face = (name, width, height, x, y, z, normal = [0,0,1], orientation = "", part = "tray", text = "", curve = null) => {
      const element = document.createElement("div");
      element.className = "game-box-face game-box-dvd-" + name;
      element.textContent = text;
      if (/^(wall|wall-inner|wall-rim|hinge|hinge-cap|clip|disc-cradle|hub)/.test(name)) {
        element.style.backgroundColor = shell;
        element.style.backgroundImage = 'none';
      }
      if(profile.id==='longbox'&&/^(disc-cradle|hub)/.test(name))element.style.backgroundColor='var(--box-jewel-tray)';
      if (/^(wall|hinge|disc-cradle-wall|recycle-cut-edge)/.test(name)) element.style.backfaceVisibility = 'visible';
      if (curve) element.dataset.curve = "x";
      addFace({ element, width, height, normal, part, curve, interior: true,
        lighting: name === "disc" ? "disc" : name.includes("manual-cover") ? "paper" : "plastic",
        transform: s => "translate3d(" + x*s + "px," + y*s + "px," + (z - (name.includes("manual-clip") ? manualLift : 0))*s + "px) " + orientation });
      return element;
    };
    const solid = (name, width, height, depth, x, y, z, part = "tray") => {
      face(name, width,height,x,y,z+depth/2,[0,0,1],"",part);
      face(name, width,height,x,y,z-depth/2,[0,0,-1],"rotateY(180deg)",part);
      face(name, depth,height,x-width/2,y,z,[-1,0,0],"rotateY(-90deg)",part);
      face(name, depth,height,x+width/2,y,z,[1,0,0],"rotateY(90deg)",part);
      face(name, width,depth,x,y-height/2,z,[0,-1,0],"rotateX(90deg)",part);
      face(name, width,depth,x,y+height/2,z,[0,1,0],"rotateX(-90deg)",part);
    };
    // XY extrusions form the retaining hub; XZ extrusions form the actual curved
    // side profile of the manual clips, swept across their width along Y.
    const prism = (name, outline, depth, x, y, z, part = "tray", axis = "z") => {
      const area = outline.reduce((sum,p,i) => { const q = outline[(i+1)%outline.length]; return sum+p[0]*q[1]-q[0]*p[1]; },0);
      const points = area < 0 ? [...outline].reverse() : outline;
      const us = points.map(p=>p[0]), vs = points.map(p=>p[1]);
      const loU = Math.min(...us), hiU = Math.max(...us), loV = Math.min(...vs), hiV = Math.max(...vs);
      const width = hiU-loU, height = hiV-loV, cu = (hiU+loU)/2, cv = (hiV+loV)/2;
      for (const sign of [-1,1]) {
        const cap = axis === "z"
          ? face(name,width,height,x+cu,y+cv,z+sign*depth/2,[0,0,sign],sign<0?"rotateY(180deg)":"",part)
          : face(name,width,height,x+cu,y+sign*depth/2,z+cv,[0,sign,0],"rotateX("+-sign*90+"deg)",part);
        cap.style.clipPath = "polygon("+points.map(([u,v])=> {
          const px = (u-loU)/width*100, py = (v-loV)/height*100;
          return (axis==="z"&&sign<0?100-px:px)+"% "+(axis==="y"&&sign>0?100-py:py)+"%";
        }).join(",")+")";
      }
      points.forEach((p,i)=> {
        const q = points[(i+1)%points.length], du = q[0]-p[0], dv = q[1]-p[1], length = Math.hypot(du,dv);
        if (length<0.0001) return;
        const angle = Math.atan2(dv,du)*180/Math.PI, u = (p[0]+q[0])/2, v = (p[1]+q[1])/2;
        if (axis==="z") {
          face(name,length+0.2,depth,x+u,y+v,z,[dv/length,-du/length,0],"rotateZ("+angle+"deg) rotateX(90deg)",part);
        } else {
          face(name,length+0.2,depth,x+u,y,z+v,[dv/length,0,-du/length],"rotateY("+-angle+"deg) rotateX(180deg)",part);
        }
      });
    };
    // Distance from the outer edge and height above the inside of the lid.
    // The clip starts high, dips toward the manual and rises again at its tip.
    // Its plan view stays straight: the bend is in Z, never in Y.
    const hookPath = [[0,3.4],[4,3.4]];
    const hookCurve = (b,c,end) => {
      // Subdivide by geometric error instead of generating 20 CSS walls for
      // every curve, including its nearly straight regions. Error <= 0.025 mm.
      const midpoint = (a,b) => a.map((v,i)=>(v+b[i])/2);
      const sample = (a,b,c,d) => {
        const dx=d[0]-a[0], dy=d[1]-a[1], length=Math.hypot(dx,dy);
        const distance = p => Math.abs(dx*(a[1]-p[1])-(a[0]-p[0])*dy)/length;
        if (Math.max(distance(b),distance(c)) <= .025) { hookPath.push(d); return; }
        const ab=midpoint(a,b), bc=midpoint(b,c), cd=midpoint(c,d);
        const abc=midpoint(ab,bc), bcd=midpoint(bc,cd), middle=midpoint(abc,bcd);
        sample(a,ab,abc,middle); sample(middle,bcd,cd,d);
      };
      sample(hookPath.at(-1),b,c,end);
    };
    hookCurve([7,3.4],[8.5,1.2],[13,1.2]);
    hookCurve([18.2,1.2],[22,2.4],[22,4]);
    const hookStart=w/2-(gamecube||handheld ? 10 : 3.5);
    const hookEdges=hookPath.map((p,i)=> {
      const a=hookPath[Math.max(0,i-1)], b=hookPath[Math.min(hookPath.length-1,i+1)];
      const du=b[0]-a[0], dh=b[1]-a[1], length=Math.hypot(du,dh);
      return [-1,1].map(sign=>[hookStart-p[0]+sign*dh/length*0.4,-base-p[1]-sign*du/length*0.4]);
    });
    const hookProfile=[...hookEdges.map(p=>p[0]),...hookEdges.map(p=>p[1]).reverse()];
    // A small rounded rectangular cutout sits wholly under the tongue.
    const cutout = [];
    for (const [u,v,start] of [[7.6,-2.9,180],[20,-2.9,270],[20,2.9,0],[7.6,2.9,90]]) {
      for (let i=0;i<=4;i++) {
        const a=(start+i*90/4)*Math.PI/180;
        cutout.push([u+1.4*Math.cos(a),v+1.4*Math.sin(a)]);
      }
    }
    const manualSlots = hookClips ? [-h*0.415,h*0.415].map(y=>({y,
      hole:cutout.map(([u,v])=>[hookStart-u,y+v])})) : [];
    // Interior bases face into the cavity, so they cannot show through the cover.
    const panelWidth=w-(profile.id==='longbox'?12:jewel?14.4:2.4),panelX=jewel?6:0;
    const panelHeight=profile.id==='longbox'?h:h-2.4;
    const tray = face("interior", panelWidth,panelHeight,panelX,0,base+(jewel?4.5:0),[0,0,1]);
    const lid = face("interior lid-interior", panelWidth,h-2.4,panelX,0,-base,[0,0,-1],"rotateY(180deg)","lid");
    if (jewel) {
      tray.style.backgroundColor=profile.id==='longbox'?'var(--box-jewel-tray)':'var(--box-shell)';
      const radius=Math.min(60.5,w/2-4,h/2-1);
      tray.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+panelWidth+' '+panelHeight+'"><rect width="100%" height="100%" fill="white"/><circle cx="'+(panelWidth/2)+'" cy="'+(panelHeight/2+(profile.id==='longbox'?h*.14:0))+'" r="'+radius+'" fill="black"/></svg>')+'")';
      tray.style.maskMode='luminance';tray.style.maskSize='100% 100%';
      lid.style.backgroundColor="rgba(225,235,245,.09)";
    }
    if (clear) {
      for (const panel of profile.id==='longbox'?[lid]:[tray,lid]) panel.style.backgroundColor='var(--box-shell)';
    }
    let lidRecessShapes='';
    if(variant==='threeDs') {
      // Recess the repeated cells into the actual plates. Their floors sit
      // below the surface and the curved walls join them back to the shell.
      for(const [panel,part,sign] of [[lid,'lid',-1],[tray,'tray',1]]) {
        const cells=[];
        for(const y of [-h*.32,-h*.09,h*.14,h*.37])for(const x of [-w*.30,-w*.06,w*.18]) {
          if(part==='tray'&&y>0&&Math.abs(x)<30)continue;
          cells.push({x,y,width:19,height:18,r:2});
        }
        const surface=part==='lid'?-base:base;
        const shapes=cells.map(c=>'<rect x="'+((w-2.4)/2+(part==='lid'?-c.x:c.x)-c.width/2)+'" y="'+((h-2.4)/2+c.y-c.height/2)+'" width="'+c.width+'" height="'+c.height+'" rx="'+c.r+'" fill="black"/>').join('');
        if(part==='lid')lidRecessShapes=shapes;
        panel.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(w-2.4)+' '+(h-2.4)+'"><rect width="100%" height="100%" fill="white"/>'+shapes+'</svg>')+'")';
        panel.style.maskMode='luminance';panel.style.maskSize='100% 100%';
        for(const c of cells) {
          const z=surface-sign*.65;
          const floor=face('recess-floor',c.width,c.height,c.x,c.y,z,[0,0,sign],sign<0?'rotateY(180deg)':'',part);
          floor.style.borderRadius='calc(2px * var(--box-scale))';floor.dataset.recess='3ds';
          for(const sx of [-1,1])face('recess-wall',.65,c.height-c.r*2,c.x+sx*c.width/2,c.y,surface-sign*.325,[-sx,0,0],'rotateY('+(-sx*90)+'deg)',part);
          for(const sy of [-1,1])face('recess-wall',c.width-c.r*2,.65,c.x,c.y+sy*c.height/2,surface-sign*.325,[0,-sy,0],'rotateX('+(sy*90)+'deg)',part);
          for(const [cx,cy,start] of [[c.x-c.width/2+c.r,c.y-c.height/2+c.r,180],[c.x+c.width/2-c.r,c.y-c.height/2+c.r,270],[c.x+c.width/2-c.r,c.y+c.height/2-c.r,0],[c.x-c.width/2+c.r,c.y+c.height/2-c.r,90]]) {
            for(let i=0;i<4;i++) {
              const a=(start+(i+.5)*22.5)*Math.PI/180;
              face('recess-wall',2*c.r*Math.sin(Math.PI/16)+.03,.65,cx+c.r*Math.cos(a),cy+c.r*Math.sin(a),surface-sign*.325,
                [-Math.cos(a),-Math.sin(a),0],'rotateZ('+(a*180/Math.PI+90)+'deg) rotateX(-90deg)',part);
            }
          }
        }
      }
    }
    if (hookClips) {
      // The punched-out plastic exposes the unprinted side of the cover sheet.
      // This is a mask on the actual lid, with separate cut walls and paper behind.
      const holes = manualSlots.map(slot=>'<polygon points="'+slot.hole.map(([x,y])=>((w-2.4)/2-x)+','+((h-2.4)/2+y)).join(' ')+'" fill="black"/>').join("");
      // One closed polygon per arrow, reused for the actual hole and cut walls.
      // Flattened contours of the standard recycling glyph. The same contour
      // cuts the plate and forms the thickness of each of its three arrows.
      const recycleArrows = variant === "wiiu" ? [
        [[.0463,-.3339],[.0032,-.3179],[-.0351,-.2907],[-.0687,-.2572],[-.0927,-.2157],[-.3243,-.3115],[-.2987,-.3674],[-.254,-.4233],[-.2204,-.4537],[-.1821,-.4776],[-.1438,-.4936],[-.107,-.5],[-.099,-.5],[-.0895,-.4984],[.1741,-.4585],[.2029,-.4505],[.2284,-.4329],[.2716,-.3786],[.3019,-.3099],[.3115,-.2412],[.3099,-.2173],[.4089,-.2109],[.1853,-.0064],[-.0096,-.2396],[.0751,-.2332],[.0655,-.2812],[.0463,-.3339]],
        [[.4281,-.0911],[.4553,-.0559],[.4744,-.0176],[.4872,.0208],[.4952,.0559],[.4984,.0847],[.5,.1118],[.4968,.1597],[.4824,.1997],[.4696,.2188],[.4473,.2492],[.4201,.2875],[.3898,.3291],[.3115,.4345],[.254,.4712],[.1789,.4824],[.1054,.4728],[.0447,.4425],[-.008,.5288],[-.0735,.2284],[.2173,.1597],[.1709,.2348],[.2157,.2492],[.2684,.2588],[.2748,.23],[.2764,.2029],[.2668,.1342],[.2364,.0735]],
        [[-.222,.1725],[-.2588,.0911],[-.2955,.123],[-.3307,.1677],[-.2604,.2188],[-.1789,.2364],[-.1709,.2364],[-.1629,.2348],[-.1294,.4936],[-.1677,.4984],[-.2348,.4888],[-.3051,.4633],[-.3674,.4217],[-.4058,.3626],[-.4105,.3498],[-.4201,.3211],[-.4361,.2796],[-.4521,.2348],[-.4968,.1102],[-.4984,.0958],[-.5,.0783],[-.4872,.016],[-.4569,-.0463],[-.4121,-.0974],[-.3594,-.1294],[-.4042,-.222],[-.123,-.1198]]
      ].map(points=>points.map(([x,y])=>[x*w*.78,y*w*.78])) : [];
      const recycle = recycleArrows.map(points=>'<polygon points="'+points.map(([x,y])=>((w-2.4)/2-x)+','+((h-2.4)/2+y)).join(' ')+'" fill="black"/>').join('');
      paperHoles.push(...manualSlots.map(slot=>slot.hole),...recycleArrows);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(w-2.4)+' '+(h-2.4)+'"><rect width="100%" height="100%" fill="white"/>'+holes+recycle+lidRecessShapes+'</svg>';
      lid.style.maskImage = 'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
      lid.style.maskMode = "luminance";
      lid.style.maskSize = "100% 100%";
      for(const polygon of recycleArrows) polygon.forEach((p,i)=> {
        const q=polygon[(i+1)%polygon.length],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);
        if(length<.001)return;
        face('recycle-cut-edge',length+.02,1.75,(p[0]+q[0])/2,(p[1]+q[1])/2,-base+.275,
          [dy/length,-dx/length,0],'rotateZ('+Math.atan2(dy,dx)*180/Math.PI+'deg) rotateX(90deg)','lid');
        // An extruded lip follows the cutout on the inside, with a raised
        // shoulder and sloped sides rather than a flat painted silhouette.
        const nx=dy/length,ny=-dx/length;
        face('recycle-relief',length+.1,.8,(p[0]+q[0])/2+nx*.4,(p[1]+q[1])/2+ny*.4,-base-.6,
          [0,0,-1],'rotateY(180deg) rotateZ('+(-Math.atan2(dy,dx)*180/Math.PI)+'deg)','lid');
        face('recycle-relief-wall',length+.02,.6,(p[0]+q[0])/2+nx*.8,(p[1]+q[1])/2+ny*.8,-base-.3,
          [nx,ny,0],'rotateZ('+Math.atan2(dy,dx)*180/Math.PI+'deg) rotateX(90deg)','lid');
      });
      for (const slot of manualSlots) {
        slot.hole.forEach((p,i)=> {
          const q = slot.hole[(i+1)%slot.hole.length], dx = q[0]-p[0], dy = q[1]-p[1], length = Math.hypot(dx,dy);
          if (length<0.0001) return;
          face("manual-cut-edge",length+0.02,0.9,(p[0]+q[0])/2,(p[1]+q[1])/2,-base+0.45,
            [dy/length,-dx/length,0],"rotateZ("+Math.atan2(dy,dx)*180/Math.PI+"deg) rotateX(90deg)","lid");
        });
      }
    }
    if (!jewel) {
      face("hinge", d-0.4,h-4,-w/2+0.65,0,0,[1,0,0],"rotateY(90deg)","spine");
      if(!['wiiu','gamecube'].includes(variant)) {
        const line=Array.from({length:11},(_,i)=>{const a=-Math.PI/2+i*Math.PI/10;return[-w/2+.65+.30*Math.cos(a),.30*Math.sin(a)];});
        prism('hinge-ridge',line,h-9,0,0,0,'spine','y');
      }
    }
    // End bridges close the two ends of the flexible spine, without corrugation.
    for (const y of jewel?[]:[-h/2+1.8,h/2-1.8]) {
      solid("hinge-cap",3.2,2,d-0.8,-w/2+1.7,y,0,jewel?"tray":"spine");
    }
    if(jewel) {
      // The deep ribbed upper/lower rails belong to the opening cover. The
      // printed right and left spines stay attached to the rear paper tray.
      const {x:px,z:pz}=jewelPivot(profile),longbox=profile.id==='longbox';
      for(const sy of [-1,1]) {
        // Only the tall longbox has ribbed rails over the fixed grille. Jewel
        // cases use clear ears there, outside the column's top/bottom ends.
        const left=longbox?px:-w/2+12.5,right=w/2-.6;
        solid('wall jewel-lid-rail',right-left,1.1,d-1.5,(left+right)/2,sy*(h/2+.8),.5,'lid');
        const ring=face('hinge jewel-bearing',2.6,2.6,px,sy*(h/2+.16),pz,[0,sy,0],'rotateX('+(-sy*90)+'deg)','tray');
        ring.style.maskImage='radial-gradient(circle,transparent 0 32%,#000 35% 100%)';ring.style.borderRadius='50%';
        solid('hinge jewel-pin-root',2.1,1.1,1.8,px,sy*(h/2-.1),pz,'tray');
        // Pins are the ends of the opening cover; both use this exact axis.
        const pin=face('hinge jewel-pin',1.3,1.3,px,sy*(h/2+.9),pz,[0,sy,0],'rotateX('+(-sy*90)+'deg)','lid');
        pin.style.borderRadius='50%';pin.dataset.pivot='jewel';
      }
      if(longbox) {
        // A flat black insert reaches the right spine and both ends, without
        // raised upper/lower rails or a white gap behind the printed spine.
        const trayTop=base+4.5,trayBack=-d/2+.06;
        const trayDepth=trayTop-trayBack,trayCenter=(trayTop+trayBack)/2;
        face('jewel-tray-back',panelWidth,h,panelX,0,trayBack,[0,0,-1],'rotateY(180deg)');
        // Close below the tray floor, not above it: these skirts cover the
        // paper visible from oblique views without adding raised end rails.
        for(const sy of [-1,1])solid('jewel-tray-skirt',panelWidth,.6,trayDepth,panelX,sy*(h/2-.3),trayCenter);
        // Keep the right wall below the tray too, and inset from the printed
        // outer spine. A full-depth wall coplanar with that spine hides its art.
        solid('jewel-tray-side',1,h,trayDepth,w/2-.75,0,trayCenter);
        // The upright spine has a black inner lining, separate from the
        // downturned tray closure and inset behind the exterior printed face.
        const lining=face('jewel-spine-liner',d-Math.min(1.6,d*.2),h,w/2-.12,0,-Math.min(1.6,d*.2)/2,[-1,0,0],'rotateY(-90deg)');
        lining.style.backgroundColor='var(--box-jewel-tray)';lining.style.backgroundImage='none';
      } else face('wall-inner jewel-tray-wall',d-1.5,h-2,w/2-.7,0,-.3,[-1,0,0],'rotateY(-90deg)','tray');
    }
    for (const part of jewel ? [] : ["tray", "lid"]) {
      const sign = part === "lid" ? 1 : -1;
      const lidThickness=Math.min(1.6,d*.2);
      const thickness = jewel ? (part === "lid" ? lidThickness : d-lidThickness) : d/2-.15;
      const z = jewel ? (part === "lid" ? d/2-lidThickness/2 : -lidThickness/2) : sign*(d/4+.075);
      const radii = profile.id==='genesis' ? [.65,3.2,3.2,.65] : [variant==='ps3'?3.2:1.3,3.2,3.2,1.3];
      const rimZ=part==='lid' ? z-thickness/2 : z+thickness/2;
      // Close the narrow junction between the curved sidewalls and the inner
      // floor. The overlap is material, so the exterior print cannot leak
      // through subpixel cracks when the articulated halves are rotated.
      const joint=face('shell-joint',w,h,0,0,part==='lid'?-base-.04:base+.04,[0,0,-sign],sign>0?'rotateY(180deg)':'',part);
      joint.style.backgroundColor='var(--box-material)';joint.style.backgroundImage='none';
      joint.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'"><rect width="100%" height="100%" rx="3.2" fill="white"/><rect x="1.4" y="1.4" width="'+(w-2.8)+'" height="'+(h-2.8)+'" rx="1.2" fill="black"/></svg>')+'")';
      joint.style.maskMode='luminance';joint.style.maskSize='100% 100%';
      const openingInset=variant==='genesis'?2.6:0;
      for (const [x, direction, radius] of [[-w/2,-1,radii[0]],[w/2-openingInset,1,radii[1]]]) {
        const height=h-radius*2-(variant==='genesis'?7.6:0);
        if (direction === 1 && channel) {
          const length = h * channel.length;
          // The depression belongs to each shell half, including its inner
          // surface and rim. Its deepest point is at the closing seam.
          for (const sy of [-1,1]) {
            const end = (height-length)/2;
            solid('wall opening-end',.8,end,thickness,x-.4,sy*(length/2+end/2),z,part);
          }
          const low=z-thickness/2, high=z+thickness/2;
          // A square shoulder, then a parallel inset wall: every segment is
          // orthogonal in the XZ section, never a chamfer across the cavity.
          const shoulder=z-sign*thickness*.12;
          const contour=sign>0
            ? [[x-channel.intrusion,low],[x-channel.intrusion,shoulder],[x,shoulder],[x,high]]
            : [[x,low],[x,shoulder],[x-channel.intrusion,shoulder],[x-channel.intrusion,high]];
          const innerContour=contour.map(([xx,zz],i)=>[xx-.8,zz+(i===1||i===2?sign*.8:0)]);
          const outline=[...contour,...innerContour.slice().reverse()];
          prism('wall opening-channel',outline,length,0,0,0,part,'y');
          // Close the ends of the molded recess back to the straight sidewall.
          for (const sy of [-1,1]) {
            const ww=channel.intrusion+.8, cx=x-ww/2;
            const cap=face('wall opening-shoulder',ww,thickness,cx,sy*length/2,z,[0,sy,0],'rotateX('+(-sy*90)+'deg)',part);
            cap.style.clipPath='polygon('+[[x,low],[x,high],...innerContour.slice().reverse()].map(([xx,zz])=>
              ((xx-cx)/ww+.5)*100+'% '+(.5+(sy>0?-1:1)*(zz-z)/thickness)*100+'%').join(',')+')';
          }
          continue;
        }
        face("wall", thickness,height,x,0,z,[direction,0,0],"rotateY(" + direction*90 + "deg)",part);
        face("wall-inner", thickness,height,x-direction*.8,0,z,[-direction,0,0],"rotateY(" + -direction*90 + "deg)",part);
        face('wall-rim',.8,height,x-direction*.4,0,rimZ,[0,0,-sign],sign>0?'rotateY(180deg)':'',part);
      }
      const endInset=variant==='genesis'?3.8:0,edgeWidth=variant==='genesis'?w-6.45:w-4.5,edgeX=variant==='genesis'?-2.575:.95;
      for (const [y, direction] of [[-h/2+endInset,-1],[h/2-endInset,1]]) {
        face("wall", edgeWidth,thickness,edgeX,y,z,[0,direction,0],"rotateX(" + -direction*90 + "deg)",part);
        face("wall-inner",edgeWidth,thickness,edgeX,y-direction*.8,z,[0,-direction,0],"rotateX("+direction*90+"deg)",part);
        face('wall-rim',edgeWidth,.8,edgeX,y-direction*.4,rimZ,[0,0,-sign],sign>0?'rotateY(180deg)':'',part);
      }
      const corners = [[-w/2+radii[0],-h/2+endInset+radii[0],180], [w/2-openingInset-radii[1],-h/2+endInset+radii[1],270],
        [w/2-openingInset-radii[2],h/2-endInset-radii[2],0],[-w/2+radii[3],h/2-endInset-radii[3],90]];
      corners.forEach(([cx,cy,start], corner) => {
        // These tiny internal radii deviate by < 0.03 mm with six facets;
        // interpolated endpoint lighting keeps them smooth at high zoom too.
        const r = radii[corner], segments = 12, step = Math.PI/(2*segments);
        for (let i=0;i<segments;i++) {
          const degrees = start+(i+0.5)*90/segments, a = degrees*Math.PI/180;
          const normals = [-.5,.5].map(offset => [Math.cos(a+offset*step),Math.sin(a+offset*step),0]);
          face("wall",2*r*Math.sin(step/2)+0.08,thickness,cx+r*Math.cos(step/2)*Math.cos(a),
            cy+r*Math.cos(step/2)*Math.sin(a),z,[Math.cos(a),Math.sin(a),0],
            "rotateZ("+(degrees+90)+"deg) rotateX(90deg)",part,"",{ normals });
          const inner=r-.65;
          face('wall-inner',2*inner*Math.sin(step/2)+.06,thickness,cx+inner*Math.cos(step/2)*Math.cos(a),cy+inner*Math.cos(step/2)*Math.sin(a),z,
            [-Math.cos(a),-Math.sin(a),0],'rotateZ('+(degrees+90)+'deg) rotateX(-90deg)',part,'',{normals:normals.map(n=>n.map(v=>-v))});
        }
        const arc=Array.from({length:segments+1},(_,i)=>(start+i*90/segments)*Math.PI/180);
        const contour=[...arc.map(a=>[r+r*Math.cos(a),r+r*Math.sin(a)]),...arc.reverse().map(a=>[r+(r-.65)*Math.cos(a),r+(r-.65)*Math.sin(a)])];
        const cap=face('wall-rim',r*2,r*2,cx,cy,rimZ,[0,0,-sign],sign>0?'rotateY(180deg)':'',part);
        cap.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(r*2)+' '+(r*2)+'"><polygon fill="white" points="'+contour.map(([x,y])=>(sign>0?r*2-x:x)+','+y).join(' ')+'"/></svg>')+'")';
        cap.style.maskSize='100% 100%';
      });
    }
    // Closed 3D solids: constant width, curved XZ section, 0.8 mm wall thickness.
    // The low middle holds the manual; the raised free lip lets it slide under.
    if (hookClips) {
      for (const slot of manualSlots) {
        solid("clip manual-clip manual-root",4.5,10.4,3.4,hookStart-2.25,slot.y,-base-1.7,"lid");
        prism("clip manual-clip",hookProfile,10.4,0,slot.y,0,"lid","y");
      }
    } else if (!["switch","genesis"].includes(variant) && !jewel) {
      // Long open rectangular tongues, bent away from the lid in depth.
      // PSP uses one centred tongue; Blu-ray cases use a pair.
      for (const y of variant === "psp" ? [0] : [-h*.34,h*.34]) {
        solid("clip manual-frame-root",4,16,3,w/2-4.5,y,-base-1.5,"lid");
        for (const sy of [-1,1]) solid("clip manual-frame",23,2.2,.9,w/2-17,y+sy*6.5,-base-2.8,"lid");
        solid("clip manual-frame",2.4,15,.9,w/2-28,y,-base-2.8,"lid");
        // From the inner bar toward the outer edge: when the lid is open this
        // tongue points left, opposite to the DVD hooks and Switch retainers.
        prism('clip manual-pressure',[[w/2-28,-base-1.2],[w/2-26,-base-3],[w/2-14,-base-3.5],
          [w/2-12,-base-2.4],[w/2-12,-base-1.6],[w/2-15,-base-2.7],[w/2-26,-base-2.2],[w/2-28,-base-.4]],4,0,y,0,'lid','y');
      }
    } else if (jewel) {
      for(const sx of [-1,1])for(const sy of [-1,1])solid("clip jewel-manual-tab",6,3,1,sx*w*.30,sy*(h/2-3),d/2-2,"lid");
    }
    if (ps2) {
      // Four independent L-shaped corner catches, not a rectangular compartment.
      const cy = -h/2+27;
      for (const sx of [-1,1]) for (const sy of [-1,1]) {
        solid("clip memory-corner",14,1.8,3.2,sx*19,cy+sy*20,base+1.6);
        solid("clip memory-corner",1.8,11,3.2,sx*25,cy+sy*15.4,base+1.6);
      }
      const mark = face("memory-slot",52,40,0,cy,base+0.28);
      const symbol = document.createElement("span"); symbol.className = "game-box-ps-mark";
      const word = document.createElement("span"); word.className = "game-box-memory-caption"; word.textContent = "MEMORY CARD\nHOLDER";
      mark.appendChild(symbol); mark.appendChild(word);
    } else if (gamecube) {
      const y=-h/2+30;
      solid("clip gc-memory-top",48,2.5,3,0,y-17,base+1.5);
      for (const sx of [-1,1]) {
        solid("clip gc-memory-side",2.5,24,3,sx*23,y-4,base+1.5);
        solid("clip gc-memory-catch",6,3,1.2,sx*21,y+7,base+3.3);
      }
      solid("clip gc-memory-foot",36,4,3,0,y+24,base+1.5);
      face("brand gc-memory-caption",49,4,0,y-12.5,base+.25,[0,0,1],"","tray","Optional Memory Card Storage");
      const brand=face("brand gamecube-brand",70,16,0,h/2-16,base+.25);
      const symbol=document.createElement("span");symbol.className="game-box-gamecube-logo";brand.appendChild(symbol);
    } else if (["wii","wiiu"].includes(variant)) {
      const brand=face("brand "+variant+"-brand",variant==='wii'?56:44,variant==='wii'?17:11.5,0,-h/2+15,base+.25);
      const logo=document.createElement('span');logo.className='game-box-console-mark '+variant+'-mark';brand.appendChild(logo);
    }
    if (variant === "wiiu") {
      for (const y of [-h/2+15,h/2-15]) {
        // Rotated around the vertical spine: a U-shaped socket opens inward
        // (+X), with a clear central slot for the extra tray's pivot tongue.
        for (const sz of [-1,1]) solid("clip second-disc-hinge",4.6,8,1.1,-w/2+3,y,sz*1.25,'spine');
        solid("clip second-disc-hinge",1.1,8,3.6,-w/2+1.25,y,0,'spine');
      }
    }
    if(gamecube||handheld) {
      // Subtract only the opening's inward projection. Keeping the remaining
      // slabs as closed solids preserves the catches' roots and end sections.
      const securitySolid=(name,width,height,depth,x,y,z,part)=>{
        if(!channel){solid(name,width,height,depth,x,y,z,part);return;}
        const lo=[x-width/2,y-height/2,z-depth/2],hi=[x+width/2,y+height/2,z+depth/2];
        const shoulder=d/4+.075-(d/2-.15)*.12+.8;
        const cutLo=[w/2-channel.intrusion-.8-.06,-h*channel.length/2-.06,-shoulder-.06];
        const cutHi=[Infinity,h*channel.length/2+.06,shoulder+.06];
        const a=lo.map((v,i)=>Math.max(v,cutLo[i])),b=hi.map((v,i)=>Math.min(v,cutHi[i]));
        if(a.some((v,i)=>v>=b[i])){solid(name,width,height,depth,x,y,z,part);return;}
        const emit=(low,high)=>{
          const size=high.map((v,i)=>v-low[i]),center=high.map((v,i)=>(v+low[i])/2);
          if(size.every(v=>v>1e-6))solid(name,...size,...center,part);
        };
        // Each slice is disjoint from the next, and from the removed volume.
        const low=lo.slice(),high=hi.slice();
        for(let axis=0;axis<3;axis++) {
          const below=high.slice();below[axis]=a[axis];emit(low,below);
          const above=low.slice();above[axis]=b[axis];emit(above,high);
          low[axis]=a[axis];high[axis]=b[axis];
        }
      };
      for(const part of ['lid','tray']) {
        const sign=part==='lid'?-1:1,x=w/2-3.8,surface=part==='lid'?-base:base;
        // The security strip is divided from the usable panel by a continuous
        // narrow moulded rib, on both halves of the case.
        securitySolid('clip security-divider',.75,h-8,1.5,w/2-10,0,surface+sign*.75,part);
        // Moulded security channels flank the manual and cartridge/disc panel.
        for(const y of [-h*.33,0,h*.33]) {
          const z=surface+sign*2;
          for(const sy of [-1,1])securitySolid('clip security-channel',7,1.2,4,x-1.5,y+sy*6,z,part);
          securitySolid('clip security-channel',1.1,13,4,x+1.5,y,z,part);
          securitySolid('clip security-catch',4,5,1.2,x-2,y,surface+sign*4.3,part);
        }
      }
    }
    // A DVD is 120 mm across with a 15 mm centre hole. Keep the image full-size;
    // the mask cuts a real hole, rather than painting a fake opaque centre.
    if (!["switch","genesis"].includes(variant)&&!handheld) {
    // The fixed left column is not part of the CD tray's usable width.
    // Offset the complete medium assembly, including its hole, rim and hub.
    const centerX=jewel?6:0;
    const opticalFace=(name,width,height,x,y,...rest)=>face(name,width,height,x+centerX,y,...rest);
    const opticalSolid=(name,width,height,depth,x,y,...rest)=>solid(name,width,height,depth,x+centerX,y,...rest);
    const opticalPrism=(name,outline,depth,x,y,...rest)=>prism(name,outline,depth,x+centerX,y,...rest);
    const diameter = Math.min(gamecube ? 80 : variant === "psp" ? 60 : 120,w-10,h-(jewel?4:12)-header);
    const radius = diameter/2, cy = ps2 ? h*.095 : gamecube ? h*.115 : profile.id === "longbox" ? h*.14 : header/2;
    const discZ = base+2.1;
    opticalFace("disc-well",diameter+4,diameter+4,0,cy,base+0.2);
    if(profile.id==='longbox') {
      // Close the depth of the circular cutout too. A flat circular floor
      // alone exposes the white paper through finger gaps at oblique angles.
      const radius=Math.min(60.5,w/2-4,h/2-1),segments=96,step=2*Math.PI/segments;
      for(let i=0;i<segments;i++) {
        const a=(i+.5)*step;
        opticalFace('jewel-well-wall',2*radius*Math.sin(step/2)+.05,4.3,
          radius*Math.cos(step/2)*Math.cos(a),cy+radius*Math.cos(step/2)*Math.sin(a),base+2.35,
          [-Math.cos(a),-Math.sin(a),0],'rotateZ('+(a*180/Math.PI+90)+'deg) rotateX(-90deg)','tray','',
          {normals:[i*step,(i+1)*step].map(t=>[-Math.cos(t),-Math.sin(t),0])});
      }
    }
    // The well has a raised moulded annulus and real vertical walls. Two gaps
    // interrupt the annulus so fingers can reach underneath the edge of the disc.
    if(variant!=='psp') {
    const outer = radius+(jewel?2.6:5.5), inner = radius+.4, segments=96, step=Math.PI*2/segments;
    const gapCenters = variant==='wiiu' ? [-Math.PI*.70,-Math.PI*.30,Math.PI/2] : [-Math.PI*.75,-Math.PI*.25,Math.PI*.25,Math.PI*.75];
    const gapWidths = variant==='wiiu' ? [.15,.15,.27] : [.14,.14,.14,.14];
    const inGap=a=>gapCenters.some((center,i)=>Math.abs(Math.atan2(Math.sin(a-center),Math.cos(a-center)))<gapWidths[i]);
    const cutLeft=channel ? -w/2+6 : -Infinity, cutRight=channel ? w/2-channel.intrusion-1.3 : Infinity;
    const clipAt=(points,edge,keepGreater)=>{
      if (!Number.isFinite(edge)) return points;
      const result=[];
      points.forEach((p,i)=>{
        const q=points[(i+1)%points.length],a=keepGreater?p[0]>=edge:p[0]<=edge,b=keepGreater?q[0]>=edge:q[0]<=edge;
        if(a)result.push(p);
        if(a!==b)result.push([edge,p[1]+(q[1]-p[1])*(edge-p[0])/(q[0]-p[0])]);
      });
      return result;
    };
    const maskPaths=[]; let run=[];
    const addRun=()=>{
      if (!run.length) return;
      const contour=[...run.map(a=>[outer*Math.cos(a),outer*Math.sin(a)]),
        ...run.slice().reverse().map(a=>[inner*Math.cos(a),inner*Math.sin(a)])];
      const points=clipAt(clipAt(contour,cutLeft,true),cutRight,false);
      maskPaths.push('<polygon points="'+points.map(([x,y])=>[x+outer,y+outer].join(',')).join(' ')+'"/>'); run=[];
      points.forEach((p,i)=>{
        const q=points[(i+1)%points.length],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);
        if(length<.001)return;
        const onCut=[cutLeft,cutRight].some(edge=>Number.isFinite(edge)&&Math.abs(p[0]-edge)<1e-8&&Math.abs(q[0]-edge)<1e-8);
        const r1=Math.hypot(...p),r2=Math.hypot(...q),curved=!onCut&&Math.abs(r1-r2)<.001;
        const direction=(r1+r2)/2>(inner+outer)/2?1:-1;
        const curve=curved?{normals:[p,q].map(([x,y])=>{const r=Math.hypot(x,y);return[direction*x/r,direction*y/r,0];})}:null;
        opticalFace(curved?'disc-cradle-wall':'disc-cradle-end',length+.03,3.8,(p[0]+q[0])/2,cy+(p[1]+q[1])/2,base+2.1,
          [dy/length,-dx/length,0],'rotateZ('+(Math.atan2(dy,dx)*180/Math.PI)+'deg) rotateX(90deg)','tray','',curve);
      });
    };
    for (let i=0;i<segments;i++) {
      const a=(i+.5)*step;
      if (inGap(a)) {addRun();continue;}
      if (!run.length) run.push(i*step);run.push((i+1)*step);
    }
    addRun();
    const cradle=opticalFace("disc-cradle",outer*2,outer*2,0,cy,base+4);
    cradle.style.maskImage='url("data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+(outer*2)+' '+(outer*2)+'"><g fill="white">'+maskPaths.join('')+'</g></svg>')+'")';
    cradle.style.maskSize="100% 100%";
    const underside=opticalFace('disc-cradle underside',outer*2,outer*2,0,cy,base+.2,[0,0,-1],'rotateY(180deg)');
    underside.style.maskImage=cradle.style.maskImage;underside.style.maskSize='100% 100%';
    cradle.dataset.fingerGaps=String(gapCenters.length);
    if(channel){cradle.dataset.cutLeft=String(cutLeft);cradle.dataset.cutRight=String(cutRight);}
    }
    if (variant === "psp") {
      // UMD has a round upper shell and a clipped, straight lower edge.
      const outline=Array.from({length:33},(_,i)=>{const a=Math.PI+Math.PI*i/32;return[34*Math.cos(a),34*Math.sin(a)];});
      outline.push([34,14],[24,28],[-24,28],[-34,14]);
      opticalPrism('clip umd-cradle',outline.map(([x,y])=>[x*1.10,y*1.10]),2.4,0,cy,base+1.2);
      opticalPrism('umd-shell',outline,3,0,cy,discZ);
      const housing=opticalFace("umd-window",58,52,0,cy-3,discZ+1.6);
      housing.dataset.medium="umd";
      // Small opposing catches secure the housing, not a DVD push hub.
      for(const sx of [-1,1])opticalSolid('clip umd-catch',4,9,4,sx*34,cy+10,base+3);
      opticalSolid('clip umd-bottom-catch',18,3,3,0,cy+32,base+2);
    }
    const disc = opticalFace("disc",diameter,diameter,0,cy,variant==='psp'?discZ+1.7:discZ);
    if (variant === "psp") disc.className += " umd-disc";
    disc.dataset.image = "missing";
    const artwork = images.find(image => image.kind === "disc");
    const title = document.createElement("span"); title.className = "game-box-disc-title";
    title.textContent = game.title; disc.appendChild(title);
    if (artwork) {
      const image = document.createElement("img");
      image.alt = ""; image.draggable = false; image.decoding = "async"; image.loading = "eager";
      image.onload = () => {
        if (!isCurrent()) return;
        image.classList.add("loaded"); title.hidden = true; disc.dataset.image = "loaded"; schedule();
      };
      image.onerror = () => {
        if (!isCurrent()) return;
        image.removeAttribute("src"); disc.dataset.image = "missing";
      };
      trackTexture(image); disc.appendChild(image); image.src = imageSource(artwork.path);
    }
    opticalFace("disc underside",diameter,diameter,0,cy,discZ-1.1,[0,0,-1],"rotateY(180deg)");
    for (let i=0;i<48;i++) {
      const a = (i+0.5)*Math.PI/24, degrees = (i+0.5)*7.5;
      opticalFace("disc-edge",2*radius*Math.sin(Math.PI/48)+0.06,1.1,radius*Math.cos(a),cy+radius*Math.sin(a),discZ-0.55,
        [Math.cos(a),Math.sin(a),0],"rotateZ("+(degrees+90)+"deg) rotateX(90deg)");
    }
    if (ps2 || ['ps3','ps4'].includes(variant)) {
      // Three open spring arms surround a triangular push-release centre.
      // The supporting plate sits below the disc, visible through its centre hole.
      opticalFace("hub-base",21,21,0,cy,discZ-1.3);
      const arm = [[-2.5,1.3],[-2.5,6.7],[-2.1,7.2],[2.1,7.2],[2.5,6.7],[2.5,1.3],[1.5,1.3],[1.5,6.1],[-1.5,6.1],[-1.5,1.3]];
      for (const degrees of [0,120,240]) {
        const a = degrees*Math.PI/180;
        opticalPrism("hub-arm",arm.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]),0.85,0,cy,discZ+0.5);
      }
      opticalPrism("hub-button",[[-3.3,2],[-3.8,1.4],[-0.65,-3.7],[0,-4],[0.65,-3.7],[3.8,1.4],[3.3,2]],1.2,0,cy,discZ+0.7);
      opticalFace("hub-label",5,2.1,0,cy+0.5,discZ+1.32,[0,0,1],"","tray","PUSH");
    } else if (variant !== "psp") {
      opticalFace("hub",13.8,13.8,0,cy,discZ+0.45,[0,0,1],"","tray",jewel||gamecube||['xbox','xbox360'].includes(variant)?'':'PUSH');
      for (let i=0;i<12;i++) {
        const a = i*Math.PI/6;
        opticalSolid("hub-finger",1.1,2.5,0.8,5.5*Math.cos(a),cy+5.5*Math.sin(a),discZ+0.2);
      }
    }
    }
    function mediumArt(element, kind, fallbackKind = null) {
      const artwork=images.find(image=>image.kind===kind) || images.find(image=>image.kind===fallbackKind);
      if (!artwork) return;
      const image=document.createElement("img"); image.alt="";image.draggable=false;image.decoding="async";
      image.onload=()=>{if(isCurrent()){image.classList.add("loaded");schedule();}};
      image.onerror=()=>{if(isCurrent())image.removeAttribute("src");};
      element.appendChild(image);trackTexture(image);image.src=imageSource(artwork.path);
    }
    if(handheld) {
      const y=h/2-32,z=base+2.4,white=variant==='threeDs';
      // A DS card is wider than Switch's. The three-sided holder leaves the
      // right-hand finger notch clear and grips the cartridge at its corners.
      solid('clip ds-pocket',3,39,4,-19,y,base+2);
      for(const sy of [-1,1]) {
        solid('clip ds-pocket',40,3,4,0,y+sy*19,base+2);
        solid('clip ds-pocket',3,9,4,19,y+sy*14,base+2);
        for(const sx of [-1,1])solid('clip ds-card-catch',5,3,1.2,sx*16,y+sy*13,base+4.2);
      }
      solid('cartridge ds-card',33,35,3.6,0,y,z);
      if(white)solid('cartridge ds-card-key',4,5,3.6,17.5,y-15,z);
      const label=face('cartridge-label ds-label',29,25,0,y-2,z+1.85);
      label.dataset.medium=white?'3ds-card':'ds-card';label.textContent=game.title;mediumArt(label,'cart_label','cart_front');
      const brand=face('brand handheld-brand',68,8.5,w/2-16,y-3,base+.3,[0,0,1],'rotateZ(-90deg)');
      const mark=document.createElement('span');mark.className='game-box-handheld-logo '+(white?'three-ds':'ds');brand.appendChild(mark);
    }
    if (variant === "switch") {
      const y=h*.32, z=base+2;
      // The left panel is intentionally bare. Both literature tabs belong to
      // the cartridge panel, above the small game-card pocket.
      for (const yy of [-h*.30,h*.03]) {
        const x=-w/2+13;
        solid("clip switch-tab",3,15,2,x-6,yy,base+1);
        for (const sy of [-1,1]) solid("clip switch-tab",13,2,1,x,yy+sy*6.5,base+2.3);
        solid("clip switch-tab",2,15,1,x+6,yy,base+2.3);
        prism('clip switch-pressure',[[x-6,base+.4],[x-3,base+2.8],[x+5,base+3.4],[x+7,base+2],
          [x+7,base+1.2],[x+4,base+2.6],[x-3,base+2],[x-6,base-.4]],4,0,yy,0,'tray','y');
      }
      solid('clip card-pocket',3.4,35,3.5,-13.5,y,base+1.75);
      for(const sy of [-1,1])solid('clip card-pocket',3.4,9,3.5,13.5,y+sy*13,base+1.75);
      solid('clip card-pocket',28,3,3.5,0,y-17,base+1.75);
      solid("clip card-pocket",28,3,3.5,0,y+17,base+1.75);
      solid("cartridge switch-card",22,31,2,0,y,z);
      for (let i=0;i<8;i++) face("card-contact",1.3,5,-7+i*2,y+11,z+1.08);
      const label=face("cartridge-label switch-label",19,20,0,y-3,z+1.1);
      label.textContent=game.title;mediumArt(label,"cart_label","cart_front");
      label.dataset.medium="switch-card";
    }
    if (variant === "genesis") {
      // A horizontal cartridge sits turned 90 degrees inside the taller box.
      const cartW=Math.min(110,h-28),cartH=Math.min(70,w-40),z=base+7;
      const outline=[[-cartW/2+5,-cartH/2],[cartW/2-5,-cartH/2],[cartW/2,-cartH/2+5],
        [cartW/2,cartH/2-3],[cartW/2-3,cartH/2],[-cartW/2+3,cartH/2],[-cartW/2,cartH/2-3],[-cartW/2,-cartH/2+5]];
      prism("cartridge genesis-cart",outline.map(([x,y])=>[-y,x]),12,0,0,z);
      for (const sx of [-1,1]) {
        solid("clip genesis-cradle",1.4,cartW-12,13,sx*(cartH/2+2),0,base+6.5);
        solid("clip genesis-cradle",cartH+5,1.4,13,0,sx*(cartW/2+2),base+6.5);
      }
      const art=images.some(image=>image.kind==="cart_label");
      const label=face("cartridge-label genesis-label",art?cartW-18:cartW,art?cartH-18:cartH,0,0,z+6.1,[0,0,1],"rotateZ(90deg)");
      label.dataset.medium="genesis-cartridge";label.textContent=game.title;mediumArt(label,"cart_label","cart_front");
      const sega=face("brand sega-brand",50,14,-w/2+15,0,base+.3,[0,0,1],"rotateZ(90deg)");
      const mark=document.createElement('span');mark.className='game-box-sega-mark';sega.appendChild(mark);
      for (const sy of [-1,1]) {
        // Minimal retaining tongues at the top and bottom, with four side stops.
        solid("clip genesis-manual-tab",14,4,1.8,0,sy*(h/2-7),-base-1.8,"lid");
        solid("clip genesis-manual-tab",14,7,.8,0,sy*(h/2-9),-base-3,"lid");
        for (const sx of [-1,1]) solid("clip genesis-manual-stop",2,14,2.5,sx*(w/2-6),sy*h*.25,-base-1.25,"lid");
      }
    }
    function setManual(manual) {
      manualFaces.forEach(removeFace); manualFaces = []; manualLift = 0;
      if ((!ps2 && !jewel) || !manual) return null;
      const size = globalThis.OpenCabinetManualPDF.dimensions(profile, manual);
      const { width, height, thickness, x, y, sheets } = size;
      if(jewel) {
        // Its printed outer face is the very cover shown through the clear lid.
        // The inside sheet and edges form a thin booklet, not a second insert.
        const inner=face('manual-cover jewel-booklet-inside manual-front',width,height,x,y,d/2-thickness-.3,[0,0,-1],'rotateY(180deg)','lid');
        inner.dataset.manualBooklet='true';inner.title=globalThis.OpenCabinetI18n.t("msg.6a6ee3c2b2");manualFaces.push(inner);
        for(const sign of [-1,1]){
          const edge=face('manual-pages manual-end',width,thickness,x,y+sign*height/2,d/2-.3-thickness/2,[0,sign,0],'rotateX('+(-sign*90)+'deg)','lid');
          edge.dataset.manualBooklet='true';manualFaces.push(edge);
        }
        const edge=face('manual-pages manual-fore-edge',thickness,height,x+width/2,y,d/2-.3-thickness/2,[1,0,0],'rotateY(90deg)','lid');
        edge.dataset.manualBooklet='true';manualFaces.push(edge);
        return size;
      }
      manualLift = Math.max(0, thickness - 0.55);
      const frontZ = -base - 0.18 - thickness, backZ = -base - 0.18;
      const bookFace = (...args) => {
        const element = face(...args); manualFaces.push(element);
        if (!args[0].includes("manual-foot")) element.dataset.manualBooklet = "true";
        element.dataset.manualPages = String(manual.pageCount);
        element.style.setProperty("--manual-page-step", String(thickness / Math.min(32, sheets)));
        return element;
      };
      const front = bookFace("manual-cover manual-front", width,height,x,y,frontZ,[0,0,-1],"rotateY(180deg)","lid");
      front.title = globalThis.OpenCabinetI18n.t("msg.6a6ee3c2b2");
      bookFace("manual-cover manual-back", width,height,x,y,backZ,[0,0,1],"","lid");
      // Only the visible front is rasterized; the back rests against the lid.
      front.appendChild(manual.front);
      bookFace("manual-pages manual-fore-edge",thickness,height,x-width/2,y,(frontZ+backZ)/2,[-1,0,0],"rotateY(-90deg)","lid");
      bookFace("manual-binding",thickness,height,x+width/2,y,(frontZ+backZ)/2,[1,0,0],"rotateY(90deg)","lid");
      for (const sign of [-1,1]) {
        bookFace("manual-pages manual-end",width,thickness,x,y+sign*height/2,(frontZ+backZ)/2,[0,sign,0],"rotateX("+-sign*90+"deg)","lid");
      }
      // Lift the retaining tongues over the paper; extend their feet to the lid.
      if (manualLift > 0) {
        for (const slot of manualSlots) {
          // Record these six faces with the booklet so replacement removes them.
          const capture = (name,ww,hh,xx,yy,zz,n,o) => bookFace(name,ww,hh,xx,yy,zz,n,o,"lid");
          const xx=hookStart-2.25, yy=slot.y, zz=-base-manualLift/2;
          capture("clip manual-foot",4.5,10.4,xx,yy,zz+manualLift/2,[0,0,1],"");
          capture("clip manual-foot",4.5,10.4,xx,yy,zz-manualLift/2,[0,0,-1],"rotateY(180deg)");
          capture("clip manual-foot",manualLift,10.4,xx-2.25,yy,zz,[-1,0,0],"rotateY(-90deg)");
          capture("clip manual-foot",manualLift,10.4,xx+2.25,yy,zz,[1,0,0],"rotateY(90deg)");
          capture("clip manual-foot",4.5,manualLift,xx,yy-5.2,zz,[0,-1,0],"rotateX(90deg)");
          capture("clip manual-foot",4.5,manualLift,xx,yy+5.2,zz,[0,1,0],"rotateX(-90deg)");
        }
      }
      return size;
    }
    return { variant, setManual, paperHoles };
  }
  globalThis.OpenCabinetDVD = { canOpen, motion, build, jewelPivot, openingChannel };
})();
