[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/donate/?business=EVN8JACZRMPTJ&no_recurring=1&currency_code=CAD)

# homebridge-google-nest-sdm

A Homebridge plugin for Google Nest devices that uses the [Google Smart Device Management API](https://developers.google.com/nest/device-access). Supports Cameras, Doorbells, Displays, and Thermostats.  Supports HomeKit Secure Video (please read the section on HKSV below).

**Please read the [FAQ](https://github.com/potmat/homebridge-google-nest-sdm#faq) before creating an issue.** If you are having trouble with the setup process you can try reaching out to others in [Discussions](https://github.com/potmat/homebridge-google-nest-sdm/discussions), on [Discord](https://discord.gg/kqNCe2D), or [Reddit](https://www.reddit.com/r/homebridge/), some people there may be able to help.



# Disclaimer

This package is not affiliated with, provided, endorsed, or supported by Google in any way.  It is intended for personal, non-commercial use only.  Please review the [Google Smart Device Management Terms of Service](https://developers.google.com/nest/device-access/tos) to ensure that your usage of this package is not in violation.

# Installation

``npm install -g --unsafe-perm homebridge-google-nest-sdm``

Don't forget the ``--unsafe-perm`` part!

# Example Homebridge config:

    {
        "platform" : "homebridge-google-nest-sdm",
        "clientId": "...",
        "clientSecret": "...",
        "projectId": "...",
        "refreshToken": "...",
        "subscriptionId": "...",
        "gcpProjectId": "<optional>",
        "vEncoder": "<optional>",
        "showFan": "<optional>",
        "fanDuration": "<optional>",
        "structureId": "<optional>",
    }

I recommend you use the plugin config UI to enter these values.

# Where do the config values come from?

Follow the getting started guide here: https://developers.google.com/nest/device-access/get-started  Please mind the "ONE IMPORTANT DIFFERENCE" section below.

**clientId** and **clientSecret** come from this step: https://developers.google.com/nest/device-access/get-started#set_up_google_cloud_platform.  **clientId** should look something like "780816631155-gbvyo1o7r2pn95qc4ei9d61io4uh48hl.apps.googleusercontent.com". **clientSecret** will be a random string of letters, numbers, and dashes.

**projectId** comes from this step: https://developers.google.com/nest/device-access/get-started#create_a_device_access_project

**refreshToken** comes from this step: https://developers.google.com/nest/device-access/authorize#get_an_access_token

**subscriptionId** comes from this step: https://developers.google.com/nest/device-access/subscribe-to-events#create_a_pull_subscription. It should look like "projects/your-gcp-project-id/subscriptions/your-subscription-id".

**gcpProjectId** is optional. It is the ID of the Google Cloud Platform project you created when getting the **clientId** and **clientSecret**. If you are having trouble subsribing to events try populating this field.

**vEncoder** is optional.  It is the encoder the plugin will use for camera streams. If vEncoder is not specified it will default to "libx264 -preset ultrafast -tune zerolatency". You can use "copy" to not transcode streams at all, this will require almost no CPU, and seems to work fine on most devices, however it's not guaranteed to work in all scenarios. On a Raspberry Pi 4 you can try something like "h264_v4l2m2m".  On other platforms you are free to use the encoder of your choice.  If you don't know what this means you can probably ignore it.

**showFan** is optional.  If true, a fan accessory will be added.

**fanDuration** is optional. You only need to use this if **showFan** is set to true. It controls the fan duration (in seconds) when turning on the fan.  Must be between 1 and 43200.  Defaults to 900 if not set.

**structureId** is optional. If you have more than one home or "structure" on your account then you
might want to set this. There will be information in the console about which structures are
available. You may want to create a unique `subscriptionId` for each Homebridge instance.

ONE IMPORTANT DIFFERENCE!

In step two "Authorize an Account" in the "Link your account" section, step 1, you are instructed to "open the following link in a web browser":

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service

DO NOT USE THIS URL!

You should instead use this URL:

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub

Note the "+https://www.googleapis.com/auth/pubsub" on the end.  This is so you will have access to events.

# HomeKit Secure Video

This plugin does support HKSV.  Before creating an issue that HKSV isn't working for you, please take note of how HKSV works:

1) The SDM API reports motion for a camera.
2) This plugin reports a motion event to Homebridge.
3) Homebridge reports that event to your home hub (e.g. HomePod, iPad).
4) The hub requests a video stream from the camera from Homebridge.
5) This plugin initiates a stream request to the SDM API, transcodes the video to the format requested by the hub, and sends it to the hub via Homebridge.
6) The hub analyzes the video for motion.
7) If the hub sees motion it will log an event in the camera timeline with the clip.

This means that even though there was a motion event, YOU MAY NOT SEE ANYTHING IN THE CAMERA TIMELINE.  This could be because your hub decided that it didn't really see any motion, or, more likely, by the time we reached step six the motion has already ended.

Continuous recording of all camera streams would likely mitigate this effect, but for a variety of reasons this is simply not practicable with the SDM API the way it's written.  To say nothing of the bandwidth and CPU requirements this would entail.

# Hardware Requirements

If are are not using the "copy" vEncoder the minimum hardware requirement is something like a Raspberry Pi 4.  If you want multiple people viewing the camera streams at once then you'll probably need even more power. If you are using the "copy" vEncoder you may be able to use a very low power device, but results are not guaranteed.

HomeKit Secure Video will require even more CPU power.  The clips need to be transcoded using the CPU.  Note that transcoding clips for even a single camera with a lot of activity can easily consume 100% of the CPU on a Rasberry Pi-4.  If you want HKSV on for many cameras you'll need a dedicated server of some kind.

# FAQ

**Q**: HomeKit Secure Video isn't working. Why?

**A**: Please see the HKSV section above.

**Q**: I don't see camera snapshots in the Home app, just the Nest/Google logo. Why?

**A**: The SDM API does not have any method for getting a camera snapshot on demand, only when an event occurs. The Nest logo is used as a placeholder for first generation cameras, while the Google logo is used for second generation cameras.  If an event occurred in the last few seconds you will likely see an image.

**Q**: My cameras never respond.  Why?

**A**: There are a couple possible reasons for this:

1. Is the microphone/audio disabled on your camera?  If so you will need to enable it.
2. Do you see something like `[homebridge-google-nest-sdm] Failed to start stream: spawn ffmpeg ENOENT` in your logs? The plugin requires ffmpeg and tries to auto-install it, but if it can't, you'll have to install it manually. For Windows go [here](https://www.ffmpeg.org/download.html). If you have a Mac, especially an Apple Silicon Mac, you should probably use [brew](https://formulae.brew.sh/formula/ffmpeg). On Linux use the package manager of your choice.
3. Are you running Homebridge inside a Docker container?  Possibly on something like Unraid? This setup seems to cause problems with ffmpeg being able to accept input, and with WebRTC streams being able to transfer data to the container. Try running Homebridge natively on your network instead of in a Docker container.
4. Is your Apple device connected to a VPN? If so, disconnect.
5. Wait a while, occasionally the API will refuse all requests for short periods.

**Q**: My cameras only respond some of the time. Why?

**A**: Much like the behaviour some of us have experienced in the Nest app, sometimes the API errors out for unknown reasons.  See also this [issue](https://github.com/potmat/homebridge-google-nest-sdm/issues/4).  I am doing my best to find out why the API fails so often.

**Q**: My cameras stream stops responding after five minutes. Why?

**A**: Streams on the battery powered cameras only last five minutes.  On the wired cameras it's in theory possible to view the stream for more than five minutes, but I haven't figured out how to make that work yet.

**Q**: When the plugin starts I get some message about ```Plugin initialization failed, there was a failure with event subscription```.  Why?

**A**: As the error message tells you, make sure you mind the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) when setting up your config values.  Try using the **gcpProjectId** config value if you continue to have problems.

**Q**: My camera shows up as ```<null> Camera``` or ``` Camera``` without the room name or anything.  Why?

**A**: This is actually a glitch on the Google side, see [this comment](https://github.com/potmat/homebridge-google-nest-sdm/issues/6#issuecomment-978088908).

**Q**: I'm having problems getting through the getting started guide and getting the config values. Can you help?

**A**: Probably not.  Having a day job and family I don't have much time to help with this.  The Nest plugin for Home Assistant uses much the same process (don't forget the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) section above).  It has an [illustrated guide](https://www.home-assistant.io/integrations/nest/) that you may find helpful. You can also try reaching out to others in [Discussions](https://github.com/potmat/homebridge-google-nest-sdm/discussions), on [Discord](https://discord.gg/kqNCe2D), or [Reddit](https://www.reddit.com/r/homebridge/), some people there may be able to help.

**Q**: Do I really have to pay $5 to use the API?

**A**: Yup.

**Q**: Isn't there already a Nest plugin for Homebridge that does more stuff than this?

**A**: Yup.

**Q**: So why this plugin?

**A**: Well, the "official" Homebridge Nest plugin(s) use undocumented APIs.  That is, the authors reverse engineered the APIs the Nest app itself uses.  Don't get me wrong, I have no problem with that. But the SDM API is a documented API for precisely this use case.  The more important reason for making this plugin is the same as the reason for climbing a mountain, because you can.

**Q**: I just added a Nest device to my account, but it's not showing up in Home. Why?

**A**: You need to visit the ["ONE IMPORTANT DIFFERENCE"](https://github.com/potmat/homebridge-google-nest-sdm#where-do-the-config-values-come-from) URL again.  Here you will choose which Nest devices to authorize, you should see your new device here.  After you finish the process and get a new refresh token restart Homebridge, your device should now be visible.


