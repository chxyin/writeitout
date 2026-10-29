import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The provider loads Google's Identity Services script and hands the client ID
// down to every Google button below it. It wraps the whole app rather than the
// splash screen alone, so any future signed-in surface can use the same script
// instead of loading it a second time.
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.jsx'
import { GOOGLE_CLIENT_ID } from './lib/googleAuth.js'

// GOOGLE_CLIENT_ID falls back to this project's own web client, so the provider
// always has an id to hand the script. The log is for the case where a fork
// replaces that fallback and forgets the variable: sign-in would then fail at
// Google's origin check with nothing in the console to explain it.
if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
  console.info(
    'VITE_GOOGLE_CLIENT_ID is not set for this build; using the project client ID. ' +
      'Set it in frontend/.env (see frontend/.env.example) to use your own OAuth client.'
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* The provider must sit above <App />: the splash screen's GoogleLogin button
        is rendered deep inside it and needs the script the provider loads. */}
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
)
