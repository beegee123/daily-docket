import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  currentSubscription,
  isInstalled,
  isIOS,
  permissionState,
  pushConfigured,
  pushSupported,
  sendTestPush,
  turnOffPush,
  turnOnPush,
} from '../lib/push.js'

/** Settings. For now: notifications on this device, and your account. */
export default function Settings({ userEmail, onSignOut, announce }) {
  const [on, setOn] = useState(null) // null = checking
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const supported = pushSupported()
  const needsInstall = isIOS() && !isInstalled()
  const blocked = supported && permissionState() === 'denied'

  useEffect(() => {
    if (!supported) {
      setOn(false)
      return
    }
    currentSubscription().then((sub) => setOn(Boolean(sub)))
  }, [supported])

  async function handleSwitch() {
    setBusy(true)
    setError(null)
    try {
      if (on) {
        await turnOffPush()
        setOn(false)
        announce('Notifications off on this device')
      } else {
        await turnOnPush()
        setOn(true)
        announce('Notifications on for this device')
      }
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  async function handleTest() {
    setBusy(true)
    setError(null)
    try {
      const { sent, removed, failed } = await sendTestPush()
      if (sent === 0) setError('No devices received it. Turn notifications on first.')
      else announce(`Test sent to ${sent} ${sent === 1 ? 'device' : 'devices'}`)
      if (failed) setError(`${failed} device(s) failed. Try turning notifications off and on again.`)
      if (removed) console.info(`Removed ${removed} old device(s)`)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  let hint = null
  if (!pushConfigured) hint = 'Push keys are not set up yet. Add VITE_VAPID_PUBLIC_KEY to .env.local and Vercel.'
  else if (needsInstall) hint = 'On iPhone, notifications only work from the home-screen app. In Safari, tap Share, then Add to Home Screen, and open Daily Docket from there.'
  else if (!supported) hint = "This browser can't receive notifications."
  else if (blocked) hint = 'Notifications are blocked for Daily Docket. Allow them in your phone or browser settings, then come back.'

  const canSwitch = pushConfigured && supported && !needsInstall && !blocked && on !== null

  return (
    <div className="screen settings">
      <header className="close-header">
        <Link to="/" className="text-btn back-link">Back to today</Link>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>Settings</h1>
      </header>

      <main className="lists">
        <section>
          <h2 className="section-title">Notifications</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-text">
                <span className="settings-name" id="push-label">Notifications on this device</span>
                <span className="settings-sub">Each phone or computer is switched on separately.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(on)}
                aria-labelledby="push-label"
                className={`switch${on ? ' is-on' : ''}`}
                disabled={!canSwitch || busy}
                onClick={handleSwitch}
              >
                <span />
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-text">
                <span className="settings-name">Send a test</span>
                <span className="settings-sub">Goes to every device you've switched on.</span>
              </div>
              <button type="button" className="restore-btn" disabled={!on || busy} onClick={handleTest}>
                Send
              </button>
            </div>
          </div>

          {hint && <p className="hint">{hint}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section>
          <h2 className="section-title">Account</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-text">
                <span className="settings-name">Signed in</span>
                <span className="settings-sub">{userEmail}</span>
              </div>
              <button type="button" className="restore-btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
