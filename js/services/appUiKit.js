import { escapeHtml } from '../security.js';

function renderActions(actions = []) {
  if (!actions.length) return '';

  return actions.map((action) => {
    const href = action.href ? ` href="${escapeHtml(action.href)}"` : '';
    const id = action.id ? ` id="${escapeHtml(action.id)}"` : '';
    const attrs = action.attrs ? ` ${action.attrs}` : '';
    const classes = escapeHtml(action.className || 'button button-neutral app-touch-button');
    const tag = action.href ? 'a' : 'button';
    const type = tag === 'button' ? ' type="button"' : '';
    return `<${tag}${href}${id}${type}${attrs} class="${classes}">${escapeHtml(action.label || 'Abrir')}</${tag}>`;
  }).join('');
}

export function renderPageHero({ eyebrow = '', title = '', description = '', badges = [], actions = [] }) {
  const badgesHtml = badges.length
    ? `<div class="mt-4 flex flex-wrap gap-2">${badges.map((badge) => `<span class="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100">${escapeHtml(badge)}</span>`).join('')}</div>`
    : '';

  return `
    <header class="app-page-hero">
      <div class="app-page-hero__copy">
        ${eyebrow ? `<p class="app-page-hero__eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h1 class="app-page-hero__title">${escapeHtml(title)}</h1>
        ${description ? `<p class="app-page-hero__description">${escapeHtml(description)}</p>` : ''}
        ${badgesHtml}
      </div>
      ${actions.length ? `<div class="app-page-hero__actions">${renderActions(actions)}</div>` : ''}
    </header>
  `;
}

export function renderMetricCard({ label, value, helper = '', tone = 'slate', icon = '' }) {
  return `
    <article class="app-metric-card tone-${escapeHtml(tone)}">
      <div class="app-metric-card__header">
        <p class="app-metric-card__label">${escapeHtml(label || '')}</p>
        ${icon ? `<span class="app-metric-card__icon">${escapeHtml(icon)}</span>` : ''}
      </div>
      <p class="app-metric-card__value">${escapeHtml(String(value ?? '-'))}</p>
      ${helper ? `<p class="app-metric-card__helper">${escapeHtml(helper)}</p>` : ''}
    </article>
  `;
}

export function renderMetricGrid(cards = [], columnsClass = 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4') {
  return `
    <section class="app-metric-grid ${columnsClass}">
      ${cards.join('')}
    </section>
  `;
}

export function renderSectionCard({ eyebrow = '', title = '', description = '', actions = [], body = '' }) {
  return `
    <section class="app-section-card">
      <div class="app-section-card__header">
        <div>
          ${eyebrow ? `<p class="app-section-card__eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
          <h2 class="app-section-card__title">${escapeHtml(title)}</h2>
          ${description ? `<p class="app-section-card__description">${escapeHtml(description)}</p>` : ''}
        </div>
        ${actions.length ? `<div class="app-section-card__actions">${renderActions(actions)}</div>` : ''}
      </div>
      <div class="app-section-card__body">${body}</div>
    </section>
  `;
}

export function renderChecklist(items = []) {
  return `
    <div class="app-checklist">
      ${items.map((item) => `
        <article class="app-checklist__item ${item.complete ? 'is-complete' : 'is-pending'}">
          <div class="app-checklist__status">${item.complete ? 'OK' : '•'}</div>
          <div class="app-checklist__copy">
            <strong>${escapeHtml(item.title || '')}</strong>
            <p>${escapeHtml(item.description || '')}</p>
            ${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ''}
          </div>
          ${item.actionHref ? `<a class="button button-primary app-touch-button" href="${escapeHtml(item.actionHref)}">${escapeHtml(item.actionLabel || 'Abrir')}</a>` : ''}
        </article>
      `).join('')}
    </div>
  `;
}

export function renderEmptyState({ title = '', description = '', actionLabel = '', actionHref = '', icon = '•' }) {
  return `
    <div class="app-empty-state">
      <span class="app-empty-state__icon">${escapeHtml(icon)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${actionHref ? `<a href="${escapeHtml(actionHref)}" class="button button-primary app-touch-button">${escapeHtml(actionLabel || 'Continuar')}</a>` : ''}
    </div>
  `;
}
