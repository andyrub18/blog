import { template } from '@solid-primitives/i18n'
import type { Dict } from './fr'

export const ht: Dict = {
  common: {
    appName: 'KLE',
    languages: {
      fr: 'Français',
      ht: 'Kreyòl',
    },
    switchLanguage: 'Chanje lang',
  },
  auth: {
    login: {
      title: 'Byenveni',
      subtitle:
        'Konekte w pou rantre nan konvèsasyon an epi kontribye nan atik kominote a.',
      email: 'Imèl',
      emailPlaceholder: 'ou@egzanp.ht',
      password: 'Modpas',
      passwordPlaceholder: '••••••••',
      submit: 'Konekte',
      submitting: 'Koneksyon…',
      googleContinue: 'Kontinye ak Google',
      googleSoon: 'Koneksyon Google ap vini talè.',
      noAccount: 'Ou poko gen kont ?',
      register: 'Kreye yon kont',
      separator: 'oswa',
      errors: {
        emailRequired: 'Imèl obligatwa.',
        emailInvalid: 'Imèl pa valab.',
        passwordRequired: 'Modpas obligatwa.',
        passwordTooShort: 'Pou pi piti 8 karaktè.',
        invalidCredentials: 'Enfòmasyon koneksyon pa valab.',
        emailNotVerified: 'Tanpri verifye imèl ou anvan ou konekte.',
        userNotFound: 'Pa gen okenn kont ki gen imèl sa a.',
        accountNotFound: 'Pa gen kont ak modpas pou imèl sa a.',
        sessionFailed: 'Pa kapab kreye sesyon an. Tanpri eseye ankò.',
        unexpected: 'Yon erè rive. Tanpri eseye ankò.',
      },
      meta: {
        title: template<{ appName: string }>('Koneksyon — {{appName}}'),
      },
    },
  },
}
