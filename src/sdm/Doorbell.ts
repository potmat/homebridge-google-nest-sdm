import {Camera} from "./Camera";
import * as Events from "./Events";
import _ from "lodash";

export class Doorbell extends Camera {

    getDisplayName(): string {
        return this.displayName ? this.displayName + ' Doorbell' : 'Unknown';
    }

    onRing: (() => void) | undefined;

    event(event: Events.ResourceEventEvent) {
        super.event(event);

        _.forEach(event.resourceUpdate.events, (value, key) => {
            switch (key) {
                case Events.Constants.DoorbellChime:
                    const eventValue = value as Events.DoorbellChime;
                    this.getEventImage(eventValue.eventId)
                        .then(() => {
                            if (this.onRing) this.onRing();
                        });
                    break;
            }
        });
    }
}
