import { createContext, useContext } from 'react'

/**
 * Who's who, for "added by" tags. Provided once in App:
 *   { meId, people: { [userId]: email } }
 */
export const PeopleContext = createContext({ meId: null, people: {} })

export const usePeople = () => useContext(PeopleContext)

/** 'husband.name@example.com' -> 'Husband.name' (short enough for a tag). */
export function shortName(email) {
  if (!email) return 'Someone'
  const local = email.split('@')[0]
  const name = local.charAt(0).toUpperCase() + local.slice(1)
  return name.length > 14 ? name.slice(0, 13) + '…' : name
}
