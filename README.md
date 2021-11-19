# homebridge-google-nest-sdm

A Homebridge plugin for Google Nest devices that uses the [Google Smart Device Management API](https://developers.google.com/nest/device-access). Supports Cameras, Doorbells, Displays, and Thermostats.

*Currently does not support the new battery powered cameras/doorbells.  The SDM API does support these devices, but I don't have one, so I have no way to test it. If anyone has one of the new battery cameras they're willing to loan me it should not be that hard to add.* 

# Example Homebridge config:

    {
        "platform" : "homebridge-google-nest-sdm",
        "clientId": "...",
        "clientSecret": "...",
        "projectId": "...",
        "refreshToken": "...",
        "subscriptionId": "...",
        "vEncoder": "<optional>"
    }

You can also use the plugin config UI to enter these values.

If vEncoder is not specified it will default to "libx264 -preset ultrafast -tune zerolatency". On a Raspberry Pi 4 you can try something like "h264_v4l2m2m". On other platforms use the encoder of your choice.

# Where do the config values come from?

Follow the getting started guide here: https://developers.google.com/nest/device-access/get-started

ONE IMPORTANT DIFFERENCE!

In step two "Authorize an Account" in the "Link your account" section, step 1, you are instructed to "open the following link in a web browser":

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service

DO NOT USE THIS URL!

You should instead use this URL:

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub

Note the "+https://www.googleapis.com/auth/pubsub" on the end.  This is so you will have access to events.

# Hardware Requirements

The minimum hardware requirement is something like a Raspberry Pi 4.  If you want multiple people viewing the streams at once then you'd probably need even more.

I tried very hard to avoid having to transcode the video, which would allow the plugin to run on something like a pi-zero.  Unfortunately this is simply not possible, the Apple Home App will not properly display the native stream.  In most cases the frame rate will be off, or it will fail to show at all (the iPhone will not show any video higher than 1080p, the Nest Doorbell produces video at a higher resolution).

# FAQ

Q: I'm having problems getting through the getting started guide and getting the config values. Can you help?

A: Maybe, but probably not.  Having a day job and family I don't have much time to help with this.  The Nest plugin for Home Assistant uses much the same process (don't forget the "ONE IMPORTANT DIFFERENCE" section above).  It has an illustrated guide here: https://www.home-assistant.io/integrations/nest/. You can also try reaching out to others on [Discord](https://discord.gg/kqNCe2D) or [Reddit](https://www.reddit.com/r/homebridge/), some people there may be able to help.

Q: Do I really have to pay $5 to use the API?

A: Yup.

Q: Isn't there already a Nest plugin for Homebridge that does more stuff than this?

A: Yup.

Q: So why this plugin?  

A: Well, the "official" Homebridge Nest plugin(s) use undocumented APIs.  That is, the authors reverse engineered the APIs the Nest app itself uses.  Don't get me wrong, I have no problem with that. But the SDM API is a documented API for precisely this use case.  The more important reason for making this plugin is the same as the reason for climbing a mountain, because you can.

Q: Sometimes my cameras don't respond. Why?

A: Much like the behaviour some of us have experienced in the Nest app, sometimes the API errors out for unknown reasons.  If it's a battery camera, see above.

Q: My cameras never respond.  Why?

A: Is your Apple device connected to a VPN? If so disconnect, remember Homekit works with your local network. You can also try waiting a while, I have seen the API refuse all requests for short periods as well.




