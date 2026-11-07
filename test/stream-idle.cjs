const assert = require('node:assert/strict');
const { StreamLeasePool } = require('../dist/StreamLeasePool');
(async () => {
 let time=0, opened=0, closed=0, keyframes=0;
 const timers=new Map(); let seq=0;
 const pool=new StreamLeasePool({now:()=>time,schedule:(fn,ms)=>{const id=++seq;timers.set(id,{fn,at:time+ms});return id},cancel:id=>timers.delete(id)});
 const advance=async ms=>{time+=ms;for(const [id,t] of timers)if(t.at<=time){timers.delete(id);t.fn()}await Promise.resolve()};
 const camera={}; const factory=async()=>({initialize:async()=>({input:++opened}),teardown:async()=>{closed++},requestKeyframe:()=>keyframes++});
 const acquire=()=>pool.lease(camera,factory);
 const first=acquire(); const input=await first.initialize(); await first.teardown();
 await advance(59000);assert.equal(closed,0);
 const second=acquire();assert.equal(await second.initialize(),input);assert.equal(opened,1);assert.equal(keyframes,1);
 const concurrent=acquire();assert.notEqual(await concurrent.initialize(),input);assert.equal(opened,2);
 await second.teardown();await second.teardown();await advance(59999);assert.equal(closed,0);await advance(1);assert.equal(closed,1);
 await concurrent.teardown();await advance(60000);assert.equal(closed,2);
 const cancelled=acquire();await cancelled.teardown();await assert.rejects(cancelled.initialize());assert.equal(opened,2);
 // Session age caps reuse even when repeated activity resets idle deadline.
 const a=acquire();await a.initialize();await advance(230000);await a.teardown();await advance(10000);assert.equal(closed,3);
 const other=pool.lease({},factory);await other.initialize();assert.equal(opened,4);await other.teardown();await advance(60000);
 let ready;const delayed=pool.lease({},async()=>({initialize:()=>new Promise(resolve=>ready=resolve),teardown:async()=>{closed++}}));
 const startup=delayed.initialize();await Promise.resolve();const closedBefore=closed;const stop=delayed.teardown();await stop;assert.equal(closed,closedBefore+1,'cancellation closes sockets before negotiation completes');ready({input:'late'});await assert.rejects(startup);await stop;
 console.log('PASS: idle retention, reopen reuse, keyframe, exclusive concurrent inputs, idempotent release, cancellation, age expiry, camera isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
