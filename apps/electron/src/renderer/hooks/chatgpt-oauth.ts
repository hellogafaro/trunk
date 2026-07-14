const CALLBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface ChatGptCallback {
  code: string
  state: string
}

export function parseChatGptCallbackUrl(value: string, expectedState: string): ChatGptCallback {
  let url: URL

  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Paste the complete callback URL from the browser address bar.')
  }

  if (
    url.protocol !== 'http:'
    || !CALLBACK_HOSTS.has(url.hostname)
    || url.port !== '1455'
    || url.pathname !== '/auth/callback'
  ) {
    throw new Error('The callback URL must start with http://localhost:1455/auth/callback.')
  }

  const error = url.searchParams.get('error')
  if (error) {
    throw new Error(url.searchParams.get('error_description') || error)
  }

  const state = url.searchParams.get('state')
  if (!state || state !== expectedState) {
    throw new Error('OAuth state mismatch. Start the ChatGPT connection again.')
  }

  const code = url.searchParams.get('code')
  if (!code) {
    throw new Error('The callback URL does not contain an authorization code.')
  }

  return { code, state }
}
