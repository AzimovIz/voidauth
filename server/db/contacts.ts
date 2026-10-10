import { randomBytes, randomUUID } from 'node:crypto'
import { TABLES } from '@shared/db'
import { TTLs } from '@shared/constants'
import type { ContactType, ContactVerification, UserContact } from '@shared/db/Contact'
import { db } from './db'
import { createExpiration } from './util'

export async function getUserContacts(userId: string): Promise<UserContact[]> {
  return await db().select().table<UserContact>(TABLES.USER_CONTACT)
    .where({ userId })
    .orderBy('createdAt', 'asc')
}

export async function getUserContact(userId: string, type: ContactType): Promise<UserContact | undefined> {
  return await db().select().table<UserContact>(TABLES.USER_CONTACT)
    .where({ userId, type })
    .first()
}

export async function deleteUserContact(userId: string, id: string) {
  return await db().delete().table<UserContact>(TABLES.USER_CONTACT)
    .where({ userId, id })
}

/**
 * Create a new pending contact verification, replacing any previous one of the same type for the user
 */
export async function createContactVerification(userId: string, type: ContactType, address: string | null = null) {
  await db().delete().table<ContactVerification>(TABLES.CONTACT_VERIFICATION)
    .where({ userId, type })

  const verification: ContactVerification = {
    id: randomUUID(),
    userId,
    type,
    address,
    challenge: randomBytes(24).toString('base64url'),
    expiresAt: createExpiration(TTLs.VERIFICATION_CONTACT),
    createdAt: new Date(),
  }
  await db().table<ContactVerification>(TABLES.CONTACT_VERIFICATION).insert(verification)

  return verification
}

export async function getContactVerification(type: ContactType, challenge: string): Promise<ContactVerification | undefined> {
  return await db().select().table<ContactVerification>(TABLES.CONTACT_VERIFICATION)
    .where({ type, challenge })
    .andWhere('expiresAt', '>=', new Date())
    .first()
}

/**
 * Consume a contact verification and save the now verified contact for the user,
 * replacing any previous contact of the same type
 */
export async function completeContactVerification(
  verification: ContactVerification,
  address: string,
  displayName: string | null,
): Promise<{ contact: UserContact } | { error: 'address_in_use' }> {
  const existing = await db().select().table<UserContact>(TABLES.USER_CONTACT)
    .where({ type: verification.type, address })
    .first()

  if (existing && existing.userId !== verification.userId) {
    return { error: 'address_in_use' }
  }

  await db().delete().table<ContactVerification>(TABLES.CONTACT_VERIFICATION)
    .where({ id: verification.id })
  await db().delete().table<UserContact>(TABLES.USER_CONTACT)
    .where({ userId: verification.userId, type: verification.type })

  const contact: UserContact = {
    id: randomUUID(),
    userId: verification.userId,
    type: verification.type,
    address,
    displayName,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db().table<UserContact>(TABLES.USER_CONTACT).insert(contact)

  return { contact }
}
