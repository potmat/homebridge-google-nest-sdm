# homebridge-google-nest-sdm

A homebridge plugin that uses the Google Smart Device Management API. Supports Cameras, Doorbells, Displays, and Thermostats.

*Currently does not support the new battery powered cameras/doorbells.  The SDM API does support these devices, but I don't have one, so I have no way to test it. If anyone has one of the new battery cameras they're willing to loan me it should not be that hard to add.* 

# Example Homebridge config:

    {
      "platform" : "homebridge-google-nest-sdm",
      "options": {
        "clientId": "...",
        "clientSecret": "...",
        "projectId": "...",
        "refreshToken": "...",
        "subscriptionId": "...",
        "vEncoder": "<optional>"
      }
    }
    
# Where do the config values come from?

Follow the getting started guide here: https://developers.google.com/nest/device-access/get-started

ONE IMPORTANT DIFFERENCE!

In step two "Authorize an Account" in the "Link your account" section, step 1, you are instructed to "open the following link in a web browser":

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service

DO NOT USE THIS URL!

You should instead use this URL:

https://nestservices.google.com/partnerconnections/project-id/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=oauth2-client-id&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub

Note the "+https://www.googleapis.com/auth/pubsub" on the end.  This is so you will have access to events.

# vEncoder

If not specified will default to "libx264 -preset ultrafast -tune zerolatency".

On a Raspberry Pi 4 you can try something like "h264_v4l2m2m". On other platforms use the encoder of your choice.

# Hardware Requirements

The minimum hardware requirement is something like a Raspberry Pi 4.  If you want multiple people viewing the streams at once then you'd probably need even more.

I tried very hard to avoid having to transcode the video, which would allow the plugin to run on something like a pi-zero.  Unfortunately this is simply not possible, the Apple Home App will not properly display the native stream.  In most cases the frame rate will be off, or it will fail to show at all (the iPhone will not show any video higher than 1080p, the Nest Doorbell produces video at a higher resolution).


