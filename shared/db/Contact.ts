import type { DBColumnTypesCheck } from '@shared/db'
import type { Audit } from './Audit'

export const CONTACT_TYPES = ['telegram'] as const
export type ContactType = typeof CONTACT_TYPES[number]

// Email is kept on the user table, but can be used for verification like any other contact type
export const VERIFICATION_CONTACT_TYPES = ['email', ...CONTACT_TYPES] as const
export type VerificationContactType = typeof VERIFICATION_CONTACT_TYPES[number]

export type UserContact = Pick<Audit, 'createdAt' | 'updatedAt'> & {
  id: string
  userId: string
  type: ContactType
  address: string // channel specific address, ex. telegram chat id
  displayName?: string | null // human readable address, ex. telegram username
}

export type ContactVerification = Pick<Audit, 'createdAt'> & {
  id: string
  userId: string
  type: ContactType
  address?: string | null // address being verified, if known before verification
  challenge: string
  expiresAt: Date | number
}

const _typeCheckContact: DBColumnTypesCheck<UserContact> = true
const _typeCheckVerification: DBColumnTypesCheck<ContactVerification> = true
