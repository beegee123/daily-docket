import { createContext, useContext } from 'react'

/**
 * Who's who. Provided once in App:
 *   meId        – the signed-in person
 *   people      – { [userId]: email } for everyone I share an area with
 *   areaPeople  – { [areaId]: [userId, ...] } owner and joined members
 */
export const PeopleContext = createContext({ meId: null, people: {}, areaPeople: {} })

/** Is an area shared (more than one person in it)? */
export const isShared = (areaPeople, areaId) => (areaPeople[areaId]?.length ?? 0) > 1

/** 'Me' for myself, otherwise a short name. */
export const nameFor = (userId, meId, people) => (userId === meId ? 'Me' : shortName(people[userId]))

export const usePeople = () => useContext(PeopleContext)

/** 'husband.name@example.com' -> 'Husband.name' (short enough for a tag). */
export function shortName(email) {
  if (!email) return 'Someone'
  const local = email.split('@')[0]
  const name = local.charAt(0).toUpperCase() + local.slice(1)
  return name.length > 14 ? name.slice(0, 13) + '…' : name
}
