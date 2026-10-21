import translationsEN from '../../public/i18n/en-US.json'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import { Component, inject, type OnInit, ChangeDetectionStrategy, signal } from '@angular/core'
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router'
import { filter } from 'rxjs'
import { HeaderComponent } from './components/header/header.component'
import { MaterialModule } from './material-module'
import { UserService } from './services/user.service'
import type { CurrentUserDetails } from '@shared/api-response/UserDetails'
import { SpinnerService } from './services/spinner.service'
import { ConfigService, getCurrentHost } from './services/config.service'
import type { ConfigResponse } from '@shared/api-response/ConfigResponse'
import { TranslationService } from './services/translation.service'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MaterialModule, HeaderComponent, RouterLink, TranslatePipe],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  user?: CurrentUserDetails
  config?: ConfigResponse
  host = getCurrentHost()
  showPageBackground = signal(false)

  private router = inject(Router)
  private userService = inject(UserService)
  private configService = inject(ConfigService)
  private spinnerService = inject(SpinnerService)
  private translate = inject(TranslateService)
  private translationService = inject(TranslationService)

  constructor() {
    this.updatePageBackground()
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      this.updatePageBackground()
    })

    this.translate.setTranslation('en-US', translationsEN)
    this.translate.setFallbackLang('en-US')
    this.translate.use('en-US')
    void this.translationService.setInitialLang()
  }

  private updatePageBackground() {
    this.showPageBackground.set(this.router.routerState.snapshot.root.firstChild?.data['pageBackground'] === true)
  }

  async ngOnInit() {
    try {
      this.spinnerService.show()
      this.user = await this.userService.getMyUser()
      this.config = await this.configService.getConfig()
    } catch (_e) {
      // user just isn't logged in
    } finally {
      this.spinnerService.hide()
    }
  }
}
