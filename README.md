# homebridge-google-nest-sdm

A homebridge plugin that uses the Google Smart Device Management API.

Currently only supports cameras (not the new battery powered ones) and thermostats.  Copies the RTSP stream directly from your Nest cam to Home, no transcoding.

# Example Homebridge config:

    {
      "platform" : "homebridge-google-nest-sdm",
      "options": {
        "clientId": "...",
        "clientSecret": "...",
        "projectId": "...",
        "refreshToken": "..."
      }
    }
    
# Where do the config values come from?

Follow the getting started guide here: https://developers.google.com/nest/device-access/get-started
