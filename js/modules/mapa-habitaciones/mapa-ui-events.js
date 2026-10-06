export const MAPA_ACCOUNT_MODAL_RENDERED_EVENT = 'mapaAccountModalRendered';

export function emitMapaAccountModalRendered({ modalRoot, reservationId }) {
  if (!modalRoot || !reservationId || typeof document === 'undefined') return;

  document.dispatchEvent(new CustomEvent(MAPA_ACCOUNT_MODAL_RENDERED_EVENT, {
    detail: {
      modalRoot,
      reservationId,
    },
  }));
}
