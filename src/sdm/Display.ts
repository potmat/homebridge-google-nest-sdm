import {Camera} from "./Camera";

export class Display extends Camera {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Display' : 'Unknown';
    }

    getResolutions(): [number, number, number][] {
        return [[1280, 720, 15],[1920, 1080, 15],[1600, 1200, 15]];
    }
}
