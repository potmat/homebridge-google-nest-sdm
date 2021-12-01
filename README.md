[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/donate/?business=EVN8JACZRMPTJ&no_recurring=1&currency_code=CAD)

# homebridge-google-nest-sdm

A Homebridge plugin for Google Nest devices that uses the [Google Smart Device Management API](https://developers.google.com/nest/device-access). Supports Cameras, Doorbells, Displays, and Thermostats.

*Currently does not support the new battery powered cameras/doorbells.  The SDM API does support these devices, but I don't have one, so I have no way to test it. If anyone has one of the new battery cameras they're willing to loan me it should not be that hard to add. If I get some donations I'll purchase one.*

**Please read the [FAQ](https://github.com/potmat/homebridge-google-nest-sdm#faq) before creating an issue.**

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

vEncoder is the encoder the plugin will use for camera streams. If vEncoder is not specified it will default to "libx264 -preset ultrafast -tune zerolatency". On a Raspberry Pi 4 you can try something like "h264_v4l2m2m". On other platforms you are free to use the encoder of your choice.  If you don't know what this means you can probably ignore it.

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

The minimum hardware requirement is something like a Raspberry Pi 4.  If you want multiple people viewing the camera streams at once then you'll probably need even more power.

I tried very hard to avoid having to transcode the video, which would allow the plugin to run on something like a pi-zero.  Unfortunately this is simply not possible, the Apple Home App will not properly display the native stream.  In most cases the frame rate will be off, or it will fail to show at all (the iPhone will not show any video higher than 1080p, the Nest Doorbell produces video at a higher resolution).

# FAQ

**Q**: I don't see camera snapshots in the Home app, just the Nest logo. Why?

**A**: The SDM API does not have any method for getting a camera snapshot on demand, only when an event occurs. The Nest logo is used as a placeholder.  If an event occurred in the last few seconds you will likely see an image.

**Q**: Sometimes my cameras don't respond. Why?

**A**: Much like the behaviour some of us have experienced in the Nest app, sometimes the API errors out for unknown reasons.  See also this [issue](https://github.com/potmat/homebridge-google-nest-sdm/issues/4).  I am doing my best to find out why the API fails so often.

**Q**: My cameras never respond.  Why?

**A**: Remember, the newer battery Nest cameras are not supported at this time, they will not respond. If you see something like `[homebridge-google-nest-sdm] Failed to start stream: spawn ffmpeg ENOENT` in your logs?  The plugin requires ffmpeg and tries to auto-install it, but if it can't, you'll have to install it manually. Go [here](https://www.ffmpeg.org/download.html). 
Is your Apple device connected to a VPN? If so, disconnect, remember Homekit works with your local network. You can also try waiting a while, I have seen the API refuse all requests for short periods as well.

**Q**: When the plugin starts I get some message about ```Plugin initialization failed, there was a failure with event subscription```.  Why?

**A**: As the error message tells you, make sure you mind the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) when setting up your config values.

**Q**: My camera shows up as ```<null> Camera``` or ``` Camera``` without the room name or anything.  Why?

**A**: This is actually a glitch on the Google side, see [this comment](https://github.com/potmat/homebridge-google-nest-sdm/issues/6#issuecomment-978088908).

**Q**: I'm having problems getting through the getting started guide and getting the config values. Can you help?

**A**: Probably not.  Having a day job and family I don't have much time to help with this.  The Nest plugin for Home Assistant uses much the same process (don't forget the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) section above).  It has an [illustrated guide](https://www.home-assistant.io/integrations/nest/) that you may find helpful. You can also try reaching out to others on [Discord](https://discord.gg/kqNCe2D) or [Reddit](https://www.reddit.com/r/homebridge/), some people there may be able to help.

**Q**: Do I really have to pay $5 to use the API?

**A**: Yup.

**Q**: Isn't there already a Nest plugin for Homebridge that does more stuff than this?

**A**: Yup.

Q: So why this plugin?  

A: Well, the "official" Homebridge Nest plugin(s) use undocumented APIs.  That is, the authors reverse engineered the APIs the Nest app itself uses.  Don't get me wrong, I have no problem with that. But the SDM API is a documented API for precisely this use case.  The more important reason for making this plugin is the same as the reason for climbing a mountain, because you can.

Q: I just added a Nest device to my account, but it's not showing up in Home. Why?

A: You need to visit the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) URL again.  Here you will choose which Nest devices to authorize, you should see your new device here.  After you finish the process and get a new refresh token restart Homebridge, your device should now be visible.


