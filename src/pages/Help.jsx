import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

// The user guide. Each section can be opened on its own, and a link like
// /help#close (from the "?" on Close the day) opens that section and
// scrolls to it. Keep this in step with the app when screens change.

export const HELP_SECTIONS = [
  {
    id: 'idea',
    title: 'The idea',
    body: (
      <>
        <p>
          Daily Docket keeps one list per day. Anything you don't finish moves to the next day by itself, so you never
          rewrite a list.
        </p>
        <ul>
          <li>
            A task that has moved shows <strong>↻ 2 days</strong>: how long it has been waiting since the day you first
            planned it.
          </li>
          <li>Tasks belong to areas, like Work, Home or PD1. Each area has its own colour.</li>
          <li>Nothing is ever deleted. Done and dropped tasks stay in History.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'today',
    title: 'Today',
    body: (
      <>
        <ul>
          <li>
            <strong>Carried over</strong> comes first, oldest at the top. Then <strong>Today</strong>, then{' '}
            <strong>Done today</strong>.
          </li>
          <li>Tap the circle to tick a task off. Tap it again to undo. Tap the title to open it.</li>
          <li>The area chips at the top show one area at a time. Tap All to see everything.</li>
          <li>
            <strong>Mine</strong> appears once you share an area. It hides tasks assigned to someone else.
          </li>
          <li>A yellow banner shows trips and events happening today.</li>
          <li>History, at the bottom, lists what you finished in the last 30 days and what you dropped.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'adding',
    title: 'Adding and editing tasks',
    body: (
      <>
        <ul>
          <li>
            Tap <strong>+</strong> at the bottom of Today, or type a title in the bar and press Enter.
          </li>
          <li>
            <strong>On my docket</strong> is the day you plan to do it: Today, Tomorrow or Pick a day. Or{' '}
            <strong>This week</strong>, for something to finish this week on no set day (see Week).
          </li>
          <li>
            <strong>Due date</strong> is optional: the real deadline, if there is one. The task still carries over day
            by day; the due date just reminds you.
          </li>
          <li>A task can sit in more than one area.</li>
          <li>
            <strong>Save and add another</strong> keeps the form open with the same areas and day, so you can enter a
            batch, like a week of study sessions. After the first one, Enter adds the next.
          </li>
          <li>
            <strong>Paste a list instead</strong>, under the title, turns several lines into separate tasks: one per
            line, all with the areas and day or week you pick. Copy a list from your notes app and paste it. Indented
            lines become steps (a checklist) of the line above.
          </li>
          <li>
            <strong>Drop this task</strong>, at the bottom of the form, takes it off your docket. You can restore it
            from History.
          </li>
        </ul>
        <h3>Notes</h3>
        <ul>
          <li>Use the toolbar for bullets, numbered lists and checklists, or start a line with "- ", "1. " or "- [ ] ".</li>
          <li>Enter continues the list; numbers fix themselves. Press Enter on an empty item to end the list.</li>
          <li>
            Wrap words in **two stars** to make them bold. Web addresses become links. Tick checklist items without
            opening Edit.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'close',
    title: 'Close the day',
    body: (
      <>
        <p>
          At the end of the day, tap <strong>Close day</strong> to decide where each unfinished task goes. Every task
          starts on <strong>Tomorrow</strong>, so one tap on Confirm rolls everything forward.
        </p>
        <ul>
          <li>
            <strong>Tomorrow</strong>, <strong>Pick day</strong> (any date) or <strong>Drop</strong>.
          </li>
          <li>Nothing is saved until you tap Confirm.</li>
          <li>Right after closing, Undo appears for a few seconds.</li>
          <li>
            Changed your mind later? <strong>Reopen</strong>, on the "Day closed" bar on Today, puts everything back as
            it was. It's there for the rest of that day.
          </li>
          <li>
            Closing is optional. If you skip it, unfinished tasks still move to the next day on their own.
          </li>
          <li>It only moves your own jobs, never a shared task that belongs to someone else.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'week',
    title: 'Week',
    body: (
      <>
        <ul>
          <li>One week at a time, Monday to Sunday. The arrows page to later weeks.</li>
          <li>Tap a day to see all of its tasks and add one on that day.</li>
          <li>Trips and events show as tags on the days they cover.</li>
          <li>The suitcase opens Trips &amp; events.</li>
          <li>Pick an area chip to see only that area. That also shows Shift plan.</li>
        </ul>
        <h3>This week: goals for the whole week</h3>
        <ul>
          <li>
            For work planned by the week, not the day. Make each job its own area (like TDX and V1), then add tasks
            with <strong>This week</strong>, or tap <strong>Add</strong> on the This week panel.
          </li>
          <li>
            The panel at the top of Week has one card per job: its name, "1 of 3" and a progress bar. Tap a card to open
            it and see its tasks; tap again to fold it. Picking an area chip opens that job's card.
          </li>
          <li>
            <strong>Steps:</strong> give a task a checklist in its notes and it shows "2/5". Tap that to tick steps
            without opening the task. A half-done task fills half its share of the bar. Ticking the last step asks
            whether to mark the task done.
          </li>
          <li>
            <strong>→ Today</strong>, at the end of a row, moves that task onto Today as a normal task.
          </li>
          <li>
            Anything unfinished moves into the next week on its own, marked "↻ 1 week". Close the day leaves these
            alone, and they're not in the morning digest.
          </li>
          <li>Today shows a one-line summary ("This week: TDX 1/3 · V1 0/3"). Tap it to open Week.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'shift',
    title: 'Shift plan',
    body: (
      <>
        <p>
          For a plan with flexible dates, like exam study. On Week, pick an area, then tap{' '}
          <strong>Shift … plan</strong>.
        </p>
        <ul>
          <li>Choose how many days to move every open task in that area: forward if you're behind, back if you're ahead.</li>
          <li>The preview shows where the last task, and so your finish date, will land.</li>
          <li>Nothing moves until you tap Shift. Undo appears for a few seconds afterwards.</li>
          <li>This-week tasks move a whole week for every 7 days; shorter shifts leave them where they are.</li>
          <li>It only moves your own tasks.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Sharing an area',
    body: (
      <>
        <ul>
          <li>
            Settings → Manage areas → open an area's share panel, then invite by email. The person needs a Daily
            Docket login with that same email.
          </li>
          <li>
            No email is sent. They join the next time they open Daily Docket signed in. Their badge then changes from
            Invited to Joined.
          </li>
          <li>Members can see, add, edit and tick that area's tasks. Your other areas stay private.</li>
          <li>Only the owner can rename, recolour or delete an area. Members can leave it.</li>
        </ul>
        <h3>Assigning</h3>
        <ul>
          <li>In a shared area, a task can be for Anyone, Me, or a named person.</li>
          <li>The person you assign gets a notification, if notifications are on for them.</li>
          <li>Tags show who it's for ("→ name") and who finished it ("✓ by name").</li>
          <li>A task is your job if it's assigned to you, or if no one is assigned and you added it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'trips',
    title: 'Trips and events',
    body: (
      <>
        <ul>
          <li>
            <strong>Trip</strong>: someone is away. Pick who, and the days they leave and come back.
          </li>
          <li>
            <strong>Event</strong>: something on a date, like an exam. All day, or with a start time and an optional end
            time. "Ends another day" makes it span several days.
          </li>
          <li>Everyone in the area you choose sees it on Today and Week, and can edit it.</li>
          <li>Trips and events never carry over.</li>
          <li>Who's away only lists people who have joined the chosen area.</li>
        </ul>
        <h3>Your calendar</h3>
        <ul>
          <li>
            Settings → Calendar → <strong>Add</strong> puts trips and events into Google Calendar. Do this from a
            computer; the Google Calendar phone app can't subscribe to links.
          </li>
          <li>
            Or <strong>Copy</strong> the link, and in Google Calendar on the web use + next to Other calendars, then
            From URL.
          </li>
          <li>It's one way: change things here and your calendar follows. Google checks every few hours.</li>
          <li>Each person adds their own link. Reset link makes the old one stop working.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'notifications',
    title: 'Notifications',
    body: (
      <ul>
        <li>Switch them on in Settings, once on each phone or computer.</li>
        <li>
          On iPhone they only work from the home-screen app: in Safari, tap Share, then Add to Home Screen, and open
          Daily Docket from there.
        </li>
        <li>
          <strong>Morning digest</strong>: one notification at the time you choose, weekdays or every day, with how
          many tasks you have and what's first. Days with nothing on your docket are skipped.
        </li>
        <li>"Send today's digest now" shows you one straight away.</li>
      </ul>
    ),
  },
  {
    id: 'trouble',
    title: 'When something seems wrong',
    body: (
      <dl className="help-faq">
        <dt>Someone isn't listed under Who's away</dt>
        <dd>
          Check that the trip is in a shared area, and that their badge in the share panel says Joined. If it says
          Invited, they need to sign in once.
        </dd>
        <dt>A task disappeared</dt>
        <dd>
          It was probably moved to a later day, or it's a This week task: look on Week. Dropped tasks are in History,
          where you can restore them.
        </dd>
        <dt>Google Calendar hasn't updated</dt>
        <dd>
          Google checks every few hours. To confirm the link works, open it in a browser: a calendar file should
          download with your trips in it.
        </dd>
        <dt>A new calendar doesn't show on my phone</dt>
        <dd>
          In the Google Calendar app: Settings → your account → Daily Docket → turn on Sync. For iPhone's own
          Calendar app, tick it at calendar.google.com/calendar/syncselect.
        </dd>
        <dt>No notifications</dt>
        <dd>
          In Settings, check that "Notifications on this device" is on, and use Send a test. On iPhone, open Daily
          Docket from the home screen, not Safari.
        </dd>
      </dl>
    ),
  },
]

/** How Daily Docket works: a short guide, one section per topic. */
export default function Help() {
  const location = useLocation()
  const navigate = useNavigate()
  // Back to wherever the guide was opened from; Settings if opened directly
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/settings'))
  const wanted = location.hash.slice(1)
  const [open, setOpen] = useState(() => new Set(wanted ? [wanted] : []))

  // Opened from a "?" link: open that section and bring it into view
  useEffect(() => {
    if (!wanted) return
    setOpen((prev) => new Set(prev).add(wanted))
    requestAnimationFrame(() => document.getElementById(`help-${wanted}`)?.scrollIntoView({ block: 'start' }))
  }, [wanted])

  const toggle = (id, isOpen) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <div className="screen help-screen">
      <header className="close-header">
        <button type="button" className="text-btn back-link" onClick={goBack}>
          Back
        </button>
        <span className="eyebrow">DAILY DOCKET</span>
        <h1>How it works</h1>
      </header>

      <main className="lists">
        <div className="help-list">
          {HELP_SECTIONS.map((s) => (
            <details
              key={s.id}
              id={`help-${s.id}`}
              className="help-section"
              open={open.has(s.id)}
              onToggle={(e) => toggle(s.id, e.currentTarget.open)}
            >
              <summary>
                <span>{s.title}</span>
                <span aria-hidden="true" className="chevron help-chevron">
                  ›
                </span>
              </summary>
              <div className="help-body">{s.body}</div>
            </details>
          ))}
        </div>
      </main>
    </div>
  )
}
