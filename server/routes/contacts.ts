import { Router } from 'express'
import zod from 'zod'
import { checkPrivilegedForEmail, checkUserExists } from '../util/authMiddleware'
import { zodValidate } from '../util/zodValidate'
import { deleteUserContact, getUserContacts } from '../db/contacts'
import { createTelegramLink } from '../contacts/telegram'
import type { ContactResponse } from '@shared/api-response/ContactResponse'
import { isUnverifiedUser } from '../util/auth'

export const contactsRouter = Router()

contactsRouter.use(checkUserExists)

contactsRouter.get('/',
  async (req, res) => {
    const user = req.user
    if (!user) {
      res.sendStatus(500)
      return
    }

    const contacts: ContactResponse[] = (await getUserContacts(user.id)).map(c => ({
      id: c.id,
      type: c.type,
      displayName: c.displayName,
      createdAt: c.createdAt,
    }))

    res.send(contacts)
  })

// Contacts can be managed with the same privileges as email,
// so a user without any verified contact can still add one
contactsRouter.use(checkPrivilegedForEmail)

contactsRouter.post('/telegram/link',
  async (req, res) => {
    const user = req.user
    if (!user) {
      res.sendStatus(500)
      return
    }

    const link = await createTelegramLink(user.id)
    if (!link) {
      res.status(400).send({ message: 'Telegram is not available.' })
      return
    }

    res.send(link)
  })

contactsRouter.delete('/:id',
  zodValidate({
    params: {
      id: zod.uuidv4(),
    },
  }),
  async (req, res) => {
    const user = req.user
    if (!user) {
      res.sendStatus(500)
      return
    }

    const contacts = await getUserContacts(user.id)
    const contact = contacts.find(c => c.id === req.params.id)
    if (!contact) {
      res.sendStatus(404)
      return
    }

    // Do not remove the last contact the user is verified with, they would not be able to login again
    const contactTypes = contacts.filter(c => c.id !== contact.id).map(c => c.type)
    if (!isUnverifiedUser(user) && isUnverifiedUser({ ...user, contactTypes })) {
      res.status(400).send({ message: 'Cannot unlink the only contact your account is verified with.' })
      return
    }

    await deleteUserContact(user.id, contact.id)

    res.send()
  })
