import type { ContactType, UserContact } from '@shared/db/Contact'
import { getUserContacts } from '../db/contacts'
import { logger } from '../util/logger'
import type { ContactChannel, ContactMessage } from './channel'
import { startTelegram, telegramChannel } from './telegram'

const channels: Record<ContactType, ContactChannel> = {
  telegram: telegramChannel,
}

export function startContactChannels() {
  startTelegram()
}

export function activeContactTypes(): ContactType[] {
  return Object.values(channels).filter(c => c.isActive()).map(c => c.type)
}

export function isActiveContact(contact: Pick<UserContact, 'type'>) {
  return channels[contact.type].isActive()
}

/**
 * Send a message to every verified contact of a user on an active channel
 * @returns the number of contacts the message was sent to
 */
export async function sendToUserContacts(userId: string, message: ContactMessage): Promise<number> {
  let sent = 0
  for (const contact of await getUserContacts(userId)) {
    const channel = channels[contact.type]
    if (!channel.isActive()) {
      continue
    }

    try {
      await channel.send(contact, message)
      sent++
    } catch (e) {
      logger({
        level: 'error',
        message: `Error occurred while sending message to ${contact.type} contact.`,
        errors: e instanceof Error ? [e] : [{ message: String(e) }],
      })
    }
  }
  return sent
}
