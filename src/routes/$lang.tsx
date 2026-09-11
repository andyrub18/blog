import { createFileRoute, Outlet, redirect } from '@tanstack/solid-router'
import { isLocale, type Locale } from '../i18n'
import { I18nProvider } from '../i18n/context'
import { fetchSessionUser } from '../lib/session'

export const Route = createFileRoute('/$lang')({
  beforeLoad: async ({ params }) => {
    if (!isLocale(params.lang)) {
      throw redirect({ to: '/' })
    }
    return { user: await fetchSessionUser() }
  },
  component: LangLayout,
})

function LangLayout() {
  const params = Route.useParams()
  return (
    <I18nProvider locale={params().lang as Locale}>
      <Outlet />
    </I18nProvider>
  )
}
