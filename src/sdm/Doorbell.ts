import {Camera} from "./Camera";
import * as Events from "./Events";
import _ from "lodash";
import * as Traits from "./Traits";
import {ThreadStateType} from "./Events";

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

                    if (event.eventThreadState && event.eventThreadState != ThreadStateType.STARTED)
                        return;

                    this.getVideoProtocol()
                        .then(protocol => {
                            if (protocol === Traits.ProtocolType.WEB_RTC) {
                                if (this.onRing) this.onRing();
                            } else {
                                this.getEventImage(eventValue.eventId, new Date(event.timestamp))
                                    .then(() => {
                                        if (this.onRing) this.onRing();
                                    });
                            }
                        });
                    break;
            }
        });
    }
}
