import {Camera} from "./Camera";
import * as Events from "./Events";
import _ from "lodash";

export class Doorbell extends Camera {

    onRing: (() => void) | undefined;

    event(event: Events.ResourceEventEvent) {
        super.event(event);

        _.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.DoorbellChime:
                    if (this.onRing) {
                        //const eventValue = value as Events.DoorbellChime;
                        this.onRing();
                    }
                    break;
            }
        });
    }
}
