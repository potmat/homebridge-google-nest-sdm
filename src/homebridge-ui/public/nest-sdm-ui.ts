// @ts-ignore
const {homebridge} = window

const authButton = document.getElementById('authButton')! as HTMLButtonElement
const authUrlInput = document.getElementById('authUrlInput')! as HTMLInputElement
const tokenLoadingSpinner = document.getElementById('tokenLoadingSpinner')!

// Initialize UI
;(async () => {
    try {
        homebridge.showSpinner()

        // Create initial config if necessary
        const initialConfig = await homebridge.getPluginConfig()
        if (!initialConfig.length) {
            initialConfig.push({platform: 'homebridge-google-nest-sdm'})
            await homebridge.updatePluginConfig(initialConfig)
        }

        // Setup UI listeners
        // @ts-ignore
        authUrlInput.addEventListener('input', debounce(onAuthUrlInput, 500))
        authButton.addEventListener('click', initiateAuthFlow)

        // Update UI state & show form
        updateAuthUiState(initialConfig)
        homebridge.showSchemaForm()

        // Listen for config changes
        homebridge.addEventListener('configChanged', (event: any) => {
            updateAuthUiState(event.data)
        })
    } catch (e: any) {
        homebridge.toast.error(e.message)
    } finally {
        homebridge.hideSpinner()
    }
})()

async function initiateAuthFlow() {
    const currentConfig = await homebridge.getPluginConfig()

    // clear out current refresh token
    currentConfig[0].refreshToken = ''
    await homebridge.updatePluginConfig(currentConfig)

    // open OAuth window
    const {projectId, clientId} = currentConfig[0]
    window.open(
        `https://nestservices.google.com/partnerconnections/${projectId}/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=${clientId}&response_type=code&scope=https://www.googleapis.com/auth/sdm.service+https://www.googleapis.com/auth/pubsub`
    )
}

function updateAuthUiState(
    currentConfig: Array<{ clientId: string; clientSecret: string; projectId: string; subscriptionId: string }>
) {
    const enableUi =
        !!currentConfig[0].clientId &&
        !!currentConfig[0].clientSecret &&
        !!currentConfig[0].projectId &&
        !!currentConfig[0].subscriptionId

    authButton.disabled = !enableUi
    authUrlInput.disabled = !enableUi
}

async function onAuthUrlInput(e: Event) {
    const currentUrl: string = (e.target as any)?.value ?? ''

    if (currentUrl && currentUrl.includes('code=')) {
        try {
            tokenLoadingSpinner.style.visibility = 'visible'

            const currentConfig = await homebridge.getPluginConfig()
            const {clientId, clientSecret} = currentConfig[0]
            const code = currentUrl.replace(/^.*code=([^&]+).*$/, '$1')

            currentConfig[0].refreshToken = await homebridge.request('/refreshToken', {
                clientId,
                clientSecret,
                code
            })

            await homebridge.updatePluginConfig(currentConfig)

            homebridge.toast.success('Refresh token generated successfully!')
        } catch (e: any) {
            homebridge.toast.error(e.message)
        } finally {
            tokenLoadingSpinner.style.visibility = 'hidden'
        }
    }
}
