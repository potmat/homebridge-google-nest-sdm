'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const base = require('node:path').join(__dirname, '..');
const {SnapshotCache,SNAPSHOT_FILTER} = require(base+'/dist/SnapshotCache');
const camera = {snapshotLogger:{warn(){}},log:{warn(){}},getDisplayName:()=> 'mock'};
const jpeg = n => Buffer.from([255,216,n,255,217]);
(async()=>{
 let acquisitions=0;
 const cache=new SnapshotCache(camera,{},async()=>{acquisitions++;throw Error('unexpected acquisition')});
 cache.buffers.set('live',Buffer.alloc(0));
 cache.consume(jpeg(1),'live');const firstTime=cache.updatedAt;
 assert.deepEqual(await cache.get(),jpeg(1));
 cache.consume(jpeg(2),'live');
 assert.deepEqual(await cache.get(),jpeg(2),'new live sample must bypass the previous sample even inside TTL');
 assert.equal(acquisitions,0,'active stream snapshot must not create another stream');
 assert.ok(cache.updatedAt>=firstTime);
 // Stalled live feeds wait for a new sample without acquiring another upstream.
 const stalled=new SnapshotCache(camera,{});stalled.buffers.set('live',Buffer.alloc(0));
 stalled.frame=jpeg(1);stalled.updatedAt=Date.now()-11000;
 const pending=stalled.get();await new Promise(r=>setImmediate(r));
 stalled.consume(jpeg(3),'live');assert.deepEqual(await pending,jpeg(3));
 stalled.end('live');
 // Failed refresh preserves original stale frame/age and cooldown behavior.
 cache.updatedAt=Date.now()-20000;const age=cache.updatedAt;
 assert.deepEqual(await cache.get(),jpeg(2));assert.equal(cache.updatedAt,age);
 assert.equal(acquisitions,1);await cache.get();assert.equal(acquisitions,1);
 console.log('PASS latest active sample inside TTL, no upstream churn, stalled-feed recovery, stale failure fallback');
 // Real local FFmpeg uses two outputs like HomeKit: video continues at 30fps,
 // snapshots emit immediately and roughly once/sec. No camera or disk footage.
 const binary=require(base+'/node_modules/ffmpeg-for-homebridge');
 const child=spawn(binary,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x240:rate=30:duration=3.2','-map','0:v:0','-c:v','copy','-f','null','-','-map','0:v:0','-an','-vf',SNAPSHOT_FILTER,'-vsync','vfr','-c:v','mjpeg','-q:v','5','-f','image2pipe','pipe:3'],{stdio:['ignore','ignore','pipe','pipe']});
 let frames=0,tail=Buffer.alloc(0),errors='';
 child.stderr.on('data',data=>errors+=data);
 child.stdio[3].on('data',data=>{tail=Buffer.concat([tail,data]);let end;while((end=tail.indexOf(Buffer.from([255,217])))>=0){frames++;tail=tail.subarray(end+2);}});
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
 assert.equal(exit,0,errors);assert.equal(frames,4,'3.2s source should yield initial + 1s + 2s + 3s JPEGs, not a 10s-only image or per-frame encode');
 console.log('PASS real FFmpeg dual output: '+frames+' JPEGs over 3.2s at bounded 1fps, immediate first frame');
})().catch(error=>{console.error(error);process.exitCode=1});
