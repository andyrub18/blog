import { createFileRoute, redirect } from '@tanstack/solid-router'
import { detectLocale } from '../i18n/detect'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const lang = await detectLocale()
    throw redirect({ to: '/$lang', params: { lang } })
  },
})
