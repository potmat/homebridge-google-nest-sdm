# homebridge-google-nest-sdm

A homebridge plugin that uses the Google Smart Device Management API.

Currently only supports cameras/doorbells, (not the new battery powered ones) and thermostats.  Copies the RTSP stream directly from your Nest cam to Home, no transcoding.

# Example Homebridge config:

    {
      "platform" : "homebridge-google-nest-sdm",
      "options": {
        "clientId": "...",
        "clientSecret": "...",
        "projectId": "...",
        "refreshToken": "...",
        "subscriptionId": "..."
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


