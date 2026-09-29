/** A plain full-screen message: loading, setup needed, or an error. */
export default function StatusScreen({ title, message, action }) {
  return (
    <div className="screen status-screen" role={action ? 'alert' : 'status'}>
      <span className="eyebrow">DAILY DOCKET</span>
      <h1>{title}</h1>
      {message && <p>{message}</p>}
      {action}
    </div>
  )
}
