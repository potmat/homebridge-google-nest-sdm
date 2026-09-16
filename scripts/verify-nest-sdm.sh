#!/usr/bin/env bash
#
# Homebridge Google Nest SDM - Verification & Troubleshooting Script
# Author: WeekendSuperhero (https://github.com/WeekendSuperhero)
# Usage: ./verify-nest-sdm.sh [config-file]

set -e

CONFIG_FILE="${1:-nest-sdm-credentials.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

print_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
print_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Check for required tools
check_tools() {
    print_header "Checking Required Tools"

    local all_good=true

    if command -v gcloud &> /dev/null; then
        print_pass "gcloud CLI installed ($(gcloud --version 2>/dev/null | head -1))"
    else
        print_fail "gcloud CLI not found"
        all_good=false
    fi

    if command -v jq &> /dev/null; then
        print_pass "jq installed"
    else
        print_fail "jq not found (install with: apt install jq)"
        all_good=false
    fi

    if command -v curl &> /dev/null; then
        print_pass "curl installed"
    else
        print_fail "curl not found"
        all_good=false
    fi

    $all_good
}

# Load configuration
load_config() {
    print_header "Loading Configuration"

    if [ ! -f "$CONFIG_FILE" ]; then
        print_fail "Config file not found: $CONFIG_FILE"
        echo ""
        echo "Usage: $0 [config-file]"
        echo ""
        echo "You can also set environment variables:"
        echo "  CLIENT_ID, CLIENT_SECRET, PROJECT_ID, REFRESH_TOKEN, SUBSCRIPTION_ID, GCP_PROJECT_ID"
        exit 1
    fi

    CLIENT_ID=$(jq -r '.clientId // empty' "$CONFIG_FILE")
    CLIENT_SECRET=$(jq -r '.clientSecret // empty' "$CONFIG_FILE")
    PROJECT_ID=$(jq -r '.projectId // empty' "$CONFIG_FILE")
    REFRESH_TOKEN=$(jq -r '.refreshToken // empty' "$CONFIG_FILE")
    SUBSCRIPTION_ID=$(jq -r '.subscriptionId // empty' "$CONFIG_FILE")
    GCP_PROJECT_ID=$(jq -r '.gcpProjectId // empty' "$CONFIG_FILE")

    # Validate required fields
    if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$PROJECT_ID" ] || [ -z "$REFRESH_TOKEN" ]; then
        print_fail "Missing required configuration values"
        exit 1
    fi

    print_pass "Configuration loaded from $CONFIG_FILE"
    print_info "SDM Project ID: $PROJECT_ID"
    print_info "GCP Project ID: ${GCP_PROJECT_ID:-Not set}"
    print_info "Subscription ID: ${SUBSCRIPTION_ID:-Not set}"
}

# Get access token
get_access_token() {
    print_header "Obtaining Access Token"

    local response=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
        -d "client_id=$CLIENT_ID" \
        -d "client_secret=$CLIENT_SECRET" \
        -d "refresh_token=$REFRESH_TOKEN" \
        -d "grant_type=refresh_token")

    ACCESS_TOKEN=$(echo "$response" | jq -r '.access_token // empty')

    if [ -z "$ACCESS_TOKEN" ]; then
        print_fail "Failed to get access token"
        echo "Response: $response"
        return 1
    fi

    print_pass "Access token obtained successfully"
    return 0
}

# Test API access
test_api() {
    print_header "Testing SDM API Access"

    local response=$(curl -s -X GET \
        "https://smartdevicemanagement.googleapis.com/v1/enterprises/${PROJECT_ID}/devices" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}")

    local error=$(echo "$response" | jq -r '.error.message // empty')

    if [ -n "$error" ]; then
        print_fail "API Error: $error"
        return 1
    fi

    local device_count=$(echo "$response" | jq '.devices | length // 0')

    if [ "$device_count" -gt 0 ]; then
        print_pass "Found $device_count device(s)"
        echo ""
        echo "Devices:"
        echo "$response" | jq -r '.devices[] | "  - \(.traits["sdm.devices.traits.Info"].customName // "Unknown") (\(.type | split(".") | last))"'
    else
        print_warn "No devices found"
        echo "  This could mean:"
        echo "  - No devices were authorized"
        echo "  - Devices are still syncing"
    fi
}

# Test Pub/Sub
test_pubsub() {
    print_header "Testing Pub/Sub Configuration"

    if [ -z "$SUBSCRIPTION_ID" ]; then
        print_warn "Subscription ID not configured"
        return 0
    fi

    # Extract project and subscription name
    local gcp_project=$(echo "$SUBSCRIPTION_ID" | sed -n 's/projects\/\([^\/]*\)\/subscriptions\/.*/\1/p')
    local sub_name=$(echo "$SUBSCRIPTION_ID" | sed -n 's/.*\/subscriptions\/\(.*\)/\1/p')

    if [ -z "$gcp_project" ] || [ -z "$sub_name" ]; then
        print_fail "Invalid subscription ID format"
        print_info "Expected format: projects/PROJECT_ID/subscriptions/SUBSCRIPTION_NAME"
        return 1
    fi

    print_info "GCP Project: $gcp_project"
    print_info "Subscription: $sub_name"

    # Check if gcloud is authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
        print_warn "Not logged in to gcloud, skipping Pub/Sub verification"
        return 0
    fi

    # Check subscription exists
    if gcloud pubsub subscriptions describe "$sub_name" --project="$gcp_project" &>/dev/null; then
        print_pass "Subscription exists"

        # Get subscription details
        local topic=$(gcloud pubsub subscriptions describe "$sub_name" --project="$gcp_project" --format="value(topic)")
        print_info "Connected to topic: $topic"

        # Check for pending messages
        local pending=$(gcloud pubsub subscriptions describe "$sub_name" --project="$gcp_project" --format="value(messageRetentionDuration)")
        print_info "Message retention: $pending"
    else
        print_fail "Subscription not found or not accessible"
    fi

    # Check topic permissions
    local topic_name=$(echo "$SUBSCRIPTION_ID" | sed 's/subscriptions/topics/' | sed "s/$sub_name/nest-events/")
    local topic_short=$(echo "$topic_name" | sed 's/.*\/topics\///')

    echo ""
    print_info "Checking topic permissions..."

    if gcloud pubsub topics get-iam-policy "$topic_short" --project="$gcp_project" 2>/dev/null | grep -q "sdm-publisher"; then
        print_pass "SDM publisher has access to topic"
    else
        print_warn "SDM publisher may not have access to topic"
        echo "  Run: gcloud pubsub topics add-iam-policy-binding $topic_short \\"
        echo "         --project=$gcp_project \\"
        echo "         --member='group:sdm-publisher@googlegroups.com' \\"
        echo "         --role='roles/pubsub.publisher'"
    fi
}

# Check enabled APIs
check_apis() {
    print_header "Checking Enabled APIs"

    if [ -z "$GCP_PROJECT_ID" ]; then
        print_warn "GCP Project ID not set, skipping API check"
        return 0
    fi

    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "@"; then
        print_warn "Not logged in to gcloud, skipping API check"
        return 0
    fi

    local sdm_enabled=$(gcloud services list --enabled --project="$GCP_PROJECT_ID" 2>/dev/null | grep -c "smartdevicemanagement" || echo "0")
    local pubsub_enabled=$(gcloud services list --enabled --project="$GCP_PROJECT_ID" 2>/dev/null | grep -c "pubsub" || echo "0")

    if [ "$sdm_enabled" -gt 0 ]; then
        print_pass "Smart Device Management API enabled"
    else
        print_fail "Smart Device Management API not enabled"
        echo "  Run: gcloud services enable smartdevicemanagement.googleapis.com --project=$GCP_PROJECT_ID"
    fi

    if [ "$pubsub_enabled" -gt 0 ]; then
        print_pass "Cloud Pub/Sub API enabled"
    else
        print_fail "Cloud Pub/Sub API not enabled"
        echo "  Run: gcloud services enable pubsub.googleapis.com --project=$GCP_PROJECT_ID"
    fi
}

# Generate new access token for testing
generate_test_token() {
    print_header "Generate Access Token for Testing"

    get_access_token || return 1

    echo ""
    echo "Access Token (valid for ~1 hour):"
    echo ""
    echo "$ACCESS_TOKEN"
    echo ""
    echo "Test with:"
    echo "  curl -X GET 'https://smartdevicemanagement.googleapis.com/v1/enterprises/${PROJECT_ID}/devices' \\"
    echo "    -H 'Authorization: Bearer \$TOKEN'"
}

# Main menu
show_menu() {
    echo ""
    echo "Available commands:"
    echo "  1) Run all checks"
    echo "  2) Test API access only"
    echo "  3) Test Pub/Sub only"
    echo "  4) Generate access token"
    echo "  5) Exit"
    echo ""
    read -p "Select option [1-5]: " choice

    case $choice in
        1) run_all_checks ;;
        2) get_access_token && test_api ;;
        3) test_pubsub ;;
        4) generate_test_token ;;
        5) exit 0 ;;
        *) echo "Invalid option" ;;
    esac
}

run_all_checks() {
    check_tools
    load_config
    get_access_token
    test_api
    check_apis
    test_pubsub

    print_header "Summary"
    echo "Verification complete. Check the results above for any issues."
}

# Main
case "${2:-all}" in
    --token)
        load_config
        generate_test_token
        ;;
    --api)
        load_config
        get_access_token
        test_api
        ;;
    --pubsub)
        load_config
        test_pubsub
        ;;
    --interactive)
        load_config
        while true; do
            show_menu
        done
        ;;
    *)
        run_all_checks
        ;;
esac
