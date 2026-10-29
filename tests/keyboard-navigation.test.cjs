const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
function environment() {
 const listeners={},observers=[];let document;
 class Element {
  constructor(tag='div',id='',classes=[]) {this.tag=tag;this.id=id;this.children=[];this.parent=null;this.attributes={};this.dataset={};this.disabled=false;this.tabIndex=['button','input','select'].includes(tag)?0:-1;this.open=false;
   const set=new Set(classes);this.classList={contains:n=>set.has(n),add:n=>set.add(n),remove:n=>set.delete(n),toggle:n=>{if(set.has(n)){set.delete(n);return false;}set.add(n);return true;}};
  }
  append(...items){items.forEach(item=>{item.parent=this;this.children.push(item);});}
  get isConnected(){return this===document.body||!!this.parent?.isConnected;}
  matches(selector){
   return selector.split(',').some(part=>{
    part=part.trim();
    if(part===':disabled')return this.disabled;
    if(part.includes(':not(.hidden)')){if(this.classList.contains('hidden'))return false;part=part.replace(':not(.hidden)','');}
    const tag=/^[\w-]+/.exec(part)?.[0];if(tag&&tag!==this.tag)return false;
    const id=/#([\w-]+)/.exec(part)?.[1];if(id&&id!==this.id)return false;
    for(const [,name]of part.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name))return false;
    for(const [,name,value]of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
     const actual=name==='tabindex'?String(this.tabIndex):name==='open'?(this.open?'':undefined):this.attributes[name];
     if(actual===undefined||(value!==undefined&&actual!==value))return false;
    }return true;
   });
  }
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  contains(element){return element===this||this.children.some(child=>child.contains(element));}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  getClientRects(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='tabindex')this.tabIndex=Number(value);}
  getAttribute(key){return this.attributes[key]??null;}
  hasAttribute(key){return this.attributes[key]!==undefined;}
  addEventListener(type,callback){(this.events??={})[type]=callback;}
  focus(options){this.focusOptions=options;document.activeElement=this;listeners.focusin?.({target:this});}
  click(){this.events?.click?.({stopPropagation(){}});this.onClick?.();}
  scrollIntoView(){}
  select(){this.textSelected=true;}
  dispatchEvent(event){this.dispatched=event;}
  showModal(){this.open=true;}
 }
 document={addEventListener:(type,callback)=>{listeners[type]=callback;},getElementById:id=>document.body.querySelectorAll('#'+id)[0]||null,
  querySelectorAll:selector=>document.body.querySelectorAll(selector),querySelector:selector=>document.querySelectorAll(selector)[0]||null};
 document.body=new Element('body');document.activeElement=document.body;
 const add=(tag,id,classes=[],parent=document.body)=>{const e=new Element(tag,id,classes);parent.append(e);return e;};
 const search=add('input','search-input'),importButton=add('button','btn-scan-roms'),preferences=add('button','btn-open-preferences');
 const sidebar=add('nav','platform-list');const first=add('button','platform1',[],sidebar),second=add('button','platform2',[],sidebar);first.setAttribute('aria-pressed','true');first.dataset.libraryGroup='one';second.dataset.libraryGroup='two';
 const menu=add('div','dropdown-options-menu',['dropdown-menu']),holder=add('div','menu-options-dropdown'),title=add('button','btn-menu-options',[],holder);
 title.onClick=()=>{menu.classList.toggle('show');holder.classList.toggle('active');};
 const item1=add('button','menu-item1',[],menu),item2=add('button','menu-item2',[],menu);item2.disabled=true;const item3=add('button','menu-item3',[],menu);
 // getClientRects models the dropdown's display:none rule.
 [item1,item2,item3].forEach(item=>{item.getClientRects=()=>menu.classList.contains('show')?[{}]:[];});
 const help=add('dialog','keyboard-shortcuts-dialog');
 const overlay=add('div','test-modal',['modal-overlay','hidden']);const field=add('input','modal-field',[],overlay),end=add('button','modal-last',[],overlay);
 const window={MutationObserver:class{constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}disconnect(){}},MouseEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}}};
 const context=vm.createContext({document,window});vm.runInContext(fs.readFileSync('src/keyboard-navigation.js','utf8'),context);
 context.OpenCabinetKeyboard.setup({document,window});
 const key=(target,key,extra={})=>{const event={target,key,preventDefault(){this.prevented=true;},stopPropagation(){},...extra};listeners.keydown(event);return event;};
 return {api:context.OpenCabinetKeyboard,document,window,add,key,sync:()=>observers[0].callback(),observers,search,importButton,preferences,sidebar,first,second,menu,title,item1,item2,item3,help,overlay,field,end};
}
test('Grid vertical navigation follows the rendered rows including incomplete final rows',()=>{
 const {api}=environment();const cards=Array.from({length:8},(_,i)=>({getBoundingClientRect:()=>({top:Math.floor(i/3)*100,left:(i%3)*80})}));
 assert.equal(api.gridTarget(cards,2,'ArrowDown'),5);
 assert.equal(api.gridTarget(cards,5,'ArrowDown'),7);
 assert.equal(api.gridTarget(cards,6,'ArrowUp'),3);
 assert.equal(api.gridTarget(cards,0,'ArrowUp'),0);
});
test('Game actions use the existing callbacks, suppress repeats and expose the context menu key',()=>{
 const e=environment();const card=e.add('div','card',['game-card']);card.dataset.gameId='8';
 const calls=[];const options={card,cards:[card],window:e.window,select:id=>calls.push(['select',id]),launch:id=>calls.push(['launch',id]),edit:id=>calls.push(['edit',id]),remove:()=>calls.push(['delete']),selectAll:()=>calls.push(['all'])};
 const key=(key,extra={})=>e.api.handleGameKey({key,preventDefault(){},stopPropagation(){},...extra},options);
 key('Enter');key('Enter',{repeat:true});key('F2');key('Delete');key('Delete',{repeat:true});key('a',{ctrlKey:true});
 assert.deepEqual(calls,[['select',8],['launch',8],['select',8],['edit',8],['delete'],['all']]);
 key('F10',{shiftKey:true});assert.equal(card.dispatched.type,'contextmenu');assert.equal(card.dispatched.clientX,0);
 assert.equal(key('x'),false);
});
test('Window focus is contained, restored to its opener and does not observe 3D frames',()=>{
 const e=environment();e.importButton.focus();e.key(e.importButton,'Enter');
 e.overlay.classList.remove('hidden');e.sync();assert.equal(e.document.activeElement,e.field);
 e.end.focus();assert.equal(e.key(e.end,'Tab').prevented,true);assert.equal(e.document.activeElement,e.field);
 e.key(e.field,'Tab',{shiftKey:true});assert.equal(e.document.activeElement,e.end);
 e.search.focus();assert.equal(e.document.activeElement,e.field);
 e.overlay.classList.add('hidden');e.sync();assert.equal(e.document.activeElement,e.importButton);
 assert.equal(e.observers[0].targets.includes(e.document.body),false);
});
test('Menus open from the keyboard, skip disabled commands and return focus on Escape',()=>{
 const e=environment();e.title.focus();e.key(e.title,'ArrowDown');assert.equal(e.document.activeElement,e.item1);
 e.key(e.item1,'ArrowDown');assert.equal(e.document.activeElement,e.item3);
 e.key(e.item3,'Escape');assert.equal(e.document.activeElement,e.title);assert.equal(e.menu.classList.contains('show'),false);
 assert.equal(e.title.getAttribute('aria-expanded'),'false');
});

test('Recovering focus after a modal control disappears never scrolls back to the first field',()=>{
 const e=environment();e.overlay.classList.remove('hidden');e.sync();e.end.focus();
 e.document.activeElement=e.document.body;e.sync();
 assert.equal(e.document.activeElement,e.field);
 assert.equal(e.field.focusOptions.preventScroll,true);
});
test('Shortcuts respect text editing and open help without changing the library',()=>{
 const e=environment();e.search.focus();e.key(e.search,'f',{ctrlKey:true});assert.equal(e.search.textSelected,true);
 let imports=0;e.importButton.onClick=()=>imports++;
 e.key(e.search,'i',{ctrlKey:true});assert.equal(imports,0);
 e.key(e.importButton,'i',{ctrlKey:true});assert.equal(imports,1);
 e.key(e.importButton,'F1');assert.equal(e.help.open,true);
 e.key(e.importButton,'i',{ctrlKey:true});assert.equal(imports,1,'native dialogs isolate shortcuts');
});
test('Sidebar has one tab stop and arrow navigation moves focus without activating a filter',()=>{
 const e=environment();assert.equal(e.first.tabIndex,0);assert.equal(e.second.tabIndex,-1);
 e.first.focus();e.key(e.first,'ArrowDown');assert.equal(e.document.activeElement,e.second);
 assert.equal(e.first.tabIndex,-1);assert.equal(e.second.tabIndex,0);
 e.key(e.second,'Home');assert.equal(e.document.activeElement,e.first);
});
