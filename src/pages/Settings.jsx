import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fetchSettings, saveSettings } from '../lib/api.js'
import {
  currentSubscription,
  isInstalled,
  isIOS,
  permissionState,
  pushConfigured,
  pushSupported,
  sendDigestNow,
  sendTestPush,
  turnOffPush,
  turnOnPush,
} from '../lib/push.js'

/** Settings: notifications on this device, the morning digest, and your account. */
export default function Settings({ userId, userEmail, onSignOut, announce }) {
  const [on, setOn] = useState(null) // null = checking
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [digest, setDigest] = useState(null) // null = loading
  const [digestError, setDigestError] = useState(null)

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

  useEffect(() => {
    fetchSettings()
      .then((s) => setDigest(s ?? { timezone: null, digestOn: true, digestTime: '07:30', digestDays: 'weekdays' }))
      .catch((e) => setDigestError(e.message))
  }, [])

  // Save one change; put it back if the save fails
  async function updateDigest(change) {
    const before = digest
    setDigest((d) => ({ ...d, ...change }))
    setDigestError(null)
    try {
      await saveSettings(userId, change)
    } catch (e) {
      setDigest(before)
      setDigestError(e.message)
    }
  }

  async function handleDigestNow() {
    setBusy(true)
    setDigestError(null)
    try {
      const { sent, skipped } = await sendDigestNow()
      if (skipped) announce('Nothing on your docket today, so no digest')
      else if (sent === 0) setDigestError('No devices received it. Turn notifications on first.')
      else announce(`Digest sent to ${sent} ${sent === 1 ? 'device' : 'devices'}`)
    } catch (e) {
      setDigestError(e.message)
    }
    setBusy(false)
  }

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
          <h2 className="section-title">Morning digest</h2>
          {digest === null && !digestError && <p className="empty">Loading…</p>}
          {digest && (
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-text">
                  <span className="settings-name" id="digest-label">Send today's list</span>
                  <span className="settings-sub">One notification: how many tasks, carry-overs, and what's first.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={digest.digestOn}
                  aria-labelledby="digest-label"
                  className={`switch${digest.digestOn ? ' is-on' : ''}`}
                  onClick={() => updateDigest({ digestOn: !digest.digestOn })}
                >
                  <span />
                </button>
              </div>

              <div className={`settings-row${digest.digestOn ? '' : ' is-muted'}`}>
                <label className="settings-text" htmlFor="digest-time">
                  <span className="settings-name">Time</span>
                  {digest.timezone && <span className="settings-sub">Your time ({digest.timezone.replace(/_/g, ' ')})</span>}
                </label>
                <input
                  id="digest-time"
                  type="time"
                  className="box-input time-input"
                  min="04:00"
                  max="20:00"
                  step="900"
                  value={digest.digestTime}
                  disabled={!digest.digestOn}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v >= '04:00' && v <= '20:00') updateDigest({ digestTime: v })
                    else setDigestError('Pick a time between 4:00 am and 8:00 pm.')
                  }}
                />
              </div>

              <div className={`settings-row${digest.digestOn ? '' : ' is-muted'}`}>
                <div className="settings-text">
                  <span className="settings-name">Days</span>
                </div>
                <div className="chip-row" role="group" aria-label="Which days">
                  {[
                    ['weekdays', 'Weekdays'],
                    ['every', 'Every day'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`chip${digest.digestDays === value ? ' is-on' : ''}`}
                      aria-pressed={digest.digestDays === value}
                      disabled={!digest.digestOn}
                      onClick={() => updateDigest({ digestDays: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-text">
                  <span className="settings-name">Send today's digest now</span>
                  <span className="settings-sub">To check how it looks. Doesn't affect tomorrow's.</span>
                </div>
                <button type="button" className="restore-btn" disabled={!on || busy} onClick={handleDigestNow}>
                  Send
                </button>
              </div>
            </div>
          )}
          <p className="hint">Days with nothing on your docket are skipped.</p>
          {digestError && (
            <p className="form-error" role="alert">
              {digestError}
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
