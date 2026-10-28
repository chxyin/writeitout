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

// A build without the client ID still renders — the button just cannot complete
// a sign-in — so the missing variable is called out once here, where the person
// running dev (or setting up a deploy) will actually see it.
if (!GOOGLE_CLIENT_ID) {
  console.warn(
    'Missing VITE_GOOGLE_CLIENT_ID: Google sign-in is disabled. ' +
      'Add it to frontend/.env (see frontend/.env.example) and restart the dev server.'
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
)
