import type { ContactType, UserContact } from '@shared/db/Contact'

export type ContactMessage = {
  subject: string
  text: string
  url?: string
}

export type ContactChannel = {
  type: ContactType
  isActive: () => boolean
  send: (contact: UserContact, message: ContactMessage) => Promise<void>
}
