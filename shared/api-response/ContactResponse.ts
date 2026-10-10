import type { UserContact } from '@shared/db/Contact'

export type ContactResponse = Pick<UserContact, 'id' | 'type' | 'displayName' | 'createdAt'>

export type ContactLinkResponse = {
  url: string
  expiresAt: Date | number
}
