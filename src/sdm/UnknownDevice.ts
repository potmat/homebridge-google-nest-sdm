import {Device} from "./Device";
import {Event} from "./Events";

export class UnknownDevice extends Device {

    getDisplayName(): string {
        return 'Unknown';
    }

    event(event: Event): void {
    }
}
