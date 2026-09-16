#!/usr/bin/env bash
#
# Homebridge Google Nest SDM - Automated Setup Script
# Author: WeekendSuperhero (https://github.com/WeekendSuperhero)
# Usage: ./setup-nest-sdm.sh [PROJECT_NAME]

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
DEFAULT_PROJECT_NAME="nest-homebridge"
PROJECT_NAME="${1:-$DEFAULT_PROJECT_NAME}"
SUBSCRIPTION_NAME="homebridge-events"
TOPIC_NAME="nest-events"
OUTPUT_FILE="nest-sdm-credentials.json"

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_manual() {
    echo -e "${YELLOW}[MANUAL STEP REQUIRED]${NC} $1"
}

wait_for_user() {
    echo -e "\n${YELLOW}Press Enter to continue after completing the manual step...${NC}"
    read -r
}

print_header "Step 0: Checking Prerequisites"

if ! command -v gcloud &> /dev/null; then
    print_error "gcloud CLI is not installed."
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi
print_step "gcloud CLI found"

if ! command -v jq &> /dev/null; then
    print_warning "jq is not installed. Installing..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y jq
    elif command -v brew &> /dev/null; then
        brew install jq
    else
        print_error "Please install jq manually"
        exit 1
    fi
fi
print_step "jq found"

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
    print_warning "Not logged in to gcloud. Initiating login..."
    gcloud auth login
fi
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
print_step "Logged in as: $ACCOUNT"

print_header "Step 1: Device Access Registration (Manual - \$5 one-time fee)"

print_manual "You must register for Device Access before proceeding."
echo ""
echo "1. Open: https://console.nest.google.com/device-access"
echo "2. Accept the Terms of Service"
echo "3. Pay the \$5 registration fee"
echo "4. IMPORTANT: Use the same Google account that has your Nest devices!"
echo ""
print_warning "This step cannot be automated due to payment requirement."
wait_for_user

print_header "Step 2: Setting up Google Cloud Project"
PROJECT_ID="${PROJECT_NAME}-$(date +%s | tail -c 6)"

echo "Checking for existing projects..."
EXISTING_PROJECTS=$(gcloud projects list --format="value(projectId)" 2>/dev/null | grep "^${PROJECT_NAME}" || true)

if [ -n "$EXISTING_PROJECTS" ]; then
    echo ""
    echo "Found existing projects matching '${PROJECT_NAME}':"
    echo "$EXISTING_PROJECTS"
    echo ""
    read -p "Use existing project? Enter project ID or press Enter to create new: " SELECTED_PROJECT

    if [ -n "$SELECTED_PROJECT" ]; then
        PROJECT_ID="$SELECTED_PROJECT"
        print_step "Using existing project: $PROJECT_ID"
    else
        print_step "Creating new project: $PROJECT_ID"
        gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME" 2>/dev/null || true
    fi
else
    print_step "Creating new project: $PROJECT_ID"
    gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME" 2>/dev/null || {
        print_warning "Project creation failed. It may already exist."
    }
fi

gcloud config set project "$PROJECT_ID"
print_step "Active project set to: $PROJECT_ID"

print_header "Step 3: Enabling Required APIs"

echo "Enabling Smart Device Management API..."
gcloud services enable smartdevicemanagement.googleapis.com --project="$PROJECT_ID" 2>/dev/null || {
    print_warning "SDM API might already be enabled or requires billing"
}
print_step "Smart Device Management API enabled"

echo "Enabling Cloud Pub/Sub API..."
gcloud services enable pubsub.googleapis.com --project="$PROJECT_ID" 2>/dev/null || {
    print_warning "Pub/Sub API might already be enabled"
}
print_step "Cloud Pub/Sub API enabled"

print_header "Step 4: Configure OAuth Consent Screen"

print_manual "Configure the OAuth consent screen in the browser."
echo ""
echo "1. Open: https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID"
echo "2. Select 'External' user type (unless you have Google Workspace)"
echo "3. Click 'Create'"
echo "4. Fill in:"
echo "   - App name: Homebridge Nest SDM"
echo "   - User support email: $ACCOUNT"
echo "   - Developer contact email: $ACCOUNT"
echo "5. Click 'Save and Continue' through all steps"
echo ""
print_warning "Two settings on this screen break the setup later if missed."
echo ""
echo "6. Under Audience -> 'Test users', ADD: $ACCOUNT"
echo "   Without this the authorization in step 9 ends at:"
echo "     Error 403: access_denied - can only be accessed by developer-approved testers"
echo ""
echo "7. Under Audience, click 'PUBLISH APP' and confirm."
echo "   While the app is in Testing, Google expires refresh tokens after 7 DAYS."
echo "   Everything works, then stops a week later with 'invalid_grant'."
echo "   SDM uses a restricted scope. Verification is not required for personal"
echo "   use - publishing only adds an 'Advanced -> Go to (unsafe)' click"
echo "   during authorization, and makes the token permanent."
echo "   (Internal user type on a Workspace account: neither applies - answer y.)"
echo ""
wait_for_user

read -p "Confirm you added $ACCOUNT as a Test user and published the app [y/N]: " CONSENT_OK
if [[ ! "$CONSENT_OK" =~ ^[Yy]$ ]]; then
    print_error "Both are required. Re-run once they are set."
    exit 1
fi
print_step "Consent screen confirmed"

print_header "Step 5: Creating OAuth 2.0 Credentials"

print_manual "Create OAuth 2.0 credentials in the browser."
echo ""
echo "1. Open: https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo "2. Click '+ CREATE CREDENTIALS' → 'OAuth client ID'"
echo "3. Application type: 'Web application'"
echo "4. Name: 'Homebridge Nest SDM'"
echo "5. Under 'Authorized redirect URIs', click '+ ADD URI'"
echo "6. Enter: https://www.google.com"
echo "7. Click 'Create'"
echo "8. COPY the Client ID and Client Secret shown in the popup!"
echo ""
wait_for_user

echo ""
# Google now shows only the last four characters of the secret and offers no
# download after creation, so the JSON handed over at creation time is the only
# full copy. Reading it avoids a mistyped secret, which surfaces as
# 'invalid_client' during the token exchange and reads like a code fault.
CLIENT_JSON=$(ls -t ~/Downloads/client_secret_*.json 2>/dev/null | head -1)
if [ -n "$CLIENT_JSON" ]; then
    echo "Found a downloaded client secret file:"
    echo "  $CLIENT_JSON"
    read -p "Read the credentials from it? [Y/n]: " USE_JSON
    if [[ ! "$USE_JSON" =~ ^[Nn]$ ]]; then
        CLIENT_ID=$(jq -r '.web.client_id // .installed.client_id // empty' "$CLIENT_JSON" 2>/dev/null || true)
        CLIENT_SECRET=$(jq -r '.web.client_secret // .installed.client_secret // empty' "$CLIENT_JSON" 2>/dev/null || true)
        [ -n "$CLIENT_ID" ] && print_step "Read client ID $CLIENT_ID from $(basename "$CLIENT_JSON")"
    fi
fi

if [ -z "$CLIENT_ID" ]; then
    read -p "Enter your OAuth Client ID: " CLIENT_ID
fi
if [ -z "$CLIENT_SECRET" ]; then
    read -p "Enter your OAuth Client Secret: " CLIENT_SECRET
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    print_error "Client ID and Secret are required!"
    echo "If the secret was lost, add a SECOND secret on the same client - it does"
    echo "not invalidate the first - and use the JSON offered at creation."
    exit 1
fi
print_step "OAuth credentials captured"

print_header "Step 6: Setting up Pub/Sub"

TOPIC_FULL_NAME="projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "Creating Pub/Sub topic: $TOPIC_NAME"
gcloud pubsub topics create "$TOPIC_NAME" --project="$PROJECT_ID" 2>/dev/null || {
    print_warning "Topic might already exist"
}
print_step "Topic created: $TOPIC_FULL_NAME"

echo "Granting SDM API publish permissions..."
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --member="group:sdm-publisher@googlegroups.com" \
    --role="roles/pubsub.publisher" 2>/dev/null || {
    print_warning "IAM binding might already exist"
}
print_step "SDM publisher permissions granted"

SUBSCRIPTION_FULL_NAME="projects/$PROJECT_ID/subscriptions/$SUBSCRIPTION_NAME"
echo "Creating Pub/Sub subscription: $SUBSCRIPTION_NAME"
gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
    --project="$PROJECT_ID" \
    --topic="$TOPIC_NAME" \
    --ack-deadline=20 \
    --message-retention-duration=1d 2>/dev/null || {
    print_warning "Subscription might already exist"
}
print_step "Subscription created: $SUBSCRIPTION_FULL_NAME"

print_header "Step 7: Create Device Access Project"

print_manual "Create your Device Access Project."
echo ""
echo "1. Open: https://console.nest.google.com/device-access"
echo "2. Click '+ Create project'"
echo "3. Enter project name: Homebridge"
echo "4. Enter OAuth Client ID: $CLIENT_ID"
echo "5. Enable events: YES"
echo "6. Paste this Pub/Sub topic when prompted (required, validated on the spot):"
echo ""
echo "      $TOPIC_FULL_NAME"
echo ""
echo "7. Click 'Create project'"
echo "8. COPY the Project ID (UUID format like: 32c4c2bc-fe0d-461b-b51c-f3885afff2f0)"
echo ""
wait_for_user

read -p "Enter your Device Access Project ID (UUID): " SDM_PROJECT_ID

if [ -z "$SDM_PROJECT_ID" ]; then
    print_error "Device Access Project ID is required!"
    exit 1
fi
print_step "Device Access Project ID captured: $SDM_PROJECT_ID"


print_header "Step 8: Confirm Pub/Sub Topic Link"

print_manual "Confirm the topic is linked."
echo ""
echo "1. Open: https://console.nest.google.com/device-access"
echo "2. Click on your project"
echo "3. The 'Pub/Sub topic' section should already show:"
echo ""
echo "      $TOPIC_FULL_NAME"
echo ""
echo "4. If it is empty, click '...' → 'Enable events with PubSub topic',"
echo "   enter the topic above, and click 'Add & Validate'"
echo ""
wait_for_user
print_step "Pub/Sub topic linked"

print_header "Step 9: Authorize Account and Get Refresh Token"

AUTH_URL="https://nestservices.google.com/partnerconnections/${SDM_PROJECT_ID}/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=${CLIENT_ID}&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub"

print_manual "Authorize your account to access Nest devices."
echo ""
echo "1. Open this URL in your browser:"
echo ""
echo "   $AUTH_URL"
echo ""
echo "2. Sign in with your Google account that has the Nest devices"
echo "3. Select your Nest devices and allow access"
echo "4. You'll be redirected to google.com with a URL like:"
echo "   https://www.google.com?code=XXXXXX&scope=..."
echo "5. COPY the 'code' parameter value from the URL"
echo ""
print_warning "IMPORTANT: The URL includes +https://www.googleapis.com/auth/pubsub scope!"
echo ""
wait_for_user

read -p "Enter the authorization code from the URL: " AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
    print_error "Authorization code is required!"
    exit 1
fi

echo ""
echo "Exchanging authorization code for tokens..."
TOKEN_RESPONSE=$(curl -s -X POST \
    "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" \
    -d "code=$AUTH_CODE" \
    -d "grant_type=authorization_code" \
    -d "redirect_uri=https://www.google.com")

REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

if [ -z "$REFRESH_TOKEN" ]; then
    print_error "Failed to get refresh token!"
    # Print only the error fields. This branch also fires when Google returns a
    # valid access_token and no refresh_token (re-authorising a client that
    # already has a grant), so echoing the whole response would put a live
    # credential on screen in the case most likely to be pasted into an issue.
    if [ -z "$TOKEN_RESPONSE" ]; then
        echo "Empty response from the token endpoint (network or proxy problem)."
    else
        echo "Error: $(echo "$TOKEN_RESPONSE" | jq -r '.error // "unknown"' 2>/dev/null || echo "unparsable response")"
        echo "Description: $(echo "$TOKEN_RESPONSE" | jq -r '.error_description // "none"' 2>/dev/null || echo "none")"
    fi
    if [ -n "$ACCESS_TOKEN" ]; then
        echo ""
        print_warning "Google returned an access token but no refresh token."
        echo "The URL above sets prompt=consent, which normally forces one even for"
        echo "a client that already has a grant. Revoke the grant at"
        echo "https://myaccount.google.com/permissions, then re-run and open the URL"
        echo "exactly as printed."
    fi
    exit 1
fi
print_step "Refresh token obtained successfully!"

print_header "Step 10: Testing API Access"

echo "Fetching devices to verify setup..."
DEVICES_RESPONSE=$(curl -s -X GET \
    "https://smartdevicemanagement.googleapis.com/v1/enterprises/${SDM_PROJECT_ID}/devices" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")

DEVICE_COUNT=$(echo "$DEVICES_RESPONSE" | jq '.devices | length // 0')

if [ "$DEVICE_COUNT" -gt 0 ]; then
    print_step "Found $DEVICE_COUNT device(s)!"
    echo ""
    echo "Devices found:"
    echo "$DEVICES_RESPONSE" | jq -r '.devices[]? | "  - \(.traits["sdm.devices.traits.Info"].customName // .name)"'
else
    print_warning "No devices found. This could mean:"
    echo "  - You haven't authorized any devices"
    echo "  - Devices are still being synced"
    echo "  - There's a configuration issue"
fi

print_header "Step 11: Generating Homebridge Configuration"

cat > "$OUTPUT_FILE" << EOF
{
  "platform": "homebridge-google-nest-sdm",
  "clientId": "$CLIENT_ID",
  "clientSecret": "$CLIENT_SECRET",
  "projectId": "$SDM_PROJECT_ID",
  "refreshToken": "$REFRESH_TOKEN",
  "subscriptionId": "$SUBSCRIPTION_FULL_NAME",
  "gcpProjectId": "$PROJECT_ID"
}
EOF

print_step "Configuration saved to: $OUTPUT_FILE"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  SETUP COMPLETE!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Your Homebridge configuration values:"
echo ""
echo "  Platform:        homebridge-google-nest-sdm"
echo "  Client ID:       $CLIENT_ID"
echo "  Client Secret:   ${CLIENT_SECRET:0:6}... (full value in $OUTPUT_FILE)"
echo "  Project ID:      $SDM_PROJECT_ID"
echo "  Refresh Token:   ${REFRESH_TOKEN:0:20}..."
echo "  Subscription ID: $SUBSCRIPTION_FULL_NAME"
echo "  GCP Project ID:  $PROJECT_ID"
echo ""
echo "Configuration has been saved to: $OUTPUT_FILE"
echo ""
echo "Add the contents of this file to your Homebridge config.json"
echo "or use the Homebridge Config UI to enter these values."
print_warning "Keep your credentials secure! Do not share them publicly."
