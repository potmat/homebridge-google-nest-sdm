const assert = require('node:assert/strict');
const {StreamingDelegate} = require('../dist/StreamingDelegate');
const streamer = require('../dist/NestStreamer');
const originalGet = streamer.getStreamer;
const flush = () => new Promise(resolve => setImmediate(resolve));
function delegate(cache) {
  const d = Object.create(StreamingDelegate.prototype);
  d.config = {streamStartupTimeout:1000};
  d.log = {debug(){},error(){}};
  d.camera = {snapshotCache:cache,getDisplayName:()=> 'mock'};
  d.pendingSessions = {session:{}};
  d.ongoingSessions = {};
  return d;
}
const request={sessionID:'session',video:{width:320,height:240,max_bit_rate:100,fps:30}};
(async()=>{
  let release, acquisitions=0, callbacks=[];
  const cache={liveRequests:new Set(),stopCapture:()=>new Promise(resolve=>release=resolve)};
  const d=delegate(cache);
  streamer.getStreamer=async()=>{acquisitions++;throw Error('must not acquire')};
  const startup=d.startStream(request,error=>callbacks.push(error));
  await d.stopStream('session');release();await startup;
  assert.equal(acquisitions,0);assert.equal(callbacks.length,1);assert.match(callbacks[0].message,/cancelled/);
  assert.equal(cache.liveRequests.size,0);
  let ready,closed=0;callbacks=[];
  streamer.getStreamer=async()=>({initialize:()=>new Promise(resolve=>ready=resolve),teardown:async()=>{closed++}});
  const timed=delegate();
  const pending=timed.startStream(request,error=>callbacks.push(error));
  await flush();await new Promise(resolve=>setTimeout(resolve,1050));
  assert.equal(callbacks.length,1);assert.match(callbacks[0].message,/deadline/);
  ready({args:'-i mock'});await pending;
  assert.equal(callbacks.length,1);assert.ok(closed>=1);assert.equal(Object.keys(timed.ongoingSessions).length,0);
  console.log('PASS stop during snapshot preemption, negotiation deadline, late-start cancellation, exactly-once callback');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{streamer.getStreamer=originalGet});
