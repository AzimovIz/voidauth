import { ADMIN_GROUP } from '@shared/constants'
import { TABLES } from '@shared/db'
import type { ContactLog } from '@shared/db/Contact'
import type { User } from '@shared/db/User'
import type { PasswordReset } from '@shared/db/PasswordReset'
import { db } from '../db/db'
import { getPasswordResetURL } from '../db/passwordReset'
import appConfig from '../util/config'
import { activeContactTypes, sendToUserContacts } from './index'

type UserNames = Pick<User, 'id' | 'username' | 'name'>

function greeting(user: UserNames) {
  return user.name || user.username
}

/**
 * Send a password reset link to all of the users verified contacts
 * @returns the number of contacts the link was sent to
 */
export async function sendPasswordResetToContacts(passwordReset: PasswordReset, user: UserNames) {
  return await sendToUserContacts(user.id, {
    subject: `${appConfig.APP_TITLE}: Reset Your Password`,
    text: `${greeting(user)}, you can reset your password by following the link below.\n`
      + `If you didn't request a password reset, please ignore this message and do not open the link.`,
    url: getPasswordResetURL(passwordReset),
  }, {
    type: 'password_reset',
    reasons: `${passwordReset.id},${passwordReset.userId}`,
  })
}

/**
 * Notify a user that their account was approved, only if they were never notified before
 */
export async function sendApprovedToContacts(user: UserNames) {
  if (!appConfig.SIGNUP_REQUIRES_APPROVAL) {
    return 0
  }

  const approvedSent = await db().select('id').table<ContactLog>(TABLES.CONTACT_LOG)
    .where({ type: 'approved', toUser: user.id }).first()
  if (approvedSent) {
    return 0
  }

  return await sendToUserContacts(user.id, {
    subject: `Welcome to ${appConfig.APP_TITLE}`,
    text: `${greeting(user)}, your access is approved. You can now access ${appConfig.APP_TITLE} at`,
    url: appConfig.DEFAULT_REDIRECT || appConfig.APP_URL,
  }, {
    type: 'approved',
    reasons: user.id,
  })
}

/**
 * Notify admins about users awaiting approval, follows the same rules as admin notification emails
 */
export async function sendAdminContactNotifications() {
  if (!appConfig.ADMIN_EMAILS || !appConfig.SIGNUP_REQUIRES_APPROVAL || !activeContactTypes().length) {
    return
  }

  // If an admin notification has been recently sent, do not send more
  const recentNotification = await db().select().table<ContactLog>(TABLES.CONTACT_LOG)
    .where({ type: 'admin_notification' })
    .orderBy('createdAt', 'desc').first()
  if (recentNotification) {
    const cutoff = new Date(Date.now() - (appConfig.ADMIN_EMAILS * 1000))
    if (new Date(recentNotification.createdAt) >= cutoff) {
      return
    }
  }

  const approvalsNeeded = await db().select().table<User>(TABLES.USER).where({ approved: false })
  if (!approvalsNeeded.length) {
    return
  }

  // Only notify when there are users admins have not been notified about yet
  const notificationsSent = await db().select('reasons').table<ContactLog>(TABLES.CONTACT_LOG)
    .where({ type: 'admin_notification' })
    .andWhere((w) => {
      for (const approval of approvalsNeeded) {
        w.orWhereLike('reasons', `%${approval.id}%`)
      }
    })
  const approvalsNotNotified = approvalsNeeded.filter(u => !notificationsSent.some(n => n.reasons?.includes(u.id)))
  if (!approvalsNotNotified.length) {
    return
  }

  const adminUsers = await db().select<User[]>('user.*').table<User>(TABLES.USER)
    .innerJoin(TABLES.USER_GROUP, 'user_group.userId', 'user.id')
    .innerJoin(TABLES.GROUP, 'group.id', 'user_group.groupId')
    .where('group.name', ADMIN_GROUP)

  for (const admin of adminUsers) {
    await sendToUserContacts(admin.id, {
      subject: `${appConfig.APP_TITLE}: Admin Notifications`,
      text: `There are user(s) awaiting approval or deletion: ${approvalsNeeded.map(u => u.username).join(', ')}`,
      url: `${appConfig.APP_URL}/admin/users`,
    }, {
      type: 'admin_notification',
      reasons: approvalsNeeded.map(u => u.id).join(','),
    })
  }
}
