# Homebridge Google Nest SDM - Improved Setup Guide

This guide streamlines the setup process for [homebridge-google-nest-sdm](https://github.com/potmat/homebridge-google-nest-sdm) using a combination of automation scripts and clear manual steps.

**Last Updated:** 2025-12-17  
**Contributors:** [WeekendSuperhero](https://github.com/WeekendSuperhero)

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Automated)](#quick-start-automated)
- [Manual Setup](#manual-setup)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required

1. **Google Account** with Nest devices migrated to Google Home app
2. **$5 USD** - One-time Device Access registration fee (non-refundable)
3. **Homebridge** installed and running

### For Automated Setup

4. **gcloud CLI** - [Installation Guide](https://cloud.google.com/sdk/docs/install)
5. **jq** - JSON processor (auto-installed by script if missing)

### Verify gcloud Installation

```bash
# Check if gcloud is installed
gcloud --version

# Login to your Google account
gcloud auth login
```

---

## Quick Start (Automated)

The automated script handles most GCP configuration and guides you through manual steps.

### 1. Download and Run the Setup Script

```bash
# Download the setup script
curl -O https://raw.githubusercontent.com/potmat/setup-nest-sdm.sh

# Make it executable
chmod +x setup-nest-sdm.sh

# Run the script
./setup-nest-sdm.sh
```

### 2. Follow the Interactive Prompts

The script will:

- ✅ Check prerequisites
- ✅ Create/configure GCP project
- ✅ Enable required APIs
- ✅ Create Pub/Sub topic and subscription
- ✅ Guide you through manual OAuth steps
- ✅ Generate your Homebridge configuration

### 3. Add to Homebridge

Copy the generated configuration from `nest-sdm-credentials.json` to your Homebridge config.

---

## Manual Setup

If you prefer manual setup or the script doesn't work for your environment.

### Step 1: Register for Device Access ($5 fee)

1. Go to [Device Access Console](https://console.nest.google.com/device-access)
2. Accept Terms of Service
3. Pay the $5 registration fee
4. **Use the Google account that has your Nest devices**

### Step 2: Create or Use Existing Google Cloud Project

You can either create a new GCP project or use an existing one.

#### Option A: Using gcloud CLI

**Create a new project:**

```bash
PROJECT_NAME="nest-homebridge"
PROJECT_ID="${PROJECT_NAME}-$(date +%s | tail -c 6)"

gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
gcloud config set project "$PROJECT_ID"
```

**Or use an existing project:**

```bash
PROJECT_ID="your-existing-project-id"
gcloud config set project "$PROJECT_ID"
```

**Enable required APIs:**

```bash
gcloud services enable smartdevicemanagement.googleapis.com
gcloud services enable pubsub.googleapis.com
```

#### Option B: Using Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable [Smart Device Management API](https://console.cloud.google.com/apis/library/smartdevicemanagement.googleapis.com)
4. Enable [Cloud Pub/Sub API](https://console.cloud.google.com/apis/library/pubsub.googleapis.com)

### Step 3: Configure OAuth Consent Screen

1. Go to [OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent)
2. Select **External** user type
3. Fill in required fields:
   - App name: `Homebridge Nest SDM`
   - User support email: Your email
   - Developer contact email: Your email
4. Save and continue through all steps
5. Under **Audience** --> **Test users**, add your Google account email

### Step 4: Create OAuth 2.0 Credentials

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Homebridge Nest SDM`
5. Authorized redirect URIs: `https://www.google.com`
6. Click **Create**
7. **Save the Client ID and Client Secret**

### Step 5: Create Device Access Project

1. Go to [Device Access Console](https://console.nest.google.com/device-access)
2. Click **+ Create project**
3. Enter project name
4. Enter your OAuth Client ID
5. **Enable events: YES**
6. Click **Create project**
7. **Save the Project ID (UUID format)**

### Step 6: Set Up Pub/Sub

#### Option A: Using gcloud CLI

```bash
# Variables (replace with your values)
PROJECT_ID="your-gcp-project-id"
TOPIC_NAME="nest-events"
SUBSCRIPTION_NAME="homebridge-events"

# Create topic
gcloud pubsub topics create "$TOPIC_NAME" --project="$PROJECT_ID"

# Grant SDM API publish permissions
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --member="group:sdm-publisher@googlegroups.com" \
    --role="roles/pubsub.publisher"

# Create subscription
gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
    --project="$PROJECT_ID" \
    --topic="$TOPIC_NAME" \
    --ack-deadline=20 \
    --message-retention-duration=1d

# Display full subscription ID (save this!)
echo "Subscription ID: projects/$PROJECT_ID/subscriptions/$SUBSCRIPTION_NAME"
```

#### Option B: Using Google Cloud Console

1. Go to [Pub/Sub Topics](https://console.cloud.google.com/cloudpubsub/topic)
2. Click **+ CREATE TOPIC**
3. Topic ID: `nest-events`
4. Click **Create**
5. Click on the topic, then **Permissions**
6. Add principal: `sdm-publisher@googlegroups.com`
7. Role: **Pub/Sub Publisher**
8. Go to [Pub/Sub Subscriptions](https://console.cloud.google.com/cloudpubsub/subscription)
9. Click **+ CREATE SUBSCRIPTION**
10. Subscription ID: `homebridge-events`
11. Select your topic
12. Click **Create**

### Step 7: Link Pub/Sub Topic to Device Access

1. Go to [Device Access Console](https://console.nest.google.com/device-access)
2. Click on your project
3. Find **Pub/Sub topic** section
4. Click **Enable events with PubSub topic**
5. Enter: `projects/YOUR-GCP-PROJECT-ID/topics/nest-events`
6. Click **Add & Validate**

### Step 8: Authorize and Get Refresh Token

#### Build Authorization URL

**CRITICAL**: Use this URL format (includes Pub/Sub scope):

```
https://nestservices.google.com/partnerconnections/PROJECT_ID/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=CLIENT_ID&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub
```

Replace:

- `PROJECT_ID` with your Device Access Project ID (UUID)
- `CLIENT_ID` with your OAuth Client ID

#### Authorize and Get Code

1. Open the URL in your browser
2. Sign in and authorize access to your Nest devices
3. After redirect, copy the `code` parameter from the URL

#### Exchange Code for Refresh Token

```bash
# Using curl
curl -X POST "https://oauth2.googleapis.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=https://www.google.com"
```

The response will include your `refresh_token`. **Save this!**

---

## Configuration Reference

### Homebridge config.json

```json
{
  "platforms": [
    {
      "platform": "homebridge-google-nest-sdm",
      "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "refreshToken": "YOUR_REFRESH_TOKEN",
      "subscriptionId": "projects/YOUR-GCP-PROJECT/subscriptions/homebridge-events",
      "gcpProjectId": "YOUR-GCP-PROJECT-ID"
    }
  ]
}
```

### Configuration Parameters

| Parameter        | Required | Description                          | Example                               |
| ---------------- | -------- | ------------------------------------ | ------------------------------------- |
| `platform`       | Yes      | Must be `homebridge-google-nest-sdm` | `homebridge-google-nest-sdm`          |
| `clientId`       | Yes      | OAuth 2.0 Client ID                  | `780816...apps.googleusercontent.com` |
| `clientSecret`   | Yes      | OAuth 2.0 Client Secret              | `GOCSPX-...`                          |
| `projectId`      | Yes      | Device Access Project ID (UUID)      | `32c4c2bc-fe0d-...`                   |
| `refreshToken`   | Yes      | OAuth refresh token                  | `1//0g...`                            |
| `subscriptionId` | Yes      | Full Pub/Sub subscription path       | `projects/.../subscriptions/...`      |
| `gcpProjectId`   | No       | GCP Project ID (helps with events)   | `nest-homebridge-123456`              |
| `vEncoder`       | No       | Video encoder for streams            | `libx264 -preset ultrafast`           |
| `showFan`        | No       | Show fan accessory for thermostats   | `true` or `false`                     |
| `fanDuration`    | No       | Fan duration in seconds (1-43200)    | `900`                                 |

---

## Troubleshooting

### Verify Your Setup

Run the verification script to check your configuration:

```bash
./scripts/verify-nest-sdm.sh nest-sdm-credentials.json
```

This will test:

- API access and authentication
- Device discovery
- Pub/Sub configuration
- Enabled APIs

### Common Issues

#### "Events not working"

1. Verify Pub/Sub subscription exists:

   ```bash
   gcloud pubsub subscriptions list --project=YOUR_PROJECT
   ```

2. Check for unacknowledged messages:

   ```bash
   gcloud pubsub subscriptions pull homebridge-events --project=YOUR_PROJECT --auto-ack
   ```

3. Verify SDM publisher permissions:
   ```bash
   gcloud pubsub topics get-iam-policy nest-events --project=YOUR_PROJECT
   ```

#### "Authorization failed"

- Make sure you used the URL with `+https://www.googleapis.com/auth/pubsub` scope
- Re-authorize by getting a new code and refresh token

#### "No devices found"

1. Verify devices are in Google Home app (not Nest app)
2. Check you authorized the correct Google account
3. Test API directly:
   ```bash
   curl -X GET \
     "https://smartdevicemanagement.googleapis.com/v1/enterprises/YOUR_PROJECT_ID/devices" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```

#### "Subscription ID format error"

The subscription ID must be the full path:

```
projects/YOUR-GCP-PROJECT-ID/subscriptions/YOUR-SUBSCRIPTION-NAME
```

Not just the subscription name.

### Verify Setup with gcloud

```bash
# List enabled APIs
gcloud services list --enabled --project=YOUR_PROJECT

# List Pub/Sub topics
gcloud pubsub topics list --project=YOUR_PROJECT

# List Pub/Sub subscriptions
gcloud pubsub subscriptions list --project=YOUR_PROJECT

# Test pulling messages
gcloud pubsub subscriptions pull YOUR_SUBSCRIPTION --project=YOUR_PROJECT --limit=5
```

### Get a New Access Token

If you need to test API calls:

```bash
curl -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=YOUR_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```

---

## Additional Resources

- [Official Google Device Access Documentation](https://developers.google.com/nest/device-access)
- [homebridge-google-nest-sdm GitHub](https://github.com/potmat/homebridge-google-nest-sdm)
- [Homebridge Discord](https://discord.gg/homebridge)
- [Google Cloud Console](https://console.cloud.google.com)
- [Device Access Console](https://console.nest.google.com/device-access)
