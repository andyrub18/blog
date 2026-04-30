import { createFileRoute, Outlet, redirect } from '@tanstack/solid-router'
import { I18nProvider } from '../i18n/context'
import { isLocale, type Locale } from '../i18n'

export const Route = createFileRoute('/$lang')({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.lang)) {
      throw redirect({ to: '/' })
    }
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
