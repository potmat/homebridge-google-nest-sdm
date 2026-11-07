const fs=require('fs'),vm=require('vm'),assert=require('assert'),{EventEmitter}=require('events');
const src=fs.readFileSync(require('node:path').join(__dirname, '../dist/FfMpegProcess.js'),'utf8');
function setup(){
 let timer, calls=[],stops=0,forced=0,args;
 const child=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdio=[child.stdin,child.stdout,child.stderr,new EventEmitter()];child.kill=()=>{child.killed=true;child.emit('exit',null,'SIGKILL')};
 const ctx={exports:{},require:n=>n==='child_process'?{spawn:(p,a)=>{args=a;return child}}:n==='ffmpeg-for-homebridge'?'/fake/ffmpeg':require(n),Buffer,process:{env:{}},Date,setTimeout:f=>{timer=f;return{unref(){}}},clearTimeout:()=>{timer=null}};
 vm.runInNewContext(src,ctx);const p=new ctx.exports.FfmpegProcess('test','session','-i fake',undefined,{debug(){},info(){},error(){}},false,{stopStream(){stops++},getCamera(){return {}},getController(){return{forceStopStreamingSession(){forced++}}}},e=>calls.push(e?e.message:'ok'));
 return{p,child,calls,get stops(){return stops},get forced(){return forced},tick(){timer?.()},args};
}
let t=setup();t.child.stderr.emit('data',Buffer.from('ffmpeg banner'));assert.equal(t.calls.length,0);t.child.stdout.emit('data',Buffer.from('frame=0\nframe='));assert.equal(t.calls.length,0);t.child.stdout.emit('data',Buffer.from('1\n'));assert.deepEqual(t.calls,['ok']);t.tick();assert.equal(t.stops,0);t.child.emit('exit',1,null);assert.equal(t.stops,1);assert.equal(t.forced,1);assert.equal(t.calls.length,1);
t=setup();t.tick();assert.equal(t.calls.length,1);assert.match(t.calls[0],/15 seconds/);assert.equal(t.stops,1);t.child.emit('exit',1,null);assert.equal(t.calls.length,1);
t=setup();t.child.emit('error',new Error('test'));t.child.emit('exit',1,null);assert.equal(t.calls.length,1);assert.equal(t.stops,1);
t=setup();t.p.stop();assert.equal(t.calls.length,1);t.tick();assert.equal(t.stops,0);
console.log('PASS: banner not success; fragmented progress frame acknowledgement; timeout; post-start exit; spawn error; intentional cancellation; exactly-once callbacks');
