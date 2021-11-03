import {Device} from "./Device";
import {Event} from "./Events";

export class UnknownDevice extends Device {
    event(event: Event): void {
    }
}
