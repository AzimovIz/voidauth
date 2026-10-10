import { Router } from 'express'
import zod from 'zod'
import { checkPrivilegedForEmail, checkUserExists } from '../util/authMiddleware'
import { zodValidate } from '../util/zodValidate'
import { deleteUserContact, getUserContacts } from '../db/contacts'
import { createTelegramLink } from '../contacts/telegram'
import type { ContactResponse } from '@shared/api-response/ContactResponse'

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

    const deleted = await deleteUserContact(user.id, req.params.id)
    if (!deleted) {
      res.sendStatus(404)
      return
    }

    res.send()
  })
