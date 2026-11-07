const assert=require('node:assert/strict');
const {EventEmitter}=require('events');
const {PassThrough}=require('stream');
const base=require('node:path').join(__dirname, '../dist');
const streamer=require(base+'/NestStreamer');
const cp=require('child_process');
const originalSpawn=cp.spawn, originalGet=streamer.getStreamer;
const jpeg=Buffer.from([255,216,1,2,255,217]);
let generates=0,stops=0,kills=0,child;
streamer.getStreamer=async()=>({initialize:async()=>{generates++;return {args:'-i fake'}},teardown:async()=>{stops++}});
cp.spawn=()=>{child=new EventEmitter();child.stdin=new PassThrough();child.stderr=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{kills++;setImmediate(()=>child.emit('close',null));};return child};
const {SnapshotCache}=require(base+'/SnapshotCache');
const camera={snapshotLogger:{warn(){}},log:{warn(){}},getDisplayName:()=> 'mock'};
(async()=>{
 const c=new SnapshotCache(camera,{});
 const first=c.get();await new Promise(r=>setImmediate(r));child.stdout.write(jpeg);assert.deepEqual(await first,jpeg);assert.equal(generates,1);
 c.updatedAt=Date.now()-11000;c.nextAttempt=0;const second=c.get();await new Promise(r=>setImmediate(r));child.stdout.write(jpeg);assert.deepEqual(await second,jpeg);assert.equal(generates,1,'expired requests reuse feed');
 await Promise.all([c.stopCapture(),c.stopCapture()]);assert.equal(stops,1);assert.equal(kills,1);assert.equal(c.buffers.size,0);
 const {Camera}=require(base+'/sdm/Camera');const cam=Object.create(Camera.prototype);cam.configureSnapshot({});assert.doesNotThrow(()=>JSON.stringify(cam));assert.equal(Object.keys(cam).includes('snapshotCache'),false);
 const s=new streamer.WebRtcNestStreamer({warn(){}}, {}, {});let pcClose=0,udpClose=0,remoteStop=0;s.pc={close:async()=>{pcClose++}};s.udp={close:()=>{udpClose++}};s.token='mock';s.camera={stopStream:async()=>{remoteStop++}};
 await Promise.all([s.teardown(),s.teardown()]);assert.equal(pcClose,1);assert.equal(udpClose,1);assert.equal(remoteStop,1);
 console.log('PASS persistent ingest reuse, preemption, cache serialization, concurrent teardown');
 cp.spawn=originalSpawn;streamer.getStreamer=originalGet;
})().catch(e=>{console.error(e);process.exitCode=1});
// Cache fallback invariants: a 429-like failure never replaces a good frame
// or changes its original capture timestamp, and cooldown never refetches.
(async()=>{
 let calls=0;const age=Date.now()-20000;
 const c=new SnapshotCache(camera,{},async()=>{calls++;throw Object.assign(Error('rate limited'),{status:429})});
 c.frame=jpeg;c.updatedAt=age;
 assert.deepEqual(await c.get(),jpeg);assert.equal(c.updatedAt,age);assert.equal(calls,1);
 const start=Date.now();assert.deepEqual(await c.get(),jpeg);assert.ok(Date.now()-start<100);assert.equal(calls,1);assert.equal(c.updatedAt,age);
 const empty=new SnapshotCache(camera,{},async()=>{throw Error('429')});await assert.rejects(empty.get(),/No current/);
 console.log('PASS 429 cached fallback, immediate cooldown, original frame age, no-cache errors');
})().catch(e=>{console.error(e);process.exitCode=1});
