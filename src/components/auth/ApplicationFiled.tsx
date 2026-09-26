import { Link } from '@tanstack/solid-router'
import { m } from '../../paraglide/messages'

/**
 * What an applicant sees once their dossier is in.
 *
 * Rendered from two places on purpose, and they must say the same thing:
 * `ApplyForm` shows it the instant the server answers, and `/apply` shows it to
 * anyone whose application is still open — including the same person one
 * `router.invalidate()` later, and again next week. Before, only the first of
 * those existed, so the confirmation lasted until the route guard redirected
 * over it and the applicant was left on the home page with no word either way.
 *
 * The way out matters as much as the message. Someone who has just uploaded
 * three PDFs should not have to reach for the back button to find out the site
 * still has other pages.
 */
export default function ApplicationFiled() {
  return (
    <div class="flex flex-col items-center gap-3 text-center">
      <h2 class="text-lg font-semibold text-neutral-900">{m.apply_successTitle()}</h2>
      <p class="text-sm text-neutral-700">{m.apply_successHint()}</p>
      <Link to="/articles" class="text-sm font-medium text-[#00209F] hover:underline">
        {m.articles_backToIndex()}
      </Link>
    </div>
  )
}
