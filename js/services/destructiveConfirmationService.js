function stripHtml(html = '') {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function confirmDestructiveAction({
  title = 'Confirmar acción',
  html = 'Esta acción no se puede deshacer.',
  keyword = 'ELIMINAR',
  confirmButtonText = 'Continuar',
  cancelButtonText = 'Cancelar'
} = {}) {
  if (typeof Swal === 'undefined') {
    return window.confirm(`${title}\n\n${stripHtml(html)}\n\nEscribe mentalmente "${keyword}" para confirmar.`);
  }

  const expected = String(keyword || 'ELIMINAR').trim();
  const result = await Swal.fire({
    icon: 'warning',
    title,
    html: `
      <div class="text-left">
        <div class="mb-3">${html}</div>
        <div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
          Para confirmar, escribe <b>${expected}</b>.
        </div>
      </div>
    `,
    input: 'text',
    inputPlaceholder: expected,
    inputAttributes: {
      autocapitalize: 'off',
      autocorrect: 'off'
    },
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    focusCancel: true,
    preConfirm: (value) => {
      if (String(value || '').trim().toUpperCase() !== expected.toUpperCase()) {
        Swal.showValidationMessage(`Debes escribir exactamente "${expected}".`);
        return false;
      }
      return true;
    }
  });

  return Boolean(result.isConfirmed);
}
