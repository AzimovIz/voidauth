import type { VerificationContactType } from '@shared/db/Contact'

export type ConfigResponse = {
  domain: string
  appName: string
  zxcvbnMin: number
  emailActive: boolean
  emailVerification: boolean
  contactVerification: VerificationContactType[]
  telegramActive: boolean
  registration: boolean
  contactEmail?: string
  defaultRedirect?: string
}
