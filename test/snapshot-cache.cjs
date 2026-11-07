const assert=require('node:assert/strict');
const {SnapshotCache}=require('../dist/SnapshotCache');
const jpeg=Buffer.from([255,216,1,2,255,217]);
const camera={snapshotLogger:{warn(){}},log:{warn(){}},getDisplayName:()=> 'mock'};
(async()=>{
 let calls=0;let release;
 const c=new SnapshotCache(camera,{},()=>{calls++;return new Promise(r=>release=r)});
 const p1=c.get(),p2=c.get();await new Promise(r=>setImmediate(r));assert.equal(calls,1);release(jpeg);assert.deepEqual(await p1,jpeg);assert.deepEqual(await p2,jpeg);await c.get();assert.equal(calls,1);
 c.updatedAt=Date.now()-11000;c.nextAttempt=0;let settled=false;const expired=c.get().then(v=>{settled=true;return v});await new Promise(r=>setImmediate(r));assert.equal(calls,2);assert.equal(settled,false);release(jpeg);assert.deepEqual(await expired,jpeg);
 c.updatedAt=Date.now()-11000;c.nextAttempt=0;c.capture=async()=>{throw Error('429')};await c.get();await c.pending;assert.ok(c.nextAttempt-Date.now()>29000);assert.deepEqual(await c.get(),jpeg);
 const d=new SnapshotCache(camera,{});d.buffers.set('live',Buffer.alloc(0));let fresh=d.captureFrame();d.consume(jpeg.subarray(0,3),'live');d.consume(jpeg.subarray(3),'live');assert.deepEqual(await fresh,jpeg);assert.equal(d.updatedAt>0,true);d.end('live');assert.equal(d.buffers.size,0);
 const e=new SnapshotCache(camera,{});e.consume(Buffer.alloc(3*1024*1024),'bad');assert.ok(e.buffers.get('bad').length<=2*1024*1024);
 console.log('PASS snapshot dedupe, TTL, expired requests await refresh, backoff, split JPEG parser, live reuse, bounded parser');
})().catch(e=>{console.error(e);process.exitCode=1});
