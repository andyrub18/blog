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
    logout: 'Dekonekte',
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
    register: {
      chooserTitle: 'Kreye yon kont',
      chooserSubtitle: 'Chwazi kalite kont ki ale ak ou.',
      readerTitle: 'Lektè',
      readerDescription: 'Li atik yo epi patisipe nan diskisyon nan fowòm nan.',
      readerCta: 'Enskri kòm lektè',
      memberTitle: 'Manm',
      memberDescription:
        'Vin yon otè : ekip la pral revize aplikasyon w.',
      memberCta: 'Aplike kòm manm',
      backToLogin: 'Tounen nan koneksyon',
      common: {
        name: 'Non konplè',
        namePlaceholder: 'Jan Dipon',
        dateOfBirth: 'Dat nesans',
        essay: 'Vizyon ou pou peyi a',
        essayPlaceholder: 'Pataje an kèk mo vizyon w ak espwa w pou peyi a…',
        submit: 'Kreye kont mwen',
        submitting: 'Kreyasyon…',
        haveAccount: 'Ou deja gen yon kont ?',
        signIn: 'Konekte',
      },
      member: {
        title: 'Aplike kòm manm',
        subtitle:
          'Ansanm ak enfòmasyon w yo, mete twa dokiman PDF yo mande yo.',
        cv: 'CV (PDF)',
        vision: 'Esè — Vizyon pou peyi a (PDF)',
        contribution: 'Esè — Kijan w ap kontribye (PDF)',
        pdfHint: 'PDF sèlman, maksimòm 5 Mo.',
        statusNote:
          'Apre verifikasyon imèl ou, w ap gen estati « lektè » jiska yon manm prensipal valide ou.',
      },
      reader: {
        title: 'Enskripsyon lektè',
        subtitle:
          'Kèk enfòmasyon ak yon ti esè pou rantre nan kominote a.',
      },
      errors: {
        nameInvalid: 'Tanpri antre non konplè w.',
        dobRequired: 'Dat nesans obligatwa.',
        dobInvalid: 'Dat nesans pa valab.',
        tooYoung: 'Ou dwe gen pou pi piti 13 lane.',
        essayTooShort: 'Esè w la dwe gen pou pi piti 50 karaktè.',
        emailExists: 'Yon kont egziste deja ak imèl sa a.',
        invalidPdf: 'Dokiman PDF pa valab.',
        pdfTooLarge: 'PDF la depase gwosè maksimòm 5 Mo.',
        unexpected: 'Yon erè rive. Tanpri eseye ankò.',
      },
      success: {
        title: 'Kont kreye',
        verifyHint:
          'Yon imèl verifikasyon voye. Klike sou lyen an pou aktive kont ou.',
        memberHint:
          'Ekip la ap revize aplikasyon manm ou apre w fin verifye imèl ou.',
      },
    },
    verify: {
      title: 'Verifikasyon imèl ou',
      pending: 'Verifikasyon ap fèt…',
      success: 'Imèl ou verifye. Ou ka konekte kounye a.',
      failure: 'Lyen verifikasyon an pa valab oswa li ekspire.',
      resend: 'Voye imèl verifikasyon an ankò',
      goLogin: 'Ale nan koneksyon',
    },
  },
}

