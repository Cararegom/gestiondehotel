const STYLE_ID = 'mant-google-calendar-style';

let activeContainer = null;
let observer = null;
let enhanceTimer = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #mant-calendar-shell [data-google-calendar-viewport] {
      overflow-x: hidden !important;
      background: #fff;
    }

    #mant-calendar-shell [data-google-calendar-inner] {
      width: 100% !important;
      min-width: 0 !important;
    }

    #mant-calendar-shell [data-google-calendar-header],
    #mant-calendar-shell [data-google-calendar-grid] {
      width: 100%;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    #mant-calendar-shell [data-google-calendar-day] {
      min-width: 0;
      overflow: hidden;
      position: relative;
      transition: background-color 120ms ease;
    }

    #mant-calendar-shell [data-google-calendar-events] {
      min-width: 0;
    }

    #mant-calendar-shell [data-google-calendar-event] {
      width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-radius: 5px !important;
      border-width: 0 !important;
      border-left-width: 3px !important;
      line-height: 1.2;
      text-align: left;
      box-shadow: none;
    }

    #mant-calendar-shell [data-google-calendar-event="tarea"] {
      background: #dbeafe !important;
      border-left-color: #2563eb !important;
      color: #1e3a8a !important;
    }

    #mant-calendar-shell [data-google-calendar-event="preventivo"] {
      background: #ede9fe !important;
      border-left-color: #7c3aed !important;
      color: #4c1d95 !important;
    }

    #mant-calendar-shell [data-google-calendar-event="vencimiento"] {
      background: #fee2e2 !important;
      border-left-color: #dc2626 !important;
      color: #7f1d1d !important;
    }

    #mant-calendar-shell [data-google-calendar-more] {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (min-width: 768px) {
      #mant-calendar-shell [data-google-calendar-day] {
        min-height: 118px !important;
        padding: 7px !important;
      }

      #mant-calendar-shell [data-google-calendar-event] {
        padding: 4px 6px !important;
        font-size: 10px !important;
      }
    }

    @media (max-width: 767px) {
      #mant-calendar-shell {
        padding-left: 10px !important;
        padding-right: 10px !important;
        overflow: hidden;
      }

      #mant-calendar-shell [data-google-calendar-header] > div {
        padding: 7px 1px !important;
        font-size: 9px !important;
        letter-spacing: 0 !important;
      }

      #mant-calendar-shell [data-google-calendar-day] {
        min-height: 96px !important;
        padding: 4px 2px !important;
      }

      #mant-calendar-shell [data-google-calendar-day] > span:first-child {
        height: 22px !important;
        min-width: 22px !important;
        padding-left: 3px !important;
        padding-right: 3px !important;
        font-size: 10px !important;
      }

      #mant-calendar-shell [data-google-calendar-events] {
        margin-top: 2px !important;
        display: flex !important;
        flex-direction: column;
        gap: 2px !important;
      }

      #mant-calendar-shell [data-google-calendar-event] {
        padding: 3px 3px !important;
        font-size: 8px !important;
        letter-spacing: -0.01em;
      }

      #mant-calendar-shell [data-google-calendar-more] {
        padding: 1px 2px !important;
        font-size: 8px !important;
      }
    }

    @media (max-width: 390px) {
      #mant-calendar-shell [data-google-calendar-day] {
        min-height: 90px !important;
      }

      #mant-calendar-shell [data-google-calendar-event] {
        font-size: 7.5px !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function getEventKind(node) {
  const text = String(node?.textContent || '').trim();
  if (text.startsWith('🔄')) return 'preventivo';
  if (text.startsWith('⏰')) return 'vencimiento';
  return 'tarea';
}

function enhanceCalendar() {
  if (!activeContainer) return;
  const shell = activeContainer.querySelector('#mant-calendar-shell');
  if (!shell) return;

  ensureStyles();

  const days = [...shell.querySelectorAll('[data-calendar-date]')];
  if (!days.length) return;

  const grid = days[0].parentElement;
  const inner = grid?.parentElement;
  const viewport = inner?.parentElement;
  const header = grid?.previousElementSibling;

  if (viewport) viewport.dataset.googleCalendarViewport = '1';
  if (inner) inner.dataset.googleCalendarInner = '1';
  if (grid) grid.dataset.googleCalendarGrid = '1';
  if (header) header.dataset.googleCalendarHeader = '1';

  days.forEach((day) => {
    day.dataset.googleCalendarDay = '1';
    const eventsContainer = day.querySelector(':scope > span:nth-child(2)');
    if (eventsContainer) eventsContainer.dataset.googleCalendarEvents = '1';

    day.querySelectorAll('[data-plan-id]').forEach((eventNode) => {
      const kind = getEventKind(eventNode);
      eventNode.dataset.googleCalendarEvent = kind;
      eventNode.setAttribute('aria-label', eventNode.getAttribute('title') || eventNode.textContent.trim());
    });

    [...day.querySelectorAll('span')]
      .filter((node) => /^\+\d+\s+m[aá]s$/i.test(String(node.textContent || '').trim()))
      .forEach((node) => { node.dataset.googleCalendarMore = '1'; });
  });
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(enhanceCalendar, 20);
}

export function mountMaintenanceCalendarGoogleStyle(container) {
  activeContainer = container;
  ensureStyles();
  enhanceCalendar();

  observer?.disconnect();
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(container, { childList: true, subtree: true });
}

export function unmountMaintenanceCalendarGoogleStyle() {
  observer?.disconnect();
  observer = null;
  clearTimeout(enhanceTimer);
  enhanceTimer = null;
  activeContainer = null;
}
