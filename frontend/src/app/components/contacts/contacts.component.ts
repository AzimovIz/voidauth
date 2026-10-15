import { Component, inject, type OnDestroy, type OnInit, ChangeDetectionStrategy } from '@angular/core'
import { HttpErrorResponse } from '@angular/common/http'
import { MatDialog } from '@angular/material/dialog'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import type { ConfigResponse } from '@shared/api-response/ConfigResponse'
import type { ContactLinkResponse, ContactResponse } from '@shared/api-response/ContactResponse'
import { MaterialModule } from '../../material-module'
import { ConfigService } from '../../services/config.service'
import { SnackbarService } from '../../services/snackbar.service'
import { SpinnerService } from '../../services/spinner.service'
import { UserService } from '../../services/user.service'
import { ConfirmComponent } from '../../dialogs/confirm/confirm.component'
import type { ContactType } from '@shared/db/Contact'

const CONTACT_POLL_INTERVAL = 3000 // ms

/**
 * Manage the current users contacts (other than email), ex. link a telegram account
 */
@Component({
  selector: 'app-contacts',
  imports: [MaterialModule, TranslatePipe],
  templateUrl: './contacts.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './contacts.component.scss',
})
export class ContactsComponent implements OnInit, OnDestroy {
  config?: ConfigResponse
  contacts: ContactResponse[] = []
  telegramLink?: ContactLinkResponse
  private contactPoll?: ReturnType<typeof setInterval>

  private configService = inject(ConfigService)
  private userService = inject(UserService)
  private snackbarService = inject(SnackbarService)
  private spinnerService = inject(SpinnerService)
  private dialog = inject(MatDialog)
  private translateService = inject(TranslateService)

  get telegram() {
    return this.contactsByType.telegram
  }

  private get contactsByType(): Partial<Record<ContactType, ContactResponse>> {
    return Object.fromEntries(this.contacts.map(c => [c.type, c]))
  }

  get visible() {
    return !!this.config?.telegramActive || !!this.contacts.length
  }

  async ngOnInit() {
    try {
      this.config = await this.configService.getConfig()
      await this.loadContacts()
    } catch (_e) {
      // contacts are optional, do not show errors
    }
  }

  ngOnDestroy() {
    this.stopContactPoll()
  }

  private async loadContacts() {
    this.contacts = await this.userService.getContacts()
  }

  async linkTelegram() {
    try {
      this.spinnerService.show()
      this.telegramLink = await this.userService.createTelegramLink()
      this.startContactPoll()
    } catch (e) {
      console.error(e)
      this.snackbarService.error(String(this.translateService.instant('settings.sections.profile.contacts.messages.link-failed')))
    } finally {
      this.spinnerService.hide()
    }
  }

  removeContact(contact: ContactResponse) {
    const dialogRef = this.dialog.open(ConfirmComponent, {
      data: {
        message: String(this.translateService.instant('settings.sections.profile.contacts.messages.unlink-confirm', {
          name: contact.displayName ?? contact.type,
        })),
        header: String(this.translateService.instant('settings.sections.profile.contacts.actions.unlink.tooltip')),
      },
    })

    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) {
        return
      }

      try {
        this.spinnerService.show()
        await this.userService.removeContact(contact.id)
        this.snackbarService.message(String(this.translateService.instant('settings.sections.profile.contacts.messages.unlinked')))
      } catch (e) {
        console.error(e)
        const message = e instanceof HttpErrorResponse ? (e.error as { message?: string } | null)?.message : undefined
        const fallback = String(this.translateService.instant('settings.sections.profile.contacts.messages.unlink-failed'))
        this.snackbarService.error(message ?? fallback)
      } finally {
        await this.loadContacts()
        this.spinnerService.hide()
      }
    })
  }

  // Wait for the user to link their telegram account
  private startContactPoll() {
    this.stopContactPoll()
    this.contactPoll = setInterval(async () => {
      if (this.telegramLink && new Date(this.telegramLink.expiresAt) < new Date()) {
        this.stopContactPoll()
        this.telegramLink = undefined
        return
      }

      try {
        await this.loadContacts()
        if (this.telegram) {
          this.stopContactPoll()
          this.telegramLink = undefined
          this.snackbarService.message(String(this.translateService.instant('settings.sections.profile.contacts.messages.linked')))
        }
      } catch (_e) {
        // try again on next interval
      }
    }, CONTACT_POLL_INTERVAL)
  }

  private stopContactPoll() {
    if (this.contactPoll) {
      clearInterval(this.contactPoll)
      this.contactPoll = undefined
    }
  }
}
