'use strict';
const {test, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const Module = require('node:module');
const {Thermostat} = require('../dist/sdm/Thermostat');
const T = 'sdm.devices.traits.Temperature';
const H = 'sdm.devices.traits.Humidity';
const log = {debug() {}, info() {}, warn() {}, error() {}};
let now, timers, subscriptions, get, list, clientClosed;
let original;
class Subscription extends EventEmitter {
  async close() { this.closed = true; }
}
const fakeGoogle = {
  Auth: {OAuth2Client: class {setCredentials() {}}},
  smartdevicemanagement_v1: {Smartdevicemanagement: class {
    enterprises = {devices: {get: (...args) => get(...args), list: (...args) => list(...args)}};
  }}
};
const fakePubsub = {PubSub: class {
  subscription() { const sub = new Subscription(); subscriptions.push(sub); return sub; }
  async close() { clientClosed = true; }
}};
const load = Module._load;
Module._load = function(id, ...args) {
  if (id === 'googleapis') return fakeGoogle;
  if (id === '@google-cloud/pubsub') return fakePubsub;
  return load.call(this, id, ...args);
};
const {SmartDeviceManagement} = require('../dist/sdm/Api');
Module._load = load;
const snapshot = (temp = 20) => ({name: 'device', type: 'sdm.devices.types.THERMOSTAT', traits: {
  [T]: {ambientTemperatureCelsius: temp}, [H]: {ambientHumidityPercent: 50}
}});
function thermostat() {
  return new Thermostat({enterprises: {devices: {get: (...args) => get(...args)}}}, snapshot(), log);
}
function event(timestamp, traits) {return {timestamp: new Date(timestamp).toISOString(), resourceUpdate: {name: 'device', traits}};}
function temp(value) {return {[T]: {ambientTemperatureCelsius: value}};}
function api() {return new SmartDeviceManagement({projectId: 'test', subscriptionId: 'test'}, log);}
function message(data) {return {data: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)), ack() {this.acked = true;}, nack() {this.nacked = true;}};}
function deferred() {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject};}
async function flush() {for(let i=0;i<12;i++) await Promise.resolve();}
beforeEach(() => {
  now = 1000000; timers = []; subscriptions = []; clientClosed = false;
  original = {now: Date.now, setTimeout, setInterval, clearTimeout, clearInterval};
  Date.now = () => now;
  const timer = (fn, delay, interval) => {const t = {fn, delay, interval, unref() {return this;}}; timers.push(t); return t;};
  global.setTimeout = (fn, delay) => timer(fn, delay, false);
  global.setInterval = (fn, delay) => timer(fn, delay, true);
  global.clearTimeout = global.clearInterval = t => {if(t) t.cleared = true;};
  get = async () => ({data: snapshot()});
  list = async () => ({data: {devices: [snapshot()]}});
});
afterEach(() => {
  Date.now = original.now;
  for(const key of ['setTimeout','setInterval','clearTimeout','clearInterval']) global[key] = original[key];
});
test('rejects old/duplicate traits before HomeKit callbacks, independently per trait', async () => {
  const d = thermostat(); const values = []; d.onTemperatureChanged = v => values.push(v);
  d.receiveEvent(event(now - 1, temp(10)));
  d.receiveEvent(event(now + 20, temp(21)));
  d.receiveEvent(event(now + 10, {...temp(19), [H]: {ambientHumidityPercent: 60}}));
  d.receiveEvent(event(now + 20, temp(22)));
  assert.deepEqual(values, [21]);
  assert.equal((await d.getTrait(H)).ambientHumidityPercent, 60);
});
test('GET reconciliation is single-flight, bounded, and updates callbacks without device replacement', async () => {
  const d = thermostat(); const pending = deferred(); let calls = 0;
  get = (params, options) => {calls++; assert.equal(options.timeout, 30000); return pending.promise;};
  const values = []; d.onTemperatureChanged = v => values.push(v);
  now += 100;
  const a = d.refresh(); const b = d.refresh(); assert.equal(a,b);
  pending.resolve({data: snapshot(22)}); await a;
  assert.equal(calls,1); assert.deepEqual(values,[22]);
  d.receiveEvent(event(now - 1, temp(15)));
  assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,22);
});
test('events received during a snapshot win, even with delayed timestamps', async () => {
  const d = thermostat(); const pending = deferred(); get = () => pending.promise;
  now += 100; const refreshing = d.refresh();
  d.receiveEvent(event(now - 10, temp(23)));
  pending.resolve({data: snapshot(21)}); await refreshing;
  assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,23);
});
test('failed GET can retry and does not advance stale-event watermark', async () => {
  const d = thermostat(); now += 100;
  get = async () => {throw new Error('offline');}; await d.refresh();
  d.receiveEvent(event(now - 10, temp(23)));
  assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,23);
  now += 100; get = async () => ({data: snapshot(24)}); await d.refresh();
  assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,24);
});
test('shutdown ignores in-flight GETs and subsequent events', async () => {
  const d = thermostat(); const pending = deferred(); get = () => pending.promise;
  const values = []; d.onTemperatureChanged = v => values.push(v);
  const refreshing = d.refresh(); d.close(); pending.resolve({data: snapshot(22)}); await refreshing;
  d.receiveEvent(event(now + 10, temp(23))); assert.deepEqual(values,[]);
});
test('subscription failure does not block discovery; reconnect backs off and refreshes existing device', async () => {
  const a = api(); subscriptions[0].emit('error',new Error('DNS'));
  const devices = await a.list_devices(); assert.equal(devices.length,1);
  subscriptions[0].emit('error',new Error('DNS again'));
  let retry = timers.filter(t => !t.interval); assert.equal(retry.length,1); assert.equal(retry[0].delay,1000);
  now += 100; get = async () => ({data: snapshot(22)});
  await retry[0].fn(); assert.equal(subscriptions[0].closed,true); assert.equal(subscriptions.length,2);
  assert.equal((await devices[0].getTrait(T)).ambientTemperatureCelsius,22);
  subscriptions[1].emit('error',new Error('offline'));
  retry = timers.filter(t => !t.interval); assert.equal(retry[1].delay,2000);
  assert.equal((await a.list_devices())[0],devices[0]); await a.close();
});
test('periodic reconciliation repairs dropped events without HomeKit reads', async () => {
  const a = api(); const [d] = await a.list_devices(); const values = []; d.onTemperatureChanged = v => values.push(v);
  now += 300000; get = async () => ({data: snapshot(25)});
  const interval = timers.find(t => t.interval); assert.equal(interval.delay,300000);
  interval.fn(); await flush(); assert.deepEqual(values,[25]); await a.close();
});
test('messages before discovery are retried; malformed and relation events are safely acknowledged', async () => {
  const a = api(); const early = message(event(now+1,temp(21)));
  subscriptions[0].emit('message',early); assert.equal(early.nacked,true); assert.equal(early.acked,undefined);
  await a.list_devices();
  for(const data of ['bad JSON', 'null', {relationUpdate:{}}, event(now+1,temp(22))]) {
    const m = message(data); subscriptions[0].emit('message',m); assert.equal(m.acked,true);
  }
  await a.close();
});
test('shutdown cancels timers and closes client; pending reconnect cannot reopen', async () => {
  const a = api(); await a.list_devices(); subscriptions[0].emit('error',new Error('offline'));
  const retry = timers.find(t => !t.interval); await a.close(); await retry.fn();
  assert.equal(subscriptions.length,1); assert.equal(clientClosed,true);
  assert.ok(timers.every(t => t.cleared));
});
test('quiet subscription closure reconnects; retired subscriptions cannot schedule more retries', async () => {
  const a = api(); await a.list_devices(); const old = subscriptions[0];
  old.emit('close'); await timers.find(t => !t.interval).fn();
  const count = timers.length; old.emit('close'); old.emit('error', new Error('late error'));
  assert.equal(timers.length,count); assert.equal(subscriptions.length,2); await a.close();
});
test('retry delay is capped and successful delivery resets backoff', async () => {
  const a = api(); await a.list_devices();
  for(let i=0;i<9;i++) {
    subscriptions.at(-1).emit('error',new Error('offline'));
    const retry = timers.filter(t => !t.interval).at(-1);
    assert.equal(retry.delay,Math.min(1000 * 2 ** i,60000)); await retry.fn();
  }
  subscriptions.at(-1).emit('message',message(event(now+10,temp(21))));
  subscriptions.at(-1).emit('error',new Error('offline again'));
  assert.equal(timers.filter(t => !t.interval).at(-1).delay,1000); await a.close();
});
test('camera resource events bypass trait timestamp filtering', () => {
  const d = thermostat(); let received; d.event = e => {received=e;};
  const e = {timestamp:new Date(now-10).toISOString(),resourceUpdate:{name:'device',events:{motion:{}}}};
  d.receiveEvent(e); assert.equal(received,e);
});
test('HomeKit reads refresh after five minutes, but unchanged snapshots do not notify', async () => {
  const d = thermostat(); let calls=0; const values=[]; d.onTemperatureChanged = v => values.push(v);
  get = async () => {calls++; return {data:snapshot()};};
  await d.getTrait(T); assert.equal(calls,0);
  now += 300001; await d.getTrait(T); assert.equal(calls,1); assert.deepEqual(values,[]);
});
test('invalid timestamp cannot poison subsequent valid events', async () => {
  const d = thermostat(); d.receiveEvent({timestamp:'invalid',resourceUpdate:{name:'device',traits:temp(99)}});
  d.receiveEvent(event(now+1,temp(21))); assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,21);
});
test('failed periodic reconciliation does not stop subsequent polls', async () => {
  const a = api(); const [d] = await a.list_devices(); const interval=timers.find(t => t.interval);
  now += 100; get = async () => {throw new Error('offline');}; interval.fn(); await flush();
  now += 100; get = async () => ({data:snapshot(26)}); interval.fn(); await flush();
  assert.equal((await d.getTrait(T)).ambientTemperatureCelsius,26); await a.close();
});
test('discovery can retry after API failure', async () => {
  const a = api(); list = async () => {throw new Error('offline');};
  assert.equal(await a.list_devices(),undefined);
  list = async () => ({data:{devices:[snapshot()]}});
  assert.equal((await a.list_devices()).length,1); await a.close();
});
