"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageQueue = void 0;
class ImageQueue {
    constructor(name, log) {
        this.queue = [];
        this.name = name;
        this.log = log;
    }
    get() {
        const image = this.queue.shift();
        if (image)
            this.log.debug(`Image retrieved from ${this.name} queue. Current queue size: ${this.queue.length}.`);
        return image;
    }
    put(image) {
        this.queue.push(image);
        setTimeout(this.expire.bind(this), 30000, image);
        this.log.debug(`Image added to ${this.name} queue. Current queue size: ${this.queue.length}.`);
    }
    expire(image) {
        let index = this.queue.indexOf(image);
        if (index >= 0) {
            this.queue.splice(index, 1);
            this.log.debug(`Image expired from ${this.name} queue. Current queue size: ${this.queue.length}.`);
        }
    }
}
exports.ImageQueue = ImageQueue;
//# sourceMappingURL=ImageQueue.js.map