import {Logger} from "homebridge";

export class ImageQueue {
    private queue: Buffer[] = [];
    private log: Logger;
    private name: string;

    constructor(name: string, log: Logger) {
        this.name = name;
        this.log = log;
    }

    get(): Buffer | undefined {
        const image = this.queue.shift();
        if (image)
            this.log.debug(`Image retrieved from ${this.name} queue. Current queue size: ${this.queue.length}.`);
        return image;
    }

    put(image: Buffer): void {
        this.queue.push(image);
        setTimeout(this.expire.bind(this), 30000, image);
        this.log.debug(`Image added to ${this.name} queue. Current queue size: ${this.queue.length}.`);
    }

    expire(image: Buffer): void {
        let index = this.queue.indexOf(image);

        if (index >= 0) {
            this.queue.splice(index, 1);
            this.log.debug(`Image expired from ${this.name} queue. Current queue size: ${this.queue.length}.`);
        }
    }
}
