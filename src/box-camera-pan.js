// Screen-plane movement shared by WebGL and the retained CSS box viewer.
(() => {
  function create({host,enabled,schedule,onStart=()=>{}}) {
    const offset={x:0,y:0},listeners=[];
    let drag=null,shifted=false;
    const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push([target,type,fn,options]);};
    function stop(event) {
      if(!drag||(event?.pointerId!=null&&event.pointerId!==drag.id))return;
      const previous=drag;drag=null;host.classList.remove('panning');
      if(host.hasPointerCapture?.(previous.id))host.releasePointerCapture(previous.id);
    }
    listen(host,'pointerdown',event=>{
      if(event.button!==1||drag||!enabled()||event.target?.closest?.('button,input,select,textarea,[role="menu"]'))return;
      event.preventDefault();event.stopPropagation();onStart();host.focus({preventScroll:true});
      const rect=host.getBoundingClientRect();
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,width:Math.max(1,rect.width),height:Math.max(1,rect.height)};
      host.setPointerCapture(event.pointerId);host.classList.add('panning');
    });
    listen(host,'pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      event.preventDefault();event.stopPropagation();
      if((event.buttons&4)===0){stop(event);return;}
      offset.x+=(event.clientX-drag.x)/drag.width;offset.y+=(event.clientY-drag.y)/drag.height;
      drag.x=event.clientX;drag.y=event.clientY;schedule();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(host,type,stop);
    for(const type of ['mousedown','auxclick'])listen(host,type,event=>{if(event.button===1&&enabled()){event.preventDefault();event.stopPropagation();}});
    if(globalThis.window?.addEventListener)listen(window,'blur',()=>stop());
    return {
      offset,stop,
      reset(){stop();offset.x=offset.y=0;schedule();},
      apply(camera){
        if(!shifted&&!offset.x&&!offset.y)return;
        // Shift the projection rather than the model or its lighting. This is
        // pure screen-plane movement, including when inspecting loose objects.
        camera.updateProjectionMatrix();
        const view=camera.view,scaleX=view?.enabled?view.fullWidth/view.width:1,scaleY=view?.enabled?view.fullHeight/view.height:1;
        camera.projectionMatrix.elements[8]-=2*offset.x*scaleX;
        camera.projectionMatrix.elements[9]+=2*offset.y*scaleY;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        shifted=!!(offset.x||offset.y);
      },
      dispose(){stop();listeners.forEach(([target,type,fn,options])=>target.removeEventListener(type,fn,options));},
    };
  }
  globalThis.OpenCabinetCameraPan={create};
})();
