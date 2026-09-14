const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function component(name, globals = {}) {
  const slots = [];
  let cursor = 0, effects = [];
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useCallback(fn,deps) { const i = cursor++; if (!same(slots[i]?.deps,deps)) slots[i] = { fn,deps }; return slots[i].fn; },
    useEffect(fn,deps) { const i = cursor++, prev = slots[i]; if (!same(prev?.deps,deps)) { slots[i] = {deps}; effects.push(()=>{prev?.cleanup?.();slots[i].cleanup=fn();}); } },
    createElement: (type,props,...children) => ({type,props:props||{},children}),
  };
  react.default = react;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/'+name+'.tsx','utf8'), {
    compilerOptions:{ module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.React },
  }).outputText,{exports,require:n=>n==='react'?react:{},console,window:{addEventListener(){},removeEventListener(){}},...globals});
  const flat = node => !node || typeof node !== 'object' ? [] : [node,...(node.children||[]).flat(Infinity).flatMap(flat)];
  const render = (props,refs={}) => {cursor=0;const tree=flat(exports.default(props));for(const node of tree) if(node.props.ref) node.props.ref.current=refs[node.type];const pending=effects;effects=[];pending.forEach(fn=>fn());return tree;};
  render.unmount = () => slots.forEach(slot=>slot?.cleanup?.());
  return render;
}

test('paused preview applies a single 60fps frame seek and tracks playback end', () => {
  const render=component('VideoPreview');
  let ended=0;
  const video={currentTime:0,paused:true,pause(){},play(){return Promise.resolve();}};
  const props={videoSrc:'safe-file:C:/source.mp4',currentTime:0,isPlaying:false,onPlayPause:()=>ended++};
  render(props,{video});
  render({...props,currentTime:1/60},{video});
  assert.equal(video.currentTime,1/60);
  const tree=render({...props,isPlaying:true,currentTime:1/60},{video});
  tree.find(n=>n.type==='video').props.onEnded(); assert.equal(ended,1);
});

test('timeline exposes active clip and supports keyboard range editing without crossing bounds', () => {
  const render=component('Timeline');
  let inTime=1,outTime=2,selected,added=0;
  const props={currentTime:1,inTime,outTime,duration:10,isPlaying:false,fps:30,formatTime:String,
    segments:[{id:'a',start:1,end:2},{id:'b',start:3,end:4}],activeSegmentId:'b',
    onSelectSegment:id=>selected=id,onAddSegment:()=>added++,onInTimeChange:t=>inTime=t,onOutTimeChange:t=>outTime=t,
    onCurrentTimeChange(){},onPlayPause(){},onExport(){}};
  const tree=render(props);
  const sliders=tree.filter(n=>n.props.role==='slider');
  assert.equal(sliders.length,3);
  const event=key=>({key,preventDefault(){},stopPropagation(){}});
  sliders.find(n=>n.props['aria-label']==='Trim in').props.onKeyDown(event('End'));
  assert.equal(inTime,2);
  sliders.find(n=>n.props['aria-label']==='Trim out').props.onKeyDown(event('Home'));
  assert.equal(outTime,1);
  const tabs=tree.filter(n=>n.props.className?.startsWith('clip-tab'));
  assert.equal(tabs[1].props['aria-pressed'],true);
  tabs[0].props.onClick();assert.equal(selected,'a');
  tree.find(n=>n.props['aria-label']==='Add clip').props.onClick();assert.equal(added,1);
  const empty=render({...props,duration:0,segments:[]});
  assert.equal(empty.find(n=>n.props.className==='primary-button export-clip').props.disabled,true);
});

test('dialog traps focus, restores it and blocks Escape/backdrop close during jobs', () => {
  let closed=0,firstFocus=0,lastFocus=0,restored=0;
  const first={getClientRects:()=>[1],focus(){firstFocus++;}},last={getClientRects:()=>[1],focus(){lastFocus++;}};
  const document={activeElement:{focus(){restored++;}}};
  const panel={focus(){document.activeElement=panel;},querySelectorAll:()=>[first,last]};
  const render=component('Dialog',{document});
  const props={title:'Export',eyebrow:'',busy:true,onClose:()=>closed++,children:null,footer:null};
  let tree=render(props,{div:panel});
  const event=(key,shiftKey=false)=>({key,shiftKey,preventDefault(){},stopPropagation(){}});
  tree.find(n=>n.props.role==='dialog').props.onKeyDown(event('Escape'));assert.equal(closed,0);
  tree.find(n=>n.props.role==='dialog').props.onKeyDown(event('Tab'));assert.equal(firstFocus,1);
  document.activeElement=first;
  tree.find(n=>n.props.role==='dialog').props.onKeyDown(event('Tab',true));assert.equal(lastFocus,1);
  const target={};
  tree[0].props.onMouseDown({target,currentTarget:target});assert.equal(closed,0);
  tree=render({...props,busy:false},{div:panel});
  tree.find(n=>n.props.role==='dialog').props.onKeyDown(event('Escape'));assert.equal(closed,1);
  assert.equal(restored,0);
  render.unmount(); assert.equal(restored,1);
});
