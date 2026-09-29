import { supabase } from './supabase.js'

// Everything about phone notifications on the app side.
// The flow: ask permission -> the browser gives us a "subscription"
// (an address plus keys) -> we save it in push_subscriptions -> the
// server can then send pushes to that address.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY)

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** Opened from the home-screen icon rather than a browser tab? */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

/** 'granted', 'denied' or 'default' (not asked yet). */
export function permissionState() {
  return 'Notification' in window ? Notification.permission : 'denied'
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.error('Service worker failed', e))
  })
}

/** This device's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** Must be called from a tap: phones only allow the permission prompt then. */
export async function turnOnPush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for Daily Docket in your phone or browser settings.')
  }

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true, // every push must show a notification
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    }))

  const { endpoint, keys } = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_device_name: deviceName(),
  })
  if (error) throw error
}

export async function turnOffPush() {
  const sub = await currentSubscription()
  if (!sub) return
  const { endpoint } = sub
  await sub.unsubscribe()
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}

/** Ask the server to send a test to all of my devices. */
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('send-test-push')
  if (error) {
    // Show the function's own message if it sent one
    const body = await error.context?.json?.().catch(() => null)
    throw new Error(body?.error ?? error.message)
  }
  return data // { sent, removed, failed }
}

// "iPhone · Safari", "Windows · Chrome"... just so you can tell devices apart
function deviceName() {
  const ua = navigator.userAgent
  const os = /iphone/i.test(ua)
    ? 'iPhone'
    : /ipad/i.test(ua)
      ? 'iPad'
      : /android/i.test(ua)
        ? 'Android'
        : /windows/i.test(ua)
          ? 'Windows'
          : /mac os/i.test(ua)
            ? 'Mac'
            : 'Device'
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : 'Browser'
  return `${os} · ${browser}`
}

// The VAPID key is text; the browser wants raw bytes
function base64UrlToBytes(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
