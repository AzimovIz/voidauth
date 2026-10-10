import appConfig from '../util/config'
import { logger, purgeAsyncLog } from '../util/logger'
import { als } from '../util/als'
import { commit, rollback, transaction } from '../db/db'
import { completeContactVerification, createContactVerification, getContactVerification } from '../db/contacts'
import type { UserContact } from '@shared/db/Contact'
import type { ContactLinkResponse } from '@shared/api-response/ContactResponse'
import type { ContactChannel, ContactMessage } from './channel'

const TELEGRAM_API = 'https://api.telegram.org'
const POLL_TIMEOUT = 30 // seconds, long polling timeout
const RETRY_DELAY = 15 * 1000 // ms, delay after a failed poll

type TelegramResult<T> = { ok: true, result: T } | { ok: false, error_code: number, description: string }

type TelegramUser = {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

type TelegramMessage = {
  message_id: number
  chat: {
    id: number
    type: 'private' | 'group' | 'supergroup' | 'channel'
  }
  from?: TelegramUser
  text?: string
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
}

class TelegramError extends Error {
  code: number

  constructor(method: string, code: number, description: string) {
    super(`Telegram ${method} failed (${String(code)}): ${description}`)
    this.code = code
  }
}

// set once the bot token has been validated with getMe
let botUsername: string | undefined

export function isTelegramActive() {
  return !!botUsername
}

async function callTelegram<T>(method: string, params: Record<string, unknown> = {}, timeout = 10): Promise<T> {
  // Do not include the request url in errors, it contains the bot token
  const res = await fetch(`${TELEGRAM_API}/bot${appConfig.TELEGRAM_BOT_TOKEN ?? ''}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeout * 1000),
  })

  const body = await res.json() as TelegramResult<T>
  if (!body.ok) {
    throw new TelegramError(method, body.error_code, body.description)
  }
  return body.result
}

async function sendText(chatId: string | number, text: string) {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  })
}

export const telegramChannel: ContactChannel = {
  type: 'telegram',
  isActive: isTelegramActive,
  async send(contact: UserContact, message: ContactMessage) {
    const text = [message.subject, message.text, message.url].filter(Boolean).join('\n\n')
    await sendText(contact.address, text)
  },
}

/**
 * Create a deep link that will link the users telegram account when they start the bot with it
 */
export async function createTelegramLink(userId: string): Promise<ContactLinkResponse | undefined> {
  if (!botUsername) {
    return undefined
  }

  const verification = await createContactVerification(userId, 'telegram')
  return {
    url: `https://t.me/${botUsername}?start=${verification.challenge}`,
    expiresAt: verification.expiresAt,
  }
}

async function linkChat(challenge: string, message: TelegramMessage): Promise<'linked' | 'expired' | 'address_in_use'> {
  return await als.run({}, async () => {
    await transaction()
    try {
      const verification = await getContactVerification('telegram', challenge)
      if (!verification) {
        await commit()
        return 'expired'
      }

      const result = await completeContactVerification(
        verification,
        String(message.chat.id),
        message.from?.username ? `@${message.from.username}` : (message.from?.first_name ?? null),
      )
      await commit()

      if ('error' in result) {
        return result.error
      }

      logger({
        level: 'info',
        message: `Telegram contact linked for user ${verification.userId}.`,
      })
      return 'linked'
    } catch (e) {
      await rollback()
      throw e
    } finally {
      purgeAsyncLog()
    }
  })
}

async function handleUpdate(update: TelegramUpdate) {
  const message = update.message
  // Only handle text messages in private chats with the bot
  if (!message?.text || message.chat.type !== 'private') {
    return
  }

  const challenge = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)\s*$/.exec(message.text.trim())?.[1]
  if (!challenge) {
    await sendText(message.chat.id,
      `This bot sends notifications from ${appConfig.APP_TITLE}. `
      + `To link your account, open the link from your profile page at ${appConfig.APP_URL}`)
    return
  }

  const result = await linkChat(challenge, message)
  switch (result) {
    case 'linked':
      await sendText(message.chat.id, `Your Telegram account is now linked to ${appConfig.APP_TITLE}.`)
      break
    case 'expired':
      await sendText(message.chat.id, 'This link is invalid or has expired. Please request a new one.')
      break
    case 'address_in_use':
      await sendText(message.chat.id, `This Telegram account is already linked to another ${appConfig.APP_TITLE} user.`)
      break
  }
}

async function poll() {
  let offset: number | undefined

  for (;;) {
    try {
      if (!botUsername) {
        const me = await callTelegram<TelegramUser>('getMe')
        botUsername = me.username
        logger({ level: 'info', message: `Telegram bot connected as @${me.username ?? me.first_name}.` })
      }

      const updates = await callTelegram<TelegramUpdate[]>('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ['message'],
      }, POLL_TIMEOUT + 10)

      for (const update of updates) {
        offset = update.update_id + 1
        try {
          await handleUpdate(update)
        } catch (e) {
          logger({
            level: 'error',
            message: 'Error occurred while handling Telegram update.',
            errors: e instanceof Error ? [e] : [{ message: String(e) }],
          })
        }
      }
    } catch (e) {
      if (e instanceof TelegramError && e.code === 401) {
        logger({ level: 'error', message: 'Telegram bot token was rejected, check TELEGRAM_BOT_TOKEN. Telegram is disabled.' })
        botUsername = undefined
        return
      }

      logger({
        level: 'error',
        message: e instanceof TelegramError && e.code === 409
          ? 'Telegram polling conflict, the bot has a webhook set or is used by another running instance.'
          : 'Telegram polling failed.',
        errors: e instanceof Error ? [e] : [{ message: String(e) }],
      })
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
    }
  }
}

export function startTelegram() {
  if (!appConfig.TELEGRAM_BOT_TOKEN) {
    logger({ level: 'debug', message: 'Skipping Telegram bot, TELEGRAM_BOT_TOKEN is not set.' })
    return
  }

  void poll()
}
