#!/usr/bin/env bash
#
# Homebridge Google Nest SDM - Automated Setup Script
#
# This script automates the Google Cloud Platform setup for homebridge-google-nest-sdm
# Some steps still require manual browser interaction (noted inline)
#
# Prerequisites:
#   - gcloud CLI installed (https://cloud.google.com/sdk/docs/install)
#   - A Google account with Nest devices migrated to Google Home
#   - $5 for Device Access registration (one-time fee)
#
# Usage: ./setup-nest-sdm.sh [PROJECT_NAME]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEFAULT_PROJECT_NAME="nest-homebridge"
PROJECT_NAME="${1:-$DEFAULT_PROJECT_NAME}"
SUBSCRIPTION_NAME="homebridge-events"
TOPIC_NAME="nest-events"

# Output file for credentials
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

# ============================================================================
# STEP 0: Check prerequisites
# ============================================================================
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

# Check if logged in
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
    print_warning "Not logged in to gcloud. Initiating login..."
    gcloud auth login
fi
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)
print_step "Logged in as: $ACCOUNT"

# ============================================================================
# STEP 1: Device Access Registration (Manual)
# ============================================================================
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

# ============================================================================
# STEP 2: Create or Select GCP Project
# ============================================================================
print_header "Step 2: Setting up Google Cloud Project"

# Generate a unique project ID
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

# Set the project as active
gcloud config set project "$PROJECT_ID"
print_step "Active project set to: $PROJECT_ID"

# ============================================================================
# STEP 3: Enable Required APIs
# ============================================================================
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

# ============================================================================
# STEP 4: Configure OAuth Consent Screen (Semi-Manual)
# ============================================================================
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
echo "6. Under Audiance -> 'Test users', add your email: $ACCOUNT"
echo ""
wait_for_user

# ============================================================================
# STEP 5: Create OAuth 2.0 Credentials
# ============================================================================
print_header "Step 5: Creating OAuth 2.0 Credentials"

# Check if credentials already exist
# EXISTING_CREDS=$(gcloud alpha iap oauth-clients list --project="$PROJECT_ID" 2>/dev/null | grep -c "homebridge" || echo "0")

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

# Prompt for credentials
echo ""
read -p "Enter your OAuth Client ID: " CLIENT_ID
read -p "Enter your OAuth Client Secret: " CLIENT_SECRET

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    print_error "Client ID and Secret are required!"
    exit 1
fi
print_step "OAuth credentials captured"

# ============================================================================
# STEP 6: Create Device Access Project (Manual)
# ============================================================================
print_header "Step 6: Create Device Access Project"

print_manual "Create your Device Access Project."
echo ""
echo "1. Open: https://console.nest.google.com/device-access"
echo "2. Click '+ Create project'"
echo "3. Enter project name: Homebridge"
echo "4. Enter OAuth Client ID: $CLIENT_ID"
echo "5. Enable events: YES"
echo "6. Click 'Create project'"
echo "7. COPY the Project ID (UUID format like: 32c4c2bc-fe0d-461b-b51c-f3885afff2f0)"
echo ""
wait_for_user

read -p "Enter your Device Access Project ID (UUID): " SDM_PROJECT_ID

if [ -z "$SDM_PROJECT_ID" ]; then
    print_error "Device Access Project ID is required!"
    exit 1
fi
print_step "Device Access Project ID captured: $SDM_PROJECT_ID"

# ============================================================================
# STEP 7: Create Pub/Sub Topic and Subscription
# ============================================================================
print_header "Step 7: Setting up Pub/Sub"

# Create topic
TOPIC_FULL_NAME="projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "Creating Pub/Sub topic: $TOPIC_NAME"
gcloud pubsub topics create "$TOPIC_NAME" --project="$PROJECT_ID" 2>/dev/null || {
    print_warning "Topic might already exist"
}
print_step "Topic created: $TOPIC_FULL_NAME"

# Grant SDM API permissions to publish to the topic
echo "Granting SDM API publish permissions..."
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --member="group:sdm-publisher@googlegroups.com" \
    --role="roles/pubsub.publisher" 2>/dev/null || {
    print_warning "IAM binding might already exist"
}
print_step "SDM publisher permissions granted"

# Create subscription
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

# ============================================================================
# STEP 8: Link Pub/Sub Topic to Device Access Project (Manual)
# ============================================================================
print_header "Step 8: Link Pub/Sub Topic to Device Access"

print_manual "Connect your Pub/Sub topic to Device Access."
echo ""
echo "1. Open: https://console.nest.google.com/device-access"
echo "2. Click on your project"
echo "3. Find 'Pub/Sub topic' section"
echo "4. Click '...' → 'Enable events with PubSub topic'"
echo "5. Enter topic: $TOPIC_FULL_NAME"
echo "6. Click 'Add & Validate'"
echo ""
wait_for_user
print_step "Pub/Sub topic linked"

# ============================================================================
# STEP 9: Authorize Account and Get Refresh Token
# ============================================================================
print_header "Step 9: Authorize Account and Get Refresh Token"

# Build the authorization URL with correct scopes
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

# Exchange authorization code for tokens
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
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi
print_step "Refresh token obtained successfully!"

# ============================================================================
# STEP 10: Test the API
# ============================================================================
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

# ============================================================================
# STEP 11: Generate Configuration
# ============================================================================
print_header "Step 11: Generating Homebridge Configuration"

# Create credentials JSON file
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
echo "  Client Secret:   $CLIENT_SECRET"
echo "  Project ID:      $SDM_PROJECT_ID"
echo "  Refresh Token:   ${REFRESH_TOKEN:0:20}..."
echo "  Subscription ID: $SUBSCRIPTION_FULL_NAME"
echo "  GCP Project ID:  $PROJECT_ID"
echo ""
echo "Configuration has been saved to: $OUTPUT_FILE"
echo ""
echo "Add the contents of this file to your Homebridge config.json"
echo "or use the Homebridge Config UI to enter these values."
echo ""
print_warning "Keep your credentials secure! Do not share them publicly."
echo ""
