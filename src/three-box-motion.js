// Three.js uses Y up. Pointer coordinates use Y down, unlike world space.
export function arcballPoint(event,rect) {
  const radius=Math.max(1,Math.min(rect.width,rect.height)*.48);
  let x=(event.clientX-rect.left-rect.width/2)/radius;
  let y=-(event.clientY-rect.top-rect.height/2)/radius;
  const length=x*x+y*y;if(length>1){const s=Math.sqrt(length);x/=s;y/=s;}
  return [x,y,Math.sqrt(Math.max(0,1-x*x-y*y))];
}
export const lidAngle=amount=>-Math.PI*Math.max(0,Math.min(1,amount));
