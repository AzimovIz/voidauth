import { Component, inject, type OnInit, type OnDestroy, ChangeDetectionStrategy } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { MaterialModule } from '../../../material-module'
import { HttpErrorResponse } from '@angular/common/http'
import { SnackbarService } from '../../../services/snackbar.service'
import { SpinnerService } from '../../../services/spinner.service'
import type { ConfigResponse } from '@shared/api-response/ConfigResponse'
import { ConfigService, getCurrentHost } from '../../../services/config.service'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import { UserService } from '../../../services/user.service'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { isValidEmail } from '../../../validators/validators'
import { ValidationErrorPipe } from '../../../pipes/ValidationErrorPipe'
import type { CurrentUserDetails } from '@shared/api-response/UserDetails'
import { AsyncPipe } from '@angular/common'
import { REDIRECT_PATHS } from '@shared/constants'
import { AuthService } from '../../../services/auth.service'
import { TextDividerComponent } from '../../../components/text-divider/text-divider.component'
import type { ContactLinkResponse } from '@shared/api-response/ContactResponse'

const CONTACT_POLL_INTERVAL = 3000 // ms

@Component({
  selector: 'app-verify-sent',
  imports: [MaterialModule, TranslatePipe, ReactiveFormsModule, ValidationErrorPipe, AsyncPipe, TextDividerComponent],
  templateUrl: './verify-sent.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './verify-sent.component.scss',
})
export class VerifySentComponent implements OnInit, OnDestroy {
  sent: boolean = false
  telegramLink?: ContactLinkResponse
  private contactPoll?: ReturnType<typeof setInterval>
  config?: ConfigResponse
  host = getCurrentHost()
  currentUser?: CurrentUserDetails

  public emailForm = new FormGroup({
    email: new FormControl<string>(
      {
        value: '',
        disabled: false,
      },
      [Validators.required, isValidEmail],
    ),
  })

  private router = inject(Router)
  private translateService = inject(TranslateService)
  private activatedRoute = inject(ActivatedRoute)
  private userService = inject(UserService)
  private snackbarService = inject(SnackbarService)
  private spinnerService = inject(SpinnerService)
  private configService = inject(ConfigService)
  private authService = inject(AuthService)

  async ngOnInit() {
    this.activatedRoute.queryParamMap.subscribe((queryParams) => {
      this.sent = queryParams.get('sent') === 'true'
    })

    try {
      this.spinnerService.show()
      this.config = await this.configService.getConfig()
      await this.loadUser()
    } finally {
      this.spinnerService.hide()
    }
  }

  ngOnDestroy() {
    this.stopContactPoll()
  }

  // email can be used for verification
  get emailAllowed() {
    return !!this.config?.emailVerification
  }

  // telegram can be used for verification
  get telegramAllowed() {
    return !!this.config?.telegramActive && this.config.contactVerification.includes('telegram')
  }

  private async loadUser() {
    try {
      this.currentUser = await this.userService.getMyUser({
        disableCache: true,
      })
    } catch (_e) {
      // If user cannot be loaded, this page won't work
      this.snackbarService.error(String(this.translateService.instant('verify-email.verify-sent.messages.user-load-failed')))
    }

    if (!this.currentUser || this.currentUser.hasEmail) {
      this.emailForm.controls.email.disable()
    }
  }

  public async updateEmail() {
    try {
      this.spinnerService.show()
      const email = this.emailForm.value.email
      if (!email) {
        throw new Error('Email missing.')
      }
      const { sentVerification } = await this.userService.updateEmail({
        email: email,
      })
      // if email verification enabled, indicate that in message
      if (sentVerification) {
        await this.router.navigate([], {
          queryParams: {
            sent: true,
          },
          queryParamsHandling: 'merge',
        })
        this.snackbarService.message(String(this.translateService.instant('components.common.messages.verification-email-sent')))
      } else {
        this.snackbarService.message(String(this.translateService.instant('components.common.messages.email-updated')))
        await this.router.navigate([REDIRECT_PATHS.LOGIN])
      }
    } catch (e) {
      console.error(e)
      this.snackbarService.error(String(this.translateService.instant('components.common.messages.email-update-failed')))
    } finally {
      await this.loadUser()
      this.spinnerService.hide()
    }
  }

  public async sendVerification() {
    try {
      this.spinnerService.show()
      await this.userService.sendEmailVerification()
      await this.router.navigate([], {
        queryParams: {
          sent: true,
        },
        queryParamsHandling: 'merge',
      })
      this.snackbarService.message(String(this.translateService.instant('verify-email.verify-sent.messages.resent')))
    } catch (e) {
      console.error(e)
      let error: string | null = null

      if (e instanceof HttpErrorResponse) {
        error ??= e.error?.message
      } else {
        error ??= (e as Error).message
      }

      error ??= String(this.translateService.instant('components.common.messages.something-went-wrong'))
      this.snackbarService.error(error)
    } finally {
      this.spinnerService.hide()
    }
  }

  async updateEmailOrSendVerification() {
    if (this.currentUser?.hasEmail) {
      await this.sendVerification()
    } else {
      await this.updateEmail()
    }
  }

  async linkTelegram() {
    try {
      this.spinnerService.show()
      this.telegramLink = await this.userService.createTelegramLink()
      this.startContactPoll()
    } catch (e) {
      console.error(e)
      this.snackbarService.error(String(this.translateService.instant('verify-email.verify-sent.messages.telegram-link-failed')))
    } finally {
      this.spinnerService.hide()
    }
  }

  // Wait for the user to link their telegram, then continue login
  private startContactPoll() {
    this.stopContactPoll()
    this.contactPoll = setInterval(async () => {
      if (this.telegramLink && new Date(this.telegramLink.expiresAt) < new Date()) {
        this.stopContactPoll()
        this.telegramLink = undefined
        return
      }

      try {
        const user = await this.userService.getMyUser({ disableCache: true })
        if (user.contactTypes.includes('telegram')) {
          this.stopContactPoll()
          this.snackbarService.message(String(this.translateService.instant('verify-email.verify-sent.messages.telegram-linked')))
          await this.continueLogin()
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

  private async continueLogin() {
    try {
      this.spinnerService.show()
      try {
        await this.authService.interactionExists()
      } catch (_e) {
        // No interaction to continue, go to the home page
        await this.router.navigate(['/'])
        return
      }

      try {
        const result = await this.authService.interactionTryAgain()
        this.spinnerService.show(true)
        window.location.assign(result.location)
      } catch (_e) {
        await this.router.navigate(['/'])
      }
    } finally {
      this.spinnerService.hide()
    }
  }
}
