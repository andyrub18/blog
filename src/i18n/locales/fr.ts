import { template } from '@solid-primitives/i18n'

export const fr = {
  common: {
    appName: 'KLE',
    languages: {
      fr: 'Français',
      ht: 'Kreyòl',
    },
    switchLanguage: 'Changer de langue',
  },
  auth: {
    login: {
      title: 'Bienvenue',
      subtitle:
        'Connectez-vous pour rejoindre la conversation et contribuer aux articles de la communauté.',
      email: 'Adresse courriel',
      emailPlaceholder: 'vous@example.ht',
      password: 'Mot de passe',
      passwordPlaceholder: '••••••••',
      submit: 'Se connecter',
      submitting: 'Connexion…',
      googleContinue: 'Continuer avec Google',
      googleSoon: 'La connexion Google arrive bientôt.',
      noAccount: 'Pas encore membre ?',
      register: 'Créer un compte',
      separator: 'ou',
      errors: {
        emailRequired: 'Adresse courriel requise.',
        emailInvalid: 'Adresse courriel invalide.',
        passwordRequired: 'Mot de passe requis.',
        passwordTooShort: 'Au moins 8 caractères.',
        invalidCredentials: 'Identifiants invalides.',
        emailNotVerified: 'Veuillez vérifier votre adresse courriel avant de vous connecter.',
        userNotFound: 'Aucun compte ne correspond à cette adresse courriel.',
        accountNotFound: 'Aucun compte avec mot de passe associé à cette adresse.',
        sessionFailed: 'Impossible de créer la session. Veuillez réessayer.',
        unexpected: 'Erreur inattendue. Veuillez réessayer.',
      },
      meta: {
        title: template<{ appName: string }>('Connexion — {{appName}}'),
      },
    },
  },
}

export type Dict = typeof fr
