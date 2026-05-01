import { template } from '@solid-primitives/i18n'

export const fr = {
  common: {
    appName: 'KLE',
    languages: {
      fr: 'Français',
      ht: 'Kreyòl',
    },
    switchLanguage: 'Changer de langue',
    logout: 'Se déconnecter',
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
    register: {
      chooserTitle: 'Créer un compte',
      chooserSubtitle: 'Choisissez le type de compte qui vous correspond.',
      readerTitle: 'Lecteur',
      readerDescription:
        'Lisez les articles et participez aux discussions du forum.',
      readerCta: 'S’inscrire comme lecteur',
      memberTitle: 'Membre',
      memberDescription:
        'Devenez auteur : votre candidature sera examinée par l’équipe.',
      memberCta: 'Postuler comme membre',
      backToLogin: 'Retour à la connexion',
      common: {
        name: 'Nom complet',
        namePlaceholder: 'Jean Dupont',
        dateOfBirth: 'Date de naissance',
        essay: 'Votre vision pour le pays',
        essayPlaceholder:
          'Partagez en quelques mots votre vision et vos espoirs pour le pays…',
        submit: 'Créer mon compte',
        submitting: 'Création…',
        haveAccount: 'Vous avez déjà un compte ?',
        signIn: 'Se connecter',
      },
      member: {
        title: 'Postuler comme membre',
        subtitle:
          'En plus de vos informations, joignez les trois documents PDF requis.',
        cv: 'CV (PDF)',
        vision: 'Essai — Vision pour le pays (PDF)',
        contribution: 'Essai — Comment vous contribuerez (PDF)',
        pdfHint: 'PDF uniquement, 5 Mo maximum.',
        statusNote:
          'Après vérification de l’adresse courriel, vous aurez le statut « lecteur » jusqu’à validation par un membre principal.',
      },
      reader: {
        title: 'Inscription lecteur',
        subtitle:
          'Quelques informations et un court essai pour rejoindre la communauté.',
      },
      errors: {
        nameInvalid: 'Veuillez saisir votre nom complet.',
        dobRequired: 'Date de naissance requise.',
        dobInvalid: 'Date de naissance invalide.',
        tooYoung: 'Vous devez avoir au moins 13 ans.',
        essayTooShort: 'Votre essai doit faire au moins 50 caractères.',
        emailExists: 'Un compte existe déjà avec cette adresse.',
        invalidPdf: 'Document PDF invalide.',
        pdfTooLarge: 'Le PDF dépasse la taille maximale de 5 Mo.',
        unexpected: 'Erreur inattendue. Veuillez réessayer.',
      },
      success: {
        title: 'Compte créé',
        verifyHint:
          'Un courriel de vérification a été envoyé. Cliquez sur le lien pour activer votre compte.',
        memberHint:
          'Votre candidature de membre sera examinée par l’équipe après vérification de votre adresse courriel.',
      },
    },
    verify: {
      title: 'Vérification de votre adresse courriel',
      pending: 'Vérification en cours…',
      success: 'Votre adresse a été vérifiée. Vous pouvez maintenant vous connecter.',
      failure: 'Le lien de vérification est invalide ou expiré.',
      resend: 'Renvoyer le courriel de vérification',
      goLogin: 'Aller à la connexion',
    },
  },
}

export type Dict = typeof fr

